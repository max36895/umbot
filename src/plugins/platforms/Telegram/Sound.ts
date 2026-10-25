/**
 * Обработка звуков Telegram: TTS-часть синтезируется через Yandex SpeechKit и отправляется
 * голосовым сообщением (sendVoice, OGG/Opus); звуковые файлы — через sendAudio.
 */
import { ISoundInfo, SoundTokens, unlink, BotController } from '../../../index';
import { TelegramRequest, YandexSpeechKit } from '../API';
import { TTelegramChatId } from './interfaces/ITelegramPlatform';
import {
    getBaseDataSoundProcessing,
    getPlatformRequestData,
    getSoundToken,
    cacheMediaToken,
    getSpeechText,
} from '../Base/utils';
import { T_TELEGRAM } from './constants';

/**
 * Возвращает ID чата, в котором нужно отправить аудио.
 */
function getChatId(controller: BotController): TTelegramChatId {
    const requestData = getPlatformRequestData<{ chatId?: TTelegramChatId }>(
        controller,
        T_TELEGRAM,
    );
    // Адресат протактивной отправки — аргумент send(): chatId входящего запроса
    // принадлежит чату этого запроса, а не получателю рассылки.
    return (
        controller.platformOptions.isProactive
            ? controller.userId
            : (requestData.chatId ?? controller.userId)
    ) as TTelegramChatId;
}

/**
 * Получение токена, необходимого для воспроизведения звуков в Telegram
 * @param controller Контроллер приложения
 * @param path Путь до аудиофайла
 * @returns file_id отправленного аудио либо `null` при ошибке отправки/сохранения
 */
export async function getSoundInDB(
    controller: BotController,
    path: string,
): Promise<string | null> {
    let isCbCalled = false;
    const result = await getSoundToken(path, T_TELEGRAM, controller, async (model: SoundTokens) => {
        const api = new TelegramRequest(controller.appContext);
        const sound = await api.sendAudio(getChatId(controller), path);
        isCbCalled = true;

        if (sound?.ok && sound.result?.audio?.file_id !== undefined) {
            model.soundToken = sound.result.audio.file_id;
            await cacheMediaToken(model, controller);
            return model.soundToken;
        }
        return null;
    });

    if (!isCbCalled && result) {
        await new TelegramRequest(controller.appContext).sendAudio(getChatId(controller), result);
    }

    return result;
}

/**
 * Получение корректного ответа для озвучивания запроса пользователю Telegram:
 * отправляет аудио (в т.ч. TTS через SpeechKit) в чат и возвращает список токенов.
 * @param soundInfo Информация необходимая для обработки аудио
 * @param controller Контроллер приложения
 * @returns Массив звуковых токенов (file_id) для подстановки в TTS
 */
export async function soundProcessing(
    soundInfo: ISoundInfo,
    controller: BotController,
): Promise<string[]> {
    const { text } = soundInfo;
    const data: string[] = await getBaseDataSoundProcessing(soundInfo, controller, getSoundInDB);
    if (text) {
        const token = controller.appContext.appConfig.tokens[T_TELEGRAM]?.speech_kit_token;
        if (!token) {
            controller.appContext.logWarn('Telegram: speech_kit_token не настроен, TTS недоступен');
            return data;
        }
        const speechKit = new YandexSpeechKit(token as string, controller.appContext);
        // Разметку звуков голосовых платформ SpeechKit зачитал бы вслух.
        const speechText = getSpeechText(text);
        const content = speechText ? await speechKit.getTts(speechText) : null;
        if (content) {
            // SpeechKit синтезирует OGG/Opus — это формат голосового сообщения
            // (sendVoice). sendAudio по Bot API принимает только MP3/M4A.
            await new TelegramRequest(controller.appContext).sendVoice(
                getChatId(controller),
                content.fileName,
            );
            try {
                await unlink(content.fileName);
            } catch {
                // Игнорируем ошибку удаления временного файла
            }
        }
    }
    return data;
}
