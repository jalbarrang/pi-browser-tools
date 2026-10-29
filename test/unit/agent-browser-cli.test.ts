import { describe, expect, test } from 'bun:test';
import { checkAgentBrowserAvailable } from '../../extensions/browser-tools/backends/agent-browser-cli.js';

describe('checkAgentBrowserAvailable', () => {
  test('probes with `--version` without starting a daemon', async () => {
    const calls: string[][] = [];
    await checkAgentBrowserAvailable(async (args) => {
      calls.push(args);
      return 'agent-browser 0.0.0';
    });
    expect(calls).toEqual([['--version']]);
    expect(calls.flat()).not.toContain('session');
    expect(calls.flat()).not.toContain('doctor');
  });

  test('resolves when the CLI is present and runnable', async () => {
    await expect(
      checkAgentBrowserAvailable(async () => 'agent-browser 0.0.0'),
    ).resolves.toBeUndefined();
  });

  test('preserves the detailed ENOENT/install message when the CLI is missing', async () => {
    await expect(
      checkAgentBrowserAvailable(async () => {
        throw new Error('The `agent-browser` executable was not found in PATH.');
      }),
    ).rejects.toThrow(/not found in PATH/u);
  });

  test('surfaces install guidance on any other probe failure', async () => {
    await expect(
      checkAgentBrowserAvailable(async () => {
        throw new Error('connection refused');
      }),
    ).rejects.toThrow(/CLI is unavailable/u);
  });
});
