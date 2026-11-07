/**
 * Интерфейсы и типы для работы с приложением.
 * Определяют основные контракты и структуры данных для взаимодействия
 */

import { AppContext } from '../AppContext';
import { BotController, IControllerApi } from '../../controller';
import { IncomingMessage, type ServerResponse } from 'node:http';
import {
    IButtonType,
    Buttons,
    IButtonOptions,
    IImageType,
    ISound,
    TButtonPayload,
} from '../../components';
import { IModelRes, TQueryCb, IQuery, IQueryData, IDbTableSchema } from '../../models';
import { Bot } from '../Bot';
import type { TEventType } from '../events';

/**
 * Тип содержимого запроса к голосовому навыку или боту
 * Определяет возможные форматы данных, которые могут быть переданы навыку/боту
 *
 * @remarks
 * Возможные значения:
 * - string: JSON или текстовое содержимое запроса
 *   ```ts
 *   const content: TBotContent = '{"text": "Привет мир!"}';
 *   ```
 * - object: Уже распарсенный объект запроса
 *   ```ts
 *   const content: TBotContent = { request: { command: 'Привет' } };
 *   ```
 * - null: Пустой запрос или ошибка
 *   ```ts
 *   const content: TBotContent = null; // запрос не содержит данных
 *   ```
 */
export type TBotContent = object | string | null;

/**
 * Тип авторизационного токена.
 * Определяет формат данных для авторизации пользователя
 *
 * @remarks
 * Возможные значения:
 * - string: Валидный токен авторизации
 *   ```ts
 *   const auth: TBotAuth = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
 *   ```
 * - null: Пользователь не авторизован или авторизация не требуется
 *   ```ts
 *   const auth: TBotAuth = null; // авторизация отсутствует
 *   ```
 */
export type TBotAuth = string | null;

/**
 * Интерфейс для базового ответа
 */
export interface IBotResponse {
    /**
     * Статус код ответа.
     *  - 200 в случае успеха
     *  - 400 в случае, если отправлен пустой/некорректный запрос, или фреймворк завершил обработку с ошибкой.
     *  - 401 при неверном токене/подписи вебхука
     *  - 404 если платформа вернула 'notFound'
     *  - 413 если тело запроса превышает лимит
     *  - 500 в случае ошибки самого сервера
     */
    statusCode: number;
    /**
     * Содержимое, которое необходимо отобразить
     */
    body: string | object;
}

/**
 * Интерфейс для состояния, которое придет в пользовательском обработчике ответа
 */
export interface IBotResponseState extends IBotResponse {
    /**
     * Базовый метод для отправки ответа
     * @param {ServerResponse} res - Объект ответа HTTP-сервера
     * @param {IBotResponse} state - Состояние ответа фреймворка
     */
    defaultSend: (res: ServerResponse, state: IBotResponse) => void;
}

/**
 * Тип для пользовательской обработки запроса
 * @param reg - Объект входящего запроса (IncomingMessage или совместимый)
 * @param res - Объект ответа (ServerResponse или совместимый)
 * @param state Состояние выполненного запроса
 */
export type TBotResponseCb = (
    reg: IncomingMessage,
    res: ServerResponse,
    state: IBotResponseState,
) => void;

/**
 * Параметры запуска long polling ({@link Bot.startPolling}).
 * Настройки конкретной платформы задаются опциями её адаптера
 * (например, `telegram_delete_webhook` у `TelegramAdapter`).
 * @example
 * ```ts
 * await bot.startPolling({ platforms: ['telegram'] });
 * ```
 */
export interface IPollingOptions {
    /**
     * Платформы, для которых запустить polling. По умолчанию — все подключённые
     * адаптеры, реализующие `getUpdates`.
     */
    platforms?: string[];
}

/**
 * Интерфейс для плагина в виде объекта.
 */
export interface IPlugin {
    /**
     * Метод инициализации плагина.
     * Вызывается один раз при подключении через `bot.use()`.
     * @param appContext Контекст приложения
     * @param bot Основной класс приложения
     */
    init: (appContext: AppContext, bot: Bot) => void;
    /**
     * Метод, который вызывается при уничтожении плагина.
     * В данном методе можно добавить отписку, либо выполнить другие действия.
     * @param bot Основной класс приложения
     */
    destroy: (bot: Bot) => void | Promise<void>;
}

/**
 * Возвращаемый результат после инициализации плагина.
 * Возвращает либо void, либо функция, которая будет вызвана после уничтожения.
 */
export type TPluginFnResult = void | ((bot: Bot) => void);

/**
 * Тип для плагина в виде функции.
 * Должен иметь свойство `isPlugin = true` для отличия от обычных функций.
 */
export interface IPluginFn {
    /**
     * Конструктор функции регистрации плагина
     * @example
     * ```ts
     * function myPlugin(appContext: AppContext, bot: Bot) {
     *      // Какая-то ваша логика
     *      return () => {
     *          // Функция, которая будет вызвана при уничтожении.
     *      }
     * }
     * ```
     * @param appContext Контекст приложения
     * @param bot Основной класс приложения
     */
    (appContext: AppContext, bot: Bot): TPluginFnResult;

    /**
     * Флаг, говорящий о том, что функция является плагином
     */
    isPlugin: boolean;
}

/**
 * Объединённый тип для любого плагина.
 */
export type TPlugin = IPlugin | IPluginFn;

