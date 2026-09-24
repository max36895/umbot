import { IMaxSendMessage, IMaxParams, IMaxAppApi } from './interfaces';
import { IMaxUploadFile, TMaxUploadFile } from './interfaces/IMaxAppApi';
import { AppContext, Request, Text } from '../../../index';
import { T_MAX_APP } from '../Max/constants';
import { getErrorMsg, getErrorToken } from './constants';

/**
 * Базовый URL для всех методов Max API
 */
const MAX_API_ENDPOINT = 'https://platform-api2.max.ru/';
const MAX_MESSAGE_INTERVAL_MS = 500;
const MAX_TEXT_LENGTH = 4000;
const MAX_ATTACHMENTS = 12;
/**
 * Таймаут загрузки файла на временный upload-URL MAX.
 * На медленном восходящем канале стандартные 5.5 с обрывали загрузку,
 * и карточка/звук молча терялись.
 */
const MAX_UPLOAD_TIMEOUT = 30_000;
/** Паузы между повторами отправки, пока MAX обрабатывает загруженное вложение, мс. */
const ATTACHMENT_RETRY_DELAYS_MS = [500, 1000, 2000];
/** Маркер ответа «вложение ещё обрабатывается» (ошибка attachment.not.ready). */
const NOT_READY = Symbol('attachment.not.ready');
const maxMessageQueues = new Map<string, Promise<void>>();
const maxLastMessageAt = new Map<string, number>();

/**
 * Создаёт неблокирующую процесс задержку для соблюдения лимита MAX.
 */
function waitForMaxInterval(timeout: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, timeout);
        timer.unref();
    });
}

/**
 * Ставит отправки в один диалог в очередь с интервалом не менее 500 мс.
 */
async function waitForMaxMessageTurn(key: string): Promise<void> {
    const previous = maxMessageQueues.get(key) ?? Promise.resolve();
    const current = previous
        .catch(() => undefined)
        .then(async () => {
            const lastMessageAt = maxLastMessageAt.get(key) ?? 0;
            const timeout = Math.max(0, MAX_MESSAGE_INTERVAL_MS - (Date.now() - lastMessageAt));
            if (timeout) {
                await waitForMaxInterval(timeout);
            }
            const sentAt = Date.now();
            maxLastMessageAt.set(key, sentAt);
            const cleanupTimer = setTimeout(() => {
                if (maxLastMessageAt.get(key) === sentAt && !maxMessageQueues.has(key)) {
                    maxLastMessageAt.delete(key);
                }
            }, MAX_MESSAGE_INTERVAL_MS);
            cleanupTimer.unref();
        });
    maxMessageQueues.set(key, current);
    await current;
    if (maxMessageQueues.get(key) === current) {
        maxMessageQueues.delete(key);
    }
}

/**
 * Ошибка MAX «вложение ещё не обработано» (`attachment.not.ready`,
 * `errors.process.attachment.file.not.processed`). Причину MAX присылает в теле
 * ответа, которое Request включает в текст ошибки.
 * @param error Ошибка запроса
 * @returns true, если запрос стоит повторить после паузы
 */
function isAttachmentNotReady(error: unknown): boolean {
    const text = error instanceof Error ? error.message : String(error ?? '');
    return text.includes('attachment.not.ready') || text.includes('file.not.processed');
}

/**
 * Разбирает ответ сервера загрузки MAX.
 * Для image/file это JSON, для audio/video — `retval` (не JSON): такой ответ
 * даёт пустой объект, токен в этом случае берётся с шага POST /uploads.
 *
 * @param body Тело ответа сервера загрузки (текст)
 * @returns Разобранный объект ответа (пустой, если это не JSON-объект)
 */
