# Справочник API umbot

Данный справочник содержит описание основных публичных классов, методов и интерфейсов фреймворка umbot. Для начала
работы смотрите раздел [«Быстрый старт»](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_getting-started.html).

## Основные классы

### BotController

Основной класс для управления логикой приложения. Предоставляет базовый функционал для обработки пользовательских запросов,
управления состоянием и взаимодействия с различными платформами.

#### Свойства

| Свойство            | Тип                                                      | Описание                                                                                                                                        |
| ------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| text                | string                                                   | Текст ответа пользователю                                                                                                                       |
| tts                 | string \| null                                           | Текст для озвучки (на голосовых платформах, если `null` — может быть автоматически подставлен из `text`)                                        |
| buttons             | Buttons                                                  | Компонент кнопок (инициализируется лениво через getter)                                                                                         |
| card                | Card                                                     | Компонент карточек/галерей (инициализируется лениво через getter)                                                                               |
| nlu                 | Nlu                                                      | Данные NLU (инициализируется лениво через getter)                                                                                               |
| sound               | Sound                                                    | Звуковые эффекты (инициализируется лениво через getter)                                                                                         |
| userId              | string \| number \| null                                 | Идентификатор пользователя                                                                                                                      |
| userToken           | string \| null                                           | Токен авторизации пользователя (если платформа его предоставляет)                                                                               |
| userMeta            | unknown \| null                                          | Доп. информация о пользователе (зависит от платформы)                                                                                           |
| messageId           | number \| string \| null                                 | ID сообщения (часто используется для определения “первого” сообщения)                                                                           |
| userCommand         | string \| null                                           | Команда пользователя в нижнем регистре                                                                                                          |
| originalUserCommand | string \| null                                           | Оригинальная команда пользователя                                                                                                               |
| payload             | Record\<string, unknown\> \| string \| null \| undefined | Дополнительные параметры запроса (payload)                                                                                                      |
| eventType           | TEventType                                               | Универсальный тип события (`'message'`, `'photo'`, `'callback'`, `'start'`, …). Заполняется адаптером платформы; основа роутинга `bot.addEvent` |
| match               | RegExpExecArray \| null                                  | Совпадение команды с регуляркой (лениво): группы в `match[1]`, `match.groups`. `null` для строковых команд                                      |
| api                 | IControllerApi \| null                                   | API-фасад активной платформы: `sendPhoto/sendDocument/sendAudio/sendVideo/answerCallback/can`. Ленивый объект; `null` на голосовых платформах   |
| userData            | TUserData                                                | Данные пользователя (БД или локальное хранилище, в зависимости от `setAppConfig`)                                                               |
| state               | TPlatformState \| null                                   | Локальное хранилище платформы (если платформа поддерживает и включено `isLocalStorage`)                                                         |
| isAuth              | boolean                                                  | Флаг “нужно запросить авторизацию” (поддержка зависит от платформы)                                                                             |
| userEvents          | IUserEvent \| null                                       | События пользователя (авторизация/оценка), если платформа присылает                                                                             |
| isScreen            | boolean                                                  | Есть ли экран у пользователя (если платформа сообщает)                                                                                          |
| isEnd               | boolean                                                  | Завершить диалог/сессию (поддержка зависит от платформы)                                                                                        |
| skipAutoReply       | boolean                                                  | Если `true`, фреймворк не будет пытаться “авто-отправить” ответ (актуально для платформ, где вы сами отправляете сообщения через API)           |
| requestObject       | Record<string, unknown> \| string \| unknown \| null     | Оригинальный объект запроса от платформы                                                                                                        |
| thisIntentName      | string \| null                                           | Имя шага/интента, которое нужно сохранить как “следующий шаг”                                                                                   |
| oldIntentName       | string \| null                                           | Имя предыдущего шага/интента (из `userData.oldIntentName` или из `state.oldIntentName`)                                                         |
| emotion             | string \| null                                           | Эмоция ответа (если платформа поддерживает)                                                                                                     |
| appeal              | 'official' \| 'no_official' \| null                      | Стиль обращения (если платформа поддерживает)                                                                                                   |
| isSendRating        | boolean                                                  | Запросить у пользователя оценку (если платформа поддерживает)                                                                                   |
| appContext          | AppContext                                               | Контекст приложения (конфиг, реестры, логгер)                                                                                                   |
| appType             | TAppType \| null                                         | Платформа, от которой получен запрос (заполняется фреймворком при обработке)                                                                    |

