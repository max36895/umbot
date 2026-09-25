# ТЗ: Внешние адаптеры баз данных для umbot

> **Статус:** техническое задание для сообщества / контрибьюторов.
> **Цель:** расширить набор поддерживаемых СУБД за пределами ядра `umbot`, чтобы любой разработчик мог опубликовать свой адаптер в npm и подключить его одной строкой — без изменения исходников фреймворка.

## 1. Мотивация

Из коробки `umbot` поставляет два DB-адаптера: `FileAdapter` (JSON-файл, для разработки) и `MongoAdapter` (production). Для production-нагрузок сообществу часто нужны Redis, PostgreSQL, SQLite, MySQL, DynamoDB и т.д.

Вместо того чтобы раздувать ядро и тянуть в `dependencies` драйверы всех СУБД, правильная модель — **внешние пакеты-адаптеры**. Фреймворк уже спроектирован под это: слой БД полностью абстрагирован интерфейсами, а подключение происходит через `bot.use()`.

Это ТЗ описывает, как написать такой внешний пакет, чтобы он корректно работал с `umbot` и был совместим с его системой метрик, жизненным циклом и типами.

## 2. Что уже есть во фреймворке (на что опираться)

### 2.1 Базовый класс `BaseDbAdapter`

Экспортируется из `umbot/plugins`:

```ts
import { BaseDbAdapter } from 'umbot/plugins';
```

Это абстрактный класс `Base<TDbInfo extends IDatabaseInfo>` (`src/plugins/db/Base/Base.ts`), реализующий `IDatabaseAdapter`. Он уже содержит:

- интеграцию с `AppContext` (хранение подключения в `appContext.database`);
- сбор метрик времени запросов (`EMetric.DB_SELECT/INSERT/UPDATE/REMOVE`) — публичные методы `select/insert/update/remove` оборачивают ваши `_select/_insert/_update/_remove`;
- готовую логику `save()` (insert-or-update) и `selectOne()`;
- управление жизненным циклом (`init`, `connect`, `destroy`, `close`).

**Правило:** наследуйтесь от `BaseDbAdapter` и переопределяйте только методы с подчёркиванием (`_select`, `_insert`, ...). Не переопределяйте публичные `select/insert/update/remove` — иначе сломаете метрики и переподключение.

### 2.2 Контракт, который нужно реализовать

| Метод         | Сигнатура                                                                                            | Что делает                                        |
| ------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `connect`     | `(): Promise<boolean> \| boolean`                                                                    | Установить соединение. Вернуть `true` при успехе. |
| `isConnected` | `(): Promise<boolean> \| boolean`                                                                    | Проверить, живо ли соединение (ping).             |
| `_select`     | `(selectData: IQuery, where: IQueryData \| null, isOne: boolean) => IModelRes \| Promise<IModelRes>` | Поиск записей.                                    |
| `_insert`     | `(insertData: IQuery) => boolean \| Promise<boolean>`                                                | Вставка. `true`/`false`.                          |
| `_update`     | `(updateData: IQuery) => boolean \| Promise<boolean>`                                                | Обновление. `true`/`false`.                       |
| `_remove`     | `(removeData: IQuery) => boolean \| Promise<boolean>`                                                | Удаление. `true`/`false`.                         |
| `destroy`     | `(): void \| Promise<void>`                                                                          | Закрыть пул/соединение при остановке.             |
| `close`       | `(tableName: string) => void \| Promise<void>`                                                       | Освободить ресурсы конкретной таблицы.            |

Опционально:

| Метод          | Когда переопределять                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `_query`       | Если хотите поддержать `model.query(callback)` — произвольный запрос. По умолчанию возвращает `null`. |
| `escapeString` | Для SQL-баз **обязательно** переопределить: базовая реализация просто приводит к строке.              |
| `ensureSchema` | Для баз со схемой (SQL) **обязательно**: создать таблицы и индексы. См. раздел ниже.                  |

### Подготовка схемы: `ensureSchema`

