/**
 * Контекст приложения: конфигурация, токены, реестры, логгер и метрики.
 * Создаётся фреймворком внутри Bot; напрямую не инстанцируется — доступ
 * через `bot.getAppContext()`.
 *
 * Предоставляет функциональность для:
 * - Управления конфигурацией приложения
 * - Работы с базой данных
 * - Обработки команд и интентов
 * - Логирования и сохранения данных
 *
 * Основные возможности:
 * - Поддержка множества платформ (Алиса, Маруся, SmartApp, Telegram, Viber, VK, MAX)
 * - Гибкая система конфигурации
 * - Управление командами и интентами
 * - Работа с базой данных
 * - Логирование и отладка
 *
 * @example
 * ```ts
 * import { Bot } from 'umbot';
 * const bot = new Bot();
 * // Доступ к контексту — через getAppContext()
 * const appContext = bot.getAppContext();
 * // Настройка конфигурации
 * appContext.setAppConfig({
 *   error_log: './logs',
 *   json: './data',
 *   isLocalStorage: true,
 *   // База данных опциональна
 *   db: {
 *     host: 'localhost',
 *     database: 'bot_db',
 *     user: 'admin',
 *     pass: 'password'
 *   }
 * });
 *
 * // Настройка параметров
 * appContext.setPlatformParams({
 *   welcome_text: 'Привет! Чем могу помочь?',
 *   help_text: 'Список доступных команд: ...',
 *   intents: [
 *     {
 *       name: 'greeting',
 *       slots: ['привет', 'здравствуй'],
 *       is_pattern: false
 *     },
 *     {
 *       name: 'numbers',
 *       slots: ['\\b\\d{3}\\b'],
 *       is_pattern: true // Явно указываем, что используем регулярное выражение
 *     }
 *   ]
 * });
 * ```
 */
import { IDatabaseAdapter, IDatabaseInfo, IPlatform } from './interfaces/IBot';
import { ILogger } from './interfaces/ILogger';
import {
    IAppConfig,
    IAppParam,
    TAppMode,
    THttpClient,
    IDir,
    TAppPlugin,
    IAppDB,
} from './interfaces/IAppContext';

import { CommandReg, ICommandParam, IGroupData, IStepParam } from './utils/CommandReg';
import { IEnvConfig, loadEnvFile } from '../utils/EnvConfig';
import { saveData, safeStringify } from '../utils';
import {
    WELCOME_INTENT_NAME,
    WELCOME_INTENT_SLOTS,
    HELP_INTENT_NAME,
    HELP_INTENT_SLOTS,
} from './constants';
import * as process from 'node:process';
import { join } from 'node:path';
import { rename, stat } from 'node:fs/promises';

/**
 * Тип платформы: Автоопределение
 */
export const T_AUTO = 'auto';

const regBot = /bot\d+:[A-Za-z0-9_-]{35,}/g;
// «Голый» токен Telegram <bot_id>:<хвост> — regBot требует префикс "bot"
// и ловит его только внутри URL API.
const regTelegramBare = /\b\d{6,12}:[A-Za-z0-9_-]{34,}\b/g;
// Сервисный токен VK — vk1.a.<payload>, с точками.
const regVk = /\bvk1\.a\.[A-Za-z0-9_-]{20,}/g;
// JWT (Сбер SmartApp, OAuth-провайдеры): три base64url-сегмента через точку.
const regJwt = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
// Значения под «говорящими» ключами в JSON-подобных строках. Двоеточие — вне
// захватываемой группы, чтобы паттерн срабатывал на обычном JSON.
// password/pass — конфигурация БД попадает в логи в текстовой форме
// ("pass":"hunter2"), а не только как metadata-ключи.
const regVk2 =
    /("(?:access_token|client_secret|vk_confirmation_token|sber_token|oauth|api_key|api-key|private_key|password|pass)"|client_secret|vk_confirmation_token|sber_token|oauth|api_key|api-key|private_key|password|pass)\s*:\s*"([^"]{8,})"/g;
const regToken = /"[A-Za-z0-9+/=]{30,256}"/g;
// Произвольные «токеноподобные» строки. Порог 40: реальный токен Viber —
// ~46 hex-символов. Дефис/underscore разрешены внутри, но не по краям.
const regToken2 = /\b[A-Za-z0-9](?:[A-Za-z0-9_-]{38,254})[A-Za-z0-9]\b/g;
// Токен Яндекс OAuth (Алиса): y0_A... / y1_A... — короче, чем берёт regToken2.
const regYandexOAuth = /\by[01]_[A-Za-z0-9_-]{20,}\b/g;
// UUID (MAX и другие платформы): 8-4-4-4-12 hex с дефисами; каждый сегмент
// короче порога regToken2.
const regUuid = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
// Api-Key Yandex SpeechKit — ровно 32 hex-символа, короче порога regToken2.
const regApiKey = /\b[A-Fa-f0-9]{32}\b/g;
// IAM-токен Яндекса (yc CLI, Cloud Functions, serverless-деплой из CLI):
// сегментный формат t1.<base64url>.<base64url> — точки не дают regToken2
// (он требует непрерывную строку 38+ символов) захватить токен целиком.
const regYandexIam = /\bt1\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

