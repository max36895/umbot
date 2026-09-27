/**
 * Интерфейсы для работы с Sber Smart App
 * Определяют структуру данных для взаимодействия с API Сбера
 *
 * Основные компоненты:
 * - Запросы (ISberSmartAppWebhookRequest)
 * - Ответы (ISberSmartAppWebhookResponse)
 * - Сессии (ISberSmartAppSession)
 * - Устройства (ISberSmartAppDeviceInfo)
 * - Приложения (ISberSmartAppAppInfo)
 * - Персонажи (ISberSmartAppCharacterInfo)
 * - Сообщения (ISberSmartAppMessageInfo)
 * - Карточки (ISberSmartAppCard)
 * - Кнопки (ISberSmartAppSuggestionButton)
 */

import { IImageParams } from '../../../../components';

/**
 * Типы сообщений для взаимодействия со смартапом.
 * Допустимые значения перечислены в типе (union).
 */
export type TMessageName =
    | 'MESSAGE_TO_SKILL' // Сообщение для смартапа
    | 'RATING_RESULT' // Результат оценки
    | 'SERVER_ACTION' // Действие на сервере
    | 'RUN_APP' // Запуск приложения
    | 'CLOSE_APP'; // Закрытие приложения

/**
 * Типы смартапов.
 * Допустимые значения перечислены в типе (union).
 */
export type TSberSmartAppType =
    | 'DIALOG' // Диалоговый интерфейс
    | 'WEB_APP' // Веб-приложение
    | 'APK' // Нативное приложение
    | 'CHAT_APP'; // Чат-приложение

/**
 * Информация об устройстве пользователя.
 * Содержит данные о платформе, возможностях и функциональности устройства
 */
export interface ISberSmartAppDeviceInfo {
    /**
     * Операционная система устройства
     * @enum {string}
     * - ANDROID - Android
     * - IOS - iOS
     */
    platformType: string;

    /**
     * Версия операционной системы
     */
    platformVersion: string;

    /**
     * Поверхность, от которой приходит вызов
     * @enum {string}
     * - SBOL - Сбербанк Онлайн
     * - SUPER_APP - СБЕР Салют
     * - SBERBOX - SberBox
     */
    surface: string;

    /**
     * Версия поверхности
     */
    surfaceVersion: string;

    /**
     * Идентификатор устройства
     */
    deviceId?: string;

    /**
     * Функциональность устройства.
     * Описывает поддерживаемые типы приложений
     */
    features: {
        /**
         * Поддерживаемые типы смартапов
         */
        appTypes: TSberSmartAppType[];
    };

    /**
     * Возможности устройства.
     * Описывает доступные компоненты
     */
    capabilities: {
        /**
         * Наличие экрана
         */
        screen: {
            /**
             * Наличие экрана
             */
            available: boolean;
        };
        /**
         * Наличие микрофона
         */
        mic: {
            /**
             * Наличие микрофона
             * */
            available: boolean;
        };
        /**
         * Наличие динамиков
         */
        speak: {
            /**
             * Наличие динамиков
             */
            available: boolean;
        };
    };

    /**
     * Дополнительная информация об устройстве
     */
    additionalInfo: object;
}

/**
 * Информация о смартапе.
 * Содержит идентификаторы и настройки приложения
 */
export interface ISberSmartAppAppInfo {
    /**
     * ID проекта в SmartApp Studio
     */
    projectId: string;

    /**
     * ID смартапа
     */
    applicationId: string;

    /**
     * ID опубликованной версии
     */
    appversionId: string;

    /**
     * URL веб-приложения (для Canvas Apps)
     */
    frontendEndpoint?: string;

    /**
     * Тип смартапа.
     * Определяет обработку навигационных команд
     */
    frontendType?: TSberSmartAppType;

    /**
     * Читаемый ID проекта
     */
    systemName?: string;

    /**
     * Объединенный ID проекта, приложения и версии
     */
    frontendStateId?: string;
}

/**
 * Информация о персонаже ассистента.
 * Содержит данные о выбранном персонаже и его характеристиках
 */
