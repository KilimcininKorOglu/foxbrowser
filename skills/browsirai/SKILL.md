---
name: browsirai
description: Control your live Chrome browser session via MCP tools. Navigate, click, fill forms, take screenshots, read accessibility trees, inspect source code locations, and automate browser interactions.
---

# browsirai

MCP server that connects AI coding agents to a running Chrome browser via Chrome DevTools Protocol. Interact with your live session -- logged-in state, cookies, and all open tabs.

## Prerequisites

- A Chromium-based browser (Chrome, Edge, Brave, Arc) with remote debugging enabled
- Node.js 22+

### Enable Remote Debugging

**Option A** -- Launch Chrome with a flag:

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222

# Windows
chrome.exe --remote-debugging-port=9222
```

**Option B** -- Enable in browser: navigate to `chrome://inspect/#remote-debugging` and toggle the switch.

### Supported Browsers

Chrome, Edge, Brave, Arc, Vivaldi, Opera, Chromium. Discovery works on macOS, Linux, and Windows.

## Quick Start

```bash
# Connect to browser on default port (9222)
browser_connect

# Or specify a custom port/host
browser_connect { "port": 9222, "host": "127.0.0.1" }

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

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | required | URL to navigate to |
| `waitUntil` | `"load"` \| `"domcontentloaded"` \| `"networkidle"` | `"load"` | When to consider navigation complete |

#### `browser_navigate_back`

Navigate back or forward in browser history.

```
browser_navigate_back
browser_navigate_back { "direction": "forward" }
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
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

| Param | Type | Description |
|-------|------|-------------|
| `text` | string | Wait until text appears in page body |
| `textGone` | string | Wait until text disappears from page body |
| `selector` | string | Wait until a CSS selector matches an element |
| `state` | `"hidden"` | Combined with `selector` -- wait until element is hidden |
| `url` | string | Wait until URL matches glob pattern (supports `*` and `**`) |
| `fn` | string | Wait until JS expression evaluates to truthy |
| `time` | number | Simple delay in seconds |
| `timeout` | number | Override timeout (seconds if <=60, milliseconds if >60) |

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

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `selector` | string | - | CSS selector to scope the snapshot |
| `compact` | boolean | false | Hide InlineTextBox nodes and empty wrappers |
| `interactive` | boolean | false | Only show interactive elements (buttons, links, inputs, etc.) |
| `cursor` | boolean | false | Include elements with `cursor:pointer` style |
| `depth` | number | 100 | Maximum tree depth |

Interactive roles included when `interactive: true`: button, link, textbox, checkbox, radio, combobox, listbox, menuitem, menuitemcheckbox, menuitemradio, option, searchbox, slider, spinbutton, switch, tab, treeitem.

#### `browser_screenshot`

Take a screenshot. Returns base64-encoded image data.

```
browser_screenshot
browser_screenshot { "fullPage": true }
browser_screenshot { "selector": "#hero-section" }
browser_screenshot { "format": "jpeg", "quality": 80 }
browser_screenshot { "annotate": true }
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `selector` | string | - | CSS selector to screenshot a specific element |
| `fullPage` | boolean | false | Capture full scrollable page, not just viewport |
| `format` | `"png"` \| `"jpeg"` | `"png"` | Image format |
| `quality` | number | - | JPEG quality (0-100). Only for jpeg format |
| `annotate` | boolean | false | Overlay numbered labels on interactive elements |

#### `browser_html`

Get raw HTML content of the page or a specific element.

```
browser_html
browser_html { "selector": "#app" }
```

| Param | Type | Description |
|-------|------|-------------|
| `selector` | string | CSS selector to scope HTML output |

#### `browser_tabs`

List open browser tabs. Only shows page-type targets (excludes service workers, extensions).

```
browser_tabs
browser_tabs { "filter": "*github.com*" }
```

| Param | Type | Description |
|-------|------|-------------|
| `filter` | string | Glob-style URL filter pattern |

#### `browser_console_messages`

Retrieve captured console messages.

```
browser_console_messages
browser_console_messages { "level": "error" }
browser_console_messages { "limit": 20 }
```

| Param | Type | Description |
|-------|------|-------------|
| `limit` | number | Maximum messages to return (default: 1000, most recent) |
| `level` | `"log"` \| `"info"` \| `"warn"` \| `"error"` | Filter by minimum severity |

#### `browser_network_requests`

List captured network requests.

```
browser_network_requests
browser_network_requests { "filter": "*api*" }
browser_network_requests { "includeHeaders": true, "includeStatic": false }
browser_network_requests { "limit": 10 }
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `filter` | string | - | Glob-style URL filter |
| `limit` | number | - | Maximum requests to return (most recent) |
| `includeHeaders` | boolean | false | Include request/response headers |
| `includeStatic` | boolean | true | Include static resources (JS, CSS, images, fonts) |

