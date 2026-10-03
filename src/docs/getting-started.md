# Быстрый старт: первый навык или чат-бот на umbot

В этом руководстве вы узнаете, как быстро создать мультиплатформенное приложение для голосовых навыков и чат‑ботов с помощью фреймворка `umbot` на TypeScript.

## Введение

`umbot` - универсальный фреймворк для разработки голосовых навыков и чат‑ботов для множества платформ. Ключевые возможности:

- Единая кодовая база для всех платформ (Алиса, Сбер Салют, Telegram, VK и др.)
- Встроенное управление состоянием пользователя
- Полная типобезопасность (TypeScript)
- UI‑компоненты: кнопки, карточки, изображения, звуки

## Быстрый старт

### 1. Установка

Быстрее всего создать готовый проект через CLI:

```bash
npx umbot create echo
cd echo
npm i
npm run build
npm start
```

CLI создаст контроллер, конфигурацию, `package.json`, `tsconfig.json`, `.gitignore` и `.env` с пустыми переменными
токенов — впишите токены платформ, которые используете. Флаг `--minimal` создаёт
проект без класса-контроллера, `--prod` добавляет Dockerfile и файл деплоя. Проект из визуального редактора
собирается командой `npx umbot create from-flow flow.json --output ./my-bot`.

Если хотите собрать проект сами, установите пакет:

```bash
npm install umbot
```

### 2. Создание простого навыка

**Базовый вариант (с использованием контроллера)**
Создадим контроллер, в котором опишем логику обработки команд.

```ts
import { Bot, BotController, WELCOME_INTENT_NAME } from 'umbot';
import { fullPlatforms } from 'umbot/plugins';
import { join } from 'node:path';

// Создаем контроллер с логикой навыка
class MyController extends BotController {
    public action(intentName: string | null): void {
        switch (intentName) {
            case WELCOME_INTENT_NAME:
                this.text = 'Привет! Я новый навык.';
                this.buttons.addBtn('Помощь');
                break;

            case 'help':
                this.text = 'Я умею отвечать на команды и показывать кнопки';
                break;

            default:
                this.text = this.userCommand || 'Вы ничего не сказали';
                break;
        }
    }
}

// Инициализируем приложение
const bot = new Bot();
// Подключаем все доступные платформы
// Если вам нужны только голосовые платформы, используйте voicePlatforms или конкретный адаптер, если нужна только одна платформа
bot.use(fullPlatforms);

// Настраиваем команды
bot.setPlatformParams({
    intents: [
        {
            name: 'help',
            slots: ['помощь', 'что ты умеешь'],
        },
    ],
});

// Настраиваем параметры
bot.setAppConfig({
    json: join(__dirname, 'data'),
    error_log: join(__dirname, 'logs'),
    isLocalStorage: true,
});

// Подключаем контроллер
bot.initBotController(MyController);

bot.start('localhost', 3000);
```

**Минималистичный вариант (без контроллера)**

Также можно совсем не создавать BotController и решить все задачи с помощью динамического добавления команд.
Обратите внимание на `FALLBACK_COMMAND`, обработчик будет выполнен в том случае, если не удалось найти нужную
команду. Вместо константы можно просто указать "\*", что также равносильно заданию через константу.

```ts
import { Bot, BotController, FALLBACK_COMMAND, HELP_INTENT_NAME, WELCOME_INTENT_NAME } from 'umbot';
import { fullPlatforms } from 'umbot/plugins';
import { join } from 'node:path';

const bot = new Bot()
    .use(fullPlatforms)
    .setAppConfig({
        json: join(__dirname, 'data'),
        error_log: join(__dirname, 'logs'),
        isLocalStorage: true,
    })
    .addCommand(WELCOME_INTENT_NAME, ['привет'], (_: string, bc: BotController) => {
        bc.text = 'Привет! Я новый навык.';
        bc.buttons.addBtn('Помощь');
    })
    .addCommand(HELP_INTENT_NAME, ['помощь'], (_: string, bc: BotController) => {
        bc.text = 'Я умею отвечать на команды и показывать кнопки';
    })
    .addCommand(FALLBACK_COMMAND, [], (_: string, bc: BotController) => {
        bc.text = bc.userCommand || 'Вы ничего не сказали';
    })
    .start('localhost', 3000);
```

