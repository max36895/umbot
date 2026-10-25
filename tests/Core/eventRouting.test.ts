import { AppContext, Bot, BotController } from '../../src';
import { ALL_EVENT_TYPES } from '../../src/core/events';
import {
    AlisaAdapter,
    BasePlatformAdapter,
    MarusiaAdapter,
    MaxAdapter,
    SmartAppAdapter,
    TelegramAdapter,
    ViberAdapter,
    VkAdapter,
} from '../../src/plugins';

class TestController extends BotController {
    action(): void {
        return;
    }
}

function createContext(): AppContext {
    const context = new AppContext();
    context.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
    return context;
}

describe('Событийный роутинг (bot.addEvent / controller.eventType)', () => {
    it('реестр событий пуст по умолчанию — конвейер не меняется', () => {
        const context = createContext();
        const controller = new TestController(context);
        controller.userCommand = 'привет';
        // run() без зарегистрированных событий идёт по обычному пути: ничего не падает.
        expect(() => controller.run()).not.toThrow();
    });

    it('eventType по умолчанию — message', () => {
        const controller = new TestController(createContext());
        expect(controller.eventType).toBe('message');
    });

    it('clearStoreData сбрасывает eventType и match', () => {
        const controller = new TestController(createContext());
        controller.eventType = 'photo';
        controller.match = /x/.exec('x');
        controller.clearStoreData();
        expect(controller.eventType).toBe('message');
        expect(controller.match).toBeNull();
    });

    it('хендлер события вызывается до команд и перехватывает обработку', () => {
        const context = createContext();
        let actionIntent: string | null | undefined;
        class Ctrl extends TestController {
            action(intentName: string | null): void {
                actionIntent = intentName;
            }
        }
        const controller = new Ctrl(context);
        context.command.addEvent('photo', (ctx) => {
            ctx.text = 'Отличное фото!';
        });
        controller.eventType = 'photo';
        controller.userCommand = '';
        controller.run();
        expect(controller.text).toBe('Отличное фото!');
        // action вызван с именем события.
        expect(actionIntent).toBe('photo');
    });

    it('хендлер с false передаёт запрос обычному конвейеру команд', () => {
        const context = createContext();
        context.command.addCommand('ping', ['ping'], (_t, ctx) => {
            ctx.text = 'pong';
        });
        context.command.addEvent('message', () => false);
        const controller = new TestController(context);
        controller.eventType = 'message';
        controller.userCommand = 'ping';
        controller.run();
        expect(controller.text).toBe('pong');
    });

    it('async-хендлер с false передаёт запрос конвейеру', async () => {
        const context = createContext();
        context.command.addCommand('ping', ['ping'], (_t, ctx) => {
            ctx.text = 'pong';
        });
        context.command.addEvent('message', async () => false);
        const controller = new TestController(context);
        controller.eventType = 'message';
        controller.userCommand = 'ping';
        await controller.run();
        expect(controller.text).toBe('pong');
    });

    it('async-хендлер может задать текст ответа', async () => {
        const context = createContext();
        context.command.addEvent('callback', async () => 'кнопка нажата');
        const controller = new TestController(context);
        controller.eventType = 'callback';
        await controller.run();
        expect(controller.text).toBe('кнопка нажата');
    });

    it('хендлеры события выполняются по порядку до первого не-false', () => {
        const context = createContext();
        const calls: string[] = [];
        context.command.addEvent('sticker', () => {
            calls.push('first');
            return false;
        });
        context.command.addEvent('sticker', (ctx) => {
            calls.push('second');
            ctx.text = 'стикер!';
        });
        context.command.addEvent('sticker', () => {
            calls.push('third');
        });
        const controller = new TestController(context);
        controller.eventType = 'sticker';
        controller.run();
        expect(calls).toEqual(['first', 'second']);
        expect(controller.text).toBe('стикер!');
    });

    it('ошибка в хендлере логируется и не роняет запрос', () => {
        const context = createContext();
        context.command.addEvent('photo', () => {
            throw new Error('boom');
        });
        const controller = new TestController(context);
        controller.eventType = 'photo';
        expect(() => controller.run()).not.toThrow();
        expect(controller.text).toBe('Не удалось обработать запрос. Попробуйте ещё раз.');
    });

    it('событие без хендлеров не влияет на обычный конвейер', () => {
        const context = createContext();
        context.command.addEvent('photo', (ctx) => {
            ctx.text = 'фото';
        });
        context.command.addCommand('ping', ['ping'], (_t, ctx) => {
            ctx.text = 'pong';
        });
        const controller = new TestController(context);
        // eventType = 'message' (по умолчанию): хендлеров на message нет —
        // событийный слой молча пропускает, работает обычный конвейер.
        controller.userCommand = 'ping';
        controller.run();
        expect(controller.text).toBe('pong');
    });

    it('removeEvent и clearEvents удаляют хендлеры', () => {
        const context = createContext();
        context.command.addEvent('photo', (ctx) => {
            ctx.text = 'фото';
        });
        context.command.removeEvent('photo');
        expect(context.command.events.size).toBe(0);

        context.command.addEvent('video', (ctx) => {
            ctx.text = 'видео';
        });
        context.command.clearEvents();
        expect(context.command.events.size).toBe(0);
    });

    it('async-хендлер с false передаёт событие СЛЕДУЮЩЕМУ хендлеру, а не конвейеру', async () => {
        const context = createContext();
        const calls: string[] = [];
        context.command.addEvent('photo', async () => {
            calls.push('first');
            return false;
        });
        context.command.addEvent('photo', (ctx) => {
            calls.push('second');
            ctx.text = 'второй хендлер';
        });
        const controller = new TestController(context);
        controller.eventType = 'photo';
        await controller.run();
        expect(calls).toEqual(['first', 'second']);
        expect(controller.text).toBe('второй хендлер');
    });

    it('все async-хендлеры отказались — запрос уходит в обычный конвейер', async () => {
        const context = createContext();
        context.command.addCommand('ping', ['ping'], (_t, ctx) => {
            ctx.text = 'pong';
        });
        context.command.addEvent('message', async () => false);
        context.command.addEvent('message', async () => false);
        const controller = new TestController(context);
        controller.eventType = 'message';
        controller.userCommand = 'ping';
        await controller.run();
        expect(controller.text).toBe('pong');
    });

    it('смешанная цепочка: async-false → sync-перехват', async () => {
        const context = createContext();
        const calls: string[] = [];
        context.command.addEvent('callback', async () => {
            calls.push('async');
            return false;
        });
        context.command.addEvent('callback', (ctx) => {
            calls.push('sync');
            ctx.text = 'перехвачено';
        });
        const controller = new TestController(context);
        controller.eventType = 'callback';
        await controller.run();
        expect(calls).toEqual(['async', 'sync']);
        expect(controller.text).toBe('перехвачено');
    });

    it('hasEvents — readonly-аксессор: флаг синхронен с реестром', () => {
        const context = createContext();
        expect(context.command.hasEvents).toBe(false);
        context.command.addEvent('photo', () => false);
        expect(context.command.hasEvents).toBe(true);
        context.command.removeEvent('photo');
        expect(context.command.hasEvents).toBe(false);
    });

    it('типы событий: isEventType распознаёт валидные и отклоняет неизвестные', () => {
        expect(isEventType('photo')).toBe(true);
        expect(isEventType('callback')).toBe(true);
        expect(isEventType('message')).toBe(true);
        expect(isEventType('unknown_event')).toBe(false);
        expect(isEventType('')).toBe(false);
    });

    it('supportedEvents объявлен всеми встроенными адаптерами и состоит из валидных событий', () => {
        const adapters: { name: string; events: readonly string[] }[] = [
            { name: 'telegram', events: new TelegramAdapter().supportedEvents },
            {
                name: 'vk',
                events: new VkAdapter('t', { vk_load_user_info: false }).supportedEvents,
            },
            { name: 'max_app', events: new MaxAdapter('t').supportedEvents },
            { name: 'viber', events: new ViberAdapter('t').supportedEvents },
            { name: 'alisa', events: new AlisaAdapter('t').supportedEvents },
            { name: 'marusia', events: new MarusiaAdapter('t').supportedEvents },
            { name: 'smart_app', events: new SmartAppAdapter().supportedEvents },
        ];
        for (const { name, events } of adapters) {
            expect(Array.isArray(events)).toBe(true);
            expect(events.length).toBeGreaterThan(0);
            for (const event of events) {
                expect(isEventType(event)).toBe(true);
            }
            // Каждая платформа поддерживает базовое событие message.
            expect(events).toContain('message');
            expect(name.length).toBeGreaterThan(0);
        }
        // Telegram дополнительно поддерживает медиа и callback/inline.
        expect(new TelegramAdapter().supportedEvents).toContain('photo');
        expect(new TelegramAdapter().supportedEvents).toContain('inline');
        expect(new VkAdapter('t', { vk_load_user_info: false }).supportedEvents).toContain(
            'callback',
        );
    });

    it('BasePlatform по умолчанию объявляет только message — кастомная платформа расширяет сама', () => {
        // Наследник без переопределения получает минимум; с переопределением —
        // собственный перечень, который учитывается валидацией addEvent.
        class CustomPlatform extends BasePlatformAdapter {
            platformName = 'custom_platform';
            supportedEvents: readonly string[] = ['message', 'photo'];

            isPlatformOnQuery(): boolean {
                return false;
            }
            setQueryData(): boolean {
                return true;
            }
            getContent(): string {
                return 'ok';
            }
        }
        const custom = new CustomPlatform();
        expect(custom.supportedEvents).toEqual(['message', 'photo']);
    });
});

