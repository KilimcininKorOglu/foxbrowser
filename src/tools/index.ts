/**
 * Tool registry: Zod schemas and MCP tool registration for all browser tools.
 *
 * Wires real tool implementations to the MCP server with lazy BiDi connection.
 * On first tool call, connects to Firefox via WebDriver BiDi.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BiDiConnection } from "../bidi/connection.js";
import { connectFirefox, launchHeadlessFirefox, quitFirefox } from "../firefox-launcher.js";

// Tool implementations
import { browserNavigate } from "./browser-navigate.js";
import { browserScreenshot } from "./browser-screenshot.js";
import { browserTabs } from "./browser-tabs.js";
import { browserEval } from "./browser-eval.js";
import { browserSnapshot } from "./browser-snapshot.js";
import { browserClick } from "./browser-click.js";
import { browserScroll } from "./browser-scroll.js";
import { browserHtml } from "./browser-html.js";
import { browserNavigateBack } from "./browser-navigate-back.js";
import { browserPressKey } from "./browser-press-key.js";
import { browserHover } from "./browser-hover.js";
import { browserResize } from "./browser-resize.js";
import { browserClose } from "./browser-close.js";
import { browserFillForm } from "./browser-fill-form.js";
import { browserType } from "./browser-type.js";
import { browserSelectOption } from "./browser-select-option.js";
import { browserWaitFor } from "./browser-wait-for.js";
import { browserDrag } from "./browser-drag.js";
import { browserHandleDialog } from "./browser-handle-dialog.js";
import { browserFileUpload } from "./browser-file-upload.js";
import { browserNetworkRequests, setupNetworkCapture, resetNetworkBuffer } from "./browser-network-requests.js";
import { browserConsoleMessages, setupConsoleCapture, resetConsoleBuffer } from "./browser-console-messages.js";
import { browserAnnotatedScreenshot } from "./browser-annotated-screenshot.js";
import { browserInspectSource } from "./browser-inspect-source.js";
import { browserRoute, browserAbort, browserUnroute, resetInterceptState } from "./browser-intercept.js";
import { browserFind } from "./browser-find.js";
import { browserDiff } from "./browser-diff.js";
import { browserSaveState, browserLoadState } from "./browser-session-state.js";

// ---------------------------------------------------------------------------
// Lazy BiDi connection — connects to Firefox via WebDriver BiDi
// ---------------------------------------------------------------------------

let bidiConnection: BiDiConnection | null = null;

let headlessMode = process.env.FOXBROWSER_HEADLESS === "1" || process.env.FOXBROWSER_HEADLESS === "true";

function attachLifecycleListeners(conn: BiDiConnection): void {
  const resetState = () => {
    bidiConnection = null;
    resetConsoleBuffer();
    resetNetworkBuffer();
    resetInterceptState();
  };
  conn.on("reconnectionFailed", resetState);
  conn.on("browserCrashed", resetState);
}

async function getBiDi(): Promise<BiDiConnection> {
  if (bidiConnection?.isConnected) {
    return bidiConnection;
  }

  if (headlessMode) {
    const launch = await launchHeadlessFirefox();
    if (!launch.success) {
      throw new Error(launch.error ?? "Failed to launch headless Firefox.");
    }
    const wsUrl = launch.wsEndpoint ?? `ws://127.0.0.1:${launch.port}/session`;

    bidiConnection = new BiDiConnection(wsUrl);
    await bidiConnection.connect();
    attachLifecycleListeners(bidiConnection);

    // Subscribe to BiDi events for console + network capture
    try {
      await bidiConnection.send("session.subscribe", {
        events: ["log.entryAdded", "network.beforeRequestSent", "network.responseCompleted"],
      });
    } catch { /* non-fatal */ }

    setupConsoleCapture(bidiConnection as any);
    setupNetworkCapture(bidiConnection as any);

    await initDefaultContext(bidiConnection);

    return bidiConnection;
  }

  const connection = await connectFirefox({ autoLaunch: true });

  if (!connection.success) {
    throw new Error(
      connection.error ?? "Cannot connect to Firefox. Run `foxbrowser doctor` to set up."
    );
  }

  const wsUrl = connection.wsEndpoint ?? `ws://127.0.0.1:${connection.port}/session`;

  bidiConnection = new BiDiConnection(wsUrl);
  await bidiConnection.connect();
  attachLifecycleListeners(bidiConnection);

  // Subscribe to BiDi events for console + network capture
  try {
    await bidiConnection.send("session.subscribe", {
      events: ["log.entryAdded", "network.beforeRequestSent", "network.responseCompleted"],
    });
  } catch { /* non-fatal */ }

  setupConsoleCapture(bidiConnection as any);
  setupNetworkCapture(bidiConnection as any);

  await initDefaultContext(bidiConnection);

  return bidiConnection;
}