Фреймворк хранит данные в трёх таблицах — `UsersData`, `ImageTokens`, `SoundTokens`. Кто их создаёт:

- **Хранилища без схемы** (`FileAdapter`, MongoDB) — сами: файл или коллекция появляются при первой записи.
- **Базы со схемой** (PostgreSQL, MySQL, SQLite и т.д.) — **адаптер**. Без этого первый же запрос упадёт с ошибкой
  «таблица не существует».

Для этого у адаптера есть метод `ensureSchema(tables)`. Фреймворк вызывает его **после каждого успешного
`connect()`** и **до первого запроса к базе** (параллельные запросы ждут его завершения) и передаёт описание таблиц —
`DB_TABLES_SCHEMA` (экспортируется из `umbot`): имя таблицы, первичный ключ, `uniqueKeys`, поля с типами
(`string` с `maxLength` / `text`) и наборы полей, по которым нужны индексы. Базовая реализация ничего не делает и
возвращает `true`.

Требования:

- метод идемпотентный — таблицы и индексы, которые уже есть, не пересоздаются (`CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`);
- при сбое (нет прав на DDL) вернуть `false` или бросить исключение — фреймворк запишет ошибку в лог и продолжит работу;
- новые колонки в будущих версиях umbot появятся в `DB_TABLES_SCHEMA` — добавляйте недостающие (`ALTER TABLE ... ADD
COLUMN`), а не только создавайте таблицу.

```ts
import { BaseDbAdapter } from 'umbot/plugins';
import type { IDbTableSchema } from 'umbot';

class PgAdapter extends BaseDbAdapter {
    async ensureSchema(tables: readonly IDbTableSchema[]): Promise<boolean> {
        for (const table of tables) {
            const columns = Object.entries(table.fields).map(
                ([name, field]) =>
                    `"${name}" ${field.type === 'text' ? 'TEXT' : `VARCHAR(${field.maxLength ?? 255})`}`,
            );
            await this.#pool.query(
                `CREATE TABLE IF NOT EXISTS "${table.tableName}" (${columns.join(', ')})`,
            );
            for (const fields of table.indexes) {
                const name = `umbot_${table.tableName}_${fields.join('_')}`;
                const list = fields.map((field) => `"${field}"`).join(', ');
                await this.#pool.query(
                    `CREATE INDEX IF NOT EXISTS "${name}" ON "${table.tableName}" (${list})`,
                );
            }
        }
        return true;
    }
}
```

`MongoAdapter` в `ensureSchema` создаёт индексы из `indexes` (коллекции MongoDB создаёт сама).

### 2.3 Форматы данных

**Вход — `IQuery`** (что фреймворк передаёт в ваши методы):

```ts
{
  tableName: 'UsersData',       // имя таблицы/коллекции
  primaryKeyName: 'userId',     // первичный ключ (string | number | null)
  query: { userId: '123', platform: 'telegram' }, // условия WHERE (может быть null)
  uniqueKeys: ['platform'],     // поля составного ключа (опционально, с 3.1.4)
  data: { name: 'John' },       // данные для SET/INSERT (может быть null)
  rules: [{ name: ['name'], type: 'string', max: 50 }] // правила валидации
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

**Условия — `IQueryData`.** Значения могут быть примитивами или объектами с операторами. Фреймворк не навязывает диалект — адаптер сам решает, как интерпретировать операторы (`$gt`, `$in` и т.д.):

```ts
{ userId: '123', platform: 'alisa' }              // равенство
{ age: { $gt: 18 }, status: 'active' }            // операторы
```

Рекомендуемый минимум операторов: `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, `$in`.

**Выход `_select` — `IModelRes`:**

```ts
// успех: записи нашлись
{ status: true, data: [{ id: 1, name: 'Alice' }] }
// запись не найдена (пустая выборка)
{ status: false }
// ошибка
{ status: false, error: 'Connection timeout' }
```

**Важно:** `status: true` — только когда данные реально есть; при отсутствии записи возвращайте
`{ status: false }`. Так работают встроенные `FileAdapter` и `MongoAdapter`, а `Model.save()`
решает insert-vs-update по `selectOne().status` — ложный `status: true` на пустой выборке
сломает сохранение (update вместо insert).

