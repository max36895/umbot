// middleware/rateLimiter.ts
import { BotController } from '../controller';
import { AppContext, MiddlewareNext } from '../core';

declare module '../controller/BotController' {
    interface IPlatformOptions {
        /**
         * Флаг, который выставляется middleware `rateLimiter()` перед выбросом
         * исключения о переполнении очереди. Позволяет вызывающему коду
         * (например, в responseCb) понять, что запрос отклонён по перегрузке,
         * а не упал из-за ошибки в бизнес-логике.
         */
        rateLimitOverflow?: boolean;
    }
}

/**
 * Ошибка переполнения очереди rateLimiter.
 *
 * Выбрасывается, когда очередь запросов одного пользователя превысила
 * `maxQueueSize`. Ядро перехватывает исключения middleware и обрабатывает их
 * как «обработка прервана» (платформа получает 200), поэтому по классу ошибки
 * и флагу `platformOptions.rateLimitOverflow` приложение может отличить
 * осознанный отказ из-за перегрузки от ошибки в бизнес-логике.
 */
export class RateLimitQueueOverflowError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RateLimitQueueOverflowError';
    }
}

interface QueueItem {
    resolve: () => void;
    reject: (err: Error) => void;
    task: () => Promise<void>;
}

interface PlatformState {
    queue: QueueItem[];
    processing: boolean;
    lastReset: number; // время последнего сброса счётчика (мс)
    count: number; // количество запросов за текущую секунду
    lastActivity: number; // время последней активности (для очистки)
    /**
     * Запись вытеснена из stateMap (eviction/destroy) и больше не обслуживается.
     * Нужна, чтобы processQueue не исполнял задачи вытесненной записи: их промисы
     * уже отклонены, а новый запрос того же ключа создаёт отдельную запись.
     */
    dead: boolean;
}

/**
 * Максимальный размер stateMap. При достижении лимита вытесняется самая старая неактивная запись (см. getOrCreateState).
 */
const MAX_STATE_MAP_SIZE = 10000;

/**
 * Реестр всех созданных инстансов rateLimiter.
 * Хранит карту состояний и интервал очистки каждого инстанса, чтобы
 * destroyRateLimiter мог освободить ресурсы всех инстансов, а не только последнего.
 */
interface IRateLimiterInstance {
    stateMap: Map<string, PlatformState>;
    cleanupInterval: ReturnType<typeof setInterval> | null;
}
const limiterInstances = new Set<IRateLimiterInstance>();

async function processQueue(
    st: PlatformState,
    limit: number,
    appContext: AppContext,
): Promise<void> {
    try {
        while (st.queue.length > 0 && !st.dead) {
            const now = Date.now();
            const timePassed = now - st.lastReset;

            // Если текущая секунда ещё не закончилась, ждём её окончания
            if (timePassed < 1000) {
                await new Promise((r) => setTimeout(r, 1000 - timePassed).unref());
            }
            if (st.dead) {
                return;
            }

            st.count = 0;

            st.lastReset = Date.now();

            // Счётчик только что обнулён, поэтому в этом окне доступен весь лимит.
            // Берём из очереди потенциальную пачку.
            const batch = st.queue.splice(0, Math.min(limit, st.queue.length));

            for (let i = 0; i < batch.length; i++) {
                const item = batch[i];
                if (!item || st.dead) {
                    break;
                }
                // Свежие запросы, приходящие параллельно с пачкой, занимают тот же
                // счётчик (st.count < limit в обработчике middleware). Без проверки
                // здесь за одно окно исполнялось до limit задач из пачки + до limit
                // свежих запросов — реальный rps вдвое превышал лимит платформы.
                if (st.count >= limit) {
                    st.queue.unshift(...batch.slice(i));
                    break;
                }

                st.count++;
                try {
                    await item.task();
                } catch (err) {
                    // Ошибка уже обработана в reject, но логируем на всякий случай
                    appContext.logError(
                        `rateLimited - произошла ошибка при обработке. Ошибка: ${(err as Error).message}`,
                        { err },
                    );
                }

                // Обновляем время активности после выполнения задачи
                // eslint-disable-next-line require-atomic-updates
                st.lastActivity = Date.now();

                // Равномерная задержка между запросами внутри пачки
                if (st.queue.length > 0) {
                    // -1 для подстраховки
                    await new Promise((r) => setTimeout(r, Math.ceil(1000 / limit) - 1).unref());
                }
            }
        }
    } finally {
        // Обновляем lastActivity после завершения обработки очереди
        st.lastActivity = Date.now();

        // Критически важная проверка: за время пока мы выходили из цикла
        // (между последней итерацией while и этим finally) в очередь могли
        // подкинуть новые задачи. Если это произошло — перезапускаем обработку,
        // не сбрасывая флаг processing. Это закрывает race condition,
        // из-за которого Promise мог навсегда зависнуть в очереди.
        // Для вытесненной (dead) записи перезапуск запрещён: её очередь больше
        // никем не обслуживается, а новый запрос того же ключа создал отдельную запись.
        if (!st.dead && st.queue.length > 0) {
            processQueue(st, limit, appContext).catch((e) => {
                appContext.logError(
                    `rateLimiter: Произошла ошибка при обработке очереди: ${e.message}`,
                    { error: e },
                );
            });
        } else if (st.queue.length === 0 || st.dead) {
            // Очередь пуста (или запись вытеснена) — безопасно сбрасываем флаг
            st.processing = false;
        }
    }
}