async function initDefaultContext(conn: BiDiConnection): Promise<void> {
  try {
    const tree = (await conn.send("browsingContext.getTree", {})) as {
      contexts: Array<{ context: string; url: string }>;
    };
    const ctx = tree.contexts.find(c => !c.url.startsWith("about:")) ?? tree.contexts[0];
    if (ctx) conn.setDefaultContext(ctx.context);
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Helper: format tool response
// ---------------------------------------------------------------------------

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function imageResult(base64: string, mimeType: string = "image/png") {
  return {
    content: [{
      type: "image" as const,
      data: base64,
      mimeType,
    }],
  };
}

function errorResult(msg: string) {
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

// ---------------------------------------------------------------------------
// SKILL injection (on connect) & per-tool hints
// ---------------------------------------------------------------------------

const SKILL_SUMMARY = `Connected to Firefox via WebDriver BiDi.

## foxbrowser — Quick Reference

**Cost hierarchy (cheapest first):**
1. \`browser_evaluate\` — JS expression for single values (~10 tokens). Use when you need one data point (count, text, attribute).
2. \`browser_snapshot\` — accessibility tree with @eN refs (~500 tokens). Use for page understanding and interaction.
3. \`browser_screenshot { visual: true }\` — full image (~10K tokens). ONLY for layout/colors/visual bugs.

**Core workflow: snapshot → ref → interact → snapshot**

1. \`browser_snapshot\` — get accessibility tree with @eN refs
2. Use @eN refs with: \`browser_click\`, \`browser_fill_form\`, \`browser_hover\`, \`browser_type\`, \`browser_select_option\`, \`browser_drag\`, \`browser_inspect_source\`
3. \`browser_snapshot\` — verify result (ALWAYS use this)

**Cost optimization (enforced server-side):**
- \`browser_screenshot\` without \`visual: true\` auto-returns snapshot text
- For single data extraction: \`browser_evaluate\` > \`browser_snapshot\` (50x cheaper)
- Reserve \`browser_screenshot { visual: true }\` for CSS/layout debugging only

**Identity resolution (cookie-based, always-first):**
- NEVER guess usernames. The browser has an active session — use it.
- To find the logged-in user: \`browser_evaluate\` on the site (e.g. GitHub avatar menu, X profile link).
- When asked "go to my profile/repo/account" → navigate to the site root first, extract identity from session, then proceed.
- Cookie sync means the browser IS the user. Trust the session, not assumptions.

**Key patterns:**
- \`browser_fill_form\` clears existing value. Use \`browser_type\` to append.
- \`browser_type\` with \`submit: true\` presses Enter after typing.
- \`browser_wait_for\` — wait for text, selector, URL, or JS condition before proceeding.
- \`browser_inspect_source\` — find source file, line, component name (React/Vue/Svelte, dev mode only).
- \`browser_resize\` with \`preset: "reset"\` — restore native viewport.
- Refs become stale after navigation or major DOM changes — take a new snapshot.
- \`browser_evaluate\` cannot access cross-origin iframes — use \`browser_type\` instead.
- \`browser_console_messages\` / \`browser_network_requests\` — check for errors after interactions.`;

const toolHints: Record<string, string> = {
  browser_navigate: "\n\n→ Next: browser_evaluate for quick data extraction (~10 tokens), or browser_snapshot for page structure and @eN refs (~500 tokens).",
  browser_navigate_back: "\n\n→ Next: browser_snapshot to see updated page.",
  browser_snapshot: "\n\n→ Next: Use @eN refs with browser_click, browser_fill_form, browser_hover, browser_type, browser_select_option, browser_drag, or browser_inspect_source.",
  browser_screenshot: "\n\n→ Cost: This call was auto-optimized to snapshot text. For full image, pass { visual: true }. Prefer browser_snapshot (~500 tokens) over browser_screenshot (~10K tokens).",
  browser_annotated_screenshot: "\n\n→ Cost: ~12K tokens. Consider browser_snapshot { interactive: true } (~500 tokens) for same info as text.",
  browser_click: "\n\n→ Next: browser_snapshot to verify result. Refs may be stale after DOM changes.",
  browser_fill_form: "\n\n→ Next: browser_snapshot to verify. Note: fill_form clears existing value first.",
  browser_type: "\n\n→ Tip: Use submit: true to press Enter. Does NOT clear existing value (unlike fill_form).",
  browser_press_key: "\n\n→ Next: browser_snapshot to verify effect.",
  browser_hover: "\n\n→ Next: browser_snapshot to verify hover state. Use browser_screenshot { visual: true } only for visual hover effects.",
  browser_drag: "\n\n→ Next: browser_snapshot to verify drag result.",
  browser_scroll: "\n\n→ Next: browser_snapshot to see new viewport content.",
  browser_select_option: "\n\n→ Next: browser_snapshot to verify selection.",
  browser_handle_dialog: "\n\n→ Next: browser_snapshot to see page state after dialog.",
  browser_file_upload: "\n\n→ Next: browser_snapshot to verify upload.",
  browser_wait_for: "\n\n→ Next: browser_snapshot to see current page state.",
  browser_resize: "\n\n→ Next: browser_snapshot to verify viewport. Use browser_screenshot { visual: true } only to check visual layout. Use preset: \"reset\" to restore.",
  browser_close: "\n\n→ Next: browser_tabs to see remaining tabs.",
  browser_evaluate: "\n\n→ Tip: Cheapest tool (~10 tokens). Use for single data extraction (counts, text, attributes). Prefer browser_snapshot + @eN refs for DOM interaction. Cannot access cross-origin iframes.",
  browser_html: "\n\n→ Tip: Prefer browser_snapshot for structured page understanding with @eN refs.",
  browser_tabs: "\n\n→ Tip: Use browser_navigate to open a URL in current tab.",
  browser_console_messages: "\n\n→ Tip: Use level: \"error\" to filter for errors only.",
  browser_network_requests: "\n\n→ Tip: Use filter: \"*api*\" and includeStatic: false for API calls only.",
  browser_inspect_source: "\n\n→ Tip: Dev mode only. Use browser_snapshot first to get @eN refs for specific elements.",
  browser_route: "\n\n→ Tip: Use browser_network_requests to verify intercepted responses. Use browser_unroute to remove.",
  browser_abort: "\n\n→ Tip: Use browser_network_requests to verify blocked requests. Use browser_unroute to remove.",
  browser_unroute: "\n\n→ Tip: Use {all: true} to clear all intercepts at once.",
  browser_find: "\n\n→ Next: Use the @eN ref with browser_click, browser_fill_form, browser_hover, or browser_inspect_source.",
  browser_diff: "\n\n→ Tip: Use 'current' as before value to capture the page now. Make changes, then call again with the first result as before.",
  browser_save_state: "\n\n→ Tip: State saved to ~/.foxbrowser/states/. Use browser_load_state to restore later.",
  browser_load_state: "\n\n→ Next: browser_snapshot to see the restored page state.",
  browser_connect: "", // SKILL_SUMMARY is returned directly
  browser_list: "\n\n→ Tip: Use browser_connect to connect to a specific instance.",
};

function appendHint(result: ToolResult, toolName: string): ToolResult {
  const hint = toolHints[toolName];
  if (!hint) return result;

  const lastTextIdx = result.content.findLastIndex((c) => c.type === "text");
  if (lastTextIdx >= 0) {
    result.content[lastTextIdx] = {
      ...result.content[lastTextIdx],
      text: (result.content[lastTextIdx].text ?? "") + hint,
    };
  } else {
    result.content.push({ type: "text" as const, text: hint.trimStart() });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Schema definitions
// ---------------------------------------------------------------------------

// No coercion in schemas — keep strict for validation tests.
// MCP string coercion happens in coerceArgs() at the handler level.

/**
 * Coerce string values from MCP clients to proper JS types.
 * MCP transports may send all values as strings.
 */
function coerceArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string") {
      if (v === "true") { out[k] = true; continue; }
      if (v === "false") { out[k] = false; continue; }
      const n = Number(v);
      if (v !== "" && !isNaN(n)) { out[k] = n; continue; }
    }
    out[k] = v;
  }
  return out;
}

const browser_connect = z.object({
  port: z.number().optional(),
  host: z.string().optional(),
  headless: z.boolean().optional(),
});

const browser_tabs = z.object({
  filter: z.string().optional(),
});

const browser_snapshot = z.object({
  selector: z.string().optional(),
  compact: z.boolean().optional(),
  interactive: z.boolean().optional(),
  cursor: z.boolean().optional(),
  depth: z.number().optional(),
});

const browser_screenshot = z.object({
  selector: z.string().optional(),
  fullPage: z.boolean().optional(),
  format: z.enum(["png", "jpeg"]).optional(),
  quality: z.number().optional(),
  annotate: z.boolean().optional(),
  visual: z.boolean().optional(),
});

const browser_click = z
  .object({
    selector: z.string().optional(),
    ref: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    newTab: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.selector) return true;
      if (data.ref) return true;
      if (data.x !== undefined && data.y !== undefined) return true;
      return false;
    },
    { message: "Must provide selector, ref, or both x and y coordinates" },
  );

const browser_fill_form = z
  .object({
    ref: z.string().optional(),
    selector: z.string().optional(),
    value: z.string(),
  })
  .refine(
    (data) => data.ref !== undefined || data.selector !== undefined,
    { message: "Must provide ref or selector" },
  );

const browser_type = z.object({
  text: z.string(),
  ref: z.string().optional(),
  slowly: z.boolean().optional(),
  submit: z.boolean().optional(),
});

const browser_press_key = z.object({
  key: z.string(),
});

const browser_navigate = z.object({
  url: z.string(),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
});

const browser_navigate_back = z.object({
  direction: z.enum(["back", "forward"]).optional(),
});

const browser_evaluate = z.object({
  expression: z.string(),
  frameId: z.string().optional(),
});

const browser_scroll = z.object({
  direction: z.enum(["up", "down", "left", "right"]).optional(),
  pixels: z.number().optional(),
  selector: z.string().optional(),
});

const browser_network_requests = z.object({
  filter: z.string().optional(),
  limit: z.number().optional(),
  includeHeaders: z.boolean().optional(),
  includeStatic: z.boolean().optional(),
});

const browser_console_messages = z.object({
  limit: z.number().optional(),
  level: z.enum(["log", "warn", "error", "info"]).optional(),
});

const browser_html = z.object({
  selector: z.string().optional(),
});

const browser_close = z.object({
  targetId: z.string().optional(),
  force: z.boolean().optional(),
  closeAll: z.boolean().optional(),
});

const browser_wait_for = z.object({
  text: z.string().optional(),
  textGone: z.string().optional(),
  time: z.number().optional(),
  timeout: z.number().optional(),
  url: z.string().optional(),
  fn: z.string().optional(),
  selector: z.string().optional(),
  state: z.string().optional(),
  loadState: z.string().optional(),
});

const browser_hover = z.object({
  ref: z.string(),
});

const browser_drag = z.object({
  startRef: z.string(),
  endRef: z.string(),
});

const browser_select_option = z.object({
  ref: z.string(),
  values: z.array(z.string()),
});

const browser_handle_dialog = z.object({
  accept: z.boolean(),
  promptText: z.string().optional(),
});

const browser_file_upload = z.object({
  ref: z.string(),
  paths: z.array(z.string()),
});

const browser_resize = z
  .object({
    width: z.number().optional(),
    height: z.number().optional(),
    deviceScaleFactor: z.number().optional(),
    preset: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.preset) return true;
      if (data.width !== undefined && data.height !== undefined) return true;
      return false;
    },
    { message: "Must provide both width and height together, or a preset" },
  );

