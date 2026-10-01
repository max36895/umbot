# Развертывание в продакшене

После того как голосовой навык или чат-бот написан и протестирован локально, его нужно развернуть на сервере, чтобы
платформы могли отправлять ему запросы. В этом руководстве мы рассмотрим полный цикл деплоя: от получения
SSL-сертификата до настройки CI/CD.

## Требования

- Сервер с публичным IP-адресом
- Доменное имя
- SSL-сертификат (обязателен для Алисы, Сбер SmartApp, Telegram, MAX, Viber и других платформ)

## Получение SSL-сертификата через acme.sh

### 1. Установите `acme.sh`:

```bash
curl https://get.acme.sh | sh
```

### 2. Выпустите сертификат:

```bash
acme.sh --issue -d example.com -w /var/www/example
```

Где:

- example.com — ваш домен
- /var/www/example — корневая директория сайта (должна быть доступна по HTTP для прохождения проверки)

### 3. Установите сертификат в нужные пути:

```bash
acme.sh --install-cert -d example.com \
  --key-file /etc/ssl/private/example.key \
  --fullchain-file /etc/ssl/certs/example.crt \
  --reloadcmd "sudo systemctl reload nginx"
```

## Настройка nginx

Добавьте в конфигурацию nginx:

```text
server {
    listen 443 ssl;
    server_name example.com;

    ssl_certificate /etc/ssl/certs/example.crt;
    ssl_certificate_key /etc/ssl/private/example.key;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Перезагрузите nginx:

```bash
sudo systemctl reload nginx
```

## Запуск приложения

Соберите проект:

```bash
npm run build
```

Запустите с помощью pm2 (рекомендуется для продакшена). Если pm2 не установлен, установите его:

```bash
npm install -g pm2
```

Запустите сам процесс:

```bash
pm2 start dist/index.js --name "umbot-production"
```

Для того чтобы после перезагрузки сервера приложение было доступно, выполните следующие команды:

```bash
pm2 startup
pm2 save
```

Теперь ваш навык доступен по HTTPS и готов к подключению в консолях разработчика:

- Яндекс.Диалоги
- Сбер SmartApp (developers.sber.ru)
- Маруся для разработчиков
- Telegram BotFather, VK Callback API, Viber Bot Settings и др.

## Варианты запуска

### 1. Встроенный сервер (рекомендуется для простых случаев)

```ts
const server = bot.start('0.0.0.0', 3000);
```

- GET `/health` → `{ status: 'ok', timestamp }` (200)
- POST `/` → `webhookHandle` (обработка запроса платформы)
- Максимальный размер тела: **2 МБ** — при валидном `Content-Length` сверх лимита возвращается 413;
  при стриминговой передаче сверх лимита лишнее отбрасывается и запрос завершается ошибкой 500
- SIGTERM/SIGINT → корректное завершение (`close()` + очистка + `process.exit(0)`)

### 2. Интеграция в существующее приложение (Express/Fastify)

Смотри раздел: [Универсальный webhook-обработчик](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/platform-integration#🌐-универсальный-webhook-обработчик) в руководстве по платформам.

## Корректное завершение

```ts
process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await bot.close(); // останавливает сервер, сохраняет данные, закрывает БД
    process.exit(0);
});
```

`bot.start()` уже навешивает эти хуки автоматически — обычно вручную делать не нужно.

## Сборка Docker-образа

При создании проекта через CLI с флагом `--prod` генерируется готовый `Dockerfile`.  
Соберите образ и запустите контейнер, передав токены через переменные окружения:

```bash
docker build -t my-bot .
docker run -p 3000:3000 --env-file .env my-bot
# или точечно:
docker run -p 3000:3000 -e ALISA_TOKEN=... -e TELEGRAM_TOKEN=... my-bot
```

Образ собирается в два этапа (сборка TypeScript с dev-зависимостями, затем runtime только с production-зависимостями),
задаёт `NODE_ENV=production` — без явного `setAppMode()` бот работает в `strict_prod` — и не содержит `.env`:
токены передаются при запуске.

Процесс в контейнере работает от непривилегированного пользователя `umbot`; каталоги `/app/json` (данные
`FileAdapter`) и `/app/logs` (файловые логи) создаются в образе заранее и доступны ему на запись. Данные контейнера
теряются при его пересоздании: для `FileAdapter` подключите том (`docker run -v umbot-data:/app/json ...`), а для
продакшена используйте `MongoAdapter`. Ошибки без своего логгера дублируются в stderr (`[umbot] ...`) и видны в
`docker logs`.

Если `env` в конфиге не настроен, фреймворк тихо подтянет известные переменные (`TELEGRAM_TOKEN`,
`ALISA_TOKEN`, `VK_TOKEN`, ...) из окружения контейнера и дозаполнит ими токены — явно писать
`env: 'local'` для этого не нужно. Если же `env: 'local'` указан, значения из окружения
перезаписывают заданные токены.

## CI/CD

Шаблон .github/workflows/deploy.yml автоматически настраивает:

- Сборку проекта,
- Сборку Docker-образа,
- Деплой на сервер через SSH.

> 🔐 Безопасность: никогда не коммитьте .env в Git. Используйте GitHub Secrets.

## Serverless

Для платформ без постоянного сервера (Алиса, SmartApp, Маруся) можно использовать serverless-функции.

### Яндекс Cloud Functions

При создании проекта через CLI можно автоматически сгенерировать конфигурацию для Yandex Cloud Functions:

```bash
npx umbot create from-flow flow.json --usecloud
```

Это добавит в проект:

- Экспорт `handler` в `src/index.ts` для обработки запросов Cloud Functions
- `scripts/deploy.js` — деплой через yc CLI (запускается `npm run deploy`)
- Справочный `serverless.yml` с конфигурацией функции (деплой его не читает — аргументы для yc собирает `scripts/deploy.js`)

`scripts/deploy.js` читает `.env` по тем же правилам, что и фреймворк (инлайн-комментарий — только « #», внешние
кавычки снимаются, пустые значения пропускаются) и передаёт значения в `--environment`. Такие переменные хранятся
в версии функции открытым текстом и видны всем, у кого есть доступ к функции в консоли облака. Для продакшена храните
токены в Yandex Lockbox и подключите секрет к функции (`yc serverless function version create ... --secret ...`),
убрав их из `.env`.

- Скрипты `deploy` и `build` в `package.json`

Ручная настройка Cloud Function:

```ts
import { Bot } from 'umbot';
import { fullPlatforms } from 'umbot/plugins';

