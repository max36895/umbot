/**
 * Интерфейсы для работы с Telegram
 * Определяют структуру данных для взаимодействия с Telegram Bot API
 *
 * Основные компоненты:
 * - Сообщения (ITelegramMessage)
 * - Отправители (ITelegramMessageFrom)
 * - Чаты (ITelegramMessageChat)
 * - Обновления (ITelegramContent)
 */

/**
 * Информация об отправителе сообщения
 */
export interface ITelegramMessageFrom {
    /**
     * ID пользователя
     */
    id: number;
    /**
     * Является ли ботом
     */
    is_bot: boolean;
    /**
     * Имя
     */
    first_name?: string;
    /**
     * Фамилия
     */
    last_name?: string;
    /**
     * Имя пользователя
     */
    username?: string;
    /**
     * Код языка
     */
    language_code?: string;
}

/**
 * Информация о чате
 */
export interface ITelegramMessageChat {
    /**
     * ID чата
     */
    id: number;
    /**
     * Имя
     */
    first_name?: string;
    /**
     * Фамилия
     */
    last_name?: string;
    /**
     * Имя пользователя
     */
    username?: string;
    /**
     * Тип чата
     */
    type?: string;
}

/**
 * Сообщение Telegram
 */
export interface ITelegramMessage {
    /**
     * ID сообщения
     */
    message_id: number;
    /**
     * Информация об отправителе
     */
    from?: ITelegramMessageFrom;
    /**
     * Информация о чате
     */
    chat: ITelegramMessageChat;
    /**
     * Дата отправки
     */
    date?: number;
    /**
     * Текст сообщения
     */
    text: string;
    /**
     * Inline-клавиатура сообщения. Приходит в callback_query.message — по ней адаптер
     * восстанавливает текст нажатой текстовой inline-кнопки.
     */
    reply_markup?: {
        inline_keyboard?: ITelegramInlineKeyboard[][];
    };
}

/**
 * Обновление от Telegram.
 * Содержит различные типы входящих данных
 */
export interface ITelegramContent {
    /**
     * ID обновления
     */
    update_id?: number;
    /**
     * Входящее сообщение
     */
    message?: ITelegramMessage;
    /**
     * Отредактированное сообщение.
     * Содержит новую версию сообщения после редактирования
     * @see ITelegramMessage
     */
    edited_message?: ITelegramMessage;
    /**
     * Пост в канале
     * Новое сообщение в канале (текст, фото, стикер и т.д.)
     * @see ITelegramMessage
     */
    channel_post?: ITelegramMessage;
    /**
     * Отредактированный пост в канале
     * Новая версия поста после редактирования
     * @see ITelegramMessage
     */
    edited_channel_post?: ITelegramMessage;
    /**
     * Встроенный запрос
     * Новый запрос для inline-режима
     * @see https://core.telegram.org/bots/api#inlinequery
     */
    inline_query?: {
        id: string;
        from: ITelegramMessageFrom;
        query: string;
        offset: string;
    };
    /**
     * Результат встроенного запроса
     * Выбранный пользователем результат inline-запроса
     * @see https://core.telegram.org/bots/api#choseninlineresult
     */
    chosen_inline_result?: {
        /**
         * Идентификатор выбранного результата.
         */
        result_id: string;
        /**
         * Пользователь, выбравший результат.
         */
        from: ITelegramMessageFrom;
        /**
         * Исходный inline-запрос.
         */
        query: string;
        /**
         * Геопозиция пользователя, если она была доступна.
         */
        location?: Record<string, unknown>;
        /**
         * Идентификатор отправленного inline-сообщения.
         */
        inline_message_id?: string;
    };
    /**
     * Запрос обратного вызова
     * Новый запрос от inline-кнопки
     * @see https://core.telegram.org/bots/api#callbackquery
     */
    callback_query?: {
        id: string;
        from?: ITelegramMessageFrom;
        message?: ITelegramMessage;
        data?: string;
        chat_instance?: string;
    };
    /**
     * Запрос доставки
     * Только для счетов с гибкой ценой
     * @see https://core.telegram.org/bots/api#shippingquery
     */
    shipping_query?: Record<string, unknown>;
    /**
     * Запрос предварительной проверки.
     * Содержит информацию о платеже
     * @see https://core.telegram.org/bots/api#precheckoutquery
     */
    pre_checkout_query?: Record<string, unknown>;
    /**
     * Обновление опроса
     * Бот получает только обновления о своих опросах
     * @see https://core.telegram.org/bots/api#poll
     */
    poll?: Record<string, unknown>;
    /**
     * Ответ на опрос
     * Обновление о новом голосе в неанонимном опросе
     * @see https://core.telegram.org/bots/api#poll_answer
     */
    poll_answer?: Record<string, unknown>;
}

