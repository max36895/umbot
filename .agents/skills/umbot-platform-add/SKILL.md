---
name: umbot-platform-add
description: Добавить адаптер новой платформы в umbot (src/plugins/platforms/<Name>/) — каркас, контракт BasePlatform, кнопки/карточки, тесты, регистрация. Используй при "добавь платформу X", "нужна поддержка WhatsApp / Discord / Mattermost", "платформа X появилась, надо адаптер".
---

# Platform Add: скилл для добавления новой платформы

## Назначение

Добавить адаптер для новой платформы в `src/plugins/platforms/<Name>/`. Скилл проводит
пошагово: от анализа API платформы до готовых файлов и тестов.

## Триггер

- "добавь платформу X"
- "нужна поддержка WhatsApp / Discord / MatterMost"
- "платформа X появилась, надо адаптер"

## Воркфлоу (строго по шагам)

### Шаг 0: Собери требования у автора

Спроси:

1. Как называется платформа коротким именем (для T\_<NAME>)? (латиница, snake_case)
2. Webhook или polling? (если оба — начнём с webhook)
3. Какой тип авторизации? (бот-токен в URL, header, HMAC signature)
4. Какой формат кнопок? (inline/reply/custom — для понимания Adapter)
5. Есть ли карточки/галереи/аудио?
6. Есть ли служебные события (user joined, message deleted)?

Если автор не знает деталей — попроси JSON запроса/ответа из API-документации платформы.

### Шаг 1: Изучи API платформы

Прочитай официальную документацию. Выяви:

- Формат webhook payload (структура message/user/callback)
- Метод отправки ответа (какой endpoint, какие параметры)
- Лимиты (длина текста, размер attachments, кнопок per row, callback_data)
- Требования к авторизации

### Шаг 2: Создай каркас — `src/plugins/platforms/<Name>/`

Скопируй структуру от аналогичной платформы (например, от Max):

```
<Name>/
├── Adapter.ts        # extends BasePlatform<TContent>
├── Button.ts         # buttonProcessing
├── Card.ts           # cardProcessing
├── Sound.ts          # soundProcessing
├── constants.ts      # T_<NAME> и платформенные константы (лимиты, форматы — как TG_CALLBACK_DATA_MAX_LENGTH в Telegram)
└── interfaces/
    └── I<Name>Platform.ts  # входящий формат updates
```

И отдельно (у `API/` есть собственные `constants.ts` — `getErrorMsg`/`getErrorToken` — и `interfaces/` для типов `I<Name>Api`; не забудь зарегистрировать новый Request в `src/plugins/platforms/API/index.ts`, иначе `umbot/plugins` его не увидит):

```
src/plugins/platforms/API/<Name>Request.ts  # HTTP клиент к API
```

### Шаг 3: Определи контракты

В `Adapter.ts` реализуй:

- `platformName` — короткий идентификатор (латиница, snake_case)
- `isVoice` + `static isVoice()` — ОБА. Поле — для экземпляра, static — для агрегаторов (`botPlatforms`/`voicePlatforms` фильтруют по static-методу, дефолт Base — `true`). Чат-платформа без static-переопределения не попадёт в `botPlatforms` и ошибочно попадёт в `voicePlatforms` — реальная ловушка регистрации.
- `limit` — платформенный rate limit (запросов/сек)
- `signatureName` — имя заголовка для проверки подписи входящего вебхука (если есть — иначе `undefined`; не путай с auth-заголовком исходящих API-запросов — например, у MAX подпись вебхука `x-max-bot-api-secret`, а `Authorization: <token>` — это auth исходящих запросов)
- `supportedEvents` — события `TEventType`, которые адаптер выставляет в `controller.eventType` (дефолт Base — `['message']`; список всех событий — `ALL_EVENT_TYPES` в `src/core/events.ts`). Обязателен с 3.1.0: `bot.addEvent` валидирует хендлеры по `supportedEvents` подключённых адаптеров.
- `init(appContext)` — запись токена и секретов в конфиг
- `isPlatformOnQuery(query, headers)` — детектор запроса этой платформы
- `setQueryData(query, controller)` — универсальный маппинг в BotController: ОБЯЗАН выставлять `controller.eventType` (`TEventType`) по типу апдейта; хендлеры `bot.addEvent` вызываются до команд именно по этому полю
- `getContent(controller)` — формирование ответа в формате платформы
- `isCorrectQuery(query, headers)` — проверка подписи (может переопределять Base)
- `getQueryExample(query, userId, count, state)` — генерация примера входящего запроса. Не abstract, но переопределяется всеми встроенными адаптерами; без него платформа выпадает из `BotTest.simulate()` и консольного тестирования (`src/test.ts`)

