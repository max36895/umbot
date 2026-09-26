import { AppContext, BotController, Text } from '../../../index';
import type { IControllerApi } from '../../../controller';
import type { TEventType } from '../../../core/events';
import { IMaxParams, MaxRequest } from '../API';
import { BasePlatform, EMPTY_QUERY_ERROR } from '../Base/Base';
import { buttonProcessing } from './Button';
import { cardProcessing } from './Card';
import { soundProcessing } from './Sound';
import { T_MAX_APP } from './constants';
import { IMaxButtonObject, IMaxRequestContent } from './interfaces/IMaxPlatform';
import { makeMaxApi } from './apiFacade';
import { timingSafeEqual } from 'crypto';
import {
    getChatText,
    getPlatformRequestData,
    normalizeActionPayload,
    setThisUserToNlu,
    shouldProcessChatSound,
} from '../Base/utils';

type IMaxRequestData = Record<string, unknown> & {
    callbackId?: string;
    chatId?: number;
    /** Callback уже подтверждён через controller.api.answerCallback(). */
    callbackAnswered?: boolean;
};

const MAX_UPDATE_TYPES = new Set<IMaxRequestContent['update_type']>([
    'bot_added',
    'bot_started',
    'bot_stopped',
    'bot_removed',
    'chat_title_changed',
    'dialog_cleared',
    'dialog_muted',
    'dialog_unmuted',
    'dialog_removed',
    'message_callback',
    'message_created',
    'message_edited',
    'message_removed',
    'user_added',
    'user_removed',
]);

/**
 * Адаптер, обеспечивающий поддержку платформы MAX. Позволяет разрабатывать чат-ботов для мессенджера MAX на TypeScript с использованием кросс-платформенного функционала: обработка текстовых запросов, работа с карточками и кнопками.
 *
 * Подключение адаптера не требует изменения существующей бизнес-логики: после интеграции
 * все команды и обработчики, написанные для umbot, автоматически становятся доступны для MAX.
 * Единый интерфейс позволяет одновременно использовать одну бизнес-логику для нескольких
 * платформ (MAX, VK, Алиса и др.) без дублирования кода.
 *
 * Этот адаптер автоматически обрабатывает входящие вебхуки от мессенджера MAX,
 * преобразует их в унифицированный формат фреймворка и формирует ответ,
 * совместимый с требованиями платформы. Подключается одной строкой и
 * не мешает работе других адаптеров (например, для Алисы или Маруси).
 *
 * Поддерживает:
 * - текстовые запросы;
 * - карточки, кнопки;
 *
 * Подключается как любой другой адаптер: `bot.use(new MaxAdapter(token))`.
 * Несколько адаптеров могут работать одновременно — система сама выберет подходящий
 * на основе заголовков и структуры входящего запроса.
 * @example
 * ```ts
 * // Простейший бот для MAX, который отвечает на приветствие
 * import { Bot } from 'umbot';
 * import { MaxAdapter } from 'umbot/plugins';
 *
 * const bot = new Bot()
 *     .use(new MaxAdapter('YOUR_MAX_TOKEN'))
 *     .addCommand('start', ['привет'], (_text, ctx) => {
 *         ctx.text = 'Привет! Я твой первый бот для MAX';
 *     });
 *
 * bot.start('localhost', 3000);
 * ```
 *
 * @see Bot
 * @see BotController
 * @see BasePlatform
 */
export class MaxAdapter extends BasePlatform<string | IMaxRequestContent> {
    /**
     * Идентификатор платформы MAX.
     */
    platformName = T_MAX_APP;
    /**
     * Универсальные события MAX (для валидации addEvent).
     */
    supportedEvents: readonly TEventType[] = ['message', 'callback', 'start', 'message_edited'];
    /**
     * MAX — чат-платформа (не голосовая).
     */
    isVoice = false;
    /**
     * Лимит запросов/сек для входящего rateLimiter (лимит MAX Bot API).
     */
    limit = 30;

    /**
     * API-фасад MAX для `controller.api` (медиа через `POST /uploads`,
     * ответ на callback). Подключается ядром через контракт `IPlatformAdapter`.
     * @param controller - Контроллер текущего запроса
     */
    createApi(controller: BotController): IControllerApi | null {
        return makeMaxApi(controller);
    }

