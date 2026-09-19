# Создание адаптера платформы (Platform Adapter)

Адаптер платформы — это мост между сырым JSON/XML запросом от внешней платформы и унифицированным контроллером
`BotController`. Ваша задача: распарсить входящие данные, наполнить контроллер, обработать UI-компоненты (кнопки,
картинки, звуки) и сформировать ответ строго по контракту конкретной платформы.

Адаптер наследуется от базового класса `BasePlatformAdapter<TQuery>` из `umbot/plugins` (в исходниках фреймворка
класс называется `BasePlatform` — `BasePlatformAdapter` это его публичный алиас при реэкспорте). Для примеров ниже
подключите всё необходимое одним блоком:

```ts
import { BasePlatformAdapter, TContent } from 'umbot/plugins';
import { BotController, Text } from 'umbot'; // BotController и Text экспортируются из корня 'umbot'
```

## Контракт адаптера: что обязательно, а что опционально

Контракт описан интерфейсом `IPlatformAdapter` (экспортируется из `umbot`). Базовый класс закрывает
большую часть контракта рабочими реализациями: обязательных членов всего четыре, остальные
переопределяются по мере надобности.

| Член контракта                                           | Обязателен           | Поведение по умолчанию                      | Назначение                                                                                                        |
| -------------------------------------------------------- | -------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `platformName`                                           | **да**               | `'unknown'`                                 | Идентификатор платформы: ядро регистрирует адаптер в `appContext.platforms` и сопоставляет с `controller.appType` |
| `isPlatformOnQuery(query, headers?)`                     | **да** (абстрактный) | —                                           | «Этот запрос мой?»                                                                                                |
| `setQueryData(query, controller)`                        | **да** (абстрактный) | —                                           | Разбор входящего запроса и заполнение контроллера                                                                 |
| `getContent(controller, stateData?)`                     | **да** (абстрактный) | —                                           | Сборка ответа в формате платформы                                                                                 |
| `isVoice`                                                | нет                  | `true`                                      | Голосовая ли платформа. **Чат-платформа обязана выставить `false`**                                               |
| `supportedEvents`                                        | нет                  | `['message']`                               | События, которые адаптер выставляет в `controller.eventType` (см. «События платформы»)                            |
| `createApi(controller)`                                  | нет                  | `null`                                      | Фасад `controller.api` (см. «API-фасад платформы»)                                                                |
| `signatureName`                                          | нет                  | не задан                                    | Имя HTTP-заголовка, в котором платформа передаёт подпись вебхука                                                  |
| `isCorrectQuery(query, headers?)`                        | нет                  | HMAC SHA256 по `signatureName` и токену     | Проверка подлинности запроса                                                                                      |
| `isSignatureCheckEnabled()`                              | нет                  | `true`, если заданы токен и `signatureName` | Сообщает ядру, защищён ли вебхук: по нему `bot.start()` предупреждает о незащищённой точке входа                  |
| `limit`                                                  | нет                  | `null`                                      | Лимит запросов/сек для middleware `rateLimiter`                                                                   |
| `isLocalStorage` / `getLocalStorage` / `setLocalStorage` | нет                  | `false` / `null` / пусто                    | Хранилище состояния на стороне платформы                                                                          |
| `getQueryExample(query, userId, count, state)`           | нет                  | generic-заглушка                            | Пример запроса платформы для `BotTest`                                                                            |
| `getRatingContext(controller)`                           | нет                  | вызывает `getContent`                       | Ответ на запрос оценки приложения                                                                                 |
| `send(userId, controllerOrText)`                         | нет                  | собирает контроллер и вызывает `getContent` | Активные рассылки через `bot.send()`                                                                              |
| `soundProcessing(controller)`                            | нет                  | пусто                                       | Дополнительная обработка озвучки                                                                                  |
| `init(appContext)`                                       | нет                  | регистрация в `appContext.platforms`        | Инициализация адаптера                                                                                            |

Минимальный каркас адаптера чат-платформы выглядит так — дальше по документу каждый метод разбирается
подробно:

```ts
import { BasePlatformAdapter } from 'umbot/plugins';
import { BotController, TEventType } from 'umbot';

interface IMyQuery {
    update_id?: number;
    user_id?: string;
    text?: string;
}

export class MyPlatformAdapter extends BasePlatformAdapter<IMyQuery> {
    platformName = 'my_platform';
    isVoice = false; // чат-платформа: ответ уходит через API, а не телом вебхука
    limit = 30; // лимит платформы, запросов/сек (использует middleware rateLimiter)
    supportedEvents: readonly TEventType[] = ['message', 'photo', 'callback'];

    isPlatformOnQuery(query: IMyQuery): boolean {
        return typeof query?.update_id === 'number';
    }

    setQueryData(query: IMyQuery, controller: BotController): boolean {
        controller.appType = this.platformName;
        controller.userId = query.user_id ?? '';
        controller.originalUserCommand = query.text ?? '';
        controller.userCommand = controller.originalUserCommand.toLowerCase().trim();
        return true;
    }

    async getContent(controller: BotController): Promise<string> {
        // отправка ответа через API платформы — см. «Формирование ответа»
        await Promise.resolve(controller.text);
        return 'ok';
    }
}
```

### Голосовая платформа или чат (`isVoice`)

