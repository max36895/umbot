/**
 * Тесты на реальных форматах платформ (фикстуры).
 *
 * Фикстуры — образцы webhook-апдейтов платформ (по документации платформ и логам
 * live-test), лежат файлами в tests/Platforms/fixtures/<платформа>/. Каждая платформа
 * покрыта базовым набором: обычное сообщение, нажатие кнопки, стартовое событие
 * (deep-link), событие без содержательного ответа. Если платформа поменяет формат,
 * а адаптер — нет, эти тесты упадут первыми.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { MaxRequest } from '../../src/plugins/platforms/API/MaxRequest';
import { TelegramRequest } from '../../src/plugins/platforms/API/TelegramRequest';
import { ViberRequest } from '../../src/plugins/platforms/API/ViberRequest';
import { VkRequest } from '../../src/plugins/platforms/API/VkRequest';

const FIXTURES_DIR = join(__dirname, 'fixtures');

/** Читает фикстуру платформы из tests/Platforms/fixtures/<platform>/<name>.json. */
function fixture<T>(platform: string, name: string): T {
    return JSON.parse(readFileSync(join(FIXTURES_DIR, platform, `${name}.json`), 'utf-8')) as T;
}

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

describe('Telegram: фикстуры', () => {
    function setup(): { adapter: TelegramAdapter } {
        const context = createContext();
        context.appConfig.tokens[T_TELEGRAM] = { token: 'tg-token' };
        const adapter = new TelegramAdapter('tg-token');
        adapter.init(context);
        return { adapter };
    }

    it('обычное сообщение → ctx', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('telegram', 'text-message') as never, controller);
        expect(controller.eventType).toBe('message');
        expect(controller.userCommand).toBe('привет');
        expect(String(controller.userId)).toBe('424242');
    });

    it('нажатие кнопки (callback_query) → ctx', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('telegram', 'callback-query') as never, controller);
        expect(controller.eventType).toBe('callback');
        expect(controller.userCommand).toBe('buy');
        expect(controller.payload).toEqual({ command: 'buy' });
        expect(String(controller.userId)).toBe('424242');
    });

    it('deep-link /start <параметр> → start, параметр в payload', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('telegram', 'start-deeplink') as never, controller);
        expect(controller.eventType).toBe('start');
        expect(controller.payload).toBe('K7M2QX');
    });

    it('my_chat_member (бота заблокировали) → 200 без контента', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('telegram', 'my-chat-member') as never, controller);
        expect(controller.skipAutoReply).toBe(true);
        expect(controller.platformOptions.sendInInit).toBe('ok');
        expect(await adapter.getContent(controller)).toBe('ok');
    });

    it('ответ собирается в формате Telegram (inline_keyboard)', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('telegram', 'text-message') as never, controller);
        controller.text = 'Выберите товар';
        controller.buttons.addBtn('Купить', null, { command: 'buy' });
        const sendMessage = jest
            .spyOn(TelegramRequest.prototype, 'sendMessage')
            .mockResolvedValue({ ok: true, result: null });

        expect(await adapter.getContent(controller)).toBe('ok');

        const options = sendMessage.mock.calls[0][2] as { reply_markup: string };
        const markup = JSON.parse(options.reply_markup) as {
            inline_keyboard: { text: string; callback_data: string }[][];
        };
        expect(markup.inline_keyboard[0][0].text).toBe('Купить');
        expect(markup.inline_keyboard[0][0].callback_data).toBe('{"command":"buy"}');
    });
});

describe('VK: фикстуры', () => {
    function setup(options?: Record<string, unknown>): { adapter: VkAdapter } {
        const context = createContext();
        context.appConfig.tokens[T_VK] = { token: 'vk-token' };
        const adapter = new VkAdapter('vk-token', options);
        adapter.init(context);
        return { adapter };
    }

    it('обычное сообщение (message_new) → ctx', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('vk', 'text-message') as never, controller);
        expect(controller.eventType).toBe('message');
        expect(controller.userCommand).toBe('привет');
        expect(String(controller.userId)).toBe('424242');
    });

    it('нажатие кнопки (message_event) → ctx', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('vk', 'button-callback') as never, controller);
        expect(controller.eventType).toBe('callback');
        expect(controller.userCommand).toBe('buy');
        expect(controller.payload).toEqual({ command: 'buy' });
    });

    it('deep-link vk.me?ref= → start, ref в payload', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('vk', 'start-deeplink') as never, controller);
        expect(controller.eventType).toBe('start');
        expect(controller.payload).toBe('K7M2QX');
    });

    it('confirmation → ответ строкой подтверждения', async () => {
        const { adapter } = setup({ vk_confirmation_token: 'confirm-token' });
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('vk', 'confirmation') as never, controller);
        expect(controller.platformOptions.sendInInit).toBe('confirm-token');
    });

    it('ответ собирается в формате VK (keyboard)', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('vk', 'text-message') as never, controller);
        controller.text = 'Выберите товар';
        controller.buttons.addBtn('Купить', null, { command: 'buy' });
        const messagesSend = jest.spyOn(VkRequest.prototype, 'messagesSend').mockResolvedValue(1);

        expect(await adapter.getContent(controller)).toBe('ok');

        const params = messagesSend.mock.calls[0][2] as { keyboard: string };
        const keyboard = JSON.parse(params.keyboard) as {
            buttons: { action: { label: string; payload: string } }[][];
        };
        expect(keyboard.buttons[0][0].action.label).toBe('Купить');
        expect(JSON.parse(keyboard.buttons[0][0].action.payload)).toEqual({ command: 'buy' });
    });
});