/**
 * Интерфейс для адаптеров платформы (Алиса, SmartApp, Telegram, VK и др.).
 *
 * Обеспечивает унификацию обработки запросов от разных платформ.
 * Реализуется как плагин (`IPlugin`) и регистрируется в приложении.
 */
export interface IPlatformAdapter<TQuery = unknown> extends IPlugin {
    /**
     * Имя http-заголовка, в котором платформа передаёт подпись/секрет вебхука.
     *
     * Заполняется адаптером для платформ с подписью в http-заголовке
     * (Telegram, Viber, MAX). VK проверяет секрет в теле запроса и
     * задаёт только `isSignatureCheckEnabled`. Отсутствие поля означает, что проверка
     * подписи для платформы недоступна по построению (Alisa, Marusia, SmartApp).
     * Используется ядром для предупреждения при старте о вебхуке без защиты.
     */
    signatureName?: string;
    /**
     * Возвращает, включена ли проверка подписи вебхука для этой платформы
     * с текущей конфигурацией (секрет задан).
     *
     * Используется ядром в `bot.start()` для предупреждения о вебхуке, который
     * принимает запросы платформы без проверки подлинности. Адаптеры платформ
     * с подписью переопределяют метод: базовая реализация считает проверку
     * включённой при заданных `tokens[platform].token` и `signatureName`
     * (схема HMAC, например Viber).
     */
    isSignatureCheckEnabled?: () => boolean;
    /**
     * Умеет ли платформа подписывать вебхук (секрет в заголовке или в теле).
     *
     * Ядро предупреждает при старте о вебхуке без проверки подписи только для
     * таких платформ: у Алисы, Маруси и SmartApp подписи нет, и советовать задать
     * секрет бессмысленно. `BasePlatform` отвечает `true`, если задан `signatureName`
     * или переопределён `isSignatureCheckEnabled`. Без метода (прямая реализация
     * интерфейса) ядро судит по тем же признакам.
     *
     * @returns `true`, если у платформы есть механизм подписи вебхука
     *
     * @example
     * ```ts
     * class MyAdapter extends BasePlatform {
     *     // Подписи у платформы нет — предупреждение при старте не нужно
     *     isSignatureSupported(): boolean {
     *         return false;
     *     }
     * }
     * ```
     */
    isSignatureSupported?: () => boolean;
    /**
     * Уникальный ID доставки вебхука — для дедупликации повторов.
     *
     * Мессенджеры повторяют доставку, если не получили 2xx вовремя. Ядро помнит ID
     * принятых доставок (в памяти процесса, 1 час) и на повтор отвечает `200 ok`,
     * не запуская логику повторно. Повтор, пришедший во время обработки исходного
     * запроса, ждёт его исхода и обрабатывается заново, если исходный упал с 500.
     * Ключ дополняется хэшем тела запроса, поэтому поддельный запрос с угаданным ID
     * не заблокирует настоящий апдейт.
     *
     * Реализуйте, только если ответ платформе не несёт содержимого (ответ уходит
     * через API): повтор получит тело `ok`. Голосовым платформам метод не нужен.
     *
     * @param query - разобранное тело запроса
     * @returns ID доставки или `null`, если в запросе его нет
     *
     * @example
     * ```ts
     * getDeliveryId(query: IMyUpdate): string | null {
     *     return query.update_id === undefined ? null : String(query.update_id);
     * }
     * ```
     */
    getDeliveryId?: (query: TQuery) => string | null;
    /**
     * Сколько платформа ждёт ответа на запрос, мс.
     *
     * Ядро выполняет запросы одного пользователя по очереди. Если платформа ждёт ответ
     * ограниченное время (Алиса, Маруся, SmartApp), запрос ждёт предыдущий не дольше
     * половины оставшегося времени и затем выполняется параллельно — иначе ответ опоздал бы.
     * `BasePlatform` отвечает `null`: мессенджеры получают ответ через API, и жёсткого
     * срока у них нет.
     *
     * @returns Срок ответа в мс или `null`, если срока нет
     *
     * @example
     * ```ts
     * class MyVoiceAdapter extends BasePlatform {
     *     // Платформа обрывает запрос через 3 секунды
     *     getResponseTimeout(): number | null {
     *         return 2900;
     *     }
     * }
     * ```
     */
    getResponseTimeout?: () => number | null;
    /**
     * Long polling: один запрос за новыми обновлениями платформы (Telegram `getUpdates`,
     * VK Bots Long Poll, MAX `GET /updates`). Реализуйте, если платформа умеет отдавать
     * обновления по запросу, — тогда бота можно запустить `bot.startPolling()` без
     * публичного HTTPS-адреса.
     *
     * Ядро вызывает метод в цикле и обрабатывает каждое обновление как запрос вебхука,
     * но без проверки подписи: обновление получено от API платформы по токену бота.
     * Позицию чтения (offset, marker, ts) хранит адаптер: следующий вызов должен вернуть
     * обновления после уже отданных. Запрос должен завершаться по `signal` — так
     * `bot.stopPolling()` и `bot.close()` не ждут окончания долгого запроса. Передавайте
     * сигнал через `Request.signal`: `AbortSignal.any()` с этим сигналом в Node 20 копит
     * память, ведь сигнал живёт весь сеанс polling.
     *
     * Временную ошибку (сеть, 5xx) бросайте исключением — ядро повторит вызов с растущей
     * паузой. Если polling невозможен (неверный токен, у бота активен вебхук), запишите
     * причину в лог и верните `null`: ядро остановит цикл этой платформы.
     * @param signal Сигнал остановки polling
     * @returns Обновления в формате тела вебхука платформы, `[]` — новых нет, `null` — остановить polling
     * @example
     * ```ts
     * class MyAdapter extends BasePlatform {
     *     #offset = 0;
     *
     *     async getUpdates(signal: AbortSignal): Promise<unknown[] | null> {
     *         const request = new Request(this.appContext as AppContext);
     *         request.maxTimeQuery = 35_000; // дольше, чем платформа держит запрос (25 с)
     *         request.signal = signal;
     *         const res = await request.send<{ id: number }[]>(
     *             `https://api.example.com/updates?offset=${this.#offset}&timeout=25`,
     *         );
     *         if (res.httpStatus === 401) {
     *             this.appContext?.logError('MyAdapter: неверный токен, polling остановлен.');
     *             return null;
     *         }
     *         if (!res.status || !res.data) {
     *             throw new Error(`HTTP ${res.httpStatus ?? 'нет ответа'}`);
     *         }
     *         const updates = res.data;
     *         if (updates.length) {
     *             this.#offset = updates[updates.length - 1].id + 1;
     *         }
     *         return updates;
     *     }
     * }
     * ```
     */
    getUpdates?: (signal: AbortSignal) => Promise<unknown[] | null>;
    /**
     * Определяет, принадлежит ли входящий запрос данной платформе.
     *
     * Метод проверяет заголовки или структуру тела запроса.
     * Используется для маршрутизации входящих запросов между адаптерами.
     *
     * @param query - входящий запрос (тело или объект)
     * @param headers - HTTP-заголовки (если есть)
     * @returns `true`, если запрос относится к этой платформе, иначе `false`
     *
     * @example
     * ```ts
     * // Telegram узнаёт свой апдейт по полю update_id; секрет вебхука проверяет isCorrectQuery
     * isPlatformOnQuery(query) {
     *   return typeof query === 'object' && query !== null && 'update_id' in query;
     * }
     * ```
     */
    isPlatformOnQuery: (query: TQuery, headers?: Record<string, unknown>) => boolean;
    /**
     * Проверяет полученный запрос от платформы на корректность.
     * Реализация зависит от адаптера, как правило, в чувствительных платформах есть токен,
     * который приходит с запросом, и желательно проверять, что пришедший токен соответствует тому, который сохранён в настройках.
     * @param {TQuery} query - Запрос от платформы. В `webhookHandle` — сырое тело строкой
     *   (от него считается HMAC-подпись)
     * @param {Record<string, unknown>} [headers] - HTTP-заголовки запроса
     * @param {unknown} [parsedQuery] - То же тело, уже разобранное из JSON фреймворком.
     *   Передаётся в `webhookHandle`/`webhookEvent`: адаптеру, которому для проверки нужен
     *   объект (секрет в теле, как у VK), не нужно разбирать JSON второй раз.
     * @returns `true`, если запрос прошёл проверку
     *
     * @example
     * ```ts
     * isCorrectQuery(query, headers, parsedQuery) {
     *   const body = (parsedQuery ?? (typeof query === 'string' ? JSON.parse(query) : query)) as { secret?: string };
     *   const got = Buffer.from(body.secret ?? '');
     *   const expected = Buffer.from(this.secret);
     *   // timingSafeEqual из node:crypto — сравнение секрета за постоянное время
     *   return got.length === expected.length && timingSafeEqual(got, expected);
     * }
     * ```
     */
    isCorrectQuery: (
        query: TQuery,
        headers?: Record<string, unknown>,
        parsedQuery?: unknown,
    ) => boolean;
    /**
     * Инициализирует данные запроса в контроллере приложения.
     *
     * Парсит входящий запрос и заполняет `controller.userCommand`, `controller.payload` и другие поля.
     * Вызывается после подтверждения, что запрос принадлежит этой платформе.
     *
     * @param query - входящий запрос
     * @param controller - контроллер приложения для текущего запроса
     * @returns `false`, если запрос повреждён или не может быть обработан; иначе `true`
     */
    setQueryData: (query: TQuery, controller: BotController) => boolean | Promise<boolean>;
    /**
     * Формирует тело ответа для отправки пользователю.
     *
     * Возвращает платформо-специфичный ответ (например, JSON для Алисы).
     * Для платформ, которые отправляют ответ напрямую (например, Telegram через `sendMessage`),
     * метод может возвращать `{ ok: true }` или аналог.
     *
     * @param controller - контроллер с готовым ответом
     * @param stateData - данные для локального хранилища
     * @returns ответ в формате, понятном платформе
     */
    getContent: (
        controller: BotController,
        stateData?: Record<string, unknown> | null,
    ) => object | string | Promise<object | string>;
    /**
     * Формирует контекст для отправки рейтинга (если поддерживается платформой).
     *
     * Используется только на платформах с поддержкой рейтинга (например, Сбер SmartApp).
     * Метод обязателен, но `BasePlatform` уже даёт реализацию по умолчанию
     * (делегирует `getContent`), поэтому переопределять его нужно только
     * для спец-формата рейтинга.
     *
     * @param controller - контроллер приложения
     * @returns данные для отправки рейтинга
     */
    getRatingContext: (controller: BotController) => object | string | Promise<object | string>;
    /**
     * Устанавливает время начала обработки запроса.
     *
     * Используется для измерения времени отклика (`processingTime`).
     *
     * @param controller - контроллер приложения
     */
    updateTimeStart: (controller: BotController) => void;
    /**
     * Возвращает время обработки запроса в миллисекундах.
     *
     * Основано на разнице между `updateTimeStart` и текущим временем.
     *
     * @param controller - контроллер приложения
     * @returns время обработки в мс
     */
    getProcessingTime: (controller: BotController) => number;
    /**
     * Уникальное имя платформы (например, 'telegram', 'alisa').
     */
    platformName: string;
    /**
     * Универсальные события (`TEventType`), которые адаптер может выставить
     * в `controller.eventType`. Источник знания для валидации `bot.addEvent(...)`:
     * таблица принадлежит адаптеру, поэтому кастомные платформы участвуют
     * в проверке автоматически.
     *
     * Опционально: `BasePlatform` уже объявляет дефолт `['message']`, поэтому
     * наследникам достаточно переопределить поле при поддержке других событий.
     * Отсутствие поля (прямая реализация интерфейса) приравнивается к `['message']`.
     */
    supportedEvents?: readonly TEventType[];
    /**
     * Указывает, поддерживает ли платформа локальное хранилище.
     *
     * @param controller - контроллер приложения
     * @returns `true`, если локальное хранилище доступно
     */
    isLocalStorage: (controller: BotController) => boolean;
    /**
     * Получает данные из локального хранилища платформы.
     *
     * @param controller - контроллер приложения
     * @returns данные, сохранённые ранее
     */
    getLocalStorage: <TStorageResult = unknown>(
        controller: BotController,
    ) => TStorageResult | Promise<TStorageResult>;
    /**
     * Сохраняет данные в локальное хранилище платформы.
     *
     * @param data - данные для сохранения
     * @param controller - контроллер приложения
     */
    setLocalStorage: <TStorageData>(
        data: TStorageData,
        controller: BotController,
    ) => void | Promise<void>;
    /**
     * Флаг, указывающий, что платформа голосовая (например, Алиса, Маруся).
     */
    isVoice: boolean;
    /**
     * Генерирует пример входящего запроса для локального тестирования навыка/бота.
     *
     * Используется в инструментах отладки и авто-тестах.
     *
     * @param query - текст запроса
     * @param userId - идентификатор пользователя
     * @param count - счётчик для уникальности
     * @param state - состояние сессии
     * @returns объект, имитирующий входящий запрос платформы
     */
    getQueryExample: (
        query: string,
        userId: string,
        count: number,
        state: Record<string, unknown> | string,
    ) => Record<string, unknown>;

