import { Text, BotController, AppContext, IButtonType, INlu } from '../../../index';
import type { TEventType } from '../../../core/events';
import { keysCount } from '../../../utils';
import { BasePlatform, EMPTY_QUERY_ERROR } from '../Base/Base';
import { buttonProcessing } from './Button';
import { cardProcessing } from './Card';
import { soundProcessing } from './Sound';
import {
    IAlisaBigImage,
    IAlisaButton,
    IAlisaItemsList,
    IAlisaRequest,
    IAlisaRequestMeta,
    IAlisaRequestState,
    IAlisaResponse,
    IAlisaSession,
    IAlisaWebhookRequest,
    IAlisaWebhookResponse,
} from './interfaces/IAlisaPlatform';
import { T_ALISA, VERSION, ALISA_STATE_MAX_BYTES } from './constants';

const ALISA_TTS_MAX_LENGTH = 1024;
const ALISA_TTS_TAG_REGEXP = /<speaker\b[^>]*>|sil\s*<\[\d+\]>/gi;

/**
 * Обрезает произносимый текст Алисы, не считая служебные звуковые теги.
 * @param tts Строка TTS (при null возвращается пустая строка)
 * @returns Строка TTS не длиннее 1024 видимых символов; теги `<speaker>` и `sil <[...]>` не учитываются
 */
function resizeAlisaTts(tts: string | null): string {
    if (!tts) {
        return '';
    }
    let result = '';
    let visibleLength = 0;
    let cursor = 0;
    ALISA_TTS_TAG_REGEXP.lastIndex = 0;
    for (
        let match = ALISA_TTS_TAG_REGEXP.exec(tts);
        match;
        match = ALISA_TTS_TAG_REGEXP.exec(tts)
    ) {
        const plain = tts.slice(cursor, match.index);
        const remaining = ALISA_TTS_MAX_LENGTH - visibleLength;
        if (plain.length > remaining) {
            return result + plain.slice(0, remaining);
        }
        result += plain + match[0];
        visibleLength += plain.length;
        cursor = match.index + match[0].length;
    }
    return result + tts.slice(cursor, cursor + ALISA_TTS_MAX_LENGTH - visibleLength);
}
import { initUserCommand, hasAnyNluKey } from '../Base/utils';

interface IState {
    user_state_update: object;
    application_state: object;
    session_state: object;
}

/**
 * Адаптер, обеспечивающий полную поддержку платформы Яндекс.Диалоги (Алиса). Позволяет разрабатывать навыки для Алисы на TypeScript с использованием всего функционала платформы: от обработки голосовых запросов до работы с карточками и кнопками.
 *
 * Подключение адаптера не требует изменения существующей бизнес-логики: после интеграции все команды и обработчики, написанные для umbot, автоматически становятся доступны для Алисы.
 * Единый интерфейс позволяет одновременно использовать одну бизнес-логику для нескольких платформ (Telegram, VK, Алиса и др.) без дублирования кода.
 *
 * Этот адаптер автоматически обрабатывает входящие вебхуки от Алисы,
 * преобразует их в унифицированный формат фреймворка и формирует ответ,
 * совместимый с требованиями платформы. Подключается одной строкой и
 * не мешает работе других адаптеров (например, для Telegram или VK).
 *
 * Поддерживает:
 * - голосовые и текстовые запросы;
 * - сохранение состояния (user/application/session);
 * - карточки, кнопки, TTS-эффекты;
 * - health-check (`ping` → `pong`);
 *
 * Подключается как любой другой адаптер: `bot.use(new AlisaAdapter(token))`.
 * Несколько адаптеров могут работать одновременно — система сама выберет подходящий
 * на основе заголовков и структуры входящего запроса.
 * @example
 * ```ts
 * // Простейший навык для Алисы, который отвечает на приветствие
 * import { Bot } from 'umbot';
 * import { AlisaAdapter } from 'umbot/plugins';
 *
 * const bot = new Bot()
 *     .use(new AlisaAdapter('YOUR_OAUTH_TOKEN')) // Токен нужен только для загрузки изображений/звуков; альтернатива — env ALISA_TOKEN
 *     .addCommand('start', ['привет'], (_text, ctx) => {
 *         ctx.text = 'Привет! Я твой первый навык для Алисы';
 *     });
 *
 * bot.start('localhost', 3000);
 * ```
 *
 * @see {@link https://yandex.ru/dev/dialogs/alice/doc/protocol-docpage/ | Протокол Яндекс.Диалогов}
 * @see Bot
 * @see BotController
 * @see BasePlatform
 *
 * @group Адаптеры платформ
 */
