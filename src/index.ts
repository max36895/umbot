/**
 * @author Maxim-M <maximco36895@yandex.ru>
 *
 * **umbot** — кроссплатформенный TypeScript-фреймворк для разработки голосовых навыков и чат-ботов. Он даёт единую бизнес-логику для всех платформ — но одинаково эффективен, даже если вы работаете только с одной.
 * Поддерживаются: `Яндекс.Алиса`, `Маруся`, `Сбер SmartApp`, а также `Telegram`, `VK`, `MAX` и `Viber` из коробки.
 *
 * ## 🚀 Основные возможности
 * - Создание голосовых навыков для Алисы, Маруси и Сбер SmartApp
 * - Разработка чат-ботов для Telegram, Viber, VK и MAX
 * - Создание навыка/бота для любой платформы
 * - Единая логика для голосовых и текстовых интерфейсов (навыки/чат-боты)
 * - Гибкая система команд, интентов и многошаговых диалогов
 * - Встроенная работа с состоянием (локальное хранилище, БД через адаптеры)
 * - UI-компоненты: кнопки, карточки, звуки, TTS
 * - Middleware, плагины, метрики и логирование
 * - Расширяемость: легко добавить новую платформу через адаптер
 *
 * Основная работа приложения основана на использовании {@link Bot}, который отвечает за всё взаимодействие с платформами и обработку запросов.
 *
 * Подробнее о каждом компоненте читайте в соответствующих разделах документации.
 *
 * @example
 * ```ts
 * // Минимальный пример работы
 * import { Bot, BotController, FALLBACK_COMMAND, HELP_INTENT_NAME, WELCOME_INTENT_NAME } from 'umbot';
 * import { fullPlatforms } from 'umbot/plugins';
 *
 * const bot = new Bot()
 *     .use(fullPlatforms) // Подключаем все доступные платформы
 *     .setAppConfig({ json: './data', isLocalStorage: true }) // Директория для данных и локальное хранилище
 *     .addCommand(WELCOME_INTENT_NAME, ['привет'], (_: string, bc: BotController) => {
 *         bc.text = 'Привет! Я новый навык.';
 *         bc.buttons.addBtn('Помощь');
 *     })
 *     .addCommand(HELP_INTENT_NAME, ['помощь'], (_: string, bc: BotController) => {
 *         bc.text = 'Я умею отвечать на команды и показывать кнопки';
 *     })
 *     .addCommand(FALLBACK_COMMAND, [], (_: string, bc: BotController) => {
 *         bc.text = bc.userCommand || 'Вы ничего не сказали';
 *     }) // Если команда не найдена
 *     .start('localhost', 3000);
 * ```
 *
 * @packageDocumentation
 * @module index
 */

// ===== Ядро приложения =====
/**
 * Основные компоненты ядра фреймворка
 *
 * Включает:
 * - Базовые классы и интерфейсы
 * - Систему обработки команд
 * - Управление состоянием
 * - Обработку ошибок
 */
export {
    ALL_EVENT_TYPES,
    AppContext,
    Bot,
    CommandReg,
    createPlugin,
    EMetric,
    FALLBACK_COMMAND,
    HELP_INTENT_NAME,
    HELP_INTENT_SLOTS,
    isEventType,
    MEMORY_SESSION_MAX_SIZE,
    MEMORY_SESSION_TTL,
    MemorySessionStorage,
    T_AUTO,
    WELCOME_INTENT_NAME,
    WELCOME_INTENT_SLOTS,
} from './core';
export type {
    AnyPluginData,
    IAddFormField,
    IAddFormOptions,
    IAppConfig,
    IAppDB,
    IAppIntent,
    IAppParam,
    IAppPlugin,
    IAppPluginFn,
    IBotResponse,
    IBotResponseState,
    IBroadcastOptions,
    IBroadcastResult,
    IButtonAction,
    ICardInfo,
    ICommandParam,
    IDangerRegex,
    IDatabaseAdapter,
    IDatabaseInfo,
    IDbResult,
    IDir,
    IEventParam,
    IGroupData,
    ILogger,
    IMemorySessionConfig,
    IMenu,
    IMenuButton,
    IMenuOptions,
    IMenuScreen,
    IPlatform,
    IPlatformAdapter,
    IPlugin,
    IPluginFn,
    IPollingOptions,
    ISendButton,
    ISendMessage,
    ISoundInfo,
    IStepParam,
    ITokenPlatform,
    IWebhookEventResult,
    MiddlewareFn,
    MiddlewareNext,
    TActionData,
    TAppMode,
    TAppPlugin,
    TAppPluginData,
    TAppType,
    TBotAuth,
    TBotContent,
    TBotControllerClass,
    TBotResponseCb,
    TButtonProcessing,
    TCardProcessing,
    TCommandGroupMode,
    TCommandResolver,
    TEventType,
    TFormContext,
    TFormParseResult,
    THttpClient,
    TLoggerCb,
    TPlatformResolver,
    TPlugin,
    TPluginFnResult,
    TRunResult,
    TSlots,
    TSoundProcessing,
} from './core';

