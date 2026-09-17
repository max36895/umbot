/**
 * Пользовательский сценарий from-flow: старт диалога, настройки бота, проект «под ключ».
 *
 * Регрессии аудита «редактор ≠ сгенерированный бот»:
 * - старт диалога (/start в Telegram, новая сессия Алисы) уходил в fallback, а не в приветствие;
 * - шаг, ожидавший ответ в прошлой сессии, съедал запуск навыка;
 * - приветствие/справка из настроек бота не работали без нод welcome/help (intents: []);
 * - режим бота из настроек игнорировался (бот всегда в dev);
 * - .env читался, только если токен был во flow.json;
 * - после генерации не было инструкции (README).
 *
 * Поведенческие проверки гоняют сгенерированный проект как навык Алисы (см. helpers/generatedBot).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateFromFlow } from './../../cli/flowGenerator';
import { expectProjectToTypeCheck } from '../helpers/typecheck';
import {
    buildGeneratedBot,
    createAlisaDialog,
    IAlisaDialog,
    sendTelegramUpdateInChild,
} from '../helpers/generatedBot';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'umbot-flow-scenario-'));
const initialCwd = process.cwd();

afterAll(() => {
    process.chdir(initialCwd);
    fs.rmSync(ROOT, { recursive: true, force: true });
});

/** Базовый документ как из редактора (платформа Алиса, без базы данных). */
function flow(name: string, extra: Record<string, unknown>): Record<string, unknown> {
    return {
        schemaVersion: '1.0',
        name,
        platforms: ['alisa'],
        database: { type: 'none', config: {} },
        mode: 'prod',
        isLocalStorage: true,
        fallback: { text: 'Не понял.' },
        welcome: { text: '', buttons: [] },
        helpText: { text: '' },
        nodes: [],
        edges: [],
        ...extra,
    };
}

const welcomeNode = (
    text: string,
    extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
    type: 'command',
    id: 'welcome',
    name: 'welcome',
    slots: [],
    isPattern: false,
    role: 'welcome',
    response: { text, buttons: [], sounds: [] },
    ...extra,
});

/** Генерирует проект; stdout CLI глушится. */
function generate(
    name: string,
    doc: Record<string, unknown>,
    options: Record<string, unknown> = {},
): { outputPath: string; code: string } {
    const jsonPath = path.join(ROOT, `${name}.json`);
    const outputPath = path.join(ROOT, name);
    fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2));
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        generateFromFlow(jsonPath, outputPath, options);
    } finally {
        log.mockRestore();
        warn.mockRestore();
    }
    return {
        outputPath,
        code: fs.readFileSync(path.join(outputPath, 'src', 'index.ts'), 'utf8'),
    };
}

/** Генерирует cloud-проект и открывает с ним диалог Алисы (cwd — папка проекта, как у npm start). */
function startBot(name: string, doc: Record<string, unknown>): IAlisaDialog {
    const { outputPath } = generate(name, doc, { useCloud: true });
    process.chdir(outputPath);
    return createAlisaDialog(buildGeneratedBot(outputPath));
}

