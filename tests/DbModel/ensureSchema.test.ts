/**
 * Подготовка схемы БД (ensureSchema).
 *
 * Раньше нигде не было зафиксировано, кто создаёт таблицы: FileAdapter и MongoDB
 * создают хранилище сами, а SQL-адаптер падал на первом же запросе («таблица не
 * существует»), и у MongoDB не было индексов — поиск шёл полным перебором.
 * Теперь фреймворк после подключения передаёт адаптеру описание встроенных
 * таблиц (DB_TABLES_SCHEMA), а адаптер создаёт недостающее.
 */
import {
    AppContext,
    Bot,
    BaseBotController,
    DB_TABLES_SCHEMA,
    IDbTableSchema,
    ImageTokens,
    SoundTokens,
    T_ALISA,
    UsersData,
} from '../../src';
import { AlisaAdapter, FileAdapter, MongoAdapter } from '../../src/plugins';

const request = (id: number): string =>
    JSON.stringify({
        meta: {
            locale: 'ru-RU',
            timezone: 'UTC',
            client_id: 'yandex.searchplugin',
            interfaces: {},
        },
        session: { message_id: id, session_id: 's', skill_id: 'k', user_id: `u${id}`, new: false },
        request: { command: 'привет', original_utterance: 'привет', type: 'SimpleUtterance' },
        version: '1.0',
    });

describe('DB_TABLES_SCHEMA синхронизирована с моделями', () => {
    const appContext = new AppContext();
    const models = [
        new UsersData(appContext),
        new ImageTokens(appContext),
        new SoundTokens(appContext),
    ];

    it.each(models.map((model) => [model.tableName(), model] as const))(
        '%s: имя, ключи, поля и длины совпадают с моделью',
        (_name, model) => {
            const table = DB_TABLES_SCHEMA.find((t) => t.tableName === model.tableName());
            expect(table).toBeDefined();
            expect(table?.primaryKeyName).toBe(model.queryData.primaryKeyName);
            expect([...(table?.uniqueKeys ?? [])]).toEqual(model.queryData.uniqueKeys ?? []);
            expect(Object.keys(table?.fields ?? {}).sort()).toEqual(
                Object.keys(model.attributeLabels()).sort(),
            );
            for (const rule of model.rules()) {
                for (const field of rule.name) {
                    expect(table?.fields[field]?.maxLength).toBe(rule.max);
                }
            }
        },
    );
});

describe('Bot: ensureSchema после подключения', () => {
    class SchemaAdapter extends FileAdapter {
        public received: readonly IDbTableSchema[] | null = null;
        public calls = 0;
        public result: boolean | Error = true;

        async ensureSchema(tables: readonly IDbTableSchema[]): Promise<boolean> {
            this.calls++;
            this.received = tables;
            await Promise.resolve();
            if (this.result instanceof Error) {
                throw this.result;
            }
            return this.result;
        }
    }

    function makeBot(adapter: SchemaAdapter): { bot: Bot; errors: string[] } {
        const errors: string[] = [];
        const bot = new Bot();
        bot.setLogger({ log: () => {}, error: (m) => errors.push(String(m)), warn: () => {} });
        bot.use(new AlisaAdapter()).use(adapter);
        bot.initBotController(BaseBotController);
        return { bot, errors };
    }

    it('передаёт адаптеру описание таблиц один раз на подключение', async () => {
        const adapter = new SchemaAdapter();
        const { bot } = makeBot(adapter);
        await bot.run(T_ALISA, request(1));
        await bot.run(T_ALISA, request(2));
        expect(adapter.calls).toBe(1);
        expect(adapter.received).toBe(DB_TABLES_SCHEMA);
        await bot.close();
    });

    it('параллельные запросы ждут подготовки схемы', async () => {
        const adapter = new SchemaAdapter();
        const order: string[] = [];
        const originalSelect = adapter._select.bind(adapter);
        adapter._select = (...args): ReturnType<FileAdapter['_select']> => {
            order.push('select');
            return originalSelect(...args);
        };
        const originalEnsure = adapter.ensureSchema.bind(adapter);
        adapter.ensureSchema = async (tables): Promise<boolean> => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            order.push('schema');
            return originalEnsure(tables);
        };
        const { bot } = makeBot(adapter);
        await Promise.all([bot.run(T_ALISA, request(1)), bot.run(T_ALISA, request(2))]);
        expect(order[0]).toBe('schema');
        await bot.close();
    });

    it('сбой подготовки схемы логируется, но работа с БД продолжается', async () => {
        const adapter = new SchemaAdapter();
        adapter.result = new Error('нет прав');
        const { bot, errors } = makeBot(adapter);
        await bot.run(T_ALISA, request(1));
        expect(errors.some((e) => e.includes('нет прав'))).toBe(true);
        expect(bot.getAppContext().database.isSendConnect).toBe(true);
        await bot.close();
    });

    it('false из ensureSchema логируется', async () => {
        const adapter = new SchemaAdapter();
        adapter.result = false;
        const { bot, errors } = makeBot(adapter);
        await bot.run(T_ALISA, request(1));
        expect(errors.some((e) => e.includes('ensureSchema вернул false'))).toBe(true);
        await bot.close();
    });
});

describe('MongoAdapter.ensureSchema', () => {
    function makeAdapter(createIndex: jest.Mock): { adapter: MongoAdapter; warns: string[] } {
        const warns: string[] = [];
        const appContext = new AppContext();
        appContext.setLogger({
            log: () => {},
            error: () => {},
            warn: (m) => warns.push(String(m)),
        });
        appContext.setAppConfig({ db: { host: 'mongodb://localhost', database: 'bot' } });
        const adapter = new MongoAdapter();
        adapter.init(appContext);
        const collection = jest.fn().mockReturnValue({ createIndex });
        appContext.database.databaseInfo = {
            mongoClient: null,
            mongoConnect: { db: jest.fn().mockReturnValue({ collection }) } as never,
        };
        return { adapter, warns };
    }

    it('создаёт индексы по описанию таблиц', async () => {
        const createIndex = jest.fn().mockResolvedValue('ok');
        const { adapter } = makeAdapter(createIndex);
        await expect(adapter.ensureSchema(DB_TABLES_SCHEMA)).resolves.toBe(true);
        expect(createIndex).toHaveBeenCalledWith(
            { userId: 1, platform: 1 },
            { name: 'umbot_userId_platform' },
        );
        expect(createIndex).toHaveBeenCalledWith(
            { platform: 1, path: 1 },
            { name: 'umbot_platform_path' },
        );
    });

    it('без прав на createIndex предупреждает и возвращает false', async () => {
        const createIndex = jest.fn().mockRejectedValue(new Error('not authorized'));
        const { adapter, warns } = makeAdapter(createIndex);
        await expect(adapter.ensureSchema(DB_TABLES_SCHEMA)).resolves.toBe(false);
        expect(warns.some((w) => w.includes('not authorized'))).toBe(true);
    });
});
