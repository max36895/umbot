/**
 * Построение кнопок Viber: rich_media-сетка 6×7, до 6 кнопок в текущей реализации адаптера.
 */
import { AppContext, IButtonType } from '../../../index';
import { IViberButton, IViberButtonObject } from './interfaces/IViberPlatform';
import {
    getCorrectButtons,
    IButtonRowItem,
    layoutButtonRows,
    serializePlatformPayload,
} from '../Base/utils';

/** Ширина клавиатуры Viber в колонках (ButtonsGroupColumns по умолчанию). */
const VIBER_KEYBOARD_COLUMNS = 6;

/**
 * Раскладывает кнопки по рядам: Viber выводит кнопки подряд, заполняя строки по
 * ширине (Columns, по умолчанию 6 — вся строка). Кнопкам ряда делится ширина
 * строки (3 кнопки — по 2 колонки); явно заданный в опциях Columns не меняется.
 * @param items Кнопки с группами рядов
 * @param appContext Контекст для предупреждений
 * @returns Кнопки в порядке вывода
 */
function layoutViberRows(
    items: IButtonRowItem<IViberButton>[],
    appContext?: AppContext,
): IViberButton[] {
    const rows = layoutButtonRows(items, () => VIBER_KEYBOARD_COLUMNS, 'Viber', appContext);
    const result: IViberButton[] = [];
    for (const row of rows) {
        if (row.length > 1) {
            const base = Math.floor(VIBER_KEYBOARD_COLUMNS / row.length);
            const extra = VIBER_KEYBOARD_COLUMNS % row.length;
            row.forEach((button, index) => {
                if (button.Columns === undefined) {
                    // Остаток колонок отдаём первым кнопкам, чтобы ряд занял всю строку
                    // и следующая кнопка не «подтянулась» в него.
                    button.Columns = base + (index < extra ? 1 : 0);
                }
            });
        }
        result.push(...row);
    }
    return result;
}

/**
 * Тип кнопки для отправки ответа.
 * Возвращает `ActionBody` как обычное сообщение от пользователя.
 *
 * @readonly
 *
 * @example
 * ```ts
 * import { ViberButton } from 'umbot/plugins';
 *
 * controller.buttons.addBtn('Подтвердить', '', { action: 'confirm' }, {
 *     ActionType: ViberButton.T_REPLY, // тип кнопки Viber
 *     // ActionBody: 'custom_payload' — если не задан, уйдёт title
 * });
 * ```
 */
export const T_REPLY = 'reply';

/**
 * Тип кнопки для открытия URL в браузере Viber.
 *
 * @readonly
 *
 * @example
 * ```ts
 * import { ViberButton } from 'umbot/plugins';
 *
 * controller.buttons.addLink('Открыть сайт', 'https://example.com', '', {
 *     ActionType: ViberButton.T_OPEN_URL,
 * });
 * ```
 */
export const T_OPEN_URL = 'open-url';

/**
 * Тип кнопки для запроса местоположения у пользователя.
 * Результат приходит в отдельном сообщении Viber.
 *
 * @readonly
 *
 * @example
 * ```ts
 * import { ViberButton } from 'umbot/plugins';
 *
 * controller.buttons.addBtn('Выбрать адрес', '', '', {
 *     ActionType: ViberButton.T_LOCATION_PICKER,
 * });
 * ```
 */
export const T_LOCATION_PICKER = 'location-picker';

/**
 * Тип кнопки для получения телефона пользователя.
 * После нажатия Viber отправит номер в бот.
 *
 * @readonly
 *
 * @example
 * ```ts
 * import { ViberButton } from 'umbot/plugins';
 *
 * controller.buttons.addBtn('Поделиться телефоном', '', '', {
 *     ActionType: ViberButton.T_SHARE_PHONE,
 * });
 * ```
 */
export const T_SHARE_PHONE = 'share-phone';

