# CLI — AGENTS.md

> Инструкции для AI-агента, работающего с CLI генератором umbot-проектов.

## Что делает CLI

CLI берёт `flow.json` (экспорт из visual editor) и генерирует готовый TypeScript-проект umbot. Считай CLI
production-поверхностью продукта: ошибка в шаблоне или генераторе сразу становится ошибкой в пользовательском проекте.

**Команда:**

```bash
npx umbot create from-flow flow.json --output ./my-bot
```

**Результат:**

```
my-bot/
├── src/
│   ├── index.ts    # Готовый код бота
│   └── utils.ts    # Вспомогательные функции setText/setTTS
├── package.json
└── tsconfig.json
```

## Файлы

| Файл                               | Назначение                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flowGenerator.js`                 | Основной генератор `from-flow`. Читает JSON, генерирует `src/index.ts`, `src/utils.ts`, `package.json`, `tsconfig.json`.                                |
| `umbot.js`                         | Точка входа CLI: разбор `argv`, чтение конфиг-JSON. В JSDoc-шапке — ручной `@version`.                                                                  |
| `controllers/ConsoleController.js` | Диспетчер всех команд и текст справки (`infoText`). Меняешь команду или флаг — правь справку.                                                           |
| `controllers/CreateController.js`  | Шаблонный `create`: генерация проекта из `template/`, Dockerfile, файл деплоя.                                                                          |
| `controllers/WebhookController.js` | Команда `webhook`: регистрирует вебхук Telegram/MAX с секретом и пишет секрет в `.env` только после успеха.                                             |
| `controllers/DoctorController.js`  | Команда `doctor`: Node.js, umbot в node_modules, `.env`/`.gitignore`, токены платформ по API, состояние вебхуков. Токены не выводит, код 1 при ошибках. |
| `utils.js`, `index.ts`             | Файловые хелперы CLI и TS-обёртка.                                                                                                                      |
| `template/`                        | Шаблоны генерируемого проекта: восемь вариантов `index*.ts.text`, `package.json.text` (ручной пин версии `umbot`), `tsconfig.json`, `gitignore.text`.   |

Тесты: каталог `tests/cli/` (Jest) — `flowGenerator`, `flowGeneratorUserScenario`, `flowUtilsIsEqual`,
`createController`, `consoleController`, `deploySanitize`, `webhookController`, `doctorController`. При изменении генератора или шаблонов добавляй проверку
именно того кода/файла, который получит пользователь.

Воркфлоу правок в `cli/` (что проверить, что обновить, чем верифицировать) — скилл `umbot-cli-change`.
Этот файл описывает устройство генератора и обновляется вместе с ним: новая функция, новое правило генерации или
закрытый баг фиксируются здесь в том же изменении (корневой AGENTS.md, раздел 6).

## Архитектура генератора

### Ключевые функции

| Функция                                        | Назначение                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `escapeStr(s)`                                 | Экранирует строки (кавычки, бэктики, $, переносы).                                                                                                                 |
| `isValidJSIdentifier(name)`                    | Проверяет, является ли строка валидным JS-идентификатором.                                                                                                         |
| `userDataAccess(name)`                         | Безопасное обращение к userData: `ctrl.userData.x` или `ctrl.userData['x']`.                                                                                       |
| `textExpr(text, options?)`                     | `{{var}}` → `` `${ctrl.userData.var}` ``; `options.env` — `{{env.NAME}}` → `env('NAME')` (только http_request), `options.encodeVars` — `encodeURIComponent` (URL). |
| `extractHttpSecrets(doc)`                      | До генерации переносит секреты http_request (заголовки, параметры URL, ключи JSON-тела) в `.env` как `HTTP_*`, в doc — `{{env.HTTP_*}}`.                           |
| `getUrlOriginError(url)`                       | Ошибка `validate`, если переменная сценария стоит в адресе сервера URL (SSRF).                                                                                     |
| `httpHeadersExpr(headers)`                     | Литерал заголовков с шаблонами значений.                                                                                                                           |
| `collectVarNames(doc)`                         | Собирает имена переменных из всех узлов.                                                                                                                           |
| `parseArithmeticExpression(expr, varNames)`    | Разбирает ограниченную арифметику flow без исполнения произвольного кода.                                                                                          |
| `generateActionFunc(block, varNames, indent)`  | Генерирует код действия (set_variable, random_number, http_request).                                                                                               |
| `generateConditionFunc(cond, ...)`             | Генерирует `if/else` из условия (7 параметров).                                                                                                                    |
| `slotLiteral(slot, isPattern)`                 | Литерал слота команды: строковый слот — в нижнем регистре, слот-регулярка — как есть.                                                                              |
| `generateButtonCode(buttons, indent, shuffle)` | Генерирует `addBtn()` / `addLink()`.                                                                                                                               |
| `generateCardCode(card, indent)`               | Генерирует `card.addImage()`.                                                                                                                                      |
| `generateBlockFunc(block, ...)`                | Генерирует функцию `__name(ctrl)` из блока (5 параметров).                                                                                                         |
| `findNextNonBlockNode(doc, fromId)`            | Ищет следующий command/step в цепочке (лимит 20).                                                                                                                  |
| `generateIndexTs(doc)`                         | Главная функция. Генерирует полный `src/index.ts`.                                                                                                                 |
| `generateUtils(options?)`                      | Генерирует `src/utils.ts` с setText/setTTS/fetchWithTimeout; `needsEnv` — хелпер `env()` поверх `loadEnvFile`.                                                     |
| `generatePackageJson(doc)`                     | Генерирует `package.json`.                                                                                                                                         |
| `generateTsConfig()`                           | Генерирует `tsconfig.json`.                                                                                                                                        |
| `generateFromFlow(flowJsonPath, outputPath)`   | Точка входа: читает JSON, вызывает все генераторы, записывает файлы.                                                                                               |

### Поток генерации

```
generateFromFlow(jsonPath, outputPath)
├── Читает и валидирует JSON
├── collectVarNames(doc)           → список имён переменных
├── connectedBlocks                → найти связанные блоки
├── generateIndexTs(doc)           → src/index.ts
│   ├── Импорты                   → Bot, platforms, adapter, rand, Text, setText/setTTS
│   ├── bot.use(fullPlatforms)    → платформы
│   ├── bot.use(Adapter())        → адаптер БД
│   ├── bot.setAppConfig()        → isLocalStorage
│   ├── bot.setPlatformParams()   → welcome, help, fallback
│   ├── generateBlockFunc()       → функции __name(ctrl) для standalone блоков
│   ├── Commands                  → bot.addCommand()
│   │   ├── generateActionFunc()  → инлайн действия
│   │   ├── generateConditionFunc() → инлайн условия (с поддержкой thisIntentName для step/command)
│   │   ├── generateButtonCode()  → кнопки
│   │   ├── generateCardCode()    → карточки
│   │   └── findNextNonBlockNode() → thisIntentName
│   ├── Steps                     → bot.addStep()
│   │   └── (аналогично commands)
│   └── Fallback                  → bot.addCommand(FALLBACK_COMMAND, ...)
├── generateUtils()               → src/utils.ts
├── generatePackageJson(doc)      → package.json
└── generateTsConfig()            → tsconfig.json
```

### Правила генерации

1. **Блоки** (action/condition/response) → переиспользуемые функции `__name(ctrl)`.
2. **Команды** вызывают функции блоков, затем навигируют.
3. **Шаги** сохраняют ввод, вызывают функции, навигируют.
4. **Навигация** — `thisIntentName` указывает ТОЛЬКО на command/step.
5. **Условия** — генерируют `if/else` с inline-кодом или вызовом функций.
6. **Branch → step/command** — генерируется `ctrl.thisIntentName = 'name'` (а не `__name(ctrl)`).
7. **Branch → response/action/condition** — генерируется `__name(ctrl)`.
8. **Переменные** — `{{name}}` → `` `${ctrl.userData.name}` `` (template literal).
9. **Текст** — экранирование `` ` `` и `$` перед оборачиванием в template literal.
10. **set_variable** — поддерживает текст, `{{var}}`, системные значения и ограниченную арифметику; произвольный JavaScript остаётся текстом.
11. **Арифметика** — допускает только числа, известные переменные, скобки и операции `+`, `-`, `*`, `/`, `%`; переменные приводятся через `Number()`.
12. **HTTP** — generated code обязан использовать `fetchWithTimeout`, а не прямой `fetch` без ограничения времени.
13. **JSON body** — переменные `{{var}}` внутри JSON body нельзя подставлять через `JSON.parse(template)`: значения
    пользователя должны безопасно сериализоваться через объект и `JSON.stringify`.
