import { ISound } from './interfaces';
import { TSoundProcessing } from '../../core';
import { BotController } from '../../controller';
import { isPromise } from '../../utils/isPromise';

const regReplace = /((?:^|\s)#\w+#(?:\s|$))/g;

/**
 * @class Sound
 * Класс для обработки и воспроизведения звуков в различных платформах.
 *
 * Основные возможности:
 * - Поддержка различных платформ (Алиса, Маруся, VK, Telegram, Viber)
 * - Использование стандартных и пользовательских звуков
 * - Встраивание звуков в текстовые сообщения
 * - Гибкая настройка звукового сопровождения
 *
 * Ограничения по платформам:
 *
 * Алиса:
 * - Аудиофайлы: MP3, до 1MB
 * - Длительность: до 30 секунд
 * - Стандартные звуки: <speaker audio="alice-xxx">
 * - Синтез речи: SSML-разметка
 *
 * Маруся:
 * - Аудиофайлы: MP3, до 1MB
 * - Длительность: до 30 секунд
 * - Стандартные звуки: <speaker audio="marusia-xxx">
 * - Синтез речи: SSML-разметка
 *
 * VK:
 * - Аудиофайлы: MP3, OGG, до 20MB
 * - Длительность: до 5 минут
 * - Голосовые сообщения: OGG (opus)
 *
 * Telegram:
 * - Аудиофайлы: MP3, M4A, до 50MB
 * - Длительность: без ограничений
 * - Голосовые сообщения: OGG (opus)
 *
 * Viber:
 * - Аудиофайлы: MP3, WAV, до 10MB
 * - Длительность: до 3 минут
 *
 * @example
 * ```ts
 * import { Sound } from 'umbot';
 *
 * // Создание экземпляра
 * const sound = new Sound();
 *
 * // Использование своих звуков
 * sound.sounds = [
 *     // Звук колокольчика
 *     {
 *         key: '#myKey#',
 *         sounds: ['<speaker audio="alice-xxx">']
 *     },
 * ];
 * // Получение текста со звуками (text, soundProcessing, controller)
 * const result = await sound.getSounds('Текст сообщения #myKey#', mySoundProcessing, controller);
 * ```
 *
 * @group Ответ пользователю
 */
export class Sound {
    /**
     * Массив звуков для воспроизведения.
     * Каждый элемент массива представляет собой объект с параметрами звука.
     */
    public sounds: ISound[];

    /**
     * Флаг использования стандартных звуков.
     * Если true, используются стандартные звуки платформы.
     * Актуально для Алисы и Маруси.
     *
     * @default true
     * @example
     * ```ts
     * // Использовать стандартные звуки
     * sound.isUsedStandardSound = true;
     *
     * // Использовать только пользовательские звуки
     * sound.isUsedStandardSound = false;
     * ```
     */
    public isUsedStandardSound: boolean;

    /**
     * Конструктор класса Sound.
     * Инициализирует пустой массив звуков и включает использование стандартных звуков.
     */
    public constructor() {
        this.sounds = [];
        this.isUsedStandardSound = true;
    }

    /**
     * Получает текст с встроенными звуками для конкретной платформы.
     *
     * Процесс работы:
     * 1. Если текст пуст — возвращает пустую строку
     * 2. Передаёт { text, usedStandardSound, sounds } и контроллер
     *    в обработчик `soundProcessing` (его предоставляет адаптер платформы)
     * 3. Если результат — строка, вырезает оставшиеся плейсхолдеры вида #key#
     *
     * @param {string | null} text - Исходный текст для обработки
     * @param {TSoundProcessing<TResult>} soundProcessing - Функция обработки звуков для платформы
     * @param {BotController} controller - Контроллер бота
     * @returns {Promise<TResult>} Текст со встроенными звуками для платформы;
     *   при falsy-результате soundProcessing (null/undefined/'') — исходный текст без изменений
     */
    public async getSounds<TResult = unknown>(
        text: string | null,
        soundProcessing: TSoundProcessing<TResult>,
        controller: BotController,
    ): Promise<TResult> {
        if (!text) {
            return '' as TResult;
        }
        const res = soundProcessing(
            {
                text,
                usedStandardSound: this.isUsedStandardSound,
                sounds: this.sounds,
            },
            controller,
        );
        if (res) {
            let stringRes;
            if (isPromise(res)) {
                stringRes = await res;
            } else {
                stringRes = res;
            }
            if (typeof stringRes === 'string') {
                return (
                    stringRes.includes('#') ? stringRes.replace(regReplace, ' ').trim() : stringRes
                ) as TResult;
            }
            return stringRes;
        }
        return text as TResult;
    }
}