    /**
     * Инициализирует адаптер: вызывает базовую инициализацию, переносит токен
     * и webhook-secret (опция `secret` либо конфигурация) в настройки платформы.
     * @param appContext Контекст приложения (конфиги, токены, логгер)
     */
    init(appContext: AppContext): void {
        super.init(appContext);
        const platformToken = appContext.appConfig.tokens[this.platformName];
        if (this._token && platformToken) {
            platformToken.token = this._token;
        }
        // MAX передаёт webhook-secret обычным заголовком. Разрешаем передать его
        // как через настройки адаптера, так и через конфигурацию приложения.
        const webhookSecret = this._platformOptions?.secret ?? platformToken?.webhookSecret;
        if (webhookSecret && platformToken) {
            this.signatureName = 'x-max-bot-api-secret';
            platformToken.webhookSecret = String(webhookSecret);
        }
    }

    /**
     * Проверяет, что входящий webhook-запрос принадлежит MAX.
     * Опознаёт запрос по известным значениям `update_type` либо по связке
     * `update_type` + `timestamp`.
     * @param query Входящий webhook-запрос
     * @param headers Заголовки HTTP-запроса (не используются при опознании)
     * @returns `true`, если запрос относится к платформе MAX
     */
    isPlatformOnQuery(query: IMaxRequestContent, headers?: Record<string, unknown>): boolean {
        void headers;
        if (!query) {
            this.appContext?.logWarn(`MaxAdapter.isPlatformOnQuery(): ${EMPTY_QUERY_ERROR}`);
            return false;
        }
        if (MAX_UPDATE_TYPES.has(query.update_type)) {
            return true;
        }
        // Новые типы событий MAX тоже принимаем, но только если запрос однозначно
        // от MAX: связка update_type + timestamp есть у каждого апдейта платформы
        // и не встречается у других. Иначе новый тип события не определялся бы
        // как MAX и запрос завершался ошибкой вместо тихого пропуска в setQueryData().
        return (
            typeof query.update_type === 'string' &&
            query.update_type.length > 0 &&
            typeof query.timestamp === 'number'
        );
    }

    /**
     * Проверяет webhook-secret MAX.
     * MAX передаёт исходное значение секрета в заголовке, а не HMAC от тела.
     * @param _query Тело запроса (не используется: секрет приходит заголовком)
     * @param headers HTTP-заголовки запроса
     * @returns `true`, если секрет совпадает (или проверка не настроена), иначе `false`
     */
    isCorrectQuery(
        _query: string | IMaxRequestContent,
        headers?: Record<string, unknown>,
    ): boolean {
        const expectedSecret = this.appContext?.appConfig.tokens[this.platformName]?.webhookSecret;
        if (!expectedSecret || !this.signatureName) {
            return true;
        }
        const headerSecret = headers?.[this.signatureName];
        if (typeof headerSecret !== 'string') {
            return false;
        }
        const expected = Buffer.from(String(expectedSecret));
        const received = Buffer.from(headerSecret);
        return expected.length === received.length && timingSafeEqual(expected, received);
    }

    /**
     * MAX проверяет именно `webhookSecret` (options.secret / tokens.max_app.webhookSecret),
     * а не токен API из конструктора.
     */
    isSignatureCheckEnabled(): boolean {
        return Boolean(
            this.appContext?.appConfig.tokens[this.platformName]?.webhookSecret &&
            this.signatureName,
        );
    }

    /**
     * ID доставки для дедупликации повторов вебхука. Отдельного ID у обновления MAX нет,
     * поэтому ключ собирается из типа, времени и объекта события: одно сообщение (`mid`)
     * приходит и как `message_created`, и как `message_edited`.
     * @param query Входящее обновление
     * @returns Ключ доставки или `null`, если в обновлении нет времени
     */
    getDeliveryId(query: IMaxRequestContent): string | null {
        if (!query?.update_type || query.timestamp === undefined) {
            return null;
        }
        const target =
            query.callback?.callback_id ??
            query.message?.body?.mid ??
            query.chat_id ??
            query.user?.user_id ??
            '';
        return `${query.update_type}:${query.timestamp}:${target}`;
    }

