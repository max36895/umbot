import { authGuard, requestId, maintenance, ipFilter } from '../../src/middleware';
import { BotController } from '../../src/controller';
import { AppContext } from '../../src/core';

describe('middleware', () => {
    function makeCtx(): BotController {
        const appContext = new AppContext();
        appContext.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        return new BotController(appContext);
    }
    function makeNext(): { called: boolean; fn: () => Promise<void> } {
        const state = { called: false };
        return {
            get called(): boolean {
                return state.called;
            },
            fn: async (): Promise<void> => {
                state.called = true;
            },
        };
    }

    describe('authGuard', () => {
        it('пропускает, когда check возвращает true', async () => {
            const ctx = makeCtx();
            const next = makeNext();

            await authGuard(() => true)(ctrlOrCtx(ctx), next.fn);

            expect(next.called).toBe(true);
            expect(ctx.text).toBe('');
        });

        it('блокирует с deniedText, когда check возвращает false', async () => {
            const ctx = makeCtx();
            const next = makeNext();

            await authGuard(() => false, { deniedText: 'Нет доступа' })(ctrlOrCtx(ctx), next.fn);

            expect(next.called).toBe(false);
            expect(ctx.text).toBe('Нет доступа');
        });

        it('блокирует, если check выбросил исключение', async () => {
            const ctx = makeCtx();
            const next = makeNext();

            await authGuard(
                () => {
                    throw new Error('db exploded');
                },
                { deniedText: 'Ошибка авторизации' },
            )(ctrlOrCtx(ctx), next.fn);

            expect(next.called).toBe(false);
            expect(ctx.text).toBe('Ошибка авторизации');
        });

        it('использует текст по умолчанию, когда deniedText не задан', async () => {
            const ctx = makeCtx();
            const next = makeNext();

            await authGuard(() => false)(ctrlOrCtx(ctx), next.fn);

            expect(ctx.text).toBe('Доступ запрещён.');
        });

        it('поддерживает async check', async () => {
            const ctx = makeCtx();
            const next = makeNext();

            await authGuard(async () => {
                await new Promise((r) => setTimeout(r, 10));
                return true;
            })(ctrlOrCtx(ctx), next.fn);

            expect(next.called).toBe(true);
        });
    });

    describe('requestId', () => {
        it('проставляет platformOptions.requestId', async () => {
            const ctx = makeCtx();
            const next = makeNext();

            await requestId()(ctx, next.fn);

            expect(next.called).toBe(true);
            const rid = (ctx.platformOptions as Record<string, unknown>).requestId;
            expect(typeof rid).toBe('string');
            expect((rid as string).length).toBeGreaterThan(10);
        });

        it('каждый запрос получает новый id', async () => {
            const ctx1 = makeCtx();
            const ctx2 = makeCtx();
            await requestId()(ctx1, () => Promise.resolve());
            await requestId()(ctx2, () => Promise.resolve());
            expect((ctx1.platformOptions as Record<string, unknown>).requestId).not.toEqual(
                (ctx2.platformOptions as Record<string, unknown>).requestId,
            );
        });
    });

    describe('maintenance', () => {
        it('пропускает, когда check возвращает false', async () => {
            const ctx = makeCtx();
            const next = makeNext();

            await maintenance(() => false)(ctx, next.fn);

            expect(next.called).toBe(true);
            expect(ctx.text).toBe('');
        });

        it('блокирует запрос, когда check возвращает true', async () => {
            const ctx = makeCtx();
            const next = makeNext();

            await maintenance(() => true, { message: 'На обслуживании' })(ctx, next.fn);

            expect(next.called).toBe(false);
            expect(ctx.text).toBe('На обслуживании');
        });

        it('при ошибке в check — пропускает (не ломает работу бота)', async () => {
            const ctx = makeCtx();
            const next = makeNext();

            await maintenance(() => {
                throw new Error('Сервис-чек упал');
            })(ctx, next.fn);

            expect(next.called).toBe(true);
            expect(ctx.text).toBe('');
        });

        it('поддерживает async check', async () => {
            const ctx = makeCtx();
            const next = makeNext();
            let down = false;

            const mw = maintenance(async () => down);
            await mw(ctx, next.fn);
            expect(next.called).toBe(true);

            down = true;
            const next2 = makeNext();
            await mw(ctx, next2.fn);
            expect(next2.called).toBe(false);
        });
    });

    describe('ipFilter', () => {
        function makeCtxWithIp(ip: string | null): BotController {
            const appContext = new AppContext();
            appContext.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
            const ctx = new BotController(appContext);
            if (ip) {
                // IP заполняется фреймворком в webhookHandle из сокета HTTP-запроса
                ctx.platformOptions.clientIp = ip;
            }
            return ctx;
        }

        it('whitelist: пропускает разрешённый IP', async () => {
            const ctx = makeCtxWithIp('192.168.1.10');
            const next = makeNext();
            await ipFilter({ whitelist: ['192.168.1.0/24'] })(ctx as never, next.fn);
            expect(next.called).toBe(true);
        });

        it('whitelist: блокирует IP не из списка', async () => {
            const ctx = makeCtxWithIp('10.0.0.5');
            const next = makeNext();
            await ipFilter({ whitelist: ['192.168.1.0/24'], deniedText: 'No' })(
                ctx as never,
                next.fn,
            );
            expect(next.called).toBe(false);
            expect(ctx.text).toBe('No');
        });

        it('blacklist: блокирует IP из списка', async () => {
            const ctx = makeCtxWithIp('1.2.3.4');
            const next = makeNext();
            await ipFilter({ blacklist: ['1.2.3.4'], deniedText: 'Blocked' })(
                ctx as never,
                next.fn,
            );
            expect(next.called).toBe(false);
            expect(ctx.text).toBe('Blocked');
        });

        it('blacklist: пропускает IP не из списка', async () => {
            const ctx = makeCtxWithIp('1.2.3.5');
            const next = makeNext();
            await ipFilter({ blacklist: ['1.2.3.4'] })(ctx as never, next.fn);
            expect(next.called).toBe(true);
        });

        it('IPv6-mapped нормализуется к IPv4', async () => {
            const ctx = makeCtxWithIp('::ffff:192.168.1.10');
            const next = makeNext();
            await ipFilter({ whitelist: ['192.168.1.0/24'] })(ctx as never, next.fn);
            expect(next.called).toBe(true);
        });

        it('без IP клиента запрос по умолчанию пропускается', async () => {
            const ctx = makeCtxWithIp(null);
            const next = makeNext();
            await ipFilter({ whitelist: ['192.168.1.0/24'] })(ctx as never, next.fn);
            expect(next.called).toBe(true);
        });

        it('rejectWithoutIp: запрос без IP клиента отклоняется', async () => {
            const ctx = makeCtxWithIp(null);
            const next = makeNext();
            await ipFilter({
                whitelist: ['192.168.1.0/24'],
                deniedText: 'No ip',
                rejectWithoutIp: true,
            })(ctx as never, next.fn);
            expect(next.called).toBe(false);
            expect(ctx.text).toBe('No ip');
        });

        it('0.0.0.0/0 в whitelist разрешает любой IP', async () => {
            const ctx = makeCtxWithIp('8.8.8.8');
            const next = makeNext();
            await ipFilter({ whitelist: ['0.0.0.0/0'] })(ctx as never, next.fn);
            expect(next.called).toBe(true);
        });

        it('без clientIp middleware пропускает (полезно для тестов через Bot.run)', async () => {
            const ctx = makeCtxWithIp(null);
            const next = makeNext();
            await ipFilter({ blacklist: ['*'] })(ctx as never, next.fn);
            expect(next.called).toBe(true);
        });

        it('без clientIp предупреждает о пропуске без фильтрации (и только один раз)', async () => {
            const appContext = new AppContext();
            const warnSpy = jest.fn();
            appContext.setLogger({ log: () => {}, error: () => {}, warn: warnSpy });
            const ctx = new BotController(appContext);
            const middleware = ipFilter({ whitelist: ['10.0.0.1'] });
            const next = makeNext();

            await middleware(ctx as never, next.fn);
            await middleware(ctx as never, next.fn);

            expect(next.called).toBe(true);
            // Fail-open по построению (тесты/консоль), но он не должен быть тихим:
            // предупреждение выводится, причём один раз на инстанс middleware.
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(String(warnSpy.mock.calls[0][0])).toContain('без IP клиента');
        });

        it('IPv6: whitelist с точным адресом ::1 пропускает ::1', async () => {
            const ctx = makeCtxWithIp('::1');
            const next = makeNext();
            await ipFilter({ whitelist: ['::1'] })(ctx as never, next.fn);
            expect(next.called).toBe(true);
        });

        it('IPv6: whitelist с префиксом 2001:db8::/32 пропускает адрес из префикса', async () => {
            const ctx = makeCtxWithIp('2001:db8::1');
            const next = makeNext();
            await ipFilter({ whitelist: ['2001:db8::/32'] })(ctx as never, next.fn);
            expect(next.called).toBe(true);
        });

        it('IPv6: whitelist с префиксом 2001:db8::/32 блокирует чужой IPv6', async () => {
            const ctx = makeCtxWithIp('2001:db9::1');
            const next = makeNext();
            await ipFilter({ whitelist: ['2001:db8::/32'], deniedText: 'No' })(
                ctx as never,
                next.fn,
            );
            expect(next.called).toBe(false);
            expect(ctx.text).toBe('No');
        });

        it('IPv6: blacklist с префиксом блокирует адрес из префикса', async () => {
            const ctx = makeCtxWithIp('2001:db8::dead');
            const next = makeNext();
            await ipFilter({ blacklist: ['2001:db8::/32'], deniedText: 'Blocked' })(
                ctx as never,
                next.fn,
            );
            expect(next.called).toBe(false);
            expect(ctx.text).toBe('Blocked');
        });

        it('IPv6-клиент под IPv4-правило whitelist не попадает (задокументированный fail-closed)', async () => {
            const ctx = makeCtxWithIp('::1');
            const next = makeNext();
            await ipFilter({ whitelist: ['192.168.1.0/24'] })(ctx as never, next.fn);
            expect(next.called).toBe(false);
        });

        it('IPv6-клиент под IPv4-правило blacklist не попадает (задокументированный fail-open)', async () => {
            const ctx = makeCtxWithIp('::1');
            const next = makeNext();
            await ipFilter({ blacklist: ['1.2.3.4'] })(ctx as never, next.fn);
            expect(next.called).toBe(true);
        });

        it('IPv6-mapped в hex-форме ::ffff:102:304 приводится к IPv4', async () => {
            const ctx = makeCtxWithIp('::ffff:102:304'); // = 1.2.3.4
            const next = makeNext();
            await ipFilter({ blacklist: ['1.2.3.4'], deniedText: 'Blocked' })(
                ctx as never,
                next.fn,
            );
            expect(next.called).toBe(false);
            expect(ctx.text).toBe('Blocked');
        });

        it('IPv4-адрес выше 127.255.x.x корректно сравнивается по маске', async () => {
            const ctx = makeCtxWithIp('200.100.50.25');
            const next = makeNext();
            await ipFilter({ whitelist: ['200.100.50.0/24'] })(ctx as never, next.fn);
            expect(next.called).toBe(true);
        });
    });
});

// Хелпер, чтобы не поднимать лишний cast: BotController сам по себе — ctx
function ctrlOrCtx(ctx: BotController): BotController {
    return ctx;
}
