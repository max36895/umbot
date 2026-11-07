// middleware/requestId.ts
import { BotController } from '../controller';
import { MiddlewareNext } from '../core';
import { randomUUID } from 'crypto';

declare module '../controller/BotController' {
    interface IPlatformOptions {
        /**
         * Уникальный идентификатор входящего запроса.
         * Заполняется middleware `requestId()`.
         */
        requestId?: string;
    }
}

/**
 * Middleware, проставляющее уникальный `requestId` в `platformOptions.requestId`.
 *
 * Полезно для сквозного трейсинга запросов — логгеры, Sentry и другие инструменты
 * могут связать все логи одного входящего запроса.
 *
 * Также сохраняет requestId в `appContext.lastRequestId` — последний выданный ID
 * (для логирования вне обработки запроса).
 *
 * @example
 * ```ts
 * import { requestId } from 'umbot/middleware';
 *
 * bot.use(requestId());
 * // дальше в обработчике или других middleware есть ctx.platformOptions.requestId
 * ```
 *
 * @returns Middleware для `bot.use(...)`.
 */
export function requestId(): (ctx: BotController, next: MiddlewareNext) => Promise<void> {
    return async (ctx: BotController, next: MiddlewareNext): Promise<void> => {
        let id: string;
        try {
            id = randomUUID();
        } catch {
            // На случай экзотических рантаймов без crypto.
            id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        }
        ctx.platformOptions.requestId = id;
        // Последний выданный id доступен и вне ctx — для логов вне обработки запроса.
        // Гонка параллельных запросов не важна: безразлично, чей именно id крайний.
        ctx.appContext.lastRequestId = id;
        // next() обязано дождаться выполнения цепочки — иначе middleware после
        // этой не выполнятся.
        await next();
    };
}
