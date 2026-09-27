import * as fs from 'fs';
import * as path from 'path';
import { createTestDir, removeTestDir } from '../helpers/tmpDir';

const { setupWebhook } = require('../../cli/controllers/WebhookController.js') as {
    setupWebhook: (options: {
        platform: string;
        url: string;
        envPath?: string;
        fetchImpl?: jest.Mock;
    }) => Promise<{ secretCreated: boolean }>;
};

const TG_TOKEN = '123456:telegram-secret-token-value';

function jsonResponse(body: unknown, status = 200): Record<string, unknown> {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('umbot webhook', () => {
    let dir: string;
    let envPath: string;
    // Токены и секреты из окружения машины подменили бы значения из тестового .env
    const ENV_KEYS = [
        'TELEGRAM_TOKEN',
        'MAX_TOKEN',
        'TELEGRAM_WEBHOOK_SECRET',
        'MAX_WEBHOOK_SECRET',
    ];
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
        dir = createTestDir('cli-webhook');
        envPath = path.join(dir, '.env');
        for (const key of ENV_KEYS) {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterEach(async () => {
        for (const key of ENV_KEYS) {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        }
        await removeTestDir(dir);
    });

    it('Telegram: генерирует секрет, регистрирует вебхук с ним и сохраняет в .env', async () => {
        fs.writeFileSync(envPath, `TELEGRAM_TOKEN=${TG_TOKEN}\n`);
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ ok: true, result: true }));

        const result = await setupWebhook({
            platform: 'telegram',
            url: 'https://bot.example.com/',
            envPath,
            fetchImpl,
        });

        expect(result.secretCreated).toBe(true);
        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`https://api.telegram.org/bot${TG_TOKEN}/setWebhook`);
        expect(init.signal).toBeInstanceOf(AbortSignal);
        const body = JSON.parse(String(init.body)) as { url: string; secret_token: string };
        expect(body.url).toBe('https://bot.example.com/');
        // Формат секрета Telegram: 1–256 символов A-Za-z0-9_-
        expect(body.secret_token).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
        const env = fs.readFileSync(envPath, 'utf8');
        expect(env).toContain(`TELEGRAM_TOKEN=${TG_TOKEN}`);
        expect(env).toContain(`TELEGRAM_WEBHOOK_SECRET=${body.secret_token}`);
    });

    it('MAX: секрет уходит в POST /subscriptions, токен — в заголовке Authorization', async () => {
        fs.writeFileSync(envPath, 'MAX_TOKEN=max-token\n');
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ success: true }));

        await setupWebhook({
            platform: 'max',
            url: 'https://bot.example.com/max',
            envPath,
            fetchImpl,
        });

        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://platform-api2.max.ru/subscriptions');
        expect((init.headers as Record<string, string>).Authorization).toBe('max-token');
        const body = JSON.parse(String(init.body)) as { secret: string };
        // Формат секрета MAX: ^[a-zA-Z0-9_-]{5,256}$
        expect(body.secret).toMatch(/^[a-zA-Z0-9_-]{5,256}$/);
        expect(fs.readFileSync(envPath, 'utf8')).toContain(`MAX_WEBHOOK_SECRET=${body.secret}`);
    });

    it('существующий секрет переиспользуется, .env не переписывается', async () => {
        const original = `TELEGRAM_TOKEN=${TG_TOKEN}\nTELEGRAM_WEBHOOK_SECRET=keep-me\n`;
        fs.writeFileSync(envPath, original);
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));

        const result = await setupWebhook({
            platform: 'telegram',
            url: 'https://bot.example.com/',
            envPath,
            fetchImpl,
        });

        expect(result.secretCreated).toBe(false);
        const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
        expect(body.secret_token).toBe('keep-me');
        expect(fs.readFileSync(envPath, 'utf8')).toBe(original);
    });

    it('.env с переводами строк CRLF сохраняет их при дописывании секрета', async () => {
        fs.writeFileSync(envPath, `# Токены\r\nTELEGRAM_TOKEN=${TG_TOKEN}\r\n`);
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));

        await setupWebhook({
            platform: 'telegram',
            url: 'https://bot.example.com/',
            envPath,
            fetchImpl,
        });

        const content = fs.readFileSync(envPath, 'utf8');
        expect(content).toMatch(
            /^# Токены\r\nTELEGRAM_TOKEN=.+\r\nTELEGRAM_WEBHOOK_SECRET=[A-Za-z0-9_-]{43}\r\n$/,
        );
    });

    it('отказ платформы — ошибка, секрет в .env не пишется (иначе бот отклонял бы вебхук)', async () => {
        const original = `TELEGRAM_TOKEN=${TG_TOKEN}\n`;
        fs.writeFileSync(envPath, original);
        const fetchImpl = jest
            .fn()
            .mockResolvedValue(jsonResponse({ ok: false, description: 'bad webhook' }, 400));

        await expect(
            setupWebhook({
                platform: 'telegram',
                url: 'https://bot.example.com/',
                envPath,
                fetchImpl,
            }),
        ).rejects.toThrow('bad webhook');
        expect(fs.readFileSync(envPath, 'utf8')).toBe(original);
    });

    it('токен не попадает в текст ошибки сети', async () => {
        fs.writeFileSync(envPath, `TELEGRAM_TOKEN=${TG_TOKEN}\n`);
        const fetchImpl = jest.fn().mockRejectedValue(new Error('fetch failed'));

        await expect(
            setupWebhook({
                platform: 'telegram',
                url: 'https://bot.example.com/',
                envPath,
                fetchImpl,
            }),
        ).rejects.toThrow(
            expect.objectContaining({ message: expect.not.stringContaining(TG_TOKEN) }),
        );
    });

    it('отклоняет http-адрес, порт не 443 у MAX, отсутствие токена и неизвестную платформу', async () => {
        fs.writeFileSync(envPath, 'MAX_TOKEN=max-token\n');
        const fetchImpl = jest.fn();

        await expect(
            setupWebhook({
                platform: 'telegram',
                url: 'http://bot.example.com/',
                envPath,
                fetchImpl,
            }),
        ).rejects.toThrow('HTTPS');
        await expect(
            setupWebhook({
                platform: 'max',
                url: 'https://bot.example.com:8443/',
                envPath,
                fetchImpl,
            }),
        ).rejects.toThrow('443');
        await expect(
            setupWebhook({
                platform: 'telegram',
                url: 'https://bot.example.com/',
                envPath,
                fetchImpl,
            }),
        ).rejects.toThrow('TELEGRAM_TOKEN');
        await expect(
            setupWebhook({ platform: 'vk', url: 'https://bot.example.com/', envPath, fetchImpl }),
        ).rejects.toThrow('VK_SECRET_KEY');
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