/**
 * Ключи метаданных, значение которых маскируется целиком независимо от формата.
 * Формат токенов у платформ меняется, а имя поля — нет.
 *
 * `pass` с границей слова — иначе ключ `pass` из конфигурации БД
 * (`db: {host, user, pass}`) не покрывался.
 */
const SECRET_KEY_PATTERN =
    /token|secret|password|passwd|pass\b|api[_-]?key|private[_-]?key|authorization|credential|access[_-]?key|client[_-]?secret/i;

const PATTERNS = [
    { regex: regBot, replacement: 'bot***' },
    { regex: regTelegramBare, replacement: '***' },
    { regex: regVk, replacement: 'vk1.a.***' },
    { regex: regJwt, replacement: '***' },
    { regex: regYandexOAuth, replacement: '***' },
    { regex: regYandexIam, replacement: 't1.***' },
    { regex: regUuid, replacement: '***' },
    { regex: regApiKey, replacement: '***' },
    {
        regex: regVk2,
        replacement: '$1:"***"',
    },
    { regex: regToken, replacement: '"***"' },
    { regex: regToken2, replacement: '***' },
];

/**
 * Сколько подряд неудачных попыток записи файловых логов допускается
 * до срабатывания защиты и паузы.
 */
const LOG_STORAGE_MAX_FAILURES = 3;

/**
 * Длительность паузы записи файловых логов после срабатывания защиты, мс.
 * В течение паузы накопленные записи отбрасываются: недоступный диск
 * (read-only ФС в serverless, отсутствие прав) за это время доступнее не станет.
 */
const LOG_STORAGE_PAUSE_MS = 60_000;

/**
 * Размер файла лога (error.log / warn.log), после которого он переименовывается в `<имя>.1`.
 * Итого на диске не больше двух файлов на каждый лог.
 */
const LOG_FILE_MAX_SIZE = 10 * 1024 * 1024;

interface IErrWarnData {
    errors: string[];
    warnings: string[];
    timeout: ReturnType<typeof setTimeout> | null;
}

/**
 * Режим приложения по умолчанию: `strict_prod` при `NODE_ENV=production`, иначе `dev`.
 * @returns Режим, который действует, пока не вызван `setAppMode()`
 */
function getDefaultAppMode(): TAppMode {
    return process.env.NODE_ENV === 'production' ? 'strict_prod' : 'dev';
}

/**
 * Внутренний класс для хранения состояния и конфигурации приложения.
 * Используется внутри Bot для хранения состояния и конфигурации
 *
 * @remarks
 * Разработчикам обычно НЕ нужно создавать экземпляры этого класса напрямую.
 * Вместо этого используйте методы класса {@link Bot}:
 * - `bot.getAppContext()` - получить доступ к контексту
 * - `bot.setAppConfig()` - настроить конфигурацию
 * - `bot.setPlatformParams()` - настроить параметры платформ
 *
 * Этот класс содержит:
 * - Конфигурацию приложения (IAppConfig)
 * - Параметры платформ (IAppParam)
 * - Регистрацию команд и интентов
 * - Логирование и метрики
 * - Подключение к БД
 *
 * @example
 * ```ts
 * // AppContext создаётся самим Bot:
 * const bot = new Bot();
 * const appContext = bot.getAppContext(); // если нужен прямой доступ
 * ```
 */
export class AppContext<TDbInfo = IDatabaseInfo, TQuery = unknown> {
    /**
     * Список подключенных платформ
     */
    platforms: IPlatform<TQuery> = {};

    /**
     * Список подключенных плагинов
     */
    plugins: TAppPlugin = {};
    /**
     * Информация по подключению к базе данных.
     */
    database: {
        /**
         * Адаптер для работы с базой данных
         */
        adapter?: IDatabaseAdapter;
        /**
         * Данные, необходимые адаптеру для работы
         */
        databaseInfo?: TDbInfo;
        /**
         * Флаг, определяющий, успешно ли подключился метод connect адаптера базы данных
         */
        isSendConnect?: boolean;
    } = {};

