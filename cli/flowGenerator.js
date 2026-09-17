'use strict';
/**
 * Генератор проекта umbot из flow.json.
 * АРХИТЕКТУРА: addCommand + addStep, блоки = переиспользуемые функции.
 * @module flowGenerator
 */

const fs = require('fs');
const path = require('path');

/** Версия umbot, частью которого является этот CLI. */
const UMBOT_VERSION = `^${require(path.join(__dirname, '..', 'package.json')).version}`;
const utils = require(__dirname + '/utils.js').utils;

/**
 * Экранирует строку для безопасной вставки в TypeScript/JavaScript код.
 * Обрабатывает: обратные слеши, кавычки, бэктики, $, переносы строк, \r.
 * @param {string} s — исходная строка
 * @returns {string} экранированная строка
 */
function escapeStr(s) {
    return String(s)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '');
}

/**
 * Экранирует строку для безопасной вставки в JSDoc-комментарий сгенерированного кода.
 *
 * Закрывающая последовательность блочного комментария в тексте из flow.json
 * закрывала бы комментарий досрочно, а всё следом попадало в сгенерированный
 * код как исполняемый — flow.json приходит извне, так что это обязательная
 * защита.
 *
 * @param {unknown} text — исходный текст из flow.json
 * @returns {string} текст, безопасный для вставки внутрь комментария
 */
function escapeComment(text) {
    return String(text ?? '')
        .replace(/\*\//g, '* /')
        .replace(/\/\*/g, '/ *')
        .replace(/[\r\n\u2028\u2029]+/g, ' ');
}

/**
 * Проверяет, является ли строка валидным JS-идентификатором.
 * @param {string} name — проверяемое имя
 * @returns {string|undefined} JS-выражение системной переменной или falsy, если имя не системное true если имя соответствует /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
 * и не является __proto__/prototype/constructor
 */
function isValidJSIdentifier(name) {
    return (
        /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) &&
        !['__proto__', 'prototype', 'constructor'].includes(name)
    );
}

/** Проверяет, что имя не меняет прототип объекта userData. */
function isSafeUserDataKey(name) {
    return !String(name)
        .split('.')
        .some((part) => ['__proto__', 'prototype', 'constructor'].includes(part));
}

/**
 * Генерирует выражение доступа к userData для переменной.
 * Для валидных JS-идентификаторов: ctrl.userData.name
 * Для нестандартных имён: ctrl.userData['name']
 * @param {string} name — имя переменной
 * @returns {string} JS-выражение доступа к userData
 */
function userDataAccess(name) {
    if (!name) return 'ctrl.userData';
    if (isValidJSIdentifier(name)) {
        return `ctrl.userData.${name}`;
    }
    return `ctrl.userData['${escapeStr(name)}']`;
}

/**
 * Назначает блокам безопасные и уникальные имена функций в сгенерированном коде.
 * Имя из визуального редактора нельзя вставлять в TypeScript как идентификатор без нормализации.
 * @param {Array} blocks — блоки, для которых будут сгенерированы функции
 */
function assignBlockFunctionNames(blocks) {
    const usedNames = new Map();
    for (const block of blocks) {
        const rawName = String(block.name || block.id || 'block');
        let safeName = rawName.replace(/[^a-zA-Z0-9_$]/g, '_');
        if (!safeName || !/^[a-zA-Z_$]/.test(safeName)) {
            safeName = `_${safeName || 'block'}`;
        }

        const baseName = `__${safeName}`;
        const occurrence = (usedNames.get(baseName) || 0) + 1;
        usedNames.set(baseName, occurrence);
        block.generatedFunctionName = occurrence === 1 ? baseName : `${baseName}_${occurrence}`;
    }
}

/** Типы нод, на которые может вести кнопка. */
const BUTTON_TARGET_TYPES = new Set(['command', 'step', 'action', 'condition', 'response']);

/** Префикс имени действия кнопки: `[go:N]` — скобки исключают совпадение `[go:1]` внутри `[go:12]`. */
const BUTTON_ACTION_PREFIX = '[go:';

/**
 * Команда старта Telegram: клиент отправляет её при нажатии «Начать» (и с deep-link параметром).
 * Слот сравнивается вхождением, поэтому `/start payload` тоже запускает приветствие.
 */
const START_SLOT = '/start';

/** Режимы приложения, которые принимает Bot.setAppMode. */
const APP_MODES = new Set(['dev', 'prod', 'strict_prod']);

/**
 * Первая команда с ролью (welcome/help/fallback). Роль задаётся полем role или именем команды.
 * @param {Object} doc — FlowDocument
 * @param {string} role — роль команды
 * @returns {Object|undefined} нода команды
 */
function findRoleCommand(doc, role) {
    return (doc.nodes || []).find(
        (n) => n && n.type === 'command' && (n.name === role || n.role === role),
    );
}

/**
 * Приветствие из настроек бота (welcome.text/buttons) нужно только без ноды welcome:
 * иначе ответ задаёт сама нода.
 * @param {Object} doc — FlowDocument
 * @returns {{text: string, buttons: Array}|null} приветствие или null
 */
function getSettingsWelcome(doc) {
    if (findRoleCommand(doc, 'welcome')) return null;
    const text = String((doc.welcome && doc.welcome.text) || '');
    const buttons = ((doc.welcome && doc.welcome.buttons) || []).filter(
        (b) => b && String(b.title || '').trim(),
    );
    return text.trim() || buttons.length ? { text, buttons } : null;
}

/**
 * Текст справки из настроек нужен только без ноды help.
 * @param {Object} doc — FlowDocument
 * @returns {string} текст справки или пустая строка
 */
function getSettingsHelpText(doc) {
    if (findRoleCommand(doc, 'help')) return '';
    return String((doc.helpText && doc.helpText.text) || '').trim();
}

/**
 * Слоты приветствия: собственные слоты ноды (или стандартные WELCOME_INTENT_SLOTS) и `/start`.
 * @param {string[]} slots — слоты ноды welcome
 * @returns {string} выражение массива слотов
 */
function welcomeSlotsExpr(slots) {
    const own = (slots || []).filter((s) => s && s !== START_SLOT);
    return own.length
        ? `['${START_SLOT}', ${own.map((s) => `'${escapeStr(s)}'`).join(', ')}]`
        : `['${START_SLOT}', ...WELCOME_INTENT_SLOTS]`;
}

/**
 * Действия кнопок с блоком-целью для документа (doc → Map ключ → действие).
 * Заполняется в collectButtonActions перед генерацией.
 */
const buttonActionsByDoc = new WeakMap();

/**
 * Все кнопки ноды: ответ команды/блока, вопрос шага, кнопки действия, ветки инлайн-условий.
 * @param {Object} node — нода сценария
 * @returns {Array} кнопки FlowButton
 */
function getNodeButtons(node) {
    const buttons = [];
    const push = (list) => Array.isArray(list) && buttons.push(...list);
    push(node.response && node.response.buttons);
    push(node.prompt && node.prompt.buttons);
    if (node.type === 'action') push(node.buttons);
    // Кнопки картинок карточки
    for (const card of [
        node.response && node.response.card,
        node.prompt && node.prompt.card,
        node.card,
    ]) {
        for (const img of (card && card.images) || []) {
            if (img && img.button) buttons.push(img.button);
        }
    }
    for (const cond of node.conditions || []) {
        push(cond.responseTrue && cond.responseTrue.buttons);
        push(cond.responseFalse && cond.responseFalse.buttons);
    }
    return buttons;
}

/**
 * Собирает кнопки, ведущие на блок-цель, и назначает каждой цели действие `[go:N]`.
 * Для команды и шага ключ включает текст кнопки: нажатие передаётся цели как ввод
 * с этим текстом. Для блоков ответ/действие/условие текст не важен — одно действие на блок.
 * @param {Object} doc — FlowDocument
 * @returns {Map<string, {name: string, target: Object, title: string}>} действия по ключу
 */
function collectButtonActions(doc) {
    const actions = new Map();
    const settingsWelcome = getSettingsWelcome(doc);
    const buttonLists = (doc.nodes || []).filter(Boolean).map(getNodeButtons);
    // Кнопки приветствия из настроек показываются, когда в сценарии нет ноды welcome
    if (settingsWelcome) buttonLists.push(settingsWelcome.buttons);
    for (const buttons of buttonLists) {
        for (const btn of buttons) {
            const target = getButtonTarget(doc, btn);
            if (!target) continue;
            const key = getButtonActionKey(target, btn.title);
            if (!actions.has(key)) {
                actions.set(key, {
                    name: `${BUTTON_ACTION_PREFIX}${actions.size + 1}]`,
                    target,
                    title: String(btn.title),
                });
            }
        }
    }
    buttonActionsByDoc.set(doc, actions);
    return actions;
}

/**
 * Нода, на которую ведёт кнопка-действие, либо null (ссылка, нет цели, цель — завершение).
 * @param {Object} doc — FlowDocument
 * @param {Object} btn — кнопка FlowButton
 * @returns {Object|null} нода-цель
 */
function getButtonTarget(doc, btn) {
    if (!btn || btn.type === 'link' || !btn.targetNodeId || !String(btn.title || '').trim()) {
        return null;
    }
    const target = (doc.nodes || []).find((n) => n && n.id === btn.targetNodeId);
    return target && BUTTON_TARGET_TYPES.has(target.type) ? target : null;
}

/**
 * Ключ действия кнопки: для команды/шага важен и текст кнопки (он станет вводом).
 * @param {Object} target — нода-цель
 * @param {string} title — текст кнопки
 * @returns {string} ключ
 */
function getButtonActionKey(target, title) {
    return target.type === 'command' || target.type === 'step'
        ? `${target.id}\u0000${title}`
        : target.id;
}

/**
 * Имя действия для кнопки с блоком-целью либо null.
 * @param {Object} doc — FlowDocument
 * @param {Object} btn — кнопка FlowButton
 * @returns {string|null} имя действия `[go:N]`
 */
function getButtonActionName(doc, btn) {
    const actions = doc && buttonActionsByDoc.get(doc);
    const target = actions && getButtonTarget(doc, btn);
    if (!target) return null;
    const action = actions.get(getButtonActionKey(target, btn.title));
    return action ? action.name : null;
}

/**
 * Код добавления кнопки-действия. В Telegram все кнопки показываются inline
 * (`options.inline`): нажатие без цели приходит как текст кнопки, с целью — как действие.
 * @param {string} title — текст кнопки
 * @param {string|null} actionName — имя действия `[go:N]` или null
 * @returns {string} выражение ctrl.buttons.addBtn(...)
 */
function addBtnExpr(title, actionName) {
    const payload = actionName ? `{ command: '${escapeStr(actionName)}' }` : `''`;
    return `ctrl.buttons.addBtn(${textExpr(title)}, '', ${payload}, { inline: true })`;
}

/**
 * Возвращает имя функции, назначенное блоку перед генерацией.
 * @param {Object} block — блок сценария
 * @returns {string} безопасное имя TypeScript-функции
 */
function getBlockFunctionName(block) {
    return block.generatedFunctionName || '__block';
}

/**
 * Приводит имя Cloud Function к допустимому имени ресурса и исключает YAML-инъекции.
 * @param {unknown} name — исходное имя проекта
 * @returns {string} имя Cloud Function
 */
function getCloudFunctionName(name) {
    const normalized = String(name || 'my-bot')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return normalized || 'my-bot';
}

/**
 * Переносит креды MongoDB (user/pass из flow.json) в .env генерируемого проекта.
 *
 * MongoAdapter читает логин/пароль из переменных окружения DB_USER/DB_PASSWORD
 * (см. AppContext), поэтому в коммит-файл src/index.ts их писать нельзя
 * (в create-ветке CLI — ConsoleController — тот же сценарий).
 *
 * Семантика — как у записи токенов: существующий .env не перезаписывается,
 * дописываются только отсутствующие переменные. Переводы строк вычищаются из
 * значений (защита .env от инъекции дополнительных переменных).
 *
 * @param {string} outputPath — корень генерируемого проекта
 * @param {object} dbConfig — объект doc.database.config из flow.json
 */
function appendMongoCredentialsToEnv(outputPath, dbConfig) {
    const credentials = [
        { envName: 'DB_USER', value: dbConfig.user },
        { envName: 'DB_PASSWORD', value: dbConfig.pass },
    ].filter(
        (entry) =>
            typeof entry.value === 'string' && entry.value.trim().replace(/[\r\n]+/g, '') !== '',
    );
    if (credentials.length === 0) {
        return;
    }
    for (const entry of credentials) {
        // Переводы строк вычищаем, иначе значение из flow.json допишет в .env
        // произвольные переменные. «=» внутри значения безопасен: парсер .env
        // режет по первому «=».
        const original = entry.value;
        entry.value = entry.value
            .trim()
            .replace(/[\r\n\0]/g, '')
            // eslint-disable-next-line no-control-regex -- управляющие символы вычищаются намеренно (защита .env)
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .replace(/"/g, '');
        // Кавычка внутри значения .env валидна (парсер снимает только окружающие
        // кавычки), но здесь она вырезается намеренно: значение переезжает и в
        // аргументы деплоя (yc), где кавычка ломает командную строку. Искажённый
        // пароль — источник трудно диагностируемого «Authentication failed»,
        // поэтому молчать нельзя: предупреждаем, что в .env попало не то, что
        // было в flow.json.
        if (entry.value !== original.trim()) {
            console.warn(
                `  ВНИМАНИЕ: значение ${entry.envName} изменено при санитизации ` +
                    '(вырезаны кавычки/управляющие символы) — оно отличается от flow.json. ' +
                    'Проверьте .env: если пароль БД содержал кавычки, подключение упадёт с ' +
                    '«Authentication failed». Измените пароль в БД либо введите значение в .env вручную.',
            );
        }
    }
    const envPath = path.join(outputPath, '.env');
    let existingNames = new Set();
    let existing = '';
    if (fs.existsSync(envPath)) {
        existing = fs.readFileSync(envPath, 'utf8');
        existingNames = new Set(
            existing
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean)
                .map((l) => l.split('=')[0]),
        );
    }
    const missing = credentials.filter((entry) => !existingNames.has(entry.envName));
    if (missing.length === 0) {
        return;
    }
    const addition =
        (existing === '' ? '' : existing.endsWith('\n') ? '' : '\n') +
        missing.map((entry) => `${entry.envName}=${entry.value}`).join('\n') +
        '\n';
    fs.appendFileSync(envPath, addition, 'utf8');
    console.warn(
        `  .env: дописаны креды MongoDB (${missing.map((e) => e.envName).join(', ')}). ` +
            'Храните их только в .env (он в .gitignore), в flow.json — лишь черновик.',
    );
}

