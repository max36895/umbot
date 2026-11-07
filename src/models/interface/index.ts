/**
 * Модуль интерфейсов для работы с данными
 *
 * Предоставляет базовые контракты моделей:
 * - Правила валидации полей модели (IModelRules)
 * - Формат результата запроса к БД (IModelRes)
 * - Тип колбэка для произвольных запросов (TQueryCb)
 *
 * @example
 * ```ts
 * import { IModelRules, IModelRes } from './models/interface';
 *
 * // Правила валидации полей модели
 * const RULES: IModelRules[] = [
 *     { name: ['userId'], type: 'string', max: 250 },
 *     { name: ['score'], type: 'integer' },
 * ];
 *
 * // Результат запроса к БД
 * const res: IModelRes = { status: true, data: { userId: '123' } };
 * ```
 */
export type { IDataValue, IModelRes, IModelRules, TModelRulesType, TQueryCb } from './IModel';
