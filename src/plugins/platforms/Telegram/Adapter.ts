import { AppContext, BotController, Text } from '../../../index';
import type { IControllerApi } from '../../../controller';
import type { TEventType } from '../../../core/events';
import { BasePlatform, EMPTY_QUERY_ERROR } from '../Base/Base';
import { buttonProcessing, getTextButtonTitle } from './Button';
import { cardProcessing } from './Card';
import { soundProcessing } from './Sound';
import { T_TELEGRAM } from './constants';
import {
    ITelegramContent,
    ITelegramParams,
    ITelegramMedia,
    TTelegramChatId,
} from './interfaces/ITelegramPlatform';
import { TelegramRequest, prepareTelegramMessageText } from '../API';
import { makeTelegramApi } from './apiFacade';
import {
    getChatText,
    getPlatformRequestData,
    normalizeActionPayload,
    setThisUserToNlu,
    telegramMessageEvent,
    tryParse,
    shouldProcessChatSound,
} from '../Base/utils';
import { timingSafeEqual } from 'crypto';

type ITelegramRequestData = Record<string, unknown> & {
    callbackQueryId?: string;
    chatId?: number | string;
    inlineQueryId?: string;
};

/**
 * Адаптер, обеспечивающий поддержку платформы Telegram. Позволяет разрабатывать чат-ботов для Телеграм на TypeScript с использованием кросс-платформенного функционала: обработка текстовых запросов, работа с карточками и кнопками.
 *
 * Подключение адаптера не требует изменения существующей бизнес-логики: после интеграции
 * все команды и обработчики, написанные для umbot, автоматически становятся доступны для Telegram.
 * Единый интерфейс позволяет одновременно использовать одну бизнес-логику для нескольких
 * платформ (Telegram, VK, Алиса и др.) без дублирования кода.
 *
 * Этот адаптер автоматически обрабатывает входящие вебхуки от мессенджера Telegram,
 * преобразует их в унифицированный формат фреймворка и формирует ответ,
 * совместимый с требованиями платформы. Подключается одной строкой и
 * не мешает работе других адаптеров (например, для Алисы или Маруси).
 *
 * Поддерживает:
 * - текстовые запросы, callback-кнопки, inline-запросы;
 * - карточки, кнопки;
 *
 * Подключается как любой другой адаптер: `bot.use(new TelegramAdapter(token))`.
 * Несколько адаптеров могут работать одновременно — система сама выберет подходящий
 * на основе заголовков и структуры входящего запроса.
 * @example
 * ```ts
 * // Простейший бот для Telegram, который отвечает на приветствие
 * import { Bot } from 'umbot';
 * import { TelegramAdapter } from 'umbot/plugins';
 *
 * const bot = new Bot()
 *     .use(new TelegramAdapter('YOUR_BOT_TOKEN'))
 *     .addCommand('start', ['привет'], (_text, ctx) => {
 *         ctx.text = 'Привет! Я твой первый бот для Telegram';
 *     });
 *
 * bot.start('localhost', 3000);
 * ```
 *
 * @see Bot
 * @see BotController
 * @see BasePlatform
 */
export class TelegramAdapter extends BasePlatform<string | ITelegramContent> {
    /**
     * Идентификатор платформы Telegram.
     */
    platformName = T_TELEGRAM;
    /**
     * Универсальные события, выставляемые адаптером Telegram (для валидации addEvent).
     */
    supportedEvents: readonly TEventType[] = [
        'message',
        'photo',
        'voice',
        'video',
        'document',
        'location',
        'contact',
        'sticker',
        'callback',
        'inline',
        'message_edited',
        'channel_post',
    ];
    /**
     * Telegram — чат-платформа (не голосовая).
     */
    isVoice = false;
    /**
     * Лимит запросов/сек для входящего rateLimiter (лимит Telegram Bot API).
     */
    limit = 30;
    signatureName = 'x-telegram-bot-api-secret-token';

    /**
     * API-фасад Telegram для `controller.api` (отправка медиа, ответ на
     * callback-кнопку). Подключается ядром через контракт `IPlatformAdapter`.
     * @param controller - Контроллер текущего запроса
     */
    createApi(controller: BotController): IControllerApi | null {
        return makeTelegramApi(controller);
    }

    /**
     * Инициализирует адаптер: вызывает базовую инициализацию и пробрасывает
     * переданный в конструкторе токен в конфигурацию платформы.
     * @param appContext Контекст приложения (конфиги, токены, логгер)
     */
    init(appContext: AppContext): void {
        super.init(appContext);
        if (this._token) {
            const platformToken = appContext.appConfig.tokens[this.platformName];
            if (platformToken) {
                platformToken.token = this._token;
            }
        }
    }

