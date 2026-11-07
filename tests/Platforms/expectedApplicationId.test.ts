/**
 * Тесты opt-in проверки ожидаемого идентификатора навыка/приложения:
 * `alisa_skill_id` у Алисы, `smartapp_application_id` у SmartApp. При заданной
 * опции запросы с чужим идентификатором отклоняются isCorrectQuery → 401.
 * Это фильтр чужого трафика на URL (другой навык, опечатка роутинга), а не
 * подпись: платформы не подписывают вебхуки, весь payload контролирует отправитель.
 */
import { Bot, BotController } from '../../src';
import { AlisaAdapter, SmartAppAdapter } from '../../src/plugins';

class SilentController extends BotController {
    action(): void {
        this.skipAutoReply = true;
    }
}

function createBot(adapter: AlisaAdapter | SmartAppAdapter): Bot {
    const bot = new Bot();
    bot.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
    bot.use(adapter);
    bot.setAppConfig({ isLocalStorage: true });
    bot.initBotController(SilentController);
    return bot;
}

const alisaRequest = (skillId: string): Record<string, unknown> => ({
    meta: { locale: 'ru-RU', client_id: 'c' },
    request: { type: 'SimpleUtterance', command: 'привет', original_utterance: 'привет' },
    session: { message_id: 1, session_id: 's', skill_id: skillId, user_id: 'u1', new: false },
    version: '1.0',
});

const smartAppRequest = (applicationId: string): Record<string, unknown> => ({
    messageName: 'MESSAGE_TO_SKILL',
    sessionId: 'session-1',
    messageId: 1,
    uuid: { sub: 'sub-1', userId: 'user-1' },
    payload: {
        app_info: { applicationId, projectId: 'project-1' },
        device: {},
        character: {},
        intent: '',
    },
});

describe('AlisaAdapter: опция alisa_skill_id', () => {
    it('свой skill_id проходит, чужой — отклоняется', () => {
        const adapter = new AlisaAdapter('token', { alisa_skill_id: 'my-skill' } as never);
        const own = JSON.stringify(alisaRequest('my-skill'));
        const foreign = JSON.stringify(alisaRequest('other-skill'));
        expect(adapter.isCorrectQuery(own, {}, JSON.parse(own))).toBe(true);
        expect(adapter.isCorrectQuery(foreign, {}, JSON.parse(foreign))).toBe(false);
        // Запрос без session (обрезанный payload) не проходит проверку
        expect(adapter.isCorrectQuery('{"meta":{}}', {}, { meta: {} })).toBe(false);
    });

    it('без опции проверка не включена — любой skill_id проходит', () => {
        const adapter = new AlisaAdapter('token');
        const body = JSON.stringify(alisaRequest('любой-навык'));
        expect(adapter.isCorrectQuery(body, {}, JSON.parse(body))).toBe(true);
    });

    it('через webhookEvent чужой skill_id даёт 401 и не доходит до контроллера', async () => {
        const bot = createBot(new AlisaAdapter('token', { alisa_skill_id: 'my-skill' } as never));
        const res = await bot.webhookEvent(JSON.stringify(alisaRequest('other-skill')), {});
        expect(res.statusCode).toBe(401);
        // Свой skill_id обрабатывается штатно
        const ok = await bot.webhookEvent(JSON.stringify(alisaRequest('my-skill')), {});
        expect(ok.statusCode).toBe(200);
        await bot.close();
    });
});

describe('SmartAppAdapter: опция smartapp_application_id', () => {
    it('свой applicationId проходит, чужой — отклоняется', () => {
        const adapter = new SmartAppAdapter('token', {
            smartapp_application_id: 'my-app',
        } as never);
        const own = JSON.stringify(smartAppRequest('my-app'));
        const foreign = JSON.stringify(smartAppRequest('other-app'));
        expect(adapter.isCorrectQuery(own, {}, JSON.parse(own))).toBe(true);
        expect(adapter.isCorrectQuery(foreign, {}, JSON.parse(foreign))).toBe(false);
    });

    it('без опции проверка не включена', () => {
        const adapter = new SmartAppAdapter('token');
        const body = JSON.stringify(smartAppRequest('любой-смартап'));
        expect(adapter.isCorrectQuery(body, {}, JSON.parse(body))).toBe(true);
    });

    it('через webhookEvent чужой applicationId даёт 401', async () => {
        const bot = createBot(
            new SmartAppAdapter('token', { smartapp_application_id: 'my-app' } as never),
        );
        const res = await bot.webhookEvent(JSON.stringify(smartAppRequest('other-app')), {});
        expect(res.statusCode).toBe(401);
        await bot.close();
    });
});
