# umbot — инструкция по созданию голосовых навыков и чат-ботов

> **О руководстве**
> Руководство ведёт от установки до рабочего бота: как устроен фреймворк, как писать команды и шаги, где хранятся
> данные пользователя, как отвечать кнопками, карточками и звуками и как не наступить на типичные грабли.
> Полные сигнатуры и таблицы — в [справочнике API](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/api-reference), подробности по отдельным темам — в профильных
> разделах (ссылки в конце каждой главы и в таблице ниже).
>
> **Версия фреймворка:** `umbot@3.1.x`
> **Репозиторий:** https://github.com/max36895/umbot
> **npm:** https://www.npmjs.com/package/umbot

| Нужно                                                          | Раздел                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Создать первый проект за 5 минут                               | [Быстрый старт](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/getting-started)             |
| Полные сигнатуры `Bot`, `BotController`, компонентов, констант | [Справочник API](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/api-reference)              |
| Токены, `.env`, режимы, проверка подписи вебхука               | [Конфигурация и безопасность](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/configuration) |
| Особенности и лимиты каждой платформы                          | [Подключение платформ](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/platform-integration) |
| Middleware и встроенные `rateLimiter`, `authGuard`, `ipFilter` | [Middleware](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/middleware)                     |
| `BotTest`, `simulate()`, Jest                                  | [Тестирование](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/testing)                      |
| HTTPS, Docker, PM2, serverless, масштабирование                | [Развертывание](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/deployment)                  |
| Готовые решения типовых задач                                  | [Рецепты](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/recipes)                           |

---

## Оглавление

