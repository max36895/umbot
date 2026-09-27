import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppContext, Bot, BotController } from '../../src';
import {
    AlisaAdapter,
    BasePlatformAdapter,
    MarusiaAdapter,
    MaxAdapter,
    SmartAppAdapter,
    TelegramAdapter,
    ViberAdapter,
    VkAdapter,
} from '../../src/plugins';
import { createTestDir, removeTestDir } from '../helpers/tmpDir';

// Сам объект модуля, а не namespace-импорт: у namespace свойства не переопределить через jest.spyOn
const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises');

/** Счётчик вызовов action() и последнее увиденное значение userData.counter. */
const seen = { calls: 0, lastCounter: 0 };

/**
 * Инкремент с асинхронной паузой между чтением и записью userData — ровно та
 * последовательность, на которой параллельные запросы теряли изменения.
 */
class CounterController extends BotController {
    async action(): Promise<void> {
        seen.calls++;
        const current = (this.userData.counter as number | undefined) ?? 0;
        await new Promise((resolve) => setTimeout(resolve, 20));
        this.userData.counter = current + 1;
        seen.lastCounter = current + 1;
        this.skipAutoReply = true;
    }
}

function tgUpdate(updateId: number, userId = 42, text = 'inc'): string {
    return JSON.stringify({
        update_id: updateId,
        message: {
            message_id: updateId,
            from: { id: userId },
            chat: { id: userId, type: 'private' },
            date: 1,
            text,
        },
    });
}

function createBot(options?: Record<string, unknown>): Bot {
    const bot = new Bot();
    bot.setLogger({ error: () => {}, warn: () => {} });
    bot.use(new TelegramAdapter('test-token', options));
    // Сессия userData в памяти процесса: у Telegram нет локального хранилища
    bot.setAppConfig({ isLocalStorage: true });
    bot.initBotController(CounterController);
    return bot;
}

beforeEach(() => {
    seen.calls = 0;
    seen.lastCounter = 0;
});

describe('Очередь запросов одного пользователя', () => {
    it('параллельные апдейты одного пользователя не теряют изменения userData', async () => {
        const bot = createBot();
        await bot.webhookEvent(tgUpdate(1), {});
        await Promise.all([2, 3, 4, 5, 6].map((id) => bot.webhookEvent(tgUpdate(id), {})));
        await bot.webhookEvent(tgUpdate(7), {});

        expect(seen.calls).toBe(7);
        expect(seen.lastCounter).toBe(7);
    });

    it('запросы разных пользователей не ждут друг друга', async () => {
        const bot = createBot();
        const started: number[] = [];
        class SlowController extends BotController {
            async action(): Promise<void> {
                started.push(Date.now());
                await new Promise((resolve) => setTimeout(resolve, 200));
                this.skipAutoReply = true;
            }
        }
        bot.initBotController(SlowController);

        await Promise.all([
            bot.webhookEvent(tgUpdate(1, 1), {}),
            bot.webhookEvent(tgUpdate(2, 2), {}),
        ]);

        expect(started).toHaveLength(2);
        // Второй пользователь стартовал, не дожидаясь 200 мс первого
        expect(Math.abs((started[1] ?? 0) - (started[0] ?? 0))).toBeLessThan(150);
    });

    it('при сроке ответа платформы запрос не ждёт зависший предыдущий дольше половины срока', async () => {
        class ShortDeadlineAdapter extends TelegramAdapter {
            getResponseTimeout(): number {
                return 100;
            }
        }
        const bot = new Bot();
        bot.setLogger({ error: () => {}, warn: () => {} });
        bot.use(new ShortDeadlineAdapter('test-token'));
        bot.setAppConfig({ isLocalStorage: true });
        const started: number[] = [];
        class SlowController extends BotController {
            async action(): Promise<void> {
                started.push(Date.now());
                await new Promise((resolve) => setTimeout(resolve, 500));
                this.skipAutoReply = true;
            }
        }
        bot.initBotController(SlowController);

        await Promise.all([bot.webhookEvent(tgUpdate(1), {}), bot.webhookEvent(tgUpdate(2), {})]);

        expect(started).toHaveLength(2);
        // Без срока второй запрос стартовал бы через 500 мс, после первого
        expect((started[1] ?? 0) - (started[0] ?? 0)).toBeLessThan(300);
    });

    it('срок ответа есть только у голосовых платформ', () => {
        expect(new AlisaAdapter().getResponseTimeout()).toBe(2900);
        expect(new SmartAppAdapter().getResponseTimeout()).toBe(2900);
        expect(new MarusiaAdapter().getResponseTimeout()).toBe(2900);
        expect(new TelegramAdapter().getResponseTimeout()).toBeNull();
    });

    it('ошибка запроса не блокирует следующий запрос того же пользователя', async () => {
        const bot = createBot();
        const spy = jest
            .spyOn(TelegramAdapter.prototype, 'getContent')
            .mockRejectedValueOnce(new Error('сбой отправки'));
        const failed = await bot.webhookEvent(tgUpdate(1), {});
        const ok = await bot.webhookEvent(tgUpdate(2), {});
        spy.mockRestore();

        expect(failed.statusCode).toBe(500);
        expect(ok.statusCode).toBe(200);
    });
});

