import {
    ITelegramMedia,
    ITelegramParams,
    ITelegramResult,
    TTelegramChatId,
} from '../Telegram/interfaces/ITelegramPlatform';
import { AppContext, IRequestSend, isFile, Request, Text, stripTags } from '../../../index';
import { T_TELEGRAM } from '../Telegram/constants';
import { getErrorMsg, getErrorToken } from './constants';

/**
 * Базовый URL для всех методов Telegram API
 */
const API_ENDPOINT = 'https://api.telegram.org/bot';
const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;
const TELEGRAM_CAPTION_MAX_LENGTH = 1024;
const TELEGRAM_CALLBACK_TEXT_MAX_LENGTH = 200;
const TELEGRAM_POLL_QUESTION_MAX_LENGTH = 300;
const TELEGRAM_POLL_OPTION_MAX_LENGTH = 100;
const TELEGRAM_POLL_OPTIONS_MAX_COUNT = 12;
const TELEGRAM_UPLOAD_TIMEOUT = 30_000;
/**
 * Максимальная пауза после 429, при которой запрос повторяется, с. Лимит в группах —
 * 20 сообщений в минуту, и Telegram может попросить ждать до минуты: столько держать
 * ответ на вебхук нельзя.
 */
const TELEGRAM_MAX_RETRY_AFTER = 5;

/**
 * Достаёт `parameters.retry_after` из тела ответа 429.
 * @param errorBody Тело ответа Telegram
 * @returns Пауза в секундах или `null`, если её нет
 */
function getRetryAfter(errorBody: string | undefined): number | null {
    if (!errorBody) {
        return null;
    }
    try {
        const parsed = JSON.parse(errorBody) as { parameters?: { retry_after?: unknown } };
        const retryAfter = parsed.parameters?.retry_after;
        return typeof retryAfter === 'number' && retryAfter >= 0 ? retryAfter : null;
    } catch {
        return null;
    }
}

/**
 * Экранирует спецсимволы MarkdownV2 для безопасной вставки пользовательского ввода.
 *
 * Используйте эту функцию, если вы формируете сообщение в MarkdownV2
 * и хотите безопасно вставить текст, который может содержать спецсимволы.
 *
 * @example
 * ```ts
 * import { escapeMarkdownV2 } from 'umbot/plugins';
 *
 * const userName = 'Иван. Петров';
 * ctx.text = `*Пользователь:* ${escapeMarkdownV2(userName)}`;
 * // Результат: *Пользователь:* Иван\. Петров
 * ```
 *
 * @param text Текст для экранирования
 * @returns Экранированный текст, безопасный для MarkdownV2
 */
