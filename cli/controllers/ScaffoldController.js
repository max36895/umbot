'use strict';
const path = require('node:path');
const fs = require('node:fs');

const TEMPLATE_DIR = path.join(__dirname, '..', 'template', 'scaffold');

/** Имена встроенных платформ: свой адаптер с таким platformName заменит встроенный. */
const BUILT_IN_PLATFORMS = new Set([
    'alisa',
    'marusia',
    'smart_app',
    'telegram',
    'vk',
    'viber',
    'max_app',
]);

/** Слова, которыми нельзя назвать функцию middleware или класс. */
const RESERVED_WORDS = new Set([
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'function',
    'if',
    'implements',
    'import',
    'in',
    'instanceof',
    'interface',
    'let',
    'new',
    'null',
    'package',
    'private',
    'protected',
    'public',
    'return',
    'static',
    'super',
    'switch',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
]);

/**
 * Что генерирует каждый вид каркаса: папка в src/, имя файла и суффикс, который
 * пользователь мог написать сам («DiscordAdapter» → «Discord»).
 */
const KINDS = {
    platform: { dir: 'platforms', template: 'platform', suffixes: ['Adapter'] },
    db: { dir: 'db', template: 'db', suffixes: ['DbAdapter', 'Adapter'] },
    middleware: { dir: 'middleware', template: 'middleware', suffixes: [] },
};

/**
 * Разбирает имя из командной строки в варианты для шаблонов.
 * @param {string} rawName Имя: `discord`, `my-platform`, `WhatsApp`
 * @param {string[]} suffixes Суффиксы, которые отрезаются от имени
 * @returns {{Name: string, name: string, platformName: string, ENV_NAME: string}}
 */
function parseName(rawName, suffixes) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(rawName ?? '')) {
        throw new Error(
            `Некорректное имя «${rawName ?? ''}»: используйте латинские буквы, цифры, «-» и «_», первая — буква.`,
        );
    }
    const parts = rawName.split(/[-_]+/).filter(Boolean);
    let Name = parts.map((part) => part[0].toUpperCase() + part.slice(1)).join('');
    for (const suffix of suffixes) {
        if (Name.length > suffix.length && Name.endsWith(suffix)) {
            Name = Name.slice(0, -suffix.length);
            break;
        }
    }
    const name = Name[0].toLowerCase() + Name.slice(1);
    if (RESERVED_WORDS.has(name)) {
        throw new Error(`Имя «${name}» — зарезервированное слово JavaScript, выберите другое.`);
    }
    const platformName = parts.length > 1 ? parts.join('_').toLowerCase() : Name.toLowerCase();
    return { Name, name, platformName, ENV_NAME: platformName.toUpperCase() };
}

/**
 * Подставляет значения в шаблон: `{{Name}}`, `{{name}}`, `{{platformName}}`, `{{ENV_NAME}}`.
 * @param {string} template Текст шаблона
 * @param {Record<string, string>} values Значения
 * @returns {string} Готовый файл
 */
function render(template, values) {
    return template.replace(/\{\{(Name|name|platformName|ENV_NAME)\}\}/g, (_, key) => values[key]);
}

/**
 * Подсказка, как подключить созданный модуль, — index.ts пользователя CLI не меняет.
 * @param {string} kind Вид каркаса
 * @param {ReturnType<typeof parseName>} names Имена
 * @param {string} moduleName Имя файла без расширения
 * @returns {string} Текст подсказки
 */
function getUsageHint(kind, names, moduleName) {
    const dir = KINDS[kind].dir;
    if (kind === 'platform') {
        return [
            "import { loadEnvFile } from 'umbot/utils';",
            `import { ${moduleName} } from './${dir}/${moduleName}';`,
            '',
            `const ${names.name}Token =`,
            `    process.env.${names.ENV_NAME}_TOKEN || loadEnvFile('./.env').data?.${names.ENV_NAME}_TOKEN;`,
            `bot.use(new ${moduleName}(${names.name}Token));`,
        ].join('\n');
    }
    if (kind === 'db') {
        return [
            `import { ${moduleName} } from './${dir}/${moduleName}';`,
            '',
            `bot.use(new ${moduleName}());`,
        ].join('\n');
    }
    return [
        `import { ${moduleName} } from './${dir}/${moduleName}';`,
        '',
        `bot.use(${moduleName}());`,
    ].join('\n');
}

