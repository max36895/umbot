/**
 * Long polling в ядре: bot.startPolling()/stopPolling() и цикл запроса обновлений.
 * Адаптер подменяет getUpdates сценарием — сеть не используется.
 */
import { Bot, BotController } from '../../src';
import { TelegramAdapter } from '../../src/plugins';

type TStep = unknown[] | null | Error | 'block';

/** Промис, который завершается только отменой по сигналу (как висящий long polling). */
function blockUntilAbort(signal: AbortSignal): Promise<never> {
    return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
}

/** Адаптер Telegram, у которого getUpdates отдаёт заранее заданные шаги. */
class ScriptedAdapter extends TelegramAdapter {
    readonly steps: TStep[];
    calls = 0;
    lastSignal: AbortSignal | null = null;

    constructor(steps: TStep[]) {
        super('test-token');
        this.steps = steps;
    }

    async getUpdates(signal: AbortSignal): Promise<unknown[] | null> {
        this.lastSignal = signal;
        const index = this.calls++;
        const step = index < this.steps.length ? this.steps[index] : 'block';
        if (step === 'block') {
            return blockUntilAbort(signal);
        }
        if (step instanceof Error) {
            throw step;
        }
        return step;
    }
}

function tgUpdate(updateId: number, userId: number, text: string): Record<string, unknown> {
    return {
        update_id: updateId,
        message: {
            message_id: updateId,
            from: { id: userId },
            chat: { id: userId, type: 'private' },
            date: 1,
            text,
        },
    };
}

const handled: string[] = [];

class RecordController extends BotController {
    action(): void {
        if (this.userCommand === 'fail') {
            throw new Error('handler failed');
        }
        handled.push(`${this.userId}:${this.userCommand}`);
        this.skipAutoReply = true;
    }
}

function createBot(adapter: TelegramAdapter): { bot: Bot; errors: string[]; warns: string[] } {
    const errors: string[] = [];
    const warns: string[] = [];
    const bot = new Bot();
    bot.setLogger({
        error: (msg: string) => errors.push(msg),
        warn: (msg: string) => warns.push(msg),
    });
    bot.use(adapter);
    // Ответ после ошибки обработчика уходит в API — сеть в тестах не используется.
    bot.getAppContext().httpClient = jest.fn(
        async () => new Response(JSON.stringify({ ok: true, result: {} })),
    );
    bot.setAppConfig({ isLocalStorage: true });
    bot.initBotController(RecordController);
    return { bot, errors, warns };
}

