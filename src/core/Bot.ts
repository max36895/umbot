import { IAppConfig, IAppParam, TAppType, EMetric, TAppMode } from './interfaces/IAppContext';
import {
    IAddFormOptions,
    IBotResponseState,
    IBroadcastOptions,
    IBroadcastResult,
    IButtonAction,
    IDatabaseAdapter,
    IMenu,
    IMenuOptions,
    IPlatformAdapter,
    IPlugin,
    IPluginFn,
    IPollingOptions,
    ISendMessage,
    TActionData,
    TBotAuth,
    TBotContent,
    TBotResponseCb,
    TCommandGroupMode,
    TFormContext,
    TPlugin,
    TRunResult,
} from './interfaces/IBot';

import {
    ICommandParam,
    TSlots,
    TCommandResolver,
    IStepParam,
    IEventParam,
} from './utils/CommandReg';
import { ALL_EVENT_TYPES, isEventType, type TEventType } from './events';
import { MemorySessionStorage } from './utils/MemorySessionStorage';
import { DeliveryDedup, type IDelivery } from './utils/DeliveryDedup';
import { UserQueues, type IUserQueueEntry } from './utils/UserQueues';
import { PollingRunner } from './utils/PollingRunner';
import { BotBadRequestError } from './utils/errors';
import { WebhookServer } from './utils/WebhookServer';
import { ShutdownSignals } from './utils/ShutdownSignals';
import { FormWizard } from './utils/FormWizard';
import { MenuFactory } from './utils/menu';
import { ActionFactory } from './utils/actions';
import { OutboundSender } from './utils/outbound';
import { MAX_REQUEST_SIZE, defaultSend, getBearerToken, readRequestData, send } from './utils/http';
import { IncomingMessage, ServerResponse, type Server } from 'node:http';
import type { BotController, IControllerApi, IPlatformData, IUserData } from '../controller';
import { AppContext, T_AUTO } from './AppContext';
import {
    HELP_INTENT_NAME,
    HELP_INTENT_SLOTS,
    WELCOME_INTENT_NAME,
    WELCOME_INTENT_SLOTS,
} from './constants';
import { UsersData, DB_TABLES_SCHEMA } from '../models';
import { ILogger } from './interfaces/ILogger';
import { Text } from '../utils/standard/Text';
import { isPromise } from '../utils/isPromise';
import { keysCount } from '../utils/standard/util';

const DEFAULT_HELP_INTENT_NAME = HELP_INTENT_NAME;
const DEFAULT_HELP_INTENT_SLOTS = HELP_INTENT_SLOTS;
const DEFAULT_WELCOME_INTENT_NAME = WELCOME_INTENT_NAME;
const DEFAULT_WELCOME_INTENT_SLOTS = WELCOME_INTENT_SLOTS;

/**
 * Тип для класса контроллера приложения
 */
export type TBotControllerClass<
    TUserData extends IUserData = IUserData,
    TPlatformState extends IPlatformData = IPlatformData,
> = new (appContext: AppContext) => BotController<TUserData, TPlatformState>;

/**
 * Результат обработки входящего события серверлесс-платформы (например, Yandex Cloud Functions).
 * Содержит HTTP-статус и тело ответа, которые нужно вернуть из cloud-функции.
 */
export interface IWebhookEventResult {
    /**
     * HTTP-статус ответа (200, 400, 401, 404, 500).
     */
    statusCode: number;
    /**
     * Тело ответа платформы или `null`, если ответ отсутствует.
     */
    body: TRunResult | null;
}

/**
 * Максимальная длина пользовательской команды, урезанная до 7000 символов
 * (лимит Viber — максимум среди поддерживаемых платформ). Защита от ReDoS:
 * без обрезки текст любой длины попадает в `.test()` регулярных выражений.
 * Бизнес-логика по-прежнему видит полный текст в `originalUserCommand`.
 */
const MAX_USER_COMMAND_LENGTH = 7000;

/** Минимальная пауза перед повторным подключением к недоступной БД, мс. */
const DB_RETRY_MIN_DELAY = 5000;
/** Максимальная пауза перед повторным подключением к недоступной БД, мс. */
const DB_RETRY_MAX_DELAY = 60000;

/**
 * Страховка принудительного выхода после graceful shutdown, мс: если event loop
 * продолжают держать чужие дескрипторы, процесс завершится принудительно.
 */
const GRACEFUL_FORCE_EXIT_TIMEOUT = 5000;

/**
 * Поверхностная копия данных memory-сессии для выдачи запросу. Снимает гонку
 * параллельных запросов одного пользователя по собственным ключам (счётчики,
 * шаги форм) — основной класс состояния. Вложенные объекты остаются общими:
 * глубокая копия (structuredClone) стоит 1,5–2,5 мкс и удвоила бы стоимость
 * запроса на memory-сессии, где весь запрос — те же 1–2 мкс.
 * @param data Сохранённые данные сессии
 * @returns Копия данных
 */
function cloneSessionData(data: object): object {
    return { ...data };
}

/**
 * Функция для обработки следующего шага в цепочке промежуточных функций
 */
export type MiddlewareNext = () => Promise<void>;
/**
 * Функция промежуточной обработки
 */
export type MiddlewareFn = (ctx: BotController, next: MiddlewareNext) => void | Promise<void>;

/**
 * Storage-состояние запроса (см. `Bot.#initRequestState`).
 */
interface IRequestState {
    /** Данные хранятся в локальном хранилище платформы */
    isLocalStorage: boolean;
    /** Пользователь новый; `null` — БД не ответила, сохранять ответ нельзя */
    isNewUser: boolean | null;
    /** Хранилище сессии в памяти процесса; `null` — сессия в памяти не используется */
    memoryStore: MemorySessionStorage<IUserData> | null;
    /** Ключ в хранилище сессии — id пользователя */
    memoryKey: string | null;
}

/**
 * Обрезает текст команды до потолка легитимных сообщений до NLU и матчинга
 * команд: без этого напрямую сконфигурированный вебхук без подписи проталкивал
 * бы в регулярки строки до 2 МБ, где даже «безобидная» квадратичная регулярка
 * блокирует event loop на минуты. originalUserCommand не трогаем: бизнес-логика
 * сохраняет доступ к полному тексту.
 * @param botController Контроллер запроса
 */
function truncateUserCommand(botController: BotController): void {
    const command = botController.userCommand;
    if (command && command.length > MAX_USER_COMMAND_LENGTH) {
        botController.userCommand = command.slice(0, MAX_USER_COMMAND_LENGTH);
    }
}

interface IAppConnectStatus {
    isConnecting: boolean;
    status?: Promise<boolean> | boolean;
}

/**
 * Тип для кастомного обработчика определения платформы.
 *
 * Позволяет разработчику взять на себя определение типа платформы для входящего запроса.
 * Обработчик выполняется **до** встроенного автоопределения через адаптеры.
 *
 * @param query - Тело запроса (обычно объект, может быть строкой, если запрос не распарсен).
 * @param headers - HTTP-заголовки запроса (если доступны).
 * @param detect - Функция, вызывающая стандартный механизм определения платформы
 *                 (перебор зарегистрированных адаптеров). Принимает те же параметры,
 *                 что и резолвер, и возвращает имя платформы или `null`.
 * @returns Имя платформы (строка) или `null`, если платформа не определена.
 *
 * @example
 * ```ts
 * bot.setPlatformResolver((query, headers, detect) => {
 *   // Сначала пробуем стандартное определение
 *   const platform = detect(query, headers);
 *   if (platform === 'telegram' && headers?.['x-force-vk']) {
 *     return 'vk';
 *   }
 *   return platform;
 * });
 * ```
 */
export type TPlatformResolver = (
    query: unknown,
    headers?: Record<string, unknown>,
    detect?: (uBody: unknown, headers?: Record<string, unknown>) => TAppType | null,
) => TAppType | null;

/**
 * Мультиплатформенный фреймворк для разработки голосовых навыков и чат-ботов. Он даёт единую бизнес-логику для всех платформ и одинаково эффективен, даже если вы работаете только с одной.
 *
 * **`Bot` — главный класс**, управляющий всем жизненным циклом приложения:
 *  - регистрацией платформ (Алиса, Telegram, VK, Маруся, Max и др.);
 *  - обработкой входящих запросов;
 *  - маршрутизацией команд;
 *  - middleware;
 *  - работой с базой данных;
 *  - логированием
 *  - метриками.
 *
 * Фреймворк построен на **адаптерах** — каждый адаптер отвечает за преобразование
 * специфичного для платформы запроса в унифицированный `BotController`, который
 * содержит всю информацию о пользователе, текст команды, NLU, состояние и методы ответа
 * (кнопки, карточки, TTS). Вы пишете **один код**, а фреймворк доставляет его
 * на все поддерживаемые платформы.
 *
 * ## 📖 КРАТКОЕ РУКОВОДСТВО
 *
 * 1. **Создайте приложение:** `const bot = new Bot();`
 * 2. **Настройте токены:** `bot.setAppConfig({ tokens: { telegram: {token: '...'}} });`
 * 3. **Добавьте логику при необходимости:** `bot.initBotController(MyController);`
 * 4. **Добавьте команды:** `bot.addCommand('start', ['старт'], handler);`
 * 5. **Запустите:** `bot.start();`
 *
 * ## 🎯 Ключевые возможности
 * - ✅ **Поддержка множества платформ** через подключаемые адаптеры (Алиса, Telegram, VK, Маруся и др.)
 * - ✅ **Единая логика** для голосовых навыков и ботов
 * - ✅ **Мощная система команд и интентов** с поддержкой регулярных выражений
 * - ✅ **Управление состоянием диалога** (шаги) и пользовательскими данными
 * - ✅ **Встроенная работа с БД** (MongoDB через плагины)
 * - ✅ **Middleware и плагины** для расширения функциональности
 * - ✅ **Гибкая настройка** (режимы разработки/продакшена, защита от ReDoS, кастомные резолверы команд)
 * - ✅ **Логирование и метрики** для отладки и мониторинга
 *
 * ## 🚀 БЫСТРЫЙ СТАРТ
 * Создание простого Telegram бота
 * ```ts
 * import { Bot } from 'umbot';
 * import { botPlatforms } from 'umbot/plugins';
 *
 * // 1. Создаем бота для Telegram
 * const bot = new Bot();
 *
 * // 2. Настраиваем токен (рекомендуется через .env файл)
 * bot.setAppConfig({
 *   env: './.env'
 * });
 *
 * // 3. Говорим приложению, что нужно поддерживать только платформы для чат-ботов
 * bot.use(botPlatforms);
 *
 * // 4. Добавляем команды
 * bot.addCommand('help', ['помощь', 'справка'], (cmd, controller) => {
 *   controller.text = 'Я могу:\n• Приветствовать\n• Помогать\n• И многое другое!';
 * });
 *
 * // 5. Запускаем сервер
 * bot.start('localhost', 3000);
 *
 * // 6. Настройте webhook в Telegram: https://api.telegram.org/bot{YOUR_TOKEN}/setWebhook?url=https://ваш-домен/webhook
 * ```
 *
 * Создание простого приложения со своим контроллером:
 * ```ts
 * const bot = new Bot();
 * bot.setPlatformParams({
 *   intents: [{
 *     name: 'greeting',
 *     slots: ['привет', 'здравствуй']
 *   }]
 * });
 *
 * class MyController extends BotController {
 *   public action(intentName: string | null): void {
 *     if (intentName === 'greeting') {
 *       this.text = 'Привет! Я ваш помощник 🤖';
 *       this.buttons
 *         .addBtn('Помощь')
 *         .addBtn('Настройки');
 *     }
 *   }
 * }
 *
 * bot.initBotController(MyController);
 * ```
 * Использование с базой данных:
 * ```ts
 * import { Bot } from 'umbot'
 * import { MongoAdapter } from 'umbot/plugins'
 * const bot = new Bot();
 * bot.use(new MongoAdapter({
 *     host: 'localhost',
 *     database: 'bot_db',
 *     user: 'user',
 *     pass: 'password'
 *   }));
 * ```
 * Параметры типов позволяют написать типобезопасный бот без `as any`:
 * ```ts
 * import { Bot, IUserData, IPlatformData } from 'umbot';
 *
 * interface MyUserData extends IUserData { name?: string; age?: number }
 * interface MyPlatformState extends IPlatformData { cartCount?: number }
 *
 * const bot = new Bot<MyUserData, MyPlatformState>();
 * bot.addCommand('view', [], (_, ctx) => {
 *     ctx.userData.name = 'Bob';        // ✅ типизировано
 *     ctx.state!.cartCount = 5;         // ✅ типизировано
 *     ctx.userData.foo = 1;             // ✅ допустимо: у IUserData есть индексная сигнатура [key: string]: unknown
 *     ctx.userData.count += 1;          // ❌ TS error: unknown нельзя использовать в арифметике без приведения типа
 * });
 * ```
 *
 * @template TUserData - Тип пользовательских данных, по умолчанию {@link IUserData}.
 * @template TPlatformState - Тип данных в локальном хранилище платформы, по умолчанию {@link IPlatformData}.
 * @see BotController
 *
 * @group Основное
 */
export class Bot<
    TUserData extends IUserData = IUserData,
    TPlatformState extends IPlatformData = IPlatformData,