Флаг `isVoice` базового класса равен `true` — базовая реализация рассчитана на голосовую платформу.
Мессенджеру обязательно выставьте `false`, иначе:

- ядро будет копировать `controller.text` в `controller.tts`, когда `tts` не задан явно (для чата это
  лишняя озвучка и лишние запросы к синтезу речи);
- `BotTest` станет искать ответ в теле вебхука (`response.text` / `response.tts`) вместо
  `controller.text` — консольное тестирование покажет «пусто».

## Инициализация и идентификация платформы

Когда на сервер приходит запрос, фреймворк перебирает все подключенные адаптеры и спрашивает: «Это твой запрос?».

### Определение платформы (isPlatformOnQuery)

Вы должны реализовать метод, который по заголовкам или по телу запроса понимает, относится ли он к вашей платформе.

**Пример**: Платформа WeChat отправляет специфичный заголовок x-wechat-signature и XML в теле. Telegram отправляет
заголовок x-telegram-bot-api-secret-token.

```ts
isPlatformOnQuery(query: unknown, headers?: Record<string, unknown>): boolean {
    const q = query as Record<string, unknown>;
    // 1. Проверяем заголовки (самый надежный способ)
    if (headers?.['x-wechat-signature']) return true;

    // 2. Фолбэк: проверяем уникальные поля в теле запроса
    return !!(q.xml_msg || q.specific_wechat_field);
}
```

### Проверка безопасности

Если платформа требует проверки подписи (токена), переопределяйте этот метод. По умолчанию `BasePlatformAdapter` умеет
проверять HMAC SHA256, **но только если оба параметра заданы**:

- `signatureName` — имя поля в заголовке запроса
- `token` — секретный токен в конфигурации

Если хотя бы один из параметров не задан, `isCorrectQuery()` вернет `true` (проверка будет пропущена).

Если стандартной проверки недостаточно (например, платформа использует Ed25519 вместо HMAC SHA256), переопределите метод
`isCorrectQuery` и реализуйте свою логику валидации.

**Примечание:** Если вы получаете ошибки при проверке подписи, убедитесь, что:

1. Поле `signatureName` установлено в классе адаптера
2. Токен зарегистрирован в `appContext.appConfig.tokens[this.platformName].token`

### Отчёт о защищённости вебхука (`isSignatureCheckEnabled`)

При `bot.start()` ядро обходит подключённые адаптеры и предупреждает в лог, если вебхук принимает
запросы платформы без проверки подлинности. Спрашивает оно сам адаптер — методом
`isSignatureCheckEnabled()`. Базовая реализация возвращает `true`, только когда заданы и
`signatureName`, и токен платформы.

Переопределяйте метод, если подлинность проверяется не HMAC-схемой по заголовку. Так делает VK:
секрет приходит полем в теле запроса, `signatureName` у платформы нет.

```ts
// Метод адаптера
isSignatureCheckEnabled(): boolean {
    // секрет приходит в теле запроса, а не в заголовке
    return Boolean(this.appContext?.appConfig.tokens[this.platformName]?.secret_key);
}
```

Метод отвечает на вопрос «защищён ли вебхук в текущей конфигурации» — возвращайте реальное
положение дел. Если у платформы подписи нет по построению (как у Алисы, Маруси и SmartApp),
предупреждение при старте справедливо: защищать такой вебхук нужно на других уровнях
(middleware `ipFilter`, секрет в пути URL, проверки в бизнес-логике).

## Парсинг запроса (setQueryData)

Задача: Взять сырой `query` и заполнить поля `controller`. От того, как вы заполните контроллер, зависит корректная
работа бизнес-логики приложения

**Обязательные поля для заполнения:**

- `controller.userId` (string | number) — уникальный ID пользователя.
- `controller.userCommand` (string) — текст команды в нижнем регистре (нужно для поиска команд).
- `controller.originalUserCommand` (string) — оригинальный текст как есть.
- `controller.messageId` (number | string | null) — ID сообщения (нужно для определения начала диалога).
- `controller.appType` = `this.platformName` — тип платформы: по нему ядро находит адаптер в реестре.

**Опциональные, но важные поля:**

- `controller.nlu.setNlu(...)` — если платформа присылает NLU/интенты.
- `controller.userMeta` — метаданные (например, есть ли у юзера экран).
- `controller.payload` — дополнительные данные (например, нажатая кнопка).

Нюанс `messageId`: начало диалога определяется строго по `messageId === 0` — адаптер обязан выставлять `0` для первого сообщения диалога (иначе welcome-интент не сработает).

```ts
setQueryData(query: unknown, controller: BotController): boolean {
    const q = query as Record<string, unknown>;
    if (!q) {
        controller.platformOptions.error = 'Пустой запрос';
        return false;
    }

    controller.requestObject = query; // Сохраняем оригинал
    controller.appType = this.platformName; // Обязательно: ядро ищет адаптер по этому полю
    controller.userId = q.user_id as string | number;
    controller.userCommand = ((q.text as string) || '').toLowerCase().trim();
    controller.originalUserCommand = (q.text as string) || '';
    controller.messageId = q.message_id as string | number;

    // Если платформа присылает данные о юзере
    if (q.user) {
        controller.nlu.setNlu({
            thisUser: { username: (q.user as Record<string, unknown>).name as string },
        });
    }

    return true;
}
```

