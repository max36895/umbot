# Middleware в umbot: обработка запроса до команд

`umbot` поддерживает **middleware в стиле `telegraf` и `vk-io`** — функции, которые вызываются **до запуска бизнес-логики** (`BotController.action`).

## Использование

```ts
import { T_ALISA } from 'umbot/plugins';

// Глобальный middleware (для всех платформ)
bot.use(async (ctx, next) => {
    console.log('Запрос:', ctx.appType);
    await next(); // обязательно вызвать next() для продолжения
});

// middleware для конкретной платформы
bot.use(T_ALISA, async (ctx, next) => {
    // requestObject — сырой payload платформы (unknown), нужен каст
    const request = ctx.requestObject as Record<string, unknown> | null;
    const session = request?.session as Record<string, unknown> | undefined;
    if (!session?.user_id) {
        ctx.text = 'Некорректный запрос';
        ctx.isEnd = true;
        // next() не вызывается → action() не запустится
        return;
    }
    await next();
});
```

## ⚠️ Важно

- Middleware получает полный BotController (с text, isEnd, userData и т.д.).
- Если вы не вызовете next(), то action() не будет вызван — это нормально.
- Middleware выполняются строго **до** обработчика (`action()`, команды, шаги): это не «луковица» в стиле Koa.
  Порядок: сначала глобальная цепочка целиком — вместе с кодом после `await next()`, затем платформенная цепочка,
  и только потом обработчик. Пример с глобальным `mw1` (лог до/после `next()`) и платформенным `mw2`:
  порядок `1, 4, 2, 3, action()` — код после `next()` у `mw1` выполняется **до** платформенной цепочки и до
  обработчика. Поэтому после `await next()` ответ (`ctx.text`, кнопки) ещё не сформирован — не читайте его там.
  Ответ целиком доступен в `responseCb` у `bot.start()` / `bot.webhookHandle()` (пример ниже).
- Не увлекайтесь вложенной логикой middleware: каждая «до/после next()» ветка усложняет трассировку. Если middleware
  перестал быть прозрачным (вложенные условия, скрытые состояния) — вынесите логику в плагин или обработчик команды.

## Кастомная middleware

### Пример: логирование всех запросов

```ts
bot.use(async (ctx, next) => {
    console.log(`[${ctx.appType}] Запрос от ${ctx.userId}: ${ctx.userCommand}`);
    await next();
});
```

Ответ в middleware ещё не сформирован (обработчик выполняется после всех middleware). Чтобы залогировать ответ,
используйте `responseCb` встроенного сервера (у `webhookHandle` тот же третий аргумент):

```ts
bot.start('0.0.0.0', 3000, (_req, res, state) => {
    console.log(`Ответ ${state.statusCode}:`, state.body);
    state.defaultSend(res, state);
});
```

### Пример: проверка авторизации

```ts
bot.use(async (ctx, next) => {
    // Пропускаем приветствие и помощь
    if (ctx.messageId === 0 || ctx.userCommand === 'помощь') {
        await next();
        return;
    }

    // Проверяем, авторизован ли пользователь
    if (!ctx.userData?.isAuthorized) {
        ctx.text = 'Для использования бота необходимо авторизоваться.';
        ctx.isEnd = true;
        return; // next() не вызываем — action() не запустится
    }

    await next();
});
```

### Пример: middleware для конкретной платформы

```ts
import { T_TELEGRAM } from 'umbot/plugins';

// Только для Telegram
bot.use(T_TELEGRAM, async (ctx, next) => {
    // ⚠️ payload может быть строкой или объектом — всегда сначала сужайте тип
    const payload = ctx.payload as { command?: string } | null | undefined;
    if (payload?.command === 'cancel') {
        ctx.text = 'Действие отменено.';
        ctx.isEnd = true;
        return;
    }
    await next();
});
```

---

## Встроенная middleware: rateLimiter

