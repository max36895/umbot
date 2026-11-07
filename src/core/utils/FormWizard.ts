import type { AppContext } from '../AppContext';
import type { BotController } from '../../controller';
import type { IAddFormField, IAddFormOptions, TFormContext } from '../interfaces/IBot';
import type { IStepParam } from './CommandReg';

/**
 * Зарегистрированная форма с подготовленными настройками (для шагов addForm).
 */
interface IFormRuntime {
    /** Имя формы */
    name: string;
    /** Настройки формы */
    form: IAddFormOptions<BotController, Record<string, unknown>>;
    /** Команды отмены в нижнем регистре */
    cancelCommands: string[];
    /** Текст отмены */
    cancelText: string;
    /** Надпись кнопки пропуска в нижнем регистре */
    skipText: string;
}

/**
 * Колбеки регистрации шагов: форма живёт на шагах (`__form_<formName>_<idx>`),
 * а реестр шагов принадлежит `Bot`, поэтому добавление/удаление приходят снаружи.
 */
export interface IFormWizardHooks {
    /** Добавляет шаг (Bot.addStep) */
    addStep: (stepName: string, handler: IStepParam['cb']) => void;
    /** Удаляет шаг (Bot.removeStep) */
    removeStep: (stepName: string) => void;
}

/**
 * Движок многошаговых форм (опросников): хранит реестр форм и обрабатывает
 * шаги `__form_<formName>_<idx>` — отмена, выход по чужой кнопке (`escape`),
 * пропуск, проверка и переход к следующему полю.
 *
 * Состояние формы (частичные ответы) лежит в `ctx.userData.__formdata_<formName>`,
 * контекст — в `ctx.userData.__formctx_<formName>`; после заполнения или отмены
 * поля получают значение `null` (не удаляются: Алиса очищает поле
 * `user_state_update` только значением `null`).
 *
 * Внутренний класс ядра: вызывается из `Bot.addForm`/`startForm`/`removeForm`/`clearSteps`.
 * @internal
 */
export class FormWizard {
    readonly #appContext: AppContext;
    readonly #hooks: IFormWizardHooks;

    /**
     * Зарегистрированные формы (addForm): нужны startForm, чтобы задать первый вопрос.
     */
    readonly #forms = new Map<string, IAddFormOptions<BotController, Record<string, unknown>>>();

    constructor(appContext: AppContext, hooks: IFormWizardHooks) {
        this.#appContext = appContext;
        this.#hooks = hooks;
    }

