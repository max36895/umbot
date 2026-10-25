/**
 * Результат bot.send(): рассылка должна знать, дошло ли сообщение.
 *
 * Адаптер выставляет platformOptions.sendFailed, когда API платформы отклонил
 * отправку, и BasePlatform.send() возвращает false. Тело ответа вебхука
 * (getContent) при этом не меняется — иначе платформа повторяла бы доставку.
 */
import { Bot, BaseBotController } from '../../src';
import {
    AlisaAdapter,
    MaxAdapter,
    MaxRequest,
    T_ALISA,
    T_MAX_APP,
    T_TELEGRAM,
    T_VIBER,
    T_VK,
    TelegramAdapter,
    TelegramRequest,
    ViberAdapter,
    VkAdapter,
    VkRequest,
    VkSound,
} from '../../src/plugins';

interface ICall {
    url: string;
    body: string;
}

function makeBot(response: () => Promise<Response>): { bot: Bot; calls: ICall[] } {
    const bot = new Bot();
    bot.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
    const calls: ICall[] = [];
    bot.getAppContext().httpClient = async (url, options): Promise<Response> => {
        calls.push({ url: String(url), body: String(options?.body ?? '') });
        return response();
    };
    return { bot, calls };
}

const json =
    (data: unknown, status = 200) =>
    (): Promise<Response> =>
        Promise.resolve(Response.json(data, { status }));
const networkError = (): Promise<Response> => Promise.reject(new Error('ECONNRESET'));

// Спайны на прототипах API-классов переживают тест: без восстановления они
// подменяют sendMessage/messagesSend в следующих тестах этого файла.
afterEach(() => {
    jest.restoreAllMocks();
});

