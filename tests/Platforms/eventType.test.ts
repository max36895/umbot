/**
 * Тесты выставления controller.eventType адаптерами платформ.
 *
 * Каждая платформа приводит свой тип апдейта к универсальному перечню
 * TEventType (см. src/core/events.ts) — это основа декларативного роутинга
 * bot.addEvent('photo', ...) без разбора requestObject вручную.
 */
import { AppContext, BotController } from '../../src';
import {
    AlisaAdapter,
    MarusiaAdapter,
    MaxAdapter,
    SmartAppAdapter,
    T_ALISA,
    T_MARUSIA,
    T_MAX_APP,
    T_SMART_APP,
    T_TELEGRAM,
    T_VIBER,
    T_VK,
    TelegramAdapter,
    ViberAdapter,
    VkAdapter,
} from '../../src/plugins';

class TestController extends BotController {
    action(): void {
        return;
    }
}

function createContext(): AppContext {
    const context = new AppContext();
    context.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
    return context;
}

describe('TelegramAdapter: eventType', () => {
    function setup(): { adapter: TelegramAdapter } {
        const context = createContext();
        context.appConfig.tokens[T_TELEGRAM] = { token: 'tg-token' };
        const adapter = new TelegramAdapter('tg-token');
        adapter.init(context);
        return { context, adapter };
    }

    it('текстовое сообщение → message', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                update_id: 1,
                message: {
                    message_id: 1,
                    from: { id: 42, is_bot: false, first_name: 'U' },
                    chat: { id: 42, type: 'private' },
                    text: 'привет',
                },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('message');
    });

    it('фото → photo', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                update_id: 2,
                message: {
                    message_id: 2,
                    from: { id: 42, is_bot: false, first_name: 'U' },
                    chat: { id: 42, type: 'private' },
                    photo: [{ file_id: 'f', width: 1, height: 1 }],
                },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('photo');
    });

    it('голосовое → voice, стикер → sticker, гео → location', async () => {
        const { adapter } = setup();
        const base = (extra: Record<string, unknown>): Record<string, unknown> => ({
            update_id: 3,
            message: {
                message_id: 3,
                from: { id: 42, is_bot: false, first_name: 'U' },
                chat: { id: 42, type: 'private' },
                ...extra,
            },
        });
        const voice = new TestController(createContext());
        await adapter.setQueryData(base({ voice: { file_id: 'v' } }) as never, voice);
        expect(voice.eventType).toBe('voice');

        const sticker = new TestController(createContext());
        await adapter.setQueryData(base({ sticker: { file_id: 's' } }) as never, sticker);
        expect(sticker.eventType).toBe('sticker');

        const location = new TestController(createContext());
        await adapter.setQueryData(
            base({ location: { latitude: 1, longitude: 2 } }) as never,
            location,
        );
        expect(location.eventType).toBe('location');
    });

    it('callback_query → callback, payload {"command":"buy"} → userCommand "buy"', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                update_id: 4,
                callback_query: {
                    id: 'cb-1',
                    from: { id: 42, is_bot: false, first_name: 'U' },
                    message: { message_id: 9, chat: { id: 42, type: 'private' } },
                    data: '{"command":"buy"}',
                },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('callback');
        expect(controller.userCommand).toBe('buy');
        expect(controller.payload).toEqual({ command: 'buy' });
    });

    it('inline_query → inline', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                update_id: 5,
                inline_query: { id: 'iq-1', from: { id: 42, is_bot: false }, query: 'поиск' },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('inline');
    });

    it('edited_message → message_edited', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                update_id: 6,
                edited_message: {
                    message_id: 6,
                    from: { id: 42, is_bot: false, first_name: 'U' },
                    chat: { id: 42, type: 'private' },
                    text: 'исправлено',
                },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('message_edited');
    });

    it('channel_post → channel_post', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                update_id: 7,
                channel_post: { message_id: 7, chat: { id: -100 }, text: 'пост' },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('channel_post');
    });

    async function startUpdate(text: string): Promise<TestController> {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                update_id: 8,
                message: {
                    message_id: 8,
                    from: { id: 42, is_bot: false, first_name: 'U' },
                    chat: { id: 42, type: 'private' },
                    text,
                },
            } as never,
            controller,
        );
        return controller;
    }

    it('/start с параметром ссылки → start, параметр в payload с исходным регистром', async () => {
        const controller = await startUpdate('/start K7M2QX');
        expect(controller.eventType).toBe('start');
        expect(controller.payload).toBe('K7M2QX');
        // Команды по тексту /start продолжают работать.
        expect(controller.userCommand).toBe('/start k7m2qx');
    });

    it('/start@бот с параметром (группа) → start', async () => {
        const controller = await startUpdate('/start@room_bot K7M2QX');
        expect(controller.eventType).toBe('start');
        expect(controller.payload).toBe('K7M2QX');
    });

    it('/start@<чужой бот> не становится start, когда username задан опцией', async () => {
        const context = createContext();
        context.appConfig.tokens[T_TELEGRAM] = { token: 'tg-token' };
        const adapter = new TelegramAdapter('tg-token', { telegram_bot_username: '@room_bot' });
        adapter.init(context);
        const send = async (text: string): Promise<TestController> => {
            const controller = new TestController(createContext());
            await adapter.setQueryData(
                {
                    update_id: 9,
                    message: {
                        message_id: 9,
                        from: { id: 42, is_bot: false, first_name: 'U' },
                        chat: { id: -100, type: 'supergroup' },
                        text,
                    },
                } as never,
                controller,
            );
            return controller;
        };
        // Команда другого бота — обычное сообщение, событие start не возникает
        const other = await send('/start@other_bot K7M2QX');
        expect(other.eventType).toBe('message');
        expect(other.payload).toBeNull();
        // Своё имя — с любым регистром и с символом @ в опции
        const own = await send('/start@Room_Bot K7M2QX');
        expect(own.eventType).toBe('start');
        expect(own.payload).toBe('K7M2QX');
    });

    it('/start без параметра и похожие команды — обычное сообщение', async () => {
        for (const text of ['/start', '/start ', '/startgame K7M2QX', 'start K7M2QX']) {
            const controller = await startUpdate(text);
            expect(controller.eventType).toBe('message');
            expect(controller.payload).toBeNull();
        }
    });
});

