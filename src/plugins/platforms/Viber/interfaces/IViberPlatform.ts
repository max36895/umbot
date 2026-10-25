/**
 * Интерфейсы для работы с Viber.
 * Определяют структуру данных для взаимодействия с Viber Bot API
 *
 * Основные компоненты:
 * - Пользователи (IViberUser)
 * - Сообщения (IViberMessage)
 * - Обновления (IViberContent)
 */

/**
 * Информация о пользователе Viber
 */
export interface IViberUser {
    /**
     * Уникальный идентификатор пользователя
     */
    id: string;
    /**
     * Имя пользователя
     */
    name: string;
    /**
     * URL аватара пользователя
     */
    avatar?: string;
    /**
     * Код страны (2 буквы)
     */
    country?: string;
    /**
     * Язык устройства пользователя
     */
    language?: string;
    /**
     * Максимальная поддерживаемая версия Viber API
     */
    api_version: number;
}

/**
 * Сообщение Viber.
 * Поддерживает различные типы контента: текст, медиа, местоположение, контакты
 */
export interface IViberMessage {
    /**
     * Тип сообщения (text, picture, video, file, location, contact, sticker)
     */
    type: string;
    /**
     * Текст сообщения
     */
    text: string;
    /**
     * URL медиа-контента
     * Поддерживает: изображения, видео, файлы
     * TTL: 1 час
     */
    media?: string;
    /**
     * Координаты местоположения
     * Используется при type='location'
     */
    location?: {
        /**
         * Широта
         */
        lat: number;
        /**
         * Долгота
         */
        lon: number;
    };
    /**
     * Информация о контакте.
     * Используется при type='contact'
     */
    contact?: {
        /**
         * Имя контакта
         */
        name: string;
        /**
         * Номер телефона
         */
        phone_number: string;
        /**
         * URL аватара
         */
        avatar: string;
    };
    /**
     * Данные для отслеживания
     */
    tracking_data?: string;
    /**
     * Имя файла
     * Используется при type='file'
     */
    file_name?: string;
    /**
     * Размер файла в байтах.
     * Используется при type='file'
     */
    file_size?: number;
    /**
     * Длительность видео в секундах.
     * Используется при type='video'
     */
    duration?: number;
    /**
     * ID стикера
     * Используется при type='sticker'
     */
    sticker_id?: number;
}

/**
 * Обновление от Viber.
 * Содержит информацию о событии и связанных данных
 */
export interface IViberContent {
    /**
     * Тип события
     * Определяет, какое событие вызвало обратный вызов
     */
    event: string;
    /**
     * Время события в формате Unix timestamp
     */
    timestamp?: number;
    /**
     * Уникальный идентификатор сообщения
     */
    message_token?: number;
    /**
     * Информация об отправителе
     * Для event='message' содержит данные отправителя сообщения
     */
    sender?: IViberUser;
    /**
     * Информация о пользователе
     * Для событий conversation_started / subscribed / unsubscribed
     * содержит данные пользователя; для event='message' отправитель — в поле sender
     */
    user?: IViberUser;
    /**
     * Информация о сообщении
     */
    message?: IViberMessage;
    /**
     * Параметр `context` ссылки `viber://pa?chatURI=<бот>&context=...`
     * (только в conversation_started; без параметра в ссылке поля нет)
     */
    context?: string;
}

/**
 * @interface IViberButton
 * Интерфейс для кнопки Viber.
 *
 * Определяет структуру и визуальное представление кнопки в Viber.
 *
 * @example
 * ```ts
 * const button: IViberButton = {
 *     Columns: 6,
 *     Rows: 1,
 *     ActionType: 'reply',
 *     ActionBody: 'button_click',
 *     Text: 'Нажми меня',
 *     TextSize: 'regular',
 *     TextVAlign: 'middle',
 *     TextHAlign: 'center',
 *     Image: 'http://localhost/button.png'
 * };
 * ```
 */
export interface IViberButton {
    /**
     * Количество колонок, которые занимает кнопка.
     * Span по ширине в сетке ButtonsGroupColumns (1–6).
     * @example
     * ```ts
     * const button: IViberButton = {
     *     Columns: 6, // Кнопка занимает всю ширину
     *     Text: 'Нажми меня'
     * };
     * ```
     */
    Columns?: number;

    /**
     * Количество строк, которые занимает кнопка.
     * Span по высоте в сетке ButtonsGroupRows (1–7).
     * @example
     * ```ts
     * const button: IViberButton = {
     *     Rows: 2, // Кнопка занимает две строки
     *     Text: 'Нажми меня'
     * };
     * ```
     */
    Rows?: number;

    /**
     * Тип действия кнопки.
     * Возможные значения:
     * - reply - отправка сообщения
     * - open-url - открытие URL
     * - share-phone - поделиться номером телефона
     * - location-picker - выбор местоположения
     * - none - ячейка без действия (текстовые ячейки карточек rich_media, T_NONE)
     * @example
     * ```ts
     * const button: IViberButton = {
     *     ActionType: 'reply',
     *     ActionBody: 'button_click',
     *     Text: 'Нажми меня'
     * };
     * ```
     */
    ActionType?: string;

    /**
     * Данные, которые будут отправлены при нажатии на кнопку.
     * Для кнопок типа reply - текст сообщения
     * Для кнопок типа open-url - URL для перехода
     * @example
     * ```ts
     * const button: IViberButton = {
     *     ActionType: 'reply',
     *     ActionBody: 'button_click',
     *     Text: 'Нажми меня'
     * };
     * ```
     */
    ActionBody?: string | null;

