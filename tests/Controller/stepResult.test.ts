/**
 * Регресс: результат обработчика шага.
 *
 * 1. Строка из шага (так пишут по аналогии с addCommand) принималась за промис:
 *    `res.then` падал вне try, вебхук отвечал 500, Telegram повторял апдейт
 *    бесконечно. Теперь строка — текст ответа, как у команд.
 * 2. Если шагу соответствовало несколько NLU-интентов, выбирался последний
 *    совпавший шаг; теперь — первый.
 */
import { Bot, BaseBotController, T_ALISA } from '../../src';
import { AlisaAdapter, IAlisaWebhookResponse } from '../../src/plugins';

const request = (intents?: Record<string, unknown>, stateStep?: string): string =>
    JSON.stringify({
        meta: {
            locale: 'ru-RU',
            timezone: 'UTC',
            client_id: 'yandex.searchplugin',
            interfaces: {},
        },
        session: { message_id: 3, session_id: 's', skill_id: 'k', user_id: 'u', new: false },
        request: {
            command: 'иван',
            original_utterance: 'Иван',
            type: 'SimpleUtterance',
            ...(intents ? { nlu: { tokens: ['иван'], entities: [], intents } } : {}),
        },
        state: { session: stateStep ? { oldIntentName: stateStep } : {} },
        version: '1.0',
    });

function makeBot(): Bot {
    const bot = new Bot();
    bot.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
    bot.setAppConfig({ isLocalStorage: true });
    bot.use(new AlisaAdapter()).initBotController(BaseBotController);
    return bot;
}

describe('BotController: результат шага', () => {
    it('строка из синхронного шага становится текстом ответа', async () => {
        const bot = makeBot();
        bot.addStep('ask_name', (ctx) => `Привет, ${ctx.originalUserCommand}!`);
        const res = (await bot.run(
            T_ALISA,
            request(undefined, 'ask_name'),
        )) as IAlisaWebhookResponse;
        expect(res.response?.text).toBe('Привет, Иван!');
    });

    it('строка из асинхронного шага становится текстом ответа', async () => {
        const bot = makeBot();
        bot.addStep('ask_name', async () => 'async ok');
        const res = (await bot.run(
            T_ALISA,
            request(undefined, 'ask_name'),
        )) as IAlisaWebhookResponse;
        expect(res.response?.text).toBe('async ok');
    });

    it('из нескольких NLU-интентов берётся первый шаг', async () => {
        const bot = makeBot();
        bot.addStep('first', (ctx) => {
            ctx.text = 'first';
        });
        bot.addStep('second', (ctx) => {
            ctx.text = 'second';
        });
        const res = (await bot.run(
            T_ALISA,
            request({ first: { slots: {} }, second: { slots: {} } }),
        )) as IAlisaWebhookResponse;
        expect(res.response?.text).toBe('first');
    });
});
