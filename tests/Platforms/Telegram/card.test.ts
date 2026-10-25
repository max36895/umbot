import { BotController, ICardInfo, Text } from '../../../src';
import { TelegramCard, TelegramRequest } from '../../../src/plugins';
import { getPlatformRequestData } from '../../../src/plugins/platforms/Base/utils';

// Мокаем утилиты isFile для getImageInDB
jest.mock('../../../src/utils/standard/util', () => ({
    ...jest.requireActual('../../../src/utils/standard/util'),
    isFile: jest.fn().mockResolvedValue(true),
}));

class TestController extends BotController {
    action(): void {
        return;
    }
}

describe('Telegram Card', () => {
    let controller: TestController;

    beforeEach(() => {
        const appContext = new (jest.requireActual('../../../src').AppContext)();
        appContext.appConfig.tokens.telegram = {
            token: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        };
        // Заглушка логгера: cardProcessing пишет предупреждения о молчаливом
        // усечении медиа-группы, и без заглушки они сыпятся в консоль после тестов
        appContext.setLogger({
            log: () => {},
            warn: () => {},
            error: () => {},
        });
        controller = new TestController(appContext);
        controller.userId = 12345;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('cardProcessing', () => {
        it('возвращает null для пустого массива изображений', async () => {
            const cardInfo: ICardInfo = {
                usedGallery: false,
                images: [],
                buttons: controller.buttons,
                title: null,
                description: null,
            };

            const result = await TelegramCard.cardProcessing(cardInfo, controller);

            expect(result).toBeNull();
        });

        it('возвращает null для одиночного изображения (отправляется через sendPhoto внутри)', async () => {
            const sendPhotoSpy = jest
                .spyOn(TelegramRequest.prototype, 'sendPhoto')
                .mockResolvedValue({
                    ok: true,
                    result: {
                        message_id: 100,
                        photo: [
                            { file_id: 'small', width: 100, height: 100 },
                            { file_id: 'large', width: 800, height: 600 },
                        ],
                    } as never,
                });

            const cardInfo: ICardInfo = {
                usedGallery: false,
                images: [{ imageToken: 'cached_photo_id', desc: 'Одно фото' }],
                buttons: controller.buttons,
                title: null,
                description: null,
            };

            const result = await TelegramCard.cardProcessing(cardInfo, controller);

            // Для одного изображения cardProcessing возвращает null,
            // т.к. sendPhoto вызывается внутри, а не через sendMediaGroup
            expect(result).toBeNull();
            expect(sendPhotoSpy).toHaveBeenCalledWith(12345, 'cached_photo_id', 'Одно фото');
        });

        it('отправляет callback-карточку в исходный групповой чат', async () => {
            getPlatformRequestData<{ chatId?: number }>(controller, 'telegram').chatId = -100500;
            const sendPhotoSpy = jest
                .spyOn(TelegramRequest.prototype, 'sendPhoto')
                .mockResolvedValue({ ok: true, result: null });

            await TelegramCard.cardProcessing(
                {
                    usedGallery: false,
                    images: [{ imageToken: 'cached_photo_id', desc: 'Фото' }],
                    buttons: controller.buttons,
                    title: null,
                    description: null,
                },
                controller,
            );

            expect(sendPhotoSpy).toHaveBeenCalledWith(-100500, 'cached_photo_id', 'Фото');
        });

        it('протактивная отправка: фото уходит адресату send(), а не чату входящего запроса', async () => {
            getPlatformRequestData<{ chatId?: number }>(controller, 'telegram').chatId = -100500;
            controller.platformOptions.isProactive = true;
            const sendPhotoSpy = jest
                .spyOn(TelegramRequest.prototype, 'sendPhoto')
                .mockResolvedValue({ ok: true, result: null });

            await TelegramCard.cardProcessing(
                {
                    usedGallery: false,
                    images: [{ imageToken: 'cached_photo_id', desc: 'Фото' }],
                    buttons: controller.buttons,
                    title: null,
                    description: null,
                },
                controller,
            );

            // controller.userId — адресат, которого подставляет BasePlatform.send()
            expect(sendPhotoSpy).toHaveBeenCalledWith(12345, 'cached_photo_id', 'Фото');
        });

        it('протактивная отправка URL-картинки: sendPhoto уходит адресату send()', async () => {
            getPlatformRequestData<{ chatId?: number }>(controller, 'telegram').chatId = -100500;
            controller.platformOptions.isProactive = true;
            const sendPhotoSpy = jest
                .spyOn(TelegramRequest.prototype, 'sendPhoto')
                .mockResolvedValue({
                    ok: true,
                    result: {
                        message_id: 100,
                        photo: [{ file_id: 'f1', width: 100, height: 100 }],
                    } as never,
                });

            await TelegramCard.cardProcessing(
                {
                    usedGallery: false,
                    images: [{ imageDir: 'https://example.com/pic.jpg', desc: 'Фото' }],
                    buttons: controller.buttons,
                    title: null,
                    description: null,
                },
                controller,
            );

            expect(sendPhotoSpy).toHaveBeenCalledWith(12345, 'https://example.com/pic.jpg', 'Фото');
        });

        it('возвращает массив ITelegramMedia для нескольких изображений', async () => {
            const cardInfo: ICardInfo = {
                usedGallery: true,
                images: [
                    { imageToken: 'file_id_1', desc: 'Фото 1' },
                    { imageToken: 'file_id_2', desc: 'Фото 2' },
                    { imageToken: 'file_id_3', desc: 'Фото 3' },
                ],
                buttons: controller.buttons,
                title: 'Галерея',
                description: 'Описание галереи',
            };

            const result = await TelegramCard.cardProcessing(cardInfo, controller);

            expect(result).not.toBeNull();
            expect(result).toHaveLength(3);
            expect(result![0]).toEqual({
                type: 'photo',
                media: 'file_id_1',
                caption: 'Фото 1',
            });
            expect(result![1]).toEqual({
                type: 'photo',
                media: 'file_id_2',
                caption: 'Фото 2',
            });
        });

        it('ограничивает количество элементов до 10', async () => {
            const images = Array.from({ length: 15 }, (_, i) => ({
                imageToken: `file_id_${i}`,
                desc: `Фото ${i + 1}`,
            }));

            const cardInfo: ICardInfo = {
                usedGallery: true,
                images,
                buttons: controller.buttons,
                title: null,
                description: null,
            };

            const result = await TelegramCard.cardProcessing(cardInfo, controller);

            expect(result).not.toBeNull();
            expect(result).toHaveLength(10);
        });

        it('обрезает caption до 1024 символов для нескольких изображений', async () => {
            const longDesc = 'a'.repeat(2000);
            const cardInfo: ICardInfo = {
                usedGallery: true,
                images: [
                    { imageToken: 'file_id_1', desc: longDesc },
                    { imageToken: 'file_id_2', desc: 'Короткое описание' },
                ],
                buttons: controller.buttons,
                title: null,
                description: null,
            };

            const result = await TelegramCard.cardProcessing(cardInfo, controller);

            expect(result).not.toBeNull();
            expect(result).toHaveLength(2);
            // Text.resize обрезает до 1024 символов (с многоточием, если нужно)
            expect(result![0].caption!.length).toBeLessThanOrEqual(1024);
            // Текст должен совпадать с тем, что делает Text.resize
            expect(result![0].caption).toBe(Text.resize(longDesc, 1024));
        });

        it('обрабатывает изображения с imageDir (attach://)', async () => {
            const cardInfo: ICardInfo = {
                usedGallery: true,
                images: [
                    { imageDir: '/local/path/img.jpg', desc: 'Локальное фото' },
                    { imageToken: 'file_id_remote', desc: 'Удалённое фото' },
                    { imageToken: 'file_id_3', desc: 'Ещё фото' },
                ],
                buttons: controller.buttons,
                title: null,
                description: null,
            };

            const result = await TelegramCard.cardProcessing(cardInfo, controller);

            expect(result).not.toBeNull();
            expect(result).toHaveLength(3);
            expect(result![0].media).toBe('attach:///local/path/img.jpg');
            expect(result![1].media).toBe('file_id_remote');
            expect(result![2].media).toBe('file_id_3');
        });

        it('использует URL из imageDir напрямую в media group', async () => {
            const result = await TelegramCard.cardProcessing(
                {
                    usedGallery: true,
                    images: [
                        { imageDir: 'https://example.com/one.jpg', desc: 'One' },
                        { imageDir: 'https://example.com/two.jpg', desc: 'Two' },
                    ],
                    buttons: controller.buttons,
                    title: null,
                    description: null,
                    showOne: false,
                },
                controller,
            );

            expect(result?.map((item) => item.media)).toEqual([
                'https://example.com/one.jpg',
                'https://example.com/two.jpg',
            ]);
        });

        it('пропускает изображения без imageDir и imageToken (если осталось >= 2)', async () => {
            const cardInfo: ICardInfo = {
                usedGallery: true,
                images: [
                    {} as never,
                    { imageToken: 'valid_id_1', desc: 'Валидное 1' },
                    { imageToken: 'valid_id_2', desc: 'Валидное 2' },
                ],
                buttons: controller.buttons,
                title: null,
                description: null,
            };

            const result = await TelegramCard.cardProcessing(cardInfo, controller);

            expect(result).not.toBeNull();
            expect(result).toHaveLength(2);
            expect(result![0].media).toBe('valid_id_1');
            expect(result![1].media).toBe('valid_id_2');
        });

        it('снимает префикс attach:// при отправке единственного локального файла через sendPhoto', async () => {
            // Регрессия: если из галереи после фильтрации оставался один локальный
            // файл, в sendPhoto уходила строка attach://path — Telegram трактовал её
            // как file_id и отбивал запрос, картинка терялась.
            const sendPhotoSpy = jest
                .spyOn(TelegramRequest.prototype, 'sendPhoto')
                .mockResolvedValue({ ok: true, result: {} });
            const cardInfo: ICardInfo = {
                usedGallery: true,
                images: [{} as never, { imageDir: '/local/path/img.jpg', desc: 'Локальное фото' }],
                buttons: controller.buttons,
                title: null,
                description: null,
            };

            const result = await TelegramCard.cardProcessing(cardInfo, controller);

            expect(result).toBeNull();
            expect(sendPhotoSpy).toHaveBeenCalledWith(
                12345,
                '/local/path/img.jpg',
                'Локальное фото',
            );
        });

        it('возвращает null при showOne=true с одним изображением', async () => {
            const sendPhotoSpy = jest
                .spyOn(TelegramRequest.prototype, 'sendPhoto')
                .mockResolvedValue({
                    ok: true,
                    result: {
                        message_id: 200,
                        photo: [
                            { file_id: 'small', width: 100, height: 100 },
                            { file_id: 'large', width: 800, height: 600 },
                        ],
                    } as never,
                });

            const cardInfo: ICardInfo = {
                usedGallery: false,
                images: [{ imageToken: 'cached_photo_id', desc: 'Кэшированное' }],
                buttons: controller.buttons,
                title: null,
                description: null,
                showOne: true,
            };

            const result = await TelegramCard.cardProcessing(cardInfo, controller);

            expect(result).toBeNull();
            expect(sendPhotoSpy).toHaveBeenCalledWith(12345, 'cached_photo_id', 'Кэшированное');
        });
    });
});
