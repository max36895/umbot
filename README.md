# umbot

**English** | [Русский](./README.ru.md)

A TypeScript framework for chatbots and voice skills. Write your conversation logic once and connect it to
Telegram, VK, MAX, Viber, Yandex Alice, or Sber Salute through adapters. You can also use it with a single platform
to keep conversation logic separate from its API.

[![npm version](https://badge.fury.io/js/umbot.svg)](https://www.npmjs.com/package/umbot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue)](https://www.typescriptlang.org/)

[English documentation](https://www.maxim-m.ru/docs/umbot/en/) ·
[Examples](https://github.com/max36895/umbot/tree/main/examples) ·
[Issues](https://github.com/max36895/umbot/issues)

## Quick start

Use **Node.js 22 or later** for the generated project. The framework itself supports Node.js 20.20.2 or later.

Generate a TypeScript project with the CLI:

```bash
npx umbot create echo
cd echo
npm install
```

For a local Telegram bot, put your bot token in the generated `.env` file as `TELEGRAM_TOKEN`.
Keep this file out of version control. Replace the generated `src/index.ts` with:

```ts
import { Bot } from 'umbot';
import { TelegramAdapter } from 'umbot/plugins';

const bot = new Bot()
    .setAppConfig({ env: './.env' })
    .use(new TelegramAdapter(process.env.TELEGRAM_TOKEN));

bot.addCommand('hello', ['/start', 'hello'], (_, ctx) => {
    ctx.text = 'Hello! Send me a message and I will repeat it.';
});

bot.addCommand('*', [], (_, ctx) => {
    ctx.text = `You said: ${ctx.userCommand}`;
});

bot.startPolling().catch(() => {
    console.error('Could not start polling. Check the bot configuration and logs.');
    process.exitCode = 1;
});
```

Build and run:

```bash
npm run build
npm start
```

Send `/start` to your bot in Telegram. Long polling lets you try it locally without HTTPS or a tunnel.
If the bot already has a webhook, remove it before switching to polling.

To add umbot to an existing project:

```bash
npm install umbot
```

See the [getting started guide](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/getting-started)
for controller-based applications and webhook setup.

## Why umbot?

The framework separates your conversation from platform request and response formats:

- **Shared conversation logic.** Reuse command handlers across connected platforms.
- **Common response components.** Work with text, buttons, cards, images, audio, and TTS through one interface.
- **State and storage.** Use session and user data, media token caching, and database adapters.
- **TypeScript tooling.** Typed APIs, a project generator, adapter scaffolding, and console testing with `BotTest`.
- **Extensible adapters and middleware.** Connect another platform or database without changing the core.
- **Regular expression validation.** Built-in protection against unsafe command patterns.

You can keep small bots in command callbacks or use a `BotController` class for larger conversations.
Adding an adapter connects another platform; platform-specific features can still require separate handling.

## Supported platforms

| Platform      | Adapter ID  | Shared features                                                                                             |
| :------------ | :---------- | :---------------------------------------------------------------------------------------------------------- |
| Telegram      | `telegram`  | Text, inline and reply keyboards, photos and media groups, voice, callbacks, inline queries, message events |
| VK            | `vk`        | Text, keyboards, carousels, voice, callback buttons                                                         |
| MAX           | `max_app`   | Text, inline keyboards, images, audio, callbacks, `bot_started` deep links                                  |
| Viber         | `viber`     | Text, keyboards, rich media; new bots require commercial terms                                              |
| Yandex Alice  | `alisa`     | Skill protocol: text, TTS, buttons, cards, sounds, state, authorization                                     |
| Sber Salute   | `smart_app` | SmartApp protocol: text, speech, buttons, cards, state                                                      |
| Marusia       | `marusia`   | Skill protocol for existing skills; registration of new skills is closed                                    |
| Your platform | Custom      | Implement a platform adapter                                                                                |

Telegram, VK, and MAX support both webhooks and long polling. The other built-in adapters use webhooks.
For webhook applications, use `bot.start()` instead of `bot.startPolling()`.
You can test conversation logic offline with `BotTest`.

**The shared API covers common conversation features.** Polls, payments, message editing, and other platform-specific
operations are available through `controller.api` and platform API clients such as `TelegramRequest`, `VkRequest`,
`MaxRequest`, and `ViberRequest` from `umbot/plugins`. Each client also provides a generic `call(method)` method.
Some voice-platform directives require extending the relevant adapter.

See [platform integration](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/platform-integration)
for supported events, configuration, and limitations.

## Ecosystem

Additional npm packages connect through `bot.use()`. Install database drivers and additional platform dependencies
only when you need them.

| Package                                                                  | Purpose                                                                        |
| :----------------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| [umbot-knex-adapter](https://github.com/max36895/umbot-knex-adapter)     | Relational databases through Knex.js: PostgreSQL, MySQL/MariaDB, SQLite, MSSQL |
| [umbot-ydb-adapter](https://github.com/max36895/umbot-ydb-adapter)       | Yandex Database storage for skills and bots, including Yandex Cloud Functions  |
| [umbot-wechat-adapter](https://github.com/max36895/umbot-wechat-adapter) | WeChat Official Account (Weixin)                                               |

```bash
npm install umbot umbot-knex-adapter knex pg
```

```ts
import { Bot } from 'umbot';
import { TelegramAdapter } from 'umbot/plugins';
import { KnexAdapter } from 'umbot-knex-adapter';

const bot = new Bot()
    .use(new TelegramAdapter(process.env.TELEGRAM_TOKEN))
    .use(new KnexAdapter({ host: 'localhost', database: 'bot_db', options: { client: 'pg' } }));
```

To build your own extension, see the
[platform adapter contract](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/adapter/platformAdapter)
and [database adapter contract](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/adapter/external-db-adapter-spec).

## Developer tools

The CLI generates projects and scaffolds extensions:

```bash
npx umbot add platform MyPlatform
npx umbot add db MyDatabase
npx umbot add middleware myMiddleware
```

Generated platform adapters compile and include a test; implementing the actual platform API is left to you.
The CLI also provides `doctor` for token and webhook diagnostics and `webhook` for Telegram and MAX setup.
See the [CLI reference](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/cli/README).

### Visual editor

[Umbot Flow](https://flow.maxim-m.ru) lets you design a conversation on a canvas, export `flow.json`, and generate
a TypeScript project:

```bash
npx umbot create from-flow flow.json --output ./my-bot
```

See the [flow format](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/json-format) for node types and generation rules.

## Performance

Benchmarks and their methodology are documented in
[BENCHMARKS](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/BENCHMARKS) and
[performance and guarantees](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/performance-and-guarantees).
The core benchmarks exclude network calls and database operations. Real application throughput depends on those
services and your own handlers; benchmark results are not a throughput guarantee for a deployed bot.

## Documentation

The English guides are machine-translated from Russian. Generated API pages still contain Russian JSDoc comments.
The English README is maintained separately.

- [Getting started](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/getting-started)
- [Guide](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/GUIDE)
- [Recipes](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/recipes)
- [API reference](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/api-reference)
- [Configuration and security](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/configuration)
- [HTTP client](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/http-client)
- [Middleware](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/middleware)
- [Testing](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/testing)
- [Deployment](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/deployment)
- [FAQ](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/FAQ)
- [Migration from 2.x to 3.x](https://www.maxim-m.ru/docs/umbot/en/v-3.1/guides/migration-2x-to-3x)
- [Changelog (Russian)](https://github.com/max36895/umbot/blob/main/CHANGELOG.md)

The [Russian documentation](https://www.maxim-m.ru/docs/umbot/) is also available.

## License and support

[MIT](./LICENSE).

Questions and suggestions: [GitHub Issues](https://github.com/max36895/umbot/issues) or
[maximco36895@yandex.ru](mailto:maximco36895@yandex.ru).
The [Telegram group](https://t.me/mm_universal_bot) and
[channel](https://t.me/joinchat/AAAAAFM8AcuniLTwBLuNsw) are primarily in Russian.