    #errWarnData: IErrWarnData = {
        errors: [],
        warnings: [],
        timeout: null,
    };

    /**
     * Последняя запущенная запись файловых логов: следующая запись ждёт её (см. #saveErrorData).
     */
    #logWrite: Promise<void> = Promise.resolve();

    /**
     * Счётчик подряд идущих неудачных попыток записи файловых логов.
     * Часть защиты от недоступного хранилища (см. #writeErrorData).
     */
    #logStorageFailCount = 0;

    /**
     * Момент времени (мс), до которого запись файловых логов приостановлена
     * после серии сбоев. 0 — пауза не активна.
     */
    #logStoragePausedUntil = 0;

    #logErrorBind = this.logError.bind(this);

    /**
     * Менеджер регистрации команд, шагов и событий (CommandReg).
     * Сами команды — через геттер `command.commands`, шаги — `command.steps`.
     */
    public command: CommandReg = new CommandReg(
        {
            warn: this.logWarn.bind(this),
            error: this.#logErrorBind,
        },
        this.plugins,
    );

    /**
     * Получение всех зарегистрированных команд
     */
    public get commands(): Map<string, ICommandParam> {
        return this.command.commands;
    }

    /**
     * Получение всех зарегистрированных шагов
     */
    public get steps(): Map<string, IStepParam> {
        return this.command.steps;
    }

    /**
     * Получение всех зарегистрированных команд, которые распределены по группам.
     * В группу добавляются только команды с регулярными выражениями.
     * Группы используются для оптимизации поиска нужной команды
     */
    public get regexpGroup(): Map<string, IGroupData> {
        return this.command.regexpGroup;
    }

    /**
     * Переменные окружения
     */
    #envVars: IEnvConfig | undefined;

    /**
     * Флаг: кэш `#envVars` заполнен тихим чтением process.env без настроенного env.
     * Такой кэш не должен прятать явно указанный env-файл при повторном вызове.
     */
    #envVarsFromSilentEnv = false;

    /**
     * Путь env-файла, из которого заполнен текущий кэш `#envVars`.
     * Смена `appConfig.env` с одного файла на другой перечитывает файл,
     * а не удерживает кэш первого пути.
     */
    #envVarsPath: string | null = null;

    /**
     * Кастомный logger приложения
     */
    #logger: ILogger | null = null;

    /**
     * Кэш значения usedMetric: геттер считается при смене логгера, а не на каждом
     * запросе (используется в горячем пути несколько раз за запрос).
     */
    #usedMetricCache: boolean = false;

    /**
     * Конфигурация приложения
     */
    public appConfig: Required<Omit<IAppConfig, 'memorySession'>> &
        Pick<IAppConfig, 'memorySession'> = {
        error_log: join(process.cwd(), 'logs'),
        json: join(process.cwd(), 'json'),
        db: { host: '', user: '', pass: '', database: '' },
        isLocalStorage: false,
        tokens: {},
        env: '',
    };

    /**
     * Параметры приложения
     */
    public platformParams: IAppParam = {
        isAuthUser: false,
        welcome_text: 'Текст приветствия',
        help_text: 'Текст помощи',
        empty_text: 'Извините, но я вас не понимаю',
        intents: [
            { name: WELCOME_INTENT_NAME, slots: WELCOME_INTENT_SLOTS },
            { name: HELP_INTENT_NAME, slots: HELP_INTENT_SLOTS },
        ],
        utm_text: null,
    };

    /**
     * Кастомный HTTP-клиент для выполнения всех исходящих запросов фреймворка.
     * По умолчанию используется глобальный `fetch`.
     * Вы можете заменить его на любой совместимый клиент (например, axios, undici, got),
     * реализующий интерфейс:
     * ```ts
     * (input: RequestInfo, init?: RequestInit) => Promise<Response>
     * ```
     * Это позволяет:
     * - добавлять retry-логику, таймауты, circuit breaker;
     * - внедрять tracing, метрики или логирование всех запросов;
     * - мокать сетевые вызовы в тестах;
     * - использовать альтернативные HTTP-библиотеки.
     * @example
     * ```ts
     * const bot = new Bot();
     * const ctx = bot.getAppContext();
     * ctx.httpClient = async (url, options) => {
     *   // добавляем таймаут 5 сек
     *   const controller = new AbortController();
     *   const id = setTimeout(() => controller.abort(), 5000);
     *   try {
     *     const res = await fetch(url, { ...options, signal: controller.signal });
     *     clearTimeout(id);
     *     return res;
     *   } catch (e) {
     *     clearTimeout(id);
     *     throw e;
     *   }
     * };
     * ```
     */
    public httpClient: THttpClient = global.fetch;

    /**
     * Определяет режим работы приложения.
     *
     * По умолчанию — `dev`, а при `NODE_ENV=production` — `strict_prod` (как Express и
     * сборщики фронтенда переключаются на прод по `NODE_ENV`). Явный `bot.setAppMode()`
     * всегда главнее. Режим по умолчанию определяется при создании контекста, до
     * регистрации команд: strict_prod проверяет регулярные выражения при регистрации.
     */
    public appMode: TAppMode = getDefaultAppMode();

    /**
     * Создаёт контекст приложения. При `NODE_ENV=production` сразу включает строгую
     * проверку регулярных выражений (режим `strict_prod`).
     *
     * @example
     * ```ts
     * // NODE_ENV=production node dist/index.js
     * const ctx = new AppContext();
     * ctx.appMode; // 'strict_prod'
     * ```
     */
    public constructor() {
        this.command.strictMode = this.appMode === 'strict_prod';
    }

    /**
     * Закрывает все подключения, для корректного завершения работы приложения
     *
     * @returns {Promise<void>} Завершается, когда все подключения закрыты и логи сохранены
     *
     * @example
     * ```ts
     * await bot.getAppContext().close(); // при завершении работы приложения
     * ```
     */
    public async close(): Promise<void> {
        await this.#saveErrorData();
        if (this.database.adapter && this.database.isSendConnect) {
            await this.database.adapter.destroy();
        }
    }

    /**
     * Установка всех токенов из переменных окружения или параметров
     * @param {boolean} [overwrite=true] - Перезаписывать ли уже заданные токены.
     * `false` используется для фонового чтения process.env, чтобы не затереть
     * токены, которые пользователь явно задал через конструктор адаптера или `setAppConfig`.
     */
    #setTokens(overwrite: boolean = true): void {
        const envVars = this.#getEnvVars();
        if (envVars) {
            // Не самое хорошее решение, но возможно этот вариант кому-то удобен
            const applyEnvValue = (platformName: string, field: string, value?: string): void => {
                if (!value) {
                    return;
                }
                this.appConfig.tokens[platformName] ??= {};
                if (overwrite || this.appConfig.tokens[platformName][field] === undefined) {
                    this.appConfig.tokens[platformName][field] = value;
                }
            };

            applyEnvValue('viber', 'token', envVars.VIBER_TOKEN);
            applyEnvValue('telegram', 'token', envVars.TELEGRAM_TOKEN);
            applyEnvValue('vk', 'token', envVars.VK_TOKEN);
            applyEnvValue('vk', 'confirmation_token', envVars.VK_CONFIRMATION_TOKEN);
            applyEnvValue('vk', 'secret_key', envVars.VK_SECRET_KEY);
            applyEnvValue('max_app', 'token', envVars.MAX_TOKEN);
            applyEnvValue('telegram', 'webhookSecret', envVars.TELEGRAM_WEBHOOK_SECRET);
            applyEnvValue('max_app', 'webhookSecret', envVars.MAX_WEBHOOK_SECRET);
            applyEnvValue('marusia', 'token', envVars.MARUSIA_TOKEN);
            applyEnvValue('alisa', 'token', envVars.ALISA_TOKEN || envVars.YANDEX_TOKEN);
            // Токен SmartApp адаптеру не нужен (подписи у Сбера нет), но CLI
            // генерирует SMARTAPP_TOKEN — он должен попадать в конфиг, а не отбрасываться.
            applyEnvValue('smart_app', 'token', envVars.SMARTAPP_TOKEN);

            // SpeechKit отвечает за TTS в чат-платформах Telegram, VK и Max,
            // поэтому один токен раскладывается сразу по трём платформам.
            applyEnvValue('telegram', 'speech_kit_token', envVars.SPEECH_KIT_TOKEN);
            applyEnvValue('vk', 'speech_kit_token', envVars.SPEECH_KIT_TOKEN);
            applyEnvValue('max_app', 'speech_kit_token', envVars.SPEECH_KIT_TOKEN);
        }
    }

    /**
     * Собирает конфигурацию окружения из process.env: токены платформ и настройки БД.
     * Вынесено из `#getEnvVars`, чтобы деструктуризация не раздувала метод.
     * @returns Объект с переменными окружения (пустой, если process.env недоступен)
     */
    #readEnvFromProcess(): IEnvConfig {
        if (!process.env) {
            return {};
        }
        const {
            // Получаем токен для viber
            VIBER_TOKEN,
            // Получаем токен для telegram
            TELEGRAM_TOKEN,
            // Получаем токен для vk
            VK_TOKEN,
            // Получаем токен для max
            MAX_TOKEN,
            // Секреты вебхуков Telegram и MAX (включают проверку подписи)
            TELEGRAM_WEBHOOK_SECRET,
            MAX_WEBHOOK_SECRET,
            // Получаем токен для подтверждения vk
            VK_CONFIRMATION_TOKEN,
            // Получаем секретный ключ VK Callback API
            VK_SECRET_KEY,
            // Получаем токен для маруси
            MARUSIA_TOKEN,
            // Получаем токен для Сбер SmartApp (генерируется CLI в .env)
            SMARTAPP_TOKEN,
            // Получаем токен для работы с api яндекса (каноническое имя)
            ALISA_TOKEN,
            // Устаревшее имя токена Алисы — сохранено для обратной совместимости
            YANDEX_TOKEN,
            // Получаем токен Yandex SpeechKit для TTS в чат-платформах
            SPEECH_KIT_TOKEN,
            // Получаем хост для подключения к базе
            DB_HOST,
            // Получаем имя пользователя для подключения к базе
            DB_USER,
            // Получаем пароль пользователя для подключения к базе
            DB_PASSWORD,
            // Получаем имя базы данных
            DB_NAME,
        } = process.env;
        // exactOptionalPropertyTypes: поля заполняем только реально существующими
        // значениями, undefined-поля не добавляем.
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries({
            VIBER_TOKEN,
            TELEGRAM_TOKEN,
            VK_TOKEN,
            MAX_TOKEN,
            TELEGRAM_WEBHOOK_SECRET,
            MAX_WEBHOOK_SECRET,
            VK_CONFIRMATION_TOKEN,
            VK_SECRET_KEY,
            MARUSIA_TOKEN,
            SMARTAPP_TOKEN,
            ALISA_TOKEN,
            YANDEX_TOKEN,
            SPEECH_KIT_TOKEN,
            DB_HOST,
            DB_USER,
            DB_PASSWORD,
            DB_NAME,
        })) {
            if (value !== undefined) {
                env[key] = value;
            }
        }
        return env as IEnvConfig;
    }

    /**
     * Возвращает объект с настройками окружения
     * @param {string|null|undefined} envPath - Путь к файлу окружения, `'local'` для чтения
     * из process.env или `null`, чтобы принудительно прочитать process.env без настроенного env.
     * Если параметр не передан, используется `appConfig.env`.
     */
    #getEnvVars(envPath: string | null | undefined = undefined): IEnvConfig | undefined {
        const resolvedPath = envPath === undefined ? this.appConfig?.env : envPath;
        const setEnvFn = (errorMsg: string, silent: boolean = false): void => {
            // Используем доступ к env, чтобы получить токены для Viber, Telegram и других сервисов.
            // Это необходимо для работы с api и базой данных. Используется только в случае,
            // если явно хотят работать с env-файлами.
            const correctEnvValue = this.#readEnvFromProcess();
            let isError = true;
            Object.values(correctEnvValue).forEach((correctEnvValue) => {
                if (correctEnvValue) {
                    isError = false;
                }
            });
            if (isError) {
                // В тихом режиме не ругаемся: переменные просто не заданы,
                // и это нормальная ситуация (например, токены переданы через конструктор адаптера).
                if (!silent) {
                    this.logError('AppContext: ' + errorMsg);
                }
            } else {
                this.#envVars = correctEnvValue;
                this.#envVarsFromSilentEnv = silent;
                this.#envVarsPath = null;
            }
        };
        if (resolvedPath === 'local') {
            setEnvFn('Не удалось получить данные из process.env');
            // Возвращаем результаты сразу, чтобы не возникло ситуации, когда пытается прочитать файл local
            return this.#envVars;
        }
        // Кэш от тихого чтения process.env не должен прятать явно указанный
        // env-файл: если env настроен после тихого подхвата или путь сменился
        // на другой файл — читаем файл заново.
        if (
            this.#envVars &&
            this.#envVarsPath === resolvedPath &&
            !(this.#envVarsFromSilentEnv && resolvedPath)
        ) {
            return this.#envVars;
        }
        if (resolvedPath) {
            const res = loadEnvFile(resolvedPath);
            if (res.status) {
                this.#envVars = res.data;
                this.#envVarsFromSilentEnv = false;
                this.#envVarsPath = resolvedPath;
            } else {
                setEnvFn(
                    (res.error as string) + '. Также не удалось получить данные из process.env',
                );
            }
        } else {
            // Env-файл не настроен — пробуем подтянуть токены прямо из process.env.
            // Благодаря этому токены, переданные через `docker run -e` или переменные
            // окружения в serverless-окружении, работают без явного `env: 'local'`.
            setEnvFn('', true);
        }
        return this.#envVars;
    }

    /**
     * Дописывает настройки БД из переменных окружения в конфиг приложения.
     *
     * Пишем в конфиг, только если есть настройки для подключения: существующий
     * `appConfig.db` либо переменные DB_HOST/DB_NAME.
     *
     * @param {IEnvConfig} envVars Загруженные переменные окружения
     */
    #applyEnvDbConfig(envVars: IEnvConfig): void {
        if (!(this.appConfig.db || envVars.DB_HOST || envVars.DB_NAME)) {
            return;
        }
        const dbConfig: IAppDB = {
            host: envVars.DB_HOST || this.appConfig.db?.host || '',
            database: envVars.DB_NAME || this.appConfig.db?.database || '',
        };
        // exactOptionalPropertyTypes: опциональные поля заполняем только
        // реальными значениями, чтобы не протаскивать undefined в конфиг.
        const dbUser = envVars.DB_USER || this.appConfig.db?.user;
        if (dbUser) {
            dbConfig.user = dbUser;
        }
        const dbPass = envVars.DB_PASSWORD || this.appConfig.db?.pass;
        if (dbPass) {
            dbConfig.pass = dbPass;
        }
        if (this.appConfig.db?.options) {
            dbConfig.options = this.appConfig.db.options;
        }
        this.appConfig.db = dbConfig;
    }

    /**
     * Устанавливает конфигурацию приложения
     * @param {Partial<IAppConfig>} config - Пользовательская конфигурация
     * @returns {void}
     *
     * @example
     * ```ts
     * ctx.setAppConfig({ error_log: './logs', json: './data' });
     * ```
     */
    public setAppConfig(config: Partial<IAppConfig>): void {
        const correctConfig: Partial<IAppConfig> = { ...config };
        if (correctConfig.tokens) {
            for (const platform of Object.keys(correctConfig.tokens)) {
                this.appConfig.tokens[platform] = {
                    ...this.appConfig.tokens[platform],
                    ...correctConfig.tokens[platform],
                };
            }
            delete correctConfig.tokens;
        }
        this.appConfig = {
            ...this.appConfig,
            ...correctConfig,
        };
        if (correctConfig.env) {
            const envVars = this.#getEnvVars(correctConfig.env);
            if (envVars) {
                this.#applyEnvDbConfig(envVars);
                this.#setTokens();
            }
        } else if (!this.appConfig.env) {
            // Env не настроен (нет ни файла, ни 'local') — тихо пробуем дозаполнить токены
            // из process.env, чтобы работал сценарий `docker run -e TELEGRAM_TOKEN=...`.
            // Уже заданные токены при этом не перезаписываются.
            const envVars = this.#getEnvVars(null);
            if (envVars) {
                this.#setTokens(false);
            }
        }
    }

    /**
     * Устанавливает параметры приложения
     * @param {IAppParam} params - Пользовательские параметры
     * @returns {void}
     *
     * @example
     * ```ts
     * ctx.setPlatformParams({ welcome_text: 'Привет!', help_text: 'Список команд…' });
     * ```
     */
    public setPlatformParams(params: IAppParam): void {
        this.platformParams = { ...this.platformParams, ...params };
        if (this.platformParams.intents) {
            this.platformParams.intents = this.platformParams.intents.map((intent) => ({
                ...intent,
                slots: [...intent.slots],
            }));
        }
        this.platformParams.intents =
            this.platformParams.intents?.filter((intent) => {
                if (intent.is_pattern) {
                    const res = this.command.isDangerRegex(intent.slots);
                    if (res.slots.length) {
                        if (res.slots.length !== intent.slots.length) {
                            intent.slots = res.slots as string[];
                        }
                        return true;
                    }
                    return false;
                }
                return true;
            }) || [];
        // Перезапись токенов значениями из окружения допустима только при явно
        // настроенном env ('local' или файл). При тихом подхвате process.env
        // токены, заданные разработчиком, не затираются.
        this.#setTokens(!!this.appConfig.env);
    }

    /**
     * Позволяет установить свою реализацию для логирования
     * @param {ILogger | null} logger - Экземпляр логгера или null для отключения
     * @returns {void}
     *
     * @example
     * ```ts
     * ctx.setLogger({ error: (msg, meta) => console.error(msg, meta) });
     * ```
     */
    public setLogger(logger: ILogger | null): void {
        this.#logger = logger;
        // Кэш для горячего пути: usedMetric вызывается несколько раз на каждый
        // запрос, а геттер делает optional-chain проверку логгера. Пересчитываем
        // только при смене логгера.
        this.#usedMetricCache = !!logger?.metric;
    }

    /**
     * Логирование информации
     *
     * ⚠️ **Секреты не маскируются.** В отличие от {@link logError} / {@link logWarn} /
     * {@link logMetric}, этот метод НЕ прогоняет аргументы через конвейер
     * маскирования — они уходят в логгер как есть. Предназначен для
     * операционных сообщений (статус сервера, метрики старта). Никогда не
     * передавайте сюда токены, пароли и другие секреты; для диагностики
     * с метаданными используйте `logWarn`/`logError`.
     *
     * @param {...unknown[]} args - Аргументы для логирования
     *
     * @example
     * ```ts
     * ctx.log('Запрос обработан за', 42, 'мс');
     * ctx.log({ userId: '123', command: 'start' });
     * ```
     */
    public log(...args: unknown[]): void {
        if (this.#logger?.log) {
            this.#logger.log(...args);
        } else {
            console.log(...args);
        }
    }

    /**
     * Логирование ошибки
     * @param {string} str - Текст ошибки
     * @param {Record<string, unknown>} [meta] - Дополнительные метаданные
     *
     * @example
     * ```ts
     * ctx.logError('Ошибка подключения к БД', { host: 'localhost', error: err.message });
     * ```
     */
    public logError(str: string, meta?: Record<string, unknown>): void {
        const [maskedText, maskedMeta] = this.#maskLogData(str, meta);
        if (this.#logger?.error) {
            this.#logger.error(maskedText, maskedMeta);
        } else {
            const data = maskedMeta
                ? { ...maskedMeta, trace: new Error().stack }
                : { trace: new Error().stack };
            const serialized = safeStringify(data, null, '\t');
            this.#errWarnLog(`${maskedText}\n${serialized}`, true);
            // Файл logs/error.log в контейнере и serverless никто не читает (а на
            // read-only ФС он и не пишется), поэтому вне dev дублируем короткую строку
            // в stderr — она попадёт в `docker logs` и журнал функции.
            // В dev #errWarnLog и так печатает ошибку в консоль.
            if (this.appMode !== 'dev') {
                process.stderr.write(`[umbot] ${maskedText}\n`);
            }
        }
    }

    /**
     * Возвращает флаг, который говорит о том, нужно ли собирать метрики
     *
     * @returns {boolean} true, если заданный логгер реализует метод metric
     *
     * @example
     * ```ts
     * if (ctx.usedMetric) {
     *   ctx.logMetric('GET_COMMAND', 0.42, { platform: 'alisa' });
     * }
     * ```
     */
    public get usedMetric(): boolean {
        return this.#usedMetricCache;
    }

    /**
     * Логирование метрики
     *
     * Имя метрики и label проходят тот же конвейер маскирования секретов, что и
     * logError/logWarn: в label может попасть, например, полный URL запроса, а
     * для Telegram он содержит токен бота (`https://api.telegram.org/bot<ТОКЕН>/...`),
     * который не должен попасть в системы наблюдаемости.
     *
     * @param name - имя метрики
     * @param value - значение
     * @param label - Дополнительные метаданные
     *
     * @example
     * ```ts
     * ctx.logMetric('GET_COMMAND', 0.42, { platform: 'alisa', command: 'weather' });
     * ctx.logMetric('DB_SELECT', 12.5, { table: 'UsersData' });
     * ```
     */
    public logMetric(name: string, value: unknown, label: Record<string, unknown>): void {
        if (this.#logger?.metric) {
            const [maskedName, maskedLabel] = this.#maskLogData(name, label);
            this.#logger.metric(maskedName, value, maskedLabel ?? label);
        }
    }

    /**
     * Записывает накопленные логи в файлы. Записи идут строго по очереди: две параллельные
     * записи могли бы одновременно ротировать файл и затереть архив `.1` новым файлом.
     * @returns Промис завершения записи
     */
    #saveErrorData(): Promise<void> {
        const write = this.#logWrite.then(() => this.#writeErrorData());
        // Сбой одной записи не должен останавливать следующие.
        this.#logWrite = write.catch(() => undefined);
        return write;
    }

    async #writeErrorData(): Promise<void> {
        if (this.#errWarnData.timeout) {
            clearTimeout(this.#errWarnData.timeout);
        }
        const warnings = this.#errWarnData.warnings.splice(0);
        const errors = this.#errWarnData.errors.splice(0);
        this.#errWarnData.errors = [];
        this.#errWarnData.warnings = [];
        this.#errWarnData.timeout = null;
        if (!warnings.length && !errors.length) {
            return;
        }

        // Защита от недоступного хранилища (read-only ФС в serverless, нет прав,
        // путь занят файлом). Пока пауза активна, накопленные записи отбрасываются
        // без попыток записи: о проблеме уже сообщено в stderr, а повторные попытки
        // ничего не дадут, только раздуют память.
        if (Date.now() < this.#logStoragePausedUntil) {
            return;
        }

        const results = await Promise.all([
            warnings.length
                ? this.#saveLog('warn.log', warnings.join('\n'), false).catch(() => false)
                : Promise.resolve(true),
            errors.length
                ? this.#saveLog('error.log', errors.join('\n'), false).catch(() => false)
                : Promise.resolve(true),
        ]);
        if (results.every(Boolean)) {
            // Хранилище доступно (в том числе снова доступно после паузы) —
            // снимаем счётчик сбоев.
            this.#logStorageFailCount = 0;
            return;
        }
        this.#logStorageFailCount++;
        if (this.#logStorageFailCount >= LOG_STORAGE_MAX_FAILURES) {
            this.#logStorageFailCount = 0;
            this.#logStoragePausedUntil = Date.now() + LOG_STORAGE_PAUSE_MS;
            this.#reportLogStorageFailure();
        }
    }

    /**
     * Сообщает о недоступности хранилища логов в обход самого конвейера логирования.
     * Писать об этом через logError нельзя — конвейер неисправен, получим
     * зацикливание «ошибки записи ошибки». Поэтому напрямую в stderr.
     */
    #reportLogStorageFailure(): void {
        process.stderr.write(
            `[umbot] Не удалось записать логи в "${this.appConfig.error_log}". ` +
                `Запись приостановлена на ${Math.round(LOG_STORAGE_PAUSE_MS / 1000)} с, ` +
                `новые записи за это время будут отброшены.\n`,
        );
    }

    #errWarnLog(msg: string, isError: boolean): void {
        if (isError) {
            this.#errWarnData.errors.push(`[${new Date().toISOString()}]: ${msg}`);
        } else {
            this.#errWarnData.warnings.push(`[${new Date().toISOString()}]: ${msg}`);
        }
        if (!this.#errWarnData.timeout) {
            this.#errWarnData.timeout = setTimeout(() => {
                this.#errWarnData.timeout = null;
                this.#saveErrorData().catch(() => {
                    // Сбои записи обрабатываются внутри #writeErrorData;
                    // логировать их здесь нельзя — новый цикл ошибок.
                });
            }, 200).unref();
        }
    }

    /**
     * Логирование предупреждения
     * @param {string} str - Текст предупреждения
     * @param {Record<string, unknown>} [meta] - Дополнительные метаданные
     * @param {object} [options] - Параметры вывода
     * @param {boolean} [options.stderr=false] - Вне режима `dev` и без своего логгера дублировать
     *   текст в stderr, как это делает {@link logError}. Для предупреждений, которые нельзя
     *   пропустить (безопасность конфигурации): файл `warn.log` в контейнере никто не читает.
     *
     * @example
     * ```ts
     * ctx.logWarn('Текст обрезан до 1024 символов', { original: longText, truncated: shortText });
     * ctx.logWarn('Вебхук принимает запросы без проверки подписи', undefined, { stderr: true });
     * ```
     */
    public logWarn(
        str: string,
        meta?: Record<string, unknown>,
        options?: { stderr?: boolean },
    ): void {
        const [maskedText, maskedMeta] = this.#maskLogData(str, meta);
        if (this.#logger?.warn) {
            this.#logger.warn(maskedText, maskedMeta);
        } else {
            if (this.appMode === 'dev') {
                if (maskedMeta) {
                    console.warn(maskedText, maskedMeta);
                } else {
                    console.warn(maskedText);
                }
            } else if (options?.stderr) {
                process.stderr.write(`[umbot] ${maskedText}\n`);
            }
            this.#errWarnLog(
                maskedMeta ? `${maskedText}\n${safeStringify(maskedMeta, null, '\t')}` : maskedText,
                false,
            );
        }
    }

    /**
     * Сохраняет данные в JSON файл
     * @param fileName - Имя файла
     * @param data - Данные для сохранения
     * @returns Promise<boolean> — true в случае успешного сохранения
     *
     * @example
     * ```ts
     * const saved = await ctx.saveFileData('config.json', { key: 'value' });
     * if (saved) console.log('Данные сохранены');
     * ```
     */
    public async saveFileData(fileName: string, data: unknown): Promise<boolean> {
        const dir: IDir = {
            path: this.appConfig.json || join(__dirname, '..', '..', 'json'),
            fileName: fileName,
        };
        return saveData(dir, JSON.stringify(data), undefined, this.#logErrorBind);
    }

    /**
     * Скрывает секретные данные в тексте
     * @param text - Текст для маскировки секретов
     */
    #maskSecrets(text: string): string {
        if (!text || this.#logger?.maskSecrets === false) {
            return text;
        }

        let result = text;
        for (const { regex, replacement } of PATTERNS) {
            result = result.replace(regex, replacement);
        }

        return result;
    }

    /**
     * Маскирует текст и метаданные перед передачей в любой логгер.
     *
     * Копия метаданных создаётся рекурсивно, чтобы пользовательский объект не
     * изменялся. Набор текущего пути нужен именно для циклов: повторная ссылка
     * в другой ветке должна быть обработана повторно, а не ошибочно считаться циклом.
     */
    #maskLogData(
        text: string,
        meta?: Record<string, unknown>,
    ): [string, Record<string, unknown> | undefined] {
        if (this.#logger?.maskSecrets === false) {
            return [text, meta];
        }

        let maskedMeta: Record<string, unknown> | undefined;
        if (meta) {
            try {
                maskedMeta = this.#maskUnknown(meta, new Set()) as Record<string, unknown>;
            } catch {
                // Кидающий геттер или revoked Proxy в meta не должны ломать логирование:
                // logError вызывается в catch-блоках, и исключение там потеряет исходную ошибку.
                maskedMeta = { meta: '[meta unserializable]' };
            }
        }
        return [this.#maskSecrets(text), maskedMeta];
    }

    /**
     * Рекурсивно создаёт безопасную для логирования копию неизвестного значения.
     */
    #maskUnknown(value: unknown, parents: Set<object>): unknown {
        if (typeof value === 'string') {
            return this.#maskSecrets(value);
        }
        if (value === null || typeof value !== 'object') {
            return value;
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (parents.has(value)) {
            return '[Circular]';
        }

        parents.add(value);
        try {
            if (value instanceof Error) {
                return {
                    name: value.name,
                    message: this.#maskSecrets(value.message),
                    ...(value.stack ? { stack: this.#maskSecrets(value.stack) } : {}),
                };
            }
            if (Array.isArray(value)) {
                return value.map((item) => this.#maskUnknown(item, parents));
            }

            const result: Record<string, unknown> = {};
            for (const [key, item] of Object.entries(value)) {
                // Поле с «говорящим» именем маскируем целиком вместе с вложенными
                // объектами и массивами: формат токена у платформы может измениться,
                // а имя поля в метаданных останется тем же.
                if (SECRET_KEY_PATTERN.test(key)) {
                    result[key] = '***';
                    continue;
                }
                result[key] = this.#maskUnknown(item, parents);
            }
            return result;
        } finally {
            parents.delete(value);
        }
    }

    /**
     * Сохраняет лог ошибки
     * @param {string} fileName - Имя файла лога
     * @param {string} errorText - Текст ошибки
     * @param {boolean} usedDate - Флаг, говорящий о том, нужно ли добавлять время или нет.
     * @returns {Promise<boolean>} true в случае успешного сохранения
     */
    async #saveLog(
        fileName: string,
        errorText: string | null = '',
        usedDate: boolean = true,
    ): Promise<boolean> {
        const msg = `${usedDate ? `[${new Date().toISOString()}]: ` : ''}${errorText}\n`;
        const dir: IDir = {
            path: this.appConfig.error_log || join(__dirname, '..', '..', 'json'),
            fileName,
        };
        if (this.appMode === 'dev') {
            console.error(msg);
        }
        await this.#rotateLogIfNeeded(join(dir.path, fileName));
        // errorLogger не передаётся: сбой записи лога через logError породил бы
        // новую запись — цикл ошибок. Обработкой сбоев занимается #writeErrorData.
        return saveData(dir, this.#maskSecrets(msg), 'a');
    }

    /**
     * Переименовывает файл лога в `<имя>.1` (предыдущая копия заменяется), когда он
     * достиг `LOG_FILE_MAX_SIZE`. Логи пишет и анонимный трафик (мусорные запросы
     * на вебхук), поэтому без предела файл растёт, пока не займёт весь диск.
     *
     * @param filePath Полный путь к файлу лога
     */
    async #rotateLogIfNeeded(filePath: string): Promise<void> {
        try {
            const info = await stat(filePath);
            if (info.size >= LOG_FILE_MAX_SIZE) {
                await rename(filePath, `${filePath}.1`);
            }
        } catch {
            // Файла ещё нет или ротация не удалась — запись продолжится в текущий файл.
        }
    }
}