describe('bot.send(): Telegram', () => {
    function setup(
        response: () => Promise<Response>,
        options?: Record<string, unknown>,
    ): { bot: Bot; calls: ICall[] } {
        const ctx = makeBot(response);
        ctx.bot.use(new TelegramAdapter('1:t', options));
        return ctx;
    }

    it('успешная отправка — ok', async () => {
        const { bot, calls } = setup(json({ ok: true, result: { message_id: 1 } }));
        await expect(bot.send('42', 'Привет', T_TELEGRAM)).resolves.toBe('ok');
        expect(calls[0].url).toContain('/sendMessage');
    });

    it('ответ на вебхук: ошибка API не меняет тело ответа (ok), иначе Telegram повторит апдейт', async () => {
        const { bot } = setup(json({ ok: false, error_code: 403, description: 'x' }, 403));
        bot.addCommand('hi', ['привет'], (_t, ctx) => {
            ctx.text = 'Привет!';
        });
        const update = {
            update_id: 1,
            message: {
                message_id: 1,
                from: { id: 42, is_bot: false, first_name: 'U' },
                chat: { id: 42, type: 'private' },
                text: 'привет',
            },
        };
        await expect(bot.run(T_TELEGRAM, JSON.stringify(update))).resolves.toBe('ok');
        await bot.close();
    });

    it('пользователь заблокировал бота (403) — false', async () => {
        const { bot } = setup(
            json({ ok: false, error_code: 403, description: 'Forbidden: bot was blocked' }, 403),
        );
        await expect(bot.send('42', 'Привет', T_TELEGRAM)).resolves.toBe(false);
    });

    it('ошибка запроса (400) — false', async () => {
        const { bot } = setup(
            json({ ok: false, error_code: 400, description: 'Bad Request' }, 400),
        );
        await expect(bot.send('42', 'Привет', T_TELEGRAM)).resolves.toBe(false);
    });

    it('сеть недоступна — false', async () => {
        const { bot } = setup(networkError);
        await expect(bot.send('42', 'Привет', T_TELEGRAM)).resolves.toBe(false);
    });

    it('telegram_webhook_reply: send() отправляет сообщение через API, а не телом вебхука', async () => {
        const { bot, calls } = setup(json({ ok: true, result: { message_id: 1 } }), {
            telegram_webhook_reply: true,
        });
        await expect(bot.send('42', 'Привет', T_TELEGRAM)).resolves.toBe('ok');
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('/sendMessage');
    });

    it('контроллер с кнопками: клавиатура уходит, ошибка API — false', async () => {
        const { bot, calls } = setup(json({ ok: false, error_code: 403, description: 'x' }, 403));
        const controller = new BaseBotController(bot.getAppContext());
        controller.text = 'Выберите';
        controller.buttons.addBtn('Да');
        await expect(bot.send('42', controller, T_TELEGRAM)).resolves.toBe(false);
        expect(calls[0].body).toContain('reply_markup');
    });

    it('флаг ошибки сбрасывается: повторная успешная отправка тем же контроллером — ok', async () => {
        let fail = true;
        const { bot } = setup(() =>
            fail
                ? json({ ok: false, error_code: 403, description: 'x' }, 403)()
                : json({ ok: true, result: { message_id: 1 } })(),
        );
        const controller = new BaseBotController(bot.getAppContext());
        controller.text = 'Привет';
        await expect(bot.send('42', controller, T_TELEGRAM)).resolves.toBe(false);
        fail = false;
        await expect(bot.send('42', controller, T_TELEGRAM)).resolves.toBe('ok');
    });

    it('одиночное фото карточки не доставлено (403 на sendPhoto) — false', async () => {
        const { bot, calls } = setup(json({ ok: true, result: { message_id: 1 } }));
        // Текст отправляется успешно, а sendPhoto отклоняется — иначе тест не отличит
        // недоставку фото от недоставки текста
        bot.getAppContext().httpClient = async (url, options): Promise<Response> => {
            const urlStr = String(url);
            calls.push({ url: urlStr, body: String(options?.body ?? '') });
            return urlStr.includes('/sendPhoto')
                ? json({ ok: false, error_code: 403, description: 'blocked' }, 403)()
                : json({ ok: true, result: { message_id: 1 } })();
        };
        const controller = new BaseBotController(bot.getAppContext());
        controller.text = 'Смотрите фото';
        controller.card.addImage('cached_photo_id', 'Фото');
        await expect(bot.send('42', controller, T_TELEGRAM)).resolves.toBe(false);
        expect(calls.some((call) => call.url.includes('/sendPhoto'))).toBe(true);
    });

    it('send() с контроллером inline-запроса шлёт сообщение получателю, а не отвечает на inline-запрос', async () => {
        const { bot, calls } = setup(json({ ok: true, result: { message_id: 1 } }));
        const controller = new BaseBotController(bot.getAppContext());
        controller.text = 'Уведомление';
        // Контроллер входящего inline-запроса: send() не является ответом на вебхук,
        // поэтому answerInlineQuery не должен поглощать сообщение
        controller.platformOptions.requestData = { telegram: { inlineQueryId: 'iq1' } };
        await expect(bot.send('42', controller, T_TELEGRAM)).resolves.toBe('ok');
        const urls = calls.map((call) => call.url).join();
        expect(urls).toContain('/sendMessage');
        expect(urls).not.toContain('/answerInlineQuery');
    });
});

describe('bot.send(): VK', () => {
    function setup(response: () => Promise<Response>): { bot: Bot; calls: ICall[] } {
        const ctx = makeBot(response);
        ctx.bot.use(new VkAdapter('vk-token'));
        return ctx;
    }

    it('успешная отправка — ok', async () => {
        const { bot } = setup(json({ response: 10 }));
        await expect(bot.send('42', 'Привет', T_VK)).resolves.toBe('ok');
    });

    it('ошибка API (901: нельзя писать пользователю) — false', async () => {
        const { bot } = setup(
            json({ error: { error_code: 901, error_msg: "Can't send messages" } }),
        );
        await expect(bot.send('42', 'Привет', T_VK)).resolves.toBe(false);
    });

    it('сеть недоступна — false', async () => {
        const { bot } = setup(networkError);
        await expect(bot.send('42', 'Привет', T_VK)).resolves.toBe(false);
    });
});