## События платформы (`controller.eventType` и `supportedEvents`)

Не-текстовые апдейты — фото, голосовое, нажатие callback-кнопки, редактирование сообщения, старт
диалога, подписка — роутятся через универсальный событийный слой. Адаптер приводит свой тип
апдейта к одному из значений `TEventType` и записывает его в `controller.eventType`, а разработчик
приложения пишет обработчик один раз для всех платформ сразу:

```ts
bot.addEvent('photo', async (ctx) => {
    ctx.text = 'Фото получено!';
});
```

Обработчики событий вызываются до шагов и команд. Если ваш адаптер не заполняет `eventType`,
любой запрос считается обычным сообщением (`'message'`), и платформа выпадает из событийного
роутинга — при этом ничего не падает, поэтому пропуск легко не заметить.

### Заполнение `controller.eventType`

Значение по умолчанию — `'message'`. Остальные значения выставляйте там, где разобрали тип
апдейта:

| Событие                                                                 | Когда выставлять                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `message`                                                               | обычный текстовый ввод, в том числе распознанная платформой речь (дефолт)      |
| `photo`, `voice`, `video`, `document`, `location`, `contact`, `sticker` | сообщение с вложением соответствующего типа                                    |
| `callback`                                                              | нажатие inline/callback-кнопки                                                 |
| `inline`                                                                | inline-запрос (пользователь печатает «@бот …» в поле ввода)                    |
| `message_edited`                                                        | пользователь отредактировал ранее отправленное сообщение                       |
| `channel_post`                                                          | сообщение или пост в канале                                                    |
| `start`                                                                 | первый вход в бота или навык; deep-link payload кладите в `controller.payload` |
| `subscribed`, `unsubscribed`                                            | подписка на бота и отписка от него                                             |
| `auth`                                                                  | завершение привязки аккаунта                                                   |
| `rating`                                                                | результат оценки приложения                                                    |

Полный перечень доступен константой `ALL_EVENT_TYPES`, проверка имени — функцией
`isEventType(name)`; и то, и другое экспортируется из `umbot`.

```ts
import { BasePlatformAdapter, pUtils } from 'umbot/plugins';
import { BotController, TEventType } from 'umbot';

interface IMyQuery {
    update_id?: number;
    user_id?: string;
    text?: string;
    photo?: { file_id: string };
    callback?: { payload?: unknown };
}

export class MyPlatformAdapter extends BasePlatformAdapter<IMyQuery> {
    platformName = 'my_platform';
    isVoice = false;
    supportedEvents: readonly TEventType[] = ['message', 'photo', 'callback'];

    isPlatformOnQuery(query: IMyQuery): boolean {
        return typeof query?.update_id === 'number';
    }

    setQueryData(query: IMyQuery, controller: BotController): boolean {
        controller.requestObject = query;
        controller.appType = this.platformName;
        controller.userId = query.user_id ?? '';

        if (query.callback) {
            // Нажатие кнопки: payload становится командой (см. «Callback-кнопки»)
            controller.eventType = 'callback';
            controller.payload = query.callback.payload as Record<string, unknown>;
            controller.userCommand = pUtils.normalizeActionPayload(query.callback.payload);
            controller.originalUserCommand = controller.userCommand;
            return true;
        }

        if (query.photo) {
            controller.eventType = 'photo';
        }

        controller.originalUserCommand = query.text ?? '';
        controller.userCommand = controller.originalUserCommand.toLowerCase().trim();
        return true;
    }

    async getContent(controller: BotController): Promise<string> {
        await Promise.resolve(controller.text);
        return 'ok';
    }
}
```

Во встроенных адаптерах есть две готовые функции-сопоставления, их удобно взять за образец:
`pUtils.telegramMessageEvent(message)` определяет событие по вложениям сообщения Telegram
(`photo`, `voice`, `video`, `document`, `location`, `contact`, `sticker`, иначе `message`), а
`pUtils.viberMessageEvent(type)` — по полю `message.type` у Viber (`picture` → `photo`,
`file` → `document` и так далее).

### Объявление `supportedEvents`

Поле `supportedEvents` — перечень событий, которые адаптер реально выставляет. Базовое значение
`BasePlatformAdapter` — `['message']`, поэтому платформе, умеющей только текст, поле можно не
трогать.

```ts
supportedEvents: readonly TEventType[] = ['message', 'photo', 'callback'];
```

Что важно понимать про это поле:

- **Оно не фильтрует обработку.** При обработке запроса `supportedEvents` не участвует: событие
  берётся из `controller.eventType`. Поле читается только в момент регистрации —
  `bot.addEvent(...)` предупреждает разработчика об опечатке в имени события и о событии, которого
  не выставляет ни один подключённый адаптер. Без объявления ваша платформа не сломается, но
  пользователи получат ложное предупреждение и решат, что событие не поддерживается.
- **Перечисляйте только реальность.** Событие в списке, которое `setQueryData` никогда не
  выставляет, отключит полезное предупреждение и спрячет чужую опечатку.
- **Прямая реализация `IPlatformAdapter`** (без наследования от `BasePlatformAdapter`) может поле
  не объявлять: ядро в этом случае считает его равным `['message']`.
- **События вне `TEventType`** (платформенная покупка, реакция на сообщение и подобное) в слой не
  заводятся — обрабатывайте их в `action()` по `controller.requestObject`.

