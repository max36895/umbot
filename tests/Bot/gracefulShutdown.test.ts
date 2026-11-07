/**
 * Graceful shutdown (SIGTERM/SIGINT): после чистого завершения процесс должен
 * выходить сам (event loop освобождён), а принудительный `process.exit` —
 * только страховка на случай, если цикл продолжают держать чужие дескрипторы.
 */
import { Bot } from '../../src';
import { ShutdownSignals } from '../../src/core/utils/ShutdownSignals';

const mockExit = (): jest.SpyInstance =>
    jest
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as (code?: string | number | null) => never);

describe('Bot: graceful shutdown', () => {
    let bot: Bot;
    let exitSpy: jest.SpyInstance;

    beforeEach(() => {
        bot = new Bot();
        bot.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        exitSpy = mockExit();
    });

    afterEach(async () => {
        // close() снимает и подписки на сигналы, и страховочный таймер выхода.
        await bot.close();
        exitSpy.mockRestore();
    });

    it('не завершает процесс принудительно после чистого shutdown', async () => {
        const server = bot.start('localhost', 3123);
        await new Promise<void>((resolve) => {
            server.on('listening', resolve);
            server.on('error', resolve);
        });

        process.emit('SIGTERM');

        // Ждём завершения shutdown: сервер перестал слушать порт.
        for (let i = 0; i < 200 && server.listening; i++) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(server.listening).toBe(false);
        // Страховка настроена на секунды: сразу после завершения принудительного
        // выхода быть не должно — при чистом цикле процесс выйдет сам.
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(exitSpy).not.toHaveBeenCalled();
    }, 15000);
});

describe('ShutdownSignals: страховка принудительного выхода', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('armForceExit вызывает process.exit по таймауту, remove() отменяет страховку', () => {
        const exitSpy = mockExit();
        const signals = new ShutdownSignals(() => {});

        signals.armForceExit(5000);
        jest.advanceTimersByTime(4999);
        expect(exitSpy).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(exitSpy).toHaveBeenCalledWith(0);

        exitSpy.mockClear();
        signals.armForceExit(5000);
        signals.remove();
        jest.advanceTimersByTime(5000);
        expect(exitSpy).not.toHaveBeenCalled();

        exitSpy.mockRestore();
    });
});
