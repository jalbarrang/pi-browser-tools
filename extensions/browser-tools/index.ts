import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { resolveBrowserBackend } from './backends/select.js';
import type {
  BrowserBackendName,
  BrowserScreenshotResult,
  ConsoleEntry,
  ViewportPreset,
} from './backends/types.js';
import { fetchAsMarkdown, renderedPageToMarkdown } from './markdown.js';
import { webSearch } from './search.js';
import { resolveCdpTarget } from './backends/resolve-cdp-target.js';
import {
  resolveSaveEnabled,
  saveScreenshotPng,
  type SavedScreenshot,
} from './image/save-screenshot.js';

const TOOL_GUIDELINES = [
  'Use `web_search` to find information online, then `web_visit` to read specific pages.',
  'Use `web_screenshot` and `web_interact` for visual verification and page interaction.',
  '`web_screenshot` and `web_interact` can persist the full-resolution PNG to disk with `save: true` (under `~/.pi/agent/temp/screenshots`); pass `save_folder`/`save_name` to control where and what, and the saved path is returned for later reference.',
  'After a page-changing action, pass `snapshot: true` to `web_interact` to get fresh `@refs` as text instead of another screenshot.',
  '`web_visit` returns markdown by default without launching a browser. Use `render: true` only for JavaScript-heavy SPAs.',
  'To drive an already-running, authenticated Chrome, start it with `--remote-debugging-port=9222` and pass `cdp: "localhost:9222"` to `web_screenshot`/`web_visit` (or set `PI_BROWSER_CDP`). The connected browser is never auto-closed.',
];

/** Codemode lists these tools under one namespace with a single description. */
const BROWSER_NAMESPACE = {
  name: 'browser',
  description: 'Browser automation and web research',
  instructions:
    'Call from codemode scripts as tools.web_search, tools.web_visit, tools.web_screenshot, tools.web_interact, and tools.web_console. Results resolve to structured objects; screenshots expose an image block ({ type: "image", data, mimeType }) that can be passed to image().',
};

const CDP_PARAM = Type.Optional(
  Type.String({
    description:
      'Connect to a running browser via CDP instead of launching one. Accepts a port ("9222"), host:port ("localhost:9222"), or ws/http URL. Binds once per session; the connected browser is not closed on shutdown. Defaults to PI_BROWSER_CDP.',
  }),
);
const env =
  (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env ?? {};

const VIEWPORT_ENUM = ['desktop', 'mobile'] as const;
const ACTION_ENUM = ['click', 'type', 'scroll', 'select', 'hover', 'wait'] as const;
const SCROLL_DIRECTION_ENUM = ['up', 'down'] as const;
const CONSOLE_LEVEL_ENUM = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'page-error',
] as const;

const SAVE_PARAMS = {
  save: Type.Optional(
    Type.Boolean({
      description:
        "Save the screenshot as a PNG under pi's temp dir so it can be referenced later (default: ~/.pi/agent/temp/screenshots).",
    }),
  ),
  save_folder: Type.Optional(
    Type.String({
      description:
        'Subfolder under ~/.pi/agent/temp to save into (default "screenshots"). Relative paths only.',
    }),
  ),
  save_name: Type.Optional(
    Type.String({
      description:
        'File name for the saved PNG (default: "<host>-<timestamp>.png"). A .png extension is added when missing.',
    }),
  ),
};

type SaveParams = { save?: boolean; save_folder?: string; save_name?: string };

const VIEWPORT_OUTPUT = Type.Object({ width: Type.Number(), height: Type.Number() });

/** Shape accepted by codemode's `image()` and TypeBox schema for image blocks. */
const IMAGE_OUTPUT = Type.Object({
  type: Type.Literal('image'),
  data: Type.String(),
  mimeType: Type.String(),
});

const SEARCH_OUTPUT = Type.Object({
  provider: Type.String(),
  results: Type.Array(
    Type.Object({ title: Type.String(), url: Type.String(), snippet: Type.String() }),
  ),
});

const VISIT_OUTPUT = Type.Object({
  method: Type.String(),
  backend: Type.String(),
  title: Type.String(),
  url: Type.String(),
  length: Type.Number(),
  markdown: Type.String(),
});