/**
 * Типы вопросов для опросов в Telegram
 * - quiz: опрос с правильным ответом
 * - regular: обычный опрос без правильного ответа
 */
export type TTelegramQuestionType = 'quiz' | 'regular';

/**
 * Тип идентификатора чата в Telegram
 * - string: для публичных каналов (@channelname)
 * - number: для приватных чатов и групп
 */
export type TTelegramChatId = string | number;

/**
 * Интерфейс для медиафайлов в Telegram
 */
export interface ITelegramMedia {
    /**
     * Тип медиафайла
     * Возможные значения: "photo", "document", "audio", "video"
     */
    type: string;
    /**
     * ID медиафайла
     */
    media: string;
    /**
     * Подпись к медиафайлу
     */
    caption?: string;
}

/**
 * Интерфейс параметров для API Telegram
 * Определяет все возможные параметры для отправки сообщений и других действий
 *
 * @example
 * ```ts
 * // Отправка текстового сообщения
 * const textParams: ITelegramParams = {
 *   chat_id: 123456789,
 *   text: "Hello, world!",
 *   parse_mode: "HTML"
 * };
 *
 * // Отправка опроса
 * const pollParams: ITelegramParams = {
 *   chat_id: 123456789,
 *   question: "What is your favorite color?",
 *   options: [{ text: 'Red' }, { text: 'Blue' }, { text: 'Green' }],
 *   type: "regular",
 *   is_anonymous: false
 * };
 * ```
 */
export interface ITelegramParams {
    /**
     * Уникальный идентификатор целевого чата или имя пользователя целевого канала
     * - Для приватных чатов: числовой ID
     * - Для каналов: имя с префиксом «@» (например, "@channelname")
     */
    chat_id?: TTelegramChatId;

    /**
     * Текст отправляемого сообщения.
     * 1-4096 символов после синтаксического анализа сущностей
     */
    text?: string;

    /**
     * Режим форматирования текста.
     * Поддерживает Markdown или HTML для форматирования текста
     */
    parse_mode?: string;

    /**
     * Отключает предварительный просмотр ссылок.
     * Устарело в Bot API — заменено параметром link_preview_options.
     * @defaultValue false
     */
    disable_web_page_preview?: boolean;

    /**
     * Отправляет сообщение без звука.
     * @defaultValue false
     */
    disable_notification?: boolean;

    /**
     * ID сообщения, на которое отвечаем
     */
    reply_to_message_id?: number;

    /**
     * Дополнительные опции интерфейса.
     * JSON-сериализованный объект для клавиатуры и других элементов управления
     */
    reply_markup?: string;

    // Параметры для опросов
    /**
     * Вопрос для опроса.
     * 1-300 символов
     */
    question?: string;

    /**
     * Варианты ответов для опроса.
     * Список из 1-12 объектов InputPollOption по 1-100 символов
     */
    options?: Array<{ text: string; text_parse_mode?: string }>;

    /**
     * Флаг анонимности опроса.
     * @defaultValue true
     */
    is_anonymous?: boolean;

    /**
     * Тип опроса
     * @defaultValue "regular"
     */
    type?: TTelegramQuestionType;

    /**
     * Разрешает множественный выбор в опросе
     * @defaultValue false
     * @remarks Не работает для опросов типа "quiz"
     */
    allows_multiple_answers?: boolean;

    /**
     * ID правильного варианта ответа.
     * Требуется только для опросов типа "quiz"
     * @deprecated Используйте `correct_option_ids`.
     */
    correct_option_id?: number;

