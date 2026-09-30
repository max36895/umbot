# Проверенные контракты платформ umbot

Справочник для работы с адаптерами (`src/plugins/platforms/`), API-клиентами
(`src/plugins/platforms/API/`), `Request.ts` и приёмом вебхуков. Вынесен из `AGENTS.md`, чтобы
не грузиться в каждую сессию: **прочитай его перед любой правкой этих мест**. Матрица платформ
(лимит текста, кнопки, карточки, подпись вебхука) и общие правила пути запроса остались в
`AGENTS.md`, раздел 9.

Факты ниже сверены с официальной документацией и проверены в работе. Меняешь контракт — сначала
перепроверь по источнику платформы и обнови этот файл тем же изменением.

## Сверено с официальной документацией (2026-08)

- **Alisa cards** — the docs do NOT mark `image_id` as required in `ItemsList` or
  `ImageGallery` items (there is no "Обязательный" column at all), and a text-only item
  is a working, field-tested scenario. Do not silently drop items without an image.
  `ItemsList` holds 1–5 items, `ImageGallery` 1–10 (the card spec page says 1–10; the
  response-format overview page still says 1–7 — the spec page is treated as authoritative). Limits: `header.text`/`footer.text` 64,
  `items[].title` 128, `items[].description` 256, `BigImage.description` 1024,
  `button.text` 64, `button.url` 1024 bytes, `button.payload` 4096 bytes.
  `response.text` MAY be empty — but only when `tts` is filled.
  ⚠️ When reading these docs through a summarising tool, verify field-by-field: the
  summariser has reported "Required" for fields the page never marks as required.
- **Viber rich_media** — a button's `Columns`/`Rows` are its span inside the
  `ButtonsGroupColumns` (1–6, default 6) × `ButtonsGroupRows` (1–7, default 7) grid,
  NOT the number of cards. The `webhook` event sent during `set_webhook` must be
  answered with HTTP 200 or the webhook cannot be registered. Text limit 7000.
- **MAX** — auth is `Authorization: <token>` for outgoing API requests (query-param tokens are no longer supported); the incoming webhook is verified by the `x-max-bot-api-secret` header (`secret` adapter option, `signatureName` in `Max/Adapter.ts`). Do not confuse the two mechanisms.
  `Content-Type` is required for requests with a body. Up to 12 attachments per message,
  keyboard up to 30 rows / 7 buttons per row (3 for link/open_app/geo/contact).
  Max 2 callback-ответа в секунду на диалог; отправка в один диалог — не чаще 1 сообщения
  в 500 мс (реализовано очередью в `MaxRequest` с таймерами `.unref()`).
- **VK** — `users.get` документирует только `user_ids` (список через запятую);
  legacy-алиас `user_id` не использовать. У vkpay-кнопки `hash` находится внутри
  `action`, а не на верхнем уровне объекта кнопки; `hash: null` отклоняет всю
  клавиатуру (ошибка 100). `keyboard` и `template` взаимоисключающи;
  `random_id` — int32. Тело запроса к API — `x-www-form-urlencoded`.
- **Telegram** — `inline_keyboard` — массив массивов; `callback_data` 1–64 байта;
  `url` и `callback_data` взаимоисключающи в одной кнопке. `sendMediaGroup` принимает
  2–10 элементов (одиночное фото — через `sendPhoto`). Upload-операции
  (sendPhoto/sendAudio/sendMediaGroup) требуют таймаут ~30 с, обычные методы — ~5 с.
- **Marusia** — custom skills were shut down by VK on 2024-12-20 and the protocol docs were removed
  from dev.vk.com; the format was checked against the archived copy. Response requires `session`
  (echo) and a NON-empty `text` (unlike Alisa). Cards: `BigImage {type, image_id:int}`,
  `ItemsList {type, items:[{image_id:int}]}`, `MiniApp`, `Link` — no ImageGallery, no titles/buttons.
  Buttons: only `title`/`url`/`payload` (payload is a JSON object).
- **Alisa ButtonPressed** — the request has NO `command`/`original_utterance`, only `payload` and
  `nlu.tokens`; button `payload` in the response must be a JSON object (strings are wrapped into
  `{command}`). Health-check `ping` must be answered with a full valid response (`end_session` required).
- **SmartApp** — `server_action` is `{action_id, parameters}` (`{type, payload}` is deprecated);
  `payload.items` is required in ANSWER_TO_USER; `pronounceText` has no documented length limit.
- **Telegram voice** — synthesized OGG/Opus goes via `sendVoice`; `sendAudio` accepts only MP3/M4A.
- **MAX bot_started** — carries `payload` (deep-link) and must be answered (welcome), not skipped.
- **MAX buttons** — per the official SDK (`@maxhub/max-bot-api`): `quick` exists only on
  `request_geo_location`, `contact_id`/`web_app` only on `open_app`, `payload` on
  `callback`/`clipboard`/`open_app` (never on `link`). `intent` is absent from current docs and
  SDK (TamTam legacy) and is sent only for `callback`.