const browser_annotated_screenshot = z.object({
  selector: z.string().optional(),
});

const browser_inspect_source = z
  .object({
    ref: z.string().optional(),
    selector: z.string().optional(),
  })
  .refine(
    (data) => data.ref !== undefined || data.selector !== undefined,
    { message: "Must provide ref or selector" },
  );

const browser_route = z.object({
  url: z.string(),
  body: z.string(),
  status: z.number().optional(),
  headers: z.record(z.string()).optional(),
});

const browser_abort = z.object({
  url: z.string(),
});

const browser_unroute = z
  .object({
    url: z.string().optional(),
    all: z.boolean().optional(),
  })
  .refine(
    (data) => data.url || data.all,
    { message: "Must provide url or all" },
  );

const browser_find = z
  .object({
    role: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    nth: z.number().optional(),
  })
  .refine(
    (data) => data.role !== undefined || data.name !== undefined || data.text !== undefined,
    { message: "Must provide at least one of role, name, or text" },
  );

const browser_diff = z.object({
  before: z.string(),
  after: z.string().optional(),
  selector: z.string().optional(),
  threshold: z.number().optional(),
});

const browser_save_state = z.object({
  name: z.string(),
});

const browser_load_state = z.object({
  name: z.string(),
  url: z.string().optional(),
});

