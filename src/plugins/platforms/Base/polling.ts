/**
 * Общие части long polling встроенных адаптеров (Telegram, VK, MAX).
 * Модуль не входит в `pUtils`: свой адаптер реализует `getUpdates` своим HTTP-клиентом.
 */
import type { IRequestSend } from '../../../index';

/**
 * Запас к времени ожидания long polling на сеть, мс: запрос не должен обрываться
 * таймаутом клиента раньше, чем платформа ответит пустой пачкой.
 */
export const POLLING_REQUEST_MARGIN = 10_000;

/**
 * Достаёт описание ошибки из тела ответа API: `description` (Telegram),
 * `message` (MAX), `error_msg` / `error.error_msg` (VK).
 * @param body Тело ошибочного ответа
 * @returns Описание или исходный текст тела
 */
function getErrorDetail(body: string): string {
    try {
        const data = JSON.parse(body) as Record<string, unknown>;
        const error = data.error as Record<string, unknown> | undefined;
        const detail =
            data.description ?? data.message ?? data.error_msg ?? error?.error_msg ?? data.code;
        if (typeof detail === 'string' && detail) {
            return detail;
        }
    } catch {
        // Тело не JSON — выводим как есть (Request уже обрезал его).
    }
    return body;
}

/**
 * Причина неудачного запроса long polling для лога и исключения.
 * Собирается без URL: в адресе Telegram API есть токен бота.
 * @param res Результат `Request.send()`
 * @returns Текст причины
 */
export function describePollingError(res: IRequestSend<unknown>): string {
    if (res.httpStatus !== undefined) {
        return res.errorBody
            ? `HTTP ${res.httpStatus}: ${getErrorDetail(res.errorBody)}`
            : `HTTP ${res.httpStatus}`;
    }
    if (res.err instanceof Error) {
        return res.err.message;
    }
    return res.err ? String(res.err) : 'платформа не вернула данных';
}
