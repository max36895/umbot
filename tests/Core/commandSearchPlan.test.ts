/**
 * План поиска команд через Bot.run: индекс строковых слотов, префильтр
 * регулярок и группы. Инвариант — побеждает команда, зарегистрированная
 * раньше других, независимо от пути поиска.
 */
import { Bot, BotController, TSlots } from '../../src';
import { VkAdapter } from '../../src/plugins';

class NoopController extends BotController {
    action(): void {
        // Интенты (welcome/help) тоже не должны уходить в сеть VK.
        this.skipAutoReply = true;
    }
}

interface IHarness {
    bot: Bot;
    add(name: string, slots: TSlots, isPattern?: boolean): void;
    ask(text: string): Promise<string | null>;
}

function createHarness(groupMode: 'auto' | 'group' = 'auto'): IHarness {
    const bot = new Bot();
    bot.setLogger({ error: () => {}, warn: () => {}, log: () => {} });
    bot.use(new VkAdapter('t', { vk_load_user_info: false }));
    bot.setAppConfig({ isLocalStorage: false });
    bot.initBotController(NoopController);
    bot.setCommandGroupMode(groupMode);
    let hit: string | null = null;
    bot.addCommand('*', [], (_, ctx) => {
        hit = '*';
        ctx.skipAutoReply = true;
    });
    let id = 0;
    return {
        bot,
        add(name, slots, isPattern = false): void {
            bot.addCommand(
                name,
                slots,
                (_, ctx) => {
                    hit = name;
                    ctx.skipAutoReply = true;
                },
                isPattern,
            );
        },
        async ask(text): Promise<string | null> {
            hit = null;
            id++;
            await bot.run('vk', {
                type: 'message_new',
                group_id: 1,
                object: { message: { id, from_id: 7, peer_id: 7, text } },
            });
            return hit;
        },
    };
}

/** Добавляет N литеральных команд-заглушек: от 16 штук включается индекс. */
function addFiller(h: IHarness, count: number, prefix = 'filler'): void {
    for (let i = 0; i < count; i++) {
        h.add(`${prefix}_${i}`, [`${prefix}_слот_${i}`]);
    }
}