/**
 * Записывает переменные в .env проекта, не затирая пользовательские значения.
 *
 * - файла нет — создаётся с комментарием-подсказкой;
 * - переменной нет — дописывается (в том числе с пустым значением: место для токена);
 * - переменная есть, но пустая — заполняется значением из flow.json;
 * - переменная есть и заполнена — остаётся как есть.
 *
 * @param {string} envPath — путь к .env
 * @param {{envName: string, value: string}[]} entries — переменные (значения уже санитизированы)
 * @returns {{created: boolean, added: string[], filled: string[]}} что изменено
 */
function mergeEnvFile(envPath, entries) {
    const created = !fs.existsSync(envPath);
    const lines = created
        ? [
              '# Токены платформ и другие секреты бота. Файл не коммитится (.gitignore).',
              '# Впишите значение после «=» без пробелов и кавычек: ИМЯ=значение',
          ]
        : fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    const indexByName = new Map();
    lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eq = trimmed.indexOf('=');
        const name = (eq === -1 ? trimmed : trimmed.slice(0, eq)).trim();
        if (!indexByName.has(name)) indexByName.set(name, index);
    });

    const added = [];
    const filled = [];
    for (const { envName, value } of entries) {
        if (indexByName.has(envName)) {
            const index = indexByName.get(envName);
            const line = lines[index].trim();
            const eq = line.indexOf('=');
            const current = eq === -1 ? line : line.slice(eq + 1).trim();
            if (eq !== -1 && current === '' && value !== '') {
                lines[index] = `${envName}=${value}`;
                filled.push(envName);
            }
            continue;
        }
        lines.push(`${envName}=${value}`);
        indexByName.set(envName, lines.length - 1);
        added.push(envName);
    }
    if (created || added.length > 0 || filled.length > 0) {
        fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
    }
    return { created, added, filled };
}

/**
 * Маппинг системных переменных на JavaScript выражения.
 * Системные переменные начинаются с __ и заменяются на нативный JS-код.
 */
const SYSTEM_VARS = {
    __currentTime: "new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })",
    __currentDate: "new Date().toLocaleDateString('ru-RU')",
    __currentTimestamp: 'Date.now()',
    __randomNumber: 'Math.floor(Math.random() * 101)',
    __userName: "'Пользователь'",
};

/**
 * Проверяет, является ли переменная системной (начинается на __).
 * @param {string} name — имя переменной
 * @returns {boolean} true если имя является системной переменной
 */
function isSystemVar(name) {
    return name && name.startsWith('__') && SYSTEM_VARS[name];
}

/**
 * Получает JavaScript выражение для системной переменной.
 * @param {string} name — имя системной переменной
 * @returns {string} JS-выражение (например, "new Date().toLocaleTimeString(...)")
 */
function getSystemVarExpr(name) {
    return SYSTEM_VARS[name] || name;
}

/**
 * Конвертирует текст с {{variable}} в JS template literal.
 * Порядок экранирования: \ → \\, ` → \`, ${ → \${.
 * Затем заменяет {{var}} → ${ctrl.userData.var} или системное выражение.
 * @param {string} text — текст с возможными {{variable}}
 * @returns {string} JS-выражение (одинарные кавычки или template literal)
 */
function textExpr(text) {
    if (!text) return "''";
    if (text.includes('{{')) {
        // Порядок экранирования: \ → \\, потом ` → \`, потом ${ → \${
        // После этого заменяем {{var}} → ${...} — эти ${ НЕ экранируются
        let escaped = text.replace(/\\/g, '\\\\');
        escaped = escaped.replace(/`/g, '\\`');
        escaped = escaped.replace(/\$\{/g, '\\${');
        // Убираем лишние скобки: {{{{var}}}} → {{var}} (поддерживаем и dotted-имена user.name)
        escaped = escaped.replace(/\{{4,}([\w.]+)\}{4,}/g, '{{$1}}');
        // Заменяем {{var}} на ${...} — поддерживаем как identifier, так и dotted path (user.name)
        const converted = escaped.replace(/\{\{([\w.]+)\}\}/g, (_, name) => {
            if (isSystemVar(name)) {
                return `\${${getSystemVarExpr(name)}}`;
            }
            // Переменная ещё не задана — пустая строка, а не «undefined» в тексте
            return `\${${userDataAccess(name)} ?? ''}`;
        });
        return '`' + converted + '`';
    }
    return `'${escapeStr(text)}'`;
}

function templateValueExpr(value) {
    if (typeof value === 'string') {
        return textExpr(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => templateValueExpr(item)).join(', ')}]`;
    }
    if (value && typeof value === 'object') {
        return `{ ${Object.entries(value)
            .map(([key, item]) => `${JSON.stringify(key)}: ${templateValueExpr(item)}`)
            .join(', ')} }`;
    }
    return JSON.stringify(value);
}

function httpBodyExpr(body) {
    try {
        return `JSON.stringify(${templateValueExpr(JSON.parse(String(body)))})`;
    } catch {
        return textExpr(String(body));
    }
}

/**
 * Собирает имена всех переменных из документа (saveTo, action.field, action.saveResponseTo).
 * Системные переменные (__) исключаются.
 * @param {Object} doc — FlowDocument
 * @returns {string[]} массив уникальных имён переменных
 */
function collectVarNames(doc) {
    const vars = new Set();
    for (const n of doc.nodes) {
        if (n.saveTo && !isSystemVar(n.saveTo)) vars.add(n.saveTo);
        if (n.actions)
            n.actions.forEach((a) => {
                if (a.field && !isSystemVar(a.field)) vars.add(a.field);
                if (a.saveResponseTo && !isSystemVar(a.saveResponseTo)) vars.add(a.saveResponseTo);
            });
    }
    return [...vars];
}

/**
 * Возвращает конечное число для генерации кода либо безопасное значение по умолчанию.
 * Flow — пользовательский JSON, поэтому его нельзя вставлять в TypeScript как выражение.
 * @param {unknown} value — значение границы диапазона из flow
 * @param {number} fallback — значение, используемое при некорректном вводе
 * @returns {number} безопасное конечное число
 */
function getFiniteNumber(value, fallback) {
    const numberValue = typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

/**
 * Разбирает ограниченное арифметическое выражение из flow.
 * Поддерживаются только числа, переменные сценария, системные переменные и арифметические операторы.
 * @param {string} source — выражение из действия set_variable
 * @param {string[]} varNames — известные переменные сценария
 * @returns {string|null} безопасное TypeScript-выражение или null для обычного текста
 */
function parseArithmeticExpression(source, varNames) {
    const tokens = [];
    let offset = 0;
    // Регулярное выражение заякорено и разбирает только один токен фиксированной грамматики.
    // eslint-disable-next-line security/detect-unsafe-regex -- нет вложенных повторителей и обратных ссылок.
    const tokenPattern = /^\s*(?:(\d+(?:\.\d*)?|\.\d+)|([A-Za-z_$][A-Za-z0-9_$]*)|([()+\-*/%]))/;

    while (offset < source.length) {
        const match = tokenPattern.exec(source.slice(offset));
        if (!match) return null;
        offset += match[0].length;
        if (match[1]) tokens.push({ type: 'number', value: match[1] });
        else if (match[2]) tokens.push({ type: 'name', value: match[2] });
        else tokens.push({ type: 'operator', value: match[3] });
    }

    const allowedVariables = new Set(varNames.filter((name) => isValidJSIdentifier(name)));
    let position = 0;

    const parsePrimary = () => {
        const token = tokens[position];
        if (!token) return null;
        if (token.type === 'number') {
            position += 1;
            return token.value;
        }
        if (token.type === 'name') {
            position += 1;
            if (isSystemVar(token.value)) return `(${getSystemVarExpr(token.value)})`;
            if (allowedVariables.has(token.value)) {
                // Незаданная переменная считается нулём: `cnt + 1` без инициализации даёт 1, а не NaN
                return `Number(${userDataAccess(token.value)} ?? 0)`;
            }
            return null;
        }
        if (token.value === '(') {
            position += 1;
            const expression = parseAdditive();
            if (!expression || tokens[position]?.value !== ')') return null;
            position += 1;
            return `(${expression})`;
        }
        return null;
    };

    const parseUnary = () => {
        const token = tokens[position];
        if (token?.value === '+' || token?.value === '-') {
            position += 1;
            const operand = parseUnary();
            return operand ? `${token.value}${operand}` : null;
        }
        return parsePrimary();
    };

    const parseMultiplicative = () => {
        let expression = parseUnary();
        while (expression && ['*', '/', '%'].includes(tokens[position]?.value)) {
            const operator = tokens[position].value;
            position += 1;
            const right = parseUnary();
            if (!right) return null;
            expression = `${expression} ${operator} ${right}`;
        }
        return expression;
    };

    const parseAdditive = () => {
        let expression = parseMultiplicative();
        while (expression && ['+', '-'].includes(tokens[position]?.value)) {
            const operator = tokens[position].value;
            position += 1;
            const right = parseMultiplicative();
            if (!right) return null;
            expression = `${expression} ${operator} ${right}`;
        }
        return expression;
    };

    const expression = parseAdditive();
    return expression && position === tokens.length ? expression : null;
}

/**
 * Преобразует значение set_variable в безопасное TypeScript-выражение.
 * Неподдерживаемые конструкции сохраняются как текст, а не исполняются как код.
 * @param {unknown} value — значение из flow
 * @param {string[]} varNames — известные переменные сценария
 * @returns {string} TypeScript-выражение
 */
function getSetVariableExpression(value, varNames) {
    const source = String(value).trim();
    if (source.includes('{{')) return textExpr(source);
    if (varNames.includes(source)) return userDataAccess(source);
    if (isSystemVar(source)) return `(${getSystemVarExpr(source)})`;

    const numericValue = getFiniteNumber(source, Number.NaN);
    if (source && Number.isFinite(numericValue)) {
        return String(numericValue);
    }

    return parseArithmeticExpression(source, varNames) || `'${escapeStr(source)}'`;
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/**
 * Возвращает разрешённый HTTP-метод. Неизвестный метод нельзя вставлять в исходный код.
 * @param {unknown} value — метод из flow
 * @returns {string} разрешённый HTTP-метод
 */
function getHttpMethod(value) {
    const method = String(value || 'GET').toUpperCase();
    return HTTP_METHODS.has(method) ? method : 'GET';
}

/**
 * Генерирует код для блока действия (random_number, set_variable, http_request).
 * @param {Object} block — блок действия из FlowDocument
 * @param {string[]} varNames — имена переменных для ограниченных выражений
 * @param {string} indent — отступ (обязателен; вызовы используют 4 пробела)
 * @returns {string[]} массив строк кода
 */
function generateActionFunc(block, varNames, indent) {
    const lines = [];
    switch (block.type) {
        case 'random_number':
            // Пропускаем если имя переменной пустое или содержит только пробелы
            if (block.field && block.field.trim()) {
                const min = getFiniteNumber(block.min, 1);
                const max = getFiniteNumber(block.max, 10);
                lines.push(`${indent}${userDataAccess(block.field)} = rand(${min}, ${max});`);
            }
            break;
        case 'set_variable':
            // Пропускаем если имя переменной пустое или значение пустое
            if (block.field && block.field.trim() && String(block.value ?? '').trim()) {
                const expr = getSetVariableExpression(block.value, varNames);
                lines.push(`${indent}${userDataAccess(block.field)} = ${expr};`);
            }
            break;
        case 'http_request':
            if (block.url) {
                const method = getHttpMethod(block.method);
                let safeHeaders = null;
                if (block.headers && block.headers !== '{}') {
                    try {
                        safeHeaders = JSON.stringify(JSON.parse(block.headers));
                    } catch {
                        safeHeaders = '{}';
                    }
                }
                // Обрабатываем body как строку или объект
                let body = block.body;
                if (body && typeof body === 'object') {
                    body = JSON.stringify(body);
                }
                body = body && body !== '{}' ? body : null;

                lines.push(`${indent}try {`);
                if (method !== 'GET' && body) {
                    const fetchOpts = [`method: '${method}'`];
                    if (safeHeaders) {
                        fetchOpts.push(`headers: ${safeHeaders}`);
                    } else {
                        fetchOpts.push(`headers: { 'Content-Type': 'application/json' }`);
                    }
                    fetchOpts.push(`body: ${httpBodyExpr(body)}`);
                    lines.push(
                        `${indent}    const response = await fetchWithTimeout('${escapeStr(block.url)}', { ${fetchOpts.join(', ')} });`,
                    );
                } else {
                    // Запрос без body: метод всё равно нужен для POST/PUT/PATCH/DELETE.
                    const fetchOpts = [];
                    if (method !== 'GET') {
                        fetchOpts.push(`method: '${method}'`);
                    }
                    if (safeHeaders) {
                        fetchOpts.push(`headers: ${safeHeaders}`);
                    }
                    const optsStr = fetchOpts.length > 0 ? `, { ${fetchOpts.join(', ')} }` : '';
                    lines.push(
                        `${indent}    const response = await fetchWithTimeout('${escapeStr(block.url)}'${optsStr});`,
                    );
                }
                lines.push(
                    `${indent}    if (!response.ok) throw new Error(\`HTTP \${response.status}\`);`,
                );
                lines.push(`${indent}    const responseText = await response.text();`);
                lines.push(`${indent}    let data: unknown = null;`);
                lines.push(`${indent}    if (responseText.trim()) {`);
                lines.push(`${indent}        try {`);
                lines.push(`${indent}            data = JSON.parse(responseText);`);
                lines.push(`${indent}        } catch {`);
                lines.push(`${indent}            data = responseText;`);
                lines.push(`${indent}        }`);
                lines.push(`${indent}    }`);
                if (block.saveResponseTo) {
                    lines.push(`${indent}    ${userDataAccess(block.saveResponseTo)} = data;`);
                }
                lines.push(`${indent}} catch (e) {`);
                lines.push(
                    `${indent}    const errorMessage = e instanceof Error ? e.message : String(e);`,
                );
                lines.push(`${indent}    setText(ctrl, \`Ошибка запроса: \${errorMessage}\`);`);
                lines.push(`${indent}}`);
            }
            break;
    }
    return lines;
}

