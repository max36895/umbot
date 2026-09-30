import { AppContext, BotController } from '../../../index';
import type { IControllerApi } from '../../../controller';
import type { TEventType } from '../../../core/events';
import { ViberRequest, IViberParams, IViberSender } from '../API';
import { BasePlatform, EMPTY_QUERY_ERROR } from '../Base/Base';
import { buttonProcessing } from './Button';
import { normalizeActionPayload } from '../Base/utils';
import { cardProcessing } from './Card';
import { soundProcessing } from './Sound';
import { T_VIBER, VIBER_DEFAULT_API_VERSION } from './constants';
import { IViberButtonObject, IViberContent } from './interfaces/IViberPlatform';
import { makeViberApi } from './apiFacade';
import { getChatText, setThisUserToNlu, viberMessageEvent } from '../Base/utils';

/**
 * Адаптер, обеспечивающий поддержку платформы Viber. Позволяет разрабатывать чат-ботов для Viber на TypeScript с использованием кросс-платформенного функционала: обработка текстовых запросов, работа с карточками и кнопками.
 *
 * Подключение адаптера не требует изменения существующей бизнес-логики: после интеграции
 * все команды и обработчики, написанные для umbot, автоматически становятся доступны для Viber.
 * Единый интерфейс позволяет одновременно использовать одну бизнес-логику для нескольких
 * платформ (Viber, VK, Алиса и др.) без дублирования кода.
 *
 * Этот адаптер автоматически обрабатывает входящие вебхуки от мессенджера Viber,
 * преобразует их в унифицированный формат фреймворка и формирует ответ,
 * совместимый с требованиями платформы. Подключается одной строкой и
 * не мешает работе других адаптеров (например, для Алисы или Маруси).
 *
 * Поддерживает:
 * - текстовые запросы;
 * - карточки, кнопки;
 *
 * Подключается как любой другой адаптер: `bot.use(new ViberAdapter(token))`.
 * Несколько адаптеров могут работать одновременно — система сама выберет подходящий
 * на основе заголовков и структуры входящего запроса.
 * @example
 * ```ts
 * // Простейший бот для Viber, который отвечает на приветствие
 * import { Bot } from 'umbot';
 * import { ViberAdapter } from 'umbot/plugins';
 *
 * const bot = new Bot()
 *     .use(new ViberAdapter('YOUR_VIBER_TOKEN'))
 *     .addCommand('start', ['привет'], (_text, ctx) => {
 *         ctx.text = 'Привет! Я твой первый бот для Viber';
 *     });
 *
 * bot.start('localhost', 3000);
 * ```
 *
 * @see Bot
 * @see BotController
 * @see BasePlatform
 *
 * @group Адаптеры платформ
 */
export class ViberAdapter extends BasePlatform<IViberContent | string> {
    /**
     * Идентификатор платформы Viber.
     */
    platformName = T_VIBER;
    /**
     * Универсальные события Viber (для валидации addEvent).
     */
    supportedEvents: readonly TEventType[] = [
        'message',
        'photo',
        'video',
        'document',
        'contact',
        'location',
        'sticker',
        'start',
        'subscribed',
        'unsubscribed',
    ];
    /**
     * Viber — чат-платформа (не голосовая).
     */
    isVoice = false;
    /**
     * Лимит запросов/сек для входящего rateLimiter (лимит Viber API).
     */
    limit = 30;
    signatureName = 'x-viber-content-signature';

    /**
     * API-фасад Viber для `controller.api`. Методы медиа возвращают warn/null
     * (Bot API Viber принимает медиа только по URL с обязательным size — для
     * медиа используйте `controller.card`), `can()` честно возвращает `false`.
     * Подключается ядром через контракт `IPlatformAdapter`.
     * @param controller - Контроллер текущего запроса
     */
    createApi(controller: BotController): IControllerApi | null {
        return makeViberApi(controller);
    }

