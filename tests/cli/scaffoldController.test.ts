/**
 * `umbot add platform|db|middleware`: генерация каркаса в проекте пользователя.
 *
 * Главная проверка — сквозная: каркас создаётся в проекте с tsconfig шаблона `create`,
 * компилируется против текущего dist/ и его собственные тесты (node:test) проходят.
 * Изменился контракт адаптера или middleware, а шаблон нет — падает здесь, а не у пользователя.
 */
import { execFileSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
    addScaffold,
    parseName,
    runAddScaffold,
} from '../../cli/controllers/ScaffoldController.js';
import { createTestDir, removeTestDir } from '../helpers/tmpDir';
import { expectProjectToTypeCheck } from '../helpers/typecheck';

const PROJECT_ROOT = resolve(__dirname, '..', '..');

/**
 * Пустой проект umbot: папка src/ и tsconfig из шаблона `create`.
 * @param dir Папка проекта
 */
function createProject(dir: string): void {
    mkdirSync(join(dir, 'src'), { recursive: true });
    copyFileSync(
        join(PROJECT_ROOT, 'cli', 'template', 'tsconfig.json'),
        join(dir, 'tsconfig.json'),
    );
}

/**
 * Собирает проект в dist/ так, как это сделает `npm run build` у пользователя:
 * пакет umbot — ссылка на репозиторий, @types — из репозитория.
 * @param dir Папка проекта
 */
function buildProject(dir: string): void {
    const umbotLink = join(dir, 'node_modules', 'umbot');
    if (!existsSync(umbotLink)) {
        mkdirSync(join(dir, 'node_modules'), { recursive: true });
        symlinkSync(PROJECT_ROOT, umbotLink, 'junction');
    }
    const configPath = join(dir, 'tsconfig.umbot-build.json');
    writeFileSync(
        configPath,
        JSON.stringify({
            extends: './tsconfig.json',
            compilerOptions: { typeRoots: [join(PROJECT_ROOT, 'node_modules', '@types')] },
        }),
    );
    const tscBin = join(PROJECT_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
    try {
        execFileSync(process.execPath, [tscBin, '-p', configPath], {
            encoding: 'utf8',
            stdio: 'pipe',
        });
    } catch (error) {
        const execError = error as { stdout?: string; stderr?: string };
        throw new Error(
            `Каркас не компилируется:\n${execError.stdout ?? ''}${execError.stderr ?? ''}`,
            {
                cause: error,
            },
        );
    }
}

/**
 * Запускает сгенерированный тест так, как подсказывает CLI (`node --test dist/...`).
 * @param dir Папка проекта
 * @param testFile Путь к собранному тесту относительно проекта
 * @returns Вывод node:test в формате TAP (без цветов, итоги — строками `# pass N`, `# fail N`)
 */
function runNodeTest(dir: string, testFile: string): string {
    try {
        return execFileSync(process.execPath, ['--test', '--test-reporter=tap', testFile], {
            cwd: dir,
            encoding: 'utf8',
            stdio: 'pipe',
        });
    } catch (error) {
        const execError = error as { stdout?: string; stderr?: string };
        throw new Error(
            `Тесты каркаса не прошли:\n${execError.stdout ?? ''}${execError.stderr ?? ''}`,
            {
                cause: error,
            },
        );
    }
}

describe('umbot add: разбор имени', () => {
    it.each([
        ['discord', ['Adapter'], { Name: 'Discord', name: 'discord', platformName: 'discord' }],
        [
            'DiscordAdapter',
            ['Adapter'],
            { Name: 'Discord', name: 'discord', platformName: 'discord' },
        ],
        [
            'my-platform',
            ['Adapter'],
            { Name: 'MyPlatform', name: 'myPlatform', platformName: 'my_platform' },
        ],
        ['postgresDbAdapter', ['DbAdapter', 'Adapter'], { Name: 'Postgres', name: 'postgres' }],
        ['auth_guard', [], { Name: 'AuthGuard', name: 'authGuard' }],
    ])('%s', (raw, suffixes, expected) => {
        expect(parseName(raw, suffixes)).toEqual(expect.objectContaining(expected));
    });

    it('не отрезает суффикс, если от имени ничего не останется', () => {
        expect(parseName('Adapter', ['Adapter']).Name).toBe('Adapter');
    });

    it.each(['1discord', 'my platform', 'имя', '../evil', ''])('отклоняет «%s»', (raw) => {
        expect(() => parseName(raw, [])).toThrow('Некорректное имя');
    });

    it('отклоняет зарезервированное слово', () => {
        expect(() => parseName('delete', [])).toThrow('зарезервированное слово');
    });
});

describe('umbot add: файлы проекта', () => {
    let dir: string;

    beforeEach(() => {
        dir = createTestDir('scaffold');
        createProject(dir);
    });

    afterEach(async () => {
        await removeTestDir(dir);
    });

    it('создаёт адаптер и тест в src/platforms', () => {
        const res = addScaffold('platform', 'discord', { cwd: dir });
        expect(res.files).toEqual([
            'src/platforms/DiscordAdapter.ts',
            'src/platforms/DiscordAdapter.test.ts',
        ]);
        expect(res.testCommand).toBe(
            'npm run build && node --test dist/platforms/DiscordAdapter.test.js',
        );
        expect(res.hint).toContain('bot.use(new DiscordAdapter(discordToken));');
        const adapter = readFileSync(join(dir, 'src/platforms/DiscordAdapter.ts'), 'utf8');
        expect(adapter).toContain("platformName = 'discord';");
        expect(adapter).not.toMatch(/\{\{\w+\}\}/);
    });

    it('создаёт адаптер БД и middleware', () => {
        expect(addScaffold('db', 'Postgres', { cwd: dir }).files).toEqual([
            'src/db/PostgresDbAdapter.ts',
            'src/db/PostgresDbAdapter.test.ts',
        ]);
        expect(addScaffold('middleware', 'auth-check', { cwd: dir }).files).toEqual([
            'src/middleware/authCheck.ts',
            'src/middleware/authCheck.test.ts',
        ]);
    });

    it('не перезаписывает файлы без force и не пишет вторую половину пары', () => {
        const adapterPath = join(dir, 'src/platforms/DiscordAdapter.ts');
        mkdirSync(join(dir, 'src/platforms'));
        writeFileSync(adapterPath, '// код пользователя');

        expect(() => addScaffold('platform', 'discord', { cwd: dir })).toThrow(
            'Файл уже существует: src/platforms/DiscordAdapter.ts',
        );
        expect(readFileSync(adapterPath, 'utf8')).toBe('// код пользователя');
        expect(existsSync(join(dir, 'src/platforms/DiscordAdapter.test.ts'))).toBe(false);
    });

    it('перезаписывает с force', () => {
        mkdirSync(join(dir, 'src/platforms'));
        writeFileSync(join(dir, 'src/platforms/DiscordAdapter.ts'), '// код пользователя');
        addScaffold('platform', 'discord', { cwd: dir, force: true });
        expect(readFileSync(join(dir, 'src/platforms/DiscordAdapter.ts'), 'utf8')).toContain(
            'class DiscordAdapter',
        );
    });

    it('предупреждает о совпадении со встроенной платформой', () => {
        expect(addScaffold('platform', 'telegram', { cwd: dir }).warnings[0]).toContain(
            'совпадает со встроенной платформой',
        );
    });

    it('требует папку src/ и известный вид каркаса', async () => {
        const empty = createTestDir('scaffold-empty');
        try {
            expect(() => addScaffold('platform', 'discord', { cwd: empty })).toThrow(
                'Папка src/ не найдена',
            );
        } finally {
            await removeTestDir(empty);
        }
        expect(() => addScaffold('plugin' as 'db', 'x', { cwd: dir })).toThrow(
            'Неизвестный вид каркаса',
        );
        expect(() => addScaffold('db', '', { cwd: dir })).toThrow('Укажите имя');
    });

    it('runAddScaffold: ошибка — сообщение и код выхода 1', () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation();
        const prevExitCode = process.exitCode;
        try {
            const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(dir);
            expect(runAddScaffold('db', ['node', 'umbot', 'add', 'db', '1bad'])).toBe(false);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Некорректное имя'));
            expect(process.exitCode).toBe(1);
            cwdSpy.mockRestore();
        } finally {
            errorSpy.mockRestore();
            process.exitCode = prevExitCode;
        }
    });

    it('runAddScaffold: печатает созданные файлы, подключение и команду проверки', () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(dir);
        try {
            expect(
                runAddScaffold('middleware', [
                    'node',
                    'umbot',
                    'add',
                    'middleware',
                    'guard',
                    '--force',
                ]),
            ).toBe(true);
            const output = logSpy.mock.calls.flat().join('\n');
            expect(output).toContain('src/middleware/guard.ts');
            expect(output).toContain('bot.use(guard());');
            expect(output).toContain('node --test dist/middleware/guard.test.js');
        } finally {
            logSpy.mockRestore();
            cwdSpy.mockRestore();
        }
    });
});