/**
 * Генерирует код условия (if/else) с поддержкой всех операторов.
 * @param {Object} cond — условие из FlowDocument
 * @param {string[]} varNames — имена переменных
 * @param {string} indent — отступ
 * @param {string|null} trueFuncName — имя функции для ветки true (или null для inline)
 * @param {string|null} falseFuncName — имя функции для ветки false (или null)
 * @param {string|null} trueNavigation — thisIntentName для ветки true (step/command)
 * @param {string|null} falseNavigation — thisIntentName для ветки false (step/command)
 * @param {Object} doc — полный FlowDocument
 * @param {Array} connectedBlocks — связанные блоки (для проверки async)
 * @returns {string[]} массив строк if/else кода
 */
function generateConditionFunc(
    cond,
    varNames,
    indent,
    trueFuncName,
    falseFuncName,
    trueNavigation,
    falseNavigation,
    doc,
    connectedBlocks,
) {
    const lines = [];
    // Очищаем имя переменной от {{ }} если они есть (VariablePicker вставляет {{var}})
    let varName = String(cond.variable ?? '');
    if (varName.startsWith('{{') && varName.endsWith('}}')) {
        varName = varName.slice(2, -2);
    }
    // Пропускаем пустые условия — генерация невалидного кода
    const supportsUserCommand = ['isSayTrue', 'isSayFalse', 'isUrl'].includes(cond.operator);
    if (!varName && !supportsUserCommand) {
        return [];
    }
    const condVar = varName ? userDataAccess(varName) : "ctrl.userCommand ?? ''";
    // Значение как строка: незаданная переменная — '', число 0 — '0' (не «пусто»)
    const asString = (expr) =>
        String(expr).startsWith('ctrl.userData') ? `String(${expr} ?? '')` : `String(${expr})`;
    let condVal;

    // Очищаем значение от {{ }} если они есть (VariablePicker вставляет {{var}})
    let rawValue = String(cond.value ?? '');
    if (rawValue.startsWith('{{') && rawValue.endsWith('}}')) {
        rawValue = rawValue.slice(2, -2);
    }

    // Для contains и isEmpty значение всегда как строка
    if (cond.operator === 'contains' || cond.operator === 'isEmpty') {
        // Если значение — переменная, резолвим как ctrl.userData
        if (rawValue && varNames.includes(rawValue)) {
            condVal = userDataAccess(rawValue);
        } else {
            // Если значение число, не оборачиваем в String() в условии
            const isNum = !isNaN(Number(rawValue)) && rawValue.trim() !== '';
            condVal = isNum ? rawValue : `'${escapeStr(rawValue)}'`;
        }
    } else if (rawValue && varNames.includes(rawValue)) {
        condVal = userDataAccess(rawValue);
    } else if (rawValue.trim() === '') {
        // Пустое значение — сравниваем с пустой строкой
        condVal = "''";
    } else {
        const numVal = Number(rawValue);
        condVal = isNaN(numVal) ? `'${escapeStr(rawValue)}'` : numVal;
    }

    // Генерируем выражение if
    let ifExpr;
    switch (cond.operator) {
        // Строгое === ломало сравнение ввода с числом: шаг сохраняет строку '42',
        // rand/числовой литерал — число 42. isEqual сравнивает значения как строки.
        case 'eq':
            ifExpr = `isEqual(${condVar}, ${condVal})`;
            break;
        case 'neq':
            ifExpr = `!isEqual(${condVar}, ${condVal})`;
            break;
        case 'gt':
            ifExpr = `Number(${condVar}) > Number(${condVal})`;
            break;
        case 'gte':
            ifExpr = `Number(${condVar}) >= Number(${condVal})`;
            break;
        case 'lt':
            ifExpr = `Number(${condVar}) < Number(${condVal})`;
            break;
        case 'lte':
            ifExpr = `Number(${condVar}) <= Number(${condVal})`;
            break;
        case 'contains': {
            // String() обязателен для любого значения: includes() принимает только
            // строки, и числовой литерал без обёртки не компилируется TypeScript.
            ifExpr = `${asString(condVar)}.includes(${asString(condVal)})`;
            break;
        }
        case 'isEmpty':
            ifExpr = `${asString(condVar)} === ''`;
            break;
        case 'isNotEmpty':
            ifExpr = `${asString(condVar)} !== ''`;
            break;
        case 'isSayTrue':
            // Если указана переменная — используем её, иначе userCommand
            ifExpr = varName
                ? `Text.isSayTrue(${asString(condVar)})`
                : `Text.isSayTrue(ctrl.userCommand || '')`;
            break;
        case 'isSayFalse':
            ifExpr = varName
                ? `Text.isSayFalse(${asString(condVar)})`
                : `Text.isSayFalse(ctrl.userCommand || '')`;
            break;
        case 'isUrl':
            ifExpr = varName
                ? `Text.isUrl(${asString(condVar)})`
                : `Text.isUrl(ctrl.userCommand || '')`;
            break;
        default:
            ifExpr = `isEqual(${condVar}, ${condVal})`;
    }
    lines.push(`${indent}if (${ifExpr}) {`);
    // Вставляем вызов true функции, навигацию или responseTrue
    if (trueFuncName) {
        // Проверяем, нужен ли await для целевой функции
        let trueAwait = '';
        if (doc && connectedBlocks) {
            const trueNode = doc.nodes.find((n) => getBlockFunctionName(n) === trueFuncName);
            if (trueNode && blockNeedsAsync(trueNode, doc, connectedBlocks)) {
                trueAwait = 'await ';
            }
        }
        lines.push(`${indent}    ${trueAwait}${trueFuncName}(ctrl);`);
    } else if (trueNavigation) {
        lines.push(`${indent}    ${trueNavigation};`);
    } else if (cond.responseTrue) {
        if (cond.responseTrue.text)
            lines.push(`${indent}    setText(ctrl, ${textExpr(cond.responseTrue.text)});`);
        if (cond.responseTrue.buttons) {
            for (const btn of cond.responseTrue.buttons) {
                lines.push(`${indent}    ${addBtnExpr(btn.title, getButtonActionName(doc, btn))};`);
            }
        }
    }
    lines.push(`${indent}} else {`);
    // Вставляем вызов false функции, навигацию или responseFalse
    if (falseFuncName) {
        // Проверяем, нужен ли await для целевой функции
        let falseAwait = '';
        if (doc && connectedBlocks) {
            const falseNode = doc.nodes.find((n) => getBlockFunctionName(n) === falseFuncName);
            if (falseNode && blockNeedsAsync(falseNode, doc, connectedBlocks)) {
                falseAwait = 'await ';
            }
        }
        lines.push(`${indent}    ${falseAwait}${falseFuncName}(ctrl);`);
    } else if (falseNavigation) {
        lines.push(`${indent}    ${falseNavigation};`);
    } else if (cond.responseFalse) {
        if (cond.responseFalse.text)
            lines.push(`${indent}    setText(ctrl, ${textExpr(cond.responseFalse.text)});`);
        if (cond.responseFalse.buttons) {
            for (const btn of cond.responseFalse.buttons) {
                lines.push(`${indent}    ${addBtnExpr(btn.title, getButtonActionName(doc, btn))};`);
            }
        }
    }
    lines.push(`${indent}}`);
    return lines;
}

/**
 * Генерирует код кнопок (addBtn/addLink) с опциональным перемешиванием.
 * @param {Array} buttons — массив кнопок FlowButton
 * @param {string} indent — отступ
 * @param {boolean} shuffle — включить случайный порядок кнопок
 * @param {Object} [doc] — FlowDocument (для кнопок с блоком-целью)
 * @returns {string[]} массив строк кода
 */
function generateButtonCode(buttons, indent, shuffle = false, doc = null) {
    const lines = [];
    const validButtons = (buttons || []).filter((btn) => btn.title && btn.title.trim());

    if (validButtons.length === 0) return lines;

    // Если включен рандомный порядок — генерируем массив и перемешиваем в отдельном scope
    if (shuffle && validButtons.length > 1) {
        lines.push(`${indent}// Случайный порядок кнопок`);
        lines.push(`${indent}{`);
        lines.push(`${indent}    const __buttons = [`);
        for (const btn of validButtons) {
            if (btn.type === 'link') {
                lines.push(
                    `${indent}    { type: 'link', title: ${textExpr(btn.title)}, url: ${textExpr(btn.url || '')}, action: '' },`,
                );
            } else {
                const actionName = getButtonActionName(doc, btn);
                lines.push(
                    `${indent}    { type: 'action', title: ${textExpr(btn.title)}, url: '', action: '${escapeStr(actionName || '')}' },`,
                );
            }
        }
        lines.push(`${indent}];`);
        lines.push(
            `${indent}for (let i = __buttons.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [__buttons[i], __buttons[j]] = [__buttons[j], __buttons[i]]; }`,
        );
        lines.push(`${indent}for (const __btn of __buttons) {`);
        lines.push(
            `${indent}    if (__btn.type === 'link') ctrl.buttons.addLink(__btn.title, __btn.url ?? '');`,
        );
        lines.push(
            `${indent}    else ctrl.buttons.addBtn(__btn.title, '', __btn.action ? { command: __btn.action } : '', { inline: true });`,
        );
        lines.push(`${indent}}`);
        lines.push(`${indent}}`);
    } else {
        // Обычный порядок
        for (const btn of validButtons) {
            if (btn.type === 'link') {
                lines.push(
                    `${indent}ctrl.buttons.addLink(${textExpr(btn.title)}, ${textExpr(btn.url || '')});`,
                );
            } else {
                lines.push(`${indent}${addBtnExpr(btn.title, getButtonActionName(doc, btn))};`);
            }
        }
    }
    return lines;
}

/**
 * Рекурсивно проверяет, нужен ли async для блока (HTTP в нём или в связанных блоках).
 * @param {Object} block — проверяемый блок
 * @param {Object} doc — FlowDocument
 * @param {Array} connectedBlocks — связанные блоки
 * @param {Set} visited — посещённые блоки (защита от циклов)
 * @returns {boolean} true если блок или его цепочка требуют async
 */
function blockNeedsAsync(block, doc, connectedBlocks, visited = new Set()) {
    if (visited.has(block.id)) return false;
    visited.add(block.id);
    if ((block.actions || []).some((a) => a.type === 'http_request')) return true;
    const outgoing = findOutgoingBlocks(doc, block.id, connectedBlocks);
    return outgoing.some((b) => blockNeedsAsync(b, doc, connectedBlocks, visited));
}

/**
 * Находит связанные outgoing блоки (next, branch_true, branch_false) для узла.
 * @param {Object} doc — FlowDocument
 * @param {string} nodeId — ID исходного узла
 * @param {Array} connectedBlocks — массив связанных блоков
 * @returns {Array} массив outgoing блоков
 */
function findOutgoingBlocks(doc, nodeId, connectedBlocks) {
    return connectedBlocks.filter((b) =>
        doc.edges.some(
            (e) =>
                e.from === nodeId &&
                e.to === b.id &&
                (e.type === 'next' || e.type === 'branch_true' || e.type === 'branch_false'),
        ),
    );
}

/**
 * Генерирует вызовы outgoing блоков с учётом async (для HTTP-действий).
 * @param {Array} blocks — массив outgoing блоков
 * @param {string} indent — отступ
 * @param {Object} doc — полный FlowDocument
 * @param {Array} connectedBlocks — связанные блоки (для проверки async)
 * @returns {string[]} массив строк вызовов __name(ctrl)
 */
function generateOutgoingBlockCalls(blocks, indent, doc, connectedBlocks) {
    const lines = [];
    for (const block of blocks) {
        const needsAsync = blockNeedsAsync(block, doc, connectedBlocks);
        lines.push(`${indent}${needsAsync ? 'await ' : ''}${getBlockFunctionName(block)}(ctrl);`);
    }
    return lines;
}

/**
 * Проверяет, есть ли среди outgoing блоков те, которые предоставляют текст.
 * @param {Array} blocks — массив outgoing блоков
 * @returns {boolean} true если хотя бы один блок имеет text или response.text
 */
function hasTextFromBlocks(blocks) {
    return blocks.some((b) => b.text || (b.response && b.response.text));
}

/**
 * Генерирует код карточки/галереи (ctrl.card.addImage).
 * @param {Object} card — объект FlowCard с массивом images
 * @param {string} indent — отступ
 * @returns {string[]} массив строк кода
 */
