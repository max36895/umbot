import { ImageTokens, SoundTokens } from '../../../models';
import { BotController } from '../../../controller';
import { ISoundInfo } from '../../../core';
import type { TEventType } from '../../../core/events';
import { isFile, stripTags, Text } from '../../../utils';
import { IButtonType, IEffect, ISound } from '../../../components';
import { IAlisaRequest } from '../Alisa/interfaces/IAlisaPlatform';

/**
 * Кэширует токен загруженного медиафайла в БД (ImageTokens/SoundTokens).
 *
 * Кэш — оптимизация, а не условие работы: токен уже получен от платформы и
 * возвращается вызывающему независимо от результата записи (без DB-адаптера
 * `model.save()` всегда возвращает false).
 *
 * @param model Модель с заполненными path/platform и токеном
 * @param controller Контроллер приложения (контекст, логгер)
 *
 * @example
 * ```ts
 * model.imageToken = result.id;
 * await cacheMediaToken(model, controller);
 * return model.imageToken;
 * ```
 */
export async function cacheMediaToken(
    model: ImageTokens | SoundTokens,
    controller: BotController,
): Promise<void> {
    // Без DB-адаптера кэшировать некуда — это штатный режим, не ошибка.
    if (!controller.appContext.database.adapter) {
        return;
    }
    try {
        if (!(await model.save(true))) {
            controller.appContext.logWarn(
                'Токен медиафайла получен, но не сохранён в БД — при следующем ответе файл будет загружен повторно.',
                { platform: model.platform, path: model.path },
            );
        }
    } catch (error) {
        controller.appContext.logWarn(
            'Не удалось сохранить токен медиафайла в БД — при следующем ответе файл будет загружен повторно.',
            { platform: model.platform, path: model.path, error },
        );
    }
}

/**
 * Callback для загрузки изображения на платформу.
 * Вызывается только при cache miss — когда токен для файла ещё не был сгенерирован.
 *
 * @param model - Модель ImageTokens для сохранения токена в БД
 * @returns Токен загруженного изображения или null при ошибке
 *
 * @example
 * ```ts
 * const cb: TImageCallback = async (model) => {
 *     const api = new MyPlatformApi(appContext);
 *     const result = await api.uploadImage(model.path);
 *     if (result?.id) {
 *         model.imageToken = result.id;
 *         await model.save(true);
 *         return model.imageToken;
 *     }
 *     return null;
 * };
 * ```
 */
export type TImageCallback = (model: ImageTokens) => Promise<string | null>;

/**
 * Возвращает токен для изображения.
 * В случае, если найти токен в базе не удалось, отрабатывает обработчик, который отправляет запрос на получение токена.
 * @param path Путь до изображения
 * @param platform Платформа для которой нужно получить токен
 * @param controller Контроллер приложения
 * @param cb Обработчик, который вернет токен.
 * @returns Токен из БД, результат обработчика `cb` либо `null`, если путь пуст
 */
export async function getImageToken(
    path: string,
    platform: string,
    controller: BotController,
    cb: TImageCallback,
): Promise<string | null> {
    if (path) {
        const model = new ImageTokens(controller.appContext);
        model.platform = platform;
        model.path = path;
        const query = await model.whereOne({
            platform,
            path,
        });
        if (query && model.imageToken) {
            return model.imageToken;
        }
        return cb(model);
    }
    return null;
}

/**
 * Callback для загрузки аудио на платформу.
 * Вызывается только при cache miss — когда токен для файла ещё не был сгенерирован.
 *
 * @param model - Модель SoundTokens для сохранения токена в БД
 * @returns Токен загруженного аудио или null при ошибке
 *
 * @example
 * ```ts
 * const cb: TSoundCallback = async (model) => {
 *     const api = new MyPlatformApi(appContext);
 *     const result = await api.uploadAudio(model.path);
 *     if (result?.id) {
 *         model.soundToken = result.id;
 *         await model.save(true);
 *         return model.soundToken;
 *     }
 *     return null;
 * };
 * ```
 */
export type TSoundCallback = (model: SoundTokens) => Promise<string | null>;