#### Методы

| Метод          | Параметры                                                         | Возвращаемое значение | Описание                                                                                           |
| -------------- | ----------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| action         | intentName: string \| null, isCommand?: boolean, isStep?: boolean | void                  | Ваш основной обработчик. Вызывается фреймворком (переопределяется в наследнике)                    |
| run            | -                                                                 | void \| Promise<void> | Запуск обработки запроса (вызывается фреймворком; вручную обычно не вызывают)                      |
| setAppContext  | appContext: AppContext                                            | this                  | Установка контекста приложения (обновляет контекст в уже созданных компонентах `buttons` и `card`) |
| clearStoreData | -                                                                 | void                  | Полный сброс состояния контроллера: текст, tts, пользовательские данные, флаги и кэш NLU           |
| isButtonsInit  | -                                                                 | boolean               | `true`, если компонент кнопок был инициализирован (через getter `buttons`)                         |
| isCardInit     | -                                                                 | boolean               | `true`, если компонент карточек был инициализирован (через getter `card`)                          |
| isSoundInit    | -                                                                 | boolean               | `true`, если компонент звуков был инициализирован (через getter `sound`)                           |
| isNluInit      | -                                                                 | boolean               | `true`, если компонент NLU был инициализирован (через getter `nlu`)                                |

### Bot

Основной класс-оркестратор. Управляет жизненным циклом, middleware, регистрацией команд и запуском сервера.

#### Методы