describe('bot.send(): MAX', () => {
    function setup(response: () => Promise<Response>): { bot: Bot; calls: ICall[] } {
        const ctx = makeBot(response);
        ctx.bot.use(new MaxAdapter('max-token'));
        return ctx;
    }

    it('успешная отправка — ok', async () => {
        const { bot } = setup(json({ message: { body: { mid: 'm1' } } }));
        await expect(bot.send('42', 'Привет', T_MAX_APP)).resolves.toBe('ok');
    });

    it('ошибка API (403) — false', async () => {
        const { bot } = setup(json({ code: 'chat.denied', message: 'denied' }, 403));
        await expect(bot.send('43', 'Привет', T_MAX_APP)).resolves.toBe(false);
    });
});

describe('bot.send(): Viber', () => {
    function setup(response: () => Promise<Response>): { bot: Bot; calls: ICall[] } {
        const ctx = makeBot(response);
        ctx.bot.use(new ViberAdapter('viber-token', { viber_sender: 'Бот' }));
        return ctx;
    }

    it('успешная отправка — ok', async () => {
        const { bot } = setup(json({ status: 0, status_message: 'ok' }));
        await expect(bot.send('u1', 'Привет', T_VIBER)).resolves.toBe('ok');
    });

    it('ошибка API (receiverNotSubscribed) — false', async () => {
        const { bot } = setup(json({ status: 6, status_message: 'notSubscribed' }));
        await expect(bot.send('u1', 'Привет', T_VIBER)).resolves.toBe(false);
    });

    it('send() с контроллером conversation_started шлёт send_message, а не welcome JSON в никуда', async () => {
        const { bot, calls } = setup(json({ status: 0, status_message: 'ok' }));
        const controller = new BaseBotController(bot.getAppContext());
        controller.text = 'Привет!';
        controller.requestObject = { event: 'conversation_started' };
        await expect(bot.send('u1', controller, T_VIBER)).resolves.toBe('ok');
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[0].body).toContain('Привет!');
    });
});

describe('bot.send(): платформа без рассылки', () => {
    it('Алиса — false, запросов нет', async () => {
        const { bot, calls } = makeBot(json({}));
        bot.use(new AlisaAdapter());
        await expect(bot.send('u1', 'Привет', T_ALISA)).resolves.toBe(false);
        expect(calls).toHaveLength(0);
    });
});