/**
 * Возвращает токен для аудио.
 * В случае, если найти токен в базе не удалось, отрабатывает обработчик, который отправляет запрос на получение токена.
 * @param path Путь до аудиофайла
 * @param platform Платформа для которой нужно получить токен
 * @param controller Контроллер приложения
 * @param cb Обработчик, который вернет токен.
 * @returns Токен из БД, результат обработчика `cb` либо `null`, если путь пуст
 */
export async function getSoundToken(
    path: string,
    platform: string,
    controller: BotController,
    cb: TSoundCallback,
): Promise<string | null> {
    if (path) {
        const model = new SoundTokens(controller.appContext);
        model.platform = platform;
        model.path = path;
        const query = await model.whereOne({
            platform,
            path,
        });
        if (query && model.soundToken) {
            return model.soundToken;
        }
        return cb(model);
    }
    return null;
}

const PAUSE_REG = /#pause_<\[(\d+)]>#/g;

/**
 * Ищет в тексте команды паузы вида `#pause_<[ms]>#` (например, `#pause_<[500]>#`)
 * и заменяет их на формат `sil <[ms]>`, поддерживаемый голосовыми платформами.
 *
 * @param text - Текст, который будет озвучен пользователю
 * @returns Строка с паузой в формате sil <[ms]>
 */
export function getPause(text: string): string {
    return text.replace(PAUSE_REG, (_, ms: string) => `sil <[${ms}]>`);
}

/**
 * Заменяет звуковой токен в тексте на соответствующий звук
 *
 * @param key - Ключ звука для замены
 * @param value - Значение или массив значений для замены
 * @param text - Исходный текст
 * @returns Текст с замененными звуками
 *
 * @example
 * ```ts
 * // Замена одиночного звука
 * const text = replaceSound(
 *     '#game_win#',
 *     '<speaker audio="alice-sounds-game-win-1.opus">',
 *     'Поздравляем #game_win# с победой!'
 * );
 *
 * // Замена на массив звуков
 * const text = replaceSound(
 *     '#nature_rain#',
 *     [
 *         '<speaker audio="alice-sounds-nature-rain-1.opus">',
 *         '<speaker audio="alice-sounds-nature-rain-2.opus">'
 *     ],
 *     'На улице #nature_rain# идет дождь'
 * );
 * ```
 */
export function replaceSound(key: string, value: string | string[], text: string): string {
    if (text.includes(key)) {
        return Text.textReplace(key, value, text);
    }
    return text;
}

/**
 * Удаляет разметку звуков из текста: теги `<speaker ...>` и паузы `sil <[N]>`.
 * Пользовательские ключи вида `#ключ#` не удаляются.
 *
 * @param text - Исходный текст
 * @returns Текст без SSML-разметки звуков
 *
 * @example
 * ```ts
 * // Удаление тегов звуков
 * const text = removeSound('Текст <speaker audio="a.opus"> без звуков');
 * // Результат: 'Текст  без звуков'
 * ```
 */
export function removeSound(text: string): string {
    if (text.includes('speaker') || text.includes('sil')) {
        return text.replace(/<speaker[^>]*>|sil\s*<\[\d+]>/gi, '');
    }
    return text;
}

/**
 * Возвращает текст, который нужно отправить в чат-платформу.
 *
 * Ядро копирует `text` в `tts` только для голосовых платформ. Чтобы бизнес-логика,
 * заполнившая только `ctx.tts`, не молчала на Telegram, VK, Viber и MAX, при пустом
 * `text` берём `tts`, предварительно убрав из него звуковую SSML-разметку, которая
 * в чате бессмысленна.
 *
 * @param text Текст ответа (`controller.text`)
 * @param tts Озвучиваемый текст (`controller.tts`)
 * @returns Текст для отправки в чат
 *
 * @example
 * ```ts
 * getChatText('', 'Привет <speaker audio="a.opus">'); // -> 'Привет'
 * getChatText('Привет', 'что угодно'); // -> 'Привет'
 * ```
 */
