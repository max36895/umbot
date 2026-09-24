/**
 * API-фасад VK для `controller.api`.
 *
 * Даёт бизнес-логике доступ к «горячим» возможностям платформы без ручного
 * конструирования `VkRequest`. Фасад создаётся лениво при первом обращении к
 * `ctx.api` — на запросах без API-вызовов объект не аллоцируется.
 */

import { BotController } from '../../../controller';
import type { IControllerApi, TApiMethod } from '../../../controller';
import { VkRequest } from '../API/VkRequest';
import { getPlatformRequestData } from '../Base/utils';
import { getVkDocAttachment } from './Sound';
import { basename } from 'node:path';

/**
 * Технические данные VK-адаптера, которые использует фасад.
 */
type IVkApiData = Record<string, unknown> & {
    peerId?: number | string;
    eventId?: string;
    callbackAnswered?: boolean;
};

const VK_SUPPORTED: readonly TApiMethod[] = ['sendPhoto', 'sendDocument', 'answerCallback'];

/**
 * Создаёт API-фасад VK для контроллера.
 *
 * Фото и документы загружаются через штатную трёхшаговую схему VK
 * (getUploadServer → upload → save) и отправляются как attachment.
 *
 * Публично реэкспортируется из umbot/plugins.
 */
export function makeVkApi(controller: BotController): IControllerApi {
    const request = (): VkRequest => new VkRequest(controller.appContext);
    const peerId = (): string | number =>
        getPlatformRequestData<IVkApiData>(controller, 'vk').peerId ?? controller.userId ?? 0;
    const toRecord = (result: object | null): Record<string, unknown> | null =>
        result === null ? null : (result as unknown as Record<string, unknown>);
    return {
        async sendPhoto(
            image: string,
            params?: { caption?: string },
        ): Promise<Record<string, unknown> | null> {
            const uploadServer = await request().photosGetMessagesUploadServer(peerId());
            if (!uploadServer?.upload_url) {
                return null;
            }
            // Сервер загрузки фото VK принимает файл только в поле `photo`.
            const upload = await request().upload(uploadServer.upload_url, image, 'photo');
            if (!upload) {
                return null;
            }
            const saved = await request().photosSaveMessagesPhoto(
                upload.photo ?? '',
                String(upload.server ?? ''),
                upload.hash ?? '',
            );
            const first = Array.isArray(saved) ? saved[0] : null;
            if (!first?.id) {
                return null;
            }
            return toRecord(
                await request().messagesSend(peerId(), params?.caption ?? '', {
                    attachments: [`photo${first.owner_id}_${first.id}`],
                }),
            );
        },
        async sendDocument(
            file: string,
            params?: { caption?: string },
        ): Promise<Record<string, unknown> | null> {
            const uploadServer = await request().docsGetMessagesUploadServer(peerId(), 'doc');
            if (!uploadServer?.upload_url) {
                return null;
            }
            const upload = await request().upload(uploadServer.upload_url, file);
            if (!upload?.file) {
                return null;
            }
            const attachment = getVkDocAttachment(
                await request().docsSave(upload.file, basename(file) || 'document'),
            );
            if (!attachment) {
                return null;
            }
            return toRecord(
                await request().messagesSend(peerId(), params?.caption ?? '', {
                    attachments: [attachment],
                }),
            );
        },
        async sendAudio(): Promise<Record<string, unknown> | null> {
            controller.appContext?.logWarn(
                'controller.api.sendAudio(): VK голосовые сообщения требуют отдельного flow загрузки (docs.save с типом audio_message) и не поддерживаются фасадом. Используйте VkRequest напрямую.',
            );
            return null;
        },
        async sendVideo(): Promise<Record<string, unknown> | null> {
            controller.appContext?.logWarn(
                'controller.api.sendVideo(): VK video.save требует owner_id и не входит в фасад. Используйте VkRequest напрямую.',
            );
            return null;
        },
        async answerCallback(text: string): Promise<Record<string, unknown> | null> {
            const data = getPlatformRequestData<IVkApiData>(controller, 'vk');
            if (!data.eventId) {
                controller.appContext?.logWarn(
                    'controller.api.answerCallback(): у текущего запроса VK нет event_id — callback-кнопка не была нажата.',
                );
                return null;
            }
            // Адаптер после обработки подтверждает событие сам; повторный ответ
            // на тот же event_id не нужен — помечаем, что он уже дан.
            data.callbackAnswered = true;
            return toRecord(
                await request().sendMessageEvent(
                    controller.userId as number,
                    data.eventId,
                    { type: 'show_snackbar', text },
                    data.peerId as number,
                ),
            );
        },
        can(method: TApiMethod): boolean {
            return (VK_SUPPORTED as readonly string[]).includes(method);
        },
    };
}