describe('Лимит рассылки и bot.broadcast', () => {
    const okTelegram = json({ ok: true, result: { message_id: 1 } });

    function chatIds(calls: ICall[]): string[] {
        return calls.map((call) => String((JSON.parse(call.body) as { chat_id: unknown }).chat_id));
    }

    it('send() идёт не чаще лимита адаптера, даже при параллельных вызовах', async () => {
        const { bot } = makeBot(okTelegram);
        const times: number[] = [];
        bot.getAppContext().httpClient = async (): Promise<Response> => {
            times.push(Date.now());
            return okTelegram();
        };
        bot.use(new TelegramAdapter('1:t', { send_rate_limit: 10 }));
        const results = await Promise.all(
            ['1', '2', '3'].map((id) => bot.send(id, 'Привет', T_TELEGRAM)),
        );
        expect(results).toEqual(['ok', 'ok', 'ok']);
        // 10 в секунду — не меньше ~100 мс между отправками (с запасом на таймеры).
        expect((times[2] as number) - (times[0] as number)).toBeGreaterThanOrEqual(180);
    });

    it('ответ на входящее сообщение не ждёт очередь рассылки', async () => {
        const { bot } = makeBot(okTelegram);
        bot.use(new TelegramAdapter('1:t', { send_rate_limit: 1 }));
        bot.addCommand('hi', ['привет'], (_t, ctx) => {
            ctx.text = 'Привет!';
        });
        await bot.send('1', 'рассылка', T_TELEGRAM);
        const pending = bot.send('2', 'рассылка', T_TELEGRAM); // ждёт секунду
        const started = Date.now();
        const update = {
            update_id: 1,
            message: {
                message_id: 1,
                from: { id: 42, is_bot: false, first_name: 'U' },
                chat: { id: 42, type: 'private' },
                text: 'привет',
            },
        };
        await bot.run(T_TELEGRAM, JSON.stringify(update));
        expect(Date.now() - started).toBeLessThan(500);
        await pending;
        await bot.close();
    });

    it('один контроллер по очереди уходит разным получателям', async () => {
        const { bot, calls } = makeBot(okTelegram);
        bot.use(new TelegramAdapter('1:t'));
        const controller = new BaseBotController(bot.getAppContext());
        controller.text = 'Новости';
        await bot.send('1', controller, T_TELEGRAM);
        await bot.send('2', controller, T_TELEGRAM);
        expect(chatIds(calls)).toEqual(['1', '2']);
    });

    it('контроллер текущего запроса после send() сохраняет своего пользователя', async () => {
        const { bot, calls } = makeBot(okTelegram);
        bot.use(new TelegramAdapter('1:t', { telegram_webhook_reply: true }));
        const ctx = new BaseBotController(bot.getAppContext());
        ctx.userId = 'current';
        ctx.text = 'Уведомление';
        await bot.send('other', ctx, T_TELEGRAM);
        expect(chatIds(calls)).toEqual(['other']);
        expect(ctx.userId).toBe('current');
        expect(ctx.platformOptions.isProactive).toBeUndefined();
    });

    it('broadcast: результат по каждому получателю, onResult, фабрика сообщения', async () => {
        const { bot, calls } = makeBot(okTelegram);
        bot.getAppContext().httpClient = async (url, options): Promise<Response> => {
            const body = String(options?.body ?? '');
            calls.push({ url: String(url), body });
            return (JSON.parse(body) as { chat_id: string }).chat_id === '2'
                ? json({ ok: false, error_code: 403, description: 'blocked' }, 403)()
                : okTelegram();
        };
        bot.use(new TelegramAdapter('1:t', { send_rate_limit: 1000 }));
        const reported: [string | number, boolean][] = [];
        const result = await bot.broadcast(
            ['1', '2', '3'],
            (userId) => {
                const ctx = new BaseBotController(bot.getAppContext());
                ctx.text = `Привет, ${userId}`;
                ctx.buttons.addBtn('Открыть', 'https://example.com');
                return ctx;
            },
            T_TELEGRAM,
            {
                onResult: (userId, ok) => {
                    reported.push([userId, ok]);
                },
            },
        );
        expect([...result.sent].sort()).toEqual(['1', '3']);
        expect(result.failed).toEqual(['2']);
        expect(reported).toHaveLength(3);
        expect(calls.every((call) => call.body.includes('reply_markup'))).toBe(true);
        expect(calls.some((call) => call.body.includes('Привет, 3'))).toBe(true);
    });

    it('broadcast: ошибка фабрики и onResult не прерывает рассылку', async () => {
        const { bot } = makeBot(okTelegram);
        bot.use(new TelegramAdapter('1:t', { send_rate_limit: 1000 }));
        const result = await bot.broadcast(
            ['1', '2'],
            (userId) => {
                if (userId === '1') {
                    throw new Error('нет данных');
                }
                return 'Привет';
            },
            T_TELEGRAM,
            {
                onResult: () => {
                    throw new Error('сбой отметки');
                },
            },
        );
        expect(result).toEqual({ sent: ['2'], failed: ['1'] });
    });

    it('broadcast на неподключённую платформу — все в failed', async () => {
        const { bot } = makeBot(okTelegram);
        await expect(bot.broadcast(['1'], 'Привет', T_VK)).resolves.toEqual({
            sent: [],
            failed: ['1'],
        });
    });
});