const browser_list = z
  .object({})
  .passthrough()
  .optional()
  .transform((val) => val ?? {});

// ---------------------------------------------------------------------------
// Exported schemas record
// ---------------------------------------------------------------------------

export const schemas: Record<string, z.ZodType> = {
  browser_connect,
  browser_tabs,
  browser_snapshot,
  browser_screenshot,
  browser_click,
  browser_fill_form,
  browser_type,
  browser_press_key,
  browser_navigate,
  browser_navigate_back,
  browser_evaluate,
  browser_scroll,
  browser_network_requests,
  browser_console_messages,
  browser_html,
  browser_close,
  browser_wait_for,
  browser_hover,
  browser_drag,
  browser_select_option,
  browser_handle_dialog,
  browser_file_upload,
  browser_resize,
  browser_annotated_screenshot,
  browser_inspect_source,
  browser_route,
  browser_abort,
  browser_unroute,
  browser_find,
  browser_diff,
  browser_save_state,
  browser_load_state,
  browser_list,
};

// ---------------------------------------------------------------------------
// Tool descriptions
// ---------------------------------------------------------------------------

const descriptions: Record<string, string> = {
  browser_connect: "Connect to a running Firefox instance via WebDriver BiDi. Use headless: true to run in background without visible window.",
  browser_tabs: "List open browser tabs, optionally filtered by title or URL",
  browser_snapshot: "Capture an accessibility snapshot of the current page or a specific element. [~500 tokens, PREFERRED for page understanding]",
  browser_screenshot: "Take a screenshot. Auto-returns snapshot text unless visual: true, fullPage: true, or selector is specified. [~10K tokens when image returned]",
  browser_click: "Click an element identified by selector, ref, or coordinates",
  browser_fill_form: "Fill a form field identified by ref or selector with a value",
  browser_type: "Type text into the focused element or a specific ref",
  browser_press_key: "Press a keyboard key or key combination",
  browser_navigate: "Navigate to a URL",
  browser_navigate_back: "Navigate back or forward in browser history",
  browser_evaluate: "Evaluate a JavaScript expression in the page context",
  browser_scroll: "Scroll the page or a specific element in a given direction",
  browser_network_requests: "List captured network requests, optionally filtered",
  browser_console_messages: "Retrieve console messages from the page, optionally filtered by level",
  browser_html: "Get the HTML content of the page or a specific element",
  browser_close: "Close a browser tab or the entire browser",
  browser_wait_for: "Wait for a condition: text appearance/disappearance, time, URL, selector, or JS function",
  browser_hover: "Hover over an element identified by ref",
  browser_drag: "Drag from one element to another by ref",
  browser_select_option: "Select option(s) in a select element identified by ref",
  browser_handle_dialog: "Accept or dismiss a browser dialog (alert, confirm, prompt)",
  browser_file_upload: "Upload file(s) to a file input element identified by ref",
  browser_resize: "Resize the browser viewport to specific dimensions or a preset",
  browser_annotated_screenshot: "Take a screenshot with element annotations overlaid. [~12K tokens, prefer browser_snapshot { interactive: true } for text alternative]",
  browser_inspect_source: "Inspect a DOM element and return its source code location (file, line, component name). Works with React, Vue, Svelte, Solid.",
  browser_route: "Intercept requests matching a URL pattern and respond with a custom body, status, and headers",
  browser_abort: "Block requests matching a URL pattern",
  browser_unroute: "Remove request intercept rules — a specific pattern or all at once",
  browser_find: "Find elements by ARIA role, accessible name, or text content. Returns @eN ref for use with other tools.",
  browser_diff: "Compare two screenshots pixel-by-pixel. Returns diff percentage and visual diff image highlighting changes. [~11K tokens]",
  browser_save_state: "Save browser state (cookies, localStorage, sessionStorage) to a named file for later restoration",
  browser_load_state: "Load a previously saved browser state (cookies, storage) and optionally navigate to a URL",
  browser_list: "List available browser instances",
};

