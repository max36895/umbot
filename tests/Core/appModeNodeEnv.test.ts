/**
 * Режим по умолчанию зависит от NODE_ENV: при NODE_ENV=production — strict_prod
 * (опасные регулярные выражения отклоняются при регистрации), иначе — dev.
 * Явный setAppMode() всегда главнее.
 */
import { AppContext, Bot } from '../../src';

const noopLogger = { log: (): void => {}, error: (): void => {}, warn: (): void => {} };

describe('режим по умолчанию и NODE_ENV', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    it('NODE_ENV=production — strict_prod со строгой проверкой регулярок', () => {
        process.env.NODE_ENV = 'production';
        const ctx = new AppContext();
        expect(ctx.appMode).toBe('strict_prod');
        expect(ctx.command.strictMode).toBe(true);
    });

    it('без NODE_ENV=production — dev', () => {
        process.env.NODE_ENV = 'development';
        const ctx = new AppContext();
        expect(ctx.appMode).toBe('dev');
        expect(ctx.command.strictMode).toBe(false);
    });

    it('при NODE_ENV=production опасное выражение не регистрируется без setAppMode', () => {
        process.env.NODE_ENV = 'production';
        const bot = new Bot();
        bot.setLogger(noopLogger);
        // eslint-disable-next-line security/detect-unsafe-regex -- опасное выражение проверяется намеренно
        bot.addCommand('danger', [/(a+)+$/], (_, ctx) => {
            ctx.text = 'x';
        });
        expect(bot.getAppContext().commands.get('danger')).toBeUndefined();
    });

    it('явный setAppMode главнее NODE_ENV', () => {
        process.env.NODE_ENV = 'production';
        const bot = new Bot();
        bot.setLogger(noopLogger);
        bot.setAppMode('dev');
        expect(bot.getAppContext().appMode).toBe('dev');
        expect(bot.getAppContext().command.strictMode).toBe(false);
    });
});
