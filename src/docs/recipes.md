# Рецепты umbot: готовые решения типовых задач

Короткие законченные примеры для частых задач: эхо-навык, регистрация, игра со счётом, карточка товара, пагинация,
HTTP-запрос с таймаутом, авторизация Алисы, кнопки с payload, логгер, NLU- и i18n-плагины, inline-режим Telegram.

Во всех рецептах `bot` — экземпляр `Bot`, созданный и настроенный как в
[минимальном примере](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/GUIDE#минимальный-рабочий-пример); импорты показаны там, где рецепт
использует что-то сверх `Bot` и `BotController`. Объяснение понятий — в [руководстве](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/GUIDE),
полные сигнатуры — в [справочнике API](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/api-reference).

## Рецепты

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

bot.addCommand(FALLBACK_COMMAND, [], (userCommand, bc) => {
    bc.text = `Вы сказали: ${userCommand}`;
});

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
    bc.userData.name = bc.originalUserCommand ?? '';
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
        action(intentName: string | null, isCommand?: boolean, isStep?: boolean): void {
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
>
> На Telegram, VK и MAX нажатие callback-кнопки проще обработать через `bot.addAction('buy', cb)`: payload `'buy'` или
> `{"command":"buy"}` адаптер превращает в имя действия (см. [справочник API](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/api-reference#действия-кнопок-addaction)).

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
import { BotController, MiddlewareNext } from 'umbot';
import { T_ALISA, T_TELEGRAM } from 'umbot/plugins';

// Фабрика: одна логика, разные метки
const logMiddleware = (label: string) => async (ctx: BotController, next: MiddlewareNext) => {
    ctx.appContext.log(`[${label}] → ${ctx.userCommand}`);
    await next();
    // Здесь ответ ещё НЕ сформирован: обработчик запустится после всей цепочки middleware
    ctx.appContext.log(`[${label}] ←`);
};

bot.use(logMiddleware('global'));
bot.use(T_ALISA, logMiddleware('alisa'));
bot.use(T_TELEGRAM, logMiddleware('telegram'));
```

Порядок вывода: `[global] →` → `[global] ←` → `[alisa] →` → `[alisa] ←` — глобальная цепочка завершается целиком до
начала платформенной. Текст ответа логируйте в `responseCb` у `bot.start()` — только там он уже готов.

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

    // Обязательная часть контракта IPlugin: вызывается при bot.clearUse() / bot.close()
    destroy(): void {}
}

// Использование
bot.use(new MyNluPlugin());
```

### Рецепт 16: i18n-плагин

Слот i18n типизирован как `(key: string, ...params: unknown[]) => string`, но на практике фреймворк вызывает его с
**единственным аргументом** — текущим `controller.text` в роли `key` — и ожидает получить переведённую строку. Вызов
делает `BaseBotController` (контроллер по умолчанию) после отработки команды, перед отправкой ответа. Если вы
подключили свой контроллер, унаследованный от `BotController`, перевод не выполнится — наследуйтесь от
`BaseBotController` или вызывайте плагин сами. Функция или объект с методом `getData(key)` — оба варианта
поддерживаются.

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

Inline-запрос Telegram приходит универсальным событием `inline`. Ответьте на него готовым методом
`answerInlineQuery()` (не через `call()` — он шлёт сообщения, а не результаты inline-поиска):

```ts
import { TelegramRequest } from 'umbot/plugins';

bot.addEvent('inline', async (ctx) => {
    // Событие 'inline' приходит только с inline_query в запросе
    const req = ctx.requestObject as { inline_query?: { id: string; query: string } };
    if (!req.inline_query) return;
    const telegramApi = new TelegramRequest(ctx.appContext);
    await telegramApi.answerInlineQuery(req.inline_query.id, [
        {
            type: 'article',
            id: '1',
            title: 'Пример',
            input_message_content: { message_text: 'Привет из inline-режима!' },
        },
    ]);
    ctx.skipAutoReply = true; // ответ уже отправлен
});
```

## Сценарии, требующие своей реализации

Это не недостатки фреймворка — это просто сценарии, для которых нет готовых примеров в репозитории. Разработчику
придётся реализовать их самостоятельно, опираясь на API.

### Serverless-деплой (Yandex Cloud Functions, AWS Lambda)

В serverless вместо `bot.start()` используйте `bot.webhookEvent(body, headers, clientIp)`: он проверяет подпись
вебхука и возвращает готовый `{ statusCode, body }` для облачной функции. Проект с готовым обработчиком и скриптом
деплоя генерирует `npx umbot create from-flow flow.json --usecloud`; ручной обработчик — в
[Развертывании](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/deployment#serverless).

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
`BaseBotController` пропустит `controller.text` через него перед отправкой ответа (см. рецепт 16 про свой
контроллер):

```ts
import i18next from 'i18next';
import { createPlugin } from 'umbot';

bot.use(
    createPlugin((appContext) => {
        appContext.plugins.i18n = (text: string) => i18next.t(text, { lng: 'ru' });
    }),
);
```

### Загрузка изображений по URL на лету

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

Распространённая задача, для которой нет готового примера. Используйте `Navigation` + `card.addImage` (см. рецепт 6 и
раздел про карточки в [руководстве](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/GUIDE#card--карточки)).