export function getChatText(text: string, tts: string | null): string {
    if (text) {
        return text;
    }
    if (!tts) {
        return '';
    }
    // Убираем только то, что заведомо является разметкой: теги <speaker>, паузы sil
    // и директиву #pause_<[мс]>#. Произвольные пользовательские ключи звуков вида
    // #my_sound# здесь не известны, поэтому их не трогаем.
    return removeSound(tts.replace(PAUSE_REG, '')).trim();
}

/**
 * Базовый метод для обработки tts.
 * Основная задача метода - найти все ключи в запросе, и заменить их на корректные звуки/эффекты.
 * По умолчанию используется в Алисе и Марусе.
 * @param soundInfo - Информация необходимая для обработки аудио
 * @param defaultSounds - Стандартные звуки
 * @param defaultEffects - Стандартные эффекты
 * @returns Обработанный текст с подставленными звуками и эффектами
 */
export function defaultSoundProcessing(
    soundInfo: ISoundInfo,
    defaultSounds: ISound[],
    defaultEffects?: IEffect[],
): string {
    let updSounds: ISound[] = [];
    if (soundInfo.sounds.length) {
        updSounds = [...soundInfo.sounds, ...(soundInfo.usedStandardSound ? defaultSounds : [])];
    } else if (soundInfo.usedStandardSound) {
        updSounds = defaultSounds;
    }
    // Если в тексте нет "#", и никто не задал свои звуки,
    // то считаем что звук никто не вставляет, поэтому доп обработка не требуется.
    // По-хорошему, всегда стоит смотреть на наличие #, и при ее отсутствии не выполнять ничего, но могут быть места, где ключ может сильно отличаться.
    const usedSoundEffect = soundInfo.text.includes('#');
    if (usedSoundEffect) {
        if (defaultEffects) {
            defaultEffects.forEach((item) => {
                soundInfo.text = soundInfo.text.replaceAll(item.key, item.effect);
            });
        }
        soundInfo.text = getPause(soundInfo.text);
    } else if (!soundInfo.sounds.length) {
        return soundInfo.text;
    }
    let res = soundInfo.text;
    if (updSounds.length) {
        for (let i = 0; i < updSounds.length; i++) {
            const sound = updSounds[i];
            if (
                typeof sound === 'object' &&
                sound.sounds !== undefined &&
                sound.key !== undefined
            ) {
                const sText: string = Text.getText(sound.sounds);
                if (sText) {
                    res = replaceSound(sound.key, sText, res);
                }
            }
        }
    }
    return res;
}

/**
 * Нужно ли чат-платформе (Telegram/VK/MAX) обрабатывать звук для ответа.
 *
 * Звук отправляется, если заданы звуки (`controller.sound.sounds`) ИЛИ задан
 * `tts` при настроенном `speech_kit_token` платформы (tts озвучивается через
 * SpeechKit).
 *
 * @param controller Контроллер текущего запроса
 * @param platformName Идентификатор платформы (ключ в appConfig.tokens)
 * @returns `true`, если нужно вызвать soundProcessing платформы
 *
 * @example
 * ```ts
 * if (shouldProcessChatSound(controller, T_TELEGRAM)) {
 *     await controller.sound.getSounds(controller.tts, soundProcessing, controller);
 * }
 * ```
 */
export function shouldProcessChatSound(controller: BotController, platformName: string): boolean {
    if (controller.isSoundInit() && controller.sound.sounds.length > 0) {
        return true;
    }
    return (
        !!controller.tts && !!controller.appContext.appConfig.tokens[platformName]?.speech_kit_token
    );
}