    /**
     * Идентификаторы правильных вариантов ответа в актуальном Telegram Bot API.
     */
    correct_option_ids?: number[];

    /**
     * Флаг закрытия опроса.
     * @defaultValue false
     */
    is_closed?: boolean;

    // Параметры для медиафайлов
    /**
     * Фото для отправки.
     * file_id или URL для загрузки
     */
    photo?: string;

    /**
     * Подпись к фотографии.
     * 0-1024 символа
     */
    caption?: string;

    /**
     * Документ для отправки.
     * file_id или URL для загрузки
     */
    document?: string;

    /**
     * Миниатюра документа.
     * JPEG, < 200KB, размеры до 320x320
     */
    thumb?: string;

    /**
     * Аудиофайл для отправки.
     * file_id или URL для загрузки
     */
    audio?: string;

    /**
     * Длительность аудио в секундах
     */
    duration?: number;

    /**
     * Исполнитель аудио
     */
    performer?: string;

    /**
     * Название аудиотрека
     */
    title?: string;

    /**
     * Видео для отправки.
     * file_id или URL для загрузки
     */
    video?: string;

    /**
     * Поддержка стриминга для видео
     * @defaultValue false
     */
    supports_streaming?: boolean;
}

/**
 * Интерфейс с информацией об отправителе сообщения
 *
 * @example
 * ```ts
 * const from: ITelegramFrom = {
 *   id: 123456789,
 *   is_bot: false,
 *   first_name: "John",
 *   username: "johndoe"
 * };
 * ```
 */
export interface ITelegramFrom {
    /**
     * Идентификатор отправителя
     */
    id: number;

    /**
     * Флаг, указывающий является ли отправитель ботом
     */
    is_bot: boolean;

    /**
     * Имя отправителя
     */
    first_name: string;

    /**
     * Никнейм отправителя
     */
    username: string;
}

/**
 * Интерфейс с информацией о чате
 *
 * @example
 * ```ts
 * const chat: ITelegramChat = {
 *   id: 123456789,
 *   first_name: "John",
 *   last_name: "Doe",
 *   username: "johndoe",
 *   type: "private"
 * };
 * ```
 */
export interface ITelegramChat {
    /**
     * Идентификатор чата
     */
    id: number;

    /**
     * Имя (first_name)
     */
    first_name: string;

    /**
     * Фамилия (last_name)
     */
    last_name: string;

    /**
     * Никнейм пользователя (username, без @)
     */
    username: string;

    /**
     * Тип чата.
     * Возможные значения: "private", "group", "supergroup", "channel"
     */
    type: string;
}

/**
 * Интерфейс с информацией об опросе
 *
 * @example
 * ```ts
 * const poll: ITelegramPoll = {
 *   id: "123456789",
 *   question: "What is your favorite color?",
 *   options: [
 *     { text: "Red", voter_count: 5 },
 *     { text: "Blue", voter_count: 3 },
 *     { text: "Green", voter_count: 2 }
 *   ],
 *   total_voter_count: 10,
 *   is_closed: false,
 *   is_anonymous: true,
 *   type: "regular",
 *   allows_multiple_answers: false
 * };
 * ```
 */
export interface ITelegramPoll {
    /**
     * Уникальный идентификатор опроса
     */
    id: string;

    /**
     * Вопрос опроса
     */
    question: string;

    /**
     * Варианты ответов
     */
    options: Array<{
        /**
         * Текст варианта ответа
         */
        text: string;
        /**
         * Количество проголосовавших за этот вариант
         */
        voter_count: number;
    }>;

    /**
     * Общее количество проголосовавших
     */
    total_voter_count: number;

    /**
     * Флаг закрытия опроса
     */
    is_closed: boolean;

    /**
     * Флаг анонимности опроса
     */
    is_anonymous: boolean;

    /**
     * Тип опроса
     */
    type: TTelegramQuestionType;

    /**
     * Разрешение множественного выбора
     */
    allows_multiple_answers: boolean;

