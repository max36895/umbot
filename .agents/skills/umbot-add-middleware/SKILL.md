---
name: umbot-add-middleware
description: Добавить новое middleware в umbot (src/middleware/, экспорт через src/middleware.ts) по стандарту фабрики с опциями. Используй при "добавь middleware X", "нужна обработка перед командами", "вынести логику авторизации/лимитов в middleware", "rate limiter, auth guard, ip filter".
---

# Add Middleware: скилл для добавления новой middleware

## Назначение

Добавить новую middleware в `src/middleware/` — например, кэширование, retry, feature flags, сборка статистики, и т.д.

Middleware — это функция вида `(ctx, next) => Promise<void>` или `(ctx, next) => void`, подключённая через `bot.use(...)`. Она выполняется до `BotController.run()` (то есть до поиска команды и шаги).

## Триггер

- "добавь middleware X"
- "нужна обработка перед командами"
- "вынести логику авторизации"

## Воркфлоу

### Шаг 0: Спроси про UX (и проверь дублирование)

Сначала проверь `src/middleware/` — не дублирует ли задача существующую middleware (rateLimiter, authGuard, maintenance, requestId, ipFilter). Если semantics пересекается — предложи переиспользование или расширение опциями вместо нового файла.

Спроси пользователя:

1. Что делает middleware в одном предложении?
2. Синхронная или асинхронная логика?
3. Должна ли middleware быть **опциональной** (конфигурация параметрами)?
4. Должна ли она возвращать **ранний ответ** пользователю (например, "недоступно")?

### Шаг 1: Спланируй API

Реальные сигнатуры существующих middleware (компилируемые, сверены с исходниками):

```ts
export function rateLimiter(
    maxQueueSize = 100,
    inactivityTimeout = 60000,
): (ctx: BotController, next: MiddlewareNext) => Promise<void>;
// сам лимит RPS задаётся НЕ здесь — на адаптере платформы (public limit = 30)

export function authGuard(
    check: (ctx: BotController) => boolean | Promise<boolean>,
    options: { deniedText?: string } = {},
): (ctx: BotController, next: MiddlewareNext) => Promise<void>;

export function maintenance(
    check: () => boolean | Promise<boolean>,
    options: { message?: string } = {},
): (ctx: BotController, next: MiddlewareNext) => Promise<void>;

export function requestId(): (ctx: BotController, next: MiddlewareNext) => Promise<void>;

export function ipFilter(options: {
    whitelist?: string[];
    blacklist?: string[];
    deniedText?: string;
}): (ctx: BotController, next: MiddlewareNext) => Promise<void>;
```

Заметь: **функция-фабрика** возвращает middleware. Не экспортируй сам middleware напрямую — только фабрику.

### Шаг 2: Создай файл

`src/middleware/<name>.ts`. Рабочий пример (компилируется, линтуется, протестирован прогоном):

````ts
// middleware/telemetrySample.ts — пример, подставь своё имя
import { BotController } from '../controller';
import { MiddlewareNext } from '../core';

/**
 * Опции middleware telemetrySample.
 */
export interface ITelemetrySampleOptions {
    /** Текст-заглушка, который пишется в warn. */
    metricName?: string;
}

/**
 * Middleware для <что делает>.
 *
 * @example
 * ```ts
 * import { telemetrySample } from 'umbot/middleware';
 * bot.use(telemetrySample({ metricName: 'my_requests' }));
 * ```
 */
export function telemetrySample(
    options: ITelemetrySampleOptions = {},
): (ctx: BotController, next: MiddlewareNext) => Promise<void> {
    const metricName = options.metricName ?? 'requests_total';
    return async (ctx: BotController, next: MiddlewareNext): Promise<void> => {
        // — твоя логика —
        ctx.appContext.logWarn(`telemetrySample: заглушка вместо метрики ${metricName}`);

        // Обязательно:
        // 1. если всё ок → `await next()`
        await next();
        // 2. если блокируем → ctx.text = "..."; return;  (НЕ вызываем next)
        // 3. ошибки — try/catch, логируй через ctx.appContext.logError, реши пропускать ли дальше
    };
}
````

Проверь себя: `npx tsc --noEmit -p tsconfig.json` и `npx eslint src/middleware/<name>.ts` перед коммитом — пример выше проходит оба.

### Шаг 3: Не мутируй ctx напрямую если не должен

- ✅ `ctx.userData.foo = 'bar'` — это нормально, это предположение UX
- ✅ `ctx.platformOptions.customX = ...` — для служебного состояния
- ⚠️ `ctx.text = '...'` — только если хочешь ответить и прервать
- ❌ `ctx.userData = {...}` — не перезаписывай целиком (используй присваивание по ключам)

### Шаг 3.1: Помни контракт исключений

