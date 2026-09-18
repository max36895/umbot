import { Text, BotController, AppContext, IButtonType, stripTags } from '../../../index';
import type { TEventType } from '../../../core/events';
import { BasePlatform, EMPTY_QUERY_ERROR } from '../Base/Base';
import { buttonProcessing } from './Button';
import { cardProcessing } from './Card';
import { soundProcessing } from './Sound';
import { T_MARUSIA, VERSION, MARUSIA_STATE_MAX_BYTES } from './constants';
import {
    IMarusiaRequest,
    IMarusiaRequestState,
    IMarusiaSession,
    IMarusiaItemsList,
    IMarusiaBigImage,
    IMarusiaImageGallery,
    IMarusiaButton,
    IMarusiaResponse,
    IMarusiaWebhookRequest,
    IMarusiaWebhookResponse,
    IMarusiaRequestMeta,
} from './interfaces/IMarusiaPlatform';
import { initUserCommand, hasAnyNluKey } from '../Base/utils';

type TState = 'user_state_update' | 'session_state';

const MARUSIA_TTS_MAX_LENGTH = 1024;
const MARUSIA_TTS_TAG_REGEXP = /<speaker\b[^>]*>|sil\s*<\[\d+\]>/gi;

/**
 * Обрезает произносимый текст Маруси, не считая служебные звуковые теги.
 * Формат разметки совпадает с Алисой (`<speaker .../>`, `sil <[мс]>`), поэтому
 * лимит считается по видимому тексту, а теги сохраняются целиком и не рвутся
 * на границе обрезки.
 */
function resizeMarusiaTts(tts: string | null): string {
    if (!tts) {
        return '';
    }
    let result = '';
    let visibleLength = 0;
    let cursor = 0;
    MARUSIA_TTS_TAG_REGEXP.lastIndex = 0;
    for (
        let match = MARUSIA_TTS_TAG_REGEXP.exec(tts);
        match;
        match = MARUSIA_TTS_TAG_REGEXP.exec(tts)
    ) {
        const plain = tts.slice(cursor, match.index);
        const remaining = MARUSIA_TTS_MAX_LENGTH - visibleLength;
        if (plain.length > remaining) {
            return result + plain.slice(0, remaining);
        }
        result += plain + match[0];
        visibleLength += plain.length;
        cursor = match.index + match[0].length;
    }
    return result + tts.slice(cursor, cursor + MARUSIA_TTS_MAX_LENGTH - visibleLength);
}

/**
 * Адаптер, обеспечивающий полную поддержку платформы Маруси от ВК. Позволяет разрабатывать навыки для Маруси на TypeScript с использованием всего функционала платформы: от обработки голосовых запросов до работы с карточками и кнопками.
 *
 * Этот адаптер автоматически обрабатывает входящие вебхуки от Маруси,
 * преобразует их в унифицированный формат фреймворка и формирует ответ,
 * совместимый с требованиями платформы. Подключается одной строкой и
 * не мешает работе других адаптеров (например, для Telegram или VK).
 *
 * Поддерживает:
 * - голосовые и текстовые запросы;
 * - сохранение состояния (user/session);
 * - карточки и кнопки; TTS без эффектов `<speaker effect>` (только стандартные звуки);
 * - health-check (`ping` → `pong`);
 *
 * Подключается как любой другой адаптер: `bot.use(new MarusiaAdapter(token))`.
 * Несколько адаптеров могут работать одновременно — система сама выберет подходящий
 * на основе заголовков и структуры входящего запроса.
 *
 * Важно!
 * С февраля 2024 года VK убрала возможность создания новых навыков для Маруси, осталась только поддержка существующих.
 * @example
 * ```ts
 * // Простейший навык, который отвечает на приветствие
 * import { Bot } from 'umbot';
 * import { MarusiaAdapter } from 'umbot/plugins';
 *
 * const bot = new Bot()
 *     .use(new MarusiaAdapter('YOUR_MARUSIA_TOKEN'))
 *     .addCommand('start', ['привет'], (_text, ctx) => {
 *         ctx.text = 'Привет! Я твой первый навык для Маруси';
 *     });
 *
 * bot.start('localhost', 3000);
 * ```
 *
 * @see Bot
 * @see BotController
 * @see BasePlatform
 */