export class AlisaAdapter extends BasePlatform<string | IAlisaWebhookRequest> {
    /**
     * Идентификатор платформы Яндекс.Алиса.
     */
    platformName = T_ALISA;
    /**
     * Универсальные события Алисы (для валидации addEvent): текст и account_linking.
     */
    supportedEvents: readonly TEventType[] = ['message', 'auth'];

    /**
     * Предупреждение о нескольких хранилищах state уже выведено. Алиса при
     * включённом хранении присылает session/application (и user) в каждом
     * запросе — это штатный протокол, поэтому сообщаем о выборе один раз,
     * а не спамим лог на каждом запросе горячего пути.
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
     * Проверяет, что входящий webhook-запрос принадлежит Алисе.
     * Отличает Алису от Маруси по `meta.client_id` и виду `session.application.application_id`.
     * @param query Входящий webhook-запрос
     * @param _headers Заголовки HTTP-запроса (не используются: у Алисы нет подписи webhook)
     * @returns `true`, если запрос относится к платформе Алиса
     */
    isPlatformOnQuery(query: IAlisaWebhookRequest, _headers?: Record<string, unknown>): boolean {
        if (!query) {
            this.appContext?.logWarn(`AlisaAdapter.isPlatformOnQuery(): ${EMPTY_QUERY_ERROR}`);
            return false;
        }
        if (query.request && query.version && query.session) {
            const clientId = query.meta?.client_id ?? '';
            if (clientId.includes('yandex.searchplugin')) {
                return true;
            } else if (clientId.includes('MailRu')) {
                return false;
            } else if (query.session.application?.application_id) {
                return (
                    query.session.application?.application_id !==
                    query.session.application?.application_id.toLowerCase()
                );
            } else {
                this.appContext?.logWarn(
                    'AlisaAdapter.isPlatformOnQuery(): Не удалось однозначно определить платформу (Алиса/Маруся). Используется fallback на Алису.',
                );
                return true;
            }
        }
        return false;
    }

