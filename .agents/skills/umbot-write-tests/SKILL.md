---
name: umbot-write-tests
description: Правила написания unit и integration тестов для umbot — stub логгера, мок fetch, изоляция БД, структура tests/, BotTest. Используй при "пишу тесты для X", "как протестировать Y", "новая фича — нужны тесты", "добавь покрытие" — до написания тестов.
---

# Write Tests: скилл для написания тестов в umbot

## Назначение

Определяет стандарт написания тестов для фреймворка umbot. Цель — тесты, которые
стабильны, не засоряют консольный вывод, изолированы от внешних зависимостей.

## Триггер

- "Пишу тесты для X"
- "Как протестировать Y"
- "Новая фича — нужны тесты"

## Общие правила (MUST)

### 1. Всегда stub-ай логгер в setUp

По умолчанию `Bot` создаёт `AppContext`, который пишет логи в консоль и в `logs/`.
В тестах это засоряет output и может создавать файлы.

**Не делай так:**

```ts
const bot = new Bot(); // будет писать в консоль
```

**Делай так:**

```ts
const bot = new Bot();
bot.setLogger({
    log: () => {},
    error: () => {},
    warn: () => {},
});
```

Или, если нужен доступ к log записям:

```ts
const errorLogs: string[] = [];
bot.setLogger({
    log: () => {},
    error: (msg) => {
        errorLogs.push(msg);
    },
    warn: () => {},
});
```

### 2. Mock fetch/HTTP — никогда не делай реальных сетевых вызовов

Плохо:

```ts
await request.send('https://api.telegram.org/bot123/sendMessage'); // Реальный вызов!
```

Хорошо:

```ts
(global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ ok: true, result: { message_id: 1 } }),
});
```

Для VK/Alisa используй те же паттерны с перехватом fetch.

### 3. Не подключай DB-адаптеры без необходимости

Если тест не про БД — просто не вызывай `bot.use(new FileAdapter())` / `MongoAdapter` и не передавай `appConfig.db`. Без адаптера ядро не ходит на диск за userData.

Не путай изоляцию с `isLocalStorage: true` — это **другой режим хранения** (userData в state платформы вместо БД), он меняет тестируемое поведение. Включай его только если тестируешь именно этот режим (образец — `tests/Bot/localStorageWarnDepot.test.ts`).

Если тест про Mongo — не ходи в реальную БД. Простой уровень: изолируй env-переменные БД (как `tests/Bot/bot.test.ts` делает с `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`), для сценариев «пакет не установлен» мокай сам модуль-peer-зависимость (образец — `tests/DbModel/mongoLazyLoad.test.ts`):

```ts
// mongodb — опциональная peer-зависимость; jest.mock имитирует её отсутствие
jest.mock('mongodb', () => {
    throw new Error("Cannot find package 'mongodb'");
});
```

### 4. Изолируй тест — каждый тест самодостаточен

Не зависят от порядка выполнения, предыдущих вызовов, глобальных синглтонов. Если нужен шаринг — используй `beforeEach` для инициализации и `afterEach` для очистки.

### 5. Запрещены реальные токены

Заменяй на `'*'.repeat(10)` или `process.env.TEST_TOKEN ?? 'fake-token'`.

```ts
// ПЛОХО
const bot = new Bot().use(new TelegramAdapter('123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11'));

// ХОРОШО
const bot = new Bot().use(
    new TelegramAdapter('bot123:********************************************'),
);
```

## Структура тестов

### Unit-тесты (для utils, middleware, helpers)

Файл: `tests/<Area>/<Name>.test.ts`. Пример на реальном API проекта (проверен прогоном):

```ts
import { Nlu } from '../../src';

describe('Nlu.getPhone', () => {
    it('распознаёт телефоны в разных форматах', () => {
        expect(Nlu.getPhone('89999999999').status).toBe(true);
        expect(Nlu.getPhone('8(999)999-99-99').status).toBe(true);
    });

    it('не распознаёт короткие строки', () => {
        expect(Nlu.getPhone('512').status).toBe(false);
        expect(Nlu.getPhone('test').status).toBe(false);
    });
});
```

