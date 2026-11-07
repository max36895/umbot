/**
 * Тесты предупреждения о хранилище SmartApp по умолчанию.
 *
 * Без явного `tokens.smart_app.storage_url` состояние пользователей пишется в
 * smartapp-code.sberdevices.ru — эндпоинт без авторизации и с жёстким rate limit.
 * Адаптер обязан предупредить об этом один раз при первом обращении к хранилищу.
 */
import { AppContext, BotController, Request } from '../../../src';
import { T_SMART_APP, SmartAppAdapter } from '../../../src/plugins';

class TestSmartAppController extends BotController {
    action(): void {
        return;
    }
}

function createContext(): { context: AppContext; warn: jest.Mock } {
    const context = new AppContext();
    const warn = jest.fn();
    context.setLogger({ log: () => {}, error: () => {}, warn });
    return { context, warn };
}

describe('SmartAppAdapter: предупреждение о дефолтном хранилище', () => {
    let sendSpy: jest.SpyInstance;

    beforeEach(() => {
        // Сеть заблокирована: обращение к хранилищу возвращает пустые данные.
        sendSpy = jest
            .spyOn(Request.prototype, 'send')
            .mockResolvedValue({ status: true, data: {}, err: undefined });
    });

    afterEach(() => {
        sendSpy.mockRestore();
    });

    it('без storage_url — warning один раз при обращении к хранилищу', async () => {
        const { context, warn } = createContext();
        const adapter = new SmartAppAdapter();
        adapter.init(context);

        const controller = new TestSmartAppController(context);
        controller.userId = 'user-1';
        await adapter.getLocalStorage(controller);
        await adapter.getLocalStorage(controller);

        const storageWarnings = warn.mock.calls.filter(([msg]) =>
            String(msg).includes('хранилище по умолчанию'),
        );
        expect(storageWarnings).toHaveLength(1);
        expect(String(storageWarnings[0][0])).toContain('storage_url');
    });

    it('с явным storage_url — молчание', async () => {
        const { context, warn } = createContext();
        context.appConfig.tokens[T_SMART_APP] = {
            storage_url: 'https://storage.example.com',
        };
        const adapter = new SmartAppAdapter();
        adapter.init(context);

        const controller = new TestSmartAppController(context);
        controller.userId = 'user-1';
        await adapter.getLocalStorage(controller);

        expect(
            warn.mock.calls.filter(([msg]) => String(msg).includes('хранилище по умолчанию')),
        ).toHaveLength(0);
    });
});