describe('Очередь пользователя при большом числе пользователей', () => {
    it('после чистки свободных записей очередь по-прежнему упорядочивает запросы пользователя', async () => {
        const bot = createBot();
        let active = 0;
        let maxActive = 0;
        class TrackController extends BotController {
            async action(): Promise<void> {
                active++;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => setImmediate(resolve));
                active--;
                this.skipAutoReply = true;
            }
        }
        bot.initBotController(TrackController);
        // Больше порога чистки (1024 записи) — срабатывает пакетное удаление свободных записей.
        for (let userId = 1; userId <= 1100; userId++) {
            await bot.run('telegram', tgUpdate(userId, userId));
        }
        maxActive = 0;
        await Promise.all([1, 2, 3].map((n) => bot.run('telegram', tgUpdate(5000 + n, 7))));
        expect(maxActive).toBe(1);
    });

    it('тысячи одновременных запросов разных пользователей обрабатываются за линейное время', async () => {
        const bot = createBot();
        class ImmediateController extends BotController {
            async action(): Promise<void> {
                await new Promise((resolve) => setImmediate(resolve));
                this.skipAutoReply = true;
            }
        }
        bot.initBotController(ImmediateController);
        const burst = async (count: number, offset: number): Promise<number> => {
            const started = performance.now();
            await Promise.all(
                Array.from({ length: count }, (_, i) =>
                    bot.run('telegram', tgUpdate(offset + i, offset + i)),
                ),
            );
            return performance.now() - started;
        };
        await burst(500, 100_000); // прогрев JIT
        const small = await burst(2000, 200_000);
        const large = await burst(8000, 300_000);
        // Линейный рост — ~4× при 4× запросов. Чистка очереди на каждого нового
        // пользователя давала O(n²) — ~16×. Порог с запасом на шум CI.
        expect(large / small).toBeLessThan(9);
    });

    it('синхронная ошибка разбора запроса приходит отклонённым промисом', async () => {
        const bot = createBot();
        const result = bot.run('telegram', '{не json');
        expect(result).toBeInstanceOf(Promise);
        await expect(result).rejects.toThrow();
    });
});

