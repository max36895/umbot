/**
 * Индекс строковых слотов и префильтр регулярок (план поиска команд).
 *
 * Главный инвариант префильтра: он может только отсеять заведомо несовпадающие
 * проверки. Если регулярка совпала с текстом, её обязательная подстрока обязана
 * найтись в тексте — иначе команда молча перестала бы срабатывать.
 */
import { LiteralIndex, LiteralSet } from '../../src/core/utils/LiteralIndex';
import {
    foldCode,
    foldString,
    groupSourceLiterals,
    requiredLiteral,
} from '../../src/core/utils/RegexPrefilter';

describe('LiteralIndex', () => {
    it('возвращает минимальную позицию команды, чей слот входит в текст', () => {
        const index = new LiteralIndex([
            ['пицца', 5],
            ['заказ', 2],
            ['доставка', 9],
        ]);
        // «доставка» стоит в тексте раньше, но команда «заказ» зарегистрирована раньше.
        expect(index.firstMatch('доставка и заказ пиццы')).toBe(2);
        expect(index.firstMatch('только доставка')).toBe(9);
        expect(index.firstMatch('ничего нет')).toBe(-1);
    });

    it('находит вложенные и перекрывающиеся слоты через суффиксные ссылки', () => {
        const index = new LiteralIndex([
            ['abcd', 3],
            ['bc', 1],
            ['cde', 0],
        ]);
        expect(index.firstMatch('xabcx')).toBe(1);
        expect(index.firstMatch('abcde')).toBe(0);
        expect(index.firstMatch('abcd')).toBe(1);
    });

    it('пустой слот входит в любой текст (как text.includes(""))', () => {
        const index = new LiteralIndex([
            ['слово', 0],
            ['', 4],
        ]);
        expect(index.firstMatch('что угодно')).toBe(4);
        expect(index.firstMatch('слово')).toBe(0);
        expect(index.firstMatch('')).toBe(4);
    });

    it('без слотов ничего не находит', () => {
        expect(new LiteralIndex([]).firstMatch('текст')).toBe(-1);
    });
});

describe('LiteralSet', () => {
    it('находит все подстроки, в том числе с разным регистром текста', () => {
        const set = new LiteralSet(['cmd_1', 'cmd_12', 'md_1', 'нет']);
        set.scan('Вызов CMD_12');
        expect(set.has(0)).toBe(true);
        expect(set.has(1)).toBe(true);
        expect(set.has(2)).toBe(true);
        expect(set.has(3)).toBe(false);
        expect(Array.from(set.matched.subarray(0, set.matchedCount)).sort()).toEqual([0, 1, 2]);
    });

    it('результат относится только к последнему scan', () => {
        const set = new LiteralSet(['альфа', 'бета']);
        set.scan('альфа');
        expect(set.has(0)).toBe(true);
        set.scan('бета');
        expect(set.has(0)).toBe(false);
        expect(set.has(1)).toBe(true);
        expect(set.matchedCount).toBe(1);
    });
});

describe('foldCode / foldString', () => {
    it('сворачивает ASCII и кириллицу к нижнему регистру', () => {
        expect(foldString('AbЯЁё_1')).toBe('abяёё_1');
    });

    it('учитывает символы, совпадающие с базовыми буквами при флаге iu', () => {
        // Знак Кельвина и длинная s: /k/iu и /s/iu совпадают с ними.
        expect(String.fromCharCode(foldCode(0x212a))).toBe('k');
        expect(String.fromCharCode(foldCode(0x17f))).toBe('s');
        // Старое начертание «в» (U+1C80): /в/iu совпадает с ним.
        expect(String.fromCharCode(foldCode(0x1c80))).toBe('в');
        expect(/k/iu.test('K')).toBe(true);
    });
});

