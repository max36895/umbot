import { IButtonType, getButton, getLinkButton } from './Button';
import { IButtonOptions } from './interfaces/IButton';
import { AppContext, TButtonProcessing } from '../../core';

/**
 * Дополнительные данные для кнопки
 */
export type TButtonPayload = Record<string, unknown> | string;

/**
 * Префикс группы, которую {@link Buttons.row} назначает кнопкам одного ряда
 * (`options._group`). Адаптеры чат-платформ выводят кнопки одной группы в одну строку.
 */
const BUTTON_ROW_GROUP_PREFIX = '__umbot_row_';

/**
 * @class Buttons
 * Класс для управления коллекцией кнопок и их отображением на различных платформах.
 *
 * Класс предоставляет функциональность для:
 * - Создания и управления коллекцией кнопок
 * - Адаптации кнопок под различные платформы
 * - Поддержки различных типов кнопок (интерактивные, ссылки)
 *
 * @group Ответ пользователю
 */
export class Buttons {
    /**
     * Значение флага `hide` для кнопки-ссылки (саджеста): `false`.
     */
    public static readonly B_LINK: boolean = false;

    /**
     * Значение флага `hide` для интерактивной кнопки: `true`.
     */
    public static readonly B_BTN: boolean = true;
    /**
     * Массив объектов IButtonType, представляющих все кнопки в коллекции.
     * @see IButtonType
     */
    public buttons: IButtonType[];

    /**
     * Контекст приложения
     */
    #appContext: AppContext;

    /**
     * Признак того, что разработчик явно попросил убрать клавиатуру.
     */
    #isRemove: boolean = false;

    /**
     * Номер текущего ряда для {@link row}; -1 — row() не вызывался, раскладка прежняя
     * (каждая кнопка — отдельной строкой).
     */
    #rowIndex: number = -1;

    /**
     * Создает новый экземпляр коллекции кнопок: инициализирует пустой массив
     * кнопок и сохраняет контекст приложения.
     * @param appContext Контекст приложения. Обычно не создаётся вручную —
     * передаётся через контроллер (`this.buttons.addBtn('caption')`).
     */
    public constructor(appContext: AppContext) {
        this.buttons = [];
        this.#appContext = appContext;
    }

    /**
     * Устанавливает контекст приложения.
     * @param {AppContext} appContext - Контекст приложения
     * @returns {this} Текущий экземпляр для цепочки вызовов
     */
    public setAppContext(appContext: AppContext): this {
        this.#appContext = appContext;
        return this;
    }

    /**
     * Очищает массив кнопок.
     *
     * Это именно «начать список заново», а не «убрать клавиатуру у пользователя»:
     * пустой список кнопок платформе не отправляется. Чтобы снять уже показанную
     * клавиатуру, используйте {@link remove}.
     * @returns {void}
     */
    public clear(): void {
        this.buttons = [];
        this.#isRemove = false;
        this.#rowIndex = -1;
    }

    /**
     * Просит платформу убрать ранее показанную клавиатуру.
     *
     * Актуально только для платформ, где клавиатура «прилипает» к диалогу и
     * живёт до следующего явного изменения — Telegram (reply-клавиатура) и VK.
     * У остальных клавиатура привязана к конкретному сообщению и исчезает сама,
     * там вызов ничего не меняет. {@link clear} для этого не подходит: пустой
     * список кнопок платформе не отправляется.
     *
     * @returns {Buttons}
     *
     * @example
     * ```ts
     * // Диалог закончился — убираем клавиатуру
     * ctx.buttons.remove();
     * ctx.text = 'Спасибо, заказ оформлен!';
     * ```
     */
    public remove(): this {
        this.buttons = [];
        this.#isRemove = true;
        this.#rowIndex = -1;
        return this;
    }

    /**
     * Завершает текущий ряд кнопок: следующие кнопки пойдут в новую строку.
     *
     * Кнопки, добавленные до первого вызова, образуют первый ряд. Без вызова row()
     * раскладка прежняя — каждая кнопка отдельной строкой. Ряд учитывают чат-платформы
     * (Telegram, VK, MAX, Viber); если в ряду больше кнопок, чем разрешает платформа,
     * лишние переносятся на следующую строку с предупреждением в лог. Голосовые
     * платформы (Алиса, Маруся, SmartApp) раскладку кнопок не поддерживают — у них
     * ряд ни на что не влияет.
     *
     * Технически ряд — это общая группа `options._group`: кнопки, у которых группа
     * задана явно, её сохраняют.
     *
     * @returns {Buttons}
     *
     * @example
     * ```ts
     * ctx.buttons
     *     .addBtn('Да')
     *     .addBtn('Нет')
     *     .row()
     *     .addBtn('Помощь');
     * // Telegram/VK/MAX/Viber: [Да] [Нет]
     * //                        [Помощь]
     * ```
     */
    public row(): this {
        if (this.#rowIndex < 0) {
            this.#rowIndex = 0;
            for (let i = 0; i < this.buttons.length; i++) {
                this.#assignRow(this.buttons[i] as IButtonType);
            }
        }
        this.#rowIndex++;
        return this;
    }

