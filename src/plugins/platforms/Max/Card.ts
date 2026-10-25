/**
 * Построение карточек MAX: загрузка изображений через /uploads и вложения до 12 элементов в сообщении.
 */
import { ICardInfo, ImageTokens, Text, BotController } from '../../../index';

import { IMaxCard, MaxRequest } from '../API';
import { getImageToken, cacheMediaToken, consumeUploadRate } from '../Base/utils';
import { T_MAX_APP } from './constants';

/**
 * Получение токена, необходимого для отображения картинок в карточке Max
 * @param controller Контроллер приложения
 * @param path Путь до картинки (URL возвращается как есть)
 * @returns Токен/URL изображения либо `null` при ошибке загрузки/сохранения
 */
export async function getImageInDB(
    controller: BotController,
    path: string,
): Promise<string | null> {
    if (Text.isUrl(path)) {
        return path;
    }
    return getImageToken(path, T_MAX_APP, controller, async (model: ImageTokens) => {
        // Cache miss: загрузка — лишний вызов API (POST /uploads), резервируем слот.
        consumeUploadRate(controller, T_MAX_APP, 1);
        const api = new MaxRequest(controller.appContext);
        const upload = await api.upload(path, 'image');
        // Кэшируем только токен вложения. upload.url — одноразовый адрес
        // загрузки (upload.do), а не ссылка на картинку: отправленный как
        // payload.url он давал битое вложение и навсегда оседал в кэше.
        if (upload?.token) {
            model.imageToken = upload.token;
            await cacheMediaToken(model, controller);
            return model.imageToken;
        }
        return null;
    });
}

/**
 * Получает карточку для отображения в Max.
 * Асинхронный процессор — вызывать с `await` (см. Card.getCards).
 * @param cardInfo Информация о карточке
 * @param controller Контроллер приложения
 * @returns {Promise<IMaxCard[] | null>} Массив вложений-изображений (в т.ч. из одного элемента) либо `null`, если нечего отобразить
 * @example
 * ```ts
 * // Вложения-изображения для params.attachments. Обязательно await:
 * const attachments = await cardProcessing(cardInfo, controller);
 * if (attachments) {
 *     params.attachments = attachments;
 * }
 * ```
 */
export async function cardProcessing(
    cardInfo: ICardInfo,
    controller: BotController,
): Promise<IMaxCard[] | null> {
    // Защита от пустого массива images при showOne=true
    if (cardInfo.images.length === 0) {
        return null;
    }
    if (cardInfo.images.length === 1 || cardInfo.showOne) {
        const firstImage = cardInfo.images[0];
        if (!firstImage) {
            return null;
        }
        if (!firstImage.imageToken) {
            if (firstImage.imageDir) {
                firstImage.imageToken = await getImageInDB(controller, firstImage.imageDir);
            }
        }
        if (firstImage.imageToken) {
            return [
                {
                    type: 'image',
                    payload: {
                        [Text.isUrl(firstImage.imageToken) ? 'url' : 'token']:
                            firstImage.imageToken,
                    },
                },
            ];
        }
    } else {
        const elements: IMaxCard[] = [];
        for (let i = 0; i < cardInfo.images.length && elements.length < 12; i++) {
            const image = cardInfo.images[i];
            if (!image) {
                break;
            }
            if (!image.imageToken && image.imageDir) {
                image.imageToken = await getImageInDB(controller, image.imageDir);
            }
            if (image.imageToken) {
                elements.push({
                    type: 'image',
                    payload: {
                        [Text.isUrl(image.imageToken) ? 'url' : 'token']: image.imageToken,
                    },
                });
            }
        }
        if (elements.length) {
            return elements;
        }
    }
    return null;
}