describe('VkAdapter: eventType и нормализация payload', () => {
    function setup(): { adapter: VkAdapter } {
        const context = createContext();
        context.appConfig.tokens[T_VK] = { token: 'vk-token' };
        const adapter = new VkAdapter('vk-token', { vk_load_user_info: false });
        adapter.init(context);
        return { adapter };
    }

    it('message_new → message', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                type: 'message_new',
                object: {
                    message: {
                        id: 1,
                        peer_id: 42,
                        from_id: 42,
                        text: 'привет',
                        random_id: 0,
                    },
                    client_info: {},
                },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('message');
    });

    it('message_event → callback, payload-строка нормализуется в имя действия', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                type: 'message_event',
                object: {
                    user_id: 42,
                    peer_id: 42,
                    event_id: 'ev-1',
                    payload: { command: 'buy' },
                    conversation_message_id: 3,
                },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('callback');
        expect(controller.userCommand).toBe('buy');
    });

    function messageWithRef(ref?: string): Record<string, unknown> {
        return {
            type: 'message_new',
            object: {
                message: {
                    id: 2,
                    peer_id: 42,
                    from_id: 42,
                    text: 'Начать',
                    random_id: 0,
                    payload: '{"command":"start"}',
                    ...(ref === undefined ? {} : { ref, ref_source: 'site' }),
                },
                client_info: {},
            },
        };
    }

    it('сообщение после перехода по vk.me/...?ref= → start, ref в payload', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(messageWithRef('K7M2QX') as never, controller);
        expect(controller.eventType).toBe('start');
        expect(controller.payload).toBe('K7M2QX');
        expect(controller.userCommand).toBe('начать');
    });

    it('сообщение без ref — обычное сообщение', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(messageWithRef() as never, controller);
        expect(controller.eventType).toBe('message');
        expect(controller.payload).toEqual({ command: 'start' });
    });
});

describe('MaxAdapter: eventType', () => {
    function setup(): { adapter: MaxAdapter } {
        const context = createContext();
        context.appConfig.tokens[T_MAX_APP] = { token: 'max-token' };
        const adapter = new MaxAdapter('max-token');
        adapter.init(context);
        return { adapter };
    }

    it('message_created → message', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                update_type: 'message_created',
                timestamp: 1,
                message: {
                    body: { text: 'привет' },
                    sender: { user_id: 42 },
                    recipient: { chat_id: 1, chat_type: 'private' },
                    message_id: 1,
                },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('message');
    });

    it('message_callback → callback, payload нормализуется', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                update_type: 'message_callback',
                timestamp: 1,
                callback: {
                    callback_id: 'cb-1',
                    payload: '{"command":"buy"}',
                    user: { user_id: 42 },
                },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('callback');
        expect(controller.userCommand).toBe('buy');
        expect(controller.payload).toEqual({ command: 'buy' });
    });

    it('message_callback: payload-объект кнопки приходит объектом, строка — строкой', async () => {
        const { adapter } = setup();
        const press = async (payload: string): Promise<TestController> => {
            const controller = new TestController(createContext());
            await adapter.setQueryData(
                {
                    update_type: 'message_callback',
                    timestamp: 1,
                    callback: { callback_id: 'cb-2', payload, user: { user_id: 42 } },
                } as never,
                controller,
            );
            return controller;
        };
        expect((await press('{"action":"go","r":"abc"}')).payload).toEqual({
            action: 'go',
            r: 'abc',
        });
        expect((await press('go')).payload).toBe('go');
    });

    it('bot_started → start', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                update_type: 'bot_started',
                timestamp: 1,
                chat_id: 777,
                user: { user_id: 42 },
                payload: 'ref_promo',
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('start');
        // Нажатие «Начать» — первое касание: приветствие должно уйти
        // (skipAutoReply заглушил бы и welcome, и addEvent('start')).
        expect(controller.skipAutoReply).toBe(false);
        expect(controller.messageId).toBe(0);
        // Параметр deep-link из события bot_started.
        expect(controller.payload).toBe('ref_promo');
    });
});