export interface ISberSmartAppCharacterInfo {
    /**
     * ID персонажа
     * @enum {string}
     * - sber - Сбербанк (мужской, на "вы")
     * - athena - Афина (женский, на "вы")
     * - joy - Джой (мужской, на "ты")
     */
    id: 'sber' | 'athena' | 'joy';

    /**
     * Имя персонажа
     */
    name: 'Сбер' | 'Афина' | 'Джой';

    /**
     * Пол персонажа
     * @enum {string}
     * - male - мужской
     * - female - женский
     */
    gender: 'male' | 'female';

    /**
     * Форма обращения
     * @enum {string}
     * - official - на "вы"
     * - no_official - на "ты"
     */
    appeal: 'official' | 'no_official';
}

/**
 * Метаданные запроса.
 * Содержит информацию о времени и часовом поясе
 */
export interface ISberSmartAppMetaInfo {
    /**
     * Данные о текущем времени на устройстве пользователя.
     */
    time: {
        /**
         * Наименование часового пояса.
         */
        timezone_id: string;
        /**
         * Разница во времени
         */
        timezone_offset_sec: number;
        /**
         * Unix-время в миллисекундах.
         */
        timestamp: number;
    };
}

/**
 * Сущности из сообщения пользователя.
 * Содержит извлеченные данные из текста
 */
export interface ISberSmartAppEntities {
    /**
     * Значение сущности
     */
    value?: string | number;
    /**
     * Сумма
     */
    amount?: number;
    /**
     * Валюта
     */
    currency?: string;
    /**
     * Число в виде прилагательного
     */
    adjectival_number?: boolean;
}

/**
 * Информация о сообщении пользователя.
 * Содержит текст и результаты его обработки
 */
export interface ISberSmartAppMessageInfo {
    /**
     * Исходный текст сообщения
     * Распознанный голос или введенный текст
     */
    original_text: string;

    /**
     * Нормализованный текст
     * Очищен от знаков препинания
     * Числа преобразованы в числовой формат
     */
    normalized_text: string;

    /**
     * Текст для отображения
     * Нормализованный текст с форматированием
     */
    asr_normalized_message: string;

    /**
     * Извлеченные сущности
     * Структурированные данные из текста
     */
    entities?: {
        /**
         * Сама сущность
         */
        [key: string]: ISberSmartAppEntities;
    };

    /**
     * Токены сообщения
     * Грамматический и синтаксический разбор
     */
    tokenized_elements_list: Record<string, unknown>[];
}

/**
 * Действие на сервере.
 * Описывает действие, которое обрабатывает бэкенд
 */
export interface ISberSmartAppServerAction {
    /**
     * ID действия
     * @defaultValue run_app — но для server_action фреймворк генерирует 'umbot_action'
     */
    action_id: string;

    /**
     * Параметры действия
     * JSON-объект с данными
     */
    parameters: Record<string, unknown>;
}

/**
 * Выбранный элемент
 * Информация о выбранном пользователем элементе
 */
export interface ISberSmartAppSelectedItem {
    /**
     * Индекс элемента (с 0)
     */
    index: number;

    /**
     * Название элемента
     */
    title: string;

    /**
     * Выбор по номеру
     */
    is_query_by_number: boolean;
}

/**
 * Аннотации сообщения.
 * Содержит результаты анализа текста и голоса
 */