    /**
     * Инициализирует адаптер: вызывает базовую инициализацию и переносит
     * опции конструктора (токен, api_version, sender) в конфигурацию платформы.
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
        if (this._platformOptions?.viber_api_version) {
            platformToken.api_version = this._platformOptions.viber_api_version as string;
        }
        if (this._platformOptions?.viber_sender) {
            platformToken.sender = this._platformOptions.viber_sender as string;
        }
    }

    /**
     * Определяет, что запрос пришёл именно от Viber.
     * Проверяет наличие заголовка `x-viber-content-signature` или
     * служебных полей `event` и `timestamp`.
     * Поле `message_token` присутствует не во всех событиях
     * (например, `conversation_started`, `subscribed`, `unsubscribed`
     * его не содержат), поэтому оно не требуется для детекции платформы.
     *
     * @param query Распарсенное тело webhook-запроса.
     * @param headers HTTP-заголовки запроса.
     * @returns `true`, если запрос является Viber webhook.
     */
    isPlatformOnQuery(query: IViberContent, headers?: Record<string, unknown>): boolean {
        if (headers?.['x-viber-content-signature']) {
            return true;
        }
        if (!query) {
            this.appContext?.logWarn(`ViberAdapter.isPlatformOnQuery(): ${EMPTY_QUERY_ERROR}`);
            return false;
        }
        return query.event !== undefined && query.timestamp !== undefined;
    }

    /**
     * ID доставки для дедупликации повторов вебхука — событие и `message_token`.
     * `webhook` и `conversation_started` не дедуплицируются: ответ на них несёт
     * содержимое (подтверждение вебхука, приветствие), а повтор получил бы пустой `ok`.
     * @param query Входящее событие
     * @returns Ключ доставки или `null`
     */
    getDeliveryId(query: IViberContent): string | null {
        if (
            query?.message_token === undefined ||
            query.event === 'webhook' ||
            query.event === 'conversation_started'
        ) {
            return null;
        }
        return `${query.event}:${query.message_token}:${query.timestamp ?? ''}`;
    }

