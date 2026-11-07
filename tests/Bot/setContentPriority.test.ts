/**
 * Контракт приоритета содержимого запроса: `setContent()` — инструмент для
 * консольного теста (BotTest) и подменяет содержимое только когда запрос вызван
 * без явного content. Реальный payload вебхука всегда приоритетнее: значение
 * setContent(), переживая запросы, не должно подменять последующие запросы.
 */
import { Bot, BotController } from '../../src';
import { AlisaAdapter, T_ALISA } from '../../src/plugins';

class EchoController extends BotController {
    action(): void {
        // userId в ответе — дискриминатор того, чей payload обработан: без него
        // тест приоритета не отличил бы обработку victim-запроса от attacker-запроса
        this.text = this.userId ?? 'нет-id';
        this.skipAutoReply = true;
    }
}

function createBot(): Bot {
    const bot = new Bot();
    bot.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
    bot.use(new AlisaAdapter());
    bot.setAppConfig({ isLocalStorage: true });
    bot.initBotController(EchoController);
    return bot;
}

function alisaRequest(userId: string): string {
    return JSON.stringify({
        meta: { client_id: 'c', locale: 'ru-RU' },
        request: { type: 'SimpleUtterance', command: 'тест', original_utterance: 'тест' },
        session: { message_id: 1, session_id: 's', skill_id: 'sk', user_id: userId, new: true },
        version: '1.0',
    });
}

const readText = async (bot: Bot, result: unknown): Promise<string> => {
    // Ответ голосовой платформы: текст контроллера уходит в response.text
    return (result as { response?: { text?: string } }).response?.text ?? '';
};

describe('setContent: приоритет содержимого запроса', () => {
    it('run() без content использует содержимое setContent() — сценарий BotTest', async () => {
        const bot = createBot();
        bot.setContent(
            JSON.stringify({
                meta: { client_id: 'c', locale: 'ru-RU' },
                request: { type: 'SimpleUtterance', command: 'тест' },
                session: {
                    message_id: 1,
                    session_id: 's',
                    skill_id: 'sk',
                    user_id: 'u1',
                    new: true,
                },
                version: '1.0',
            }),
        );
        const result = await bot.run(T_ALISA);
        expect(await readText(bot, result)).toBe('u1');
        await bot.close();
    });

    it('явный content приоритетнее setContent(): подменённый payload не доходит', async () => {
        const bot = createBot();
        bot.setContent(alisaRequest('victim'));
        // Запрос от другого пользователя с явным содержимым: раньше обработался бы
        // содержимым setContent() — ответ ушёл бы с userId жертвы
        const result = await bot.run(T_ALISA, alisaRequest('attacker'));
        expect(await readText(bot, result)).toBe('attacker');
        await bot.close();
    });

    it('после запроса с явным content следующий run() без content снова читает setContent()', async () => {
        const bot = createBot();
        bot.setContent(alisaRequest('u1'));
        await bot.run(T_ALISA, alisaRequest('u2'));
        const result = await bot.run(T_ALISA);
        expect(await readText(bot, result)).toBe('u1');
        await bot.close();
    });
});
