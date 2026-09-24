import { ILogger, TLoggerCb } from '../interfaces/ILogger';
import {
    getRegExp,
    getRegExpOrSelf,
    __$usedRe2,
    isRegex,
    TPatternRegExp,
} from '../../utils/standard/RegExp';
import { isRegexLikelySafe } from './utils';
import os from 'os';
import { BotController } from '../../controller';
import { TAppPlugin } from '../interfaces/IAppContext';
import { TCommandGroupMode } from '../interfaces/IBot';
import { Text } from '../../utils';
import { FALLBACK_COMMAND } from '../constants';
import type { TEventType } from '../events';

/**
 * Данные группы команд для оптимизации поиска.
 * Используется внутренне фреймворком для группировки команд с RegExp.
 */
export interface IGroupData {
    /**
     * Имена команд в этой группе
     */
    commands: string[];
    /**
     * Объединённое регулярное выражение для группы. Строка — временная стадия
     * до debounce-пересборки (компилируется через getGroupRegExpCompiled),
     * `null` — группа ещё не собрана.
     */
    regExp: RegExp | null | string;
    /**
     * Флаги объединённого выражения группы. По умолчанию `ium`; группа из
     * команд, у которых все слоты — RegExp (без isPattern), собирается
     * с флагами самих слотов, чтобы склейка не меняла их семантику.
     */
    flags?: string;
}

/**
 * Кэш скомпилированных регулярных выражений групп, чей паттерн хранится строкой
 * (случай, когда количество групп превысило MAX_COUNT_FOR_GROUP). Ключ — объект
 * группы, значение — паттерн, для которого собран RegExp: строка паттерна растёт
 * при добавлении команд, поэтому кэш сверяет её и пересобирает только при изменении.
 */
const groupCompiledRegExp = new WeakMap<IGroupData, { pattern: string; regExp: RegExp }>();

/**
 * Возвращает скомпилированное регулярное выражение группы.
 * Для строкового паттерна результат кэшируется: перекомпиляция на каждом запросе
 * в горячем пути поиска команд стоила заметного CPU.
 * @param groupData Данные группы
 * @param customReg Кастомный конструктор RegExp (например, re2)
 * @returns Скомпилированное выражение или null, если группа пуста
 */
export function getGroupRegExpCompiled(
    groupData: IGroupData,
    customReg?: RegExpConstructor,
): RegExp | null {
    if (groupData.regExp === null) {
        return null;
    }
    if (typeof groupData.regExp !== 'string') {
        return groupData.regExp;
    }
    const cached = groupCompiledRegExp.get(groupData);
    if (cached && cached.pattern === groupData.regExp) {
        return cached.regExp;
    }
    const regExp = getRegExp(groupData.regExp, groupData.flags ?? 'ium', customReg);
    // Прогреваем регулярку сразу после компиляции — первые вызовы .test/.exec
    // у нового объекта заметно медленнее.
    regExp.test('__umbot_testing');
    regExp.test('');
    groupCompiledRegExp.set(groupData, { pattern: groupData.regExp, regExp });
    return regExp;
}

const LIMIT_COMMANDS = [1e4, 5e4, 1e5];
// Глобальные лимиты, возможно, можно вынести в конфигурацию
let MAX_COUNT_FOR_GROUP = 0;
let MAX_COUNT_FOR_REG = 0;

/**
 * Устанавливает ограничение на количество активных регулярных выражений. Нужна для того, чтобы приложение не падало под нагрузкой.
 */
function setMemoryLimit(): void {
    const total = os.totalmem();
    // re2 гораздо лучше работает с оперативной памятью, а также ограничение на использование памяти не такое суровое:
    // например, нативный RegExp уронит node при 3 400 группах либо при 68 000 обычных регулярках
    // (в этот лимит никогда не попадём, так как максимум активных регулярок порядка 10 000)
    if (total < 0.8 * 1024 ** 3) {
        MAX_COUNT_FOR_GROUP = 200;
        MAX_COUNT_FOR_REG = 1000;
    } else if (total < 1.5 * 1024 ** 3) {
        MAX_COUNT_FOR_GROUP = 800;
        MAX_COUNT_FOR_REG = 1400;
    } else if (total < 3 * 1024 ** 3) {
        MAX_COUNT_FOR_GROUP = 1500;
        MAX_COUNT_FOR_REG = 3000;
    } else {
        MAX_COUNT_FOR_GROUP = 6800;
        MAX_COUNT_FOR_REG = 7000;
    }

    // Если re2 нет, количество активных регулярок для групп нужно сильно сократить, иначе возможно падение nodejs:
    // для групп — в 20 раз, для одиночных регулярных выражений — вдвое
    if (!__$usedRe2) {
        MAX_COUNT_FOR_GROUP /= 20;
        MAX_COUNT_FOR_REG /= 2;
    }
}

setMemoryLimit();

/**
 * Результат проверки слотов на опасные регулярные выражения (ReDoS):
 * статус и, в зависимости от режима strictMode, безопасные либо исходные слоты.
 */
export interface IDangerRegex {
    status: boolean;
    slots: TSlots;
}

interface IGroup {
    name: string;
    regLength: number;
    butchRegexp: unknown[];
    regExpSize: number;
    /**
     * Флаги объединённого выражения: в одну группу попадают только команды
     * с одинаковыми флагами склейки.
     */
    flags: string;
}

/**
 * Тип для слотов команд
 */
export type TSlots = TPatternRegExp[];