function generateCardCode(card, indent, doc = null) {
    const lines = [];
    if (!card || !Array.isArray(card.images) || card.images.length === 0) return lines;
    if (card.title) lines.push(`${indent}ctrl.card.title = ${textExpr(card.title)};`);
    // single — одна карточка, gallery — галерея, list — список (по умолчанию)
    if (card.type === 'single') lines.push(`${indent}ctrl.card.isOne = true;`);
    if (card.type === 'gallery') lines.push(`${indent}ctrl.card.isUsedGallery = true;`);
    for (const img of card.images) {
        const args = [
            textExpr(img.src || ''),
            textExpr(img.title || ''),
            textExpr(img.description || ''),
        ];
        if (img.button && String(img.button.title || '').trim()) {
            const actionName = getButtonActionName(doc, img.button);
            args.push(
                `{ title: ${textExpr(img.button.title)}${actionName ? `, payload: { command: '${escapeStr(actionName)}' }` : ''}, options: { inline: true } }`,
            );
        }
        lines.push(`${indent}ctrl.card.addImage(${args.join(', ')});`);
    }
    return lines;
}

/**
 * Генерирует функцию __name(ctrl) для standalone блока (action/condition/response).
 * @param {Object} block — блок из FlowDocument
 * @param {string[]} varNames — имена переменных
 * @param {string} indent — отступ
 * @param {Object} doc — полный FlowDocument
 * @param {Array} connectedBlocks — связанные блоки
 * @returns {string[]} массив строк кода функции
 */
function generateBlockFunc(block, varNames, indent, doc, connectedBlocks) {
    const lines = [];
    const funcName = getBlockFunctionName(block);

    if (block.type === 'action') {
        // Комментарий: описание действия
        const actionTypes = (block.actions || [])
            .map((a) => {
                switch (a.type) {
                    case 'set_variable':
                        return `установить переменную ${a.field}`;
                    case 'random_number':
                        return `сгенерировать случайное число в ${a.field}`;
                    case 'http_request':
                        return `HTTP-запрос к ${a.url || 'URL'}`;
                    default:
                        return a.type;
                }
            })
            .join(', ');
        const hasHttp = blockNeedsAsync(block, doc, connectedBlocks);
        lines.push(`/** Действие: ${escapeComment(actionTypes || 'выполнить действие')} */`);
        lines.push(
            `${hasHttp ? 'async ' : ''}function ${funcName}(ctrl: BotController): ${hasHttp ? 'Promise<void>' : 'void'} {`,
        );
        if (block.actions) {
            for (const action of block.actions) {
                lines.push(...generateActionFunc(action, varNames, indent));
            }
        }
        // Текст действия
        if (block.text) {
            lines.push(`${indent}setText(ctrl, ${textExpr(block.text)});`);
        }
        if (block.buttons && block.buttons.length > 0) {
            lines.push(...generateButtonCode(block.buttons, indent, false, doc));
        }
        lines.push(...generateCardCode(block.card, indent, doc));

        // Вызов связанных блоков (response/action) и навигация
        const actionOutgoingBlocks = findOutgoingBlocks(doc, block.id, connectedBlocks);
        lines.push(
            ...generateOutgoingBlockCalls(actionOutgoingBlocks, '    ', doc, connectedBlocks),
        );

        // Навигация к следующему step/command
        const nextStep = findNextNonBlockNode(doc, block.id);
        if (nextStep && actionOutgoingBlocks.length === 0) {
            lines.push(`    ctrl.thisIntentName = '${escapeStr(nextStep.name)}';`);
        }

        lines.push(`}`);
    } else if (block.type === 'condition') {
        // Комментарий: описание условия
        const opNames = {
            eq: 'равно',
            neq: 'не равно',
            gt: 'больше',
            gte: 'больше или равно',
            lt: 'меньше',
            lte: 'меньше или равно',
            contains: 'содержит',
            isEmpty: 'пусто',
            isSayTrue: 'согласие',
            isSayFalse: 'отрицание',
            isUrl: 'ссылка',
        };
        const opName = opNames[block.operator] || block.operator;
        lines.push(
            `/** Условие: проверяем ${escapeComment(block.variable || 'ввод пользователя')} ${escapeComment(opName)} ${escapeComment(block.value || '')} */`,
        );
        const condNeedsAsync = blockNeedsAsync(block, doc, connectedBlocks);
        lines.push(
            `${condNeedsAsync ? 'async ' : ''}function ${funcName}(ctrl: BotController): ${condNeedsAsync ? 'Promise<void>' : 'void'} {`,
        );

        // Ищем response функции для branch_true и branch_false
        let trueFuncName = null;
        let falseFuncName = null;
        let trueNavigation = null;
        let falseNavigation = null;

        const trueEdge = doc.edges.find((e) => e.from === block.id && e.type === 'branch_true');
        const falseEdge = doc.edges.find((e) => e.from === block.id && e.type === 'branch_false');

        if (trueEdge) {
            const trueNode = doc.nodes.find((n) => n.id === trueEdge.to);
            if (trueNode) {
                if (trueNode.type === 'step' || trueNode.type === 'command') {
                    // Step/command генерируются через addStep/addCommand, вызываются через thisIntentName
                    trueNavigation = `ctrl.thisIntentName = '${escapeStr(trueNode.name || trueNode.id)}'`;
                } else if (
                    trueNode.type === 'response' ||
                    trueNode.type === 'action' ||
                    trueNode.type === 'condition'
                ) {
                    trueFuncName = getBlockFunctionName(trueNode);
                }
            }
        }

        if (falseEdge) {
            const falseNode = doc.nodes.find((n) => n.id === falseEdge.to);
            if (falseNode) {
                if (falseNode.type === 'step' || falseNode.type === 'command') {
                    falseNavigation = `ctrl.thisIntentName = '${escapeStr(falseNode.name || falseNode.id)}'`;
                } else if (
                    falseNode.type === 'response' ||
                    falseNode.type === 'action' ||
                    falseNode.type === 'condition'
                ) {
                    falseFuncName = getBlockFunctionName(falseNode);
                }
            }
        }

        lines.push(
            ...generateConditionFunc(
                block,
                varNames,
                indent,
                trueFuncName,
                falseFuncName,
                trueNavigation,
                falseNavigation,
                doc,
                connectedBlocks,
            ),
        );
        lines.push(`}`);
    } else if (block.type === 'response') {
        // Комментарий: описание ответа
        const responsePreview = block.response?.text
            ? block.response.text.slice(0, 50)
            : 'пустой ответ';
        lines.push(
            `/** Ответ: "${escapeComment(responsePreview)}${block.response?.text?.length > 50 ? '...' : ''}" */`,
        );
        const respNeedsAsync = blockNeedsAsync(block, doc, connectedBlocks);
        lines.push(
            `${respNeedsAsync ? 'async ' : ''}function ${funcName}(ctrl: BotController): ${respNeedsAsync ? 'Promise<void>' : 'void'} {`,
        );
        if (block.response) {
            if (block.response.text)
                lines.push(`${indent}setText(ctrl, ${textExpr(block.response.text)});`);
            if (block.response.tts)
                lines.push(`${indent}setTTS(ctrl, ${textExpr(block.response.tts)});`);
            lines.push(
                ...generateButtonCode(
                    block.response.buttons,
                    indent,
                    block.response.shuffleButtons,
                    doc,
                ),
            );
            lines.push(...generateCardCode(block.response.card, indent, doc));
            if (block.response.emotion) {
                lines.push(`${indent}ctrl.emotion = '${escapeStr(block.response.emotion)}';`);
            }
            // Завершение диалога задано на самом блоке — как у команды
            if (block.response.isEnd) lines.push(`${indent}ctrl.isEnd = true;`);
        }

        // Вызов связанных блоков (response/action) и навигация
        const responseOutgoingBlocks = findOutgoingBlocks(doc, block.id, connectedBlocks);
        lines.push(
            ...generateOutgoingBlockCalls(responseOutgoingBlocks, '    ', doc, connectedBlocks),
        );

        // Навигация к следующему step/command (только если нет connected блоков)
        if (responseOutgoingBlocks.length === 0) {
            const nextStep = findNextNonBlockNode(doc, block.id);
            if (nextStep) {
                lines.push(`    ctrl.thisIntentName = '${escapeStr(nextStep.name)}';`);
            }
        }

        lines.push(`}`);
    }
    return lines;
}

/**
 * Ищет следующую command/step ноду в цепочке, пропуская action/condition/response.
 * Защита от бесконечного цикла: лимит 20 шагов.
 * @param {Object} doc — FlowDocument
 * @param {string} fromId — ID ноды, с которой начинаем поиск
 * @returns {Object|null} найденная нода или null
 */
function findNextNonBlockNode(doc, fromId) {
    let currentId = fromId;
    let safety = 0;
    while (currentId && safety < 20) {
        safety++;
        const edge = doc.edges.find((e) => e.from === currentId && e.type === 'next');
        if (!edge) return null;
        const nextNode = doc.nodes.find((n) => n.id === edge.to);
        if (!nextNode) return null;
        // Если следующий узел — command или step, возвращаем его
        if (nextNode.type === 'command' || nextNode.type === 'step') {
            return nextNode;
        }
        // Иначе идём дальше по цепочке
        currentId = nextNode.id;
    }
    return null;
}

/**
 * Главная функция генерации. Создаёт полный src/index.ts из FlowDocument.
 * @param {Object} doc — FlowDocument с узлами, рёбрами и настройками
 * @param {boolean} [useCloud=false] — генерировать Yandex Cloud Function handler вместо bot.start()
 * @param {string} [outputPath='.'] — корень генерируемого проекта (для переноса Mongo-кредов в .env)
 * @returns {string} содержимое src/index.ts
 */
/** Операторы условий, для которых генерируется не isEqual, а собственное выражение. */
const NON_EQUALITY_OPERATORS = new Set([
    'gt',
    'gte',
    'lt',
    'lte',
    'contains',
    'isEmpty',
    'isNotEmpty',
    'isSayTrue',
    'isSayFalse',
    'isUrl',
]);

/**
 * Есть ли в документе условие, которое генерируется через isEqual
 * (eq, neq и неизвестный оператор; условие без переменной не генерируется).
 * @param {Object} doc — FlowDocument
 * @returns {boolean} true, если нужен импорт isEqual
 */
function usesEqualityCondition(doc) {
    const isEquality = (cond) =>
        !!cond && String(cond.variable ?? '') !== '' && !NON_EQUALITY_OPERATORS.has(cond.operator);
    return (doc.nodes || []).some(
        (n) =>
            n &&
            ((n.type === 'condition' && isEquality(n)) ||
                (Array.isArray(n.conditions) && n.conditions.some(isEquality))),
    );
}

