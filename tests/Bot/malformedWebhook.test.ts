/**
 * Регрессионные тесты устойчивости вебхук-конвейера к мусорному вводу.
 *
 * Все точки JSON.parse на пути запроса защищены (Bot.#parseContent, webhookHandle,
 * webhookEvent, tryParse/normalizeActionPayload для payload кнопок, isCorrectQuery у VK).
 * Тест фиксирует контракт: битое тело или битые поля апдейта не дают HTTP 5xx —
 * на 5xx платформы ретраят доставку бесконечно.
 */
import { Bot, BotController, IPlatformAdapter } from '../../src';
import {
    AlisaAdapter,
    MarusiaAdapter,
    MaxAdapter,
    SmartAppAdapter,
    TelegramAdapter,
    ViberAdapter,
    VkAdapter,
} from '../../src/plugins';

class SilentController extends BotController {
    action(): void {
        this.skipAutoReply = true;
    }
}

function createBot(): Bot {
    const bot = new Bot();
    bot.setLogger({ error: () => {}, warn: () => {} });
    bot.setAppConfig({ isLocalStorage: true });
    bot.initBotController(SilentController);
    return bot;
}

describe('Мусорное тело вебхука', () => {
    const adapters: [string, () => IPlatformAdapter][] = [
        ['Telegram', (): TelegramAdapter => new TelegramAdapter('tg-token')],
        ['VK', (): VkAdapter => new VkAdapter('vk-token')],
        ['MAX', (): MaxAdapter => new MaxAdapter('max-token')],
        ['Viber', (): ViberAdapter => new ViberAdapter('viber-token')],
        ['Alisa', (): AlisaAdapter => new AlisaAdapter()],
        ['Marusia', (): MarusiaAdapter => new MarusiaAdapter()],
        ['SmartApp', (): SmartAppAdapter => new SmartAppAdapter()],
    ];
    it.each(adapters)('%s: битый JSON в теле → 400, не 5xx', async (_name, makeAdapter) => {
        const bot = createBot();
        bot.use(makeAdapter());
        const result = await bot.webhookEvent('это не json {{{', {});
        expect(result.statusCode).toBe(400);
    });

    it('валидный JSON неизвестной формы → 400/404, не 5xx', async () => {
        const bot = createBot();
        bot.use(new TelegramAdapter('tg-token'));
        const result = await bot.webhookEvent(JSON.stringify({ unknown: 'shape' }), {});
        expect(result.statusCode).toBeLessThan(500);
    });

    it('JSON-скаляр вместо объекта → не 5xx', async () => {
        const bot = createBot();
        bot.use(new TelegramAdapter('tg-token'));
        const result = await bot.webhookEvent(JSON.stringify([1, 2, 3]), {});
        expect(result.statusCode).toBeLessThan(500);
    });
});

describe('Битый JSON в payload-полях апдейта', () => {
    const expectNot5xx = async (bot: Bot, update: unknown): Promise<void> => {
        const result = await bot.webhookEvent(JSON.stringify(update), {});
        expect(result.statusCode).toBeLessThan(500);
    };

    it('Telegram: callback_query с битым data', async () => {
        const bot = createBot();
        bot.use(new TelegramAdapter('tg-token'));
        await expectNot5xx(bot, {
            update_id: 1,
            callback_query: {
                id: 'cb-1',
                from: { id: 42 },
                message: { message_id: 1, chat: { id: 42, type: 'private' }, date: 1 },
                data: '{битый json',
            },
        });
    });

    it('VK: message_new с битым payload', async () => {
        const bot = createBot();
        bot.use(new VkAdapter('vk-token'));
        await expectNot5xx(bot, {
            type: 'message_new',
            group_id: 1,
            object: { message: { from_id: 42, text: 'привет', payload: '{битый json' } },
        });
    });

    it('MAX: message_callback с битым payload', async () => {
        const bot = createBot();
        bot.use(new MaxAdapter('max-token'));
        await expectNot5xx(bot, {
            update_type: 'message_callback',
            timestamp: 1,
            callback: { callback_id: 'cb-1', payload: '{битый json', user: { user_id: 42 } },
        });
    });

    it('Alisa: запрос с битым request.payload', async () => {
        const bot = createBot();
        bot.use(new AlisaAdapter());
        await expectNot5xx(bot, {
            meta: { client_id: 'yandex.searchplugin' },
            request: { command: 'привет', original_utterance: 'привет', payload: '{битый json' },
            session: {
                message_id: 1,
                session_id: 's-1',
                skill_id: 'SKILL',
                application: { application_id: 'APP-ID' },
            },
            version: '1.0',
        });
    });

    it('Marusia: запрос с битым request.payload', async () => {
        const bot = createBot();
        bot.use(new MarusiaAdapter());
        await expectNot5xx(bot, {
            request: { command: 'привет', original_utterance: 'привет', payload: '{битый json' },
            session: {
                message_id: 1,
                session_id: 's-1',
                skill_id: 'skill',
                application: { application_id: 'app-id' },
            },
            version: '1.1',
        });
    });

    it('Viber: message с битым tracking_data', async () => {
        const bot = createBot();
        bot.use(new ViberAdapter('viber-token'));
        await expectNot5xx(bot, {
            event: 'message',
            timestamp: 1,
            message_token: 1,
            sender: { id: 'u-1' },
            message: { type: 'text', text: 'привет', tracking_data: '{битый json' },
        });
    });
});
