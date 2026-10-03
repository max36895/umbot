import {
    IVkApi,
    IVkDocSave,
    IVkParams,
    IVkParamsUsersGet,
    IVkPhotosSave,
    IVKSendMessage,
    IVkUploadFile,
    IVkUploadServer,
    IVkUsersGet,
    TVkDocType,
    TVkPeerId,
} from './interfaces';
import { AppContext, Request, Text, httpBuildQuery, keysCount } from '../../../index';
import { T_VK } from '../VK/constants';
import { getErrorMsg, getErrorToken } from './constants';

/**
 * Версия VK API по умолчанию
 */
const VK_API_VERSION = '5.199';
const VK_MESSAGE_MAX_LENGTH = 4096;
/**
 * Таймаут загрузки файлов на сервера VK.
 * Файлы могут передаваться долго, поэтому для upload он увеличен
 * относительно стандартных 5.5 с.
 */
const VK_UPLOAD_TIMEOUT = 30_000;

/**
 * Базовый URL для всех методов VK API
 */
const VK_API_ENDPOINT = 'https://api.vk.ru/method/';

/** Числовой идентификатор VK (пользователь, чат 2000000000+, сообщество с минусом). */
const VK_NUMERIC_ID = /^-?\d{1,15}$/;

/**
 * Класс для взаимодействия с API ВКонтакте.
 * Предоставляет методы для отправки сообщений, загрузки файлов и работы с другими функциями API.
 * @see https://vk.ru/dev/bots_docs
 *
 * @example
 * ```ts
 * import { VkRequest } from 'umbot/plugins';
 *
 * // Создание экземпляра (appContext обязателен)
 * const vk = new VkRequest(appContext);
 * vk.initToken('your-vk-token');
 *
 * // Отправка простого сообщения
 * await vk.messagesSend(12345, 'Привет!');
 *
 * // Отправка сообщения с клавиатурой
 * const keyboard = {
 *   one_time: true,
 *   buttons: [[{
 *     action: {
 *       type: 'text',
 *       label: 'Кнопка',
 *       payload: '{"button": 1}'
 *     },
 *     color: 'primary'
 *   }]]
 * };
 *
 * await vk.messagesSend(12345, 'Выберите действие:', {
 *   keyboard: JSON.stringify(keyboard)
 * });
 *
 * // Загрузка и отправка фото.
 * // Поля photo/server/hash у IVkUploadFile опциональны —
 * // перед вызовом photosSaveMessagesPhoto проверяем их наличие
 * const server = await vk.photosGetMessagesUploadServer(12345);
 * if (server) {
 *   const upload = await vk.upload(server.upload_url, 'path/to/photo.jpg');
 *   if (upload?.photo && upload?.server && upload?.hash) {
 *     const photo = await vk.photosSaveMessagesPhoto(
 *       upload.photo,
 *       upload.server,
 *       upload.hash
 *     );
 *     if (photo?.[0]) {
 *       await vk.messagesSend(12345, 'Фото:', {
 *         attachments: [`photo${photo[0].owner_id}_${photo[0].id}`]
 *       });
 *     }
 *   }
 * }
 * ```
 *
 * @group API платформ
 */
export class VkRequest {
    /**
     * Текущая используемая версия VK API
     */
    readonly #vkApiVersion: string;

    /**
     * Экземпляр класса для выполнения HTTP-запросов
     */
    protected _request: Request;

    /**
     * Последняя ошибка (объект ответа API, Error или текст)
     */
    protected _error: object | string | null;

    /**
     * Токен доступа к VK API
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
    protected _appContext: AppContext;

    /**
     * Создает экземпляр класса для работы с API ВКонтакте
     * Устанавливает токен из конфигурации приложения, если он доступен
     *
     * @param appContext Контекст приложения (обязателен)
     */
    public constructor(appContext: AppContext) {
        this._request = new Request(appContext);
        this._request.header = {
            'Content-Type': 'application/x-www-form-urlencoded',
        };
        this._request.maxTimeQuery = 5500;
        this.isAttachContent = false;
        this._appContext = appContext;
        if (appContext.appConfig.tokens[T_VK]?.api_version) {
            this.#vkApiVersion = appContext.appConfig.tokens[T_VK].api_version as string;
        } else {
            this.#vkApiVersion = VK_API_VERSION;
        }
        this.token = null;
        this._error = null;
        if (appContext.appConfig.tokens[T_VK]?.token) {
            this.initToken(appContext.appConfig.tokens[T_VK].token);
        }
    }