function generateIndexTs(doc, useCloud = false, outputPath = '.') {
    const lines = [];
    const varNames = collectVarNames(doc);

    // Кнопки с блоком-целью: действие [go:N] на каждую цель
    const buttonActions = collectButtonActions(doc);
    const buttonTargetIds = new Set([...buttonActions.values()].map((a) => a.target.id));

    // Собираем все связанные блоки (action/condition/response)
    const connectedBlocks = [];
    for (const node of doc.nodes) {
        if (node.type === 'action' || node.type === 'condition' || node.type === 'response') {
            // Входящая связь или кнопка, ведущая на блок
            const hasIncoming =
                doc.edges.some((e) => e.to === node.id) || buttonTargetIds.has(node.id);
            if (hasIncoming) {
                connectedBlocks.push(node);
            }
        }
    }
    assignBlockFunctionNames(connectedBlocks);

    // Команды и шаги, на которые ведут кнопки, генерируются именованными функциями —
    // их вызывает и регистрация (addCommand/addStep), и действие кнопки
    const handlerNames = new Map();
    const usedHandlerNames = new Set(connectedBlocks.map((b) => getBlockFunctionName(b)));
    const reserveHandlerName = (base) => {
        let name = base;
        for (let i = 2; usedHandlerNames.has(name); i++) name = `${base}_${i}`;
        usedHandlerNames.add(name);
        return name;
    };
    const handlerBaseName = (node) => {
        let safeName = String(node.name || node.id).replace(/[^a-zA-Z0-9_$]/g, '_');
        if (!/^[a-zA-Z_$]/.test(safeName)) safeName = `_${safeName}`;
        return `__${node.type === 'command' ? 'cmd' : 'step'}_${safeName}`;
    };
    const welcomeNode = findRoleCommand(doc, 'welcome');
    for (const node of doc.nodes) {
        // Приветствие тоже именованная функция: его вызывает fallback в начале диалога
        const isNamed = buttonTargetIds.has(node.id) || node === welcomeNode;
        if (!isNamed || (node.type !== 'command' && node.type !== 'step')) {
            continue;
        }
        handlerNames.set(node.id, reserveHandlerName(handlerBaseName(node)));
    }

    // Без ноды welcome/help приветствие и справка берутся из настроек бота.
    // Стандартные интенты не используются (intents: [] ниже), поэтому тексты
    // регистрируются обычными командами — как их показывает превью редактора.
    const settingsWelcome = getSettingsWelcome(doc);
    const settingsHelpText = getSettingsHelpText(doc);
    const commandNeedsAsync = (cmd) =>
        (cmd.actions || []).some((a) => a.type === 'http_request') ||
        blockNeedsAsync(cmd, doc, connectedBlocks);
    let welcomeHandlerName = null;
    let welcomeIsAsync = false;
    if (welcomeNode) {
        welcomeHandlerName = handlerNames.get(welcomeNode.id);
        welcomeIsAsync = commandNeedsAsync(welcomeNode);
    } else if (settingsWelcome) {
        welcomeHandlerName = reserveHandlerName('__cmd_welcome');
    }
    // Начало диалога: новая сессия Алисы/Маруси, «Начать» в MAX/Viber. Рантайм отдаёт
    // такой запрос fallback-команде (она важнее welcome), поэтому fallback вызывает приветствие.
    const startWelcomeLines = (indent) =>
        welcomeHandlerName
            ? [
                  `${indent}// Начало диалога (новая сессия голосового ассистента, «Начать»): приветствие, а не «не понял»`,
                  `${indent}if (ctrl.messageId === 0) {`,
                  `${indent}    return ${welcomeHandlerName}(cmd, ctrl);`,
                  `${indent}}`,
              ]
            : [];

    const needsRand =
        doc.nodes.some((n) => n.actions && n.actions.some((a) => a.type === 'random_number')) ||
        connectedBlocks.some((n) => n.actions && n.actions.some((a) => a.type === 'random_number'));
    // Проверяем, нужны ли Text методы (для условий с isSayTrue, isSayFalse, isUrl)
    const needsTextMethods = (conds) => {
        if (!conds) return false;
        return conds.some((c) => ['isSayTrue', 'isSayFalse', 'isUrl'].includes(c.operator));
    };
    const needsText =
        doc.nodes.some((n) => needsTextMethods(n.conditions)) ||
        connectedBlocks.some((n) => needsTextMethods(n.conditions)) ||
        doc.nodes.some((n) => n.type === 'command' && needsTextMethods(n.conditions)) ||
        doc.nodes.some((n) => n.type === 'step' && needsTextMethods(n.conditions)) ||
        doc.nodes.some(
            (n) =>
                n.type === 'condition' && ['isSayTrue', 'isSayFalse', 'isUrl'].includes(n.operator),
        );
    const needsHttp =
        doc.nodes.some((n) => (n.actions || []).some((a) => a.type === 'http_request')) ||
        connectedBlocks.some((n) => (n.actions || []).some((a) => a.type === 'http_request'));

    // Импорты
    const umbotImports = ['Bot', 'BotController', 'FALLBACK_COMMAND'];
    // Проверяем есть ли welcome/help команды — импортируем константы
    const welcomeCommands = doc.nodes.filter(
        (n) => n.type === 'command' && (n.name === 'welcome' || n.role === 'welcome'),
    );
    const hasWelcome = welcomeCommands.length > 0 || !!settingsWelcome;
    const hasHelp = !!findRoleCommand(doc, 'help') || !!settingsHelpText;
    const needsWelcomeSlots =
        !!settingsWelcome ||
        welcomeCommands.some((n) => !(n.slots || []).some((s) => s && s !== START_SLOT));
    if (hasWelcome) umbotImports.push('WELCOME_INTENT_NAME');
    if (needsWelcomeSlots) umbotImports.push('WELCOME_INTENT_SLOTS');
    if (hasHelp) umbotImports.push('HELP_INTENT_NAME');
    if (settingsHelpText) umbotImports.push('HELP_INTENT_SLOTS');
    if (needsText) umbotImports.push('Text');
    lines.push(`import { ${umbotImports.join(', ')} } from 'umbot';`);

    // Проверяем нужны ли setText/setTTS
    const needsTTS =
        doc.nodes.some((n) => {
            if (n.type === 'command' && n.response?.tts) return true;
            if (n.type === 'step' && n.prompt?.tts) return true;
            if (n.type === 'response' && n.response?.tts) return true;
            return false;
        }) ||
        connectedBlocks.some((n) => {
            if (n.response?.tts) return true;
            if (n.prompt?.tts) return true;
            return false;
        });
    const utilsImports = ['setText'];
    if (needsTTS) utilsImports.push('setTTS');
    if (usesEqualityCondition(doc)) utilsImports.push('isEqual');
    if (needsHttp) utilsImports.push('fetchWithTimeout');
    lines.push(`import { ${utilsImports.join(', ')} } from './utils';`);

    // Обработка платформ
    const platforms = doc.platforms || [];
    const ALL_PLATFORMS = ['alisa', 'telegram', 'vk', 'marusia', 'max_app', 'viber', 'smart_app'];
    const VOICE_PLATFORMS = ['alisa', 'marusia', 'smart_app'];
    const CHAT_PLATFORMS = ['telegram', 'vk', 'max_app', 'viber'];

    // Маппинг платформ на адаптеры
    const PLATFORM_ADAPTERS = {
        alisa: 'AlisaAdapter',
        telegram: 'TelegramAdapter',
        vk: 'VkAdapter',
        marusia: 'MarusiaAdapter',
        max_app: 'MaxAdapter',
        viber: 'ViberAdapter',
        smart_app: 'SmartAppAdapter',
    };

    // Определяем, какие платформы подключать
    const allSelected = platforms.length === 0 || platforms.length === ALL_PLATFORMS.length;
    const voiceOnly = platforms.length > 0 && platforms.every((p) => VOICE_PLATFORMS.includes(p));
    const chatOnly = platforms.length > 0 && platforms.every((p) => CHAT_PLATFORMS.includes(p));

    if (allSelected) {
        lines.push(`import { fullPlatforms } from 'umbot/plugins';`);
    } else if (voiceOnly) {
        lines.push(`import { voicePlatforms } from 'umbot/plugins';`);
    } else if (chatOnly) {
        lines.push(`import { botPlatforms } from 'umbot/plugins';`);
    } else {
        // Импортируем только выбранные адаптеры
        const adapterNames = platforms.map((p) => PLATFORM_ADAPTERS[p]).filter(Boolean);
        if (adapterNames.length > 0) {
            lines.push(`import { ${adapterNames.join(', ')} } from 'umbot/plugins';`);
        }
    }

    if (doc.database && doc.database.type === 'file') {
        lines.push(`import { FileAdapter } from 'umbot/plugins';`);
    } else if (doc.database && doc.database.type === 'mongo') {
        lines.push(`import { MongoAdapter } from 'umbot/plugins';`);
    }
    if (needsRand) lines.push(`import { rand } from 'umbot/utils';`);
    // Text уже импортируется из umbot, не нужен отдельный импорт из umbot/utils

    lines.push(``);
    lines.push(`const bot = new Bot();`);
    // Режим из настроек бота: без вызова приложение работает в dev
    // (подробные логи и отладочная информация доступны по URL вебхука)
    if (APP_MODES.has(doc.mode)) {
        lines.push(`bot.setAppMode('${doc.mode}');`);
    }
    lines.push(``);

    // Регистрация платформ
    if (allSelected) {
        lines.push(`bot.use(fullPlatforms);`);
    } else if (voiceOnly) {
        lines.push(`bot.use(voicePlatforms);`);
    } else if (chatOnly) {
        lines.push(`bot.use(botPlatforms);`);
    } else {
        // Регистрируем только выбранные адаптеры
        const adapterNames = platforms.map((p) => PLATFORM_ADAPTERS[p]).filter(Boolean);
        for (const name of adapterNames) {
            lines.push(`bot.use(new ${name}());`);
        }
    }
    lines.push(``);

    if (doc.database && doc.database.type === 'file') {
        lines.push(`bot.use(new FileAdapter());`);
    } else if (doc.database && doc.database.type === 'mongo') {
        const dbConfig = doc.database.config || {};
        const dbHost = escapeStr(dbConfig.host || 'localhost');
        const dbName = escapeStr(dbConfig.database || 'bot_db');
        // user/pass MongoAdapter читает из DB_USER/DB_PASSWORD (env), литералами
        // в коммит-файл их писать нельзя — переносим в .env вместе с токенами
        // (в create-ветке CLI тот же сценарий — см. ConsoleController).
        appendMongoCredentialsToEnv(outputPath, dbConfig);
        lines.push(`bot.use(new MongoAdapter({ host: '${dbHost}', database: '${dbName}' }));`);
    }
    lines.push(``);

    // .env генерируется всегда (с пустыми переменными токенов, если в flow.json их нет) —
    // рантайм обязан его читать: без env в setAppConfig ядро в тихом режиме берёт только
    // process.env, и токен, вписанный пользователем в .env вручную, не действовал.
    // serverless-деплой не задет: .env в архив не попадает, при отсутствии файла
    // переменные облака приходят через process.env тем же конвейером.
    lines.push(`bot.setAppConfig({`);
    lines.push(`    env: './.env',`);
    if (doc.isLocalStorage === true) {
        lines.push(`    isLocalStorage: true,`);
    }
    lines.push(`});`);
    lines.push(``);

    lines.push(`bot.setPlatformParams({`);
    lines.push(`    welcome_text: '${escapeStr((doc.welcome && doc.welcome.text) || '')}',`);
    lines.push(
        `    help_text: '${escapeStr((doc.helpText && doc.helpText.text) || (doc.fallback && doc.fallback.text) || '')}',`,
    );
    lines.push(`    empty_text: '${escapeStr((doc.fallback && doc.fallback.text) || '')}',`);
    lines.push(`    intents: [],`);
    lines.push(`});`);
    lines.push(``);

    // Генерируем функции для связанных блоков
    if (connectedBlocks.length > 0) {
        lines.push(`// --- Переиспользуемые функции ---`);
        for (const block of connectedBlocks) {
            lines.push(...generateBlockFunc(block, varNames, '    ', doc, connectedBlocks));
            lines.push(``);
        }
    }

    // Действия кнопок регистрируются ДО команд: слоты сравниваются вхождением,
    // и слот команды вроде «go» иначе перехватил бы нажатие [go:N].
    if (buttonActions.size > 0) {
        lines.push(`// --- Кнопки с переходом на блок ---`);
        for (const action of buttonActions.values()) {
            const target = action.target;
            const handlerName = handlerNames.get(target.id);
            const isFallbackTarget =
                target.type === 'command' &&
                (target.name === 'fallback' || target.role === 'fallback');
            const isAsync =
                target.type === 'command' || target.type === 'step'
                    ? commandNeedsAsync(target) || (isFallbackTarget && welcomeIsAsync)
                    : blockNeedsAsync(target, doc, connectedBlocks);
            const call = isAsync ? 'await ' : '';
            lines.push(
                `/** Кнопка «${escapeComment(action.title)}» → ${escapeComment(target.type)} «${escapeComment(target.name || target.id)}» */`,
            );
            lines.push(
                `bot.addAction('${escapeStr(action.name)}', ${isAsync ? 'async ' : ''}(cmd: string, ctrl: BotController): ${isAsync ? 'Promise<void>' : 'void'} => {`,
            );
            if (target.type === 'command' || target.type === 'step') {
                // Нажатие — это ввод текста кнопки, но обрабатывает его блок-цель
                lines.push(`    ctrl.originalUserCommand = ${textExpr(action.title)};`);
                lines.push(`    ctrl.userCommand = ctrl.originalUserCommand.toLowerCase().trim();`);
                lines.push(
                    target.type === 'command'
                        ? `    ${call}${handlerName}(ctrl.userCommand, ctrl);`
                        : `    ${call}${handlerName}(ctrl);`,
                );
            } else {
                lines.push(`    ${call}${getBlockFunctionName(target)}(ctrl);`);
            }
            lines.push(`});`);
            lines.push(``);
        }
    }

    let usedFallback = false;
    // Регистрация команд
    for (const node of doc.nodes) {
        if (node.type !== 'command') continue;
        const cmd = node;
        const cmdHandlerName = handlerNames.get(cmd.id);

        const isPattern = cmd.isPattern ? ', true' : '';

        // Определяем имя команды: welcome/help используют константы
        const isWelcome = cmd.name === 'welcome' || cmd.role === 'welcome';
        const isHelp = cmd.name === 'help' || cmd.role === 'help';
        const isFallback = cmd.name === 'fallback' || cmd.role === 'fallback';
        if (isFallback) {
            usedFallback = true;
        }
        // Приветствие срабатывает и на /start (Telegram), а не только на «привет»/«здравст»
        const slotsExpr = isWelcome
            ? welcomeSlotsExpr(cmd.slots)
            : `[${(cmd.slots || []).map((s) => `'${escapeStr(s)}'`).join(', ')}]`;
        // Fallback вызывает приветствие в начале диалога — и становится async вместе с ним
        const isAsync = commandNeedsAsync(cmd) || (isFallback && welcomeIsAsync);
        const cmdName = isWelcome
            ? 'WELCOME_INTENT_NAME'
            : isHelp
              ? 'HELP_INTENT_NAME'
              : isFallback
                ? 'FALLBACK_COMMAND'
                : `'${escapeStr(cmd.name)}'`;

        // Комментарий: описание команды
        const slotsPreview = (cmd.slots || []).slice(0, 3).join(', ');
        const commentName = isWelcome
            ? 'welcome (Старт)'
            : isHelp
              ? 'help (Помощь)'
              : isFallback
                ? 'fallback (Неизвестная команда)'
                : cmd.name;
        lines.push(
            `/** Команда "${escapeComment(commentName)}": активируется на [${escapeComment(slotsPreview)}${(cmd.slots || []).length > 3 ? '...' : ''}] */`,
        );
        if (cmdHandlerName) {
            lines.push(
                `${isAsync ? 'async ' : ''}function ${cmdHandlerName}(cmd: string, ctrl: BotController): ${isAsync ? 'Promise<void>' : 'void'} {`,
            );
        } else {
            lines.push(
                `bot.addCommand(${cmdName}, ${slotsExpr}, ${isAsync ? 'async ' : ''}(cmd: string, ctrl: BotController): ${isAsync ? 'Promise<void>' : 'void'} => {`,
            );
        }
        if (isFallback) {
            lines.push(...startWelcomeLines('    '));
        }

        // Ввод сохраняется до действий и текста — как у шага: {{переменная}} в ответе
        // команды видит текущий ввод. Исходный регистр — originalUserCommand.
        if (cmd.saveTo && cmd.saveTo.trim()) {
            lines.push(`    ${userDataAccess(cmd.saveTo)} = ctrl.originalUserCommand ?? cmd;`);
        }

        // Инлайн действия
        if (cmd.actions) {
            for (const action of cmd.actions) {
                lines.push(...generateActionFunc(action, varNames, '    '));
            }
        }

        // Инлайн условия — обрабатываем targetNodeId для навигации
        if (cmd.conditions) {
            for (const cond of cmd.conditions) {
                let trueNavigation = null;
                let falseNavigation = null;
                if (cond.targetNodeId) {
                    const targetNode = doc.nodes.find((n) => n.id === cond.targetNodeId);
                    if (
                        targetNode &&
                        (targetNode.type === 'step' || targetNode.type === 'command')
                    ) {
                        trueNavigation = `ctrl.thisIntentName = '${escapeStr(targetNode.name || targetNode.id)}'`;
                    }
                }
                lines.push(
                    ...generateConditionFunc(
                        cond,
                        varNames,
                        '    ',
                        null,
                        null,
                        trueNavigation,
                        falseNavigation,
                        doc,
                        connectedBlocks,
                    ),
                );
            }
        }

        // Вызов связанных блоков (включая branch_true/branch_false от условий)
        const outgoingBlocks = findOutgoingBlocks(doc, cmd.id, connectedBlocks);
        lines.push(...generateOutgoingBlockCalls(outgoingBlocks, '    ', doc, connectedBlocks));

        // Текст (только если нет подключённых блоков с текстом)
        if (cmd.response && cmd.response.text && !hasTextFromBlocks(outgoingBlocks)) {
            lines.push(`    setText(ctrl, ${textExpr(cmd.response.text)});`);
        }
        if (cmd.response && cmd.response.tts) {
            lines.push(`    setTTS(ctrl, ${textExpr(cmd.response.tts)});`);
        }
        if (cmd.response && cmd.response.isEnd) {
            lines.push(`    ctrl.isEnd = true;`);
        }
        if (cmd.response && cmd.response.buttons) {
            lines.push(
                ...generateButtonCode(
                    cmd.response.buttons,
                    '    ',
                    cmd.response.shuffleButtons,
                    doc,
                ),
            );
        }
        if (cmd.response && cmd.response.card) {
            lines.push(...generateCardCode(cmd.response.card, '    ', doc));
        }
        if (cmd.response && cmd.response.emotion) {
            lines.push(`    ctrl.emotion = '${escapeStr(cmd.response.emotion)}';`);
        }

        // Навигация: найти следующий command/step в цепочке
        // Только если нет условий с targetNodeId (иначе условие само навигирует)
        const hasConditionWithTarget = (cmd.conditions || []).some((c) => c.targetNodeId);
        if (!hasConditionWithTarget) {
            const nextStep = findNextNonBlockNode(doc, cmd.id);
            if (nextStep) {
                lines.push(`    ctrl.thisIntentName = '${escapeStr(nextStep.name)}';`);
            }
        }

        if (cmdHandlerName) {
            lines.push(`}`);
            lines.push(`bot.addCommand(${cmdName}, ${slotsExpr}, ${cmdHandlerName}${isPattern});`);
        } else {
            lines.push(`}${isPattern});`);
        }
        lines.push(``);
    }

    // Приветствие и справка из настроек бота (в сценарии нет ноды welcome/help)
    if (settingsWelcome) {
        lines.push(
            `/** Приветствие из настроек бота: активируется на /start, «привет», «здравст» */`,
        );
        lines.push(`function ${welcomeHandlerName}(cmd: string, ctrl: BotController): void {`);
        if (settingsWelcome.text.trim()) {
            lines.push(`    setText(ctrl, ${textExpr(settingsWelcome.text)});`);
        }
        lines.push(...generateButtonCode(settingsWelcome.buttons, '    ', false, doc));
        lines.push(`}`);
        lines.push(
            `bot.addCommand(WELCOME_INTENT_NAME, ${welcomeSlotsExpr([])}, ${welcomeHandlerName});`,
        );
        lines.push(``);
    }
    if (settingsHelpText) {
        lines.push(`/** Справка из настроек бота: активируется на «помощь», «что ты умеешь» */`);
        lines.push(
            `bot.addCommand(HELP_INTENT_NAME, [...HELP_INTENT_SLOTS], (cmd: string, ctrl: BotController): void => {`,
        );
        lines.push(`    setText(ctrl, ${textExpr(settingsHelpText)});`);
        lines.push(`});`);
        lines.push(``);
    }

    // Регистрация шагов
    for (const node of doc.nodes) {
        if (node.type !== 'step') continue;
        const step = node;

        const isAsync =
            (step.actions || []).some((a) => a.type === 'http_request') ||
            blockNeedsAsync(step, doc, connectedBlocks);

        // Комментарий: описание шага
        const promptPreview = step.prompt?.text ? step.prompt.text.slice(0, 40) : '';
        const saveInfo = step.saveTo ? `, сохраняет в ${step.saveTo}` : '';
        lines.push(
            `/** Шаг "${escapeComment(step.name)}": ${promptPreview ? `"${escapeComment(promptPreview)}..."` : 'ожидание ввода'}${escapeComment(saveInfo)} */`,
        );
        const stepHandlerName = handlerNames.get(step.id);
        // Шаг возвращает false и пропускает запрос дальше (к командам), если это:
        // - начало диалога: новая сессия голосового ассистента (messageId 0) или /start —
        //   шаг, ожидавший ответ в прошлой сессии, не должен съедать запуск;
        // - нажатие кнопки с переходом: оно должно дойти до действия [go:N].
        const skipConditions = [
            'ctrl.messageId === 0',
            `(ctrl.userCommand ?? '').startsWith('${START_SLOT}')`,
        ];
        if (buttonActions.size > 0) {
            skipConditions.push(`(ctrl.userCommand ?? '').startsWith('${BUTTON_ACTION_PREFIX}')`);
        }
        const skipStepLine = `    if (${skipConditions.join(' || ')}) return false;`;
        const stepReturnType = 'void | false';
        if (stepHandlerName) {
            lines.push(
                `${isAsync ? 'async ' : ''}function ${stepHandlerName}(ctrl: BotController): ${isAsync ? 'Promise<void>' : 'void'} {`,
            );
        } else {
            lines.push(
                `bot.addStep('${escapeStr(step.name)}', ${isAsync ? 'async ' : ''}(ctrl: BotController): ${isAsync ? `Promise<${stepReturnType}>` : stepReturnType} => {`,
            );
            lines.push(skipStepLine);
        }

        // Шаг срабатывает на ответ пользователя: сначала сохраняем ответ и выполняем
        // действия, и только потом выводим текст шага — иначе {{переменная}} в тексте
        // подставлялась до записи и показывала прошлое значение (или undefined).
        // saveTo
        if (step.saveTo && step.saveTo.trim()) {
            // Fix: адаптеры приводят ctrl.userCommand к нижнему регистру для матчинга слотов,
            // поэтому «оригинальный» ввод нужно брать из ctrl.originalUserCommand —
            // иначе имена и email сохранялись бы искажёнными («Иван» -> «иван»).
            const saveExpr =
                step.saveAs === 'lowercase'
                    ? `(ctrl.userCommand ?? '').toLowerCase()`
                    : `ctrl.originalUserCommand ?? ctrl.userCommand ?? ''`;
            lines.push(`    ${userDataAccess(step.saveTo)} = ${saveExpr};`);
        }

        // Инлайн действия
        if (step.actions) {
            for (const action of step.actions) {
                lines.push(...generateActionFunc(action, varNames, '    '));
            }
        }

        // Текст — реакция на ответ
        if (step.prompt && step.prompt.text) {
            lines.push(`    setText(ctrl, ${textExpr(step.prompt.text)});`);
        }
        if (step.prompt && step.prompt.tts) {
            lines.push(`    setTTS(ctrl, ${textExpr(step.prompt.tts)});`);
        }
        if (step.prompt && step.prompt.buttons) {
            lines.push(
                ...generateButtonCode(step.prompt.buttons, '    ', step.prompt.shuffleButtons, doc),
            );
        }
        if (step.prompt) lines.push(...generateCardCode(step.prompt.card, '    ', doc));
        if (step.prompt && step.prompt.emotion) {
            lines.push(`    ctrl.emotion = '${escapeStr(step.prompt.emotion)}';`);
        }

        // Инлайн условия — обрабатываем targetNodeId для навигации
        if (step.conditions) {
            for (const cond of step.conditions) {
                let trueNavigation = null;
                let falseNavigation = null;
                if (cond.targetNodeId) {
                    const targetNode = doc.nodes.find((n) => n.id === cond.targetNodeId);
                    if (
                        targetNode &&
                        (targetNode.type === 'step' || targetNode.type === 'command')
                    ) {
                        trueNavigation = `ctrl.thisIntentName = '${escapeStr(targetNode.name || targetNode.id)}'`;
                    }
                }
                lines.push(
                    ...generateConditionFunc(
                        cond,
                        varNames,
                        '    ',
                        null,
                        null,
                        trueNavigation,
                        falseNavigation,
                        doc,
                        connectedBlocks,
                    ),
                );
            }
        }

        // Вызов связанных блоков (включая branch_true/branch_false от условий)
        const outgoingBlocks = findOutgoingBlocks(doc, step.id, connectedBlocks);
        lines.push(...generateOutgoingBlockCalls(outgoingBlocks, '    ', doc, connectedBlocks));

        // Навигация: найти следующий command/step в цепочке
        // Только если нет условий с targetNodeId
        const stepHasConditionWithTarget = (step.conditions || []).some((c) => c.targetNodeId);
        if (!stepHasConditionWithTarget) {
            const nextStepNode = findNextNonBlockNode(doc, step.id);
            if (nextStepNode) {
                lines.push(`    ctrl.thisIntentName = '${escapeStr(nextStepNode.name)}';`);
            }
        }

        if (stepHandlerName) {
            lines.push(`}`);
            lines.push(
                `bot.addStep('${escapeStr(step.name)}', ${isAsync ? 'async ' : ''}(ctrl: BotController): ${isAsync ? `Promise<${stepReturnType}>` : stepReturnType} => {`,
            );
            lines.push(skipStepLine);
            lines.push(`    ${isAsync ? 'await ' : ''}${stepHandlerName}(ctrl);`);
            lines.push(`});`);
        } else {
            lines.push(`});`);
        }
        lines.push(``);
    }

    if (!usedFallback) {
        // Fallback
        lines.push(
            `bot.addCommand(FALLBACK_COMMAND, [], ${welcomeIsAsync ? 'async ' : ''}(cmd: string, ctrl: BotController): ${welcomeIsAsync ? 'Promise<void>' : 'void'} => {`,
        );
        lines.push(...startWelcomeLines('    '));
        lines.push(
            `    setText(ctrl, '${escapeStr((doc.fallback && doc.fallback.text) || 'Извините, я вас не понял.')}');`,
        );
        lines.push(`});`);
        lines.push(``);
    }

    if (!useCloud) {
        // Хост и порт можно задать в flow.json (поля hostname/port). По умолчанию
        // localhost:3000. Хост экранируем через JSON.stringify, порт валидируем.
        const hostname = JSON.stringify(String(doc.hostname || 'localhost'));
        const requestedPort = Number(doc.port);
        const port =
            Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535
                ? requestedPort
                : 3000;
        lines.push(`bot.start(${hostname}, ${port});`);
        lines.push(``);
    }

    // Если useCloud — добавляем экспорт cloud function handler
    if (useCloud) {
        lines.push(``);
        lines.push(`// --- Yandex Cloud Function handler ---`);
        lines.push(`export const handler = async (event: Record<string, unknown>) => {`);
        lines.push(
            `    const content = typeof event.body === 'string' ? event.body : JSON.stringify(event.body ?? '');`,
        );
        lines.push(`    const headers = (event.headers ?? {}) as Record<string, unknown>;`);
        lines.push(`    const result = await bot.webhookEvent(content, headers);`);
        lines.push(`    return {`);
        lines.push(`        statusCode: result.statusCode,`);
        lines.push(`        headers: { 'Content-Type': 'application/json' },`);
        lines.push(
            `        body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? ''),`,
        );
        lines.push(`    };`);
        lines.push(`};`);
    }
    return lines.join('\n');
}

