import type { BotController } from '../../controller';
import type { IPlatformAdapter, TRunResult } from '../interfaces/IBot';
import { waitWithLimit } from './promise';

/**
 * Сколько запрос ждёт завершения предыдущего запроса того же пользователя, мс.
 * Предел нужен, чтобы зависший обработчик не блокировал пользователя навсегда:
 * после него запрос выполняется, не дожидаясь предыдущего.
 */
const USER_QUEUE_MAX_WAIT = 10_000;

/**
 * Сколько записей очередей копится до чистки свободных. Свободные записи не
 * удаляются сразу: удаление и новая вставка на каждый запрос дороже, чем редкая
 * пакетная чистка.
 */
const USER_QUEUE_SWEEP_SIZE = 1024;

/**
 * Состояние очереди запросов одного пользователя (см. `UserQueues.run`).
 * Запись переиспользуется, пока пользователь активен: без удаления и повторной
 * вставки в Map на каждый запрос.
 */
export interface IUserQueueEntry {
    /** Последний запрос пользователя — его ждёт следующий запрос */
    run: Promise<unknown>;
    /** Контроллер выполняющегося запроса; `null` — очередь свободна */
    owner: object | null;
}

/** Уже выполненный промис — начальное значение `IUserQueueEntry.run`. */
const RESOLVED_QUEUE: Promise<unknown> = Promise.resolve();

/**
 * Запуск обработки запроса. Создаётся один раз при создании `UserQueues`
 * (в `Bot` это `#runApp`) — не на каждый запрос.
 *
 * Контроллер типизирован базовым `BotController`, без дженериков `Bot`: иначе
 * `#userQueues` делал бы `Bot<TUserData, TPlatformState>` несовместимым с
 * `Bot<IUserData, IPlatformData>` (дженерик в контравариантной позиции раннера),
 * и `plugin(bot)` переставал бы компилироваться. Класс оперирует только
 * `userId`, поэтому конкретная параметризация контроллера ему безразлична.
 */
export type TQueueRunner = (
    botController: BotController,
    platformClass: IPlatformAdapter,
    appType: string,
    queueEntry: IUserQueueEntry | null,
) => Promise<TRunResult>;

/**
 * Очереди запросов пользователей: запросы одного пользователя выполняются по
 * очереди. Без очереди два параллельных апдейта одного пользователя (двойное
 * нажатие кнопки, повторная доставка, несколько соединений вебхука) читают один
 * и тот же userData, и изменения первого теряются. Очередь живёт в памяти
 * процесса: при нескольких репликах нужна маршрутизация пользователя на одну
 * реплику.
 *
 * Запись очереди освобождает сама обработка запроса (`runner` получает `entry`
 * и сбрасывает `entry.owner` в своём finally — без `.finally` у промиса и без
 * удаления из Map на каждый запрос); свободные записи удаляются пакетно —
 * {@link UserQueues.sweep}.
 *
 * Внутренний класс ядра: вызывается из конвейера запроса `Bot`.
 * @internal
 */
export class UserQueues {
    readonly #runner: TQueueRunner;

    /**
     * Очереди запросов пользователей: платформа → userId → состояние очереди.
     *
     * Две карты вместо ключа `платформа:userId`: поиск по свежесклеенной строке
     * длиннее 12 символов в V8 в разы дороже (строка сначала «сплющивается»).
     */
    readonly #queues = new Map<string, Map<string, IUserQueueEntry>>();

    /** Число записей во всех очередях (для чистки свободных записей). */
    #size = 0;

    /**
     * Размер, при котором запустится следующая чистка. После чистки — не меньше
     * удвоенного числа оставшихся записей: при тысячах одновременных запросов
     * освобождать нечего, и чистка на каждого нового пользователя дала бы O(n²).
     */
    #sweepAt = USER_QUEUE_SWEEP_SIZE;

    constructor(runner: TQueueRunner) {
        this.#runner = runner;
    }

    /**
     * Выполняет запрос после завершения предыдущего запроса того же пользователя.
     * Не `async`: промис обработки возвращается напрямую, без лишнего async-кадра
     * на пути запроса.
     *
     * @param botController Контроллер запроса
     * @param platformClass Адаптер платформы
     * @param appType Тип платформы
     * @returns Промис ответа платформы
     */
    run(
        botController: BotController,
        platformClass: IPlatformAdapter,
        appType: string,
    ): Promise<TRunResult> {
        const userId = botController.userId;
        if (userId === null || userId === undefined || userId === '') {
            return this.#runner(botController, platformClass, appType, null);
        }
        let queues = this.#queues.get(appType);
        if (queues === undefined) {
            queues = new Map();
            this.#queues.set(appType, queues);
        }
        const key = String(userId);
        let entry = queues.get(key);
        let previous: Promise<unknown> | null = null;
        if (entry === undefined) {
            if (this.#size >= this.#sweepAt) {
                this.sweep();
            }
            entry = { run: RESOLVED_QUEUE, owner: botController };
            queues.set(key, entry);
            this.#size++;
        } else if (entry.owner === null) {
            entry.owner = botController;
        } else {
            // Предыдущий запрос ещё выполняется: ждём его через его же запись,
            // а для себя заводим новую — её освободит уже наша обработка.
            previous = entry.run;
            entry = { run: RESOLVED_QUEUE, owner: botController };
            queues.set(key, entry);
        }
        const ownEntry = entry;
        let run: Promise<TRunResult>;
        const maxWait = previous === null ? 0 : this.#getWait(platformClass, botController);
        if (previous !== null && maxWait > 0) {
            // Ожидающий получает отказ предыдущего запроса как обычное завершение
            // (waitWithLimit): ошибка одного запроса не роняет следующие.
            run = waitWithLimit(previous, maxWait).then(() =>
                this.#runner(botController, platformClass, appType, ownEntry),
            );
        } else {
            run = this.#runner(botController, platformClass, appType, ownEntry);
        }
        ownEntry.run = run;
        return run;
    }

    /**
     * Удаляет свободные записи очередей пользователей. Вызывается, когда записей
     * накопилось {@link sweepAt}: память ограничена, а удаление идёт
     * пакетом, а не на каждом запросе.
     */
    sweep(): void {
        let size = 0;
        for (const queues of this.#queues.values()) {
            for (const [key, entry] of queues) {
                if (entry.owner === null) {
                    queues.delete(key);
                }
            }
            size += queues.size;
        }
        this.#size = size;
        this.#sweepAt = Math.max(USER_QUEUE_SWEEP_SIZE, size * 2);
    }

    /**
     * Сколько запрос ждёт предыдущий запрос того же пользователя.
     *
     * Без срока ответа у платформы — {@link USER_QUEUE_MAX_WAIT}. Если платформа ждёт ответ
     * ограниченное время (`getResponseTimeout`, голосовые платформы), на ожидание уходит
     * не больше половины оставшегося времени: вторая половина остаётся на сам запрос.
     *
     * @param adapter Адаптер платформы запроса
     * @param controller Контроллер запроса (время начала обработки)
     * @returns Предел ожидания, мс; `0` — не ждать
     */
    #getWait(adapter: IPlatformAdapter, controller: BotController): number {
        const timeout = adapter.getResponseTimeout?.() ?? null;
        if (timeout === null) {
            return USER_QUEUE_MAX_WAIT;
        }
        const remaining = timeout - adapter.getProcessingTime(controller);
        return Math.max(0, Math.min(USER_QUEUE_MAX_WAIT, remaining / 2));
    }
}
