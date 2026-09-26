/**
 * Сессия userData в памяти процесса: `isLocalStorage: true` + платформа без
 * локального хранилища + DB-адаптер не подключён (аналог MemorySessionStorage grammY).
 */
global.fetch = jest.fn();

import { Bot, BotController, MemorySessionStorage } from '../../src';
import { TelegramAdapter } from '../../src/plugins';

class EchoController extends BotController {
    action(): void {
        return;
    }
}

function tgUpdate(text: string, id: number, userId = 42): object {
    return {
        update_id: id,
        message: {
            message_id: id,
            from: { id: userId, is_bot: false, first_name: 'U', username: 'u' },
            chat: { id: userId, first_name: 'U', username: 'u', type: 'private' },
            date: 1700000000,
            text,
        },
    };
}

/** Текст, отправленный последним вызовом sendMessage Telegram. */
function lastTelegramText(): string | undefined {
    const calls = (global.fetch as jest.Mock).mock.calls.filter((c) =>
        String(c[0]).includes('/sendMessage'),
    );
    const body = calls[calls.length - 1]?.[1]?.body as string | undefined;
    return body ? (JSON.parse(body) as { text?: string }).text : undefined;
}

describe('MemorySessionStorage', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('хранит и возвращает данные по ключу', () => {
        const storage = new MemorySessionStorage<{ step?: string }>();
        storage.set('telegram:1', { step: 'ask_name' });
        expect(storage.get('telegram:1')).toEqual({ step: 'ask_name' });
        expect(storage.get('telegram:2')).toBeUndefined();
        expect(storage.maxSize).toBe(10_000);
        expect(storage.ttl).toBe(24 * 60 * 60 * 1000);
    });

    it('при превышении maxSize вытесняет запись, дольше всех не обновлявшуюся', () => {
        const storage = new MemorySessionStorage<number>({ maxSize: 2 });
        storage.set('a', 1);
        storage.set('b', 2);
        // Повторная запись переносит «a» в конец очереди — вытесняться должна «b».
        storage.set('a', 3);
        storage.set('c', 4);
        expect(storage.size).toBe(2);
        expect(storage.get('b')).toBeUndefined();
        expect(storage.get('a')).toBe(3);
        expect(storage.get('c')).toBe(4);
    });

    it('запись истекает через ttl с момента последнего обновления', () => {
        let now = 1_000_000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        const storage = new MemorySessionStorage<number>({ ttl: 1000 });
        storage.set('a', 1);
        now += 900;
        storage.set('a', 2); // продлевает жизнь
        now += 900;
        expect(storage.get('a')).toBe(2);
        now += 200;
        expect(storage.get('a')).toBeUndefined();
        expect(storage.size).toBe(0);
    });

    it('устаревшие записи удаляются при записи других ключей (без таймеров)', () => {
        let now = 0;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        const storage = new MemorySessionStorage<number>({ ttl: 100 });
        storage.set('a', 1);
        storage.set('b', 2);
        now = 150;
        storage.set('c', 3);
        expect(storage.size).toBe(1);
    });

    it('вытеснение идёт по давности обновления и после удалений из середины', () => {
        const storage = new MemorySessionStorage<number>({ maxSize: 3 });
        storage.set('a', 1);
        storage.set('b', 2);
        storage.set('c', 3);
        expect(storage.delete('b')).toBe(true);
        expect(storage.delete('b')).toBe(false);
        storage.set('a', 10); // «a» становится самой свежей, самая давняя — «c»
        storage.set('d', 4);
        storage.set('e', 5);
        expect(storage.get('c')).toBeUndefined();
        expect(storage.get('a')).toBe(10);
        expect(storage.get('d')).toBe(4);
        expect(storage.get('e')).toBe(5);
        storage.clear();
        expect(storage.size).toBe(0);
        storage.set('f', 6);
        expect(storage.get('f')).toBe(6);
    });

    it('обновление пользователя не требует обхода остальных записей (10 000 пользователей)', () => {
        const storage = new MemorySessionStorage<number>({ maxSize: 10_000 });
        for (let i = 0; i < 10_000; i++) {
            storage.set(`u${i}`, i);
        }
        const started = performance.now();
        for (let i = 0; i < 50_000; i++) {
            storage.set(`u${(i * 7919) % 10_000}`, i);
        }
        // Раньше каждый set обходил «дыры» хэш-таблицы (~9 мкс на запись при 10 000
        // пользователей, ~450 мс на цикл). Порог с большим запасом на медленные CI.
        expect(performance.now() - started).toBeLessThan(200);
        expect(storage.size).toBe(10_000);
    });

    it('ttl: 0 — без ограничения по времени', () => {
        let now = 0;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        const storage = new MemorySessionStorage<number>({ ttl: 0 });
        storage.set('a', 1);
        now = Number.MAX_SAFE_INTEGER;
        expect(storage.get('a')).toBe(1);
    });
});

