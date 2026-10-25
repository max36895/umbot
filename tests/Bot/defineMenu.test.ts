/**
 * Меню из экранов: bot.defineMenu.
 *
 * Переход — нажатием кнопки (экран в payload) или названием кнопки текущего экрана (шаг экрана).
 * Текст, который не является кнопкой экрана, уходит обычным командам.
 */
import { Bot, BaseBotController, IMenu } from '../../src';
import { AlisaAdapter, T_ALISA, TelegramAdapter } from '../../src/plugins';

interface IAlisaAnswer {
    response?: { text?: string; buttons?: { title: string; payload?: unknown; url?: string }[] };
}

function makeBot(warn: (msg: string) => void = () => {}): Bot {
    const bot = new Bot();
    bot.setLogger({ log: () => {}, error: () => {}, warn });
    bot.initBotController(BaseBotController);
    bot.use(new AlisaAdapter());
    bot.setAppConfig({ isLocalStorage: true });
    bot.addCommand('*', [], (_t, ctx) => {
        ctx.text = 'fallback';
    });
    return bot;
}

/** Диалог с Алисой: state переносится между запросами, как у настоящей платформы */
function dialog(bot: Bot): {
    say: (text: string) => Promise<IAlisaAnswer>;
    press: (payload: unknown) => Promise<IAlisaAnswer>;
} {
    let state: unknown = {};
    let messageId = 1;
    const send = async (request: Record<string, unknown>): Promise<IAlisaAnswer> => {
        const res = (await bot.run(
            T_ALISA,
            JSON.stringify({
                meta: {
                    locale: 'ru-RU',
                    timezone: 'UTC',
                    client_id: 'test',
                    interfaces: { screen: {} },
                },
                session: {
                    message_id: messageId++,
                    session_id: 's',
                    skill_id: 'k',
                    user_id: 'u1',
                    new: false,
                },
                state: { session: state },
                request,
                version: '1.0',
            }),
        )) as IAlisaAnswer & { session_state?: unknown };
        state = res.session_state ?? state;
        return res;
    };
    return {
        say: (text) => send({ command: text, original_utterance: text, type: 'SimpleUtterance' }),
        press: (payload) => send({ type: 'ButtonPressed', payload, nlu: { tokens: [] } }),
    };
}

function defineShopMenu(bot: Bot): IMenu {
    return bot.defineMenu('shop', {
        screens: {
            home: {
                text: 'Главная',
                buttons: [
                    { title: 'Тарифы', to: 'prices' },
                    { title: 'Сайт', url: 'https://example.com' },
                ],
            },
            prices: {
                text: 'Тарифы',
                buttons: [{ title: 'Премиум', to: 'premium' }],
                parent: 'home',
            },
            premium: { text: 'Премиум — 299 ₽', parent: 'prices' },
        },
    });
}

