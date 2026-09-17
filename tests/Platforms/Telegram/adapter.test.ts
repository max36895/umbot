import { AppContext, BotController } from '../../../src';
import { T_TELEGRAM, TelegramAdapter, TelegramRequest } from '../../../src/plugins';

class TestTelegramController extends BotController {
    action(): void {
        return;
    }
}

function makeTelegramMessage(
    overrides?: Partial<Record<string, unknown>>,
): Record<string, unknown> {
    return {
        update_id: 1,
        message: {
            message_id: 1,
            from: {
                id: 12345,
                is_bot: false,
                first_name: 'Test',
                username: 'testuser',
            },
            chat: {
                id: 12345,
                first_name: 'Test',
                username: 'testuser',
                type: 'private',
            },
            date: 1_000_000,
            text: 'Привет',
            ...overrides,
        },
    };
}

function makeCallbackQuery(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
    return {
        update_id: 2,
        callback_query: {
            id: 'callback-1',
            from: { id: 12345, is_bot: false, first_name: 'Test' },
            message: {
                message_id: 10,
                chat: { id: 12345, type: 'private' },
                text: 'Выберите опцию',
            },
            data: 'button_clicked',
            chat_instance: 'instance-1',
            ...overrides,
        },
    };
}

function makeInlineQuery(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
    return {
        update_id: 3,
        inline_query: {
            id: 'inline-1',
            from: { id: 12345, is_bot: false, first_name: 'Test' },
            query: 'search text',
            offset: '0',
            ...overrides,
        },
    };
}

function makeGroupMessage(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
    return {
        update_id: 5,
        message: {
            message_id: 30,
            from: { id: 12345, is_bot: false, first_name: 'Test', username: 'testuser' },
            chat: { id: -100987654321, type: 'supergroup', username: 'publicgroup' },
            date: 1_000_000,
            text: 'Привет',
            ...overrides,
        },
    };
}

function makeGroupCallbackQuery(
    overrides?: Partial<Record<string, unknown>>,
): Record<string, unknown> {
    return {
        update_id: 6,
        callback_query: {
            id: 'callback-group-1',
            from: { id: 12345, is_bot: false, first_name: 'Test' },
            message: {
                message_id: 31,
                chat: { id: -100987654321, type: 'supergroup' },
                text: 'Выберите опцию',
            },
            data: 'button_clicked',
            chat_instance: 'instance-group',
            ...overrides,
        },
    };
}

function makeChannelPost(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
    return {
        update_id: 4,
        channel_post: {
            message_id: 20,
            chat: { id: -1001234567890, type: 'channel' },
            text: 'Пост в канале',
            ...overrides,
        },
    };
}

