/**
 * Модуль для отправки HTTP-запросов.
 * Предоставляет функционал для работы с различными типами запросов и ответов
 */
import { fread, httpBuildQuery, IGetParams, isFile } from '../../utils';
import { AppContext, EMetric, THttpClient } from '../../core';
import { IRequestSend } from '../interfaces/IRequest';
import { basename } from 'path';

/**
 * Класс для отправки HTTP-запросов к API различных платформ. Используется внутри адаптеров для взаимодействия с внешними сервисами.
 * Поддерживает различные типы запросов, заголовки и отправку файлов
 *
 * @class Request
 */
export class Request {
    /**
     * Заголовок для отправки form-data.
     * Значение без boundary: при реальной отправке FormData этот заголовок
     * удаляется — Content-Type с boundary проставляет сам HTTP-клиент.
     */
    public static readonly HEADER_FORM_DATA: Record<string, string> = {
        'Content-Type': 'multipart/form-data',
    };

    /**
     * Заголовок для JSON контента
     */
    public static readonly HEADER_JSON: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    /**
     * URL для отправки запроса
     */
    public url: string | null;

    /**
     * GET-параметры запроса
     */
    public get: IGetParams | null;

    /**
     * POST-параметры запроса
     */
    public post: Record<string, unknown> | null | FormData;
    /**
     * POST-параметры запроса в виде строки
     */
    public postInString: string | null;

    /**
     * HTTP-заголовки запроса
     */
    public header: HeadersInit | null;

    /**
     * Локальный путь к файлу или содержимое файла (isAttachContent = true); для URL используйте post
     */
    public attach: string | null;

    /**
     * Тип передаваемого файла
     * true - передается содержимое файла
     * false - передается путь к файлу
     * @defaultValue false
     */
    public isAttachContent: boolean;

    /**
     * Имя параметра при отправке файла
     * @defaultValue file
     */
    public attachName: string;

    /**
     * Кастомный HTTP-метод (DELETE и т.д.)
     */
    public customRequest: string | null;

    /**
     * Максимальное время ожидания ответа (мс). По умолчанию 2000 мс. Переопределить можно через свойство.
     */
    public maxTimeQuery: number | null;

    /**
     * Преобразование ответа: JSON → binary → text (по приоритету).
     * true - ответ будет преобразован в JSON
     * false - сначала проверяется isBinaryResponse (ArrayBuffer),
     *         иначе ответ возвращается как текст
     * @defaultValue true
     */
    public isConvertJson: boolean;

    /**
     * Флаг, указывающий, что ожидается бинарный ответ
     */
    public isBinaryResponse: boolean = false;

    /**
     * Ошибка (Error, строка или null)
     */
    #error: Error | string | null;

    /**
     * HTTP-статус и тело ответа сервера, если он ответил не 2xx (null — ответа не было)
     */
    #httpStatus: number | null = null;
    #errorBody: string | null = null;

    /**
     * Контекст приложения
     */
    #appContext?: AppContext;

    /**
     * Создает новый экземпляр Request.
     * Инициализирует все поля значениями по умолчанию
     *
     * @param {AppContext} appContext - Контекст приложения (для логирования,
     * метрик и кастомного HTTP-клиента)
     */
    public constructor(appContext: AppContext) {
        this.url = null;
        this.get = null;
        this.post = null;
        this.postInString = null;
        this.header = null;
        this.attach = null;
        this.isAttachContent = false;
        this.attachName = 'file';
        this.customRequest = null;
        this.maxTimeQuery = 2000;
        this.isConvertJson = true;
        this.#error = null;
        this.isBinaryResponse = false;
        this.#appContext = appContext;
    }

    /**
     * Устанавливает контекст приложения
     * @param {AppContext} appContext - Контекст приложения
     */
    public setAppContext(appContext: AppContext): void {
        if (appContext) {
            this.#appContext = appContext;
        }
    }

