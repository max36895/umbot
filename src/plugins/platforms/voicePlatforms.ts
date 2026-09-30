import { AppContext } from '../../index';
import { adapters } from './adapters';

/**
 * Регистрирует голосовые платформы (Алиса, Маруся, Сбер SmartApp) в приложение.
 * Это подмножество fullPlatforms — только платформы с голосовым вводом/выводом.
 *
 * @param appContext Контекст приложения
 *
 * @example
 * ```ts
 * import { Bot } from 'umbot';
 * import { voicePlatforms } from 'umbot/plugins';
 *
 * const bot = new Bot();
 * bot.use(voicePlatforms); // подключает Алису, Марусю, SmartApp
 * ```
 *
 * @group Подключение платформ
 */
function voicePlatforms(appContext: AppContext): void {
    adapters.forEach((adapter) => {
        if (adapter.adapter.isVoice()) {
            const platformAdapter = new adapter.adapter();
            platformAdapter.init(appContext);
            appContext.platforms[platformAdapter.platformName] =
                platformAdapter as AppContext['platforms']['pl'];
        }
    });
}

voicePlatforms.isPlugin = true;
export { voicePlatforms };
