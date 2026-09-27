import { Base } from '../Base/Base';
import {
    IModelRes,
    TQueryCb,
    IQueryData,
    IQuery,
    Text,
    AppContext,
    IDatabaseInfo,
    IAppDB,
    IDbTableSchema,
} from '../../../index';
import type { MongoClient, MongoClientOptions, Db, Document, Filter, OptionalId } from 'mongodb';

/**
 * Тип модуля mongodb, получаемого через ленивую загрузку (`import('mongodb')`).
 */
type TMongoModule = typeof import('mongodb');

/**
 * Интерфейс для сохранения информации работы базы данных
 */
export interface IMongoDbInfo extends IDatabaseInfo {
    /**
     * Клиент подключения
     */
    mongoClient: MongoClient | null;
    /**
     * Само подключение
     */
    mongoConnect: MongoClient | null;
}

/**
 * Адаптер для работы с базой данных mongodb
 */
export class MongoAdapter extends Base<IMongoDbInfo> {
    /**
     * Формат базы данных
     */
    dbFormat: string = 'mongodb';

    constructor(options?: IAppDB) {
        super(options);
    }

    /**
     * Кэш лениво загруженного модуля mongodb.
     * Загружается только при реальном подключении, чтобы пользователи,
     * которым Mongo не нужен, не обязаны были его устанавливать.
     */
    #mongoModule: TMongoModule | null = null;

    /**
     * Лениво загружает модуль mongodb (один раз) и кэширует его.
     *
     * `mongodb` объявлен как опциональная peer-зависимость: он нужен только тем,
     * кто реально использует `MongoAdapter`. Статический `import` в шапке файла
     * заставил бы Node требовать пакет у всех, кто импортирует `umbot/plugins`,
     * даже при использовании только `FileAdapter`. Поэтому модуль подгружается
     * динамически в момент первого подключения.
     *
     * @returns Загруженный модуль mongodb
     * @throws Если пакет не установлен — понятная ошибка с инструкцией по установке
     * @protected
     */
    protected async _loadMongo(): Promise<TMongoModule> {
        if (this.#mongoModule) {
            return this.#mongoModule;
        }
        try {
            this.#mongoModule = await import('mongodb');
            return this.#mongoModule;
        } catch (err) {
            throw new Error(
                'MongoAdapter: пакет "mongodb" не установлен. Он является опциональной ' +
                    'peer-зависимостью umbot. Установите его командой: npm install mongodb. ' +
                    `Исходная ошибка: ${(err as Error).message}`,
                { cause: err },
            );
        }
    }

    /**
     * Метод инициализации плагина.
     * Вызывается один раз при подключении через `bot.use()`.
     * @param appContext Контекст приложения
     */
    init(appContext: AppContext): void {
        if (this._dbOptions) {
            const dbConfig = (appContext.appConfig.db ??= {
                host: '',
                user: '',
                pass: '',
                database: '',
            });
            dbConfig.host = this._dbOptions.host || dbConfig.host;
            dbConfig.database = this._dbOptions.database || dbConfig.database;
            // exactOptionalPropertyTypes: опциональные поля заполняем только
            // реальными значениями, не протаскивая undefined в конфиг.
            const dbUser = this._dbOptions.user || dbConfig.user;
            if (dbUser !== undefined) {
                dbConfig.user = dbUser;
            }
            const dbPass = this._dbOptions.pass || dbConfig.pass;
            if (dbPass !== undefined) {
                dbConfig.pass = dbPass;
            }
            const dbOptions = this._dbOptions.options || dbConfig.options;
            if (dbOptions !== undefined) {
                dbConfig.options = dbOptions;
            }
        }
        super.init(appContext);
    }

