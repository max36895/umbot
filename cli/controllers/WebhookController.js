'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');

/** Таймаут запроса к API платформы при регистрации вебхука, мс. */
const REQUEST_TIMEOUT = 10_000;

/**
 * Платформы, у которых вебхук регистрируется через API вместе с секретом.
 * VK в списке нет: секретный ключ задаётся в настройках Callback API сообщества.
 */
const PLATFORMS = {
    telegram: {
        title: 'Telegram',
        tokenEnv: 'TELEGRAM_TOKEN',
        secretEnv: 'TELEGRAM_WEBHOOK_SECRET',
        /**
         * @param {string} token Токен бота
         * @param {string} url Адрес вебхука
         * @param {string} secret Секрет вебхука
         */
        request(token, url, secret) {
            return {
                url: `https://api.telegram.org/bot${token}/setWebhook`,
                init: {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, secret_token: secret }),
                },
            };
        },
        /** @param {Record<string, unknown>} body */
        isSuccess(body) {
            return body.ok === true;
        },
    },
    max: {
        title: 'MAX',
        tokenEnv: 'MAX_TOKEN',
        secretEnv: 'MAX_WEBHOOK_SECRET',
        /**
         * @param {string} token Токен бота
         * @param {string} url Адрес вебхука
         * @param {string} secret Секрет вебхука
         */
        request(token, url, secret) {
            return {
                url: 'https://platform-api2.max.ru/subscriptions',
                init: {
                    method: 'POST',
                    headers: { Authorization: token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, secret }),
                },
            };
        },
        /** @param {Record<string, unknown>} body */
        isSuccess(body) {
            return body.success === true;
        },
    },
};

/**
 * Читает переменные из .env (формат ИМЯ=значение, строки с # — комментарии).
 * @param {string} envPath Путь к .env
 * @returns {Record<string, string>} Переменные файла (пусто, если файла нет)
 */
function readEnv(envPath) {
    const result = {};
    if (!fs.existsSync(envPath)) {
        return result;
    }
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        const eq = trimmed.indexOf('=');
        if (!trimmed || trimmed.startsWith('#') || eq === -1) {
            continue;
        }
        result[trimmed.slice(0, eq).trim()] = trimmed
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
    }
    return result;
}

/**
 * Записывает переменную в .env: заменяет пустое значение или дописывает строку.
 * Переводы строк файла (CRLF на Windows) сохраняются, чтобы не менять весь файл в git.
 * @param {string} envPath Путь к .env
 * @param {string} name Имя переменной
 * @param {string} value Значение
 */
function writeEnvValue(envPath, name, value) {
    const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content ? content.split(/\r?\n/) : [];
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    const index = lines.findIndex((line) => line.trim().startsWith(`${name}=`));
    if (index === -1) {
        lines.push(`${name}=${value}`);
    } else {
        lines[index] = `${name}=${value}`;
    }
    fs.writeFileSync(envPath, lines.join(eol) + eol, 'utf8');
}

/**
 * Регистрирует вебхук Telegram или MAX сразу с секретом и сохраняет секрет в .env.
 *
 * Секрет берётся из .env/окружения или генерируется (32 случайных байта в base64url —
 * подходит и Telegram, и MAX). В .env он пишется только после успешной регистрации:
 * иначе бот начал бы отклонять запросы вебхука, зарегистрированного без секрета.
 * Токен и секрет в вывод не попадают.
 *
 * @param {object} options Параметры
 * @param {string} options.platform `telegram` или `max`
 * @param {string} options.url Публичный HTTPS-адрес вебхука
 * @param {string} [options.envPath='.env'] Путь к .env проекта
 * @param {typeof fetch} [options.fetchImpl=fetch] HTTP-клиент (подменяется в тестах)
 * @returns {Promise<{secretCreated: boolean}>} Создан ли новый секрет
 */
async function setupWebhook({ platform, url, envPath = '.env', fetchImpl = fetch }) {
    const config = PLATFORMS[String(platform || '').toLowerCase()];
    if (!config) {
        throw new Error(
            'Укажите платформу: telegram или max. Для VK секретный ключ задаётся в настройках ' +
                'Callback API сообщества и прописывается в .env как VK_SECRET_KEY.',
        );
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        throw new Error(`Некорректный адрес вебхука: "${url}".`);
    }
    if (parsedUrl.protocol !== 'https:') {
        throw new Error(`${config.title} принимает вебхук только по HTTPS.`);
    }
    if (config === PLATFORMS.max && parsedUrl.port && parsedUrl.port !== '443') {
        throw new Error('MAX принимает вебхук только на порту 443 — уберите порт из адреса.');
    }

    const env = readEnv(envPath);
    const token = env[config.tokenEnv] || process.env[config.tokenEnv];
    if (!token) {
        throw new Error(`Не найден ${config.tokenEnv} ни в ${envPath}, ни в окружении.`);
    }
    const existingSecret = env[config.secretEnv] || process.env[config.secretEnv];
    const secret = existingSecret || crypto.randomBytes(32).toString('base64url');

    const request = config.request(token, url, secret);
    let response;
    try {
        response = await fetchImpl(request.url, {
            ...request.init,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        });
    } catch (e) {
        throw new Error(`${config.title} не ответил: ${e && e.message ? e.message : e}`, {
            cause: e,
        });
    }
    let body = {};
    try {
        body = await response.json();
    } catch {
        // Тело не JSON — ниже сработает проверка успеха.
    }
    if (!response.ok || !config.isSuccess(body)) {
        const reason = body.description || body.message || `HTTP ${response.status}`;
        throw new Error(`${config.title} отклонил регистрацию вебхука: ${reason}`);
    }

    if (!existingSecret) {
        writeEnvValue(envPath, config.secretEnv, secret);
    }
    return { secretCreated: !existingSecret };
}

module.exports = { setupWebhook };