Ядро (`Bot.#runMiddlewares`) ловит **любое** исключение middleware, логирует его и
трактует как «обработка прервана»: платформа получает HTTP 200 с текущим `ctx.text`
(на `5xx` Telegram/VK включают ретраи и отключают вебхук — поэтому 200 это осознанно).

Если middleware должна **осознанно отклонить** запрос (перегрузка, лимиты):

1. Экспортируй типизированный класс ошибки (образец: `RateLimitQueueOverflowError` в
   `src/middleware/rateLimiter.ts`) — по нему вызывающий код отличит отказ от бага.
2. Выстави флаг в `ctx.platformOptions` до броска (образец: `rateLimitOverflow`),
   объявив его через `declare module '../controller/BotController'` augmentation.
3. Задокументируй в JSDoc, что исключение перехватывается ядром и как его детектить.

### Шаг 4: Экспортируй

Добавь в `src/middleware.ts`:

```ts
export { <name> } from './middleware/<name>';
export type { I<Name>Options } from './middleware/<name>';
```

### Шаг 5: Тесты

`tests/Middleware/<name>.test.ts`:

Минимум:

1. Пропуск при успехе
2. Блокировка при отказе (если middleware это предполагает)
3. При исключении — продолжение или блокировка (по дизайну)
4. Иммутабельность ctx: не должна менять чужие поля
5. Sync + async поддержка (если оба пути есть)

Рабочий каркас (сверен с реальными `tests/Middleware/*.test.ts` — включая stub логгера, без него пример выше замусорит вывод):

```ts
import { telemetrySample } from '../../src/middleware';
import { BaseBotController } from '../../src/controller';
import { AppContext } from '../../src/core';

describe('telemetrySample middleware', () => {
    function makeCtx(): BaseBotController {
        const appContext = new AppContext();
        appContext.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
        return new BaseBotController(appContext);
    }

    it('пропускает запрос дальше', async () => {
        const ctx = makeCtx();
        let called = false;
        await telemetrySample()(ctx, async () => {
            called = true;
        });
        expect(called).toBe(true);
    });
    // ... остальные кейсы
});
```

⚠️ Используй `BaseBotController`, не `BotController` — у последнего абстрактный `action()`, вызов упадёт. (В старых тестах встречается `new BotController()` — это работает только потому, что `tsconfig` исключает `*.test.ts` из тайпчека и `action()` там не зовётся; не копируй.)

### Шаг 6: Документация (часть задачи, не «потом» — AGENTS.md раздел 6)

Добавь раздел в `src/docs/middleware.md`:

- Что делает
- Как использовать
- Пример с пояснением
- Граничные случаи
- Лучшие практики

Затем погрепай проект на список встроенных middleware (`README.md`, `src/docs/GUIDE.md`, `src/docs/api-reference.md`) — везде, где он перечислен, добавь новый пункт. Иначе middleware останется «невидимым» для тех, кто читает не `middleware.md`.

### Шаг 7: CHANGELOG

Секцию выбирай по правилам AGENTS.md (раздел 6): `[Unreleased]` не использовать; верхняя невыпущенная секция (без даты, с будущей датой или равная версии из `package.json`) — целевая, второй секции для той же версии не создавать; если подходящей секции нет — спросить у пользователя номер версии и срок релиза.

```markdown
- **Middleware**: `myMiddleware(options)` — <короткое описание>.
```

## Анти-паттерны

❌ Не логируй токены/пароли в middleware. Всё, что уходит в `logError`/`logWarn`/`logMetric`, проходит маскирование секретов — не обходи его ручной сериализацией в логгер.
❌ Не делай `await next()` дважды (это сломает цепочку).
❌ Не используй глобальные переменные без возможности сброса (`destroyXxx()`).
❌ Не мутируй `ctx.requestObject` — это reference от платформы.
❌ Не используй `setInterval`/`setTimeout` без `.unref()` — процесс не выйдет.
❌ Не храни состояние в неограниченных Map — задай лимит + вытеснение (образец: `MAX_STATE_MAP_SIZE` и `evictEntry` в rateLimiter) и помечай вытесненные записи `dead`, чтобы работающие очереди не исполняли их задачи.
❌ Не рассчитывай, что batch-обработка очереди обнуляет счётчик лимита: параллельные «свежие» запросы занимают тот же счётчик — проверяй лимит перед каждым элементом пачки (см. `processQueue` в rateLimiter).

## Критерии успеха

1. ✅ Build clean (`npm run build`)
2. ✅ Tests green (`npm run test`)
3. ✅ Prettier applied (`npm run prettier`)
4. ✅ Lint clean (`npm run lint`)
5. ✅ CHANGELOG обновлён (секция выбрана по AGENTS.md разделу 6, не `[Unreleased]`)
6. ✅ Документация: `src/docs/middleware.md` + все места, где перечислены встроенные middleware

Порядок верификации — как в AGENTS.md 3.6: `build` → `test` → `prettier` → `lint`.
