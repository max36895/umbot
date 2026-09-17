import { BotController, AppContext, Text } from '../../../index';
import type { IControllerApi } from '../../../controller';
import type { TEventType } from '../../../core/events';
import { VkRequest, IVkParams } from '../API';
import { BasePlatform, EMPTY_QUERY_ERROR } from '../Base/Base';
import { buttonProcessing } from './Button';
import { cardProcessing } from './Card';
import { soundProcessing } from './Sound';
import { T_VK } from './constants';
import { IVkRequestContent, IVkCard } from './interfaces/IVkPlatform';
import { makeVkApi } from './apiFacade';
import {
    getChatText,
    getPlatformRequestData,
    normalizeActionPayload,
    setThisUserToNlu,
    tryParse,
    shouldProcessChatSound,
} from '../Base/utils';
import { timingSafeEqual } from 'crypto';

type IVkRequestData = Record<string, unknown> & {
    eventId?: string;
    peerId?: number;
};

/**
 * Данные пользователя VK, которые кладутся в NLU.
 */
interface IVkUserInfo {
    first_name: string | null;
    last_name: string | null;
}

/**
 * Время жизни записи в кэше имён пользователей VK (1 час).
 */
const VK_USER_CACHE_TTL = 3_600_000;
/**
 * Максимальное число записей в кэше имён, чтобы он не рос бесконечно.
 */
const VK_USER_CACHE_MAX_SIZE = 5000;

/**
 * Кэш ответов `users.get`.
 *
 * Без кэша `users.get` уходил бы на каждое входящее сообщение: второй сетевой вызов
 * к VK на каждый ответ бота, лишняя задержка и расход лимита 30 запросов в секунду.
 * Имя пользователя меняется редко, поэтому держим его в памяти процесса.
 */
const vkUserCache = new Map<string, { value: IVkUserInfo | null; expiresAt: number }>();

/**
 * Возвращает данные пользователя VK из кэша либо запрашивает их у API.
 *
 * @param appContext Контекст приложения
 * @param userId Идентификатор пользователя VK
 * @returns Имя и фамилия пользователя либо `null`, если получить их не удалось
 */
async function getVkUserInfo(
    appContext: AppContext,
    userId: string | number,
): Promise<IVkUserInfo | null> {
    const key = String(userId);
    const now = Date.now();
    const cached = vkUserCache.get(key);
    if (cached && cached.expiresAt > now) {
        return cached.value;
    }
    const users = await new VkRequest(appContext).usersGet(userId as number);
    if (users === null) {
        // Сбой сети или ошибка API не кэшируем: иначе транзитивная ошибка VK
        // на час оставляла бы пользователя без имени (null кэшировался вместе
        // с успешным ответом). Повторный запрос попробует получить данные снова.
        return null;
    }
    // users.get возвращает массив — берём первого пользователя.
    const user = users[0];
    const value: IVkUserInfo | null = user
        ? {
              first_name: user.first_name || null,
              last_name: user.last_name || null,
          }
        : null;
    if (vkUserCache.size >= VK_USER_CACHE_MAX_SIZE) {
        // Map хранит порядок вставки — вытесняем самую старую запись.
        const oldestKey = vkUserCache.keys().next().value;
        if (oldestKey !== undefined) {
            vkUserCache.delete(oldestKey);
        }
    }
    vkUserCache.set(key, { value, expiresAt: now + VK_USER_CACHE_TTL });
    return value;
}

/**
 * Очищает кэш имён пользователей VK.
 * Нужен для тестов и для сценариев, где данные пользователя должны перечитаться сразу.
 */
export function clearVkUserCache(): void {
    vkUserCache.clear();
}

/**
 * Имя действия «именной» кнопки клавиатуры VK из payload сообщения.
 * @param payload Разобранный payload сообщения
 * @returns Имя действия (как у addAction) либо пустая строка
 */