    /**
     * Отправка текста пользователю
     * Этот метод используется для активных рассылок — когда навык или бот инициирует диалог первым (например, уведомление).
     * В данном методе необходимо поддержать отправку результата пользователю.
     * Это необходимо для того, чтобы само приложение смогло продолжить диалог.
     *
     * Если ваша платформа не поддерживает отправку сообщений без входящего запроса (как Алиса), оставьте реализацию пустой или верните заглушку.
     * @param userId Ид пользователя, которому нужно отправить сообщение
     * @param controllerOrText Контроллер приложения или текст. Если необходимо отправить просто текст, можно передать строку, в случае, если необходимо передать картинку звук и тд, то необходимо корректно заполнить контроллер.
     */
    send(userId: string | number, controllerOrText: BotController | string): unknown | boolean;

    /**
     * Создаёт API-фасад платформы для `controller.api`.
     *
     * Фасад даёт бизнес-логике доступ к исходящим возможностям платформы
     * (отправить медиа, ответить на callback-кнопку) без ручного конструирования
     * платформенных Request-классов. Ядро вызывает этот метод само — знает о
     * платформах только через данный контракт, поэтому добавить фасад новой
     * платформе можно, не трогая ядро.
     *
     * Опционален: `BasePlatform` даёт реализацию по умолчанию (возвращает
     * `null` — фасад недоступен), поэтому переопределять его нужно только
     * платформам с исходящими API-вызовами. Голосовым платформам (Алиса,
     * Маруся, SmartApp) фасад не нужен: их ответ формируется телом webhook.
     *
     * @param controller - Контроллер текущего запроса
     * @returns Фасад либо `null`, если для платформы он недоступен
     *
     * @example
     * ```ts
     * class MyPlatformAdapter extends BasePlatform {
     *     // Своя платформа + свой фасад — достаточно переопределить один метод
     *     createApi(controller: BotController): IControllerApi | null {
     *         return makeMyApi(controller);
     *     }
     * }
     * ```
     */
    createApi?(controller: BotController): IControllerApi | null;

