const fs = require('fs');
const path = require('path');

// Адрес гайда на сайте: https://www.maxim-m.ru/docs/umbot/v-3.1/guides/<путь>, где
// <путь> — путь markdown-файла без .md и без префикса src/docs/
// (src/docs/adapter/readme.md → guides/adapter/readme, cli/README.md → guides/cli/README).
// Схема совпадает с prettyRelPath из server/scriptDoc.js, который раскладывает
// собранную доку по этим адресам.
const config = {
    baseUrl: 'https://www.maxim-m.ru/docs/umbot/',
    excludeFiles: [
        'AGENTS.md',
        'SECURITY.md',
        'CHANGELOG.md',
        'CONTRIBUTING.md',
        'CODE_OF_CONDUCT.md',
        'scr.js',
        'clean.js',
        'fix-doc.js',
        'jest.config.js',
        'eslint.config.js',
        '.pretterrc',
        // Отчёты аудита: не проектная документация, ссылки внутри них —
        // цитаты находок с обрезанными примерами, валидировать их нельзя.
        'docs-seo-ai-audit-report.md',
        'docs-audit-report.md',
        'prompt-doc-seo-audit.md',
    ],
    excludeDirs: [
        'node_modules',
        '.git',
        '.idea',
        '.github',
        '.vscode',
        '.agents',
        'tests',
        'audit',
        'tmp-surgery',
        // Переводы собираются из src/docs скриптом i18n-docs.js, их ссылки уже абсолютные.
        'i18n',
    ],
    rootExcludeDirs: ['dist', 'coverage', 'docs'],
    ignoredExtensions: [
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.svg',
        '.ico',
        '.webp',
        '.pdf',
        '.zip',
        '.tar',
        '.gz',
        '.exe',
        '.dll',
        '.so',
        '.dylib',
        '.woff',
        '.woff2',
        '.ttf',
        '.eot',
        '.map',
        '.lock',
        '.patch',
    ],
    allowedPathPrefixes: ['./', '../', 'src/', 'docs/', 'examples/', 'cli/'],
};

const PROJECT_ROOT = path.resolve('.');

// Конфиги typedoc/tsconfig перечисляют .md-файлы (projectDocuments) как пути
// сборки — подмена их на URL ломает сборку доки.
const CONFIG_FILE_RE = /^(?:typedoc|tsconfig)[\w.-]*\.json$/i;

// Ссылка на гайд: текущий формат (v-3.1/guides/…) и прежний — имя файла typedoc
// (documents/umbot_v-3.1_.src_docs_GUIDE.html). Прежний переписывается на текущий.
const GUIDE_URL_RE = /^v-\d+\.\d+\/guides\/(.+)$/;
const LEGACY_GUIDE_URL_RE = /^documents\/(?:umbot_v-\d+\.\d+_\.)?(.+?)(?:\.html)+$/;

// Тело URL гайда до пробела, скобок, кавычек, бэктика или многоточия.
const GUIDE_LINK_RE = new RegExp(
    escapeRegex(config.baseUrl) + '(?:documents|v-\\d+\\.\\d+\\/guides)\\/[^\\s)\\]"\'<>`…]+',
    'g',
);

