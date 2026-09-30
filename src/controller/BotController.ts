/**
 * Модуль контроллера - основной компонент для обработки бизнес-логики вашего приложения
 */
import { Buttons, Card, Sound, Nlu, INluThisUser } from '../components';
import { Text } from '../utils/standard/Text';
import { AppContext, IAppIntent, ICommandParam, TAppType, EMetric } from '../core';
import { FALLBACK_COMMAND, HELP_INTENT_NAME, WELCOME_INTENT_NAME } from '../core/constants';
import { isPromise } from '../utils/isPromise';
import {
    IGroupData,
    getGroupRegExpCompiled,
    IEventParam,
    ISearchPlan,
} from '../core/utils/CommandReg';
import type { TEventType } from '../core/events';
import { __$usedRe2, type TPatternRegExp } from '../utils/standard/RegExp';

/*
 * Оптимизация производительности:
 * Если напрямую использовать переменные из другого модуля (например FALLBACK_COMMAND), то производительность может проседать.
 * За счет данного хака мы решаем эту проблему, добавляя локальную глобальную переменную, благодаря чему v8 не нужно делать доп расчеты.
 *
 * ВАЖНО: константы импортируются из листового модуля `../core/constants`, а НЕ из барреля `../core`.
 * Баррель `core` реэкспортирует `Bot` раньше констант, и при циклической загрузке
 * (core → Bot → controller → core) константы из барреля ещё `undefined`. Листовой модуль
 * без импортов всегда полностью инициализирован, поэтому захват значений безопасен.
 */
const DEFAULT_FALLBACK_COMMAND = FALLBACK_COMMAND;
const DEFAULT_HELP_INTENT_NAME = HELP_INTENT_NAME;
const DEFAULT_WELCOME_INTENT_NAME = WELCOME_INTENT_NAME;

/**
 * Тип статуса операции
 * Определяет результат выполнения операции
 *
 * @remarks
 * Возможные значения:
 * - true: операция выполнена успешно
 * - false: операция завершилась с ошибкой
 * - null: операция не выполнялась
 *
 * @example
 * ```ts
 * const okStatus: TStatus = true; // операция успешна
 * const errStatus: TStatus = false; // операция с ошибкой
 * const skipStatus: TStatus = null; // операция не выполнялась
 * ```
 */
export type TStatus = true | false | null;

/**
 * Интерфейс событий пользователя
 * Содержит информацию о различных действиях пользователя в приложении
 *
 * @remarks
 * События включают:
 * - Авторизацию пользователя
 * - Оценку приложения
 *
 * @example
 * ```ts
 * const userEvent: IUserEvent = {
 *   auth: { // Событие авторизации
 *     status: true // пользователь успешно авторизовался
 *   },
 *   rating: { // Событие с оценкой
 *     status: true,
 *     value: 5 // пользователь поставил оценку 5
 *   }
 * };
 * ```
 */
export interface IUserEvent {
    /**
     * Информация об авторизации пользователя.
     * Содержит статус авторизации и дополнительные данные
     */
    auth?: {
        /**
         * Статус авторизации
         * @remarks
         * - true: авторизация успешна
         * - false: авторизация не удалась
         * - null: авторизация не выполнялась
         */
        status: TStatus;
    };
    /**
     * Информация об оценке приложения пользователем.
     * Содержит статус оценки и её значение
     */
    rating?: {
        /**
         * Статус выставления оценки
         * @remarks
         * - true: оценка выставлена
         * - false: пользователь отказался от оценки
         * - null: оценка не запрашивалась
         */
        status: TStatus;
        /**
         * Числовое значение выставленной оценки
         * @remarks
         * Обычно от 1 до 5
         */
        value?: number;
    };
}

/**
 * Интерфейс для пользовательских данных
 * Расширяемый интерфейс для любых дополнительных данных, которые будут сохранены в БД/Локальное хранилище
 *
 * @remarks
 * Базовое поле:
 * - oldIntentName: название предыдущего интента. Актуально для случаев, когда в приложении есть какая-то последовательность действий.
 * Также данное значение можно использовать при регистрации обработчика на шаг (bot.addStep('...', ()=>{...})).
 *
 * Дополнительные поля могут быть добавлены через:
 * 1. Расширение интерфейса (extends)
 * 2. Индексную сигнатуру [key: string]: unknown. Не рекомендуется к использованию, так как в таком случае, теряются преимущества ts
 *
 * @example
 * ```ts
 * // Способ 1: Расширение интерфейса
 * interface MyUserData extends IUserData {
 *   name: string;
 *   preferences: {
 *     language: string;
 *     theme: string;
 *   };
 * }
 *
 * // Способ 2: Использование индексной сигнатуры
 * interface DynamicUserData extends IUserData {
 *   [key: string]: unknown;
 * }
 *
 * const userData: MyUserData = {
 *   oldIntentName: 'greeting',
 *   name: 'John',
 *   preferences: {
 *     language: 'ru',
 *     theme: 'dark'
 *   }
 * };
 *
 * const dynamicData: DynamicUserData = {
 *   oldIntentName: 'greeting',
 *   customField1: 'value1',
 *   customField2: 42,
 *   customObject: {
 *     nested: true
 *   }
 * };
 * ```
 */
export interface IUserData {
    /**
     * Название предыдущего интента.
     * Используется для отслеживания контекста диалога, и реализации механизма для последовательного прохождения сценария приложения.
     *
     * @example
     * ```ts
     * this.userData.oldIntentName = 'greeting';
     * ```
     */
    oldIntentName?: string | null;

    /**
     * Дополнительные пользовательские данные.
     * Может содержать любые поля, специфичные для приложения
     * Важно! Если вы хотите, чтобы поле было удалено, то необходимо в значение передавать null.
     */
    [key: string]: unknown;
}

/**
 * Интерфейс для пользовательских данных, хранящихся в локальном хранилище
 * Расширяемый интерфейс для любых дополнительных данных, которые будут сохранены в Локальное хранилище
 */
export interface IPlatformData {
    /**
     * Название предыдущего интента.
     * Специальное служебное поле: позволяет Bot восстановить шаг диалога
     * после сериализации state в локальное хранилище платформы.
     *
     * @internal — заполняется фреймворком, не предназначено для прямой записи в пользовательском коде.
     */
    oldIntentName?: string | null;
    /**
     * Дополнительные данные.
     * Может содержать любые поля, специфичные для приложения
     */
    [key: string]: unknown;
}

/**
 * Дополнительные опции для платформ
 */
export interface IPlatformOptions {
    /**
     * Текст ошибки
     */
    error?: string;
    /**
     * Время начала обработки запроса
     */
    timeStart?: number;
    /**
     * Готовый shortcut-ответ платформы (строка или объект), который run() возвращает
     * без обработки запроса. Заполняется адаптером в особых случаях (health-check
     * «ping» у Алисы/Маруси, токен подтверждения webhook у VK); в формировании
     * обычного ответа не участвует, если shortcut не нужен — остаётся null.
     */
    sendInInit?: string | object | null;

    /**
     * Нейтральные технические данные обработчика запроса.
     *
     * Адаптеры используют собственный ключ верхнего уровня, поэтому общий
     * контроллер не содержит сведений о форматах и идентификаторах платформ.
     */
    requestData?: Record<string, Record<string, unknown>>;

    /**
     * Поле куда должны сохраниться пользовательские данные
     */
    stateName?: string;
    /**
     * Флаг, говорящий о том, что в приложении может использоваться локальное хранилище платформы
     */
    isState?: boolean;
    /**
     * Флаг, говорящий о том, что приложение использует локальное хранилище платформы
     */
    usedLocalStorage?: boolean;
    /**
     * Информация о сессии пользователя
     */
    session?: object;

    /**
     * Идентификатор приложения
     */
    appId?: string;
    /**
     * ID callback-запроса
     */
    callbackQueryId?: string;

    /**
     * Явно заданный текст всплывающего уведомления для callback-запроса.
     * Если поле не задано, адаптер только подтверждает callback без показа текста.
     */
    callbackNotificationText?: string;

    /**
     * ID callback-события (для callback-кнопок)
     */
    eventId?: string;
    /**
     * Версия api с которой работает платформа. Для случаев, когда сама платформа говорит какая версия api должна быть
     */
    apiVersion?: string | number;
    /**
     * ID чата для платформ, поддерживающих групповые чаты (например, Max, Telegram)
     */
    chatId?: number;
    /**
     * IP-адрес клиента, с которого пришёл webhook-запрос.
     * Заполняется фреймворком автоматически в `webhookHandle` (из сокета
     * HTTP-запроса) или в `webhookEvent`/`run()` при передаче параметром.
     * Используется middleware `ipFilter`.
     */
    clientIp?: string;
}

/**
 * Универсальные параметры для методов отправки медиа через {@link IControllerApi}.
 */
export interface IApiMediaParams {
    /**
     * Подпись к медиа (там, где платформа поддерживает подписи).
     */
    caption?: string;
}

/**
 * Методы API-фасада, которые можно проверять через {@link IControllerApi.can}.
 *
 * Единый источник контракта фасада: и `IControllerApi` здесь, и реализация
 * в `src/plugins/platforms/Base/apiFacade.ts` (алиас `TApiFacade`) используют
 * именно это имя.
 */
export type TApiMethod =
    'sendPhoto' | 'sendDocument' | 'sendAudio' | 'sendVideo' | 'answerCallback';

