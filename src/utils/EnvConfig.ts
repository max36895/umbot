/**
 * Модуль для работы с конфигурацией окружения
 *
 * Предоставляет функционал для:
 * - Загрузки переменных окружения из файла .env
 * - Типизации конфигурационных параметров
 * - Управления токенами для различных платформ
 * - Настройки подключения к базе данных
 */
import { freadSync } from './standard/util';
import * as path from 'path';

/**
 * Интерфейс конфигурации окружения
 * Определяет структуру переменных окружения для приложения
 *
 * @remarks
 * Все поля являются опциональными и могут быть определены в файле .env
 *
 * @example
 * ```ts
 * // Пример файла .env
 * TELEGRAM_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
 * VK_TOKEN=vk1.a.1234567890abcdef
 * DB_HOST=localhost
 * DB_USER=root
 * DB_PASSWORD=secret
 * DB_NAME=myapp
 * ```
 */
export interface IEnvConfig {
    /**
     * Токен для Telegram Bot API
     * Используется для авторизации бота в Telegram
     *
     * @example
     * ```ts
     * TELEGRAM_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
     * ```
     */
    TELEGRAM_TOKEN?: string;

    /**
     * Токен для VK API
     * Используется для авторизации в VK API
     *
     * @example
     * ```ts
     * VK_TOKEN=vk1.a.1234567890abcdef
     * ```
     */
    VK_TOKEN?: string;

    /**
     * Токен подтверждения для VK Callback API
     * Используется для верификации запросов от VK
     *
     * @example
     * ```ts
     * VK_CONFIRMATION_TOKEN=abcdef123456
     * ```
     */
    VK_CONFIRMATION_TOKEN?: string;

    /**
     * Секретный ключ для VK Callback API (опционально).
     * Если включён в настройках группы VK, VK присылает поле `secret` в теле каждого callback-запроса.
     * Адаптер сверяет его с этим значением для проверки подлинности запроса.
     *
     * @example
     * ```ts
     * VK_SECRET_KEY=abc123def456
     * ```
     */
    VK_SECRET_KEY?: string;

    /**
     * Токен для Viber API
     * Используется для авторизации в Viber API
     *
     * @example
     * ```ts
     * VIBER_TOKEN=1234567890abcdef
     * ```
     */
    VIBER_TOKEN?: string;

    /**
     * Токен для Яндекс.Диалоги (Алиса)
     * Используется для авторизации в API Яндекс.Диалогов
     *
     * ⚠️ **Deprecated:** используйте {@link ALISA_TOKEN}. Этот ключ сохранён
     * для обратной совместимости и будет удалён в следующей мажорной версии.
     * Если заданы оба — приоритет у `ALISA_TOKEN`.
     *
     * @deprecated Используйте `ALISA_TOKEN`
     * @example
     * ```ts
     * YANDEX_TOKEN=1234567890abcdef
     * ```
     */
    YANDEX_TOKEN?: string;

    /**
     * Токен для Яндекс.Диалоги (Алиса)
     * Используется для авторизации в API Яндекс.Диалогов.
     *
     * Заменяет `YANDEX_TOKEN` (сохранён для BC). При одновременном задании обоих
     * приоритет у `ALISA_TOKEN`.
     *
     * @example
     * ```ts
     * ALISA_TOKEN=1234567890abcdef
     * ```
     */
    ALISA_TOKEN?: string;

    /**
     * Токен для Маруси
     * Используется для авторизации в API Маруси
     *
     * @example
     * ```ts
     * MARUSIA_TOKEN=1234567890abcdef
     * ```
     */
    MARUSIA_TOKEN?: string;
    /**
     * Токен для Max
     * Используется для авторизации в API MAX
     *
     * @example
     * ```ts
     * MAX_TOKEN=1234567890abcdef
     * ```
     */
    MAX_TOKEN?: string;

    /**
     * Секрет вебхука Telegram (`secret_token` из `setWebhook`). Записывается в
     * `tokens.telegram.webhookSecret` и включает проверку заголовка
     * `X-Telegram-Bot-Api-Secret-Token`. Команда `npx umbot webhook telegram <url>`
     * генерирует его и регистрирует вебхук с ним.
     *
     * @example
     * ```ts
     * TELEGRAM_WEBHOOK_SECRET=Hk3v...43 символа
     * ```
     */
    TELEGRAM_WEBHOOK_SECRET?: string;

