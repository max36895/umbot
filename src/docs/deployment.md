# Развертывание в продакшене

После того как голосовой навык или чат-бот написан и протестирован локально, его нужно развернуть на сервере, чтобы
платформы могли отправлять ему запросы. В этом руководстве мы рассмотрим полный цикл деплоя: от получения
SSL-сертификата до настройки CI/CD.

## Требования

- Сервер с публичным IP-адресом
- Доменное имя
- SSL-сертификат (обязателен для Алисы, Маруси, Сбер SmartApp, Viber и других платформ)

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
bot.start('0.0.0.0', 3000);
```

### 2. Интеграция в существующее приложение (Express/Fastify)

Смотри раздел: [Универсальный webhook-обработчик](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_platform-integration.html#🌐-универсальный-webhook-обработчик) в руководстве по платформам.

## Сборка Docker-образа

При создании проекта через CLI с флагом `--prod` генерируется готовый `Dockerfile`.  
Соберите образ и запустите контейнер, передав токены через переменные окружения:

```bash
docker build -t my-bot .
docker run -p 3000:3000 -e ALISA_TOKEN=... -e TELEGRAM_TOKEN=... my-bot
```

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

Для платформ без постоянного сервера (Алиса, Маруся, SmartApp) можно использовать serverless-функции.

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

> В serverless `isLocalStorage: true` надёжно хранит данные только на Алисе, Марусе и SmartApp (состояние приходит в
> запросе). На Telegram/VK/MAX/Viber без DB-адаптера `userData` живёт в памяти экземпляра функции и теряется, когда
> вызов попадает в новый экземпляр, — для шагов диалога на чат-платформах подключите БД (например, `MongoAdapter`).

Подробнее о serverless — в разделе [Рецепты: Serverless](https://www.maxim-m.ru/docs/umbot/documents/umbot_v-3.1_.src_docs_GUIDE.html#рецепты-cookbook).

## Чеклист деплоя

Перед запуском в продакшене убедитесь:

- [ ] **Сборка завершена успешно** — `npm run build` без ошибок
- [ ] **Тесты пройдены** — `npm run test` зелёный
- [ ] **Режим `strict_prod`** — `bot.setAppMode('strict_prod')` или `NODE_ENV=production` (без явного `setAppMode`)
- [ ] **Токены в переменных окружения** — не в коде, не в .env в контейнере
- [ ] **MongoAdapter** — вместо FileAdapter (FileAdapter хранит данные в памяти)
- [ ] **HTTPS настроен** — обязателен для Алисы, Сбера, Viber
- [ ] **Webhook URL зарегистрирован** — в консоли разработчика каждой платформы
- [ ] **error_log настроен** — `bot.setAppConfig({ error_log: './logs' })`
- [ ] **Preload выполнен** — все медиафайлы предзагружены
- [ ] **rateLimiter подключен** — `bot.use(rateLimiter())`
- [ ] **PM2 или Docker** — для автоматического перезапуска при падении
- [ ] **Мониторинг** — логи доступны, метрики настроены
