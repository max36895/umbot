/**
 * Request.send() при ответе не 2xx отдаёт HTTP-статус и тело ошибки: по ним
 * API-клиенты отличают 429 (повторить позже) от 400 (запрос неверен).
 */
import { AppContext, Request } from '../../../src';

function makeContext(httpClient: jest.Mock): AppContext {
    const ctx = new AppContext();
    ctx.setLogger({ error: jest.fn(), warn: jest.fn() });
    (ctx as unknown as { httpClient: typeof httpClient }).httpClient = httpClient;
    return ctx;
}

describe('Request: статус и тело ответа с ошибкой', () => {
    it('ответ не 2xx — httpStatus и errorBody заполнены', async () => {
        const body = '{"ok":false,"error_code":429,"parameters":{"retry_after":3}}';
        const httpClient = jest.fn().mockResolvedValue({
            ok: false,
            status: 429,
            text: async () => body,
        });
        const req = new Request(makeContext(httpClient));

        const res = await req.send('https://example.com/api');

        expect(res.status).toBe(false);
        expect(res.httpStatus).toBe(429);
        expect(res.errorBody).toBe(body);
    });

    it('сетевая ошибка — httpStatus и errorBody отсутствуют', async () => {
        const httpClient = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
        const req = new Request(makeContext(httpClient));

        const res = await req.send('https://example.com/api');

        expect(res.status).toBe(false);
        expect(res).not.toHaveProperty('httpStatus');
        expect(res).not.toHaveProperty('errorBody');
    });

    it('статус предыдущего вызова не протекает в следующий', async () => {
        const httpClient = jest
            .fn()
            .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'fail' })
            .mockRejectedValueOnce(new Error('timeout'));
        const req = new Request(makeContext(httpClient));

        await req.send('https://example.com/api');
        const second = await req.send('https://example.com/api');

        expect(second).not.toHaveProperty('httpStatus');
    });
});
