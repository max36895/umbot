import {
    AppContext,
    EMetric,
    IAppDB,
    IDatabaseAdapter,
    IDatabaseInfo,
    IDbResult,
    IModelRes,
    TQueryCb,
    IQueryData,
    IQuery,
    isPromise,
    IDbTableSchema,
} from '../../../index';
import { BasePlugin } from '../../Base';

/**
 * Базовый класс для создания адаптеров баз данных.
 * При наследовании вы ОБЯЗАНЫ реализовать следующие методы:
 *   - _select - Получение данных
 *   - _insert - Добавление данных
 *   - _update - Обновление данных
 *   - _remove - Удаление данных
 *   - isConnected - Проверяет, установлено ли подключение к базе или нет
 *
 * Эти методы вызываются внутренней логикой фреймворка и определяют, как именно выполняются операции с вашей БД.
 *
 * Рекомендуется наследоваться от этого класса при создании собственного адаптера, так как он уже реализует общую логику: интеграцию с контекстом приложения, сбор метрик, управление соединениями.
 *
 * Если по техническим причинам наследование невозможно — ваш класс должен в точности реализовывать интерфейс `IDatabaseAdapter`
 *
 * Важно: в приложении может быть активен только один адаптер БД.
 *
 * @group Свой адаптер
 */
