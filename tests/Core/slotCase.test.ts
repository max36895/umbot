/**
 * Строковый слот с заглавными буквами никогда не совпадёт: реплика сравнивается в нижнем регистре.
 * addCommand предупреждает о таком слоте и не меняет его — поиск команд остаётся прежним.
 */
import { Bot, BaseBotController } from '../../src';
import { AlisaAdapter, T_ALISA } from '../../src/plugins';

function makeBot(warn: jest.Mock): Bot {
    const bot = new Bot();
    bot.setLogger({ log: () => {}, error: () => {}, warn });
    bot.initBotController(BaseBotController);
    bot.use(new AlisaAdapter());
    return bot;
}

async function answer(bot: Bot, text: string): Promise<string> {
    const res = (await bot.run(
        T_ALISA,
        JSON.stringify({
            meta: { locale: 'ru-RU', timezone: 'UTC', client_id: 'test', interfaces: {} },
            session: { message_id: 1, session_id: 's', skill_id: 'k', user_id: 'u1', new: false },
            request: { command: text, original_utterance: text, type: 'SimpleUtterance' },
            version: '1.0',
        }),
    )) as { response?: { text?: string } };
    return res.response?.text ?? '';
}

describe('addCommand: слоты с заглавными буквами', () => {
    it('предупреждает и подсказывает слот строчными', async () => {
        const warn = jest.fn();
        const bot = makeBot(warn);
        bot.addCommand('faq', ['FAQ', 'вопросы', 'Помощь'], () => 'ok');

        const messages = warn.mock.calls.map((call) => String(call[0]));
        const message = messages.find((m) => m.includes('заглавные'));
        expect(message).toContain('"FAQ", "Помощь"');
        expect(message).toContain('"faq", "помощь"');
        await bot.close();
    });

    it('слоты строчными, регулярки и isPattern не вызывают предупреждения', async () => {
        const warn = jest.fn();
        const bot = makeBot(warn);
        bot.addCommand('a', ['faq', 'вопросы'], () => 'ok');
        bot.addCommand('b', [/FAQ/i], () => 'ok');
        bot.addCommand('c', ['^FAQ$'], () => 'ok', true);

        expect(warn.mock.calls.some((call) => String(call[0]).includes('заглавные'))).toBe(false);
        await bot.close();
    });

    it('поиск не меняется: слот с заглавной не срабатывает, строчный — срабатывает', async () => {
        const bot = makeBot(jest.fn());
        bot.addCommand('upper', ['FAQ'], () => 'upper');
        bot.addCommand('lower', ['faq'], () => 'lower');

        expect(await answer(bot, 'faq')).toBe('lower');
        await bot.close();
    });
});
