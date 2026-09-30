/**
 * Ядро конфигурации и типов для umbot.
 *
 * Этот файл определяет:
 * - Режимы работы приложения (dev / prod)
 * - Структуру конфигурации (пути, БД, токены)
 * - Формат команд (интентов)
 * - Систему плагинов (i18n, NLU, RegExp)
 *
 * Все типы предназначены для строгой типизации и автодополнения в IDE.
 */
import { INlu } from '../../components';
import type { IMemorySessionConfig } from '../utils/MemorySessionStorage';

/**
 * Режим работы приложения.
 * - `dev` — разработка: включены логи и отладка; ReDoS-проверка регулярных выражений
 *   выполняется (ошибки логируются), но небезопасные выражения не отклоняются.
 * - `prod` — продакшн: минимальные логи; ReDoS-проверка выполняется, но небезопасные выражения не отклоняются (только логируются).
 * - `strict_prod` — строгий продакшн: запрещены любые отклонения от спецификации платформ, включена полная валидация.
 */
export type TAppMode = 'dev' | 'prod' | 'strict_prod';
/**
 * Тип для HTTP-клиента, используемого в приложении.
 *
 * Должен соответствовать fetch-совместимому API.
 * Может быть заменён на кастомную реализацию (например, с таймаутами, retry).
 *
 * @example
 * ```ts
 * const customFetch: THttpClient = async (url, init) => {
 *   const controller = new AbortController();
 *   const timeout = setTimeout(() => controller.abort(), 5000);
 *   try {
 *     return await fetch(url, { ...init, signal: controller.signal });
 *   } finally {
 *     clearTimeout(timeout);
 *   }
 * };
 * ```
 */
