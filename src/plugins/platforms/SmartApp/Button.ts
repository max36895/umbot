/**
 * Построение кнопок SmartApp: до 8 кнопок-подсказок с server_action и deep_link.
 */
import { AppContext, Text, IButtonType } from '../../../index';

import {
    ISberSmartAppSuggestionButton,
    ISberSmartAppCardAction,
} from './interfaces/ISmartAppPlatform';
import { getCorrectButtons, serializePlatformPayload } from '../Base/utils';

/**
 * action_id, который фреймворк ставит server_action кнопки, если payload не
 * задаёт свой `action_id`. Адаптер по нему понимает, что имя действия
 * нужно брать из параметров (`command`/`action`/`value`).
 */
export const SMART_APP_DEFAULT_ACTION_ID = 'umbot_action';

/**
 * Приводит универсальный payload к структуре server_action SmartApp API:
 * `{action_id, parameters}` (форма `{type, payload}` устарела). Параметры —
 * только объект, поэтому строковые данные сохраняются в поле value без потери
 * информации. В запросе SERVER_ACTION платформа возвращает их в `parameters`.
 */
function getServerAction(
    payload: unknown,
    appContext?: AppContext,
): NonNullable<ISberSmartAppSuggestionButton['actions']>[0] | null {
    if (serializePlatformPayload(payload, 'SmartApp', appContext) === null) {
        return null;
    }
    const payloadObject =
        typeof payload === 'object' && payload !== null && !Array.isArray(payload)
            ? (payload as Record<string, unknown>)
            : null;
    if (typeof payloadObject?.action_id === 'string') {
        const params = payloadObject.parameters ?? payloadObject.payload;
        return {
            type: 'server_action',
            message_name: 'SERVER_ACTION',
            server_action: {
                action_id: payloadObject.action_id,
                parameters:
                    typeof params === 'object' && params !== null && !Array.isArray(params)
                        ? (params as Record<string, unknown>)
                        : {},
            },
        };
    }

    return {
        type: 'server_action',
        message_name: 'SERVER_ACTION',
        server_action: {
            action_id: SMART_APP_DEFAULT_ACTION_ID,
            parameters: payloadObject ?? { value: payload },
        },
    };
}

/**
 * Получение кнопок в формате SmartApp
 * @param buttons Кнопки, которые необходимо отобразить
 * @param isCard флаг принадлежности кнопок к карточке
 * @param appContext Контекст приложения (для логирования ошибок валидации)
 * @returns Для карточки — действие ISberSmartAppCardAction, для обычного ответа — массив кнопок suggestions; `null`, если кнопка не прошла валидацию
 */
export function buttonProcessing(
    buttons: IButtonType[],
    isCard: boolean = false,
    appContext?: AppContext,
): ISberSmartAppSuggestionButton[] | ISberSmartAppCardAction | null {
    const objects: ISberSmartAppSuggestionButton[] = [];
    if (isCard) {
        const button = buttons[0];
        if (button) {
            if (button.url) {
                return {
                    deep_link: button.url,
                    type: 'deep_link',
                };
            } else {
                const text = Text.resize(button.title || '', 64);
                if (text) {
                    return {
                        text,
                        type: 'text',
                    };
                }
            }
        }
        return null;
    } else {
        getCorrectButtons(buttons, 8, appContext).forEach((button) => {
            const title = Text.resize(button.title || '', 64);
            if (title) {
                const object: ISberSmartAppSuggestionButton = {
                    title,
                };
                if (button.url) {
                    // Без deep_link кнопка-ссылка стала бы текстовым действием
                    // и при нажатии отправила бы свой заголовок как реплику.
                    object.actions = [{ type: 'deep_link', deep_link: button.url }];
                } else if (button.payload) {
                    const action = getServerAction(button.payload, appContext);
                    if (!action) {
                        return;
                    }
                    object.actions = [action];
                } else {
                    object.actions = [{ text: title, type: 'text' }];
                }
                objects.push(object);
            }
        });
    }
    return objects;
}
