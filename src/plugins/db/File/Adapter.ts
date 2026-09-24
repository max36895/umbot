import { Base } from '../Base/Base';
import {
    AppContext,
    IQueryData,
    IQuery,
    IModelRes,
    IDatabaseInfo,
    getFileInfoSync,
    freadSync,
    keysCount,
    isPromise,
} from '../../../index';

/**
 * Тип для данных, которые хранятся в файловой базе данных
 */
export type TFileData = Record<string, Record<string, unknown>>;

/**
 * Интерфейс для хранения информации о файле
 *
 * @interface IDBFileInfo
 */
export interface IDBFileInfo {
    /**
     * Содержимое файла в виде строки
     */
    data?: TFileData;

    /**
     * Версия файла.
     * Используется время последнего изменения файла в миллисекундах
     */
    version: number;
    /**
     * Идентификатор тайм-аута для отложенного (lazy) сохранения (срабатывает не чаще 1 раза в 500 мс)
     */
    timeOutId?: ReturnType<typeof setTimeout> | null;
    /**
     * Идентификатор тайм-аута для принудительного (force) сохранения (не реже 1 раза в 3 минуты).
     * Необходим для случаев, когда идет постоянная нагрузка на сервер, и нет возможности сохранить информацию в файл.
     */
    forceTimeOutId?: ReturnType<typeof setTimeout> | null;
    /**
     * Определяет было ли произведено чтение файла или нет
     */
    isFileRead: boolean;
}

/**
 * Интерфейс для хранения всех данных из файловой базы данных
 */
export interface IFileDbInfo extends IDatabaseInfo {
    [tableName: string]: IDBFileInfo | undefined;
}

/**
 * Тип для кэширования данных из файлов
 * Ключ - путь к файлу, значение - информация о файле
 */
export type IDBFileData = { [key: string]: IDBFileInfo | undefined };

// Сохраняем данные не чаще 1 раза в 500мс
const LAZY_DELAY_SAVE_TIME = 500;
// Принудительно сохраняем данные каждые 3 минуты. Актуально для случаев, когда идет постоянная нагрузка на сервер.
const FORCE_DELAY_SAVE_TIME = 60 * 1000 * 3;
// Порог детекции внешних изменений файла (multi-process доступ): перекрывает
// гранулярность mtime файловой системы и запись «своих» таблиц в момент
// инициализации приложения — без него warn ложно срабатывал на файлы,
// созданные за секунды до запуска адаптера.
const EXTERNAL_CHANGE_GRACE_MS = 5000;

/**
 * Адаптер для файловой базы данных.
 * Стоит использовать только для быстрого старта, либо для приложений, у которых объем базы не будет превышать несколько сотен мегабайт.
 */
export class FileAdapter extends Base<IFileDbInfo> {
    /**
     * Формат базы данных
     */
    dbFormat: string = 'file';
    /**
     * Для локального сохранения, на случай если AppContext не доступен
     * @private
     */
    #cachedFileData: IDBFileData = {};

    /**
     * Незавершённые (in-flight) записи по таблицам.
     *
     * `#update()` пишет файл на диск асинхронно (fire-and-forget), и `close()`
     * должен дождаться выполняемых записей — иначе graceful shutdown убьёт
     * процесс раньше, и последние изменения потеряются.
     * Ключ — имя таблицы, значение — промис выполняемой записи.
     * @private
     */
    #inFlightSaves = new Map<string, Promise<boolean>>();

    /**
     * Время старта адаптера (init). Используется для детекции внешних изменений
     * json-файлов: mtime новее этого значения при первом чтении таблицы означает,
     * что файл пишет другой процесс (см. getFileData). 0 — init ещё не вызван.
     * @private
     */
    #adapterStartedAtMs = 0;

    constructor() {
        super();
    }

    /**
     * Инициализация адаптера: запоминает время старта для детекции
     * многопроцессного доступа к одним и тем же файлам БД.
     * @param appContext Контекст приложения
     */
    init(appContext: AppContext): void {
        this.#adapterStartedAtMs = Date.now();
        super.init(appContext);
    }

