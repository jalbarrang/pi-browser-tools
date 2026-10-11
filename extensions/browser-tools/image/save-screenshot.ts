import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

type EnvLike = Record<string, string | undefined>;

/** Default subfolder under the temp root. */
export const DEFAULT_SCREENSHOT_FOLDER = 'screenshots';

const MAX_NAME_LENGTH = 120;
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|\p{Cc}]/gu;

/** Root every saved screenshot lives under: `<agent dir>/temp`. */
export function screenshotTempRoot(): string {
  return join(getAgentDir(), 'temp');
}

/**
 * Resolve whether a screenshot should be saved. An explicit tool param wins;
 * otherwise the `WEB_SCREENSHOT_SAVE` env default applies.
 */
export function resolveSaveEnabled(param: boolean | undefined, env: EnvLike = {}): boolean {
  if (param !== undefined) {
    return param;
  }
  const raw = env.WEB_SCREENSHOT_SAVE?.trim().toLowerCase();
  return raw !== undefined && TRUTHY_VALUES.has(raw);
}

/**
 * Resolve the folder a screenshot is written to. `folder` is relative to the
 * temp root (default {@link DEFAULT_SCREENSHOT_FOLDER}); absolute paths and any
 * path that escapes the temp root are rejected.
 */
export function resolveScreenshotDir(
  folder?: string,
  rootDir: string = screenshotTempRoot(),
): string {
  const raw = folder?.trim() || DEFAULT_SCREENSHOT_FOLDER;
  if (isAbsolute(raw)) {
    throw new Error(`save_folder must be relative to ${rootDir}, got absolute path: ${raw}`);
  }

  const target = resolve(rootDir, raw);
  const rel = relative(rootDir, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`save_folder escapes the screenshot temp dir (${rootDir}): ${raw}`);
  }
  return target;
}

function sanitizeFileLabel(raw: string): string {
  return raw
    .trim()
    .replace(UNSAFE_FILENAME_CHARS, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, MAX_NAME_LENGTH);
}

function hostLabel(url: string | null): string {
  if (!url) {
    return 'page';
  }
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host || 'page';
  } catch {
    return 'page';
  }
}

function timestampLabel(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${day}-${time}`;
}

/**
 * Build the PNG file name for a screenshot. Uses `name` when provided (a `.png`
 * extension is added when missing), otherwise `<host>-<YYYYMMDD-HHmmss>.png`.
 */
export function buildScreenshotFileName(options: {
  url: string | null;
  name?: string;
  now?: Date;
}): string {
  const provided = options.name?.trim();
  if (provided) {
    const base = sanitizeFileLabel(provided.replace(/\.png$/i, ''));
    if (base) {
      return `${base}.png`;
    }
  }

  const host = sanitizeFileLabel(hostLabel(options.url)) || 'page';
  return `${host}-${timestampLabel(options.now ?? new Date())}.png`;
}

export type SavedScreenshot = {
  path: string;
  dir: string;
  fileName: string;
};

export type SaveScreenshotOptions = {
  /** Raw PNG bytes to write. */
  png: Uint8Array;
  url: string | null;
  /** Subfolder under the temp root (default `screenshots`). */
  folder?: string;
  /** Explicit file name; `.png` is appended when missing. */
  name?: string;
  /** Overrides the temp root. Intended for tests. */
  rootDir?: string;
  /** Injectable clock. Intended for tests. */
  now?: Date;
};

/**
 * Write a screenshot's raw PNG bytes under pi's temp dir and return the path.
 * Missing folders are created; an existing file with the same name is
 * overwritten.
 */
export async function saveScreenshotPng(options: SaveScreenshotOptions): Promise<SavedScreenshot> {
  const dir = resolveScreenshotDir(options.folder, options.rootDir);
  const fileName = buildScreenshotFileName({
    url: options.url,
    name: options.name,
    now: options.now,
  });

  await mkdir(dir, { recursive: true });
  const path = join(dir, fileName);
  await writeFile(path, options.png);

  return { path, dir, fileName };
}