    /**
     * ID правильного варианта ответа.
     * Доступно только для закрытых опросов типа "quiz"
     * @deprecated Актуальный Telegram Bot API возвращает `correct_option_ids`.
     */
    correct_option_id?: number;

    /**
     * Идентификаторы правильных вариантов ответа в актуальном Telegram Bot API.
     */
    correct_option_ids?: number[];
}

/**
 * Базовый интерфейс для информации о файле
 *
 * @example
 * ```ts
 * const fileInfo: IFileInfo = {
 *   file_id: "AgACAgIAAxkBAAIB",
 *   file_unique_id: "AQADBAADYc0GAAE",
 *   file_size: 1024
 * };
 * ```
 */
export interface IFileInfo {
    /**
     * Идентификатор файла.
     * Может быть использован для повторной отправки файла
     */
    file_id: string;

    /**
     * Уникальный идентификатор файла.
     * Неизменный идентификатор файла
     */
    file_unique_id: string;

    /**
     * Размер файла в байтах
     */
    file_size: number;
}

/**
 * Интерфейс с информацией о фотографии
 *
 * В апдейте Telegram приходит массивом (ITelegramPhoto[]): первый элемент —
 * минимальное разрешение, последний — максимальное.
 *
 * @example
 * ```ts
 * const photo: ITelegramPhoto = {
 *   file_id: "AgACAgIAAxkBAAIB",
 *   file_unique_id: "AQADBAADYc0GAAE",
 *   file_size: 1024,
 *   width: 800,
 *   height: 600
 * };
 * ```
 */
export interface ITelegramPhoto extends IFileInfo {
    /**
     * Ширина изображения в пикселях
     */
    width: number;

    /**
     * Высота изображения в пикселях
     */
    height: number;
}

/**
 * Интерфейс с информацией о миниатюре
 *
 * @example
 * ```ts
 * const thumb: ITelegramThumb = {
 *   file_id: "AgACAgIAAxkBAAIB",
 *   file_unique_id: "AQADBAADYc0GAAE",
 *   file_size: 1024,
 *   width: 320,
 *   height: 320
 * };
 * ```
 */
export interface ITelegramThumb extends IFileInfo {
    /**
     * Ширина миниатюры в пикселях
     */
    width?: number;

    /**
     * Высота миниатюры в пикселях
     */
    height?: number;
}

/**
 * Интерфейс с информацией о документе
 *
 * @example
 * ```ts
 * const document: ITelegramDocument = {
 *   file_id: "AgACAgIAAxkBAAIB",
 *   file_unique_id: "AQADBAADYc0GAAE",
 *   file_size: 1024,
 *   file_name: "document.pdf",
 *   mime_type: "application/pdf",
 *   thumb: {
 *     file_id: "AgACAgIAAxkBAAIB",
 *     file_unique_id: "AQADBAADYc0GAAE",
 *     file_size: 1024,
 *     width: 320,
 *     height: 320
 *   }
 * };
 * ```
 */
export interface ITelegramDocument extends IFileInfo {
    /**
     * Оригинальное имя файла
     */
    file_name: string;

    /**
     * MIME-тип файла
     */
    mime_type: string;

    /**
     * Миниатюра документа
     */
    thumb: ITelegramThumb;
}

/**
 * Интерфейс с информацией об аудиофайле
 *
 * @example
 * ```ts
 * const audio: ITelegramAudio = {
 *   file_id: "AgACAgIAAxkBAAIB",
 *   file_unique_id: "AQADBAADYc0GAAE",
 *   file_size: 1024,
 *   name: "song.mp3",
 *   mime_type: "audio/mpeg",
 *   duration: 180,
 *   performer: "Artist",
 *   thumb: {
 *     file_id: "AgACAgIAAxkBAAIB",
 *     file_unique_id: "AQADBAADYc0GAAE",
 *     file_size: 1024,
 *     width: 320,
 *     height: 320
 *   }
 * };
 * ```
 */
export interface ITelegramAudio extends IFileInfo {
    /**
     * Оригинальное имя файла
     */
    name: string;

    /**
     * MIME-тип файла
     */
    mime_type: string;

