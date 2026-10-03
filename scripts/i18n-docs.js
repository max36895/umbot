/**
 * Перевод документации на другие языки через кэш переводов по блокам.
 *
 * Источник правды — русские Markdown-файлы. Файл режется на блоки (абзац, заголовок, список,
 * таблица, блок кода), у каждого блока — хэш русского текста. Переводы лежат в
 * `i18n/<lang>/translations.json` по этому хэшу, поэтому:
 *  - правка одного абзаца в русской доке требует перевода только этого абзаца;
 *  - устаревший перевод не попадает в сборку: у изменённого блока другой хэш;
 *  - блоки без перевода в сборке остаются русскими и считаются в `status`.
 *
 * Команды (lang по умолчанию — en):
 *   node scripts/i18n-docs.js status [--lang en]           — сколько блоков переведено по страницам
 *   node scripts/i18n-docs.js export [--lang en] [файл...] — блоки без перевода → i18n/<lang>/pending.json и pending.md
 *   node scripts/i18n-docs.js import <файл.json|файл.md> [--lang en] — добавить переводы в кэш с проверками
 *   node scripts/i18n-docs.js build [--lang en] [--out папка] — собрать переведённые страницы в i18n/<lang>/build/
 *     (или в папку: страницы пишутся по тем же путям, что в репозитории, — поверх его копии)
 *   node scripts/i18n-docs.js prune [--lang en]            — удалить из кэша переводы блоков, которых больше нет
 *
 * Список переводимых страниц — `pages` в `i18n/<lang>/config.json`.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Переопределение корня нужно только тестам: они работают во временной папке.
const ROOT = process.env.UMBOT_I18N_ROOT ?? path.resolve(__dirname, '..');
const FENCE_RE = /^\s*(```|~~~)/;
const CYRILLIC_RE = /[А-Яа-яЁё]/;
const GUIDES_URL = 'https://www.maxim-m.ru/docs/umbot/v-3.1/guides/';
/** Начало разделителя блока в pending.md и файлах переводов. */
const BLOCK_MARK = '<!-- block ';

/**
 * Аргументы командной строки.
 * @param {string[]} argv Аргументы после имени скрипта
 * @returns {{command: string, lang: string, files: string[], out: string | null}}
 */
function parseArgs(argv) {
    const [command = 'status', ...rest] = argv;
    let lang = 'en';
    let out = null;
    const files = [];
    for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--lang') {
            lang = rest[++i] ?? lang;
        } else if (rest[i] === '--out') {
            out = path.resolve(rest[++i] ?? '.');
        } else {
            files.push(rest[i]);
        }
    }
    if (!/^[a-z]{2}$/.test(lang)) {
        throw new Error(`Некорректный код языка: ${lang}`);
    }
    return { command, lang, files, out };
}

/**
 * Пути файлов языка.
 * @param {string} lang Код языка
 */
function langPaths(lang) {
    const dir = path.join(ROOT, 'i18n', lang);
    return {
        dir,
        config: path.join(dir, 'config.json'),
        translations: path.join(dir, 'translations.json'),
        pending: path.join(dir, 'pending.json'),
        build: path.join(dir, 'build'),
    };
}

/**
 * Читает JSON или возвращает значение по умолчанию, если файла нет.
 * @param {string} file Путь
 * @param {unknown} fallback Значение по умолчанию
 */
