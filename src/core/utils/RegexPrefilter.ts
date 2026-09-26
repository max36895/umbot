/**
 * Обязательные подстроки регулярок — основа префильтра поиска команд.
 *
 * Для регулярки извлекается подстрока, без которой совпадение невозможно
 * (`/zz_cmd_5_\d+/` → `zz_cmd_5_`), и регулярка запускается, только если эта
 * подстрока есть в тексте. Разбор консервативный: префильтр может лишь отсеять
 * заведомо несовпадающие проверки. Ложное «кандидат» допустимо, ложный отсев —
 * нет: при любом сомнении возвращается null («проверять всегда»).
 *
 * Регистр: текст и подстроки сворачиваются одной функцией {@link foldCode}.
 * Подстрока допускается, только если все её символы — из набора, где для
 * флагов `i`/`iu` «регулярка совпала с символом x» ⇒ fold(x) === fold(символ).
 * Модуль внутренний, в публичный API не входит.
 */

/** Буквенные экранирования без продолжения: `\d`, `\w`, `\b`, `\n`, `\0` и т.п. */
const SIMPLE_ESCAPES = 'dDwWsSbBnrtfv0';

/** Минимальная длина подстроки, которой стоит фильтровать. */
const MIN_LITERAL_LENGTH = 3;

/**
 * Свёртка кода символа к «нижнему регистру» для префильтра.
 *
 * Кроме ASCII и базовой кириллицы учитывает символы, которые по правилам
 * простой свёртки Unicode (флаг `iu`) совпадают с базовыми буквами:
 * знак Кельвина (K → k), длинная s (ſ → s) и старые начертания кириллицы
 * U+1C80–U+1C86. Без них префильтр отсеял бы текст, с которым регулярка совпала.
 * @param code Код символа (UTF-16)
 * @returns Свёрнутый код
 */
export function foldCode(code: number): number {
    if (code < 128) {
        return code >= 65 && code <= 90 ? code + 32 : code;
    }
    if (code >= 0x410 && code <= 0x42f) {
        return code + 32;
    }
    if (code >= 0x400 && code <= 0x40f) {
        return code + 80;
    }
    switch (code) {
        case 0x212a:
            return 0x6b;
        case 0x17f:
            return 0x73;
        case 0x1c80:
            return 0x432;
        case 0x1c81:
            return 0x434;
        case 0x1c82:
            return 0x43e;
        case 0x1c83:
            return 0x441;
        case 0x1c84:
        case 0x1c85:
            return 0x442;
        case 0x1c86:
            return 0x44a;
        default:
            return code;
    }
}

/**
 * Свёртка строки посимвольно ({@link foldCode}).
 * @param text Строка
 * @returns Свёрнутая строка
 */
export function foldString(text: string): string {
    let res = '';
    for (let i = 0; i < text.length; i++) {
        res += String.fromCharCode(foldCode(text.charCodeAt(i)));
    }
    return res;
}

/**
 * Символ подстроки безопасен для свёртки: печатный ASCII или базовая кириллица.
 * @param code Код символа
 * @returns true — символ можно использовать в обязательной подстроке
 */
function isSafeCode(code: number): boolean {
    return (
        (code >= 32 && code < 127) ||
        (code >= 0x410 && code <= 0x44f) ||
        code === 0x401 ||
        code === 0x451
    );
}

/**
 * Длина буквенно-цифровой спецпоследовательности `\X…` в позиции `i`
 * (`\d`, `\x41`, `\u{1F600}`, `\p{L}`, `\k<name>`, `\12`).
 * @param source Исходник регулярки
 * @param i Позиция обратной косой черты
 * @returns Длина в символах или -1 — последовательность неизвестна или оборвана
 */
