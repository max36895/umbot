/**
 * Регресс: MongoAdapter._select возвращал сам документ вместо IModelRes, поэтому
 * whereOne() не находил существующую запись — userData не загружались, а каждый
 * запрос вставлял дубль. Драйвер подменяется: тест не требует живого MongoDB.
 */
import { AppContext, UsersData } from '../../src';
import { MongoAdapter } from '../../src/plugins';

const DOC = { userId: '42', platform: 'alisa', data: { score: 7 }, meta: {} };

function createContext(collection: Record<string, unknown>): {
    ctx: AppContext;
    errors: string[];
} {
    const errors: string[] = [];
    const ctx = new AppContext();
    ctx.setLogger({ error: (msg) => errors.push(String(msg)), warn: () => {} });
    ctx.setAppConfig({ db: { host: 'mongodb://localhost', database: 'test' } });
    new MongoAdapter().init(ctx);
    ctx.database.databaseInfo = {
        mongoClient: null,
        mongoConnect: { db: (): unknown => ({ collection: (): unknown => collection }) } as never,
    };
    return { ctx, errors };
}

describe('MongoAdapter._select', () => {
    it('найденная запись: whereOne() возвращает true и загружает данные', async () => {
        const { ctx } = createContext({ findOne: async () => DOC });
        const user = new UsersData(ctx);

        expect(await user.whereOne({ userId: '42', platform: 'alisa' })).toBe(true);
        expect(user.data).toEqual({ score: 7 });
        expect(await new UsersData(ctx).where({ userId: '42' }, true)).toEqual({
            status: true,
            data: DOC,
        });
    });

    it('запись не найдена: status false без ошибки и без записи в лог', async () => {
        const { ctx, errors } = createContext({ findOne: async () => null });

        expect(await new UsersData(ctx).where({ userId: '42' }, true)).toEqual({ status: false });
        expect(errors).toEqual([]);
    });

    it('ошибка драйвера: status false с ошибкой и запись в лог', async () => {
        const { ctx, errors } = createContext({
            findOne: async () => {
                throw new Error('timeout');
            },
        });

        const res = await new UsersData(ctx).where({ userId: '42' }, true);
        expect(res.status).toBe(false);
        expect(res.error).toBeInstanceOf(Error);
        expect(errors.some((e) => e.includes('timeout'))).toBe(true);
    });

    it('выборка списка возвращает массив в data', async () => {
        const { ctx } = createContext({
            find: (): unknown => ({ toArray: async (): Promise<unknown[]> => [DOC] }),
        });

        expect(await new UsersData(ctx).where({ platform: 'alisa' })).toEqual({
            status: true,
            data: [DOC],
        });
    });
});