const PAUSE_MARKUP_REGEXPS: readonly RegExp[] = [/#pause_<\[\d+\]>#/g, /sil\s*<\[\d+\]>/g];
const SOUND_MARKER_REGEXP = /#[\w-]+#/g;

/**
 * Готовит текст для синтеза речи на чат-платформах: убирает звуковую разметку
 * голосовых платформ (маркеры звуков `#game_win#`, паузы, теги `<speaker>`),
 * которую иначе SpeechKit зачитал бы вслух.
 *
 * @param text Текст TTS из контроллера
 * @returns Чистый текст для синтеза (пустая строка, если озвучивать нечего)
 *
 * @example
 * ```ts
 * getSpeechText('Победа! #game_win#'); // 'Победа!'
 * ```
 */
export function getSpeechText(text: string | null | undefined): string {
    if (!text) {
        return '';
    }
    let result = text;
    for (const reg of PAUSE_MARKUP_REGEXPS) {
        result = result.replace(reg, ' ');
    }
    // Теги снимаются линейным stripTags: регулярка /<[^>]*>/ квадратична
    // на тексте вида «<<<<…» без закрывающей «>».
    result = stripTags(result, ' ').replace(SOUND_MARKER_REGEXP, ' ');
    return result.replace(/\s+/g, ' ').trim();
}

/**
 * Базовая обработка аудио: получает токены звуков через `getSoundInDB`
 * и собирает их в массив строк для отправки платформе.
 *
 * @param soundInfo - Описание звуков для обработки (из контроллера)
 * @param controller - Контроллер приложения
 * @param getSoundInDB - Функция-обработчик, которая возвращает токен аудио по пути
 * @returns Массив готовых аудио-строк в формате конкретной платформы
 */
export async function getBaseDataSoundProcessing(
    soundInfo: ISoundInfo,
    controller: BotController,
    getSoundInDB: (controller: BotController, path: string) => Promise<string | null>,
): Promise<string[]> {
    const { sounds } = soundInfo;
    const data: string[] = [];
    if (sounds) {
        for (let i = 0; i < sounds.length; i++) {
            const sound = sounds[i];
            if (sound?.sounds !== undefined && sound?.key !== undefined) {
                let sText: string | null = Text.getText(sound.sounds);
                if (Text.isUrl(sText) || (await isFile(sText))) {
                    sText = await getSoundInDB(controller, sText);
                }

                if (sText) {
                    data.push(sText);
                }
            }
        }
    }
    return data;
}

/**
 * Базовая функция, которая инициализирует команду пользователя.
 * Обрабатывает различные типы запросов и сохраняет команду в контроллере
 * @param request Объект запроса от пользователя
 * @param controller Контроллер приложения
 */
export function initUserCommand(request: IAlisaRequest, controller: BotController): void {
    if (request.type === 'SimpleUtterance') {
        controller.userCommand = request.command?.trim() || '';
        // original_utterance может отсутствовать в malformed-запросе — `?.` обязателен.
        controller.originalUserCommand = request.original_utterance?.trim() || '';
    } else {
        // ButtonPressed по протоколу НЕ содержит command/original_utterance —
        // только payload и nlu.tokens (слова надписи кнопки).
        const buttonText = (request.nlu?.tokens ?? []).join(' ');
        const utterance = request.original_utterance?.trim() || buttonText;
        // Как у Telegram/VK/MAX: payload 'buy' или {command|action: 'buy'} → 'buy',
        // чтобы срабатывали addAction/addCommand.
        const hasActionName =
            typeof request.payload === 'string' ||
            (typeof request.payload === 'object' &&
                request.payload !== null &&
                (typeof request.payload.command === 'string' ||
                    typeof request.payload.action === 'string'));
        const fromPayload = hasActionName ? normalizeActionPayload(request.payload) : '';
        controller.userCommand = fromPayload || request.command?.trim() || buttonText;
        controller.originalUserCommand =
            typeof request.payload === 'string' ? request.payload : utterance;
        controller.payload = request.payload;
    }
    if (!controller.userCommand) {
        controller.userCommand = controller.originalUserCommand;
    }
}

/**
 * Возвращает корректный массив кнопок с учетом лимита
 * @param buttons - Массив кнопок
 * @param limit - Максимальное количество кнопок
 * @param appContext - Контекст приложения: без него усечение сверх лимита
 * проходило молча — разработчик не понимал, почему «лишние» кнопки пропали
 */
export function getCorrectButtons<TButton = IButtonType>(
    buttons: TButton[],
    limit: number = 10,
    appContext?: { logWarn(message: string, meta?: Record<string, unknown>): void },
): TButton[] {
    if (buttons && buttons.length > limit) {
        appContext?.logWarn(
            `Кнопок больше лимита (${buttons.length} > ${limit}): показаны первые ${limit}, остальные пропущены.`,
        );
        return buttons.slice(0, limit);
    }
    return buttons;
}

/**
 * Кнопка платформы вместе с группой ряда исходной кнопки (`options._group`).
 */
export interface IButtonRowItem<T> {
    /** Группа ряда: кнопки с одной группой выводятся в одну строку; без группы — своя строка */
    group: unknown;
    /** Готовая кнопка платформы */
    item: T;
}

/**
 * Раскладывает кнопки по рядам клавиатуры.
 *
 * Кнопки с одинаковой группой (`options._group`, её же назначает `buttons.row()`)
 * попадают в одну строку — на место первой кнопки группы; кнопка без группы
 * занимает отдельную строку (прежняя раскладка). Ряд, в котором кнопок больше,
 * чем разрешает платформа, переносится на следующие строки с предупреждением.
 *
 * @param items Кнопки платформы с группами, в порядке добавления
 * @param getRowLimit Сколько кнопок платформа разрешает в ряду (может зависеть от типов кнопок ряда)
 * @param platform Имя платформы для лога
 * @param appContext Контекст для предупреждения
 * @returns Ряды кнопок
 *
 * @example
 * ```ts
 * layoutButtonRows([{ group: 'r0', item: 'a' }, { group: 'r0', item: 'b' }, { group: undefined, item: 'c' }], () => 8, 'Telegram');
 * // [['a', 'b'], ['c']]
 * ```
 */
export function layoutButtonRows<T>(
    items: readonly IButtonRowItem<T>[],
    getRowLimit: (row: readonly T[]) => number,
    platform: string,
    appContext?: { logWarn(message: string, meta?: Record<string, unknown>): void },
): T[][] {
    const rows: T[][] = [];
    const rowByGroup = new Map<string, T[]>();
    for (const { group, item } of items) {
        if (group === undefined || group === null || group === '') {
            rows.push([item]);
            continue;
        }
        const key = String(group);
        const row = rowByGroup.get(key);
        if (row) {
            row.push(item);
        } else {
            const newRow = [item];
            rowByGroup.set(key, newRow);
            rows.push(newRow);
        }
    }
    const result: T[][] = [];
    for (const row of rows) {
        const limit = Math.max(1, getRowLimit(row));
        if (row.length <= limit) {
            result.push(row);
            continue;
        }
        appContext?.logWarn(
            `[${platform}] В ряду ${row.length} кнопок, а платформа разрешает не больше ${limit}: ` +
                'лишние кнопки перенесены на следующую строку.',
        );
        for (let i = 0; i < row.length; i += limit) {
            result.push(row.slice(i, i + limit));
        }
    }
    return result;
}

/**
 * Проверяет, что payload можно безопасно передать в JSON платформы.
 *
 * @param payload Данные кнопки.
 * @param platform Название платформы для диагностического сообщения.
 * @param appContext Контекст приложения для логирования.
 * @returns Строковое представление payload или `null`, если значение не сериализуется.
 */
export function serializePlatformPayload(
    payload: unknown,
    platform: string,
    appContext?: { logWarn(message: string, meta?: Record<string, unknown>): void },
): string | null {
    try {
        const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
        if (serialized !== undefined) {
            return serialized;
        }
    } catch (error) {
        appContext?.logWarn(`[${platform}] payload кнопки не сериализуется и будет пропущен.`, {
            error,
        });
        return null;
    }
    appContext?.logWarn(`[${platform}] payload кнопки не сериализуется и будет пропущен.`);
    return null;
}

/**
 * Возвращает изолированное техническое хранилище адаптера для текущего запроса.
 *
 * Общий контроллер не должен знать о полях конкретных транспортов, поэтому
 * каждый адаптер хранит их только под собственным ключом.
 *
 * @param controller Контроллер текущего запроса
 * @param adapterKey Уникальный ключ адаптера
 * @returns Объект технических данных адаптера
 *
 * @example
 * ```ts
 * const data = getPlatformRequestData<{ callbackId?: string }>(controller, 'my_adapter');
 * data.callbackId = 'callback-123';
 * ```
 */
export function getPlatformRequestData<T extends Record<string, unknown>>(
    controller: BotController,
    adapterKey: string,
): T {
    const requestData = (controller.platformOptions.requestData ??= {});
    const stored = requestData[adapterKey];
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        return stored as T;
    }
    const result: T = {} as T;
    requestData[adapterKey] = result;
    return result;
}

