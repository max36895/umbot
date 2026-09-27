import * as fs from 'fs';
import * as path from 'path';
import { expectProjectToTypeCheck } from '../helpers/typecheck';

const CreateController = require('../../cli/controllers/CreateController.js').create;

const TEST_DIR = path.join(__dirname, '__create_output__');

beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true });
    }
});

describe('CreateController', () => {
    describe('init()', () => {
        it('создаёт структуру папок с именем проекта', async () => {
            const ctrl = new CreateController();
            ctrl.params = { path: path.join(TEST_DIR, 'full') };
            await ctrl.init('test_bot', CreateController.T_DEFAULT);

            const projectDir = path.join(TEST_DIR, 'full');
            expect(fs.existsSync(path.join(projectDir, 'src', 'index.ts'))).toBe(true);
            expect(fs.existsSync(path.join(projectDir, 'src', 'config', 'test_botConfig.ts'))).toBe(
                true,
            );
            expect(fs.existsSync(path.join(projectDir, 'src', 'config', 'test_botParams.ts'))).toBe(
                true,
            );
            expect(
                fs.existsSync(path.join(projectDir, 'src', 'controller', 'Test_botController.ts')),
            ).toBe(true);
            expect(fs.existsSync(path.join(projectDir, 'package.json'))).toBe(true);
            expect(fs.existsSync(path.join(projectDir, 'tsconfig.json'))).toBe(true);
            expect(fs.existsSync(path.join(projectDir, '.gitignore'))).toBe(true);
            // Пустой .gitignore отправил бы .env с токенами и json/ с данными в git.
            const gitignore = fs.readFileSync(path.join(projectDir, '.gitignore'), 'utf8');
            expect(gitignore).toContain('.env');
            expect(gitignore).toContain('/json/*');
        });

        it('создаёт проект по вложенному пути', async () => {
            const ctrl = new CreateController();
            ctrl.params = { path: path.join(TEST_DIR, 'nested', 'deep', 'project') };
            await ctrl.init('test-bot', CreateController.T_DEFAULT);

            const projectDir = path.join(TEST_DIR, 'nested', 'deep', 'project');
            expect(fs.existsSync(path.join(projectDir, 'src', 'index.ts'))).toBe(true);
            expect(fs.existsSync(path.join(projectDir, 'package.json'))).toBe(true);
        });

        it('имя проекта, начинающееся с цифры, получает префикс "_"', async () => {
            // '2025bot' без префикса давало import { 2025botController } —
            // сгенерированный проект не собирался компилятором TypeScript
            const ctrl = new CreateController();
            ctrl.params = { path: path.join(TEST_DIR, 'digit') };
            await ctrl.init('2025bot', CreateController.T_DEFAULT);

            const projectDir = path.join(TEST_DIR, 'digit');
            expect(fs.existsSync(path.join(projectDir, 'src', 'config', '_2025botConfig.ts'))).toBe(
                true,
            );
            expect(
                fs.existsSync(path.join(projectDir, 'src', 'controller', '_2025botController.ts')),
            ).toBe(true);
            const indexContent = fs.readFileSync(path.join(projectDir, 'src', 'index.ts'), 'utf8');
            expect(indexContent).toContain('_2025botConfig');
            // Идентификатор начинается с '_': голого '2025bot' в коде быть не должно
            expect(indexContent).not.toMatch(/[^_\d\w]2025bot/);
        });

        it('выводит ошибку при пустом имени проекта', () => {
            const ctrl = new CreateController();
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
            ctrl.init(null, CreateController.T_DEFAULT);
            expect(consoleSpy).toHaveBeenCalledWith('Не указано имя проекта');
            consoleSpy.mockRestore();
        });

        it('выводит ошибку при undefined имени', () => {
            const ctrl = new CreateController();
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
            ctrl.init(undefined, CreateController.T_DEFAULT);
            expect(consoleSpy).toHaveBeenCalledWith('Не указано имя проекта');
            consoleSpy.mockRestore();
        });

        it('создаёт QuizController при type=Quiz', async () => {
            const ctrl = new CreateController();
            ctrl.params = { path: path.join(TEST_DIR, 'quiz') };
            await ctrl.init('quiz-test', CreateController.T_QUIZ);

            const controllerDir = path.join(TEST_DIR, 'quiz', 'src', 'controller');
            expect(fs.existsSync(controllerDir)).toBe(true);
            const files = fs.readdirSync(controllerDir);
            const quizFile = files.find((f) => f.includes('Quiz'));
            expect(quizFile).toBeTruthy();
        });

        it('шаблон quizParams содержит интенты welcome и help', () => {
            // Массив intents в setPlatformParams полностью заменяет встроенные
            // welcome/help. Раньше в quizParams был только replay, из-за чего
            // приветствие QuizController было недостижимо, а «помощь» уходила
            // в fallback.
            const quizParams = require('../../cli/template/config/quizParams.js').params as {
                intents: Array<{ name: string; slots: string[] }>;
            };
            const names = quizParams.intents.map((intent) => intent.name);
            expect(names).toEqual(expect.arrayContaining(['welcome', 'help', 'replay']));
            const welcome = quizParams.intents.find((intent) => intent.name === 'welcome');
            expect(welcome?.slots.length).toBeGreaterThan(0);
        });

        it('с --minimal не создаёт controller папку для default типа', async () => {
            const ctrl = new CreateController();
            ctrl.params = { path: path.join(TEST_DIR, 'minimal') };
            ctrl.flags = ['--minimal'];
            await ctrl.init('minimal-test', CreateController.T_DEFAULT);

            const controllerDir = path.join(TEST_DIR, 'minimal', 'src', 'controller');
            expect(fs.existsSync(controllerDir)).toBe(false);
            expect(fs.existsSync(path.join(TEST_DIR, 'minimal', 'src', 'index.ts'))).toBe(true);
        });

        it('с --minimal и Quiz типом всё равно создаёт controller', async () => {
            const ctrl = new CreateController();
            ctrl.params = { path: path.join(TEST_DIR, 'minimal-quiz') };
            ctrl.flags = ['--minimal'];
            await ctrl.init('minimal-quiz', CreateController.T_QUIZ);

            const controllerDir = path.join(TEST_DIR, 'minimal-quiz', 'src', 'controller');
            expect(fs.existsSync(controllerDir)).toBe(true);
        });

        it('с --prod создаёт Dockerfile, .dockerignore и deploy.yml', async () => {
            const ctrl = new CreateController();
            ctrl.params = { path: path.join(TEST_DIR, 'prod') };
            ctrl.flags = ['--prod'];
            await ctrl.init('prod-test', CreateController.T_DEFAULT);

            const projectDir = path.join(TEST_DIR, 'prod');
            expect(fs.existsSync(path.join(projectDir, 'Dockerfile'))).toBe(true);
            expect(fs.existsSync(path.join(projectDir, '.dockerignore'))).toBe(true);
            expect(fs.existsSync(path.join(projectDir, '.github', 'workflows', 'deploy.yml'))).toBe(
                true,
            );

            // .dockerignore должен исключать секреты и артефакты из образа
            const dockerIgnore = fs.readFileSync(path.join(projectDir, '.dockerignore'), 'utf8');
            expect(dockerIgnore).toContain('.env');
            expect(dockerIgnore).toContain('node_modules/');

            // Процесс работает от непривилегированного umbot, а /app принадлежит root:
            // каталоги данных и логов должны создаваться и отдаваться ему до USER.
            const dockerfile = fs.readFileSync(path.join(projectDir, 'Dockerfile'), 'utf8');
            const prepareDirs = dockerfile.indexOf(
                'RUN mkdir -p /app/json /app/logs && chown umbot:nodejs /app/json /app/logs',
            );
            expect(prepareDirs).toBeGreaterThan(-1);
            expect(prepareDirs).toBeLessThan(dockerfile.indexOf('USER umbot'));
            // Runtime-стадия — продакшен: umbot без setAppMode() работает в strict_prod.
            expect(dockerfile).toContain('ENV NODE_ENV=production');

            // deploy.yml не должен передавать секреты флагами -e (видны в ps),
            // а использовать --env-file; имя образа подставляется из имени проекта
            // (init() заменяет не-буквенно-цифровые символы на '_', поэтому prod_test)
            const deploy = fs.readFileSync(
                path.join(projectDir, '.github', 'workflows', 'deploy.yml'),
                'utf8',
            );
            expect(deploy).toContain('--env-file');
            expect(deploy).not.toContain('-e TELEGRAM_TOKEN=');
            expect(deploy).toContain('prod_test');
            expect(deploy).not.toContain('{{imageName}}');
        });
    });

    describe('_replace()', () => {
        it('заменяет строку в строке', () => {
            const ctrl = new CreateController();
            const result = ctrl._replace('{{name}}', 'test', 'Hello {{name}}!');
            expect(result).toBe('Hello test!');
        });

        it('заменяет массив строк', () => {
            const ctrl = new CreateController();
            const result = ctrl._replace(['{{a}}', '{{b}}'], ['x', 'y'], '{{a}} and {{b}}');
            expect(result).toBe('x and y');
        });

        it('использует последний элемент при нехватке значений', () => {
            const ctrl = new CreateController();
            const result = ctrl._replace(['{{a}}', '{{b}}', '{{c}}'], ['x'], '{{a}}, {{b}}, {{c}}');
            expect(result).toBe('x, x, x');
        });
    });

    describe('_initConfig() и _initParams()', () => {
        it('генерирует конфиг с IAppConfig импортом', () => {
            const ctrl = new CreateController();
            const result = ctrl._initConfig({ host: 'localhost', port: 3000 });
            expect(result).toContain("import { IAppConfig } from 'umbot'");
            expect(result).toContain('localhost');
            expect(result).toContain('3000');
        });

        it('конфиг всегда читает .env — и без isEnv (туда пишет секрет `umbot webhook`)', () => {
            const ctrl = new CreateController();
            expect(ctrl._initConfig({ host: 'localhost' })).toContain('"env": "./.env"');
            ctrl.params = { isEnv: true };
            expect(ctrl._initConfig({ host: 'localhost' })).toContain('"env": "./.env"');
        });

        it('генерирует params с IAppParam импортом', () => {
            const ctrl = new CreateController();
            const result = ctrl._initParams({ welcome_text: 'Привет!' });
            expect(result).toContain("import { IAppParam } from 'umbot'");
            expect(result).toContain('Привет!');
        });

        it('мержит params с переданными значениями', () => {
            const ctrl = new CreateController();
            ctrl.params = { params: { welcome_text: 'Здравствуйте!' } };
            const result = ctrl._initParams({ welcome_text: 'Привет!', help_text: 'Помощь' });
            expect(result).toContain('Здравствуйте!');
            expect(result).toContain('Помощь');
        });
    });

    describe('безопасность при перезаписи (--force)', () => {
        it('с --force перезаписывает непустую директорию', async () => {
            const existingDir = path.join(TEST_DIR, 'existing-force');
            fs.mkdirSync(existingDir, { recursive: true });
            fs.writeFileSync(path.join(existingDir, 'old-file.txt'), 'old');

            const ctrl = new CreateController();
            ctrl.params = { path: existingDir };
            ctrl.flags = ['--force'];
            await ctrl.init('existing-force', CreateController.T_DEFAULT);

            expect(fs.existsSync(path.join(existingDir, 'old-file.txt'))).toBe(true);
            expect(fs.existsSync(path.join(existingDir, 'src', 'index.ts'))).toBe(true);
        });
    });

    describe('mode выбор шаблона index', () => {
        it('mode=dev создаёт index с BotTest', async () => {
            const ctrl = new CreateController();
            ctrl.params = { path: path.join(TEST_DIR, 'dev'), mode: 'dev' };
            await ctrl.init('dev-mode', CreateController.T_DEFAULT);

            const indexPath = path.join(TEST_DIR, 'dev', 'src', 'index.ts');
            const content = fs.readFileSync(indexPath, 'utf8');
            expect(content).toContain('BotTest');
        });

        it('mode=build создаёт index с run()', async () => {
            const ctrl = new CreateController();
            ctrl.params = { path: path.join(TEST_DIR, 'build'), mode: 'build' };
            await ctrl.init('build-mode', CreateController.T_DEFAULT);

            const indexPath = path.join(TEST_DIR, 'build', 'src', 'index.ts');
            const content = fs.readFileSync(indexPath, 'utf8');
            expect(content).toContain('run');
        });

        it('--minimal + mode=dev создаёт минимальный dev-шаблон', async () => {
            const ctrl = new CreateController();
            ctrl.params = { path: path.join(TEST_DIR, 'dev-min'), mode: 'dev' };
            ctrl.flags = ['--minimal'];
            await ctrl.init('dev-min', CreateController.T_DEFAULT);

            // Минимальный шаблон не создаёт отдельный файл контроллера
            const controllerDir = path.join(TEST_DIR, 'dev-min', 'src', 'controller');
            expect(fs.existsSync(controllerDir)).toBe(false);

            const indexPath = path.join(TEST_DIR, 'dev-min', 'src', 'index.ts');
            const content = fs.readFileSync(indexPath, 'utf8');
            expect(content).toContain('BotTest');
        });
    });

    describe('генерация и безопасность артефактов', () => {
        it('требует --force для непустой директории', async () => {
            const projectDir = path.join(TEST_DIR, 'existing');
            fs.mkdirSync(projectDir, { recursive: true });
            fs.writeFileSync(path.join(projectDir, 'user-file.txt'), 'keep');

            const ctrl = new CreateController();
            ctrl.params = { path: projectDir };

            await expect(ctrl.init('existing', CreateController.T_DEFAULT)).rejects.toThrow(
                '--force',
            );
            expect(fs.readFileSync(path.join(projectDir, 'user-file.txt'), 'utf8')).toBe('keep');
        });

        it('не заменяет Dockerfile и workflow без --force', () => {
            const projectDir = path.join(TEST_DIR, 'existing-assets');
            const workflowDir = path.join(projectDir, '.github', 'workflows');
            fs.mkdirSync(workflowDir, { recursive: true });
            fs.writeFileSync(path.join(projectDir, 'Dockerfile'), 'user dockerfile');
            fs.writeFileSync(path.join(workflowDir, 'deploy.yml'), 'user workflow');

            const ctrl = new CreateController();

            expect(() => ctrl.createDockerFile(projectDir)).toThrow('Укажите --force');
            expect(() => ctrl.createDeployFile(projectDir)).toThrow('Укажите --force');
        });

        it('собирает сгенерированные варианты шаблонов', async () => {
            const variants = [
                {
                    name: 'default',
                    mode: undefined,
                    minimal: false,
                    type: CreateController.T_DEFAULT,
                },
                {
                    name: 'minimal',
                    mode: undefined,
                    minimal: true,
                    type: CreateController.T_DEFAULT,
                },
                { name: 'dev', mode: 'dev', minimal: false, type: CreateController.T_DEFAULT },
                {
                    name: 'dev-online',
                    mode: 'dev-online',
                    minimal: false,
                    type: CreateController.T_DEFAULT,
                },
                { name: 'build', mode: 'build', minimal: false, type: CreateController.T_DEFAULT },
                { name: 'quiz', mode: undefined, minimal: false, type: CreateController.T_QUIZ },
            ];

            for (const variant of variants) {
                const projectDir = path.join(TEST_DIR, `compile-${variant.name}`);
                const ctrl = new CreateController();
                ctrl.params = { path: projectDir, mode: variant.mode };
                ctrl.flags = variant.minimal ? ['--minimal'] : [];
                await ctrl.init(`compile-${variant.name}`, variant.type);

                expectProjectToTypeCheck(projectDir);
            }
        });

        it('escapes hostname and ignores an invalid port before writing TypeScript', async () => {
            const projectDir = path.join(TEST_DIR, 'safe-network-params');
            const ctrl = new CreateController();
            ctrl.params = {
                path: projectDir,
                hostname: 'api".example.test',
                port: '3000; invalid',
            };

            await ctrl.init('safe-network-params', CreateController.T_DEFAULT);

            const index = fs.readFileSync(path.join(projectDir, 'src', 'index.ts'), 'utf8');
            expect(index).toContain('bot.start("api\\".example.test", 3000);');
            expectProjectToTypeCheck(projectDir);
        });

        it('использует выбранный порт и Node.js 24 во всех production-артефактах', async () => {
            const projectDir = path.join(TEST_DIR, 'production-port');
            const ctrl = new CreateController();
            ctrl.params = { path: projectDir, port: 8080 };
            ctrl.flags = ['--prod'];

            await ctrl.init('production-port', CreateController.T_DEFAULT);

            const dockerFile = fs.readFileSync(path.join(projectDir, 'Dockerfile'), 'utf8');
            const workflow = fs.readFileSync(
                path.join(projectDir, '.github', 'workflows', 'deploy.yml'),
                'utf8',
            );
            expect(dockerFile).toContain('FROM node:24-alpine');
            expect(dockerFile).toContain('EXPOSE 8080');
            expect(workflow).toContain("node-version: '24'");
            expect(workflow).toContain('-p 8080:8080');
            expect(workflow).toContain('npm install');
        });
    });

    describe('format()', () => {
        it('форматирует проект без предупреждений, когда prettier установлен', async () => {
            const projectDir = path.join(TEST_DIR, 'formatted');
            const ctrl = new CreateController();
            ctrl.params = { path: projectDir };
            await ctrl.init('format-test', CreateController.T_DEFAULT);

            const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
            ctrl.format();
            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('молча пропускает форматирование, если prettier не установлен', async () => {
            const projectDir = path.join(TEST_DIR, 'no-prettier');
            const ctrl = new CreateController();
            ctrl.params = { path: projectDir };
            await ctrl.init('no-prettier', CreateController.T_DEFAULT);

            ctrl._resolvePrettier = (): null => null;
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
            ctrl.format();
            expect(warnSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('предупреждает, если prettier завершился с ошибкой', async () => {
            const projectDir = path.join(TEST_DIR, 'bad-prettier');
            const ctrl = new CreateController();
            ctrl.params = { path: projectDir };
            await ctrl.init('bad-prettier', CreateController.T_DEFAULT);

            const fakeBin = path.join(TEST_DIR, 'fake-prettier.js');
            fs.writeFileSync(fakeBin, "throw new Error('broken formatter');");
            ctrl._resolvePrettier = (): string => fakeBin;
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
            ctrl.format();
            expect(warnSpy).toHaveBeenCalledWith('Не удалось отформатировать код');
            warnSpy.mockRestore();
        });
    });
});