Для справки — перечни встроенных адаптеров:

| Платформа | `supportedEvents`                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Telegram  | `message`, `photo`, `voice`, `video`, `document`, `location`, `contact`, `sticker`, `callback`, `inline`, `message_edited`, `channel_post` |
| Viber     | `message`, `photo`, `video`, `document`, `contact`, `location`, `sticker`, `start`, `subscribed`, `unsubscribed`                           |
| MAX       | `message`, `callback`, `start`, `message_edited`                                                                                           |
| VK        | `message`, `callback`                                                                                                                      |
| SmartApp  | `message`, `start`, `rating`                                                                                                               |
| Алиса     | `message`, `auth`                                                                                                                          |
| Маруся    | `message`, `auth`                                                                                                                          |

## Работа с UI-компонентами (Кнопки, Карточки, Звуки)

Фреймворк оперирует абстракциями (`IButtonType`, `ICardInfo`). Платформы требуют специфичные форматы. Чтобы превратить
абстракцию в формат платформы, используются функции-процессоры.

### Кнопки

Вам нужно написать функцию, которая принимает массив абстрактных кнопок и возвращает объект, понятный платформе.
Метод `controller.buttons.getButtons(ваш_процессор)` сам вызовет вашу функцию и отдаст результат.
Результат может быть `null` (пустой список кнопок) — учитывайте это при формировании ответа.

```ts
// IButtonType экспортируется из корня 'umbot'
// 1. Пишем процессор
function myPlatformButtonProcessing(buttons: IButtonType[]): MyPlatformKeyboard {
    return {
        inline_keyboard: buttons.map((btn) => ({
            text: btn.title,
            callback_data: btn.payload ? JSON.stringify(btn.payload) : btn.title,
        })),
    };
}

// 2. Вызываем внутри getContent (результат может быть null, если кнопок нет)
const keyboard = controller.buttons.getButtons(myPlatformButtonProcessing);
```

`payload` кнопки — произвольное значение (`Record<string, unknown> | string`), а платформы принимают
строку. Сериализуйте его через `pUtils.serializePlatformPayload(payload, platformName, appContext)`:
при несериализуемом значении хелпер вернёт `null` и напишет в лог предупреждение вместо того, чтобы
уронить сборку всей клавиатуры.

#### Callback-кнопки и `bot.addAction`

Если платформа умеет callback-кнопки (нажатие приходит отдельным апдейтом с payload), адаптер
отвечает за то, чтобы это нажатие выглядело для бизнес-логики как обычная команда. Тогда
разработчику приложения достаточно написать:

```ts
bot.addAction('buy', (text, ctx) => {
    ctx.text = 'Оформляю заказ';
});
```

`bot.addAction(name, handler)` регистрирует обработчик как команду с единственным слотом `name`,
поэтому всё, что требуется от адаптера при разборе нажатия, — три вещи:

1. выставить `controller.eventType = 'callback'`;
2. положить в `controller.userCommand` нормализованный payload — через
   `pUtils.normalizeActionPayload(raw)`: и строка `'buy'`, и JSON `{"command":"buy"}` превращаются в
   `buy`;
3. сохранить разобранный payload в `controller.payload` (`pUtils.tryParse(raw)`), чтобы бизнес-логика
   могла прочитать дополнительные поля.

Так устроены встроенные адаптеры Telegram, VK и MAX. Образец из `Telegram/Adapter.ts`:

```ts
import { pUtils } from 'umbot/plugins';
import { BotController } from 'umbot';

interface IMyCallback {
    id: string;
    data?: string;
    chat_id?: number;
}

function setCallbackQuery(callback: IMyCallback, controller: BotController): void {
    controller.eventType = 'callback';
    controller.userCommand = pUtils.normalizeActionPayload(callback.data);
    controller.originalUserCommand = callback.data || '';
    controller.payload = pUtils.tryParse(callback.data);

    // Технические данные нажатия — в изолированное хранилище адаптера:
    // из него их возьмёт API-фасад, чтобы ответить на нажатие.
    const data = pUtils.getPlatformRequestData<{ callbackId?: string; chatId?: number }>(
        controller,
        'my_platform',
    );
    data.callbackId = callback.id;
    if (callback.chat_id !== undefined) {
        data.chatId = callback.chat_id;
    }
}
```

`pUtils.getPlatformRequestData(controller, adapterKey)` — изолированное хранилище технических данных
запроса: общий контроллер не должен знать о полях конкретного транспорта, поэтому каждый адаптер
держит их под собственным ключом (обычно `this.platformName`). Оттуда же их читает API-фасад — см.
раздел ниже.

### Карточки и Изображения (Работа с БД)

Важно: `getImageToken` и `getSoundToken` находятся в `pUtils`, который экспортируется из `umbot/plugins`:

