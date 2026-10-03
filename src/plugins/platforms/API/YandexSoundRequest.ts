import { YandexRequest } from './YandexRequest';
import {
    IYandexCheckOutPlace,
    IYandexRemoveRequest,
    IYandexRequestDownloadSound,
    IYandexRequestDownloadSoundRequest,
    IYandexRequestDownloadSoundsRequest,
    IYandexSoundsCheckOutPlaceRequest,
} from './interfaces';
import { AppContext, Request } from '../../../index';
import path from 'path';

const ALLOWED_AUDIO_EXT = ['.mp3', '.ogg', '.opus', '.wav', '.m4a', '.aac'];
/**
 * Адрес, на который будет отправляться запрос
 */
const STANDARD_URL = 'https://dialogs.yandex.net/api/v1/';

/**
 * Класс, отвечающий за загрузку аудиофайлов в навык Алисы
 * @see https://yandex.ru/dev/dialogs/alice/doc/resource-sounds-upload-docpage/ Документация API Яндекс.Диалогов
 *
 * @class YandexSoundRequest
 *
 * @group API платформ
 */
export class YandexSoundRequest extends YandexRequest {
    /**
     * Идентификатор навыка, необходимый для корректного сохранения аудиофайлов
     * @see YandexRequest Базовый класс для работы с API Яндекса
     */
    public skillId: string | null;

    /**
     * Создает экземпляр класса для работы с аудиофайлами в навыке Алисы
     * @param oauth Авторизационный токен для загрузки аудиофайлов
     * @param skillId Идентификатор навыка
     * @param appContext Контекст приложения
     * @see https://tech.yandex.ru/dialogs/alice/doc/resource-upload-docpage/ Документация по загрузке ресурсов
     * @see https://oauth.yandex.ru/verification_code Получение OAuth-токена
     */
    constructor(
        oauth: string | null = null,
        skillId: string | null = null,
        appContext: AppContext,
    ) {
        super(oauth, appContext);
        this.skillId = skillId || null;
        this._request.url = STANDARD_URL;
    }

    /**
     * Получение адреса для загрузки аудиофайлов.
     *
     * skill_id приходит из payload запроса Алисы, а вебхук Алисы не подписывается —
     * значение полностью подконтрольно отправителю. Экранируем его в компонент URL,
     * чтобы `../` или `?` не выводили запрос за пределы пути навыка.
     *
     * @returns {string}
     */
    #getSoundsUrl(): string {
        return `${STANDARD_URL}skills/${encodeURIComponent(this.skillId ?? '')}/sounds`;
    }

    /**
     * Проверка занятого места в хранилище аудиофайлов
     * @returns {Promise<IYandexCheckOutPlace | null>} Информация о занятом месте:
     * - total: общий доступный объем хранилища
     * - used: использованный объем хранилища
     * @remarks Для каждого аккаунта действует лимит в 1 ГБ. Учитывается размер сжатых файлов в формате OPUS
     */
    public async checkOutPlace(): Promise<IYandexCheckOutPlace | null> {
        this._request.url = STANDARD_URL + 'status';
        const query = await this.call<IYandexSoundsCheckOutPlaceRequest>();
        if (query?.sounds?.quota !== undefined) {
            return query.sounds.quota;
        }
        this._log('checkOutPlace() Не удалось проверить занятое место под аудиофайлы.');

        return null;
    }

    /**
     * Загрузка аудиофайла с сервера
     * @param soundDir Путь к аудиофайлу на сервере
     * @returns {Promise<IYandexRequestDownloadSound | null>} Информация о загруженном аудиофайле:
     * - id: уникальный идентификатор файла
     * - skillId: идентификатор навыка
     * - size: размер файла в байтах
     * - originalName: оригинальное имя файла
     * - createdAt: дата и время загрузки
     * - isProcessed: статус обработки файла
     */
    public async downloadSoundFile(soundDir: string): Promise<IYandexRequestDownloadSound | null> {
        if (this.skillId) {
            const ext = path.extname(soundDir).toLowerCase();
            if (!ALLOWED_AUDIO_EXT.includes(ext)) {
                this._log(
                    `downloadSoundFile() Недопустимый тип файла: ${ext}. Ожидаются аудиофайлы.`,
                );
                return null;
            }
            this._request.url = this.#getSoundsUrl();
            this._request.header = Request.HEADER_FORM_DATA;
            this._request.attach = soundDir;
            const query = await this.call<IYandexRequestDownloadSoundRequest>();
            if (query?.sound?.id === undefined) {
                this._log(`downloadSoundFile() Не удалось загрузить аудио по пути "${soundDir}".`);
            } else {
                return query.sound;
            }
        } else {
            this._log('downloadSoundFile() Не указан навык, в который необходимо загрузить аудио.');
        }
        return null;
    }

    /**
     * Получение списка всех загруженных аудиофайлов
     * @returns {Promise<IYandexRequestDownloadSound[] | null>} Массив с информацией о загруженных аудиофайлах
     */
    public async getLoadedSounds(): Promise<IYandexRequestDownloadSound[] | null> {
        if (this.skillId) {
            this._request.url = this.#getSoundsUrl();
            const query = await this.call<IYandexRequestDownloadSoundsRequest>();
            return query?.sounds || null;
        } else {
            this._log(
                'getLoadedSounds() Не указан навык, у которого необходимо получить все загруженные аудиофайлы.',
            );
        }
        return null;
    }

    /**
     * Удаление конкретного аудиофайла по его идентификатору
     * @param soundId Идентификатор аудиофайла для удаления
     * @returns {Promise<string | null>} 'ok' при успешном удалении, null при ошибке
     */
    public async deleteSound(soundId: string): Promise<string | null> {
        if (this.skillId) {
            if (soundId) {
                this._request.url = `${this.#getSoundsUrl()}/${soundId}`;
                this._request.customRequest = 'DELETE';
                const query = await this.call<IYandexRemoveRequest>();
                this._request.customRequest = null;
                if (query?.result === undefined) {
                    this._log('deleteSound() Не удалось удалить аудиофайл.');
                } else {
                    return query.result;
                }
            } else {
                this._log('deleteSound() Не выбрано аудио для удаления.');
            }
        } else {
            this._log('deleteSound() Не указан навык, в котором необходимо удалить аудио.');
        }
        return null;
    }

    /**
     * Удаление всех загруженных аудиофайлов
     * @returns {Promise<boolean>} true если все файлы успешно удалены, false при ошибке
     * @remarks Если при удалении произойдет ошибка, некоторые файлы могут остаться в хранилище
     */
    public async deleteSounds(): Promise<boolean> {
        if (this.skillId) {
            const sounds = await this.getLoadedSounds();
            if (sounds) {
                let success = true;
                for (const sound of sounds) {
                    try {
                        success = (await this.deleteSound(sound.id)) !== null && success;
                    } catch (e) {
                        this._log(`deleteSounds() Ошибка при удалении аудио "${sound.id}": ${e}`);
                        success = false;
                    }
                    await new Promise((resolve) => setTimeout(resolve, 200).unref());
                }
                return success;
            } else {
                this._log('deleteSounds() Не удалось получить загруженные аудиофайлы!');
            }
        } else {
            this._log('deleteSounds() Не указан навык, в котором необходимо удалить аудиофайлы.');
        }
        return false;
    }
}