const SCREENSHOT_OUTPUT = Type.Object({
  backend: Type.String(),
  url: Type.Union([Type.String(), Type.Null()]),
  viewport: Type.Union([VIEWPORT_OUTPUT, Type.Null()]),
  image: IMAGE_OUTPUT,
  savedPath: Type.Optional(Type.String()),
});

const INTERACT_OUTPUT = Type.Object({
  action: Type.String(),
  backend: Type.String(),
  url: Type.Union([Type.String(), Type.Null()]),
  viewport: Type.Union([VIEWPORT_OUTPUT, Type.Null()]),
  snapshot: Type.Optional(Type.String()),
  image: Type.Optional(IMAGE_OUTPUT),
  savedPath: Type.Optional(Type.String()),
});

const CONSOLE_OUTPUT = Type.Object({
  count: Type.Number(),
  levels: Type.Record(Type.String(), Type.Number()),
  cleared: Type.Boolean(),
  backend: Type.String(),
  entries: Type.Array(
    Type.Object({
      level: Type.String(),
      text: Type.String(),
      url: Type.Union([Type.String(), Type.Null()]),
      timestamp: Type.Number(),
    }),
  ),
});

/** A save_folder/save_name implies intent to save even without `save: true`. */
function shouldSaveScreenshot(params: SaveParams): boolean {
  return resolveSaveEnabled(params.save, env) || Boolean(params.save_folder || params.save_name);
}

/** Persist the raw PNG capture under pi's temp dir when saving was requested. */
async function maybeSaveScreenshot(
  params: SaveParams,
  screenshot: BrowserScreenshotResult,
): Promise<SavedScreenshot | undefined> {
  if (!shouldSaveScreenshot(params)) {
    return undefined;
  }
  if (!screenshot.pngBase64) {
    throw new Error('Raw PNG was not captured, so the screenshot cannot be saved.');
  }

  return saveScreenshotPng({
    png: Buffer.from(screenshot.pngBase64, 'base64'),
    url: screenshot.url,
    folder: params.save_folder,
    name: params.save_name,
  });
}

function savedScreenshotBlock(saved: SavedScreenshot | undefined) {
  return saved ? [{ type: 'text' as const, text: `Screenshot saved to ${saved.path}` }] : [];
}

/** Image block shape that codemode's `image()` accepts. */
function imageBlockFor(screenshot: BrowserScreenshotResult) {
  return {
    type: 'image' as const,
    data: screenshot.imageBase64,
    mimeType: screenshot.mimeType,
  };
}

function formatSearchResults(
  results: Array<{ title: string; url: string; snippet: string }>,
): string {
  if (results.length === 0) return 'No results found.';

  return results
    .map((result, index) => {
      const snippet = result.snippet ? `\n   ${result.snippet}` : '';
      return `${index + 1}. [${result.title}](${result.url})${snippet}`;
    })
    .join('\n\n');
}

function formatVisitMarkdown(result: {
  markdown: string;
  title: string;
  method: 'fetch' | BrowserBackendName;
  url: string;
}): string {
  const header = [`Source: ${result.url}`, `Method: ${result.method}`].join('\n');
  return `${header}\n\n${result.markdown}`.trim();
}

