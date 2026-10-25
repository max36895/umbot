import { join } from 'node:path';
import {
    AppContext,
    UsersData,
    isFileSync,
    unlinkSync,
    saveDataSync,
    IQueryData,
    ImageTokens,
    SoundTokens,
} from '../../src';

import { FileAdapter, MongoAdapter, T_ALISA, T_TELEGRAM, TFileData } from '../../src/plugins';

const FILE_NAME = 'UsersData.json';
const MONGO_TIMEOUT = 3000; // 3 секунды для операций с MongoDB
const appContext = new AppContext();
appContext.setLogger({
    error: () => {},
    warn: () => {},
});

const FILE_PATH = join(__dirname, FILE_NAME);

const imageData: TFileData = {
    123: {
        imageToken: '123',
        path: 'path1',
        platform: T_ALISA,
    },
    456: {
        imageToken: '456',
        path: 'path2',
        platform: T_ALISA,
    },
    789: {
        imageToken: '789',
        path: 'path2',
        platform: T_TELEGRAM,
    },
};

const soundData: TFileData = {
    123: {
        soundToken: '123',
        path: 'path1',
        platform: T_ALISA,
    },
    456: {
        soundToken: '456',
        path: 'path2',
        platform: T_ALISA,
    },
    789: {
        soundToken: '789',
        path: 'path2',
        platform: T_TELEGRAM,
    },
};

