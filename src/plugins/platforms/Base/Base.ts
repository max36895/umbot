import { BasePlugin } from '../../Base';
import {
    AppContext,
    IPlatformAdapter,
    BotController,
    BaseBotController,
    IDatabaseInfo,
    IControllerApi,
} from '../../../index';
import type { TEventType } from '../../../core/events';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Тип ответа, который может вернуть адаптер после обработки запроса.
 * Адаптер возвращает этот тип из метода getContent() — объект (JSON) или строка.
 *
 * @example
 * ```ts
 * // Объект (для Алисы, SmartApp — JSON в теле ответа)
 * const content: TContent = { version: '1.0', response: { text: 'Привет!' } };
 *
 * // Строка (для Telegram, VK — ответ уже отправлен через API)
 * const content: TContent = 'ok';
 * ```
 */
export type TContent = object | string | Promise<object | string>;

/**
 * Дополнительные опции, которые передаются в конструктор адаптера.
 * Формат зависит от конкретной платформы.
 *
 * @example
 * ```ts
 * const options: IOptions = {
 *     vk_confirmation_token: 'abc123',
 *     vk_api_version: '5.199',
 * };
 * ```
 */
export interface IOptions {
    /**
     * Любое свойство, необходимое для работы платформы, в нужном формате
     */
    [key: string]: unknown;
}

/**
 * Ошибка, возникающая при получении пустого тела запроса от платформы.
 */
export const EMPTY_QUERY_ERROR =
    'Получено пустое тело запроса от платформы, дальнейшая корректная работа невозможна. Скорее всего запрос пришел не от платформы.';
/**
 * Ошибка, возникающая при отсутствии контекста приложения.
 */
export const EMPTY_CONTEXT_ERROR =
    'Не указан контекст приложения, дальнейшая работа приложения невозможна. Проверьте корректность настройки приложения.';

/**
 * Базовый адаптер для создания голосовых навыков и чат-ботов для собственной платформы (WeChat, WhatsApp, Slack и др.).
 *
 * Чтобы подключить другую платформу, которая не поставляется из коробки, унаследуйтесь от класса и реализуйте
 * все абстрактные методы. Адаптер автоматически зарегистрируется в системе
 * при подключении через `bot.use(new MyPlatformAdapter())`.
 *
 * === Обязательные методы ===
 * - {@link isPlatformOnQuery} — определяет, относится ли запрос к платформе или нет
 * - {@link setQueryData} — обрабатывает запрос и заполняет `controller` данными
 * - {@link getContent} — формирует ответ в формате платформы
 *
 * === Опциональные ===
 * - {@link getQueryExample} — генерирует пример запроса необходимого для тестов
 * - {@link isCorrectQuery}, {@link isSignatureCheckEnabled} — проверка подписи запроса (если платформа её присылает)
 * - {@link isLocalStorage}, {@link getLocalStorage}, {@link setLocalStorage} — если платформа поддерживает сохранение локального состояния
 * - {@link soundProcessing} — кастомная обработка TTS/звуков (для голосовых платформ, или отправка аудиофайла в боте).
 *
 * @see Bot
 * @see BotController
 *
 * @group Свой адаптер
 */