function loadGitignore() {
    try {
        if (fs.existsSync('.gitignore')) {
            const gitignore = fs.readFileSync('.gitignore', 'utf8');
            gitignore.split('\n').forEach((line) => {
                line = line.trim();
                if (!line || line.startsWith('#')) {
                    return;
                }

                const isRootOnly = line.startsWith('/');
                let pattern = line.replace(/^\//, '').replace(/\/$/, '');

                if (!pattern || pattern.includes('*') || pattern.includes('?')) {
                    return;
                }

                if (pattern.includes('/')) {
                    if (!config.excludeDirs.includes(pattern)) {
                        config.excludeDirs.push(pattern);
                    }
                } else if (isRootOnly) {
                    if (!config.rootExcludeDirs.includes(pattern)) {
                        config.rootExcludeDirs.push(pattern);
                    }
                } else {
                    if (!config.excludeDirs.includes(pattern)) {
                        config.excludeDirs.push(pattern);
                    }
                }
            });
            console.log('📖 Загружены ограничения из .gitignore');
        }
    } catch (error) {
        console.warn('⚠️ Не удалось загрузить .gitignore:', error.message);
    }
}

function getVersionFromPackageJson() {
    try {
        const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
        const parts = packageJson.version.split('.');
        return parts[0] + '.' + parts[1];
    } catch (error) {
        console.error('Ошибка чтения package.json:', error.message);
        process.exit(1);
    }
}

function isExcluded(fullPath, isRoot = false) {
    const normalizedPath = path.normalize(fullPath);
    const parts = normalizedPath.split(path.sep).filter((p) => p && p !== '.');

    for (const excludeDir of config.excludeDirs) {
        if (excludeDir.includes('/')) {
            if (normalizedPath.includes(excludeDir)) {
                return true;
            }
        } else {
            if (parts.includes(excludeDir)) {
                return true;
            }
        }
    }

    if (isRoot) {
        for (const rootExclude of config.rootExcludeDirs) {
            if (parts.length === 1 && parts[0] === rootExclude) {
                return true;
            }
        }
    }

    const fileName = path.basename(fullPath);
    if (config.excludeFiles.includes(fileName) || CONFIG_FILE_RE.test(fileName)) {
        return true;
    }

    const ext = path.extname(fullPath).toLowerCase();
    return config.ignoredExtensions.includes(ext);
}

/**
 * URL гайда → путь markdown-файла от корня проекта или null, если URL не
 * похож на гайд. Текущий формат: guides/adapter/readme → src/docs/adapter/readme.md,
 * а если такого нет — adapter/readme.md от корня (guides/cli/README → cli/README.md).
 * Прежний формат: имя файла typedoc, где «_» заменяет «/» пути.
 */
function urlToFilePath(url) {
    let urlPath = url.slice(config.baseUrl.length);
    const hashIndex = urlPath.indexOf('#');
    if (hashIndex !== -1) urlPath = urlPath.substring(0, hashIndex);

    const guide = urlPath.match(GUIDE_URL_RE);
    if (guide) {
        const docPath = guide[1].replace(/\/+$/, '');
        const inDocs = `src/docs/${docPath}.md`;
        return fs.existsSync(path.resolve(PROJECT_ROOT, inDocs)) ? inDocs : `${docPath}.md`;
    }
    const legacy = urlPath.match(LEGACY_GUIDE_URL_RE);
    return legacy ? `${legacy[1].replace(/_/g, '/')}.md` : null;
}

/** Путь markdown-файла от корня проекта → URL гайда указанной версии. */
function filePathToUrl(filePath, version) {
    let urlPath = path.normalize(filePath).replace(/\\/g, '/');
    urlPath = urlPath.replace(/\.md$/, '');
    urlPath = urlPath.replace(/^\.\//, '');
    urlPath = urlPath.replace(/^\//, '');
    urlPath = urlPath.replace(/^src\/docs\//, '');
    return `${config.baseUrl}v-${version}/guides/${urlPath}`;
}

function isRelativePath(p) {
    return p.startsWith('./') || p.startsWith('../');
}

/**
 * Обрезает захваченный URL до последнего валидного символа.
 * Жадный класс [^\s…]+ захватывал хвосты из markdown-обрамления:
 * бэктик (`…html`), многоточие-«…» и буквы после .html — и «валидная»
 * ссылка с мусорным хвостом помечалась битой.
 */
function trimUrlTail(url) {
    // Знаки препинания в конце — конец предложения («см. …/guides/FAQ.»), а не URL.
    return url.replace(/[.,;:!?]+$/, '');
}

function resolveFilePath(urlOrPath, currentFile) {
    let localPath;

    // Ссылка может содержать #якорь (например, ./GUIDE.md#раздел) — отсекаем
    // его, иначе проверка endsWith('.md') не пройдёт.
    const hashIndex = urlOrPath.indexOf('#');
    const target = hashIndex !== -1 ? urlOrPath.substring(0, hashIndex) : urlOrPath;

    if (target.startsWith(config.baseUrl)) {
        // URL - конвертируем в путь и резолвим от корня проекта
        const filePath = urlToFilePath(target);
        if (!filePath) return null;
        localPath = path.resolve(PROJECT_ROOT, filePath);
    } else if (target.endsWith('.md') && !target.startsWith('http')) {
        // Любая .md-ссылка в markdown относительна к директории текущего
        // файла: и './x.md'/'../x.md', и голая 'x.md' (GUIDE.md → GUIDE.md
        // из соседнего гайда), а не от корня репозитория.
        if (currentFile) {
            const currentDir = path.dirname(currentFile);
            localPath = path.resolve(currentDir, target);
        } else {
            localPath = path.resolve(target);
        }

        // Fallback для путей от корня проекта (например, 'src/docs/GUIDE.md'
        // из корневого README): если от директории файла не нашли — пробуем
        // от корня репозитория.
        if (!fs.existsSync(localPath)) {
            const fromRoot = path.resolve(PROJECT_ROOT, target);
            if (fs.existsSync(fromRoot)) {
                localPath = fromRoot;
            }
        }
    } else {
        return null;
    }

    localPath = path.normalize(localPath);

    if (!localPath.startsWith(PROJECT_ROOT)) {
        return null;
    }

    return fs.existsSync(localPath) ? localPath : null;
}

function walkDir(dir, callback, isRoot = true) {
    if (!fs.existsSync(dir)) return;

    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
        console.warn(`⚠️ Не удалось прочитать директорию ${dir}:`, error.message);
        return;
    }

    entries.forEach((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (isExcluded(fullPath, isRoot)) return;

        if (entry.isDirectory()) {
            try {
                const realPath = fs.realpathSync(fullPath);
                if (realPath.startsWith(PROJECT_ROOT)) {
                    walkDir(fullPath, callback, false);
                }
            } catch (error) {
                console.warn(
                    `⚠️ Не удалось получить реальный путь для ${fullPath}:`,
                    error.message,
                );
            }
        } else if (entry.isFile()) {
            callback(fullPath);
        }
    });
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findLinksInFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('#$no_doc_fix$#')) {
        return [];
    }
    const links = [];

    GUIDE_LINK_RE.lastIndex = 0;
    let match;
    while ((match = GUIDE_LINK_RE.exec(content)) !== null) {
        const url = trimUrlTail(match[0]);
        const page = url.split('#')[0];
        // Прежний формат без .html — обрывок (обрезанный пример в цитате), не ссылка.
        if (page.startsWith(`${config.baseUrl}documents/`) && !page.endsWith('.html')) continue;
        links.push({
            type: 'url',
            value: url,
            line: content.substring(0, match.index).split('\n').length,
            index: match.index,
        });
    }

    const mdLinkRegex = /\[([^\]]+)\]\((?!https?:\/\/)([^)]+\.md(?:#[^)]*)?)\)/g;
    while ((match = mdLinkRegex.exec(content)) !== null) {
        links.push({
            type: 'path',
            value: match[2],
            line: content.substring(0, match.index).split('\n').length,
            index: match.index,
            fullMatch: match[0],
            text: match[1],
        });
    }

    const prefixPattern = config.allowedPathPrefixes
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    const codePathRegex = new RegExp(
        '(?:`|\'|")(' + prefixPattern + '[a-zA-Z0-9_\\-\\.\\/]+\\.md)(?:`|\'|")',
        'g',
    );
    while ((match = codePathRegex.exec(content)) !== null) {
        if (!config.allowedPathPrefixes.includes(match[1])) {
            links.push({
                type: 'path',
                value: match[1],
                line: content.substring(0, match.index).split('\n').length,
                // +1: match.index указывает на открывающую кавычку, а заменяется путь внутри неё.
                index: match.index + 1,
            });
        }
    }

    return links;
}

function processFiles() {
    loadGitignore();

    const version = getVersionFromPackageJson();
    console.log(`🎯 Текущая версия: ${version}`);
    console.log(
        `🚫 Исключения: ${config.excludeDirs.length} папок, ${config.rootExcludeDirs.length} корневых папок, ${config.excludeFiles.length} файлов\n`,
    );

    const brokenLinks = [];
    const updatedFiles = new Set();
    const processedFiles = [];

    walkDir('.', (filePath) => {
        const links = findLinksInFile(filePath);
        if (links.length === 0) return;

        processedFiles.push(filePath);
        let content = fs.readFileSync(filePath, 'utf8');
        const originalContent = content;

        const sortedLinks = links.sort((a, b) => b.index - a.index);

        sortedLinks.forEach((link) => {
            const resolvedPath = resolveFilePath(link.value, filePath);

            if (resolvedPath) {
                if (link.type === 'url') {
                    const hashIndex = link.value.indexOf('#');
                    const hash = hashIndex !== -1 ? link.value.substring(hashIndex) : '';
                    const urlWithoutHash =
                        hashIndex !== -1 ? link.value.substring(0, hashIndex) : link.value;
                    const localPath = urlToFilePath(urlWithoutHash);
                    const newUrl = filePathToUrl(localPath, version) + hash;

                    if (link.value !== newUrl) {
                        content =
                            content.substring(0, link.index) +
                            newUrl +
                            content.substring(link.index + link.value.length);
                        updatedFiles.add(filePath);
                    }
                } else if (link.type === 'path') {
                    // Сохраняем #якорь при переписывании ссылки.
                    const pathHashIndex = link.value.indexOf('#');
                    const pathHash =
                        pathHashIndex !== -1 ? link.value.substring(pathHashIndex) : '';
                    const relativePath = path.relative(PROJECT_ROOT, resolvedPath);
                    const newUrl = filePathToUrl(relativePath, version) + pathHash;

                    if (link.fullMatch) {
                        const newFullMatch = `[${link.text}](${newUrl})`;
                        content =
                            content.substring(0, link.index) +
                            newFullMatch +
                            content.substring(link.index + link.fullMatch.length);
                    } else {
                        content =
                            content.substring(0, link.index) +
                            newUrl +
                            content.substring(link.index + link.value.length);
                    }
                    updatedFiles.add(filePath);
                }
            } else {
                brokenLinks.push({
                    file: filePath,
                    line: link.line,
                    type: link.type,
                    value: link.value,
                });
            }
        });

        if (content !== originalContent) {
            fs.writeFileSync(filePath, content, 'utf8');
        }
    });

    console.log(`\n📊 Найдено: ${processedFiles.length} | Обновлено: ${updatedFiles.size}`);
    if (processedFiles.length) {
        console.log(' - Найденные файлы: ', processedFiles);
    }
    if (updatedFiles.size) {
        console.log(' - Обновленные файлы: ', [...updatedFiles]);
    }

    if (brokenLinks.length === 0) {
        console.log('\n✅ Все ссылки корректны!');
    } else {
        console.log(`\n❌ Найдено битых ссылок: ${brokenLinks.length}\n`);
        brokenLinks.forEach((link) => {
            console.log(`📄 ${link.file}:${link.line}`);
            console.log(`   ${link.type === 'url' ? '🔗 URL' : '📁 Путь'}: ${link.value}\n`);
        });
        process.exit(1);
    }
}

processFiles();