    /**
     * Инициализирует токен доступа к VK API
     * @param token Токен доступа к VK API
     */
    public initToken(token: string): void {
        this.token = token;
    }

    /**
     * Выполняет вызов метода VK API
     * @param method Название метода VK API
     * @returns Результат выполнения метода или null при ошибке
     */
    public async call<T extends IVkApi>(method: string): Promise<T | null> {
        if (this.token) {
            if (!this._request.attach) {
                // vk принимает post только в таком формате
                this._request.header = {
                    'Content-Type': 'application/x-www-form-urlencoded',
                };
            }
            this._request.post ??= {};
            if (!(this._request.post instanceof FormData)) {
                this._request.post.access_token = this.token;
                this._request.post.v = this.#vkApiVersion;
                if (!this._request.attach) {
                    // vk принимает post только в таком формате
                    this._request.postInString = httpBuildQuery(
                        this._request.post as Record<string, string>,
                    );
                }
            }
            const data = await this._request.send<T>(VK_API_ENDPOINT + method);
            if (data.status && data.data) {
                this._error = data.err || [];
                if (data.data.error !== undefined) {
                    this._error = data;
                    this._log('call() Запрос к платформе вернулся с ошибкой.');
                    return null;
                }
                return (data.data.response as T) || data.data;
            }
            this._log(data.err);
        } else {
            this._log(getErrorToken(T_VK, 'call'));
        }
        return null;
    }

    /**
     * Загружает файл на сервера ВКонтакте
     * @param url URL для загрузки файла
     * @param file Путь к файлу или его содержимое
     * @param fieldName Имя multipart-поля с файлом. Сервер загрузки фото
     * (`photos.getMessagesUploadServer`) принимает файл только в поле `photo` —
     * с полем `file` он возвращает пустой `photo: "[]"`, и сохранение фото падает.
     * Документы и голосовые (`docs.getMessagesUploadServer`) ждут поле `file`
     * (значение по умолчанию).
     * @returns Информация о загруженном файле или null при ошибке
     *
     * @remarks
     * Для фотографий возвращает:
     * - photo: строка, содержащая информацию о фото
     * - server: строка, идентификатор сервера
     * - hash: строка, хеш загруженного файла
     *
     * Для документов возвращает:
     * - file: строка, информация о загруженном файле
     *
     * @example
     * ```ts
     * // Загрузка фото.
     * // Поля photo/server/hash у IVkUploadFile опциональны —
     * // перед вызовом photosSaveMessagesPhoto проверяем их наличие
     * const server = await vk.photosGetMessagesUploadServer(12345);
     * if (server) {
     *   const upload = await vk.upload(server.upload_url, 'photo.jpg', 'photo');
     *   if (upload?.photo && upload?.server && upload?.hash) {
     *     const photo = await vk.photosSaveMessagesPhoto(
     *       upload.photo,
     *       upload.server,
     *       upload.hash
     *     ); // IVkPhotosSave[] — берём первый элемент
     *   }
     * }
     *
     * // Загрузка документа
     * const server = await vk.docsGetMessagesUploadServer(12345, 'doc');
     * if (server) {
     *   const upload = await vk.upload(server.upload_url, 'document.pdf');
     *   if (upload) {
     *     const doc = await vk.docsSave(
     *       upload.file,
     *       'Документ',
     *       'тег1,тег2'
     *     );
     *   }
     * }
     * ```
     */
    public async upload(
        url: string,
        file: string,
        fieldName: 'file' | 'photo' = 'file',
    ): Promise<IVkUploadFile | null> {
        this._request.attach = file;
        this._request.attachName = fieldName;
        this._request.isAttachContent = this.isAttachContent;
        this._request.header = Request.HEADER_FORM_DATA;
        // Загрузка файла — тяжёлая операция: на медленном восходящем канале дефолтные
        // 5.5 с обрывали загрузку по AbortSignal, и карточка молча терялась.
        // Telegram для тех же операций использует 30 с.
        const previousTimeout = this._request.maxTimeQuery;
        this._request.maxTimeQuery = VK_UPLOAD_TIMEOUT;
        try {
            const data = await this._request.send<IVkUploadFile>(url);
            if (data.status && data.data) {
                if (data.data.error !== undefined) {
                    this._error = data;
                    this._log();
                    return null;
                }
                return data.data;
            }
            this._log(data.err);
            return null;
        } finally {
            this._request.maxTimeQuery = previousTimeout;
        }
    }