    /**
     * Определяет лимит платформы.
     * В значение указывается количество запросов, которое можно отправить платформе за 1 секунду.
     * В случае, если у платформы нет ограничений, можно указать 0 или null.
     * По умолчанию null
     */
    limit: number | null;
}

/**
 * Результат запроса к базе данных.
 *
 * Поддерживает доступ как по строковым, так и по числовым ключам.
 * Используется для представления результатов SELECT-запросов.
 *
 * @template TValue — тип записей в результате (например, `User`, `Session`).
 *
 * @example
 * ```ts
 * const users: IDbResult<User> = {
 *   'user:123': { id: '123', name: 'Alice' },
 *   456: { id: '456', name: 'Bob' }
 * };
 * ```
 */
export interface IDbResult<TValue = unknown> {
    /**
     * Результат запроса, доступный по строковым ключам
     */
    [keyStr: string]: TValue;

    /**
     * Результат запроса, доступный по числовым ключам
     */
    [keyInt: number]: TValue;
}

/**
 * Адаптер для работы с базой данных.
 *
 * Обеспечивает унифицированный интерфейс для различных СУБД (файловая, MongoDB, PostgreSQL и др.).
 * Все данные подключения и соединения хранятся в `AppContext` через `IDatabaseInfo`,
 * чтобы избежать повторного подключения при каждом запросе.
 */
