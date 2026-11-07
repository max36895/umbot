/**
 * Модуль вспомогательных утилит
 *
 * Предоставляет набор утилит для:
 * - Работы с файловой системой
 * - Обработки текста
 * - Работы с HTTP-параметрами
 * - Взаимодействия с консолью
 */
import * as fs from 'fs';
// Импорт fs/promises — легитимная работа с файловой системой (чтение/запись конфигов, логов, загрузок).
import * as fsPromises from 'fs/promises';
import * as readline from 'readline';
import { TLoggerCb } from '../../core/interfaces/ILogger';
import { IDir } from '../../core/interfaces/IAppContext';
import { join } from 'node:path';

/**
 * Безопасная сериализация объекта в JSON-строку.
 * При ошибке (циклические ссылки, несериализуемые объекты) возвращает строковое представление.
 * Используется в логировании для защиты от падения JSON.stringify.
 *
 * @param data - Данные для сериализации
 * @param replacer - Функция замены (по умолчанию null)
 * @param space - Отступы для форматирования; не задан — без отступов (как JSON.stringify)
 * @returns JSON-строка или строковое представление данных
 *
 * @example
 * ```ts
 * const result = safeStringify({ a: 1, b: { c: 2 } }, null, '\t');
 * const circular = safeStringify({ a: circularRef }); // не бросает исключение
 * ```
 */
export function safeStringify(
    data: unknown,
    replacer?: ((key: string, value: unknown) => unknown) | null,
    space?: string,
): string {
    try {
        return JSON.stringify(data, replacer ?? undefined, space);
    } catch {
        return String(data);
    }
}

/**
 * Интерфейс для GET-параметров
 *
 * @example
 * ```ts
 * const params: IGetParams = {
 *   name: 'John',
 *   age: '25'
 * };
 * ```
 */
export interface IGetParams {
    [key: string]: string;
}

/**
 * Возвращает случайное число из заданного диапазона
 *
 * @param {number} min - Минимальное значение диапазона (включительно)
 * @param {number} max - Максимальное значение диапазона (включительно)
 * @returns {number} Случайное целое число из диапазона [min, max]
 *
 * @example
 * ```ts
 * rand(1, 10); // -> случайное число от 1 до 10
 * rand(0, 1); // -> 0 или 1
 * ```
 */
