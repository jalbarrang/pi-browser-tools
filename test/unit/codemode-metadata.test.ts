import { describe, expect, test } from 'bun:test';
import extension from '../../extensions/browser-tools/index.js';

type RegisteredTool = {
  name: string;
  outputSchema?: unknown;
  namespace?: { name: string };
};

function registerTools(): Map<string, RegisteredTool> {
  const tools = new Map<string, RegisteredTool>();
  const register = extension as unknown as (pi: {
    registerTool(tool: RegisteredTool): void;
    registerCommand(): void;
    on(): void;
  }) => void;

  register({
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand() {},
    on() {},
  });

  return tools;
}

describe('codemode metadata', () => {
  test('every tool exposes a structured output schema', () => {
    const tools = registerTools();
    const names = ['web_search', 'web_visit', 'web_screenshot', 'web_interact', 'web_console'];

    for (const name of names) {
      const tool = tools.get(name);
      expect(tool, `${name} should be registered`).toBeDefined();
      expect(tool?.outputSchema, `${name} should declare outputSchema`).toBeDefined();
    }
  });

  test('related tools share the browser namespace', () => {
    const tools = registerTools();

    for (const tool of tools.values()) {
      expect(tool.namespace?.name).toBe('browser');
    }
  });
});