export interface IDatabaseAdapter extends IPlugin {
    /**
     * Вызывается при удалении модели или завершении сессии.
     * Может использоваться для освобождения ресурсов, связанных с таблицей.
     * @param tableName Название таблицы, подключение к которой закрывается
     */
    close: (tableName: string) => void | Promise<void>;
    /**
     * Вызывается при завершении работы приложения или замене адаптера.
     * Используйте для закрытия соединений, сохранения данных и т.п.
     */
    destroy: () => void | Promise<void>;
    /**
     * Выполняет SELECT-запрос.
     * @param selectData Дополнительная информация для запроса. Содержит информацию о таблице и структуре.
     * @param where Условия фильтрации (WHERE)
     * @param isOne Определяет нужно ли вернуть только 1 найденную запись, либо отдать все доступные данные.
     */
    select: (selectData: IQuery, where: IQueryData | null, isOne: boolean) => Promise<IModelRes>;
    /**
     * Выполняет INSERT-запрос.
     * @param insertData — Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     */
    insert: (insertData: IQuery) => Promise<boolean>;
    /**
     * Выполняет UPDATE-запрос.
     * @param updateData — Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     */
    update: (updateData: IQuery) => Promise<boolean>;
    /**
     * Выполняет DELETE-запрос.
     * @param removeData — Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     */
    remove: (removeData: IQuery) => Promise<boolean>;
    /**
     * Выполняет произвольный запрос через callback.
     *
     * @param callback функция обработчик
     */
    query: (callback: TQueryCb) => unknown;
    /**
     * Проверяет, установлено ли соединение с БД.
     */
    isConnected: () => Promise<boolean> | boolean;

    /**
     * Сохраняет данные (INSERT или UPDATE в зависимости от `isNew`).
     * @param query Данные для запроса. Включает как запрос, так и сами данные
     * @param isNew Флаг, говорящий о том, что добавляется новая запись
     */
    save(query: IQuery, isNew: boolean): Promise<boolean>;

    /**
     * Извлекает значения из результата запроса.
     * @param data Результат запроса. В случае успешного запроса вернутся данные, в противном случае null
     */
    getValue: (data: IModelRes) => IDbResult | null;
    /**
     * Выполняет SELECT с ограничением до одной записи.
     * @param selectData Дополнительные данные для запроса
     * @param where — Условия поиска
     */
    selectOne: (selectData: IQuery, where: IQueryData | null) => Promise<IModelRes | null>;
    /**
     * Экранирует строку для безопасного использования в SQL-запросах.
     * @param str — Экранируемая строка
     */
    escapeString: (str: string | number) => string;

    /**
     * Устанавливает подключение к базе данных.
     * В случае успешного подключения возвращается true
     */
    connect: () => Promise<boolean> | boolean;

    /**
     * Подготавливает хранилище под встроенные таблицы umbot: создаёт недостающие
     * таблицы, колонки или индексы. Фреймворк вызывает метод один раз после каждого
     * успешного подключения (connect), до первого запроса к базе. Метод обязан быть
     * идемпотентным: таблицы и индексы, которые уже есть, не пересоздаются.
     *
     * Необязательный: адаптер без метода (или базовый адаптер) ничего не готовит —
     * так работают хранилища без схемы (FileAdapter). SQL-адаптер должен создать
     * таблицы, иначе первый же запрос упадёт с «таблица не существует».
     *
     * @param tables Описание встроенных таблиц (`DB_TABLES_SCHEMA`)
     * @returns false (или Promise<false>), если подготовить схему не удалось —
     *   фреймворк запишет ошибку в лог и продолжит работу с базой
     *
     * @example
     * ```ts
     * async ensureSchema(tables: readonly IDbTableSchema[]): Promise<boolean> {
     *     for (const table of tables) {
     *         const columns = Object.entries(table.fields).map(([name, field]) =>
     *             `"${name}" ${field.type === 'text' ? 'TEXT' : 'VARCHAR(255)'}`,
     *         );
     *         await this.#pool.query(
     *             `CREATE TABLE IF NOT EXISTS "${table.tableName}" (${columns.join(', ')})`,
     *         );
     *     }
     *     return true;
     * }
     * ```
     */
    ensureSchema?: (tables: readonly IDbTableSchema[]) => boolean | Promise<boolean>;
}

/**
 * Хранилище для данных подключения и состояния базы данных.
 *
 * Содержит произвольные поля, зависящие от типа БД:
 * - Для файловой БД: `{ userData: {...}, image: {...} }`
 * - Для MongoDB: `{ mongoClient: MongoClient, mongoConnect: MongoClient }`
 *
 * Используется в `AppContext<IDatabaseInfo>` для избежания повторного подключения
 * при каждом запросе.
 */
export interface IDatabaseInfo {
    [key: string]: unknown;
}

/**
 * Реестр подключённых платформ.
 *
 * Ключ — имя платформы (например, `'telegram'`), значение — её адаптер.
 */
export interface IPlatform<TQuery = unknown> {
    [name: string]: IPlatformAdapter<TQuery>;
}