/** Ждёт отложенную сборку плана и групп регулярок. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 80));

describe('План поиска команд', () => {
    it('индекс подстрок: побеждает команда, зарегистрированная раньше, а не стоящая раньше в тексте', async () => {
        const h = createHarness();
        h.add('order', ['заказ']);
        addFiller(h, 20);
        h.add('delivery', ['доставка']);
        await settle();

        expect(await h.ask('доставка и заказ')).toBe('order');
        expect(await h.ask('только доставка')).toBe('delivery');
        expect(await h.ask('подскажите filler_слот_7 пожалуйста')).toBe('filler_7');
        expect(await h.ask('неизвестная фраза')).toBe('*');
    });

    it('регулярка, зарегистрированная раньше литеральной команды, побеждает её', async () => {
        const h = createHarness();
        h.add('number', [/\d{3}/]);
        addFiller(h, 20);
        h.add('text', ['код']);
        await settle();

        expect(await h.ask('код 123')).toBe('number');
        expect(await h.ask('код без цифр')).toBe('text');
    });

    it('префильтр: регулярки без обязательной подстроки проверяются всегда', async () => {
        const h = createHarness();
        for (let i = 0; i < 20; i++) {
            h.add(`re_${i}`, [new RegExp(`команда_${i}_\\d+`)]);
        }
        h.add('yes_no', [/(да|нет)/]);
        await settle();

        expect(await h.ask('команда_13_42')).toBe('re_13');
        expect(await h.ask('наверное да')).toBe('yes_no');
        expect(await h.ask('запрос_x_1')).toBe('*');
    });

    it('префильтр не теряет кандидата, когда у многих команд в тексте найдено несколько подстрок', async () => {
        const h = createHarness();
        // У каждой команды две обязательные подстроки, обе есть в тексте, но
        // регулярки не совпадают (нет цифр). Кандидатов больше, чем команд.
        for (let i = 0; i < 20; i++) {
            h.add(`noise_${i}`, [/альфа\d/, /гамма\d/]);
        }
        h.add('target', [/бета\d/]);
        await settle();

        expect(await h.ask('альфа гамма бета7')).toBe('target');
    });

    it('группы регулярок с префильтром находят нужную команду группы', async () => {
        const h = createHarness('group');
        for (let i = 0; i < 40; i++) {
            h.add(`g_${i}`, [`группа_${i}_\\d+`], true);
        }
        await settle();

        expect(await h.ask('текст группа_0_1')).toBe('g_0');
        expect(await h.ask('группа_27_9 в конце')).toBe('g_27');
        expect(await h.ask('группа_39_5')).toBe('g_39');
        expect(await h.ask('группа_40_5')).toBe('*');
    });

    it('до отложенной сборки поиск идёт простым планом, после 64 поисков строится полный', async () => {
        const h = createHarness();
        addFiller(h, 20);
        const reg = h.bot.getAppContext().command;
        // Запрос сразу после регистрации (serverless): индексы ещё не нужны.
        expect(await h.ask('подскажите filler_слот_3')).toBe('filler_3');
        expect(reg.getSearchPlan().literal).toBeNull();
        // Цикл без выхода в event loop: таймер не срабатывает, но после 64 поисков
        // полный план строится на пути запроса.
        for (let i = 0; i < 70; i++) {
            reg.getSearchPlan();
        }
        expect(reg.getSearchPlan().literal).not.toBeNull();
        expect(await h.ask('подскажите filler_слот_7')).toBe('filler_7');
    });

    it('план пересобирается после регистрации команды во время работы', async () => {
        const h = createHarness();
        addFiller(h, 20);
        await settle();
        expect(await h.ask('новая фраза')).toBe('*');

        h.add('late', ['новая']);
        expect(await h.ask('новая фраза')).toBe('late');
    });
});

describe('Перерегистрация и удаление команд', () => {
    it('перезаписанная команда не срабатывает на старую фразу и сохраняет приоритет', async () => {
        const h = createHarness();
        h.add('greet', ['котик']);
        h.add('other', ['здравствуй', 'добрый']);
        h.add('greet', ['добрый']);
        await settle();

        // Старая фраза больше не вызывает команду (ни точным, ни частичным совпадением).
        expect(await h.ask('котик')).toBe('*');
        expect(await h.ask('ну котик')).toBe('*');
        // Команда осталась на прежнем месте: при общем слоте она раньше, чем other.
        expect(await h.ask('добрый вечер')).toBe('greet');
    });

    it('перерегистрация в индексе подстрок: старый слот тоже забыт', async () => {
        const h = createHarness();
        h.add('greet', ['котик']);
        addFiller(h, 20);
        h.add('greet', ['собачка']);
        await settle();

        expect(await h.ask('ну котик')).toBe('*');
        expect(await h.ask('ну собачка')).toBe('greet');
    });

    it('перерегистрация участника группы регулярок: соседние команды группы находятся', async () => {
        const h = createHarness('group');
        h.add('g0', [/alpha\d/]);
        h.add('g1', [/beta\d/]);
        h.add('g2', [/gamma\d/]);
        h.add('g1', ['beta']);
        addFiller(h, 20);
        await settle();

        expect(await h.ask('beta1')).toBe('g1');
        expect(await h.ask('gamma1')).toBe('g2');
        expect(await h.ask('alpha1')).toBe('g0');
    });

    it('перерегистрация, отклонённая strictMode, удаляет команду', async () => {
        const h = createHarness();
        h.add('danger', ['безопасно']);
        h.bot.setAppMode('strict_prod');
        // Намеренно опасная регулярка: strictMode обязан её отклонить.
        // eslint-disable-next-line security/detect-unsafe-regex
        h.add('danger', [/(a+)+$/]);
        await settle();

        expect(await h.ask('безопасно')).toBe('*');
    });

    it('removeCommand не удаляет точное совпадение, которое принадлежит другой команде', async () => {
        const h = createHarness();
        h.add('first', ['общий']);
        h.add('second', ['общий', 'второй']);
        h.bot.removeCommand('second');
        await settle();

        expect(await h.ask('общий')).toBe('first');
        expect(await h.ask('второй')).toBe('*');
    });
});
