global.fetch = jest.fn();

jest.mock('../../src/utils', () => ({
    ...jest.requireActual('../../src/utils'),
    fread: jest.fn().mockReturnValue({ data: new Uint8Array([1, 2, 3]), success: true }),
    isFile: jest.fn().mockReturnValue(true),
}));
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    readFileSync: jest.fn().mockReturnValue({ data: new Uint8Array([1, 2, 3]) }),
}));
jest.mock('fs/promises', () => ({
    ...jest.requireActual('fs/promises'),
    readFile: jest.fn().mockReturnValue({ data: new Uint8Array([1, 2, 3]) }),
}));

import { AppContext } from '../../src';
import { IMaxButtonObject, MaxRequest } from '../../src/plugins';

const appContext = new AppContext();
appContext.setLogger({ log: () => {}, error: () => {}, warn: () => {} });

describe('MaxRequest', () => {
    let max: MaxRequest;

    beforeEach(() => {
        appContext.appConfig.tokens.max_app = { token: 'test-max-token' };
        max = new MaxRequest(appContext);
        (global.fetch as jest.Mock).mockClear();
        appContext.logError = jest.fn();
    });

    // === Базовый вызов call ===
    it('should set Authorization header without duplicating the token in body', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ result: 'ok' }),
        });

        await max.call('test_method');

        expect(global.fetch).toHaveBeenCalledWith(
            'https://platform-api2.max.ru/test_method',
            expect.objectContaining({
                // JSON-тело обязано уходить с Content-Type: раньше кастомный заголовок
                // Authorization полностью затирал его в Request._getOptions().
                headers: {
                    Authorization: 'test-max-token',
                    'Content-Type': 'application/json',
                },
                body: '{}',
            }),
        );
    });

    // === Загрузка файла ===
    it('should upload file with FormData', async () => {
        const uploadTarget = { url: 'https://upload.max.test/file' };
        const mockResponse = { token: 'file_123' };
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => uploadTarget,
        });
        // Ответ сервера загрузки читается текстом (у audio/video он не JSON).
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            text: async () => JSON.stringify(mockResponse),
        });

        const result = await max.upload('test.jpg', 'image');

        expect(result).toEqual({ ...mockResponse, url: uploadTarget.url });
        expect(global.fetch).toHaveBeenCalledWith(
            'https://platform-api2.max.ru/uploads?type=image',
            expect.objectContaining({
                headers: { Authorization: 'test-max-token' },
                method: 'POST',
            }),
        );
        expect(global.fetch).toHaveBeenLastCalledWith(
            uploadTarget.url,
            expect.objectContaining({
                body: expect.any(FormData),
            }),
        );

        const formData = (global.fetch as jest.Mock).mock.calls[1][1].body as FormData;
        expect(formData.has('data')).toBe(true);
    });

    it('should keep audio token returned by the upload target request', async () => {
        const uploadTarget = { url: 'https://upload.max.test/audio', token: 'audio-token' };
        // Для audio/video сервер загрузки отвечает `retval` — не JSON, токен
        // берётся из ответа на POST /uploads.
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({ ok: true, json: async () => uploadTarget })
            .mockResolvedValueOnce({ ok: true, text: async () => '<retval>1</retval>' });

        const result = await max.upload('test.mp3', 'audio');

        expect(result).toEqual({ url: uploadTarget.url, token: 'audio-token' });
    });

    it('достаёт токен изображения из формата photos.<id>.token', async () => {
        const uploadTarget = { url: 'https://upload.max.test/image' };
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({ ok: true, json: async () => uploadTarget })
            .mockResolvedValueOnce({
                ok: true,
                text: async () => JSON.stringify({ photos: { abc: { token: 'photo-token' } } }),
            });

        const result = await max.upload('test.jpg', 'image');

        expect(result?.token).toBe('photo-token');
    });

    it('без токена в ответе загрузки возвращает null, а не одноразовый upload-URL', async () => {
        const uploadTarget = { url: 'https://upload.max.test/image' };
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({ ok: true, json: async () => uploadTarget })
            .mockResolvedValueOnce({ ok: true, text: async () => '{}' });

        expect(await max.upload('test.jpg', 'image')).toBeNull();
    });

    // === Отправка сообщения ===
    it('should send text message', async () => {
        const mockResponse = { message_id: 999 };
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
        });

        const result = await max.messagesSend(12345, 'Hello from MAX!');

        expect(result).toEqual(mockResponse);
        const body = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
        expect(body).toContain('"text":"Hello from MAX!"');
        expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
            'https://platform-api2.max.ru/messages?user_id=12345',
        );
    });

    it('should queue messages to the same dialog at the documented rate', async () => {
        jest.useFakeTimers();
        try {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ message_id: 999 }),
            });

            const first = max.messagesSend(909_001, 'Первое');
            const second = max.messagesSend(909_001, 'Второе');
            await first;

            expect(global.fetch).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(500);
            await second;
            expect(global.fetch).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    describe('attachment.not.ready', () => {
        const notReady = {
            ok: false,
            status: 400,
            text: async (): Promise<string> =>
                '{"code":"attachment.not.ready","message":"Key: errors.process.attachment.file.not.processed"}',
        };
        const sent = {
            ok: true,
            json: async (): Promise<Record<string, unknown>> => ({
                message: { body: { mid: 'm1' } },
            }),
        };
        const attachments = { attachments: [{ type: 'image' as const, payload: { token: 't' } }] };

        it('повторяет отправку с вложением, пока MAX обрабатывает файл', async () => {
            // Регресс: сообщение с только что загруженным вложением MAX отклонял
            // ошибкой attachment.not.ready, и терялся весь ответ, включая текст.
            jest.useFakeTimers();
            try {
                (global.fetch as jest.Mock)
                    .mockResolvedValueOnce(notReady)
                    .mockResolvedValueOnce(notReady)
                    .mockResolvedValueOnce(sent);
                const promise = max.messagesSend(909_101, 'С картинкой', attachments);
                await jest.advanceTimersByTimeAsync(500);
                await jest.advanceTimersByTimeAsync(1000);
                const result = await promise;
                expect(result).toEqual({ message: { body: { mid: 'm1' } } });
                expect(global.fetch).toHaveBeenCalledTimes(3);
                const lastCall = (global.fetch as jest.Mock).mock.calls[2];
                expect(lastCall[0]).toBe('https://platform-api2.max.ru/messages?user_id=909101');
                expect(JSON.parse(lastCall[1].body).attachments).toHaveLength(1);
                expect(appContext.logError).not.toHaveBeenCalled();
            } finally {
                jest.useRealTimers();
            }
        });

        it('после 3 повторов сдаётся и логирует ошибку', async () => {
            jest.useFakeTimers();
            try {
                (global.fetch as jest.Mock).mockResolvedValue(notReady);
                const promise = max.messagesSend(909_102, 'С картинкой', attachments);
                await jest.advanceTimersByTimeAsync(3500);
                expect(await promise).toBeNull();
                expect(global.fetch).toHaveBeenCalledTimes(4);
                expect(appContext.logError).toHaveBeenCalledTimes(1);
            } finally {
                (global.fetch as jest.Mock).mockReset();
                jest.useRealTimers();
            }
        });

        it('без вложений ошибку не повторяет', async () => {
            (global.fetch as jest.Mock).mockResolvedValueOnce(notReady);
            expect(await max.messagesSend(909_103, 'Только текст')).toBeNull();
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });
    });

    it('should send message with attachments', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ message_id: 1000 }),
        });

        await max.messagesSend(12345, 'With attachment', {
            attachments: [{ type: 'image', payload: { token: 'file_123' } }],
        });

        const body = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
        expect(body).toContain('"attachments":[{"type":"image","payload":{"token":"file_123"}}]');
    });

    it('should omit empty text when an attachment is present', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ message_id: 1000 }),
        });

        await max.messagesSend(12345, '', {
            attachments: [{ type: 'image', payload: { token: 'file_123' } }],
        });

        expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string)).toEqual({
            attachments: [{ type: 'image', payload: { token: 'file_123' } }],
        });
    });

    it('should reject a message without developer-provided content', async () => {
        await expect(max.messagesSend(12345, '')).resolves.toBeNull();

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should enforce the MAX 4000 character text limit for direct requests', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ message_id: 1000 }),
        });

        await max.messagesSend(12345, 'x'.repeat(4001));

        const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string) as {
            text: string;
        };
        expect(body.text).toHaveLength(4000);
    });

    it('should reserve one of twelve MAX attachment slots for the keyboard', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ message_id: 1000 }),
        });

        await max.messagesSend(12345, 'With attachments', {
            attachments: Array.from({ length: 12 }, (_, index) => ({
                type: 'image' as const,
                payload: { token: `file_${index}` },
            })),
            keyboard: {
                buttons: [[{ type: 'callback', text: 'OK', payload: 'ok' }]],
            },
        });

        const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string) as {
            attachments: unknown[];
        };
        expect(body.attachments).toHaveLength(12);
        expect(body.attachments.at(-1)).toEqual(
            expect.objectContaining({ type: 'inline_keyboard' }),
        );
    });

    it('should send message with inline keyboard', async () => {
        const keyboard: IMaxButtonObject = {
            buttons: [{ type: 'callback', text: 'OK', payload: 'ok' }],
        };

        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ message_id: 1001 }),
        });

        await max.messagesSend(12345, 'With keyboard', {
            keyboard,
        });

        const body = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
        expect(body).toContain('"type":"inline_keyboard"');
        expect(body).toContain('"payload":{"buttons"');
    });

    it('should acknowledge callback without inventing a replacement message', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true }),
        });

        await expect(max.answerCallback('callback-id', '')).resolves.toEqual({ success: true });

        expect(global.fetch).toHaveBeenCalledWith(
            'https://platform-api2.max.ru/answers?callback_id=callback-id',
            expect.objectContaining({ body: '{}' }),
        );
    });

    it('should queue callback answers to the same dialog at the documented rate', async () => {
        jest.useFakeTimers();
        try {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ success: true }),
            });

            const first = max.answerCallback('callback-1', '', null, 909_002);
            const second = max.answerCallback('callback-2', '', null, 909_002);
            await first;

            expect(global.fetch).toHaveBeenCalledTimes(1);
            await jest.advanceTimersByTimeAsync(500);
            await second;
            expect(global.fetch).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    // === Подписка (webhook) ===
    it('should set subscription webhook', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: 'ok' }),
        });

        const result = await max.subscriptions('https://mybot.com/webhook');

        expect(result).toEqual({ status: 'ok' });
        const body = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
        expect(body).toContain('"url":"https://mybot.com/webhook"');
    });

    it('should pass webhook secret and update types to MAX subscription', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ status: 'ok' }),
        });

        await max.subscriptions('https://mybot.com/webhook', {
            secret: 'webhook-secret',
            update_types: ['message_created'],
        });

        const body = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
        expect(JSON.parse(body)).toEqual({
            url: 'https://mybot.com/webhook',
            secret: 'webhook-secret',
            update_types: ['message_created'],
        });
    });

    it('should reject an insecure webhook URL and malformed subscription secret', async () => {
        await expect(max.subscriptions('http://mybot.com/webhook')).resolves.toBeNull();
        await expect(max.subscriptions('https://mybot.com:8443/webhook')).resolves.toBeNull();
        await expect(
            max.subscriptions('https://mybot.com/webhook', { secret: 'bad secret' }),
        ).resolves.toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    // === Обработка ошибок ===
    it('should return null on network error', async () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

        const result = await max.messagesSend(12345, 'Hi');
        expect(result).toBeNull();
        expect(appContext.logError).toHaveBeenCalledWith(
            expect.stringContaining('Network error'),
            expect.objectContaining({}),
        );
    });

    it('should return null if no token', async () => {
        appContext.appConfig.tokens.max_app = { token: undefined };
        const localMax = new MaxRequest(appContext);
        const result = await localMax.messagesSend(12345, 'Hi');
        expect(result).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