14. **Secrets** — реальные токены из `flow.json` нельзя писать в `serverless.yml`, `package.json`, исходники или README.
    В commit-prone файлах используй ссылки на env-переменные. Секреты http_request (в том числе в URL, который
    попадает и в JSDoc-комментарий действия) выносит `extractHttpSecrets` — до генерации любого файла.
    `{{env.NAME}}` раскрывается только в полях http_request, в текстах ответа — никогда.
15. **URL http_request** — переменные сценария кодируются `encodeURIComponent` и допустимы только после адреса
    сервера (`URL_ORIGIN_PATTERN`); адрес сервера — литерал или `{{env.NAME}}`. `{{env.NAME}}` не кодируется.
16. **Output safety** — генератор не должен молча перезаписывать непустую папку. Перезапись разрешена только через
    явный `--force`/`options.force` и должна быть покрыта тестом.
17. **Docker** — production Docker template должен собирать TypeScript с devDependencies в builder-stage, а runtime
    stage оставлять production-only.
18. **Слоты** — строковые слоты команд и welcome генерируются в нижнем регистре (`slotLiteral`): `userCommand`
    фреймворка уже в нижнем. Слоты-регулярки (`isPattern`) регистр не меняют — `\D` ≠ `\d`.

### Исправленные баги

- **Пустой `.gitignore` из npm-пакета** — npm никогда не публикует файлы с именем `.gitignore` (и `.npmrc`, `.npmignore`),
  поэтому шаблон называется `template/gitignore.text`. Без шаблона `create` и `from-flow` падают с ошибкой, а не пишут
  пустой файл. Тест в `flowGenerator.test.ts` («Шаблоны в npm-пакете») запрещает такие имена в `cli/template`.
