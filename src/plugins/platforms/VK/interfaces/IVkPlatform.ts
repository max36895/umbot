/**
 * Интерфейсы для работы с VK.
 * Определяют структуру данных для взаимодействия с VK Bot API
 *
 * Основные компоненты:
 * - Сообщения (IVkMessage)
 * - Информация о клиенте (IVkClientInfo)
 * - Объекты запросов (IVkRequestObject)
 * - Обновления (IVkRequestContent)
 */

/**
 * Сообщение VK.
 * Содержит информацию о входящем или исходящем сообщении
 */
export interface IVkMessage {
    /**
     * Дата отправки сообщения в формате Unix timestamp
     */
    date?: number;
    /**
     * ID отправителя сообщения
     */
    from_id: number;
    /**
     * ID сообщения
     */
    id: number;
    /**
     * Тип сообщения
     * 0 - входящее
     * 1 - исходящее
     */
    out?: number;
    /**
     * ID беседы или пользователя
     */
    peer_id?: number;
    /**
     * Текст сообщения
     */
    text: string;
    /**
     * ID сообщения в беседе
     */
    conversation_message_id?: number;
    /**
     * Массив пересланных сообщений
     */
    fwd_messages?: string[];
    /**
     * Является ли сообщение важным
     */
    important?: boolean;
    /**
     * Уникальный идентификатор сообщения (int32)
     */
    random_id?: number;
    /**
     * Вложения (фото, видео, документы и т.д.)
     */
    attachments?: Record<string, unknown>;
    /**
     * Скрыто ли сообщение
     */
    is_hidden?: boolean;
    /**
     * Дополнительные данные
     */
    payload?: Record<string, unknown>;
    /**
     * Параметр `ref` ссылки `vk.me/<сообщество>?ref=...`: приходит в сообщении,
     * которое пользователь отправил после перехода по ссылке
     */
    ref?: string;
    /**
     * Параметр `ref_source` той же ссылки
     */
    ref_source?: string;
}

/**
 * Информация о клиенте.
 * Содержит данные о возможностях клиента
 */
export interface IVkClientInfo {
    /**
     * Поддерживаемые действия с кнопками
     */
    button_actions: string[];
    /**
     * Поддерживает ли клиент клавиатуру
     */
    keyboard: boolean;
    /**
     * Поддерживает ли клиент inline-клавиатуру
     */
    inline_keyboard: boolean;
    /**
     * ID языка клиента
     */
    lang_id: number;
}

/**
 * Объект запроса VK.
 * Содержит информацию о сообщении и клиенте.
 * Для события message_event объект не содержит поля message (только payload/user_id и т.п.)
 */
export interface IVkRequestObject {
    /**
     * Информация о сообщении. Отсутствует для событий без текста
     * сообщения (например, `message_event` — callback-кнопка)
     */
    message?: IVkMessage;
    /**
     * Информация о клиенте
     */
    clientInfo?: IVkClientInfo;

    /**
     * Идентификатор пользователя.
     */
    user_id?: number;
    /**
     * Идентификатор диалога со стороны бота. Присутствует только в событии
     * `message_event` (callback-кнопка); в `message_new` peer_id лежит в
     * `object.message.peer_id`, а не здесь.
     */
    peer_id?: number;
    /**
     * Случайная строка. Активна в течение минуты, спустя минуту становится недействительной.
     */
    event_id?: string;
    /**
     * Дополнительная информация, указанная в клавише.
     */
    payload: Record<string, unknown> | string;
    /**
     * Идентификатор сообщения в беседе. Не передаётся для клавиатур беседы.
     */
    conversation_message_id?: number;
}

/**
 * Обновление от VK.
 * Содержит информацию о типе события и связанных данных
 */
export interface IVkRequestContent {
    /**
     * Тип события (message_new, message_event и т.д.)
     */
    type: string;
    /**
     * Объект запроса с данными
     */
    object?: IVkRequestObject;
    /**
     * ID группы
     */
    group_id?: string;
    /**
     * ID события
     */
    event_id?: string;
    /**
     * Секретный ключ для проверки подписи
     */
    secret?: string;
}