export interface ISberSmartAppAnnotations {
    /**
     * Информация о прохождении цензуры.
     */
    censor_data: {
        /**
         * Список категорий модерации, обнаруженных в тексте или реплике пользователя. Содержит следующие значения:
         * politicians — наличие политиков из списка
         * obscene — наличие нецензурной лексики
         * model_response — вероятность негатива
         */
        classes: ['politicians', 'obscene', 'model_response'];
        /**
         * Коэффициенты категорий модерации. Сопоставляются по индексам, в соответствии со списком категорий censor_data.classes.
         * Для категорий politicians и obscene могут принимать только значения 0 и 1.
         */
        probas: [number, number, number];
    };
    /**
     * Эмоциональная окраска текста пользователя.
     */
    text_sentiment: {
        /**
         * Список характеристик эмоциональной окраски текста пользователя. Содержит следующие значения:
         * negative
         * speech
         * neutral
         * positive
         * skip
         */
        classes: ['negative', 'speech', 'neutral', 'positive', 'skip'];
        /**
         * Коэффициенты той или иной эмоциональной характеристики текста пользователя — значения 0..100 (сумма всех коэффициентов равна 100).
         * Коэффициенты сопоставляются по индексам с характеристиками, представленными в поле text_sentiment.classes.
         */
        probas: [number, number, number, number, number];
    };
    /**
     * Эмоциональная окраска голоса пользователя.
     */
    asr_sentiment: {
        /**
         * Список характеристик эмоциональной окраски голоса пользователя. Содержит следующие значения:
         * positive
         * neutral
         * negative
         */
        classes: ['positive', 'neutral', 'negative'];
        /**
         * Коэффициенты той или иной эмоциональной характеристики реплики пользователя в диапазоне от 0 до 1.
         * Коэффициенты сопоставляются по индексам с характеристиками, представленными в поле asr_sentiment.classes.
         */
        probas: [number, number, number];
    };
}

/**
 * Оценка пользователя.
 * Содержит числовую оценку
 */
export interface ISberRating {
    /**
     * Оценка
     */
    estimation: number;
}

/**
 * Статус оценки.
 * Содержит код и описание результата оценки
 */
export interface ISberRatingStatusCode {
    /**
     * Код результата оценки
     */
    code: 1 | 101 | 104;
    /**
     * Описание результата оценки
     */
    description: 'SUCCESS' | 'SKIP BY USER' | 'FORBIDDEN';
}

/**
 * Полезная нагрузка запроса.
 * Содержит все данные, необходимые для обработки запроса
 */
export interface ISberSmartAppRequestPayload {
    /**
     * Информация об устройстве пользователя.
     */
    device: ISberSmartAppDeviceInfo;
    /**
     * Информация о смартапе.
     */
    app_info: ISberSmartAppAppInfo;
    /**
     * Информация о текущем персонаже ассистента, который установлен у пользователя.
     */
    character: ISberSmartAppCharacterInfo;
    /**
     * Интент, полученный из предыдущего ответа смартапа.
     */
    intent: string;
    /**
     * Исходный интент. Значение поля отличается от значения intent только при монопольном захвате контекста.
     */
    original_intent: string;
    /**
     * Мета данные, полученные от сервиса распознавания интентов.
     * Поле будет использовано в будущем. В текущей реализации содержит пустой объект.
     * Определяйте интенты в SmartApp Code и передавайте их в запросах к своему серверу.
     */
    intent_meta: object;
    /**
     * Данные о содержимом экрана пользователя.
     */
    meta: ISberSmartAppMetaInfo;
    /**
     * Имя смартапа, которое задается при создании проекта и отображается в каталоге приложений.
     */
    projectName: string;
    /**
     * Описание элемента экрана, который пользователь назвал при запросе ("включи второй" / "включи второго терминатора"). Для работы этой функциональности нужна отправка во входящем сообщении с фронтенда item_selector со списком элементов.
     * Поле опционально (selected_item?): отсутствует, если пользователь не выбирал элемент.
     */
    selected_item?: ISberSmartAppSelectedItem;
    /**
     * Указывает на характер запуска смартапа. Если поле содержит true, сессии присваивается новый идентификатор (поле sessionId).
     * Возможные значения:
     * true — приложение запущено впервые или после закрытия приложения, а также при запуске приложения по истечении тайм-аута (10 минут) или после прерывания работы приложения, например, по запросу "текущее время"
     * false — во всех остальных случаях.
     * @defaultValue false
     */
    new_session?: boolean;
    /**
     * Общие характеристики сообщения пользователя.
     */
    annotations: ISberSmartAppAnnotations;
    /**
     * Возможные стратегии смартапа.
     */
    strategies: {
        /**
         * Стратегия «поздравление с днём рождения» активна
         */
        happy_birthday: boolean;
        /**
         * Признак последнего вызова
         */
        last_call: number;
        /**
         * Признак, что собеседник — Алиса
         */
        is_alice?: boolean;
    };
    /**
     * Информация о запускаемом смартапе и параметрах его запуска.
     * Формируется бэкендом приложения.
     * По умолчанию: пустой объект.
     * @defaultValue {}
     */
    server_action?: ISberSmartAppServerAction;
    /**
     * Результат предобработки.
     */
    message: ISberSmartAppMessageInfo;
    /**
     * Результат оценки пользователя
     */
    rating?: ISberRating;
    /**
     * Статус оценки
     */
    status_code?: ISberRatingStatusCode;
}

