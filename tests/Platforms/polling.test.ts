/**
 * getUpdates встроенных адаптеров (long polling): протокол Telegram getUpdates,
 * VK Bots Long Poll и MAX GET /updates. HTTP подменяется через appContext.httpClient.
 */
import { Bot, BotController } from '../../src';
import { MaxAdapter, TelegramAdapter, VkAdapter, clearVkUserCache } from '../../src/plugins';
import type { IPlatformAdapter } from '../../src';

interface ICall {
    url: string;
    init: RequestInit;
}

type THandler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
}

function setup(adapter: IPlatformAdapter, handler: THandler): { calls: ICall[]; errors: string[] } {
    const calls: ICall[] = [];
    const errors: string[] = [];
    const bot = new Bot();
    bot.setLogger({ error: (msg: string) => errors.push(msg), warn: () => {} });
    bot.use(adapter);
    bot.getAppContext().httpClient = async (input, init): Promise<Response> => {
        const url = String(input);
        calls.push({ url, init: init ?? {} });
        return handler(url, init ?? {});
    };
    return { calls, errors };
}

const signal = (): AbortSignal => new AbortController().signal;

describe('TelegramAdapter.getUpdates()', () => {
    it('передаёт timeout и сдвигает offset после полученных обновлений', async () => {
        const adapter = new TelegramAdapter('123:secret-token');
        const { calls } = setup(adapter, () =>
            json({ ok: true, result: [{ update_id: 7 }, { update_id: 8 }] }),
        );

        await expect(adapter.getUpdates(signal())).resolves.toHaveLength(2);
        await adapter.getUpdates(signal());

        expect(calls[0]?.url).toBe('https://api.telegram.org/bot123:secret-token/getUpdates');
        expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ timeout: 25 });
        expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ timeout: 25, offset: 9 });
    });

    it('при активном вебхуке (409) останавливает polling с подсказкой', async () => {
        const adapter = new TelegramAdapter('123:secret-token');
        const { errors } = setup(adapter, () =>
            json(
                {
                    ok: false,
                    description: "Conflict: can't use getUpdates method while webhook is active",
                },
                409,
            ),
        );

        await expect(adapter.getUpdates(signal())).resolves.toBeNull();
        expect(errors.join('\n')).toContain('deleteWebhook');
        expect(errors.join('\n')).not.toContain('secret-token');
    });

    it('временную ошибку бросает без токена в тексте', async () => {
        const adapter = new TelegramAdapter('123:secret-token');
        setup(adapter, () => json({ ok: false, description: 'Bad Gateway' }, 502));

        const error = await adapter.getUpdates(signal()).catch((e: Error) => e);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('HTTP 502: Bad Gateway');
    });

    it('опция telegram_delete_webhook снимает вебхук один раз и пишет предупреждение', async () => {
        const adapter = new TelegramAdapter('123:secret-token', { telegram_delete_webhook: true });
        const warns: string[] = [];
        const { calls } = setup(adapter, (url) =>
            json(
                url.endsWith('/deleteWebhook')
                    ? { ok: true, result: true }
                    : { ok: true, result: [] },
            ),
        );
        adapter.appContext?.setLogger({ error: () => {}, warn: (msg: string) => warns.push(msg) });

        await adapter.getUpdates(signal());
        await adapter.getUpdates(signal());

        expect(calls.map((c) => c.url.split('/').pop())).toEqual([
            'deleteWebhook',
            'getUpdates',
            'getUpdates',
        ]);
        expect(warns.join('\n')).toContain('вебхук бота снят');
    });

    it('без опции вебхук не снимается', async () => {
        const adapter = new TelegramAdapter('123:secret-token');
        const { calls } = setup(adapter, () => json({ ok: true, result: [] }));

        await adapter.getUpdates(signal());

        expect(calls.some((c) => c.url.endsWith('/deleteWebhook'))).toBe(false);
    });

    it('после остановки polling снова отвечает телом вебхука (webhook-reply)', async () => {
        const adapter = new TelegramAdapter('123:secret-token', { telegram_webhook_reply: true });
        const bot = new Bot();
        bot.setLogger({ error: () => {}, warn: () => {} });
        bot.use(adapter);
        bot.setAppConfig({ isLocalStorage: true });
        class Echo extends BotController {
            action(): void {
                this.text = 'эхо';
            }
        }
        bot.initBotController(Echo);
        bot.getAppContext().httpClient = async (): Promise<Response> =>
            json({ ok: true, result: [] });

        const controller = new AbortController();
        await adapter.getUpdates(controller.signal);
        controller.abort();

        const result = await bot.webhookEvent({
            update_id: 5,
            message: {
                message_id: 5,
                from: { id: 1 },
                chat: { id: 1, type: 'private' },
                date: 1,
                text: 'x',
            },
        });
        expect((result.body as Record<string, unknown>).method).toBe('sendMessage');
        await bot.close();
    });

    it('без токена возвращает null', async () => {
        const adapter = new TelegramAdapter();
        const { calls, errors } = setup(adapter, () => json({}));

        await expect(adapter.getUpdates(signal())).resolves.toBeNull();
        expect(calls).toHaveLength(0);
        expect(errors.join('\n')).toContain('TELEGRAM_TOKEN');
    });

    it('в режиме polling отвечает через sendMessage, а не телом webhook-reply', async () => {
        class Echo extends BotController {
            action(): void {
                this.text = 'эхо';
            }
        }
        const adapter = new TelegramAdapter('123:secret-token', { telegram_webhook_reply: true });
        const bot = new Bot();
        bot.setLogger({ error: () => {}, warn: () => {} });
        bot.use(adapter);
        bot.setAppConfig({ isLocalStorage: true });
        bot.initBotController(Echo);
        const urls: string[] = [];
        let served = false;
        bot.getAppContext().httpClient = async (input, init): Promise<Response> => {
            const url = String(input);
            urls.push(url);
            if (url.endsWith('/getUpdates')) {
                if (served) {
                    // Висим до остановки, как настоящий long polling
                    return new Promise<Response>((_resolve, reject) => {
                        init?.signal?.addEventListener('abort', () => reject(new Error('abort')));
                    });
                }
                served = true;
                return json({
                    ok: true,
                    result: [
                        {
                            update_id: 1,
                            message: {
                                message_id: 1,
                                from: { id: 5 },
                                chat: { id: 5, type: 'private' },
                                date: 1,
                                text: 'test',
                            },
                        },
                    ],
                });
            }
            return json({ ok: true, result: {} });
        };

        void bot.startPolling();
        const start = Date.now();
        while (!urls.some((u) => u.endsWith('/sendMessage')) && Date.now() - start < 3000) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await bot.close();

        expect(urls.some((u) => u.endsWith('/sendMessage'))).toBe(true);
    });
});

