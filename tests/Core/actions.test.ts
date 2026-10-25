/**
 * Действия кнопок: bot.addAction и bot.defineAction.
 *
 * Действие срабатывает на нажатие кнопки с его именем в payload и на текст, равный имени,
 * но не на подстроку в обычном сообщении. defineAction отдаёт обработчику разобранные данные.
 */
import { Bot, BaseBotController, Buttons } from '../../src';
import { AlisaAdapter, T_ALISA, T_TELEGRAM, TelegramAdapter } from '../../src/plugins';

function makeBot(): Bot {
    const bot = new Bot();
    bot.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
    bot.initBotController(BaseBotController);
    bot.use(new AlisaAdapter());
    bot.addCommand('*', [], (_t, ctx) => {
        ctx.text = 'fallback';
    });
    return bot;
}

const alisaRequest = (request: Record<string, unknown>): string =>
    JSON.stringify({
        meta: { locale: 'ru-RU', timezone: 'UTC', client_id: 'test', interfaces: {} },
        session: { message_id: 1, session_id: 's', skill_id: 'k', user_id: 'u1', new: false },
        request,
        version: '1.0',
    });

const say = (text: string): string =>
    alisaRequest({ command: text, original_utterance: text, type: 'SimpleUtterance' });

const press = (payload: unknown): string =>
    alisaRequest({ type: 'ButtonPressed', payload, nlu: { tokens: [] } });

async function answer(bot: Bot, request: string): Promise<string> {
    const res = (await bot.run(T_ALISA, request)) as { response?: { text?: string } };
    return res.response?.text ?? '';
}

describe('bot.addAction', () => {
    it('срабатывает на нажатие кнопки и на текст, равный имени', async () => {
        const bot = makeBot();
        bot.addAction('buy', (_t, ctx) => {
            ctx.text = 'ACTION buy';
        });
        expect(await answer(bot, press('buy'))).toBe('ACTION buy');
        expect(await answer(bot, press({ action: 'buy', id: 42 }))).toBe('ACTION buy');
        expect(await answer(bot, say('buy'))).toBe('ACTION buy');
        await bot.close();
    });

    it('не срабатывает на подстроку в обычном сообщении', async () => {
        const bot = makeBot();
        bot.addAction('buy', (_t, ctx) => {
            ctx.text = 'ACTION buy';
        });
        for (const text of ['хочу buyer', 'не buy пожалуйста', 'buy-buy']) {
            expect(await answer(bot, say(text))).toBe('fallback');
        }
        await bot.close();
    });

    it('имя в разном регистре совпадает с нормализованным payload', async () => {
        const bot = makeBot();
        bot.addAction('openRoom', (_t, ctx) => {
            ctx.text = 'opened';
        });
        expect(await answer(bot, press({ action: 'openRoom' }))).toBe('opened');
        await bot.close();
    });

    it('обычные команды по-прежнему ищутся подстрокой, порядок регистрации сохраняется', async () => {
        const bot = makeBot();
        bot.addCommand('weather', ['погода'], (_t, ctx) => {
            ctx.text = 'weather';
        });
        bot.addAction('погода', (_t, ctx) => {
            ctx.text = 'action';
        });
        expect(await answer(bot, say('какая погода сегодня'))).toBe('weather');
        // Точное совпадение: побеждает команда, зарегистрированная раньше.
        expect(await answer(bot, say('погода'))).toBe('weather');
        await bot.close();
    });

    it('работает при большом числе команд (индекс подстрок)', async () => {
        const bot = makeBot();
        for (let i = 0; i < 40; i++) {
            bot.addCommand(`cmd${i}`, [`слово${i}`], (_t, ctx) => {
                ctx.text = `cmd${i}`;
            });
        }
        bot.addAction('buy', (_t, ctx) => {
            ctx.text = 'ACTION buy';
        });
        expect(await answer(bot, say('хочу buyer'))).toBe('fallback');
        expect(await answer(bot, press('buy'))).toBe('ACTION buy');
        expect(await answer(bot, say('и слово7 тоже'))).toBe('cmd7');
        await bot.close();
    });
});

describe('bot.defineAction', () => {
    it('кнопка несёт данные, обработчик получает их разобранными', async () => {
        const bot = makeBot();
        const kick = bot.defineAction<{ p: string }>('kick');
        let received: unknown = null;
        kick.handle((data, ctx) => {
            received = data;
            ctx.text = `kick ${data.p}`;
        });
        const buttons = new Buttons(bot.getAppContext());
        kick.addBtn(buttons, 'Исключить', { p: 'u7' });
        const payload = buttons.buttons[0]?.payload;
        expect(payload).toEqual({ action: 'kick', p: 'u7' });

        expect(await answer(bot, press(payload))).toBe('kick u7');
        expect(received).toEqual({ p: 'u7' });
        await bot.close();
    });

    it('текст, равный имени, — обработчик получает пустые данные', async () => {
        const bot = makeBot();
        const help = bot.defineAction('help_me');
        let received: unknown = null;
        help.handle((data) => {
            received = data;
            return 'help';
        });
        expect(await answer(bot, say('help_me'))).toBe('help');
        expect(received).toEqual({});
        await bot.close();
    });

    it('payload длиннее 64 байт при подключённом Telegram — предупреждение', () => {
        const bot = new Bot();
        const warns: string[] = [];
        bot.setLogger({ log: () => {}, error: () => {}, warn: (m) => warns.push(String(m)) });
        bot.use(new TelegramAdapter('1:t'));
        expect(bot.getAppContext().platforms[T_TELEGRAM]).toBeDefined();
        const act = bot.defineAction<{ text: string }>('long');
        act.addBtn(new Buttons(bot.getAppContext()), 'Кнопка', { text: 'x'.repeat(80) });
        expect(warns.some((w) => w.includes('64'))).toBe(true);
        warns.length = 0;
        act.addBtn(new Buttons(bot.getAppContext()), 'Кнопка', { text: 'короткий' });
        expect(warns).toEqual([]);
    });

    it('ключи action/command в данных зарезервированы: кнопка ведёт на своё действие', async () => {
        const bot = new Bot();
        const warns: string[] = [];
        bot.setLogger({ log: () => {}, error: () => {}, warn: (m) => warns.push(String(m)) });
        bot.use(new AlisaAdapter());
        let menuRan = false;
        bot.addCommand('menu', ['menu'], () => {
            menuRan = true;
        });
        const vote = bot.defineAction<{ command: string; action: string; n: number }>('vote');
        let received: unknown = null;
        vote.handle((data) => {
            received = data;
            return 'voted';
        });

        // Зарезервированные ключи не переопределяют маршрут нажатия
        expect(vote.payload({ command: 'menu', action: 'other', n: 3 })).toEqual({
            action: 'vote',
            n: 3,
        });
        expect(await answer(bot, press(vote.payload({ command: 'menu', n: 3 })))).toBe('voted');
        expect(received).toEqual({ n: 3 });
        expect(menuRan).toBe(false);
        expect(warns.some((w) => w.includes('"command"') && w.includes('vote'))).toBe(true);
        expect(warns.some((w) => w.includes('"action"') && w.includes('vote'))).toBe(true);

        // Предупреждение — один раз на ключ действия, а не на каждую кнопку
        warns.length = 0;
        vote.payload({ command: 'menu', action: 'other', n: 4 });
        expect(warns).toEqual([]);
        await bot.close();
    });
});
