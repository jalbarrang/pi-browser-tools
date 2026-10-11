import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildScreenshotFileName,
  DEFAULT_SCREENSHOT_FOLDER,
  resolveSaveEnabled,
  resolveScreenshotDir,
  saveScreenshotPng,
} from '../../extensions/browser-tools/image/save-screenshot.js';

describe('resolveSaveEnabled', () => {
  test('explicit param wins over env', () => {
    expect(resolveSaveEnabled(false, { WEB_SCREENSHOT_SAVE: '1' })).toBe(false);
    expect(resolveSaveEnabled(true, {})).toBe(true);
  });

  test('falls back to WEB_SCREENSHOT_SAVE', () => {
    expect(resolveSaveEnabled(undefined, { WEB_SCREENSHOT_SAVE: 'yes' })).toBe(true);
    expect(resolveSaveEnabled(undefined, { WEB_SCREENSHOT_SAVE: 'off' })).toBe(false);
    expect(resolveSaveEnabled(undefined, {})).toBe(false);
  });
});

describe('resolveScreenshotDir', () => {
  const root = '/tmp/pi-agent-temp';

  test('defaults to the screenshots subfolder', () => {
    expect(resolveScreenshotDir(undefined, root)).toBe(join(root, DEFAULT_SCREENSHOT_FOLDER));
  });

  test('resolves nested relative folders under the root', () => {
    expect(resolveScreenshotDir('project-x/landing', root)).toBe(
      join(root, 'project-x', 'landing'),
    );
  });

  test('rejects absolute paths and escapes', () => {
    expect(() => resolveScreenshotDir('/etc', root)).toThrow(/relative/);
    expect(() => resolveScreenshotDir('../outside', root)).toThrow(/escapes/);
  });
});

describe('buildScreenshotFileName', () => {
  test('derives host and timestamp by default', () => {
    const now = new Date(2025, 9, 6, 14, 30, 12);
    expect(buildScreenshotFileName({ url: 'https://www.example.com/path', now })).toBe(
      'example.com-20251006-143012.png',
    );
  });

  test('falls back to "page" for missing or invalid URLs', () => {
    const now = new Date(2025, 0, 2, 3, 4, 5);
    expect(buildScreenshotFileName({ url: null, now })).toBe('page-20250102-030405.png');
    expect(buildScreenshotFileName({ url: 'not a url', now })).toBe('page-20250102-030405.png');
  });

  test('uses an explicit name and appends .png when missing', () => {
    expect(buildScreenshotFileName({ url: null, name: 'checkout-flow' })).toBe(
      'checkout-flow.png',
    );
    expect(buildScreenshotFileName({ url: null, name: 'checkout-flow.png' })).toBe(
      'checkout-flow.png',
    );
  });

  test('sanitizes names with unsafe characters', () => {
    expect(buildScreenshotFileName({ url: null, name: 'a/b:c*d' })).toBe('a-b-c-d.png');
  });
});

describe('saveScreenshotPng', () => {
  test('writes the PNG bytes under the temp root and creates folders', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pi-save-screenshot-'));
    try {
      const png = Uint8Array.from([137, 80, 78, 71, 1, 2, 3]);
      const saved = await saveScreenshotPng({
        png,
        url: 'https://example.com',
        folder: 'nested/dir',
        name: 'shot',
        rootDir,
      });

      expect(saved.path).toBe(join(rootDir, 'nested', 'dir', 'shot.png'));
      expect(await readFile(saved.path)).toEqual(Buffer.from(png));
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
