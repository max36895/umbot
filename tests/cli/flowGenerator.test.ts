import * as fs from 'fs';
import * as path from 'path';
import { generateFromFlow, validateFlowSchema } from './../../cli/flowGenerator';
import { expectProjectToTypeCheck } from '../helpers/typecheck';

const TEST_DIR = path.join(__dirname, '__test_output__');
const JSON_DIR = path.join(TEST_DIR, 'json');

beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(JSON_DIR, { recursive: true });
});

afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
    }
});

function writeJsonAndGenerate(
    name: string,
    doc: object,
    options: Record<string, unknown> = {},
): string {
    const jsonPath = path.join(JSON_DIR, `${name}.json`);
    const outputPath = path.join(TEST_DIR, name);
    fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2));
    generateFromFlow(jsonPath, outputPath, options);
    return fs.readFileSync(path.join(outputPath, 'src', 'index.ts'), 'utf8');
}

describe('flowGenerator', () => {
    describe('Pattern 1: Simple command', () => {
        it('generates addCommand with text', () => {
            const code = writeJsonAndGenerate('p1', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'greeting',
                        slots: ['привет'],
                        isPattern: false,
                        response: { text: 'Привет!', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain("bot.addCommand('greeting', ['привет']");
            expect(code).toContain("setText(ctrl, 'Привет!')");
        });

        it('ставит isPattern четвёртым аргументом и генерирует типизируемый проект', () => {
            const name = 'pattern-command';
            writeJsonAndGenerate(name, {
                name,
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'digits',
                        slots: ['\\d+'],
                        isPattern: true,
                        response: { text: 'ok', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                database: { type: 'none', config: {} },
            });

            const projectPath = path.join(TEST_DIR, name);
            const code = fs.readFileSync(path.join(projectPath, 'src', 'index.ts'), 'utf8');
            expect(code).toContain("bot.addCommand('digits', ['\\\\d+'], (cmd:");
            expect(code).toContain('}, true);');
            expectProjectToTypeCheck(projectPath);
        });
    });

    describe('Pattern 2: Command with buttons', () => {
        it('generates addBtn and addLink', () => {
            const code = writeJsonAndGenerate('p2', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'menu',
                        slots: ['меню'],
                        isPattern: false,
                        response: {
                            text: 'Выберите:',
                            buttons: [
                                { title: 'Помощь', type: 'action' },
                                { title: 'Сайт', type: 'link', url: 'https://example.com' },
                            ],
                            sounds: [],
                        },
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            // В Telegram все кнопки inline: нажатие приходит как текст кнопки
            expect(code).toContain("ctrl.buttons.addBtn('Помощь', '', '', { inline: true })");
            expect(code).toContain("ctrl.buttons.addLink('Сайт', 'https://example.com')");
        });
    });

    describe('Pattern 3: Step with saveTo', () => {
        it('generates two-step pattern', () => {
            const code = writeJsonAndGenerate('p3', {
                name: 'test',
                nodes: [
                    {
                        type: 'step',
                        id: 's1',
                        name: 'ask_name',
                        prompt: { text: 'Как зовут?', buttons: [] },
                        saveTo: 'name',
                        saveAs: 'original',
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain("bot.addStep('ask_name'");
            // saveAs: 'original' — сохраняем ввод в исходном регистре (originalUserCommand)
            expect(code).toContain(
                "ctrl.userData.name = ctrl.originalUserCommand ?? ctrl.userCommand ?? ''",
            );
            expect(code).toContain("setText(ctrl, 'Как зовут?')");
        });
    });

    describe('Pattern 4: Command with inline action', () => {
        it('generates inline rand() call', () => {
            const code = writeJsonAndGenerate('p4', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'random',
                        slots: ['число'],
                        isPattern: false,
                        actions: [{ type: 'random_number', field: 'num', min: 1, max: 10 }],
                        response: { text: 'Число: {{num}}', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain("import { rand } from 'umbot/utils'");
            expect(code).toContain('ctrl.userData.num = rand(1, 10)');
            expect(code).toContain("`Число: ${ctrl.userData.num ?? ''}`");
        });
    });

    describe('Pattern 5: Step with condition (separate block)', () => {
        it('generates function and call', () => {
            const code = writeJsonAndGenerate('p5', {
                name: 'test',
                nodes: [
                    {
                        type: 'step',
                        id: 's1',
                        name: 'ask',
                        prompt: { text: 'Ответ:', buttons: [] },
                        saveTo: 'userAnswer',
                        saveAs: 'original',
                    },
                    {
                        type: 'condition',
                        id: 'c1',
                        name: 'check',
                        variable: 'userAnswer',
                        operator: 'eq',
                        value: 42,
                        responseTrue: { text: 'Правильно!' },
                        responseFalse: { text: 'Неправильно!' },
                    },
                ],
                edges: [{ from: 's1', to: 'c1', type: 'next' }],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            // Condition generates a function
            expect(code).toContain('function __check(ctrl: BotController)');
            expect(code).toContain('isEqual(ctrl.userData.userAnswer, 42)');
            expect(code).toContain("setText(ctrl, 'Правильно!')");
            // Step calls the function
            expect(code).toContain("bot.addStep('ask'");
            expect(code).toContain('__check(ctrl)');
        });
    });

    describe('Pattern 6: Command with navigation', () => {
        it('generates thisIntentName', () => {
            const code = writeJsonAndGenerate('p6', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'start',
                        slots: ['начать'],
                        isPattern: false,
                        response: { text: 'Начинаем!', buttons: [], sounds: [] },
                    },
                    {
                        type: 'step',
                        id: 's1',
                        name: 'ask',
                        prompt: { text: 'Вопрос', buttons: [] },
                        saveTo: 'f',
                        saveAs: 'original',
                    },
                ],
                edges: [{ from: 'c1', to: 's1', type: 'next' }],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain("ctrl.thisIntentName = 'ask'");
        });
    });

    describe('Pattern 7: Full cycle (command → action → step → condition)', () => {
        it('generates functions and calls', () => {
            const code = writeJsonAndGenerate('p7', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'start',
                        slots: ['игра'],
                        isPattern: false,
                        response: { text: 'Привет!', buttons: [], sounds: [] },
                    },
                    {
                        type: 'action',
                        id: 'a1',
                        name: 'gen',
                        actions: [
                            { type: 'random_number', field: 'num1', min: 1, max: 10 },
                            { type: 'set_variable', field: 'answer', value: 'num1 + num2' },
                        ],
                        text: '{{num1}}',
                        buttons: [],
                    },
                    {
                        type: 'step',
                        id: 's1',
                        name: 'ask',
                        prompt: { text: 'Ответ:', buttons: [] },
                        saveTo: 'userAnswer',
                        saveAs: 'original',
                    },
                    {
                        type: 'condition',
                        id: 'cond',
                        name: 'check',
                        variable: 'userAnswer',
                        operator: 'eq',
                        value: 'answer',
                        responseTrue: { text: 'Правильно!' },
                        responseFalse: { text: 'Неправильно!' },
                    },
                ],
                edges: [
                    { from: 'c1', to: 'a1', type: 'next' },
                    { from: 'a1', to: 's1', type: 'next' },
                    { from: 's1', to: 'cond', type: 'next' },
                ],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            // Action function
            expect(code).toContain('function __gen(ctrl: BotController)');
            expect(code).toContain('ctrl.userData.num1 = rand(1, 10)');
            expect(code).toContain('setText(ctrl, `');
            // Condition function
            expect(code).toContain('function __check(ctrl: BotController)');
            expect(code).toContain('isEqual(ctrl.userData.userAnswer, ctrl.userData.answer)');
            // Command calls action and navigates to step
            expect(code).toContain("bot.addCommand('start'");
            expect(code).toContain('__gen(ctrl)');
            expect(code).toContain("ctrl.thisIntentName = 'ask'");
            // Step calls condition
            expect(code).toContain("bot.addStep('ask'");
            expect(code).toContain('__check(ctrl)');
        });
    });

    describe('Pattern 8: Command with card', () => {
        it('generates card.addImage', () => {
            const code = writeJsonAndGenerate('p8', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'gallery',
                        slots: ['галерея'],
                        isPattern: false,
                        response: {
                            text: 'Выберите:',
                            buttons: [],
                            sounds: [],
                            card: {
                                type: 'gallery',
                                title: '',
                                images: [
                                    {
                                        src: 'url1.jpg',
                                        title: 'iPhone',
                                        description: '999₽',
                                        button: { title: 'Купить', type: 'action' },
                                    },
                                ],
                            },
                        },
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain(
                "ctrl.card.addImage('url1.jpg', 'iPhone', '999₽', { title: 'Купить', options: { inline: true } })",
            );
        });
    });

    describe('Pattern 9: Command with TTS', () => {
        it('generates ctrl.tts', () => {
            const code = writeJsonAndGenerate('p9', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'voice',
                        slots: ['голос'],
                        isPattern: false,
                        response: { text: 'Текст', tts: 'Озвучка', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain("setTTS(ctrl, 'Озвучка'");
        });
    });

    describe('Pattern 10: Command with HTTP', () => {
        it('generates async fetch', () => {
            const code = writeJsonAndGenerate('p10', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'weather',
                        slots: ['погода'],
                        isPattern: false,
                        actions: [
                            {
                                type: 'http_request',
                                url: 'https://api.weather.com',
                                method: 'GET',
                                saveResponseTo: 'data',
                            },
                        ],
                        response: { text: '{{data.temp}}°C', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain('async (cmd: string, ctrl: BotController)');
            expect(code).toContain("import { setText, fetchWithTimeout } from './utils'");
            expect(code).toContain("await fetchWithTimeout('https://api.weather.com')");
            expect(code).toContain('ctrl.userData.data = data');
        });

        it('generates safe JSON body with variables', () => {
            const code = writeJsonAndGenerate('p10_body_vars', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'send',
                        slots: ['send'],
                        isPattern: false,
                        actions: [
                            {
                                type: 'http_request',
                                url: 'https://api.example.com/send',
                                method: 'POST',
                                body: { message: '{{name}}' },
                            },
                        ],
                        response: { text: 'ok', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'no' },
                welcome: { text: 'hi' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });

            expect(code).toContain(
                'body: JSON.stringify({ "message": `${ctrl.userData.name ?? \'\'}` })',
            );
            expect(code).not.toContain('JSON.parse(`');
            expect(code).toContain(
                'const errorMessage = e instanceof Error ? e.message : String(e);',
            );
        });
    });

    describe('Pattern 11: Response block connected to command', () => {
        it('generates function and call', () => {
            const code = writeJsonAndGenerate('p11', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'menu',
                        slots: ['меню'],
                        isPattern: false,
                        response: {
                            text: 'Выберите:',
                            buttons: [{ title: 'Помощь', type: 'action' }],
                            sounds: [],
                        },
                    },
                    {
                        type: 'response',
                        id: 'r1',
                        name: 'help',
                        response: { text: 'Справка', buttons: [], sounds: [] },
                    },
                ],
                edges: [{ from: 'c1', to: 'r1', type: 'next' }],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            // Response generates a function
            expect(code).toContain('function __help(ctrl: BotController)');
            expect(code).toContain("setText(ctrl, 'Справка')");
            // Command calls the function (without type annotation)
            expect(code).toContain('__help(ctrl)');
            // Command does NOT set its own text (because response has text)
            expect(code).not.toContain("setText(ctrl, 'Выберите:')");
        });
    });

    describe('Pattern 12: Card in action block', () => {
        it('generates card in function', () => {
            const code = writeJsonAndGenerate('p12', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'start',
                        slots: ['start'],
                        isPattern: false,
                        response: { text: 'Hi', buttons: [], sounds: [] },
                    },
                    {
                        type: 'response',
                        id: 'r1',
                        name: 'cards',
                        response: {
                            text: 'Выберите:',
                            buttons: [],
                            sounds: [],
                            card: {
                                type: 'list',
                                title: 'Товары',
                                images: [
                                    { src: 'img1.jpg', title: 'Item 1', description: 'Desc 1' },
                                    { src: 'img2.jpg', title: 'Item 2', description: 'Desc 2' },
                                ],
                            },
                        },
                    },
                ],
                edges: [{ from: 'c1', to: 'r1', type: 'next' }],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain('function __cards(ctrl: BotController)');
            expect(code).toContain("ctrl.card.addImage('img1.jpg', 'Item 1', 'Desc 1')");
            expect(code).toContain("ctrl.card.addImage('img2.jpg', 'Item 2', 'Desc 2')");
        });
    });

    describe('Pattern 13: Command with isEnd', () => {
        it('generates ctrl.isEnd', () => {
            const code = writeJsonAndGenerate('p13', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'bye',
                        slots: ['пока'],
                        isPattern: false,
                        response: { text: 'До свидания!', isEnd: true, buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain('ctrl.isEnd = true');
        });
    });

    describe('Регрессии семантики сценария (превью редактора = сгенерированный бот)', () => {
        it('шаг сохраняет ответ и выполняет действия ДО вывода своего текста', () => {
            // Регрессия: текст шага подставлял {{name}} до записи ответа — «Привет, undefined!»
            const name = 'step_order';
            const code = writeJsonAndGenerate(name, {
                name,
                nodes: [
                    {
                        type: 'step',
                        id: 's1',
                        name: 'ask_name',
                        prompt: { text: 'Привет, {{name}}! Длина: {{len}}', buttons: [] },
                        saveTo: 'name',
                        saveAs: 'original',
                        actions: [{ type: 'set_variable', field: 'len', value: '5' }],
                    },
                ],
                edges: [],
                database: { type: 'none', config: {} },
            });
            const save = code.indexOf('ctrl.userData.name = ctrl.originalUserCommand');
            const action = code.indexOf('ctrl.userData.len = 5');
            const text = code.indexOf("setText(ctrl, `Привет, ${ctrl.userData.name ?? ''}");
            expect(save).toBeGreaterThan(-1);
            expect(action).toBeGreaterThan(save);
            expect(text).toBeGreaterThan(action);
            expectProjectToTypeCheck(path.join(TEST_DIR, name));
        });

        it('незаданная переменная: в тексте — пустая строка, в арифметике — ноль', () => {
            const name = 'missing_vars';
            const code = writeJsonAndGenerate(name, {
                name,
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'count',
                        slots: ['счёт'],
                        isPattern: false,
                        actions: [{ type: 'set_variable', field: 'cnt', value: 'cnt + 1' }],
                        response: {
                            text: 'Счёт {{cnt}}, имя {{userName}}',
                            buttons: [],
                            sounds: [],
                        },
                    },
                ],
                edges: [],
                database: { type: 'none', config: {} },
            });
            expect(code).toContain('ctrl.userData.cnt = Number(ctrl.userData.cnt ?? 0) + 1;');
            expect(code).toContain(
                "`Счёт ${ctrl.userData.cnt ?? ''}, имя ${ctrl.userData.userName ?? ''}`",
            );
            expectProjectToTypeCheck(path.join(TEST_DIR, name));
        });

        it('saveTo команды сохраняет исходный ввод до действий и текста', () => {
            const code = writeJsonAndGenerate('command_save_to', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'repeat',
                        slots: ['повтори'],
                        isPattern: false,
                        saveTo: 'said',
                        actions: [{ type: 'set_variable', field: 'x', value: '1' }],
                        response: { text: 'Ты сказал: {{said}}', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                database: { type: 'none', config: {} },
            });
            const save = code.indexOf('ctrl.userData.said = ctrl.originalUserCommand ?? cmd;');
            expect(save).toBeGreaterThan(-1);
            expect(code.indexOf('ctrl.userData.x = 1;')).toBeGreaterThan(save);
            expect(code.indexOf('setText(ctrl, `Ты сказал:')).toBeGreaterThan(save);
        });

        it('isEmpty/contains: 0 — не пусто, незаданная переменная — пустая строка', () => {
            const code = writeJsonAndGenerate('empty_checks', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'go',
                        slots: ['go'],
                        isPattern: false,
                        response: { text: '', buttons: [], sounds: [] },
                    },
                    {
                        type: 'condition',
                        id: 'e',
                        name: 'e',
                        variable: 'z',
                        operator: 'isEmpty',
                        value: '',
                    },
                    {
                        type: 'condition',
                        id: 'c',
                        name: 'c',
                        variable: 'z',
                        operator: 'contains',
                        value: 'def',
                    },
                    {
                        type: 'response',
                        id: 'r',
                        name: 'r',
                        response: { text: 'ok', buttons: [], sounds: [] },
                    },
                ],
                edges: [
                    { from: 'c1', to: 'e', type: 'next' },
                    { from: 'e', to: 'r', type: 'branch_true' },
                    { from: 'e', to: 'c', type: 'branch_false' },
                    { from: 'c', to: 'r', type: 'branch_true' },
                    { from: 'c', to: 'r', type: 'branch_false' },
                ],
                database: { type: 'none', config: {} },
            });
            expect(code).toContain("if (String(ctrl.userData.z ?? '') === '')");
            expect(code).toContain("if (String(ctrl.userData.z ?? '').includes(String('def')))");
        });

        it('карточка, эмоция, TTS, заголовки кнопок и перемешивание в ответе, шаге и действии', () => {
            const name = 'rich_response';
            const code = writeJsonAndGenerate(name, {
                name,
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'shop',
                        slots: ['магазин'],
                        isPattern: false,
                        response: {
                            text: 'Магазин',
                            tts: 'Товар {{item}}',
                            emotion: 'good',
                            buttons: [],
                            sounds: [],
                            card: {
                                type: 'single',
                                title: 'Товар {{item}}',
                                images: [
                                    {
                                        src: 'https://example.com/{{item}}.png',
                                        title: '{{item}}',
                                        description: 'Цена {{price}}',
                                        button: {
                                            title: 'Купить',
                                            type: 'action',
                                            targetNodeId: 'r1',
                                        },
                                    },
                                ],
                            },
                        },
                    },
                    {
                        type: 'response',
                        id: 'r1',
                        name: 'bought',
                        response: {
                            text: 'Куплено',
                            emotion: 'neutral',
                            shuffleButtons: true,
                            buttons: [
                                { title: 'Ещё {{item}}', type: 'action' },
                                {
                                    title: 'Сайт',
                                    type: 'link',
                                    url: 'https://example.com/{{item}}',
                                },
                            ],
                            sounds: [],
                        },
                    },
                    {
                        type: 'step',
                        id: 's1',
                        name: 'pick',
                        prompt: {
                            text: '',
                            emotion: 'bad',
                            buttons: [],
                            card: {
                                type: 'list',
                                title: 'Список',
                                images: [{ src: 'a.png', title: 'A', description: '' }],
                            },
                        },
                        saveTo: 'item',
                        saveAs: 'original',
                    },
                    {
                        type: 'action',
                        id: 'a1',
                        name: 'gallery',
                        actions: [],
                        text: 'Галерея',
                        buttons: [],
                        card: {
                            type: 'gallery',
                            title: '',
                            images: [
                                { src: 'a.png', title: 'A', description: '' },
                                { src: 'b.png', title: 'B', description: '' },
                            ],
                        },
                    },
                ],
                edges: [
                    { from: 'c1', to: 's1', type: 'next' },
                    { from: 's1', to: 'a1', type: 'next' },
                ],
                database: { type: 'none', config: {} },
            });
            expect(code).toContain("setTTS(ctrl, `Товар ${ctrl.userData.item ?? ''}`);");
            expect(code).toContain("ctrl.emotion = 'good';");
            expect(code).toContain("ctrl.emotion = 'neutral';");
            expect(code).toContain("ctrl.emotion = 'bad';");
            expect(code).toContain("ctrl.card.title = `Товар ${ctrl.userData.item ?? ''}`;");
            expect(code).toContain('ctrl.card.isOne = true;');
            expect(code).toContain(
                "ctrl.card.addImage(`https://example.com/${ctrl.userData.item ?? ''}.png`, `${ctrl.userData.item ?? ''}`, `Цена ${ctrl.userData.price ?? ''}`, { title: 'Купить', payload: { command: '[go:1]' }, options: { inline: true } });",
            );
            // Кнопка картинки ведёт на блок — блок генерируется и получает действие
            expect(code).toContain("bot.addAction('[go:1]'");
            expect(code).toContain('function __bought(ctrl: BotController)');
            // Перемешивание кнопок у блока «Ответ», переменные в заголовке и ссылке
            expect(code).toContain('// Случайный порядок кнопок');
            expect(code).toContain("title: `Ещё ${ctrl.userData.item ?? ''}`");
            expect(code).toContain("url: `https://example.com/${ctrl.userData.item ?? ''}`");
            // Карточка шага и действия
            expect(code).toContain("ctrl.card.title = 'Список';");
            expect(code).toContain('ctrl.card.isUsedGallery = true;');
            expectProjectToTypeCheck(path.join(TEST_DIR, name));
        });

        it('isEnd у блока «Ответ» завершает диалог', () => {
            const code = writeJsonAndGenerate('response_is_end', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'bye',
                        slots: ['пока'],
                        isPattern: false,
                        response: { text: '', buttons: [], sounds: [] },
                    },
                    {
                        type: 'response',
                        id: 'r1',
                        name: 'farewell',
                        response: { text: 'До встречи', isEnd: true, buttons: [], sounds: [] },
                    },
                ],
                edges: [{ from: 'c1', to: 'r1', type: 'next' }],
                database: { type: 'none', config: {} },
            });
            const fn = code.slice(code.indexOf('function __farewell'));
            expect(fn.slice(0, fn.indexOf('\n}'))).toContain('ctrl.isEnd = true');
        });

        it('eq/neq сравнивают через isEqual: ввод-строка "42" равна числу 42', () => {
            const name = 'is_equal';
            const code = writeJsonAndGenerate(name, {
                name,
                nodes: [
                    {
                        type: 'step',
                        id: 's1',
                        name: 'ask',
                        prompt: { text: '', buttons: [] },
                        saveTo: 'guess',
                        saveAs: 'original',
                    },
                    {
                        type: 'condition',
                        id: 'c1',
                        name: 'win',
                        variable: 'guess',
                        operator: 'eq',
                        value: 42,
                    },
                    {
                        type: 'condition',
                        id: 'c2',
                        name: 'other',
                        variable: 'guess',
                        operator: 'neq',
                        value: 'нет',
                    },
                    {
                        type: 'response',
                        id: 'r1',
                        name: 'yes',
                        response: { text: 'Да', buttons: [], sounds: [] },
                    },
                    {
                        type: 'response',
                        id: 'r2',
                        name: 'no',
                        response: { text: 'Нет', buttons: [], sounds: [] },
                    },
                ],
                edges: [
                    { from: 's1', to: 'c1', type: 'next' },
                    { from: 'c1', to: 'r1', type: 'branch_true' },
                    { from: 'c1', to: 'c2', type: 'branch_false' },
                    { from: 'c2', to: 'r1', type: 'branch_true' },
                    { from: 'c2', to: 'r2', type: 'branch_false' },
                ],
                database: { type: 'none', config: {} },
            });
            expect(code).toMatch(/import \{ setText, isEqual \} from '\.\/utils';/);
            expect(code).toContain('isEqual(ctrl.userData.guess, 42)');
            expect(code).toContain("!isEqual(ctrl.userData.guess, 'нет')");
            expect(code).not.toContain('=== 42');
            expectProjectToTypeCheck(path.join(TEST_DIR, name));
        });

        it('isEqual не импортируется, если eq/neq-условий нет', () => {
            const code = writeJsonAndGenerate('no_is_equal', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'hi',
                        slots: ['hi'],
                        isPattern: false,
                        response: { text: 'Hi', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                database: { type: 'none', config: {} },
            });
            expect(code).not.toContain('isEqual');
        });
    });

    describe('Кнопки с блоком-целью (targetNodeId)', () => {
        const baseDoc = (nodes: object[], edges: object[] = []): Record<string, unknown> => ({
            name: 'buttons',
            nodes,
            edges,
            database: { type: 'none', config: {} },
        });
        const command = (
            id: string,
            name: string,
            slots: string[],
            text: string,
            buttons: object[] = [],
        ): Record<string, unknown> => ({
            type: 'command',
            id,
            name,
            slots,
            isPattern: false,
            response: { text, buttons, sounds: [] },
        });
        const response = (
            id: string,
            name: string,
            text: string,
            buttons: object[] = [],
        ): Record<string, unknown> => ({
            type: 'response',
            id,
            name,
            response: { text, buttons, sounds: [] },
        });

        it('кнопка на блок: payload [go:N] и действие, вызывающее функцию блока', () => {
            const name = 'btn_block';
            const code = writeJsonAndGenerate(
                name,
                baseDoc([
                    command('c1', 'menu', ['меню'], 'Куда?', [
                        { title: 'В камеру', type: 'action', targetNodeId: 'r1' },
                        { title: 'Просто текст', type: 'action' },
                    ]),
                    response('r1', 'cell', 'Камера'),
                ]),
            );
            expect(code).toContain(
                "ctrl.buttons.addBtn('В камеру', '', { command: '[go:1]' }, { inline: true })",
            );
            expect(code).toContain("ctrl.buttons.addBtn('Просто текст', '', '', { inline: true })");
            // Блок без входящих связей генерируется: на него ведёт кнопка
            expect(code).toContain('function __cell(ctrl: BotController)');
            expect(code).toMatch(
                /bot\.addAction\('\[go:1\]', \(cmd: string, ctrl: BotController\): void => \{\n {4}__cell\(ctrl\);/,
            );
            // Действия регистрируются раньше команд, чтобы слоты не перехватили нажатие
            expect(code.indexOf("bot.addAction('[go:1]'")).toBeLessThan(
                code.indexOf("bot.addCommand('menu'"),
            );
            expectProjectToTypeCheck(path.join(TEST_DIR, name));
        });

        it('кнопка на шаг: шаг обрабатывает текст кнопки как ответ; ожидающий шаг пропускает нажатие', () => {
            const name = 'btn_step';
            const code = writeJsonAndGenerate(
                name,
                baseDoc(
                    [
                        command('c1', 'start', ['старт'], 'Готов?', [
                            { title: 'Да', type: 'action', targetNodeId: 's1' },
                        ]),
                        {
                            type: 'step',
                            id: 's1',
                            name: 'confirm',
                            prompt: { text: 'Ответ: {{answer}}', buttons: [] },
                            saveTo: 'answer',
                            saveAs: 'original',
                        },
                    ],
                    [{ from: 'c1', to: 's1', type: 'next' }],
                ),
            );
            expect(code).toContain('function __step_confirm(ctrl: BotController): void {');
            expect(code).toContain("ctrl.originalUserCommand = 'Да';");
            expect(code).toContain(
                'ctrl.userCommand = ctrl.originalUserCommand.toLowerCase().trim();',
            );
            expect(code).toContain('    __step_confirm(ctrl);');
            expect(code).toContain(
                "bot.addStep('confirm', (ctrl: BotController): void | false => {\n    if (ctrl.messageId === 0 || (ctrl.userCommand ?? '').startsWith('/start') || (ctrl.userCommand ?? '').startsWith('[go:')) return false;\n    __step_confirm(ctrl);",
            );
            expectProjectToTypeCheck(path.join(TEST_DIR, name));
        });

        it('кнопка на команду: команда выполняется с текстом кнопки', () => {
            const name = 'btn_command';
            const code = writeJsonAndGenerate(
                name,
                baseDoc([
                    command('c1', 'menu', ['меню'], 'Меню', [
                        { title: 'Помощь', type: 'action', targetNodeId: 'c2' },
                    ]),
                    { ...command('c2', 'help_me', ['помоги'], 'Справка'), saveTo: 'asked' },
                ]),
            );
            expect(code).toContain(
                'function __cmd_help_me(cmd: string, ctrl: BotController): void {',
            );
            expect(code).toContain("bot.addCommand('help_me', ['помоги'], __cmd_help_me);");
            expect(code).toContain('    __cmd_help_me(ctrl.userCommand, ctrl);');
            expectProjectToTypeCheck(path.join(TEST_DIR, name));
        });

        it('без кнопок с целью генерация шагов и команд не меняется', () => {
            const code = writeJsonAndGenerate(
                'btn_none',
                baseDoc([
                    command('c1', 'go', ['go'], 'Да?'),
                    {
                        type: 'step',
                        id: 's1',
                        name: 'ask',
                        prompt: { text: '', buttons: [] },
                        saveTo: 'x',
                        saveAs: 'original',
                    },
                ]),
            );
            expect(code).not.toContain('addAction');
            // Шаг пропускает только начало диалога (messageId 0, /start) — без проверки [go:
            expect(code).toContain("bot.addStep('ask', (ctrl: BotController): void | false => {");
            expect(code).toContain(
                "    if (ctrl.messageId === 0 || (ctrl.userCommand ?? '').startsWith('/start')) return false;",
            );
            expect(code).not.toContain("startsWith('[go:')");
        });

        it('кнопка на «Завершение» или несуществующий блок — обычная текстовая кнопка', () => {
            const code = writeJsonAndGenerate(
                'btn_end',
                baseDoc([
                    command('c1', 'go', ['go'], 'Да?', [
                        { title: 'Конец', type: 'action', targetNodeId: 'e1' },
                        { title: 'Нет такого', type: 'action', targetNodeId: 'missing' },
                    ]),
                    { type: 'end', id: 'e1' },
                ]),
            );
            expect(code).not.toContain('addAction');
            expect(code).toContain("ctrl.buttons.addBtn('Конец', '', '', { inline: true })");
        });
    });

    describe('Fallback', () => {
        it('generates FALLBACK_COMMAND handler', () => {
            const code = writeJsonAndGenerate('fb', {
                name: 'test',
                nodes: [],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain('bot.addCommand(FALLBACK_COMMAND');
            expect(code).toContain("setText(ctrl, 'Не понял')");
        });
    });

    describe('Database adapter', () => {
        it('imports FileAdapter for file database', () => {
            const code = writeJsonAndGenerate('db', {
                name: 'test',
                nodes: [],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain("import { FileAdapter } from 'umbot/plugins'");
            expect(code).toContain('bot.use(new FileAdapter())');
        });

        it('imports MongoAdapter for mongo database', () => {
            const code = writeJsonAndGenerate('dbmongo', {
                name: 'test',
                nodes: [],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'mongo', config: { database: 'mydb' } },
                isLocalStorage: false,
            });
            expect(code).toContain("import { MongoAdapter } from 'umbot/plugins'");
            expect(code).toContain('new MongoAdapter(');
            expect(code).toContain("'mydb'");
            const packageJson = JSON.parse(
                fs.readFileSync(path.join(TEST_DIR, 'dbmongo', 'package.json'), 'utf8'),
            ) as { dependencies: Record<string, string> };
            expect(packageJson.dependencies.mongodb).toBe('7.1.1');
        });

        it('no adapter import for none database', () => {
            const code = writeJsonAndGenerate('dbnone', {
                name: 'test',
                nodes: [],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'none', config: {} },
                isLocalStorage: false,
            });
            expect(code).not.toContain('FileAdapter');
            expect(code).not.toContain('MongoAdapter');
        });
    });

    describe('Pattern 14: set_variable expression', () => {
        it('resolves variable references in set_variable', () => {
            const code = writeJsonAndGenerate('p14', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'calc',
                        slots: ['calc'],
                        isPattern: false,
                        actions: [
                            { type: 'set_variable', field: 'a', value: '5' },
                            { type: 'set_variable', field: 'b', value: 'a + 3' },
                        ],
                        response: { text: 'Результат: {{b}}', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain('ctrl.userData.a = 5;');
            expect(code).toContain('ctrl.userData.b = Number(ctrl.userData.a ?? 0) + 3;');
        });
    });

    describe('Pattern: HTTP saveResponseTo как переменная в выражении', () => {
        it('считает saveResponseTo известной переменной в set_variable', () => {
            const code = writeJsonAndGenerate('p_http_save_var', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'fetch',
                        slots: ['fetch'],
                        isPattern: false,
                        actions: [
                            {
                                type: 'http_request',
                                url: 'https://api.example.com/num',
                                method: 'GET',
                                saveResponseTo: 'result',
                            },
                            { type: 'set_variable', field: 'total', value: 'result + 1' },
                        ],
                        response: { text: 'ok', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain('ctrl.userData.result = data;');
            expect(code).toContain('ctrl.userData.total = Number(ctrl.userData.result ?? 0) + 1;');
            expect(code).not.toContain("'result + 1'");
        });
    });

    describe('Pattern 15: isEmpty condition', () => {
        it('generates simple negation for isEmpty', () => {
            const code = writeJsonAndGenerate('p15', {
                name: 'test',
                nodes: [
                    {
                        type: 'step',
                        id: 's1',
                        name: 'ask',
                        prompt: { text: 'Имя?', buttons: [] },
                        saveTo: 'name',
                        saveAs: 'original',
                    },
                    {
                        type: 'condition',
                        id: 'cond1',
                        name: 'check_empty',
                        variable: 'name',
                        operator: 'isEmpty',
                        value: '',
                        responseTrue: { text: 'Пусто!' },
                        responseFalse: { text: 'Есть значение!' },
                    },
                ],
                edges: [{ from: 's1', to: 'cond1', type: 'next' }],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            // Пустое — только отсутствующее значение или '': число 0 не считается пустым
            expect(code).toContain("if (String(ctrl.userData.name ?? '') === '')");
            expect(code).toContain("setText(ctrl, 'Пусто!')");
            expect(code).toContain("setText(ctrl, 'Есть значение!')");
        });
    });

    describe('Pattern 16: Step with saveAs lowercase', () => {
        it('generates toLowerCase for saveAs lowercase', () => {
            const code = writeJsonAndGenerate('p16', {
                name: 'test',
                nodes: [
                    {
                        type: 'step',
                        id: 's1',
                        name: 'get_input',
                        prompt: { text: 'Введите:', buttons: [] },
                        saveTo: 'input',
                        saveAs: 'lowercase',
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain("(ctrl.userCommand ?? '').toLowerCase()");
        });

        it('generates originalUserCommand for saveAs original (case is not lost)', () => {
            // Fix: адаптеры приводят ctrl.userCommand к нижнему регистру для матчинга,
            // поэтому «оригинальный» ввод нужно брать из ctrl.originalUserCommand.
            // Регрессия: «Иван» сохранялся как «иван».
            const code = writeJsonAndGenerate('p16b', {
                name: 'test',
                nodes: [
                    {
                        type: 'step',
                        id: 's1',
                        name: 'ask_name',
                        prompt: { text: 'Как вас зовут?', buttons: [] },
                        saveTo: 'userName',
                        saveAs: 'original',
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain(
                'ctrl.userData.userName = ctrl.originalUserCommand ?? ctrl.userCommand ?? ' + "''",
            );
            expect(code).not.toContain('ctrl.userData.userName = ctrl.userCommand ??');
        });
    });

    describe('Pattern 17: Multi-step chain', () => {
        it('generates correct navigation chain for 3 steps', () => {
            const code = writeJsonAndGenerate('p17', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'start',
                        slots: ['go'],
                        isPattern: false,
                        response: { text: 'Начинаем', buttons: [], sounds: [] },
                    },
                    {
                        type: 'step',
                        id: 's1',
                        name: 'step1',
                        prompt: { text: 'Шаг 1', buttons: [] },
                        saveTo: 'v1',
                        saveAs: 'original',
                    },
                    {
                        type: 'step',
                        id: 's2',
                        name: 'step2',
                        prompt: { text: 'Шаг 2', buttons: [] },
                        saveTo: 'v2',
                        saveAs: 'original',
                    },
                ],
                edges: [
                    { from: 'c1', to: 's1', type: 'next' },
                    { from: 's1', to: 's2', type: 'next' },
                ],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain("ctrl.thisIntentName = 'step1'");
            expect(code).toContain("ctrl.thisIntentName = 'step2'");
        });
    });

    describe('Pattern 18: Condition operators', () => {
        it('generates correct operators for gt, lt, contains, neq', () => {
            const makeDoc = (operator: string): Record<string, unknown> => ({
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'cmd',
                        name: 'go',
                        slots: ['go'],
                        isPattern: false,
                        response: { text: '', buttons: [], sounds: [] },
                    },
                    {
                        type: 'condition',
                        id: 'cond',
                        name: 'check',
                        variable: 'score',
                        operator,
                        value: 100,
                        responseTrue: { text: 'Да' },
                        responseFalse: { text: 'Нет' },
                    },
                ],
                edges: [{ from: 'cmd', to: 'cond', type: 'next' }],
                fallback: { text: 'No' },
                welcome: { text: 'Hi' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });

            let code = writeJsonAndGenerate('op_gt', makeDoc('gt'));
            expect(code).toContain('Number(ctrl.userData.score) > Number(100)');

            code = writeJsonAndGenerate('op_lt', makeDoc('lt'));
            expect(code).toContain('Number(ctrl.userData.score) < Number(100)');

            code = writeJsonAndGenerate('op_contains', makeDoc('contains'));
            // includes() принимает только строки: числовой литерал обязан быть
            // обёрнут в String(), иначе сгенерированный проект не компилируется.
            expect(code).toContain("String(ctrl.userData.score ?? '').includes(String(100))");

            code = writeJsonAndGenerate('op_neq', makeDoc('neq'));
            expect(code).toContain('!isEqual(ctrl.userData.score, 100)');
        });
    });

    describe('Pattern 19: Command with inline condition', () => {
        it('generates inline if/else in command handler', () => {
            const code = writeJsonAndGenerate('p19', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'check',
                        slots: ['check'],
                        isPattern: false,
                        conditions: [
                            {
                                variable: 'level',
                                operator: 'gte',
                                value: 10,
                                responseTrue: { text: 'Высокий уровень' },
                                responseFalse: { text: 'Низкий уровень' },
                            },
                        ],
                        response: { text: '', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain('if (Number(ctrl.userData.level) >= Number(10))');
            expect(code).toContain("setText(ctrl, 'Высокий уровень')");
            expect(code).toContain("setText(ctrl, 'Низкий уровень'");
        });
    });

    describe('Pattern 20: Step with buttons', () => {
        it('generates buttons inside step handler', () => {
            const code = writeJsonAndGenerate('p20', {
                name: 'test',
                nodes: [
                    {
                        type: 'step',
                        id: 's1',
                        name: 'menu_step',
                        prompt: {
                            text: 'Выберите:',
                            buttons: [
                                { title: 'Один', type: 'action' },
                                { title: 'Два', type: 'action' },
                            ],
                        },
                        saveTo: 'choice',
                        saveAs: 'original',
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain("ctrl.buttons.addBtn('Один', '', '', { inline: true })");
            expect(code).toContain("ctrl.buttons.addBtn('Два', '', '', { inline: true })");
        });
    });

    describe('Pattern 21: Error handling', () => {
        it('throws for missing file', () => {
            expect(() => generateFromFlow('/nonexistent/file.json', '/tmp/test')).toThrow(
                'Файл не найден',
            );
        });

        it('throws for invalid JSON', () => {
            const jsonPath = path.join(JSON_DIR, 'bad.json');
            fs.writeFileSync(jsonPath, 'not json');
            expect(() => generateFromFlow(jsonPath, path.join(TEST_DIR, 'bad'))).toThrow(
                'Ошибка парсинга JSON',
            );
        });

        it('throws for missing name field', () => {
            const jsonPath = path.join(JSON_DIR, 'noname.json');
            fs.writeFileSync(jsonPath, JSON.stringify({ nodes: [] }));
            expect(() => generateFromFlow(jsonPath, path.join(TEST_DIR, 'noname'))).toThrow(
                'отсутствует поле "name"',
            );
        });

        it('throws for missing nodes field', () => {
            const jsonPath = path.join(JSON_DIR, 'nonodes.json');
            fs.writeFileSync(jsonPath, JSON.stringify({ name: 'test' }));
            expect(() => generateFromFlow(jsonPath, path.join(TEST_DIR, 'nonodes'))).toThrow(
                'отсутствует поле "nodes"',
            );
        });
    });

    describe('Output safety', () => {
        it('does not overwrite non-empty output directory without force', () => {
            const jsonPath = path.join(JSON_DIR, 'overwrite.json');
            const outputPath = path.join(TEST_DIR, 'existing');
            fs.mkdirSync(outputPath, { recursive: true });
            fs.writeFileSync(path.join(outputPath, 'package.json'), '{"name":"old"}');
            fs.writeFileSync(
                jsonPath,
                JSON.stringify({
                    name: 'test',
                    nodes: [],
                    edges: [],
                }),
            );

            expect(() => generateFromFlow(jsonPath, outputPath)).toThrow(
                'Папка для генерации не пустая',
            );
            expect(fs.readFileSync(path.join(outputPath, 'package.json'), 'utf8')).toBe(
                '{"name":"old"}',
            );
        });

        it('overwrites non-empty output directory with force', () => {
            const jsonPath = path.join(JSON_DIR, 'force.json');
            const outputPath = path.join(TEST_DIR, 'force');
            fs.mkdirSync(outputPath, { recursive: true });
            fs.writeFileSync(path.join(outputPath, 'package.json'), '{"name":"old"}');
            fs.writeFileSync(
                jsonPath,
                JSON.stringify({
                    name: 'test',
                    nodes: [],
                    edges: [],
                }),
            );

            generateFromFlow(jsonPath, outputPath, { force: true });

            expect(fs.readFileSync(path.join(outputPath, 'package.json'), 'utf8')).toContain(
                '"name": "test"',
            );
        });
    });

    describe('Production templates', () => {
        it('keeps TypeScript dev dependency available in Docker builder stage', () => {
            const dockerFile = fs.readFileSync(
                path.join(__dirname, '../../cli/template/docker/DockerFile.text'),
                'utf8',
            );

            // На этапе сборки зависимости ставятся вместе с devDependencies
            // (без --omit=dev), чтобы был доступен tsc для npm run build.
            expect(dockerFile).toContain('COPY package*.json ./');
            expect(dockerFile).toContain('npm ci');
            expect(dockerFile).toContain('npm install');
            // До npm run build не должно быть --omit=dev
            const buildStage = dockerFile.split('npm run build')[0];
            expect(buildStage).not.toContain('--omit=dev');
        });

        it('pins generated dependencies and does not enable a lock-file cache without a lock file', () => {
            const packageTemplate = JSON.parse(
                fs.readFileSync(
                    path.join(__dirname, '../../cli/template/package.json.text'),
                    'utf8',
                ),
            ) as {
                dependencies: Record<string, string>;
                devDependencies: Record<string, string>;
            };
            const workflow = fs.readFileSync(
                path.join(__dirname, '../../cli/template/github/deploy.yml'),
                'utf8',
            );

            expect(packageTemplate.dependencies.umbot).toBe(
                '^' +
                    (
                        JSON.parse(
                            fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
                        ) as { version: string }
                    ).version,
            );
            expect(packageTemplate.devDependencies.typescript).toBe('6.0.3');
            expect(packageTemplate.devDependencies['@types/node']).toBe('24.13.4');
            expect(workflow).not.toContain("cache: 'npm'");
            expect(
                fs.readFileSync(path.join(__dirname, '../../cli/template/.gitignore'), 'utf8'),
            ).not.toContain('package-lock.json');
        });

        it('does not write token values to serverless.yml', () => {
            const token = 'bot123:' + 'a'.repeat(35);
            const jsonPath = path.join(JSON_DIR, 'cloud.json');
            const outputPath = path.join(TEST_DIR, 'cloud');
            fs.writeFileSync(
                jsonPath,
                JSON.stringify({
                    name: 'cloud-bot',
                    nodes: [],
                    edges: [],
                    tokens: {
                        telegram: token,
                    },
                }),
            );

            generateFromFlow(jsonPath, outputPath, { useCloud: true });

            const serverlessYml = fs.readFileSync(path.join(outputPath, 'serverless.yml'), 'utf8');
            expect(serverlessYml).toContain('TELEGRAM_TOKEN: "${env:TELEGRAM_TOKEN}"');
            expect(serverlessYml).not.toContain(token);
        });

        it('санитизирует ключи и значения tokens из flow.json (инъекция в .env и YAML)', () => {
            // flow.json приходит из внешнего редактора: ключ платформы с переводами
            // строк ломал структуру serverless.yml (YAML-инъекция), а значение токена
            // с переводами строк дописывало в .env произвольные переменные.
            const jsonPath = path.join(JSON_DIR, 'tokens-inject.json');
            const outputPath = path.join(TEST_DIR, 'tokens-inject');
            fs.writeFileSync(
                jsonPath,
                JSON.stringify({
                    name: 'tokens-inject',
                    nodes: [],
                    edges: [],
                    tokens: {
                        ['x\n      INJECTED_VAR: "pwned"\n    zz']: 'evil-key-token',
                        telegram: 'good-token\nINJECTED_LINE=pwned',
                    },
                }),
            );

            generateFromFlow(jsonPath, outputPath, { useCloud: true });

            const envFile = fs.readFileSync(path.join(outputPath, '.env'), 'utf8');
            // Переводы строк вычищены: новая переменная не создана, «хвост» стал
            // частью значения токена на той же строке.
            expect(envFile).not.toContain('\nINJECTED_LINE');
            expect(envFile).toContain('TELEGRAM_TOKEN=good-tokenINJECTED_LINE=pwned');
            const serverlessYml = fs.readFileSync(path.join(outputPath, 'serverless.yml'), 'utf8');
            // YAML-инъекция не удалась: ключ из flow превратился в безвредное имя
            // переменной без переводов строк; отдельного ключа INJECTED_VAR нет.
            expect(serverlessYml).not.toMatch(/(^|\n)\s*INJECTED_VAR:/);
            expect(serverlessYml).not.toContain('pwned');
        });

        it('не перезаписывает существующий .env: сохраняет пользовательские значения, дописывает недостающие', () => {
            const jsonPath = path.join(JSON_DIR, 'env-overwrite.json');
            const outputPath = path.join(TEST_DIR, 'env-overwrite');
            fs.writeFileSync(
                jsonPath,
                JSON.stringify({
                    name: 'env-overwrite',
                    nodes: [],
                    edges: [],
                    tokens: { telegram: 'flow-token', vk: 'vk-flow-token' },
                }),
            );
            fs.mkdirSync(outputPath, { recursive: true });
            // Пользователь уже вписал реальный токен Telegram вручную
            fs.writeFileSync(
                path.join(outputPath, '.env'),
                'USER_EDITED_SECRET=1\nTELEGRAM_TOKEN=real-user-token\n',
                'utf8',
            );
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            try {
                generateFromFlow(jsonPath, outputPath, { force: true });
                const envContent = fs.readFileSync(path.join(outputPath, '.env'), 'utf8');
                // Пользовательские значения не затёрты токенами из flow.json
                expect(envContent).toContain('USER_EDITED_SECRET=1');
                expect(envContent).toContain('TELEGRAM_TOKEN=real-user-token');
                expect(envContent).not.toContain('TELEGRAM_TOKEN=flow-token');
                // Недостающие переменные дописаны
                expect(envContent).toContain('VK_TOKEN=vk-flow-token');
            } finally {
                warnSpy.mockRestore();
                logSpy.mockRestore();
            }
        });

        it('исключает секреты и зависимости из cloud-архива и передаёт env-файл', () => {
            const jsonPath = path.join(JSON_DIR, 'cloud-ignore.json');
            const outputPath = path.join(TEST_DIR, 'cloud-ignore');
            fs.writeFileSync(
                jsonPath,
                JSON.stringify({
                    name: 'cloud-ignore',
                    nodes: [],
                    edges: [],
                    tokens: { telegram: 'plain-token' },
                }),
            );

            generateFromFlow(jsonPath, outputPath, { useCloud: true });

            const ignore = fs.readFileSync(path.join(outputPath, '.ymlignore'), 'utf8');
            const pkg = JSON.parse(
                fs.readFileSync(path.join(outputPath, 'package.json'), 'utf8'),
            ) as { scripts: { deploy: string } };
            expect(ignore).toContain('.env');
            expect(ignore).toContain('node_modules');
            expect(ignore).toContain('.git');
            expect(pkg.scripts.deploy).toBe('npm run build && node ./scripts/deploy.js');
            const deployScript = fs.readFileSync(
                path.join(outputPath, 'scripts', 'deploy.js'),
                'utf8',
            );
            expect(deployScript).toContain("args.push('--environment', environment)");
            expect(deployScript).toContain("path.join(root, '.umbot-deploy')");
        });
    });

    describe('Pattern 22: Welcome text and fallback', () => {
        it('generates welcome and fallback text', () => {
            const code = writeJsonAndGenerate('p22', {
                name: 'test',
                nodes: [],
                edges: [],
                fallback: { text: 'Извините, не понял вас' },
                welcome: { text: 'Добро пожаловать!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain("welcome_text: 'Добро пожаловать!'");
            expect(code).toContain("help_text: 'Извините, не понял вас'");
            expect(code).toContain("setText(ctrl, 'Извините, не понял вас'");
        });
    });

    describe('Pattern 23: set_variable with plain text value', () => {
        it('wraps text value in quotes', () => {
            const code = writeJsonAndGenerate('p23_text', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'start',
                        slots: ['старт'],
                        isPattern: false,
                        response: { text: '', buttons: [], sounds: [] },
                    },
                    {
                        type: 'action',
                        id: 'a1',
                        name: 'set_action',
                        actions: [
                            { type: 'set_variable', field: 'greeting', value: 'Hello world' },
                        ],
                        text: '',
                        buttons: [],
                    },
                ],
                edges: [{ from: 'c1', to: 'a1', type: 'next' }],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain("ctrl.userData.greeting = 'Hello world'");
            // Не должно быть невалидного JS
            expect(code).not.toMatch(/ctrl\.userData\.greeting = Hello world;/);
        });
    });

    describe('Pattern 24: isNotEmpty operator', () => {
        it('generates isNotEmpty check', () => {
            const code = writeJsonAndGenerate('p24_notempty', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'start',
                        slots: ['старт'],
                        isPattern: false,
                        response: { text: '', buttons: [], sounds: [] },
                    },
                    {
                        type: 'condition',
                        id: 'cond1',
                        name: 'check_items',
                        variable: 'items',
                        operator: 'isNotEmpty',
                        value: '',
                    },
                    {
                        type: 'response',
                        id: 'r1',
                        name: 'has_items',
                        response: { text: 'Есть элементы!', buttons: [], sounds: [] },
                    },
                ],
                edges: [
                    { from: 'c1', to: 'cond1', type: 'next' },
                    { from: 'cond1', to: 'r1', type: 'branch_true' },
                ],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain("String(ctrl.userData.items ?? '') !== ''");
        });
    });

    describe('Pattern 25: help command registration', () => {
        it('registers help command via bot.addCommand', () => {
            const code = writeJsonAndGenerate('p25_help', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'start',
                        slots: ['старт'],
                        isPattern: false,
                        response: { text: 'Привет!', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'Не понял. Введите "помощь" для справки.' },
                welcome: { text: 'Привет! Введите "помощь" для справки.' },
                helpText: { text: 'Это справка по боту. Напишите команду.' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            // Проверяем что help_text берётся из helpText, а не fallback
            expect(code).toContain("help_text: 'Это справка по боту. Напишите команду.'");
            // Проверяем что fallback идёт в empty_text
            expect(code).toContain('empty_text: \'Не понял. Введите "помощь" для справки.\'');
        });
    });

    describe('Pattern 26: condition branch → step uses thisIntentName', () => {
        it('navigates to step via thisIntentName instead of calling non-existent function', () => {
            const code = writeJsonAndGenerate('p26_branch_step', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'start',
                        slots: ['старт'],
                        isPattern: false,
                        response: { text: '', buttons: [], sounds: [] },
                    },
                    {
                        type: 'condition',
                        id: 'cond1',
                        name: 'check',
                        variable: 'v',
                        operator: 'eq',
                        value: 'yes',
                    },
                    {
                        type: 'step',
                        id: 's1',
                        name: 'nextStep',
                        prompt: { text: 'Продолжаем', buttons: [] },
                        saveTo: 'x',
                        saveAs: 'original',
                    },
                ],
                edges: [
                    { from: 'c1', to: 'cond1', type: 'next' },
                    { from: 'cond1', to: 's1', type: 'branch_true' },
                ],
                fallback: { text: 'Не понял' },
                welcome: { text: 'Привет!' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            // Должна быть thisIntentName, а НЕ __nextStep(ctrl)
            expect(code).toContain("ctrl.thisIntentName = 'nextStep'");
            expect(code).not.toContain('__nextStep(ctrl)');
            // Шаг зарегистрирован через addStep
            expect(code).toContain("bot.addStep('nextStep'");
        });
    });

    describe('Edge cases: textExpr escaping', () => {
        it('backticks in text are escaped', () => {
            const code = writeJsonAndGenerate('edge_backtick', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'cmd',
                        slots: ['t'],
                        isPattern: false,
                        response: { text: 'Привет `мир`!', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'ERR' },
                welcome: { text: 'Hi' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain("setText(ctrl, 'Привет \\`мир\\`!')");
        });

        it('${} in text without {{}} is escaped via escapeStr', () => {
            const code = writeJsonAndGenerate('edge_dollar', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'cmd',
                        slots: ['t'],
                        isPattern: false,
                        response: { text: 'Цена: 100${x}р', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'ERR' },
                welcome: { text: 'Hi' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            // escapeStr экранирует $ → \$ в строке, результат в файле: \${x}
            expect(code).toContain('Цена: 100\\${x}р');
        });

        it('empty {{}} does not produce invalid ${} in template literal', () => {
            const code = writeJsonAndGenerate('edge_empty_braces', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'cmd',
                        slots: ['t'],
                        isPattern: false,
                        response: { text: 'Значение: {{}}', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'ERR' },
                welcome: { text: 'Hi' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            // {{}} не совпадёт с regex \{\{(\w+)\}\} → останется как есть → в шаблонном литерале ${}
            // Но escapeStr() экранирует $ → \$, поэтому ${} станет \${} — валидный JS
            expect(code).not.toContain('${}');
        });

        it('variable name with dot uses bracket syntax', () => {
            const code = writeJsonAndGenerate('edge_dot_var', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'cmd',
                        slots: ['t'],
                        isPattern: false,
                        saveTo: 'user.name',
                        response: { text: '', buttons: [], sounds: [] },
                    },
                    {
                        type: 'command',
                        id: 'c2',
                        name: 'cmd2',
                        slots: ['t2'],
                        isPattern: false,
                        actions: [{ type: 'set_variable', field: 'result', value: 'user.name' }],
                        response: { text: '', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'ERR' },
                welcome: { text: 'Hi' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            // user.name не является валидным JS-идентификатором → используется скобочный синтаксис
            expect(code).toContain("ctrl.userData['user.name']");
            expect(code).toContain("ctrl.userData.result = ctrl.userData['user.name']");
        });

        it('text with backticks inside template literal with {{vars}}', () => {
            const code = writeJsonAndGenerate('edge_backtick_template', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'cmd',
                        slots: ['t'],
                        isPattern: false,
                        response: { text: 'Привет {{name}} `мир`!', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'ERR' },
                welcome: { text: 'Hi' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            // {{name}} → ${...} (не экранируется), \`мир\` → экранируется
            expect(code).toContain('${');
            expect(code).toContain('\\`');
        });
        it('set_variable with __currentTimestamp system var', () => {
            const code = writeJsonAndGenerate('sysvar_ts', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'cmd',
                        slots: ['t'],
                        isPattern: false,
                        actions: [
                            { type: 'set_variable', field: 'ts', value: '__currentTimestamp' },
                        ],
                        response: { text: '', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
                fallback: { text: 'ERR' },
                welcome: { text: 'Hi' },
                database: { type: 'file', config: {} },
                isLocalStorage: true,
            });
            expect(code).toContain('ctrl.userData.ts = (Date.now())');
            expect(code).not.toContain('Stamp');
        });
    });

    describe('Empty conditions and actions', () => {
        it('skips conditions with empty variable', () => {
            const code = writeJsonAndGenerate('edge_empty_cond', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'cmd1',
                        name: 'test',
                        slots: ['test'],
                        isPattern: false,
                        response: { text: 'hi', buttons: [], sounds: [] },
                        conditions: [
                            {
                                variable: '',
                                operator: 'eq',
                                value: '',
                                responseTrue: { text: '' },
                                responseFalse: { text: '' },
                            },
                        ],
                        actions: [],
                    },
                ],
                edges: [],
                fallback: { text: 'No' },
                welcome: { text: 'Hi' },
                database: { type: 'none', config: {} },
                isLocalStorage: true,
            });
            // Пустые условия не должны генерировать невалидный код
            expect(code).not.toContain("ctrl.userData === ''");
            expect(code).not.toContain('ctrl.userData === ""');
            // Но сама команда должна быть сгенерирована
            expect(code).toContain("bot.addCommand('test'");
        });

        it('skips set_variable with empty field', () => {
            const code = writeJsonAndGenerate('edge_empty_action', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'cmd1',
                        name: 'test',
                        slots: ['test'],
                        isPattern: false,
                        response: { text: 'hi', buttons: [], sounds: [] },
                        conditions: [],
                        actions: [
                            { type: 'set_variable', field: '', value: '' },
                            { type: 'set_variable', field: 'valid', value: 'hello' },
                        ],
                    },
                ],
                edges: [],
                fallback: { text: 'No' },
                welcome: { text: 'Hi' },
                database: { type: 'none', config: {} },
                isLocalStorage: true,
            });
            // Пустое действие пропущено, валидное — есть
            expect(code).toContain("ctrl.userData.valid = 'hello'");
        });

        it('skips random_number with empty field', () => {
            const code = writeJsonAndGenerate('edge_empty_random', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'cmd1',
                        name: 'test',
                        slots: ['test'],
                        isPattern: false,
                        response: { text: 'hi', buttons: [], sounds: [] },
                        conditions: [],
                        actions: [
                            { type: 'random_number', field: '', min: 1, max: 10 },
                            { type: 'random_number', field: 'score', min: 0, max: 100 },
                        ],
                    },
                ],
                edges: [],
                fallback: { text: 'No' },
                welcome: { text: 'Hi' },
                database: { type: 'none', config: {} },
                isLocalStorage: true,
            });
            expect(code).not.toContain('rand(1, 10)');
            expect(code).toContain('rand(0, 100)');
            expect(code).toContain('ctrl.userData.score');
        });
    });

    describe('validateFlowSchema', () => {
        function writeFlowJson(name: string, doc: unknown): string {
            const jsonPath = path.join(JSON_DIR, `${name}.json`);
            fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2));
            return jsonPath;
        }

        it('возвращает пустой массив для валидного flow.json', () => {
            const jsonPath = writeFlowJson('valid', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'cmd1',
                        name: 'test',
                        slots: ['test'],
                        isPattern: false,
                        response: { text: 'hi', buttons: [], sounds: [] },
                        conditions: [],
                        actions: [],
                        next: 'end1',
                    },
                    { type: 'end', id: 'end1' },
                ],
                edges: [],
                fallback: { text: 'No' },
                welcome: { text: 'Hi' },
                database: { type: 'none', config: {} },
                isLocalStorage: true,
            });
            expect(validateFlowSchema(jsonPath)).toEqual([]);
        });

        it('находит узел без id', () => {
            const jsonPath = writeFlowJson('missing_id', {
                name: 'test',
                nodes: [{ type: 'command', name: 'test' }],
            });
            const errors = validateFlowSchema(jsonPath);
            expect(errors.some((e) => e.includes('`id`'))).toBe(true);
        });

        it('находит дублирующиеся id', () => {
            const jsonPath = writeFlowJson('duplicate_id', {
                name: 'test',
                nodes: [
                    { type: 'command', id: 'a', name: 'one' },
                    { type: 'command', id: 'a', name: 'two' },
                ],
            });
            const errors = validateFlowSchema(jsonPath);
            expect(errors.some((e) => e.includes('дублирующийся'))).toBe(true);
        });

        it('находит битое ребро (ссылка на несуществующий узел)', () => {
            const jsonPath = writeFlowJson('broken_edge', {
                name: 'test',
                nodes: [{ type: 'command', id: 'a', name: 'one' }],
                edges: [{ from: 'a', to: 'nonexistent', type: 'next' }],
            });
            const errors = validateFlowSchema(jsonPath);
            expect(errors.some((e) => e.includes('несуществующий узел'))).toBe(true);
        });

        it('находит ребро с неизвестным type', () => {
            const jsonPath = writeFlowJson('bad_edge_type', {
                name: 'test',
                nodes: [
                    { type: 'command', id: 'a', name: 'one' },
                    { type: 'command', id: 'b', name: 'two' },
                ],
                edges: [{ from: 'a', to: 'b', type: 'teleport' }],
            });
            const errors = validateFlowSchema(jsonPath);
            expect(errors.some((e) => e.includes('неизвестный type'))).toBe(true);
        });

        it('сообщает об отсутствии name', () => {
            const jsonPath = writeFlowJson('missing_name', {
                nodes: [{ type: 'command', id: 'a', name: 'one' }],
            });
            const errors = validateFlowSchema(jsonPath);
            expect(errors.some((e) => e.includes('`name`'))).toBe(true);
        });

        it('сообщает об отсутствии nodes', () => {
            const jsonPath = writeFlowJson('missing_nodes', { name: 'test' });
            const errors = validateFlowSchema(jsonPath);
            expect(errors.some((e) => e.includes('`nodes`'))).toBe(true);
        });

        it('циклы в графе допустимы (например, генератор примеров в игре)', () => {
            const jsonPath = writeFlowJson('cycle', {
                name: 'test',
                nodes: [
                    { type: 'command', id: 'a', name: 'a' },
                    { type: 'command', id: 'b', name: 'b' },
                ],
                edges: [
                    { from: 'a', to: 'b', type: 'next' },
                    { from: 'b', to: 'a', type: 'next' },
                ],
            });
            const errors = validateFlowSchema(jsonPath);
            expect(errors).toEqual([]);
        });

        it('отклоняет цикл, состоящий только из исполняемых блоков (action/condition/response)', () => {
            const jsonPath = writeFlowJson('exec_cycle', {
                name: 'test',
                nodes: [
                    { type: 'command', id: 'c', name: 'c' },
                    { type: 'action', id: 'a1', actions: [] },
                    { type: 'action', id: 'a2', actions: [] },
                ],
                edges: [
                    { from: 'c', to: 'a1', type: 'next' },
                    { from: 'a1', to: 'a2', type: 'next' },
                    { from: 'a2', to: 'a1', type: 'next' },
                ],
            });
            const errors = validateFlowSchema(jsonPath);
            expect(errors.length).toBe(1);
            expect(errors[0]).toContain('цикл, состоящий только из блоков');
        });

        it('пропускает цикл из исполняемых блоков, если он проходит через step', () => {
            const jsonPath = writeFlowJson('exec_cycle_via_step', {
                name: 'test',
                nodes: [
                    { type: 'command', id: 'c', name: 'c' },
                    { type: 'action', id: 'a1', actions: [] },
                    { type: 'step', id: 's', name: 's' },
                ],
                edges: [
                    { from: 'c', to: 'a1', type: 'next' },
                    { from: 'a1', to: 's', type: 'next' },
                    { from: 's', to: 'a1', type: 'next' },
                ],
            });
            const errors = validateFlowSchema(jsonPath);
            expect(errors).toEqual([]);
        });

        it('возвращает ошибку для несуществующего файла', () => {
            const errors = validateFlowSchema('/definitely/not/existing/flow.json');
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0]).toContain('Не удалось прочитать');
        });

        it('определяет невалидный saveTo', () => {
            const jsonPath = writeFlowJson('bad_saveTo', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'a',
                        name: 'a',
                        saveTo: 'invalid identifier!',
                    },
                ],
            });
            const errors = validateFlowSchema(jsonPath);
            expect(errors.some((e) => e.includes('saveTo'))).toBe(true);
        });

        it('отклоняет null-узлы и зарезервированные свойства прототипа', () => {
            const nullNodePath = writeFlowJson('null_node', {
                name: 'test',
                nodes: [null],
            });
            const protoPath = writeFlowJson('proto_key', {
                name: 'test',
                nodes: [{ id: 'c', type: 'command', saveTo: '__proto__' }],
            });

            expect(validateFlowSchema(nullNodePath)).toEqual([
                'nodes[0]: узел должен быть объектом',
            ]);
            expect(validateFlowSchema(protoPath).some((error) => error.includes('прототипа'))).toBe(
                true,
            );
        });

        it('проверяет schema перед генерацией', () => {
            const jsonPath = writeFlowJson('invalid_before_generate', {
                name: 'test',
                nodes: [null],
            });
            expect(() => generateFromFlow(jsonPath, path.join(TEST_DIR, 'invalid'))).toThrow(
                'узел должен быть объектом',
            );
        });
    });

    describe('Регрессии генерации и cloud-режима', () => {
        it('сохраняет HTTP-метод для запроса без body', () => {
            const code = writeJsonAndGenerate('post_without_body', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'remove',
                        actions: [
                            {
                                type: 'http_request',
                                method: 'DELETE',
                                url: 'https://api.example.com/resource/1',
                            },
                        ],
                    },
                ],
                edges: [],
            });

            expect(code).toContain(
                "fetchWithTimeout('https://api.example.com/resource/1', { method: 'DELETE' })",
            );
        });

        it('нормализует имена блоков и сохраняет сгенерированный проект компилируемым', () => {
            const name = 'unsafe_block_names';
            const code = writeJsonAndGenerate(name, {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'command',
                        name: 'start',
                        response: { text: 'start' },
                    },
                    {
                        type: 'action',
                        id: 'action-one',
                        name: 'send message',
                        text: 'first',
                    },
                    {
                        type: 'response',
                        id: 'response-one',
                        name: 'send message',
                        response: { text: 'second' },
                    },
                ],
                edges: [
                    { from: 'command', to: 'action-one', type: 'next' },
                    { from: 'action-one', to: 'response-one', type: 'next' },
                ],
            });

            expect(code).toContain('function __send_message(');
            expect(code).toContain('function __send_message_2(');
            expectProjectToTypeCheck(path.join(TEST_DIR, name));
        });

        it('проверяет текущий ввод для isSayTrue без выбранной переменной', () => {
            const code = writeJsonAndGenerate('say_true_user_command', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'confirm',
                        conditions: [
                            {
                                operator: 'isSayTrue',
                                responseTrue: { text: 'yes' },
                                responseFalse: { text: 'no' },
                            },
                        ],
                    },
                ],
                edges: [],
            });

            expect(code).toContain("Text.isSayTrue(ctrl.userCommand || '')");
        });

        it('генерирует Cloud Function без локального listener и с compiled entrypoint', () => {
            const name = 'cloud_project';
            const code = writeJsonAndGenerate(
                name,
                {
                    name: 'Cloud bot!',
                    nodes: [],
                    edges: [],
                },
                { useCloud: true },
            );
            const outputPath = path.join(TEST_DIR, name);
            const serverlessYml = fs.readFileSync(path.join(outputPath, 'serverless.yml'), 'utf8');
            const packageJson = fs.readFileSync(path.join(outputPath, 'package.json'), 'utf8');

            expect(code).not.toContain("bot.start('localhost', 3000)");
            // Cloud-handler должен идти через авторизованный webhook-путь, а не прямой run()
            expect(code).toContain('bot.webhookEvent(content, headers)');
            expect(code).toContain('event.headers');
            expect(code).not.toContain('bot.setContent(');
            expect(code).not.toContain('await bot.run()');
            expect(serverlessYml).toContain('name: cloud-bot');
            expect(serverlessYml).toContain('runtime: nodejs22');
            expect(serverlessYml).toContain('entrypoint: dist/index.handler');
            expect(packageJson).toContain('node ./scripts/deploy.js');
            expect(
                fs.readFileSync(path.join(outputPath, 'scripts', 'deploy.js'), 'utf8'),
            ).toContain("'--entrypoint', 'dist/index.handler'");
            expectProjectToTypeCheck(outputPath);
        });
    });

    describe('Security and generated-source regressions', () => {
        it('does not treat a successful empty HTTP response as an error', () => {
            const code = writeJsonAndGenerate('empty_http_response', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'remove',
                        actions: [
                            {
                                type: 'http_request',
                                method: 'DELETE',
                                url: 'https://api.example.com/resource/1',
                                saveResponseTo: 'result',
                            },
                        ],
                    },
                ],
                edges: [],
            });

            expect(code).toContain('const responseText = await response.text();');
            expect(code).toContain('let data: unknown = null;');
            expect(code).not.toContain('await response.json()');
            expectProjectToTypeCheck(path.join(TEST_DIR, 'empty_http_response'));
        });

        it('tsconfig from-flow явно подключает типы node (TS 6.0: types по умолчанию пуст)', () => {
            // Без types: ['node'] сгенерированный utils.ts (setTimeout(...).unref())
            // не собирается у пользователя: TS2339 'unref' does not exist on type 'number'.
            // Хелпер тайпчека не подставляет types сам — проверяется
            // ровно пользовательский tsconfig.
            writeJsonAndGenerate('tsconfig_types', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'load',
                        actions: [
                            {
                                type: 'http_request',
                                method: 'GET',
                                url: 'https://api.example.com/resource',
                                saveResponseTo: 'result',
                            },
                        ],
                    },
                ],
                edges: [],
            });
            const tsconfig = JSON.parse(
                fs.readFileSync(path.join(TEST_DIR, 'tsconfig_types', 'tsconfig.json'), 'utf8'),
            ) as { compilerOptions: { types?: string[] } };
            expect(tsconfig.compilerOptions.types).toEqual(['node']);
            expectProjectToTypeCheck(path.join(TEST_DIR, 'tsconfig_types'));
        });

        it('does not insert arbitrary code from set_variable or random_number bounds', () => {
            const code = writeJsonAndGenerate('safe_action_values', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'start',
                        actions: [
                            { type: 'set_variable', field: 'value', value: 'Math.random(); run()' },
                            { type: 'set_variable', field: 'sum', value: 'value + 3' },
                            {
                                type: 'random_number',
                                field: 'random',
                                min: '1); run()',
                                max: '20',
                            },
                        ],
                    },
                ],
                edges: [],
            });

            expect(code).toContain("ctrl.userData.value = 'Math.random(); run()';");
            expect(code).toContain('ctrl.userData.sum = Number(ctrl.userData.value ?? 0) + 3;');
            expect(code).toContain('ctrl.userData.random = rand(1, 20);');
            expectProjectToTypeCheck(path.join(TEST_DIR, 'safe_action_values'));
        });

        it('restricts HTTP methods to the standard set', () => {
            const code = writeJsonAndGenerate('safe_http_method', {
                name: 'test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'start',
                        actions: [
                            {
                                type: 'http_request',
                                method: "DELETE'); run(); ('",
                                url: 'https://api.example.com/resource/1',
                            },
                        ],
                    },
                ],
                edges: [],
            });

            expect(code).toContain("fetchWithTimeout('https://api.example.com/resource/1')");
            expect(code).not.toContain("DELETE'); run(); ('");
            expectProjectToTypeCheck(path.join(TEST_DIR, 'safe_http_method'));
        });

        it('pins dependencies in a project generated from flow', () => {
            writeJsonAndGenerate('pinned_flow_dependencies', {
                name: 'test',
                nodes: [],
                edges: [],
            });
            const packageJson = JSON.parse(
                fs.readFileSync(
                    path.join(TEST_DIR, 'pinned_flow_dependencies', 'package.json'),
                    'utf8',
                ),
            ) as {
                dependencies: Record<string, string>;
                devDependencies: Record<string, string>;
            };

            // Проект зависит от той версии umbot, чей CLI его сгенерировал
            expect(packageJson.dependencies.umbot).toBe(
                '^' +
                    (
                        JSON.parse(
                            fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'),
                        ) as { version: string }
                    ).version,
            );
            expect(packageJson.devDependencies.typescript).toBe('6.0.3');
            expect(packageJson.devDependencies['@types/node']).toBe('24.13.4');
        });

        it('не даёт закрыть JSDoc-комментарий и внедрить код через flow.json', () => {
            // flow.json приходит из визуального редактора и может быть получен извне.
            // Последовательность */ в имени блока закрывала комментарий, и всё, что шло
            // дальше, попадало в src/index.ts пользователя как исполняемый код.
            const payload = '*/ ;globalThis.__pwned = true; /*';
            const code = writeJsonAndGenerate('comment_injection', {
                name: 'test',
                nodes: [
                    {
                        id: 'c1',
                        type: 'command',
                        name: 'cmd',
                        slots: [payload],
                        response: { text: payload },
                    },
                    {
                        id: 's1',
                        type: 'step',
                        name: payload,
                        prompt: { text: payload },
                    },
                ],
                edges: [],
            });

            // Ни один комментарий не должен закрываться раньше времени
            code.split('\n')
                .filter((line) => line.trimStart().startsWith('/**'))
                .forEach((line) => {
                    expect(line.trimEnd().endsWith('*/')).toBe(true);
                    expect(line.slice(3, -2)).not.toContain('*/');
                });
            expect(code).not.toContain('globalThis.__pwned = true;\n');
            expectProjectToTypeCheck(path.join(TEST_DIR, 'comment_injection'));
        });
    });
});
