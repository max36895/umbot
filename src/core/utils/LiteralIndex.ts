/**
 * Автоматы Ахо–Корасик для поиска команд по подстрокам.
 *
 * Бор хранится в плоских типизированных массивах (CSR): дети узла — отрезок
 * массивов кодов и узлов, отсортированный по коду (бинарный поиск). Поиск не
 * аллоцирует, память — порядка 20 байт на узел. Модуль внутренний: используется
 * планом поиска CommandReg и не входит в публичный API.
 */
import { foldCode } from './RegexPrefilter';

/** Нет значения (нет позиции / нет узла). */
const NONE = 0x7fffffff;

/**
 * Бор с суффиксными ссылками.
 */
interface ITrie {
    childStart: Int32Array;
    childCount: Int32Array;
    childCode: Uint16Array;
    childNode: Int32Array;
    /** Суффиксная ссылка узла */
    fail: Int32Array;
    /** Узлы в порядке обхода в ширину (корень первым): родитель раньше потомков */
    order: Int32Array;
    /** Номера строк, оканчивающихся в узле */
    terminal: number[][];
}

/**
 * Строит бор со ссылками неудач по набору строк.
 * @param patterns Строки (номер строки — индекс в массиве)
 * @returns Бор
 */
function buildTrie(patterns: readonly string[]): ITrie {
    // Сборка идёт на Map (только на время построения), затем упаковывается в CSR.
    const children: Map<number, number>[] = [new Map()];
    const terminal: number[][] = [[]];
    for (let id = 0; id < patterns.length; id++) {
        const pattern = patterns[id] as string;
        let node = 0;
        for (let i = 0; i < pattern.length; i++) {
            const code = pattern.charCodeAt(i);
            const map = children[node] as Map<number, number>;
            let next = map.get(code);
            if (next === undefined) {
                next = children.length;
                children.push(new Map());
                terminal.push([]);
                map.set(code, next);
            }
            node = next;
        }
        (terminal[node] as number[]).push(id);
    }
    const n = children.length;
    const childStart = new Int32Array(n);
    const childCount = new Int32Array(n);
    let edges = 0;
    for (const map of children) {
        edges += map.size;
    }
    const childCode = new Uint16Array(edges);
    const childNode = new Int32Array(edges);
    let e = 0;
    for (let i = 0; i < n; i++) {
        const map = children[i] as Map<number, number>;
        childStart[i] = e;
        childCount[i] = map.size;
        for (const code of [...map.keys()].sort((a, b) => a - b)) {
            childCode[e] = code;
            childNode[e] = map.get(code) as number;
            e++;
        }
    }
    const trie: ITrie = {
        childStart,
        childCount,
        childCode,
        childNode,
        fail: new Int32Array(n),
        order: new Int32Array(n),
        terminal,
    };
    // Ссылки неудач — обходом в ширину: у родителя ссылка уже посчитана.
    let head = 0;
    let tail = 1;
    trie.order[0] = 0;
    while (head < tail) {
        const u = trie.order[head++] as number;
        const start = childStart[u] as number;
        const count = childCount[u] as number;
        for (let k = 0; k < count; k++) {
            const code = childCode[start + k] as number;
            const v = childNode[start + k] as number;
            trie.fail[v] = u === 0 ? 0 : step(trie, trie.fail[u] as number, code);
            trie.order[tail++] = v;
        }
    }
    return trie;
}

/**
 * Ребёнок узла по коду символа.
 * @param trie Бор
 * @param node Узел
 * @param code Код символа
 * @returns Номер узла-ребёнка или -1
 */
function child(trie: ITrie, node: number, code: number): number {
    let lo = trie.childStart[node] as number;
    let hi = lo + (trie.childCount[node] as number) - 1;
    const codes = trie.childCode;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const c = codes[mid] as number;
        if (c === code) {
            return trie.childNode[mid] as number;
        }
        if (c < code) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return -1;
}

/**
 * Переход автомата: ребёнок по коду либо переход по ссылкам неудач.
 * @param trie Бор
 * @param node Текущий узел
 * @param code Код символа
 * @returns Следующий узел (0 — корень)
 */
function step(trie: ITrie, node: number, code: number): number {
    let current = node;
    for (;;) {
        const next = child(trie, current, code);
        if (next >= 0) {
            return next;
        }
        if (current === 0) {
            return 0;
        }
        current = trie.fail[current] as number;
    }
}