    /**
     * Длительность аудио в секундах
     */
    duration: number;

    /**
     * Исполнитель
     */
    performer: string;

    /**
     * Миниатюра аудио
     */
    thumb: ITelegramThumb;
}

/**
 * Интерфейс с информацией о видеофайле
 *
 * @example
 * ```ts
 * const video: ITelegramVideo = {
 *   file_id: "AgACAgIAAxkBAAIB",
 *   file_unique_id: "AQADBAADYc0GAAE",
 *   file_size: 1024,
 *   name: "video.mp4",
 *   mime_type: "video/mp4",
 *   duration: 180,
 *   performer: "Artist",
 *   width: 1280,
 *   height: 720,
 *   thumb: {
 *     file_id: "AgACAgIAAxkBAAIB",
 *     file_unique_id: "AQADBAADYc0GAAE",
 *     file_size: 1024,
 *     width: 320,
 *     height: 320
 *   }
 * };
 * ```
 */
export interface ITelegramVideo extends ITelegramAudio {
    /**
     * Ширина видео в пикселях
     */
    width: number;

    /**
     * Высота видео в пикселях
     */
    height: number;
}

/**
 * Интерфейс с содержимым результата запроса
 *
 * @example
 * ```ts
 * const result: ITelegramResultContent = {
 *   message_id: 123,
 *   from: {
 *     id: 123456789,
 *     is_bot: false,
 *     first_name: "John",
 *     username: "johndoe"
 *   },
 *   chat: {
 *     id: 123456789,
 *     first_name: "John",
 *     last_name: "Doe",
 *     username: "johndoe",
 *     type: "private"
 *   },
 *   date: 1234567890,
 *   text: "Hello, world!"
 * };
 * ```
 */
export interface ITelegramResultContent {
    /**
     * Идентификатор сообщения
     */
    message_id: number;

    /**
     * Информация об отправителе
     */
    from: ITelegramFrom;

    /**
     * Информация о чате
     */
    chat?: ITelegramChat;

    /**
     * Дата отправки сообщения.
     * Unix timestamp
     */
    date?: number;

    /**
     * Текст сообщения
     */
    text?: string;

    /**
     * Информация об опросе
     */
    poll?: ITelegramPoll;

    /**
     * Информация о фотографии.
     * Внимание: Telegram Bot API возвращает массив PhotoSize[],
     * где последний элемент — самое большое разрешение.
     * Для получения file_id нужно использовать photo[photo.length - 1].file_id.
     */
    photo?: ITelegramPhoto[];

    /**
     * Информация о документе
     */
    document?: ITelegramDocument;

    /**
     * Информация об аудиофайле
     */
    audio?: ITelegramAudio;

    /**
     * Информация о видеофайле
     */
    video?: ITelegramVideo;
}

/**
 * Интерфейс результата запроса к API Telegram
 *
 * @example
 * ```ts
 * const response: ITelegramResult = {
 *   ok: true,
 *   result: {
 *     message_id: 123,
 *     from: {
 *       id: 123456789,
 *       is_bot: false,
 *       first_name: "John",
 *       username: "johndoe"
 *     },
 *     chat: {
 *       id: 123456789,
 *       first_name: "John",
 *       last_name: "Doe",
 *       username: "johndoe",
 *       type: "private"
 *     },
 *     date: 1234567890,
 *     text: "Hello, world!"
 *   }
 * };
 *
 * // Пример ошибки
 * const errorResponse: ITelegramResult = {
 *   ok: false,
 *   result: null,
 *   error_code: 400,
 *   description: "Bad Request"
 * };
 * ```
 */
export interface ITelegramResult {
    /**
     * Статус выполнения запроса
     */
    ok: boolean;

    /**
     * Содержимое результата.
     * Отсутствует, если ok === false.
     */
    result?: ITelegramResultContent | null;

    /**
     * Код ошибки.
     * Присутствует только в случае ошибки
     */
    error_code?: number;

    /**
     * Описание ошибки.
     * Присутствует только в случае ошибки
     */
    description?: string;
}

/**
 * Payload callback-кнопки Telegram (объект).
 */
