/**
 * Построение кнопок Telegram: inline-клавиатуры до 40 кнопок, callback_data 1–64 байта, style (Bot API 9.4+).
 */
import { IButtonType, AppContext } from '../../../index';

import {
    ITelegramKeyboard,
    ITelegramInlineKeyboard,
    ITelegramReplyButton,
} from './interfaces/ITelegramPlatform';
import { getCorrectButtons, serializePlatformPayload } from '../Base/utils';
import { TG_BUTTON_STYLES, TG_CALLBACK_DATA_MAX_LENGTH } from './constants';

/**
 * Возвращает валидный стиль кнопки из `options.style` либо `undefined`.
 *
 * Bot API принимает только «danger», «success» и «primary»; неизвестное
 * значение (например, VK-цвет 'positive' из общих options) приводит к отказу
 * Telegram отправить всё сообщение. Такой стиль пропускается с предупреждением —
 * кнопка уходит со стилем приложения по умолчанию.
 *
 * @param button Универсальная кнопка umbot
 * @param appContext Контекст приложения для логирования
 * @returns Стиль для поля `style` либо `undefined`
 */
function getButtonStyle(button: IButtonType, appContext?: AppContext): string | undefined {
    const style = button.options?.style;
    if (style === undefined || style === null || style === '') {
        return undefined;
    }
    const value = String(style);
    if (TG_BUTTON_STYLES.includes(value)) {
        return value;
    }
    appContext?.logWarn(
        `[Telegram] Неизвестный стиль кнопки "${value}" пропущен: Bot API принимает только ${TG_BUTTON_STYLES.join(', ')}.`,
    );
    return undefined;
}

/**
 * Добавляет url-кнопку в inline-набор.
 *
 * URL-кнопка не использует callback_data, поэтому лимит 64 байта к ней
 * неприменим: проверка payload до ветки url отбрасывала валидную url-кнопку,
 * у которой просто задан крупный payload для других платформ.
 *
 * @param button Универсальная кнопка umbot (нужна только для options.style)
 * @param title Проверенный (непустой) текст кнопки
 * @param url Ссылка кнопки
 * @param inlines Накопитель inline-кнопок
 * @param appContext Контекст приложения для логирования ошибок валидации
 */
function pushUrlButton(
    button: IButtonType,
    title: string,
    url: string,
    inlines: ITelegramInlineKeyboard[],
    appContext?: AppContext,
): void {
    // url и callback_data взаимоисключающие в Telegram API
    const urlButton: ITelegramInlineKeyboard = {
        text: title,
        url,
    };
    // Стиль кнопки (Bot API 9.4+), константы TG_STYLE_*.
    const style = getButtonStyle(button, appContext);
    if (style) {
        urlButton.style = style;
    }
    inlines.push(urlButton);
}

/**
 * Добавляет callback-кнопку (payload) в inline-набор с проверкой лимита
 * callback_data 1–64 байта (Telegram Bot API).
 *
 * @param button Универсальная кнопка umbot (нужна только для options)
 * @param title Проверенный (непустой) текст кнопки
 * @param payload Payload кнопки для сериализации в callback_data
 * @param inlines Накопитель inline-кнопок
 * @param appContext Контекст приложения для логирования ошибок валидации
 */
function pushCallbackButton(
    button: IButtonType,
    title: string,
    payload: object | string,
    inlines: ITelegramInlineKeyboard[],
    appContext?: AppContext,
): void {
    const callbackData = serializePlatformPayload(payload, 'Telegram', appContext);
    // Невалидный payload не сериализуется — кнопка пропускается целиком.
    if (callbackData === null) {
        return;
    }
    if (typeof callbackData === 'string') {
        const byteLength = Buffer.byteLength(callbackData, 'utf8');
        if (byteLength > TG_CALLBACK_DATA_MAX_LENGTH) {
            appContext?.logWarn(
                `[Telegram] callback_data превышает лимит ${TG_CALLBACK_DATA_MAX_LENGTH} байт (${byteLength} байт). Кнопка будет пропущена без изменения данных.`,
            );
            return;
        }
    }
    const inline: ITelegramInlineKeyboard = {
        text: title,
        callback_data: callbackData,
    };
    const style = getButtonStyle(button, appContext);
    if (style) {
        inline.style = style;
    }
    inlines.push(inline);
}