/**
 * Тип кнопки без действия. Используется для информационных элементов.
 *
 * @readonly
 *
 * @example
 * ```ts
 * import { ViberButton } from 'umbot/plugins';
 *
 * controller.buttons.addBtn('Информация', '', '', {
 *     ActionType: ViberButton.T_NONE,
 *     TextSize: 'small',
 *     TextColor: '#cccccc'
 * });
 * ```
 */
export const T_NONE = 'none';

/**
 * Поля кнопки, которые Viber принимает в объекте `keyboard.Buttons`.
 */
const VIBER_BUTTON_OPTION_FIELDS = new Set([
    'Columns',
    'Rows',
    'BgColor',
    'BgMedia',
    'BgMediaType',
    'BgMediaScaleType',
    'BgLoop',
    'ActionType',
    'ActionBody',
    'Image',
    'ImageScaleType',
    'Text',
    'TextVAlign',
    'TextHAlign',
    'TextPaddings',
    'TextOpacity',
    'TextSize',
    'OpenURLType',
    'OpenURLMediaType',
    'TextBgGradientColor',
    'TextShouldFit',
    'Silent',
    'InternalBrowser',
]);

/**
 * Извлекает только документированные платформенные поля кнопки Viber.
 */
function getViberButtonOptions(options: IButtonType['options']): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    Object.entries(options).forEach(([name, value]) => {
        if (VIBER_BUTTON_OPTION_FIELDS.has(name) && value !== undefined) {
            // Пустой Text из платформенных опций обходил бы фильтр пустой подписи
            // выше: Viber отклоняет кнопку с пустым Text.
            if (name === 'Text' && String(value).trim() === '') {
                return;
            }
            result[name] = value;
        }
    });
    return result;
}

/**
 * Преобразует универсальные кнопки в формат Viber.
 *
 * @param buttons Кнопки, которые необходимо отобразить.
 * @param appContext Контекст приложения (для логирования ошибок валидации).
 * @returns Объект клавиатуры Viber либо `null` при пустом списке или когда все кнопки отсеяны валидацией (пустой title, не-сериализуемый payload).
 */
export function buttonProcessing(
    buttons: IButtonType[],
    appContext?: AppContext,
): IViberButtonObject | null {
    let object: IViberButtonObject | null = null;
    const items: IButtonRowItem<IViberButton>[] = [];
    getCorrectButtons(buttons, 6, appContext).forEach((button) => {
        // Кнопка без подписи в Viber выглядит как пустой прямоугольник и ничего
        // не сообщает пользователю — такие кнопки не отправляем.
        if (!button.title?.trim()) {
            appContext?.logWarn('[Viber] Кнопка с пустым Text пропущена.');
            return;
        }
        let btn: IViberButton = {
            Text: button.title,
        };
        if (button.url) {
            btn.ActionType = T_OPEN_URL;
            btn.ActionBody = button.url;
        } else {
            btn.ActionType = T_REPLY;
            if (button.payload) {
                const payload = serializePlatformPayload(button.payload, 'Viber', appContext);
                if (payload === null) {
                    return;
                }
                btn.ActionBody = payload;
            } else {
                btn.ActionBody = button.title;
            }
        }
        // Кнопка может быть собрана вручную вне компонента Buttons (JS-потребители,
        // тесты): поле options у неё отсутствует, поэтому доступ только через ?.
        if (button.options?.request_contact === true) {
            btn.ActionType = T_SHARE_PHONE;
            btn.ActionBody = button.title;
        } else if (button.options?.request_location === true) {
            btn.ActionType = T_LOCATION_PICKER;
            btn.ActionBody = button.title;
        }
        btn = <IViberButton>{ ...btn, ...getViberButtonOptions(button.options ?? {}) };

        items.push({ group: button.options?._group, item: btn });
    });
    const buttonsResult = layoutViberRows(items, appContext);

    if (buttonsResult.length) {
        object = {
            DefaultHeight: true,
            BgColor: '#FFFFFF',
            Buttons: buttonsResult,
        };
    }
    return object;
}