    /**
     * Регистрирует форму и создаёт по шагу на каждое поле.
     * @param formName Уникальное имя формы
     * @param form Настройки формы (уже приведённые к базовому контроллеру)
     */
    add(formName: string, form: IAddFormOptions<BotController, Record<string, unknown>>): void {
        this.#forms.set(formName, form);
        const runtime: IFormRuntime = {
            name: formName,
            form,
            cancelCommands: (form.cancelCommands ?? ['отмена', 'cancel']).map((s) =>
                s.toLowerCase(),
            ),
            cancelText: form.cancelText ?? 'Форма отменена.',
            skipText: (form.skipText ?? 'Пропустить').toLowerCase(),
        };
        form.fields.forEach((_field, index) => {
            this.#hooks.addStep(`__form_${formName}_${index}`, (ctx: BotController) =>
                this.#runFormStep(ctx, runtime, index),
            );
        });
    }

    /**
     * Запускает форму: задаёт первый вопрос и переводит пользователя на шаг
     * первого поля. Ответы прошлой незавершённой попытки сбрасываются.
     * @param ctx Контроллер текущего запроса
     * @param formName Имя формы
     * @param context Данные для формы (хранятся в `userData` до конца формы)
     * @returns `true`, если форма запущена; `false`, если форма не найдена или в ней нет полей
     */
    start(ctx: BotController, formName: string, context: TFormContext = {}): boolean {
        const form = this.#forms.get(formName);
        const firstField = form?.fields[0];
        if (!form || !firstField) {
            this.#appContext.logWarn(
                `Bot.startForm(): форма "${formName}" не зарегистрирована или не содержит полей.`,
            );
            return false;
        }
        const dataRec = ctx.userData as unknown as Record<string, unknown>;
        dataRec[`__formdata_${formName}`] = {};
        const contextKey = `__formctx_${formName}`;
        if (Object.keys(context).length) {
            dataRec[contextKey] = context;
        } else if (dataRec[contextKey] !== undefined) {
            dataRec[contextKey] = null;
        }
        ctx.thisIntentName = `__form_${formName}_0`;
        this.#askFormField(ctx, form, firstField, context, null);
        return true;
    }

    /**
     * Удаляет форму по имени вместе с её шагами. Сравнение идёт по префиксу
     * `__form_<formName>_` — см. предупреждение в `Bot.removeForm`.
     * @param formName Имя формы
     */
    remove(formName: string): void {
        this.#forms.delete(formName);
        const stepPrefix = `__form_${formName}_`;
        this.#appContext.steps.forEach((step) => {
            if (step.stepName.startsWith(stepPrefix)) {
                this.#hooks.removeStep(step.stepName);
            }
        });
    }

    /**
     * Очищает реестр форм. Вызывается из `Bot.clearSteps` — сами шаги уже удалены там.
     */
    clear(): void {
        this.#forms.clear();
    }

    /**
     * Обрабатывает ответ на поле формы: отмена, выход по чужой кнопке (`escape`), пропуск,
     * проверка ответа и переход к следующему полю.
     * @param ctx Контроллер
     * @param runtime Форма
     * @param index Номер поля
     * @returns `false` — запрос уходит обычному конвейеру (выход по `escape`)
     */
    #runFormStep(
        ctx: BotController,
        runtime: IFormRuntime,
        index: number,
    ): void | false | Promise<void | false> {
        const field = runtime.form.fields[index] as IAddFormField;
        const userText = (ctx.userCommand ?? '').trim().toLowerCase();
        if (runtime.cancelCommands.includes(userText)) {
            this.#finishForm(ctx, runtime.name);
            ctx.text = runtime.cancelText;
            return;
        }
        // Исходная реплика нужна для вариантов со знаками препинания: Алиса убирает их из command.
        const originalText = (ctx.originalUserCommand ?? '').trim().toLowerCase();
        const isAnswer = (variant: string): boolean => {
            const lower = variant.toLowerCase();
            return lower === userText || lower === originalText;
        };
        const isSkip = field.optional === true && isAnswer(runtime.skipText);
        const optionIndex = field.options ? field.options.findIndex(isAnswer) : -1;
        if (
            runtime.form.escape &&
            !isSkip &&
            optionIndex === -1 &&
            (ctx.eventType === 'callback' ||
                this.#appContext.command.getExactMatchCommand(userText) !== undefined)
        ) {
            // Чужая кнопка или команда: выходим из формы, запрос обработают команды.
            this.#finishForm(ctx, runtime.name);
            return false;
        }
        if (isSkip) {
            return this.#nextFormField(ctx, runtime, index, null);
        }
        return this.#readFormAnswer(ctx, runtime, field, optionIndex).then((result) => {
            if ('error' in result) {
                this.#askFormField(
                    ctx,
                    runtime.form,
                    field,
                    this.#formContext(ctx, runtime.name),
                    result.error,
                );
                // Остаёмся на этом же шаге: на следующий запрос пользователь попадёт сюда.
                ctx.thisIntentName = `__form_${runtime.name}_${index}`;
                return;
            }
            return this.#nextFormField(ctx, runtime, index, result);
        });
    }

    /**
     * Проверяет ответ на поле: вариант из `options`, `validate`, затем `parse`.
     * @param ctx Контроллер
     * @param runtime Форма
     * @param field Поле
     * @param optionIndex Номер выбранного варианта (-1 — не вариант)
     * @returns Значение для ответов или ошибка (null — повторить вопрос без текста ошибки)
     */
    async #readFormAnswer(
        ctx: BotController,
        runtime: IFormRuntime,
        field: IAddFormField,
        optionIndex: number,
    ): Promise<{ value: unknown } | { error: string | null }> {
        // Ответ сохраняем в исходном регистре: userCommand адаптеры приводят
        // к нижнему регистру, что исказило бы имена, email и адреса.
        let answerText = (ctx.originalUserCommand ?? ctx.userCommand ?? '').trim();
        if (field.options) {
            if (optionIndex === -1) {
                return { error: runtime.form.invalidOptionText ?? 'Выберите один из вариантов.' };
            }
            answerText = field.options[optionIndex] as string;
        }
        if (field.validate) {
            const isValid = await field.validate(answerText);
            if (isValid !== true) {
                return { error: typeof isValid === 'string' ? isValid : null };
            }
        }
        return field.parse ? field.parse(answerText, ctx) : { value: answerText };
    }

    /**
     * Сохраняет ответ и задаёт следующий вопрос; после последнего поля завершает форму
     * и вызывает `onComplete`.
     * @param ctx Контроллер
     * @param runtime Форма
     * @param index Номер текущего поля
     * @param answer Ответ (`null` — поле пропущено)
     * @returns Промис `onComplete`, если форма завершена
     */
    #nextFormField(
        ctx: BotController,
        runtime: IFormRuntime,
        index: number,
        answer: { value: unknown } | null,
    ): void | Promise<void> {
        const { form, name } = runtime;
        const dataRec = ctx.userData as unknown as Record<string, unknown>;
        const answers = (dataRec[`__formdata_${name}`] ?? {}) as Record<string, unknown>;
        if (answer) {
            answers[(form.fields[index] as IAddFormField).name] = answer.value;
        }
        dataRec[`__formdata_${name}`] = answers;
        const context = this.#formContext(ctx, name);
        const nextField = form.fields[index + 1];
        if (!nextField) {
            this.#finishForm(ctx, name);
            // Возвращаем промис onComplete: шаг дождётся его, иначе async-колбек не успеет
            // выставить ctx.text до формирования ответа.
            return form.onComplete(ctx, answers, context);
        }
        ctx.thisIntentName = `__form_${name}_${index + 1}`;
        this.#askFormField(ctx, form, nextField, context, null);
    }

    /**
     * Контекст формы из `userData` (`{}`, если форма запущена без контекста).
     * @param ctx Контроллер
     * @param formName Имя формы
     * @returns Контекст
     */
    #formContext(ctx: BotController, formName: string): TFormContext {
        const dataRec = ctx.userData as unknown as Record<string, unknown>;
        return (dataRec[`__formctx_${formName}`] ?? {}) as TFormContext;
    }

    /**
     * Завершает форму: очищает ответы и контекст, снимает шаг.
     * @param ctx Контроллер
     * @param formName Имя формы
     */
    #finishForm(ctx: BotController, formName: string): void {
        const dataRec = ctx.userData as unknown as Record<string, unknown>;
        // null, а не delete: Алиса (user_state_update) удаляет поле
        // из состояния пользователя только при значении null.
        dataRec[`__formdata_${formName}`] = null;
        if (dataRec[`__formctx_${formName}`] !== undefined) {
            dataRec[`__formctx_${formName}`] = null;
        }
        ctx.thisIntentName = null;
    }

    /**
     * Задаёт вопрос поля формы: текст (с ошибкой прошлого ответа, если есть), кнопки
     * вариантов и кнопка пропуска необязательного поля.
     * @param ctx Контроллер
     * @param form Настройки формы
     * @param field Поле
     * @param context Контекст формы
     * @param error Текст ошибки прошлого ответа или null
     */
    #askFormField(
        ctx: BotController,
        form: IAddFormOptions<BotController, Record<string, unknown>>,
        field: IAddFormField,
        context: TFormContext,
        error: string | null,
    ): void {
        const promptText =
            typeof field.prompt === 'function' ? field.prompt(ctx, context) : field.prompt;
        ctx.text = (error ? `${error}\n` : '') + promptText;
        for (const option of field.options ?? []) {
            ctx.buttons.addBtn(option);
        }
        if (field.optional) {
            ctx.buttons.addBtn(form.skipText ?? 'Пропустить');
        }
    }
}
