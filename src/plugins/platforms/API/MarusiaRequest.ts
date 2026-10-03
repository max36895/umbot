import { VkRequest } from './VkRequest';
import {
    IMarusiaApiAudioUpdateLink,
    IMarusiaApiCreateAudio,
    IMarusiaApiPictureUpdateLink,
    IMarusiaApiRemove,
    IMarusiaApiSavePicture,
} from './interfaces';
import { AppContext } from '../../../index';
import { T_MARUSIA } from '../Marusia/constants';
import { getErrorMsg } from './constants';

/**
 * Класс для взаимодействия с API голосового помощника Маруся.
 * Расширяет функционал VkRequest для работы со специфичными методами Маруси.
 * @see https://dev.vk.ru/ru/marusia/api
 *
 * @example
 * ```ts
 * import { MarusiaRequest } from 'umbot/plugins';
 *
 * // Создание экземпляра (appContext обязателен)
 * const marusia = new MarusiaRequest(appContext);
 * marusia.initToken('your-marusia-token');
 *
 * // Загрузка изображения
 * async function uploadImage(imagePath: string) {
 *   // Получаем URL для загрузки
 *   const uploadLink = await marusia.marusiaGetPictureUploadLink();
 *   if (uploadLink) {
 *     // Загружаем изображение
 *     const upload = await marusia.upload(uploadLink.picture_upload_link, imagePath, 'photo');
 *     if (upload && upload.photo && upload.server && upload.hash) {
 *       // Сохраняем изображение (поля IVkUploadFile опциональны —
 *       // перед вызовом проверяем их наличие)
 *       const picture = await marusia.marusiaSavePicture(
 *         upload.photo,
 *         upload.server,
 *         upload.hash
 *       );
 *       return picture;
 *     }
 *   }
 *   return null;
 * }
 *
 * // Загрузка аудио
 * async function uploadAudio(audioPath: string) {
 *   // Получаем URL для загрузки
 *   const uploadLink = await marusia.marusiaGetAudioUploadLink();
 *   if (uploadLink) {
 *     // Загружаем аудиофайл
 *     const upload = await marusia.upload(uploadLink.audio_upload_link, audioPath);
 *     if (upload) {
 *       // Сохраняем аудио
 *       const audio = await marusia.marusiaCreateAudio(upload);
 *       return audio;
 *     }
 *   }
 *   return null;
 * }
 * ```
 *
 * @group API платформ
 */
export class MarusiaRequest extends VkRequest {
    /**
     * Создает экземпляр класса для работы с API Маруси
     *
     * @param appContext Контекст приложения (обязателен)
     */
    public constructor(appContext: AppContext) {
        super(appContext);
        if (appContext.appConfig.tokens[T_MARUSIA]?.token) {
            this.initToken(appContext.appConfig.tokens[T_MARUSIA].token);
        } else {
            this.token = null;
        }
    }

    /**
     * Запрашивает URL для загрузки изображения на сервера Маруси
     *
     * @remarks
     * Поддерживаемые форматы изображений:
     * - JPEG, JPG, PNG
     * - Максимальный размер: 5MB
     * - Рекомендуемое разрешение: 800x800 пикселей
     *
     * @example
     * ```ts
     * // Получение URL для загрузки
     * const uploadLink = await marusia.marusiaGetPictureUploadLink();
     * if (uploadLink) {
     *   // Загрузка изображения
     *   const upload = await marusia.upload(uploadLink.picture_upload_link, 'image.jpg', 'photo');
     *   if (upload) {
     *     console.log('Изображение загружено:', upload);
     *   }
     * }
     * ```
     *
     * @returns {Promise<IMarusiaApiPictureUpdateLink | null>} Данные для загрузки изображения или null при ошибке
     */
    public async marusiaGetPictureUploadLink(): Promise<IMarusiaApiPictureUpdateLink | null> {
        return await this.call<IMarusiaApiPictureUpdateLink>('marusia.getPictureUploadLink');
    }

    /**
     * Сохраняет загруженное изображение в Марусе
     * @param photo Идентификатор загруженного изображения
     * @param server Идентификатор сервера загрузки
     * @param hash Хэш-сумма для проверки изображения
     *
     * @remarks
     * После успешного сохранения изображение становится доступным в навыке
     * и может быть использовано в карточках и других элементах интерфейса.
     *
     * @example
     * ```ts
     * // Полный процесс загрузки и сохранения изображения.
     * // Поля photo/server/hash у IVkUploadFile опциональны —
     * // после проверки upload сохраняем их в константы-строки
     * const uploadLink = await marusia.marusiaGetPictureUploadLink();
     * if (uploadLink) {
     *   const upload = await marusia.upload(uploadLink.picture_upload_link, 'image.jpg', 'photo');
     *   if (upload?.photo && upload?.server && upload?.hash) {
     *     const photo: string = upload.photo;
     *     const server: string = upload.server;
     *     const hash: string = upload.hash;
     *     const picture = await marusia.marusiaSavePicture(photo, server, hash);
     *     if (picture) {
     *       console.log('ID изображения:', picture.id);
     *     }
     *   }
     * }
     * ```
     *
     * @returns {Promise<IMarusiaApiSavePicture | null>} Результат сохранения или null при ошибке
     */
    public async marusiaSavePicture(
        photo: string,
        server: string,
        hash: string,
    ): Promise<IMarusiaApiSavePicture | null> {
        this._request.post = {
            photo,
            server,
            hash,
        };
        return await this.call<IMarusiaApiSavePicture>('marusia.savePicture');
    }