export function rand(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Метод, возвращающий количество ключей в объекте
 * @param {object | Record<string, unknown>} obj - Объект для подсчёта ключей
 * @returns {number} Количество ключей в объекте
 */
export function keysCount(obj: object | Record<string, unknown>): number {
    // Такой вариант быстрее Object.keys, но до тех пор, пока не был delete.
    let count = 0;
    for (const _ in obj) {
        count++;
    }
    return count;
}

/**
 * Максимальная суммарная длина сравниваемых строк.
 * Ограничивает алгоритм LCS (O(n·m)) от блокировки event loop
 * на очень длинных пользовательских входах или больших словарях.
 */
const MAX_SIMILAR_TEXT_TOTAL_LENGTH = 2000;

/**
 * Размер окна сравнения для длинных строк (в символах).
 */
const SIMILAR_SAMPLE_WINDOW = 32;

/**
 * Количество окон, равномерно распределённых по длине строки при сравнении длинных текстов.
 */
const SIMILAR_SAMPLE_COUNT = 8;

/**
 * Вычисляет процент схожести двух текстов
 * При суммарной длине строк до 2000 символов использует алгоритм LCS
 * (Longest Common Subsequence); свыше — дешёвую эвристику окон
 * (сравнение нескольких равномерно распределённых участков строк)
 *
 * @param {string} first - Первый текст для сравнения
 * @param {string} second - Второй текст для сравнения
 * @returns {number} Процент схожести от 0 до 100
 *
 * @example
 * ```ts
 * similarText('привет', 'привт'); // -> ~91
 * similarText('hello', 'world'); // -> 20
 * similarText('same', 'same'); // -> 100
 * ```
 */
export function similarText(first: string, second: string): number {
    if (first === second || (first.length === 0 && second.length === 0)) {
        return 100;
    }
    if (first.length === 0 || second.length === 0) {
        return 0;
    }

    // Защита от O(n·m) DoS при очень длинных строках.
    // Для типичных сценариев (максимум 30-50 символов в команде) лимит не достигается.
    if (first.length + second.length > MAX_SIMILAR_TEXT_TOTAL_LENGTH) {
        // Для длинных строк используем дешёвую эвристику, чтобы не грузить
        // event loop на квадратичном DP.
        const lengthDiff = Math.abs(first.length - second.length);
        const maxLen = Math.max(first.length, second.length);
        if (lengthDiff / maxLen > 0.5) {
            return 0;
        }
        // Сравниваем несколько окон, равномерно распределённых по всей длине
        // (начало, середину и конец), а не только префикс. Иначе полностью
        // несовпадающие хвосты давали бы 100% схожесть при равных длинах.
        const minLen = Math.min(first.length, second.length);
        const window = Math.min(SIMILAR_SAMPLE_WINDOW, minLen);
        const lastPos = Math.max(0, minLen - window);
        let matched = 0;
        for (let i = 0; i < SIMILAR_SAMPLE_COUNT; i++) {
            const start = Math.round((lastPos * i) / (SIMILAR_SAMPLE_COUNT - 1));
            if (first.slice(start, start + window) === second.slice(start, start + window)) {
                matched++;
            }
        }
        if (matched === 0) {
            return 0;
        }
        const sampleRatio = matched / SIMILAR_SAMPLE_COUNT;
        const lengthRatio = (maxLen - lengthDiff) / maxLen;
        return Math.round(sampleRatio * lengthRatio * 100);
    }

    // Вычисление длины LCS (Longest Common Subsequence) методом динамического программирования
    const lcsLength = (shorter: string, longer: string): number => {
        const dp = new Int32Array(longer.length + 1);
        dp.fill(0, 0, longer.length + 1);

        for (let i = 0; i < shorter.length; i++) {
            let prevDiag = 0;
            for (let j = 0; j < longer.length; j++) {
                const current = dp[j + 1] ?? 0;
                dp[j + 1] =
                    shorter.charAt(i) === longer.charAt(j)
                        ? prevDiag + 1
                        : Math.max(dp[j + 1] ?? 0, dp[j] ?? 0);
                prevDiag = current;
            }
        }

        return dp[longer.length] ?? 0;
    };

    // Гарантируем, что короткая строка идёт первой для оптимизации
    const [a, b] = first.length <= second.length ? [first, second] : [second, first];
    const totalLength = first.length + second.length;

    return (lcsLength(a, b) * 200) / totalLength;
}

/**
 * Удаляет из текста теги вида `<...>` (HTML, SSML, `<speaker ...>`),
 * заменяя каждый на `replacement`.
 *
 * Результат совпадает с `text.replace(/<[^>]*>/g, replacement)`, но работает
 * за линейное время: регулярка на строке вида `<<<<…` без закрывающей `>`
 * от каждой `<` просматривает остаток строки — O(n²) на пользовательском вводе.
 * Функция предназначена для получения простого текста, а не для санитизации
 * HTML: одиночная `<` без закрывающей `>` остаётся в тексте как есть.
 *
 * @param {string} text - Исходный текст
 * @param {string} [replacement=''] - Чем заменить каждый тег
 * @returns {string} Текст без тегов
 *
 * @example
 * ```ts
 * stripTags('<b>Привет</b>, мир'); // -> 'Привет, мир'
 * stripTags('x < y'); // -> 'x < y'
 * ```
 */
export function stripTags(text: string, replacement: string = ''): string {
    let lt = text.indexOf('<');
    if (lt === -1) {
        return text;
    }
    let result = '';
    let pos = 0;
    while (lt !== -1) {
        const gt = text.indexOf('>', lt + 1);
        // Закрывающей «>» дальше нет — ни одна последующая «<» тоже не станет тегом.
        if (gt === -1) {
            break;
        }
        result += text.slice(pos, lt) + replacement;
        pos = gt + 1;
        lt = text.indexOf('<', pos);
    }
    return result + text.slice(pos);
}

/**
 * Результат выполнения операции с файлом
 *
 * @template T - Тип данных, возвращаемых при успешной операции
 *
 * @example
 * ```ts
 * const result: FileOperationResult<string> = {
 *   success: true,
 *   data: 'file content'
 * };
 *
 * const error: FileOperationResult<void> = {
 *   success: false,
 *   error: new Error('File not found')
 * };
 * ```
 */
export interface FileOperationResult<T> {
    /**
     * Флаг успешности операции
     * true - операция выполнена успешно
     * false - произошла ошибка
     */
    success: boolean;

    /**
     * Данные, полученные в результате операции.
     * Присутствует только при success = true
     */
    data?: T;

    /**
     * Ошибка, возникшая при выполнении операции.
     * Присутствует только при success = false
     */
    error?: Error;
}

/**
 * Быстрая проверка, похож ли текст на имя файла
 * @param str Проверяемая строка
 */
function looksLikeFilePath(str: string): boolean {
    const i = str.lastIndexOf('.');
    return (
        i > 0 && // есть точка, и не в начале
        i < str.length - 1 && // не в конце
        str.length - i <= 6 && // расширение ≤5 символов (".js", ".json" и т.п.)
        /^\w+$/.test(str.slice(i + 1)) // расширение — только словесные символы
    );
}

/**
 * Синхронно проверяет существование файла
 *
 * Путь должен выглядеть как файл: точка не в начале/конце, расширение
 * до 5 символов из словесных символов. Путь без расширения (или похожий
 * на директорию) вернёт false без обращения к файловой системе.
 *
 * @param {string} file - Путь к проверяемому файлу
 * @returns {boolean} true, если файл существует и это файл, иначе false
 *
 * @example
 * ```ts
 * isFileSync('path/to/file.txt'); // -> true
 * isFileSync('path/to/directory'); // -> false (не похоже на файл)
 * isFileSync('nonexistent.txt'); // -> false
 * ```
 */
export function isFileSync(file: string): boolean {
    // Строка должна выглядеть как путь к файлу: точка не в начале/конце,
    // расширение до 5 символов из словесных символов (looksLikeFilePath)
    if (looksLikeFilePath(file)) {
        const fileInfo = getFileInfoSync(file);
        return !!(fileInfo.success && fileInfo.data?.isFile());
    }
    return false;
}

/**
 * Синхронно возвращает информацию о файле
 *
 * @param {string} fileName - Путь к файлу
 * @returns {FileOperationResult<fs.Stats>} Результат операции с информацией о файле
 *
 * @example
 * ```ts
 * const result = getFileInfoSync('file.txt');
 * if (result.success) {
 *   console.log(result.data.size); // размер файла
 *   console.log(result.data.mtime); // время последнего изменения
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export function getFileInfoSync(fileName: string): FileOperationResult<fs.Stats> {
    try {
        const stats = fs.lstatSync(fileName);
        return { success: true, data: stats };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error : new Error('Unknown error'),
        };
    }
}

/**
 * Синхронно читает содержимое файла
 *
 * @param {string} fileName - Путь к файлу
 * @returns {FileOperationResult<string>} Результат операции с содержимым файла
 *
 * @example
 * ```ts
 * const result = freadSync('file.txt');
 * if (result.success) {
 *   console.log(result.data); // содержимое файла
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export function freadSync(fileName: string): FileOperationResult<string> {
    try {
        const content = fs.readFileSync(fileName, 'utf-8');
        return { success: true, data: content };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error : new Error('Failed to read file'),
        };
    }
}

/**
 * Синхронно записывает данные в файл
 *
 * @param {string} fileName - Путь к файлу
 * @param {string | Uint8Array} fileContent - Содержимое для записи
 * @param {'w' | 'a'} [mode='w'] - Режим записи:
 *   - 'w' - перезапись файла
 *   - 'a' - добавление в конец файла
 * @returns {FileOperationResult<void>} Результат операции записи
 *
 * @example
 * ```ts
 * // Перезапись файла
 * fwriteSync('file.txt', 'new content');
 *
 * // Добавление в конец файла
 * fwriteSync('file.txt', 'additional content', 'a');
 * ```
 */
export function fwriteSync(
    fileName: string,
    fileContent: string | Uint8Array,
    mode: 'w' | 'a' | string = 'w',
): FileOperationResult<void> {
    // Уникальный tmp-суффикс защищает от race condition при параллельной записи
    // одного и того же файла из разных частей кода (или процессов).
    // Без него два writer'а используют один tmp-файл и данные чередуются.
    const tmpPath =
        mode === 'w'
            ? `${fileName}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 9)}.tmp`
            : undefined;
    try {
        if (mode === 'w') {
            fs.writeFileSync(tmpPath!, fileContent);
            fs.renameSync(tmpPath!, fileName);
        } else {
            fs.appendFileSync(fileName, fileContent);
        }
        return { success: true };
    } catch (error) {
        // Удаляем осиротевший tmp-файл при ошибке
        if (tmpPath) {
            try {
                fs.unlinkSync(tmpPath);
            } catch {
                // Игнорируем ошибку удаления tmp файла
            }
        }
        return {
            success: false,
            error: error instanceof Error ? error : new Error('Failed to write file'),
        };
    }
}

/**
 * Синхронно удаляет файл
 *
 * @param {string} fileName - Путь к файлу
 * @returns {FileOperationResult<void>} Результат операции удаления
 *
 * @example
 * ```ts
 * const result = unlinkSync('file.txt');
 * if (result.success) {
 *   console.log('Файл успешно удалён');
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export function unlinkSync(fileName: string): FileOperationResult<void> {
    try {
        fs.unlinkSync(fileName);
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error : new Error('Failed to delete file'),
        };
    }
}

/**
 * Синхронно проверяет существование пути в файловой системе
 *
 * Реализация использует fs.existsSync, поэтому вернёт true и для обычного файла,
 * а не только для директории.
 *
 * @param {string} path - Путь для проверки
 * @returns {boolean} true, если путь существует в файловой системе (не обязательно директория), иначе false
 *
 * @example
 * ```ts
 * isDirSync('path/to/directory'); // -> true
 * isDirSync('nonexistent/dir'); // -> false
 * ```
 */
export function isDirSync(path: string): boolean {
    try {
        return fs.existsSync(path);
    } catch {
        return false;
    }
}

/**
 * Синхронно создает директорию
 *
 * @param {string} path - Путь к создаваемой директории
 * @param {fs.Mode} [mask='0774'] - Маска прав доступа
 * @returns {FileOperationResult<void>} Результат операции создания директории
 *
 * @example
 * ```ts
 * const result = mkdirSync('new/directory');
 * if (result.success) {
 *   console.log('Директория успешно создана');
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export function mkdirSync(path: string, mask: fs.Mode = '0774'): FileOperationResult<void> {
    try {
        fs.mkdirSync(path, mask);
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error : new Error('Failed to create directory'),
        };
    }
}

/**
 * Синхронно сохраняет данные в файл.
 * data обязана быть валидной JSON-строкой: при невалидном JSON сохранение
 * не выполняется и возвращается false (ошибка логируется через errorLogger).
 * Асинхронный аналог saveData этой проверки не делает.
 * @param {IDir} dir - Объект с путем и названием файла
 * @param {string} data - Сохраняемые данные (валидная JSON-строка)
 * @param {string} [mode] - Режим записи
 * @param {TLoggerCb} [errorLogger] - Функция для логирования ошибок
 * @returns {boolean} true в случае успешного сохранения
 */
export function saveDataSync(
    dir: IDir,
    data: string,
    mode?: string,
    errorLogger?: TLoggerCb,
): boolean {
    if (!isDirSync(dir.path)) {
        mkdirSync(dir.path);
    }
    try {
        JSON.parse(data);
    } catch (e) {
        errorLogger?.(
            `Ошибка при сохранении данных в файл: "${dir.path}/${dir.fileName}", так как данные не в json формате. Ошибка: ${(e as Error).message}`,
            {
                error: e,
                dataSize: data.length,
                mode,
            },
        );
        return false;
    }
    const res = fwriteSync(join(dir.path, dir.fileName), data, mode);
    if (!res.success) {
        // Данные целиком в лог не идут: см. saveData — дамп всей таблицы
        // пользователей в error.log при каждой неуспешной записи.
        errorLogger?.(
            `Ошибка при сохранении данных в файл: "${dir.path}/${dir.fileName}". Ошибка: ${res.error}`,
            {
                error: res.error,
                dataSize: data.length,
                mode,
            },
        );
        return false;
    }
    return true;
}

/**
 * Асинхронно возвращает информацию о файле
 *
 * @param {string} fileName - Путь к файлу
 * @returns {Promise<FileOperationResult<fs.Stats>>} Результат операции с информацией о файле
 *
 * @example
 * ```ts
 * const result = await getFileInfo('file.txt');
 * if (result.success) {
 *   console.log(result.data.size); // размер файла
 *   console.log(result.data.mtime); // время последнего изменения
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export async function getFileInfo(fileName: string): Promise<FileOperationResult<fs.Stats>> {
    try {
        const stats = await fsPromises.stat(fileName);
        return { success: true, data: stats };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error : new Error('Unknown error'),
        };
    }
}

/**
 * Асинхронно проверяет существование файла
 *
 * Путь должен выглядеть как файл: точка не в начале/конце, расширение
 * до 5 символов из словесных символов. Путь без расширения (или похожий
 * на директорию) вернёт false без обращения к файловой системе.
 *
 * @param {string} file - Путь к проверяемому файлу
 * @returns {Promise<boolean>} true, если файл существует и это файл, иначе false
 *
 * @example
 * ```ts
 * await isFile('path/to/file.txt'); // -> true
 * await isFile('path/to/directory'); // -> false (не похоже на файл)
 * await isFile('nonexistent.txt'); // -> false
 * ```
 */
export async function isFile(file: string): Promise<boolean> {
    // Строка должна выглядеть как путь к файлу: точка не в начале/конце,
    // расширение до 5 символов из словесных символов (looksLikeFilePath)
    if (looksLikeFilePath(file)) {
        const fileInfo = await getFileInfo(file);
        return !!(fileInfo.success && fileInfo.data?.isFile());
    }
    return false;
}

/**
 * Проверяет существование директории
 * @param path - Путь к директории
 * @returns Promise<boolean> - true если директория существует
 */
export async function isDir(path: string): Promise<boolean> {
    try {
        const stat = await fsPromises.stat(path);
        return stat.isDirectory();
    } catch {
        return false;
    }
}

/**
 * Создает директорию
 * @param path - Путь к создаваемой директории
 * @param mask - Маска прав доступа
 * @returns Promise с результатом операции
 */
export async function mkdir(path: string, mask?: fs.Mode): Promise<FileOperationResult<void>> {
    try {
        await fsPromises.mkdir(path, mask);
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error : new Error('Failed to create directory'),
        };
    }
}

