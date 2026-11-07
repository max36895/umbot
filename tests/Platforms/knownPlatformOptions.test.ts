/**
 * Тесты предупреждения о неизвестных опциях адаптеров платформ.
 *
 * Опции адаптера (`new TelegramAdapter(token, { ... })`) — строковые ключи:
 * опечатка молча игнорируется. При подключении (`init` через `bot.use()`)
 * неизвестный ключ должен дать warning с подсказкой, известный — молчание.
 */
import { AppContext } from '../../src';
import { TelegramAdapter, VkAdapter, AlisaAdapter } from '../../src/plugins';

interface IWarnLog {
    warn: jest.Mock;
    context: AppContext;
}

function createContext(): IWarnLog {
    const context = new AppContext();
    const warn = jest.fn();
    context.setLogger({ log: () => {}, error: () => {}, warn });
    return { warn, context };
}

describe('BasePlatform: предупреждение о неизвестных опциях адаптера', () => {
    it('ключ с опечаткой → warning с подсказкой', () => {
        const { warn, context } = createContext();
        new TelegramAdapter('token', { telegram_webhook_repl: true } as never).init(context);
        expect(warn).toHaveBeenCalledTimes(1);
        const message = warn.mock.calls[0][0] as string;
        expect(message).toContain('telegram_webhook_repl');
        expect(message).toContain('telegram_webhook_reply');
    });

    it('известные ключи (платформенные и общие) → молчание', () => {
        const { warn, context } = createContext();
        new TelegramAdapter('token', {
            telegram_webhook_reply: true,
            telegram_parse_mode: 'HTML',
            send_rate_limit: 20,
        } as never).init(context);
        expect(warn).not.toHaveBeenCalled();
    });

    it('неизвестный ключ у другого адаптера → warning', () => {
        const { warn, context } = createContext();
        new VkAdapter('token', { vk_secret: 'x' } as never).init(context);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0] as string).toContain('vk_secret');
    });

    it('адаптер без опций: любой ключ → warning, без опций — молчание', () => {
        const withOption = createContext();
        new AlisaAdapter('token', { alisa_unknown: true } as never).init(withOption.context);
        expect(withOption.warn).toHaveBeenCalledTimes(1);

        const withoutOptions = createContext();
        new AlisaAdapter('token').init(withoutOptions.context);
        expect(withoutOptions.warn).not.toHaveBeenCalled();
    });
});
