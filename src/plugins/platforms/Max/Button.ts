/**
 * Построение кнопок MAX: до 30 рядов по одной кнопке, текст обязателен, URL до 2048 символов.
 */
import { AppContext, IButtonType } from '../../../index';

import { IMaxButtonObject, IMaxButton } from './interfaces/IMaxPlatform';
import {
    getCorrectButtons,
    IButtonRowItem,
    layoutButtonRows,
    serializePlatformPayload,
} from '../Base/utils';

/** Кнопок в ряду клавиатуры MAX. */
const MAX_BUTTONS_PER_ROW = 7;
/** Кнопок в ряду, если в нём есть link / open_app / request_geo_location / request_contact. */
const MAX_WIDE_BUTTONS_PER_ROW = 3;
const MAX_WIDE_BUTTON_TYPES = new Set([
    'link',
    'open_app',
    'request_geo_location',
    'request_contact',
]);

/**
 * Лимит кнопок в ряду MAX: 7, но 3 — если в ряду есть «широкие» типы кнопок.
 * @param row Кнопки ряда
 * @returns Максимум кнопок в ряду
 */
function getMaxRowLimit(row: readonly IMaxButton[]): number {
    return row.some((button) => MAX_WIDE_BUTTON_TYPES.has(button.type))
        ? MAX_WIDE_BUTTONS_PER_ROW
        : MAX_BUTTONS_PER_ROW;
}

/**
 * Выставляет поля, специфичные для типа кнопки, только своему типу
 * (схема кнопок официального SDK @maxhub/max-bot-api): `quick` — только у
 * `request_geo_location`, `contact_id` — только у `open_app`. В кнопки других
 * типов эти поля не попадают.
 * `intent` нет ни в документации MAX, ни в SDK (наследие TamTam, где он был
 * только у callback) — передаём его лишь callback-кнопке.
 *
 * @param object Кнопка MAX с уже определённым типом
 * @param options Опции универсальной кнопки
 */
function applyTypeSpecificOptions(object: IMaxButton, options: Record<string, unknown>): void {
    if (
        object.type === 'callback' &&
        (options.intent === 'default' ||
            options.intent === 'positive' ||
            options.intent === 'negative')
    ) {
        object.intent = options.intent;
    }
    if (object.type === 'request_geo_location' && typeof options.quick === 'boolean') {
        object.quick = options.quick;
    }
    if (object.type === 'open_app' && typeof options.contact_id === 'number') {
        object.contact_id = options.contact_id;
    }
}

/**
 * Получение кнопок в формате Max
 * @param buttons Кнопки, которые необходимо отобразить
 * @param appContext Контекст приложения (для логирования ошибок валидации)
 * @returns Объект inline-клавиатуры MAX (всегда непустая структура; невалидные кнопки пропускаются)
 */
export function buttonProcessing(
    buttons: IButtonType[],
    appContext?: AppContext,
): IMaxButtonObject {
    const items: IButtonRowItem<IMaxButton>[] = [];
    if (buttons.length > 30) {
        appContext?.logWarn(
            '[MAX] клавиатура превышает лимит 30 рядов. Лишние кнопки не будут отправлены.',
        );
    }
    getCorrectButtons(buttons, 30, appContext).forEach((button) => {
        // text — обязательное поле кнопки MAX. Без проверки в запрос уходило
        // {"type":"message","text":null}, и API отклонял всё сообщение целиком.
        const title = button.title;
        if (!title) {
            appContext?.logWarn(
                '[MAX] У кнопки не задан текст — она будет пропущена, т.к. MAX не принимает кнопку без text.',
            );
            return;
        }
        const object: IMaxButton = {
            type: 'message',
            text: title,
        };
        if (button.url) {
            if (button.url.length > 2048) {
                appContext?.logWarn(
                    '[MAX] URL кнопки превышает лимит 2048 символов. Кнопка будет пропущена без изменения ссылки.',
                );
                return;
            }
            object.type = 'link';
            object.url = button.url;
        }
        // У link-кнопки MAX поле payload не документировано (оно есть только у
        // callback/clipboard), поэтому для кнопки-ссылки payload не передаём:
        // универсальная кнопка часто несёт payload для других платформ.
        if (button.payload && !button.url) {
            const payload = serializePlatformPayload(button.payload, 'MAX', appContext);
            if (payload === null) {
                return;
            }
            object.type = 'callback';
            object.payload = payload;
        }
        // Не переносим универсальные/чужие опции платформ в тело MAX: API
        // принимает только документированные поля кнопки и отклоняет неизвестные.
        // Опциональная цепочка — на случай кнопок, собранных вне компонента Buttons.
        const options = button.options ?? {};
        if (options.request_contact === true) {
            object.type = 'request_contact';
            delete object.payload;
            delete object.url;
        } else if (options.request_location === true) {
            object.type = 'request_geo_location';
            delete object.payload;
            delete object.url;
        }
        if (typeof options.web_app === 'string') {
            object.type = 'open_app';
            object.web_app = options.web_app;
            delete object.payload;
            delete object.url;
        }
        applyTypeSpecificOptions(object, options);
        // Раскладка по рядам — из options._group (buttons.row()); кнопка без
        // группы получает отдельную строку, как раньше.
        items.push({ group: button.options?._group, item: object });
    });

    return {
        buttons: layoutButtonRows(items, getMaxRowLimit, 'MAX', appContext),
    };
}