/**
 * Генерирует содержимое package.json с именем проекта и зависимостями.
 * @param {Object} doc — FlowDocument
 * @returns {string} JSON-строка package.json
 */
function generatePackageJson(doc) {
    // Версия фреймворка, которым сгенерирован проект: сгенерированный код опирается
    // на его возможности (кнопки с переходом, inline-кнопки Telegram и т.д.)
    const dependencies = { umbot: UMBOT_VERSION };
    if (doc.database?.type === 'mongo') {
        dependencies.mongodb = '7.1.1';
    }
    const pkg = {
        name: (doc.name || 'my-bot').replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
        version: doc.version || '1.0.0',
        main: './dist/index.js',
        scripts: { start: 'node ./dist/index.js', build: 'tsc' },
        dependencies,
        devDependencies: { typescript: '6.0.3', '@types/node': '24.13.4' },
        // Совпадает с шаблоном create и рантаймом Yandex Cloud Functions (nodejs22).
        engines: { node: '>=22.0.0' },
    };
    return JSON.stringify(pkg, null, 2);
}

/** Генерирует содержимое tsconfig.json для TypeScript-проекта. @returns {string} JSON-строка */
function generateTsConfig() {
    return JSON.stringify(
        {
            compilerOptions: {
                target: 'es2023',
                module: 'Node16',
                moduleResolution: 'Node16',
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                outDir: './dist',
                rootDir: './src',
                // С TypeScript 6.0 `types` по умолчанию пуст: без явного node
                // глобальный setTimeout резолвится из lib.es (возвращает number),
                // и сгенерированный utils.ts (`setTimeout(...).unref()`) не
                // компилируется. Шаблон `create` задаёт то же самое.
                types: ['node'],
            },
            include: ['src/**/*'],
        },
        null,
        2,
    );
}

