# Адаптеры баз данных (DB Adapters)

Фреймворк umbot не знает, используете вы SQL, NoSQL или файловую систему. Он оперирует абстрактными объектами IQuery и IQueryData. Ваша задача как разработчика адаптера — написать "транслятор", который превращает эти абстракции в реальные запросы к вашей СУБД.

## Архитектура: Template Method

Базовый класс `BaseDbAdapter` (из `umbot/plugins`) берет на себя рутину:

- Замер времени выполнения запросов (метрики EMetric.DB_SELECT, DB_INSERT и т.д.).
- Управление жизненным циклом (вызов connect при старте).
- Обертки над вашими методами (публичные `select`, `insert` вызывают ваши `_select`, `_insert`).

### Почему мы переопределяем \_select, а не select?

Публичные методы (`select`, `insert`, `update`, `remove`) в `BaseDbAdapter` уже написаны. Они оборачивают ваши внутренние методы (`_select`, `_insert`), чтобы замерять время выполнения и логировать метрики (управление жизненным циклом и переподключениями живёт в `connect()`/`init()` — публичные обёртки к нему отношения не имеют). Если вы переопределите select(), вы сломаете сбор метрик. Вы всегда реализуете только методы с подчеркиванием.

## Обязательный контракт (что нужно реализовать)

Наследуемся от `BaseDbAdapter` и реализуем абстрактные методы:

1. isConnected(): Promise<boolean> | boolean — Проверяете, живо ли соединение (например, делаете ping БД).
2. \_select(selectData: IQuery, where: IQueryData | null, isOne: boolean): IModelRes | Promise<IModelRes> — Поиск.
3. \_insert(insertData: IQuery): boolean | Promise<boolean> — Добавление.
4. \_update(updateData: IQuery): boolean | Promise<boolean> — Обновление.
5. \_remove(removeData: IQuery): boolean | Promise<boolean> — Удаление.

Опционально (в базовом классе есть реализации по умолчанию):

- connect(): Promise<boolean> | boolean — по умолчанию возвращает `true`. Переопределите, чтобы устанавливать реальное соединение с БД.
- destroy(): void | Promise<void> — по умолчанию пустой метод. Переопределите, чтобы закрывать пул соединений при остановке приложения.
- close(tableName: string): void | Promise<void> — закрытие подключения к конкретной таблице.
- \_query(callback: TQueryCb) — по умолчанию возвращает `null`. Переопределите, если хотите поддержать произвольные запросы через `model.query()`.
- ensureSchema(tables: readonly IDbTableSchema[]): boolean | Promise<boolean> — по умолчанию ничего не делает. Для баз со схемой (SQL) **обязательно**: создайте недостающие таблицы и индексы по описанию `DB_TABLES_SCHEMA`. Фреймворк вызывает метод после каждого успешного `connect()`, до первого запроса к базе.

### Кто создаёт таблицы

Фреймворк хранит данные в трёх таблицах — `UsersData`, `ImageTokens`, `SoundTokens`:

- **Хранилища без схемы** (`FileAdapter`, MongoDB) создают их сами: файл или коллекция появляются при первой записи.
  `MongoAdapter` в `ensureSchema` дополнительно создаёт индексы.
- **Базы со схемой** (PostgreSQL, MySQL, SQLite) — таблицы создаёт **адаптер** в `ensureSchema`. Без этого первый же
  запрос упадёт с ошибкой «таблица не существует».

`ensureSchema` получает `DB_TABLES_SCHEMA` (экспортируется из `umbot`): имя таблицы, первичный ключ, `uniqueKeys`,
поля с типами (`string` с `maxLength` / `text`) и наборы полей для индексов. Метод должен быть идемпотентным
(`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`); при сбое верните `false` или бросьте исключение —
фреймворк запишет ошибку в лог и продолжит работу. Полный пример для PostgreSQL — в
[спецификации внешних адаптеров](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/adapter/external-db-adapter-spec).

## Форматы данных (Шпаргалка):

### Вход (IQuery): То, что фреймворк передает вам.

Это объект, который фреймворк передает в ваши методы \_select, \_insert и т.д.