function getKeyboardActionName(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return '';
    }
    const source = payload as Record<string, unknown>;
    const name = source.command ?? source.action;
    if (typeof name !== 'string') {
        return '';
    }
    const actionName = normalizeActionPayload(name);
    return actionName === 'start' && source.command === 'start' ? '' : actionName;
}

/**
 * Адаптер, обеспечивающий поддержку платформы VK. Позволяет разрабатывать чат-ботов для мессенджера ВК на TypeScript с использованием кросс-платформенного функционала: обработка текстовых запросов, работа с карточками и кнопками.
 *
 * Подключение адаптера не требует изменения существующей бизнес-логики: после интеграции
 * все команды и обработчики, написанные для umbot, автоматически становятся доступны для VK.
 * Единый интерфейс позволяет одновременно использовать одну бизнес-логику для нескольких
 * платформ (Viber, VK, Алиса и др.) без дублирования кода.
 *
 * Этот адаптер автоматически обрабатывает входящие вебхуки от мессенджера VK,
 * преобразует их в унифицированный формат фреймворка и формирует ответ,
 * совместимый с требованиями платформы. Подключается одной строкой и
 * не мешает работе других адаптеров (например, для Алисы или Маруси).
 *
 * Поддерживает:
 * - текстовые запросы, callback-кнопки (message_event);
 * - карточки, кнопки;
 *
 * Подключается как любой другой адаптер: `bot.use(new VkAdapter(token))`.
 * Несколько адаптеров могут работать одновременно — система сама выберет подходящий
 * на основе заголовков и структуры входящего запроса.
 * @example
 * ```ts
 * // Простейший бот для VK, который отвечает на приветствие
 * import { Bot } from 'umbot';
 * import { VkAdapter } from 'umbot/plugins';
 *
 * const bot = new Bot()
 *     .use(new VkAdapter('YOUR_VK_TOKEN', { vk_confirmation_token: 'YOUR_CONFIRMATION_TOKEN' }))
 *     .addCommand('start', ['привет'], (_text, ctx) => {
 *         ctx.text = 'Привет! Я твой первый бот для ВК';
 *     });
 *
 * bot.start('localhost', 3000);
 * ```
 *
 * @see Bot
 * @see BotController
 * @see BasePlatform
 */
export class VkAdapter extends BasePlatform<string | IVkRequestContent> {
    /**
     * Идентификатор платформы VK.
     */
    platformName = T_VK;
    /**
     * Универсальные события VK (для валидации addEvent): текст и callback-кнопки.
     */
    supportedEvents: readonly TEventType[] = ['message', 'callback'];
    /**
     * VK — чат-платформа (не голосовая).
     */
    isVoice = false;
    /**
     * Лимит запросов/сек для входящего rateLimiter (лимит VK Callback API).
     */
    limit = 30;

    /**
     * API-фасад VK для `controller.api` (sendPhoto/sendDocument через штатный
     * upload-flow, answerCallback-snackbar). Подключается ядром через контракт
     * `IPlatformAdapter`.
     * @param controller - Контроллер текущего запроса
     */
    createApi(controller: BotController): IControllerApi | null {
        return makeVkApi(controller);
    }

    /**
     * Инициализирует адаптер: вызывает базовую инициализацию и переносит
     * опции конструктора (токен, confirmation_token, secret_key, api_version)
     * в конфигурацию платформы.
     * @param appContext Контекст приложения (конфиги, токены, логгер)
     */
    init(appContext: AppContext): void {
        super.init(appContext);
        const platformToken = appContext.appConfig.tokens[this.platformName];
        if (!platformToken) {
            return;
        }
        if (this._token) {
            platformToken.token = this._token;
        }
        if (this._platformOptions?.vk_confirmation_token) {
            platformToken.confirmation_token = this._platformOptions
                .vk_confirmation_token as string;
        }
        if (this._platformOptions?.vk_secret_key) {
            platformToken.secret_key = this._platformOptions.vk_secret_key as string;
        }
        if (this._platformOptions?.vk_api_version) {
            platformToken.api_version = this._platformOptions.vk_api_version as string;
        }
    }