describe('TelegramAdapter', () => {
    let appContext: AppContext;
    let controller: TestTelegramController;
    let adapter: TelegramAdapter;

    beforeEach(() => {
        appContext = new AppContext();
        appContext.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        // Без заглушки httpClient методы вроде answerCallbackQuery уходят в реальный
        // api.telegram.org: тест становится сетевым и упирается в таймаут (AGENTS.md §5).
        appContext.httpClient = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, result: {} }),
            text: async () => 'ok',
        }) as never;
        appContext.appConfig.tokens[T_TELEGRAM] = {
            token: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        };
        controller = new TestTelegramController(appContext);
        controller.userId = 12345;
        controller.text = 'Ответ от бота';
        adapter = new TelegramAdapter();
        adapter.init(appContext);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('init', () => {
        it('сохраняет переданный токен в конфиг приложения', () => {
            const adapterWithToken = new TelegramAdapter('my-custom-token');
            adapterWithToken.init(appContext);

            expect(appContext.appConfig.tokens[T_TELEGRAM]?.token).toBe('my-custom-token');
        });

        it('регистрирует адаптер в platforms по имени', () => {
            expect(appContext.platforms[T_TELEGRAM]).toBe(adapter);
        });
    });

    describe('isPlatformOnQuery', () => {
        it('определяет запрос по заголовку x-telegram-bot-api-secret-token', () => {
            const result = adapter.isPlatformOnQuery({} as never, {
                'x-telegram-bot-api-secret-token': 'some-secret',
            });
            expect(result).toBe(true);
        });

        it('определяет запрос по структуре update_id + message', () => {
            const query = makeTelegramMessage();
            expect(adapter.isPlatformOnQuery(query as never)).toBe(true);
        });

        it('определяет callback_query', () => {
            const query = makeCallbackQuery();
            expect(adapter.isPlatformOnQuery(query as never)).toBe(true);
        });

        it('определяет inline_query', () => {
            const query = makeInlineQuery();
            expect(adapter.isPlatformOnQuery(query as never)).toBe(true);
        });

        it('определяет channel_post', () => {
            const query = makeChannelPost();
            expect(adapter.isPlatformOnQuery(query as never)).toBe(true);
        });

        it('определяет edited_channel_post', () => {
            const query = { update_id: 1, edited_channel_post: makeChannelPost().channel_post };
            expect(adapter.isPlatformOnQuery(query as never)).toBe(true);
        });

        it('возвращает false для запроса от другой платформы', () => {
            const query = { version: '1.0', session: {}, request: {} };
            expect(adapter.isPlatformOnQuery(query as never)).toBe(false);
        });

        it('возвращает false для null/undefined запроса', () => {
            expect(adapter.isPlatformOnQuery(null as never)).toBe(false);
            expect(adapter.isPlatformOnQuery(undefined as never)).toBe(false);
        });
    });

    describe('isCorrectQuery', () => {
        it('пропускает проверку если webhookSecret не задан', () => {
            const result = adapter.isCorrectQuery({
                update_id: 1,
                message: { message_id: 1, chat: { id: 12345 }, text: 'hi' },
            } as never);
            expect(result).toBe(true);
        });

        it('возвращает true при совпадении webhookSecret', () => {
            appContext.appConfig.tokens[T_TELEGRAM]!.webhookSecret = 'my-secret';
            const result = adapter.isCorrectQuery('body' as never, {
                'x-telegram-bot-api-secret-token': 'my-secret',
            });
            expect(result).toBe(true);
        });

        it('возвращает false при несовпадении webhookSecret', () => {
            appContext.appConfig.tokens[T_TELEGRAM]!.webhookSecret = 'my-secret';
            const result = adapter.isCorrectQuery('body' as never, {
                'x-telegram-bot-api-secret-token': 'wrong-secret',
            });
            expect(result).toBe(false);
        });

        it('возвращает false при отсутствии заголовка с секретом', () => {
            appContext.appConfig.tokens[T_TELEGRAM]!.webhookSecret = 'my-secret';
            const result = adapter.isCorrectQuery('body' as never, {});
            expect(result).toBe(false);
        });
    });

    describe('setQueryData — обычное сообщение', () => {
        it('заполняет контроллер из текстового сообщения', async () => {
            const query = makeTelegramMessage();
            const result = await adapter.setQueryData(query as never, controller);

            expect(result).toBe(true);
            expect(controller.userId).toBe(12345);
            expect(controller.userCommand).toBe('привет');
            expect(controller.originalUserCommand).toBe('Привет');
            expect(controller.messageId).toBe(1);
            expect(controller.requestObject).toBe(query);
        });

        it('заполняет NLU (thisUser) из сообщения', async () => {
            const query = makeTelegramMessage();
            const nluSetSpy = jest.spyOn(controller.nlu, 'setNlu');

            await adapter.setQueryData(query as never, controller);

            expect(nluSetSpy).toHaveBeenCalledWith({
                thisUser: {
                    username: 'testuser',
                    first_name: 'Test',
                    last_name: null,
                },
            });
        });

        it('обрабатывает пустой текст сообщения', async () => {
            const query = makeTelegramMessage({ text: '' });
            await adapter.setQueryData(query as never, controller);

            expect(controller.userCommand).toBe('');
            expect(controller.originalUserCommand).toBe('');
        });
    });

    describe('setQueryData — сообщения в групповых чатах', () => {
        it('идентифицирует пользователя по from.id, а не по id группы', async () => {
            const query = makeGroupMessage();
            const result = await adapter.setQueryData(query as never, controller);

            expect(result).toBe(true);
            // userId — ключ данных пользователя в БД. В группе это должен быть
            // человек (from.id), а не ID самой группы.
            expect(controller.userId).toBe(12345);
        });

        it('даёт одинаковый userId для сообщения и callback_query одного человека в группе', async () => {
            const messageController = new TestTelegramController(appContext);
            await adapter.setQueryData(makeGroupMessage() as never, messageController);

            const callbackController = new TestTelegramController(appContext);
            await adapter.setQueryData(makeGroupCallbackQuery() as never, callbackController);

            // Иначе данные одного человека разваливаются на две записи в БД:
            // одна для сообщений (chat.id группы), другая для кнопок (from.id).
            expect(messageController.userId).toBe(callbackController.userId);
        });

        it('даёт одинаковый userId для сообщения и его редактирования в группе', async () => {
            const messageController = new TestTelegramController(appContext);
            await adapter.setQueryData(makeGroupMessage() as never, messageController);

            const editedController = new TestTelegramController(appContext);
            await adapter.setQueryData(
                {
                    update_id: 7,
                    edited_message: {
                        message_id: 30,
                        from: { id: 12345, is_bot: false, first_name: 'Test' },
                        chat: { id: -100987654321, type: 'supergroup' },
                        date: 1_000_000,
                        edit_date: 1_000_100,
                        text: 'Привет (исправлено)',
                    },
                } as never,
                editedController,
            );

            expect(editedController.userId).toBe(messageController.userId);
        });

        it('отправляет ответ на сообщение группы в групповой чат, а не в личку', async () => {
            const sendMessage = jest
                .spyOn(TelegramRequest.prototype, 'sendMessage')
                .mockResolvedValue({ ok: true, result: null });

            await adapter.setQueryData(makeGroupMessage() as never, controller);
            await adapter.getContent(controller);

            expect(sendMessage).toHaveBeenCalledWith(
                -100987654321,
                controller.text,
                expect.any(Object),
            );
        });

        it('заполняет NLU данными отправителя, а не чата', async () => {
            const query = makeGroupMessage();
            const nluSetSpy = jest.spyOn(controller.nlu, 'setNlu');

            await adapter.setQueryData(query as never, controller);

            expect(nluSetSpy).toHaveBeenCalledWith({
                thisUser: {
                    username: 'testuser',
                    first_name: 'Test',
                    last_name: null,
                },
            });
        });

        it('использует id чата, если отправитель не указан', async () => {
            const query = makeGroupMessage({ from: undefined });
            await adapter.setQueryData(query as never, controller);

            expect(controller.userId).toBe(-100987654321);
        });
    });

    describe('setQueryData — callback_query', () => {
        it('заполняет контроллер из callback_query', async () => {
            const query = makeCallbackQuery({ data: 'my_action' });
            const result = await adapter.setQueryData(query as never, controller);

            expect(result).toBe(true);
            expect(controller.userId).toBe(12345);
            expect(controller.userCommand).toBe('my_action');
            expect(controller.originalUserCommand).toBe('my_action');
            expect(controller.messageId).toBe(10);
            expect(controller.payload).toBe('my_action');
            expect(controller.platformOptions.requestData?.[T_TELEGRAM]?.callbackQueryId).toBe(
                'callback-1',
            );
        });

        it('парсит JSON-строку в payload', async () => {
            const query = makeCallbackQuery({
                data: JSON.stringify({ action: 'buy', id: 42 }),
            });
            await adapter.setQueryData(query as never, controller);

            expect(controller.payload).toEqual({ action: 'buy', id: 42 });
        });

        it('текстовая inline-кнопка с токеном: ввод = текст кнопки из клавиатуры сообщения', async () => {
            const long = 'Очень длинная надпись на кнопке больше лимита';
            const query = makeCallbackQuery({
                data: '#t1',
                message: {
                    message_id: 10,
                    chat: { id: 12345, type: 'private' },
                    text: 'Выберите',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Коротко', callback_data: 'Коротко' }],
                            [{ text: long, callback_data: '#t1' }],
                        ],
                    },
                },
            });
            await adapter.setQueryData(query as never, controller);

            expect(controller.userCommand).toBe(long.toLowerCase());
            expect(controller.originalUserCommand).toBe(long);
        });

        it('текстовая inline-кнопка с текстом в callback_data: ввод = текст кнопки', async () => {
            const query = makeCallbackQuery({ data: 'Квотный лом' });
            await adapter.setQueryData(query as never, controller);

            expect(controller.userCommand).toBe('квотный лом');
            expect(controller.originalUserCommand).toBe('Квотный лом');
        });

        it('нормализует команду в нижний регистр', async () => {
            const query = makeCallbackQuery({ data: 'Buy_Now' });
            await adapter.setQueryData(query as never, controller);

            expect(controller.userCommand).toBe('buy_now');
            expect(controller.originalUserCommand).toBe('Buy_Now');
        });

        it('отправляет ответ на callback в исходный групповой чат', async () => {
            const sendMessage = jest
                .spyOn(TelegramRequest.prototype, 'sendMessage')
                .mockResolvedValue({ ok: true, result: null });
            const query = makeCallbackQuery({
                from: { id: 12345, is_bot: false, first_name: 'Test' },
                message: {
                    message_id: 10,
                    chat: { id: -100987654321, type: 'supergroup' },
                    text: 'Выберите опцию',
                },
            });

            await adapter.setQueryData(query as never, controller);
            await adapter.getContent(controller);

            expect(controller.userId).toBe(12345);
            expect(sendMessage).toHaveBeenCalledWith(
                -100987654321,
                controller.text,
                expect.any(Object),
            );
        });
    });

    describe('setQueryData — chosen_inline_result', () => {
        it('подтверждает служебное событие без автоматического ответа', async () => {
            const result = await adapter.setQueryData(
                {
                    update_id: 2,
                    chosen_inline_result: {
                        result_id: 'umbot-response',
                        from: { id: 12345, is_bot: false, first_name: 'Test' },
                        query: 'Поиск',
                    },
                } as never,
                controller,
            );

            expect(result).toBe(true);
            expect(controller.skipAutoReply).toBe(true);
            expect(controller.userCommand).toBe('поиск');
        });
    });

    describe('setQueryData — channel_post', () => {
        it('заполняет контроллер из поста в канале', async () => {
            const query = makeChannelPost();
            const result = await adapter.setQueryData(query as never, controller);

            expect(result).toBe(true);
            expect(controller.userId).toBe(-1001234567890);
            expect(controller.userCommand).toBe('пост в канале');
            expect(controller.messageId).toBe(20);
        });
    });

    describe('setQueryData — inline_query', () => {
        it('заполняет контроллер из inline-запроса', async () => {
            const query = makeInlineQuery({ query: 'find something' });
            const result = await adapter.setQueryData(query as never, controller);

            expect(result).toBe(true);
            expect(controller.userId).toBe(12345);
            expect(controller.userCommand).toBe('find something');
            expect(controller.originalUserCommand).toBe('find something');
        });

        it('обрабатывает пустой inline-запрос', async () => {
            const query = makeInlineQuery({ query: '' });
            await adapter.setQueryData(query as never, controller);

            expect(controller.userCommand).toBe('');
            expect(controller.originalUserCommand).toBe('');
        });
    });

    describe('getContent', () => {
        it('возвращает строку "ok"', async () => {
            jest.spyOn(TelegramRequest.prototype, 'sendMessage').mockResolvedValue({
                ok: true,
                result: null,
            });

            const result = await adapter.getContent(controller);

            expect(result).toBe('ok');
        });

        it('отправляет текст без parse_mode по умолчанию', async () => {
            const sendMessage = jest
                .spyOn(TelegramRequest.prototype, 'sendMessage')
                .mockResolvedValue({ ok: true, result: null });

            await adapter.getContent(controller);

            expect(sendMessage).toHaveBeenCalledWith(
                12345,
                controller.text,
                expect.not.objectContaining({ parse_mode: expect.anything() }),
            );
        });

        it('использует кастомный parse_mode из platformOptions', async () => {
            const adapterWithOptions = new TelegramAdapter('token', {
                telegram_parse_mode: 'MarkdownV2',
            });
            adapterWithOptions.init(appContext);

            const sendMessage = jest
                .spyOn(TelegramRequest.prototype, 'sendMessage')
                .mockResolvedValue({ ok: true, result: null });

            await adapterWithOptions.getContent(controller);

            expect(sendMessage).toHaveBeenCalledWith(
                12345,
                controller.text,
                expect.objectContaining({
                    parse_mode: 'MarkdownV2',
                }),
            );
        });

        it('отправляет reply_markup при наличии кнопок', async () => {
            controller.buttons.addBtn('Нажми меня');
            jest.spyOn(TelegramRequest.prototype, 'sendMessage').mockResolvedValue({
                ok: true,
                result: null,
            });

            const sendMessage = jest
                .spyOn(TelegramRequest.prototype, 'sendMessage')
                .mockResolvedValue({ ok: true, result: null });

            await adapter.getContent(controller);

            expect(sendMessage).toHaveBeenCalledWith(
                12345,
                expect.any(String),
                expect.objectContaining({
                    reply_markup: expect.stringContaining('keyboard'),
                }),
            );
        });

        it('отправляет карточки через sendMediaGroup', async () => {
            controller.card.addImage('photo1', 'Первая');
            controller.card.addImage('photo2', 'Вторая');

            jest.spyOn(TelegramRequest.prototype, 'sendMessage').mockResolvedValue({
                ok: true,
                result: null,
            });
            jest.spyOn(TelegramRequest.prototype, 'sendMediaGroup').mockResolvedValue({
                ok: true,
                result: null,
            });

            const sendMediaGroup = jest
                .spyOn(TelegramRequest.prototype, 'sendMediaGroup')
                .mockResolvedValue({ ok: true, result: null });

            await adapter.getContent(controller);

            expect(sendMediaGroup).toHaveBeenCalled();
        });

        it('не отправляет пустой sendMessage перед карточкой', async () => {
            controller.text = '';
            controller.card.addImage('photo1', 'Первая');
            jest.spyOn(controller.card, 'getCards').mockResolvedValue(null);
            const sendMessage = jest
                .spyOn(TelegramRequest.prototype, 'sendMessage')
                .mockResolvedValue({ ok: true, result: null });

            await adapter.getContent(controller);

            expect(sendMessage).not.toHaveBeenCalled();
        });

        it('не придумывает текст для пустого inline-ответа', async () => {
            controller.text = '';
            const answerInlineQuery = jest
                .spyOn(TelegramRequest.prototype, 'answerInlineQuery')
                .mockResolvedValue({ ok: true, result: null });
            await adapter.setQueryData(makeInlineQuery() as never, controller);

            await adapter.getContent(controller);

            expect(answerInlineQuery).toHaveBeenCalledWith('inline-1', []);
        });

        it('не отправляет придуманную реплику при полностью пустом ответе', async () => {
            controller.text = '';
            const sendMessage = jest
                .spyOn(TelegramRequest.prototype, 'sendMessage')
                .mockResolvedValue({ ok: true, result: null });

            await adapter.getContent(controller);

            expect(sendMessage).not.toHaveBeenCalled();
        });

        it('не придумывает текст для отдельно заданной клавиатуры', async () => {
            controller.text = '';
            controller.buttons.addBtn('Явная кнопка');
            const sendMessage = jest
                .spyOn(TelegramRequest.prototype, 'sendMessage')
                .mockResolvedValue({ ok: true, result: null });

            await adapter.getContent(controller);

            expect(sendMessage).not.toHaveBeenCalled();
        });

        it('предупреждает, что remove() не сработал без текста', async () => {
            // Telegram не принимает сообщение без текста, поэтому снять клавиатуру
            // через buttons.remove() при пустом ответе нельзя — это должно быть
            // явно залогировано, а не пройти молча.
            const warn = jest.fn();
            appContext.setLogger({ log: () => {}, error: () => {}, warn });
            controller.text = '';
            controller.tts = '';
            controller.buttons.remove();
            jest.spyOn(TelegramRequest.prototype, 'sendMessage').mockResolvedValue({
                ok: true,
                result: null,
            });

            await adapter.getContent(controller);

            expect(warn).toHaveBeenCalledWith(
                expect.stringContaining('buttons.remove()'),
                undefined,
            );
        });

        it('не отправляет ничего при skipAutoReply = true', async () => {
            controller.skipAutoReply = true;

            jest.spyOn(TelegramRequest.prototype, 'sendMessage').mockResolvedValue({
                ok: true,
                result: null,
            });

            const result = await adapter.getContent(controller);

            expect(result).toBe('ok');
        });

        it('вызывает answerCallbackQuery при наличии callbackQueryId', async () => {
            jest.spyOn(TelegramRequest.prototype, 'sendMessage').mockResolvedValue({
                ok: true,
                result: null,
            });
            const answerCallbackQuery = jest
                .spyOn(TelegramRequest.prototype, 'answerCallbackQuery')
                .mockResolvedValue({ ok: true, result: null });

            controller.platformOptions.callbackQueryId = 'cb-id-123';

            await adapter.getContent(controller);

            expect(answerCallbackQuery).toHaveBeenCalledWith(
                'cb-id-123',
                undefined,
                false,
                undefined,
                0,
            );
        });

        it('показывает callback-уведомление только при явном тексте разработчика', async () => {
            jest.spyOn(TelegramRequest.prototype, 'sendMessage').mockResolvedValue({
                ok: true,
                result: null,
            });
            const answerCallbackQuery = jest
                .spyOn(TelegramRequest.prototype, 'answerCallbackQuery')
                .mockResolvedValue({ ok: true, result: null });
            controller.platformOptions.callbackQueryId = 'cb-id-123';
            controller.platformOptions.callbackNotificationText = 'Сохранено';

            await adapter.getContent(controller);

            expect(answerCallbackQuery).toHaveBeenCalledWith(
                'cb-id-123',
                'Сохранено',
                false,
                undefined,
                0,
            );
        });

        it('отправляет звуки через soundProcessing', async () => {
            const getSoundsMock = jest.spyOn(controller.sound, 'getSounds').mockResolvedValue('');

            jest.spyOn(TelegramRequest.prototype, 'sendMessage').mockResolvedValue({
                ok: true,
                result: null,
            });

            controller.sound.sounds = [{ key: '#test#', path: '', sounds: [] }];

            await adapter.getContent(controller);

            expect(getSoundsMock).toHaveBeenCalled();
        });
    });

    describe('getQueryExample', () => {
        it('генерирует пример запроса с текстом и userId', () => {
            const result = adapter.getQueryExample('тест', '42', 5);
            expect(result).toEqual({
                // update_id обязателен: isPlatformOnQuery распознаёт Telegram по этому полю
                update_id: 5,
                message: {
                    chat: {
                        id: 42,
                    },
                    text: 'тест',
                    message_id: 5,
                },
            });
        });
    });

    describe('isVoice', () => {
        it('всегда возвращает false', () => {
            expect(TelegramAdapter.isVoice()).toBe(false);
            expect(adapter.isVoice).toBe(false);
        });
    });

    describe('limit', () => {
        it('имеет лимит 30 запросов в секунду', () => {
            expect(adapter.limit).toBe(30);
        });
    });
});
