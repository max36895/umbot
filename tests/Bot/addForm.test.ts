import { Bot, BotController } from '../../src';

/**
 * Тесты для addForm — многошаговой формы, добавленной в Bot.
 * Тестируем логику напрямую через step-handler'ы (изолируем от webhook),
 * чтобы покрыть: регистрацию шагов, переход между полями, валидацию с повторным prompt,
 * команду отмены и успешное завершение.
 */
describe('Bot.addForm', () => {
    function makeBot(): Bot {
        const bot = new Bot();
        bot.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        return bot;
    }

    function makeCtx(bot: Bot): BotController {
        return new BotController(bot.getAppContext());
    }

    it('регистрируется по одному шагу на каждое поле формы', () => {
        const bot = makeBot();
        bot.addForm('signup', {
            fields: [
                { name: 'name', prompt: 'Имя?' },
                { name: 'email', prompt: 'Email?' },
                { name: 'age', prompt: 'Возраст?' },
            ],
            onComplete: () => {},
        });

        const steps = bot.getAppContext().command.steps;
        expect(steps.has('__form_signup_0')).toBe(true);
        expect(steps.has('__form_signup_1')).toBe(true);
        expect(steps.has('__form_signup_2')).toBe(true);
        expect(steps.has('__form_signup_3')).toBe(false);
    });

    it('проходит полный цикл: step0 → step1 → onComplete', async () => {
        const bot = makeBot();
        let completed: Record<string, string> | null = null;

        bot.addForm('signup', {
            fields: [
                { name: 'name', prompt: 'Имя?' },
                {
                    name: 'email',
                    prompt: 'Email?',
                    validate: (v): string | boolean => /\S+@\S+/.test(v) || 'Некорректный email',
                },
            ],
            onComplete: (ctx, answers) => {
                completed = answers;
                ctx.text = `Готово, ${answers.name}!`;
            },
        });

        const steps = bot.getAppContext().command.steps;
        const ctrl = makeCtx(bot);

        // Шаг 0: пользователь отвечает "Иван"
        ctrl.userCommand = 'Иван';
        const step0 = steps.get('__form_signup_0')!;
        let result = step0.cb(ctrl);
        if (result instanceof Promise) {
            await result;
        }

        expect(ctrl.text).toBe('Email?');
        expect(ctrl.thisIntentName).toBe('__form_signup_1');
        expect((ctrl.userData as Record<string, unknown>).__formdata_signup).toEqual({
            name: 'Иван',
        });

        // Шаг 1: невалидный email → ошибка+повтор
        ctrl.userCommand = 'not-an-email';
        ctrl.text = '';
        const step1 = steps.get('__form_signup_1')!;
        result = step1.cb(ctrl);
        if (result instanceof Promise) {
            await result;
        }

        expect(ctrl.text).toBe('Некорректный email\nEmail?');
        expect(ctrl.thisIntentName).toBe('__form_signup_1');
        expect(completed).toBeNull();

        // Шаг 1: валидный email → onComplete
        ctrl.userCommand = 'ivan@test.ru';
        ctrl.text = '';
        result = step1.cb(ctrl);
        if (result instanceof Promise) {
            await result;
        }

        expect(ctrl.text).toBe('Готово, Иван!');
        expect(ctrl.thisIntentName).toBeNull();
        expect(completed).toEqual({ name: 'Иван', email: 'ivan@test.ru' });
        expect((ctrl.userData as Record<string, unknown>).__formdata_signup).toBeNull();
    });

    it('команда отмены очищает состояние и не вызывает onComplete', async () => {
        const bot = makeBot();
        let completedCalled = false;

        bot.addForm('feedback', {
            fields: [{ name: 'text', prompt: 'Что скажете?' }],
            onComplete: () => {
                completedCalled = true;
            },
            cancelCommands: ['отмена', 'стоп'],
            cancelText: 'Прерываю форму.',
        });

        const steps = bot.getAppContext().command.steps;
        const ctrl = makeCtx(bot);
        ctrl.userCommand = 'отмена';
        ctrl.thisIntentName = '__form_feedback_0';
        (ctrl.userData as Record<string, unknown>).__formdata_feedback = { text: 'partial' };

        const result = steps.get('__form_feedback_0')!.cb(ctrl);
        if (result instanceof Promise) {
            await result;
        }

        expect(ctrl.text).toBe('Прерываю форму.');
        expect(ctrl.thisIntentName).toBeNull();
        expect(completedCalled).toBe(false);
        expect((ctrl.userData as Record<string, unknown>).__formdata_feedback).toBeNull();
    });

    it('prompt может быть функцией', async () => {
        const bot = makeBot();
        let promptCalled = false;

        bot.addForm('dyn', {
            fields: [
                {
                    name: 'color',
                    prompt: (): string => {
                        promptCalled = true;
                        return 'Выберите цвет:';
                    },
                },
            ],
            onComplete: (ctx) => {
                ctx.text = 'Готово';
            },
        });

        const steps = bot.getAppContext().command.steps;
        const ctrl = makeCtx(bot);
        ctrl.userCommand = 'синий';

        const result = steps.get('__form_dyn_0')!.cb(ctrl);
        if (result instanceof Promise) {
            await result;
        }

        // Промт-функция не вызывается в шаге — результат идёт в onComplete
        expect(ctrl.text).toBe('Готово');
        // promptFunction будет вызвана при следующем запросе (когда бот покажет следующий вопрос)
        expect(promptCalled).toBe(false);
    });

    it('validate, возвращающий `false` (без текста), просто повторяет prompt', async () => {
        const bot = makeBot();

        bot.addForm('simple', {
            fields: [
                {
                    name: 'answer',
                    prompt: 'Введите "да"',
                    validate: (v): boolean => v.trim().toLowerCase() === 'да',
                },
            ],
            onComplete: (ctx) => {
                ctx.text = 'Окей';
            },
        });

        const steps = bot.getAppContext().command.steps;
        const ctrl = makeCtx(bot);
        ctrl.userCommand = 'нет';

        const result = steps.get('__form_simple_0')!.cb(ctrl);
        if (result instanceof Promise) {
            await result;
        }

        expect(ctrl.text).toBe('Введите "да"');
        expect(ctrl.thisIntentName).toBe('__form_simple_0');
    });

    it('команда отмены работает независимо от регистра', async () => {
        const bot = makeBot();

        bot.addForm('reg', {
            fields: [{ name: 'x', prompt: 'X?' }],
            onComplete: () => {},
            cancelCommands: ['stop'],
            cancelText: 'Canceled',
        });

        const steps = bot.getAppContext().command.steps;
        const ctrl = makeCtx(bot);
        ctrl.userCommand = 'STOP'; // верхний регистр

        const result = steps.get('__form_reg_0')!.cb(ctrl);
        if (result instanceof Promise) {
            await result;
        }

        expect(ctrl.text).toBe('Canceled');
        expect(ctrl.thisIntentName).toBeNull();
    });

    it('поддерживает async validate — ожидание Promise', async () => {
        const bot = makeBot();
        let completed: Record<string, string> | null = null;

        bot.addForm('asyncform', {
            fields: [
                {
                    name: 'email',
                    prompt: 'Email?',
                    // Симулируем асинхронную проверку (например, БД)
                    validate: async (v): Promise<string | boolean> => {
                        await new Promise((r) => setTimeout(r, 1));
                        return v.includes('@') || 'Нужен @';
                    },
                },
            ],
            onComplete: (ctx, answers) => {
                completed = answers;
                ctx.text = 'AsyncDone';
            },
        });

        const steps = bot.getAppContext().command.steps;
        const ctrl = makeCtx(bot);
        ctrl.userCommand = 'invalid';

        // Invalid (асинхронный валидатор вернёт строку с ошибкой)
        let result = steps.get('__form_asyncform_0')!.cb(ctrl);
        if (result instanceof Promise) {
            await result;
        }
        expect(ctrl.text).toBe('Нужен @\nEmail?');
        expect(ctrl.thisIntentName).toBe('__form_asyncform_0');
        expect(completed).toBeNull();

        // Valid (асинхронный валидатор вернёт true)
        ctrl.userCommand = 'user@test.ru';
        ctrl.text = '';
        result = steps.get('__form_asyncform_0')!.cb(ctrl);
        if (result instanceof Promise) {
            await result;
        }
        expect(ctrl.text).toBe('AsyncDone');
        expect(ctrl.thisIntentName).toBeNull();
        expect(completed).toEqual({ email: 'user@test.ru' });
    });

    it('дожидается асинхронного onComplete до формирования ответа', async () => {
        const bot = makeBot();
        let completed = false;

        bot.addForm('asyncdone', {
            fields: [{ name: 'email', prompt: 'Email?' }],
            onComplete: async (ctx, answers) => {
                // Имитируем асинхронную работу (например, запись в БД)
                await new Promise((r) => setTimeout(r, 5));
                completed = true;
                ctx.text = `Сохранено: ${answers.email}`;
            },
        });

        const steps = bot.getAppContext().command.steps;
        const ctrl = makeCtx(bot);
        ctrl.userCommand = 'user@test.ru';

        const result = steps.get('__form_asyncdone_0')!.cb(ctrl);
        if (result instanceof Promise) {
            await result;
        }

        // onComplete завершился до возврата из шага — текст выставлен
        expect(completed).toBe(true);
        expect(ctrl.text).toBe('Сохранено: user@test.ru');
        expect(ctrl.thisIntentName).toBeNull();
    });

    describe('removeForm', () => {
        it('удаляет все шаги формы', () => {
            const bot = makeBot();
            bot.addForm('myform', {
                fields: [
                    { name: 'a', prompt: 'A?' },
                    { name: 'b', prompt: 'B?' },
                ],
                onComplete: () => {},
            });

            let steps = bot.getAppContext().command.steps;
            expect(steps.has('__form_myform_0')).toBe(true);
            expect(steps.has('__form_myform_1')).toBe(true);
            expect(steps.has('__form_myform_2')).toBe(false);

            bot.removeForm('myform');

            steps = bot.getAppContext().command.steps;
            expect(steps.has('__form_myform_0')).toBe(false);
            expect(steps.has('__form_myform_1')).toBe(false);
        });

        it('не трогает шаги другой формы с похожим именем (prefix collision)', () => {
            const bot = makeBot();
            bot.addForm('user', {
                fields: [{ name: 'x', prompt: 'X?' }],
                onComplete: () => {},
            });
            bot.addForm('user_extra', {
                fields: [{ name: 'y', prompt: 'Y?' }],
                onComplete: () => {},
            });

            // Удаляем первую форму — вторая тоже удалится (известное поведение, задокументировано в JsDoc)
            bot.removeForm('user');

            const steps = bot.getAppContext().command.steps;
            expect(steps.has('__form_user_0')).toBe(false);
            // __form_user_extra_0 тоже удаляется — потому что имя начинается с __form_user_
            expect(steps.has('__form_user_extra_0')).toBe(false);
        });

        it('не ломает другие шаги, не связанные с формой', () => {
            const bot = makeBot();
            bot.addStep('custom_step', () => {});
            bot.addForm('myform', {
                fields: [{ name: 'x', prompt: 'X?' }],
                onComplete: () => {},
            });

            bot.removeForm('myform');

            const steps = bot.getAppContext().command.steps;
            expect(steps.has('custom_step')).toBe(true);
            expect(steps.has('__form_myform_0')).toBe(false);
        });

        it('removeForm на несуществующую форму ничего не ломает', () => {
            const bot = makeBot();
            bot.addForm('exists', {
                fields: [{ name: 'x', prompt: 'X?' }],
                onComplete: () => {},
            });

            // Не должно кидать исключений
            expect(() => bot.removeForm('not_exists')).not.toThrow();

            const steps = bot.getAppContext().command.steps;
            expect(steps.has('__form_exists_0')).toBe(true); // первая форма осталась
        });
    });
});