describe('Bot: сессия в памяти на чат-платформе без БД', () => {
    let bot: Bot;
    let warns: string[];

    function createBot(config: Parameters<Bot['setAppConfig']>[0]): Bot {
        const instance = new Bot('telegram');
        instance.setLogger({
            error: (): void => {},
            log: (): void => {},
            warn: (message: string): void => {
                warns.push(String(message));
            },
        });
        instance.initBotController(EchoController);
        instance.use(new TelegramAdapter('tg-token'));
        instance.setAppConfig(config);
        instance.addCommand('start', ['начать'], (_t, ctx) => {
            ctx.text = 'Как тебя зовут?';
            ctx.thisIntentName = 'ask_name';
        });
        instance.addStep('ask_name', (ctx) => {
            ctx.text = `Приятно познакомиться, ${ctx.originalUserCommand}!`;
        });
        instance.addCommand('*', [], (_t, ctx) => {
            ctx.text = 'fallback';
        });
        return instance;
    }

    beforeEach(() => {
        warns = [];
        (global.fetch as jest.Mock).mockReset();
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, result: {} }),
        });
    });

    afterEach(async () => {
        await bot.close();
    });

    it('шаги диалога работают без DB-адаптера', async () => {
        bot = createBot({ isLocalStorage: true });
        await bot.run('telegram', tgUpdate('начать', 1));
        expect(lastTelegramText()).toBe('Как тебя зовут?');
        await bot.run('telegram', tgUpdate('Иван', 2));
        expect(lastTelegramText()).toBe('Приятно познакомиться, Иван!');
        await bot.run('telegram', tgUpdate('абракадабра', 3));
        expect(lastTelegramText()).toBe('fallback');

        const storageWarns = warns.filter((m) => m.includes('в памяти процесса'));
        expect(storageWarns).toHaveLength(1);
        expect(storageWarns[0]).toContain('теряются при перезапуске');
    });

    it('данные разных пользователей не пересекаются', async () => {
        bot = createBot({ isLocalStorage: true });
        await bot.run('telegram', tgUpdate('начать', 1, 1));
        await bot.run('telegram', tgUpdate('Иван', 2, 2));
        expect(lastTelegramText()).toBe('fallback');
        await bot.run('telegram', tgUpdate('Пётр', 3, 1));
        expect(lastTelegramText()).toBe('Приятно познакомиться, Пётр!');
    });

    it('userData, записанная в action, доступна в следующем запросе', async () => {
        bot = createBot({ isLocalStorage: true });
        bot.addCommand('count', ['счёт'], (_t, ctx) => {
            const count = ((ctx.userData.count as number | undefined) ?? 0) + 1;
            ctx.userData.count = count;
            ctx.text = String(count);
        });
        await bot.run('telegram', tgUpdate('счёт', 1));
        await bot.run('telegram', tgUpdate('счёт', 2));
        await bot.run('telegram', tgUpdate('счёт', 3));
        expect(lastTelegramText()).toBe('3');
    });

    it('memorySession: false — прежнее поведение: данные не сохраняются', async () => {
        bot = createBot({ isLocalStorage: true, memorySession: false });
        await bot.run('telegram', tgUpdate('начать', 1));
        await bot.run('telegram', tgUpdate('Иван', 2));
        expect(lastTelegramText()).toBe('fallback');
        expect(warns.some((m) => m.includes('memorySession: false'))).toBe(true);
    });

    it('без isLocalStorage сессия в памяти не включается', async () => {
        bot = createBot({ isLocalStorage: false });
        await bot.run('telegram', tgUpdate('начать', 1));
        await bot.run('telegram', tgUpdate('Иван', 2));
        expect(lastTelegramText()).toBe('fallback');
        expect(warns.some((m) => m.includes('в памяти процесса'))).toBe(false);
    });

    it('bot.close() очищает сессию', async () => {
        bot = createBot({ isLocalStorage: true });
        await bot.run('telegram', tgUpdate('начать', 1));
        await bot.close();
        bot.use(new TelegramAdapter('tg-token'));
        await bot.run('telegram', tgUpdate('Иван', 2));
        expect(lastTelegramText()).toBe('fallback');
    });
});
