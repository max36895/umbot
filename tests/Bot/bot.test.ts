import {
    AppContext,
    Bot,
    BotController,
    FALLBACK_COMMAND,
    IPlatformData,
    IUserData,
    unlinkSync,
    UsersData,
} from '../../src';
import {
    T_ALISA,
    AlisaAdapter,
    FileAdapter,
    IAlisaWebhookResponse,
    voicePlatforms,
    TelegramAdapter,
    TelegramRequest,
    SmartAppAdapter,
    T_SMART_APP,
    VkAdapter,
} from '../../src/plugins';
import { Server } from 'http';
import { join } from 'node:path';
import { __$usedRe2 } from '../../src/utils/standard/RegExp';
import { createTestDir, removeTestDir } from '../helpers/tmpDir';

class MyReg extends RegExp {
    constructor(parent: RegExp | string, flags: string) {
        super(parent, flags);
        MyReg.created++;
    }

    exec(string: string): RegExpExecArray | null {
        MyReg.used++;
        return super.exec(string);
    }

    static created = 0;
    static used = 0;
}

class TestBotController extends BotController {
    constructor(appContext: AppContext) {
        super(appContext);
    }

    action(intentName: string | null, isCommand?: boolean, isStep?: boolean): void {
        if (isCommand) {
            this.userData.cool = true;
            return;
        }
        if (isStep) {
            return;
        }
        if (intentName === 'btn') {
            this.buttons.addBtn('1');
            this.tts = 'btn';
        } else if (intentName === 'card') {
            this.card.addImage('', 'Header');
            this.tts = 'card';
        } else if (intentName === 'setStore') {
            this.state = {
                data: 'test',
            };
            this.text = 'test';
            return;
        }
        this.text = 'test';
        if (this.userCommand === 'привет') {
            this.text = 'Привет!';
        }
        if (this.userCommand === 'пока') {
            this.text = 'Пока!';
        }
    }
}

class TestBot extends Bot {}

function getContent(query: string, count = 0, state: object = {}): string {
    return JSON.stringify({
        meta: {
            locale: 'ru-Ru',
            timezone: 'UTC',
            client_id: 'yandex.searchplugin_local',
            interfaces: {
                payments: null,
                account_linking: null,
                screen: true,
            },
        },
        session: {
            message_id: count,
            session_id: 'local',
            skill_id: 'local_test',
            user_id: 'test',
            new: count === 0,
        },
        request: {
            command: query.toLowerCase(),
            original_utterance: query,
            nlu: {},
            type: 'SimpleUtterance',
        },
        state: {
            session: state,
        },
        version: '1.0',
    });
}