## Основные концепции

### BotController

Базовый класс, предоставляющий доступ к API ответа и состоянию.

#### Работа с текстом

```ts
this.text = 'Ответ пользователю'; // Текст ответа
this.tts = 'Текст для синтеза речи (если отличается от text)'; // TTS версия (опционально)
```

#### Кнопки

```ts
this.buttons
    .addBtn('Простая кнопка')
    .addBtn('Ссылка', 'http://localhost')
    .addBtn('Кнопка с данными', null, {
        action: 'custom',
        value: 123,
    });
```

#### Карточки (изображения)

```ts
this.card.addImage('image.jpg').setTitle('Заголовок').setDescription('Описание');
```

#### Управление состоянием пользователя

```ts
// Для TypeScript, объявите интерфейс и передайте его в BotController
interface IUserState {
    counter?: number;
}
class MyController extends BotController<IUserState> {}

// Внутри controller.userData теперь знает про counter
this.userData.counter = 42;

// Прочитать данные
const counter = this.userData.counter ?? 0;
```

### Обработка команд

#### Через интенты в конфигурации

```ts
bot.setPlatformParams({
    intents: [
        {
            name: 'start_game',
            slots: ['начать игру', 'играть', 'старт'],
        },
    ],
});
```

#### Через прямые команды (Рекомендуемый способ)

```ts
bot.addCommand('greeting', ['привет', 'здравствуй'], (_, controller) => {
    controller.text = 'Здравствуйте!';
});
```

## Лучшие практики

### 1. Структура проекта

```
src/
├── controller/       # Контроллеры с логикой (Если нужно)
├── plugins/          # Дополнительные плагины (Если нужно)
├── utils/            # Вспомогательные функции (Если нужно)
├── config/           # Конфигурация (Если нужно)
└── index.ts          # Точка входа
```

### 2. Типизация пользовательских данных

```ts
interface IGameState {
    score: number;
    level: number;
    lastAction?: string;
}

class GameController extends BotController<IGameState> {
    public action(intentName: string | null): void {
        // Теперь this.userData типизирован как IGameState
        this.userData.score = 100;
    }
}
```

### 3. Обработка ошибок

```ts
try {
    // Ваша асинхронная логика (запрос к API, работа с БД и т.д.)
    const result = await fetchExternalData();
    this.text = `Успешно: ${result}`;
} catch (error) {
    console.error('Ошибка:', error);
    this.text = 'Извините, произошла ошибка';
}
```

### 4. Работа с состоянием

```ts
// Проверка первого запуска
if (!this.userData.initialized) {
    this.userData.initialized = true;
    this.userData.score = 0;
}

// Сброс состояния — мутируйте, а не переприсваивайте
if (intentName === 'restart') {
    Object.keys(this.userData).forEach((key) => delete this.userData[key]);
    this.text = 'Игра начата заново';
}
```

> **Важно:** не делайте `this.userData = {};` — фреймворк хранит ссылку на объект
> и при полном переприсваивании отслеживание изменений может сломаться.
> Вместо этого мутируйте или удаляйте поля по одному.
>
> **Нюанс Алисы:** у локального хранилища Алисы `delete` и `= undefined` **не удаляют поле** —
> при следующем запросе оно вернётся со старым значением. Для удаления поля на Алисе
> присваивайте `null`: `this.userData.tempData = null`.

## Отладка

### 1. Локальное тестирование

```ts
import { BotTest } from 'umbot/test';
import { fullPlatforms } from 'umbot/plugins';

const bot = new BotTest();
bot.use(fullPlatforms);

// Запускает интерактивный режим в консоли: вы вводите фразы, приложение отвечает
bot.test();
```

### 2. Отладка с реальной платформой

`BotTest` проверяет логику без сети. Чтобы увидеть бота в самом мессенджере или в Алисе, есть два пути.

