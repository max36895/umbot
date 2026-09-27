/**
 * Модуль базовой модели для работы с данными
 *
 * Предоставляет абстрактный класс для:
 * - Взаимодействия с базой данных
 * - Валидации данных
 * - Управления состоянием модели
 * - Выполнения CRUD операций
 */

import { IDataValue, IModelRes, IModelRules, TQueryCb } from '../interface';
import { IQueryData, IQuery, getQueryData, TKey } from './QueryData';
import { AppContext, IDbResult } from '../../core';

/**
 * Состояние модели: произвольный набор полей, восстанавливаемых из БД
 * (generic-ограничение публичного `Model<TState>`).
 */
export interface IModelState {
    [key: string]: unknown;
}

/**
 * Интерфейс для описания результата выполнения операции с поиском 1 значения
 */
export interface ISelectOneModelRes extends Omit<IModelRes, 'data'> {
    /**
     * Результат выполнения операции.
     * Присутствует только при status = true.
     * Может содержать любые данные в зависимости от операции
     */
    data?: IDataValue;
}

/**
 * Абстрактный класс для создания моделей данных.
 * Предоставляет базовую функциональность для работы с данными в базе данных.
 *
 * @example
 * ```ts
 * class UserModel extends Model<UserState> {
 *   public constructor(appContext: AppContext) {
 *     super(appContext);
 *   }
 *
 *   // Определение правил валидации
 *   rules(): IModelRules[] {
 *     return [
 *       { name: ['username'], type: 'string', max: 50 },
 *       { name: ['age'], type: 'integer' }
 *     ];
 *   }
 *
 *   // Определение меток атрибутов
 *   attributeLabels(): UserState {
 *     return {
 *       id: 'ID',
 *       username: 'Имя пользователя',
 *       age: 'Возраст'
 *     };
 *   }
 *
 *   // Определение имени таблицы
 *   tableName(): string {
 *     return 'users';
 *   }
 * }
 *
 * // Использование модели (конструктор требует контекст приложения)
 * const user = new UserModel(appContext);
 * user.state.username = 'John';
 * user.state.age = 25;
 * await user.save();
 * ```
 *
 * @template TState - Тип состояния модели
 * @class Model
 */
export abstract class Model<TState extends IModelState> {
    /**
     * Объект для хранения параметров запроса.
     * Содержит условия поиска и данные для обновления
     */
    public queryData: IQuery;

    /**
     * Начальный индекс для итерации по данным.
     * Используется при инициализации модели из массива
     */
    public startIndex = 0;

    /**
     * Состояние модели.
     * Содержит текущие значения всех атрибутов
     *
     * @example
     * ```ts
     * // Установка значений
     * this.state.username = 'John';
     * this.state.age = 25;
     *
     * // Получение значений
     * console.log(this.state.username);
     * ```
     */
    public state: Partial<TState> = {};

    /**
     * Контекст приложения.
     */
    protected _appContext: AppContext;

    /**
     * Определяет правила валидации для полей модели
     * Должен быть реализован в дочерних классах
     *
     * @example
     * ```ts
     * rules(): IModelRules[] {
     *   return [
     *     { name: ['username'], type: 'string', max: 50 },
     *     { name: ['age'], type: 'integer' }
     *   ];
     * }
     * ```
     *
     * @returns Массив правил валидации
     * @abstract
     */
    public abstract rules(): IModelRules[];

    /**
     * Определяет метки атрибутов модели
     * Должен быть реализован в дочерних классах
     *
     * @example
     * ```ts
     * attributeLabels(): UserState {
     *   return {
     *     id: 'ID',
     *     username: 'Имя пользователя',
     *     age: 'Возраст'
     *   };
     * }
     * ```
     *
     * @returns Объект с метками атрибутов
     * @abstract
     */
    public abstract attributeLabels(): TState;

    /**
     * Определяет имя таблицы в базе данных
     * Должен быть реализован в дочерних классах
     *
     * @example
     * ```ts
     * tableName(): string {
     *   return 'users';
     * }
     * ```
     *
     * @returns Имя таблицы
     * @abstract
     */
    public abstract tableName(): string;

    /**
     * Создает новый экземпляр модели.
     * Инициализирует контекст приложения и параметры запроса (queryData)
     *
     * @param {AppContext} appContext - Контекст приложения (адаптер БД, логгер, метрики)
     *
     * @example
     * ```ts
     * const user = new UserModel(appContext);
     * ```
     */
    protected constructor(appContext: AppContext) {
        this._appContext = appContext;
        this.queryData = {
            query: null,
            data: null,
            tableName: this.tableName(),
            primaryKeyName: this.getId(),
            rules: this.rules(),
        };
        const uniqueKeys = this.getUniqueKeys();
        // exactOptionalPropertyTypes: поле задаём только у моделей с составным ключом.
        if (uniqueKeys.length) {
            this.queryData.uniqueKeys = uniqueKeys;
        }
    }

