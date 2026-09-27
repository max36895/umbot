/**
 * Описание встроенных таблиц umbot для DB-адаптеров.
 *
 * Фреймворк хранит данные в трёх таблицах (коллекциях): `UsersData`, `ImageTokens`,
 * `SoundTokens`. Адаптер, которому нужна схема (SQL) или индексы (MongoDB), получает
 * это описание в `ensureSchema()` после подключения и создаёт недостающее сам —
 * разработчику не нужно заводить таблицы вручную.
 *
 * @module models/db/schema
 */

/**
 * Тип поля таблицы.
 * - `string` — короткая строка (для SQL — VARCHAR с `maxLength`, если он задан);
 * - `text` — длинный текст без ограничения длины (JSON-сериализованные данные).
 */
export type TDbFieldType = 'string' | 'text';

/**
 * Описание поля таблицы.
 *
 * @example
 * ```ts
 * const field: IDbFieldSchema = { type: 'string', maxLength: 250 };
 * ```
 */
export interface IDbFieldSchema {
    /** Тип поля */
    type: TDbFieldType;
    /** Максимальная длина строки (для `string`), если ограничена */
    maxLength?: number;
}

/**
 * Описание таблицы (коллекции), которую использует фреймворк.
 *
 * @example
 * ```ts
 * // Создание таблицы в SQL-адаптере по описанию
 * const columns = Object.entries(table.fields).map(([name, field]) =>
 *     `"${name}" ${field.type === 'text' ? 'TEXT' : `VARCHAR(${field.maxLength ?? 255})`}`,
 * );
 * await db.query(`CREATE TABLE IF NOT EXISTS "${table.tableName}" (${columns.join(', ')})`);
 * ```
 */
export interface IDbTableSchema {
    /** Имя таблицы (коллекции) */
    tableName: string;
    /** Первичный ключ записи */
    primaryKeyName: string;
    /** Поля, которые вместе с первичным ключом однозначно определяют запись (см. `IQuery.uniqueKeys`) */
    uniqueKeys: readonly string[];
    /** Все поля таблицы */
    fields: Readonly<Record<string, IDbFieldSchema>>;
    /**
     * Наборы полей, по которым фреймворк ищет записи. Для каждого набора стоит
     * создать индекс — без него поиск идёт полным перебором таблицы.
     */
    indexes: readonly (readonly string[])[];
}

/**
 * Встроенные таблицы umbot. Передаются в `IDatabaseAdapter.ensureSchema()` после
 * успешного подключения к базе.
 *
 * Описание синхронизировано с моделями `UsersData`, `ImageTokens`, `SoundTokens`
 * (имена таблиц, ключи, поля и правила длины); соответствие проверяется тестами.
 *
 * @example
 * ```ts
 * import { DB_TABLES_SCHEMA } from 'umbot';
 *
 * for (const table of DB_TABLES_SCHEMA) {
 *     console.log(table.tableName, Object.keys(table.fields));
 * }
 * ```
 */
export const DB_TABLES_SCHEMA: readonly IDbTableSchema[] = [
    {
        tableName: 'UsersData',
        primaryKeyName: 'userId',
        uniqueKeys: ['platform'],
        fields: {
            userId: { type: 'string', maxLength: 250 },
            platform: { type: 'string' },
            meta: { type: 'text' },
            data: { type: 'text' },
        },
        indexes: [['userId', 'platform']],
    },
    {
        tableName: 'ImageTokens',
        primaryKeyName: 'imageToken',
        uniqueKeys: [],
        fields: {
            imageToken: { type: 'string', maxLength: 150 },
            path: { type: 'string', maxLength: 150 },
            platform: { type: 'string' },
        },
        indexes: [['platform', 'path']],
    },
    {
        tableName: 'SoundTokens',
        primaryKeyName: 'soundToken',
        uniqueKeys: [],
        fields: {
            soundToken: { type: 'string', maxLength: 150 },
            path: { type: 'string', maxLength: 150 },
            platform: { type: 'string' },
        },
        indexes: [['platform', 'path']],
    },
];