describe('umbot add: каркас компилируется и его тесты проходят', () => {
    let dir: string;

    beforeAll(() => {
        dir = createTestDir('scaffold-build');
        createProject(dir);
        addScaffold('platform', 'my-chat', { cwd: dir });
        addScaffold('db', 'Postgres', { cwd: dir });
        addScaffold('middleware', 'guard', { cwd: dir });
    });

    afterAll(async () => {
        await removeTestDir(dir);
    });

    it('проходит typecheck с tsconfig шаблона create', () => {
        expectProjectToTypeCheck(dir);
    });

    it('тесты каркасов зелёные сразу после генерации', () => {
        buildProject(dir);
        for (const testFile of [
            'dist/platforms/MyChatAdapter.test.js',
            'dist/db/PostgresDbAdapter.test.js',
            'dist/middleware/guard.test.js',
        ]) {
            // Упавший тест даёт ненулевой код выхода — runNodeTest бросит исключение с выводом.
            const output = runNodeTest(dir, testFile);
            expect(output).toMatch(/^# pass [1-9]/m);
            expect(output).toMatch(/^# fail 0$/m);
        }
    });

    it('адаптер без токена не отправляет ответ и не роняет запрос', () => {
        // Отдельный процесс: модуль umbot из dist видит свой fetch, подмена в jest до него не дойдёт.
        const script = `
            let calls = 0;
            globalThis.fetch = async () => { calls++; return new Response('{}'); };
            const { Bot } = require('umbot');
            const { MyChatAdapter } = require('./dist/platforms/MyChatAdapter.js');
            const bot = new Bot();
            bot.use(new MyChatAdapter());
            bot.setLogger({ error() {}, warn() {}, log() {} });
            bot.addCommand('hi', ['привет'], (_, ctx) => { ctx.text = 'Привет!'; });
            const query = { type: 'message', user_id: '1', chat_id: '1', text: 'привет' };
            bot.run('my_chat', JSON.stringify(query)).then((res) => {
                process.stdout.write(JSON.stringify({ res, calls }));
            });
        `;
        const stdout = execFileSync(process.execPath, ['-e', script], {
            cwd: dir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        expect(JSON.parse(stdout)).toEqual({ res: 'ok', calls: 0 });
    });
});