describe('from-flow: старт диалога', () => {
    it('новая сессия Алисы получает приветствие, а не fallback', async () => {
        const dialog = startBot(
            'start_session',
            flow('start-session', { nodes: [welcomeNode('Привет! Как вас зовут?')] }),
        );
        expect((await dialog.say('')).text).toBe('Привет! Как вас зовут?');
        // Непонятная реплика посреди диалога по-прежнему уходит в fallback
        expect((await dialog.say('абракадабра')).text).toBe('Не понял.');
    });

    it('приветствие срабатывает на /start (Telegram) и на стандартные слоты', async () => {
        const doc = flow('start-slots', { nodes: [welcomeNode('Привет!')] });
        const { code, outputPath } = generate('start_slots_code', doc);
        expect(code).toContain(
            "bot.addCommand(WELCOME_INTENT_NAME, ['/start', ...WELCOME_INTENT_SLOTS], __cmd_welcome);",
        );
        expectProjectToTypeCheck(outputPath);

        const dialog = startBot('start_slots', doc);
        await dialog.say('');
        expect((await dialog.say('/start')).text).toBe('Привет!');
        expect((await dialog.say('/start deep-link')).text).toBe('Привет!');
        expect((await dialog.say('привет')).text).toBe('Привет!');
    });

    it('собственные слоты приветствия сохраняются, /start добавляется к ним', () => {
        const { code } = generate(
            'start_own_slots',
            flow('start-own', { nodes: [welcomeNode('Hi', { slots: ['hello'] })] }),
        );
        expect(code).toContain(
            "bot.addCommand(WELCOME_INTENT_NAME, ['/start', 'hello'], __cmd_welcome);",
        );
        expect(code).not.toContain('WELCOME_INTENT_SLOTS');
    });

    it('шаг, ожидавший ответ в прошлой сессии, не съедает запуск навыка', async () => {
        const dialog = startBot(
            'start_waiting_step',
            flow('start-step', {
                nodes: [
                    welcomeNode('Как вас зовут?'),
                    {
                        type: 'step',
                        id: 'ask',
                        name: 'ask',
                        prompt: { text: 'Приятно познакомиться, {{name}}!', buttons: [] },
                        saveTo: 'name',
                        saveAs: 'original',
                    },
                ],
                edges: [{ from: 'welcome', to: 'ask', type: 'next' }],
            }),
        );
        expect((await dialog.say('')).text).toBe('Как вас зовут?');
        // Пользователь закрыл навык, не ответив, и запустил снова
        dialog.newSession();
        expect((await dialog.say('')).text).toBe('Как вас зовут?');
        expect((await dialog.say('Макс')).text).toBe('Приятно познакомиться, Макс!');
        // /start во время ожидания шага тоже начинает диалог заново
        expect((await dialog.say('/start')).text).toBe('Как вас зовут?');
    });

    it('без приветствия (ни ноды, ни текста в настройках) старт уходит в fallback', async () => {
        const dialog = startBot('start_no_welcome', flow('start-none', {}));
        expect((await dialog.say('')).text).toBe('Не понял.');
        expect((await dialog.say('привет')).text).toBe('Не понял.');
    });

    it('fallback-нода вызывает приветствие в начале диалога; async-приветствие делает fallback async', () => {
        const { code, outputPath } = generate(
            'start_async_welcome',
            flow('start-async', {
                nodes: [
                    welcomeNode('Привет', {
                        actions: [
                            { type: 'http_request', url: 'https://example.com', method: 'GET' },
                        ],
                    }),
                    {
                        type: 'command',
                        id: 'fb',
                        name: 'fallback',
                        role: 'fallback',
                        slots: [],
                        isPattern: false,
                        response: { text: 'Не понял', buttons: [], sounds: [] },
                    },
                ],
            }),
        );
        expect(code).toContain(
            'async function __cmd_welcome(cmd: string, ctrl: BotController): Promise<void> {',
        );
        expect(code).toContain(
            'bot.addCommand(FALLBACK_COMMAND, [], async (cmd: string, ctrl: BotController): Promise<void> => {\n' +
                '    // Начало диалога (новая сессия голосового ассистента, «Начать»): приветствие, а не «не понял»\n' +
                '    if (ctrl.messageId === 0) {\n' +
                '        return __cmd_welcome(cmd, ctrl);\n' +
                '    }',
        );
        expectProjectToTypeCheck(outputPath);
    });
});

