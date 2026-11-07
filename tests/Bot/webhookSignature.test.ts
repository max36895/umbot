/**
 * Тесты предупреждения при старте вебхука без проверки подписи и отклонения
 * запросов с неверной подписью.
 *
 * Подпись поддерживают Telegram (заголовок x-telegram-bot-api-secret-token),
 * VK (поле secret в теле), MAX (заголовок x-max-bot-api-secret) и Viber
 * (x-viber-content-signature, HMAC от токена). Алиса, Маруся и SmartApp подписи
 * не имеют и в предупреждение не попадают (покрыто в bot.test.ts).
 */
import { Bot } from '../../src';
import { MaxAdapter, TelegramAdapter, ViberAdapter, VkAdapter } from '../../src/plugins';

function createBotWithWarnings(): { bot: Bot; warnings: string[] } {
    const warnings: string[] = [];
    const bot = new Bot();
    bot.setLogger({
        error: () => {},
        warn: (msg: string) => warnings.push(msg),
    });
    return { bot, warnings };
}

async function startAndClose(bot: Bot, port: number): Promise<void> {
    const server = bot.start('localhost', port);
    await new Promise<void>((resolve) => {
        server!.on('listening', resolve);
        server!.on('error', resolve);
    });
    await bot.close();
}

describe('Предупреждение о вебхуке без подписи', () => {
    it('MAX без webhookSecret → warning; с секретом → молчание', async () => {
        const insecure = createBotWithWarnings();
        insecure.bot.use(new MaxAdapter('max-token'));
        await startAndClose(insecure.bot, 3110);
        const warn = insecure.warnings.find((w) => w.includes('БЕЗ проверки подписи'));
        expect(warn).toBeDefined();
        expect(warn).toContain('max_app');

        const secure = createBotWithWarnings();
        secure.bot.use(new MaxAdapter('max-token', { secret: 'max-secret' }));
        await startAndClose(secure.bot, 3111);
        expect(secure.warnings.find((w) => w.includes('БЕЗ проверки подписи'))).toBeUndefined();
    });

    it('Viber без токена → warning; с токеном подпись активна → молчание', async () => {
        const insecure = createBotWithWarnings();
        insecure.bot.use(new ViberAdapter());
        await startAndClose(insecure.bot, 3112);
        const warn = insecure.warnings.find((w) => w.includes('БЕЗ проверки подписи'));
        expect(warn).toBeDefined();
        expect(warn).toContain('viber');

        const secure = createBotWithWarnings();
        secure.bot.use(new ViberAdapter('viber-token'));
        await startAndClose(secure.bot, 3113);
        expect(secure.warnings.find((w) => w.includes('БЕЗ проверки подписи'))).toBeUndefined();
    });
});

describe('Отклонение запроса с неверной подписью', () => {
    it('Telegram: неверный x-telegram-bot-api-secret-token → 401, верный → обработка', async () => {
        const { bot } = createBotWithWarnings();
        bot.getAppContext().setAppConfig({
            tokens: { telegram: { webhookSecret: 'tg-secret' } },
        });
        bot.use(new TelegramAdapter('tg-token'));

        const update = JSON.stringify({
            update_id: 1,
            message: {
                message_id: 1,
                from: { id: 42 },
                chat: { id: 42, type: 'private' },
                date: 1,
                text: 'привет',
            },
        });
        const rejected = await bot.webhookEvent(update, {
            'x-telegram-bot-api-secret-token': 'wrong',
        });
        expect(rejected.statusCode).toBe(401);

        const accepted = await bot.webhookEvent(update, {
            'x-telegram-bot-api-secret-token': 'tg-secret',
        });
        expect(accepted.statusCode).not.toBe(401);
    });

    it('VK: неверный secret в теле → 401', async () => {
        const { bot } = createBotWithWarnings();
        bot.getAppContext().setAppConfig({
            tokens: { vk: { secret_key: 'vk-secret' } },
        });
        bot.use(new VkAdapter('vk-token'));

        const event = JSON.stringify({
            type: 'message_new',
            group_id: 1,
            secret: 'wrong',
            object: { message: { from_id: 42, text: 'привет' } },
        });
        const rejected = await bot.webhookEvent(event, {});
        expect(rejected.statusCode).toBe(401);
    });

    it('MAX: неверный x-max-bot-api-secret → 401', async () => {
        const { bot } = createBotWithWarnings();
        bot.use(new MaxAdapter('max-token', { secret: 'max-secret' }));

        const update = JSON.stringify({ update_type: 'message_created', timestamp: 1 });
        const rejected = await bot.webhookEvent(update, {
            'x-max-bot-api-secret': 'wrong',
        });
        expect(rejected.statusCode).toBe(401);
    });
});
