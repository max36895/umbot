import { IYandexApi } from './interfaces';
import { AppContext, Request, IRequestSend } from '../../../index';
import { T_ALISA } from '../Alisa/constants';
import { getErrorMsg } from './constants';

/**
 * @class YandexRequest
 * Класс для работы с API Яндекса.
 *
 * Предоставляет методы для отправки запросов к API Яндекса,
 * управления авторизацией и обработки ошибок.
 *
 * @example
 * ```ts
 * // Создание экземпляра (appContext обязателен)
 * const api = new YandexRequest('your-token', appContext);
 *
 * // Установка нового токена
 * api.setOAuth('new-token');
 *
 * // Выполнение запроса
 * const result = await api.call<ApiResponse>('...');
 * if (result) {
 *   // Обработка успешного ответа
 *   console.log(result);
 * } else {
 *   // Обработка ошибки
 *   console.error('Ошибка запроса к API Яндекса');
 * }
 * ```
 *
 * @group API платформ
 */
export class YandexRequest {
    /**
     * Экземпляр класса для отправки HTTP-запросов
     */
    protected _request: Request;

    /**
     * OAuth-токен для авторизации запросов
     *
     * Используется для авторизации запросов к API Яндекса.
     * Подробная информация о получении токена:
     * @see https://yandex.ru/dev/dialogs/alice/doc/resource-upload-docpage/#http-images-load__auth
     */
    #oauth: string | null | undefined;

    /**
     * Последняя ошибка (объект ответа API, Error или текст)
     *
     * Содержит информацию о последней возникшей ошибке
     * при выполнении запроса к API.
     */
    #error: object | string | null | undefined;

    /**
     * Контекст приложения.
     */
    protected _appContext: AppContext;

    /**
     * Создает экземпляр класса YandexRequest
     *
     * Инициализирует класс с OAuth-токеном и настраивает
     * параметры HTTP-запросов.
     *
     * @param {string | null} [oauth=null] - OAuth-токен для авторизации
     * @param {AppContext} appContext - Контекст приложения (обязательный параметр)
     *
     * @remarks
     * Если токен не указан, будет использован токен из `appConfig.tokens.alisa.token`
     * (env-переменная `ALISA_TOKEN`, устаревший вариант — `YANDEX_TOKEN`).
     * Если и там токена нет, запросы будут выполняться без авторизации.
     *
     * @example
     * ```ts
     * // Создание с токеном
     * const api = new YandexRequest('your-token', appContext);
     *
     * // Создание без токена (будет использован ALISA_TOKEN из конфигурации)
     * const api = new YandexRequest(null, appContext);
     * ```
     */
    public constructor(oauth: string | null = null, appContext: AppContext) {
        this._request = new Request(appContext);
        this._appContext = appContext;
        this.setOAuth(oauth || appContext.appConfig.tokens[T_ALISA]?.token || null);
        // Загрузка ресурсов и синтез речи на медленном соединении не укладываются
        // в 1,5 секунды, поэтому оставляем ограниченный, но реалистичный таймаут.
        this._request.maxTimeQuery = 15_000;
        this.#error = null;
    }

    /**
     * Возвращает установленный OAuth-токен (или null, если авторизация отключена).
     */
    public get oauth(): string | null | undefined {
        return this.#oauth;
    }

    /**
     * Устанавливает OAuth-токен для авторизации
     *
     * Обновляет токен авторизации и заголовки запросов.
     * При установке токена автоматически добавляется заголовок
     * 'Authorization: OAuth {token}' ко всем последующим запросам.
     *
     * @param {string | null} oauth - OAuth-токен для авторизации
     *
     * @remarks
     * - Если передать null, авторизация будет отключена
     * - Заголовок авторизации добавляется автоматически
     * - Токен сохраняется для всех последующих запросов
     *
     * @example
     * ```ts
     * const api = new YandexRequest(null, appContext);
     *
     * // Установка нового токена
     * api.setOAuth('new-token');
     * // Теперь все запросы будут с заголовком:
     * // Authorization: OAuth new-token
     *
     * // Сброс токена
     * api.setOAuth(null);
     * // Запросы будут без авторизации
     * ```
     */
    public setOAuth(oauth: string | null): void {
        this.#oauth = oauth;
        const headers = { ...(this._request.header as Record<string, string> | null) };
        delete headers.Authorization;
        if (oauth) {
            headers.Authorization = this._getAuthorizationHeader(oauth);
        }
        this._request.header = Object.keys(headers).length ? headers : null;
    }

    /**
     * Формирует значение заголовка Authorization для токена.
     *
     * API Яндекс.Диалогов (загрузка изображений и звуков) принимает схему `OAuth`.
     * Сервисы Yandex Cloud используют другие схемы — наследники переопределяют метод
     * (см. YandexSpeechKit).
     *
     * @param token Токен авторизации
     * @returns Значение заголовка Authorization
     */
    protected _getAuthorizationHeader(token: string): string {
        return `OAuth ${token}`;
    }

    /**
     * Выполняет HTTP-запрос к API Яндекса
     *
     * Отправляет запрос к указанному эндпоинту API и
     * обрабатывает полученный ответ.
     *
     * @template T - Тип ожидаемого ответа, наследующий интерфейс IYandexApi
     * @param {string | null} [url=null] - URL-адрес эндпоинта API
     * @returns {Promise<T | null>} - Результат запроса или null в случае ошибки сети/Request
     *
     * @example
     * ```ts
     * interface MyApiResponse extends IYandexApi {
     *   data: {
     *     id: string;
     *     name: string;
     *   };
     * }
     *
     * const api = new YandexRequest('token', appContext);
     *
     * // Выполнение запроса (метод не выбрасывает исключений).
     * // При ошибке API ответ содержит поле error — проверяйте его явно;
     * // null возвращается только при ошибке сети/Request.
     * const response = await api.call<MyApiResponse>('...');
     *
     * if (response) {
     *   if ('error' in response) {
     *     // Обработка ошибки API
     *     console.error('Ошибка API:', response.error);
     *   } else {
     *     // Обработка успешного ответа
     *     console.log('ID:', response.data.id);
     *     console.log('Name:', response.data.name);
     *   }
     * } else {
     *   // Обработка ошибки сети/Request
     *   console.error('Ошибка запроса к API Яндекса');
     * }
     * ```
     */
    public async call<T extends IYandexApi>(url: string | null = null): Promise<T | null> {
        this.setOAuth(this.#oauth as string);
        const data: IRequestSend<T> = await this._request.send<T>(url);
        if (data.status && data.data) {
            if (Object.hasOwn(data.data, 'error')) {
                this.#error = data;
            }
            return data.data;
        }
        this.#error = data;
        this._log(data.err);
        return null;
    }

    /**
     * Пишет информацию об ошибках через AppContext.logError (структурированный логгер)
     *
     * Логирует детальную информацию об ошибке,
     * включая URL запроса и текст ошибки.
     *
     * @param {Error | string} [error=''] - Текст ошибки или объект ошибки
     */
    protected _log(error: Error | string = ''): void {
        this._appContext.logError(getErrorMsg(error, 'YandexRequest', this._request.url), {
            error: this.#error,
        });
    }
}
