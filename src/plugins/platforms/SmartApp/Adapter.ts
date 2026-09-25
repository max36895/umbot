import { Text, BotController, Request, IRequestSend } from '../../../index';
import type { TEventType } from '../../../core/events';
import { BasePlatform, EMPTY_QUERY_ERROR } from '../Base/Base';
import { buttonProcessing, SMART_APP_DEFAULT_ACTION_ID } from './Button';
import { normalizeActionPayload } from '../Base/utils';
import { soundProcessing } from './Sound';
import { cardProcessing } from './Card';
import { T_SMART_APP, DEVICE, ANNOTATIONS, SMART_APP_STORAGE_URL } from './constants';
import {
    ISberSmartAppWebhookRequest,
    ISberSmartAppWebhookResponse,
    ISberSmartAppSession,
    ISberSmartAppResponsePayload,
    TSberSmartAppEmotionId,
    ISberSmartAppItem,
    ISberSmartAppSuggestionButton,
} from './interfaces/ISmartAppPlatform';

/**
 * Адаптер, обеспечивающий полную поддержку Сбер SmartApp (голосовой ассистент Салют). Позволяет разрабатывать навыки для SmartApp на TypeScript с использованием всего функционала платформы: от обработки голосовых запросов до работы с карточками и кнопками.
 *
 * Этот адаптер автоматически обрабатывает входящие вебхуки от SmartApp,
 * преобразует их в унифицированный формат фреймворка и формирует ответ,
 * совместимый с требованиями платформы. Подключается одной строкой и
 * не мешает работе других адаптеров (например, для Telegram или VK).
 *
 * Поддерживает:
 * - голосовые и текстовые запросы;
 * - карточки и кнопки; звуки/TTS-эффекты не встраиваются (маркеры звуков вычищаются);
 *
 * === Локальное хранилище ===
 * Адаптер использует внешнее SmartApp Code API для хранения данных пользователя.
 * По умолчанию URL хранилища: `https://smartapp-code.sberdevices.ru/tools/api/data`.
 * URL можно переопределить через конфиг:
 * ```ts
 * appConfig.tokens.smart_app.storage_url = 'https://your-custom-storage-url';
 * ```
 *
 * Подключается как любой другой адаптер: `bot.use(new SmartAppAdapter())`.
 * Несколько адаптеров могут работать одновременно — система сама выберет подходящий
 * на основе заголовков и структуры входящего запроса.
 *
 * Токен конструктора адаптеру не требуется: аутентификация навыка происходит через
 * экосистему Сбера, а данные хранилища читаются из `appConfig.tokens.smart_app`
 * (см. блок про локальное хранилище выше).
 * @example
 * ```ts
 * // Простейший навык, который отвечает на приветствие
 * import { Bot } from 'umbot';
 * import { SmartAppAdapter } from 'umbot/plugins';
 *
 * const bot = new Bot()
 *     .use(new SmartAppAdapter())
 *     .addCommand('start', ['привет'], (_text, ctx) => {
 *         ctx.text = 'Привет! Я твой первый навык для SmartApp';
 *     });
 *
 * bot.start('localhost', 3000);
 * ```
 *
 * @see Bot
 * @see BotController
 * @see BasePlatform
 */
export class SmartAppAdapter extends BasePlatform<string | ISberSmartAppWebhookRequest> {
    /**
     * Идентификатор платформы Сбер SmartApp.
     */
    platformName = T_SMART_APP;
    /**
     * Универсальные события SmartApp (для валидации addEvent).
     */
    supportedEvents: readonly TEventType[] = ['message', 'start', 'rating'];

    /**
     * Проверяет, что входящий webhook-запрос принадлежит SmartApp.
     * Опознаёт запрос по заголовкам `x-sber-smartapp-webhook-token`/`x-sber-token`
     * либо по связке полей messageName + uuid + payload.character + payload.app_info.
     * @param query Входящий webhook-запрос
     * @param headers Заголовки HTTP-запроса
     * @returns `true`, если запрос относится к платформе SmartApp
     */
    isPlatformOnQuery(
        query: ISberSmartAppWebhookRequest,
        headers?: Record<string, unknown>,
    ): boolean {
        if (headers?.['x-sber-smartapp-webhook-token'] || headers?.['x-sber-token']) {
            return true;
        }
        if (!query) {
            this.appContext?.logWarn(`SmartAppAdapter.isPlatformOnQuery(): ${EMPTY_QUERY_ERROR}`);
            return false;
        }

        return !!(
            query.messageName &&
            query.uuid &&
            query.payload?.character &&
            query.payload?.app_info
        );
    }