describe('Bot.addEvent: валидация по supportedEvents подключённых адаптеров', () => {
    class SilentController extends BotController {
        action(): void {
            return;
        }
    }

    function makeBot(): { bot: Bot; warns: string[] } {
        const warns: string[] = [];
        const bot = new Bot();
        bot.initBotController(SilentController);
        bot.setLogger({
            log: () => {},
            error: () => {},
            warn: (msg: string) => warns.push(msg),
        });
        return { bot, warns };
    }

    it('молчит, когда подключённый адаптер поддерживает событие', () => {
        const { bot, warns } = makeBot();
        bot.use(new TelegramAdapter('t'));
        bot.addEvent('photo', (ctx) => {
            ctx.text = 'фото';
        });
        expect(warns).toEqual([]);
        expect(bot.getAppContext().command.events.size).toBe(1);
    });

    it('предупреждает о событии, которого нет ни у одного адаптера', () => {
        const { bot, warns } = makeBot();
        bot.use(new AlisaAdapter('t'));
        bot.addEvent('photo', (ctx) => {
            ctx.text = 'фото';
        });
        // Хендлер всё равно зарегистрирован: после подключения Telegram он заработает.
        expect(bot.getAppContext().command.events.size).toBe(1);
        expect(warns.length).toBe(1);
        expect(warns[0]).toContain('ни один подключённый адаптер');
    });

    it('предупреждает об опечатке в имени события и подсказывает допустимые', () => {
        const { bot, warns } = makeBot();
        bot.use(new TelegramAdapter('t'));
        bot.addEvent('fotos' as never, (ctx) => {
            ctx.text = 'фото';
        });
        expect(warns.length).toBe(1);
        expect(warns[0]).toContain('неизвестное событие');
        expect(warns[0]).toContain('photo');
    });

    it('кастомная платформа с собственным supportedEvents закрывает валидацию', () => {
        class CustomPlatform extends BasePlatformAdapter {
            platformName = 'custom_platform';
            supportedEvents: readonly string[] = ['message', 'sticker'];

            isPlatformOnQuery(): boolean {
                return false;
            }
            setQueryData(): boolean {
                return true;
            }
            getContent(): string {
                return 'ok';
            }
        }
        const { bot, warns } = makeBot();
        bot.use(new CustomPlatform());
        bot.addEvent('sticker', (ctx) => {
            ctx.text = 'стикер';
        });
        expect(warns).toEqual([]);
    });
});

