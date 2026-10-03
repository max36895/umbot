/**
 * Модуль утилит - набор вспомогательных инструментов для разработки
 *
 * Модуль содержит:
 * - Утилиты для работы с текстом
 * - Стандартные утилиты для работы с данными
 * - Безопасную компиляцию регулярных выражений
 *
 * ### Text
 * Класс для работы с текстом, предоставляющий статические методы для:
 * - Обрезки текста
 * - Поиска вхождений
 * - Проверки схожести текстов
 * - Работы с окончаниями слов
 *
 * #### Обрезка текста
 * ```ts
 * import { Text } from './standard/Text';
 *
 * const text = 'testing long long text';
 *
 * // Обрезка с троеточием
 * Text.resize(text, 7); // -> 'test...'
 *
 * // Обрезка без троеточия
 * Text.resize(text, 7, false); // -> 'testing'
 * ```
 *
 * #### Поиск вхождений
 * Метод для поиска подстроки или массива подстрок в тексте
 * ```ts
 * import { Text } from './standard/Text';
 *
 * const text = 'testing long long text';
 *
 * // Поиск одной подстроки
 * Text.isSayText('test', text); // -> true
 *
 * // Поиск одной из подстрок
 * Text.isSayText(['long', 'test'], text); // -> true
 *
 * // Поиск по регулярному выражению
 * // При передаче строки в JavaScript нужно экранировать обратный слеш:
 * // '\b' в строке = один символ (backspace), '\\b' = два символа (\ + b)
 * Text.isSayText(['and', '\\btext\\b'], text, true); // -> true
 * ```
 *
 * #### Проверка схожести текстов
 * Метод для определения степени схожести двух текстов
 * ```ts
 * import { Text } from './standard/Text';
 *
 * // Тексты совпадают на 100%
 * Text.textSimilarity('test', 'test', 90);
 * // -> {
 * //   percent: 100,
 * //   index: 0,
 * //   status: true,
 * //   text: 'test'
 * // }
 *
 * // Тексты не совпадают (LCS = 1 символ — 25% схожести)
 * Text.textSimilarity('test', 'demo', 90);
 * // -> {
 * //   percent: 25,
 * //   index: 0,
 * //   status: false,
 * //   text: 'demo'
 * // }
 * ```
 *
 * #### Работа с окончаниями слов
 * Метод для выбора правильного окончания слова в зависимости от числа
 * ```ts
 * import { Text } from './standard/Text';
 *
 * const titles = [
 *   'Яблоко',  // 1
 *   'Яблока',  // 2-4
 *   'Яблок'    // 5-20
 * ];
 *
 * Text.getEnding(1, titles);    // -> 'Яблоко'
 * Text.getEnding(2, titles);    // -> 'Яблока'
 * Text.getEnding(10, titles);   // -> 'Яблок'
 *
 * // Принудительный выбор формы
 * Text.getEnding(10, titles, 0); // -> 'Яблоко'
 * ```
 */
export * from './standard/util';
export * from './standard/Text';
export * from './standard/RegExp';
export * from './isPromise';
export * from './EnvConfig';