// ---------------------------------------------------------------------------
// Shape definitions for McpServer.tool() registration
// ---------------------------------------------------------------------------
// MCP clients (Claude Code, Cursor, etc.) send ALL values as strings.
// z.coerce.number() handles this correctly: Number("500") → 500
// z.coerce.boolean() does NOT: Boolean("false") → true (JS quirk)
// So we use a custom cBool preprocess for booleans.

const cNum = z.coerce.number();
const cBool = z.preprocess(
  (v) => (v === "true" ? true : v === "false" ? false : v),
  z.boolean(),
);

const toolShapes: Record<string, Record<string, z.ZodType>> = {
  browser_connect: { port: cNum.optional(), host: z.string().optional(), headless: cBool.optional() },
  browser_tabs: { filter: z.string().optional() },
  browser_snapshot: {
    selector: z.string().optional(),
    compact: cBool.optional(),
    interactive: cBool.optional(),
    cursor: cBool.optional(),
    depth: cNum.optional(),
  },
  browser_screenshot: {
    selector: z.string().optional(),
    fullPage: cBool.optional(),
    format: z.enum(["png", "jpeg"]).optional(),
    quality: cNum.optional(),
    annotate: cBool.optional(),
    visual: cBool.optional(),
  },
  browser_click: {
    selector: z.string().optional(),
    ref: z.string().optional(),
    x: cNum.optional(),
    y: cNum.optional(),
    newTab: cBool.optional(),
  },
  browser_fill_form: { ref: z.string().optional(), selector: z.string().optional(), value: z.string() },
  browser_type: { text: z.string(), ref: z.string().optional(), slowly: cBool.optional(), submit: cBool.optional() },
  browser_press_key: { key: z.string() },
  browser_navigate: { url: z.string(), waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional() },
  browser_navigate_back: { direction: z.enum(["back", "forward"]).optional() },
  browser_evaluate: { expression: z.string(), frameId: z.string().optional() },
  browser_scroll: { direction: z.enum(["up", "down", "left", "right"]).optional(), pixels: cNum.optional(), selector: z.string().optional() },
  browser_network_requests: { filter: z.string().optional(), limit: cNum.optional(), includeHeaders: cBool.optional(), includeStatic: cBool.optional() },
  browser_console_messages: { limit: cNum.optional(), level: z.enum(["log", "warn", "error", "info"]).optional() },
  browser_html: { selector: z.string().optional() },
  browser_close: { targetId: z.string().optional(), force: cBool.optional(), closeAll: cBool.optional() },
  browser_wait_for: { text: z.string().optional(), textGone: z.string().optional(), time: cNum.optional(), timeout: cNum.optional(), url: z.string().optional(), fn: z.string().optional(), selector: z.string().optional(), state: z.string().optional(), loadState: z.string().optional() },
  browser_hover: { ref: z.string() },
  browser_drag: { startRef: z.string(), endRef: z.string() },
  browser_select_option: { ref: z.string(), values: z.array(z.string()) },
  browser_handle_dialog: { accept: cBool, promptText: z.string().optional() },
  browser_file_upload: { ref: z.string(), paths: z.array(z.string()) },
  browser_resize: { width: cNum.optional(), height: cNum.optional(), deviceScaleFactor: cNum.optional(), preset: z.string().optional() },
  browser_annotated_screenshot: { selector: z.string().optional() },
  browser_inspect_source: { ref: z.string().optional(), selector: z.string().optional() },
  browser_route: { url: z.string(), body: z.string(), status: cNum.optional(), headers: z.record(z.string()).optional() },
  browser_abort: { url: z.string() },
  browser_unroute: { url: z.string().optional(), all: cBool.optional() },
  browser_find: { role: z.string().optional(), name: z.string().optional(), text: z.string().optional(), nth: cNum.optional() },
  browser_diff: { before: z.string(), after: z.string().optional(), selector: z.string().optional(), threshold: cNum.optional() },
  browser_save_state: { name: z.string() },
  browser_load_state: { name: z.string(), url: z.string().optional() },
  browser_list: {},
};