/**
 * Обработчик кнопок для кастомизации отображения под платформу.
 *
 * Используется внутри адаптеров платформ для преобразования общего формата кнопок
 * в платформо-специфичный (например, для Telegram или Алисы).
 *
 * @param buttons - массив кнопок в общем формате
 * @returns результат в формате, понятном платформе
 * @example
 * ```ts
 * function buttonProcessing(buttons) {
 *     let result = ...
 *     return result;
 * }
 * ```
 */
export type TButtonProcessing<
    TResult = unknown,
    TType = Record<string, unknown> | string | null,
> = (buttons: IButtonType<TType>[]) => TResult;

/**
 * Данные для формирования карточки (галерея, кнопки, заголовок).
 *
 * Используется в `TCardProcessing` для кастомизации отображения под платформу.
 */
export interface ICardInfo {
    /**
     * Используется ли режим галереи (несколько карточек).
     */
    usedGallery: boolean;
    /**
     * Массив изображений для карточки(ек).
     */
    images: IImageType[];
    /**
     * Кнопки, привязанные к карточке.
     */
    buttons: Buttons;
    /**
     * Заголовок карточки.
     */
    title: string | null;
    /**
     * Описание карточки
     */
    description: string | null;
    /**
     * Показывать только первую карточку.
     */
    showOne?: boolean;
}

/**
 * Обработчик карточек для кастомизации отображения под платформу.
 *
 * @param cardInfo - данные карточки в общем формате
 * @param controller - контроллер приложения
 * @returns результат в формате, понятном платформе
 */
export type TCardProcessing<TResult = unknown> = (
    cardInfo: ICardInfo,
    controller: BotController,
) => TResult;

/**
 * Данные для формирования звукового ответа.
 *
 * Используется в `TSoundProcessing` для генерации TTS или аудиофайлов.
 */
export interface ISoundInfo {
    /**
     * Используется ли стандартный звуковой ответ (TTS).
     */
    usedStandardSound: boolean;
    /**
     * Текст для озвучки (если используется TTS).
     */
    text: string;
    /**
     * Список кастомных аудиофайлов.
     */
    sounds: ISound[];
}

/**
 * Обработчик звуковых сообщений.
 *
 * @param soundInfo - данные для звукового ответа
 * @param controller - контроллер приложения
 * @returns строка, массив строк или промис с медиа-контентом
 */
export type TSoundProcessing<TResult = string | Promise<string> | Promise<string[]>> = (
    soundInfo: ISoundInfo,
    controller: BotController,
) => TResult;

/**
 * Тип, определяющий режим работы с группировкой регулярных выражений.
 *  - auto - Режим, при котором регулярные выражения группируются при достижении определенного количества.
 *  - no-group - Режим, запрещающий группировать регулярные выражения.
 *  - group - Режим, при котором все регулярные выражения группируются.
 */
export type TCommandGroupMode = 'auto' | 'no-group' | 'group';

/**
 * Контекст формы — данные, переданные в {@link Bot.startForm} (например, id комнаты).
 * Хранится в `userData` между шагами, поэтому должен сериализоваться в JSON.
 */
export type TFormContext = Record<string, unknown>;

/**
 * Результат `parse` поля формы: преобразованное значение либо текст ошибки
 * (тогда вопрос задаётся повторно).
 */
export type TFormParseResult = { value: unknown } | { error: string };

/**
 * Описание одного поля формы в {@link Bot.addForm}.
 *
 * @template TBotController Контроллер (по умолчанию `BotController`)
 */
export interface IAddFormField<TBotController extends BotController = BotController> {
    /**
     * Имя поля. Станет ключом в объекте ответов, который получит `onComplete`.
     * Должно быть валидным ключом объекта.
     * @example 'name', 'email', 'age'
     */
    name: string;

    /**
     * Текст, который бот отправит пользователю с просьбой ввести это поле.
     * Может быть строкой или функцией от контроллера и контекста формы (см. {@link Bot.startForm}).
     * @example 'Как вас зовут?' | (ctx, context) => `Комната ${context.roomId}. Ваше имя?`
     */
    prompt: string | ((ctx: TBotController, context: TFormContext) => string);

    /**
     * Варианты ответа: показываются кнопками, ответ должен совпасть с одним из них (без учёта
     * регистра). В ответы попадает вариант в написании из списка. Иначе вопрос задаётся
     * повторно с текстом `invalidOptionText` формы.
     * @example ['Утро', 'День', 'Вечер']
     */
    options?: string[];

    /**
     * Необязательное поле: к вопросу добавляется кнопка `skipText` формы («Пропустить»).
     * Пропущенное поле не попадает в ответы.
     */
    optional?: boolean;

    /**
     * Валидатор пользовательского ввода.
     *
     * Может быть синхронным или асинхронным.
     * Возвращаемое значение:
     * - `true` — значение принято, переходим к следующему полю.
     * - `false` — валидация не прошла, повторяем prompt без сообщения об ошибке.
     * - `string` — эта строка отправляется пользователю как текст ошибки.
     *
     * @example
     * ```ts
     * // Синхронная валидация
     * validate: (v) => v.length > 0
     *
     * // Сообщение, если неверно
     * validate: (v) => /\S+@\S+/.test(v) || 'Некорректный email'
     *
     * // Асинхронная (например, проверка через API)
     * validate: async (v) => {
     *     const exists = await db.users.findOne({ email: v });
     *     return exists ? 'Email уже занят' : true;
     * }
     * ```
     */
    validate?: (value: string) => boolean | string | Promise<boolean | string>;

