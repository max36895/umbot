import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { generateFromFlow } from './../../cli/flowGenerator';

/**
 * isEqual из сгенерированного utils.ts: eq/neq сравнивают значения как строки —
 * так же, как превью визуального редактора.
 */
describe('generated utils.ts: isEqual', () => {
    let isEqual: (a: unknown, b: unknown) => boolean;
    let dir: string;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umbot-isequal-'));
        const jsonPath = path.join(dir, 'flow.json');
        fs.writeFileSync(jsonPath, JSON.stringify({ name: 'test', nodes: [], edges: [] }));
        generateFromFlow(jsonPath, path.join(dir, 'bot'));
        const source = fs.readFileSync(path.join(dir, 'bot', 'src', 'utils.ts'), 'utf8');
        const js = ts.transpileModule(source.replace(/^import .*$/m, ''), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        }).outputText;
        const jsPath = path.join(dir, 'utils.js');
        fs.writeFileSync(jsPath, js);
        isEqual = (require(jsPath) as { isEqual: typeof isEqual }).isEqual;
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('ввод-строка равна числу с тем же значением', () => {
        expect(isEqual('42', 42)).toBe(true);
        expect(isEqual(2, 2)).toBe(true);
        expect(isEqual('7', 8)).toBe(false);
    });

    it('строки сравниваются как строки', () => {
        expect(isEqual('да', 'да')).toBe(true);
        expect(isEqual('Да', 'да')).toBe(false);
        expect(isEqual('abc', 0)).toBe(false);
    });

    it('пустые значения не превращаются в 0', () => {
        expect(isEqual('', 0)).toBe(false);
        expect(isEqual(undefined, '')).toBe(true);
        expect(isEqual(null, 0)).toBe(false);
    });
});