```ts
import { pUtils } from 'umbot/plugins';
import { ImageTokens, BotController } from 'umbot';
import { MyPlatformApi } from './MyPlatformApi';

async function myPlatformCardProcessing(cardInfo: ICardInfo, controller: BotController) {
    const elements = [];

    for (const image of cardInfo.images) {
        // Если токена еще нет, загружаем его
        if (!image.imageToken && image.imageDir) {
            image.imageToken = await pUtils.getImageToken(
                image.imageDir,
                'my_platform', // имя платформы
                controller,
                async (model: ImageTokens) => {
                    // 1. Загружаем файл в API платформы
                    const api = new MyPlatformApi(controller.appContext);
                    const uploadResult = await api.uploadImage(image.imageDir);

                    if (uploadResult?.id) {
                        // 2. Сохраняем токен в модель
                        model.imageToken = uploadResult.id;
                        // 3. Сохраняем модель в БД (чтобы в следующий раз не грузить заново)
                        if (await model.save(true)) {
                            return model.imageToken;
                        }
                    }
                    return null;
                },
            );
        }

        if (image.imageToken) {
            elements.push({
                type: 'image',
                photo_id: image.imageToken,
                title: image.title,
                description: image.desc,
            });
        }
    }
    return elements;
}
```

**Важно:** Callback функция (четвертый параметр `getImageToken`) вызывается **ТОЛЬКО при cache miss**, то есть когда:

- Токен еще не был сгенерирован (`!image.imageToken`)
- В базе данных нет сохраненного токена для этого файла

Если токен уже существует и валиден, callback не вызывается - используется кэшированное значение. Это позволяет избежать
лишних сетевых запросов и ускорить работу приложения.

### Звуки и Аудио

Аналогично изображениям, используется утилита `getSoundToken` и модель `SoundTokens`.

```ts
import { pUtils } from 'umbot/plugins';
import { SoundTokens } from 'umbot';
// Внутри процессора звуков:
const audioToken = await pUtils.getSoundToken(
    path,
    'my_platform',
    controller,
    async (model: SoundTokens) => {
        const api = new MyPlatformApi(controller.appContext);
        const res = await api.uploadAudio(path);
        if (res?.id) {
            model.soundToken = res.id;
            if (await model.save(true)) return model.soundToken;
        }
        return null;
    },
);
```

### Вспомогательные хелперы адаптера (`pUtils`)

Помимо `getImageToken`/`getSoundToken`, в `pUtils` (экспорт из `umbot/plugins`) есть хелперы, которые
используют встроенные адаптеры — их стоит переиспользовать и в кастомных:

**Разбор входящего запроса:**

- `tryParse<T>(raw)` — безопасный разбор JSON-строки payload (`null` при невалидном);
- `normalizeActionPayload(payload)` — приводит payload кнопки (`'buy'`, `{"command":"buy"}` или `{"action":"buy"}`) к строке `buy` в нижнем регистре для `userCommand`;
- `hasAnyNluKey(nlu)` — проверяет, есть ли в объекте NLU хоть какие-то данные (медиа/сущности/интенты);
- `setThisUserToNlu(controller, thisUser)` — заполняет сущность `thisUser` (данные об отправителе) в NLU контроллера;
- `telegramMessageEvent(message)` / `viberMessageEvent(type)` — сопоставляют тип входящего апдейта с универсальным `TEventType`;
- `getPlatformRequestData<T>(controller, adapterKey)` — изолированное хранилище технических данных запроса под ключом вашего адаптера (`callbackId`, `chatId` и т.п.).

**Сборка ответа:**

- `getChatText(text, tts)` — текст ответа для чат-платформ: при пустом `text` возвращает `tts` без разметки звуков;
- `getSpeechText(text)` — чистит TTS от звуковой разметки голосовых платформ (`#game_win#`, паузы, `<speaker>`) перед отправкой в синтез речи;
- `shouldProcessChatSound(controller, platformName)` — нужно ли вообще обрабатывать звук: есть добавленные звуки либо задан `speech_kit_token`;
- `defaultSoundProcessing(soundInfo, defaultSounds, defaultEffects?)` — стандартная подстановка звуков и эффектов (используют Алиса и Маруся);
- `getCorrectButtons(buttons, limit, appContext?)` — обрезает массив кнопок до лимита платформы (дефолт 10; с `appContext` пишет предупреждение об усечении);
- `serializePlatformPayload(payload, platform, appContext?)` — сериализует payload кнопки в строку, возвращает `null` с предупреждением вместо исключения.

**Медиа-токены:** `getImageToken` и `getSoundToken` разобраны выше; `cacheMediaToken(model, controller)` —
записывает уже полученный токен в модель `ImageTokens`/`SoundTokens`. Кэш здесь — оптимизация, а не
условие работы: без подключённого DB-адаптера запись просто не происходит, и это не ошибка.

Полный список с сигнатурами — в типах `src/plugins/platforms/Base/utils.ts` (JSDoc каждого хелпера).

```ts
import { pUtils } from 'umbot/plugins';

// Внутри setQueryData при разборе нажатия кнопки
// (normalizeActionPayload сам приводит результат к нижнему регистру):
controller.userCommand = pUtils.normalizeActionPayload(payload);
controller.originalUserCommand = controller.userCommand;
```

## API-фасад платформы (`createApi`)

`controller.api` — унифицированный доступ к исходящим возможностям платформы прямо из бизнес-логики:
отправить фото или файл, ответить на нажатие кнопки, не конструируя вручную платформенные
Request-классы.

```ts
bot.addEvent('callback', async (ctx) => {
    await ctx.api?.answerCallback('Принято');
    await ctx.api?.sendPhoto('./report.png', { caption: 'Ваш отчёт' });
    ctx.skipAutoReply = true; // ответ уже отправлен вручную
});
```

