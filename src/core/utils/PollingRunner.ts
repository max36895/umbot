import type { AppContext } from '../AppContext';
import type { TAppType } from '../interfaces/IAppContext';
import type { IPlatformAdapter, IPollingOptions, TRunResult } from '../interfaces/IBot';
import { BotBadRequestError } from './errors';
import { delayUnlessAborted } from './promise';

/** Пауза перед первым повтором запроса обновлений после ошибки (long polling), мс. */
const POLLING_RETRY_MIN_DELAY = 1000;
/** Максимальная пауза между повторами запроса обновлений, мс. */
const POLLING_RETRY_MAX_DELAY = 30_000;
/**
 * Минимальный интервал между пустыми ответами адаптера на запрос обновлений, мс.
 * Защищает от холостого цикла, если адаптер отвечает сразу, не дожидаясь обновлений.
 */
const POLLING_MIN_EMPTY_INTERVAL = 500;
/**
 * Сколько обновлений одной пачки long polling обрабатывается одновременно: пачка
 * до 1000 событий (MAX) не должна запускать 1000 обработчиков разом.
 */
const POLLING_CONCURRENCY = 32;

/**
 * Обработка одного обновления, полученного long polling (в `Bot` это `run`).
 * Создаётся один раз при создании `PollingRunner` — не на каждое обновление.
 */
export type TPollingRun = (appType: TAppType, update: object) => Promise<TRunResult>;

/**
 * Циклы long polling платформ: бот сам запрашивает обновления у платформ вместо
 * приёма вебхука. Polling работает на платформах, адаптер которых реализует
 * `getUpdates`: Telegram, VK и MAX.
 *
 * Цикл живёт здесь, протокол платформы — в адаптере (`getUpdates`). Остановка
 * обрывает текущий запрос через `AbortSignal` и ждёт обработки полученной пачки;
 * состояние цикла сбрасывается сразу, чтобы повторный старт во время остановки
 * запускал новый цикл. Пауза между попытками — `delayUnlessAborted` (держит
 * процесс, прерывается сигналом). Обработка пачки параллельна, но ограничена
 * (`POLLING_CONCURRENCY`) и сохраняет порядок событий одного пользователя.
 *
 * Внутренний класс ядра: вызывается из `Bot.startPolling`/`Bot.stopPolling`.
 * Создаётся лениво — бот на вебхуках не платит аллокацией за polling.
 * @internal
 */
export class PollingRunner {
    readonly #appContext: AppContext;
    readonly #runUpdate: TPollingRun;
    /**
     * Действие перед стартом циклов (в `Bot` — подписка на SIGTERM/SIGINT).
     * Живёт колбеком: сам механизм сигналов общий с HTTP-сервером.
     */
    readonly #onBeforeStart: () => void;

    /**
     * Остановка запущенного long polling; `null` — polling не запущен.
     */
    #abort: AbortController | null = null;

    /**
     * Завершение всех циклов long polling (см. {@link start}).
     */
    #done: Promise<void> | null = null;

    constructor(appContext: AppContext, runUpdate: TPollingRun, onBeforeStart: () => void) {
        this.#appContext = appContext;
        this.#runUpdate = runUpdate;
        this.#onBeforeStart = onBeforeStart;
    }

    /**
     * Запускает циклы long polling для выбранных платформ. Повторный вызов при
     * запущенном polling возвращает тот же промис.
     * @param options Параметры запуска: `platforms` — для каких платформ запустить
     *   polling (по умолчанию — все подключённые адаптеры с поддержкой polling)
     * @returns Промис, который выполняется, когда polling остановлен, и отклоняется,
     *   если ни один выбранный адаптер не поддерживает polling
     */
    start(options: IPollingOptions = {}): Promise<void> {
        const platforms = options.platforms;
        if (this.#done) {
            this.#appContext.logWarn('Bot:startPolling(): long polling уже запущен.');
            return this.#done;
        }
        const adapters = Object.values(this.#appContext.platforms).filter(
            (adapter) =>
                typeof adapter.getUpdates === 'function' &&
                (!platforms || platforms.includes(adapter.platformName)),
        );
        if (adapters.length === 0) {
            const msg =
                'Bot:startPolling(): нет подключённых адаптеров с поддержкой long polling' +
                (platforms ? ` среди платформ: ${platforms.join(', ')}` : '') +
                '. Polling поддерживают Telegram, VK и MAX; остальные платформы работают через вебхук (bot.start()).';
            this.#appContext.logError(msg);
            return Promise.reject(new Error(msg));
        }
        const abort = new AbortController();
        this.#abort = abort;
        this.#onBeforeStart();
        this.#appContext.log(
            `Bot: long polling запущен (${adapters.map((a) => a.platformName).join(', ')}).`,
        );
        const done = Promise.all(
            adapters.map((adapter) => this.#pollLoop(adapter, abort.signal)),
        ).then(() => {
            if (this.#abort === abort) {
                this.#abort = null;
                this.#done = null;
            }
        });
        this.#done = done;
        return done;
    }