    /**
     * Обрабатывает событие conversation_started: запоминает пользователя и версию API.
     */
    #onConversationStarted(query: IViberContent, controller: BotController): boolean {
        controller.eventType = 'start';
        if (query.user) {
            controller.userId = query.user.id;

            controller.userCommand = '';
            controller.messageId = 0;

            controller.platformOptions.apiVersion =
                query.user.api_version || VIBER_DEFAULT_API_VERSION;
            this.setNlu(controller, query.user.name);
        }
        return true;
    }

    /**
     * Обрабатывает события subscribed/unsubscribed: логирует изменение подписки.
     */
    #onSubscriptionChanged(query: IViberContent, controller: BotController): boolean {
        controller.eventType = query.event === 'subscribed' ? 'subscribed' : 'unsubscribed';
        if (query.user) {
            controller.userId = query.user.id;
            controller.userCommand = '';
            controller.messageId = 0;
            const action =
                query.event === 'subscribed' ? 'подписался на бота' : 'отписался от бота';
            this.appContext!.log(`ViberAdapter: пользователь ${query.user.id} ${action}`);
        }
        // Отписавшемуся пользователю отправить сообщение нельзя — Viber API отклоняет
        // send_message. Без skipAutoReply пайплайн прогонял fallback и получал
        // гарантированную ошибку API на каждую отписку.
        if (query.event === 'unsubscribed') {
            controller.skipAutoReply = true;
        }
        return true;
    }

    /**
     * Обрабатывает событие message: заполняет контроллер текстом, типом сообщения и payload.
     */
    #onMessage(query: IViberContent, controller: BotController): boolean {
        if (!query.message) {
            return false;
        }
        // По схеме Viber у события 'message' поле sender обязательно, но в сети летают и
        // malformed-запросы — тогда возвращаем false, чтобы не упасть с TypeError на undefined.
        if (!query.sender) {
            controller.platformOptions.error =
                'ViberAdapter.setQueryData(): поле sender отсутствует в событии "message". Обработка прервана.';
            return false;
        }
        controller.userId = query.sender.id;
        const raw = query.message?.text ?? '';
        // Viber-кнопка с payload шлёт ActionBody текстом (кнопка с payload
        // {"command":"buy"} приходит как текстовое сообщение '{"command":"buy"}').
        // Нормализуем «именную» кнопку в userCommand, чтобы срабатывал
        // addAction/addCommand — как в Telegram/VK/MAX. Обычный текст
        // нормализация не меняет (только lower + trim).
        controller.userCommand = normalizeActionPayload(raw);
        controller.originalUserCommand = raw;
        controller.messageId = query.message_token ?? 0;
        // Универсальный тип события по типу сообщения Viber (text/picture/video/file/
        // contact/location/sticker) — для декларативного роутинга bot.addEvent.
        controller.eventType = viberMessageEvent(query.message.type);

        controller.platformOptions.apiVersion =
            query.sender.api_version || VIBER_DEFAULT_API_VERSION;

        this.setNlu(controller, query.sender.name);

        // Сохраняем тип сообщения и дополнительные данные
        if (query.message.type && query.message.type !== 'text') {
            (controller.platformOptions as Record<string, unknown>).viberMessageType =
                query.message.type;
            const extra: Record<string, unknown> = {};
            if (query.message.media) {
                extra.media = query.message.media;
            }
            if (query.message.location) {
                extra.location = query.message.location;
            }
            if (query.message.contact) {
                extra.contact = query.message.contact;
            }
            if (query.message.sticker_id !== undefined) {
                extra.sticker_id = query.message.sticker_id;
            }
            if (Object.keys(extra).length) {
                controller.payload = extra;
            }
        }

        return true;
    }

    /**
     * Разбирает webhook Viber и заполняет `BotController` полями userId, userCommand, nlu.
     * Возвращает `false` при пустом запросе или отсутствующем контексте.
     *
     * @param query Тело webhook-запроса от Viber.
     * @param controller Контроллер, который нужно заполнить.
     * @returns `true` — данные заполнены, `false` — запрос повреждён.
     */
    setQueryData(query: IViberContent, controller: BotController): boolean {
        if (!this.appContext) {
            return false;
        }
        if (!query) {
            controller.platformOptions.error = `ViberAdapter.setQueryData(): ${EMPTY_QUERY_ERROR}`;
            return false;
        }
        controller.requestObject = query;

        switch (query.event) {
            case 'conversation_started':
                return this.#onConversationStarted(query, controller);

            case 'subscribed':
            case 'unsubscribed':
                return this.#onSubscriptionChanged(query, controller);

            case 'delivered':
            case 'seen':
            case 'failed':
            case 'webhook':
                // Служебные события — не сообщения пользователя, автоответ на них
                // не нужен. Событие 'webhook' Viber присылает при вызове set_webhook
                // и ждёт HTTP 200, без него вебхук не регистрируется.
                // sendInInit подтверждает событие до бизнес-логики: delivered/seen
                // приходят на каждое исходящее сообщение и иначе прогоняли бы
                // middleware и fallback-команду.
                controller.skipAutoReply = true;
                controller.platformOptions.sendInInit = 'ok';
                return true;

            case 'message':
                return this.#onMessage(query, controller);
        }

        // Неизвестные/новые типы событий Viber тоже не должны приводить к 5xx:
        // на ошибку сервера Viber повторяет доставку и в итоге отключает вебхук.
        controller.skipAutoReply = true;
        controller.platformOptions.sendInInit = 'ok';
        this.appContext?.log(
            `ViberAdapter.setQueryData(): событие "${query.event}" не поддерживается и было пропущено.`,
        );
        return true;
    }

    /**
     * Формирует приветственное сообщение для события `conversation_started`.
     *
     * Пользователь ещё не подписан на бота, поэтому REST `send_message` Viber
     * отклонит — приветствие отдаётся JSON-телом HTTP-ответа на webhook
     * (единственный документированный канал). Так можно передать ровно одно
     * сообщение: карточки и звуки в приветствие не попадают.
     *
     * @param controller Контроллер приложения
     * @param viberApi Клиент Viber API (для сборки тела)
     * @param params Параметры сообщения (клавиатура)
     * @returns Тело webhook-ответа с приветствием либо 'ok', если отправлять нечего
     */
    #getWelcomeContent(
        controller: BotController,
        viberApi: ViberRequest,
        params: IViberParams,
    ): Record<string, unknown> | string {
        const hasCards = controller.isCardInit() && controller.card.images.length > 0;
        const hasSounds = controller.isSoundInit() && controller.sound.sounds.length > 0;
        if (hasCards || hasSounds) {
            controller.appContext.logWarn(
                'ViberAdapter.getContent(): на conversation_started Viber принимает только одно приветственное сообщение — карточки и звуки не отправлены.',
            );
        }
        const text = getChatText(controller.text, controller.tts);
        if (!text) {
            return 'ok';
        }
        return (
            viberApi.buildWelcomeMessage(
                (controller.appContext.appConfig.tokens[this.platformName]?.sender as
                    string | IViberSender | undefined) ?? null,
                text,
                params,
            ) ?? 'ok'
        );
    }

    /**
     * Формирует и отправляет ответ Viber: текст, клавиатуру, карточки
     * (rich media) и звуки; звуки и карточки уходят отдельными вызовами API.
     * На `conversation_started` приветствие возвращается телом webhook-ответа.
     * @param controller Контроллер приложения
     * @returns Тело ответа для webhook ('ok' либо JSON приветственного сообщения)
     */
    getContent(
        controller: BotController,
    ): string | Record<string, unknown> | Promise<string | Record<string, unknown>> {
        // Без автоответа отвечать нечем — без промиса и без async-кадра.
        return controller.skipAutoReply ? 'ok' : this.#sendContent(controller);
    }

    /**
     * Отправляет ответ в API платформы (часть {@link getContent}).
     * @param controller Контроллер приложения
     * @returns Тело ответа для webhook ('ok' либо JSON приветственного сообщения)
     */
    async #sendContent(controller: BotController): Promise<string | Record<string, unknown>> {
        const viberApi = new ViberRequest(controller.appContext);
        viberApi.apiVersion = controller.platformOptions.apiVersion;
        const params: IViberParams = {};
        const keyboard = controller.isButtonsInit()
            ? controller.buttons.getButtons<IViberButtonObject>((buttons) =>
                  buttonProcessing(buttons, controller.appContext),
              )
            : null;
        if (keyboard) {
            params.keyboard = keyboard;
            params.keyboard.Type = 'keyboard';
        }
        if ((controller.requestObject as IViberContent | null)?.event === 'conversation_started') {
            return this.#getWelcomeContent(controller, viberApi, params);
        }

        // Viber отклоняет type=text с пустым text. Карточки и звуки
        // отправляются отдельными API-вызовами, поэтому пустое сообщение им не требуется.
        // Если заполнен только tts (общая логика писалась под голосовую платформу),
        // используем его как текст: иначе Viber не получал вообще ничего.
        const text = getChatText(controller.text, controller.tts);
        if (text) {
            await viberApi.sendMessage(
                <string>controller.userId,
                controller.appContext.appConfig.tokens[this.platformName]?.sender as
                    string | IViberSender,
                text,
                params,
            );
        } else if (keyboard) {
            controller.appContext.logWarn(
                'ViberAdapter.getContent(): клавиатура задана без текста и не может быть отправлена отдельным сообщением.',
            );
        }

        if (controller.isCardInit() && controller.card.images.length) {
            const res = controller.card.getCards(cardProcessing, controller);
            // `cardProcessing` может вернуть одиночный объект (для одной картинки) или массив (для галереи)
            const list = Array.isArray(res) ? res : res ? [res] : [];
            if (list.length) {
                await viberApi.richMedia(<string>controller.userId, list);
            }
        }

        if (controller.isSoundInit() && controller.sound.sounds.length) {
            await controller.sound.getSounds(controller.tts, soundProcessing, controller);
        }
        return 'ok';
    }

    /**
     * Заполняет данные о пользователе в NLU.
     * Разбивает полное имя на компоненты (username, first_name, last_name)
     * @param controller Контроллер приложения
     * @param userName Полное имя пользователя
     * @protected
     */
    protected setNlu(controller: BotController, userName: string = ''): void {
        const name = userName.split(' ');
        // Пустое имя не записываем — thisUser без полей бесполезен (setThisUserToNlu).
        setThisUserToNlu(controller, {
            username: name[0] || null,
            first_name: name.length > 1 ? name.slice(0, -1).join(' ') : null,
            // При length > 1 последний элемент существует; ?? null закрывает
            // noUncheckedIndexedAccess без изменения поведения.
            last_name: (name.length > 1 ? name[name.length - 1] : null) ?? null,
        });
    }

    static isVoice(): boolean {
        return false;
    }

    /**
     * Формирует пример webhook-запроса Viber (событие message)
     * для локального тестирования (BotTest).
     * @param query Текст команды пользователя
     * @param userId Идентификатор пользователя (sender.id)
     * @returns Заготовка запроса в формате webhook Viber
     */
    getQueryExample(query: string, userId: string): Record<string, unknown> {
        return {
            event: 'message',
            message: {
                text: query,
                type: 'text',
            },
            message_token: Date.now(),
            timestamp: Date.now(),
            sender: {
                id: userId,
                name: 'local_name',
                api_version: 8,
            },
        };
    }
}
