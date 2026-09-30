type TRe2 = RegExpConstructor;
let Re2: TRe2;
/**
 * Флаг, говорящий о том, используется ли `re2` для обработки регулярных выражений.
 * Экспортируется наружу, чтобы потребители могли адаптировать ограничения
 * под наличие/отсутствие `re2`.
 *
 * @example
 * ```ts
 * import { __$usedRe2 } from 'umbot/utils';
 *
 * // Без re2 сложные пользовательские шаблоны опаснее (ReDoS) — ограничиваем их длину.
 * const maxPatternLength = __$usedRe2 ? 1000 : 200;
 * ```
 */
let __$usedRe2: boolean;
try {
    // Условная загрузка так как не всем нужен re2.
    // На чистой винде, чтобы установить re2, нужно пострадать.
    // Чтобы сильно не париться, даем возможность разработчикам самим подключить re2 по необходимости.
    Re2 = require('re2');
    __$usedRe2 = true;
} catch {
    Re2 = RegExp;
    __$usedRe2 = false;
}

type customRegExp = RegExp;

/**
 * Тип для регулярного выражения
 */
export type TPatternRegExp = string | RegExp;

/**
 * Проверяет передано ли регулярное выражение или нет
 * @param {TPatternRegExp | unknown} regExp - Проверяемое значение
 * @returns {regExp is RegExp} true если значение является регулярным выражением
 */
export function isRegex(regExp: TPatternRegExp | unknown): regExp is RegExp {
    return !!(
        regExp &&
        typeof (regExp as RegExp).test === 'function' &&
        typeof (regExp as RegExp).exec === 'function'
    );
}

/**
 * Убирает флаги `g` и `y` из набора флагов регулярного выражения.
 *
 * Оба флага делают `RegExp` объектом с состоянием: `test`/`exec` двигают `lastIndex`,
 * поэтому один и тот же скомпилированный объект на следующем вызове начинает поиск
 * не с начала строки. Фреймворк кэширует регулярки между запросами, а искать нужно
 * всегда по всей строке — состояние здесь только вредит.
 *
 * @param flags Исходные флаги
 * @returns Флаги без `g` и `y`
 */
function getStatelessFlags(flags: string): string {
    if (!flags.includes('g') && !flags.includes('y')) {
        return flags;
    }
    return flags.replace(/[gy]/g, '');
}

/**
 * Возвращает скомпилированное регулярное выражение.
 * Если к проекту подключен re2, будет использоваться он, в противном случае стандартный RegExp.
 * В случае, если передан customReg, регулярное выражение будет собрано через него.
 * Если передан RegExp (или массив из одного RegExp), берутся его собственные флаги
 * вместо аргумента flags; флаги g/y отбрасываются (см. getStatelessFlags).
 * Если re2 не поддерживает синтаксис выражения (lookaround, обратные ссылки),
 * выражение пересобирается штатным RegExp — регистрацию команды это не должно ломать.
 * @param {TPatternRegExp | TPatternRegExp[]} reg - Регулярное выражение или массив выражений
 * @param {string} flags - Флаги для регулярного выражения (по умолчанию: 'ium')
 * @param {RegExpConstructor} [customReg] - Произвольная реализация для обработки регулярных выражений
 * @returns {customRegExp} Скомпилированное регулярное выражение
 * @throws {SyntaxError} Некомпилируемый шаблон (без re2 — некомпилируемый и для штатного движка)
 */
export function getRegExp(
    reg: TPatternRegExp | TPatternRegExp[],
    flags: string = 'ium',
    customReg?: RegExpConstructor,
): customRegExp {
    let pattern;
    let flag = flags;
    const getPattern = (pat: TPatternRegExp): string => {
        return isRegex(pat) ? pat.source : pat;
    };

    if (Array.isArray(reg)) {
        if (reg.length === 1) {
            const single = reg[0];
            if (single !== undefined) {
                pattern = getPattern(single);
                flag = isRegex(single) ? single.flags : flags;
            } else {
                // Дырявый массив с единственным элементом — компилируем пустой
                // шаблон: new RegExp('') валиден и матчит пустую строку.
                pattern = '';
            }
        } else {
            const aPattern: string[] = [];
            reg.forEach((r) => {
                aPattern.push(`(${getPattern(r)})`);
            });
            pattern = aPattern.join('|');
        }
    } else {
        pattern = getPattern(reg);
        flag = isRegex(reg) ? reg.flags : flags;
    }
    flag = getStatelessFlags(flag);
    if (customReg) {
        return new customReg(pattern, flag);
    }
    try {
        return new Re2(pattern, flag);
    } catch {
        // Fix: re2 не поддерживает lookaround и обратные ссылки — раньше конвейер
        // команд (склейка слотов, группы, isPattern-строки) падал SyntaxError
        // при регистрации команды у пользователя с re2. Откат на штатный RegExp
        // повторяет политику getRegExpOrSelf для одиночных слотов: выражение,
        // которое безопасный движок не умеет компилировать, выполняется нативно.
        // Небезопасные шаблоны при этом остаются под контролем isDangerRegex
        // (CommandReg логирует их до компиляции, strictMode отбрасывает).
        // Сравнение ошибки по instanceof SyntaxError невозможно: нативный модуль
        // re2 бросает ошибку из другого realm (jest-песочница, worker), где
        // instanceof всегда false. По-настоящему битый шаблон бросит SyntaxError
        // уже из нативного RegExp — контракт @throws сохраняется.
        return new RegExp(pattern, flag);
    }
}

/**
 * Возвращает RegExp напрямую, если передан объект RegExp без флагов g/y,
 * не задан customReg и не подключён re2, иначе компилирует через getRegExp.
 * g/y хранят позицию поиска в lastIndex и небезопасны для переиспользования,
 * поэтому такие объекты пересобираются. Избегает повторной компиляции regexp
 * при повторной обработке одного и того же объекта.
 *
 * При подключённом re2 нативный объект пересобирается через re2 — иначе
 * уязвимое к ReDoS выражение из слота команды выполнялось бы штатным движком
 * Node в обход установленного безопасного движка. Если re2 не поддерживает
 * синтаксис выражения (lookbehind, обратные ссылки), используется исходный объект.
 *
 * @param {TPatternRegExp | TPatternRegExp[]} reg - Регулярное выражение или массив выражений
 * @param {string} [flags='ium'] - Флаги для регулярного выражения (используются, если передана строка)
 * @param {RegExpConstructor} [customReg] - Произвольная реализация RegExp (если задана — всегда компилирует через неё)
 * @returns {customRegExp} Исходный RegExp (если он stateless, без customReg и без re2) либо скомпилированное выражение
 */
export function getRegExpOrSelf(
    reg: TPatternRegExp | TPatternRegExp[],
    flags: string = 'ium',
    customReg?: RegExpConstructor,
): customRegExp {
    // Regexp с g/y хранит позицию поиска в lastIndex, поэтому такой объект нельзя
    // переиспользовать между запросами — пересобираем его без флагов состояния.
    if (!Array.isArray(reg) && isRegex(reg) && !customReg && !reg.global && !reg.sticky) {
        if (!__$usedRe2) {
            return reg;
        }
        try {
            return new Re2(reg.source, reg.flags);
        } catch {
            return reg;
        }
    }
    return getRegExp(reg, flags, customReg);
}

export { __$usedRe2 };
