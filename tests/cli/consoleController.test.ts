import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { computeLogStats, generateEnv, main } from '../../cli/controllers/ConsoleController.js';

/**
 * Читает сгенерированный файл конфигурации проекта, сверяя имя с учётом регистра.
 * На Windows/macOS ФС регистронезависима, и неверный регистр в пути проходил
 * локально, но падал в CI на Linux — проверка через readdirSync ловит это везде.
 */
function readGeneratedConfig(projectDir: string, fileName: string): string {
    const configDir = path.join(projectDir, 'src', 'config');
    expect(fs.readdirSync(configDir)).toContain(fileName);
    return fs.readFileSync(path.join(configDir, fileName), 'utf8');
}

describe('CLI stats (computeLogStats)', () => {
    const tmpDir = path.join(__dirname, '__stats_tmp__');
    const logFile = path.join(tmpDir, 'app.log');

    beforeEach(() => {
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true });
        }
        fs.mkdirSync(tmpDir, { recursive: true });
    });
    afterEach(() => {
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true });
        }
    });

    it('возвращает базовые счётчики', () => {
        fs.writeFileSync(
            logFile,
            `[2026-01-01]: Command 'start' matched for user 1
[2026-01-01]: Command 'help' matched for user 2
[2026-01-01]: ERROR something exploded
[2026-01-01]: WARN slow request
`,
        );
        const stats = computeLogStats(logFile);
        expect(stats.total).toBe(4);
        expect(stats.errors).toBe(1);
        expect(stats.warnings).toBe(1);
        expect(stats.topCommands).toEqual([
            ['start', 1],
            ['help', 1],
        ]);
    });

    it('вычисляет p50/p95/p99 из Duration строк', () => {
        const lines = Array.from({ length: 100 }, (_, i) => `Duration: ${i + 1}ms`).join('\n');
        fs.writeFileSync(logFile, lines);
        const stats = computeLogStats(logFile);
        // Math.floor(100 * 0.5) = 50 — индекс массива [0..99], там 51
        expect(stats.p50).toBe(51);
        expect(stats.p95).toBe(96);
        expect(stats.p99).toBe(100);
    });

    it('кидает ошибку при отсутствии файла', () => {
        expect(() => computeLogStats(path.join(tmpDir, 'absent.log'))).toThrow('Файл не найден');
    });

    it('корректно работает с пустым файлом', () => {
        fs.writeFileSync(logFile, '');
        const stats = computeLogStats(logFile);
        expect(stats.total).toBe(0);
        expect(stats.p50).toBeNull();
        expect(stats.topCommands).toEqual([]);
    });

    it('не перезаписывает .env без --force', () => {
        const envFile = path.join(tmpDir, '.env');
        fs.writeFileSync(envFile, 'USER_TOKEN=keep');

        expect(() => generateEnv(false, envFile)).toThrow('Укажите --force');
        expect(fs.readFileSync(envFile, 'utf8')).toBe('USER_TOKEN=keep');

        generateEnv(true, envFile);
        expect(fs.readFileSync(envFile, 'utf8')).toMatch(/^TELEGRAM_TOKEN=$/m);
    });

    it('generateEnv пишет пустые значения: заглушка VK_SECRET_KEY отклоняла бы все запросы VK', () => {
        const envFile = path.join(tmpDir, '.env');
        generateEnv(true, envFile);
        const content = fs.readFileSync(envFile, 'utf8');

        expect(content).not.toContain('your-');
        expect(content).toMatch(/^VK_SECRET_KEY=$/m);
        expect(content).toMatch(/^TELEGRAM_WEBHOOK_SECRET=$/m);
        expect(content).toMatch(/^MAX_WEBHOOK_SECRET=$/m);
        expect(content).toMatch(/^SMARTAPP_TOKEN=$/m);
    });

    it('create без isEnv создаёт .env из шаблона и не перезаписывает существующий', async () => {
        const projectDir = path.join(tmpDir, 'env-template-bot');
        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
        const createArgs = {
            command: 'create',
            appName: 'env_template_bot',
            mode: 'prod',
            hostname: '0.0.0.0',
            port: 3000,
            params: { path: projectDir },
        };

        await main(createArgs, ['node', 'umbot', 'create', 'env_template_bot']);

        const envPath = path.join(projectDir, '.env');
        expect(fs.readFileSync(envPath, 'utf8')).toMatch(/^TELEGRAM_TOKEN=$/m);
        // Конфиг проекта читает этот файл — иначе секрет `umbot webhook` не подхватится
        // Кавычки зависят от того, отформатировал ли проект prettier
        expect(readGeneratedConfig(projectDir, 'env_template_botConfig.ts')).toMatch(
            /["']?env["']?: ["']\.\/\.env["']/,
        );

        fs.writeFileSync(envPath, 'TELEGRAM_TOKEN=real-token\n');
        await main(createArgs, ['node', 'umbot', 'create', 'env_template_bot', '--force']);
        expect(fs.readFileSync(envPath, 'utf8')).toBe('TELEGRAM_TOKEN=real-token\n');

        logSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('не сохраняет токены в Params.ts при create с isEnv (утечка секретов)', async () => {
        const projectDir = path.join(tmpDir, 'leak-bot');
        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        await main(
            {
                command: 'create',
                appName: 'leak_bot',
                mode: 'prod',
                hostname: '0.0.0.0',
                port: 3000,
                params: {
                    path: projectDir,
                    isEnv: true,
                    params: {
                        welcome_text: 'Привет!',
                        alisa_token: 'SECRET-ALISA-TOKEN',
                        yandex_token: 'SECRET-YANDEX-TOKEN',
                        telegram_token: 'SECRET-TELEGRAM-TOKEN',
                        vk_token: 'SECRET-VK-TOKEN',
                    },
                    config: {
                        host: 'localhost',
                        port: 3000,
                        db: { host: 'db-host', user: 'db-user', pass: 'db-pass', database: 'db' },
                    },
                },
            },
            ['node', 'umbot', 'create', 'leak_bot'],
        );

        // Токены попадают в .env (который в .gitignore), а не в коммитящийся Params.ts
        const envContent = fs.readFileSync(path.join(projectDir, '.env'), 'utf8');
        expect(envContent).toContain('ALISA_TOKEN=SECRET-ALISA-TOKEN');
        expect(envContent).toContain('TELEGRAM_TOKEN=SECRET-TELEGRAM-TOKEN');
        expect(envContent).toContain('DB_HOST=db-host');

        const paramsContent = readGeneratedConfig(projectDir, 'leak_botParams.ts');
        expect(paramsContent).toContain('Привет!');
        expect(paramsContent).not.toContain('SECRET-ALISA-TOKEN');
        expect(paramsContent).not.toContain('SECRET-YANDEX-TOKEN');
        expect(paramsContent).not.toContain('SECRET-TELEGRAM-TOKEN');
        expect(paramsContent).not.toContain('SECRET-VK-TOKEN');

        // db-конфиг с паролем также не должен попасть в коммитящийся Config.ts
        const configContent = readGeneratedConfig(projectDir, 'leak_botConfig.ts');
        expect(configContent).not.toContain('db-pass');
        expect(configContent).toContain('./.env');

        logSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('не сохраняет config.tokens в Config.ts при create с isEnv (README-формат токенов)', async () => {
        // Вложенный формат config.tokens.{platform}.token задокументирован в README CLI.
        // Раньше он не мигрировал в .env и сериализовался литералом в коммитящийся Config.ts.
        const projectDir = path.join(tmpDir, 'tokens-leak-bot');
        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        await main(
            {
                command: 'create',
                appName: 'tokens_leak_bot',
                mode: 'prod',
                hostname: '0.0.0.0',
                port: 3000,
                params: {
                    path: projectDir,
                    isEnv: true,
                    params: {
                        welcome_text: 'Привет!',
                    },
                    config: {
                        tokens: {
                            telegram: { token: 'SECRET-TG-BY-CONFIG-TOKEN' },
                            viber: { token: 'SECRET-VIBER-BY-CONFIG-TOKEN' },
                            max_app: { token: 'SECRET-MAX-BY-CONFIG-TOKEN' },
                        },
                        db: { host: 'db-host', user: 'u', pass: 'p', database: 'db' },
                    },
                },
            },
            ['node', 'umbot', 'create', 'tokens_leak_bot'],
        );

        const envContent = fs.readFileSync(path.join(projectDir, '.env'), 'utf8');
        expect(envContent).toContain('TELEGRAM_TOKEN=SECRET-TG-BY-CONFIG-TOKEN');
        expect(envContent).toContain('VIBER_TOKEN=SECRET-VIBER-BY-CONFIG-TOKEN');
        expect(envContent).toContain('MAX_TOKEN=SECRET-MAX-BY-CONFIG-TOKEN');

        const configContent = readGeneratedConfig(projectDir, 'tokens_leak_botConfig.ts');
        expect(configContent).not.toContain('SECRET-TG-BY-CONFIG-TOKEN');
        expect(configContent).not.toContain('SECRET-VIBER-BY-CONFIG-TOKEN');
        expect(configContent).not.toContain('SECRET-MAX-BY-CONFIG-TOKEN');
        expect(configContent).not.toContain('tokens');

        logSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('не сохраняет config.tokens в Config.ts при create БЕЗ isEnv (токены вычищаются с предупреждением)', async () => {
        // Раньше миграция работала только при isEnv: без флага токены из config.tokens
        // сериализовались литералом в коммит-файл Config.ts.
        const projectDir = path.join(tmpDir, 'tokens-noenv-bot');
        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        await main(
            {
                command: 'create',
                appName: 'tokens_noenv_bot',
                mode: 'prod',
                hostname: '0.0.0.0',
                port: 3000,
                params: {
                    path: projectDir,
                    // isEnv не задан — токены из конфига в .env не переносятся
                    params: {
                        welcome_text: 'Привет!',
                    },
                    config: {
                        tokens: {
                            telegram: { token: 'SECRET-TG-NO-ENV' },
                        },
                    },
                },
            },
            ['node', 'umbot', 'create', 'tokens_noenv_bot'],
        );

        // Без isEnv секреты не мигрируют в .env, поэтому обязаны исчезнуть
        // из сериализуемой конфигурации
        const configContent = readGeneratedConfig(projectDir, 'tokens_noenv_botConfig.ts');
        expect(configContent).not.toContain('SECRET-TG-NO-ENV');
        expect(configContent).not.toContain('tokens');
        expect(fs.readFileSync(path.join(projectDir, '.env'), 'utf8')).not.toContain(
            'SECRET-TG-NO-ENV',
        );

        // Пользователь должен узнать, что токены удалены и как их задать
        const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));
        expect(
            warnCalls.find((w) => w.includes('config.tokens') || w.includes('isEnv=true')),
        ).toBeDefined();

        logSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('не сохраняет плоские *_token и db.pass в коммит-файлы при create БЕЗ isEnv', async () => {
        // Без isEnv плоские params.*_token и config.db.pass не должны попасть
        // plaintext в Params.ts/Config.ts (как и config.tokens).
        const projectDir = path.join(tmpDir, 'flat-noenv-bot');
        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        await main(
            {
                command: 'create',
                appName: 'flat_noenv_bot',
                mode: 'prod',
                hostname: '0.0.0.0',
                port: 3000,
                params: {
                    path: projectDir,
                    params: {
                        welcome_text: 'Привет!',
                        telegram_token: 'SUPERSECRET-TG-123',
                        vk_token: 'SUPERSECRET-VK-456',
                    },
                    config: {
                        db: {
                            host: 'db-host',
                            user: 'db-user',
                            pass: 'SUPERSECRET-DB',
                            database: 'db',
                        },
                    },
                },
            },
            ['node', 'umbot', 'create', 'flat_noenv_bot'],
        );

        const paramsContent = readGeneratedConfig(projectDir, 'flat_noenv_botParams.ts');
        expect(paramsContent).toContain('Привет!');
        expect(paramsContent).not.toContain('SUPERSECRET-TG-123');
        expect(paramsContent).not.toContain('SUPERSECRET-VK-456');

        const configContent = readGeneratedConfig(projectDir, 'flat_noenv_botConfig.ts');
        expect(configContent).not.toContain('SUPERSECRET-DB');
        // Несекретные параметры подключения остаются.
        expect(configContent).toContain('db-host');

        const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));
        expect(warnCalls.find((w) => w.includes('params.telegram_token'))).toBeDefined();
        expect(warnCalls.find((w) => w.includes('config.db.pass'))).toBeDefined();

        logSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('санитизирует имя env-переменной из ключа платформы config.tokens (инъекция переменной)', async () => {
        const projectDir = path.join(tmpDir, 'tokens-envname-bot');
        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        await main(
            {
                command: 'create',
                appName: 'tokens_envname_bot',
                mode: 'prod',
                hostname: '0.0.0.0',
                port: 3000,
                params: {
                    path: projectDir,
                    isEnv: true,
                    params: { welcome_text: 'Привет!' },
                    config: {
                        // Ключ с переводом строки пытается дописать произвольную
                        // переменную в .env; allowlist-санитизация имени это
                        // блокирует
                        tokens: { 'x\nEVIL_INJECTED=1': 'v' },
                    },
                },
            },
            ['node', 'umbot', 'create', 'tokens_envname_bot'],
        );

        const envContent = fs.readFileSync(path.join(projectDir, '.env'), 'utf8');
        // Имя переменной санитизировано: перевод строки вырезан, EVIL_INJECTED
        // не стало отдельной переменной
        expect(envContent).not.toMatch(/^EVIL_INJECTED=1$/m);
        expect(envContent).toContain('X_EVIL_INJECTED_1=v');

        logSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('санитизирует переводы строк в значениях .env при create (инъекция переменных)', async () => {
        const projectDir = path.join(tmpDir, 'env-inject-bot');
        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        await main(
            {
                command: 'create',
                appName: 'env_inject_bot',
                mode: 'prod',
                hostname: '0.0.0.0',
                port: 3000,
                params: {
                    path: projectDir,
                    isEnv: true,
                    params: {
                        welcome_text: 'Привет!',
                        // Значение из недоверенного JSON с попыткой дописать
                        // произвольную переменную в .env
                        telegram_token: 'x\nMALICIOUS_VAR=pwned',
                    },
                },
            },
            ['node', 'umbot', 'create', 'env_inject_bot'],
        );

        const envContent = fs.readFileSync(path.join(projectDir, '.env'), 'utf8');
        expect(envContent).toContain('TELEGRAM_TOKEN=xMALICIOUS_VAR=pwned');
        // Значение дописано в ту же строку, отдельной переменной не стало
        expect(envContent).not.toContain('\nMALICIOUS_VAR=');

        logSpy.mockRestore();
        warnSpy.mockRestore();
    });

    it('возвращает ненулевой код при ошибке from-flow', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation();
        const originalExitCode = process.exitCode;
        process.exitCode = undefined;

        await main(
            { command: 'create', appName: null, mode: 'prod', hostname: '0.0.0.0', port: 3000 },
            ['node', 'umbot', 'create', 'from-flow', path.join(tmpDir, 'missing-flow.json')],
        );

        expect(process.exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalled();
        process.exitCode = originalExitCode;
        errorSpy.mockRestore();
    });

    it('принимает flow.json после флагов в create from-flow', async () => {
        const flowPath = path.join(tmpDir, 'flow.json');
        fs.writeFileSync(
            flowPath,
            JSON.stringify({
                name: 'flag-order',
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
            }),
        );
        const outputDir = path.join(tmpDir, 'flag-order-bot');
        const logSpy = jest.spyOn(console, 'log').mockImplementation();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
        const errorSpy = jest.spyOn(console, 'error').mockImplementation();
        const originalExitCode = process.exitCode;
        process.exitCode = undefined;

        await main(
            { command: 'create', appName: null, mode: 'prod', hostname: '0.0.0.0', port: 3000 },
            ['node', 'umbot', 'create', 'from-flow', '--output', outputDir, flowPath],
        );

        expect(fs.existsSync(path.join(outputDir, 'src', 'index.ts'))).toBe(true);
        expect(process.exitCode).not.toBe(1);
        process.exitCode = originalExitCode;
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });
});

describe('CLI umbot.js: разбор аргументов', () => {
    const tmpDir = path.join(__dirname, '__umbot_entry_tmp__');
    const cliPath = path.join(__dirname, '..', '..', 'cli', 'umbot.js');

    beforeEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.mkdirSync(tmpDir, { recursive: true });
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('validate сам сообщает об ошибках flow.json, а не как create об «имени проекта»', () => {
        const flowPath = path.join(tmpDir, 'flow.json');
        fs.writeFileSync(flowPath, JSON.stringify({ nodes: [{ type: 'command' }] }));
        const result = spawnSync(process.execPath, [cliPath, 'validate', flowPath], {
            encoding: 'utf8',
        });
        expect(result.status).toBe(1);
        expect(result.stderr).not.toContain('Проект не создан');
        expect(result.stderr).toContain('`name`');
        expect(result.stderr).toContain('`id`');
    });

    it('validate показывает ошибку разбора битого JSON', () => {
        const flowPath = path.join(tmpDir, 'broken.json');
        fs.writeFileSync(flowPath, '{ "name": ');
        const result = spawnSync(process.execPath, [cliPath, 'validate', flowPath], {
            encoding: 'utf8',
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Найдены ошибки');
        expect(result.stderr).toContain('Не удалось прочитать');
    });
});