Фреймворк поставляется с встроенной middleware для ограничения частоты входящих запросов (`rateLimiter`). Лимит берётся из свойства `limit` адаптера платформы: у Telegram, VK, Viber и MAX он равен 30 req/sec. Исходящие сообщения MAX отдельно ограничиваются очередью API-клиента до 2 сообщений в секунду на диалог. Если свойство `limit` не задано или равно `0`/`null`, rateLimiter пропускает запросы без ограничений.

```ts
import { rateLimiter } from 'umbot/middleware';

bot.use(rateLimiter()); // дефолт: queue=100, idle=60s
// или с кастомными параметрами
bot.use(rateLimiter(200, 120_000)); // queue=200, idle 2 мин
// общий лимит на платформу вместо лимита на пользователя
bot.use(rateLimiter(100, 60_000, (ctx) => ctx.appType ?? ''));
```

**Ключ счётчика (`getKey`, третий параметр).** По умолчанию лимит считается на пару `{platform, userId}`. Если у
платформы нет подписи вебхука или секрет не задан, `userId` задаёт отправитель запроса, и, меняя его, можно обойти
лимит на пользователя. `getKey` задаёт свой ключ (к нему добавляется платформа): `ctx => ctx.appType ?? ''` ограничивает
суммарную нагрузку на платформу. Помните, что лимит берётся из `limit` адаптера: у Алисы, SmartApp и Маруси он не задан,
и middleware их не ограничивает.

**Что делает:**

- Читает `appContext.platforms[platform].limit` (TG/VK/Viber/MAX = 30 по умолчанию; `0`/`null` — без ограничений).
- Поддерживает фиксированное 1-секундное окно per `{platform, userId}`: счётчик запросов сбрасывается каждую секунду.
- При превышении — ставит в очередь (до `maxQueueSize`).
- Переполнение очереди → бросает исключение.
- Все таймеры `.unref()` — не блокируют выход процесса.

> **Важно:** rateLimiter ограничивает **входящие** запросы (от платформы к вам), а не **исходящие** API-вызовы (от вас к API платформы).

---

## Встроенные middleware: authGuard

Проверяет, имеет ли пользователь право продолжить диалог.

```ts
import { authGuard } from 'umbot/middleware';

// Белый список ID пользователей
const ADMIN_IDS = ['12345', '67890'];

bot.use(
    authGuard((ctx) => ADMIN_IDS.includes(String(ctx.userId)), {
        deniedText: 'Команда доступна только администраторам',
    }),
);

// Асинхронная проверка — например, через БД
bot.use(
    authGuard(async (ctx) => {
        const user = await db.users.findOne({ id: ctx.userId });
        return !!user?.isActive;
    }),
);
```

**Поведение:**

- Если `check` вернул `true` — вызывается `next()`.
- Если `false` или `check` выбросил исключение — пользователю отправляется `deniedText`, `next()` НЕ вызывается.
- Ошибки в `check` логируются через `appContext.logError`, но не ломают pipeline.

**Сигнатура**: `authGuard(check, options?)` где `check: (ctx) => boolean | Promise<boolean>`.

---

## Встроенные middleware: requestId

Присваивает каждому входящему запросу уникальный `requestId` — полезно для сквозного трейсинга логов.

```ts
import { requestId } from 'umbot/middleware';

bot.use(requestId());

// В других middleware или командах:
// ⚠️ addCommand требует непустые слоты (кроме welcome/help — для них есть дефолтные).
// Команда с пустым массивом слотов просто не зарегистрируется.
bot.addCommand('debug', ['debug'], (_, ctx) => {
    console.log('request id:', ctx.platformOptions.requestId);
});
```

**Что делает:**

- Присваивает `ctx.platformOptions.requestId = crypto.randomUUID()` (или fallback на timestamp+random для старых рантаймов).
- Все логи для одного запроса теперь можно связать через общий ID.

---

## Встроенные middleware: maintenance

Возвращает "сервис на техобслуживании", пока `check()` возвращает `true`.

