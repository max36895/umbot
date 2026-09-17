import { AppContext } from '../../../src';
import { TelegramButton } from '../../../src/plugins';

describe('Telegram Button', () => {
    let appContext: AppContext;

    beforeEach(() => {
        appContext = new AppContext();
        appContext.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        appContext.appConfig.tokens.telegram = {
            token: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        };
    });

    describe('buttonProcessing', () => {
        it('создаёт inline-кнопку с url', () => {
            const result = TelegramButton.buttonProcessing(
                [{ title: 'Сайт', url: 'https://example.com' }],
                appContext,
            );

            expect(result).toEqual({
                inline_keyboard: [[{ text: 'Сайт', url: 'https://example.com' }]],
            });
        });

        it('создаёт inline-кнопку с callback_data', () => {
            const result = TelegramButton.buttonProcessing(
                [{ title: 'Купить', payload: 'buy_item' }],
                appContext,
            );

            expect(result).toEqual({
                inline_keyboard: [[{ text: 'Купить', callback_data: 'buy_item' }]],
            });
        });

        it('url-кнопка не отбрасывается из-за payload больше 64 байт', () => {
            // callback_data к url-кнопке не применяется, поэтому лимит 64 байта
            // на payload других платформ не должен ронять валидную кнопку
            const bigPayload = 'x'.repeat(200);
            const result = TelegramButton.buttonProcessing(
                [{ title: 'Сайт', url: 'https://example.com', payload: bigPayload }],
                appContext,
            );

            expect(result).toEqual({
                inline_keyboard: [[{ text: 'Сайт', url: 'https://example.com' }]],
            });
        });

        it('callback-кнопка с payload больше 64 байт пропускается с предупреждением', () => {
            const result = TelegramButton.buttonProcessing(
                [{ title: 'Купить', payload: 'x'.repeat(100) }],
                appContext,
            );

            expect(result).toBeNull();
        });

        it('создаёт inline-кнопку с JSON payload', () => {
            const result = TelegramButton.buttonProcessing(
                [{ title: 'Действие', payload: { action: 'open', id: 5 } }],
                appContext,
            );

            expect(result).toEqual({
                inline_keyboard: [
                    [{ text: 'Действие', callback_data: '{"action":"open","id":5}' }],
                ],
            });
        });

        it('создаёт reply-кнопки', () => {
            const result = TelegramButton.buttonProcessing(
                [{ title: 'Кнопка 1' }, { title: 'Кнопка 2' }],
                appContext,
            );

            expect(result).toEqual({
                keyboard: [[{ text: 'Кнопка 1' }], [{ text: 'Кнопка 2' }]],
                resize_keyboard: true,
            });
        });

        it('создаёт reply-кнопку с request_contact', () => {
            const result = TelegramButton.buttonProcessing(
                [{ title: 'Поделиться номером', options: { request_contact: true } }],
                appContext,
            );

            expect(result).toEqual({
                keyboard: [[{ text: 'Поделиться номером', request_contact: true }]],
                resize_keyboard: true,
            });
        });

        it('создаёт reply-кнопку с request_location', () => {
            const result = TelegramButton.buttonProcessing(
                [{ title: 'Поделиться гео', options: { request_location: true } }],
                appContext,
            );

            expect(result).toEqual({
                keyboard: [[{ text: 'Поделиться гео', request_location: true }]],
                resize_keyboard: true,
            });
        });

        it('options.inline: текстовая кнопка становится inline с текстом в callback_data', () => {
            const result = TelegramButton.buttonProcessing(
                [{ title: 'Да', options: { inline: true } }],
                appContext,
            );

            expect(result).toEqual({
                inline_keyboard: [[{ text: 'Да', callback_data: 'Да' }]],
            });
        });

        it('options.inline: длинный текст (> 64 байт) передаётся токеном #t<n>', () => {
            const long = 'Очень длинная надпись на кнопке больше лимита';
            const result = TelegramButton.buttonProcessing(
                [
                    { title: 'Коротко', options: { inline: true } },
                    { title: long, options: { inline: true } },
                ],
                appContext,
            );

            expect(result).toEqual({
                inline_keyboard: [
                    [{ text: 'Коротко', callback_data: 'Коротко' }],
                    [{ text: long, callback_data: '#t1' }],
                ],
            });
        });

        it('смешанные кнопки: текстовые становятся inline, а не пропадают', () => {
            const result = TelegramButton.buttonProcessing(
                [{ title: 'Купить', payload: { command: 'buy' } }, { title: 'Назад' }],
                appContext,
            );

            expect(result).toEqual({
                inline_keyboard: [
                    [{ text: 'Купить', callback_data: '{"command":"buy"}' }],
                    [{ text: 'Назад', callback_data: 'Назад' }],
                ],
            });
        });

        it('кнопка запроса контакта не становится inline даже с options.inline', () => {
            const result = TelegramButton.buttonProcessing(
                [{ title: 'Номер', options: { request_contact: true, inline: true } }],
                appContext,
            );

            expect(result).toEqual({
                keyboard: [[{ text: 'Номер', request_contact: true }]],
                resize_keyboard: true,
            });
        });

        it('текст, похожий на JSON или токен, передаётся токеном', () => {
            const result = TelegramButton.buttonProcessing(
                [
                    { title: '{"a":1}', options: { inline: true } },
                    { title: '#t5', options: { inline: true } },
                ],
                appContext,
            );

            expect(result).toEqual({
                inline_keyboard: [
                    [{ text: '{"a":1}', callback_data: '#t0' }],
                    [{ text: '#t5', callback_data: '#t1' }],
                ],
            });
        });

        it('возвращает null при отсутствии кнопок', () => {
            const result = TelegramButton.buttonProcessing([], appContext);

            expect(result).toBeNull();
        });

        it('обрезает количество кнопок до 40', () => {
            const manyButtons = Array.from({ length: 50 }, (_, i) => ({
                title: `Кнопка ${i + 1}`,
            }));

            const result = TelegramButton.buttonProcessing(manyButtons, appContext);

            expect(result?.keyboard?.length).toBe(40);
        });

        it('пропускает callback-кнопку длиннее 64 байт без изменения payload', () => {
            const longPayload = 'a'.repeat(100);
            const logWarn = jest.spyOn(appContext, 'logWarn').mockImplementation(() => {});

            const result = TelegramButton.buttonProcessing(
                [{ title: 'Длинный', payload: longPayload }],
                appContext,
            );

            expect(result).toBeNull();
            expect(logWarn).toHaveBeenCalledWith(
                expect.stringContaining('превышает лимит 64 байт'),
            );
        });

        it('не создаёт изменённый callback_data при многобайтном превышении', () => {
            const result = TelegramButton.buttonProcessing(
                [{ title: 'Действие', payload: `${'a'.repeat(63)}😀` }],
                appContext,
            );
            expect(result).toBeNull();
        });

        it('не создаёт клавиатуру при пустом массиве кнопок', () => {
            const result = TelegramButton.buttonProcessing([], appContext);

            expect(result).toBeNull();
        });
    });
});