export class MarusiaAdapter extends BasePlatform<string | IMarusiaWebhookRequest> {
    /**
     * Идентификатор платформы Маруся.
     */
    platformName = T_MARUSIA;
    /**
     * Универсальные события Маруси: текстовые сообщения и привязка аккаунта (auth).
     */
    supportedEvents: readonly TEventType[] = ['message', 'auth'];

    /**
     * Предупреждение о нескольких хранилищах state уже выведено (один раз на адаптер).
     */
    #warnedMultipleStates = false;

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
     * Проверяет, что входящий webhook-запрос принадлежит Марусе.
     * Отличает Марусю от Алисы по заголовку подписи, `meta.client_id` и виду
     * `session.application.application_id`.
     * @param query Входящий webhook-запрос
     * @param headers Заголовки HTTP-запроса (проверяется подпись `x-marusia-signature`)
     * @returns `true`, если запрос относится к платформе Маруся
     */
    isPlatformOnQuery(query: IMarusiaWebhookRequest, headers?: Record<string, unknown>): boolean {
        if (headers?.['x-marusia-signature']) {
            return true;
        }
        if (!query) {
            this.appContext?.logWarn(`MarusiaAdapter:isPlatformOnQuery(): ${EMPTY_QUERY_ERROR}`);
            return false;
        }
        if (query.request && query.version && query.session) {
            const clientId = query.meta?.client_id ?? '';
            if (clientId.includes('MailRu')) {
                return true;
            } else if (clientId.includes('yandex.searchplugin')) {
                return false;
            } else if (query.session.application?.application_id) {
                return (
                    query.session.application?.application_id ===
                    query.session.application?.application_id.toLowerCase()
                );
            }
        }
        return false;
    }

