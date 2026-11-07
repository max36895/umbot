import type { AppContext } from '../AppContext';
import type { BotController } from '../../controller';
import type { IMenu, IMenuOptions, IMenuScreen } from '../interfaces/IBot';
import type { ICommandParam, IStepParam } from './CommandReg';

/**
 * Колбеки регистрации действий и шагов: меню живёт на действии `__menu_<имя>`
 * и шагах `__menu_<имя>_<экран>`, а их реестры принадлежат `Bot`, поэтому
 * добавление приходит снаружи.
 */
export interface IMenuFactoryHooks {
    /** Регистрирует обработчик действия (Bot.addAction) */
    addAction: <TBotController extends BotController>(
        actionName: string,
        cb: ICommandParam<TBotController>['cb'],
    ) => void;
    /** Регистрирует обработчик шага (Bot.addStep) */
    addStep: <TBotController extends BotController>(
        stepName: string,
        cb: IStepParam<TBotController>['cb'],
    ) => void;
}

/**
 * Фабрика меню из экранов: регистрирует действие `__menu_<имя>` для переходов
 * по payload кнопок и по шагу на экран — для переходов текстом/голосом.
 *
 * Внутренний класс ядра: вызывается из `Bot.defineMenu`.
 * @internal
 */
export class MenuFactory {
    readonly #appContext: AppContext;
    readonly #hooks: IMenuFactoryHooks;

    constructor(appContext: AppContext, hooks: IMenuFactoryHooks) {
        this.#appContext = appContext;
        this.#hooks = hooks;
    }

    /**
     * Создаёт меню из экранов — см. `Bot.defineMenu`.
     * @param menuName Имя меню (латиница, коротко: оно входит в payload кнопок)
     * @param options Экраны, экран по умолчанию, текст кнопки «Назад»
     * @returns Меню: `show(ctx, screen?)` и `payload(screen)`
     */
    define<TBotController extends BotController = BotController>(
        menuName: string,
        options: IMenuOptions<TBotController>,
    ): IMenu<TBotController> {
        const { screens } = options;
        const names = Object.keys(screens);
        const backText = options.backText ?? 'Назад';
        const actionName = `__menu_${menuName}`;
        let start = options.start ?? names[0] ?? '';
        if (!Object.hasOwn(screens, start)) {
            this.#appContext.logWarn(
                `Bot.defineMenu(): в меню "${menuName}" нет экрана "${start}" — экраном по умолчанию будет первый.`,
            );
            start = names[0] ?? '';
        }
        const payload = (screen: string): Record<string, unknown> => ({
            action: actionName,
            s: screen,
        });
        this.#checkMenuLinks(menuName, screens, payload);

        const show = (ctx: TBotController, screen?: string): void | Promise<void> => {
            // hasOwn: имя экрана приходит из payload, его может прислать кто угодно
            const name = screen !== undefined && Object.hasOwn(screens, screen) ? screen : start;
            const current = screens[name];
            if (!current) {
                return;
            }
            ctx.text = typeof current.text === 'function' ? current.text(ctx) : current.text;
            for (const button of current.buttons ?? []) {
                if (button.to !== undefined) {
                    ctx.buttons.addBtn(button.title, '', payload(button.to));
                } else if (button.url !== undefined) {
                    ctx.buttons.addLink(button.title, button.url);
                } else {
                    ctx.buttons.addBtn(button.title, '', button.payload);
                }
            }
            if (current.parent !== undefined) {
                ctx.buttons.addBtn(backText, '', payload(current.parent));
            }
            // До onShow: экран может сам перевести диалог дальше (например, запустить форму).
            ctx.thisIntentName = `${actionName}_${name}`;
            return current.onShow?.(ctx);
        };

        this.#hooks.addAction<TBotController>(actionName, (_text, ctx) => {
            const raw = ctx.payload;
            const target =
                raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.s : undefined;
            return show(ctx, typeof target === 'string' ? target : undefined);
        });
        for (const name of names) {
            const screen = screens[name] as IMenuScreen<TBotController>;
            // Ключ — текст кнопки в нижнем регистре: userCommand уже приведён к нему.
            const targets = new Map<string, string>();
            for (const button of screen.buttons ?? []) {
                const title = button.title.trim().toLowerCase();
                if (button.to !== undefined && !targets.has(title)) {
                    targets.set(title, button.to);
                }
            }
            const back = backText.trim().toLowerCase();
            if (screen.parent !== undefined && !targets.has(back)) {
                targets.set(back, screen.parent);
            }
            this.#hooks.addStep<TBotController>(`${actionName}_${name}`, (ctx) => {
                const target = targets.get((ctx.userCommand ?? '').trim());
                return target === undefined ? false : show(ctx, target);
            });
        }
        return { name: menuName, show, payload };
    }

    /**
     * Предупреждает о переходах на несуществующие экраны и о payload длиннее лимита Telegram
     * (проверяется, только когда подключён Telegram-адаптер).
     * @param menuName Имя меню
     * @param screens Экраны меню
     * @param payload Сборка payload перехода
     */
    #checkMenuLinks<TBotController extends BotController>(
        menuName: string,
        screens: Record<string, IMenuScreen<TBotController>>,
        payload: (screen: string) => Record<string, unknown>,
    ): void {
        const missing = new Set<string>();
        const oversized = new Set<string>();
        for (const name of Object.keys(screens)) {
            const screen = screens[name] as IMenuScreen<TBotController>;
            const targets = (screen.buttons ?? []).map((button) => button.to);
            targets.push(screen.parent);
            for (const target of targets) {
                if (target === undefined) {
                    continue;
                }
                if (!Object.hasOwn(screens, target)) {
                    missing.add(target);
                } else if (Buffer.byteLength(JSON.stringify(payload(target))) > 64) {
                    oversized.add(target);
                }
            }
        }
        if (missing.size) {
            this.#appContext.logWarn(
                `Bot.defineMenu(): в меню "${menuName}" есть переходы на несуществующие экраны: ${[...missing].join(', ')}. Такие кнопки ведут на экран по умолчанию.`,
            );
        }
        // Лимит 64 байта есть только у Telegram, без его адаптера предупреждение — шум
        if (oversized.size && this.#appContext.platforms?.telegram) {
            this.#appContext.logWarn(
                `Bot.defineMenu(): payload перехода на экраны ${[...oversized].join(', ')} меню "${menuName}" длиннее 64 байт — Telegram такие кнопки не примет. Сократите имена меню и экранов.`,
            );
        }
    }
}