    /**
     * Подключение к файловой БД с side-effect: предзагрузка таблиц
     * UsersData/SoundTokens/ImageTokens (override), чтобы избежать
     * одновременного чтения одного файла под нагрузкой.
     * @returns true — файловая БД всегда доступна
     */
    connect(): Promise<boolean> | boolean {
        // Предварительная загрузка данных из файлов при подключении,
        // чтобы избежать одновременного чтения одного файла под нагрузкой
        this.getFileData('UsersData');
        this.getFileData('SoundTokens');
        this.getFileData('ImageTokens');
        return true;
    }

    /**
     * Сохранение данных в кэш (в памяти)
     * @param tableName Имя таблицы
     * @param data Сохраняемые данные
     */
    setCachedFileData(tableName: string, data: IDBFileInfo | undefined): void {
        if (this._appContext.database.databaseInfo) {
            if (data === undefined) {
                this._appContext.database.databaseInfo[tableName] = undefined;
            } else {
                const timeOutId = this._appContext.database.databaseInfo[tableName]?.timeOutId;
                this._appContext.database.databaseInfo[tableName] = data;
                // Из-за асинхронности data может не содержать timeOutId, хотя он уже
                // установлен предыдущим вызовом #update(): перезапись затерла бы
                // идентификатор таймера, и lazy-сохранение перестало бы сбрасываться
                // (утечка отложенных таймеров). Восстанавливаем его поверх новых данных.
                if (data.timeOutId === undefined && timeOutId !== undefined) {
                    this._appContext.database.databaseInfo[tableName].timeOutId = timeOutId;
                }
            }
        } else if (data === undefined) {
            this.#cachedFileData[tableName] = undefined;
        } else {
            this.#cachedFileData[tableName] = data;
        }
    }

    /**
     * Получение данных из кэша (в памяти)
     * @param tableName Имя таблицы
     */
    getCachedFileData(tableName: string): IDBFileInfo {
        if (this._appContext?.database.databaseInfo) {
            if (!this._appContext.database.databaseInfo[tableName]) {
                this._appContext.database.databaseInfo[tableName] = {
                    version: 0,
                    data: {},
                    isFileRead: false,
                };
            }
            return this._appContext.database.databaseInfo[tableName];
        }
        this.#cachedFileData ??= {};
        return this.#cachedFileData[tableName] as IDBFileInfo;
    }