// ---------------------------------------------------------------------------
// Tool handlers — wired to real implementations
// ---------------------------------------------------------------------------

type ToolResult = { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function createHandlers(): Record<string, ToolHandler> {
  return {
    // --- Core tools with real implementations ---

    browser_navigate: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserNavigate(conn, args as any);
        return textResult(`Navigated to ${result.url}\nTitle: ${result.title}`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_screenshot: async (args) => {
      try {
        const conn = await getBiDi();
        // Cost optimization: auto-downgrade to snapshot when no visual need
        const needsImage = args.visual === true || args.fullPage === true
          || args.selector || args.annotate === true;
        if (!needsImage) {
          const snap = await browserSnapshot(conn, {});
          const text = typeof snap === "string" ? snap : (snap as any).snapshot ?? JSON.stringify(snap, null, 2);
          return textResult(`[auto-optimized: snapshot returned — pass visual: true for image]\n\n${text}`);
        }
        const result = await browserScreenshot(conn, args as any);
        const mimeType = (args.format === "jpeg") ? "image/jpeg" : "image/png";
        const content: any[] = [{
          type: "image",
          data: result.base64,
          mimeType,
        }];
        if (result.annotations?.length) {
          content.push({
            type: "text",
            text: result.annotations.map(a => `${a.label} ${a.role}: ${a.name} (${a.ref})`).join("\n"),
          });
        }
        return { content };
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_tabs: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserTabs(conn, args as any);
        const lines = result.tabs.map(t => `[${t.id}] ${t.title}\n  ${t.url}`);
        return textResult(lines.length ? lines.join("\n\n") : "No tabs found");
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_evaluate: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserEval(conn, args as any);
        if (result.error) return errorResult(result.error);
        return textResult(JSON.stringify(result.result, null, 2));
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_snapshot: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserSnapshot(conn, args as any);
        return textResult(typeof result === "string" ? result : JSON.stringify(result, null, 2));
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_click: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserClick(conn, args as any);
        return textResult(typeof result === "string" ? result : JSON.stringify(result));
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_scroll: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserScroll(conn, args as any);
        return textResult(typeof result === "string" ? result : JSON.stringify(result));
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_html: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserHtml(conn, args as any);
        return textResult(typeof result === "string" ? result : JSON.stringify(result));
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_connect: async (args) => {
      try {
        const typed = args as { headless?: boolean };
        const wasHeadless = headlessMode;
        headlessMode = typed.headless === true;
        if (wasHeadless !== headlessMode && bidiConnection?.isConnected) {
          bidiConnection.close();
          bidiConnection = null;
        }
        const conn = await getBiDi();
        const mode = headlessMode ? " (headless)" : "";
        let summary = SKILL_SUMMARY.replace("Connected to Firefox via WebDriver BiDi.", `Connected to Firefox via WebDriver BiDi${mode}.`);

        // Append upgrade notice if a newer version is available
        try {
          const { getUpgradeStatus } = await import("../upgrade.js");
          const status = getUpgradeStatus();
          if (status && status.latest !== status.current) {
            summary += `\n\n⚠️ foxbrowser v${status.latest} available (current: v${status.current}). Restart to apply.`;
          }
        } catch { /* ignore */ }

        return textResult(summary);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_list: async () => {
      try {
        const conn = await getBiDi();
        const result = (await conn.send("browsingContext.getTree", {})) as {
          contexts: Array<{ context: string; url: string; children: unknown[] }>;
        };
        const lines = result.contexts.map(c => `[${c.context}] ${c.url}`);
        return textResult(lines.length ? lines.join("\n\n") : "No pages found");
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    // --- Newly wired tools ---

    browser_navigate_back: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserNavigateBack(conn, args as any);
        return textResult(result.url ? `Navigated ${args.direction || "back"} to ${result.url}` : `Navigated ${args.direction || "back"}`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_press_key: async (args) => {
      try {
        const conn = await getBiDi();
        await browserPressKey(conn, args as any);
        return textResult(`Pressed key: ${args.key}`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_type: async (args) => {
      try {
        const conn = await getBiDi();
        await browserType(conn, args as any);
        return textResult(`Typed ${(args.text as string).length} characters`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_fill_form: async (args) => {
      try {
        const conn = await getBiDi();
        // MCP schema sends flat {ref?, selector?, value} — wrap into fields array
        const fields = [{
          name: (args.selector as string) ?? (args.ref as string) ?? "field",
          type: "textbox",
          ref: args.ref as string | undefined,
          selector: args.selector as string | undefined,
          value: args.value as string,
        }];
        await browserFillForm(conn, { fields } as any);
        return textResult(`Filled form field with value`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_hover: async (args) => {
      try {
        const conn = await getBiDi();
        await browserHover(conn, args as any);
        return textResult(`Hovered over element`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_drag: async (args) => {
      try {
        const conn = await getBiDi();
        await browserDrag(conn, args as any);
        return textResult(`Dragged from ${args.startRef} to ${args.endRef}`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_select_option: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserSelectOption(conn, args as any);
        return textResult(`Selected: ${result.selected.join(", ")}`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_handle_dialog: async (args) => {
      try {
        const conn = await getBiDi();
        await browserHandleDialog(conn, args as any);
        return textResult(`Dialog ${args.accept ? "accepted" : "dismissed"}`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_file_upload: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserFileUpload(conn, args as any);
        return textResult(`Uploaded ${result.filesCount} file(s)`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_wait_for: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserWaitFor(conn, args as any);
        return textResult(`Wait completed in ${result.elapsed}ms`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_resize: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserResize(conn, args as any);
        return textResult(`Resized to ${result.width}x${result.height}`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_close: async (args) => {
      try {
        const conn = await getBiDi();
        const typed = args as { closeAll?: boolean; targetId?: string; force?: boolean };
        const result = await browserClose(conn, typed);
        if (typed.closeAll) {
          bidiConnection?.close();
          bidiConnection = null;
          await quitFirefox();
        }
        return textResult(`Closed ${result.closedTargets} tab(s)`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_network_requests: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserNetworkRequests(conn, args as any);
        const lines = result.requests.map(r => `${r.method} ${r.status ?? "?"} ${r.url}`);
        return textResult(lines.length ? lines.join("\n") : "No network requests captured");
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_console_messages: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserConsoleMessages(conn, args as any);
        const lines = result.messages.map(m => `[${m.level}] ${m.text}`);
        return textResult(lines.length ? lines.join("\n") : "No console messages");
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_inspect_source: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserInspectSource(conn, args as any);
        const lines: string[] = [];
        lines.push(`Element: <${result.tagName}>`);
        if (result.componentName) {
          lines.push(`Component: ${result.componentName}`);
        }
        if (result.source) {
          lines.push(`Source: ${result.source.filePath}:${result.source.lineNumber ?? "?"}:${result.source.columnNumber ?? "?"}`);
        } else {
          lines.push("Source: not found (no framework metadata detected)");
        }
        if (result.stack.length > 0) {
          lines.push("\nComponent Stack:");
          for (const frame of result.stack) {
            const loc = `${frame.filePath}:${frame.lineNumber ?? "?"}`;
            lines.push(`  ${frame.componentName ?? "anonymous"} (${loc})`);
          }
        }
        return textResult(lines.join("\n"));
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_route: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserRoute(conn, args as any);
        return textResult(`Route registered: ${result.url} → ${result.status}\nActive routes: ${result.activeRoutes}`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_abort: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserAbort(conn, args as any);
        return textResult(`Abort registered: ${result.url}\nActive aborts: ${result.activeAborts}`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_unroute: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserUnroute(conn, args as any);
        return textResult(`Removed ${result.removed} rule(s)\nRemaining: ${result.remaining}`);
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_annotated_screenshot: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserAnnotatedScreenshot(conn, args as any);
        const content: any[] = [{
          type: "image",
          data: result.base64,
          mimeType: "image/png",
        }];
        if (result.annotations?.length) {
          content.push({
            type: "text",
            text: result.annotations.map(a => `${a.label} ${a.role}: ${a.name} (${a.ref})`).join("\n"),
          });
        }
        return { content };
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_diff: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserDiff(conn, args as any);
        const content: any[] = [{
          type: "image",
          data: result.diffImage,
          mimeType: "image/png",
        }, {
          type: "text",
          text: [
            `Diff: ${result.diffPercentage}% changed`,
            `Pixels: ${result.diffPixels} / ${result.totalPixels} differ`,
            `Dimensions: ${result.width}x${result.height}`,
            `Identical: ${result.identical}`,
          ].join("\n"),
        }];
        return { content };
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_find: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserFind(conn, args as any);
        if (!result.found) {
          return textResult(`No match found (${result.count} candidates)`);
        }
        const lines: string[] = [];
        lines.push(`Found: ${result.ref ?? "no ref"}`);
        lines.push(`Role: ${result.role ?? "unknown"}`);
        lines.push(`Name: ${result.name ?? ""}`);
        lines.push(`Matches: ${result.count}`);
        return textResult(lines.join("\n"));
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_save_state: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserSaveState(conn, args as any);
        return textResult(
          `State "${result.name}" saved to ${result.path}\n` +
          `Cookies: ${result.cookies}, localStorage: ${result.localStorage}, sessionStorage: ${result.sessionStorage}`
        );
      } catch (e: any) {
        return errorResult(e.message);
      }
    },

    browser_load_state: async (args) => {
      try {
        const conn = await getBiDi();
        const result = await browserLoadState(conn, args as any);
        return textResult(
          `State "${result.name}" restored\n` +
          `Cookies: ${result.cookies}, localStorage: ${result.localStorage}, sessionStorage: ${result.sessionStorage}`
        );
      } catch (e: any) {
        return errorResult(e.message);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Register all browser tools on the given McpServer instance.
 * Core tools (navigate, screenshot, tabs, evaluate, snapshot, click, scroll, html)
 * are wired to real CDP implementations. Others return stubs.
 */
export function registerTools(
  server: McpServer,
  _manager?: unknown,
): void {
  const handlers = createHandlers();
  const toolNames = Object.keys(schemas);

  for (const name of toolNames) {
    const description = descriptions[name] ?? name;
    const shape = toolShapes[name] ?? {};

    const rawHandler = handlers[name] ?? (async () =>
      textResult(`${name}: not yet implemented`)
    );

    const handler: ToolHandler = async (args) => {
      const coerced = coerceArgs(args as Record<string, unknown>);
      const result = await rawHandler(coerced);
      return appendHint(result, name);
    };

    (server as any).tool(name, description, shape, handler);
  }
}
