# Сверка контрактов платформ: официальная документация ↔ umbot

Дата сверки: **2026-08-29**. Версия фреймворка: ветка `v-3.1.0` (HEAD `7194d8b`).

Для каждого действия платформы сопоставлены официальный контракт (endpoint,
обязательные параметры, лимиты) и то, что фреймворк фактически отправляет —
либо, для webhook-платформ, то, что платформа ожидает в ответе, против того,
что возвращает `getContent()`.

**Обозначения:**

- ✅ — сверено с официальной документацией 2026-08-29;
- 📄 — по документации, зафиксированной в `AGENTS.md` §9 (страница в день сверки
  была недоступна — факт помечен для повторной проверки);
- ⚠️ — расхождение/нюанс (с указанием, нарушение это или нет).

---

## 1. Telegram

Источник: [Bot API](https://core.telegram.org/bots/api) 📄 (в день сверки страница
не открывалась; факты зафиксированы в AGENTS.md §9 и покрыты тестами).

**Общий транспорт.** Официально: `POST https://api.telegram.org/bot<token>/<method>`,
JSON-тело. Фреймворк: `TelegramRequest.call()` → тот же URL (токен приоритетно из
`initToken()`, fallback — конфиг), JSON, таймауты 5.5 с / 30 с для upload ✅(📄).

| Действие              | Официальный контракт                                                                                                                            | Что отправляет фреймворк                                                                                                                                                                                                                                                           | Статус |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Ответ на webhook      | Обычный HTTP 200 (тело игнорируется)                                                                                                            | HTTP 200, тело `ok`; на неизвестные апдейты — `skipAutoReply`, без 5xx                                                                                                                                                                                                             | ✅     |
| `sendMessage`         | Обяз.: `chat_id`, `text` (1–4096); `parse_mode`, `reply_markup` опциональны                                                                     | `POST bot<token>/sendMessage` `{chat_id, text (≤4096, resize), reply_markup (JSON), parse_mode — только при явной настройке и снимается при обрезке текста}`; пустой текст не отправляется                                                                                         | 📄 ✅  |
| Клавиатуры            | `inline_keyboard: [[{text, callback_data\|url}]]`, `callback_data` 1–64 байта, `url` и `callback_data` взаимоисключающи; `keyboard: [[{text}]]` | `buttonProcessing` строит массив массивов (ряды — по `options._group`/`buttons.row()`, до 8 кнопок в ряду, иначе каждая кнопка — своя строка); payload сериализуется и проверяется на 64 байта; url-кнопки без callback_data; смешение inline+reply — warning, отправляется inline | 📄 ✅  |
| `sendPhoto`           | `chat_id`, `photo` (URL/file_id/multipart), `caption` ≤1024                                                                                     | `POST sendPhoto`: `photo` = URL → строка, file_id → строка, локальный файл → multipart; `caption` ≤1024                                                                                                                                                                            | 📄 ✅  |
| `sendMediaGroup`      | `media` — массив 2–10, `attach://` для файлов в multipart                                                                                       | `POST sendMediaGroup` (FormData): `media` JSON 2–10 c `attach://`-ключами для локальных файлов; одиночное фото уходит через `sendPhoto`                                                                                                                                            | 📄 ✅  |
| `sendPoll`            | `chat_id`, `question` ≤300, `options` 1–12, для quiz `correct_option_ids`                                                                       | `{chat_id, question (≤300), options (JSON [{text ≤100}] 1–12), correct_option_ids (валидация индексов), explanation, ...}`                                                                                                                                                         | 📄 ✅  |
| `answerCallbackQuery` | Обяз.: `callback_query_id`; `text` ≤200                                                                                                         | `{callback_query_id, text (≤200), show_alert, url, cache_time}`                                                                                                                                                                                                                    | 📄 ✅  |
| `answerInlineQuery`   | `inline_query_id`, `results`                                                                                                                    | `{inline_query_id, results: [одна article с message_text ≤4096]}`                                                                                                                                                                                                                  | 📄 ✅  |
| Webhook secret        | Заголовок `X-Telegram-Bot-Api-Secret-Token` (сравнение строки-секрета, не HMAC от тела)                                                         | `isCorrectQuery`: `timingSafeEqual` (константное время) с `webhookSecret`, opt-in                                                                                                                                                                                                  | 📄 ✅  |