/** Ждёт, пока условие станет истинным (опрос раз в 5 мс, не дольше timeout). */
async function waitFor(check: () => boolean, timeout = 3000): Promise<void> {
    const start = Date.now();
    while (!check()) {
        if (Date.now() - start > timeout) {
            throw new Error('Условие не выполнилось вовремя');
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

beforeEach(() => {
    handled.length = 0;
});

describe('Bot.startPolling()', () => {
    it('обрабатывает полученные обновления и завершается по stopPolling()', async () => {
        const adapter = new ScriptedAdapter([
            [tgUpdate(1, 10, 'alpha'), tgUpdate(2, 20, 'beta')],
            [tgUpdate(3, 10, 'ещё')],
        ]);
        const { bot } = createBot(adapter);

        const polling = bot.startPolling();
        await waitFor(() => handled.length === 3 && adapter.calls === 3);
        expect(handled).toEqual(expect.arrayContaining(['10:alpha', '20:beta', '10:ещё']));

        await bot.stopPolling();
        await expect(polling).resolves.toBeUndefined();
        expect(adapter.lastSignal?.aborted).toBe(true);
        await bot.close();
    });

    it('после ошибки запроса повторяет его с паузой и пишет причину в лог', async () => {
        const adapter = new ScriptedAdapter([new Error('network down'), [tgUpdate(1, 1, 'ok')]]);
        const { bot, errors } = createBot(adapter);

        const started = Date.now();
        void bot.startPolling();
        await waitFor(() => handled.length === 1);

        expect(Date.now() - started).toBeGreaterThanOrEqual(900);
        expect(errors.some((e) => e.includes('network down') && e.includes('Повтор'))).toBe(true);
        await bot.close();
    });

    it('останавливает цикл, когда адаптер вернул null', async () => {
        const adapter = new ScriptedAdapter([null]);
        const { bot, errors } = createBot(adapter);

        await expect(bot.startPolling()).resolves.toBeUndefined();
        expect(adapter.calls).toBe(1);
        expect(errors.some((e) => e.includes('long polling "telegram" остановлен'))).toBe(true);
        await bot.close();
    });

    it('ошибка обработчика не останавливает polling', async () => {
        const adapter = new ScriptedAdapter([[tgUpdate(1, 1, 'fail')], [tgUpdate(2, 1, 'дальше')]]);
        const { bot, errors } = createBot(adapter);

        void bot.startPolling();
        await waitFor(() => handled.includes('1:дальше'));
        expect(errors.some((e) => e.includes('handler failed'))).toBe(true);
        await bot.close();
    });

    it('отклоняется, если ни один адаптер не поддерживает polling', async () => {
        const { bot } = createBot(new ScriptedAdapter([]));

        await expect(bot.startPolling({ platforms: ['vk'] })).rejects.toThrow(
            'поддержкой long polling',
        );
        await bot.close();
    });

    it('повторный вызов возвращает тот же промис', async () => {
        const adapter = new ScriptedAdapter([]);
        const { bot, warns } = createBot(adapter);

        const first = bot.startPolling();
        const second = bot.startPolling();

        expect(second).toBe(first);
        expect(warns.some((w) => w.includes('уже запущен'))).toBe(true);
        await bot.close();
        await expect(first).resolves.toBeUndefined();
    });

    it('close() обрывает висящий запрос обновлений', async () => {
        const adapter = new ScriptedAdapter(['block']);
        const { bot } = createBot(adapter);

        const polling = bot.startPolling();
        await waitFor(() => adapter.calls === 1);
        await bot.close();

        await expect(polling).resolves.toBeUndefined();
        expect(adapter.lastSignal?.aborted).toBe(true);
    });

    it('после остановки polling можно запустить снова', async () => {
        const adapter = new ScriptedAdapter(['block', [tgUpdate(1, 5, 'снова')]]);
        const { bot } = createBot(adapter);

        void bot.startPolling();
        await waitFor(() => adapter.calls === 1);
        await bot.stopPolling();

        void bot.startPolling();
        await waitFor(() => handled.includes('5:снова'));
        await bot.close();
    });

    it('startPolling() во время остановки запускает новый polling', async () => {
        const adapter = new ScriptedAdapter(['block', [tgUpdate(1, 7, 'после')]]);
        const { bot, warns } = createBot(adapter);

        const first = bot.startPolling();
        await waitFor(() => adapter.calls === 1);
        const stopping = bot.stopPolling();
        const second = bot.startPolling();

        expect(second).not.toBe(first);
        expect(warns.some((w) => w.includes('уже запущен'))).toBe(false);
        await stopping;
        await waitFor(() => handled.includes('7:после'));
        await bot.close();
    });

    it('обрабатывает пачку не более чем 32 обновления одновременно', async () => {
        let active = 0;
        let maxActive = 0;
        class SlowController extends BotController {
            async action(): Promise<void> {
                active++;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => setTimeout(resolve, 20));
                active--;
                handled.push(String(this.userId));
                this.skipAutoReply = true;
            }
        }
        const batch = Array.from({ length: 50 }, (_, i) => tgUpdate(i + 1, i + 1, `u${i}`));
        const adapter = new ScriptedAdapter([batch]);
        const { bot } = createBot(adapter);
        bot.initBotController(SlowController);

        void bot.startPolling();
        await waitFor(() => handled.length === 50);
        await bot.close();

        expect(maxActive).toBeGreaterThan(1);
        expect(maxActive).toBeLessThanOrEqual(32);
    });

    it('stopPolling() без запущенного polling ничего не делает', async () => {
        const { bot } = createBot(new ScriptedAdapter([]));
        await expect(bot.stopPolling()).resolves.toBeUndefined();
        await bot.close();
    });
});