Обрати внимание: `Nlu.getPhone`/`getLink`/`getEMail` — статические методы, а `nlu.getFio()`/`getGeo()`/`getDateTime()` — инстанс-методы, требующие `new Nlu()` + `setNlu(...)` (образец — `tests/Nlu/nlu.test.ts`). Не выдумывай API — сверяйся с существующими тестами той же области.

`any` в тестах не используется (ноль вхождений в `tests/`, `@typescript-eslint/no-explicit-any` — warn): если нужно значение вне типа — перепроектируй тест или используй честное приведение через отдельный тип.

### Integration-тесты (для Bot + platform adapter)

Файл: `tests/Bot/<scenario>.test.ts`

Паттерн — через прямой `run()` платформы. Три обязательных элемента: stub логгера, `initBotController` (дефолт — `BaseBotController`, но явный вызов фиксирует контракт теста), адаптер платформы. `BotController` передавать нельзя — у него абстрактный `action()`; используй `BaseBotController` или свой контроллер:

```ts
import { Bot, BaseBotController } from '../../src';
import { AlisaAdapter, T_ALISA, IAlisaWebhookResponse } from '../../src/plugins';

// Хелпер называется getContent — как в tests/Bot/bot.test.ts (строка 79)
function getContent(text: string, msgId: number = 1, state: object = {}): string {
    return JSON.stringify({
        meta: { locale: 'ru-Ru', timezone: 'UTC', client_id: 'test', interfaces: {} },
        session: {
            message_id: msgId,
            session_id: 'local',
            skill_id: 'local',
            user_id: 'test_user',
            new: msgId === 0,
        },
        request: {
            command: text.toLowerCase(),
            original_utterance: text,
            nlu: {},
            type: 'SimpleUtterance',
        },
        state: { session: state },
        version: '1.0',
    });
}

describe('Bot.run', () => {
    let bot: Bot;

    beforeEach(() => {
        bot = new Bot();
        bot.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        bot.initBotController(BaseBotController);
        bot.use(new AlisaAdapter());
    });

    afterEach(() => {
        bot.close(); // сбрасывает отложенную запись warn-лога (#saveErrorData, таймер 200 мс)
    });

    it('отвечает на команду привет', async () => {
        bot.addCommand('hello', ['привет'], (_, ctx) => {
            ctx.text = 'Салют!';
        });

        const res = (await bot.run(T_ALISA, getContent('Привет'))) as IAlisaWebhookResponse;
        expect(res.response?.text).toBe('Салют!'); // ?. — конвенция tests/Bot/bot.test.ts
    });
});
```

Свой контроллер — если нужна логика вне команд (свой `run()`/`action()`): `bot.initBotController(MyController)`, где `MyController extends BotController` реализует `action(...)` (в реальном `TestBotController` из `tests/Bot/bot.test.ts` модификатор `public` опущен — это допустимо). Пример — `TestBotController` в `tests/Bot/bot.test.ts`.

`action()` может быть асинхронным: фреймворк дожидается его промиса перед формированием ответа, ошибка логируется, а пользователь получает «Не удалось выполнить команду», если `text` не заполнен.

⚠️ **Ловушки тестовых фраз** (все три реально ломали тесты — ответ был правильным, ошибался тест):

- `привет`, `помощь` и т.п. — слоты встроенных интентов `welcome`/`help`: после промаха по командам запрос уйдёт в интент, а не в fallback `*`. Для «неизвестной фразы» бери нейтральные слова (`котик`, `запрос_x_1`).
- Слот — это подстрока: `/(да|нет)/` найдёт «да» в «команда», слот `слот_1` — в «слот_15». Ожидаемая команда — зарегистрированная раньше, чей слот входит в текст, а не «самая точная».
- Адаптеры приводят текст к нижнему регистру (`userCommand`): `КОМАНДА_5` найдёт регулярку `/команда_5/`.

Прежде чем «чинить» код под упавший тест поиска команд, проверь по этим трём пунктам сам тест.

### Для CLI (`cli/`)

Файл: `tests/cli/<name>.test.ts`

CLI работает синхронно, можно тестировать через прямой вызов. Не запускай реальный процесс через child_process — используй import:

