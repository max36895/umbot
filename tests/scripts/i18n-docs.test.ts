/**
 * scripts/i18n-docs.js: разбиение на блоки, проверки перевода и полный цикл
 * export → import → build во временной папке (UMBOT_I18N_ROOT).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
    blockHash,
    checkTranslation,
    headingSlug,
    needsTranslation,
    splitBlocks,
} from '../../scripts/i18n-docs.js';
import { createTestDir, removeTestDir } from '../helpers/tmpDir';

const SCRIPT = resolve(__dirname, '..', '..', 'scripts', 'i18n-docs.js');

describe('i18n-docs: блоки', () => {
    it('режет по пустым строкам и не режет блок кода с пустыми строками', () => {
        const md =
            '# Заголовок\n\nАбзац\nвторая строка\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n- пункт';
        expect(splitBlocks(md)).toEqual([
            '# Заголовок',
            'Абзац\nвторая строка',
            '```ts\nconst a = 1;\n\nconst b = 2;\n```',
            '- пункт',
        ]);
    });

    it('оставляет блок кода внутри пункта списка частью пункта', () => {
        const md = '4. Выполните:\n    ```bash\n    npx umbot\n    ```\n5. Готово';
        expect(splitBlocks(md)).toEqual([md]);
    });

    it('сборка из блоков воспроизводит исходный текст', () => {
        const md = readFileSync(resolve(__dirname, '../../src/docs/getting-started.md'), 'utf8')
            .replace(/\r\n/g, '\n')
            .trim();
        expect(splitBlocks(md).join('\n\n')).toBe(md);
    });

    it('хэш не зависит от хвостовых пробелов и CRLF', () => {
        expect(blockHash('Абзац  \nстрока')).toBe(blockHash('Абзац\nстрока'));
        expect(splitBlocks('a\r\nb')).toEqual(['a\nb']);
    });

    it('переводит только блоки с кириллицей', () => {
        expect(needsTranslation('```ts\nbot.start();\n```')).toBe(false);
        expect(needsTranslation('Текст')).toBe(true);
    });

    it('строит якорь как typedoc', () => {
        // Значения сверены с id в HTML, который собирает typedoc 0.28.
        expect(headingSlug('Команды и шаги — `addCommand` / `addStep`')).toBe('команды-и-шаги-');
        expect(headingSlug('Деплой — `start`, `webhookHandle`, Docker, Express')).toBe(
            'деплой-docker-express',
        );
        expect(headingSlug('🌐 Универсальный webhook-обработчик')).toBe(
            '🌐-универсальный-webhook-обработчик',
        );
        expect(headingSlug('Running in production')).toBe('running-in-production');
    });
});

describe('i18n-docs: проверки перевода', () => {
    it('принимает корректный перевод', () => {
        expect(
            checkTranslation('Порт `3000`, 10 000 запросов', 'Port `3000`, 10,000 requests'),
        ).toEqual([]);
    });

    it.each([
        ['Вызов `bot.start()`', 'Call `bot.run()`', 'фрагменты `кода`'],
        ['Лимит 30 запросов', 'Limit of 20 requests', 'числа'],
        ['См. [доку](https://a.ru/x)', 'See [docs](https://b.ru/x)', 'адреса ссылок'],
        ['Текст', 'Text и ещё', 'кириллица'],
    ])('отклоняет: %s → %s', (ru, en, problem) => {
        expect(checkTranslation(ru, en).join()).toContain(problem);
    });

    it('в коде переводятся строки и комментарии, но не вызовы и не число строк', () => {
        const ru = "```ts\n// Привет\nbot.addCommand('hi', ['привет']);\n```";
        expect(
            checkTranslation(ru, "```ts\n// Hello\nbot.addCommand('hi', ['hello']);\n```"),
        ).toEqual([]);
        expect(
            checkTranslation(ru, "```ts\n// Hello\nbot.addStep('hi', ['hello']);\n```").join(),
        ).toContain('вызовы функций');
        expect(
            checkTranslation(ru, "```ts\nbot.addCommand('hi', ['hello']);\n```").join(),
        ).toContain('число строк');
    });

    it('проверяет код внутри цитаты как код, а текст цитаты — как текст', () => {
        const ru = '> Пример `bot.start()`:\n>\n> ```ts\n> bc.text = `Сейчас ${t}`;\n> ```';
        expect(
            checkTranslation(
                ru,
                '> Example `bot.start()`:\n>\n> ```ts\n> bc.text = `Now ${t}`;\n> ```',
            ),
        ).toEqual([]);
        expect(
            checkTranslation(ru, '> Example:\n>\n> ```ts\n> bc.text = `Now ${t}`;\n> ```').join(),
        ).toContain('фрагменты `кода`');
        expect(
            checkTranslation(
                ru,
                '> Example `bot.start()`:\n>\n> ```ts\n> bc.text = fmt(`Now ${t}`);\n> ```',
            ).join(),
        ).toContain('вызовы функций');
    });

    it('разрешает переводить адрес-заглушку и оставлять русский якорь ссылки', () => {
        expect(
            checkTranslation(
                '```bash\nnpx umbot webhook telegram https://ваш-домен/webhook\n```',
                '```bash\nnpx umbot webhook telegram https://your-domain/webhook\n```',
            ),
        ).toEqual([]);
        expect(
            checkTranslation(
                'См. [раздел](https://a.ru/guide#порядок-диспетчера)',
                'See [the section](https://a.ru/guide#порядок-диспетчера)',
            ),
        ).toEqual([]);
    });
});

describe('i18n-docs: export → import → build', () => {
    let root: string;

    /**
     * Запускает скрипт с корнем во временной папке.
     * @param args Аргументы
     * @returns Вывод скрипта
     */
    function run(...args: string[]): string {
        return execFileSync(process.execPath, [SCRIPT, ...args], {
            encoding: 'utf8',
            env: { ...process.env, UMBOT_I18N_ROOT: root },
            stdio: 'pipe',
        });
    }

    /**
     * Перевод в формате pending.md.
     * @param translations Хэш → перевод
     */
    function writeTranslation(translations: Record<string, string>): string {
        const file = join(root, 'translated.md');
        writeFileSync(
            file,
            Object.entries(translations)
                .map(([hash, text]) => `<!-- block ${hash} page -->\n\n${text}`)
                .join('\n\n'),
        );
        return file;
    }

    beforeEach(() => {
        root = createTestDir('i18n');
        mkdirSync(join(root, 'docs'));
        mkdirSync(join(root, 'i18n', 'en'), { recursive: true });
        writeFileSync(
            join(root, 'i18n', 'en', 'config.json'),
            JSON.stringify({
                pages: ['docs/page.md'],
                notice: '> Machine-translated: [original]({url})',
            }),
        );
        writeFileSync(
            join(root, 'docs', 'page.md'),
            '# Заголовок\n\nСм. [ниже](#раздел-два).\n\n```ts\nbot.start();\n```\n\n## Раздел два\n\nТекст.\n',
        );
    });

    afterEach(async () => {
        await removeTestDir(root);
    });

    it('собирает страницу с переводом, плашкой и переведёнными якорями', () => {
        run('export');
        const pending = JSON.parse(
            readFileSync(join(root, 'i18n/en/pending.json'), 'utf8'),
        ) as Record<string, { ru: string }>;
        // Блок кода без кириллицы не переводится.
        expect(Object.values(pending).map((block) => block.ru)).toEqual([
            '# Заголовок',
            'См. [ниже](#раздел-два).',
            '## Раздел два',
            'Текст.',
        ]);
        const [title, link, heading, text] = Object.keys(pending);
        run(
            'import',
            writeTranslation({
                [title]: '# Title',
                [link]: 'See [below](#раздел-два).',
                [heading]: '## Section two',
                [text]: 'Text.',
            }),
        );
        expect(run('status')).toContain('100%');

        run('build');
        expect(readFileSync(join(root, 'i18n/en/build/docs/page.md'), 'utf8')).toBe(
            '# Title\n\n> Machine-translated: [original](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/docs/page)\n\n' +
                'See [below](#section-two).\n\n```ts\nbot.start();\n```\n\n## Section two\n\nText.\n',
        );
    });

    it('не принимает перевод с ошибкой и не берёт устаревший перевод после правки оригинала', () => {
        run('export');
        const pending = JSON.parse(
            readFileSync(join(root, 'i18n/en/pending.json'), 'utf8'),
        ) as Record<string, { ru: string }>;
        const textHash = Object.keys(pending).find(
            (hash) => pending[hash].ru === 'Текст.',
        ) as string;

        expect(() => run('import', writeTranslation({ [textHash]: 'Текст.' }))).toThrow();
        run('import', writeTranslation({ [textHash]: 'Text.' }));

        writeFileSync(join(root, 'docs', 'page.md'), '# Заголовок\n\nНовый текст.\n');
        expect(run('status')).toContain('без перевода: 2 из 2');
        run('build');
        expect(readFileSync(join(root, 'i18n/en/build/docs/page.md'), 'utf8')).toContain(
            'Новый текст.',
        );

        expect(run('prune')).toContain('Удалено устаревших переводов: 1');
    });
});