- **`.env` в `create`** — конфиг проекта читает `.env` всегда (`env: './.env'`), иначе секрет от `umbot webhook`
  не подхватывался. `.env` создаётся из общего шаблона `ENV_TEMPLATE` (`ConsoleController.js`) с пустыми значениями:
  заглушка вроде `VK_SECRET_KEY=your-vk-secret-key` стала бы настоящим секретом и отклоняла все запросы VK.
  Существующий `.env` не перезаписывается. `isEnv` отвечает только за перенос значений из JSON-конфига.
- **textExpr** — экранирование `` ` `` и `${` в шаблонных литералах.
- **set_variable** — выражения разбираются ограниченным парсером, поэтому значения flow не могут внедрить произвольный TypeScript.
- **HTTP headers** — передаются в fetch через fetchOpts.
- **HTTP timeout** — generated HTTP использует `fetchWithTimeout`.
- **HTTP body** — JSON body с `{{var}}` сериализуется безопасно без `JSON.parse(template)`.
- **Секреты http_request в исходнике** — `Authorization`, `api_key` и т.п. из flow.json писались открытым текстом в
  `src/index.ts` (и URL с ключом — в комментарий действия). Теперь они уходят в `.env` (`extractHttpSecrets`).
- **URL http_request без подстановок** — `{{var}}` в адресе вставлялся литералом. Теперь подставляется с
  `encodeURIComponent`, а переменная в адресе сервера отклоняется `validate`.
- **serverless.yml** — хранит ссылки вида `${env:TOKEN_NAME}`, а не значения токенов.
- **outputPath** — непустая папка защищена от случайной перезаписи без `force`.
- **Dockerfile** — builder устанавливает devDependencies перед `npm run build`.
- **isNotEmpty** — добавлен case в switch.
- **needsText** — убрана проверка кнопок, проверяет только isSay\*/isUrl.
- **setTTS** — условный импорт через needsTTS.
- **helpText** — берётся из doc.helpText.text, fallback как запас.
- **branch → step/command** — генерируется thisIntentName вместо несуществующей функции.
- **deploy.js SyntaxError** — escape-последовательности регулярок в template literal `deployScript` были одинарными
  (`\r`, `\u0000`): в генерате получался настоящий перевод строки внутри регулярки, и `npm run deploy` падал сразу.
  В шаблоне генерата обратные слеши пишутся двойными; тест `deploySanitize` исполняет сгенерированный скрипт
  с заглушкой `yc`.
- **deploy.js и .env** — значения разбираются как в `loadEnvFile` фреймворка (инлайн-комментарий « #», кавычки,
  пустые значения); на Windows команда передаётся одной строкой (массив аргументов с `shell: true` — DEP0190).
- **serverless.yml** — убран блок `secrets`, которого деплой не использует; вместо него — комментарий про Lockbox.
- **fetchWithTimeout** — таймаут покрывает и чтение тела ответа (раньше снимался после заголовков).
- **Cloud handler** — передаёт IP клиента (`event.requestContext.identity.sourceIp`) в `webhookEvent` для `ipFilter`
  и декодирует тело при `isBase64Encoded`.
- **mode** — без поля `mode` генерируется `strict_prod`; `setAppMode` стоит сразу после `new Bot()`, до регистрации
  команд (strict_prod проверяет регулярки при регистрации). В шаблонах `create` — тот же порядок.
- **Dockerfile** — каталоги `/app/json` и `/app/logs` создаются и отдаются пользователю `umbot` до `USER`.
- **`validate` и JSON-конфиг `create`** — `umbot.js` читал любой второй аргумент `*.json` как конфиг `create`:
  `validate flow.json` без `name` падал с «Проект не создан», битый JSON не доходил до валидатора. Конфиг читается
  только для `create`; тест запускает `umbot.js validate` дочерним процессом.
- **Поля-массивы узла** — `validateFlowSchema` проверяет, что `actions`, `conditions`, `buttons`, `slots` — массивы
  (элементы первых трёх — объекты): иначе `validate` отвечал «валиден», а генерация падала с «is not iterable».
- **HTTP headers + body** — свои `headers` заменяли `Content-Type: application/json`, и тело уходило как
  `text/plain`. Теперь `Content-Type` добавляется, если в `headers` нет своего (без учёта регистра). `headers`
  принимаются JSON-строкой или объектом (`parseHttpHeaders`), некорректные пропускаются с предупреждением.
- **Регистр слотов** — слот «Погода» из редактора генерировался как есть и не совпадал ни с одной репликой
  (`userCommand` в нижнем регистре). Строковые слоты приводятся к нижнему регистру, регулярки — нет.

## Тесты

```bash
npx jest tests/cli
```

### Покрытые паттерны

| #       | Паттерн                 | Что проверяется                                 |
| ------- | ----------------------- | ----------------------------------------------- |
| 1       | Простая команда         | `addCommand`, `setText`                         |
| 2       | Кнопки                  | `addBtn`, `addLink`                             |
| 3       | Шаг с saveTo            | `saveTo`, `userCommand`                         |
| 4       | Инлайн action (rand)    | `rand()`, импорт                                |
| 5       | Условие (блок)          | Функция `__check(ctrl)`                         |
| 6       | Навигация               | `thisIntentName`                                |
| 7       | Полный цикл             | command → action → step → condition             |
| 8       | Карточка                | `card.addImage`                                 |
| 9       | TTS                     | `setTTS`                                        |
| 10      | HTTP                    | `async fetchWithTimeout`                        |
| 11      | Response блок           | `__help(ctrl)` вызов                            |
| 12      | Карточка в response     | Много изображений                               |
| 13      | isEnd                   | `ctrl.isEnd = true`                             |
| 14      | set_variable expression | ограниченная арифметика и `Number(userData)`    |
| 15      | isEmpty                 | `!ctrl.userData.x`                              |
| 16      | saveAs lowercase        | `toLowerCase()`                                 |
| 17      | Мульти-шаг цепочка      | 3 шага подряд                                   |
| 18      | Операторы               | gt, lt, contains, neq                           |
| 19      | Inline condition        | if/else в command                               |
| 20      | Кнопки в шаге           | `addBtn` в addStep                              |
| 21      | Ошибки                  | Missing file, invalid JSON, missing name/nodes  |
| 22      | Welcome/fallback        | Тексты приветствия                              |
| 23      | set_variable текст      | 'Hello world' → 'Hello world' (в кавычках)      |
| 24      | isNotEmpty              | `!!condVar && condVar !== ''`                   |
| 25      | helpText vs fallback    | helpText.text имеет приоритет                   |
| 26      | Branch → step           | thisIntentName вместо \_\_name(ctrl)            |
| 27      | Регистр слотов          | строки → нижний регистр, `isPattern` — как есть |
| db      | FileAdapter             | Импорт и использование                          |
| dbmongo | MongoAdapter            | Импорт и использование                          |
| dbnone  | Без адаптера            | Нет импорта                                     |
| edge    | Backticks               | Экранирование `` ` `` в тексте                  |
| edge    | ${}                     | Экранирование $ в тексте                        |
| edge    | Пустые {{}}             | Не ломает шаблонный литерал                     |
| edge    | Переменная с точкой     | Скобочный синтаксис `['user.name']`             |
| edge    | Backticks + {{var}}     | Смешанное экранирование                         |