Фасад выбирает сам адаптер — опциональным методом `createApi(controller)`. Базовая реализация
возвращает `null` (фасад недоступен), поэтому по умолчанию `controller.api` на кастомной платформе
равен `null`, и включается он переопределением одного метода — правки ядра не нужны. Фасад ленивый:
объект создаётся при первом обращении к `ctx.api`, запросы без API-вызовов за него не платят.

Голосовым платформам (Алиса, Маруся, SmartApp) фасад не нужен: их ответ формируется телом вебхука,
а медиа отправляются через `controller.card` / `controller.sound`. Такие адаптеры метод не
переопределяют.

### Контракт `IControllerApi`

| Метод                              | Назначение                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `sendPhoto(image, params?)`        | Отправить изображение; `params.caption` — подпись                              |
| `sendDocument(file, params?)`      | Отправить документ или файл                                                    |
| `sendAudio(file, params?)`         | Отправить аудио                                                                |
| `sendVideo(file, params?)`         | Отправить видео                                                                |
| `answerCallback(text, showAlert?)` | Ответить на нажатие callback-кнопки (уведомление или snackbar)                 |
| `can(method)`                      | Поддерживает ли платформа метод — имена методов перечислены типом `TApiMethod` |

Методы отправки возвращают `Promise<Record<string, unknown> | null>`: `null` — отправить не
удалось. Интерфейсы `IControllerApi`, `IApiMediaParams` и тип `TApiMethod` экспортируются из
`umbot`.

### Реализация фасада для своей платформы

Фасад — обычный объект, а не класс. Собирайте его фабрикой, которая замыкается на контроллер;
технические данные запроса (идентификатор нажатия, чат) берите из хранилища адаптера, заполненного
в `setQueryData`.

```ts
import { pUtils } from 'umbot/plugins';
import { BotController, IApiMediaParams, IControllerApi, TApiMethod } from 'umbot';

const MY_SUPPORTED: readonly TApiMethod[] = ['sendPhoto', 'answerCallback'];

interface IMyApiData extends Record<string, unknown> {
    callbackId?: string;
    chatId?: number;
}

export function makeMyApi(controller: BotController): IControllerApi {
    const data = (): IMyApiData =>
        pUtils.getPlatformRequestData<IMyApiData>(controller, 'my_platform');
    const recipient = (): string | number | null => data().chatId ?? controller.userId;

    return {
        async sendPhoto(
            image: string,
            params?: IApiMediaParams,
        ): Promise<Record<string, unknown> | null> {
            const chatId = recipient();
            if (!chatId) {
                // Без адресата не отправляем битый запрос — явный warn в лог
                controller.appContext?.logWarn(
                    'controller.api.sendPhoto(): не удалось определить адресата.',
                );
                return null;
            }
            // здесь — вызов вашего API-клиента платформы
            return { chatId, image, caption: params?.caption ?? '' };
        },
        async sendDocument(): Promise<Record<string, unknown> | null> {
            return null; // платформа не умеет — честно отдаём null (и can() === false)
        },
        async sendAudio(): Promise<Record<string, unknown> | null> {
            return null;
        },
        async sendVideo(): Promise<Record<string, unknown> | null> {
            return null;
        },
        async answerCallback(text: string): Promise<Record<string, unknown> | null> {
            const callbackId = data().callbackId;
            if (!callbackId) {
                controller.appContext?.logWarn(
                    'controller.api.answerCallback(): у текущего запроса нет callback-идентификатора — кнопка не была нажата.',
                );
                return null;
            }
            return { callbackId, text };
        },
        can(method: TApiMethod): boolean {
            return (MY_SUPPORTED as readonly string[]).includes(method);
        },
    };
}
```

Остаётся подключить фабрику к адаптеру — одним методом:

```ts
// Метод адаптера
createApi(controller: BotController): IControllerApi | null {
    return makeMyApi(controller);
}
```

Правила, которые соблюдают встроенные фасады:

- **`can()` не врёт.** Метод возвращает `false` там, где платформа физически не умеет операцию.
  Так, фасад Viber отвечает `false` на все методы: его Bot API принимает медиа только по публичному
  URL и с обязательным `size`, которых у фасада нет.
- **Не отправлять заведомо битый запрос.** Не удалось определить адресата или идентификатор
  нажатия — предупреждение в лог и `null`, а не запрос в API с пустым полем.
- **Неподдерживаемый метод возвращает `null`, а не бросает исключение.** Бизнес-логика
  кросс-платформенная: один и тот же обработчик выполняется и на платформе, где метод есть, и там,
  где его нет.

Диспетчер `makePlatformApi(controller)` из `umbot/plugins` собирает фасад встроенной платформы по
`controller.appType` — он оставлен для ручного использования, ядро им не пользуется.

## Управление состояниями (State / Local Storage)

Некоторые платформы (Алиса, SmartApp) умеют хранить состояние диалога на своей стороне. Это позволяет не делать лишних
запросов в БД.

Чтобы поддержать это, нужно реализовать 3 метода:

1. `isLocalStorage(controller)` — возвращает true, если платформа поддерживает локальное хранилище.
2. `getLocalStorage(controller)` — возвращает данные, которые платформа прислала в запросе (обычно лежат в
   controller.state).
3. `setLocalStorage(data, controller)` — вызывается фреймворком, если нужно сохранить данные на стороне платформы (если
   платформа не делает это автоматически через ответ).

