import { YandexRequest } from './YandexRequest';
import { AppContext, fwrite } from '../../../index';
import { join } from 'node:path';

/**
 * Интерфейс для результатов синтеза речи
 */
export interface ITTSResult {
    /**
     * Имя файла
     */
    fileName: string;
    /**
     * Бинарные данные аудио
     */
    audioData: ArrayBuffer;
}

/**
 * Класс отвечающий за преобразование текста в аудио файл.
 * Преобразование осуществляется через сервис Yandex SpeechKit.
 * @see https://cloud.yandex.ru/docs/speechkit/tts/request
 *
 * @example
 * ```ts
 * import { YandexSpeechKit } from 'umbot/plugins';
 *
 * // Создание экземпляра (appContext обязателен). Токен — API-ключ сервисного
 * // аккаунта (уйдёт как `Api-Key ...`) или IAM-токен `t1....` (уйдёт как `Bearer ...`).
 * // OAuth-токен Яндекс.Диалогов SpeechKit не принимает.
 * const speechKit = new YandexSpeechKit('your-api-key', appContext);
 *
 * // Настройка параметров синтеза
 * speechKit.lang = YandexSpeechKit.L_RU;     // Русский язык
 * speechKit.voice = YandexSpeechKit.V_JANE;  // Голос Jane
 * speechKit.emotion = YandexSpeechKit.E_GOOD; // Доброжелательная интонация
 * speechKit.speed = 1.2;                     // Скорость речи
 * speechKit.format = YandexSpeechKit.F_OGGOPUS; // Формат OGG/OPUS
 *
 * try {
 *   // Пример с омографами и паузами
 *   const text = 'Я гот+ов - начать работу';
 *   const audio = await speechKit.getTts(text);
 *
 *   // Сохранение или воспроизведение аудио
 *   // audio содержит бинарные данные в выбранном формате
 * } catch (error) {
 *   console.error('Ошибка синтеза речи:', error);
 * }
 * ```
 *
 * @group API платформ
 */
export class YandexSpeechKit extends YandexRequest {
    /**
     * Адрес, на который будет отправляться запрос
     */
    public static readonly TTS_API_URL =
        'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize';

    /**
     * Положительная интонация
     */
    public static readonly E_GOOD = 'good';
    /**
     * Отрицательная интонация
     */
    public static readonly E_EVIL = 'evil';
    /**
     * Нейтральная интонация
     */
    public static readonly E_NEUTRAL = 'neutral';

    /**
     * Голос для синтеза речи Оксана (ru)
     */
    public static readonly V_OKSANA = 'oksana';
    /**
     * Голос для синтеза речи Джейн (ru)
     */
    public static readonly V_JANE = 'jane';
    /**
     * Голос для синтеза речи Омаж (ru)
     */
    public static readonly V_OMAZH = 'omazh';
    /**
     * Голос для синтеза речи Захар (ru)
     */
    public static readonly V_ZAHAR = 'zahar';
    /**
     * Голос для синтеза речи Ермил (ru)
     */
    public static readonly V_ERMIL = 'ermil';
    /**
     * Голос для синтеза речи Сила Эркан (tr)
     */
    public static readonly V_SILAERKAN = 'silaerkan';
    /**
     * Голос для синтеза речи Эркан Яваш (tr)
     */
    public static readonly V_ERKANYAVAS = 'erkanyavas';
    /**
     * Голос для синтеза речи Элис (en)
     */
    public static readonly V_ALYSS = 'alyss';
    /**
     * Голос для синтеза речи Ник (en)
     */
    public static readonly V_NICK = 'nick';
    /**
     * Голос для синтеза речи Алена (ru)
     */
    public static readonly V_ALENA = 'alena';
    /**
     * Голос для синтеза речи Филипп (ru)
     */
    public static readonly V_FILIPP = 'filipp';
    /**
     * Голос для синтеза речи Киркоров (ru)
     */
    public static readonly V_KIRKOROV = 'kirkorov';
    /**
     * Голос для синтеза речи Лера (ru)
     */
    public static readonly V_LERA = 'lera';
    /**
     * Голос для синтеза речи Мадуса (ru)
     */
    public static readonly V_MADUSA = 'madusa';

