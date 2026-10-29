# agent-browser compatibility notes

`@dreki-gg/pi-browser-tools` uses [`agent-browser`](https://github.com/agent-browser/agent-browser) as its only browser runtime. There is no Playwright fallback; if the CLI is unavailable, browser-backed tools fail with install guidance.

## agent-browser install requirement

The backend requires a local CLI install plus its first-run browser setup:

```bash
# Homebrew
brew install agent-browser && agent-browser install

# or npm
npm install -g agent-browser && agent-browser install
```

## Session and CDP behavior

- Each pi process uses an isolated session named `pi-browser-tools-<pid>` by default. Override it with `PI_BROWSER_SESSION` to keep one stable session across restarts.
- When attached through CDP (`cdp` param or `PI_BROWSER_CDP`), the backend connects with `--pin-tab`. A session whose pinned tab was closed fails with `tab_gone` instead of acting on a different agent's tab.
- The connected browser is user-owned: `close()` drops local session state but never closes it.

## Wait behavior

Navigation waits for the document `load` event (`wait --load load`, capped at 5s) instead of a fixed delay. Explicit `waitMs` values still perform a fixed wait. This follows agent-browser's guidance to prefer lifecycle/target waits over blind sleeps.

## Known compatibility gaps

### `web_interact.text` is best-effort

The public tool contract accepts:

```ts
text?: string
```

Resolution uses the interactive accessibility snapshot with tiered matching:

1. exact accessible name
2. exact visible text
3. case-insensitive substring on accessible name
4. case-insensitive substring on visible text

A tier only wins when it yields a single match; ambiguity throws instead of guessing. For reliable automation, prefer `selector` (CSS or `@ref`).

### `web_console` output is merged

`web_console` combines CLI `console` and `errors` data. That means:

- ordering can differ slightly from a single DevTools stream
- some level attribution is best-effort
- page errors are still surfaced as `page-error`

The public result shape stays the same, with an additive `details.backend` field.

### `web_interact.snapshot` replaces the screenshot

Pass `snapshot: true` to `web_interact` to get the fresh interactive accessibility tree as text (`@e1`, `@e2`, ...) instead of an image. This is the recommended follow-up after a page-changing action: it is cheaper than a screenshot and gives you refs for the next call. The default remains a screenshot.

### `web_visit.details.method`

`web_visit.details.method` is either `fetch` or `agent-browser`. `details.backend` always reports `agent-browser` for browser-backed tools.

## Compatibility policy

- Tool names and arguments stay stable except for documented additions.
- `selector` remains the preferred cross-backend targeting mechanism.
- `text` remains best-effort, not guaranteed.
- `scroll` remains vertical-only because that matches the public contract.
