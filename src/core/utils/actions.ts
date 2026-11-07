import type { AppContext } from '../AppContext';
import type { BotController } from '../../controller';
import type { IButtonAction, TActionData } from '../interfaces/IBot';
import type { ICommandParam } from './CommandReg';

/**
 * Колбеки регистрации действий: реестр команд принадлежит `Bot`,
 * поэтому добавление обработчика приходит снаружи.
 */
export interface IActionFactoryHooks {
    /** Регистрирует обработчик действия (Bot.addAction) */
    addAction: <TBotController extends BotController>(
        actionName: string,
        cb: ICommandParam<TBotController>['cb'],
    ) => void;
}

/** Ключи, приходящие в payload кнопки извне: в данные действия не копируются. */
const FORBIDDEN_DATA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Фабрика действий кнопок с данными: собирает payload `{ action: name, ...data }`
 * и регистрирует обработчик нажатия, который получает уже разобранные данные.
 *
 * Внутренний класс ядра: вызывается из `Bot.defineAction`.
 * @internal
 */
export class ActionFactory {
    readonly #appContext: AppContext;
    readonly #hooks: IActionFactoryHooks;

    constructor(appContext: AppContext, hooks: IActionFactoryHooks) {
        this.#appContext = appContext;
        this.#hooks = hooks;
    }

    /**
     * Создаёт действие кнопки с данными — см. `Bot.defineAction`.
     * @param actionName Имя действия
     * @returns Действие: `addBtn`, `payload`, `handle`
     */
    define<
        TData extends TActionData = TActionData,
        TBotController extends BotController = BotController,
    >(actionName: string): IButtonAction<TData, TBotController> {
        const appContext = this.#appContext;
        // Ключи action/command маршрутизируют нажатие: данные кнопки не могут
        // их перезаписать, иначе кнопка уводила бы запрос в другое действие.
        const reservedWarned = new Set<string>();
        const action: IButtonAction<TData, TBotController> = {
            name: actionName,
            payload: (data) => {
                const payload: Record<string, unknown> = { action: actionName };
                if (data) {
                    for (const key of Object.keys(data)) {
                        if (key === 'action' || key === 'command') {
                            const warnKey = `${actionName}:${key}`;
                            if (!reservedWarned.has(warnKey)) {
                                reservedWarned.add(warnKey);
                                appContext.logWarn(
                                    `Bot.defineAction(): ключ "${key}" в данных действия "${actionName}" зарезервирован для маршрутизации и игнорируется — кнопка всегда ведёт на само действие.`,
                                );
                            }
                            continue;
                        }
                        payload[key] = data[key];
                    }
                }
                return payload;
            },
            addBtn: (buttons, title, data, options = {}) => {
                const payload = action.payload(data);
                if (appContext.platforms?.telegram) {
                    const size = Buffer.byteLength(JSON.stringify(payload));
                    if (size > 64) {
                        appContext.logWarn(
                            `Bot.defineAction(): payload кнопки "${title}" действия "${actionName}" занимает ${size} байт — Telegram принимает не больше 64, кнопка будет пропущена. Сократите данные кнопки.`,
                        );
                    }
                }
                return buttons.addBtn(title, '', payload, options);
            },
            handle: (cb) => {
                this.#hooks.addAction<TBotController>(actionName, (_text, ctx) => {
                    const raw = ctx.payload;
                    const data: Record<string, unknown> = {};
                    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                        for (const key of Object.keys(raw)) {
                            // __proto__/constructor/prototype из payload кнопки не копируем:
                            // data.__proto__ = value подменяет прототип объекта и подсовывает
                            // обработчику атакующие значения через цепочку наследования.
                            if (
                                key === 'action' ||
                                key === 'command' ||
                                FORBIDDEN_DATA_KEYS.has(key)
                            ) {
                                continue;
                            }
                            data[key] = raw[key];
                        }
                    }
                    return cb(data as TData, ctx);
                });
                return action;
            },
        };
        return action;
    }
}
