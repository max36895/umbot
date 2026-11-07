import { hash } from 'node:crypto';
import type { AppContext } from '../AppContext';
import type { IPlatformAdapter } from '../interfaces/IBot';
import { waitWithLimit } from './promise';

/** Сколько ID доставок помнит дедупликация вебхуков (старые вытесняются). */
const DELIVERY_CACHE_SIZE = 10_000;
/**
 * Сколько помнится ID доставки, мс. Платформы повторяют доставку через секунды
 * или минуты (MAX — через 60 с, затем с множителем 2.5), час покрывает эти повторы.
 */
const DELIVERY_CACHE_TTL = 60 * 60 * 1000;
/**
 * Сколько повтор доставки ждёт исхода исходного запроса, который ещё обрабатывается, мс.
 * Предел не даёт повторам копить открытые соединения, если исходный запрос завис.
 */
const DELIVERY_WAIT_LIMIT = 30_000;

/**
 * Принятая доставка вебхука (см. {@link DeliveryDedup.accept}).
 */
export interface IDelivery {
    /** Платформа доставки */
    platform: string;
    /** Ключ доставки внутри платформы: ID (подписанный вебхук) или хэш тела */
    key: string;
    /** Время, после которого запись забывается, мс */
    expiresAt: number;
    /**
     * Исход обработки: `true` — обработана, `false` — сбой сервера, повтор
     * обрабатывается заново; `undefined` — исходный запрос ещё выполняется
     */
    outcome: boolean | undefined;
    /**
     * Повторы, ждущие исхода. Промис создаётся только для ждущего повтора —
     * у обычной (единственной) доставки его нет вовсе.
     */
    waiters: ((processed: boolean) => void)[] | null;
}

/**
 * Промис исхода доставки для повтора, который его ждёт.
 * @param delivery Принятая доставка
 * @returns Промис исхода (`true` — обработана, `false` — сбой сервера)
 */
function getDeliveryResult(delivery: IDelivery): Promise<boolean> {
    if (delivery.outcome !== undefined) {
        return Promise.resolve(delivery.outcome);
    }
    return new Promise<boolean>((resolve) => {
        (delivery.waiters ??= []).push(resolve);
    });
}

/**
 * Хэш тела запроса для ключа дедупликации. Повтор доставки платформа шлёт с тем же
 * телом, а атакующий без секрета вебхука не угадает тело будущего апдейта и не
 * сможет заранее «занять» его ID (у Telegram update_id идут подряд). ID доставки
 * адаптеры берут из тела, поэтому хэш тела различает и сами доставки.
 * @param body Тело запроса
 * @returns Хэш тела
 */
function hashBody(body: string | object): string {
    return hash('sha1', typeof body === 'string' ? body : JSON.stringify(body), 'base64');
}

/**
 * Дедупликация доставок вебхуков.
 *
 * Мессенджеры повторяют доставку, если не получили 2xx вовремя, — а ответ
 * уходит только после исходящих вызовов API (загрузка медиа, очередь MAX).
 * Без дедупликации повтор снова запускает логику, и пользователь получает
 * ответ дважды. Работает для адаптеров, реализующих `getDeliveryId`.
 *
 * Повтор, пришедший, пока исходный запрос ещё обрабатывается, ждёт его исхода
 * (не дольше {@link DELIVERY_WAIT_LIMIT}): после успеха подтверждается `200 ok`,
 * после сбоя сервера обрабатывается заново — иначе апдейт потерялся бы, ведь
 * платформа уже получила бы 2xx на повтор.
 *
 * Ключ доставки — ID от адаптера, если подпись вебхука проверена
 * (`isSignatureCheckEnabled()`): подделать запрос нельзя, и хэш тела не нужен.
 * Без подписи ключ — хэш тела (см. {@link hashBody}).
 *
 * Внутренний класс ядра: вызывается из `Bot.webhookHandle`/`Bot.webhookEvent`.
 * @internal
 */
export class DeliveryDedup {
    readonly #appContext: AppContext;

    /**
     * Принятые доставки вебхуков: платформа → ключ доставки. Повтор той же доставки
     * (платформа не дождалась ответа) подтверждается без повторного выполнения логики.
     */
    readonly #deliveries = new Map<string, Map<string, IDelivery>>();

    /**
     * Доставки в порядке поступления (кольцевой буфер на DELIVERY_CACHE_SIZE):
     * старейшая вытесняется за O(1). Обход Map с начала после удалений проходит
     * «дыры» хэш-таблицы V8 и стоил O(ёмкости) на каждый запрос.
     */
    readonly #deliveryRing: (IDelivery | undefined)[] = [];
    #deliveryHead = 0;
    #deliveryCount = 0;

    constructor(appContext: AppContext) {
        this.#appContext = appContext;
    }

