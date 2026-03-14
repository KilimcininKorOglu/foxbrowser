---
name: browsirai
description: Control your live Firefox browser session via MCP tools. Navigate, click, fill forms, take screenshots, read accessibility trees, inspect source code locations, intercept network requests, and automate browser interactions.
---

# browsirai

MCP server that connects AI coding agents to a running Firefox browser via WebDriver BiDi. Interact with your live session -- logged-in state, cookies, and all open tabs.

## Prerequisites

- Firefox (stable, Developer Edition, or Nightly)
- Node.js 22+

### Enable Remote Debugging

Launch Firefox with the remote debugging flag:

```bash
# macOS
/Applications/Firefox.app/Contents/MacOS/firefox --remote-debugging-port=9222

# Linux
firefox --remote-debugging-port=9222

# Windows
"C:\Program Files\Mozilla Firefox\firefox.exe" --remote-debugging-port=9222
```

browsirai auto-launches Firefox if not already running with debugging enabled. If Firefox is running without debugging, a separate instance is launched on port 9444 with a temporary profile.

## Quick Start

```bash
# Connect to Firefox via BiDi (auto-launches if needed)
browser_connect

# Connect in headless mode
browser_connect { "headless": true }

# List all open tabs
browser_tabs

# Navigate to a URL
browser_navigate { "url": "https://example.com" }

# Take a snapshot to see the page structure
browser_snapshot
```

## Core Workflow

The **snapshot-ref interaction pattern** is the primary way to work with page elements:

1. **Snapshot** -- Call `browser_snapshot` to get the accessibility tree. Each element receives an `@eN` ref (e.g., `@e1`, `@e2`, `@e15`).
2. **Interact** -- Use the `@eN` ref in `browser_click`, `browser_fill_form`, `browser_hover`, etc.
3. **Verify** -- Call `browser_screenshot` to visually confirm the result, or `browser_snapshot` again to check updated state.

Example snapshot output:

```
@e1 heading "Welcome" level=1
@e2 link "Sign In"
@e3 textbox "Email" value=""
@e4 textbox "Password" value=""
@e5 button "Log In"
@e6 checkbox "Remember me"
```

After a snapshot, refs remain valid until the page navigates or the DOM changes significantly. If a tool fails with "invalid ref", take a new snapshot.

## Tools Reference

### Navigation

#### `browser_navigate`

Navigate to a URL. Waits for the page to load.

```
browser_navigate { "url": "https://github.com" }
browser_navigate { "url": "https://example.com", "waitUntil": "networkidle" }
```

| Param       | Type                                                   | Default  | Description                         |
| ----------- | ------------------------------------------------------ | -------- | ----------------------------------- |
| `url`       | string                                                 | required | URL to navigate to                  |
| `waitUntil` | `"load"` \| `"domcontentloaded"` \| `"networkidle"` | `"load"` | When to consider navigation complete |

#### `browser_navigate_back`

Navigate back or forward in browser history.

```
browser_navigate_back
browser_navigate_back { "direction": "forward" }
```

| Param       | Type                      | Default  | Description                 |
| ----------- | ------------------------- | -------- | --------------------------- |
| `direction` | `"back"` \| `"forward"` | `"back"` | History navigation direction |

#### `browser_wait_for`

Wait for a condition before proceeding. Default timeout: 30 seconds.

```
browser_wait_for { "text": "Successfully saved" }
browser_wait_for { "textGone": "Loading..." }
browser_wait_for { "selector": ".results-table" }
browser_wait_for { "selector": ".modal", "state": "hidden" }
browser_wait_for { "url": "**/dashboard**" }
browser_wait_for { "fn": "document.querySelectorAll('.item').length > 5" }
browser_wait_for { "time": 2 }
```

| Param      | Type       | Description                                              |
| ---------- | ---------- | -------------------------------------------------------- |
| `text`     | string     | Wait until text appears in page body                     |
| `textGone` | string     | Wait until text disappears from page body                |
| `selector` | string     | Wait until a CSS selector matches an element             |
| `state`    | `"hidden"` | Combined with `selector` -- wait until element is hidden |
| `url`      | string     | Wait until URL matches glob pattern (`*` and `**`)       |
| `fn`       | string     | Wait until JS expression evaluates to truthy             |
| `time`     | number     | Simple delay in seconds                                  |
| `timeout`  | number     | Override timeout (seconds if <=60, ms if >60)            |