/**
 * Идентификатор пользователя.
 * Содержит уникальные идентификаторы для разных каналов
 */
export interface ISberSmartAppUuId {
    /**
     * Идентификатор канала коммуникации.
     */
    userChannel: string;
    /**
     * Постоянный идентификатор пользователя созданный на основе SberID. Может отсутствовать, если пользователь не аутентифицирован.
     * Может использоваться для хранения контекста диалога пользователя. Контекст диалога можно обновлять по значению поля new_session.
     */
    sub: string;
    /**
     * Идентификатор, который используется для определения не аутентифицированных пользователей.
     * Идентификатор может изменяться при сбросе настроек или переустановке смартапа.
     */
    userId: string;
}

/**
 * Запрос вебхука
 * Полный формат входящего запроса
 */
export interface ISberSmartAppWebhookRequest {
    /**
     * Тип запроса.
     */
    messageName: TMessageName;
    /**
     * Идентификатор сессии, который обновляется каждый раз, когда в поле new_session приходит true.
     * При использовании совместно с messageId помогает гарантировать уникальность сообщения. В том числе если пользователь взаимодействует с несколькими поверхностями.
     */
    sessionId: string;
    /**
     * Идентификатор запроса, который отправил ассистент.
     * Ответ на запрос должен содержать такой же идентификатор в поле messageId.
     */
    messageId: number;
    /**
     * Составной идентификатор пользователя.
     */
    uuid: ISberSmartAppUuId;
    /**
     * Коллекция, в которой в зависимости от потребителя и messageName передается дополнительная информация.
     */
    payload: ISberSmartAppRequestPayload;
}

/**
 * Тип ответа сервера.
 * Допустимые значения перечислены в типе (union).
 * ANSWER_TO_USER — содержит ответ, который ассистент предоставит пользователю.
 * CALL_RATING - содержит ответ, благодаря которому ассистент понимает что пользователь хочет поставить оценку.
 * POLICY_RUN_APP — сообщает о вызове смартапа из другого приложения.
 * NOTHING_FOUND — смартап не смог найти ответ. Может указывать на то, что приложение было запущено по ошибке.
 * ERROR — возвращается, если смартап недоступен или вернул ошибку
 */
export type TSberResponseMessageName =
    'ANSWER_TO_USER' | 'CALL_RATING' | 'POLICY_RUN_APP' | 'NOTHING_FOUND' | 'ERROR';

/**
 * Идентификатор эмоции, определяющий эмоцию персонажа.
 * Допустимые значения перечислены в типе (union).
 * igrivost — анимация игривости
 * udovolstvie — анимация удовольствия
 * podavleniye_gneva — анимация подавленного гнева
 * smushchennaya_ulibka — анимация смущённой улыбки
 * simpatiya — анимация симпатии
 * oups — анимация «упс» (неловкий момент)
 * laugh — анимация смеха
 * ok_prinyato — анимация исполнения запроса
 * bespokoistvo — анимация беспокойства, например, при жалобе пользователя на самочувствие
 * predvkusheniye — анимация возбуждённого ожидания следующей реплики пользователя
 * vinovatiy — анимация вины, например, если в приложении произошла ошибка
 * zhdu_otvet — анимация ожидания реакции от пользователя, например, ответа на заданный вопрос
 * zadumalsa — анимация размышление над репликой пользователя, например, если её не удалось распознать
 * neznayu — анимация отсутствия ответа
 * nedoumenie — анимация сомнения, например, когда не удаётся точно распознать реплику
 * nedovolstvo — анимация негативной реакции в ответ на реплику
 * nesoglasie — анимация несогласия с пользователем
 * pechal — анимация грусти и тоскливого настроения
 * radost — анимация радости или удовлетворения действиями или репликами пользователя
 * sochuvstvie — анимация сопереживания или выражения участия в проблемах пользователя
 * strakh — анимация испуга
 * zainteresovannost — анимация проявления интереса или любопытства по отношению к действиям или репликам пользователя
 */