    /**
     * Сохраняет значение поля в кэш таблицы (в памяти)
     * @param tableName Имя таблицы
     * @param field Поле, в которое происходит сохранение
     * @param data Данные для сохранения
     * @private
     */
    #setCachedFileData<T extends keyof IDBFileInfo = keyof IDBFileInfo>(
        tableName: string,
        field: T,
        data: IDBFileInfo[T],
    ): void {
        const cachedData = this.getCachedFileData(tableName);
        cachedData[field] = data;
        this.setCachedFileData(tableName, cachedData);
    }

    #isForbiddenKey(key: string): boolean {
        const forbidden = ['__proto__', 'constructor', 'prototype'];
        return forbidden.includes(key);
    }

    /**
     * Поля составного ключа запроса (без самого первичного ключа).
     */
    #getUniqueKeys(query: IQuery): string[] {
        return (query.uniqueKeys ?? []).filter((key) => key !== query.primaryKeyName);
    }

    /**
     * Ключ строки в JSON-файле. Без uniqueKeys — значение первичного ключа
     * (формат прежних версий). С uniqueKeys — значения полей составного ключа
     * и первичного ключа через «:», например `telegram:42` для UsersData.
     * @returns Ключ строки или null, если значения первичного ключа нет
     */
    #getStorageKey(query: IQuery, values: IQueryData | null): string | null {
        const idVal = values?.[query.primaryKeyName as string];
        if (idVal === undefined || idVal === null || idVal === '') {
            return null;
        }
        const uniqueKeys = this.#getUniqueKeys(query);
        if (!uniqueKeys.length) {
            return String(idVal);
        }
        const parts: string[] = [];
        for (const key of uniqueKeys) {
            const value = values?.[key];
            if (value === undefined || value === null) {
                // Без значения составного поля ключ однозначно не построить —
                // работаем по первичному ключу, как в прежних версиях.
                return String(idVal);
            }
            parts.push(String(value));
        }
        parts.push(String(idVal));
        return parts.join(':');
    }

    /**
     * Находит ключ существующей строки. Строки, записанные до появления
     * составного ключа, лежат под значением первичного ключа (`42`): если такая
     * строка принадлежит той же записи (совпадают поля составного ключа), она
     * переносится под новый ключ (`telegram:42`) — данные пользователей
     * сохраняются при обновлении без ручной миграции.
     * @returns Ключ строки или null, если запись не найдена
     */
    #resolveRowKey(query: IQuery, values: IQueryData | null, data: TFileData): string | null {
        const key = this.#getStorageKey(query, values);
        if (key === null || this.#isForbiddenKey(key)) {
            return null;
        }
        if (Object.hasOwn(data, key)) {
            return key;
        }
        const uniqueKeys = this.#getUniqueKeys(query);
        const legacyKey = String(values?.[query.primaryKeyName as string]);
        if (!uniqueKeys.length || legacyKey === key || !Object.hasOwn(data, legacyKey)) {
            return null;
        }
        const legacyRow = data[legacyKey];
        if (!legacyRow || uniqueKeys.some((field) => legacyRow[field] !== values?.[field])) {
            // Строка принадлежит другой записи (другой платформе) — это не наша запись.
            return null;
        }
        data[key] = legacyRow;
        delete data[legacyKey];
        this.#update(query.tableName);
        return key;
    }

    /**
     * Сохраняет данные
     * @param tableName Название таблицы
     * @param force Флаг принудительного сохранения
     * @private
     */
    #update(tableName: string, force: boolean = false): void {
        // data не нужен, так как все данные редактируются в объекте по ссылке
        const cb = (): void => {
            const data = this.getCachedFileData(tableName).data;
            if (data) {
                // close()/destroy() дожидаются этих промисов, чтобы процесс
                // не завершился посреди записи.
                const savePromise = this._appContext
                    ?.saveFileData(`${tableName}.json`, data)
                    .catch((e: Error) => {
                        this._appContext?.logError(
                            `Произошла ошибка при записи в файл: ${e.message}`,
                            { error: e },
                        );
                        return false;
                    })
                    .finally(() => {
                        // Убираем из реестра только если это всё ещё наша запись:
                        // за время полёта могла начаться новая (Map-перезапись).
                        if (this.#inFlightSaves.get(tableName) === savePromise) {
                            this.#inFlightSaves.delete(tableName);
                        }
                    });
                this.#inFlightSaves.set(tableName, savePromise);
            }
            this.#setCachedFileData(tableName, 'timeOutId', null);
            const forceTimeOutId = this.getCachedFileData(tableName).forceTimeOutId;
            if (forceTimeOutId) {
                clearTimeout(forceTimeOutId);
                this.#setCachedFileData(tableName, 'forceTimeOutId', null);
            }
        };
        const timeOutId = this.getCachedFileData(tableName).timeOutId;
        if (timeOutId) {
            clearTimeout(timeOutId);
            this.#setCachedFileData(tableName, 'timeOutId', null);
        }
        const forceTimeOutId = this.getCachedFileData(tableName).forceTimeOutId;
        if (force) {
            cb();
        } else {
            this.#setCachedFileData(
                tableName,
                'timeOutId',
                setTimeout(cb, LAZY_DELAY_SAVE_TIME).unref(),
            );
            if (!forceTimeOutId) {
                this.#setCachedFileData(
                    tableName,
                    'forceTimeOutId',
                    setTimeout(cb, FORCE_DELAY_SAVE_TIME).unref(),
                );
            }
        }
    }

    #clearTimeOutFileData(tableName: string): {
        timeOutId?: ReturnType<typeof setTimeout> | null;
        forceTimeOutId?: ReturnType<typeof setTimeout> | null;
    } {
        const timeOutId = this.getCachedFileData(tableName).timeOutId;
        if (timeOutId) {
            clearTimeout(timeOutId);
            this.#setCachedFileData(tableName, 'timeOutId', null);
        }
        const forceTimeOutId = this.getCachedFileData(tableName).forceTimeOutId;
        if (forceTimeOutId) {
            clearTimeout(forceTimeOutId);
            this.#setCachedFileData(tableName, 'forceTimeOutId', null);
        }
        // exactOptionalPropertyTypes: поля возвращаемого объекта заполняем только
        // теми таймерами, которые реально были установлены.
        const result: {
            timeOutId?: ReturnType<typeof setTimeout> | null;
            forceTimeOutId?: ReturnType<typeof setTimeout> | null;
        } = {};
        if (timeOutId !== undefined) {
            result.timeOutId = timeOutId;
        }
        if (forceTimeOutId !== undefined) {
            result.forceTimeOutId = forceTimeOutId;
        }
        return result;
    }

    /**
     * Принудительно сохраняет данные таблицы в файл и дожидается завершения записи.
     * @param tableName Имя таблицы
     * @private
     */
    async #forceSave(tableName: string): Promise<void> {
        // Снимаем отложенные записи сразу, чтобы за время ожидания ниже
        // debounce-таймер не запустил ещё одну запись того же файла.
        this.#clearTimeOutFileData(tableName);
        // Сначала дожидаемся выполняемой записи: если начать финальную параллельно,
        // старый снимок может записаться позже и перезаписать итоговые данные.
        // Её сбой или обрыв по shutdown тоже означал бы потерю изменений,
        // которые cb() уже считал сохранёнными.
        const inFlight = this.#inFlightSaves.get(tableName);
        if (inFlight) {
            await inFlight;
        }
        // Данные читаем после ожидания: кэш редактируется по ссылке, и за это
        // время в него могли попасть новые изменения.
        const data = this.getCachedFileData(tableName).data;
        if (data) {
            try {
                await this._appContext?.saveFileData(`${tableName}.json`, data);
            } catch (e) {
                this._appContext?.logError(
                    `Произошла ошибка при записи в файл: ${(e as Error).message}`,
                    { error: e },
                );
            }
        }
    }

    /**
     * Выполняет UPDATE-запрос.
     * @param updateData Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     * @returns true, если запись найдена по первичному ключу и обновлена (или отсутствует — операция безошибочна), иначе false
     */
    public _update(updateData: IQuery): boolean {
        const update = updateData.data;
        const select = updateData.query;
        const data = this.getFileData(updateData.tableName);
        if (select) {
            const idVal = select[updateData.primaryKeyName as string] as string;
            if (idVal !== undefined) {
                if (this.#isForbiddenKey(idVal)) {
                    this._appContext?.logError(`Попытка использовать запрещённый ключ: ${idVal}`);
                    return false;
                }
                const rowKey = this.#resolveRowKey(updateData, select, data);
                if (rowKey !== null && data[rowKey] !== undefined) {
                    data[rowKey] = { ...data[rowKey], ...update };
                    this.#update(updateData.tableName);
                }
                return true;
            }
        }
        return false;
    }

    /**
     * Выполняет INSERT-запрос.
     * @param insertData Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     * @returns true при успешной вставке записи, иначе false (нет первичного ключа или ключ запрещён)
     */
    public _insert(insertData: IQuery): boolean {
        const insert = insertData.data;
        const data = this.getFileData(insertData.tableName);
        if (insert) {
            const idVal = insert[insertData.primaryKeyName as string] as string;
            if (idVal) {
                if (this.#isForbiddenKey(idVal)) {
                    this._appContext?.logError(`Попытка использовать запрещённый ключ: ${idVal}`);
                    return false;
                }
                data[this.#getStorageKey(insertData, insert) ?? idVal] = insert;
                this.#update(insertData.tableName);
                return true;
            }
        }
        return false;
    }

    /**
     * Выполняет DELETE-запрос.
     * @param removeData Дополнительная информация для запроса. Содержит сам запрос, а также название таблицы и прочие данные.
     * @returns true, если условие содержит первичный ключ (запись удалена или отсутствовала), иначе false
     */
    public _remove(removeData: IQuery): boolean {
        const remove = removeData.query;
        const data = this.getFileData(removeData.tableName);
        if (remove) {
            const idVal = remove[removeData.primaryKeyName as string] as string;
            if (idVal !== undefined) {
                if (this.#isForbiddenKey(idVal)) {
                    this._appContext?.logError(`Попытка использовать запрещённый ключ: ${idVal}`);
                    return false;
                }
                const rowKey = this.#resolveRowKey(removeData, remove, data);
                if (rowKey !== null && data[rowKey] !== undefined) {
                    delete data[rowKey];
                    this.#update(removeData.tableName);
                }
                return true;
            }
        }
        return false;
    }

    /**
     * Получение данных по уникальному ключу
     * @param selectData Информация о запросе: название таблицы и имя первичного ключа
     * @param where Условие выборки — объект с полями, среди которых ищется первичный ключ
     * @param isOne Определяет, нужно ли вернуть только 1 найденную запись (объект), либо массив с ней
     * @param content Данные таблицы (ключ — первичный ключ записи), среди которых идёт поиск
     * @private
     */
    #selectInPrimaryKey(
        selectData: IQuery,
        where: IQueryData,
        isOne: boolean = false,
        content: TFileData = {},
    ): IModelRes {
        const whereKey = where[selectData.primaryKeyName as string];
        // Запись и удаление по зарезервированным ключам уже защищены #isForbiddenKey;
        // чтение защищаем тоже: content['__proto__'] возвращает Object.prototype,
        // и пользователь с таким platform-id ошибочно считался «найденным»,
        // из-за чего его данные потом молча не сохранялись.
        if (typeof whereKey === 'string' && this.#isForbiddenKey(whereKey)) {
            this._appContext?.logError(`Попытка использовать запрещённый ключ: ${whereKey}`);
            return { status: false };
        }
        const rowKey =
            typeof whereKey === 'string' || typeof whereKey === 'number'
                ? this.#resolveRowKey(selectData, where, content)
                : null;
        const row = rowKey === null ? undefined : content[rowKey];
        if (!row) {
            return {
                status: false,
            };
        }
        if (keysCount(where) > 1) {
            for (const data in where) {
                if (!Object.hasOwn(row, data) || row[data] !== where[data]) {
                    return {
                        status: false,
                    };
                }
            }
        }
        return {
            status: true,
            data: isOne ? row : [row],
        };
    }

    /**
     * Выполняет SELECT-запрос.
     *
     * ⚠️ Файловый адаптер поддерживает только точное совпадение значений. Условия с операторами (например, $gt, $in) игнорируются.
     *
     * @param selectData Дополнительная информация для запроса. Содержит информацию о таблице и структуре.
     * @param where Сам запрос
     * @param isOne Определяет нужно ли вернуть только 1 найденную запись, либо отдать все доступные данные.
     * @returns IModelRes — результат выборки: { status: true, data } при успехе, { status: false, error } — если ничего не найдено
     */
    public _select(
        selectData: IQuery,
        where: IQueryData | null,
        isOne: boolean = false,
    ): IModelRes {
        let result: Record<string, unknown> | Record<string, unknown>[] | null = null;
        const content = this.getFileData(selectData.tableName);
        if (where) {
            // Зарезервированные ключи в условиях выборки недопустимы: чтение по ним
            // возвращало унаследованные свойства Object.prototype как «найденную запись».
            for (const whereField in where) {
                if (this.#isForbiddenKey(whereField)) {
                    this._appContext?.logError(
                        `Попытка использовать запрещённый ключ: ${whereField}`,
                    );
                    return { status: false };
                }
            }
            const whereKey = where[selectData.primaryKeyName as string];
            // Поиск по ключу строки возможен, только если в условии есть все поля
            // составного ключа. Иначе (например, UsersData.whereOne({userId}))
            // запись ищется перебором по значениям полей.
            if (
                whereKey &&
                this.#getUniqueKeys(selectData).every(
                    (key) => where[key] !== undefined && where[key] !== null,
                )
            ) {
                return this.#selectInPrimaryKey(selectData, where, isOne, content);
            }
            for (const key in content) {
                const row = content[key];
                if (!row) {
                    continue;
                }
                let allMatch = true;
                for (const data in where) {
                    if (!Object.hasOwn(row, data) || row[data] !== where[data]) {
                        allMatch = false;
                        break;
                    }
                }
                if (allMatch) {
                    if (isOne) {
                        result = row;
                        return {
                            status: true,
                            data: result,
                        };
                    }
                    result ??= [];
                    result.push(row);
                }
            }
        } else if (isOne) {
            const firstKey = Object.keys(content)[0];
            result = firstKey !== undefined ? (content[firstKey] ?? null) : null;
        } else {
            result = content;
        }
        if (result) {
            return {
                status: true,
                data: result,
            };
        }
        return {
            status: false,
            error: 'Не удалось получить данные',
        };
    }

    /**
     * Загружает данные таблицы из JSON-файла и кэширует их в памяти.
     *
     * - При первом обращении читает файл `${tableName}.json` из директории `appConfig.json`.
     * - После первого чтения данные берутся только из кэша: mtime проверяется лишь
     *   при первом чтении, повторно файл не перечитывается (извне данные менять не должен никто).
     * - Отсутствие файла тоже кэшируется: если файла не было при первом обращении,
     *   повторно он искаться не будет.
     * - В случае ошибки парсинга делается повторная попытка (защита от гонок записи/чтения).
     *
     * Формат данных в файле:
     * ```json
     * {
     *   "user123": { "name": "Alice", "age": 30 },
     *   "user456": { "name": "Bob", "age": 25 }
     * }
     * ```
     * где ключ — значение первичного ключа.
     * В случае если файла нет, вернутся пустые данные
     * @param tableName Имя таблицы (используется как имя файла)
     * @returns Данные таблицы из кэша либо прочитанные из JSON-файла (при повреждении файла — {})
     */
    public getFileData(tableName: string): TFileData {
        const path = this._appContext?.appConfig.json;
        const file = `${path}/${tableName}.json`;
        // Так как именно модель управляет файлом, то не нужно постоянно обращаться к файлу, так как извне никто не может поменять содержимое. По крайней мере не должен!

        const fileInfo = this.getCachedFileData(tableName).isFileRead
            ? null
            : getFileInfoSync(file).data;
        if (fileInfo?.isFile()) {
            // Файл менялся уже после старта этого адаптера — его пишет кто-то ещё:
            // второй воркер (PM2 cluster), другой процесс с той же директорией
            // json/. Адаптер single-process по документации, mtime-кэш не увидит
            // чужих изменений, а следующая полная перезапись сотрёт их молча.
            // Порог EXTERNAL_CHANGE_GRACE_MS перекрывает гранулярность mtime ФС
            // и запись собственных таблиц в момент инициализации (connect() читает
            // их сразу после init) — иначе warn ложно срабатывал на файлы,
            // созданные приложением за секунды до запуска.
            if (
                this.#adapterStartedAtMs > 0 &&
                fileInfo.mtimeMs > this.#adapterStartedAtMs + EXTERNAL_CHANGE_GRACE_MS
            ) {
                this._appContext?.logWarn(
                    `Файл "${file}" изменён после запуска FileAdapter (внешним процессом?). ` +
                        'Адаптер рассчитан на один процесс: параллельный доступ к тем же json-файлам ' +
                        'приводит к тихой потере записей. Если воркеров несколько — используйте MongoAdapter.',
                    { file, mtimeMs: fileInfo.mtimeMs },
                );
            }
            // При размере базы более 360 МБ (3.6e8) высок риск падения приложения (критично ~400 МБ).
            if (fileInfo.size > 3.6e8) {
                this._appContext.logError(
                    'Размер файловой Базы данных приближается к 400мб! Велика вероятность падения приложения! Рекомендуется перейти на другой адаптер(Например MongoAdapter, или какое-то свое решение) для работы с базой данных!',
                    { fileInfo },
                );
            } else if (fileInfo.size > 2.7e8) {
                this._appContext.logWarn(
                    'Размер файловой Базы данных приближается к 300мб, при дальнейшем увеличении размера базы данных, приложение может упасть. Рекомендуется перейти на другой адаптер для работы с базой данных.',
                    { fileInfo },
                );
            }
            const getFileData = (isForce: boolean = false): TFileData => {
                const cachedFileData = this.getCachedFileData(tableName);
                let fileData;
                if (cachedFileData && cachedFileData.version >= fileInfo.mtimeMs && !isForce) {
                    fileData = cachedFileData.data;
                } else {
                    const readResult = freadSync(file);
                    if (!readResult.success) {
                        this._appContext?.logError(
                            `Не удалось прочитать файл "${file}". Ошибка: ${readResult.error}`,
                        );
                        return {};
                    }
                    fileData = readResult.data;
                }

                const data = typeof fileData === 'string' ? JSON.parse(fileData) : fileData;
                this.setCachedFileData(tableName, {
                    data,
                    version: fileInfo.mtimeMs,
                    isFileRead: true,
                });
                return data;
            };
            try {
                return getFileData() || {};
            } catch {
                try {
                    // Может возникнуть ситуация когда файл прочитался во время записи, из-за чего не получится его распарсить.
                    // Поэтому считаем что произошла ошибка при чтении, и пробуем прочитать повторно.
                    return getFileData(true) || {};
                } catch (e) {
                    this._appContext?.logError(
                        `Произошла ошибка при получении данных из файла ${file}. Возможно файл был поврежден.`,
                        {
                            error: (e as Error).message,
                        },
                    );
                    return {};
                }
            }
        } else {
            this.#setCachedFileData(tableName, 'isFileRead', true);
            return this.getCachedFileData(tableName).data as TFileData;
        }
    }

    /**
     * Проверяет, установлено ли соединение с БД.
     */
    public isConnected(): boolean {
        return true;
    }

    /**
     * Закрывает все подключения к файловой БД.
     * Все процессы завершаются, и происходит сохранение данных в файл.
     */
    public async destroy(): Promise<void> {
        const result = super.destroy();
        if (isPromise(result)) {
            await result.catch((e: Error) => {
                this._appContext?.logError(`FileAdapter:destroy(): ${e.message}`, { error: e });
            });
        }
        // После super.destroy() databaseInfo адаптера уже не заполнен (сбрасывается
        // в Base), поэтому таблицы собираем из обоих хранилищ кэша. Запись
        // форсируется для всех таблиц, а не только с живыми таймерами: иначе
        // изменения между окнами дебаунса потерялись бы при завершении процесса.
        const tableNames = new Set<string>([
            ...Object.keys(this.#cachedFileData),
            ...(this._appContext?.database.databaseInfo
                ? Object.keys(this._appContext.database.databaseInfo)
                : []),
        ]);
        await Promise.all([...tableNames].map((tableName) => this.close(tableName)));
    }

    /**
     * Закрывает подключение к определенной таблице.
     * При закрытии, все хранящиеся в памяти данные сохраняются в файл.
     * При повторном close (или таблице без данных) запись не выполняется —
     * только ожидание in-flight операций.
     * @param tableName - Имя таблицы
     */
    public async close(tableName: string): Promise<void> {
        // Повторный close (или close таблицы, никогда не читавшейся с диска):
        // кэш уже сброшен и данные потеряны — форсить запись здесь означало бы
        // перезапись файла пустым объектом. Просто дожидаемся in-flight записи.
        const cached = this.getCachedFileData(tableName);
        const hasData = Object.keys(cached.data ?? {}).length > 0;
        if (cached.isFileRead || hasData) {
            await this.#forceSave(tableName);
        } else {
            const inFlight = this.#inFlightSaves.get(tableName);
            if (inFlight) {
                await inFlight;
            }
        }
        this.setCachedFileData(tableName, undefined);
    }
}