export default function browserToolsExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'web_search',
    label: 'Web Search',
    description: 'Search the web and return up to 10 filtered results.',
    promptSnippet: 'Search the web and return a list of results',
    promptGuidelines: TOOL_GUIDELINES,
    outputSchema: SEARCH_OUTPUT,
    namespace: BROWSER_NAMESPACE,
    annotations: { readOnlyHint: true, openWorldHint: true },
    parameters: Type.Object({
      query: Type.String({ description: 'Search query' }),
      allowed_domains: Type.Optional(Type.Array(Type.String({ description: 'Allowed domain' }))),
      blocked_domains: Type.Optional(Type.Array(Type.String({ description: 'Blocked domain' }))),
    }),
    async execute(
      _toolCallId: string,
      params: { query: string; allowed_domains?: string[]; blocked_domains?: string[] },
      signal?: AbortSignal,
    ) {
      const result = await webSearch(params.query, {
        allowed_domains: params.allowed_domains,
        blocked_domains: params.blocked_domains,
        signal,
      });
      const structuredContent = {
        provider: (env.WEB_SEARCH_PROVIDER ?? 'duckduckgo').toLowerCase(),
        results: result.results,
      };

      return {
        content: [{ type: 'text', text: formatSearchResults(result.results) }],
        details: structuredContent,
        structuredContent,
      };
    },
  });

  pi.registerTool({
    name: 'web_visit',
    label: 'Web Visit',
    description:
      'Fetch a URL and convert it to readable markdown, with optional browser rendering.',
    promptSnippet: 'Fetch a URL and convert it to readable markdown',
    promptGuidelines: TOOL_GUIDELINES,
    outputSchema: VISIT_OUTPUT,
    namespace: BROWSER_NAMESPACE,
    annotations: { readOnlyHint: true, openWorldHint: true },
    parameters: Type.Object({
      url: Type.String({ description: 'URL to fetch' }),
      render: Type.Optional(Type.Boolean({ description: 'Force browser rendering' })),
      cdp: CDP_PARAM,
    }),
    async execute(
      _toolCallId: string,
      params: { url: string; render?: boolean; cdp?: string },
      signal?: AbortSignal,
    ) {
      const browserBackend = await resolveBrowserBackend();
      browserBackend.bindCdpTarget(resolveCdpTarget(params.cdp, env));

      const result = params.render
        ? renderedPageToMarkdown(await browserBackend.renderPage(params.url))
        : await fetchAsMarkdown(params.url, { signal });

      const finalResult =
        !params.render && result.markdown.trim().length < 200 && !browserBackend.isOpen()
          ? renderedPageToMarkdown(await browserBackend.renderPage(params.url))
          : result;
      const structuredContent = {
        method: finalResult.method,
        backend: browserBackend.name,
        title: finalResult.title,
        url: finalResult.url,
        length: finalResult.markdown.length,
        markdown: finalResult.markdown,
      };

      return {
        content: [{ type: 'text', text: formatVisitMarkdown(finalResult) }],
        details: {
          method: finalResult.method,
          backend: browserBackend.name,
          title: finalResult.title,
          url: finalResult.url,
          length: finalResult.markdown.length,
        },
        structuredContent,
      };
    },
  });

  pi.registerTool({
    name: 'web_screenshot',
    label: 'Web Screenshot',
    description: 'Take a screenshot of the current page or navigate to a URL first.',
    promptSnippet: 'Take a screenshot of a web page at desktop or mobile size',
    promptGuidelines: TOOL_GUIDELINES,
    outputSchema: SCREENSHOT_OUTPUT,
    namespace: BROWSER_NAMESPACE,
    annotations: { readOnlyHint: true, openWorldHint: true },
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: 'URL to navigate to before capturing' })),
      viewport: Type.Optional(StringEnum(VIEWPORT_ENUM, { description: 'Viewport preset' })),
      width: Type.Optional(Type.Number({ description: 'Viewport width override' })),
      height: Type.Optional(Type.Number({ description: 'Viewport height override' })),
      cdp: CDP_PARAM,
      ...SAVE_PARAMS,
    }),
    async execute(
      _toolCallId: string,
      params: {
        url?: string;
        viewport?: ViewportPreset;
        width?: number;
        height?: number;
        cdp?: string;
      } & SaveParams,
    ) {
      const browserBackend = await resolveBrowserBackend();
      browserBackend.bindCdpTarget(resolveCdpTarget(params.cdp, env));

      const screenshot = await browserBackend.screenshot({
        url: params.url,
        preset: (params.viewport ?? 'desktop') as ViewportPreset,
        width: params.width,
        height: params.height,
        capturePng: shouldSaveScreenshot(params),
      });
      const saved = await maybeSaveScreenshot(params, screenshot);
      const structuredContent = {
        backend: browserBackend.name,
        url: screenshot.url,
        viewport: screenshot.viewport,
        image: imageBlockFor(screenshot),
        ...(saved ? { savedPath: saved.path } : {}),
      };

      return {
        content: [
          {
            type: 'image',
            data: screenshot.imageBase64,
            mimeType: screenshot.mimeType,
          },
          ...savedScreenshotBlock(saved),
        ],
        details: {
          backend: browserBackend.name,
          url: screenshot.url,
          viewport: screenshot.viewport,
          savedPath: saved?.path,
        },
        structuredContent,
      };
    },
  });

  pi.registerTool({
    name: 'web_interact',
    label: 'Web Interact',
    description: 'Interact with the currently open browser page and return a fresh screenshot.',
    promptSnippet: 'Interact with the current browser page (click, type, scroll, etc.)',
    promptGuidelines: TOOL_GUIDELINES,
    outputSchema: INTERACT_OUTPUT,
    namespace: BROWSER_NAMESPACE,
    annotations: { openWorldHint: true },
    parameters: Type.Object({
      action: StringEnum(ACTION_ENUM, { description: 'Interaction to perform' }),
      cdp: CDP_PARAM,
      selector: Type.Optional(Type.String({ description: 'CSS selector' })),
      text: Type.Optional(Type.String({ description: 'Visible text to target' })),
      value: Type.Optional(Type.String({ description: 'Value for type/select actions' })),
      direction: Type.Optional(
        StringEnum(SCROLL_DIRECTION_ENUM, { description: 'Scroll direction' }),
      ),
      amount: Type.Optional(Type.Number({ description: 'Scroll amount in pixels' })),
      timeout: Type.Optional(Type.Number({ description: 'Wait timeout in milliseconds' })),
      snapshot: Type.Optional(
        Type.Boolean({
          description:
            'Return a fresh interactive page snapshot (accessibility tree with @refs) as text instead of a screenshot. Use after actions that change the page.',
        }),
      ),
      ...SAVE_PARAMS,
    }),
    async execute(
      _toolCallId: string,
      params: {
        action: (typeof ACTION_ENUM)[number];
        cdp?: string;
        selector?: string;
        text?: string;
        value?: string;
        direction?: (typeof SCROLL_DIRECTION_ENUM)[number];
        amount?: number;
        timeout?: number;
        snapshot?: boolean;
      } & SaveParams,
    ) {
      const browserBackend = await resolveBrowserBackend();
      browserBackend.bindCdpTarget(resolveCdpTarget(params.cdp, env));

      if (!browserBackend.isOpen()) {
        throw new Error(
          'Browser is not open. Use web_screenshot or web_visit with render:true first.',
        );
      }

      const interaction = await browserBackend.interact(params);

      if (params.snapshot) {
        const snapshot = await browserBackend.snapshot();
        const saved = shouldSaveScreenshot(params)
          ? await maybeSaveScreenshot(
              params,
              await browserBackend.screenshot({ capturePng: true }),
            )
          : undefined;

        return {
          content: [
            { type: 'text', text: `Action completed: ${params.action}` },
            { type: 'text', text: snapshot || 'No interactive elements found.' },
            ...savedScreenshotBlock(saved),
          ],
          details: {
            action: params.action,
            backend: browserBackend.name,
            url: interaction.url,
            viewport: interaction.viewport,
            snapshot: true,
            savedPath: saved?.path,
          },
          structuredContent: {
            action: params.action,
            backend: browserBackend.name,
            url: interaction.url,
            viewport: interaction.viewport,
            snapshot: snapshot || 'No interactive elements found.',
            ...(saved ? { savedPath: saved.path } : {}),
          },
        };
      }

      const screenshot = await browserBackend.screenshot({
        capturePng: shouldSaveScreenshot(params),
      });
      const saved = await maybeSaveScreenshot(params, screenshot);

      return {
        content: [
          {
            type: 'text',
            text: `Action completed: ${params.action}`,
          },
          {
            type: 'image',
            data: screenshot.imageBase64,
            mimeType: screenshot.mimeType,
          },
          ...savedScreenshotBlock(saved),
        ],
        details: {
          action: params.action,
          backend: browserBackend.name,
          url: interaction.url ?? screenshot.url,
          viewport: interaction.viewport ?? screenshot.viewport,
          snapshot: false,
          savedPath: saved?.path,
        },
        structuredContent: {
          action: params.action,
          backend: browserBackend.name,
          url: interaction.url ?? screenshot.url,
          viewport: interaction.viewport ?? screenshot.viewport,
          image: imageBlockFor(screenshot),
          ...(saved ? { savedPath: saved.path } : {}),
        },
      };
    },
  });

  pi.registerTool({
    name: 'web_console',
    label: 'Web Console',
    description:
      'Read browser console output (logs, warnings, errors) from the current page. Captures console.log/info/warn/error/debug/trace and uncaught page errors.',
    promptSnippet: 'Read browser console output (logs, warnings, errors, uncaught exceptions)',
    promptGuidelines: [
      'Use `web_console` to inspect runtime errors, warnings, and log output from the browser.',
      '`web_console` captures output from the moment the browser opens. Use `clear: true` to reset the buffer after reading.',
    ],
    outputSchema: CONSOLE_OUTPUT,
    namespace: BROWSER_NAMESPACE,
    annotations: { readOnlyHint: true, openWorldHint: true },
    parameters: Type.Object({
      cdp: CDP_PARAM,
      level: Type.Optional(
        Type.Array(
          StringEnum(CONSOLE_LEVEL_ENUM, {
            description: 'Filter by console level',
          }),
          {
            description: 'Only return entries matching these levels. Omit to return all levels.',
          },
        ),
      ),
      clear: Type.Optional(
        Type.Boolean({
          description: 'Clear the console buffer after reading (default false)',
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        cdp?: string;
        level?: ConsoleEntry['level'][];
        clear?: boolean;
      },
    ) {
      const browserBackend = await resolveBrowserBackend();
      browserBackend.bindCdpTarget(resolveCdpTarget(params.cdp, env));

      const entries = await browserBackend.getConsoleEntries({
        level: params.level,
        clear: params.clear,
      });

      if (entries.length === 0) {
        const reason = !browserBackend.isOpen()
          ? 'Browser is not open. Use web_screenshot or web_visit with render:true first.'
          : 'No console output captured yet.';
        const structuredContent = {
          count: 0,
          levels: {},
          cleared: params.clear ?? false,
          backend: browserBackend.name,
          entries: [],
        };
        return {
          content: [{ type: 'text', text: reason }],
          details: {
            count: 0,
            levels: {},
            cleared: params.clear ?? false,
            backend: browserBackend.name,
          },
          structuredContent,
        };
      }

      const formatted = entries
        .map((entry) => {
          const tag = entry.level.toUpperCase().padEnd(10);
          return `[${tag}] ${entry.text}`;
        })
        .join('\n');
      const levels = Object.fromEntries(
        CONSOLE_LEVEL_ENUM.map((level) => [
          level,
          entries.filter((entry) => entry.level === level).length,
        ]).filter(([, count]) => (count as number) > 0),
      );
      const structuredContent = {
        count: entries.length,
        levels,
        cleared: params.clear ?? false,
        backend: browserBackend.name,
        entries,
      };

      return {
        content: [{ type: 'text', text: formatted }],
        details: {
          count: entries.length,
          levels,
          cleared: params.clear ?? false,
          backend: browserBackend.name,
        },
        structuredContent,
      };
    },
  });

  pi.registerCommand('browser', {
    description: 'Show browser status',
    handler: async (
      _args: string,
      ctx: {
        hasUI: boolean;
        ui: { notify(message: string, level: 'info' | 'warning' | 'error'): void };
      },
    ) => {
      const browserBackend = await resolveBrowserBackend();

      const status = browserBackend.getStatus();
      const message = status.isOpen
        ? `Browser open (${browserBackend.name})\nURL: ${status.url ?? 'unknown'}\nViewport: ${status.viewport?.width ?? '?'}x${status.viewport?.height ?? '?'}`
        : `Browser closed (${browserBackend.name} selected)`;

      if (ctx.hasUI) {
        ctx.ui.notify(message, 'info');
      }
    },
  });

  pi.on('session_shutdown', async () => {
    const browserBackend = await resolveBrowserBackend();
    await browserBackend.close();
  });
}
