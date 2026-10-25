/**
 * TelegramRequest.call(method, chatId, params): вызов любого метода Bot API с параметрами.
 */
import { AppContext } from '../../../src';
import { TelegramRequest } from '../../../src/plugins';

const SUCCESS = {
    ok: true,
    status: 200,
    json: async (): Promise<Record<string, unknown>> => ({ ok: true, result: true }),
};

function makeApi(httpClient: jest.Mock): TelegramRequest {
    const ctx = new AppContext();
    ctx.setLogger({ error: jest.fn(), warn: jest.fn() });
    (ctx as unknown as { httpClient: typeof httpClient }).httpClient = httpClient;
    const api = new TelegramRequest(ctx);
    api.initToken('123:token');
    return api;
}

function lastRequest(httpClient: jest.Mock): { url: string; body: Record<string, unknown> } {
    const [url, init] = httpClient.mock.calls.at(-1) as [string, RequestInit];
    return { url, body: JSON.parse(String(init.body)) as Record<string, unknown> };
}

describe('TelegramRequest.call с параметрами', () => {
    it('передаёт параметры и chat_id в тело запроса метода', async () => {
        const httpClient = jest.fn().mockResolvedValue(SUCCESS);
        const api = makeApi(httpClient);
        const params = {
            message_id: 7,
            text: 'Обновлено',
            reply_markup: { inline_keyboard: [[{ text: 'Ещё', callback_data: 'more' }]] },
        };

        const result = await api.call('editMessageText', 42, params);

        expect(result).toEqual({ ok: true, result: true });
        const { url, body } = lastRequest(httpClient);
        expect(url).toBe('https://api.telegram.org/bot123:token/editMessageText');
        expect(body).toEqual({ ...params, chat_id: 42 });
        expect(params).not.toHaveProperty('chat_id');
    });

    it('без chatId уходят только параметры', async () => {
        const httpClient = jest.fn().mockResolvedValue(SUCCESS);
        const api = makeApi(httpClient);

        await api.call('answerCallbackQuery', null, { callback_query_id: 'q1' });

        expect(lastRequest(httpClient).body).toEqual({ callback_query_id: 'q1' });
    });

    it('параметры одного вызова не попадают в следующий', async () => {
        const httpClient = jest.fn().mockResolvedValue(SUCCESS);
        const api = makeApi(httpClient);

        await api.call('pinChatMessage', 42, { message_id: 1 });
        await api.sendMessage(42, 'привет');

        expect(lastRequest(httpClient).body).toEqual({ chat_id: 42, text: 'привет' });
    });

    it('ошибка API — null', async () => {
        const httpClient = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ ok: false, description: 'message is not modified' }),
        });
        const api = makeApi(httpClient);

        expect(await api.call('editMessageText', 42, { message_id: 1, text: 'x' })).toBeNull();
    });
});
