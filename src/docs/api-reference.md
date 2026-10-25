# Справочник API umbot

Данный справочник содержит описание основных публичных классов, методов и интерфейсов фреймворка umbot. Для начала
работы смотрите раздел [«Быстрый старт»](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/getting-started).

## Основные классы

### BotController

Основной класс для управления логикой приложения. Предоставляет базовый функционал для обработки пользовательских запросов,
управления состоянием и взаимодействия с различными платформами.

#### Свойства

| Свойство            | Тип                                                      | Описание                                                                                                                                                       |
| ------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| text                | string                                                   | Текст ответа пользователю                                                                                                                                      |
| tts                 | string \| null                                           | Текст для озвучки (на голосовых платформах, если `null` — может быть автоматически подставлен из `text`)                                                       |
| buttons             | Buttons                                                  | Компонент кнопок (инициализируется лениво через getter)                                                                                                        |
| card                | Card                                                     | Компонент карточек/галерей (инициализируется лениво через getter)                                                                                              |
| nlu                 | Nlu                                                      | Данные NLU (инициализируется лениво через getter)                                                                                                              |
| sound               | Sound                                                    | Звуковые эффекты (инициализируется лениво через getter)                                                                                                        |
| userId              | string \| number \| null                                 | Идентификатор пользователя                                                                                                                                     |
| userToken           | string \| null                                           | Токен авторизации пользователя (если платформа его предоставляет)                                                                                              |
| userMeta            | unknown \| null                                          | Доп. информация о пользователе (зависит от платформы)                                                                                                          |
| messageId           | number \| string \| null                                 | Номер сообщения. `0` — начало новой сессии на голосовых платформах (по нему подставляется welcome)                                                             |
| userCommand         | string \| null                                           | Команда пользователя в нижнем регистре                                                                                                                         |
| originalUserCommand | string \| null                                           | Оригинальная команда пользователя                                                                                                                              |
| payload             | Record\<string, unknown\> \| string \| null \| undefined | Дополнительные параметры запроса (payload)                                                                                                                     |
| eventType           | TEventType                                               | Универсальный тип события (`'message'`, `'photo'`, `'callback'`, `'start'`, …). Заполняется адаптером платформы; основа роутинга `bot.addEvent`                |
| match               | RegExpExecArray \| null                                  | Совпадение команды с регуляркой (лениво): группы в `match[1]`, `match.groups`. `null` для строковых команд                                                     |
| api                 | IControllerApi \| null                                   | API-фасад активной платформы: `sendPhoto/sendDocument/sendAudio/sendVideo/answerCallback/can`. Ленивый объект; `null` на голосовых платформах                  |
| userData            | TUserData                                                | Данные пользователя (БД или локальное хранилище, в зависимости от `setAppConfig`)                                                                              |
| state               | TPlatformState \| null                                   | Локальное хранилище платформы (если платформа поддерживает и включено `isLocalStorage`)                                                                        |
| isAuth              | boolean                                                  | Запросить авторизацию пользователя (account linking; Алиса)                                                                                                    |
| userEvents          | IUserEvent \| null                                       | События пользователя (авторизация/оценка), если платформа присылает                                                                                            |
| isScreen            | boolean                                                  | Есть ли экран у пользователя (если платформа сообщает)                                                                                                         |
| isEnd               | boolean                                                  | Завершить сессию. Читают голосовые платформы; чат-платформы флаг игнорируют                                                                                    |
| skipAutoReply       | boolean                                                  | Если `true`, фреймворк не будет пытаться “авто-отправить” ответ (актуально для платформ, где вы сами отправляете сообщения через API)                          |
| requestObject       | Record<string, unknown> \| string \| unknown \| null     | Оригинальный объект запроса от платформы                                                                                                                       |
| thisIntentName      | string \| null                                           | Имя шага/интента, которое нужно сохранить как “следующий шаг”                                                                                                  |
| oldIntentName       | string \| null                                           | Имя предыдущего шага/интента (из `userData.oldIntentName` или из `state.oldIntentName`)                                                                        |
| emotion             | string \| null                                           | Эмоция ответа ассистента (SmartApp: `'radost'`, `'pechal'`, …)                                                                                                 |
| appeal              | 'official' \| 'no_official' \| null                      | Стиль обращения (SmartApp; приходит в запросе)                                                                                                                 |
| isSendRating        | boolean                                                  | Запросить оценку навыка (специальный ответ уходит только на SmartApp)                                                                                          |
| appContext          | AppContext                                               | Контекст приложения (конфиг, реестры, логгер)                                                                                                                  |
| appType             | TAppType \| null                                         | Платформа, от которой получен запрос (заполняется фреймворком при обработке)                                                                                   |
| platformOptions     | IPlatformOptions                                         | Служебные данные запроса от адаптера, ядра и middleware: `clientIp`, `requestId`, `rateLimitOverflow` и др. Читайте; пишите только в своём адаптере/middleware |

#### Методы

| Метод          | Параметры                                                         | Возвращаемое значение   | Описание                                                                                                                         |
| -------------- | ----------------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| action         | intentName: string \| null, isCommand?: boolean, isStep?: boolean | void \| Promise\<void\> | Ваш основной обработчик. Вызывается фреймворком (переопределяется в наследнике); может быть `async` — фреймворк дождётся промиса |
| run            | -                                                                 | void \| Promise<void>   | Запуск обработки запроса (вызывается фреймворком; вручную обычно не вызывают)                                                    |
| setAppContext  | appContext: AppContext                                            | this                    | Установка контекста приложения (обновляет контекст в уже созданных компонентах `buttons` и `card`)                               |
| clearStoreData | -                                                                 | void                    | Полный сброс состояния контроллера: текст, tts, пользовательские данные, флаги и кэш NLU                                         |
| isButtonsInit  | -                                                                 | boolean                 | `true`, если компонент кнопок был инициализирован (через getter `buttons`)                                                       |
| isCardInit     | -                                                                 | boolean                 | `true`, если компонент карточек был инициализирован (через getter `card`)                                                        |
| isSoundInit    | -                                                                 | boolean                 | `true`, если компонент звуков был инициализирован (через getter `sound`)                                                         |
| isNluInit      | -                                                                 | boolean                 | `true`, если компонент NLU был инициализирован (через getter `nlu`)                                                              |

### Bot

Основной класс-оркестратор. Управляет жизненным циклом, middleware, регистрацией команд и запуском сервера.

```ts
class Bot<
    TUserData extends IUserData = IUserData,
    TPlatformState extends IPlatformData = IPlatformData,
> {
    constructor(type?: TAppType, botController?: TBotControllerClass<TUserData, TPlatformState>);
}
```

`type` — платформа по умолчанию (обычно не нужна: платформа определяется по запросу), `botController` — класс
контроллера (то же, что `initBotController`). Все методы, кроме перечисленных ниже с другим возвращаемым значением,
возвращают `this` — вызовы можно объединять в цепочку.

#### Методы