function parseMaxUploadResponse(body: unknown): Record<string, unknown> {
    if (body && typeof body === 'object') {
        return body as Record<string, unknown>;
    }
    if (typeof body !== 'string' || !body.trim().startsWith('{')) {
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(body);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/**
 * Достаёт токен вложения из ответа загрузки: `token` верхнего уровня либо
 * `photos.<id>.token` (формат ответа загрузки изображений).
 *
 * @param uploaded Разобранный ответ сервера загрузки
 * @returns Токен вложения или undefined
 */
function getMaxUploadToken(uploaded: Record<string, unknown>): string | undefined {
    if (typeof uploaded.token === 'string' && uploaded.token) {
        return uploaded.token;
    }
    const photos = uploaded.photos;
    if (photos && typeof photos === 'object') {
        for (const photo of Object.values(photos as Record<string, unknown>)) {
            const token = (photo as { token?: unknown } | null)?.token;
            if (typeof token === 'string' && token) {
                return token;
            }
        }
    }
    return undefined;
}

/**
 * Класс для взаимодействия с API Max.
 * Предоставляет методы для отправки сообщений, загрузки файлов.
 * @see https://dev.max.ru/docs-api
 */
export class MaxRequest {
    /**
     * Экземпляр класса для выполнения HTTP-запросов
     *
     */
    readonly #request: Request;

    /**
     * Последняя ошибка (объект ответа API, Error или текст)
     *
     */
    #error: object | string | null;

    /**
     * Токен доступа к Max API
     */
    public token: string | null;

    /**
     * Флаг для прямой передачи содержимого файла
     * По умолчанию: false
     */
    public isAttachContent: boolean;

    /**
     * Контекст приложения.
     */
    readonly #appContext: AppContext;

    /**
     * Создает экземпляр класса для работы с API Max
     * Устанавливает токен из конфигурации приложения, если он доступен
     *
     * @param appContext Контекст приложения (обязателен)
     */
    public constructor(appContext: AppContext) {
        this.#request = new Request(appContext);
        this.#request.maxTimeQuery = 5500;
        this.isAttachContent = false;
        this.token = null;
        this.#error = null;
        this.#request.post = {};
        this.#appContext = appContext;
        if (appContext.appConfig.tokens[T_MAX_APP]?.token) {
            this.initToken(appContext.appConfig.tokens[T_MAX_APP].token);
        }
    }

    /**
     * Инициализирует токен доступа к MAX API
     * @param token Токен доступа к MAX API
     */
    public initToken(token: string): void {
        this.token = token;
    }

    /**
     * Устанавливает токен доступа к MAX API
     * @param accessToken Токен доступа
     * @protected
     */
    #setAccessToken(accessToken: string): void {
        if (!this.#request.header) {
            this.#request.header = {} as Record<string, string>;
        }
        (this.#request.header as Record<string, string>).Authorization = accessToken;
    }

    /**
     * Собирает тело сообщения MAX, сохраняя совместимость со старым плоским массивом кнопок.
     */
    #buildMessage(text: string, params: IMaxParams | null): Record<string, unknown> | null {
        const message: Record<string, unknown> = {};
        if (text) {
            if (text.length > MAX_TEXT_LENGTH) {
                this.#appContext.logWarn(
                    `MaxRequest: текст превышает лимит ${MAX_TEXT_LENGTH} символов и будет сокращён.`,
                );
            }
            message.text = Text.resize(text, MAX_TEXT_LENGTH);
        }
        if (!params) {
            return message.text ? message : null;
        }

        const mediaLimit = params.keyboard ? MAX_ATTACHMENTS - 1 : MAX_ATTACHMENTS;
        const sourceAttachments = params.attachments || [];
        if (sourceAttachments.length > mediaLimit) {
            this.#appContext.logWarn(
                `MaxRequest: число медиавложений превышает доступный лимит ${mediaLimit}; лишние вложения не будут отправлены.`,
            );
        }
        const attachments: Record<string, unknown>[] = sourceAttachments
            .slice(0, mediaLimit)
            .map((attachment) => attachment as unknown as Record<string, unknown>);
        if (params.keyboard) {
            const buttons = params.keyboard.buttons;
            attachments.push({
                type: 'inline_keyboard',
                payload: {
                    buttons: buttons.length && !Array.isArray(buttons[0]) ? [buttons] : buttons,
                },
            });
        }
        if (attachments.length) {
            message.attachments = attachments;
        }
        return message.text || message.attachments ? message : null;
    }

    /**
     * Выполняет вызов метода MAX API
     * @param method Название метода MAX API
     * @returns Результат выполнения метода или null при ошибке
     */
    public async call<T extends IMaxAppApi>(method: string): Promise<T | null> {
        const result = await this.#call<T>(method, false);
        // Без allowNotReady #call не возвращает маркер NOT_READY — сужаем тип.
        return result === NOT_READY ? null : result;
    }

    /**
     * Вызов метода API.
     * @param method Название метода MAX API
     * @param allowNotReady Не логировать ошибку `attachment.not.ready` — вызывающий повторит запрос
     * @returns Результат, `null` при ошибке или `NOT_READY`, если вложение ещё обрабатывается
     */
    async #call<T extends IMaxAppApi>(
        method: string,
        allowNotReady: boolean,
    ): Promise<T | null | typeof NOT_READY> {
        if (this.token) {
            this.#request.header = null;
            this.#setAccessToken(this.token);
            const data = await this.#request.send<T>(MAX_API_ENDPOINT + method);
            if (data.status && data.data) {
                return data.data;
            }
            if (allowNotReady && isAttachmentNotReady(data.err)) {
                return NOT_READY;
            }
            this.#error = data;
            this.#log(data.err);
        } else {
            this.#log(getErrorToken(T_MAX_APP, 'call'));
        }
        return null;
    }

    /**
     * Отправляет сообщение с вложениями, повторяя запрос, пока MAX обрабатывает файл.
     *
     * MAX отвечает ошибкой `attachment.not.ready`, если сообщение с вложением
     * отправлено сразу после загрузки файла (документация POST /uploads советует
     * повтор с растущим интервалом). Без повтора терялся бы весь ответ, включая текст.
     * Повторяем до 3 раз с паузами 0,5 / 1 / 2 с (таймеры не держат процесс).
     *
     * @param method Метод API (`messages` или `answers`)
     * @param get Query-параметры запроса
     * @param post Тело запроса
     * @param hasAttachments Есть ли вложения (без них повтор не нужен)
     * @returns Результат вызова или null при ошибке
     */
    async #callWithAttachmentRetry<T extends IMaxAppApi>(
        method: string,
        get: Record<string, string>,
        post: Record<string, unknown>,
        hasAttachments: boolean,
    ): Promise<T | null> {
        for (let attempt = 0; ; attempt++) {
            // Request сбрасывает get/post после каждого send — задаём заново.
            this.#request.get = get;
            this.#request.post = post;
            const canRetry = hasAttachments && attempt < ATTACHMENT_RETRY_DELAYS_MS.length;
            const result = await this.#call<T>(method, canRetry);
            if (result !== NOT_READY) {
                return result;
            }
            await waitForMaxInterval(ATTACHMENT_RETRY_DELAYS_MS[attempt] as number);
        }
    }

    /**
     * Загружает файл на сервера Max
     * @param file Путь к файлу или его содержимое
     * @param type Тип загружаемого файла
     * @returns Информация о загруженном файле или null при ошибке
     */
    public async upload(file: string, type: TMaxUploadFile): Promise<IMaxUploadFile | null> {
        if (this.token) {
            // MAX сначала выдаёт временный upload URL, а файл принимается уже этим URL.
            this.#request.get = { type };
            this.#request.post = null;
            this.#request.customRequest = 'POST';
            const uploadTarget = await this.call<IMaxUploadFile>('uploads');
            this.#request.get = null;
            this.#request.customRequest = null;
            if (!uploadTarget?.url) {
                return null;
            }

            this.#request.attach = file;
            this.#request.attachName = 'data';
            this.#request.isAttachContent = this.isAttachContent;
            this.#request.header = Request.HEADER_FORM_DATA;
            // Ответ сервера загрузки читаем текстом: для image/file это JSON
            // с token, а для audio/video — `retval` (не JSON), токен для них
            // выдан на первом шаге.
            this.#request.isConvertJson = false;
            const previousTimeout = this.#request.maxTimeQuery;
            this.#request.maxTimeQuery = MAX_UPLOAD_TIMEOUT;
            let data;
            try {
                data = await this.#request.send<string>(uploadTarget.url);
            } finally {
                this.#request.maxTimeQuery = previousTimeout;
            }
            if (data.status) {
                const uploaded = parseMaxUploadResponse(data.data);
                // audio/video: токен выдан на шаге POST /uploads;
                // image/file: токен приходит в ответе загрузки.
                const token = uploadTarget.token ?? getMaxUploadToken(uploaded);
                if (token) {
                    return {
                        ...uploaded,
                        url: uploadTarget.url,
                        token,
                    };
                }
                this.#appContext.logWarn(
                    `MaxRequest.upload(): сервер загрузки не вернул token для типа "${type}" — вложение не может быть отправлено.`,
                );
                return null;
            }
            this.#log(data.err);
        } else {
            this.#log(getErrorToken(T_MAX_APP, 'upload'));
        }
        return null;
    }

    /**
     * Отправляет сообщение пользователю или в чат
     *
     * Отправка идёт через очередь (waitForMaxMessageTurn): не чаще
     * 1 сообщения в 500 мс на диалог.
     *
     * @param peerId Идентификатор получателя (user_id или chat_id)
     * @param message Текст сообщения
     * @param params Дополнительные параметры (клавиатура, вложения и т.д.)
     * @param recipientType 'user' | 'chat' = 'user' — адресат: user_id или chat_id в query
     * @returns Информация об отправленном сообщении или null при ошибке
     */
    public async messagesSend(
        peerId: number | string,
        message: string,
        params: IMaxParams | null = null,
        recipientType: 'user' | 'chat' = 'user',
    ): Promise<IMaxSendMessage | null> {
        const requestBody = this.#buildMessage(message, params);
        if (!requestBody) {
            this.#appContext.logWarn(
                'MaxRequest.messagesSend(): сообщение не содержит текста или вложений и не будет отправлено.',
            );
            return null;
        }
        await waitForMaxMessageTurn(`${this.token ?? ''}:${recipientType}:${peerId}`);
        try {
            return await this.#callWithAttachmentRetry<IMaxSendMessage>(
                'messages',
                { [`${recipientType}_id`]: String(peerId) },
                requestBody,
                Array.isArray(requestBody.attachments) && requestBody.attachments.length > 0,
            );
        } finally {
            this.#request.get = null;
        }
    }

    /**
     * Отправляет результат обработки нажатия callback-кнопки MAX.
     *
     * @param callbackId Идентификатор callback из входящего webhook
     * @param text Текст сообщения, отображаемого после нажатия
     * @param params Клавиатура и вложения для сообщения
     * @param dialogId Идентификатор диалога для соблюдения лимита двух callback-ответов в секунду
     * @returns Ответ MAX API или `null`, если запрос не выполнен
     *
     * @example
     * ```ts
     * await api.answerCallback('callback-id', 'Заказ добавлен в корзину');
     * ```
     */
    public async answerCallback(
        callbackId: string,
        text: string,
        params: IMaxParams | null = null,
        dialogId?: number | string,
    ): Promise<IMaxAppApi | null> {
        const message = this.#buildMessage(text, params);
        if (dialogId !== undefined) {
            await waitForMaxMessageTurn(`${this.token ?? ''}:answer:${dialogId}`);
        }
        try {
            return await this.#callWithAttachmentRetry<IMaxAppApi>(
                'answers',
                { callback_id: callbackId },
                message ? { message } : {},
                Array.isArray(message?.attachments) && message.attachments.length > 0,
            );
        } finally {
            this.#request.get = null;
        }
    }

    /**
     * Регистрирует событие для получения уведомлений о новых сообщениях в MAX
     *
     * При невалидных аргументах (не-HTTPS URL, явный порт,
     * secret вне [A-Za-z0-9_-]{5,256}) — warn и Promise.resolve(null)
     * без вызова API.
     *
     * @param url URL для получения уведомлений
     * @param params Секрет webhook и список получаемых типов обновлений
     * @returns Ответ MAX API или null при ошибке
     */
    public subscriptions(
        url: string,
        params: { update_types?: string[]; secret?: string } | null = null,
    ): Promise<IMaxAppApi | null> {
        let webhookUrl: URL;
        try {
            webhookUrl = new URL(url);
        } catch {
            this.#appContext.logWarn('MaxRequest.subscriptions(): передан некорректный URL.');
            return Promise.resolve(null);
        }
        if (webhookUrl.protocol !== 'https:') {
            this.#appContext.logWarn(
                'MaxRequest.subscriptions(): webhook должен использовать HTTPS.',
            );
            return Promise.resolve(null);
        }
        if (webhookUrl.port) {
            this.#appContext.logWarn(
                'MaxRequest.subscriptions(): webhook MAX должен использовать стандартный HTTPS-порт 443 без явного порта в URL.',
            );
            return Promise.resolve(null);
        }
        if (params?.secret && !/^[a-zA-Z0-9_-]{5,256}$/.test(params.secret)) {
            this.#appContext.logWarn(
                'MaxRequest.subscriptions(): secret должен содержать 5–256 символов A-Z, a-z, 0-9, _ или -.',
            );
            return Promise.resolve(null);
        }
        this.#request.post = {
            url: webhookUrl.toString(),
            ...(params ?? {}),
        };
        return this.call('subscriptions');
    }

    /**
     * Пишет информацию об ошибках через AppContext.logError (структурированный логгер)
     * @param error Текст ошибки для логирования
     */
    #log(error: Error | string = ''): void {
        this.#appContext.logError(getErrorMsg(error, 'MaxRequest', this.#request.url), {
            error: this.#error,
        });
    }
}