function startCleanupFn(
    cInterval: ReturnType<typeof setInterval> | null = null,
    stateMap: Map<string, PlatformState>,
    inactivityTimeout: number,
): ReturnType<typeof setInterval> | null {
    let cleanupInterval = cInterval;
    if (!cleanupInterval) {
        cleanupInterval = setInterval(
            () => {
                const now = Date.now();
                for (const [key, st] of stateMap.entries()) {
                    if (
                        now - st.lastActivity > inactivityTimeout &&
                        st.queue.length === 0 &&
                        !st.processing
                    ) {
                        stateMap.delete(key);
                    }
                }
            },
            Math.min(inactivityTimeout / 2, 30000),
        ).unref();
    }
    return cleanupInterval;
}

/**
 * Ищет самую старую неактивную запись в stateMap (LRU-подобное поведение).
 * Ожидающие в её очереди промисы отклоняются, чтобы не зависнуть навсегда.
 *
 * Важно: карта ограничена MAX_STATE_MAP_SIZE (10 000), а ключ — пара
 * {platform}:{userId}. На платформах без подписи вебхука (Алиса/Маруся) userId
 * контролируется отправителем: при карте, целиком заполненной атакующими
 * ключами, вытесняется самая старая запись — в том числе легитимный
 * пользователь (его queued-промисы отклоняются RateLimitQueueOverflowError).
 * Это осознанный trade-off против unbounded-памяти; альтернатива — внешний
 * лимитер (Redis) для мультисерверных конфигураций.
 *
 * @param stateMap Карта состояний по ключу {platform}:{userId}
 * @returns Ключ найденной записи или null, если карта пуста
 */
function findOldestKey(stateMap: Map<string, PlatformState>): string | null {
    let oldestKey: string | null = null;
    let oldestActivity = Infinity;
    let fallbackKey: string | null = null;
    let fallbackActivity = Infinity;
    for (const [k, v] of stateMap) {
        if (v.lastActivity < fallbackActivity) {
            fallbackActivity = v.lastActivity;
            fallbackKey = k;
        }
        // Не вытесняем запись, которая прямо сейчас обрабатывает очередь:
        // её промисы отклонятся, но цикл продолжит исполнять задачи, и новый
        // запрос того же ключа создаст вторую параллельную очередь.
        if (v.processing || v.queue.length > 0) {
            continue;
        }
        if (v.lastActivity < oldestActivity) {
            oldestActivity = v.lastActivity;
            oldestKey = k;
        }
    }
    // Если свободных записей нет совсем — вытесняем самую старую из любых,
    // иначе карта будет расти без ограничений.
    return oldestKey ?? fallbackKey;
}

/**
 * Удаляет запись из stateMap, отклоняя все ожидающие в её очереди промисы.
 * @param stateMap Карта состояний
 * @param key Ключ записи для удаления
 */
function evictEntry(stateMap: Map<string, PlatformState>, key: string): void {
    const old = stateMap.get(key);
    if (old) {
        // Помечаем запись мёртвой ДО отклонения промисов: иначе работающий
        // processQueue продолжил бы исполнять задачи уже вытесненной записи.
        old.dead = true;
        for (const item of old.queue) {
            try {
                item.reject(new Error('rateLimiter: eviction due to overflow'));
            } catch {
                // игнорируем — по политике
            }
        }
    }
    stateMap.delete(key);
}

/**
 * Возвращает состояние для ключа, создавая новую запись при необходимости.
 * При переполнении карты вытесняет самую старую неактивную запись.
 * @param stateMap Карта состояний
 * @param key Ключ {platform}:{userId}
 */