**Telegram, VK и MAX — long polling, без туннеля.** Бот сам запрашивает обновления у платформы, публичный адрес не
нужен. Вместо `bot.start(...)` запустите:

```ts
await bot.startPolling();
```

- Telegram отдаёт обновления через polling, только пока у бота нет вебхука. Для разработки заведите отдельного
  бота у @BotFather. Снять вебхук при старте можно опцией `new TelegramAdapter(token, { telegram_delete_webhook: true })`
  — с токеном production-бота так делать нельзя: он перестанет получать сообщения.
- У VK включите Long Poll API в настройках сообщества («Работа с API» → «Long Poll API») и отметьте нужные типы
  событий. Нужен токен сообщества.
- MAX рекомендует polling для разработки и тестов, а в продакшене — вебхук.

Проверить токены и состояние вебхуков можно командой `npx umbot doctor`.

**Алиса, Маруся, SmartApp и Viber — только вебхук (туннель).** Эти платформы присылают запросы на публичный
HTTPS-адрес, а не на `localhost`, поэтому локальный порт пробрасывается в интернет туннелем. Туннель подойдёт и
мессенджерам, если нужно проверить именно работу вебхука.

> ⚠️ Отлаживайте на отдельном тестовом боте. Регистрация вебхука на туннель перенаправляет туда **все** сообщения
> бота: с токеном production-бота пользователи перестанут получать ответы от сервера.

**1. Запустите приложение** на локальном порту — `npm start` в проекте из CLI или `bot.start('localhost', 3000)`.

**2. Поднимите туннель** на тот же порт (любой из инструментов):

```bash
cloudflared tunnel --url http://localhost:3000
```

```bash
ngrok http 3000
```

Туннель выдаст публичный адрес вида `https://xxxx.trycloudflare.com`.

**3. Зарегистрируйте вебхук на этот адрес.** Для Telegram и MAX — одной командой в папке проекта. Она берёт токен
бота из `.env` (`TELEGRAM_TOKEN` / `MAX_TOKEN`), регистрирует вебхук сразу с секретом и сохраняет секрет в `.env`:

```bash
npx umbot webhook telegram https://xxxx.trycloudflare.com/
```

```bash
npx umbot webhook max https://xxxx.trycloudflare.com/
```

Остальные платформы настраиваются в консоли разработчика: адрес вебхука для Алисы — в Яндекс.Диалогах, для VK —
в настройках Callback API сообщества, для SmartApp — в SmartApp Studio. Viber регистрирует вебхук запросом
`set_webhook` к своему API (`ViberRequest.setWebhook()`).

**4. Перезапустите приложение**, чтобы оно прочитало секрет. Приложение читает `.env`, только если в конфигурации
указан путь к нему — `bot.setAppConfig({ env: './.env' })`. Проекты из `npx umbot create` и `create from-flow` делают
это сами.

Адрес бесплатного туннеля меняется при каждом запуске: повторите шаг 3 с новым адресом. Команда `umbot webhook`
возьмёт уже сохранённый секрет из `.env`, перезапуск приложения не понадобится. После отладки разверните приложение
на сервере с HTTPS и зарегистрируйте вебхук на его адрес (см. «Запуск в production»).

### 3. Логирование

```ts
// В контроллере
console.log('Данные:', this.userData);
console.log('Команда:', this.userCommand);

// В конфигурации
bot.setAppConfig({
    error_log: './logs',
});
bot.setAppMode('dev');
```

## Запуск в production

Для продакшн‑окружения используйте режим `strict_prod`, настройте webhook и **включите проверку подписи вебхука**.

```ts
bot.setAppMode('strict_prod'); // включает строгие проверки безопасности (блокирует ReDoS-регулярки)
bot.start('0.0.0.0', 8080); // запуск HTTP-сервера
```

Если процесс запущен с `NODE_ENV=production`, режим `strict_prod` включается и без `setAppMode()`; явный вызов
`setAppMode()` всегда главнее.

### Проверка подписи вебхука — обязательный шаг