### Interaction

#### `browser_click`

Click an element. Supports three targeting methods: ref, selector, or coordinates.

```
browser_click { "ref": "@e5" }
browser_click { "selector": "#submit-btn" }
browser_click { "x": 150, "y": 300 }
browser_click { "ref": "@e2", "newTab": true }
```

| Param | Type | Description |
|-------|------|-------------|
| `ref` | string | `@eN` ref from snapshot |
| `selector` | string | CSS selector |
| `x`, `y` | number | CSS pixel coordinates (see Coordinates section) |
| `newTab` | boolean | Open link in new tab (adds Meta/Ctrl modifier) |

Must provide one of: `ref`, `selector`, or both `x` and `y`.

The click sequence: scrolls element into view, computes center coordinates from the box model, then dispatches mouseMoved -> mousePressed -> 50ms delay -> mouseReleased.

#### `browser_fill_form`

Fill a form field. Clears existing value before typing. Dispatches `input` and `change` events.

```
browser_fill_form { "ref": "@e3", "value": "user@example.com" }
browser_fill_form { "selector": "#search-input", "value": "search query" }
```

| Param | Type | Description |
|-------|------|-------------|
| `ref` | string | `@eN` ref from snapshot |
| `selector` | string | CSS selector |
| `value` | string | Text to enter |

Must provide either `ref` or `selector`.

Handles different field types automatically:
- **textbox**: focus -> clear -> insert text -> dispatch events
- **checkbox/radio**: clicks to toggle
- **combobox (select)**: sets value directly
- **slider**: sets value and dispatches events

Note: Will not fill readonly or disabled fields (returns an error).

#### `browser_type`

Type text into the focused element or a specific ref. Unlike `browser_fill_form`, does NOT clear existing value first.

```
browser_type { "text": "Hello world" }
browser_type { "text": "search term", "ref": "@e3", "submit": true }
browser_type { "text": "slowly typed", "slowly": true }
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `text` | string | required | Text to type |
| `ref` | string | - | `@eN` ref to focus before typing |
| `slowly` | boolean | false | Type character-by-character with key events |
| `submit` | boolean | false | Press Enter after typing |

- **Fast mode** (default): uses `Input.insertText` -- single CDP call, instant.
- **Slow mode** (`slowly: true`): dispatches individual keyDown/char/keyUp per character. Use for apps that listen to individual key events.
- Use `browser_type` (not `browser_evaluate`) to enter text in **cross-origin iframes**.

#### `browser_press_key`

Press a keyboard key or key combination.

```
browser_press_key { "key": "Enter" }
browser_press_key { "key": "Tab" }
browser_press_key { "key": "Control+c" }
browser_press_key { "key": "Control+Shift+a" }
browser_press_key { "key": "Escape" }
```

| Param | Type | Description |
|-------|------|-------------|
| `key` | string | Key name or combination with `+` separator |

Supported keys: Enter, Tab, Escape, Backspace, Delete, ArrowLeft/Up/Right/Down, Home, End, PageUp, PageDown, Space, F1-F12, plus any single character.

Modifier keys: Control, Shift, Alt, Meta. Combine with `+`: `Control+c`, `Meta+a`, `Control+Shift+Tab`.

#### `browser_hover`

Hover over an element. Triggers mouseover/mouseenter events.

```
browser_hover { "ref": "@e7" }
```

| Param | Type | Description |
|-------|------|-------------|
| `ref` | string | `@eN` ref from snapshot (required) |

#### `browser_drag`

Drag from one element to another. Uses synthesized mouse events with intermediate move points.

```
browser_drag { "startRef": "@e3", "endRef": "@e8" }
```

| Param | Type | Description |
|-------|------|-------------|
| `startRef` | string | `@eN` ref for the drag source |
| `endRef` | string | `@eN` ref for the drop target |

Drag sequence: mouseMoved(start) -> mousePressed(start) -> intermediate mouseMoved steps -> mouseMoved(end) -> mouseReleased(end).

#### `browser_scroll`

Scroll the page or a specific element.

```
browser_scroll { "direction": "down" }
browser_scroll { "direction": "down", "pixels": 500 }
browser_scroll { "selector": ".sidebar", "direction": "down" }
browser_scroll { "selector": "#target-element" }
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `direction` | `"up"` \| `"down"` \| `"left"` \| `"right"` | - | Scroll direction |
| `pixels` | number | 300 | Pixels to scroll |
| `selector` | string | - | Scrollable container, or element to scroll into view |