    /**
     * Проверка с преобразованием ответа (вызывается после `validate`): вернуть `{ value }` —
     * в ответы попадёт `value`; `{ error }` — вопрос задаётся повторно с этим текстом.
     * Значение хранится в `userData` до конца формы, поэтому должно сериализоваться в JSON
     * (дату возвращайте строкой ISO).
     *
     * @example
     * ```ts
     * parse: (v) => (Number.isInteger(+v) && +v > 0 ? { value: +v } : { error: 'Нужно целое число' })
     * ```
     */
    parse?: (value: string, ctx: TBotController) => TFormParseResult | Promise<TFormParseResult>;
}

/**
 * Ключевые параметры метода {@link Bot.addForm} — регистрации многошаговой формы.
 *
 * @template TBotController Контроллер
 * @template TAnswers Тип ответов в `onComplete` (по умолчанию — строки)
 */
export interface IAddFormOptions<
    TBotController extends BotController = BotController,
    TAnswers extends Record<string, unknown> = Record<string, string>,
> {
    /**
     * Список полей формы. Обрабатываются последовательно — каждое поле становится своим шагом.
     */
    fields: IAddFormField<TBotController>[];

    /**
     * Колбек, вызываемый после того как заполнены ВСЕ поля.
     * Может быть синхронным или асинхронным — фреймворк дождётся его завершения
     * перед формированием ответа.
     *
     * @param ctx BotController — имеет доступ к userData, тексту, кнопкам и т.д.
     * @param answers Объект с ответами: ключ — name поля, значение — введённый текст
     *   (или результат `parse`). Пропущенных необязательных полей в нём нет.
     * @param context Контекст, переданный в {@link Bot.startForm} (`{}`, если форма запущена иначе)
     *
     * @example
     * ```ts
     * onComplete: (ctx, answers) => {
     *     ctx.text = `Спасибо, ${answers.name}! Мы вас записали (${answers.email}).`;
     * }
     * ```
     */
    onComplete: (
        ctx: TBotController,
        answers: TAnswers,
        context: TFormContext,
    ) => void | Promise<void>;

    /**
     * Текст, который получит пользователь при отмене формы.
     * @defaultValue 'Форма отменена.'
     */
    cancelText?: string;

    /**
     * Список команд, которые отменяют форму. Работают в любом регистре.
     * @defaultValue ['отмена', 'cancel']
     */
    cancelCommands?: string[];

    /**
     * Надпись кнопки пропуска необязательного поля (`optional`). Работает и как текст ответа.
     * @defaultValue 'Пропустить'
     */
    skipText?: string;

    /**
     * Текст ошибки, когда ответ не совпал ни с одним из `options` поля.
     * @defaultValue 'Выберите один из вариантов.'
     */
    invalidOptionText?: string;

    /**
     * Выход по чужой кнопке или команде: нажатие callback-кнопки или текст, точно совпавший
     * с зарегистрированной командой (`addCommand`/`addAction`), если это не вариант ответа
     * поля, завершает форму без `onComplete`, и запрос уходит обычному конвейеру (команды,
     * интенты). Без опции такой ввод считается ответом на вопрос.
     * @defaultValue false
     */
    escape?: boolean;
}

/**
 * Результат выполнения запроса от платформы - ответ, который будет отправлен пользователю
 * Может быть ответом для Алисы, Маруси или текстовым сообщением
 *
 * @example
 * ```ts
 * // Ответ для Алисы
 * const alisaResponse: TRunResult = {
 *   response: {
 *     text: 'Привет!',
 *     end_session: false
 *   },
 *   version: '1.0'
 * };
 *
 * // Ответ для Маруси
 * const marusiaResponse: TRunResult = {
 *   response: {
 *     text: 'Привет!',
 *     end_session: false
 *   },
 *   version: '1.0'
 * };
 *
 * // Простой текстовый ответ
 * const textResponse: TRunResult = 'Привет!';
 * ```
 */
export type TRunResult = object | string;
/**
 * Кнопка сообщения {@link ISendMessage}: как аргументы `buttons.addBtn(title, url, payload, options)`.
 */
export interface ISendButton {
    /** Текст кнопки */
    title: string;
    /** Ссылка (кнопка-ссылка) */
    url?: string;
    /** Payload кнопки — например, `action.payload(data)` из {@link Bot.defineAction} */
    payload?: TButtonPayload;
    /** Опции кнопки */
    options?: IButtonOptions;
}

/**
 * Сообщение для {@link Bot.send} и {@link Bot.broadcast} без ручной сборки контроллера.
 *
 * @example
 * ```ts
 * await bot.send(userId, { text: 'Комната готова', buttons: ['Открыть', { title: 'Сайт', url: 'https://example.com' }] }, T_TELEGRAM);
 * ```
 */
export interface ISendMessage {
    /** Текст сообщения */
    text: string;
    /** Текст для озвучки (TTS), где платформа его поддерживает */
    tts?: string;
    /** Кнопки: строка — обычная кнопка с этим текстом */
    buttons?: (string | ISendButton)[];
}

/**
 * Параметры {@link Bot.broadcast}.
 */
export interface IBroadcastOptions {
    /**
     * Вызывается после каждой отправки: прогресс рассылки, отметка в БД.
     * @param userId Получатель
     * @param ok `true` — доставлено, `false` — нет (причина в логе)
     */
    onResult?: (userId: string | number, ok: boolean) => void | Promise<void>;
}