### Observation

#### `browser_snapshot`

Capture the accessibility tree with `@eN` refs. This is the primary tool for understanding page structure.

```
browser_snapshot
browser_snapshot { "compact": true }
browser_snapshot { "interactive": true }
browser_snapshot { "selector": "#main-content" }
browser_snapshot { "depth": 3 }
```

| Param         | Type    | Default | Description                                                    |
| ------------- | ------- | ------- | -------------------------------------------------------------- |
| `selector`    | string  | -       | CSS selector to scope the snapshot                             |
| `compact`     | boolean | false   | Hide InlineTextBox nodes and empty wrappers                    |
| `interactive` | boolean | false   | Only show interactive elements (buttons, links, inputs, etc.)  |
| `cursor`      | boolean | false   | Include elements with `cursor:pointer` style                   |
| `depth`       | number  | 100     | Maximum tree depth                                             |

#### `browser_screenshot`

Take a screenshot. Returns base64-encoded image data.

```
browser_screenshot
browser_screenshot { "fullPage": true }
browser_screenshot { "selector": "#hero-section" }
browser_screenshot { "format": "jpeg", "quality": 80 }
```

| Param      | Type                   | Default | Description                                 |
| ---------- | ---------------------- | ------- | ------------------------------------------- |
| `selector` | string                 | -       | CSS selector to screenshot a specific element |
| `fullPage` | boolean                | false   | Capture full scrollable page                |
| `format`   | `"png"` \| `"jpeg"` | `"png"` | Image format                                |
| `quality`  | number                 | -       | JPEG quality (0-100)                        |
| `visual`   | boolean                | false   | Force returning the actual image            |

#### `browser_html`

Get raw HTML content of the page or a specific element.

```
browser_html
browser_html { "selector": "#app" }
```

| Param      | Type   | Description                     |
| ---------- | ------ | ------------------------------- |
| `selector` | string | CSS selector to scope HTML output |

#### `browser_tabs`

List open browser tabs.

```
browser_tabs
browser_tabs { "filter": "*github.com*" }
```

| Param    | Type   | Description                |
| -------- | ------ | -------------------------- |
| `filter` | string | Glob-style URL filter pattern |

#### `browser_console_messages`

Retrieve captured console messages.

```
browser_console_messages
browser_console_messages { "level": "error" }
browser_console_messages { "limit": 20 }
```

| Param   | Type                                             | Description                   |
| ------- | ------------------------------------------------ | ----------------------------- |
| `limit` | number                                           | Maximum messages to return    |
| `level` | `"log"` \| `"info"` \| `"warn"` \| `"error"` | Filter by minimum severity    |

#### `browser_network_requests`

List captured network requests.

```
browser_network_requests
browser_network_requests { "filter": "*api*" }
browser_network_requests { "includeHeaders": true, "includeStatic": false }
```

| Param            | Type    | Default | Description                          |
| ---------------- | ------- | ------- | ------------------------------------ |
| `filter`         | string  | -       | Glob-style URL filter                |
| `limit`          | number  | -       | Maximum requests to return           |
| `includeHeaders` | boolean | false   | Include request/response headers     |
| `includeStatic`  | boolean | true    | Include static resources (JS, CSS, images) |

#### `browser_annotated_screenshot`

Take a screenshot with numbered labels overlaid on interactive elements.

```
browser_annotated_screenshot
browser_annotated_screenshot { "selector": "#main-content" }
```

| Param      | Type   | Description                         |
| ---------- | ------ | ----------------------------------- |
| `selector` | string | CSS selector to scope the annotation |

#### `browser_inspect_source`

Inspect a DOM element and return its source code location (file path, line number, component name).

```
browser_inspect_source { "ref": "@e5" }
browser_inspect_source { "selector": "nav" }
```

| Param      | Type   | Description              |
| ---------- | ------ | ------------------------ |
| `ref`      | string | `@eN` ref from snapshot  |
| `selector` | string | CSS selector             |

Supported frameworks: React, Vue, Svelte. Only works in development mode.

#### `browser_find`

Find elements by ARIA role, accessible name, or text content. Returns `@eN` refs for use with other tools.