> {
    /**
     * Встроенный HTTP-сервер вебхуков; `null` — `start()` ни разу не вызывался.
     * Создаётся лениво: serverless-бот не платит аллокацией за сервер.
     */
    #webhookServer: WebhookServer | null = null;

    #_shutdownSignals?: ShutdownSignals;

    /**
     * Подписки на SIGTERM/SIGINT для graceful shutdown (общие для сервера и polling).
     */
    get #shutdownSignals(): ShutdownSignals {
        if (!this.#_shutdownSignals) {
            this.#_shutdownSignals = new ShutdownSignals(() => void this.#gracefulShutdown());
        }
        return this.#_shutdownSignals;
    }

    /**
     * Циклы long polling; `null` — polling ни разу не запускался.
     * Создаётся лениво: бот на вебхуках не платит аллокацией за polling.
     */
    #pollingRunner: PollingRunner | null = null;

    /**
     * Полученный запрос от пользователя.
     * Может быть JSON-строкой, текстом или null
     */
    protected _content: TBotContent = null;

    /**
     * Контекст приложения
     */
    readonly #appContext: AppContext;

    /**
     * кастомный обработчик для определения типа платформы.
     */
    #platformResolver: TPlatformResolver | null = null;

    /**
     * Контроллер с бизнес-логикой приложения.
     * Обрабатывает команды и формирует ответы
     * @see TBotControllerClass
     */
    #botControllerClass: TBotControllerClass<TUserData, TPlatformState>;

    /**
     * Тип платформы по умолчанию
     */
    #defaultAppType: TAppType | 'auto' = 'auto';
    // Чтобы не повторять подключение к базе.
    readonly #appConnectStatus: IAppConnectStatus = {
        isConnecting: false,
    };

    /**
     * Момент (мс), до которого после неудачного подключения к БД новая попытка
     * не делается, и текущая пауза между попытками.
     *
     * Попытка подключения к недоступной базе занимает секунды (у MongoAdapter ~6 с),
     * а у платформ жёсткий лимит на ответ (у Алисы 3 с). Поэтому во время паузы
     * запросы обрабатываются сразу без БД, а не ждут очередного таймаута.
     */
    #dbRetryAt = 0;
    #dbRetryDelay = 0;

    #_formWizard?: FormWizard;
    /**
     * Движок многошаговых форм (addForm/startForm/removeForm).
     */
    get #formWizard(): FormWizard {
        if (!this.#_formWizard) {
            this.#_formWizard = new FormWizard(this.#appContext, {
                addStep: (name, cb): void => void this.addStep(name, cb),
                removeStep: (name): void => void this.removeStep(name),
            });
        }
        return this.#_formWizard;
    }

    #_actionFactory?: ActionFactory;
    /**
     * Фабрика действий кнопок с данными (defineAction).
     */
    get #actionFactory(): ActionFactory {
        if (!this.#_actionFactory) {
            this.#_actionFactory = new ActionFactory(this.#appContext, {
                addAction: (name, cb): void => void this.addAction(name, cb),
            });
        }
        return this.#_actionFactory;
    }
    #_menuFactory?: MenuFactory;
    /**
     * Фабрика меню из экранов (defineMenu).
     */
    get #menuFactory(): MenuFactory {
        if (!this.#_menuFactory) {
            this.#_menuFactory = new MenuFactory(this.#appContext, {
                addAction: (name, cb): void => void this.addAction(name, cb),
                addStep: (name, cb): void => void this.addStep(name, cb),
            });
        }
        return this.#_menuFactory;
    }

    #_outboundSender?: OutboundSender;
    /**
     * Проактивные исходящие сообщения: отправка и рассылка (send/broadcast).
     */
    get #outboundSender(): OutboundSender {
        if (!this.#_outboundSender) {
            this.#_outboundSender = new OutboundSender(this.#appContext, {
                createController: (): BotController =>
                    new (this.#getBotController())(this.#appContext) as BotController,
            });
        }
        return this.#_outboundSender;
    }

    #globalMiddlewares: MiddlewareFn[] = [];
    #platformMiddlewares: Partial<Record<TAppType, MiddlewareFn[]>> = {};

    /**
     * Платформы, для которых уже выведено предупреждение о неподдерживаемом
     * локальном хранилище. Проверка выполняется в горячем пути каждого
     * запроса, поэтому предупреждение дедуплицируется — один раз на платформу
     * за жизнь процесса.
     */
    readonly #warnedNoLocalStoragePlatforms = new Set<TAppType>();

    /**
     * Сессии userData в памяти процесса — по одному хранилищу на платформу:
     * `isLocalStorage: true`, платформа без локального хранилища, DB-адаптер
     * не подключён. Создаются лениво — конфигурации с БД или localStorage
     * платформы за них не платят. Вложенность (платформа → userId), а не
     * склеенный ключ `platform:userId`: склейка на каждом запросе строила бы
     * ConsString, и V8 считал бы её хэш через runtime.
     */
    readonly #memorySessions = new Map<TAppType, MemorySessionStorage<IUserData>>();

    #plugins: (IPlugin | ((bot: Bot) => void))[] = [];

    /**
     * Очереди запросов пользователей: запросы одного пользователя выполняются
     * по очереди — иначе параллельные апдейты читают один и тот же userData,
     * и сохраняется только последний.
     */
    readonly #userQueues: UserQueues;

    /**
     * Фабрики API-фасада по адаптеру: одна на адаптер, а не новое замыкание
     * на каждый запрос.
     */
    readonly #apiFactories = new Map<
        IPlatformAdapter,
        (controller: BotController) => IControllerApi | null
    >();

    /**
     * Дедупликация доставок вебхуков: повтор той же доставки (платформа не
     * дождалась ответа) подтверждается без повторного выполнения логики.
     */
    readonly #deliveryDedup: DeliveryDedup;

    /**
     * Получение корректного контроллера
     * @param botController — Класс контроллера (если не передан, используется BaseBotController)
     */
    #getBotController(
        botController?: TBotControllerClass<TUserData, TPlatformState>,
    ): TBotControllerClass<TUserData, TPlatformState> {
        if (botController) {
            return botController;
        }
        // require вместо статического импорта: BaseBotController живёт в
        // controller, который импортирует core обратно — статический импорт
        // дал бы цикл загрузки модулей.
        const { BaseBotController } = require('../controller') as typeof import('../controller');
        return BaseBotController<TUserData, TPlatformState>;
    }

    /**
     * Подключает API-фасад платформы к контроллеру (`controller.api`).
     *
     * Фасад знает сам адаптер — метод `createApi(controller)` контракта
     * `IPlatformAdapter`: ядро остаётся платформо-независимым и не резолвит
     * модули плагинов. Голосовые платформы и адаптеры без переопределённого
     * `createApi` оставляют `controller.api === null` (базовая реализация
     * возвращает null). Сам фасад создаётся при первом обращении к `ctx.api` —
     * на запросах без API-вызовов объект не аллоцируется.
     */
    #initApiFacade(
        botController: BotController<TUserData, TPlatformState>,
        platformClass: IPlatformAdapter,
    ): void {
        if (platformClass.createApi) {
            let factory = this.#apiFactories.get(platformClass);
            if (factory === undefined) {
                // Обёртка нужна, чтобы не потерять this адаптера при передаче
                // метода как фабрики в контроллер.
                factory = (controller): IControllerApi | null =>
                    platformClass.createApi!(controller);
                this.#apiFactories.set(platformClass, factory);
            }
            botController.setApiFactory(factory);
        }
    }

    /**
     * Создает новый экземпляр приложения
     *
     * @param {TAppType} [type] - Тип платформы (по умолчанию автоопределение)
     * @param {TBotControllerClass} [botController] - Контроллер с логикой
     *
     * @example
     * ```ts
     * import { Bot } from 'umbot';
     * import { T_ALISA, T_TELEGRAM, T_VK } from 'umbot/plugins';
     *
     * // Создание навыка для Алисы
     * const bot = new Bot(T_ALISA, MyController);
     *
     * // Создание бота для Telegram
     * const bot = new Bot(T_TELEGRAM, MyController);
     *
     * // Создание бота для VK
     * const bot = new Bot(T_VK, MyController);
     *
     * // Создание приложения по умолчанию
     * const bot = new Bot();
     * ```
     */
    constructor(type?: TAppType, botController?: TBotControllerClass<TUserData, TPlatformState>) {
        this.#botControllerClass = this.#getBotController(botController);
        this.#appContext = new AppContext();
        this.#deliveryDedup = new DeliveryDedup(this.#appContext);
        // Контроллер приводим обратно к дженерикам Bot: TQueueRunner типизирован
        // базовым BotController, чтобы не ломать совместимость Bot<T> с plugin(bot)
        // (см. TQueueRunner). UserQueues контроллер только пробрасывает.
        this.#userQueues = new UserQueues((controller, platformClass, appType, entry) =>
            this.#runApp(
                controller as BotController<TUserData, TPlatformState>,
                platformClass,
                appType,
                entry,
            ),
        );
        this.#defaultAppType = type || T_AUTO;
    }

    /**
     * Явно устанавливает тип платформы для всего приложения. Стоит использовать в крайнем случае
     * @param {TAppType | 'auto'} appType - Тип платформы или 'auto' для автоматического определения
     *
     * @example
     * ```ts
     * const bot = new Bot();
     * bot.appType = 'alisa'; // все запросы обрабатываются адаптером Алисы
     * ```
     */
    public set appType(appType: TAppType | 'auto') {
        this.#defaultAppType = appType;
    }

    /**
     * Возвращает установленный тип приложения.
     * @returns {string} Текущий тип платформы
     *
     * @example
     * ```ts
     * const bot = new Bot('alisa');
     * bot.appType; // -> 'alisa'
     * ```
     */
    public get appType(): string {
        return this.#defaultAppType;
    }

    /**
     * Задает режим работы с регулярными выражениями.
     * При значении auto, регулярные выражения будут группироваться в группу, благодаря чему уменьшается время обработки. Логика начинает отрабатывать после того, как добавили более 300 команд с регулярными выражениями.
     * При значении no-group, группировка регулярных выражений производиться не будет, из-за чего каждое регулярное выражение будет обрабатываться отдельно. Указывать данное значение стоит в том случае, если вы получаете сильную деградацию при обработке групп.
     * При значении group, все регулярные выражения будут добавляться в группу. Перед использованием данного значения, перепроверьте производительность, так как при группировке определенных регулярных выражений, производительность может быть ниже.
     * @param {TCommandGroupMode} mode - Определяет режим работы с регулярными выражениями.
     * @returns {this} Текущий экземпляр Bot для цепочки вызовов
     *
     * @example
     * ```ts
     * bot.setCommandGroupMode('no-group'); // отключить группировку регулярных выражений
     * ```
     */
    public setCommandGroupMode(mode: TCommandGroupMode): this {
        this.#appContext.command.setCommandGroupMode(mode);
        return this;
    }

    /**
     * Устанавливает кастомный обработчик для определения типа платформы.
     *
     * По умолчанию фреймворк определяет платформу автоматически, перебирая зарегистрированные адаптеры
     * и вызывая их метод `isPlatformOnQuery`. Этот метод позволяет переопределить логику определения,
     * что полезно в следующих случаях:
     * - Нужно добавить поддержку кастомной платформы, не создавая адаптер.
     * - Требуется изменить стандартное поведение для конкретного набора запросов
     *   (например, по заголовкам или по содержимому запроса).
     * - Необходимо выполнить какую-то логику до того, как запрос попадёт в адаптер.
     *
     * **Важно:** резолвер выполняется **до** вызова `isPlatformOnQuery` любого адаптера.
     * Если резолвер возвращает строку (имя платформы), фреймворк использует это значение
     * и не выполняет стандартное автоопределение. Если возвращает `null`, то запускается
     * стандартный перебор адаптеров.
     *
     * В резолвер передаётся опциональная функция `detect`, которая вызывает встроенное
     * автоопределение. Это позволяет, например, получить результат стандартного определения
     * и затем скорректировать его.
     *
     * @param resolver - Функция, принимающая запрос, заголовки и опционально `detect`.
     *                   Должна вернуть имя платформы (строка) или `null`.
     * @returns Тот же экземпляр приложения для цепочечных вызовов.
     *
     * @example
     * // Простейший резолвер, который для всех запросов использует платформу 'alisa'
     * bot.setPlatformResolver(() => 'alisa');
     *
     * @example
     * // Резолвер, который вызывает стандартное определение и при необходимости
     * // заменяет результат для конкретного заголовка.
     * bot.setPlatformResolver((query, headers, detect) => {
     *   const platform = detect?.(query, headers);
     *   if (platform === 'telegram' && headers?.['x-force-vk']) {
     *     return 'vk';
     *   }
     *   return platform;
     * });
     *
     * @example
     * // Полное переопределение: обработка запросов от собственного сервиса.
     * bot.setPlatformResolver((query) => {
     *   if (typeof query === 'object' && query?.source === 'my_service') {
     *     return 'my_platform';
     *   }
     *   return null;
     * });
     *
     * @remarks
     * - Резолвер выполняется синхронно. Если нужна асинхронная логика — выполните её до вызова резолвера.
     * - Внутри резолвера можно модифицировать `query` или `headers`, если нужно повлиять
     *   на дальнейшую обработку (например, добавить недостающие поля).
     * - Если резолвер возвращает имя платформы, для которой нет зарегистрированного
     *   адаптера, фреймворк выбросит ошибку. Убедитесь, что нужный адаптер подключен.
     */
    public setPlatformResolver(resolver: TPlatformResolver): this {
        this.#platformResolver = resolver;
        return this;
    }

    /**
     * Позволяет установить свою реализацию для логирования
     * @param {ILogger | null} logger - Экземпляр логгера или null для отключения
     * @returns {this} Текущий экземпляр Bot для цепочки вызовов
     *
     * @example
     * ```ts
     * bot.setLogger({ error: (msg, meta) => console.error(msg, meta) });
     * ```
     */
    public setLogger(logger: ILogger | null): this {
        this.#appContext.setLogger(logger);
        return this;
    }

    /**
     * Регистрирует команду — обработчик, срабатывающий при совпадении входящего текста с одним из шаблонов.
     *
     * Поиск команд оптимизирован:
     * 1. Сначала проверяется точное совпадение
     * 2. Если точного совпадения нет — выполняется последовательный перебор в порядке регистрации
     *
     * Первая совпавшая команда выполняется.
     *
     * @param {string} commandName - Уникальное имя команды (например, `'greeting'`). Используется для логирования и отладки.
     * @param {TSlots} slots - Массив шаблонов для сопоставления:
     *   - Если элемент — строка → ищется как подстрока (`text.includes(...)`).
     *   - Если элемент — RegExp → проверяется как регулярное выражение (`.test(text)`).
     *   - При `isPattern = true` строковые слоты компилируются в одно объединённое
     *     регулярное выражение с флагом `ium`.
     *   - Если ВСЕ элементы `slots` — готовые `RegExp`, `isPattern` для строк
     *     не применяется (строк нет): каждый элемент обрабатывается по своему типу.
     * @param {ICommandParam['cb']} cb - Обработчик команды. Принимает:
     *   - `text` — нормализованный текст пользователя (`userCommand`: нижний регистр, обрезка;
     *     исходный текст доступен в `controller.originalUserCommand`);
     *   - `controller` — экземпляр `BotController` для формирования ответа (кнопки, текст, шаги, данные и т.д.);
     *
     *   Поддерживает `async`.
     * @param {boolean} isPattern - Если `true` и в `slots` **нет RegExp**, все строки преобразуются в регулярные выражения.
     *                   ⚠️ Используйте с осторожностью: возможен ReDoS. Все RegExp проверяются на уязвимости.
     *
     * @example
     * Простая текстовая команда:
     * ```ts
     * bot.addCommand(
     *   'greeting',
     *   ['привет', 'здравствуй'],
     *   (cmd, ctrl) => {
     *     ctrl.text = 'Здравствуйте!';
     *   }
     * );
     * ```
     *
     * @example
     * Команда с регулярными выражениями:
     * ```ts
     * // Обработка чисел от 0 до 999
     * bot.addCommand(
     *   'number',
     *   ['\\b(\\d{0,3})\\b'],
     *   (cmd, ctrl) => {
     *     ctrl.text = `Вы ввели число: ${cmd}`;
     *   },
     *   true  // включаем поддержку регулярных выражений
     * );
     * ```
     *
     * @example
     * Команда с доступом к состоянию:
     * ```ts
     * bot.addCommand(
     *   'stats',
     *   ['статистика'],
     *   async (cmd, ctrl) => {
     *       // Доступ к пользовательским данным
     *       const visits = ctrl.userData?.visits || 0;
     *       ctrl.text = `Вы использовали приложение ${visits} раз`;
     *
     *       // Доступ к кнопкам и другим UI элементам
     *       ctrl.buttons
     *         .addBtn('Сбросить статистику')
     *         .addBtn('Закрыть');
     *   }
     * );
     * ```
     *
     * @example
     * // Асинхронная команда (работа с API):
     * ```ts
     * bot.addCommand('weather', ['погода'], async (text, controller) => {
     *   const weather = await fetch('https://api.example.com/weather?city=Москва');
     *   controller.text = `Погода: ${await weather.text()}`;
     * });
     * ```
     *
     * @example
     * // Fallback: срабатывает, если ни одна команда не подошла:
     * ```ts
     * bot.addCommand('*', [], (text, controller) => {
     *   controller.text = `Извините, я не понял "${text}". Скажите "помощь" для списка команд.`;
     * });
     * ```
     *
     * @remarks
     * Поиск команд оптимизирован:
     * 1. Сначала проверяется точное совпадение
     * 2. Если точного совпадения нет — выполняется последовательный перебор
     *
     * При регистрации более 300 команд с регулярными выражениями
     * фреймворк автоматически объединяет их в группы для повышения производительности.
     *
     * При isPattern=true используются регулярные выражения JavaScript
     * В callback доступен весь функционал BotController
     * Можно использовать async функции в callback
     */
    public addCommand<TBotController extends BotController = BotController>(
        commandName: string,
        slots: TSlots,
        cb: ICommandParam<TBotController>['cb'],
        isPattern: boolean = false,
    ): this {
        let correctSlots = slots;
        if (slots.length === 0) {
            switch (commandName) {
                case DEFAULT_WELCOME_INTENT_NAME:
                    correctSlots = DEFAULT_WELCOME_INTENT_SLOTS;
                    break;
                case DEFAULT_HELP_INTENT_NAME:
                    correctSlots = DEFAULT_HELP_INTENT_SLOTS;
                    break;
            }
        }
        this.#appContext.command.addCommand(commandName, correctSlots, cb, isPattern);
        return this;
    }

    /**
     * Удаляет зарегистрированную команду по имени
     * @param commandName - Имя команды
     * @returns {this} Текущий экземпляр Bot для цепочки вызовов
     *
     * @example
     * ```ts
     * bot.removeCommand('greeting'); // команда больше не срабатывает
     * ```
     */
    public removeCommand(commandName: string): this {
        this.#appContext.command.removeCommand(commandName);
        return this;
    }

    /**
     * Удаляет **все** зарегистрированные команды
     *
     * > ⚠️ Это **глобальная операция**: все сценарии станут недоступны.
     * > Используйте с осторожностью (например, при перезагрузке логики приложения).
     *
     * @returns {this} Текущий экземпляр Bot для цепочки вызовов
     */
    public clearCommands(): this {
        this.#appContext.command.clearCommands();
        return this;
    }

    /**
     * Регистрирует обработчик события платформы (фото, голосовое, нажатие кнопки и др.).
     *
     * Это декларативный роутинг по типу апдейта — аналог `bot.on(':photo')` в
     * Telegram-фреймворках, но для всех подключённых платформ сразу. Адаптер
     * определяет тип события и записывает его в `controller.eventType`; обработчики
     * вызываются **до** поиска шагов и команд.
     *
     * @remarks
     * **Какие события бывают** (см. `TEventType`): `'message'`, `'photo'`, `'voice'`,
     * `'video'`, `'document'`, `'location'`, `'contact'`, `'sticker'`, `'callback'`,
     * `'inline'`, `'message_edited'`, `'channel_post'`, `'start'`, `'subscribed'`,
     * `'unsubscribed'`, `'auth'`, `'rating'`.
     *
     * **Платформа сама определяет, какие события возможны**: у Алисы нет фото,
     * у VK нет inline-режима. Обработчик просто не вызовется там, где событие
     * физически невозможно — это корректное поведение для мультиплатформенного бота.
     *
     * **Событие `'message'`** — обычный текстовый ввод. Обработчик на него перехватывает
     * все текстовые запросы; возвращайте `false`, чтобы передать запрос обычному
     * конвейеру (шаги → команды → интенты → fallback).
     *
     * @param eventType Универсальный тип события
     * @param cb Обработчик. Получает `BotController`. Может:
     *   - заполнить `ctx.text`/`ctx.buttons` — обработка завершится (событие перехвачено);
     *   - вернуть строку — она станет текстом ответа;
     *   - вернуть `false` — «событие не моё», конвейер продолжится штатно;
     *   - быть `async` — фреймворк дожидается результата.
     * @returns {this} Текущий экземпляр Bot для цепочки вызовов
     *
     * @example
     * ```ts
     * // Фото от пользователя — без ручного разбора requestObject
     * bot.addEvent('photo', (ctx) => {
     *     ctx.text = 'Отличное фото!';
     * });
     *
     * // Нажатие inline-кнопки (payload в ctx.payload)
     * bot.addEvent('callback', (ctx) => {
     *     ctx.text = `Вы нажали: ${String(ctx.payload)}`;
     * });
     *
     * // Групповой «фильтр»: перехватываем сообщение, но отдаём его командам
     * bot.addEvent('message', (ctx) => {
     *     if (ctx.userEvents?.auth?.status) return false; // идём в обычный конвейер
     *     ctx.text = 'Перехвачено!';
     * });
     * ```
     */
    public addEvent<TBotController extends BotController = BotController>(
        eventType: TEventType,
        cb: IEventParam<TBotController>['cb'],
    ): this {
        // Валидация имени события и поддержки подключёнными адаптерами.
        // Знание живёт у адаптеров (supportedEvents), а не в ядре: кастомная
        // платформа, унаследованная от BasePlatform, участвует в проверке
        // автоматически. Регистрация до подключения адаптеров валидна —
        // предупреждение выводится только когда ни один адаптер не поддерживает
        // событие; после подключения нужной платформы обработчик заработает.
        if (!isEventType(eventType)) {
            this.#appContext.logWarn(
                `Bot:addEvent(): неизвестное событие "${eventType}". Обработчик зарегистрирован, ` +
                    `но ни один адаптер его не выставит. Допустимые значения: ${ALL_EVENT_TYPES.join(', ')}.`,
            );
        } else if (!this.#isEventSupported(eventType)) {
            this.#appContext.logWarn(
                `Bot:addEvent(): ни один подключённый адаптер не выставляет событие "${eventType}". ` +
                    `Обработчик зарегистрирован и сработает после подключения соответствующей платформы.`,
            );
        }
        this.#appContext.command.addEvent(eventType, cb);
        return this;
    }

    /**
     * Проверяет, поддерживает ли событие хотя бы один подключённый адаптер.
     *
     * Отсутствие поля `supportedEvents` (прямая реализация `IPlatformAdapter`
     * вместо наследования `BasePlatform`) приравнивается к `['message']` —
     * как задокументировано в интерфейсе: текстовый ввод возможен на любой
     * платформе.
     *
     * @param eventType Универсальный тип события
     * @returns true, если какой-то подключённый адаптер объявил событие в supportedEvents
     */
    #isEventSupported(eventType: TEventType): boolean {
        const platforms = this.#appContext.platforms;
        for (const name in platforms) {
            const platform = platforms[name];
            const supported = platform?.supportedEvents ?? ['message'];
            if (supported.includes(eventType)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Удаляет все обработчики указанного события.
     *
     * @param eventType Тип события
     * @returns {this} Текущий экземпляр Bot для цепочки вызовов
     *
     * @example
     * ```ts
     * bot.removeEvent('photo'); // обработчики фото больше не вызываются
     * ```
     */
    public removeEvent(eventType: TEventType): this {
        this.#appContext.command.removeEvent(eventType);
        return this;
    }

    /**
     * Удаляет **все** зарегистрированные событийные обработчики.
     *
     * @returns {this} Текущий экземпляр Bot для цепочки вызовов
     *
     * @example
     * ```ts
     * bot.clearEvents(); // сбросить все событийные обработчики
     * ```
     */
    public clearEvents(): this {
        this.#appContext.command.clearEvents();
        return this;
    }

    /**
     * Регистрирует обработчик нажатия кнопки по её payload — аналог `bot.action()`
     * в популярных фреймворках.
     *
     * Действие — команда, которая срабатывает только на текст, **равный** имени действия
     * (без учёта регистра), а не на подстроку: сообщение «хочу buyer» действие `buy`
     * не вызовет. Payload кнопки задаётся третьим аргументом
     * `buttons.addBtn('Купить', '', 'buy')` или объектом `{ action: 'buy', ... }` /
     * `{ command: 'buy' }`. Разобранные данные кнопки — в `ctx.payload`; удобнее
     * описать действие через {@link defineAction}: оно собирает payload кнопки и отдаёт
     * обработчику уже разобранные данные.
     *
     * @remarks
     * Адаптеры Telegram, VK, MAX и Алисы нормализуют payload нажатой кнопки: строка
     * `'buy'`, `{"command":"buy"}` или `{"action":"buy"}` превращается в `userCommand = 'buy'`.
     * На голосовых платформах действие срабатывает и на произнесённое имя целиком.
     *
     * @param actionName Имя действия (должно совпадать с payload кнопки)
     * @param cb Обработчик. Получает `userCommand` (имя действия) и `BotController`.
     *   Поддерживает `async` и возврат строки-ответа, как `addCommand`.
     * @returns {this} Текущий экземпляр Bot для цепочки вызовов
     *
     * @example
     * ```ts
     * bot.addCommand('catalog', ['каталог'], (_, ctx) => {
     *     ctx.text = 'Выберите товар:';
     *     ctx.buttons.addBtn('iPhone', '', 'buy').addBtn('MacBook', '', 'buy');
     * });
     *
     * // Сработает при нажатии кнопки с payload 'buy' (Telegram/VK/MAX)
     * bot.addAction('buy', (_, ctx) => {
     *     ctx.text = 'Оформляем заказ...';
     * });
     * ```
     */
    public addAction<TBotController extends BotController = BotController>(
        actionName: string,
        cb: ICommandParam<TBotController>['cb'],
    ): this {
        this.#appContext.command.addCommand(
            actionName,
            [actionName.toLowerCase()],
            cb as ICommandParam['cb'],
            false,
            true,
        );
        return this;
    }

    /**
     * Описывает действие кнопки с данными — как `CallbackData` в aiogram. Возвращает объект,
     * который создаёт кнопки этого действия (payload `{ action: name, ...data }`) и регистрирует
     * обработчик нажатия: обработчик получает данные кнопки уже разобранными, без поля `action`.
     * Срабатывает так же, как {@link addAction}: на нажатие кнопки и на текст, равный имени.
     *
     * Данные хранятся в самой кнопке, поэтому держите их короткими: Telegram принимает payload
     * до 64 байт (предупреждение — при создании кнопки), VK — до 255 (при превышении VK-адаптер
     * предупреждает и пропускает кнопку при сериализации клавиатуры перед отправкой).
     *
     * Ключи `action` и `command` в данных зарезервированы для маршрутизации нажатия и
     * игнорируются (с предупреждением в лог): кнопка всегда ведёт на своё действие.
     *
     * @param actionName Имя действия
     * @returns Действие: `addBtn`, `payload`, `handle`
     *
     * @example
     * ```ts
     * const vote = bot.defineAction<{ option: number }>('vote');
     * vote.handle((data, ctx) => `Голос за вариант ${data.option} учтён`);
     *
     * bot.addCommand('poll', ['опрос'], (_, ctx) => {
     *     ctx.text = 'Какой вариант?';
     *     vote.addBtn(ctx.buttons, 'Первый', { option: 1 });
     *     vote.addBtn(ctx.buttons, 'Второй', { option: 2 });
     * });
     * ```
     */
    public defineAction<
        TData extends TActionData = TActionData,
        TBotController extends BotController = BotController,
    >(actionName: string): IButtonAction<TData, TBotController> {
        return this.#actionFactory.define<TData, TBotController>(actionName);
    }

    /**
     * Описывает меню из экранов: «Главная → Тарифы → Назад». У экрана текст, кнопки-переходы и
     * необязательный родитель — для него добавляется кнопка «Назад». `menu.show(ctx, экран)`
     * выводит экран в ответ.
     *
     * Переход работает двумя путями:
     * - нажатие кнопки — экран записан в payload кнопки, поэтому нажатие срабатывает на любой
     *   платформе и в любой момент, даже если пользователь между нажатиями писал другое;
     * - название кнопки текстом или голосом — его узнаёт шаг показанного экрана (`__menu_<имя>_<экран>`),
     *   и только среди кнопок этого экрана. Сравнение идёт с `userCommand`, из которого голосовые
     *   платформы убирают пунктуацию: заголовок «Да!» текстом не узнается, сработает только нажатие.
     *   Остальной текст уходит обычным командам.
     *
     * Состояние в `userData` меню не хранит: текущий экран — в `oldIntentName`, как у шагов.
     * Внутренние имена: действие `__menu_<имя>`, шаги `__menu_<имя>_<экран>`.
     *
     * @param menuName Имя меню (латиница, коротко: оно входит в payload кнопок)
     * @param options Экраны, экран по умолчанию, текст кнопки «Назад»
     * @returns Меню: `show(ctx, screen?)` и `payload(screen)`
     *
     * @example
     * ```ts
     * const menu = bot.defineMenu('main', {
     *     screens: {
     *         home: {
     *             text: 'Чем помочь?',
     *             buttons: [
     *                 { title: 'Тарифы', to: 'prices' },
     *                 { title: 'Сайт', url: 'https://example.com' },
     *             ],
     *         },
     *         prices: { text: 'Базовый — 0 ₽, Премиум — 299 ₽', parent: 'home' },
     *     },
     * });
     *
     * bot.addCommand('menu', ['меню', '/start'], (_, ctx) => menu.show(ctx));
     * ```
     */
    public defineMenu<TBotController extends BotController = BotController>(
        menuName: string,
        options: IMenuOptions<TBotController>,
    ): IMenu<TBotController> {
        return this.#menuFactory.define(menuName, options);
    }

    /**
     * Регистрирует обработчик для именованного шага диалога.
     *
     * Шаг — это часть **многошагового сценария** (например: "регистрация", "оформление заказа").
     * После вызова `ctx.thisIntentName = 'myStep'` в команде или другом шаге,
     * следующее сообщение пользователя будет обработано этим обработчиком.
     *
     * > 💡 Обработчик получает полный `BotController`, как и в командах:
     * > доступны `this.text`, `this.userData`, `this.buttons` и т.д.
     *
     * @param stepName — Уникальное имя шага (например, `'enter_email'`).
     * @param handler — Функция, вызываемая при получении сообщения в этом шаге.
     *                  Может вернуть `false`, чтобы пропустить шаг и передать управление командам,
     *                  или строку — она станет текстом ответа, как у `addCommand`.
     * @returns Текущий экземпляр `Bot` (для цепочки вызовов).
     *
     * @example
     * ```ts
     * bot.addCommand('start', ['начать'], (_, ctx) => {
     *      ctx.text = 'Готовы начать приключение?';
     *      ctx.buttons.addBtn('Да').addBtn('Нет');
     *      ctx.thisIntentName = 'confirm';
     * });
     * bot.addStep('confirm', (ctx) => {
     *   if (ctx.userCommand === 'да') {
     *     ctx.text = 'Отлично! Добро пожаловать.';
     *   } else {
     *     ctx.text = 'Извините, вход запрещён.';
     *     ctx.thisIntentName = 'goodbye'; // переходим к другому шагу
     *   }
     * });
     * ```
     * @example
     * ```ts
     * // Пример многошаговой формы
     * bot.addCommand('order', ['заказать'], (_, ctx) => {
     *     ctx.text = 'Введите ваше имя:';
     *     ctx.thisIntentName = 'step_name';
     * });
     *
     * bot.addStep('step_name', (ctx) => {
     *     ctx.userData.name = ctx.userCommand;
     *     ctx.text = `Приятно познакомиться, ${ctx.userData.name}! Теперь введите email:`;
     *     ctx.thisIntentName = 'step_email';
     * });
     *
     * bot.addStep('step_email', (ctx) => {
     *     ctx.userData.email = ctx.userCommand;
     *     ctx.text = `Заказ оформлен! Имя: ${ctx.userData.name}, Email: ${ctx.userData.email}`;
     *     ctx.thisIntentName = null; // сбрасываем шаг
     * });
     * ```
     */
    public addStep<TBotController extends BotController = BotController>(
        stepName: string,
        handler: IStepParam<TBotController>['cb'],
    ): this {
        this.#appContext.command.addStep(stepName, handler);
        return this;
    }

    /**
     * Регистрирует многошаговую форму (опросник) с автоматической последовательностью шагов.
     *
     * Под капотом создаётся цепочка `addStep` — по одному на каждое поле. Состояние формы
     * (частичные ответы) сохраняется в `ctx.userData.__formdata_<formName>`, контекст из
     * {@link startForm} — в `ctx.userData.__formctx_<formName>`; после заполнения или отмены
     * формы поля получают значение `null` (не удаляются: Алиса очищает поле
     * `user_state_update` только значением `null`).
     *
     * Запускайте форму через {@link startForm}: он задаёт первый вопрос (с кнопками вариантов)
     * и передаёт контекст. Ручной запуск `ctx.thisIntentName = '__form_<formName>_0'` тоже
     * работает, но первый вопрос тогда выводите сами.
     *
     * У поля есть варианты-кнопки (`options`), пропуск (`optional`), проверка (`validate`) и
     * преобразование ответа (`parse`); у формы — выход по чужой кнопке или команде (`escape`).
     *
     * @remarks
     * Метод использует зарезервированные префиксы:
     * - имена шагов — `__form_<formName>_<idx>`
     * - ключи `userData` — `__formdata_<formName>` (ответы) и `__formctx_<formName>` (контекст)
     *
     * Не создавайте свои команды, шаги или поля `userData` с такими префиксами —
     * они будут перезаписаны или удалены при `removeForm`.
     *
     * @param formName — Уникальное имя формы. Используется как префикс для шагов
     *   и для ключа `__formdata_<formName>` в `userData`. Рекомендуется формат
     *   идентификатора `[a-zA-Z_$][\w$]*` (с точками для dotted-имён) — генератор
     *   шагов использует это имя в названиях `__form_*` (валидации в коде нет).
     * @param options — Настройки формы: поля, `onComplete`, `cancelText` и т.п.
     * @returns Текущий экземпляр `Bot` (для цепочки).
     *
     * @example
     * ```ts
     * bot.addForm<BotController, { name: string; guests: number; time?: string }>('booking', {
     *     escape: true, // кнопка «Меню» посреди формы выходит из неё
     *     fields: [
     *         { name: 'name', prompt: (ctx, context) => `Комната ${context.roomId}. Как вас зовут?` },
     *         {
     *             name: 'guests',
     *             prompt: 'Сколько гостей?',
     *             parse: (v) => (+v > 0 ? { value: +v } : { error: 'Нужно число больше нуля' }),
     *         },
     *         { name: 'time', prompt: 'Во сколько?', options: ['Утро', 'Вечер'], optional: true },
     *     ],
     *     onComplete: (ctx, answers, context) => {
     *         ctx.text = `${answers.name}, бронь в комнате ${context.roomId} на ${answers.guests} гостей.`;
     *     },
     * });
     *
     * bot.addCommand('book', ['забронировать'], (_, ctx) => {
     *     bot.startForm(ctx, 'booking', { roomId: 'K7M2QX' });
     * });
     * ```
     *
     * @see startForm
     * @see addStep
     */
    public addForm<
        TBotController extends BotController = BotController,
        TAnswers extends Record<string, unknown> = Record<string, string>,
    >(formName: string, options: IAddFormOptions<TBotController, TAnswers>): this {
        // Пользовательские дженерики приводим к базовым: FormWizard только хранит
        // настройки и вызывает колбеки, типами ответов управляет вызывающий код.
        this.#formWizard.add(
            formName,
            options as unknown as IAddFormOptions<BotController, Record<string, unknown>>,
        );
        return this;
    }

    /**
     * Запускает форму, зарегистрированную {@link addForm}: задаёт первый вопрос (с кнопками
     * вариантов и пропуска) и переводит пользователя на шаг первого поля. Ответы прошлой
     * незавершённой попытки этой формы сбрасываются.
     *
     * @param ctx Контроллер текущего запроса
     * @param formName Имя формы
     * @param context Данные для формы (например, id комнаты): доступны в `prompt(ctx, context)`
     *   и `onComplete(ctx, answers, context)`. Хранятся в `userData` до конца формы, поэтому
     *   должны сериализоваться в JSON
     * @returns `true`, если форма запущена; `false`, если форма не найдена или в ней нет полей
     *
     * @example
     * ```ts
     * bot.addAction('join', (_, ctx) => {
     *     bot.startForm(ctx, 'join', { roomId: String(ctx.payload) });
     * });
     * ```
     */
    public startForm<TBotController extends BotController = BotController>(
        ctx: TBotController,
        formName: string,
        context: TFormContext = {},
    ): boolean {
        return this.#formWizard.start(ctx, formName, context);
    }

    /**
     * Удаляет зарегистрированную многошаговую форму по имени.
     *
     * После удаления форма больше не будет обрабатываться, даже если она активна у пользователя.
     * (Рекомендуется завершать активные сценарии через `ctx.thisIntentName = null` перед удалением.)
     *
     * @remarks
     * Сравнение идёт по префиксу `__form_<formName>_`. Осторожно: если у вас
     * есть формы `user` и `user_2`, вызов `removeForm('user')` также удалит
     * шаги формы `user_2` (её имя начинается с `__form_user_`).
     * Чтобы избежать этого, выбирайте `formName` с уникальным суффиксом,
     * не являющимся префиксом другой формы (например, `signup` vs `signupV2`).
     *
     * @param {string} formName — Имя формы для удаления.
     * @returns {this} Текущий экземпляр `Bot`.
     *
     * @example
     * ```ts
     * bot.removeForm('registration');
     * ```
     */
    public removeForm(formName: string): this {
        this.#formWizard.remove(formName);
        return this;
    }

    /**
     * Удаляет зарегистрированный шаг по имени.
     *
     * После удаления шаг больше не будет обрабатываться, даже если активен у пользователя.
     * (Рекомендуется завершать активные сценарии через `ctx.thisIntentName = null` перед удалением.)
     *
     * @param {string} stepName — Имя шага для удаления.
     * @returns {this} Текущий экземпляр `Bot`.
     *
     * @example
     * ```ts
     * bot.removeStep('confirm_order');
     * ```
     */
    public removeStep(stepName: string): this {
        this.#appContext.command.removeStep(stepName);
        return this;
    }

    /**
     * Удаляет **все** зарегистрированные шаги и вместе с ними — реестр форм (`addForm`):
     * форма живёт на шагах, и `startForm` после очистки честно вернёт `false`, а не задаст
     * вопрос, на который некому ответить.
     *
     * > ⚠️ Это **глобальная операция**: все сценарии станут недоступны.
     * > Используйте с осторожностью (например, при перезагрузке логики приложения).
     *
     * @returns {this} Текущий экземпляр `Bot`.
     *
     * @example
     * ```ts
     * bot.clearSteps();
     * ```
     */
    public clearSteps(): this {
        this.#appContext.command.clearSteps();
        this.#formWizard.clear();
        return this;
    }

    /**
     * Удаляет **все** зарегистрированные платформы, плагины и middleware службы.
     * Для каждого объектного плагина вызывается метод `destroy()`.
     *
     * > ⚠️ Это **глобальная операция**: все адаптеры и middleware станут недоступны.
     * > Команды и шаги при этом **не удаляются** — для их очистки используйте `clearCommands()` / `clearSteps()`.
     *
     * @returns {this} Текущий экземпляр `Bot`.
     *
     * @example
     * ```ts
     * bot.clearUse();
     * ```
     */
    public clearUse(): this {
        this.#appContext.platforms = {};
        this.#globalMiddlewares = [];
        this.#platformMiddlewares = {};
        this.#appContext.plugins = {};
        this.#plugins.forEach((plugin) => {
            if (typeof plugin === 'function') {
                plugin(this);
            } else {
                plugin.destroy?.(this)?.catch((e) => {
                    this.#appContext.logError(
                        `Произошла ошибка при уничтожении адаптера! Текст ошибки: ${e.message}`,
                        {
                            error: e,
                        },
                    );
                });
            }
        });
        this.#plugins = [];
        return this;
    }

    /**
     * Устанавливает режим работы приложения
     *
     * @param {'dev' | 'prod' | 'strict_prod'} appMode - Режим работы:
     * - 'dev': подробные логи, отладочная информация; ReDoS-проверка выполняется
     *   всегда — в dev/prod опасные выражения логируются (error без re2 / warn с re2),
     *   но не отклоняются
     * - 'prod': минимальные логи, производительность, НО небезопасные RegExp всё равно регистрируются
     * - 'strict_prod': строгая проверка безопасности — любая RegExp с потенциальным ReDoS отклоняется с ошибкой
     *
     * ⚠️ ВАЖНО: В продакшене всегда используйте 'strict_prod' для защиты от атак через регулярные выражения.
     * Выражения проверяются в момент регистрации (addCommand, setPlatformParams), поэтому вызывайте
     * метод до регистрации команд и параметров: уже зарегистрированное повторно не проверяется.
     * Без вызова режим — `strict_prod` при `NODE_ENV=production`, иначе `dev`.
     * Режим 'prod' оставлен для обратной совместимости, но небезопасен.
     *
     * @returns {this} Текущий экземпляр Bot для цепочки вызовов
     *
     * @example
     * ```ts
     * // Для продакшена (обязательно!)
     * bot.setAppMode('strict_prod');
     *
     * // Для разработки
     * bot.setAppMode('dev');
     * ```
     */
    public setAppMode(appMode: TAppMode): this {
        this.#appContext.appMode = appMode;
        this.#appContext.command.strictMode = appMode === 'strict_prod';
        return this;
    }

    /**
     * Позволяет заменить встроенный механизм сопоставления команд на **кастомный алгоритм поиска**.
     *
     *  По умолчанию `umbot` использует **оптимизированный поиск**:
     *  1. Сначала проверяется точное совпадение
     *  2. Если точного совпадения нет — выполняется последовательный перебор с поддержкой:
     *      - подстрок (`includes`),
     *      - простых регулярных выражений.
     *
     * Это обеспечивает **предсказуемость**, **простоту отладки** и **соответствие поведению большинства платформ**:
     * первая совпавшая команда (в порядке регистрации) — выигрывает.
     *
     * Однако при:
     * - количестве команд >1000,
     * - высокой нагрузке (>1000 RPS),
     * - необходимости в fuzzy-поиске или сложной маршрутизации,
     * вы можете подключить оптимизированный resolver.
     *
     * @param resolver - Функция вида `(userCommand: string, commands: Map<string, ICommandParam>) => string | null | Promise<string | null>`.
     *                    Должна вернуть имя команды или `null`, если совпадений нет.
     *
     * @example
     * ```ts
     * // Пример: кэширование частых запросов
     * const cache = new Map<string, string | null>();
     * bot.setCustomCommandResolver((text, commands) => {
     *   if (cache.has(text)) return cache.get(text)!;
     *
     *   for (const [name, cmd] of commands) {
     *     if (cmd.slots && cmd.slots.some(slot => typeof slot === 'string' && text.includes(slot))) {
     *       cache.set(text, name);
     *       return name;
     *     }
     *   }
     *   cache.set(text, null);
     *   return null;
     * });
     * ```
     *
     * @remarks
     * **Рекомендации при реализации resolver'а:**
     * - Сохраняйте **порядок регистрации команд**, если логика зависит от приоритета.
     * - Используйте **кэширование** для часто встречающихся фраз (но учитывайте потребление памяти).
     * - Для fuzzy-поиска — рассмотрите `fuse.js`, `natural` или trie-структуры.
     * - При работе с регулярными выражениями **обязательно проверяйте их на ReDoS**.
     * - Избегайте тяжёлых синхронных операций — они блокируют event loop.
     * @returns {this} Текущий экземпляр Bot для цепочки вызовов
     */
    public setCustomCommandResolver(resolver: TCommandResolver): this {
        this.#appContext.command.customCommandResolver = resolver;
        return this;
    }

    /**
     * Задаёт **инфраструктурную конфигурацию** приложения: подключение к БД, загрузку `.env`, и другие
     * настройки, связанные с окружением выполнения (а не с бизнес-логикой приложения).
     *
     * > 🔒 **Безопасность**: никогда не храните секреты (пароли, токены, API-ключи) прямо в коде.
     * > Всегда используйте `.env`-файлы или переменные окружения.
     *
     * @param {Partial<IAppConfig>} config - Конфигурация приложения
     *
     * @example
     * ```ts
     * // Конфигурация с базой данных
     * bot.setAppConfig({
     *   db: {
     *     host: 'localhost',
     *     database: 'bot_db',
     *     user: 'user',
     *     pass: 'password'
     *   }
     * });
     * ```
     *
     * @remarks
     * Важно! Чувствительные данные рекомендуется сохранять в .env файл, передав путь к нему:
     * ```ts
     * bot.setAppConfig({
     *     env: './.env', // путь до файла
     * });
     * ```
     * @returns {this} Текущий экземпляр Bot для цепочки вызовов
     */
    public setAppConfig(config: Partial<IAppConfig>): this {
        if (config) {
            this.#appContext.setAppConfig(config);
        }
        return this;
    }

    /**
     * Возвращает контекст приложения — центральный объект для расширенной настройки фреймворка.
     *
     * **Когда использовать:**
     * - Замена HTTP-клиента: `bot.getAppContext().httpClient = customFetch`
     * - Доступ к зарегистрированным адаптерам: `bot.getAppContext().platforms`
     * - Настройка метрик и логирования
     *
     * **Пример:**
     * ```ts
     * // Добавление таймаутов к запросам
     * const customFetch: THttpClient = async (url, init) => {
     *   const controller = new AbortController();
     *   const timeout = setTimeout(() => controller.abort(), 5000);
     *   return fetch(url, { ...init, signal: controller.signal });
     * };
     *
     * bot.getAppContext().httpClient = customFetch;
     * ```
     *
     * ⚠️ Важно: Не модифицируйте внутренние поля контекста напрямую (например, commands, steps). Используйте публичные методы addCommand(), addStep().
     *
     * @returns {AppContext} Контекст приложения
     */
    public getAppContext(): AppContext {
        return this.#appContext;
    }

    /**
     * Задаёт параметры, управляющие **логикой приложения** на всех платформах.
     *
     * Сюда входят:
     * - список интентов по умолчанию (`help`, `welcome` и др.),
     * - тексты ответов по умолчанию (`welcome_text`, `help_text`, `empty_text`),
     * - другие настройки, не зависящие от конкретной платформы
     *
     * @param {IAppParam} params - Параметры платформы
     *
     * @example
     * ```ts
     * // Базовая настройка
     * bot.setPlatformParams({
     *   intents: [{
     *     name: 'help',
     *     slots: ['помощь', 'справка']
     *   }],
     *   welcome_text: 'Привет! Я ваш помощник.',
     *   help_text: 'Скажите "помощь", чтобы увидеть команды.',
     *   empty_text: 'Извините, я не понял.'
     * });
     * ```
     * @returns {this} Текущий экземпляр Bot для цепочки вызовов
     */
    public setPlatformParams(params: IAppParam): this {
        if (params) {
            this.#appContext.setPlatformParams(params);
        }
        return this;
    }

    /**
     * Устанавливает контроллер, метод `action()` которого вызывается **после обработки каждого запроса** —
     * независимо от того, была ли распознана команда, активен ли шаг сценария, или обработан базовый интент.
     *
     * Метод `action()` получает флаги `isCommand` и `isStep`, чтобы вы могли:
     * - добавить общую логику (аналитика, логирование, трассировка);
     * - модифицировать ответ глобально (например, добавить рекламу, кнопку "Оценить");
     * - применить кросс-функциональные правила (rate limiting, мутации текста и т.д.);
     *
     * > 💡 **Рекомендация**: основную бизнес-логику размещайте в командах (`addCommand`) и шагах (`addStep`),
     * > а в `action()` — только **сквозную** логику, которую не хочется дублировать.
     *
     * Стандартные интенты `welcome`, `help` и fallback-команда обрабатываются фреймворком автоматически
     * (в `BotController`) — при замене контроллера они продолжат работать. Базовый `BaseBotController`
     * дополнительно подставляет `empty_text`, если ответ пуст.
     *
     * @param {TBotControllerClass<TUserData, TPlatformState>} fn - Класс контроллера, наследующий `BotController<TUserData, TPlatformState>`
     *
     * @example
     * ```ts
     * class MyController extends BotController {
     *   public action(intentName: string): void {
     *     switch (intentName) {
     *       case 'greeting':
     *         this.text = 'Привет!';
     *         break;
     *       case 'help':
     *         this.text = 'Чем могу помочь?';
     *         break;
     *     }
     *   }
     * }
     *
     * bot.initBotController(MyController);
     * ```
     *
     * @example
     * ```ts
     * // Добавление рекламы ко всем ответам
     * class MyController extends BotController {
     *   public action(
     *     intentName: string | null,
     *     isCommand: boolean = false,
     *     isStep: boolean = false
     *   ): void {
     *     // Добавим кнопку "Подписаться" везде, кроме шагов
     *     if (!isStep) {
     *       this.buttons.addBtn('Подписаться на рассылку', 'http://localhost');
     *     }
     *
     *     // Логирование
     *     console.log(`Обработано: ${isCommand ? 'команда' : isStep ? 'шаг' : 'интент'} – ${intentName}`);
     *   }
     * }
     *
     * bot.initBotController(MyController);
     * ```
     * @returns {this} Текущий экземпляр Bot для цепочки вызовов
     */
    public initBotController(fn: TBotControllerClass<TUserData, TPlatformState>): this {
        if (fn) {
            this.#botControllerClass = fn;
        }
        return this;
    }

    /**
     * Устанавливает контент запроса.
     * Задаёт входящие данные запроса, которые обработает {@link run}.
     * Не рекомендуется использовать напрямую, использовать только в крайнем случае, либо для тестов
     *
     * @param {TBotContent} content - Контент запроса
     *
     * @example
     * ```ts
     * // Установка текстового сообщения
     * bot.setContent('Привет!');
     *
     * // Установка JSON-данных
     * bot.setContent({
     *   request: {
     *     command: 'привет',
     *     original_utterance: 'Привет, мир!'
     *   }
     * });
     * ```
     */
    public setContent(content: TBotContent): void {
        this._content = content;
    }

    /**
     * Очищает состояние пользователя
     */
    protected _clearState(botController: BotController): void {
        if (botController) {
            botController.clearStoreData();
        }
    }

    #defaultPlatformDetect(uBody: unknown, headers?: Record<string, unknown>): TAppType | null {
        if (this.#defaultAppType && this.#defaultAppType !== T_AUTO) {
            return this.#defaultAppType;
        }

        if (this.#appContext.platforms) {
            for (const platformName in this.#appContext.platforms) {
                const platform = this.#appContext.platforms[platformName];
                if (platform?.isPlatformOnQuery(uBody, headers)) {
                    return platform.platformName;
                }
            }
        }
        return null;
    }

    /**
     * Определяет тип приложения по заголовкам или телу запроса
     * @param uBody - Тело запроса
     * @param headers - Заголовки запроса
     */
    #getAppType(uBody: unknown, headers?: Record<string, unknown>): TAppType | null {
        if (this.#platformResolver) {
            const customType = this.#platformResolver(
                uBody,
                headers,
                this.#defaultPlatformDetect.bind(this, uBody, headers),
            );
            if (customType !== null) {
                return customType;
            }
        }
        return this.#defaultPlatformDetect(uBody, headers);
    }

    #initNLU(botController: BotController<TUserData, TPlatformState>): void {
        if (this.#appContext.plugins.nlu) {
            const nlu =
                typeof this.#appContext.plugins.nlu === 'function'
                    ? this.#appContext.plugins.nlu(
                          botController.userCommand || botController.originalUserCommand || '',
                          botController.nlu.getNluValue(),
                          botController.appType as string,
                          botController.requestObject,
                      )
                    : this.#appContext.plugins.nlu.getData(
                          botController.userCommand || botController.originalUserCommand || '',
                          botController.nlu.getNluValue(),
                          botController.appType as string,
                          botController.requestObject,
                      );
            botController.nlu.setNlu(nlu, true);
        }
    }

    async #getDbAdapter(dbAdapter: IDatabaseAdapter): Promise<IDatabaseAdapter | undefined> {
        if (this.#appContext.database.isSendConnect) {
            return dbAdapter;
        }
        if (this.#appConnectStatus.isConnecting) {
            // Ошибку подключения логирует запрос, который его начал; здесь reject
            // означает только «базы нет», а не 500 для параллельного запроса.
            const connected = await Promise.resolve(this.#appConnectStatus.status).catch(
                () => false,
            );
            return connected ? dbAdapter : undefined;
        }
        if (Date.now() < this.#dbRetryAt) {
            return undefined;
        }
        this.#appConnectStatus.isConnecting = true;
        let connected = false;
        try {
            // Параллельные запросы ждут этот же промис: к базе они пойдут только
            // после подключения И подготовки схемы (иначе SQL-адаптер получил бы
            // запрос к ещё не созданной таблице).
            const attempt = this.#connectAndPrepare(dbAdapter);
            this.#appConnectStatus.status = attempt;
            connected = await attempt;
        } catch (e) {
            this.#appContext.logError(
                `Bot:#getDbAdapter(): Ошибка при подключении к базе данных: ${(e as Error).message}`,
                { error: e },
            );
        } finally {
            this.#appConnectStatus.isConnecting = false;
        }
        this.#appContext.database.isSendConnect = connected;
        if (connected) {
            this.#dbRetryAt = 0;
            this.#dbRetryDelay = 0;
            return dbAdapter;
        }
        // Пауза растёт от 5 с до 60 с, пока база недоступна.
        this.#dbRetryDelay = Math.min(
            this.#dbRetryDelay ? this.#dbRetryDelay * 2 : DB_RETRY_MIN_DELAY,
            DB_RETRY_MAX_DELAY,
        );
        this.#dbRetryAt = Date.now() + this.#dbRetryDelay;
        this.#appContext.logError(
            `Bot:#getDbAdapter(): Не удалось подключиться к базе данных. Запросы обрабатываются без БД ` +
                `(userData не загружается и не сохраняется), следующая попытка подключения — через ` +
                `${this.#dbRetryDelay / 1000} с.`,
        );
        return undefined;
    }

    /**
     * Подключается к базе и после успешного подключения готовит схему
     * (`ensureSchema`: таблицы, индексы). Сбой подготовки схемы не отменяет
     * подключение — ошибка пишется в лог.
     * @param dbAdapter DB-адаптер
     * @returns true, если подключение установлено
     */
    async #connectAndPrepare(dbAdapter: IDatabaseAdapter): Promise<boolean> {
        const connectResult = dbAdapter.connect();
        const connected = isPromise(connectResult) ? await connectResult : connectResult;
        if (connected && dbAdapter.ensureSchema) {
            try {
                const appTables = this.#appContext.appConfig.dbTables;
                const prepared = dbAdapter.ensureSchema(
                    appTables.length ? [...DB_TABLES_SCHEMA, ...appTables] : DB_TABLES_SCHEMA,
                );
                if (!(isPromise(prepared) ? await prepared : prepared)) {
                    this.#appContext.logError(
                        'Bot:#getDbAdapter(): DB-адаптер не смог подготовить схему (ensureSchema вернул false). ' +
                            'Проверьте права пользователя БД на создание таблиц и индексов.',
                    );
                }
            } catch (e) {
                this.#appContext.logError(
                    `Bot:#getDbAdapter(): Ошибка при подготовке схемы базы данных: ${(e as Error).message}`,
                    { error: e },
                );
            }
        }
        return connected;
    }

    /* eslint-disable require-atomic-updates*/
    /**
     * Загружает userData из БД. Без DB-адаптера отвечает синхронно: промис
     * создаётся только там, где есть что ждать.
     * @param botController Контроллер запроса
     * @param userData Модель пользователя (если подключён DB-адаптер)
     * @param localStateData Состояние из локального хранилища платформы
     * @returns `true` — пользователь новый, `false` — найден, `null` — БД не ответила
     *   (данные пользователя неизвестны, сохранять ответ этого запроса нельзя)
     */
    #initUserData(
        botController: BotController<TUserData, TPlatformState>,
        userData?: UsersData,
        localStateData?: unknown,
    ): boolean | null | Promise<boolean | null> {
        if (botController.platformOptions.usedLocalStorage) {
            botController.state = localStateData as TPlatformState;
        }
        // Метод вызывается только когда localStorage платформы не используется
        // (выключен в конфиге ИЛИ платформа его не поддерживает — чат-платформы),
        // поэтому источник userData — БД, независимо от appConfig.isLocalStorage.
        return userData ? this.#loadUserData(botController, userData) : true;
    }

    /**
     * Читает запись пользователя из БД (часть {@link #initUserData}).
     * @param botController Контроллер запроса
     * @param userData Модель пользователя
     * @returns `true` — пользователь новый, `false` — найден, `null` — БД не ответила
     */
    async #loadUserData(
        botController: BotController<TUserData, TPlatformState>,
        userData: UsersData,
    ): Promise<boolean | null> {
        // userId уникален только в пределах платформы.
        const query = {
            userId: botController.userId,
            platform: userData.platform,
        };
        // where(), а не whereOne(): только так «не найдено» отличается от ошибки БД.
        const res = await userData.where(query, true);
        if (res?.status) {
            userData.init(this.#appContext.database.adapter?.getValue(res) ?? null);
            botController.userData = userData.data as TUserData;
            return false;
        }
        if (!botController.userData) {
            botController.userData = {} as TUserData;
        }
        if (res?.error) {
            this.#appContext.logError(
                `Bot:run(): Не удалось загрузить данные пользователя "${String(botController.userId)}": ` +
                    'запрос обработан с пустыми userData, изменения не сохранены.',
                { error: res.error },
            );
            return null;
        }
        userData.userId = botController.userId;
        userData.meta = botController.userMeta as Record<string, unknown>;
        return true;
    }

    /**
     * Подготовка storage-состояния запроса: localStorage платформы или БД.
     *
     * Включает диагностику конфигурации (isLocalStorage без поддержки
     * платформы) с дедуплицированным предупреждением (выводится один раз
     * на платформу) и начальную загрузку
     * userData. Вынесено из `#runApp` для читаемости горячего метода.
     *
     * @param botController Контроллер запроса
     * @param platformClass Адаптер платформы
     * @param userData Модель пользователя (если подключён DB-адаптер)
     * @param appType Тип платформы (для дедупликации предупреждений)
     * @returns Флаг локального хранилища, признак нового пользователя (`null` — БД не ответила) и ключ
     * сессии в памяти (`null`, если сессия в памяти не используется). Промис — только
     * если localStorage платформы или БД ответили асинхронно.
     */
    #initRequestState(
        botController: BotController<TUserData, TPlatformState>,
        platformClass: IPlatformAdapter,
        userData: UsersData | undefined,
        appType: TAppType,
    ): IRequestState | Promise<IRequestState> {
        botController.platformOptions.usedLocalStorage =
            platformClass.isLocalStorage(botController);
        const isLocalStorage: boolean =
            this.#appContext.appConfig.isLocalStorage &&
            botController.platformOptions.usedLocalStorage;

        let memoryStore: MemorySessionStorage<IUserData> | null = null;
        let memoryKey: string | null = null;
        if (
            this.#appContext.appConfig.isLocalStorage &&
            !botController.platformOptions.usedLocalStorage &&
            !this.#appContext.database.adapter
        ) {
            const userId = botController.userId;
            const memorySession = this.#getMemorySession(appType, userId);
            if (memorySession && userId !== null && userId !== undefined && userId !== '') {
                memoryStore = memorySession;
                // String() над строкой вернёт её же без копирования — аллокация
                // только для числового id.
                memoryKey = typeof userId === 'string' ? userId : String(userId);
                // Копия, а не ссылка: после переполнения лимита ожидания UserQueues
                // параллельные запросы одного пользователя получали один и тот же
                // объект и мутировали его одновременно. Сохранение в конце запроса
                // перезаписывает ссылку целиком (#saveMemorySession), поэтому снимок
                // семантику сохранения не меняет.
                const stored = memorySession.get(memoryKey);
                botController.userData = (stored ? cloneSessionData(stored) : {}) as TUserData;
            }
        }

        if (isLocalStorage) {
            const localStateData: unknown = platformClass.getLocalStorage(botController);
            if (isPromise(localStateData)) {
                return localStateData.then((data) => {
                    botController.userData = data as TUserData;
                    return { isLocalStorage, isNewUser: true, memoryStore, memoryKey };
                });
            }
            botController.userData = localStateData as TUserData;
        } else if (!memoryKey) {
            const isNewUser = this.#initUserData(botController, userData, botController.state);
            if (isPromise(isNewUser)) {
                return isNewUser.then((res) => ({
                    isLocalStorage,
                    isNewUser: res,
                    memoryStore,
                    memoryKey,
                }));
            }
            return { isLocalStorage, isNewUser, memoryStore, memoryKey };
        }
        return { isLocalStorage, isNewUser: true, memoryStore, memoryKey };
    }

    /**
     * Возвращает сессию в памяти процесса (создаёт при первом обращении) и один
     * раз на платформу предупреждает, где живут данные.
     *
     * @param appType Тип платформы (для дедупликации предупреждений)
     * @param userId Пользователь запроса (для метаданных лога)
     * @returns Хранилище или `null`, если сессия в памяти отключена (`memorySession: false`)
     */
    #getMemorySession(
        appType: TAppType,
        userId: string | number | null | undefined,
    ): MemorySessionStorage<IUserData> | null {
        const config = this.#appContext.appConfig.memorySession;
        let storage: MemorySessionStorage<IUserData> | null | undefined = null;
        if (config !== false) {
            storage = this.#memorySessions.get(appType);
            if (storage === undefined) {
                storage = new MemorySessionStorage<IUserData>(config);
                this.#memorySessions.set(appType, storage);
            }
        }
        // Предупреждение зависит только от конфигурации, а не от запроса —
        // достаточно вывести его один раз на платформу.
        if (!this.#warnedNoLocalStoragePlatforms.has(appType)) {
            this.#warnedNoLocalStoragePlatforms.add(appType);
            this.#appContext.logWarn(this.#getMemorySessionWarning(appType, storage), {
                platform: appType,
                userId,
            });
        }
        return storage;
    }

    /**
     * Текст предупреждения о хранении userData без БД и localStorage платформы.
     *
     * @param appType Тип платформы
     * @param storage Сессия в памяти или `null`, если она отключена
     * @returns Текст предупреждения
     */
    #getMemorySessionWarning(
        appType: TAppType,
        storage: MemorySessionStorage<IUserData> | null,
    ): string {
        const prefix =
            `Bot:run(): Платформа "${appType}" не поддерживает локальное хранилище, ` +
            'а DB-адаптер не подключён';
        if (!storage) {
            return (
                `${prefix}, сессия в памяти отключена (memorySession: false). ` +
                'userData не будет сохраняться между запросами. ' +
                'Подключите DB-адаптер (FileAdapter/MongoAdapter).'
            );
        }
        const ttl = storage.ttl
            ? `${Math.round(storage.ttl / 60000)} мин. с последнего запроса`
            : 'без ограничения по времени';
        return (
            `${prefix} — userData хранится в памяти процесса ` +
            `(до ${storage.maxSize} пользователей, ${ttl}). ` +
            'Данные теряются при перезапуске и не разделяются между процессами ' +
            '(кластер, несколько реплик, serverless). ' +
            'Для надёжного хранения подключите DB-адаптер (FileAdapter/MongoAdapter).'
        );
    }

    /**
     * Запуск логики приложения.
     *
     * Единственный async-уровень конвейера запроса: вложенные шаги отдают
     * промис только там, где действительно есть что ждать (БД, асинхронный
     * адаптер или обработчик), — каждый лишний async-кадр стоит аллокаций
     * на каждом запросе.
     * @param botController - Контроллер с бизнес-логикой приложения
     * @param platformClass - Экземпляр адаптера платформы, который будет подготавливать корректный ответ в зависимости от платформы
     * @param appType - Тип приложения
     * @param queueEntry - Запись очереди пользователя: освобождается по завершении запроса
     */
    async #runApp(
        botController: BotController<TUserData, TPlatformState>,
        platformClass: IPlatformAdapter,
        appType: TAppType,
        queueEntry: IUserQueueEntry | null,
    ): Promise<TRunResult> {
        try {
            const dbAdapter = this.#appContext.database.adapter
                ? await this.#getDbAdapter(this.#appContext.database.adapter)
                : undefined;
            let userData: UsersData | undefined;
            if (dbAdapter) {
                userData = new UsersData(this.#appContext);
                botController.userId = userData.escapeString(
                    botController.userId as string | number,
                );
                userData.platform = platformClass.platformName;
            }
            const stateRes = this.#initRequestState(
                botController,
                platformClass,
                userData,
                appType,
            );
            const { isLocalStorage, isNewUser, memoryStore, memoryKey } = isPromise(stateRes)
                ? await stateRes
                : stateRes;

            truncateUserCommand(botController);
            this.#initNLU(botController);
            const shouldProceed =
                this.#globalMiddlewares.length || this.#platformMiddlewares[appType]?.length
                    ? await this.#runMiddlewares(botController, appType)
                    : true;
            let content: string | object;
            try {
                if (shouldProceed) {
                    this.#setOldIntentName(botController);

                    const res = botController.run();
                    if (res) {
                        await res;
                    }

                    // isVoice читаем с уже полученного адаптера, а не через
                    // platforms[appType] — так нет лишнего lookup'а.
                    if (botController.tts === null && platformClass.isVoice) {
                        botController.tts = botController.text;
                    }
                }
                // Ответ собирается всегда, даже если middleware прервал обработку:
                // getContent() адаптера оформит выставленный middleware текст
                // в валидный для платформы ответ.
                const contentRes = this.#getPlatformContent(botController, platformClass);
                content = isPromise(contentRes)
                    ? await (contentRes as Promise<string | object>)
                    : contentRes;
            } finally {
                if (memoryStore && memoryKey !== null) {
                    this.#saveMemorySession(memoryStore, memoryKey, botController.userData);
                } else {
                    const saved = this.#saveUserData(
                        botController,
                        userData,
                        isNewUser,
                        isLocalStorage,
                    );
                    if (saved) {
                        await saved;
                    }
                }
            }
            if (botController.platformOptions.error) {
                this.#appContext.logError(botController.platformOptions.error);
            }
            if (this.#$botController) {
                this._clearState(botController);
            }
            return content;
        } finally {
            // Очередь освобождается до того, как вызывающий код получит ответ:
            // следующий запрос пользователя пойдёт без ожидания.
            if (queueEntry !== null && queueEntry.owner === botController) {
                queueEntry.owner = null;
            }
        }
    }

    /**
     * Сохраняет userData в сессию в памяти процесса. Пустые данные не храним:
     * бот, не использующий userData, не занимает память под каждого пользователя.
     *
     * @param storage Хранилище сессий платформы текущего запроса
     * @param key Ключ сессии — id пользователя
     * @param data Данные пользователя после обработки запроса
     */
    #saveMemorySession(
        storage: MemorySessionStorage<IUserData>,
        key: string,
        data: TUserData,
    ): void {
        if (data && keysCount(data)) {
            // Сохраняется ссылка: clearStoreData() переприсваивает userData
            // новым объектом, поэтому сохранённые данные не обнуляются.
            storage.set(key, data);
        } else {
            storage.delete(key);
        }
    }

    /**
     * Сохраняет данные пользователя в БД после обработки запроса.
     * Если пользователь новый — выполняется insert, иначе — update.
     * При использовании localStorage и отсутствии DB-адаптера сохранение пропускается.
     * @param botController Контроллер с данными текущего запроса
     * @param userData Экземпляр модели для работы с данными пользователя
     * @param isNewUser true, если пользователь новый (ещё не записан в БД); null — данные
     *   не загрузились, и сохранение пустых userData затёрло бы или задублировало запись
     * @param isLocalStorage true, если данные хранятся в локальном хранилище платформы
     * @returns Промис записи в БД; `undefined`, если сохранять нечего
     */
    #saveUserData(
        botController: BotController<TUserData, TPlatformState>,
        userData: UsersData | undefined,
        isNewUser: boolean | null,
        isLocalStorage: boolean,
    ): Promise<void> | undefined {
        if (
            !userData ||
            isNewUser === null ||
            (isLocalStorage &&
                (!botController.state ||
                    (botController.state as unknown as object) ===
                        (botController.userData as unknown as object)))
        ) {
            return undefined;
        }
        return this.#storeUserData(botController, userData, isNewUser);
    }

    /**
     * Записывает userData в БД (часть {@link #saveUserData}): insert для нового
     * пользователя, update — для существующего. Ошибка БД пишется в лог.
     * @param botController Контроллер с данными текущего запроса
     * @param userData Модель пользователя
     * @param isNewUser true, если пользователь новый
     */
    async #storeUserData(
        botController: BotController<TUserData, TPlatformState>,
        userData: UsersData,
        isNewUser: boolean,
    ): Promise<void> {
        userData.userId = botController.userId;
        userData.data = botController.userData;
        const userId = botController.userId;
        if (isNewUser) {
            await userData.save(true).catch((e) => {
                this.#appContext.logError(
                    `Bot:run(): Произошла ошибка при сохранении данных для нового пользователя "${userId}". Текст ошибки: ${e.message}`,
                    { error: e },
                );
            });
        } else {
            await userData.update().catch((e) => {
                this.#appContext.logError(
                    `Bot:run(): Произошла ошибка при сохранении данных для пользователя: "${userId}". Текст ошибки: ${e.message}`,
                    { error: e },
                );
            });
        }
    }

    #setOldIntentName(botController: BotController<TUserData, TPlatformState>): void {
        if (
            !botController.oldIntentName &&
            botController.userData &&
            botController.userData.oldIntentName
        ) {
            botController.oldIntentName = botController.userData.oldIntentName;
        } else if (
            !botController.oldIntentName &&
            botController.state &&
            typeof botController.state === 'object' &&
            botController.state.oldIntentName
        ) {
            botController.oldIntentName = botController.state.oldIntentName as string;
        }
    }

    /**
     * Валидация результата работы адаптера платформы
     * @param content
     * @param botController
     * @private
     */
    #validateAdapterResult(
        content: object | string,
        botController: BotController<TUserData, TPlatformState>,
    ): object | string {
        if (content === null || content === undefined) {
            this.#appContext.logWarn(
                `Bot:#getPlatformContent(): Адаптер платформы вернул null/undefined из getContent(). Ответ будет пустым.`,
                { platform: botController.platformOptions },
            );
            return '';
        }
        return content;
    }

    /**
     * Проставляет oldIntentName в userData или state и возвращает актуальный размер userData.
     *
     * @param botController Контроллер текущего запроса
     * @returns Количество значимых полей в userData
     */
    #applyOldIntentName(botController: BotController<TUserData, TPlatformState>): number {
        let userDataLength = keysCount(botController.userData);
        if (botController.thisIntentName !== null) {
            if (botController.state && userDataLength === 0) {
                botController.state.oldIntentName = botController.thisIntentName;
            } else {
                botController.userData.oldIntentName = botController.thisIntentName;
            }
            return userDataLength;
        }
        // В Алисе в любом случае будет какое-то поле, так как если ничего не будет, то данные просто не обновятся.
        // Поэтому в oldIntentName в любом случае необходимо писать null
        if (botController.userData.oldIntentName !== undefined) {
            userDataLength--;
            botController.userData.oldIntentName = null;
        }
        if (botController.state?.oldIntentName !== undefined) {
            botController.state.oldIntentName = null;
        }
        return userDataLength;
    }

    /**
     * Выбирает данные, которые нужно отдать платформе как состояние диалога.
     *
     * @param botController Контроллер текущего запроса
     * @param userDataLength Количество значимых полей в userData
     * @returns Данные состояния либо `undefined`, если сохранять нечего
     */
    #getStateData(
        botController: BotController<TUserData, TPlatformState>,
        userDataLength: number,
    ): Record<string, unknown> | undefined {
        if (
            this.#appContext.appConfig.isLocalStorage &&
            botController.platformOptions.usedLocalStorage
        ) {
            if (this.#appContext.database.adapter) {
                return (
                    botController.state && keysCount(botController.state)
                        ? botController.state
                        : botController.userData
                ) as Record<string, unknown>;
            }
            return (userDataLength ? botController.userData : botController.state) as Record<
                string,
                unknown
            >;
        }
        if (botController.state && keysCount(botController.state)) {
            return botController.state as Record<string, unknown>;
        }
        return undefined;
    }

    /**
     * Формирует ответ платформы и сохраняет состояние в её локальное хранилище.
     * Синхронный адаптер отвечает без промиса.
     * @param botController Контроллер текущего запроса
     * @param platformClass Адаптер платформы
     * @returns Ответ платформы (или промис, если адаптер асинхронный)
     */
    #getPlatformContent(
        botController: BotController<TUserData, TPlatformState>,
        platformClass: IPlatformAdapter,
    ): string | object | Promise<string | object> {
        const userDataLength = this.#applyOldIntentName(botController);
        const stateData = this.#getStateData(botController, userDataLength);
        if (botController.isSendRating) {
            const rating = platformClass.getRatingContext(botController);
            return isPromise(rating)
                ? (rating as Promise<string | object>).then((r) =>
                      this.#finishPlatformContent(botController, platformClass, r, stateData),
                  )
                : this.#finishPlatformContent(botController, platformClass, rating, stateData);
        }
        if (botController.state && userDataLength === 0) {
            // При isLocalStorage=true state и userData могут совпадать.
            // Безопасное приведение через unknown, т.к. в этом режиме типы эквивалентны.
            botController.userData = botController.state as unknown as TUserData;
        }
        // Ответ адаптера дожидаемся до валидации: проверка на null должна
        // применяться к ответу, а не к промису. Заодно состояние сохраняется уже
        // после готового ответа.
        const raw = platformClass.getContent(botController, stateData);
        if (isPromise(raw)) {
            return (raw as Promise<string | object>).then((r) =>
                this.#finishPlatformContent(
                    botController,
                    platformClass,
                    this.#validateAdapterResult(r, botController),
                    stateData,
                ),
            );
        }
        return this.#finishPlatformContent(
            botController,
            platformClass,
            this.#validateAdapterResult(raw, botController),
            stateData,
        );
    }

    /**
     * Сохраняет состояние в локальное хранилище платформы после готового ответа.
     * @param botController Контроллер текущего запроса
     * @param platformClass Адаптер платформы
     * @param content Готовый ответ платформы
     * @param stateData Состояние для сохранения
     * @returns Ответ платформы (промис — если хранилище асинхронное)
     */
    #finishPlatformContent(
        botController: BotController<TUserData, TPlatformState>,
        platformClass: IPlatformAdapter,
        content: string | object,
        stateData: Record<string, unknown> | undefined,
    ): string | object | Promise<string | object> {
        // Пустое состояние сохранять нечего: у платформ с внешним хранилищем
        // (SmartApp) такой вызов уходил лишним HTTP-запросом на каждый ответ.
        if (botController.platformOptions.usedLocalStorage && stateData) {
            const res = platformClass.setLocalStorage(stateData, botController);
            if (res) {
                return res.then(() => content);
            }
        }
        return content;
    }

    /* eslint-enable require-atomic-updates*/

    /**
     * Регистрирует middleware, вызываемый **до** выполнения `BotController.action()`.
     *
     * Middleware получает доступ к полному `BotController` (включая `text`, `isEnd`, `userData`, `buttons` и т.д.)
     * и может:
     * - Модифицировать контекст
     * - Прервать выполнение (если не вызвать `next()`)
     * - Выполнить логирование, tracing, rate limiting и др.
     *
     * @example
     * // Глобальный middleware (для всех платформ)
     * bot.use(async (ctx, next) => {
     *   console.log('Запрос от:', ctx.appType);
     *   await next();
     * });
     *
     * @param fn - Middleware-функция
     * @returns Текущий экземпляр `Bot` для цепочки вызовов
     */
    use(fn: MiddlewareFn): this;

    /**
     * Регистрирует middleware, вызываемый только для указанной платформы.
     *
     * @example
     * // Только для Алисы
     * bot.use(T_ALISA, async (ctx, next) => {
     *   if (!ctx.requestObject?.session?.user_id) {
     *     ctx.text = 'Некорректный запрос';
     *     ctx.isEnd = true;
     *     // next() не вызывается → action() не запускается
     *     return;
     *   }
     *   await next();
     * });
     *
     * @param platform - Идентификатор платформы (`alisa`, `telegram`, `vk`, и т.д.)
     * @param fn - Middleware-функция
     * @returns Текущий экземпляр `Bot`
     */
    use(platform: TAppType, fn: MiddlewareFn): this;

    /**
     * Регистрирует плагин — объект, расширяющий функциональность приложения.
     *
     * Плагин может быть функцией или объектом (классом).
     * Для функции обязательно должен быть выставлен флаг `isPlugin = true`
     * (иначе она будет принята за middleware) — проще использовать хелпер `createPlugin()`.
     * Для объекта (класса) должен быть реализован метод `init(appContext: AppContext, bot: Bot)`.
     *
     * @param plugin — Объект плагина, совместимый с `TPlugin`.
     * @returns Текущий экземпляр `Bot`.
     *
     * @example
     * import {AlisaAdapter} from 'umbot/plugins'
     * bot.use(new AlisaAdapter());
     */
    use(plugin: TPlugin): this;

    /**
     * Регистрирует middleware или плагин (например, адаптер платформы).
     *
     * Поддерживаются три варианта:
     * - `use(middleware)` — глобальный middleware для всех платформ.
     * - `use(platform, middleware)` — middleware только для указанной платформы.
     * - `use(plugin)` — подключает плагин (объект с `init()` или функцию с `isPlugin: true`).
     *
     * Middleware имеет доступ к `BotController` и может:
     * - модифицировать контекст (`text`, `userData`, `buttons` и т.д.),
     * - прервать обработку (если не вызвать `next()`),
     * - выполнять логирование, проверки, tracing и др.
     *
     * Плагин получает `AppContext` при инициализации и может регистрировать
     * middleware, команды или другую логику.
     *
     * Метод поддерживает цепочку вызовов.
     */
    use(arg1: TAppType | MiddlewareFn | TPlugin, arg2?: MiddlewareFn): this {
        if (typeof arg1 === 'function') {
            if ((arg1 as IPluginFn).isPlugin) {
                const fn = (arg1 as IPluginFn)(this.#appContext, this);
                if (fn) {
                    this.#plugins.push(fn);
                }
            } else {
                this.#globalMiddlewares.push(arg1 as MiddlewareFn);
            }
            return this;
        }
        if (typeof arg1 !== 'string') {
            arg1.init(this.#appContext, this);
            this.#plugins.push(arg1);
        } else if (arg2) {
            this.#platformMiddlewares[arg1] ??= [];
            this.#platformMiddlewares[arg1].push(arg2);
        }
        return this;
    }

    /**
     * Выполняет middleware для текущего запроса
     * @param controller — Контроллер с данными запроса
     * @param appType — Тип платформы
     */
    async #runMiddlewares(controller: BotController, appType: TAppType): Promise<boolean> {
        if (appType) {
            const start = this.#appContext.usedMetric ? performance.now() : 0;

            let index = 0;
            let isEnd = false;
            try {
                let middlewares = this.#globalMiddlewares;
                const next = async (): Promise<void> => {
                    const mw = middlewares[index];
                    if (mw) {
                        index++;
                        await mw(controller, next);
                    } else {
                        isEnd = true;
                    }
                };
                // Запускаем цепочку
                await next();
                if (isEnd && this.#platformMiddlewares[appType]?.length) {
                    isEnd = false;
                    index = 0;
                    middlewares = this.#platformMiddlewares[appType];
                    await next();
                }
            } catch (err) {
                this.#appContext.logError(
                    `Bot:runMiddlewares: Произошла ошибка при обработке middleware. Текст ошибки: ${(err as Error).message}`,
                    {
                        error: err,
                    },
                );
            }
            if (this.#appContext.usedMetric) {
                this.#appContext.logMetric(EMetric.MIDDLEWARE, performance.now() - start, {
                    platform: appType,
                });
            }
            return isEnd;
        }
        return true;
    }

    #$botController: BotController<TUserData, TPlatformState> | null = null;

    /**
     * Установка контроллера. Используется только для тестирования
     * @param botController
     * @protected
     */
    protected _setBotController(botController: BotController<TUserData, TPlatformState>): void {
        this.#$botController = botController;
    }

    /**
     * Получение контроллера приложения
     * Не использовать!
     * @internal
     */
    public getBotController(): BotController<TUserData, TPlatformState> | null {
        return this.#$botController;
    }

    /**
     * Выполняет непосредственную обработку входящего запроса от платформы.
     * Этот метод **не запускает HTTP-сервер** и **не обрабатывает HTTP-запросы напрямую** —
     * он принимает уже распарсенные данные и возвращает результат обработки.
     *
     * Обычно вызывается **внутри {@link webhookHandle}**, но может использоваться напрямую,
     * если вы реализуете собственный обработчик запросов, тестируете логику приложения
     * или запускаете его вне HTTP-контекста (например, из консоли или очереди сообщений).
     *
     * @param {TAppType | null} [appType] - Тип приложения. Если не указан, будет определен автоматически в зависимости от запроса.
     * @param {string | object | null} [content] - Входные данные для обработки (например, текст сообщения или объект запроса).
     * @param {TBotAuth} [auth] - Авторизационный токен
     * @param {string} [clientIp] - IP-адрес клиента. Заполняется автоматически при обработке
     * запроса через {@link webhookHandle}; в {@link webhookEvent} передаётся явно параметром. Доступен middleware
     * (например, `ipFilter`) через `controller.platformOptions.clientIp`.
     * @returns {Promise<TRunResult>} Результат обработки запроса
     * @throws {Error} Если не удаётся определить платформу или отсутствуют данные для обработки.
     *
     * @example
     * ```ts
     * // Обработка запроса
     * const result = await bot.run();
     * console.log(result);
     * ```
     */
    public run(
        appType: TAppType | null = null,
        content: string | object | null = null,
        auth: TBotAuth = null,
        clientIp?: string,
    ): Promise<TRunResult> {
        // Не async: собственный async-кадр run() стоил аллокаций на каждом запросе.
        // Контракт прежний — ошибка всегда приходит отклонённым промисом.
        try {
            return this.#runRequest(appType, content, auth, clientIp);
        } catch (e) {
            return Promise.reject(e);
        }
    }

    /**
     * Синхронная часть {@link run}: разбор запроса адаптером и постановка в очередь
     * пользователя. Ошибки бросает синхронно — run() превращает их в отказ промиса.
     * @param appType Тип приложения
     * @param content Входные данные запроса
     * @param auth Авторизационный токен
     * @param clientIp IP-адрес клиента
     * @returns Промис ответа платформы
     */
    #runRequest(
        appType: TAppType | null,
        content: string | object | null,
        auth: TBotAuth,
        clientIp: string | undefined,
    ): Promise<TRunResult> {
        if (!this.#botControllerClass) {
            const errMsg =
                'Не определен класс с логикой приложения. Укажите класс контроллера, передав его в метод initBotController';
            this.#appContext.logError(errMsg);
            throw new Error(errMsg);
        }
        // Приоритет у переданного содержимого: setContent() задан один раз (для
        // тестов), и значение _content, переживая запросы, не должно подменять
        // собой реальные вебхуки всех последующих запросов.
        const correctContent = this.#parseContent(content || this._content);
        if (!correctContent) {
            const msg = `${appType ? `Для платформы "${appType}"` : 'Пришел не корректный запрос в котором'} передано пустое содержимое, дальнейшая обработка невозможна.`;
            this.#appContext.logError(msg);
            throw new BotBadRequestError(msg);
        }
        const botController: BotController<TUserData, TPlatformState> =
            this.#$botController || new this.#botControllerClass(this.#appContext);
        if (this.#$botController) {
            botController.setAppContext(this.#appContext);
        }
        botController.appType = appType || this.#getAppType(correctContent);
        const platformClass = botController.appType
            ? this.#appContext.platforms[botController.appType]
            : null;
        if (platformClass) {
            botController.userToken ??= auth;
            if (clientIp) {
                botController.platformOptions.clientIp = clientIp;
            }
            // API-фасад платформы (controller.api): фабрику отдаёт сам адаптер
            // через контракт createApi() — ядро не знает о модулях платформ.
            // На голосовых платформах и адаптерах без createApi фасад — null.
            this.#initApiFacade(botController, platformClass);

            platformClass.updateTimeStart(botController);
            const res = platformClass.setQueryData(correctContent, botController);
            if (isPromise(res)) {
                return (res as Promise<boolean>).then((parsed) =>
                    this.#afterQueryData(parsed, botController, platformClass),
                );
            }
            return this.#afterQueryData(res, botController, platformClass);
        }
        const msg =
            'Не удалось определить платформу, от которой пришел запрос. Дальнейшая обработка невозможна.';
        this.#appContext.logError(msg);
        throw new BotBadRequestError(msg);
    }

    /**
     * Продолжение {@link run} после разбора запроса адаптером.
     * @param parsed Результат `setQueryData`: `false` — адаптер не смог разобрать запрос
     * @param botController Контроллер запроса
     * @param platformClass Адаптер платформы
     * @returns Промис ответа платформы
     */
    #afterQueryData(
        parsed: boolean,
        botController: BotController<TUserData, TPlatformState>,
        platformClass: IPlatformAdapter,
    ): Promise<TRunResult> {
        if (!parsed) {
            const msg =
                (botController.platformOptions.error as string) ||
                `Адаптер платформы "${botController.appType}" не смог разобрать запрос.`;
            this.#appContext.logError(msg);
            throw new BotBadRequestError(msg);
        }
        if (botController.platformOptions.sendInInit) {
            return Promise.resolve(botController.platformOptions.sendInInit as TRunResult);
        }
        return this.#userQueues.run(botController, platformClass, botController.appType as string);
    }

    #parseContent(content: TBotContent): TBotContent {
        let parsed: TBotContent = content;
        if (content && typeof content === 'string') {
            try {
                parsed = JSON.parse(content);
            } catch {
                const msg = 'Передана невалидная JSON-строка. Убедитесь, что данные корректны.';
                this.#appContext.logError(msg);
                throw new BotBadRequestError(msg);
            }
        }
        // Платформы присылают JSON-объект; скаляр или массив — некорректный
        // запрос, ответ на него — 400. Пустое содержимое проверяется в run().
        if (parsed && (typeof parsed !== 'object' || Array.isArray(parsed))) {
            const msg = 'Тело запроса не является JSON-объектом. Убедитесь, что данные корректны.';
            this.#appContext.logError(msg);
            throw new BotBadRequestError(msg);
        }
        return parsed;
    }

    /**
     * Отправляет HTTP-ответ платформе с защитой от исключений пользовательского
     * `responseCb`: колбэк может бросить синхронно или вернуть отклонённый промис
     * (async-функция). Без защиты исключение выходит из `webhookHandle` как
     * unhandled rejection и валит процесс бота. При сбое колбэка ответ отправляется
     * по умолчанию.
     */
    #sendWebhookResponse(
        req: IncomingMessage,
        res: ServerResponse,
        state: IBotResponseState,
        responseCb?: TBotResponseCb,
    ): void {
        let result: unknown;
        try {
            result = send(req, res, state, responseCb);
        } catch (error) {
            this.#appContext.logError(
                'Bot:webhookHandle(): Пользовательский responseCb выбросил исключение при отправке ответа. Ответ отправлен по умолчанию.',
                { error },
            );
            this.#fallbackSend(res, state);
            return;
        }
        if (
            result &&
            typeof result === 'object' &&
            typeof (result as PromiseLike<unknown>).then === 'function'
        ) {
            (result as Promise<void>).catch((error: unknown) => {
                this.#appContext.logError(
                    'Bot:webhookHandle(): Пользовательский responseCb завершился ошибкой.',
                    { error },
                );
                // Асинхронный колбэк, упавший ДО отправки, оставлял платформу без
                // ответа: Telegram реплеит апдейт бесконечно. Отправляем ответ сами,
                // если колбэк его так и не отправил (sync-бросок делает #fallbackSend).
                if (!res.writableEnded) {
                    this.#fallbackSend(res, state);
                }
            });
        }
    }

    /**
     * Резервная отправка ответа, когда колбэк пользователя упал до отправки.
     * Заголовки уже могут быть отправлены частично сработавшим колбэком —
     * тогда Node бросит ERR_HTTP_HEADERS_SENT, что здесь же и гасится.
     */
    #fallbackSend(res: ServerResponse, state: IBotResponseState): void {
        try {
            defaultSend(res, state);
        } catch (error) {
            this.#appContext.logWarn(
                'Bot:webhookHandle(): Не удалось отправить ответ по умолчанию (заголовки уже отправлены).',
                { error },
            );
        }
    }

    #isWebhookError(
        req: IncomingMessage,
        res: ServerResponse,
        responseCb?: TBotResponseCb,
    ): boolean {
        if (req.method !== 'POST') {
            this.#webhookHandleError(req, res, 400, responseCb);
            return true;
        }
        const contentLength = req.headers['content-length'];
        if (contentLength && parseInt(contentLength) > MAX_REQUEST_SIZE) {
            this.#webhookHandleError(req, res, 413, responseCb);
            return true;
        }
        return false;
    }

    #webhookHandleError(
        req: IncomingMessage,
        res: ServerResponse,
        code: number,
        responseCb?: TBotResponseCb,
        customBody?: string,
    ): void {
        let body = 'Bad Request';
        let statusCode = code;
        switch (code) {
            case 400:
                body = customBody ?? 'Empty request';
                break;
            case 422:
                statusCode = 400;
                body = 'Invalid JSON';
                break;
            case 413:
                body = 'Request entity too large';
                break;
            case 401:
                body = 'Invalid token';
                break;
            case 404:
                body = 'Not found';
                break;
            case 500:
                body = 'Internal Server Error';
                break;
        }
        return this.#sendWebhookResponse(
            req,
            res,
            {
                statusCode,
                body,
                defaultSend,
            },
            responseCb,
        );
    }

    /**
     * Обрабатывает входящий webhook-запрос от поддерживаемой платформы (Telegram, VK, Алиса и др.).
     * Метод автоматически распознаёт платформу по заголовкам или телу запроса и делегирует обработку
     * соответствующему адаптеру. Ответ отправляется автоматически через переданный объект `res`.
     *
     * @param req - Объект входящего запроса (IncomingMessage или совместимый)
     * @param res - Объект ответа (ServerResponse или совместимый)
     * @param responseCb - Callback, для пользовательской обработки ответа пользователю. Стоит использовать в том случае, если есть необходимость переопределить стандартный ответ фреймворка.
     * Если передан, ВЫ ДОЛЖНЫ вызвать res.end() самостоятельно.
     * Без колбэка фреймворк автоматически завершит ответ через res.end().
     *
     * @example
     * ```ts
     * // Использование с Express
     * // Важно: НЕ подключайте express.json() перед обработчиком —
     * // webhookHandle сам читает тело запроса, а парсер съест стрим.
     * import express from 'express';
     * const app = express();
     *
     * const bot = new Bot();
     *
     * app.post('/webhook', (req, res) => bot.webhookHandle(req, res));
     * ```
     * @example
     * // Использование с встроенным HTTP-сервером Node.js
     * import { createServer } from 'http';
     *
     * const bot = new Bot();
     * const server = createServer((req, res) => {
     *   if (req.method === 'POST' && req.url === '/webhook') {
     *     bot.webhookHandle(req, res);
     *   } else {
     *     res.statusCode = 404;
     *     res.end();
     *   }
     * });
     * server.listen(3000);
     * @example
     * ```ts
     * // Пример с переопределением ответа
     * import { createServer } from 'http';
     *
     * const bot = new Bot();
     * const server = createServer((req, res) => {
     *   if (req.method === 'POST' && req.url === '/webhook') {
     *     // В случае если вернулся статус отличный от 200, вернет содержимое какой-то страницы.
     *     bot.webhookHandle(req, res, (_reg: IncomingMessage, _res: ServerResponse, state: IBotResponseState) => {
     *          if (state.statusCode === 200) {
     *              return state.defaultSend(_res, state);
     *          }
     *          _res.statusCode = 200;
     *          _res.end(...);// Какое-то содержимое страницы
     *     });
     *   } else {
     *     res.statusCode = 404;
     *     res.end();
     *   }
     * });
     * server.listen(3000);
     *
     * ```
     */
    public async webhookHandle(
        req: IncomingMessage,
        res: ServerResponse,
        responseCb?: TBotResponseCb,
    ): Promise<void> {
        if (this.#isWebhookError(req, res, responseCb)) {
            return;
        }
        let appType: string | null = null;
        let delivery: IDelivery | null = null;
        let serverError = false;
        try {
            if (this.#appContext.usedMetric) {
                this.#appContext.logMetric(EMetric.START_WEBHOOK, Date.now(), {});
            }
            const startTimer = this.#appContext.usedMetric ? performance.now() : 0;
            const data = await readRequestData(req);
            const query = JSON.parse(data) as string | null;
            if (!query) {
                return this.#webhookHandleError(req, res, 400, responseCb);
            }
            const auth = getBearerToken(req.headers?.authorization);

            appType = this.#getAppType(query, req.headers);
            const platformAdapter = appType ? this.#appContext.platforms[appType] : undefined;
            if (appType && platformAdapter) {
                if (!platformAdapter.isCorrectQuery(data, req.headers, query)) {
                    // В лог уходит только мета-информация: сериализация всего
                    // req/res тащила бы в логи сырые sockets и заголовки с cookies.
                    this.#appContext.logError(
                        `Bot:webhookHandle(): Для платформы "${appType}", пришел запрос с неверным токеном. Дальнейшая обработка запроса остановлена.`,
                        {
                            method: req.method,
                            url: req.url,
                            // Маскируем потенциально чувствительные заголовки явно
                            remoteAddress: req.socket?.remoteAddress,
                            userAgent: req.headers?.['user-agent'],
                        },
                    );
                    return this.#webhookHandleError(req, res, 401, responseCb);
                }
                const accepted = await this.#deliveryDedup.accept(platformAdapter, query, data);
                if (accepted === false) {
                    return this.#sendWebhookResponse(
                        req,
                        res,
                        { statusCode: 200, body: 'ok', defaultSend },
                        responseCb,
                    );
                }
                delivery = accepted;
            }
            const result = await this.run(appType, query, auth, req.socket?.remoteAddress);
            const statusCode = result === 'notFound' ? 404 : 200;
            if (this.#appContext.usedMetric) {
                this.#appContext.logMetric(EMetric.END_WEBHOOK, performance.now() - startTimer, {
                    appType,
                    success: statusCode === 200,
                });
            }
            return this.#sendWebhookResponse(
                req,
                res,
                {
                    statusCode,
                    body: result,
                    defaultSend,
                },
                responseCb,
            );
        } catch (error) {
            if (error instanceof SyntaxError) {
                this.#appContext.logError(
                    `Bot:webhookHandle(): Невозможно распарсить тело запроса как JSON. Убедитесь, что платформа "${appType}" отправляет корректные данные: ${error.message}`,
                    {
                        file: 'Bot:webhookHandle()',
                        error,
                    },
                );
                return this.#webhookHandleError(req, res, 422, responseCb);
            }
            if (error instanceof BotBadRequestError) {
                // Некорректный запрос — 400, см. BotBadRequestError. Доставка считается
                // обработанной: повтор того же запроса подтвердится 200 без обработки.
                return this.#webhookHandleError(req, res, 400, responseCb, 'Bad Request');
            }
            this.#appContext.logError(
                `Bot:webhookHandle(): Произошла ошибка при работе приложения для платформы "${appType}": ${error instanceof Error ? error.message : String(error)}`,
                {
                    error,
                },
            );
            serverError = true;
            return this.#webhookHandleError(req, res, 500, responseCb);
        } finally {
            this.#deliveryDedup.finish(delivery, !serverError);
        }
    }

    /**
     * Обрабатывает входящее событие от серверлесс-платформы (например, Yandex Cloud Functions)
     * с предварительной проверкой подлинности запроса через `isCorrectQuery` соответствующей платформы.
     *
     * **Зачем это нужно:**
     * В отличие от {@link run}, метод принимает заголовки запроса и выполняет ту же проверку
     * webhook-токена/подписи, что и {@link webhookHandle}. Это защищает cloud-функцию от
     * поддельных запросов: если у платформы задан секрет вебхука, запрос без корректной
     * подписи будет отклонён со статусом 401 до выполнения какой-либо логики.
     *
     * **Когда использовать:**
     * - Приложение разворачивается как serverless-функция (Yandex Cloud Functions, AWS Lambda и т.п.),
     *   где нет нативных `IncomingMessage`/`ServerResponse` для {@link webhookHandle}.
     *
     * @param {string | object | null} data - Тело запроса. Рекомендуется передавать сырую строку
     *        (как она пришла от платформы), чтобы проверка подписи (HMAC) считалась от исходного тела.
     * @param {Record<string, unknown>} [headers] - Заголовки запроса (для проверки подписи и авторизации).
     *        Регистр имён не важен: они приводятся к нижнему регистру (serverless-платформы
     *        передают заголовки как `X-Telegram-Bot-Api-Secret-Token`).
     * @param {string} [clientIp] - IP-адрес клиента (опционально, для middleware и логирования).
     * @returns {Promise<IWebhookEventResult>} Объект с HTTP-статусом и телом ответа для возврата из cloud-функции.
     *
     * @example
     * ```ts
     * // Обработчик Yandex Cloud Function
     * export const handler = async (event: Record<string, unknown>) => {
     *     const requestContext = event.requestContext as { identity?: { sourceIp?: string } } | undefined;
     *     // Третий аргумент — IP клиента (нужен middleware ipFilter)
     *     const result = await bot.webhookEvent(
     *         event.body as string,
     *         event.headers as Record<string, unknown>,
     *         requestContext?.identity?.sourceIp,
     *     );
     *     return {
     *         statusCode: result.statusCode,
     *         headers: { 'Content-Type': 'application/json' },
     *         body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
     *     };
     * };
     * ```
     */
    public async webhookEvent(
        data: string | object | null,
        headers: Record<string, unknown> = {},
        clientIp?: string,
    ): Promise<IWebhookEventResult> {
        let query: string | object | null;
        if (typeof data === 'string') {
            try {
                query = JSON.parse(data) as object;
            } catch (error) {
                this.#appContext.logError(
                    `Bot:webhookEvent(): Невозможно распарсить тело запроса как JSON: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                    { file: 'Bot:webhookEvent()' },
                );
                // 400, как и webhookHandle: некорректный запрос — не ошибка сервера.
                return { statusCode: 400, body: 'Invalid JSON' };
            }
        } else {
            query = data;
        }
        if (!query) {
            return { statusCode: 400, body: 'Empty request' };
        }

        // Имена HTTP-заголовков регистронезависимы. Node отдаёт их в нижнем регистре,
        // а Yandex Cloud Functions и API Gateway — как прислал клиент
        // (`X-Telegram-Bot-Api-Secret-Token`). Адаптеры ищут заголовки подписи
        // в нижнем регистре, поэтому приводим имена к нему.
        const normalizedHeaders: Record<string, unknown> = {};
        for (const name in headers) {
            const lowerName = name.toLowerCase();
            // Прототипные ключи не копируем: заголовки serverless-события приходят
            // от отправителя запроса, а присваивание по ключу __proto__ подменяло
            // прототип объекта и подсовывало проверким адаптеров чужие значения.
            if (
                lowerName === '__proto__' ||
                lowerName === 'constructor' ||
                lowerName === 'prototype'
            ) {
                continue;
            }
            normalizedHeaders[lowerName] = headers[name];
        }

        const auth = getBearerToken(normalizedHeaders.authorization);

        const appType = this.#getAppType(query, normalizedHeaders);
        const platformAdapter = appType ? this.#appContext.platforms[appType] : undefined;
        let delivery: IDelivery | null = null;
        if (platformAdapter) {
            if (!platformAdapter.isCorrectQuery(data, normalizedHeaders, query)) {
                // Логируем только мета-информацию, не всё тело запроса.
                this.#appContext.logError(
                    `Bot:webhookEvent(): Для платформы "${appType}" пришёл запрос с неверным токеном. Дальнейшая обработка остановлена.`,
                    { userAgent: normalizedHeaders['user-agent'] },
                );
                return { statusCode: 401, body: 'Unauthorized' };
            }
            const accepted = await this.#deliveryDedup.accept(
                platformAdapter,
                query,
                data ?? query,
            );
            if (accepted === false) {
                return { statusCode: 200, body: 'ok' };
            }
            delivery = accepted;
        }

        let serverError = false;
        try {
            const result = await this.run(appType, query, auth, clientIp);
            return { statusCode: result === 'notFound' ? 404 : 200, body: result };
        } catch (error) {
            if (error instanceof BotBadRequestError) {
                // См. webhookHandle: некорректный запрос платформы — это 400, не 500.
                return { statusCode: 400, body: 'Bad Request' };
            }
            this.#appContext.logError(
                `Bot:webhookEvent(): Произошла ошибка при обработке запроса для платформы "${appType}": ${
                    error instanceof Error ? error.message : String(error)
                }`,
                { error },
            );
            serverError = true;
            return { statusCode: 500, body: 'Internal Server Error' };
        } finally {
            this.#deliveryDedup.finish(delivery, !serverError);
        }
    }

    /**
     * Запускает встроенный HTTP-сервер на указанном хосте и порте для приёма webhook-запросов
     * от поддерживаемых платформ. Сервер использует нативный `http.createServer`.
     *
     * Метод возвращает экземпляр `http.Server`, что позволяет, например, корректно
     * остановить сервер или добавить обработчики событий (`'listening'`, `'error'` и т.д.).
     *
     * Если требуется интеграция с фреймворком (например, Express, Fastify и др.),
     * рекомендуется использовать {@link webhookHandle} как middleware-обработчик.
     *
     * @see webhookHandle
     *
     * @param {string} hostname - Имя хоста
     * @param {number} port - Порт
     * @param responseCb - Callback, для пользовательской обработки ответа пользователю. Стоит использовать в том случае, если есть необходимость переопределить стандартный ответ фреймворка.
     * @returns {Server} Экземпляр http.Server для управления сервером
     *
     * @example
     * ```ts
     * // Запуск встроенного сервера
     * const bot = new Bot();
     * bot.start('0.0.0.0', 8080);
     *
     * // Интеграция с Express (вместо встроенного сервера)
     * // webhookHandle сам читает тело запроса — не подключайте express.json().
     * import express from 'express';
     * import { Bot } from 'umbot';
     *
     * const bot = new Bot();
     * const app = express();
     * app.post('/webhook', (req, res) => bot.webhookHandle(req, res));
     *
     * app.listen(3000, () => {
     *   console.log('Bot listening on port 3000');
     * });
     * ```
     * ```ts
     * // Пример с переопределением ответа
     * const bot = new Bot();
     * // В случае если вернулся статус отличный от 200, вернет содержимое какой-то страницы.
     * bot.start('0.0.0.0', 8080, (reg: IncomingMessage, _res: ServerResponse, state: IBotResponseState) => {
     *      if (state.statusCode === 200) {
     *          return state.defaultSend(_res, state);
     *      }
     *      _res.statusCode = 200;
     *      _res.end(...);// Какое-то содержимое страницы
     * });
     * ```
     */
    public start(
        hostname: string = 'localhost',
        port: number = 3000,
        responseCb?: TBotResponseCb,
    ): Server {
        this.#webhookServer ??= new WebhookServer(
            this.#appContext,
            (req, res, cb) => this.webhookHandle(req, res, cb),
            this.#shutdownSignals,
        );
        return this.#webhookServer.start(hostname, port, responseCb);
    }

    /**
     * Запускает long polling: бот сам запрашивает обновления у платформ вместо
     * приёма вебхука. Публичный HTTPS-адрес и туннель (ngrok) не нужны — удобно для
     * локальной разработки и серверов без HTTPS.
     *
     * Polling работает на платформах, адаптер которых реализует `getUpdates`: Telegram,
     * VK и MAX. Алиса, Маруся, SmartApp и Viber присылают запросы только вебхуком.
     * Обновление проходит тот же конвейер, что и вебхук (middleware, команды, очередь
     * пользователя), кроме проверки подписи: оно получено от API по токену бота.
     * Обновления одной пачки выполняются параллельно, запросы одного пользователя — по очереди.
     *
     * У Telegram polling не работает, пока у бота зарегистрирован вебхук: удалите его
     * (`deleteWebhook`) или используйте для разработки другой токен. Для VK включите
     * Bots Long Poll API в настройках сообщества («Работа с API» → «Long Poll API») и
     * отметьте нужные типы событий.
     *
     * Можно совмещать с {@link start}: например, VK через вебхук, Telegram через polling.
     * Повторный вызов при запущенном polling возвращает тот же промис.
     *
     * @param options Параметры запуска: `platforms` — для каких платформ запустить polling
     *   (по умолчанию — все подключённые адаптеры с поддержкой polling).
     * @returns Промис, который выполняется, когда polling остановлен: {@link stopPolling},
     *   {@link close}, сигнал SIGINT/SIGTERM или отказ всех платформ (причина — в логе).
     *   Отклоняется, если ни один выбранный адаптер не поддерживает polling.
     *
     * @example
     * ```ts
     * import { Bot } from 'umbot';
     * import { TelegramAdapter } from 'umbot/plugins';
     *
     * const bot = new Bot();
     * bot.use(new TelegramAdapter(process.env.TELEGRAM_TOKEN));
     * bot.addCommand('hello', ['привет'], (_text, ctx) => {
     *     ctx.text = 'Привет!';
     * });
     *
     * // Вместо bot.start(): вебхук и HTTPS не нужны
     * await bot.startPolling();
     *
     * // Только Telegram; остальные платформы — через вебхук
     * bot.start('0.0.0.0', 3000);
     * await bot.startPolling({ platforms: ['telegram'] });
     * ```
     */
    public startPolling(options: IPollingOptions = {}): Promise<void> {
        this.#pollingRunner ??= new PollingRunner(
            this.#appContext,
            (appType, update) => this.run(appType, update),
            () => this.#shutdownSignals.ensure(),
        );
        return this.#pollingRunner.start(options);
    }

    /**
     * Останавливает long polling, запущенный {@link startPolling}: обрывает текущие
     * запросы за обновлениями и ждёт, пока обработаются уже полученные.
     * Без запущенного polling ничего не делает. {@link close} вызывает метод сам.
     * @returns Промис, выполненный после остановки всех циклов polling
     *
     * @example
     * ```ts
     * const polling = bot.startPolling();
     * // ...
     * await bot.stopPolling();
     * await polling; // уже выполнен
     * ```
     */
    public async stopPolling(): Promise<void> {
        await this.#pollingRunner?.stop();
    }

    async #gracefulShutdown(): Promise<void> {
        this.#appContext.log('Получен сигнал завершения. Выполняется graceful shutdown...');

        try {
            await this.close();
        } catch (err) {
            // Если БД-адаптер или плагин не смог закрыться, это не должно блокировать выход.
            // Иначе процесс зависнет и не ответит на SIGTERM (например, в Docker).
            this.#appContext.logError('Ошибка при graceful shutdown (close):', {
                error: err as Error,
            });
        }
        try {
            this.#appContext.command.clearCommands();
            this.#appContext.command.clearSteps();
            Text.clearCache();
        } catch (err) {
            this.#appContext.logError('Ошибка при graceful shutdown (cleanup):', {
                error: err as Error,
            });
        }

        this.#appContext.log('Graceful shutdown завершён.');
        // Принудительный выход — только страховка на случай, если event loop продолжают
        // держать чужие дескрипторы (плагины, БД-драйверы): при чистом цикле процесс
        // завершится сам, не дожидаясь таймаута (таймер unref'нут).
        this.#shutdownSignals.armForceExit(GRACEFUL_FORCE_EXIT_TIMEOUT);
    }

    /**
     * Подключается к БД заранее, не дожидаясь первого запроса: `connect()` DB-адаптера,
     * затем `ensureSchema()` со встроенными таблицами и `appConfig.dbTables` — тот же путь,
     * что ядро проходит на первом запросе. Нужен там, где входящих запросов нет: задачи cron,
     * скрипты миграции, рассылки из отдельного процесса. После него {@link close} закрывает БД,
     * а первый запрос не подключается повторно.
     *
     * @returns `true`, если подключение установлено (или уже было); `false`, если DB-адаптер
     *   не подключён или база недоступна (причина — в логе)
     *
     * @example
     * ```ts
     * // Задача cron: напоминания без входящих запросов
     * if (await bot.connect()) {
     *     const reminders = new ReminderModel(bot.getAppContext());
     *     // ... работа с моделями, bot.send(...)
     * }
     * await bot.close(); // закрывает и подключение к БД
     * ```
     */
    public async connect(): Promise<boolean> {
        const dbAdapter = this.#appContext.database.adapter;
        return dbAdapter ? (await this.#getDbAdapter(dbAdapter)) !== undefined : false;
    }

    /**
     * Корректно завершает работу встроенного HTTP-сервера (если он был запущен через {@link start})
     * и long polling (если он был запущен через {@link startPolling}).
     * Ожидает завершения всех текущих запросов, освобождает сетевые ресурсы и отменяет
     * все активные асинхронные операции, связанные с жизненным циклом приложения.
     *
     * Метод безопасен для повторного вызова.
     *
     * @returns {Promise<void>} Завершается, когда сервер остановлен и все ресурсы освобождены.
     *
     * @example
     * ```ts
     * const bot = new Bot();
     * bot.start('localhost', 3000);
     *
     * // ... позже, при завершении приложения
     * await bot.close();
     * ```
     */
    public async close(): Promise<void> {
        // close() сервера внутри вызывает server.close() синхронно, до первого await:
        // сервер перестаёт принимать соединения сразу, даже если вызывающий не ждёт close().
        const serverClosed = this.#webhookServer?.close();
        await this.stopPolling();
        // Дожидаемся завершения активных запросов — иначе процесс может
        // завершиться до того, как сервер отпустит сокеты.
        await serverClosed;
        // Удаляем обработчики сигналов
        this.#shutdownSignals.remove();
        // Также необходимо почистить все подключенные плагины.
        this.clearUse();
        for (const session of this.#memorySessions.values()) {
            session.clear();
        }
        this.#memorySessions.clear();
        await this.#appContext.close();
    }

    /**
     * Отправка текста пользователю
     * Этот метод используется для активных рассылок — когда голосовой навык или чат-бот инициирует диалог первым (например, уведомление).
     * Метод делегирует отправку соответствующему адаптеру платформы.
     *
     * Если платформа не поддерживает возможность начать диалог самостоятельно, то вернется false
     * @param userId Ид пользователя, которому нужно отправить сообщение
     * @param controllerOrText Текст, сообщение `{ text, tts?, buttons? }` ({@link ISendMessage}) или контроллер —
     *   для карточек, звуков и всего, что не умещается в сообщение
     * @param platform Платформа, на которую необходимо отправить запрос
     * @returns {Promise<unknown>} `'ok'` у встроенных чат-платформ (формат зависит от адаптера) либо `false`:
     * платформа отклонила отправку (ошибка API, сеть, таймаут — причина в логе), не зарегистрирована
     * или не поддерживает проактивную отправку
     *
     * @example
     * ```ts
     * import { T_TELEGRAM } from 'umbot/plugins';
     *
     * // Проактивное сообщение в Telegram (без входящего запроса)
     * const result = await bot.send('123456789', 'Привет! Это рассылка.', T_TELEGRAM);
     * if (result === false) {
     *     // не доставлено: пользователь заблокировал бота, неверный id, сбой сети
     * }
     *
     * // С кнопками — без сборки контроллера
     * await bot.send('123456789', { text: 'Комната готова', buttons: ['Открыть'] }, T_TELEGRAM);
     * ```
     */
    public send(
        userId: string | number,
        controllerOrText: BotController | string | ISendMessage,
        platform: TAppType,
    ): Promise<unknown | boolean> {
        return this.#outboundSender.send(userId, controllerOrText, platform);
    }

    /**
     * Рассылка одного сообщения многим пользователям через {@link send}. Темп задаёт лимит
     * адаптера (`sendLimit`: Telegram — 30 сообщений в секунду, VK — 20, MAX — 30; опция
     * адаптера `send_rate_limit`), поэтому рассылка не упирается в ошибки 429 / «Too many
     * requests». Отправки идут в несколько потоков, ответы на входящие запросы очередь не ждут.
     *
     * Сообщение — строка, {@link ISendMessage} (`{ text, buttons }`) или фабрика
     * `(userId) => сообщение | контроллер` — для текста под получателя, карточек и звуков.
     * Контроллер создавайте в фабрике заново: один контроллер нельзя отправлять параллельно.
     *
     * @param userIds Получатели
     * @param message Текст или фабрика сообщения
     * @param platform Платформа
     * @param options `onResult(userId, ok)` — вызывается после каждой отправки (прогресс,
     *   отметка в БД); ошибка в нём пишется в лог и рассылку не прерывает
     * @returns Кому доставлено (`sent`) и кому нет (`failed`); порядок внутри списков не гарантирован
     *
     * @example
     * ```ts
     * const { sent, failed } = await bot.broadcast(subscriberIds, (userId) => {
     *     const ctx = new BaseBotController(bot.getAppContext());
     *     ctx.text = 'Новый выпуск уже доступен';
     *     ctx.buttons.addBtn('Открыть', 'https://example.com/news');
     *     return ctx;
     * }, T_TELEGRAM);
     * console.log(`Доставлено ${sent.length} из ${subscriberIds.length}`);
     * ```
     */
    public broadcast(
        userIds: readonly (string | number)[],
        message:
            | string
            | ISendMessage
            | ((userId: string | number) => BotController | string | ISendMessage),
        platform: TAppType,
        options: IBroadcastOptions = {},
    ): Promise<IBroadcastResult> {
        return this.#outboundSender.broadcast(userIds, message, platform, options);
    }
}