const bot = new Bot();
bot.use(fullPlatforms);
bot.setAppConfig({ isLocalStorage: true });

// Экспорт функции для Яндекс Cloud Functions
export const handler = async (event: Record<string, unknown>) => {
    const rawBody = typeof event.body === 'string' ? event.body : '';
    // Тело с не-JSON Content-Type приходит в base64 (isBase64Encoded: true)
    const content =
        typeof event.body !== 'string'
            ? JSON.stringify(event.body ?? '')
            : event.isBase64Encoded === true
              ? Buffer.from(rawBody, 'base64').toString('utf8')
              : rawBody;
    const headers = (event.headers ?? {}) as Record<string, unknown>;
    // IP клиента — для middleware ipFilter
    const requestContext = event.requestContext as { identity?: { sourceIp?: string } } | undefined;
    const result = await bot.webhookEvent(content, headers, requestContext?.identity?.sourceIp);
    return {
        statusCode: result.statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? ''),
    };
};
```

`webhookEvent()` — специальный метод для serverless-окружений: в отличие от `run()`, он сам
определяет платформу по содержимому, проверяет подпись webhook (`isCorrectQuery`) и возвращает
готовый HTTP-ответ `{ statusCode, body }`. Именно этот код использует генератор `from-flow --usecloud`.
Регистр имён заголовков не важен: Cloud Functions передаёт их как прислал клиент
(`X-Telegram-Bot-Api-Secret-Token`), а `webhookEvent()` приводит их к нижнему регистру перед проверкой подписи.

> В serverless `isLocalStorage: true` надёжно хранит данные только на Алисе, SmartApp и Марусе (состояние приходит в
> запросе). На Telegram/VK/MAX/Viber без DB-адаптера `userData` живёт в памяти экземпляра функции и теряется, когда
> вызов попадает в новый экземпляр, — для шагов диалога на чат-платформах подключите БД (например, `MongoAdapter`).

Готовые рецепты — в разделе [Рецепты](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/recipes).

## Высокая нагрузка: несколько процессов и горизонтальное масштабирование

Один экземпляр `Bot` — это один Node.js процесс. Обработка вебхука не зависит от процесса, если данные живут вне
его: `userData` читается из БД, а `state` голосовых платформ (Алиса, SmartApp, Маруся) приходит в теле самого
запроса. Поэтому бот с БД масштабируется горизонтально без дополнительных механизмов (сессий, sticky-балансировки).

В памяти процесса живут только сессия `memorySession` (Telegram, VK, MAX, Viber без БД) и очередь запросов одного
пользователя: при нескольких инстансах подключите БД, а порядок запросов одного пользователя гарантируется только
внутри одного инстанса.

### Когда одного процесса достаточно

Накладные расходы фреймворка на один запрос невелики (цифры — в
[Производительности и гарантиях](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/performance-and-guarantees)). Узкое место на практике почти никогда
не сам фреймворк, а внешние вызовы (БД, API платформ). Если бот работает на
одном сервере и нагрузка умеренная — одного процесса достаточно, и это самая
простая конфигурация.

### Несколько инстансов за балансировщиком

Когда нужны отказоустойчивость и распределение нагрузки, запустите N одинаковых
инстансов (Docker-реплики, PM2 cluster, несколько серверов за nginx):

```bash
# PM2 cluster: по процессу на ядро
pm2 start dist/index.js -i max