```ts
import { maintenance } from 'umbot/middleware';

let isDown = false;

// В админ-команде можно менять isDown
bot.addCommand('admin_maintenance', ['включить обслуживание'], (_, ctx) => {
    isDown = true;
    ctx.text = 'Maintenance mode ON';
});

bot.use(
    maintenance(() => isDown, {
        message: 'Бот обновляется. Попробуйте через 5 минут.',
    }),
);
```

**Поведение:**

- Если `check()` возвращает `false` — запрос идёт дальше нормально.
- Если `true` — пользователю отправляется `message`, `next()` не вызывается.
- Если `check()` выбрасывает исключение — запрос **пропускается** (защита от аварийного отключения сервиса).
- Поддерживается и синхронная, и асинхронная функция `check`.

---

## Встроенные middleware: ipFilter

Фильтрует входящие запросы по IP клиента.

```ts
import { ipFilter } from 'umbot/middleware';

// Только доверенные сети (например, диапазоны IP платформы)
bot.use(
    ipFilter({
        whitelist: ['203.0.113.0/24', '198.51.100.0/24'],
        deniedText: 'Forbidden',
        rejectWithoutIp: true, // запрос с неизвестным IP клиента тоже отклоняется
    }),
);

// Или blacklist (запретить спам-диапазоны)
bot.use(
    ipFilter({
        blacklist: ['203.0.113.42', '198.51.100.0/24'],
    }),
);
```

**Поведение:**

- Поддерживает как прямые IP (`'192.168.1.10'`), так и CIDR (`'10.0.0.0/8'`).
- IPv6-mapped адреса автоматически нормализуются в IPv4 (`::ffff:127.0.0.1` → `127.0.0.1`).
- IP берётся из `ctx.platformOptions.clientIp`. В `bot.start()`/`webhookHandle()` фреймворк заполняет его из
  `req.socket.remoteAddress`; в serverless его нужно передать третьим аргументом:
  `bot.webhookEvent(body, headers, clientIp)`. Обработчик Yandex Cloud Functions, сгенерированный CLI
  (`create from-flow --usecloud`), передаёт `event.requestContext.identity.sourceIp`.
- **Неизвестный IP** (`bot.run()`/`BotTest`, `webhookEvent()` без `clientIp`): по умолчанию запрос пропускается без
  фильтрации (одно предупреждение в лог), чтобы бот не ломался в dev/test окружении. Опция `rejectWithoutIp: true`
  отклоняет такие запросы — включайте её в продакшене вместе с `whitelist`, иначе забытый `clientIp` молча отключает
  фильтр.
- За reverse proxy все запросы приходят с IP прокси: `X-Forwarded-For` не используется, потому что клиент может его
  подделать. За прокси ограничивайте доступ на уровне самого прокси.

⚠️ **Важно**: ipFilter НЕ заменяет реальную защиту через reverse proxy / фаервол. Это дополнительный уровень.

---

## Как написать своё middleware (Best Practice)

```ts
import { MiddlewareNext, BotController } from 'umbot';

export function myMiddleware(options?: {...}) {
    return async (ctx: BotController, next: MiddlewareNext): Promise<void> => {
        try {
            // ваша логика ДО обработки запроса
        } catch (e) {
            ctx.appContext.logError('myMiddleware error', {error: e});
            // Решите: скрыть ошибку (continue) или блокировать (return без next)
        }
        await next();  // обязательно, чтобы дальше шла обработка командами/шагами
        // ваша логика ПОСЛЕ обработки (например, замеры времени, логирование ответа)
    };
}
```

**Правила:**

1. **Всегда** вызывайте `next()` или осознанно завершайте ответ через `ctx.text = ...` (без `next()`).
2. **Всегда** оборачивайте рисковые операции в try/catch — иначе исключение убьёт pipeline.
3. Middleware вызываются в порядке регистрации (`bot.use(mw1); bot.use(mw2);` → сначала mw1).
4. Если middleware платформо-специфично — используйте `bot.use(T_TELEGRAM, mw)`.
