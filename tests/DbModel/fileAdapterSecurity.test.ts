/**
 * Тесты безопасности файлового адаптера по итогам аудита:
 * - правила модели (query.rules) ограничивают размер ключа/значения на вставке и обновлении;
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

    it('правила модели обрезают ключ и значение по max (защита от раздутия таблицы)', () => {
        const query: IQuery = {
            tableName: 'UsersData',
            primaryKeyName: 'userId',
            rules: [{ name: ['userId', 'data'], type: 'string', max: 250 }],
        };
        const huge = 'x'.repeat(1000 * 1000);
        adapter._insert({
            ...query,
            query: { userId: huge },
            data: { userId: huge, data: '{"v":"1"}' },
        });
        const res = adapter._select({ ...query }, { userId: 'x'.repeat(250) }, true);
        expect(res.status).toBe(true);
        // Ключ в 1 МБ не записался: хранимое значение обрезано до max
        expect(adapter.getFileData('UsersData')['x'.repeat(250)]).toBeDefined();
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