```
browser_find { "role": "button" }
browser_find { "name": "Submit" }
browser_find { "text": "Sign in" }
browser_find { "role": "link", "name": "Home", "nth": 2 }
```

| Param  | Type   | Description                             |
| ------ | ------ | --------------------------------------- |
| `role` | string | ARIA role to match                      |
| `name` | string | Accessible name to match                |
| `text` | string | Text content to match                   |
| `nth`  | number | Select the Nth match (1-based)          |

#### `browser_diff`

Compare two screenshots pixel-by-pixel. Returns diff percentage and visual diff image.

```
browser_diff { "before": "current" }
browser_diff { "before": "<base64>", "after": "current" }
browser_diff { "before": "current", "selector": "#hero", "threshold": 50 }
```

| Param       | Type   | Default | Description                            |
| ----------- | ------ | ------- | -------------------------------------- |
| `before`    | string | required | Base64 screenshot or `"current"`      |
| `after`     | string | `"current"` | Base64 screenshot or `"current"` |
| `selector`  | string | -       | CSS selector to scope comparison       |
| `threshold` | number | 30      | Color difference threshold (0-255)     |

### Interaction

#### `browser_click`

Click an element. Supports three targeting methods: ref, selector, or coordinates.

```
browser_click { "ref": "@e5" }
browser_click { "selector": "#submit-btn" }
browser_click { "x": 150, "y": 300 }
browser_click { "ref": "@e2", "newTab": true }
```

| Param    | Type    | Description                                   |
| -------- | ------- | --------------------------------------------- |
| `ref`    | string  | `@eN` ref from snapshot                       |
| `selector` | string | CSS selector                                 |
| `x`, `y` | number | CSS pixel coordinates                         |
| `newTab` | boolean | Open link in new tab (adds Meta/Ctrl modifier) |

#### `browser_fill_form`

Fill a form field. Clears existing value before typing. Dispatches `input` and `change` events.

```
browser_fill_form { "ref": "@e3", "value": "user@example.com" }
browser_fill_form { "selector": "#search-input", "value": "search query" }
```

| Param      | Type   | Description         |
| ---------- | ------ | ------------------- |
| `ref`      | string | `@eN` ref           |
| `selector` | string | CSS selector         |
| `value`    | string | Text to enter        |

#### `browser_type`

Type text into the focused element or a specific ref. Does NOT clear existing value first.

```
browser_type { "text": "Hello world" }
browser_type { "text": "search term", "ref": "@e3", "submit": true }
browser_type { "text": "slowly typed", "slowly": true }
```

| Param    | Type    | Default | Description                              |
| -------- | ------- | ------- | ---------------------------------------- |
| `text`   | string  | required | Text to type                            |
| `ref`    | string  | -       | `@eN` ref to focus before typing         |
| `slowly` | boolean | false   | Type character-by-character with key events |
| `submit` | boolean | false   | Press Enter after typing                 |

#### `browser_press_key`

Press a keyboard key or key combination.

```
browser_press_key { "key": "Enter" }
browser_press_key { "key": "Tab" }
browser_press_key { "key": "Control+c" }
browser_press_key { "key": "Escape" }
```

| Param | Type   | Description                         |
| ----- | ------ | ----------------------------------- |
| `key` | string | Key name or combination with `+` separator |

#### `browser_hover`

Hover over an element.

```
browser_hover { "ref": "@e7" }
```

| Param | Type   | Description                     |
| ----- | ------ | ------------------------------- |
| `ref` | string | `@eN` ref from snapshot (required) |

#### `browser_drag`

Drag from one element to another.

```
browser_drag { "startRef": "@e3", "endRef": "@e8" }
```

| Param      | Type   | Description             |
| ---------- | ------ | ----------------------- |
| `startRef` | string | `@eN` ref for drag source |
| `endRef`   | string | `@eN` ref for drop target |

#### `browser_scroll`

Scroll the page or a specific element.

```
browser_scroll { "direction": "down" }
browser_scroll { "direction": "down", "pixels": 500 }
browser_scroll { "selector": ".sidebar", "direction": "down" }
browser_scroll { "selector": "#target-element" }
```

