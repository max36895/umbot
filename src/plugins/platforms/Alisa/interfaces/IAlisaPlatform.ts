/**
 * Интерфейсы для работы с Алисой.
 * Определяют структуру данных для взаимодействия с API Алисы
 *
 * Основные компоненты:
 * - Запросы (IAlisaWebhookRequest)
 * - Ответы (IAlisaWebhookResponse)
 * - Сессии (IAlisaSession)
 * - Состояния (IAlisaRequestState)
 * - Компоненты интерфейса (кнопки, карточки, изображения)
 */
import { INlu, IPlatformData } from '../../../../index';

/**
 * Интерфейс для именованных сущностей в запросе.
 * Используется для извлечения структурированных данных из текста пользователя
 */
export interface IAlisaEntities {
    /**
     * Позиция сущности в массиве слов
     * Нумерация начинается с 0
     */
    tokens?: {
        /**
         * Индекс первого слова сущности
         */
        start: number;
        /**
         * Индекс первого слова после сущности
         */
        end: number;
    };

    /**
     * Тип именованной сущности
     * Поддерживаемые типы:
     * - YANDEX.DATETIME: дата и время
     * - YANDEX.FIO: фамилия, имя, отчество
     * - YANDEX.GEO: местоположение
     * - YANDEX.NUMBER: число
     */
    type: string;

    /**
     * Значение сущности
     * Формат зависит от типа сущности:
     * - YANDEX.DATETIME: { year: number, month: number, day: number, ... }
     * - YANDEX.FIO: { first_name: string, last_name: string, ... }
     * - YANDEX.GEO: { country: string, city: string, ... }
     * - YANDEX.NUMBER: number
     *
     * @example
     * ```ts
     * // Для YANDEX.DATETIME
     * value: { year: 2024, month: 3, day: 15 }
     *
     * // Для YANDEX.FIO
     * value: { first_name: "Иван", last_name: "Иванов" }
     *
     * // Для YANDEX.GEO
     * value: { country: "Россия", city: "Москва" }
     *
     * // Для YANDEX.NUMBER
     * value: 42
     * ```
     */
    value: object | number;
}

/**
 * Интерфейс для обработки естественного языка (NLU)
 * Содержит результаты анализа текста пользователя
 */
export interface IAlisaNlu extends INlu {
    /**
     * Массив слов из фразы пользователя
     */
    tokens?: string[];
    /**
     * Массив найденных именованных сущностей
     */
    entities?: IAlisaEntities[];
}

/**
 * Интерфейс для данных сессии.
 * Содержит информацию о текущем диалоге с пользователем
 */
export interface IAlisaSession {
    /**
     * Признак новой сессии
     * true - начало нового диалога
     * false - продолжение существующего диалога
     */
    new: boolean;

    /**
     * ID сообщения в сессии.
     * Числовой счётчик, увеличивается с каждым запросом
     */
    message_id: number;

    /**
     * Уникальный ID сессии
     * Максимум 64 символа
     */
    session_id: string;

    /**
     * ID навыка
     * Присваивается при создании навыка
     */
    skill_id: string;

    /**
     * ID пользователя
     * Максимум 64 символа
     * Уникален для пары "приложение-пользователь"
     */
    user_id?: string;

    /**
     * Данные авторизованного пользователя.
     * Присутствует только если пользователь авторизован
     */
    user?: {
        /**
         * ID пользователя Яндекса
         * Уникален для пары "пользователь-навык"
         */
        user_id: string;

        /**
         * OAuth токен для авторизации.
         * Используется для связки аккаунтов
         */
        access_token: string;
    };

    /**
     * Данные о приложении
     */
    application?: {
        /**
         * ID экземпляра приложения
         * Максимум 64 символа
         * Уникален для пары "приложение-навык"
         */
        application_id: string;
    };
}

/**
 * Интерфейс для состояния приложения.
 * Определяет, где хранятся данные:
 * - session: данные сессии
 * - user: данные пользователя
 * - application: данные приложения
 */
export interface IAlisaRequestState {
    /**
     * Данные сессии
     */
    session?: Record<string, unknown>;
    /**
     * Данные пользователя
     */
    user?: Record<string, unknown>;
    /**
     * Данные приложения
     */
    application?: Record<string, unknown>;
}

/**
 * Интерфейс для метаданных запроса.
 * Содержит информацию об устройстве и окружении
 */
export interface IAlisaRequestMeta {
    /**
     * Язык в POSIX-формате (макс. 64 символа)
     */
    locale: string;
    /**
     * Часовой пояс (макс. 64 символа)
     */
    timezone: string;
    /**
     * ID устройства и приложения (макс. 1024 символа)
     */
    client_id: string;

