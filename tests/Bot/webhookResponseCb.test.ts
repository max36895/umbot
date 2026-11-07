/**
 * Регрессионные тесты устойчивости webhookHandle к исключениям пользовательского
 * responseCb: колбэк, бросающий синхронно или возвращающий отклонённый промис,
 * не должен превращаться в unhandled rejection (падение процесса) — ответ
 * отправляется по умолчанию.
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Bot, BotController } from '../../src';
import { AlisaAdapter } from '../../src/plugins';

class SilentController extends BotController {
    action(): void {
        this.skipAutoReply = true;
    }
}

function createBot(): Bot {
    const bot = new Bot();
    bot.setLogger({ error: () => {}, warn: () => {} });
    bot.use(new AlisaAdapter());
    bot.setAppConfig({ isLocalStorage: true });
    bot.initBotController(SilentController);
    return bot;
}

function alisaUpdate(userId = 'user-1'): string {
    return JSON.stringify({
        meta: { client_id: 'c', locale: 'ru-RU' },
        request: { type: 'SimpleUtterance', command: 'привет', original_utterance: 'привет' },
        session: {
            message_id: 1,
            session_id: 's',
            skill_id: 'sk',
            user_id: userId,
            new: true,
        },
        version: '1.0',
    });
}

function createMockReq(body: string): IncomingMessage {
    const req = new EventEmitter() as unknown as IncomingMessage;
    Object.assign(req, {
        method: 'POST',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
    });
    process.nextTick(() => {
        req.emit('data', Buffer.from(body));
        req.emit('end');
    });
    return req;
}

function createMockRes(): ServerResponse & { ends: number[]; writableEnded: boolean } {
    const res = {
        statusCode: 0,
        headersSent: false,
        writableEnded: false,
        setHeader: (): void => {},
        ends: [],
        end(this: { ends: number[]; writableEnded: boolean }, body?: unknown): void {
            this.headersSent = true;
            this.writableEnded = true;
            this.ends.push(typeof body === 'string' ? body.length : -1);
        },
    } as unknown as ServerResponse & { ends: number[]; writableEnded: boolean };
    return res;
}

describe('webhookHandle: исключения пользовательского responseCb', () => {
    it('синхронный бросок колбэка на успешном запросе → ответ по умолчанию, промис резолвится', async () => {
        const bot = createBot();
        const res = createMockRes();
        await expect(
            bot.webhookHandle(createMockReq(alisaUpdate()), res, (): void => {
                throw new Error('user cb bug');
            }),
        ).resolves.toBeUndefined();
        expect(res.statusCode).toBe(200);
        expect(res.ends).toHaveLength(1);
    });

    it('отклонённый промис async-колбэка не даёт unhandled rejection', async () => {
        const bot = createBot();
        const res = createMockRes();
        const rejections: unknown[] = [];
        const onRejection = (reason: unknown): void => {
            rejections.push(reason);
        };
        process.on('unhandledRejection', onRejection);
        try {
            await bot.webhookHandle(createMockReq(alisaUpdate()), res, async (): Promise<void> => {
                throw new Error('async cb bug');
            });
            // Отклонение промиса колбэка всплывает на следующем макротике
            await new Promise((resolve) => setImmediate(resolve));
            await new Promise((resolve) => setImmediate(resolve));
            expect(rejections).toHaveLength(0);
        } finally {
            process.off('unhandledRejection', onRejection);
        }
    });

    it('async-колбэк, отказавший до отправки, не оставляет платформу без ответа', async () => {
        const bot = createBot();
        const res = createMockRes();
        await expect(
            bot.webhookHandle(createMockReq(alisaUpdate()), res, async (): Promise<void> => {
                throw new Error('async cb bug before send');
            }),
        ).resolves.toBeUndefined();
        // Дать .catch колбэка отработать: ответ должен отправить fallback
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        expect(res.statusCode).toBe(200);
        expect(res.ends).toHaveLength(1);
    });

    it('бросок колбэка на error-ветке (битый JSON, 400) → 400 по умолчанию, промис резолвится', async () => {
        const bot = createBot();
        const res = createMockRes();
        await expect(
            bot.webhookHandle(createMockReq('это не json {{{'), res, (): void => {
                throw new Error('cb bug on 400');
            }),
        ).resolves.toBeUndefined();
        expect(res.statusCode).toBe(400);
        expect(res.ends).toHaveLength(1);
    });

    it('циклический объект вместо Error в колбэке на error-ветке → ответ отправлен, промис резолвится', async () => {
        const bot = createBot();
        const res = createMockRes();
        const circular: Record<string, unknown> = { self: null };
        circular.self = circular;
        await expect(
            bot.webhookHandle(createMockReq('это не json {{{'), res, (): void => {
                throw circular;
            }),
        ).resolves.toBeUndefined();
        expect(res.statusCode).toBe(400);
        expect(res.ends).toHaveLength(1);
    });
});