export type TButtonPayload = Record<string, unknown>;

/**
 * @interface ITelegramReplyButton
 * Кнопка reply-клавиатуры Telegram (отображается вместо стандартной клавиатуры).
 */
export interface ITelegramReplyButton {
    /**
     * Текст на кнопке.
     */
    text?: string;
    /**
     * Запросить у пользователя номер телефона (кнопка «Поделиться номером»).
     */
    request_contact?: boolean;
    /**
     * Запросить у пользователя геолокацию (кнопка «Отправить местоположение»).
     */
    request_location?: boolean;
    /**
     * Стиль кнопки (Telegram Bot API 9.4+).
     * Возможные значения (Bot API): 'primary', 'success', 'danger'
     */
    style?: string;
}

/**
 * @interface ITelegramInlineKeyboard
 * Интерфейс для inline-кнопок в сообщениях Telegram
 *
 * Используется для создания кнопок, которые отображаются непосредственно в сообщении:
 * - Кнопки-ссылки
 * - Кнопки с callback-данными
 *
 * url и callback_data взаимоисключающие: кнопка содержит либо ссылку, либо callback-данные.
 *
 * @example
 * ```ts
 * const urlButton: ITelegramInlineKeyboard = {
 *     text: 'Открыть сайт',
 *     url: 'http://localhost'
 * };
 *
 * const callbackButton: ITelegramInlineKeyboard = {
 *     text: 'Открыть раздел',
 *     callback_data: { action: 'open_site' }
 * };
 * ```
 */
export interface ITelegramInlineKeyboard {
    /**
     * Текст внутри кнопки
     */
    text: string | null;
    /**
     * Ссылка по которой перейдёт пользователь после нажатия
     */
    url?: string;
    /**
     * Дополнительные параметры, которые передадутся после нажатия на кнопку
     */
    callback_data?: TButtonPayload | string;
    /**
     * Стиль кнопки (Telegram Bot API 9.4+).
     * Возможные значения (Bot API): 'primary', 'success', 'danger'
     */
    style?: string;
}

/**
 * @interface ITelegramKeyboard
 * Интерфейс для клавиатуры Telegram
 *
 * Поддерживает три режима работы:
 * - Inline-кнопки в сообщении
 * - Reply-кнопки вместо клавиатуры
 * - Удаление клавиатуры
 *
 * @example
 * ```ts
 * // Inline-кнопки
 * const inlineKeyboard: ITelegramKeyboard = {
 *     inline_keyboard: [
 *         [{ text: 'Кнопка 1', url: 'http://localhost/1' }],
 *         [{ text: 'Кнопка 2', callback_data: { action: 'button2' } }]
 *     ]
 * };
 *
 * // Reply-кнопки
 * const replyKeyboard: ITelegramKeyboard = {
 *     keyboard: [[{ text: 'Кнопка 1' }], [{ text: 'Кнопка 2' }]]
 * };
 *
 * // Удаление клавиатуры
 * const removeKeyboard: ITelegramKeyboard = {
 *     remove_keyboard: true
 * };
 * ```
 */
export interface ITelegramKeyboard {
    /**
     * Inline-кнопки (ссылки и/или callback) — массив массивов (рядов) кнопок
     */
    inline_keyboard?: ITelegramInlineKeyboard[][];
    /**
     * Reply-кнопки, отображаемые вместо стандартной клавиатуры устройства, —
     * массив массивов (рядов) кнопок
     */
    keyboard?: ITelegramReplyButton[][];
    /**
     * Удалить все кнопки
     */
    remove_keyboard?: boolean;
    /**
     * Автоматически подогнать размер reply-клавиатуры под экран устройства.
     * Рекомендуется всегда устанавливать true для reply-клавиатур.
     * @defaultValue false
     */
    resize_keyboard?: boolean;
    /**
     * Скрыть reply-клавиатуру после нажатия на кнопку.
     * @defaultValue false
     */
    one_time_keyboard?: boolean;
    /**
     * Плейсхолдер в поле ввода при активной reply-клавиатуре.
     * Максимум 64 символа.
     */
    input_field_placeholder?: string;
}