## 2. VK

Источники: [messages.send](https://dev.vk.ru/ru/method/messages.send) ✅,
[users.get](https://dev.vk.ru/ru/method/users.get) ✅,
[messages.sendMessageEventAnswer](https://dev.vk.ru/ru/method/messages.sendMessageEventAnswer) ✅,
[Callback API](https://dev.vk.com/ru/api/callback/get-started) 📄 (в день сверки разделы
VK на техобслуживании).

**Общий транспорт.** Официально: `POST https://api.vk.ru/method/<метод>`, параметры
запроса, `access_token`, `v`. Фреймворк: `VkRequest.call()` → `x-www-form-urlencoded`
(`httpBuildQuery`), `access_token` + `v=5.199`, таймаут 5.5 с (upload 30 с).

| Действие                             | Официальный контракт                                                                                                                                                                                    | Что отправляет фреймворк                                                                                                                                                                                                          | Статус                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Ответ на webhook (события)           | HTTP 200                                                                                                                                                                                                | HTTP 200, тело `ok`                                                                                                                                                                                                               | ✅                                                              |
| Ответ на `confirmation`              | Строка подтверждения из настроек сообщества                                                                                                                                                             | `sendInInit` = строка подтверждения (опция адаптера или `confirmation_token` из конфига)                                                                                                                                          | 📄 ✅                                                           |
| `messages.send` ✅                   | Обяз.: `random_id`; адресат `peer_id`/`user_id`/`domain`; `message` обязателен при отсутствии `attachment`; лимит `message` — **9000**                                                                  | `{peer_id (или domain), message (≤4096, resize), random_id (int32), attachment (join ','), keyboard, template}`; keyboard+template взаимоисключающи (template удаляется с warning); пустое сообщение без контента не отправляется | ✅ ⚠️ фреймворк режет до 4096 — **консервативно, не нарушение** |
| Клавиатура VK                        | `buttons: [[{action{type, label ≤40, payload ≤255, link}, color}]]`; vkpay: `hash` внутри `action`                                                                                                      | `buttonProcessing`: label ≤40, payload ≤255 (по кодовым точкам), color; vkpay `hash` в `action.hash`, `hash: null` не отправляется                                                                                                | 📄 ✅                                                           |
| `users.get` ✅                       | Параметр — `user_ids` (строка, список через запятую); `user_id` не документирован                                                                                                                       | `{user_ids: String(id)}` для числа / `user_ids: "a,b"` для массива                                                                                                                                                                | ✅                                                              |
| `messages.sendMessageEventAnswer` ✅ | Обяз.: `event_id`, `user_id`, `peer_id`; `event_data` — объект действия (show_snackbar/open_link/open_modal)                                                                                            | `{user_id (int, валидация), event_id, peer_id (int), event_data (JSON ≤1000)}`                                                                                                                                                    | ✅ ⚠️ лимит 1000 на странице не указан — консервативно          |
| Загрузка фото/документов             | `photos.getMessagesUploadServer` → upload_url → multipart → `photos.saveMessagesPhoto{photo, server, hash}`; документы — `docs.getMessagesUploadServer{peer_id, type}` → `docs.save{file, title, tags}` | Последовательность 1:1: getUploadServer → `upload()` (multipart) → save; токен кэшируется в ImageTokens/SoundTokens                                                                                                               | 📄 ✅                                                           |
| Webhook secret                       | Поле `secret` в теле каждого callback (при включении «Секретный ключ» в группе)                                                                                                                         | `isCorrectQuery`: `timingSafeEqual` тела `secret` с `secret_key`, opt-in                                                                                                                                                          | 📄 ✅                                                           |

## 3. Viber

Источник: [REST Bot API](https://developers.viber.com/docs/api/rest-bot-api/) ✅ —
сверено с живой документацией 2026-08-29.

**Общий транспорт.** Официально: `POST https://chatapi.viber.com/pa/<method>`, JSON,
заголовок `X-Viber-Auth-Token`, размер тела ≤30 КБ, успешный ответ `status === 0`.
Фреймворк: `ViberRequest.call()` → 1:1, плюс проверка 30 КБ до отправки, нормализация
`min_api_version`.

| Действие                    | Официальный контракт                                                                                                                | Что отправляет фреймворк                                                                                                                                                                                                                                  | Статус |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `send_message` (text) ✅    | Обяз.: `receiver`, `type`, `sender.name` **≤28**; для text — `text` ≤7000; опц. `keyboard`, `min_api_version`, `tracking_data`      | `{receiver, sender{name ≤28 (или avatar)}, type:'text', text ≤7000 (resize), keyboard (Type:'keyboard', Buttons[]), min_api_version}`                                                                                                                     | ✅     |
| `send_message` (rich_media) | `type:'rich_media'`, `rich_media{Type, ButtonsGroupColumns, ButtonsGroupRows, BgColor, Buttons[]}`; `Columns/Rows` — доля сетки 6×7 | `{..., type:'rich_media', min_api_version ≥7, rich_media{Type:'rich_media', ButtonsGroupColumns:6, ButtonsGroupRows:7, BgColor:'#FFFFFF', Buttons[{Text, ActionType, ActionBody, Columns, Rows, ...}]}}`; текст элемента в `Text` (HTML с экранированием) | ✅     |
| `set_webhook` ✅            | `url` (обяз.), `event_types`, `send_name`, `send_photo`; после вызова Viber присылает проверочный callback и ждёт HTTP 200          | `{url, event_types[delivered, seen, failed, subscribed, unsubscribed, message, conversation_started], send_name:true, send_photo:true}`; событие `webhook` в `setQueryData` → `skipAutoReply` → HTTP 200                                                  | ✅     |
| `get_user_details` ✅       | `{id}`                                                                                                                              | `{id}`                                                                                                                                                                                                                                                    | ✅     |
| Подпись входящих ✅         | `X-Viber-Content-Signature` = HMAC-SHA256(auth_token, тело запроса)                                                                 | `BasePlatform.isCorrectQuery`: HMAC-SHA256 от **сырого** тела (webhookHandle передаёт строку), `timingSafeEqual`                                                                                                                                          | ✅     |
| Ответ на webhook            | HTTP 200                                                                                                                            | HTTP 200, тело `ok`                                                                                                                                                                                                                                       | ✅     |

## 4. MAX

Источник: [Bot API](https://dev.max.ru/docs-api) ✅ — сверено с живой документацией
2026-08-29.

**Общий транспорт.** Официально: базовый URL `https://platform-api2.max.ru`, авторизация
`Authorization: <token>` (query-параметры больше не поддерживаются), лимит 30 rps.
Фреймворк: `MaxRequest.call()` → 1:1, очередь 500 мс/диалог с таймерами `.unref()`.

| Действие                 | Официальный контракт                                                                                                                              | Что отправляет фреймворк                                                                                                                                                                                                                                                                                                                                                                                    | Статус |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Ответ на webhook         | HTTP 200                                                                                                                                          | HTTP 200, тело `ok`; неизвестные `update_type` → `skipAutoReply`                                                                                                                                                                                                                                                                                                                                            | ✅     |
| `POST /messages` ✅      | Тело `{text, attachments[]}`; адресат `user_id`/`chat_id` (query); ≤12 вложений (клавиатура считается вложением); клавиатура ≤30 рядов × 7 кнопок | `POST /messages?{user_id\|chat_id}={id}` body `{text ≤4000 (resize), attachments ≤12 (media + inline_keyboard)}`; кнопки `{type: message\|link\|callback\|request_contact\|request_geo_location\|open_app, text обязателен}` — ряды по `options._group`/`buttons.row()` (до 7 кнопок, 3 — при link/open_app/geo/contact), без группы — каждая в отдельном ряду; интервал ≥500 мс между сообщениями в диалог | ✅     |
| `POST /answers` ✅       | Ответ на callback                                                                                                                                 | `POST /answers?callback_id={id}` body `{}` (подтверждение нажатия; ответ — отдельным `POST /messages`) или `{message}` при `max_callback_edit_message: true` / `api.answerCallback(text)` (`message` заменяет сообщение с кнопкой); интервал на диалог                                                                                                                                                      | ✅     |
| `POST /uploads` ✅       | Возвращает `token` (и `url`); token → вложение                                                                                                    | `POST /uploads?type=image\|video\|audio\|file` → POST multipart на полученный `url` → во вложение идёт `token` (или `url` для image); таймаут загрузки 30 с                                                                                                                                                                                                                                                 | ✅     |
| `POST /subscriptions` ✅ | `{url, update_types, secret}`; HTTPS обязателен                                                                                                   | `{url (валидация: https, порт 443), update_types, secret}`; secret дополнительно валидируется `[A-Za-z0-9_-]{5,256}`                                                                                                                                                                                                                                                                                        | ✅     |
| Webhook secret           | Заголовок `x-max-bot-api-secret` с secret из подписки                                                                                             | `isCorrectQuery`: plain `timingSafeEqual` с `webhookSecret`, opt-in                                                                                                                                                                                                                                                                                                                                         | 📄 ✅  |

## 5. Алиса (Яндекс.Диалоги) — ответ на webhook

Источники: [протокол](https://yandex.ru/dev/dialogs/alice/doc/ru/protocol-docpage/),
[ItemsList](https://yandex.ru/dev/dialogs/alice/doc/ru/response-card-itemslist-docpage/) ✅
(сверено ранее 2026-08: лимиты и `footer.button` подтверждены). Страница общего формата
ответа в день сверки отдавала 404 — поля ниже по зафиксированной документации 📄.

**Исходящих запросов для обычного ответа нет** — платформа ждёт HTTP 200 с JSON.
Сверка «ожидает ↔ отдаём»:

| Поле ответа                                                 | Официальный контракт                                                                                                                                                                                                                               | Что отдаёт фреймворк                                                                                          | Статус              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------- |
| `version`                                                   | `"1.0"`                                                                                                                                                                                                                                            | `VERSION = '1.0'`                                                                                             | 📄 ✅               |
| `response.text`                                             | ≤1024; может быть пустым только при заполненном `tts`                                                                                                                                                                                              | `Text.resize(controller.text, 1024)`; warn при пустых text+tts                                                | 📄 ✅               |
| `response.tts`                                              | ≤1024 знаков, `<speaker>`/`sil` не входят в лимит                                                                                                                                                                                                  | `resizeAlisaTts` — лимит по видимому тексту, теги не рвутся                                                   | 📄 ✅               |
| `response.card`                                             | BigImage / ItemsList (1–5) / ImageGallery (1–10); лимиты: `title` 128, `description` 256/1024, `header.text`/`footer.text`/`button.text` 64, `button.url` 1024 байт, `button.payload` 4096 байт; `footer = {text, button}`; image_id не обязателен | `cardProcessing` (Alisa/Card.ts): те же типы, лимиты 1:1, текстовые элементы без изображения не выбрасываются | ✅                  |
| `response.buttons`                                          | `[{title ≤64, url ≤1024 байт, payload ≤4096 байт, hide}]`                                                                                                                                                                                          | `buttonProcessing`: те же лимиты по байтам                                                                    | 📄 ✅               |
| `response.end_session`                                      | boolean                                                                                                                                                                                                                                            | `controller.isEnd`                                                                                            | 📄 ✅               |
| `session` (эхо)                                             | Пример в документации содержит `session {session_id, message_id, user_id}`                                                                                                                                                                         | **Не возвращается**                                                                                           | ⚠️ см. примечание 1 |
| `user_state_update` / `application_state` / `session_state` | ≤1 КБ                                                                                                                                                                                                                                              | Проверка `Buffer.byteLength ≤ 1024` (ALISA_STATE_MAX_BYTES), иначе поле не отправляется с logError            | 📄 ✅               |
| `directives.start_account_linking`                          | При запросе авторизации                                                                                                                                                                                                                            | Добавляется при `controller.isAuth && userToken === null`                                                     | 📄 ✅               |
| Health-check (`original_utterance === 'ping'`)              | Ответ должен содержать pong                                                                                                                                                                                                                        | `sendInInit = {version, response:{text:'pong'}}` без вызова бизнес-логики                                     | 📄 ✅               |

> **Примечание 1 (⚠️ единственное найденное расхождение с примером документации).**
> Официальный пример ответа включает эхо `session`; фреймворк его не отправляет.
> Страница формата ответа в день сверки была недоступна, поэтому обязательность поля
> подтвердить не удалось; эмпирически Яндекс принимает ответ без `session` (навыки на
> umbot проходят health-check и модерацию). Это **не подтверждённое нарушение** —
> пункт для точечной сверки, когда документация станет доступна.

### Исходящие запросы Алисы (картинки, TTS)

| Действие                   | Официальный контракт                                                                                                    | Что отправляет фреймворк                                                                            | Статус |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------ |
| Проверка квоты изображений | `GET https://dialogs.yandex.net/api/v1/status`, `Authorization: OAuth <token>`                                          | `YandexImageRequest.checkOutPlace()` → тот же URL                                                   | 📄 ✅  |
| Загрузка изображения       | `POST .../skills/{skill_id}/images` — `{url}` для remote, multipart для файла; `DELETE .../images/{image_id}`           | 1:1 (`downloadImageUrl` / `downloadImageFile` с whitelist расширений / `deleteImage`), таймаут 15 с | 📄 ✅  |
| TTS                        | `POST https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize`, `{text, lang, voice, format, speed, emotion}` → аудио | 1:1 (`YandexSpeechKit`), oggopus, параметр `folderId` опционально                                   | 📄 ✅  |

## 6. Маруся — ответ на webhook

Источник: протокол Маруси ([dev.vk.com/ru/marusia/protocol](https://dev.vk.com/ru/marusia/protocol)) 📄 —
в день сверки разделы VK были на техобслуживании; факты по зафиксированной документации
и по API-методам Маруси ([dev.vk.com/ru/marusia/api](https://dev.vk.com/ru/marusia/api)).

| Поле ответа                           | Официальный контракт                                                           | Что отдаёт фреймворк                                                                                                                        | Статус                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `version`                             | `"1.0"`                                                                        | `VERSION = '1.0'`                                                                                                                           | 📄 ✅                                                                 |
| `session`                             | Эхо: `{session_id, message_id, user_id}`                                       | `result.session` — эхо из запроса (fallback на пустые значения)                                                                             | 📄 ✅                                                                 |
| `response.text` / `tts`               | ≤1024; tts считается без `<speaker>`/`sil`                                     | 1:1 как в Алисе (`resizeMarusiaTts`)                                                                                                        | 📄 ✅                                                                 |
| `response.card`                       | BigImage `{type, image_id: int}`; ItemsList `{type, items: [{image_id: int}]}` | `cardProcessing` (Marusia/Card.ts): 1:1 (галерея → ItemsList), токены через `marusia.getPictureUploadLink` → upload → `marusia.savePicture` | 📄 ✅                                                                 |
| `response.buttons` / `end_session`    | Как в Алисе                                                                    | 1:1                                                                                                                                         | 📄 ✅                                                                 |
| `user_state_update` / `session_state` | Лимит состояния                                                                | Проверка ≤3584 байт (MARUSIA_STATE_MAX_BYTES)                                                                                               | ⚠️ консервативно (страница доков недоступна для точной сверки лимита) |
| Health-check                          | ping → pong                                                                    | `sendInInit` с pong                                                                                                                         | 📄 ✅                                                                 |

Исходящие API-запросы Маруси: `marusia.getPictureUploadLink`, `marusia.savePicture{photo, server, hash}`,
`marusia.getAudioUploadLink`, `marusia.createAudio{audio_meta}`, `marusia.deletePicture/{Audio}{id}` —
через общий транспорт VK (`api.vk.ru/method/`, `access_token`, `v`), 1:1 с
[dev.vk.com/ru/marusia/api](https://dev.vk.com/ru/marusia/api). 📄 ✅

## 7. SmartApp — ответ на webhook

Источник: протокол SmartApp (salute.sber.ru, SmartApp API) 📄 — портал в день сверки
недоступен для автоматической сверки (редирект на developers.sber.ru); факты по
зафиксированной документации.

| Поле ответа                                   | Официальный контракт                                             | Что отдаёт фреймворк                                                                                              | Статус |
| --------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------ |
| `messageName`                                 | `ANSWER_TO_USER` (ответ), `CALL_RATING` (оценка)                 | 1:1 (`getContent` / `getRatingContext`)                                                                           | 📄 ✅  |
| `sessionId`, `messageId`, `uuid`              | Эхо из запроса                                                   | Эхо из `platformOptions.session`                                                                                  | 📄 ✅  |
| `payload.pronounceText` / `pronounceTextType` | `application/text` или `application/ssml`                        | `application/ssml` только при наличии реальных SSML-тегов (регулярка `<\/?[a-z][^>]*>`), иначе `application/text` | 📄 ✅  |
| `payload.items[].bubble.text`                 | ≤250                                                             | `Text.resize(text, 250)`                                                                                          | 📄 ✅  |
| `payload.items[].command`                     | `close_app` при завершении                                       | Добавляется при `controller.isEnd`                                                                                | 📄 ✅  |
| `payload.suggestions.buttons`                 | Список кнопок с `actions` (server_action/text/deep_link)         | ≤8 кнопок; payload → `server_action{action_id, parameters}`, url → `deep_link`                                    | 📄 ✅  |
| Карточка                                      | `list_card` (cells: image_cell_view/text_cell_view)              | 1:1 (`SmartApp/Card.ts`), только URL-изображения                                                                  | 📄 ✅  |
| Хранилище данных                              | `GET/POST {storage_url}/{userId}` (SmartApp Code tools/api/data) | URL строится с `encodeURIComponent(userId)` — защита от path traversal (недоверенный `uuid.userId`)               | 📄 ✅  |
| Ответ на webhook                              | HTTP 200                                                         | HTTP 200, JSON-ответ                                                                                              | 📄 ✅  |

## 8. Ответы платформ на исходящие запросы: что возвращается ↔ что читает фреймворк

Отдельная сверка на случай расхождений имён (`imageId` vs `image_id`): для каждого
исходящего запроса — формат ответа по документации и **фактический путь чтения** в коде.

### Telegram

Конверт ответа: `{ok: boolean, result?: T, error_code?: number, description?: string}`
(док. Bot API). Фреймворк: `TelegramRequest.call()` проверяет `data.data.ok`, возвращает
`data.data.result` — имена 1:1. 📄 ✅

| Запрос                                | Ответ платформы                                                      | Что читает фреймворк                                                                                     | Статус |
| ------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| `sendPhoto` (для кэширования file_id) | `result.photo[]` — массив размеров, у каждого `file_id` (snake_case) | `photo?.ok && photo.result?.photo?.length` → `result.photo[length-1].file_id` → `ImageTokens.imageToken` | 📄 ✅  |
| `sendAudio` (кэширование)             | `result.audio.file_id`                                               | `sound.result?.audio?.file_id` → `SoundTokens.soundToken`                                                | 📄 ✅  |
| Остальные методы                      | `result` (message/poll/...)                                          | Кэширование не требуется — result возвращается вызывающему коду                                          | 📄 ✅  |

### VK

Конверт ответа: `{response: T}` либо `{error: {error_code, error_msg, ...}}`
(док. VK API). Фреймворк: `VkRequest.call()` возвращает `data.data.response` (или целиком
`data.data`, если `response` пуст), ошибка `error` → `null`. ✅

| Запрос                                | Ответ платформы                                | Что читает фреймворк                                                         | Статус |
| ------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| `photos.getMessagesUploadServer`      | `{response: {upload_url, ...}}`                | `server?.upload_url` → URL загрузки                                          | 📄 ✅  |
| Upload фото (multipart на upload_url) | `{photo: "...", server: N, hash: "..."}`       | `upload?.photo`, `upload.server`, `upload.hash` → `photos.saveMessagesPhoto` | 📄 ✅  |
| `photos.saveMessagesPhoto`            | `response: [{id, owner_id, ...}]` — **массив** | `photo?.[0]?.id`, `photo[0].owner_id` → токен `photo{owner_id}_{id}`         | 📄 ✅  |
| `docs.getMessagesUploadServer`        | `{response: {upload_url}}`                     | `server?.upload_url`                                                         | 📄 ✅  |
| Upload документа                      | `{file: "..."}`                                | `uploadResponse.file` → `docs.save`                                          | 📄 ✅  |
| `docs.save`                           | `response: {id, owner_id, title, ...}`         | `doc.owner_id`, `doc.id` → токен `doc{owner_id}_{id}`                        | 📄 ✅  |
| `users.get`                           | `response: [{id, first_name, last_name, ...}]` | `users[0]` → `first_name`/`last_name` → кэш имён VK                          | ✅     |
| `messages.send`                       | `response: <message_id: number>`               | Возвращается вызывающему (сообщения fire-and-forget)                         | 📄 ✅  |
| `messages.sendMessageEventAnswer`     | `response: true`                               | Возвращается вызывающему                                                     | 📄 ✅  |

### Viber

Конверт ответа: `{status: 0, status_message: "ok", ..., failed_list?: []}` (док. REST Bot
API ✅). Фреймворк: `ViberRequest.call()` — успех `data.status === 0`, `failed_list`
логируется, `status_message !== 'ok'` → ошибка. Имена 1:1.

| Запрос                                              | Ответ платформы                                                                             | Что читает фреймворк                                   | Статус |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------ |
| `send_message` / `set_webhook` / `get_user_details` | `{status, status_message, chat_hostname?, message_token?}`                                  | `status === 0` → успех; иначе лог                      | ✅     |
| `get_user_details`                                  | `+ {id, name, avatar, country, language, primary_device_os, api_version, viber_version...}` | `IViberGetUserDetails` (snake_case 1:1), публичный API | ✅     |

### MAX

Конверт ответа: JSON без общего конверта; ошибки — HTTP-кодом/телом (док. Bot API ✅).
Фреймворк: `MaxRequest.call()` возвращает `data.data` как есть.

| Запрос             | Ответ платформы                                             | Что читает фреймворк                                                                                                                                                 | Статус |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `POST /uploads` ✅ | `{url, token, ...}` — token для отправки вложения           | `uploadTarget?.url` (куда грузить файл), `uploadTarget.token` (вложение) → `IMaxUploadFile{url, token?}`; в карточке/звуке читается `upload?.token \|\| upload?.url` | ✅     |
| `POST /messages`   | `{message: {...}}`                                          | Возвращается вызывающему (fire-and-forget)                                                                                                                           | ✅     |
| `POST /answers`    | Тело без строгой схемы (`IMaxAppApi` — `{[name]: unknown}`) | Возвращается вызывающему                                                                                                                                             | ✅     |

### Алиса (исходящие: картинки, TTS)

Конверт: `{<resource>: {...}}` без общего error-поля; ошибка — HTTP-код + `{message...}`
(док. [resource-upload](https://yandex.ru/dev/dialogs/alice/doc/ru/resource-upload-docpage/) 📄).

| Запрос                                | Ответ платформы                                  | Что читает фреймворк                                         | Статус |
| ------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ | ------ |
| `GET /status`                         | `{images: {total, used}, sounds: {...}}` — квоты | `query?.images?.quota` → `IYandexCheckOutPlace{total, used}` | 📄 ✅  |
| `POST skills/{id}/images`             | `{image: {id, ...}}`                             | `query?.image?.id` → `ImageTokens.imageToken`                | 📄 ✅  |
| `DELETE skills/{id}/images/{imageId}` | `{result: "ok"}`                                 | `query?.result`                                              | 📄 ✅  |
| `POST skills/{id}/sounds`             | `{sound: {id, ...}}`                             | `query?.sound?.id` → `SoundTokens.soundToken`                | 📄 ✅  |
| SpeechKit `tts:synthesize`            | Бинарное аудио (oggopus)                         | `ArrayBuffer` → временный файл → загрузка в навык → unlink   | 📄 ✅  |

⚠️ **Косметика (не влияет на работу):** `IYandexRequestDownloadImage` объявляет
`origUrl`/`size`/`createdAt` в camelCase — фактический регистр полей в ответе Яндекса
(кроме `id`) в коде не используется и не проверялся. Если эти поля понадобятся — сверить
регистр по документации; критичный для работы `image.id` совпадает точно.

### Маруся (исходящие: картинки, аудио)

Конверт — как у VK (`{response: ...}`). Фреймворк: через `VkRequest.call()`.

| Запрос                         | Ответ платформы                                  | Что читает фреймворк                                                             | Статус |
| ------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------- | ------ |
| `marusia.getPictureUploadLink` | `{response: {picture_upload_link}}` (snake_case) | `uploadLink.picture_upload_link`                                                 | 📄 ✅  |
| Upload картинки                | `{photo, server, hash}`                          | 1:1 → `marusia.savePicture`                                                      | 📄 ✅  |
| `marusia.savePicture`          | `{response: {app_id, photo_id}}`                 | `picture?.photo_id` → `ImageTokens.imageToken`                                   | 📄 ✅  |
| `marusia.getAudioUploadLink`   | `{response: {audio_upload_link}}`                | `audio_upload_link` (интерфейс; flow озвучки использует встроенные звуки Маруси) | 📄 ✅  |
| `marusia.createAudio`          | `{response: {id, ...}}`                          | `id` (интерфейс)                                                                 | 📄 ✅  |

### Итог по ответам платформ

1. **Все критичные для работы поля ответов совпадают с документацией** по именам и
   вложенности: `file_id` (Telegram), `id`/`owner_id` (VK photos/docs), `status: 0`
   (Viber), `url`/`token` (MAX uploads), `image.id`/`sound.id` (Яндекс),
   `picture_upload_link`/`photo_id` (Маруся). Ни одного случая «ждём camelCase, а
   приходит snake_case» в используемых путях.
2. ⚠️ Косметика (типы точнее рантайма не проверяются): поля `IVkUploadFile`
   (`file`/`photo`/`server`/`hash`) объявлены опциональными — это соответствует
   непересекающимся подмножествам реальных ответов (photos: `{photo, server, hash}`;
   docs: `{file}`), рантайм-проверки корректны; `IYandexRequestDownloadImage.origUrl/createdAt` —
   camelCase, поля не читаются.

## Итог сверки

1. **Нарушений контракта не найдено.** Все обязательные параметры, типы и вложенность
   совпадают с официальной документацией; лимиты либо 1:1, либо консервативнее
   документированных.
2. **⚠️ Расхождения-нюансы (не нарушения):**
    - Алиса: не возвращается эхо `session` (пример документации содержит; обязательность
      не подтверждена — страница 404 в день сверки; платформа принимает). Пункт для
      точечной проверки.
    - VK `messages.send`: лимит `message` в документации — 9000, фреймворк режет до 4096
      (исторический лимит сообщений бота) — безопасно.
    - VK `event_data` ≤1000 и MAX secret `[A-Za-z0-9_-]{5,256}`: фреймворк валидирует
      строже, чем описано на overview-страницах — консервативно.
    - Маруся: лимит состояния 3584 байт зашит константой (точный документированный лимит
      сверить не удалось — доки VK на техобслуживании).
3. **Ответы платформ на наши запросы сверены по путям чтения (раздел 8):** все
   критичные поля — `file_id` (Telegram), `id`/`owner_id` (VK), `status: 0` (Viber),
   `url`/`token` (MAX), `image.id`/`sound.id` (Яндекс), `picture_upload_link`/`photo_id`
   (Маруся) — совпадают по именам и вложенности. Ни одного случая «ждём camelCase,
   приходит snake_case» в используемых путях; две косметические неточности в типах
   (не влияют на работу) отмечены в разделе 8.
4. **Сверено живьём 2026-08-29:** VK (`messages.send`, `users.get`,
   `sendMessageEventAnswer`), Viber (весь REST Bot API), MAX (весь Bot API overview).
5. **Сверено по зафиксированной документации** (страницы временно недоступны):
   Telegram Bot API, протокол Алисы, Маруся, SmartApp — повторить сверку по ссылкам
   из этого документа, когда страницы станут доступны.