    /**
     * Формирует опции подключения к MongoDB из конфига приложения.
     * @param mongo Лениво загруженный модуль mongodb
     * @returns Опции клиента MongoDB
     * @protected
     */
    protected _buildConnectOptions(mongo: TMongoModule): MongoClientOptions {
        const dbConfig = this._appContext.appConfig.db!;
        const options: MongoClientOptions = {
            timeoutMS: 3000,
            serverSelectionTimeoutMS: 2000,
            connectTimeoutMS: 2000,
            socketTimeoutMS: 2000,
            maxPoolSize: 50,
            ...dbConfig.options,
            serverApi: {
                version: mongo.ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
                ...(dbConfig.options?.serverApi as object),
            },
        };

        if (dbConfig.user) {
            const auth: { username: string; password?: string } = {
                username: dbConfig.user,
            };
            // exactOptionalPropertyTypes: без пароля поле не заполняем вовсе.
            if (dbConfig.pass !== undefined) {
                auth.password = dbConfig.pass;
            }
            options.auth = auth;
        }
        return options;
    }

    /**
     * Закрывает предыдущее соединение, если оно было сохранено в databaseInfo.
     * Это предотвращает утечку соединений при повторных вызовах connect().
     * @protected
     */
    protected async _closePreviousClient(): Promise<void> {
        const databaseInfo = this._appContext.database.databaseInfo;
        const oldClient = databaseInfo?.mongoClient;
        if (oldClient) {
            await oldClient.close(true).catch(() => {});
            if (databaseInfo) {
                databaseInfo.mongoClient = null;
                databaseInfo.mongoConnect = null;
            }
        }
    }

    /**
     * Выполняет до двух попыток подключения с проверкой живучести соединения.
     * Каждая попытка создаёт НОВЫЙ клиент — после неудачного connect() MongoClient
     * переходит в состояние "closed" и его нельзя переиспользовать.
     * @param mongo Лениво загруженный модуль mongodb
     * @param options Опции подключения
     * @returns Пара {client, connect} при успехе
     * @throws Последняя ошибка, если все попытки провалились
     * @protected
     */
    protected async _attemptConnect(
        mongo: TMongoModule,
        options: MongoClientOptions,
    ): Promise<{ client: MongoClient; connect: MongoClient }> {
        let lastError: Error | null = null;
        for (let tryNum = 0; tryNum < 2; tryNum++) {
            const client = new mongo.MongoClient(this._appContext.appConfig.db!.host, options);
            try {
                const connected = await client.connect();
                // Проверяем подключение сразу после установки
                if (await this.isConnectedWith(client)) {
                    return { client, connect: connected };
                }
                // Соединение видимо "мёртвое" — пробуем ещё раз
                lastError = new Error('Failed to verify database connection');
                await client.close(true).catch(() => {});
            } catch (e) {
                lastError = e as Error;
                await client.close(true).catch(() => {});
                if (tryNum === 0) {
                    // Небольшая пауза перед повторной попыткой
                    await new Promise((resolve) => {
                        setTimeout(resolve, 2000).unref();
                    });
                }
            }
        }
        throw lastError ?? new Error('Failed to connect to MongoDB');
    }

    /**
     * Подключается к MongoDB.
     *
     * Поведение:
     * - При неудачном connect() или «мёртвом» соединении создаёт новый MongoClient
     *   и выполняет до двух попыток подключения.
     * - Живучесть соединения проверяется ping-командой (`isConnectedWith`).
     * - При ошибке пишет причину в error_log и возвращает `false`.
     *
     * @returns `true` — подключение активно, `false` — ошибка подключения.
     */
    public async connect(): Promise<boolean> {
        if (!this._appContext.appConfig.db) {
            this._saveLog(
                'При подключении в базе данных произошли следующие ошибки: ["Отсутствуют данные для подключения!"]',
            );
            return false;
        }
        try {
            const mongo = await this._loadMongo();
            const options = this._buildConnectOptions(mongo);
            await this._closePreviousClient();
            const { client, connect } = await this._attemptConnect(mongo, options);
            if (this._appContext.database.databaseInfo) {
                this._appContext.database.databaseInfo.mongoClient = client;
                this._appContext.database.databaseInfo.mongoConnect = connect;
            } else {
                this._appContext.database.databaseInfo = {
                    mongoClient: client,
                    mongoConnect: connect,
                };
            }
            return true;
        } catch (err) {
            this._saveLog('При подключении в базе данных произошла ошибка:', err as Error);
            return false;
        }
    }