При сбое обязательно заполняйте `error`: по нему ядро отличает «не найдено» от «БД не ответила» и во втором
случае не сохраняет `userData` запроса. Без `error` сбой выглядит как новый пользователь, и ядро вставит новую
запись.

**Важно:** не выбрасывайте исключения из `_select/_insert/_update/_remove`. Обрабатывайте ошибки внутри и возвращайте `status: false` / `false`.

### 2.4 Публичные типы для импорта

Все нужные типы доступны из корня `umbot` и `umbot/plugins`:

```ts
import {
    BaseDbAdapter, // базовый класс
} from 'umbot/plugins';

import type {
    IQuery, // структура запроса
    IQueryData, // условия/данные
    IModelRes, // результат _select
    IDbResult, // данные результата
    IAppDB, // опции подключения (host/user/pass/database/options)
    IDatabaseInfo, // что хранить в appContext.database.databaseInfo
    AppContext, // контекст приложения
} from 'umbot';
```

## 3. Требования к внешнему пакету

### 3.1 Структура пакета

```
umbot-<db>-adapter/
├── src/
│   └── index.ts          # экспорт класса адаптера
├── tests/
│   └── adapter.test.ts   # unit-тесты (jest)
├── package.json
├── tsconfig.json
└── README.md
```

### 3.2 package.json

```json
{
    "name": "umbot-<db>-adapter",
    "version": "1.0.0",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "files": ["dist"],
    "peerDependencies": {
        "umbot": ">=3.1.0"
    },
    "dependencies": {
        "<db-driver>": "^x.y.z"
    }
}
```

Ключевые моменты:

- `umbot` — **peerDependency**, а не dependency. Пользователь уже имеет `umbot` в проекте; адаптер не должен ставить свою копию.
- Драйвер конкретной СУБД (`ioredis`, `pg`, `better-sqlite3`, ...) — обычный `dependency` этого пакета. Так драйвер устанавливается только тем, кому адаптер реально нужен, и ядро `umbot` остаётся лёгким.
- Публикуйте только `dist` (`files: ["dist"]`).

### 3.3 Именование

- Пакет: `umbot-<db>-adapter` (например, `umbot-redis-adapter`, `umbot-postgres-adapter`).
- Класс: `<Db>Adapter` (например, `RedisAdapter`, `PostgresAdapter`).
- Поле `dbFormat`: уникальный идентификатор формата, например `'redis'`, `'postgres'`.

### 3.4 Шаблон реализации

```ts
import { BaseDbAdapter } from 'umbot/plugins';
import type { IQuery, IQueryData, IModelRes, IAppDB, IDatabaseInfo } from 'umbot';
// import драйвера вашей БД

interface IRedisDbInfo extends IDatabaseInfo {
    client: unknown | null; // здесь храните живое подключение
}

export class RedisAdapter extends BaseDbAdapter<IRedisDbInfo> {
    dbFormat = 'redis';

    constructor(options?: IAppDB) {
        super(options);
    }

    connect(): Promise<boolean> {
        // 1. создать клиент из this._dbOptions (host/user/pass/database/options)
        // 2. сохранить в this._appContext.database.databaseInfo
        //    (базовый класс уже создал пустой объект в init(); вы заполняете его
        //    своим клиентом/пулом — это конвенция, а не обязанность интеграции)
        // 3. вернуть true при успехе, false при ошибке (не бросать)
        return Promise.resolve(true);
    }

    isConnected(): boolean {
        // ping / проверка статуса клиента
        return Boolean(this._appContext.database.databaseInfo?.client);
    }

    async _select(
        selectData: IQuery,
        where: IQueryData | null,
        isOne: boolean,
    ): Promise<IModelRes> {
        try {
            // транслировать where (с операторами) в запрос вашей БД
            // вернуть { status: true, data: [...] }
            return { status: true, data: [] };
        } catch (e) {
            return { status: false, error: (e as Error).message };
        }
    }

    async _insert(insertData: IQuery): Promise<boolean> {
        try {
            return true;
        } catch {
            return false;
        }
    }

    async _update(updateData: IQuery): Promise<boolean> {
        try {
            return true;
        } catch {
            return false;
        }
    }

    async _remove(removeData: IQuery): Promise<boolean> {
        try {
            return true;
        } catch {
            return false;
        }
    }

    async destroy(): Promise<void> {
        // закрыть клиент/пул, обнулить databaseInfo
    }

    close(_tableName: string): void {
        // освободить ресурсы таблицы (если применимо)
    }
}
```

