import { IModelRes, IModelRules } from './interface';

import { IModelState, Model } from './db/Model';
import { IDbResult, AppContext } from '../core';
import { TKey } from './db';

const RULES: IModelRules[] = [
    {
        name: ['userId'],
        type: 'string',
        max: 250,
    },
    {
        name: ['meta', 'data'],
        type: 'text',
    },
    {
        name: ['platform'],
        type: 'string',
    },
];

const ATTRS_LABEL = {
    userId: 'ID',
    meta: 'User meta data',
    data: 'User Data',
    platform: 'Platform Name',
};

/**
 * Тип для метаданных
 */
export type TMetaType = Record<string, unknown> | string | null | undefined;
/**
 * Тип для возвращаемых данных
 */
export type TDataType = string | Record<string, unknown> | null | undefined;

/**
 * Интерфейс для внутреннего состояния модели пользовательских данных.
 * Определяет структуру данных для хранения информации о пользователях в базе данных.
 */
export interface IUserDataModelState extends IModelState {
    /**
     * Идентификатор пользователя.
     * Уникальный идентификатор пользователя в конкретной платформе.
     * @example "123456789" для Telegram, "user_123456" для VK
     */
    userId: string | number | null;
    /**
     * Метаданные пользователя в JSON.
     * Содержит дополнительную информацию о пользователе, такую как статистика использования,
     * настройки, временные метки и т.д.
     * @example { "lastVisit": "2024-03-20T12:00:00Z", "usageCount": 42 }
     */
    meta: TMetaType;
    /**
     * Пользовательские данные в JSON.
     * Содержит основное состояние пользователя, например, прогресс в игре,
     * сохраненные настройки, историю действий и т.д.
     * @example { "progress": 75, "settings": { "notifications": true } }
     */
    data: TDataType;
    /**
     * Тип платформы.
     * Определяет, на какой платформе зарегистрирован пользователь.
     */
    platform: string;
}

/**
 * Модель для работы с пользовательскими данными.
 * Предоставляет единый интерфейс для работы с данными пользователей во всех поддерживаемых платформах.
 *
 * Основные возможности:
 * - Сохранение состояния пользователя между сессиями
 * - Хранение метаданных (например, статистика использования)
 * - Поддержка как файлового хранилища, так и БД
 * - Автоматическая сериализация/десериализация данных
 *
 * @example
 * Сохранение прогресса пользователя (через addCommand — колбэк фреймворк ожидает):
 * ```ts
 * import { UsersData } from 'umbot';
 *
 * interface IGameProgress {
 *     progress?: number;
 * }
 *
 * bot.addCommand('progress', ['прогресс'], async (_text, ctx) => {
 *     // Загрузка данных пользователя
 *     const userData = new UsersData(ctx.appContext);
 *     userData.userId = ctx.userId;
 *
 *     if (await userData.getOne()) {
 *         // data может быть string | Record<string,unknown> | null — сужаем тип
 *         const data = userData.data as IGameProgress | null;
 *         const progress = data?.progress ?? 0;
 *         ctx.text = `Ваш текущий прогресс: ${progress}%`;
 *     } else {
 *         userData.data = { progress: 0 };
 *         userData.meta = { firstVisit: new Date().toISOString() };
 *         await userData.save();
 *         ctx.text = 'Добро пожаловать в игру!';
 *     }
 * });
 * ```
 *
 * @example
 * Работа с разными платформами:
 * ```ts
 * import { T_ALISA, T_TELEGRAM } from 'umbot/plugins';
 *
 * const userData = new UsersData(appContext);
 *
 * // Для Алисы
 * userData.platform = T_ALISA;
 *
 * // Для Telegram
 * userData.platform = T_TELEGRAM;
 * ```
 *
 * @group Хранение данных
 */
export class UsersData extends Model<IUserDataModelState> {
    /**
     * Название таблицы для хранения данных пользователей.
     * @readonly
     */
    public static readonly TABLE_NAME = 'UsersData';

    /**
     * Создает экземпляр модели пользовательских данных.
     * Предоставляет унифицированный интерфейс для хранения данных пользователя.
     *
     * @param {AppContext} appContext - Контекст приложения
     *
     * @example
     * ```ts
     * const userData = new UsersData(appContext);
     * userData.userId = 'user123';
     * userData.platform = 'telegram';
     * ```
     */
    public constructor(appContext: AppContext) {
        super(appContext);
        this.state = {
            userId: null,
            meta: null,
            data: null,
            platform: 'unknown',
        };
    }

    /**
     * Первичный ключ таблицы — userId.
     */
    protected getId(): TKey {
        return 'userId';
    }

    /**
     * userId уникален только в пределах платформы: пользователь Telegram 42
     * и пользователь VK 42 — разные люди, поэтому платформа входит в ключ записи.
     * @returns Поле платформы как часть ключа записи
     */
    protected getUniqueKeys(): string[] {
        return ['platform'];
    }

    /**
     * Уникальный идентификатор пользователя.
     * Может быть строкой или числом в зависимости от платформы.
     * @example "123456789" для Telegram (строка), 123456789 для VK (число)
     */
    get userId(): string | number | null | undefined {
        return this.state.userId;
    }

    /**
     * Устанавливает уникальный идентификатор пользователя.
     * @param {string | number | null} userId - Идентификатор пользователя
     */
    set userId(userId: string | number | null) {
        this.state.userId = userId;
    }

    /**
     * Метаданные пользователя.
     * Может содержать любые дополнительные данные о пользователе, такие как:
     * - Статистика использования
     * - Временные метки
     * - Настройки пользователя
     * - Дополнительная информация
     * @remarks При сохранении в БД автоматически преобразуется в JSON строку
     */
    get meta(): TMetaType {
        return this.state.meta;
    }