Three modes:
- **selector only** (no direction): scrolls the element into view (centered)
- **selector + direction**: scrolls within that container
- **direction only**: scrolls the page viewport

#### `browser_select_option`

Select option(s) in a `<select>` element. Matches by value attribute or visible label text.

```
browser_select_option { "ref": "@e12", "values": ["us-east-1"] }
browser_select_option { "ref": "@e12", "values": ["Option A", "Option C"] }
```

| Param | Type | Description |
|-------|------|-------------|
| `ref` | string | `@eN` ref (required) |
| `values` | string[] | Values or label text to select |

### Dialog & File

#### `browser_handle_dialog`

Accept or dismiss JavaScript dialogs (alert, confirm, prompt, beforeunload).

```
browser_handle_dialog { "accept": true }
browser_handle_dialog { "accept": false }
browser_handle_dialog { "accept": true, "promptText": "my input" }
```

| Param | Type | Description |
|-------|------|-------------|
| `accept` | boolean | Accept (true) or dismiss (false) the dialog |
| `promptText` | string | Text to enter in a prompt dialog |

Waits up to 5 seconds for a dialog to appear if none is currently pending.

#### `browser_file_upload`

Upload files to a file input element.

```
browser_file_upload { "ref": "@e9", "paths": ["/Users/me/photo.jpg"] }
browser_file_upload { "ref": "@e9", "paths": ["/tmp/doc1.pdf", "/tmp/doc2.pdf"] }
```

| Param | Type | Description |
|-------|------|-------------|
| `ref` | string | `@eN` ref for the file input (required) |
| `paths` | string[] | Absolute file paths to upload |

### Lifecycle

#### `browser_connect`

Connect to a running browser instance via CDP.

```
browser_connect
browser_connect { "port": 9222 }
browser_connect { "host": "192.168.1.10", "port": 9222 }
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | 9222 | Debug port |
| `host` | string | `"127.0.0.1"` | Host address |

#### `browser_list`

List all discoverable browser instances (scans default ports 9222, 9229).

```
browser_list
```

Returns browser name, version, and WebSocket debugger URL for each instance found.

#### `browser_close`

Close or detach from browser tabs.

```
browser_close
browser_close { "force": true }
browser_close { "force": true, "targetId": "ABC123..." }
browser_close { "force": true, "closeAll": true }
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `force` | boolean | false | Actually close tab(s) instead of just detaching |
| `targetId` | string | - | Specific tab to close |
| `closeAll` | boolean | false | Close all page tabs |

Without `force`, simply detaches the session (tabs remain open).

#### `browser_resize`

Resize the browser viewport.

```
browser_resize { "width": 1280, "height": 720 }
browser_resize { "width": 375, "height": 812, "deviceScaleFactor": 3 }
browser_resize { "preset": "mobile" }
```

| Param | Type | Description |
|-------|------|-------------|
| `width` | number | Viewport width in CSS pixels |
| `height` | number | Viewport height in CSS pixels |
| `deviceScaleFactor` | number | Device pixel ratio (DPR) override |
| `preset` | string | Device preset name |