/**
 * @interface IVkButtonObject
 * Интерфейс для объекта, содержащего коллекцию кнопок VK.
 *
 * Используется для создания клавиатуры с кнопками в VK.
 *
 * @example
 * ```ts
 * const keyboard: IVkButtonObject = {
 *     one_time: false,
 *     buttons: [
 *         [{
 *             action: {
 *                 type: 'text',
 *                 label: 'Нажми меня'
 *             },
 *             color: 'primary'
 *         }]
 *     ]
 * };
 * ```
 */
export interface IVkButtonObject {
    /**
     * Определяет, будет ли клавиатура скрыта после нажатия на кнопку.
     * true - клавиатура скроется после нажатия
     * false - клавиатура останется видимой
     * @example
     * ```ts
     * const keyboard: IVkButtonObject = {
     *     one_time: true, // Клавиатура скроется после нажатия
     *     buttons: [...]
     * };
     * ```
     */
    one_time: boolean;

    /**
     * Массив кнопок или массив массивов кнопок.
     * Каждый внутренний массив представляет собой строку кнопок.
     * @example
     * ```ts
     * const keyboard: IVkButtonObject = {
     *     one_time: false,
     *     buttons: [
     *         // Первая строка кнопок
     *         [{
     *             action: { type: 'text', label: 'Кнопка 1' },
     *             color: 'primary'
     *         }],
     *         // Вторая строка кнопок
     *         [{
     *             action: { type: 'text', label: 'Кнопка 2' },
     *             color: 'secondary'
     *         }]
     *     ]
     * };
     * ```
     */
    buttons: IVkButton[] | IVkButton[][];
}

/**
 * @interface IVkButtonAction
 * Интерфейс для действия кнопки VK.
 *
 * Определяет тип действия, которое будет выполнено при нажатии на кнопку.
 *
 * @example
 * ```ts
 * // Текстовая кнопка
 * const textAction: IVkButtonAction = {
 *     type: 'text',
 *     label: 'Нажми меня'
 * };
 *
 * // Кнопка-ссылка
 * const linkAction: IVkButtonAction = {
 *     type: 'open_link',
 *     link: 'http://localhost',
 *     label: 'Перейти на сайт'
 * };
 * ```
 */
export interface IVkButtonAction {
    /**
     * Тип действия кнопки.
     * Возможные значения:
     * - text - текстовая кнопка
     * - open_link - кнопка-ссылка
     * - location - кнопка геолокации
     * - vkpay - кнопка оплаты
     * - open_app - кнопка открытия приложения
     * @example
     * ```ts
     * const action: IVkButtonAction = {
     *     type: 'text',
     *     label: 'Нажми меня'
     * };
     * ```
     */
    type?: string;

    /**
     * URL для перехода при нажатии на кнопку.
     * Используется только для кнопок типа open_link.
     * @example
     * ```ts
     * const action: IVkButtonAction = {
     *     type: 'open_link',
     *     link: 'http://localhost',
     *     label: 'Перейти на сайт'
     * };
     * ```
     */
    link?: string;

    /**
     * Текст, отображаемый на кнопке.
     * @example
     * ```ts
     * const action: IVkButtonAction = {
     *     type: 'text',
     *     label: 'Нажми меня'
     * };
     * ```
     */
    label?: string | null;

    /**
     * Дополнительные данные, передаваемые при нажатии на кнопку.
     * Могут быть строкой или объектом.
     * @example
     * ```ts
     * const action: IVkButtonAction = {
     *     type: 'text',
     *     label: 'Добавить в корзину',
     *     payload: {
     *         action: 'add_to_cart',
     *         productId: 123
     *     }
     * };
     * ```
     */
    payload?: string | object;

    /**
     * Хеш оплаты для кнопки vkpay.
     * По документации VK API поле hash у vkpay-кнопки находится именно внутри action,
     * а не на верхнем уровне объекта кнопки.
     * @example
     * ```ts
     * const action: IVkButtonAction = {
     *     type: 'vkpay',
     *     hash: 'action=pay-to-group&group_id=1'
     * };
     * ```
     */
    hash?: string;
}

/**
 * @interface IVkButton
 * Интерфейс для кнопки VK.
 *
 * Определяет структуру кнопки и её визуальное представление.
 *
 * @example
 * ```ts
 * const button: IVkButton = {
 *     action: {
 *         type: 'text',
 *         label: 'Нажми меня',
 *         payload: { action: 'click' }
 *     },
 *     color: 'primary'
 * };
 * ```
 */
