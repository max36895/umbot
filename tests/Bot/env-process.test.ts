import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Bot } from '../../src';

/**
 * Проверяем сценарий `docker run -e TELEGRAM_TOKEN=...`:
 * токены из process.env должны подхватываться даже без `setAppConfig({ env })`.
 */
describe('AppContext: токены из process.env без настроенного env', () => {
    const ENV_KEYS = [
        'VIBER_TOKEN',
        'TELEGRAM_TOKEN',
        'VK_TOKEN',
        'MAX_TOKEN',
        'VK_CONFIRMATION_TOKEN',
        'VK_SECRET_KEY',
        'MARUSIA_TOKEN',
        'ALISA_TOKEN',
        'YANDEX_TOKEN',
        'SPEECH_KIT_TOKEN',
        'TELEGRAM_WEBHOOK_SECRET',
        'MAX_WEBHOOK_SECRET',
        'DB_HOST',
        'DB_USER',
        'DB_PASSWORD',
        'DB_NAME',
    ];
    const savedEnv: Record<string, string | undefined> = {};

    beforeAll(() => {
        ENV_KEYS.forEach((key) => {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        });
    });

    afterAll(() => {
        ENV_KEYS.forEach((key) => {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        });
    });

    const createBot = (): Bot => {
        const bot = new Bot();
        bot.setLogger({ error: () => {}, warn: () => {} });
        return bot;
    };

    it('setAppConfig без env подтягивает токены из process.env', () => {
        process.env.TELEGRAM_TOKEN = 'docker-token';
        process.env.SPEECH_KIT_TOKEN = 'docker-speechkit';
        const bot = createBot();
        bot.setAppConfig({ isLocalStorage: true });
        const tokens = bot.getAppContext().appConfig.tokens;
        expect(tokens.telegram?.token).toBe('docker-token');
        expect(tokens.telegram?.speech_kit_token).toBe('docker-speechkit');
        expect(tokens.vk?.speech_kit_token).toBe('docker-speechkit');
        expect(tokens.max_app?.speech_kit_token).toBe('docker-speechkit');
        delete process.env.TELEGRAM_TOKEN;
        delete process.env.SPEECH_KIT_TOKEN;
    });

    it('не перезаписывает токены, заданные явно через setAppConfig', () => {
        process.env.TELEGRAM_TOKEN = 'env-token';
        const bot = createBot();
        bot.setAppConfig({ tokens: { telegram: { token: 'explicit-token' } } });
        expect(bot.getAppContext().appConfig.tokens.telegram?.token).toBe('explicit-token');
        delete process.env.TELEGRAM_TOKEN;
    });

    it('явный env: "local" по-прежнему перезаписывает заданные токены', () => {
        process.env.TELEGRAM_TOKEN = 'env-token';
        const bot = createBot();
        bot.setAppConfig({
            tokens: { telegram: { token: 'explicit-token' } },
            env: 'local',
        });
        expect(bot.getAppContext().appConfig.tokens.telegram?.token).toBe('env-token');
        delete process.env.TELEGRAM_TOKEN;
    });

    it('без переменных в process.env токены остаются пустыми и ошибка не логируется', () => {
        const error = jest.fn();
        const bot = new Bot();
        bot.setLogger({ error, warn: () => {} });
        bot.setAppConfig({ isLocalStorage: true });
        expect(bot.getAppContext().appConfig.tokens).toEqual({});
        expect(error).not.toHaveBeenCalled();
    });

    it('setPlatformParams не перезаписывает явно заданные токены при тихом подхвате', () => {
        // Регрессия: setPlatformParams вызывал #setTokens(overwrite=true) и затирал
        // токен, заданный разработчиком, значением из process.env.
        process.env.TELEGRAM_TOKEN = 'env-token';
        const bot = createBot();
        bot.setAppConfig({ tokens: { telegram: { token: 'explicit-token' } } });
        bot.setPlatformParams({ welcome_text: 'Привет' });
        expect(bot.getAppContext().appConfig.tokens.telegram?.token).toBe('explicit-token');
        delete process.env.TELEGRAM_TOKEN;
    });

    it('setPlatformParams с явным env сохраняет поведение перезаписи', () => {
        process.env.TELEGRAM_TOKEN = 'env-token';
        const bot = createBot();
        bot.setAppConfig({
            tokens: { telegram: { token: 'explicit-token' } },
            env: 'local',
        });
        bot.setPlatformParams({ welcome_text: 'Привет' });
        expect(bot.getAppContext().appConfig.tokens.telegram?.token).toBe('env-token');
        delete process.env.TELEGRAM_TOKEN;
    });

    it('явно указанный env-файл читается даже после тихого подхвата process.env', () => {
        // Регрессия: кэш от тихого чтения process.env прятал env-файл,
        // настроенный позже через setAppConfig({ env }).
        process.env.TELEGRAM_TOKEN = 'env-token';
        const envPath = path.join(os.tmpdir(), `umbot-env-test-${Date.now()}.env`);
        fs.writeFileSync(envPath, 'TELEGRAM_TOKEN=file-token\n', 'utf8');
        try {
            const bot = createBot();
            bot.setAppConfig({ isLocalStorage: true });
            expect(bot.getAppContext().appConfig.tokens.telegram?.token).toBe('env-token');
            bot.setAppConfig({ env: envPath });
            expect(bot.getAppContext().appConfig.tokens.telegram?.token).toBe('file-token');
        } finally {
            fs.unlinkSync(envPath);
            delete process.env.TELEGRAM_TOKEN;
        }
    });
});