| Метод                    | Параметры                                                                                                                                            | Возвращаемое значение          | Описание                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| setAppConfig             | config: Partial\<IAppConfig\>                                                                                                                        | Bot                            | Установка конфигурации приложения                                                                                                                                                                       |
| setAppMode               | mode: TAppMode (`'dev' \| 'prod' \| 'strict_prod'`)                                                                                                  | Bot                            | Установка режима работы                                                                                                                                                                                 |
| setPlatformParams        | params: IAppParam                                                                                                                                    | Bot                            | Установка параметров платформы                                                                                                                                                                          |
| initBotController        | controller: TBotControllerClass                                                                                                                      | Bot                            | Подключение класса контроллера                                                                                                                                                                          |
| addCommand               | commandName: string, slots: TSlots, cb: (userCommand: string, bc: BotController) => void \| string \| Promise\<void \| string\>, isPattern?: boolean | Bot                            | Регистрация команды                                                                                                                                                                                     |
| addAction                | actionName: string, cb: (userCommand: string, bc: BotController) => void \| string \| Promise\<void \| string\>                                      | Bot                            | Обработчик нажатия callback-кнопки по payload (аналог `bot.action()` у Telegram-фреймворков). Payload `'buy'` / `{"command":"buy"}` вызывает команду `buy` (Telegram, VK, MAX)                          |
| addEvent                 | eventType: TEventType, cb: (bc: BotController) => void \| string \| Promise\<void \| string\> \| false                                               | Bot                            | Обработчик события платформы (фото, голосовое, callback, start и др.). Вызывается до шагов и команд; `false` — передать запрос обычному конвейеру                                                       |
| removeEvent              | eventType: TEventType                                                                                                                                | Bot                            | Удаление всех обработчиков события                                                                                                                                                                      |
| clearEvents              | -                                                                                                                                                    | Bot                            | Удаление всех событийных обработчиков                                                                                                                                                                   |
| removeCommand            | commandName: string                                                                                                                                  | Bot                            | Удаление команды по имени                                                                                                                                                                               |
| clearCommands            | -                                                                                                                                                    | Bot                            | Удаление всех команд                                                                                                                                                                                    |
| addStep                  | stepName: string, handler: IStepParam['cb']                                                                                                          | Bot                            | Регистрация шага (цепочки диалога)                                                                                                                                                                      |
| removeStep               | stepName: string                                                                                                                                     | Bot                            | Удаление шага по имени                                                                                                                                                                                  |
| clearSteps               | -                                                                                                                                                    | Bot                            | Удаление всех шагов                                                                                                                                                                                     |
| addForm                  | formName: string, options: IAddFormOptions                                                                                                           | Bot                            | Регистрация многошаговой формы с валидацией полей                                                                                                                                                       |
| removeForm               | formName: string                                                                                                                                     | Bot                            | Удаление формы и всех её шагов                                                                                                                                                                          |
| use                      | fn: MiddlewareFn \| platform: TAppType, fn: MiddlewareFn \| plugin: TPlugin                                                                          | Bot                            | Подключение middleware или плагина                                                                                                                                                                      |
| clearUse                 | -                                                                                                                                                    | Bot                            | Удаление всех платформ, плагинов и middleware                                                                                                                                                           |
| setCustomCommandResolver | resolver: TCommandResolver                                                                                                                           | Bot                            | Установка кастомного резолвера команд                                                                                                                                                                   |
| setCommandGroupMode      | mode: TCommandGroupMode                                                                                                                              | Bot                            | Режим группировки RegExp                                                                                                                                                                                |
| setPlatformResolver      | resolver: TPlatformResolver                                                                                                                          | Bot                            | Установка функции определения платформы                                                                                                                                                                 |
| setLogger                | logger: ILogger \| null                                                                                                                              | Bot                            | Установка кастомного логгера (null — отключить)                                                                                                                                                         |
| getAppContext            | -                                                                                                                                                    | AppContext                     | Получение контекста приложения                                                                                                                                                                          |
| setContent               | content: TBotContent (`object \| string \| null`)                                                                                                    | void                           | Установка содержимого запроса (для тестирования)                                                                                                                                                        |
| run                      | appType?: TAppType \| null, content?: string \| object \| null, auth?: TBotAuth, clientIp?: string                                                   | Promise\<TRunResult\>          | Обработка входящего запроса. Все параметры имеют дефолты (`null`), т.е. вызов без аргументов валиден. `clientIp` доступен middleware через `controller.platformOptions.clientIp` (например, `ipFilter`) |
| webhookHandle            | req: IncomingMessage, res: ServerResponse, responseCb?: TBotResponseCb                                                                               | Promise\<void\>                | Обработчик HTTP-запроса (для Express/Fastify интеграции)                                                                                                                                                |
| webhookEvent             | data: string \| object \| null, headers?: Record\<string, unknown\>, clientIp?: string                                                               | Promise\<IWebhookEventResult\> | Обработка события serverless-платформы (Yandex Cloud Functions, AWS Lambda) с проверкой подписи вебхука. Возвращает `{ statusCode, body }` для возврата из cloud-функции                                |
| start                    | hostname?: string, port?: number, responseCb?: TBotResponseCb                                                                                        | Server                         | Запуск HTTP-сервера (возвращает экземпляр Server)                                                                                                                                                       |
| close                    | -                                                                                                                                                    | Promise\<void\>                | Остановка HTTP-сервера и очистка ресурсов                                                                                                                                                               |
| send                     | userId: string \| number, controllerOrText: BotController \| string, platform: TAppType                                                              | Promise\<unknown \| boolean\>  | Отправка сообщения пользователю (для платформ с поддержкой)                                                                                                                                             |

## Компоненты

### Buttons

Компонент для работы с кнопками интерфейса.

#### Методы

| Метод         | Параметры                                                                                       | Возвращаемое значение | Описание                                                                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| addBtn        | title: string \| null, url?: string \| null, payload?: TButtonPayload, options?: IButtonOptions | this                  | Добавление кнопки                                                                                                                                                                                     |
| addLink       | title: string \| null, url?: string, payload?: TButtonPayload, options?: IButtonOptions         | this                  | Добавление кнопки-ссылки                                                                                                                                                                              |
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

> ⚠️ `bot.addCommand(FALLBACK_COMMAND, [], cb)` работает, потому что fallback ищется конвейером отдельно (до интентов).
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
    cb: (botController: TBotController) => void | Promise<void> | false;
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