    /**
     * Инициализирует команду пользователя от Алисы.
     * Обрабатывает различные типы запросов и сохраняет команду в контроллере
     * @param request Объект запроса от пользователя
     * @param controller Контроллер приложения
     */
    #initUserCommand(request: IAlisaRequest, controller: BotController): void {
        initUserCommand(request, controller);
    }

    /**
     * Устанавливает идентификатор пользователя.
     * Определяет ID пользователя из сессии или приложения
     * @param controller Контроллер приложения
     * @param session Сессия запроса Алисы (если задана — ID берётся из неё)
     */
    #setUserId(controller: BotController, session?: IAlisaSession): void {
        if (this.appContext && session) {
            controller.platformOptions.isState = false;
            if (this.appContext.platformParams.isAuthUser && session.user?.user_id !== undefined) {
                controller.userId = session.user.user_id;
                controller.platformOptions.isState = true;
                controller.userToken = session.user.access_token || null;
            } else {
                if (session.application?.application_id === undefined) {
                    controller.userId = session.user_id as string;
                } else {
                    controller.userId = session.application.application_id;
                }
            }
        }
    }

    /**
     * Устанавливает состояние приложения.
     * Определяет тип хранилища и сохраняет состояние в контроллере
     * @param controller Контроллер приложения
     * @param state Объект состояния из запроса
     */
    #setState(controller: BotController, state: IAlisaRequestState): void {
        const populatedStates = [state.user, state.application, state.session].filter(Boolean);
        if (populatedStates.length > 1 && !this.#warnedMultipleStates) {
            this.#warnedMultipleStates = true;
            this.appContext?.logWarn(
                'AlisaAdapter.setQueryData(): запрос содержит несколько хранилищ state; выбран наиболее приоритетный доступный уровень user → application → session.',
            );
        }
        if (state.user) {
            controller.state = state.user;
            controller.platformOptions.stateName = 'user_state_update';
        } else if (state.application) {
            controller.state = state.application;
            controller.platformOptions.stateName = 'application_state';
        } else if (state.session) {
            controller.state = state.session;
            controller.platformOptions.stateName = 'session_state';
        }
    }

    /**
     * Срок ответа Алисе: после него навык считается не ответившим.
     * @returns `MAX_TIME_REQUEST`, мс
     */
    getResponseTimeout(): number {
        return this.MAX_TIME_REQUEST;
    }

    /**
     * Разбирает запрос Алисы и наполняет контроллер данными: команда, NLU,
     * идентификатор пользователя, состояние, метаданные, health-check ping.
     * @param query Входящий webhook-запрос Алисы
     * @param controller Контроллер приложения
     * @returns `true`, если запрос успешно разобран
     */
    setQueryData(query: IAlisaWebhookRequest, controller: BotController): boolean {
        if (this.appContext) {
            if (query) {
                if (query.account_linking_complete_event && !query.session && !query.request) {
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
                        'AlisaAdapter.setQueryData(): Переданы некорректные данные для авторизации!';
                    return false;
                }

                controller.requestObject = query;
                this.#initUserCommand(query.request, controller);
                this.#setUserId(controller, query.session);
                // Пустой nlu не записываем (см. hasAnyNluKey в Base/utils).
                const nlu = query.request.nlu;
                if (nlu && hasAnyNluKey(nlu)) {
                    // IAlisaNlu структурно уже INlu (поля tokens/entities/intents
                    // совместимы), расхождение — только в strict-типизации опций.
                    controller.nlu.setNlu(nlu as INlu);
                }

                controller.userMeta = query.meta || {};
                controller.messageId = query.session.message_id;

                if (query.state !== undefined) {
                    this.#setState(controller, query.state);
                }

                controller.platformOptions.appId = query.session.skill_id;
                controller.isScreen =
                    (controller.userMeta as IAlisaRequestMeta).interfaces?.screen !== undefined;
                /*
                 * Раз в какое-то время Яндекс отправляет запрос ping, для проверки корректности работы навыка.
                 * @see (https://yandex.ru/dev/dialogs/alice/doc/health-check-docpage/) Смотри тут
                 */
                if (!query.request.command && query.request.original_utterance === 'ping') {
                    controller.text = 'pong';
                    controller.platformOptions.sendInInit = {
                        version: VERSION,
                        response: {
                            text: 'pong',
                            // end_session — обязательное поле ответа по протоколу;
                            // без него health-check мог считать навык неотвечающим.
                            end_session: false,
                        },
                    };
                }
                return true;
            } else {
                controller.platformOptions.error = `AlisaAdapter.setQueryData(): ${EMPTY_QUERY_ERROR}`;
            }
        }
        return false;
    }

    /**
     * Формирует ответ для пользователя.
     * Собирает текст, TTS, карточки и кнопки в единый объект ответа
     * @param controller Контроллер приложения
     * @returns {Promise<IAlisaResponse>} Объект ответа для Алисы
     */
    protected async _getResponse(controller: BotController): Promise<IAlisaResponse> {
        const resizedText = Text.resize(controller.text, 1024);
        // Голосовой кейс: tts ссылочно равен text (Bot подставляет controller.tts = controller.text
        // для голосовых платформ). Теги <speaker> отсутствуют по определению — это тот же
        // обработанный text без разметки, поэтому regex-скан resizeAlisaTts даст ту же строку.
        // Строгие === и длина-чек безопасны: строка-ссылка одна, а короткий text
        // никогда не мог содержать невлезающий тег.
        const tts =
            controller.tts === controller.text && controller.text.length <= ALISA_TTS_MAX_LENGTH
                ? resizedText
                : resizeAlisaTts(controller.tts);
        const response: IAlisaResponse = {
            text: resizedText,
            // `<speaker>` и `sil <[...]>` не входят в лимит 1024 у Алисы. Обычная
            // Text.resize считала их и могла разрезать тег посередине.
            tts: tts,
            end_session: controller.isEnd,
        };
        if (controller.isScreen) {
            if (controller.isCardInit() && controller.card.images.length) {
                // cardProcessing асинхронный (загрузка image_id в Яндекс), и сбой
                // слоя БД/API не должен ронять весь ответ в 500. Деградируем:
                // ответ уходит без карточки, ошибка — в лог.
                try {
                    response.card = <IAlisaItemsList | IAlisaBigImage>(
                        await controller.card.getCards(cardProcessing, controller)
                    );
                } catch (e) {
                    this.appContext?.logError(
                        `AlisaAdapter.getContent(): ошибка формирования карточки, ответ отправлен без неё. Текст ошибки: "${e instanceof Error ? e.message : String(e)}"`,
                        { error: e },
                    );
                }
                if (!response.card) {
                    // exactOptionalPropertyTypes: отсутствие карточки в ответе —
                    // это отсутствие поля, а не undefined-значение.
                    delete response.card;
                }
            }
            if (controller.isButtonsInit()) {
                const fn = (buttons: IButtonType[]): IAlisaButton[] | null => {
                    return buttonProcessing(buttons, false, this.appContext) as IAlisaButton[];
                };
                response.buttons = controller.buttons.getButtons(fn);
            } else {
                response.buttons = [];
            }
        }
        if (!response.text && !response.tts) {
            this.appContext?.logWarn(
                'AlisaAdapter._getResponse(): text и tts пусты. Ответ сохранён без подстановки; такой вариант находится вне документированного контракта Алисы.',
            );
        }
        return response;
    }

    /**
     * Формирует итоговый webhook-ответ Алисы: версию протокола, response,
     * директивы авторизации и выбранное state-хранилище (с проверкой лимита байт).
     * @param controller Контроллер приложения
     * @param stateData Состояние для сохранения (user/application/session)
     * @returns {Promise<IAlisaWebhookResponse>} Готовый ответ для webhook Алисы
     */
    async getContent(
        controller: BotController,
        stateData?: Record<string, unknown> | null,
    ): Promise<IAlisaWebhookResponse> {
        const result: IAlisaWebhookResponse = {
            version: VERSION,
        };
        const resTts = this._initTTS(controller);
        if (resTts) {
            await resTts;
        }
        result.response = await this._getResponse(controller);
        if (controller.isAuth && controller.userToken === null) {
            result.response.directives = { start_account_linking: {} };
        }
        if (stateData && !controller.platformOptions.stateName) {
            this.appContext?.logWarn(
                'AlisaAdapter.getContent(): stateData передан без выбранного state-хранилища и не будет отправлен.',
            );
        } else if (controller.platformOptions.stateName && stateData) {
            // Для session_state отсутствие поля = сброс стейта (документация Яндекса:
            // «Стейт сессии перестанет храниться, если в ответе навыка не вернуть
            // свойство session_state»). Поэтому пустой объект ВСЕГДА отправляем как {}:
            // форма ответа не меняется. Но лимит для него не проверяем — {} весит
            // 2 байта, а JSON.stringify + Buffer.byteLength на каждый ответ
            // заметны в горячем пути.
            if (keysCount(stateData) === 0) {
                result[controller.platformOptions.stateName as keyof IState] = {};
            } else {
                try {
                    const stateJson = JSON.stringify(stateData);
                    const stateBytes = Buffer.byteLength(stateJson, 'utf8');
                    if (stateBytes <= ALISA_STATE_MAX_BYTES) {
                        result[controller.platformOptions.stateName as keyof IState] = stateData;
                    } else {
                        this.appContext?.logError(
                            `AlisaAdapter.getContent(): Размер state "${controller.platformOptions.stateName}" ` +
                                `(${stateBytes} байт) превышает лимит API ` +
                                `(${ALISA_STATE_MAX_BYTES} байт). Поле не будет отправлено.`,
                        );
                    }
                } catch (error) {
                    this.appContext?.logError(
                        `AlisaAdapter.getContent(): state "${controller.platformOptions.stateName}" не сериализуется и не будет отправлен.`,
                        { error },
                    );
                }
            }
        }
        this._timeLimitLog(controller);
        return result;
    }

    /**
     * Использует кастомную обработку TTS через импортируемую функцию
     * {@link soundProcessing} из `./Sound` для вставки звуковых эффектов
     * в соответствии с требованиями Алисы.
     * @param controller Контроллер приложения
     */
    async soundProcessing(controller: BotController): Promise<void> {
        if (controller.isSoundInit()) {
            // eslint-disable-next-line require-atomic-updates
            controller.tts = await controller.sound.getSounds(
                controller.tts,
                soundProcessing,
                controller,
            );
        }
    }

    /**
     * Возвращает состояние из `request.state` (user/application/session).
     * Тип состояния определяется настройками навыка в Яндекс.Диалогах.
     * @param controller Контроллер приложения
     */
    getLocalStorage<TStorageResult = unknown>(controller: BotController): TStorageResult {
        return controller.state as TStorageResult;
    }

    /**
     * Проверяет, присутствует ли сохранённое состояние в запросе.
     *
     * @param controller - контроллер с бизнес-логикой приложения
     * @returns `true`, если состояние есть (не null)
     */
    isLocalStorage(controller: BotController): boolean {
        return controller.state !== null;
    }

    /**
     * Алиса не поддерживает push-сообщения, поэтому всегда возвращает `false`.
     */
    send(): boolean {
        return false;
    }

    /**
     * Формирует пример webhook-запроса Алисы для локального тестирования (BotTest).
     * @param query Текст команды пользователя
     * @param userId Идентификатор пользователя
     * @param count Номер сообщения в сессии (0 — новая сессия)
     * @param state Состояние (session/user/application) для подстановки в запрос
     * @returns Заготовка запроса в формате webhook Алисы
     */
    getQueryExample(
        query: string,
        userId: string,
        count: number,
        state: IAlisaRequestState | string,
    ): Record<string, unknown> {
        return {
            meta: {
                locale: 'ru-RU',
                timezone: 'UTC',
                client_id: 'yandex.searchplugin_local',
                interfaces: {
                    screen: {},
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