    /**
     * Доступные интерфейсы устройства
     */
    interfaces: {
        /**
         * Поддержка экрана и браузера
         */
        screen?: object;
        /**
         * Поддержка платежей
         */
        payments?: object | null;
        /**
         * Поддержка связки аккаунтов
         */
        account_linking: object | null;
    };
}

/**
 * Интерфейс для данных запроса.
 * Содержит информацию о сообщении пользователя
 */
export interface IAlisaRequest {
    /**
     * Обработанный текст запроса
     * Очищен от знаков препинания
     * Числа преобразованы в числовой формат
     */
    command: string;

    /**
     * Исходный текст запроса
     * Максимум 1024 символа
     */
    original_utterance: string;

    /**
     * Тип ввода
     * - SimpleUtterance: голосовой ввод
     * - ButtonPressed: нажатие кнопки
     */
    type: 'SimpleUtterance' | 'ButtonPressed';

    /**
     * Характеристики реплики
     */
    markup?: {
        /**
         * Признак криминального подтекста
         * true: содержит угрозы, самоубийство и т.д.
         */
        dangerous_context?: boolean;
    };

    /**
     * Данные с нажатой кнопки
     * Максимум 4096 байт
     */
    payload?: Record<string, unknown> | string;

    /**
     * Результаты анализа текста
     * Содержит:
     * - tokens: массив слов из фразы
     * - entities: найденные именованные сущности
     * - intents: распознанные намерения
     *
     * @example
     * ```ts
     * nlu: {
     *     tokens: ["завтра", "в", "15", "часов"],
     *     entities: [{
     *         type: "YANDEX.DATETIME",
     *         value: { day: 1, day_is_relative: true, hour: 15 }
     *     }],
     *     intents: {
     *         "YANDEX.CONFIRM": { slots: [] }
     *     }
     * }
     * ```
     */
    nlu?: IAlisaNlu;
}

/**
 * Интерфейс для webhook-запроса.
 * Полный формат входящего запроса от Алисы
 */
export interface IAlisaWebhookRequest {
    /**
     * Метаданные устройства
     */
    meta: IAlisaRequestMeta;
    /**
     * Данные запроса пользователя
     */
    request: IAlisaRequest;
    /**
     * Данные сессии
     */
    session: IAlisaSession;
    /**
     * Событие связки аккаунтов
     */
    account_linking_complete_event?: boolean;
    /**
     * Состояние приложения
     */
    state?: IAlisaRequestState;
    /**
     * Версия протокола (текущая: 1.0)
     */
    version: string;
}

/**
 * Интерфейс для кнопки.
 * Определяет внешний вид и поведение кнопки
 */
export interface IAlisaButton {
    /**
     * Текст кнопки
     * Максимум 64 символа
     * Отправляется как команда при нажатии
     */
    title?: string;

    /**
     * Данные для обработчика
     * Максимум 4096 байт
     */
    payload?: Record<string, unknown> | string;

    /**
     * URL для перехода
     * Максимум 1024 байта
     */
    url?: string;

    /**
     * Скрывать после нажатия
     * @defaultValue false
     */
    hide?: boolean;
}

/**
 * Интерфейс для кнопки на карточке.
 * Определяет поведение при нажатии на изображение
 */
export interface IAlisaButtonCard {
    /**
     * Команда при нажатии
     * Максимум 64 символа
     */
    text?: string;

    /**
     * Данные для обработчика
     * Максимум 4096 байт
     */
    payload?: Record<string, unknown> | string;

    /**
     * URL для перехода
     * Максимум 1024 байта
     */
    url?: string;
}

/**
 * Базовый интерфейс для изображения.
 * Определяет общие свойства для всех типов карточек
 */
export interface IAlisaImage {
    /**
     * Тип карточки
     * - BigImage: одно изображение
     * - ItemsList: список изображений (1-5)
     * - ImageGallery: галерея (1-10)
     */
    type?: string;

    /**
     * ID изображения. Опционален для элементов ItemsList и ImageGallery
     * (элемент без image_id отображается как текстовый), но обязателен
     * для BigImage — без токена адаптер отбрасывает карточку.
     */
    image_id?: string;

    /**
     * Заголовок
     * Максимум 128 символов
     * В ItemsList — заголовок элемента; для ImageGallery платформа не отрисовывает
     * заголовок, но адаптер всегда отправляет title и в элементах галереи
     */
    title: string;

    /**
     * Описание
     * Максимум 256 символов
     * Заполняется для BigImage и элементов ItemsList; игнорируется для ImageGallery
     */
    description?: string;

    /**
     * Свойства при нажатии.
     * Заполняется для BigImage и элементов ItemsList; игнорируется для ImageGallery
     */
    button?: IAlisaButtonCard;
}