```ts
import { generateFromFlow, validateFlowSchema } from '../../cli/flowGenerator';
```

### Для платформ-специфичной логики

Файл: `tests/Platforms/<Platform>/adapter.test.ts`

Покрываем:

- `setQueryData` корректно маппит входящий query
- `isCorrectQuery` правильно валидирует
- `getContent` формирует правильный ответ

## Анти-паттерны

### ❌ Не делай

```ts
// Тесты зависят друг от друга
it('step 1', () => {...});
it('step 2', () => { /* ожидается, что step 1 уже вызван */ });

// Реальный логер пишет в файловую систему
beforeEach(() => {
    bot = new Bot(); // создаст ./logs
});

// Тесты без cleanup таймеров
it('работаем с очередью', () => {
    const interval = setInterval(...);
    // ... тест
    // НЕТ clearInterval → process не выйдет
});
```

### ✅ Делай

```ts
// Каждый тест независим
beforeEach(() => {
    jest.clearAllMocks();
});

// Логер stub'ается
beforeEach(() => {
    bot = new Bot();
    bot.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
});

// Долгоживущие таймеры — очищаем
afterEach(() => {
    destroyRateLimiter(); // если тест ранее подключал rateLimiter
});
```

## Когда тест падает

1. **"does not exit gracefully"** — есть таймеры/интервалы без `.unref()` или без cleanup.
2. **"Cannot find module"** — проверь, что импорт идёт из `../../src/`, не из `../../dist/`; константы платформ (`T_ALISA` и т.п.) — из `../../src/plugins`, не из `../../src`. Импорты вида `'umbot'`/`'umbot/plugins'` — self-reference: они требуют собранного `dist/` (resolving через `exports` в package.json), в тестах репо так не делают.
3. **"Не определен класс с логикой приложения"** — не задан класс контроллера. Для `new Bot()` без аргументов практически недостижимо (дефолт — `BaseBotController`); воспроизводится только если контроллер передали как `undefined`/пустым. Если увидел — проверь, что не перезаписал `#botControllerClass` пустым значением.
4. **"TypeError: this.action is not a function"** — в `initBotController` передан абстрактный `BotController`; передавай `BaseBotController` или свой контроллер с реализованным `action()`.
5. **Ответ пустой, хотя тест не падает** — обработчик выставил `skipAutoReply` или упал (ошибка — в логе, не глуши `error` в тесте, пока ищешь причину); либо запрос ушёл во встроенный интент вместо ожидаемой команды (см. «Ловушки тестовых фраз»).
6. **"ECONNREFUSED"** — ты делаешь реальный сетевой вызов. Замокай fetch.
7. **Тест оставляет файлы в репо (`UsersData.json`, `warn.log`)** — дефолтные пути `json/`/`logs/` указывают в cwd; перенаправляй их во временную папку (образец — `tests/DbModel/fileAdapterSelect.test.ts`: `mkdtempSync(join(tmpdir(), 'umbot-...'))` → `appContext.appConfig.json = dir` → `rmSync` в `afterAll`; в `tests/Bot/bot.test.ts` — `setAppConfig` с явными путями + `unlinkSync` в afterEach) и вызывай `bot.close()` в afterEach.
8. **`received value must be a promise` на `.resolves`** — метод адаптера вернул значение синхронно (так и задумано: промис — только при I/O). Пиши `expect(await adapter.setQueryData(...)).toBe(true)` — работает для обоих случаев.
9. **Тест плана поиска команд видит «простой» план** — полный план (индексы) строится таймером через ~40 мс после регистрации команд, а цикл `await` без выхода в event loop таймер не пускает. Жди `await new Promise((r) => setTimeout(r, 80))` после регистрации, если проверяешь поведение индексов (образец — `settle()` в `tests/Core/commandSearchPlan.test.ts`).

## Референсы

Хорошие примеры в репо:

- `tests/Bot/bot.test.ts` — integration через Alisa
- `tests/cli/flowGenerator.test.ts` — unit + integration для CLI
- `tests/Middleware/middleware.test.ts` — unit для middleware
- `tests/Request/*.test.ts` — моки fetch для request-классов