### 3.5 Подключение пользователем

```ts
import { Bot } from 'umbot';
import { TelegramAdapter } from 'umbot/plugins';
import { RedisAdapter } from 'umbot-redis-adapter';

const bot = new Bot()
    .use(new TelegramAdapter())
    .use(new RedisAdapter({ host: 'localhost', database: 'bot_db' }))
    .setAppConfig({/* ... */});
```

> ⚠️ В приложении может быть активен **только один** DB-адаптер. При подключении второго `BaseDbAdapter.init()` автоматически вызовет `destroy()` у предыдущего.

## 4. Требования к качеству

1. **Тесты.** Покрыть `_select/_insert/_update/_remove`, `connect`, `isConnected`, `destroy`. Внешние соединения мокать (`jest.fn()` / `jest.mock()`), реальных запросов в тестах быть не должно. Ориентир — `tests/DbModel/` в репозитории `umbot`.
2. **Обработка ошибок.** Никаких необработанных исключений из методов контракта — только `status: false` / `false`.
3. **Таймауты.** Все обращения к БД должны иметь ограниченные таймауты. Не создавать незавершаемых запросов в обработчиках.
4. **Экранирование.** Для SQL-баз переопределить `escapeString`. Не конкатенировать пользовательские значения в запрос — использовать параметризованные запросы.
5. **Секреты.** Не логировать пароли/токены. Использовать `this._appContext.logError/logWarn` (они маскируют секреты).
6. **TypeScript.** `strict: true`, без `any` (использовать `unknown` + сужение). JSDoc на русском для публичных методов.
7. **README.** Быстрый старт, пример подключения, таблица поддерживаемых операторов, ограничения.

## 5. Чек-лист готовности адаптера

- [ ] Наследуется от `BaseDbAdapter`, переопределены только `_`-методы.
- [ ] `connect`/`isConnected`/`destroy`/`close` реализованы и безопасны к повторному вызову.
- [ ] Для баз со схемой: `ensureSchema` создаёт недостающие таблицы и индексы и безопасен к повторному вызову.
- [ ] `_select` возвращает `IModelRes` (`status: true` только при найденных записях; отсутствие записи — `status: false`; ошибка — `status: false` с заполненным `error`).
- [ ] Нет исключений из методов контракта.
- [ ] Поддержаны операторы `$gt/$gte/$lt/$lte/$ne/$in` (минимум).
- [ ] `umbot` в peerDependencies, драйвер БД в dependencies.
- [ ] Тесты с моками проходят, покрытие ключевых веток.
- [ ] `npm run build` и `npm run lint` чистые.
- [ ] README с примером подключения.

## 6. Приоритетные адаптеры для реализации

| Адаптер    | Пакет                    | Драйвер                    | Приоритет            |
| ---------- | ------------------------ | -------------------------- | -------------------- |
| Redis      | `umbot-redis-adapter`    | `ioredis`                  | высокий (кэш/сессии) |
| PostgreSQL | `umbot-postgres-adapter` | `pg`                       | высокий (production) |
| SQLite     | `umbot-sqlite-adapter`   | `better-sqlite3`           | средний (embedded)   |
| MySQL      | `umbot-mysql-adapter`    | `mysql2`                   | средний              |
| DynamoDB   | `umbot-dynamodb-adapter` | `@aws-sdk/client-dynamodb` | низкий               |