function generateGitIgnore() {
    const file = __dirname + '/template/.gitignore';
    if (utils.isFile(file)) {
        return utils.fread(file);
    }
    return '';
}

/** Документация по подключению платформ (webhook, токены, проверка подписи). */
const PLATFORM_DOCS_URL =
    'https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_platform-integration.html';

/** Как подключить платформу: где взять токен и куда указать адрес вебхука. */
const PLATFORM_README = {
    alisa: {
        title: 'Алиса',
        env: 'ALISA_TOKEN',
        steps: [
            'Создайте навык в [консоли Яндекс Диалогов](https://dialogs.yandex.ru/developer).',
            'В настройках навыка («Backend» → «Webhook URL») укажите публичный адрес бота, например `https://ваш-домен/`.',
            'Токен `ALISA_TOKEN` не обязателен: он нужен только для загрузки картинок и звуков.',
        ],
    },
    marusia: {
        title: 'Маруся',
        env: 'MARUSIA_TOKEN',
        steps: [
            'Создайте скилл Маруси в кабинете разработчика VK.',
            'Укажите публичный адрес бота как Webhook URL скилла.',
            'Токен `MARUSIA_TOKEN` нужен только для загрузки картинок и звуков.',
        ],
    },
    smart_app: {
        title: 'Сбер SmartApp',
        env: 'SMARTAPP_TOKEN',
        steps: [
            'Создайте смартап в SmartMarket Studio.',
            'Укажите публичный адрес бота как Webhook смартапа.',
        ],
    },
    telegram: {
        title: 'Telegram',
        env: 'TELEGRAM_TOKEN',
        steps: [
            'Создайте бота у [@BotFather](https://t.me/botfather) и впишите токен в `TELEGRAM_TOKEN` в `.env`.',
            'Зарегистрируйте вебхук (подставьте токен и адрес): `curl "https://api.telegram.org/bot<ТОКЕН>/setWebhook" -d "url=https://ваш-домен/"`.',
        ],
    },
    vk: {
        title: 'ВКонтакте',
        env: 'VK_TOKEN',
        steps: [
            'В настройках сообщества включите сообщения и создайте ключ доступа — впишите его в `VK_TOKEN`.',
            'В разделе «Callback API» укажите публичный адрес бота и подтвердите сервер.',
        ],
    },
    max_app: {
        title: 'MAX',
        env: 'MAX_TOKEN',
        steps: [
            'Создайте бота на платформе MAX для партнёров и впишите токен в `MAX_TOKEN`.',
            'Подпишите бота на вебхук с публичным адресом бота.',
        ],
    },
    viber: {
        title: 'Viber',
        env: 'VIBER_TOKEN',
        steps: [
            'Создайте бота в [Viber Admin Panel](https://partners.viber.com) и впишите токен в `VIBER_TOKEN`.',
            'Установите вебхук с публичным адресом бота (метод `set_webhook` Viber API).',
        ],
    },
};

/**
 * Генерирует README.md проекта: как установить, настроить токены, запустить и подключить платформы.
 * @param {Object} doc — FlowDocument
 * @param {boolean} useCloud — проект для Yandex Cloud Functions
 * @returns {string} содержимое README.md
 */
function generateReadme(doc, useCloud) {
    const platforms = (Array.isArray(doc.platforms) ? doc.platforms : []).filter(
        (p) => PLATFORM_README[p],
    );
    const hostname = String(doc.hostname || 'localhost');
    const requestedPort = Number(doc.port);
    const port =
        Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535
            ? requestedPort
            : 3000;
    const out = [];
    out.push(`# ${doc.name}`);
    out.push('');
    out.push(
        'Бот сгенерирован из flow.json командой `umbot create from-flow` ([umbot](https://github.com/max36895/umbot)). ' +
            'Логика бота — в `src/index.ts`.',
    );
    out.push('');
    out.push('## 1. Установка');
    out.push('');
    out.push('Нужен [Node.js](https://nodejs.org) версии 22 или новее.');
    out.push('');
    out.push('```bash');
    out.push('npm install');
    out.push('```');
    out.push('');
    out.push('## 2. Токены');
    out.push('');
    out.push(
        'Токены платформ хранятся в файле `.env` (он не попадает в git). Впишите значения после «=»:',
    );
    out.push('');
    for (const p of platforms) {
        out.push(`- \`${PLATFORM_README[p].env}\` — ${PLATFORM_README[p].title}`);
    }
    if (platforms.length === 0) {
        out.push('- платформы в flow.json не выбраны — добавьте нужные токены вручную');
    }
    out.push('');
    if (useCloud) {
        out.push('## 3. Деплой в Yandex Cloud Functions');
        out.push('');
        out.push(
            'Установите и авторизуйте [yc CLI](https://yandex.cloud/ru/docs/cli/quickstart), создайте функцию с именем из `serverless.yml`, затем:',
        );
        out.push('');
        out.push('```bash');
        out.push('npm run deploy');
        out.push('```');
        out.push('');
        out.push(
            'Сделайте функцию публичной (или подключите API Gateway) — её HTTPS-адрес и есть адрес бота для платформ.',
        );
    } else {
        out.push('## 3. Сборка и запуск');
        out.push('');
        out.push('```bash');
        out.push('npm run build');
        out.push('npm start');
        out.push('```');
        out.push('');
        out.push(
            `Бот слушает \`http://${hostname}:${port}/\` (адрес и порт задаются полями \`hostname\`/\`port\` во flow.json). ` +
                `Проверка работы: \`http://${hostname}:${port}/health\`.`,
        );
        out.push('');
        out.push(
            'Платформы обращаются к боту только по публичному HTTPS-адресу. На сервере поставьте перед ботом ' +
                'reverse proxy с SSL (например, nginx), для проверки на своём компьютере подойдёт туннель: ' +
                `\`ngrok http ${port}\` — он выдаст адрес вида \`https://xxxx.ngrok-free.app\`.`,
        );
    }
    out.push('');
    out.push('## 4. Подключение платформ');
    out.push('');
    for (const p of platforms) {
        out.push(`### ${PLATFORM_README[p].title}`);
        out.push('');
        PLATFORM_README[p].steps.forEach((step, i) => out.push(`${i + 1}. ${step}`));
        out.push('');
    }
    out.push(
        `Подробно о каждой платформе и о проверке подписи вебхука (обязательно для продакшена) — в [документации umbot](${PLATFORM_DOCS_URL}).`,
    );
    out.push('');
    out.push('## Повторная генерация');
    out.push('');
    out.push(
        'После изменения сценария в редакторе выполните `umbot create from-flow <flow.json> --output <эта папка> --force`: ' +
            'файлы проекта перезапишутся, а заполненные значения в `.env` сохранятся.',
    );
    out.push('');
    return out.join('\n');
}

/** Генерирует src/utils.ts с setText, setTTS и fetchWithTimeout (для http_request-блоков). @returns {string} содержимое файла */
function generateUtils() {
    return `import { BotController } from 'umbot';

/**
 * Установить текст ответа. Если текст уже задан — добавляет через \\n.
 */
export function setText(ctrl: BotController, text: string): void {
    if (ctrl.text) {
        ctrl.text += \`\\n\${text}\`;
    } else {
        ctrl.text = text;
    }
}

/**
 * Сравнить значения условия как строки: шаг сохраняет ввод строкой ('42'),
 * а rand и числа из flow.json — числом (42); строгое === считало бы их разными.
 */
export function isEqual(a: unknown, b: unknown): boolean {
    return String(a ?? '') === String(b ?? '');
}

/**
 * Установить TTS. Если TTS уже задан — добавляет через пробел.
 */
export function setTTS(ctrl: BotController, text: string): void {
    if (ctrl.tts) {
        ctrl.tts += \` \${text}\`;
    } else {
        ctrl.tts = text;
    }
}

/**
 * Выполнить HTTP-запрос с ограничением по времени, чтобы обработчик бота не зависал на внешнем API.
 */
export async function fetchWithTimeout(
    url: string,
    init: RequestInit = {},
    timeoutMs = 2000,
): Promise<Response> {
    const controller = new AbortController();
    // unref(): таймер не должен удерживать процесс при завершении,
    // если в этот момент больше нет активных запросов.
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs).unref();

    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}
`;
}

/**
 * Точка входа генератора. Читает JSON, валидирует, генерирует все файлы и записывает на диск.
 * @param {string} flowJsonPath — путь к flow.json
 * @param {string} outputPath — путь к выходной директории проекта
 * @param {{useCloud?: boolean, force?: boolean}} [options] — флаги генерации
 * @throws {Error} при невалидном JSON, отсутствии обязательных полей, пути-не-папке
 * или непустой выходной папке без --force
 */
