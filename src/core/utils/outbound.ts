import type { AppContext } from '../AppContext';
import type { BotController } from '../../controller';
import type { TAppType } from '../interfaces/IAppContext';
import type { IBroadcastOptions, IBroadcastResult, ISendMessage } from '../interfaces/IBot';

/**
 * Сколько отправок bot.broadcast ведёт одновременно: темп задаёт лимит адаптера (sendLimit),
 * а параллельность нужна, чтобы задержка сети не снижала его.
 */
const BROADCAST_CONCURRENCY = 10;

/**
 * Колбек создания контроллера: класс контроллера приложения (`Bot.#getBotController`,
 * с учётом `initBotController`) известен только `Bot`, поэтому создание приходит снаружи.
 */
export interface IOutboundSenderHooks {
    /** Создаёт контроллер для сборки сообщения `ISendMessage` */
    createController: () => BotController;
}

/**
 * Проактивные исходящие сообщения: отправка пользователю (`Bot.send`) и рассылка
 * (`Bot.broadcast`) через адаптер платформы с учётом её лимита отправок (sendLimit).
 *
 * Внутренний класс ядра: вызывается из `Bot.send`/`Bot.broadcast`.
 * @internal
 */
export class OutboundSender {
    readonly #appContext: AppContext;
    readonly #hooks: IOutboundSenderHooks;

    constructor(appContext: AppContext, hooks: IOutboundSenderHooks) {
        this.#appContext = appContext;
        this.#hooks = hooks;
    }

    /**
     * Отправляет сообщение пользователю через адаптер платформы — см. `Bot.send`.
     * @param userId Ид пользователя, которому нужно отправить сообщение
     * @param controllerOrText Текст, сообщение `{ text, tts?, buttons? }` или контроллер
     * @param platform Платформа, на которую необходимо отправить запрос
     * @returns `'ok'` у встроенных чат-платформ либо `false`
     */
    async send(
        userId: string | number,
        controllerOrText: BotController | string | ISendMessage,
        platform: TAppType,
    ): Promise<unknown | boolean> {
        const adapter = this.#appContext.platforms?.[platform];
        if (!adapter) {
            return false;
        }
        return adapter.send(
            userId,
            typeof controllerOrText === 'object' && !('platformOptions' in controllerOrText)
                ? this.#buildMessage(controllerOrText)
                : controllerOrText,
        );
    }

    /**
     * Рассылка одного сообщения многим пользователям через {@link send} — см. `Bot.broadcast`.
     * @param userIds Получатели
     * @param message Текст или фабрика сообщения
     * @param platform Платформа
     * @param options `onResult(userId, ok)` — вызывается после каждой отправки
     * @returns Кому доставлено (`sent`) и кому нет (`failed`)
     */
    async broadcast(
        userIds: readonly (string | number)[],
        message:
            | string
            | ISendMessage
            | ((userId: string | number) => BotController | string | ISendMessage),
        platform: TAppType,
        options: IBroadcastOptions = {},
    ): Promise<IBroadcastResult> {
        const result: IBroadcastResult = { sent: [], failed: [] };
        let next = 0;
        const worker = async (): Promise<void> => {
            while (next < userIds.length) {
                const userId = userIds[next++] as string | number;
                let ok = false;
                try {
                    const content = typeof message === 'function' ? message(userId) : message;
                    ok = (await this.send(userId, content, platform)) !== false;
                } catch (e) {
                    this.#appContext.logError(
                        `Bot.broadcast(): не удалось отправить сообщение пользователю "${userId}": ${(e as Error).message}`,
                        { error: e },
                    );
                }
                (ok ? result.sent : result.failed).push(userId);
                try {
                    await options.onResult?.(userId, ok);
                } catch (e) {
                    this.#appContext.logError(
                        `Bot.broadcast(): ошибка в onResult для пользователя "${userId}": ${(e as Error).message}`,
                        { error: e },
                    );
                }
            }
        };
        const workers = Math.min(BROADCAST_CONCURRENCY, userIds.length);
        await Promise.all(Array.from({ length: workers }, worker));
        return result;
    }

    /**
     * Собирает контроллер из сообщения {@link ISendMessage}.
     * @param message Сообщение
     * @returns Контроллер с текстом и кнопками
     */
    #buildMessage(message: ISendMessage): BotController {
        const controller = this.#hooks.createController();
        controller.text = message.text;
        if (message.tts) {
            controller.tts = message.tts;
        }
        for (const button of message.buttons ?? []) {
            if (typeof button === 'string') {
                controller.buttons.addBtn(button);
            } else {
                controller.buttons.addBtn(
                    button.title,
                    button.url ?? '',
                    button.payload ?? '',
                    button.options ?? {},
                );
            }
        }
        return controller;
    }
}