export type THttpClient = (url: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

/**
 * @interface IDir
 * Интерфейс для работы с директориями
 *
 * Используется для указания пути к файлу и его имени
 * при сохранении данных.
 *
 * @example
 * ```ts
 * const dir: IDir = {
 *   path: './data',
 *   fileName: 'config.json'
 * };
 * ```
 */
export interface IDir {
    /**
     * Путь к директории
     *
     * Может быть абсолютным или относительным путем
     * к директории, где будет сохранен файл.
     */
    path: string;
    /**
     * Имя файла
     *
     * Имя файла, который будет создан в указанной директории.
     */
    fileName: string;
}

/**
 * Поддерживаемые платформы приложения.
 *
 * Допустимые значения:
 * - `T_ALISA` — Яндекс.Алиса
 * - `T_VK` — ВКонтакте
 * - `T_TELEGRAM` — Telegram
 * - `T_VIBER` — Viber
 * - `T_MARUSIA` — Маруся (Mail.ru)
 * - `T_SMART_APP` — Сбер SmartApp
 * - `T_MAX_APP` — MAX
 * - `string` — любое произвольное имя платформы, для которой реализован адаптер
 *
 * @remarks
 * Использование неизвестного значения может привести к отсутствию адаптера и ошибкам выполнения.
 */
export type TAppType = string;

/**
 * Константы для метрик
 */
export enum EMetric {
    REQUEST = 'umbot_http_request_duration_ms',
    GET_INTENT = 'umbot_get-intent_duration_ms',
    GET_COMMAND = 'umbot_get-command_duration_ms',
    ACTION = 'umbot_action_duration_ms',
    MIDDLEWARE = 'umbot_middleware_duration_ms',
    START_WEBHOOK = 'umbot_request_start',
    END_WEBHOOK = 'umbot_request_duration_ms',
    DB_UPDATE = 'umbot_db_update_ms',
    DB_INSERT = 'umbot_db_insert_ms',
    DB_REMOVE = 'umbot_db_remove_ms',
    DB_SELECT = 'umbot_db_select_ms',
}

/**
 * @interface IAppDB
 * Параметры подключения к базе данных
 *
 * Определяет параметры для подключения к базе данных,
 * включая хост, учетные данные и дополнительные опции.
 *
 * @example
 * ```ts
 * const dbConfig: IAppDB = {
 *   host: 'localhost',
 *   user: 'admin',
 *   pass: 'password',
 *   database: 'bot_db',
 *   options: {
 *     port: 3306,
 *     charset: 'utf8mb4'
 *   }
 * };
 * ```
 */
export interface IAppDB {
    /**
     * Адрес сервера базы данных
     *
     * Может быть указан как localhost или IP-адрес сервера.
     */
    host: string;
    /**
     * Имя пользователя для подключения
     */
    user?: string;
    /**
     * Пароль для подключения
     */
    pass?: string;
    /**
     * Название базы данных
     */
    database: string;
    /**
     * Дополнительные параметры подключения
     *
     * Могут включать специфичные для БД параметры,
     * такие как порт, кодировка и т.д.
     */
    options?: Record<string, unknown>;
}

/**
 * @interface IAppIntent
 * Конфигурация интента (команды)
 *
 * Определяет структуру команды, включая ее имя,
 * триггеры активации и флаг использования регулярных выражений.
 *
 * @example
 * ```ts
 * // Простая команда
 * const intent: IAppIntent = {
 *   name: 'greeting',
 *   slots: ['привет', 'здравствуй'],
 *   is_pattern: false
 * };
 *
 * // Команда с регулярным выражением
 * const patternIntent: IAppIntent = {
 *   name: 'numbers',
 *   slots: ['\\b\\d{3}\\b'],
 *   is_pattern: true
 * };
 * ```
 */
export interface IAppIntent {
    /**
     * Уникальный идентификатор команды
     */
    name: string;
    /**
     * Триггеры активации команды.
     *
     * Может содержать строки (поиск подстроки) и/или регулярные выражения.
     * При `is_pattern: true` строки интерпретируются как регулярные выражения.
     *
     * @example
     * ```ts
     * // Простые слова
     * slots: ['привет', 'здравствуй']
     *
     * // Регулярное выражение для чисел
     * slots: ['\\b\\d{3}\\b']
     *
     * // Строки + RegExp в одном слоте
     * slots: ['привет', /\b\+7\s?\d{3}\b/]
     * ```
     */
    slots: (string | RegExp)[];
    /**
     * Флаг использования регулярных выражений
     *
     * Если true, строки в slots интерпретируются как регулярные выражения.
     *
     * @defaultValue false
     */
    is_pattern?: boolean;
}

/**
 * Интерфейс для сохранения токенов
 */
export interface ITokenPlatform {
    /**
     * Токены и дополнительная информация (например, секреты), которые необходимы для корректной работы указанной платформы.
     */
    [platformName: string]: {
        token?: string;
        [name: string]: string | number | undefined;
    };
}

/**
 * Основная конфигурация приложения
 *
 * Определяет основные настройки приложения, включая пути к директориям,
 * конфигурацию базы данных, токены платформ и флаги режимов работы.
 *
 * @example
 * ```ts
 * const config: IAppConfig = {
 *   error_log: './logs',
 *   json: './data',
 *   db: {
 *     host: 'localhost',
 *     database: 'bot_db'
 *   },
 *   isLocalStorage: true,
 *   env: '.env'
 * };
 * ```
 *
 * @group Основное
 */
export interface IAppConfig {
    /**
     * Путь к директории для логов ошибок и предупреждений
     */
    error_log?: string;
    /**
     * Путь к директории для JSON файлов
     */
    json?: string;
    /**
     * Конфигурация базы данных
     */
    db?: IAppDB;
    /**
     * Флаг использования локального хранилища платформы.
     * Перед включением флага убедитесь, что платформа поддерживает хранение данных в локальном хранилище.
     * Также некоторые платформы требуют, чтобы была установлена соответствующая настройка у приложения.
     *
     * При указании опции в значение `true` фреймворк автоматически сохранит все данные из userData в платформу,
     * также все данные от платформы записываются в userData.
     * Рекомендуется использовать в том случае, если вам не нужна база данных.
     *
     * Если платформа не поддерживает локальное хранилище (Telegram, VK, MAX, Viber), данные хранятся в БД,
     * а без DB-адаптера — в памяти процесса (см. `memorySession`). Сессия в памяти теряется при перезапуске
     * и не разделяется между процессами и инстансами (кластер, serverless) — для надёжного хранения подключите БД.
     */
    isLocalStorage?: boolean;
    /**
     * Сессия `userData` в памяти процесса — аналог `MemorySessionStorage` у grammY.
     *
     * Используется только при `isLocalStorage: true`, если платформа не поддерживает локальное хранилище
     * и DB-адаптер не подключён. По умолчанию: до 10 000 пользователей, данные живут 24 часа
     * с последнего запроса пользователя. `false` — отключить (userData между запросами не сохраняется).
     *
     * Данные теряются при перезапуске процесса и не разделяются между процессами (кластер, несколько реплик,
     * serverless) — в таких случаях подключите DB-адаптер.
     *
     * @example
     * ```ts
     * bot.setAppConfig({ isLocalStorage: true, memorySession: { maxSize: 50_000, ttl: 60 * 60 * 1000 } });
     * ```
     */
    memorySession?: IMemorySessionConfig | false;
    /**
     * Путь к файлу с переменными окружения(.env).
     * Если указан путь к .env-файлу, фреймворк попытается загрузить переменные из него. Если файл не найден — используются переменные из process.env.
     * Также если передать значение `local`, то данные будут взяты из `process.env`
     */
    env?: string;

    /**
     * Список различных токенов. Стоит использовать в ситуациях, когда для корректной работы платформы, необходимо указывать токен.
     * НЕ рекомендуется его как-либо заполнять автоматически, находясь вне адаптера платформы
     */
    tokens?: ITokenPlatform;
}

/**
 * @interface IAppParam
 * Параметры приложения для платформ
 *
 * Содержит дополнительные параметры для платформ, а также тексты приветствия и помощи.
 *
 * @example
 * ```ts
 * const params: IAppParam = {
 *   welcome_text: 'Привет! Чем могу помочь?',
 *   help_text: 'Список доступных команд: ...',
 *   intents: [
 *     {
 *       name: 'greeting',
 *       slots: ['привет', 'здравствуй'],
 *       is_pattern: false
 *     }
 *   ]
 * };
 * ```
 *
 * @group Основное
 */
export interface IAppParam {
    /**
     * Флаг, указывающий на то, что для работы приложения необходима авторизация.
     * Сам способ авторизации обрабатывается на стороне платформы.
     * В случае если платформа не поддерживает механизм авторизации, саму авторизацию может реализовать разработчик приложения
     */
    isAuthUser?: boolean;

    /**
     * Текст приветствия
     *
     * Может быть строкой или массивом вариантов.
     */
    welcome_text?: string | string[];

    /**
     * Текст помощи
     *
     * Может быть строкой или массивом вариантов.
     */
    help_text?: string | string[];
    /**
     * Текст, который будет показан, если подходящие команды не найдены
     *
     * Может быть строкой или массивом вариантов.
     */
    empty_text?: string | string[];

    /**
     * Массив интентов (команд) приложения
     *
     *
     * @example
     * ```ts
     * intents: [
     *   {
     *     name: 'greeting',
     *     slots: [
     *       '\\bпривет\\b',                // Точное совпадение слова
     *       '\\bпривет[^\\s]+\\b',         // Начало слова (например, "привет" найдет "приветствие")
     *       '\\b(\\d{3})\\b',              // Числа от 100 до 999
     *       'привет \\d друг',             // Шаблон с числом между словами
     *       /\d{0,3}/i                     // Поиск числа от 0 до 999
     *     ],
     *     is_pattern: true
     *   }
     * ]
     * ```
     *
     * @remarks
     * **Внимание к безопасности регулярных выражений:**
     * Для интентов с `is_pattern: true` фреймворк автоматически проверяет все слоты
     * (и строки, и `RegExp`) на уязвимости типа ReDoS. В зависимости от режима работы приложения:
     * - `strict_prod` — опасные слоты отключаются (исключаются) с ошибкой в логах; интент
     *   сохраняется с безопасными слотами, а если опасны все — интент отбрасывается целиком.
     * - `prod` — проверка выполняется, но выражение не удаляется и используется как есть
     *   (предупреждение при установленном `re2`, ошибка в логах без него).
     * - `dev` — то же, что и `prod`: проверка выполняется, выражение не удаляется.
     *
     * RegExp-слоты интентов без `is_pattern` этой проверкой не фильтруются.
     *
     * Рекомендуется тестировать регулярные выражения в режиме `dev` перед выкаткой в продакшн.
     *
     * @see `Bot.setAppMode()` — метод для настройки режима работы приложения.
     */
    intents: IAppIntent[] | null;

    /**
     * UTM-метка для ссылок
     *
     * @defaultValue null — при этом к кнопкам-ссылкам автоматически добавляется utm_source=umbot&utm_medium=cpc&utm_campaign=phone
     */
    utm_text?: string | null;
}

/**
 * Общий интерфейс для плагина-объекта с методом `getData`.
 * `TArgs` — кортеж типов аргументов, `TResult` — тип возвращаемого значения.
 */
export interface IAppPlugin<TArgs extends unknown[] = unknown[], TResult = unknown> {
    /**
     * Основной метод плагина. Вызывается с аргументами, зависящими от типа плагина.
     */
    getData: (...args: TArgs) => TResult;
}

/**
 * Альтернативный способ задать плагин — через функцию.
 */
export type IAppPluginFn<TArgs extends unknown[] = unknown[], TResult = unknown> = (
    ...args: TArgs
) => TResult;

/**
 * Общий тип, который объединяет IAppPlugin и IAppPluginFn
 */
export type TAppPluginData<TArgs extends unknown[] = unknown[], TResult = unknown> =
    IAppPlugin<TArgs, TResult> | IAppPluginFn<TArgs, TResult>;

/**
 * Тип для подключения любого пользовательского плагина.
 */
export type AnyPluginData =
    | TAppPluginData<[key: string, ...params: unknown[]], string> // i18n
    | TAppPluginData<[text: string, platformNlu: INlu, platform: string, request: unknown], INlu> // nlu
    | TAppPluginData<[], RegExpConstructor> // regExp
    | TAppPluginData;

/**
 * Реестр плагинов приложения.
 *
 * По умолчанию плагины `i18n`, `nlu` и `regExp` не подключены — зарегистрируйте
 * их самостоятельно, если они нужны.
 *
 * Как зарегистрировать плагин:
 *
 * 1. Создайте реализацию как объект с методом `init` или как функцию:
 *
 *    // Вариант 1: объект
 *    class MyI18nPlugin implements IPlugin {
 *      init(appContext: AppContext<IDatabaseInfo>) {
 *        appContext.plugins['i18n'] = {
 *          getData(key: string, ...params: unknown[]): string {
 *            return `Translated: ${key}`;
 *          }
 *        };
 *      }
 *    }
 *
 *    // Вариант 2: функция
 *    const myNluPlugin: IPluginFn = (appContext: AppContext) => {
 *      appContext.plugins['nlu'] = (text: string, ctx?: unknown) => ({
 *        intent: 'default',
 *        entities: {}
 *      });
 *    };
 *    myNluPlugin.isPlugin = true; // маркер обязательного наличия
 *
 * 2. Подключите плагин к приложению:
 *    bot.use(new MyI18nPlugin());
 *    // или
 *    bot.use(myNluPlugin);
 *
 * Требования к реализации:
 *
 * - Плагин должен устанавливать значение в `appContext.plugins['имя']`.
 * - Имя может быть:
 *     • `i18n` — должен соответствовать сигнатуре `TAppPluginData<[key: string, ...params: unknown[]], string>`
 *     • `nlu` — должен соответствовать сигнатуре `TAppPluginData<[text: string, platformNlu: INlu, platform: string, request: unknown], INlu>`
 *     • `regExp` — должен соответствовать сигнатуре `TAppPluginData<[], RegExpConstructor>`
 *     • любое другое имя — произвольная сигнатура `AnyPluginData`
 *
 * Примеры корректных реализаций:
 *
 * appContext.plugins['i18n'] = (key: string, ...params: unknown[]) => `Hello, ${params[0]}`;
 * appContext.plugins['nlu'] = (text, platformNlu, platform, request) => ({ intent: 'greet', entities: {} });
 * appContext.plugins['regExp'] = () => RegExp;
 * appContext.plugins['custom'] = (a, b, c) => a + b + c;
 */
export interface TAppPlugin {
    /**
     * Плагин интернационализации.
     * Вызывается как: `plugins.i18n?.getData('greeting', user)`
     * или, если функция: `plugins.i18n?.('greeting', user)`
     */
    i18n?: TAppPluginData<[key: string, ...params: unknown[]], string>;
    /**
     * Плагин NLU.
     *
     * Принимает:
     * - `text` — исходный текст запроса;
     * - `platformNlu` — предварительно заполненная платформой структура INlu;
     * - `platform` — имя платформы (например, 'alisa', 'telegram');
     * - `request` — оригинальный объект запроса от платформы.
     *
     * Второй аргумент — предварительно заполненная платформой структура INlu
     * (например, в Алисе — с original_utterance, session, user и т.д.).
     * Плагин должен обогатить её intent'ом и entities.
     *
     * @example
     * ```ts
     * nlu: (text, platformNlu, platform, request) => {
     *   return {
     *     ...platformNlu,
     *     intent: detectIntent(text),
     *     entities: extractEntities(text)
     *   };
     * }
     * ```
     */
    nlu?: TAppPluginData<
        [text: string, platformNlu: INlu, platform: string, request: unknown],
        INlu
    >;
    /**
     * Плагин для получения конструктора регулярных выражений.
     * Вызывается **без аргументов**: `plugins.regExp?.getData()` или `plugins.regExp?.()`
     */
    regExp?: TAppPluginData<[], RegExpConstructor>;

    /**
     * Произвольные пользовательские плагины.
     * Каждый — либо объект с `getData`, либо функция.
     */
    [name: string]: AnyPluginData | undefined;
}
