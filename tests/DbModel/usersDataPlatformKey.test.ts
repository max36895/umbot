/**
 * Регресс: userId уникален только в пределах платформы.
 *
 * Раньше UsersData искалась и обновлялась только по userId: пользователь
 * Telegram 42 и пользователь VK 42 (разные люди) делили одну запись userData —
 * мультиплатформенный бот с БД отдавал одному пользователю данные другого.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AppContext, Bot, BotController, IQuery } from '../../src';
import { FileAdapter, TelegramAdapter, VkAdapter } from '../../src/plugins';
import { createTestDir, removeTestDir } from '../helpers/tmpDir';

const noopLogger = { log: (): void => {}, error: (): void => {}, warn: (): void => {} };

class SecretController extends BotController {
    action(): void {
        if (this.userCommand === 'запомни') {
            this.userData.secret = `секрет ${this.appType}`;
            this.text = 'запомнил';
        } else {
            this.text = `вижу: ${(this.userData.secret as string | undefined) ?? 'пусто'}`;
        }
    }
}

const tgUpdate = (text: string): Record<string, unknown> => ({
    update_id: 1,
    message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text },
});
const vkUpdate = (text: string): Record<string, unknown> => ({
    type: 'message_new',
    group_id: 1,
    object: { message: { from_id: 42, peer_id: 42, id: 1, text } },
});

describe('UsersData: ключ записи — userId + platform', () => {
    let dir: string;
    let bot: Bot;
    let sentBodies: string[];

    beforeEach(() => {
        dir = createTestDir('userskey');
        sentBodies = [];
        bot = new Bot();
        bot.setLogger(noopLogger);
        bot.setAppConfig({
            json: dir,
            error_log: dir,
            tokens: { telegram: { token: '1:x' }, vk: { token: 'x' } },
        });
        bot.use(new TelegramAdapter())
            .use(new VkAdapter(undefined, { vk_load_user_info: false }))
            .use(new FileAdapter());
        bot.initBotController(SecretController);
        bot.getAppContext().httpClient = (async (_url: string, init?: RequestInit) => {
            sentBodies.push(String(init?.body ?? ''));
            return new Response(JSON.stringify({ ok: true, result: {}, response: 1 }), {
                status: 200,
            });
        }) as typeof fetch;
    });

    afterEach(async () => {
        await bot.close();
        await removeTestDir(dir);
    });

    it('пользователь VK 42 не видит данные пользователя Telegram 42', async () => {
        await bot.webhookEvent(JSON.stringify(tgUpdate('запомни')), {});
        sentBodies.length = 0;
        await bot.webhookEvent(JSON.stringify(vkUpdate('покажи')), {});
        const vkBody = decodeURIComponent(sentBodies.join('&')).replace(/\+/g, ' ');
        expect(vkBody).toContain('вижу: пусто');
        expect(vkBody).not.toContain('секрет telegram');
    });

    it('каждая платформа сохраняет и читает свою запись', async () => {
        await bot.webhookEvent(JSON.stringify(tgUpdate('запомни')), {});
        await bot.webhookEvent(JSON.stringify(vkUpdate('запомни')), {});
        sentBodies.length = 0;
        await bot.webhookEvent(JSON.stringify(tgUpdate('покажи')), {});
        expect(sentBodies.join('\n')).toContain('вижу: секрет telegram');
    });
});

describe('FileAdapter: составной ключ (IQuery.uniqueKeys)', () => {
    let dir: string;
    let adapter: FileAdapter;
    const query = (values: Record<string, unknown>): IQuery => ({
        query: values,
        data: null,
        tableName: 'UsersData',
        primaryKeyName: 'userId',
        uniqueKeys: ['platform'],
        rules: [],
    });

    beforeEach(() => {
        dir = createTestDir('userskey');
        const appContext = new AppContext();
        appContext.setLogger(noopLogger);
        appContext.appConfig.json = dir;
        adapter = new FileAdapter();
        adapter.init(appContext);
    });

    afterEach(async () => {
        await adapter.destroy();
        await removeTestDir(dir);
    });

    it('записи с одинаковым userId на разных платформах не перезаписывают друг друга', () => {
        adapter._insert({ ...query({}), data: { userId: '42', platform: 'telegram', data: 'tg' } });
        adapter._insert({ ...query({}), data: { userId: '42', platform: 'vk', data: 'vk' } });
        const tg = adapter._select(query({}), { userId: '42', platform: 'telegram' }, true);
        const vk = adapter._select(query({}), { userId: '42', platform: 'vk' }, true);
        expect((tg.data as Record<string, unknown>).data).toBe('tg');
        expect((vk.data as Record<string, unknown>).data).toBe('vk');
    });

    it('запись прежнего формата (ключ = userId) переносится под составной ключ', async () => {
        writeFileSync(
            join(dir, 'UsersData.json'),
            JSON.stringify({ '42': { userId: '42', platform: 'telegram', data: 'old' } }),
            'utf8',
        );
        const found = adapter._select(query({}), { userId: '42', platform: 'telegram' }, true);
        expect(found.status).toBe(true);
        expect((found.data as Record<string, unknown>).data).toBe('old');

        adapter._update({
            ...query({ userId: '42', platform: 'telegram' }),
            data: { data: 'new' },
        });
        await adapter.destroy();
        const saved = JSON.parse(readFileSync(join(dir, 'UsersData.json'), 'utf8'));
        expect(saved['42']).toBeUndefined();
        expect(saved['telegram:42'].data).toBe('new');
    });

    it('запись прежнего формата другой платформы не считается найденной', () => {
        writeFileSync(
            join(dir, 'UsersData.json'),
            JSON.stringify({ '42': { userId: '42', platform: 'telegram', data: 'tg' } }),
            'utf8',
        );
        const res = adapter._select(query({}), { userId: '42', platform: 'vk' }, true);
        expect(res.status).toBe(false);
    });

    it('без поля составного ключа в условии запись ищется перебором', () => {
        adapter._insert({ ...query({}), data: { userId: '42', platform: 'vk', data: 'vk' } });
        const res = adapter._select(query({}), { userId: '42' }, true);
        expect(res.status).toBe(true);
        expect((res.data as Record<string, unknown>).platform).toBe('vk');
    });

    it('удаление находит запись по составному ключу', () => {
        adapter._insert({ ...query({}), data: { userId: '42', platform: 'vk', data: 'vk' } });
        expect(adapter._remove(query({ userId: '42', platform: 'vk' }))).toBe(true);
        expect(adapter._select(query({}), { userId: '42', platform: 'vk' }, true).status).toBe(
            false,
        );
    });
});
