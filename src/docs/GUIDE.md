# umbot — инструкция по созданию голосовых навыков и чат-ботов

> **О руководстве**
> Это подробное руководство по разработке кроссплатформенных голосовых навыков и чат-ботов на фреймворке `umbot`.
> Документ содержит архитектурные паттерны, примеры кода и справочник API.
>
> **Версия фреймворка:** `umbot@3.1.x`
> **Репозиторий:** https://github.com/max36895/umbot
> **npm:** https://www.npmjs.com/package/umbot

---

## Оглавление

- [Что такое `umbot`](#что-такое-umbot)
- [Ментальная модель — как это работает](#ментальная-модель--как-это-работает)
- [Установка и создание проекта](#установка-и-создание-проекта)
- [Минимальный рабочий пример](#минимальный-рабочий-пример)
- [Точки входа и импорты](#точки-входа-и-импорты)
- [Два способа написания логики](#два-способа-написания-логики)
- [Конфигурация: `IAppConfig` и `IAppParam`](#конфигурация-iappconfig-и-iappparam)
- [Класс `Bot` — полный API](#класс-bot--полный-api)
- [Класс `BotController` — поля и методы](#класс-botcontroller--поля-и-методы)
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
- [Распространённые ошибки и как их избегать](#распространённые-ошибки-и-как-их-избегать)
- [Рецепты (cookbook)](#рецепты-cookbook)
- [Сценарии, требующие кастомной реализации](#сценарии-требующие-кастомной-реализации)
- [Краткая шпаргалка по API](#краткая-шпаргалка-по-api)

---

## Что такое `umbot`

`umbot` — это TypeScript-фреймворк для разработки **голосовых навыков** (Алиса, Маруся, Сбер SmartApp) и **чат-ботов** (
Telegram, VK, MAX, Viber). Главная идея: **пишете логику один раз — запускаете на любой поддерживаемой платформе**.

Фреймворк **ориентирован на голосовые платформы**: весь голосовой функционал (TTS, звуки, SSML-эффекты, звуки природы,
паузы) поддерживается полностью. Для чат-ботов (Telegram, VK, Viber, Max) поддерживается тот же набор возможностей, что
и для голосовых — карточки, кнопки, аудио-сообщения. Специфичные возможности мессенджеров (опросы, inline-режим,
кастомные клавиатуры), не имеющие аналогов в голосовых платформах, в едином API не представлены — их можно реализовать
через middleware и прямые вызовы API платформы.

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

- Разработчики голосовых навыков (Алиса, Маруся, Сбер SmartApp) — основная аудитория.
- Команды, поддерживающие бота сразу на нескольких платформах (голосовых + чат-ботах).
- Те, кто хочет начать с одной платформы, но заложить архитектуру на будущее.

### Что НЕ делает `umbot`

- Не предоставляет визуальный редактор диалогов.
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
│        a) если oldIntentName зарегистрирован как step → вызвать шаг                                           │
│        b) иначе искать подходящую команду (точное совпадение → regex-группа → линейно)                        │
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

### CLI-команды

| Команда                                                                 | Что делает                                                                                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npx umbot create <name>`                                               | Создать новый проект в папке `<name>`                                                                                   |
| `npx umbot create <name> --minimal`                                     | Минимальная версия (один файл, без отдельного контроллера)                                                              |
| `npx umbot create <name> --prod`                                        | Production-готовый проект (Dockerfile + GitHub Actions)                                                                 |
| `npx umbot create config.json`                                          | Создать проект по JSON-конфигу (см. ниже)                                                                               |
| `npx umbot create from-flow <flow.json> [--output ./path] [--usecloud]` | Создать проект из flow.json (визуальный редактор). Флаг `--usecloud` генерирует конфигурацию для Yandex Cloud Functions |
| `npx umbot validate <flow.json>`                                        | Проверить корректность flow.json перед генерацией                                                                       |
| `npx umbot stats --log <path>`                                          | Агрегировать метрики из лога (число строк/ошибок/предупреждений, топ команд, p50/p95/p99 latency)                       |
| `npx umbot generateenv [--force]`                                       | Сгенерировать `.env` в текущей папке (`--force` — перезаписать существующий)                                            |
| `npx umbot add docker`                                                  | Добавить `Dockerfile` в текущую папку                                                                                   |
| `npx umbot add deploy`                                                  | Добавить `.github/workflows/deploy.yml`                                                                                 |
| `npx umbot add env`                                                     | Добавить файл `.env` (как `generateenv`)                                                                                |
| `npx umbot -v`                                                          | Узнать версию CLI                                                                                                       |

### JSON-конфиг для `npx umbot create`

```ts
interface ProjectConfig {
    name: string; // обязательно
    type?: 'default' | 'quiz'; // default = пустой шаблон, quiz = готовая викторина
    mode?: 'prod' | 'dev' | 'dev-online' | 'build'; // 'prod' = обычный index.ts (эквивалентен отсутствию mode);
    // 'dev' = BotTest без сервера (диалог в консоли), 'dev-online' = сервер в dev-режиме, 'build' = только сборка
    config?: Record<string, unknown>; // мерджится в IAppConfig
    params?: Record<string, unknown>; // мерджится в IAppParam
    path?: string; // путь создания (по умолчанию ./<name>)
    hostname?: string; // по умолчанию '0.0.0.0'
    port?: number; // по умолчанию 3000
    isEnv?: boolean; // сгенерировать .env из токенов: params.*_token (telegram_token, vk_token, alisa_token/yandex_token, ...)
    // + config.db (DB_HOST/DB_USER/DB_PASSWORD/DB_NAME) + config.tokens (токены платформ по имени)
}
```

Пример `config.json`:

```json
{
    "name": "my-alisa-skill",
    "type": "default",
    "mode": "prod",
    "params": {
        "yandex_token": "OAuth-ТОКЕН-НАВЫКА",
        "telegram_token": "123456:ABC-DEF",
        "welcome_text": "Привет! Я умею считать."
    },
    "config": {
        "db": {
            "host": "",
            "user": "",
            "pass": "",
            "database": ""
        }
    },
    "isEnv": true
}
```

Запуск: `npx umbot create config.json`.

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
// Поддерживается голосовыми платформами (Алиса, Маруся, SmartApp); чат-платформы
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

`umbot` предоставляет корневой экспорт, а также отдельные пути импорта для специфичных задач:

```ts
// Главный модуль — основная часть API
import {
    Bot,
    BotController,
    BaseBotController,
    AppContext,
    WELCOME_INTENT_NAME,
    HELP_INTENT_NAME,
    FALLBACK_COMMAND,
    IUserData,
    IPlatformData,
    IUserEvent,
    TStatus,
    IAppConfig,
    IAppParam,
    IAppIntent,
    IAppDB,
    ITokenPlatform,
    ILogger,
    TAppType,
    TAppMode,
    EMetric,
    Buttons,
    Card,
    Sound,
    Nlu,
    Navigation,
    SoundConstants,
    IButton,
    IButtonType,
    IButtonOptions,
    TButton,
    IImageType,
    IImageParams,
    getImage,
    ISound,
    IEffect,
    INlu,
    INluFIO,
    INluGeo,
    INluDateTime,
    INluThisUser,
    INluIntents,
    INluResult,
    Model,
    UsersData,
    ImageTokens,
    SoundTokens,
    IModelRes,
    IQuery,
    IQueryData,
    IModelRules,
    IPlugin,
    IPluginFn,
    createPlugin,
    Text,
    getRegExp,
    isRegex,
    rand,
    keysCount,
    httpBuildQuery,
    isPromise,
    fread,
    fwrite,
    isFile,
    saveData,
    ICommandParam,
    IStepParam,
    TSlots,
    TCommandResolver,
    TBotControllerClass,
    MiddlewareFn,
    MiddlewareNext,
} from 'umbot';

// Платформы и БД-адаптеры
import {
    fullPlatforms,
    voicePlatforms,
    botPlatforms,
    adapters,
    AlisaAdapter,
    TelegramAdapter,
    VkAdapter,
    ViberAdapter,
    MaxAdapter,
    MarusiaAdapter,
    SmartAppAdapter,
    FileAdapter,
    MongoAdapter,
    BaseDbAdapter,
    BasePlatformAdapter,
    TContent,
    IAdapterOptions,
    T_ALISA,
    T_MARUSIA,
    T_SMART_APP,
    T_TELEGRAM,
    T_VK,
    T_VIBER,
    T_MAX_APP,
    AlisaConstants,
    MarusiaConstants,
    SmartAppConstants,
    YandexRequest,
    YandexImageRequest,
    YandexSoundRequest,
    YandexSpeechKit,
    TelegramRequest,
    VkRequest,
    ViberRequest,
    MaxRequest,
    MarusiaRequest,
} from 'umbot/plugins';

// Middleware
import { rateLimiter } from 'umbot/middleware';

// Локальное тестирование
import { BotTest, IBotTestParams } from 'umbot/test';

// Предзагрузка медиа
import { Preload, IOptions as IPreloadOptions } from 'umbot/preload';

// Утилита упрощённого запуска
import { run, IConfig, TMode } from 'umbot/build';
```

### Важные константы

| Константа             | Значение      | Назначение                                |
| --------------------- | ------------- | ----------------------------------------- |
| `WELCOME_INTENT_NAME` | `'welcome'`   | Имя интента приветствия (messageId === 0) |
| `HELP_INTENT_NAME`    | `'help'`      | Имя интента помощи                        |
| `FALLBACK_COMMAND`    | `'*'`         | Имя fallback-команды                      |
| `T_ALISA`             | `'alisa'`     | Идентификатор платформы Алиса             |
| `T_MARUSIA`           | `'marusia'`   | Маруся                                    |
| `T_SMART_APP`         | `'smart_app'` | Сбер SmartApp                             |
| `T_TELEGRAM`          | `'telegram'`  | Telegram                                  |
| `T_VK`                | `'vk'`        | ВКонтакте                                 |
| `T_VIBER`             | `'viber'`     | Viber                                     |
| `T_MAX_APP`           | `'max_app'`   | MAX                                       |

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
        // action() вызывается синхронно — фреймворк не дожидается возвращаемого
        // значения. Не объявляйте метод async: всё, что выполнится после первого
        // await, не попадёт в ответ пользователю. Для асинхронной логики
        // используйте addCommand/addStep.
        action(intentName: string | null, isCommand?: boolean, isStep?: boolean): void {
            // Общая кнопка для всех ответов — пишется один раз
            this.buttons.addBtn('Помощь');

            // Если сработала команда/шаг — они уже заполнили text, выходим
            if (isCommand || isStep) return;

            switch (intentName) {
                case WELCOME_INTENT_NAME:
                    // welcome_text уже выставлен фреймворком —
                    // дополнительно считаем визиты пользователя
                    this.userData.visits = (this.userData.visits || 0) + 1;
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

Конфигурация разделена на два независимых объекта:

### `IAppConfig` — инфраструктура

```ts
interface IAppConfig {
    /** Путь к папке для логов ошибок (error.log, warn.log) */
    error_log?: string;

    /** Путь к папке для JSON-данных (используется FileAdapter и saveFileData) */
    json?: string;

    /** Параметры подключения к БД (для MongoAdapter или кастомного) */
    db?: IAppDB;

    /** Использовать локальное хранилище платформы вместо БД (Алиса/Маруся/SmartApp) */
    isLocalStorage?: boolean;

    /** Сессия userData в памяти процесса для платформ без localStorage (по умолчанию 10 000 польз., 24 ч; false — выкл.) */
    memorySession?: IMemorySessionConfig | false;

    /** Путь к .env файлу ИЛИ строка 'local' для использования process.env */
    env?: string;

    /** Токены платформ (для адаптеров, если не переданы через конструктор) */
    tokens?: ITokenPlatform;
}

interface IAppDB {
    host: string; // например, 'mongodb://localhost:27017'
    user?: string;
    pass?: string; // Обратите внимание: поле называется pass, а не password
    database: string;
    options?: Record<string, unknown>;
}

interface ITokenPlatform {
    [platform: string]: {
        token?: string;
        // speech_kit_token — для TTS на Telegram/VK/Max
        // (передаётся через индексную сигнатуру ниже, явно в интерфейсе не объявлен)
        [key: string]: string | number | undefined;
    };
}
```

> **Важно.** `speech_kit_token` не объявлен явно в `ITokenPlatform` — он передаётся через индексную сигнатуру. На уровне
> TypeScript это работает: `appConfig.tokens.telegram.speech_kit_token` имеет тип `string | number | undefined`.

Пример:

```ts
// src/config/AppConfig.ts
import { IAppConfig } from 'umbot';
import { join } from 'node:path';

export default function (): IAppConfig {
    return {
        json: join(__dirname, '..', 'json'),
        error_log: join(__dirname, '..', 'errors'),
        isLocalStorage: true, // используем session_state Алисы
        env: '.env', // загружаем .env автоматически
    };
}
```

### `IAppParam` — бизнес-логика

```ts
interface IAppParam {
    /** Требуется ли авторизация пользователя (Алиса account linking) */
    isAuthUser?: boolean;

    /** Текст приветствия (string или string[] — случайный выбор) */
    welcome_text?: string | string[];

    /** Текст помощи */
    help_text?: string | string[];

    /** Текст, когда команда не распознана */
    empty_text?: string | string[];

    /** Список интентов (ОБЯЗАТЕЛЬНОЕ поле) */
    intents: IAppIntent[] | null;

    /** UTM-метки для ссылок. null = дефолтные (utm_source=umbot&utm_medium=cpc&utm_campaign=phone) */
    utm_text?: string | null;
}

interface IAppIntent {
    name: string;
    slots: (string | RegExp)[]; // строка → подстрока; RegExp → .test()
    is_pattern?: boolean; // трактовать строки как regex (по умолчанию false)
}
```

Пример:

```ts
// src/config/AppParam.ts
import { IAppParam } from 'umbot';

export default function (): IAppParam {
    return {
        welcome_text: 'Привет! Я умею считать. Скажите "играть".',
        help_text: 'Это игра в математику. Я называю пример — вы ответ.',
        empty_text: 'Не поняла. Скажите "помощь".',
        intents: [
            { name: 'game', slots: ['игра', 'начать игру'] },
            { name: 'bye', slots: ['пока', 'до свидания'] },
            { name: 'replay', slots: ['повтори', 'ещё раз'] },
            // RegExp-слот:
            { name: 'number', slots: [/^\d+$/] },
            // Строка как regex:
            { name: 'phone', slots: ['\\+?\\d{11}'], is_pattern: true },
        ],
    };
}
```

### Приоритет токенов

Жёсткой иерархии нет — итоговое значение зависит от **порядка вызовов**. Механика такая: токен конструктора адаптера
(`new AlisaAdapter('token')`) записывается в конфиг при вызове `bot.use()`, а `setAppConfig({ env })` и каждый
последующий `setPlatformParams` при настроенном `env` **перезаписывают** токены платформ значениями из
`.env`/`process.env`. Поэтому:

1. **Явно настроенный `env`** (файл или `'local'`) — значения из env перезапишут и токен конструктора, и inline-`tokens`
   (не важно, вызван ли `setAppConfig` до или после `bot.use()`).
2. **Аргумент конструктора адаптера** — побеждает, если `env` не настроен вовсе: тогда `setPlatformParams`
   лишь дозаполняет отсутствующие токены из `process.env`, не перезаписывая заданные.
3. **Inline-объект `tokens`** в `setAppConfig` — сливается с уже сохранёнными токенами платформы и на момент вызова
   перезаписывает их.
4. **`process.env` без настроенного `env`** — только дозаполняет отсутствующие токены, ничего не перезаписывая.

> Практический совет: не смешивайте способы для одной платформы. Либо передавайте токен в конструкторе адаптера
> и не настраивайте `env`, либо используйте `.env`/`process.env` и создавайте адаптеры без токена
> (подробнее — в разделе [Конфигурация и безопасность](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_configuration.html)).

### Содержимое `.env`

Фреймворк распознаёт следующие переменные окружения (названия фиксированы):

```bash
# Токены платформ
TELEGRAM_TOKEN=123456:ABC-DEF...
VK_TOKEN=vk1.a.abc123...
VK_CONFIRMATION_TOKEN=abcdef       # обязательно для VK (для подтверждения вебхука)
VK_SECRET_KEY=secret123            # опционально: проверка подписи запросов VK Callback API
VIBER_TOKEN=1234567890-ABCDEF...
ALISA_TOKEN=y0_AgAAAAA...          # OAuth-токен навыка (для аплоада медиа), без префикса "OAuth "
MARUSIA_TOKEN=abc.123...
MAX_TOKEN=abc123...

# Yandex SpeechKit — для TTS на чат-ботах (Telegram/VK/Max).
# Значение автоматически записывается в speech_kit_token всех трёх платформ.
# Рекомендуется API-ключ сервисного аккаунта (уходит как `Api-Key`); IAM-токен `t1.…`
# тоже принимается (уходит как `Bearer`), но живёт не больше 12 часов.
SPEECH_KIT_TOKEN=AQVN...

# Подключение к MongoDB (если используете MongoAdapter)
DB_HOST=mongodb://localhost:27017
DB_USER=root
DB_PASSWORD=secret
DB_NAME=umbot
```

> `ALISA_TOKEN` — каноническое имя для Алисы. Старое имя `YANDEX_TOKEN` сохранено для обратной совместимости: если
> заданы оба — приоритет у `ALISA_TOKEN`. Токены в `.env` — это просто переменные окружения. Фреймворк читает их через
> `process.env` и подставляет в нужные адаптеры автоматически. **Не коммитьте `.env` в git** — добавьте его
> в `.gitignore` (сгенерированный CLI `.gitignore` уже содержит его).
>
> **Секреты вебхука.** Для проверки подписи входящих запросов задайте
> `tokens.telegram.webhookSecret` / `tokens.max_app.webhookSecret` / `tokens.vk.secret_key`. `VK_SECRET_KEY`
> читается из env автоматически (как и остальные токены выше), а `webhookSecret` фреймворк из env не читает —
> передайте его вручную: `webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET`.
> Это обязательный шаг для production — см.
> [configuration.md → Проверка подписи вебхука](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_configuration.html#проверка-подписи-вебхука-обязательно-для-production).

### Доступ к контексту в рантайме

```ts
const ctx = bot.getAppContext();

ctx.appConfig; // заполненный IAppConfig (со всеми дефолтами)
ctx.platformParams; // IAppParam
ctx.platforms; // реестр платформ { alisa: AlisaAdapter, telegram: ... }
ctx.database.adapter; // активный DB-адаптер
ctx.command; // CommandReg (реестр команд)
ctx.httpClient; // функция fetch (можно переопределить)
ctx.log('...'); // лог
ctx.logError('msg', { error: 'details' });
ctx.logWarn('msg', { warning: 'details' });
ctx.logMetric('name', value, { platform: 'telegram' });
```

---

## Класс `Bot` — полный API

```ts
class Bot<
    TUserData extends IUserData = IUserData,
    TPlatformState extends IPlatformData = IPlatformData,
> {
    constructor(type?: TAppType, botController?: TBotControllerClass<TUserData, TPlatformState>);
}
```

Все методы (кроме `getAppContext`, `run`, `webhookHandle`, `webhookEvent`, `start`, `close`, `send`, `setContent`,
`getBotController`) возвращают `this`

### Конфигурация

| Метод                                                              | Назначение                                |
| ------------------------------------------------------------------ | ----------------------------------------- |
| `setAppConfig(config: Partial<IAppConfig>): this`                  | Задать инфраструктурную конфигурацию      |
| `setPlatformParams(params: IAppParam): this`                       | Задать бизнес-параметры                   |
| `setAppMode(mode: 'dev' \| 'prod' \| 'strict_prod'): this`         | Режим работы (см. ниже)                   |
| `setLogger(logger: ILogger \| null): this`                         | Кастомный логгер                          |
| `setPlatformResolver(resolver): this`                              | Переопределить авто-определение платформы |
| `setCommandGroupMode(mode: 'auto' \| 'no-group' \| 'group'): this` | Настройки regex-группировки               |
| `setCustomCommandResolver(resolver): this`                         | Своя логика поиска команды                |
| `getAppContext(): AppContext`                                      | Доступ к контексту                        |

### Регистрация компонентов

| Метод                                              | Назначение                         |
| -------------------------------------------------- | ---------------------------------- |
| `use(plugin: TPlugin): this`                       | Подключить платформу / БД / плагин |
| `use(fn: MiddlewareFn): this`                      | Глобальная middleware              |
| `use(platform: TAppType, fn: MiddlewareFn): this`  | Платформенная middleware           |
| `initBotController(fn: TBotControllerClass): this` | Зарегистрировать контроллер        |

### Команды и шаги

| Метод                                           | Назначение                                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addCommand(name, slots, cb, isPattern?): this` | Зарегистрировать команду                                                                                                                                                                    |
| `removeCommand(name): this`                     | Удалить команду                                                                                                                                                                             |
| `clearCommands(): this`                         | Очистить все команды                                                                                                                                                                        |
| `addStep(name, cb): this`                       | Зарегистрировать шаг                                                                                                                                                                        |
| `removeStep(name): this`                        | Удалить шаг                                                                                                                                                                                 |
| `clearSteps(): this`                            | Очистить все шаги                                                                                                                                                                           |
| `addEvent(eventType, cb): this`                 | Зарегистрировать событийный обработчик (`'photo'`, `'callback'`, ...) — срабатывает первым, до шагов и команд                                                                               |
| `removeEvent(eventType): this`                  | Удалить все обработчики указанного события                                                                                                                                                  |
| `clearEvents(): this`                           | Удалить все событийные обработчики                                                                                                                                                          |
| `addAction(actionName, cb): this`               | Обработчик нажатия кнопки по payload — эквивалент `addCommand(actionName, [actionName], cb)` (нормализация payload на Telegram/VK/MAX)                                                      |
| `addForm(name, options): this`                  | Зарегистрировать многошаговую форму с валидацией полей (подробнее — [api-reference.md](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_api-reference.html#формы-addform)) |
| `removeForm(name): this`                        | Удалить форму и все её шаги                                                                                                                                                                 |
| `clearUse(): this`                              | Удалить все плагины/middleware                                                                                                                                                              |

### Запуск

| Метод                                                                                                                        | Назначение                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `start(hostname='localhost', port=3000, responseCb?): Server`                                                                | Запустить HTTP-сервер                                             |
| `webhookHandle(req, res, responseCb?): Promise<void>`                                                                        | Обработать один HTTP-запрос (для Express/Fastify)                 |
| `webhookEvent(data, headers?, clientIp?): Promise<IWebhookEventResult>`                                                      | Обработать запрос без HTTP-объектов (serverless/облачные функции) |
| `run(appType?, content?, auth?, clientIp?): Promise<TRunResult>`                                                             | Обработать запрос программно (для тестов)                         |
| `setContent(content): void`                                                                                                  | Вручную установить тело запроса (для тестов)                      |
| `send(userId: string \| number, controllerOrText: BotController \| string, platform: TAppType): Promise<unknown \| boolean>` | Проактивная отправка (только TG/VK/Viber/Max)                     |
| `close(): Promise<void>`                                                                                                     | Корректно остановить сервер и освободить ресурсы                  |

### Режимы (`setAppMode`)

| Режим         | Логи        | ReDoS-проверка                                                                                                     | Когда использовать    |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `dev`         | Подробные   | Лог (warn при установленном `re2`, error без него), не блокирует                                                   | Разработка, `BotTest` |
| `prod`        | Минимальные | Лог (warn при `re2`, error без него), но **не блокирует** (режим небезопасен, оставлен для обратной совместимости) | Pre-prod              |
| `strict_prod` | Минимальные | **Блокировка** опасных                                                                                             | **Production**        |

> Маскировка секретов в логах работает во всех режимах и отключается только кастомным логгером
> с `maskSecrets: false`.

**Что делает `strict_prod`:**

- **Отключает опасные RegExp.** При регистрации команды с потенциально уязвимым регулярным выражением (вложенные
  квантификаторы `(a+)+`, `.*` без якорей и т.д.) фреймворк пишет ошибку в лог и **исключает опасный слот** из
  зарегистрированной команды: команда остаётся, но по уязвимому выражению совпадать перестает (исключение не бросается).
  Это защищает от ReDoS-атак. В режимах `dev` и `prod` опасные RegExp регистрируются как есть — с предупреждением,
  если установлен `re2`, и с ошибкой в логах, если нет (без `re2` штатный движок Node уязвим к катастрофическому
  бэктрекингу).
- **Сокращает логи.** Выводятся только ошибки и предупреждения — без трассировки запросов и отладочной информации.

> **Рекомендация:** используйте `strict_prod` для продакшена. `dev` — для разработки и тестирования через `BotTest`.

### Минимальный набор для запуска

```ts
const bot = new Bot();
bot.use(fullPlatforms); // 1. Зарегистрировать платформы
bot.use(new FileAdapter()); // 2. Зарегистрировать БД (или isLocalStorage: true)
bot.setAppConfig({
    // 3. Передать конфиг
    json: './data',
    error_log: './errors',
    isLocalStorage: false,
});
bot.setPlatformParams({
    intents: [{ name: 'bye', slots: ['пока'] }], // Рекомендуется указать
    welcome_text: 'Привет!',
});
bot.setAppMode('strict_prod'); // 5. Режим продакшена
bot.start('0.0.0.0', 3000); // 6. Запустить
```

> Контроллер (`initBotController`) и команды (`addCommand`) — **необязательны** для запуска. Без них бот будет отвечать
> только `welcome_text` / `help_text` / `empty_text`. Это удобно для самого первого старта — убедиться, что вебхук
> работает, а потом постепенно добавлять логику.

### `run()` упрощенного запуска

Если хочется ещё короче — есть утилита `run`:

```ts
import { run } from 'umbot/build'; // TMode = 'dev' | 'dev-online' | 'prod'
import { fullPlatforms, FileAdapter } from 'umbot/plugins';

run(
    {
        appConfig: { isLocalStorage: true },
        appParam: { intents: [{ name: 'bye', slots: ['пока'] }] },
        controller: MyController,
        plugins: [fullPlatforms, new FileAdapter()],
        logic: (bot) => {
            bot.addCommand('ping', ['пинг'], (_, bc) => {
                bc.text = 'понг';
            });
        },
    },
    'prod',
    '0.0.0.0',
    8080,
);
// run(config, mode: TMode = 'prod', hostname = 'localhost', port = 3000)
//     → 'dev' (запускает BotTest.test()), 'dev-online' (сервер в dev-режиме), 'prod' (сервер в strict_prod)
```

---

## Класс `BotController` — поля и методы

Это базовый класс, от которого наследуется ваш контроллер. Фреймворк создаёт новый экземпляр на каждый запрос.

### Поля ответа (что вы заполняете)

| Поле             | Тип                                   | Назначение                                                                                                                                                                                      |
| ---------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`           | `string`                              | Текст, который увидит пользователь (на экране или услышит, если `tts` не задан)                                                                                                                 |
| `tts`            | `string \| null`                      | TTS-текст. Если null → используется `text`. Чат-платформы: при заданном `speech_kit_token` озвучивается через SpeechKit; при пустом `text` tts (без звуковой разметки) уходит как текст         |
| `isEnd`          | `boolean`                             | Завершить диалог (true = сессия закрывается). Читают только голосовые платформы (Алиса, Маруся, SmartApp); чат-платформы флаг игнорируют                                                        |
| `skipAutoReply`  | `boolean`                             | Не отправлять ответ автоматически (вы уже отправили вручную через API)                                                                                                                          |
| `isAuth`         | `boolean`                             | Запросить авторизацию (только Алиса)                                                                                                                                                            |
| `isSendRating`   | `boolean`                             | Запросить оценку навыка. Флаг обрабатывается ядром на всех платформах, но специальный ответ оценки (`CALL_RATING`) уходит только на SmartApp; остальные платформы просто отправят обычный ответ |
| `emotion`        | `string \| null`                      | Эмоция (только SmartApp: `'radost'`, `'pechal'`, ...)                                                                                                                                           |
| `appeal`         | `'official' \| 'no_official' \| null` | Стиль обращения (только SmartApp)                                                                                                                                                               |
| `thisIntentName` | `string \| null`                      | Имя следующего шага (для многошаговых диалогов). null = выйти из сценария                                                                                                                       |

### Поля запроса (что фреймворк заполняет)

| Поле                  | Тип                                                      | Назначение                                                                                                                                                      |
| --------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userCommand`         | `string \| null`                                         | Текст пользователя в нижнем регистре                                                                                                                            |
| `originalUserCommand` | `string \| null`                                         | Оригинальный текст (с заглавными, пунктуацией)                                                                                                                  |
| `userId`              | `string \| number \| null`                               | ID пользователя на платформе                                                                                                                                    |
| `userToken`           | `string \| null`                                         | OAuth-токен (для авторизованных запросов Алисы)                                                                                                                 |
| `userMeta`            | `unknown \| null`                                        | Метаданные (timezone, locale, ...)                                                                                                                              |
| `messageId`           | `number \| string \| null`                               | Номер сообщения. 0 = начало новой сессии (только голосовые: Алиса/Маруся/SmartApp). Telegram/VK/MAX присылают свои счётчики, welcome-правило на них не работает |
| `payload`             | `Record<string, unknown> \| string \| null \| undefined` | Payload от кнопки (если нажали кнопку с payload)                                                                                                                |
| `requestObject`       | `unknown`                                                | Полный оригинальный объект запроса от платформы                                                                                                                 |
| `isScreen`            | `boolean`                                                | Есть ли экран у устройства                                                                                                                                      |
| `appType`             | `TAppType \| null`                                       | Идентификатор текущей платформы                                                                                                                                 |
| `oldIntentName`       | `string \| null`                                         | Имя предыдущего шага (из `userData.oldIntentName`)                                                                                                              |
| `appContext`          | `AppContext`                                             | Контекст приложения (конфиг, реестры, логгер)                                                                                                                   |

### Состояние

| Поле         | Тип                      | Назначение                                                                                     |
| ------------ | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `userData`   | `TUserData`              | Персистентное состояние пользователя (БД или локальное хранилище). Сохраняется между запросами |
| `state`      | `TPlatformState \| null` | Локальное хранилище платформы (только при `isLocalStorage: true`)                              |
| `userEvents` | `IUserEvent \| null`     | События: `auth.status` (true/false/null), `rating.status`, `rating.value`                      |

### UI-компоненты (lazy-init через геттеры)

| Геттер    | Тип       | Назначение                                 |
| --------- | --------- | ------------------------------------------ |
| `buttons` | `Buttons` | Кнопки (цепочный API: `addBtn`, `addLink`) |
| `card`    | `Card`    | Карточки (изображения, галереи)            |
| `sound`   | `Sound`   | Звуки и TTS-эффекты                        |
| `nlu`     | `Nlu`     | NLU-сущности (FIO, GEO, DateTime, Number)  |

Методы проверки инициализации: `isButtonsInit()`, `isCardInit()`, `isSoundInit()`, `isNluInit()`.

### Главный метод — `action`

```ts
public abstract action(
    intentName: string | null,
    isCommand?: boolean,
    isStep?: boolean,
): void;
```

- **`intentName`** — имя сработавшего интента/команды/шага. Может быть null (если ничего не подошло и нет fallback).
- **`isCommand`** — true, если запрос обработан командой (`addCommand`).
- **`isStep`** — true, если запрос обработан шагом (`addStep`).

`action()` вызывается **всегда последним**. Если сработала команда — `action` всё равно вызовется с `isCommand=true`.
Это удобно для общей пост-обработки (аналитика, общие кнопки).

### Жизненный цикл контроллера

Фреймворк автоматически:

1. Создаёт экземпляр (`new MyController(appContext)`) на каждый запрос.
2. Заполняет поля запроса (`userCommand`, `userId`, ...).
3. Загружает `userData` / `state`.
4. Вызывает `run()` — внутренний диспетчер.
5. `run()` определяет, что сработало (шаг → команда → интент → fallback → built-in), и в конце вызывает `action()`.
6. Вызывает `platformAdapter.getContent(controller)` — формирует ответ (внутри этого метода сохраняется `state`
   через `setLocalStorage`; `userData` сохраняется фреймворком позже — в `#runApp` после формирования ответа).
7. Сбрасывает transient-поля (text, tts, buttons, card, nlu) — userData сохраняется.

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

| Тип слота                                  | Поведение                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `string`, `isPattern=false` (по умолчанию) | `userCommand.includes(slot)` — подстрока, O(n) по длине запроса. При этом каждый строковой слот дополнительно попадает в индекс точных совпадений: если реплика совпала со слотом целиком, команда находится за O(1) без линейного перебора. **Слот должен быть в нижнем регистре**, т.к. `userCommand` уже приведён к нижнему. |
| `string`, `isPattern=true`                 | Компилируется как regex, проверяется через `.test()`.                                                                                                                                                                                                                                                                           |
| `RegExp`                                   | `.test(userCommand)`. `isPattern` игнорируется.                                                                                                                                                                                                                                                                                 |

> **Важно про регистр:** `controller.userCommand` — это текст пользователя, приведённый к нижнему регистру. Слоты-строки
> тоже должны быть в нижнем регистре: `'привет'`, а не `'Привет'`. Для RegExp используйте флаг `i`, если хотите
> case-insensitive.

> **Асинхронность:** callback может быть синхронным (`void | string`) или асинхронным (`Promise<void | string>`) —
> фреймворк автоматически дожидается результата через `await`. Это позволяет делать HTTP-запросы, читать из БД и т.д.
> прямо внутри обработчика команды:
>
> ```ts
> bot.addCommand('weather', ['погода'], async (userCommand, bc) => {
>     const city = userCommand.replace('погода', '').trim() || 'москва';
>     // Обязательно ставьте таймаут — внешний API может зависнуть и съесть
>     // весь лимит времени ответа платформы (подробнее — Рецепт 7)
>     const res = await fetch(`https://api.weather.example.com/current?city=${city}`, {
>         signal: AbortSignal.timeout(3000),
>     });
>     const data = (await res.json()) as { temp: number };
>     bc.text = `Сейчас ${data.temp}°C`;
> });
> ```

Если callback возвращает строку — она становится `controller.text`. Это работает для команд (`addCommand`) и событий
(`addEvent`); для шагов (`addStep`) возврат строки не поддерживается — тип колбэка шага: `void | Promise<void> | false`.

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

- Ни шаг, ни команда, ни интент не подошли. Fallback проверяется _до_ интентов: если он зарегистрирован, интенты из
  `platformParams.intents` уже не ищутся.
- Независимо от `messageId`: если fallback зарегистрирован, он сработает даже на первом сообщении — welcome-подстановка
  для `messageId === 0` происходит в стадии интентов, до которой при сработавшем fallback дело не доходит
  (см. [«Порядок диспетчера»](#порядок-диспетчера)).

### Шаги — многошаговые диалоги

Шаг — это механизм для построения многошаговых сценариев: регистрации, опросников, заказа товара, игры с серией
вопросов. Каждый шаг — это отдельная функция-обработчик, которая вызывается в нужный момент.

```ts
bot.addStep(
    stepName: string,
    cb: (controller: TBotController) => void | Promise<void> | false,
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
    bc.userData.name = bc.originalUserCommand; // сохраняем с правильным регистром
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

0. **Событие** — обработчики `bot.addEvent` по `controller.eventType` (вызываются первыми, до шагов и команд;
   обработчик может вернуть `false` — тогда событие «не его» и конвейер продолжается).
1. **Шаг** — если `oldIntentName` зарегистрирован как шаг.
2. **Команда** — поиск до первой подошедшей. Порядок зависит от типа слота:
    - сначала проверяются **точные совпадения строк** (O(1) по хэш-индексу);
    - затем **RegExp-группы** (если есть `isPattern: true`);
    - затем **линейный поиск** по порядку вызова `addCommand` (строки как подстрока — O(n) по длине запроса, RegExp через `.test()`).
3. **FALLBACK_COMMAND** — если зарегистрирован (проверяется _до_ интентов: fallback перехватывает запрос, и
   интенты из `platformParams.intents` уже не ищутся).
4. **Интент** — из `platformParams.intents`; сюда же относится **welcome**: если интент не найден и
   `messageId === 0`, подставляется `'welcome'` → фреймворк устанавливает `controller.text = platformParams.welcome_text`.
5. **Built-in интенты**:
    - `'help'` → фреймворк устанавливает `controller.text = platformParams.help_text`
    - иначе → `controller.text = platformParams.empty_text` (только если наследуетесь от `BaseBotController`)
6. **`action(intentName, isCommand, isStep)`** — вызывается всегда в конце.

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
| ❌ Нет                | `true`           | **из локального хранилища платформы** (Алиса/Маруся/SmartApp)                                       |
| ❌ Нет                | `true`           | Telegram/VK/MAX/Viber: **из сессии в памяти процесса** — см. [ниже](#сессия-в-памяти-процесса)      |
| ❌ Нет                | `false`          | `userData` остаётся пустым — режим без персистентности: валиден, но данные между запросами не живут |

Это логично: БД — это полноценное персистентное хранилище, которое всегда работает. Локальное хранилище — это
облегченный вариант для простых навыков только на голосовых платформах, без БД. Если вы подключили БД — она и
используется.

### Что такое `state` и его связь с `userData`

`state` — это **локальное хранилище платформы** (например, `session_state` у Алисы). Это хранилище, которое платформа
сама прокидывает между запросами в теле запроса/ответа — без БД, без серверов.

`state` заполняется только когда `isLocalStorage: true` **И** платформа его поддерживает (Алиса, Маруся, SmartApp). На
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

- `userData` и `state` — один и тот же объект из `session_state` Алисы.
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
- Один и тот же пользователь имеет одни и те же данные на всех платформах (если `userId` совпадает).
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

- Бот работает на нескольких платформах (Telegram, VK, ...) — там нет локального хранилища, userData без БД не
  сохранится.
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
SmartApp — 8; MAX — 30**. У MAX платформа допускает до 30 рядов × 7 кнопок в ряду, но текущая реализация адаптера
кладёт каждую кнопку отдельным рядом `[button]` — поэтому фактический предел одного сообщения — 30 кнопок.

> **UX-рекомендация:** не перегружайте интерфейс кнопками. Для голосовых платформ и большинства чат-ботов оптимально
> _3–5 кнопок_ на одном экране. Пользователь (особенно голосовой) не сможет быстро произнести 10 вариантов, а на экране
> более 5 кнопок начинают сливаться.

Платформо-специфичные опции (через `options`):

| Платформа | Опции в `options`                                                                                                                                                                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VK        | `_group` (число) — группировка в строки; `color: 'primary' \| 'secondary' \| 'positive' \| 'negative'`                                                                                                                                                                                                                                  |
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

#### Снятие клавиатуры — `buttons.remove()`

На Telegram (reply-клавиатура) и VK клавиатура «прилипает» к диалогу и живёт до явной замены — пустой список кнопок
платформе не отправляется, поэтому снять её пустым `buttons.clear()` нельзя. Для этого есть явный вызов:

```ts
this.buttons.remove(); // попросить платформу убрать ранее показанную клавиатуру
```

У Viber, MAX, Алисы, Маруси и SmartApp клавиатура привязана к сообщению и исчезает сама — вызов там безопасен и ничего
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

> ⚠️ SmartApp не поддерживает ни стандартные, ни кастомные звуки, ни TTS-эффекты — поля `tts`/`sound` на этой платформе
> игнорируются.

> **Важно.** На Telegram/VK/MAX для TTS нужен токен Yandex SpeechKit. Укажите его в
> `appConfig.tokens[platform].speech_kit_token` или в переменной окружения `SPEECH_KIT_TOKEN`.
>
> **Про SSML.** Готовые константы эффектов (`S_EFFECT_*`, раздел выше) фреймворк подставляет
> только для Алисы. Сырые SSML-теги `<speaker ...>`, прописанные в `tts` вручную, у Маруси
> передаются в TTS как есть, а у SmartApp отправляются с типом `application/ssml` — но
> поддержка конкретных тегов и эффектов зависит от TTS самой платформы.

### NLU — извлечение сущностей

```ts
// Text используется ниже для склонения окончаний
import { Text } from 'umbot';

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
import { Navigation } from 'umbot';

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
обращении и сбрасывается между запросами, на голосовых платформах (Алиса, Маруся, SmartApp) равен `null`.
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
  [platform-integration.md](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_platform-integration.html), раздел «API платформы».
- Полная матрица и сигнатуры — в [api-reference.md](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_api-reference.html), раздел «API платформы», и в
  [platform-integration.md](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_platform-integration.html).

---

## Платформы — регистрация и общие принципы

### Регистрация платформ

Из коробки поддерживается 7 платформ: Алиса, Маруся, SmartApp (Сбер), Telegram, VK, Viber, Max. Подключить можно любым
из способов ниже.

```ts
// Вариант 1: все платформы сразу — самый частый выбор
bot.use(fullPlatforms);

// Вариант 2: только голосовые (Алиса, Маруся, SmartApp)
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
> в [официальной документации](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_adapter_platformAdapter.html).

### Авто-определение платформы

`Bot` сам определяет, от какой платформы пришёл запрос — по телу запроса и заголовкам. Вам ничего настраивать не нужно:
один webhook-эндпоинт принимает запросы от всех платформ.

Если авто-определение не справляется (редкий случай, обычно при проксировании через свой шлюз), его можно
переопределить:

```ts
bot.setPlatformResolver((query, headers, detect) => {
    // detect() запускает стандартное авто-определение
    if (headers?.['x-my-routing'] === 'alice') return 'alisa';
    return detect(query, headers);
});
```

### Главное про лимиты платформ

У каждой платформы есть свои лимиты: на длину текста, количество кнопок, размер карточки, длительность звука и т.д.
_Вам не нужно их запоминать._

Адаптеры платформ знают о лимитах и **автоматически приводят данные к корректному виду**:

- Если вы добавили 15 кнопок, а платформа поддерживает только 10 — в платформу уйдут первые 10, остальные будут
  отброшены. Большинство адаптеров обрезает кнопки молча; warning в логах пишет только адаптер Max.
- Если текст длиннее лимита — он будет обрезан до допустимой длины.
- Если payload кнопки превышает лимит байтов — кнопка будет пропущена с warning; данные разработчика не обрезаются и не
  переписываются.
- Если устройство без экрана (колонка Алисы) — кнопки и карточки просто не отправляются.

То есть ваш код остаётся кроссплатформенным: вы пишете `this.buttons.addBtn(...)` 15 раз — на Алисе уйдёт 10, на
Telegram — 15 (адаптер обрезает клавиатуру начиная с 40 кнопок), на Viber — только первые 6 кнопок. Без
`if (this.appType === 'alisa')` в коде.

> Единственное исключение — **время ответа для голосовых платформ**. Фреймворк сам следит за временем обработки:
> при ответе за 2000 мс и более пишется предупреждение, за 2900 мс и более — ошибка. Лимиты конкретных платформ
> проверяйте в их актуальной документации. Фреймворк не может «обрезать» вашу бизнес-логику, поэтому следите, чтобы
> `action()` отрабатывал быстро. Используйте `Preload` для медиа и не делайте долгих синхронных операций.

### Особенности платформ из коробки

Здесь собраны **только те особенности, которые влияют на написание кода** — то, что нужно знать разработчику. Подробные
лимиты (1024 символа, 10 кнопок и т.д.) адаптеры берут на себя.

#### Алиса (Яндекс)

- **OAuth-токен** нужен для загрузки изображений и звуков. Без него карточки с изображениями и звуки работать не будут —
  только текст и TTS.
- **skillId** извлекается автоматически из запроса — вручную указывать не нужно.
- **Health check (ping/pong)** — Яндекс периодически проверяет доступность навыка запросом `ping`. Фреймворк
  автоматически отвечает `pong`, вам делать ничего не нужно.
- **Account linking** — если нужно авторизовать пользователя через ваш backend, поставьте `controller.isAuth = true`.
  Подробный flow описан в разделе [Рецепт 8](#рецепт-8-авторизация-алисы-полный-flow).
- **`isScreen`** — на устройстве без экрана (колонка) кнопки и карточки не видны. Проверяйте `this.isScreen` перед
  `this.card.addImage(...)`.

#### Telegram

- **Токен** — от @BotFather.
- **Состояния нет** — Telegram не поддерживает локальное хранилище. При `isLocalStorage: true` без DB-адаптера
  `userData` хранится в [памяти процесса](#сессия-в-памяти-процесса): теряется при перезапуске и не разделяется между
  процессами. Для надёжного хранения подключите БД.
- **Проактивная отправка** — `bot.send(userId, text, T_TELEGRAM)` работает (в отличие от голосовых платформ).
- **TTS через SpeechKit** — для озвучки текста нужен `appConfig.tokens.telegram.speech_kit_token`. Без него
  `controller.tts` игнорируется.
- **Callback-кнопки** — при нажатии inline-кнопки с payload, payload приходит в `controller.payload`. Фреймворк
  сам парсит JSON: если в кнопке был объект — придёт объект (строка-JSON автоматически преобразуется). См.
  [Рецепт 9](#рецепт-9-кнопка-с-payload--кроссплатформенный-паттерн).
- **Разметка выключена по умолчанию** — `parse_mode` передаётся только при явном `telegram_parse_mode`. При HTML или
  MarkdownV2 разработчик отвечает за валидность и экранирование динамических данных. Для MarkdownV2 используйте
  `T_FORMAT_MARKDOWN` и `escapeMarkdownV2()` (оба экспорта — из `'umbot/plugins'`).
- **Webhook-reply (opt-in)** — `new TelegramAdapter(token, { telegram_webhook_reply: true })`: простой текстовый
  ответ уходит телом webhook-ответа (`{method: 'sendMessage', ...}`) — Telegram выполнит метод сам, без исходящего
  POST от вашего сервера. По умолчанию выключено; не применяется к callback/inline-запросам и ответам с карточками
  или звуками (они уходят штатным путём). Учтите: ошибки метода при этом недиагностируемы — Telegram подтверждает
  webhook раньше реального выполнения метода.

#### VK

- **Два токена**: бот-токен + `vk_confirmation_token` (для подтверждения вебхука при первичной настройке).
- **Группировка кнопок в строки** — через `options._group` (число). Кнопки с одинаковым `_group` окажутся в одной
  строке.
- **Цвет кнопок** — через `options.color: 'primary' | 'secondary' | 'positive' | 'negative'`.

#### Viber

- **Sender name обязателен** — должен совпадать с именем бота в Viber.
- **Звуки не поддерживаются** — кастомные звуки не отправляются; `controller.tts` при пустом `text` уходит
  как обычный текст (без звуковой разметки), при заполненном `text` — не используется.

#### SmartApp (Сбер SmartApp)

- **Без токена** — аутентификация через Sber-экосистему.
- **Эмоции** — `controller.emotion = 'radost'` (22 варианта: `pechal`, `laugh`, `ok_prinyato`, ...).
- **Обращение** — `controller.appeal = 'official' | 'no_official'` (Сбер сам присылает в запросе, на который нужно
  адаптировать тон).
- **Rating flow** — `controller.isSendRating = true` запускает оценку навыка. Результат придёт позже в
  `controller.userEvents.rating`.

#### MAX

- Токен от MAX Platform API.
- TTS через Yandex SpeechKit (`appConfig.tokens.max_app.speech_kit_token`).

### Сводная таблица — что поддерживает каждая платформа

| Свойство                                 | Алиса | Маруся | SmartApp         | Telegram | VK  | Viber    | Max |
| ---------------------------------------- | ----- | ------ | ---------------- | -------- | --- | -------- | --- |
| Голосовая (TTS native)                   | ✅    | ✅     | ✅               | ❌       | ❌  | ❌       | ❌  |
| Локальное хранилище                      | ✅    | ✅     | ✅ (внешнее API) | ❌       | ❌  | ❌       | ❌  |
| Проактивная отправка (`bot.send`)        | ❌    | ❌     | ❌               | ✅       | ✅  | ✅       | ✅  |
| Загрузка изображений                     | ✅    | ✅     | ❌ (URL)         | ✅       | ✅  | ❌ (URL) | ✅  |
| Загрузка файлов звуков                   | ✅    | ✅     | ❌               | ✅       | ✅  | ❌       | ✅  |
| Стандартные звуки (S_AUDIO_*)            | ✅    | ✅     | ❌               | ❌       | ❌  | ❌       | ❌  |
| Эффекты `S_EFFECT_*`                     | ✅    | ❌     | ❌               | ❌       | ❌  | ❌       | ❌  |
| TTS через SpeechKit (`speech_kit_token`) | ❌    | ❌     | ❌               | ✅       | ✅  | ❌       | ✅  |
| Проверка подписи webhook                 | ❌    | ❌     | ❌               | ✅*      | ✅* | ✅       | ✅* |
| Эмоции / appeal                          | ❌    | ❌     | ✅               | ❌       | ❌  | ❌       | ❌  |

> Где `❌` — фича не поддерживается платформой, фреймворк просто молча проигнорирует соответствующие поля в `controller`.
> Код не сломается.

> ⚠️ **Про «Проверка подписи webhook»:**
>
> - Алиса, Маруся, SmartApp — подписи запросов **нет вообще**: всё содержимое payload (включая `user_id`) контролирует
>   отправитель. Не интерполируйте эти данные в URL или query без экранирования и не считайте такой запрос
>   аутентифицированным.
> - Viber — подпись проверяется автоматически всегда (`x-viber-content-signature`).
> - Telegram — проверка включается заданием секрета (`tokens.telegram.webhookSecret` → заголовок
>   `x-telegram-bot-api-secret-token`); без секрета проверка отключена.
> - VK — проверка включается только если задан `tokens.vk.secret_key` (сверяется с `secret_key` в теле запроса);
>   без секрета — пропускается.
> - MAX — проверка включается заданием `tokens.max_app.webhookSecret` (заголовок `x-max-bot-api-secret`).

> ℹ️ **Про звуки:**
>
> - **Голосовые платформы** (Алиса, Маруся) подставляют звуки как `<speaker audio="...">` в TTS.
> - **Алиса и Маруся** умеют загружать ваши аудиофайлы (хелперы `getSoundInDB` из `Alisa/Sound` и `Marusia/Sound`
>   — внутри используют `YandexSoundRequest` / `MarusiaRequest`);
>   у Маруси стандартные звуки подставляются из фиксированного набора `marusia-sounds/*`.
> - **Чат-платформы** (Telegram, VK, MAX) загружают аудиофайл и отправляют его как голосовое/аудио сообщение;
>   текстовая часть TTS при заданном `speech_kit_token` синтезируется через Yandex SpeechKit.
> - **Viber и SmartApp** маркеры звуков из TTS вычищают (в Viber `soundProcessing` возвращает `null`).

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
в [официальной документации](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_adapter_dbAdapter.html) и
в `examples/skills/userDbConnect/` репозитория.

### Что фреймворк хранит в БД автоматически

- `userData` (через модель `UsersData`) — основное пользовательское состояние.
- `ImageTokens` / `SoundTokens` — кэш токенов загруженных медиа. **Этим кэшем вы не управляете вручную** — фреймворк сам
  загружает изображения/звуки на платформу при первом использовании и переиспользует токены потом.

Прямой доступ к `ImageTokens` / `SoundTokens` нужен только для инспекции или инвалидации кэша (чтобы принудительно
перезагрузить медиа). В 99% случаев вам это не понадобится.

### Когда нужна своя модель

Если помимо `userData` нужна отдельная таблица (например, таблица лидеров, каталог товаров, логи) — создайте свою модель
через `Model<TState>`. Это редко нужно для простых навыков — обычно хватает `userData`.

Пример: таблица рекордов

```ts
import { Model, IModelState, IModelRules, AppContext } from 'umbot';

interface IScoreState extends IModelState {
    userId: string | null;
    score: number | null;
}

const RULES: IModelRules[] = [
    { name: ['userId'], type: 'string', max: 250 },
    { name: ['score'], type: 'integer' },
];

const LABELS: IScoreState = {
    userId: 'ID', // 'ID' маркирует primary key
    score: 'Score',
};

export class ScoreModel extends Model<IScoreState> {
    public static readonly TABLE_NAME = 'Scores';

    constructor(appContext: AppContext) {
        super(appContext);
        this.state = { userId: null, score: null };
    }

    rules() {
        return RULES;
    }

    attributeLabels() {
        return LABELS;
    }

    tableName() {
        return ScoreModel.TABLE_NAME;
    }
}
```

Использование в контроллере:

```ts
const score = new ScoreModel(this.appContext);
score.state.userId = this.userId as string;

if (await score.whereOne({ userId: this.userId })) {
    score.state.score = (score.state.score as number) + 1;
    await score.update();
} else {
    score.state.score = 1;
    await score.add();
}
```

---

## Middleware и `rateLimiter`

Middleware — это функции, перехватывающие запрос до/после `action()`. Полезны для аутентификации, логирования,
A/B-тестов, rate-limiting.

### Сигнатура

```ts
type MiddlewareFn = (ctx: BotController, next: MiddlewareNext) => void | Promise<void>;
type MiddlewareNext = () => Promise<void>;
```

- `ctx` — текущий `BotController` (уже наполненный запросом).
- `next()` — продолжить цепочку. **Не вызвали → короткое замыкание, `action()` не запустится.**

> **Асинхронность:** `MiddlewareFn` поддерживает `async/await`. Можно использовать `await` до вызова `next()` (например,
> для аутентификации через БД) и после (для пост-обработки ответа). Фреймворк автоматически дожидается Promise.
>
> **Обработка ошибок:** если middleware выбрасывает исключение, фреймворк перехватывает его, логирует ошибку и прерывает
> обработку — `action()` не вызывается. Оборачивайте потенциально опасные операции (HTTP-запросы, обращения к БД) в
> `try/catch`, если хотите вернуть пользователю осмысленный ответ.

### Регистрация

```ts
// Глобальная (для всех платформ)
bot.use(async (ctx, next) => {
    console.log(`[${ctx.appType}] ${ctx.userId}: ${ctx.userCommand}`);
    await next();
    console.log('Ответ:', ctx.text);
});

// Платформенная (только для Алисы)
bot.use(T_ALISA, async (ctx, next) => {
    if (!ctx.userData.authorized) {
        ctx.text = 'Пожалуйста, авторизуйтесь';
        return; // НЕ вызываем next() — обрываем цепочку
    }
    await next();
});
```

### Порядок выполнения

```
запрос → глобальные MW (FIFO, включая пост-обработку после next()) → платформенные MW (FIFO) → action()
```

Глобальные middleware отрабатывают полностью — и до, и после `next()`. Только после того как вся глобальная цепочка (включая unwind-часть) завершилась, запускается цепочка платформенных middleware от своего начала.

Пример: если зарегистрированы:

```ts
bot.use(async (_, next) => {
    console.log(1);
    await next();
    console.log(4);
});
bot.use(T_ALISA, async (_, next) => {
    console.log(2);
    await next();
    console.log(3);
});
```

То при запросе от Алисы порядок будет: `1, 4, 2, 3` — глобальная MW выводит `1`, доходит до конца своей цепочки и выводит `4`, и только затем запускается платформенная цепочка (`2, 3`).

### Полезные паттерны

#### Аутентификация

```ts
bot.use(T_TELEGRAM, async (ctx, next) => {
    const userData = new UsersData(ctx.appContext);
    userData.userId = ctx.userId;
    userData.platform = T_TELEGRAM;
    const known = await userData.getOne();
    if (!known) {
        ctx.text = 'Вы не зарегистрированы. Отправьте /start.';
        return;
    }
    await next();
});
```

#### Логирование времени

```ts
import { performance } from 'node:perf_hooks';

bot.use(async (ctx, next) => {
    const t0 = performance.now();
    await next();
    const ms = performance.now() - t0;
    if (ms > 1000) {
        ctx.appContext.logWarn(`Slow request: ${ms.toFixed(0)}ms`, {
            intent: ctx.oldIntentName,
            platform: ctx.appType,
        });
    }
});
```

#### Мутация контроллера до action

```ts
bot.use(async (ctx, next) => {
    // Добавить общую кнопку "Помощь" ко всем ответам
    await next();
    if (!ctx.isButtonsInit() || ctx.buttons.buttons.length === 0) {
        ctx.buttons.addBtn('Помощь');
    }
});
```

### Встроенный `rateLimiter`

```ts
import { rateLimiter } from 'umbot/middleware';

bot.use(rateLimiter()); // дефолт: queue=100, idle=60s
// или
bot.use(rateLimiter(200, 120_000)); // queue=200, idle=2 мин
```

**Что делает:**

- Читает `appContext.platforms[platform].limit` (TG/VK/Viber/MAX = 30 для входящих запросов; исходящая очередь MAX отдельно соблюдает 2 сообщения/с на диалог).
- Поддерживает фиксированное 1-секундное окно per `{platform, userId}`: счётчик запросов сбрасывается каждую секунду.
- При превышении — ставит в очередь (до `maxQueueSize`).
- Переполнение очереди → бросает исключение.
- Все таймеры `.unref()` — не блокируют выход процесса.

Ограничивает **входящие** запросы (не исходящие API-вызовы).

### Другие встроенные middleware

Кроме `rateLimiter`, фреймворк поставляет ещё четыре готовых middleware (все — из `'umbot/middleware'`):

| Middleware                     | Назначение                                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `authGuard(check, options?)`   | Пропускать запрос дальше, только если `check(ctx)` вернул `true`; иначе пользователь получает `deniedText` (по умолчанию `'Доступ запрещён.'`) |
| `requestId()`                  | Уникальный `requestId` в `platformOptions.requestId` для сквозного трейсинга логов                                                             |
| `maintenance(check, options?)` | Пока `check()` возвращает `true`, отвечать текстом `message` (по умолчанию `'Сервис временно недоступен. Попробуйте позже.'`)                  |
| `ipFilter(options)`            | Фильтрация входящих webhook-запросов по IP клиента: `whitelist`/`blacklist` (IP и CIDR, IPv4/IPv6), текст отказа — `deniedText`                |

```ts
import { authGuard, requestId } from 'umbot/middleware';

// Только администраторы
bot.use(
    authGuard((ctx) => ADMIN_IDS.includes(String(ctx.userId)), {
        deniedText: 'Команда доступна только администраторам',
    }),
);

// Сквозной ID запроса в логах
bot.use(requestId());
```

`check` у `authGuard`/`maintenance` может быть синхронным или асинхронным; исключения внутри `check`
у `authGuard` трактуются как отказ, у `maintenance` — логируются, и запрос пропускается дальше.
`ipFilter` берёт IP из `platformOptions.clientIp` (заполняется в `webhookHandle` из сокета
HTTP-запроса); при вызове `bot.run()` напрямую IP нет — запрос пропускается (fail-open).
Подробности и примеры — в [middleware.md](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_middleware.html).

### Своё middleware как фабрика

```ts
export function authMiddleware(secret: string) {
    return async (ctx: BotController, next: MiddlewareNext) => {
        if (ctx.userCommand === '/login ' + secret) {
            ctx.userData.authed = true;
        }
        if (!ctx.userData.authed) {
            ctx.text = 'Требуется логин';
            return;
        }
        await next();
    };
}

// Использование:
bot.use(authMiddleware(process.env.SECRET!));
```

---

## Preload — предзагрузка медиа

Загрузка изображений и звуков на платформу занимает 200–1000 мс. Для первого пользователя это означает долгий ответ и
риск упереться в практический лимит голосовых платформ (~3 с; предупреждение фреймворка — после 2 с).

`Preload` загружает все медиа при старте приложения, чтобы первый ответ был таким же быстрым, как и все последующие.

**Как это работает:**

1. При вызове `loadImages()` фреймворк проверяет, есть ли уже токен для этого файла в БД (`ImageTokens` модель).
2. Если токен есть — используется кэшированное значение (загрузка не происходит).
3. Если токена нет — файл загружается на сервер платформы, полученный токен сохраняется в БД.
4. При следующем обращении к тому же файлу токен берётся из БД — без задержки на upload.

```ts
import { Preload } from 'umbot/preload';
import { T_ALISA, T_VK, T_TELEGRAM } from 'umbot/plugins';

const preload = new Preload(bot.getAppContext());

// API ресурсов Алисы адресуется по навыку: skill_id из консоли Яндекс.Диалогов.
// Без alisaSkillId Алиса пропускается с предупреждением.
const alisa = { alisaSkillId: 'ваш-skill-id' };

// Возвращает массив промисов — нужно дождаться всех
const imagePromises = preload.loadImages(
    ['./media/img1.jpg', './media/img2.png'],
    [T_ALISA, T_VK], // только для этих платформ
    alisa,
);

const soundPromises = preload.loadSounds(['./media/beep.mp3', './media/win.mp3'], [T_ALISA], alisa);

// Для Telegram звуки тоже требуют получателя (opts — третий аргумент, как у loadImages)
const tgSoundPromises = preload.loadSounds(['./media/beep.mp3'], [T_TELEGRAM], {
    telegramUseId: 123456789,
});

// Telegram требует реального получателя для получения file_id —
// и для фото, и для звуков (аудио отправляется пользователю)
const tgPromises = preload.loadImages(
    ['./media/img1.jpg'],
    [T_TELEGRAM],
    { telegramUseId: 123456789 }, // ID пользователя, которому придут фото
);

await Promise.all([...imagePromises, ...soundPromises, ...tgSoundPromises, ...tgPromises]);

bot.start('0.0.0.0', 3000);
```

### API Preload

| Метод          | Параметры                                                                                | Возвращаемое значение       | Описание                           |
| -------------- | ---------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------- |
| `loadImages`   | `images: string[]`, `platforms?: TAppType[]`, `opts?: { telegramUseId?, alisaSkillId? }` | `Promise<string \| null>[]` | Загрузить изображения на платформы |
| `loadSounds`   | `sounds: string[]`, `platforms?: TAppType[]`, `opts?: { telegramUseId?, alisaSkillId? }` | `Promise<string \| null>[]` | Загрузить звуки на платформы       |
| `removeImages` | `images: string[]`, `platforms?: TAppType[]`, `opts?: { alisaSkillId? }`                 | `Promise<boolean>[]`        | Удалить изображения с платформ     |
| `removeSounds` | `sounds: string[]`, `platforms?: TAppType[]`, `opts?: { alisaSkillId? }`                 | `Promise<boolean>[]`        | Удалить звуки с платформ           |

Результат `loadImages`/`loadSounds` — токен (или id) загруженного медиа на платформе; `null`, если загрузка
не удалась. Проверяйте успех по `!== null`, а не по булеву значению.

> Если `platforms` не указан, Preload проходит по всем зарегистрированным платформам, но в работе участвуют
> только те, для которых задан токен (`appConfig.tokens[platform].token`).
> Физическое удаление медиа (`removeImages`/`removeSounds`) поддерживается только для Алисы и Маруси —
> для остальных платформ методы завершаются успешно, но ничего не удаляют.

### Удаление медиа

```ts
await Promise.all(
    preload.removeImages(['./media/old.jpg'], [T_ALISA], { alisaSkillId: 'ваш-skill-id' }),
);
await Promise.all(
    preload.removeSounds(['./media/old.mp3'], [T_ALISA], { alisaSkillId: 'ваш-skill-id' }),
);
```

### Когда использовать

- **Всегда**, если у вас в навыке есть изображения или звуки.
- Особенно критично для голосовых платформ из-за практического лимита ~3 с (предупреждение — после 2 с).
- Telegram требует `telegramUseId` — реального пользователя, которому будут отправлены фото для получения `file_id`.
- Алиса требует `alisaSkillId` — API ресурсов Алисы адресуется по навыку, а вне запроса skill_id взять неоткуда.

---

## Тестирование — `BotTest` и Jest

### `BotTest` — диалог с приложением в консоли

`BotTest` запускает вашего бота прямо в терминале — вы вводите текст, как если бы вы были пользователем, и видите ответ
бота. Не нужно публиковать навык в Яндекс.Диалоги или настраивать вебхук — всё работает локально.

Замените `Bot` на `BotTest` и `start()` на `test()`:

```ts
import { BotTest, IBotTestParams } from 'umbot/test';
import { fullPlatforms, FileAdapter } from 'umbot/plugins';

const bot = new BotTest();
bot.use(fullPlatforms);
bot.use(new FileAdapter());
bot.setAppConfig({ json: './data', isLocalStorage: true });
bot.setPlatformParams({ intents: [{ name: 'game', slots: ['играть'] }] });

const params: IBotTestParams = {
    isShowResult: true, // печатать полный JSON ответа платформы
    isShowStorage: true, // печатать userData + state после каждого хода
    isShowTime: true, // печатать время выполнения
};

await bot.test(params);
```

**Что происходит в консоли:**

```
Для выхода введите 'exit'

Ответ в формате платформы: > {"response":{"text":"Привет! Я повторяю за вами.",...}}
Данные в базе > {}
Данные в хранилище > {}
Время выполнения: 4.000мс

Ответ: > Привет! Я повторяю за вами.
Ваш запрос: >
```

- `Ответ в формате платформы` — полный JSON, который ушёл бы в платформу (при `isShowResult: true`).
- `Данные в базе` / `Данные в хранилище` — `userData` и `state` после хода (при `isShowStorage: true`).
- `Время выполнения` — длительность обработки запроса (при `isShowTime: true`, включено по умолчанию).
- `Ответ` — текст, который увидит/услышит пользователь.

**Поведение:**

- При запуске `bot.test()` автоматически отправляется первое сообщение `'Привет'` (имитация старта сессии с
  `messageId === 0`).
- Дальше вы вводите текст вручную, бот отвечает так же, как ответил бы на реальной платформе.
- Выход — введите `exit` или закройте терминал. Также выход произойдёт автоматически, если бот выставил `isEnd = true`.
- `appMode` форсируется в `'dev'` (если явно не указан `strict_prod`).
- Диспетчеризация та же, что и в продакшене — вы тестируете реальную логику.

### Скриптовые тесты через `run()` и `setContent()`

`Bot.run(appType?, content?)` позволяет программно обработать запрос. Это удобно для Jest-тестов и автоматизации.

```ts
import { BotTest } from 'umbot/test';
import { fullPlatforms, T_ALISA } from 'umbot/plugins';

const bot = new BotTest();
bot.use(fullPlatforms);
bot.setAppConfig({ isLocalStorage: true });
bot.initBotController(MyController);

// Вариант 1: передать готовый payload от платформы (например, реальный лог из Яндекс.Диалогов)
const realPayload = JSON.stringify({
    version: '1.0',
    session: { message_id: 0, user_id: 'user-1', application: { application_id: 'AppID' } },
    request: {
        command: 'привет',
        original_utterance: 'Привет',
        nlu: { tokens: ['привет'], entities: [], intents: {} },
    },
    state: {},
});
const result1 = await bot.run(T_ALISA, realPayload);
console.log(result1);

// Вариант 2: подменить содержимое, run() без аргументов
bot.setContent(realPayload);
const result2 = await bot.run(T_ALISA);
```

> **Важно.** Метод `getSkillContent()` является `protected` и недоступен извне класса `BotTest`. Если нужен
> реалистичный payload, проще всего вызвать публичный `bot.simulate(query, options)` — он сам сгенерирует
> корректный запрос платформы и передаст его в `run()`:
>
> ```ts
> // Автоматически сгенерирует запрос Алисы и вызовет run()
> const res = await bot.simulate('привет', { platform: T_ALISA });
> ```
>
> Для чат-платформ (Telegram, VK, Viber, Max) `simulate()` включает `skipAutoReply`, поэтому реальной отправки
> в API платформы не происходит — результатом будет `'ok'`, а текст ответа останется в `text` контроллера.
> Альтернатива — использовать реальный лог от платформы (из консоли разработчика) или создать payload вручную.
>
> Для интерактивного тестирования в REPL используйте `bot.test()` — там `getSkillContent` вызывается автоматически.

### Jest-тесты

```ts
// tests/Controller/mycontroller.test.ts
import { AppContext } from 'umbot';
import { FileAdapter } from 'umbot/plugins';
import { MyController } from '../../src/controller/MyController';

describe('MyController', () => {
    let appContext: AppContext;

    beforeAll(() => {
        appContext = new AppContext();
        const adapter = new FileAdapter();
        adapter.init(appContext);
        adapter.connect();
    });

    it('handles welcome', () => {
        const ctrl = new MyController(appContext);
        ctrl.appType = 'alisa';
        ctrl.userCommand = 'привет';
        ctrl.run();
        expect(ctrl.text).toBe('Привет! Чем могу помочь?');
    });

    it('handles game intent', async () => {
        const ctrl = new MyController(appContext);
        ctrl.appType = 'alisa';
        ctrl.userCommand = 'играть';
        ctrl.run();
        expect(ctrl.text).toContain('Сколько будет');
    });
});
```

### Моки

```ts
// Мок HTTP-клиента (чтобы реальные API не дёргались)
bot.getAppContext().httpClient = (): Promise<Response> =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ mock: 'data' }),
    } as Response);

// Мок файловой БД (чтобы не трогать диск)
const adapter = new FileAdapter();
adapter.getFileData = (tableName) => {
    adapter.setCachedFileData(tableName, { data: mockData, version: Date.now(), isFileRead: true });
    return mockData;
};
adapter.init(appContext);
```

---

## Чеклист: готовность к production

Перед запуском в продакшене убедитесь, что всё выполнено:

- [ ] **Режим `strict_prod`** — включен через `bot.setAppMode('strict_prod')`
- [ ] **Проверка подписи вебхука включена** — задан `tokens.telegram.webhookSecret` / `tokens.max_app.webhookSecret` / `tokens.vk.secret_key`; при старте в логе нет предупреждения «Вебхук принимает запросы платформ [...] БЕЗ проверки подписи». У Алисы/Маруси/SmartApp подписи нет в принципе — не считайте их `userId` аутентифицированной идентичностью. Подробнее — [configuration.md → Проверка подписи вебхука](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_configuration.html#проверка-подписи-вебхука-обязательно-для-production)
- [ ] **Re2 установлен** — `npm install re2` (ускорение RegExp в 2-15 раз)
- [ ] **MongoAdapter вместо FileAdapter** — FileAdapter хранит данные в памяти, не подходит для production
- [ ] **Preload для медиа** — все изображения и звуки предзагружены (иначе первый ответ > 1 сек)
- [ ] **rateLimiter подключен** — `bot.use(rateLimiter())` для защиты от превышения лимитов платформ
- [ ] **Токены в .env** — не в коде, не в git. Проверьте `.gitignore`
- [ ] **error_log настроен** — `bot.setAppConfig({ error_log: './logs' })`
- [ ] **HTTPS настроен** — обязателен для Алисы, Сбера, Viber
- [ ] **Webhook URL зарегистрирован** — в консоли разработчика каждой платформы
- [ ] **Тесты пройдены** — `npm run test` зелёный

---

## Деплой — `start`, `webhookHandle`, Docker, Express

### Встроенный HTTP-сервер

```ts
const server = bot.start('0.0.0.0', 3000);
```

- GET `/health` → `{ status: 'ok', timestamp }` (200)
- POST `/` → `webhookHandle` (обработка запроса платформы)
- Максимальный размер тела: **2 МБ** — при валидном `Content-Length` сверх лимита возвращается 413;
  при стриминговой передаче сверх лимита лишнее отбрасывается и запрос завершается ошибкой 500
- SIGTERM/SIGINT → корректное завершение (`close()` + очистка + `process.exit(0)`)

### Кастомный HTTP-сервер (Express/Fastify)

```ts
import express from 'express';
import { Bot } from 'umbot';

const bot = new Bot();
// ... настройка ...

const app = express();
// ⚠️ НЕ подключайте express.json(): webhookHandle сам читает тело запроса,
// а JSON-парсер съест стрим и обработчик не получит данные
app.post('/webhook/alisa', (req, res) => bot.webhookHandle(req, res));
app.post('/webhook/telegram', (req, res) => bot.webhookHandle(req, res));
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(3000);
```

### Docker

`npx umbot create --prod` генерирует `Dockerfile` (multi-stage, Node 20-alpine):

```dockerfile
# Stage 1: сборка
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
# На этапе сборки ставим ВСЕ зависимости (включая dev): для `npm run build`
# нужен typescript. npm ci используется, если есть package-lock.json.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npm run build

# Stage 2: runtime
FROM node:20-alpine

# Непривилегированный пользователь
RUN addgroup -g 1001 -S nodejs && \
    adduser -S umbot -u 1001

WORKDIR /app

# Копируем только необходимое
COPY --from=builder --chown=umbot:nodejs /app/package*.json ./
COPY --from=builder --chown=umbot:nodejs /app/dist ./dist

# .env внутрь образа НЕ копируется — токены передаются при запуске
# (docker run --env-file .env ...).

# В runtime-этапе dev-зависимости не нужны
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

USER umbot

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

Запуск (токены — через переменные окружения, не внутрь образа):

```bash
docker build -t my-bot .
docker run -p 3000:3000 \
  --env-file .env \
  my-bot
# или точечно:
docker run -p 3000:3000 \
  -e ALISA_TOKEN=... \
  -e TELEGRAM_TOKEN=... \
  my-bot
```

> `EXPOSE` в шаблоне подставляется из порта проекта (`{{port}}`, по умолчанию 3000). Если фреймворк не найдёт
> настроенный `env`, он тихо дозаполнит токены из переменных окружения контейнера — явно писать `env: 'local'`
> для этого не нужно (см. раздел [Конфигурация](#конфигурация-iappconfig-и-iappparam)).

### PM2

```bash
pm2 start dist/index.js --name "my-bot"
pm2 startup
pm2 save
```

### nginx reverse-proxy (HTTPS)

Алиса, Сбер, Маруся, Viber **требуют HTTPS**. Telegram/VK тоже рекомендуют.

```nginx
server {
    listen 443 ssl http2;
    server_name skill.example.com;

    ssl_certificate /etc/letsencrypt/live/skill.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/skill.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### GitHub Actions CI/CD

`npx umbot create --prod` генерирует `.github/workflows/deploy.yml`:

- На push в `main` → сборка → Docker build → push в Docker Hub → SSH на сервер → pull + restart.

### Корректное завершение

```ts
process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await bot.close(); // останавливает сервер, сохраняет данные, закрывает БД
    process.exit(0);
});
```

`bot.start()` уже навешивает эти хуки автоматически — обычно вручную делать не нужно.

### Высокая нагрузка: несколько процессов и горизонтальное масштабирование

Один экземпляр `Bot` — это один Node.js процесс. Обработка вебхука полностью
stateless по отношению к процессу: каждый запрос самодостаточен, `userData` читается из БД, а `state` голосовых платформ (Алиса, Маруся, SmartApp) приходит
в теле самого запроса и не хранится на сервере. Благодаря этому бот масштабируется
горизонтально без дополнительных механизмов (сессий, sticky-балансировки и т.п.).

#### Когда одного процесса достаточно

Накладные расходы фреймворка на один запрос невелики — порядок виден в
`tests/Performance` (p50 latency типовых сценариев) и скриптах `benchmark/`
(включая стресс-сценарии с 1000+ команд). Узкое место на практике почти никогда
не сам фреймворк, а внешние вызовы (БД, API платформ). Если бот работает на
одном сервере и нагрузка умеренная — одного процесса достаточно, и это самая
простая конфигурация.

#### Несколько инстансов за балансировщиком

Когда нужны отказоустойчивость и распределение нагрузки, запустите N одинаковых
инстансов (Docker-реплики, PM2 cluster, несколько серверов за nginx):

```bash
# PM2 cluster: по процессу на ядро
pm2 start dist/index.js -i max

# или Docker Compose
# deploy:
#   replicas: 4
```

Единственное жёсткое требование — **общая база данных**:

| Конфигурация                      | Несколько процессов |
| --------------------------------- | ------------------- |
| `MongoAdapter` (или свой адаптер) | ✅ Да               |
| `FileAdapter`                     | ❌ Нет              |

`FileAdapter` читает и пишет JSON-файлы без блокировок и рассчитан строго на один
процесс — это задокументированное ограничение, а не баг. При нескольких процессах
каждый инстанс будет видеть свою копию данных, и записи начнут теряться. Поэтому
в multi-process и multi-server конфигурациях используйте `MongoAdapter` или свой
адаптер (PostgreSQL, Redis — см. «Свой DB-адаптер»).

Кэши токенов медиа (`ImageTokens`, `SoundTokens`) хранятся в той же БД, поэтому
все инстансы используют общие токены и не пере-загружают картинки и звуки
повторно.

#### Изоляция платформ по разным процессам

Если отказ одной платформы не должен ронять остальные (например, внутренний
чат-бот и навык Алисы — разные SLA), разверните отдельный процесс на платформу:
свой экземпляр `Bot` со своим набором адаптеров и своим webhook-URL. Бизнес-логику
(команды, шаги, middleware) вынесите в общий модуль и подключайте в оба процесса —
это обычный код, не привязанный к экземпляру `Bot`.

```ts
// process-telegram.ts
const bot = new Bot().use(new TelegramAdapter(process.env.TELEGRAM_TOKEN!));
applySharedLogic(bot); // общие команды и шаги из вашего модуля
bot.start('0.0.0.0', 3001);

// process-alisa.ts
const bot = new Bot().use(new AlisaAdapter());
applySharedLogic(bot);
bot.start('0.0.0.0', 3002);
```

Плюс: падение или рестарт одного процесса не затрагивает остальные, лимиты и
нагрузку каждой платформы видно отдельно. Минус: больше процессов — больше
инфраструктуры (порты, health-check'и, деплой).

#### Serverless (Yandex Cloud Functions и аналоги)

В serverless-окружениях файловая система доступна только на чтение, поэтому
файловые логи (`error_log`) писать туда нельзя — и не нужно. Настройте один из
вариантов:

- внешний логгер: `bot.getAppContext().setLogger({ log, warn, error })` с отправкой
  в вашу систему логирования (или собирайте вывод в stdout — облако собирает его
  само);
- либо оставьте поведение по умолчанию: если записать лог не удаётся, фреймворк
  не зацикливается, а пишет одно сообщение в stderr и приостанавливает попытки
  записи на минуту.

Для serverless также характерны холодные старты и короткий TTL процесса —
`FileAdapter` там неприменим по той же причине: данные должны жить во внешней БД.

---

## Лимиты и производительность — что нужно знать

### Про лимиты платформ

Подробные лимиты платформ (1024 символа, 10 кнопок и т.д.) **адаптеры берут на себя** — об этом подробнее в разделе
[Главное про лимиты платформ](#главное-про-лимиты-платформ). Вам не нужно их запоминать: фреймворк сам обрежет
лишнее.

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

- Холодный старт: < 30 мс при 1000 команд.
- При 10 000+ команд с regex — установите `re2` (2–15× ускорение).
- 48-часовой soak-тест: ~67 000 RPS без утечек памяти.
- Для высокой нагрузки — `setAppMode('strict_prod')`, `MongoAdapter`, `Preload` медиа.

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

В методе `action()` ошибки не перехватываются автоматически. Рекомендуется оборачивать тело `action()` в `try/catch`:

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

В режиме `dev` ошибки выводятся в консоль и в файл (если указан `error_log`). В режимах `prod` и `strict_prod` — только
в файл.

### Типичные сценарии

| Сценарий                                                                                | Что происходит                | Рекомендация                                 |
| --------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------- |
| Ошибка в команде                                                                        | Стандартное сообщение + лог   | Оберните в `try/catch` для кастомного ответа |
| Ошибка в middleware                                                                     | `action()` не вызывается      | Логируйте и устанавливайте `text`            |
| Ошибка в `fetch`                                                                        | Промис отклоняется            | Используйте `try/catch` + таймауты           |
| Ошибка в БД                                                                             | Метод возвращает `false`      | Проверяйте результат `save()`                |
| Таймаут платформы (~3 сек; фреймворк предупреждает после 2 с, ошибку пишет после 2,9 с) | Платформа обрывает соединение | Используйте `Preload` для медиа              |

---

## Метрики

Фреймворк собирает метрики времени выполнения ключевых операций. Это полезно для профилирования и поиска узких мест.

### Как включить

Метрики собираются, только если в логгере реализован метод `metric()`:

```ts
bot.setLogger({
    metric: (name: string, value: unknown, meta?: Record<string, unknown>) => {
        console.log(`[METRIC] ${name}: ${value}`, meta);
    },
});
```

### Доступные метрики

| Метрика               | Константа               | Что измерает                                                                                                                   |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Исходящий HTTP-запрос | `EMetric.REQUEST`       | Время запроса фреймворка к внешнему API платформы (`url`, `method`, `status` в meta). Входящий запрос измеряется `END_WEBHOOK` |
| Начало webhook        | `EMetric.START_WEBHOOK` | Момент (timestamp) начала обработки запроса                                                                                    |
| Время webhook         | `EMetric.END_WEBHOOK`   | Общее время обработки входящего webhook                                                                                        |
| Поиск интента         | `EMetric.GET_INTENT`    | Время поиска подходящего интента                                                                                               |
| Поиск команды         | `EMetric.GET_COMMAND`   | Время поиска подходящей команды                                                                                                |
| Выполнение action     | `EMetric.ACTION`        | Время выполнения вашего `action()`                                                                                             |
| Middleware            | `EMetric.MIDDLEWARE`    | Время выполнения middleware-цепочки                                                                                            |
| Запрос к БД (SELECT)  | `EMetric.DB_SELECT`     | Время выполнения SELECT                                                                                                        |
| Запрос к БД (INSERT)  | `EMetric.DB_INSERT`     | Время выполнения INSERT                                                                                                        |
| Запрос к БД (UPDATE)  | `EMetric.DB_UPDATE`     | Время выполнения UPDATE                                                                                                        |
| Запрос к БД (DELETE)  | `EMetric.DB_REMOVE`     | Время выполнения DELETE                                                                                                        |

### Как читать метрики

Пример вывода:

```
[METRIC] umbot_get-command_duration_ms: 0.45ms { commandName: 'weather', status: true }
[METRIC] umbot_action_duration_ms: 12.30ms { commandName: 'weather', platform: 'telegram' }
```

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

## Рецепты (cookbook)

### Рецепт 1: Простой echo-навык

```ts
import { Bot, WELCOME_INTENT_NAME, FALLBACK_COMMAND } from 'umbot';
import { fullPlatforms } from 'umbot/plugins';

const bot = new Bot()
    .use(fullPlatforms)
    .setAppConfig({ isLocalStorage: true })
    .setAppMode('strict_prod');

bot.addCommand(WELCOME_INTENT_NAME, ['привет'], (_, bc) => {
    bc.text = 'Привет! Я повторяю за вами.';
    bc.buttons.addBtn('Помощь');
});

bot.addCommand(
    FALLBACK_COMMAND,
    [],
    (userCommand, bc) => {
        bc.text = `Вы сказали: ${userCommand}`;
    },
    true,
);

bot.start('0.0.0.0', 3000);
```

### Рецепт 2: Многошаговая регистрация

```ts
import { Bot, BotController, IUserData } from 'umbot';

interface RegData extends IUserData {
    name?: string;
    age?: number;
}

// Команда-триггер — userData здесь не используем, типизировать не обязательно
bot.addCommand('register', ['регистрация'], (_, bc) => {
    bc.text = 'Введите имя:';
    bc.thisIntentName = 'reg_name';
});

// Шаг — типизируем через generic-параметр
bot.addStep('reg_name', (bc: BotController<RegData>) => {
    bc.userData.name = bc.originalUserCommand;
    bc.text = `Привет, ${bc.userData.name}! Возраст?`;
    bc.thisIntentName = 'reg_age';
});

bot.addStep('reg_age', (bc: BotController<RegData>) => {
    const age = parseInt(bc.userCommand || '', 10);
    if (isNaN(age) || age < 1 || age > 120) {
        bc.text = 'Не похоже на возраст. Число 1–120:';
        bc.thisIntentName = 'reg_age';
        return;
    }
    bc.userData.age = age;
    bc.text = `Готово! Вам ${age} лет.`;
    bc.thisIntentName = null;
});
```

### Рецепт 3: Игра с прогрессом

```ts
import { BotController, IUserData } from 'umbot';

interface GameData extends IUserData {
    score: number;
    level: number;
    lastPlayed?: string;
}

// Аннотация bc — TypeScript знает про поля userData
bot.addCommand('play', ['играть'], (_, bc: BotController<GameData>) => {
    bc.userData.score ??= 0;
    bc.userData.level ??= 1;
    bc.userData.score += 10;
    if (bc.userData.score % 100 === 0) bc.userData.level += 1;
    bc.userData.lastPlayed = new Date().toISOString();
    bc.text = `+10 очков! Всего: ${bc.userData.score}, уровень: ${bc.userData.level}`;
    bc.buttons.addBtn('Ещё раз');
});
```

### Рецепт 4: Карточка товара с кнопкой

```ts
bot.addCommand('show_product', ['покажи товар'], (_, bc) => {
    if (!bc.isScreen) {
        bc.text = 'Этот раздел требует экран. Откройте навык на устройстве с экраном.';
        return;
    }
    bc.text = '';
    bc.tts = 'Посмотрите этот товар';
    bc.card
        .addOneImage('https://shop.example.com/img/1.jpg', 'iPhone 15', '99 990 ₽')
        .addButton({ title: 'Купить', payload: { action: 'buy', id: 1 } });
});
```

### Рецепт 5: Звуки победы

```ts
import { SoundConstants } from 'umbot';

bot.addCommand('win', ['победа', 'выиграл'], (_, bc) => {
    bc.text = 'Вы выиграли!';
    // Стандартный звук победы (только Алиса/Маруся)
    bc.tts = `${SoundConstants.S_EFFECT_HAMSTER}Ура!${SoundConstants.S_EFFECT_END} Поздравляю! ${SoundConstants.S_AUDIO_GAME_WIN} Вы великолепны!`;
});
```

### Рецепт 6: Пагинация

```ts
import { Navigation, BotController, IUserData } from 'umbot';

interface ListData extends IUserData {
    page?: number;
}

const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const nav = new Navigation<string>(3); // 3 элемента на странице

bot.addCommand(
    'list',
    ['список', 'дальше', 'назад'],
    (userCommand, bc: BotController<ListData>) => {
        bc.userData.page ??= 0;
        nav.thisPage = bc.userData.page;

        const page = nav.getPageElements(items, userCommand || '');
        bc.userData.page = nav.thisPage;

        bc.text = page.map((s, i) => `${i + 1}. ${s}`).join('\n');
        for (const cap of nav.getPageNav()) {
            bc.buttons.addBtn(cap);
        }
        const info = nav.getPageInfo();
        if (info) bc.buttons.addBtn(info);
    },
);

// Выбор элемента по имени — отдельная команда (сработает, если пользователь сказал имя, а не "дальше")
bot.addCommand('select_item', items, (userCommand, bc: BotController<ListData>) => {
    nav.thisPage = bc.userData.page ?? 0;
    const selected = nav.selectedElement(items, userCommand || '', []);
    if (selected) {
        bc.text = `Вы выбрали: ${selected}`;
    } else {
        bc.text = 'Не нашёл такого элемента на текущей странице.';
    }
});
```

### Рецепт 7: HTTP-запрос к внешнему API

Для HTTP-запросов используйте стандартный `fetch` (доступен в Node.js 20.19+). Обязательно ставьте таймаут через
`AbortController` — иначе внешний API может зависнуть и съесть весь лимит времени ответа.

```ts
bot.addCommand('weather', ['погода'], async (_, bc) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
        const url = 'https://api.weather.example.com/current?city=moscow';
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { temp: number; condition: string };
        bc.text = `Сейчас ${data.temp}°C, ${data.condition}`;
    } catch (e) {
        bc.text = 'Не удалось узнать погоду. Попробуйте позже.';
    } finally {
        clearTimeout(timeout);
    }
});
```

### Рецепт 8: Авторизация Алисы (полный flow)

Авторизация — это особый случай: фреймворк сам выставляет `controller.userEvents.auth.status` и `controller.userToken`,
поэтому логику удобнее держать в контроллере (через `action`), а не в `addCommand`. Но триггер «пользователь сказал
"авторизоваться"» можно оформить командой.

```ts
// Триггер — пользователь инициировал авторизацию
bot.addCommand('auth', ['авторизоваться', 'войти'], (_, bc) => {
    bc.isAuth = true; // фреймворк отправит start_account_linking
    bc.text = 'Перенаправляю на авторизацию...';
});

// Контроллер обрабатывает события авторизации (они приходят автоматически)
bot.initBotController(
    class extends BotController {
        action(intentName, isCommand, isStep) {
            if (isCommand || isStep) return;

            // Событие: Алиса прислала account_linking_complete_event
            // В ЭТОМ запросе userEvents.auth.status === true, но userToken ещё null!
            if (this.userEvents?.auth?.status === true) {
                this.userData.authCompleted = true;
                this.text = 'Авторизация завершена! Теперь вам доступны все функции.';
                return;
            }

            // В последующих регулярных запросах userToken уже заполнен
            if (this.userToken) {
                // Делаем авторизованные запросы к вашему API:
                // const res = await fetch('https://api.example.com/me', {
                //     headers: { Authorization: `Bearer ${this.userToken}` },
                // });
            }
        }
    },
);
```

> **Важно:** между шагом 2 (получение `account_linking_complete_event`) и шагом 3 (`userToken` заполнен) может быть
> задержка — следующий запрос от Алисы. Не рассчитывайте, что `userToken` доступен сразу в том же запросе.

### Рецепт 9: Кнопка с payload — кроссплатформенный паттерн

Когда пользователь нажимает кнопку с payload, фреймворк прокидывает payload в `controller.payload`. Обрабатывать нажатие
удобнее в контроллере через `action()` (а не отдельной командой) — потому что проверка `payload` должна идти **до**
проверки `intentName`, иначе возможны коллизии.

```ts
// Кнопка с payload (объектом — рекомендуется)
bot.addCommand('show_product', ['покажи товар'], (_, bc) => {
    bc.card
        .addOneImage('https://shop.example.com/1.jpg', 'Товар 1', '99 ₽')
        .addButton({ title: 'Купить', payload: { action: 'buy', id: 1 } });
});

// Контроллер обрабатывает нажатия кнопок
bot.initBotController(
    class extends BotController {
        action(intentName: string | null, isCommand?: boolean, isStep?: boolean): void {
            // Сначала проверяем payload — иначе коллизия: если кнопка "Купить"
            // совпадёт со слотом команды 'купить', сработает команда, isCommand=true,
            // и мы выйдем по раннему возврату, не дойдя до payload.
            const data = this.payload as Record<string, unknown> | null;
            if (data?.action === 'buy') {
                this.text = `Покупка товара #${data.id} инициирована.`;
                this.buttons.addBtn('Помощь');
                return;
            }

            // Если сработала команда/шаг — они уже всё сделали, выходим.
            if (isCommand || isStep) return;

            // Обычная обработка по intentName (welcome, help, ...)
            this.buttons.addBtn('Помощь');
        }
    },
);
```

> **Совет:** проверяйте payload **до** intentName, иначе возможны коллизии. Например, если кнопка называется "Играть",
> её нажатие установит `userCommand='играть'`, и сработает интент `play`, а не ваш обработчик кнопки.

### Рецепт 10: Средство безопасности — rate limiter

```ts
import { Bot } from 'umbot';
import { fullPlatforms, MongoAdapter } from 'umbot/plugins';
import { rateLimiter } from 'umbot/middleware';

new Bot()
    .use(fullPlatforms)
    .use(new MongoAdapter({ host: 'mongodb://...', database: 'umbot' }))
    .use(rateLimiter()) // глобально
    .use('telegram', rateLimiter(50, 120_000)) // для TG — отдельный лимит
    .start('0.0.0.0', 3000);
```

### Рецепт 11: Express + umbot

```ts
import express from 'express';
import { Bot } from 'umbot';
import { fullPlatforms } from 'umbot/plugins';

const bot = new Bot();
bot.use(fullPlatforms);
bot.setAppConfig({ isLocalStorage: true });
bot.initBotController(MyController);

const app = express();
// ⚠️ НЕ подключайте express.json(): webhookHandle сам читает тело запроса
app.post('/webhook', (req, res) => bot.webhookHandle(req, res));
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));
app.listen(3000, () => console.log('Server started on :3000'));
```

### Рецепт 12: Preload медиа при старте

```ts
import { Bot } from 'umbot';
import { fullPlatforms, T_ALISA } from 'umbot/plugins';
import { Preload } from 'umbot/preload';

const bot = new Bot();
bot.use(fullPlatforms);
bot.setAppConfig({ isLocalStorage: true });
bot.initBotController(MyController);

const preload = new Preload(bot.getAppContext());
await Promise.all([
    ...preload.loadImages(['./media/img1.jpg', './media/img2.png'], [T_ALISA], {
        alisaSkillId: 'ваш-skill-id',
    }),
    ...preload.loadSounds(['./media/win.mp3', './media/lose.mp3'], [T_ALISA], {
        alisaSkillId: 'ваш-skill-id',
    }),
]);

bot.start('0.0.0.0', 3000);
```

### Рецепт 13: Кастомный логгер (Winston/Pino)

```ts
import winston from 'winston';
import { Bot } from 'umbot';

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [new winston.transports.Console()],
});

const bot = new Bot();
bot.setLogger({
    log: (...args) => logger.info(args.join(' ')),
    error: (msg, meta) => logger.error(msg, meta),
    warn: (msg, meta) => logger.warn(msg, meta),
    metric: (name, value, labels) => logger.info({ metric: name, value, labels }),
    maskSecrets: true,
});
```

### Рецепт 14: Несколько middleware с общей логикой

```ts
const logMiddleware = (label: string) => async (ctx: BotController, next: MiddlewareNext) => {
    console.log(`[${label}] → ${ctx.userCommand}`);
    await next();
    console.log(`[${label}] ← ${ctx.text?.substring(0, 50)}`);
};

bot.use(logMiddleware('global'));
bot.use(T_ALISA, logMiddleware('alisa'));
bot.use(T_TELEGRAM, logMiddleware('telegram'));
```

Порядок вывода: `[global] →` → `[global] ←` → `[alisa] →` → `[alisa] ←` — глобальная цепочка завершается целиком до начала платформенной.

### Рецепт 15: Свой NLU-плагин

```ts
// plugins/MyNluPlugin.ts
import { AppContext, Bot, INlu } from 'umbot';

export class MyNluPlugin {
    init(appContext: AppContext, bot: Bot): void {
        appContext.plugins.nlu = (
            text: string,
            platformNlu: INlu,
            platform: string,
            request: unknown,
        ): INlu => {
            return {
                ...platformNlu,
                intents: {
                    ...platformNlu.intents,
                    custom: { slots: [] },
                },
            } as INlu;
        };
    }
}

// Использование
bot.use(new MyNluPlugin());
```

### Рецепт 16: i18n-плагин

Слот i18n типизирован как `(key: string, ...params: unknown[]) => string`, но на практике фреймворк вызывает его с
**единственным аргументом** — текущим `controller.text` в роли `key` — и ожидает получить переведённую строку. Вызов
происходит автоматически после отработки команды (в дефолтном `BaseBotController`), перед отправкой ответа. Функция
или объект с методом `getData(key)` — оба варианта поддерживаются.

```ts
// plugins/I18nPlugin.ts
import { AppContext, Bot, createPlugin } from 'umbot';

const translations: Record<string, Record<string, string>> = {
    ru: { hello: 'Привет!', bye: 'Пока!' },
    en: { hello: 'Hello!', bye: 'Bye!' },
};

// Язык можно определять по данным пользователя или платформы — здесь для простоты константа
const lang = 'ru';

export const i18nPlugin = createPlugin((appContext: AppContext, bot: Bot): void => {
    appContext.plugins.i18n = (text: string): string => {
        return translations[lang]?.[text] ?? text;
    };
});

// В контроллере ничего делать не нужно: BaseBotController сам прогоняет
// this.text через плагин перед отправкой ответа:
//   this.text = 'hello'  →  пользователю уйдёт «Привет!»
```

### Рецепт 17: Telegram inline mode

Telegram отправляет `inline_query` в теле запроса. Обрабатывайте в `action()` или middleware и отвечайте через
готовый метод `answerInlineQuery()` (не через `call()` — он принимает `(method, userId)` и шлёт сообщения, а не
результаты inline-поиска):

```ts
bot.use(T_TELEGRAM, async (ctx, next) => {
    const req = ctx.requestObject as Record<string, unknown>;
    const inlineQuery = req.inline_query as { id: string } | undefined;
    if (inlineQuery) {
        const telegramApi = new TelegramRequest(ctx.appContext);
        // формируем результаты inline-поиска
        await telegramApi.answerInlineQuery(inlineQuery.id, [
            {
                type: 'article',
                id: '1',
                title: 'Пример',
                input_message_content: { message_text: 'Привет из inline-режима!' },
            },
        ]);
        ctx.skipAutoReply = true;
        return;
    }
    await next();
});
```

### Рецепт 18: Бэкап userData в БД

Если используете `isLocalStorage: true` (без БД), но хотите бэкапить:

```ts
bot.use(async (ctx, next) => {
    await next();
    // Сохраняем копию в БД после каждого запроса
    if (ctx.userData && Object.keys(ctx.userData).length > 0) {
        const backup = new UsersData(ctx.appContext);
        backup.userId = ctx.userId;
        backup.platform = ctx.appType!;
        backup.data = ctx.userData;
        await backup.save();
    }
});
```

---

## Сценарии, требующие кастомной реализации

Это не недостатки фреймворка — это просто сценарии, для которых нет готовых примеров в репозитории. Разработчику
придётся реализовать их самостоятельно, опираясь на API.

### Serverless-деплой (Yandex Cloud Functions, AWS Lambda)

`umbot` использует `http.createServer` — не идеально для serverless. Рекомендуемый путь — метод
`bot.webhookEvent(data, headers?, clientIp?)`: он принимает тело запроса и заголовки без HTTP-объектов и возвращает
`{ statusCode, body }` — готовый ответ облачной функции (включая проверку подписи и подтверждение VK):

```ts
// index.ts для Yandex Cloud Function
import { Bot } from 'umbot';

const bot = new Bot();
// ... настройка ...

export const handler = async (event: Record<string, unknown>) => {
    // event.body — JSON от платформы
    const content = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
    const result = await bot.webhookEvent(content, event.headers as Record<string, unknown>);
    return {
        statusCode: result.statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
    };
};
```

> В репозитории нет примера serverless-деплоя. Если планируете YCF/Lambda — добавьте в инструкцию для разработчика.

### Account linking с backend-интеграцией

Полный flow:

1. Пользователь говорит "авторизоваться".
2. Контроллер ставит `this.isAuth = true`.
3. Фреймворк отправляет `start_account_linking` — Яндекс открывает браузер.
4. Браузер редиректит на ваш backend.
5. Backend генерирует access_token, редиректит обратно в Яндекс с `access_token`.
6. Алиса присылает **специальный запрос** с `account_linking_complete_event: true`.
    - В этом запросе: `controller.userEvents.auth.status === true`.
    - В этом запросе: `controller.userToken` **всё ещё null** (токен в этом запросе не передаётся).
7. В **следующих регулярных запросах** (когда пользователь скажет что-то ещё) Алиса присылает
   `session.user.access_token`, и `controller.userToken` будет заполнен.

Backend-часть (между шагами 4–5) в фреймворке не реализована — пишете сами.

### Quota management для медиа Алисы

Фреймворк кэширует загруженные медиа, но не показывает оставшуюся квоту (1 ГБ на аккаунт). Можно через
`YandexImageRequest.checkOutPlace()`:

```ts
import { YandexImageRequest } from 'umbot/plugins';

// Порядок аргументов конструктора: oauth, skillId, appContext.
// Если передать null вместо oauth, будет использован токен из appConfig.tokens.alisa.token.
const req = new YandexImageRequest(null, 'skill_id', controller.appContext);

// При необходимости токен можно задать явно (без префикса "OAuth " —
// setOAuth добавит его сам):
req.setOAuth('y0_AgAAAA...');

const res = await req.checkOutPlace();
if (res) {
    // Значения used/total приходят в байтах
    console.log(`Used: ${res.used} / Total: ${res.total}`);
}
```

### Использование `YANDEX.CONFIRM` / `YANDEX.REJECT` для yes/no диалогов

Алиса распознаёт "да"/"нет" автоматически как built-in интенты. Можно использовать без настройки в Яндекс.Диалогах:

```ts
public action(intentName: string | null): void {
    if (this.nlu.isIntentConfirm(this.userCommand || '')) {
        // пользователь сказал "да", "конечно", "хорошо", ...
    }
    if (this.nlu.isIntentReject(this.userCommand || '')) {
        // "нет", "не надо", "отмена", ...
    }
}
```

### Atomic-операции с БД

`UsersData.save()` делает upsert (select → insert/update). Если нужны транзакции — используйте `model.query(cb)` с
MongoAdapter:

```ts
const userData = new UsersData(this.appContext);
await userData.query(async (client, db) => {
    const session = client.startSession();
    await session.withTransaction(async () => {
        // атомарные операции
    });
});
```

### Логирование в Sentry/Datadog

Через `setLogger`:

```ts
bot.setLogger({
    error: (msg, meta) => Sentry.captureException(new Error(msg), { extra: meta }),
    warn: (msg, meta) => Sentry.captureMessage(msg, 'warning', { extra: meta }),
    // ...
});
```

### WebSocket-уведомления

Не входит в фреймворк. Используйте `bot.send(userId, text, platform)` в связке с внешним WS-сервером.

### i18n с плюрализацией

Встроенный i18n-плагин слишком простой. Используйте `i18next` или `@formatjs/intl`, подключив их в слот `i18n` —
фреймворк автоматически пропустит `controller.text` через него перед отправкой ответа:

```ts
import i18next from 'i18next';
import { createPlugin } from 'umbot';

bot.use(
    createPlugin((appContext) => {
        appContext.plugins.i18n = (text: string) => i18next.t(text, { lng: 'ru' });
    }),
);
```

### Загрузка изображений по URL налету

Если пользователь прислал URL картинки и вы хотите её отправить — фреймворк это умеет (просто передайте URL в
`card.addImage`). Но **нет** готовой функции "скачать картинку, обработать, upload" — нужна своя логика через `fetch`:

```ts
import { promises as fsPromises } from 'node:fs';

bot.addCommand('repost', ['репост'], async (_, bc) => {
    const userUrl = bc.originalUserCommand || '';
    try {
        const res = await fetch(userUrl, {
            signal: AbortSignal.timeout(3000), // не даём чужому URL зависнуть
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const tmpPath = '/tmp/downloaded.jpg';
        await fsPromises.writeFile(tmpPath, buf);
        bc.card.addImage(tmpPath, 'Загружено');
        bc.text = 'Вот ваша картинка.';
    } catch (e) {
        bc.text = 'Не удалось скачать картинку.';
    }
});
```

### Alice-специфичный сценарий: показать список с пагинацией и обработать выбор

Распространённая задача, для которой нет готового примера. Используйте `Navigation` + `card.addImage` (см. рецепт 6 +
расширение для карточек).

---

## Краткая шпаргалка по API

### Минимальный setup

```ts
import { Bot, BotController, WELCOME_INTENT_NAME, FALLBACK_COMMAND } from 'umbot';
import { fullPlatforms, FileAdapter } from 'umbot/plugins';

new Bot()
    .use(fullPlatforms)
    .use(new FileAdapter())
    .setAppConfig({ json: './data', isLocalStorage: false })
    .setPlatformParams({
        welcome_text: 'Привет!',
        help_text: 'Помощь',
        empty_text: 'Не поняла',
        intents: [{ name: 'bye', slots: ['пока'] }],
    })
    .initBotController(MyController)
    .setAppMode('strict_prod')
    .start('0.0.0.0', 3000);
```

### Шпаргалка по контроллеру

```ts
class MyController extends BotController<MyUserData> {
    action(intentName, isCommand?, isStep?): void {
        if (isCommand || isStep) return;  // уже обработано

        // Текст
        this.text = '...';
        this.tts = '...';
        this.isEnd = true;  // завершить сессию

        // Кнопки
        this.buttons.addBtn('Да').addBtn('Нет');
        this.buttons.addLink('Сайт', 'https://...');

        // Карточка
        this.card.addOneImage(url, 'Title', 'Desc', { title: 'OK' });
        this.card.addImage(url, 'Title', 'Desc', btn).addImage(...);

        // Звуки
        this.tts = `${SoundConstants.S_AUDIO_GAME_WIN} Победа!`;

        // NLU
        const fio = this.nlu.getFio();
        const dt = this.nlu.getDateTime();
        const num = this.nlu.getNumber();
        if (this.nlu.isIntentConfirm(this.userCommand || '')) { /* ... */
        }

        // Состояние
        this.userData.score = (this.userData.score || 0) + 1;
        this.state.tempData = '...';  // только при isLocalStorage: true

        // Переход к шагу
        this.thisIntentName = 'next_step';  // следующий ход → bot.addStep('next_step', ...)

        // Авторизация (только Алиса)
        this.isAuth = true;
    }
}
```

### Шпаргалка по командам

```ts
// Обычная команда
bot.addCommand('hello', ['привет', 'hi'], (_, bc) => {
    bc.text = 'Привет!';
});

// Команда с regex
bot.addCommand('num', [/^\d+$/], (cmd, bc) => {
    bc.text = `Число: ${cmd}`;
});

// Команда с regex-строкой
bot.addCommand(
    'phone',
    ['\\+?\\d{11}'],
    (cmd, bc) => {
        bc.text = `Телефон: ${cmd}`;
    },
    true,
); // isPattern = true

// Асинхронная команда — через fetch
bot.addCommand('weather', ['погода'], async (_, bc) => {
    try {
        const res = await fetch('https://api.weather.example.com/current', {
            signal: AbortSignal.timeout(3000),
        });
        const data = (await res.json()) as { temp: number };
        bc.text = `Температура: ${data.temp}`;
    } catch {
        bc.text = 'Не удалось узнать погоду.';
    }
});

// Fallback
bot.addCommand(
    FALLBACK_COMMAND,
    [],
    (cmd, bc) => {
        bc.text = `Не поняла: ${cmd}`;
    },
    true,
);
```

### Шпаргалка по шагам

```ts
bot.addCommand('start', ['начать'], (_, bc) => {
    bc.text = 'Шаг 1:';
    bc.thisIntentName = 'step1';
});

bot.addStep('step1', (bc) => {
    bc.text = `Вы сказали: ${bc.userCommand}. Шаг 2:`;
    bc.thisIntentName = 'step2';
});

bot.addStep('step2', (bc) => {
    bc.text = `Готово! Ввод: ${bc.userCommand}`;
    bc.thisIntentName = null; // выходим
});
```

### Шпаргалка по импортам

```ts
// Главный модуль
import {
    Bot,
    BotController,
    IUserData,
    WELCOME_INTENT_NAME,
    HELP_INTENT_NAME,
    FALLBACK_COMMAND,
    Text,
    Navigation,
    SoundConstants,
    Nlu,
    Buttons,
    Card,
    Sound,
    UsersData,
    ImageTokens,
    SoundTokens,
} from 'umbot';

// Платформы и БД
import {
    fullPlatforms,
    voicePlatforms,
    botPlatforms,
    AlisaAdapter,
    TelegramAdapter,
    VkAdapter,
    ViberAdapter,
    MaxAdapter,
    MarusiaAdapter,
    SmartAppAdapter,
    FileAdapter,
    MongoAdapter,
    BasePlatformAdapter,
    BaseDbAdapter,
    T_ALISA,
    T_TELEGRAM,
    T_VK,
    T_VIBER,
    T_MAX_APP,
    T_MARUSIA,
    T_SMART_APP,
} from 'umbot/plugins';

// Middleware
import { rateLimiter } from 'umbot/middleware';

// Тестирование
import { BotTest } from 'umbot/test';

// Предзагрузка
import { Preload } from 'umbot/preload';

// Упрощённый запуск
import { run } from 'umbot/build';
```

---

## Финальные рекомендации

1. **Начните с CLI.** `npx umbot create my-skill` даёт рабочий шаблон за минуту.
2. **Используйте `BotTest` для разработки.** REPL в консоли экономит часы — не нужно публиковать навык и тестировать
   через Яндекс.Диалоги.
3. **Всегда `setAppMode('strict_prod')` в продакшене.** Это ловит ReDoS и маскирует секреты в логах.
4. **Включайте `Preload` для медиа.** Первый пользователь не должен ждать upload.
5. **Храните состояние в `userData`, а не в локальных переменных контроллера.** Контроллер пересоздаётся на каждый
   запрос.
6. **Тестируйте на всех целевых платформах.** Логика одна, но лимиты и особенности разные.
7. **Логируйте медленные запросы.** Middleware, который печатает время > 1с, спасёт от таймаутов голосовых платформ.
8. **Используйте `MongoAdapter` для продакшена.** `FileAdapter` — только для прототипов.
9. **Читайте исходники.** Они хорошо задокументированы JSDoc на русском.
