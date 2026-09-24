/**
 * Модуль для упрощённого запуска приложения без boilerplate-кода.
 *
 * Предоставляет функцию {@link run}, которая автоматически инициализирует бота,
 * подключает платформы, настраивает базу данных и запускает сервер или тесты
 * в зависимости от выбранного режима (`dev`, `dev-online`, `prod`).
 *
 * Используйте этот модуль, если не требуется кастомная конфигурация HTTP-сервера
 * или сложная асинхронная инициализация.
 *
 * @packageDocumentation
 * @module build
 */
import { Bot, IAppConfig, IAppParam, keysCount, TBotControllerClass, TPlugin } from './index';
import { FileAdapter, MongoAdapter, fullPlatforms } from './plugins';
import { BotTest, IBotTestParams } from './test';
import { Server } from 'node:http';

/**
 * Режим работы приложения
 * @remarks
 * Определяет режим запуска и окружение приложения:
 * - dev: Запуск в режиме тестирования с использованием консоли в качестве тестового окружения.
 *   Удобно для локальной разработки и отладки.
 * - dev-online: Запуск в режиме тестирования с использованием webhook.
 *   Позволяет тестировать интеграции с внешними сервисами.
 * - prod: Запуск в релизном режиме для использования в продакшн среде.
 *   Устанавливает appMode 'strict_prod': минимальные логи плюс строгая проверка
 *   безопасности — любая RegExp с потенциальным ReDoS отклоняется с ошибкой
 *   (в отличие от режима 'prod' у setAppMode, где небезопасные RegExp регистрируются).
 */
export type TMode = 'dev' | 'dev-online' | 'prod';

/**
 * Настройки для приложения.
 */
export interface IConfig {
    /**
     * Конфигурация приложения.
     */
    appConfig?: IAppConfig;
    /**
     * Параметры приложения.
     */
    appParam?: IAppParam;
    /**
     * Контроллер, отвечающий за логику приложения.
     * В случае если контроллер не указан, то будет использоваться контроллер по умолчанию.
     */
    controller?: TBotControllerClass;
    /**
     * Параметры для тестового окружения. Стоит указывать, когда mode = dev
     */
    testParams?: IBotTestParams;
    /**
     * Дополнительная логика для приложения, позволяющая дополнительно подключить различные плагины и адаптеры, добавить действие/шаг или выполнить любое другое действие по настройке приложения.
     * Стоит указывать, когда нужно задать дополнительные настройки приложения.
     *
     * @example
     * ```ts
     * logic: (bot: Bot) => {
     *      bot.addCommand('my_command', ['my_slot'], (intent, bc) => { bc.text = 'OK'; }); // Добавляем команду
     * }
     * ```
     * @param {Bot} bot - Экземпляр приложения для настройки
     */
    logic?: (bot: Bot) => void;
    /**
     * Список плагинов, которые будут подключены к приложению.
     * Стоит использовать, когда необходимо подключить платформы, адаптеры для работы с базой данных и т.д.
     * Если список не передан, подключаются все доступные платформы (`fullPlatforms`) и адаптер БД:
     * `MongoAdapter` — если задан адрес базы (`appConfig.db.host` или переменная окружения `DB_HOST`),
     * иначе `FileAdapter` (данные в JSON-файлах папки `appConfig.json`).
     */
    plugins?: TPlugin[];
}

/**
 * Инициализирует основные параметры приложения
 * @param {Bot | BotTest} bot Экземпляр приложения для инициализации
 * @param {IConfig} config Конфигурация приложения
 * @remarks
 * Устанавливает конфигурацию, параметры и контроллер для приложения.
 * Этот метод должен вызываться перед запуском приложения.
 */
function _initParam(bot: Bot | BotTest, config: IConfig): void {
    bot.setAppConfig(config.appConfig || {});
    if (config.appParam) {
        bot.setPlatformParams(config.appParam);
    }
    if (config.controller) {
        bot.initBotController(config.controller);
    }
    if (config.logic) {
        config.logic(bot);
    }
    if (config.plugins) {
        config.plugins.forEach((plugin) => {
            bot.use(plugin);
        });
    } else {
        const appContext = bot.getAppContext();
        if (!keysCount(appContext.platforms)) {
            bot.use(fullPlatforms);
        }
        if (!appContext.database.adapter) {
            // `db` в конфигурации есть всегда (с пустыми значениями), поэтому
            // проверяем именно адрес: без него MongoAdapter не подключится.
            if (appContext.appConfig.db?.host) {
                bot.use(new MongoAdapter(appContext.appConfig.db));
            } else {
                bot.use(new FileAdapter());
            }
        }
    }
}

/**
 * Единая точка входа для запуска приложения — «из коробки» без boilerplate-кода.
 *
 * **Зачем это нужно?**
 * Вместо ручной инициализации (5-7 строк):
 * ```ts
 * const bot = new Bot();
 * bot.setAppConfig(config.appConfig || {});
 * bot.setPlatformParams(config.appParam);
 * bot.initBotController(config.controller);
 * bot.setAppMode('strict_prod');
 * bot.start(hostname, port);
 * ```
 *
 * Достаточно одного вызова:
 * ```ts
 * run(config, 'prod', '0.0.0.0', 8080);
 * ```
 *
 * **Когда использовать:**
 * - Стандартные сценарии запуска (локальная разработка, тестирование, продакшн)
 * - Когда используется встроенный HTTP-сервер фреймворка (`node:http.Server`)
 *
 * **Когда не использовать:**
 * - Нужен кастомный HTTP-сервер (Express, Fastify)
 * - Требуется сложная логика инициализации (асинхронная загрузка конфига и т.п.)
 *
 * @param config — конфигурация приложения (контроллер, параметры, плагины)
 * @param mode — режим работы ('dev' для консольных тестов, 'dev-online' для webhook-тестов, 'prod' для продакшна)
 * @param hostname — хост (по умолчанию 'localhost')
 * @param port — порт (по умолчанию 3000)
 * @returns В режиме 'dev' возвращает Promise<void>; в режимах 'dev-online' и 'prod' — объект Server (node:http.Server).
 *
 * @example
 * ```ts
 * // Запуск в режиме разработки
 * run({
 *   appConfig: { ... },
 *   appParam: { ... },
 *   controller: MyController,
 *   testParams: { ... }
 * }, 'dev');
 *
 * // Запуск в продакшн режиме
 * run({
 *   appConfig: { ... },
 *   appParam: { ... },
 *   controller: MyController
 * }, 'prod');
 * ```
 */
export function run(
    config: IConfig,
    mode: TMode = 'prod',
    hostname: string = 'localhost',
    port: number = 3000,
): Server | Promise<void> {
    let bot: BotTest | Bot;
    // Режим выставляется до _initParam: strict_prod проверяет регулярные выражения
    // в момент регистрации, и интенты из appParam/config.logic должны её пройти.
    switch (mode) {
        case 'dev':
            bot = new BotTest();
            bot.setAppMode('dev');
            _initParam(bot, config);
            return (bot as BotTest).test(config.testParams);
        case 'dev-online':
            bot = new Bot();
            bot.setAppMode('dev');
            _initParam(bot, config);
            return bot.start(hostname, port);
        case 'prod':
            bot = new Bot();
            bot.setAppMode('strict_prod');
            _initParam(bot, config);
            return bot.start(hostname, port);
    }
}
