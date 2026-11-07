/**
 * Интерфейсы компонентов, отвечающих за взаимодействие с сервером
 */
// Интерфейсы
export type {
    IViberApi,
    IViberGetUserDetails,
    IViberParams,
    IViberRichMediaParams,
    IViberSender,
    IViberUserInfo,
    IViberWebhookParams,
} from './IViberApi';
export type {
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
    TVkDocType,
    TVkPeerId,
} from './IVkApi';
export type {
    IMaxAppApi,
    IMaxAudio,
    IMaxCard,
    IMaxFile,
    IMaxParams,
    IMaxSendMessage,
    IMaxUploadFile,
    IMaxVideo,
    TMaxUploadFile,
} from './IMaxAppApi';
export type {
    IMarusiaApiAudioUpdateLink,
    IMarusiaApiCreateAudio,
    IMarusiaApiPictureUpdateLink,
    IMarusiaApiRemove,
    IMarusiaApiSavePicture,
} from './IMarusiaApi';
export type {
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
} from './IYandexApi';
