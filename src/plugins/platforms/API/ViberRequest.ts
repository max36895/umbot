import {
    IViberApi,
    IViberGetUserDetails,
    IViberParams,
    IViberRichMediaParams,
    IViberSender,
    IViberWebhookParams,
} from './interfaces';
import { IViberButton } from '../Viber/interfaces/IViberPlatform';

import { AppContext, Request, Text } from '../../../index';
import { T_VIBER, VIBER_DEFAULT_API_VERSION } from '../Viber/constants';
import { getErrorMsg, getErrorToken } from './constants';

/**
 * Базовый URL для всех методов Viber API
 *
 */
const API_ENDPOINT = 'https://chatapi.viber.com/pa/';
const VIBER_MAX_FILE_SIZE = 50 * 1024 * 1024;
const VIBER_MAX_TEXT_LENGTH = 7000;
const VIBER_MAX_REQUEST_BYTES = 30 * 1024;

/**
 * Приводит версию Viber API к документированному целому числу.
 */
function normalizeApiVersion(value: unknown): number {
    const version = Number(value);
    return Number.isInteger(version) && version >= 1 ? version : VIBER_DEFAULT_API_VERSION;
}

/**
 * Класс для взаимодействия с API Viber.
 * Предоставляет методы для отправки сообщений, файлов и других типов контента.
 * @see https://developers.viber.com/docs/api/rest-bot-api/
 *
 * @group API платформ
 */
export class ViberRequest {
    /**
     * Экземпляр класса для выполнения HTTP-запросов
     *
     */
    readonly #request: Request;

    /**
     * Текст последней возникшей ошибки
     *
     */
    #error: object | string | null;

    /**
     * Токен доступа к Viber API
     */
    public token: string | null;

    /**
     * Контекст приложения.
     */
    readonly #appContext: AppContext;

    /**
     * Версия API для конкретного запроса.
     * Устанавливается из controller.platformOptions для каждого запроса,
     * чтобы избежать race condition при параллельных запросах от разных пользователей.
     * Если не задана, используется значение из appConfig.tokens.
     */
    public apiVersion: string | number | undefined;

    /**
     * Создает экземпляр класса для работы с API Viber
     * Устанавливает токен из конфигурации приложения, если он доступен
     *
     * @param appContext Контекст приложения (обязателен)
     */
    public constructor(appContext: AppContext) {
        this.#request = new Request(appContext);
        // Viber — единственный клиент без явного таймаута: дефолт Request (2000 мс)
        // обрывал send_message/rich_media при латентности chatapi.viber.com выше 2 с,
        // тогда как соседние адаптеры (VK/Telegram/MAX — 5500, их upload'ы — 30000)
        // на том же хостинге продолжали работать.
        this.#request.maxTimeQuery = 5500;
        this.token = null;
        this.#error = null;
        this.#appContext = appContext;
        if (appContext.appConfig.tokens[T_VIBER]?.token) {
            this.initToken(appContext.appConfig.tokens[T_VIBER].token);
        }
        this.#request.post = {};
    }

    /**
     * Инициализирует токен доступа к Viber API
     * @param token Токен для доступа к API
     */
    public initToken(token: string): void {
        this.token = token;
    }

