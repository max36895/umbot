/**
 * Модуль для взаимодействия с API различных платформ.
 * Содержит классы для работы с:
 * - Telegram API
 * - Viber API
 * - VK API
 * - Marusia API
 * - Yandex API (основной, изображения, звуки, речь)
 *
 * Также включает базовый класс для отправки HTTP-запросов
 */
export type {
    IMarusiaApiAudioUpdateLink,
    IMarusiaApiCreateAudio,
    IMarusiaApiPictureUpdateLink,
    IMarusiaApiRemove,
    IMarusiaApiSavePicture,
    IMaxAppApi,
    IMaxAudio,
    IMaxCard,
    IMaxFile,
    IMaxParams,
    IMaxSendMessage,
    IMaxUploadFile,
    IMaxVideo,
    IViberApi,
    IViberGetUserDetails,
    IViberParams,
    IViberRichMediaParams,
    IViberSender,
    IViberUserInfo,
    IViberWebhookParams,
    IVkApi,
    IVkAudioMessage,
    IVkAudioMessageInfo,
    IVKDoc,
    IVkDocSave,
    IVkGraffiti,
    IVkParams,
    IVkParamsUsersGet,
    IVkPhotosSave,
    IVkPreview,
    IVKSendMessage,
    IVkUploadFile,
    IVkUploadServer,
    IVkUsersGet,
    IVkUsersIds,
    IYandexApi,
    IYandexCheckOutPlace,
    IYandexImagesCheckOutPlaceRequest,
    IYandexRemoveRequest,
    IYandexRequestDownloadImage,
    IYandexRequestDownloadImageRequest,
    IYandexRequestDownloadImagesRequest,
    IYandexRequestDownloadSound,
    IYandexRequestDownloadSoundRequest,
    IYandexRequestDownloadSoundsRequest,
    IYandexSoundsCheckOutPlaceRequest,
    TMaxUploadFile,
    TVkDocType,
    TVkPeerId,
} from './interfaces';
// Классы для работы с API платформ
export {
    escapeHtml,
    escapeMarkdownV2,
    prepareTelegramMessageText,
    TelegramRequest,
} from './TelegramRequest';
export type { ITelegramWarnContext } from './TelegramRequest';
export { ViberRequest } from './ViberRequest';
export { VkRequest } from './VkRequest';
export { MarusiaRequest } from './MarusiaRequest';
export { YandexImageRequest } from './YandexImageRequest';
export { YandexRequest } from './YandexRequest';
export { YandexSoundRequest } from './YandexSoundRequest';
export { YandexSpeechKit } from './YandexSpeechKit';
export type { ITTSResult } from './YandexSpeechKit';
export { MaxRequest } from './MaxRequest';
// Хелперы сообщений об ошибках API — публичны, чтобы внешние адаптеры платформ
// (umbot-<platform>-adapter) логировали ошибки в том же формате, что и встроенные.
export { getErrorMsg, getErrorToken } from './constants';