    /**
     * Русский язык
     */
    public static readonly L_RU = 'ru-RU';
    /**
     * Английский язык
     */
    public static readonly L_EN = 'en-US';
    /**
     * Турецкий язык
     */
    public static readonly L_TR = 'tr-TR';

    /**
     * Формат файла lpcm
     * @see format
     */
    public static readonly F_LPCM = 'lpcm';
    /**
     * Формат файла oggopus
     * @see format
     */
    public static readonly F_OGGOPUS = 'oggopus';

    /**
     * Текст для озвучивания в кодировке UTF-8
     * Для передачи слов-омографов используйте + перед ударной гласной
     * Например: гот+ов или def+ect
     * Для паузы между словами используйте -
     * Максимальная длина: 5000 символов
     */
    public text: string | undefined;

    /**
     * Язык синтеза речи
     * ru-RU (по умолчанию) - русский
     * en-US - английский
     * tr-TR - турецкий
     */
    public lang: string;

    /**
     * Голос для синтеза речи
     * По умолчанию: oksana
     * @see V_OKSANA, V_JANE, V_OMAZH и другие константы
     */
    public voice: string;

    /**
     * Эмоциональная окраска голоса.
     * Отправляется для всех русских голосов; платформа документирует поддержку
     * эмоций только для jane/omazh — для остальных голосов поле может игнорироваться API
     * good - доброжелательный
     * evil - злой
     * neutral (по умолчанию) - нейтральный
     */
    public emotion: string;

    /**
     * Скорость синтеза речи
     * От 0.1 до 3.0
     * 3.0 - самый быстрый
     * 1.0 (по умолчанию) - средняя скорость
     * 0.1 - самый медленный
     * При выходе за диапазон 0.1–3.0 значение молча сбрасывается к 1.0
     * Не поддерживается для премиум-голосов (alena, filipp, kirkorov, lera, madusa)
     */
    public speed: number;

    /**
     * Формат синтезируемого аудио
     * lpcm - без WAV-заголовка
     * oggopus (по умолчанию) - OGG контейнер с OPUS кодеком
     */
    public format: string;

    /**
     * Частота дискретизации для формата lpcm
     * Поддерживаемые значения:
     * - 48000 - 48 кГц, высокое качество (значение по умолчанию на стороне API:
     *   класс не инициализирует поле, 48000 применяет сам API)
     * - 16000 - 16 кГц, среднее качество
     * - 8000 - 8 кГц, низкое качество, подходит для телефонии
     *
     * @remarks
     * Параметр используется только при format = YandexSpeechKit.F_LPCM
     * Для format = YandexSpeechKit.F_OGGOPUS игнорируется
     */
    public sampleRateHertz: number | undefined;

    /**
     * Идентификатор каталога для авторизации.
     * Требуется только для пользовательского аккаунта
     * Максимум 50 символов
     */
    public folderId: string | number | null;

    /**
     * Создает экземпляр YandexSpeechKit
     * @param oauth API-ключ сервисного аккаунта или IAM-токен (`t1....`) Yandex Cloud
     * @param appContext Контекст приложения
     */
    public constructor(oauth: string | null = null, appContext: AppContext) {
        super(oauth, appContext);
        this.lang = YandexSpeechKit.L_RU;
        this.emotion = YandexSpeechKit.E_NEUTRAL;
        this.speed = 1.0;
        this.format = YandexSpeechKit.F_OGGOPUS;
        this.folderId = null;
        this.voice = 'oksana';
    }

    /**
     * Формирует заголовок Authorization по контракту Yandex Cloud.
     *
     * SpeechKit не принимает схему `OAuth` (её понимает только API Диалогов):
     * допустимы `Api-Key <ключ>` для API-ключа сервисного аккаунта и
     * `Bearer <IAM-токен>`. IAM-токен узнаётся по префиксу `t1.`, остальное
     * считается API-ключом. Уже заданную схему (`Api-Key ...`/`Bearer ...`)
     * передаём как есть — так можно явно указать нужную.
     *
     * @param token Токен из `speech_kit_token` / `SPEECH_KIT_TOKEN`
     * @returns Значение заголовка Authorization
     */
    protected override _getAuthorizationHeader(token: string): string {
        if (/^(Api-Key|Bearer)\s/i.test(token)) {
            return token;
        }
        return token.startsWith('t1.') ? `Bearer ${token}` : `Api-Key ${token}`;
    }