Нюанс: В `setQueryData` вы должны указать, в какое поле ответа класть стейт, заполнив
`controller.platformOptions.stateName` (например, 'session_state' или 'user_state_update').

## Формирование ответа (getContent)

**Задача:** Собрать финальный ответ согласно контракту платформы.
Метод принимает `controller` (со всей бизнес-логикой, текстом, кнопками) и `stateData` (данные для локального
хранилища).
Здесь есть две парадигмы ответов:

**Парадигма А:** Webhook-Response (Алиса, SmartApp)
Платформа ждет JSON в теле HTTP-ответа.

```ts
async getContent(controller: BotController, stateData?: Record<string, unknown>): Promise<object> {
    // 1. Собираем UI через наши процессоры
    const buttons = controller.buttons.getButtons(myPlatformButtonProcessing);
    const cards = await controller.card.getCards(myPlatformCardProcessing, controller);

    // 2. Формируем ответ
    const response = {
        text: Text.resize(controller.text, 1024), // ОБЯЗАТЕЛЬНО режьте текст по лимитам!
        tts: controller.tts,
        buttons: buttons,
        card: cards,
        end_session: controller.isEnd
    };

    // 3. Добавляем состояние (если платформа его поддерживает)
    if (controller.platformOptions.stateName && stateData) {
        response[controller.platformOptions.stateName] = stateData;
    }

    return response;
}
```

**Парадигма Б:** API-Call (Telegram, VK, Max)
Платформа ждет, что вы сами отправите ответ через её API, а вебхуку нужно просто вернуть 200 OK.

Флаг `controller.skipAutoReply` — это сигнал **для ядра**: «запрос уже отвечен или не требует ответа».
Его выставляет адаптер (обычно в `setQueryData`) или middleware, когда запрос обработан без бизнес-логики —
например, неизвестное событие платформы, на которое нельзя ответить. `getContent` лишь **учитывает** флаг:
видит его и не отправляет сообщение через API, а возвращает ядру нейтральное тело для вебхука.
Ядро в любом случае отвечает на вебхук HTTP 200 — это важно: на 5xx Telegram реплеит апдейт бесконечно,
а VK отключает сервер.

Неожиданные события платформы, которые ваш адаптер не может обработать, помечайте именно `skipAutoReply = true`
в `setQueryData` (с `return true`), а не `return false` — второй вариант приведет к HTTP 400.

```ts
async getContent(controller: BotController): Promise<string> {
    // 1. Запрос не требует автоответа? Просто возвращаем заглушку для вебхука.
    if (controller.skipAutoReply) {
        return 'ok';
    }

    const api = new MyPlatformApi(controller.appContext);

    // Собираем все UI-компоненты
    const keyboard = controller.buttons.getButtons(myPlatformButtonProcessing);
    const attachments = await controller.card.getCards(myPlatformCardProcessing, controller);
    const sounds = await controller.sound.getSounds(controller.tts, mySoundProcessing, controller);

    // Передаем их в API платформы (формат зависит от самой платформы)
    await api.sendMessage(controller.userId, Text.resize(controller.text, 4096), {
        keyboard,
        attachments, // Пример для Discord/VK
        audio: sounds // Пример
    });

    // 2. Возвращаем заглушку для вебхука
    return 'ok';
}
```

> Возвращаемое значение из getContent пойдет в тело HTTP-ответа на вебхук. Если платформа требует специфичный JSON-ответ
> на сам факт получения вебхука (даже если вы уже отправили сообщение через API) — верните этот JSON. Если платформа
> принимает любой статус 200 OK — просто верните строку 'ok' или пустой объект.

### Тестовый набор данных (getQueryExample)

Для локального тестирования через `BotTest` определите метод `getQueryExample`.
Этот метод эмулирует запрос от платформы, позволяя проверить работу приложения до деплоя.
В базовом классе есть generic-заглушка, но для **тестируемого** адаптера метод обязателен:
без переопределения `BotTest.simulate()` не сможет сгенерировать валидный payload вашей платформы.

**Важно:** Формат возвращаемого объекта должен точно соответствовать структуре запроса,
которую вы парсите в `setQueryData`.

```ts
// Для тестирования через BotTest
getQueryExample(
    query: string,
    userId: string,
    count: number,
    state: Record<string, unknown> | string,
): Record<string, unknown> {
    // Возвращаем объект в формате ВАШЕЙ платформы
    // Этот же формат будет парситься в setQueryData
    return {
        message: {
            sender: { user_id: userId },
            body: {
                text: query,
                seq: count,
            },
        },
        state: state,
    };
}
```

## Остальные точки расширения контракта

### Служебные запросы и shortcut-ответы (`sendInInit`)

Некоторые платформы присылают служебные запросы, на которые нужно ответить
заготовленным ответом, **не проходя бизнес-логику приложения**:

- **Алиса** периодически шлёт `ping` для проверки доступности навыка;
- **VK** при первичной настройке вебхука присылает `confirmation` — нужно
  вернуть строку-подтверждение;
- **SmartApp** может присылать healthcheck-запросы.

Чтобы не запускать middleware/commands/action для таких запросов, в `setQueryData`
установите `controller.platformOptions.sendInInit` — фреймворк проверит это поле
**сразу после** `setQueryData` и, если оно заполнено, вернёт его как ответ,
пропустив всю дальнейшую обработку.