    /**
     * Текст, отображаемый на кнопке.
     * @example
     * ```ts
     * const button: IViberButton = {
     *     Text: 'Нажми меня'
     * };
     * ```
     */
    Text?: string | null;

    /**
     * Размер текста на кнопке.
     * Возможные значения:
     * - small - маленький текст
     * - regular - обычный текст
     * - large - большой текст
     * @example
     * ```ts
     * const button: IViberButton = {
     *     Text: 'Нажми меня',
     *     TextSize: 'large'
     * };
     * ```
     */
    TextSize?: string;

    /**
     * Вертикальное выравнивание текста.
     * Возможные значения:
     * - top - по верхнему краю
     * - middle - по центру
     * - bottom - по нижнему краю
     * @example
     * ```ts
     * const button: IViberButton = {
     *     Text: 'Нажми меня',
     *     TextVAlign: 'middle'
     * };
     * ```
     */
    TextVAlign?: string;

    /**
     * Горизонтальное выравнивание текста.
     * Возможные значения:
     * - left - по левому краю
     * - center - по центру
     * - right - по правому краю
     * @example
     * ```ts
     * const button: IViberButton = {
     *     Text: 'Нажми меня',
     *     TextHAlign: 'center'
     * };
     * ```
     */
    TextHAlign?: string;

    /**
     * URL изображения для кнопки.
     * Изображение будет отображаться на кнопке.
     * @example
     * ```ts
     * const button: IViberButton = {
     *     Text: 'Нажми меня',
     *     Image: 'http://localhost/button.png'
     * };
     * ```
     */
    Image?: string;
}

/**
 * @interface IViberButtonObject
 * Интерфейс для объекта, содержащего коллекцию кнопок Viber.
 *
 * Используется для создания клавиатуры с кнопками в Viber.
 *
 * @example
 * ```ts
 * const keyboard: IViberButtonObject = {
 *     DefaultHeight: true,
 *     BgColor: '#FFFFFF',
 *     Buttons: [
 *         {
 *             Columns: 6,
 *             Rows: 1,
 *             ActionType: 'reply',
 *             ActionBody: 'button_click',
 *             Text: 'Нажми меня',
 *             TextSize: 'regular',
 *             TextVAlign: 'middle',
 *             TextHAlign: 'center'
 *         }
 *     ]
 * };
 * ```
 */
export interface IViberButtonObject {
    /**
     * Определяет, будет ли использоваться стандартная высота кнопок.
     * @example
     * ```ts
     * const keyboard: IViberButtonObject = {
     *     DefaultHeight: true,
     *     Buttons: [...]
     * };
     * ```
     */
    DefaultHeight: boolean;

    /**
     * Цвет фона клавиатуры.
     * Может быть указан в формате HEX (#RRGGBB).
     * @example
     * ```ts
     * const keyboard: IViberButtonObject = {
     *     BgColor: '#FFFFFF',
     *     Buttons: [...]
     * };
     * ```
     */
    BgColor: string;

    /**
     * Массив кнопок клавиатуры.
     * @example
     * ```ts
     * const keyboard: IViberButtonObject = {
     *     DefaultHeight: true,
     *     BgColor: '#FFFFFF',
     *     Buttons: [
     *         {
     *             Columns: 6,
     *             Rows: 1,
     *             Text: 'Кнопка 1'
     *         },
     *         {
     *             Columns: 6,
     *             Rows: 1,
     *             Text: 'Кнопка 2'
     *         }
     *     ]
     * };
     * ```
     */
    Buttons: IViberButton[];

    /**
     * Тип клавиатуры.
     * @example
     * ```ts
     * const keyboard: IViberButtonObject = {
     *     Type: 'keyboard',
     *     Buttons: [...]
     * };
     * ```
     */
    Type?: string;
}

/**
 * @interface IViberCard
 * Псевдоним IViberButton — элемент rich_media.
 *
 * Особенности:
 * - Поддерживает форматированный текст (HTML)
 * - Позволяет настраивать размеры карточки (Columns 1–6 по ширине, Rows 1–7 по высоте)
 * - Может содержать изображения и кнопки
 * - Поддерживает различные стили текста
 * - ActionBody обязателен только для действий reply, open-url, share-phone и location-picker
 *
 * @example
 * ```ts
 * // Создание простой карточки: кнопка мерджится в сам элемент,
 * // вложенного поля Buttons у элемента rich_media нет
 * const card: IViberCard = {
 *     Columns: 6, // Максимальная ширина
 *     Rows: 7,    // Максимальная высота
 *     Image: '/image.jpg',
 *     Text: '<font color=#000><b>Заголовок</b></font><br><font color=#ccc>Описание</font>',
 *     ActionType: 'reply',  // опционально; для ячеек без действия — 'none'
 *     ActionBody: 'card_action'  // опционально; обязателен для действий с переходом/ответом
 * };
 *
 * // Создание карточки с кнопкой: поля кнопки задаются на самом элементе
 * const cardWithButton: IViberCard = {
 *     Columns: 6,
 *     Rows: 7,
 *     Image: '/image.jpg',
 *     Text: '<font color=#000><b>Заголовок</b></font><br><font color=#ccc>Описание</font>',
 *     ActionType: 'reply',
 *     ActionBody: 'button_action'
 * };
 * ```
 */
export type IViberCard = IViberButton;