/**
 * Шаблон служебного callback_data текстовой inline-кнопки, чей текст не помещается
 * в callback_data: `#t<номер кнопки в сообщении>`. Текст восстанавливается адаптером
 * из клавиатуры исходного сообщения (см. {@link getTextButtonTitle}).
 */
const TEXT_BUTTON_TOKEN = /^#t\d+$/;

/**
 * Добавляет текстовую inline-кнопку: нажатие приходит боту как текст кнопки —
 * так же, как если бы пользователь напечатал его сам.
 *
 * В callback_data кладётся сам текст, если он помещается в лимит 64 байта и не похож
 * на JSON (иначе адаптер разобрал бы его как payload). Иначе — короткий токен `#t<n>`,
 * по которому адаптер найдёт текст в клавиатуре сообщения.
 *
 * @param button Универсальная кнопка umbot (нужна только для options)
 * @param title Проверенный (непустой) текст кнопки
 * @param inlines Накопитель inline-кнопок
 * @param appContext Контекст приложения для логирования ошибок валидации
 */
function pushTextInlineButton(
    button: IButtonType,
    title: string,
    inlines: ITelegramInlineKeyboard[],
    appContext?: AppContext,
): void {
    const trimmed = title.trim();
    const fitsAsText =
        Buffer.byteLength(title, 'utf8') <= TG_CALLBACK_DATA_MAX_LENGTH &&
        !(trimmed.startsWith('{') && trimmed.endsWith('}')) &&
        !TEXT_BUTTON_TOKEN.test(trimmed);
    const inline: ITelegramInlineKeyboard = {
        text: title,
        callback_data: fitsAsText ? title : `#t${inlines.length}`,
    };
    const style = getButtonStyle(button, appContext);
    if (style) {
        inline.style = style;
    }
    inlines.push(inline);
}

/**
 * Текст, который пользователь «сказал» нажатием текстовой inline-кнопки.
 *
 * Для токена `#t<n>` ищет кнопку с таким callback_data в клавиатуре исходного сообщения
 * и возвращает её текст. Для прочих данных (обычный payload или текст кнопки) — `null`.
 *
 * @param data callback_data нажатой кнопки
 * @param replyMarkup Клавиатура сообщения, к которому привязана кнопка
 * @returns Текст кнопки либо `null`, если это не токен или кнопка не найдена
 */
export function getTextButtonTitle(
    data: string | undefined,
    replyMarkup: { inline_keyboard?: ITelegramInlineKeyboard[][] } | undefined,
): string | null {
    if (!data || !TEXT_BUTTON_TOKEN.test(data)) {
        return null;
    }
    for (const row of replyMarkup?.inline_keyboard ?? []) {
        for (const btn of row) {
            if (btn.callback_data === data && btn.text) {
                return btn.text;
            }
        }
    }
    return null;
}

/**
 * Добавляет обычную reply-кнопку (текст, запрос контакта/локации, стиль).
 *
 * @param button Универсальная кнопка umbot (нужна только для options)
 * @param title Проверенный (непустой) текст кнопки
 * @param reply Накопитель reply-кнопок
 * @param appContext Контекст приложения для логирования ошибок валидации
 */
function pushReplyButton(
    button: IButtonType,
    title: string,
    reply: ITelegramReplyButton[],
    appContext?: AppContext,
): void {
    const replyBtn: ITelegramReplyButton = { text: title };
    if (button.options?.request_contact) {
        replyBtn.request_contact = true;
    }
    if (button.options?.request_location) {
        replyBtn.request_location = true;
    }
    const style = getButtonStyle(button, appContext);
    if (style) {
        replyBtn.style = style;
    }
    reply.push(replyBtn);
}

/**
 * Может ли кнопка быть текстовой inline-кнопкой: запрос контакта и локации
 * Telegram поддерживает только в обычной клавиатуре.
 *
 * @param button Универсальная кнопка umbot
 * @returns `true`, если кнопку можно показать inline
 */