    /**
     * Проверяет, что входящий запрос принадлежит VK Callback API.
     * Опознаёт запрос по полям `type`, `group_id` и `object`/`secret`.
     * @param query Входящий webhook-запрос
     * @param _headers Заголовки HTTP-запроса (не используются: подпись VK приходит в теле)
     * @returns `true`, если запрос относится к платформе VK
     */
    isPlatformOnQuery(query: IVkRequestContent, _headers?: Record<string, unknown>): boolean {
        if (!query) {
            this.appContext?.logWarn(`VkAdapter.isPlatformOnQuery(): ${EMPTY_QUERY_ERROR}`);

            return false;
        }
        return (
            query.type !== undefined &&
            query.group_id !== undefined &&
            (query.object !== undefined ||
                query.secret !== undefined ||
                query.type === 'confirmation')
        );
    }

    /**
     * Проверяет секретный ключ из тела запроса VK Callback API.
     * Если в настройках группы VK включён «Secret key», он приходит в поле `secret` каждого callback-запроса.
     * Метод сверяет его со значением `secret_key`, сохранённым в конфигурации.
     * Включается автоматически при наличии `secret_key` в `tokens.vk`.
     * Если проверка включена, поле обязательно для всех событий, включая `confirmation`.
     *
     * @param query — тело запроса от VK
     * @returns `true`, если секрет совпадает или проверка не включена; `false` при отсутствии или несовпадении
     */
    isCorrectQuery(query: IVkRequestContent | string): boolean {
        const expectedSecret = this.appContext?.appConfig.tokens[this.platformName]?.secret_key as
            string | undefined;
        // Если secret_key не настроен — проверка не требуется
        if (!expectedSecret) {
            return true;
        }
        let content: IVkRequestContent;
        if (typeof query === 'string') {
            try {
                const parsed: unknown = JSON.parse(query);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    return false;
                }
                content = parsed as IVkRequestContent;
            } catch {
                return false;
            }
        } else {
            content = query;
        }
        if (!content.secret) {
            return false;
        }
        // Сравнение через timingSafeEqual: plain !== уязвимо к тайминг-оракулу,
        // позволяющему побайтово восстановить секрет по времени ответа.
        const a = Buffer.from(String(content.secret));
        const b = Buffer.from(String(expectedSecret));
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
            this.appContext?.logWarn(
                'VkAdapter.isCorrectQuery(): secret в теле запроса не совпадает с secret_key из конфигурации.',
            );
            return false;
        }
        return true;
    }

    /**
     * VK проверяет поле `secret` в теле запроса против `tokens.vk.secret_key`
     * (задаётся через опцию `vk_secret_key`). Токен доступа из конструктора
     * проверку подписи не включает.
     */
    isSignatureCheckEnabled(): boolean {
        return Boolean(this.appContext?.appConfig.tokens[this.platformName]?.secret_key);
    }

    /**
     * Заполняет контроллер данными нового сообщения VK.
     */
    async #setMessageNew(query: IVkRequestContent, controller: BotController): Promise<boolean> {
        const object = query.object;
        const message = object?.message;
        if (!object || !message) {
            controller.skipAutoReply = true;
            controller.platformOptions.sendInInit = 'ok';
            this.appContext?.logWarn(
                'VkAdapter.setQueryData(): message_new без object.message пропущен как некорректное событие.',
            );
            return true;
        }
        controller.userId = message.from_id;
        getPlatformRequestData<IVkRequestData>(controller, this.platformName).peerId =
            message.peer_id ?? object.peer_id ?? message.from_id;
        const rawText = message.text ?? '';
        controller.userCommand = rawText.toLowerCase().trim();
        controller.originalUserCommand = rawText.trim();
        controller.messageId = message.id;
        controller.payload = tryParse(message.payload || null);
        // Кнопка клавиатуры VK приходит обычным сообщением с payload. «Именная» кнопка
        // ({"command":"buy"}) должна срабатывать через addAction — как callback-кнопки
        // Telegram/VK/MAX. Системная кнопка «Начать» ({"command":"start"}) остаётся
        // текстом: боты матчат её по надписи.
        const actionName = getKeyboardActionName(controller.payload);
        if (actionName) {
            controller.userCommand = actionName;
        }
        // Загрузку имени можно отключить: `new VkAdapter(token, { vk_load_user_info: false })`.
        // Тогда nlu.getUserName() вернёт null, зато на ответ уходит один запрос к VK вместо двух.
        if (this._platformOptions?.vk_load_user_info === false) {
            return true;
        }
        const user = await getVkUserInfo(this.appContext as AppContext, controller.userId);
        if (user) {
            // setThisUserToNlu сам пропустит запись, если VK не вернул полей.
            setThisUserToNlu(controller, { username: null, ...user });
        }
        return true;
    }

    /**
     * Заполняет контроллер данными callback-кнопки VK.
     */
    #setMessageEvent(query: IVkRequestContent, controller: BotController): boolean {
        if (!query.object?.payload) {
            // Битый callback без payload обработать невозможно, но ответ обязан быть
            // успешным: на 4xx VK Callback API повторяет событие. Помечаем событие
            // как не требующее ответа и подтверждаем его статусом 200.
            controller.skipAutoReply = true;
            controller.platformOptions.sendInInit = 'ok';
            controller.userId = query.object?.user_id ?? null;
            this.appContext?.log(
                'VkAdapter.setQueryData(): message_event без payload пропущен без ответа.',
            );
            return true;
        }
        controller.eventType = 'callback';
        // Нормализуем payload кнопки в имя действия: 'buy' или {"command":"buy"}
        // превращаются в userCommand='buy' и срабатывают через addAction/команду.
        controller.userCommand = normalizeActionPayload(query.object.payload);
        // Оригинальную команду тоже заполняем: во всех остальных ветках она есть,
        // и бизнес-логика, читающая originalUserCommand, на callback-кнопках получала null.
        controller.originalUserCommand =
            typeof query.object.payload === 'string'
                ? query.object.payload
                : JSON.stringify(query.object.payload);
        controller.userId = query.object.user_id as number;
        const requestData = getPlatformRequestData<IVkRequestData>(controller, this.platformName);
        requestData.peerId = query.object.peer_id ?? query.object.user_id ?? 0;
        controller.payload = tryParse(query.object.payload);
        controller.messageId = query.object.conversation_message_id || 0;
        // exactOptionalPropertyTypes: eventId заполняем только фактическим значением.
        if (query.object.event_id !== undefined) {
            requestData.eventId = query.object.event_id;
        }
        return true;
    }

    /**
     * Разбирает событие VK Callback API (confirmation / message_new / message_event)
     * и наполняет контроллер данными; прочие события помечаются skipAutoReply.
     * @param query Входящий webhook-запрос VK Callback API
     * @param controller Контроллер приложения
     * @returns `true`, если запрос успешно разобран
     */
    async setQueryData(query: IVkRequestContent, controller: BotController): Promise<boolean> {
        if (!this.appContext) {
            return false;
        }
        if (!query) {
            controller.platformOptions.error = `VkAdapter.setQueryData(): ${EMPTY_QUERY_ERROR}`;
            return false;
        }
        controller.requestObject = query;
        switch (query.type) {
            case 'confirmation': {
                // Токен подтверждения вебхука: приоритет у опции конструктора,
                // запасной вариант — конфигурация (tokens.vk.confirmation_token),
                // куда попадает в том числе env-переменная VK_CONFIRMATION_TOKEN
                // (нужно для настройки через .env/process.env и fullPlatforms).
                const confirmToken =
                    this._platformOptions?.vk_confirmation_token ??
                    this.appContext.appConfig.tokens?.[this.platformName]?.confirmation_token;
                controller.platformOptions.sendInInit =
                    confirmToken === undefined ? null : String(confirmToken);
                return true;
            }

            case 'message_new':
                return this.#setMessageNew(query, controller);

            case 'message_event':
                return this.#setMessageEvent(query, controller);

            default:
                // Прочие события группы (message_reply, message_allow, group_join, like_add и т.п.)
                // ответа не требуют, но должны получить "ok": на ошибки VK Callback API
                // после нескольких неудач отключает сервер как нерабочий.
                // sendInInit подтверждает событие до бизнес-логики: иначе
                // message_reply (приходит на каждое исходящее сообщение бота)
                // и прочие события прогоняли бы middleware и fallback-команду.
                controller.skipAutoReply = true;
                controller.platformOptions.sendInInit = 'ok';
                if (query.object && typeof query.object === 'object') {
                    const object = query.object as unknown as Record<string, unknown>;
                    controller.userId =
                        (object.user_id as number) ?? (object.from_id as number) ?? null;
                }
                this.appContext?.log(
                    `VkAdapter.setQueryData(): событие "${query.type}" не требует ответа и было пропущено.`,
                );
                return true;
        }
    }

    /**
     * Формирует вложение карточки с защитой от исключений слоя БД/API.
     *
     * cardProcessing асинхронный (upload картинок в VK): его сбой не должен
     * ронять весь ответ в 500 — серия 5xx отключает вебхук VK Callback API.
     *
     * @param controller Контроллер текущего запроса
     * @returns Карточка либо массив вложений, либо `null` при ошибке/пустой карточке
     */
    async #getCardAttachSafe(controller: BotController): Promise<IVkCard | string[] | null> {
        try {
            return await controller.card.getCards(cardProcessing, controller);
        } catch (e) {
            this.appContext?.logError(
                `VkAdapter.getContent(): ошибка формирования карточки, сообщение отправлено без неё. Текст ошибки: "${e instanceof Error ? e.message : String(e)}"`,
                { error: e },
            );
            return null;
        }
    }

    /**
     * Записывает карточку в параметры messagesSend: карусель — в `template`,
     * одиночные вложения (string[]) — в `attachments`.
     *
     * @param attach Результат cardProcessing (IVkCard либо массив вложений)
     * @param params Параметры исходящего сообщения (мутируется)
     */
    #applyCardToParams(attach: IVkCard | string[], params: IVkParams): void {
        if ((attach as IVkCard).type !== undefined) {
            params.template = attach;
            return;
        }
        const attachments = attach as string[];
        if (attachments.length) {
            params.attachments = attachments;
        }
    }

    /**
     * Возвращает JSON клавиатуры ВКонтакте для текущего ответа.
     *
     * @param controller Контроллер текущего запроса
     * @returns JSON клавиатуры либо `null`, если клавиатуру трогать не нужно
     */
    #buildKeyboard(controller: BotController): string | null {
        if (!controller.isButtonsInit()) {
            return null;
        }
        const keyboard = controller.buttons.getButtonJson((buttons) =>
            buttonProcessing(buttons, this.appContext),
        );
        if (keyboard) {
            return keyboard;
        }
        // Клавиатура ВК сохраняется в диалоге до явной замены. Убрать её можно
        // только отправив клавиатуру с пустым списком кнопок.
        return controller.buttons.isRemove
            ? JSON.stringify({ one_time: false, buttons: [] })
            : null;
    }

    /**
     * Формирует и отправляет ответ VK: сообщения, callback-события
     * (sendMessageEvent/show_snackbar), карточки, клавиатуру и звуки.
     * @param controller Контроллер приложения
     * @returns Тело ответа для webhook ('ok')
     */
    async getContent(controller: BotController): Promise<string> {
        if (!controller.skipAutoReply) {
            const vkApi = new VkRequest(this.appContext as AppContext);
            const requestData = getPlatformRequestData<IVkRequestData>(
                controller,
                this.platformName,
            );
            const eventId = requestData.eventId ?? controller.platformOptions.eventId;
            const callbackPeerId = requestData.peerId ?? controller.userId ?? undefined;

            // Для callback-кнопок (message_event) отправляем sendMessageEvent вместо messagesSend.
            // Если в процессе обработки возникла ошибка — показываем её пользователю через show_snackbar
            // и не отправляем обычное сообщение.
            if (eventId) {
                if (controller.platformOptions.error) {
                    await vkApi.sendMessageEvent(
                        controller.userId as string,
                        eventId,
                        {
                            type: 'show_snackbar',
                            text: Text.resize(controller.platformOptions.error as string, 90),
                        },
                        callbackPeerId,
                    );
                    return 'ok';
                }
                await vkApi.sendMessageEvent(
                    controller.userId as string,
                    eventId,
                    undefined,
                    callbackPeerId,
                );
            }

            const params: IVkParams = {};
            if (controller.isCardInit() && controller.card.images.length) {
                // cardProcessing асинхронный (upload картинок в VK), сбой слоя
                // БД/API не должен ронять весь ответ в 500 — серия 5xx отключает
                // вебхук VK Callback API. Деградируем: сообщение без карточки.
                const attach = await this.#getCardAttachSafe(controller);
                if (attach) {
                    this.#applyCardToParams(attach, params);
                }
            }
            const keyboard = this.#buildKeyboard(controller);
            if (keyboard && params.template === undefined) {
                params.keyboard = keyboard;
            }
            if (shouldProcessChatSound(controller, this.platformName)) {
                const attach = await controller.sound.getSounds(
                    controller.tts,
                    soundProcessing,
                    controller,
                );
                const attachments = [...(attach as string[]), ...(params.attachments || [])];
                if (attachments.length) {
                    params.attachments = attachments;
                }
            }
            // Если заполнен только tts, используем его как текст сообщения:
            // иначе общая с голосовой платформой логика оставляла бы ВК без ответа.
            let text = getChatText(controller.text, controller.tts);
            if (!text && params.template !== undefined) {
                text = this.#getCarouselText(controller);
            }
            await vkApi.messagesSend(
                (requestData.peerId ?? controller.userId) as string,
                Text.resize(text, 4096),
                params,
            );
        }
        return 'ok';
    }

    /**
     * Текст сообщения для карусели, когда ответ не содержит текста.
     *
     * VK требует непустой `message` в сообщении с каруселью и без него
     * отклоняет всё сообщение. Берём заголовок карточки, затем заголовок
     * первого элемента; если нет и их — предупреждаем (VK ответит ошибкой).
     *
     * @param controller Контроллер приложения
     * @returns Текст для сообщения с каруселью (пустой, если взять неоткуда)
     */
    #getCarouselText(controller: BotController): string {
        const text = controller.card.title || controller.card.images[0]?.title || '';
        if (!text) {
            controller.appContext.logWarn(
                'VkAdapter.getContent(): VK требует текст сообщения для карусели, а в ответе нет ни текста, ни заголовка карточки — сообщение будет отклонено.',
            );
        }
        return text;
    }

    static isVoice(): boolean {
        return false;
    }

    /**
     * Формирует пример webhook-запроса VK (событие message_new)
     * для локального тестирования (BotTest).
     * @param query Текст команды пользователя
     * @param userId Идентификатор пользователя (from_id)
     * @param count Номер сообщения (id)
     * @returns Заготовка запроса в формате VK Callback API
     */
    getQueryExample(query: string, userId: string, count: number): Record<string, unknown> {
        return {
            type: 'message_new',
            // group_id обязателен: isPlatformOnQuery распознаёт VK по этому полю
            // TODO: привести group_id в getQueryExample к string (тип IVkRequestContent)
            group_id: 1,
            object: {
                message: {
                    from_id: +userId,
                    text: query,
                    id: count,
                },
            },
        };
    }
}
