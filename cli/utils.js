'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Проверяет, что .env указан в .gitignore проекта.
 * @param {string} cwd Каталог проекта
 * @returns {boolean} true, если правило для .env найдено
 */
function isEnvIgnored(cwd) {
    const gitignore = path.join(cwd, '.gitignore');
    if (!fs.existsSync(gitignore)) {
        return false;
    }
    return fs
        .readFileSync(gitignore, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .some((line) => ['.env', '/.env', '.env*', '*.env', '.env.*'].includes(line));
}

/**
 * Метод используется для проверки существования файла.
 * @param file
 * @returns {boolean}
 */
function isFile(file) {
    try {
        const stat = fs.lstatSync(file);
        return stat.isFile();
    } catch {
        return false;
    }
}

/**
 * Метод используется для проверки существования папки.
 * @param file
 * @returns {boolean}
 */
function isDir(file) {
    try {
        const stat = fs.lstatSync(file);
        return stat.isDirectory();
    } catch {
        return false;
    }
}

/**
 * Метод используется для чтения содержимого файла.
 * @param fileName
 * @returns {string}
 */
function read(fileName) {
    return fs.readFileSync(fileName, 'utf-8');
}

/**
 * Метод используется для записи в файл.
 * @param fileName
 * @param fileContent
 * @param mode
 */
function write(fileName, fileContent, mode = 'w') {
    if (mode === 'w') {
        fs.writeFileSync(fileName, fileContent);
    } else {
        fs.appendFileSync(fileName, fileContent);
    }
}

/**
 * Методы для работы с файлами.
 */
exports.utils = {
    /**
     * Метод используется для проверки существования файла.
     * @param file
     * @returns {boolean}
     */
    isFile,
    /**
     * Метод используется для проверки существования папки.
     * @param file
     * @returns {boolean}
     */
    isDir,
    /**
     * Метод используется для чтения содержимого файла.
     * @param fileName
     * @returns {string}
     */
    read,
    /**
     * Метод используется для записи в файл.
     * @param fileName
     * @param fileContent
     * @param mode
     */
    write,
    /**
     * Проверяет, что .env указан в .gitignore проекта.
     * @param {string} cwd Каталог проекта
     * @returns {boolean}
     */
    isEnvIgnored,
};