function getOrCreateState(stateMap: Map<string, PlatformState>, key: string): PlatformState {
    let st = stateMap.get(key);
    if (!st) {
        // Защита от переполнения: если stateMap слишком большой — выкидываем самую старую
        // неактивную запись (LRU-подобное поведение) вместо полного отказа от ограничения.
        // Так мы избегаем скрытого снятия защиты (fail-open) под нагрузкой от
        // множества уникальных userId.
        if (stateMap.size >= MAX_STATE_MAP_SIZE) {
            const oldestKey = findOldestKey(stateMap);
            if (oldestKey !== null) {
                evictEntry(stateMap, oldestKey);
            }
        }
        st = {
            queue: [],
            processing: false,
            lastReset: Date.now(),
            count: 0,
            lastActivity: Date.now(),
            dead: false,
        };
        stateMap.set(key, st);
    }
    return st;
}

/**
 * Создаёт middleware для ограничения частоты входящих запросов (rate limiting) на уровне платформы.
 *
 * **Для чего используется:**
 * Некоторые платформы (например, Max, Telegram, VK, Viber — их адаптеры задают
 * `limit = 30`) имеют ограничение на количество отправляемых запросов в секунду.
 * Данный middleware защищает от превышения этого лимита, автоматически задерживая
 * запросы, если они поступают слишком часто.
 *
 * **Как это работает:**
 * - Лимит берётся из свойства `limit` адаптера платформы (`platformAdapter.limit`).
 *   Если свойство не задано или равно 0, ограничение не применяется.
 * - Для каждой комбинации `{platform}:{userId}` ведётся отдельная очередь и счётчик запросов.
 * - Счётчик обнуляется при первом запросе спустя секунду после предыдущего сброса,
 *   что позволяет соблюдать лимит в секундном (фиксированном) окне.
 * - Если лимит исчерпан, запрос помещается в очередь и будет выполнен, когда появится свободное «окно».
 * - Очередь имеет максимальный размер (`maxQueueSize`); при переполнении выбрасывается
 *   исключение {@link RateLimitQueueOverflowError}, а в `ctx.platformOptions.rateLimitOverflow`
 *   выставляется флаг: исключение перехватывается ядром как «обработка прервана» (платформа
 *   получит 200), поэтому флаг — способ понять, что запрос отклонён из-за перегрузки.
 * - Запросы в очереди выполняются с равномерной задержкой (⌈1000/limit⌉ − 1 мс), чтобы не превышать лимит.
 * - Неактивные записи (без запросов дольше `inactivityTimeout`) автоматически удаляются из памяти.
 *
 * **Важные особенности:**
 * - Middleware применяется **только к входящим запросам** (webhook). Для исходящих уведомлений
 *   ограничение нужно реализовывать непосредственно в адаптерах платформ.
 * - Счётчик ведётся отдельно для каждой пары `{platform}:{userId}`, то есть ограничивается
 *   частота запросов **одного пользователя**, а не суммарная нагрузка на бота.
 * - Запрос, попавший в очередь, задерживается минимум на секунду. У платформ есть свой
 *   таймаут на ответ вебхука (у Алисы — около 2.9 секунд, MAX_TIME_REQUEST), поэтому включайте
 *   middleware осознанно: при срабатывании лимита платформа может не дождаться ответа.
 * - Функцию необходимо **вызвать** при подключении: `bot.use(rateLimiter())`.
 * - Все внутренние таймеры используют `unref()`, поэтому не блокируют завершение процесса.
 *
 * @param maxQueueSize - Максимальное количество ожидающих запросов в очереди для одного ключа (по умолчанию 100).
 *                       При превышении очередь перестаёт принимать новые запросы и выбрасывается исключение.
 * @param inactivityTimeout - Время в миллисекундах, после которого запись (очередь + счётчик) удаляется,
 *                            если не было активности. По умолчанию 60000 (1 минута).
 * @param getKey - Ключ счётчика для запроса. По умолчанию `{platform}:{userId}`. На платформах
 *                 без подписи вебхука (Алиса, Маруся, SmartApp) и без заданного секрета `userId`
 *                 задаёт отправитель: меняя его, атакующий обходит лимит на пользователя. Ключ
 *                 `ctx => ctx.appType ?? ''` ограничивает суммарную нагрузку на платформу.
 * @returns Middleware-функцию для использования в `bot.use()`.
 *
 * @example
 * ```ts
 * import { rateLimiter } from 'umbot/middleware';
 *
 * // Подключаем middleware с параметрами по умолчанию
 * bot.use(rateLimiter());
 *
 * // Или с кастомными настройками
 * bot.use(rateLimiter(200, 120000));
 *
 * // Общий лимит на платформу, а не на пользователя
 * bot.use(rateLimiter(100, 60000, (ctx) => ctx.appType ?? ''));
 * ```
 *
 * @remarks
 * Чтобы лимит заработал для вашей платформы, добавьте в соответствующий адаптер публичное поле `limit`:
 * ```ts
 * export class TelegramAdapter extends BasePlatformAdapter {
 *   public limit = 30;
 *   // ...
 * }
 * ```
 */
