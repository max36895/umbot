import * as fs from 'fs';
import * as path from 'path';
import {
    safeStringify,
    rand,
    keysCount,
    similarText,
    isFileSync,
    getFileInfoSync,
    freadSync,
    fwriteSync,
    unlinkSync,
    isDirSync,
    mkdirSync,
    saveDataSync,
    isFile,
    isDir,
    mkdir,
    fread,
    fwrite,
    unlink,
    saveData,
    httpBuildQuery,
    stripTags,
} from '../../src/utils/standard/util';
import { createTestDir, removeTestDir } from '../helpers/tmpDir';

// Уникальная папка на процесс (tests/.tmp/util-*): фиксированный путь
// (__util_tmp__ рядом с сьютом) создавал гонку при параллельных прогонах Jest
// (два процесса роняли друг другу папку через rmSync в beforeEach/afterEach —
// тест isDirSync падал случайным образом).
const TMP_DIR = createTestDir('util');

beforeEach(() => {
    if (fs.existsSync(TMP_DIR)) {
        fs.rmSync(TMP_DIR, { recursive: true });
    }
    fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(async () => {
    await removeTestDir(TMP_DIR);
});

describe('safeStringify', () => {
    it('сериализует обычный объект', () => {
        const result = safeStringify({ a: 1, b: 2 });
        expect(result).toContain('"a"');
        expect(result).toContain('"b"');
    });

    it('возвращает String(data) при циклической ссылке', () => {
        const obj: Record<string, unknown> = { a: 1 };
        obj.self = obj;
        const result = safeStringify(obj);
        expect(typeof result).toBe('string');
    });

    it('принимает кастомный replacer', () => {
        const result = safeStringify(
            { a: 1, b: 2 },
            (key, value) => (key === 'b' ? undefined : value),
            '',
        );
        expect(result).toBe('{"a":1}');
    });
});

describe('rand', () => {
    it('возвращает число в заданном диапазоне включительно', () => {
        for (let i = 0; i < 100; i++) {
            const val = rand(5, 10);
            expect(val).toBeGreaterThanOrEqual(5);
            expect(val).toBeLessThanOrEqual(10);
        }
    });

    it('работает с нулевым диапазоном', () => {
        expect(rand(7, 7)).toBe(7);
    });
});

describe('keysCount', () => {
    it('считает количество собственных ключей', () => {
        expect(keysCount({ a: 1, b: 2, c: 3 })).toBe(3);
    });

    it('возвращает 0 для пустого объекта', () => {
        expect(keysCount({})).toBe(0);
    });
});

describe('similarText', () => {
    it('возвращает 100 для одинаковых строк', () => {
        expect(similarText('test', 'test')).toBe(100);
    });

    it('возвращает 100 когда обе строки пустые', () => {
        expect(similarText('', '')).toBe(100);
    });

    it('возвращает 0 если одна из строк пустая', () => {
        expect(similarText('test', '')).toBe(0);
        expect(similarText('', 'test')).toBe(0);
    });

    it('вычисляет LCS для коротких строк', () => {
        const result = similarText('привет', 'привт');
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThan(100);
    });

    it('использует эвристику при длинных строках с разницей > 50%', () => {
        const long1 = 'a'.repeat(1500);
        const long2 = 'b'.repeat(600);
        expect(similarText(long1, long2)).toBe(0);
    });

    it('использует эвристику при длинных строках с совпадающим префиксом', () => {
        const prefix = 'common_prefix_'.repeat(4);
        const long1 = prefix + 'a'.repeat(1000);
        const long2 = prefix + 'a'.repeat(1500);
        const result = similarText(long1, long2);
        expect(result).toBeGreaterThan(0);
    });

    it('не даёт 100% для длинных строк с общим префиксом и разными хвостами', () => {
        const prefix = 'x'.repeat(50);
        const long1 = prefix + 'a'.repeat(1000);
        const long2 = prefix + 'b'.repeat(1000);
        const result = similarText(long1, long2);
        expect(result).toBeLessThan(80);
    });

    it('возвращает 100 для одинаковых длинных строк', () => {
        const long = 'z'.repeat(1500);
        expect(similarText(long, long)).toBe(100);
    });

    it('даёт высокую схожесть длинным строкам, отличающимся только в конце', () => {
        const base = 'q'.repeat(1200);
        const long1 = base + 'aaaa';
        const long2 = base + 'bbbb';
        const result = similarText(long1, long2);
        expect(result).toBeGreaterThan(50);
    });
});

describe('httpBuildQuery', () => {
    it('строит query-строку из объекта', () => {
        const result = httpBuildQuery({ name: 'John Doe', age: '25' });
        expect(result).toContain('John+Doe');
        expect(result).toContain('name=');
        expect(result).toContain('age=25');
    });

    it('пропускает undefined и null вместо строки "undefined"', () => {
        // String(undefined) даёт "undefined", и такое поле уходило в тело запроса,
        // из-за чего API платформы отвечал ошибкой невалидного параметра.
        const result = httpBuildQuery({
            a: undefined,
            b: '2',
            c: null,
            d: '4',
        } as never);
        expect(result).toBe('b=2&d=4');
    });

    it('использует кастомный разделитель', () => {
        const result = httpBuildQuery({ a: '1', b: '2' }, ';');
        expect(result).toContain('a=1');
        expect(result).toContain(';');
    });

    it('возвращает пустую строку для пустого объекта', () => {
        expect(httpBuildQuery({})).toBe('');
    });
});

describe('isFileSync', () => {
    it('возвращает true для существующего файла', () => {
        const filePath = path.join(TMP_DIR, 'test.txt');
        fs.writeFileSync(filePath, 'content');
        expect(isFileSync(filePath)).toBe(true);
    });

    it('возвращает false для несуществующего файла', () => {
        expect(isFileSync(path.join(TMP_DIR, 'nonexistent.txt'))).toBe(false);
    });

    it('возвращает false для строки без точки', () => {
        expect(isFileSync('noextension')).toBe(false);
    });
});

describe('getFileInfoSync', () => {
    it('возвращает success:true для существующего файла', () => {
        const filePath = path.join(TMP_DIR, 'info.txt');
        fs.writeFileSync(filePath, 'data');
        const result = getFileInfoSync(filePath);
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
    });

    it('возвращает success:false для несуществующего файла', () => {
        const result = getFileInfoSync(path.join(TMP_DIR, 'missing.txt'));
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });
});

describe('freadSync', () => {
    it('читает содержимое файла', () => {
        const filePath = path.join(TMP_DIR, 'read.txt');
        fs.writeFileSync(filePath, 'file content');
        const result = freadSync(filePath);
        expect(result.success).toBe(true);
        expect(result.data).toBe('file content');
    });

    it('возвращает ошибку для несуществующего файла', () => {
        const result = freadSync(path.join(TMP_DIR, 'missing.txt'));
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });
});

describe('fwriteSync', () => {
    it('записывает файл в режиме w', () => {
        const filePath = path.join(TMP_DIR, 'write.txt');
        const result = fwriteSync(filePath, 'new content');
        expect(result.success).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('new content');
    });

    it('дописывает файл в режиме a', () => {
        const filePath = path.join(TMP_DIR, 'append.txt');
        fs.writeFileSync(filePath, 'base');
        fwriteSync(filePath, '+more', 'a');
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('base+more');
    });

    it('возвращает ошибку при записи в недопустимое место (синхр.)', () => {
        const result = fwriteSync(path.join(TMP_DIR, 'nonexistent', 'file.txt'), 'data');
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });
});

describe('unlinkSync', () => {
    it('удаляет существующий файл', () => {
        const filePath = path.join(TMP_DIR, 'delete.txt');
        fs.writeFileSync(filePath, 'data');
        const result = unlinkSync(filePath);
        expect(result.success).toBe(true);
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it('возвращает ошибку для несуществующего файла', () => {
        const result = unlinkSync(path.join(TMP_DIR, 'missing.txt'));
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });
});

describe('isDirSync', () => {
    it('возвращает true для существующей директории', () => {
        expect(isDirSync(TMP_DIR)).toBe(true);
    });

    it('возвращает false для несуществующей директории', () => {
        expect(isDirSync(path.join(TMP_DIR, 'nonexistent'))).toBe(false);
    });
});

describe('mkdirSync', () => {
    it('создаёт директорию', () => {
        const newDir = path.join(TMP_DIR, 'newdir');
        const result = mkdirSync(newDir);
        expect(result.success).toBe(true);
        expect(fs.existsSync(newDir)).toBe(true);
    });

    it('возвращает ошибку при создании в недопустимом месте', () => {
        const result = mkdirSync(path.join(TMP_DIR, 'nonexistent', 'deep'));
        expect(result.success).toBe(false);
    });
});

describe('saveDataSync', () => {
    it('сохраняет валидный JSON', () => {
        const dir = { path: TMP_DIR, fileName: 'data.json' };
        const result = saveDataSync(dir, JSON.stringify({ key: 'value' }));
        expect(result).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(TMP_DIR, 'data.json'), 'utf-8'))).toEqual({
            key: 'value',
        });
    });

    it('возвращает false при невалидном JSON с errorLogger', () => {
        const errorLogger = jest.fn();
        const dir = { path: TMP_DIR, fileName: 'bad.json' };
        const result = saveDataSync(dir, 'not json', undefined, errorLogger);
        expect(result).toBe(false);
        expect(errorLogger).toHaveBeenCalled();
        // Данные целиком в лог не идут: дамп таблицы пользователей в error.log
        // при каждой неуспешной записи — утечка чужих userData
        const meta = errorLogger.mock.calls[0][1] as Record<string, unknown>;
        expect(meta).not.toHaveProperty('data');
        expect(meta.dataSize).toBe('not json'.length);
    });

    it('создаёт директорию, если её нет (один уровень)', () => {
        const singleDir = path.join(TMP_DIR, 'newfolder');
        const dir = { path: singleDir, fileName: 'data.json' };
        const result = saveDataSync(dir, JSON.stringify({ x: 1 }));
        expect(result).toBe(true);
        expect(fs.existsSync(singleDir)).toBe(true);
        expect(fs.existsSync(path.join(singleDir, 'data.json'))).toBe(true);
    });
});

describe('isFile (async)', () => {
    it('возвращает true для существующего файла', async () => {
        const filePath = path.join(TMP_DIR, 'async_test.txt');
        fs.writeFileSync(filePath, 'content');
        expect(await isFile(filePath)).toBe(true);
    });

    it('возвращает false для несуществующего файла', async () => {
        expect(await isFile(path.join(TMP_DIR, 'nonexistent.txt'))).toBe(false);
    });
});

describe('isDir (async)', () => {
    it('возвращает true для существующей директории', async () => {
        expect(await isDir(TMP_DIR)).toBe(true);
    });

    it('возвращает false для несуществующей директории', async () => {
        expect(await isDir(path.join(TMP_DIR, 'nonexistent'))).toBe(false);
    });

    it('возвращает false для файла', async () => {
        const filePath = path.join(TMP_DIR, 'file.txt');
        fs.writeFileSync(filePath, 'content');
        expect(await isDir(filePath)).toBe(false);
    });
});

describe('mkdir (async)', () => {
    it('создаёт директорию', async () => {
        const newDir = path.join(TMP_DIR, 'async-newdir');
        const result = await mkdir(newDir);
        expect(result.success).toBe(true);
        expect(fs.existsSync(newDir)).toBe(true);
    });

    it('во��вращает ошибку при создании в недопустимом месте', async () => {
        const result = await mkdir(path.join(TMP_DIR, 'nonexistent', 'deep'));
        expect(result.success).toBe(false);
    });
});

describe('fread (async)', () => {
    it('читает содержимое файла', async () => {
        const filePath = path.join(TMP_DIR, 'async_read.txt');
        fs.writeFileSync(filePath, 'async content');
        const result = await fread(filePath);
        expect(result.success).toBe(true);
        expect(result.data?.toString()).toBe('async content');
    });

    it('возвращает ошибку для несуществующего файла', async () => {
        const result = await fread(path.join(TMP_DIR, 'missing.txt'));
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });
});

describe('fwrite (async)', () => {
    it('записывает файл в режиме w', async () => {
        const filePath = path.join(TMP_DIR, 'async_write.txt');
        const result = await fwrite(filePath, 'async data');
        expect(result.success).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('async data');
    });

    it('дописывает файл в режиме a', async () => {
        const filePath = path.join(TMP_DIR, 'async_append.txt');
        fs.writeFileSync(filePath, 'base');
        await fwrite(filePath, '+appended', 'a');
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('base+appended');
    });

    it('возвращает ошибку при записи в недопустимое место (асинхр.)', async () => {
        const result = await fwrite(path.join(TMP_DIR, 'nonexistent', 'file.txt'), 'data');
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });
});

describe('unlink (async)', () => {
    it('удаляет существующий файл', async () => {
        const filePath = path.join(TMP_DIR, 'async_delete.txt');
        fs.writeFileSync(filePath, 'data');
        const result = await unlink(filePath);
        expect(result.success).toBe(true);
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it('возвращает ошибку для несуществующего файла', async () => {
        const result = await unlink(path.join(TMP_DIR, 'missing.txt'));
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
    });
});

describe('saveData (async)', () => {
    it('сохраняет валидный JSON', async () => {
        const dir = { path: TMP_DIR, fileName: 'async_data.json' };
        const result = await saveData(dir, JSON.stringify({ key: 'val' }));
        expect(result).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(TMP_DIR, 'async_data.json'), 'utf-8'))).toEqual(
            { key: 'val' },
        );
    });

    it('сохраняет данные, не начинающиеся с { или [', async () => {
        const dir = { path: TMP_DIR, fileName: 'plain.txt' };
        const result = await saveData(dir, 'plain text data');
        expect(result).toBe(true);
        expect(fs.readFileSync(path.join(TMP_DIR, 'plain.txt'), 'utf-8')).toBe('plain text data');
    });

    it('возвращает false при ошибке записи', async () => {
        const errorLogger = jest.fn();
        const dir = {
            path: TMP_DIR,
            fileName: path.join('nonexistent', 'file.json'),
        };
        const result = await saveData(dir, JSON.stringify({ a: 1 }), undefined, errorLogger);
        expect(result).toBe(false);
    });

    it('создаёт директорию, если её нет (один уровень)', async () => {
        const singleDir = path.join(TMP_DIR, 'asyncfolder');
        const dir = { path: singleDir, fileName: 'async_data.json' };
        const result = await saveData(dir, JSON.stringify({ z: 1 }));
        expect(result).toBe(true);
        expect(fs.existsSync(singleDir)).toBe(true);
        expect(fs.existsSync(path.join(singleDir, 'async_data.json'))).toBe(true);
    });
});

describe('stripTags', () => {
    it('совпадает с replace(/<[^>]*>/g) на произвольных строках', () => {
        const alphabet = ['<', '>', 'a', ' ', '/', 'b'];
        let seed = 7;
        const next = (): number => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed;
        };
        for (let i = 0; i < 2000; i++) {
            const len = next() % 16;
            let text = '';
            for (let j = 0; j < len; j++) {
                text += alphabet[next() % alphabet.length];
            }
            expect(stripTags(text)).toBe(text.replace(/<[^>]*>/g, ''));
            expect(stripTags(text, ' ')).toBe(text.replace(/<[^>]*>/g, ' '));
        }
    });

    it('снимает теги и не трогает одиночную «<»', () => {
        expect(stripTags('<b>Привет</b>, мир')).toBe('Привет, мир');
        expect(stripTags('x < y')).toBe('x < y');
        expect(stripTags('<speaker audio="a.opus">текст')).toBe('текст');
    });

    it('работает за линейное время на «<<<<…» без закрывающей «>»', () => {
        const text = '<'.repeat(200_000);
        const start = performance.now();
        expect(stripTags(text)).toBe(text);
        expect(performance.now() - start).toBeLessThan(200);
    });
});