Пока проверка подписи не включена, любой, кто узнает URL вашего вебхука, может отправлять боту
поддельные запросы от имени **любого** пользователя — в том числе обходить авторизацию по `userId`
и читать/перезаписывать чужие данные. URL вебхука утекает легко (логи, реестры доменов), поэтому
секрет нужно задать до первого продакшн-запроса:

```ts
bot.setAppConfig({
    tokens: {
        // Секрет задаётся с двух сторон: при регистрации вебхука у платформы
        // (setWebhook у Telegram, настройки группы VK, подписка MAX) и здесь.
        telegram: { webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET },
        vk: { secret_key: process.env.VK_SECRET_KEY },
        max_app: { webhookSecret: process.env.MAX_WEBHOOK_SECRET },
        // Viber проверяет подпись автоматически по самому токену бота — ничего дополнительно задавать не нужно.
    },
});
```

Переменные `TELEGRAM_WEBHOOK_SECRET`, `MAX_WEBHOOK_SECRET` и `VK_SECRET_KEY` фреймворк подхватывает сам — из
окружения процесса или из `.env`, если он подключён через `env: './.env'`. Блок выше нужен, только если секреты
хранятся иначе. Для Telegram и MAX секрет удобнее создать CLI: команда регистрирует вебхук сразу с секретом и
записывает его в `.env`:

```bash
npx umbot webhook telegram https://ваш-домен/webhook
```

```bash
npx umbot webhook max https://ваш-домен/webhook
```

Если приложение получает переменные из окружения (Docker, serverless), перенесите туда и секрет из `.env`.