    /**
     * Отправляет HTTP-запрос
     *
     * После вызова инстанс сбрасывает attach/post/postInString/get/customRequest/header
     * и связанные флаги — инстанс переиспользуется, и настройки одного вызова
     * не должны попадать в следующий. `maxTimeQuery` сохраняется — это настройка
     * клиента, а не одного вызова.
     *
     * @param url - URL для отправки запроса (если не указан, используется this.url)
     * @returns  Результат выполнения запроса
     *
     * @example
     * ```ts
     * const request = new Request(appContext);
     * const res = await request.send('https://api.example.com/data');
     * if (res.status) {
     *   console.log(res.data); // ответ API
     * } else {
     *   console.error(res.err); // Error либо строка
     * }
     * ```
     */
    public async send<T>(url: string | null = null): Promise<IRequestSend<T>> {
        if (url) {
            this.url = url;
        }

        this.#error = null;
        this.#httpStatus = null;
        this.#errorBody = null;
        const data = (await this.#run()) as T;
        // Сбрасываем всё, что относится к конкретному вызову: инстанс Request
        // переиспользуется API-клиентами, и «залипшие» get/customRequest уходили
        // бы в следующий запрос к другому методу платформы. Заголовки и флаги
        // формата ответа относятся к тому же вызову: все встроенные клиенты
        // (VK/MAX/Viber/Yandex) выставляют их перед каждым send(), поэтому
        // сброс не затрагивает их, а внешнему коду не «протекает», например,
        // Authorization-заголовок MAX в запрос к другому API или бинарный режим
        // SpeechKit в JSON-запрос. maxTimeQuery намеренно НЕ сбрасываем —
        // это настройка клиента, а не одного вызова.
        this.attachName = 'file';
        this.attach = null;
        this.isAttachContent = false;
        this.post = null;
        this.postInString = null;
        this.get = null;
        this.customRequest = null;
        this.header = null;
        this.isConvertJson = true;
        this.isBinaryResponse = false;
        if (this.#error) {
            return {
                status: false,
                data: null,
                err: this.#error,
                ...(this.#httpStatus === null ? {} : { httpStatus: this.#httpStatus }),
                ...(this.#errorBody === null ? {} : { errorBody: this.#errorBody }),
            };
        }
        return { status: true, data };
    }

    /**
     * Формирует URL с GET-параметрами
     *
     * @returns {string} Полный URL с параметрами
     */
    protected _getUrl(): string {
        let url: string = this.url || '';
        if (this.get) {
            url += '?' + httpBuildQuery(this.get);
        }
        return url;
    }

    /**
     * Возвращает функцию для отправки запроса
     */
    #getHttpClient(): THttpClient {
        // Легитимный доступ к HTTP-клиенту: используется либо переданный контекст, либо глобальный fetch.
        if (this.#appContext?.httpClient) {
            return this.#appContext?.httpClient;
        }
        return fetch;
    }

    /**
     * Выполняет HTTP-запрос
     *
     * @returns Ответ сервера или null в случае ошибки
     */
    async #run<T>(): Promise<T | string | null> {
        if (this.url) {
            try {
                const start = this.#appContext?.usedMetric ? performance.now() : 0;
                const options = await this._getOptions();
                // _getOptions() возвращает undefined, когда attach-файл не удалось
                // прочитать или найти (причина уже записана в #error). Без проверки
                // отсюда уходил fetch(url, undefined) — паразитный GET-запрос к API
                // платформы без тела и метода, затиравший причину отказа.
                if (!options || this.#error) {
                    return null;
                }
                const response = await this.#getHttpClient()(this._getUrl(), options);
                if (this.#appContext?.usedMetric) {
                    this.#appContext?.logMetric(EMetric.REQUEST, performance.now() - start, {
                        url: this.url,
                        method: this.customRequest || 'POST',
                        status: response.status || 0,
                    });
                }
                if (response.ok) {
                    if (this.isConvertJson) {
                        return await response.json();
                    }
                    if (this.isBinaryResponse) {
                        return (await response.arrayBuffer()) as T;
                    }
                    return await response.text();
                }
                // Платформы отдают причину отказа в теле ответа (Telegram — description,
                // VK — error_msg). Без него в логах остаётся только код статуса,
                // по которому невозможно понять, что именно не понравилось API.
                this.#httpStatus = response.status;
                this.#errorBody = await this.#readErrorBody(response);
                this.#error = `Не удалось получить данные с "${this.url}". Статус: ${response.status}. Ответ: ${this.#errorBody}`;
            } catch (e) {
                // fetch в Node может бросить не только Error (строки, DOMException
                // от AbortSignal.timeout). Потребители читают err.message — без
                // нормализации строковое исключение маскировалось бы под Error
                // и превращалось в undefined в логах.
                this.#error = e instanceof Error ? e : String(e);
            }
        } else {
            this.#error = 'Не указан url!';
        }
        return null;
    }

    /**
     * Безопасно читает тело ошибочного ответа для диагностики.
     * Тело обрезается, чтобы большой HTML страницы ошибки не раздул лог.
     *
     * @param response Ответ сервера со статусом, отличным от 2xx
     * @returns Текст ответа либо пояснение, почему прочитать не удалось
     */
    async #readErrorBody(response: Response): Promise<string> {
        try {
            const body = await response.text();
            if (!body) {
                return '<пустое тело>';
            }
            return body.length > 1000 ? `${body.substring(0, 1000)}…` : body;
        } catch {
            return '<тело ответа недоступно>';
        }
    }

    /**
     * Формирует итоговые заголовки запроса.
     *
     * Заголовки вызывающего кода имеют приоритет, но `Content-Type` подставляется
     * автоматически, если его не задали (кастомный `Authorization`/`X-Viber-Auth-Token`
     * не должен затирать `application/json` у JSON-тела).
     *
     * @param post Тело запроса
     * @returns Заголовки запроса или undefined, если тела и заголовков нет
     */
    #buildHeaders(post: BodyInit | null): HeadersInit | undefined {
        if (!post && !this.header) {
            return undefined;
        }
        // Собираем обычный объект, а не Headers: заголовки уходят в пользовательский
        // httpClient как есть, и подмена типа сломала бы кастомные реализации.
        const headers: Record<string, string> = {};
        if (this.header) {
            if (this.header instanceof Headers || Array.isArray(this.header)) {
                new Headers(this.header).forEach((value, name) => {
                    headers[name] = value;
                });
            } else {
                Object.assign(headers, this.header);
            }
        }
        const contentTypeKey = Object.keys(headers).find(
            (name) => name.toLowerCase() === 'content-type',
        );
        if (post instanceof FormData) {
            // Content-Type для multipart должен выставить сам fetch — вместе с boundary
            if (contentTypeKey) {
                delete headers[contentTypeKey];
            }
            return headers;
        }
        if (post && !contentTypeKey) {
            Object.assign(headers, Request.HEADER_JSON);
        }
        return headers;
    }

    /**
     * Собирает multipart-тело, когда `attach` содержит сами данные, а не путь к файлу.
     */
    #buildAttachContentFormData(): FormData {
        const formData = new FormData();
        formData.append(this.attachName, new Blob([this.attach as string]));
        if (this.post && typeof this.post === 'object') {
            for (const [key, value] of Object.entries(this.post)) {
                formData.append(
                    key,
                    typeof value === 'object' ? JSON.stringify(value) : String(value),
                );
            }
        }
        return formData;
    }

    /**
     * Формирует параметры для http запроса
     *
     * @returns {Promise<RequestInit|undefined>} Параметры запроса или undefined, если произошла ошибка
     */
    protected async _getOptions(): Promise<RequestInit | undefined> {
        const options: RequestInit = {};

        // Клиенты фреймворка обращаются к фиксированным доверенным хостам API
        // платформ, а секреты живут в заголовках (Authorization у MAX,
        // X-Viber-Auth-Token, OAuth у Яндекса) и в URL (токен Telegram в path).
        // Автоследование редиректу при компрометации DNS/CDN или редиректе со
        // стороны API унесло бы секреты на сторонний хост — 3xx будет ошибкой
        // запроса, что для фиксированных endpoint'ов корректно.
        options.redirect = 'manual';

        if (this.maxTimeQuery) {
            options.signal = AbortSignal.timeout(this.maxTimeQuery);
        }

        let post: BodyInit | null = null;
        if (this.attach) {
            if (this.isAttachContent) {
                post = this.#buildAttachContentFormData();
            } else if (await isFile(this.attach)) {
                const formData = await this.getAttachFile(this.attach, this.attachName);
                if (!formData) {
                    this.#error = `Не удалось прочитать файл: ${this.attach}`;
                    return;
                }
                // Добавляем дополнительные поля из this.post в FormData
                if (this.post && typeof this.post === 'object') {
                    for (const [key, value] of Object.entries(this.post)) {
                        formData.append(
                            key,
                            typeof value === 'object' ? JSON.stringify(value) : String(value),
                        );
                    }
                }
                post = formData;
            } else {
                this.#error = `Не удалось найти файл: ${this.attach}`;
                return;
            }
        } else if (this.post || this.postInString) {
            if (this.postInString) {
                post = this.postInString;
            } else if (!(this.post instanceof FormData)) {
                post = JSON.stringify(this.post);
            } else {
                post = this.post;
            }
        }

        if (post) {
            options.body = post;
            options.method = this.customRequest || 'POST';
        }
        const headers = this.#buildHeaders(post);
        if (headers) {
            options.headers = headers;
        }

        if (this.customRequest) {
            options.method = this.customRequest;
        }

        return options;
    }

    /**
     * Добавляет файл в FormData
     *
     * При ошибке чтения файл не добавляется — ошибка пишется в лог (appContext.logError),
     * FormData возвращается без файла.
     *
     * @param {FormData} formData - Объект FormData для добавления файла
     * @param {string} filePath - Путь к файлу
     * @param {string} [fileName='file'] - Имя файла для отправки (опционально; по умолчанию 'file')
     */
    public async addAttachFile(
        formData: FormData,
        filePath: string,
        fileName?: string,
    ): Promise<void> {
        const fileData = await fread(filePath);
        if (fileData.success) {
            const fileResult = fileData.data as unknown as BufferSource;
            const fileBlob = new Blob([fileResult]);
            formData.append(fileName || 'file', fileBlob, basename(filePath));
        } else {
            this.#appContext?.logError(`Ошибка чтения файла: "${filePath}"`, {
                error: fileData.error,
            });
        }
    }

    /**
     * Создает FormData для отправки файла
     *
     * @param {string} filePath - Путь к файлу
     * @param {string} [fileName] - Имя файла
     * @returns {FormData|null} FormData с файлом; при ошибке чтения возвращается FormData без файла (ошибка логируется), null — только при исключении
     */
    public async getAttachFile(filePath: string, fileName?: string): Promise<FormData | null> {
        try {
            const formData = new FormData();
            await this.addAttachFile(formData, filePath, fileName);
            return formData;
        } catch (e) {
            this.#appContext?.logError('Ошибка при чтении файла:', e as Record<string, unknown>);
        }
        return null;
    }

    /**
     * Возвращает последнюю ошибку запроса
     *
     * @returns {Error | string | null} Ошибка (объект Error либо текст) или null, если ошибок не было
     */
    public getError(): Error | string | null {
        return this.#error;
    }
}
