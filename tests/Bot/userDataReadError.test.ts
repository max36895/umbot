/**
 * Ошибка чтения userData из БД не должна превращать пользователя в нового:
 * иначе запрос с пустыми данными вставлял бы дубль записи (или затирал её).
 */
import { Bot, BotController, IModelRes, T_ALISA } from '../../src';
import { AlisaAdapter, FileAdapter } from '../../src/plugins';
import { createTestDir, removeTestDir } from '../helpers/tmpDir';

class FlakyAdapter extends FileAdapter {
    public failSelect = false;
    public writes = 0;

    _select(...args: Parameters<FileAdapter['_select']>): IModelRes {
        if (this.failSelect) {
            return { status: false, error: 'timeout' };
        }
        return super._select(...args);
    }

    _insert(...args: Parameters<FileAdapter['_insert']>): ReturnType<FileAdapter['_insert']> {
        this.writes++;
        return super._insert(...args);
    }

    _update(...args: Parameters<FileAdapter['_update']>): ReturnType<FileAdapter['_update']> {
        this.writes++;
        return super._update(...args);
    }
}

class CounterController extends BotController {
    action(): void {
        const counter = ((this.userData.counter as number | undefined) ?? 0) + 1;
        this.userData.counter = counter;
        this.text = `counter=${counter}`;
    }
}

const request = (messageId: number): string =>
    JSON.stringify({
        meta: {
            locale: 'ru-RU',
            timezone: 'UTC',
            client_id: 'yandex.searchplugin',
            interfaces: {},
        },
        session: {
            message_id: messageId,
            session_id: 's',
            skill_id: 'k',
            user_id: 'user-1',
            new: false,
        },
        request: { command: 'ещё', original_utterance: 'ещё', type: 'SimpleUtterance' },
        version: '1.0',
    });

describe('Bot: ошибка чтения userData из БД', () => {
    let dir: string;
    let bot: Bot;
    let adapter: FlakyAdapter;
    let errors: string[];

    beforeEach(() => {
        dir = createTestDir('user-data-read-error');
        errors = [];
        bot = new Bot();
        bot.setLogger({ log: () => {}, error: (m) => errors.push(String(m)), warn: () => {} });
        bot.setAppConfig({ json: dir, isLocalStorage: false });
        adapter = new FlakyAdapter();
        bot.use(new AlisaAdapter()).use(adapter);
        bot.initBotController(CounterController);
    });

    afterEach(async () => {
        await bot.close();
        await removeTestDir(dir);
    });

    it('запрос отвечает, но не сохраняет пустые userData поверх существующих', async () => {
        await bot.run(T_ALISA, request(1));
        await bot.run(T_ALISA, request(2));
        const writesBefore = adapter.writes;

        adapter.failSelect = true;
        const failed = JSON.stringify(await bot.run(T_ALISA, request(3)));
        expect(failed).toContain('counter=1');
        expect(adapter.writes).toBe(writesBefore);
        expect(errors.some((e) => e.includes('Не удалось загрузить данные пользователя'))).toBe(
            true,
        );

        // После сбоя данные на месте: счётчик продолжается с сохранённого значения
        adapter.failSelect = false;
        expect(JSON.stringify(await bot.run(T_ALISA, request(4)))).toContain('counter=3');
    });
});