Поддержка объявляется самим адаптером (поле `supportedEvents`): Telegram — медиа/callback/inline/edited/каналы; VK — message/callback; MAX — message/callback/start/edited; Viber — медиа-типы/start/subscribed/unsubscribed; Алиса — message/auth; SmartApp — message/start/rating; Маруся — message/auth. Обработчик просто не вызывается там, где событие физически невозможно — мультиплатформенный бот не ломается. Кастомная платформа (`BasePlatform`) объявляет собственный `supportedEvents` и автоматически участвует в валидации: `bot.addEvent` предупреждает, если событие не поддерживает ни один подключённый адаптер (обработчик при этом регистрируется и заработает после подключения нужной платформы).

Сводная таблица `supportedEvents` по адаптерам (значения — из `supportedEvents` в коде адаптеров):

| Платформа | `supportedEvents`                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Telegram  | `message`, `photo`, `voice`, `video`, `document`, `location`, `contact`, `sticker`, `callback`, `inline`, `message_edited`, `channel_post` |
| VK        | `message`, `callback`                                                                                                                      |
| MAX       | `message`, `callback`, `start`, `message_edited`                                                                                           |
| Viber     | `message`, `photo`, `video`, `document`, `contact`, `location`, `sticker`, `start`, `subscribed`, `unsubscribed`                           |
| Алиса     | `message`, `auth`                                                                                                                          |
| Маруся    | `message`, `auth`                                                                                                                          |
| SmartApp  | `message`, `start`, `rating`                                                                                                               |

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

### Действия кнопок (`addAction`)

Обработчик нажатия callback-кнопки по её payload — как `bot.action()` у конкурентов. Кнопка создаётся с payload (`buttons.addBtn('Купить', '', 'buy')`), адаптеры Telegram/VK/MAX нормализуют payload в имя команды:

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

На платформах без callback-кнопок (Алиса, Маруся) кнопки отправляют текст, который матчится штатным слотом — обработчик не требуется.

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

Фасад — ленивый объект: создаётся при первом обращении к `ctx.api`, на голосовых платформах (Алиса, Маруся, SmartApp) равен `null` (их ответ формируется телом webhook — используйте `card`/`sound`). Неподдерживаемые методы логируют предупреждение и возвращают `null`; поддержка проверяется заранее через `can()`. У Viber `can()` возвращает `false` для всех методов — Bot API Viber требует URL и размер файла, поэтому фасад там недоступен.

Фасад выбирается адаптером: метод `createApi(controller)` контракта `IPlatformAdapter` (базовая реализация `BasePlatform` возвращает `null`). Кастомная платформа подключает свой фасад переопределением этого метода — возвращает объект, реализующий `IControllerApi`; пример — в [platform-integration.md](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_platform-integration.html), раздел «API платформы».

### Формы (`addForm`)

Многошаговая форма — обёртка над шагами: каждое поле становится отдельным шагом, ответы собираются в объект и передаются в `onComplete`.

```ts
// Одно поле формы
interface IAddFormField<TBotController extends BotController = BotController> {
    name: string; // Ключ поля в объекте ответов
    prompt: string | ((ctx: TBotController) => string); // Вопрос пользователю
    // true — принято; false — повторить prompt; string — текст ошибки пользователю
    validate?: (value: string) => boolean | string | Promise<boolean | string>;
}

// Параметры addForm
interface IAddFormOptions<TBotController extends BotController = BotController> {
    fields: IAddFormField<TBotController>[]; // Поля, обрабатываются последовательно
    onComplete: (ctx: TBotController, answers: Record<string, string>) => void | Promise<void>; // Вызывается после заполнения всех полей
    cancelText?: string; // Текст при отмене (по умолчанию 'Форма отменена.')
    cancelCommands?: string[]; // Команды отмены (по умолчанию ['отмена', 'cancel'])
}
```

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

Контекст приложения — синглтон-хранилище конфигурации, реестров и подключенных модулей.

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

