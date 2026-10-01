# Миграция с umbot 2.x на 3.0

Версия 3.0.0 — это крупное обновление с фокусом на модульность, гибкость и современные стандарты. Мы перешли на
плагинную архитектуру, обновили требования к среде выполнения и упростили расширение функционала.

Версия 2.x.x находится в фазе поддержки: принимаются только исправления критических ошибок.

## Что изменилось в 3.0

1. **Плагинная архитектура** — работа с платформами теперь вынесена в отдельные плагины. Это позволяет гибко подключать
   только нужные интеграции и расширять функциональность через сторонние модули (например, валидацию запросов или
   ограничение частоты команд)
2. **Кастомный RegExp** — с версии 2.2.0 фреймворк из коробки стал поддерживать работу re2.
   Однако вы можете подключить свою реализацию регулярных выражений.
3. **Поддержка активных рассылок** — добавлен метод `send` для отправки сообщений пользователям без входящего запроса.
4. **Кастомный NLU-провайдер** — добавлена гибкость в использовании приложения через `appContext.plugins.nlu`.
5. **Поддержка внешнего i18n** — позволяет создавать приложения с локализацией через `appContext.plugins.i18n`.
6. **Обновление зависимостей** — минимальная версия Node.js стала 20.19. У версии 18 закончилась официальная поддержка.
7. **Оптимизация поиска по regex** — текущая реализация использует группировку и кэширование RegExp. Для дополнительной оптимизации при большом количестве команд с регулярными выражениями рекомендуется использовать `re2` и `setCustomCommandResolver`.
8. **Шаги через `addStep`** — шаг, привязанный к имени предыдущего интента (`controller.oldIntentName`) или к интенту
   из NLU, обрабатывается без перебора списка команд: поиск идёт напрямую по реестру шагов.
9. **Асинхронные обработчики** — обработчики команд теперь могут быть асинхронными (async/await).
10. **Переопределение ответа webhook** — в метод `webhookHandle` добавлен 3-й callback-аргумент для переопределения ответа. Метод `run` дополнительно принимает `auth` (3-й аргумент) и `clientIp` (4-й аргумент).

## Инструкция по переходу на новую реализацию

### Работа с Bot

#### Работа с платформами

До версии 3.0, вся работа с платформами была заложена в логику самого фреймворка. В версии 3.0 мы перешли на архитектуру
на основе адаптеров, поэтому для корректной работы приложения, необходимо перейти на новую механику работы. Сделать это
можно следующими способами:

1. Передать метод, который зарегистрирует все платформы

    ```ts
    import { fullPlatforms } from 'umbot/plugins';
    import { Bot } from 'umbot';

    const bot = new Bot();
    bot.use(fullPlatforms); // Подключаем все платформы
    ```

2. Передать адаптер платформы

    ```ts
    import { AlisaAdapter, MarusiaAdapter } from 'umbot/plugins';
    import { Bot } from 'umbot';

    const bot = new Bot();
    bot.use(new AlisaAdapter()); // Подключаем платформу для Алисы
    bot.use(new MarusiaAdapter()); // Подключаем платформу для Маруси
    ```

Адаптеры можно комбинировать — например, одновременно подключить Алису и Telegram-бота.

Список всех доступных "из коробки" адаптеров:

```ts
import { adapters } from 'umbot/plugins';
```

Также можно подключить либо голосовые платформы, либо платформы для чат-ботов, для этого есть соответствующие методы:

- voicePlatforms - Регистрация только голосовых платформ
- botPlatforms - Регистрация только чат ботов

#### Работа со звуками и звуковыми эффектами

Для единого и понятного формата, все звуки и звуковые эффекты были перенесены в SoundConstants. Данный подход позволяет
создавать различные звуковые эффекты, без завязки на платформу.
Как это работало раньше

```ts
import { AlisaSound } from 'umbot';

botController.tts = `${AlisaSound.S_AUDIO_GAME_WIN} `.repeat(i).trim();
```

Как работает сейчас

```ts
import { SoundConstants } from 'umbot';

botController.tts = `${SoundConstants.S_AUDIO_GAME_WIN} `.repeat(i).trim();
```

Далее фреймворк обращается к адаптеру, и сам адаптер приводит текст к корректному виду. Поведение зависит от платформы:
у голосовых платформ (Алиса, Маруся) не поддерживаемые эффекты заменяются или удаляются из `tts`, а чат-платформы
(Telegram, VK и др.) собирают аудио отдельным механизмом — через SpeechKit и отправку аудиофайлов.

#### Изменения в запуске приложения

> В 3.x сигнатура `run()` изменилась: `run(appType, content, auth, clientIp)` — первым аргументом передаётся тип
> платформы, а не класс контроллера. Класс контроллера задаётся один раз через `initBotController` (или конструктор
> `Bot`).

Раньше

```ts
import { Bot, Alisa, T_ALISA } from 'umbot';

const bot = new Bot(T_ALISA);
const botClass = new Alisa(bot._appContext);
bot.run(botClass, T_ALISA);
```

сейчас