describe('bot.send / broadcast с сообщением { text, buttons }', () => {
    it('собирает текст и кнопки без ручного контроллера', async () => {
        const { bot, calls } = makeBot(json({ ok: true, result: { message_id: 1 } }));
        bot.use(new TelegramAdapter('1:t'));
        const vote = bot.defineAction<{ o: number }>('vote');
        const res = await bot.send(
            '42',
            {
                text: 'Голосуем',
                buttons: [
                    'Обычная',
                    { title: 'Сайт', url: 'https://example.com' },
                    { title: 'За', payload: vote.payload({ o: 1 }) },
                ],
            },
            T_TELEGRAM,
        );
        expect(res).toBe('ok');
        const body = JSON.parse(calls[0]?.body ?? '{}') as { text: string; reply_markup: string };
        expect(body.text).toBe('Голосуем');
        expect(body.reply_markup).toContain('https://example.com');
        expect(body.reply_markup).toContain('vote');
    });

    it('broadcast принимает сообщение-объект', async () => {
        const { bot, calls } = makeBot(json({ ok: true, result: { message_id: 1 } }));
        bot.use(new TelegramAdapter('1:t', { send_rate_limit: 1000 }));
        const result = await bot.broadcast(
            ['1', '2'],
            { text: 'Новости', buttons: ['Читать'] },
            T_TELEGRAM,
        );
        expect([...result.sent].sort()).toEqual(['1', '2']);
        expect(calls.every((call) => call.body.includes('reply_markup'))).toBe(true);
    });
});

describe('bot.send(): контроллер входящего запроса уходит адресату send()', () => {
    it('Telegram: chat_id входящего чата не перехватывает рассылку', async () => {
        const { bot } = makeBot(json({ ok: true, result: { message_id: 1 } }));
        bot.use(new TelegramAdapter('1:t'));
        const adapter = bot.getAppContext().platforms[T_TELEGRAM]!;
        const sendMessage = jest
            .spyOn(TelegramRequest.prototype, 'sendMessage')
            .mockResolvedValue({ message_id: 1 });
        const ctx = new BaseBotController(bot.getAppContext());
        await adapter.setQueryData(
            {
                update_id: 1,
                message: {
                    message_id: 1,
                    from: { id: 42, is_bot: false, first_name: 'U' },
                    chat: { id: 4242, type: 'private' },
                    text: 'привет',
                },
            },
            ctx,
        );
        ctx.text = 'Ответ';
        // Ответ на вебхук идёт в чат запроса
        await adapter.getContent(ctx);
        expect(sendMessage.mock.calls[0]?.[0]).toBe(4242);
        // Рассылка тем же контроллером — адресату send(), не в чат запроса
        await bot.send(99, ctx, T_TELEGRAM);
        expect(sendMessage.mock.calls[1]?.[0]).toBe(99);
        // После send() контроллер восстановлен
        expect(ctx.userId).toBe(42);
        expect(ctx.platformOptions.isProactive).toBeUndefined();
    });

    it('VK: peer_id входящего чата не перехватывает рассылку', async () => {
        const { bot } = makeBot(json({ response: 1 }));
        bot.use(new VkAdapter('t', { vk_load_user_info: false }));
        const adapter = bot.getAppContext().platforms[T_VK]!;
        const messagesSend = jest
            .spyOn(VkRequest.prototype, 'messagesSend')
            .mockResolvedValue({ message_id: 1 });
        const ctx = new BaseBotController(bot.getAppContext());
        await adapter.setQueryData(
            {
                type: 'message_new',
                group_id: '1',
                object: { message: { from_id: 12345, peer_id: 4242, id: 1, text: 'привет' } },
            },
            ctx,
        );
        ctx.text = 'Ответ';
        await adapter.getContent(ctx);
        expect(messagesSend.mock.calls[0]?.[0]).toBe(4242);
        await bot.send(99, ctx, T_VK);
        expect(messagesSend.mock.calls[1]?.[0]).toBe(99);
        expect(ctx.userId).toBe(12345);
    });

    it('MAX: chat_id входящего группового чата не перехватывает рассылку', async () => {
        const { bot } = makeBot(json({}));
        bot.use(new MaxAdapter('max-token'));
        const adapter = bot.getAppContext().platforms[T_MAX_APP]!;
        const messagesSend = jest
            .spyOn(MaxRequest.prototype, 'messagesSend')
            .mockResolvedValue(null);
        const ctx = new BaseBotController(bot.getAppContext());
        await adapter.setQueryData(
            {
                update_type: 'message_created',
                timestamp: 1,
                message: {
                    body: { text: 'привет' },
                    sender: { user_id: 42 },
                    recipient: { chat_id: 4242, chat_type: 'chat' },
                    message_id: 1,
                },
            } as never,
            ctx,
        );
        ctx.text = 'Ответ';
        await adapter.getContent(ctx);
        expect(messagesSend.mock.calls[0]?.[0]).toBe(4242);
        expect(messagesSend.mock.calls[0]?.[3]).toBe('chat');
        await bot.send(99, ctx, T_MAX_APP);
        expect(messagesSend.mock.calls[1]?.[0]).toBe(99);
        expect(messagesSend.mock.calls[1]?.[3]).toBe('user');
        expect(ctx.userId).toBe(42);
    });

    it('Telegram: одиночное фото карточки тоже уходит адресату send(), а не чату запроса', async () => {
        const { bot } = makeBot(json({ ok: true, result: { message_id: 1 } }));
        bot.use(new TelegramAdapter('1:t'));
        const adapter = bot.getAppContext().platforms[T_TELEGRAM]!;
        const sendMessage = jest
            .spyOn(TelegramRequest.prototype, 'sendMessage')
            .mockResolvedValue({ message_id: 1 });
        const sendPhoto = jest
            .spyOn(TelegramRequest.prototype, 'sendPhoto')
            .mockResolvedValue({ ok: true, result: null });
        const ctx = new BaseBotController(bot.getAppContext());
        await adapter.setQueryData(
            {
                update_id: 1,
                message: {
                    message_id: 1,
                    from: { id: 42, is_bot: false, first_name: 'U' },
                    chat: { id: 4242, type: 'private' },
                    text: 'привет',
                },
            },
            ctx,
        );
        ctx.text = 'Смотрите фото';
        ctx.card.addImage('cached_photo_id', 'Фото');
        await bot.send(99, ctx, T_TELEGRAM);
        // Текст и фото — оба адресату send(), чат 4242 ничего не получает
        expect(sendMessage.mock.calls[0]?.[0]).toBe(99);
        expect(sendPhoto.mock.calls[0]?.[0]).toBe(99);
    });
});