// ===== Взаимодействие с web api =====
/**
 * Модули для работы с внешними API
 *
 * Предоставляет:
 * - Базовый HTTP-клиент Request
 * - Интерфейсы для API
 */
export { Request } from './api';
export type { IRequestSend } from './api';

// ===== Второстепенные компоненты =====
/**
 * Вспомогательные компоненты
 *
 * Включает:
 * - Кнопки и клавиатуры
 * - Карточки и изображения
 * - Звуки и аудио
 * - NLU (разбор и извлечение сущностей)
 * - Стандартные хелперы (Navigation и др.)
 * - UI элементы
 */
export {
    Buttons,
    Card,
    getButton,
    getImage,
    getLinkButton,
    initButton,
    Navigation,
    Nlu,
    Sound,
    SoundConstants,
} from './components';
export type {
    IBaseEntities,
    IBaseNlu,
    IButton,
    IButtonOptions,
    IButtonType,
    IEffect,
    IImageParams,
    IImageType,
    INlu,
    INluDateTime,
    INluFIO,
    INluGeo,
    INluIntent,
    INluIntents,
    INluResult,
    INluSlot,
    INluThisUser,
    ISound,
    TBtnPayload,
    TButton,
    TButtonPayload,
    TElementType,
    TKeys,
} from './components';

// ===== Базовый контроллер для написания логики приложения =====
/**
 * Контроллеры приложения
 *
 * Предоставляет:
 * - Базовый класс BotController
 * - Методы для обработки команд
 * - Управление состоянием
 * - Шаблоны ответов
 */
export { BaseBotController, BotController } from './controller';
export type {
    IApiMediaParams,
    IControllerApi,
    IPlatformData,
    IPlatformOptions,
    IUserData,
    IUserEvent,
    TApiMethod,
    TStatus,
} from './controller';

// ===== Модели для взаимодействия с бд =====
/**
 * Модели данных
 *
 * Содержит:
 * - Классы для работы с БД
 * - Интерфейсы моделей
 * - Запросы
 */
export {
    DB_TABLES_SCHEMA,
    getQueryData,
    ImageTokens,
    Model,
    SoundTokens,
    UsersData,
} from './models';
export type {
    IDataValue,
    IDbFieldSchema,
    IDbTableSchema,
    IImageModelState,
    IModelRes,
    IModelRules,
    IModelState,
    IQuery,
    IQueryData,
    ISelectOneModelRes,
    ISoundModelState,
    IUserDataModelState,
    TDataType,
    TDbFieldType,
    TKey,
    TMetaType,
    TModelRulesType,
    TQueryCb,
} from './models';

// ===== Дополнительные утилиты =====
/**
 * Вспомогательные утилиты
 *
 * Включает:
 * - Работа с текстом
 * - Форматирование данных
 * - Валидация
 * - Хелперы
 */
export {
    __$usedRe2,
    fread,
    freadSync,
    fwrite,
    fwriteSync,
    getFileInfo,
    getFileInfoSync,
    getRegExp,
    getRegExpOrSelf,
    httpBuildQuery,
    isDir,
    isDirSync,
    isFile,
    isFileSync,
    isPromise,
    isRegex,
    keysCount,
    loadEnvFile,
    mkdir,
    mkdirSync,
    rand,
    safeStringify,
    saveData,
    saveDataSync,
    similarText,
    stdin,
    stripTags,
    Text,
    unlink,
    unlinkSync,
} from './utils';
export type {
    FileOperationResult,
    IEnvConfig,
    IEnvConfigStatus,
    IGetParams,
    ITextSimilarity,
    TPattern,
    TPatternReg,
    TPatternRegExp,
} from './utils';