function generateFromFlow(flowJsonPath, outputPath, options = {}) {
    if (!fs.existsSync(flowJsonPath)) {
        throw new Error(`Файл не найден: ${flowJsonPath}`);
    }

    const content = fs.readFileSync(flowJsonPath, 'utf8');
    let doc;
    try {
        doc = JSON.parse(content);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new Error(`Ошибка парсинга JSON: ${message}`, { cause: e });
    }

    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        throw new Error('flow.json должен быть JSON-объектом');
    }
    if (!doc.name) throw new Error('В JSON отсутствует поле "name"');
    if (!doc.nodes || !Array.isArray(doc.nodes)) {
        throw new Error('В JSON отсутствует поле "nodes"');
    }

    const schemaErrors = validateFlowSchema(flowJsonPath);
    if (schemaErrors.length) {
        throw new Error(`Некорректный flow.json: ${schemaErrors.join('; ')}`);
    }

    if (!doc.edges || !Array.isArray(doc.edges)) doc.edges = [];
    // Без приветствия в flow.json бот не придумывает своё: старт диалога уходит в fallback,
    // как показывает превью редактора
    if (!doc.welcome) doc.welcome = { text: '', buttons: [] };
    if (!doc.fallback) doc.fallback = { text: 'Извините, я вас не понял.' };
    if (!doc.platforms || !Array.isArray(doc.platforms)) doc.platforms = ['telegram'];
    if (!doc.database) doc.database = { type: 'file', config: {} };

    // Валидация имён переменных
    const warnings = [];
    for (const node of doc.nodes) {
        if ((node.type === 'command' || node.type === 'step') && node.saveTo) {
            if (!isValidJSIdentifier(node.saveTo)) {
                warnings.push(
                    `Блок "${node.name}": имя переменной "${node.saveTo}" не является валидным JS-идентификатором. Будет использован скобочный синтаксис.`,
                );
            }
        }
        if (node.actions) {
            for (const action of node.actions) {
                if (action.field && !isValidJSIdentifier(action.field)) {
                    warnings.push(
                        `Блок "${node.name}": имя переменной "${action.field}" не является валидным JS-идентификатором.`,
                    );
                }
            }
        }
    }
    if (warnings.length > 0) {
        console.warn('\n⚠️ Предупреждения:');
        warnings.forEach((w) => console.warn(`  - ${w}`));
        console.log('');
    }

    if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (!stats.isDirectory()) {
            throw new Error(
                `Путь для генерации уже существует и не является папкой: ${outputPath}`,
            );
        }

        const entries = fs.readdirSync(outputPath);
        if (entries.length > 0 && !options.force) {
            throw new Error(
                `Папка для генерации не пустая: ${outputPath}. Укажите --force, чтобы перезаписать файлы.`,
            );
        }
    } else {
        fs.mkdirSync(outputPath, { recursive: true });
    }

    const srcDir = path.join(outputPath, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
        path.join(srcDir, 'index.ts'),
        generateIndexTs(doc, options.useCloud, outputPath),
        'utf8',
    );
    fs.writeFileSync(path.join(srcDir, 'utils.ts'), generateUtils(), 'utf8');
    fs.writeFileSync(path.join(outputPath, 'package.json'), generatePackageJson(doc), 'utf8');
    fs.writeFileSync(path.join(outputPath, 'tsconfig.json'), generateTsConfig(), 'utf8');
    fs.writeFileSync(path.join(outputPath, '.gitignore'), generateGitIgnore(), 'utf8');
    fs.writeFileSync(
        path.join(outputPath, 'README.md'),
        generateReadme(doc, !!options.useCloud),
        'utf8',
    );

    // Генерация .env файла если есть токены
    // ALISA_TOKEN — каноническое имя для Алисы (ранее был YANDEX_TOKEN,
    // он поддерживается через fallback в AppContext для обратной совместимости).
    const TOKEN_ENV_NAMES = {
        telegram: 'TELEGRAM_TOKEN',
        vk: 'VK_TOKEN',
        alisa: 'ALISA_TOKEN',
        marusia: 'MARUSIA_TOKEN',
        smart_app: 'SMARTAPP_TOKEN',
        max_app: 'MAX_TOKEN',
        viber: 'VIBER_TOKEN',
    };
    const tokens = doc.tokens || {};
    // Поддержка двух форматов tokens:
    //   - плоский: { telegram: "abc123" }
    //   - вложенный (как в README): { telegram: { token: "abc123" } }
    const getTokenValue = (v) => {
        if (!v) return '';
        // Переводы строк в значении позволили бы дописать в .env произвольные
        // переменные, поэтому они вычищаются из токена.
        if (typeof v === 'string') return v.trim().replace(/[\r\n]+/g, '');
        if (typeof v === 'object' && typeof v.token === 'string')
            return v.token.trim().replace(/[\r\n]+/g, '');
        return '';
    };
    // Ключ платформы из flow.json попадает в имя переменной окружения. flow.json
    // приходит из внешнего редактора, поэтому ключ санитизируется до allowlist
    // [A-Z0-9_]: иначе ключ с переводами строк ломал структуру serverless.yml
    // (YAML-инъекция) и .env.
    const sanitizeEnvName = (platform) => {
        if (TOKEN_ENV_NAMES[platform]) return TOKEN_ENV_NAMES[platform];
        return String(platform)
            .toUpperCase()
            .replace(/[^A-Z0-9_]/g, '_');
    };
    const tokenEntries = Object.entries(tokens)
        .map(([platform, tokenRaw]) => ({
            envName: sanitizeEnvName(platform),
            value: getTokenValue(tokenRaw),
        }))
        .filter((entry) => entry.envName !== '' && entry.value !== '');
    // .env создаётся всегда: переменные токенов выбранных платформ (пустые, если токена
    // нет во flow.json) — пользователь вписывает токен в готовый файл, а не создаёт его сам.
    // Существующий .env не перезаписывается: пользовательские значения сохраняются,
    // недостающие переменные дописываются, пустые — заполняются токеном из flow.json.
    const platformEntries = (Array.isArray(doc.platforms) ? doc.platforms : [])
        .filter((platform) => TOKEN_ENV_NAMES[platform])
        .map((platform) => ({ envName: TOKEN_ENV_NAMES[platform], value: '' }));
    const envResult = mergeEnvFile(path.join(outputPath, '.env'), [
        ...tokenEntries,
        ...platformEntries,
    ]);
    if (envResult.created) {
        console.log('  .env');
    } else if (envResult.added.length > 0 || envResult.filled.length > 0) {
        console.warn(
            `  .env: дописаны переменные (${[...envResult.added, ...envResult.filled].join(', ')}), ` +
                'существующие значения не изменены.',
        );
    } else if (tokenEntries.length > 0) {
        console.log('  .env уже существует — токены из flow.json не перезаписаны.');
    }

    // Генерация для Yandex Cloud Functions
    if (options.useCloud) {
        const cloudFunctionName = getCloudFunctionName(doc.name);
        const pkg = JSON.parse(fs.readFileSync(path.join(outputPath, 'package.json'), 'utf8'));
        pkg.scripts = pkg.scripts || {};
        pkg.scripts.deploy = 'npm run build && node ./scripts/deploy.js';
        pkg.scripts.build = 'tsc';
        fs.writeFileSync(
            path.join(outputPath, 'package.json'),
            JSON.stringify(pkg, null, 4) + '\n',
            'utf8',
        );

        const serverlessYml = `# СПРАВОЧНЫЙ ФАЙЛ: описывает целевую конфигурацию функции в Yandex Cloud.
# Деплой выполняется командой 'npm run deploy' (scripts/deploy.js через yc CLI),
# которая собирает аргументы сама и НЕ читает этот файл. Правки сюда эффекта
# не дают — меняйте scripts/deploy.js или переменные в .env.
functions:
  - name: ${cloudFunctionName}
    runtime: nodejs22
    entrypoint: dist/index.handler
    memory: 128m
    environment:
${
    tokenEntries.length > 0
        ? tokenEntries
              .map((entry) => `      ${entry.envName}: "\${env:${entry.envName}}"`)
              .join('\n')
        : '      # Добавьте переменные окружения здесь'
}
    secrets:
      - id: ${cloudFunctionName}-secrets
        version: latest
`;
        fs.writeFileSync(path.join(outputPath, 'serverless.yml'), serverlessYml, 'utf8');
        console.log('  serverless.yml');

        // Архив функции формируется из отдельной staging-папки, поэтому .env, исходники,
        // node_modules и история Git физически не могут попасть в версию функции.
        fs.writeFileSync(
            path.join(outputPath, '.ymlignore'),
            '.env\nnode_modules\n.git\n.github\ntests\nsrc\n*.log\n',
            'utf8',
        );
        const scriptsDir = path.join(outputPath, 'scripts');
        fs.mkdirSync(scriptsDir, { recursive: true });
        const deployScript = `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const stage = path.join(root, '.umbot-deploy');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true });
for (const file of ['package.json', 'package-lock.json']) {
    const source = path.join(root, file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(stage, file));
}

const envPath = path.join(root, '.env');
// Значения .env попадают в аргументы командной строки, а при shell:true (Windows)
// Node склеивает команду и аргументы в одну строку без экранирования —
// спецсимволы (&, |, ^, кавычки, переводы строк) из значения исполнялись бы
// оболочкой. '%' вырезаем, а не удваиваем: в режиме командной строки (cmd /c,
// без пакетного файла) %% НЕ раскрывается в литеральный % — это семантика
// batch-файлов; замерено на Node 24/win10: %PATH% и %%PATH% раскрываются
// одинаково, унося значения переменных окружения машины в аргументы деплоя.
// Вырезание закрывает утечку; затронутые переменные помечаем warn'ом, чтобы
// вырезание не было молчаливым — легитимное значение с % заметят сразу.
const sanitizeEnvValue = (value) => String(value)
    .replace(/[\r\n\0]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/"/g, '')
    .replace(/%/g, '');
const environment = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8').split(/\\r?\\n/).map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#')).map((line) => {
              const eq = line.indexOf('=');
              if (eq === -1) return line;
              const name = line.slice(0, eq);
              const raw = line.slice(eq + 1);
              const sanitized = sanitizeEnvValue(raw);
              if (sanitized !== raw) {
                  console.warn('[deploy] ' + name + ': вырезаны символы, ' +
                      'недопустимые в аргументах командной строки Windows (%, кавычки, ' +
                      'управляющие). Проверьте значение переменной.');
              }
              // yc CLI разделяет пары --environment запятыми: запятая внутри
              // значения разрезала бы переменную на две битые. Такую переменную
              // пропускаем с явным предупреждением, а не портим молча.
              if (sanitized.includes(',')) {
                  console.warn('[deploy] ' + name + ': значение содержит запятую — ' +
                      'переменная НЕ передана в --environment (yc делит пары по запятым). ' +
                      'Уберите запятую из значения или задайте переменную в консоли облака.');
                  return null;
              }
              return name + '=' + sanitized;
          }).filter((line) => line !== null).join(',')
    : '';
const args = ['serverless', 'function', 'version', 'create',
    '--function-name', '${cloudFunctionName}', '--runtime', 'nodejs22',
    '--entrypoint', 'dist/index.handler', '--memory', '128m',
    '--execution-timeout', '10s', '--source-path', stage];
if (environment) args.push('--environment', environment);
// На Windows spawnSync использует cmd.exe: аргументы оборачиваются в двойные
// кавычки (для cmd внутри кавычек & | <> ^ литеральны), что также чинит пути
// и значения с пробелами. На POSIX shell не используется — spawnSync
// передаёт аргументы как есть.
const useShell = process.platform === 'win32';
const quoteArg = (arg) => (useShell ? '"' + String(arg).replace(/"/g, '') + '"' : String(arg));
const result = spawnSync('yc', args.map(quoteArg), { stdio: 'inherit', shell: useShell });
fs.rmSync(stage, { recursive: true, force: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
`;
        fs.writeFileSync(path.join(scriptsDir, 'deploy.js'), deployScript, 'utf8');
    }

    console.log(`Проект успешно создан в: ${outputPath}`);
    console.log(`Файлы:`);
    console.log(`  src/index.ts`);
    console.log(`  src/utils.ts`);
    console.log(`  package.json`);
    console.log(`  tsconfig.json`);
    console.log(`  README.md`);
    console.log('');
    console.log('Дальше:');
    console.log(`  cd ${outputPath}`);
    console.log('  npm install');
    console.log('  впишите токены платформ в .env');
    console.log(options.useCloud ? '  npm run deploy' : '  npm run build && npm start');
    console.log('Подробности (публичный адрес, подключение платформ) — в README.md');
}

/**
 * Валидирует flow.json перед генерацией проекта.
 * Возвращает массив ошибок (пустой массив = valid).
 *
 * Проверяет:
 * - Наличие обязательных полей (name, nodes)
 * - Что каждый node имеет id, type
 * - Что рёбра edges ссылаются на существующие узлы (from/to) и имеют допустимый type
 * - Что saveTo узлов — валидный идентификатор или dotted path ([a-zA-Z0-9_.]+)
 * - Что нет циклов только из блоков action/condition/response (генерируются как
 *   рекурсивные вызовы и переполнили бы стек); циклы через command/step допустимы
 *
 * @param {string} flowJsonPath — Путь к flow.json
 * @returns {string[]} Массив ошибок (пустой = OK)
 */
function validateFlowSchema(flowJsonPath) {
    const errors = [];
    let doc;
    try {
        const raw = fs.readFileSync(flowJsonPath, 'utf8');
        doc = JSON.parse(raw);
    } catch (e) {
        return [`Не удалось прочитать ${flowJsonPath}: ${e.message}`];
    }

    if (!doc || typeof doc !== 'object') {
        return ['flow.json должен быть JSON-объектом'];
    }
    if (!Array.isArray(doc.nodes)) {
        errors.push('Отсутствует обязательное поле `nodes` (должно быть массивом)');
    }
    if (!doc.name || typeof doc.name !== 'string') {
        errors.push('Отсутствует или некорректно поле `name` (строка-имя бота)');
    }

    if (Array.isArray(doc.nodes)) {
        const ids = new Set();
        doc.nodes.forEach((n, idx) => {
            if (!n || typeof n !== 'object' || Array.isArray(n)) {
                errors.push(`nodes[${idx}]: узел должен быть объектом`);
                return;
            }
            const hasId = n.id !== undefined && n.id !== null && n.id !== '';
            if (!hasId) {
                errors.push(`nodes[${idx}]: отсутствует \`id\``);
            }
            if (hasId && ids.has(n.id)) {
                errors.push(`nodes[${idx}]: дублирующийся id="${n.id}"`);
            }
            if (hasId) ids.add(n.id);
            if (!n.type) {
                errors.push(`nodes[${idx}]: отсутствует \`type\``);
            }
            if (n.saveTo && !/^[\w.]+$/.test(n.saveTo)) {
                errors.push(
                    `nodes[${idx}]: saveTo="${n.saveTo}" — некорректный идентификатор (используйте [a-zA-Z0-9_.]+)`,
                );
            }
            const variableNames = [
                n.saveTo,
                ...(Array.isArray(n.actions)
                    ? n.actions.flatMap((action) => [action?.field, action?.saveResponseTo])
                    : []),
            ].filter(Boolean);
            for (const variableName of variableNames) {
                if (!isSafeUserDataKey(variableName)) {
                    errors.push(
                        `nodes[${idx}]: имя переменной "${variableName}" использует зарезервированное свойство прототипа`,
                    );
                }
            }
        });

        // Навигация в flow.json осуществляется через edges, а не через поле next —
        // проверяем целостность именно рёбер (существование from/to, валидный type).
        // Циклы через command/step допустимы (например, генератор примеров в игре) —
        // отдельная проверка циклов среди исполняемых блоков выполняется ниже.
        const EDGE_TYPES = new Set(['next', 'branch_true', 'branch_false', 'slot_match']);
        if (doc.edges !== undefined && !Array.isArray(doc.edges)) {
            errors.push('Поле `edges` должно быть массивом');
        } else if (Array.isArray(doc.edges)) {
            doc.edges.forEach((e, idx) => {
                if (!e || typeof e !== 'object') {
                    errors.push(`edges[${idx}]: ребро должно быть объектом`);
                    return;
                }
                if (!e.from || !ids.has(e.from)) {
                    errors.push(`edges[${idx}]: from="${e.from}" ссылается на несуществующий узел`);
                }
                if (!e.to || !ids.has(e.to)) {
                    errors.push(`edges[${idx}]: to="${e.to}" ссылается на несуществующий узел`);
                }
                if (e.type && !EDGE_TYPES.has(e.type)) {
                    errors.push(
                        `edges[${idx}]: неизвестный type="${e.type}" (допустимы: next, branch_true, branch_false, slot_match)`,
                    );
                }
            });
        }
    }

    // Циклы, проходящие через command/step, допустимы: навигация между ними идёт через
    // ctrl.thisIntentName, а не через рекурсию. Однако цикл, состоящий ТОЛЬКО из исполняемых
    // блоков (action/condition/response), генерируется как прямые вызовы функций и при
    // выполнении переполнит стек (RangeError). Такие циклы отклоняем на этапе валидации.
    if (Array.isArray(doc.nodes) && Array.isArray(doc.edges)) {
        const EXECUTABLE_TYPES = new Set(['action', 'condition', 'response']);
        const execIds = new Set(
            doc.nodes.filter((n) => n && EXECUTABLE_TYPES.has(n.type)).map((n) => n.id),
        );
        const adjacency = new Map();
        for (const id of execIds) {
            adjacency.set(id, []);
        }
        for (const e of doc.edges) {
            if (e && execIds.has(e.from) && execIds.has(e.to)) {
                adjacency.get(e.from).push(e.to);
            }
        }
        const visited = new Set();
        const inStack = new Set();
        let hasExecCycle = false;
        const dfs = (nodeId) => {
            visited.add(nodeId);
            inStack.add(nodeId);
            for (const nextId of adjacency.get(nodeId) || []) {
                if (inStack.has(nextId)) {
                    hasExecCycle = true;
                    return;
                }
                if (!visited.has(nextId)) {
                    dfs(nextId);
                    if (hasExecCycle) return;
                }
            }
            inStack.delete(nodeId);
        };
        for (const id of execIds) {
            if (!visited.has(id)) {
                dfs(id);
                if (hasExecCycle) break;
            }
        }
        if (hasExecCycle) {
            errors.push(
                'Обнаружен цикл, состоящий только из блоков action/condition/response. ' +
                    'Такой цикл генерируется как рекурсивные вызовы и приведёт к переполнению стека. ' +
                    'Зациклите сценарий через command или step (переход выполняется через thisIntentName).',
            );
        }
    }

    return errors;
}

module.exports = { generateFromFlow, validateFlowSchema };