| Метод                    | Параметры                                                                                                                                                                | Возвращаемое значение          | Описание                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| setAppConfig             | config: Partial\<IAppConfig\>                                                                                                                                            | Bot                            | Установка конфигурации приложения                                                                                                                                                                       |
| setAppMode               | mode: TAppMode (`'dev' \| 'prod' \| 'strict_prod'`)                                                                                                                      | Bot                            | Установка режима работы                                                                                                                                                                                 |
| setPlatformParams        | params: IAppParam                                                                                                                                                        | Bot                            | Установка параметров платформы                                                                                                                                                                          |
| initBotController        | controller: TBotControllerClass                                                                                                                                          | Bot                            | Подключение класса контроллера                                                                                                                                                                          |
| addCommand               | commandName: string, slots: TSlots, cb: (userCommand: string, bc: BotController) => void \| string \| Promise\<void \| string\>, isPattern?: boolean                     | Bot                            | Регистрация команды                                                                                                                                                                                     |
| addAction                | actionName: string, cb: (userCommand: string, bc: BotController) => void \| string \| Promise\<void \| string\>                                                          | Bot                            | Обработчик нажатия кнопки с payload `name` (`'buy'`, `{"action":"buy"}`, `{"command":"buy"}`) и текста, равного имени. На подстроку не срабатывает                                                      |
| defineAction             | actionName: string                                                                                                                                                       | IButtonAction\<TData\>         | Действие кнопки с данными: `addBtn(buttons, title, data)` создаёт кнопку, `handle((data, ctx) => ...)` получает разобранные данные                                                                      |
| defineMenu               | menuName: string, options: IMenuOptions                                                                                                                                  | IMenu                          | Меню из экранов: кнопки-переходы, «Назад», переход по нажатию и по названию кнопки; `menu.show(ctx, screen?)`                                                                                           |
| addEvent                 | eventType: TEventType, cb: (bc: BotController) => void \| string \| Promise\<void \| string\> \| false                                                                   | Bot                            | Обработчик события платформы (фото, голосовое, callback, start и др.). Вызывается до шагов и команд; `false` — передать запрос обычному конвейеру                                                       |
| removeEvent              | eventType: TEventType                                                                                                                                                    | Bot                            | Удаление всех обработчиков события                                                                                                                                                                      |
| clearEvents              | -                                                                                                                                                                        | Bot                            | Удаление всех событийных обработчиков                                                                                                                                                                   |
| removeCommand            | commandName: string                                                                                                                                                      | Bot                            | Удаление команды по имени                                                                                                                                                                               |
| clearCommands            | -                                                                                                                                                                        | Bot                            | Удаление всех команд                                                                                                                                                                                    |
| addStep                  | stepName: string, handler: IStepParam['cb']                                                                                                                              | Bot                            | Регистрация шага (цепочки диалога)                                                                                                                                                                      |
| removeStep               | stepName: string                                                                                                                                                         | Bot                            | Удаление шага по имени                                                                                                                                                                                  |
| clearSteps               | -                                                                                                                                                                        | Bot                            | Удаление всех шагов                                                                                                                                                                                     |
| addForm                  | formName: string, options: IAddFormOptions                                                                                                                               | Bot                            | Регистрация многошаговой формы: варианты-кнопки, пропуск, проверка и преобразование ответа, выход по чужой кнопке                                                                                       |
| startForm                | ctx: BotController, formName: string, context?: TFormContext                                                                                                             | boolean                        | Запуск формы: первый вопрос с кнопками; `context` доступен в `prompt` и `onComplete`                                                                                                                    |
| removeForm               | formName: string                                                                                                                                                         | Bot                            | Удаление формы и всех её шагов                                                                                                                                                                          |
| use                      | fn: MiddlewareFn \| platform: TAppType, fn: MiddlewareFn \| plugin: TPlugin                                                                                              | Bot                            | Подключение middleware или плагина                                                                                                                                                                      |
| clearUse                 | -                                                                                                                                                                        | Bot                            | Удаление всех платформ, плагинов и middleware                                                                                                                                                           |
| setCustomCommandResolver | resolver: TCommandResolver                                                                                                                                               | Bot                            | Установка кастомного резолвера команд                                                                                                                                                                   |
| setCommandGroupMode      | mode: TCommandGroupMode                                                                                                                                                  | Bot                            | Режим группировки RegExp                                                                                                                                                                                |
| setPlatformResolver      | resolver: TPlatformResolver                                                                                                                                              | Bot                            | Установка функции определения платформы                                                                                                                                                                 |
| setLogger                | logger: ILogger \| null                                                                                                                                                  | Bot                            | Установка кастомного логгера (null — отключить)                                                                                                                                                         |
| getAppContext            | -                                                                                                                                                                        | AppContext                     | Получение контекста приложения                                                                                                                                                                          |
| setContent               | content: TBotContent (`object \| string \| null`)                                                                                                                        | void                           | Установка содержимого запроса (для тестирования)                                                                                                                                                        |
| run                      | appType?: TAppType \| null, content?: string \| object \| null, auth?: TBotAuth, clientIp?: string                                                                       | Promise\<TRunResult\>          | Обработка входящего запроса. Все параметры имеют дефолты (`null`), т.е. вызов без аргументов валиден. `clientIp` доступен middleware через `controller.platformOptions.clientIp` (например, `ipFilter`) |
| webhookHandle            | req: IncomingMessage, res: ServerResponse, responseCb?: TBotResponseCb                                                                                                   | Promise\<void\>                | Обработчик HTTP-запроса (для Express/Fastify интеграции)                                                                                                                                                |
| webhookEvent             | data: string \| object \| null, headers?: Record\<string, unknown\>, clientIp?: string                                                                                   | Promise\<IWebhookEventResult\> | Обработка события serverless-платформы (Yandex Cloud Functions, AWS Lambda) с проверкой подписи вебхука. Возвращает `{ statusCode, body }` для возврата из cloud-функции                                |
| start                    | hostname?: string, port?: number, responseCb?: TBotResponseCb                                                                                                            | Server                         | Запуск HTTP-сервера (возвращает экземпляр Server)                                                                                                                                                       |
| startPolling             | options?: IPollingOptions (`{ platforms?: TAppType[] }`)                                                                                                                 | Promise\<void\>                | Запуск long polling (Telegram, VK, MAX) вместо вебхука. Промис выполняется после остановки; отклоняется, если ни один адаптер не поддерживает polling                                                   |
| stopPolling              | -                                                                                                                                                                        | Promise\<void\>                | Остановка long polling: обрывает текущие запросы обновлений и ждёт обработки уже полученных                                                                                                             |
| connect                  | -                                                                                                                                                                        | Promise\<boolean\>             | Подключение к БД и `ensureSchema()` без входящего запроса (cron, скрипты); после него `close()` закрывает БД                                                                                            |
| close                    | -                                                                                                                                                                        | Promise\<void\>                | Остановка HTTP-сервера и long polling, очистка ресурсов                                                                                                                                                 |
| send                     | userId: string \| number, controllerOrText: BotController \| string \| ISendMessage, platform: TAppType                                                                  | Promise\<unknown \| boolean\>  | Отправка сообщения пользователю первым (Telegram, VK, MAX, Viber). `false` — не доставлено (ошибка API, сеть, таймаут) или платформа без рассылок; иначе `'ok'`                                         |
| broadcast                | userIds: (string \| number)[], message: string \| ISendMessage \| ((userId) => BotController \| string \| ISendMessage), platform: TAppType, options?: IBroadcastOptions | Promise\<IBroadcastResult\>    | Рассылка многим получателям с лимитом платформы; `{ sent, failed }` и `onResult(userId, ok)` по каждому                                                                                                 |

#### Сообщения вне ответа: `send`, `broadcast`, `connect`

Ответ на входящее сообщение — это `ctx.text`/`ctx.buttons` в обработчике. Написать пользователю **первым**
(уведомление сопернику, напоминание, рассылка) можно только на чат-платформах — Telegram, VK, MAX, Viber; Алиса,
Маруся и SmartApp сообщения без запроса не принимают, и `send` для них возвращает `false`.

```ts
// Сообщение для send/broadcast без сборки контроллера
interface ISendMessage {
    text: string;
    tts?: string;
    buttons?: (string | ISendButton)[]; // строка — обычная кнопка с этим текстом
}

interface ISendButton {
    title: string;
    url?: string;
    payload?: TButtonPayload; // например, action.payload(data) из defineAction
    options?: IButtonOptions;
}

interface IBroadcastOptions {
    // после каждой отправки: прогресс, отметка в БД; ошибка в нём не прерывает рассылку
    onResult?: (userId: string | number, ok: boolean) => void | Promise<void>;
}

interface IBroadcastResult {
    sent: (string | number)[]; // доставлено
    failed: (string | number)[]; // не доставлено: заблокировал бота, неверный id, сбой сети
}
```

```ts
import { T_TELEGRAM } from 'umbot/plugins';

// Одному пользователю — из обработчика другого пользователя или из скрипта
const ok = await bot.send(opponentId, { text: 'Ваш ход', buttons: ['Сдаться'] }, T_TELEGRAM);
if (ok === false) {
    // не доставлено — например, соперник заблокировал бота
}

// Многим — с лимитом платформы (Telegram 30 сообщений/с, VK 20, MAX 30)
const { sent, failed } = await bot.broadcast(userIds, 'Вышел новый выпуск', T_TELEGRAM);
```