| Param       | Type                                               | Default | Description                      |
| ----------- | -------------------------------------------------- | ------- | -------------------------------- |
| `direction` | `"up"` \| `"down"` \| `"left"` \| `"right"` | -       | Scroll direction                 |
| `pixels`    | number                                             | 300     | Pixels to scroll                 |
| `selector`  | string                                             | -       | Scrollable container or element  |

#### `browser_select_option`

Select option(s) in a `<select>` element.

```
browser_select_option { "ref": "@e12", "values": ["us-east-1"] }
```

| Param    | Type     | Description                   |
| -------- | -------- | ----------------------------- |
| `ref`    | string   | `@eN` ref (required)          |
| `values` | string[] | Values or label text to select |

### Dialog & File

#### `browser_handle_dialog`

Accept or dismiss JavaScript dialogs (alert, confirm, prompt, beforeunload).

```
browser_handle_dialog { "accept": true }
browser_handle_dialog { "accept": true, "promptText": "my input" }
```

| Param        | Type    | Description                       |
| ------------ | ------- | --------------------------------- |
| `accept`     | boolean | Accept (true) or dismiss (false)  |
| `promptText` | string  | Text to enter in a prompt dialog  |

#### `browser_file_upload`

Upload files to a file input element.

```
browser_file_upload { "ref": "@e9", "paths": ["/Users/me/photo.jpg"] }
```

| Param   | Type     | Description                       |
| ------- | -------- | --------------------------------- |
| `ref`   | string   | `@eN` ref for the file input      |
| `paths` | string[] | Absolute file paths to upload     |

### Network Interception

#### `browser_route`

Intercept requests matching a URL pattern and respond with a custom body.

```
browser_route { "url": "https://api.example.com/users", "body": "{\"users\":[]}" }
browser_route { "url": "https://api.example.com/**", "body": "OK", "status": 200 }
```

| Param     | Type                    | Default                              | Description                |
| --------- | ----------------------- | ------------------------------------ | -------------------------- |
| `url`     | string                  | required                             | URL glob pattern to match  |
| `body`    | string                  | required                             | Response body              |
| `status`  | number                  | 200                                  | HTTP status code           |
| `headers` | Record<string, string>  | `{"Content-Type":"application/json"}` | Response headers          |

#### `browser_abort`

Block requests matching a URL pattern.

```
browser_abort { "url": "https://ads.example.com/**" }
```

| Param | Type   | Description               |
| ----- | ------ | ------------------------- |
| `url` | string | URL glob pattern to block |

#### `browser_unroute`

Remove request intercept rules.

```
browser_unroute { "url": "https://api.example.com/**" }
browser_unroute { "all": true }
```

| Param | Type    | Description                  |
| ----- | ------- | ---------------------------- |
| `url` | string  | Specific pattern to remove   |
| `all` | boolean | Remove all intercept rules   |

### Session State

#### `browser_save_state`

Save browser state (cookies, localStorage, sessionStorage) to a named file.

```
browser_save_state { "name": "logged-in" }
```

| Param  | Type   | Description                           |
| ------ | ------ | ------------------------------------- |
| `name` | string | State name (alphanumeric, hyphens, underscores only) |

#### `browser_load_state`

Load a previously saved browser state.

```
browser_load_state { "name": "logged-in" }
browser_load_state { "name": "logged-in", "url": "https://app.example.com" }
```

| Param  | Type   | Description                            |
| ------ | ------ | -------------------------------------- |
| `name` | string | State name to load                     |
| `url`  | string | URL to navigate to after loading state |

### Lifecycle

#### `browser_connect`

Connect to Firefox via WebDriver BiDi.

```
browser_connect
browser_connect { "headless": true }
browser_connect { "port": 9222 }
```

| Param      | Type    | Default       | Description                |
| ---------- | ------- | ------------- | -------------------------- |
| `port`     | number  | 9222          | Debug port                 |
| `host`     | string  | `"127.0.0.1"` | Host address              |
| `headless` | boolean | false         | Launch in headless mode    |

#### `browser_list`

List available browser instances.

```
browser_list
```

#### `browser_close`

Close browser tabs. When `closeAll` is used, the browsirai-launched Firefox process is also terminated.

```
browser_close
browser_close { "force": true }
browser_close { "force": true, "closeAll": true }
```

