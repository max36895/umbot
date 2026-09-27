// middleware/ipFilter.ts
import { BotController } from '../controller';
import { MiddlewareNext } from '../core';

/**
 * Опции ipFilter middleware.
 */
export interface IIpFilterOptions {
    /**
     * Белый список IP/CIDR. Если задан — разрешены только эти адреса.
     * Поддерживаются IPv4 и IPv6.
     * Примеры: `'10.0.0.1'`, `'192.168.0.0/24'`, `'127.0.0.1'`, `'2001:db8::/32'`, `'::1'`.
     *
     * Правила сравниваются по версии адреса: если заданы только IPv4-правила,
     * IPv6-клиенты под whitelist не попадут и будут заблокированы.
     */
    whitelist?: string[];

    /**
     * Чёрный список IP/CIDR. Если задан — перечисленные запрещены.
     * Поддерживаются IPv4 и IPv6.
     * Игнорируется, если задан `whitelist`.
     *
     * Правила сравниваются по версии адреса: если заданы только IPv4-правила,
     * IPv6-клиенты под blacklist не попадут — добавляйте IPv6-правила явно.
     */
    blacklist?: string[];

    /**
     * Текст ответа, который получит пользователь из заблокированного IP.
     * @defaultValue '' (пустой ответ — молчим)
     */
    deniedText?: string;

    /**
     * Отклонять запросы, у которых IP клиента неизвестен.
     *
     * IP неизвестен, если бот вызван через `bot.run()` или через `bot.webhookEvent()`
     * без аргумента `clientIp` (serverless-обработчик, не передавший IP из события).
     * По умолчанию такие запросы пропускаются без фильтрации — чтобы не ломать
     * локальную разработку. Включите опцию в продакшене с `whitelist`: иначе
     * забытый `clientIp` молча отключает фильтр.
     * @defaultValue false
     *
     * @example
     * ```ts
     * bot.use(ipFilter({ whitelist: ['10.0.0.0/8'], rejectWithoutIp: true }));
     * ```
     */
    rejectWithoutIp?: boolean;
}

/**
 * Разобранный IP-адрес: версия и числовое представление (для IPv6 — BigInt).
 */
interface IParsedIp {
    version: 4 | 6;
    value: bigint;
}

/**
 * Разбирает dotted-quad IPv4 в число. Возвращает null для некорректных строк.
 */
function parseIpv4(ip: string): bigint | null {
    const parts = ip.trim().split('.');
    if (parts.length !== 4) {
        return null;
    }
    let value = 0n;
    for (const part of parts) {
        // Строгая проверка: parseInt принимал "1e2" и "0x1A" как валидные октеты
        if (!/^\d{1,3}$/.test(part)) {
            return null;
        }
        const n = Number(part);
        if (n > 255) {
            return null;
        }
        value = (value << 8n) | BigInt(n);
    }
    return value;
}

/**
 * Разбирает IPv6 (включая `::`-сжатие и IPv4-хвост) в 128-битное число.
 */
function parseIpv6(ip: string): bigint | null {
    let addr = ip.trim().replace(/^\[/, '').replace(/\]$/, '');
    const zoneIndex = addr.indexOf('%');
    if (zoneIndex !== -1) {
        addr = addr.slice(0, zoneIndex);
    }
    const halves = addr.split('::');
    if (halves.length > 2) {
        return null;
    }
    const parseGroups = (part: string): bigint[] | null => {
        if (part === '') {
            return [];
        }
        const groups = part.split(':');
        const values: bigint[] = [];
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            if (!group) {
                return null;
            }
            // IPv4-хвост допустим только в конце (::ffff:192.168.0.1)
            if (group.includes('.')) {
                if (i !== groups.length - 1) {
                    return null;
                }
                const v4 = parseIpv4(group);
                if (v4 === null) {
                    return null;
                }
                values.push(v4 >> 16n, v4 & 0xffffn);
                continue;
            }
            if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
                return null;
            }
            values.push(BigInt(parseInt(group, 16)));
        }
        return values;
    };
    // split всегда возвращает минимум один элемент; пустая строка в parseGroups
    // корректно даст [] (guard на undefined нужен только для type narrowing).
    const head = parseGroups(halves[0] ?? '');
    const tail = parseGroups(halves[1] ?? '');
    if (!head || !tail) {
        return null;
    }
    const missing = 8 - head.length - tail.length;
    // `::` обязан ровно один раз компенсировать недостающие группы;
    // без `::` адрес должен содержать ровно 8 групп
    if (missing < 0 || (halves.length === 1 && missing !== 0)) {
        return null;
    }
    const groups = [...head, ...new Array(missing).fill(0n), ...tail];
    let value = 0n;
    for (const group of groups) {
        value = (value << 16n) | group;
    }
    return value;
}

