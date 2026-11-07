/**
 * Тесты защиты файлового адаптера от зарезервированных ключей (__proto__ и др.).
 *
 * Запись и удаление уже были защищены #isForbiddenKey; чтение по первичному
 * ключу `__proto__` возвращало унаследованное Object.prototype как «найденную
 * запись», из-за чего пользователь с таким platform-id ошибочно считался
 * существующим, а его данные потом молча не сохранялись.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppContext } from '../../src';
import { FileAdapter } from '../../src/plugins';
import { createTestDir, removeTestDir } from '../helpers/tmpDir';

describe('FileAdapter: защита от зарезервированных ключей в select', () => {
    let dir: string;
    let adapter: FileAdapter;

    beforeEach(() => {
        dir = createTestDir('filedb');
        writeFileSync(
            join(dir, 'UsersData.json'),
            JSON.stringify({ '123': { userId: '123', data: '{"score":1}' } }),
            'utf8',
        );
        const appContext = new AppContext();
        appContext.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        appContext.appConfig.json = dir;
        adapter = new FileAdapter();
        adapter.init(appContext);
    });

    afterEach(async () => {
        // _insert ставит debounce-таймеры записи: без close они стреляют после
        // removeTestDir и пересоздают папку с пустой таблицей в tests/.tmp.
        await adapter.destroy();
        await removeTestDir(dir);
    });

    it('обычная выборка по первичному ключу работает', () => {
        const res = adapter._select(
            { tableName: 'UsersData', primaryKeyName: 'userId' },
            { userId: '123' },
            true,
        );
        expect(res.status).toBe(true);
        expect(res.data).toEqual({ userId: '123', data: '{"score":1}' });
    });

    it('выборка по ключу __proto__ не возвращает Object.prototype', () => {
        const res = adapter._select(
            { tableName: 'UsersData', primaryKeyName: 'userId' },
            { userId: '__proto__' },
            true,
        );
        // Раньше: content['__proto__'] === Object.prototype → status true
        expect(res.status).toBe(false);
    });

    it('выборка по ключу constructor не возвращает функцию-конструктор', () => {
        const res = adapter._select(
            { tableName: 'UsersData', primaryKeyName: 'userId' },
            { userId: 'constructor' },
            true,
        );
        expect(res.status).toBe(false);
    });

    it('зарезервированный ключ в не-первичном поле условия тоже отклоняется', () => {
        // JSON.parse создаёт собственное свойство __proto__ — реалистичный вектор,
        // т.к. payload платформы приходит именно через JSON.parse
        const where = JSON.parse('{"platform":"telegram","__proto__":{"polluted":true}}') as Record<
            string,
            unknown
        >;
        const res = adapter._select(
            { tableName: 'UsersData', primaryKeyName: 'userId' },
            where,
            false,
        );
        expect(res.status).toBe(false);
    });

    it('insert зарезервированного ключа по-прежнему блокируется', () => {
        const inserted = adapter._insert({
            tableName: 'UsersData',
            primaryKeyName: 'userId',
            data: { userId: '__proto__', data: '{}' },
        });
        expect(inserted).toBe(false);
    });

    it('пустая выборка сканом (where без уникальных ключей) — без error: «не найдено», а не сбой', () => {
        // Контракт _select: error означает «данные не загрузились», по нему ядро
        // прекращает сохранение userData. Обычный промах сканом раньше возвращал
        // error и валил загрузку пользователя наравне с реальным сбоем БД
        const res = adapter._select(
            { tableName: 'UsersData', primaryKeyName: 'userId' },
            { platform: 'telegram' },
            true,
        );
        expect(res.status).toBe(false);
        expect(res.error).toBeUndefined();
    });

    it('пустая таблица с where=null — без error (isOne: не найдено, select-all: пустой результат)', () => {
        // Таблица, которой нет в файле: адаптер создаёт её пустой при первом обращении
        const resOne = adapter._select(
            { tableName: 'EmptyTable', primaryKeyName: 'id' },
            null,
            true,
        );
        expect(resOne.status).toBe(false);
        expect(resOne.error).toBeUndefined();
        // Выборка всего из пустой таблицы — успешный пустой результат (как у Mongo find().toArray())
        const resAll = adapter._select(
            { tableName: 'EmptyTable', primaryKeyName: 'id' },
            null,
            false,
        );
        expect(resAll.status).toBe(true);
        expect(resAll.data).toEqual({});
        expect(resAll.error).toBeUndefined();
    });

    it('partial update не затирает отсутствующие поля (паритет с Mongo-адаптером)', () => {
        adapter._insert({
            tableName: 'UsersData',
            primaryKeyName: 'userId',
            query: { userId: 'p1' },
            data: { userId: 'p1', data: '{"a":1}', meta: '{}' },
        });
        adapter._update({
            tableName: 'UsersData',
            primaryKeyName: 'userId',
            query: { userId: 'p1' },
            data: { data: '{"a":2}' },
        });
        const res = adapter._select(
            { tableName: 'UsersData', primaryKeyName: 'userId' },
            { userId: 'p1' },
            true,
        );
        expect(res.status).toBe(true);
        expect(res.data).toEqual({ userId: 'p1', data: '{"a":2}', meta: '{}' });
    });
});