    /**
     * Проверяет состояние подключения к базе данных
     *
     * @example
     * ```ts
     * const isConnected = await model.isConnected();
     * if (isConnected) {
     *   // Выполнение операций с базой данных
     * }
     * ```
     *
     * @returns {Promise<boolean> | boolean} true если подключение активно
     *   (синхронно false без адаптера БД, иначе Promise от адаптера)
     */
    public isConnected(): Promise<boolean> | boolean {
        if (this._appContext.database.adapter) {
            return this._appContext.database.adapter.isConnected();
        }
        return false;
    }

    /**
     * Экранирует специальные символы в строке
     *
     * @example
     * ```ts
     * const safe = model.escapeString("O'Connor");
     * ```
     *
     * @param text - Строка или число для экранирования
     * @returns Экранированная строка
     */
    public escapeString(text: string | number): string {
        if (this._appContext.database.adapter) {
            return this._appContext.database.adapter.escapeString(text);
        }
        if (text) {
            return text.toString();
        }
        return '';
    }

    /**
     * Выполняет валидацию данных модели
     * Может быть переопределен в дочерних классах
     *
     * @example
     * ```ts
     * validate(): void {
     *   if (!this.state.username) {
     *     throw new Error('Username is required');
     *   }
     * }
     * ```
     */
    public validate(): void {
        // Базовая реализация пуста — переопределяется в наследниках для валидации данных
    }

    /**
     * Определяет имя первичного ключа таблицы.
     * Ищет поле с меткой 'id' или 'ID'
     *
     * @returns Имя первичного ключа или null
     */
    protected getId(): TKey {
        const labels = this.attributeLabels();
        for (const index in labels) {
            if (labels[index] === 'id' || labels[index] === 'ID') {
                return index;
            }
        }
        return null;
    }

    /**
     * Возвращает поля, которые вместе с первичным ключом однозначно определяют запись.
     * Переопределите, если значение первичного ключа уникально только в паре
     * с другим полем (как `userId` у `UsersData` — в пределах платформы).
     * Эти поля попадают в условие selectOne/update/remove и в `IQuery.uniqueKeys`.
     *
     * @returns Имена дополнительных ключевых полей (по умолчанию — пусто)
     *
     * @example
     * ```ts
     * protected getUniqueKeys(): string[] {
     *     return ['platform'];
     * }
     * ```
     */
    protected getUniqueKeys(): string[] {
        return [];
    }