    /**
     * Проверяет, что входящий webhook-запрос принадлежит Telegram.
     * Опознаёт запрос по подписи `x-telegram-bot-api-secret-token` или по
     * наличию числового `update_id`.
     * @param query Входящий webhook-запрос (update)
     * @param headers Заголовки HTTP-запроса (проверяется подпись webhook)
     * @returns `true`, если запрос относится к платформе Telegram
     */
    isPlatformOnQuery(query: ITelegramContent, headers?: Record<string, unknown>): boolean {
        if (headers?.['x-telegram-bot-api-secret-token']) {
            return true;
        }
        if (!query) {
            this.appContext?.logWarn(`TelegramAdapter.isPlatformOnQuery(): ${EMPTY_QUERY_ERROR}`);
            return false;
        }
        // Telegram помечает update_id'ом любой апдейт. Набор известных полей не
        // проверяем: иначе my_chat_member, poll_answer, message_reaction и т.п.
        // получали бы 500, а Telegram ретраил бы их и блокировал очередь обновлений.
        return typeof query.update_id === 'number';
    }

    /**
     * Проверка webhook-запроса от Telegram.
     *
     * Telegram шлёт webhook secret как обычную строку в заголовке
     * `x-telegram-bot-api-secret-token`. Этот secret НЕ совпадает с bot token —
     * он задаётся отдельно при вызове setWebhook(..., {secret_token: 'your-secret'}).
     *
     * Поэтому для проверки используется отдельное поле
     * `appConfig.tokens.telegram.webhookSecret`. Если оно не задано — проверка
     * пропускается (обратная совместимость и webhook без secret).
     *
     * @param query Тело запроса
     * @param headers HTTP-заголовки запроса
     * @returns `true`, если подпись совпадает (или проверка не настроена), иначе `false`
     */
    isCorrectQuery(query: string | ITelegramContent, headers?: Record<string, unknown>): boolean {
        const webhookSecret = this.appContext?.appConfig.tokens[this.platformName]?.webhookSecret;
        // Проверка активна ТОЛЬКО если webhookSecret задан явно — иначе пропускаем
        // (не ломаем polling и webhook без secret_token).
        if (webhookSecret && this.signatureName) {
            const headerValue = headers?.[this.signatureName];
            if (!headerValue) {
                return false;
            }
            try {
                // timingSafeEqual требует Buffer одинаковой длины
                const expected = Buffer.from(String(webhookSecret));
                const received = Buffer.from(String(headerValue));
                if (expected.length !== received.length) {
                    return false;
                }
                return timingSafeEqual(expected, received);
            } catch {
                return false;
            }
        }
        return true;
    }

    /**
     * Telegram проверяет именно `webhookSecret`, а не токен бота:
     * токен в конструкторе не включает проверку подписи.
     */
    isSignatureCheckEnabled(): boolean {
        return Boolean(
            this.appContext?.appConfig.tokens[this.platformName]?.webhookSecret &&
            this.signatureName,
        );
    }