function readJson(file, fallback) {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

/**
 * Пишет JSON с отступом и переводом строки в конце (как prettier).
 * @param {string} file Путь
 * @param {unknown} data Данные
 */
function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(data, null, 4)}\n`);
}

/**
 * Режет Markdown на блоки. Блок кода — целиком, вместе с пустыми строками внутри;
 * остальное разделяется пустыми строками. Пустые строки между блоками не хранятся:
 * сборка соединяет блоки одной пустой строкой, как prettier.
 * @param {string} markdown Текст файла
 * @returns {string[]} Блоки
 */
function splitBlocks(markdown) {
    const blocks = [];
    let current = [];
    let fence = null;
    const flush = () => {
        if (current.length) {
            blocks.push(current.join('\n'));
            current = [];
        }
    };
    for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
        const fenceMatch = FENCE_RE.exec(line);
        if (fence) {
            current.push(line);
            if (fenceMatch && fenceMatch[1] === fence) {
                fence = null;
            }
            continue;
        }
        // Граница блока — только пустая строка вне кода: блок кода внутри пункта списка
        // без пустой строки перед ним остаётся частью пункта.
        if (fenceMatch) {
            fence = fenceMatch[1];
            current.push(line);
        } else if (line.trim() === '') {
            flush();
        } else {
            current.push(line);
        }
    }
    flush();
    return blocks;
}

/**
 * Хэш блока: от русского текста без хвостовых пробелов.
 * @param {string} block Блок
 * @returns {string} 16 hex-символов
 */
function blockHash(block) {
    const normalized = block
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n');
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Нужно ли переводить блок: без кириллицы он одинаков на всех языках (код, ссылки, таблицы API).
 * @param {string} block Блок
 * @returns {boolean}
 */
function needsTranslation(block) {
    return CYRILLIC_RE.test(block);
}

/**
 * Якорь заголовка так, как его строит typedoc 0.28 (Slugger.serialize): текст без `кода`,
 * без пунктуации (эмодзи остаются), каждый пробел → «-», схлопывается только первая серия «--».
 * @param {string} heading Текст заголовка без «#»
 * @returns {string} Якорь без суффикса повтора
 */
function headingSlug(heading) {
    const text = heading
        .replace(/`[^`]*`/g, '')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .trim();
    const slug = text
        .replace(/[ -⁯⸀-⹿\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/g, '')
        .replace(/\s/g, '-')
        .replace(/--+/, '-');
    return (slug || '_').toLocaleLowerCase();
}

/**
 * Якорь заголовка в стиле GitHub: так написаны часть ссылок внутри русских страниц.
 * @param {string} heading Текст заголовка без «#»
 * @returns {string} Якорь
 */
function githubSlug(heading) {
    return heading
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .trim()
        .replace(/\s/g, '-');
}

/**
 * Выдаёт якоря страницы с суффиксом повтора, как typedoc: второй «Настройка» → «настройка-1».
 * @returns {(slug: string) => string}
 */
function createSlugger() {
    const seen = new Map();
    return (slug) => {
        let result = slug;
        let count = 0;
        if (seen.has(slug)) {
            count = seen.get(slug);
            do {
                count++;
                result = `${slug}-${count}`;
            } while (seen.has(result));
        }
        seen.set(slug, count);
        return result;
    };
}

/**
 * Заголовки блока (строки `#` вне блоков кода).
 * @param {string} block Блок
 * @returns {string[]} Тексты заголовков
 */
function headingsOf(block) {
    const headings = [];
    let fence = null;
    for (const line of block.split('\n')) {
        const fenceMatch = FENCE_RE.exec(line);
        if (fenceMatch) {
            fence = fence === fenceMatch[1] ? null : (fence ?? fenceMatch[1]);
            continue;
        }
        const match = fence ? null : /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
        if (match) {
            headings.push(match[1].trim());
        }
    }
    return headings;
}

/**
 * Делит блок на строки кода и текста: блок кода бывает внутри цитаты (`> ```ts`) или пункта списка.
 * @param {string} block Блок
 * @returns {{ code: string, prose: string }} Код (с ограждениями) и текст
 */
