/**
 * TelegramRequest повторяет запрос после 429, если Telegram просит подождать недолго.
 * Долгое ожидание задержало бы ответ на вебхук — такой запрос не повторяется.
 */
import { AppContext } from '../../../src';
import { TelegramRequest } from '../../../src/plugins';

function tooManyRequests(retryAfter: number): Record<string, unknown> {
    return {
        ok: false,
        status: 429,
        text: async (): Promise<string> =>
            JSON.stringify({
                ok: false,
                error_code: 429,
                description: `Too Many Requests: retry after ${retryAfter}`,
                parameters: { retry_after: retryAfter },
            }),
    };
}

const SUCCESS = {
    ok: true,
    status: 200,
    json: async (): Promise<Record<string, unknown>> => ({ ok: true, result: { message_id: 1 } }),
};

function makeApi(httpClient: jest.Mock): TelegramRequest {
    const ctx = new AppContext();
    ctx.setLogger({ error: jest.fn(), warn: jest.fn() });
    (ctx as unknown as { httpClient: typeof httpClient }).httpClient = httpClient;
    const api = new TelegramRequest(ctx);
    api.initToken('123:token');
    return api;
}

describe('TelegramRequest: 429 и retry_after', () => {
    it('короткий retry_after — запрос повторяется с тем же телом', async () => {
        const httpClient = jest
            .fn()
            .mockResolvedValueOnce(tooManyRequests(0))
            .mockResolvedValueOnce(SUCCESS);
        const api = makeApi(httpClient);

        const result = await api.sendMessage(42, 'привет');

        expect(httpClient).toHaveBeenCalledTimes(2);
        const firstBody = (httpClient.mock.calls[0] as [string, RequestInit])[1].body;
        const secondBody = (httpClient.mock.calls[1] as [string, RequestInit])[1].body;
        expect(secondBody).toBe(firstBody);
        expect(String(secondBody)).toContain('привет');
        expect(result).toEqual({ ok: true, result: { message_id: 1 } });
    });

    it('долгий retry_after — без повтора, результат null', async () => {
        const httpClient = jest.fn().mockResolvedValue(tooManyRequests(60));
        const api = makeApi(httpClient);

        const result = await api.sendMessage(42, 'привет');

        expect(httpClient).toHaveBeenCalledTimes(1);
        expect(result).toBeNull();
    });

    it('ошибка не 429 не повторяется', async () => {
        const httpClient = jest.fn().mockResolvedValue({
            ok: false,
            status: 400,
            text: async () => '{"ok":false,"error_code":400,"description":"Bad Request"}',
        });
        const api = makeApi(httpClient);

        await api.sendMessage(42, 'привет');

        expect(httpClient).toHaveBeenCalledTimes(1);
    });
});
