/**
 * Обработка звуков MAX: TTS через Yandex SpeechKit и отправка аудиофайлов через /uploads.
 */
import { ISoundInfo, isFile, Text, unlink, BotController } from '../../../index';
import { getSoundToken, cacheMediaToken, getSpeechText, consumeUploadRate } from '../Base/utils';
import { IMaxAudio, MaxRequest, YandexSpeechKit } from '../API';
import { T_MAX_APP } from './constants';

/**
 * Получение токена, необходимого для воспроизведения звуков в MAX
 * @param controller Контроллер приложения
 * @param path Путь до аудиофайла
 * @returns Токен/URL загруженного аудио либо `null` при ошибке загрузки/сохранения
 */
async function getSoundInDB(controller: BotController, path: string): Promise<string | null> {
    return getSoundToken(path, T_MAX_APP, controller, async (model) => {
        const token = await uploadAudio(controller, path);
        if (token) {
            model.soundToken = token;
            await cacheMediaToken(model, controller);
            return model.soundToken;
        }
        return null;
    });
}

/**
 * Загружает аудиофайл в MAX без кэширования токена.
 * Кэшируется только токен вложения: upload.url — одноразовый адрес загрузки,
 * а не ссылка на аудио.
 * @param controller Контроллер приложения
 * @param path Путь до аудиофайла
 * @returns Токен аудио-вложения либо `null` при ошибке загрузки
 */
async function uploadAudio(controller: BotController, path: string): Promise<string | null> {
    // Загрузка аудио — лишний вызов API (POST /uploads), резервируем слот.
    consumeUploadRate(controller, T_MAX_APP, 1);
    const upload = await new MaxRequest(controller.appContext).upload(path, 'audio');
    return upload?.token ?? null;
}

/**
 * Получение корректного ответа для озвучивания запроса пользователю MAX:
 * загружает аудио (в т.ч. TTS через SpeechKit) как upload-token вложения.
 * @param soundInfo Информация необходимая для обработки аудио
 * @param controller Контроллер приложения
 * @returns Массив аудио-вложений IMaxAudio либо `null`, если не удалось получить ни одного звука (пустой результат)
 */
export async function soundProcessing(
    soundInfo: ISoundInfo,
    controller: BotController,
): Promise<IMaxAudio[] | null> {
    const { sounds, text } = soundInfo;
    const data: IMaxAudio[] = [];
    if (sounds) {
        for (let i = 0; i < sounds.length; i++) {
            const sound = sounds[i];
            if (sound?.sounds !== undefined && sound?.key !== undefined) {
                let sText: string | null = Text.getText(sound.sounds);
                if (Text.isUrl(sText)) {
                    controller.appContext.logWarn(
                        'Max.soundProcessing(): MAX принимает аудио только по upload-token; URL пропущен.',
                    );
                    continue;
                }
                if (await isFile(sText)) {
                    sText = await getSoundInDB(controller, sText);
                }

                if (sText) {
                    data.push({ type: 'audio', payload: { token: sText } });
                }
            }
        }
    }
    if (text) {
        const token = controller.appContext.appConfig.tokens[T_MAX_APP]?.speech_kit_token;
        if (!token) {
            controller.appContext.logWarn('Max: speech_kit_token не настроен, TTS недоступен');
            return data.length ? data : null;
        }
        const speechKit = new YandexSpeechKit(token as string, controller.appContext);
        // Разметку звуков голосовых платформ SpeechKit зачитал бы вслух.
        const speechText = getSpeechText(text);
        const content = speechText ? await speechKit.getTts(speechText) : null;
        let sText = null;
        if (content) {
            // Токен TTS не кэшируем: путь временного файла уникален для каждого
            // ответа, и запись в SoundTokens на каждую озвучку бесконечно
            // раздувала бы таблицу.
            sText = await uploadAudio(controller, content.fileName);
            try {
                await unlink(content.fileName);
            } catch {
                // Игнорируем ошибку удаления временного файла
            }
        }
        if (sText) {
            data.push({ type: 'audio', payload: { token: sText } });
        }
    }
    if (data.length) {
        return data;
    }
    return null;
}