function canBeInline(button: IButtonType): boolean {
    return !button.options?.request_contact && !button.options?.request_location;
}

/**
 * Будет ли кнопка inline-кнопкой сама по себе: url, payload или опция `inline`.
 *
 * @param button Универсальная кнопка umbot
 * @returns `true` для inline-кнопки
 */
function isInlineButton(button: IButtonType): boolean {
    return !!button.url || !!button.payload || (!!button.options?.inline && canBeInline(button));
}

/**
 * Классифицирует одну кнопку по типу (url → inline с callback_data → текстовая inline →
 * reply) и добавляет её в соответствующий набор; невалидные кнопки пропускает с warn.
 *
 * @param button Универсальная кнопка umbot
 * @param inlines Накопитель inline-кнопок
 * @param reply Накопитель reply-кнопок
 * @param preferInline В сообщении уже есть inline-кнопки — текстовые кнопки тоже делаем inline
 * @param appContext Контекст приложения для логирования ошибок валидации
 */
function pushButton(
    button: IButtonType,
    inlines: ITelegramInlineKeyboard[],
    reply: ITelegramReplyButton[],
    preferInline: boolean,
    appContext?: AppContext,
): void {
    // Guard один раз сужает title/url/payload до непустых значений; хелперы
    // получают уже проверенные аргументы и не дублируют проверки. trim здесь —
    // только проверка, в кнопку title уходит как есть (как и до рефакторинга).
    if (!button.title?.trim()) {
        appContext?.logWarn('[Telegram] Кнопка с пустым text пропущена.');
        return;
    }
    if (button.url) {
        pushUrlButton(button, button.title, button.url, inlines, appContext);
    } else if (button.payload) {
        pushCallbackButton(button, button.title, button.payload, inlines, appContext);
    } else if ((button.options?.inline || preferInline) && canBeInline(button)) {
        pushTextInlineButton(button, button.title, inlines, appContext);
    } else {
        pushReplyButton(button, button.title, reply, appContext);
    }
}

/**
 * Получение кнопок в формате Telegram
 * @param buttons Кнопки, которые необходимо отобразить
 * @param appContext Контекст приложения (опционально, для логирования ошибок валидации)
 * @returns Клавиатура (reply или inline) либо `null`, если валидных кнопок нет
 */
export function buttonProcessing(
    buttons: IButtonType[],
    appContext?: AppContext,
): ITelegramKeyboard | null {
    const object: ITelegramKeyboard = {};
    const inlines: ITelegramInlineKeyboard[] = [];
    const reply: ITelegramReplyButton[] = [];

    const correctButtons = getCorrectButtons(buttons, 40, appContext);
    // Telegram не совмещает inline- и обычную клавиатуру в одном сообщении. Если есть хоть
    // одна inline-кнопка, текстовые кнопки тоже показываем inline — иначе они бы пропали.
    const preferInline = correctButtons.some(isInlineButton);
    correctButtons.forEach((button) => {
        pushButton(button, inlines, reply, preferInline, appContext);
    });
    const rCount = reply.length;
    const rInline = inlines.length;
    if (rCount || rInline) {
        if (rInline) {
            if (rCount) {
                // Telegram не умеет совмещать inline_keyboard и обычную keyboard в одном
                // сообщении: приходится выбирать одну, и разработчик должен об этом узнать.
                // Остались только кнопки запроса контакта/локации — inline они невозможны.
                appContext?.logWarn(
                    `[Telegram] В ответе одновременно заданы inline-кнопки (${rInline}) и кнопки запроса контакта/локации (${rCount}). ` +
                        'Telegram принимает только один тип клавиатуры в сообщении — отправлены будут inline-кнопки, ' +
                        'кнопки запроса будут пропущены. Отправьте их отдельным сообщением.',
                );
            }
            object.inline_keyboard = inlines.map((btn) => [btn]);
        } else if (rCount) {
            object.keyboard = reply.map((btn) => [btn]);
            object.resize_keyboard = true;
        }
    } else {
        // Невалидные кнопки не должны снимать уже показанную пользователю клавиатуру.
        return null;
    }
    return object;
}