describe('bot.send(): пустой ответ — недоставка, а не «ok»', () => {
    it('Telegram: ответ без текста, карточек и звуков — false', async () => {
        const { bot, calls } = makeBot(json({ ok: true, result: { message_id: 1 } }));
        bot.use(new TelegramAdapter('1:t'));
        await expect(
            bot.send('42', new BaseBotController(bot.getAppContext()), T_TELEGRAM),
        ).resolves.toBe(false);
        expect(calls).toHaveLength(0);
    });

    it('Telegram: клавиатура без текста тоже ничего не доставляет — false', async () => {
        const { bot, calls } = makeBot(json({ ok: true, result: { message_id: 1 } }));
        bot.use(new TelegramAdapter('1:t'));
        const ctx = new BaseBotController(bot.getAppContext());
        ctx.buttons.addBtn('Да');
        await expect(bot.send('42', ctx, T_TELEGRAM)).resolves.toBe(false);
        expect(calls).toHaveLength(0);
    });

    it('Viber: ответ без текста и карточек — false', async () => {
        const { bot, calls } = makeBot(json({ status: 0, status_message: 'ok' }));
        bot.use(new ViberAdapter('viber-token', { viber_sender: 'Бот' }));
        await expect(
            bot.send('u1', new BaseBotController(bot.getAppContext()), T_VIBER),
        ).resolves.toBe(false);
        expect(calls).toHaveLength(0);
    });

    it('broadcast считает пустое сообщение недоставленным', async () => {
        const { bot } = makeBot(json({ ok: true, result: { message_id: 1 } }));
        bot.use(new TelegramAdapter('1:t'));
        const result = await bot.broadcast(
            ['1', '2'],
            () => new BaseBotController(bot.getAppContext()),
            T_TELEGRAM,
        );
        expect(result).toEqual({ sent: [], failed: ['1', '2'] });
    });
});

