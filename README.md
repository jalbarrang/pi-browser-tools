# @dreki-gg/pi-browser-tools

Browser automation and web research tools for pi.

It adds:
- `web_search` for search-engine-backed web discovery
- `web_visit` for readable markdown extraction via fetch or the selected browser backend
- `web_screenshot` for browser screenshots at desktop or mobile sizes
- `web_interact` for click/type/select/scroll/hover/wait actions on the open page
- `web_console` for captured browser logs, warnings, and uncaught page errors
- `/browser` for a quick browser status check

## Install

```bash
pi install npm:@dreki-gg/pi-browser-tools
```

Browser backend: `agent-browser` (see [Browser backend](#browser-backend)).

Optional `agent-browser` backend setup:

```bash
# Homebrew
brew install agent-browser && agent-browser install

# or npm
npm install -g agent-browser && agent-browser install
```

## Tools

| Tool | Description |
|------|-------------|
| `web_search` | Search the web and return up to 10 filtered results |
| `web_visit` | Fetch a URL and convert it to readable markdown, with optional browser rendering |
| `web_screenshot` | Take a screenshot of the current page or navigate to a URL first |
| `web_interact` | Interact with the current browser page and return a fresh screenshot or snapshot |
| `web_console` | Read captured browser console output, warnings, errors, and uncaught page errors |

## Search providers

Default provider: DuckDuckGo HTML.

Optional env vars:

```bash
# Select provider: duckduckgo | google | brave
export WEB_SEARCH_PROVIDER=duckduckgo

# Google Custom Search
export GOOGLE_CSE_API_KEY=...
export GOOGLE_CSE_ID=...

# Brave Search
export BRAVE_SEARCH_API_KEY=...
```

If `WEB_SEARCH_PROVIDER=google`, both `GOOGLE_CSE_API_KEY` and `GOOGLE_CSE_ID` are required.
If `WEB_SEARCH_PROVIDER=brave`, `BRAVE_SEARCH_API_KEY` is required.

## Browser backend

Browser-backed tools use [`agent-browser`](https://github.com/agent-browser/agent-browser) as the only runtime. Install it with:

```bash
# macOS
brew install agent-browser && agent-browser install
# or any platform
npm install -g agent-browser && agent-browser install
```

If `agent-browser` is unavailable, browser-backed tools fail with install guidance.

### Sessions

Each pi process gets its own isolated `agent-browser` session
(`pi-browser-tools-<pid>`), so it never hijacks the shared `default` session or
another agent's browser. Set `PI_BROWSER_SESSION` to pin a stable session name
across restarts:

```bash
export PI_BROWSER_SESSION=my-worktree
```

When attached to your own Chrome via `cdp`/`PI_BROWSER_CDP`, the session also
uses `--pin-tab`, so a closed tab fails with `tab_gone` instead of silently
acting on another agent's tab.

### Waits

Navigation waits for the document `load` event (capped at 5s) instead of a
blind fixed delay. Pass `snapshot: true` to `web_interact` after a page-changing
action to get fresh `@refs` as text instead of another screenshot.

## Codemode

Every tool declares an `outputSchema`, so [`codemode`](https://pi.dev/docs/codemode)
scripts receive structured results instead of formatted text. This needs pi
`>= 0.99.0`.

```js
const found = await tools.web_search({ query: "agent-browser CLI" });
text(found.results.slice(0, 3));

const page = await tools.web_visit({ url: found.results[0].url, render: true });
text(page.title);

const shot = await tools.web_screenshot({ url: page.url, viewport: "mobile" });
image(shot.image); // { type: "image", data, mimeType }

const after = await tools.web_interact({
  action: "click",
  selector: "#main",
  snapshot: true,
});
text(after.snapshot);
```

Results:

- `web_search` → `{ provider, results }`
- `web_visit` → `{ method, backend, title, url, length, markdown }`
- `web_screenshot` → `{ backend, url, viewport, image, savedPath? }`
- `web_interact` → `{ action, backend, url, viewport, image | snapshot, savedPath? }`
- `web_console` → `{ count, levels, cleared, backend, entries }`

The tools share the `browser` codemode namespace, so
`describeNamespace("browser")` returns their guidance.

## Saving screenshots

`web_screenshot` and `web_interact` can persist the full-resolution PNG to disk so it
can be shared or referenced later:

```jsonc
{ "save": true }                          // ~/.pi/agent/temp/screenshots/<host>-<timestamp>.png
{ "save": true, "save_folder": "proj-x" } // ~/.pi/agent/temp/proj-x/<host>-<timestamp>.png
{ "save": true, "save_name": "checkout" } // ~/.pi/agent/temp/screenshots/checkout.png
```

- `save`: write the PNG (default folder: `screenshots`).
- `save_folder`: subfolder under `~/.pi/agent/temp` (relative paths only).
- `save_name`: file name, with `.png` appended when missing. Defaults to
  `<host>-<YYYYMMDD-HHmmss>.png`.
- Passing `save_folder` or `save_name` implies saving even without `save: true`.
- Global default: `WEB_SCREENSHOT_SAVE=1` (truthy: `1`, `true`, `yes`, `on`).

The tool result includes the saved path, e.g.
`/Users/you/.pi/agent/temp/screenshots/example.com-20251006-143012.png`.

## Notes

- `web_visit` uses plain fetch by default and falls back to the selected browser backend when the fetched markdown is too thin.
- `web_interact` and `web_console` require an open browser session. Open one first with `web_screenshot` or `web_visit` using `render: true`.
- `web_interact` returns a screenshot by default. Pass `snapshot: true` to get a fresh interactive accessibility snapshot (`@e1`, `@e2`, ...) as text instead; this is cheaper and gives you refs for the next action.
- `web_interact.text` resolves against the accessibility snapshot using tiered matching: exact accessible name, exact visible text, then case-insensitive substring on each. A tier is only accepted when it yields a single match — ambiguous text throws and asks for a `selector`. Prefer `selector` when you need deterministic targeting.
- `web_console` on `agent-browser` merges console messages and page errors, so ordering and level attribution are best-effort.
- `web_visit.details.method` is either `fetch` or `agent-browser`.
- A browser session stays open and is reused across tool calls until the pi session ends (or `close()` is called explicitly). There is no idle auto-close, so `web_interact`/`web_console` keep working after long gaps following `web_screenshot`.
- See [`docs/agent-browser-compatibility.md`](./docs/agent-browser-compatibility.md) for known gaps and backend-specific notes.