function splitCode(block) {
    const code = [];
    const prose = [];
    let fence = null;
    for (const line of block.split('\n')) {
        const match = /^[\s>]*(```|~~~)/.exec(line);
        if (match && (!fence || match[1] === fence)) {
            fence = fence ? null : match[1];
            code.push(line);
        } else {
            (fence ? code : prose).push(line);
        }
    }
    return { code: code.join('\n'), prose: prose.join('\n') };
}

/**
 * Сохранились ли в переводе все фрагменты без кириллицы и не появилось ли лишних:
 * фрагмент с кириллицей (заглушка, пример фразы) может быть переведён.
 * @param {string} source Русский блок
 * @param {string} translation Перевод
 * @param {RegExp} re Регулярка фрагмента (с флагом g)
 * @returns {boolean}
 */
function sameKept(source, translation, re) {
    const sourceParts = source.match(re) ?? [];
    const rest = [...(translation.match(re) ?? [])];
    if (rest.length !== sourceParts.length) {
        return false;
    }
    for (const part of sourceParts.filter((item) => !CYRILLIC_RE.test(item))) {
        const index = rest.indexOf(part);
        if (index === -1) {
            return false;
        }
        rest.splice(index, 1);
    }
    return true;
}

/**
 * Проверки перевода, которые не требуют знания языка: ничего не потерялось и не исказилось.
 * @param {string} source Русский блок
 * @param {string} translation Перевод
 * @returns {string[]} Найденные проблемы
 */
function checkTranslation(source, translation) {
    const problems = [];
    const collect = (text, re) => (text.match(re) ?? []).sort().join('\n');
    const src = splitCode(source);
    const dst = splitCode(translation);
    if (src.code) {
        if (source.split('\n').length !== translation.split('\n').length) {
            problems.push('в блоке кода изменилось число строк');
        }
        // Код вне комментариев и строк должен остаться тем же: сверяем идентификаторы.
        const identifiers = (text) => collect(text, /\b[A-Za-z_$][\w$]*\(/g);
        if (identifiers(src.code) !== identifiers(dst.code)) {
            problems.push('в блоке кода изменились вызовы функций');
        }
    }
    // Фрагменты кода с кириллицей (`'помощь'`, `<имя>`) можно переводить, остальные должны остаться.
    if (!sameKept(src.prose, dst.prose, /`[^`\n]+`/g)) {
        problems.push('не совпадают фрагменты `кода`');
    }
    // «10 000» и «10,000», «0,5» и «0.5» — одно и то же число в разных языках.
    const numbers = (text) =>
        collect(
            text.replace(/(\d)[\s\u00a0,](?=\d{3}\b)/g, '$1').replace(/(\d),(\d)/g, '$1.$2'),
            /\d+(?:\.\d+)?/g,
        );
    if (numbers(src.prose) !== numbers(dst.prose)) {
        problems.push('не совпадают числа');
    }
    // Адреса-заглушки на кириллице (`https://ваш-домен/`) переводятся, остальные должны остаться.
    if (!sameKept(source, translation, /https?:\/\/[^\s)#'"`]+/g)) {
        problems.push('не совпадают адреса ссылок');
    }
    // Русские якоря в ссылках и русские примеры в `коде` (ввод для NLU) — не остаток перевода.
    const prose = dst.prose.replace(/\]\([^)]*\)/g, ']()').replace(/`[^`\n]+`/g, '``');
    if (CYRILLIC_RE.test(prose)) {
        problems.push('в переводе осталась кириллица');
    }
    return problems;
}

/**
 * Страницы для перевода из config.json.
 * @param {ReturnType<typeof langPaths>} paths Пути языка
 * @param {string[]} only Ограничить этими файлами
 * @returns {string[]} Пути относительно корня
 */
function getPages(paths, only) {
    const config = readJson(paths.config, { pages: [] });
    const pages = only.length
        ? only.map((file) => path.relative(ROOT, path.resolve(file)))
        : config.pages;
    return pages.map((page) => page.split(path.sep).join('/'));
}

/**
 * Блоки страницы с хэшами.
 * @param {string} page Путь относительно корня
 */
function pageBlocks(page) {
    return splitBlocks(fs.readFileSync(path.join(ROOT, page), 'utf8')).map((source) => ({
        source,
        hash: blockHash(source),
        translatable: needsTranslation(source),
    }));
}

/**
 * Команда status.
 * @param {ReturnType<typeof langPaths>} paths Пути языка
 * @param {string[]} files Ограничить файлами
 * @returns {number} Число непереведённых блоков
 */
function status(paths, files) {
    const translations = readJson(paths.translations, {});
    let missingTotal = 0;
    for (const page of getPages(paths, files)) {
        const blocks = pageBlocks(page).filter((block) => block.translatable);
        const missing = blocks.filter((block) => !translations[block.hash]).length;
        missingTotal += missing;
        const percent = blocks.length
            ? Math.round(((blocks.length - missing) / blocks.length) * 100)
            : 100;
        console.log(
            `${String(percent).padStart(3)}%  ${page}  (без перевода: ${missing} из ${blocks.length})`,
        );
    }
    return missingTotal;
}

/**
 * Команда export: блоки без перевода в pending.json.
 * @param {ReturnType<typeof langPaths>} paths Пути языка
 * @param {string[]} files Ограничить файлами
 */
function exportPending(paths, files) {
    const translations = readJson(paths.translations, {});
    const pending = {};
    for (const page of getPages(paths, files)) {
        for (const block of pageBlocks(page)) {
            if (block.translatable && !translations[block.hash] && !pending[block.hash]) {
                pending[block.hash] = { page, ru: block.source };
            }
        }
    }
    writeJson(paths.pending, pending);
    // Тот же список в Markdown: переводить блоки кода удобнее без экранирования JSON.
    const markdown = Object.entries(pending)
        .map(([hash, { page, ru }]) => `${BLOCK_MARK}${hash} ${page} -->\n\n${ru}`)
        .join('\n\n');
    fs.writeFileSync(paths.pending.replace(/\.json$/, '.md'), `${markdown}\n`);
    console.log(
        `Блоков без перевода: ${Object.keys(pending).length} → ${path.relative(ROOT, paths.pending)} (и .md)`,
    );
}

/**
 * Разбирает файл переводов в формате pending.md: блоки после строк `<!-- block <хэш> ... -->`.
 * @param {string} markdown Текст файла
 * @returns {Record<string, string>} Переводы по хэшу
 */
function parseBlockMarkdown(markdown) {
    const result = {};
    const parts = markdown.replace(/\r\n/g, '\n').split(new RegExp(`^${BLOCK_MARK}`, 'm'));
    for (const part of parts.slice(1)) {
        const newline = part.indexOf('\n');
        const hash = part.slice(0, newline).split(' ')[0];
        result[hash] = part.slice(newline + 1).trim();
    }
    return result;
}

/**
 * Команда import: переводы { хэш: текст } или { хэш: { en } } в кэш. Блок с проблемами
 * не добавляется: исправьте перевод и импортируйте снова.
 * @param {ReturnType<typeof langPaths>} paths Пути языка
 * @param {string} lang Код языка
 * @param {string} file Файл с переводами
 * @returns {number} Число отклонённых блоков
 */
function importTranslations(paths, lang, file) {
    const incoming = file.endsWith('.md')
        ? parseBlockMarkdown(fs.readFileSync(path.resolve(file), 'utf8'))
        : readJson(path.resolve(file), null);
    if (!incoming || typeof incoming !== 'object') {
        throw new Error(`Не удалось прочитать переводы из ${file}`);
    }
    const pending = readJson(paths.pending, {});
    const translations = readJson(paths.translations, {});
    let added = 0;
    let rejected = 0;
    for (const [hash, value] of Object.entries(incoming)) {
        const text = typeof value === 'string' ? value : value?.[lang];
        const source = pending[hash]?.ru ?? translations[hash]?.ru;
        if (!source || typeof text !== 'string') {
            console.warn(`${hash}: неизвестный блок или пустой перевод — пропущен`);
            rejected++;
            continue;
        }
        const problems = checkTranslation(source, text);
        if (problems.length) {
            console.warn(`${hash} (${pending[hash]?.page ?? ''}): ${problems.join('; ')}`);
            rejected++;
            continue;
        }
        translations[hash] = { ru: source, [lang]: text };
        delete pending[hash];
        added++;
    }
    writeJson(paths.translations, translations);
    writeJson(paths.pending, pending);
    console.log(`Добавлено переводов: ${added}, отклонено: ${rejected}`);
    return rejected;
}

/**
 * Адрес русского оригинала на сайте — по той же схеме, что в scripts/fix-doc.js.
 * README — главная страница документации.
 * @param {string} page Путь страницы относительно корня
 * @param {string} base Адрес раздела гайдов
 * @returns {string} URL
 */
function pageUrl(page, base) {
    if (page === 'README.md') {
        return base.replace(/guides\/$/, '');
    }
    return `${base}${page.replace(/^src\/docs\//, '').replace(/\.md$/, '')}`;
}

/**
 * Переводит страницу и собирает соответствие якорей «русский → перевод».
 * @param {string} page Путь страницы
 * @param {Record<string, Record<string, string>>} translations Кэш переводов
 * @param {string} lang Код языка
 * @returns {{content: string, anchors: Map<string, string>, missing: number}}
 */
function translatePage(page, translations, lang) {
    const anchors = new Map();
    const ruSlugger = createSlugger();
    const githubSlugger = createSlugger();
    const targetSlugger = createSlugger();
    let missing = 0;
    const output = pageBlocks(page).map((block) => {
        let text = block.translatable ? translations[block.hash]?.[lang] : block.source;
        if (!text) {
            missing++;
            text = block.source;
        }
        const targetHeadings = headingsOf(text);
        headingsOf(block.source).forEach((heading, i) => {
            const target = targetSlugger(headingSlug(targetHeadings[i] ?? heading));
            // Ссылка могла быть написана и якорем typedoc, и якорем GitHub — оба ведут на перевод.
            const githubAnchor = githubSlugger(githubSlug(heading));
            const typedocAnchor = ruSlugger(headingSlug(heading));
            if (!anchors.has(githubAnchor)) {
                anchors.set(githubAnchor, target);
            }
            anchors.set(typedocAnchor, target);
        });
        return text;
    });
    return { content: output.join('\n\n'), anchors, missing };
}

/**
 * Команда build: переведённые страницы с переписанными ссылками. Ссылка на другую
 * переведённую страницу ведёт на её перевод (с переведённым якорем), на непереведённую — на оригинал.
 * @param {ReturnType<typeof langPaths>} paths Пути языка
 * @param {string} lang Код языка
 * @param {string[]} files Ограничить файлами
 * @param {string | null} outDir Куда писать страницы (по умолчанию i18n/<lang>/build)
 */
function build(paths, lang, files, outDir) {
    const translations = readJson(paths.translations, {});
    const config = readJson(paths.config, {});
    const siteUrl = config.siteUrl ?? GUIDES_URL;
    const pages = getPages(paths, files);
    const translated = new Map(
        pages.map((page) => [page, translatePage(page, translations, lang)]),
    );
    // Русский адрес страницы → страница: по нему находим ссылки на переведённые страницы.
    const byUrl = new Map(pages.map((page) => [pageUrl(page, GUIDES_URL), page]));
    const localAnchor = (page, anchor) => {
        const decoded = decodeURIComponent(anchor);
        return translated.get(page).anchors.get(decoded) ?? anchor;
    };
    for (const page of pages) {
        let { content } = translated.get(page);
        content = content.replace(
            /\]\(#([^)]+)\)/g,
            (_, anchor) => `](#${localAnchor(page, anchor)})`,
        );
        content = content.replace(
            /\]\((https:\/\/www\.maxim-m\.ru\/docs\/umbot\/[^)#\s]*)(#[^)\s]+)?\)/g,
            (match, url, hash) => {
                const target = byUrl.get(url.replace(/\/$/, '')) ?? byUrl.get(url);
                if (!target) {
                    return match;
                }
                const anchor = hash ? `#${localAnchor(target, hash.slice(1))}` : '';
                return `](${pageUrl(target, siteUrl)}${anchor})`;
            },
        );
        const [title, ...rest] = content.split('\n\n');
        const notice = config.notice
            ? `${config.notice.replace('{url}', pageUrl(page, GUIDES_URL))}\n\n`
            : '';
        const target = path.join(outDir ?? paths.build, page);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `${title}\n\n${notice}${rest.join('\n\n')}\n`);
        const { missing } = translated.get(page);
        console.log(`Собрано: ${page}${missing ? ` (без перевода блоков: ${missing})` : ''}`);
    }
}

/**
 * Команда prune: удаляет переводы блоков, которых нет ни на одной странице.
 * @param {ReturnType<typeof langPaths>} paths Пути языка
 */
function prune(paths) {
    const translations = readJson(paths.translations, {});
    const used = new Set(
        getPages(paths, []).flatMap((page) => pageBlocks(page).map((block) => block.hash)),
    );
    let removed = 0;
    for (const hash of Object.keys(translations)) {
        if (!used.has(hash)) {
            delete translations[hash];
            removed++;
        }
    }
    writeJson(paths.translations, translations);
    console.log(`Удалено устаревших переводов: ${removed}`);
}

/**
 * Точка входа.
 * @param {string[]} argv Аргументы
 */
function main(argv) {
    const { command, lang, files, out } = parseArgs(argv);
    const paths = langPaths(lang);
    switch (command) {
        case 'status':
            status(paths, files);
            break;
        case 'export':
            exportPending(paths, files);
            break;
        case 'import':
            if (!files[0]) {
                throw new Error('Укажите файл с переводами: import <файл.json>');
            }
            if (importTranslations(paths, lang, files[0])) {
                process.exitCode = 1;
            }
            break;
        case 'build':
            build(paths, lang, files, out);
            break;
        case 'prune':
            prune(paths);
            break;
        default:
            throw new Error(`Неизвестная команда: ${command}`);
    }
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (e) {
        console.error(e.message);
        process.exitCode = 1;
    }
}

module.exports = { splitBlocks, blockHash, needsTranslation, headingSlug, checkTranslation };