```ts
{
  tableName: 'UsersData',       // Имя таблицы/коллекции
  primaryKeyName: 'userId',     // Первичный ключ
  query: { userId: '123', platform: 'telegram' }, // Условия WHERE (может быть null)
  uniqueKeys: ['platform'],     // Поля составного ключа (опционально)
  data: { name: 'John' },       // Данные для SET (может быть null)
  rules: [{ name: ['name'], type: 'string', max: 50 }] // Правила валидации
}
```

**`uniqueKeys` — составной ключ.** Если значение первичного ключа уникально только в паре с другими полями,
модель передаёт эти поля в `uniqueKeys` и добавляет их в `query` для select/update/remove. Так устроена `UsersData`:
`userId` уникален в пределах платформы (пользователь Telegram 42 и пользователь VK 42 — разные люди), поэтому
запрос выглядит как `{ userId: '42', platform: 'telegram' }`, а `uniqueKeys: ['platform']`. Адаптер, который
фильтрует по всем полям `query` (SQL `WHERE`, фильтр MongoDB), поддерживает это без изменений. Адаптер, который
ищет запись только по `primaryKeyName` (например, по ключу объекта, как `FileAdapter`), обязан учитывать и поля
`uniqueKeys` — иначе записи разных пользователей сольются. `FileAdapter` хранит такие строки под ключом
`<platform>:<userId>` и сам переносит строки прежнего формата (ключ — `userId`) при первом обращении.

### Условия и данные (IQueryData)

Формат query и data внутри IQuery.
Важно: Значения могут быть не только примитивами, но и объектами с операторами. Фреймворк не навязывает конкретный диалект (например, $gt для Mongo или > для SQL). Адаптер сам решает, как интерпретировать эти операторы.

```ts
// Простое условие (равенство)
{ userId: '123', platform: 'alisa' }

// Условие с оператором (адаптер должен сам распарсить это в SQL `age > 18` или Mongo `$gt`)
{ age: { $gt: 18 }, status: 'active' }
```

### Выходные данные (IModelRes)

То, что вы обязаны вернуть из метода `_select`.

```ts
// Успех: записи нашлись
{ status: true, data: { userId: '123', name: 'John' } }
{ status: true, data: [] }

// Запись не найдена (пустая выборка) — тоже status: false
{ status: false }

// Ошибка (сбой подключения, синтаксическая ошибка и т.д.)
{ status: false, error: 'Connection timeout' }
```

**Критично:** `status: true` возвращайте только когда данные реально есть. Если запись не найдена —
возвращайте `{ status: false }`. Оба встроенных адаптера (FileAdapter, MongoAdapter) работают именно так,
а `Model.save()` решает insert-vs-update по `selectOne().status`: ложный `status: true` на пустой выборке
сломает сохранение (update вместо insert).

Не путайте «не найдено» с ошибкой: при сбое обязательно заполняйте `error`. Ядро по нему понимает, что данные
пользователя не загрузились: запрос обрабатывается с пустыми `userData`, но они не сохраняются. Без `error` сбой
выглядит как «пользователь новый», и ядро вставит для него новую запись поверх существующих данных.

Для методов `_insert`, `_update`, `_remove` вы возвращаете просто boolean (true при успехе, false при ошибке).

## Критические нюансы (Скрытые контракты)

### 1. Валидация данных

В базовом классе `BaseDbAdapter` нет встроенного метода `validate()`.
Однако в `MongoAdapter` он реализован для валидации данных по правилам модели (`IModelRules`).

**Рекомендация:** Если вам нужна **дополнительная валидация** (например, обрезка строк по `max`, приведение типов),
реализуйте метод `validate()` в своём классе:

```ts
public validate(query: IQuery, element: IQueryData | null): IQueryData {
    if (!element) return {};

    const rules = query.rules;
    if (rules) {
        rules.forEach((rule) => {
            rule.name.forEach((fieldName) => {
                if (rule.type === 'string' || rule.type === 'text') {
                    if (rule.max !== undefined) {
                        element[fieldName] = Text.resize(element[fieldName] as string, rule.max);
                    }
                    element[fieldName] = this.escapeString(element[fieldName] as string);
                } else if (rule.type === 'integer' || rule.type === 'int') {
                    element[fieldName] = +(element[fieldName] as number);
                }
            });
        });
    }
    return element;
}
```