export interface IVkButton {
    /**
     * Действие кнопки.
     * Определяет тип действия и его параметры.
     * @example
     * ```ts
     * const button: IVkButton = {
     *     action: {
     *         type: 'text',
     *         label: 'Нажми меня'
     *     }
     * };
     * ```
     */
    action: IVkButtonAction;

    /**
     * Цвет кнопки.
     * Возможные значения:
     * - primary - основная кнопка (синяя)
     * - secondary - вторичная кнопка (белая)
     * - negative - отрицательная кнопка (красная)
     * - positive - положительная кнопка (зеленая)
     * @example
     * ```ts
     * const button: IVkButton = {
     *     action: { type: 'text', label: 'Нажми меня' },
     *     color: 'primary'
     * };
     * ```
     */
    color?: string;

    /**
     * Хеш кнопки.
     * @deprecated VK API принимает hash только внутри action (см. {@link IVkButtonAction.hash}).
     * Поле оставлено для обратной совместимости типов, фреймворк его больше не заполняет.
     * @example
     * ```ts
     * const button: IVkButton = {
     *     action: { type: 'vkpay', hash: 'abc123' }
     * };
     * ```
     */
    hash?: string | null;

    /**
     * Не используется: VK принимает payload только внутри action
     * (см. {@link IVkButtonAction.payload}); фреймворк это поле не заполняет.
     * Поле планируется убрать из интерфейса (в VK API его нет).
     */
    payload?: Record<string, unknown>;

    /**
     * Значение группы из button.options._group, по которому адаптер
     * группирует кнопки в ряды: все кнопки с одинаковой группой попадают
     * в одну строку клавиатуры. Из результирующей VK-кнопки поле удаляется.
     * @example
     * ```ts
     * const button: IVkButton = {
     *     action: { type: 'text', label: 'Нажми меня' },
     *     _group: '1'
     * };
     * ```
     */
    _group?: string;
}

/**
 * @interface IVkCardElement
 * Интерфейс для элемента карточки ВКонтакте.
 * Определяет структуру отдельного элемента в карусели или галерее.
 *
 * Особенности:
 * - Поддерживает заголовок и описание
 * - Может содержать до 3 кнопок
 * - Поддерживает различные типы действий
 * - Требует ID фотографии из ВКонтакте
 *
 * @example
 * ```ts
 * // Создание элемента карточки с кнопками
 * const element: IVkCardElement = {
 *     title: 'Название товара',
 *     description: 'Описание товара',
 *     photo_id: '123456789',
 *     buttons: [
 *         { action: { type: 'text', label: 'Купить' } },
 *         { action: { type: 'link', link: 'http://localhost' } }
 *     ],
 *     action: { type: 'open_photo' }
 * };
 *
 * // Создание простого элемента карточки
 * const simpleElement: IVkCardElement = {
 *     title: 'Фотография',
 *     description: 'Описание фотографии',
 *     photo_id: '987654321'
 * };
 * ```
 */
export interface IVkCardElement {
    /**
     * Заголовок элемента карточки.
     * Отображается в верхней части элемента.
     *
     * Особенности:
     * - Рекомендуемая длина: до 80 символов
     * - Поддерживает эмодзи
     * - Отображается жирным шрифтом
     *
     * @example
     * ```ts
     * title: 'Название товара'
     * title: '🔥 Горячее предложение'
     * ```
     */
    title: string;

    /**
     * Описание элемента карточки.
     * Отображается под заголовком.
     *
     * Особенности:
     * - Рекомендуемая длина: до 80 символов (лимит VK для карусели)
     * - Поддерживает переносы строк
     * - Может содержать ссылки
     *
     * @example
     * ```ts
     * description = 'Цена: 1000 руб.\nДоставка: бесплатно'
     * ```
     */
    description: string;

    /**
     * Идентификатор изображения в ВКонтакте.
     * Формат: строка без префикса 'photo'.
     *
     * Особенности:
     * - Должен быть валидным ID фотографии
     * - Фотография должна быть загружена в ВКонтакте
     * - Поддерживает различные форматы изображений
     *
     * @example
     * ```ts
     * photo_id: '123456789'
     * photo_id: '987654321_456789'
     * ```
     */
    photo_id: string;