describe('Дедупликация повторных доставок', () => {
    it('повтор той же доставки подтверждается 200 ok без повторной обработки', async () => {
        const bot = createBot();
        const first = await bot.webhookEvent(tgUpdate(10), {});
        const retry = await bot.webhookEvent(tgUpdate(10), {});

        expect(first.statusCode).toBe(200);
        expect(retry).toEqual({ statusCode: 200, body: 'ok' });
        expect(seen.calls).toBe(1);
    });

    it('запрос с тем же update_id, но другим телом обрабатывается: угаданный ID не блокирует апдейт', async () => {
        const bot = createBot();
        await bot.webhookEvent(tgUpdate(10, 42, 'поддельный'), {});
        await bot.webhookEvent(tgUpdate(10, 42, 'настоящий'), {});

        expect(seen.calls).toBe(2);
    });

    it('после сбоя сервера (500) повтор доставки обрабатывается заново', async () => {
        const bot = createBot();
        const spy = jest
            .spyOn(TelegramAdapter.prototype, 'getContent')
            .mockRejectedValueOnce(new Error('сбой отправки'));
        const failed = await bot.webhookEvent(tgUpdate(20), {});
        spy.mockRestore();
        const retry = await bot.webhookEvent(tgUpdate(20), {});

        expect(failed.statusCode).toBe(500);
        expect(retry.statusCode).toBe(200);
        expect(seen.calls).toBe(2);
    });

    it('повтор, пришедший во время обработки, ждёт исходный запрос и подтверждается после его успеха', async () => {
        const bot = createBot();
        const [first, retry] = await Promise.all([
            bot.webhookEvent(tgUpdate(50), {}),
            bot.webhookEvent(tgUpdate(50), {}).then((result) => ({
                result,
                // Значение на момент ответа повтору: исходный запрос уже завершил action()
                counterAtReply: seen.lastCounter,
            })),
        ]);

        expect(first.statusCode).toBe(200);
        expect(retry.result).toEqual({ statusCode: 200, body: 'ok' });
        expect(retry.counterAtReply).toBe(1);
        expect(seen.calls).toBe(1);
    });

    it('если исходный запрос упал с 500, ждавший его повтор обрабатывается заново', async () => {
        const bot = createBot();
        const spy = jest
            .spyOn(TelegramAdapter.prototype, 'getContent')
            .mockRejectedValueOnce(new Error('сбой отправки'));
        const [first, retry] = await Promise.all([
            bot.webhookEvent(tgUpdate(60), {}),
            bot.webhookEvent(tgUpdate(60), {}),
        ]);
        spy.mockRestore();

        expect(first.statusCode).toBe(500);
        expect(retry.statusCode).toBe(200);
        expect(seen.calls).toBe(2);
    });

    it('в режиме telegram_webhook_reply дедупликация выключена: ответ несёт тело', async () => {
        const bot = createBot({ telegram_webhook_reply: true });
        await bot.webhookEvent(tgUpdate(30), {});
        await bot.webhookEvent(tgUpdate(30), {});

        expect(seen.calls).toBe(2);
    });

    it('с проверенной подписью ключ — ID доставки: тело не хэшируется, повтор с тем же update_id подтверждается', async () => {
        const bot = createBot();
        bot.getAppContext().appConfig.tokens.telegram!.webhookSecret = 'secret';
        const headers = { 'x-telegram-bot-api-secret-token': 'secret' };
        await bot.webhookEvent(tgUpdate(70, 42, 'первое'), headers);
        const retry = await bot.webhookEvent(tgUpdate(70, 42, 'изменённое'), headers);

        expect(retry).toEqual({ statusCode: 200, body: 'ok' });
        expect(seen.calls).toBe(1);
    });

    it('кэш доставок ограничен: старейшая доставка вытесняется, её повтор обрабатывается заново', async () => {
        let calls = 0;
        class FastController extends BotController {
            action(): void {
                calls++;
                this.skipAutoReply = true;
            }
        }
        const bot = createBot();
        bot.initBotController(FastController);
        // Размер кэша — 10 000 доставок (DELIVERY_CACHE_SIZE в Bot.ts).
        for (let id = 1; id <= 10_001; id++) {
            await bot.webhookEvent(tgUpdate(id, 42, 't'), {});
        }
        expect(calls).toBe(10_001);
        // Вторая доставка ещё в кэше, первая вытеснена.
        await bot.webhookEvent(tgUpdate(2, 42, 't'), {});
        expect(calls).toBe(10_001);
        await bot.webhookEvent(tgUpdate(1, 42, 't'), {});
        expect(calls).toBe(10_002);
    });

    it('bot.run() не дедуплицирует: повторы приходят только через вебхук', async () => {
        const bot = createBot();
        await bot.run('telegram', tgUpdate(40));
        await bot.run('telegram', tgUpdate(40));

        expect(seen.calls).toBe(2);
    });
});

describe('getDeliveryId адаптеров', () => {
    it('Telegram — update_id', () => {
        expect(new TelegramAdapter().getDeliveryId({ update_id: 5 })).toBe('5');
        expect(new TelegramAdapter().getDeliveryId({})).toBeNull();
    });

    it('VK — event_id, кроме confirmation', () => {
        const vk = new VkAdapter();
        expect(vk.getDeliveryId({ type: 'message_new', event_id: 'abc' })).toBe('abc');
        expect(vk.getDeliveryId({ type: 'confirmation', event_id: 'abc' })).toBeNull();
        expect(vk.getDeliveryId({ type: 'message_new' })).toBeNull();
    });

    it('MAX — тип, время и объект: создание и правка одного сообщения различаются', () => {
        const max = new MaxAdapter();
        const message = { body: { mid: 'm1', seq: 1 } } as never;
        const created = max.getDeliveryId({
            update_type: 'message_created',
            timestamp: 1,
            message,
        });
        const edited = max.getDeliveryId({ update_type: 'message_edited', timestamp: 2, message });
        expect(created).toBe('message_created:1:m1');
        expect(edited).not.toBe(created);
        expect(max.getDeliveryId({ update_type: 'bot_started' })).toBeNull();
    });

    it('Viber — событие и message_token, кроме событий с содержимым в ответе', () => {
        const viber = new ViberAdapter();
        expect(viber.getDeliveryId({ event: 'message', message_token: 7, timestamp: 1 })).toBe(
            'message:7:1',
        );
        expect(
            viber.getDeliveryId({ event: 'conversation_started', message_token: 7, timestamp: 1 }),
        ).toBeNull();
        expect(
            viber.getDeliveryId({ event: 'webhook', message_token: 7, timestamp: 1 }),
        ).toBeNull();
    });
});