    /**
     * Условие поиска записи по ключу: первичный ключ плюс поля из getUniqueKeys().
     * Одно место сборки условия для selectOne/update/remove — иначе составной
     * ключ учитывался бы при поиске, но не при обновлении.
     */
    #getKeyQuery(): IQueryData | null {
        const idName = this.queryData.primaryKeyName;
        if (!idName) {
            return this.queryData.query;
        }
        const query: IQueryData = { [idName]: this.state[idName] };
        for (const key of this.queryData.uniqueKeys ?? []) {
            query[key] = this.state[key];
        }
        return query;
    }

    /**
     * Инициализирует модель данными
     *
     * @example
     * ```ts
     * // Объект: значения сопоставляются по именам полей (меткам attributeLabels)
     * model.init({
     *   id: 1,
     *   username: 'John',
     *   age: 25
     * });
     * ```
     *
     * @param data - Данные для инициализации
     */
    public init(data: IDbResult[] | IDbResult | null): void {
        if (data === null) {
            return;
        }
        let i = this.startIndex;
        const labels = this.attributeLabels();

        for (const index in labels) {
            if (data) {
                if ((data as IDbResult)[index] !== undefined) {
                    this.state[index as keyof TState] = (data as IDbResult)[
                        index
                    ] as TState[keyof TState];
                } else if (data[i] === undefined) {
                    this.state[index] = undefined;
                } else {
                    this.state[index] = data[i] as TState[typeof index];
                }
            } else {
                this.state[index] = undefined;
            }
            i++;
        }
    }

    /**
     * Выполняет поиск записи по первичному ключу
     *
     * @example
     * ```ts
     * const result = await model.selectOne();
     * if (result.status) {
     *   model.init(result.data ?? null); // data опционален, init() допускает null
     * }
     * ```
     *
     * @returns Promise с результатом запроса
     */
    public async selectOne(): Promise<ISelectOneModelRes> {
        this.queryData.query = this.#getKeyQuery();
        this.queryData.data = null;
        if (this._appContext.database.adapter) {
            return (await this._appContext.database.adapter.select(
                this.queryData,
                this.queryData.query,
                true,
            )) as ISelectOneModelRes;
        }
        return {
            status: false,
            error: 'Не указан источник для базы данных',
        };
    }

    /**
     * Инициализирует параметры запроса.
     * Подготавливает данные для сохранения или обновления
     */
    #initData(): void {
        // Приватный метод подготовки queryData: вызывается из save() и update().
        this.validate();
        const idName = this.queryData.primaryKeyName;
        this.queryData.query = this.#getKeyQuery();
        const data: IQueryData = {};
        for (const index in this.attributeLabels()) {
            if (index !== idName) {
                data[index] = this.state[index];
            }
        }
        this.queryData.data = data;
    }

    /**
     * Сохраняет данные модели в базу данных
     * Если запись существует - обновляет, иначе создает новую
     *
     * @example
     * ```ts
     * model.state.name = 'John';
     * await model.save(); // Обновление существующей записи
     * await model.save(true); // Создание новой записи
     * ```
     *
     * @param isNew - Флаг создания новой записи
     * @returns Promise с результатом операции
     */
    public async save(isNew: boolean = false): Promise<boolean> {
        this.#initData();
        if (this._appContext.database.adapter) {
            return await this._appContext.database.adapter.save(this.queryData, isNew);
        }
        return false;
    }

    /**
     * Обновляет существующую запись в базе данных
     *
     * @example
     * ```ts
     * model.state.name = 'John';
     * await model.update();
     * ```
     *
     * @returns Promise с результатом операции
     */
    public async update(): Promise<boolean> {
        this.#initData();
        if (this._appContext.database.adapter) {
            return await this._appContext.database.adapter.update(this.queryData);
        }
        return false;
    }

    /**
     * Добавляет новую запись в базу данных
     *
     * @example
     * ```ts
     * model.state.name = 'John';
     * await model.add();
     * ```
     *
     * @returns Promise с результатом операции
     */
    public async add(): Promise<boolean> {
        this.validate();
        this.queryData.query = null;
        const data: IQueryData = {};
        for (const index in this.attributeLabels()) {
            data[index] = this.state[index];
        }
        this.queryData.data = data;
        if (this._appContext.database.adapter) {
            return await this._appContext.database.adapter.insert(this.queryData);
        }
        return false;
    }

    /**
     * Удаляет запись из базы данных
     *
     * @example
     * ```ts
     * await model.remove();
     * ```
     *
     * @returns Promise<boolean> - true если удаление успешно
     */
    public async remove(): Promise<boolean> {
        this.validate();
        this.queryData.query = this.#getKeyQuery();
        this.queryData.data = null;
        if (this._appContext.database.adapter) {
            return await this._appContext.database.adapter.remove(this.queryData);
        }
        return false;
    }

    /**
     * Выполняет произвольный запрос к базе данных
     *
     * @example
     * ```ts
     * // Объект условий — точные значения полей
     * const res = await model.where({ age: 25 });
     *
     * // Строка условий формата getQueryData
     * const res2 = await model.where('`age`=25 `status`="active"');
     * ```
     *
     * @param where - Условия запроса
     * @param isOne - Флаг выборки одной записи
     * @returns Promise с результатом запроса
     */
    public async where(
        where: string | IQueryData = '1',
        isOne: boolean = false,
    ): Promise<IModelRes> {
        const select: IQueryData | null = typeof where === 'string' ? getQueryData(where) : where;
        if (this._appContext.database.adapter) {
            return await this._appContext.database.adapter.select(this.queryData, select, isOne);
        }
        return {
            status: false,
            error: 'Не указан источник для базы данных',
        };
    }

    /**
     * Выполняет запрос с выборкой одной записи
     *
     * @example
     * ```ts
     * const found = await model.whereOne({ id: 1 });
     * if (found) {
     *   console.log('Запись найдена');
     * }
     * ```
     *
     * @param where - Условия запроса
     * @returns Promise<boolean> - true если запись найдена
     */
    public async whereOne(where: string | IQueryData = '1'): Promise<boolean> {
        const res = await this.where(where, true);
        if (res && res.status && this._appContext.database.adapter) {
            this.init(this._appContext.database.adapter.getValue(res));
            return true;
        }
        return false;
    }

    /**
     * Выполняет произвольный запрос к базе данных
     *
     * Типы client/db зависят от подключённого адаптера БД —
     * для MongoAdapter это MongoClient и Db из драйвера mongodb.
     * Для FileAdapter `_query` не реализован — метод вернёт `null`.
     *
     * @example
     * ```ts
     * import type { MongoClient, Db } from 'mongodb';
     *
     * const result = await model.query(async (client: MongoClient, db: Db) => {
     *   const collection = db.collection('users');
     *   return await collection.aggregate([
     *     { $match: { age: { $gt: 18 } } },
     *     { $group: { _id: '$city', count: { $sum: 1 } } }
     *   ]).toArray();
     * });
     * ```
     *
     * @param callback - Функция обратного вызова для выполнения запроса
     * @returns Результат выполнения запроса
     */
    public query(callback: TQueryCb): unknown {
        if (this._appContext.database.adapter) {
            return this._appContext.database.adapter.query(callback);
        }
        return null;
    }

    /**
     * Закрывает соединение с базой данных
     *
     * @example
     * ```ts
     * model.destroy();
     * ```
     */
    public destroy(): void | Promise<void> {
        return this._appContext.database.adapter?.destroy();
    }
}