describe('bot.defineMenu', () => {
    it('show выводит текст, кнопки-переходы, ссылки и «Назад»', async () => {
        const bot = makeBot();
        const menu = defineShopMenu(bot);
        bot.addCommand('menu', ['меню'], (_t, ctx) => menu.show(ctx, 'prices'));

        const res = await dialog(bot).say('меню');
        expect(res.response?.text).toBe('Тарифы');
        expect(res.response?.buttons?.map((b) => b.title)).toEqual(['Премиум', 'Назад']);
        expect(res.response?.buttons?.[0]?.payload).toEqual({
            action: '__menu_shop',
            s: 'premium',
        });
        expect(res.response?.buttons?.[1]?.payload).toEqual({ action: '__menu_shop', s: 'home' });
        await bot.close();
    });

    it('без имени и с неизвестным экраном показывает экран по умолчанию', async () => {
        const bot = makeBot();
        const menu = defineShopMenu(bot);
        bot.addCommand('menu', ['меню'], (_t, ctx) => menu.show(ctx));
        bot.addCommand('bad', ['плохо'], (_t, ctx) => menu.show(ctx, '__proto__'));

        const user = dialog(bot);
        const res = await user.say('меню');
        expect(res.response?.text).toBe('Главная');
        expect(res.response?.buttons?.find((b) => b.title === 'Сайт')?.url).toContain(
            'https://example.com',
        );
        expect((await user.say('плохо')).response?.text).toBe('Главная');
        await bot.close();
    });

    it('нажатие кнопки переходит на экран из payload в любой момент', async () => {
        const bot = makeBot();
        defineShopMenu(bot);
        const user = dialog(bot);
        // Меню ещё не показывалось — экран всё равно берётся из payload кнопки
        expect((await user.press({ action: '__menu_shop', s: 'premium' })).response?.text).toBe(
            'Премиум — 299 ₽',
        );
        await bot.close();
    });

    it('название кнопки текущего экрана работает текстом (кнопка с заглавной буквы)', async () => {
        const bot = makeBot();
        const menu = defineShopMenu(bot);
        bot.addCommand('menu', ['меню'], (_t, ctx) => menu.show(ctx));

        const user = dialog(bot);
        await user.say('меню');
        expect((await user.say('тарифы')).response?.text).toBe('Тарифы');
        expect((await user.say('премиум')).response?.text).toBe('Премиум — 299 ₽');
        expect((await user.say('назад')).response?.text).toBe('Тарифы');
        expect((await user.say('назад')).response?.text).toBe('Главная');
        await bot.close();
    });

    it('текст не из кнопок экрана уходит командам, и меню больше не перехватывает текст', async () => {
        const bot = makeBot();
        const menu = defineShopMenu(bot);
        bot.addCommand('menu', ['меню'], (_t, ctx) => menu.show(ctx));
        bot.addCommand('weather', ['погода'], (_t, ctx) => {
            ctx.text = 'погода';
        });

        const user = dialog(bot);
        await user.say('меню');
        // «Премиум» — кнопка другого экрана: на главной её нет
        expect((await user.say('премиум')).response?.text).toBe('fallback');
        await user.say('меню');
        expect((await user.say('погода')).response?.text).toBe('погода');
        expect((await user.say('тарифы')).response?.text).toBe('fallback');
        await bot.close();
    });

    it('кнопка с payload другого действия вызывает это действие', async () => {
        const bot = makeBot();
        const buy = bot.defineAction<{ id: number }>('buy');
        buy.handle((data) => `Покупка ${data.id}`);
        const menu = bot.defineMenu('m', {
            screens: {
                home: {
                    text: 'Магазин',
                    buttons: [{ title: 'Купить', payload: buy.payload({ id: 7 }) }],
                },
            },
        });
        bot.addCommand('menu', ['меню'], (_t, ctx) => menu.show(ctx));

        const user = dialog(bot);
        const res = await user.say('меню');
        expect(res.response?.buttons?.[0]?.payload).toEqual({ action: 'buy', id: 7 });
        expect((await user.press({ action: 'buy', id: 7 })).response?.text).toBe('Покупка 7');
        await bot.close();
    });

    it('текст-функция и onShow: async onShow дожидается, onShow может сменить шаг', async () => {
        const bot = makeBot();
        bot.addStep('after', (ctx) => {
            ctx.text = 'шаг after';
        });
        const menu = bot.defineMenu('m', {
            screens: {
                home: {
                    text: (ctx) => `Привет, ${String(ctx.userId)}`,
                    onShow: async (ctx) => {
                        await Promise.resolve();
                        ctx.text += '!';
                        ctx.thisIntentName = 'after';
                    },
                },
            },
        });
        bot.addCommand('menu', ['меню'], (_t, ctx) => menu.show(ctx));

        const user = dialog(bot);
        expect((await user.say('меню')).response?.text).toBe('Привет, u1!');
        expect((await user.say('что угодно')).response?.text).toBe('шаг after');
        await bot.close();
    });

    it('payload(screen) — кнопка перехода вне меню', async () => {
        const bot = makeBot();
        const menu = defineShopMenu(bot);
        expect(menu.name).toBe('shop');
        expect(menu.payload('prices')).toEqual({ action: '__menu_shop', s: 'prices' });
        await bot.close();
    });

    it('backText и start задают кнопку возврата и экран по умолчанию', async () => {
        const bot = makeBot();
        const menu = bot.defineMenu('m', {
            start: 'b',
            backText: 'Вернуться',
            screens: { a: { text: 'A' }, b: { text: 'B', parent: 'a' } },
        });
        bot.addCommand('menu', ['меню'], (_t, ctx) => menu.show(ctx));

        const user = dialog(bot);
        const res = await user.say('меню');
        expect(res.response?.text).toBe('B');
        expect(res.response?.buttons?.map((b) => b.title)).toEqual(['Вернуться']);
        expect((await user.say('вернуться')).response?.text).toBe('A');
        await bot.close();
    });

    it('предупреждает о несуществующих экранах, неверном start и длинном payload', async () => {
        const warn = jest.fn();
        const bot = makeBot(warn);
        bot.defineMenu('m', {
            start: 'nope',
            screens: {
                home: { text: 'H', buttons: [{ title: 'X', to: 'missing' }] },
                ['x'.repeat(60)]: { text: 'long', parent: 'home' },
                other: { text: 'O', buttons: [{ title: 'L', to: 'x'.repeat(60) }] },
            },
        });
        const messages = warn.mock.calls.map((call) => String(call[0]));
        expect(messages.some((m) => m.includes('нет экрана "nope"'))).toBe(true);
        expect(messages.some((m) => m.includes('missing'))).toBe(true);
        // Без Telegram лимит в 64 байта не действует — предупреждения о нём нет
        expect(messages.some((m) => m.includes('64 байт'))).toBe(false);
        await bot.close();
    });

    it('при подключённом Telegram предупреждает о payload длиннее 64 байт', async () => {
        const warn = jest.fn();
        const bot = makeBot(warn);
        bot.use(new TelegramAdapter('1:t'));
        bot.defineMenu('m', {
            screens: {
                ['x'.repeat(60)]: { text: 'long' },
                other: { text: 'O', buttons: [{ title: 'L', to: 'x'.repeat(60) }] },
            },
        });
        const messages = warn.mock.calls.map((call) => String(call[0]));
        expect(messages.some((m) => m.includes('64 байт'))).toBe(true);
        await bot.close();
    });
});