⚠️ Нюанс `Card.getCards(cardProcessing, controller)`: метод возвращает результат
`cardProcessing` как есть. Если твой `cardProcessing` асинхронный (Telegram, VK,
Alisa, Marusia, Max) — вызов обязан быть с `await`. Если синхронный (Viber,
SmartApp) — `await` не нужен. Определи это до написания `getContent` и не копируй
вызов из чужого адаптера вслепую.

⚠️ Лимиты и форматы проверяй по официальной документации платформы и заноси
подтверждённые факты в таблицу/раздел «Verified» в `AGENTS.md` (см. раздел 9).

### Шаг 4: Пиши unit-тесты

В `tests/Platforms/<Name>/adapter.test.ts` необходимы:

- `setQueryData` корректно маппит query → controller field
- `isCorrectQuery` отклоняет невалидный payload
- `isCorrectQuery` пропускает валидный
- `getContent` формирует корректный формат платформы
- Кнопки преобразуются в формат платформы
- Пустые ответы обрабатываются без падения

Обязательные тесты 3.1.0 (существующие наборы в `tests/Platforms/` — подключись к ним):

- Маппинг `controller.eventType` для каждого типа апдейта платформы (по образцу `tests/Platforms/eventType.test.ts`)
- Служебные/неизвестные события: `skipAutoReply = true` + HTTP 200, а не `false` из `setQueryData` (по образцу `tests/Platforms/serviceEvents.test.ts`)
- `getQueryExample` — payload для `BotTest.simulate` валиден для `setQueryData`
- Участие в общих контрактах: `tests/Platforms/platformContracts.test.ts`, `tests/Platforms/apiFacade.test.ts` — добавь свою платформу туда, где перечислены остальные

### Шаг 5: Добавь регистрацию

- `src/plugins/index.ts` — экспорт `<Name>Adapter`, `T_<NAME>` и API-класса (`export * as <Name>Button from './platforms/<Name>/Button'` и т.п.)
- `src/plugins/platforms/adapters.ts` — добавь адаптер в список `adapters` (его используют `fullPlatforms`/`botPlatforms`/`voicePlatforms`)
- Если платформе нужен API-фасад (`controller.api`: `sendPhoto`, `answerCallback` и т.п.) — создай фабрику `make<Name>Api` в `src/plugins/platforms/<Name>/apiFacade.ts` (контракт `IControllerApi` из `src/controller`) и переопредели метод `createApi(controller)` в своём адаптере: ядро подключает фасад само через контракт `IPlatformAdapter`. Без переопределения фасад останется `null` и `api.can(...) === false` (базовая реализация `BasePlatform.createApi` возвращает `null`). Кейс диспетчера `switch` в `Base/apiFacade.ts` НЕ добавляй — ядро его больше не использует, там живут только встроенные платформы; добавь свою фабрику в реэкспорт `src/plugins/index.ts`, если хочешь дать её пользователю напрямую
- Env-токены: `AppContext` подхватывает `<NAME>_TOKEN` из `process.env` по жёсткому списку (фича 3.1.0) — новая платформа требует записи в `#readEnvFromProcess`/`applyEnvValue` (`src/core/AppContext.ts`), это правка ядра (`umbot-core-engineer`)
- Проверь, что нет конфликтов имен (T_X, T_Y) и дублирования констант