describe('ViberAdapter: eventType', () => {
    function setup(): { adapter: ViberAdapter } {
        const context = createContext();
        context.appConfig.tokens[T_VIBER] = { token: 'viber-token' };
        const adapter = new ViberAdapter('viber-token');
        adapter.init(context);
        return { adapter };
    }

    it('текстовое сообщение → message', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                event: 'message',
                timestamp: 1,
                message_token: 1,
                sender: { id: 'u1', name: 'U', api_version: 8 },
                message: { type: 'text', text: 'привет' },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('message');
    });

    it('picture → photo', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                event: 'message',
                timestamp: 1,
                message_token: 2,
                sender: { id: 'u1', name: 'U', api_version: 8 },
                message: { type: 'picture', media: 'http://localhost/p.jpg' },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('photo');
    });

    it('conversation_started → start', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                event: 'conversation_started',
                timestamp: 1,
                user: { id: 'u1', name: 'U', api_version: 8 },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('start');
        expect(controller.payload).toBeNull();
    });

    it('conversation_started по ссылке с context → start, context в payload', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                event: 'conversation_started',
                timestamp: 1,
                context: 'K7M2QX',
                user: { id: 'u1', name: 'U', api_version: 8 },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('start');
        expect(controller.payload).toBe('K7M2QX');
    });

    it('нажатие кнопки с payload-объектом: данные кнопки в payload, действие в userCommand', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                event: 'message',
                timestamp: 1,
                message_token: 3,
                sender: { id: 'u1', name: 'U', api_version: 8 },
                message: { type: 'text', text: '{"action":"kick","p":"u7"}' },
            } as never,
            controller,
        );
        expect(controller.userCommand).toBe('kick');
        expect(controller.payload).toEqual({ action: 'kick', p: 'u7' });
    });

    it('subscribed → subscribed', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(
            {
                event: 'subscribed',
                timestamp: 1,
                user: { id: 'u1', name: 'U' },
            } as never,
            controller,
        );
        expect(controller.eventType).toBe('subscribed');
    });
});

describe('AlisaAdapter: eventType (account_linking)', () => {
    it('account_linking_complete_event → auth', (): void => {
        const context = createContext();
        context.appConfig.tokens[T_ALISA] = { token: 'alisa-token' };
        const adapter = new AlisaAdapter('alisa-token');
        adapter.init(context);
        const controller = new TestController(createContext());
        adapter.setQueryData(
            { account_linking_complete_event: { status: 'success' } } as never,
            controller,
        );
        expect(controller.eventType).toBe('auth');
        expect(controller.userEvents?.auth?.status).toBe(true);
    });
});

describe('MarusiaAdapter: eventType (account_linking)', () => {
    it('account_linking_complete_event → auth (симметрично Алисе)', (): void => {
        const context = createContext();
        context.appConfig.tokens[T_MARUSIA] = { token: 'marusia-token' };
        const adapter = new MarusiaAdapter('marusia-token');
        adapter.init(context);
        const controller = new TestController(createContext());
        adapter.setQueryData(
            { account_linking_complete_event: { status: 'success' } } as never,
            controller,
        );
        expect(controller.eventType).toBe('auth');
        expect(controller.userEvents?.auth?.status).toBe(true);
        // supportedEvents включает auth — addEvent('auth') не даёт ложного warn
        expect(adapter.supportedEvents).toContain('auth');
    });
});

describe('SmartAppAdapter: eventType (start / rating)', () => {
    function setup(): { adapter: SmartAppAdapter } {
        const context = createContext();
        context.appConfig.tokens[T_SMART_APP] = { token: 'smart-token' };
        const adapter = new SmartAppAdapter();
        adapter.init(context);
        return { adapter };
    }

    function makeQuery(messageName: string): Record<string, unknown> {
        return {
            messageId: 0,
            uuid: { userId: 'u1', channelId: 'c1' },
            sessionId: 's1',
            messageName,
            payload: {
                device: {},
                meta: {},
                projectName: 'p',
                app_info: { applicationId: 'app-1' },
                server_action: { action_id: 'run', parameters: { deep: 'link' } },
                ...(messageName === 'RATING_RESULT' ? { status_code: { code: 1 } } : {}),
            },
        };
    }

    it('RUN_APP → start', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(makeQuery('RUN_APP') as never, controller);
        expect(controller.eventType).toBe('start');
    });

    it('RATING_RESULT → rating', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(makeQuery('RATING_RESULT') as never, controller);
        expect(controller.eventType).toBe('rating');
    });
});