describe('isSignatureSupported', () => {
    it('платформы без подписи вебхука — false, с подписью — true', () => {
        expect(new AlisaAdapter().isSignatureSupported()).toBe(false);
        expect(new SmartAppAdapter().isSignatureSupported()).toBe(false);
        expect(new TelegramAdapter().isSignatureSupported()).toBe(true);
        expect(new ViberAdapter().isSignatureSupported()).toBe(true);
        // VK: подпись в теле, signatureName нет — признак по переопределённому методу
        expect(new VkAdapter().isSignatureSupported()).toBe(true);
    });

    it('кастомный адаптер с подписью в теле распознаётся по переопределению isSignatureCheckEnabled', () => {
        class BodySecretAdapter extends AlisaAdapter {
            isSignatureCheckEnabled(): boolean {
                return false;
            }
        }
        expect(new BodySecretAdapter().isSignatureSupported()).toBe(true);
        expect(BasePlatformAdapter.prototype.isSignatureSupported).toBeDefined();
    });
});

describe('Файловые логи', () => {
    let dir: string;
    let stderrSpy: jest.SpyInstance;

    beforeEach(() => {
        dir = createTestDir('webhook-logs');
        stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(async () => {
        stderrSpy.mockRestore();
        await removeTestDir(dir);
    });

    function createContext(): AppContext {
        const ctx = new AppContext();
        ctx.setAppConfig({ error_log: dir });
        ctx.appMode = 'strict_prod';
        return ctx;
    }

    it('logWarn(..., { stderr: true }) вне dev дублирует текст в stderr, без флага — нет', () => {
        const ctx = createContext();
        ctx.logWarn('обычное предупреждение');
        expect(stderrSpy).not.toHaveBeenCalled();
        ctx.logWarn('предупреждение безопасности', undefined, { stderr: true });
        expect(stderrSpy).toHaveBeenCalledWith('[umbot] предупреждение безопасности\n');
    });

    it('в warn.log не пишется строка undefined, когда метаданных нет', async () => {
        const ctx = createContext();
        ctx.logWarn('без метаданных');
        await ctx.close();
        const content = readFileSync(join(dir, 'warn.log'), 'utf8');
        expect(content).toContain('без метаданных');
        expect(content).not.toContain('undefined');
    });

    it('лог больше 10 МБ переименовывается в .1, запись продолжается в новый файл', async () => {
        const logFile = join(dir, 'error.log');
        writeFileSync(logFile, Buffer.alloc(10 * 1024 * 1024, 'a'));
        const ctx = createContext();
        ctx.logError('новая ошибка');
        await ctx.close();

        expect(existsSync(`${logFile}.1`)).toBe(true);
        expect(statSync(`${logFile}.1`).size).toBe(10 * 1024 * 1024);
        expect(statSync(logFile).size).toBeLessThan(10_000);
        expect(readFileSync(logFile, 'utf8')).toContain('новая ошибка');
    });

    it('параллельные записи логов идут по очереди: архив .1 не затирается новым файлом', async () => {
        const logFile = join(dir, 'error.log');
        writeFileSync(logFile, Buffer.alloc(10 * 1024 * 1024, 'a'));
        // Первая запись «зависает» после stat: без очереди вторая успевает ротировать
        // файл и создать новый, а первая затем переименовала бы его поверх архива.
        const realStat = fsPromises.stat;
        let statCalls = 0;
        const statSpy = jest.spyOn(fsPromises, 'stat').mockImplementation((async (path: string) => {
            const info = await realStat(path);
            if (statCalls++ === 0) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            return info;
        }) as never);
        const ctx = createContext();
        ctx.logError('первая');
        const firstWrite = ctx.close();
        ctx.logError('вторая');
        await Promise.all([firstWrite, ctx.close()]);
        statSpy.mockRestore();

        expect(statSync(`${logFile}.1`).size).toBe(10 * 1024 * 1024);
        const content = readFileSync(logFile, 'utf8');
        expect(content).toContain('первая');
        expect(content).toContain('вторая');
    });
});