/**
 * Универсальный API-фасад активной платформы (`controller.api`).
 *
 * Даёт бизнес-логике доступ к возможностям платформы — отправить медиа, ответить
 * на callback-кнопку — без ручного конструирования платформенных Request-классов.
 * Реализация подбирается адаптером по `controller.appType`; интерфейс объявлен
 * здесь, чтобы контроллер не зависел от модулей платформ.
 */
export interface IControllerApi {
    /**
     * Отправляет фотографию пользователю текущего запроса.
     */
    sendPhoto(image: string, params?: IApiMediaParams): Promise<Record<string, unknown> | null>;
    /**
     * Отправляет документ/файл пользователю текущего запроса.
     */
    sendDocument(file: string, params?: IApiMediaParams): Promise<Record<string, unknown> | null>;
    /**
     * Отправляет аудио пользователю текущего запроса.
     */
    sendAudio(file: string, params?: IApiMediaParams): Promise<Record<string, unknown> | null>;
    /**
     * Отправляет видео пользователю текущего запроса.
     */
    sendVideo(file: string, params?: IApiMediaParams): Promise<Record<string, unknown> | null>;
    /**
     * Отвечает на нажатие callback-кнопки: показывает уведомление/snackbar
     * (Telegram `answerCallbackQuery`, VK `show_snackbar`, MAX `/answers`).
     * Вне callback-запроса — предупреждение в лог и `null`.
     *
     * @param text Текст уведомления
     * @param showAlert Показать как модальное окно вместо всплывающего уведомления.
     *   Поддерживает только Telegram; VK (snackbar) и MAX игнорируют параметр.
     */
    answerCallback(text: string, showAlert?: boolean): Promise<Record<string, unknown> | null>;
    /**
     * Проверяет, поддерживает ли активная платформа указанный метод фасада
     * (например, Viber возвращает `false` для всех — его Bot API требует
     * URL + size, которые фасад не собирает).
     */
    can(method: TApiMethod): boolean;
}

/**
 * Контроллер приложения – главный класс для реализации единой бизнес-логики вашего приложения. Именно в этом классе обрабатывается вся логика вашего приложения, которая потом передается в саму платформу, будь то голосовой навык для Алисы, либо чат-бот для VK.
 *
 * Этот класс связывает входящие запросы от пользователя с вашей бизнес‑логикой.
 * Вы наследуетесь от `BotController`, переопределяете метод {@link action} и получаете доступ ко всем инструментам:
 * кнопкам, карточкам, состоянию диалога, пользовательским данным, NLU и многому другому.
 *
 * Адаптеры платформ (например, `AlisaAdapter`) автоматически наполняют контроллер данными,
 * вызывают метод {@link run} (он вызывает ваш `action()`), а затем формируют ответ на основе заполненных вами полей (`text`, `buttons`, `card` и т.д.).
 *
 * **Ключевая особенность:** вся логика вашего голосового навыка или бота описывается в одном месте – в методе `action()`.
 * Фреймворк сам позаботится о маршрутизации: команды, интенты, шаги диалога – всё придёт в `action` с соответствующим флагом.
 *
 * @remarks
 * Основные возможности:
 * - Обработка пользовательских команд и интентов
 * - Управление состоянием диалога
 * - Работа с UI компонентами (кнопки, карточки)
 * - Управление пользовательскими данными
 *
 * @example
 * ```ts
 * import { BotController, IUserData, WELCOME_INTENT_NAME, HELP_INTENT_NAME } from 'umbot';
 * // Определение пользовательских данных
 * interface MyUserData extends IUserData {
 *   score: number;
 *   level: number;
 *   preferences: {
 *     language: string;
 *     theme: string;
 *   };
 * }
 *
 * class MyController extends BotController<MyUserData> {
 *   public action(intentName: string | null): void {
 *     try {
 *       // Обработка приветствия
 *       if (intentName === WELCOME_INTENT_NAME) {
 *         // Текстовый ответ
 *         this.text = 'Привет! Чем могу помочь?';
 *
 *         // Добавление кнопок
 *         this.buttons
 *           .addBtn('Помощь')
 *           .addBtn('Выход');
 *
 *         // Добавление карточки
 *         this.card
 *           .addImage('xxx', 'Добро пожаловать!', 'Выберите действие:')
 *           .addButton('Начать игру')
 *
 *         // Установка пользовательских данных.
 *         // Важно: мутируйте поля, а не переприсваивайте this.userData целиком —
 *         // фреймворк хранит ссылку на объект
 *         this.userData.score = 0;
 *         this.userData.level = 1;
 *         this.userData.preferences = {
 *           language: 'ru',
 *           theme: 'light'
 *         };
 *         return;
 *       }
 *
 *       // Обработка команды помощи
 *       if (intentName === HELP_INTENT_NAME) {
 *         this.text = 'Я могу помочь вам с...';
 *         this.buttons.addBtn('Назад');
 *         return;
 *       }
 *
 *       // Обработка пользовательских событий
 *       if (this.userEvents?.auth?.status) {
 *         this.text = 'Вы успешно авторизовались!';
 *       }
 *
 *       // Обработка оценки
 *       if (this.userEvents?.rating?.status) {
 *         const rating = this.userEvents.rating.value;
 *         this.text = `Спасибо за оценку ${rating}!`;
 *       }
 *
 *     } catch (error) {
 *       // Обработка ошибки
 *       this.text = 'Произошла ошибка. Попробуйте позже.';
 *     }
 *   }
 * }
 * ```
 * @see {@link action} – переопределите этот метод, чтобы добавить свою логику.
 * @see см. класс Bot в umbot — основной класс приложения, управляющий адаптерами и контроллерами.
 *
 * @group Основное
 */
export abstract class BotController<
    TUserData extends IUserData = IUserData,
    TPlatformState extends IPlatformData = IPlatformData,