Затем вызывайте его в `_insert()` и `_update()`:

```ts
public async _insert(insertData: IQuery): Promise<boolean> {
    const validData = this.validate(insertData, insertData.data);
    // ... выполнение запроса с validData
}
```

**Примечание:** Валидация в модели (`Model.validate()`) и в адаптере (`validate()`) — это разные вещи.
Модель валидирует свои данные перед сохранением, а адаптер валидирует данные по правилам `IModelRules`
перед выполнением запроса к БД.

**Безопасность:** перед передачей `query` (where) и `data` в драйвер проверяйте их на опасные ключи —
`__proto__`, `constructor`, `prototype` (включая вложенные объекты и составные пути вида `a.__proto__.b`)
и объекты-операторы в данных записи. Без этой проверки возможны prototype pollution и инъекции в драйвер.
Образец реализации — приватный метод `#isSafeMongoQuery` в `MongoAdapter` (src/plugins/db/Mongo/Adapter.ts).

_Зачем тогда в `IQuery` передаются `rules`?_
Они нужны вам для **маппинга типов** специфичных для вашей СУБД. Например, если вы пишете SQL-адаптер, вы можете использовать `rules`, чтобы понять, что поле с `type: 'object'` нужно сериализовать в JSON-строку перед вставкой, а `max: 150` использовать для динамического создания `VARCHAR(150)`.

**Примечание для FileAdapter:** FileAdapter не реализует `validate()` по правилам `IModelRules`, так как
работает только с точным совпадением значений и не поддерживает операторы. При этом его операции защищены
от зарезервированных ключей (`__proto__`, `constructor`, `prototype`) приватным методом `#isForbiddenKey`
проверки в select/insert/update/remove.

### 2. Хранение подключения (Connection Pool)

Чтобы не создавать новое подключение к БД на каждый запрос, пул хранится в контексте приложения — одном на экземпляр
`Bot`.
К моменту вызова `connect()` базовый класс уже привязал `appContext` и создал пустой `databaseInfo`
(это делает `init()` в `Base/Base.ts`), поэтому конвенция проста: сохраняйте ваш пул/клиент в
`this._appContext.database.databaseInfo` — оттуда его читают `_select/_insert` и внешние `model.query(callback)`.

```ts
async connect(): Promise<boolean> {
    const pool = await createMyDbPool(this._dbOptions);
    // Сохраняем пул, чтобы использовать его в _select/_insert
    this._appContext.database.databaseInfo = { myDbPool: pool };
    return true;
}
```

### 3. Произвольные запросы (\_query)

Если разработчику приложения нужно выполнить "сырой" SQL-запрос или агрегацию, он использует метод `model.query(callback)`.
В `BaseDbAdapter` публичный `query` просто вызывает `_query`. По умолчанию `_query` возвращает `null`. Если вы хотите поддержать кастомные запросы, переопределите `_query`.

Контракт callback (`TQueryCb`): `(client, db) => Promise<IModelRes>`. Первый параметр — клиент подключения,
второй — объект базы данных (`db` у Mongo — это `client.db(...)`, у SQL-баз можно передать тот же пул).
Callback возвращает `IModelRes`; адаптер отдаёт пользователю `data.data` при `status: true` и `null` — при ошибке
(образец — `MongoAdapter._query`).

### 4. Обработка ошибок

Не бросайте исключения (`throw new Error`) из методов `_select`, `_insert`, `_update`, `_remove`.
Фреймворк ожидает, что вы сами обработаете ошибки внутри метода и вернете `false` или `{ status: false, error: ... }`.

## Универсальный пример реализации (Псевдокод)

