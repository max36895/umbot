/**
 * Регресс: fetchWithTimeout в сгенерированном src/utils.ts ограничивал только
 * ожидание заголовков. Сервер, который сразу отдал заголовки и медленно отдаёт
 * тело, задерживал ответ бота без ограничения (правило 12 cli/AGENTS.md).
 * Тест исполняет именно сгенерированный код: utils.ts транспилируется и
 * вызывается против локального HTTP-сервера.
 */
import * as fs from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as path from 'path';
import * as ts from 'typescript';
import { generateFromFlow } from '../../cli/flowGenerator';
import { createTestDir, removeTestDir } from '../helpers/tmpDir';

type TFetchWithTimeout = (url: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;

describe('сгенерированный fetchWithTimeout', () => {
    let dir: string;
    let server: http.Server;
    let baseUrl: string;
    let fetchWithTimeout: TFetchWithTimeout;

    beforeAll(async () => {
        dir = createTestDir('fetchtimeout');
        const flowPath = path.join(dir, 'flow.json');
        fs.writeFileSync(
            flowPath,
            JSON.stringify({
                name: 'fetch-test',
                nodes: [
                    {
                        type: 'command',
                        id: 'c1',
                        name: 'weather',
                        slots: ['погода'],
                        actions: [
                            { type: 'http_request', url: 'https://example.com', method: 'GET' },
                        ],
                        response: { text: 'ok', buttons: [], sounds: [] },
                    },
                ],
                edges: [],
            }),
        );
        const outputPath = path.join(dir, 'bot');
        generateFromFlow(flowPath, outputPath);
        const source = fs.readFileSync(path.join(outputPath, 'src', 'utils.ts'), 'utf8');
        const js = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText;
        const jsPath = path.join(dir, 'utils.cjs');
        // umbot в utils.ts импортируется только ради типа — в рантайме модуль не нужен.
        fs.writeFileSync(jsPath, js.replace(/require\("umbot"\)/g, '{}'));
        fetchWithTimeout = require(jsPath).fetchWithTimeout;

        server = http.createServer((req, res) => {
            if (req.url === '/slow-body') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.write('{"a":');
                setTimeout(() => res.end('1}'), 1500).unref();
                return;
            }
            if (req.url === '/no-content') {
                res.writeHead(204);
                res.end();
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json', 'X-Test': 'yes' });
            res.end('{"ok":true}');
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await removeTestDir(dir);
    });

    it('обрывает запрос, если тело не пришло за timeoutMs', async () => {
        const start = Date.now();
        await expect(
            fetchWithTimeout(`${baseUrl}/slow-body`, {}, 300).then((r) => r.text()),
        ).rejects.toThrow();
        expect(Date.now() - start).toBeLessThan(1200);
    });

    it('возвращает ответ со статусом, заголовками и телом', async () => {
        const response = await fetchWithTimeout(`${baseUrl}/ok`, {}, 2000);
        expect(response.status).toBe(200);
        expect(response.headers.get('x-test')).toBe('yes');
        expect(await response.json()).toEqual({ ok: true });
    });

    it('корректно обрабатывает ответ без тела (204)', async () => {
        const response = await fetchWithTimeout(`${baseUrl}/no-content`, {}, 2000);
        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
    });
});