export abstract class BasePlatform<TQuery = unknown>
    extends BasePlugin
    implements IPlatformAdapter<TQuery>
{
    /**
     * Порог предупреждения в миллисекундах: при его превышении в лог записывается warning
     */
    protected WARNING_TIME_REQUEST = 2000;
    /**
     * Максимальное время обработки запроса в миллисекундах: при его превышении в лог
     * записывается ошибка (ответ платформе при этом не модифицируется)
     */
    protected MAX_TIME_REQUEST = 2900;

    protected _token?: string;
    protected _platformOptions?: IOptions;

    /**
     * Имя поля в заголовке запроса, по которому можно проверить корректность полученного запроса от платформы.
     */
    signatureName?: string;

    /**
     * Лимит запросов/сек для входящего rateLimiter; null — не ограничивать. Переопределяется адаптером платформы.
     */
    limit: number | null = null;

    /**
     * Контекст приложения
     */
    appContext?: AppContext<unknown, TQuery>;
    /**
     * Имя платформы
     */
    platformName: string = 'unknown';
    /**
     * Голосовая ли платформа (TTS-ответ в теле HTTP). Чат-платформы переопределяют на false.
     */
    isVoice = true;

    /**
     * Конструктор базового адаптера платформы.
     * @param platformToken - Токен платформы (опционально)
     * @param additionalPlatformOptions - Дополнительные опции платформы (опционально)
     */
    constructor(platformToken?: string, additionalPlatformOptions?: IOptions) {
        super();
        // exactOptionalPropertyTypes: поля не заполняем, если значения не переданы.
        if (platformToken !== undefined) {
            this._token = platformToken;
        }
        if (additionalPlatformOptions !== undefined) {
            this._platformOptions = additionalPlatformOptions;
        }
    }

    /**
     * Универсальные события (`TEventType`), которые этот адаптер может выставить
     * в `controller.eventType`.
     *
     * Источник знания для валидации `bot.addEvent(...)`: обработчик на событие,
     * которое ни один подключённый адаптер не поддерживает, — почти всегда
     * опечатка, и о ней предупреждают при регистрации. Таблица живёт у адаптера,
     * а не в ядре: кастомная платформа, унаследованная от `BasePlatform`,
     * объявляет собственный перечень и автоматически участвует в проверке.
     *
     * **Для кастомных платформ:** перечислите события, которые ваш `setQueryData`
     * реально записывает в `controller.eventType`:
     * ```ts
     * class MyPlatformAdapter extends BasePlatform {
     *     supportedEvents: readonly TEventType[] = ['message', 'photo', 'callback'];
     *     // ...
     * }
     * ```
     * Если платформа умеет только текст — поле можно не трогать: базовое значение
     * `['message']` уже корректно. Событий вне `TEventType` (например, платформенная
     * «покупка») в валидации не участвуют — их можно отслеживать в `action()` по
     * `requestObject`.
     *
     * Базовое значение — только `'message'`: самый минимум, верный для любой
     * платформы. Встроенные адаптеры переопределяют поле (Telegram — медиа и
     * callback/inline, VK — callback, MAX — start/edited и т.д.).
     */
    supportedEvents: readonly TEventType[] = ['message'];

    /**
     * Инициализация адаптера.
     * Определять не обязательно. Стоит указывать в случаях, когда нужно выполнить доп логику, например указать токены или писать какую-то статистику по использованию.
     * @param appContext - Контекст приложения
     */
    init(appContext: AppContext<IDatabaseInfo, TQuery>): void {
        appContext.platforms[this.platformName] = this;
        this.appContext = appContext;
        appContext.appConfig.tokens[this.platformName] ??= {};
    }

    /**
     * Создаёт API-фасад платформы для `controller.api` — унифицированный доступ
     * к исходящим возможностям платформы (`sendPhoto`, `answerCallback` и т.д.).
     *
     * Базовая реализация возвращает `null`: фасад считается недоступным. Ядро
     * подключает фасад к контроллеру только у адаптеров, переопределивших этот
     * метод, — поэтому добавить фасад своей платформе можно без правок ядра.
     *
     * **Для кастомных платформ:** если платформа умеет исходящие API-вызовы
     * (отправка медиа, ответ на callback-кнопку), переопределите метод и
     * верните свой фасад `IControllerApi`. Удобно завернуть готовую фабрику
     * и дополнить её, либо собрать фасад с нуля. Для голосовых платформ
     * (ответ формируется телом webhook) переопределять не нужно.
     *
     * @param _controller - Контроллер текущего запроса (не используется
     *   базовой реализацией; доступен переопределяющим методам)
     * @returns Фасад либо `null`, если для платформы он недоступен
     *
     * @example
     * ```ts
     * class MyPlatformAdapter extends BasePlatform {
     *     createApi(controller: BotController): IControllerApi | null {
     *         return makeMyApi(controller); // своя фабрика фасада
     *     }
     * }
     * ```
     */
    createApi(_controller: BotController): IControllerApi | null {
        return null;
    }

    /**
     * Генерирует пример входящего запроса для локального тестирования вашего приложения.
     * Позволяет эмулировать запрос от платформы с заданным текстом, ID пользователя, номером сообщения и состоянием.
     * Необходимо указывать для того, чтобы можно было корректно проверить работоспособность приложения.
     *
     * Обязательно определите метод, если планируется тестирование приложения через инструменты предоставляемые платформой. Это существенно упростит процесс разработки приложения.
     * @param query Запрос пользователя
     * @param userId Идентификатор пользователя
     * @param count Порядковый номер запроса
     * @param state Данные из локального хранилища
     * @returns Пример входящего запроса платформы (Record)
     *
     * @example
     * ```ts
     * // Пример переопределения для кастомной платформы
     * getQueryExample(query, userId, count, state) {
     *     return { text: query, userId, messageId: count, state };
     * }
     * ```
     */
    getQueryExample(
        query: string,
        userId: string,
        count: number,
        state: Record<string, unknown> | string,
    ): Record<string, unknown> {
        // Формат запроса от вашей платформы
        return {
            text: query,
            userId,
            messageId: count,
            state,
        };
    }

    /**
     * Возвращает признак того, соответствует ли запрос текущей платформе или нет
     *
     * @example Пример кастомной платформы (не поведение встроенного TelegramAdapter,
     * который определяет запрос по полю update_id в теле)
     * ```ts
     * isPlatformOnQuery(query, headers) {
     *   return headers?.['x-telegram-bot-api-secret-token'] === this._token;
     * }
     * ```
     *
     * @example Алиса
     * ```ts
     * isPlatformOnQuery(query) {
     *   return !!(query.request && query.version && query.session);
     * }
     * ```
     * @param query Запрос, который пришел в приложение
     * @param headers Заголовок с которым был отправлен запрос
     * @returns `true`, если запрос относится к этой платформе, иначе `false`
     */
    abstract isPlatformOnQuery(query: TQuery, headers?: Record<string, unknown>): boolean;

    /**
     * Проверяет полученный запрос от платформы на корректность.
     * Из коробки проверка идет по sha256-hmac и **включается только если одновременно заданы**:
     * - `appConfig.tokens[<platformName>].token` — секретный ключ
     * - `this.signatureName` — имя http-заголовка с подписью
     *
     * Если хотя бы один из этих параметров не задан, метод вернёт `true` без проверки — это **opt-in** механизм.
     *
     * ⚠️ **Важно:** не все платформы используют HMAC-SHA256 от тела. Переопределите этот метод
     * в адаптере платформы, если её формат подписи отличается:
     * - **Telegram** — переопределён (использует plain `x-telegram-bot-api-secret-token`).
     * - **Viber** — умолчание корректно (Viber шлёт `x-viber-content-signature` как HMAC-SHA256(auth_token, body)).
     * - **VK** — переопределён: сверяет поле `secret` из тела запроса с `secret_key` из конфигурации
     *   (plain-сравнение через timingSafeEqual, без HMAC).
     * - **Max** — переопределён: сверяет заголовок `x-max-bot-api-secret` со значением webhook-secret
     *   (`options.secret` / `tokens.max_app.webhookSecret`).
     * - Для платформ без подписи (Alisa, Marusia, SmartApp) проверка пропускается из-за отсутствия `signatureName`.
     *
     * @param query - Объект запроса от платформы
     * @param headers - HTTP-заголовки запроса
     * @returns `true` — запрос валиден / проверка не включена, `false` — подпись не сошлась или отсутствует.
     */
    isCorrectQuery(query: TQuery, headers?: Record<string, unknown>): boolean {
        const platformToken = this.appContext?.appConfig.tokens[this.platformName];
        if (platformToken?.token && this.signatureName) {
            if (!headers?.[this.signatureName]) {
                return false;
            }

            const token = platformToken.token as string;
            const payload = typeof query === 'string' ? query : JSON.stringify(query);
            const expected = createHmac('sha256', token).update(payload).digest('hex');

            try {
                return timingSafeEqual(
                    Buffer.from(headers[this.signatureName] as string),
                    Buffer.from(expected),
                );
            } catch {
                return false;
            }
        }
        return true;
    }

    /**
     * Проверка подписи включена, когда выполнены оба условия базовой HMAC-схемы:
     * задан секрет платформы и имя заголовка подписи. Платформы, переопределившие
     * `isCorrectQuery` (Telegram, VK, MAX), переопределяют и этот метод —
     * источник секрета у них другой (webhookSecret / secret_key).
     *
     * Используется ядром при старте для предупреждения о вебхуке без защиты.
     */
    isSignatureCheckEnabled(): boolean {
        return Boolean(
            this.appContext?.appConfig.tokens[this.platformName]?.token && this.signatureName,
        );
    }

    /**
     * Умеет ли платформа подписывать вебхук. По умолчанию — да, если задан
     * `signatureName` (подпись в заголовке) или переопределён `isSignatureCheckEnabled`
     * (подпись в теле, как у VK). Ядро по этому признаку решает, предупреждать ли
     * при старте о вебхуке без проверки подписи.
     *
     * @returns `true`, если у платформы есть механизм подписи вебхука
     *
     * @example
     * ```ts
     * class MyAdapter extends BasePlatform {
     *     // Платформа подписывает запрос полем в теле, заголовка нет
     *     isSignatureSupported(): boolean {
     *         return true;
     *     }
     * }
     * ```
     */
    isSignatureSupported(): boolean {
        return (
            Boolean(this.signatureName) ||
            this.isSignatureCheckEnabled !== BasePlatform.prototype.isSignatureCheckEnabled
        );
    }

    /**
     * Сколько платформа ждёт ответа на запрос, мс. По умолчанию `null` — срока нет
     * (мессенджеры). Голосовые адаптеры возвращают `MAX_TIME_REQUEST`: по нему ядро
     * ограничивает ожидание в очереди запросов пользователя.
     *
     * @returns Срок ответа в мс или `null`, если срока нет
     *
     * @example
     * ```ts
     * class MyVoiceAdapter extends BasePlatform {
     *     getResponseTimeout(): number | null {
     *         return this.MAX_TIME_REQUEST;
     *     }
     * }
     * ```
     */
    getResponseTimeout(): number | null {
        return null;
    }

    /**
     * Обрабатывает входящий запрос и заполняет контроллер данными.
     *
     * Обязательно установите:
     * - `controller.userCommand` и `controller.originalUserCommand` — текст сообщения пользователя
     * - `controller.userId` — уникальный ID пользователя
     * - `controller.appType` = this.platformName
     *
     * Опционально:
     * - `controller.userToken` — если платформа присылает токен авторизации
     * - `controller.userMeta` — если платформа присылает метаданные
     * - `controller.state` — если платформа поддерживает локальное хранилище
     * - `controller.nlu` — если платформа присылает NLU/интенты (через `controller.nlu.setNlu(...)`)
     *
     * @returns `false`, если запрос повреждён или не может быть обработан; иначе `true`
     * @param query Запрос от платформы
     * @param controller Контроллер приложения
     */
    abstract setQueryData(query: TQuery, controller: BotController): boolean | Promise<boolean>;

    /**
     * Формирует тело ответа для отправки пользователю.
     *
     * Возвращает платформо-специфичный ответ (например, JSON для Алисы).
     * Для платформ, которые отправляют ответ напрямую (например, Telegram через `sendMessage`),
     * метод может возвращать строку `'ok'` или объект.
     *
     * @param controller - контроллер с готовым ответом
     * @param stateData - данные для локального хранилища
     * @returns ответ в формате, понятном платформе
     */
    abstract getContent(
        controller: BotController,
        stateData?: Record<string, unknown> | null,
    ): TContent;

    /**
     * Формирует ответ на запрос оценки (по умолчанию — обычный ответ {@link getContent};
     * спец-формат — например, SmartApp).
     * @param controller - контроллер приложения
     */
    public getRatingContext(controller: BotController): TContent {
        return this.getContent(controller);
    }

    /**
     * Отправка текста пользователю
     * Этот метод используется для активных рассылок — когда голосовой навык или чат-бот инициирует диалог первым (например, уведомление).
     * В методе реализована механика преобразования текстового значения `controllerOrText` в контроллер, а также базовый механизм для отправки ответа.
     *
     * Переопределять данный метод не рекомендуется. Переопределить стоит только в том случае, если по каким-то технических условиям текущая реализация метода вам не подходит.
     *
     * Если платформа не поддерживает возможность начать диалог самостоятельно, то можно оставить метод пустым, либо вывести любую заглушку.
     * @param userId Ид пользователя, которому нужно отправить сообщение
     * @param controllerOrText Контроллер приложения или текст. Если необходимо отправить просто текст, можно передать строку, в случае, если необходимо передать картинку звук и тд, то необходимо корректно заполнить контроллер.
     * @returns Результат getContent() — ответ в формате платформы (TContent), либо boolean для платформ без рассылки
     *
     * @example
     * ```ts
     * // Отправка простого текста
     * adapter.send('user123', 'Привет!');
     *
     * // Отправка через контроллер (текст + кнопки/карточки)
     * const controller = new BaseBotController(appContext);
     * controller.text = 'Уведомление';
     * adapter.send('user123', controller);
     * ```
     */
    send(userId: string | number, controllerOrText: BotController | string): TContent | boolean {
        let controller: BotController;
        if (typeof controllerOrText === 'string') {
            controller = new BaseBotController(this.appContext as AppContext);
            controller.text = controllerOrText;
        } else {
            controller = controllerOrText;
        }
        if (!controller.userId) {
            controller.userId = userId;
        }
        return this.getContent(controller);
    }

    /**
     * Сбрасывает таймер начала обработки запроса (private).
     * Вызывается из {@link updateTimeStart}.
     */
    #initProcessingTime(controller: BotController): void {
        controller.platformOptions.timeStart = Date.now();
    }

    /**
     * Публичная точка входа для сброса времени начала обработки запроса.
     * Вызывайте перед началом бизнес-логики, чтобы метрики
     * (см. {@link getProcessingTime}) считались отсюда.
     */
    public updateTimeStart(controller: BotController): void {
        this.#initProcessingTime(controller);
    }

    /**
     * Получает время выполнения запроса в миллисекундах
     * @returns {number} Время выполнения запроса
     */
    public getProcessingTime(controller: BotController): number {
        return Date.now() - (controller.platformOptions.timeStart as number);
    }

    /**
     * При превышении допустимого времени обработки запроса логирует информацию.
     * Вызывается вручную в конце `getContent()` голосовых адаптеров (Alisa, Marusia, SmartApp);
     * адаптеры чат-платформ его не вызывают.
     * - `>= WARNING_TIME_REQUEST` (по умолчанию 2000 мс) — warning в лог.
     * - `>= MAX_TIME_REQUEST` (по умолчанию 2900 мс) — текст ошибки пишется
     *   в controller.platformOptions.error (не в лог).
     *
     * Пороги вынесены в `protected` поля — при необходимости переопределите в потомке.
     */
    protected _timeLimitLog(controller: BotController): void {
        const timeEnd: number = this.getProcessingTime(controller);
        if (timeEnd >= this.MAX_TIME_REQUEST) {
            controller.platformOptions.error = `${this.constructor.name}:getContent(): Превышено ограничение на отправку ответа. Время ответа составило: ${timeEnd / 1000} сек.`;
        } else if (timeEnd >= this.WARNING_TIME_REQUEST) {
            this.appContext?.logWarn(
                `${this.constructor.name}:getContent(): Время ответа составило: ${timeEnd / 1000} сек, рекомендуется проверить нагрузку на сервер, и корректность работы самого приложения.`,
            );
        }
    }

    /**
     * Дополнительная обработка для звуков.
     * В данном методе стоит реализовать логику, с помощью которой будут наложены дополнительные эффекты для озвучивания текста пользователю
     * @param _controller - Контроллер бота
     */
    soundProcessing(_controller: BotController): void | Promise<void> {
        // custom logic
    }

    /**
     * Инициализирует TTS (Text-to-Speech) в контроллере.
     * Обрабатывает звуки и стандартные звуковые эффекты
     * @param controller Контроллер приложения
     * @protected
     */
    protected _initTTS(controller: BotController): void | Promise<void> {
        const tts = controller.tts ?? controller.text;
        // Два includes не делаем для пустого/1-символьного текста: маркер звука
        // (#key#, <speaker) не короче 2 символов — проверка бессмысленна, а это
        // горячий путь на каждый запрос. Пустой tts останавливает и присвоение:
        // soundProcessing всё равно получил бы пустую строку.
        const sound =
            controller.isSoundInit() || (tts.length > 1 && (tts.includes('#') || tts.includes('<')))
                ? controller.sound
                : null;
        if (sound && (sound.sounds.length || sound.isUsedStandardSound)) {
            controller.tts = tts;
            return this.soundProcessing(controller);
        }
    }

    /**
     * Указывает, поддерживает ли платформа локальное хранилище.
     *
     * @param _controller - контроллер приложения
     * @returns `true`, если локальное хранилище доступно
     */
    isLocalStorage(_controller: BotController): boolean {
        return false;
    }

    /**
     * Получает данные из локального хранилища платформы.
     *
     * @param _controller - контроллер приложения
     * @returns данные, сохранённые ранее
     */
    getLocalStorage<TStorageResult = unknown>(
        _controller: BotController,
    ): TStorageResult | Promise<TStorageResult> {
        return null as TStorageResult;
    }

    /**
     * Сохраняет данные в локальное хранилище платформы.
     *
     * @param _data - данные для сохранения
     * @param _controller - контроллер приложения
     */
    setLocalStorage<TStorageData>(
        _data: TStorageData,
        _controller: BotController,
    ): void | Promise<void> {
        // Базовая реализация пуста — переопределяется в наследниках при необходимости
    }

    /**
     * Метод-флаг: указывает, что платформа голосовая (например, Алиса, Маруся).
     */
    static isVoice(): boolean {
        return true;
    }
}