Presets: `mobile` (375x667), `tablet` (768x1024), `desktop` (1280x720), `fullhd` (1920x1080), `reset` (clear override).

Must provide either `width` + `height` together, or a `preset`.

```
browser_resize { "preset": "reset" }
```

Use `preset: "reset"` to clear the device metrics override and restore the browser's native viewport.

### Advanced Observation

#### `browser_annotated_screenshot`

Take a screenshot with numbered labels overlaid on interactive elements. Useful for identifying clickable elements visually.

```
browser_annotated_screenshot
browser_annotated_screenshot { "selector": "#main-content" }
```

| Param | Type | Description |
|-------|------|-------------|
| `selector` | string | CSS selector to scope the annotated area |

Returns an image with numbered labels plus a text index mapping each label to its role, name, and `@eN` ref.

#### `browser_inspect_source`

Inspect a DOM element and return its source code location. Maps UI elements back to their source files -- file path, line number, and component name.

```
browser_inspect_source { "selector": "h1" }
browser_inspect_source { "ref": "@e5" }
browser_inspect_source { "selector": "nav" }
```

| Param | Type | Description |
|-------|------|-------------|
| `ref` | string | `@eN` ref from snapshot |
| `selector` | string | CSS selector |

Must provide either `ref` or `selector`.

Returns:
- **Element**: tag name
- **Component**: nearest framework component name
- **Source**: file path, line number, column number
- **Component Stack**: full ancestor component chain with source locations

Supported frameworks:
- **React**: Walks the Fiber tree and parses `jsxDEV()` calls in `Function.toString()` to extract `fileName`/`lineNumber` embedded by `@babel/plugin-transform-react-jsx-source` (works with Vite, CRA, Next.js dev mode)
- **Vue**: Reads `__vueParentComponent.type.__file`
- **Svelte**: Reads `__svelte_meta.loc`

Note: Only works in **development mode** where source metadata is preserved. Production builds strip this information.

### Code Execution

#### `browser_evaluate`

Evaluate JavaScript in the page context. Supports async expressions.

```
browser_evaluate { "expression": "document.title" }
browser_evaluate { "expression": "document.querySelectorAll('a').length" }
browser_evaluate { "expression": "await fetch('/api/status').then(r => r.json())" }
```

| Param | Type | Description |
|-------|------|-------------|
| `expression` | string | JavaScript expression to evaluate |
| `frameId` | string | Target frame ID for execution |

Returns the evaluated result. Handles primitives, objects, DOM nodes (serialized to description), null, and undefined. Async expressions are awaited automatically.

## Coordinates

Screenshot image dimensions differ from CSS pixel dimensions due to device pixel ratio (DPR).

```
Screenshot pixels = CSS pixels x DPR
CSS pixels = Screenshot pixels / DPR
```

- `browser_screenshot` detects DPR using a 3-level cascade: Page.getLayoutMetrics -> Emulation.getDeviceMetricsOverride -> window.devicePixelRatio
- `browser_click` coordinates (`x`, `y`) use **CSS pixels**
- Typical Retina display: DPR = 2, so divide screenshot pixel coordinates by 2

## Security

Network requests are automatically redacted to prevent secret leakage:

- **Headers**: Authorization, Cookie, Set-Cookie, X-API-Key, X-Auth-Token, X-CSRF-Token, Proxy-Authorization, and other auth-related headers are replaced with `[REDACTED]`
- **Body fields**: password, secret, token, api_key, apiKey, access_token, refresh_token, client_secret, private_key are redacted in JSON bodies
- **Inline secrets**: JWTs (`eyJ...`) are replaced with `[REDACTED_JWT]`, Bearer tokens with `Bearer [REDACTED]`

## Tips & Best Practices

