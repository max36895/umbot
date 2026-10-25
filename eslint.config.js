// eslint.config.js
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = [
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'coverage/**',
            'doc/**',
            'examples/**',
            // Сгенерированные CLI-проекты — это выход генератора, а не исходники umbot
            'build_mode_test/**',
            'dev_min_test/**',
            'dev_mode_test/**',
            // Песочницы аудита/профилировки: сгенерированные CLI-проекты и
            // отладочные скрипты вне дерева исходников
            'audit/**',
            'tmp-surgery/**',
            // Локальные скрипты docs-сервера (деплой документации) — не часть пакета
            'server/**',
        ],
    },
    {
        files: ['**/*.ts'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            parser: tseslint.parser,
            parserOptions: {
                ecmaVersion: 2025,
                sourceType: 'module',
                projectService: true,
                tsconfigRootDir: __dirname,
                allowDefaultProject: true,
            },
            globals: {
                ...globals.node,
                ...globals.es2023,
                ...globals.browser,
                HeadersInit: 'readonly',
                RequestInit: 'readonly',
                RequestInfo: 'readonly',
                BodyInit: 'readonly',
                NodeJS: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            security: require('eslint-plugin-security'),
        },
        rules: {
            ...eslint.configs.recommended.rules,
            ...tseslint.configs.recommended.rules,
            ...require('eslint-config-prettier').rules,

            'security/detect-object-injection': 'off', // много мест где не срабатывает ошибочно
            'security/detect-non-literal-fs-filename': 'off', // Пока отрубаем, так как ожидается что все пути задаст сам программист, и сделает это адекватно
            'security/detect-unsafe-regex': 'error',

            '@typescript-eslint/explicit-function-return-type': 'warn',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/ban-ts-comment': 'error',

            '@typescript-eslint/no-misused-promises': [
                'error',
                {
                    checksVoidReturn: {
                        attributes: false,
                        properties: false,
                        returns: false,
                        arguments: false,
                    },
                },
            ],
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/await-thenable': 'error',

            'require-atomic-updates': 'error',
            // Фигурные скобки обязательны у всех if/else/for/while — однострочные
            // ветки (if (x) return;) запрещены: единый стиль по всему проекту.
            curly: ['error', 'all'],
            'max-lines-per-function': ['warn', { max: 100 }], // Меньшее значение мешает, из-за чего приходиться дробить метод, либо убирать логические разделения, благодаря которым удобнее читать код
            'no-prototype-builtins': 'warn',
            'no-constant-condition': 'warn',
            'no-unused-vars': 'off', // Уже включено правило для ts, это правило для js, поэтому в реалиях ts будет много ошибочных срабатываний
            'no-unused-private-class-members': 'error',
            'no-fallthrough': 'error',
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-constant-binary-expression': 'error',
            'prefer-const': 'error',
            'no-param-reassign': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
            complexity: ['warn', { max: 20, variant: 'classic' }],
            'max-depth': ['warn', { max: 4 }],
        },
    },
    {
        files: ['tests/**/*.test.ts', 'tests/**/*.ts', '*.test.ts'],
        languageOptions: {
            parserOptions: {
                projectService: false,
            },
            globals: {
                ...globals.jest,
            },
        },
        rules: {
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            'require-atomic-updates': 'off',
            '@typescript-eslint/await-thenable': 'off',
            '@typescript-eslint/no-misused-promises': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
            'max-lines-per-function': ['off'],
        },
    },
    {
        files: ['cli/**/*.js', 'cli/**/*.ts'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            parserOptions: {
                projectService: false,
            },
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            security: require('eslint-plugin-security'),
        },
        rules: {
            ...eslint.configs.recommended.rules,
            'security/detect-unsafe-regex': 'error',
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            '@typescript-eslint/await-thenable': 'off',
            '@typescript-eslint/no-misused-promises': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
        },
    },
];
