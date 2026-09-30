'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readEnv } = require(path.join(__dirname, 'WebhookController.js'));

/** Таймаут одного запроса к API платформы, мс. */
const REQUEST_TIMEOUT = 10_000;

/** Метки строк отчёта. */
const MARK = { ok: '✓', warn: '⚠', error: '✗', info: 'ℹ' };

/**
 * Выполняет запрос к API платформы и разбирает JSON-ответ. Не бросает исключений:
 * сетевая ошибка возвращается полем `error`. Текст ошибки не содержит URL — в адресе
 * Telegram API есть токен бота.
 * @param {typeof fetch} fetchImpl HTTP-клиент
 * @param {string} url Адрес метода
 * @param {RequestInit} [init] Параметры запроса
 * @returns {Promise<{ok: boolean, status: number, body: Record<string, any>, error?: string}>}
 */
async function requestJson(fetchImpl, url, init = {}) {
    let response;
    try {
        response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
    } catch (e) {
        const reason = e && e.name === 'TimeoutError' ? 'нет ответа за 10 с' : e && e.message;
        return { ok: false, status: 0, body: {}, error: reason || String(e) };
    }
    let body = {};
    try {
        body = (await response.json()) || {};
    } catch {
        // Не JSON — ниже сработает проверка статуса.
    }
    return { ok: response.ok, status: response.status, body };
}

/**
 * Причина неудачного ответа платформы для отчёта.
 * @param {{status: number, body: Record<string, any>, error?: string}} res Ответ
 * @returns {string} Причина
 */
function describeFailure(res) {
    if (res.error) {
        return res.error;
    }
    const detail =
        res.body.description ||
        res.body.message ||
        res.body.status_message ||
        (res.body.error && res.body.error.error_msg);
    return detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`;
}

/**
 * Проверки Telegram: токен (getMe) и состояние вебхука (getWebhookInfo).
 * @param {{token: string, env: (name: string) => string, fetchImpl: typeof fetch}} ctx Контекст
 * @returns {Promise<Array<[string, string]>>} Строки отчёта [метка, текст]
 */
async function checkTelegram({ token, env, fetchImpl }) {
    const base = `https://api.telegram.org/bot${token}/`;
    const me = await requestJson(fetchImpl, base + 'getMe');
    if (!me.ok || me.body.ok !== true) {
        return [['error', `токен не принят: ${describeFailure(me)}`]];
    }
    const lines = [['ok', `токен рабочий (@${me.body.result && me.body.result.username})`]];
    const info = await requestJson(fetchImpl, base + 'getWebhookInfo');
    if (!info.ok || info.body.ok !== true) {
        lines.push(['warn', `не удалось получить состояние вебхука: ${describeFailure(info)}`]);
        return lines;
    }
    const webhook = info.body.result || {};
    if (!webhook.url) {
        lines.push([
            'info',
            'вебхук не зарегистрирован: получайте обновления через bot.startPolling() ' +
                'или зарегистрируйте вебхук: npx umbot webhook telegram <https-url>',
        ]);
        return lines;
    }
    lines.push(['ok', `вебхук: ${webhook.url}`]);
    if (webhook.pending_update_count > 0) {
        lines.push(['warn', `ждут доставки обновлений: ${webhook.pending_update_count}`]);
    }
    if (webhook.last_error_message) {
        const when = webhook.last_error_date
            ? ` (${new Date(webhook.last_error_date * 1000).toLocaleString('ru-RU')})`
            : '';
        lines.push(['warn', `последняя ошибка доставки${when}: ${webhook.last_error_message}`]);
    }
    if (!env('TELEGRAM_WEBHOOK_SECRET')) {
        lines.push([
            'warn',
            'TELEGRAM_WEBHOOK_SECRET не задан — вебхук принимает запросы без проверки подписи. ' +
                'Перерегистрируйте его: npx umbot webhook telegram <https-url>',
        ]);
    }
    return lines;
}

/**
 * Проверки MAX: токен (GET /me) и подписки на вебхук (GET /subscriptions).
 * @param {{token: string, env: (name: string) => string, fetchImpl: typeof fetch}} ctx Контекст
 * @returns {Promise<Array<[string, string]>>} Строки отчёта
 */
async function checkMax({ token, env, fetchImpl }) {
    const init = { headers: { Authorization: token } };
    const me = await requestJson(fetchImpl, 'https://platform-api2.max.ru/me', init);
    if (!me.ok) {
        return [['error', `токен не принят: ${describeFailure(me)}`]];
    }
    const name = me.body.username ? `@${me.body.username}` : me.body.first_name;
    const lines = [['ok', `токен рабочий (${name})`]];
    const subs = await requestJson(fetchImpl, 'https://platform-api2.max.ru/subscriptions', init);
    if (!subs.ok) {
        lines.push(['warn', `не удалось получить подписки: ${describeFailure(subs)}`]);
        return lines;
    }
    const urls = (subs.body.subscriptions || []).map((s) => s && s.url).filter(Boolean);
    if (urls.length === 0) {
        lines.push([
            'info',
            'вебхук не зарегистрирован: получайте обновления через bot.startPolling() ' +
                'или зарегистрируйте вебхук: npx umbot webhook max <https-url>',
        ]);
        return lines;
    }
    lines.push(['ok', `вебхук: ${urls.join(', ')}`]);
    if (!env('MAX_WEBHOOK_SECRET')) {
        lines.push([
            'warn',
            'MAX_WEBHOOK_SECRET не задан — вебхук принимает запросы без проверки подписи. ' +
                'Перерегистрируйте его: npx umbot webhook max <https-url>',
        ]);
    }
    return lines;
}

