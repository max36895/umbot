import { Buttons, AppContext } from '../../src';
import {
    AlisaButton,
    AlisaCard,
    MarusiaButton,
    MaxButton,
    SmartAppButton,
    TelegramButton,
    ViberButton,
    VkButton,
} from '../../src/plugins';
import { getButton } from '../../src/components/button/Button';

const DEFAULT_URL = 'https://test.ru';

let appContext: AppContext;
describe('Buttons test', () => {
    let defaultButtons: Buttons;

    beforeEach(() => {
        appContext = new AppContext();
        appContext.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        appContext.platformParams.utm_text = '';
        defaultButtons = new Buttons(appContext);
        for (let i = 0; i < 3; i++) {
            defaultButtons.addBtn(`${i + 1}`);
            defaultButtons.addLink(`${i + 1}`, DEFAULT_URL);
        }
    });

    it('Button utm text', () => {
        appContext.platformParams.utm_text = null;
        let button = getButton(appContext, 'btn', 'https://google.com');
        expect(button?.url).toEqual(
            'https://google.com?utm_source=umbot&utm_medium=cpc&utm_campaign=phone',
        );

        button = getButton(appContext, 'btn', 'https://google.com?utm_source=test');
        expect(button?.url).toEqual('https://google.com?utm_source=test');

        button = getButton(appContext, 'btn', 'https://google.com?data=test');
        expect(button?.url).toEqual(
            'https://google.com?data=test&utm_source=umbot&utm_medium=cpc&utm_campaign=phone',
        );

        appContext.platformParams.utm_text = 'my_utm_text';
        button = getButton(appContext, 'btn', 'https://google.com');
        expect(button?.url).toEqual('https://google.com?my_utm_text');
    });

    it('Get buttons Alisa', () => {
        const alisaButtons = [
            {
                title: '1',
                hide: true,
            },
            {
                title: '1',
                hide: false,
                url: DEFAULT_URL,
            },
            {
                title: '2',
                hide: true,
            },
            {
                title: '2',
                hide: false,
                url: DEFAULT_URL,
            },
            {
                title: '3',
                hide: true,
            },
            {
                title: '3',
                hide: false,
                url: DEFAULT_URL,
            },
        ];
        expect(defaultButtons.getButtons(AlisaButton.buttonProcessing)).toEqual(alisaButtons);
    });
    it('Get buttons Alisa card', () => {
        expect(defaultButtons.getButtons(AlisaCard.alisaCardButton)).toEqual({
            text: '1',
        });
    });

    it('сохраняет payload кнопки Алисы и Маруси размером ровно 4096 байт', () => {
        // Сериализованный объект — ровно 4096 байт (граница лимита включительно).
        const payload = { d: 'x'.repeat(4096 - '{"d":""}'.length) };
        defaultButtons.clear();
        defaultButtons.addBtn('Граница', null, payload);

        expect(defaultButtons.getButtons(AlisaButton.buttonProcessing)).toEqual([
            expect.objectContaining({ payload }),
        ]);
        expect(defaultButtons.getButtons(MarusiaButton.buttonProcessing)).toEqual([
            expect.objectContaining({ payload }),
        ]);
    });

    it('строковый payload Алисы и Маруси оборачивается в JSON-объект {command}', () => {
        // По протоколу payload кнопки — JSON-объект; строка ушла бы вне контракта.
        defaultButtons.clear();
        defaultButtons.addBtn('Купить', null, 'buy');

        expect(defaultButtons.getButtons(AlisaButton.buttonProcessing)).toEqual([
            expect.objectContaining({ payload: { command: 'buy' } }),
        ]);
        expect(defaultButtons.getButtons(MarusiaButton.buttonProcessing)).toEqual([
            expect.objectContaining({ payload: { command: 'buy' } }),
        ]);
    });

    it('Алиса и Маруся не переписывают невалидные payload и URL кнопок', () => {
        const warn = jest.spyOn(appContext, 'logWarn').mockImplementation(() => {});
        const oversizedPayload = {
            title: 'Payload',
            type: null,
            payload: 'x'.repeat(4097),
            hide: true,
            options: {},
        };
        const oversizedUrl = {
            title: 'URL',
            type: null,
            payload: null,
            url: `https://example.com/${'x'.repeat(1025)}`,
            hide: false,
            options: {},
        };

        expect(
            AlisaButton.buttonProcessing([oversizedPayload, oversizedUrl], false, appContext),
        ).toEqual([]);
        expect(
            MarusiaButton.buttonProcessing([oversizedPayload, oversizedUrl], false, appContext),
        ).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });

    it('Get buttons Marusia', () => {
        // В протоколе кнопок Маруси только title/url/payload — поля hide нет.
        const alisaButtons = [
            { title: '1' },
            { title: '1', url: DEFAULT_URL },
            { title: '2' },
            { title: '2', url: DEFAULT_URL },
            { title: '3' },
            { title: '3', url: DEFAULT_URL },
        ];
        expect(defaultButtons.getButtons(MarusiaButton.buttonProcessing)).toEqual(alisaButtons);
    });

    it('Get buttons Vk', () => {
        const VkButtons = {
            one_time: true,
            buttons: [
                [
                    {
                        action: {
                            type: VkButton.VK_TYPE_TEXT,
                            label: '1',
                        },
                    },
                ],
                [
                    {
                        action: {
                            type: VkButton.VK_TYPE_LINK,
                            link: DEFAULT_URL,
                            label: '1',
                        },
                    },
                ],
                [
                    {
                        action: {
                            type: VkButton.VK_TYPE_TEXT,
                            label: '2',
                        },
                    },
                ],
                [
                    {
                        action: {
                            type: VkButton.VK_TYPE_LINK,
                            link: DEFAULT_URL,
                            label: '2',
                        },
                    },
                ],
                [
                    {
                        action: {
                            type: VkButton.VK_TYPE_TEXT,
                            label: '3',
                        },
                    },
                ],
                [
                    {
                        action: {
                            type: VkButton.VK_TYPE_LINK,
                            link: DEFAULT_URL,
                            label: '3',
                        },
                    },
                ],
            ],
        };
        expect(defaultButtons.getButtons(VkButton.buttonProcessing)).toEqual(VkButtons);

        defaultButtons.clear();
        expect(defaultButtons.getButtons(VkButton.buttonProcessing)).toBeNull();
    });
    it('Get buttons Vk group', () => {
        const VkButtons = {
            one_time: true,
            buttons: [
                [
                    {
                        action: {
                            type: VkButton.VK_TYPE_TEXT,
                            label: '1',
                            payload: '{}',
                        },
                    },
                    {
                        action: {
                            type: VkButton.VK_TYPE_LINK,
                            link: DEFAULT_URL,
                            label: '1',
                            payload: '{}',
                        },
                    },
                    {
                        action: {
                            type: VkButton.VK_TYPE_TEXT,
                            label: '2',
                            payload: '{}',
                        },
                    },
                    {
                        action: {
                            type: VkButton.VK_TYPE_LINK,
                            link: DEFAULT_URL,
                            label: '2',
                            payload: '{}',
                        },
                    },
                ],
                [
                    {
                        action: {
                            type: VkButton.VK_TYPE_TEXT,
                            label: '3',
                            payload: '{}',
                        },
                    },
                ],
                [
                    {
                        action: {
                            type: VkButton.VK_TYPE_LINK,
                            link: DEFAULT_URL,
                            label: '3',
                        },
                    },
                ],
            ],
        };
        defaultButtons.clear();
        defaultButtons.addBtn('1', null, {}, { [VkButton.GROUP_NAME]: 0 });
        defaultButtons.addLink('1', DEFAULT_URL, {}, { [VkButton.GROUP_NAME]: 0 });
        defaultButtons.addBtn('2', null, {}, { [VkButton.GROUP_NAME]: 0 });
        defaultButtons.addLink('2', DEFAULT_URL, {}, { [VkButton.GROUP_NAME]: 0 });

        defaultButtons.addBtn('3', null, {}, { [VkButton.GROUP_NAME]: 1 });
        defaultButtons.addLink('3', DEFAULT_URL);
        expect(defaultButtons.getButtons(VkButton.buttonProcessing)).toEqual(VkButtons);
    });

    it('Get buttons Viber', () => {
        const viberButtons = {
            DefaultHeight: true,
            BgColor: '#FFFFFF',
            Buttons: [
                {
                    Text: '1',
                    ActionType: ViberButton.T_REPLY,
                    ActionBody: '1',
                },
                {
                    Text: '1',
                    ActionType: ViberButton.T_OPEN_URL,
                    ActionBody: DEFAULT_URL,
                },
                {
                    Text: '2',
                    ActionType: ViberButton.T_REPLY,
                    ActionBody: '2',
                },
                {
                    Text: '2',
                    ActionType: ViberButton.T_OPEN_URL,
                    ActionBody: DEFAULT_URL,
                },
                {
                    Text: '3',
                    ActionType: ViberButton.T_REPLY,
                    ActionBody: '3',
                },
                {
                    Text: '3',
                    ActionType: ViberButton.T_OPEN_URL,
                    ActionBody: DEFAULT_URL,
                },
            ],
        };
        expect(defaultButtons.getButtons(ViberButton.buttonProcessing)).toEqual(viberButtons);
    });

    it('Viber сопоставляет универсальные опции и не отправляет чужие поля', () => {
        const result = ViberButton.buttonProcessing([
            {
                title: 'Контакт',
                type: null,
                payload: null,
                hide: false,
                options: {
                    request_contact: true,
                    color: 'primary',
                    TextSize: 'large',
                },
            },
        ]);

        expect(result?.Buttons).toEqual([
            {
                Text: 'Контакт',
                ActionType: ViberButton.T_SHARE_PHONE,
                ActionBody: 'Контакт',
                TextSize: 'large',
            },
        ]);
        expect(result?.Buttons[0]).not.toHaveProperty('request_contact');
        expect(result?.Buttons[0]).not.toHaveProperty('color');
    });

    it('Get buttons SmartApp with documented actions array', () => {
        defaultButtons.clear();
        defaultButtons.addBtn('Открыть заказ', null, { orderId: 42 });

        expect(defaultButtons.getButtons(SmartAppButton.buttonProcessing)).toEqual([
            {
                title: 'Открыть заказ',
                actions: [
                    {
                        type: 'server_action',
                        message_name: 'SERVER_ACTION',
                        server_action: {
                            action_id: 'umbot_action',
                            parameters: { orderId: 42 },
                        },
                    },
                ],
            },
        ]);
    });

    it('Get buttons Telegram', () => {
        // Рядом со ссылками (inline) обычные кнопки тоже показываются inline,
        // а не отбрасываются: Telegram не совмещает два типа клавиатуры
        const telegramButtons = {
            inline_keyboard: [
                [{ text: '1', callback_data: '1' }],
                [{ text: '1', url: 'https://test.ru' }],
                [{ text: '2', callback_data: '2' }],
                [{ text: '2', url: 'https://test.ru' }],
                [{ text: '3', callback_data: '3' }],
                [{ text: '3', url: 'https://test.ru' }],
            ],
        };

        expect(defaultButtons.getButtons(TelegramButton.buttonProcessing)).toEqual(telegramButtons);
        defaultButtons.clear();
        expect(defaultButtons.getButtons(TelegramButton.buttonProcessing)).toBeNull();
    });

    it('Get buttons Telegram with style (inline callback)', () => {
        defaultButtons.clear();
        defaultButtons.addBtn('Подтвердить', null, { action: 'confirm' }, { style: 'primary' });
        defaultButtons.addBtn('Удалить', null, { action: 'delete' }, { style: 'danger' });
        defaultButtons.addBtn('Готово', null, { action: 'done' }, { style: 'success' });

        const result = defaultButtons.getButtons(TelegramButton.buttonProcessing);
        // С 3.1.0 style проставляется и в inline-кнопки (Bot API 9.4+):
        // раньше константы TG_STYLE_* существовали, но поле не проставлялось.
        expect(result).toEqual({
            inline_keyboard: [
                [
                    {
                        text: 'Подтвердить',
                        callback_data: '{"action":"confirm"}',
                        style: 'primary',
                    },
                ],
                [
                    {
                        text: 'Удалить',
                        callback_data: '{"action":"delete"}',
                        style: 'danger',
                    },
                ],
                [
                    {
                        text: 'Готово',
                        callback_data: '{"action":"done"}',
                        style: 'success',
                    },
                ],
            ],
        });
    });

    it('Get buttons Telegram with style (reply)', () => {
        defaultButtons.clear();
        defaultButtons.addBtn('ОК');
        defaultButtons.addBtn('Удалить', null, undefined, { style: 'danger' });

        const result = defaultButtons.getButtons(TelegramButton.buttonProcessing);
        expect(result).toEqual({
            keyboard: [[{ text: 'ОК' }], [{ text: 'Удалить', style: 'danger' }]],
            resize_keyboard: true,
        });
    });

    it('Get buttons Telegram with invalid style is ignored', () => {
        defaultButtons.clear();
        defaultButtons.addBtn('Кнопка', null, { action: 'test' }, { style: 'invalid_value' });

        const result = defaultButtons.getButtons(TelegramButton.buttonProcessing);
        // Bot API принимает только primary/success/danger; с любым другим
        // значением Telegram отклоняет всё сообщение. Поэтому неизвестный стиль
        // пропускается (кнопка уходит без style), а разработчик получает warn —
        // так же адаптеры поступают с невалидным payload.
        expect(result).toEqual({
            inline_keyboard: [[{ text: 'Кнопка', callback_data: '{"action":"test"}' }]],
        });
    });

    it('Get buttons Telegram style applied to url buttons', () => {
        defaultButtons.clear();
        defaultButtons.addLink('Ссылка', 'https://example.com', undefined, { style: 'primary' });

        const result = defaultButtons.getButtons(TelegramButton.buttonProcessing);
        // С 3.1.0 style применяется и к url-кнопкам (Bot API 9.4+):
        // InlineKeyboardButton.style доступен для всех типов inline-кнопок.
        expect(result).toEqual({
            inline_keyboard: [[{ text: 'Ссылка', url: 'https://example.com', style: 'primary' }]],
        });
        expect(result!.inline_keyboard![0][0].style).toBe('primary');
    });

    it('Get buttons Max', () => {
        const maxButtons = {
            buttons: [
                [{ text: '1', type: 'message' }],
                [{ text: '1', type: 'link', url: 'https://test.ru' }],
                [{ text: '2', type: 'message' }],
                [{ text: '2', type: 'link', url: 'https://test.ru' }],
                [{ text: '3', type: 'message' }],
                [{ text: '3', type: 'link', url: 'https://test.ru' }],
            ],
        };

        expect(defaultButtons.getButtons(MaxButton.buttonProcessing)).toEqual(maxButtons);
        defaultButtons.clear();
        expect(defaultButtons.getButtons(MaxButton.buttonProcessing)).toEqual({
            buttons: [],
        });
    });

    it('Get buttons Max with payload as callback', () => {
        defaultButtons.clear();
        defaultButtons.addBtn('Run', null, { action: 'run' });

        expect(defaultButtons.getButtons(MaxButton.buttonProcessing)).toEqual({
            buttons: [[{ text: 'Run', type: 'callback', payload: '{"action":"run"}' }]],
        });
    });

    it('Max не переписывает слишком длинную ссылку кнопки', () => {
        const warn = jest.spyOn(appContext, 'logWarn').mockImplementation(() => {});
        const result = MaxButton.buttonProcessing(
            [
                {
                    title: 'Ссылка',
                    url: `https://example.com/${'x'.repeat(2049)}`,
                    type: null,
                    payload: null,
                    hide: false,
                    options: {},
                },
            ],
            appContext,
        );

        expect(result).toEqual({ buttons: [] });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('2048'));
    });

    it('Max не формирует клавиатуру больше документированных 30 рядов', () => {
        const warn = jest.spyOn(appContext, 'logWarn').mockImplementation(() => {});
        const buttons = Array.from({ length: 31 }, (_, index) => ({
            title: `Кнопка ${index}`,
            type: null,
            payload: null,
            hide: true,
            options: {},
        }));

        expect(MaxButton.buttonProcessing(buttons, appContext).buttons).toHaveLength(30);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('30 рядов'));
    });

    // === Тесты на критические сценарии ===

    it('Telegram не меняет callback_data при превышении 64 байт', () => {
        // Создаём payload, который при JSON.stringify превысит 64 байта
        const longPayload = {
            action: 'very_long_action_name_that_exceeds_the_limit_of_sixty_four_bytes',
            data: 'additional_data_to_make_it_even_longer',
        };
        defaultButtons.clear();
        defaultButtons.addBtn('Кнопка', null, longPayload);

        const result = defaultButtons.getButtons(TelegramButton.buttonProcessing);
        expect(result).toBeNull();
    });

    it('VK принимает payload длиной 255 символов, включая кириллицу', () => {
        const logWarn = jest.spyOn(appContext, 'logWarn').mockImplementation(() => {});
        defaultButtons.clear();
        defaultButtons.addBtn('Кнопка', null, 'я'.repeat(255));

        const result = defaultButtons.getButtons((buttons) =>
            VkButton.buttonProcessing(buttons, appContext),
        );
        expect(result?.buttons).toHaveLength(1);
        expect(logWarn).not.toHaveBeenCalled();
    });

    it('VK обрезает label до 40 символов и предупреждает', () => {
        const logWarn = jest.spyOn(appContext, 'logWarn').mockImplementation(() => {});
        defaultButtons.clear();
        defaultButtons.addBtn('я'.repeat(41));

        const result = defaultButtons.getButtons((buttons) =>
            VkButton.buttonProcessing(buttons, appContext),
        );
        const row = result?.buttons[0];
        const button = Array.isArray(row) ? row[0] : row;

        expect(button?.action.label).toHaveLength(40);
        expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('40'));
    });

    it('VK button protected keys are not overwritten by options', () => {
        defaultButtons.clear();
        // Пытаемся перезаписать action.type через options
        defaultButtons.addBtn(
            'Текст',
            null,
            { test: 'data' },
            {
                action: { type: 'open_app', label: 'Hacked' },
            },
        );

        const result = defaultButtons.getButtons(VkButton.buttonProcessing);
        expect(result).toBeDefined();
        expect(result!.buttons.length).toBe(1);

        // @ts-expect-error что-то с типизацией
        const button = result?.buttons[0][0];
        // action.type должен остаться 'text', а не стать 'open_app'
        expect(button.action.type).toBe(VkButton.VK_TYPE_TEXT);
        // action.label должен остаться 'Текст', а не стать 'Hacked'
        expect(button.action.label).toBe('Текст');
    });

    it('VK does not mutate a universal button or leak foreign options', () => {
        const source = {
            title: 'Текст',
            type: null,
            payload: null,
            hide: true,
            options: {
                request_contact: true,
                style: 'primary',
            },
        };

        const result = VkButton.buttonProcessing([source]);
        const row = result?.buttons[0];
        const button = Array.isArray(row) ? row[0] : row;

        expect(source.type).toBeNull();
        expect(button).toEqual({ action: { type: 'text', label: 'Текст' } });
        expect(button).not.toHaveProperty('request_contact');
        expect(button).not.toHaveProperty('style');
    });

    it('platform button adapters do not throw on a cyclic payload', () => {
        const payload: Record<string, unknown> = {};
        payload.self = payload;
        const source = {
            title: 'Цикл',
            type: null,
            payload,
            hide: true,
            options: {},
        };

        expect(() => AlisaButton.buttonProcessing([source], false, appContext)).not.toThrow();
        expect(AlisaButton.buttonProcessing([source], false, appContext)).toEqual([]);
        expect(MarusiaButton.buttonProcessing([source], false, appContext)).toEqual([]);
        expect(TelegramButton.buttonProcessing([source], appContext)).toBeNull();
        expect(VkButton.buttonProcessing([source], appContext)).toBeNull();
        expect(MaxButton.buttonProcessing([source], appContext)).toEqual({ buttons: [] });
        expect(ViberButton.buttonProcessing([source], appContext)).toBeNull();
        expect(SmartAppButton.buttonProcessing([source], false, appContext)).toEqual([]);
    });

    it('UTM with URL fragment and existing params', () => {
        appContext.platformParams.utm_text = null;

        // URL с фрагментом
        const button1 = getButton(appContext, 'btn', 'https://example.com#section');
        expect(button1?.url).toBe(
            'https://example.com?utm_source=umbot&utm_medium=cpc&utm_campaign=phone#section',
        );

        // URL с существующими параметрами и фрагментом
        const button2 = getButton(appContext, 'btn', 'https://example.com?foo=bar#section');
        expect(button2?.url).toBe(
            'https://example.com?foo=bar&utm_source=umbot&utm_medium=cpc&utm_campaign=phone#section',
        );

        // URL с utm_source (не должен дублировать)
        const button3 = getButton(appContext, 'btn', 'https://example.com?utm_source=custom');
        expect(button3?.url).toBe('https://example.com?utm_source=custom');
    });

    it('remove() отличается от clear(): помечает клавиатуру на удаление', () => {
        const buttons = new Buttons(appContext);
        expect(buttons.isRemove).toBe(false);

        buttons.addBtn('Да');
        buttons.clear();
        // clear() — это «начать список заново», клавиатуру у пользователя он не снимает
        expect(buttons.isRemove).toBe(false);
        expect(buttons.buttons).toEqual([]);

        buttons.remove();
        expect(buttons.isRemove).toBe(true);
        expect(buttons.buttons).toEqual([]);

        // Добавили кнопку — значит клавиатуру показываем, а не убираем
        buttons.addBtn('Снова да');
        expect(buttons.isRemove).toBe(false);

        buttons.remove();
        buttons.clear();
        expect(buttons.isRemove).toBe(false);
    });
});