describe('Лимит отправки учитывает загрузку медиа VK', () => {
    it('карточка с незакэшированной картинкой занимает дополнительные слоты лимита', async () => {
        const { bot } = makeBot(json({ response: 1 }));
        const times: number[] = [];
        bot.getAppContext().httpClient = async (url): Promise<Response> => {
            if (String(url).includes('messages.send')) {
                times.push(Date.now());
                return json({ response: 1 })();
            }
            // Без upload_url загрузка не состоится, но слоты лимита уже
            // зарезервированы — резерв делается до вызовов API.
            return json({ response: {} })();
        };
        bot.use(new VkAdapter('t', { vk_load_user_info: false, send_rate_limit: 10 }));

        const withCard = new BaseBotController(bot.getAppContext());
        withCard.text = 'Смотрите';
        withCard.card.addImage('https://example.com/pic.jpg');
        const plain = new BaseBotController(bot.getAppContext());
        plain.text = 'Просто текст';

        await bot.send(1, withCard, T_VK);
        await bot.send(2, plain, T_VK);
        expect(times).toHaveLength(2);
        // Слоты: сама отправка (100 мс) + 2 слота загрузки = не меньше ~300 мс
        expect((times[1] as number) - (times[0] as number)).toBeGreaterThanOrEqual(280);
    });

    it('загрузка голосового VK занимает дополнительные слоты лимита', async () => {
        const { bot } = makeBot(json({ response: 1 }));
        const times: number[] = [];
        bot.getAppContext().httpClient = async (url): Promise<Response> => {
            if (String(url).includes('messages.send')) {
                times.push(Date.now());
                return json({ response: 1 })();
            }
            // docs.getMessagesUploadServer без upload_url — загрузка не состоится,
            // но два слота уже зарезервированы (резерв идёт до вызовов API).
            return json({ response: {} })();
        };
        bot.use(new VkAdapter('t', { vk_load_user_info: false, send_rate_limit: 10 }));

        await bot.send(1, 'первая', T_VK);
        const ctx = new BaseBotController(bot.getAppContext());
        ctx.userId = 2;
        // Cache miss голосового: docs.getMessagesUploadServer + docs.save — 2 слота
        await VkSound.getSoundInDB(ctx, '/voice.ogg');
        await bot.send(3, 'вторая', T_VK);

        expect(times).toHaveLength(2);
        expect((times[1] as number) - (times[0] as number)).toBeGreaterThanOrEqual(280);
    });

    it('consumeSendLimit: дополнительные вызовы API сдвигают следующую отправку', async () => {
        const okTelegram = json({ ok: true, result: { message_id: 1 } });
        const { bot } = makeBot(okTelegram);
        const times: number[] = [];
        bot.getAppContext().httpClient = async (): Promise<Response> => {
            times.push(Date.now());
            return okTelegram();
        };
        bot.use(new TelegramAdapter('1:t', { send_rate_limit: 10 }));
        const adapter = bot.getAppContext().platforms[T_TELEGRAM] as TelegramAdapter;

        await bot.send(1, 'первая', T_TELEGRAM);
        adapter.consumeSendLimit(2);
        await bot.send(2, 'вторая', T_TELEGRAM);

        expect(times).toHaveLength(2);
        expect((times[1] as number) - (times[0] as number)).toBeGreaterThanOrEqual(280);
    });

    it('consumeSendLimit без лимита отправки — no-op', async () => {
        const { bot, calls } = makeBot(json({}));
        bot.use(new AlisaAdapter());
        const adapter = bot.getAppContext().platforms[T_ALISA] as AlisaAdapter;
        expect(() => adapter.consumeSendLimit(3)).not.toThrow();
        await expect(bot.send('u1', 'Привет', T_ALISA)).resolves.toBe(false);
        expect(calls).toHaveLength(0);
    });
});