/**
 * Проверки VK: токен сообщества (groups.getById) и настройки Callback API в .env.
 * @param {{token: string, env: (name: string) => string, fetchImpl: typeof fetch}} ctx Контекст
 * @returns {Promise<Array<[string, string]>>} Строки отчёта
 */
async function checkVk({ token, env, fetchImpl }) {
    const res = await requestJson(fetchImpl, 'https://api.vk.ru/method/groups.getById', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: token, v: '5.199' }).toString(),
    });
    if (!res.ok || res.body.error) {
        return [['error', `токен не принят: ${describeFailure(res)}`]];
    }
    const response = res.body.response;
    const group = Array.isArray(response)
        ? response[0]
        : response && response.groups && response.groups[0];
    if (!group) {
        return [['error', 'токен не относится к сообществу: нужен токен сообщества (VK_TOKEN)']];
    }
    const lines = [['ok', `токен рабочий (сообщество «${group.name}»)`]];
    if (!env('VK_SECRET_KEY')) {
        lines.push([
            'warn',
            'VK_SECRET_KEY не задан — Callback API принимает запросы без проверки секрета ' +
                '(для bot.startPolling() не нужен)',
        ]);
    }
    if (!env('VK_CONFIRMATION_TOKEN')) {
        lines.push([
            'info',
            'VK_CONFIRMATION_TOKEN не задан — он нужен, чтобы подтвердить сервер Callback API',
        ]);
    }
    return lines;
}

/**
 * Проверки Viber: токен и адрес вебхука (get_account_info).
 * @param {{token: string, fetchImpl: typeof fetch}} ctx Контекст
 * @returns {Promise<Array<[string, string]>>} Строки отчёта
 */
async function checkViber({ token, fetchImpl }) {
    const res = await requestJson(fetchImpl, 'https://chatapi.viber.com/pa/get_account_info', {
        method: 'POST',
        headers: { 'X-Viber-Auth-Token': token, 'Content-Type': 'application/json' },
        body: '{}',
    });
    if (!res.ok || res.body.status !== 0) {
        return [['error', `токен не принят: ${describeFailure(res)}`]];
    }
    const lines = [['ok', `токен рабочий (${res.body.name})`]];
    lines.push(
        res.body.webhook
            ? ['ok', `вебхук: ${res.body.webhook}`]
            : [
                  'warn',
                  'вебхук не зарегистрирован — Viber работает только через вебхук (set_webhook)',
              ],
    );
    return lines;
}

/**
 * Проверка токена Алисы: квота загрузки картинок и звуков (GET /api/v1/status).
 * @param {{token: string, fetchImpl: typeof fetch}} ctx Контекст
 * @returns {Promise<Array<[string, string]>>} Строки отчёта
 */
async function checkAlisa({ token, fetchImpl }) {
    const res = await requestJson(fetchImpl, 'https://dialogs.yandex.net/api/v1/status', {
        headers: { Authorization: `OAuth ${token}` },
    });
    if (!res.ok) {
        return [['error', `токен не принят: ${describeFailure(res)}`]];
    }
    const mb = (bytes) => `${Math.round((Number(bytes) || 0) / 1024 / 1024)} МБ`;
    const images = (res.body.images && res.body.images.quota) || {};
    const sounds = (res.body.sounds && res.body.sounds.quota) || {};
    return [
        [
            'ok',
            `токен рабочий (картинки: ${mb(images.used)} из ${mb(images.total)}, ` +
                `звуки: ${mb(sounds.used)} из ${mb(sounds.total)})`,
        ],
    ];
}

/**
 * Платформы: переменная токена (`legacyEnv` — устаревшее имя, которое фреймворк тоже читает)
 * и проверка по API (без проверки — только наличие токена).
 */
const PLATFORMS = [
    { title: 'Telegram', tokenEnv: 'TELEGRAM_TOKEN', check: checkTelegram },
    { title: 'MAX', tokenEnv: 'MAX_TOKEN', check: checkMax },
    { title: 'VK', tokenEnv: 'VK_TOKEN', check: checkVk },
    { title: 'Viber', tokenEnv: 'VIBER_TOKEN', check: checkViber },
    { title: 'Алиса', tokenEnv: 'ALISA_TOKEN', legacyEnv: 'YANDEX_TOKEN', check: checkAlisa },
    { title: 'Сбер Салют', tokenEnv: 'SMARTAPP_TOKEN', check: null },
    { title: 'Маруся', tokenEnv: 'MARUSIA_TOKEN', check: null },
];