    /**
     * Устанавливает метаданные пользователя.
     * @param {TMetaType} meta - Метаданные пользователя
     */
    set meta(meta: TMetaType) {
        this.state.meta = meta;
    }

    /**
     * Основные данные пользователя.
     * Содержит основное состояние пользователя, например:
     * - Прогресс в игре
     * - Сохраненные настройки
     * - История действий
     * - Другие пользовательские данные
     * @remarks При сохранении в БД автоматически преобразуется в JSON строку
     */
    get data(): TDataType {
        return this.state.data;
    }

    /**
     * Устанавливает основные данные пользователя.
     * @param {TDataType} data - Основные данные пользователя
     */
    set data(data: TDataType) {
        this.state.data = data;
    }

    /**
     * Тип платформы пользователя.
     * Определяет платформу, с которой работает пользователь.
     */
    set platform(platform: string) {
        this.state.platform = platform;
    }

    /**
     * Тип платформы пользователя.
     * Определяет платформу, с которой работает пользователь.
     */
    get platform(): string {
        return this.state.platform as string;
    }

    /**
     * Возвращает название таблицы/файла для хранения данных.
     *
     * @returns {string} Название таблицы для хранения данных пользователей
     */
    public tableName(): string {
        return UsersData.TABLE_NAME;
    }

    /**
     * Определяет правила валидации полей модели.
     *
     * @returns {IModelRules[]} Массив правил валидации
     */
    public rules(): IModelRules[] {
        return RULES;
    }

    /**
     * Возвращает описания атрибутов модели.
     * Используется для отображения понятных названий полей.
     *
     * @returns {IUserDataModelState} Описания атрибутов
     */
    public attributeLabels(): IUserDataModelState {
        return ATTRS_LABEL;
    }

    /**
     * Ищет одну запись в хранилище по первичному ключу userId
     * (platform/meta в поиске не участвуют — фильтруйте результат сами при необходимости).
     *
     * @returns {Promise<boolean>} true, если запись найдена
     *
     * @example
     * ```ts
     * const userData = new UsersData(appContext);
     * userData.userId = 'user123';
     * if (await userData.getOne()) {
     *   // data может быть string | Record<string,unknown> | null | undefined:
     *   // сужаем тип перед чтением полей
     *   const progress = (userData.data as Record<string, unknown>)?.progress;
     *   console.log('Пользователь найден, прогресс:', progress);
     * } else {
     *   console.log('Пользователь не найден');
     * }
     * ```
     */
    public async getOne(): Promise<boolean> {
        const query: IModelRes = await this.selectOne();
        if (query && query.status && this._appContext.database.adapter) {
            this.init(this._appContext.database.adapter.getValue(query));
            return true;
        }
        return false;
    }

    private safeStringify(obj: Record<string, unknown>): string {
        const seen = new WeakSet();
        return JSON.stringify(obj, (_, value) => {
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    return '[Circular]';
                }
                seen.add(value);
            }
            return value;
        });
    }

    /**
     * Валидирует значения перед сохранением.
     * Преобразует объекты meta и data в JSON при сохранении в БД.
     *
     * @remarks Не выбрасывает исключений: циклические ссылки в meta/data
     * автоматически заменяются на '[Circular]'.
     *
     * @example
     * ```ts
     * userData.meta = { lastVisit: new Date() };
     * userData.data = { progress: 75 };
     * userData.validate(); // meta и data будут преобразованы в JSON
     * ```
     */
    public validate(): void {
        if (this.meta && typeof this.meta !== 'string') {
            this.meta = this.safeStringify(this.meta);
        }
        if (this.data && typeof this.data !== 'string') {
            this.data = this.safeStringify(this.data);
        }
        super.validate();
    }

    /**
     * Инициализирует модель данными.
     * Преобразует JSON строки meta и data в объекты при загрузке из БД.
     *
     * @param data - Данные для инициализации
     * @remarks
     * - При парсинге data, ошибки игнорируются для обеспечения обратной совместимости
     * - meta парсится только если это JSON-строка, начинающаяся с "{" или "[";
     *   data парсируется всегда, когда это строка (без проверки первого символа)
     *
     * @example
     * ```ts
     * const userData = new UsersData(appContext);
     * userData.init({
     *   userId: 'user123',
     *   meta: '{"lastVisit":"2024-03-20T12:00:00Z"}',
     *   data: '{"progress":75}',
     *   platform: T_TELEGRAM
     * });
     * // init() распарсила JSON-строки meta и data в объекты
     * console.log((userData.meta as { lastVisit?: string }).lastVisit); // строка '2024-03-20T12:00:00Z' (JSON.parse не создаёт Date)
     * console.log(userData.data.progress); // 75
     * ```
     */
    public init(data: IDbResult[] | IDbResult | null): void {
        super.init(data);
        if (typeof this.meta === 'string') {
            if (this.meta.startsWith('{') || this.meta.startsWith('[')) {
                try {
                    this.meta = JSON.parse(this.meta);
                } catch (e) {
                    this._appContext?.logError(
                        `UserData:init() Ошибка при парсинге meta. Возможно данные повреждены.`,
                        {
                            error: e,
                            meta: this.meta,
                        },
                    );
                }
            }
        }
        if (typeof this.data === 'string') {
            try {
                this.data = JSON.parse(this.data);
            } catch (e) {
                this._appContext?.logError(
                    `UserData:init() Произошла ошибка при обработке данных. Скорей всего данные повреждены.`,
                    {
                        error: e,
                        data: this.data,
                    },
                );
            }
        }
    }
}