/**
 * Параметры команды
 *
 * Определяет структуру команды, включая триггеры активации,
 * флаг использования регулярных выражений и функцию-обработчик.
 *
 * @example
 * ```ts
 * const command: ICommandParam = {
 *   slots: ['привет', 'здравствуй'],
 *   isPattern: false,
 *   isRegExpString: false,
 *   cb: (text, controller) => {
 *     controller.text = 'Привет! Рад вас видеть!';
 *   }
 * };
 * ```
 */
export interface ICommandParam<TBotController extends BotController = BotController> {
    /**
     * Триггеры активации команды
     *
     * Массив слов или регулярных выражений для активации команды.
     */
    slots?: TSlots;
    /**
     * Флаг использования регулярных выражений
     *
     * Если true, строки в slots интерпретируются как регулярные выражения.
     */
    isPattern?: boolean;
    /**
     * Функция-обработчик команды
     *
     * @param {string} userCommand - Текст команды пользователя
     * @param {BotController} botController - Контроллер с бизнес-логикой приложения для управления ответом
     * @returns {void | string | Promise<void | string>} - Строка ответа или void
     *
     * Если функция возвращает строку, она автоматически устанавливается как ответ для платформы.
     */
    cb: (
        userCommand: string,
        botController: TBotController,
    ) => void | string | Promise<void | string>;

    /**
     * Имя группы. Актуально для регулярок
     * @private
     */
    __$groupName?: string | null;
    /**
     * Скомпилированное регулярное выражение
     */
    regExp?: RegExp;
    /**
     * true, если слот-строка скомпилирована как регулярное выражение (isPattern).
     */
    isRegExpString: boolean;
    /**
     * Предвычисленный быстрый путь: у команды ровно один слот, он RegExp без
     * stateful-флагов `g`/`y`, и кастомный движок regexp не подключён.
     * Поиск вызывает `test` напрямую, минуя обёртку Text.isSayText.
     * @private
     */
    __$singleStatelessRegExp?: RegExp;
}

/**
 * Параметры конфигурации шага диалога.
 *
 * Используется для регистрации шагов в системе. Между сессиями персистится
 * только указатель активного шага (oldIntentName в state/userData); сами
 * определения шагов живут в памяти приложения. Активный шаг автоматически
 * восстанавливается при повторном входе пользователя в навык.
 *
 * @example
 * ```ts
 * // Обычный шаг
 * const step: IStepParam = {
 *   stepName: 'hello',
 *   cb: (ctx) => {
 *     ctx.text = 'Привет! Рад вас видеть!';
 *   }
 * };
 *
 * // Шаг с условием пропуска (возврат false)
 * const stepWithFallback: IStepParam = {
 *   stepName: 'expired_game',
 *   cb: (ctx) => {
 *     if (ctx.messageId === 0) {
 *          return false; // Пропустить шаг
 *     }
 *     ctx.text = 'Продолжаем игру...';
 *   }
 * };
 * ```
 */
export interface IStepParam<TBotController extends BotController = BotController> {
    /**
     * Уникальное имя шага. Используется для идентификации и сохранения в сессии.
     */
    stepName: string;
    /**
     * Функция-обработчик шага. Вызывается при активации шага.
     * Если шаг обрабатывать не нужно, то можно вернуть false. В таком случае фреймворк посчитает что шаг не был найден, и продолжит выполнение своей логики с поиском команд.
     *
     * @param {BotController} botController - Контроллер с бизнес-логикой приложения для управления ответом
     * @returns
     * - `void` или `Promise<void>` — шаг активен. Обработка останавливается на этом шаге, ожидается ввод пользователя.
     * - `false` (или `Promise<false>` у async-обработчика) — шаг **игнорируется**. Фреймворк считает,
     *   что шаг не применим, и передаёт управление дальше (команды → интенты → fallback).
     * - строка (или `Promise<string>`) — шаг активен, строка становится текстом ответа
     *   (`ctx.text`), как у обработчика `addCommand`.
     *
     * @example
     * ```ts
     * bot.addStep('ask_name', (ctx) => `Приятно познакомиться, ${ctx.originalUserCommand}!`);
     * ```
     */
    cb: (botController: TBotController) => void | false | string | Promise<void | false | string>;
}

/**
 * Параметры событийного обработчика (`bot.addEvent`).
 *
 * Обработчик получает контроллер, у которого адаптер уже заполнил `eventType`
 * и поля события (`userCommand`, `payload`, `requestObject`).
 */
export interface IEventParam<TBotController extends BotController = BotController> {
    /**
     * Универсальный тип события, на который подписан обработчик.
     */
    eventType: TEventType;
    /**
     * Функция-обработчик события. Вызывается до поиска шагов и команд.
     *
     * Как и обработчик команды, может вернуть строку — она станет текстом ответа.
     */
    cb: (botController: TBotController) => void | string | Promise<void | string> | false;
}

/**
 * Тип для функции обработки кастомного обработчика команд.
 * Кастомный обработчик может быть как синхронным, так и асинхронным. В случае успешного нахождения команды, возвращается название этой команды. В противном случае возвращается null
 * @param userCommand - Команда пользователя
 * @param commands - Список всех зарегистрированных команд
 * @returns {string | null | Promise<string | null>} - Имя найденной команды или null, если совпадений нет
 */
export type TCommandResolver = (
    userCommand: string,
    commands: Map<string, ICommandParam>,
) => string | null | Promise<string | null>;

/**
 * Класс, который берет на себя всю обязанность за регистрацию команд и шагов.
 * Экземпляр не создаётся напрямую — он доступен как `ctx.appContext.command`
 * в обработчиках и middleware.
 *
 * @example
 * ```ts
 * // Динамическая регистрация команды из middleware или обработчика
 * ctx.appContext.command.addCommand('dyn', ['динамика'], (cmd, ctrl) => {
 *     ctrl.text = 'Команда добавлена в рантайме';
 * });
 * ```
 */