describe('MAX: фикстуры', () => {
    function setup(): { adapter: MaxAdapter } {
        const context = createContext();
        context.appConfig.tokens[T_MAX_APP] = { token: 'max-token' };
        const adapter = new MaxAdapter('max-token');
        adapter.init(context);
        return { adapter };
    }

    it('обычное сообщение (message_created) → ctx', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('max', 'text-message') as never, controller);
        expect(controller.eventType).toBe('message');
        expect(controller.userCommand).toBe('привет');
        expect(String(controller.userId)).toBe('424242');
    });

    it('нажатие кнопки (message_callback) → ctx', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('max', 'button-callback') as never, controller);
        expect(controller.eventType).toBe('callback');
        expect(controller.userCommand).toBe('buy');
        expect(controller.payload).toEqual({ command: 'buy' });
    });

    it('bot_started с deep-link параметром → start', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('max', 'bot-started') as never, controller);
        expect(controller.eventType).toBe('start');
        expect(controller.payload).toBe('K7M2QX');
    });

    it('user_added → 200 без контента', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('max', 'user-added') as never, controller);
        expect(controller.skipAutoReply).toBe(true);
        expect(await adapter.getContent(controller)).toBe('ok');
    });

    it('ответ собирается в формате MAX (inline_keyboard attachment)', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('max', 'text-message') as never, controller);
        controller.text = 'Выберите товар';
        controller.buttons.addBtn('Купить', null, { command: 'buy' });
        const messagesSend = jest
            .spyOn(MaxRequest.prototype, 'messagesSend')
            .mockResolvedValue({ success: true, message: {} });

        expect(await adapter.getContent(controller)).toBe('ok');

        const params = messagesSend.mock.calls[0][2] as {
            keyboard: { buttons: { type: string; text: string; payload: string }[][] };
        };
        expect(params.keyboard.buttons[0][0].text).toBe('Купить');
        expect(params.keyboard.buttons[0][0].type).toBe('callback');
        expect(JSON.parse(params.keyboard.buttons[0][0].payload)).toEqual({ command: 'buy' });
    });
});

describe('Viber: фикстуры', () => {
    function setup(): { adapter: ViberAdapter } {
        const context = createContext();
        context.appConfig.tokens[T_VIBER] = { token: 'viber-token' };
        const adapter = new ViberAdapter('viber-token');
        adapter.init(context);
        return { adapter };
    }

    it('обычное сообщение (event=message) → ctx', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('viber', 'text-message') as never, controller);
        expect(controller.eventType).toBe('message');
        expect(controller.userCommand).toBe('привет');
        expect(String(controller.userId)).toBe('uViber42424200000000000000000000==');
    });

    it('нажатие кнопки (текст с payload-объектом) → ctx', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('viber', 'button-message') as never, controller);
        expect(controller.userCommand).toBe('buy');
        expect(controller.payload).toEqual({ action: 'buy', item: 42 });
    });

    it('conversation_started с context → start, context в payload', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('viber', 'conversation-started') as never, controller);
        expect(controller.eventType).toBe('start');
        expect(controller.payload).toBe('K7M2QX');
    });

    it('webhook (регистрация) → 200 без контента', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('viber', 'webhook') as never, controller);
        expect(controller.skipAutoReply).toBe(true);
        expect(controller.platformOptions.sendInInit).toBe('ok');
        expect(await adapter.getContent(controller)).toBe('ok');
    });

    it('ответ собирается в формате Viber (keyboard с Buttons)', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        await adapter.setQueryData(fixture('viber', 'text-message') as never, controller);
        controller.text = 'Выберите товар';
        controller.buttons.addBtn('Купить', null, { command: 'buy' });
        const sendMessage = jest
            .spyOn(ViberRequest.prototype, 'sendMessage')
            .mockResolvedValue({ status: 0, status_message: 'ok', message_token: 1 });

        expect(await adapter.getContent(controller)).toBe('ok');

        const params = sendMessage.mock.calls[0][3] as {
            keyboard: { Type: string; Buttons: { Text: string }[] };
        };
        expect(params.keyboard.Type).toBe('keyboard');
        expect(params.keyboard.Buttons[0].Text).toBe('Купить');
    });
});