    /**
     * Заполняет контроллер данными callback-кнопки MAX.
     */
    #setCallbackData(query: IMaxRequestContent, controller: BotController): boolean {
        if (query.update_type !== 'message_callback' || !query.callback) {
            return false;
        }
        controller.eventType = 'callback';
        controller.userId = query.callback.user?.user_id ?? query.message?.sender?.user_id ?? 0;
        // Нормализуем payload кнопки в имя действия: 'buy' или {"command":"buy"}
        // превращаются в userCommand='buy' и срабатывают через addAction/команду.
        controller.userCommand = normalizeActionPayload(query.callback.payload);
        controller.originalUserCommand = query.callback.payload ?? '';
        controller.payload = query.callback.payload ?? null;
        const requestData = getPlatformRequestData<IMaxRequestData>(controller, this.platformName);
        requestData.callbackId = query.callback.callback_id;
        if (query.message?.recipient?.chat_id) {
            requestData.chatId = query.message.recipient.chat_id;
        }
        return true;
    }

    /**
     * Заполняет контроллер данными служебного события MAX без автоматического ответа.
     */
    #setServiceData(query: IMaxRequestContent, controller: BotController): void {
        controller.userId = query.user?.user_id ?? 0;
        // bot_started — пользователь нажал «Начать»: это первое касание, и ему
        // отвечают приветствием (как conversation_started у Viber или RUN_APP у
        // SmartApp), поэтому skipAutoReply не ставится.
        // Параметр deep-link приходит в payload события.
        if (query.update_type === 'bot_started') {
            controller.eventType = 'start';
            controller.userCommand = '';
            controller.messageId = 0;
            controller.payload = query.payload ?? null;
            if (query.chat_id !== undefined) {
                getPlatformRequestData<IMaxRequestData>(controller, this.platformName).chatId =
                    query.chat_id;
            }
            return;
        }
        // Остальные служебные события ответа не требуют, но несут тип для
        // addEvent: message_edited — редактирование. Прочие (bot_added,
        // dialog_*) пока не имеют универсального события ('message').
        controller.skipAutoReply = true;
        switch (query.update_type) {
            case 'message_edited':
                controller.eventType = 'message_edited';
                break;
        }
        if (query.chat_id !== undefined) {
            getPlatformRequestData<IMaxRequestData>(controller, this.platformName).chatId =
                query.chat_id;
        }
    }

    /**
     * Заполняет контроллер данными входящего сообщения MAX.
     */
    #setMessageData(query: IMaxRequestContent, controller: BotController): boolean {
        const object = query.message;
        if (!object) {
            return false;
        }
        controller.userId = object.sender?.user_id ?? query.user?.user_id ?? 0;
        const chatId = object.recipient?.chat_id;
        if (chatId) {
            getPlatformRequestData<IMaxRequestData>(controller, this.platformName).chatId = chatId;
        }
        const body = object.body;
        const raw = body?.text ?? '';
        controller.userCommand = raw.toLowerCase().trim();
        controller.originalUserCommand = raw.trim();
        controller.messageId = body?.seq ?? 0;
        controller.payload =
            (body?.attachments as unknown as Record<string, unknown> | undefined) ?? null;
        // Пустого thisUser не записываем — без полей он не несёт данных (setThisUserToNlu).
        setThisUserToNlu(controller, {
            username: object.sender?.username || null,
            first_name: object.sender?.first_name || null,
            last_name: object.sender?.last_name || null,
        });
        return true;
    }

    /**
     * Разбирает update MAX (сообщение, callback-кнопка, служебное событие)
     * и наполняет контроллер данными; служебные события помечаются skipAutoReply.
     * @param query Входящий webhook-запрос (update)
     * @param controller Контроллер приложения
     * @returns `true`, если запрос успешно разобран
     */
    setQueryData(query: IMaxRequestContent, controller: BotController): boolean {
        if (!this.appContext) {
            return false;
        }
        if (!query) {
            controller.platformOptions.error = `MaxAdapter:setQueryData(): ${EMPTY_QUERY_ERROR}`;
            return false;
        }
        controller.requestObject = query;
        if (this.#setCallbackData(query, controller)) {
            return true;
        }
        if (query.update_type !== 'message_created') {
            this.#setServiceData(query, controller);
            return true;
        }
        return this.#setMessageData(query, controller);
    }

    /**
     * Собирает клавиатуру и вложения (карточки, звуки) ответа.
     * @param controller Контроллер приложения
     * @returns Параметры сообщения MAX
     */
    async #buildParams(controller: BotController): Promise<IMaxParams> {
        const keyboard = controller.isButtonsInit()
            ? controller.buttons.getButtons<IMaxButtonObject>((buttons) =>
                  buttonProcessing(buttons, this.appContext as AppContext),
              )
            : null;
        const params: IMaxParams = {};
        // Проверяем не только наличие объекта, но и непустой список кнопок: buttonProcessing
        // всегда возвращает объект, поэтому при пустой клавиатуре в MAX уходило вложение
        // inline_keyboard с buttons: [], которое API отклоняет.
        if (keyboard?.buttons?.length) {
            params.keyboard = keyboard;
        }
        if (controller.isCardInit() && controller.card.images.length) {
            params.attachments = await controller.card.getCards(cardProcessing, controller);
        }
        if (shouldProcessChatSound(controller, this.platformName)) {
            const attach = await controller.sound.getSounds(
                controller.tts,
                soundProcessing,
                controller,
            );
            params.attachments = [...(attach || []), ...(params.attachments || [])];
        }
        return params;
    }

    /**
     * Формирует и отправляет ответ MAX: текст, клавиатуру, карточки и звуки
     * (с учётом лимитов MAX на частоту сообщений в диалоге). Нажатие callback-кнопки
     * подтверждается POST /answers, а ответ уходит новым сообщением; с опцией
     * `max_callback_edit_message: true` ответ заменяет сообщение с кнопкой.
     * @param controller Контроллер приложения
     * @returns Тело ответа для webhook ('ok')
     */
    getContent(controller: BotController): string | Promise<string> {
        // Без автоответа отвечать нечем — без промиса и без async-кадра.
        return controller.skipAutoReply ? 'ok' : this.#sendContent(controller);
    }

    /**
     * Отправляет ответ в API платформы (часть {@link getContent}).
     * @param controller Контроллер приложения
     * @returns Тело ответа для webhook ('ok')
     */
    async #sendContent(controller: BotController): Promise<string> {
        const params = await this.#buildParams(controller);
        const maxApi = new MaxRequest(controller.appContext);
        const requestData = getPlatformRequestData<IMaxRequestData>(controller, this.platformName);
        // MAX Bot API ограничивает текст сообщения 4000 символами
        // Если в запросе был chat_id (групповой чат/канал) — используем его,
        // иначе отправляем в личный диалог по user_id
        const chatId =
            requestData.chatId ?? (controller.platformOptions.chatId as number | undefined);
        const peerId: string | number = chatId ?? controller.userId ?? '';
        if (peerId === '') {
            controller.appContext.logWarn(
                'MaxAdapter.getContent(): не указан user_id или chat_id; ответ не будет отправлен.',
            );
            return 'ok';
        }
        const text = Text.resize(getChatText(controller.text, controller.tts), 4000);
        const callbackId = requestData.callbackId;
        if (callbackId && this._platformOptions?.max_callback_edit_message === true) {
            // Opt-in: ответ заменяет сообщение с нажатой кнопкой (POST /answers с message).
            await maxApi.answerCallback(callbackId, text, params, peerId);
            return 'ok';
        }
        if (callbackId && !requestData.callbackAnswered) {
            // POST /answers с message ЗАМЕНЯЕТ сообщение с кнопкой. Чтобы поведение
            // совпадало с Telegram и VK (ответ — новым сообщением), нажатие только
            // подтверждаем пустым телом, а ответ отправляем через POST /messages.
            await maxApi.answerCallback(callbackId, '', null, peerId);
        }
        await maxApi.messagesSend(peerId, text, params, chatId ? 'chat' : 'user');
        return 'ok';
    }

    static isVoice(): boolean {
        return false;
    }

    /**
     * Формирует пример webhook-запроса MAX (update_type='message_created')
     * для локального тестирования (BotTest).
     * @param query Текст команды пользователя
     * @param userId Идентификатор пользователя (sender.user_id)
     * @param count Номер сообщения (seq)
     * @returns Заготовка запроса в формате webhook MAX
     */
    getQueryExample(query: string, userId: string, count: number): Record<string, unknown> {
        return {
            update_type: 'message_created',
            message: {
                sender: {
                    user_id: +userId,
                },
                body: {
                    text: query,
                    seq: count,
                    mid: '',
                },
            },
        };
    }
}