    #setCallbackQuery(query: ITelegramContent, controller: BotController): boolean {
        const cb = query.callback_query;
        if (cb) {
            // `from` обязателен по протоколу Telegram, но в интерфейсе опционален:
            // без него пользователь анонимен — честный null вместо ложного undefined.
            controller.userId = cb.from?.id ?? null;
            controller.eventType = 'callback';
            // callback_data может быть строкой или JSON-строкой. Нормализуем
            // «именную» кнопку: payload 'buy' или {"command":"buy"} превращается
            // в userCommand='buy', чтобы сработал addAction/addCommand (см. Base/utils).
            // Текстовая inline-кнопка с длинным текстом присылает токен — нажатие
            // обрабатываем как ввод текста кнопки.
            const buttonTitle = getTextButtonTitle(cb.data, cb.message?.reply_markup);
            controller.userCommand =
                buttonTitle !== null
                    ? buttonTitle.toLowerCase().trim()
                    : normalizeActionPayload(cb.data) || '';
            controller.originalUserCommand = buttonTitle ?? (cb.data || '');
            controller.messageId = cb.message?.message_id ?? null;
            controller.payload = tryParse(cb.data);
            // Сохраняем ID callback-запроса, чтобы потом ответить.
            getPlatformRequestData<ITelegramRequestData>(
                controller,
                this.platformName,
            ).callbackQueryId = cb.id;
            // В группах отправитель callback и чат, где находится исходное сообщение,
            // различаются. Ответ должен вернуться именно в этот чат.
            const chatId = cb.message?.chat?.id;
            if (chatId !== undefined) {
                getPlatformRequestData<ITelegramRequestData>(controller, this.platformName).chatId =
                    chatId;
            }
            return true;
        }
        return false;
    }

    #setInlineQuery(query: ITelegramContent, controller: BotController): boolean {
        const iq = query.inline_query;
        if (iq) {
            controller.userId = iq.from?.id ?? null;
            controller.eventType = 'inline';
            controller.userCommand = iq.query?.toLowerCase().trim() || '';
            controller.originalUserCommand = iq.query || '';
            getPlatformRequestData<ITelegramRequestData>(
                controller,
                this.platformName,
            ).inlineQueryId = iq.id;
            return true;
        }
        return false;
    }

    /**
     * Сохраняет выбранный inline-результат как служебное событие без автоответа.
     */
    #setChosenInlineResult(query: ITelegramContent, controller: BotController): boolean {
        const result = query.chosen_inline_result;
        if (!result) {
            return false;
        }
        controller.userId = result.from.id;
        controller.userCommand = result.query.toLowerCase().trim();
        controller.originalUserCommand = result.query;
        controller.payload = result.result_id;
        controller.skipAutoReply = true;
        return true;
    }

    /**
     * Заполняет контроллер данными из обычного сообщения (query.message).
     */
    #setMessage(
        message: NonNullable<ITelegramContent['message']>,
        controller: BotController,
    ): boolean {
        // Апдейт без chat — некорректный, отвечаем 200, чтобы Telegram
        // не крутил его повторной доставкой.
        if (!message.chat) {
            this.appContext?.logWarn(
                'TelegramAdapter.setQueryData(): апдейт message без объекта chat пропущен как некорректный.',
            );
            controller.skipAutoReply = true;
            controller.platformOptions.sendInInit = 'ok';
            return true;
        }
        controller.userId = message.from?.id ?? message.chat.id;
        getPlatformRequestData<ITelegramRequestData>(controller, this.platformName).chatId =
            message.chat.id;
        controller.userCommand = message.text?.toLowerCase()?.trim() || '';
        // || '' — для сообщений без текста (стикер, фото), чтобы поле всегда было строкой.
        controller.originalUserCommand = message.text || '';
        controller.messageId = message.message_id;
        controller.eventType = telegramMessageEvent(message);

        // Данные пользователя берём у отправителя (from), а не у чата: в группах
        // chat.username — это публичный юзернейм группы, а не человека.
        const sender = message.from ?? message.chat;
        // Пустого thisUser не записываем — иначе каждый запрос аллоцировал бы
        // объект Nlu без пользы (см. setThisUserToNlu).
        setThisUserToNlu(controller, {
            username: sender.username || null,
            first_name: sender.first_name || null,
            last_name: sender.last_name || null,
        });
        return true;
    }

    /**
     * Заполняет контроллер данными из поста в канале (channel_post / edited_channel_post).
     * Для каналов «пользователь» — сам канал, поэтому userId = chat.id.
     */
    #setPost(
        post: NonNullable<ITelegramContent['channel_post']>,
        controller: BotController,
    ): boolean {
        controller.userId = post.chat?.id;
        controller.userCommand = post.text?.toLowerCase().trim() || '';
        controller.originalUserCommand = post.text || '';
        controller.messageId = post.message_id;
        controller.eventType = 'channel_post';
        return true;
    }

    /**
     * Разбирает update Telegram и наполняет контроллер данными: сообщение,
     * callback-запрос, пост канала, редактирование, inline-запрос и т.д.
     * @param query Входящий webhook-запрос (update)
     * @param controller Контроллер приложения
     * @returns `true`, если запрос успешно разобран
     */
    async setQueryData(query: ITelegramContent, controller: BotController): Promise<boolean> {
        if (!this.appContext) {
            return false;
        }
        if (!query) {
            controller.platformOptions.error = `TelegramAdapter.setQueryData(): ${EMPTY_QUERY_ERROR}`;
            return false;
        }
        controller.requestObject = query;

        // Кейс 1: обычное сообщение
        if (query.message !== undefined) {
            return this.#setMessage(query.message, controller);
        }
        // Кейс 2: callback_query (нажатие на inline-кнопку)
        if (query.callback_query) {
            return this.#setCallbackQuery(query, controller);
        }
        // Кейс 3: сообщение в канале
        if (query.channel_post) {
            return this.#setPost(query.channel_post, controller);
        }

        // Кейс 4: отредактированное сообщение. Идёт через #setMessage, а не #setPost:
        // это действие того же человека в том же чате, и userId должен совпадать
        // с исходным сообщением (иначе в группе редактирование уходило под ID группы).
        if (query.edited_message) {
            const res = this.#setMessage(query.edited_message, controller);
            // Редактирование — отдельное событие поверх содержимого сообщения:
            // 'message_edited' важнее 'photo'/'voice'/... для обработчиков addEvent.
            controller.eventType = 'message_edited';
            return res;
        }

        // Кейс 5: отредактированный пост в канале
        if (query.edited_channel_post) {
            const res = this.#setPost(query.edited_channel_post, controller);
            controller.eventType = 'message_edited';
            return res;
        }

        // Кейс 6: inline query
        if (query.inline_query) {
            return this.#setInlineQuery(query, controller);
        }
        if (query.chosen_inline_result) {
            return this.#setChosenInlineResult(query, controller);
        }

        // Кейс 7: остальные типы апдейтов (my_chat_member, chat_member, poll_answer,
        // message_reaction, my_chat_join_request и др.). Отвечать на них нечем, но
        // и ошибкой это не является: вернув false, мы отдавали Telegram 500, а он
        // повторял тот же апдейт снова и снова.
        // sendInInit подтверждает апдейт сразу, до бизнес-логики: иначе на каждый
        // служебный апдейт срабатывали бы middleware и fallback-команда
        // (skipAutoReply глушит только отправку ответа, но не сам запуск логики).
        controller.skipAutoReply = true;
        controller.platformOptions.sendInInit = 'ok';
        this.appContext?.log(
            `TelegramAdapter.setQueryData(): апдейт update_id=${query.update_id} не содержит поддерживаемого события. Ответ не отправляется.`,
        );
        return true;
    }

    /**
     * Отвечает на inline-запрос одной безопасной текстовой статьёй.
     */
    async #answerInlineQuery(
        telegramApi: TelegramRequest,
        inlineQueryId: string,
        text: string,
    ): Promise<void> {
        if (!text) {
            this.appContext?.logWarn(
                'TelegramAdapter.getContent(): inline-ответ не содержит текста. Результаты не будут добавлены.',
            );
            await telegramApi.answerInlineQuery(inlineQueryId, []);
            return;
        }
        const responseText = Text.resize(text, 4096);
        await telegramApi.answerInlineQuery(inlineQueryId, [
            {
                type: 'article',
                id: 'umbot-response',
                title: Text.resize(text, 64),
                input_message_content: { message_text: responseText },
            },
        ]);
    }

    /**
     * Собирает `reply_markup` и режим разметки для исходящего сообщения.
     *
     * @param controller Контроллер текущего запроса
     * @returns Параметры сообщения Telegram
     */
    #buildMessageParams(controller: BotController): ITelegramParams {
        const params: ITelegramParams = {};
        const hasButtons = controller.isButtonsInit() && controller.buttons.buttons.length > 0;
        const keyboard = hasButtons
            ? buttonProcessing(controller.buttons.buttons, this.appContext as AppContext)
            : null;
        if (keyboard) {
            params.reply_markup = JSON.stringify(keyboard);
        } else if (controller.isButtonsInit() && controller.buttons.isRemove) {
            // Reply-клавиатура Telegram «прилипает» к чату и живёт до явного снятия.
            // Пустой список кнопок платформе не отправляется, поэтому без remove()
            // убрать её было нечем — она висела у пользователя навсегда.
            params.reply_markup = JSON.stringify({ remove_keyboard: true });
        }
        // Разметка выключена по умолчанию: пользовательский текст с символами
        // HTML иначе приводит к ошибке Telegram "can't parse entities".
        const parseMode = this._platformOptions?.telegram_parse_mode as string | undefined;
        if (parseMode) {
            params.parse_mode = parseMode;
        }
        return params;
    }

    /**
     * Отвечает на callback-кнопку (снимает «часики» в клиенте Telegram).
     */
    async #answerCallback(
        controller: BotController,
        telegramApi: TelegramRequest,
        requestData: ITelegramRequestData,
    ): Promise<void> {
        const callbackQueryId =
            requestData.callbackQueryId ?? controller.platformOptions.callbackQueryId;
        if (!callbackQueryId) {
            return;
        }
        const notificationText = controller.platformOptions.callbackNotificationText
            ? Text.resize(controller.platformOptions.callbackNotificationText, 200)
            : undefined;
        await telegramApi.answerCallbackQuery(
            callbackQueryId,
            notificationText,
            false,
            undefined,
            0,
        );
    }

    /**
     * Отправляет текст сообщения, если он есть; в противном случае предупреждает,
     * что Telegram не принимает пустое сообщение — и текст, и клавиатура не уйдут.
     *
     * @param controller Контроллер приложения
     * @param telegramApi Клиент Telegram API
     * @param chatId Идентификатор чата
     * @param params Параметры сообщения (reply_markup, parse_mode)
     * @param hasOtherContent Что ещё задано в ответе: кнопки, карточки, звуки
     */
    async #sendText(
        controller: BotController,
        telegramApi: TelegramRequest,
        chatId: TTelegramChatId,
        params: ITelegramParams,
        hasOtherContent: { buttons: boolean; cards: boolean; sounds: boolean },
    ): Promise<void> {
        // Если заполнен только tts (общая логика писалась под голосовую платформой),
        // используем его как текст: иначе Telegram не получал вообще ничего.
        const text = getChatText(controller.text, controller.tts);
        if (text) {
            await telegramApi.sendMessage(chatId, text, params);
            return;
        }
        const hasKeyboard = hasOtherContent.buttons || params.reply_markup;
        if (hasKeyboard || (!hasOtherContent.cards && !hasOtherContent.sounds)) {
            const isRemove = controller.isButtonsInit() && controller.buttons.isRemove;
            this.appContext?.logWarn(
                'TelegramAdapter.getContent(): ответ не содержит ни текста, ни tts. ' +
                    'Telegram не принимает пустое сообщение, поэтому ни текст, ни клавиатура отправлены не будут.' +
                    (isRemove
                        ? ' Для снятия клавиатуры через buttons.remove() ответ должен содержать текст.'
                        : ''),
            );
        }
    }

    /**
     * Отправляет карточки media group'ой, если они заданы.
     */
    async #sendCards(
        controller: BotController,
        telegramApi: TelegramRequest,
        chatId: TTelegramChatId,
        hasCards: boolean,
    ): Promise<void> {
        // Проверяем isCardInit(), чтобы не инстанцировать Card (и вложенный Buttons)
        // на каждый запрос, когда карточки не используются — как и в остальных адаптерах.
        if (!hasCards) {
            return;
        }
        const media: ITelegramMedia[] | null = await controller.card.getCards(
            cardProcessing,
            controller,
        );
        if (media) {
            await telegramApi.sendMediaGroup(chatId, media);
        }
    }

    /**
     * Отправляет звуки. Не создаём экземпляр Sound через геттер, если звуки не
     * использовались. Сбой слоя звука (исключение БД при getSoundInDB, API
     * SpeechKit) не должен ронять весь ответ — текст и карточки уже отправлены;
     * деградируем с warn.
     */
    async #sendSounds(controller: BotController, hasSounds: boolean): Promise<void> {
        if (!hasSounds) {
            return;
        }
        try {
            await controller.sound.getSounds(controller.tts, soundProcessing, controller);
        } catch (e) {
            this.appContext?.logError(
                `TelegramAdapter.getContent(): ошибка обработки звука, звук не отправлен. Текст ошибки: "${e instanceof Error ? e.message : String(e)}"`,
                { error: e },
            );
        }
    }

    /**
     * Отправляет обычный ответ Telegram с текстом, карточками, звуками и кнопками.
     */
    async #sendChatContent(
        controller: BotController,
        telegramApi: TelegramRequest,
        requestData: ITelegramRequestData,
    ): Promise<void> {
        const params = this.#buildMessageParams(controller);
        const chatId = (requestData.chatId ?? controller.userId) as TTelegramChatId;

        await this.#answerCallback(controller, telegramApi, requestData);

        // Проверяем isCardInit()/isSoundInit(), чтобы не инстанцировать Card и Sound
        // (и вложенный Buttons) на каждый запрос, когда они не используются —
        // как и в остальных адаптерах.
        const hasCards = controller.isCardInit() && controller.card.images.length > 0;
        const hasSounds = shouldProcessChatSound(controller, this.platformName);
        const hasButtons = controller.isButtonsInit() && controller.buttons.buttons.length > 0;

        await this.#sendText(controller, telegramApi, chatId, params, {
            buttons: hasButtons,
            cards: hasCards,
            sounds: hasSounds,
        });
        await this.#sendCards(controller, telegramApi, chatId, hasCards);
        await this.#sendSounds(controller, hasSounds);
    }

    /**
     * Формирует и отправляет ответ Telegram: текст, карточки (media group),
     * звуки, кнопки; при необходимости — inline-ответ или webhook-reply.
     * @param controller Контроллер приложения
     * @returns Тело ответа для webhook ('ok' либо конверт webhook-reply)
     */
    async getContent(controller: BotController): Promise<string | Record<string, unknown>> {
        if (controller.skipAutoReply) {
            return 'ok';
        }
        const telegramApi = new TelegramRequest(controller.appContext);
        const requestData = getPlatformRequestData<ITelegramRequestData>(
            controller,
            this.platformName,
        );
        if (requestData.inlineQueryId) {
            // Как и обычный ответ: если заполнен только tts, отдаём его текстом,
            // иначе inline-результат уходил пустым.
            await this.#answerInlineQuery(
                telegramApi,
                requestData.inlineQueryId,
                getChatText(controller.text, controller.tts),
            );
            return 'ok';
        }
        // Webhook-reply (opt-in: `new TelegramAdapter(token, { telegram_webhook_reply: true })`):
        // Telegram может выполнить ОДИН метод сам по телу webhook-ответа
        // ({method: 'sendMessage', ...}) — экономит исходящий POST. Механика
        // grammy-style: включается явно, срабатывает один раз на запрос и только
        // для простого текстового ответа без карточек/звуков/callback/inline —
        // всё сложное уходит штатным POST-путём.
        const webhookReply = this.#buildWebhookReply(controller, requestData);
        if (webhookReply) {
            return webhookReply;
        }
        await this.#sendChatContent(controller, telegramApi, requestData);
        return 'ok';
    }

    /**
     * Собирает тело webhook-reply для Telegram, если режим включён и ответ простой.
     *
     * Возвращает JSON-конверт `{method: 'sendMessage', ...}` для тела webhook-ответа
     * либо null (ответ уйдёт обычным POST к Bot API). Текст проходит ту же
     * обрезку по лимиту 4096 (со снятием parse_mode при сокращении), что и
     * `TelegramRequest.sendMessage`: webhook-ответ не получает ответа API,
     * и отклонённое из-за длины сообщение пропало бы молча.
     */
    #buildWebhookReply(
        controller: BotController,
        requestData: ITelegramRequestData,
    ): Record<string, unknown> | null {
        if (this._platformOptions?.telegram_webhook_reply !== true) {
            return null;
        }
        // Callback-запросы требуют answerCallbackQuery — Telegram сам их не
        // исполняет через webhook-тело (нужен отдельный ответ на сам callback).
        // Сверяем по обоим источникам ID, как это делает #sendChatContent:
        // иначе ID из platformOptions пропускал webhook-путь, спиннер кнопки
        // оставался висеть без answerCallbackQuery.
        if (requestData.callbackQueryId ?? controller.platformOptions.callbackQueryId) {
            return null;
        }
        const hasCards = controller.isCardInit() && controller.card.images.length > 0;
        const hasSounds = shouldProcessChatSound(controller, this.platformName);
        if (hasCards || hasSounds) {
            return null;
        }
        const text = getChatText(controller.text, controller.tts);
        if (!text) {
            return null;
        }
        const params = this.#buildMessageParams(controller);
        const { text: safeText, parseMode } = prepareTelegramMessageText(
            text,
            params.parse_mode,
            this.appContext ?? null,
        );
        if (parseMode === undefined) {
            delete params.parse_mode;
        } else {
            params.parse_mode = parseMode;
        }
        return {
            method: 'sendMessage',
            chat_id: requestData.chatId ?? controller.userId,
            text: safeText,
            ...(params as Record<string, unknown>),
        };
    }

    static isVoice(): boolean {
        return false;
    }

    /**
     * Формирует пример webhook-запроса Telegram для локального тестирования (BotTest).
     * @param query Текст команды пользователя
     * @param userId Идентификатор пользователя (chat.id)
     * @param count Номер сообщения (подставляется в update_id и message_id)
     * @returns Заготовка update-запроса в формате webhook Telegram
     */
    getQueryExample(query: string, userId: string, count: number): Record<string, unknown> {
        return {
            // update_id обязателен: isPlatformOnQuery распознаёт Telegram по этому полю
            update_id: count,
            message: {
                chat: {
                    id: +userId,
                },
                text: query,
                message_id: count,
            },
        };
    }
}