/**
 * Утилита для безопасного преобразования строки в объект
 * @param data - Данные для преобразования
 * @returns Разобранный объект, исходное значение или null (если на входе null)
 */
export function tryParse<TResult = Record<string, unknown>>(
    data: Record<string, unknown> | object | string | null | undefined,
): TResult | null {
    const rawPayload = data;
    if (typeof rawPayload === 'string') {
        const trimmedPayload = rawPayload.trim();
        if (trimmedPayload[0] === '{' || trimmedPayload[0] === '[') {
            try {
                return JSON.parse(rawPayload);
            } catch {
                return rawPayload as unknown as TResult;
            }
        }
    }
    return rawPayload as TResult;
}

/**
 * Проверяет, есть ли в NLU-объекте платформы хоть какие-то данные.
 *
 * Голосовые платформы (Алиса, Маруся) присылают поле nlu всегда — оно есть в
 * протоколе, но в большинстве запросов оказывается пустым (`{}` либо с ключами
 * без значений). Записывать пустой nlu нет смысла: `setNlu({})` семантически
 * идентичен отсутствию вызова, а геттер `controller.nlu` аллоцирует объект Nlu
 * при первом же обращении.
 *
 * Тип параметра — `object`: интерфейсы платформенных nlu (IAlisaNlu,
 * IMarusiaNlu) расширяют INlu без индекс-сигнатуры, поэтому `Record<string, unknown>`
 * их не принимает.
 *
 * @param nlu Поле request.nlu из запроса платформы
 * @returns true, если в nlu есть хотя бы один ключ с данными
 *
 * @example
 * ```ts
 * hasAnyNluKey({}); // -> false — записывать нечего
 * hasAnyNluKey({ tokens: [], entities: [] }); // -> false — только пустые массивы
 * hasAnyNluKey({ entities: [{ type: 'YANDEX.FIO' }] }); // -> true
 * hasAnyNluKey(null); // -> false
 * ```
 */
