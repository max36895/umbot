import type { IncomingMessage, ServerResponse } from 'node:http';
import type { IBotResponse, IBotResponseState, TBotAuth, TBotResponseCb } from '../interfaces/IBot';

/** Максимальный размер тела входящего запроса (2 МБ). */
export const MAX_REQUEST_SIZE = 1024 * 1024 * 2;

/**
 * Токен из заголовка Authorization (префикс `Bearer ` отбрасывается).
 * @param header Значение заголовка
 * @returns Токен или `null`, если заголовка нет
 */
export function getBearerToken(header: unknown): TBotAuth {
    return header ? String(header).replace('Bearer ', '') : null;
}

/**
 * Отправка ответа платформы по умолчанию: JSON-объект или текст.
 * @param res HTTP-ответ
 * @param state Статус и тело ответа
 */
export function defaultSend(res: ServerResponse, state: IBotResponse): void {
    res.statusCode = state.statusCode;
    const isBodyString = typeof state.body === 'string';
    res.setHeader('Content-Type', isBodyString ? 'text/plain' : 'application/json');
    res.end(isBodyString ? state.body : JSON.stringify(state.body));
}

/**
 * Отправка ответа платформы через пользовательский колбек, если он задан.
 * @param req HTTP-запрос
 * @param res HTTP-ответ
 * @param state Статус и тело ответа
 * @param responseCb Пользовательская обработка ответа
 */
export function send(
    req: IncomingMessage,
    res: ServerResponse,
    state: IBotResponseState,
    responseCb?: TBotResponseCb,
): void {
    if (responseCb) {
        return responseCb(req, res, state);
    }
    return defaultSend(res, state);
}

/**
 * Читает тело входящего HTTP-запроса целиком, с ограничением размера
 * ({@link MAX_REQUEST_SIZE}) и тайм-аутом 30 секунд — защита от зависших запросов
 * (клиент отключился без end/error).
 * @param req Входящий HTTP-запрос
 * @returns Тело запроса строкой
 */
export function readRequestData(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let totalLength = 0;
        let finished = false;

        const cleanup = (): void => {
            if (!finished) {
                finished = true;
                clearTimeout(timeoutId);
                req.removeListener('data', onData);
                req.removeListener('end', onEnd);
                req.removeListener('error', onError);
            }
        };

        const onData = (chunk: Buffer): void => {
            chunks.push(chunk);
            totalLength += chunk.length;
            if (totalLength > MAX_REQUEST_SIZE) {
                cleanup();
                req.destroy(new Error('Request too large'));
                reject(new Error('Request too large'));
            }
        };

        const onEnd = (): void => {
            cleanup();
            // Тело из одного чанка (типичный вебхук) — без копирования в Buffer.concat.
            resolve(
                chunks.length === 1
                    ? (chunks[0] as Buffer).toString()
                    : Buffer.concat(chunks).toString(),
            );
        };

        const onError = (err: Error): void => {
            cleanup();
            reject(err);
        };

        const timeoutId = setTimeout(() => {
            if (!finished) {
                cleanup();
                req.destroy(new Error('Request timeout'));
                reject(new Error('Request timeout'));
            }
        }, 30000).unref();

        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onError);
    });
}
