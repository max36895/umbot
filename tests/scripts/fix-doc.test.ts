import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/fix-doc.js');
const TEST_DIR = path.join(__dirname, '__test_output__');

/**
 * Запускает fix-doc.js в изолированной папке-фикстуре.
 * @param cwd Директория, из которой запускается скрипт
 * @returns Код завершения и вывод скрипта
 */
function runFixDoc(cwd: string): { status: number; output: string } {
    try {
        const output = execFileSync(process.execPath, [SCRIPT_PATH], {
            cwd,
            encoding: 'utf8',
        });
        return { status: 0, output };
    } catch (error) {
        const err = error as { status?: number; stdout?: string; stderr?: string };
        return {
            status: err.status ?? 1,
            output: `${err.stdout ?? ''}${err.stderr ?? ''}`,
        };
    }
}

/**
 * Создаёт фикстуру: package.json с версией и markdown-файлы.
 * @param files Карта относительных путей файлов и их содержимого
 */
function createFixture(files: Record<string, string>): void {
    fs.writeFileSync(
        path.join(TEST_DIR, 'package.json'),
        JSON.stringify({ name: 'fixture', version: '3.1.0' }, null, 2),
    );
    for (const [relativePath, content] of Object.entries(files)) {
        const fullPath = path.join(TEST_DIR, relativePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf8');
    }
}

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

describe('scripts/fix-doc.js', () => {
    it('не помечает битой ссылку на существующий файл с #якорем', () => {
        createFixture({
            'guide.md': '# Guide\n\nСм. [раздел](./sub/page.md#якорь)\n',
            'sub/page.md': '# Page\n',
        });

        const { status, output } = runFixDoc(TEST_DIR);

        expect(status).toBe(0);
        expect(output).toContain('Все ссылки корректны');
    });

    it('сохраняет #якорь при переписывании ссылки на URL', () => {
        createFixture({
            'guide.md': '# Guide\n\nСм. [раздел](./sub/page.md#якорь)\n',
            'sub/page.md': '# Page\n',
        });

        runFixDoc(TEST_DIR);

        const content = fs.readFileSync(path.join(TEST_DIR, 'guide.md'), 'utf8');
        expect(content).toContain('https://www.maxim-m.ru/docs/umbot/v-3.1/guides/sub/page#якорь');
    });

    it('продолжает находить реально битую ссылку с #якорем', () => {
        createFixture({
            'guide.md': '# Guide\n\nСм. [раздел](./sub/missing.md#якорь)\n',
        });

        const { status, output } = runFixDoc(TEST_DIR);

        expect(status).toBe(1);
        expect(output).toContain('./sub/missing.md#якорь');
    });

    it('обрабатывает ссылку на существующий файл без якоря', () => {
        createFixture({
            'guide.md': 'См. [раздел](./sub/page.md)\n',
            'sub/page.md': '# Page\n',
        });

        const { status } = runFixDoc(TEST_DIR);

        expect(status).toBe(0);
        const content = fs.readFileSync(path.join(TEST_DIR, 'guide.md'), 'utf8');
        expect(content).toContain('https://www.maxim-m.ru/docs/umbot/v-3.1/guides/sub/page)');
        expect(content).not.toContain('#');
    });

    it('не помечает битой голую .md-ссылку из той же директории', () => {
        // Регресс: 'platform-integration.md' из src/docs/GUIDE.md резолвился
        // от корня репозитория и живая ссылка падала с exit 1.
        createFixture({
            'src/docs/GUIDE.md':
                '# Guide\n\nСм. [гайд](configuration.md#раздел) и [другой](api-reference.md)\n',
            'src/docs/configuration.md': '# Конфигурация\n',
            'src/docs/api-reference.md': '# API\n',
        });

        const { status, output } = runFixDoc(TEST_DIR);

        expect(status).toBe(0);
        expect(output).toContain('Все ссылки корректны');
        const content = fs.readFileSync(path.join(TEST_DIR, 'src/docs/GUIDE.md'), 'utf8');
        expect(content).toContain('/docs/umbot/v-3.1/guides/configuration#раздел');
        expect(content).toContain('/docs/umbot/v-3.1/guides/api-reference)');
    });

    it('перезапускается идемпотентно: второй прогон ничего не меняет', () => {
        createFixture({
            'src/docs/GUIDE.md': '# Guide\n\nСм. [гайд](configuration.md)\n',
            'src/docs/configuration.md': '# Конфигурация\n',
        });

        runFixDoc(TEST_DIR);
        const afterFirst = fs.readFileSync(path.join(TEST_DIR, 'src/docs/GUIDE.md'), 'utf8');

        const { status } = runFixDoc(TEST_DIR);
        const afterSecond = fs.readFileSync(path.join(TEST_DIR, 'src/docs/GUIDE.md'), 'utf8');

        expect(status).toBe(0);
        expect(afterFirst).toEqual(afterSecond);
    });

    it('не захватывает бэктик после URL', () => {
        // Регресс: жадный URL-регекс захватывал бэктик после .html —
        // валидная ссылка в markdown-обрамлении помечалась битой.
        createFixture({
            'report.md':
                '# Отчёт\n\nСсылка в бэктиках: `https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_FAQ.html`\n',
            'src/docs/FAQ.md': '# FAQ\n',
        });

        const { status } = runFixDoc(TEST_DIR);

        expect(status).toBe(0);
        const content = fs.readFileSync(path.join(TEST_DIR, 'report.md'), 'utf8');
        expect(content).toContain('`https://www.maxim-m.ru/docs/umbot/v-3.1/guides/FAQ`');
    });

    it('переводит ссылки прежнего формата на короткие адреса, сохраняя якорь', () => {
        createFixture({
            'README.md':
                '[гайд](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.0_.src_docs_adapter_readme.html#типы)\n' +
                '[cli](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.cli_README.html)\n',
            'src/docs/adapter/readme.md': '# Адаптеры\n',
            'cli/README.md': '# CLI\n',
        });

        const { status } = runFixDoc(TEST_DIR);

        expect(status).toBe(0);
        const content = fs.readFileSync(path.join(TEST_DIR, 'README.md'), 'utf8');
        expect(content).toBe(
            '[гайд](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/adapter/readme#типы)\n' +
                '[cli](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/cli/README)\n',
        );
    });

    it('проверяет короткие адреса и помечает битым адрес несуществующего гайда', () => {
        createFixture({
            'README.md':
                'См. https://www.maxim-m.ru/docs/umbot/v-3.1/guides/FAQ. И ещё ' +
                'https://www.maxim-m.ru/docs/umbot/v-3.1/guides/missing\n',
            'src/docs/FAQ.md': '# FAQ\n',
        });

        const { status, output } = runFixDoc(TEST_DIR);

        expect(status).toBe(1);
        expect(output).toContain('https://www.maxim-m.ru/docs/umbot/v-3.1/guides/missing');
        expect(output).not.toContain('guides/FAQ.');
        const content = fs.readFileSync(path.join(TEST_DIR, 'README.md'), 'utf8');
        // Точка в конце предложения осталась на месте, а не ушла в URL.
        expect(content).toContain('v-3.1/guides/FAQ. И ещё');
    });

    it('заменяет путь в кавычках целиком, не задевая кавычки', () => {
        // Регресс: замена начиналась с открывающей кавычки — кавычка пропадала,
        // а последняя буква пути оставалась хвостом («…README.htmld»).
        createFixture({
            'guide.md': "Файл 'cli/README.md' — справка по CLI.\n",
            'cli/README.md': '# CLI\n',
        });

        runFixDoc(TEST_DIR);

        const content = fs.readFileSync(path.join(TEST_DIR, 'guide.md'), 'utf8');
        expect(content).toBe(
            "Файл 'https://www.maxim-m.ru/docs/umbot/v-3.1/guides/cli/README' — справка по CLI.\n",
        );
    });

    it('не трогает пути .md в конфигах typedoc и tsconfig', () => {
        const config = '{ "projectDocuments": ["cli/README.md"] }\n';
        createFixture({
            'server/typedocBranchLocal.json': config,
            'cli/README.md': '# CLI\n',
        });

        runFixDoc(TEST_DIR);

        const content = fs.readFileSync(
            path.join(TEST_DIR, 'server/typedocBranchLocal.json'),
            'utf8',
        );
        expect(content).toBe(config);
    });
});