    /**
     * Инициализирует команду пользователя.
     * Обрабатывает различные типы сообщений и событий
     * @param content Объект webhook-запроса SmartApp
     * @param controller Экземпляр контроллера приложения
     *
     * Поддерживаемые типы сообщений:
     * - MESSAGE_TO_SKILL: сообщение пользователя
     * - CLOSE_APP: закрытие приложения
     * - SERVER_ACTION: действие сервера
     * - RUN_APP: запуск приложения (messageId сбрасывается в 0)
     * - RATING_RESULT: результат оценки (messageId сбрасывается в 0)
     */
    #initUserCommand(content: ISberSmartAppWebhookRequest, controller: BotController): void {
        controller.requestObject = content;
        controller.messageId = content.messageId;
        switch (content.messageName) {
            case 'MESSAGE_TO_SKILL': {
                const msg = content.payload?.message;
                controller.userCommand = msg?.normalized_text ?? '';
                controller.originalUserCommand = msg?.original_text ?? '';
                break;
            }

            case 'CLOSE_APP':
                controller.userCommand = '';
                controller.isEnd = true;
                break;

            case 'SERVER_ACTION':
            case 'RUN_APP':
                this.#initServerAction(content, controller);
                break;

            case 'RATING_RESULT':
                controller.eventType = 'rating';
                controller.payload = content.payload as unknown as Record<string, unknown>;
                controller.messageId = 0;
                {
                    // exactOptionalPropertyTypes: value заполняем только
                    // фактической оценкой пользователя.
                    const userEventsRating: { status: boolean; value?: number } = {
                        status: content.payload.status_code?.code === 1,
                    };
                    const estimation = content.payload.rating?.estimation;
                    if (estimation !== undefined) {
                        userEventsRating.value = estimation;
                    }
                    controller.userEvents = { rating: userEventsRating };
                }
                break;
        }