    /**
     * Инициализирует команду пользователя от Маруси.
     * Обрабатывает различные типы запросов и сохраняет команду в контроллере
     * @param request Объект запроса от пользователя
     * @param controller Контроллер приложения
     */
    #initUserCommand(request: IMarusiaRequest, controller: BotController): void {
        initUserCommand(request, controller);
    }

    /**
     * Устанавливает состояние приложения.
     * Определяет тип хранилища и сохраняет состояние в контроллере
     * @param controller Контроллер приложения
     * @param state Объект состояния из запроса Маруси (`user` или `session`)
     */
    #setState(controller: BotController, state: IMarusiaRequestState): void {
        // Оба хранилища в запросе — штатная ситуация: сообщаем о выборе один раз.
        if (state.user && state.session && !this.#warnedMultipleStates) {
            this.#warnedMultipleStates = true;
            this.appContext?.logWarn(
                'MarusiaAdapter.setQueryData(): запрос содержит user и session state; выбран более приоритетный user state.',
            );
        }
        if (state.user) {
            controller.state = state.user;
            controller.platformOptions.stateName = 'user_state_update';
        } else if (state.session) {
            controller.state = state.session;
            controller.platformOptions.stateName = 'session_state';
        }
    }

    /**
     * Разбирает запрос Маруси и наполняет контроллер данными: команда, NLU,
     * идентификатор пользователя, состояние, метаданные, health-check ping.
     * @param query Входящий webhook-запрос Маруси
     * @param controller Контроллер приложения
     * @returns `true`, если запрос успешно разобран
     */
    setQueryData(query: IMarusiaWebhookRequest, controller: BotController): boolean {
        if (this.appContext) {
            if (query) {
                if (query.account_linking_complete_event && !query.session && !query.request) {
                    // Событие привязки аккаунта — универсальное 'auth' (как у Алисы),
                    // чтобы bot.addEvent('auth') работал единообразно на голосовых.
                    controller.eventType = 'auth';
                    controller.userEvents = {
                        auth: {
                            status: true,
                        },
                    };
                    return true;
                }
                if (!query.session || !query.request) {
                    controller.platformOptions.error =
                        'MarusiaAdapter.setQueryData(): Переданы некорректные данные!';
                    return false;
                }

                // Обработка health-check (ping → pong)
                if (!query.request.command && query.request.original_utterance === 'ping') {
                    controller.text = 'pong';
                    controller.platformOptions.sendInInit = {
                        version: VERSION,
                        response: {
                            text: 'pong',
                            end_session: false,
                        },
                        // session обязателен в ответе Маруси — как и в обычном
                        // ответе (getContent), эхо данных сессии запроса.
                        session: {
                            session_id: query.session.session_id ?? '',
                            message_id: query.session.message_id ?? 0,
                            user_id: String(query.session.user_id ?? ''),
                        },
                    };
                    return true;
                }

                controller.requestObject = query;
                this.#initUserCommand(query.request, controller);
                if (query.state !== undefined) {
                    this.#setState(controller, query.state);
                }

                controller.platformOptions.session = query.session;
                // user_id опционален в протоколе: undefined + '' дал бы литеральную
                // строку "undefined" — она попадала бы в ключ БД и в session ответа.
                controller.userId = query.session.user_id ?? '';
                // Пустой nlu не записываем — подробности в hasAnyNluKey (Base/utils).
                const nlu = query.request.nlu;
                if (nlu && hasAnyNluKey(nlu)) {
                    controller.nlu.setNlu(nlu);
                }

                controller.userMeta = query.meta || {};
                controller.messageId = query.session.message_id;

                controller.platformOptions.appId = query.session.skill_id;
                controller.isScreen =
                    (controller.userMeta as IMarusiaRequestMeta).interfaces?.screen !== undefined;
                return true;
            } else {
                controller.platformOptions.error = `MarusiaAdapter.setQueryData(): ${EMPTY_QUERY_ERROR}`;
            }
        }
        return false;
    }

    /**
     * Формирует ответ для пользователя.
     * Собирает текст, TTS, карточки и кнопки в единый объект ответа
     * @param controller Контроллер приложения
     * @returns {Promise<IMarusiaResponse>} Объект ответа для Маруси
     */
    protected async _getResponse(controller: BotController): Promise<IMarusiaResponse> {
        const response: IMarusiaResponse = {
            text: Text.resize(controller.text, 1024),
            tts: resizeMarusiaTts(controller.tts),
            end_session: controller.isEnd,
        };
        if (controller.isScreen) {
            if (controller.isCardInit() && controller.card.images.length) {
                // cardProcessing асинхронный (загрузка картинок в VK/Марусю), сбой
                // слоя БД/API не должен ронять весь ответ в 500. Деградируем:
                // ответ уходит без карточки, ошибка — в лог.
                try {
                    response.card = <IMarusiaItemsList | IMarusiaBigImage | IMarusiaImageGallery>(
                        await controller.card.getCards(cardProcessing, controller)
                    );
                } catch (e) {
                    this.appContext?.logError(
                        `MarusiaAdapter.getContent(): ошибка формирования карточки, ответ отправлен без неё. Текст ошибки: "${e instanceof Error ? e.message : String(e)}"`,
                        { error: e },
                    );
                }
                if (!response.card) {
                    // exactOptionalPropertyTypes: отсутствие карточки в ответе —
                    // это отсутствие поля, а не undefined-значение.
                    delete response.card;
                }
            }
            response.buttons = controller.isButtonsInit()
                ? (controller.buttons.getButtons(
                      (buttons: IButtonType[]) =>
                          buttonProcessing(
                              buttons,
                              false,
                              this.appContext as AppContext,
                          ) as IMarusiaButton[],
                  ) as IMarusiaButton[])
                : [];
        }
        // В отличие от Алисы, протокол Маруси требует непустой text («Не должен
        // быть пустым»). Если бизнес-логика заполнила только tts, показываем его
        // без звуковой разметки и знаков ударения.
        if (!response.text && response.tts) {
            response.text = Text.resize(
                stripTags(response.tts.replace(/sil\s*<\[\d+\]>/g, ''))
                    .replace(/[+`^]/g, '')
                    .replace(/\s+/g, ' ')
                    .trim(),
                1024,
            );
        }
        if (!response.text) {
            this.appContext?.logWarn(
                'MarusiaAdapter._getResponse(): text и tts пусты. Ответ сохранён без подстановки; такой вариант находится вне документированного контракта Маруси.',
            );
        }
        return response;
    }

    /**
     * Формирует итоговый webhook-ответ Маруси: версию протокола, response,
     * данные сессии и выбранное state-хранилище (с проверкой лимита байт).
     * @param controller Контроллер приложения
     * @param stateData Состояние для сохранения (user/session)
     * @returns {Promise<IMarusiaWebhookResponse>} Готовый ответ для webhook Маруси
     */
    async getContent(
        controller: BotController,
        stateData?: Record<string, unknown> | null,
    ): Promise<IMarusiaWebhookResponse> {
        const result: IMarusiaWebhookResponse = {
            version: VERSION,
        };

        await this._initTTS(controller);
        result.response = await this._getResponse(controller);
        const sessionObj = controller.platformOptions.session as IMarusiaSession | undefined;
        result.session = {
            session_id: sessionObj?.session_id ?? '',
            message_id: sessionObj?.message_id ?? 0,
            user_id: String(sessionObj?.user_id ?? controller.userId ?? ''),
        };
        if (stateData && !controller.platformOptions.stateName) {
            this.appContext?.logWarn(
                'MarusiaAdapter.getContent(): stateData передан без выбранного state-хранилища и не будет отправлен.',
            );
        } else if (controller.platformOptions.stateName && stateData) {
            try {
                const stateJson = JSON.stringify(stateData);
                const stateBytes = Buffer.byteLength(stateJson, 'utf8');
                if (stateBytes <= MARUSIA_STATE_MAX_BYTES) {
                    result[controller.platformOptions.stateName as TState] = stateData;
                } else {
                    this.appContext?.logError(
                        `MarusiaAdapter.getContent(): Размер state "${controller.platformOptions.stateName}" ` +
                            `(${stateBytes} байт) превышает лимит API ` +
                            `(${MARUSIA_STATE_MAX_BYTES} байт). Поле не будет отправлено.`,
                    );
                }
            } catch (error) {
                this.appContext?.logError(
                    `MarusiaAdapter.getContent(): state "${controller.platformOptions.stateName}" не сериализуется и не будет отправлен.`,
                    { error },
                );
            }
        }
        this._timeLimitLog(controller);
        return result;
    }

    /**
     * Обрабатывает TTS через импортируемую функцию {@link soundProcessing}
     * из `./Sound`: подставляет стандартные звуки (эффекты не поддерживаются).
     * @param controller Контроллер приложения
     */
    async soundProcessing(controller: BotController): Promise<void> {
        // eslint-disable-next-line require-atomic-updates
        controller.tts = await controller.sound.getSounds(
            controller.tts,
            soundProcessing,
            controller,
        );
    }

    /**
     * Возвращает состояние из `request.state` (user/session).
     * @param controller Контроллер приложения
     */
    getLocalStorage<TStorageResult = unknown>(controller: BotController): TStorageResult {
        return controller.state as TStorageResult;
    }

    /**
     * Проверяет, присутствует ли сохранённое состояние в запросе.
     * @param controller Контроллер приложения
     * @returns `true`, если состояние есть (не null)
     */
    isLocalStorage(controller: BotController): boolean {
        return controller.state !== null;
    }

    /**
     * Маруся не поддерживает push-сообщения, поэтому всегда возвращает `false`.
     */
    send(): boolean {
        return false;
    }

    /**
     * Формирует пример webhook-запроса Маруси для локального тестирования (BotTest).
     * @param query Текст команды пользователя
     * @param userId Идентификатор пользователя
     * @param count Номер сообщения в сессии (0 — новая сессия)
     * @param state Состояние (session/user) для подстановки в запрос
     * @returns Заготовка запроса в формате webhook Маруси
     */
    getQueryExample(
        query: string,
        userId: string,
        count: number,
        state: IMarusiaRequestState | string,
    ): Record<string, unknown> {
        return {
            meta: {
                locale: 'ru-RU',
                timezone: 'UTC',
                client_id: 'MailRu_local',
                interfaces: {
                    payments: null,
                    account_linking: null,
                },
            },
            session: {
                message_id: count,
                session_id: 'local',
                skill_id: 'local_test',
                user_id: userId,
                new: count === 0,
            },
            request: {
                command: query.toLowerCase(),
                original_utterance: query,
                type: 'SimpleUtterance',
            },
            state: {
                session: state,
            },
            version: '1.0',
        };
    }
}