### Шаг 6: Обнови документацию

Обязательная часть задачи, не «потом» (AGENTS.md раздел 6):

- `src/docs/getting-started.md` — пример с новым адаптером
- `src/docs/platform-integration.md` — раздел платформы: токен, регистрация вебхука, поддерживаемые события, кнопки, карточки, лимиты
- `src/docs/platform-contract-comparison.md` — новая платформа в сравнительных таблицах
- `README.md` — добавь платформу в список поддерживаемых
- AGENTS.md раздел 9 — строка в матрице (лимит текста, кнопки, типы карточек, подпись вебхука) и, если есть неочевидные нюансы API, пункт в списке проверенных фактов
- `CHANGELOG.md` — секция по правилам AGENTS.md раздела 6: `[Unreleased]` не использовать; писать в верхнюю невыпущенную секцию, а если её нет — спросить у пользователя версию и срок релиза

### Шаг 7: Прогон верификации

```bash
npm run build
npm run test
npm run prettier
npm run lint
```

Все должны пройти. Если падает — чини, не скипай.

## Анти-паттерны — НЕ делай так

1. ❌ **Не импортируй из plugins/ в core/.** Платформа не должна менять ядро.
2. ❌ **Не пиши `any`**. Используй строгие интерфейсы. Если API возвращает unknown - narrow.
3. ❌ **Не добавляй в публичный API необоснованных параметров**. Если параметр нужен только тебе - это protected.
4. ❌ **Не делай async без ожидания**. Все `Promise` должны быть обработаны (и см. нюанс `getCards` выше).
5. ❌ **Не пиши тесты, зависящие от реальной сети.** Все fetch должны быть замоканы.
6. ❌ **Не обращайся к `button.options` без `?.`** (или `?? {}`). Компонент `Buttons` всегда его задаёт, но кнопка может прийти объектом, собранным вручную — TypeError в `getContent` даёт 500 платформе. Образцы: Telegram/VK/Max/Viber.
7. ❌ **Не вставляй payload в JSON платформы напрямую.** Используй `serializePlatformPayload` (сериализация с логированием несериализуемых значений) и `tryParse` из `src/plugins/platforms/Base/utils.ts`.
8. ❌ **Не отправляй запрос без проверки `_getOptions()`/attach.** `Request._getOptions()` возвращает `undefined` при ошибке attach — проверяй перед `fetch` (см. `Request.ts`).
9. ❌ **Не возвращай `false` из `setQueryData` для служебных событий.** На `5xx` платформы включают ретраи и отключают вебхук (Telegram повторяет апдейт бесконечно, VK отключает сервер) — такие события помечаются `skipAutoReply`, и ответ платформе всегда HTTP 200 (см. раздел 10.1 AGENTS.md).

## Ссылки

- Базовый класс: `src/plugins/platforms/Base/Base.ts`
- Хороший пример (простейший): `src/plugins/platforms/Max/Adapter.ts` (самый близкий по размеру — `Viber/Adapter.ts`, чуть меньше)
- Средняя сложность: `src/plugins/platforms/Viber/Adapter.ts`
- Сложный (со звуком и загрузкой): `src/plugins/platforms/Telegram/Adapter.ts`

## Критерии успеха

Ты закончил, когда:

1. ✅ Новый адаптер интегрируется через `bot.use(new <Name>Adapter(token))`
2. ✅ Все существующие тесты проходят (актуальное число проверяй через `npm run test`, не хардкодь)
3. ✅ Есть минимум 8 новых тестов на adapter (базовые 6 + eventType-маппинг + служебные события/skipAutoReply)
4. ✅ Документация обновлена (getting-started, platform-integration, platform-contract-comparison, README), AGENTS.md матрица платформ дополнена, CHANGELOG обновлён в правильную секцию (не `[Unreleased]`)
5. ✅ Линтер чистый (0 errors)