> {
    #buttons: Buttons | undefined;
    #card: Card | undefined;
    #nlu: Nlu | undefined;
    #sound: Sound | undefined;

    /**
     * Текст, который будет отображен пользователю.
     * Основной способ коммуникации с пользователем, так как именно этот текст пользователь увидит в интерфейсе.
     *
     * @example
     * ```ts
     * this.text = 'Привет! Чем могу помочь?';
     * ```
     */
    public text: string = '';

    /**
     * Текст, который пользователь может услышать.
     * Для голосовых платформ, озвучка будет произведена силами самой платформы, для не голосовых платформ, поведение зависит непосредственно от реализации адаптера.
     * Так для некоторых стандартных адаптеров, в случае заполнения поля и указания токена yandex SpeechKit, будет отправлен запрос на преобразование текста в аудиофайл, после чего аудиофайл будет отправлен пользователю.
     *
     * @example
     * ```ts
     * this.tts = 'Привет! Я голосовой ассистент.';
     * ```
     */
    public tts: string | null = null;

    /**
     * Уникальный идентификатор пользователя.
     *
     * @example
     * ```ts
     * this.userId = 'user_123';    // Telegram (string)
     * this.userId = 123456789;     // VK (number)
     * this.userId = null;          // не удалось получить информацию
     * ```
     */
    public userId: string | number | null = null;

    /**
     * Пользовательский токен авторизации.
     * Заполняется адаптером Алисы (access_token из account linking после
     * авторизации пользователя). Читайте его для запросов к внешним API,
     * требующим авторизации пользователя.
     *
     * @example
     * ```ts
     * this.userToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
     * ```
     */
    public userToken: string | null = null;

    /**
     * Дополнительная информация о пользователе.
     *
     * @example
     * ```ts
     * this.userMeta = {
     *   timezone: 'Europe/Moscow',
     *   locale: 'ru-RU'
     * };
     * ```
     */
    public userMeta: unknown | null = null;

    /**
     * ID сообщения.
     * На голосовых платформах (Алиса, Маруся) `messageId === 0` означает начало
     * нового диалога — по этому признаку срабатывает welcome-интент. На чат-платформах
     * (Telegram, VK, Max, Viber) это ID конкретного сообщения, и поле может быть null.
     *
     * @example
     * ```ts
     * this.messageId = 12345;
     * ```
     */
    public messageId: number | string | null = null;

    /**
     * Запрос пользователя в нижнем регистре.
     *
     * @example
     * ```ts
     * this.userCommand = 'привет мир';
     * ```
     */
    public userCommand: string | null = null;

    /**
     * Оригинальный запрос пользователя.
     * Текст запроса без изменений, включая регистр и знаки препинания.
     *
     * @example
     * ```ts
     * this.originalUserCommand = 'Привет, мир!';
     * ```
     */
    public originalUserCommand: string | null = null;

    /**
     * Дополнительные параметры запроса.
     * Может содержать любые дополнительные данные, полученные от платформы.
     *
     * @example
     * ```ts
     * this.payload = {
     *   source: 'mobile',
     *   version: '1.0'
     * };
     * ```
     */
    public payload: Record<string, unknown> | string | null | undefined = null;

    /**
     * Универсальный тип события, вызвавшего запрос (`'message'`, `'photo'`, `'callback'`, …).
     *
     * Заполняется адаптером платформы. Позволяет различать не-текстовые апдейты
     * (фото, голосовые, нажатия кнопок) без ручного разбора `requestObject`.
     * Если платформа не проставила событие, значение — `'message'`.
     *
     * @example
     * ```ts
     * // В action() или обработчике команды:
     * if (this.eventType === 'photo') {
     *   this.text = 'Отличное фото!';
     * }
     * ```
     */
    public eventType: TEventType = 'message';

    /**
     * Результат совпадения команды с регулярным выражением.
     *
     * Заполняется лениво при первом обращении: фреймворк запоминает регулярку
     * сработавшей команды (RegExp-слот, isPattern-паттерн или группу регулярок)
     * и прогоняет её по тексту только если обработчик реально читает `match`.
     * Содержит `RegExpExecArray` совпавшей регулярки — группы доступны как
     * `this.match[1]`, `this.match.groups`. Для строковых команд и событий — `null`.
     *
     * @example
     * ```ts
     * bot.addCommand('order', [/(?:заказ|купить)\s+(\d+)/], (_, ctx) => {
     *   ctx.text = `Оформляю заказ №${ctx.match?.[1]}`;
     * });
     * ```
     */
    public get match(): RegExpExecArray | null {
        const reg = this.#matchReg;
        if (reg === null) {
            return this.#matchValue;
        }
        // «Рецепт» расходуется первым же чтением: повторные обращения
        // получают готовое значение без второго прогона.
        this.#matchReg = null;
        if (reg.lastIndex !== 0) {
            reg.lastIndex = 0;
        }
        const m = reg.exec(this.#matchUserCommand);
        if (m) {
            this.#matchValue = m;
            return m;
        }
        this.#matchValue = null;
        return null;
    }

    /**
     * Прямая запись match — сохраняет значение без ленивого вычисления.
     * @internal используется тестами и расширенными сценариями
     */
    public set match(value: RegExpExecArray | null) {
        this.#matchReg = null;
        this.#matchUserCommand = '';
        this.#matchValue = value;
    }

    /**
     * Ленивый «рецепт» match: регулярка сработавшей команды. Хранится плоскими
     * полями (без объекта-рецепта): schedule в горячем пути не аллоцирует вовсе.
     * null — рецепта нет (match уже вычислен или строковая команда).
     */
    #matchReg: RegExp | null = null;

    /**
     * Текст запроса для ленивого прогона регулярки ({@link match}).
     */
    #matchUserCommand: string = '';

    /**
     * Кэшированное значение match после ленивого вычисления (или прямого set).
     */
    #matchValue: RegExpExecArray | null = null;

    /**
     * Запоминает регулярку сработавшей команды для ленивого {@link match}.
     * Вызывается из конвейера поиска после совпадения команды: сам прогон
     * не выполняется — горячий путь не платит за match, который никто не читает.
     */
    #scheduleMatch(reg: RegExp, userCommand: string): void {
        this.#matchReg = reg;
        this.#matchUserCommand = userCommand;
    }

    /**
     * Пользовательские данные, которые были сохранены.
     *
     * ⚠️ Мутируйте отдельные поля (`this.userData.name = ...`), а не
     * переприсваивайте объект целиком (`this.userData = {...}`) — фреймворк
     * хранит ссылку на исходный объект, и переприсваивание разрывает её.
     *
     * @example
     * ```ts
     * // Тип контроллера с дженериком:
     * // class MyController extends BotController<MyUserData> { ... }
     * this.userData.name = 'John';
     * this.userData.score += 1;
     * this.userData.preferences = { language: 'ru' };
     * ```
     */
    public userData: TUserData = {} as TUserData;

    /**
     * Флаг необходимости авторизации.
     * Определяет, требуется ли авторизация пользователя или нет.
     *
     * @example
     * ```ts
     * this.isAuth = true; // требуется авторизация
     * ```
     */
    public isAuth: boolean = false;

    /**
     * Пользовательские события.
     * Содержит информацию об авторизации или оценке.
     *
     * @see IUserEvent
     * @example
     * ```ts
     * this.userEvents = {
     *   auth: { status: true },
     *   rating: { status: true, value: 5 }
     * };
     * ```
     */
    public userEvents: IUserEvent | null = null;

    /**
     * Пользовательское локальное хранилище.
     * Используется для временного хранения данных, специфичных для текущего диалога.
     * Работает только при включённой опции `isLocalStorage: true` в конфигурации.
     * bot.setAppConfig({
     *    isLocalStorage: true,
     * });
     *
     * **Правила синхронизации с базой данных (если подключена):**
     * - Если заполнены и `userData`, и `state`: `userData` сохраняется в БД,
     *   а `state` — в локальное хранилище платформы.
     * - Если заполнен только `userData` (а `state` пуст или совпадает с ним):
     *   при использовании локального хранилища данные уходят только в него
     *   (в БД не сохраняются), без локального хранилища — только в БД.
     * - Если заполнен только `state` (userData пуст): перед формированием
     *   ответа userData подменяется на `state`, поэтому `state` уходит
     *   в локальное хранилище платформы, а без него — в БД.
     *
     * **При загрузке данных:**
     * 1. Если используется локальное хранилище платформы, его запись сразу
     *    записывается и в `userData`, и в `state` (у Алисы и Маруси это
     *    один и тот же объект); данные из БД при этом не читаются.
     * 2. Без локального хранилища данные пользователя читаются из БД в `userData`;
     *    `state` остаётся тем, что прислала платформа (у чат-платформ — null).
     *
     * @see {@link userData} — для постоянного хранения данных пользователя.
     *
     * @example
     * ```ts
     * this.state = {
     *   lastIntent: 'greeting',
     *   step: 1
     * };
     * ```
     */
    public state: TPlatformState | null = null;

    /**
     * Определяет, запущено ли приложение с колонки или с устройства с экраном.
     *
     * @example
     * ```ts
     * this.isScreen = true; // экран доступен
     * ```
     */
    public isScreen: boolean = false;

    /**
     * Флаг, определяющий необходимость завершения диалога. Актуально когда необходимо принудительно завершить диалог с пользователем.
     * Поддержка работы флага зависит от платформы.
     *
     * @example
     * ```ts
     * this.isEnd = true; // завершить диалог
     * ```
     */
    public isEnd: boolean = false;

    /**
     * Флаг, указывающий, что ответ уже отправлен через API и не требуется автоматическая отправка. Как правило, данный флаг стоит использовать для платформ, которые не ждут ответ в виде возвращаемого содержимого, а ожидают что к самой платформе будет отправлен запрос. Например, чат-бот для Telegram, для отображения результата пользователю, отправляется запрос к платформе с нужным содержимым.
     *
     * @remarks
     * Если указано true, значит все необходимые запросы уже отправлены в логике приложения, и дополнительно пользователю ничего отправлять не нужно.
     *
     * @example
     * ```ts
     * this.skipAutoReply = true; // запросы уже отправлены
     * ```
     */
    public skipAutoReply: boolean = false;

    /**
     * Полученный запрос от платформы.
     * Содержит оригинальный объект запроса.
     *
     * @example
     * ```ts
     * this.requestObject = {
     *   command: 'start',
     *   payload: { source: 'mobile' }
     * };
     * ```
     */
    public requestObject: Record<string, unknown> | string | unknown | null = null;

    /**
     * Название текущего интента.
     * Определяет следующий шаг диалога.
     *
     * @example
     * ```ts
     * this.thisIntentName = 'help';
     * ```
     */
    public thisIntentName: string | null = null;

    /**
     * Эмоция для голосового ответа.
     * Используется для платформ, которые поддерживают данное поведение.
     *
     * @example
     * ```ts
     * this.emotion = 'good';
     * ```
     */
    public emotion: string | null = null;

    /**
     * Стиль обращения к пользователю.
     * Определяет формальность общения, используется для платформ, которые поддерживают данное поведение.
     *
     * @remarks
     * Возможные значения:
     * - 'official': официальное обращение
     * - 'no_official': неофициальное обращение
     * - null: стиль не определен
     *
     * @example
     * ```ts
     * this.appeal = 'official'; // официальное обращение
     * ```
     */
    public appeal: 'official' | 'no_official' | null = null;

    /**
     * Флаг отправки запроса на оценку.
     * Определяет, нужно ли запросить оценку у пользователя.
     * Используется для платформ, которые поддерживают данное поведение.
     *
     * @example
     * ```ts
     * this.isSendRating = true; // запросить оценку
     * ```
     */
    public isSendRating: boolean = false;

    /**
     * Название предыдущего интента/команды, полученное из `userData.oldIntentName`
     * (а при включённом локальном хранилище и пустом `userData` — из
     * `state.oldIntentName`).
     * Используется для отслеживания контекста диалога.
     *
     * @remarks
     * **КАК ЭТО РАБОТАЕТ:**
     * 1. В конце обработки каждого запроса `this.thisIntentName` сохраняется:
     *    при включённом `isLocalStorage` и пустом `userData` — в `state.oldIntentName`,
     *    иначе — в `userData.oldIntentName`
     * 2. При следующем запросе это значение копируется в `this.oldIntentName`
     * 3. Используется для определения, с какого шага продолжить диалог
     *
     * **ТИПИЧНОЕ ИСПОЛЬЗОВАНИЕ:**
     * - Возврат к предыдущему шагу
     * - Многошаговые формы ("вернуться назад")
     * - Диалоги с контекстом
     * - Использование в шагах `bot.addStep()`
     *
     * @example
     * ```ts
     * // Пример: Многошаговая регистрация
     * class RegistrationBot extends BotController {
     *   public action(intentName: string | null): void {
     *     // Определяем на каком шаге находимся
     *     const previousStep = this.oldIntentName;
     *
     *     if (previousStep === 'enter_name') {
     *       // Пользователь только что ввел имя, спрашиваем email
     *       this.userData.name = this.userCommand;
     *       this.text = 'Отлично! Теперь введите ваш email:';
     *       this.thisIntentName = 'enter_email'; // Сохранится для следующего шага
     *     } else if (previousStep === 'enter_email') {
     *       // Пользователь ввел email, завершаем регистрацию
     *       this.userData.email = this.userCommand;
     *       this.text = 'Регистрация завершена!';
     *     }
     *   }
     * }
     *
     * // Пример: Кнопка "Назад"
     * if (intentName === 'back') {
     *   // Возвращаемся к предыдущему шагу
     *   switch(this.oldIntentName) {
     *     case 'product_list':
     *       this.text = 'Выберите категорию:';
     *       break;
     *     case 'category_list':
     *       this.text = 'Добро пожаловать!';
     *       break;
     *   }
     * }
     * ```
     */
    public oldIntentName: string | null = null;

    /**
     * Контекст приложения.
     */
    public appContext: AppContext;

    /**
     * Платформа, от которой был получен запрос.
     */
    public appType: TAppType | null = null;

    /**
     * Дополнительные опции платформы.
     * ⚠️ Внутреннее свойство. Заполняется адаптером платформы.
     * Не предназначено для прямого использования в пользовательском коде.
     */
    public platformOptions: IPlatformOptions = {};

    #getCustomRegExp: RegExpConstructor | undefined;

    /**
     * Создает новый экземпляр контроллера.
     * UI-компоненты (кнопки, карточки, звуки, NLU) инициализируются лениво —
     * при первом обращении через соответствующие геттеры.
     *
     * @param {AppContext} [appContext] - Контекст приложения. Если не передан, будет создан новый AppContext
     */
    constructor(appContext?: AppContext) {
        // Для корректности выставляем контекст по умолчанию.
        this.appContext = appContext || new AppContext();
        this.#getCustomRegExp = this.appContext.command.getCustomRegExp();
    }

    /**
     * Компонент для отображения различных кнопок пользователю.
     * Позволяет создавать интерактивные элементы управления в приложении.
     *
     * @remarks
     * ## 🎯 ТИПИЧНОЕ ИСПОЛЬЗОВАНИЕ:
     * - Навигация по меню
     * - Быстрые ответы (Да/Нет)
     * - Выбор из вариантов
     * - Быстрое действие/команда
     *
     *
     * @see Buttons
     * @example
     * ```ts
     * this.buttons
     *   .addBtn('Помощь')
     *   .addBtn('Выход');
     * ```
     */
    get buttons(): Buttons {
        if (!this.#buttons) {
            this.#buttons = new Buttons(this.appContext);
        }
        return this.#buttons;
    }

    /**
     * Флаг возвращающий информацию о том, были ли инициализированы кнопки или нет
     * @returns {boolean} true если кнопки были инициализированы
     */
    isButtonsInit(): boolean {
        return !!this.#buttons;
    }

    /**
     * Компонент для отображения карточек пользователю.
     * Позволяет создавать визуальные элементы с изображениями и текстом.
     * Также при указании нескольких изображений, они автоматически преобразуются в карточку.
     *
     * @remarks
     * ## 🎯 КОГДА ИСПОЛЬЗОВАТЬ:
     * - Каталог товаров/услуг
     * - Галерея изображений
     * - Карточки статей/новостей
     * - Навигация
     *
     * @see Card
     * @example
     * ```ts
     * // КАТАЛОГ ТОВАРОВ (интернет-магазин):
     * this.text = 'Популярные товары:';
     * this.card
     *   .addImage(
     *     'http://localhost/iphone.jpg',
     *     'iPhone 15 Pro',
     *     '99 990 ₽\nЭкран 6.1", процессор A17 Pro'
     *   )
     *   .addButton('Купить')
     *
     *   .addImage(
     *     'http://localhost/macbook.jpg',
     *     'MacBook Air M2',
     *     '124 990 ₽\n13.6", 8ГБ RAM, 256ГБ SSD'
     *   )
     *   .addButton('Купить');
     *
     * // ГАЛЕРЕЯ ФОТОГРАФИЙ:
     * this.text = 'Наши работы:';
     * this.card
     *   .addImage('photo1.jpg', 'Свадьба', 'Иван и Мария')
     *   .addImage('photo2.jpg', 'Выпускной', 'Школа №123')
     *   .addImage('photo3.jpg', 'Корпоратив', 'Компания "Рога и копыта"');
     *
     * // КАРТОЧКИ НОВОСТЕЙ:
     * this.card
     *   .addImage(
     *     'news1.jpg',
     *     'Новое обновление',
     *     'Добавлена оплата картой и доставка',
     *     {
     *         title: 'Перейти',
     *         url: 'http://localhost/news/1'
     *     }
     *   )
     * ```
     */
    get card(): Card {
        if (!this.#card) {
            this.#card = new Card(this.appContext);
        }
        return this.#card;
    }

    /**
     * Флаг возвращающий информацию о том, были ли инициализированы карточки или нет
     * @returns {boolean} true если карточки были инициализированы
     */
    isCardInit(): boolean {
        return !!this.#card;
    }

    /**
     * Компонент для работы со звуками.
     * Позволяет добавлять звуковые эффекты и музыку. Используется вместе с tts.
     *
     * @see Sound
     */
    get sound(): Sound {
        if (!this.#sound) {
            this.#sound = new Sound();
        }
        return this.#sound;
    }

    /**
     * Флаг возвращающий информацию о том, были ли инициализированы звуки или нет
     * @returns {boolean} true если звуки были инициализированы
     */
    isSoundInit(): boolean {
        return !!this.#sound;
    }

    /**
     * Обработанный NLU (Natural Language Understanding).
     * Содержит результаты обработки естественного языка, как правило, данные заполняются самой платформой.
     *
     * @see Nlu
     */
    get nlu(): Nlu {
        if (!this.#nlu) {
            this.#nlu = new Nlu();
            // Чат-платформы записывают данные отправителя через setThisUser()
            // ещё до обращения бизнес-логики к NLU. Буфер держится отдельно от
            // объекта Nlu: если логика ни разу не прочитает thisUser/getFio/etc,
            // сам объект Nlu (+кэш) не аллоцируется вовсе.
            if (this.#thisUserBuffer) {
                this.#nlu.setNlu({ thisUser: this.#thisUserBuffer });
                this.#thisUserBuffer = undefined;
            }
        }
        return this.#nlu;
    }

    /**
     * Буфер данных отправителя для чат-платформ.
     *
     * Заполняется при разборе запроса адаптером — через {@link setThisUser}
     * (хелпер setThisUserToNlu из pUtils) — и «досыпается» в Nlu при первом
     * обращении к геттеру {@link nlu}. Пока логика приложения NLU не читает,
     * объект Nlu не создаётся — это экономит аллокацию на каждом запросе
     * чат-платформ.
     */
    #thisUserBuffer: INluThisUser | undefined;

    /**
     * Ленивый API-фасад активной платформы ({@link api}).
     *
     * Создаётся фабрикой при первом обращении к `ctx.api`; на запросах, где
     * API-методы не используются, объект не аллоцируется вовсе.
     */
    #api: IControllerApi | null | undefined;

    /**
     * Фабрика API-фасада: устанавливается ядром при запуске, чтобы контроллер
     * не зависел от модулей платформ (архитектурное правило core/controller
     * ← plugins). null для голосовых платформ — там фасад недоступен.
     */
    #apiFactory: ((controller: BotController) => IControllerApi | null) | undefined;

    /**
     * API активной платформы: отправка медиа и ответов на callback-кнопки
     * без ручного конструирования платформенных Request-классов.
     *
     * Доступно на чат-платформах (Telegram, VK, MAX, Viber с оговорками);
     * на голосовых (Алиса, Маруся, SmartApp) — `null`: их ответ формируется
     * телом webhook, используйте `card`/`sound`.
     *
     * @example
     * ```ts
     * bot.addEvent('photo', async (ctx) => {
     *     await ctx.api?.sendPhoto('answer.jpg', { caption: 'Вот ваш отчёт' });
     *     ctx.skipAutoReply = true; // ответ уже отправлен вручную
     * });
     * ```
     */
    get api(): IControllerApi | null {
        if (this.#api === undefined) {
            this.#api = this.#apiFactory ? this.#apiFactory(this) : null;
        }
        return this.#api;
    }

    /**
     * Устанавливает фабрику API-фасада платформы.
     *
     * @internal вызывается ядром (Bot) при обработке запроса; публично — чтобы
     * остаться доступным для расширенных сценариев интеграции.
     * @param factory Фабрика фасада (сброс не предусмотрен сигнатурой — фабрика всегда заменяется целиком)
     * @returns Текущий экземпляр для цепочки вызовов
     */
    public setApiFactory(factory: (controller: BotController) => IControllerApi | null): this {
        this.#apiFactory = factory;
        this.#api = undefined;
        return this;
    }

    /**
     * Метод: возвращает true, только если объект Nlu уже создан (было обращение
     * к геттеру {@link nlu}). Вызов {@link setThisUser} сам по себе объекта
     * не создаёт: при неинициализированном Nlu данные буферизуются в
     * `#thisUserBuffer` и применятся при первом же обращении к геттеру.
     * @returns {boolean} true если объект NLU был инициализирован
     */
    isNluInit(): boolean {
        return !!this.#nlu;
    }

    /**
     * Записывает данные отправителя сообщения (username/имя/фамилия) в NLU.
     *
     * Используется адаптерами чат-платформ (через хелпер `setThisUserToNlu`
     * из pUtils). Значение сначала держится в приватном буфере: если логика
     * приложения ни разу не обратится к {@link nlu}, объект Nlu и его кэш
     * не создаются вовсе. При первом обращении буфер переносится в Nlu
     * (`nlu.getUserName()` возвращает переданные данные).
     *
     * @param {INluThisUser} thisUser Данные отправителя; пустые поля
     * интерпретируются как отсутствие данных
     * @returns {this} Текущий экземпляр для цепочки вызовов
     *
     * @example
     * ```ts
     * // Внутри адаптера платформы:
     * controller.setThisUser({ username: 'ivan', first_name: 'Иван', last_name: null });
     * // ...позже в бизнес-логике:
     * const name = this.nlu.getUserName()?.first_name;
     * ```
     */
    public setThisUser(thisUser: INluThisUser): this {
        if (thisUser.username || thisUser.first_name || thisUser.last_name) {
            if (this.#nlu) {
                this.#nlu.setNlu({ thisUser });
            } else {
                this.#thisUserBuffer = thisUser;
            }
        }
        return this;
    }

    /**
     * Устанавливает контекст приложения (обновляет контекст в уже созданных
     * компонентах `buttons` и `card`).
     * @param {AppContext} appContext - Контекст приложения
     * @returns {this} Текущий экземпляр для цепочки вызовов
     */
    public setAppContext(appContext: AppContext): this {
        if (appContext) {
            this.appContext = appContext;
            this.#getCustomRegExp = this.appContext.command.getCustomRegExp();
            if (this.#buttons) {
                this.#buttons.setAppContext(appContext);
            }
            if (this.#card) {
                this.#card.setAppContext(appContext);
            }
        }
        return this;
    }

    /**
     * Полностью сбрасывает состояние контроллера, включая текст ответа, пользовательские данные, состояние диалога и внутренние флаги.
     *
     * @example
     * ```ts
     * // Вызывается фреймворком автоматически перед следующим запросом;
     * // вручную — чтобы переиспользовать контроллер в тестах:
     * controller.clearStoreData();
     * console.log(controller.text); // ''
     * ```
     */
    public clearStoreData(): void {
        if (this.#buttons) {
            this.buttons.clear();
        }
        if (this.#card) {
            this.card.clear();
        }
        if (this.isNluInit()) {
            // Второй аргумент обязателен: без него в Nlu остаётся кэш разобранных
            // сущностей предыдущего запроса и getFio()/getGeo() вернут чужие данные.
            this.nlu.setNlu({}, true);
        } else {
            // Nlu не создавался, но буфер thisUser от адаптера обязан умереть
            // вместе с запросом.
            this.#thisUserBuffer = undefined;
        }
        this.text = '';
        this.tts = null;
        this.userId = null;
        this.userToken = null;
        this.userMeta = null;
        this.messageId = null;
        this.userCommand = null;
        this.originalUserCommand = null;
        this.payload = null;
        this.eventType = 'message';
        this.match = null;
        // API-фасад умирает вместе с запросом: следующий запрос может прийти
        // от другой платформы, и фабрика пересоберёт его под её адаптер.
        this.#api = undefined;
        this.userData = {} as TUserData;
        this.isAuth = false;
        this.userEvents = null;
        this.state = null;
        this.isScreen = false;
        this.isEnd = false;
        this.skipAutoReply = false;
        this.requestObject = null;
        this.oldIntentName = null;
        this.thisIntentName = null;
        this.emotion = null;
        this.appeal = null;
        this.isSendRating = false;
        // platformOptions — технические данные конкретного запроса (requestData адаптеров,
        // sendInInit, session, stateName, error). Без сброса они утекают в следующий
        // запрос: например, VK-подтверждение возвращалось бы в ответ на любое сообщение.
        this.platformOptions = {};
    }

    /**
     * Замороженный пустой список интентов.
     *
     * Литерал `[]` в `_intents()` аллоцировался на каждый запрос без
     * зарегистрированных интентов — константа отдаётся по ссылке.
     */
    static readonly #EMPTY_INTENTS: IAppIntent[] = [];

    /**
     * Возвращает список всех зарегистрированных интентов.
     *
     * @returns {IAppIntent[]} Массив интентов
     */
    protected _intents(): IAppIntent[] {
        return this.appContext?.platformParams.intents || BotController.#EMPTY_INTENTS;
    }

    /**
     * Находит нужный интент по тексту запроса.
     *
     * @param {string | null} text - Текст запроса
     * @returns {string | null} Название интента или null
     */
    protected _getIntent(text: string | null): string | null {
        if (!text) {
            return null;
        }
        const start = this.#getStartMetric();
        const intents: IAppIntent[] = this._intents();
        for (let i = 0; i < intents.length; i++) {
            const intent = intents[i];
            if (
                intent &&
                Text.isSayText(
                    intent.slots || [],
                    text,
                    intent.is_pattern,
                    false,
                    this.#getCustomRegExp,
                )
            ) {
                if (this.appContext.usedMetric) {
                    this.appContext.logMetric(EMetric.GET_INTENT, performance.now() - start, {
                        intent,
                        status: true,
                    });
                }
                return intent.name;
            }
        }
        if (this.appContext.usedMetric) {
            this.appContext.logMetric(EMetric.GET_INTENT, performance.now() - start, {
                status: false,
            });
        }
        return null;
    }

    /**
     * Запуск кастомной обработки команд.
     * @param startTimer — Время начала обработки (для замера метрик)
     * @private
     */
    #sendCustomCommandResolver(startTimer: number): void | null | Promise<void | null> {
        if (this.appContext.command.customCommandResolver) {
            // Ошибка пользовательского резолвера (sync-исключение или reject)
            // не должна превращаться в 500 для платформы: считаем, что команда
            // не найдена, и продолжаем цепочку intent → fallback.
            const onResolverError = (error: unknown): null => {
                this.appContext.logError(
                    `BotController: Произошла ошибка в customCommandResolver. Текст ошибки: "${error}"`,
                    { error },
                );
                return null;
            };
            let res: string | null | Promise<string | null>;
            try {
                res = this.appContext.command.customCommandResolver(
                    this.userCommand as string,
                    this.appContext.commands,
                );
            } catch (error) {
                return onResolverError(error);
            }
            const cb = (result: string | null): void | null | Promise<void> => {
                const command = result ? this.appContext.commands.get(result) : null;
                if (result && command) {
                    const res = this.#commandExecute(result, command);
                    if (res) {
                        return res
                            .then(() => {
                                if (this.appContext?.usedMetric) {
                                    this.appContext.logMetric(
                                        EMetric.GET_COMMAND,
                                        performance.now() - startTimer,
                                        {
                                            result,
                                            status: true,
                                        },
                                    );
                                }
                                return this._actionMetric(result, true);
                            })
                            .catch((error) => {
                                this.appContext.logError(
                                    `BotController: Произошла ошибка во время обработки команды "${result}". Текст ошибки: "${error}"`,
                                    {
                                        error,
                                    },
                                );
                            });
                    }
                    if (this.appContext?.usedMetric) {
                        this.appContext.logMetric(
                            EMetric.GET_COMMAND,
                            performance.now() - startTimer,
                            {
                                result,
                                status: true,
                            },
                        );
                    }
                    return this._actionMetric(result, true);
                } else if (this.appContext?.usedMetric) {
                    this.appContext.logMetric(EMetric.GET_COMMAND, performance.now() - startTimer, {
                        status: false,
                    });
                }
                // null или неизвестное имя означают, что custom resolver не нашёл команду.
                // Явный null нужен run(), чтобы продолжить цепочку intent → fallback → welcome.
                if (!result || !command) {
                    return null;
                }
            };
            if (isPromise(res)) {
                return res.then(cb, onResolverError);
            }
            return cb(res);
        }
        return null;
    }

    #commandCb(commandName: string, command: ICommandParam, start: number): void | Promise<void> {
        if (!command) {
            return;
        }
        const ex = this.#commandExecute(commandName, command);
        if (ex) {
            return ex
                .then(() => {
                    if (this.appContext?.usedMetric) {
                        this.appContext.logMetric(EMetric.GET_COMMAND, performance.now() - start, {
                            commandName,
                            status: true,
                        });
                    }
                    return this._actionMetric(commandName, true);
                })
                .catch((err) => {
                    this.appContext.logError(
                        `BotController: Произошла ошибка во время обработки команды "${commandName}". Текст ошибки: "${err}"`,
                        {
                            err,
                        },
                    );
                });
        }
        if (this.appContext?.usedMetric) {
            this.appContext.logMetric(EMetric.GET_COMMAND, performance.now() - start, {
                commandName,
                status: true,
            });
        }
        return this._actionMetric(commandName, true);
    }

    #getStartMetric(): number {
        return this.appContext.usedMetric ? performance.now() : 0;
    }

    #getExactCommand(start: number): void | null | Promise<void> {
        const tCommandName = this.appContext.command.getExactMatchCommand(
            this.userCommand as string,
        );
        if (tCommandName) {
            const command = this.appContext.commands.get(tCommandName);
            if (command) {
                return this.#commandCb(tCommandName, command, start);
            }
        }
        return null;
    }

    /**
     * Извлекает нужную команду из запроса.
     *
     * Порядок: кастомный резолвер → точное совпадение (хэш-таблица) → план
     * поиска (индекс подстрок и префильтр регулярок, см. {@link CommandReg.getSearchPlan}).
     * При любом пути побеждает команда, зарегистрированная раньше других.
     *
     * @returns {void | null | Promise<void | null>} результат выполнения обработчика
     * найденной команды или null, если подходящая команда не найдена
     */
    protected _getCommand(): void | null | Promise<void | null> {
        if (!this.userCommand || !this.appContext.commands) {
            return null;
        }
        const start = this.#getStartMetric();
        const commandReg = this.appContext.command;
        if (commandReg.customCommandResolver) {
            return this.#sendCustomCommandResolver(start);
        }
        const exactCommand = this.#getExactCommand(start);
        if (exactCommand !== null) {
            return exactCommand;
        }
        const plan = commandReg.getSearchPlan();
        const literalPos = plan.literal === null ? -1 : plan.literal.firstMatch(this.userCommand);
        return this.#getCommandByPlan(plan, literalPos, start);
    }

    /**
     * Поиск по плану. Литеральные команды проверяет индекс подстрок (`literalPos`),
     * остальные — по порядку регистрации; с префильтром — только те, чья
     * обязательная подстрока есть в тексте. Команда с меньшей позицией
     * побеждает, как и в линейном переборе.
     *
     * @param plan План поиска текущего набора команд
     * @param literalPos Позиция первой литеральной команды, чей слот есть в тексте (-1 — нет)
     * @param start Время начала поиска (для метрики)
     * @returns Результат обработчика найденной команды или null
     */
    #getCommandByPlan(
        plan: ISearchPlan,
        literalPos: number,
        start: number,
    ): void | null | Promise<void> {
        const commandReg = this.appContext.command;
        const commandList = commandReg.commandsList;
        const userCommand = this.userCommand as string;
        // С re2 RegExp-слоты не используются напрямую: Text пересоберёт их через
        // re2 (с кэшем), иначе нативный движок обходил бы защиту от ReDoS.
        const useDirectRegExp =
            !__$usedRe2 && (commandReg.commands as Map<string, ICommandParam>).size < 500;
        const getCustomRegExp = this.#getCustomRegExp;
        const order = plan.prefilter === null ? plan.visit : plan.scratch;
        const count =
            plan.prefilter === null ? order.length : this.#collectCandidates(plan, userCommand);
        let prev = -1;
        for (let k = 0; k < count; k++) {
            const i = order[k] as number;
            // Одна команда может попасть в кандидаты по нескольким подстрокам.
            if (i === prev) {
                continue;
            }
            prev = i;
            if (literalPos !== -1 && i > literalPos) {
                break;
            }
            const commandTuple = commandList[i];
            if (commandTuple === undefined) {
                continue;
            }
            const commandName = commandTuple[0];
            const command = commandTuple[1];
            if (commandName === DEFAULT_FALLBACK_COMMAND || !command) {
                continue;
            }
            if (!command.slots || command.slots.length === 0) {
                continue;
            }
            const groups = command.isPattern ? plan.groups[i] : undefined;
            if (groups) {
                const groupRes = this.#searchCommandsInGroup(groups, userCommand, start);
                if (groupRes !== null) {
                    return groupRes;
                }
                continue;
            }
            if (this.#isCommandMatch(command, userCommand, useDirectRegExp, getCustomRegExp)) {
                return this.#commandCb(commandName, command, start);
            }
        }
        if (literalPos !== -1) {
            const tuple = commandList[literalPos] as [string, ICommandParam];
            return this.#commandCb(tuple[0], tuple[1], start);
        }
        if (this.appContext.usedMetric) {
            this.appContext.logMetric(EMetric.GET_COMMAND, performance.now() - start, {
                status: false,
            });
        }
        return null;
    }

    /**
     * Собирает кандидатов префильтра в буфер плана `plan.scratch` по возрастанию
     * позиции: команды без обязательной подстроки и те, чья подстрока нашлась
     * в тексте. Буфер переиспользуется — поиск синхронный.
     * @param plan План поиска (с префильтром)
     * @param userCommand Текст запроса
     * @returns Число кандидатов в буфере (возможны повторы одной позиции)
     */
    #collectCandidates(plan: ISearchPlan, userCommand: string): number {
        const prefilter = plan.prefilter as NonNullable<ISearchPlan['prefilter']>;
        prefilter.scan(userCommand);
        const scratch = plan.scratch;
        const always = plan.always;
        let count = 0;
        for (let k = 0; k < always.length; k++) {
            scratch[count++] = always[k] as number;
        }
        const matched = prefilter.matched;
        for (let m = 0; m < prefilter.matchedCount; m++) {
            const positions = plan.idPositions[matched[m] as number] as Int32Array;
            for (let k = 0; k < positions.length; k++) {
                scratch[count++] = positions[k] as number;
            }
        }
        if (count > always.length) {
            scratch.subarray(0, count).sort();
        }
        return count;
    }

    /**
     * Проверяет совпадение одной команды с текстом пользователя.
     * Вынесено из цикла {@link _getCommand} для читаемости: hot-путь —
     * прямой `.exec` для одиночного stateless-RegExp (без обёртки isSayText),
     * остальные типы слотов идут через Text.isSayText.
     *
     * Побочный эффект: найденное совпадение записывается в {@link match} —
     * обработчик команды получает группы регулярки без повторного прогона.
     *
     * @param command Параметры проверяемой команды
     * @param userCommand Текст пользователя (нижний регистр)
     * @param useDirectRegExp Разрешить ли прямое использование RegExp без кэша
     * @param getCustomRegExp Кастомный движок RegExp (если подключён)
     * @returns true, если команда сработала
     */
    #isCommandMatch(
        command: ICommandParam,
        userCommand: string,
        useDirectRegExp: boolean,
        getCustomRegExp: RegExpConstructor | undefined,
    ): boolean {
        // Быстрый путь: один stateless-RegExp — .test напрямую, без обёртки
        // isSayText (сброс lastIndex сохранён для побитовой совместимости).
        const fastReg = command.__$singleStatelessRegExp;
        if (fastReg) {
            if (fastReg.lastIndex !== 0) {
                fastReg.lastIndex = 0;
            }
            const isMatch = fastReg.test(userCommand);
            if (isMatch) {
                // match ленивый: только запоминаем регулярку — exec произойдёт
                // при первом чтении controller.match.
                this.#scheduleMatch(fastReg, userCommand);
            }
            return isMatch;
        }
        // Слот-массив не пуст: проверено выше по command.slots.length в цикле,
        // но тип допускает undefined — сужаем с явным fallback.
        const slots = command.regExp || command.slots;
        if (!slots) {
            return false;
        }
        const directRegExp = command.isRegExpString || useDirectRegExp;
        const isMatch = Text.isSayText(
            slots,
            userCommand,
            command.isPattern,
            directRegExp,
            getCustomRegExp,
        );
        if (isMatch) {
            // match ленивый: запоминаем регулярку команды, сам прогон будет
            // при первом чтении controller.match (группы — только у regex-команд).
            this.#scheduleCommandMatch(command, userCommand, directRegExp);
        }
        return isMatch;
    }

    #searchCommandsInGroup(
        groups: IGroupData,
        userCommand: string,
        startTimer: number,
    ): void | null | Promise<void> {
        // Компиляция с кэшем: строковые паттерны групп больше не пересобираются
        // на каждый запрос (горячий путь поиска команд).
        const reg = getGroupRegExpCompiled(groups, this.#getCustomRegExp);
        if (!reg) {
            return null;
        }
        const match = reg.exec(userCommand);
        if (match) {
            // Находим первую совпавшую подгруппу (index в массиве parts)
            const commands = this.appContext.commands;
            for (const key in match.groups) {
                if (match.groups[key] === undefined) {
                    continue;
                }
                const commandName = groups.commands[+key.slice(1)];
                if (!commandName || !commands.has(commandName)) {
                    continue;
                }
                const command = commands.get(commandName) as ICommandParam;
                // Совпадение объединённой группы неинформативно (именованные
                // подгруппы g0..gN) — для controller.match запоминаем
                // индивидуальную регулярку найденной команды (лениво).
                this.#scheduleCommandMatch(command, userCommand, false);
                return this.#commandCb(commandName, command, startTimer);
            }
        }
        return null;
    }

    /**
     * Запоминает регулярку сработавшей команды для ленивого {@link match}.
     * Приоритет: скомпилированная `command.regExp` (isPattern), затем первый
     * RegExp-слот. Строковые команды recipe не получают — match остаётся null.
     */
    #scheduleCommandMatch(
        command: ICommandParam,
        userCommand: string,
        directRegExp: boolean,
    ): void {
        if (command.regExp) {
            this.#scheduleMatch(command.regExp, userCommand);
            return;
        }
        if (!(command.isPattern || command.isRegExpString)) {
            return;
        }
        const slotsList = (command.slots || []) as TPatternRegExp[];
        for (let s = 0; s < slotsList.length; s++) {
            const slot = slotsList[s];
            if (!slot) {
                continue;
            }
            // Строковые и объектные слоты идут через единый кэширующий путь
            // Text.getMatchRegExp — компиляция на каждый совпавший запрос
            // здесь запрещена (горячий путь, см. BENCHMARKS.md).
            const reg = Text.getMatchRegExp(slot, directRegExp, this.#getCustomRegExp);
            if (reg) {
                this.#scheduleMatch(reg, userCommand);
                return;
            }
        }
    }

    /**
     * Основной метод, в котором вы реализуете логику вашего голосового навыка или бота.
     *
     * Этот метод вызывается фреймворком автоматически после того, как запрос пользователя
     * был распознан как команда, интент или шаг диалога.
     * В параметр `intentName` передаётся имя команды.
     * Флаги `isCommand` и `isStep` позволяют различить источник вызова.
     * Используется для более глубокой логики приложения, например можно использовать в качестве логирования, если все обработчики реализованы через команды.
     * Либо использовать в качестве обработки команд, что не рекомендуется, так как из-за подобного подхода, размер метода может быть большим.
     *
     * Метод необходимо обязательно реализовать в дочерних классах.
     *
     * Метод может быть асинхронным: если он вернёт Promise, фреймворк дождётся его
     * перед формированием ответа. Ошибка (синхронная или в промисе) логируется,
     * а пользователь получает текст «Не удалось выполнить команду», если `text`
     * ещё не заполнен.
     *
     * @param {string | null} intentName - Название интента или команды
     * @param {boolean} [isCommand=false] - Флаг, указывающий что это команда
     * @param {boolean} [isStep=false] - Флаг, указывающий что это шаг
     *
     * @example
     * ```ts
     * // Пример с обработкой интентов
     * class MyController extends BotController {
     *   public action(intentName: string | null): void {
     *     if (intentName === 'greeting') {
     *       this.text = 'Привет!';
     *     } else if (intentName === 'help') {
     *       this.text = 'Помощь:';
     *       this.buttons.addBtn('Назад');
     *     }
     *   }
     * }
     *
     * // Пример с логированием
     * class MyController extends BotController {
     *   public action(intentName: string | null, isCommand?: boolean, isStep?: boolean): void {
     *     console.log(`Прошли по ${isCommand ? 'команде' : isStep ? 'шагу' : 'интенту'} с именем: ${intentName}`);
     *   }
     * }
     *
     * // Асинхронный action: фреймворк дождётся промиса
     * class MyController extends BotController {
     *   public async action(intentName: string | null): Promise<void> {
     *     if (intentName === 'balance') {
     *       const balance = await loadBalance(this.userId);
     *       this.text = `Ваш баланс: ${balance}`;
     *     }
     *   }
     * }
     * ```
     */
    abstract action(
        intentName: string | null,
        isCommand?: boolean,
        isStep?: boolean,
    ): void | Promise<void>;

    /**
     * Выполнение команды.
     * @param commandName — Имя команды для выполнения
     * @param command — Параметры зарегистрированной команды
     */
    #commandExecute(commandName: string, command?: ICommandParam): void | Promise<void> {
        // Замыкание обработчика ошибок создаётся лениво — только когда ошибка
        // действительно произошла: в счастливом пути оно не аллоцируется вовсе.
        let errorCb: ((e: Error | Record<string, unknown>) => void) | undefined;
        const getErrorCb = (): ((e: Error | Record<string, unknown>) => void) => {
            if (!errorCb) {
                errorCb = (e: Error | Record<string, unknown>): void => {
                    this.appContext.logError(
                        `BotController: Произошла ошибка во время обработки команды "${commandName}". Текст ошибки: "${e}"`,
                        {
                            e,
                        },
                    );
                    this.text = 'Не удалось выполнить команду. Попробуйте ещё раз.';
                };
            }
            return errorCb;
        };
        try {
            if (command) {
                const res = command?.cb?.(this.userCommand as string, this);
                if (isPromise(res)) {
                    return res
                        .then((result) => {
                            if (result) {
                                this.text = result;
                            }
                        })
                        .catch((e) => getErrorCb()(e as Error | Record<string, unknown>));
                }
                if (res) {
                    this.text = res;
                }
            }
        } catch (e) {
            getErrorCb()(e as Error | Record<string, unknown>);
        }
    }

    /**
     * Запуск пользовательского action() с учетом метрик.
     *
     * Если action() асинхронный, возвращает промис, который фреймворк дожидается
     * до формирования ответа. Синхронный путь промис не создаёт.
     *
     * @param {string | null} commandName - Имя команды
     * @param {boolean} isCommand - Является ли обработка командой (а не шагом)
     * @param {boolean} isStep - Является ли обработка шагом диалога
     * @returns Промис, если action() асинхронный, иначе void
     */
    protected _actionMetric(
        commandName: string | null,
        isCommand: boolean = false,
        isStep: boolean = false,
    ): void | Promise<void> {
        const start = this.appContext?.usedMetric ? performance.now() : 0;
        let res: void | Promise<void>;
        try {
            res = this.action(commandName, isCommand, isStep);
        } catch (error) {
            // Синхронное исключение не должно дойти до webhook-обработчика как 500
            // (Telegram повторяет апдейт, VK отключает сервер).
            this.#onActionError(commandName, error);
            res = undefined;
        }
        if (isPromise(res)) {
            // Ответ формируется только после завершения асинхронного action().
            return res.then(
                () => this.#logActionMetric(start, commandName, isCommand),
                (error: unknown) => {
                    this.#onActionError(commandName, error);
                    this.#logActionMetric(start, commandName, isCommand);
                },
            );
        }
        this.#logActionMetric(start, commandName, isCommand);
    }

    /**
     * Логирует ошибку action() и подставляет текст ответа, если он не задан.
     * @param commandName Имя команды
     * @param error Ошибка
     */
    #onActionError(commandName: string | null, error: unknown): void {
        this.appContext?.logError(
            `BotController: Произошла ошибка внутри action() для "${commandName}". Текст ошибки: "${error}"`,
            { error },
        );
        if (!this.text) {
            this.text = 'Не удалось выполнить команду. Попробуйте ещё раз.';
        }
    }

    /**
     * Пишет метрику времени выполнения action().
     * @param start Время начала (0, если метрики выключены)
     * @param commandName Имя команды
     * @param isCommand Обработка командой
     */
    #logActionMetric(start: number, commandName: string | null, isCommand: boolean): void {
        if (this.appContext?.usedMetric) {
            this.appContext.logMetric(EMetric.ACTION, performance.now() - start, {
                commandName,
                platform: this.appType,
                isCommand,
            });
        }
    }

    /**
     * Обработка зарегистрированных шагов.
     * @private
     */
    #stepResolver(): void | null | Promise<void> {
        if (this.appContext.steps.size) {
            const intents = this.nlu.getIntents();
            let step = this.oldIntentName ? this.appContext.steps.get(this.oldIntentName) : null;
            if (!step && intents) {
                for (const intent in intents) {
                    if (this.appContext.steps.has(intent)) {
                        step = this.appContext.steps.get(intent);
                        break;
                    }
                }
            }
            if (step) {
                let res: void | false | string | Promise<void | false | string>;
                try {
                    res = step.cb(this);
                } catch (error) {
                    this.appContext.logError(
                        `BotController: Произошла ошибка во время обработки шага "${step.stepName}". Текст ошибки: "${error}"`,
                        {
                            error,
                        },
                    );
                    this.text = 'Не удалось выполнить шаг диалога. Попробуйте ещё раз.';
                    return;
                }
                // Строка — текст ответа, как у обработчика addCommand.
                if (typeof res === 'string') {
                    this.text = res;
                    return this._actionMetric(step.stepName, false, true);
                }
                if (isPromise(res)) {
                    // Двухаргументный then: ошибка самого шага гасится здесь,
                    // а продолжение конвейера (async-отказ шага) обрабатывает
                    // ошибки своими цепочками, как и синхронный путь.
                    return res.then(
                        (result) => {
                            if (result === false) {
                                // Асинхронный шаг отказался — как и при синхронном
                                // false, продолжаем обычный конвейер (команды → интенты).
                                return this.#runCommandOrIntent();
                            }
                            if (typeof result === 'string') {
                                this.text = result;
                            }
                            return this._actionMetric(step.stepName, false, true);
                        },
                        (error) => {
                            this.appContext.logError(
                                `BotController: Произошла ошибка во время обработки шага "${step.stepName}". Текст ошибки: "${error}"`,
                                {
                                    error,
                                },
                            );
                            // Без fallback-текста платформа получила бы пустой ответ.
                            // Не затираем текст, если обработчик успел его задать до ошибки.
                            if (!this.text) {
                                this.text = 'Не удалось выполнить шаг диалога. Попробуйте ещё раз.';
                            }
                        },
                    );
                } else if (res === false) {
                    // Если передали false, значит хотят чтобы шаг не выполнялся, и дальше пошла логика с обработкой команд.
                    // Как правило, нужно в случаях, когда был записан какой-то шаг, и диалог открыли заново. В таком случае сам шаг отрабатывать не нужно.
                    return null;
                }
                return this._actionMetric(step.stepName, false, true);
            }
        }
        return null;
    }

    /**
     * Обрабатывает интенты и fallback-команду.
     * Вызывается из {@link run}, когда не сработал ни активный шаг, ни одна из команд.
     * Fallback-команда ("*") имеет приоритет над welcome: она выполняется, если
     * интент не найден и она зарегистрирована. Welcome-интент используется только
     * при `messageId === 0` (начало диалога) и отсутствии зарегистрированного fallback.
     *
     * @returns {void | Promise<void>} Может быть асинхронным
     */
    #runIntentOrFallback(): void | Promise<void> {
        let intent: string | null = this._getIntent(this.userCommand);
        const fallbackCommand = this.appContext?.commands.get(DEFAULT_FALLBACK_COMMAND);
        if (!intent && fallbackCommand) {
            const res = this.#commandExecute(DEFAULT_FALLBACK_COMMAND, fallbackCommand);
            if (isPromise(res)) {
                return res.then(() => this._actionMetric(DEFAULT_FALLBACK_COMMAND, true));
            }
            return this._actionMetric(DEFAULT_FALLBACK_COMMAND, true);
        }
        // if (
        //     intent === null &&
        //     this.originalUserCommand &&
        //     this.userCommand !== this.originalUserCommand
        // ) {
        //     // Защита на случай, если сам запроса не был найден, но на самом деле должен был отработать.
        //     // По хорошему стоит пересмотреть эту механику, и возможно удалить ее.
        //     intent = this._getIntent(this.originalUserCommand.toLowerCase());
        // }
        if (intent === null && this.messageId === 0) {
            intent = DEFAULT_WELCOME_INTENT_NAME;
        }
        let command: ICommandParam | undefined;
        /*
         * Для стандартных действий параметры заполняются автоматически.
         * Есть возможность переопределить их в action() по названию действия
         */
        switch (intent) {
            case DEFAULT_WELCOME_INTENT_NAME:
                command = this.appContext.commands.get(DEFAULT_WELCOME_INTENT_NAME);
                if (command) {
                    return this.#commandCb(
                        DEFAULT_WELCOME_INTENT_NAME,
                        command,
                        this.#getStartMetric(),
                    );
                }
                this.text = Text.getText(this.appContext.platformParams.welcome_text);
                break;

            case DEFAULT_HELP_INTENT_NAME:
                command = this.appContext.commands.get(DEFAULT_HELP_INTENT_NAME);
                if (command) {
                    return this.#commandCb(
                        DEFAULT_HELP_INTENT_NAME,
                        command,
                        this.#getStartMetric(),
                    );
                }
                this.text = Text.getText(this.appContext.platformParams.help_text);
                break;
        }

        return this._actionMetric(intent);
    }

    /**
     * Основной метод обработки запроса, вызываемый автоматически фреймворком.
     *
     * @remarks
     * Как это работает:
     * 1. Пользователь отправляет сообщение → платформа → Bot.run()
     * 2. `run()` определяет тип запроса (команда/интент/шаг)
     * 3. Вызывается ваш метод `action()` с результатом
     * 4. Вы заполняете поля ответа (`text`, `buttons`, `card`)
     * 5. Bot отправляет ответ пользователю
     *
     * Не вызывайте `run()` вручную и не переопределяйте его —
     * для своей логики переопределяйте только `action()`.
     *
     * Порядок обработки внутри run():
     * ```
     * run()
     *   ├── Шаг 0: Вызывает событийные обработчики (bot.addEvent) по controller.eventType
     *   │     → Обработчик не вернул false → обработка завершена (action(eventType))
     *   ├── Шаг 1: Проверяет есть ли активный шаг
     *   │     → Если есть → вызывает action(stepName, false, true)
     *   ├── Шаг 2: Ищет команду
     *   │     → Если нашел → вызывает action(commandName, true, false)
     *   ├── Шаг 3: Ищет интент (включая welcome/help)
     *   │     → Если нашел → вызывает action(intentName, false, false)
     *   │     → welcome-интент: messageId === 0 (начало диалога) и fallback-команда
     *   │       не зарегистрирована
     *   └── Шаг 4: Если интент не найден → fallback-команда ("*"), если зарегистрирована.
     *         Fallback проверяется раньше welcome и имеет над ним приоритет —
     *         welcome при messageId === 0 срабатывает, только если fallback не зарегистрирован
     * ```
     *
     * @example
     * ```ts
     * // ВАШ КОД (контроллер):
     * class MyController extends BotController {
     *   public action(intentName: string | null): void {
     *     // Ваша логика здесь
     *     this.text = "Ответ пользователю";
     *   }
     * }
     *
     * // КОД ФРЕЙМВОРКА (не ваш):
     * // Когда приходит запрос от пользователя:
     * const controller = new MyController();
     * {...}; // Наполняет контроллер данными. Как правило, этим занимается адаптер платформы
     * await controller.run(); // Автоматически вызывает ваш action()
     * const response = ...; // Адаптер формирует ответ в зависимости от состояния контроллера
     * ```
     *
     * @returns {void | Promise<void>} Может быть асинхронным
     */
    public run(): void | Promise<void> {
        const eventResult = this.#eventResolver();
        if (eventResult !== null) {
            return eventResult;
        }
        return this.#runPipeline();
    }

    /**
     * Обычный конвейер обработки: шаг → команда → интент/fallback.
     *
     * Единственная реализация последовательности — вызывается из {@link run},
     * и из `#runEventHandlers`, когда событийный обработчик отказался от
     * события (`false`).
     *
     * @returns Промис, если какая-то из веток асинхронная, иначе void
     */
    #runPipeline(): void | Promise<void> {
        const stepResult = this.#stepResolver();
        if (stepResult !== null) {
            return stepResult;
        }
        return this.#runCommandOrIntent();
    }

    /**
     * Часть конвейера после шагов: команда → интент/fallback.
     *
     * Вызывается из {@link #runPipeline} и из `#stepResolver`, когда
     * асинхронный шаг вернул `false` (шаг не применим).
     *
     * @returns Промис, если какая-то из веток асинхронная, иначе void
     */
    #runCommandOrIntent(): void | Promise<void> {
        const commandResult = this._getCommand();
        if (isPromise(commandResult)) {
            return commandResult.then((result) => {
                if (result === null) {
                    return this.#runIntentOrFallback();
                }
            });
        }
        if (commandResult !== null) {
            return commandResult;
        }
        return this.#runIntentOrFallback();
    }

    /**
     * Выполняет событийные обработчики, зарегистрированные через `bot.addEvent`.
     *
     * Вызывается первым в {@link run} — до шагов и команд: событие «фото»
     * не должно проходить через матчинг текстовых слотов. Обработчик может:
     * - заполнить ответ (`ctx.text = ...`) — обработка на этом завершается;
     * - вернуть `false` — «событие не моё», перебор продолжится следующим
     *   обработчиком, а после исчерпания — обычный конвейер
     *   (шаг → команда → интент → fallback).
     *
     * Обработчики одного события выполняются по порядку до первого, который
     * не отказался (`false`); отказавшийся синхронно или асинхронно обработчик
     * передаёт право следующему — поведение одинаково для обоих.
     *
     * @returns `null`, если событие не перехвачено (конвейер продолжается),
     *   иначе — промис/результат завершённой обработки
     */
    #eventResolver(): void | null | Promise<void> {
        const command = this.appContext.command;
        // Быстрый выход по предвычисленному флагу: у приложений без addEvent
        // событийный слой стоит ровно одно чтение булева поля.
        if (!command.hasEvents) {
            return null;
        }
        const events = command.events;
        const handlers = events.get(this.eventType);
        if (!handlers || handlers.length === 0) {
            return null;
        }
        return this.#runEventHandlers([...handlers], 0);
    }

    /**
     * Рекурсивно прогоняет цепочку обработчиков события начиная с индекса `from`.
     *
     * Каждый обработчик: `false` — переход к следующему; строка/void — событие
     * перехвачено, обработка завершается (`action(eventType)`). Ошибка любого
     * обработчика превращается в текст ошибки и тоже завершает обработку.
     *
     * @param handlers Обработчики события (по порядку регистрации)
     * @param from Индекс обработчика, с которого продолжаем (для async-отказа)
     * @returns `null`, если все обработчики отказались; иначе результат обработки
     */
    #runEventHandlers(handlers: IEventParam['cb'][], from: number): void | null | Promise<void> {
        for (let i = from; i < handlers.length; i++) {
            const handler = handlers[i];
            if (!handler) {
                continue;
            }
            let res: void | string | Promise<void | string> | false;
            try {
                res = handler(this);
            } catch (error) {
                this.appContext.logError(
                    `BotController: Произошла ошибка во время обработки события "${this.eventType}". Текст ошибки: "${error}"`,
                    {
                        error,
                    },
                );
                this.text = 'Не удалось обработать запрос. Попробуйте ещё раз.';
                return;
            }
            if (isPromise(res)) {
                return res.then(
                    (result: void | string | false) => {
                        if (result === false) {
                            // Асинхронный обработчик отказался от события —
                            // продолжаем перебор со следующего обработчика.
                            // Все отказались — конвейер продолжится штатно
                            // (это значение читает #eventResolver → run()).
                            const rest = this.#runEventHandlers(handlers, i + 1);
                            if (rest === null) {
                                return this.#runPipeline();
                            }
                            return rest;
                        }
                        if (typeof result === 'string') {
                            this.text = result;
                        }
                        return this._actionMetric(this.eventType, false, false);
                    },
                    (error: unknown) => {
                        this.appContext.logError(
                            `BotController: Произошла ошибка во время обработки события "${this.eventType}". Текст ошибки: "${error}"`,
                            {
                                error,
                            },
                        );
                        this.text = 'Не удалось обработать запрос. Попробуйте ещё раз.';
                    },
                );
            }
            if (res === false) {
                // Обработчик отказался от события — пробуем следующие.
                continue;
            }
            if (typeof res === 'string') {
                this.text = res;
            }
            return this._actionMetric(this.eventType, false, false);
        }
        // Все обработчики отказались — событие не перехвачено.
        return null;
    }
}
