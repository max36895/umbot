import { AppContext, BotController } from '../../../src';
import { clearVkUserCache, T_VK, VkAdapter, VkRequest } from '../../../src/plugins';

class TestVkController extends BotController {
    action(): void {
        return;
    }
}

describe('VkAdapter', () => {
    let appContext: AppContext;
    let controller: TestVkController;

    beforeEach(() => {
        // Адаптер кэширует ответы users.get в памяти процесса, поэтому между
        // тестами кэш нужно чистить, иначе один тест увидит данные другого.
        clearVkUserCache();
        appContext = new AppContext();
        appContext.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        appContext.appConfig.tokens[T_VK] = { token: 'test-token' };
        controller = new TestVkController(appContext);
        controller.userId = 12345;
        controller.text = 'Карточка';
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('keeps carousel template when global buttons are also initialized', async () => {
        const sendMessage = jest
            .spyOn(VkRequest.prototype, 'messagesSend')
            .mockResolvedValue({ message_id: 1 });

        controller.buttons.addBtn('Глобальная кнопка');
        controller.card.addImage('photo1_1', 'Первая', 'Описание', 'Открыть');
        controller.card.addImage('photo1_2', 'Вторая', 'Описание', 'Открыть');

        const adapter = new VkAdapter();
        adapter.init(appContext);

        await adapter.getContent(controller);

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith(
            12345,
            'Карточка',
            expect.objectContaining({
                template: expect.objectContaining({
                    type: 'carousel',
                }),
            }),
        );
        expect(sendMessage.mock.calls[0][2]?.keyboard).toBeUndefined();
    });

    it('без текста ответа подставляет в message заголовок карточки (VK требует текст у карусели)', async () => {
        const sendMessage = jest
            .spyOn(VkRequest.prototype, 'messagesSend')
            .mockResolvedValue({ message_id: 1 });
        controller.text = '';
        controller.card.title = 'Каталог';
        controller.card.addImage('photo1_1', 'Первая', 'Описание', 'Открыть');
        controller.card.addImage('photo1_2', 'Вторая', 'Описание', 'Открыть');

        const adapter = new VkAdapter();
        adapter.init(appContext);
        await adapter.getContent(controller);

        expect(sendMessage).toHaveBeenCalledWith(
            12345,
            'Каталог',
            expect.objectContaining({
                template: expect.objectContaining({ type: 'carousel' }),
            }),
        );
    });

    it('без заголовка карточки берёт заголовок первого элемента карусели', async () => {
        const sendMessage = jest
            .spyOn(VkRequest.prototype, 'messagesSend')
            .mockResolvedValue({ message_id: 1 });
        controller.text = '';
        controller.card.addImage('photo1_1', 'Первая', 'Описание', 'Открыть');
        controller.card.addImage('photo1_2', 'Вторая', 'Описание', 'Открыть');

        const adapter = new VkAdapter();
        adapter.init(appContext);
        await adapter.getContent(controller);

        expect(sendMessage.mock.calls[0][1]).toBe('Первая');
    });

    describe('isCorrectQuery', () => {
        it('returns true when secret_key is not configured', () => {
            const adapter = new VkAdapter();
            adapter.init(appContext);

            const result = adapter.isCorrectQuery({
                type: 'message_new',
                group_id: '1',
                secret: 'some-secret',
            });

            expect(result).toBe(true);
        });

        it('returns true when query.secret matches configured secret_key', () => {
            appContext.appConfig.tokens[T_VK]!.secret_key = 'my-secret';
            const adapter = new VkAdapter();
            adapter.init(appContext);

            const result = adapter.isCorrectQuery({
                type: 'message_new',
                group_id: '1',
                secret: 'my-secret',
            });

            expect(result).toBe(true);
        });

        it('returns false when query.secret does not match configured secret_key', () => {
            appContext.appConfig.tokens[T_VK]!.secret_key = 'my-secret';
            const adapter = new VkAdapter();
            adapter.init(appContext);

            const result = adapter.isCorrectQuery({
                type: 'message_new',
                group_id: '1',
                secret: 'wrong-secret',
            });

            expect(result).toBe(false);
        });

        it('validates the raw JSON body passed by the HTTP webhook handler', () => {
            appContext.appConfig.tokens[T_VK]!.secret_key = 'my-secret';
            const adapter = new VkAdapter();
            adapter.init(appContext);

            expect(
                adapter.isCorrectQuery(
                    JSON.stringify({ type: 'message_new', group_id: '1', secret: 'my-secret' }),
                ),
            ).toBe(true);
            expect(adapter.isCorrectQuery('{invalid-json')).toBe(false);
        });

        it('отклоняет confirmation без secret, когда secret_key настроен', () => {
            appContext.appConfig.tokens[T_VK]!.secret_key = 'my-secret';
            const adapter = new VkAdapter();
            adapter.init(appContext);

            const result = adapter.isCorrectQuery({
                type: 'confirmation',
                group_id: '1',
            });

            expect(result).toBe(false);
        });

        it('rejects a non-confirmation callback without configured secret in the body', () => {
            appContext.appConfig.tokens[T_VK]!.secret_key = 'my-secret';
            const adapter = new VkAdapter();
            adapter.init(appContext);

            expect(
                adapter.isCorrectQuery({
                    type: 'message_new',
                    group_id: '1',
                    object: { message: { from_id: 1, peer_id: 1, id: 1, text: 'hi' } },
                }),
            ).toBe(false);
        });
    });

    describe('getContent with message_event', () => {
        it('sends sendMessageEvent with show_snackbar when platformOptions.error is set', async () => {
            const sendMessageEvent = jest
                .spyOn(VkRequest.prototype, 'sendMessageEvent')
                .mockResolvedValue({});
            const sendMessage = jest
                .spyOn(VkRequest.prototype, 'messagesSend')
                .mockResolvedValue({ message_id: 1 });

            controller.platformOptions.eventId = 'event-123';
            controller.platformOptions.error = 'Произошла ошибка обработки';

            const adapter = new VkAdapter();
            adapter.init(appContext);

            await adapter.getContent(controller);

            expect(sendMessageEvent).toHaveBeenCalledTimes(1);
            expect(sendMessageEvent).toHaveBeenCalledWith(
                12345,
                'event-123',
                expect.objectContaining({
                    type: 'show_snackbar',
                    text: 'Произошла ошибка обработки',
                }),
                12345,
            );
            expect(sendMessage).not.toHaveBeenCalled();
        });

        it('sends simple sendMessageEvent when no error', async () => {
            const sendMessageEvent = jest
                .spyOn(VkRequest.prototype, 'sendMessageEvent')
                .mockResolvedValue({});
            const sendMessage = jest
                .spyOn(VkRequest.prototype, 'messagesSend')
                .mockResolvedValue({ message_id: 1 });

            controller.platformOptions.eventId = 'event-456';
            controller.text = 'Успешный ответ';

            const adapter = new VkAdapter();
            adapter.init(appContext);

            await adapter.getContent(controller);

            expect(sendMessageEvent).toHaveBeenCalledTimes(1);
            expect(sendMessageEvent).toHaveBeenCalledWith(12345, 'event-456', undefined, 12345);
            expect(sendMessage).toHaveBeenCalledTimes(1);
            expect(sendMessage).toHaveBeenCalledWith(12345, 'Успешный ответ', expect.any(Object));
        });
    });

    describe('setQueryData', () => {
        it('не считает произвольный x-vk-signature признаком VK Callback API', () => {
            const adapter = new VkAdapter();
            adapter.init(appContext);

            expect(adapter.isPlatformOnQuery({} as never, { 'x-vk-signature': 'fake' })).toBe(
                false,
            );
        });

        it('безопасно пропускает malformed message_new без object.message', async () => {
            const adapter = new VkAdapter();
            adapter.init(appContext);

            await expect(
                adapter.setQueryData(
                    { type: 'message_new', group_id: '1', object: {} as never },
                    controller,
                ),
            ).resolves.toBe(true);
            expect(controller.skipAutoReply).toBe(true);
        });

        it('отвечает токеном подтверждения из опций конструктора', async () => {
            const adapter = new VkAdapter('test-token', { vk_confirmation_token: 'confirm-123' });
            adapter.init(appContext);

            await expect(
                adapter.setQueryData({ type: 'confirmation', group_id: '1' }, controller),
            ).resolves.toBe(true);
            expect(controller.platformOptions.sendInInit).toBe('confirm-123');
        });

        it('отвечает токеном подтверждения из конфигурации (env VK_CONFIRMATION_TOKEN)', async () => {
            // Имитация настройки через .env/process.env: значение попадает в
            // tokens.vk.confirmation_token, опции конструктора не задаются
            // (типичный сценарий для fullPlatforms).
            appContext.appConfig.tokens[T_VK].confirmation_token = 'env-confirm-456';
            const adapter = new VkAdapter();
            adapter.init(appContext);

            await expect(
                adapter.setQueryData({ type: 'confirmation', group_id: '1' }, controller),
            ).resolves.toBe(true);
            expect(controller.platformOptions.sendInInit).toBe('env-confirm-456');
        });

        it('не падает при confirmation без настроенного токена', async () => {
            const adapter = new VkAdapter();
            adapter.init(appContext);

            await expect(
                adapter.setQueryData({ type: 'confirmation', group_id: '1' }, controller),
            ).resolves.toBe(true);
            expect(controller.platformOptions.sendInInit).toBeNull();
        });
        it('заполняет имя пользователя из массива users.get', async () => {
            // users.get всегда возвращает массив — адаптер должен взять первый элемент
            const usersGet = jest.spyOn(VkRequest.prototype, 'usersGet').mockResolvedValue([
                {
                    id: 12345,
                    first_name: 'Иван',
                    last_name: 'Петров',
                    is_closed: false,
                    can_access_closed: true,
                },
            ]);

            const adapter = new VkAdapter();
            adapter.init(appContext);

            const result = await adapter.setQueryData(
                {
                    type: 'message_new',
                    group_id: '1',
                    object: { message: { from_id: 12345, peer_id: 12345, id: 1, text: 'привет' } },
                },
                controller,
            );

            expect(result).toBe(true);
            expect(usersGet).toHaveBeenCalledWith(12345);
            const thisUser = controller.nlu.getUserName();
            expect(thisUser?.first_name).toBe('Иван');
            expect(thisUser?.last_name).toBe('Петров');
        });

        it('кнопка клавиатуры с payload {command} срабатывает как действие (addAction)', async () => {
            jest.spyOn(VkRequest.prototype, 'usersGet').mockResolvedValue([]);
            const adapter = new VkAdapter();
            adapter.init(appContext);

            await adapter.setQueryData(
                {
                    type: 'message_new',
                    group_id: '1',
                    object: {
                        message: {
                            from_id: 12345,
                            peer_id: 12345,
                            id: 1,
                            text: 'Купить',
                            payload: '{"command":"Buy"}',
                        },
                    },
                },
                controller,
            );

            expect(controller.userCommand).toBe('buy');
            expect(controller.originalUserCommand).toBe('Купить');
            expect(controller.payload).toEqual({ command: 'Buy' });
        });

        it('системная кнопка «Начать» ({"command":"start"}) остаётся текстом', async () => {
            jest.spyOn(VkRequest.prototype, 'usersGet').mockResolvedValue([]);
            const adapter = new VkAdapter();
            adapter.init(appContext);

            await adapter.setQueryData(
                {
                    type: 'message_new',
                    group_id: '1',
                    object: {
                        message: {
                            from_id: 12345,
                            peer_id: 12345,
                            id: 1,
                            text: 'Начать',
                            payload: '{"command":"start"}',
                        },
                    },
                },
                controller,
            );

            expect(controller.userCommand).toBe('начать');
        });

        it('не падает при пустом ответе users.get', async () => {
            jest.spyOn(VkRequest.prototype, 'usersGet').mockResolvedValue([]);

            const adapter = new VkAdapter();
            adapter.init(appContext);

            const result = await adapter.setQueryData(
                {
                    type: 'message_new',
                    group_id: '1',
                    object: { message: { from_id: 12345, peer_id: 12345, id: 1, text: 'привет' } },
                },
                controller,
            );

            expect(result).toBe(true);
            expect(controller.nlu.getUserName()).toBeNull();
        });

        it('не кэширует сбой users.get как «пользователь не найден»', async () => {
            // Регрессия: транзитивная ошибка VK API (usersGet -> null) кэшировалась
            // на час вместе с успешными ответами, и имя пользователя всё это время
            // оставалось null. Сбой кэшироваться не должен.
            const usersGet = jest
                .spyOn(VkRequest.prototype, 'usersGet')
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce([
                    {
                        id: 12345,
                        first_name: 'Иван',
                        last_name: 'Петров',
                        is_closed: false,
                        can_access_closed: true,
                    },
                ]);

            const adapter = new VkAdapter();
            adapter.init(appContext);
            const query = {
                type: 'message_new',
                group_id: '1',
                object: {
                    message: { from_id: 12345, peer_id: 12345, id: 1, text: 'привет' },
                },
            };

            await adapter.setQueryData(query, controller);
            expect(controller.nlu.getUserName()).toBeNull();

            // Второй запрос после восстановления API: имя обязано прийти из нового
            // запроса к VK, а не из негативного кэша.
            const secondController = new TestVkController(appContext);
            const result = await adapter.setQueryData(query, secondController);
            expect(result).toBe(true);
            expect(usersGet).toHaveBeenCalledTimes(2);
            expect(secondController.nlu.getUserName()?.first_name).toBe('Иван');
        });

        it('подтверждает message_event без payload статусом 200 вместо ошибки', async () => {
            // Битый callback нельзя обработать, но возврат false давал 400,
            // а VK Callback API повторяет событие при неудачном ответе.
            const adapter = new VkAdapter();
            adapter.init(appContext);

            const result = await adapter.setQueryData(
                { type: 'message_event', group_id: '1', object: { user_id: 12345 } },
                controller,
            );

            expect(result).toBe(true);
            expect(controller.skipAutoReply).toBe(true);
        });
    });

    it('не отправляет пустые attachment и keyboard после фильтрации', async () => {
        const sendMessage = jest
            .spyOn(VkRequest.prototype, 'messagesSend')
            .mockResolvedValue({ message_id: 1 });
        controller.card.addImage('/missing.jpg');
        jest.spyOn(controller.card, 'getCards').mockResolvedValue([]);
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        controller.buttons.addBtn('Невалидная', null, cyclic);
        const adapter = new VkAdapter();
        adapter.init(appContext);

        await adapter.getContent(controller);

        const params = sendMessage.mock.calls[0][2];
        expect(params?.attachments).toBeUndefined();
        expect(params?.keyboard).toBeUndefined();
    });

    describe('init', () => {
        it('stores vk_secret_key from platform options into tokens', () => {
            const adapter = new VkAdapter('test-token', {
                vk_secret_key: 'my-secret',
            });
            adapter.init(appContext);

            expect(appContext.appConfig.tokens[T_VK]?.secret_key).toBe('my-secret');
        });

        it('does not set secret_key when not provided', () => {
            const adapter = new VkAdapter('test-token');
            adapter.init(appContext);

            expect(appContext.appConfig.tokens[T_VK]?.secret_key).toBeUndefined();
        });
    });
});