function escapeLength(source: string, i: number): number {
    const e = source[i + 1] as string;
    const until = (ch: string): number => {
        const end = source.indexOf(ch, i);
        return end < 0 ? -1 : end - i + 1;
    };
    switch (e) {
        case 'x':
            return 4;
        case 'u':
            return source[i + 2] === '{' ? until('}') : 6;
        case 'p':
        case 'P':
            return until('}');
        case 'c':
            return 3;
        case 'k':
            return until('>');
        default: {
            if (e >= '0' && e <= '9') {
                let end = i + 1;
                while (
                    end < source.length &&
                    (source[end] as string) >= '0' &&
                    (source[end] as string) <= '9'
                ) {
                    end++;
                }
                return end - i;
            }
            return SIMPLE_ESCAPES.includes(e) ? 2 : -1;
        }
    }
}

/**
 * Позиция сразу после символьного класса `[...]`, начинающегося в `i`.
 * @param source Исходник регулярки
 * @param i Позиция `[`
 * @returns Позиция после `]` или -1, если класс не закрыт
 */
function classEnd(source: string, i: number): number {
    let j = i + 1;
    if (source[j] === '^') {
        j++;
    }
    if (source[j] === ']') {
        j++;
    }
    while (j < source.length && source[j] !== ']') {
        j += source[j] === '\\' ? 2 : 1;
    }
    return j < source.length ? j + 1 : -1;
}

/**
 * Длина квантификатора в позиции `i` (`*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}`
 * и ленивый суффикс `?`).
 * @param source Исходник регулярки
 * @param i Позиция
 * @returns Длина квантификатора, 0 — квантификатора нет, -1 — `{` не квантификатор
 */
function quantifierLength(source: string, i: number): number {
    const c = source[i];
    let len = 0;
    if (c === '*' || c === '+' || c === '?') {
        len = 1;
    } else if (c === '{') {
        len = braceQuantifierLength(source, i);
        if (len < 0) {
            return -1;
        }
    }
    if (len && source[i + len] === '?') {
        len++;
    }
    return len;
}

/**
 * Длина квантификатора `{n}`, `{n,}` или `{n,m}` в позиции `i`.
 * @param source Исходник регулярки
 * @param i Позиция `{`
 * @returns Длина или -1 — это не квантификатор
 */
function braceQuantifierLength(source: string, i: number): number {
    const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';
    let j = i + 1;
    if (!isDigit(source[j])) {
        return -1;
    }
    while (isDigit(source[j])) {
        j++;
    }
    if (source[j] === ',') {
        j++;
        while (isDigit(source[j])) {
            j++;
        }
    }
    return source[j] === '}' ? j - i + 1 : -1;
}

/**
 * Разбирает экранирование в позиции `i`.
 * @param source Исходник регулярки
 * @param i Позиция обратной косой черты
 * @returns Длина и литерал (`null` — спецпоследовательность вроде `\d`);
 *   null — экранирование неизвестно или оборвано
 */
function readEscape(source: string, i: number): { length: number; literal: string | null } | null {
    const e = source[i + 1];
    if (e === undefined) {
        return null;
    }
    if (/[A-Za-z0-9]/.test(e)) {
        const length = escapeLength(source, i);
        return length < 0 ? null : { length, literal: null };
    }
    // Экранированная пунктуация (`\.`, `\-`) — обычный символ.
    return { length: 2, literal: e };
}

/**
 * Литеральные отрезки верхнего уровня регулярки: подряд идущие обычные
 * символы вне групп и классов. Символ под квантификатором в отрезок не входит.
 * @param source Исходник регулярки
 * @returns Отрезки или null — верхний уровень содержит `|` либо разбор не удался
 */
function topLevelRuns(source: string): string[] | null {
    const runs: string[] = [];
    let cur = '';
    let depth = 0;
    let i = 0;
    const flush = (): void => {
        if (cur) {
            runs.push(cur);
        }
        cur = '';
    };
    while (i < source.length) {
        const c = source[i] as string;
        const q = depth === 0 ? quantifierLength(source, i) : 0;
        if (q < 0) {
            return null;
        }
        if (q > 0) {
            // Квантификатор делает последний символ необязательным или повторяемым.
            cur = cur.slice(0, -1);
            flush();
            i += q;
            continue;
        }
        if (c === '\\') {
            const escape = readEscape(source, i);
            if (escape === null) {
                return null;
            }
            if (escape.literal === null) {
                flush();
            } else if (depth === 0) {
                cur += escape.literal;
            }
            i += escape.length;
            continue;
        }
        if (c === '[') {
            const end = classEnd(source, i);
            if (end < 0) {
                return null;
            }
            flush();
            i = end;
            continue;
        }
        if (c === '(' || c === ')') {
            depth += c === '(' ? 1 : -1;
            if (depth < 0) {
                return null;
            }
            flush();
            i++;
            continue;
        }
        if (c === '|' && depth === 0) {
            return null;
        }
        if (depth === 0 && !'.^$]}|'.includes(c)) {
            cur += c;
        } else if (depth === 0) {
            flush();
        }
        i++;
    }
    flush();
    return runs;
}