Что за что отвечает каждая платформа и как сгенерировать секрет — в
[configuration.md → Проверка подписи вебхука](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/configuration#проверка-подписи-вебхука-обязательно-для-production).
У Алисы, SmartApp и Маруси подписи вебхука нет в принципе (ограничение платформ): не считайте
`userId` этих платформ аутентифицированной идентичностью.

## Чеклист перед запуском

Убедитесь, что всё выполнено:

- [ ] **Режим `strict_prod`** — включен через `bot.setAppMode('strict_prod')`
- [ ] **Проверка подписи вебхука включена** — задан `webhookSecret` (Telegram/MAX) или `secret_key` (VK); при старте в логе нет предупреждения «БЕЗ проверки подписи». Для Алисы/SmartApp/Маруси подписи нет — продумайте собственную верификацию чувствительных действий
- [ ] **intents настроены** — при необходимости `bot.setPlatformParams({ intents: [...] })`. Учтите: переданный массив **заменяет** встроенные интенты `welcome`/`help`, поэтому либо добавьте их в свой список, либо задайте собственные слоты для приветствия и помощи
- [ ] **Токены в .env** — не в коде, не в git. Проверьте `.gitignore`
- [ ] **MongoAdapter вместо FileAdapter** — FileAdapter держит всю таблицу в памяти (риск OOM на больших данных) и рассчитан на один процесс, поэтому не подходит для production
- [ ] **Preload для медиа** — все изображения и звуки предзагружены (первая загрузка медиа занимает 200–1000 мс на файл и может съесть бюджет ответа голосовой платформы)
- [ ] **rateLimiter подключен** — `bot.use(rateLimiter())` для защиты от превышения лимитов платформ
- [ ] **error_log настроен** — `bot.setAppConfig({ error_log: './logs' })`
- [ ] **HTTPS настроен** — платформы присылают вебхук на публичный HTTPS-адрес (Telegram — порты 443, 80, 88 или 8443, MAX — только 443)
- [ ] **Webhook URL зарегистрирован** — для Telegram и MAX через `npx umbot webhook`, для остальных — в консоли разработчика платформы
- [ ] **`npx umbot doctor` без ошибок** — токены рабочие, вебхуки зарегистрированы, у Telegram нет накопившихся ошибок доставки, `.env` в `.gitignore`

## Типичные ошибки

### Команда не срабатывает

**Причина:** Регистр. `controller.userCommand` автоматически приводится к нижнему регистру.

```ts
// ❌ Неправильно — слот с заглавной буквы
bot.addCommand('greet', ['Привет'], (_, bc) => {
    bc.text = 'Привет!';
});

// ✅ Правильно — слот в нижнем регистре
bot.addCommand('greet', ['привет'], (_, bc) => {
    bc.text = 'Привет!';
});
```

### Бот отвечает стандартным текстом на приветствие

**Причина:** Не задан свой `welcome_text` в `setPlatformParams` — фреймворк отвечает placeholder-текстом по умолчанию.

```ts
// ❌ Не настроено — ответит стандартным текстом приветствия
bot.setPlatformParams({ intents: [] });

// ✅ Правильно — свой текст приветствия
bot.setPlatformParams({
    welcome_text: 'Привет! Я могу помочь.',
    intents: [],
});
```

### TypeScript ошибка "'bc.userData.score' is of type 'unknown'"

**Причина:** `userData` без дженерика типизирован как `IUserData` с индексной сигнатурой `[key: string]: unknown` —
запись любого поля разрешена, но чтение в арифметике (`+= 10`) уже нет: значение имеет тип `unknown`.

```ts
// ❌ Неправильно — TypeScript не знает про score
bot.addCommand('play', ['играть'], (_, bc) => {
    bc.userData.score += 10; // Ошибка!
});

// ✅ Правильно — аннотируем тип
bot.addCommand('play', ['играть'], (_, bc: BotController<MyData>) => {
    bc.userData.score += 10; // OK
});
```

### Данные не сохраняются между запросами

**Причина:** Не подключен DB-adapter и `isLocalStorage: false`.

```ts
import { MongoAdapter } from 'umbot/plugins';

// ❌ Неправильно — данные теряются
bot.setAppConfig({ isLocalStorage: false });

// ✅ Вариант 1: локальное хранилище (для голосовых платформ)
bot.setAppConfig({ isLocalStorage: true });

// ✅ Вариант 2: БД (для чат-ботов)
bot.use(new MongoAdapter({ host: '...', database: '...' }));
bot.setAppConfig({ isLocalStorage: false });
```

### Пустой ответ вместо "Не поняла"

**Причина:** Используете `BotController` вместо `BaseBotController`. Автоматическая установка `empty_text` работает только через `BaseBotController`. Если вы наследуетесь от `BotController` напрямую, задайте `this.text` в `action()`. Адаптеры не придумывают ответ: Алиса и Маруся сохранят пустые поля и запишут предупреждение, а чат-платформы не станут отправлять недопустимое пустое сообщение.

Подробнее об этом механизме — в разделе [«Порядок диспетчера»](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/GUIDE#порядок-диспетчера) в GUIDE.md.

```ts
// Решение: вручную обрабатывайте default-case в action()
public action(intentName: string | null): void {
    switch (intentName) {
        case WELCOME_INTENT_NAME:
            this.text = 'Привет!';
            break;
        default:
            if (!this.text) this.text = 'Не поняла. Скажите "помощь".';
    }
}
```

## 🔐 Безопасность и защита от ReDoS

При использовании регулярных выражений в командах (`addCommand(..., isPattern: true)`) или интентах, фреймворк проверяет их на потенциальные ReDoS‑уязвимости.

⚠️ **По умолчанию (`appMode: 'dev'`) небезопасные RegExp всё равно регистрируются!**  
Это сделано для гибкости в разработке, но порой **недопустимо в production**.

✅ **Рекомендация для production включить строгую проверку**:

```ts
const bot = new Bot();
bot.setAppMode('strict_prod'); // ← обязательно включите!
```

При `setAppMode('strict_prod')` любая потенциально опасная RegExp будет отклонена при регистрации, а попытка её использовать вызовет ошибку в логах. Проверка выполняется в момент регистрации (`addCommand`, `setPlatformParams`), поэтому режим задавайте **сразу после создания `Bot`** — выражения, зарегистрированные раньше, повторно не проверяются.

⚠️ Если вы используете slots с RegExp, убедитесь, что ваши выражения:

- не содержат вложенных квантификаторов ((a+)+);
- не содержат альтернатив с пересечением под повтором ((a|aa)+);
- ограничены по длине ({1,10} вместо \*).

## Часто задаваемые вопросы

### Как добавить поддержку новой платформы?

Достаточно создать адаптер для нужной платформы согласно [документации по созданию адаптера платформы](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/adapter/platformAdapter) и после подключить его к приложению.
Если все сделано верно, то при получении запроса от новой платформы, фреймворк корректно отработает запрос, и вернет
данные в нужном для платформы виде.

### Как добавить ключи таким образом, чтобы можно было загрузить код в репозиторий?

Достаточно сохранить чувствительные данные в .env файл, передав путь к нему:

```ts
bot.setAppConfig({
    env: './.env', // путь до файла
});
```

Пример содержимого .env файла:

```text
TELEGRAM_TOKEN=your-telegram-token
VK_TOKEN=your-vk-token
VK_CONFIRMATION_TOKEN=your-vk-confirmation-token
VIBER_TOKEN=your-viber-token
ALISA_TOKEN=your-alisa-token
MARUSIA_TOKEN=your-marusia-token
MAX_TOKEN=your-max-token
SMARTAPP_TOKEN=your-smartapp-token

# Секреты вебхука: включают проверку подписи. TELEGRAM_WEBHOOK_SECRET и MAX_WEBHOOK_SECRET
# записывает команда `npx umbot webhook`, VK_SECRET_KEY — из настроек Callback API сообщества.
TELEGRAM_WEBHOOK_SECRET=
MAX_WEBHOOK_SECRET=
VK_SECRET_KEY=

# Yandex SpeechKit — TTS для чат-платформ (Telegram/VK/Max);
# значение автоматически записывается в speech_kit_token всех трёх платформ.
# Рекомендуется API-ключ сервисного аккаунта (уходит как `Api-Key`); IAM-токен `t1.…`
# тоже принимается (уходит как `Bearer`), но живёт не больше 12 часов.
SPEECH_KIT_TOKEN=your-speechkit-api-key

# Подключение к MongoDB: host — полная connection string с протоколом
DB_HOST=mongodb://localhost:27017
DB_USER=user
DB_PASSWORD=password
DB_NAME=bot_db
```

> `YANDEX_TOKEN` для Алисы устарел и сохранён только для обратной совместимости — используйте `ALISA_TOKEN` (при обоих заданных приоритет у него). `SMARTAPP_TOKEN` нужна только для SmartApp (Сбер); при работе без этой платформы её можно не задавать.

> ⚠️ **Не коммитьте `.env` в git!** Он уже добавлен в шаблонный `.gitignore` при генерации через CLI,
> но если создаёте файл вручную — проверьте, что он в исключениях.

Если все необходимые токены лежат в `process.env`, то можно в свойство `env` передать значение `local`.

```ts
bot.setAppConfig({
    env: 'local', // Получить данные из process.env
});
```

### Как сохранять данные между сессиями?

Данные в `this.userData` автоматически сохраняются между сессиями. Выберите способ хранения через параметр
`isLocalStorage`:

```ts
bot.setAppConfig({
    isLocalStorage: true, // Данные хранятся в локальном хранилище платформы (поддерживается голосовыми платформами)
    // или
    isLocalStorage: false, // данные хранятся в вашей БД (подключите адаптер: MongoAdapter и т.п.)
});
```

> У чат-платформ (Telegram, VK, Max, Viber) локального хранилища нет: при
> `isLocalStorage: true` без подключённого БД-адаптера их данные не сохранятся.

### Как добавить кнопки быстрых ответов?

```ts
this.buttons.addBtn('Да').addBtn('Нет').addBtn('Не знаю');
```

### Как работать с изображениями?

```ts
this.card
    .addImage('image1.jpg', 'Заголовок 1', 'Описание 1')
    .addImage('image2.jpg', 'Заголовок 2', 'Описание 2')
    .setTitle('Галерея изображений');
```

Больше вопросов и ответов можно найти в [разделе FAQ](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/FAQ).
