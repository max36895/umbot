/**
 * Модуль для контроллеров. Контроллер - основной компонент для обработки бизнес-логики вашего приложения
 *
 * Модуль содержит:
 * - Абстрактный класс контроллера для обработки команд
 * - Интерфейсы для определения структуры данных
 * - Базовый класс контроллера, который установлен в Bot по умолчанию.
 */
export { BotController } from './BotController';
export type {
    IApiMediaParams,
    IControllerApi,
    IPlatformData,
    IPlatformOptions,
    IUserData,
    IUserEvent,
    TApiMethod,
    TStatus,
} from './BotController';

export { BaseBotController } from './BaseBotController';
