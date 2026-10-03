import { AppContext } from '../../index';
import { adapters } from './adapters';

/**
 * Регистрирует чат-платформы (Telegram, VK, MAX, Viber) в приложение.
 * Это подмножество fullPlatforms — только текстовые мессенджеры.
 *
 * @param appContext Контекст приложения
 *
 * @example
 * ```ts
 * import { Bot } from 'umbot';
 * import { botPlatforms } from 'umbot/plugins';
 *
 * const bot = new Bot();
 * bot.use(botPlatforms); // подключает Telegram, VK, Viber, Max
 * ```
 *
 * @group Подключение платформ
 */
function botPlatforms(appContext: AppContext): void {
    adapters.forEach((adapter) => {
        if (!adapter.adapter.isVoice()) {
            const platformAdapter = new adapter.adapter();
            platformAdapter.init(appContext);
            appContext.platforms[platformAdapter.platformName] =
                platformAdapter as AppContext['platforms']['pl'];
        }
    });
}

botPlatforms.isPlugin = true;
export { botPlatforms };
