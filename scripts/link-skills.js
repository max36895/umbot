#!/usr/bin/env node
'use strict';
/**
 * Связывает `.claude/skills` с `.agents/skills`.
 *
 * Единственный источник скилов проекта — `.agents/skills`. Claude Code читает скилы только из
 * `.claude/skills`, поэтому при установке зависимостей создаётся связь между каталогами:
 * junction на Windows, симлинк на Linux/macOS. В git связь не попадает (`.claude/` в .gitignore).
 *
 * Запускается хуком `prepare` (npm выполняет его при `npm i` в корне репозитория, но НЕ у тех,
 * кто ставит `umbot` как зависимость) и вручную через `npm run skills:link`.
 *
 * Скрипт безопасен по построению: он идемпотентен, не трогает настоящую папку `.claude/skills`,
 * если её кто-то создал, и никогда не роняет установку — при любой ошибке печатает подсказку
 * и завершается с кодом 0.
 *
 * @author Maxim-M <maximco36895@yandex.ru>
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, '.agents', 'skills');
const LINK_DIR = path.join(ROOT, '.claude');
const LINK = path.join(LINK_DIR, 'skills');

/**
 * Печатает подсказку, как создать связь руками, и завершает работу без ошибки.
 * @param {string} reason Причина, по которой автоматически не получилось
 */
function giveUp(reason) {
    const manual =
        process.platform === 'win32'
            ? 'mklink /J .claude\\skills .agents\\skills'
            : 'ln -s ../.agents/skills .claude/skills';
    console.warn(`[skills] ${reason}`);
    console.warn(`[skills] создайте связь вручную: ${manual}`);
    process.exit(0);
}

// Внутри node_modules хук делать ничего не должен: там нет рабочей копии репозитория.
if (ROOT.split(path.sep).includes('node_modules')) {
    process.exit(0);
}

// Нет каталога со скилами — значит это не рабочая копия (в npm-пакет `.agents/` не входит).
if (!fs.existsSync(SOURCE)) {
    process.exit(0);
}

let existing = null;
try {
    existing = fs.lstatSync(LINK);
} catch {
    // Связи ещё нет — создадим ниже.
}

if (existing) {
    if (existing.isSymbolicLink()) {
        let target = null;
        try {
            target = fs.realpathSync(LINK);
        } catch {
            // Битая связь (например, каталог переименовали) — пересоздаём.
        }
        if (target && target === fs.realpathSync(SOURCE)) {
            process.exit(0);
        }
        try {
            fs.unlinkSync(LINK);
        } catch (e) {
            giveUp(`не удалось удалить устаревшую связь .claude/skills: ${e.message}`);
        }
    } else {
        // Настоящая папка со своим содержимым — чужие файлы не трогаем.
        giveUp('.claude/skills — обычная папка, а не связь; оставляю как есть');
    }
}

try {
    fs.mkdirSync(LINK_DIR, { recursive: true });
    if (process.platform === 'win32') {
        // junction не требует прав администратора, в отличие от symlink на Windows
        fs.symlinkSync(SOURCE, LINK, 'junction');
    } else {
        fs.symlinkSync(path.relative(LINK_DIR, SOURCE), LINK, 'dir');
    }
    console.log('[skills] .claude/skills → .agents/skills');
} catch (e) {
    giveUp(`не удалось создать связь .claude/skills: ${e.message}`);
}
