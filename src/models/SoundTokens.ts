import { IModelRules } from './interface';

import { IModelState, ISelectOneModelRes, Model } from './db/Model';
import { AppContext } from '../core';
import { TKey } from './db';

const RULES: IModelRules[] = [
    {
        name: ['soundToken', 'path'],
        type: 'string',
        max: 150,
    },
    {
        name: ['platform'],
        type: 'string',
    },
];

const ATTRS_LABEL = {
    soundToken: 'ID',
    path: 'Sound path',
    platform: 'Platform name',
};

/**
 * Интерфейс для внутреннего состояния модели звуковых файлов.
 * Определяет структуру данных для хранения информации о звуковых файлах в базе данных.
 */
export interface ISoundModelState extends IModelState {
    /**
     * Идентификатор звукового файла.
     * Уникальный идентификатор, используемый для ссылки на звуковой файл в API различных платформ.
     * @example "doc123456789" для VK, "file_id_123456" для Telegram
     */
    soundToken: string | null;
    /**
     * Путь к файлу.
     * Может быть URL-адресом звукового файла или путем к локальному файлу.
     * @example "/path/to/audio.mp3" или "http://localhost/audio.mp3"
     */
    path: string | null;
    /**
     * Тип платформы.
     * Определяет, для какой платформы предназначен звуковой файл.
     */
    platform: string;
}

/**
 * Модель для управления звуковыми файлами в различных платформах.
 * Предоставляет единый интерфейс для работы со звуковыми файлами в Алисе, ВКонтакте, Telegram, Марусе и тд.
 *
 * @extends Model<ISoundModelState>
 *
 * @example
 * ```ts
 * // Создание и загрузка звукового файла для Telegram
 * const sound = new SoundTokens(appContext);
 * sound.path = '/path/to/audio.mp3';
 * sound.platform = T_TELEGRAM;
 * const found = await sound.selectOne();
 * if (found.status) {
 *     console.log('Токен для звукового файла успешно получен, токен:', found.data?.soundToken);
 * } else {
 *     // Загрузка аудиофайла в платформу — токен выдаёт API платформы,
 *     // затем он присваивается модели и запись сохраняется в БД
 *     sound.soundToken = tokenFromPlatform;
 *     const saved = await sound.save(true); // save() возвращает boolean, а не токен
 *     console.log('Запись сохранена:', saved);
 * }
 * ```
 *
 * @group Хранение данных
 */
export class SoundTokens extends Model<ISoundModelState> {
    /**
     * Название таблицы для хранения данных о звуковых файлах.
     */
    protected static readonly TABLE_NAME = 'SoundTokens';

    /**
     * Флаг, указывающий, что передается содержимое файла.
     * Если true, то path содержит содержимое файла, а не путь к нему.
     * Поле предназначено для пользовательского кода (аналог флага TSoundCallback);
     * сам фреймворк его не устанавливает и не читает (VK/Sound.ts задаёт одноимённый
     * флаг на VkRequest, а не на модель).
     * @defaultValue false
     */
    public isAttachContent: boolean;

    /**
     * Конструктор класса SoundTokens.
     * Предоставляет унифицированный интерфейс для хранения данных о загруженных аудиофайлах.
     *
     * @param {AppContext} appContext - Контекст приложения
     */
    public constructor(appContext: AppContext) {
        super(appContext);
        this.soundToken = null;
        this.path = null;
        this.platform = 'unknown';
        this.isAttachContent = false;
    }

    /**
     * Первичный ключ таблицы — soundToken.
     */
    protected getId(): TKey {
        return 'soundToken';
    }

    /**
     * Идентификатор звукового файла.
     * Уникальный идентификатор, используемый для ссылки на звуковой файл в API различных платформ.
     * @example "doc123456789" для VK, "file_id_123456" для Telegram
     */
    get soundToken(): string {
        return this.state.soundToken as string;
    }

    /**
     * Устанавливает идентификатор звукового файла.
     * @param {string | null} soundToken - Токен звукового файла
     */
    set soundToken(soundToken: string | null) {
        this.state.soundToken = soundToken;
    }

    /**
     * Путь к файлу.
     * Может быть URL-адресом звукового файла или путем к локальному файлу.
     * @example "/path/to/audio.mp3" или "http://localhost/audio.mp3"
     */
    get path(): string {
        return this.state.path as string;
    }

    /**
     * Устанавливает путь к файлу.
     * @param {string | null} path - Путь к аудиофайлу или URL
     */
    set path(path: string | null) {
        this.state.path = path;
    }

    /**
     * Тип платформы.
     * Определяет, для какой платформы предназначен звуковой файл.
     */
    get platform(): string {
        return this.state.platform as string;
    }

    /**
     * Устанавливает тип платформы.
     * @param {string} platform - Тип платформы (alisa, telegram, vk и т.д.)
     */
    set platform(platform: string) {
        this.state.platform = platform;
    }

    /**
     * Находит token звукового файла по пути и платформе.
     *
     * Для SoundTokens логичный lookup идёт по `path`+`platform`, а не по `soundToken`
     * (он ещё null на новой модели).
     *
     * @returns Promise с результатом поиска `{status, data, error}`. При успехе
     * `data` содержит найденную запись модели, а не сам токен.
     */
    public async selectOne(): Promise<ISelectOneModelRes> {
        if (this._appContext.database.adapter) {
            this.queryData.query = {
                path: this.state.path,
                platform: this.state.platform,
            };
            this.queryData.data = null;
            return (await this._appContext.database.adapter.select(
                this.queryData,
                this.queryData.query,
                true,
            )) as ISelectOneModelRes;
        }
        return {
            status: false,
            error: 'Не указан источник для базы данных',
        };
    }

    /**
     * Возвращает название таблицы/файла с данными.
     *
     * @returns {string} Название таблицы для хранения данных о звуковых файлах
     */
    public tableName(): string {
        return SoundTokens.TABLE_NAME;
    }

    /**
     * Определяет правила валидации для полей модели.
     *
     * @returns {IModelRules[]} Массив правил валидации
     */
    public rules(): IModelRules[] {
        return RULES;
    }

    /**
     * Возвращает метки атрибутов таблицы.
     * Используется для отображения понятных названий полей.
     *
     * @returns {ISoundModelState} Объект с метками атрибутов
     */
    public attributeLabels(): ISoundModelState {
        return ATTRS_LABEL;
    }
}