    /**
     * Проверяет, установлено ли соединение, для конкретного клиента.
     *
     * @param client Клиент, у которого проверяем соединение
     * @returns Promise<boolean> — true, если команда ping выполнена успешно
     */
    protected async isConnectedWith(client: MongoClient): Promise<boolean> {
        try {
            await client.db().command({ ping: 1 });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Операторы MongoDB, разрешённые в условиях выборки (`where`).
     *
     * Это документированный API фреймворка (JSDoc `IQueryData`, dbAdapter.md,
     * external-db-adapter-spec.md: «Рекомендуемый минимум операторов: $gt,
     * $gte, $lt, $lte, $ne, $in»). Разрешаем только операторы сравнения и
     * логики — все они не выполняют код на сервере БД.
     */
    static readonly #SAFE_QUERY_OPERATORS = new Set([
        '$eq',
        '$ne',
        '$gt',
        '$gte',
        '$lt',
        '$lte',
        '$in',
        '$nin',
        '$exists',
        '$type',
        '$all',
        '$size',
        '$not',
        '$or',
        '$and',
        '$nor',
        '$elemMatch',
        '$regex',
        '$options',
        '$mod',
        '$comment',
    ]);

    /**
     * Проверяет объект запроса на опасные для MongoDB конструкции.
     *
     * Опасно для `where`:
     * - операторы, исполняющие JavaScript на сервере БД: `$where`, `$function`,
     *   `$accumulator`, `$expr` (с `$function` внутри), — вычисление выполняется
     *   на сервере, и даже «безобидный» `$where: 'this.a === this.b'` открывает
     *   DoS-поверхность и при определённых настройках — больше;
     * - незнакомые `$`-операторы: список разрешённых конечен, всё остальное
     *   (включая будущие серверные операторы) — reject по умолчанию;
     * - ключи прототипа (`__proto__`, `constructor`, `prototype`) — и в ключах,
     *   и внутри dotted-путей (`'a.__proto__.x'`, `'user.$ne'`);
     * - вложенность глубже 10 уровней — не рискнём считать её безопасной.
     *
     * Для `data` (update/insert) `$`-ключи запрещены полностью: фреймворк сам
     * оборачивает данные в `{$set: ...}`, а Mongo не хранит `$`-поля.
     *
     * Стандартный поток фреймворка передаёт в where скалярный `userId`
     * (объекты размываются `escapeString`), но кастомные модели и
     * пользовательские `where` могут пронести объект-оператор в драйвер.
     *
     * @param obj Проверяемый объект (where/select/update-данные)
     * @param mode `where` — разрешить операторы сравнения; `data` — запретить все `$`
     * @param depth Ограничение глубины рекурсии
     * @returns true, если объект безопасен
     */
    #isSafeMongoQuery(obj: unknown, mode: 'where' | 'data', depth = 0): boolean {
        if (obj === null || typeof obj !== 'object') {
            return true;
        }
        if (depth > 10) {
            this.#logRejectedQuery('слишком глубокая вложенность (>10)');
            return false;
        }
        if (Array.isArray(obj)) {
            return obj.every((item) => this.#isSafeMongoQuery(item, mode, depth + 1));
        }
        for (const key of Object.keys(obj)) {
            const isPrototypeKey =
                key === '__proto__' ||
                key === 'constructor' ||
                key === 'prototype' ||
                /(?:^|\.)(?:__proto__|constructor|prototype)(?:\.|$)/.test(key);
            if (isPrototypeKey) {
                this.#logRejectedQuery(`ключ "${key}" (прототип)`);
                return false;
            }
            if (key.startsWith('$')) {
                if (mode === 'data') {
                    this.#logRejectedQuery(`ключ "${key}" в данных записи`);
                    return false;
                }
                if (!MongoAdapter.#SAFE_QUERY_OPERATORS.has(key)) {
                    // $where/$function/$accumulator/$expr и всё незнакомое:
                    // либо исполнение кода на сервере, либо неизвестный оператор
                    this.#logRejectedQuery(`оператор "${key}" вне разрешённого списка`);
                    return false;
                }
            }
            if (!this.#isSafeMongoQuery((obj as Record<string, unknown>)[key], mode, depth + 1)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Логирует отклонённый запрос без раскрытия самих данных запроса.
     */
    #logRejectedQuery(reason: string): void {
        this._appContext?.logError(
            `MongoAdapter: запрос отклонён — ${reason}. ` +
                'Документированные операторы сравнения ($gt, $in, $ne и др.) разрешены; ' +
                'исполняемые на сервере ($where, $function) и ключи прототипа — нет.',
        );
    }

    /**
     * Выполняет UPDATE-запрос.
     * @param updateData Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     * @returns true при успешном обновлении, иначе false (нет данных/первичного ключа, запрещённый запрос, ошибка драйвера)
     */
    public async _update(updateData: IQuery): Promise<boolean> {
        let update = updateData.data;
        let select = updateData.query;
        if (this._appContext.database.databaseInfo) {
            update = this.validate(updateData, update);
            select = this.validate(updateData, select);
            // Драйвер не отклоняет $-операторы сам: $set с инъекцией 'a.b' расползается
            // по вложенным путям, а $ne в where разворачивает фильтр. Отказ до запроса.
            if (
                !this.#isSafeMongoQuery(select, 'where') ||
                !this.#isSafeMongoQuery(update, 'data')
            ) {
                return false;
            }
            // Удаляем ключи со значением undefined — иначе Mongo запишет BSON-undefined и затирает поле.
            if (update && typeof update === 'object') {
                update = Object.fromEntries(
                    Object.entries(update as Record<string, unknown>).filter(
                        ([, v]) => v !== undefined,
                    ),
                ) as IQueryData;
            }
            if (updateData.primaryKeyName) {
                return !!(await this.query(async (_client, db: Db) => {
                    try {
                        const collection = db.collection(updateData.tableName);
                        const result = await collection.updateOne(select as Filter<Document>, {
                            $set: update as Document,
                        });
                        return {
                            status: true,
                            data: { modifiedCount: result.modifiedCount },
                        };
                    } catch (err) {
                        return {
                            status: false,
                            error: err as Error,
                        };
                    }
                }));
            }
        }
        return false;
    }

    /**
     * Выполняет INSERT-запрос.
     * @param insertData Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     * @returns true при успешной вставке, иначе false (нет данных/первичного ключа, запрещённый запрос, ошибка драйвера)
     */
    public async _insert(insertData: IQuery): Promise<boolean> {
        let insert = insertData.data;
        if (this._appContext.database.databaseInfo) {
            insert = this.validate(insertData, insert);
            // $-ключи и ключи прототипа — защита от NoSQL-инъекции в драйвер
            if (!this.#isSafeMongoQuery(insert, 'data')) {
                return false;
            }
            if (insertData.primaryKeyName) {
                return !!(await this.query(async (_client, db: Db) => {
                    try {
                        const collection = db.collection(insertData.tableName);
                        const result = await collection.insertOne(insert as OptionalId<Document>);
                        return {
                            status: true,
                            data: { insertedId: result.insertedId },
                        };
                    } catch (err) {
                        return {
                            status: false,
                            error: err instanceof Error ? err : 'Unknown error',
                        };
                    }
                }));
            }
        }
        return false;
    }

    /**
     * Выполняет DELETE-запрос.
     * @param removeData Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     * @returns true при успешном удалении, иначе false (нет данных, запрещённый запрос, ошибка драйвера)
     */
    public async _remove(removeData: IQuery): Promise<boolean> {
        let remove = removeData.query;
        if (this._appContext.database.databaseInfo) {
            remove = this.validate(removeData, remove);
            // Запрещённые операторы в фильтре ($where и т.п.) — отвергаем до драйвера
            if (!this.#isSafeMongoQuery(remove, 'where')) {
                return false;
            }
            return !!(await this.query(async (_client: MongoClient, db: Db) => {
                try {
                    const collection = db.collection(removeData.tableName);
                    const result = await collection.deleteOne(remove as Filter<Document>);
                    return {
                        status: true,
                        data: { deletedCount: result.deletedCount },
                    };
                } catch (err) {
                    return {
                        status: false,
                        error: err instanceof Error ? err : 'Unknown error',
                    };
                }
            }));
        }
        return false;
    }

    /**
     * Выполняет произвольный запрос через callback.
     *
     * @param callback функция обработчик
     */
    public async _query(callback: TQueryCb<MongoClient, Db>): Promise<unknown | null> {
        const vDB = this._appContext.database.databaseInfo;
        try {
            if (vDB?.mongoConnect) {
                const client = vDB.mongoConnect;
                const db = client.db(this._appContext.appConfig.db?.database);
                const data: IModelRes | boolean = await callback(client, db);
                if (data.status) {
                    return data.data;
                }
                this._saveLog(data.error + '');
                return null;
            } else {
                this._saveLog('Не удалось выполнить запрос.');
                return null;
            }
        } catch (err) {
            // Не-Error исключение приводим к строке явно, чтобы в логе была
            // причина, а не "[object Object]".
            this._saveLog(
                err instanceof Error ? err.message : String(err),
                err instanceof Error ? err : undefined,
            );
            return null;
        }
    }

    /**
     * Выполняет произвольный запрос через callback.
     *
     * Выполняет this._query напрямую. Метрики времени выполнения не записываются (в отличие от select/insert/update/remove).
     * @param callback функция обработчик
     */
    public async query(callback: TQueryCb<MongoClient, Db>): Promise<unknown | IModelRes> {
        return this._query(callback);
    }

    /**
     * Валидация запросов.
     * Правила валидации (query.rules) применяются к element — метод мутирует
     * и возвращает его. При element === null возвращается {}.
     * @param query - Запрос: источник правил валидации (query.rules)
     * @param element - Валидируемый элемент данных
     * @returns Валидированный элемент; при element === null — {}
     */
    public validate(query: IQuery, element: IQueryData | null): IQueryData {
        if (!element) {
            return {};
        }
        const rules = query.rules;
        if (rules) {
            rules.forEach((rule) => {
                let type = 'number';
                switch (rule.type) {
                    case 'string':
                    case 'text':
                        type = 'string';
                        break;
                    case 'int':
                    case 'integer':
                    case 'bool':
                        type = 'number';
                        break;
                }
                rule.name.forEach((data) => {
                    if (element[data] === undefined || element[data] === null) {
                        return;
                    }
                    if (type === 'string') {
                        if (rule.max !== undefined) {
                            element[data] = Text.resize(element[data] as string, rule.max);
                        }
                        element[data] = this.escapeString(element[data] as string);
                    } else {
                        element[data] = +(element[data] as number);
                    }
                });
            });
        }
        return element;
    }

    /**
     * Выполняет SELECT-запрос.
     * @param selectData Дополнительная информация для запроса. Содержит информацию о таблице и структуре.
     * @param where Сам запрос
     * @param isOne Определяет нужно ли вернуть только 1 найденную запись, либо отдать все доступные данные.
     * @returns Promise<IModelRes> — `{ status: true, data }` при успехе; `{ status: false }`, если запись
     *   не найдена; `{ status: false, error }` при ошибке или запрещённом запросе
     */
    public async _select(
        selectData: IQuery,
        where: IQueryData | null,
        isOne: boolean = false,
    ): Promise<IModelRes> {
        if (this._appContext.database.databaseInfo) {
            // В _select validate() не применяется вовсе — where идёт в драйвер
            // как есть. Объект-оператор ($ne) или ключ прототипа в условии
            // выборки разворачивал фильтр: защита до обращения к коллекции.
            if (where && !this.#isSafeMongoQuery(where, 'where')) {
                return {
                    status: false,
                    error: 'Запрос содержит запрещённые ключи (NoSQL-инъекция)',
                };
            }
            // Не через query(): он возвращает сам результат драйвера, а не IModelRes,
            // и найденная запись не отличалась бы от «не найдено».
            const client = this._appContext.database.databaseInfo.mongoConnect;
            if (!client) {
                this._saveLog('Не удалось выполнить запрос.');
                return { status: false, error: 'Нет подключения к базе данных' };
            }
            try {
                const collection = client
                    .db(this._appContext.appConfig.db?.database)
                    .collection(selectData.tableName);
                const filter = (where as Filter<Document>) || {};
                const results = isOne
                    ? await collection.findOne(filter)
                    : await collection.find(filter).toArray();
                // findOne без совпадения возвращает null: это «не найдено», а не ошибка.
                if (results === null) {
                    return { status: false };
                }
                return { status: true, data: results as NonNullable<IModelRes['data']> };
            } catch (err) {
                this._saveLog(
                    err instanceof Error ? err.message : String(err),
                    err instanceof Error ? err : undefined,
                );
                return { status: false, error: err instanceof Error ? err : String(err) };
            }
        }
        return {
            status: false,
            error: 'Не удалось получить данные',
        };
    }

    /**
     * Проверяет, установлено ли соединение с БД.
     */
    public async isConnected(): Promise<boolean> {
        if (!this._appContext.database.databaseInfo) {
            return false;
        }
        try {
            if (!this._appContext.database.databaseInfo.mongoClient) {
                return false;
            }
            // Пингуем базу данных для проверки подключения
            await this._appContext.database.databaseInfo.mongoClient.db().command({ ping: 1 });
            return true;
        } catch (err) {
            this._appContext.logError((err as Error).message, {
                error: err,
            });
            return false;
        }
    }

    /**
     * Сохранение логов
     * @param errorMsg Текст ошибки
     * @param error Объект ошибки (опционально)
     * @protected
     */
    protected _saveLog(errorMsg: string, error?: Error): void {
        this._appContext?.logError(`MongoDB: ${errorMsg}`, {
            error,
        });
    }

    /**
     * Создаёт индексы для встроенных таблиц: без них поиск пользователя и токенов
     * медиа идёт полным перебором коллекции и замедляется с ростом базы.
     * Коллекции MongoDB создаёт сама при первой записи, поэтому здесь — только индексы.
     *
     * Индексы не уникальные: в данных прежних версий могут быть дубли (параллельные
     * первые запросы одного пользователя), и уникальный индекс на них не создался бы.
     * Создание существующего индекса — no-op. Если у пользователя БД нет прав на
     * создание индексов, адаптер пишет предупреждение и продолжает работу.
     *
     * @param tables Описание встроенных таблиц (`DB_TABLES_SCHEMA`)
     * @returns true, если все индексы есть; false, если какой-то создать не удалось
     *
     * @example
     * ```ts
     * // Вызывается фреймворком автоматически после connect(); вручную — например, в миграции:
     * await mongoAdapter.ensureSchema(DB_TABLES_SCHEMA);
     * ```
     */
    public async ensureSchema(tables: readonly IDbTableSchema[]): Promise<boolean> {
        const client = this._appContext.database.databaseInfo?.mongoConnect;
        if (!client) {
            return false;
        }
        const db = client.db(this._appContext.appConfig.db?.database);
        let ok = true;
        for (const table of tables) {
            for (const fields of table.indexes) {
                const name = `umbot_${fields.join('_')}`;
                try {
                    await db
                        .collection(table.tableName)
                        .createIndex(Object.fromEntries(fields.map((field) => [field, 1])), {
                            name,
                        });
                } catch (err) {
                    ok = false;
                    this._appContext.logWarn(
                        `MongoAdapter: не удалось создать индекс "${name}" для "${table.tableName}" — ` +
                            'поиск будет работать без него, медленнее. Проверьте права пользователя БД ' +
                            `(createIndex). Текст ошибки: ${(err as Error).message}`,
                    );
                }
            }
        }
        return ok;
    }

    /**
     * Закрывает все подключения к БД.
     * Все процессы завершаются; Mongo при закрытии ничего не сохраняет (в отличие от FileAdapter).
     */
    public async destroy(): Promise<void> {
        return this.close('');
    }

    /**
     * Закрывает подключение к определенной таблице.
     * В MongoDB нет концепции "закрытия таблицы". Метод close() закрывает всё соединение с базой.
     * @param tableName - Имя таблицы
     */
    public async close(tableName: string): Promise<void> {
        await super.close(tableName);
        const dbInfo = this._appContext.database.databaseInfo;
        if (dbInfo?.mongoClient) {
            try {
                await dbInfo.mongoClient.close();
                dbInfo.mongoConnect = null;
                dbInfo.mongoClient = null;
            } catch (err) {
                this._appContext.logError((err as Error).message, {
                    error: err,
                });
            }
        }
    }
}