describe('from-flow: приветствие и справка из настроек бота', () => {
    it('без ноды welcome приветствие из настроек показывается на старте и на «привет», с кнопками', async () => {
        const dialog = startBot(
            'settings_welcome',
            flow('settings-welcome', {
                welcome: {
                    text: 'Добро пожаловать!',
                    buttons: [{ title: 'Меню', type: 'action' }],
                },
                nodes: [
                    {
                        type: 'command',
                        id: 'menu',
                        name: 'menu',
                        slots: ['меню'],
                        isPattern: false,
                        response: { text: 'Это меню', buttons: [], sounds: [] },
                    },
                ],
            }),
        );
        const start = await dialog.say('');
        expect(start.text).toBe('Добро пожаловать!');
        expect(start.buttons.map((b) => b.title)).toEqual(['Меню']);
        expect((await dialog.press('Меню')).text).toBe('Это меню');
        expect((await dialog.say('привет')).text).toBe('Добро пожаловать!');
    });

    it('без ноды help текст справки из настроек отвечает на «помощь»', async () => {
        const dialog = startBot(
            'settings_help',
            flow('settings-help', { helpText: { text: 'Я умею принимать заказы.' } }),
        );
        expect((await dialog.say('помощь')).text).toBe('Я умею принимать заказы.');
        expect((await dialog.say('что ты умеешь')).text).toBe('Я умею принимать заказы.');
    });

    it('при наличии нод welcome/help тексты из настроек не регистрируются повторно', () => {
        const { code } = generate(
            'settings_nodes_win',
            flow('settings-nodes', {
                welcome: { text: 'Из настроек', buttons: [] },
                helpText: { text: 'Справка из настроек' },
                nodes: [
                    welcomeNode('Из ноды'),
                    {
                        type: 'command',
                        id: 'help',
                        name: 'help',
                        role: 'help',
                        slots: [],
                        isPattern: false,
                        response: { text: 'Помощь из ноды', buttons: [], sounds: [] },
                    },
                ],
            }),
        );
        expect(code.match(/bot\.addCommand\(WELCOME_INTENT_NAME/g)).toHaveLength(1);
        expect(code.match(/bot\.addCommand\(HELP_INTENT_NAME/g)).toHaveLength(1);
        expect(code).not.toContain("setText(ctrl, 'Из настроек')");
        expect(code).not.toContain("setText(ctrl, 'Справка из настроек')");
    });
});

describe('from-flow: режим бота', () => {
    it.each(['dev', 'prod', 'strict_prod'])('режим %s из настроек попадает в код', (mode) => {
        const { code, outputPath } = generate(`mode_${mode}`, flow(`mode-${mode}`, { mode }));
        expect(code).toContain(`bot.setAppMode('${mode}');`);
        if (mode === 'strict_prod') {
            expectProjectToTypeCheck(outputPath);
        }
    });

    it('неизвестный или отсутствующий режим в код не вставляется', () => {
        expect(
            generate('mode_bad', flow('mode-bad', { mode: "prod'); evil('" })).code,
        ).not.toContain('setAppMode');
        const doc = flow('mode-none', {});
        delete doc.mode;
        expect(generate('mode_none', doc).code).not.toContain('setAppMode');
    });
});

describe('from-flow: .env и токены', () => {
    it('.env подключается и создаётся всегда — с пустыми переменными токенов выбранных платформ', () => {
        const { code, outputPath } = generate(
            'env_placeholders',
            flow('env-placeholders', { platforms: ['telegram', 'alisa'], tokens: {} }),
        );
        expect(code).toContain("    env: './.env',");
        const env = fs.readFileSync(path.join(outputPath, '.env'), 'utf8');
        expect(env).toMatch(/^TELEGRAM_TOKEN=$/m);
        expect(env).toMatch(/^ALISA_TOKEN=$/m);
    });

    it('токен, вписанный пользователем в .env вручную (во flow.json его нет), читается ботом', () => {
        const { outputPath } = generate(
            'env_manual',
            flow('env-manual', { platforms: ['telegram'], nodes: [welcomeNode('Привет')] }),
            { useCloud: true },
        );
        const env = fs
            .readFileSync(path.join(outputPath, '.env'), 'utf8')
            .replace(/^TELEGRAM_TOKEN=$/m, 'TELEGRAM_TOKEN=123456:manual-token');
        fs.writeFileSync(path.join(outputPath, '.env'), env);
        process.chdir(outputPath);
        buildGeneratedBot(outputPath);

        const calls = sendTelegramUpdateInChild(outputPath, {
            update_id: 1,
            message: {
                message_id: 10,
                from: { id: 7, is_bot: false, first_name: 'User' },
                chat: { id: 7, type: 'private' },
                date: 1,
                text: '/start',
            },
        });
        expect(calls.some((url) => url.includes('/bot123456:manual-token/sendMessage'))).toBe(true);
    });

    it('повторная генерация заполняет пустую переменную токеном из flow.json, но не трогает заполненные', () => {
        const outputPath = path.join(ROOT, 'env_regenerate');
        generate(
            'env_regenerate',
            flow('env-regen', { platforms: ['telegram', 'vk'], tokens: {} }),
        );
        fs.appendFileSync(path.join(outputPath, '.env'), 'OWN_SECRET=keep\n');
        const envWithVk = fs
            .readFileSync(path.join(outputPath, '.env'), 'utf8')
            .replace(/^VK_TOKEN=$/m, 'VK_TOKEN=user-vk');
        fs.writeFileSync(path.join(outputPath, '.env'), envWithVk);

        generate(
            'env_regenerate',
            flow('env-regen', {
                platforms: ['telegram', 'vk'],
                tokens: { telegram: 'flow-telegram', vk: 'flow-vk' },
            }),
            { force: true },
        );
        const env = fs.readFileSync(path.join(outputPath, '.env'), 'utf8');
        expect(env).toMatch(/^TELEGRAM_TOKEN=flow-telegram$/m);
        expect(env).toMatch(/^VK_TOKEN=user-vk$/m);
        expect(env).not.toContain('flow-vk');
        expect(env).toContain('OWN_SECRET=keep');
        expect(env.match(/^TELEGRAM_TOKEN=/gm)).toHaveLength(1);
    });
});

describe('from-flow: README и следующие шаги', () => {
    it('генерирует README с установкой, токенами, запуском и подключением выбранных платформ', () => {
        const { outputPath } = generate(
            'readme_server',
            flow('Пиццерия', { platforms: ['telegram', 'alisa'], port: 8080 }),
        );
        const readme = fs.readFileSync(path.join(outputPath, 'README.md'), 'utf8');
        expect(readme).toContain('# Пиццерия');
        expect(readme).toContain('npm install');
        expect(readme).toContain('npm run build');
        expect(readme).toContain('npm start');
        expect(readme).toContain('`TELEGRAM_TOKEN` — Telegram');
        expect(readme).toContain('`ALISA_TOKEN` — Алиса');
        expect(readme).toContain('http://localhost:8080/health');
        expect(readme).toContain('setWebhook');
        expect(readme).toContain('### Алиса');
        expect(readme).not.toContain('### ВКонтакте');
        expect(readme).not.toContain('npm run deploy');
    });

    it('для --usecloud README описывает деплой вместо локального запуска', () => {
        const { outputPath } = generate('readme_cloud', flow('cloud', {}), { useCloud: true });
        const readme = fs.readFileSync(path.join(outputPath, 'README.md'), 'utf8');
        expect(readme).toContain('npm run deploy');
        expect(readme).not.toContain('npm start');
    });

    it('CLI печатает следующие шаги после генерации', () => {
        const jsonPath = path.join(ROOT, 'next_steps.json');
        fs.writeFileSync(jsonPath, JSON.stringify(flow('next-steps', {})));
        const lines: string[] = [];
        const log = jest.spyOn(console, 'log').mockImplementation((...args) => {
            lines.push(args.join(' '));
        });
        try {
            generateFromFlow(jsonPath, path.join(ROOT, 'next_steps'));
        } finally {
            log.mockRestore();
        }
        const output = lines.join('\n');
        expect(output).toContain('README.md');
        expect(output).toContain('npm install');
        expect(output).toContain('npm run build && npm start');
    });
});