```ts
import { BaseDbAdapter } from 'umbot/plugins';
import { IQuery, IQueryData, IModelRes, TQueryCb } from 'umbot';

export class MyCustomDbAdapter extends BaseDbAdapter {
    async connect(): Promise<boolean> {
        try {
            // 1. Создаем пул соединений
            const pool = await myDbDriver.connect(this._dbOptions);
            // 2. Сохраняем его в контекст
            this._appContext.database.databaseInfo = { pool };
            return true;
        } catch (err) {
            return false;
        }
    }

    async isConnected(): Promise<boolean> {
        const pool = this._appContext.database.databaseInfo?.pool;
        return pool ? await pool.ping() : false;
    }

    async _select(
        selectData: IQuery,
        where: IQueryData | null,
        isOne: boolean,
    ): Promise<IModelRes> {
        const pool = this._appContext.database.databaseInfo?.pool;
        if (!pool) return { status: false, error: 'No DB connection' };

        try {
            // 1. Парсим абстрактные условия where в SQL/NoSQL запрос
            const sqlQuery = this.buildSelectQuery(selectData.tableName, where, isOne);

            // 2. Выполняем запрос
            const result = await pool.execute(sqlQuery);

            // 3. Возвращаем в формате IModelRes
            return { status: true, data: result };
        } catch (err) {
            // Не бросаем исключение, а возвращаем статус false
            return { status: false, error: (err as Error).message };
        }
    }

    async _insert(insertData: IQuery): Promise<boolean> {
        const pool = this._appContext.database.databaseInfo?.pool;
        if (!pool) return false;

        try {
            // Валидация (так как в BaseDbAdapter её нет, используем свою)
            const validData = this.validate(insertData, insertData.data);
            const sqlQuery = this.buildInsertQuery(insertData.tableName, validData);
            await pool.execute(sqlQuery);
            return true;
        } catch (err) {
            return false;
        }
    }

    async _update(updateData: IQuery): Promise<boolean> {
        const pool = this._appContext.database.databaseInfo?.pool;
        if (!pool) return false;

        try {
            const validData = this.validate(updateData, updateData.data);
            const sqlQuery = this.buildUpdateQuery(
                updateData.tableName,
                validData,
                updateData.query,
            );
            await pool.execute(sqlQuery);
            return true;
        } catch (err) {
            return false;
        }
    }

    async _remove(removeData: IQuery): Promise<boolean> {
        const pool = this._appContext.database.databaseInfo?.pool;
        if (!pool) return false;

        try {
            const sqlQuery = this.buildDeleteQuery(removeData.tableName, removeData.query);
            await pool.execute(sqlQuery);
            return true;
        } catch (err) {
            return false;
        }
    }

    // Переопределяем _query, чтобы поддержать сырые запросы от разработчика
    public async _query(callback: TQueryCb): Promise<unknown> {
        const pool = this._appContext.database.databaseInfo?.pool;
        if (pool) {
            // Передаем клиент и базу в callback разработчика.
            // Callback возвращает IModelRes; при status: true отдаем data.data
            const data = await callback(pool, pool);
            if (data && data.status) {
                return data.data;
            }
            return null;
        }
        return null;
    }

    async destroy(): Promise<void> {
        const pool = this._appContext.database.databaseInfo?.pool;
        if (pool) await pool.close();
    }

    // --- Вспомогательные методы ---

    // Своя валидация
    private validate(query: IQuery, data: IQueryData | null): IQueryData {
        if (!data) return {};
        // Здесь можно пройтись по query.rules и обрезать строки по max
        return data;
    }

    // Транслятор IQueryData в SQL (упрощенно)
    // ⚠️ ВНИМАНИЕ: Это псевдокод для демонстрации. В реальном коде используйте
    // параметризованные запросы (prepared statements) для защиты от SQL-инъекций!
    private buildSelectQuery(table: string, where: IQueryData | null, isOne: boolean): string {
        let sql = `SELECT * FROM ${table}`;
        if (where) {
            const conditions = Object.keys(where).map((key) => {
                const val = where[key];
                // Поддержка операторов
                if (typeof val === 'object' && val !== null && val.$gt !== undefined) {
                    return `${key} > ?`; // параметризованный запрос
                }
                return `${key} = ?`; // параметризованный запрос
            });
            sql += ` WHERE ${conditions.join(' AND ')}`;
        }
        if (isOne) sql += ' LIMIT 1';
        return sql;
    }

    private buildInsertQuery(table: string, data: IQueryData): string {
        // ... логика формирования INSERT
        return '';
    }

    private buildUpdateQuery(table: string, data: IQueryData, where: IQueryData | null): string {
        // ... логика формирования UPDATE
        return '';
    }

    private buildDeleteQuery(table: string, where: IQueryData | null): string {
        // ... логика формирования DELETE
        return '';
    }
}
```