export class CommandReg {
    #regExpCommandCount = 0;

    /**
     * Сгруппированные регулярные выражения. Начинает отрабатывать как только было задано более 300 регулярных выражений
     */
    public regexpGroup: Map<string, IGroupData> = new Map();
    #noFullGroups: IGroup | null = null;

    /**
     * Добавленные команды для обработки
     */
    public commands: Map<string, ICommandParam> = new Map();

    readonly #exactMatchMap = new Map<string, string>();
    /**
     * Снимок команд для горячего цикла поиска.
     *
     * Перебор Map через `for...of` аллоцирует пару-массив на каждой итерации —
     * при скане тысяч команд это лишний мусор на каждый запрос. Снимок хранится
     * обычным массивом пар и пересобирается лениво: мутации только помечают
     * его флагом, пересборка происходит при первом поиске. Источник правды —
     * {@link commands} (Map).
     */
    public commandsList: [string, ICommandParam][] = [];

    #commandsListDirty = true;

    /**
     * Возвращает актуальный снимок команд, пересобирая его при необходимости.
     * Вызывается из горячего цикла поиска команд: при неизменном наборе команд
     * (обычный прод-режим) стоимость — одна проверка булевого флага.
     */
    public getActualCommandsList(): [string, ICommandParam][] {
        if (this.#commandsListDirty) {
            this.commandsList = [];
            for (const entry of this.commands) {
                this.commandsList.push(entry);
            }
            this.#commandsListDirty = false;
        }
        return this.commandsList;
    }

    /**
     * Добавленные шаги для обработки
     */
    public steps: Map<string, IStepParam> = new Map();

    /**
     * Флаг строгого режима работы приложения.
     * В строгом режиме работы, все ReDoS регулярные выражения не будут добавляться.
     */
    public strictMode: boolean = false;

    #commandGroupMode: TCommandGroupMode = 'auto';

    /**
     * Кастомизация поиска команд.
     */
    public customCommandResolver: TCommandResolver | undefined;

    private readonly logError: TLoggerCb;
    private readonly logWarn: TLoggerCb;
    private readonly plugins: TAppPlugin;

    /**
     * Конструктор класса CommandReg.
     *
     * @param {ILogger} logger - Логгер для вывода предупреждений и ошибок
     * @param {TAppPlugin} plugins - Плагины приложения (для получения кастомного RegExp)
     */
    constructor(logger: ILogger, plugins: TAppPlugin) {
        this.logWarn = logger.warn as TLoggerCb;
        this.logError = logger.error as TLoggerCb;
        this.plugins = plugins;
    }

    /**
     * Поиск команды по точному совпадению (без RegExp).
     *
     * @param {string} userCommand - Команда пользователя (в нижнем регистре)
     * @returns {string | undefined} Имя найденной команды или undefined
     */
    getExactMatchCommand(userCommand: string): string | undefined {
        // Пустая карта — точного совпадения быть не может.
        if (this.#exactMatchMap.size === 0) {
            return undefined;
        }
        return this.#exactMatchMap.get(userCommand);
    }

    /**
     * Возвращает конструктор RegExp (например, re2), заданный плагином regExp,
     * для компиляции регулярных выражений. Если плагин не подключён — undefined.
     */
    getCustomRegExp(): RegExpConstructor | undefined {
        const reg = this.plugins.regExp;
        if (reg) {
            return typeof reg === 'function' ? reg() : reg.getData();
        }
        return undefined;
    }

    /**
     * Устанавливает режим группировки регулярных выражений.
     *
     * @param {TCommandGroupMode} mode - Режим группировки: 'auto', 'group' или 'no-group'
     */
    setCommandGroupMode(mode: TCommandGroupMode): void {
        this.#commandGroupMode = mode;
    }

