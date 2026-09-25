import {
    rateLimiter,
    destroyRateLimiter,
    RateLimitQueueOverflowError,
} from '../../src/middleware/rateLimiter';
import { BaseBotController } from '../../src';
import { T_TELEGRAM, TelegramAdapter } from '../../src/plugins';

describe('rateLimiter middleware', () => {
    let ctx: BaseBotController;
    let next: jest.Mock;

    beforeEach(() => {
        ctx = new BaseBotController();
        ctx.appContext.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        new TelegramAdapter().init(ctx.appContext);
        // Эмулируем ограничение в 2 запроса в минуту
        ctx.appContext.platforms[T_TELEGRAM].limit = 2;
        ctx.appType = T_TELEGRAM;
        ctx.userId = 'user123';
        next = jest.fn().mockResolvedValue(undefined);
        jest.useFakeTimers();
    });

    afterEach(() => {
        destroyRateLimiter();
        jest.useRealTimers();
    });

    it('should allow requests under limit', async () => {
        const middleware = rateLimiter();
        const promise1 = middleware(ctx, next);
        const promise2 = middleware(ctx, next);

        await Promise.all([promise1, promise2]);

        expect(next).toHaveBeenCalledTimes(2);
    });

    it('should queue requests when limit exceeded', async () => {
        const middleware = rateLimiter(2);
        // Первые два пройдут сразу
        await middleware(ctx, next);
        await middleware(ctx, next);
        // Третий должен встать в очередь
        const third = middleware(ctx, next);
        // Убедимся, что next ещё не вызван
        expect(next).toHaveBeenCalledTimes(2);
        // Продвигаем время на 1 секунду, чтобы сбросился счётчик
        jest.advanceTimersByTime(1000);
        // Даём возможность очереди обработаться
        await third;
        expect(next).toHaveBeenCalledTimes(3);
    });

    it('should throw error when queue size exceeded', async () => {
        const middleware = rateLimiter(2); // макс очередь 2
        // Заполняем лимит (2 запроса)
        await middleware(ctx, next);
        await middleware(ctx, next);
        // Добавляем 3 в очередь (2 поместятся)
        const p1 = middleware(ctx, next);
        const p2 = middleware(ctx, next);
        // Третий должен выбросить ошибку
        const p3 = middleware(ctx, next);

        await expect(p3).rejects.toBeInstanceOf(RateLimitQueueOverflowError);
        await expect(p3).rejects.toThrow('rateLimit - Превышено ограничение на размер очереди');
        // Флаг позволяет вызывающему коду отличить отказ из-за перегрузки
        expect(ctx.platformOptions.rateLimitOverflow).toBe(true);
        // Проверяем, что p1 и p2 выполнятся после таймера
        jest.advanceTimersByTime(1000);
        await Promise.all([p1, p2]);
        expect(next).toHaveBeenCalledTimes(4); // два первых + два из очереди
    });

    it('батч из очереди не превышает лимит за счёт свежих запросов того же окна', async () => {
        const middleware = rateLimiter(10);
        // Окно 1: исчерпываем лимит (2 запроса)
        await middleware(ctx, next);
        await middleware(ctx, next);
        // Две задачи встают в очередь
        const p1 = middleware(ctx, next);
        const p2 = middleware(ctx, next);
        // Окно 2: пачка из очереди исполняется, счётчик сбрасывается в 0
        jest.advanceTimersByTime(1000);
        await Promise.all([p1, p2]);
        expect(next).toHaveBeenCalledTimes(4);
        // Всё ещё окно 2: счётчик исчерпан пачкой, поэтому свежий запрос не
        // проходит мгновенно, а встаёт в очередь. Раньше он проходил сразу,
        // и реальный rps за окно доходил до 2x лимита.
        const fresh = middleware(ctx, next);
        expect(next).toHaveBeenCalledTimes(4);
        // Окно 3: задача из очереди исполняется
        jest.advanceTimersByTime(1000);
        await fresh;
        expect(next).toHaveBeenCalledTimes(5);
    });

    it('should handle multiple users separately', async () => {
        const middleware = rateLimiter();
        const ctx2 = new BaseBotController();
        ctx2.appType = T_TELEGRAM;
        ctx2.userId = 'user456';

        // Для первого юзера превышаем лимит
        await middleware(ctx, next); // 1
        await middleware(ctx, next); // 2
        const third = middleware(ctx, next); // в очередь

        // Для второго юзера должно работать независимо
        await middleware(ctx2, next); // 1
        await middleware(ctx2, next); // 2
        expect(next).toHaveBeenCalledTimes(4); // первые два от каждого юзера

        jest.advanceTimersByTime(1000);
        await third;
        expect(next).toHaveBeenCalledTimes(5);
    });

    it('getKey: общий ключ ограничивает платформу целиком, смена userId лимит не обходит', async () => {
        const middleware = rateLimiter(100, 60000, (c) => c.appType ?? '');
        const other = new BaseBotController();
        other.setAppContext(ctx.appContext);
        other.appType = T_TELEGRAM;
        other.userId = 'attacker-rotated-id';

        await middleware(ctx, next); // 1
        await middleware(other, next); // 2 — тот же ключ платформы
        const queued = middleware(other, next); // лимит 2 исчерпан — в очередь

        expect(next).toHaveBeenCalledTimes(2);
        jest.advanceTimersByTime(1000);
        await queued;
        expect(next).toHaveBeenCalledTimes(3);
    });

    it('destroyRateLimiter очищает все инстансы, а не только последний', async () => {
        ctx.appContext.platforms[T_TELEGRAM].limit = 1;
        const limiter1 = rateLimiter(10);
        const limiter2 = rateLimiter(10);

        // Первый запрос каждого инстанса проходит, вторые встают в очередь
        await limiter1(ctx, next);
        const queued1 = limiter1(ctx, next);
        await limiter2(ctx, next);
        const queued2 = limiter2(ctx, next);

        // Очереди не обработаны (таймеры не продвигали) — сработали только первые два
        expect(next).toHaveBeenCalledTimes(2);

        destroyRateLimiter();

        // Оба ожидающих запроса из разных инстансов должны быть отклонены
        await expect(queued1).rejects.toThrow('Rate limiter destroyed');
        await expect(queued2).rejects.toThrow('Rate limiter destroyed');
    });
});