- **Prefer `browser_snapshot` over `browser_html`** for understanding page structure. The accessibility tree is semantic, compact, and provides `@eN` refs for interaction.
- **Use `@eN` refs for reliable targeting.** Refs are tied to accessibility tree nodes and resolve to exact DOM elements. CSS selectors can be fragile if the DOM changes.
- **Use `browser_type` for cross-origin iframes** -- `browser_evaluate` cannot access cross-origin content, but `Input.insertText` works regardless of origin.
- **`browser_fill_form` clears existing value** before typing. Use `browser_type` if you want to append to existing text.
- **Check `browser_console_messages` after interactions** to catch JavaScript errors or failed API calls.
- **Take a new snapshot after navigation or DOM changes.** Refs from old snapshots become stale.
- **Use `browser_snapshot { "interactive": true }`** on complex pages to filter to only actionable elements (buttons, links, inputs).
- **Use `browser_snapshot { "compact": true }`** to reduce noise from inline text nodes.
- **Scroll before screenshotting** if the target content is below the fold. Use `browser_scroll { "direction": "down" }` or `browser_scroll { "selector": "#element" }` to scroll it into view.

## Common Patterns

### Login Flow

```
# 1. Navigate to login page
browser_navigate { "url": "https://app.example.com/login" }

# 2. Snapshot to find form fields
browser_snapshot

# 3. Fill email and password (using refs from snapshot)
browser_fill_form { "ref": "@e3", "value": "user@example.com" }
browser_fill_form { "ref": "@e4", "value": "mypassword123" }

# 4. Click the login button
browser_click { "ref": "@e5" }

# 5. Wait for navigation to complete
browser_wait_for { "url": "**/dashboard**" }

# 6. Verify with screenshot
browser_screenshot
```

### Form Filling

```
# 1. Navigate and snapshot
browser_navigate { "url": "https://app.example.com/settings" }
browser_snapshot { "interactive": true }

# 2. Fill each field using refs
browser_fill_form { "ref": "@e2", "value": "John Doe" }
browser_fill_form { "ref": "@e3", "value": "john@example.com" }
browser_select_option { "ref": "@e4", "values": ["UTC-5"] }

# 3. Submit the form
browser_click { "ref": "@e6" }

# 4. Wait for confirmation
browser_wait_for { "text": "Settings saved" }
```

### Data Extraction

```
# 1. Navigate to the data page
browser_navigate { "url": "https://example.com/products" }

# 2. Use evaluate to extract structured data
browser_evaluate { "expression": "JSON.stringify([...document.querySelectorAll('.product')].map(el => ({ name: el.querySelector('h2').textContent, price: el.querySelector('.price').textContent })))" }
```

### Visual Testing

```
# 1. Navigate and set viewport
browser_navigate { "url": "https://example.com" }
browser_resize { "width": 1440, "height": 900 }
browser_screenshot { "fullPage": true }

# 2. Test mobile viewport
browser_resize { "width": 375, "height": 812, "deviceScaleFactor": 3 }
browser_screenshot { "fullPage": true }
```

### Debugging API Calls

```
# 1. Navigate and perform actions
browser_navigate { "url": "https://app.example.com" }
browser_click { "ref": "@e5" }

# 2. Check network requests for API calls
browser_network_requests { "filter": "*api*", "includeStatic": false }

# 3. Check for console errors
browser_console_messages { "level": "error" }
```

### Waiting for Dynamic Content

```
# Wait for text to appear after an action
browser_click { "ref": "@e3" }
browser_wait_for { "text": "Results loaded" }

# Wait for a loading spinner to disappear
browser_wait_for { "selector": ".spinner", "state": "hidden" }

# Wait for a custom JS condition
browser_wait_for { "fn": "window.__dataLoaded === true" }

# Wait for URL to change after form submission
browser_wait_for { "url": "**/confirmation**" }
```

### Finding Source Code for UI Elements

```
# 1. Snapshot the page to identify elements
browser_snapshot

# 2. Inspect a specific element's source
browser_inspect_source { "ref": "@e5" }
# → Component: Hero
# → Source: /src/routes/index.tsx:64:11

# 3. Or use a CSS selector directly
browser_inspect_source { "selector": "nav" }
# → Component: Navbar
# → Source: /src/components/Navbar.tsx:12:5
```

### Working with Multiple Tabs

```
# List all tabs
browser_tabs

# Open a link in a new tab
browser_click { "ref": "@e10", "newTab": true }

# List tabs again to see the new one
browser_tabs

# Close a specific tab by its target ID
browser_close { "force": true, "targetId": "TARGET_ID_HERE" }
```
