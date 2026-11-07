/**
 * Модуль для моделей, которые работают с базой данных.
 *
 * Предоставляет набор моделей и интерфейсов для:
 * - Работы с базами данных через модели (Model)
 * - Управления токенами изображений и звуков (ImageTokens, SoundTokens)
 * - Хранения и обработки пользовательских данных (UsersData)
 *
 * @example
 * ```ts
 * import { AppContext, UsersData, ImageTokens } from './models';
 *
 * const appContext = new AppContext();
 *
 * // Работа с данными пользователей
 * const usersData = new UsersData(appContext);
 * usersData.userId = 'user123';
 * usersData.platform = 'telegram';
 * if (await usersData.getOne()) {
 *     console.log(usersData.data); // данные пользователя
 * }
 *
 * // Работа с токенами изображений
 * const imageTokens = new ImageTokens(appContext);
 * const found = await imageTokens.selectOne(); // поиск по заданным полям модели
 * ```
 */

export { DB_TABLES_SCHEMA, getQueryData, Model } from './db';
export type {
    IDbFieldSchema,
    IDbTableSchema,
    IModelState,
    IQuery,
    IQueryData,
    ISelectOneModelRes,
    TDbFieldType,
    TKey,
} from './db';
export type { IDataValue, IModelRes, IModelRules, TModelRulesType, TQueryCb } from './interface';
export { ImageTokens } from './ImageTokens';
export type { IImageModelState } from './ImageTokens';
export { SoundTokens } from './SoundTokens';
export type { ISoundModelState } from './SoundTokens';
export { UsersData } from './UsersData';
export type { IUserDataModelState, TDataType, TMetaType } from './UsersData';