/**
 * Индекс строковых слотов команд: какая из команд, зарегистрированных раньше
 * остальных, содержит свой слот в тексте как подстроку. O(длина текста)
 * вместо перебора всех команд.
 */
export class LiteralIndex {
    readonly #trie: ITrie;
    /** Минимальная позиция среди строк, оканчивающихся в узле или его суффиксах */
    readonly #best: Int32Array;

    /**
     * @param patterns Слоты: `[подстрока, позиция команды в снимке]`
     */
    constructor(patterns: readonly [string, number][]) {
        this.#trie = buildTrie(patterns.map((p) => p[0]));
        const { order, fail, terminal } = this.#trie;
        this.#best = new Int32Array(order.length).fill(NONE);
        // Обход в ширину: минимум суффикса (fail) уже посчитан. Цепочка ссылок
        // заканчивается в корне, поэтому пустой слот («» — входит в любой текст)
        // учитывается во всех узлах.
        for (let k = 0; k < order.length; k++) {
            const node = order[k] as number;
            let best = k === 0 ? NONE : (this.#best[fail[node] as number] as number);
            for (const id of terminal[node] as number[]) {
                best = Math.min(best, (patterns[id] as [string, number])[1]);
            }
            this.#best[node] = best;
        }
    }

    /**
     * Минимальная позиция команды, слот которой входит в текст как подстрока.
     * @param text Текст запроса
     * @returns Позиция в снимке команд или -1, если совпадений нет
     */
    firstMatch(text: string): number {
        const trie = this.#trie;
        const best = this.#best;
        let result = best[0] as number;
        let node = 0;
        for (let i = 0; i < text.length; i++) {
            node = step(trie, node, text.charCodeAt(i));
            const b = best[node] as number;
            if (b < result) {
                result = b;
            }
        }
        return result === NONE ? -1 : result;
    }
}

/**
 * Набор подстрок с поиском всех вхождений в свёрнутом по регистру тексте
 * (см. foldCode) — основа префильтра регулярок.
 */
export class LiteralSet {
    readonly #trie: ITrie;
    /** Ближайший по суффиксным ссылкам узел, где оканчивается хотя бы одна строка */
    readonly #outLink: Int32Array;
    readonly #stamp: Uint32Array;
    #gen = 0;
    /** Номера подстрок, найденных последним {@link scan} (первые {@link matchedCount}). */
    readonly matched: Int32Array;
    /** Сколько подстрок нашёл последний {@link scan}. */
    matchedCount = 0;

    /**
     * @param literals Подстроки, уже свёрнутые foldCode (номер — индекс в массиве)
     */
    constructor(literals: readonly string[]) {
        this.#trie = buildTrie(literals);
        const { order, fail, terminal } = this.#trie;
        this.#outLink = new Int32Array(order.length).fill(-1);
        for (let k = 1; k < order.length; k++) {
            const node = order[k] as number;
            const f = fail[node] as number;
            this.#outLink[node] = (terminal[f] as number[]).length
                ? f
                : (this.#outLink[f] as number);
        }
        this.#stamp = new Uint32Array(literals.length);
        this.matched = new Int32Array(literals.length);
    }

    /**
     * Находит все подстроки набора в тексте. Результат — {@link matched} и
     * {@link has} до следующего вызова.
     * @param text Текст запроса
     */
    scan(text: string): void {
        this.#gen++;
        if (this.#gen === 0xffffffff) {
            this.#stamp.fill(0);
            this.#gen = 1;
        }
        const gen = this.#gen;
        const stamp = this.#stamp;
        const matched = this.matched;
        const trie = this.#trie;
        const terminal = trie.terminal;
        const outLink = this.#outLink;
        let count = 0;
        let node = 0;
        for (let i = 0; i < text.length; i++) {
            node = step(trie, node, foldCode(text.charCodeAt(i)));
            for (let o = node; o > 0; o = outLink[o] as number) {
                for (const id of terminal[o] as number[]) {
                    if (stamp[id] !== gen) {
                        stamp[id] = gen;
                        matched[count++] = id;
                    }
                }
            }
        }
        this.matchedCount = count;
    }

    /**
     * Входила ли подстрока в текст последнего {@link scan}.
     * @param id Номер подстроки
     * @returns true — подстрока найдена
     */
    has(id: number): boolean {
        return this.#stamp[id] === this.#gen;
    }
}
