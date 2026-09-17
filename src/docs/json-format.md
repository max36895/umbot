# Формат flow.json визуального редактора umbot

> Полная спецификация JSON-формата `flow.json` (экспорт [Umbot Flow](https://flow.maxim-m.ru)) для генератора проектов `npx umbot create from-flow`.
> На основе этого описания можно построить генератор для любой платформы (Telegram, Alisa и т.д.).

---

## Быстрый старт

Если вы скачали JSON-файл из [визуального редактора](https://flow.maxim-m.ru), выполните три шага:

1. Установите [Node.js](https://nodejs.org) (версия 22+ — её требует сгенерированный проект)
2. Положите скачанный `flow.json` в любую папку
3. Выполните в терминале:

```bash
npx umbot create from-flow flow.json --output ./my-bot
```

Готовый TypeScript-проект появится в папке `my-bot`. Установите зависимости, соберите и запустите:

```bash
cd my-bot
npm install
npm run build
npm start
```

> Проект, сгенерированный через `from-flow`, не содержит dev-сервера с hot-reload — скрипта `npm run dev` нет.
> Для разработки используйте классический цикл: изменить код → `npm run build` → `npm start`.
> Шаблоны `default`/`quiz` через CLI hot-reload тоже не дают (запуск там тот же: `npm run build && npm start`),
> но при создании с режимом `dev` точка входа использует `BotTest` — интерактивную консольную отладку без HTTP-сервера.

Подробнее о CLI: [документация umbot CLI](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.cli_README.html)

---

## Структура документа

```json
{
    "schemaVersion": "1.0",
    "name": "my-bot",
    "version": "1.0.0",
    "description": "Описание бота",
    "platforms": ["telegram", "alisa"],
    "database": { "type": "file", "config": {} },
    "isLocalStorage": true,
    "nodes": [],
    "edges": [],
    "fallback": { "text": "Не понял" },
    "welcome": { "text": "Привет! Я бот.", "buttons": [] },
    "helpText": { "text": "Справка по боту" },
    "variables": { "userName": "Имя пользователя", "score": "Счёт игрока" }
}
```

| Поле             | Тип      | Описание                                                                                                                                                           |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schemaVersion`  | string   | Версия формата. По умолчанию `"1.0"`.                                                                                                                              |
| `name`           | string   | Имя проекта (используется в package.json и заголовке).                                                                                                             |
| `version`        | string   | Версия проекта (semver).                                                                                                                                           |
| `description`    | string   | Описание бота.                                                                                                                                                     |
| `platforms`      | string[] | Платформы: `"telegram"`, `"alisa"`, `"marusia"`, `"vk"`, `"smart_app"`, `"max_app"`, `"viber"`.                                                                    |
| `database`       | object   | Конфигурация БД (см. ниже).                                                                                                                                        |
| `isLocalStorage` | boolean  | Сохранять userData в локальное хранилище платформы (голосовые платформы) вместо БД.                                                                                |
| `nodes`          | array    | Все узлы графа (команды, шаги, условия, действия, ответы).                                                                                                         |
| `edges`          | array    | Связи между узлами.                                                                                                                                                |
| `fallback`       | object   | Ответ на нераспознанный ввод: `{ "text": "..." }`.                                                                                                                 |
| `mode`           | string   | Режим приложения: `"dev"`, `"prod"`, `"strict_prod"` — генерируется `bot.setAppMode(...)`. Без поля — режим по умолчанию (dev).                                    |
| `welcome`        | object   | Приветствие из настроек: `{ "text": "...", "buttons": [] }`. Используется, если в сценарии нет ноды welcome: срабатывает на `/start`, «привет» и в начале диалога. |
| `helpText`       | object   | Текст справки (опционально): `{ "text": "..." }`. Используется, если нет ноды help: отвечает на «помощь»/«что ты умеешь».                                          |
| `tokens`         | object   | Токены платформ: `{ "telegram": "..." }`. Переносятся в `.env` проекта; можно оставить пустыми и вписать в `.env` после генерации.                                 |
| `variables`      | object   | Зарегистрированные переменные: `{ "name": "comment", ... }`. Поле визуального редактора — генератор игнорирует.                                                    |

---

## Архитектура umbot: 2 типа обработчиков

В umbot **только 2 типа обработчиков**:

1. **`bot.addCommand(name, slots, handler)`** — реагирует на слова-триггеры (слоты).
2. **`bot.addStep(name, handler)`** — активируется через `ctrl.thisIntentName = 'stepName'`.

**Действия, условия, ответы — это INLINE КОД внутри обработчиков**. Standalone блоки (response/action/condition),
подключённые через edges, генерируются как отдельные переиспользуемые функции `__<name>(ctrl: BotController)`,
вызываемые из команд/шагов (или из других блоков). Узел без входящих edges в код не попадает вовсе.

---

## Типы узлов (Nodes)

### Command Node

Команда — реагирует на слова-триггеры.

```json
{
    "type": "command",
    "id": "node_123",
    "name": "greeting",
    "slots": ["привет", "здравствуй"],
    "isPattern": false,
    "saveTo": "userName",
    "actions": [],
    "conditions": [],
    "response": {
        "text": "Привет, {{userName}}!",
        "tts": "Привет!",
        "emotion": "good",
        "isEnd": false,
        "buttons": [],
        "card": null,
        "sounds": []
    }
}
```

| Поле         | Тип             | Обязательно | Описание                                                        |
| ------------ | --------------- | ----------- | --------------------------------------------------------------- |
| `type`       | `"command"`     | да          | Тип узла                                                        |
| `id`         | string          | да          | Уникальный ID                                                   |
| `name`       | string          | да          | Имя команды (в генерируемом коде)                               |
| `slots`      | string[]        | да          | Слова-триггеры (без учёта регистра)                             |
| `isPattern`  | boolean         | нет         | Если `true`, слоты — регулярные выражения                       |
| `saveTo`     | string          | нет         | Сохранить ввод в userData                                       |
| `varComment` | string          | нет         | Комментарий к переменной (поле редактора, генератор игнорирует) |
| `actions`    | ActionBlock[]   | нет         | Инлайн-действия                                                 |
| `conditions` | FlowCondition[] | нет         | Инлайн-условия                                                  |
| `response`   | FlowResponse    | да          | Настройки ответа                                                |

### Step Node

Шаг — запрашивает ввод и сохраняет его.

```json
{
    "type": "step",
    "id": "node_456",
    "name": "ask_name",
    "prompt": {
        "text": "Как вас зовут?",
        "tts": "",
        "emotion": "",
        "buttons": [],
        "card": null
    },
    "saveTo": "userName",
    "saveAs": "original",
    "actions": [],
    "conditions": []
}
```

| Поле         | Тип                           | Обязательно | Описание                                                        |
| ------------ | ----------------------------- | ----------- | --------------------------------------------------------------- |
| `type`       | `"step"`                      | да          | Тип узла                                                        |
| `id`         | string                        | да          | Уникальный ID                                                   |
| `name`       | string                        | да          | Имя шага (для thisIntentName)                                   |
| `prompt`     | FlowPrompt                    | да          | Текст вопроса, TTS, кнопки, карточка                            |
| `saveTo`     | string                        | да          | Поле в userData для сохранения                                  |
| `saveAs`     | `"original"` \| `"lowercase"` | нет         | Регистр сохраняемого ввода                                      |
| `varComment` | string                        | нет         | Комментарий к переменной (поле редактора, генератор игнорирует) |
| `actions`    | ActionBlock[]                 | нет         | Инлайн-действия                                                 |
| `conditions` | FlowCondition[]               | нет         | Инлайн-условия                                                  |

> Навигация между шагами осуществляется через edges (связи), а не через поле `next`.

### Condition Node (блок условия)

Условие — проверяет переменную и ведёт по веткам True/False через edges.

```json
{
    "type": "condition",
    "id": "node_789",
    "name": "check_age",
    "variable": "age",
    "operator": "gte",
    "value": 18
}
```

| Поле       | Тип            | Описание                                              |
| ---------- | -------------- | ----------------------------------------------------- |
| `type`     | `"condition"`  | Тип узла                                              |
| `id`       | string         | Уникальный ID                                         |
| `name`     | string         | Имя узла (для thisIntentName)                         |
| `variable` | string         | Имя переменной из userData                            |
| `operator` | string         | Оператор сравнения (см. таблицу ниже)                 |
| `value`    | string\|number | Значение для сравнения (может быть именем переменной) |

> responseTrue/responseFalse не хранятся в standalone condition узле — они задаются через branch_true/branch_false edges.

**Операторы:**

| Оператор     | Код                             | Описание                  |
| ------------ | ------------------------------- | ------------------------- |
| `eq`         | `a === b`                       | Равно                     |
| `neq`        | `a !== b`                       | Не равно                  |
| `gt`         | `Number(a) > Number(b)`         | Больше                    |
| `gte`        | `Number(a) >= Number(b)`        | Больше или равно          |
| `lt`         | `Number(a) < Number(b)`         | Меньше                    |
| `lte`        | `Number(a) <= Number(b)`        | Меньше или равно          |
| `contains`   | `String(a).includes(String(b))` | Содержит                  |
| `isEmpty`    | `!a`                            | Пусто / не определено     |
| `isNotEmpty` | `!!a && a !== ''`               | Не пусто                  |
| `isSayTrue`  | `Text.isSayTrue(String(a))`     | Пользователь сказал «да»  |
| `isSayFalse` | `Text.isSayFalse(String(a))`    | Пользователь сказал «нет» |
| `isUrl`      | `Text.isUrl(String(a))`         | Пользователь ввёл URL     |

> Операторы isSayTrue, isSayFalse, isUrl требуют импорта `Text` из `umbot`.

### Action Node (блок действия)

Действие — выполняет код (установка переменных, числа, HTTP).

```json
{
    "type": "action",
    "id": "node_101",
    "name": "generate_numbers",
    "actions": [
        { "type": "random_number", "field": "num1", "min": 1, "max": 10 },
        { "type": "set_variable", "field": "answer", "value": "num1 + num2" },
        {
            "type": "http_request",
            "url": "https://api.com",
            "method": "GET",
            "saveResponseTo": "data"
        }
    ],
    "text": "Ваше число: {{num1}}",
    "buttons": []
}
```

| Поле      | Тип           | Описание                                              |
| --------- | ------------- | ----------------------------------------------------- |
| `type`    | `"action"`    | Тип узла                                              |
| `id`      | string        | Уникальный ID                                         |
| `name`    | string        | Имя узла (для thisIntentName)                         |
| `actions` | ActionBlock[] | Блоки действий                                        |
| `text`    | string        | Текст после выполнения действий (поддерживает `{{}}`) |
| `buttons` | FlowButton[]  | Кнопки после выполнения действий                      |

### Response Node (блок ответа)

Ответ — показывает текст, кнопки, карточки без запроса ввода.

```json
{
    "type": "response",
    "id": "node_202",
    "name": "show_help",
    "response": {
        "text": "Это справка.",
        "tts": "Справка по боту.",
        "isEnd": false,
        "buttons": [{ "title": "Назад", "type": "action" }],
        "card": null,
        "sounds": []
    }
}
```

### End Node

> ⚠️ **Не поддерживается генератором.** Узел `end` может встречаться в экспорте редактора,
> но `create from-flow` его игнорирует — код для завершения диалога (`isEnd = true`)
> не генерируется. Если нужно завершать диалог, добавьте действие/ответ, выставляющий
> `isEnd` вручную в сгенерированном коде.

```json
{ "type": "end", "id": "node_303" }
```

---

## Типы данных

### FlowResponse

```json
{
    "text": "Текст ответа",
    "tts": "Текст для озвучки",
    "emotion": "good",
    "isEnd": false,
    "shuffleButtons": false,
    "buttons": [],
    "card": null,
    "sounds": []
}
```

> Поля `emotion` и `sounds` — поля визуального редактора, генератор их игнорирует.

### FlowPrompt

```json
{
    "text": "Текст вопроса",
    "tts": "",
    "emotion": "",
    "shuffleButtons": false,
    "buttons": [],
    "card": null
}
```

### FlowButton

```json
{
    "title": "Текст кнопки",
    "type": "action",
    "targetNodeId": "node_id",
    "url": "https://..."
}
```

| Поле             | Описание                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `type: "action"` | Кнопка-действие. `targetNodeId` генератор сейчас игнорирует — генерируется только `addBtn(title)`. |
| `type: "link"`   | Кнопка-ссылка. `url` — URL.                                                                        |

### FlowCard

```json
{
    "type": "gallery",
    "title": "Заголовок",
    "images": [
        {
            "src": "https://example.com/photo.jpg",
            "title": "Название",
            "description": "Описание",
            "button": { "title": "Купить", "type": "action", "targetNodeId": "..." }
        }
    ]
}
```

| `type`    | Описание                         |
| --------- | -------------------------------- |
| `single`  | Одно изображение                 |
| `list`    | Список изображений (вертикально) |
| `gallery` | Горизонтальная прокрутка         |

> Поле `type` генератор игнорирует: для каждого элемента `images` генерируется
> `ctrl.card.addImage(src, title, description)` (при наличии кнопки у элемента — четвёртым аргументом
> добавляется её текст), а итоговый вид карточки (BigImage, ItemsList, ImageGallery и т.п.)
> каждая платформа выбирает сама по числу изображений.

### ActionBlock

```json
{ "type": "set_variable", "field": "name", "value": "userName", "fieldComment": "Имя пользователя" }
{ "type": "random_number", "field": "num", "min": 1, "max": 100, "fieldComment": "Случайное число" }
{ "type": "http_request", "url": "https://api.com", "method": "GET", "headers": "{ \"Auth\": \"token\" }", "body": "{\"key\": \"{{var}}\"}", "saveResponseTo": "data" }
```

| Поле             | Тип    | Описание                                                                             |
| ---------------- | ------ | ------------------------------------------------------------------------------------ |
| `type`           | string | `"set_variable"` / `"random_number"` / `"http_request"`                              |
| `field`          | string | Имя переменной в userData                                                            |
| `fieldComment`   | string | Комментарий к переменной (поле редактора, генератор игнорирует)                      |
| `value`          | string | Выражение для set_variable (поддерживает `{{var}}`)                                  |
| `min`            | number | Минимум для random_number (по умолчанию 1)                                           |
| `max`            | number | Максимум для random_number (по умолчанию 10)                                         |
| `url`            | string | URL для http_request (вставляется литералом, без `{{var}}`)                          |
| `method`         | string | HTTP метод: `"GET"`, `"POST"`, `"PUT"`, `"PATCH"`, `"DELETE"`, `"HEAD"`, `"OPTIONS"` |
| `headers`        | string | Заголовки как JSON строка                                                            |
| `body`           | string | Тело запроса как JSON строка (поддерживает `{{var}}`)                                |
| `saveResponseTo` | string | Сохранить ответ в userData                                                           |

### FlowCondition

```json
{
    "variable": "score",
    "operator": "gte",
    "value": 100,
    "responseTrue": { "text": "Победа!", "buttons": [] },
    "responseFalse": { "text": "Попробуйте снова.", "buttons": [] }
}
```

> Применяется для inline conditions в command/step. Standalone condition узлы используют edges.

### ConditionResponse

```json
{ "text": "Текст", "buttons": [] }
```

> `targetNodeId` задаётся на верхнем уровне объекта условия (`{ "variable": "...", "targetNodeId": "step_id" }`),
> а не внутри ответа: генератор читает его только там и только для ветки true (навигация через `thisIntentName`).

---

## Связи (Edges)

```json
{
    "from": "source_node_id",
    "to": "target_node_id",
    "type": "next",
    "label": ""
}
```

| Тип            | Описание                                                                           |
| -------------- | ---------------------------------------------------------------------------------- |
| `next`         | Последовательный переход                                                           |
| `branch_true`  | Ветка «да» от условия                                                              |
| `branch_false` | Ветка «нет» от условия                                                             |
| `slot_match`   | Совпадение слота (зарезервировано: генератор сейчас не использует этот тип связей) |

### Паттерны связей

```
Command → Step (next)
Step → Condition (next)
Condition → Response (branch_true)
Condition → Response (branch_false)
Response → Step (next)  — для циклов
Command → Response (next) — Response генерируется как функция __name(ctrl), вызываемая из команды
Command → Action (next) — Action генерируется как функция __name(ctrl), вызываемая из команды
Command → Condition (next) — генерируется по одному из двух механизмов: standalone-узел Condition
  (подключён через edge) становится отдельной функцией __name(ctrl); inline-условия из массива
  cmd.conditions встраиваются прямо в тело команды (без отдельной функции)
```

---

## Подстановка переменных

**В JSON:** `{{variableName}}`
**В сгенерированном коде:** `` `${ctrl.userData.variableName}` ``

```
"Привет, {{userName}}!"  →  setText(ctrl, `Привет, ${ctrl.userData.userName}!`)
```

> Подстановка `{{var}}` работает во всех текстовых полях, которые проходят через textExpr: `text` (response, prompt,
> fallback, welcome, helpText) и тексты action-блоков. В `value` (set_variable) значение с `{{}}` тоже подставляется
> как шаблонная строка; арифметика типа `num1 + num2` (имена без `{{}}`) вычисляется отдельным парсером выражений.
> В URL `http_request` подстановка НЕ выполняется — адрес вставляется литералом.

---

## База данных

```json
{
    "type": "file",
    "config": {}
}
```

| Тип     | Описание          | Генерируемый код                                                                                                                                                                                                                                                                            |
| ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file`  | Файловое хранение | `import { FileAdapter } from 'umbot/plugins'; bot.use(new FileAdapter());` — без аргументов; отдельного файла конфигурации генератор не создаёт, путь к данным задаётся в `appConfig.json`-разделе самого проекта через `bot.setAppConfig({ json: ... })`, поле `config` здесь игнорируется |
| `mongo` | MongoDB           | `import { MongoAdapter } from 'umbot/plugins'; bot.use(new MongoAdapter({ host: '...', database: '...' }));` — из `config.host`/`config.database`                                                                                                                                           |
| `none`  | Без БД            | Не импортирует адаптер                                                                                                                                                                                                                                                                      |

> Для `mongo`: `user`/`pass` из `database.config` в исходный код не пишутся — генератор
> переносит их в `.env` генерируемого проекта (переменные `DB_USER`/`DB_PASSWORD`), откуда их
> читает фреймворк. Существующий `.env` не перезаписывается: дописываются только
> отсутствующие переменные. `MongoAdapter` подключается к MongoDB по `host`/`database`.

---

## Как генерируется код

### Паттерн 1: Простая команда

**JSON:**

```json
{
    "type": "command",
    "id": "n1",
    "name": "greeting",
    "slots": ["привет"],
    "response": { "text": "Привет!" }
}
```

**Генерируемый код:**

```typescript
bot.addCommand('greeting', ['привет'], (cmd: string, ctrl: BotController): void => {
    setText(ctrl, 'Привет!');
});
```

### Паттерн 2: Шаг с сохранением

**JSON:**

```json
[
    {
        "type": "command",
        "id": "n1",
        "name": "start",
        "slots": ["начать"],
        "response": { "text": "Как вас зовут?" }
    },
    {
        "type": "step",
        "id": "n2",
        "name": "enterName",
        "prompt": { "text": "Как вас зовут?" },
        "saveTo": "userName"
    }
]
```

(между узлами — edge `{ "from": "n1", "to": "n2", "type": "next" }`)

**Генерируемый код:**

```typescript
bot.addCommand('start', ['начать'], (cmd: string, ctrl: BotController): void => {
    setText(ctrl, 'Как вас зовут?');
    ctrl.thisIntentName = 'enterName';
});
bot.addStep('enterName', (ctrl: BotController): void => {
    setText(ctrl, 'Как вас зовут?');
    ctrl.userData.userName = ctrl.originalUserCommand ?? ctrl.userCommand ?? '';
});
```

### Паттерн 3: Условие (if/else)

**JSON:**

```json
{
    "type": "condition",
    "id": "n3",
    "name": "check",
    "variable": "score",
    "operator": "gte",
    "value": 100
}
```

**Генерируемый код** (функция блока; вызывается из команды/шага, подключённого edge `next`):

```typescript
/** Условие: проверяем score больше или равно 100 */
function __check(ctrl: BotController): void {
    if (Number(ctrl.userData.score) >= Number(100)) {
        __win(ctrl); // блок, подключённый edge branch_true
    } else {
        __lose(ctrl); // блок, подключённый edge branch_false
    }
}
```

### Паттерн 4: Картинки (галерея)

**JSON:**

```json
{
    "type": "command",
    "id": "n4",
    "name": "gallery",
    "slots": ["галерея"],
    "response": {
        "text": "Выберите:",
        "card": {
            "type": "gallery",
            "images": [
                { "src": "https://example.com/1.jpg", "title": "iPhone", "description": "999₽" }
            ]
        }
    }
}
```

**Генерируемый код:**

```typescript
bot.addCommand('gallery', ['галерея'], (cmd: string, ctrl: BotController): void => {
    setText(ctrl, 'Выберите:');
    ctrl.card.addImage('https://example.com/1.jpg', 'iPhone', '999₽');
});
```

### Паттерн 5: Кнопки

**JSON:**

```json
{
    "type": "command",
    "id": "n5",
    "name": "menu",
    "slots": ["меню"],
    "response": {
        "text": "Выберите:",
        "buttons": [{ "title": "Помощь", "type": "action", "targetNodeId": "help_step" }]
    }
}
```

**Генерируемый код:**

```typescript
bot.addCommand('menu', ['меню'], (cmd: string, ctrl: BotController): void => {
    setText(ctrl, 'Выберите:');
    ctrl.buttons.addBtn('Помощь');
});
```

> `targetNodeId` у кнопок сейчас игнорируется: генерируется только `addBtn(title)` (или `addLink` для `type: "link"`).

### Паттерн 6: isEnd — закрыть диалог

**JSON:**

```json
{
    "type": "command",
    "id": "n6",
    "name": "bye",
    "slots": ["пока"],
    "response": { "text": "До свидания!", "isEnd": true }
}
```

**Генерируемый код:**

```typescript
bot.addCommand('bye', ['пока'], (cmd: string, ctrl: BotController): void => {
    setText(ctrl, 'До свидания!');
    ctrl.isEnd = true;
});
```

### Паттерн 7: TTS (озвучка)

**JSON:**

```json
{
    "type": "command",
    "id": "n7",
    "name": "tts_demo",
    "slots": ["озвучь"],
    "response": { "text": "Текст на экране", "tts": "Текст для озвучки" }
}
```

**Генерируемый код:**

```typescript
bot.addCommand('tts_demo', ['озвучь'], (cmd: string, ctrl: BotController): void => {
    setText(ctrl, 'Текст на экране');
    setTTS(ctrl, 'Текст для озвучки');
});
```

### Паттерн 8: HTTP-запрос

**JSON:**

```json
{
    "type": "action",
    "id": "n8",
    "name": "fetch_data",
    "actions": [
        {
            "type": "http_request",
            "url": "https://api.example.com/data",
            "method": "GET",
            "saveResponseTo": "apiResult"
        }
    ],
    "text": "Получено: {{apiResult}}"
}
```

**Генерируемый код** (функция блока; вызывается с `await` из команды/шага, подключённых edge `next`):

```typescript
/** Действие: HTTP-запрос к https://api.example.com/data */
async function __fetch_data(ctrl: BotController): Promise<void> {
    // fetchWithTimeout — обёртка с таймаутом 2000 мс, генерируется автоматически в ./utils
    try {
        const response = await fetchWithTimeout('https://api.example.com/data');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const responseText = await response.text();
        let data: unknown = null;
        if (responseText.trim()) {
            try {
                data = JSON.parse(responseText);
            } catch {
                data = responseText;
            }
        }
        ctrl.userData.apiResult = data;
    } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        setText(ctrl, `Ошибка запроса: ${errorMessage}`);
    }
    setText(ctrl, `Получено: ${ctrl.userData.apiResult}`);
}
```

### Паттерн 9: Случайное число

**JSON:**

```json
{
    "type": "action",
    "id": "n9",
    "name": "roll",
    "actions": [{ "type": "random_number", "field": "dice", "min": 1, "max": 6 }],
    "text": "Выпало: {{dice}}"
}
```

**Генерируемый код:**

```typescript
/** Действие: сгенерировать случайное число в dice */
function __roll(ctrl: BotController): void {
    ctrl.userData.dice = rand(1, 6);
    setText(ctrl, `Выпало: ${ctrl.userData.dice}`);
}
```

### Паттерн 10: Установка переменной

**JSON:**

```json
{
    "type": "action",
    "id": "n10",
    "name": "set_score",
    "actions": [{ "type": "set_variable", "field": "score", "value": "0" }]
}
```

**Генерируемый код:**

```typescript
/** Действие: установить переменную score */
function __set_score(ctrl: BotController): void {
    ctrl.userData.score = 0;
}
```

### Паттерн 11: Standalone response блок (через edge)

**JSON:**

```json
{ "type": "response", "id": "n11", "name": "show_help", "response": { "text": "Это справка." } }
```

**Генерируемый код** (функция блока; вызывается из команды/шага, подключённых edge `next`):

```typescript
/** Ответ: "Это справка." */
function __show_help(ctrl: BotController): void {
    setText(ctrl, 'Это справка.');
}
```

### Паттерн 12: HTTP body с переменными

**JSON:**

```json
{
    "type": "http_request",
    "url": "https://api.com",
    "method": "POST",
    "body": "{\"user\": \"{{userName}}\", \"score\": \"{{score}}\"}",
    "saveResponseTo": "result"
}
```

**Генерируемый код:**

```typescript
// body — валидный JSON: генератор парсит его и собирает обратно через
// JSON.stringify, подставляя переменные; template literal — только fallback для невалидного JSON
const response = await fetchWithTimeout('https://api.com', {
    method: 'POST',
    body: JSON.stringify({ user: `${ctrl.userData.userName}`, score: `${ctrl.userData.score}` }),
    headers: { 'Content-Type': 'application/json' }, // при теле — всегда добавляются
});
// Ответ читается как текст и парсится с fallback на сырую строку при невалидном JSON
const responseText = await response.text();
let data: unknown;
try {
    data = JSON.parse(responseText);
} catch {
    data = responseText;
}
ctrl.userData.result = data; // тип unknown, не Promise
```

---

## Импорты (генерируются условно)

```typescript
import { Bot, BotController, FALLBACK_COMMAND } from 'umbot';
import { fullPlatforms } from 'umbot/plugins'; // если 7 платформ
import { Text } from 'umbot'; // только при isSayTrue/isSayFalse/isUrl
import { setText, setTTS, fetchWithTimeout } from './utils'; // условно
import { FileAdapter, MongoAdapter } from 'umbot/plugins'; // по database.type
```

| Условие                          | Импорт                                                            |
| -------------------------------- | ----------------------------------------------------------------- |
| Есть TTS у любого узла           | `import { setText, setTTS } from './utils'`                       |
| Нет TTS                          | `import { setText } from './utils'`                               |
| Есть http_request действия       | `import { fetchWithTimeout } from './utils'` (генерируется cli)   |
| Есть isSayTrue/isSayFalse/isUrl  | `import { Text } from 'umbot'`                                    |
| Есть random_number действия      | `import { rand } from 'umbot/utils'`                              |
| database.type === 'file'         | `import { FileAdapter } from 'umbot/plugins'`                     |
| database.type === 'mongo'        | `import { MongoAdapter } from 'umbot/plugins'`                    |
| Все 7 платформ (или список пуст) | `import { fullPlatforms } from 'umbot/plugins'`                   |
| Только голосовые платформы       | `import { voicePlatforms } from 'umbot/plugins'`                  |
| Только чат-платформы             | `import { botPlatforms } from 'umbot/plugins'`                    |
| Смешанный набор платформ         | `import { TelegramAdapter, VkAdapter, ... } from 'umbot/plugins'` |

---

## Валидация имён

- **Имена узлов (name)** используются как идентификаторы команд в сгенерированном коде.
  Для standalone блоков генерируется имя функции `__` + name: не-ASCII символы заменяются на `_`
  (`replace(/[^a-zA-Z0-9_$]/g, '_')`), имя с цифры в начале получает префикс `_`; при коллизиях имён
  добавляется суффикс `_2`, `_3`, ...; пустое имя заменяется на `_block`. Для надёжности
  используйте ASCII-идентификаторы без пробелов.
- **Имена переменных (saveTo, field)** — имена, не являющиеся валидным JS-идентификатором
  (например, начинающиеся с цифры), оборачиваются в скобки: `ctrl.userData['123field']`
- **Package name** — начинается с буквы, валидный npm identifier
