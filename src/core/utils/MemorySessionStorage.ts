/**
 * Настройки сессии в памяти процесса.
 *
 * @example
 * ```ts
 * bot.setAppConfig({
 *     isLocalStorage: true,
 *     memorySession: { maxSize: 50_000, ttl: 60 * 60 * 1000 }, // 50 тыс. пользователей, 1 час
 * });
 * ```
 */
export interface IMemorySessionConfig {
    /**
     * Максимальное количество пользователей в памяти. При превышении вытесняется
     * пользователь, данные которого дольше всех не обновлялись.
     * @defaultValue 10000
     */
    maxSize?: number;
    /**
     * Время жизни данных пользователя в миллисекундах, отсчитывается от последнего
     * запроса пользователя. `0` — без ограничения по времени (остаётся только `maxSize`).
     * @defaultValue 86400000 (24 часа)
     */
    ttl?: number;
}

/** Количество пользователей в сессии по умолчанию. */
export const MEMORY_SESSION_MAX_SIZE = 10_000;
/** Время жизни данных пользователя по умолчанию — 24 часа. */
export const MEMORY_SESSION_TTL = 24 * 60 * 60 * 1000;

/** Запись сессии — одновременно узел списка «по давности обновления». */
interface IMemorySessionEntry<T> {
    key: string;
    value: T;
    expiresAt: number;
    /** Предыдущая (обновлялась раньше) запись списка */
    prev: IMemorySessionEntry<T> | null;
    /** Следующая (обновлялась позже) запись списка */
    next: IMemorySessionEntry<T> | null;
}

/**
 * Хранилище `userData` в памяти процесса — аналог `MemorySessionStorage` у grammY.
 *
 * Используется ядром, когда включён `isLocalStorage`, платформа не поддерживает
 * локальное хранилище (Telegram, VK, MAX, Viber), а DB-адаптер не подключён.
 *
 * Ограничения — те же, что у любой сессии в памяти:
 * - данные теряются при перезапуске процесса;
 * - данные не разделяются между процессами (кластер, несколько реплик, serverless).
 *
 * Объём ограничен `maxSize` (вытесняется запись, дольше всех не обновлявшаяся)
 * и `ttl`. Таймеров нет: устаревшие записи удаляются при чтении и при записи.
 * Записи связаны в список по давности обновления (ttl один на всё хранилище,
 * поэтому это и порядок истечения): обновление и очистка — O(1). Список, а не
 * порядок вставки `Map`: удаление с повторной вставкой на каждый запрос копит
 * «дыры» в хэш-таблице V8, и обход с начала стоил O(ёмкости).
 *
 * @example
 * ```ts
 * const storage = new MemorySessionStorage<{ step?: string }>({ maxSize: 2 });
 * storage.set('telegram:1', { step: 'ask_name' });
 * storage.get('telegram:1'); // { step: 'ask_name' }
 * ```
 *
 * @group Хранение данных
 */
export class MemorySessionStorage<T> {
    readonly #entries = new Map<string, IMemorySessionEntry<T>>();
    /** Самая давно обновлённая запись (кандидат на вытеснение). */
    #head: IMemorySessionEntry<T> | null = null;
    /** Последняя обновлённая запись. */
    #tail: IMemorySessionEntry<T> | null = null;
    readonly #maxSize: number;
    readonly #ttl: number;

    /**
     * @param config Настройки хранилища
     */
    constructor(config: IMemorySessionConfig = {}) {
        this.#maxSize =
            config.maxSize && config.maxSize > 0
                ? Math.floor(config.maxSize)
                : MEMORY_SESSION_MAX_SIZE;
        this.#ttl = config.ttl !== undefined && config.ttl >= 0 ? config.ttl : MEMORY_SESSION_TTL;
    }

    /**
     * Максимальное количество записей.
     * @returns Лимит хранилища
     */
    public get maxSize(): number {
        return this.#maxSize;
    }

    /**
     * Время жизни записи в миллисекундах (`0` — без ограничения).
     * @returns TTL хранилища
     */
    public get ttl(): number {
        return this.#ttl;
    }

    /**
     * Текущее количество записей (включая ещё не удалённые устаревшие).
     * @returns Количество записей
     */
    public get size(): number {
        return this.#entries.size;
    }

    /**
     * Возвращает данные по ключу.
     * @param key Ключ записи (платформа + id пользователя)
     * @returns Сохранённые данные или `undefined`, если записи нет или она устарела
     * @example
     * ```ts
     * const data = storage.get('telegram:42') ?? {};
     * ```
     */
    public get(key: string): T | undefined {
        const entry = this.#entries.get(key);
        if (!entry) {
            return undefined;
        }
        if (this.#ttl && entry.expiresAt <= Date.now()) {
            this.#remove(entry);
            return undefined;
        }
        return entry.value;
    }

    /**
     * Сохраняет данные по ключу и продлевает время их жизни.
     * @param key Ключ записи (платформа + id пользователя)
     * @param value Данные пользователя
     * @example
     * ```ts
     * storage.set('telegram:42', { oldIntentName: 'ask_name' });
     * ```
     */
    public set(key: string, value: T): void {
        const now = Date.now();
        const expiresAt = this.#ttl ? now + this.#ttl : Infinity;
        const entry = this.#entries.get(key);
        if (entry) {
            // Обновлённая запись переносится в конец списка — без удаления из Map.
            entry.value = value;
            entry.expiresAt = expiresAt;
            this.#unlink(entry);
            this.#append(entry);
        } else {
            const created: IMemorySessionEntry<T> = {
                key,
                value,
                expiresAt,
                prev: null,
                next: null,
            };
            this.#entries.set(key, created);
            this.#append(created);
        }
        this.#prune(now);
    }

    /**
     * Удаляет запись.
     * @param key Ключ записи
     * @returns `true`, если запись существовала
     */
    public delete(key: string): boolean {
        const entry = this.#entries.get(key);
        if (!entry) {
            return false;
        }
        this.#remove(entry);
        return true;
    }

    /**
     * Удаляет все записи.
     */
    public clear(): void {
        this.#entries.clear();
        this.#head = this.#tail = null;
    }

    /**
     * Удаляет устаревшие записи из начала очереди и вытесняет лишние по лимиту.
     * @param now Текущее время
     */
    #prune(now: number): void {
        let entry = this.#head;
        while (entry && (this.#entries.size > this.#maxSize || entry.expiresAt <= now)) {
            const next = entry.next;
            this.#remove(entry);
            entry = next;
        }
    }

    /**
     * Исключает запись из списка давности (из Map не удаляет).
     * @param entry Запись
     */
    #unlink(entry: IMemorySessionEntry<T>): void {
        if (entry.prev) {
            entry.prev.next = entry.next;
        } else {
            this.#head = entry.next;
        }
        if (entry.next) {
            entry.next.prev = entry.prev;
        } else {
            this.#tail = entry.prev;
        }
        entry.prev = null;
        entry.next = null;
    }

    /**
     * Добавляет запись в конец списка давности (самая свежая).
     * @param entry Запись
     */
    #append(entry: IMemorySessionEntry<T>): void {
        entry.prev = this.#tail;
        entry.next = null;
        if (this.#tail) {
            this.#tail.next = entry;
        } else {
            this.#head = entry;
        }
        this.#tail = entry;
    }

    /**
     * Удаляет запись из списка и из Map.
     * @param entry Запись
     */
    #remove(entry: IMemorySessionEntry<T>): void {
        this.#unlink(entry);
        this.#entries.delete(entry.key);
    }
}