export type TSberSmartAppEmotionId =
    | 'igrivost'
    | 'udovolstvie'
    | 'podavleniye_gneva'
    | 'smushchennaya_ulibka'
    | 'simpatiya'
    | 'oups'
    | 'laugh'
    | 'ok_prinyato'
    | 'bespokoistvo'
    | 'predvkusheniye'
    | 'vinovatiy'
    | 'zhdu_otvet'
    | 'zadumalsa'
    | 'neznayu'
    | 'nedoumenie'
    | 'nedovolstvo'
    | 'nesoglasie'
    | 'pechal'
    | 'radost'
    | 'sochuvstvie'
    | 'strakh'
    | 'zainteresovannost';

/**
 * Действие кнопки.
 * Описывает поведение при нажатии
 */
export interface ISberSmartAppSuggestionAction {
    /**
     * Текст кнопки
     * Для type='text'
     */
    text?: string;

    /**
     * Данные для сервера
     * Для type='server_action'
     */
    server_action?: {
        action_id: string;
        /**
         * Параметры действия — по контракту SmartApp API (`{action_id, parameters}`)
         * приходят обратно в запросе SERVER_ACTION в `payload.server_action.parameters`.
         */
        parameters?: Record<string, unknown>;
        /**
         * Устаревшая форма server_action (`{type, payload}`); адаптер её не отправляет.
         * @deprecated Используйте parameters.
         */
        payload?: Record<string, unknown>;
    };

    /**
     * Имя сообщения для действия на сервере.
     */
    message_name?: 'SERVER_ACTION' | 'RUN_APP';

    /**
     * Ссылка для открытия
     * Для type='deep_link'
     */
    deep_link?: string;

    /**
     * Тип действия
     * @enum {string}
     * - text - отображение текста
     * - server_action - отправка данных на сервер
     * - deep_link - открытие ссылки
     */
    type: 'text' | 'server_action' | 'deep_link';
}

/**
 * Кнопка предложения.
 * Определяет внешний вид и поведение кнопки
 */
export interface ISberSmartAppSuggestionButton {
    /**
     * Текст кнопки
     */
    title: string;

    /**
     * Массив действий при нажатии согласно SmartApp API.
     */
    actions?: ISberSmartAppSuggestionAction[];

    /**
     * Устаревшее одиночное действие. Оставлено для обратной совместимости
     * при обработке существующих пользовательских объектов, но адаптер его не формирует.
     * @deprecated Используйте `actions`.
     */
    action?: ISberSmartAppSuggestionAction;
}

/**
 * Поведение шторки ассистента. Параметр актуален при работе с ассистентом на наших устройствах.
 * Допустимые значения перечислены в типе (union).
 * auto_expand — шторка будет автоматически разворачиваться, если полученный текст не помещается в свёрнутой шторке
 * force_expand — шторка развернётся независимо от того, помещается полученный текст в свёрнутой шторке или нет
 * preserve_panel_state — сохраняет текущее состояние шторки независимо от длины текста
 * @defaultValue auto_expand
 */
export type TSberSmartAppExpandPolicy = 'auto_expand' | 'force_expand' | 'preserve_panel_state';

/**
 * Пузырь сообщения
 * Текст для отображения ассистентом
 */
export interface ISberSmartAppBubble {
    /**
     * Текст сообщения
     * Максимум 250 символов
     */
    text: string;

    /**
     * Поддержка markdown
     * @defaultValue false — но адаптер umbot всегда отправляет markdown: true
     */
    markdown?: boolean;

    /**
     * Поведение шторки
     * Для устройств с ассистентом
     * @defaultValue auto_expand
     */
    expand_policy: TSberSmartAppExpandPolicy;
}

/**
 * Размеры для отступов.
 * Допустимые значения перечислены в типе (union).
 */