| Метод                           | Описание                   |
| ------------------------------- | -------------------------- |
| `log(...args)`                  | Логирование                |
| `logError(msg, meta?)`          | Логирование ошибок         |
| `logWarn(msg, meta?)`           | Логирование предупреждений |
| `logMetric(name, value, label)` | Логирование метрик         |

### Navigation

Компонент для постраничной навигации по спискам и меню.

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

#### Методы Preload

| Метод          | Параметры                                               | Возвращаемое значение       | Описание                                                                                                                     |
| -------------- | ------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `loadImages`   | `paths: string[]`, `platforms?: TAppType[]`, `options?` | `Promise<string \| null>[]` | Загрузить изображения (разрешается токеном изображения или `null` при ошибке)                                                |
| `loadSounds`   | `paths: string[]`, `platforms?: TAppType[]`, `options?` | `Promise<string \| null>[]` | Загрузить звуки (разрешается токеном звука или `null` при ошибке)                                                            |
| `removeImages` | `paths: string[]`, `platforms?: TAppType[]`             | `Promise<boolean>[]`        | Удалить изображения (реализация — только Алиса и Маруся; для остальных платформ промис завершается `true`, ничего не удаляя) |
| `removeSounds` | `paths: string[]`, `platforms?: TAppType[]`             | `Promise<boolean>[]`        | Удалить звуки (реализация — только Алиса и Маруся; для остальных платформ промис завершается `true`, ничего не удаляя)       |

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

| Метрика              | Константа               | Что измеряет                                                   |
| -------------------- | ----------------------- | -------------------------------------------------------------- |
| Время запроса        | `EMetric.REQUEST`       | Время исходящего HTTP-запроса к API платформы (внутри Request) |
| Начало webhook       | `EMetric.START_WEBHOOK` | Момент начала обработки запроса                                |
| Время webhook        | `EMetric.END_WEBHOOK`   | Общее время обработки webhook (входящий запрос)                |
| Поиск интента        | `EMetric.GET_INTENT`    | Время поиска подходящего интента                               |
| Поиск команды        | `EMetric.GET_COMMAND`   | Время поиска подходящей команды                                |
| Выполнение action    | `EMetric.ACTION`        | Время выполнения вашего `action()`                             |
| Middleware           | `EMetric.MIDDLEWARE`    | Время выполнения middleware-цепочки                            |
| Запрос к БД (SELECT) | `EMetric.DB_SELECT`     | Время выполнения SELECT                                        |
| Запрос к БД (INSERT) | `EMetric.DB_INSERT`     | Время выполнения INSERT                                        |
| Запрос к БД (UPDATE) | `EMetric.DB_UPDATE`     | Время выполнения UPDATE                                        |
| Запрос к БД (REMOVE) | `EMetric.DB_REMOVE`     | Время выполнения DELETE                                        |

Пример подключения:

```ts
bot.setLogger({
    metric: (name: string, value: unknown, meta?: Record<string, unknown>) => {
        console.log(`[METRIC] ${name}: ${value}`, meta);
    },
});
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

#### Методы Model

| Метод                   | Описание                                       |
| ----------------------- | ---------------------------------------------- |
| `add()`                 | Вставка новой записи                           |
| `update()`              | Обновление текущей записи                      |
| `remove()`              | Удаление записи                                |
| `whereOne(where?)`      | Поиск одной записи по условиям                 |
| `where(where?, isOne?)` | Поиск записей по условиям                      |
| `query(callback)`       | Сырой запрос к БД                              |
| `save(isNew?)`          | Сохранение (add если isNew=true, иначе update) |

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
| `userId`   | string \| number        | ID пользователя (primary key)                         |
| `data`     | Record<string, unknown> | Содержимое `ctx.userData` — произвольный JSON         |
| `meta`     | Record<string, unknown> | Метаданные: когда создан, последний запрос, платформа |
| `platform` | string                  | Имя платформы ('telegram', 'alisa', ...)              |

Индексы фреймворком не создаются: поиск идёт по первичному ключу `userId`. Если вашей нагрузке нужны индексы (например, уникальная пара `userId + platform`), создайте их в MongoDB самостоятельно.

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

Все таблицы создаются автоматически на первом запросе.
