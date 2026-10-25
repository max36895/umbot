/**
 * Обработка звуков VK: загрузка аудио через docs.getMessagesUploadServer и отправка вложением.
 */
import { ISoundInfo, Text, unlink, BotController } from '../../../index';
import { YandexSpeechKit, VkRequest, IVkDocSave } from '../API';
import {
    getBaseDataSoundProcessing,
    getPlatformRequestData,
    getSoundToken,
    cacheMediaToken,
    getSpeechText,
    consumeUploadRate,
} from '../Base/utils';
import { T_VK } from './constants';

/**
 * Возвращает peer_id диалога-адресата для загрузки голосового.
 */
function getPeerId(controller: BotController): string | number {
    const requestData = getPlatformRequestData<{ peerId?: string | number }>(controller, T_VK);
    // Адресат протактивной отправки — аргумент send(): peerId входящего запроса
    // принадлежит чату этого запроса, а не получателю рассылки.
    return controller.platformOptions.isProactive
        ? (controller.userId as string | number)
        : (requestData.peerId ?? (controller.userId as string | number));
}

/**
 * Формирует строку-вложение `doc<owner_id>_<id>` из ответа `docs.save`.
 *
 * `docs.save` возвращает объект-обёртку `{ type, doc | audio_message | graffiti }`,
 * а идентификаторы лежат во вложенном объекте. Верхний уровень — запасной
 * вариант для старых версий API.
 *
 * @param saved Ответ `docs.save` (или null при ошибке)
 * @returns Строка-вложение либо `null`, если идентификаторов в ответе нет
 */
export function getVkDocAttachment(saved: IVkDocSave | null): string | null {
    if (!saved) {
        return null;
    }
    const doc = (saved.doc ?? saved.audio_message ?? saved.graffiti ?? saved) as {
        id?: number;
        owner_id?: number;
    };
    if (doc.id === undefined || doc.owner_id === undefined) {
        return null;
    }
    return `doc${doc.owner_id}_${doc.id}`;
}

/**
 * Загружает аудиофайл в VK как голосовое сообщение (без кэширования токена).
 *
 * @param controller Контроллер приложения
 * @param path Путь до аудиофайла
 * @param isAttachContent Передано ли содержимое файла вместо пути
 * @returns Строка-вложение `doc<owner_id>_<id>` либо `null` при ошибке
 */
async function uploadVoiceMessage(
    controller: BotController,
    path: string,
    isAttachContent: boolean = false,
): Promise<string | null> {
    // Загрузка голосового — два лишних вызова api.vk.com (getMessagesUploadServer +
    // save): резервируем слоты лимита, как это делает загрузка фото карточек.
    consumeUploadRate(controller, T_VK, 2);
    const vkApi = new VkRequest(controller.appContext);
    vkApi.isAttachContent = isAttachContent;
    const uploadServerResponse = await vkApi.docsGetMessagesUploadServer(
        getPeerId(controller),
        'audio_message',
    );
    if (!uploadServerResponse?.upload_url) {
        return null;
    }
    const uploadResponse = await vkApi.upload(uploadServerResponse.upload_url, path);
    if (!uploadResponse?.file) {
        return null;
    }
    return getVkDocAttachment(await vkApi.docsSave(uploadResponse.file, 'Voice message'));
}

/**
 * Получение токена, необходимого для воспроизведения звуков в Vk
 * @param controller Контроллер приложения
 * @param path Путь до аудиофайла (URL не поддерживается — VK требует загрузку файла)
 * @param isAttachContent Определяет передано ли содержимое файла или сам файл
 * @returns Строка-вложение (doc<owner_id>_<id>) либо `null` при ошибке загрузки/сохранения
 */
export async function getSoundInDB(
    controller: BotController,
    path: string,
    isAttachContent: boolean = false,
): Promise<string | null> {
    if (Text.isUrl(path)) {
        controller.appContext.logWarn(
            'VK.getSoundInDB(): VK принимает голосовые сообщения только после загрузки файла; URL пропущен.',
        );
        return null;
    }
    return getSoundToken(path, T_VK, controller, async (model) => {
        const attachment = await uploadVoiceMessage(controller, path, isAttachContent);
        if (attachment) {
            model.soundToken = attachment;
            await cacheMediaToken(model, controller);
            return model.soundToken;
        }
        return null;
    });
}

/**
 * Получение корректного ответа для озвучивания запроса пользователю VK:
 * загружает аудио (в т.ч. TTS через SpeechKit) как голосовое сообщение.
 * @param soundInfo Информация необходимая для обработки аудио
 * @param controller Контроллер приложения
 * @returns Массив строк-вложений (doc<owner_id>_<id>) для отправки в attachments
 */
export async function soundProcessing(
    soundInfo: ISoundInfo,
    controller: BotController,
): Promise<string[]> {
    const { text } = soundInfo;
    const data: string[] = await getBaseDataSoundProcessing(soundInfo, controller, getSoundInDB);

    if (text) {
        const token = controller.appContext.appConfig.tokens[T_VK]?.speech_kit_token;
        if (!token) {
            controller.appContext.logWarn('VK: speech_kit_token не настроен, TTS недоступен');
            return data;
        }
        const speechKit = new YandexSpeechKit(token as string, controller.appContext);
        // Разметку звуков голосовых платформ SpeechKit зачитал бы вслух.
        const speechText = getSpeechText(text);
        const content = speechText ? await speechKit.getTts(speechText) : null;
        let sText = null;
        if (content) {
            // SpeechKit возвращает путь к временному файлу, а не его содержимое.
            // Токен TTS не кэшируем: путь уникален для каждого ответа и больше
            // не встретится, а запись в SoundTokens на каждую озвучку бесконечно
            // раздувала бы таблицу (и кэш FileAdapter в памяти).
            sText = await uploadVoiceMessage(controller, content.fileName);
            try {
                await unlink(content.fileName);
            } catch {
                // Игнорируем ошибку удаления временного файла
            }
        }
        if (sText) {
            data.push(sText);
        }
    }
    return data;
}