    /**
     * Назначает кнопке текущий ряд, если группа не задана явно.
     * Опции копируются: один объект options может быть общим у нескольких кнопок.
     * @param button Кнопка
     */
    #assignRow(button: IButtonType): void {
        if (button.options?._group === undefined) {
            button.options = {
                ...button.options,
                _group: `${BUTTON_ROW_GROUP_PREFIX}${this.#rowIndex}`,
            };
        }
    }

    /**
     * Признак того, что клавиатуру нужно убрать (см. {@link remove}).
     */
    public get isRemove(): boolean {
        return this.#isRemove;
    }

    /**
     * Добавляет кнопку в коллекцию.
     *
     * @param {string | null} title - Текст кнопки
     * @param {string | null} url - URL для перехода
     * @param {TButtonPayload} payload - Дополнительные данные
     * @param {boolean} hide - Тип отображения кнопки
     * @param {IButtonOptions} options - Дополнительные параметры
     * @returns {Buttons}
     */
    #add(
        title: string | null,
        url: string | null,
        payload: TButtonPayload,
        hide: boolean = false,
        options: IButtonOptions = {},
    ): this {
        // Добавили кнопку — значит клавиатуру показываем, а не убираем.
        this.#isRemove = false;
        const button =
            hide === Buttons.B_LINK
                ? getLinkButton(this.#appContext, title, url, payload, options)
                : getButton(this.#appContext, title, url, payload, options);
        if (button) {
            if (this.#rowIndex >= 0) {
                this.#assignRow(button);
            }
            this.buttons.push(button);
        }
        return this;
    }

    /**
     * Добавляет интерактивную кнопку в коллекцию.
     *
     * @param {string | null} title - Текст кнопки
     * @param {string | null} [url=''] - URL для перехода
     * @param {TButtonPayload} [payload=''] - Дополнительные данные
     * @param {IButtonOptions} [options={}] - Дополнительные параметры
     * @returns {Buttons}
     * @remarks Кнопка с пустым `title` молча игнорируется (не добавляется в коллекцию).
     *
     * @example
     * ```ts
     * // Простая кнопка
     * buttons.addBtn('Нажми меня');
     *
     * // Кнопка с URL и payload
     * buttons.addBtn('Перейти', 'http://localhost', { action: 'navigate' });
     * ```
     */
    public addBtn(
        title: string | null,
        url: string | null = '',
        payload: TButtonPayload = '',
        options: IButtonOptions = {},
    ): this {
        return this.#add(title, url, payload, Buttons.B_BTN, options);
    }

    /**
     * Добавляет кнопку-ссылку в коллекцию.
     *
     * @param {string | null} title - Текст кнопки
     * @param {string | null} [url=''] - URL для перехода
     * @param {TButtonPayload} [payload=''] - Дополнительные данные
     * @param {IButtonOptions} [options={}] - Дополнительные параметры
     * @returns {Buttons}
     *
     * @example
     * ```ts
     * // Простая ссылка
     * buttons.addLink('Перейти на сайт', 'http://localhost');
     *
     * // Ссылка с payload
     * buttons.addLink('Документация', 'http://localhost', { section: 'api' });
     * ```
     */
    public addLink(
        title: string | null,
        url: string = '',
        payload: TButtonPayload = '',
        options: IButtonOptions = {},
    ): this {
        return this.#add(title, url, payload, Buttons.B_LINK, options);
    }

    /**
     * Возвращает кнопки в формате указанной платформы.
     *
     * Метод сам не преобразует кнопки: он передаёт массив во внешнюю функцию
     * `buttonProcessing` (её предоставляет адаптер платформы) и возвращает её результат.
     *
     * @param {TButtonProcessing<T | null, TType>} buttonProcessing - Функция обработки кнопок для платформы
     * @returns {T | null} Результат функции обработки (формат зависит от платформы) или null
     */
    public getButtons<T = unknown, TType = Record<string, unknown> | string | null>(
        buttonProcessing: TButtonProcessing<T | null, TType>,
    ): T | null {
        return buttonProcessing(this.buttons as IButtonType<TType>[]);
    }

    /**
     * Возвращает JSON-представление кнопок для указанной платформы.
     *
     * @param {TButtonProcessing} buttonProcessing - Функция обработки кнопок для платформы
     * @returns {string | null} JSON-строка кнопок или null если кнопок нет
     */
    public getButtonJson<T = unknown, TType = Record<string, unknown> | string | null>(
        buttonProcessing: TButtonProcessing<T | null, TType>,
    ): string | null {
        const btn = this.getButtons(buttonProcessing);
        if (btn != null) {
            return JSON.stringify(btn);
        }
        return null;
    }
}