    /**
     * Отправляет сообщение пользователю или в чат
     * @param peerId Идентификатор получателя:
     * - ID пользователя — передавайте числом (например, 12345)
     * - Короткое имя (screen_name) — передавайте строкой (например, 'durov');
     *   строка уходит в параметр `domain`, а не `peer_id`
     * - ID чата: 2000000000 + chat_id — числом (например, для чата 1: 2000000001)
     * - ID сообщества: -ID сообщества — числом (например, -123456789)
     * @param message Текст сообщения
     * @param params Дополнительные параметры:
     * - random_id: уникальный ID для избежания повторов
     * - attachments: массив вложений "<type><owner_id>_<media_id>"
     *   (объединяются через запятую в параметр attachment)
     *   Примеры:
     *   - Фото: "photo123456_789"
     *   - Документ: "doc123456_789"
     *   - Аудио: "audio123456_789"
     *   - Видео: "video123456_789"
     * - keyboard: клавиатура в JSON формате или строкой
     * - template: шаблон карусели в JSON формате или строкой
     *
     * @example
     * ```ts
     * // Простое сообщение
     * await vk.messagesSend(12345, 'Привет!');
     *
     * // Сообщение с вложениями
     * await vk.messagesSend(12345, 'Фото:', {
     *   attachments: ['photo123_456', 'doc123_456']
     * });
     *
     * // Сообщение с клавиатурой
     * const keyboard = {
     *   one_time: true,
     *   buttons: [[{
     *     action: {
     *       type: 'text',
     *       label: 'Кнопка',
     *       payload: '{"button": 1}'
     *     },
     *     color: 'primary'
     *   }]]
     * };
     * await vk.messagesSend(12345, 'Выберите:', {
     *   keyboard: JSON.stringify(keyboard)
     * });
     *
     * // Сообщение с каруселью
     * const template = {
     *   type: 'carousel',
     *   elements: [{
     *     title: 'Заголовок',
     *     description: 'Описание',
     *     photo_id: '-123456_789',
     *     buttons: [{
     *       action: {
     *         type: 'text',
     *         label: 'Кнопка',
     *         payload: '{"button": 1}'
     *       }
     *     }]
     *   }]
     * };
     * await vk.messagesSend(12345, '', {
     *   template: JSON.stringify(template)
     * });
     * ```
     *
     * @returns Информация об отправленном сообщении или null при ошибке
     */
    public async messagesSend(
        peerId: TVkPeerId,
        message: string,
        params: IVkParams | null = null,
    ): Promise<IVKSendMessage | null> {
        const hasParamsContent = !!params && Object.keys(params).some((key) => key !== 'random_id');
        if (!message.trim() && !hasParamsContent) {
            this._appContext.logWarn(
                'VkRequest.messagesSend(): сообщение не содержит текста, вложений, клавиатуры или шаблона и не будет отправлено.',
            );
            return null;
        }
        if (message.length > VK_MESSAGE_MAX_LENGTH) {
            this._appContext.logWarn(
                `VkRequest.messagesSend(): текст превышает лимит ${VK_MESSAGE_MAX_LENGTH} символов и будет сокращён.`,
            );
        }
        const method = 'messages.send';
        this._request.post = {
            peer_id: peerId,
            message: Text.resize(message, VK_MESSAGE_MAX_LENGTH),
            random_id: this.#generateRandomId(),
        };

        if (typeof peerId === 'string' && VK_NUMERIC_ID.test(peerId)) {
            // Числовой id строкой ('123' — после escapeString DB-адаптера или из
            // bot.send('123', ...)) — это peer_id: короткий адрес VK не бывает чисто цифровым.
            this._request.post.peer_id = Number(peerId);
        } else if (typeof peerId !== 'number') {
            // peer_id может быть строкой (screen_name) — тогда адресат идёт через domain.
            this._request.post.domain = peerId;
            delete this._request.post.peer_id;
        }
        if (params) {
            const p = { ...params };
            if (p.random_id === undefined) {
                this._request.post.random_id = this.#generateRandomId();
            } else {
                this._request.post.random_id = p.random_id;
            }

            if (p.attachments?.length) {
                this._request.post.attachment = p.attachments.join(',');
            }
            delete p.attachments;

            if (p.template !== undefined) {
                if (typeof p.template !== 'string') {
                    p.template = JSON.stringify(p.template);
                }
                this._request.post.template = p.template;
                delete p.template;
            }

            if (p.keyboard !== undefined) {
                if (this._request.post.template !== undefined) {
                    this._appContext.logWarn(
                        'VkRequest.messagesSend(): keyboard и template взаимоисключающи в VK API. Template будет удалён.',
                    );
                    // delete, а не `= undefined`: httpBuildQuery сериализует значение
                    // через String(), и VK ответил бы ошибкой 100 на `template=undefined`.
                    delete this._request.post.template;
                }
                if (typeof p.keyboard !== 'string') {
                    p.keyboard = JSON.stringify(p.keyboard);
                }
                this._request.post.keyboard = p.keyboard;
                delete p.keyboard;
            }

            if (keysCount(p)) {
                this._request.post = { ...p, ...this._request.post };
            }
        }
        return await this.call(method);
    }