/**
 * Обязательная подстрока регулярки — самый длинный безопасный кусок
 * литеральных отрезков верхнего уровня, свёрнутый {@link foldCode}.
 * @param source Исходник регулярки
 * @param flags Флаги регулярки (флаг `v` не поддерживается — null)
 * @param minLength Минимальная длина подстроки
 * @returns Подстрока или null — фильтровать по ней нельзя или бесполезно
 *
 * @example
 * ```ts
 * requiredLiteral('zz_cmd_5_\\d+', 'i'); // 'zz_cmd_5_'
 * requiredLiteral('(да|нет)', 'i');     // null — обязательной подстроки нет
 * ```
 */
export function requiredLiteral(
    source: string,
    flags: string,
    minLength: number = MIN_LITERAL_LENGTH,
): string | null {
    if (flags.includes('v')) {
        return null;
    }
    const runs = topLevelRuns(source);
    if (runs === null) {
        return null;
    }
    let best = '';
    for (const run of runs) {
        let piece = '';
        for (let k = 0; k <= run.length; k++) {
            const code = k < run.length ? run.charCodeAt(k) : -1;
            if (code !== -1 && isSafeCode(code)) {
                piece += String.fromCharCode(foldCode(code));
                continue;
            }
            if (piece.length > best.length) {
                best = piece;
            }
            piece = '';
        }
    }
    return best.length >= minLength ? best : null;
}

/**
 * Делит исходник по `|` верхнего уровня (с учётом скобок, классов и экранирования).
 * @param source Исходник регулярки
 * @returns Альтернативы или null, если скобки не сбалансированы
 */
function splitTopLevel(source: string): string[] | null {
    const parts: string[] = [];
    let depth = 0;
    let last = 0;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === '\\') {
            i++;
        } else if (c === '[') {
            const end = classEnd(source, i);
            if (end < 0) {
                return null;
            }
            i = end - 1;
        } else if (c === '(') {
            depth++;
        } else if (c === ')') {
            depth--;
        } else if (c === '|' && depth === 0) {
            parts.push(source.slice(last, i));
            last = i + 1;
        }
    }
    parts.push(source.slice(last));
    return depth === 0 ? parts : null;
}

/**
 * Обязательные подстроки каждой альтернативы регулярки группы команд
 * (формат CommandReg: `(?<_0>(слот)|(слот))|(?<_1>(слот))`). Группа совпадает,
 * только если совпал хотя бы один слот, поэтому достаточно найти в тексте
 * подстроку любого слота.
 * @param source Исходник регулярки группы
 * @param flags Флаги регулярки группы
 * @returns Подстроки слотов или null, если хотя бы у одного слота её нет
 */
export function groupSourceLiterals(source: string | undefined, flags: string): string[] | null {
    const alternatives = source ? splitTopLevel(source) : null;
    if (alternatives === null) {
        return null;
    }
    const res: string[] = [];
    for (const alt of alternatives) {
        const m = /^\(\?<_\d+>([\s\S]*)\)$/.exec(alt);
        const slots = m ? splitTopLevel(m[1] as string) : null;
        if (slots === null) {
            return null;
        }
        for (const slot of slots) {
            const lit =
                slot.startsWith('(') && slot.endsWith(')')
                    ? requiredLiteral(slot.slice(1, -1), flags)
                    : null;
            if (lit === null) {
                return null;
            }
            res.push(lit);
        }
    }
    return res;
}
