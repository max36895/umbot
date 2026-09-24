/**
 * Интерфейсы и типы для работы с приложением.
 * Определяют основные контракты и структуры данных для взаимодействия
 */

import { AppContext } from '../AppContext';
import { BotController, IControllerApi } from '../../controller';
import { IncomingMessage, ServerResponse } from 'node:http';
import { IButtonType, Buttons, IImageType, ISound } from '../../components';
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
     * // Telegram проверяет наличие заголовка 'X-Telegram-Bot-API-Secret-Token'
     * isPlatformOnQuery(query, headers) {
     *   return headers?.['x-telegram-bot-api-secret-token'] === this.secret;
     * }
     * ```
     */
    isPlatformOnQuery: (query: TQuery, headers?: Record<string, unknown>) => boolean;
    /**
     * Проверяет полученный запрос от платформы на корректность.
     * Реализация зависит от адаптера, как правило, в чувствительных платформах есть токен, который приходит с запросом, и желательно проверять, что пришедший токен соответствует тому, который сохранён в настройках.
     * @param {TQuery} query - Объект запроса от платформы
     * @param {Record<string, unknown>} [headers] - HTTP-заголовки запроса
     */
    isCorrectQuery: (query: TQuery, headers?: Record<string, unknown>) => boolean;
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
    // TODO: тип возврата unknown | boolean вырождается в unknown — стоит упростить до unknown
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
