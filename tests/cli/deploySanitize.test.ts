/**
 * Тесты санитизации значений .env в генерируемом scripts/deploy.js (useCloud).
 *
 * Значения .env попадают в аргументы spawnSync с shell:true (Windows): cmd.exe
 * склеивает команду без экранирования, поэтому спецсимволы (&, |, ^, %, ", CRLF)
 * из значения токена исполнялись бы оболочкой или дописывали бы переменные .env.
 *
 * Правила живут в генерируемой строке deploy.js и недоступны для импорта.
 * Тест фиксирует их двумя слоями:
 *  1. контракт-зеркало — точная копия правил, синхронизированная маркерами
 *     (при рассинхронизации тест падает и требует перенести правку в генератор);
 *  2. проверка генерата — сами определения и их вызовы присутствуют в
 *     сгенерированном deploy.js дословно.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { generateFromFlow } from '../../cli/flowGenerator';

// Своя директория вывода (не общая с flowGenerator.test.ts): jest запускает
// сьюты параллельно, и rmSync общей папки в beforeEach ронял соседний сьют.
const TEST_DIR = path.join(__dirname, '__test_output__deploySanitize__');
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

function generateDeployScript(envValue: string): string {
    const jsonPath = path.join(JSON_DIR, 'sanitize.json');
    const outputPath = path.join(TEST_DIR, 'sanitize');
    fs.writeFileSync(
        jsonPath,
        JSON.stringify({
            name: 'sanitize-probe',
            nodes: [],
            edges: [],
            tokens: { telegram: envValue },
            database: { type: 'none' },
        }),
    );
    generateFromFlow(jsonPath, outputPath, { useCloud: true });
    return fs.readFileSync(path.join(outputPath, 'scripts', 'deploy.js'), 'utf8');
}

// ─── Контракт-зеркало правил из cli/flowGenerator.js (generateDeployScript) ───
const sanitizeEnvValue = (value: unknown): string =>
    String(value)
        .replace(/[\r\n\0]/g, '')
        // eslint-disable-next-line no-control-regex -- управляющие символы вычищаются намеренно (зеркало продакшн-правила)
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/"/g, '')
        .replace(/%/g, '');
const quoteArg = (arg: unknown): string => '"' + String(arg).replace(/"/g, '') + '"';

describe('deploy.js: санитизация значений .env для spawnSync shell:true', () => {
    describe('правила (контракт-зеркало)', () => {
        it('вырезает переводы строк — новые переменные .env невозможны', () => {
            const sanitized = sanitizeEnvValue('secret\r\nEVIL_INJECTED=1');
            // Гарантия: без CRLF значение не может разделиться на несколько
            // записей .env и не может перенести команду на новую строку cmd.
            // Текст «EVIL_INJECTED» остаётся литералом внутри значения —
            // для парсера .env и cmd это часть TELEGRAM_TOKEN=..., не переменная.
            expect(sanitized).not.toContain('\r');
            expect(sanitized).not.toContain('\n');
            expect(sanitized).not.toContain('\0');
        });

        it('вырезает кавычки — выйти из квотинга аргумента cmd нельзя', () => {
            const sanitized = sanitizeEnvValue('a" & whoami');
            expect(sanitized).not.toContain('"');
            // Амперсанд остаётся, но аргумент уходит в двойные кавычки
            // (quoteArg), внутри которых & литерален для cmd.
            expect(sanitized).toBe('a & whoami');
        });

        it('вырезает % — раскрытие %PATH% в аргументах невозможно', () => {
            // В режиме командной строки (cmd /c, без batch-файла) удвоение %%
            // НЕ даёт литеральный % — это семантика batch-файлов (замерено на
            // Node 24/win10: %%PATH% раскрывается в значение PATH). Единственная
            // надёжная защита от уноса переменных окружения машины в аргументы
            // деплоя — вырезать %; затронутые переменные помечаются warn'ом.
            expect(sanitizeEnvValue('100%PATH%')).toBe('100PATH');
            expect(sanitizeEnvValue('50%')).toBe('50');
        });

        it('вырезает управляющие символы', () => {
            expect(sanitizeEnvValue('to\x00ken\x1f')).toBe('token');
        });

        it('quoteArg оборачивает аргумент в кавычки и вырезает внутренние', () => {
            expect(quoteArg('--environment')).toBe('"--environment"');
            // Все кавычки значения вырезаются: внутри двойного квотинга cmd
            // вырваться нельзя, хвостовых пустых кавычек не остаётся.
            expect(quoteArg('TELEGRAM_TOKEN=a "b"')).toBe('"TELEGRAM_TOKEN=a b"');
        });
    });

    describe('генерат содержит правила дословно', () => {
        // Генерация ленивая: describe-блоки исполняются на фазе сбора,
        // когда beforeEach ещё не создал директории.
        let deployScript = '';
        beforeEach(() => {
            deployScript = generateDeployScript('plain-token');
        });

        it('определения sanitizeEnvValue/quoteArg/useShell присутствуют', () => {
            expect(deployScript).toContain('const sanitizeEnvValue = (value) =>');
            expect(deployScript).toContain("const useShell = process.platform === 'win32'");
            expect(deployScript).toContain("spawnSync(['yc', ...args.map(quoteArg)].join(' ')");
        });

        it('зеркало синхронно с генератом: цепочка replace совпадает дословно', () => {
            // Ключевая цепочка правил генерата — единственный источник для зеркала.
            // При изменении генератора тест падает здесь: перенеси правку
            // и в контракт-зеркало выше.
            //
            // Регресс: раньше генерат содержал литеральные CR/LF внутри регулярки
            // (template literal превращал одинарный обратный слеш в перевод строки),
            // и deploy.js падал с SyntaxError. Теперь в генерате — escape-последовательности.
            const chain = [
                'const sanitizeEnvValue = (value) => String(value)',
                String.raw`.replace(/[\r\n\0]/g, '')`,
                String.raw`.replace(/[\u0000-\u001f\u007f]/g, '')`,
                `.replace(/"/g, '')`,
                `.replace(/%/g, '');`,
            ].join('\n    ');
            expect(deployScript).toContain(chain);
        });
    });
});

describe('deploy.js: разбор .env как у фреймворка', () => {
    // Регресс: deploy.js не отрезал инлайн-комментарий « #» и не снимал кавычки,
    // в отличие от loadEnvFile фреймворка: TELEGRAM_TOKEN=abc # prod локально
    // давал abc, а в облако уходил как «abc # prod».
    // Скрипт исполняется по-настоящему, вместо yc — заглушка, пишущая аргументы в файл.
    it('передаёт в --environment значения без комментариев и кавычек', () => {
        const deployScript = generateDeployScript('placeholder');
        const projectDir = path.join(TEST_DIR, 'sanitize');
        fs.mkdirSync(path.join(projectDir, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'dist', 'index.js'), '');
        fs.writeFileSync(
            path.join(projectDir, '.env'),
            [
                'TELEGRAM_TOKEN=abc # prod',
                "VK_TOKEN='quoted value'",
                'DB_PASSWORD=pass#word',
                'EMPTY_VALUE=',
            ].join('\n'),
        );
        expect(deployScript).toContain('const parseEnvValue');

        const binDir = path.join(TEST_DIR, 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        const argsFile = path.join(TEST_DIR, 'yc-args.json');
        fs.writeFileSync(
            path.join(binDir, 'yc.js'),
            `require('fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));`,
        );
        fs.writeFileSync(path.join(binDir, 'yc.cmd'), '@node "%~dp0yc.js" %*\r\n');
        fs.writeFileSync(
            path.join(binDir, 'yc'),
            '#!/bin/sh\nnode "$(dirname "$0")/yc.js" "$@"\n',
            {
                mode: 0o755,
            },
        );

        const result = spawnSync(
            process.execPath,
            [path.join(projectDir, 'scripts', 'deploy.js')],
            {
                env: {
                    ...process.env,
                    PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
                },
                encoding: 'utf8',
            },
        );
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);

        const args = JSON.parse(fs.readFileSync(argsFile, 'utf8')) as string[];
        const environment = args[args.indexOf('--environment') + 1];
        const pairs = environment.split(',');
        expect(pairs).toContain('TELEGRAM_TOKEN=abc');
        expect(pairs).toContain('VK_TOKEN=quoted value');
        // Решётка без пробела перед ней — часть значения (как в loadEnvFile)
        expect(pairs).toContain('DB_PASSWORD=pass#word');
        expect(pairs.some((pair) => pair.startsWith('EMPTY_VALUE'))).toBe(false);
    });
});