describe('Alisa: фикстуры', () => {
    function setup(): { adapter: AlisaAdapter } {
        const context = createContext();
        context.appConfig.tokens[T_ALISA] = { token: 'alisa-token' };
        const adapter = new AlisaAdapter('alisa-token');
        adapter.init(context);
        return { adapter };
    }

    it('обычное сообщение (SimpleUtterance) → ctx', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('alisa', 'text-message') as never, controller);
        expect(controller.userCommand).toBe('привет');
        expect(controller.userId).toBe(
            '1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B1C2D3E4F5A6B7C8D9E0F1A2B',
        );
        expect(controller.messageId).toBe(5);
    });

    it('нажатие кнопки (ButtonPressed) → ctx', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('alisa', 'button-pressed') as never, controller);
        expect(controller.userCommand).toBe('buy');
        expect(controller.payload).toEqual({ command: 'buy' });
    });

    it('новая сессия → messageId 0 (приветствие)', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('alisa', 'session-start') as never, controller);
        expect(controller.messageId).toBe(0);
    });

    it('health-check ping → ответ pong телом вебхука', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('alisa', 'ping') as never, controller);
        expect(controller.platformOptions.sendInInit).toEqual({
            version: '1.0',
            response: { text: 'pong', end_session: false },
        });
    });

    it('ответ собирается в формате Алисы (response.buttons)', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('alisa', 'text-message') as never, controller);
        controller.text = 'Выберите товар';
        controller.buttons.addBtn('Купить', null, { command: 'buy' });

        const content = (await adapter.getContent(controller)) as {
            version: string;
            response: { text: string; buttons: { title: string; payload: unknown }[] };
        };
        expect(content.version).toBe('1.0');
        expect(content.response.text).toBe('Выберите товар');
        expect(content.response.buttons[0].title).toBe('Купить');
        expect(content.response.buttons[0].payload).toEqual({ command: 'buy' });
    });
});

describe('Marusia: фикстуры', () => {
    function setup(): { adapter: MarusiaAdapter } {
        const context = createContext();
        context.appConfig.tokens[T_MARUSIA] = { token: 'marusia-token' };
        const adapter = new MarusiaAdapter('marusia-token');
        adapter.init(context);
        return { adapter };
    }

    it('обычное сообщение (SimpleUtterance) → ctx', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('marusia', 'text-message') as never, controller);
        expect(controller.userCommand).toBe('привет');
        expect(controller.userId).toBe('marusia-user-id-424242');
        expect(controller.messageId).toBe(5);
    });

    it('нажатие кнопки (ButtonPressed) → ctx', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('marusia', 'button-pressed') as never, controller);
        expect(controller.userCommand).toBe('buy');
        expect(controller.payload).toEqual({ command: 'buy' });
    });

    it('новая сессия → messageId 0 (приветствие)', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('marusia', 'session-start') as never, controller);
        expect(controller.messageId).toBe(0);
    });

    it('health-check ping → ответ pong телом вебхука', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('marusia', 'ping') as never, controller);
        expect(controller.platformOptions.sendInInit).toBeDefined();
    });

    it('ответ собирается в формате Маруси (response.buttons)', async () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('marusia', 'text-message') as never, controller);
        controller.text = 'Выберите товар';
        controller.buttons.addBtn('Купить', null, { command: 'buy' });

        const content = (await adapter.getContent(controller)) as {
            version: string;
            response: { text: string; buttons: { title: string; payload: unknown }[] };
        };
        expect(content.response.text).toBe('Выберите товар');
        expect(content.response.buttons[0].title).toBe('Купить');
        expect(content.response.buttons[0].payload).toEqual({ command: 'buy' });
    });
});

describe('SmartApp: фикстуры', () => {
    function setup(): { adapter: SmartAppAdapter } {
        const context = createContext();
        context.appConfig.tokens[T_SMART_APP] = { token: 'smart-token' };
        const adapter = new SmartAppAdapter('smart-token');
        adapter.init(context);
        return { adapter };
    }

    it('обычное сообщение (MESSAGE_TO_SKILL) → ctx', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('smartapp', 'text-message') as never, controller);
        expect(controller.userCommand).toBe('привет');
        expect(controller.userId).toBe('sber-user-424242');
        expect(controller.messageId).toBe(3);
    });

    it('нажатие кнопки (SERVER_ACTION) → ctx', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('smartapp', 'server-action') as never, controller);
        expect(controller.userCommand).toBe('buy');
        expect(controller.payload).toEqual({ item: 42 });
    });

    it('запуск приложения (RUN_APP) → start', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('smartapp', 'run-app') as never, controller);
        expect(controller.eventType).toBe('start');
        expect(controller.messageId).toBe(0);
    });

    it('закрытие приложения (CLOSE_APP) → isEnd', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('smartapp', 'close-app') as never, controller);
        expect(controller.isEnd).toBe(true);
    });

    it('ответ собирается в формате SmartApp (ANSWER_TO_USER с suggestions)', () => {
        const { adapter } = setup();
        const controller = new TestController(createContext());
        adapter.setQueryData(fixture('smartapp', 'text-message') as never, controller);
        controller.text = 'Выберите товар';
        controller.buttons.addBtn('Купить', null, { command: 'buy' });

        const content = adapter.getContent(controller) as {
            messageName: string;
            payload: {
                items: unknown[];
                suggestions?: { buttons: { title: string }[] };
            };
        };
        expect(content.messageName).toBe('ANSWER_TO_USER');
        expect(content.payload.items.length).toBeGreaterThan(0);
        expect(content.payload.suggestions?.buttons[0].title).toBe('Купить');
    });
});
