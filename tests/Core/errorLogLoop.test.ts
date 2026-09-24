import { AppContext } from '../../src';
import { saveData } from '../../src/utils';

// AppContext получает saveData через барр-модуль src/utils, чьи экспорты
// скомпилированы неконфигурируемыми геттерами, — jest.spyOn к ним неприменим.
// Подменяем модуль целиком, сохраняя реальные реализации остальных утилит.
jest.mock('../../src/utils', () => ({
    ...jest.requireActual<object>('../../src/utils'),
    saveData: jest.fn(),
}));

const saveDataMock = saveData as jest.Mock;

/**
 * Эмулирует контракт реальной saveData при сбое записи: исключение не кидается,
 * вызывается errorLogger (если передан) и возвращается false. Именно так ведёт
 * себя запись на read-only ФС (serverless), при отсутствии прав или когда путь
 * занят файлом.
 */
function mockStorageFailure(): void {
    saveDataMock.mockImplementation(
        async (
            _dir: unknown,
            data: unknown,
            mode: unknown,
            errorLogger?: (text: string, meta?: Record<string, unknown>) => void,
        ) => {
            errorLogger?.('Ошибка при сохранении данных в файл', {
                error: new Error('EACCES: permission denied'),
                data,
                mode,
            });
            return false;
        },
    );
}

describe('AppContext: отказ файлового хранилища логов', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        saveDataMock.mockReset();
        mockStorageFailure();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('logError не входит в бесконечный цикл при недоступном хранилище логов', async () => {
        const appContext = new AppContext();
        appContext.appMode = 'prod';

        appContext.logError('исходная ошибка');
        await appContext.close();

        // Несколько периодов буферизации (200 мс на пачку). Без защиты каждый
        // сбой записи порождает новый logError, который снова идёт на запись, —
        // число попыток растёт неограниченно. С защитой попытки ограничены.
        await jest.advanceTimersByTimeAsync(2_000);

        expect(saveDataMock.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('в dev-режиме дублирование ошибок в консоль тоже ограничено', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const appContext = new AppContext();

        appContext.logError('исходная ошибка');
        await appContext.close();
        await jest.advanceTimersByTimeAsync(2_000);

        // Раньше каждая итерация цикла печатала в консоль всё разрастающийся
        // текст (в демо — 61 МБ за 8 секунд). Теперь вывод ограничен попытками
        // записи до срабатывания защиты.
        expect(consoleSpy.mock.calls.length).toBeLessThanOrEqual(3);
        consoleSpy.mockRestore();
    });

    it('вне dev ошибка без своего логгера дублируется в stderr (видна в docker logs)', async () => {
        const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const appContext = new AppContext();
        appContext.appMode = 'strict_prod';

        appContext.logError(
            'сбой обработки, token bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawx',
        );
        await appContext.close();

        const lines = stderrSpy.mock.calls.map((call) => String(call[0]));
        expect(lines.some((line) => line.startsWith('[umbot] сбой обработки'))).toBe(true);
        // Секреты маскируются и в stderr
        expect(lines.join('')).not.toContain('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawx');
        stderrSpy.mockRestore();
    });

    it('после серии сбоев ставит запись на паузу, а после восстановления продолжает', async () => {
        const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const appContext = new AppContext();
        appContext.appMode = 'prod';

        appContext.logError('ошибка 1');
        await appContext.close();
        appContext.logError('ошибка 2');
        await appContext.close();
        appContext.logError('ошибка 3');
        await appContext.close();
        expect(saveDataMock).toHaveBeenCalledTimes(3);

        // Пока хранилище недоступно, новые записи отбрасываются без попыток записи
        appContext.logError('ошибка во время паузы');
        await appContext.close();
        expect(saveDataMock).toHaveBeenCalledTimes(3);
        // О недоступности сообщается один раз, а не на каждую отброшенную запись
        // (сами ошибки вне dev тоже дублируются в stderr — их не считаем).
        const storageReports = stderrSpy.mock.calls.filter((call) =>
            String(call[0]).includes('Не удалось записать логи'),
        );
        expect(storageReports).toHaveLength(1);

        // Пауза истекла, хранилище снова доступно — запись возобновляется
        saveDataMock.mockResolvedValue(true);
        await jest.advanceTimersByTimeAsync(61_000);
        appContext.logError('ошибка после восстановления');
        await appContext.close();
        expect(saveDataMock).toHaveBeenCalledTimes(4);
        stderrSpy.mockRestore();
    });
});