/**
 * Читает файл
 * @param fileName - Путь к файлу
 * @returns Promise с результатом операции
 */
export async function fread(fileName: string): Promise<FileOperationResult<string | Buffer>> {
    try {
        const content = await fsPromises.readFile(fileName);
        return { success: true, data: content };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error : new Error('Failed to read file'),
        };
    }
}

/**
 * Записывает данные в файл
 * @param fileName - Путь к файлу
 * @param fileContent - Содержимое для записи
 * @param mode - Режим записи: 'w' - перезапись, 'a' - добавление
 * @returns Promise с результатом операции
 */
export async function fwrite(
    fileName: string,
    fileContent: string | Uint8Array,
    mode: 'w' | 'a' | string = 'w',
): Promise<FileOperationResult<void>> {
    // Уникальный tmp-суффикс — защита от race condition при параллельной записи.
    // См. fwriteSync — та же логика.
    const tmpPath =
        mode === 'w'
            ? `${fileName}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 9)}.tmp`
            : undefined;
    try {
        if (mode === 'w') {
            await fsPromises.writeFile(tmpPath!, fileContent);
            await fsPromises.rename(tmpPath!, fileName);
        } else {
            await fsPromises.appendFile(fileName, fileContent);
        }
        return { success: true };
    } catch (error) {
        // Удаляем осиротевший tmp-файл при ошибке
        if (tmpPath) {
            try {
                await fsPromises.unlink(tmpPath);
            } catch {
                // Игнорируем ошибку удаления tmp файла
            }
        }
        return {
            success: false,
            error: error instanceof Error ? error : new Error('Failed to write file'),
        };
    }
}