# или Docker Compose
# deploy:
#   replicas: 4
```

Единственное жёсткое требование — **общая база данных**:

| Конфигурация                      | Несколько процессов |
| --------------------------------- | ------------------- |
| `MongoAdapter` (или свой адаптер) | ✅ Да               |
| `FileAdapter`                     | ❌ Нет              |

`FileAdapter` читает и пишет JSON-файлы без блокировок и рассчитан строго на один
процесс — это задокументированное ограничение, а не баг. При нескольких процессах
каждый инстанс будет видеть свою копию данных, и записи начнут теряться. Поэтому
в multi-process и multi-server конфигурациях используйте `MongoAdapter` или свой
адаптер (PostgreSQL, Redis — см. [адаптеры БД](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/adapter/dbAdapter)).

Кэши токенов медиа (`ImageTokens`, `SoundTokens`) хранятся в той же БД, поэтому
все инстансы используют общие токены и не пере-загружают картинки и звуки
повторно.

### Изоляция платформ по разным процессам

Если отказ одной платформы не должен ронять остальные (например, внутренний
чат-бот и навык Алисы — разные SLA), разверните отдельный процесс на платформу:
свой экземпляр `Bot` со своим набором адаптеров и своим webhook-URL. Бизнес-логику
(команды, шаги, middleware) вынесите в общий модуль и подключайте в оба процесса —
это обычный код, не привязанный к экземпляру `Bot`.

```ts
// process-telegram.ts
const bot = new Bot().use(new TelegramAdapter(process.env.TELEGRAM_TOKEN!));
applySharedLogic(bot); // общие команды и шаги из вашего модуля
bot.start('0.0.0.0', 3001);

// process-alisa.ts
const bot = new Bot().use(new AlisaAdapter());
applySharedLogic(bot);
bot.start('0.0.0.0', 3002);
```

Плюс: падение или рестарт одного процесса не затрагивает остальные, лимиты и
нагрузку каждой платформы видно отдельно. Минус: больше процессов — больше
инфраструктуры (порты, health-check'и, деплой).

### Логи в serverless

В serverless-окружениях файловая система доступна только на чтение, поэтому
файловые логи (`error_log`) писать туда нельзя — и не нужно. Настройте один из
вариантов:

- внешний логгер: `bot.setLogger({ log, warn, error })` с отправкой
  в вашу систему логирования (или собирайте вывод в stdout — облако собирает его
  само);
- либо оставьте поведение по умолчанию: если записать лог не удаётся, фреймворк
  не зацикливается, а пишет одно сообщение в stderr и приостанавливает попытки
  записи на минуту.

Для serverless также характерны холодные старты и короткий TTL процесса —
`FileAdapter` там неприменим по той же причине: данные должны жить во внешней БД.

## Чеклист деплоя

Перед запуском в продакшене убедитесь:

- [ ] **Сборка завершена успешно** — `npm run build` без ошибок
- [ ] **Тесты пройдены** — `npm run test` зелёный
- [ ] **Режим `strict_prod`** — `bot.setAppMode('strict_prod')` или `NODE_ENV=production` (без явного `setAppMode`)
- [ ] **Проверка подписи вебхука включена** — задан `TELEGRAM_WEBHOOK_SECRET` / `MAX_WEBHOOK_SECRET` / `VK_SECRET_KEY`;
      при старте в логе нет предупреждения о вебхуке без проверки подписи (у Алисы, SmartApp и Маруси подписи нет —
      не считайте их `userId` аутентифицированной идентичностью). Подробнее — [Конфигурация → Проверка подписи
      вебхука](https://www.maxim-m.ru/docs/umbot/v-3.1/guides/configuration#проверка-подписи-вебхука-обязательно-для-production)
- [ ] **`npx umbot doctor` без ошибок** — токены рабочие, вебхуки зарегистрированы
- [ ] **Токены в переменных окружения** — не в коде, не в .env в контейнере
- [ ] **MongoAdapter** — вместо FileAdapter (FileAdapter хранит данные в памяти)
- [ ] **HTTPS настроен** — обязателен для Алисы, Сбера, Viber
- [ ] **Webhook URL зарегистрирован** — в консоли разработчика каждой платформы
- [ ] **error_log настроен** — `bot.setAppConfig({ error_log: './logs' })`
- [ ] **Preload выполнен** — все медиафайлы предзагружены
- [ ] **rateLimiter подключен** — `bot.use(rateLimiter())`
- [ ] **re2 установлен** — `npm install re2`: регулярные выражения без катастрофического бэктрекинга
- [ ] **PM2 или Docker** — для автоматического перезапуска при падении
- [ ] **Мониторинг** — логи доступны, метрики настроены