```ts
setQueryData(query, controller) {
    // ... обычная обработка ...

    // Яндекс прислал ping?
    if (query.request.original_utterance === 'ping') {
        controller.platformOptions.sendInInit = {
            version: '1.0',
            response: { text: 'pong' },
        };
        // Важно вернуть true: при false ядро ответит на вебхук HTTP 400,
        // а Telegram по 4xx/5xx бесконечно реплеит апдейт, VK — отключает сервер.
        return true;
    }
    return true;
}
```

Формат значения sendInInit: string | object | null:

- object — будет отправлен в тело HTTP-ответа как JSON (для Алисы, SmartApp — это структура { version, response, ... }).
- string — будет отправлен как plain text (для VK confirmation).
- null / undefined — обычная обработка (по умолчанию).

### Лимиты платформы (Rate Limit)

Если у платформы есть жесткий лимит запросов в секунду (например, 30 req/sec у Telegram/Max), укажите это в классе
адаптера. Значение `limit` читает встроенный middleware `rateLimiter`.

```ts
export class MyPlatformAdapter extends BasePlatformAdapter {
    limit = 30; // Сообщаем фреймворку о лимите
}
```

Само по себе поле `limit` ничего не ограничивает — **необходимо явно подключить middleware rateLimiter**:

```ts
import { Bot } from 'umbot';
import { rateLimiter } from 'umbot/middleware';
import { TelegramAdapter } from 'umbot/plugins';

const bot = new Bot();
bot.use(new TelegramAdapter('YOUR_TOKEN'));
bot.use(rateLimiter());
```

Только после этого фреймворк будет использовать значение `limit` из адаптера для ограничения количества запросов.

### Соблюдение таймаутов

Голосовые платформы жестко ограничивают время ответа: фреймворк ориентируется на пороги `WARNING_TIME_REQUEST = 2000 мс`
(предупреждение) и `MAX_TIME_REQUEST = 2900 мс` (ошибка) — у Алисы лимит около 3 секунд, у других платформ он отличается.
Проверка не выполняется автоматически: в своём `getContent` вызовите `this._timeLimitLog(controller)` после формирования
ответа. Так поступают встроенные **голосовые** адаптеры (Alisa, Marusia, SmartApp); адаптеры чат-платформ его не вызывают.
Без вызова медленные ответы не попадут в логи. Пороги можно переопределить
в наследнике. И главное — не делайте тяжелых синхронных операций внутри getContent.

Время считается от метки, которую ставит `updateTimeStart(controller)` (ядро вызывает его перед
бизнес-логикой), а `getProcessingTime(controller)` возвращает прошедшие миллисекунды. Оба метода
публичные — пользуйтесь ими, если считаете собственные метрики.

### Ответ на запрос оценки (`getRatingContext`)

Когда бизнес-логика выставила `controller.isSendRating = true`, ядро собирает ответ не через
`getContent`, а через `getRatingContext(controller)`. Базовая реализация просто вызывает
`getContent`, поэтому переопределять метод нужно только платформам со специальным форматом запроса
оценки (так делает SmartApp).

```ts
// Метод адаптера: TContent допускает и объект, и промис
getRatingContext(controller: BotController): Promise<object> {
    return Promise.resolve({
        messageName: 'CALL_RATING',
        payload: { text: controller.text },
    });
}
```

### Активные рассылки (`send`)

`bot.send(userId, текстИлиКонтроллер, platform)` позволяет приложению написать пользователю первым.
Ядро находит адаптер по имени платформы и вызывает его метод `send(userId, controllerOrText)`.

Базовая реализация уже рабочая: строку она оборачивает в контроллер, подставляет `userId` и вызывает
`getContent`. Для платформы, которая отправляет ответ через API (парадигма Б), этого достаточно —
специально ничего делать не нужно. Переопределяйте метод, только если платформа требует другого
запроса для проактивных сообщений или не поддерживает их вовсе — тогда верните `false`.

### Единый формат ошибок API (`getErrorMsg`, `getErrorToken`)

Клиенты встроенных платформ логируют сбои одинаково, и те же хелперы доступны вашему адаптеру
(экспорт из `umbot/plugins`):

- `getErrorMsg(error, path, url)` — сообщение об ошибке запроса: источник, URL и текст ошибки;
- `getErrorToken(platform, methodName)` — сообщение о том, что для платформы не задан токен.

```ts
import { getErrorMsg, getErrorToken } from 'umbot/plugins';
import { AppContext } from 'umbot';

async function callMyApi(appContext: AppContext, url: string): Promise<unknown | null> {
    const token = appContext.appConfig.tokens['my_platform']?.token;
    if (!token) {
        appContext.logError(getErrorToken('my_platform', 'callMyApi'));
        return null;
    }
    try {
        const response = await fetch(url, { headers: { Authorization: token } });
        return await response.json();
    } catch (error) {
        appContext.logError(getErrorMsg(error as Error, 'MyPlatformRequest', url));
        return null;
    }
}
```

> В собственном HTTP-клиенте платформы всегда задавайте таймаут — запрос без ограничения времени
> подвешивает обработку вебхука. Встроенные клиенты построены на классе `Request` из `umbot`, у
> которого таймаут задан по умолчанию (подробности — в документе `http-client.md`).
