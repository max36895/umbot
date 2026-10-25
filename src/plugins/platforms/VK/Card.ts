/**
 * Построение карусели VK: до 10 элементов, токены изображений через upload-flow photos.saveMessagesPhoto.
 */
import { ICardInfo, ImageTokens, BotController, Text } from '../../../index';

import { buttonProcessing } from './Button';
import { VkRequest } from '../API';
import {
    getImageToken,
    getPlatformRequestData,
    cacheMediaToken,
    consumeUploadRate,
} from '../Base/utils';
import { IVkButton, IVkButtonObject, IVkCard, IVkCardElement } from './interfaces/IVkPlatform';
import { T_VK, VK_MAX_CAROUSEL_ELEMENTS } from './constants';

/**
 * Получение токена, необходимого для отображения картинок в карточке ВК
 * @param controller Контроллер приложения
 * @param path Путь до картинки
 * @returns Строка-вложение (photo<owner_id>_<id>) либо `null` при ошибке загрузки/сохранения
 */
export async function getImageInDB(
    controller: BotController,
    path: string,
): Promise<string | null> {
    return getImageToken(path, T_VK, controller, async (model: ImageTokens) => {
        // Callback выполняется только при cache miss: впереди загрузка — два лишних
        // вызова api.vk.com (getMessagesUploadServer + saveMessagesPhoto) — резервируем
        // под них слоты лимита отправки.
        consumeUploadRate(controller, T_VK, 2);
        const api = new VkRequest(controller.appContext);
        const requestData = getPlatformRequestData<Record<string, unknown> & { peerId?: number }>(
            controller,
            T_VK,
        );
        // Адресат протактивной отправки — аргумент send(): peerId входящего
        // запроса принадлежит чату этого запроса, а не получателю рассылки.
        const peerId = (
            controller.platformOptions.isProactive
                ? controller.userId
                : (requestData.peerId ?? controller.userId)
        ) as string;
        const server = await api.photosGetMessagesUploadServer(peerId);
        if (!server?.upload_url) {
            return null;
        }

        // Сервер загрузки фото VK принимает файл только в поле `photo`.
        const upload = await api.upload(server.upload_url, path, 'photo');
        if (!upload?.photo || !upload.server || !upload.hash) {
            return null;
        }

        const photo = await api.photosSaveMessagesPhoto(upload.photo, upload.server, upload.hash);
        if (photo?.[0]?.id) {
            model.imageToken = `photo${photo[0].owner_id}_${photo[0].id}`;
            await cacheMediaToken(model, controller);
            return model.imageToken;
        }
        return null;
    });
}

/**
 * Собирает элементы карусели VK из изображений карточки.
 *
 * Карусель ограничена VK_MAX_CAROUSEL_ELEMENTS (10) элементами; для обычной
 * карусели каждый элемент требует минимум одну валидную кнопку (до 3),
 * для галереи кнопки опциональны. Сборка останавливается на первом
 * изображении, для которого не удалось получить токен.
 *
 * @param cardInfo Информация о карточке
 * @param controller Контроллер приложения
 * @returns Массив элементов карусели (может быть неполным при сбое загрузки)
 */