```ts
import { Bot } from 'umbot';
import { AlisaAdapter, T_ALISA } from 'umbot/plugins';

const bot = new Bot(T_ALISA);
bot.use(new AlisaAdapter());
// content обязателен: без него (или без предварительного setContent) run() бросит ошибку.
// Payload должен быть валидным запросом Алисы: без version/session адаптер не опознает платформу
bot.run(
    T_ALISA,
    JSON.stringify({
        version: '1.0',
        session: { message_id: 0, session_id: 'local', skill_id: 'local_test', user_id: 'user-1' },
        request: { command: 'привет', original_utterance: 'привет', type: 'SimpleUtterance' },
    }),
);
```

#### Работа с базой данных

Начиная с версии 3.0, из коробки, в фреймворке нет подключения к базе данных по умолчанию, из-за чего необходимо
самостоятельно подключить необходимый адаптер для работы.
Сделать это можно следующим образом:

```ts
import { Bot } from 'umbot';
import { FileAdapter, MongoAdapter } from 'umbot/plugins';

const bot = new Bot();
bot.use(new FileAdapter()); // Подключаем файловую бд
bot.use(
    new MongoAdapter({
        host: process.env.DB_HOST ?? 'mongodb://localhost:27017',
        user: process.env.DB_USER,
        pass: process.env.DB_PASSWORD,
        database: process.env.DB_NAME ?? 'umbot',
    }),
); // Подключаем MongoDb
```

Также появилась возможность указать свой собственный адаптер для работы с базой данных.

⚠️ Важно: одновременно можно использовать только один адаптер базы данных. Если зарегистрировано несколько — будет
использован последний.

Метод `bot.run()` больше не принимает класс платформы в качестве первого аргумента — все платформы теперь регистрируются
через `bot.use()`.
Раньше

```ts
import { Bot, Alisa, T_ALISA } from 'umbot';

const bot = new Bot();
bot.run(Alisa, T_ALISA, content);
```

Сейчас

```ts
import { Bot } from 'umbot';
import { T_ALISA, AlisaAdapter } from 'umbot/plugins';

const bot = new Bot();
bot.use(new AlisaAdapter());
bot.run(T_ALISA, content);
```

##### Указание своей платформы

До версии 3.0 способ указания своей платформы был неудобен по следующим причинам:

1. Не совсем понятно как именно указывать и как должна работать логика платформы.
2. Можно было указать только 1 кастомную платформу

После перехода на адаптеры, подобных проблем удалось избежать. Сама документация по указанию своей платформы улучшена и
стала понятнее. Также можно создать множество своих платформ и подключить их.

Старый способ задания платформы выглядит следующим образом:

1. Необходимо наследоваться от `TemplateTypeModel`, определяя нужные методы.
2. Передать класс в само приложение
   Код подключения выглядел следующим образом:

```ts
import { BotTest, IBotTestParams } from 'umbot/test';
import skillStorageConfig from '../../config/skillStorageConfig';
import skillDefaultParam from '../../config/skillDefaultParam';
import { UserAppController } from './controller/UserAppController';
import { UserApp } from './UserTemplate/Controller/UserApp';
import userDataConfig from './UserTemplate/userDataConfig';

const bot = new BotTest();
bot.setAppConfig(skillStorageConfig());
bot.setPlatformParams(skillDefaultParam());
bot.initBotController(UserAppController);

//bot.run(userApp);
/**
 * Отображаем ответ навыка и хранилище в консоли.
 */
const params: IBotTestParams = {
    isShowResult: true,
    isShowStorage: false,
    isShowTime: true,
    userBotClass: UserApp,
    userBotConfig: userDataConfig,
};
bot.test(params);
```

В новой версии, необходимо также наследоваться от базового класса, но только не от `TemplateTypeModel`, а от
`BasePlatformAdapter`, который
находится в `umbot/plugins`. Далее, согласно документации определить необходимые методы, после чего подключить созданный
адаптер к приложению через `bot.use`.
Демо пример можно посмотреть в `examples/skills/UserApp` этого репозитория.
Итоговый код получается следующий:

```ts
import { BotTest, IBotTestParams } from 'umbot/test';
import skillStorageConfig from '../../config/skillStorageConfig';
import skillDefaultParam from '../../config/skillDefaultParam';
import { UserAppController } from './controller/UserAppController';
import { UserAdapter } from './UserTemplate/Adapter/UserAdapter';

const bot = new BotTest();
bot.use(new UserAdapter()); // Подключаем пользовательский адаптер для платформы
bot.setAppConfig(skillStorageConfig());
bot.setPlatformParams(skillDefaultParam());
bot.initBotController(UserAppController);

//bot.run();
/**
 * Отображаем ответ навыка и хранилище в консоли.
 */
const params: IBotTestParams = {
    isShowResult: true,
    isShowStorage: false,
    isShowTime: true,
};
bot.test(params);
```

##### Указание своего подключения к базе данных

До версии 3.0

1. Наследуемся от `DbControllerModel` определяя все нужные методы.
2. Подключаем через `bot.use(new DbConnect())`

В новой версии необходимо наследоваться от `BaseDbAdapter`, который находится в `umbot/plugins`. Далее, согласно
документации определить необходимые методы, после чего подключить созданный адаптер к приложению через `bot.use`.
Демо пример можно посмотреть в `examples/skills/userDbConnect` этого репозитория.
