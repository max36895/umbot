/**
 * Модуль для тестирования вашего приложения.
 * Предоставляет инструменты для отладки и тестирования функциональности итогового приложения
 */
import { TAppType } from './interfaces/IAppContext';

import { BotController, IUserData, BaseBotController } from '../controller';
import { Bot, TBotControllerClass } from './Bot';
import type { TRunResult } from './interfaces/IBot';
import { stdin } from '../utils/';
import { performance } from 'node:perf_hooks';

/**
 * Функция для получения конфигурации пользовательского приложения
 *
 * @remarks Сохранён для обратной совместимости (2.x): самим фреймворком не
 * используется — кастомные платформы подключаются через `BasePlatform`
 * (см. `getQueryExample`).
 *
 * @callback TUserBotConfigCb
 * @param query - Пользовательский запрос
 * @param userId - Идентификатор пользователя
 * @param count - Номер сообщения в диалоге
 * @returns Конфигурация для пользовательского приложения
 */
export type TUserBotConfigCb = (query: string, userId: string, count: number) => unknown;

/**
 * Параметры для тестирования приложения.
 * Определяют поведение и отображение результатов тестирования
 */
export interface IBotTestParams {
    /**
     * Отображать полный ответ навыка
     * @defaultValue false
     */
    isShowResult?: boolean;

    /**
     * Отображать данные из хранилища
     * @defaultValue false
     */
    isShowStorage?: boolean;

    /**
     * Отображать время выполнения запроса
     * @defaultValue true
     */
    isShowTime?: boolean;
}

interface IResponse {
    response: {
        text: string;
        tts: string;
    };
}

/**
 * Класс для тестирования созданного навыка/бота через консольный интерфейс. Позволяет протестировать логику вашего приложения без предварительной публикации.
 * Также предоставляет интерактивный режим для отладки и тестирования функциональности.
 * Для того чтобы протестировать необходимую платформу, необходимо указать `appType`, в случае если значение не указано или установлено в auto, то для тестирования будет использоваться первая платформа.
 *
 * ⚠️ Особенность `run()` без явного `appType`: он принудительно использует `alisa` (а не первую
 * зарегистрированную платформу) — поэтому при тестировании только чат-платформ передавайте
 * `appType` явно: `bot.run('telegram', ...)`. Интерактивный `test()` использует первую
 * зарегистрированную платформу, как описано выше.
 *
 * @extends Bot
 *
 * @example
 * ```ts
 * const botTest = new BotTest();
 * botTest.setPlatformParams({
 *   intents: [{
 *     name: 'greeting',
 *     slots: ['привет', 'здравствуйте']
 *   }]
 * });
 * botTest.initBotController(MyController);
 *
 * // Запуск тестирования
 * await botTest.test({
 *   isShowResult: true,
 *   isShowStorage: true
 * });
 * ```
 */
export class BotTest extends Bot {
    protected _botController: BotController;

    /**
     * Создает тестовое приложение. Контроллер опционален — если не передан,
     * используется BaseBotController.
     *
     * @param {TAppType} [type] - Тип платформы (по умолчанию автоопределение)
     * @param {TBotControllerClass} [botController] - Класс контроллера с логикой приложения
     * @returns Созданный экземпляр BotTest
     *
     * @example
     * ```ts
     * const botTest = new BotTest('alisa', MyController);
     * ```
     */
    constructor(type?: TAppType, botController?: TBotControllerClass) {
        super(type, botController);
        if (botController) {
            this._botController = new botController(this.getAppContext());
        } else {
            this._botController = new BaseBotController(this.getAppContext());
        }
        this._setBotController(this._botController);
    }

    /**
     * Переустанавливает класс контроллера и обновляет переиспользуемый тестовый экземпляр.
     *
     * @param {TBotControllerClass} fn - Новый класс контроллера
     * @returns {this} Текущий экземпляр для цепочки вызовов
     *
     * @example
     * ```ts
     * botTest.initBotController(MyController); // заменить контроллер между тестами
     * ```
     */
    initBotController(fn: TBotControllerClass): this {
        this._botController = new fn(this.getAppContext());
        this._setBotController(this._botController);
        return super.initBotController(fn);
    }