describe('Db file connect', () => {
    let data: Record<string, Record<string, unknown>>;
    const userData = new UsersData(appContext);

    beforeEach(async () => {
        unlinkSync(FILE_PATH);
        const fileAdapter = new FileAdapter();

        // Грубый мок для того, чтобы мы явно не читали и не писали никакой файл, так как это в тесте проверять не нужно.
        fileAdapter.getFileData = (tableName: string): TFileData => {
            fileAdapter.setCachedFileData(tableName, {
                data:
                    tableName === 'ImageTokens'
                        ? imageData
                        : tableName === 'SoundTokens'
                          ? soundData
                          : data,
                version: Date.now(),
                isFileRead: true,
            });
            return tableName === 'ImageTokens'
                ? imageData
                : tableName === 'SoundTokens'
                  ? soundData
                  : data;
        };
        appContext.saveFileData = jest.fn();

        fileAdapter.init(appContext);
        fileAdapter.connect();
        appContext.platformParams.utm_text = '';
        appContext.appConfig.json = __dirname;
        appContext.setLogger({
            error: () => {},
            warn: () => {},
        });
        data = {
            userId1: {
                userId: 'userId1',
                meta: 'user meta 1',
                data: {
                    name: 'user 1',
                },
            },
            userId2: {
                userId: 'userId2',
                meta: 'user meta 2',
                data: {
                    name: 'user 2',
                },
            },
            userId3: {
                userId: 'userId3',
                meta: 'user meta 3',
                data: {
                    name: 'user 3',
                },
            },
            userId13: {
                userId: 'userId13',
                meta: 'user meta 1',
                data: {
                    name: 'user 3',
                },
            },
        };
    });
    afterEach(() => {
        (appContext.saveFileData as jest.Mock).mockClear();
        userData.destroy();
        unlinkSync(FILE_PATH);
        appContext.close();
    });

    it('Where string', async () => {
        let query = '`userId`="userId1"';
        let uData = (await userData.where(query)).data as Record<string, unknown>[];
        expect(uData.length === 1).toBe(true);
        expect(uData[0]).toEqual(data.userId1);

        query = '`userId`="userId13" AND `meta`="user meta 1"';
        uData = (await userData.where(query)).data as Record<string, unknown>[];
        expect(uData.length === 1).toBe(true);
        expect(uData[0]).toEqual(data.userId13);

        query = '`meta`="user meta 1"';
        uData = (await userData.where(query)).data as Record<string, unknown>[];
        expect(uData.length === 2).toBe(true);
        expect(uData[0]).toEqual(data.userId1);
        expect(uData[1]).toEqual(data.userId13);

        query = '`userId`="NotFound"';
        expect((await userData.where(query)).status).toBe(false);
    });
    it('Where object', async () => {
        let query: IQueryData = {
            userId: 'userId1',
        };
        let uData = (await userData.where(query)).data as Record<string, unknown>[];
        expect(uData.length === 1).toBe(true);
        expect(uData[0]).toEqual(data.userId1);

        query = {
            userId: 'userId13',
            meta: 'user meta 1',
        };
        uData = (await userData.where(query)).data as Record<string, unknown>[];
        expect(uData.length === 1).toBe(true);
        expect(uData[0]).toEqual(data.userId13);

        query = {
            meta: 'user meta 1',
        };
        uData = (await userData.where(query)).data as Record<string, unknown>[];
        expect(uData.length === 2).toBe(true);
        expect(uData[0]).toEqual(data.userId1);
        expect(uData[1]).toEqual(data.userId13);

        query = {
            userId: 'NotFound',
        };
        expect((await userData.where(query)).status === false).toBe(true);
    });

    it('Where one', async () => {
        let query = '`userId`="userId1"';
        expect(await userData.whereOne(query)).toBe(true);
        expect(userData.data).toEqual(data.userId1.data);

        query = '`userId`="userId13" AND `meta`="user meta 1"';
        expect(await userData.whereOne(query)).toBe(true);
        expect(userData.data).toEqual(data.userId13.data);

        query = '`userId`="NotFound"';
        expect(await userData.whereOne(query)).toBe(false);
    });
    it('Where one Object', async () => {
        let query: IQueryData = {
            userId: 'userId1',
        };
        expect(await userData.whereOne(query)).toBe(true);
        expect(userData.data).toEqual(data.userId1.data);

        query = {
            userId: 'userId13',
            meta: 'user meta 1',
        };
        expect(await userData.whereOne(query)).toBe(true);
        expect(userData.data).toEqual(data.userId13.data);

        query = {
            userId: 'NotFound',
        };
        expect(await userData.whereOne(query)).toBe(false);
    });

    it('Delete data', async () => {
        const query = '`userId`="userId1"';
        userData.userId = 'userId1';
        expect(await userData.remove()).toBe(true);

        expect(await userData.whereOne(query)).toBe(false);
    });

    it('Update data', async () => {
        const query = '`meta`="meta"';
        expect(await userData.whereOne(query)).toBe(false);
        userData.userId = 'userId1';
        userData.meta = 'meta';
        expect(await userData.update()).toBe(true);

        expect(await userData.whereOne(query)).toBe(true);
    });

    it('частичный update() не стирает незаданные поля модели', async () => {
        const original = { ...imageData[123] };
        try {
            const partial = new ImageTokens(appContext);
            partial.state = { imageToken: '123', path: 'path-new' } as ImageTokens['state'];
            expect(await partial.update()).toBe(true);
            expect(imageData[123]).toEqual({
                imageToken: '123',
                path: 'path-new',
                platform: T_ALISA,
            });
        } finally {
            imageData[123] = original;
        }
    });

    it('add() с занятым ключом возвращает false и не перезаписывает запись', async () => {
        const duplicate = new ImageTokens(appContext);
        duplicate.state = { imageToken: '456', path: 'other', platform: T_TELEGRAM };
        expect(await duplicate.add()).toBe(false);
        expect(imageData[456]).toEqual({ imageToken: '456', path: 'path2', platform: T_ALISA });
    });

    it('Save data', async () => {
        const query = '`meta`="meta"';
        expect(await userData.whereOne(query)).toBe(false);
        userData.userId = 'userId5';
        userData.meta = 'meta';
        userData.data = { name: 'user 5' };
        expect(await userData.save()).toBe(true);
        expect(await userData.whereOne(query)).toBe(true);
        expect(userData.userId === 'userId5').toBe(true);
        expect(userData.data).toEqual({ name: 'user 5' });
    });

    it('Delete file db', () => {
        const filePatch = __dirname + '/' + FILE_NAME;
        expect(isFileSync(filePatch)).toBe(false);
        saveDataSync(
            {
                path: __dirname,
                fileName: FILE_NAME,
            },
            '{}',
        );
        expect(isFileSync(filePatch)).toBe(true);
        unlinkSync(filePatch);
        expect(isFileSync(filePatch)).toBe(false);
    });

    it('image tokens search', async () => {
        const imageTokens = new ImageTokens(appContext);
        imageTokens.platform = T_ALISA;
        await imageTokens.whereOne({ path: 'path1' });
        expect(imageTokens.imageToken).toBe('123');
        await imageTokens.whereOne({ path: 'path2', platform: T_ALISA });
        expect(imageTokens.imageToken).toBe('456');
        await imageTokens.whereOne({ path: 'path2', platform: T_TELEGRAM });
        expect(imageTokens.imageToken).toBe('789');
    });

    it('sound tokens search', async () => {
        const soundTokens = new SoundTokens(appContext);
        soundTokens.platform = T_ALISA;
        await soundTokens.whereOne({ path: 'path1' });
        expect(soundTokens.soundToken).toBe('123');
        await soundTokens.whereOne({ path: 'path2', platform: T_ALISA });
        expect(soundTokens.soundToken).toBe('456');
        await soundTokens.whereOne({ path: 'path2', platform: T_TELEGRAM });
        expect(soundTokens.soundToken).toBe('789');
    });
});

