/**
 * Бюджет лимита отправки MAX при загрузке медиа.
 *
 * Загрузка незакэшированной картинки или аудио — лишний вызов Bot API (POST /uploads):
 * он резервируется слотом лимита (consumeUploadRate), иначе рассылка медиа с лимитом
 * 30 сообщений/с удваивает число вызовов API и ловит 429.
 */
import { Bot, BaseBotController, ISoundInfo } from '../../../src';
import { MaxAdapter, MaxRequest, MaxSound, T_MAX_APP } from '../../../src/plugins';

// Локальные пути картинок и звуков не существуют: мокаем проверки файлов,
// реальную загрузку подменяет спайн MaxRequest.upload.
jest.mock('../../../src/utils/standard/util', () => ({
    ...jest.requireActual('../../../src/utils/standard/util'),
    isFile: jest.fn().mockResolvedValue(true),
    isFileSync: jest.fn().mockReturnValue(true),
}));

const json =
    (data: unknown, status = 200) =>
    (): Promise<Response> =>
        Promise.resolve(Response.json(data, { status }));

function makeBot(): { bot: Bot; messageTimes: number[] } {
    const bot = new Bot();
    bot.setLogger({ log: () => {}, error: () => {}, warn: () => {} });
    const messageTimes: number[] = [];
    bot.getAppContext().httpClient = async (url): Promise<Response> => {
        if (String(url).includes('messages')) {
            messageTimes.push(Date.now());
        }
        return json({ message: { body: { mid: 'm1' } } })();
    };
    bot.use(new MaxAdapter('max-token', { send_rate_limit: 10 }));
    return { bot, messageTimes };
}

describe('Лимит отправки MAX учитывает загрузку медиа', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('карточка с незакэшированной картинкой занимает дополнительный слот', async () => {
        const { bot, messageTimes } = makeBot();
        jest.spyOn(MaxRequest.prototype, 'upload').mockResolvedValue({ token: 'img-token' });

        const withCard = new BaseBotController(bot.getAppContext());
        withCard.text = 'Смотрите';
        withCard.card.addImage('/pic.jpg', 'Фото');
        const plain = new BaseBotController(bot.getAppContext());
        plain.text = 'Просто текст';

        await bot.send(1, withCard, T_MAX_APP);
        await bot.send(3, plain, T_MAX_APP);

        expect(messageTimes).toHaveLength(2);
        // Слоты: сама отправка (100 мс) + 1 слот загрузки = не меньше ~200 мс
        expect((messageTimes[1] as number) - (messageTimes[0] as number)).toBeGreaterThanOrEqual(
            180,
        );
    });

    it('загрузка аудио занимает дополнительный слот', async () => {
        const { bot, messageTimes } = makeBot();
        jest.spyOn(MaxRequest.prototype, 'upload').mockResolvedValue({ token: 'audio-token' });

        await bot.send(1, 'первая', T_MAX_APP);
        const ctx = new BaseBotController(bot.getAppContext());
        ctx.userId = 2;
        const soundInfo: ISoundInfo = {
            usedStandardSound: false,
            text: '',
            sounds: [{ key: '#sound1#', path: '', sounds: ['/a.mp3'] }],
        };
        await MaxSound.soundProcessing(soundInfo, ctx);
        await bot.send(3, 'вторая', T_MAX_APP);

        expect(messageTimes).toHaveLength(2);
        expect((messageTimes[1] as number) - (messageTimes[0] as number)).toBeGreaterThanOrEqual(
            180,
        );
    });
});
