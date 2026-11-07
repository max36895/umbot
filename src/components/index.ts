/**
 * Компоненты представляют собой модульную систему для работы с различными аспектами приложения.
 * Они разделяются на две основные категории:
 *
 * 1. **Системные компоненты** - отвечают за базовую функциональность приложения:
 *    - Отображение карточек
 *    - Работа с изображениями
 *    - Управление кнопками
 *    - Воспроизведение звуков
 *    - Обработка NLU (Natural Language Understanding)
 *
 * 2. **Дополнительные компоненты** - предоставляют расширенную функциональность:
 *    - Навигация по меню (Navigation)
 *
 * > **Важно**: Системные компоненты рекомендуется использовать только через BotController.
 *
 * ## Дополнительные компоненты
 *
 * Дополнительные компоненты разработаны для упрощения разработки и расширения возможностей вашего приложения.
 *
 * ### Navigation
 *
 * Класс для управления навигацией по элементам меню. Особенно полезен при работе с большими списками элементов,
 * где требуется постраничная навигация и обработка выбора пользователя.
 *
 * #### Основные возможности:
 * - Постраничная навигация по элементам
 * - Определение выбранного элемента
 * - Поддержка различных типов данных через дженерики
 * - Гибкая настройка количества отображаемых элементов
 *
 * #### Примеры использования
 *
 * 1. **Стандартная навигация**
 * ```ts
 * import { Navigation } from 'umbot';
 *
 * const elements: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
 * const maxVisibleElements: number = 5;
 * const nav = new Navigation<number>(maxVisibleElements);
 *
 * // Получение элементов для первой страницы
 * const showElements: number[] = nav.getPageElements(elements);
 * console.log(showElements); // -> [1, 2, 3, 4, 5]
 * ```
 *
 * 2. **Навигация с командами**
 * ```ts
 * import { Navigation } from 'umbot';
 *
 * const elements: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
 * const maxVisibleElements: number = 5;
 * const nav = new Navigation<number>(maxVisibleElements);
 *
 * // Навигация вперед (текст — в нижнем регистре, как controller.userCommand)
 * let showElements = nav.getPageElements(elements, 'дальше');
 * console.log(showElements); // -> [6, 7, 8, 9, 0]
 *
 * // Навигация назад (регистр важен: сравнение чувствительно к регистру)
 * showElements = nav.getPageElements(elements, 'назад');
 * console.log(showElements); // -> [1, 2, 3, 4, 5]
 * ```
 *
 * 3. **Управление текущей страницей**
 * ```ts
 * import { Navigation } from 'umbot';
 *
 * const elements = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
 * const maxVisibleElements = 5;
 * const nav = new Navigation<number>(maxVisibleElements);
 *
 * // Установка текущей страницы
 * nav.thisPage = 1;
 *
 * // Проверка границ навигации
 * let showElements = nav.getPageElements(elements, 'дальше');
 * console.log(nav.thisPage); // -> 1 (не выходит за пределы)
 *
 * showElements = nav.getPageElements(elements, 'назад');
 * console.log(nav.thisPage); // -> 0
 * ```
 *
 * 4. **Выбор элемента из списка**
 * ```ts
 * import { Navigation } from 'umbot';
 *
 * const elements = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
 * const maxVisibleElements = 5;
 * const nav = new Navigation<number>(maxVisibleElements);
 *
 * // Выбор элемента на текущей странице
 * nav.thisPage = 1;
 * let selectedElement = nav.selectedElement(elements, '1');
 * console.log(selectedElement); // -> 6
 * ```
 *
 * 5. **Работа с объектами**
 * ```ts
 * import { Navigation } from 'umbot';
 *
 * interface MenuItem {
 *     title: string;
 *     desc: string;
 * }
 *
 * const elements: MenuItem[] = [
 *     { title: 'title 1', desc: 'desc 1' },
 *     { title: 'title 2', desc: 'desc 2' },
 *     { title: 'title 3', desc: 'desc 3' },
 *     { title: 'title 4', desc: 'desc 4' }
 * ];
 *
 * const maxVisibleElements = 2;
 * const nav = new Navigation<MenuItem>(maxVisibleElements);
 *
 * // Поиск по свойству объекта
 * let selectedElement = nav.selectedElement(elements, 'title 1', 'title');
 * console.log(selectedElement); // -> { title: 'title 1', desc: 'desc 1' }
 * ```
 *
 * ## Системные компоненты
 *
 * Системные компоненты обеспечивают базовую функциональность приложения и доступны через BotController.
 *
 * ### Доступные компоненты:
 *
 * - **Кнопки** (`./button`) - управление интерактивными элементами
 * - **Карточки** (`./card`) - отображение структурированной информации
 * - **Изображения** (`./image`) - работа с графическим контентом
 * - **NLU** (`./nlu`) - обработка естественного языка
 * - **Звуки** (`./sound`) - управление аудио контентом
 *
 * > **Примечание**: Для использования системных компонентов рекомендуется обращаться к соответствующим
 * > методам BotController, которые обеспечивают правильную интеграцию с платформами.
 */

export { Buttons, getButton, getLinkButton } from './button';
export type {
    IButton,
    IButtonOptions,
    IButtonType,
    TBtnPayload,
    TButton,
    TButtonPayload,
} from './button';
export { Card } from './card';
export { getImage, initButton } from './image/Image';
export type { IImageParams, IImageType } from './image/Image';
export { Nlu } from './nlu';
export type {
    IBaseEntities,
    IBaseNlu,
    INlu,
    INluDateTime,
    INluFIO,
    INluGeo,
    INluIntent,
    INluIntents,
    INluResult,
    INluSlot,
    INluThisUser,
} from './nlu';
export { Sound, SoundConstants } from './sound';
export type { IEffect, ISound } from './sound';
export { Navigation } from './standard';
export type { TElementType, TKeys } from './standard';