- **VK uploads** — photos (`photos.getMessagesUploadServer`) must be uploaded in the multipart
  field `photo`, documents/voice in `file`. `docs.save` returns `{type, doc | audio_message}` —
  ids live in the nested object. Carousel elements must share one structure (same button count)
  and the message text is mandatory with a carousel.
- **MAX uploads** — the upload-server response for `audio`/`video` is `retval` (not JSON); their
  token comes from the `POST /uploads` step. Never cache the one-time upload `url` as a token.
  A message sent right after an upload may be rejected with `attachment.not.ready` — `MaxRequest`
  retries it (0.5/1/2 s). `POST /answers` with `message` REPLACES the message with the pressed
  button; the adapter acknowledges with `{}` and replies via `POST /messages` unless
  `max_callback_edit_message: true`.
- **SpeechKit TTS** — body `application/x-www-form-urlencoded`, auth `Api-Key <key>` or
  `Bearer <IAM>`; the `OAuth` scheme belongs to the Dialogs API only.
- **Telegram button `style`** — only `danger`, `success`, `primary`.
- **Viber welcome** — the reply to `conversation_started` goes in the webhook response body;
  REST `send_message` to a not-yet-subscribed user is rejected.
- **Viber** — тело исходящего запроса к API ограничено 30 КБ (проверяется в
  `ViberRequest.call()`); `rich_media` требует `min_api_version >= 7`.
- **Long polling** (`getUpdates` адаптеров, `bot.startPolling()`):
  Telegram `getUpdates` — `timeout` 25 с, `offset` = последний `update_id` + 1; 409 — активен вебхук или другой
  процесс читает обновления, 401/404 — неверный токен (polling останавливается). Вебхук снимается только явной
  опцией `telegram_delete_webhook` — токен может принадлежать production-боту. MAX `GET /updates` — `timeout`
  0–90 с (берём 30), `limit` 1–1000, `marker` из ответа передаётся в следующий запрос, `Authorization: <token>`;
  MAX называет polling средством разработки, для продакшена — вебхук. VK Bots Long Poll — `groups.getById`
  (ответ с 5.139 — `{groups: [...]}`, раньше — массив) → `groups.getLongPollServer(group_id)` → `{server, key, ts}`
  → `GET {server}?act=a_check&key&ts&wait=25`; события в формате Callback API без `secret`. `failed: 1` — взять
  новый `ts`, `2` — новый ключ с прежним `ts`, `3` — новые ключ и `ts`. Long Poll включается в настройках
  сообщества. Запрос long polling держим дольше ожидания платформы на `POLLING_REQUEST_MARGIN` (10 с).
- **Request (общее)** — `_getOptions()` возвращает `undefined` при ошибке attach-файла:
  перед `fetch` обязательно проверять результат, иначе уходит паразитный GET-запрос.
  `Request.send()` сбрасывает `attach/post/get/customRequest` после каждого вызова —
  инстанс переиспользуется.

## Нюансы адаптеров, которые бьют в проде (не нарушения контракта)

Общие правила пути запроса — HTTP 200 на любое неизвестное событие и `user_id` без подписи как
данные атакующего — в `AGENTS.md`, раздел 9. Здесь — то, что касается только адаптеров.

- `Card.getCards(cardProcessing, controller)` возвращает результат `cardProcessing` как есть. У Telegram, VK, Алисы, Маруси и MAX процессоры асинхронные — их вызов обязан быть с `await`; у Viber и SmartApp — синхронные, и лишний `await` там не нужен. При добавлении платформы сначала определи, async ли твой `cardProcessing`, и не копируй вызов из чужого адаптера.
- `getDeliveryId(query)` (дедупликация повторов вебхука) обязан возвращать `null` для событий, ответ на которые несёт содержимое (VK `confirmation`, Viber `webhook`/`conversation_started`, Telegram в режиме `telegram_webhook_reply`): повтор подтверждается пустым `ok`. У MAX нет ID обновления — ключ собирается из `update_type`, `timestamp` и объекта (`mid` одного сообщения приходит и в `message_created`, и в `message_edited`). При включённой подписи вебхука ядро использует ID как ключ без хэша тела — ID обязан однозначно определять доставку.
- Доступ к `button.options` в адаптерах — только через `?.` (или `?? {}`): компонент `Buttons` всегда задаёт `options`, но кнопка может прийти объектом, собранным вручную вне компонента (JS-потребители, тесты). Образец — Telegram/VK/Max/Viber.
- `setQueryData`/`getContent` не объявляются `async`, если внутри нечего ждать: возвращай значение, а промис — только при сетевом вызове (VK: имя из кэша — синхронно, запрос `users.get` — промисом; `getContent` без автоответа — `'ok'` сразу). Каждый лишний async-метод — аллокации на каждом запросе.
- Подпись в теле запроса (как `secret` у VK) проверяй по третьему аргументу `isCorrectQuery(query, headers, parsedQuery)` — тело уже разобрано ядром; повторный `JSON.parse` на каждом запросе не нужен.