/**
 * Результат {@link Bot.broadcast}.
 */
export interface IBroadcastResult {
    /** Кому сообщение доставлено */
    sent: (string | number)[];
    /** Кому не доставлено: пользователь заблокировал бота, неверный id, сбой сети */
    failed: (string | number)[];
}

/**
 * Данные кнопки действия ({@link Bot.defineAction}): плоский объект, который уходит в payload
 * кнопки и возвращается обработчику при нажатии. Ключи `action` и `command` зарезервированы
 * для маршрутизации нажатия — они игнорируются в данных кнопки.
 */
export type TActionData = Record<string, string | number | boolean | null>;

/**
 * Действие кнопки с данными — результат {@link Bot.defineAction}. Одно описание служит и для
 * создания кнопки (payload `{ action: name, ...data }`), и для обработчика нажатия, который
 * получает уже разобранные данные.
 *
 * @template TData Данные кнопки
 * @template TBotController Контроллер
 *
 * @example
 * ```ts
 * const kick = bot.defineAction<{ p: string }>('kick');
 * kick.handle((data, ctx) => {
 *     ctx.text = `Исключаем участника ${data.p}`;
 * });
 * // в обработчике, который показывает список участников:
 * kick.addBtn(ctx.buttons, 'Исключить', { p: participant.id });
 * ```
 */
export interface IButtonAction<
    TData extends TActionData = TActionData,
    TBotController extends BotController = BotController,
> {
    /** Имя действия */
    readonly name: string;
    /**
     * Payload кнопки этого действия — для `card.addButton()` и других мест, где кнопка
     * создаётся не через {@link IButtonAction.addBtn}. Зарезервированные ключи `action` и
     * `command` из данных исключаются: маршрутизация нажатия всегда ведёт на это действие.
     * @param data Данные кнопки
     * @returns `{ action: name, ...data }` без зарезервированных ключей
     */
    payload(data?: TData): Record<string, unknown>;
    /**
     * Добавляет кнопку действия. Если payload длиннее 64 байт и подключён Telegram, пишет
     * предупреждение: Telegram такую кнопку не примет.
     * @param buttons Кнопки ответа (`ctx.buttons`)
     * @param title Текст кнопки
     * @param data Данные кнопки
     * @param options Опции кнопки (как у `buttons.addBtn`)
     * @returns `buttons` для цепочки
     */
    addBtn(buttons: Buttons, title: string, data?: TData, options?: IButtonOptions): Buttons;
    /**
     * Регистрирует обработчик нажатия (через {@link Bot.addAction}).
     * @param cb Обработчик: данные кнопки (payload без поля `action`) и контроллер;
     *   может вернуть строку-ответ, поддерживает `async`
     * @returns Это же действие
     */
    handle(
        cb: (data: TData, ctx: TBotController) => void | string | Promise<void | string>,
    ): IButtonAction<TData, TBotController>;
}

/**
 * Кнопка экрана меню ({@link Bot.defineMenu}). Задайте одно из полей `to`, `url` или `payload`.
 */
export interface IMenuButton {
    /** Текст кнопки; его же пользователь может сказать или написать */
    title: string;
    /** Экран, на который ведёт кнопка */
    to?: string;
    /** Ссылка (кнопка-ссылка) */
    url?: string;
    /** Payload другого действия — например, `action.payload(data)` из {@link Bot.defineAction} */
    payload?: TButtonPayload;
}

/**
 * Экран меню ({@link Bot.defineMenu}).
 */
export interface IMenuScreen<TBotController extends BotController = BotController> {
    /** Текст экрана: строка или функция от контроллера (баланс, имя пользователя) */
    text: string | ((ctx: TBotController) => string);
    /** Кнопки экрана в порядке показа */
    buttons?: IMenuButton[];
    /** Экран, куда ведёт кнопка «Назад»; без поля кнопки нет */
    parent?: string;
    /**
     * Вызывается после того, как текст и кнопки экрана заданы: карточки, список с
     * `Navigation`, запуск формы. Может быть `async`.
     */
    onShow?: (ctx: TBotController) => void | Promise<void>;
}

/**
 * Параметры {@link Bot.defineMenu}.
 */
export interface IMenuOptions<TBotController extends BotController = BotController> {
    /** Экраны по именам */
    screens: Record<string, IMenuScreen<TBotController>>;
    /** Экран по умолчанию; без поля — первый в `screens` */
    start?: string;
    /** Текст кнопки возврата (по умолчанию «Назад») */
    backText?: string;
}

/**
 * Меню, созданное {@link Bot.defineMenu}.
 */
export interface IMenu<TBotController extends BotController = BotController> {
    /** Имя меню */
    readonly name: string;
    /**
     * Показывает экран: текст, кнопки, «Назад», затем `onShow`.
     * @param ctx Контроллер запроса
     * @param screen Имя экрана; без него или для неизвестного — экран по умолчанию
     * @returns Промис, только если `onShow` экрана асинхронный
     */
    show(ctx: TBotController, screen?: string): void | Promise<void>;
    /**
     * Payload кнопки перехода на экран — для кнопок вне меню (`buttons.addBtn`, `bot.send`).
     * @param screen Имя экрана
     * @returns `{ action, s: screen }`
     */
    payload(screen: string): Record<string, unknown>;
}
