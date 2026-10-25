/**
 * Построение карточек Telegram: sendPhoto для одиночного фото и sendMediaGroup для 2–10 изображений.
 */
import { ICardInfo, ImageTokens, Text, BotController } from '../../../index';

import { TelegramRequest } from '../API';
import { ITelegramMedia, ITelegramResult, TTelegramChatId } from './interfaces/ITelegramPlatform';
import { getImageToken, getPlatformRequestData, cacheMediaToken } from '../Base/utils';
import { T_TELEGRAM } from './constants';

const MAX_TELEGRAM_MEDIA_GROUP_ITEMS = 10;

/**
 * Возвращает ID чата, в котором нужно отправить медиа.
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
 * Отправляет одиночное фото; при ошибке API отмечает недоставку в контроллере,
 * чтобы `bot.send()` вернул `false` (как `BasePlatform.checkSendResult` для текста).
 * @param controller Контроллер приложения
 * @param photo Локальный путь, URL или file_id
 * @param caption Подпись к фото
 * @returns Ответ Telegram API либо `null` при ошибке
 */
async function sendPhotoChecked(
    controller: BotController,
    photo: string,
    caption: string | undefined,
): Promise<ITelegramResult | null> {
    const result = await new TelegramRequest(controller.appContext).sendPhoto(
        getChatId(controller),
        photo,
        caption,
    );
    if (!result) {
        // eslint-disable-next-line require-atomic-updates -- флаг монотонный: выставляется только в true
        controller.platformOptions.sendFailed = true;
    }
    return result;
}

/**
 * Получение токена, необходимого для отображения картинок в карточке Телеграм
 * @param controller Контроллер приложения
 * @param path Путь до картинки
 * @param caption Заголовок для картинки
 * @returns file_id отправленного фото либо `null` при ошибке отправки/сохранения
 */
export async function getImageInDB(
    controller: BotController,
    path: string,
    caption: string,
): Promise<string | null> {
    let isCbCalled = false;
    const result = await getImageToken(path, T_TELEGRAM, controller, async (model: ImageTokens) => {
        const photo = await sendPhotoChecked(controller, path, caption || undefined);
        isCbCalled = true;

        if (photo?.ok && photo.result?.photo?.length) {
            const lastPhoto = photo.result.photo.at(-1);
            if (lastPhoto) {
                model.imageToken = lastPhoto.file_id;
                await cacheMediaToken(model, controller);
                return model.imageToken;
            }
        }
        return null;
    });

    if (!isCbCalled && result) {
        await sendPhotoChecked(controller, result, caption || undefined);
    }

    return result;
}

/**
 * Собирает медиа-группу (sendMediaGroup) из нескольких изображений карточки.
 *
 * Telegram API требует 2–10 элементов: если после фильтрации остался один,
 * он уходит одиночной sendPhoto, и функция возвращает null (в ответе карточки нет).
 *
 * @param cardInfo Информация о карточке
 * @param controller Контроллер приложения
 * @returns Массив медиа-объектов (2–10) либо `null`, если элемент один (ушёл sendPhoto) или картинок нет
 */
async function getMediaGroup(
    cardInfo: ICardInfo,
    controller: BotController,
): Promise<ITelegramMedia[] | null> {
    const object: ITelegramMedia[] = [];
    if (cardInfo.images.length > MAX_TELEGRAM_MEDIA_GROUP_ITEMS) {
        controller.appContext.logWarn(
            `[Telegram] Медиа-группа ограничена ${MAX_TELEGRAM_MEDIA_GROUP_ITEMS} изображениями; ` +
                `лишние изображения (${cardInfo.images.length - MAX_TELEGRAM_MEDIA_GROUP_ITEMS}) пропущены.`,
        );
    }
    for (
        let i = 0;
        i < cardInfo.images.length && object.length < MAX_TELEGRAM_MEDIA_GROUP_ITEMS;
        i++
    ) {
        const image = cardInfo.images[i];
        if (!image) {
            break;
        }
        let field: string | null;
        if (!image.imageToken) {
            if (image.imageDir) {
                field = Text.isUrl(image.imageDir) ? image.imageDir : `attach://${image.imageDir}`;
            } else {
                controller.appContext.logWarn(
                    '[Telegram] У изображения не заданы ни imageToken, ни imageDir — элемент пропущен.',
                );
                continue;
            }
        } else {
            field = image.imageToken;
        }
        object.push({
            type: 'photo',
            media: field,
            caption: Text.resize(image.desc, 1024),
        });
    }
    // Telegram API требует 2-10 элементов для sendMediaGroup.
    // Если после фильтрации осталось < 2 элементов — отправляем через sendPhoto.
    if (object.length === 1) {
        const media = object[0];
        if (!media) {
            return null;
        }
        // Префикс attach:// нужен только для FormData в sendMediaGroup:
        // sendPhoto ожидает локальный путь, URL или file_id.
        const photo = media.media.startsWith('attach://')
            ? media.media.replace('attach://', '')
            : media.media;
        await sendPhotoChecked(controller, photo, media.caption || undefined);
        return null;
    }
    return object;
}

/**
 * Получает карточку для отображения в Telegram.
 * Асинхронный процессор — вызывать с `await` (см. Card.getCards).
 * @param cardInfo Информация о карточке
 * @param controller Контроллер приложения
 * @returns {Promise<ITelegramMedia[] | null>} Массив медиа-объектов (для sendMediaGroup) либо `null` — одиночное фото отправляется через sendPhoto
 * @example
 * ```ts
 * // Одиночная картинка уходит sendPhoto и возвращает null;
 * // 2+ картинок — массив для sendMediaGroup. Обязательно await:
 * const media = await cardProcessing(cardInfo, controller);
 * if (media) {
 *     await telegramApi.sendMediaGroup(chatId, media);
 * }
 * ```
 */
export async function cardProcessing(
    cardInfo: ICardInfo,
    controller: BotController,
): Promise<ITelegramMedia[] | null> {
    let object: ITelegramMedia[] | null = null;
    // Защита от пустого массива images при showOne=true
    if (cardInfo.images.length === 0) {
        return null;
    }
    if (cardInfo.showOne || cardInfo.images.length === 1) {
        const image = cardInfo.images[0];
        if (!image) {
            return null;
        }
        try {
            if (!image.imageToken) {
                if (image.imageDir) {
                    image.imageToken = await getImageInDB(
                        controller,
                        image.imageDir,
                        Text.resize(image.desc, 1024),
                    );
                }
            } else {
                await sendPhotoChecked(controller, image.imageToken, Text.resize(image.desc, 1024));
            }
        } catch (e) {
            // Логируем ошибку загрузки и возвращаем карточку без фото:
            // медиа-сбой не должен ломать текстовый ответ пользователю
            controller.appContext.logError(
                `Telegram.cardProcessing(): Произошла ошибка при загрузке изображения для Telegram`,
                {
                    error: e,
                },
            );
        }
        return object;
    }

    object = await getMediaGroup(cardInfo, controller);
    return object;
}