    /**
     * Секрет вебхука MAX (`secret` из `POST /subscriptions`). Записывается в
     * `tokens.max_app.webhookSecret` и включает проверку заголовка
     * `X-Max-Bot-Api-Secret`. Команда `npx umbot webhook max <url>` генерирует его
     * и регистрирует подписку с ним.
     *
     * @example
     * ```ts
     * MAX_WEBHOOK_SECRET=Hk3v...43 символа
     * ```
     */
    MAX_WEBHOOK_SECRET?: string;

    /**
     * Токен для Сбер SmartApp
     * Используется для авторизации в API Сбер SmartApp
     *
     * @example
     * ```ts
     * SMARTAPP_TOKEN=1234567890abcdef
     * ```
     */
    SMARTAPP_TOKEN?: string;

    /**
     * Токен Yandex SpeechKit
     * Используется для синтеза речи (TTS) в чат-ботах: Telegram, VK и Max.
     * Значение автоматически записывается в `speech_kit_token` токенов этих платформ.
     *
     * @example
     * ```ts
     * # API-ключ сервисного аккаунта (уходит как `Api-Key`) — рекомендуется;
     * # IAM-токен `t1.…` тоже принимается (уходит как `Bearer`), но живёт ≤12 ч.
     * SPEECH_KIT_TOKEN=AQVN...
     * ```
     */
    SPEECH_KIT_TOKEN?: string;

    /**
     * Адрес сервера базы данных
     *
     * @remarks
     * Может быть указан как:
     * - localhost
     * - IP-адрес
     * - доменное имя
     *
     * @example
     * ```ts
     * DB_HOST=localhost
     * DB_HOST=127.0.0.1
     * DB_HOST=db.example.com
     * ```
     */
    DB_HOST?: string;

    /**
     * Имя пользователя для подключения к базе данных
     *
     * @example
     * ```ts
     * DB_USER=root
     * ```
     */
    DB_USER?: string;

    /**
     * Пароль для подключения к базе данных
     *
     * @remarks
     * Рекомендуется использовать сложные пароли
     * и хранить их в безопасном месте
     *
     * @example
     * ```ts
     * DB_PASSWORD=my_secure_password
     * ```
     */
    DB_PASSWORD?: string;

    /**
     * Название базы данных
     *
     * @example
     * ```ts
     * DB_NAME=myapp
     * ```
     */
    DB_NAME?: string;
}

/**
 * Статус загрузки конфигурации
 */
export interface IEnvConfigStatus {
    /**
     * Флаг успешности загрузки
     */
    status: boolean;
    /**
     * Ошибка загрузки
     */
    error?: string;
    /**
     * Данные конфигурации
     */
    data?: IEnvConfig;
}

/**
 * Загружает переменные окружения из файла .env
 *
 * @param {string} envPath - Путь к файлу .env
 * @returns {IEnvConfigStatus} Результат загрузки со статусом и данными
 *
 * @remarks
 * Функция:
 * - Читает файл .env
 * - Парсит строки формата KEY=VALUE
 * - Игнорирует пустые строки и комментарии
 * - Удаляет кавычки из значений
 *
 * @example
 * ```ts
 * // Загрузка конфигурации
 * const result = loadEnvFile('.env');
 *
 * // Использование значений
 * if (result.status) {
 *   const telegramToken = result.data?.TELEGRAM_TOKEN;
 *   const dbHost = result.data?.DB_HOST;
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export function loadEnvFile(envPath: string): IEnvConfigStatus {
    const fileData = freadSync(path.resolve(envPath));
    if (fileData.success) {
        const envContent = fileData.data as string;
        const envVars: IEnvConfig = {};

        envContent.split('\n').forEach((line) => {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const [key, ...valueParts] = trimmedLine.split('=');
                let value = valueParts.join('=').trim();
                // Убираем inline comments, но только если `#` начинается с пробела
                // (конвенция dotenv): в `DB_PASSWORD=pass#word` решётка — часть
                // значения, а не комментарий.
                const commentMatch = value.match(/(?:^|\s)#/);
                if (commentMatch && commentMatch.index !== undefined) {
                    // Проверяем, что # не внутри кавычек
                    const beforeComment = value.substring(0, commentMatch.index);
                    const singleQuotes = (beforeComment.match(/'/g) || []).length;
                    const doubleQuotes = (beforeComment.match(/"/g) || []).length;
                    if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
                        value = beforeComment.trim();
                    }
                }
                if (key && value) {
                    envVars[key.trim() as keyof IEnvConfig] = value.replace(/^["']|["']$/g, '');
                }
            }
        });

        return { status: true, data: envVars };
    } else {
        return {
            status: false,
            error: `Error loading .env file: ${fileData.error || 'Unknown error'}`,
        };
    }
}
