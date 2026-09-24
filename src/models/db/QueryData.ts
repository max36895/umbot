/**
 * Модуль для работы с данными запросов к базе данных
 *
 * Предоставляет интерфейсы и классы для:
 * - Формирования параметров запросов
 * - Парсинга строк запросов
 * - Управления данными для вставки и обновления
 */
import { IModelRules } from '../interface/IModel';

/**
 * Интерфейс для хранения данных запроса к базе данных.
 * Позволяет задавать произвольные поля и их значения
 *
 * Значения могут быть простыми (строка, число) или объектами с операторами (например, $gt, $in). Формат условий зависит от реализации адаптера — фреймворк не навязывает конкретный диалект.
 *
 * @example
 * ```ts
 * const query: IQueryData = {
 *   id: 1,                   // Поиск по id = 1
 *   name: 'John',            // Поиск по name = 'John'
 *   age: { $gt: 18 },        // Поиск по age > 18
 *   city: { $in: ['Moscow', 'St. Petersburg'] } // Поиск по city в списке
 * };
 * ```
 */
export interface IQueryData {
    /**
     * Произвольные поля запроса
     * Ключ - название поля в базе данных
     * Значение - условие для поиска или значение для обновления
     *
     * @example
     * ```ts
     * {
     *   'user_id': 123,           // Точное совпадение
     *   'status': 'active',       // Точное совпадение
     *   'age': { $gt: 18 },       // Больше чем
     *   'tags': { $in: ['a', 'b'] } // В списке значений
     * }
     * ```
     */
    [key: string]: unknown | string | number;
}

const DATA_REG = /`([^`]+)`\s*=\s*(?:"([^"]*)"|(\S+))/gim;

/**
 * Тип для имени поля первичного ключа в базе данных.
 * Используется как значение primaryKeyName в IQuery (например, 'userId'
 * для UsersData, 'imageToken' для ImageTokens); null — ключ не задан.
 *
 * @example
 * ```ts
 * const key: TKey = 'userId';  // имя поля первичного ключа
 * const key: TKey = null;     // первичный ключ не задан
 * ```
 */
export type TKey = string | number | null;

/**
 * Структура запроса к базе данных.
 *
 * Используется всеми методами адаптера (`_select`, `_insert` и др.).
 */
export interface IQuery {
    /**
     * Условие фильтрации (для SELECT/UPDATE/DELETE)
     */
    query: IQueryData | null;
    /**
     * Данные для вставки или обновления
     */
    data: IQueryData | null;
    /**
     * Название таблицы
     */
    tableName: string;
    /**
     * Имя поля, используемого как первичный ключ (может быть null)
     */
    primaryKeyName: TKey;
    /**
     * Дополнительные поля, которые вместе с `primaryKeyName` однозначно
     * определяют запись. Нужны, когда значение первичного ключа уникально только
     * в паре с другим полем: `userId` у `UsersData` уникален лишь в пределах
     * платформы (пользователь Telegram 42 и пользователь VK 42 — разные люди).
     *
     * Модель сама добавляет эти поля в `query` для selectOne/update/remove.
     * Адаптер, который ищет запись только по `primaryKeyName` (как FileAdapter
     * по ключу объекта), обязан учитывать и эти поля, иначе записи разных
     * пользователей сольются. Поле опционально: без него поведение прежнее.
     *
     * @example
     * ```ts
     * // UsersData: запись определяется парой userId + platform
     * const query: IQuery = {
     *     query: { userId: '42', platform: 'telegram' },
     *     data: null,
     *     tableName: 'UsersData',
     *     primaryKeyName: 'userId',
     *     uniqueKeys: ['platform'],
     *     rules: [],
     * };
     * ```
     */
    uniqueKeys?: string[];
    /**
     * Правила валидации модели
     */
    rules: IModelRules[];
}

/**
 * Парсит строку запроса в объект IQueryData
 * Поддерживает формат `field=value` с возможностью экранирования.
 * Имя поля должно быть в обратных кавычках (`id`=1) — без них парсер
 * не найдёт пару «поле=значение».
 *
 * @example
 * ```ts
 * import { getQueryData } from 'umbot';
 *
 * const query = getQueryData('`id`=1 `name`="John Doe"');
 * // Результат: { id: 1, name: 'John Doe' }
 * ```
 *
 * @param str - Строка запроса для парсинга
 * @returns Объект с параметрами запроса или null
 */
export function getQueryData(str: string): IQueryData | null {
    if (str) {
        const matchAll = str.matchAll(DATA_REG);
        const regData: IQueryData = {};
        let data = matchAll.next();
        while (!data.done) {
            const key = data.value[1];
            const rawVal = data.value[2] ?? data.value[3];
            // Пропуск match без ключа: запись по undefined-ключу создала бы
            // поле "undefined" в запросе к БД.
            if (key === undefined) {
                data = matchAll.next();
                continue;
            }
            let val: string | number = rawVal ?? '';
            if (val !== '' && !isNaN(+val)) {
                val = +val;
            }
            regData[key] = val;
            data = matchAll.next();
        }
        return regData;
    }
    return null;
}