    /**
     * Останавливает long polling: обрывает текущие запросы за обновлениями и ждёт,
     * пока обработаются уже полученные. Без запущенного polling ничего не делает.
     * @returns Промис, выполненный после остановки всех циклов polling
     */
    async stop(): Promise<void> {
        const abort = this.#abort;
        const done = this.#done;
        if (!abort || !done) {
            return;
        }
        // Состояние сбрасывается сразу: start() во время остановки запускает
        // новый polling, а не возвращает промис останавливаемого.
        this.#abort = null;
        this.#done = null;
        abort.abort();
        await done;
        this.#appContext.log('Bot: long polling остановлен.');
    }

    /**
     * Цикл long polling одной платформы: запрос обновлений, обработка пачки, повтор.
     * Ошибка запроса — повтор с растущей паузой; `null` от адаптера — остановка цикла.
     * Не бросает исключений: промис всех циклов в {@link start} не отклоняется.
     * @param adapter Адаптер платформы с `getUpdates`
     * @param signal Сигнал остановки
     */
    async #pollLoop(adapter: IPlatformAdapter, signal: AbortSignal): Promise<void> {
        let failures = 0;
        while (!signal.aborted) {
            const startedAt = Date.now();
            let updates: unknown[] | null;
            try {
                updates = (await adapter.getUpdates?.(signal)) ?? null;
            } catch (error) {
                if (signal.aborted) {
                    break;
                }
                failures++;
                const delay = Math.min(
                    POLLING_RETRY_MIN_DELAY * 2 ** (failures - 1),
                    POLLING_RETRY_MAX_DELAY,
                );
                this.#appContext.logError(
                    `Bot: не удалось получить обновления "${adapter.platformName}" (long polling): ${
                        error instanceof Error ? error.message : String(error)
                    }. Повтор через ${delay} мс.`,
                    { error },
                );
                await delayUnlessAborted(delay, signal);
                continue;
            }
            if (updates === null) {
                if (!signal.aborted) {
                    this.#appContext.logError(
                        `Bot: long polling "${adapter.platformName}" остановлен: адаптер не может получать обновления (причина — выше в логе).`,
                    );
                }
                break;
            }
            failures = 0;
            if (updates.length > 0) {
                // Полученную пачку обрабатываем и при остановке: иначе обновления потерялись бы.
                await this.#runPolledBatch(adapter, updates);
            } else if (Date.now() - startedAt < POLLING_MIN_EMPTY_INTERVAL) {
                await delayUnlessAborted(POLLING_MIN_EMPTY_INTERVAL, signal);
            }
        }
    }

    /**
     * Обрабатывает пачку обновлений не более чем {@link POLLING_CONCURRENCY} одновременно.
     * Обработка начинается в порядке пачки, поэтому очередь пользователя сохраняет
     * порядок его обновлений.
     * @param adapter Адаптер платформы
     * @param updates Обновления пачки
     */
    async #runPolledBatch(adapter: IPlatformAdapter, updates: unknown[]): Promise<void> {
        let next = 0;
        const worker = async (): Promise<void> => {
            while (next < updates.length) {
                const update = updates[next++];
                await this.#runPolledUpdate(adapter, update);
            }
        };
        const workers = Math.min(POLLING_CONCURRENCY, updates.length);
        await Promise.all(Array.from({ length: workers }, worker));
    }

    /**
     * Обрабатывает одно обновление, полученное long polling. Ошибка обработки
     * не останавливает polling: она пишется в лог, как 500 у вебхука.
     * Дедупликации доставок здесь нет: платформа не повторяет обновление, пока адаптер
     * не отступит назад позицией чтения, а позиция только растёт.
     * @param adapter Адаптер платформы
     * @param update Обновление в формате тела вебхука
     */
    async #runPolledUpdate(adapter: IPlatformAdapter, update: unknown): Promise<void> {
        try {
            await this.#runUpdate(adapter.platformName, update as object);
        } catch (error) {
            // Некорректное обновление уже записано в лог обработчиком.
            if (!(error instanceof BotBadRequestError)) {
                this.#appContext.logError(
                    `Bot: ошибка обработки обновления "${adapter.platformName}" (long polling): ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                    { error },
                );
            }
        }
    }
}