async function getElements(
    cardInfo: ICardInfo,
    controller: BotController,
): Promise<IVkCardElement[]> {
    const maxImages = Math.min(cardInfo.images.length, VK_MAX_CAROUSEL_ELEMENTS);
    if (cardInfo.images.length > VK_MAX_CAROUSEL_ELEMENTS) {
        controller.appContext.logWarn(
            `[VK] Карусель ограничена ${VK_MAX_CAROUSEL_ELEMENTS} элементами; ` +
                `лишние изображения (${cardInfo.images.length - VK_MAX_CAROUSEL_ELEMENTS}) пропущены.`,
        );
    }
    const elements = [];
    for (let i = 0; i < maxImages; i++) {
        const image = cardInfo.images[i];
        if (!image) {
            break;
        }
        if (!image.imageToken && image.imageDir) {
            image.imageToken = await getImageInDB(controller, image.imageDir);
        }
        if (!image.imageToken) {
            // Дальнейшие изображения тоже отбрасываются: карусель собирается до
            // первого сбоя. Без предупреждения в продакшене выглядело как
            // «карточки пропали» без причины в логах.
            controller.appContext.logWarn(
                `[VK] Не удалось получить image_id для изображения ${i} — ` +
                    `карточка и все последующие (${maxImages - i}) пропущены.`,
            );
            break;
        }
        if (cardInfo.usedGallery) {
            const element: IVkCardElement = {
                title: Text.resize(image.title, 80),
                description: Text.resize(image.desc, 80),
                photo_id: image.imageToken.replace('photo', ''),
            };
            const button = image.button?.getButtons<IVkButtonObject, IVkButton>((buttons) =>
                buttonProcessing(buttons, controller.appContext),
            );
            // Карусель VK требует минимум одну кнопку на элемент (см. не-gallery
            // ветку ниже), иначе VK отклоняет всю карусель. Элемент без кнопок
            // не попадает в карусель, разработчик получает warn.
            if (button?.buttons?.length) {
                element.buttons = button.buttons.flat().slice(0, 3) as IVkButton[];
                element.action = { type: 'open_photo' };
                elements.push(element);
            } else {
                controller.appContext.logWarn(
                    `[VK] Элемент карусели ${i} без валидной кнопки — пропущен: ` +
                        'VK требует минимум одну кнопку на элемент галереи.',
                );
            }
        } else {
            const element: IVkCardElement = {
                title: Text.resize(image.title, 80),
                description: Text.resize(image.desc, 80),
                photo_id: image.imageToken.replace('photo', ''),
            };
            const button = image.button?.getButtons<IVkButtonObject, IVkButton>((buttons) =>
                buttonProcessing(buttons, controller.appContext),
            );
            /*
             * Карусель VK требует минимум одну кнопку на элемент —
             * без валидной кнопки элемент не попадает в карусель.
             * Максимальное количество кнопок 3
             */
            if (button?.one_time && button.buttons?.length) {
                element.buttons = button.buttons.flat().slice(0, 3) as IVkButton[];
                element.action = { type: 'open_photo' };
                elements.push(element);
            } else {
                // Как и в gallery-ветке: пропуск карточки должен быть виден в логах.
                controller.appContext.logWarn(
                    `[VK] Элемент карусели ${i} без валидной кнопки — пропущен: ` +
                        'VK требует минимум одну кнопку на элемент карусели.',
                );
            }
        }
    }
    return alignElementButtons(elements, controller);
}

/**
 * Выравнивает число кнопок у элементов карусели.
 *
 * VK требует одинаковую структуру всех элементов карусели (первый элемент
 * задаёт структуру остальных): карусель, где у одной карточки 2 кнопки, а у
 * другой 1, отклоняется целиком. Лишние кнопки обрезаются до минимального
 * числа среди элементов — так карусель уходит, а разработчик получает warn.
 *
 * @param elements Элементы карусели (у каждого минимум одна кнопка)
 * @param controller Контроллер приложения (для логирования)
 * @returns Те же элементы с одинаковым числом кнопок
 */
function alignElementButtons(
    elements: IVkCardElement[],
    controller: BotController,
): IVkCardElement[] {
    if (elements.length < 2) {
        return elements;
    }
    let minButtons = Infinity;
    let maxButtons = 0;
    for (const element of elements) {
        const count = element.buttons?.length ?? 0;
        minButtons = Math.min(minButtons, count);
        maxButtons = Math.max(maxButtons, count);
    }
    if (minButtons !== maxButtons) {
        controller.appContext.logWarn(
            `[VK] У элементов карусели разное число кнопок (${minButtons}–${maxButtons}); ` +
                `VK требует одинаковую структуру элементов — оставлено ${minButtons} кнопок у каждого.`,
        );
        for (const element of elements) {
            if (element.buttons) {
                element.buttons = element.buttons.slice(0, minButtons);
            }
        }
    }
    return elements;
}

/**
 * Получает карточку для отображения в VK.
 * Асинхронный процессор — вызывать с `await` (см. Card.getCards).
 * @param cardInfo Информация о карточке
 * @param controller Контроллер приложения
 * @returns {Promise<IVkCard | string[]>} Шаблон карусели (IVkCard) либо массив строк-вложений (attachment ID), либо пустой массив, если нечего отобразить
 * @example
 * ```ts
 * // Одиночная картинка -> массив вложений (string[]);
 * // 2+ картинок -> шаблон карусели (IVkCard). Обязательно await:
 * const result = await cardProcessing(cardInfo, controller);
 * if (!Array.isArray(result)) {
 *     params.template = result; // carousel
 * } else {
 *     params.attachments = result;
 * }
 * ```
 */
export async function cardProcessing(
    cardInfo: ICardInfo,
    controller: BotController,
): Promise<IVkCard | string[]> {
    const object: IVkCard | string[] = [];
    const countImage = cardInfo.images.length;
    if (countImage) {
        const firstImage = cardInfo.images[0];
        if ((countImage === 1 || cardInfo.showOne) && firstImage) {
            if (!firstImage.imageToken && firstImage.imageDir) {
                firstImage.imageToken = await getImageInDB(controller, firstImage.imageDir);
            }
            if (firstImage.imageToken) {
                object.push(firstImage.imageToken);
                return object;
            }
        } else if (countImage > 1) {
            const elements = await getElements(cardInfo, controller);
            if (elements.length) {
                return {
                    type: 'carousel',
                    elements,
                };
            }
        }
    }
    return object;
}