export type TSberSmartAppPadding =
    '0x' | '1x' | '2x' | '4x' | '5x' | '6x' | '8x' | '9x' | '10x' | '12x' | '16x';

/**
 * Действие карточки.
 * Описывает поведение при взаимодействии
 */
export interface ISberSmartAppCardAction {
    /**
     * Тип действия
     * @enum {string}
     * - text - отправка сообщения
     * - send_contact_phone - отправка номера
     * - deep_link - открытие ссылки
     */
    type: 'text' | 'send_contact_phone' | 'deep_link';

    /**
     * Текст сообщения
     * Для type='text'
     */
    text?: string;

    /**
     * Отправка в бэкенд
     * Для type='text'
     * @defaultValue true
     */
    should_send_to_backend?: boolean;

    /**
     * ID контакта
     * Для type='send_contact_phone'
     */
    send_contact_phone?: number;

    /**
     * Шаблон сообщения
     * Для type='send_contact_phone'
     */
    template?: string;

    /**
     * Ссылка
     * Для type='deep_link'
     */
    deep_link?: string;
}

/**
 * Стиль текста.
 * Допустимые значения перечислены в типе (union).
 */
export type TSberSmartAppTypeface =
    | 'headline1'
    | 'headline2'
    | 'headline3'
    | 'title1'
    | 'title2'
    | 'body1'
    | 'body2'
    | 'body3'
    | 'text1'
    | 'paragraphText1'
    | 'paragraphText2'
    | 'footnote1'
    | 'footnote2'
    | 'button1'
    | 'button2'
    | 'caption';
/**
 * Цвет текста.
 * Допустимые значения перечислены в типе (union).
 */
export type TSberSmartAppTextColor =
    'default' | 'secondary' | 'tertiary' | 'inverse' | 'brand' | 'warning' | 'critical' | 'link';

/**
 * Текст карточки.
 * Описывает форматированный текст
 */
export interface ISberSmartAppCardText {
    /**
     * Текст для отображения
     */
    text: string;

    /**
     * Стиль текста
     */
    typeface: TSberSmartAppTypeface;

    /**
     * Цвет текста
     */
    text_color: TSberSmartAppTextColor;

    /**
     * Отступы
     */
    margins?: ISberSmartAppCardPadding;

    /**
     * Максимум строк
     * 0 - без ограничений
     * @defaultValue 1
     */
    max_lines?: number;

    /**
     * Действия
     */
    actions?: ISberSmartAppCardAction | ISberSmartAppCardAction[];
}

/**
 * Отступы карточки.
 * Определяет размеры отступов
 */
export interface ISberSmartAppCardPadding {
    /**
     * Размер отступа.
     */
    left?: TSberSmartAppPadding;
    /**
     * Размер отступа.
     */
    top?: TSberSmartAppPadding;
    /**
     * Размер отступа.
     */
    right?: TSberSmartAppPadding;
    /**
     * Размер отступа.
     */
    bottom?: TSberSmartAppPadding;
}

/**
 * Изображение карточки.
 * Описывает изображение и его параметры
 */
export interface ISberSmartAppCardImage {
    /**
     * URL изображения
     */
    url?: string;

    /**
     * Хэш изображения
     */
    hash?: string;

    /**
     * Заглушка при ошибке
     */
    placeholder?: string;

    /**
     * Режим масштабирования
     * @enum {string}
     */
    scale_mode?:
        | 'scale_aspect_fill'
        | 'scale_aspect_fit'
        | 'center'
        | 'top'
        | 'bottom'
        | 'left'
        | 'right'
        | 'top_left'
        | 'top_right'
        | 'bottom_left'
        | 'bottom_right';

    /**
     * Высота контейнера
     * @defaultValue 192
     */
    height?: number;

    /**
     * Цвет фона
     */
    placeholder_color?:
        | 'solid_black'
        | 'solid_white'
        | 'solid_transparent'
        | 'solid_disabled'
        | 'solid_brand'
        | 'solid_warning'
        | 'solid_critical'
        | 'solid_action'
        | 'liquid_60'
        | 'liquid_50'
        | 'liquid_40'
        | 'liquid_30'
        | 'liquid_20'
        | 'liquid_10';

