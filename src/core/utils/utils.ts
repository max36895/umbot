const REG_INTERVAL_QUANTIFIED = /}\s*[+*{?]/;
const REG_PIPE = /\([^)]*\|[^)]*\)/;
const REG_EV1 = /\([^)]*(\w)\1+[^)]*\|/;
const REG_EV2 = /\([^)]*[+*{][^)]*\|/;
// Повтор квантифицированной группы интервалом: (a+){10,100}. Внутренний
// квантификатор должен быть НЕОГРАНИЧЕННЫМ (+, *, {n,}): у ограниченных
// интервалов (\d{1,3}\.){3} (IP-адрес) длина каждого повтора фиксирована
// и перебора разбиений не возникает — их блокировать нельзя.
// {n,} без верхней границы распознаём по «,}» перед закрывающей скобкой.
const REG_REPEAT = /\([^)]*[+*][^)]*\)\s*\{|\([^)]*,\}[^)]*\)\s*\{/;

/**
 * Атом регулярного выражения для анализа пересечений.
 * `neg` — «почти всё»: `.`, `\W`/`\D`/`\S`, `[^...]` — консервативно считаем
 * пересекающимся с любым атомом (лучше ложная тревога на экзотике,
 * чем пропуск классики).
 *
 * `innerBody` — тело группы `(...)`: парсится для рекурсивного анализа
 * квантификаторных лестниц внутри (группа как единый атом их не видит).
 */
type TPatternAtom =
    { t: 'neg' } | { t: 'class'; ranges: [number, number][] } | { t: 'group'; body: string };

/**
 * Результат разбора атома: сам атом, позиция следующего символа и признаки.
 */
type TParsedAtom = {
    atom: TPatternAtom;
    next: number;
    /**
     * Тело группы `(...)`: для рекурсивного анализа лестниц внутри.
     */
    innerBody?: string;
    /**
     * Backreference `\1`–`\9`: повтор группы амбивалентной длины.
     */
    isBackreference?: boolean;
};

const ATOM_DIGIT: [number, number][] = [[48, 57]];
const ATOM_WORD: [number, number][] = [
    [48, 57],
    [65, 90],
    [95, 95],
    [97, 122],
];
const ATOM_SPACE: [number, number][] = [
    [9, 13],
    [32, 32],
];

/**
 * Проверяет пересечение двух наборов диапазонов кодпоинтов (группы — «пересекаются со всем»).
 */
function atomsOverlap(a: TPatternAtom, b: TPatternAtom): boolean {
    const ra = a.t === 'group' ? null : a;
    const rb = b.t === 'group' ? null : b;
    if (ra === null || rb === null || ra.t === 'neg' || rb.t === 'neg') {
        return true;
    }
    for (const r1 of ra.ranges) {
        for (const r2 of rb.ranges) {
            if (r1[0] <= r2[1] && r2[0] <= r1[1]) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Якорные escape-последовательности: совпадают с пустой строкой, не потребляют символы.
 */
const ZERO_WIDTH_ESCAPES = new Set(['b', 'B', 'A', 'Z', 'z', 'G', 'k']);

/**
 * Разбирает escape-последовательность в позиции i (`\` — pattern[i]).
 * Возвращает атом и индекс следующего символа; null — только для zero-width
 * якорей (`\b`, `\A`, `\Z` и т.п.). Backreference `\1`–`\9` возвращает
 * как атом с признаком isBackreference.
 */
function parseEscapeAtom(pattern: string, i: number): TParsedAtom | null {
    const esc = pattern[i + 1];
    if (/[1-9]/.test(esc ?? '')) {
        // Backreference \1..\9 — повтор ранее захваченной группы: амбивалентная
        // длина, источник катастрофического бэктрекинга в лестницах
        // ((a+)[^]*\1z). Как атом с консервативным классом «всё».
        return {
            atom: { t: 'group', body: '' },
            next: i + 2,
            isBackreference: true,
        };
    }
    switch (esc) {
        case 'w':
            return { atom: { t: 'class', ranges: ATOM_WORD }, next: i + 2 };
        case 'd':
            return { atom: { t: 'class', ranges: ATOM_DIGIT }, next: i + 2 };
        case 's':
            return { atom: { t: 'class', ranges: ATOM_SPACE }, next: i + 2 };
        case 'W':
        case 'D':
        case 'S':
            return { atom: { t: 'neg' }, next: i + 2 };
        case undefined:
            return null;
        case 'p':
        case 'P':
            // \p{L} — класс юникодных свойств; консервативно «почти всё»
            return { atom: { t: 'neg' }, next: skipUnicodeProperty(pattern, i + 2) };
        default: {
            if (ZERO_WIDTH_ESCAPES.has(esc)) {
                // \b, \B, \A, \Z, \G, \k — якоря/backreferences: ширины не имеют
                return null;
            }
            // Экранированный литерал: \. \! \\ \n \u1234 — диапазон из одного символа
            const code = esc.codePointAt(0) as number;
            return { atom: { t: 'class', ranges: [[code, code]] }, next: i + 2 };
        }
    }
}

/**
 * Разбирает атом, начиная с позиции i. Возвращает атом и индекс следующего
 * символа, либо null, если в позиции i не атом (квантификатор, якорь и т.п.).
 * Для группы `(...)` дополнительно возвращается её тело (innerBody) —
 * для рекурсивного анализа лестниц квантификаторов внутри.
 */
function parseAtom(pattern: string, i: number): TParsedAtom | null {
    // charAt за пределами строки даёт '', все проверки ниже устойчивы к этому
    // (noUncheckedIndexedAccess: индексный доступ к строке даёт undefined).
    const ch = pattern.charAt(i);
    if (ch === '\\') {
        return parseEscapeAtom(pattern, i);
    }
    if (ch === '[') {
        return parseCharClass(pattern, i);
    }
    if (ch === '(') {
        // Группа — потребляющий «атом» с непрозрачным телом: консервативно
        // пересекается со всем. Тело анализируется отдельно: рекурсией в
        // hasSequentialQuantifierChain (лестница внутри `(?:a*a*)` невидима
        // иначе) и hasDangerousQuantifiedGroup (квантифицированная группа).
        const close = skipGroup(pattern, i);
        return {
            atom: { t: 'group', body: pattern.slice(i, close) },
            next: close,
            innerBody: pattern.slice(i + 1, close - 1),
        };
    }
    if (
        ch === ')' ||
        ch === '|' ||
        ch === '{' ||
        ch === '*' ||
        ch === '+' ||
        ch === '?' ||
        ch === '^' ||
        ch === '$' ||
        /\s/.test(ch)
    ) {
        return null;
    }
    const code = ch.codePointAt(0) ?? 0;
    return { atom: { t: 'class', ranges: [[code, code]] }, next: i + 1 };
}

/**
 * Пропускает `\p{...}` / `\P{...}` от позиции i (сразу после буквы p/P).
 */
function skipUnicodeProperty(pattern: string, i: number): number {
    if (pattern[i] !== '{') {
        return i;
    }
    const close = pattern.indexOf('}', i);
    return close === -1 ? pattern.length : close + 1;
}

/**
 * Пропускает группу от `(` до парной `)` с учётом вложенности и экранирования.
 */
function skipGroup(pattern: string, start: number): number {
    let depth = 0;
    for (let k = start; k < pattern.length; k++) {
        if (pattern[k] === '\\') {
            k++;
            continue;
        }
        if (pattern[k] === '(') {
            depth++;
        } else if (pattern[k] === ')') {
            depth--;
            if (depth === 0) {
                return k + 1;
            }
        }
    }
    return pattern.length;
}

/**
 * Кодпоинт символа; '' (за пределами строки) сворачивается к 0.
 */
function charCode(ch: string): number {
    return ch.codePointAt(0) ?? 0;
}

/**
 * Добавляет в ranges атом-диапазон для экранированного символа класса (`\n`, `\.` и т.п.).
 */
function pushEscapeRange(ranges: [number, number][], esc: string): void {
    ranges.push([charCode(esc), charCode(esc)]);
}

/**
 * Разбирает символьный класс `[a-z\d]` (включая `[^...]`) в набор диапазонов.
 */
function parseCharClass(
    pattern: string,
    start: number,
): { atom: TPatternAtom; next: number } | null {
    let i = start + 1;
    let negated = false;
    if (pattern[i] === '^') {
        negated = true;
        i++;
    }
    const ranges: [number, number][] = [];
    let first = true;
    while (i < pattern.length && (pattern.charAt(i) !== ']' || first)) {
        first = false;
        const ch = pattern.charAt(i);
        if (ch === '\\') {
            const esc = pattern.charAt(i + 1);
            if (esc === 'w') {
                ranges.push(...ATOM_WORD);
            } else if (esc === 'd') {
                ranges.push(...ATOM_DIGIT);
            } else if (esc === 's') {
                ranges.push(...ATOM_SPACE);
            } else if (esc === 'W' || esc === 'D' || esc === 'S') {
                return { atom: { t: 'neg' }, next: endOfClass(pattern, i) };
            } else if (esc !== '') {
                pushEscapeRange(ranges, esc);
            }
            i += 2;
            continue;
        }
        // Диапазон a-z (кодпоинты соседних символов)
        if (
            pattern.charAt(i + 1) === '-' &&
            pattern.charAt(i + 2) !== ']' &&
            pattern.charAt(i + 2) !== '' &&
            pattern.charAt(i + 2) !== '\\'
        ) {
            ranges.push([charCode(ch), charCode(pattern.charAt(i + 2))]);
            i += 3;
            continue;
        }
        ranges.push([charCode(ch), charCode(ch)]);
        i++;
    }
    if (pattern[i] !== ']') {
        return null; // некорректный класс — ранний new RegExp всё равно выбросит ошибку
    }
    if (negated) {
        return { atom: { t: 'neg' }, next: i + 1 };
    }
    return { atom: { t: 'class', ranges }, next: i + 1 };
}

/**
 * Находит закрывающую `]` класса (для negated-эскейпов внутри).
 */
function endOfClass(pattern: string, from: number): number {
    let i = from;
    while (i < pattern.length) {
        if (pattern[i] === '\\') {
            i += 2;
            continue;
        }
        if (pattern[i] === ']') {
            return i + 1;
        }
        i++;
    }
    return pattern.length;
}

/**
 * Результат анализа фрагмента паттерна на квантификаторные лестницы.
 *
 * `dangerous` — лестница найдена где-то внутри фрагмента.
 * `tailRun` — длина цепочки неограниченно квантифицированных атомов в самом
 * КОНЦЕ фрагмента: она «склеивается» с атомами после фрагмента. Для тела
 * группы `(?:a*a*)` tailRun=2, и внешний хвост `c` превращает пару в опасную
 * цепочку — без этого связывания `(?:a*a*)c` проходил проверку.
 */
interface IChainScan {
    dangerous: boolean;
    tailRun: number;
    tailAtom: TPatternAtom | null;
}

/**
 * Признак прочитанного после атома квантификатора.
 */
interface IQuantifierInfo {
    /**
     * Квантификатор присутствует (включая `?` и `{n,m}`).
     */
    isQuantified: boolean;
    /**
     * Квантификатор без верхней границы: `+`, `*`, `{n,}`.
     */
    isUnbounded: boolean;
    /**
     * Индекс первого символа ПОСЛЕ квантификатора.
     */
    next: number;
}

/**
 * Читает квантификатор после атома в позиции i: `+`, `*`, `?` (в т.ч. ленивые
 * `+?`/`*?`/`??`) и интервальный `{n}`/`{n,}`/`{n,m}`. Если квантификатора нет —
 * isQuantified=false, next=i.
 */
function readQuantifier(pattern: string, i: number): IQuantifierInfo {
    if (i >= pattern.length) {
        return { isQuantified: false, isUnbounded: false, next: i };
    }
    const q = pattern[i];
    if (q === '+' || q === '*') {
        const lazy = pattern[i + 1] === '?' ? 1 : 0;
        return { isQuantified: true, isUnbounded: true, next: i + 1 + lazy };
    }
    if (q === '?') {
        const lazy = pattern[i + 1] === '?' ? 1 : 0;
        return { isQuantified: true, isUnbounded: false, next: i + 1 + lazy };
    }
    if (q === '{') {
        const close = skipInterval(pattern, i);
        if (close === i) {
            return { isQuantified: false, isUnbounded: false, next: i };
        }
        // {n,} без верхней границы — неограниченный; {n}/{n,m} — ограниченные.
        // Единственная форма, где перед закрывающей `}` стоит запятая — {n,}
        const isUnbounded = pattern[close - 2] === ',' && pattern[close - 1] === '}';
        return { isQuantified: true, isUnbounded, next: close };
    }
    return { isQuantified: false, isUnbounded: false, next: i };
}

/**
 * Проверяет, что позиция i — якорь конца строки `$` или `\Z`/`\z`.
 */
function isEndTextAnchor(pattern: string, i: number): boolean {
    if (pattern[i] === '$') {
        return true;
    }
    return pattern[i] === '\\' && (pattern[i + 1] === 'Z' || pattern[i + 1] === 'z');
}

/**
 * Квантифицированный ли backreference в позиции i.
 *
 * Квантифицированный backreference (`\1+`, `\1{2,}`) опасен и сам по себе,
 * без соседних неограниченных квантификаторов: он перебирает разбиения
 * текста между «сытым» повтором и последующим несовпадением — паттерн
 * `(\w+)z\1{2,}` даёт квадратичный бэктрекинг на длинных входах.
 */
function isQuantifiedBackreference(pattern: string, i: number): boolean {
    const backrefQuant = readQuantifier(pattern, i);
    return backrefQuant.isQuantified && backrefQuant.isUnbounded;
}

/**
 * Детектит «лестницу» из квантифицированных атомов с пересекающимися классами:
 * `.*.*.*!`, `x+x+y`, `\w*\w*\w*!`, в том числе замаскированную обёрткой в
 * группу: `(?:a*a*)c`, `.*(?:.*.*)!`, `(?:.*)(?:.*)(?:.*)x`, и backref-хвосты
 * `([a-z]+)[^]*\1z` (backreference повторяет группу с амбивалентной длиной
 * и после неограниченного квантификатора принуждает перебор разбиений).
 *
 * Соседние квантификаторы по пересекающимся классам без разделителя между ними
 * дают перебор всех разбиений строки: на неудачном входе это блокировка
 * event loop на минуты. При этом:
 * - цепочка из 2 + потребляющий хвост опасна всегда (`.*.*!`, `x+x+y`);
 * - цепочка из 3+ БЕЗ хвоста опасна только с последующим якорем `$`/`\Z`/`\z`
 *   (`\w+\w+\w+$`), а без якоря V8 завершает early-exit (`.*.*.*` — 0 мс)
 *   и блокировать её незачем: цепочка «запоминается» (chain3) и детонирует
 *   только встретив конец-строчный якорь;
 * - цепочка с непересекающимися классами (`[a-z]+[0-9]+x`) безопасна — точки
 *   разбиения принуждены литералами;
 * - ограниченные интервалы (`{n}`, `{n,m}`, `?`) не порождают перебора и цепочку рвут.
 */
function scanQuantifierChain(pattern: string, depth: number): IChainScan {
    if (depth > 5) {
        // Реальные команды глубже 5 уровней вложенности не заходят;
        // отдельный лимит вложенности есть в isRegexLikelySafe.
        return { dangerous: false, tailRun: 0, tailAtom: null };
    }
    let run = 0;
    let prevAtom: TPatternAtom | null = null;
    let chain3 = false; // цепочка 3+ без хвоста — опасна только с последующим $
    let i = 0;
    while (i < pattern.length) {
        const parsed = parseAtom(pattern, i);
        if (!parsed) {
            // Якорь конца строки детонирует отложенную цепочку 3+:
            // `\w+\w+\w+$` перебирает все разбиения до конца текста.
            if (chain3 && isEndTextAnchor(pattern, i)) {
                return { dangerous: true, tailRun: 0, tailAtom: null };
            }
            // Не атом: квантификатор без атома, якорь, `|`, `)`, пробел-разделитель.
            // Пробел и альтернатива принуждают точку разбиения — цепочка рвётся.
            i++;
            run = 0;
            prevAtom = null;
            chain3 = false;
            continue;
        }
        i = parsed.next;
        // Backreference — два вектора: после неограниченного квантификатора
        // (`([a-z]+)[^]*\1z` — \1 повторяет группу амбивалентной длины и
        // завершает перебор разбиений) и квантифицированный сам по себе
        // (`(\w+)z\1{2,}` — квадратичный бэктрекинг, см. isQuantifiedBackreference).
        if (parsed.isBackreference && (run >= 1 || isQuantifiedBackreference(pattern, i))) {
            return { dangerous: true, tailRun: 0, tailAtom: null };
        }
        // Тело группы анализируем рекурсивно: лестница внутри `(?:a*a*)`
        // невидима, если парсить группу как один непрозрачный атом. Хвост
        // цепочки (tailRun) склеивается с внешними атомами — именно так
        // ловится `(?:a*a*)c`: пара внутри группы + хвост снаружи.
        let groupTailRun = 0;
        let groupTailAtom: TPatternAtom | null = null;
        if (parsed.innerBody !== undefined) {
            const inner = scanQuantifierChain(parsed.innerBody, depth + 1);
            if (inner.dangerous) {
                return { dangerous: true, tailRun: 0, tailAtom: null };
            }
            groupTailRun = inner.tailRun;
            groupTailAtom = inner.tailAtom;
        }
        const quant = readQuantifier(pattern, i);
        i = quant.next;
        if (quant.isQuantified) {
            if (!quant.isUnbounded) {
                // Ограниченный интервал не порождает перебора — цепочка рвётся
                run = 0;
                prevAtom = null;
                chain3 = false;
                continue;
            }
            if (prevAtom && atomsOverlap(prevAtom, parsed.atom)) {
                run++;
            } else {
                run = 1;
            }
            // Незаквантифицированная группа несёт хвост цепочки изнутри;
            // для квантифицированной группы внутренняя цепочка умножается
            // внешним повтором — складываем один раз.
            if (groupTailRun > 0) {
                run += groupTailRun;
            }
            prevAtom = parsed.atom;
            if (run >= 3) {
                chain3 = true;
            }
        } else if (run + groupTailRun >= 2) {
            // Атом без квантификатора — «хвост», который может несовпасть и
            // запустить перебор разбиений. Цепочка может быть набрана и из
            // внешних атомов, и из хвоста внутри незаквантифицированной группы:
            // `(?:.*)(?:.*)x` — по одному `.*` в каждой группе + внешний хвост.
            return { dangerous: true, tailRun: 0, tailAtom: null };
        } else {
            chain3 = false;
            if (groupTailRun > 0) {
                // Группа с одиночной цепочкой внутри + внешний атом без
                // квантификатора: хвост группы «перезапускает» внешнюю цепочку
                run = groupTailRun;
                prevAtom = groupTailAtom ?? parsed.atom;
            } else {
                run = 0;
                prevAtom = null;
            }
        }
    }
    return { dangerous: false, tailRun: run, tailAtom: prevAtom };
}

/**
 * Публичная обёртка: опасен ли паттерн по правилам квантификаторных лестниц.
 */
function hasSequentialQuantifierChain(pattern: string): boolean {
    return scanQuantifierChain(pattern, 0).dangerous;
}

/**
 * Пропускает интервальный квантификатор `{n}`/`{n,}`/`{n,m}`. Возвращает i, если это не интервал.
 */
function skipInterval(pattern: string, i: number): number {
    let k = i + 1;
    while (k < pattern.length && /\d/.test(pattern.charAt(k))) {
        k++;
    }
    if (k === i + 1) {
        return i;
    }
    if (pattern.charAt(k) === ',') {
        k++;
        while (k < pattern.length && /\d/.test(pattern.charAt(k))) {
            k++;
        }
    }
    return pattern.charAt(k) === '}' ? k + 1 : i;
}

/**
 * Идёт от закрывающей скобки назад к парной открывающей с учётом
 * вложенности и экранирования. Возвращает индекс `(` или -1.
 */
function findGroupStart(pattern: string, closeIndex: number): number {
    let depth = 0;
    for (let k = closeIndex; k >= 0; k--) {
        // Текущий символ экранирован нечётным числом бэкслешей — пропускаем пару
        let backslashes = 0;
        let t = k - 1;
        while (t >= 0 && pattern[t] === '\\') {
            backslashes++;
            t--;
        }
        if (backslashes % 2 === 1) {
            k = t + 1;
            continue;
        }
        const ch = pattern[k];
        if (ch === ')' && k !== closeIndex) {
            depth++;
        } else if (ch === '(') {
            if (depth === 0) {
                return k;
            }
            depth--;
        }
    }
    return -1;
}

/**
 * Пропускает префикс конструкции группы: (?:, (?=, (?!, (?<=, (?<!, (?<name>.
 * Иначе '?' из '(?:' ложно принимался за квантификатор внутри группы.
 */
function skipGroupPrefix(body: string): number {
    if (body[0] !== '?') {
        return 0;
    }
    if (body[1] === '<') {
        const close = body.indexOf('>', 2);
        return close === -1 ? body.length : close + 1;
    }
    return 2;
}

/**
 * Проверяет тело группы на источники катастрофического бэктрекинга:
 * НЕОГРАНИЧЕННЫЙ квантификатор (`+`, `*`, `{n,}`), альтернативу `|` или
 * «любой символ» `.` вне символьных классов.
 *
 * Ограниченные интервалы (`{n}`, `{n,m}`) перебора разбиений сами по себе
 * не порождают: `(\d{1,3}\.){3}\d{1,3}` (IP-адрес) — легитимный паттерн.
 * Неоднозначные разбиения без `+`/`|`/`.` в теле проверяет
 * isAmbiguousLoopBody: `(?:a?b?)+c` перебирает ~2^n разбиений. Разделение
 * проведено по той же границе, что и в readQuantifier: `{n,}` без верхней
 * границы — неограниченный, `{n}`/`{n,m}` — ограниченные.
 */
function isExplosiveGroupBody(body: string): boolean {
    const start = skipGroupPrefix(body);
    let inClass = false;
    for (let k = start; k < body.length; k++) {
        const ch = body.charAt(k);
        if (ch === '\\') {
            // Backreference/escape после бэкслеша: \1, \k<name> — повтор группы
            // с амбивалентной длиной. Квантифицированный backreference — источник
            // катастрофического бэктрекинга.
            if (k + 1 < body.length && /[1-9]/.test(body.charAt(k + 1))) {
                return true;
            }
            k++;
            continue;
        }
        if (ch === '[') {
            inClass = true;
            // `[^]` — «любой символ», включая перевод строки: эквивалент `.` с s-флагом.
            // Классический строительный блок лестниц: ([a-z]+)[^]*\1z.
            if (body[k + 1] === '^' && body[k + 2] === ']') {
                return true;
            }
            continue;
        }
        if (ch === ']') {
            inClass = false;
            continue;
        }
        if (ch === '{' && !inClass) {
            // Ограниченный интервал {n}/{n,m} безопасен; {n,} — неограниченный.
            const quant = readQuantifier(body, k);
            if (quant.isQuantified && quant.isUnbounded) {
                return true;
            }
            // Не-интервальная фигурная скобка (литерал `{`) — пропускаем
            k = quant.isQuantified ? quant.next - 1 : k;
            continue;
        }
        if (!inClass && (ch === '+' || ch === '*' || ch === '|' || ch === '.')) {
            return true;
        }
    }
    return false;
}

/**
 * Атом тела группы при токенизации: литеральный символ (в том числе
 * экранированный вроде `\.` или `\x41`) или «прочее» — символьный класс,
 * escape-класс (`\d`, `\w`), вложенная группа.
 */
interface ILoopAtom {
    isLiteral: boolean;
    char: string;
    /** Атом повторяется переменное число раз: `?` или `{n,m}` с max > min. */
    variable: boolean;
    /** Переменность задана квантификатором `?` (варианты {c, ''}), а не интервалом. */
    optional: boolean;
}

/**
 * Индекс символа за закрывающей `]` символьного класса, открытого на позиции
 * `start` (с учётом экранирования), либо -1, если класс не закрыт.
 */
function skipCharClass(body: string, start: number): number {
    let j = start + 1;
    if (body.charAt(j) === '^') {
        j++;
    }
    if (body.charAt(j) === ']') {
        j++;
    }
    while (j < body.length && body.charAt(j) !== ']') {
        if (body.charAt(j) === '\\') {
            j++;
        }
        j++;
    }
    return j < body.length ? j + 1 : -1;
}

/**
 * Индекс символа за закрывающей скобкой группы, открытой на позиции `start`
 * (префикс `(?:`/`(?<name>` пропускается), либо -1, если группа не закрыта.
 */
function skipGroupBody(body: string, start: number): number {
    let depth = 1;
    let j = start + 1;
    if (body.charAt(j) === '?') {
        if (body.charAt(j + 1) === '<') {
            const close = body.indexOf('>', j + 2);
            if (close === -1) {
                return -1;
            }
            j = close + 1;
        } else {
            j += 2;
        }
    }
    while (j < body.length && depth > 0) {
        if (body.charAt(j) === '\\') {
            j += 2;
            continue;
        }
        if (body.charAt(j) === '[') {
            const afterClass = skipCharClass(body, j);
            if (afterClass === -1) {
                return -1;
            }
            j = afterClass;
            continue;
        }
        if (body.charAt(j) === '(') {
            depth++;
        }
        if (body.charAt(j) === ')') {
            depth--;
        }
        j++;
    }
    return depth === 0 ? j : -1;
}

/**
 * Односимвольные escape с реальным символом: буквенное обозначение совпадает
 * с самим литералом (`\t` — таб и т.д.). Остальные буквенные escape (`\d`,
 * `\p`, `\c`, неизвестные) — не одиночный символ.
 */
const ESCAPE_CHAR_MAP: Readonly<Record<string, string>> = {
    t: '\t',
    n: '\n',
    r: '\r',
    f: '\f',
    v: '\v',
};

/**
 * Разбирает escape-последовательность в атом тела цикла. Литеральные escape
 * хранят РЕАЛЬНЫЙ символ (`\x41` — «A», а не буква «x»): иначе проверка
 * соседних литералов в isAmbiguousLoopBody сравнивала бы не те символы и
 * пропускала паттерны вида `(?:A?\x41)+` — эквивалент опасного `(?:A?A)+`.
 * Не поддаётся декодированию — не-литеральный атом (консервативно опасная
 * сторона).
 */
function readEscapeAtom(body: string, k: number): { atom: ILoopAtom; length: number } | null {
    const next = body.charAt(k + 1);
    if (!next) {
        return null;
    }
    const literal = (char: string, length: number): { atom: ILoopAtom; length: number } => ({
        atom: { isLiteral: true, char, variable: false, optional: false },
        length,
    });
    const notLiteral = (length: number): { atom: ILoopAtom; length: number } => ({
        atom: { isLiteral: false, char: '', variable: false, optional: false },
        length,
    });
    // До 4 hex-цифр: BMP — ровно один JS-символ. Суррогатные пары (\u{...}
    // из 5-6 цифр) посимвольной модели не соответствуют — консервативно
    // не-литерал.
    const hex = (text: string): string | null =>
        /^[0-9a-fA-F]{1,4}$/.test(text) ? String.fromCharCode(parseInt(text, 16)) : null;
    if (next === 'x') {
        const char = hex(body.slice(k + 2, k + 4));
        return char !== null && body.slice(k + 2, k + 4).length === 2
            ? literal(char, 4)
            : notLiteral(2);
    }
    if (next === 'u') {
        if (body.charAt(k + 2) === '{') {
            const close = body.indexOf('}', k + 3);
            const char = close === -1 ? null : hex(body.slice(k + 3, close));
            return char !== null ? literal(char, close + 1 - k) : notLiteral(2);
        }
        const char = hex(body.slice(k + 2, k + 6));
        return char !== null && body.slice(k + 2, k + 6).length === 4
            ? literal(char, 6)
            : notLiteral(2);
    }
    // Цифры — ссылки назад/восьмеричные: совпадение зависит от контекста,
    // фиксированным литералом считать нельзя
    if (next >= '0' && next <= '9') {
        return notLiteral(2);
    }
    const mapped = ESCAPE_CHAR_MAP[next];
    if (mapped) {
        return literal(mapped, 2);
    }
    // \d/\w/\s/\p/\c и прочие буквенные — классы или конструкции с широким набором
    if (/[a-zA-Z]/.test(next)) {
        return notLiteral(2);
    }
    // Экранированная пунктуация — литерал самой себя (\. — точка)
    return literal(next, 2);
}

/**
 * Разбирает тело группы на атомы с учётом квантификаторов. Вложенные группы
 * консервативно считаются единым не-литеральным атомом (префикс `(?:`/`(?<name>`
 * не литерал). Возвращает null, если тело не разобралось, — вызывающий считает
 * его опасным.
 */
function tokenizeLoopBody(body: string): ILoopAtom[] | null {
    const atoms: ILoopAtom[] = [];
    let k = skipGroupPrefix(body);
    while (k < body.length) {
        const ch = body.charAt(k);
        if (ch === '\\') {
            const escaped = readEscapeAtom(body, k);
            if (!escaped) {
                return null;
            }
            atoms.push(escaped.atom);
            k += escaped.length;
        } else if (ch === '[') {
            const afterClass = skipCharClass(body, k);
            if (afterClass === -1) {
                return null;
            }
            atoms.push({ isLiteral: false, char: '', variable: false, optional: false });
            k = afterClass;
        } else if (ch === '(') {
            const afterGroup = skipGroupBody(body, k);
            if (afterGroup === -1) {
                return null;
            }
            atoms.push({ isLiteral: false, char: '', variable: false, optional: false });
            k = afterGroup;
        } else {
            atoms.push({ isLiteral: true, char: ch, variable: false, optional: false });
            k++;
        }
        const last = atoms[atoms.length - 1];
        if (!last) {
            return null;
        }
        if (body.charAt(k) === '?') {
            last.variable = true;
            last.optional = true;
            k++;
            if (body.charAt(k) === '?') {
                k++; // ленивый модификатор
            }
        } else if (body.charAt(k) === '{') {
            const bounds = getIntervalBounds(body, k);
            if (bounds) {
                if (bounds.max > bounds.min) {
                    last.variable = true;
                }
                k = skipInterval(body, k);
            }
        }
        // +/*/{n,} сюда не доходят: isExplosiveGroupBody отсеивает их раньше
    }
    return atoms;
}

/**
 * Может ли повторяемое тело (под неограниченным квантификатором или большим
 * фиксированным интервалом) разбивать строку НЕОДНОЗНАЧНО — источник перебора
 * разбиений без `+`/`|`/`.` в теле. При переменной длине повтора число
 * разбиений растёт как числа Фибоначчи: `(?:\d\d?)+` — каждый повтор съедает
 * 1 или 2 цифры того же класса, 40 символов блокируют поток на ~20 с;
 * `(?:a?b?)+` — ~2^n.
 *
 * Два и более переменных атомов — всегда неоднозначно. Один переменный атом
 * безопасен, только если тело целиком литеральное и его соседние литералы
 * отличны от него (с учётом перехода через границу повторов): части
 * разбиения привязаны к позициям обязательных символов. `(ab?)`, `(a?b)`,
 * `(a?)` — безопасны; `(aa?)`, `(aba?)`, `(\d\d?)`, `([ab]a?)`,
 * `(\d{4}(-\d{2})?)` — неоднозначны. Одиночный атом с `?` даёт варианты
 * {c, ''}: пустая итерация завершает цикл, разбиение одно; одиночный атом с
 * интервалом (`(a{1,3})`) даёт несколько непустых вариантов длины —
 * неоднозначен (трибоначчи под 100 повторами).
 */
function isAmbiguousLoopBody(body: string): boolean {
    const atoms = tokenizeLoopBody(body);
    if (!atoms) {
        return true;
    }
    const variableCount = atoms.filter((a) => a.variable).length;
    if (variableCount === 0) {
        return false;
    }
    if (variableCount >= 2) {
        // Переменные атомы дают несколько вариантов длины на каждый повтор —
        // соседние литералы не спасают: (a?b?) перебирает разбиения даже
        // с различными соседями
        return true;
    }
    // Единственный переменный атом: доказательство однозначности — только
    // для тела из одних литералов
    if (!atoms.every((a) => a.isLiteral)) {
        return true;
    }
    const index = atoms.findIndex((a) => a.variable);
    const atom = atoms[index];
    if (!atom) {
        return true;
    }
    if (atoms.length === 1) {
        // Единственный литеральный атом: безопасен только квантификатор '?'
        // (варианты {c, ''}); интервал даёт несколько непустых вариантов
        return !atom.optional;
    }
    const prev = atoms[index - 1] ?? atoms[atoms.length - 1];
    const next = atoms[index + 1] ?? atoms[0];
    if (!prev || !next) {
        return true;
    }
    return prev.char === atom.char || next.char === atom.char;
}

/**
 * Ищет квантифицированные группы с внутренними источниками катастрофического
 * бэктрекинга: НЕОГРАНИЧЕННЫЙ квантификатор (`+`, `*`, `{n,}`), альтернативу `|`
 * или «любой символ» `.` внутри группы, которая сама квантифицирована —
 * классика вида `(a+)+`, `(a|aa)+`, `(\w+\.)+`.
 *
 * Отдельный случай: ЛЮБОЙ интервальный квантификатор внутри группы,
 * повторённой неограниченным квантификатором (`(?:a{2,3})+`): интервал даёт
 * повторы переменной длины, а внешний `+` перебирает все разбиения.
 * IP-паттерн `(\d{1,3}\.){3}` сюда не попадает — его внешний квантификатор
 * фиксирован (`{3}`), перебора разбиений он не порождает.
 *
 * И ещё один: повтор переменной длины (`{n,m}`, `?`) внутри группы с переменным
 * внешним интервалом — `(a{1,10}){1,10}`, `(a?){2,8}`.
 *
 * И два последних без `+`/`|`/`.` в теле группы: два и более атомов переменной
 * длины (`?`, `{n,m}`) под неограниченным внешним квантификатором —
 * `(?:a?b?)+`, `(?:\d?\w?)+@`; фиксированный внешний интервал с `max >= 10`
 * и неоднозначным разбиением тела — `(?:a?b?){26}`, `(a{1,3}){100}`
 * (заякоренные тела вида `(a{1,3}b){20}` остаются разрешёнными). Порог 10:
 * при меньшем числе повторов перебор разбиений полиномиален и потока
 * не блокирует.
 *
 * Простые `(abc)+` и `(.{2})` с фиксированным интервалом безопасны.
 */
function hasDangerousQuantifiedGroup(pattern: string): boolean {
    for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] === '\\') {
            i++;
            continue;
        }
        if (pattern[i] !== ')') {
            continue;
        }
        const quant = readQuantifier(pattern, i + 1);
        if (!quant.isQuantified) {
            continue;
        }
        const start = findGroupStart(pattern, i);
        if (start === -1) {
            continue;
        }
        const body = pattern.slice(start + 1, i);
        if (isExplosiveGroupBody(body)) {
            return true;
        }
        // Интервал под неограниченным внешним квантификатором: (?:a{2,3})+.
        // Фиксированный внешний интервал ((a{2,3}){3}) безопасен — это
        // то же фиксированное число повторов, что и развёртка.
        if (quant.isUnbounded && hasIntervalQuantifier(body)) {
            return true;
        }
        // Повтор переменной длины под переменным внешним интервалом:
        // (a{1,10}){1,10}, (\w{1,5}){1,20}, (a?){2,8}. Это тот же класс вложенных
        // квантификаторов, что (a+)+ (OWASP), только с ограниченными границами:
        // перебор разбиений всё равно экспоненциальный — (a{1,10}){1,10}$
        // на 40 символах блокирует поток на ~20 с.
        const outer = getIntervalBounds(pattern, i + 1);
        if (outer && outer.max > outer.min && outer.max >= 2 && hasVariableRepetition(body)) {
            return true;
        }
        // Неоднозначное разбиение строки под неограниченным внешним квантификатором:
        // (?:a?b?)+ (~2^n), (?:\d\d?)+ (числа Фибоначчи — 40 символов ~20 с).
        if (quant.isUnbounded && isAmbiguousLoopBody(body)) {
            return true;
        }
        // Фиксированный или открытый внешний интервал с max >= 10 и неоднозначным
        // разбиением тела: (?:a?b?){26}, (a{1,3}){100} — число разбиений
        // экспоненциально по числу повторов. Проверка однозначности, а не
        // «есть переменный атом»: литеральный якорь в теле ((a{1,3}b){20})
        // разбиение привязывает — такой паттерн остаётся разрешённым.
        if (outer && outer.max >= 10 && isAmbiguousLoopBody(body)) {
            return true;
        }
    }
    return false;
}

/**
 * Границы интервального квантификатора `{n}`, `{n,m}`, `{n,}` в позиции i.
 * @returns Границы (`max = Infinity` для `{n,}`) или null, если в позиции не интервал
 */
function getIntervalBounds(pattern: string, i: number): { min: number; max: number } | null {
    if (pattern[i] !== '{') {
        return null;
    }
    const close = skipInterval(pattern, i);
    if (close === i) {
        return null;
    }
    const [minRaw = '', maxRaw] = pattern.slice(i + 1, close - 1).split(',');
    const min = Number(minRaw);
    let max = min;
    if (maxRaw !== undefined) {
        max = maxRaw === '' ? Infinity : Number(maxRaw);
    }
    return { min, max };
}

/**
 * Есть ли в теле группы повтор переменной длины: интервал `{n,m}` с m > n
 * (или `{n,}`) либо необязательный атом `?`. `?` из префикса группы `(?:`
 * и ленивый модификатор после квантификатора (`a+?`) повтором не считаются.
 */
function hasVariableRepetition(body: string): boolean {
    for (let k = 0; k < body.length; k++) {
        const ch = body.charAt(k);
        if (ch === '\\') {
            k++;
            continue;
        }
        if (ch === '[') {
            k++;
            while (k < body.length && body.charAt(k) !== ']') {
                if (body.charAt(k) === '\\') {
                    k++;
                }
                k++;
            }
            continue;
        }
        if (ch === '{') {
            const bounds = getIntervalBounds(body, k);
            if (bounds && bounds.max > bounds.min) {
                return true;
            }
            continue;
        }
        if (ch === '?' && k > 0 && !'(+*?}'.includes(body.charAt(k - 1))) {
            return true;
        }
    }
    return false;
}

/**
 * Есть ли в теле группы интервальный квантификатор `{n}`/`{n,m}`/`{n,}`.
 * Используется для детекта `(?:a{2,3})+`: интервал переменной длины внутри
 * группы с неограниченным внешним квантификатором порождает перебор разбиений.
 */
function hasIntervalQuantifier(body: string): boolean {
    for (let k = 0; k < body.length; k++) {
        if (body.charAt(k) === '\\') {
            k++;
            continue;
        }
        if (body.charAt(k) === '[') {
            // Класс символов: до закрывающей `]` (с учётом экранирования)
            k++;
            while (k < body.length && body.charAt(k) !== ']') {
                if (body.charAt(k) === '\\') {
                    k++;
                }
                k++;
            }
            continue;
        }
        if (body.charAt(k) === '{') {
            const quant = readQuantifier(body, k);
            if (quant.isQuantified) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Проверяет регулярное выражение на потенциальные ReDoS-уязвимости.
 *
 * Использует эвристический анализ для выявления опасных паттернов:
 * - Вложенные квантификаторы: (a+)+, (a*)*, (a|aa)+
 * - Квантифицированные группы с квантификатором/альтернативой/точкой внутри
 * - Альтернативы с пересекающимися паттернами: (a|aa)
 * - Повторяющиеся квантифицируемые группы: (a+){10,100}
 * - Интервалы под квантификатором: (?:a{2,3})+
 * - Слишком глубокая вложенность скобок (>5 уровней)
 * - Слишком длинные шаблоны (>1000 символов)
 *
 * @param {string} pattern - Регулярное выражение для проверки (при isRegex=true — source уже скомпилированного RegExp)
 * @param {boolean} isRegex - Если true, pattern — source уже скомпилированного RegExp (пропуск проверки компиляции)
 * @returns {boolean} true если выражение вероятно безопасно, false если обнаружена потенциальная уязвимость
 */
export function isRegexLikelySafe(pattern: string, isRegex: boolean): boolean {
    try {
        if (!isRegex) {
            new RegExp(pattern);
        }
        // 1. Защита от слишком длинных шаблонов (DoS через размер)
        if (pattern.length > 1000) {
            return false;
        }

        // 2. Основные ReDoS-эвристики

        // Квантифицированная группа с «взрывным» содержимым: (a+)+, (a|aa)+, (.*x)+
        if (hasDangerousQuantifiedGroup(pattern)) {
            return false;
        }

        // Лестница квантифицированных атомов с пересекающимися классами:
        // .*.*.*x, x+x+y, \w*\w*\w*! — источник n²–n³ бэктрекинга без групп
        if (hasSequentialQuantifierChain(pattern)) {
            return false;
        }

        // Интервал под квантификатором: (?:a{2,3})+
        if (REG_INTERVAL_QUANTIFIED.test(pattern)) {
            return false;
        }

        // Альтернативы с пересекающимися паттернами: (a|aa), (a|a+)
        // Простой признак: один терм — префикс другого
        // Точное определение сложно без AST, но часто такие паттерны содержат:
        // - `|` внутри группы + повторяющиеся символы
        const hasPipeInGroup = REG_PIPE.test(pattern);
        if (hasPipeInGroup) {
            // Дополнительная эвристика: есть ли повторяющиеся символы или квантификаторы?
            if (REG_EV1.test(pattern)) {
                return false;
            }
            if (REG_EV2.test(pattern)) {
                return false;
            }
        }

        // Повторяющиеся квантифицируемые группы: (a+){10,100}
        if (REG_REPEAT.test(pattern)) {
            return false;
        }

        // Слишком глубокая вложенность скобок — признак сложности
        let depth = 0;
        let maxDepth = 0;
        for (let i = 0; i < pattern.length; i++) {
            if (pattern[i] === '\\' && i + 1 < pattern.length) {
                i++; // пропускаем экранированный символ
                continue;
            }
            if (pattern[i] === '(') {
                depth++;
            } else if (pattern[i] === ')') {
                depth--;
            }
            if (depth < 0) {
                return false; // некорректная скобочная структура
            }
            if (depth > maxDepth) {
                maxDepth = depth;
            }
        }
        return maxDepth <= 5;
    } catch {
        return false;
    }
}
