# browsirai

[![npm version](https://img.shields.io/npm/v/browsirai.svg?style=flat-square)](https://www.npmjs.com/package/browsirai)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)](LICENSE)

**Your browser. Your sessions. Your agent.**

An MCP server + CLI that connects AI coding agents to Firefox via WebDriver BiDi. Use as an MCP server for LLM-driven automation, or as a standalone CLI for direct browser control from the terminal.

## Why browsirai?

- **Standard protocol** — Uses WebDriver BiDi, the W3C standard for browser automation. No proprietary protocols, no vendor lock-in.

- **Credentials never reach the LLM** — Cookie values are managed at the browser level via BiDi storage commands. They never enter the MCP message stream, never reach the model context, never leave your machine.

- **No extra browser to install** — Uses your existing Firefox installation. No separate binary downloads.

- **20x cheaper than screenshot-default tools** — Server-side snapshot redirection returns ~500 tokens instead of ~10K per interaction. 50 interactions/day: 25K tokens vs 500K.

- **Always up to date** — Auto-upgrade checks npm registry on every server start. Next session launches with the latest version. Zero manual intervention.

## Quick Start

```bash
npx browsirai install
```

Auto-detects your AI platform and configures the MCP server. No global install needed.

<details>
<summary><strong>Claude Code</strong></summary>

```json
// .mcp.json
{
  "mcpServers": {
    "browsirai": {
      "command": "npx",
      "args": ["-y", "browsirai"]
    }
  }
}
```
</details>

<details>
<summary><strong>Cursor</strong></summary>

```json
// .cursor/mcp.json
{
  "mcpServers": {
    "browsirai": {
      "command": "npx",
      "args": ["-y", "browsirai"]
    }
  }
}
```
</details>

<details>
<summary><strong>VS Code Copilot</strong></summary>

```json
// .vscode/mcp.json
{
  "servers": {
    "browsirai": {
      "command": "npx",
      "args": ["-y", "browsirai"]
    }
  }
}
```
</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

```json
// ~/.gemini/settings.json
{
  "mcpServers": {
    "browsirai": {
      "command": "npx",
      "args": ["-y", "browsirai"]
    }
  }
}
```
</details>

<details>
<summary><strong>Windsurf</strong></summary>

```json
// ~/.codeium/windsurf/mcp_config.json
{
  "mcpServers": {
    "browsirai": {
      "command": "npx",
      "args": ["-y", "browsirai"]
    }
  }
}
```
</details>

<details>
<summary><strong>Cline</strong></summary>

```json
// Cline MCP settings (Settings > MCP Servers)
{
  "mcpServers": {
    "browsirai": {
      "command": "npx",
      "args": ["-y", "browsirai"]
    }
  }
}
```
</details>

<details>
<summary><strong>Zed</strong></summary>

```json
// ~/.config/zed/settings.json
{
  "context_servers": {
    "browsirai": {
      "command": "npx",
      "args": ["-y", "browsirai"]
    }
  }
}
```
</details>

<details>
<summary><strong>Continue</strong></summary>

```yaml
# ~/.continue/config.yaml
mcpServers:
  browsirai:
    command: npx
    args: ["-y", "browsirai"]
```
</details>

<details>
<summary><strong>OpenCode</strong></summary>

```json
// opencode.json
{
  "mcpServers": {
    "browsirai": {
      "command": "npx",
      "args": ["-y", "browsirai"]
    }
  }
}
```
</details>

## CLI Mode

browsirai also works as a standalone CLI -- no LLM required. Same commands, same Firefox connection.

```bash
browsirai open example.com
browsirai snapshot -i
browsirai click @e5
browsirai fill @e2 "hello world"
browsirai press Enter
browsirai eval "document.title"
```

### Commands (30)

| Category       | Commands                                                                                |
| -------------- | --------------------------------------------------------------------------------------- |
| **Navigation** | `open` (goto, navigate), `back`, `scroll`, `wait`, `tab` (tabs), `close`, `resize`     |
| **Observation** | `snapshot`, `screenshot`, `html`, `eval`, `find`, `source`, `console`, `network`       |
| **Actions**    | `click`, `fill`, `type`, `press` (key), `hover`, `drag`, `select`, `upload`, `dialog`  |
| **Network**    | `route`, `abort`, `unroute`, `save`, `load`, `diff`                                    |

### Short Flags

```bash
browsirai snapshot -i          # interactive elements only
browsirai snapshot -c          # compact output
browsirai snapshot -d 3        # depth limit
browsirai snapshot -s "main"   # scope to selector
browsirai screenshot -o ss.png # save to file
```

### Positional Arguments

```bash
browsirai click @e5            # ref (not --ref=@e5)
browsirai click "#submit"      # CSS selector
browsirai fill @e2 "text"      # ref + value
browsirai drag @e1 @e2         # source + target
browsirai select @e3 "option1" # ref + value(s)
browsirai scroll down           # direction
browsirai resize 1280 720      # width height
```

### Workflow Example

```bash
browsirai open github.com/login
browsirai snapshot -i
# @e12 textbox "Username"
# @e15 textbox "Password"
# @e18 button "Sign in"
browsirai fill @e12 "user@example.com"
browsirai fill @e15 "password"
browsirai click @e18
browsirai wait --url="github.com/dashboard"
browsirai snapshot -i
```

## Features

| Feature                 | Description                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| **WebDriver BiDi**      | W3C standard protocol. Cross-browser compatible, future-proof.                                             |
| **Daemon Architecture** | MCP server survives browser crashes. Auto-reconnects on next `browser_connect`.                            |
| **Skill Injection**     | On every connect, injects workflow hints, cost hierarchy, and identity resolution rules into agent context. |
| **EventBuffer Capture** | Server-side BiDi event listeners. Network requests and console messages survive page navigations.          |
| **Source Inspection**    | Maps DOM elements to source code: React (Fiber tree + jsxDEV), Vue (`__file`), Svelte (`__svelte_meta`).  |
| **Network Intercept**   | Route, abort, and mock HTTP requests with glob pattern matching via BiDi network module.                   |
| **Element Refs**        | Accessibility tree nodes get `@eN` refs. Click, fill, hover, drag -- all by ref.                          |
| **Pixel Diff**          | Compare two screenshots pixel-by-pixel. Returns diff percentage and visual overlay.                        |
| **Session Persistence** | Save/load cookies, localStorage, sessionStorage across agent sessions.                                     |
| **Auto-Upgrade**        | Checks npm registry on server start. Background upgrade applies on next restart.                           |
| **Cost Optimization**   | `browser_screenshot` auto-returns text snapshot (~500 tokens) unless `visual: true` (~10K tokens).         |

## Tools (33)

### Connection and Lifecycle

| Tool               | What it does                                                                                  | ~Tokens |
| ------------------ | --------------------------------------------------------------------------------------------- | ------: |
| `browser_connect`  | Connect to Firefox via WebDriver BiDi. Auto-launches if needed. Injects agent skill hints.    |       - |
| `browser_tabs`     | List open tabs, filter by title/URL glob.                                                     |     ~10 |
| `browser_list`     | List available browser instances on default ports.                                            |     ~10 |
| `browser_close`    | Close tab(s) or detach. `force: true` to actually close.                                      |       - |
| `browser_resize`   | Set viewport dimensions or preset (`mobile`, `tablet`, `desktop`, `reset`).                   |     ~10 |

### Navigation

| Tool                    | What it does                                                            | ~Tokens |
| ----------------------- | ----------------------------------------------------------------------- | ------: |
| `browser_navigate`      | Navigate to URL. `waitUntil`: `load`, `domcontentloaded`, `networkidle`.|    ~500 |
| `browser_navigate_back` | Go back or forward in history.                                          |    ~500 |
| `browser_scroll`        | Scroll page/element by direction and pixels, or scroll element into view.|    ~10 |
| `browser_wait_for`      | Wait for text, selector, URL glob, JS condition, or timeout.            |     ~10 |

### Observation

| Tool                           | What it does                                                                        | ~Tokens |
| ------------------------------ | ----------------------------------------------------------------------------------- | ------: |
| `browser_snapshot`             | Accessibility tree with `@eN` refs. `compact`, `interactive`, `cursor`, `depth` modes.|  ~500 |
| `browser_screenshot`           | Returns text snapshot by default. `visual: true` for base64 image.                  | ~500/~10K |
| `browser_annotated_screenshot` | Screenshot with numbered labels on interactive elements.                            |   ~12K |
| `browser_html`                 | Raw HTML of page or element by selector.                                            |    ~500 |
| `browser_find`                 | Find elements by ARIA role, name, or text. Returns `@eN` ref.                      |    ~100 |
| `browser_inspect_source`       | Source file, line, component name. React/Vue/Svelte.                                |    ~100 |
| `browser_evaluate`             | Run JavaScript in page context. Async supported.                                    |     ~10 |

### Interaction

| Tool                    | What it does                                                                               | ~Tokens |
| ----------------------- | ------------------------------------------------------------------------------------------ | ------: |
| `browser_click`         | Click by `@eN` ref, CSS selector, or x/y coordinates. `newTab` support.                   |     ~10 |
| `browser_fill_form`     | Clear + type into a field. Handles textbox, checkbox, radio, combobox, slider.             |     ~10 |
| `browser_type`          | Type text (appends, doesn't clear). `slowly` mode for key-event listeners.                 |     ~10 |
| `browser_press_key`     | Press key or combination (`Control+c`, `Meta+a`, `Enter`, `Escape`).                      |     ~10 |
| `browser_hover`         | Hover over element by ref.                                                                 |     ~10 |
| `browser_drag`          | Drag from one ref to another with synthesized pointer events.                              |     ~10 |
| `browser_select_option` | Select dropdown options by value or label text.                                            |     ~10 |
| `browser_file_upload`   | Upload files to a file input by ref.                                                       |     ~10 |
| `browser_handle_dialog` | Accept/dismiss alert, confirm, prompt. With optional prompt text.                          |     ~10 |

### Network and Debugging

| Tool                       | What it does                                                                            | ~Tokens |
| -------------------------- | --------------------------------------------------------------------------------------- | ------: |
| `browser_network_requests` | List captured requests. Filter by URL glob, exclude static resources, include headers.  |    ~100 |
| `browser_console_messages` | Retrieve console log/warn/error/info messages. Filter by level.                         |    ~100 |
| `browser_route`            | Intercept requests matching URL glob. Respond with custom body/status/headers.          |     ~10 |
| `browser_abort`            | Block requests matching URL glob.                                                       |     ~10 |
| `browser_unroute`          | Remove intercept rules. `all: true` to clear everything.                                |     ~10 |

### State and Persistence

| Tool                 | What it does                                                                           | ~Tokens |
| -------------------- | -------------------------------------------------------------------------------------- | ------: |
| `browser_save_state` | Save cookies, localStorage, sessionStorage to named file.                              |     ~10 |
| `browser_load_state` | Restore saved state. Optionally navigate to URL after loading.                         |     ~10 |
| `browser_diff`       | Pixel-by-pixel comparison. Returns diff %, pixel counts, visual overlay.               |   ~11K |

> **~Tokens** = approximate tokens returned to the LLM per call.

## Architecture

### Protocol

browsirai uses **WebDriver BiDi** -- the W3C standard bidirectional protocol for browser automation. Unlike CDP (Chrome DevTools Protocol), BiDi is designed as an open standard with cross-browser support.

```
┌──────────────────┐     WebDriver BiDi      ┌──────────────────┐
│  browsirai       │ ◄──────────────────────► │  Firefox         │
│  MCP Server      │     WebSocket            │  (BiDi endpoint) │
│                  │                          │                  │
│  - Tool handlers │                          │  - DOM access    │
│  - Event buffer  │                          │  - Input actions │
│  - Skill inject  │                          │  - Network       │
└────────┬─────────┘                          └──────────────────┘
         │
         │ MCP (stdio)
         ▼
┌────────────────┐
│  AI Agent      │
│  (Claude, etc) │
└────────────────┘
```

### Cost Optimization

```
browser_evaluate     ~10 tokens    JS expression
browser_snapshot    ~500 tokens    Accessibility tree
browser_screenshot  ~10K tokens    Visual (opt-in)

20x cost reduction vs screenshot-default tools
```

`browser_screenshot` without `visual: true` auto-returns a text snapshot. The LLM gets the same information at 1/20th the cost.

| Scenario                       | Screenshot-default tool | browsirai       |
| ------------------------------ | ----------------------: | --------------: |
| 50 interactions/day            |        500K tokens/day  |  25K tokens/day |
| 20 devs x 22 working days     |       220M tokens/month | 11M tokens/month|

### EventBuffer

Network requests and console messages are captured via **server-side BiDi event listeners** -- not browser-side JavaScript injection. This means:

- Captures survive page navigations (no re-injection needed)
- Bounded ring buffer (500 events) prevents memory leaks
- URL secrets are automatically redacted (JWT, Bearer tokens, auth headers)
- Static resources (images, fonts, stylesheets) can be filtered out

### Auto-Upgrade

```
Session 1: server starts -> checks npm registry -> background upgrade
Session 2: starts with latest version
```

- 1-hour rate limit between checks
- npx: clears npm cache (next invocation fetches latest)
- global: `npm install -g browsirai@latest` in background
- dev mode: skipped
- Upgrade notice shown on `browser_connect` if newer version available
- All errors silently caught -- never crashes the server

### Skill Injection

On every `browser_connect`, browsirai injects a structured skill document into the agent context:

- **Cost hierarchy** -- guides the agent to prefer `evaluate` > `snapshot` > `screenshot`
- **Workflow patterns** -- snapshot-ref interaction model, when to re-snapshot
- **Identity resolution** -- use browser session cookies, never guess usernames
- **Per-tool hints** -- appended to each tool response (ref staling warnings, cross-origin limitations)

## Diagnostics

```bash
browsirai doctor
```

Checks Firefox installation, Node.js version, BiDi connectivity, and platform configuration.

## Security

### What browsirai does

- Launches a **Firefox instance** with WebDriver BiDi enabled
- Returns only **page content** to the agent (DOM text, evaluate results, snapshots)
- **Redacts secrets** in network output (Authorization, Cookie, Set-Cookie, Bearer tokens, JWTs)
- Resets state gracefully when Firefox closes (MCP server stays alive)

### What browsirai does NOT do

- Send cookie values to the LLM provider
- Store credentials in any config file
- Use a cloud relay or proxy
- Require you to enter passwords into the agent
- Modify your Firefox profile or existing sessions

## Supported Platforms

| Platform       | Status |
| -------------- | ------ |
| Claude Code    |      Y |
| Cursor         |      Y |
| Gemini CLI     |      Y |
| VS Code Copilot|      Y |
| Windsurf       |      Y |
| Cline          |      Y |
| Zed            |      Y |
| Continue       |      Y |
| OpenCode       |      Y |

## FAQ

<details>
<summary><strong>Does the LLM see my passwords or cookies?</strong></summary>

No. Cookie values are managed at the browser level via BiDi storage commands. The LLM only sees page content -- text, DOM elements, JavaScript evaluation results.
</details>

<details>
<summary><strong>Why Firefox and WebDriver BiDi?</strong></summary>

WebDriver BiDi is the W3C standard for browser automation. It provides a standardized, cross-browser compatible protocol. Firefox has the most mature BiDi implementation among browsers.
</details>

<details>
<summary><strong>What happens when I close Firefox?</strong></summary>

The MCP server stays alive. On the next `browser_connect`, it launches a fresh Firefox instance.
</details>

<details>
<summary><strong>Does it work headless?</strong></summary>

Yes. `browser_connect { headless: true }`. Note: some services may detect headless browsers.
</details>

<details>
<summary><strong>Can the LLM see sensitive page content?</strong></summary>

Yes -- the LLM sees the same content you would see in the browser. This is inherent to any browser automation tool. The key difference is that **authentication credentials** (cookies, tokens, session IDs) are never in the LLM context.
</details>

## License

AGPL-3.0 -- free to use, modify, and distribute. If you modify and deploy as a network service, you must open-source your changes.