/**
 * Удаляет файл
 * @param fileName - Путь к файлу
 * @returns Promise с результатом операции
 */
export async function unlink(fileName: string): Promise<FileOperationResult<void>> {
    try {
        await fsPromises.unlink(fileName);
        return { success: true };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error : new Error('Failed to delete file'),
        };
    }
}

/**
 * Сохраняет данные в файл
 * @param {IDir} dir - Объект с путем и названием файла
 * @param {string} data - Сохраняемые данные
 * @param {string} [mode] - Режим записи
 * @param {TLoggerCb} [errorLogger] - Функция для логирования ошибок
 * @returns {boolean} true в случае успешного сохранения
 */
export async function saveData(
    dir: IDir,
    data: string,
    mode?: string,
    errorLogger?: TLoggerCb,
): Promise<boolean> {
    if (!(await isDir(dir.path))) {
        await mkdir(dir.path);
    }
    // Валидация JSON здесь намеренно не выполняется (в отличие от saveDataSync):
    // асинхронная запись никогда не блокируется на невалидном JSON, а единственные
    // реальные вызывающие передают либо только что сериализованный JSON
    // (AppContext.saveFileData), либо не-JSON строки лога в режиме дозаписи
    // (AppContext.#saveLog, mode='a'). Повторный JSON.parse всего объёма данных
    // приводил к лишней сериализации всей таблицы при каждом сохранении FileAdapter,
    // а для строк лога, начинающихся с "[timestamp]", гарантированно падал и через
    // errorLogger запускал бесконечный цикл самовоспроизводящихся ошибок.
    const res = await fwrite(join(dir.path, dir.fileName), data, mode);
    if (!res.success) {
        // Данные целиком в лог не идут: типичный вызывающий — сохранение таблицы
        // FileAdapter с данными всех пользователей, дамп ушёл бы в error.log
        // при каждой неуспешной записи (read-only ФС, переполненный диск).
        errorLogger?.(
            `Ошибка при сохранении данных в файл: "${dir.path}/${dir.fileName}". Ошибка: ${res.error}`,
            {
                error: res.error,
                dataSize: data.length,
                mode,
            },
        );
        return false;
    }
    return true;
}