/**
 * Сравнивает версию Node.js с требованием вида `>=20.19.0`.
 * @param {string} version Текущая версия (`process.versions.node`)
 * @param {string} requirement Требование из `engines.node`
 * @returns {boolean} true, если версия подходит (или требование не разобрано)
 */
function satisfiesMinVersion(version, requirement) {
    const text = String(requirement || '').trim();
    if (!text.startsWith('>=')) {
        return true;
    }
    const need = text.slice(2).trim().split('.').map(Number);
    if (need.length > 3 || need.some((part) => !Number.isInteger(part))) {
        return true;
    }
    const have = String(version).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const a = have[i] || 0;
        const b = need[i] || 0;
        if (a !== b) {
            return a > b;
        }
    }
    return true;
}

/**
 * Проверяет, что .env указан в .gitignore проекта.
 * @param {string} cwd Каталог проекта
 * @returns {boolean} true, если правило для .env найдено
 */
function isEnvIgnored(cwd) {
    const gitignore = path.join(cwd, '.gitignore');
    if (!fs.existsSync(gitignore)) {
        return false;
    }
    return fs
        .readFileSync(gitignore, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .some((line) => ['.env', '/.env', '.env*', '*.env', '.env.*'].includes(line));
}

/**
 * Диагностика проекта umbot: версия Node.js, установленный umbot, .env и его место
 * в .gitignore, токены платформ (запросом к API), состояние вебхуков Telegram, MAX
 * и Viber. Токены в вывод не попадают. Сетевые проверки отключаются `offline`.
 *
 * @param {object} [options] Параметры
 * @param {string} [options.cwd=process.cwd()] Каталог проекта
 * @param {string} [options.envPath] Путь к .env (по умолчанию `<cwd>/.env`)
 * @param {boolean} [options.offline=false] Не обращаться к API платформ
 * @param {typeof fetch} [options.fetchImpl=fetch] HTTP-клиент (подменяется в тестах)
 * @param {(line: string) => void} [options.print=console.log] Вывод строки отчёта
 * @returns {Promise<{errors: number, warnings: number}>} Число ошибок и предупреждений
 */
async function runDoctor({
    cwd = process.cwd(),
    envPath,
    offline = false,
    fetchImpl = fetch,
    print = console.log,
} = {}) {
    const counters = { errors: 0, warnings: 0 };
    const report = (mark, text, indent = '  ') => {
        if (mark === 'error') counters.errors++;
        if (mark === 'warn') counters.warnings++;
        print(`${indent}${MARK[mark]} ${text}`);
    };

    print('Окружение');
    const engines = require(path.join(__dirname, '..', '..', 'package.json')).engines || {};
    const nodeVersion = process.versions.node;
    if (satisfiesMinVersion(nodeVersion, engines.node)) {
        report('ok', `Node.js ${nodeVersion}`);
    } else {
        report('error', `Node.js ${nodeVersion}, а umbot требует ${engines.node}`);
    }

    const installed = path.join(cwd, 'node_modules', 'umbot', 'package.json');
    if (fs.existsSync(installed)) {
        report('ok', `umbot ${JSON.parse(fs.readFileSync(installed, 'utf8')).version} установлен`);
    } else {
        report('warn', 'umbot не найден в node_modules — выполните npm install');
    }

    const resolvedEnv = envPath ? path.resolve(envPath) : path.join(cwd, '.env');
    const hasEnv = fs.existsSync(resolvedEnv);
    if (hasEnv) {
        report('ok', `.env найден (${path.relative(cwd, resolvedEnv) || '.env'})`);
        if (!isEnvIgnored(cwd)) {
            report('error', '.env не указан в .gitignore — токены попадут в git');
        }
    } else {
        report('warn', '.env не найден — создайте его: npx umbot add env');
    }

    const fileEnv = readEnv(resolvedEnv);
    const env = (name) => fileEnv[name] || process.env[name] || '';

    print('');
    print('Платформы');
    const skipped = [];
    for (const platform of PLATFORMS) {
        const token = env(platform.tokenEnv) || (platform.legacyEnv ? env(platform.legacyEnv) : '');
        if (!token) {
            skipped.push(platform.title);
            continue;
        }
        print(`  ${platform.title} (${platform.tokenEnv})`);
        if (!platform.check) {
            report('info', 'токен задан; проверки по API для платформы нет', '    ');
        } else if (offline) {
            report('info', 'токен задан; проверка по API пропущена (--offline)', '    ');
        } else {
            for (const [mark, text] of await platform.check({ token, env, fetchImpl })) {
                // Текст ошибки fetch может содержать URL, а в адресе Telegram API — токен.
                report(mark, text.split(token).join('***'), '    ');
            }
        }
    }
    if (skipped.length === PLATFORMS.length) {
        report('warn', 'не задан ни один токен платформы — заполните .env');
    } else if (skipped.length) {
        report('info', `без токена: ${skipped.join(', ')}`);
    }

    print('');
    print(
        counters.errors || counters.warnings
            ? `Итог: ошибок — ${counters.errors}, предупреждений — ${counters.warnings}.`
            : 'Итог: проблем не найдено.',
    );
    return counters;
}

module.exports = { runDoctor, satisfiesMinVersion };