/**
 * Интерфейс для большого изображения
 * Одно изображение с заголовком и описанием
 */
export interface IAlisaBigImage extends IAlisaImage {
    /**
     * Тип карточки
     */
    type: 'BigImage';
}

/**
 * Интерфейс для списка изображений
 * От 1 до 5 изображений с заголовком
 */
export interface IAlisaItemsList {
    /**
     * Тип карточки
     */
    type: 'ItemsList';

    /**
     * Заголовок списка
     */
    header?: {
        /**
         * Текст заголовка (макс. 64 символа)
         */
        text: string;
    };

    /**
     * Изображения
     * От 1 до 5 элементов
     */
    items?: IAlisaImage[];

    /**
     * Кнопка под списком
     */
    footer?: {
        /**
         * Текст кнопки (макс. 64 символа)
         */
        text: string;
        /**
         * Свойства кнопки
         */
        button?: IAlisaButtonCard;
    };
}

/**
 * Интерфейс для галереи изображений
 * От 1 до 10 изображений
 */
export interface IAlisaImageGallery {
    /**
     * Тип карточки
     */
    type: 'ImageGallery';

    /**
     * Изображения
     * От 1 до 10 элементов
     */
    items?: IAlisaImage[];
}

/**
 * Интерфейс для ответа навыка.
 * Определяет формат ответа пользователю
 */
export interface IAlisaResponse {
    /**
     * Текст ответа
     * Максимум 1024 символа
     */
    text: string;

    /**
     * Текст для озвучивания
     * Максимум 1024 символа
     * Поддерживает собственную разметку Алисы и звуки:
     * - <speaker audio="...">: вставка звука
     * - <speaker effect="...">: наложение звукового эффекта
     * - sil <[мс]>: пауза заданной длительности
     *
     * @example
     * ```ts
     * // Простой текст
     * tts: "Привет как дела?"
     *
     * // Со стандартным звуком
     * tts: 'Слушайте <speaker audio="alice-sounds-game-win-1.opus">'
     *
     * // С паузой
     * tts: "Привет! sil <[500]> Как дела?"
     * ```
     */
    tts?: string;

    /**
     * Карточка с изображением
     * Отправляется вместе с текстом ответа
     * Поддерживает три типа:
     * - BigImage: одно изображение с заголовком и описанием
     * - ItemsList: список из 1-5 изображений
     * - ImageGallery: галерея из 1-10 изображений
     *
     * @example
     * ```ts
     * // Одно изображение
     * card: {
     *     type: "BigImage",
     *     image_id: "123456",
     *     title: "Заголовок",
     *     description: "Описание",
     *     button: {
     *         text: "Подробнее",
     *         url: "http://localhost"
     *     }
     * }
     *
     * // Список изображений
     * card: {
     *     type: "ItemsList",
     *     header: { text: "Список" },
     *     items: [
     *         { title: "Изображение 1", image_id: "1" },
     *         { title: "Изображение 2", image_id: "2" }
     *     ],
     *     footer: {
     *         text: "Ещё",
     *         button: { text: "Показать" }
     *     }
     * }
     *
     * // Галерея
     * card: {
     *     type: "ImageGallery",
     *     items: [
     *         { title: "Изображение 1", image_id: "1" },
     *         { title: "Изображение 2", image_id: "2" }
     *     ]
     * }
     * ```
     */
    card?: IAlisaBigImage | IAlisaItemsList | IAlisaImageGallery;

    /**
     * Кнопки
     * Отображаются после ответа
     */
    buttons?: IAlisaButton[] | null;

    /**
     * Директивы платформы, выполняемые вместе с ответом пользователю.
     */
    directives?: {
        /**
         * Запустить связку аккаунтов.
         */
        start_account_linking?: object;
    };

    /**
     * Завершить сессию
     * true: завершить диалог
     * false: продолжить диалог
     */
    end_session: boolean;
}

/**
 * Интерфейс для webhook-ответа.
 * Полный формат исходящего ответа для Алисы
 */
export interface IAlisaWebhookResponse {
    /**
     * Ответ пользователю
     */
    response?: IAlisaResponse;
    /**
     * Данные сессии
     */
    session_state?: IPlatformData;
    /**
     * Данные приложения
     */
    application_state?: IPlatformData;
    /**
     * Данные пользователя
     */
    user_state_update?: IPlatformData;
    /**
     * Версия протокола (текущая: 1.0)
     */
    version: string;
    /**
     * Устаревшее расположение директивы авторизации.
     * @deprecated Используйте `response.directives.start_account_linking`.
     */
    start_account_linking?: object;
}
