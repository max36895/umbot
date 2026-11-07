/**
 * Ядро фреймворка - основные компоненты для работы приложения с различными платформами.
 *
 * Модуль содержит:
 * - Интерфейсы для определения контрактов компонентов
 * - Основной класс приложения для обработки запросов
 * - Контекст приложения, в котором хранится вся настройка
 */
export type {
    IAddFormField,
    IAddFormOptions,
    IBotResponse,
    IBotResponseState,
    IBroadcastOptions,
    IBroadcastResult,
    IButtonAction,
    ICardInfo,
    IDatabaseAdapter,
    IDatabaseInfo,
    IDbResult,
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
    TActionData,
    TBotAuth,
    TBotContent,
    TBotResponseCb,
    TButtonProcessing,
    TCardProcessing,
    TCommandGroupMode,
    TFormContext,
    TFormParseResult,
    TPlugin,
    TPluginFnResult,
    TRunResult,
    TSoundProcessing,
} from './interfaces/IBot';
export type { ILogger, TLoggerCb } from './interfaces/ILogger';
export { EMetric } from './interfaces/IAppContext';
export type {
    AnyPluginData,
    IAppConfig,
    IAppDB,
    IAppIntent,
    IAppParam,
    IAppPlugin,
    IAppPluginFn,
    IDir,
    ITokenPlatform,
    TAppMode,
    TAppPlugin,
    TAppPluginData,
    TAppType,
    THttpClient,
} from './interfaces/IAppContext';
export { Bot } from './Bot';
export type {
    IWebhookEventResult,
    MiddlewareFn,
    MiddlewareNext,
    TBotControllerClass,
    TPlatformResolver,
} from './Bot';
export { AppContext, T_AUTO } from './AppContext';
export {
    FALLBACK_COMMAND,
    HELP_INTENT_NAME,
    HELP_INTENT_SLOTS,
    WELCOME_INTENT_NAME,
    WELCOME_INTENT_SLOTS,
} from './constants';
export { ALL_EVENT_TYPES, isEventType } from './events';
export type { TEventType } from './events';
export {
    CommandReg,
    type ICommandParam,
    type IDangerRegex,
    type TCommandResolver,
    type TSlots,
    type IStepParam,
    type IEventParam,
    type IGroupData,
} from './utils/CommandReg';
export {
    MemorySessionStorage,
    MEMORY_SESSION_MAX_SIZE,
    MEMORY_SESSION_TTL,
    type IMemorySessionConfig,
} from './utils/MemorySessionStorage';
export { createPlugin } from './plugin';
