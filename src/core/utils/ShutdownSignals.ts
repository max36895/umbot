/**
 * Подписки на SIGTERM/SIGINT для graceful shutdown.
 *
 * Механизм общий для HTTP-сервера и long polling: оба вызывают {@link ensure}
 * при старте, поэтому повторный `start()`/`startPolling()` не копит обработчики —
 * прежние подписки снимаются.
 *
 * Внутренний класс ядра: владелец — `Bot`, колбек выключения (`#gracefulShutdown`)
 * остаётся на уровне приложения.
 * @internal
 */
export class ShutdownSignals {
    /**
     * Обработчики сигналов для удаления при повторном ensure()
     */
    #sigtermHandler: (() => void) | null = null;
    #sigintHandler: (() => void) | null = null;

    /**
     * Таймер страховочного выхода; `null` — не взведён или уже снят.
     */
    #forceExitTimer: ReturnType<typeof setTimeout> | null = null;

    readonly #onShutdown: () => void;

    constructor(onShutdown: () => void) {
        this.#onShutdown = onShutdown;
    }

    /**
     * Подписывает graceful shutdown на SIGTERM/SIGINT: при завершении процесса
     * закрываются подключения и освобождаются ресурсы. Прежние обработчики
     * снимаются — повторный start() или startPolling() не копит подписки.
     */
    ensure(): void {
        if (this.#sigtermHandler) {
            process.removeListener('SIGTERM', this.#sigtermHandler);
        }
        if (this.#sigintHandler) {
            process.removeListener('SIGINT', this.#sigintHandler);
        }
        this.#sigtermHandler = this.#onShutdown;
        this.#sigintHandler = this.#onShutdown;
        process.once('SIGTERM', this.#sigtermHandler);
        process.once('SIGINT', this.#sigintHandler);
    }

    /**
     * Взводит страховку принудительного выхода: если после graceful shutdown
     * event loop продолжают держать чужие дескрипторы (плагины, БД-драйверы),
     * процесс всё равно завершится через `ms`. Таймер unref'нут: при чистом
     * цикле процесс выходит сам, не дожидаясь тайм-аута.
     * @param ms Через сколько миллисекунд принудительно выйти
     */
    armForceExit(ms: number): void {
        if (this.#forceExitTimer) {
            clearTimeout(this.#forceExitTimer);
        }
        this.#forceExitTimer = setTimeout(() => {
            this.#forceExitTimer = null;
            process.exit(0);
        }, ms);
        this.#forceExitTimer.unref();
    }

    /**
     * Снимает подписки на SIGTERM/SIGINT и страховку выхода. Без подписок ничего не делает.
     */
    remove(): void {
        if (this.#sigtermHandler) {
            process.removeListener('SIGTERM', this.#sigtermHandler);
            this.#sigtermHandler = null;
        }
        if (this.#sigintHandler) {
            process.removeListener('SIGINT', this.#sigintHandler);
            this.#sigintHandler = null;
        }
        if (this.#forceExitTimer) {
            clearTimeout(this.#forceExitTimer);
            this.#forceExitTimer = null;
        }
    }
}