| Param      | Type    | Default | Description                  |
| ---------- | ------- | ------- | ---------------------------- |
| `force`    | boolean | false   | Actually close tab(s)        |
| `targetId` | string  | -       | Specific tab to close        |
| `closeAll` | boolean | false   | Close all tabs + Firefox     |

#### `browser_resize`

Resize the browser viewport.

```
browser_resize { "width": 1280, "height": 720 }
browser_resize { "preset": "mobile" }
browser_resize { "preset": "reset" }
```

| Param              | Type   | Description                    |
| ------------------ | ------ | ------------------------------ |
| `width`            | number | Viewport width in CSS pixels   |
| `height`           | number | Viewport height in CSS pixels  |
| `deviceScaleFactor` | number | Device pixel ratio override   |
| `preset`           | string | `mobile`, `tablet`, `desktop`, `fullhd`, `reset` |

### Code Execution

#### `browser_evaluate`

Evaluate JavaScript in the page context.

```
browser_evaluate { "expression": "document.title" }
browser_evaluate { "expression": "await fetch('/api/status').then(r => r.json())" }
```

| Param        | Type   | Description                         |
| ------------ | ------ | ----------------------------------- |
| `expression` | string | JavaScript expression to evaluate   |
| `frameId`    | string | Target frame ID for execution       |

## Security

Network requests are automatically redacted to prevent secret leakage:

- **Headers**: Authorization, Cookie, Set-Cookie, X-API-Key, X-Auth-Token, X-CSRF-Token, Proxy-Authorization, and other auth-related headers are replaced with `[REDACTED]`
- **URL query parameters**: Sensitive parameters (token, api_key, access_token, etc.) are redacted in URLs
- **Body fields**: password, secret, token, api_key, apiKey, access_token, refresh_token, client_secret, private_key are redacted in JSON bodies
- **Non-JSON bodies**: JWTs and Bearer tokens are detected and redacted in plain text, XML, and form-encoded bodies
- **Inline secrets**: JWTs (`eyJ...`) are replaced with `[REDACTED_JWT]`, Bearer tokens with `Bearer [REDACTED]`

## Tips

- Prefer `browser_snapshot` over `browser_html` for page understanding. The accessibility tree is semantic, compact, and provides `@eN` refs.
- Use `@eN` refs for reliable targeting. CSS selectors can break if the DOM changes.
- `browser_fill_form` clears existing value. Use `browser_type` to append.
- Check `browser_console_messages` after interactions to catch errors.
- Take a new snapshot after navigation or DOM changes. Old refs become stale.
- Use `browser_snapshot { "interactive": true }` on complex pages to filter to actionable elements.
- Use `browser_find` to locate elements by role or name when you know what to look for.
- Use `browser_route` / `browser_abort` to mock or block API calls during testing.
- Use `browser_save_state` / `browser_load_state` to persist login sessions across runs.

## Common Patterns

### Login Flow

```
browser_navigate { "url": "https://app.example.com/login" }
browser_snapshot
browser_fill_form { "ref": "@e3", "value": "user@example.com" }
browser_fill_form { "ref": "@e4", "value": "mypassword123" }
browser_click { "ref": "@e5" }
browser_wait_for { "url": "**/dashboard**" }
browser_save_state { "name": "logged-in" }
```

### Mock API Responses

```
browser_route { "url": "https://api.example.com/users", "body": "{\"users\":[{\"name\":\"Test\"}]}", "status": 200 }
browser_navigate { "url": "https://app.example.com/users" }
browser_snapshot
browser_unroute { "all": true }
```

### Data Extraction

```
browser_navigate { "url": "https://example.com/products" }
browser_evaluate { "expression": "JSON.stringify([...document.querySelectorAll('.product')].map(el => ({ name: el.querySelector('h2').textContent, price: el.querySelector('.price').textContent })))" }
```

### Visual Regression Testing

```
browser_navigate { "url": "https://example.com" }
browser_diff { "before": "current" }
# ... make changes ...
browser_diff { "before": "<previous_base64>", "after": "current" }
```

### Debugging API Calls

```
browser_navigate { "url": "https://app.example.com" }
browser_click { "ref": "@e5" }
browser_network_requests { "filter": "*api*", "includeStatic": false }
browser_console_messages { "level": "error" }
```
