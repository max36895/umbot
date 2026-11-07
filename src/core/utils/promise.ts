/**
 * Общие хелперы для работы с промисами во внутренних подсистемах ядра.
 * @internal
 */

/**
 * Ждёт завершения промиса, но не дольше `ms`. Отказ промиса не пробрасывается.
 * @param promise Промис, завершения которого ждём
 * @param ms Предел ожидания, мс
 * @returns Значение промиса; `undefined` — промис отклонён или предел истёк
 */
export function waitWithLimit<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), ms);
        timer.unref();
        const done = (value?: T): void => {
            clearTimeout(timer);
            resolve(value);
        };
        promise.then(done, () => done());
    });
}

/**
 * Пауза, которая завершается досрочно при остановке по сигналу.
 * Таймер без `unref()`: пауза между запросами обновлений должна держать процесс,
 * как держит его сам запрос long polling.
 * @param ms Длительность паузы, мс
 * @param signal Сигнал остановки
 * @returns Промис, выполненный по истечении паузы или при остановке
 */
export function delayUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) {
            resolve();
            return;
        }
        const onAbort = (): void => {
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