export function hasAnyNluKey(nlu: object | null | undefined): boolean {
    if (!nlu) {
        return false;
    }
    const source = nlu as Record<string, unknown>;
    for (const key in source) {
        const value = source[key];
        if (value === null || value === undefined) {
            continue;
        }
        if (Array.isArray(value) && value.length === 0) {
            continue;
        }
        if (typeof value === 'object' && Object.keys(value).length === 0) {
            continue;
        }
        return true;
    }
    return false;
}

/**
 * Записывает данные отправителя сообщения в NLU контроллера, если они есть.
 *
 * Чат-платформы (Telegram/VK/MAX/Viber) кладут в NLU только `thisUser`
 * (username/first_name/last_name). Значение идёт в приватный буфер контроллера
 * ({@link BotController.setThisUser}): объект Nlu создаётся лениво при первом
 * обращении бизнес-логики к `controller.nlu`. Когда все поля пусты (анонимный
 * канал, битый апдейт), запись пропускается — как и в случае с пустым nlu
 * голосовых платформ (см. {@link hasAnyNluKey}).
 *
 * @param controller Контроллер текущего запроса
 * @param thisUser Данные отправителя (поля могут отсутствовать)
 *
 * @example
 * ```ts
 * // вместо controller.nlu.setNlu({ thisUser }):
 * setThisUserToNlu(controller, thisUser);
 * ```
 */
export function setThisUserToNlu(
    controller: BotController,
    thisUser: { username?: string | null; first_name?: string | null; last_name?: string | null },
): void {
    // Пустая строка — то же отсутствие данных, что null: адаптеры приводят
    // falsy к null, но хелпер устойчив и к неприведённым значениям.
    if (thisUser.username || thisUser.first_name || thisUser.last_name) {
        controller.setThisUser(thisUser);
    }
}

