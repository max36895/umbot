# Интеграция с платформами

## Поддерживаемые платформы

Фреймворк `umbot` обеспечивает единое API для разработки голосовых навыков и чат-ботов на всех ведущих российских и международных платформах.

### Сравнение с аналогами

| Возможность                     | `umbot` |    Jovo     | SaluteJS |                     Нативный SDK                     |
| :------------------------------ | :-----: | :---------: | :------: | :--------------------------------------------------: |
| Алиса + Маруся + Сбер           |   ✅    |     ❌      | ⚠️ Сбер  | Требуется ручная маршрутизация и дублирование логики |
| Единая бизнес-логика            |   ✅    |     ✅      |    ❌    |                          ❌                          |
| Поддержка Telegram / VK / Viber |   ✅    | ⚠️ Частично |    ❌    | Требуется ручная маршрутизация и дублирование логики |
| TypeScript «из коробки»         |   ✅    |     ✅      |    ✅    |                  ⚠️ Зависит от sdk                   |

> Сильная сторона `umbot` — полный российский стек голосовых ассистентов (Алиса, Маруся, Сбер SmartApp) в одном коде.
> SaluteJS — нативный SDK экосистемы Сбера (Салют), поэтому Сбер для него родная платформа, но мультиплатформенность
> (Алиса, Маруся, чат-боты) в нём не поддерживается. Jovo сфокусирован на мультиплатформенных чат-ботах (из тройки
> Telegram / VK / Viber у него есть Telegram и Viber, VK — нет) и не
> интегрирован с российскими голосовыми платформами. Нативные
> SDK (telegraf, alice-sdk, vk-io) ориентированы на одну платформу и требуют дублирования логики при
> мультиплатформенности. Актуальные списки поддерживаемых платформ см. в их официальных документациях.

### Список платформ

| Платформа              | Идентификатор | Статус              |
| ---------------------- | ------------- | ------------------- |
| Яндекс.Алиса           | `alisa`       | ✅ Полная поддержка |
| Маруся                 | `marusia`     | ✅ Полная поддержка |
| Сбер SmartApp          | `smart_app`   | ✅ Полная поддержка |
| Telegram               | `telegram`    | ✅ Полная поддержка |
| VK                     | `vk`          | ✅ Полная поддержка |
| MAX                    | `max_app`     | ✅ Полная поддержка |
| Viber                  | `viber`       | ✅ Полная поддержка |
| Любая другая платформа | `...`         | ✅ Через адаптеры   |

Выбор платформы происходит автоматически в зависимости от запроса, который пришел в приложение, главное не забыть
подключить адаптеры для платформ.
Также есть возможность явно указать какая именно платформа используется:

```ts
const bot = new Bot('max_app');
```

## Общие требования

### Требования к серверу

- HTTPS с валидным SSL-сертификатом
- Стабильное время ответа (рекомендуется < 3 секунд)
- Поддержка webhook URL
- Node.js 20.19+ и TypeScript 5+

### Базовая настройка

```ts
import { Bot } from 'umbot';
import { fullPlatforms } from 'umbot/plugins';

const bot = new Bot();
bot.use(fullPlatforms); // Подключаем все доступные платформы
bot.setPlatformParams({
    // Параметры платформы
    welcome_text: 'Привет!', // Текст приветствия
    help_text: 'Я умею...', // Текст помощи
    intents: [],
});
bot.setAppConfig({
    // Общие параметры
    json: './data', // Директория для JSON данных
    error_log: './logs', // Директория для логов
    isLocalStorage: true, // Использование локального хранилища
});
bot.start('localhost', 3000); // Запуск приложения
```

## Создание навыков для Алисы

### Требования

