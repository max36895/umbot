import { IModelRules } from './interface';

import { IModelState, ISelectOneModelRes, Model } from './db/Model';
import { AppContext } from '../core';
import { TKey } from './db';

const RULES: IModelRules[] = [
    {
        name: ['imageToken', 'path'],
        type: 'string',
        max: 150,
    },
    {
        name: ['platform'],
        type: 'string',
    },
];

const ATTRS_LABEL = {
    imageToken: 'ID',
    path: 'Image path',
    platform: 'Platform name',
};

/**
 * Интерфейс для внутреннего состояния модели изображений.
 * Определяет структуру данных для хранения информации об изображениях в базе данных.
 */
export interface IImageModelState extends IModelState {
    /**
     * Идентификатор/токен изображения.
     * Уникальный идентификатор, используемый для ссылки на изображение в API различных платформ.
     * @example "photo123_456" для VK, "AgACAgIAAxk..." (file_id) для Telegram, "123456/abcdef" для Алисы
     */
    imageToken: string | null;
    /**
     * Расположение изображения (url/директория).
     * Может быть URL-адресом изображения или путем к локальному файлу.
     */
    path: string | null;
    /**
     * Тип платформы.
     * Определяет, для какой платформы предназначено изображение.
     */
    platform: string;
}

/**
 * Модель для управления изображениями в различных платформах.
 * Предоставляет единый интерфейс для работы с изображениями в Алисе, ВКонтакте, Telegram, Марусе и тд.
 *
 * @extends Model<IImageModelState>
 *
 * @example
 * ```ts
 * // Создание и загрузка изображения для Telegram
 * const image = new ImageTokens(appContext);
 * image.path = '/path/to/image.png';
 * image.platform = T_TELEGRAM;
 * const found = await image.selectOne();
 * if (found.status) {
 *     console.log('Токен для изображения успешно получен, токен:', found.data?.imageToken);
 * } else {
 *     // Загрузка изображения в платформу — токен выдаёт API платформы,
 *     // затем он присваивается модели и запись сохраняется в БД
 *     image.imageToken = tokenFromPlatform;
 *     const saved = await image.save(true); // save() возвращает boolean, а не токен
 *     console.log('Запись сохранена:', saved);
 * }
 * ```
 *
 * @group Хранение данных
 */
export class ImageTokens extends Model<IImageModelState> {
    /**
     * Название таблицы для хранения данных об изображениях.
     */
    protected static readonly TABLE_NAME = 'ImageTokens';

    /**
     * Описание изображения (опционально).
     * Не входит в attributeLabels() и не сохраняется в БД —
     * предназначено только для пользовательского кода.
     */
    public caption: string | null;

    /**
     * Конструктор класса ImageTokens.
     * Предоставляет унифицированный интерфейс для хранения данных о загруженных изображениях.
     *
     * @param {AppContext} appContext - Контекст приложения
     */
    public constructor(appContext: AppContext) {
        super(appContext);
        this.imageToken = null;
        this.path = null;
        this.platform = 'unknown';
        this.caption = null;
    }

    /**
     * Первичный ключ таблицы — imageToken.
     */
    protected getId(): TKey {
        return 'imageToken';
    }

    /**
     * Идентификатор/токен изображения.
     * Уникальный идентификатор, используемый для ссылки на изображение в API платформы.
     */
    get imageToken(): string {
        return this.state.imageToken as string;
    }

    /**
     * Устанавливает идентификатор/токен изображения.
     * @param {string | null} imageToken - Токен изображения
     */
    set imageToken(imageToken: string | null) {
        this.state.imageToken = imageToken;
    }

    /**
     * Расположение изображения (url/директория).
     * Может быть URL-адресом изображения или путем к локальному файлу.
     */
    get path(): string {
        return this.state.path as string;
    }

    /**
     * Устанавливает расположение изображения (url/директория).
     * @param {string | null} path - Путь к изображению или URL
     */
    set path(path: string | null) {
        this.state.path = path;
    }

    /**
     * Тип приложения, для которого загружена картинка.
     */
    get platform(): string {
        return this.state.platform as string;
    }

    /**
     * Устанавливает тип приложения, для которого загружена картинка.
     * @param {string} platform - Тип платформы (alisa, telegram, vk и т.д.)
     */
    set platform(platform: string) {
        this.state.platform = platform;
    }

    /**
     * Находит token изображения по пути и платформе.
     *
     * Для ImageTokens логичный lookup идёт по `path`+`platform`, а не по `imageToken`
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
     * @returns {string} Название таблицы для хранения данных об изображениях
     */
    public tableName(): string {
        return ImageTokens.TABLE_NAME;
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
     * @returns {IImageModelState} Объект с метками атрибутов
     */
    public attributeLabels(): IImageModelState {
        return ATTRS_LABEL;
    }
}
