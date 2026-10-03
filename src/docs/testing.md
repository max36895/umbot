# Тестирование проекта

## Тестирование на сервере

Перейти в [консоль разработчика](https://dialogs.yandex.ru/developer) и открыть вкладку тестирования.
Это актуально для Алисы. Для других платформ ссылка вставляется в соответствующую консоль разработчика.

## Локальное тестирование (рекомендуется)

**Не нужно разворачивать сервер для отладки!**

Для тестирования используется тот же код, что и для запуска.
С той лишь разницей, что нужно использовать класс `BotTest` вместо `Bot`.

```ts
import { BotTest } from 'umbot/test';
import { fullPlatforms } from 'umbot/plugins';

const bot = new BotTest();
bot.use(fullPlatforms); // регистрируем платформы — без этого test() не знает, какой формат использовать
await bot.test(); // запускает интерактивную консоль
```

Запуск будет выглядеть следующим образом:

```bash
npm run build && npm run start
# или напрямую собранный файл (стандартный CLI-проект кладёт код в dist/)
node ./dist/index.js
```

Откроется консоль с Вашим приложением. Для выхода из режима тестирования нужно:

1. Если навык в определённый момент ставит `isEnd = true` (завершение диалога) — дойдите в сценарии до этого места.
2. Вызвать команду exit.

#### Что происходит при `test()`

- При запуске `bot.test()` автоматически отправляется первое сообщение `'Привет'` (имитация старта сессии с
  `messageId === 0`).
- Дальше вы вводите текст вручную, бот отвечает так же, как ответил бы на реальной платформе.
- Выход — введите `exit` или закройте терминал. Также выход произойдёт автоматически, если бот выставил `isEnd = true`.
- `appMode` форсируется в `'dev'` (если явно не указан `strict_prod`).
- Обработка та же, что в продакшене, — вы тестируете реальную логику.

### Тестирование конкретной платформы

`BotTest` по умолчанию работает с «auto»-платформой: при вызове `test()` и `simulate()` без явного указания будет
использована **первая зарегистрированная** (при `fullPlatforms` это Алиса). Платформа, переданная в конструктор,
становится приоритетной для `test()`/`simulate()` — но сам адаптер всё равно нужно зарегистрировать через `bot.use(...)`.
Отдельная особенность `run()`: без явного `appType` он принудительно использует `'alisa'`, даже если в конструкторе
указана другая платформа, — передавайте `appType` явно: `bot.run('telegram', ...)`.

```ts
import { BotTest } from 'umbot/test';
import { fullPlatforms } from 'umbot/plugins';

// Приоритетная платформа — Telegram
const bot = new BotTest('telegram');
bot.use(fullPlatforms);
```

```ts
import { BotTest } from 'umbot/test';
import { fullPlatforms } from 'umbot/plugins';

// Приоритетная платформа — Алиса
const bot = new BotTest('alisa');
bot.use(fullPlatforms);
```

> Платформу для тестирования нужно зарегистрировать через `bot.use(...)` — иначе `BotTest` не найдёт её адаптер.

### Параметры тестирования

Объект `IBotTestParams` с настройками отображения результатов передаётся в метод `test()`:

| Параметр      | Тип     | По умолчанию | Описание                                          |
| ------------- | ------- | ------------ | ------------------------------------------------- |
| isShowResult  | boolean | false        | Отображать полный ответ платформы в формате JSON  |
| isShowStorage | boolean | false        | Отображать данные из хранилища (userData и state) |
| isShowTime    | boolean | true         | Отображать время выполнения запроса в мс          |

```ts
const bot = new BotTest();

// Расширенное тестирование с отображением всех данных
await bot.test({
    isShowResult: true, // Показать JSON-ответ платформы
    isShowStorage: true, // Показать данные пользователя и хранилища
    isShowTime: true, // Показать время выполнения
});
```

### Тестирование с настройкой платформы

```ts
import { BotTest } from 'umbot/test';
import { TelegramAdapter } from 'umbot/plugins';

const bot = new BotTest('telegram');

bot.use(new TelegramAdapter('your-token'));
bot.setPlatformParams({
    intents: [
        {
            name: 'greeting',
            slots: ['привет', 'здравствуйте'],
        },
    ],
});

bot.initBotController(MyController);

await bot.test({
    isShowResult: true,
    isShowStorage: true,
});
```

### Автоматизированное тестирование

`BotTest` можно использовать в unit-тестах для проверки логики:

```ts
import { BotTest } from 'umbot/test';
import { fullPlatforms } from 'umbot/plugins';
import { MyController } from './MyController';

describe('MyController', () => {
    it('should greet user', async () => {
        const bot = new BotTest();
        bot.use(fullPlatforms); // без зарегистрированной платформы run() бросит ошибку
        bot.initBotController(MyController);

        // Запуск обработки запроса. Важно: payload должен быть валидным для платформы —
        // адаптер проверяет структуру (например, Алиса требует session + request),
        // иначе setQueryData() вернёт false и запрос будет отклонён
        const result = await bot.run(
            'alisa',
            JSON.stringify({
                version: '1.0',
                session: { message_id: 0, user_id: 'test-user' },
                request: { command: 'привет', original_utterance: 'Привет' },
            }),
        );

        // Проверка результата — лучше проверять содержимое, а не только факт наличия
        expect(result).toBeDefined();
        expect(JSON.stringify(result)).toContain('Привет');
    });
});
```

### Симуляция запроса: `simulate()`

Вместо ручной сборки JSON-запроса платформы можно использовать `simulate()` — метод сам сгенерирует корректный payload для указанной платформы и вызовет `run()`:

```ts
import { BotTest } from 'umbot/test';
import { AlisaAdapter, T_ALISA } from 'umbot/plugins';

const bot = new BotTest();
bot.use(new AlisaAdapter());
bot.addCommand('start', ['привет'], (_, ctx) => {
    ctx.text = 'Привет!';
});

// Голосовая платформа: результатом будет готовый JSON-ответ платформы
const res = (await bot.simulate('привет', { platform: T_ALISA })) as {
    response: { text: string };
};
console.log(res.response.text); // 'Привет!'
```

Для чат-платформ (Telegram, VK, Viber, Max) `simulate()` включает `skipAutoReply`, поэтому
реальной отправки сообщения в API платформы не происходит — даже если токен не задан:

```ts
import { BotTest } from 'umbot/test';
import { TelegramAdapter, T_TELEGRAM } from 'umbot/plugins';

const bot = new BotTest();
bot.use(new TelegramAdapter('your-token'));
bot.addCommand('start', ['привет'], (_, ctx) => {
    ctx.text = 'Привет!';
});

// Для чат-платформ результат — 'ok' (отправка пропущена),
// а текст ответа остаётся в контроллере
await bot.simulate('привет', { platform: T_TELEGRAM });
console.log(bot.getBotController()?.text); // 'Привет!'
```

Параметры `simulate(query, options)`:

| Параметр           | Тип                | По умолчанию                                         | Описание                                          |
| ------------------ | ------------------ | ---------------------------------------------------- | ------------------------------------------------- |
| `query`            | `string`           | —                                                    | Текст пользователя                                |
| `options.platform` | `TAppType`         | платформа конструктора или первая зарегистрированная | Платформа, для которой генерируется запрос        |
| `options.userId`   | `string`           | `'test_user'`                                        | ID пользователя                                   |
| `options.count`    | `number`           | `0`                                                  | Номер сообщения (`0` — новый пользователь/сессия) |
| `options.state`    | `object \| string` | `{}`                                                 | Предзаполненное состояние сессии                  |

Метод возвращает тот же результат, что и `run()`: для голосовых платформ — JSON-ответ,
для чат-платформ — строку `'ok'`, так как отправка в API в режиме симуляции пропускается.

### Jest-тесты с полной настройкой

Более детальный пример с настройкой платформы и проверкой ответа:

```ts
import { BotTest } from 'umbot/test';
import { fullPlatforms, T_ALISA } from 'umbot/plugins';
import { MyController } from '../../src/controller/MyController';

describe('MyController', () => {
    let bot: BotTest;

    beforeAll(() => {
        bot = new BotTest();
        bot.use(fullPlatforms);
        bot.setAppConfig({ isLocalStorage: true });
        bot.setPlatformParams({
            welcome_text: 'Привет!',
            intents: [{ name: 'help', slots: ['помощь'] }],
        });
        bot.initBotController(MyController);
    });

    it('handles welcome', async () => {
        const result = await bot.run(
            T_ALISA,
            JSON.stringify({
                version: '1.0',
                session: { message_id: 0, user_id: 'test-user' },
                request: { command: 'привет', original_utterance: 'Привет' },
            }),
        );
        expect(result).toBeDefined();
    });

    it('handles help command', async () => {
        const result = await bot.run(
            T_ALISA,
            JSON.stringify({
                version: '1.0',
                session: { message_id: 1, user_id: 'test-user' },
                request: { command: 'помощь', original_utterance: 'Помощь' },
            }),
        );
        expect(result).toBeDefined();
    });
});
```

### Моки: HTTP-клиент и файловая БД

Чтобы тесты не ходили в сеть и не трогали диск, подмените HTTP-клиент контекста и чтение файлов `FileAdapter`:

```ts
import { BotTest } from 'umbot/test';
import { fullPlatforms, FileAdapter } from 'umbot/plugins';

const bot = new BotTest();
bot.use(fullPlatforms);

// Мок HTTP-клиента: запросы к API платформ и внешним сервисам не уходят в сеть
bot.getAppContext().httpClient = (): Promise<Response> =>
    Promise.resolve(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }));

// Мок файловой БД: таблицы читаются из памяти, а не с диска
const tables: Record<string, Record<string, Record<string, unknown>>> = { UsersData: {} };
const adapter = new FileAdapter();
adapter.getFileData = (tableName) => {
    const data = (tables[tableName] ??= {});
    adapter.setCachedFileData(tableName, { data, version: Date.now(), isFileRead: true });
    return data;
};
bot.use(adapter);
```

### BotTest vs run() — что выбрать?

| Способ                           | Когда использовать                         | Что получаете                                               |
| -------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| `bot.test()`                     | Интерактивная отладка в консоли            | Диалог в реальном времени, вводите текст руками             |
| `bot.run(appType, content)`      | Автоматизированные тесты (Jest)            | Программный доступ к результату, можно проверять assertions |
| `bot.setContent()` + `bot.run()` | Тестирование с предустановленным контентом | Удобно для повторяющихся тестов                             |

**Рекомендация:** используйте `bot.run()` для Jest-тестов — это даёт полный контроль над входящими данными и возможность проверять результат.

### Выход из тестирования

Из режима тестирования можно выйти двумя способами:

1. Введите `exit` в консоли
2. Если контроллер установил `this.isEnd = true`, диалог завершится автоматически

### Отображаемая информация

В зависимости от параметров, `BotTest` выводит:

- **Ответ**: текстовый ответ приложения (для голосовых платформ — `response.text`, для чат-ботов — `text`)
- **Ответ в формате платформы** (при `isShowResult: true`): полный JSON-ответ
- **Данные в базе** (при `isShowStorage: true`): содержимое `userData` и `state`
- **Время выполнения** (при `isShowTime: true`): время обработки запроса в миллисекундах

## Идеально для

- Отладки логики
- Замеров скорости
- Автоматизированных unit-тестов
