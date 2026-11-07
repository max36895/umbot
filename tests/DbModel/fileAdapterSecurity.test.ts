/**
 * Тесты безопасности файлового адаптера по итогам аудита:
 * - правила модели (query.rules) ограничивают размер значения, ключи длиннее max
 *   отклоняются целиком (обрезка меняла бы идентичность записи);
 * - prototype-ключи в update.data не подменяют прототип строки в кэше;
 * - гонка select→insert в Base.save не теряет правки (повторный update).
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppContext } from '../../src';
import { FileAdapter } from '../../src/plugins';
import type { IQuery } from '../../src';
import { createTestDir, removeTestDir } from '../helpers/tmpDir';

describe('FileAdapter: безопасность записи', () => {
    let dir: string;
    let adapter: FileAdapter;

    beforeEach(() => {
        dir = createTestDir('filedb-sec');
        writeFileSync(join(dir, 'UsersData.json'), JSON.stringify({}), 'utf8');
        const appContext = new AppContext();
        appContext.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        appContext.appConfig.json = dir;
        adapter = new FileAdapter();
        adapter.init(appContext);
    });

    afterEach(async () => {
        await adapter.destroy();
        await removeTestDir(dir);
    });

    it('вставка с ключевым полем длиннее max отклоняется, таблица не растёт', () => {
        const query: IQuery = {
            tableName: 'UsersData',
            primaryKeyName: 'userId',
            uniqueKeys: ['platform'],
            rules: [{ name: ['userId', 'data'], type: 'string', max: 250 }],
        };
        const huge = 'x'.repeat(1000 * 1000);
        const inserted = adapter._insert({
            ...query,
            query: { platform: 'alisa', userId: huge },
            data: { platform: 'alisa', userId: huge, data: '{"v":"1"}' },
        });
        expect(inserted).toBe(false);
        // Ключ в 1 МБ не записался и не обрезан, а отклонён целиком
        expect(adapter.getFileData('UsersData')).toEqual({});
        // Чтение по тому же ключу согласовано: записи нет ни под каким видом
        const res = adapter._select({ ...query }, { platform: 'alisa', userId: huge }, true);
        expect(res.status).toBe(false);
    });

    it('значение (не ключ) обрезается по max, запись находит по исходному ключу', () => {
        const query: IQuery = {
            tableName: 'UsersData',
            primaryKeyName: 'userId',
            rules: [{ name: ['data'], type: 'string', max: 250 }],
        };
        adapter._insert({
            ...query,
            query: { userId: 'u1' },
            data: { userId: 'u1', data: 'd'.repeat(1000) },
        });
        const res = adapter._select({ ...query }, { userId: 'u1' }, true);
        expect(res.status).toBe(true);
        expect((res.data as { data: string }).data).toBe('d'.repeat(250));
    });

    it('строки с длинным ключом, записанные прежними версиями, доступны на чтение, обновление и удаление', () => {
        // Прежние версии (до применения правил) хранили ключ целиком
        const longId = 'y'.repeat(300);
        writeFileSync(
            join(dir, 'UsersData.json'),
            JSON.stringify({ [longId]: { userId: longId, data: '{"v":"legacy"}' } }),
            'utf8',
        );
        const query: IQuery = {
            tableName: 'UsersData',
            primaryKeyName: 'userId',
            rules: [{ name: ['userId'], type: 'string', max: 250 }],
        };
        const found = adapter._select({ ...query }, { userId: longId }, true);
        expect(found.status).toBe(true);
        const updated = adapter._update({
            ...query,
            query: { userId: longId },
            data: { data: '{"v":"new"}' },
        });
        expect(updated).toBe(true);
        const removed = adapter._remove({ ...query, query: { userId: longId } });
        expect(removed).toBe(true);
        expect(adapter.getFileData('UsersData')).toEqual({});
    });

    it('обновление с ключевым полем длиннее max в data отклоняется, строка не меняется', () => {
        const query: IQuery = {
            tableName: 'UsersData',
            primaryKeyName: 'userId',
            rules: [{ name: ['userId', 'data'], type: 'string', max: 250 }],
        };
        adapter._insert({
            ...query,
            query: { userId: 'u2' },
            data: { userId: 'u2', data: '{"v":"1"}' },
        });
        const updated = adapter._update({
            ...query,
            query: { userId: 'u2' },
            data: { userId: 'z'.repeat(300), data: '{"v":"2"}' },
        });
        expect(updated).toBe(false);
        const row = adapter.getFileData('UsersData')['u2'];
        expect(row.userId).toBe('u2');
        expect(row.data).toBe('{"v":"1"}');
    });

    it('prototype-ключи в update.data не подменяют прототип строки', () => {
        adapter._insert({
            tableName: 'UsersData',
            primaryKeyName: 'userId',
            query: { userId: '42' },
            data: { userId: '42', data: '{"score":1}' },
        });
        const data = adapter.getFileData('UsersData');
        const row = data['42'];
        const protoBefore = Object.getPrototypeOf(row);
        adapter._update({
            tableName: 'UsersData',
            primaryKeyName: 'userId',
            query: { userId: '42' },
            data: { data: '{"isAdmin":true}', __proto__: { isAdmin: true } } as never,
        });
        const updated = data['42'];
        expect(Object.getPrototypeOf(updated)).toBe(protoBefore);
        expect(updated.data).toBe('{"isAdmin":true}');
    });

    it('гонка select→insert: отклонённая вставка повторяется как update, правки не теряются', async () => {
        // Запись уже на диске: её создал «параллельный запрос» до старта этого
        // адаптера (запись первого — debounce, поэтому пишем файл напрямую)
        writeFileSync(
            join(dir, 'UsersData.json'),
            JSON.stringify({ '7': { userId: '7', data: '{"step":1}' } }),
            'utf8',
        );
        // Имитация проигранной гонки: insert этого запроса отклонён по занятому ключу
        class LostRaceAdapter extends FileAdapter {
            public _insert(): boolean {
                return false;
            }
        }
        const appContext = new AppContext();
        appContext.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        appContext.appConfig.json = dir;
        const raced = new LostRaceAdapter();
        raced.init(appContext);
        const saved = await raced.save(
            {
                tableName: 'UsersData',
                primaryKeyName: 'userId',
                query: { userId: '7' },
                data: { data: '{"step":2}' },
            },
            true,
        );
        expect(saved).toBe(true);
        const res = raced._select(
            { tableName: 'UsersData', primaryKeyName: 'userId' },
            { userId: '7' },
            true,
        );
        expect(res.status).toBe(true);
        expect((res.data as { data: string }).data).toBe('{"step":2}');
        await raced.destroy();
    });
});
