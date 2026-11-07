/**
 * Стандартные компоненты для работы с текстом и навигацией.
 *
 * Основные компоненты:
 * - Navigation: Класс для навигации по элементам меню или списка
 *   - Поддержка постраничной навигации
 *   - Поиск элементов по тексту или номеру
 *   - Управление отображением элементов
 *   - Обработка команд навигации
 *
 * @example
 * ```ts
 * import { Navigation } from 'umbot';
 *
 * // Создание экземпляра Navigation
 * const navigation = new Navigation<{id: number, name: string}>(3);
 *
 * // Использование навигации
 * const elements = [
 *   { id: 1, name: 'Элемент 1' },
 *   { id: 2, name: 'Элемент 2' },
 *   { id: 3, name: 'Элемент 3' }
 * ];
 *
 * // Получение элементов текущей страницы
 * const pageElements = navigation.getPageElements(elements);
 * ```
 */
export { Navigation } from './Navigation';
export type { TElementType, TKeys } from './Navigation';