    /**
     * Действия
     */
    actions?: ISberSmartAppCardAction[];

    /**
     * Размер изображения
     */
    size?: {
        /**
         * Ширина в сетке
         */
        width: 'small' | 'medium' | 'large' | 'resizable';
        /**
         * Соотношение сторон
         */
        aspect_ratio: number;
    };
}

/**
 * Элемент карточки.
 * Описывает ячейку в карточке
 */
export interface ISberSmartAppCardItem {
    /**
     * Тип ячейки
     * @enum {string}
     */
    type:
        | 'greeting_grid_item'
        | 'media_gallery_item'
        | 'gallery_more_button_item'
        | 'image_cell_view'
        | 'text_cell_view'
        | 'left_right_cell_view';

    /**
     * Верхний текст
     */
    top_text?: ISberSmartAppCardText;

    /**
     * Нижний текст
     */
    bottom_text?: ISberSmartAppCardText;

    /**
     * Отступы
     */
    margins?: ISberSmartAppCardPadding;

    /**
     * Действия
     */
    actions?: ISberSmartAppCardAction[];

    /**
     * Изображение
     */
    image?: ISberSmartAppCardImage;

    /**
     * Отступы
     */
    paddings?: ISberSmartAppCardPadding;

    /**
     * Левая часть
     */
    left?: {
        /**
         * Тип ячейки
         */
        type: string;
        /**
         * Иконка
         */
        icon_vertical_gravity?: string;
        /**
         * Иконка в актуальном формате SmartApp API.
         */
        icon?: {
            /**
             * Адрес изображения.
             */
            address: {
                /**
                 * Тип адреса.
                 */
                type: string;
                /**
                 * URL изображения.
                 */
                url: string;
            };
            /**
             * Размер иконки.
             */
            size: {
                /**
                 * Ширина иконки.
                 */
                width: string;
                /**
                 * Высота иконки.
                 */
                height: string;
            };
            /**
             * Внешние отступы.
             */
            margins?: ISberSmartAppCardPadding;
        };
        /**
         * Тексты в актуальном формате SmartApp API.
         */
        texts?: {
            /**
             * Основной непустой текст.
             */
            title: ISberSmartAppCardText;
        };
        /**
         * Метка
         */
        label?: ISberSmartAppCardText;
        /**
         * Иконка и значение в устаревшем формате карточек.
         * @deprecated Актуальный SmartApp API использует поля `icon` и `texts`.
         */
        icon_and_value?: {
            /**
             * Иконка
             */
            icon?: {
                /**
                 * Расположение иконки
                 */
                address?: {
                    /**
                     * Тип иконки
                     */
                    type: string;
                    /**
                     * Ссылка на иконку
                     */
                    url: string;
                };
                /**
                 * Размеры иконки
                 */
                size: {
                    /**
                     * Ширина иконки
                     */
                    width: string;
                    /**
                     * Высота иконки
                     */
                    height: string;
                };
                /**
                 * Отступы
                 */
                margin?: ISberSmartAppCardPadding;
            };
            /**
             * Значение
             */
            value?: ISberSmartAppCardText;
        };
    };

    /**
     * Правая часть
     */
    right?: string;

    /**
     * Содержимое
     */
    content?: ISberSmartAppCardImage | ISberSmartAppCardText;
}

/**
 * Карточка
 * Описывает структуру карточки
 */
export interface ISberSmartAppCard {
    /**
     * Отступы
     */
    paddings?: ISberSmartAppCardPadding;

    /**
     * Возможность отключения
     * @defaultValue false
     */
    can_be_disabled?: boolean;

    /**
     * Тип карточки
     * @enum {string}
     * - gallery_card - горизонтальная галерея
     * - grid_card - сетка ячеек
     * - list_card - вертикальный список
     */
    type: 'gallery_card' | 'grid_card' | 'list_card';

    /**
     * Количество столбцов
     * @defaultValue 1
     */
    columns?: number;

    /**
     * Ширина контента
     */
    item_width?: 'small' | 'medium' | 'large' | 'resizable';

