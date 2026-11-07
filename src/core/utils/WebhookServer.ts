import { IncomingMessage, ServerResponse, createServer, Server } from 'node:http';
import type { AppContext } from '../AppContext';
import type { TBotResponseCb } from '../interfaces/IBot';
import type { ShutdownSignals } from './ShutdownSignals';

/**
 * Обработчик webhook-запроса (в `Bot` это `webhookHandle`).
 * Создаётся один раз при создании `WebhookServer` — не на каждый запрос.
 */
export type TWebhookHandler = (
    req: IncomingMessage,
    res: ServerResponse,
    responseCb?: TBotResponseCb,
) => Promise<void>;

/**
 * Встроенный HTTP-сервер для приёма webhook-запросов от платформ.
 *
 * Сервер на нативном `http.createServer`: маршрут `GET /health` для проверки
 * живости, всё остальное уходит в обработчик вебхука. Перед запуском предупреждает
 * о небезопасных настройках ({@link WebhookServer.warnOnInsecureStart}).
 *
 * Внутренний класс ядра: вызывается из `Bot.start`/`Bot.close`.
 * Создаётся лениво — serverless-бот без встроенного сервера за него не платит.
 * @internal
 */
export class WebhookServer {
    readonly #appContext: AppContext;
    readonly #handler: TWebhookHandler;
    readonly #signals: ShutdownSignals;

    /**
     * Экземпляр HTTP-сервера
     */
    #serverInst: Server | undefined;

    constructor(appContext: AppContext, handler: TWebhookHandler, signals: ShutdownSignals) {
        this.#appContext = appContext;
        this.#handler = handler;
        this.#signals = signals;
    }

    /**
     * Запускает HTTP-сервер на указанном хосте и порте. Повторный вызов закрывает
     * прежний сервер.
     * @param hostname Имя хоста
     * @param port Порт
     * @param responseCb Пользовательская обработка ответа платформе
     * @returns Экземпляр http.Server для управления сервером
     */
    start(hostname: string, port: number, responseCb?: TBotResponseCb): Server {
        if (this.#serverInst) {
            this.#serverInst.close();
            this.#serverInst = undefined;
        }

        this.#warnOnInsecureStart(hostname);

        this.#serverInst = createServer(
            async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
                if (req.method === 'GET' && req.url === '/health') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
                    return;
                }
                const handled = this.#handler(req, res, responseCb);
                // Отклонение промиса обработчика без .catch() — unhandled rejection
                // и падение процесса: гасим в лог, соединение закрывает Node.
                handled.catch((error: unknown) => {
                    this.#appContext.logError(
                        'Bot:start(): webhook-обработчик завершился необработанной ошибкой.',
                        { error },
                    );
                });
            },
        );

        this.#serverInst.on('error', (err: NodeJS.ErrnoException) => {
            this.#appContext.logError(
                `Bot:start(): Ошибка HTTP-сервера на ${hostname}:${port}: ${err.message}`,
                { error: err, code: err.code },
            );
        });

        this.#serverInst.listen(port, hostname, () => {
            this.#appContext.log(`Server running at http://${hostname}:${port}/`);
        });
        this.#signals.ensure();

        return this.#serverInst;
    }

    /**
     * Закрывает HTTP-сервер: `server.close()` вызывается синхронно, до первого
     * await у вызывающего, — сервер перестаёт принимать соединения сразу, даже
     * если вызывающий не ждёт возвращённый промис. Без запущенного сервера
     * возвращает `undefined`.
     * @returns Промис завершения закрытия (сервер отпустил сокеты)
     */
    close(): Promise<void> | undefined {
        if (!this.#serverInst) {
            return undefined;
        }
        const server = this.#serverInst;
        this.#serverInst = undefined;
        return new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
    }

    /**
     * Предупреждает о небезопасных настройках вебхука при старте сервера.
     *
     * Проверяет и сообщает (logWarn, не блокируя запуск):
     * 1. Режим `dev` — проверка регулярных выражений на ReDoS выполняется всегда;
     *    в dev/prod опасные выражения только логируются (error без re2 / warn с re2),
     *    но не отклоняются, а входной текст контролирует пользователь бота.
     *    В продакшене используйте `setAppMode('strict_prod')`, где опасные
     *    выражения отклоняются.
     * 2. Платформы с возможностью подписи, у которых секрет вебхука не задан
     *    (Telegram/VK/MAX): любой, кто знает URL вебхука, может слать
     *    произвольные запросы от имени платформы.
     * 3. Прослушивание всех интерфейсов (`0.0.0.0`) — вебхук доступен из
     *    всей сети; убедитесь, что перед ним стоит reverse proxy.
     *
     * Вызывается один раз из {@link start} до `listen` — предупреждения видны
     * в логе до приёма первого запроса.
     * @param hostname Хост, на котором слушает сервер
     */
    #warnOnInsecureStart(hostname: string): void {
        if (this.#appContext.appMode === 'dev') {
            this.#appContext.logWarn(
                'Bot:start(): Приложение запущено в режиме dev. Проверка регулярных выражений ' +
                    'на ReDoS выполняется, но опасные выражения только логируются (без отклонения), ' +
                    'а подробные логи и отладочная информация доступны всем, кто знает URL вебхука. ' +
                    'Для продакшена вызовите setAppMode("strict_prod") или запустите процесс с NODE_ENV=production — ' +
                    'там опасные выражения отклоняются.',
            );
        }
        const insecurePlatforms: string[] = [];
        for (const platformName in this.#appContext.platforms) {
            const adapter = this.#appContext.platforms[platformName];
            if (!adapter) {
                continue;
            }
            // Предупреждаем только о платформах с механизмом подписи: у Алисы, Маруси
            // и SmartApp его нет, и совет «задайте секрет» был бы невыполним.
            const hasSignature = adapter.isSignatureSupported
                ? adapter.isSignatureSupported()
                : Boolean(adapter.signatureName) ||
                  typeof adapter.isSignatureCheckEnabled === 'function';
            if (!hasSignature) {
                continue;
            }
            const enabled = adapter.isSignatureCheckEnabled
                ? adapter.isSignatureCheckEnabled()
                : Boolean(this.#appContext.appConfig.tokens[platformName]?.token);
            if (!enabled) {
                insecurePlatforms.push(platformName);
            }
        }
        if (insecurePlatforms.length) {
            this.#appContext.logWarn(
                `Bot:start(): Вебхук принимает запросы платформ [${insecurePlatforms.join(
                    ', ',
                )}] БЕЗ проверки подписи: секрет вебхука не задан в конфигурации. ` +
                    'Любой, кто знает URL вебхука, может отправлять поддельные запросы. ' +
                    'Для Telegram/MAX выполните `npx umbot webhook <telegram|max> <https-url>` ' +
                    '(секрет попадёт в .env как TELEGRAM_WEBHOOK_SECRET/MAX_WEBHOOK_SECRET) ' +
                    'или задайте tokens.<platform>.webhookSecret; для VK — VK_SECRET_KEY, ' +
                    'для Viber — токен в ViberAdapter(token).',
                undefined,
                { stderr: true },
            );
        }
        if (hostname === '0.0.0.0' || hostname === '::') {
            this.#appContext.logWarn(
                'Bot:start(): Сервер слушает все сетевые интерфейсы (0.0.0.0). ' +
                    'Убедитесь, что вебхук закрыт reverse proxy с ограничением доступа.',
                undefined,
                { stderr: true },
            );
        }
    }
}