describe('VkAdapter.getUpdates()', () => {
    function vkHandler(checks: unknown[]): { handler: THandler; methods: string[] } {
        const methods: string[] = [];
        let check = 0;
        let server = 0;
        const handler: THandler = (url) => {
            if (url.includes('/method/groups.getById')) {
                methods.push('groups.getById');
                return json({ response: { groups: [{ id: 77 }], profiles: [] } });
            }
            if (url.includes('/method/groups.getLongPollServer')) {
                methods.push('groups.getLongPollServer');
                server++;
                return json({
                    response: {
                        server: 'https://lp.vk.ru/wh77',
                        key: `key${server}`,
                        ts: `${server * 100}`,
                    },
                });
            }
            methods.push('a_check');
            return json(checks[check++] ?? { ts: '999', updates: [] });
        };
        return { handler, methods };
    }

    it('получает сервер и читает события, продолжая с нового ts', async () => {
        const adapter = new VkAdapter('vk-token');
        const event = { type: 'message_new', object: {}, group_id: 77, event_id: 'e1' };
        const { handler, methods } = vkHandler([{ ts: '101', updates: [event] }]);
        const { calls } = setup(adapter, handler);

        await expect(adapter.getUpdates(signal())).resolves.toEqual([event]);
        await adapter.getUpdates(signal());

        expect(methods).toEqual([
            'groups.getById',
            'groups.getLongPollServer',
            'a_check',
            'a_check',
        ]);
        const serverCall = calls.find((c) => c.url.includes('getLongPollServer'));
        expect(String(serverCall?.init.body)).toContain('group_id=77');
        const checksUrls = calls.filter((c) => c.url.startsWith('https://lp.vk.ru/wh77'));
        expect(checksUrls[0]?.url).toContain('key=key1');
        expect(checksUrls[0]?.url).toContain('ts=100');
        expect(checksUrls[0]?.url).toContain('act=a_check');
        expect(checksUrls[1]?.url).toContain('ts=101');
    });

    it('имена авторов пачки загружаются одним users.get и сохраняют порядок сообщений', async () => {
        clearVkUserCache();
        const message = (id: number, fromId: number, text: string): Record<string, unknown> => ({
            type: 'message_new',
            group_id: 77,
            event_id: `e${id}`,
            object: { message: { id, from_id: fromId, peer_id: fromId, text } },
        });
        const order: string[] = [];
        class Recorder extends BotController {
            action(): void {
                order.push(String(this.userCommand));
                this.skipAutoReply = true;
            }
        }
        const adapter = new VkAdapter('vk-token');
        const bot = new Bot();
        bot.setLogger({ error: () => {}, warn: () => {} });
        bot.use(adapter);
        bot.setAppConfig({ isLocalStorage: true });
        bot.initBotController(Recorder);
        const usersGet: string[] = [];
        let checks = 0;
        bot.getAppContext().httpClient = async (input, init): Promise<Response> => {
            const url = String(input);
            if (url.includes('groups.getById')) {
                return json({ response: { groups: [{ id: 77 }] } });
            }
            if (url.includes('groups.getLongPollServer')) {
                return json({ response: { server: 'https://lp.vk.ru/wh77', key: 'k', ts: '1' } });
            }
            if (url.includes('users.get')) {
                usersGet.push(String(init?.body));
                // Первый ответ медленнее: без общей загрузки второе сообщение обогнало бы первое
                await new Promise((resolve) => setTimeout(resolve, usersGet.length === 1 ? 50 : 0));
                return json({ response: [{ id: 55, first_name: 'Иван', last_name: 'Петров' }] });
            }
            if (checks++ === 0) {
                return json({
                    ts: '2',
                    updates: [message(1, 55, 'первое'), message(2, 55, 'второе')],
                });
            }
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new Error('abort')));
            });
        };

        void bot.startPolling();
        const start = Date.now();
        while (order.length < 2 && Date.now() - start < 3000) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await bot.close();

        expect(order).toEqual(['первое', 'второе']);
        expect(usersGet).toHaveLength(1);
        expect(usersGet[0]).toContain('user_ids=55');
    });

    it('failed: 1 — только обновляет ts', async () => {
        const adapter = new VkAdapter('vk-token');
        const { handler, methods } = vkHandler([{ failed: 1, ts: '150' }]);
        const { calls } = setup(adapter, handler);

        await expect(adapter.getUpdates(signal())).resolves.toEqual([]);
        await adapter.getUpdates(signal());

        expect(methods.filter((m) => m === 'groups.getLongPollServer')).toHaveLength(1);
        expect(calls[calls.length - 1]?.url).toContain('ts=150');
    });

    it('failed: 2 — новый ключ с прежним ts', async () => {
        const adapter = new VkAdapter('vk-token');
        const { handler, methods } = vkHandler([{ failed: 2 }]);
        const { calls } = setup(adapter, handler);

        await adapter.getUpdates(signal());
        await adapter.getUpdates(signal());

        expect(methods.filter((m) => m === 'groups.getLongPollServer')).toHaveLength(2);
        const last = calls[calls.length - 1]?.url ?? '';
        expect(last).toContain('key=key2');
        expect(last).toContain('ts=100');
    });

    it('failed: 3 — новые ключ и ts', async () => {
        const adapter = new VkAdapter('vk-token');
        const { handler } = vkHandler([{ failed: 3 }]);
        const { calls } = setup(adapter, handler);

        await adapter.getUpdates(signal());
        await adapter.getUpdates(signal());

        const last = calls[calls.length - 1]?.url ?? '';
        expect(last).toContain('key=key2');
        expect(last).toContain('ts=200');
    });

    it('ошибка API при запросе сервера останавливает polling с подсказкой', async () => {
        const adapter = new VkAdapter('vk-token');
        const { errors } = setup(adapter, (url) =>
            url.includes('groups.getById')
                ? json({ response: [{ id: 77 }] })
                : json({ error: { error_code: 100, error_msg: 'long poll is disabled' } }),
        );

        await expect(adapter.getUpdates(signal())).resolves.toBeNull();
        expect(errors.join('\n')).toContain('Long Poll API');
    });

    it('сетевую ошибку бросает — ядро повторит запрос', async () => {
        const adapter = new VkAdapter('vk-token');
        setup(adapter, () => {
            throw new Error('ECONNRESET');
        });

        await expect(adapter.getUpdates(signal())).rejects.toThrow('ECONNRESET');
    });
});

describe('MaxAdapter.getUpdates()', () => {
    it('передаёт токен заголовком и продолжает с marker из ответа', async () => {
        const adapter = new MaxAdapter('max-token');
        const update = { update_type: 'message_created', timestamp: 1 };
        const { calls } = setup(adapter, () => json({ updates: [update], marker: 42 }));

        await expect(adapter.getUpdates(signal())).resolves.toEqual([update]);
        await adapter.getUpdates(signal());

        expect(calls[0]?.url).toBe('https://platform-api2.max.ru/updates?timeout=30');
        expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('max-token');
        expect(calls[1]?.url).toContain('marker=42');
    });

    it('неверный токен (401) останавливает polling', async () => {
        const adapter = new MaxAdapter('max-token');
        const { errors } = setup(adapter, () =>
            json({ code: 'verify.token', message: 'Invalid access_token' }, 401),
        );

        await expect(adapter.getUpdates(signal())).resolves.toBeNull();
        expect(errors.join('\n')).toContain('MAX_TOKEN');
    });
});
