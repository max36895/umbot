/**
 * API-фасад MAX для `controller.api`.
 *
 * Даёт бизнес-логике доступ к «горячим» возможностям платформы без ручного
 * конструирования `MaxRequest`. Фасад создаётся лениво при первом обращении к
 * `ctx.api` — на запросах без API-вызовов объект не аллоцируется.
 */

import { BotController } from '../../../controller';
import type { IControllerApi, TApiMethod } from '../../../controller';
import { MaxRequest } from '../API/MaxRequest';
import { IMaxAudio, IMaxCard, IMaxFile, IMaxParams, IMaxVideo } from '../API/interfaces';
import { getPlatformRequestData } from '../Base/utils';

/**
 * Технические данные MAX-адаптера, которые использует фасад.
 */
type IMaxApiData = Record<string, unknown> & {
    callbackId?: string;
    chatId?: number;
};

const MAX_SUPPORTED: readonly TApiMethod[] = [
    'sendPhoto',
    'sendDocument',
    'sendAudio',
    'sendVideo',
    'answerCallback',
];

/**
 * Создаёт API-фасад MAX для контроллера.
 *
 * Медиа загружаются через `POST /uploads` (token) и отправляются вложением.
 *
 * Публично реэкспортируется из umbot/plugins.
 */
export function makeMaxApi(controller: BotController): IControllerApi {
    const request = (): MaxRequest => new MaxRequest(controller.appContext);
    const data = (): IMaxApiData => getPlatformRequestData<IMaxApiData>(controller, 'max_app');
    const recipient = (): string | number => data().chatId ?? controller.userId ?? 0;
    const recipientType = (): 'chat' | 'user' => (data().chatId !== undefined ? 'chat' : 'user');
    // Универсальный отправитель вложения: upload → messagesSend с токеном.
    const sendUploaded = async (
        file: string,
        type: 'image' | 'audio' | 'file' | 'video',
        caption?: string,
    ): Promise<Record<string, unknown> | null> => {
        const upload = await request().upload(file, type);
        if (!upload?.token) {
            return null;
        }
        // Тип вложения обязан совпадать с типом загрузки: токен видео — это
        // видео-токен, токен файла — файловый. MIX mismatch MAX отклоняет.
        const attachmentsByType: Record<
            'image' | 'audio' | 'file' | 'video',
            IMaxCard | IMaxAudio | IMaxVideo | IMaxFile
        > = {
            image: { type: 'image', payload: { token: upload.token } },
            audio: { type: 'audio', payload: { token: upload.token } },
            video: { type: 'video', payload: { token: upload.token } },
            file: { type: 'file', payload: { token: upload.token } },
        };
        const params: IMaxParams = { attachments: [attachmentsByType[type]] };
        return request().messagesSend(recipient(), caption ?? '', params, recipientType());
    };
    return {
        async sendPhoto(
            image: string,
            params?: { caption?: string },
        ): Promise<Record<string, unknown> | null> {
            return sendUploaded(image, 'image', params?.caption);
        },
        async sendDocument(
            file: string,
            params?: { caption?: string },
        ): Promise<Record<string, unknown> | null> {
            return sendUploaded(file, 'file', params?.caption);
        },
        async sendAudio(
            file: string,
            params?: { caption?: string },
        ): Promise<Record<string, unknown> | null> {
            return sendUploaded(file, 'audio', params?.caption);
        },
        async sendVideo(
            file: string,
            params?: { caption?: string },
        ): Promise<Record<string, unknown> | null> {
            return sendUploaded(file, 'video', params?.caption);
        },
        async answerCallback(text: string): Promise<Record<string, unknown> | null> {
            const data = getPlatformRequestData<IMaxApiData>(controller, 'max_app');
            if (!data.callbackId) {
                controller.appContext?.logWarn(
                    'controller.api.answerCallback(): у текущего запроса MAX нет callback_id — кнопка не была нажата.',
                );
                return null;
            }
            // dialogId включает очередь «не чаще 2 callback-ответов/сек на диалог»
            // в MaxRequest.answerCallback — без неё MAX отвечает 429 на быстрые
            // повторные нажатия (контракт платформы, см. AGENTS.md §9).
            // Ключ диалога — как в адаптере (chatId ?? userId): в личке chatId
            // не заполняется, и без userId очередь не включалась вовсе.
            return request().answerCallback(
                data.callbackId,
                text,
                null,
                data.chatId ?? controller.userId ?? undefined,
            );
        },
        can(method: TApiMethod): boolean {
            return (MAX_SUPPORTED as readonly string[]).includes(method);
        },
    };
}