    /**
     * Удаляет загруженное изображение из Маруси
     * @param id Идентификатор загруженного изображения
     *
     * @returns {Promise<IMarusiaApiRemove | null>} Результат удаления или null при ошибке
     */
    public async marusiaDeletePicture(id: string): Promise<IMarusiaApiRemove | null> {
        this._request.post = {
            id,
        };
        return await this.call<IMarusiaApiRemove>('marusia.deletePicture');
    }

    /**
     * Получает список всех изображений из навыка
     *
     * @remarks
     * Метод возвращает информацию о всех изображениях, загруженных в навык:
     * - id: уникальный идентификатор изображения
     * - url: URL для доступа к изображению
     * - preview_url: URL превью изображения
     * - created: дата создания (Unix timestamp)
     *
     * @example
     * ```ts
     * // Получение списка изображений. Метод возвращает Promise<unknown> —
     * // структура items аналогична Алисе, поэтому приводим тип явно.
     * const pictures = await marusia.marusiaGetPictures();
     * if (pictures) {
     *   const pics = pictures as { items: IMarusiaImage[] };
     *   pics.items.forEach(picture => {
     *     console.log('ID:', picture.id);
     *     console.log('URL:', picture.url);
     *     console.log('Превью:', picture.preview_url);
     *   });
     * }
     * ```
     *
     * @returns {Promise<unknown>} Ответ API Маруси (структура items аналогична Алисе) или null при ошибке
     */
    public async marusiaGetPictures(): Promise<unknown> {
        return await this.call('marusia.getPictures');
    }

    /**
     * Запрашивает URL для загрузки аудиофайла на сервера Маруси
     *
     * @remarks
     * Поддерживаемые форматы аудио:
     * - MP3
     * - Максимальный размер: 10MB
     * - Максимальная длительность: 5 минут
     * - Рекомендуемый битрейт: 128 kbps
     *
     * @example
     * ```ts
     * // Получение URL для загрузки
     * const uploadLink = await marusia.marusiaGetAudioUploadLink();
     * if (uploadLink) {
     *   // Загрузка аудио
     *   const upload = await marusia.upload(uploadLink.audio_upload_link, 'audio.mp3');
     *   if (upload) {
     *     console.log('Аудио загружено:', upload);
     *   }
     * }
     * ```
     *
     * @returns {Promise<IMarusiaApiAudioUpdateLink | null>} Данные для загрузки аудио или null при ошибке
     */
    public async marusiaGetAudioUploadLink(): Promise<IMarusiaApiAudioUpdateLink | null> {
        return await this.call<IMarusiaApiAudioUpdateLink>('marusia.getAudioUploadLink');
    }

    /**
     * Сохраняет загруженный аудиофайл в Марусе
     * @param audio_meta Метаданные аудиофайла после загрузки
     *
     * @remarks
     * После успешного сохранения аудиофайл становится доступным в навыке
     * и может быть использован в голосовых ответах.
     *
     * @example
     * ```ts
     * // Полный процесс загрузки и сохранения аудио
     * const uploadLink = await marusia.marusiaGetAudioUploadLink();
     * if (uploadLink) {
     *   const upload = await marusia.upload(uploadLink.audio_upload_link, 'audio.mp3');
     *   if (upload) {
     *     const audio = await marusia.marusiaCreateAudio(upload);
     *     if (audio) {
     *       console.log('ID аудио:', audio.id);
     *       console.log('URL аудио:', audio.url);
     *     }
     *   }
     * }
     * ```
     *
     * @returns {Promise<IMarusiaApiCreateAudio | null>} Результат сохранения или null при ошибке
     */
    public async marusiaCreateAudio(audio_meta: object): Promise<IMarusiaApiCreateAudio | null> {
        this._request.post = {
            audio_meta: JSON.stringify(audio_meta),
        };
        return await this.call<IMarusiaApiCreateAudio>('marusia.createAudio');
    }

    /**
     * Удаляет загруженный аудиофайл из Маруси
     * @param id Идентификатор загруженного аудиофайла
     *
     * @returns {Promise<IMarusiaApiRemove | null>} Результат удаления или null при ошибке
     */
    public async marusiaDeleteAudio(id: string): Promise<IMarusiaApiRemove | null> {
        this._request.post = {
            id,
        };
        return await this.call<IMarusiaApiRemove>('marusia.deleteAudio');
    }

    /**
     * Пишет информацию об ошибках через AppContext.logError (структурированный логгер)
     * @param error Текст ошибки для логирования
     */
    protected _log(error: Error | string = ''): void {
        this._appContext.logError(getErrorMsg(error, 'MarusiaRequest', this._request.url), {
            error: this._error,
        });
    }
}