/**
 * Нормализует payload callback-кнопки в «имя действия» для матчинга команд.
 *
 * Кнопка, созданная через `buttons.addBtn('Купить', '', 'buy')` или с payload
 * `{ command: 'buy' }`, на Telegram/VK/MAX приходит обратно как callback-апдейт
 * с этим payload. Хелпер извлекает имя действия:
 * - `'buy'` → `'buy'`;
 * - `'{"command":"buy"}'` / `{ command: 'buy' }` → `'buy'`;
 * - прочий JSON/текст — возвращается как есть (матчинг по слоту).
 *
 * Так кнопка с payload вызывает `bot.addAction('buy', ...)` / команду `buy`
 * без ручного разбора — как `bot.action()` в популярных фреймворках.
 *
 * @param payload Payload кнопки из апдейта платформы (строка или объект)
 * @returns Нормализованное имя действия (нижний регистр) или `''`, если payload пуст
 *
 * @example
 * ```ts
 * normalizeActionPayload('buy'); // -> 'buy'
 * normalizeActionPayload('{"command":"buy"}'); // -> 'buy'
 * normalizeActionPayload('{"cmd":"x","y":1}'); // -> '{"cmd":"x","y":1}' — без command
 * normalizeActionPayload(null); // -> ''
 * ```
 */
export function normalizeActionPayload(payload: unknown): string {
    if (payload == null) {
        return '';
    }
    if (typeof payload === 'string') {
        const trimmed = payload.trim().toLowerCase();
        if (!trimmed) {
            return '';
        }
        // JSON-строка с полем command: '{"command":"buy"}' -> 'buy'.
        if (trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}') {
            try {
                const parsed = JSON.parse(trimmed) as Record<string, unknown>;
                const command = parsed.command ?? parsed.action;
                if (typeof command === 'string' && command.trim()) {
                    return command.trim().toLowerCase();
                }
            } catch {
                // Битый JSON — используем строку как есть.
            }
        }
        return trimmed;
    }
    if (typeof payload === 'object') {
        const source = payload as Record<string, unknown>;
        const command = source.command ?? source.action;
        if (typeof command === 'string' && command.trim()) {
            return command.trim().toLowerCase();
        }
        try {
            return JSON.stringify(payload).toLowerCase();
        } catch {
            return '';
        }
    }
    return String(payload).toLowerCase();
}

/**
 * Определяет универсальный тип события по вложениям сообщения Telegram.
 *
 * @param message Объект message из апдейта Telegram
 * @returns TEventType (см. umbot / src/core/events.ts): 'photo', 'voice',
 *   'video', 'document', 'location', 'contact', 'sticker' или 'message'
 *   для обычного текста
 */
export function telegramMessageEvent(message: object): TEventType {
    const source = message as Record<string, unknown>;
    if (source.photo) {
        return 'photo';
    }
    if (source.voice) {
        return 'voice';
    }
    if (source.video_note) {
        return 'video';
    }
    if (source.video) {
        return 'video';
    }
    if (source.document) {
        return 'document';
    }
    if (source.location) {
        return 'location';
    }
    if (source.contact) {
        return 'contact';
    }
    if (source.sticker) {
        return 'sticker';
    }
    return 'message';
}

/**
 * Определяет универсальный тип события по типу сообщения Viber.
 *
 * @param type Поле message.type из события Viber ('text', 'picture', 'video',
 *   'file', 'contact', 'location', 'sticker', 'rich_media', …)
 * @returns TEventType (см. umbot / src/core/events.ts): 'document' для file;
 *   audio и остальные типы без отдельной ветки распознаются как 'message'
 */
export function viberMessageEvent(type: string | undefined): TEventType {
    switch (type) {
        case 'picture':
            return 'photo';
        case 'video':
            return 'video';
        case 'file':
            return 'document';
        case 'contact':
            return 'contact';
        case 'location':
            return 'location';
        case 'sticker':
            return 'sticker';
        default:
            // 'text', 'rich_media', undefined и будущие типы — обычное сообщение.
            return 'message';
    }
}