/**
 * Разбирает IP-адрес любой версии.
 * IPv4-mapped IPv6 (`::ffff:a.b.c.d`) приводится к IPv4, чтобы правила
 * для IPv4 применялись и к mapped-адресам dual-stack хостов.
 */
function parseIp(ip: string): IParsedIp | null {
    if (ip.includes(':')) {
        const value = parseIpv6(ip);
        if (value === null) {
            return null;
        }
        if (value >> 32n === 0xffffn) {
            return { version: 4, value: value & 0xffffffffn };
        }
        return { version: 6, value };
    }
    const value = parseIpv4(ip);
    return value === null ? null : { version: 4, value };
}

/**
 * Разбирает CIDR-нотацию для IPv4 ("192.168.0.0/24") и IPv6 ("2001:db8::/32").
 */
function parseCidr(cidr: string): { version: 4 | 6; value: bigint; prefix: number } | null {
    const [ipStr, prefixStr] = cidr.split('/');
    if (!ipStr) {
        return null;
    }
    const parsed = parseIp(ipStr.trim());
    if (!parsed) {
        return null;
    }
    const maxPrefix = parsed.version === 4 ? 32 : 128;
    let prefix = maxPrefix;
    if (prefixStr !== undefined) {
        if (!/^\d{1,3}$/.test(prefixStr.trim())) {
            return null;
        }
        prefix = Number(prefixStr);
        if (prefix > maxPrefix) {
            return null;
        }
    }
    const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(maxPrefix - prefix);
    return { version: parsed.version, value: parsed.value & mask, prefix };
}

function ipInCidr(ip: string, cidr: string): boolean {
    const cidrParsed = parseCidr(cidr);
    const ipParsed = parseIp(ip);
    if (!cidrParsed || !ipParsed) {
        return false;
    }
    // Сравниваем адреса только одной версии: IPv6-клиент под правило IPv4
    // не попадает (и наоборот). Для фильтрации IPv6-трафика добавляйте
    // IPv6-правила в whitelist/blacklist.
    if (cidrParsed.version !== ipParsed.version) {
        return false;
    }
    const maxPrefix = cidrParsed.version === 4 ? 32 : 128;
    const mask =
        cidrParsed.prefix === 0
            ? 0n
            : ((1n << BigInt(cidrParsed.prefix)) - 1n) << BigInt(maxPrefix - cidrParsed.prefix);
    return (ipParsed.value & mask) === cidrParsed.value;
}