describe('Событие start по ссылке-приглашению (Telegram)', () => {
    function makeBot(): { bot: Bot; sent: string[] } {
        const bot = new Bot();
        bot.initBotController(TestController);
        bot.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        bot.use(new TelegramAdapter('1:t'));
        const sent: string[] = [];
        bot.getAppContext().httpClient = async (_url, options): Promise<Response> => {
            sent.push(String(options?.body ?? ''));
            return Response.json({ ok: true, result: { message_id: 1 } });
        };
        return { bot, sent };
    }

    const update = (text: string): string =>
        JSON.stringify({
            update_id: 1,
            message: {
                message_id: 1,
                from: { id: 42, is_bot: false, first_name: 'U' },
                chat: { id: 42, type: 'private' },
                text,
            },
        });

    it('обработчик start получает параметр ссылки', async () => {
        const { bot, sent } = makeBot();
        bot.addEvent('start', (ctx) => {
            ctx.text = `Комната ${String(ctx.payload)}`;
        });
        await bot.run('telegram', update('/start K7M2QX'));
        expect(sent.some((body) => body.includes('Комната K7M2QX'))).toBe(true);
        await bot.close();
    });

    it('обработчик start вернул false — срабатывает команда по тексту /start', async () => {
        const { bot, sent } = makeBot();
        bot.addEvent('start', () => false);
        bot.addCommand('start_cmd', ['/start'], (_t, ctx) => {
            ctx.text = 'Команда /start';
        });
        await bot.run('telegram', update('/start K7M2QX'));
        expect(sent.some((body) => body.includes('Команда /start'))).toBe(true);
        await bot.close();
    });
});

function isEventType(event: string): boolean {
    return (ALL_EVENT_TYPES as readonly string[]).includes(event);
}
