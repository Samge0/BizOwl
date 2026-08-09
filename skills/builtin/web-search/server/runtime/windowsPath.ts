import { existsSync } from 'fs';
import { win32 } from 'path';

export type NormalizeWindowsPowerShellPathOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
};

const WINDOWS_POWERSHELL_RELATIVE_PATH = win32.join(
  'System32',
  'WindowsPowerShell',
  'v1.0',
);

function resolvePathKey(env: NodeJS.ProcessEnv): string {
  const existingKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  return existingKey || 'Path';
}

function splitPathList(value: string | undefined): string[] {
  return (value || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePathForComparison(value: string): string {
  return value.replace(/[\\/]+$/, '').toLowerCase();
}

function getCandidateDirectories(env: NodeJS.ProcessEnv): string[] {
  const candidates = [
    env.SystemRoot ? win32.join(env.SystemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH) : '',
    env.WINDIR ? win32.join(env.WINDIR, WINDOWS_POWERSHELL_RELATIVE_PATH) : '',
    win32.join('C:\\Windows', WINDOWS_POWERSHELL_RELATIVE_PATH),
  ];

  const seen = new Set<string>();
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

export function normalizeWindowsPowerShellPath(
  options: NormalizeWindowsPowerShellPathOptions = {},
): boolean {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') {
    return false;
  }

  const env = options.env || process.env;
  const exists = options.exists || existsSync;
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

export function formatWindowsPowerShellMissingMessage(originalMessage: string): string {
  return [
    originalMessage,
    'Windows PowerShell executable was not found in PATH.',
    'Add %SystemRoot%\\System32\\WindowsPowerShell\\v1.0 to PATH or restart BizOwl after environment repair.',
  ].join(' ');
}

export function isWindowsPowerShellMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /spawn powershell(?:\.exe)? ENOENT/i.test(message);
}