    /**
     * Получает информацию о пользователе или списке пользователей
     * @param userId ID пользователя, список ID через запятую или массив ID
     * @param params Дополнительные параметры запроса
     * @returns Массив пользователей или null при ошибке
     */
    public async usersGet(
        userId: TVkPeerId | string[],
        params: IVkParamsUsersGet | null = null,
    ): Promise<IVkUsersGet[] | null> {
        if (typeof userId === 'number') {
            // Документированный параметр users.get — user_ids (список через запятую).
            this._request.post = { user_ids: String(userId) };
        } else if (Array.isArray(userId)) {
            this._request.post = { user_ids: userId.join(',') };
        } else {
            this._request.post = { user_ids: userId };
        }
        if (params) {
            this._request.post = { ...this._request.post, ...params };
        }
        return (await this.call<IVkUsersGet>('users.get')) as unknown as IVkUsersGet[];
    }

    /**
     * Получает URL для загрузки фотографий в сообщения
     * @param peerId ID получателя сообщения
     * @returns Данные для загрузки или null при ошибке
     */
    public async photosGetMessagesUploadServer(peerId: TVkPeerId): Promise<IVkUploadServer | null> {
        this._request.post = { peer_id: peerId };
        return this.call<IVkUploadServer>('photos.getMessagesUploadServer');
    }

    /**
     * Сохраняет загруженную фотографию в сообщениях
     * @param photo Идентификатор фотографии
     * @param server Идентификатор сервера
     * @param hash Хэш-сумма фотографии
     * @returns Информация о сохраненной фотографии или null при ошибке
     */
    public async photosSaveMessagesPhoto(
        photo: string,
        server: string,
        hash: string,
    ): Promise<IVkPhotosSave[] | null> {
        this._request.post = {
            photo,
            server,
            hash,
        };
        return (await this.call<IVkPhotosSave>(
            'photos.saveMessagesPhoto',
        )) as unknown as IVkPhotosSave[];
    }