    /**
     * Регистрирует доставку вебхука для дедупликации.
     *
     * Первая доставка регистрируется синхронно; промис — только когда нужно ждать
     * исходный запрос.
     *
     * @param adapter Адаптер платформы запроса
     * @param query Разобранное тело запроса
     * @param body Тело запроса в исходном виде (для хэша)
     * @returns Доставка, исход которой нужно сообщить через {@link finish};
     *   `null` — адаптер не даёт ID; `false` — повтор, отвечать `200 ok` без обработки
     */
    accept(
        adapter: IPlatformAdapter,
        query: unknown,
        body: string | object,
    ): IDelivery | null | false | Promise<IDelivery | null | false> {
        let key: string;
        try {
            const id = adapter.getDeliveryId?.(query);
            if (id === null || id === undefined || id === '') {
                return null;
            }
            key = adapter.isSignatureCheckEnabled?.() === true ? String(id) : hashBody(body);
        } catch {
            // Ошибка в адаптере не должна мешать обработке запроса.
            return null;
        }
        const platform = adapter.platformName;
        const existing = this.#deliveries.get(platform)?.get(key);
        if (existing && existing.expiresAt > Date.now()) {
            return this.#wait(adapter, platform, key, existing);
        }
        return this.#register(platform, key);
    }

    /**
     * Повтор доставки, исходный запрос которой уже принят: ждёт его исхода.
     * @param adapter Адаптер платформы
     * @param platform Платформа
     * @param key Ключ доставки
     * @param existing Принятая ранее доставка
     * @returns Доставка для обработки заново или `false` — подтвердить без обработки
     */
    async #wait(
        adapter: IPlatformAdapter,
        platform: string,
        key: string,
        existing: IDelivery,
    ): Promise<IDelivery | false> {
        let current: IDelivery | undefined = existing;
        while (current && current.expiresAt > Date.now()) {
            const processed = await waitWithLimit(getDeliveryResult(current), DELIVERY_WAIT_LIMIT);
            if (processed !== false) {
                this.#appContext.logWarn(
                    `Bot: повторная доставка "${adapter.platformName}" подтверждена без обработки` +
                        (processed === undefined ? ', не дождавшись исходного запроса. ' : '. ') +
                        'Платформа повторяет запрос, если ответ не пришёл вовремя: проверьте время обработки.',
                );
                return false;
            }
            // Исходный запрос упал. Повторов могло прийти несколько: обработку берёт
            // первый, остальные снова ждут — уже его.
            current = this.#deliveries.get(platform)?.get(key);
        }
        return this.#register(platform, key);
    }

    /**
     * Запоминает новую доставку и вытесняет истёкшие и лишние (сверх
     * DELIVERY_CACHE_SIZE) — старейшие по кольцевому буферу, за O(1).
     * @param platform Платформа
     * @param key Ключ доставки
     * @returns Новая доставка
     */
    #register(platform: string, key: string): IDelivery {
        const now = Date.now();
        let byPlatform = this.#deliveries.get(platform);
        if (byPlatform === undefined) {
            byPlatform = new Map();
            this.#deliveries.set(platform, byPlatform);
        } else {
            byPlatform.delete(key);
        }
        // TTL одинаков для всех записей, поэтому порядок вставки совпадает с порядком истечения.
        const ring = this.#deliveryRing;
        while (this.#deliveryCount > 0) {
            const old = ring[this.#deliveryHead] as IDelivery;
            if (old.expiresAt > now && this.#deliveryCount < DELIVERY_CACHE_SIZE) {
                break;
            }
            const oldMap = this.#deliveries.get(old.platform);
            if (oldMap?.get(old.key) === old) {
                oldMap.delete(old.key);
            }
            ring[this.#deliveryHead] = undefined;
            this.#deliveryHead = (this.#deliveryHead + 1) % DELIVERY_CACHE_SIZE;
            this.#deliveryCount--;
        }
        const delivery: IDelivery = {
            platform,
            key,
            expiresAt: now + DELIVERY_CACHE_TTL,
            outcome: undefined,
            waiters: null,
        };
        byPlatform.set(key, delivery);
        ring[(this.#deliveryHead + this.#deliveryCount) % DELIVERY_CACHE_SIZE] = delivery;
        this.#deliveryCount++;
        return delivery;
    }

    /**
     * Сообщает исход обработки доставки повторам, которые его ждут. После сбоя сервера
     * доставка забывается, чтобы её повтор обработался заново.
     * @param delivery Доставка из {@link accept}
     * @param processed `false` — сбой сервера (ответ 500)
     */
    finish(delivery: IDelivery | null, processed: boolean): void {
        if (!delivery) {
            return;
        }
        if (!processed) {
            const byPlatform = this.#deliveries.get(delivery.platform);
            if (byPlatform?.get(delivery.key) === delivery) {
                byPlatform.delete(delivery.key);
            }
        }
        delivery.outcome = processed;
        const waiters = delivery.waiters;
        if (waiters !== null) {
            delivery.waiters = null;
            for (const resolve of waiters) {
                resolve(processed);
            }
        }
    }
}
