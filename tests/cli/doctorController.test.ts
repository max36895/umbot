import * as fs from 'fs';
import * as path from 'path';
import { createTestDir, removeTestDir } from '../helpers/tmpDir';

const { runDoctor, satisfiesMinVersion } = require('../../cli/controllers/DoctorController.js') as {
    satisfiesMinVersion: (version: string, requirement: string) => boolean;
    runDoctor: (options: {
        cwd?: string;
        envPath?: string;
        offline?: boolean;
        fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
        print?: (line: string) => void;
    }) => Promise<{ errors: number; warnings: number }>;
};

const TG_TOKEN = '123456:telegram-secret-token-value';

// Токены из окружения машины подменили бы значения тестового .env
const ENV_KEYS = [
    'TELEGRAM_TOKEN',
    'TELEGRAM_WEBHOOK_SECRET',
    'MAX_TOKEN',
    'MAX_WEBHOOK_SECRET',
    'VK_TOKEN',
    'VK_SECRET_KEY',
    'VK_CONFIRMATION_TOKEN',
    'VIBER_TOKEN',
    'ALISA_TOKEN',
    'SMARTAPP_TOKEN',
    'MARUSIA_TOKEN',
];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
}

describe('umbot doctor', () => {
    let dir: string;
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
        dir = createTestDir('cli-doctor');
        for (const key of ENV_KEYS) {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterEach(() => {
        removeTestDir(dir);
        for (const key of ENV_KEYS) {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        }
    });

    async function doctor(
        env: string,
        fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async () => json({}),
        options: { gitignore?: string; offline?: boolean } = {},
    ): Promise<{ output: string; result: { errors: number; warnings: number } }> {
        fs.writeFileSync(path.join(dir, '.env'), env);
        fs.writeFileSync(path.join(dir, '.gitignore'), options.gitignore ?? 'node_modules\n.env\n');
        const lines: string[] = [];
        const result = await runDoctor({
            cwd: dir,
            offline: options.offline,
            fetchImpl,
            print: (line) => lines.push(line),
        });
        return { output: lines.join('\n'), result };
    }

    it('проверяет токен и вебхук Telegram, не выводя токен', async () => {
        const urls: string[] = [];
        const { output, result } = await doctor(`TELEGRAM_TOKEN=${TG_TOKEN}\n`, async (url) => {
            urls.push(url);
            if (url.endsWith('/getMe')) {
                return json({ ok: true, result: { username: 'my_bot' } });
            }
            return json({
                ok: true,
                result: {
                    url: 'https://bot.example.com/hook',
                    pending_update_count: 3,
                    last_error_message: 'Wrong response from the webhook: 502 Bad Gateway',
                    last_error_date: 1_700_000_000,
                },
            });
        });

        expect(urls).toEqual([
            `https://api.telegram.org/bot${TG_TOKEN}/getMe`,
            `https://api.telegram.org/bot${TG_TOKEN}/getWebhookInfo`,
        ]);
        expect(output).toContain('✓ токен рабочий (@my_bot)');
        expect(output).toContain('✓ вебхук: https://bot.example.com/hook');
        expect(output).toContain('ждут доставки обновлений: 3');
        expect(output).toContain('502 Bad Gateway');
        expect(output).toContain('TELEGRAM_WEBHOOK_SECRET не задан');
        expect(output).not.toContain(TG_TOKEN);
        expect(result.errors).toBe(0);
    });

    it('без вебхука Telegram подсказывает polling', async () => {
        const { output } = await doctor(
            `TELEGRAM_TOKEN=${TG_TOKEN}\nTELEGRAM_WEBHOOK_SECRET=s\n`,
            async (url) =>
                json(
                    url.endsWith('/getMe')
                        ? { ok: true, result: { username: 'b' } }
                        : { ok: true, result: { url: '' } },
                ),
        );
        expect(output).toContain('bot.startPolling()');
    });

    it('неверный токен — ошибка и ненулевой итог', async () => {
        const { output, result } = await doctor(`TELEGRAM_TOKEN=${TG_TOKEN}\n`, async () =>
            json({ ok: false, description: 'Unauthorized' }, 401),
        );
        expect(output).toContain('✗ токен не принят: HTTP 401: Unauthorized');
        expect(result.errors).toBe(1);
    });

    it('сетевая ошибка не роняет проверку остальных платформ', async () => {
        const { output, result } = await doctor(
            `TELEGRAM_TOKEN=${TG_TOKEN}\nALISA_TOKEN=y0_alisa\n`,
            async (url) => {
                if (url.includes('telegram')) {
                    throw new Error('getaddrinfo ENOTFOUND');
                }
                return json({
                    images: { quota: { total: 104857600, used: 1048576 } },
                    sounds: { quota: { total: 1073741824, used: 0 } },
                });
            },
        );
        expect(output).toContain('ENOTFOUND');
        expect(output).toContain('картинки: 1 МБ из 100 МБ');
        expect(result.errors).toBe(1);
    });

    it('MAX: имя бота, подписки и отсутствие секрета', async () => {
        const headers: unknown[] = [];
        const { output } = await doctor('MAX_TOKEN=max-token\n', async (url, init) => {
            headers.push(init?.headers);
            return url.endsWith('/me')
                ? json({ user_id: 1, first_name: 'Бот', username: 'max_bot' })
                : json({ subscriptions: [{ url: 'https://bot.example.com/max' }] });
        });
        expect(headers[0]).toEqual({ Authorization: 'max-token' });
        expect(output).toContain('токен рабочий (@max_bot)');
        expect(output).toContain('вебхук: https://bot.example.com/max');
        expect(output).toContain('MAX_WEBHOOK_SECRET не задан');
    });

    it('VK: сообщество и незаданные секреты Callback API', async () => {
        const { output } = await doctor('VK_TOKEN=vk-token\n', async () =>
            json({ response: { groups: [{ id: 1, name: 'Мой паблик' }], profiles: [] } }),
        );
        expect(output).toContain('сообщество «Мой паблик»');
        expect(output).toContain('VK_SECRET_KEY не задан');
        expect(output).toContain('VK_CONFIRMATION_TOKEN не задан');
    });

    it('Viber: адрес вебхука', async () => {
        const { output } = await doctor('VIBER_TOKEN=viber-token\n', async () =>
            json({ status: 0, name: 'Viber Bot', webhook: 'https://bot.example.com/viber' }),
        );
        expect(output).toContain('токен рабочий (Viber Bot)');
        expect(output).toContain('вебхук: https://bot.example.com/viber');
    });

    it('.env вне .gitignore — ошибка', async () => {
        const { output, result } = await doctor('', undefined, { gitignore: 'node_modules\n' });
        expect(output).toContain('.env не указан в .gitignore');
        expect(result.errors).toBe(1);
    });

    it('--offline не обращается к API', async () => {
        const fetchImpl = jest.fn();
        const { output } = await doctor(`TELEGRAM_TOKEN=${TG_TOKEN}\n`, fetchImpl, {
            offline: true,
        });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(output).toContain('проверка по API пропущена');
    });

    it('читает .env как фреймворк: комментарий после токена не входит в значение', async () => {
        const urls: string[] = [];
        await doctor(`TELEGRAM_TOKEN=${TG_TOKEN} # тестовый бот\n`, async (url) => {
            urls.push(url);
            return json({ ok: true, result: { username: 'b', url: '' } });
        });
        expect(urls[0]).toBe(`https://api.telegram.org/bot${TG_TOKEN}/getMe`);
    });

    it('понимает устаревшее имя токена Алисы YANDEX_TOKEN', async () => {
        const { output } = await doctor('YANDEX_TOKEN=y0_legacy\n', async () =>
            json({
                images: { quota: { total: 1, used: 0 } },
                sounds: { quota: { total: 1, used: 0 } },
            }),
        );
        expect(output).toContain('Алиса (ALISA_TOKEN)');
        expect(output).toContain('токен рабочий');
    });

    it('не выводит токен, даже если он попал в текст ошибки', async () => {
        const { output } = await doctor(`TELEGRAM_TOKEN=${TG_TOKEN}\n`, async (url) => {
            throw new TypeError(`Failed to parse URL from ${url}`);
        });
        expect(output).toContain('Failed to parse URL');
        expect(output).not.toContain(TG_TOKEN);
    });

    it('без токенов предупреждает, что заполнять .env', async () => {
        const { output, result } = await doctor('TELEGRAM_TOKEN=\n');
        expect(output).toContain('не задан ни один токен');
        expect(result.warnings).toBeGreaterThan(0);
    });
});

describe('satisfiesMinVersion', () => {
    it.each([
        ['20.19.0', '>=20.19.0', true],
        ['22.1.0', '>=20.19.0', true],
        ['20.18.9', '>=20.19.0', false],
        ['18.20.0', '>=20', false],
        ['20.0.0', '>=20', true],
        ['20.19.0', '^20.19.0', true],
    ])('%s удовлетворяет %s: %s', (version, requirement, expected) => {
        expect(satisfiesMinVersion(version, requirement)).toBe(expected);
    });
});
