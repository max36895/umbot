#!/usr/bin/env node
'use strict';
/**
 * cli универсального фреймворка umbot для создания голосовых навыков и чат-ботов для различных платформ.
 * Скрипт позволяет создавать готовые шаблоны для вашего приложения.
 * @version 3.1.2
 * @author Maxim-M maximco36895@yandex.ru
 * @module
 */

const path = require('node:path');
const consoleController = require(path.join(__dirname, 'controllers', 'ConsoleController.js'));
const utils = require(path.join(__dirname, 'utils.js')).utils;

const argv = process.argv;

const param = {};
if (argv[2]) {
    param.command = argv[2].toLowerCase();
    param.hostname = '0.0.0.0';
    param.port = 3000;
    if (argv[3]) {
        if (argv[3].endsWith('.json')) {
            if (utils.isFile(argv[3])) {
                try {
                    const jsonParam = JSON.parse(utils.fread(argv[3]));
                    // Проверяем name сразу при парсинге — с понятным сообщением.
                    if (!jsonParam.name) {
                        console.error(
                            `В JSON файле "${argv[3]}" отсутствует поле "name" (имя проекта).`,
                        );
                        process.exit(1);
                    }
                    param.appName = jsonParam.name;
                    param.params = jsonParam;
                    if (jsonParam.hostname) {
                        param.hostname = jsonParam.hostname;
                    }
                    if (jsonParam.port) {
                        param.port = jsonParam.port;
                    }
                } catch (e) {
                    console.error(`Ошибка чтения JSON файла: ${e.message}`);
                    process.exit(1);
                }
            } else {
                console.error(`Файл не найден: ${argv[3]}`);
                process.exit(1);
            }
        } else {
            param.appName = argv[3];
        }
    }
}
(async () => {
    try {
        await consoleController.main(param, argv);
    } catch (e) {
        console.error(`Ошибка: ${e.message}`);
        process.exit(1);
    }
})();
