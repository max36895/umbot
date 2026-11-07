/**
 * Ошибка «запрос платформы не может быть обработан».
 * Webhook отвечает на неё 400: проблема в самом запросе, а не в сервере. Повтор
 * такой доставки не спасает, но Telegram и MAX повторяют любой ответ, кроме 2xx,
 * поэтому адаптеры мессенджеров не возвращают `false` для служебных событий,
 * а подтверждают их через `skipAutoReply`.
 * @internal
 */
export class BotBadRequestError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BotBadRequestError';
    }
}