    /**
     * Сообщает о найденном небезопасном регулярном выражении.
     *
     * Уровень намеренно зависит от окружения. Без `re2` движок регулярных выражений
     * Node подвержен катастрофическому бэктрекингу: одно сообщение пользователя
     * может занять поток на минуты, и бот перестанет отвечать вообще всем.
     * Поэтому такая связка — это ошибка, а не предупреждение.
     *
     * @param patterns Небезопасные шаблоны
     */
    #logDangerRegex(patterns: string): void {
        const base = `Найдено небезопасное регулярное выражение (ReDoS), проверьте его корректность: ${patterns}`;
        if (this.strictMode) {
            this.logError(`${base}. Выражение отключено (strictMode).`, {});
            return;
        }
        if (!__$usedRe2) {
            this.logError(
                `${base}. Пакет re2 не установлен, поэтому выражение выполняется штатным движком Node ` +
                    'с экспоненциальным бэктрекингом: специально подобранное сообщение пользователя ' +
                    'заблокирует поток и бот перестанет отвечать всем. Установите re2 (npm i re2) ' +
                    'либо включите strictMode, либо перепишите выражение.',
                {},
            );
            return;
        }
        // re2 совместим не со всеми выражениями (lookaround, обратные ссылки):
        // такие шаблоны getRegExp/getRegExpOrSelf пересобирают штатным движком,
        // поэтому честная формулировка — про совместимые, а не про все.
        this.logWarn(`${base}. Совместимые с re2 выражения выполняются без бэктрекинга.`, {});
    }

    /**
     * Проверяет, что переданное регулярное выражение не содержит уязвимых к ReDoS конструкций.
     *
     * Если выражение признано небезопасным:
     * - В обычном режиме пишется сообщение (ошибка без `re2`, предупреждение с ним),
     *   и выражение используется как есть.
     * - В `strictMode` — пишется ошибка, и небезопасные слоты отбрасываются
     *   (`status: false`; для одиночного RegExp возвращаются пустые слоты,
     *   для массива — только безопасные слоты).
     *
     * @param slots Слот(ы) или регулярное выражение для проверки.
     * @returns Исходные слоты (в обычном режиме) или безопасные слоты с флагом ошибки.
     */
    isDangerRegex(slots: TSlots | RegExp): IDangerRegex {
        if (isRegex(slots)) {
            if (!isRegexLikelySafe(slots.source, true)) {
                this.#logDangerRegex(slots.source);
                if (this.strictMode) {
                    return {
                        status: false,
                        slots: [],
                    };
                } else {
                    return { status: true, slots: [slots] };
                }
            }
            return {
                status: true,
                slots: [slots],
            };
        } else {
            const correctSlots: TSlots | undefined = [];
            const errors: string[] | undefined = [];
            for (const slot of slots) {
                const isReg = isRegex(slot);
                const slotStr = isReg ? slot.source : slot;
                if (isRegexLikelySafe(slotStr, isReg)) {
                    correctSlots.push(slot);
                } else {
                    errors.push(slotStr);
                }
            }
            const status = errors.length === 0;
            if (!status) {
                this.#logDangerRegex(errors.join(', '));
                errors.length = 0;
            }
            return { status, slots: this.strictMode ? correctSlots : slots };
        }
    }

    #timeOutReg: ReturnType<typeof setTimeout> | undefined;
    #oldFnGroup: (() => void) | undefined;
    #oldGroupName: string | undefined;

    #getGroupRegExp(
        groupData: IGroupData,
        slots: TSlots,
        group: IGroup,
        useReg: boolean = true,
        isRegUp: boolean = true,
    ): void {
        group.butchRegexp ??= [];
        groupData.flags = group.flags;
        const parts = slots.map((s) => {
            return `(${typeof s === 'string' ? s : s.source})`;
        });
        const groupIndex = group.butchRegexp.length;
        // Для уменьшения длины регулярного выражения, а также для исключения случая,
        // когда имя команды может быть некорректным для имени группы, сами задаём корректное имя с учётом индекса
        const pat = `(?<_${groupIndex}>${parts?.join('|')})`;
        group.butchRegexp.push(pat);
        group.regExpSize += pat.length;
        const pattern = group.butchRegexp.join('|');
        if (useReg) {
            if (group.name !== this.#oldGroupName && this.#timeOutReg) {
                this.#oldFnGroup?.();
                this.#oldGroupName = group.name;
            }
            if (this.#timeOutReg) {
                clearTimeout(this.#timeOutReg);
                this.#timeOutReg = undefined;
            }
            this.#oldFnGroup = (): void => {
                const finalPattern = group.butchRegexp.join('|');
                const regExp = getRegExp(finalPattern, group.flags, this.getCustomRegExp());
                if (isRegUp) {
                    // прогреваем регулярку
                    regExp.test('__umbot_testing');
                    regExp.test('');
                }
                groupData.regExp = regExp;
                this.#timeOutReg = undefined;
                this.#oldFnGroup = undefined;
            };

            this.#timeOutReg = setTimeout(this.#oldFnGroup, 35).unref();
            groupData.regExp = pattern;
            return;
        } else {
            if (this.#timeOutReg && this.#oldGroupName !== group.name) {
                this.#oldFnGroup?.();
            }
            clearTimeout(this.#timeOutReg);
            this.#oldFnGroup = undefined;
            this.#oldGroupName = undefined;
            this.#timeOutReg = undefined;
        }
        groupData.regExp = pattern;
    }

    /**
     * Закрывает текущую группу, чтобы следующая отдельная команда не попала внутрь её диапазона.
     */
    #closeRegexpGroup(): void {
        if (!this.#noFullGroups) {
            return;
        }
        if (
            this.regexpGroup.has(this.#noFullGroups.name) &&
            ((this.regexpGroup.get(this.#noFullGroups.name) as IGroupData).commands.length || 0) < 2
        ) {
            this.regexpGroup.delete(this.#noFullGroups.name);
        }
        this.#noFullGroups = null;
    }

    #addRegexpInGroup(
        commandName: string,
        slots: TSlots,
        isRegexp: boolean,
        flags: string = 'ium',
    ): string | null {
        // Если количество команд до 300, то нет необходимости в объединении регулярок, так как это не даст сильного преимущества
        if (
            this.#commandGroupMode === 'no-group' ||
            (this.#commandGroupMode === 'auto' && this.#regExpCommandCount < 300)
        ) {
            return commandName;
        }
        if (isRegexp) {
            if (!isRegexLikelySafe(slots.join('|'), false)) {
                this.#closeRegexpGroup();
                return commandName;
            }
            // Группа компилируется с одним набором флагов: команда с другими
            // флагами открывает новую группу, иначе склейка изменила бы её семантику.
            if (this.#noFullGroups && this.#noFullGroups.flags !== flags) {
                this.#closeRegexpGroup();
            }
            if (this.#noFullGroups) {
                let groupName = this.#noFullGroups.name;
                let groupData = this.regexpGroup.get(groupName) || { commands: [], regExp: null };
                if (
                    this.#noFullGroups.butchRegexp.length === 1 &&
                    this.#noFullGroups.name !== commandName
                ) {
                    const command = this.commands.get(this.#noFullGroups.name);
                    if (command) {
                        // exactOptionalPropertyTypes: убираем поле целиком, а не
                        // присваиваем undefined.
                        delete command.regExp;
                        command.isRegExpString = false;
                        this.commands.set(this.#noFullGroups.name, command);
                    }
                }
                // В среднем 9 символов резервируется под стандартный шаблон группы.
                // Позволяет примерно 60 команд с регулярками при суммарной длине шаблонов до 850 символов
                if (
                    this.#noFullGroups.regLength >= 60 ||
                    (this.#noFullGroups.regExpSize || 0) > 850
                ) {
                    groupData = { commands: [], regExp: null };
                    groupName = commandName;
                    this.#noFullGroups = {
                        name: commandName,
                        regLength: 0,
                        butchRegexp: [],
                        regExpSize: 0,
                        flags,
                    };
                }
                groupData.commands.push(commandName);
                this.#getGroupRegExp(
                    groupData,
                    slots,
                    this.#noFullGroups,
                    this.regexpGroup.size < MAX_COUNT_FOR_GROUP,
                );

                this.regexpGroup.set(groupName, groupData);
                this.#noFullGroups.regLength += slots.length;
                return groupName;
            } else {
                const butchRegexp = [];
                const parts = slots.map((s) => {
                    return `(${typeof s === 'string' ? s : s.source})`;
                });
                // Имя команды — публичный произвольный идентификатор и не может быть
                // именем capture-группы: например, дефис недопустим в RegExp.
                // Поиск группы всегда использует числовые имена _0, _1, … .
                butchRegexp.push(`(?<_0>${parts.join('|')})`);
                const regExp = getRegExp(`${butchRegexp.join('|')}`, flags, this.getCustomRegExp());
                this.#noFullGroups = {
                    name: commandName,
                    regLength: slots.length,
                    butchRegexp,
                    regExpSize: regExp.source.length,
                    flags,
                };
                this.regexpGroup.set(commandName, {
                    commands: [commandName],
                    regExp,
                    flags,
                });
                return commandName;
            }
        } else {
            this.#closeRegexpGroup();
            return null;
        }
    }

    #removeRegexpInGroup(commandName: string): void {
        const getReg = (
            groupData: IGroupData,
            newCommandName: string,
            newCommands: string[],
            group: IGroup,
            useReg: boolean,
        ): void => {
            newCommands.forEach((cName) => {
                const command = this.commands.get(cName);
                if (command) {
                    command.__$groupName = newCommandName;
                    this.commands.set(cName, command);
                    this.#getGroupRegExp(groupData, command.slots as TSlots, group, useReg, false);
                }
            });
        };
        if (this.regexpGroup.has(commandName)) {
            const group = this.regexpGroup.get(commandName);
            this.regexpGroup.delete(commandName);
            if (group?.commands?.length) {
                const newCommands = group?.commands.filter((gCommand) => {
                    return gCommand !== commandName;
                });
                // Если других команд в группе не осталось — группа не нужна
                if (!newCommands.length) {
                    return;
                }
                const newCommandName = newCommands[0];
                if (!newCommandName) {
                    return;
                }
                const nGroup: IGroup = {
                    name: newCommandName,
                    regLength: 0,
                    butchRegexp: [],
                    regExpSize: 0,
                    flags: group.flags ?? 'ium',
                };
                const groupData: IGroupData = {
                    commands: newCommands,
                    regExp: null,
                };
                getReg(
                    groupData,
                    newCommandName,
                    newCommands,
                    nGroup,
                    typeof group.regExp !== 'string',
                );
                this.regexpGroup.set(newCommandName, groupData);
            }
        } else if (this.commands.has(commandName)) {
            const command = this.commands.get(commandName);
            if (command?.__$groupName && this.regexpGroup.has(command?.__$groupName)) {
                const group = this.regexpGroup.get(command.__$groupName);
                if (group) {
                    const newCommands = group?.commands.filter((gCommand) => {
                        return gCommand !== commandName;
                    });
                    const nGroup: IGroup = {
                        // Хост группы не меняется — удаляемая команда не была хостом
                        name: command.__$groupName as string,
                        regLength: 0,
                        butchRegexp: [],
                        regExpSize: 0,
                        flags: group.flags ?? 'ium',
                    };
                    const groupData: IGroupData = {
                        commands: newCommands,
                        regExp: null,
                    };
                    getReg(
                        groupData,
                        command.__$groupName as string,
                        newCommands,
                        nGroup,
                        typeof group.regExp !== 'string',
                    );
                    this.regexpGroup.set(command.__$groupName, groupData);
                }
            }
        }
    }

    /**
     * Добавляет команду для обработки пользовательских запросов
     *
     * ⚙️ Оптимизация: при регистрации более 300 команд с регулярными выражениями
     * фреймворк автоматически объединяет их в группы для повышения производительности.
     *
     * @param {string} commandName - Уникальный идентификатор команды
     * @param {TSlots} slots - Триггеры для активации команды
     *   - Если элемент — строка → ищется как подстрока (`text.includes(...)`).
     *   - Если элемент — RegExp → проверяется как регулярное выражение (`.test(text)`).
     *   - При `isPattern = true` строковые слоты компилируются в одно объединённое
     *     регулярное выражение с флагом `ium`.
     *   - При `isPattern = false` каждый элемент обрабатывается по своему типу:
     *        - string → как литерал (поиск подстроки),
     *        - RegExp → как регулярное выражение
     *   - Если ВСЕ слоты — готовые RegExp, isPattern для строк не применяется
     *     (строк нет) и команда трактуется как pattern. Без явного isPattern
     *     слоты склеиваются с их собственными (общими) флагами, а не с `ium`;
     *     слоты с разными флагами проверяются по отдельности.
     * @param {ICommandParam['cb']} cb - Функция-обработчик команды
     * @param {boolean} isPattern - Использовать регулярные выражения (по умолчанию false)
     *
     * @example
     * Простая команда со словами:
     * ```ts
     * commandReg.addCommand(
     *   'greeting',
     *   ['привет', 'здравствуй'],
     *   (cmd, ctrl) => {
     *     if (ctrl) ctrl.text = 'Здравствуйте!';
     *   }
     * );
     * ```
     *
     * @example
     * Команда с регулярными выражениями:
     * ```ts
     * // Обработка чисел от 1 до 999
     * commandReg.addCommand(
     *   'number',
     *   ['\\b([1-9]|[1-9][0-9]|[1-9][0-9][0-9])\\b'],
     *   (cmd, ctrl) => {
     *     if (ctrl) ctrl.text = `Вы ввели число: ${cmd}`;
     *   },
     *   true  // включаем поддержку регулярных выражений
     * );
     * ```
     *
     * @example
     * Команда с доступом к состоянию:
     * ```ts
     * commandReg.addCommand(
     *   'stats',
     *   ['статистика'],
     *   async (cmd, ctrl) => {
     *     if (ctrl) {
     *       // Доступ к пользовательским данным
     *       const visits = ctrl.userData?.visits || 0;
     *       ctrl.text = `Вы использовали приложение ${visits} раз`;
     *
     *       // Доступ к кнопкам и другим UI элементам
     *       ctrl.buttons
     *         .addBtn('Сбросить статистику')
     *         .addBtn('Закрыть');
     *     }
     *   }
     * );
     * ```
     *
     * @remarks
     * Поиск команд оптимизирован:
     * 1. Сначала проверяется точное совпадение
     * 2. Если точного совпадения нет — выполняется последовательный перебор
     *
     * При регистрации более 300 команд с регулярными выражениями
     * фреймворк автоматически объединяет их в группы для повышения производительности.
     *
     * При isPattern=true используются регулярные выражения JavaScript
     * В callback доступен весь функционал BotController
     * Можно использовать async функции в callback
     */
    public addCommand<TBotController extends BotController = BotController>(
        commandName: string,
        slots: TSlots,
        cb: ICommandParam<TBotController>['cb'],
        isPattern: boolean = false,
    ): void {
        if (this.commands.get(commandName)) {
            this.logWarn(
                `Команда с названием "${commandName === FALLBACK_COMMAND ? '* (fallback command)' : commandName}" уже создавалась ранее. Ранее созданная команда будет перезаписана. Рекомендуется проверить корректность регистрации команды`,
            );
        }
        if (commandName === FALLBACK_COMMAND) {
            this.commands.set(commandName, {
                isPattern: false,
                cb: cb as ICommandParam['cb'],
                isRegExpString: false,
                __$groupName: commandName,
            });
            this.#commandsListDirty = true;
            return;
        }

        const size = this.commands.size;
        if (LIMIT_COMMANDS.includes(size)) {
            this.logWarn(
                `Задано ${this.commands.size} команд, скорее всего команды задаются через цикл, который возможно отработал некорректно. Проверьте корректность работы приложения, а также корректность добавленных команд.`,
            );
        }

        const isPatternCommand = isPattern || this.#isAllRegExpSlots(slots);
        let correctSlots: TSlots = this.strictMode ? [] : slots;
        let regExp: RegExp | undefined;
        let groupName: string | null | undefined;
        if (isPatternCommand) {
            ({ correctSlots, regExp, groupName } = this.#registerPatternSlots(
                commandName,
                slots,
                isPattern,
            ));
        } else {
            this.#addRegexpInGroup(commandName, correctSlots, false);
            for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                if (!slot) {
                    continue;
                }
                if (isRegex(slot)) {
                    const res = this.isDangerRegex(slot);
                    if (res.status && this.strictMode) {
                        correctSlots.push(slot);
                    }
                } else {
                    if (this.strictMode) {
                        correctSlots.push(slot);
                    }
                    const tCommandName = this.#exactMatchMap.get(slot);
                    if (!tCommandName) {
                        this.#exactMatchMap.set(slot, commandName);
                    }
                }
            }
        }
        if (correctSlots.length) {
            this.commands.set(
                commandName,
                this.#buildCommandParam(correctSlots, isPatternCommand, cb, regExp, groupName),
            );
            this.#commandsListDirty = true;
        }
    }

    /**
     * Регистрирует слоты pattern-команды: отбрасывает небезопасные (strictMode),
     * включает команду в группу регулярок и компилирует объединённое выражение.
     *
     * Явный isPattern склеивает слоты с флагами 'ium', как и раньше. Команда
     * из одних RegExp без isPattern склеивается с флагами самих слотов:
     * иначе /^да$/ получил бы флаг m (и i, u) и стал бы совпадать с «ну\nда».
     *
     * @param commandName Имя команды
     * @param slots Слоты команды
     * @param isPattern Явно переданный флаг isPattern
     * @returns Безопасные слоты, скомпилированное выражение и имя группы
     */
    #registerPatternSlots(
        commandName: string,
        slots: TSlots,
        isPattern: boolean,
    ): { correctSlots: TSlots; regExp: RegExp | undefined; groupName: string | null | undefined } {
        const correctSlots = this.isDangerRegex(slots).slots;
        let regExp: RegExp | undefined;
        let groupName: string | null | undefined;
        const flags = isPattern ? 'ium' : this.#getCommonFlags(correctSlots);
        if (flags === null) {
            // Флаги слотов различаются — одним выражением их не выразить:
            // слоты проверяются по отдельности, каждый со своими флагами.
            this.#addRegexpInGroup(commandName, correctSlots, false);
        } else if (correctSlots.length) {
            groupName = this.#addRegexpInGroup(commandName, correctSlots, true, flags);
            if (groupName === commandName) {
                this.#regExpCommandCount++;
                if (this.#regExpCommandCount < MAX_COUNT_FOR_REG) {
                    regExp = getRegExp(correctSlots, flags, this.getCustomRegExp());
                    regExp.test('__umbot_testing');
                    regExp.test('');
                }
            }
        }
        return { correctSlots, regExp, groupName };
    }

    /**
     * Проверяет, что ВСЕ слоты команды — готовые RegExp (строковых нет).
     *
     * Такая команда семантически эквивалентна isPattern: строк в слотах нет,
     * «строковая» интерпретация не нужна. Выделено из addCommand для
     * читаемости и снижения сложности метода.
     *
     * @param slots Слоты команды
     * @returns true, если массив непуст и каждый элемент — RegExp
     */
    #isAllRegExpSlots(slots: TSlots): boolean {
        if (slots.length === 0) {
            return false;
        }
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!slot || !isRegex(slot)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Возвращает общие флаги RegExp-слотов (без stateful `g`/`y`) — с ними
     * объединение слотов в одно выражение не меняет семантику матчинга.
     * `RegExp.flags` всегда в каноническом порядке, поэтому достаточно
     * сравнения строк.
     *
     * @param slots Слоты команды (все — RegExp)
     * @returns Общие флаги или null, если флаги слотов различаются
     */
    #getCommonFlags(slots: TSlots): string | null {
        let common: string | null = null;
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!isRegex(slot)) {
                continue;
            }
            const flags = slot.flags.replace(/[gy]/g, '');
            if (common === null) {
                common = flags;
            } else if (common !== flags) {
                return null;
            }
        }
        return common ?? '';
    }

    /**
     * Собирает запись команды для реестра.
     *
     * exactOptionalPropertyTypes: опциональные поля (`regExp`, `__$groupName`,
     * `__$singleStatelessRegExp`) заполняются только реальными значениями,
     * без протаскивания undefined.
     *
     * @param slots Слоты команды после валидации ReDoS
     * @param isPattern Флаг регулярных выражений
     * @param cb Обработчик команды
     * @param regExp Скомпилированное выражение (если есть)
     * @param groupName Имя группы регулярок (если есть)
     * @returns Готовая запись ICommandParam
     */
    #buildCommandParam<TBotController extends BotController>(
        slots: TSlots,
        isPattern: boolean,
        cb: ICommandParam<TBotController>['cb'],
        regExp: RegExp | undefined,
        groupName: string | null | undefined,
    ): ICommandParam {
        const commandParam: ICommandParam = {
            slots,
            isPattern,
            cb: cb as ICommandParam['cb'],
            isRegExpString: regExp !== undefined,
        };
        if (regExp !== undefined) {
            commandParam.regExp = regExp;
        }
        if (groupName !== undefined) {
            commandParam.__$groupName = groupName;
        }
        const singleStatelessRegExp = this.#getSingleStatelessRegExp(slots);
        if (singleStatelessRegExp !== undefined) {
            commandParam.__$singleStatelessRegExp = singleStatelessRegExp;
        }
        return commandParam;
    }

    /**
     * Вычисляет RegExp для быстрого пути поиска: команда с ровно одним слотом-RegExp
     * без stateful-флагов `g`/`y` и без кастомного движка может проверяться
     * прямым `.test` в горячем цикле, минуя обёртку Text.isSayText.
     *
     * Наличие движка проверяем по plugins.regExp напрямую, без вызова
     * getCustomRegExp(): у плагина-функции могут быть сайд-эффекты.
     * При установленном re2 слот один раз пересобирается через него
     * (getRegExpOrSelf) — быстрый путь не должен обходить безопасный движок.
     *
     * @param slots Слоты команды после валидации ReDoS
     * @returns Готовый к прямому тесту RegExp или undefined, если условия не выполнены
     */
    #getSingleStatelessRegExp(slots: TSlots): RegExp | undefined {
        const slot = slots[0];
        if (
            !this.plugins.regExp &&
            slots.length === 1 &&
            isRegex(slot) &&
            !slot.global &&
            !slot.sticky
        ) {
            return __$usedRe2 ? getRegExpOrSelf(slot) : slot;
        }
        return undefined;
    }

    /**
     * Удаляет команду
     * @param commandName - Имя команды
     */
    public removeCommand(commandName: string): void {
        if (commandName === FALLBACK_COMMAND) {
            this.commands.delete(commandName);
            return;
        }
        if (this.commands.has(commandName)) {
            const command = this.commands.get(commandName);
            if (command?.isPattern && (command.regExp || command.__$groupName)) {
                this.#regExpCommandCount--;
                if (this.#regExpCommandCount < 0) {
                    this.#regExpCommandCount = 0;
                }
            }
            command?.slots?.forEach((slot) => {
                if (!isRegex(slot)) {
                    this.#exactMatchMap.delete(slot);
                }
            });
            // Сначала удаляем из regexp-групп (пока информация о команде ещё доступна),
            // и только потом удаляем из this.commands — иначе #removeRegexpInGroup
            // не сможет найти принадлежность к группе через __$groupName.
            this.#removeRegexpInGroup(commandName);
            this.commands.delete(commandName);
        } else {
            // Команды нет в this.commands, но она могла остаться хостом группы
            this.#removeRegexpInGroup(commandName);
        }
        this.#commandsListDirty = true;
    }

    /**
     * Удаляет все зарегистрированные команды
     */
    public clearCommands(): void {
        this.commands.clear();
        this.#noFullGroups = null;
        this.#regExpCommandCount = 0;
        this.regexpGroup.clear();
        this.#exactMatchMap.clear();
        this.#oldGroupName = undefined;
        this.#oldFnGroup = undefined;
        clearTimeout(this.#timeOutReg);
        this.#timeOutReg = undefined;
        this.#commandsListDirty = true;
        Text.clearCache();
    }

    /**
     * Регистрирует обработчик для именованного шага диалога.
     *
     * Шаг — это часть **многошагового сценария** (например: "регистрация", "оформление заказа").
     * После вызова `ctx.thisIntentName = 'myStep'` в команде или другом шаге,
     * следующее сообщение пользователя будет обработано этим обработчиком.
     *
     * > 💡 Обработчик получает полный `BotController`, как и в командах:
     * > доступны `this.text`, `this.userData`, `this.buttons`, `this.thisIntentName` и т.д.
     *
     * @param stepName — Уникальное имя шага (например, `'enter_email'`).
     * @param handler — Функция, вызываемая при получении сообщения в этом шаге.
     * @returns Текущий экземпляр `CommandReg`.
     *
     * @example
     * ```ts
     * bot.addStep('confirm_age', (ctx) => {
     *   if (ctx.userCommand === 'да') {
     *     ctx.text = 'Отлично! Добро пожаловать.';
     *     ctx.thisIntentName = null; // завершаем сценарий
     *   } else {
     *     ctx.text = 'Извините, вход запрещён.';
     *     ctx.thisIntentName = 'goodbye'; // переходим к другому шагу
     *   }
     * });
     * ```
     */
    public addStep<TBotController extends BotController = BotController>(
        stepName: string,
        handler: IStepParam<TBotController>['cb'],
    ): this {
        this.steps.set(stepName, {
            stepName: stepName,
            cb: handler as IStepParam['cb'],
        });
        return this;
    }

    /**
     * Удаляет зарегистрированный шаг по имени.
     *
     * После удаления шаг больше не будет обрабатываться, даже если активен у пользователя.
     * (Рекомендуется завершать активные сценарии через `ctx.thisIntentName = null` перед удалением.)
     *
     * @param stepName — Имя шага для удаления.
     * @returns Текущий экземпляр `CommandReg`.
     */
    public removeStep(stepName: string): this {
        this.steps.delete(stepName);
        return this;
    }

    /**
     * Удаляет **все** зарегистрированные шаги.
     *
     * > ⚠️ Это **глобальная операция**: все сценарии станут недоступны.
     * > Используйте с осторожностью (например, при перезагрузке логики приложения).
     *
     * @returns Текущий экземпляр `CommandReg`.
     */
    public clearSteps(): this {
        this.steps.clear();
        return this;
    }

    /**
     * Добавленные событийные обработчики (`bot.addEvent`). Ключ — тип события.
     *
     * @internal Реестр принадлежит только {@link addEvent}/{@link removeEvent}/
     * {@link clearEvents}: внешние мутации рассинхронизируют `#hasEvents`, и
     * обработчики молча перестанут вызываться. Для чтения используйте
     * {@link events} и {@link hasEvents}.
     */
    #events: Map<TEventType, IEventParam['cb'][]> = new Map();

    /**
     * Быстрый флаг «есть хоть один событийный обработчик» для горячего пути run().
     * Поддерживается методами addEvent/removeEvent/clearEvents.
     */
    #hasEvents: boolean = false;

    /**
     * Зарегистрированные событийные обработчики (только чтение).
     *
     * Readonly-аксессор над внутренним реестром: Map не пересоздаётся, чтение
     * в горячем пути `BotController.#eventResolver` остаётся дешёвым. Мутации
     * извне запрещены — только через {@link addEvent}/{@link removeEvent}/{@link clearEvents}.
     */
    public get events(): ReadonlyMap<TEventType, IEventParam['cb'][]> {
        return this.#events;
    }

    /**
     * Флаг «есть хоть один событийный обработчик» (только чтение).
     *
     * Обновляется методами регистрации/очистки; прямое присваивание извне
     * невозможно, поэтому флаг не разъедется с реестром.
     */
    public get hasEvents(): boolean {
        return this.#hasEvents;
    }

    /**
     * Регистрирует обработчик универсального события платформы.
     *
     * Обработчики событий вызываются до поиска шагов и команд. На одно событие
     * можно зарегистрировать несколько обработчиков: они опрашиваются в порядке
     * регистрации, пока один не вернёт строку-ответ (цепочка останавливается).
     * Обработчик с `false` передаёт событие следующему обработчику; когда все
     * отказались — запрос уходит в обычный конвейер (шаг → команда → интент →
     * fallback).
     *
     * @param eventType Универсальный тип события (`'photo'`, `'callback'`, …)
     * @param cb Функция-обработчик; может вернуть строку (текст ответа) или
     *   `false` (событие «не мой» — обработка продолжится по обычному конвейеру)
     */
    public addEvent<TBotController extends BotController = BotController>(
        eventType: TEventType,
        cb: IEventParam<TBotController>['cb'],
    ): this {
        const handlers = this.#events.get(eventType);
        if (handlers) {
            handlers.push(cb as IEventParam['cb']);
        } else {
            this.#events.set(eventType, [cb as IEventParam['cb']]);
        }
        this.#hasEvents = true;
        return this;
    }

    /**
     * Удаляет все обработчики указанного события.
     *
     * @param eventType Тип события
     * @returns Текущий экземпляр `CommandReg`
     */
    public removeEvent(eventType: TEventType): this {
        this.#events.delete(eventType);
        this.#hasEvents = this.#events.size > 0;
        return this;
    }

    /**
     * Удаляет **все** зарегистрированные событийные обработчики.
     *
     * @returns Текущий экземпляр `CommandReg`
     */
    public clearEvents(): this {
        this.#events.clear();
        this.#hasEvents = false;
        return this;
    }
}
