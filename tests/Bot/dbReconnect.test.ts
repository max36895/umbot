/**
 * Регресс: при недоступной БД каждый запрос заново подключался к ней.
 * У MongoAdapter это ~6 с на запрос — ответы опаздывали за лимит платформы
 * (Алиса — 3 с), и короткий сбой базы клал бота целиком. Теперь после
 * неудачи повторная попытка делается не раньше чем через паузу (5 → 60 с),
 * а запросы в это время обрабатываются без БД.
 */
import { Bot, BaseBotController, T_ALISA } from '../../src';
import { AlisaAdapter, FileAdapter } from '../../src/plugins';

class DownAdapter extends FileAdapter {
    public connectCalls = 0;
    public connectResult = false;
    public selectCalls = 0;

    connect(): boolean {
        this.connectCalls++;
        return this.connectResult;
    }

    _select(...args: Parameters<FileAdapter['_select']>): ReturnType<FileAdapter['_select']> {
        this.selectCalls++;
        return super._select(...args);
    }
}

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

describe('Bot: повторное подключение к недоступной БД', () => {
    let bot: Bot;
    let adapter: DownAdapter;
    let errors: string[];
    let now: number;

    beforeEach(() => {
        now = 1_000_000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        errors = [];
        bot = new Bot();
        bot.setLogger({ log: () => {}, error: (m) => errors.push(String(m)), warn: () => {} });
        adapter = new DownAdapter();
        bot.use(new AlisaAdapter()).use(adapter);
        bot.initBotController(BaseBotController);
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await bot.close();
    });

    it('во время паузы не переподключается и не ходит в БД', async () => {
        await bot.run(T_ALISA, request(1));
        await bot.run(T_ALISA, request(2));
        await bot.run(T_ALISA, request(3));
        expect(adapter.connectCalls).toBe(1);
        expect(adapter.selectCalls).toBe(0);
        expect(errors.some((e) => e.includes('следующая попытка подключения — через 5 с'))).toBe(
            true,
        );
    });

    it('после паузы пробует снова, пауза растёт', async () => {
        await bot.run(T_ALISA, request(1));
        now += 5001;
        await bot.run(T_ALISA, request(2));
        expect(adapter.connectCalls).toBe(2);
        expect(errors.some((e) => e.includes('через 10 с'))).toBe(true);
    });

    it('исключение при подключении не роняет параллельный запрос, ждущий то же подключение', async () => {
        let rejectConnect: (error: Error) => void = () => {};
        jest.spyOn(adapter, 'connect').mockImplementation(
            () =>
                new Promise<boolean>((_resolve, reject) => {
                    rejectConnect = reject;
                }),
        );
        const first = bot.run(T_ALISA, request(1));
        const second = bot.run(T_ALISA, request(2));
        // Даём обоим запросам дойти до ожидания подключения.
        await new Promise((resolve) => setImmediate(resolve));
        rejectConnect(new Error('ECONNREFUSED'));
        await expect(Promise.all([first, second])).resolves.toHaveLength(2);
        expect(adapter.selectCalls).toBe(0);
        expect(errors.some((e) => e.includes('ECONNREFUSED'))).toBe(true);
    });

    it('после восстановления БД запросы снова идут в базу', async () => {
        await bot.run(T_ALISA, request(1));
        adapter.connectResult = true;
        now += 5001;
        await bot.run(T_ALISA, request(2));
        await bot.run(T_ALISA, request(3));
        expect(adapter.connectCalls).toBe(2);
        expect(adapter.selectCalls).toBeGreaterThan(0);
    });
});