/**
 * Преобразует объект параметров в URL-строку запроса
 *
 * @param {IGetParams} formData - Объект с параметрами
 * @param {string} [separator='&'] - Разделитель параметров
 * @returns {string} URL-строка запроса
 *
 * @example
 * ```ts
 * const params = {
 *   name: 'John Doe',
 *   age: '25'
 * };
 *
 * httpBuildQuery(params);
 * // -> 'name=John+Doe&age=25'
 *
 * httpBuildQuery(params, ';');
 * // -> 'name=John+Doe;age=25'
 * ```
 */
export function httpBuildQuery(formData: IGetParams, separator: string = '&'): string {
    let result = '';
    let isFirst = true;
    for (const key in formData) {
        if (!Object.prototype.hasOwnProperty.call(formData, key)) {
            continue;
        }
        // Пропускаем пустые значения: String(undefined) даёт строку "undefined",
        // и такое поле уходило в тело запроса, ломая ответ API платформы.
        if (formData[key] === undefined || formData[key] === null) {
            continue;
        }
        const encodedKey = encodeURIComponent(key);
        const encodedValue = encodeURIComponent(String(formData[key])).replace(/%20/g, '+');
        if (isFirst) {
            result = `${encodedKey}=${encodedValue}`;
            isFirst = false;
        } else {
            result += `${separator}${encodedKey}=${encodedValue}`;
        }
    }
    return result;
}

/**
 * Читает введенные данные из консоли
 *
 * @returns {Promise<string>} Промис с введенной строкой
 *
 * @example
 * ```ts
 * // Приглашение нужно напечатать самостоятельно, stdin() ничего не выводит:
 * // console.log('Enter your name:');
 * const name = await stdin(); // -> 'John' (введённая строка)
 * ```
 */
export function stdin(): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.once('line', (input) => {
            rl.close();
            resolve(input);
        });
    });
}
