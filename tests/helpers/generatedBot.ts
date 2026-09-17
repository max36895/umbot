/**
 * Запуск проекта, сгенерированного `umbot create from-flow`, как настоящего навыка Алисы.
 *
 * Зачем: текстовые проверки кода генератора не ловят поведенческие расхождения
 * (что ответит бот на старт сессии, пропустит ли шаг запуск и т.д.). Здесь проект
 * компилируется CLI tsc, пакет `umbot` подключается junction-ссылкой на собранный
 * dist/ репозитория, а запросы идут через экспортированный cloud-handler
 * (`--usecloud`: без bot.start и HTTP-сервера).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Корень репозитория umbot (tests/helpers/.. /..). */
const PROJECT_ROOT = resolve(__dirname, '..', '..');

/** Ответ навыка Алисы в упрощённом виде. */
export interface IAlisaReply {
    text: string;
    buttons: { title: string; payload?: unknown }[];
    endSession: boolean;
}

/** Сессия диалога с навыком: номер сообщения и эхо state, как делает Алиса. */
export interface IAlisaDialog {
    /** Новая сессия: message_id начинается с нуля, session_state сбрасывается. */
    newSession(): void;
    /** Реплика пользователя (пустая строка — запуск навыка без команды). */
    say(text: string): Promise<IAlisaReply>;
    /** Нажатие кнопки из последнего ответа. */
    press(title: string): Promise<IAlisaReply>;
}

type TCloudHandler = (
    event: Record<string, unknown>,
) => Promise<{ statusCode: number; body: string }>;

/**
 * Компилирует сгенерированный проект и возвращает его cloud-handler.
 * Проект должен быть сгенерирован с `useCloud: true`.
 *
 * @param projectPath Папка сгенерированного проекта
 * @returns handler из dist/index.js
 */
export function buildGeneratedBot(projectPath: string): TCloudHandler {
    const umbotLink = join(projectPath, 'node_modules', 'umbot');
    if (!existsSync(umbotLink)) {
        mkdirSync(join(projectPath, 'node_modules'), { recursive: true });
        symlinkSync(PROJECT_ROOT, umbotLink, 'junction');
    }
    const configPath = join(projectPath, 'tsconfig.umbot-build.json');
    writeFileSync(
        configPath,
        JSON.stringify({
            extends: './tsconfig.json',
            compilerOptions: { typeRoots: [join(PROJECT_ROOT, 'node_modules', '@types')] },
        }),
        'utf8',
    );
    const tscBin = join(PROJECT_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
    try {
        execFileSync(process.execPath, [tscBin, '-p', configPath], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (error) {
        const execError = error as { stdout?: string; stderr?: string };
        throw new Error(
            `Проект не компилируется (${projectPath}):\n${[execError.stdout, execError.stderr].filter(Boolean).join('\n')}`,
            { cause: error },
        );
    } finally {
        rmSync(configPath, { force: true });
    }

    const mod = require(join(projectPath, 'dist', 'index.js')) as { handler: TCloudHandler };
    return mod.handler;
}

/**
 * Отправляет Telegram-апдейт в собранный проект в отдельном процессе Node (cwd — папка
 * проекта, как у `npm start`) и возвращает URL перехваченных запросов к Telegram API.
 *
 * Отдельный процесс нужен потому, что модуль umbot внутри песочницы jest видит `fetch`
 * внешнего realm — подмена globalThis.fetch в тесте до него не доходит, и запрос ушёл бы в сеть.
 *
 * @param projectPath Папка проекта, уже собранного {@link buildGeneratedBot}
 * @param update Апдейт Telegram
 * @returns URL вызовов Telegram API (токен виден в пути)
 */
export function sendTelegramUpdateInChild(projectPath: string, update: object): string[] {
    const script = `
        const calls = [];
        globalThis.fetch = async (url) => {
            calls.push(String(url));
            return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
        };
        const { handler } = require('./dist/index.js');
        handler({ body: ${JSON.stringify(JSON.stringify(update))}, headers: {} }).then(() => {
            process.stdout.write(JSON.stringify(calls));
            process.exit(0);
        });
    `;
    const env = { ...process.env };
    // Токен должен прийти только из .env проекта
    for (const name of Object.keys(env)) {
        if (name.endsWith('_TOKEN')) {
            delete env[name];
        }
    }
    const stdout = execFileSync(process.execPath, ['-e', script], {
        cwd: projectPath,
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(stdout) as string[];
}

/**
 * Диалог с навыком: формирует запросы Алисы (SimpleUtterance / ButtonPressed),
 * ведёт message_id и возвращает боту его session_state/application_state.
 *
 * @param handler cloud-handler сгенерированного проекта
 * @returns объект диалога
 */
export function createAlisaDialog(handler: TCloudHandler): IAlisaDialog {
    let session = 1;
    let messageId = 0;
    let sessionState: unknown = {};
    let applicationState: unknown = {};
    let lastButtons: IAlisaReply['buttons'] = [];

    const send = async (request: Record<string, unknown>): Promise<IAlisaReply> => {
        const body = {
            meta: {
                locale: 'ru-RU',
                timezone: 'UTC',
                client_id: 'ru.yandex.searchplugin/7.16',
                interfaces: { screen: {} },
            },
            session: {
                message_id: messageId,
                session_id: `session-${session}`,
                skill_id: 'skill',
                user_id: 'user',
                user: { user_id: 'user' },
                application: { application_id: 'APPLICATION' },
                new: messageId === 0,
            },
            request,
            state: { session: sessionState, application: applicationState },
            version: '1.0',
        };
        messageId++;
        const result = await handler({ body: JSON.stringify(body), headers: {} });
        const parsed = JSON.parse(result.body) as {
            response?: { text?: string; buttons?: IAlisaReply['buttons']; end_session?: boolean };
            session_state?: unknown;
            application_state?: unknown;
        };
        if (parsed.session_state !== undefined) {
            sessionState = parsed.session_state;
        }
        if (parsed.application_state !== undefined) {
            applicationState = parsed.application_state;
        }
        lastButtons = parsed.response?.buttons ?? [];
        return {
            text: parsed.response?.text ?? '',
            buttons: lastButtons,
            endSession: !!parsed.response?.end_session,
        };
    };

    return {
        newSession(): void {
            session++;
            messageId = 0;
            sessionState = {};
        },
        say(text: string): Promise<IAlisaReply> {
            const command = text.toLowerCase().trim();
            return send({
                command,
                original_utterance: text,
                type: 'SimpleUtterance',
                nlu: { tokens: command.split(/\s+/).filter(Boolean), entities: [], intents: {} },
            });
        },
        press(title: string): Promise<IAlisaReply> {
            const button = lastButtons.find((b) => b.title === title);
            if (!button) {
                throw new Error(
                    `Кнопки «${title}» нет в последнем ответе: ${JSON.stringify(lastButtons)}`,
                );
            }
            // Кнопка без payload в Алисе отправляет свой текст как реплику
            if (button.payload === undefined || button.payload === '') {
                return this.say(title);
            }
            return send({
                type: 'ButtonPressed',
                payload: button.payload,
                nlu: { tokens: title.toLowerCase().split(/\s+/), entities: [], intents: {} },
            });
        },
    };
}