    /**
     * Ячейки карточки
     */
    items?: ISberSmartAppCardItem[];

    /**
     * Ячейки (альтернативное название)
     */
    cells?: ISberSmartAppCardItem[];
}

/**
 * Элемент ответа.
 * Описывает компонент ответа
 */
export interface ISberSmartAppItem {
    /**
     * Карточка
     */
    card?: ISberSmartAppCard;

    /**
     * Текст
     */
    bubble?: ISberSmartAppBubble;

    /**
     * Команда для выполнения платформой (например, close_app для завершения диалога)
     */
    command?: {
        /**
         * Тип команды
         */
        type: string;
    };
}

/**
 * Полезная нагрузка ответа.
 * Содержит данные для ответа пользователю
 */
export interface ISberSmartAppResponsePayload {
    /**
     * Текст для озвучивания
     */
    pronounceText: string;

    /**
     * Тип текста
     * Поддерживаемые разметки:
     * - application/text
     * - application/ssml
     */
    pronounceTextType: 'application/text' | 'application/ssml';

    /**
     * Эмоция ассистента
     */
    emotion?: {
        /**
         * ID эмоции
         */
        emotionId: TSberSmartAppEmotionId;
    };

    /**
     * Элементы интерфейса
     */
    items?: ISberSmartAppItem[];

    /**
     * Предложения
     * Кнопки для взаимодействия (карточки передаются отдельно — в items)
     */
    suggestions?: {
        /**
         * Кнопки
         */
        buttons: ISberSmartAppSuggestionButton[] | null;
    };

    /**
     * Интент для следующего ответа
     */
    intent: string;

    /**
     * Имя проекта
     */
    projectName: string;

    /**
     * Информация об устройстве
     */
    device: ISberSmartAppDeviceInfo;

    /**
     * Код ошибки
     */
    code?: number;

    /**
     * Автоматическое прослушивание
     * @defaultValue false
     */
    auto_listening?: boolean;

    /**
     * Завершение диалога
     * true - диалог завершен
     * false - диалог продолжается
     */
    finished: boolean;
}

/**
 * Ответ вебхука
 * Полный формат ответа смартапа
 */
export interface ISberSmartAppWebhookResponse {
    /**
     * Тип ответа.
     * Определяет логику обработки
     */
    messageName?: TSberResponseMessageName;

    /**
     * ID сессии
     * Обновляется при new_session=true
     */
    sessionId: string;

    /**
     * ID ответа
     * Должен совпадать с ID запроса
     */
    messageId: number;

    /**
     * ID пользователя
     */
    uuid: ISberSmartAppUuId;

    /**
     * Данные ответа.
     * Зависят от типа сообщения
     */
    payload?: ISberSmartAppResponsePayload | object;
}

/**
 * Сессия смартапа.
 * Содержит данные о текущей сессии
 */
export interface ISberSmartAppSession {
    /**
     * Информация об устройстве
     */
    device: ISberSmartAppDeviceInfo;

    /**
     * Метаданные
     */
    meta: ISberSmartAppMetaInfo;

    /**
     * ID сессии
     */
    sessionId: string;

    /**
     * ID сообщения
     */
    messageId: number;

    /**
     * ID пользователя
     */
    uuid: ISberSmartAppUuId;

    /**
     * Имя проекта
     */
    projectName: string;
}

/**
 * Параметры изображения карточки SmartApp (list_card): настройки шрифта,
 * цвета и ограничения строк для заголовка и описания.
 */
export interface ISberSmartImageParam extends IImageParams {
    /**
     * Шрифт описания изображения
     */
    descTypeface: TSberSmartAppTypeface;
    /**
     * Цвет текста описания изображения
     */
    descText_color: TSberSmartAppTextColor;
    /**
     * Максимальное число строк описания
     */
    descMax_lines: number;
    /**
     * Шрифт заголовка изображения
     */
    titleTypeface: TSberSmartAppTypeface;
    /**
     * Цвет текста заголовка изображения
     */
    titleText_color: TSberSmartAppTextColor;
    /**
     * Максимальное число строк заголовка
     */
    titleMax_lines: number;
}