export function rateLimiter(
    maxQueueSize = 100,
    inactivityTimeout = 60000,
    getKey?: (ctx: BotController) => string,
): (ctx: BotController, next: MiddlewareNext) => Promise<void> {
    const stateMap = new Map<string, PlatformState>();
    const instance: IRateLimiterInstance = {
        stateMap,
        cleanupInterval: null,
    };
    limiterInstances.add(instance);
    instance.cleanupInterval = startCleanupFn(
        instance.cleanupInterval,
        stateMap,
        inactivityTimeout,
    );

    return async (ctx: BotController, next: MiddlewareNext) => {
        const platform = ctx.appType;
        const userId = ctx.userId || 'um_unknown';

        if (!platform) {
            return next();
        }

        const limit = ctx.appContext.platforms[platform]?.limit;
        if (!limit) {
            return next();
        }

        const key = getKey ? `${platform}:${getKey(ctx)}` : `${platform}:${userId}`;
        const st = getOrCreateState(stateMap, key);

        const now = (st.lastActivity = Date.now());
        if (now - st.lastReset >= 1000) {
            st.count = 0;
            st.lastReset = now;
        }
        if (st.count < limit) {
            st.count++;
            return next();
        }
        if (st.queue.length >= maxQueueSize) {
            // Флаг позволяет вызывающему коду (например, в responseCb webhookHandle)
            // отличить осознанный отказ из-за перегрузки от ошибки в бизнес-логике.
            ctx.platformOptions.rateLimitOverflow = true;
            throw new RateLimitQueueOverflowError(
                `rateLimit - Превышено ограничение на размер очереди. Убедитесь, что значение указано корректно, текущее значение - ${maxQueueSize}.`,
            );
        }

        return new Promise<void>((resolve, reject) => {
            st.queue.push({
                resolve,
                reject,
                task: async () => {
                    try {
                        await next();
                        resolve();
                    } catch (err) {
                        reject(err instanceof Error ? err : new Error(String(err)));
                    } finally {
                        // Обновляем lastActivity после завершения задачи, чтобы запись не удалили, пока она ещё работает
                        st.lastActivity = Date.now();
                    }
                },
            });

            // Запускаем обработчик очереди, если он ещё не запущен
            if (!st.processing) {
                st.processing = true;
                processQueue(st, limit, ctx.appContext).catch((e) => {
                    ctx.appContext.logError(
                        `rateLimiter: Произошла ошибка при обработке очереди: ${e.message}`,
                        { error: e },
                    );
                });
            }
        });
    };
}

/**
 * Очищает все ресурсы всех созданных инстансов rateLimiter: интервалы очистки и карты состояний.
 * Используйте при завершении приложения или hot-reload для предотвращения утечек памяти.
 *
 * @example
 * ```ts
 * import { destroyRateLimiter } from 'umbot/middleware';
 *
 * // При завершении приложения
 * process.on('SIGTERM', () => {
 *     destroyRateLimiter();
 *     process.exit(0);
 * });
 * ```
 */
export function destroyRateLimiter(): void {
    for (const instance of limiterInstances) {
        if (instance.cleanupInterval) {
            clearInterval(instance.cleanupInterval);
            instance.cleanupInterval = null;
        }
        // Очищаем все очереди, отклоняя ожидающие промисы
        instance.stateMap.forEach((state) => {
            // Помечаем запись мёртвой, чтобы работающий processQueue не исполнял
            // задачи уничтоженного лимитера.
            state.dead = true;
            while (state.queue.length > 0) {
                const item = state.queue.shift();
                if (item) {
                    item.reject(new Error('Rate limiter destroyed'));
                }
            }
        });
        instance.stateMap.clear();
    }
    limiterInstances.clear();
}
