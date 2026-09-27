/**
 * Раскладка кнопок по рядам: buttons.row().
 *
 * Раньше чат-платформы (Telegram, MAX, Viber) выводили каждую кнопку отдельной
 * строкой, и клавиатура из шести кнопок превращалась в столбик. Теперь row()
 * завершает ряд, а адаптеры выводят кнопки одного ряда в одну строку.
 */
import { AppContext, Buttons } from '../../src';
import { MaxButton, TelegramButton, ViberButton, VkButton } from '../../src/plugins';
import { layoutButtonRows } from '../../src/plugins/platforms/Base/utils';

let appContext: AppContext;
let warns: string[];
let buttons: Buttons;

beforeEach(() => {
    warns = [];
    appContext = new AppContext();
    appContext.setLogger({ log: () => {}, error: () => {}, warn: (m) => warns.push(String(m)) });
    appContext.platformParams.utm_text = '';
    buttons = new Buttons(appContext);
});

describe('Buttons.row()', () => {
    it('без row() раскладка прежняя: каждая кнопка отдельной строкой', () => {
        buttons.addBtn('Да').addBtn('Нет');
        const tg = buttons.getButtons((b) => TelegramButton.buttonProcessing(b, appContext));
        expect(tg?.keyboard).toEqual([[{ text: 'Да' }], [{ text: 'Нет' }]]);
    });

    it('кнопки до первого row() — первый ряд, после — следующий', () => {
        buttons.addBtn('Да').addBtn('Нет').row().addBtn('Помощь');
        const tg = buttons.getButtons((b) => TelegramButton.buttonProcessing(b, appContext));
        expect(tg?.keyboard).toEqual([[{ text: 'Да' }, { text: 'Нет' }], [{ text: 'Помощь' }]]);
    });

    it('явная группа кнопки сохраняется, общий объект options не мутируется', () => {
        const shared = { style: 'primary' };
        buttons.addBtn('A', '', '', shared).addBtn('B', '', '', { _group: 'own' }).row();
        expect(shared).toEqual({ style: 'primary' });
        expect(buttons.buttons[1]?.options._group).toBe('own');
    });

    it('clear() сбрасывает режим рядов', () => {
        buttons.addBtn('A').row();
        buttons.clear();
        buttons.addBtn('B').addBtn('C');
        expect(buttons.buttons.every((b) => b.options._group === undefined)).toBe(true);
    });
});

describe('ряды на платформах', () => {
    beforeEach(() => {
        buttons.addBtn('1').addBtn('2').addBtn('3').row().addBtn('4');
    });

    it('Telegram inline', () => {
        buttons.clear();
        buttons.addBtn('1', '', 'p1').addBtn('2', '', 'p2').row().addBtn('3', '', 'p3');
        const tg = buttons.getButtons((b) => TelegramButton.buttonProcessing(b, appContext));
        expect(tg?.inline_keyboard?.map((row) => row.map((b) => b.text))).toEqual([
            ['1', '2'],
            ['3'],
        ]);
    });

    it('MAX', () => {
        const max = buttons.getButtons((b) => MaxButton.buttonProcessing(b, appContext));
        expect(max?.buttons.map((row) => row.map((b) => b.text))).toEqual([['1', '2', '3'], ['4']]);
    });

    it('VK', () => {
        const vk = buttons.getButtons((b) => VkButton.buttonProcessing(b, appContext));
        expect(
            vk?.buttons.map((row) =>
                (row as { action: { label: string } }[]).map((b) => b.action.label),
            ),
        ).toEqual([['1', '2', '3'], ['4']]);
    });

    it('VK: нечисловые группы не сливаются в один ряд', () => {
        // Регресс: группа приводилась к числу, 'nav' и 'actions' давали один NaN-ряд.
        buttons.clear();
        buttons
            .addBtn('Назад', '', '', { _group: 'nav' })
            .addBtn('Вперёд', '', '', { _group: 'nav' })
            .addBtn('Купить', '', '', { _group: 'actions' });
        const vk = buttons.getButtons((b) => VkButton.buttonProcessing(b, appContext));
        expect(vk?.buttons.map((row) => (row as unknown[]).length)).toEqual([2, 1]);
    });

    it('Viber: ширина строки делится между кнопками ряда', () => {
        const viber = buttons.getButtons((b) => ViberButton.buttonProcessing(b, appContext));
        expect(viber?.Buttons.map((b) => [b.Text, b.Columns])).toEqual([
            ['1', 2],
            ['2', 2],
            ['3', 2],
            ['4', undefined],
        ]);
    });
});

describe('layoutButtonRows: лимиты платформ', () => {
    it('ряд больше лимита переносится на следующую строку с предупреждением', () => {
        const items = ['a', 'b', 'c', 'd', 'e'].map((item) => ({ group: 'r', item }));
        expect(layoutButtonRows(items, () => 2, 'Test', appContext)).toEqual([
            ['a', 'b'],
            ['c', 'd'],
            ['e'],
        ]);
        expect(warns.some((w) => w.includes('[Test]'))).toBe(true);
    });

    it('MAX: ряд с кнопкой-ссылкой ограничен 3 кнопками', () => {
        buttons.clear();
        buttons.addBtn('1').addBtn('2').addBtn('3').addLink('Сайт', 'https://example.com').row();
        const max = buttons.getButtons((b) => MaxButton.buttonProcessing(b, appContext));
        expect(max?.buttons.map((row) => row.length)).toEqual([3, 1]);
    });

    it('Viber: 4 кнопки в ряду занимают всю строку (2+2+1+1)', () => {
        buttons.clear();
        buttons.addBtn('1').addBtn('2').addBtn('3').addBtn('4').row();
        const viber = buttons.getButtons((b) => ViberButton.buttonProcessing(b, appContext));
        expect(viber?.Buttons.map((b) => b.Columns)).toEqual([2, 2, 1, 1]);
    });
});