    /**
     * Массив кнопок для элемента карточки.
     * Максимальное количество кнопок - 3.
     *
     * Особенности:
     * - Поддерживает различные типы кнопок
     * - Каждая кнопка может иметь свое действие
     * - Кнопки отображаются в нижней части карточки
     *
     * @example
     * ```ts
     * // Кнопки с разными действиями
     * buttons: [
     *     { action: { type: 'text', label: 'Купить' } },
     *     { action: { type: 'link', link: 'http://localhost' } },
     *     { action: { type: 'callback', label: 'Подробнее' } }
     * ]
     *
     * // Одна кнопка
     * buttons: [
     *     { action: { type: 'text', label: 'Подробнее' } }
     * ]
     * ```
     */
    buttons?: IVkButton[];

    /**
     * Действие, происходящее при нажатии на элемент карточки.
     *
     * Особенности:
     * - Определяет поведение при клике на карточку
     * - Может открывать фотографию или выполнять другие действия
     * - Работает независимо от кнопок
     *
     * @example
     * ```ts
     * // Открыть фотографию
     * action: { type: 'open_photo' }
     *
     * // Выполнить действие
     * action: { type: 'callback' }
     * ```
     */
    action?: {
        /**
         * Тип действия.
         */
        type: string;
    };
}

/**
 * @interface IVkCard
 * Интерфейс для карточки ВКонтакте.
 * Определяет структуру карточки, которая может быть каруселью или галереей.
 * Фактически адаптер отправляет type='carousel' (галерея изображений — тоже carousel).
 *
 * Особенности:
 * - Поддерживает два типа карточек: карусель и галерея
 * - Может содержать множество элементов
 * - Элементы могут иметь кнопки и действия
 * - Поддерживает различные форматы изображений
 *
 * @example
 * ```ts
 * // Создание карусели с товарами
 * const carousel: IVkCard = {
 *     type: 'carousel',
 *     elements: [
 *         {
 *             title: 'Товар 1',
 *             description: 'Описание 1',
 *             photo_id: '123456789',
 *             buttons: [{ action: { type: 'text', label: 'Купить' } }]
 *         },
 *         {
 *             title: 'Товар 2',
 *             description: 'Описание 2',
 *             photo_id: '987654321',
 *             buttons: [{ action: { type: 'text', label: 'Купить' } }]
 *         }
 *     ]
 * };
 *
 * // Создание галереи фотографий (галерея тоже уходит как carousel)
 * const gallery: IVkCard = {
 *     type: 'carousel',
 *     elements: [
 *         {
 *             title: 'Фото 1',
 *             description: 'Описание 1',
 *             photo_id: '123456789',
 *             action: { type: 'open_photo' }
 *         },
 *         {
 *             title: 'Фото 2',
 *             description: 'Описание 2',
 *             photo_id: '987654321',
 *             action: { type: 'open_photo' }
 *         }
 *     ]
 * };
 * ```
 */
export interface IVkCard {
    /**
     * Тип карточки.
     * Единственное значение в VK API — 'carousel'; значения 'gallery'
     * в API нет, и фактически адаптер всегда отправляет type='carousel'
     * (галерея изображений тоже уходит каруселью).
     *
     * Особенности:
     * - Карусель: элементы можно листать горизонтально
     *
     * @example
     * ```ts
     * // Карусель товаров
     * type: 'carousel'
     * ```
     */
    type: string;

    /**
     * Массив элементов карточки.
     * Каждый элемент представляет собой отдельную карточку в карусели.
     *
     * Особенности:
     * - Может содержать множество элементов
     * - Каждый элемент имеет свои настройки
     * - Элементы отображаются в зависимости от типа карточки
     *
     * @example
     * ```ts
     * // Элементы карусели
     * elements: [
     *     { title: 'Товар 1', description: 'Описание 1', photo_id: '123456789' },
     *     { title: 'Товар 2', description: 'Описание 2', photo_id: '987654321' }
     * ]
     *
     * // Элементы галереи
     * elements: [
     *     { title: 'Фото 1', description: 'Описание 1', photo_id: '123456789' },
     *     { title: 'Фото 2', description: 'Описание 2', photo_id: '987654321' }
     * ]
     * ```
     */
    elements: IVkCardElement[];
}