let saveSpy: ReturnType<typeof jest.spyOn>;
let updateSpy: ReturnType<typeof jest.spyOn>;
describe('Bot', () => {
    let bot: TestBot;

    // Токены из process.env теперь тихо подхватываются даже без настроенного env,
    // поэтому изолируем тесты от реального окружения машины.
    const ENV_KEYS = [
        'VIBER_TOKEN',
        'TELEGRAM_TOKEN',
        'VK_TOKEN',
        'MAX_TOKEN',
        'VK_CONFIRMATION_TOKEN',
        'VK_SECRET_KEY',
        'MARUSIA_TOKEN',
        'ALISA_TOKEN',
        'YANDEX_TOKEN',
        'SPEECH_KIT_TOKEN',
        'DB_HOST',
        'DB_USER',
        'DB_PASSWORD',
        'DB_NAME',
    ];
    const savedEnv: Record<string, string | undefined> = {};
    // Дефолтные пути записи (json/, logs/) указывают в cwd — в корень репозитория.
    // Перенаправляем их в тестовую папку (tests/.tmp), чтобы прогон не оставлял
    // артефактов в репо; путь известен и не теряется, как в os.tmpdir().
    const TEST_DATA_DIR = createTestDir('bot');
    beforeAll(() => {
        ENV_KEYS.forEach((key) => {
            savedEnv[key] = process.env[key];
            delete process.env[key];
        });
    });
    afterAll(async () => {
        ENV_KEYS.forEach((key) => {
            if (savedEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = savedEnv[key];
            }
        });
        await removeTestDir(TEST_DATA_DIR);
    });

    beforeEach(() => {
        bot = new TestBot();
        bot.setAppConfig({ json: TEST_DATA_DIR, error_log: TEST_DATA_DIR });
        bot.setLogger({
            error: () => {},
        });
        bot.use(new FileAdapter());
        saveSpy = jest.spyOn(UsersData.prototype, 'save').mockResolvedValue(Promise.resolve(true));
        updateSpy = jest
            .spyOn(UsersData.prototype, 'update')
            .mockResolvedValue(Promise.resolve(true));
    });

    afterEach(async () => {
        jest.resetAllMocks();
        // Тесты describe('setAppConfig') подменяют json/error_log собственными
        // путями; возвращаем их во временную папку ДО close(), иначе destroy()
        // FileAdapter флашит таблицы по этому пути за пределы репозитория.
        bot.getAppContext().appConfig.json = TEST_DATA_DIR;
        bot.getAppContext().appConfig.error_log = TEST_DATA_DIR;
        await bot.close();
        bot.clearCommands();
        unlinkSync(join(bot.getAppContext().appConfig.json, 'UsersData.json'));
    });

    describe('setPlatformParams', () => {
        it('should set config if config is provided', () => {
            const params = { intents: [{ name: 'greeting', slots: ['привет', 'здравствуйте'] }] };
            bot.setPlatformParams(params);
            expect(bot.getAppContext().platformParams).toEqual({
                ...params,
                utm_text: null,
                welcome_text: 'Текст приветствия',
                isAuthUser: false,
                help_text: 'Текст помощи',
                empty_text: 'Извините, но я вас не понимаю',
            });
        });
    });

    describe('setAppConfig', () => {
        it('should set params if params are provided', () => {
            const config = {
                isLocalStorage: true,
                error_log: './logs',
                json: '/../json',
                tokens: {},
                env: '',
            };
            bot.setAppConfig(config);
            expect(bot.getAppContext().appConfig).toEqual({
                ...config,
                json: '/../json',
                db: {
                    database: '',
                    host: '',
                    pass: '',
                    user: '',
                },
                tokens: {},
            });
        });
    });

    describe('run', () => {
        it('should throw error for empty request', async () => {
            bot.setLogger({
                error: () => {},
                warn: () => {},
            });
            await expect(bot.run()).rejects.toThrow(
                'Пришел не корректный запрос в котором передано пустое содержимое, дальнейшая обработка невозможна.',
            );
        });

        it('should return result if botClass is set and init is successful', async () => {
            bot.initBotController(TestBotController);
            const result = {
                version: '1.0',
                response: {
                    buttons: [],
                    tts: 'Привет!',
                    text: 'Привет!',
                    end_session: false,
                },
            };
            jest.spyOn(AlisaAdapter.prototype, 'getRatingContext').mockResolvedValue(result);

            bot.use(new AlisaAdapter());

            expect(await bot.run(T_ALISA, getContent('Привет'))).toEqual(result);
            jest.resetAllMocks();
        });

        it('should throw error if botClass is set and init is unsuccessful', async () => {
            bot.initBotController(TestBotController);
            const error =
                'Для платформы "alisa" передано пустое содержимое, дальнейшая обработка невозможна.';
            bot.setLogger({
                error: (_: string) => {},
                warn: () => {},
            });
            bot.use(new AlisaAdapter());
            await expect(bot.run(T_ALISA, '')).rejects.toThrow(error);
        });

        it('обрезает userCommand до 7000 символов, но сохраняет originalUserCommand', async () => {
            bot.initBotController(TestBotController);
            bot.setLogger({
                error: () => {},
                warn: () => {},
            });
            bot.use(new AlisaAdapter());

            const longText = 'а'.repeat(20000);
            // Снимаем контроллер через middleware: в него ядро кладёт уже
            // обрезанный userCommand.
            let seenUserCommand = '';
            let seenOriginal = '';
            bot.use((controller: TestBotController, next) => {
                seenUserCommand = controller.userCommand ?? '';
                seenOriginal = controller.originalUserCommand ?? '';
                return next();
            });

            await bot.run(T_ALISA, getContent(longText));
            expect(seenUserCommand.length).toBe(7000);
            expect(seenOriginal.length).toBe(20000);
            jest.resetAllMocks();
        });

        it('added user command', async () => {
            bot.initBotController(TestBotController);
            bot.addCommand('cool', ['cool'], (_, botC) => {
                botC.text = 'cool';
                botC.userData.cool = true;
            });
            let botController: TestBotController = new TestBotController(bot.getAppContext());
            bot.use((controller: TestBotController, next) => {
                botController = controller;
                return next();
            });

            bot.use(new AlisaAdapter());
            let res = (await bot.run(T_ALISA, getContent('cool', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            expect(botController.userData.cool).toBe(true);

            bot.removeCommand('cool');
            res = (await bot.run(T_ALISA, getContent('cool', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('test');
        });

        it('set thisIntentName', async () => {
            bot.setAppConfig({
                isLocalStorage: true,
            });
            bot.initBotController(TestBotController);
            bot.addCommand('test', ['test1'], (_, bc) => {
                bc.text = 'test1';
                bc.thisIntentName = 'test1';
                bc.userData.start = { test: 1 };
                bc.userData.end = '512';
            });
            bot.addCommand('test2', ['test2'], (_, bc) => {
                bc.text = 'test2';
                bc.thisIntentName = 'test2';
                bc.userData.start = { test: 2 };
                bc.userData.end = '2';
            });
            bot.addCommand('clear', ['clear'], (_, bc) => {
                bc.text = 'clear';
                bc.thisIntentName = null;
                bc.userData.start = null;
                bc.userData.end = null;
            });

            bot.use(new AlisaAdapter());
            let res = (await bot.run(T_ALISA, getContent('test1', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('test1');
            expect((res.session_state as Record<string, string>).oldIntentName).toBe('test1');

            res = (await bot.run(
                T_ALISA,
                getContent('test2', 2, res.session_state as object),
            )) as IAlisaWebhookResponse;
            expect((res.session_state as Record<string, string>).oldIntentName).toBe('test2');

            res = (await bot.run(
                T_ALISA,
                getContent('clear', 2, res.session_state as object),
            )) as IAlisaWebhookResponse;
            expect((res.session_state as Record<string, string>).oldIntentName).toBe(null);

            res = (await bot.run(
                T_ALISA,
                getContent('test2', 2, res.session_state as object),
            )) as IAlisaWebhookResponse;
            expect((res.session_state as Record<string, string>).oldIntentName).toBe('test2');
            bot.clearCommands();
        });

        it('added user step', async () => {
            bot.setAppConfig({
                isLocalStorage: true,
            });
            bot.initBotController(TestBotController);
            bot.addCommand('cool', ['cool'], (_, botC) => {
                botC.text = 'cool';
                botC.userData.cool = true;
                botC.thisIntentName = 'cool_step';
            });
            bot.addStep('cool_step', (botC) => {
                botC.text = 'coolStep';
                botC.userData.coolStep = true;
                if (botC.userCommand === 'cool2') {
                    botC.thisIntentName = null;
                } else {
                    botC.thisIntentName = 'cool_step';
                }
            });

            bot.use(new AlisaAdapter());
            let res = (await bot.run(T_ALISA, getContent('cool', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');

            res = (await bot.run(
                T_ALISA,
                getContent('cool', 2, {
                    oldIntentName: 'cool_step',
                }),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('coolStep');

            res = (await bot.run(
                T_ALISA,
                getContent('cool2', 2, res.session_state as object),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('coolStep');
            res = (await bot.run(
                T_ALISA,
                getContent('c00l2', 2, res.session_state as object),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('test');
            bot.removeStep('cool_step');

            res = (await bot.run(
                T_ALISA,
                getContent('cool', 2, res.session_state as object),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            // Убеждаемся что не попали в шаг после удаления
            res = (await bot.run(
                T_ALISA,
                getContent('c00l', 2, res.session_state as object),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('test');
            bot.removeCommand('cool');

            // Просто на всякий случай
            bot.clearSteps();
            bot.clearCommands();
        });

        it('cansel step', async () => {
            bot.setAppConfig({
                isLocalStorage: true,
            });
            bot.initBotController(TestBotController);
            bot.addCommand('step', ['step'], (_, bc) => {
                bc.text = 'start step';
                bc.thisIntentName = 'my_step';
            });
            bot.addStep('my_step', (bc) => {
                // Если первое сообщение, то шаги игнорируем
                if (bc.messageId === 0) {
                    return false;
                }
                bc.text = 'step';
                bc.thisIntentName = 'my_step';
            });
            bot.use(new AlisaAdapter());
            let res = (await bot.run(T_ALISA, getContent('step', 1))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('start step');
            res = (await bot.run(
                T_ALISA,
                getContent('step', 2, res.session_state as object),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('step');
            res = (await bot.run(
                T_ALISA,
                getContent('step', 3, res.session_state as object),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('step');
            res = (await bot.run(
                T_ALISA,
                getContent('step', 0, res.session_state as object),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('start step');
            bot.clearSteps();
            bot.clearCommands();
        });

        it('addForm проходит полный цикл до onComplete', async () => {
            const tBot = new TestBot();
            tBot.setAppConfig({
                isLocalStorage: true,
            });
            tBot.initBotController(TestBotController);

            let completedPayload: Record<string, string> | null = null;

            // Стартовая команда запускает форму
            tBot.addCommand('regForm', ['формы'], (_, bc) => {
                bc.text = 'Как вас зовут?';
                bc.thisIntentName = '__form_onboarding_0';
            });

            tBot.addForm('onboarding', {
                fields: [
                    {
                        name: 'name',
                        prompt: 'Как вас зовут?',
                        validate: (v): boolean => v.length > 0,
                    },
                    {
                        name: 'email',
                        prompt: 'Ваш email?',
                        validate: (v): string | boolean =>
                            /\S+@\S+/.test(v) || 'Некорректный email',
                    },
                ],
                onComplete: (ctx, answers) => {
                    completedPayload = answers;
                    ctx.text = `Готово, ${answers.name}!`;
                },
            });
            tBot.use(new AlisaAdapter());

            // Запускаем форму
            let res = (await tBot.run(T_ALISA, getContent('формы', 1))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('Как вас зовут?');

            // Валидный ответ на первый вопрос → переход на второй
            res = (await tBot.run(
                T_ALISA,
                getContent('Иван', 2, res.session_state as object),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('Ваш email?');

            // Невалидный email → ошибка + повторный prompt
            res = (await tBot.run(
                T_ALISA,
                getContent('не-email', 3, res.session_state as object),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('Некорректный email\nВаш email?');

            // Валидный email → onComplete
            res = (await tBot.run(
                T_ALISA,
                getContent('ivan@test.ru', 4, res.session_state as object),
            )) as IAlisaWebhookResponse;
            // Ответы формы сохраняются в исходном регистре (originalUserCommand),
            // а не в нижнем, в который адаптер нормализует userCommand.
            expect(res.response?.text).toBe('Готово, Иван!');
            expect(completedPayload).toEqual({ name: 'Иван', email: 'ivan@test.ru' });
        });

        it('addForm корректно отменяется командой', async () => {
            const tBot = new TestBot();
            tBot.setAppConfig({ isLocalStorage: true });
            tBot.initBotController(TestBotController);

            let completed = false;

            tBot.addCommand('signForm', ['signup'], (_, bc) => {
                bc.text = 'Начался опрос';
                bc.thisIntentName = '__form_signup_0';
            });
            tBot.addForm('signup', {
                fields: [
                    { name: 'q1', prompt: 'Первый вопрос?', validate: (): boolean => true },
                    { name: 'q2', prompt: 'Второй?', validate: (): boolean => true },
                ],
                onComplete: (ctx) => {
                    completed = true;
                    ctx.text = 'complete';
                },
                cancelText: 'Опрос отменён',
                cancelCommands: ['отмена'],
            });
            tBot.use(new AlisaAdapter());

            let res = (await tBot.run(T_ALISA, getContent('signup', 1))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('Начался опрос');

            // Пользователь пишет "отмена"
            res = (await tBot.run(
                T_ALISA,
                getContent('отмена', 2, res.session_state as object),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('Опрос отменён');
            expect(completed).toBe(false);
        });

        it('local store', async () => {
            const tBot = new TestBot();
            tBot.initBotController(TestBotController);
            tBot.setPlatformParams({
                intents: [{ name: 'setStore', slots: ['сохранить'] }],
            });
            tBot.setAppConfig({ isLocalStorage: true });
            tBot.use(new AlisaAdapter());
            const res = (await tBot.run(
                T_ALISA,
                getContent('сохранить', 2),
            )) as IAlisaWebhookResponse;
            expect(res.session_state).toEqual({ data: 'test' });
        });

        it('skill started', async () => {
            bot.initBotController(TestBotController);
            bot.use(new AlisaAdapter());
            bot.setPlatformParams({
                intents: [
                    { name: 'btn', slots: ['кнопка'] },
                    { name: 'card', slots: ['карточка'] },
                ],
            });
            bot.setAppConfig({ isLocalStorage: true });

            expect(await bot.run(T_ALISA, getContent('test'))).toEqual({
                response: {
                    end_session: false,
                    buttons: [],
                    text: 'test',
                    tts: 'test',
                },
                session_state: {},
                version: '1.0',
            });
            bot.setAppConfig({ isLocalStorage: false });

            expect(await bot.run(T_ALISA, getContent('test'))).toEqual({
                response: {
                    end_session: false,
                    buttons: [],
                    text: 'test',
                    tts: 'test',
                },
                version: '1.0',
            });
            expect(await bot.run(T_ALISA, getContent('кнопка'))).toEqual({
                response: {
                    end_session: false,
                    buttons: [
                        {
                            hide: true,
                            title: '1',
                        },
                    ],
                    text: 'test',
                    tts: 'btn',
                },
                version: '1.0',
            });
            // Карточка с текстом, но без картинки — рабочий сценарий Алисы:
            // документация не помечает image_id обязательным.
            expect(await bot.run(T_ALISA, getContent('карточка'))).toEqual({
                response: {
                    card: {
                        items: [
                            {
                                description: '',
                                title: 'Header',
                            },
                        ],
                        type: 'ItemsList',
                    },
                    end_session: false,
                    buttons: [],
                    text: 'test',
                    tts: 'card',
                },
                version: '1.0',
            });
        });
    });

    describe('webhookEvent', () => {
        const tgBody = JSON.stringify({
            update_id: 1,
            message: {
                message_id: 1,
                text: 'hi',
                chat: { id: 42, type: 'private' },
                from: { id: 42 },
            },
        });

        it('возвращает 400 для пустого тела', async () => {
            const res = await bot.webhookEvent(null);
            expect(res.statusCode).toBe(400);
        });

        it('возвращает 400 для невалидного JSON', async () => {
            // Унифицировано с webhookHandle: некорректный запрос — это 400, не 422/500.
            const res = await bot.webhookEvent('{broken');
            expect(res.statusCode).toBe(400);
        });

        it('возвращает 400 для валидного JSON, не являющегося объектом', async () => {
            // Регрессия: JSON-скаляр (строка/число/массив) проходил парсинг и падал
            // с 500 внутри пайплайна. Платформы всегда присылают объект.
            bot.initBotController(TestBotController);
            for (const body of ['"just a string"', '42', '[1, 2, 3]']) {
                const res = await bot.webhookEvent(body);
                expect(res.statusCode).toBe(400);
            }
        });

        it('возвращает 401, если webhookSecret задан, но заголовок отсутствует', async () => {
            bot.setAppConfig({ tokens: { telegram: { token: 'tok', webhookSecret: 'secret' } } });
            bot.use(new TelegramAdapter());
            const res = await bot.webhookEvent(tgBody, {});
            expect(res.statusCode).toBe(401);
        });

        it('пропускает запрос при совпадающем webhookSecret', async () => {
            bot.initBotController(TestBotController);
            bot.setAppConfig({ tokens: { telegram: { token: 'tok', webhookSecret: 'secret' } } });
            bot.use(new TelegramAdapter());
            bot.addCommand('hi', ['hi'], (_, ctrl) => {
                ctrl.text = 'ok';
            });
            const callSpy = jest
                .spyOn(TelegramRequest.prototype, 'call')
                .mockResolvedValue(undefined);
            const res = await bot.webhookEvent(tgBody, {
                'x-telegram-bot-api-secret-token': 'secret',
            });
            expect(res.statusCode).not.toBe(401);
            callSpy.mockRestore();
        });

        it('принимает заголовок подписи в любом регистре (Yandex Cloud Functions)', async () => {
            // Регресс: serverless-платформы передают заголовки как прислал клиент
            // (X-Telegram-Bot-Api-Secret-Token), а адаптер искал их в нижнем регистре —
            // при заданном секрете каждый настоящий запрос получал 401.
            bot.initBotController(TestBotController);
            bot.setAppConfig({ tokens: { telegram: { token: 'tok', webhookSecret: 'secret' } } });
            bot.use(new TelegramAdapter());
            const callSpy = jest
                .spyOn(TelegramRequest.prototype, 'call')
                .mockResolvedValue(undefined);
            const ok = await bot.webhookEvent(tgBody, {
                'X-Telegram-Bot-Api-Secret-Token': 'secret',
            });
            expect(ok.statusCode).toBe(200);
            const bad = await bot.webhookEvent(tgBody, {
                'X-Telegram-Bot-Api-Secret-Token': 'wrong',
            });
            expect(bad.statusCode).toBe(401);
            callSpy.mockRestore();
        });

        it('возвращает 400, а не 500, если платформа не определилась', async () => {
            bot.initBotController(TestBotController);
            const res = await bot.webhookEvent(JSON.stringify({ unknown_platform: true }));
            // На 5xx Telegram и VK включают повторную доставку и в итоге отключают
            // вебхук, поэтому нераспознанный запрос должен отдавать 4xx.
            expect(res.statusCode).toBe(400);
        });
    });

    describe('команды с регулярными выражениями', () => {
        it('находит команду с глобальным regexp на каждом запросе', async () => {
            const tBot = new TestBot();
            tBot.initBotController(TestBotController);
            tBot.use(new AlisaAdapter());
            let hits = 0;
            tBot.addCommand(
                'hi',
                [/привет/g],
                (_, ctrl) => {
                    hits++;
                    ctrl.text = 'ok';
                },
                true,
            );
            for (let i = 0; i < 4; i++) {
                await tBot.run(T_ALISA, getContent('привет', i));
            }
            // RegExp с флагом g продвигает lastIndex, поэтому кэшированный объект
            // раньше срабатывал через раз, и половина запросов уходила в fallback.
            expect(hits).toBe(4);
        });
    });

    describe('saved state and DB', () => {
        it('не запрашивает SmartApp storage при выключенном isLocalStorage', async () => {
            const tBot = new TestBot();
            tBot.initBotController(TestBotController);
            const smartApp = new SmartAppAdapter();
            const getStorage = jest.spyOn(smartApp, 'getLocalStorage');
            tBot.use(smartApp);
            tBot.addCommand('hello', ['привет'], (_text, controller) => {
                controller.text = 'Привет';
            });

            await tBot.run(
                T_SMART_APP,
                JSON.stringify(smartApp.getQueryExample('привет', 'user-1', 0)),
            );

            expect(getStorage).not.toHaveBeenCalled();
            await tBot.close();
        });

        it('get state is not isLocalStorage', async () => {
            const tBot = new TestBot();
            tBot.initBotController(TestBotController);
            let bUserData: IUserData = {};
            let bState: IPlatformData | null = {};
            tBot.addCommand('cool', ['cool002'], (_, botC) => {
                botC.text = 'cool';
                bUserData = botC.userData;
                bState = botC.state;
            });

            tBot.use(new AlisaAdapter());
            const res = (await tBot.run(
                T_ALISA,
                getContent('cool002', 2, {
                    test: 'test',
                }),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            expect(res.session_state?.test).toBe('test');
            expect(bState?.test).toBe('test');
            expect(bUserData?.test).toBe(undefined);

            tBot.clearCommands();
        });
        it('saved state and not DB', async () => {
            const tBot = new TestBot();
            tBot.setAppConfig({
                isLocalStorage: true,
            });
            tBot.initBotController(TestBotController);
            tBot.addCommand('cool', ['cool002'], (_, botC) => {
                botC.text = 'cool';
                botC.userData.cool = true;
                botC.state = {
                    cool2: true,
                };
            });

            tBot.use(new AlisaAdapter());
            const res = (await tBot.run(
                T_ALISA,
                getContent('cool002', 2),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            expect(res.session_state?.cool).toBe(true);
            tBot.clearCommands();
        });
        it('saved state. used userData, empty state', async () => {
            bot.setAppConfig({
                isLocalStorage: true,
            });
            bot.use(new FileAdapter());
            bot.initBotController(TestBotController);
            bot.addCommand('cool', ['cool001'], (_, botC) => {
                botC.state = null;
                botC.text = 'cool';
                botC.userData.cool = true;
            });
            saveSpy.mockRestore();
            updateSpy.mockRestore();
            bot.use(new AlisaAdapter());
            const userData = new UsersData(bot.getAppContext());
            userData.platform = T_ALISA;
            userData.userId = 'test';
            userData.remove();
            const res = (await bot.run(T_ALISA, getContent('cool001', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            expect(res.session_state?.cool).toBe(true);
            const select = await userData.selectOne();
            expect(select.status).toBe(false);
            bot.clearCommands();
            await userData.remove();
            await bot.close();
        });

        it('saved state and DB', async () => {
            bot.setAppConfig({
                isLocalStorage: true,
            });
            bot.use(new FileAdapter());
            bot.initBotController(TestBotController);
            bot.addCommand('cool', ['cool004'], (_, botC) => {
                botC.text = 'cool';
                botC.userData.cool = true;
                botC.state = {
                    cool2: true,
                };
            });
            saveSpy.mockRestore();
            updateSpy.mockRestore();
            bot.use(new AlisaAdapter());
            const res = (await bot.run(T_ALISA, getContent('cool004', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');

            expect(res.session_state?.cool2).toBe(true);
            const userData = new UsersData(bot.getAppContext());
            userData.platform = T_ALISA;
            userData.userId = 'test';
            const select = await userData.selectOne();
            expect(JSON.parse(select.data?.data as string).cool).toBe(true);
            bot.clearCommands();
            await userData.remove();
            await bot.close();
        });

        it('userData читается по userId при наличии userToken (авторизованный пользователь)', async () => {
            // Регресс: раньше #initUserData читал запись по userToken, а #saveUserData
            // писал по userId — данные авторизованных пользователей терялись между запросами.
            bot.setAppConfig({
                isLocalStorage: false,
            });
            bot.use(new FileAdapter());
            bot.initBotController(TestBotController);
            bot.getAppContext().platformParams.isAuthUser = true;

            let readVisits: unknown;
            bot.addCommand('set', ['auth-set'], (_, botC) => {
                botC.text = 'set';
                botC.userData.visits = 42;
            });
            bot.addCommand('get', ['auth-get'], (_, botC) => {
                botC.text = 'get';
                readVisits = botC.userData.visits;
            });
            saveSpy.mockRestore();
            updateSpy.mockRestore();
            bot.use(new AlisaAdapter());

            const authContent = (query: string): string =>
                JSON.stringify({
                    meta: {
                        locale: 'ru-Ru',
                        timezone: 'UTC',
                        client_id: 'test',
                        interfaces: {},
                    },
                    session: {
                        message_id: 0,
                        session_id: 'local',
                        skill_id: 'local_test',
                        user_id: 'test',
                        new: true,
                        user: {
                            user_id: 'auth-user-id',
                            access_token: 'auth-token-123',
                        },
                    },
                    request: {
                        command: query,
                        original_utterance: query,
                        nlu: {},
                        type: 'SimpleUtterance',
                    },
                    version: '1.0',
                });

            await bot.run(T_ALISA, authContent('auth-set'));
            await bot.run(T_ALISA, authContent('auth-get'));

            expect(readVisits).toBe(42);

            const userData = new UsersData(bot.getAppContext());
            userData.platform = T_ALISA;
            userData.userId = 'auth-user-id';
            await userData.remove();
            bot.clearCommands();
            await bot.close();
        });

        it('get correct state and userData', async () => {
            bot.setAppConfig({
                isLocalStorage: true,
            });
            bot.use(new FileAdapter());
            bot.initBotController(TestBotController);
            bot.addCommand('cool', ['cool123'], (_, botC) => {
                botC.text = 'cool';
                botC.userData.test1 = true;
                botC.state = {
                    test2: true,
                };
            });
            let bUserData: IUserData = {};
            let bState: IPlatformData | null = {};
            let bBotController: BotController | undefined;
            bot.addCommand('getValue', ['state-value'], (_, botC) => {
                bUserData = botC.userData;
                bState = botC.state;
                bBotController = botC;
                botC.text = 'getValue';
            });
            saveSpy.mockRestore();
            updateSpy.mockRestore();
            bot.use(new AlisaAdapter());
            let res = (await bot.run(T_ALISA, getContent('cool123', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            expect(res.session_state?.test2).toBe(true);
            const userData = new UsersData(bot.getAppContext());
            userData.platform = T_ALISA;
            userData.userId = 'test';
            const select = await userData.selectOne();
            expect(JSON.parse(select.data?.data as string).test1).toBe(true);

            res = (await bot.run(
                T_ALISA,
                getContent('state-value', 2, res.session_state),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('getValue');

            expect(bUserData.test1).toBe(undefined);
            expect(bState.test2).toBe(true);
            bot.setAppConfig({
                isLocalStorage: false,
            });
            res = (await bot.run(
                T_ALISA,
                getContent('state-value', 2, res.session_state),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('getValue');
            expect(bUserData.test1).toBe(true);
            expect(bState.test2).toBe(true);

            await userData.remove();
            bBotController?.clearStoreData();

            bot.setAppConfig({
                isLocalStorage: true,
            });
            res = (await bot.run(
                T_ALISA,
                getContent('state-value', 2, res.session_state),
            )) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('getValue');

            expect(bUserData === bState).toBe(true);
            expect(bState.test2).toBe(true);
            expect((await userData.selectOne()).status).toBe(false);

            bot.clearCommands();
            await userData.remove();
            await bot.close();
        });
    });

    describe('request-scoped', () => {
        it('should not use shared controller', async () => {
            bot.initBotController(TestBotController);
            const result1 = {
                version: '1.0',
                response: {
                    buttons: [],
                    tts: 'Привет!',
                    text: 'Привет!',
                    end_session: false,
                },
            };
            const result2 = {
                version: '1.0',
                response: {
                    buttons: [],
                    tts: 'Пока!',
                    text: 'Пока!',
                    end_session: false,
                },
            };
            jest.spyOn(AlisaAdapter.prototype, 'getRatingContext').mockResolvedValue(result1);

            bot.use(new AlisaAdapter());

            const run1 = bot.run(T_ALISA, getContent('привет'));
            const run2 = bot.run(T_ALISA, getContent('пока'));
            let resp: (value: unknown) => void;
            const pr = new Promise((resolve) => (resp = resolve));
            let res1;
            let res2;
            run1.then((res) => {
                res1 = res;
                run2.then((res_2) => {
                    res2 = res_2;
                    resp(true);
                });
            });

            await pr;
            expect(res1).toEqual(result1);
            expect(res2).toEqual(result2);
        });
    });

    describe('start', () => {
        it('should start server on specified hostname and port', async () => {
            const hostname = 'localhost';
            const port = 3000;
            const server = bot.start(hostname, port);
            // Ожидаем, пока сервер начнёт слушать порт
            await new Promise<void>((resolve) => {
                server!.on('listening', resolve);
                server!.on('error', resolve);
            });
            expect(server).toBeInstanceOf(Server);
            bot.close();
            expect(server.listening).toBe(false);
        });

        it('предупреждает о dev-режиме, вебхуке без подписи и 0.0.0.0 при старте', async () => {
            const warnings: string[] = [];
            bot.setLogger({
                error: () => {},
                warn: (msg: string) => warnings.push(msg),
            });
            // Telegram без webhookSecret — подпись не проверяется
            bot.use(new TelegramAdapter('test-token'));
            // Алиса — signatureName не задан, предупреждения о подписи быть не должно
            bot.use(new AlisaAdapter());

            const server = bot.start('0.0.0.0', 3100);
            await new Promise<void>((resolve) => {
                server!.on('listening', resolve);
                server!.on('error', resolve);
            });
            bot.close();

            const devWarn = warnings.find((w) => w.includes('режиме dev'));
            expect(devWarn).toBeDefined();

            const noSignWarn = warnings.find((w) => w.includes('БЕЗ проверки подписи'));
            expect(noSignWarn).toBeDefined();
            expect(noSignWarn).toContain('telegram');

            const ifaceWarn = warnings.find((w) => w.includes('0.0.0.0'));
            expect(ifaceWarn).toBeDefined();
        });

        it('не предупреждает о подписи, когда секреты вебхуков заданы', async () => {
            const warnings: string[] = [];
            bot.setLogger({
                error: () => {},
                warn: (msg: string) => warnings.push(msg),
            });
            bot.getAppContext().setAppConfig({
                tokens: {
                    telegram: { webhookSecret: 'secret' },
                },
            });
            bot.use(new TelegramAdapter('test-token'));
            bot.setAppMode('strict_prod');

            const server = bot.start('localhost', 3101);
            await new Promise<void>((resolve) => {
                server!.on('listening', resolve);
                server!.on('error', resolve);
            });
            bot.close();

            expect(warnings.find((w) => w.includes('БЕЗ проверки подписи'))).toBeUndefined();
            expect(warnings.find((w) => w.includes('режиме dev'))).toBeUndefined();
        });

        it('предупреждает о VK без secret_key: подпись VK приходит в теле, signatureName не нужен', async () => {
            const warnings: string[] = [];
            bot.setLogger({
                error: () => {},
                warn: (msg: string) => warnings.push(msg),
            });
            // VK-адаптер с токеном доступа, но без vk_secret_key: signatureName
            // у VK не задаётся (подпись — поле secret в теле), раньше это
            // исключало VK из предупреждения целиком.
            bot.use(new VkAdapter('vk-access-token'));

            const server = bot.start('localhost', 3102);
            await new Promise<void>((resolve) => {
                server!.on('listening', resolve);
                server!.on('error', resolve);
            });
            bot.close();

            const noSignWarn = warnings.find((w) => w.includes('БЕЗ проверки подписи'));
            expect(noSignWarn).toBeDefined();
            expect(noSignWarn).toContain('vk');
        });
    });
    describe('custom resolver', () => {
        it('setCustomCommandResolver', async () => {
            bot.addCommand('hi', ['привет'], (_, bc) => {
                bc.text = 'Привет!';
            });
            bot.addCommand('by', ['пока'], (_, bc) => {
                bc.text = 'Пока!';
            });
            bot.use(new AlisaAdapter());
            bot.initBotController(TestBotController);
            bot.setCustomCommandResolver((userCommand, commands) => {
                if (commands.has('hi') || commands.has('by')) {
                    if (userCommand === 'привет') {
                        return 'by';
                    }
                    return 'hi';
                }
                return null;
            });
            const result1 = {
                version: '1.0',
                response: {
                    buttons: [],
                    tts: 'Привет!',
                    text: 'Привет!',
                    end_session: false,
                },
            };
            const result2 = {
                version: '1.0',
                response: {
                    buttons: [],
                    tts: 'Пока!',
                    text: 'Пока!',
                    end_session: false,
                },
            };
            const run1 = await bot.run(T_ALISA, getContent('привет'));
            const run2 = await bot.run(T_ALISA, getContent('пока'));
            expect(run1).toEqual(result2);
            expect(run2).toEqual(result1);
        });

        it('вызывает action для команды, найденной custom resolver', async () => {
            class ResolverController extends BotController {
                action(_intentName: string | null, isCommand?: boolean): void {
                    if (isCommand) {
                        this.text = 'Action отработал';
                    }
                }
            }
            bot.addCommand('resolved', ['обычный слот'], (_, controller) => {
                controller.text = 'Команда';
            });
            bot.use(new AlisaAdapter());
            bot.initBotController(ResolverController);
            bot.setCustomCommandResolver(() => 'resolved');

            const result = (await bot.run(
                T_ALISA,
                getContent('кастомная команда', 1),
            )) as IAlisaWebhookResponse;

            expect(result.response?.text).toBe('Action отработал');
        });

        it('продолжает до fallback, когда custom resolver возвращает null', async () => {
            bot.addCommand(FALLBACK_COMMAND, [], (_, controller) => {
                controller.text = 'Fallback отработал';
            });
            bot.use(new AlisaAdapter());
            bot.initBotController(TestBotController);
            bot.setCustomCommandResolver(() => null);

            const result = (await bot.run(
                T_ALISA,
                getContent('неизвестная команда', 1),
            )) as IAlisaWebhookResponse;

            expect(result.response?.text).toBe('Fallback отработал');
        });
    });

    describe('customLogger', () => {
        it('metric', async () => {
            bot.initBotController(TestBotController);
            let warnCount = 0;
            let errorCount = 0;
            let errorMessage = '';
            let metricCount = 0;
            bot.setLogger({
                log: () => {},
                error: (message) => {
                    errorCount++;
                    errorMessage = message;
                },
                warn: () => warnCount++,
                metric: () => metricCount++,
            });
            bot.addCommand('cool', ['cool'], (_, botC) => {
                botC.text = 'cool';
            });
            bot.use(new AlisaAdapter());
            await bot.run(T_ALISA, getContent('cool', 2));
            expect(metricCount).toBe(3);
            for (let i = 0; i < 50000; i++) {
                bot.addCommand(`test_${i}`, [`test_${i}`], () => {
                    return 'empty';
                });
            }
            expect(warnCount).toBe(2);
            expect(errorCount).toBe(0);
            bot.addCommand('error', ['error_test'], () => {
                return Promise.reject('test');
            });
            await bot.run(T_ALISA, getContent('error_test', 2));
            expect(metricCount).toBe(6);
            expect(errorCount).toBe(1);
            expect(errorMessage).toBe(
                'BotController: Произошла ошибка во время обработки команды "error". Текст ошибки: "test"',
            );
        });
    });

    describe('findCommand', () => {
        /**
         * Небезопасное выражение регистрируется, но без re2 движок Node уязвим
         * к катастрофическому бэктрекингу: одно сообщение пользователя способно
         * занять поток на минуты. Поэтому уровень лога зависит от окружения.
         */
        function captureRegexLog(fn: () => void): { warn?: string; error?: string } {
            const captured: { warn?: string; error?: string } = {};
            bot.setLogger({
                error: (message: string): void => {
                    captured.error = message;
                },
                warn: (message: string): void => {
                    captured.warn = message;
                },
            });
            fn();
            return captured;
        }

        const noop = (): void => {};
        const UNSAFE_PATTERNS: [string, () => void][] = [
            [
                `/${'test'.repeat(777)}/`,
                (): void =>
                    bot.addCommand('redos3', [`/${'test'.repeat(777)}/`], noop, true) && undefined,
            ],
            // eslint-disable-next-line security/detect-unsafe-regex
            ['(a*)*', (): void => bot.addCommand('redos4', [/(a*)*/], noop) && undefined],
            // eslint-disable-next-line security/detect-unsafe-regex
            ['(a|a+)+', (): void => bot.addCommand('redos5', [/(a|a+)+/], noop) && undefined],
            [
                '(a+){10,1000}',
                // eslint-disable-next-line security/detect-unsafe-regex
                (): void => bot.addCommand('redos6', [/(a+){10,1000}/], noop) && undefined,
            ],
        ];

        it('не ругается на безопасные выражения', () => {
            const safe = captureRegexLog((): void => {
                bot.addCommand('normal', [/\d+/], noop);
                bot.addCommand('normal2', ['/\\d+/'], noop, true);
                // Одиночный any-quantifier линеен и не является ReDoS:
                // раньше он отбраковывался общим правилом REG_BAD
                bot.addCommand('normal3', [/.*/], noop);
                bot.addCommand('normal4', ['/.*/'], noop, true);
                // Простая фиксированная группа под квантификатором тоже безопасна
                bot.addCommand('normal5', [/(abc)+/], noop);
            });
            expect(safe.warn).toBeUndefined();
            expect(safe.error).toBeUndefined();
            bot.clearCommands();
        });

        it('сообщает о каждом небезопасном выражении с объяснением последствий', () => {
            UNSAFE_PATTERNS.forEach(([pattern, register]): void => {
                const captured = captureRegexLog(register);
                const message = captured.error ?? captured.warn;
                expect(message).toContain('небезопасн');
                expect(message).toContain(pattern);
                if (__$usedRe2) {
                    // С установленным re2 выражение уходит на безопасный движок —
                    // это предупреждение, а не ошибка.
                    expect(captured.warn).toBeDefined();
                    expect(captured.error).toBeUndefined();
                } else {
                    // Без re2 это не предупреждение, а реальная возможность положить бота
                    // одним сообщением, поэтому сообщение уходит в error и объясняет, что делать.
                    expect(captured.error).toBeDefined();
                    expect(captured.error).toContain('re2');
                }
                bot.clearCommands();
            });
        });

        it('redos error', () => {
            bot.setAppMode('strict_prod');
            const safe = captureRegexLog((): void => {
                bot.addCommand('normal', [/\d+/], noop);
                bot.addCommand('normal2', ['/\\d+/'], noop, true);
            });
            expect(safe.warn).toBeUndefined();
            expect(safe.error).toBeUndefined();
            bot.clearCommands();

            UNSAFE_PATTERNS.forEach(([pattern, register]): void => {
                const captured = captureRegexLog(register);
                expect(captured.error).toContain(pattern);
                expect(captured.error).toContain('strictMode');
                expect(captured.warn).toBeUndefined();
                bot.clearCommands();
            });
        });

        it('addCommand and base botController', async () => {
            bot.addCommand('cool', ['cool'], (_, botC) => {
                botC.text = 'cool';
            });
            bot.use(new AlisaAdapter());
            let res = (await bot.run(T_ALISA, getContent('cool', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            for (let i = 0; i < 50; i++) {
                bot.addCommand(`test_${i}`, [`test_${i}`], () => {
                    return 'empty';
                });
            }
            res = (await bot.run(T_ALISA, getContent('cool', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            bot.addCommand('my', ['hello'], (_, botC) => {
                botC.text = 'hello';
            });
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            for (let i = 50; i < 150; i++) {
                bot.addCommand(`test_${i}`, [`test_${i}`], () => {
                    return 'empty';
                });
            }
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            bot.addCommand('my2', ['by'], (_, botC) => {
                botC.text = 'by';
            });
            res = (await bot.run(T_ALISA, getContent('by', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('by');
        });

        it('not used group and not regexp', async () => {
            bot.initBotController(TestBotController);
            bot.addCommand('cool', ['cool'], (_, botC) => {
                botC.text = 'cool';
            });
            bot.use(new AlisaAdapter());
            let res = (await bot.run(T_ALISA, getContent('cool', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            for (let i = 0; i < 50; i++) {
                bot.addCommand(`test_${i}`, [`test_${i}`], () => {
                    return 'empty';
                });
            }
            res = (await bot.run(T_ALISA, getContent('cool', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            bot.addCommand('my', ['hello'], (_, botC) => {
                botC.text = 'hello';
            });
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            for (let i = 50; i < 150; i++) {
                bot.addCommand(`test_${i}`, [`test_${i}`], () => {
                    return 'empty';
                });
            }
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            bot.addCommand('my2', ['by'], (_, botC) => {
                botC.text = 'by';
            });
            res = (await bot.run(T_ALISA, getContent('by', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('by');
        });

        it('not used group(many command) and not regexp', async () => {
            bot.initBotController(TestBotController);
            bot.addCommand('cool', ['cool'], (_, botC) => {
                botC.text = 'cool';
            });
            for (let i = 0; i < 300; i++) {
                bot.addCommand(`test_${i}`, [`test_${i}`], () => {
                    return 'empty';
                });
            }
            bot.use(new AlisaAdapter());
            let res = (await bot.run(T_ALISA, getContent('cool', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            bot.addCommand('my', ['hello'], (_, botC) => {
                botC.text = 'hello';
            });
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            for (let i = 0; i < 150; i++) {
                bot.addCommand(`test_${i}_${i}`, [`test_${i}_${i}`], () => {
                    return 'empty_' + i;
                });
            }
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            bot.addCommand('by', ['by'], (_, botC) => {
                botC.text = 'by';
            });
            res = (await bot.run(T_ALISA, getContent('by', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('by');
        });

        it('not used group and used regexp', async () => {
            bot.initBotController(TestBotController);
            bot.addCommand(
                'cool',
                ['cool'],
                (_, botC) => {
                    botC.text = 'cool';
                },
                true,
            );
            bot.use(new AlisaAdapter());
            let res = (await bot.run(T_ALISA, getContent('cool', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            for (let i = 0; i < 50; i++) {
                bot.addCommand(
                    `test_${i}`,
                    [`test_${i}`],
                    () => {
                        return 'empty';
                    },
                    true,
                );
            }
            res = (await bot.run(T_ALISA, getContent('cool', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            bot.addCommand(
                'my',
                ['hello'],
                (_, botC) => {
                    botC.text = 'hello';
                },
                true,
            );
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            for (let i = 50; i < 150; i++) {
                bot.addCommand(
                    `test_${i}`,
                    [`test_${i}`],
                    () => {
                        return 'empty';
                    },
                    true,
                );
            }
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            bot.addCommand(
                'by',
                ['by'],
                (_, botC) => {
                    botC.text = 'by';
                },
                true,
            );
            res = (await bot.run(T_ALISA, getContent('by', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('by');
        });

        it('обрабатывает pattern-команду с дефисом после создания первой группы', async () => {
            bot.initBotController(TestBotController);
            for (let i = 0; i <= 300; i++) {
                bot.addCommand(
                    `command-${i}`,
                    [`^command-${i}$`],
                    (_, botC) => {
                        botC.text = `handled-${i}`;
                    },
                    true,
                );
            }
            bot.use(new AlisaAdapter());

            const res = (await bot.run(
                T_ALISA,
                getContent('command-300', 2),
            )) as IAlisaWebhookResponse;

            expect(res.response?.text).toBe('handled-300');
        });

        it('used group and used regexp', async () => {
            bot.initBotController(TestBotController);
            bot.addCommand(
                'cool',
                ['cool'],
                (_, botC) => {
                    botC.text = 'cool';
                },
                true,
            );
            for (let i = 0; i < 300; i++) {
                bot.addCommand(
                    `test_${i}`,
                    [`test_${i}`],
                    () => {
                        return 'empty';
                    },
                    true,
                );
            }
            bot.use(new AlisaAdapter());
            let res = (await bot.run(T_ALISA, getContent('cool', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');
            bot.addCommand(
                'my',
                ['hello'],
                (_, botC) => {
                    botC.text = 'hello';
                },
                true,
            );
            await new Promise((res) => setTimeout(res, 200));
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            for (let i = 0; i < 150; i++) {
                bot.addCommand(
                    `test_${i}_${i}`,
                    [`test_${i}_${i}`],
                    () => {
                        return 'empty_' + i;
                    },
                    true,
                );
            }
            await new Promise((res) => setTimeout(res, 200));
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            bot.addCommand(
                'by',
                ['by'],
                (_, botC) => {
                    botC.text = 'by';
                },
                true,
            );
            await new Promise((res) => setTimeout(res, 200));
            res = (await bot.run(T_ALISA, getContent('by', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('by');
        });

        it('used group and used find text and regexp', async () => {
            bot.initBotController(TestBotController);
            bot.addCommand(
                'cool',
                ['cool'],
                (_, botC) => {
                    botC.text = 'cool';
                },
                true,
            );
            for (let i = 0; i < 300; i++) {
                bot.addCommand(
                    `test_${i}`,
                    [`test_${i}`],
                    () => {
                        return 'empty';
                    },
                    i % 50 !== 0,
                );
            }
            await new Promise((res) => setTimeout(res, 200));
            bot.use(new AlisaAdapter());
            let res = (await bot.run(T_ALISA, getContent('cool', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');

            bot.addCommand(
                'no group',
                ['group'],
                (_, botC) => {
                    botC.text = 'no group';
                },
                true,
            );
            await new Promise((res) => setTimeout(res, 200));
            res = (await bot.run(T_ALISA, getContent('no group', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('no group');

            bot.addCommand(
                'my',
                ['hello'],
                (_, botC) => {
                    botC.text = 'hello';
                },
                true,
            );
            await new Promise((res) => setTimeout(res, 200));
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            for (let i = 0; i < 300; i++) {
                bot.addCommand(
                    `test_${i}_${i}`,
                    [`test_${i}_${i}`],
                    () => {
                        return 'empty_' + i;
                    },
                    i % 50 !== 0,
                );
            }
            await new Promise((res) => setTimeout(res, 200));
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            bot.addCommand(
                'by',
                ['by'],
                (_, botC) => {
                    botC.text = 'by';
                },
                true,
            );
            await new Promise((res) => setTimeout(res, 200));
            res = (await bot.run(T_ALISA, getContent('by', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('by');
        });

        it('used group and removeCommand', async () => {
            bot.initBotController(TestBotController);
            bot.addCommand(
                'cool',
                ['cool'],
                (_, botC) => {
                    botC.text = 'cool';
                },
                true,
            );
            for (let i = 0; i < 300; i++) {
                bot.addCommand(
                    `test_${i}`,
                    [`test_${i}`],
                    () => {
                        return 'empty';
                    },
                    i % 30 !== 0,
                );
            }
            await new Promise((res) => setTimeout(res, 200));
            bot.use(new AlisaAdapter());
            let res = (await bot.run(T_ALISA, getContent('cool', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('cool');

            bot.addCommand(
                'no group',
                ['group'],
                (_, botC) => {
                    botC.text = 'no group';
                },
                true,
            );
            res = (await bot.run(T_ALISA, getContent('no group', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('no group');

            bot.addCommand(
                'my',
                ['hello'],
                (_, botC) => {
                    botC.text = 'hello';
                },
                true,
            );
            await new Promise((res) => setTimeout(res, 200));
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            for (let i = 0; i < 300; i++) {
                bot.addCommand(
                    `test_${i}_${i}`,
                    [`test_${i}_${i}`],
                    () => {
                        return 'empty_' + i;
                    },
                    i % 30 !== 0,
                );
            }
            await new Promise((res) => setTimeout(res, 200));
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            bot.addCommand(
                'by',
                ['by'],
                (_, botC) => {
                    botC.text = 'by';
                },
                true,
            );
            await new Promise((res) => setTimeout(res, 200));
            res = (await bot.run(T_ALISA, getContent('by', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('by');
            bot.removeCommand('text_299_299');
            await new Promise((res) => setTimeout(res, 200));
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
            bot.removeCommand('text_291_291');
            await new Promise((res) => setTimeout(res, 200));
            res = (await bot.run(T_ALISA, getContent('hello', 2))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hello');
        });

        it('group mode auto', () => {
            bot.addCommand('_0', ['0'], () => {}, true);
            expect(bot.getAppContext().commands.size).toBe(1);
            for (let i = 1; i < 300; i++) {
                bot.addCommand(`_${i}`, [`${i}`], () => {}, true);
            }
            expect(bot.getAppContext().commands.size).toBe(300);
            expect(bot.getAppContext().commands.get('_299')?.__$groupName).toBe('_299');
            bot.addCommand('_300', ['300'], () => {}, true);
            bot.addCommand('_301', ['301'], () => {}, true);
            expect(bot.getAppContext().commands.get('_301')?.__$groupName).toBe('_300');
        });

        it('group mode group', () => {
            bot.setCommandGroupMode('group');
            bot.addCommand('_0', ['0'], () => {}, true);
            expect(bot.getAppContext().commands.size).toBe(1);
            for (let i = 1; i < 20; i++) {
                bot.addCommand(`_${i}`, [`${i}`], () => {}, true);
            }
            expect(bot.getAppContext().commands.size).toBe(20);
            expect(bot.getAppContext().commands.get('_19')?.__$groupName).toBe('_0');
            bot.addCommand('_300', ['300'], () => {}, true);
            bot.addCommand('_301', ['301'], () => {}, true);
            expect(bot.getAppContext().commands.get('_301')?.__$groupName).toBe('_0');
            bot.setCommandGroupMode('auto');
        });

        it('group mode no-group', () => {
            bot.setCommandGroupMode('no-group');
            bot.addCommand('_0', ['0'], () => {}, true);
            expect(bot.getAppContext().commands.size).toBe(1);
            for (let i = 1; i < 300; i++) {
                bot.addCommand(`_${i}`, [`${i}`], () => {}, true);
            }
            expect(bot.getAppContext().commands.size).toBe(300);
            expect(bot.getAppContext().commands.get('_299')?.__$groupName).toBe('_299');
            bot.addCommand('_300', ['300'], () => {}, true);
            bot.addCommand('_301', ['301'], () => {}, true);
            expect(bot.getAppContext().commands.get('_301')?.__$groupName).toBe('_301');
            bot.setCommandGroupMode('auto');
        });
    });

    describe('adapters', () => {
        it('i18n', async () => {
            const i18n = (appContext: AppContext): void => {
                appContext.plugins.i18n = (text: string): string => {
                    if (text === 'привет') {
                        return 'hi';
                    }
                    return text;
                };
            };
            i18n.isPlugin = true;
            bot.use(i18n);
            bot.use(voicePlatforms);
            bot.addCommand('hi2', ['прив'], (_, botController) => {
                botController.text = 'приветик';
            });
            bot.addCommand('hi', ['привет'], (_, botController) => {
                botController.text = 'привет';
            });
            let res = (await bot.run(T_ALISA, getContent('прив'))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('приветик');

            res = (await bot.run(T_ALISA, getContent('привет'))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('hi');
        });
        it('regExp', async () => {
            let usedRegExp = 0;
            const reg = (appContext: AppContext): void => {
                appContext.plugins.regExp = (): RegExpConstructor => {
                    usedRegExp++;
                    return MyReg as unknown as RegExpConstructor;
                };
            };
            reg.isPlugin = true;
            bot.use(reg);
            bot.use(voicePlatforms);
            bot.addCommand('reg', ['\\d+'], (userCommand) => `Вы сказали ${userCommand}`, true);
            const res = (await bot.run(T_ALISA, getContent('5'))) as IAlisaWebhookResponse;
            expect(res.response?.text).toBe('Вы сказали 5');
            expect(usedRegExp).toBe(2);
            expect(MyReg.created).toBe(1);
            // Вызывается 3 раза, так как 2 раза идет прогрев + 1 реальный вызов
            expect(MyReg.used).toBe(3);
            await bot.run(T_ALISA, getContent('привет'));
            expect(usedRegExp).toBe(3);
            expect(MyReg.created).toBe(1);
            expect(MyReg.used).toBe(4);
        });
    });

    describe('env', () => {
        it('init', () => {
            bot.setAppConfig({
                env: __dirname + '/env',
            });
            expect(bot.getAppContext().appConfig.tokens).toEqual({
                alisa: {
                    token: 'your-alisa-token',
                },
                marusia: {
                    token: 'your-marusia-token',
                },
                max_app: {
                    token: 'your-max-token',
                },
                telegram: {
                    token: 'your-telegram-token',
                },
                viber: {
                    token: 'your-viber-token',
                },
                vk: {
                    confirmation_token: 'your-vk-confirmation-token',
                    token: 'your-vk-token',
                },
            });
        });

        it('ALISA_TOKEN имеет приоритет над YANDEX_TOKEN, VK_SECRET_KEY читается', () => {
            const envBot = new TestBot();
            envBot.setLogger({ error: () => {}, warn: () => {} });
            envBot.setAppConfig({
                env: __dirname + '/env-alisa',
            });
            const tokens = envBot.getAppContext().appConfig.tokens;
            expect(tokens.alisa?.token).toBe('alisa-canonical-token');
            expect(tokens.vk?.secret_key).toBe('vk-secret-value');
        });

        it('SPEECH_KIT_TOKEN раскладывается в speech_kit_token чат-платформ', () => {
            const envBot = new TestBot();
            envBot.setLogger({ error: () => {}, warn: () => {} });
            envBot.setAppConfig({
                env: __dirname + '/env-speechkit',
            });
            const tokens = envBot.getAppContext().appConfig.tokens;
            expect(tokens.telegram?.token).toBe('your-telegram-token');
            expect(tokens.telegram?.speech_kit_token).toBe('speechkit-test-token');
            expect(tokens.vk?.speech_kit_token).toBe('speechkit-test-token');
            expect(tokens.max_app?.speech_kit_token).toBe('speechkit-test-token');
        });
    });

    describe('async action()', () => {
        // Раньше промис async action() не дожидался: всё после первого await
        // молча не попадало в ответ, в лог писалось только предупреждение.
        it('дожидается async action() и отдаёт текст, заданный после await', async () => {
            class AsyncActionController extends BotController {
                public async action(_intentName: string | null): Promise<void> {
                    await new Promise((resolve) => setTimeout(resolve, 5));
                    this.text = 'после await';
                }
            }
            bot.initBotController(AsyncActionController);
            bot.use(new AlisaAdapter());

            const res = (await bot.run(T_ALISA, getContent('привет', 1))) as IAlisaWebhookResponse;

            expect(res.response?.text).toBe('после await');
        });

        it('ошибка async action() логируется, а пользователь получает текст ошибки', async () => {
            class FailingActionController extends BotController {
                public async action(): Promise<void> {
                    await Promise.resolve();
                    throw new Error('сбой');
                }
            }
            bot.initBotController(FailingActionController);
            bot.use(new AlisaAdapter());
            const errorSpy = jest
                .spyOn(bot.getAppContext(), 'logError')
                .mockImplementation(() => {});

            const res = (await bot.run(
                T_ALISA,
                getContent('абракадабра', 1),
            )) as IAlisaWebhookResponse;

            expect(res.response?.text).toBe('Не удалось выполнить команду. Попробуйте ещё раз.');
            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining('сбой'),
                expect.any(Object),
            );
            errorSpy.mockRestore();
        });

        it('дожидается async action() после команды', async () => {
            class AsyncAfterCommand extends BotController {
                public async action(intentName: string | null): Promise<void> {
                    await Promise.resolve();
                    this.text += ` + action(${intentName})`;
                }
            }
            bot.initBotController(AsyncAfterCommand);
            bot.use(new AlisaAdapter());
            bot.addCommand('order', ['заказ'], (_, ctx) => {
                ctx.text = 'команда';
            });

            const res = (await bot.run(T_ALISA, getContent('заказ', 2))) as IAlisaWebhookResponse;

            expect(res.response?.text).toBe('команда + action(order)');
        });
    });
});