describe('requiredLiteral', () => {
    it.each([
        ['zz_cmd_5_\\d+', 'i', 'zz_cmd_5_'],
        ['купить\\s+(\\d+) штук', 'ium', 'купить'],
        ['ab\\.cd', '', 'ab.cd'],
        ['ПРИВЕТ', 'i', 'привет'],
        ['abcde?', '', 'abcd'],
        ['[xyz]abc(?:de|fg)hij', '', 'abc'],
        ['x{2}yyyy', '', 'yyyy'],
    ])('%s (%s) → %s', (source, flags, expected) => {
        expect(requiredLiteral(source, flags)).toBe(expected);
    });

    it.each([
        ['(да|нет)', 'i'],
        ['да|нет', 'i'],
        ['\\d+', ''],
        ['ab', ''],
        ['abc{x', ''],
        ['abc', 'v'],
        ['abc\\qdef', ''],
        ['[abc', ''],
    ])('%s (%s) → null: обязательной подстроки нет или разбор ненадёжен', (source, flags) => {
        expect(requiredLiteral(source, flags)).toBeNull();
    });

    it('режет подстроку по символам вне безопасного набора', () => {
        expect(requiredLiteral('abcΩdefgh', '')).toBe('defgh');
    });

    it('свойство: совпадение регулярки ⇒ обязательная подстрока есть в свёрнутом тексте', () => {
        // Детерминированный генератор: воспроизводимо и без внешних зависимостей.
        let seed = 12345;
        const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)] as T;
        const chars = ['a', 'b', 'k', 's', 'A', 'K', 'S', 'я', 'Я', 'в', 'ё', '1', '_', ' '];
        const exotic = ['K', 'ſ', 'ᲀ', 'Ω'];
        const atom = (depth: number): string => {
            const r = rnd();
            if (r < 0.5) {
                return pick(chars);
            }
            if (r < 0.6) {
                return pick(['\\d', '\\w', '.', '\\b']);
            }
            if (r < 0.68) {
                return '[' + pick(['a-z', 'ab', '^k', 'я-ё']) + ']';
            }
            if (r < 0.8 && depth < 2) {
                return '(' + seq(depth + 1) + '|' + seq(depth + 1) + ')';
            }
            return pick(chars);
        };
        const seq = (depth: number): string => {
            let s = '';
            const n = 1 + Math.floor(rnd() * 6);
            for (let i = 0; i < n; i++) {
                s += atom(depth) + pick(['', '', '', '+', '*', '?', '{1,2}']);
            }
            return s;
        };
        let positives = 0;
        for (let k = 0; k < 3000; k++) {
            const source = seq(0);
            const flags = pick(['', 'i', 'iu', 'ium']);
            let re: RegExp;
            try {
                re = new RegExp(source, flags);
            } catch {
                // Генератор иногда строит недопустимое для флага u (например, `\b*`).
                continue;
            }
            const lit = requiredLiteral(source, flags, 1);
            if (lit === null) {
                continue;
            }
            for (let t = 0; t < 20; t++) {
                let text = '';
                for (let i = 0; i < 10; i++) {
                    text += rnd() < 0.1 ? pick(exotic) : pick(chars);
                }
                if (rnd() < 0.5) {
                    text =
                        text.slice(0, 3) + (rnd() < 0.5 ? lit.toUpperCase() : lit) + text.slice(3);
                }
                if (re.test(text)) {
                    positives++;
                    expect(foldString(text).includes(lit)).toBe(true);
                }
            }
        }
        expect(positives).toBeGreaterThan(500);
    });
});

describe('groupSourceLiterals', () => {
    it('возвращает подстроки слотов каждой альтернативы группы', () => {
        expect(groupSourceLiterals('(?<_0>(купить\\d)|(заказ))|(?<_1>(отмена))', 'ium')).toEqual([
            'купить',
            'заказ',
            'отмена',
        ]);
    });

    it('null, если хотя бы у одного слота нет обязательной подстроки', () => {
        expect(groupSourceLiterals('(?<_0>(купить))|(?<_1>(\\d+))', 'ium')).toBeNull();
        expect(groupSourceLiterals(undefined, 'ium')).toBeNull();
        expect(groupSourceLiterals('не группа', 'ium')).toBeNull();
    });
});