- `userId` — тот же id, что `ctx.userId` в обработчиках этой платформы (храните его вместе с платформой).
- Карточки и звуки отправляются контроллером: `bot.send(userId, controller, platform)` или фабрикой в `broadcast`.
- Вне HTTP-сервера (задача cron, скрипт) сначала вызовите `await bot.connect()`, если нужна БД, и в конце
  `await bot.close()`. Готовый скрипт — в рецептах, «Рассылка по расписанию»; где запускать такие задачи — в
  [Развертывании](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/deployment#фоновые-задачи-cron-таймеры-рассылки).

Подробности о доставке, лимитах и очереди отправки — в
[Интеграции с платформами](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/platform-integration#активные-рассылки-метод-send).

#### Минимальный набор для запуска

```ts
import { Bot } from 'umbot';
import { fullPlatforms, FileAdapter } from 'umbot/plugins';

const bot = new Bot();
bot.setAppMode('strict_prod'); // 0. Режим продакшена — до регистрации команд и параметров
bot.use(fullPlatforms); // 1. Зарегистрировать платформы
bot.use(new FileAdapter()); // 2. Зарегистрировать БД (или isLocalStorage: true)
bot.setAppConfig({
    // 3. Передать конфиг
    json: './data',
    error_log: './errors',
    isLocalStorage: false,
});
bot.setPlatformParams({
    intents: [{ name: 'bye', slots: ['пока'] }], // обязательное поле (можно [])
    welcome_text: 'Привет!',
});
bot.start('0.0.0.0', 3000); // 4. Запустить
```

> Контроллер (`initBotController`) и команды (`addCommand`) — **необязательны** для запуска. Без них бот будет отвечать
> только `welcome_text` / `help_text` / `empty_text`. Это удобно для самого первого старта — убедиться, что вебхук
> работает, а потом постепенно добавлять логику.

#### Упрощённый запуск: `run()` из `umbot/build`

Если хочется ещё короче — есть утилита `run`:

```ts
import { run } from 'umbot/build'; // TMode = 'dev' | 'dev-online' | 'prod'
import { fullPlatforms, FileAdapter } from 'umbot/plugins';
import { MyController } from './controller/MyController';

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

Если `plugins` не передан, `run` подключает все платформы (`fullPlatforms`) и адаптер БД: `MongoAdapter`, когда
задан адрес базы (`appConfig.db.host` или `DB_HOST`), иначе `FileAdapter`.

## Компоненты

### Buttons

Компонент для работы с кнопками интерфейса.

#### Методы

| Метод         | Параметры                                                                                       | Возвращаемое значение | Описание                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| addBtn        | title: string \| null, url?: string \| null, payload?: TButtonPayload, options?: IButtonOptions | this                  | Добавление кнопки                                                                                                                                                                                     |
| addLink       | title: string \| null, url?: string, payload?: TButtonPayload, options?: IButtonOptions         | this                  | Добавление кнопки-ссылки                                                                                                                                                                              |
| row           | -                                                                                               | this                  | Завершает ряд: следующие кнопки пойдут в новую строку (Telegram, VK, MAX, Viber). Кнопки до первого вызова — первый ряд; без вызова каждая кнопка — отдельной строкой                                 |
| getButtons    | buttonProcessing: TButtonProcessing                                                             | T \| null             | Получение массива кнопок, адаптированного под платформу                                                                                                                                               |
| getButtonJson | buttonProcessing: TButtonProcessing                                                             | string \| null        | JSON-представление кнопок для платформы                                                                                                                                                               |
| clear         | -                                                                                               | void                  | Очистка всех кнопок (начать список заново; уже показанная клавиатура не снимается)                                                                                                                    |
| remove        | -                                                                                               | this                  | Просит платформу убрать ранее показанную клавиатуру. Актуально для Telegram (reply-клавиатура) и VK, где клавиатура «прилипает» к диалогу; на остальных платформах вызов безопасен и ничего не меняет |
| isRemove      | -                                                                                               | boolean               | (getter) `true`, если вызван `remove()` и клавиатуру нужно убрать                                                                                                                                     |

### Card

Компонент для работы с карточками и галереями.

#### Методы

| Метод          | Параметры                                                                      | Возвращаемое значение | Описание                                                         |
| -------------- | ------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------- |
| addImage       | image: string \| null, title?: string, desc?: string, button?: TButton \| null | this                  | Добавление изображения/элемента (4-й параметр — кнопка элемента) |
| addOneImage    | image: string \| null, title?: string, desc?: string, button?: TButton \| null | this                  | Заменяет текущую карточку одним изображением                     |
| setTitle       | text: string                                                                   | this                  | Установка заголовка (перезаписывает предыдущий)                  |
| setDescription | text: string                                                                   | this                  | Установка описания (перезаписывает предыдущее)                   |
| addButton      | button: TButton                                                                | this                  | Добавление кнопки к элементу карточки                            |
| clear          | -                                                                              | void                  | Очистка карточки: изображения, заголовок, описание и template    |

### Sound

Компонент для работы со звуками. Поддерживает стандартные звуки платформ (Алиса, Маруся) и пользовательские аудиофайлы.

#### Свойства

| Свойство            | Тип      | Описание                                                      |
| ------------------- | -------- | ------------------------------------------------------------- |
| sounds              | ISound[] | Массив пользовательских звуков                                |
| isUsedStandardSound | boolean  | Использовать стандартные звуки платформы (по умолчанию: true) |

#### Методы

| Метод     | Параметры                                                                                     | Возвращаемое значение | Описание                                              |
| --------- | --------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------- |
| getSounds | text: string \| null, soundProcessing: TSoundProcessing\<TResult\>, controller: BotController | Promise\<TResult\>    | Получение текста со встроенными звуками для платформы |

### Nlu

Компонент для работы с сущностями, которые платформа (или плагин) извлекла из текста пользователя.
Доступен в контроллере через `this.nlu` (инициализируется лениво). Данные заполняются адаптером
платформы из запроса (например, Алиса присылает их в `request.nlu`); если платформа NLU не
предоставляет, данные можно заполнить вручную через `setNlu()`.

Все методы извлечения сущностей возвращают объект единой формы:

```ts
interface INluResult<T = object> {
    status: boolean; // найдено ли хотя бы одно значение
    result: T | null; // найденные значения (null, если ничего не найдено)
}
```

#### Константы типов сущностей

| Константа              | Значение            | Описание        |
| ---------------------- | ------------------- | --------------- |
| `Nlu.T_FIO`            | `'YANDEX.FIO'`      | ФИО             |
| `Nlu.T_GEO`            | `'YANDEX.GEO'`      | Геолокация      |
| `Nlu.T_DATETIME`       | `'YANDEX.DATETIME'` | Дата и время    |
| `Nlu.T_NUMBER`         | `'YANDEX.NUMBER'`   | Число           |
| `Nlu.T_INTENT_CONFIRM` | `'YANDEX.CONFIRM'`  | Интент согласия |
| `Nlu.T_INTENT_REJECT`  | `'YANDEX.REJECT'`   | Интент отказа   |
| `Nlu.T_INTENT_HELP`    | `'YANDEX.HELP'`     | Интент помощи   |
| `Nlu.T_INTENT_REPEAT`  | `'YANDEX.REPEAT'`   | Интент повтора  |

#### Методы

| Метод           | Параметры                         | Возвращаемое значение        | Описание                                                                                                                          |
| --------------- | --------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| getFio          | -                                 | INluResult\<INluFIO[]\>      | ФИО из текста (`first_name`, `last_name`, `patronymic_name`)                                                                      |
| getGeo          | -                                 | INluResult\<INluGeo[]\>      | Геолокация (`country`, `city`, `street`, `house_number`, `airport` и др.)                                                         |
| getDateTime     | -                                 | INluResult\<INluDateTime[]\> | Дата и время (`year`, `month`, `day`, `hour`, `minute` + флаги `*_is_relative`)                                                   |
| getNumber       | -                                 | INluResult\<number[]\>       | Числа из текста                                                                                                                   |
| getUserName     | -                                 | INluThisUser \| null         | Информация о текущем пользователе (`first_name`, `last_name`, `username`), если платформа её прислала                             |
| isIntentConfirm | userCommand?: string              | boolean                      | Проверка интента согласия; если интента нет и передан текст — дополнительная проверка по словам согласия («да», «конечно» и т.п.) |
| isIntentReject  | userCommand?: string              | boolean                      | Проверка интента отказа; аналогичная запасная проверка по словам отказа («нет», «не хочу» и т.п.)                                 |
| isIntentHelp    | -                                 | boolean                      | Проверка интента помощи                                                                                                           |
| isIntentRepeat  | -                                 | boolean                      | Проверка интента повтора                                                                                                          |
| getIntents      | -                                 | INluIntents \| null          | Все интенты запроса                                                                                                               |
| getIntent       | intentName: string                | INluIntent \| null           | Конкретный интент по имени (например, `'YANDEX.CONFIRM'`)                                                                         |
| getNluValue     | -                                 | INlu                         | Сырой объект NLU                                                                                                                  |
| setNlu          | nlu: INlu, isClearCache?: boolean | void                         | Установка данных NLU; `isClearCache: true` сбрасывает кэш извлечённых сущностей                                                   |

#### Статические методы

Работают с произвольным текстом и не требуют данных от платформы:

| Метод        | Параметры     | Возвращаемое значение          | Описание                      |
| ------------ | ------------- | ------------------------------ | ----------------------------- |
| Nlu.getLink  | query: string | INluResult\<string[] \| null\> | Извлечение ссылок из текста   |
| Nlu.getPhone | query: string | INluResult\<string[] \| null\> | Извлечение телефонных номеров |
| Nlu.getEMail | query: string | INluResult\<string[] \| null\> | Извлечение email-адресов      |

```ts
const fio = this.nlu.getFio();
if (fio.status) {
    this.text = `Приятно познакомиться, ${fio.result?.[0]?.first_name}!`;
}

// Статические методы — для текста без данных платформы
const phones = Nlu.getPhone(this.userCommand || '');
if (phones.status) {
    this.userData.phone = phones.result?.[0];
}
```

## Интерфейсы

### IAppConfig

Конфигурация приложения.

```ts
interface IAppConfig {
    error_log?: string; // Путь к директории логов
    json?: string; // Путь к директории JSON
    db?: IAppDB; // Конфигурация базы данных
    isLocalStorage?: boolean; // Использование локального хранилища
    memorySession?: IMemorySessionConfig | false; // Сессия userData в памяти процесса (платформы без localStorage, без БД)
    env?: string; // Путь к .env файлу или 'local' для process.env
    tokens?: ITokenPlatform; // Токены платформ (telegram, vk и др.)
    dbTables?: readonly IDbTableSchema[]; // Таблицы своих моделей: создаются ensureSchema() после подключения к БД
}
```

### IAppParam

Параметры приложения.

```ts
interface IAppParam {
    isAuthUser?: boolean; // Требуется ли авторизация пользователя
    welcome_text?: string | string[]; // Текст приветствия
    help_text?: string | string[]; // Текст помощи
    empty_text?: string | string[]; // Текст при отсутствии подходящих команд
    intents: IAppIntent[] | null; // Массив интентов
    utm_text?: string | null; // UTM-метка для ссылок
}
```

### IUserData

Интерфейс для хранения пользовательских данных.

```ts
interface IUserData {
    oldIntentName?: string | null; // Название предыдущего интента (null при сбросе)
    [key: string]: unknown; // Дополнительные данные
}
```

## Константы

### Стандартные интенты

```ts
const WELCOME_INTENT_NAME = 'welcome'; // Интент приветствия
const HELP_INTENT_NAME = 'help'; // Интент помощи
const FALLBACK_COMMAND = '*'; // Команда-заглушка (вызывается при отсутствии совпадений)
```

> ⚠️ `bot.addCommand(FALLBACK_COMMAND, [], cb)` работает, потому что fallback ищется конвейером отдельно: после
> команд и интентов из `setPlatformParams`, если ни один из них не подошёл.
> Обычная команда с пустым массивом слотов **молча не зарегистрируется** — `addCommand('myCmd', [], cb)` не создаст
> триггеров. Исключение — `welcome`/`help`, для которых фреймворк подставляет дефолтные слоты при пустом списке.

## Типы и утилиты

### Middleware

```ts
// Функция для обработки следующего шага в цепочке middleware
type MiddlewareNext = () => Promise<void>;

// Функция промежуточной обработки
type MiddlewareFn = (ctx: BotController, next: MiddlewareNext) => void | Promise<void>;
```

### Команды и шаги

```ts
// Параметры зарегистрированной команды
interface ICommandParam<TBotController extends BotController = BotController> {
    slots?: TSlots; // Триггеры активации (строки или RegExp)
    isPattern?: boolean; // Интерпретировать slots как RegExp
    cb: (
        userCommand: string,
        botController: TBotController,
    ) => void | string | Promise<void | string>;
    regExp?: RegExp; // Скомпилированное RegExp (заполняется автоматически)
    isRegExpString: boolean; // Флаг строкового RegExp
}

// Параметры шага (цепочки диалога)
interface IStepParam<TBotController extends BotController = BotController> {
    stepName: string; // Уникальное имя шага
    // false — шаг не применим, поиск продолжится командами; строка — текст ответа
    cb: (botController: TBotController) => void | false | string | Promise<void | false | string>;
}

// Тип слотов команды
type TSlots = (string | RegExp)[];

// Кастомный резолвер команд
type TCommandResolver = (
    userCommand: string,
    commands: Map<string, ICommandParam>,
) => string | null | Promise<string | null>;
```

### Событийный роутинг (`addEvent`)

Декларативная обработка не-текстовых апдейтов — аналог `bot.on(':photo')` в Telegram-фреймворках, но для всех подключённых платформ сразу. Адаптер определяет тип события и записывает его в `controller.eventType`; обработчики `addEvent` вызываются **до** шагов и команд.

```ts
// Универсальные события (TEventType):
type TEventType =
    | 'message' // текстовое сообщение (значение по умолчанию)
    | 'photo'
    | 'voice'
    | 'video'
    | 'document'
    | 'location'
    | 'contact'
    | 'sticker'
    | 'callback' // нажатие inline/callback-кнопки
    | 'inline' // inline-запрос (пока только Telegram)
    | 'message_edited'
    | 'channel_post'
    | 'start' // начало диалога (deep-link payload в controller.payload)
    | 'subscribed'
    | 'unsubscribed'
    | 'auth' // завершение привязки аккаунта (Алиса account_linking)
    | 'rating'; // результат оценки (SmartApp)

// Валидаторы событийного слоя (экспорт из 'umbot'):
const ALL_EVENT_TYPES: readonly TEventType[]; // перечень всех 17 универсальных событий
function isEventType(event: string): event is TEventType; // true, если имя события известно фреймворку
```

Поддержка объявляется самим адаптером (поле `supportedEvents`): Telegram — медиа/callback/inline/edited/каналы/start; VK — message/callback/start; MAX — message/callback/start/edited; Viber — медиа-типы/start/subscribed/unsubscribed; Алиса — message/auth; SmartApp — message/start/rating; Маруся — message/auth. Обработчик просто не вызывается там, где событие физически невозможно — мультиплатформенный бот не ломается. Кастомная платформа (`BasePlatform`) объявляет собственный `supportedEvents` и автоматически участвует в валидации: `bot.addEvent` предупреждает, если событие не поддерживает ни один подключённый адаптер (обработчик при этом регистрируется и заработает после подключения нужной платформы).

Сводная таблица `supportedEvents` по адаптерам (значения — из `supportedEvents` в коде адаптеров):

| Платформа | `supportedEvents`                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telegram  | `message`, `photo`, `voice`, `video`, `document`, `location`, `contact`, `sticker`, `callback`, `inline`, `message_edited`, `channel_post`, `start` |
| VK        | `message`, `callback`, `start`                                                                                                                      |
| MAX       | `message`, `callback`, `start`, `message_edited`                                                                                                    |
| Viber     | `message`, `photo`, `video`, `document`, `contact`, `location`, `sticker`, `start`, `subscribed`, `unsubscribed`                                    |
| Алиса     | `message`, `auth`                                                                                                                                   |
| Маруся    | `message`, `auth`                                                                                                                                   |
| SmartApp  | `message`, `start`, `rating`                                                                                                                        |

```ts
// Фото от пользователя — без ручного разбора requestObject
bot.addEvent('photo', (ctx) => {
    ctx.text = 'Отличное фото!';
});

// Нажатие кнопки (payload в ctx.payload)
bot.addEvent('callback', (ctx) => {
    ctx.text = `Вы нажали: ${String(ctx.payload)}`;
});

// «Фильтр»: перехватываем сообщение, но отдаём его обычному конвейеру
bot.addEvent('message', (ctx) => {
    if (ctx.userEvents?.auth?.status) return false;
    ctx.text = 'Перехвачено!';
});

// События можно обрабатывать и в action() по controller.eventType
class MyController extends BotController {
    action(intentName: string | null): void {
        if (this.eventType === 'photo') this.text = 'Фото!';
    }
}
```

Семантика обработчика:

- вернул что угодно, кроме `false` (включая `void`) — событие перехвачено: строка, если возвращена, станет текстом ответа; обработка завершена, команды не ищутся;
- вернул `false` — «событие не моё», конвейер продолжится (шаги → команды → интенты → fallback); только так можно передать запрос обычному конвейеру;
- `async`-обработчики поддерживаются, фреймворк дожидается результата;
- несколько обработчиков одного события идут по порядку регистрации до первого не-`false`.

#### Ссылка-приглашение (событие `start`)

Открытие бота по ссылке с параметром (код комнаты, реферальная метка) приходит событием `start`, параметр — в
`ctx.payload` строкой с исходным регистром:

| Платформа | Ссылка                                        | Когда приходит `start`                                                                   |
| --------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Telegram  | `t.me/<бот>?start=<параметр>`                 | сообщение `/start <параметр>` (`userCommand` остаётся `'/start <параметр>'`)             |
| VK        | `vk.me/<сообщество>?ref=<параметр>`           | первое сообщение после перехода по ссылке (поле `ref`; `ref_source` — в `requestObject`) |
| MAX       | `max.ru/<бот>?start=<параметр>`               | нажатие «Начать» (`bot_started`); без параметра в ссылке `payload` — `null`              |
| Viber     | `viber://pa?chatURI=<бот>&context=<параметр>` | открытие диалога (`conversation_started`); без параметра `payload` — `null`              |

`/start` без параметра в Telegram и сообщение без `ref` в VK остаются обычными сообщениями (`message`). Если обработчик
`start` вернул `false`, запрос идёт дальше по конвейеру: в Telegram срабатывают команды по тексту `/start`.

```ts
bot.addEvent('start', (ctx) => {
    if (typeof ctx.payload !== 'string' || !ctx.payload) return false; // «Начать» без параметра
    ctx.text = `Вы вошли в комнату ${ctx.payload}`;
});
```

### Действия кнопок (`addAction`)

Обработчик нажатия кнопки по её payload — как `bot.action()` у конкурентов. Кнопка создаётся с payload (`buttons.addBtn('Купить', '', 'buy')`), адаптеры Telegram, VK, MAX и Алисы нормализуют payload `'buy'`, `{"action":"buy"}` или `{"command":"buy"}` в имя действия:

```ts
bot.addCommand('catalog', ['каталог'], (_, ctx) => {
    ctx.text = 'Выберите товар:';
    ctx.buttons.addBtn('iPhone', '', 'buy').addBtn('MacBook', '', 'buy');
});

// Сработает при нажатии кнопки с payload 'buy'
// (или payload {"command":"buy"}): сообщение-кнопка идёт как команда 'buy'
bot.addAction('buy', (_, ctx) => {
    ctx.text = 'Оформляем заказ...';
});
```

Действие срабатывает на нажатие кнопки и на текст, **равный** имени действия (голосовые платформы), но не на подстроку:
сообщение «хочу buyer» действие `buy` не вызовет. Поэтому имена действий не нужно делать уникальными префиксами. Если
одно и то же имя зарегистрировано и командой, и действием, побеждает зарегистрированное раньше.

#### Кнопки с данными (`defineAction`)

Когда кнопка несёт данные (id комнаты, вариант, страницу), опишите действие один раз — как `CallbackData` в aiogram:
описание создаёт кнопки и регистрирует обработчик, который получает данные уже разобранными (payload без поля `action`).

```ts
const kick = bot.defineAction<{ p: string }>('kick');

kick.handle((data, ctx) => {
    ctx.text = `Участник ${data.p} исключён`;
});

bot.addCommand('members', ['участники'], (_, ctx) => {
    ctx.text = 'Участники комнаты:';
    for (const member of members) {
        kick.addBtn(ctx.buttons, `Исключить ${member.name}`, { p: member.id });
    }
});

// Payload для card.addButton и других мест: kick.payload({ p: 'u7' }) -> { action: 'kick', p: 'u7' }
```

Данные хранятся в самой кнопке: Telegram принимает payload до 64 байт, VK — до 255. Если payload длиннее 64 байт
и подключён Telegram, `addBtn` пишет предупреждение в лог — сократите данные (короткие ключи, id вместо названий).

#### Меню из экранов (`defineMenu`)

Меню «Главная → Раздел → Назад» описывается таблицей экранов. `menu.show(ctx, экран)` выводит текст экрана, его
кнопки и «Назад» (если у экрана есть `parent`).

```ts
interface IMenuOptions<TBotController> {
    screens: Record<string, IMenuScreen<TBotController>>; // экраны по именам
    start?: string; // экран по умолчанию; без поля — первый в screens
    backText?: string; // текст кнопки возврата (по умолчанию 'Назад')
}

interface IMenuScreen<TBotController> {
    text: string | ((ctx: TBotController) => string);
    buttons?: IMenuButton[]; // в порядке показа
    parent?: string; // куда ведёт «Назад»; без поля кнопки нет
    onShow?: (ctx: TBotController) => void | Promise<void>; // после текста и кнопок: карточки, Navigation, форма
}

interface IMenuButton {
    title: string;
    to?: string; // переход на экран
    url?: string; // кнопка-ссылка
    payload?: TButtonPayload; // другое действие, например buy.payload({ id: 7 })
}

interface IMenu<TBotController> {
    readonly name: string;
    show(ctx: TBotController, screen?: string): void | Promise<void>; // без screen или для неизвестного — start
    payload(screen: string): Record<string, unknown>; // кнопка перехода вне меню
}
```

```ts
const menu = bot.defineMenu('main', {
    screens: {
        home: {
            text: 'Чем помочь?',
            buttons: [
                { title: 'Тарифы', to: 'prices' },
                { title: 'Сайт', url: 'https://example.com' },
            ],
        },
        prices: { text: 'Базовый — 0 ₽, Премиум — 299 ₽', parent: 'home' },
    },
});

bot.addCommand('menu', ['меню', '/start'], (_, ctx) => menu.show(ctx));
```

Как работает переход:

- **Нажатие кнопки** — экран записан в payload кнопки (`{ action: '__menu_<имя>', s: экран }`), поэтому нажатие
  срабатывает на любой платформе и в любой момент, даже если пользователь между нажатиями писал другое.
- **Название кнопки текстом или голосом** — `show` ставит `thisIntentName` на шаг экрана (`__menu_<имя>_<экран>`), и
  следующая реплика сначала сравнивается с кнопками этого экрана (без учёта регистра). Не совпала — шаг возвращает
  `false`, и запрос уходит обычным командам. Кнопки `url` и `payload` по названию не срабатывают.
- `onShow` вызывается после того, как задан шаг экрана, поэтому может перевести диалог дальше (`bot.startForm(...)`,
  свой `thisIntentName`). Если `onShow` асинхронный, верните результат `show` из обработчика — фреймворк его дождётся.

`userData` меню не использует: текущий экран хранится в `oldIntentName`, как у обычных шагов. При регистрации
`defineMenu` предупреждает о переходах на несуществующие экраны и, при подключённом Telegram, о payload
длиннее 64 байт (его лимит) — держите имена меню и экранов короткими. Внутренние имена `__menu_<имя>` (действие) и
`__menu_<имя>_<экран>` (шаги) не используйте для своих команд и шагов.

### Группы регулярных выражений (`match`)

Для команд с RegExp-слотами, `isPattern`-паттернами и сработавшей группой регулярных выражений обработчик получает готовое совпадение в `controller.match` — без повторного прогона регулярки:

```ts
bot.addCommand('order', [/(?:заказ|купить)\s+(\d+)/], (_, ctx) => {
    ctx.text = `Оформляю заказ №${ctx.match?.[1]}`;
});
```

`match` вычисляется лениво: фреймворк запоминает регулярку сработавшей команды, а сам прогон делает только при первом чтении — запросы, не использующие группы, не тратят время. Для строковых команд `match === null`.

### API платформы (`controller.api`)

Унифицированный доступ к возможностям активной платформы из обработчика — без ручного конструирования Request-классов:

```ts
// photo-обработчик: отправляем фото в ответ
bot.addEvent('photo', async (ctx) => {
    await ctx.api?.sendPhoto('answer.jpg', { caption: 'Вот ваш отчёт' });
    ctx.skipAutoReply = true; // ответ уже отправлен вручную
});

// Подтверждение нажатия кнопки на любой callback-платформе
bot.addAction('buy', async (_, ctx) => {
    await ctx.api?.answerCallback('Заказ оформлен!');
});
```

Методы фасада:

| Метод          | Описание                                                   | Telegram | VK         | MAX | Viber |
| -------------- | ---------------------------------------------------------- | -------- | ---------- | --- | ----- |
| sendPhoto      | Отправка фото (локальный путь, URL или file_id/attachment) | ✓        | ✓ (upload) | ✓   | —     |
| sendDocument   | Отправка файла/документа                                   | ✓        | ✓ (upload) | ✓   | —     |
| sendAudio      | Отправка аудио                                             | ✓        | —          | ✓   | —     |
| sendVideo      | Отправка видео                                             | ✓        | —          | ✓   | —     |
| answerCallback | Уведомление/snackbar в ответ на нажатие callback-кнопки    | ✓        | ✓          | ✓   | —     |
| can(method)    | Проверка поддержки метода текущей платформой               | ✓        | ✓          | ✓   | —     |

Фасад — ленивый объект: создаётся при первом обращении к `ctx.api`, на голосовых платформах (Алиса, SmartApp, Маруся) равен `null` (их ответ формируется телом webhook — используйте `card`/`sound`). Неподдерживаемые методы логируют предупреждение и возвращают `null`; поддержка проверяется заранее через `can()`. У Viber `can()` возвращает `false` для всех методов — Bot API Viber требует URL и размер файла, поэтому фасад там недоступен.

Фасад выбирается адаптером: метод `createApi(controller)` контракта `IPlatformAdapter` (базовая реализация `BasePlatform` возвращает `null`). Кастомная платформа подключает свой фасад переопределением этого метода — возвращает объект, реализующий `IControllerApi`; пример — в [platform-integration.md](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/platform-integration), раздел «API платформы».

### Формы (`addForm`)

Многошаговая форма — обёртка над шагами: каждое поле становится отдельным шагом, ответы собираются в объект и передаются в `onComplete`. Запускайте форму через `bot.startForm(ctx, name, context?)`: он задаёт первый вопрос с кнопками и передаёт контекст (например, id комнаты) в `prompt` и `onComplete`.

```ts
// Одно поле формы
interface IAddFormField<TBotController extends BotController = BotController> {
    name: string; // Ключ поля в объекте ответов
    prompt: string | ((ctx: TBotController, context: TFormContext) => string); // Вопрос пользователю
    options?: string[]; // Варианты — кнопками; ответ должен совпасть с одним из них (без учёта регистра)
    optional?: boolean; // Кнопка «Пропустить»; пропущенного поля нет в ответах
    // true — принято; false — повторить prompt; string — текст ошибки пользователю
    validate?: (value: string) => boolean | string | Promise<boolean | string>;
    // Преобразование ответа: { value } — в ответы попадёт value; { error } — вопрос повторяется
    parse?: (value: string, ctx: TBotController) => TFormParseResult | Promise<TFormParseResult>;
}

// Параметры addForm
interface IAddFormOptions<TBotController, TAnswers = Record<string, string>> {
    fields: IAddFormField<TBotController>[]; // Поля, обрабатываются последовательно
    // Вызывается после заполнения всех полей; context — из startForm ({} без него)
    onComplete: (
        ctx: TBotController,
        answers: TAnswers,
        context: TFormContext,
    ) => void | Promise<void>;
    cancelText?: string; // Текст при отмене (по умолчанию 'Форма отменена.')
    cancelCommands?: string[]; // Команды отмены (по умолчанию ['отмена', 'cancel'])
    skipText?: string; // Кнопка пропуска (по умолчанию 'Пропустить')
    invalidOptionText?: string; // Ответ не из options (по умолчанию 'Выберите один из вариантов.')
    // Callback-кнопка или текст, равный команде (не вариант ответа), — выход из формы,
    // запрос уходит обычному конвейеру. Без опции такой ввод — ответ на вопрос
    escape?: boolean;
}
```

Порядок проверки ответа: команда отмены → выход по `escape` → пропуск → `options` → `validate` → `parse`.

```ts
bot.addForm('registration', {
    fields: [
        { name: 'name', prompt: 'Как вас зовут?' },
        {
            name: 'email',
            prompt: 'Укажите email',
            validate: (v) => /\S+@\S+/.test(v) || 'Некорректный email',
        },
    ],
    onComplete: (ctx, answers) => {
        ctx.text = `Спасибо, ${answers.name}! Мы записали ваш email: ${answers.email}`;
    },
});
```

```ts
bot.addForm<BotController, { guests: number; time?: string }>('booking', {
    escape: true, // кнопка «Меню» посреди формы выходит из неё
    fields: [
        {
            name: 'guests',
            prompt: (_ctx, context) => `Комната ${context.roomId}. Сколько гостей?`,
            parse: (v) =>
                Number.isInteger(+v) && +v > 0 ? { value: +v } : { error: 'Нужно целое число' },
        },
        { name: 'time', prompt: 'Во сколько?', options: ['Утро', 'Вечер'], optional: true },
    ],
    onComplete: (ctx, answers, context) => {
        ctx.text = `Бронь в комнате ${context.roomId}: ${answers.guests} гостей, ${answers.time ?? 'время любое'}`;
    },
});

const book = bot.defineAction<{ room: string }>('book');
book.handle((data, ctx) => {
    bot.startForm(ctx, 'booking', { roomId: data.room });
});
```

Значения `parse` и контекст хранятся в `userData` до конца формы, поэтому должны сериализоваться в JSON (дату
возвращайте строкой ISO).

> Промежуточные ответы хранятся в `userData.__formdata_<имя>`, контекст — в `userData.__formctx_<имя>`. После заполнения или отмены формы
> поле получает значение `null`, а не удаляется: Алиса убирает поле из `user_state_update` только
> при значении `null`, удалённое через `delete` поле осталось бы в состоянии пользователя.

> `removeForm('registration')` удаляет форму и все её внутренние шаги. Имена шагов формы имеют префикс `__form_<имя>_`, поэтому `removeForm('user')` удалит и форму `user_2` — используйте уникальные имена.

### Утилиты для кнопок

```ts
// Создание интерактивной кнопки
getButton(
    appContext: AppContext,
    title: string | null,
    url: string | null,
    payload: TButtonPayload | null,
    options?: IButtonOptions
): IButtonType | null

// Создание кнопки-ссылки
getLinkButton(
    appContext: AppContext,
    title: string | null,
    url: string | null,
    payload: TButtonPayload | null,
    options?: IButtonOptions
): IButtonType | null
```

### Утилита для изображений

```ts
// Создание изображения для карточки
getImage(
    appContext: AppContext,
    image: string | null,
    title: string,
    desc = '',
    button: TButton | null = null,
    isToken = false
): IImageType | null
```

### Утилиты адаптеров платформ (`umbot/plugins`)

Хелперы для тех, кто пишет собственный адаптер платформы или свой API-клиент. Подробности
применения — в документе `adapter/platformAdapter.md`.

```ts
// Единый формат сообщения об ошибке запроса к API платформы
getErrorMsg(error: Error | string, path: string, url: string | null): string

// Единый формат сообщения об отсутствующем токене платформы
getErrorToken(platform: string, methodName: string): string

// Сборка API-фасада встроенной платформы по controller.appType
// (ядро вызывает createApi() адаптера; диспетчер оставлен для ручного использования)
makePlatformApi(controller: BotController): TApiFacade | null
```

Остальные хелперы адаптеров собраны в пространстве имён `pUtils` (`import { pUtils } from 'umbot/plugins'`):
работа с медиа-токенами (`getImageToken`, `getSoundToken`), разбор входящих запросов
(`tryParse`, `normalizeActionPayload`, `getPlatformRequestData`, `setThisUserToNlu`,
`telegramMessageEvent`, `viberMessageEvent`) и сборка ответа (`getChatText`, `getSpeechText`,
`getCorrectButtons`, `serializePlatformPayload`).

### Результат выполнения

```ts
// Результат обработки запроса
type TRunResult = object | string;
```

## Примеры использования

### Базовый контроллер

```ts
import { BotController, WELCOME_INTENT_NAME } from 'umbot';

class MyController extends BotController {
    public action(intentName: string | null): void {
        switch (intentName) {
            case WELCOME_INTENT_NAME:
                this.text = 'Привет! Чем могу помочь?';
                this.buttons.addBtn('Помощь').addBtn('О приложении');
                break;

            case 'about':
                this.text = 'Это пример приложения на umbot';
                this.card.setTitle('О приложении').addImage('image_token');
                break;

            default:
                this.text = 'Извините, я вас не понял';
                break;
        }
    }
}
```

### Работа с командами

```ts
import { Bot } from 'umbot';

const bot = new Bot();

// Добавление простой команды
bot.addCommand('greeting', ['привет', 'здравствуй'], (_, bc) => 'Привет!');

// Добавление команды с колбэком
bot.addCommand(
    'numbers',
    ['\\b\\d{3}\\b'],
    (userCommand, botController) => {
        botController.text = `Вы ввели число: ${userCommand}`;
    },
    true,
);
```

### Работа с состоянием

```ts
interface GameData extends IUserData {
    score: number;
    level: number;
    example?: string;
    result?: number | string;
    isGame?: boolean;
}

class GameController extends BotController<GameData> {
    public action(intentName: string | null): void {
        // Инициализация данных при первом запуске.
        // Данные нужно мержить, а не перезаписывать:
        // переопределение `this.userData = {...}` ломает сохранение в базу.
        if (!this.userData.score) {
            Object.assign(this.userData, {
                score: 0,
                level: 1,
            });
        }

        // Обработка команд
        switch (intentName) {
            case 'addScore':
                this.userData.score += 10;
                this.text = `Ваш счет: ${this.userData.score}`;
                break;
        }
    }
}
```

### Работа с кнопками

```ts
class ButtonController extends BotController {
    public action(intentName: string | null): void {
        switch (intentName) {
            case 'showButtons':
                // Добавление кнопок
                this.buttons.addBtn('Помощь').addBtn('Назад').addBtn('Выход');
                this.text = 'Выберите действие:';
                break;
        }
    }
}
```

### Работа с карточками

```ts
class CardController extends BotController {
    public action(intentName: string | null): void {
        switch (intentName) {
            case 'showCard':
                // Создание карточки
                this.card
                    .setTitle('Заголовок карточки')
                    .addImage('image_token', ' ', 'Описание изображения');
                this.text = 'Вот ваша карточка:';
                break;
        }
    }
}
```

### Работа с NLU

```ts
class NluController extends BotController {
    public action(intentName: string | null): void {
        // Получение интента из NLU (например, 'YANDEX.CONFIRM')
        const nluIntent = this.nlu.getIntent('YANDEX.CONFIRM');
        if (nluIntent) {
            // nluIntent — объект INluIntent со свойством slots
            this.text = `Найдены слоты: ${JSON.stringify(nluIntent.slots)}`;
        } else {
            this.text = 'Интент не найден';
        }
    }
}
```

### Работа с авторизацией

```ts
class AuthController extends BotController {
    public action(intentName: string | null): void {
        // Проверка авторизации
        if (this.isAuth) {
            this.text = 'Вы авторизованы';
            this.userToken = this.userToken || 'default_token';
        } else {
            this.text = 'Требуется авторизация';
            this.isAuth = true;
        }
    }
}
```

### Работа с оценкой

```ts
class RatingController extends BotController {
    public action(intentName: string | null): void {
        // Проверка оценки
        if (this.isSendRating) {
            this.text = 'Спасибо за оценку!';
            this.isSendRating = false;
        } else {
            this.text = 'Пожалуйста, оцените наш сервис';
            this.isSendRating = true;
        }
    }
}
```

## Дополнительные классы

### AppContext

Контекст приложения — хранилище конфигурации, реестров и подключенных модулей. У каждого экземпляра `Bot` свой
контекст (`bot.getAppContext()`), поэтому несколько ботов в одном процессе не делят настройки.

#### Основные свойства

| Свойство         | Тип                                                                               | Описание                                                 |
| ---------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `appConfig`      | `Required<IAppConfig>`                                                            | Текущая конфигурация (со всеми дефолтами)                |
| `platformParams` | `IAppParam`                                                                       | Параметры платформы                                      |
| `platforms`      | `Record<TAppType, IPlatformAdapter>`                                              | Реестр подключенных платформ                             |
| `database`       | `{ adapter?: IDatabaseAdapter, databaseInfo?: unknown, isSendConnect?: boolean }` | Подключенный DB-адаптер и информация о подключении       |
| `command`        | `CommandReg`                                                                      | Реестр команд (основной доступ; ниже — удобные геттеры)  |
| `commands`       | `Map<string, ICommandParam>`                                                      | Все зарегистрированные команды (геттер поверх `command`) |
| `steps`          | `Map<string, IStepParam>`                                                         | Все зарегистрированные шаги (геттер поверх `command`)    |
| `regexpGroup`    | `Map<string, IGroupData>`                                                         | Группы regex-команд (геттер поверх `command`)            |
| `httpClient`     | `THttpClient`                                                                     | HTTP-клиент (публичное поле, можно переопределить)       |
| `plugins`        | `TAppPlugin`                                                                      | Реестр плагинов (слоты `i18n`, `nlu`, `regExp` + ваши)   |

#### Методы

| Метод                           | Описание                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `log(...args)`                  | Логирование                                                                                                                                              |
| `logError(msg, meta?)`          | Логирование ошибок                                                                                                                                       |
| `logWarn(msg, meta?, options?)` | Логирование предупреждений. `options.stderr: true` — вне `dev` и без своего логгера дублировать в stderr (для предупреждений, которые нельзя пропустить) |
| `logMetric(name, value, label)` | Логирование метрик                                                                                                                                       |

### Request

HTTP-клиент, которым фреймворк ходит в API платформ. Им же удобно ходить во внешние API из обработчиков: у него
таймаут по умолчанию, он не бросает исключений и идёт через `appContext.httpClient` — запросы подменяются в тестах
одним моком (см. [Кастомизация HTTP-слоя](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/http-client)).

```ts
import { Request } from 'umbot';

bot.addCommand('weather', ['погода'], async (_, ctx) => {
    const request = new Request(ctx.appContext);
    request.get = { city: 'moscow' }; // → ?city=moscow
    const res = await request.send<{ temp: number }>('https://api.weather.example.com/current');
    ctx.text = res.status && res.data ? `Сейчас ${res.data.temp}°C` : 'Не удалось узнать погоду';
});
```

#### Поля (настройка одного вызова)

| Поле               | Тип                                           | По умолчанию | Описание                                                                                                                    |
| ------------------ | --------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `url`              | `string \| null`                              | `null`       | Адрес; можно передать в `send(url)`                                                                                         |
| `get`              | `Record<string, string> \| null`              | `null`       | Параметры строки запроса (кодируются)                                                                                       |
| `post`             | `Record<string, unknown> \| FormData \| null` | `null`       | Тело: объект уходит JSON (`Content-Type: application/json` подставляется сам), `FormData` — multipart. С телом метод — POST |
| `postInString`     | `string \| null`                              | `null`       | Тело готовой строкой (приоритетнее `post`)                                                                                  |
| `header`           | `HeadersInit \| null`                         | `null`       | Заголовки (`Authorization` и т.п.)                                                                                          |
| `customRequest`    | `string \| null`                              | `null`       | Свой HTTP-метод: `'PUT'`, `'DELETE'`, …                                                                                     |
| `attach`           | `string \| null`                              | `null`       | Путь к файлу для multipart-загрузки (или содержимое при `isAttachContent: true`)                                            |
| `attachName`       | `string`                                      | `'file'`     | Имя поля файла                                                                                                              |
| `isAttachContent`  | `boolean`                                     | `false`      | `attach` — содержимое файла, а не путь                                                                                      |
| `isConvertJson`    | `boolean`                                     | `true`       | Разобрать ответ как JSON; `false` — текст (или `ArrayBuffer` при `isBinaryResponse`)                                        |
| `isBinaryResponse` | `boolean`                                     | `false`      | Вернуть ответ как `ArrayBuffer` (при `isConvertJson: false`)                                                                |
| `signal`           | `AbortSignal \| null`                         | `null`       | Внешняя отмена, действует вместе с таймаутом                                                                                |
| `maxTimeQuery`     | `number \| null`                              | `2000`       | Таймаут, мс. **Сохраняется** между вызовами — это настройка клиента                                                         |

Все поля, кроме `maxTimeQuery`, сбрасываются после `send()`: один экземпляр можно переиспользовать, настройки одного
запроса не попадут в следующий. Редиректы не выполняются (`redirect: 'manual'`).

#### Методы

| Метод                            | Возвращает                  | Описание                                                                                                                 |
| -------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `send<T>(url?)`                  | `Promise<IRequestSend<T>>`  | Выполняет запрос. Не бросает: `{ status: true, data }` или `{ status: false, data: null, err, httpStatus?, errorBody? }` |
| `getError()`                     | `Error \| string \| null`   | Ошибка последнего запроса                                                                                                |
| `getAttachFile(filePath, name?)` | `Promise<FormData \| null>` | `FormData` с файлом — для `post`                                                                                         |

`httpStatus` и `errorBody` (до 1000 символов) есть, только если сервер ответил не 2xx: по ним отличают 429 от 400.
При таймауте и сетевой ошибке их нет. Подробнее — [Кастомизация HTTP-слоя](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/http-client#результат-запроса-при-ошибке).

> Таймаут 2 с по умолчанию выбран под голосовые платформы, где на весь ответ около 3 с. Для чат-ботов и фоновых
> задач увеличьте `maxTimeQuery`, но не снимайте его совсем: зависший внешний API не должен держать обработчик.

### Navigation

Компонент для постраничной навигации по спискам. Это пагинация одного списка, а не переходы между экранами меню —
для меню «раздел → подраздел → назад» есть [`bot.defineMenu`](#меню-из-экранов-definemenu); список можно показать
внутри экрана меню через `onShow`. Экземпляр не хранит состояние между запросами: номер страницы сохраняйте в
`userData` и восстанавливайте в `thisPage` (рецепт «Пагинация»).

```ts
import { Navigation } from 'umbot';

const nav = new Navigation(5); // 5 элементов на странице
const elements = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Получение элементов текущей страницы
const page = nav.getPageElements(elements);

// Навигация по командам
nav.getPageElements(elements, 'дальше'); // следующая страница
nav.getPageElements(elements, 'назад'); // предыдущая страница

// Поиск элемента: 'iPhone' должен быть на ТЕКУЩЕЙ странице (окно первых
// maxVisibleElements элементов) — поиск по схожести идёт только внутри неё
const item = nav.selectedElement(elements, 'iPhone', ['title']);
```

#### Методы Navigation

| Метод             | Параметры                                                                                    | Возвращаемое значение | Описание                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getPageElements` | `elements?: T[] \| null`, `text?: string`                                                    | `T[]`                 | Элементы текущей страницы; без `elements` — последний переданный список (мутирует `thisPage` при "дальше"/"назад")                                                                                     |
| `selectedElement` | `elements: T[] \| null`, `text: string`, `keys?: TKeys \| null`, `thisPage?: number \| null` | `T \| null`           | Поиск элемента по значению (по номеру или по похожести текста) — только среди элементов текущей страницы. Поздние параметры при пропуске передавайте явно как `null`                                   |
| `getPageNav`      | `isNumber?: boolean`                                                                         | `string[]`            | Подписи кнопок пагинации: `['Дальше 👉']`/`['👈 Назад', 'Дальше 👉']` или `['[1]', '2', '3']` — «Назад» не отдаётся на первой странице, «Дальше» — на последней; при единственной странице — `['[1]']` |
| `getPageInfo`     | -                                                                                            | `string`              | Информация о текущей странице: `"N страница из M"` (при единственной странице — пустая строка)                                                                                                         |
| `getMaxPage`      | `elements?: T[] \| null`                                                                     | `number`              | Количество страниц                                                                                                                                                                                     |
| `numberPage`      | `text: string`                                                                               | `boolean`             | Распознать команду вида `"2 страница"` и перейти                                                                                                                                                       |

#### Свойства

| Свойство             | Тип      | Описание                           |
| -------------------- | -------- | ---------------------------------- |
| `thisPage`           | `number` | Номер текущей страницы (0-indexed) |
| `maxVisibleElements` | `number` | Максимум элементов на странице     |

### Preload

Предзагрузка медиаресурсов на серверы платформ.

```ts
import { Preload } from 'umbot/preload';
import { T_ALISA, T_TELEGRAM } from 'umbot/plugins';

const preload = new Preload(bot.getAppContext());

// Загрузка изображений (для Алисы нужен skill_id навыка)
await Promise.all(preload.loadImages(['./img.jpg'], [T_ALISA], { alisaSkillId: 'ваш-skill-id' }));

// Загрузка звуков
await Promise.all(preload.loadSounds(['./sound.mp3'], [T_ALISA], { alisaSkillId: 'ваш-skill-id' }));

// Telegram требует ID получателя
await Promise.all(preload.loadImages(['./img.jpg'], [T_TELEGRAM], { telegramUseId: 123 }));
```

> ⚠️ Загрузка выполняется только для платформ, у которых задан токен (`appConfig.tokens` или переменные окружения). Без настроенных токенов методы вернут пустой массив (без промисов) и загрузка молча не выполнится. Для неподдерживаемых платформ (Viber, SmartApp) промисы в массив не попадают вовсе.
>
> `options` у всех четырёх методов: `alisaSkillId` — id навыка (API ресурсов Алисы адресуется по навыку, а вне
> запроса взять его неоткуда; без него Алиса пропускается и при загрузке, и при удалении); `telegramUseId` —
> пользователь, которому Telegram отправит файл, чтобы получить его `file_id`.

#### Как работает кэш

1. При вызове `loadImages()` фреймворк проверяет, есть ли уже токен для этого файла в БД (`ImageTokens` модель).
2. Если токен есть — используется кэшированное значение (загрузка не происходит).
3. Если токена нет — файл загружается на сервер платформы, полученный токен сохраняется в БД.
4. При следующем обращении к тому же файлу токен берётся из БД — без задержки на upload.

#### Когда использовать

- **Всегда**, если у вас в навыке есть изображения или звуки.
- Особенно критично для голосовых платформ из-за практического лимита ~3 с (предупреждение — после 2 с).

#### Методы Preload

| Метод          | Параметры                                               | Возвращаемое значение       | Описание                                                                                                                     |
| -------------- | ------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `loadImages`   | `paths: string[]`, `platforms?: TAppType[]`, `options?` | `Promise<string \| null>[]` | Загрузить изображения (разрешается токеном изображения или `null` при ошибке)                                                |
| `loadSounds`   | `paths: string[]`, `platforms?: TAppType[]`, `options?` | `Promise<string \| null>[]` | Загрузить звуки (разрешается токеном звука или `null` при ошибке)                                                            |
| `removeImages` | `paths: string[]`, `platforms?: TAppType[]`, `options?` | `Promise<boolean>[]`        | Удалить изображения (реализация — только Алиса и Маруся; для остальных платформ промис завершается `true`, ничего не удаляя) |
| `removeSounds` | `paths: string[]`, `platforms?: TAppType[]`, `options?` | `Promise<boolean>[]`        | Удалить звуки (реализация — только Алиса и Маруся; для остальных платформ промис завершается `true`, ничего не удаляя)       |

Результат `loadImages`/`loadSounds` — токен загруженного медиа или `null`, если загрузка не удалась: проверяйте
успех по `!== null`.

### ILogger

Интерфейс кастомного логгера. Все методы опциональны.

```ts
interface ILogger {
    log?(...args: unknown[]): void;
    error?(message: string, meta?: Record<string, unknown>): void;
    warn?(message: string, meta?: Record<string, unknown>): void;
    metric?(name: string, value: unknown, labels?: Record<string, unknown>): void;
    maskSecrets?: boolean; // По умолчанию true: маскировка секретов включена всегда, отключается только явным maskSecrets: false
}
```

### IPlugin / IPluginFn

Интерфейсы для расширений фреймворка.

```ts
// Класс-плагин
interface IPlugin {
    init: (appContext: AppContext, bot: Bot) => void;
    destroy: (bot: Bot) => void | Promise<void>;
}

// Функция-плагин (рекомендуется)
interface IPluginFn {
    (appContext: AppContext, bot: Bot): void | ((bot: Bot) => void);
    isPlugin: boolean; // ОБЯЗАТЕЛЬНО: myPlugin.isPlugin = true;
}
```

> **Рекомендация:** вместо ручного присваивания `myPlugin.isPlugin = true` используйте хелпер `createPlugin()` — он выставляет флаг автоматически, и забыть его невозможно:
>
> ```ts
> import { createPlugin } from 'umbot';
>
> const myPlugin = createPlugin((appContext, bot) => {
>     // логика инициализации
>     return () => {
>         // логика очистки при уничтожении
>     };
> });
> bot.use(myPlugin);
> ```

### SoundConstants

Константы стандартных звуков и эффектов.

| Константа                 | Описание                      |
| ------------------------- | ----------------------------- |
| `S_AUDIO_GAME_WIN`        | Звук победы                   |
| `S_AUDIO_GAME_LOSS`       | Звук проигрыша                |
| `S_AUDIO_GAME_8_BIT_COIN` | Монетка                       |
| `S_AUDIO_NATURE_RAIN`     | Дождь                         |
| `S_AUDIO_NATURE_SEA`      | Море                          |
| `S_EFFECT_HAMSTER`        | Эффект хомяка (высокий голос) |
| `S_EFFECT_MEGAPHONE`      | Эффект мегафона               |

Полный список — в `src/components/sound/constants.ts`.

### Text

Утилита для работы со строками.

| Метод            | Параметры                                                                                                                                             | Возвращаемое значение | Описание                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------ |
| `Text.resize`    | `text: string \| null`, `size?: number`, `isEllipsis?: boolean`                                                                                       | `string`              | Обрезка строки по длине              |
| `Text.getText`   | `str?: string \| string[]`                                                                                                                            | `string`              | Выбор случайного элемента из массива |
| `Text.isSayText` | `find: string \| RegExp \| (string \| RegExp)[]`, `text: string`, `isPattern?: boolean`, `useDirectRegExp?: boolean`, `customReg?: RegExpConstructor` | `boolean`             | Проверка совпадения слота с текстом  |

## Метрики

Фреймворк собирает метрики времени выполнения ключевых операций. Для включения реализуйте метод `metric()` в логгере.

| Метрика              | Константа               | Что измеряет                                                                       |
| -------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| Время запроса        | `EMetric.REQUEST`       | Время исходящего HTTP-запроса к API платформы (`url`, `method`, `status` в labels) |
| Начало webhook       | `EMetric.START_WEBHOOK` | Момент начала обработки (значение — метка времени, не длительность)                |
| Время webhook        | `EMetric.END_WEBHOOK`   | Общее время обработки webhook (входящий запрос)                                    |
| Поиск интента        | `EMetric.GET_INTENT`    | Время поиска подходящего интента                                                   |
| Поиск команды        | `EMetric.GET_COMMAND`   | Время поиска подходящей команды                                                    |
| Выполнение action    | `EMetric.ACTION`        | Время выполнения `action()` контроллера                                            |
| Middleware           | `EMetric.MIDDLEWARE`    | Время выполнения middleware-цепочки                                                |
| Запрос к БД (SELECT) | `EMetric.DB_SELECT`     | Время выполнения SELECT                                                            |
| Запрос к БД (INSERT) | `EMetric.DB_INSERT`     | Время выполнения INSERT                                                            |
| Запрос к БД (UPDATE) | `EMetric.DB_UPDATE`     | Время выполнения UPDATE                                                            |
| Запрос к БД (REMOVE) | `EMetric.DB_REMOVE`     | Время выполнения DELETE                                                            |

Пример подключения:

```ts
bot.setLogger({
    metric: (name: string, value: unknown, meta?: Record<string, unknown>) => {
        console.log(`[METRIC] ${name}: ${value}`, meta);
    },
});
```

Пример вывода:

```text
[METRIC] umbot_get-command_duration_ms: 0.45 { commandName: 'weather', status: true }
[METRIC] umbot_action_duration_ms: 12.3 { commandName: 'weather', platform: 'telegram', isCommand: true }
```

## Модели

### Model

Базовый класс для работы с данными в БД. Наследуйтесь для создания кастомных моделей (таблиц лидеров, каталогов и т.д.).

```ts
import { Model, IModelState, IModelRules, AppContext } from 'umbot';

interface IScoreState extends IModelState {
    userId: string | null;
    score: number | string | null; // string допускает текстовую метку поля (attributeLabels)
}

const RULES: IModelRules[] = [
    { name: ['userId'], type: 'string', max: 250 },
    { name: ['score'], type: 'integer' },
];

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
        return { userId: 'ID', score: 'Score' };
    }
    tableName() {
        return ScoreModel.TABLE_NAME;
    }
}
```

Использование в контроллере:

```ts
const score = new ScoreModel(this.appContext);
score.state.userId = String(this.userId);

if (await score.whereOne({ userId: score.state.userId })) {
    score.state.score = Number(score.state.score) + 1;
    await score.update();
} else {
    score.state.score = 1;
    await score.add();
}
```

#### Методы Model

| Метод                   | Возвращает           | Описание                                                                                       |
| ----------------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| `add()`                 | `Promise<boolean>`   | Вставка новой записи; FileAdapter возвращает `false`, если запись с таким ключом уже есть      |
| `update()`              | `Promise<boolean>`   | Обновление записи по ключу из `state`                                                          |
| `remove()`              | `Promise<boolean>`   | Удаление записи по ключу из `state`                                                            |
| `whereOne(where?)`      | `Promise<boolean>`   | Поиск одной записи; найденная запись загружается в `state`                                     |
| `where(where?, isOne?)` | `Promise<IModelRes>` | Поиск записей: `{ status: true, data: строки[] }`; ничего не найдено — `status: false`         |
| `query(callback)`       | зависит от адаптера  | Сырой запрос драйвером (`(client, db) => ...` у MongoAdapter); у FileAdapter возвращает `null` |
| `save(isNew?)`          | `Promise<boolean>`   | Сохранение (add если isNew=true, иначе update)                                                 |

#### Условия `where()` / `whereOne()`

Условие — объект «поле: значение»: `where({ userId: '42', status: 'active' })` найдёт записи, у которых **все**
перечисленные поля равны значениям. Без аргумента возвращаются все записи таблицы. Строка вида
``'`age`=25 `status`="active"'`` — тот же объект в текстовой записи (числа из строки становятся числами).

Сравнение с диапазоном и списком зависит от адаптера:

| Адаптер              | Точное совпадение   | Операторы (`$gt`, `$lt`, `$in`, `$ne`, `$regex`, `$or` …)                                                                         |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `FileAdapter`        | да, строго по `===` | нет: условие с оператором не совпадёт ни с одной записью                                                                          |
| `MongoAdapter`       | да                  | да — операторы сравнения MongoDB; `$where`, `$function` и незнакомые операторы отклоняются (запрос не выполнится, причина в логе) |
| внешние (knex, YDB…) | да                  | см. документацию адаптера                                                                                                         |

```ts
// Траты пользователя за последние 7 дней; expenses — своя модель (как ScoreModel выше) с полем createdAt
const expenses = new ExpenseModel(ctx.appContext);
const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
const res = await expenses.where({ userId: String(ctx.userId), createdAt: { $gt: weekAgo } }); // MongoAdapter
const rows = res.status && Array.isArray(res.data) ? res.data : [];

// То же для любого адаптера: точное условие в БД, остальное — в коде
const all = await expenses.where({ userId: String(ctx.userId) });
const recent = (all.status && Array.isArray(all.data) ? all.data : []).filter(
    (row) => Number(row.createdAt) > weekAgo,
);
```

- `FileAdapter` сравнивает и тип: запись с `userId: '42'` не найдётся по `{ userId: 42 }`. Храните id одного типа
  (строкой — как `ctx.userId` чат-платформ после `String()`).
- Фильтр в коде годится, пока выборка по точному условию небольшая (записи одного пользователя). Агрегации
  («топ-10 по рефералам») и выборки по всей большой таблице делайте средствами БД через `query()` — пример для
  MongoDB есть в JSDoc `Model.query`.
- Поля из `getUniqueKeys()` добавляются к условию только в `update()`/`remove()` и поиске по ключу; в `where()`
  указывайте их сами (например, `platform` для `UsersData`).

Если первичный ключ уникален только в паре с другим полем (как `userId` у `UsersData` — в пределах платформы),
переопределите защищённый метод `getUniqueKeys()`: модель добавит эти поля в условие select/update/remove и передаст
их адаптеру в `IQuery.uniqueKeys`.

```ts
protected getUniqueKeys(): string[] {
    return ['platform'];
}
```

### UsersData

Встроенная модель для хранения `userData`. Обычно не используется напрямую — фреймворк работает с ней автоматически через `controller.userData`.

### ImageTokens / SoundTokens

Встроенные модели для кэширования токенов загруженных медиа. Управляются фреймворком автоматически через `Preload` и компоненты `Card`/`Sound`.

---

## Схема встроенных таблиц БД

Когда вы подключаете `MongoAdapter` или `FileAdapter`, umbot автоматически заводит следующие таблицы (коллекции).

### Таблица: `UsersData`

Хранит состояние между запросами для каждого пользователя на каждой платформе.

| Поле       | Тип                     | Описание                                              |
| ---------- | ----------------------- | ----------------------------------------------------- |
| `userId`   | string \| number        | ID пользователя (ключ записи вместе с `platform`)     |
| `data`     | Record<string, unknown> | Содержимое `ctx.userData` — произвольный JSON         |
| `meta`     | Record<string, unknown> | Метаданные: когда создан, последний запрос, платформа |
| `platform` | string                  | Имя платформы ('telegram', 'alisa', ...)              |

Запись определяется парой `userId + platform`: пользователь Telegram 42 и пользователь VK 42 — разные записи
(до 3.1.4 поиск шёл только по `userId`, и такие пользователи делили одну запись). `FileAdapter` хранит строки под
ключом `<platform>:<userId>` и сам переносит строки прежнего формата при первом обращении.

Создавать таблицы вручную не нужно. Описание всех встроенных таблиц (поля, ключи, индексы) экспортируется как
`DB_TABLES_SCHEMA` и после подключения передаётся DB-адаптеру в `ensureSchema()`: `FileAdapter` создаёт файлы сам,
`MongoAdapter` создаёт индексы (`{ userId, platform }`, `{ platform, path }`; коллекции MongoDB создаёт при первой
записи), SQL-адаптер обязан создать таблицы (см.
[спецификацию внешних адаптеров](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/adapter/external-db-adapter-spec)).

### Таблица: `ImageTokens`

Кэш для изображений, которые нужно загрузить в платформу при их отправке.

| Поле         | Тип    | Описание                                             |
| ------------ | ------ | ---------------------------------------------------- |
| `imageToken` | string | Уникальный ID изображения на платформе (primary key) |
| `path`       | string | Локальный путь или CDN URL оригинала                 |
| `platform`   | string | Имя платформы для которой загружено                  |

Повторное использование одного и того же `path` не перезагружает изображение.

### Таблица: `SoundTokens`

Аналог ImageTokens для аудиофайлов.

| Поле         | Тип    | Описание                                       |
| ------------ | ------ | ---------------------------------------------- |
| `soundToken` | string | Уникальный ID звука на платформе (primary key) |
| `path`       | string | Локальный путь или CDN URL оригинала           |
| `platform`   | string | Имя платформы                                  |

### Пользовательские таблицы

Если вы создаёте свою модель — наследуйте от `Model`:

```ts
import { Model, IModelState, IModelRules, AppContext } from 'umbot';

interface IMyState extends IModelState {
    id: string | null;
    name: string | null;
    age: number | string | null; // string допускает текстовую метку поля (attributeLabels)
}

const RULES: IModelRules[] = [
    { name: ['name'], type: 'string', max: 200 },
    { name: ['age'], type: 'integer' },
];

class MyTable extends Model<IMyState> {
    constructor(appContext: AppContext) {
        super(appContext);
        this.state = { id: null, name: null, age: null };
    }

    rules() {
        return RULES;
    }

    attributeLabels() {
        return { id: 'ID', name: 'Имя', age: 'Возраст' };
    }

    tableName() {
        return 'my_table';
    }
}
```

> **Обратите внимание:** `tableName()`, `rules()` и `attributeLabels()` — публичные абстрактные методы, переопределять их нужно без модификатора `protected`. Допустимые типы полей в `rules()`: `'text' | 'string' | 'integer' | 'int' | 'date' | 'bool'`. Первичный ключ определяется автоматически по метке `'id'`/`'ID'` в `attributeLabels()`.

### Требования к БД-провайдеру

| Провайдер        | Заметки                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **FileAdapter**  | Простой JSON-файл в `./json`. Не потокобезопасен, только для разработки/локальных тестов.                                        |
| **MongoAdapter** | Production-ready. Использует официальный драйвер `mongodb` v7 (Stable API v1) — совместим с актуальными версиями MongoDB Server. |

Таблицы, коллекции и индексы создаются автоматически: сразу после подключения к базе фреймворк вызывает
`ensureSchema()` адаптера, до первого запроса.

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
    ISendMessage,
    ISendButton,
    IBroadcastOptions,
    IBroadcastResult,
    IButtonAction,
    IMenu,
    IMenuOptions,
    IMenuScreen,
    IMenuButton,
    IDbTableSchema,
    Request,
    IRequestSend,
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
import {
    rateLimiter,
    destroyRateLimiter,
    RateLimitQueueOverflowError,
    authGuard,
    requestId,
    maintenance,
    ipFilter,
} from 'umbot/middleware';

// Утилиты (Text доступен и из 'umbot')
import { loadEnvFile } from 'umbot/utils';

// Локальное тестирование
import { BotTest, IBotTestParams } from 'umbot/test';

// Предзагрузка медиа
import { Preload, IOptions as IPreloadOptions } from 'umbot/preload';

// Утилита упрощённого запуска
import { run, IConfig, TMode } from 'umbot/build';
```

### Константы платформ и интентов

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
