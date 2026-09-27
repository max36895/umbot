/**
 * Модуль базового класса моделей для работы с данными
 *
 * Предоставляет компоненты для:
 * - Описания моделей данных через наследование от Model
 * - Валидации полей по правилам (IModelRules)
 * - Формирования и разбора условий запросов (QueryData)
 *
 * Подключение к конкретной БД выполняется адаптерами
 * (FileAdapter, MongoAdapter — см. `umbot/plugins`).
 *
 * @example
 * ```ts
 * import { Model, AppContext } from 'umbot';
 *
 * // Создание модели пользователя
 * class UserModel extends Model<{ id: number | null; name: string | null }> {
 *   public constructor(appContext: AppContext) {
 *     super(appContext);
 *     this.state = { id: null, name: null };
 *   }
 *   rules() { return [{ name: ['name'], type: 'string', max: 200 }]; }
 *   attributeLabels() { return { id: 'ID', name: 'Имя' }; }
 *   tableName() { return 'users'; }
 * }
 *
 * const user = new UserModel(appContext);
 * ```
 */
export * from './Model';
export * from './QueryData';
export * from './schema';
