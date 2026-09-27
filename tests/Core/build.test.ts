/**
 * Регресс: run(config, 'prod') выставлял strict_prod ПОСЛЕ регистрации
 * параметров и команд из config.logic. strictMode проверяет регулярные
 * выражения в момент регистрации, поэтому опасные выражения оставались
 * рабочими, хотя режим prod обещал их отклонять.
 */
import { run } from '../../src/build';
import { Bot, IAppIntent } from '../../src';
import { FileAdapter, MongoAdapter } from '../../src/plugins';
import { createTestDir, removeTestDir } from '../helpers/tmpDir';

describe('run(): порядок установки режима', () => {
    let dir: string;
    let bot: Bot | undefined;

    beforeEach(() => {
        dir = createTestDir('build');
        bot = undefined;
    });

    afterEach(async () => {
        await bot?.close();
        await removeTestDir(dir);
    });

    it('prod: опасное выражение из config.logic и appParam не регистрируется', () => {
        const dangerIntent: IAppIntent = {
            name: 'danger_intent',
            slots: ['(a+)+$'],
            is_pattern: true,
        };
        run(
            {
                appConfig: { json: dir, error_log: dir },
                appParam: { intents: [dangerIntent] },
                plugins: [],
                logic: (b) => {
                    bot = b;
                    b.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
                    // eslint-disable-next-line security/detect-unsafe-regex -- опасное выражение проверяется намеренно
                    b.addCommand('danger', [/(a+)+$/], (_, ctx) => {
                        ctx.text = 'x';
                    });
                },
            },
            'prod',
            '127.0.0.1',
            0,
        );
        const ctx = bot!.getAppContext();
        expect(ctx.appMode).toBe('strict_prod');
        expect(ctx.commands.get('danger')).toBeUndefined();
        expect(ctx.platformParams.intents?.some((i) => i.name === 'danger_intent')).toBe(false);
    });
});

describe('run(): адаптер БД по умолчанию', () => {
    let dir: string;
    let bot: Bot | undefined;

    beforeEach(() => {
        dir = createTestDir('build');
        bot = undefined;
    });

    afterEach(async () => {
        await bot?.close();
        await removeTestDir(dir);
    });

    const start = (db?: { host: string; database: string }): Bot => {
        run(
            {
                appConfig: { json: dir, error_log: dir, ...(db ? { db } : {}) },
                logic: (b) => {
                    bot = b;
                    b.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
                },
            },
            'dev-online',
            '127.0.0.1',
            0,
        );
        return bot as Bot;
    };

    it('без адреса базы подключается FileAdapter', () => {
        // Регресс: подключался MongoAdapter без адреса — userData не сохранялась.
        const adapter = start().getAppContext().database.adapter;
        expect(adapter).toBeInstanceOf(FileAdapter);
    });

    it('с адресом базы подключается MongoAdapter', () => {
        const adapter = start({ host: 'mongodb://127.0.0.1:1', database: 'bot' }).getAppContext()
            .database.adapter;
        expect(adapter).toBeInstanceOf(MongoAdapter);
    });
});