    /**
     * Получает URL для загрузки документов в сообщения
     * @param peerId ID получателя сообщения
     * @param type Тип документа:
     * - 'doc': обычный документ (PDF, ZIP и т.д.)
     * - 'audio_message': голосовое сообщение
     * - 'graffiti': граффити
     * @returns Данные для загрузки или null при ошибке
     *
     * @example
     * ```ts
     * // Загрузка обычного документа
     * const server = await vk.docsGetMessagesUploadServer(12345, 'doc');
     *
     * // Загрузка голосового сообщения
     * const server = await vk.docsGetMessagesUploadServer(12345, 'audio_message');
     *
     * // Загрузка граффити
     * const server = await vk.docsGetMessagesUploadServer(12345, 'graffiti');
     * ```
     */
    public async docsGetMessagesUploadServer(
        peerId: TVkPeerId,
        type: TVkDocType,
    ): Promise<IVkUploadServer | null> {
        this._request.post = {
            peer_id: peerId,
            type,
        };
        return this.call<IVkUploadServer>('docs.getMessagesUploadServer');
    }

    /**
     * Сохраняет загруженный документ
     * @param file Идентификатор документа
     * @param title Название документа
     * @param tags Теги документа
     * @returns Информация о сохраненном документе или null при ошибке
     */
    public async docsSave(
        file: string,
        title: string,
        tags: string | null = null,
    ): Promise<IVkDocSave | null> {
        this._request.post = {
            file,
            title,
        };
        if (tags) {
            this._request.post.tags = tags;
        }
        return this.call<IVkDocSave>('docs.save');
    }

    /**
     * Подтверждение получения callback-события от кнопки.
     * Обязательный метод для обработки message_event в VK Bot API.
     * Без этого вызова VK показывает пользователю "Бот недоступен" при нажатии callback-кнопки.
     *
     * @param userId ID пользователя
     * @param eventId ID события из message_event
     * @param eventData Данные события (опционально): show_snackbar, open_link или open_modal
     * @param peerId ID диалога из message_event. Для обратной совместимости используется userId
     * @returns Результат выполнения или null при ошибке
     *
     * @example
     * ```ts
     * // Простое подтверждение
     * await vkApi.sendMessageEvent(userId, eventId);
     *
     * // С показом всплывающего уведомления
     * await vkApi.sendMessageEvent(userId, eventId, {
     *     type: 'show_snackbar',
     *     text: 'Действие выполнено!'
     * });
     * ```
     */
    public async sendMessageEvent(
        userId: TVkPeerId,
        eventId: string,
        eventData?: {
            type: 'show_snackbar' | 'open_link' | 'open_modal';
            text?: string;
            link?: string;
            Intent?: string;
            title?: string;
        },
        peerId?: TVkPeerId,
    ): Promise<IVKSendMessage | null> {
        const numericUserId = Number(userId);
        const numericPeerId = Number(peerId ?? userId);
        if (!Number.isSafeInteger(numericUserId) || !Number.isSafeInteger(numericPeerId)) {
            this._appContext.logWarn(
                'VkRequest.sendMessageEvent(): user_id и peer_id должны быть целыми числовыми ID.',
            );
            return null;
        }
        this._request.post = {
            user_id: numericUserId,
            event_id: eventId,
            peer_id: numericPeerId,
        };
        if (eventData) {
            const serializedEventData = JSON.stringify(eventData);
            if (serializedEventData.length > 1000) {
                this._appContext.logWarn(
                    'VkRequest.sendMessageEvent(): event_data превышает лимит VK в 1000 символов.',
                );
                return null;
            }
            this._request.post.event_data = serializedEventData;
        }
        return this.call<IVKSendMessage>('messages.sendMessageEventAnswer');
    }

    /**
     * Генерирует уникальный ID для избежания повторной отправки сообщения.
     * VK API ограничивает random_id диапазоном int32 (-2^31 .. 2^31-1).
     */
    #generateRandomId(): number {
        // 2^31 - 1 = 2 147 483 647 — верхняя граница int32
        return Math.floor(Math.random() * 2_147_483_647);
    }

    /**
     * Пишет информацию об ошибках через AppContext.logError (структурированный логгер)
     * @param error Текст или объект ошибки для логирования
     */
    protected _log(error: Error | string = ''): void {
        this._appContext.logError(getErrorMsg(error, 'VkRequest', this._request.url), {
            error: this._error,
        });
    }
}
