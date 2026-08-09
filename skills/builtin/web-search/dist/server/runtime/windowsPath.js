"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeWindowsPowerShellPath = normalizeWindowsPowerShellPath;
exports.formatWindowsPowerShellMissingMessage = formatWindowsPowerShellMissingMessage;
exports.isWindowsPowerShellMissingError = isWindowsPowerShellMissingError;
const fs_1 = require("fs");
const path_1 = require("path");
const WINDOWS_POWERSHELL_RELATIVE_PATH = path_1.win32.join('System32', 'WindowsPowerShell', 'v1.0');
function resolvePathKey(env) {
    const existingKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
    return existingKey || 'Path';
}
function splitPathList(value) {
    return (value || '')
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean);
}
function normalizePathForComparison(value) {
    return value.replace(/[\\/]+$/, '').toLowerCase();
}
function getCandidateDirectories(env) {
    const candidates = [
        env.SystemRoot ? path_1.win32.join(env.SystemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH) : '',
        env.WINDIR ? path_1.win32.join(env.WINDIR, WINDOWS_POWERSHELL_RELATIVE_PATH) : '',
        path_1.win32.join('C:\\Windows', WINDOWS_POWERSHELL_RELATIVE_PATH),
    ];
    const seen = new Set();
    return candidates.filter((candidate) => {
        if (!candidate) {
            return false;
        }
        const normalized = normalizePathForComparison(candidate);
        if (seen.has(normalized)) {
            return false;
        }
        seen.add(normalized);
        return true;
    });
}
function normalizeWindowsPowerShellPath(options = {}) {
    const platform = options.platform || process.platform;
    if (platform !== 'win32') {
        return false;
    }
    const env = options.env || process.env;
    const exists = options.exists || fs_1.existsSync;
    const pathKey = resolvePathKey(env);
    const currentItems = splitPathList(env[pathKey]);
    const currentItemSet = new Set(currentItems.map(normalizePathForComparison));
    const missingCandidates = getCandidateDirectories(env).filter((candidate) => {
        return exists(candidate) && !currentItemSet.has(normalizePathForComparison(candidate));
    });
    if (missingCandidates.length === 0) {
        return false;
    }
    env[pathKey] = [...missingCandidates, ...currentItems].join(';');
    return true;
}
function formatWindowsPowerShellMissingMessage(originalMessage) {
    return [
        originalMessage,
        'Windows PowerShell executable was not found in PATH.',
        'Add %SystemRoot%\\System32\\WindowsPowerShell\\v1.0 to PATH or restart BizOwl after environment repair.',
    ].join(' ');
}
function isWindowsPowerShellMissingError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /spawn powershell(?:\.exe)? ENOENT/i.test(message);
}