export function escapeMarkdownV2(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/**
 * Экранирует спецсимволы HTML для безопасной вставки пользовательского ввода.
 *
 * Экранирует только базовые HTML-сущности: &, <, >.
 * Не ломает валидные HTML-теги, которые разработчик передал намеренно.
 *
 * @example
 * ```ts
 * import { escapeHtml } from 'umbot/plugins';
 *
 * const userInput = '<script>alert("xss")</script>';
 * ctx.text = `<b>Ввод:</b> ${escapeHtml(userInput)}`;
 * // Результат: <b>Ввод:</b> &lt;script&gt;alert("xss")&lt;/script&gt;
 * ```
 *
 * @param text Текст для экранирования
 * @returns Экранированный текст, безопасный для HTML
 */
export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Минимальный контракт контекста для prepareTelegramMessageText: методу нужна
 * только логирующая способность AppContext. Структурный тип позволяет принимать
 * AppContext с любыми дженериками (TDbInfo/TQuery адаптера не обязаны совпадать
 * с дефолтными).
 */
export type ITelegramWarnContext = Pick<AppContext, 'logWarn'>;

/**
 * Готовит текст сообщения Telegram к отправке: обрезает по лимиту 4096
 * символов и снимает parse_mode, если текст был сокращён (оборванная
 * HTML/Markdown-сущность ломает всё сообщение).
 *
 * Единая логика для обоих путей отправки — `sendMessage` и webhook-reply
 * адаптера: ответ телом webhook не получает ответа API, поэтому обрезанное
 * длинное сообщение там отклоняется Telegram молча, и лимит обязан
 * применяться до сборки конверта.
 *
 * @param message Исходный текст сообщения
 * @param parseMode Режим разметки из настроек адаптера (HTML/MarkdownV2) или undefined
 * @param appContext Контекст приложения для warn-лога об обрезке (можно опустить)
 * @returns Объект с безопасным текстом и итоговым parse_mode
 *
 * @example
 * ```ts
 * const { text, parseMode } = prepareTelegramMessageText(
 *     'длинный текст…',
 *     'HTML',
 *     appContext,
 * );
 * ```
 */
export function prepareTelegramMessageText(
    message: string,
    parseMode: string | undefined,
    appContext?: ITelegramWarnContext | null,
): { text: string; parseMode: string | undefined } {
    const isTruncated = message.length > TELEGRAM_MESSAGE_MAX_LENGTH;
    if (!isTruncated) {
        return { text: message, parseMode };
    }
    appContext?.logWarn(
        `Telegram: текст превышает лимит ${TELEGRAM_MESSAGE_MAX_LENGTH} символов и будет сокращён.`,
    );
    // Обрезанный документ с разметкой почти всегда содержит оборванную
    // сущность (<b> без закрывающего тега, * без пары), на которой Telegram
    // отклоняет сообщение целиком — разметку снимаем.
    // Текст уходит без parse_mode, т.е. отображается как простой текст —
    // stripTags здесь снимает разметку, а не санитизирует HTML.
    const sourceMessage = parseMode?.toLowerCase() === 'html' ? stripTags(message) : message;
    return { text: Text.resize(sourceMessage, TELEGRAM_MESSAGE_MAX_LENGTH), parseMode: undefined };
}

/**
 * Класс для взаимодействия с API Telegram.
 * Предоставляет методы для отправки сообщений, файлов и других типов контента.
 * @see https://core.telegram.org/bots/api
 *
 * @example
 * ```ts
 * import { TelegramRequest } from 'umbot/plugins';
 *
 * // Создание экземпляра (appContext обязателен)
 * const telegram = new TelegramRequest(appContext);
 * telegram.initToken('your-bot-token');
 *
 * // Отправка простого сообщения
 * await telegram.sendMessage(12345, 'Привет!');
 *
 * // Отправка форматированного сообщения
 * await telegram.sendMessage(12345,
 *   '*Жирный текст* и _курсив_\n' +
 *   '[Ссылка](http://localhost)\n' +
 *   '`code` и ```pre```',
 *   { parse_mode: 'MarkdownV2' }
 * );
 *
 * // Отправка сообщения с клавиатурой
 * const keyboard = {
 *   keyboard: [[
 *     { text: 'Кнопка 1' },
 *     { text: 'Кнопка 2' }
 *   ]],
 *   resize_keyboard: true,
 *   one_time_keyboard: true
 * };
 *
 * await telegram.sendMessage(12345, 'Выберите:', {
 *   reply_markup: JSON.stringify(keyboard)
 * });
 *
 * // Отправка файлов
 * await telegram.sendPhoto(12345, 'photo.jpg', 'Описание фото');
 * await telegram.sendDocument(12345, 'document.pdf');
 * await telegram.sendAudio(12345, 'audio.mp3', {
 *   title: 'Название',
 *   performer: 'Исполнитель'
 * });
 * ```
 */
export class TelegramRequest {
    /**
     * Экземпляр класса для выполнения HTTP-запросов
     *
     */
    readonly #request: Request;

    /**
     * Последняя ошибка (объект ответа API, Error или текст)
     *
     */
    #error: object | string | null | undefined;

    /**
     * Токен доступа к Telegram API
     */
    public token: string | null;

    /**
     * Контекст приложения.
     */
    readonly #appContext: AppContext;

    /**
     * Создает экземпляр класса для работы с API Telegram
     * Устанавливает токен из конфигурации приложения, если он доступен
     *
     * @param appContext Контекст приложения (обязателен)
     */
    public constructor(appContext: AppContext) {
        this.#request = new Request(appContext);
        this.#request.maxTimeQuery = 5500;
        this.token = null;
        this.#error = null;
        this.#appContext = appContext;
        if (appContext.appConfig.tokens[T_TELEGRAM]?.token !== undefined) {
            this.initToken(appContext.appConfig.tokens[T_TELEGRAM].token);
        }
    }

    /**
     * Инициализирует токен доступа к Telegram API
     * @param token Токен для доступа к API; допустим null — отключает заголовок Authorization
     */
    public initToken(token: string | null): void {
        this.token = token;
    }

    /**
     * Формирует URL для отправки запроса
     * @returns Полный URL для API запроса
     *
     */
    protected _getUrl(): string {
        // Токен из initToken() приоритетнее токена из appConfig — иначе
        // мульти-ботовые сценарии уходили бы под токеном из конфигурации.
        const token = this.token ?? this.#appContext.appConfig.tokens[T_TELEGRAM]?.token;
        return `${API_ENDPOINT}${token}/`;
    }

    /**
     * Подготавливает данные для отправки файла
     * @param type Тип отправляемого файла
     * @param file Путь к локальному файлу, URL или file_id ранее загруженного файла
     *
     */
    async #initPostFile(type: string, file: string | ITelegramMedia[]): Promise<void> {
        this.#request.post = {};
        if (type === 'media' && typeof file !== 'string') {
            const formData = new FormData();
            const media: ITelegramMedia[] = [];
            for (let index = 0; index < file.length; index++) {
                const item = file[index];
                if (!item) {
                    continue;
                }
                const key = `photo${index}`;
                let mediaItem = item.media;
                if (item.media.includes('attach://')) {
                    await this.#request.addAttachFile(
                        formData,
                        item.media.replace('attach://', ''),
                        key,
                    );
                    mediaItem = `attach://${key}`;
                }
                media.push({
                    type: item.type,
                    media: mediaItem,
                    ...(item.caption ? { caption: item.caption } : {}),
                });
            }
            formData.append('media', JSON.stringify(media));
            this.#request.post = formData;
        } else if (Text.isUrl(file as string)) {
            this.#request.post[type] = file;
        } else if (await isFile(file as string)) {
            this.#request.attach = file as string;
            this.#request.attachName = type;
        } else {
            // Telegram принимает уже загруженный файл как строковый file_id — это не
            // локальный путь, и проверять его через Request.isFile() нельзя.
            this.#request.post[type] = file;
        }
    }

    /**
     * Отправляет запрос и один раз повторяет его после ответа 429, если Telegram
     * просит подождать не дольше {@link TELEGRAM_MAX_RETRY_AFTER} секунд. Более долгое
     * ожидание задержало бы ответ на вебхук — такое сообщение не отправляется (с логом).
     * @param url Полный URL метода
     * @returns Результат запроса (повторного, если он был)
     */
    async #sendWithRetryAfter(url: string): Promise<IRequestSend<ITelegramResult>> {
        // send() сбрасывает тело запроса — сохраняем его для повтора.
        const { post, attach, attachName } = this.#request;
        const data = await this.#request.send<ITelegramResult>(url);
        const retryAfter = data.httpStatus === 429 ? getRetryAfter(data.errorBody) : null;
        if (retryAfter === null || retryAfter > TELEGRAM_MAX_RETRY_AFTER) {
            return data;
        }
        await new Promise<void>((resolve) => {
            setTimeout(resolve, retryAfter * 1000).unref();
        });
        this.#request.post = post;
        this.#request.attach = attach;
        this.#request.attachName = attachName;
        return this.#request.send<ITelegramResult>(url);
    }

    /**
     * Отправляет запрос к Telegram API
     * @param method Название метода API
     * @param userId ID пользователя или чата
     * @returns Результат выполнения метода или null при ошибке
     */
    public async call(
        method: string,
        userId: TTelegramChatId | null = null,
    ): Promise<ITelegramResult | null> {
        this.#request.maxTimeQuery =
            /^(sendPhoto|sendDocument|sendAudio|sendVoice|sendVideo|sendMediaGroup)$/u.test(method)
                ? TELEGRAM_UPLOAD_TIMEOUT
                : 5500;
        if (userId) {
            if (this.#request.post instanceof FormData) {
                this.#request.post.append('chat_id', userId.toString());
            } else {
                this.#request.post ??= {};
                this.#request.post.chat_id = userId;
            }
        }
        if (this.token) {
            if (method) {
                const data = await this.#sendWithRetryAfter(this._getUrl() + method);
                if (data.status && data.data) {
                    if (!data.data.ok) {
                        this.#error = data;
                        this.#log('call() Запрос к платформе завершился с ошибкой.');
                        return null;
                    }
                    return data.data;
                }
                this.#log(data.err);
            }
        } else {
            this.#log(getErrorToken(T_TELEGRAM, 'call'));
        }
        return null;
    }

    /**
     * Отправляет результаты inline-запроса в Telegram.
     * @param inlineQueryId Идентификатор входящего inline-запроса
     * @param results Элементы, которые пользователь увидит в inline-поиске
     * @returns Ответ Telegram API или `null` при ошибке
     */
    public async answerInlineQuery(
        inlineQueryId: string,
        results: Record<string, unknown>[],
    ): Promise<ITelegramResult | null> {
        this.#request.post = {
            inline_query_id: inlineQueryId,
            results,
        };
        return await this.call('answerInlineQuery');
    }

    /**
     * Отправляет текстовое сообщение
     * @param chatId ID чата или пользователя
     * @param message Текст сообщения
     * @param params Дополнительные параметры:
     * - parse_mode: формат текста
     *   - MarkdownV2: *жирный*, _курсив_, [ссылка](http://localhost), `код`, ```pre```
     *   - HTML: <b>жирный</b>, <i>курсив</i>, <a href="http://localhost">ссылка</a>, <code>код</code>, <pre>pre</pre>
     * - disable_web_page_preview: отключить предпросмотр ссылок
     * - disable_notification: отключить уведомление
     * - reply_to_message_id: ID сообщения для ответа
     * - reply_markup: клавиатура в JSON формате
     *   - keyboard: обычная клавиатура
     *   - inline_keyboard: встроенная клавиатура
     *   - remove_keyboard: удалить клавиатуру
     *   - force_reply: форсировать ответ
     *
     * @example
     * ```ts
     * // Простое сообщение
     * await telegram.sendMessage(12345, 'Привет!');
     *
     * // Форматированное сообщение
     * await telegram.sendMessage(12345,
     *   '<b>Жирный</b> и <i>курсив</i>\n' +
     *   '<a href="http://localhost">Ссылка</a>\n' +
     *   '<code>code</code>',
     *   { parse_mode: 'HTML' }
     * );
     *
     * // Сообщение с обычной клавиатурой
     * const keyboard = {
     *   keyboard: [[
     *     { text: 'Кнопка 1' },
     *     { text: 'Кнопка 2' }
     *   ]],
     *   resize_keyboard: true
     * };
     * await telegram.sendMessage(12345, 'Выберите:', {
     *   reply_markup: JSON.stringify(keyboard)
     * });
     *
     * // Сообщение с inline-клавиатурой
     * const inlineKeyboard = {
     *   inline_keyboard: [[{
     *     text: 'Кнопка',
     *     callback_data: 'button_1'
     *   }]]
     * };
     * await telegram.sendMessage(12345, 'Нажмите:', {
     *   reply_markup: JSON.stringify(inlineKeyboard)
     * });
     * ```
     *
     * @returns Информация об отправленном сообщении или null при ошибке
     */
    public sendMessage(
        chatId: TTelegramChatId,
        message: string,
        params: ITelegramParams | null = null,
    ): Promise<ITelegramResult | null> {
        if (!message.trim()) {
            this.#appContext.logWarn(
                'TelegramRequest.sendMessage(): Telegram не принимает пустой текст сообщения.',
            );
            return Promise.resolve(null);
        }
        // Обрезка по лимиту и снятие parse_mode у сокращённого текста —
        // единая логика с webhook-reply адаптера (prepareTelegramMessageText).
        const { text: safeMessage, parseMode: safeParseMode } = prepareTelegramMessageText(
            message,
            params?.parse_mode,
            this.#appContext,
        );
        const normalizedParams: ITelegramParams = { ...(params ?? {}) };
        if (safeParseMode === undefined) {
            delete normalizedParams.parse_mode;
        } else {
            normalizedParams.parse_mode = safeParseMode;
        }
        this.#request.post = {
            chat_id: chatId,
            text: safeMessage,
        };
        if (params) {
            this.#request.post = { ...normalizedParams, ...this.#request.post };
        }
        return this.call('sendMessage');
    }
    /**
     * Отправляет опрос
     * @param chatId ID чата или пользователя
     * @param question Текст вопроса
     * @param options Массив вариантов ответов (1-12 вариантов)
     * @param params Дополнительные параметры:
     * - is_anonymous: анонимный опрос (по умолчанию true)
     * - type: тип опроса
     *   - 'regular': обычный опрос (по умолчанию)
     *   - 'quiz': викторина с одним правильным ответом
     * - allows_multiple_answers: разрешить несколько ответов (только для regular)
     * - correct_option_ids: индексы правильных ответов (0-based, только для quiz).
     *   Устаревшее correct_option_id поддерживается и автоматически приводится к массиву.
     * - explanation: пояснение правильного ответа (только для quiz)
     * - explanation_parse_mode: формат пояснения (HTML/Markdown)
     * - open_period: время в секундах, когда опрос активен
     * - close_date: дата закрытия опроса (Unix timestamp)
     * - is_closed: закрыть опрос сразу
     *
     * @example
     * ```ts
     * // Викторина
     * await telegram.sendPoll(12345,
     *   'Столица России?',
     *   ['Санкт-Петербург', 'Москва', 'Новосибирск'],
     *   {
     *     type: 'quiz',
     *     correct_option_ids: [1], // Москва
     *     explanation: 'Москва - столица России с 1918 года',
     *     explanation_parse_mode: 'HTML'
     *   }
     * );
     * ```
     *
     * @returns Информация об отправленном опросе или null при ошибке
     */
    public async sendPoll(
        chatId: TTelegramChatId,
        question: string,
        options: string[],
        params: ITelegramParams | null = null,
    ): Promise<ITelegramResult | null> {
        if (
            !question.trim() ||
            options.length < 1 ||
            options.length > TELEGRAM_POLL_OPTIONS_MAX_COUNT ||
            options.some((option) => !option.trim())
        ) {
            this.#log(
                'sendPoll() Telegram ожидает непустой вопрос и от 1 до 12 непустых вариантов ответа.',
            );
            return null;
        }

        const normalizedOptions = options.map((option) => ({
            text: Text.resize(option, TELEGRAM_POLL_OPTION_MAX_LENGTH),
        }));

        const normalizedParams: ITelegramParams = { ...(params ?? {}) };

        // Актуальное поле Telegram Bot API — correct_option_ids (массив).
        // Устаревшее singular-поле correct_option_id маппим на массивный формат,
        // чтобы quiz-опрос не терял правильный ответ при отправке.
        if (normalizedParams.correct_option_id !== undefined) {
            normalizedParams.correct_option_ids = normalizedParams.correct_option_ids ?? [
                normalizedParams.correct_option_id,
            ];
            delete normalizedParams.correct_option_id;
        }

        // Валидируем correct_option_ids (обязателен для type: 'quiz')
        if (normalizedParams.correct_option_ids !== undefined) {
            const optionIds = normalizedParams.correct_option_ids;
            if (
                !Array.isArray(optionIds) ||
                optionIds.length === 0 ||
                optionIds.some(
                    (optionId) =>
                        !Number.isInteger(optionId) ||
                        optionId < 0 ||
                        optionId >= normalizedOptions.length,
                )
            ) {
                this.#log(
                    'sendPoll() correct_option_ids должен быть непустым массивом целых чисел, указывающих на существующие индексы вариантов ответа.',
                );
                return null;
            }
            // Bot API требует монотонно возрастающий список индексов:
            // [2, 0] или [1, 1] Telegram отклонил бы — сортируем и убираем дубли.
            normalizedParams.correct_option_ids = [...new Set(optionIds)].sort((a, b) => a - b);
        }

        this.#request.post = {
            ...normalizedParams,
            chat_id: chatId,
            question: Text.resize(question, TELEGRAM_POLL_QUESTION_MAX_LENGTH),
            options: JSON.stringify(normalizedOptions),
        };

        return this.call('sendPoll');
    }

    /**
     * Отвечает на callback-запрос от инлайн-кнопки.
     * @param callbackQueryId - ID запроса из поля callback_query.id
     * @param text - Текст уведомления (показывается всплывающим окном)
     * @param showAlert - Показывать как alert (true) или всплывающее уведомление (false)
     * @param url - URL для открытия после нажатия
     * @param cacheTime - Время кэширования ответа (сек)
     * @returns Результат ответа на callback-запрос (подтверждение) или null при ошибке
     */
    public async answerCallbackQuery(
        callbackQueryId: string,
        text?: string,
        showAlert?: boolean,
        url?: string,
        cacheTime?: number,
    ): Promise<ITelegramResult | null> {
        this.#request.post = {
            callback_query_id: callbackQueryId,
            text: text ? Text.resize(text, TELEGRAM_CALLBACK_TEXT_MAX_LENGTH) : undefined,
            show_alert: showAlert,
            url,
            cache_time: cacheTime,
        };
        return this.call('answerCallbackQuery');
    }

    /**
     * Отправляет фотографию
     * @param userId ID чата или пользователя
     * @param file Путь к локальному файлу, URL или file_id ранее загруженного файла (содержимое файла не поддерживается)
     * Поддерживаемые форматы:
     * - JPEG, JPG, PNG, GIF, WEBP
     * - Максимальный размер: 10MB
     * - Сумма ширины и высоты не более 10000 пикселей
     * @param desc Подпись к фотографии
     * @param params Дополнительные параметры:
     * - caption: подпись к фото (0-1024 символа)
     * - parse_mode: формат текста
     * - disable_notification: отключить уведомление
     * - reply_to_message_id: ID сообщения для ответа
     * - reply_markup: клавиатура в JSON
     * @returns Информация об отправленной фотографии или null при ошибке
     */
    public async sendPhoto(
        userId: TTelegramChatId,
        file: string,
        desc: string | null = null,
        params: ITelegramParams | null = null,
    ): Promise<ITelegramResult | null> {
        this.#request.post ??= {};
        await this.#initPostFile('photo', file);
        if (desc) {
            (this.#request.post as Record<string, unknown>).caption = Text.resize(
                desc,
                TELEGRAM_CAPTION_MAX_LENGTH,
            );
        }
        if (params) {
            this.#request.post = { ...params, ...this.#request.post };
            const caption = (this.#request.post as ITelegramParams).caption;
            if (typeof caption === 'string') {
                (this.#request.post as ITelegramParams).caption = Text.resize(
                    caption,
                    TELEGRAM_CAPTION_MAX_LENGTH,
                );
            }
        }
        return this.call('sendPhoto', userId);
    }

    /**
     * Отправляет документ
     * @param userId ID чата или пользователя
     * @param file Путь к локальному файлу, URL или file_id ранее загруженного файла (содержимое файла не поддерживается)
     * @param params Дополнительные параметры:
     * - caption: подпись к документу
     * - parse_mode: формат текста
     * - disable_notification: отключить уведомление
     * - reply_to_message_id: ID сообщения для ответа
     * - reply_markup: клавиатура в JSON
     * @returns Информация об отправленном документе или null при ошибке
     */
    public async sendDocument(
        userId: TTelegramChatId,
        file: string,
        params: ITelegramParams | null = null,
    ): Promise<ITelegramResult | null> {
        await this.#initPostFile('document', file);
        if (params) {
            this.#request.post = {
                ...params,
                ...(params.caption
                    ? { caption: Text.resize(params.caption, TELEGRAM_CAPTION_MAX_LENGTH) }
                    : {}),
                ...this.#request.post,
            };
        }
        return this.call('sendDocument', userId);
    }

    /**
     * Отправляет аудиофайл
     * @param userId ID чата или пользователя
     * @param file Путь к локальному файлу, URL или file_id ранее загруженного файла (содержимое файла не поддерживается)
     * @param params Дополнительные параметры:
     * - caption: подпись к аудио
     * - parse_mode: формат текста
     * - duration: длительность в секундах
     * - performer: исполнитель
     * - title: название
     * - disable_notification: отключить уведомление
     * - reply_to_message_id: ID сообщения для ответа
     * - reply_markup: клавиатура в JSON
     * @returns Информация об отправленном аудио или null при ошибке
     */
    public async sendAudio(
        userId: TTelegramChatId,
        file: string,
        params: ITelegramParams | null = null,
    ): Promise<ITelegramResult | null> {
        await this.#initPostFile('audio', file);
        if (params) {
            this.#request.post = {
                ...params,
                ...(params.caption
                    ? { caption: Text.resize(params.caption, TELEGRAM_CAPTION_MAX_LENGTH) }
                    : {}),
                ...this.#request.post,
            };
        }
        return this.call('sendAudio', userId);
    }

    /**
     * Отправляет голосовое сообщение.
     *
     * По Bot API голосовое сообщение — это OGG/Opus (а также MP3/M4A); именно
     * в OGG/Opus синтезирует речь Yandex SpeechKit. `sendAudio` для такого
     * файла не подходит: он принимает только MP3/M4A (музыкальный плеер).
     *
     * @param userId ID чата или пользователя
     * @param file Путь к локальному файлу, URL или file_id ранее загруженного голосового
     * @param params Дополнительные параметры (caption, duration, reply_markup и т.д.)
     * @returns Информация об отправленном сообщении или null при ошибке
     *
     * @example
     * ```ts
     * await telegram.sendVoice(chatId, './tts.ogg');
     * ```
     */
    public async sendVoice(
        userId: TTelegramChatId,
        file: string,
        params: ITelegramParams | null = null,
    ): Promise<ITelegramResult | null> {
        await this.#initPostFile('voice', file);
        if (params) {
            this.#request.post = {
                ...params,
                ...(params.caption
                    ? { caption: Text.resize(params.caption, TELEGRAM_CAPTION_MAX_LENGTH) }
                    : {}),
                ...this.#request.post,
            };
        }
        return this.call('sendVoice', userId);
    }

    /**
     * Отправляет видео
     * @param userId ID чата или пользователя
     * @param file Путь к локальному файлу, URL или file_id ранее загруженного файла (содержимое файла не поддерживается)
     * @param params Дополнительные параметры:
     * - caption: подпись к видео
     * - parse_mode: формат текста
     * - duration: длительность в секундах
     * - width: ширина
     * - height: высота
     * - disable_notification: отключить уведомление
     * - reply_to_message_id: ID сообщения для ответа
     * - reply_markup: клавиатура в JSON
     * @returns Информация об отправленном видео или null при ошибке
     */
    public async sendVideo(
        userId: TTelegramChatId,
        file: string,
        params: ITelegramParams | null = null,
    ): Promise<ITelegramResult | null> {
        await this.#initPostFile('video', file);
        if (params) {
            this.#request.post = {
                ...params,
                ...(params.caption
                    ? { caption: Text.resize(params.caption, TELEGRAM_CAPTION_MAX_LENGTH) }
                    : {}),
                ...this.#request.post,
            };
        }
        return this.call('sendVideo', userId);
    }

    /**
     * Отправляет группу медиа
     *
     * Принимает 2–10 элементов: вне диапазона — warn и null.
     *
     * @param userId ID чата или пользователя
     * @param media Массив объектов ITelegramMedia
     * @param params Дополнительные параметры
     * @returns Информация об отправленной группе медиа или null при ошибке
     */
    public async sendMediaGroup(
        userId: TTelegramChatId,
        media: ITelegramMedia[],
        params: ITelegramParams | null = null,
    ): Promise<ITelegramResult | null> {
        if (media.length < 2 || media.length > 10) {
            this.#appContext.logWarn(
                'TelegramRequest.sendMediaGroup(): Telegram ожидает от 2 до 10 элементов.',
            );
            return null;
        }
        const normalizedMedia = media.map((item) => ({
            ...item,
            ...(item.caption
                ? { caption: Text.resize(item.caption, TELEGRAM_CAPTION_MAX_LENGTH) }
                : {}),
        }));
        await this.#initPostFile('media', normalizedMedia);
        if (params) {
            if (this.#request.post instanceof FormData) {
                const formData = this.#request.post;
                Object.entries(params).forEach(([name, value]) => {
                    if (value !== undefined) {
                        formData.append(
                            name,
                            typeof value === 'string'
                                ? value
                                : typeof value === 'object'
                                  ? JSON.stringify(value)
                                  : String(value),
                        );
                    }
                });
            } else {
                this.#request.post = { ...this.#request.post, ...params };
            }
        }
        return this.call('sendMediaGroup', userId);
    }

    /**
     * Пишет информацию об ошибках через AppContext.logError (структурированный логгер)
     * @param error Текст ошибки для логирования
     *
     */
    #log(error: Error | string = ''): void {
        this.#appContext.logError(getErrorMsg(error, 'TelegramRequest', this.#request.url), {
            error: this.#error,
        });
    }
}