    /**
     * Инициализация параметров для отправки запроса.
     *
     * SpeechKit v1 принимает тело только в `application/x-www-form-urlencoded`
     * (на JSON отвечает 400 «unsupported content-type»), поэтому параметры
     * сериализуются в строку формы, а не отдаются Request как объект.
     */
    #initPost(): void {
        const params: Record<string, string> = {
            text: this.text ?? '',
            lang: this.lang,
            voice: this.voice,
            format: this.format,
        };
        if (
            [
                YandexSpeechKit.V_SILAERKAN,
                YandexSpeechKit.V_ERKANYAVAS,
                YandexSpeechKit.V_ALYSS,
                YandexSpeechKit.V_NICK,
            ].indexOf(this.voice) === -1
        ) {
            params.emotion = this.emotion;
        }
        if (
            this.voice !== YandexSpeechKit.V_ALENA &&
            this.voice !== YandexSpeechKit.V_FILIPP &&
            this.voice !== YandexSpeechKit.V_KIRKOROV &&
            this.voice !== YandexSpeechKit.V_LERA &&
            this.voice !== YandexSpeechKit.V_MADUSA
        ) {
            if (this.speed < 0.1 || this.speed > 3.0) {
                this.speed = 1.0;
            }
            params.speed = String(this.speed);
        }
        if (this.format === YandexSpeechKit.F_LPCM && this.sampleRateHertz) {
            params.sampleRateHertz = String(this.sampleRateHertz);
        }
        if (this.folderId) {
            params.folderId = String(this.folderId);
        }
        this._request.post = null;
        this._request.postInString = new URLSearchParams(params).toString();
        this._request.header = {
            ...(this._request.header as Record<string, string> | null),
            'Content-Type': 'application/x-www-form-urlencoded',
        };
    }

    /**
     * Получение голосового текста
     * @param text Текст для преобразования в речь
     * @returns Возвращает путь к сохраненному файлу и его бинарное содержимое
     *
     * @remarks
     * Поддерживаемые форматы:
     * - F_LPCM: RAW PCM без WAV-заголовка
     * - F_OGGOPUS: OGG контейнер с OPUS кодеком (рекомендуется)
     *
     * Особенности текста:
     * - Для омографов используйте + перед ударной гласной: гот+ов, з+амок
     * - Для паузы между словами используйте -: слово - слово
     * - Максимальная длина текста: 5000 символов
     *
     * Ограничения:
     * - Эмоции (emotion) отправляются для всех русских голосов; платформа документирует
     *   поддержку только для jane/omazh — для остальных голосов поле может игнорироваться API
     * - Скорость (speed) не поддерживается для премиум-голосов (alena, filipp, kirkorov, lera, madusa)
     *
     * Важно! после выполнения запроса, не забудьте удалить файл с результатом.
     * Файл всегда получает расширение .ogg, даже при format = F_LPCM
     * (содержимое файла — raw PCM).
     *
     * @example
     * ```ts
     * // Пример с LPCM форматом
     * speechKit.format = YandexSpeechKit.F_LPCM;
     * speechKit.sampleRateHertz = 16000;
     * const pcmAudio = await speechKit.getTts('Текст для синтеза');
     *
     * // Пример с OGG/OPUS
     * speechKit.format = YandexSpeechKit.F_OGGOPUS;
     * const oggAudio = await speechKit.getTts('Текст для синтеза');
     * ```
     *
     * @see https://cloud.yandex.ru/docs/speechkit/tts/request
     */
    public async getTts(text: string | null = null): Promise<ITTSResult | null> {
        if (text) {
            this.text = text;
        }
        this._request.url = YandexSpeechKit.TTS_API_URL;
        this._request.isConvertJson = false;
        this._request.isBinaryResponse = true;
        this.#initPost();
        const audioData = (await this.call()) as ArrayBuffer | null;
        if (!audioData) {
            return null;
        }
        const fileName = `${
            this._appContext.appConfig.error_log || join(__dirname, '..', '..', 'logs')
        }/tts_${Date.now()}_${Math.floor(Math.random() * 100)}.ogg`;
        await fwrite(fileName, new Uint8Array(audioData), 'w');
        return {
            fileName,
            audioData,
        };
    }
}