    /**
     * Возвращает валидный объект отправителя для обязательного поля Viber API.
     */
    #getSender(sender?: IViberSender | string): { name: string; avatar?: string } | null {
        const configuredSender = this.#appContext.appConfig.tokens[T_VIBER]?.sender;
        const source = sender ?? configuredSender;
        if (!source) {
            this.#appContext.logWarn(
                'ViberRequest: обязательное имя sender не задано; сообщение не будет отправлено.',
            );
            return null;
        }
        if (typeof source !== 'object') {
            const name = Text.resize(String(source), 28);
            return name ? { name } : null;
        }
        const name = Text.resize(source.name, 28);
        if (!name) {
            this.#appContext.logWarn(
                'ViberRequest: обязательное имя sender пусто; сообщение не будет отправлено.',
            );
            return null;
        }
        return {
            ...source,
            name,
        };
    }

    /**
     * Отправляет запрос к Viber API
     *
     * Исходящее тело больше 30 КБ — warn, запрос не отправляется,
     * возвращает null.
     *
     * @param method Название метода API
     * @returns Результат выполнения метода или null при ошибке
     */
    public async call<T extends IViberApi>(method: string): Promise<T | null> {
        if (this.token) {
            if (method) {
                this.#request.header = {
                    ...this.#request.header,
                    'X-Viber-Auth-Token': this.token,
                };
                this.#request.post ??= {};
                const post = this.#request.post as Record<string, unknown>;
                post.min_api_version = normalizeApiVersion(
                    post.min_api_version ??
                        this.apiVersion ??
                        this.#appContext.appConfig.tokens[T_VIBER]?.api_version,
                );
                // Сериализуем тело один раз: строка используется и для проверки
                // размера, и как тело запроса (postInString), поэтому
                // Request._getOptions не делает JSON.stringify повторно.
                // Для FormData сериализация бессмысленна — он отправляется как есть.
                if (!(this.#request.post instanceof FormData)) {
                    let serializedPost: string;
                    try {
                        serializedPost = JSON.stringify(post);
                    } catch (e) {
                        this.#error = e as Error;
                        this.#log((e as Error).message);
                        return null;
                    }
                    const requestBytes = Buffer.byteLength(serializedPost, 'utf8');
                    if (requestBytes > VIBER_MAX_REQUEST_BYTES) {
                        this.#appContext.logWarn(
                            `ViberRequest.call(): размер запроса ${requestBytes} байт превышает лимит ${VIBER_MAX_REQUEST_BYTES} байт. Запрос не отправлен.`,
                        );
                        return null;
                    }
                    this.#request.postInString = serializedPost;
                }
                const sendData = await this.#request.send<IViberApi>(API_ENDPOINT + method);
                if (sendData.status && sendData.data) {
                    const data = sendData.data;
                    if (data.failed_list?.length) {
                        this.#error = sendData;
                        this.#log(data.status_message);
                    }
                    if (data.status === 0) {
                        return data as T;
                    }
                    const statusMessage = data.status_message ?? 'ok';
                    if (statusMessage !== 'ok') {
                        this.#error = sendData;
                        this.#log(data.status_message);
                    }
                } else {
                    this.#log(sendData.err);
                }
            }
        } else {
            this.#log(getErrorToken(T_VIBER, 'call'));
        }
        return null;
    }

    /**
     * Получает информацию о пользователе Viber
     * Запрос можно отправлять не более 2 раз в течение 12 часов для каждого пользователя
     * @param id Уникальный идентификатор пользователя
     * @returns Информация о пользователе или null при ошибке
     *
     * Возвращаемые данные:
     * - id: уникальный идентификатор
     * - name: имя пользователя
     * - avatar: URL аватара
     * - country: код страны
     * - language: язык устройства
     * - primary_device_os: ОС устройства
     * - api_version: версия API
     * - viber_version: версия Viber
     * - mcc: код страны
     * - mnc: код сети
     * - device_type: тип устройства
     */
    public getUserDetails(id: string): Promise<IViberGetUserDetails | null> {
        this.#request.post = {
            id,
        };
        return this.call<IViberGetUserDetails>('get_user_details');
    }

    /**
     * Отправляет сообщение пользователю
     * Сообщение можно отправить только после того, как пользователь подпишется на бота
     *
     * text обрезается до 7000 символов (Text.resize с warn).
     *
     * @param receiver ID пользователя Viber
     * @param sender Информация об отправителе:
     * - name: имя (до 28 символов)
     * - avatar: URL аватара (до 100 Кб, 720x720)
     * @param text Текст сообщения
     * @param params Дополнительные параметры:
     * - type: тип сообщения (text, picture, video, file, location, contact, sticker, url)
     * - tracking_data: данные для отслеживания
     * - min_api_version: минимальная версия API
     * - media: URL контента
     * - thumbnail: URL превью
     * - size: размер файла
     * - duration: длительность видео/аудио
     * - file_name: имя файла
     * - contact: контактная информация
     * - location: координаты
     * - sticker_id: ID стикера
     * @returns Результат отправки или null при ошибке
     */
    public sendMessage(
        receiver: string,
        sender: IViberSender | string,
        text: string,
        params: IViberParams | null = null,
    ): Promise<IViberApi | null> {
        const normalizedSender = this.#getSender(sender);
        if (!normalizedSender) {
            return Promise.resolve(null);
        }
        this.#request.post ??= {};
        if (!(this.#request.post instanceof FormData)) {
            this.#request.post = {
                ...(params ?? {}),
                receiver,
                sender: normalizedSender,
                text: this.#resizeText(text, 'sendMessage'),
                type: 'text',
            };
        }
        return this.call<IViberApi>('send_message');
    }

    /**
     * Собирает тело приветственного сообщения (welcome message) для ответа
     * на событие `conversation_started` — без отправки через REST API.
     *
     * `conversation_started` приходит до подписки пользователя, и
     * `send_message` для неподписанного пользователя Viber отклоняет.
     * Единственный документированный канал приветствия — JSON в теле
     * HTTP-ответа на этот webhook: те же параметры, что у `send_message`,
     * `receiver` не обязателен. Лимиты (sender 28 символов, текст 7000,
     * тело 30 КБ, `min_api_version`) применяются те же, что при отправке.
     *
     * @param sender Отправитель (имя/объект); если не задан — из конфигурации
     * @param text Текст сообщения
     * @param params Дополнительные параметры (клавиатура, tracking_data и т.д.)
     * @returns Тело ответа webhook либо `null`, если sender не задан или тело превышает 30 КБ
     *
     * @example
     * ```ts
     * const body = new ViberRequest(appContext).buildWelcomeMessage(null, 'Добро пожаловать!');
     * // вернуть body в ответ на webhook conversation_started
     * ```
     */
    public buildWelcomeMessage(
        sender: IViberSender | string | null,
        text: string,
        params: IViberParams | null = null,
    ): Record<string, unknown> | null {
        const normalizedSender = this.#getSender(sender ?? undefined);
        if (!normalizedSender) {
            return null;
        }
        const body: Record<string, unknown> = {
            ...(params ?? {}),
            sender: normalizedSender,
            text: this.#resizeText(text, 'buildWelcomeMessage'),
            type: 'text',
        };
        body.min_api_version = normalizeApiVersion(
            body.min_api_version ??
                this.apiVersion ??
                this.#appContext.appConfig.tokens[T_VIBER]?.api_version,
        );
        const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
        if (bytes > VIBER_MAX_REQUEST_BYTES) {
            this.#appContext.logWarn(
                `ViberRequest.buildWelcomeMessage(): размер сообщения ${bytes} байт превышает лимит ${VIBER_MAX_REQUEST_BYTES} байт. Приветствие не отправлено.`,
            );
            return null;
        }
        return body;
    }

    /**
     * Обрезает текст до лимита Viber (7000 символов) с предупреждением.
     * @param text Исходный текст
     * @param method Имя метода — для сообщения в логе
     * @returns Текст в пределах лимита
     */
    #resizeText(text: string, method: string): string {
        if (text.length > VIBER_MAX_TEXT_LENGTH) {
            this.#appContext.logWarn(
                `ViberRequest.${method}(): текст превышает лимит ${VIBER_MAX_TEXT_LENGTH} символов и будет сокращён.`,
            );
        }
        return Text.resize(text, VIBER_MAX_TEXT_LENGTH);
    }

    /**
     * Устанавливает webhook для получения событий
     *
     * При пустом url отправляется url: '' — снятие вебхука.
     *
     * @param url URL для получения событий
     * @param params Дополнительные параметры:
     * - event_types: типы событий
     * - send_name: отправлять имя
     * - send_photo: отправлять фото
     * @returns Результат установки или null при ошибке
     */
    public setWebhook(
        url: string,
        params: IViberWebhookParams | null = null,
    ): Promise<IViberApi | null> {
        if (url) {
            this.#request.post = {
                event_types: [
                    'delivered',
                    'seen',
                    'failed',
                    'subscribed',
                    'unsubscribed',
                    'message',
                    'conversation_started',
                ],
                send_name: true,
                send_photo: true,
                ...(params ?? {}),
                url,
            };
        } else {
            this.#request.post = {
                ...(params ?? {}),
                url: '',
            };
        }
        return this.call<IViberApi>('set_webhook');
    }

    /**
     * Отправляет карточку с кнопками
     * @param receiver ID пользователя Viber
     * @param richMedia Массив кнопок для отображения
     * @param params Дополнительные параметры:
     * - tracking_data: данные для отслеживания
     * - min_api_version: минимальная версия API
     * - alt_text: альтернативный текст
     * @param sender Отправитель. Если не задан, используется sender из конфигурации
     * @returns Результат отправки или null при ошибке
     */
    public richMedia(
        receiver: string,
        richMedia: IViberButton[],
        params: IViberRichMediaParams | null = null,
        sender?: IViberSender | string,
    ): Promise<IViberApi | null> {
        const normalizedSender = this.#getSender(sender);
        if (!normalizedSender) {
            return Promise.resolve(null);
        }
        this.#request.post = {
            ...(params ?? {}),
            min_api_version: Math.max(
                7,
                normalizeApiVersion(params?.min_api_version ?? this.apiVersion),
            ),
            receiver,
            sender: normalizedSender,
            type: 'rich_media',
            rich_media: {
                Type: 'rich_media',
                ButtonsGroupColumns: 6,
                ButtonsGroupRows: 7,
                BgColor: '#FFFFFF',
                Buttons: richMedia,
            },
        };
        return this.call<IViberApi>('send_message');
    }

    /**
     * Отправляет файл
     *
     * Валидации: size 1 байт–50 МБ, file_name ≤256, обязательное
     * расширение в имени URL.
     *
     * @param receiver ID пользователя Viber
     * @param file URL файла (поддерживаются только http/https-ссылки; локальные пути и содержимое не принимаются)
     * @param params Дополнительные параметры:
     * - tracking_data: данные для отслеживания
     * - min_api_version: минимальная версия API
     * - file_name: имя файла
     * - size: размер файла
     * @param sender Отправитель. Если не задан, используется sender из конфигурации
     * @returns Результат отправки или null при ошибке
     */
    public sendFile(
        receiver: string,
        file: string,
        params: IViberParams | null = null,
        sender?: IViberSender | string,
    ): Promise<IViberApi | null> | null {
        if (Text.isSayText(['http://', 'https://'], file)) {
            const normalizedSender = this.#getSender(sender);
            if (!normalizedSender) {
                return null;
            }
            if (
                !params?.size ||
                !Number.isInteger(params.size) ||
                params.size < 1 ||
                params.size > VIBER_MAX_FILE_SIZE
            ) {
                this.#appContext.logWarn(
                    'ViberRequest.sendFile(): params.size должен содержать фактический размер файла от 1 байта до 50 МБ.',
                );
                return null;
            }
            let fileName: string;
            try {
                fileName = new URL(file).pathname.split('/').pop() || 'file.bin';
            } catch {
                this.#appContext.logWarn(
                    'ViberRequest.sendFile(): передан некорректный URL файла.',
                );
                return null;
            }
            if (!fileName.includes('.') || fileName.endsWith('.')) {
                this.#appContext.logWarn(
                    'ViberRequest.sendFile(): имя файла в URL должно содержать расширение.',
                );
                return null;
            }
            this.#request.post = {
                ...params,
                receiver,
                sender: normalizedSender,
                type: 'file',
                media: file,
                size: params.size,
                file_name: Text.resize(params.file_name || fileName, 256),
            };
            return this.call<IViberApi>('send_message');
        }
        return null;
    }

    /**
     * Пишет информацию об ошибках через AppContext.logError (структурированный логгер)
     * @param error Текст ошибки для логирования
     */
    #log(error: Error | string = ''): void {
        this.#appContext.logError(getErrorMsg(error, 'ViberRequest', this.#request.url), {
            error: this.#error,
        });
    }
}
