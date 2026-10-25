/**
 * VkSound.getSoundInDB: адресат загрузки голосового сообщения.
 *
 * Протактивная отправка (bot.send) подставляет получателя в controller.userId и
 * ставит isProactive: загрузка docs.getMessagesUploadServer обязана идти от него,
 * а не от peer_id чата входящего запроса, чей контроллер переиспользовали.
 */
import { BotController } from '../../../src';
import { T_VK, VkRequest, VkSound } from '../../../src/plugins';
import { getPlatformRequestData } from '../../../src/plugins/platforms/Base/utils';

class TestController extends BotController {
    action(): void {
        return;
    }
}

describe('VkSound', () => {
    let controller: TestController;

    beforeEach(() => {
        const appContext = new (jest.requireActual('../../../src').AppContext)();
        appContext.appConfig.tokens[T_VK] = { token: 'test-token' };
        appContext.setLogger({ log: () => {}, warn: () => {}, error: () => {} });
        controller = new TestController(appContext);
        controller.userId = 99;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('getSoundInDB', () => {
        it('протактивная отправка: загрузка голосового идёт от адресата send()', async () => {
            getPlatformRequestData<{ peerId?: number }>(controller, T_VK).peerId = 4242;
            const docsGet = jest
                .spyOn(VkRequest.prototype, 'docsGetMessagesUploadServer')
                .mockResolvedValue({});

            controller.platformOptions.isProactive = true;
            await VkSound.getSoundInDB(controller, '/voice.ogg');
            expect(docsGet).toHaveBeenCalledWith(99, 'audio_message');

            // Ответ на входящий запрос — загрузка в чат запроса (прежнее поведение)
            delete controller.platformOptions.isProactive;
            await VkSound.getSoundInDB(controller, '/voice2.ogg');
            expect(docsGet).toHaveBeenLastCalledWith(4242, 'audio_message');
        });
    });
});