describe('MongoAdapter.validate', () => {
    it('не превращает отсутствующее числовое поле в NaN', () => {
        const adapter = new MongoAdapter();
        const result = adapter.validate(
            {
                query: null,
                data: null,
                tableName: 'Custom',
                primaryKeyName: null,
                rules: [{ name: ['count'], type: 'integer' }],
            },
            { title: 'без count' },
        );

        expect(result).toEqual({ title: 'без count' });
        expect(result).not.toHaveProperty('count');
    });
});

describe('Db is MongoDb', () => {
    let usersData: UsersData;
    let isConnected: boolean;

    beforeEach(async () => {
        const mongoAdapter = new MongoAdapter();
        mongoAdapter.init(appContext);
        //appContext.setIsSaveDb(true);
        appContext.setAppConfig({
            db: {
                host: 'mongodb://127.0.0.1:27017/',
                database: 'test',
                options: {
                    timeoutMS: 1000,
                    serverSelectionTimeoutMS: 500, // Таймаут на выбор сервера
                    connectTimeoutMS: 500,
                    socketTimeoutMS: 500,
                },
            },
            tokens: {},
        });
        appContext.setLogger({
            error: () => {
                // если подключения к бд нет, то не нужно писать ошибки в лог
            },
        });
        usersData = new UsersData(appContext);
    }, MONGO_TIMEOUT);

    afterEach(async () => {
        if (usersData) {
            await usersData.destroy();
        }
        appContext.setAppConfig({ db: undefined, tokens: {} });
        //appContext.setIsSaveDb(false);
    }, MONGO_TIMEOUT);

    it(
        'Should handle MongoDB connection',
        async () => {
            const isCon = isConnected ?? (await usersData.isConnected());
            // Если БД недоступна, пропускаем тест
            if (isCon) {
                expect(isCon).toBe(true);
            } else {
                isConnected = false;
            }
        },
        MONGO_TIMEOUT,
    );

    it(
        'MongoDb Save data',
        async () => {
            const isCon = isConnected ?? (await usersData.isConnected());
            // Если БД недоступна, пропускаем тест
            if (isCon) {
                usersData.userId = 'test';
                usersData.platform = T_ALISA;
                usersData.data = {};
                usersData.meta = {};

                expect(await usersData.save()).toBe(true);
                expect(await usersData.whereOne({ userId: 'test' })).toBe(true);
            } else {
                isConnected = false;
            }
        },
        MONGO_TIMEOUT,
    );

    it(
        'MongoDb Update data',
        async () => {
            const isCon = isConnected ?? (await usersData.isConnected());
            // Если БД недоступна, пропускаем тест
            if (isCon) {
                usersData.userId = 'test';
                usersData.platform = T_ALISA;
                usersData.data = 'data';
                usersData.meta = {};

                expect(await usersData.save()).toBe(true);
                expect(await usersData.whereOne({ data: 'data' })).toBe(true);
            } else {
                isConnected = false;
            }
        },
        MONGO_TIMEOUT,
    );

    it(
        'MongoDb Remove data',
        async () => {
            const isCon = isConnected ?? (await usersData.isConnected());
            // Если БД недоступна, пропускаем тест
            if (isCon) {
                usersData.userId = 'test';
                usersData.platform = T_ALISA;
                usersData.data = 'data';
                usersData.meta = {};

                expect(await usersData.remove()).toBe(true);
                expect(await usersData.whereOne({ userId: 'test' })).toBe(false);
            } else {
                isConnected = false;
            }
        },
        MONGO_TIMEOUT,
    );
});