- [Что такое `umbot`](#что-такое-umbot)
- [Ментальная модель — как это работает](#ментальная-модель--как-это-работает)
- [Установка и создание проекта](#установка-и-создание-проекта)
- [Минимальный рабочий пример](#минимальный-рабочий-пример)
- [Точки входа и импорты](#точки-входа-и-импорты)
- [Два способа написания логики](#два-способа-написания-логики)
- [Конфигурация: `IAppConfig` и `IAppParam`](#конфигурация-iappconfig-и-iappparam)
- [Команды и шаги — `addCommand` / `addStep`](#команды-и-шаги--addcommand--addstep)
- [Состояние: где хранятся данные пользователя](#состояние-где-хранятся-данные-пользователя)
- [UI-компоненты: кнопки, карточки, изображения, звуки, NLU, навигация](#ui-компоненты-кнопки-карточки-изображения-звуки-nlu-навигация)
- [Платформы — регистрация и общие принципы](#платформы--регистрация-и-общие-принципы)
- [Базы данных](#базы-данных)
- [Middleware и `rateLimiter`](#middleware-и-ratelimiter)
- [Preload — предзагрузка медиа](#preload--предзагрузка-медиа)
- [Тестирование — `BotTest` и Jest](#тестирование--bottest-и-jest)
- [Деплой — `start`, `webhookHandle`, Docker, Express](#деплой--start-webhookhandle-docker-express)
- [Лимиты и производительность — что нужно знать](#лимиты-и-производительность--что-нужно-знать)
- [Обработка ошибок](#обработка-ошибок)
- [Метрики](#метрики)
- [Распространённые ошибки и как их избегать](#распространённые-ошибки-и-как-их-избегать)
- [Финальные рекомендации](#финальные-рекомендации)

---

## Что такое `umbot`

`umbot` — это TypeScript-фреймворк для разработки **голосовых навыков** (Алиса, Сбер SmartApp, Маруся) и **чат-ботов** (
Telegram, VK, MAX, Viber). Главная идея: **пишете логику один раз — запускаете на любой поддерживаемой платформе**.

Фреймворк **ориентирован на голосовые платформы**: весь голосовой функционал (TTS, звуки, SSML-эффекты, звуки природы,
паузы) поддерживается полностью. Для чат-ботов (Telegram, VK, Viber, Max) поддерживается тот же набор возможностей, что
и для голосовых — карточки, кнопки, аудио-сообщения. Специфичные возможности мессенджеров (опросы, платежи,
редактирование сообщений), не имеющие аналогов в голосовых платформах, в едином API не представлены — они доступны
через `controller.api` и API-клиенты платформ (`TelegramRequest`, `VkRequest`, `MaxRequest`, `ViberRequest`).

Ключевые свойства:

- **Единая бизнес-логика.** Один и тот же код работает одновременно на всех зарегистрированных платформах. Различия в
  форматах запросов/ответов берёт на себя фреймворк.
- **Производительность.** Обработка запроса внутри фреймворка — менее 30 мс даже при 1000 команд. Это критично для
  голосовых платформ: так, у Алисы сетевой лимит — порядка 4,5 секунды, но фреймворк предупреждает уже после
  2 секунд обработки и пишет ошибку после 2,9 — ориентируйтесь на ~3 секунды как практический потолок.
- **Безопасность RegExp.** Встроенная защита от ReDoS-атак. Опционально используется `re2` (в 2–15 раз быстрее).
- **Кэширование медиа.** Изображения и звуки загружаются на платформу один раз, токены кэшируются в БД — повторные
  ответы не тратят время на upload.
- **TypeScript-first.** Полная типизация, строгий режим, автодополнение.
- **CLI.** `npx umbot create <name>` разворачивает готовый проект за минуту.
- **Расширяемость.** Можно добавить свою платформу (через адаптер) или свою БД (через DB-адаптер).

### Для кого

- Разработчики голосовых навыков (Алиса, Сбер SmartApp, Маруся) — основная аудитория.
- Команды, поддерживающие бота сразу на нескольких платформах (голосовых + чат-ботах).
- Те, кто хочет начать с одной платформы, но заложить архитектуру на будущее.

### Что НЕ делает `umbot`

- Визуальный редактор диалогов — отдельный сервис [Umbot Flow](https://flow.maxim-m.ru): он экспортирует
  `flow.json`, из которого CLI генерирует проект (`npx umbot create from-flow`).
- Не обучает свои NLU-модели — для Алисы интенты настраиваются в Яндекс.Диалогах.
- Не хостит навык — нужен свой сервер или serverless-функция.
- Не работает с потоковыми аудио-ответами (только TTS через SpeechKit или готовые звуки).

---

## Ментальная модель — как это работает

```
┌──────────────────────── HTTP-запрос от платформы (Алиса/ТГ/ВК/...) ───────────────────────────────────────────┐
│                                                                                                               │
│   1. webhookHandle() принимает запрос, парсит JSON, валидирует сигнатуру/токен                                │
│   2. Bot.#getAppType() — авто-определение платформы по телу/заголовкам запроса                                │
│   3. platformAdapter.setQueryData(query, controller) — адаптер наполняет контроллер:                          │
│        controller.userCommand, userId, messageId, payload, nlu, state, isScreen ...                           │
│   4. Загрузка userData (из БД) или state (из локального хранилища платформы)                                  │
│   5. Запуск NLU-плагина (если установлен) — обогащение controller.nlu                                         │
│   6. Запуск middleware-цепочки:                                                                               │
│        глобальные → платформенные                                                                             │
│        если middleware не вызвал next() — обрыв цепочки (или прерывание выполнения), action() не запускается │
│   7. controller.run() — диспетчер:                                                                            │
│        0) обработчики bot.addEvent по controller.eventType (фото, callback, ...)                              │
│        a) если oldIntentName зарегистрирован как step → вызвать шаг                                           │
│        b) иначе искать команду: точное совпадение → остальные по порядку регистрации                          │
│        c) иначе — поиск по интентам из platformParams.intents                                                 │
│        d) иначе — FALLBACK_COMMAND ('*'), если зарегистрирован                                                │
│        e) встроенные: 'welcome' (приветствие), 'help' (помощь)                                                │
│        f) в конце ВСЕГДА вызывается action(intentName, isCommand, isStep)                                     │
│   8. Сохранение userData / state                                                                              │
│   9. platformAdapter.getContent(controller) — формирование ответа в формате платформы                         │
│  10. Отправка ответа (для Алисы — JSON в тело HTTP, для ТГ — POST на api.telegram.org)                        │
│                                                                                                               │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Главные сущности

| Сущность        | Роль                                                                                             | Кто пишет                |
| --------------- | ------------------------------------------------------------------------------------------------ | ------------------------ |
| `Bot`           | Оркестратор. Принимает запросы, маршрутизирует, управляет жизненным циклом.                      | Использует разработчик   |
| `AppContext`    | Хранилище состояния приложения: конфиг, токены, реестр плагинов, логгер.                         | Создаётся внутри `Bot`   |
| `BotController` | Базовый класс для бизнес-логики. Содержит `text`, `buttons`, `card`, `userData`, `state`, `nlu`. | Разработчик наследует    |
| PlatformAdapter | Переводит универсальный ответ в формат конкретной платформы.                                     | Встроено или разработчик |
| DatabaseAdapter | Сохраняет `userData` между запросами.                                                            | Встроено или разработчик |
| Middleware      | Перехватывает запрос до/после `action()`.                                                        | Разработчик              |
| Plugin          | Расширение: NLU, i18n, кастомный RegExp-движок.                                                  | Разработчик              |

### Жизненный цикл контроллера

Фреймворк автоматически:

1. Создаёт экземпляр (`new MyController(appContext)`) на каждый запрос.
2. Заполняет поля запроса (`userCommand`, `userId`, ...).
3. Загружает `userData` / `state`.
4. Вызывает `run()` — внутренний диспетчер.
5. `run()` определяет, что сработало (событие → шаг → команда → интент → fallback → welcome/help), и в конце
   вызывает `action()` (подробно — [«Порядок диспетчера»](#порядок-диспетчера)).
6. Вызывает `platformAdapter.getContent(controller)` — формирует ответ (внутри этого метода сохраняется `state`
   через `setLocalStorage`; `userData` сохраняется фреймворком позже — в `#runApp` после формирования ответа).
7. Сбрасывает transient-поля (text, tts, buttons, card, nlu) — userData сохраняется.

---

## Установка и создание проекта

### Быстрый старт через CLI

```bash
# Установить фреймворк и создать проект одной командой
npx umbot create my-skill
cd my-skill
npm install
npm run build
npm run start
```

После запуска сервер слушает на `0.0.0.0:3000` (шаблон CLI подставляет `hostname: '0.0.0.0'`) и готов принимать вебхуки.
При ручном запуске `bot.start()` без аргументов сервер слушает `localhost:3000` — для приёма внешних вебхуков
передайте хост явно: `bot.start('0.0.0.0', 3000)`.
`npm run start` запускает собранный код из `dist/`, поэтому после любых изменений исходников нужен `npm run build`.

### Запуск без вебхука (long polling)

Для Telegram, VK и MAX бота можно запустить без публичного HTTPS-адреса: `bot.startPolling()` вместо
`bot.start()`. Бот сам запрашивает обновления у платформы — удобно для локальной разработки.

```ts
const bot = new Bot();
bot.use(new TelegramAdapter(process.env.TELEGRAM_TOKEN));
bot.addCommand('hello', ['привет'], (_text, ctx) => {
    ctx.text = 'Привет!';
});
await bot.startPolling(); // { platforms: ['telegram'] } — только выбранные платформы
```

Ограничения платформ (вебхук у Telegram, настройка Long Poll API у VK) — в
[platform-integration](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/platform-integration#приём-обновлений-вебхук-или-long-polling).

### CLI

Кроме `create`, CLI умеет создавать проект из визуального редактора (`create from-flow`), проверять `flow.json`
(`validate`), регистрировать вебхук с секретом (`webhook`), проверять токены и вебхуки (`doctor`), добавлять
Dockerfile и CI (`add docker`, `add deploy`), создавать каркас своего адаптера платформы, адаптера БД или middleware
с готовым тестом (`add platform`, `add db`, `add middleware`). Полный список команд, флагов и формат JSON-конфига для `create` —
в [описании CLI](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/cli/README).

### Ручная установка

```bash
npm install umbot
# опционально (рекомендуется для продакшена):
npm install re2       # ускорение RegExp в 2-15 раз
npm install mongodb   # если используете MongoDB вместо файловой БД
```

### Структура типичного проекта

Файлы называются по имени проекта (CLI подставляет его в шаблоны): для `npx umbot create mybot` конфиги будут
`mybotConfig.ts` / `mybotParams.ts`, контроллер — `MybotController.ts`. Не-буквенно-цифровые символы в имени заменяются
на `_` (`my-bot` → `my_bot`).

Внутри `src/` папки расположены от частного к общему: сначала предметные модули (`controller`, `plugins`, `models`,
`config`), а в самом низу — `index.ts`, который всё это собирает. Так в дереве IDE видна логика проекта, а `index.ts`
служит «выходом» из неё.

```
my-bot/                        # директория: имя my_bot (дефисы и спецсимволы → _)
├── .env                       # токены (не коммитить!)
├── .gitignore                 # генерируется CLI, .env уже внутри
├── media/                     # изображения и звуки для предзагрузки
├── json/                      # файлы БД (если FileAdapter)
├── logs/                      # логи ошибок (дефолт error_log — папка logs/)
├── src/
│   ├── controller/
│   │   └── My_botController.ts # extends BotController (если используете контроллер)
│   ├── plugins/               # логические модули с командами (game.ts, shop.ts, ...)
│   ├── config/
│   │   ├── my_botConfig.ts    # функция (): IAppConfig
│   │   └── my_botParams.ts    # функция (): IAppParam
│   ├── models/                # кастомные модели БД (опционально)
│   └── index.ts               # точка входа — здесь собирается бот
├── package.json
└── tsconfig.json
```

> Если используете `isLocalStorage: true` без БД — папки `json/` и `logs/` можно не создавать (они появятся
> автоматически при необходимости). Папка логов настраивается через `error_log`; по умолчанию фреймворк пишет в `logs/`
> рядом с рабочей директорией процесса.

---

## Минимальный рабочий пример

Минимальный навык, который умеет здороваться (через `welcome_text`), показывать помощь, повторять за пользователем и
завершать диалог по команде «пока».

```ts
// src/index.ts
import { Bot, WELCOME_INTENT_NAME, HELP_INTENT_NAME, FALLBACK_COMMAND } from 'umbot';
import { fullPlatforms } from 'umbot/plugins';

const bot = new Bot()
    .use(fullPlatforms)
    .setAppConfig({ isLocalStorage: true })
    .setAppMode('strict_prod');

// Команда приветствия
bot.addCommand(WELCOME_INTENT_NAME, ['привет'], (_, bc) => {
    bc.text = 'Привет! Я повторяю за вами. Скажите "помощь" или "пока".';
    bc.buttons.addBtn('Помощь');
});

// Команда "помощь"
bot.addCommand(HELP_INTENT_NAME, ['помощь'], (_, bc) => {
    bc.text = 'Я повторяю за вами. Скажите что-нибудь, и я это повторю.';
    bc.buttons.addBtn('Выйти');
});

// Завершение диалога — isEnd = true закрывает сессию.
// Поддерживается голосовыми платформами (Алиса, SmartApp, Маруся); чат-платформы
// (Telegram, VK, Viber, MAX) флаг не читают — там сессия завершается сама по тайм-ауту.
bot.addCommand('bye', ['пока', 'выйти', 'до свидания'], (_, bc) => {
    bc.text = 'До свидания!';
    bc.isEnd = true;
});

// Fallback — повторяем за пользователем всё, что не подошло под команды выше.
bot.addCommand(FALLBACK_COMMAND, [], (userCommand, bc) => {
    bc.text = `Вы сказали: ${userCommand}`;
    bc.buttons.addBtn('Помощь').addBtn('Выйти');
});

bot.start('localhost', 3000);
```

Запуск: `ts-node src/index.ts` или после сборки `node dist/index.js`.

Тестирование локально без публикации на платформе — замените `Bot` на `BotTest` и `start` на `test`:

```ts
import { BotTest } from 'umbot/test';
import { fullPlatforms } from 'umbot/plugins';

const bot = new BotTest()
    .use(fullPlatforms)
    .setAppConfig({ isLocalStorage: true })
    .setPlatformParams({
        welcome_text: 'Привет! Я повторяю за вами.',
        intents: [],
    });

await bot.test(); // запустит интерактивный диалог в консоли —
// вводите текст, получаете ответ, для выхода введите "exit"
```

---

## Точки входа и импорты

| Путь импорта       | Что внутри                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `umbot`            | `Bot`, `BotController`, компоненты (`Buttons`, `Card`, `Sound`, `Nlu`, `Navigation`), модели, константы, типы |
| `umbot/plugins`    | Адаптеры платформ и БД (`fullPlatforms`, `TelegramAdapter`, `MongoAdapter`, …), `T_*`-константы, API-клиенты  |
| `umbot/middleware` | `rateLimiter`, `authGuard`, `requestId`, `maintenance`, `ipFilter`                                            |
| `umbot/test`       | `BotTest` — диалог в консоли и `simulate()` для тестов                                                        |
| `umbot/preload`    | `Preload` — заранее загрузить картинки и звуки на платформы                                                   |
| `umbot/build`      | `run()` — запуск бота одной функцией                                                                          |
| `umbot/utils`      | `Text`, `loadEnvFile`, работа с файлами и регулярными выражениями                                             |

Полный список экспортов и значения констант (`WELCOME_INTENT_NAME`, `T_TELEGRAM`, …) — в
[справочнике API](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/api-reference#точки-входа-и-импорты).

---

## Два способа написания логики

`umbot` поддерживает два способа описания логики приложения. Они не исключают друг друга — их можно (и часто нужно)
совмещать.

### Декларативный подход (команды и шаги) — основной способ

Логика описывается через `bot.addCommand(...)` и `bot.addStep(...)`. Это простой, декларативный способ: одна команда —
одна функция-обработчик. Подходит для любых проектов — от маленьких прототипов до больших навыков с десятками команд.

```ts
import { Bot, WELCOME_INTENT_NAME, HELP_INTENT_NAME, FALLBACK_COMMAND } from 'umbot';
import { fullPlatforms, FileAdapter } from 'umbot/plugins';

const bot = new Bot();

bot.use(fullPlatforms)
    .use(new FileAdapter())
    .setAppConfig({ json: './data', isLocalStorage: false })
    .setAppMode('strict_prod');

bot.addCommand(WELCOME_INTENT_NAME, ['привет', 'здравствуй'], (_, bc) => {
    bc.text = 'Привет! Чем могу помочь?';
    bc.buttons.addBtn('Помощь').addBtn('Выйти');
});

bot.addCommand(HELP_INTENT_NAME, ['помощь', 'что ты умеешь'], (_, bc) => {
    bc.text = 'Я умею повторять за вами. Просто скажите что-нибудь.';
});

// Команда с RegExp-слотом
bot.addCommand('num', [/^\d+$/], (userCommand, bc) => {
    bc.text = `Вы назвали число: ${userCommand}`;
});

// Fallback — вызывается, если ничего не подошло
bot.addCommand(FALLBACK_COMMAND, [], (userCommand, bc) => {
    bc.text = `Вы сказали: ${userCommand}`;
});

bot.start('0.0.0.0', 3000);
```

#### Как избегать разрастания `index.ts` — паттерн "логический модуль как плагин"

Когда команд становится много, не стоит держать их все в `index.ts`. Вынесите связанные команды в отдельные модули и
подключайте через `bot.use(pluginFn)`:

```ts
// src/plugins/game.ts
import { Bot, AppContext, BotController, IUserData, createPlugin } from 'umbot';

// Описываем тип userData один раз — он используется в нескольких командах
interface GameData extends IUserData {
    score: number;
}

export const gamePlugin = createPlugin((appContext: AppContext, bot: Bot): void => {
    // Передаём GameData как generic-параметр и аннотируем bc
    bot.addCommand('game_start', ['играть', 'начать игру'], (_, bc: BotController<GameData>) => {
        bc.userData.score = 0;
        bc.text = 'Игра началась! Сколько будет 2+2?';
        bc.buttons.addBtn('3').addBtn('4').addBtn('5');
        bc.thisIntentName = 'game_answer';
    });

    bot.addStep('game_answer', (bc: BotController<GameData>) => {
        if (bc.userCommand === '4') {
            bc.userData.score = (bc.userData.score || 0) + 1;
            bc.text = 'Правильно!';
        } else {
            bc.text = 'Неправильно.';
        }
        bc.thisIntentName = null;
    });

    bot.addCommand('game_score', ['счёт', 'мой счёт'], (_, bc: BotController<GameData>) => {
        bc.text = `Ваш счёт: ${bc.userData.score || 0}`;
    });
});
```

```ts
// src/plugins/shop.ts
import { Bot, AppContext, createPlugin } from 'umbot';

export const shopPlugin = createPlugin((appContext: AppContext, bot: Bot): void => {
    bot.addCommand('catalog', ['каталог'], (_, bc) => {
        /* ... */
    });
    bot.addCommand('order', ['заказ'], (_, bc) => {
        /* ... */
    });
    bot.addStep('order_email', (bc) => {
        /* ... */
    });
});
```

```ts
// src/index.ts
import { Bot } from 'umbot';
import { fullPlatforms, FileAdapter } from 'umbot/plugins';
import { gamePlugin } from './plugins/game';
import { shopPlugin } from './plugins/shop';

const bot = new Bot();
bot.use(fullPlatforms);
bot.use(new FileAdapter());
bot.use(gamePlugin); // регистрирует команды из game.ts
bot.use(shopPlugin); // регистрирует команды из shop.ts
bot.setAppConfig({ json: './data' });
bot.setAppMode('strict_prod');
bot.start('0.0.0.0', 3000);
```

**Почему это хорошо:**

- Каждый модуль отвечает за свою предметную область (game, shop, auth, ...).
- `index.ts` остаётся чистой точкой сборки — видно, какие модули подключены.
- Модули можно переиспользовать в других проектах.
- Команды можно тестировать независимо.

> **⚠️ Внимание!** Функция-плагин обязана иметь маркер `isPlugin = true`. Без него `bot.use(fn)` воспримет функцию как
> middleware (глобальный перехватчик запросов), а не как плагин — и команды внутри неё **не зарегистрируются**. Это частая
> и неочевидная ошибка: код выглядит правильно, ошибки нет, но команды не работают. Чтобы не выставлять флаг вручную и не
> забыть его, используйте хелпер `createPlugin()` — он делает это автоматически (см. примеры выше).

### Классовый подход (контроллер) — для кросс-разрезающей логики

Контроллер (`BotController`) — это класс с методом `action(intentName, isCommand?, isStep?)`, который фреймворк вызывает
**всегда последним**, после того как отработали команды и шаги. Это удобное место для пост-обработки, общей всем
командам.

**Когда контроллер действительно полезен:** когда есть логика, которая должна выполняться после **любой** команды.
Например:

- На каждом экране нужна кнопка «О нас» / «Помощь» / «Выйти».
- После каждой команды нужно писать аналитику.
- Нужно обрезать длинный текст или добавлять стандартный футер.

Контроллер можно сделать максимально компактным — общая логика пишется один раз в начале `action()`, а специфичные
случаи (welcome/help) уходят в `switch`:

```ts
import { BotController, WELCOME_INTENT_NAME } from 'umbot';

export class FooterController extends BotController {
    public action(intentName: string | null, isCommand?: boolean, isStep?: boolean): void {
        // Общая пост-обработка для ВСЕХ ответов — добавляем кнопку "О нас"
        this.buttons.addBtn('О нас');

        // Если сработала команда или шаг — они уже заполнили text,
        // больше ничего делать не нужно.
        if (isCommand || isStep) return;

        // Обработка интентов (только если команда/шаг не сработали)
        switch (intentName) {
            case WELCOME_INTENT_NAME:
                // welcome_text уже выставлен фреймворком —
                // можно перекрыть или дополнить
                break;
            case 'about':
                this.text = 'Этот навык сделан для демонстрации umbot.';
                break;
            default:
                if (!this.text) this.text = 'Не поняла. Скажите "помощь".';
        }
    }
}
```

```ts
// index.ts
bot.initBotController(FooterController);

// Все команды продолжают работать как обычно — после каждой команды
// вызывается action() с isCommand=true, и к ответу добавится кнопка "О нас".
bot.addCommand('weather', ['погода'], (_, bc) => {
    bc.text = 'Сегодня солнечно.';
});
```

> **Главное правило:** не пытайтесь поместить всю логику в `action()`. Если у вас 30 команд — `action()` разрастётся до
> нечитаемого switch на 300 строк. Используйте `addCommand` для каждой команды, а `action()` — только для общей
> пост-обработки.

### Комбинирование (рекомендуемый подход для большинства проектов)

В реальных проектах обычно:

1. **Логику** описывают через `addCommand` / `addStep` (или плагины с ними).
2. **Общую пост-обработку** (общие кнопки, аналитика) — в контроллере.

```ts
import { BotController, WELCOME_INTENT_NAME } from 'umbot';

// Контроллер: добавляет кнопку "Помощь" ко всем ответам и пишет аналитику
bot.initBotController(
    class extends BotController {
        // action() может быть и async — фреймворк дождётся промиса
        // перед формированием ответа.
        action(intentName: string | null, isCommand?: boolean, isStep?: boolean): void {
            // Общая кнопка для всех ответов — пишется один раз
            this.buttons.addBtn('Помощь');

            // Если сработала команда/шаг — они уже заполнили text, выходим
            if (isCommand || isStep) return;

            switch (intentName) {
                case WELCOME_INTENT_NAME:
                    // welcome_text уже выставлен фреймворком —
                    // дополнительно считаем визиты пользователя
                    this.userData.visits = Number(this.userData.visits ?? 0) + 1;
                    break;
                default:
                    if (!this.text) this.text = 'Не поняла. Скажите "помощь".';
            }

            // Аналитика — fire-and-forget: запрос уходит фоном и не блокирует ответ.
            // Обязательно ограничиваем время, чтобы медленный аналитический
            // endpoint не «повесил» исходящий запрос навсегда.
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 8000);
            timer.unref();
            fetch('https://analytics.example.com/event', {
                method: 'POST',
                signal: ac.signal,
                body: JSON.stringify({
                    intent: intentName,
                    platform: this.appType,
                    userId: this.userId,
                    isCommand,
                    isStep,
                }),
                headers: { 'Content-Type': 'application/json' },
            })
                .catch(() => {
                    // ошибки аналитики не должны влиять на пользователя
                })
                .finally(() => clearTimeout(timer));
        }
    },
);

// Команды описывают конкретную логику
bot.use(gamePlugin);
bot.use(shopPlugin);
bot.addCommand('about', ['о нас'], (_, bc) => {
    bc.text = '...';
});
```

---

## Конфигурация: `IAppConfig` и `IAppParam`

Конфигурация разделена на два объекта:

- **`setAppConfig(IAppConfig)`** — инфраструктура: папки логов и данных, подключение к БД, локальное хранилище,
  путь к `.env`, токены платформ.
- **`setPlatformParams(IAppParam)`** — бизнес-параметры: тексты приветствия, помощи и «не поняла», интенты. Поле
  `intents` обязательно, даже пустое: `intents: []`.

```ts
bot.setAppMode('strict_prod'); // режим — до регистрации интентов и команд
bot.setAppConfig({
    env: './.env', // токены: TELEGRAM_TOKEN, VK_TOKEN, ALISA_TOKEN, ...
    isLocalStorage: true, // хранилище платформы вместо БД (Алиса, SmartApp, Маруся)
    error_log: './logs',
});
bot.setPlatformParams({
    welcome_text: 'Привет! Я умею считать.',
    help_text: 'Это игра в математику.',
    empty_text: 'Не поняла. Скажите "помощь".',
    intents: [{ name: 'bye', slots: ['пока', 'до свидания'] }],
});
```

Режим работы (`dev` / `prod` / `strict_prod`) задаётся `setAppMode()`; без вызова он берётся из `NODE_ENV`
(`production` → `strict_prod`, иначе `dev`). `strict_prod` отбрасывает опасные регулярные выражения при регистрации,
поэтому вызывайте его **до** `addCommand` и `setPlatformParams`.

Все поля, переменные окружения, приоритет токенов и проверка подписи вебхука — в
[Конфигурации и безопасности](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/configuration).

---

## Команды и шаги — `addCommand` / `addStep`

### Регистрация команды

```ts
bot.addCommand(
    name: string, // имя (уникальное)
    slots: TSlots, // (string | RegExp)[]
    cb: (userCommand: string, controller: TBotController) => void | string | Promise<void | string>,
    isPattern?: boolean, // трактовать строки как regex
): this;
```

Поведение слотов:

| Тип слота                                  | Поведение                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `string`, `isPattern=false` (по умолчанию) | `userCommand.includes(slot)` — подстрока. Реплика, совпавшая со слотом целиком, находится за O(1) по индексу точных совпадений. Частичное совпадение от 16 таких команд ищется индексом подстрок за время, зависящее от длины реплики, а не от числа команд. **Слот должен быть в нижнем регистре**, т.к. `userCommand` уже приведён к нижнему. |
| `string`, `isPattern=true`                 | Компилируется как regex, проверяется через `.test()`.                                                                                                                                                                                                                                                                                           |
| `RegExp`                                   | `.test(userCommand)`. `isPattern` игнорируется.                                                                                                                                                                                                                                                                                                 |

> **Важно про регистр:** `controller.userCommand` — это текст пользователя, приведённый к нижнему регистру. Слоты-строки
> тоже должны быть в нижнем регистре: `'привет'`, а не `'Привет'`. Для RegExp используйте флаг `i`, если хотите
> case-insensitive.

> **Повторная регистрация:** `addCommand` с уже занятым именем полностью заменяет команду (в лог пишется
> предупреждение): старые слоты перестают срабатывать, а место команды в порядке регистрации (её приоритет)
> сохраняется.

> **Асинхронность:** callback может быть синхронным (`void | string`) или асинхронным (`Promise<void | string>`) —
> фреймворк автоматически дожидается результата через `await`. Это позволяет делать HTTP-запросы, читать из БД и т.д.
> прямо внутри обработчика команды:
>
> ```ts
> bot.addCommand('weather', ['погода'], async (userCommand, bc) => {
>     const city = userCommand.replace('погода', '').trim() || 'москва';
>     // Обязательно ставьте таймаут — внешний API может зависнуть и съесть
>     // весь лимит времени ответа платформы (подробнее — [рецепт 7](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/recipes#рецепт-7-http-запрос-к-внешнему-api))
>     const res = await fetch(`https://api.weather.example.com/current?city=${city}`, {
>         signal: AbortSignal.timeout(3000),
>     });
>     const data = (await res.json()) as { temp: number };
>     bc.text = `Сейчас ${data.temp}°C`;
> });
> ```

Если callback возвращает строку (или `Promise<string>`) — она становится `controller.text`. Это работает для команд
(`addCommand`), событий (`addEvent`) и шагов (`addStep`).

> **Про типизацию `userData` в команде:** `addCommand` — generic-метод с сигнатурой
> `addCommand<TBotController>(name, slots, cb, isPattern)`: параметр `TBotController` выводится из аннотации колбэка.
> Чтобы TypeScript знал про ваши поля в `bc.userData`, аннотируйте второй аргумент:
> `(_, bc: BotController<MyUserData>) => {...}`. Подробное описание всех
> способов типизации (в команде, в шаге, в контроллере) — в разделе [«Типизированный
> `userData`»](#типизированный-userdata).

### Fallback-команда

```ts
import { FALLBACK_COMMAND } from 'umbot';

bot.addCommand(FALLBACK_COMMAND, [], (userCommand, bc) => {
    bc.text = `Не поняла: "${userCommand}". Скажите "помощь".`;
});
```

`FALLBACK_COMMAND` это `'*'`. Срабатывает, если:

- Ни шаг, ни команда, ни интент из `platformParams.intents` не подошли. Интенты ищутся _до_ fallback: реплика,
  совпавшая со слотом интента, попадёт в `action()` с именем интента, а не в fallback.
- Независимо от `messageId`: если fallback зарегистрирован, он сработает и на первом сообщении без подходящего
  интента — подстановка `welcome` для `messageId === 0` выполняется только тогда, когда fallback не зарегистрирован
  (см. [«Порядок диспетчера»](#порядок-диспетчера)). Чтобы приветствовать пользователя и с fallback, проверьте
  `bc.messageId === 0` внутри обработчика fallback.

### Шаги — многошаговые диалоги

Шаг — это механизм для построения многошаговых сценариев: регистрации, опросников, заказа товара, игры с серией
вопросов. Каждый шаг — это отдельная функция-обработчик, которая вызывается в нужный момент.

```ts
bot.addStep(
    stepName: string,
    cb: (controller: TBotController) => void | false | string | Promise<void | false | string>,
): this;
```

#### Как работают шаги — по шагам

Всё построено на двух полях контроллера:

- `controller.thisIntentName` — куда перейти **после** текущего запроса.
- `controller.oldIntentName` — откуда пришли **в** текущий запрос.

**То, что вы записали в `controller.thisIntentName` в текущем запросе, фреймворк автоматически сохранит и передаст вам
в `controller.oldIntentName` в следующем запросе от этого пользователя.** Никаких ручных сохранений — фреймворк сам
прокидывает одно в другое между запросами.

1. **В текущем запросе** вы устанавливаете `controller.thisIntentName = 'step_name'`. Это значит: «следующий запрос
   пользователя должен попасть в шаг `step_name`».
2. **Фреймворк сохраняет** это значение в `userData.oldIntentName` (или в `state.oldIntentName`, если
   `isLocalStorage: true`) — оно переживёт между запросами.
3. **В следующем запросе** фреймворк загружает `oldIntentName` из хранилища и кладёт в `controller.oldIntentName`.
4. **Диспетчер** проверяет: если `oldIntentName` совпадает с именем зарегистрированного шага — вызывает callback этого
   шага **вместо** поиска команд.
5. **Внутри шага** вы обязаны явно управлять `thisIntentName`:
    - Установить `thisIntentName = 'next_step'` — перейти к другому шагу.
    - Установить `thisIntentName = null` — выйти из сценария (следующий запрос пойдёт по обычному пути: команды →
      интенты → fallback).
    - Установить `thisIntentName = 'текущий_шаг'` — остаться на шаге, если ответ пользователя ещё не принят.
    - Оставить `thisIntentName` нетронутым (он по умолчанию `null` в новом запросе) — шаг завершится: в конце запроса
      в `oldIntentName` запишется `null`, и следующий запрос пойдёт по обычному пути. Чтобы переспросить ввод,
      обязательно заново присвойте `thisIntentName = '<имя шага>'`.

#### Особые случаи

- **Если callback шага возвращает `false`** — шаг пропускается, диспетчер идёт дальше (команды → интенты → fallback).
  Это полезно, когда пользователь во время многошагового сценария внезапно задаёт «срочный» вопрос, который нужно
  обработать отдельной командой, а не как ответ на текущий шаг.
- **Если callback шага возвращает строку** (или `Promise<string>`) — строка становится текстом ответа, как у
  `addCommand`: ``bot.addStep('ask_name', (ctx) => `Привет, ${ctx.originalUserCommand}!`)``.
- **Если шаг выбирается по NLU-интентам платформы** и совпало несколько интентов с зарегистрированными шагами —
  срабатывает первый из них.
- **Если `oldIntentName` не совпадает ни с одним шагом** — шаги игнорируются, диспетчер сразу ищет команды.
- **Если пользователь закрыл навык и открыл заново** — `oldIntentName` может остаться в `userData`, но
  `messageId === 0` (новая сессия). В таких случаях часто нужно вернуть `false`, чтобы начать заново.

**Реальный пример:** идём по шагу `ask_phone` (ожидаем номер телефона), но пользователь вместо номера говорит «какая
погода в москве» — это не ответ на шаг, а отдельный запрос:

```ts
import { BotController, IUserData } from 'umbot';

interface PhoneData extends IUserData {
    phone?: string;
}

// Отдельная команда — отвечает на «срочный» запрос во время сценария.
// Срабатывает после шага, потому что step.cb вернет false.
bot.addCommand('weather', ['погода'], async (userCommand, bc) => {
    const city = userCommand.replace('погода', '').trim() || 'москва';
    const res = await fetch(`https://api.weather.example.com/current?city=${city}`, {
        signal: AbortSignal.timeout(3000), // таймаут обязателен (см. антипаттерны)
    });
    const data = (await res.json()) as { temp: number };
    bc.text = `Сейчас ${data.temp}°C. `;
    // Явно перезапускаем шаг: команда сработала после того, как шаг вернул false,
    // и thisIntentName по умолчанию null. Без этой строки сценарий завершился бы.
    bc.thisIntentName = 'ask_phone';
});

bot.addStep('ask_phone', (bc: BotController<PhoneData>) => {
    // Пользователь прислал что-то похожее на погоду? Пропускаем шаг —
    // пусть сработает команда weather выше.
    if (bc.userCommand?.includes('погода')) {
        return false;
    }

    // Иначе — обычная обработка шага
    if (!bc.userCommand || bc.userCommand.length < 5) {
        bc.text = 'Это похоже не на номер. Введите телефон:';
        // ВАЖНО: thisIntentName по умолчанию null — чтобы шаг сработал снова,
        // его нужно явно присвоить заново.
        bc.thisIntentName = 'ask_phone';
        return;
    }
    bc.userData.phone = bc.userCommand;
    bc.text = 'Готово! Телефон сохранён.';
    bc.thisIntentName = null;
});
```

Аналогично для случая с новой сессией:

```ts
bot.addStep('ask_name', (bc) => {
    // Если это новая сессия — не продолжаем старый сценарий, начинаем заново
    if (bc.messageId === 0) {
        return false; // шаг пропускается, диспетчер идёт дальше → welcome
    }
    // ... обычная логика шага
});
```

### Пример: регистрация пользователя

Сценарий: пользователь говорит «регистрация» → мы спрашиваем имя → сохраняем → спрашиваем возраст → сохраняем →
завершаем.

```ts
import { BotController, IUserData } from 'umbot';

// Описываем тип userData — он используется в шагах
interface RegData extends IUserData {
    name?: string;
    age?: number;
}

// Шаг 0: команда-триггер, запускающая сценарий.
// userData здесь не трогаем — типизация не нужна
bot.addCommand('register', ['регистрация', 'зарегистрироваться'], (_, bc) => {
    bc.text = 'Как вас зовут?';
    bc.thisIntentName = 'reg_name'; // следующий запрос пойдёт в шаг reg_name
});

// Шаг 1: ожидаем имя — типизируем через generic-параметр
bot.addStep('reg_name', (bc: BotController<RegData>) => {
    if (!bc.userCommand || bc.userCommand.length < 2) {
        bc.text = 'Имя слишком короткое. Попробуйте ещё раз.';
        // ВАЖНО: чтобы остаться на шаге, thisIntentName нужно явно переприсвоить —
        // в новом запросе он по умолчанию null, и без присваивания сценарий завершится
        bc.thisIntentName = 'reg_name';
        return;
    }
    bc.userData.name = bc.originalUserCommand ?? ''; // сохраняем с правильным регистром
    bc.text = `Приятно познакомиться, ${bc.userData.name}! Сколько вам лет?`;
    bc.thisIntentName = 'reg_age'; // переходим к шагу reg_age
});

// Шаг 2: ожидаем возраст
bot.addStep('reg_age', (bc: BotController<RegData>) => {
    const age = parseInt(bc.userCommand || '', 10);
    if (isNaN(age) || age < 1 || age > 120) {
        bc.text = 'Это похоже не на возраст. Введите число от 1 до 120.';
        bc.thisIntentName = 'reg_age'; // остаёмся на шаге
        return;
    }
    bc.userData.age = age;
    bc.text = `Запомнил: вам ${age} лет. Регистрация завершена!`;
    bc.thisIntentName = null; // выходим из сценария — следующий запрос пойдёт по обычному пути
});
```

**Что произошло в этом примере по запросам:**

| Запрос        | `oldIntentName` при входе | Что вызывает         | `thisIntentName` после |
| ------------- | ------------------------- | -------------------- | ---------------------- |
| «регистрация» | null                      | команда `register`   | `'reg_name'`           |
| «Иван»        | `'reg_name'`              | шаг `reg_name`       | `'reg_age'`            |
| «25»          | `'reg_age'`               | шаг `reg_age`        | `null` (выход)         |
| «привет»      | `null`                    | обычный поиск команд | —                      |

### Доступ к oldIntentName

```ts
public action(intentName: string | null, isCommand?: boolean, isStep?: boolean): void {
    if (intentName === 'back') {
        // Возврат на предыдущий шаг
        switch (this.oldIntentName) {
            case 'reg_age':
                this.text = 'Сколько вам лет?';
                this.thisIntentName = 'reg_age';
                break;
            case 'reg_name':
                this.text = 'Как вас зовут?';
                this.thisIntentName = 'reg_name';
                break;
            default:
                this.text = 'Некуда возвращаться.';
        }
    }
}
```

### Порядок диспетчера

`controller.run()` проверяет в следующем порядке (до первого совпадения):

1. **Событие** — обработчики `bot.addEvent` по `controller.eventType` (вызываются первыми, до шагов и команд;
   обработчик может вернуть `false` — тогда событие «не его» и конвейер продолжается).
2. **Шаг** — если `oldIntentName` зарегистрирован как шаг.
3. **Команда** — побеждает команда, зарегистрированная раньше других (порядок вызова `addCommand`):
    - сначала проверяются **точные совпадения строк** (O(1) по хэш-индексу);
    - затем строковые слоты как подстрока и регулярки (`.test()`) — по порядку регистрации. Большие базы
      ускоряются без смены порядка: частичное совпадение от 16 строковых команд ищется индексом подстрок, а
      регулярка от 16 штук запускается, только если в реплике есть её обязательная часть (`/заказ_\d+/` — только при
      «заказ_» в тексте). Регулярки команд, зарегистрированных после 300-й, объединяются в **RegExp-группы**
      (`setCommandGroupMode`).
4. **Интент** — из `platformParams.intents` (слоты интента сравниваются с `userCommand`).
5. **FALLBACK_COMMAND** — если зарегистрирован и интент не найден. Сработавший fallback завершает поиск: welcome
   дальше не подставляется, даже при `messageId === 0`.
6. **Welcome** — если интент не найден, fallback не зарегистрирован и `messageId === 0`, подставляется `'welcome'` →
   фреймворк устанавливает `controller.text = platformParams.welcome_text`.
7. **Built-in интенты**:
    - `'help'` → фреймворк устанавливает `controller.text = platformParams.help_text`
    - иначе → `controller.text = platformParams.empty_text` (только если наследуетесь от `BaseBotController`)
8. **`action(intentName, isCommand, isStep)`** — вызывается всегда в конце.

> **Важно про welcome/help:** фреймворк устанавливает `controller.text = platformParams.welcome_text` (или `help_text`)
> _перед_ вызовом `action()`. Если в `action()` вы тоже установите `this.text`, **ваше значение перекроет** автоматически
> установленное. Это полезно для динамического приветствия (например, другое приветствие для вернувшегося пользователя).

> **⚠️ Важно про `BaseBotController` и `empty_text`:** автоматическая установка
> `controller.text = platformParams.empty_text` (когда ничего не подошло) происходит **только** если вы наследуетесь от
> `BaseBotController`. При наследовании напрямую от `BotController` задавайте `this.text` вручную в `action()`.
> Платформенные адаптеры не придумывают пользовательскую реплику: Алиса и Маруся сохранят пустой ответ с предупреждением,
> Telegram и MAX не отправят недопустимое пустое сообщение во внешнее API.
>
> Поэтому в `action()` всегда обрабатывайте `default:` в switch или добавляйте проверку в конце:
>
> ```ts
> if (!this.text) this.text = 'Не поняла. Скажите "помощь".';
> ```

---

## Состояние: где хранятся данные пользователя

В `umbot` есть два поля для хранения состояния диалога: `controller.userData` и `controller.state`. Разберёмся, что где
лежит и почему.

### Главное правило — откуда берётся `userData`

Чтобы избежать путаницы, используйте следующее правило:

> **Если подключён DB-адаптер (`FileAdapter`, `MongoAdapter` или свой) — `userData` всегда берётся из БД. Если
> DB-адаптер НЕ подключён и `isLocalStorage: true` — `userData` берётся из локального хранилища платформы, а на
> платформах без него (Telegram, VK, MAX, Viber) — из сессии в памяти процесса.**

То есть:

| Подключён DB-адаптер? | `isLocalStorage` | Откуда `userData`                                                                                   |
| --------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| ✅ Да (любой)         | любое значение   | **из БД** (адаптер сам читает/пишет)                                                                |
| ❌ Нет                | `true`           | **из локального хранилища платформы** (Алиса/SmartApp/Маруся)                                       |
| ❌ Нет                | `true`           | Telegram/VK/MAX/Viber: **из сессии в памяти процесса** — см. [ниже](#сессия-в-памяти-процесса)      |
| ❌ Нет                | `false`          | `userData` остаётся пустым — режим без персистентности: валиден, но данные между запросами не живут |

Это логично: БД — это полноценное персистентное хранилище, которое всегда работает. Локальное хранилище — это
облегченный вариант для простых навыков только на голосовых платформах, без БД. Если вы подключили БД — она и
используется.

### Что такое `state` и его связь с `userData`

`state` — это **локальное хранилище платформы** (например, `session_state` у Алисы). Это хранилище, которое платформа
сама прокидывает между запросами в теле запроса/ответа — без БД, без серверов.

`state` заполняется только когда `isLocalStorage: true` **И** платформа его поддерживает (Алиса, SmartApp, Маруся). На
Telegram/VK/Viber/Max локального хранилища нет — `state` всегда `null`, а `userData` без БД хранится в памяти
процесса.

Связь между `userData` и `state` зависит от того, подключён DB-адаптер или нет:

| Конфигурация                                                            | `userData`                            | `state`                                                       |
| ----------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- |
| **DB-адаптер подключён** + `isLocalStorage: true`                       | **из БД** (адаптер читает/пишет)      | **из локального хранилища платформы** — это **другой объект** |
| **DB-адаптер НЕ подключён** + `isLocalStorage: true`                    | **из локального хранилища платформы** | **тот же объект**, что и `userData` (ссылка)                  |
| DB-адаптер подключён + `isLocalStorage: false`                          | из БД                                 | `null`                                                        |
| DB-адаптер НЕ подключён + `isLocalStorage: true`, Telegram/VK/MAX/Viber | из сессии в памяти процесса           | `null`                                                        |
| DB-адаптер НЕ подключён + `isLocalStorage: false`                       | пустой                                | `null` (данные между запросами не сохраняются)                |

**Ключевое отличие первого и второго случая:**

- Когда БД подключена + `isLocalStorage: true` → у вас **два независимых хранилища**: `userData` (БД, тяжёлые данные) и
  `state` (локальное, лёгкие временные). Запись идёт раздельно, но если `state` оказался пуст, в качестве состояния
  платформе отправляется `userData` (fallback), а не пустой объект.
- Когда БД не подключена + `isLocalStorage: true` → `userData` и `state` ссылаются на **один и тот же объект**
  локального хранилища. Записали в `userData.foo` — то же самое увидите в `state.foo`. Это сделано для удобства:
  работаете с тем полем, которое больше нравится.

### Типичные сценарии — что выбрать

#### Сценарий A: маленький навык только для Алисы

```ts
bot.setAppConfig({ isLocalStorage: true });
// DB-адаптер НЕ подключаем
```

- `userData` и `state` — один и тот же объект из state Алисы (адаптер берёт самый долгий из пришедших
  уровней: пользователя, приложения или сессии).
- Лимит — 1024 байта на выбранный уровень состояния (`session_state` и каждый из остальных по отдельности). При
  превышении фреймворк пишет ошибку в лог и не отправляет это поле платформе (сами данные в `userData`/`state` не
  очищаются, они просто не попадут в ответ).
- Не нужен сервер БД.
- Данные привязаны к устройству/пользователю на стороне Яндекса.

#### Сценарий B: навык на нескольких платформах

```ts
bot.use(new MongoAdapter({ host: '...', database: '...' }));
bot.setAppConfig({ isLocalStorage: false });
```

- `userData` всегда из БД.
- `state` не используется (`null`).
- Запись определяется парой `userId` + платформа: пользователь Telegram 42 и пользователь VK 42 — разные
  записи. Чтобы связать аккаунты одного человека на разных платформах, храните связь сами (своя модель).
- Нет лимита в 1 КБ.

#### Сценарий C: БД + локальное хранилище одновременно

```ts
bot.use(new MongoAdapter({ host: '...', database: '...' }));
bot.setAppConfig({ isLocalStorage: true });
```

- `userData` — из БД (тяжёлые данные: настройки, история).
- `state` — **отдельный** объект из локального хранилища (лёгкие временные данные текущего диалога).
- Используется редко, когда чётко нужно разделить «долгоживущие» и «короткоживущие» данные.

### Сессия в памяти процесса

Если включён `isLocalStorage: true`, платформа локального хранилища не поддерживает (Telegram, VK, MAX, Viber), а
DB-адаптер не подключён, `userData` хранится в памяти процесса — так же, как `MemorySessionStorage` у grammY. Шаги
диалога (`addStep`) и счётчики в `userData` работают без БД.

```ts
bot.setAppConfig({
    isLocalStorage: true,
    // Необязательно. По умолчанию: до 10 000 пользователей, 24 часа с последнего запроса пользователя.
    memorySession: { maxSize: 50_000, ttl: 60 * 60 * 1000 },
});
```

Ограничения — те же, что у любой сессии в памяти:

- **данные теряются при перезапуске** процесса (деплой, падение, рестарт контейнера);
- **данные не разделяются между процессами**: кластер, несколько реплик за балансировщиком, serverless (Yandex Cloud
  Functions — каждый вызов может попасть в новый экземпляр);
- при превышении `maxSize` вытесняется пользователь, дольше всех не писавший боту; после `ttl` без запросов данные
  пользователя удаляются;
- пустой `userData` в памяти не хранится.

Обновление, вытеснение и очистка стоят O(1) независимо от числа пользователей: записи связаны в список по давности
обновления, и `maxSize` в десятки тысяч не замедляет запросы.

Фреймворк один раз на платформу пишет предупреждение, где живут данные. Для надёжного хранения подключите
DB-адаптер (`FileAdapter`, `MongoAdapter`) — тогда сессия в памяти не используется. `memorySession: false` отключает
её: `userData` между запросами не сохраняется (поведение до 3.1.0).

### Правила сохранения

Когда вы мутируете `controller.userData` и/или `controller.state`, фреймворк после `action()` сам определяет, куда
сохранять:

| Что заполнено                            | Куда сохраняется                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Только `userData`                        | БД (если подключена) или локальное хранилище (если `isLocalStorage=true` и БД не подключена; на Telegram/VK/MAX/Viber — память процесса) |
| Только `state`                           | Локальное хранилище платформы                                                                                                            |
| И `userData`, и `state` (разные объекты) | `userData` → БД, `state` → локальное хранилище                                                                                           |

Вам не нужно вызывать никаких методов «сохранения» — фреймворк делает это автоматически.

### Что класть в `userData` / `state`

| Тип данных                                                              | Где хранить                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Прогресс игры, счёт                                                     | `userData.score`, `userData.level`                                                                                                                                                                           |
| Настройки пользователя (язык, тема)                                     | `userData.preferences`                                                                                                                                                                                       |
| Авторизационный токен                                                   | `userData.token`                                                                                                                                                                                             |
| Текущий шаг сценария                                                    | **Не храните вручную!** Используйте `controller.thisIntentName` — фреймворк сам сохранит его: в `userData.oldIntentName`, а при `isLocalStorage: true` без БД и пустом `userData` — в `state.oldIntentName`. |
| Временные данные текущего диалога (черновик сообщения, выбранный товар) | `state.draft`, `state.selectedItemId` (только если `isLocalStorage=true`)                                                                                                                                    |

### Важный нюанс: удаление полей (Алиса)

У Алисы локальное хранилище устроено так, что **отсутствие поля не означает его удаление** — платформа игнорирует
отсутствие и оставляет старое значение. Поэтому `delete this.userData.foo` или `this.userData.foo = undefined` **не
работают**: при следующем запросе поле вернётся со старым значением.

Чтобы **удалить** поле, установите его в `null`:

```ts
this.userData.tempData = null; // поле будет удалено на стороне Алисы
// А НЕ:
// delete this.userData.tempData;  // НЕ сработает — поле вернётся
// this.userData.tempData = undefined;  // НЕ сработает — поле вернётся
```

### Типизированный `userData`

Базовый интерфейс `IUserData` содержит только одно поле — `oldIntentName?: string | null` (фреймворк сохраняет его
автоматически для многошаговых диалогов). Все остальные поля вы добавляете в своём интерфейсе-наследнике.

В рантайме объект `userData` **может быть пустым** при первом запросе пользователя (особенно если используете
`isLocalStorage: true` и пользователь впервые открыл навык). Поэтому всегда инициализируйте поля через `??=`.

#### Шаг 1 — описать интерфейс

```ts
import { IUserData } from 'umbot';

interface MyUserData extends IUserData {
    score: number;
    name?: string;
    lastVisit?: string;
    preferences?: {
        language: 'ru' | 'en';
        theme: 'light' | 'dark';
    };
}
```

#### Шаг 2 — подключить типизацию там, где работаете с `userData`

Типизация подключается по-разному в зависимости от того, пишете ли вы через `BotController` или через `addCommand` /
`addStep`. **Если этого не сделать, обращение `bc.userData.score += 1` в команде даст ошибку типов** — TypeScript не
знает про поле `score`.

**Вариант A — в `addCommand` (через generic-параметр):**

```ts
import { Bot, BotController, IUserData } from 'umbot';

// 1. Аннотируем bc как BotController<MyUserData>
bot.addCommand('play', ['играть'], (_: string, bc: BotController<MyUserData>) => {
    bc.userData.score ??= 0; // ✅ TypeScript знает, что score: number
    bc.userData.score += 10;
    bc.userData.lastVisit = new Date().toISOString();
    bc.text = `Счёт: ${bc.userData.score}`;
});

// ❌ Без типизации — ошибка TS возникнет при использовании значения:
// bot.addCommand('play', ['играть'], (_, bc) => {
//     bc.userData.score += 10;   // ← 'score' is of type 'unknown': запись разрешена
//                                //   (у IUserData индексная сигнатура), но арифметика — нет
// });
```

**Вариант B — в `addStep` (тоже через generic):**

```ts
bot.addStep('game_answer', (bc: BotController<MyUserData>) => {
    bc.userData.score ??= 0;
    bc.userData.score += 1;
    bc.text = `Правильно! Счёт: ${bc.userData.score}`;
});
```

**Вариант C — в контроллере (через generic-параметр класса):**

```ts
import { BotController, IUserData } from 'umbot';

export class MyController extends BotController<MyUserData> {
    public action(intentName: string | null): void {
        // this.userData уже типизирован как MyUserData
        this.userData.score ??= 0;
        this.userData.score += 1;
        this.userData.lastVisit = new Date().toISOString();
        this.text = `Счёт: ${this.userData.score}`;
    }
}
```

> **Совет:** объявите интерфейс `MyUserData` в отдельном файле (`src/types.ts` или `src/models/userData.ts`) и
> импортируйте там, где нужен. Это избавит от дублирования.

### Когда нужна БД (Mongo)

- Бот работает на Telegram, VK, MAX или Viber — там нет локального хранилища, и без БД `userData` живёт только в
  памяти процесса (теряется при перезапуске).
- Объём state > 1 КБ (лимит локального хранилища Алисы).
- Несколько инстансов бота (load balancing) — FileAdapter не безопасен для multi-process.

### Когда хватит FileAdapter

- Прототип.
- Навык только для Алисы с `isLocalStorage: true`.
- Личный бот для небольшой команды (< 100 пользователей).
- Объём данных до ~250 МБ (адаптер логирует warning при 270 МБ — держитесь ниже порога с запасом).

---

## UI-компоненты: кнопки, карточки, изображения, звуки, NLU, навигация

Все компоненты доступны через геттеры `BotController`: `this.buttons`, `this.card`, `this.sound`, `this.nlu`.
Инициализация — lazy. Сброс между запросами — автоматический.

### Buttons — кнопки

```ts
// Интерактивная кнопка (отправляет текст/payload обратно боту)
this.buttons.addBtn('Помощь');
this.buttons.addBtn('Купить', '', { action: 'buy', id: 42 }); // с payload

// Кнопка-ссылка (открывает URL)
this.buttons.addLink('Сайт', 'https://example.com');
this.buttons.addLink('Документация', 'https://docs.example.com', '', {
    utmSource: 'bot',
    utmCampaign: 'welcome',
});

// Цепочка
this.buttons.addBtn('Да').addBtn('Нет').addLink('Подробнее', 'https://example.com/help');
```

#### Типы кнопок

| Метод                                     | `hide` флаг      | Назначение                                     |
| ----------------------------------------- | ---------------- | ---------------------------------------------- |
| `addBtn(title, url?, payload?, options?)` | `true` (B_BTN)   | Интерактивная — отправляет payload при нажатии |
| `addLink(title, url, payload?, options?)` | `false` (B_LINK) | Ссылка / suggestion chip                       |

#### Payload кнопок — как передавать и читать

`payload` — это произвольные данные, которые прикрепляются к кнопке и приходят обратно в `controller.payload` при её
нажатии. Фреймворк нормализует payload: передавайте объект — объект и получите, независимо от платформы.

```ts
// Регистрируем кнопку с payload-объектом
this.buttons.addBtn('Купить', '', { action: 'buy', id: 42 });

// При нажатии кнопки контроллер получит тот же объект:
// controller.payload === { action: 'buy', id: 42 }
```

> Тип `controller.payload` — `Record<string, unknown> | string | null | undefined`. Если вы передавали объект — получите
> объект. Проверяйте наличие нужного поля перед использованием: payload может отсутствовать, если пользователь не нажимал
> кнопку.

Пример обработки нажатия кнопки с payload в middleware (проверка до команд, чтобы избежать коллизий):

```ts
// Проверяем payload в middleware ДО обычной обработки команд:
bot.use(async (ctx, next) => {
    const data = ctx.payload as Record<string, unknown> | null;
    if (data?.action === 'buy') {
        ctx.text = `Покупка товара #${data.id} инициирована.`;
        return; // НЕ вызываем next() — обрываем цепочку, обычная обработка не запустится
    }
    await next(); // продолжаем обычную обработку команд/интентов
});
```

> **Совет:** проверяйте payload **до** intentName. На голосовых платформах (Алиса, Маруся) кнопка отправляет свой title
> как текст: кнопка «Играть» даст `userCommand = 'играть'` — и без проверки payload сработает интент вместо обработчика
> кнопки. На Telegram/VK/MAX у callback-кнопок payload `'buy'` или `{"command":"buy"}` нормализуется в
> `userCommand = 'buy'` — проверяйте payload, чтобы отличить нажатие от одноимённой команды.

#### Лимиты и рекомендации

У каждой платформы свой максимальный лимит кнопок, но адаптеры автоматически обрезают лишнее — вам не нужно
следить за этим вручную. Актуальные лимиты адаптеров: **Алиса, Маруся, VK — 10 кнопок; Telegram — 40; Viber — 6;
SmartApp — 8; MAX — 30**. Сверх лимита кнопки отбрасываются с предупреждением в лог. Сколько кнопок встанет в один
ряд, задаёт `buttons.row()` (ниже).

> **UX-рекомендация:** не перегружайте интерфейс кнопками. Для голосовых платформ и большинства чат-ботов оптимально
> _3–5 кнопок_ на одном экране. Пользователь (особенно голосовой) не сможет быстро произнести 10 вариантов, а на экране
> более 5 кнопок начинают сливаться.

Платформо-специфичные опции (через `options`):

| Платформа | Опции в `options`                                                                                                                                                                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VK        | `_group` (строка или число) — кнопки одной группы встают в один ряд (как `buttons.row()`); `color: 'primary' \| 'secondary' \| 'positive' \| 'negative'`                                                                                                                                                                                |
| Telegram  | `request_contact` / `request_location` (bool) — запрос контакта/геолокации; `style` — стиль inline-кнопки (`TG_STYLE_PRIMARY`/`TG_STYLE_SUCCESS`/`TG_STYLE_DANGER`, Bot API 9.4+; другие значения Telegram отклоняет — адаптер их пропускает с warn); `inline` (bool) — показать кнопку без payload и url inline-кнопкой под сообщением |
| Viber     | `ActionType: 'reply' \| 'open-url' \| 'location-picker' \| 'share-phone'`                                                                                                                                                                                                                                                               |

Примеры:

```ts
// VK: группировка в строку и цвет
this.buttons.addBtn('A', '', '', { _group: 1, color: 'primary' });
this.buttons.addBtn('B', '', '', { _group: 1, color: 'secondary' });

// Telegram: запрос контакта/геолокации
this.buttons.addBtn('Отправить телефон', '', '', { request_contact: true });
this.buttons.addBtn('Отправить гео', '', '', { request_location: true });

// Telegram: стиль inline-кнопки (Bot API 9.4+; константы — из 'umbot/plugins')
this.buttons.addBtn('Купить', '', 'buy', { style: TG_STYLE_SUCCESS });

// Telegram: обычная кнопка, показанная inline-кнопкой под сообщением
this.buttons.addBtn('Каталог', '', '', { inline: true });

// Viber: кастомный тип
this.buttons.addBtn('Геолокация', '', '', {
    ActionType: 'location-picker',
    ActionBody: 'loc_payload',
});
```

Про опцию `inline` стоит знать три вещи:

- она нужна только кнопке **без** `payload` и `url` — такие кнопки по умолчанию уходят обычной
  reply-клавиатурой; кнопка с payload или ссылкой и так становится inline-кнопкой;
- нажатие приходит боту как текст кнопки, то есть срабатывают обычные команды, а не `addAction`;
- на кнопки `request_contact` / `request_location` опция не действует: Telegram принимает их
  только в обычной клавиатуре.

Telegram не совмещает два типа клавиатуры в одном сообщении, поэтому, если в ответе есть хоть одна
inline-кнопка, адаптер показывает inline и остальные текстовые кнопки — иначе они бы просто
пропали. Проекты, сгенерированные командой `npx umbot create from-flow`, выставляют `inline: true`
всем кнопкам Telegram.

#### Раскладка по рядам — `buttons.row()`

По умолчанию чат-платформы выводят каждую кнопку отдельной строкой. `row()` завершает текущий ряд: кнопки,
добавленные до вызова, выводятся в одну строку, следующие — в новую.

```ts
this.buttons.addBtn('Да').addBtn('Нет').row().addBtn('Помощь');
// Telegram / VK / MAX / Viber:
// [ Да ] [ Нет ]
// [   Помощь   ]
```

- Лимиты кнопок в ряду: Telegram — 8, VK — 5 (кнопка `location`/`vkpay`/`open_app` занимает ряд целиком),
  MAX — 7 (3, если в ряду есть ссылка, `open_app`, запрос геолокации или контакта), Viber — 6 (ширина строки
  делится между кнопками ряда, явный `Columns` в опциях сохраняется). Лишние кнопки переносятся на следующую строку
  с предупреждением в лог.
- Ряд — это общая группа `options._group`: кнопки с явно заданной группой её сохраняют, кнопки одной группы
  выводятся в одну строку на всех четырёх платформах.
- Голосовые платформы (Алиса, SmartApp, Маруся) раскладку кнопок не поддерживают — там `row()` ни на что не влияет.

#### Снятие клавиатуры — `buttons.remove()`

На Telegram (reply-клавиатура) и VK клавиатура «прилипает» к диалогу и живёт до явной замены — пустой список кнопок
платформе не отправляется, поэтому снять её пустым `buttons.clear()` нельзя. Для этого есть явный вызов:

```ts
this.buttons.remove(); // попросить платформу убрать ранее показанную клавиатуру
```

У Viber, MAX, Алисы, SmartApp и Маруси клавиатура привязана к сообщению и исчезает сама — вызов там безопасен и ничего
не меняет. Проверить, запрошено ли снятие, можно геттером `buttons.isRemove`. Требование Telegram: в сообщении со
снятием клавиатуры должен быть текст, иначе клавиатура не снимется (фреймворк предупредит в лог).

### Card — карточки

```ts
// Одна картинка с заголовком и описанием
this.card
    .addOneImage('https://example.com/img.jpg', 'Заголовок', 'Описание')
    .addButton({ title: 'Открыть', url: 'https://example.com' });

// Список (галерея) — до 5 элементов на Алисе
this.card
    .setTitle('Каталог товаров')
    .addImage('https://example.com/p1.jpg', 'Товар 1', '99 ₽', {
        title: 'Купить',
        payload: { id: 1 },
    })
    .addImage('https://example.com/p2.jpg', 'Товар 2', '199 ₽', {
        title: 'Купить',
        payload: { id: 2 },
    })
    .addButton({ title: 'В каталог', url: 'https://shop.example.com' });

// Галерея (только изображения, до 10 на Алисе)
this.card.isUsedGallery = true;
this.card
    .addImage('https://example.com/1.jpg', 'Свадьба')
    .addImage('https://example.com/2.jpg', 'Выпускной');
```

#### Типы карточек (авто-определение)

| Что установлено                            | Тип карточки                                        |
| ------------------------------------------ | --------------------------------------------------- |
| `addOneImage()` или `isOne=true`           | Одиночная (BigImage на Алисе)                       |
| `images.length > 1`, `isUsedGallery=false` | Список (ItemsList на Алисе, ≤ 5)                    |
| `isUsedGallery=true`                       | Галерея (только изображения, без описаний и кнопок) |

> Лимиты на количество элементов в карточке (заголовок, описание, число картинок) адаптеры также берут на себя — лишнее
> будет обрезано.

#### Важно про изображения

Если передать URL или путь к существующему файлу — фреймворк **загрузит** изображение на платформу (первый раз) и
_закэширует токен_ в БД (`ImageTokens` модель). Повторные запросы используют токен — без задержки на upload.

```ts
// URL — будет загружен при первом использовании
this.card.addImage('https://example.com/img.jpg', 'Title');

// Локальный файл — будет загружен
this.card.addImage('/abs/path/to/file.png', 'Title');

// Уже известный токен (например, после Preload) — не загружается
this.card.addImage('image_hash_xxx', 'Title');
// Или с явным указанием:
getImage(appContext, 'image_hash_xxx', 'Title', ' ', null, true); // isToken=true
```

### Sound — звуки и TTS-эффекты

```ts
import { SoundConstants } from 'umbot';

// Стандартный звук победы (только Алиса/Маруся)
this.tts = `Поздравляю! ${SoundConstants.S_AUDIO_GAME_WIN} Вы великолепны!`;

// Пауза в 1 секунду
this.tts = `Минуточку${SoundConstants.getPause(1000)}готово!`;

// Эффект "хомяк" (голос становится высоким)
this.tts = `${SoundConstants.S_EFFECT_HAMSTER}Привет!${SoundConstants.S_EFFECT_END}`;

// Кастомный звук (загружается из файла при первом использовании; Алиса и Маруся —
// <speaker audio="..."> в TTS, чат-платформы — аудио-сообщением)
this.sound.sounds = [{ key: '#bell#', sounds: ['/audio/bell.mp3'] }];
this.tts = 'Внимание! #bell# Объявление.';
```

#### Стандартные звуки (константы `SoundConstants`)

- `S_AUDIO_GAME_WIN` — победа в игре
- `S_AUDIO_GAME_LOSS` — проигрыш
- `S_AUDIO_GAME_8_BIT_COIN` — монетка (обратите внимание: `8_BIT` в названии!)
- `S_AUDIO_GAME_BOOT` — загрузка игры
- `S_AUDIO_GAME_PING` — пинг
- `S_AUDIO_GAME_8_BIT_FLYBY` — пролёт
- `S_AUDIO_GAME_8_BIT_MACHINE_GUN` — пулемёт
- `S_AUDIO_GAME_8_BIT_PHONE` — телефон
- `S_AUDIO_GAME_POWERUP` — power-up
- `S_AUDIO_NATURE_WIND` — ветер
- `S_AUDIO_NATURE_THUNDER` — гром
- `S_AUDIO_NATURE_JUNGLE` — джунгли
- `S_AUDIO_NATURE_RAIN` — дождь
- `S_AUDIO_NATURE_FOREST` — лес
- `S_AUDIO_NATURE_SEA` — море
- `S_AUDIO_NATURE_FIRE` — костёр
- `S_AUDIO_NATURE_STREAM` — ручей
- `S_AUDIO_THING_CHAINSAW` — бензопила
- `S_AUDIO_NATURE_ANIMALS` — животные
- `S_AUDIO_NATURE_HUMAN` — человек
- `S_AUDIO_MUSIC` — музыка

> Полный список — в `src/components/sound/constants.ts`. Имена некоторых констант содержат `8_BIT` (
> `S_AUDIO_GAME_8_BIT_COIN`, `S_AUDIO_GAME_8_BIT_FLYBY`, `S_AUDIO_GAME_8_BIT_MACHINE_GUN`, `S_AUDIO_GAME_8_BIT_PHONE`) —
> не теряйте эту часть имени.

#### Эффекты голоса (только Алиса)

- `S_EFFECT_BEHIND_THE_WALL` — голос за стеной
- `S_EFFECT_HAMSTER` — хомяк (высокий голос)
- `S_EFFECT_MEGAPHONE` — мегафон
- `S_EFFECT_PITCH_DOWN` — низкий голос
- `S_EFFECT_PSYCHODELIC` — психеделический
- `S_EFFECT_PULSE` — пульсирующий
- `S_EFFECT_TRAIN_ANNOUNCE` — объявление на вокзале
- `S_EFFECT_END` — конец эффекта

#### Поведение на разных платформах

| Платформа       | Стандартные звуки | Кастомные звуки                    | Эффекты `S_EFFECT_*`                           | Паузы |
| --------------- | ----------------- | ---------------------------------- | ---------------------------------------------- | ----- |
| Алиса           | ✅                | ✅ (через `<speaker audio="...">`) | ✅                                             | ✅    |
| Маруся          | ✅                | ✅                                 | ❌                                             | ✅    |
| SmartApp        | ❌                | ❌                                 | ❌                                             | ❌    |
| Telegram/VK/MAX | ❌                | ✅ (загружается как аудио)         | ❌ (TTS через SpeechKit, отдельным сообщением) | ❌    |
| Viber           | ❌                | ❌                                 | ❌ (tts при пустом text уходит как текст)      | ❌    |

> ⚠️ SmartApp не поддерживает ни стандартные, ни кастомные звуки, ни TTS-эффекты: звуковые маркеры из `tts` вычищаются,
> а сам текст `tts` произносится ассистентом.

> **Важно.** На Telegram/VK/MAX для TTS нужен токен Yandex SpeechKit. Укажите его в
> `appConfig.tokens[platform].speech_kit_token` или в переменной окружения `SPEECH_KIT_TOKEN`.
>
> **Про SSML.** Готовые константы эффектов (`S_EFFECT_*`, раздел выше) фреймворк подставляет
> только для Алисы. Сырые SSML-теги `<speaker ...>`, прописанные в `tts` вручную, у Маруси
> передаются в TTS как есть, а у SmartApp отправляются с типом `application/ssml` — но
> поддержка конкретных тегов и эффектов зависит от TTS самой платформы.

### NLU — извлечение сущностей

```ts
// Text — для склонения окончаний, Nlu — для статических методов ниже
import { Nlu, Text } from 'umbot';

// ФИО (Алиса/Маруся)
const fio = this.nlu.getFio();
if (fio.status) {
    const p = fio.result![0];
    this.text = `Привет, ${p.first_name} ${p.last_name}!`;
}

// Дата/время (Алиса/Маруся)
const dt = this.nlu.getDateTime();
if (dt.status) {
    const d = dt.result![0];
    if (d.day_is_relative) {
        // Склоняем окончание: Text.getEnding(5, ['день', 'дня', 'дней'])
        const days = Text.getEnding(d.day ?? 0, ['день', 'дня', 'дней']) || 'дней';
        this.text = `Через ${d.day} ${days}`;
    } else {
        this.text = `${d.day}.${d.month}.${d.year}`;
    }
}

// Число (Алиса/Маруся)
const num = this.nlu.getNumber();
if (num.status) {
    this.text = `Вы назвали число ${num.result![0]}`;
}

// Гео (Алиса)
const geo = this.nlu.getGeo();
if (geo.status) {
    const g = geo.result![0];
    this.text = `Город: ${g.city}, улица: ${g.street}`;
}

// Имя пользователя (Telegram, VK, Viber, MAX — адаптеры заполняют thisUser)
const user = this.nlu.getUserName();
if (user?.first_name) {
    this.text = `Привет, ${user.first_name}!`;
}

// Built-in интенты (работают на всех платформах через userCommand)
if (this.nlu.isIntentConfirm(this.userCommand || '')) {
    this.text = 'Вы согласились!';
}
if (this.nlu.isIntentReject(this.userCommand || '')) {
    this.text = 'Вы отказались.';
}

// Static-методы — работают на любой платформе через regex
const phones = Nlu.getPhone(this.originalUserCommand || '');
if (phones.status) {
    this.userData.phone = phones.result![0];
}

const emails = Nlu.getEMail(this.originalUserCommand || '');
if (emails.status) {
    this.userData.email = emails.result![0];
}

const links = Nlu.getLink(this.originalUserCommand || '');
if (links.status) {
    this.userData.url = links.result![0];
}

// Кастомные интенты (Алиса и Маруся — настраиваются в кабинете платформы)
const myIntent = this.nlu.getIntent('ORDER_PIZZA');
if (myIntent) {
    const slot = Array.isArray(myIntent.slots) ? myIntent.slots[0] : myIntent.slots;
    // ...
}
```

#### Доступность NLU по платформам

| Возможность                                  | Алиса | Маруся | SmartApp | Telegram | VK  | Viber | Max |
| -------------------------------------------- | ----- | ------ | -------- | -------- | --- | ----- | --- |
| FIO, GEO, DateTime, Number                   | ✅    | ✅     | ❌       | ❌       | ❌  | ❌    | ❌  |
| Кастомные интенты (`nlu.getIntent`)          | ✅    | ✅     | ❌*      | ❌       | ❌  | ❌    | ❌  |
| `getUserName()`                              | ❌    | ❌     | ❌       | ✅       | ✅  | ✅    | ✅  |
| `isIntentConfirm/Reject` (через userCommand) | ✅    | ✅     | ✅       | ✅       | ✅  | ✅    | ✅  |
| `getLink/getPhone/getEMail` (regex, static)  | ✅    | ✅     | ✅       | ✅       | ✅  | ✅    | ✅  |

> \* У SmartApp интент приходит в `payload.intent` и попадает в `controller.oldIntentName`, а не в `nlu.intents` —
> `getIntent()` для SmartApp всегда вернёт `null`. Свои интенты определяйте в SmartApp Code и обрабатывайте по
> `oldIntentName`.

### Navigation — пагинация

```ts
import { BotController, Navigation } from 'umbot';

interface Product {
    id: number;
    name: string;
    price: number;
}

class ShopController extends BotController {
    // В реальности — сохранять между запросами через this.userData.nav = { page: N }
    nav = new Navigation<Product>(3); // 3 элемента на странице

    public action(intentName: string | null): void {
        const products: Product[] = [
            { id: 1, name: 'Яблоко', price: 50 },
            { id: 2, name: 'Груша', price: 70 },
            { id: 3, name: 'Банан', price: 40 },
            { id: 4, name: 'Апельсин', price: 80 },
            { id: 5, name: 'Манго', price: 200 },
            { id: 6, name: 'Киви', price: 90 },
            { id: 7, name: 'Лимон', price: 30 },
        ];

        // Получаем текущую страницу (метод сам сдвигает thisPage при "дальше"/"назад")
        const page = this.nav.getPageElements(products, this.userCommand || '');

        // Рендерим как карточку-список
        this.card.setTitle('Выберите товар');
        for (const p of page) {
            this.card.addImage(`https://shop.example.com/img/${p.id}.jpg`, p.name, `${p.price} ₽`, {
                title: 'Купить',
                payload: { action: 'buy', id: p.id },
            });
        }

        // Кнопки пагинации
        for (const caption of this.nav.getPageNav()) {
            this.buttons.addBtn(caption);
        }

        // Информация о странице
        const info = this.nav.getPageInfo();
        if (info) this.buttons.addBtn(info);

        // Пользователь выбрал элемент?
        const selected = this.nav.selectedElement(products, this.userCommand || '', ['name']);
        if (selected) {
            this.text = `Вы выбрали: ${selected.name} за ${selected.price} ₽`;
        }
    }
}
```

#### Методы `Navigation`

| Метод                                   | Назначение                                                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPageElements(elements, text)`       | Возвращает элементы текущей страницы. **Мутирует `thisPage`** при "дальше"/"назад"                                                                        |
| `selectedElement(elements, text, keys)` | Подбирает элемент по тексту (по номеру или по похожести текста)                                                                                           |
| `getPageNav(isNumber?)`                 | Возвращает подписи кнопок пагинации: `['👈 Назад', 'Дальше 👉']` или `['1', '[2]', '3']`. «Назад» не отдаётся на первой странице, «Дальше» — на последней |
| `getPageInfo()`                         | Возвращает `"N страница из M"` (или пустую строку)                                                                                                        |
| `getMaxPage(elements)`                  | Количество страниц                                                                                                                                        |
| `numberPage(text)`                      | Распознать указание страницы вида `"2 страница"` / `"N страни…"` (цифра обязательна) и перейти. Отрицательные значения молча приводятся к странице 0      |

> **Важно:** `Navigation` — чисто in-memory. Сохраняйте `thisPage` (и при необходимости список элементов) в `userData`
> между запросами.

### API платформы — `controller.api`

На чат-платформах из контроллера доступен ленивый фасад к API платформы: `ctx.api`. Он создаётся при первом
обращении и сбрасывается между запросами, на голосовых платформах (Алиса, SmartApp, Маруся) равен `null`.
Получатель всегда один — пользователь текущего запроса, поэтому chatId/userId в методы не передаётся.

```ts
bot.addCommand('фото', ['фото'], async (_, ctx) => {
    if (ctx.api?.can('sendPhoto')) {
        // Отправка фото напрямую через API платформы (Telegram/MAX — все методы,
        // VK — sendPhoto/sendDocument/answerCallback)
        await ctx.api.sendPhoto('https://example.com/cat.png', { caption: 'Вот кот!' });
    }
});
```

| Метод            | Telegram | VK  | MAX | Viber           |
| ---------------- | -------- | --- | --- | --------------- |
| `sendPhoto`      | ✅       | ✅  | ✅  | — (warn + null) |
| `sendDocument`   | ✅       | ✅  | ✅  | — (warn + null) |
| `sendAudio`      | ✅       | —   | ✅  | — (warn + null) |
| `sendVideo`      | ✅       | —   | ✅  | — (warn + null) |
| `answerCallback` | ✅       | ✅  | ✅  | — (warn + null) |

- `answerCallback(text, showAlert?)` — уведомление на нажатие callback-кнопки (вне callback-запроса — warn и `null`).
- `can(method)` — проверка поддержки метода платформой (у Viber возвращает `false`).
- Своя платформа подключает фасад переопределением метода адаптера `createApi(controller)` — как, см.
  [platform-integration.md](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/platform-integration), раздел «API платформы».
- Полная матрица и сигнатуры — в [api-reference.md](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/api-reference), раздел «API платформы», и в
  [platform-integration.md](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/platform-integration).

---

## Платформы — регистрация и общие принципы

Из коробки поддерживается 7 платформ: Алиса, SmartApp (Сбер), Маруся, Telegram, VK, Viber, Max. Подключить можно любым
из способов ниже.

```ts
// Вариант 1: все платформы сразу — самый частый выбор
bot.use(fullPlatforms);

// Вариант 2: только голосовые (Алиса, SmartApp, Маруся)
bot.use(voicePlatforms);

// Вариант 3: только чат-боты (Telegram, VK, Viber, Max)
bot.use(botPlatforms);

// Вариант 4: выборочно по одной (если хотите ограничить круг платформ)
bot.use(new AlisaAdapter('YANDEX_OAUTH_TOKEN'));
bot.use(new TelegramAdapter('TELEGRAM_BOT_TOKEN'));
bot.use(
    new VkAdapter('VK_TOKEN', {
        vk_confirmation_token: 'CONFIRMATION_STRING', // обязательно для VK
        vk_api_version: '5.199', // опционально
    }),
);
bot.use(
    new ViberAdapter('VIBER_TOKEN', {
        viber_sender: 'MyBotName', // обязательно для Viber, ≤ 28 символов
        viber_api_version: '8', // опционально
    }),
);
bot.use(new MaxAdapter('MAX_TOKEN'));
bot.use(new MarusiaAdapter('MARUSIA_TOKEN'));
bot.use(new SmartAppAdapter()); // без токена — аутентификация через Sber-экосистему
```

> Нужна своя платформа (Discord, Slack, WhatsApp, корпоративный мессенджер)? `umbot` поддерживает добавление кастомных
> адаптеров через `BasePlatformAdapter`. Подробное руководство —
> в [официальной документации](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/adapter/platformAdapter).

`Bot` сам определяет, от какой платформы пришёл запрос, — один webhook-эндпоинт принимает запросы всех платформ.
Лимиты платформ (длина текста, число кнопок, размер state) адаптеры соблюдают сами: лишнее обрезается с
предупреждением в лог, поэтому код остаётся одинаковым для всех платформ. Ваша зона ответственности — время ответа
голосовым платформам: фреймворк предупреждает после 2 с обработки и пишет ошибку после 2,9 с.

Что поддерживает каждая платформа (сводная таблица), как переопределить определение платформы
(`setPlatformResolver`) и особенности каждой платформы — в [Подключении платформ](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/platform-integration).

---

## Базы данных

Если используете `controller.userData` для персистентных данных (а не только `isLocalStorage: true`), нужно подключить
DB-адаптер. Из коробки доступны два; для остальных (PostgreSQL, Redis, ...) можно написать свой через `BaseDbAdapter`.

### FileAdapter — файловая БД (для разработки и небольших проектов)

Использует JSON-файлы в папке `appConfig.json`. Подходит для прототипов, личных навыков, маленьких команд (< 100
пользователей).

```ts
import { FileAdapter } from 'umbot/plugins';

bot.use(new FileAdapter());
bot.setAppConfig({ json: './data' }); // папка для JSON-файлов
```

**Лимиты:** до ~250 МБ данных (логирует warning при 270 МБ, error при 360 МБ, при ~400 МБ возможен краш — весь файл
грузится в память). Один процесс (небезопасно для multi-process). Только строгое равенство в `where` (без операторов
типа `$gt`, `$in`).

### MongoAdapter — MongoDB (для production)

```ts
import { MongoAdapter } from 'umbot/plugins';

// Вариант 1: опции в конструкторе
bot.use(
    new MongoAdapter({
        host: 'mongodb://localhost:27017',
        database: 'umbot',
        user: 'root',
        pass: 'secret',
        options: { maxPoolSize: 100 },
    }),
);

// Вариант 2: через appConfig.db + .env
bot.use(new MongoAdapter());
bot.setAppConfig({
    db: {
        host: process.env.DB_HOST!,
        user: process.env.DB_USER,
        pass: process.env.DB_PASSWORD,
        database: process.env.DB_NAME!,
    },
    env: '.env',
});
```

**Особенности:** pool size 50, таймауты 2–3 с (serverSelection/connect/socket — 2000 мс, общий `timeoutMS` — 3000 мс),
поддержка операторов запросов (`$gt`, `$in`, `$or`, агрегации),
multi-process safe. Подходит для production-нагрузок.

### Свой DB-адаптер (PostgreSQL, Redis, ...)

Нужна другая БД? `umbot` поддерживает кастомные адаптеры через `BaseDbAdapter` — реализуйте 5 методов (`_select`,
`_insert`, `_update`, `_remove`, `isConnected`) и зарегистрируйте через `bot.use(new MyAdapter())`. Пример реализации —
в [официальной документации](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/adapter/dbAdapter) и
в `examples/skills/userDbConnect/` репозитория.

### Что фреймворк хранит в БД автоматически

- `userData` (через модель `UsersData`) — основное пользовательское состояние.
- `ImageTokens` / `SoundTokens` — кэш токенов загруженных медиа. **Этим кэшем вы не управляете вручную** — фреймворк сам
  загружает изображения/звуки на платформу при первом использовании и переиспользует токены потом.

Прямой доступ к `ImageTokens` / `SoundTokens` нужен только для инспекции или инвалидации кэша (чтобы принудительно
перезагрузить медиа). В 99% случаев вам это не понадобится.

### Когда нужна своя модель

Если помимо `userData` нужна отдельная таблица (рекорды, каталог, логи), создайте модель через `Model<TState>`.
Для простых навыков обычно хватает `userData`. Пример модели и её методы — в
[справочнике API](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/api-reference#model).

---

## Middleware и `rateLimiter`

Middleware — функции, которые получают запрос **до** обработчиков (команд, шагов, `action()`): аутентификация,
фильтрация, ограничение частоты, трейсинг.

```ts
import { T_ALISA } from 'umbot/plugins';
import { rateLimiter, requestId } from 'umbot/middleware';

// Глобальная — для всех платформ
bot.use(async (ctx, next) => {
    ctx.appContext.log(`[${ctx.appType}] ${ctx.userId}: ${ctx.userCommand}`);
    await next(); // без next() обработка на этом заканчивается
});

// Только для Алисы
bot.use(T_ALISA, async (ctx, next) => {
    if (!ctx.userData.authorized) {
        ctx.text = 'Пожалуйста, авторизуйтесь';
        return; // next() не вызываем — команды не запустятся
    }
    await next();
});

// Встроенные
bot.use(requestId());
bot.use(rateLimiter());
```

Порядок: сначала вся глобальная цепочка (вместе с кодом после `await next()`), затем платформенная, и только потом
обработчик. Поэтому после `await next()` ответ ещё не сформирован — читать `ctx.text` там бесполезно; ответ целиком
доступен в `responseCb` у `bot.start()` / `bot.webhookHandle()`. Исключение в middleware ядро запишет в лог и
ответит платформе 200, но команды не выполнятся.

Встроенные middleware (`rateLimiter`, `authGuard`, `requestId`, `maintenance`, `ipFilter`), их опции и правила
написания своих — в [Middleware](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/middleware).

---

## Preload — предзагрузка медиа

Первая отправка картинки или звука загружает файл на платформу (200–1000 мс на файл) и может не уложиться в лимит
голосовой платформы. `Preload` делает это при старте: токены сохраняются в БД (`ImageTokens` / `SoundTokens`), и
первый пользователь получает ответ так же быстро, как все остальные.

```ts
import { Preload } from 'umbot/preload';
import { T_ALISA } from 'umbot/plugins';

const preload = new Preload(bot.getAppContext());
await Promise.all([
    ...preload.loadImages(['./media/img1.jpg'], [T_ALISA], { alisaSkillId: 'ваш-skill-id' }),
    ...preload.loadSounds(['./media/win.mp3'], [T_ALISA], { alisaSkillId: 'ваш-skill-id' }),
]);
bot.start('0.0.0.0', 3000);
```

Алисе нужен `alisaSkillId`, Telegram — `telegramUseId` (пользователь, которому придёт файл для получения `file_id`).
Методы, возвращаемые значения и удаление медиа — в [справочнике API](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/api-reference#preload).

---

## Тестирование — `BotTest` и Jest

`BotTest` — тот же `Bot`, но с диалогом в консоли: замените `Bot` на `BotTest` и `start()` на `test()`, вводите
реплики и смотрите ответы, не публикуя навык.

```ts
import { BotTest } from 'umbot/test';
import { fullPlatforms } from 'umbot/plugins';

const bot = new BotTest();
bot.use(fullPlatforms);
bot.setPlatformParams({ welcome_text: 'Привет!', intents: [] });
await bot.test({ isShowResult: true, isShowStorage: true });
```

Для Jest удобнее `simulate()`: он сам собирает корректный запрос платформы и возвращает ответ.

```ts
const res = await bot.simulate('привет', { platform: 'alisa' });
```

Параметры `test()`, `simulate()`, тесты через `run()`, моки HTTP-клиента и БД — в [Тестировании](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/testing).

---

## Деплой — `start`, `webhookHandle`, Docker, Express

- **Встроенный сервер** — `bot.start('0.0.0.0', 3000)`: принимает вебхуки на `POST /`, отдаёт `GET /health`,
  сам завершается по SIGTERM/SIGINT.
- **Свой сервер (Express, Fastify)** — `app.post('/webhook', (req, res) => bot.webhookHandle(req, res))`; не
  подключайте `express.json()`, `webhookHandle` читает тело сам.
- **Serverless** (Yandex Cloud Functions) — `bot.webhookEvent(body, headers, clientIp)` возвращает готовый
  `{ statusCode, body }`; проект с обработчиком генерирует `npx umbot create from-flow flow.json --usecloud`.
- **Long polling** (Telegram, VK, MAX) — `bot.startPolling()`, публичный адрес не нужен.

HTTPS и nginx, Docker, PM2, CI/CD, несколько процессов и чеклист перед запуском — в [Развертывании](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/deployment).

---

## Лимиты и производительность — что нужно знать

### Про лимиты платформ

Лимиты платформ (длина текста, число кнопок, размер карточек) **адаптеры берут на себя** — подробнее в
[Подключении платформ](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/platform-integration#лимиты-что-адаптер-делает-сам). Вам не нужно их запоминать: фреймворк сам обрежет лишнее.

Единственное, за что вы отвечаете:

- **Время ответа** — фреймворк пишет предупреждение при обработке за 2000 мс и более и ошибку при 2900 мс и более;
  лимиты голосовых платформ сверяйте с их актуальной документацией.
  Это ограничение самой платформы, и фреймворк не может «обрезать» вашу бизнес-логику. Делайте `action()` быстрым.
- **Объём `userData` при `isLocalStorage=true`** — локальное хранилище Алисы ограничено 1 КБ на тип состояния. Если
  данные большие — используйте БД.
- **Размер HTTP-запроса** — встроенный сервер принимает до 2 МБ в теле. Платформы присылают гораздо меньше, так что это
  редко проблема.

### Антипаттерны: чего следует избегать

1. **Долгие синхронные операции в `action()` или в команде** — заблокируют event loop и таймаут голосовой платформы.
    - ❌ `JSON.parse(fs.readFileSync(hugeFile))`
    - ✅ `await fs.promises.readFile()`

2. **Сложные RegExp без защиты от ReDoS** — `setAppMode('strict_prod')` проверит, но не рискуйте.
    - ❌ `/(a+)+b/` (катастрофический бэктрекинг)
    - ✅ `/a+b/`

3. **Делать HTTP-запросы без таймаута** — внешний API может зависнуть и исчерпать лимит времени ответа.
    - ❌ `await fetch(url)`
    - ✅ `AbortController` с `setTimeout(() => controller.abort(), 3000)`

4. **Хранить большие данные в `userData` при `isLocalStorage=true`** — лимит 1 КБ на стороне платформы.
    - ❌ `userData.history = [1000 сообщений]`
    - ✅ Использовать MongoAdapter

5. **Использовать `delete this.userData.field`** — на Алисе отсутствие поля не означает его удаление, платформа вернёт
   старое значение.
    - ❌ `delete this.userData.tempData`
    - ✅ `this.userData.tempData = null`

6. **Забывать `intents` в `setPlatformParams`** — поле обязательное.
    - ❌ `bot.setPlatformParams({ welcome_text: 'Привет' })`
    - ✅ `bot.setPlatformParams({ welcome_text: 'Привет', intents: [] })`

7. **Логировать секреты** — маскировка секретов в логах работает во всех режимах (`dev`, `prod`, `strict_prod`),
   но не логируйте чувствительные данные намеренно. Отключить маскировку можно только явно, передав кастомный
   логгер с `maskSecrets: false` — не делайте этого в production.

### Производительность

Внутренняя обработка запроса — меньше 30 мс даже при 1000 команд; цифры, методика замеров и советы по большим базам
команд — в [Производительности и гарантиях](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/performance-and-guarantees).

---

## Обработка ошибок

Фреймворк `umbot` обрабатывает ошибки на нескольких уровнях. Понимание этих уровней поможет вам писать надёжный код.

### Уровень 1: Команды и шаги

Если callback команды выбрасывает исключение, фреймворк перехватывает его, логирует ошибку и возвращает
пользователю стандартное сообщение «Не удалось выполнить команду. Попробуйте ещё раз.». Для шагов диалога текст
аналогичный: «Не удалось выполнить шаг диалога. Попробуйте ещё раз.».

```ts
// Фреймворк автоматически обернёт этот код в try/catch:
bot.addCommand('risk', ['риск'], async (_, bc) => {
    const res = await fetch('https://external-api.com/data', {
        signal: AbortSignal.timeout(3000), // может упасть или зависнуть
    });
    const data = await res.json();
    bc.text = data.answer;
});
```

Если вам нужно обработать ошибку самостоятельно (например, показать пользователю понятное сообщение), используйте
`try/catch` внутри callback:

```ts
bot.addCommand('risk', ['риск'], async (_, bc) => {
    try {
        const res = await fetch('https://external-api.com/data', {
            signal: AbortSignal.timeout(3000),
        });
        const data = await res.json();
        bc.text = data.answer;
    } catch (error) {
        bc.text = 'Сервис временно недоступен. Попробуйте позже.';
        bc.appContext.logError('Ошибка при обращении к внешнему API', { error });
    }
});
```

### Уровень 2: Middleware

Middleware-функции также могут выбрасывать исключения. Если middleware не вызвал `next()` и не установил `text` —
`action()` не будет вызван, и пользователь получит пустой ответ.

```ts
bot.use(async (ctx, next) => {
    try {
        const allowed = await checkAccess(ctx.userId);
        if (!allowed) {
            ctx.text = 'Доступ запрещён.';
            return; // next() не вызываем — action() не запустится
        }
        await next();
    } catch (error) {
        ctx.appContext.logError('Ошибка в middleware', { error });
        ctx.text = 'Произошла ошибка. Попробуйте позже.';
    }
});
```

### Уровень 3: Контроллер (action)

Исключение (или отклонённый промис) в `action()` фреймворк перехватывает: пишет ошибку в лог, а если `text` ещё
пустой — отвечает «Не удалось выполнить команду. Попробуйте ещё раз.». Свой текст ошибки задайте через `try/catch`:

```ts
class SafeController extends BotController {
    public action(intentName: string | null): void {
        try {
            switch (intentName) {
                case WELCOME_INTENT_NAME:
                    this.text = 'Привет!';
                    break;
                default:
                    if (!this.text) this.text = 'Не поняла. Скажите "помощь".';
            }
        } catch (error) {
            this.appContext.logError('Ошибка в action()', { error });
            this.text = 'Извините, произошла ошибка. Попробуйте ещё раз.';
        }
    }
}
```

### Логирование ошибок

Все ошибки логируются через `appContext.logError()`:

```ts
// В любом месте кода:
this.appContext.logError('Описание ошибки', { additionalData: '...' });
```

В режиме `dev` ошибки выводятся в консоль и в файл (если указан `error_log`). В режимах `prod` и `strict_prod` без
своего логгера ошибка пишется в файл, а её текст (без стека и метаданных, с замаскированными секретами) дублируется
строкой `[umbot] ...` в stderr — так ошибки видны в `docker logs` и журнале serverless-функции.

### Типичные сценарии

| Сценарий                                                                                | Что происходит                | Рекомендация                                 |
| --------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------- |
| Ошибка в команде                                                                        | Стандартное сообщение + лог   | Оберните в `try/catch` для кастомного ответа |
| Ошибка в middleware                                                                     | Лог, команды не выполняются   | Логируйте и устанавливайте `text`            |
| Ошибка в `fetch`                                                                        | Промис отклоняется            | Используйте `try/catch` + таймауты           |
| Ошибка в БД                                                                             | Метод возвращает `false`      | Проверяйте результат `save()`                |
| Таймаут платформы (~3 сек; фреймворк предупреждает после 2 с, ошибку пишет после 2,9 с) | Платформа обрывает соединение | Используйте `Preload` для медиа              |

---

## Метрики

Фреймворк замеряет поиск команд и интентов, `action()`, middleware, запросы к БД и к API платформ. Метрики
собираются, только если у логгера есть метод `metric()`:

```ts
bot.setLogger({
    metric: (name: string, value: unknown, labels?: Record<string, unknown>) => {
        console.log(`[METRIC] ${name}: ${value}`, labels);
    },
});
```

Список метрик (`EMetric`) и что каждая измеряет — в [справочнике API](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/api-reference#метрики).

---

## Распространённые ошибки и как их избегать

### Команда не срабатывает

**Причины:**

- В `slots` строка с заглавной буквой — `userCommand` уже в нижнем регистре, но слот тоже должен быть в нижнем.
- Слот содержит спецсимволы — экранируйте или используйте `isPattern=true`.
- Команда зарегистрирована после старта (`start()`). Технически это работает — команды читаются в момент запроса, —
  но регистрируйте их до `start()`, чтобы не получить состояние гонки в первые секунды после запуска.
- Зарегистрирована другая команда с тем же именем — `addCommand` перезаписывает.
- `userCommand` null (платформа прислала не текст, а, например, callback_query без текста).

### TTS-эффекты не работают на Telegram

Это ожидаемое поведение платформ. Готовые константы эффектов (`S_EFFECT_*`) и `<speaker effect="...">` работают только
на Алисе. У Маруси сырые SSML-теги в `tts` передаются как есть; адаптер SmartApp вычищает звуковые маркеры и
отправляет текст с типом `application/ssml` только при реальных SSML-тегах — поддержка конкретных эффектов зависит
от TTS платформы. На Telegram/VK/MAX TTS синтезируется через SpeechKit — нужна отдельная подписка и токен.

### Медленный первый ответ

**Причина:** первое использование изображения/звука → загрузка на платформу (200–1000 мс каждое).

**Решение:** `Preload` при старте.

### `userData` не сохраняется

**Причины:**

- `isLocalStorage: false` и не подключён DB-адаптер → данные не сохраняются.
- `isLocalStorage: true` на Telegram/VK/MAX/Viber без DB-адаптера → данные в памяти процесса: теряются при
  перезапуске, не видны другим процессам/репликам и соседним вызовам serverless-функции. Подключите DB-адаптер.
- `memorySession: false` и не подключён DB-адаптер.
- Поле равно `undefined` → Алиса его не сохранит. Используйте `null` для удаления.
- Объём превысил 1 КБ (state Алисы) → фреймворк пишет ошибку в лог и не отправляет поле платформе, поэтому данные
  не сохраняются (сами значения в `userData` не очищаются).

### Платформа не определяется

**Причины:**

- Запрос пришёл с неизвестными заголовками.
- Несколько платформ имеют похожие маркеры (Алиса/Маруся — одинаковый формат тела).
- Не зарегистрирован адаптер для нужной платформы.

**Решение:** `bot.setPlatformResolver((query, headers, detect) => { ... })`.

### "Rate limit" в логах

**Решение:** подключите `bot.use(rateLimiter())`, либо уменьшите нагрузку на платформу.

### Ошибка «Адаптер платформы "X" не смог разобрать запрос»

Адаптер вернул `false` из `setQueryData` — реальное сообщение фреймворка: `Адаптер платформы "X" не смог разобрать
запрос` (где X — идентификатор платформы). Скорее всего, запрос не соответствует формату платформы: на этот эндпоинт
пришёл посторонний запрос или вебхук настроен на другой платформе. Проверьте вебхук URL и секрет.

### `ReDoS detected` в продакшене

В `strict_prod` режиме опасные regex отклоняются. Упростите паттерн:

- ❌ `/(a+)+b/`
- ✅ `/a+b/` или `/^(a+?)b$/`

---

## Финальные рекомендации

1. **Начните с CLI.** `npx umbot create my-skill` даёт рабочий шаблон за минуту.
2. **Используйте `BotTest` для разработки.** REPL в консоли экономит часы — не нужно публиковать навык и тестировать
   через Яндекс.Диалоги.
3. **Всегда `setAppMode('strict_prod')` в продакшене** (или `NODE_ENV=production`). Он отбрасывает опасные
   регулярные выражения; маскировка секретов в логах работает во всех режимах.
4. **Включайте `Preload` для медиа.** Первый пользователь не должен ждать upload.
5. **Храните состояние в `userData`, а не в локальных переменных контроллера.** Контроллер пересоздаётся на каждый
   запрос.
6. **Тестируйте на всех целевых платформах.** Логика одна, но лимиты и особенности разные.
7. **Следите за временем ответа.** Метрика `END_WEBHOOK` в своём логгере покажет медленные запросы раньше, чем
   их заметит голосовая платформа.
8. **Используйте `MongoAdapter` для продакшена.** `FileAdapter` — только для прототипов.
9. **Читайте исходники.** Они хорошо задокументированы JSDoc на русском.