/**
 * Создаёт в проекте каркас адаптера платформы, адаптера БД или middleware вместе с тестом
 * на node:test. Существующие файлы без `force` не перезаписываются — ни один из пары.
 *
 * @param {'platform' | 'db' | 'middleware'} kind Вид каркаса
 * @param {string} rawName Имя из командной строки
 * @param {{cwd?: string, force?: boolean}} [options] Корень проекта и разрешение перезаписи
 * @returns {{files: string[], hint: string, testCommand: string, warnings: string[]}}
 *   Созданные файлы (относительно корня), подсказка по подключению, команда запуска теста, предупреждения
 * @throws {Error} Неизвестный вид, некорректное имя, нет папки src/ или файл уже существует
 *
 * @example
 * ```js
 * const { addScaffold } = require('./ScaffoldController.js');
 * const res = addScaffold('platform', 'discord', { cwd: process.cwd() });
 * // res.files: ['src/platforms/DiscordAdapter.ts', 'src/platforms/DiscordAdapter.test.ts']
 * ```
 */
function addScaffold(kind, rawName, options = {}) {
    const config = KINDS[kind];
    if (!config) {
        throw new Error(`Неизвестный вид каркаса «${kind}»: доступны platform, db, middleware.`);
    }
    if (!rawName) {
        throw new Error(`Укажите имя: umbot add ${kind} <name>`);
    }
    const cwd = options.cwd ?? process.cwd();
    const names = parseName(rawName, config.suffixes);
    const srcDir = path.join(cwd, 'src');
    if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
        throw new Error(
            'Папка src/ не найдена. Запустите команду в корне проекта umbot (созданного `umbot create`).',
        );
    }

    const moduleName = {
        platform: `${names.Name}Adapter`,
        db: `${names.Name}DbAdapter`,
        middleware: names.name,
    }[kind];
    const targetDir = path.join(srcDir, config.dir);
    const targets = [
        [path.join(targetDir, `${moduleName}.ts`), `${config.template}.ts.text`],
        [path.join(targetDir, `${moduleName}.test.ts`), `${config.template}.test.ts.text`],
    ];
    const toRelative = (file) => path.relative(cwd, file).split(path.sep).join('/');
    const existing = targets.filter(([file]) => fs.existsSync(file));
    if (existing.length && !options.force) {
        throw new Error(
            `Файл уже существует: ${existing.map(([file]) => toRelative(file)).join(', ')}. ` +
                'Укажите --force, чтобы перезаписать.',
        );
    }

    const warnings = [];
    if (kind === 'platform' && BUILT_IN_PLATFORMS.has(names.platformName)) {
        warnings.push(
            `platformName «${names.platformName}» совпадает со встроенной платформой: ` +
                'при подключении обоих адаптеров запросы получит только один из них.',
        );
    }

    fs.mkdirSync(targetDir, { recursive: true });
    for (const [file, template] of targets) {
        const content = fs.readFileSync(path.join(TEMPLATE_DIR, template), 'utf8');
        fs.writeFileSync(file, render(content, names));
    }
    const testFile = `dist/${config.dir}/${moduleName}.test.js`;
    return {
        files: targets.map(([file]) => toRelative(file)),
        hint: getUsageHint(kind, names, moduleName),
        testCommand: `npm run build && node --test ${testFile}`,
        warnings,
    };
}

/**
 * Обработчик `umbot add platform|db|middleware <name> [--force]`: создаёт каркас и печатает,
 * как его подключить и проверить. Ошибка выводится в консоль с кодом выхода 1.
 *
 * @param {string} kind Вид каркаса
 * @param {string[]} argv Аргументы командной строки
 * @returns {boolean} true, если каркас создан
 */
function runAddScaffold(kind, argv) {
    const rawName = argv.slice(4).find((arg) => !arg.startsWith('--'));
    try {
        const res = addScaffold(kind, rawName, { force: argv.includes('--force') });
        console.log(`Созданы файлы:\n${res.files.map((file) => `  ${file}`).join('\n')}`);
        res.warnings.forEach((warning) => console.warn(warning));
        console.log(`\nПодключите в src/index.ts:\n\n${res.hint}\n`);
        console.log(`Проверить:\n  ${res.testCommand}`);
        console.log('Места, которые нужно заполнить под свою задачу, отмечены комментарием TODO.');
        return true;
    } catch (e) {
        console.error(e.message);
        process.exitCode = 1;
        return false;
    }
}

module.exports = { addScaffold, runAddScaffold, parseName };