export abstract class Base<TDbInfo extends IDatabaseInfo = IDatabaseInfo>
    extends BasePlugin
    implements IDatabaseAdapter
{
    /**
     * Формат базы данных
     */
    dbFormat: string;
    /**
     * Контекст приложения
     * @protected
     */
    protected _appContext: AppContext<TDbInfo> = new AppContext(); // Для подстраховки, на случай если кто-то забудет прокинуть
    /**
     * Дополнительные опции для работы базы данных
     */
    protected _dbOptions?: IAppDB;

    /**
     * Конструктор для адаптера базы данных
     * @param options Дополнительные опции для настройки БД.
     * Тут можно передать настройки для подключения к базе, либо дополнительную информацию, необходимую для работы.
     */
    constructor(options?: IAppDB) {
        super();
        this.dbFormat = 'unknown';
        // exactOptionalPropertyTypes: поле не заполняем, если опций нет.
        if (options !== undefined) {
            this._dbOptions = options;
        }
    }

    /**
     * Метод инициализации адаптера.
     * Вызывается один раз при подключении через `bot.use()`.
     * В данном методе можно произвести дополнительную настройку для подключения к базе
     * @param appContext Контекст приложения
     */
    init(appContext: AppContext<unknown>): void {
        this._appContext = appContext as AppContext<TDbInfo>;
        if (appContext.database.adapter) {
            appContext.database.adapter.destroy()?.catch((e) => {
                appContext.logError(
                    `Произошла ошибка при уничтожении предыдущего адаптера! Текст ошибки: ${e.message}`,
                    {
                        error: e,
                    },
                );
            });
        }
        appContext.database = {
            adapter: this,
            databaseInfo: {} as TDbInfo,
        };
    }

    /**
     * Устанавливает подключение к базе данных.
     * В случае успешного подключения возвращается true
     */
    connect(): Promise<boolean> | boolean {
        return true;
    }

    /**
     * Подготавливает хранилище под встроенные таблицы umbot (см. `DB_TABLES_SCHEMA`).
     * Фреймворк вызывает метод после каждого успешного `connect()`, до первого запроса.
     *
     * Базовая реализация ничего не делает — так работают хранилища без схемы.
     * Переопределите метод, если базе нужны таблицы или индексы: создайте
     * недостающее («CREATE TABLE IF NOT EXISTS», createIndex) — повторный вызов
     * не должен ничего ломать.
     *
     * @param _tables Описание встроенных таблиц
     * @returns true, если схема готова; false — фреймворк запишет ошибку в лог
     *   и продолжит работу
     *
     * @example
     * ```ts
     * class PgAdapter extends BaseDbAdapter {
     *     async ensureSchema(tables: readonly IDbTableSchema[]): Promise<boolean> {
     *         for (const table of tables) {
     *             await this.#pool.query(`CREATE TABLE IF NOT EXISTS "${table.tableName}" (...)`);
     *         }
     *         return true;
     *     }
     * }
     * ```
     */
    public ensureSchema(_tables: readonly IDbTableSchema[]): boolean | Promise<boolean> {
        return true;
    }

    /**
     * Удобный метод для извлечения данных из результата запроса.
     * Проверяет `res.status` и возвращает `res.data` только при успехе.
     *
     * Используется в моделях и контроллерах для безопасного доступа к данным.
     * @param res Результат запроса (IModelRes)
     * @returns Данные из res.data при status = true, иначе null
     */
    public getValue(res: IModelRes<IDbResult>): IDbResult | null {
        if (res?.status) {
            return res.data as IDbResult;
        }
        return null;
    }

    /**
     * Выполняет SELECT-запрос.
     *
     * Этот метод вызывается внутренней логикой фреймворка для получения данных.
     * Вы обязаны вернуть объект, совместимый с `IModelRes<IDbResult>`, где:
     * - `status: true` и `data` — при успешной выборке (даже если найдено 0 записей);
     * - `status: false` и опционально `error` — при ошибке подключения, синтаксиса и т.п.
     *
     * ⚠️ Не выбрасывайте исключения — обрабатывайте ошибки внутри и возвращайте `status: false`.
     * Метод может быть синхронным или асинхронным.
     *
     * Пример возвращаемого значения при успехе:
     * ```ts
     * { status: true, data: [{ id: 1, name: 'Alice' }] }
     * ```
     *
     * Пример при ошибке:
     * ```ts
     * { status: false, error: 'Connection timeout' }
     * ```
     *
     * @param selectData Дополнительная информация для запроса. Содержит информацию о таблице и структуре.
     * @param where Сам запрос
     * @param isOne Определяет нужно ли вернуть только 1 найденную запись, либо отдать все доступные данные.
     * @returns IModelRes | Promise<IModelRes> — результат SELECT-запроса
     */
    public abstract _select(
        selectData: IQuery,
        where: IQueryData | null,
        isOne: boolean,
    ): IModelRes | Promise<IModelRes>;

    /**
     * Выполняет INSERT-запрос.
     *
     * Этот метод вызывается внутренней логикой фреймворка для добавления данных.
     * Вы обязаны вернуть:
     *   - `true` — если запись успешно добавлена,
     *   - `false` — при любой ошибке (подключение, валидация и т.п.).
     *
     * ⚠️ Не выбрасывайте исключения — обрабатывайте ошибки внутри и возвращайте `false`.
     * Метод может быть синхронным или асинхронным.
     *
     * @param insertData Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     * @returns boolean | Promise<boolean> — true при успешной вставке, иначе false
     */
    public abstract _insert(insertData: IQuery): boolean | Promise<boolean>;

    /**
     * Выполняет UPDATE-запрос.
     *
     * Этот метод вызывается внутренней логикой фреймворка для обновления данных.
     * Вы обязаны вернуть:
     *   - `true` — если операция выполнена без ошибок (включая случай, когда под условие не попало записей),
     *   - `false` — при любой ошибке (подключение, валидация и т.п.).
     *
     * ⚠️ Не выбрасывайте исключения — обрабатывайте ошибки внутри и возвращайте `false`.
     * Метод может быть синхронным или асинхронным.
     *
     * @param updateData Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     * @returns boolean | Promise<boolean> — true при успешном обновлении, иначе false
     */
    public abstract _update(updateData: IQuery): boolean | Promise<boolean>;

    /**
     * Выполняет DELETE-запрос.
     *
     * Этот метод вызывается внутренней логикой фреймворка для удаления данных.
     * Вы обязаны вернуть:
     *   - `true` — если операция выполнена без ошибок (включая случай, когда под условие не попало записей),
     *   - `false` — при любой ошибке (подключение, валидация и т.п.).
     *
     * ⚠️ Не выбрасывайте исключения — обрабатывайте ошибки внутри и возвращайте `false`.
     * Метод может быть синхронным или асинхронным.
     *
     * @param removeData Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     * @returns boolean | Promise<boolean> — true при успешном удалении, иначе false
     */
    public abstract _remove(removeData: IQuery): boolean | Promise<boolean>;

    /**
     * Выполняет произвольный запрос через callback.
     * Если вы планируете использовать `query()`, обязательно переопределите `_query`. По умолчанию он возвращает null и не выполняет никаких действий.
     *
     * @param _callback функция обработчик
     */
    public _query(_callback: TQueryCb): Promise<unknown> | unknown {
        return null;
    }

    /**
     * Выполняет SELECT-запрос.
     *
     * Внутри себя вызывает this._select, основное отличие в том, что в данном методе пишутся метрики.
     * @param selectData Дополнительная информация для запроса. Содержит информацию о таблице и структуре.
     * @param where Сам запрос
     * @param isOne Определяет нужно ли вернуть только 1 найденную запись, либо отдать все доступные данные.
     * @returns Результат SELECT-запроса (IModelRes)
     */
    public async select(
        selectData: IQuery,
        where: IQueryData | null,
        isOne: boolean,
    ): Promise<IModelRes> {
        if (!this._appContext?.usedMetric) {
            return this._select(selectData, where, isOne);
        }

        const start = performance.now();
        let res = this._select(selectData, where, isOne);
        if (isPromise(res)) {
            res = await res;
        }
        this._appContext?.logMetric(EMetric.DB_SELECT, performance.now() - start, {
            tableName: selectData.tableName,
        });
        return res;
    }

    /**
     * Выполняет INSERT-запрос.
     *
     * Внутри себя вызывает this._insert, основное отличие в том, что в данном методе пишутся метрики.
     * @param insertData Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     * @returns true при успешной вставке, иначе false
     */
    public async insert(insertData: IQuery): Promise<boolean> {
        if (!this._appContext?.usedMetric) {
            return this._insert(insertData);
        }
        const start = performance.now();
        let res = this._insert(insertData);
        if (isPromise(res)) {
            res = await res;
        }
        this._appContext?.logMetric(EMetric.DB_INSERT, performance.now() - start, {
            tableName: insertData.tableName,
        });
        return res;
    }

    /**
     * Выполняет UPDATE-запрос.
     *
     * Внутри себя вызывает this._update, основное отличие в том, что в данном методе пишутся метрики.
     * @param updateData Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     * @returns true при успешном обновлении, иначе false
     */
    public async update(updateData: IQuery): Promise<boolean> {
        if (!this._appContext?.usedMetric) {
            return this._update(updateData);
        }
        const start = performance.now();
        let res = this._update(updateData);
        if (isPromise(res)) {
            res = await res;
        }
        this._appContext?.logMetric(EMetric.DB_UPDATE, performance.now() - start, {
            tableName: updateData.tableName,
        });
        return res;
    }

    /**
     * Выполняет DELETE-запрос.
     *
     * Внутри себя вызывает this._remove, основное отличие в том, что в данном методе пишутся метрики.
     * @param removeData Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     * @returns true при успешном удалении, иначе false
     */
    public async remove(removeData: IQuery): Promise<boolean> {
        if (!this._appContext?.usedMetric) {
            return this._remove(removeData);
        }
        const start = performance.now();
        let res = this._remove(removeData);
        if (isPromise(res)) {
            res = await res;
        }
        this._appContext?.logMetric(EMetric.DB_REMOVE, performance.now() - start, {
            tableName: removeData.tableName,
        });
        return res;
    }

    /**
     * Выполняет произвольный запрос через callback.
     *
     * Внутри себя вызывает this._query. Метрики времени выполнения не записываются
     * (в отличие от select/insert/update/remove).
     * @param callback функция обработчик
     */
    public query(callback: TQueryCb): Promise<unknown> | unknown {
        return this._query(callback);
    }

    /**
     * Сохраняет запись: вставляет новую или обновляет существующую.
     * Логика:
     * - Если `isNew === true` → перед insert ключи условия мержатся в данные
     *   (saveData.data = {...data, ...query}) и вызывается `insert`
     * - Иначе → сначала делается `selectOne` по `saveData.query`,
     *   и если запись найдена — вызывается `update`, иначе — `insert`
     *   (тоже с мерджем ключей условия в данные)
     *
     * @param saveData Данные для запроса. Включает как запрос, так и сами данные
     * @param isNew Флаг, говорящий о том, что точно происходит добавление новой записи
     * @returns true при успешном сохранении, иначе false
     */
    public async save(saveData: IQuery, isNew: boolean): Promise<boolean> {
        if (isNew) {
            saveData.data = { ...saveData.data, ...saveData.query };
            return await this.insert(saveData);
        }
        const select = await this.selectOne(saveData, saveData.query);
        if (select?.status) {
            return await this.update(saveData);
        } else {
            saveData.data = { ...saveData.data, ...saveData.query };
            return await this.insert(saveData);
        }
    }

    /**
     * Выполняет SELECT с ограничением до одной записи.
     * @param selectData Дополнительные данные для запроса
     * @param where Сам запрос (условие выборки). При `null` или `undefined` вернётся `null`
     * @returns IModelRes с результатом выборки (одна запись — в data), либо `null`, если условие не передано. При отсутствии записей возвращается `{ status: false }`.
     */
    public async selectOne(
        selectData: IQuery,
        where: IQueryData | null,
    ): Promise<IModelRes | null> {
        if (where) {
            return this.select(selectData, where, true);
        }
        return null;
    }

    /**
     * Экранирует строку для безопасного использования в запросах.
     *
     * ⚠️ По умолчанию просто приводит значение к строке.
     * Если ваша БД требует экранирования (например, SQL), обязательно переопределите этот метод.
     * @param str Экранируемая строка
     * @returns Экранированная строка
     */
    public escapeString(str: string | number): string {
        return str + '';
    }

    /**
     * Проверяет, установлено ли соединение с БД.
     */
    public abstract isConnected(): Promise<boolean> | boolean;

    /**
     * Вызывается при завершении работы приложения или замене адаптера.
     * Используйте для закрытия соединений, сохранения данных и т.п.
     */
    public destroy(): void | Promise<void> {
        // Базовая реализация пуста — переопределяется в наследниках для закрытия соединений
    }

    /**
     * Вызывается из destroy() при завершении работы приложения или замене адаптера
     * (FileAdapter закрывает им каждую таблицу). Может использоваться для
     * освобождения ресурсов, связанных с таблицей.
     * @param _tableName Название таблицы, подключение к которой закрывается
     */
    public close(_tableName: string): void | Promise<void> {
        // Базовая реализация пуста — переопределяется в наследниках для освобождения ресурсов
    }
}