    #showInfo(
        { isShowResult = false, isShowStorage = false, isShowTime = true }: IBotTestParams,
        result: IResponse,
        timeStart: number,
    ): void {
        if (isShowResult) {
            console.log(`Ответ в формате платформы: > ${JSON.stringify(result)}`);
        }
        if (isShowStorage) {
            console.log(`Данные в базе > ${JSON.stringify(this._botController.userData)}`);
            console.log(`Данные в хранилище > ${JSON.stringify(this._botController.state)}`);
        }
        if (isShowTime) {
            const endTime: number = performance.now() - timeStart;
            console.log(`Время выполнения: ${endTime.toFixed(3)}мс`);
        }
    }

    /**
     * Запускает интерактивное тестирование приложения.
     * Позволяет вводить команды и получать ответы в консоли.
     * Также, если не задан `setAppMode` равный `strict_prod`, то режим автоматически выставится в `dev`
     *
     * @param {IBotTestParams} [params] - Параметры тестирования
     * @returns {Promise<void>}
     *
     * @example
     * ```ts
     * // Базовое тестирование
     * await botTest.test();
     *
     * // Расширенное тестирование с отображением всех данных
     * await botTest.test({
     *   isShowResult: true,
     *   isShowStorage: true,
     *   isShowTime: true
     * });
     * ```
     */
    public async test(params: IBotTestParams = {}): Promise<void> {
        let count: number = 0;
        let state: string | IUserData = {};
        let isEnd = false;
        if (this.getAppContext().appMode !== 'strict_prod') {
            this.setAppMode('dev');
        }
        do {
            let query;
            if (count === 0) {
                console.log("Для выхода введите 'exit'\n");
                query = 'Привет';
            } else {
                query = await stdin();
                if (query === 'exit') {
                    break;
                }
            }
            if (!this._content) {
                this.setContent(JSON.stringify(this.getSkillContent(query, count, state)));
            }
            const timeStart: number = performance.now();
            if (typeof this._content === 'string') {
                this.setContent(JSON.parse(this._content));
            }
            this._setBotController(this._botController);
            // Выставляем на каждой итерации: clearStoreData() сбрасывает флаг,
            // и адаптеры ушли бы в реальные API платформ из консольного теста.
            this._botController.skipAutoReply = true;

            const result: IResponse = (await this.run(this.appType)) as IResponse;
            const platformAdapter = this.getAppContext().platforms;

            let strRes;
            if (
                this._botController.appType &&
                platformAdapter?.[this._botController.appType]?.isVoice
            ) {
                if (result.response?.text) {
                    strRes = result.response.text;
                } else {
                    strRes = result.response?.tts || 'пусто';
                }
            } else {
                strRes = this._botController.text;
            }

            this.#showInfo(params, result, timeStart);
            console.log(`\nОтвет: > ${strRes}`);

            if (this._botController.isEnd) {
                isEnd = true;
            } else {
                console.log('Ваш запрос: > ');
                this.setContent(null);
                this._botController.text = this._botController.tts = '';
                state = this._botController.userData;
                count++;
                this._botController.clearStoreData();
            }
        } while (!isEnd);
    }

    protected _clearState(): void {
        return;
    }

    /**
     * Формирует конфигурацию для тестирования конкретной платформы.
     * Создает структуру данных, соответствующую формату выбранной платформы
     *
     * @param query - Пользовательский запрос
     * @param count - Номер сообщения в диалоге
     * @param state - Данные из хранилища
     * @returns Конфигурация для выбранной платформы
     *
     * @protected
     */
    protected getSkillContent(
        query: string,
        count: number,
        state: Record<string, unknown> | string,
    ): unknown {
        /**
         * Все переменные используются внутри шаблонов
         */
        const userId: string = 'user_local_test';
        let appType = this.appType;
        if (appType === 'auto') {
            // Если платформы не зарегистрированы, откатываемся на документированный
            // дефолт 'alisa' (как в run()) вместо падения на undefined.
            appType = Object.keys(this.getAppContext().platforms)[0] || 'alisa';
            this.appType = appType;
        }
        const platformAdapter = appType ? this.getAppContext().platforms[appType] : undefined;
        if (platformAdapter && !platformAdapter.isVoice) {
            this._botController.skipAutoReply = false;
        }
        if (platformAdapter) {
            return platformAdapter.getQueryExample(query, userId, count, state);
        }
        return null;
    }

    /**
     * Запускает обработку запроса
     * Не рекомендуется вызывать самостоятельно, ответственность за вызов метода лежит на классе.
     * @param {TAppType | null} [appType] - Тип платформы. Если не передан, принудительно используется `alisa` (автоопределение в BotTest не выполняется)
     * @param {string | null} [content] - Содержимое запроса
     * @returns {Promise<TRunResult>} Результат обработки запроса
     *
     * @example
     * ```ts
     * const result = await botTest.run('alisa', JSON.stringify(query));
     * ```
     */
    public run(appType?: TAppType | null, content?: string | null): Promise<TRunResult> {
        this.appType = appType || 'alisa';
        this._botController.appType = appType || 'alisa';
        return super.run(appType, content);
    }

    /**
     * Упрощённый способ вызвать `bot.run(...)` с автоматической подготовкой query.
     *
     * Если запрашиваемая платформа зарегистрирована в `platforms` — используется её
     * `getQueryExample` для генерации валидного payload. Иначе метод выбрасывает
     * исключение (throw new Error).
     *
     * @remarks
     * На время симуляции включается `skipAutoReply`, поэтому чат-платформы
     * (Telegram, VK, Viber, Max) НЕ отправляют сообщение в реальное API —
     * их `getContent()` возвращает `'ok'`. Текст ответа в этом случае остаётся
     * в `text` контроллера. Для голосовых платформ результатом будет готовый
     * JSON-ответ платформы (например, `res.response.text`).
     *
     * @example
     * ```ts
     * const tester = new BotTest();
     * tester.use(new AlisaAdapter());
     * tester.addCommand('start', ['привет'], (_, ctx) => { ctx.text = 'Привет!'; });
     *
     * // Голосовая платформа: ответ приходит в формате платформы
     * const res = await tester.simulate('привет', { platform: 'alisa' }) as {
     *   response: { text: string };
     * };
     * console.log(res.response.text); // 'Привет!'
     *
     * // Чат-платформа: отправка в API пропускается, результат — 'ok',
     * // а текст ответа доступен через контроллер
     * tester.use(new TelegramAdapter('token'));
     * await tester.simulate('привет', { platform: 'telegram' }); // 'ok'
     * ```
     *
     * @param query Текст пользователя (например, "привет")
     * @param options Параметры симуляции: platform, userId, count, state
     * @returns Ответ платформы (результат `run()`)
     */
    public async simulate(
        query: string,
        options: {
            platform?: TAppType;
            userId?: string;
            count?: number;
            state?: Record<string, unknown> | string;
        } = {},
    ): Promise<TRunResult> {
        const {
            platform = this.appType !== 'auto' ? (this.appType as TAppType) : undefined,
            userId = 'test_user',
            count = 0,
            state = {},
        } = options;
        // appType по умолчанию — 'auto', поэтому при отсутствии явной платформы
        // берём первую зарегистрированную (как в getSkillContent).
        const targetPlatform =
            platform ?? (Object.keys(this.getAppContext().platforms)[0] as TAppType | undefined);
        const targetAdapter = targetPlatform
            ? this.getAppContext().platforms[targetPlatform]
            : undefined;
        if (!targetPlatform || !targetAdapter) {
            throw new Error(
                `BotTest.simulate: платформа "${platform ?? 'auto'}" не зарегистрирована. ` +
                    `Сначала вызовите bot.use(new <Platform>Adapter()).`,
            );
        }
        const content = targetAdapter.getQueryExample(query, userId, count, state);
        // Без этого флага адаптеры чат-платформ внутри getContent() реально
        // отправляли бы сообщение в API платформы прямо из локального теста
        // (по аналогии с флагом в test(), который выставляется на каждом ходе).
        const oldSkipAutoReply = this._botController.skipAutoReply;
        this._botController.skipAutoReply = true;
        try {
            return await this.run(
                targetPlatform,
                typeof content === 'string' ? content : JSON.stringify(content),
            );
        } finally {
            this._botController.skipAutoReply = oldSkipAutoReply;
        }
    }
}