        if (!controller.userCommand) {
            controller.userCommand = controller.originalUserCommand;
        }
    }

    /**
     * Разбирает SERVER_ACTION (нажатие кнопки с payload) и RUN_APP (запуск).
     *
     * Текущая форма SmartApp API — `{action_id, parameters}`; устаревшая —
     * `{type, payload}`, читаются обе. Для SERVER_ACTION имя действия — свой
     * `action_id` либо `command`/`action`/`value` из параметров (как addAction
     * на Telegram/VK/MAX).
     *
     * @param content Объект webhook-запроса SmartApp
     * @param controller Экземпляр контроллера приложения
     */
    #initServerAction(content: ISberSmartAppWebhookRequest, controller: BotController): void {
        const serverAction = content.payload?.server_action as
            { action_id?: string; parameters?: unknown; payload?: unknown } | undefined;
        const params = (serverAction?.parameters ?? serverAction?.payload) as
            Record<string, unknown> | undefined;
        controller.payload = params;
        if (content.messageName === 'SERVER_ACTION') {
            const actionId = serverAction?.action_id;
            const name =
                actionId && actionId !== SMART_APP_DEFAULT_ACTION_ID
                    ? actionId
                    : (params?.command ?? params?.action ?? params?.value ?? params);
            controller.userCommand = normalizeActionPayload(name);
            controller.originalUserCommand =
                typeof params?.value === 'string' ? params.value : controller.userCommand;
            return;
        }
        // RUN_APP: запуск приложения — универсальное событие 'start'
        // (deep-link параметры уже в controller.payload).
        controller.eventType = 'start';
        controller.messageId = 0;
        controller.originalUserCommand = controller.userCommand;
        controller.userCommand = '';
    }

    /**
     * Срок ответа SmartApp: после него смартап считается не ответившим.
     * @returns `MAX_TIME_REQUEST`, мс
     */
    getResponseTimeout(): number {
        return this.MAX_TIME_REQUEST;
    }

    /**
     * Разбирает запрос SmartApp и наполняет контроллер данными: команда,
     * NLU, персонаж, сессия, метаданные и данные экрана устройства.
     * @param query Входящий webhook-запрос SmartApp
     * @param controller Контроллер приложения
     * @returns `true`, если запрос успешно разобран
     */
    setQueryData(query: ISberSmartAppWebhookRequest, controller: BotController): boolean {
        if (this.appContext) {
            if (query) {
                // Дальше поля payload/uuid читаются без проверок, поэтому обрываемся
                // здесь: иначе на «кривом» запросе адаптер падал с TypeError,
                // а не с понятным сообщением об ошибке.
                if (!query.payload || !query.uuid) {
                    controller.platformOptions.error =
                        'SmartAppAdapter.setQueryData(): в запросе отсутствуют обязательные поля payload или uuid.';
                    return false;
                }
                this.#initUserCommand(query, controller);

                controller.platformOptions.session = {
                    device: query.payload.device,
                    meta: query.payload.meta,
                    sessionId: query.sessionId,
                    messageId: query.messageId,
                    uuid: query.uuid,
                    projectName: query.payload.projectName,
                };

                controller.oldIntentName = query.payload.intent;
                controller.appeal = query.payload.character?.appeal ?? null;
                controller.userId = query.uuid.userId;
                const msg = query.payload.message;
                const nlu = {
                    entities: msg?.entities,
                    tokens: msg?.tokenized_elements_list,
                };
                controller.nlu.setNlu(nlu);

                controller.userMeta = query.payload.meta || {};

                controller.platformOptions.appId = query.payload.app_info.applicationId;
                if (query.payload.device?.capabilities?.screen) {
                    controller.isScreen = query.payload.device.capabilities.screen.available;
                } else {
                    controller.isScreen = true;
                }

                return true;
            } else {
                controller.platformOptions.error = `SmartAppAdapter.setQueryData(): ${EMPTY_QUERY_ERROR}`;
            }
        }
        return false;
    }

    /**
     * Определяет, содержит ли текст SSML-разметку.
     *
     * @param text Текст для озвучивания
     * @returns `true`, если в тексте есть SSML-теги (`<speak>`, `<speaker>`, `<break/>` и т.п.)
     */
    static #isSsml(text: string): boolean {
        // Тег обязан начинаться с буквы сразу после «<» (или «</») и иметь
        // закрывающую «>»: иначе обычный текст вида «если x < y» помечался как SSML,
        // и парсер Сбера ломался на незаэкранированных символах.
        // Эквивалент /<\/?[a-z][^>]*>/i за линейное время: регулярка квадратична
        // на тексте вида «<a<a<a…» без «>». Достаточно, чтобы начало тега стояло
        // левее последней «>» в тексте.
        const lastGt = text.lastIndexOf('>');
        let lt = text.indexOf('<');
        while (lt !== -1 && lt < lastGt) {
            let letterPos = lt + 1;
            if (text.charCodeAt(letterPos) === 47 /* / */) {
                letterPos++;
            }
            const code = text.charCodeAt(letterPos) | 32; // приведение к нижнему регистру
            if (code >= 97 && code <= 122 && letterPos < lastGt) {
                return true;
            }
            lt = text.indexOf('<', lt + 1);
        }
        return false;
    }

    /**
     * Формирует ответ для пользователя.
     * Собирает текст, TTS, карточки и кнопки в единый объект ответа
     * @returns {ISberSmartAppResponsePayload} Объект ответа для SmartApp
     */
    #getPayload(controller: BotController): ISberSmartAppResponsePayload {
        const session = controller.platformOptions.session as ISberSmartAppSession;
        const payload: ISberSmartAppResponsePayload = {
            pronounceText: controller.text,
            pronounceTextType: 'application/text',
            device: session.device,
            // Поле должно быть строкой. Когда команда не сопоставлена с интентом,
            // thisIntentName === null, и в ответ уходил intent: null.
            intent: controller.thisIntentName ?? '',
            projectName: session.projectName,
            auto_listening: !controller.isEnd,
            finished: controller.isEnd,
            // items — обязательное поле ANSWER_TO_USER (SmartApp API): даже без
            // текста и карточек отправляется пустой массив.
            items: [],
        };

        if (controller.emotion) {
            payload.emotion = {
                emotionId: <TSberSmartAppEmotionId>controller.emotion,
            };
        }
        if (controller.text) {
            payload.items = [
                {
                    bubble: {
                        text: Text.resize(controller.text, 250),
                        markdown: true,
                        expand_policy: 'auto_expand',
                    },
                },
            ];
        }
        if (controller.tts) {
            payload.pronounceText = controller.tts;
            // Ядро копирует text в tts для любой голосовой платформы, поэтому здесь
            // обычно лежит просто текст ответа. Помечать его как SSML нельзя: парсер
            // Сбера споткнётся на любом `&`, `<` или `>` в пользовательских данных.
            // Разметкой считаем только текст, где действительно есть SSML-теги.
            payload.pronounceTextType = SmartAppAdapter.#isSsml(controller.tts)
                ? 'application/ssml'
                : 'application/text';
        }

        if (controller.isScreen) {
            if (controller.isCardInit() && controller.card.images.length) {
                payload.items ??= [];
                const cards: ISberSmartAppItem | null =
                    controller.card.getCards<ISberSmartAppItem | null>(cardProcessing, controller);
                if (cards) {
                    payload.items.push(cards);
                }
            }
            payload.suggestions = {
                buttons: controller.isButtonsInit()
                    ? (controller.buttons.getButtons((buttons) =>
                          buttonProcessing(buttons, false, controller.appContext),
                      ) as ISberSmartAppSuggestionButton[])
                    : [],
            };
        }
        if (controller.isEnd) {
            payload.items ??= [];
            payload.items.push({
                command: {
                    type: 'close_app',
                },
            });
        }
        return payload;
    }

    /**
     * Формирует итоговый webhook-ответ SmartApp (ANSWER_TO_USER): текст,
     * TTS/SSML, карточки, кнопки и команду закрытия приложения.
     * Синхронный метод — возвращает готовый объект без промиса.
     * @param controller Контроллер приложения
     * @returns {ISberSmartAppWebhookResponse} Готовый ответ для webhook SmartApp
     */
    getContent(controller: BotController): ISberSmartAppWebhookResponse {
        const result: ISberSmartAppWebhookResponse = {
            messageName: 'ANSWER_TO_USER',
            sessionId: (controller.platformOptions.session as ISberSmartAppSession).sessionId,
            messageId: (controller.platformOptions.session as ISberSmartAppSession).messageId,
            uuid: (controller.platformOptions.session as ISberSmartAppSession).uuid,
        };

        if (controller.isSoundInit() && controller.sound.sounds.length) {
            controller.tts = soundProcessing({
                text: controller.tts ?? controller.text,
                usedStandardSound: controller.sound.isUsedStandardSound,
                sounds: controller.sound.sounds,
            });
        }
        result.payload = this.#getPayload(controller);
        this._timeLimitLog(controller);
        return result;
    }

    /**
     * Формирует ответ с оценкой навыка
     * @param controller Контроллер приложения
     * @returns {ISberSmartAppWebhookResponse} Объект ответа для вебхука
     */
    public getRatingContext(controller: BotController): ISberSmartAppWebhookResponse {
        return {
            messageName: 'CALL_RATING',
            sessionId: (controller.platformOptions.session as ISberSmartAppSession).sessionId,
            messageId: (controller.platformOptions.session as ISberSmartAppSession).messageId,
            uuid: (controller.platformOptions.session as ISberSmartAppSession).uuid,
            payload: {},
        };
    }

    /**
     * Собирает URL внешнего хранилища SmartApp для текущего пользователя.
     *
     * `userId` обязательно экранируется: у SmartApp нет проверки подписи вебхука,
     * поэтому `uuid.userId` полностью подконтролен отправителю запроса. Без экранирования
     * значение вида `../../admin?x=` выводило запрос за пределы пути хранилища
     * и позволяло подменить query-параметры.
     *
     * @param controller Контроллер текущего запроса
     * @returns Готовый URL хранилища
     */
    static #getStorageUrl(controller: BotController): string {
        const storageUrl =
            controller.appContext.appConfig.tokens[T_SMART_APP]?.storage_url ||
            SMART_APP_STORAGE_URL;
        return `${storageUrl}/${encodeURIComponent(String(controller.userId ?? ''))}`;
    }

    /**
     * Получает данные пользователя из хранилища
     * @returns {Promise<unknown>} Данные пользователя либо пустой объект при ошибке (ошибка логируется)
     * @protected
     */
    protected async _getUserData(controller: BotController): Promise<unknown> {
        const request = new Request(controller.appContext);
        request.url = SmartAppAdapter.#getStorageUrl(controller);
        const result = await request.send();
        if (result.status && result.data) {
            return result.data;
        }
        if (!String(result.err ?? '').includes('Статус: 404')) {
            controller.appContext.logError(
                'SmartAppAdapter._getUserData(): не удалось получить данные пользователя из хранилища.',
                { error: result.err },
            );
        }
        return {};
    }

    /**
     * Сохраняет данные пользователя в хранилище
     * @param data Данные для сохранения
     * @param controller Контроллер приложения
     * @returns Результат HTTP-запроса к внешнему хранилищу
     */
    protected async _setUserData(
        data: unknown,
        controller: BotController,
    ): Promise<IRequestSend<unknown>> {
        const request = new Request(controller.appContext);
        request.header = Request.HEADER_JSON;
        request.url = SmartAppAdapter.#getStorageUrl(controller);
        request.post = data as Record<string, unknown>;
        // Хранилище отвечает на сохранение 200 с пустым телом (без JSON),
        // поэтому ответ читаем текстом — иначе успешная запись считалась бы ошибкой.
        request.isConvertJson = false;
        return await request.send();
    }

    /**
     * Сохраняет данные пользователя во внешнее хранилище SmartApp.
     * @param data Данные для сохранения
     * @param controller Контроллер приложения
     */
    public async setLocalStorage(data: unknown, controller: BotController): Promise<void> {
        const result = await this._setUserData(data, controller);
        if (!result.status) {
            controller.appContext.logError(
                'SmartAppAdapter.setLocalStorage(): не удалось сохранить данные пользователя.',
                { error: result.err },
            );
        }
    }

    /**
     * Получает данные из локального хранилища.
     * @param controller Контроллер приложения
     * @returns Данные пользователя либо пустой объект {}; ошибки логируются через logError
     */
    public getLocalStorage<TStorageResult = unknown>(
        controller: BotController,
    ): Promise<TStorageResult> {
        return this._getUserData(controller) as Promise<TStorageResult>;
    }

    /**
     * SmartApp всегда имеет внешнее хранилище, поэтому возвращает `true`.
     */
    isLocalStorage(): boolean {
        return true;
    }

    /**
     * SmartApp не поддерживает push-сообщения, поэтому всегда возвращает `false`.
     */
    send(): boolean {
        return false;
    }

    /**
     * Формирует пример webhook-запроса SmartApp (MESSAGE_TO_SKILL)
     * для локального тестирования (BotTest).
     * @param query Текст команды пользователя
     * @param userId Идентификатор пользователя (uuid.userId)
     * @param count Номер сообщения (messageId; 0 — новая сессия)
     * @returns Заготовка запроса в формате webhook SmartApp
     */
    getQueryExample(query: string, userId: string, count: number): Record<string, unknown> {
        return {
            messageName: 'MESSAGE_TO_SKILL',
            uuid: { userId: `${+userId}`, userChannel: '', sub: '' },
            messageId: count,
            sessionId: `${userId}`,
            payload: {
                device: DEVICE,
                app_info: {
                    projectId: '',
                    applicationId: '',
                    appversionId: '',
                },
                character: {
                    id: 'sber',
                    name: 'Сбер',
                    gender: 'male',
                    appeal: 'official',
                },
                intent: '',
                original_intent: '',
                intent_meta: {},
                meta: {
                    time: {
                        timezone_id: '',
                        timezone_offset_sec: 0,
                        timestamp: Date.now(),
                    },
                },
                projectName: 'test',
                annotations: ANNOTATIONS,
                strategies: {
                    happy_birthday: false,
                    last_call: 0,
                },
                new_session: count === 0,
                message: {
                    normalized_text: query,
                    original_text: query,
                    asr_normalized_message: '',
                    tokenized_elements_list: [],
                },
            },
        };
    }
}
