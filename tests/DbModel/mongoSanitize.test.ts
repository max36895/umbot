/**
 * Тесты санитизации NoSQL-инъекций в MongoAdapter (#isSafeMongoQuery).
 *
 * Стандартный поток фреймворка передаёт в where скалярный userId (объекты
 * размываются escapeString), но кастомные модели и пользовательские where
 * могут пронести в драйвер объект-оператор. Защита стоит до обращения к
 * коллекции — поэтому тестируется без реального соединения.
 *
 * Баланс регрессии: операторы сравнения ($gt, $in, $ne, $or…) — ДОКУМЕНТИРОВАННЫЙ
 * API фреймворка (JSDoc IQueryData, dbAdapter.md), они обязаны работать.
 * Запрещены только исполняющие на сервере БД ($where, $function, $accumulator,
 * $expr), незнакомые $-операторы и ключи прототипа (в т.ч. внутри dotted-путей).
 */
import { AppContext } from '../../src';
import { MongoAdapter } from '../../src/plugins';
import type { IQuery } from '../../src/models/db';

describe('MongoAdapter: санитизация NoSQL-инъекций', () => {
    let appContext: AppContext;
    let adapter: MongoAdapter;
    let collectionCalls: string[];
    let collections: Record<string, Record<string, jest.Mock>>;

    beforeEach(() => {
        appContext = new AppContext();
        appContext.setLogger({
            error: () => {},
            warn: () => {},
            log: () => {},
        });
        adapter = new MongoAdapter();
        adapter.init(appContext);
        collectionCalls = [];
        collections = {};
        // Имитируем подключённое состояние: методы-обёртки (query/_query) работают,
        // а перехват db.collection() фиксирует любые попытки добраться до драйвера.
        // Коллекции кэшируются по имени — как реальный Db, чтобы mock'и не терялись.
        const makeCollection = (name: string): Record<string, jest.Mock> => {
            collections[name] ??= {
                findOne: jest.fn().mockResolvedValue(null),
                find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
                insertOne: jest.fn().mockResolvedValue({ insertedId: 'x' }),
                updateOne: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
                deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }),
            };
            return collections[name];
        };
        const fakeDb = {
            collection: (name: string): Record<string, jest.Mock> => {
                collectionCalls.push(name);
                return makeCollection(name);
            },
        };
        (appContext.database as { databaseInfo: unknown }).databaseInfo = {
            mongoClient: {},
            mongoConnect: {
                db: (): unknown => fakeDb,
            },
        };
        (appContext.database as { isSendConnect?: boolean }).isSendConnect = true;
    });

    const queryOf = (where: Record<string, unknown>): IQuery =>
        ({
            tableName: 'UsersData',
            primaryKeyName: 'userId',
            query: where,
            data: {},
        }) as unknown as IQuery;

    describe('запрещено (NoSQL-инъекция)', () => {
        it('_select отвергает $where в where до обращения к коллекции', async () => {
            const res = await adapter._select(
                { tableName: 'UsersData', primaryKeyName: 'userId' } as unknown as IQuery,
                { $where: 'sleep(1000)' } as never,
                true,
            );
            expect(res).toEqual({
                status: false,
                error: 'Запрос содержит запрещённые ключи (NoSQL-инъекция)',
            });
            expect(collectionCalls).toHaveLength(0);
        });

        it('_select отвергает $function и незнакомые операторы', async () => {
            for (const op of ['$function', '$accumulator', '$expr', '$randomFuture']) {
                const res = await adapter._select(
                    { tableName: 'UsersData', primaryKeyName: 'userId' } as unknown as IQuery,
                    { age: { [op]: {} } } as never,
                    true,
                );
                expect(res.status).toBe(false);
            }
            expect(collectionCalls).toHaveLength(0);
        });

        it('_select отвергает __proto__ из JSON.parse (own property)', async () => {
            // __proto__ через литерал объекта не создаёт own-ключ, поэтому инъекцию
            // эмулируем JSON.parse — реальный путь входящих данных
            const where = JSON.parse('{"userId": "ok", "__proto__": {"polluted": true}}');
            const res = await adapter._select(
                { tableName: 'UsersData', primaryKeyName: 'userId' } as unknown as IQuery,
                where,
                true,
            );
            expect(res).toEqual({
                status: false,
                error: 'Запрос содержит запрещённые ключи (NoSQL-инъекция)',
            });
            expect(collectionCalls).toHaveLength(0);
        });

        it('_select отвергает ключи прототипа в dotted-путях', async () => {
            const res = await adapter._select(
                { tableName: 'UsersData', primaryKeyName: 'userId' } as unknown as IQuery,
                { 'a.__proto__.x': 1 } as never,
                true,
            );
            expect(res.status).toBe(false);
            expect(collectionCalls).toHaveLength(0);
        });

        it('_select отвергает вложенность глубже 10 уровней', async () => {
            let where: Record<string, unknown> = { $where: 'x' };
            for (let i = 0; i < 12; i++) {
                where = { nested: where };
            }
            const res = await adapter._select(
                { tableName: 'UsersData', primaryKeyName: 'userId' } as unknown as IQuery,
                where as never,
                true,
            );
            expect(res.status).toBe(false);
            expect(collectionCalls).toHaveLength(0);
        });

        it('_remove отвергает $where в where', async () => {
            const res = await adapter._remove(queryOf({ $where: 'true' }));
            expect(res).toBe(false);
            expect(collectionCalls).toHaveLength(0);
        });

        it('_update отвергает $-ключи в данных (фреймворк сам добавляет $set)', async () => {
            const res = await adapter._update({
                ...queryOf({ userId: 'ok' }),
                data: { $set: { evil: 1 } },
            } as unknown as IQuery);
            expect(res).toBe(false);
            expect(collectionCalls).toHaveLength(0);
        });

        it('_insert отвергает $-ключи в данных', async () => {
            const res = await adapter._insert({
                ...queryOf({}),
                data: { userId: 'ok', $ne: 1 },
            } as unknown as IQuery);
            expect(res).toBe(false);
            expect(collectionCalls).toHaveLength(0);
        });
    });

    describe('разрешено (документированный API: операторы сравнения в where)', () => {
        it('_select пропускает {age: {$gt: 18}} — без обращения к фильтру защиты', async () => {
            collections.UsersData = {
                findOne: jest.fn().mockResolvedValue({ userId: 'user-1', age: 25 }),
                find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
                insertOne: jest.fn(),
                updateOne: jest.fn(),
                deleteOne: jest.fn(),
            };
            const res = await adapter._select(
                { tableName: 'UsersData', primaryKeyName: 'userId' } as unknown as IQuery,
                { age: { $gt: 18 } } as never,
                true,
            );
            expect(res).toEqual({ status: true, data: { userId: 'user-1', age: 25 } });
            expect(collectionCalls).toEqual(['UsersData']);
        });

        it('_select пропускает $in/$nin/$or/$and/$elemMatch', async () => {
            for (const where of [
                { city: { $in: ['Moscow', 'Sochi'] } },
                { $or: [{ a: 1 }, { b: 2 }] },
                { tags: { $elemMatch: { $gt: 5 } } },
            ]) {
                const res = await adapter._select(
                    { tableName: 'UsersData', primaryKeyName: 'userId' } as unknown as IQuery,
                    where as never,
                    true,
                );
                // запись не найдена (дефолтная заглушка), но запрос дошёл до
                // «драйвера» — не отвергнут защитой
                expect(collectionCalls).toContain('UsersData');
                expect(res).not.toEqual({
                    status: false,
                    error: 'Запрос содержит запрещённые ключи (NoSQL-инъекция)',
                });
            }
        });

        it('_remove пропускает оператор сравнения в where', async () => {
            const res = await adapter._remove(queryOf({ age: { $lt: 18 } }));
            expect(res).toBe(true);
        });
    });
});