/**
 * Middleware для фильтрации входящих запросов по IP-адресу клиента.
 *
 * IP клиента фреймворк берёт из сокета в `bot.start()` / `bot.webhookHandle()`.
 * В serverless его нужно передать явно: `bot.webhookEvent(body, headers, clientIp)`
 * (обработчик, сгенерированный CLI для Yandex Cloud Functions, берёт IP из
 * `event.requestContext.identity.sourceIp`). Если IP неизвестен (например,
 * `bot.run(...)` напрямую), запрос пропускается — либо отклоняется при `rejectWithoutIp: true`.
 *
 * За reverse proxy (nginx и т.п.) все запросы будут иметь IP самого прокси:
 * IP берётся из сокета, а не из `X-Forwarded-For` (его подделывает клиент).
 * За прокси ограничивайте доступ на уровне самого прокси.
 *
 * @example
 * ```ts
 * import { ipFilter } from 'umbot/middleware';
 *
 * // Только адреса из доверенных сетей (например, диапазоны IP платформы);
 * // запрос без известного IP клиента тоже отклоняется
 * bot.use(ipFilter({
 *   whitelist: ['203.0.113.0/24', '198.51.100.0/24'],
 *   deniedText: 'Forbidden',
 *   rejectWithoutIp: true,
 * }));
 *
 * // Запретить спам-IP
 * bot.use(ipFilter({ blacklist: ['203.0.113.42', '198.51.100.0/24'] }));
 * ```
 *
 * @param options Конфигурация фильтра (whitelist или blacklist).
 * @returns Middleware для `bot.use(...)`.
 */
export function ipFilter(
    options: IIpFilterOptions,
): (ctx: BotController, next: MiddlewareNext) => Promise<void> {
    const whitelist = options.whitelist ?? null;
    const blacklist = options.blacklist ?? null;
    const deniedText = options.deniedText ?? '';
    const rejectWithoutIp = options.rejectWithoutIp === true;
    // Предупреждение о пропуске запросов без IP достаточно вывести один раз
    // на инстанс middleware — иначе консольные приложения замусорят лог.
    let warnedNoIp = false;

    return async (ctx: BotController, next: MiddlewareNext): Promise<void> => {
        // IP клиента заполняется фреймворком в webhookHandle из сокета HTTP-запроса.
        // requestObject здесь не подходит — это распарсенное JSON-тело платформы.
        const remoteIp = ctx.platformOptions.clientIp;

        // Нет IP (bot.run() или webhookEvent() без clientIp). По умолчанию не
        // блокируем, чтобы не ломать локальную разработку; с rejectWithoutIp —
        // отклоняем: иначе забытый clientIp в serverless молча отключал whitelist.
        if (!remoteIp) {
            if (rejectWithoutIp) {
                ctx.appContext.logWarn('ipFilter: блокирован запрос без IP клиента.');
                ctx.text = deniedText;
                return;
            }
            if (!warnedNoIp) {
                warnedNoIp = true;
                ctx.appContext.logWarn(
                    'ipFilter: запрос без IP клиента пропущен без фильтрации ' +
                        '(bot.run() или webhookEvent() без аргумента clientIp). В serverless ' +
                        'передайте IP из события в webhookEvent(body, headers, clientIp); ' +
                        'чтобы отклонять такие запросы, включите rejectWithoutIp.',
                );
            }
            await next();
            return;
        }

        // Нормализация IPv4-mapped IPv6: "::ffff:127.0.0.1" → "127.0.0.1".
        // Срезаем только dotted-quad-хвост; hex-форму "::ffff:102:304"
        // корректно разбирает parseIp.
        const ip =
            remoteIp.startsWith('::ffff:') && remoteIp.slice(7).includes('.')
                ? remoteIp.slice(7)
                : remoteIp;

        // Если задан whitelist — должен быть match
        if (whitelist && whitelist.length) {
            const matched = whitelist.some((cidr) => ipInCidr(ip, cidr));
            if (!matched) {
                ctx.appContext.logWarn(`ipFilter: блокирован запрос с небелого IP=${ip}`);
                ctx.text = deniedText;
                return;
            }
            await next();
            return;
        }

        // Если задан blacklist — должен НЕ быть match
        if (blacklist && blacklist.length) {
            const matched = blacklist.some((cidr) => ipInCidr(ip, cidr));
            if (matched) {
                ctx.appContext.logWarn(`ipFilter: блокирован запрос с чёрного IP=${ip}`);
                ctx.text = deniedText;
                return;
            }
        }

        await next();
    };
}
