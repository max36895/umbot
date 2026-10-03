/**
 * Внешний сигнал отмены Request.signal: действует вместе с таймаутом и
 * сбрасывается после send(), как остальные настройки одного вызова.
 */
import { getEventListeners } from 'node:events';
import { AppContext, Request } from '../../../src';

function makeContext(httpClient: jest.Mock): AppContext {
    const ctx = new AppContext();
    ctx.setLogger({ error: jest.fn(), warn: jest.fn() });
    ctx.httpClient = httpClient;
    return ctx;
}

describe('Request.signal', () => {
    it('отмена по внешнему сигналу обрывает запрос, таймаут продолжает действовать', async () => {
        let captured: AbortSignal | undefined;
        const httpClient = jest.fn((_url: string, options: RequestInit) => {
            captured = options.signal as AbortSignal;
            return new Promise((_resolve, reject) => {
                captured?.addEventListener('abort', () => reject(new Error('aborted')));
            });
        });
        const req = new Request(makeContext(httpClient));
        req.maxTimeQuery = 60_000;
        const controller = new AbortController();
        req.signal = controller.signal;

        const pending = req.send('https://example.com/updates');
        while (!captured) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        controller.abort();
        const res = await pending;

        expect(res.status).toBe(false);
        expect(captured?.aborted).toBe(true);
        expect(req.signal).toBeNull();
    });

    it('после запроса снимает подписку с внешнего сигнала', async () => {
        // Сигнал long polling живёт весь сеанс: подписки запросов не должны на нём копиться.
        const httpClient = jest.fn(async () => new Response('{}'));
        const req = new Request(makeContext(httpClient));
        const controller = new AbortController();

        for (let i = 0; i < 20; i++) {
            req.signal = controller.signal;
            await req.send('https://example.com');
        }

        expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    });

    it('уже отменённый сигнал обрывает запрос сразу', async () => {
        let captured: AbortSignal | undefined;
        const httpClient = jest.fn(async (_url: string, options: RequestInit) => {
            captured = options.signal as AbortSignal;
            return new Response('{}');
        });
        const req = new Request(makeContext(httpClient));
        const controller = new AbortController();
        controller.abort();
        req.signal = controller.signal;

        await req.send('https://example.com');

        expect(captured?.aborted).toBe(true);
    });
});