- Аккаунт разработчика в [Яндекс.Диалоги](https://dialogs.yandex.ru/developer)
- HTTPS endpoint для webhook
- Время ответа < 3 секунд

### Настройка

1. Создайте навык в консоли Яндекс.Диалоги
2. Получите OAuth токен в [Яндекс.OAuth](https://oauth.yandex.ru) если он необходим. Токен нужен для загрузки аудио или
   изображений.
3. Настройте параметры в коде:

```ts
bot.setPlatformParams({
    isAuthUser: true, // Для работы с авторизацией
    intents: [],
});
bot.use(new AlisaAdapter('YOUR_OAUTH_TOKEN')); // Способ 1: токен в конструкторе (приоритет выше)
// bot.setAppConfig({                         // Способ 2: токен в конфиге (альтернатива, если не передан в конструкторе)
//     tokens: {
//         alisa: {
//             token: 'YOUR_OAUTH_TOKEN',
//         },
//     },
// });
```

Токен можно не указывать в коде: переменная окружения `ALISA_TOKEN` подхватывается автоматически
(без настройки `env` в конфиге). Старое имя `YANDEX_TOKEN` сохранено для обратной совместимости —
если заданы обе переменные, приоритет у `ALISA_TOKEN`.

### Особенности

- Поддержка авторизации пользователей
- Локальное хранилище данных
- Встроенная система синтеза речи
- Поддержка карточек и галерей

### Пример контроллера

```ts
class AlisaController extends BotController {
    public action(intentName: string | null): void {
        if (intentName === WELCOME_INTENT_NAME) {
            // Проверка авторизации
            if (!this.userToken) {
                this.isAuth = true;
                this.text = 'Для продолжения необходима авторизация';
                return;
            }

            // Работа с авторизованным пользователем
            this.text = `Привет, ${this.nlu.getUserName()?.first_name || 'пользователь'}!`;
            this.tts = 'Привет! Рад вас видеть снова!';

            // Добавление карточки
            this.card.addImage('image_token', 'Добро пожаловать', 'Описание', 'Кнопка');

            // Добавление кнопок
            this.buttons.addBtn('Помощь').addBtn('Начать игру');
        }
    }
}
```

## Создание бота для Telegram

### Требования

- Бот, созданный через [@BotFather](https://t.me/botfather)
- HTTPS webhook URL
- Поддержка Telegram Bot API

### Настройка

1. Получите токен у @BotFather
2. Сгенерируйте секрет вебхука (одна и та же строка понадобится в двух местах):

    ```bash
    node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
    ```

3. Зарегистрируйте webhook, передав секрет в `secret_token`:

    ```bash
    curl "https://api.telegram.org/bot<ТОКЕН>/setWebhook" \
         -d "url=https://ваш-домен/webhook" \
         -d "secret_token=<СЕКРЕТ>"
    ```

4. Настройте параметры в коде (секрет — тот же, что в `setWebhook`):

```ts
bot.use(new TelegramAdapter('YOUR_BOT_TOKEN')); // Способ 1: токен в конструкторе (приоритет выше)
// bot.setAppConfig({                           // Способ 2: токен в конфиге (альтернатива)
//     tokens: {
//         telegram: {
//             token: 'YOUR_BOT_TOKEN',
//             webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET, // тот же секрет, что в setWebhook
//         },
//     },
// });
```

> **Проверка подлинности запросов.** Задайте `appConfig.tokens.telegram.webhookSecret` — адаптер будет
> проверять заголовок `x-telegram-bot-api-secret-token` и отклонять запросы не от Telegram (401 до
> выполнения логики). **Без `webhookSecret` адаптер принимает любой запрос с полем `update_id`** —
> любой, кто узнает URL вебхука, сможет слать сообщения от имени любого пользователя; это допустимо
> только для локальной отладки. Подробнее — в
> [configuration.md → Проверка подписи вебхука](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_configuration.html#проверка-подписи-вебхука-обязательно-для-production).

### Особенности

- Богатый набор UI элементов
- Поддержка файлов и медиа
- Inline кнопки и клавиатура

### Пример контроллера

```ts
class TelegramController extends BotController {
    public action(intentName: string | null): void {
        if (intentName === WELCOME_INTENT_NAME) {
            this.text = 'Привет! Я Telegram бот на umbot';

            // Добавление inline кнопок
            this.buttons
                .addBtn('Веб-сайт', 'http://localhost')
                .addBtn('Помощь', null, { command: 'help' });

            // Отправка изображения
            this.card.addImage('image_url', ' ', 'Описание изображения');
        }
    }
}
```

## Создание бота для VK

### Требования

- Группа ВКонтакте
- Права администратора группы
- Включены сообщения сообщества

### Настройка

1. Создайте группу ВКонтакте
2. Получите ключ доступа в настройках группы (управление сообществом → работа с API; портал для разработчиков — [dev.vk.com](https://dev.vk.com/ru))
3. Настройте Callback API и **включите «Секретный ключ»** в его настройках (без этого проверять подпись нечем — см. примечание ниже)
4. Настройте параметры в коде:

```ts
bot.use(
    new VkAdapter('YOUR_BOT_TOKEN', {
        vk_confirmation_token: 'YOUR_CONFIRMATION_TOKEN',
        vk_secret_key: 'YOUR_SECRET_KEY', // тот же «Секретный ключ», что включён в настройках группы
        vk_api_version: '5.199',
    }),
); // Способ 1: токен и опции в конструкторе (приоритет выше)
// bot.setAppConfig({                             // Способ 2: токен в конфиге (альтернатива)
//     tokens: {
//         vk: {
//             token: 'YOUR_BOT_TOKEN',
//             confirmation_token: 'YOUR_CONFIRMATION_TOKEN',
//             secret_key: 'YOUR_SECRET_KEY',
//             api_version: '5.199',
//         },
//     },
// });
```

> **Примечание:** В конструкторе `VkAdapter` ключи передаются с префиксом `vk_`
> (`vk_confirmation_token`, `vk_secret_key`, `vk_api_version`), а в `appConfig.tokens.vk` — без префикса
> (`confirmation_token`, `secret_key`, `api_version`). Оба формата валидны и фреймворком поддерживаются.
>
> **Проверка подлинности запросов.** VK присылает `secret` в теле каждого callback-запроса, когда в
> настройках группы включён «Секретный ключ»; адаптер сверяет его с `secret_key` константным по времени
> сравнением. **Без `secret_key` адаптер принимает любой запрос с полями `type` + `group_id`** —
> любой, кто узнает URL вебхука, сможет слать сообщения от имени любого пользователя. Если секрет
> в группе включить нельзя — ограничьте доступ через `ipFilter` (диапазоны IP VK Callback API).

### Особенности

- Поддержка карусели сообщений
- Клавиатура сообщений
- Работа с вложениями
- Интеграция с VK API

### Пример контроллера

```ts
class VKController extends BotController {
    public action(intentName: string | null): void {
        if (intentName === WELCOME_INTENT_NAME) {
            this.text = 'Привет! Я бот ВКонтакте';

            // Добавление клавиатуры
            this.buttons.addBtn('Меню').addBtn('Помощь').addBtn('О нас', 'https://vk.ru/group');

            // Отправка карусели
            this.card
                .addImage('photo_token_1', 'Товар 1', '100 руб.')
                .addImage('photo_token_2', 'Товар 2', '200 руб.');
        }
    }
}
```

## Создание бота для MAX

### Требования

- Требуется верифицированный профиль организации/ИП

### Настройка

1. Перейдите в профиль вашей организации на [платформе](https://business.max.ru/self)
2. В разделе Чат-боты нажмите Создать
3. Заполните данные в настройках бота (его карточке) и нажмите Создать

```ts
bot.use(new MaxAdapter('YOUR_BOT_TOKEN', { secret: 'YOUR_WEBHOOK_SECRET' })); // Способ 1: токен + секрет вебхука
// bot.setAppConfig({                         // Способ 2: токен в конфиге (альтернатива)
//     tokens: {
//         max_app: {
//             token: 'YOUR_BOT_TOKEN',
//             webhookSecret: process.env.MAX_WEBHOOK_SECRET, // тот же секрет, что у подписки бота
//         },
//     },
// });
```

> **Проверка подлинности запросов.** MAX передаёт секрет заголовком `x-max-bot-api-secret`.
> Задайте его вторым аргументом конструктора (`{ secret: ... }`) или в
> `appConfig.tokens.max_app.webhookSecret` — адаптер начнёт отклонять запросы с неверным
> заголовком (401). **Без секрета адаптер принимает любой запрос с полями `update_type` +
> `timestamp`** — любой, кто узнает URL вебхука, сможет слать сообщения от имени любого
> пользователя; допустимо только для локальной отладки. Подробнее — в
> [configuration.md → Проверка подписи вебхука](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_configuration.html#проверка-подписи-вебхука-обязательно-для-production).

### Особенности

- Поддержка карусели сообщений
- Клавиатура сообщений
- Работа с вложениями
- Интеграция с MAX API

### Пример контроллера

```ts
class MaxController extends BotController {
    public action(intentName: string | null): void {
        if (intentName === WELCOME_INTENT_NAME) {
            this.text = 'Привет! Я бот в MAX';

            // Добавление клавиатуры
            this.buttons
                .addBtn('Меню')
                .addBtn('Помощь')
                .addBtn('О нас', 'https://dev.max.ru/docs/chatbots/bots-create');

            // Отправка карусели
            this.card
                .addImage('photo_token_1', 'Товар 1', '100 руб.')
                .addImage('photo_token_2', 'Товар 2', '200 руб.');
        }
    }
}
```

## Создание бота для Viber

### Требования

- Учётная запись бота, созданная в [Viber Admin Panel](https://partners.viber.com/)
- HTTPS webhook URL
- Имя отправителя (sender), совпадающее с именем бота в Viber

### Настройка

1. Создайте бота в [Viber Admin Panel](https://partners.viber.com/) и скопируйте токен бота
2. Укажите webhook URL на вашем сервере. Адаптер сам отвечает `200` на служебное событие `webhook`, которое Viber присылает при регистрации вебхука — без этого вебхук не зарегистрируется
3. Настройте параметры в коде:

```ts
bot.use(
    new ViberAdapter('YOUR_BOT_TOKEN', {
        viber_sender: 'YOUR_BOT_NAME', // обязательно: имя бота в Viber
    }),
); // Способ 1: токен и опции в конструкторе (приоритет выше)
// bot.setAppConfig({                           // Способ 2: токен в конфиге (альтернатива)
//     tokens: {
//         viber: {
//             token: 'YOUR_BOT_TOKEN',
//             sender: 'YOUR_BOT_NAME',
//         },
//     },
// });
```

> **Примечание:** Подлинность запросов Viber подтверждает заголовком `x-viber-content-signature` — адаптер проверяет его автоматически. Формат API описан в [документации Viber для разработчиков](https://developers.viber.com/).

### Особенности

- Текст сообщения до 7000 символов
- Кнопки — rich-media (RichMedia): адаптер отправляет до 6 кнопок в текущей реализации адаптера (сетка Viber
  позволяет до 42: 6×7); `Columns`/`Rows` каждой кнопки задают её размер в
  сетке, а не число карточек
- Звуки и TTS платформой не поддерживаются

### Пример контроллера

```ts
class ViberController extends BotController {
    public action(intentName: string | null): void {
        if (intentName === WELCOME_INTENT_NAME) {
            this.text = 'Привет! Я бот в Viber';

            // Добавление кнопок
            this.buttons.addBtn('Помощь').addBtn('О нас', 'https://example.com');
        }
    }
}
```

## Создание навыка для Маруси

### Требования

- Аккаунт разработчика VK
- HTTPS endpoint
- Поддержка протокола Маруси

### Настройка

1. Создайте навык в [консоли разработчика Маруси](https://marusia.vk.com/) (документация по навыкам — [vk.com/dev/marusia_skill_docs](https://vk.com/dev/marusia_skill_docs))
2. Получите токен для загрузки медиа
3. Настройте параметры:

```ts
bot.use(new MarusiaAdapter('YOUR_MEDIA_TOKEN')); // Способ 1: токен загрузки медиа в конструкторе (приоритет выше)
bot.setAppConfig({
    isLocalStorage: true,
    // tokens: {                              // Способ 2: токен в конфиге (альтернатива)
    //     marusia: {
    //         token: 'YOUR_MEDIA_TOKEN',
    //     },
    // },
});
```

Токен нужен не только для картинок, но и для **загрузки собственных звуков**. С 3.1.0 `MarusiaSound`
умеет загружать аудиофайлы в Марусю (`marusia.getAudioUploadLink` → upload → `marusia.createAudio`),
поэтому кастомные звуки работают у обеих голосовых платформ — у Алисы и Маруси. Предзагрузка — через
`Preload.loadSounds(paths, [T_ALISA, T_MARUSIA])`: токены звуков кэшируются в БД (как у Алисы),
маршрут тот же, что и в [контрактной сверке](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_platform-contract-comparison.html#маруся-исходящие-картинки-аудио)
(раздел 6, «Исходящие API-запросы Маруси»).
В обработчике достаточно работать с `controller.sound` — адаптер сам подберёт токен по пути к файлу.

### Особенности

- Поддержка голосового ввода/вывода
- Локальное хранилище
- Карточки: BigImage (`{type, image_id}`) и ItemsList (`{type, items: [{image_id}]}`); `image_id` —
  integer. Заголовков, описаний и кнопок у карточек Маруси нет, типа ImageGallery в протоколе нет —
  галерея отправляется как ItemsList (до 7 изображений, у списка — до 5)
- ⚠ С 20.12.2024 VK прекратил создание и поддержку пользовательских скиллов Маруси (документация протокола удалена с dev.vk.com; формат сверен по архивной копии).
- Загрузка собственных звуков (через токен загрузки медиа, см. «Настройку» выше)
- Health-check: на служебный `ping` фреймворк автоматически отвечает `pong`

### Пример контроллера

```ts
class MarusiaController extends BotController {
    public action(intentName: string | null): void {
        if (intentName === WELCOME_INTENT_NAME) {
            this.text = 'Привет! Я навык для Маруси';
            this.tts = 'Привет! Я готова помочь вам';

            // Добавление карточки
            this.card.addImage('image_token', 'Добро пожаловать', 'Выберите действие');

            // Добавление кнопок
            this.buttons.addBtn('Начать').addBtn('Помощь');
        }
    }
}
```

## Создание навыка для Сбер SmartApp

### Требования

- Аккаунт разработчика Сбера
- HTTPS endpoint
- Поддержка SmartApp протокола

### Настройка

1. Создайте приложение в [портале разработчика Сбера](https://developers.sber.ru/)
2. Настройте параметры:

```ts
bot.use(new SmartAppAdapter()); // Токен не нужен — аутентификация через Sber-экосистему
bot.setAppConfig({
    isLocalStorage: true,
});
```

> **Почему нет токена?** SmartApp использует встроенную аутентификацию платформы Сбербанка — приложение проходит проверку через экосистему Сбера при регистрации, отдельный API-токен не требуется.

### Особенности

- Поддержка Canvas App
- Встроенные сценарии
- Богатый UI
- Интеграция с экосистемой Сбера

### Пример контроллера

```ts
class SmartAppController extends BotController {
    public action(intentName: string | null): void {
        if (intentName === WELCOME_INTENT_NAME) {
            this.text = 'Привет! Я SmartApp на umbot';

            // Добавление карточки
            this.card.addImage('image_token', 'Добро пожаловать', 'Выберите действие');

            // Добавление кнопок
            this.buttons.addBtn('Начать').addBtn('Помощь');
        }
    }
}
```

## Пользовательские платформы

### Настройка

```ts
const bot = new Bot();
bot.use(new MyAdapter()); // Задаем кастомный адаптер
```

### Создание адаптера

```ts
// MyAdapter.ts
import { BasePlatformAdapter, TContent } from 'umbot/plugins';
import { BotController } from 'umbot';
import { Text } from 'umbot';

class MyAdapter extends BasePlatformAdapter {
    /**
     * Уникальное имя платформы
     */
    platformName: string = 'my_platform';

    /**
     * Возвращает признак того, соответствует ли запрос текущей платформе или нет
     * @param query - Тело запроса
     * @param headers - HTTP-заголовки
     */
    isPlatformOnQuery(query: unknown, headers?: Record<string, unknown>): boolean {
        const q = query as Record<string, unknown>;
        return !!(q.data && (q.data as Record<string, unknown>).messageCount !== undefined);
    }

    /**
     * Обработка полученного запроса. В данном методе необходимо настроить botController необходимыми данными
     * @param query - Запрос от платформы
     * @param controller - Контроллер приложения
     */
    setQueryData(query: unknown, controller: BotController): boolean | Promise<boolean> {
        if (this.appContext) {
            if (query) {
                let content: Record<string, unknown>;
                if (typeof query === 'string') {
                    content = JSON.parse(query);
                } else {
                    content = query as Record<string, unknown>;
                }

                const data = content.data as Record<string, unknown> | undefined;

                controller.requestObject = content;
                controller.userId = content.userId as string;
                controller.userCommand = ((data?.text as string) || '').toLowerCase();
                controller.originalUserCommand = (data?.text as string) || '';
                controller.messageId = data?.messageCount as number;

                if (content.store) {
                    controller.state = content.store as Record<string, unknown>;
                }

                controller.isScreen = false;

                return true;
            } else {
                controller.platformOptions.error = 'MyAdapter:init(): Отправлен пустой запрос!';
            }
        } else {
            // ошибки адаптера пишите через логгер контекста, а не в console напрямую
            this.appContext?.logError('MyAdapter:init(): Не указан контекст приложения!');
        }
        return false;
    }

    /**
     * Возвращает результат, который будет отправлен платформе.
     * @param controller
     */
    getContent(controller: BotController): TContent {
        return {
            text: controller.text,
            tts: controller.tts,
        };
    }

    /**
     * Возвращает демо результат запроса, который будет приходить от платформы
     * @param query Запрос пользователя
     * @param userId Идентификатор пользователя
     * @param count Порядковый номер запроса
     * @param state Данные из локального хранилища
     */
    getQueryExample(
        query: string,
        userId: string,
        count: number,
        state: Record<string, unknown> | string,
    ): Record<string, unknown> {
        return {
            userId,
            data: {
                text: query.toLowerCase(),
                messageCount: count,
            },
            store: state,
        };
    }
}
```

## Подводные камни по платформам

### Алиса

- **Жёсткое время ответа.** Фреймворк сам следит за временем обработки: при ответе дольше 2000 мс
  пишется предупреждение, дольше 2900 мс — ошибка. Таймауты самой платформы проверяйте в её актуальной
  документации. Используйте `Preload` для медиа.
- **Лимит state Алисы: 1 КБ.** Если данные больше или не сериализуются, поле state не отправляется и прежнее состояние не очищается. Для больших данных используйте адаптер базы данных.
- **Пустой ответ не дополняется фреймворком (голосовые платформы).** Пустой `text` допустим по документации, когда
  заполнен `tts`. Если разработчик оставил пустыми оба поля, umbot сохранит их как есть и запишет предупреждение:
  эмпирически такой ответ может приниматься, но документация Алисы не гарантирует этот сценарий. На чат-платформах
  (Telegram, VK, Viber, MAX) работает фолбэк: при пустом `text` и заполненном `tts` фреймворк подставляет `tts`
  (без звуковой SSML-разметки) как текст ответа.
- **`isScreen = false` на колонках.** Кнопки и карточки не отображаются. Проверяйте `this.isScreen` перед `this.card.addImage(...)`.
- **Health check (ping).** Яндекс периодически шлёт `ping`. Фреймворк автоматически отвечает `pong`.
- **Событие авторизации.** Завершение account linking (`account_linking_complete_event`)
  приходит как универсальное событие `auth`: `bot.addEvent('auth', ...)` — факт linking'а
  фиксируется в `controller.userEvents.auth`. Текстовые реплики пользователя — событие `message`.
- **Удаление полей.** `delete this.userData.foo` не работает — платформа вернёт старое значение. Используйте `this.userData.foo = null`.

### Маруся

- **Лимиты.** Текст и TTS — до 1024 символов, state — до 3584 байт, payload кнопки — до 4096 байт
  (превышения: state не отправляется, кнопка пропускается с предупреждением).
- **Health check (ping).** Фреймворк автоматически отвечает `pong` на служебные запросы платформы.
- **Карточки.** BigImage и ItemsList, элементы — только `image_id` (integer); галерея уходит как ItemsList.
- **Текст ответа не может быть пустым** (в отличие от Алисы): при пустом `text` он берётся из `tts` без разметки.

### Telegram

- **Нет локального хранилища.** При `isLocalStorage: true` без DB-адаптера `userData` хранится в памяти процесса (`memorySession`): шаги работают, но данные теряются при перезапуске и не разделяются между процессами и репликами. Для надёжного хранения подключите БД.
- **TTS через SpeechKit.** Для озвучки нужен `appConfig.tokens.telegram.speech_kit_token`
  (или переменная окружения `SPEECH_KIT_TOKEN` — она раскладывается сразу на Telegram, VK и MAX).
  Без него `controller.tts` игнорируется.
- **Разметка выключена по умолчанию.** `parse_mode` передаётся только при явном `telegram_parse_mode`. При включённом HTML/MarkdownV2 разработчик отвечает за экранирование динамических данных.
- **Проактивная отправка.** `bot.send(userId, text, T_TELEGRAM)` работает (в отличие от голосовых платформ).
- **Групповые чаты.** `userId` берётся из `from.id` (человек), а не из `chat.id` (группа) —
  один пользователь получает одну запись в БД и в группе, и в личке. Ответ доставляется
  в исходный чат (ID чата — `platformOptions.requestData.telegram.chatId`).
- **События.** Адаптер распознаёт все типы апдейтов (медиа, `callback`, `inline`,
  `message_edited`, `channel_post`, `my_chat_member` и др.) — неизвестные служебные апдейты
  подтверждаются HTTP 200 без ответа. Не-текстовые апдейты ловятся событийным роутингом:
  `bot.addEvent('photo' | 'voice' | 'callback' | 'inline' | 'message_edited' | 'channel_post', ...)`
  (полный список типов — в api-reference.md, раздел «Событийный роутинг»).
- **Inline-кнопки без payload (`options.inline`).** Кнопка без `payload` и `url` по умолчанию
  уходит обычной reply-клавиатурой. С опцией `{ inline: true }` она показывается inline-кнопкой под
  сообщением, а нажатие приходит боту как текст кнопки: `this.buttons.addBtn('Каталог', '', '', { inline: true })`.
  Текст длиннее лимита `callback_data` (64 байта) передаётся служебным токеном `#t<n>` и
  восстанавливается адаптером из клавиатуры сообщения. На `request_contact` / `request_location`
  опция не действует — Telegram принимает их только в обычной клавиатуре. Проекты, сгенерированные
  через `npx umbot create from-flow`, выставляют опцию всем кнопкам Telegram.
- **Webhook-reply (opt-in).** `new TelegramAdapter('TOKEN', { telegram_webhook_reply: true })`: простой текстовый ответ уходит телом webhook-ответа (`{method: 'sendMessage', ...}`) — Telegram выполнит его сам, экономится один исходящий POST на запрос. По образцу grammy: opt-in (по умолчанию выключено), не применяется к callback/inline-запросам и ответам с карточками/звуками — они уходят штатным путём. Учтите: ошибки отправки при этом недиагностируемы (Telegram подтверждает webhook раньше реального выполнения метода).

```ts
import { TelegramAdapter, T_FORMAT_MARKDOWN, escapeMarkdownV2 } from 'umbot/plugins';

// Вариант 1: обычный текст без parse_mode
const botPlain = new Bot().use(new TelegramAdapter('TOKEN'));

// Вариант 2: Явно MarkdownV2 (фреймворк не экранирует — разработчик отвечает за валидность)
const botMd = new Bot().use(
    new TelegramAdapter('TOKEN', {
        telegram_parse_mode: T_FORMAT_MARKDOWN,
    }),
);

// Вариант 3: текстовый ответ телом webhook без отдельного POST
const botWebhookReply = new Bot().use(
    new TelegramAdapter('TOKEN', {
        telegram_webhook_reply: true,
    }),
);

// Безопасная вставка пользовательского ввода в MarkdownV2 (внутри обработчика
// команды/события; ctx — BotController)
const userName = escapeMarkdownV2('Иван. Петров');
ctx.text = `*Пользователь:* ${userName}`;
```

### VK

- **Два токена.** Бот-токен + `vk_confirmation_token` (для подтверждения вебхука при первичной настройке).
- **Секретный ключ.** Опционально: укажите `vk_secret_key` в конструкторе адаптера или `VK_SECRET_KEY` в `.env` для проверки подлинности каждого запроса от VK Callback API. Если секретный ключ включён в настройках группы, VK присылает поле `secret` в теле каждого события — адаптер сверяет его с сохранённым значением.
- **Нет локального хранилища.** При `isLocalStorage: true` без DB-адаптера `userData` хранится в памяти процесса (`memorySession`): шаги работают, но данные теряются при перезапуске и не разделяются между процессами и репликами. Для надёжного хранения подключите БД.
- **Имя пользователя берётся из кэша.** Результат `users.get` (имя для `nlu.getUserName()`) кэшируется в памяти процесса на 1 час (до 5000 записей; ошибки API не кэшируются). Отключить загрузку можно опцией адаптера `new VkAdapter(token, { vk_load_user_info: false })` — тогда `getUserName()` вернёт `null`, зато на ответ уходит один запрос к VK вместо двух. Сбросить кэш (тесты, смена имени) — `clearVkUserCache()` из `umbot/plugins`.
- **Callback-кнопки подтверждаются через `messages.sendMessageEventAnswer`.** На нажатие callback-кнопки (`message_event`) адаптер вызывает `sendMessageEvent` вместо обычной отправки сообщения; текст ответа показывается пользователю через `show_snackbar`, при ошибке бизнес-логики — snackbar с текстом ошибки. ID события хранится в `platformOptions.requestData.vk.eventId` (с fallback в `platformOptions.eventId`).
- **Payload callback-кнопок нормализуется.** Строка `'buy'` или JSON `{"command":"buy"}` в payload попадает в `userCommand` как `buy` и срабатывает как обычная команда — без ручного разбора `requestObject`.
- **Группировка кнопок.** Кнопки с одинаковым `options._group` окажутся в одной строке.
- **Цвет кнопок.** `options.color: 'primary' | 'secondary' | 'positive' | 'negative'`.

### Viber

- **Sender name обязателен.** Должен совпадать с именем бота в Viber.
- **Версия API — 7 по умолчанию.** Если пользователь не передал версию явно, адаптер
  отправляет `min_api_version: 7` (`VIBER_DEFAULT_API_VERSION`). Версия 7 нужна для
  rich_media (карточек); на старых клиентах карточки не отобразятся.
- **Звуки не поддерживаются.** `controller.tts` игнорируется.
- **Нет локального хранилища.** При `isLocalStorage: true` без DB-адаптера `userData` хранится в памяти процесса (`memorySession`): шаги работают, но данные теряются при перезапуске и не разделяются между процессами и репликами. Для надёжного хранения подключите БД.
- **Служебные события.** Адаптер обрабатывает события `subscribed`/`unsubscribed` (логируются),
  `delivered`/`seen`/`failed` (подтверждаются без ошибки), `conversation_started` и событие
  `webhook` при регистрации вебхука (см. «Настройку» выше). Через событийный роутинг
  (`bot.addEvent('start' | 'subscribed' | 'unsubscribed', ...)`) на них можно навесить свою
  логику; типы медиа-сообщений пользователя доступны как `photo`/`video`/`document`/
  `contact`/`location`/`sticker` (подробности — в `controller.payload` и `requestObject`).

### MAX

- **Нет локального хранилища.** При `isLocalStorage: true` без DB-адаптера `userData` хранится в памяти процесса (`memorySession`): шаги работают, но данные теряются при перезапуске и не разделяются между процессами и репликами. Для надёжного хранения подключите БД.
- **TTS через SpeechKit.** Для озвучки нужен `appConfig.tokens.max_app.speech_kit_token`
  (или переменная окружения `SPEECH_KIT_TOKEN`).
- **Очередь отправки.** MAX ограничивает отправку в один диалог — не чаще 1 сообщения в 500 мс
  (и не более 2 callback-ответов в секунду на диалог). `MaxRequest` ставит исходящие сообщения
  в очередь на диалог с интервалом 500 мс, поэтому быстрые повторные ответы не получают 429
  от платформы. Внутренние таймеры очереди не блокируют выход процесса.
- **Лимиты сообщения.** Текст до 4000 символов, до 12 вложений в сообщении (клавиатура
  считается вложением), клавиатура — до 30 рядов по 7 кнопок. Превышения обрезаются
  фреймворком с предупреждением в лог.
- **Групповые чаты и каналы.** Если в webhook есть `chat_id`, ответ уходит в чат, а не в
  личный диалог (ID чата — в `platformOptions.chatId`).
- **API.** Базовый URL — `platform-api2.max.ru`; авторизация заголовком `Authorization: <token>`
  (query-параметры платформа больше не поддерживает). Детальное сравнение контракта —
  в [platform-contract-comparison.md](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_platform-contract-comparison.html#4-max).

### SmartApp (Сбер)

- **Без токена.** Аутентификация через Sber-экосистему.
- **Эмоции.** `controller.emotion = 'radost'` (22 варианта).
- **Rating flow.** `controller.isSendRating = true` запускает оценку навыка.
- **События.** Запуск приложения (`RUN_APP`) приходит как событие `start`, завершение
  оценки — как `rating` (текстовые реплики — `message`): `bot.addEvent('start' | 'rating', ...)`.

## Итог

Как видно из примеров выше, код контроллера для всех платформ выглядит практически одинаково.  
Вы пишете логику один раз, используя универсальные методы `this.text`, `this.buttons`, `this.card` и т.д.  
Фреймворк сам определяет, от какой платформы пришёл запрос, и автоматически преобразует ваш ответ в нужный формат.

Вам **не нужно** вручную проверять `this.appType` и писать разный код для Алисы, Telegram или VK —  
адаптеры платформ сделают это за вас. Единственное исключение — редкие случаи, когда требуется  
платформозависимое поведение (например, генерация UTM-меток в ссылках). Для таких ситуаций вы всегда можете  
явно обратиться к `this.appType` и добавить дополнительную логику.

Благодаря такому подходу вы можете сосредоточиться на бизнес-логике вашего приложения, а не на деталях реализации под каждую платформу. Один код — работает везде.

## События и возможности платформ

Две кросс-платформенные возможности 3.1.0 закрывают то, что раньше требовало ручного разбора
`requestObject` под каждую платформу. Полный справочник API (сигнатуры, примеры) —
в [api-reference.md](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_api-reference.html); здесь — привязка к платформам.

### Событийный роутинг (`bot.addEvent`)

Не-текстовые апдейты (фото, голосовые, callback-кнопки, редактирование сообщений, старт,
подписки) приходят как универсальные события: адаптер записывает тип в `controller.eventType`,
обработчики `bot.addEvent(eventType, handler)` вызываются до шагов и команд. Каждый адаптер
объявляет перечень поддерживаемых событий (`supportedEvents`) — `bot.addEvent` предупреждает
об опечатке или событии, которого не поддерживает ни одна подключённая платформа:

| Платформа | События (`supportedEvents`)                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Telegram  | `message`, `photo`, `voice`, `video`, `document`, `location`, `contact`, `sticker`, `callback`, `inline`, `message_edited`, `channel_post` |
| VK        | `message`, `callback`                                                                                                                      |
| MAX       | `message`, `callback`, `start`, `message_edited`                                                                                           |
| Viber     | `message`, `photo`, `video`, `document`, `contact`, `location`, `sticker`, `start`, `subscribed`, `unsubscribed`                           |
| Алиса     | `message`, `auth`                                                                                                                          |
| Маруся    | `message`, `auth`                                                                                                                          |
| SmartApp  | `message`, `start`, `rating`                                                                                                               |

Кастомная платформа, унаследованная от `BasePlatform`, объявляет собственный
`supportedEvents` (базовое значение — `['message']`) и автоматически участвует в валидации.

### API платформы (`controller.api`)

Унифицированный доступ к возможностям активной платформы: `sendPhoto` / `sendDocument` /
`sendAudio` / `sendVideo(файл, { caption })`, `answerCallback(text, showAlert?)` и
`can(method)` для проверки поддержки. Фасад ленивый — создаётся при первом обращении к
`ctx.api`; на голосовых платформах (Алиса, Маруся, SmartApp) — `null` (их ответ формируется
телом webhook; медиа отправляются через `controller.card` / `controller.sound`).

| Метод            | Telegram                                      | VK                        | MAX             | Viber         |
| ---------------- | --------------------------------------------- | ------------------------- | --------------- | ------------- |
| `sendPhoto`      | полный                                        | через штатный upload-flow | `/uploads`      | `null` + warn |
| `sendDocument`   | полный                                        | да                        | `/uploads`      | `null` + warn |
| `sendAudio`      | полный                                        | нет (null)                | `/uploads`      | `null` + warn |
| `sendVideo`      | полный                                        | нет (null)                | `/uploads`      | `null` + warn |
| `answerCallback` | да (`showAlert` поддерживает только Telegram) | `show_snackbar`           | `POST /answers` | `null` + warn |

Viber возвращает `can() === false` для всех методов: его Bot API принимает медиа только
по публичному URL с обязательным `size` — используйте `controller.card` / `ViberRequest` напрямую.

**Кастомная платформа и `controller.api`:** фасад подключается сам через метод адаптера
`createApi(controller)` (контракт `IPlatformAdapter`). Базовая реализация `BasePlatform`
возвращает `null` (фасад недоступен), поэтому платформе с исходящими API-вызовами достаточно
переопределить один метод — ядро узнает об этом без правок с его стороны:

```ts
import { BasePlatformAdapter } from 'umbot/plugins';
import type { BotController, IControllerApi } from 'umbot';

class MyAdapter extends BasePlatformAdapter {
    // ...
    createApi(controller: BotController): IControllerApi | null {
        return makeMyApi(controller); // своя фабрика фасада
    }
}
```

### Готовые наборы адаптеров

Кроме подключения адаптеров по одному, есть наборы из `umbot/plugins`: `voicePlatforms`
(Алиса, Маруся, SmartApp), `botPlatforms` (Telegram, VK, MAX, Viber) и `fullPlatforms`
(все 7). Список всех адаптеров — `adapters` из `umbot/plugins`.

## 🌐 Универсальный webhook-обработчик

Если вы используете Express, Fastify или любой другой HTTP-фреймворк — вы можете интегрировать `umbot` через метод
`webhookHandle`.

### Пример для Express

```ts
import express from 'express';
import { Bot } from 'umbot';
import { fullPlatforms } from 'umbot/plugins';

const app = express();
app.use(express.json({ type: '*/*' })); // важно для Алисы/Сбера

// Инициализация приложения
const bot = new Bot();
bot.use(fullPlatforms);
bot.setAppConfig({
    json: './data',
    error_log: './logs',
    isLocalStorage: true,
    env: 'local',
});

// Подключение webhook-обработчика
app.post('/webhook', async (req, res) => {
    try {
        await bot.webhookHandle(req, res);
    } catch (err) {
        console.error('Webhook error:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(3000, () => {
    console.log('Сервер запущен на http://localhost:3000/webhook');
});
```

## Активные рассылки (метод `send`)

Начиная с версии 3.0.0, фреймворк поддерживает **активную отправку сообщений** — то есть навык (если поддерживает) или бот может инициировать диалог с пользователем без входящего запроса.

> ⚠️ **Важно**: не все платформы поддерживают эту функцию.
> Например, Алиса, Маруся и SmartApp **не позволяют** отправлять сообщения без запроса.
> Telegram, VK, Viber и MAX поддерживают отправку через `bot.send()` — реализация унаследована от базового
> адаптера (без собственных проверок в платформенных адаптерах): для Viber нужен валидный `receiver`
> (user_id пользователя), для MAX — инициированный диалог (`user_id` или `chat_id`).
> Поддержка функционала зависит от используемой платформы.

### Пример использования

```ts
import { T_TELEGRAM } from 'umbot/plugins';

// Отправка сообщения пользователю в Telegram
const result = await bot.send('123456789', 'Привет! Это рассылка.', T_TELEGRAM);
```

## Лучшие практики

### Безопасность

- Храните токены в переменных окружения
- Используйте HTTPS
- Проверяйте подпись запросов
- Валидируйте входящие данные

### Разработка

- Используйте TypeScript
- Следуйте принципам SOLID
- Пишите тесты
- Ведите документацию
