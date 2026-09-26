import { AppContext, BotController } from '../../src';
import {
    MaxAdapter,
    TelegramAdapter,
    T_MAX_APP,
    T_TELEGRAM,
    T_VIBER,
    T_VK,
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

/**
 * Служебные события платформ раньше приводили к `setQueryData() === false`,
 * из-за чего вебхук отвечал 500. Telegram на 5xx бесконечно повторяет апдейт,
 * VK Callback API отключает сервер, а Viber не может зарегистрировать вебхук.
 * Все такие события должны тихо помечаться `skipAutoReply` и подтверждаться.
 */
describe('Служебные события платформ', () => {
    it('Viber подтверждает событие webhook, которое приходит при set_webhook', async () => {
        const context = createContext();
        context.appConfig.tokens[T_VIBER] = { token: 'viber-token' };
        const adapter = new ViberAdapter('viber-token');
        adapter.init(context);
        const controller = new TestController(context);

        expect(
            await adapter.setQueryData(
                { event: 'webhook', timestamp: 1, message_token: 1 } as never,
                controller,
            ),
        ).toBe(true);
        expect(controller.skipAutoReply).toBe(true);
    });

    it('Viber не падает на неизвестном типе события', async () => {
        const context = createContext();
        context.appConfig.tokens[T_VIBER] = { token: 'viber-token' };
        const adapter = new ViberAdapter('viber-token');
        adapter.init(context);
        const controller = new TestController(context);

        expect(
            await adapter.setQueryData(
                { event: 'client_status', timestamp: 1 } as never,
                controller,
            ),
        ).toBe(true);
        expect(controller.skipAutoReply).toBe(true);
    });

    it('Viber не пытается ответить на unsubscribed', async () => {
        // Отписавшемуся пользователю send_message отправить нельзя — Viber API
        // отклоняет запрос. Событие подтверждается без автоответа.
        const context = createContext();
        context.appConfig.tokens[T_VIBER] = { token: 'viber-token' };
        const adapter = new ViberAdapter('viber-token');
        adapter.init(context);
        const controller = new TestController(context);

        expect(
            await adapter.setQueryData(
                { event: 'unsubscribed', timestamp: 1, user: { id: 'user-1' } } as never,
                controller,
            ),
        ).toBe(true);
        expect(controller.skipAutoReply).toBe(true);
        expect(controller.userId).toBe('user-1');
    });

    it('Viber оставляет автоответ на subscribed (welcome-сценарий)', async () => {
        const context = createContext();
        context.appConfig.tokens[T_VIBER] = { token: 'viber-token' };
        const adapter = new ViberAdapter('viber-token');
        adapter.init(context);
        const controller = new TestController(context);

        expect(
            await adapter.setQueryData(
                { event: 'subscribed', timestamp: 1, user: { id: 'user-1' } } as never,
                controller,
            ),
        ).toBe(true);
        expect(controller.skipAutoReply).toBeFalsy();
    });

    it('Telegram определяет любой апдейт по update_id', () => {
        const context = createContext();
        context.appConfig.tokens[T_TELEGRAM] = { token: 'tg-token' };
        const adapter = new TelegramAdapter('tg-token');
        adapter.init(context);

        expect(adapter.isPlatformOnQuery({ update_id: 1, my_chat_member: {} } as never)).toBe(true);
        expect(adapter.isPlatformOnQuery({ update_id: 2, poll_answer: {} } as never)).toBe(true);
        expect(adapter.isPlatformOnQuery({ some_field: 1 } as never)).toBe(false);
    });

    it('Telegram подтверждает апдейт без поддерживаемого события', async () => {
        const context = createContext();
        context.appConfig.tokens[T_TELEGRAM] = { token: 'tg-token' };
        const adapter = new TelegramAdapter('tg-token');
        adapter.init(context);
        const controller = new TestController(context);

        expect(
            await adapter.setQueryData(
                { update_id: 7, my_chat_member: { chat: { id: 1 }, from: { id: 1 } } } as never,
                controller,
            ),
        ).toBe(true);
        expect(controller.skipAutoReply).toBe(true);
    });

    it('VK подтверждает события группы, не требующие ответа', async () => {
        const context = createContext();
        context.appConfig.tokens[T_VK] = { token: 'vk-token' };
        const adapter = new VkAdapter('vk-token');
        adapter.init(context);

        for (const type of ['group_join', 'message_reply', 'message_allow']) {
            const controller = new TestController(context);
            expect(
                await adapter.setQueryData(
                    { type, group_id: 1, object: { user_id: 5 } } as never,
                    controller,
                ),
            ).toBe(true);
            expect(controller.skipAutoReply).toBe(true);
            expect(controller.userId).toBe(5);
        }
    });

    it('MAX определяет новый тип события по паре update_type + timestamp', () => {
        const context = createContext();
        const adapter = new MaxAdapter('max-token');
        adapter.init(context);

        expect(
            adapter.isPlatformOnQuery({ update_type: 'some_new_event', timestamp: 123 } as never),
        ).toBe(true);
        // Без timestamp запрос не считается MAX: одного постороннего поля мало.
        expect(adapter.isPlatformOnQuery({ update_type: 'unknown' } as never)).toBe(false);
    });

    it('MAX подтверждает служебное событие без автоответа', async () => {
        const context = createContext();
        context.appConfig.tokens[T_MAX_APP] = { token: 'max-token' };
        const adapter = new MaxAdapter('max-token');
        adapter.init(context);
        const controller = new TestController(context);

        expect(
            await adapter.setQueryData(
                { update_type: 'bot_stopped', timestamp: 1, user: { user_id: 9 } } as never,
                controller,
            ),
        ).toBe(true);
        expect(controller.skipAutoReply).toBe(true);
    });
});
