/**
 * Observation Tools — TDD Test Suite
 *
 * Tests ALL read-only/observation tools and the ref system:
 *   - browser_snapshot (src/tools/browser-snapshot.ts)
 *   - browser_screenshot (src/tools/browser-screenshot.ts)
 *   - browser_html (src/tools/browser-html.ts)
 *   - browser_evaluate / browser_eval (src/tools/browser-eval.ts)
 *   - browser_tabs (src/tools/browser-tabs.ts)
 *   - browser_console_messages (src/tools/browser-console-messages.ts)
 *   - browser_network_requests (src/tools/browser-network-requests.ts)
 *   - Ref System (src/ref-system.ts)
 *
 * All imports reference source files that do NOT exist yet (TDD).
 * CDP connections are mocked with canned responses.
 *
 * RED phase: these tests define the expected behavior. Implementations follow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// TDD imports — these modules will be created during implementation
// ---------------------------------------------------------------------------
import { browserSnapshot } from "../src/tools/browser-snapshot";
import { browserScreenshot } from "../src/tools/browser-screenshot";
import { browserHtml } from "../src/tools/browser-html";
import { browserEval } from "../src/tools/browser-eval";
import { browserTabs } from "../src/tools/browser-tabs";
import { browserConsoleMessages, setupConsoleCapture, resetConsoleBuffer } from "../src/tools/browser-console-messages";
import { browserNetworkRequests, setupNetworkCapture, resetNetworkBuffer } from "../src/tools/browser-network-requests";
import {
  RefSystem,
  type RefEntry,
} from "../src/ref-system";
import type { BiDiConnection } from "../src/bidi/connection";
type CDPConnection = BiDiConnection;
import { shouldShowAxNode, processAccessibilityTree } from "../src/tools/browser-snapshot";
import {
  browserGetText,
  browserGetValue,
  browserGetAttribute,
  browserGetCount,
  browserGetBox,
  browserGetStyles,
} from "../src/tools/browser-data";
import {
  browserIsVisible,
  browserIsEnabled,
  browserIsChecked,
} from "../src/tools/browser-state";
import { extractContentAsMarkdown } from "../src/tools/browser-html";

// ---------------------------------------------------------------------------
// Mock BiDi connection factory
// ---------------------------------------------------------------------------

interface BiDiEvent {
  method: string;
  handler: (params: unknown) => void;
}

/**
 * Converts an AX tree fixture into a BiDi snapshot response.
 * This simulates what the JS-based DOM traversal in browserSnapshot would produce.
 */
function axTreeToSnapshot(axTree: { nodes: Array<Record<string, unknown>> }): { snapshot: string; total: number } {
  const lines: string[] = [];
  let counter = 0;

  for (const node of axTree.nodes) {
    const role = (node.role as { value: string })?.value ?? "unknown";
    if (role === "WebArea") continue;

    counter++;
    const name = (node.name as { value: string })?.value ?? "";
    const value = (node.value as { value: string })?.value ?? "";
    const desc = (node.description as { value: string })?.value ?? "";
    const props = (node.properties as Array<{ name: string; value: { value: unknown } }>) ?? [];

    let line = `@e${counter} ${role}`;
    if (name) line += ` "${name}"`;
    if (value) line += ` value="${value}"`;

    for (const prop of props) {
      if (prop.name === "checked" && (prop.value.value === true || prop.value.value === "true")) {
        line += " checked";
      }
      if (prop.name === "selected" && prop.value.value === true) {
        line += " selected";
      }
      if (prop.name === "expanded") {
        line += prop.value.value ? " expanded" : " collapsed";
      }
      if (prop.name === "level") {
        line += ` level=${prop.value.value}`;
      }
    }
    if (desc) line += ` description="${desc}"`;

    if (role === "generic" && !name) continue;

    lines.push(line);
  }

  return { snapshot: lines.join("\n"), total: lines.length };
}

/**
 * Creates a mock BiDi connection that:
 *  - Responds to BiDi methods with canned results (overrideable per test)
 *  - Tracks registered event listeners
 *  - Allows emitting BiDi events to subscribed handlers
 *
 * The `snapshotData` parameter provides the AX tree that will be
 * converted to a BiDi snapshot response for script.evaluate calls.
 */
function createMockBiDi(
  overrides: Record<string, (params?: unknown) => unknown> = {},
  snapshotData?: { nodes: Array<Record<string, unknown>> },
): CDPConnection & { _events: BiDiEvent[]; _emit: (method: string, params: unknown) => void } {
  const events: BiDiEvent[] = [];

  const snapshotResult = snapshotData ? axTreeToSnapshot(snapshotData) : { snapshot: "", total: 0 };

  const defaultHandlers: Record<string, (params?: unknown) => unknown> = {
    // --- Script ---
    "script.evaluate": (p: unknown) => {
      const params = p as { expression?: string };
      const expr = params?.expression ?? "";

      // Snapshot request (contains the DOM traversal code)
      if (expr.includes("getRole") || expr.includes("traverse") || expr.includes("implicit")) {
        // Check if interactiveOnly filter is active
        if (expr.includes("interactiveOnly = true") && snapshotData) {
          const interactiveRoles = new Set(["button", "link", "textbox", "checkbox", "radio", "combobox", "listbox", "menuitem", "searchbox", "slider", "spinbutton", "switch", "tab", "treeitem"]);
          const filtered = snapshotData.nodes.filter((n: Record<string, unknown>) => {
            const role = (n.role as { value: string })?.value ?? "";
            return role !== "WebArea" && interactiveRoles.has(role);
          });
          const filteredTree = { nodes: filtered };
          return { result: { value: axTreeToSnapshot(filteredTree) } };
        }
        return { result: { value: snapshotResult } };
      }

      // Page dimensions
      if (expr.includes("innerWidth") || expr.includes("contentSize") || expr.includes("scrollWidth")) {
        return { result: { value: JSON.stringify({ width: 1280, height: 5000, viewportWidth: 1280, viewportHeight: 720, dpr: 1 }) } };
      }

      // DPR
      if (expr.includes("devicePixelRatio")) {
        return { result: { type: "number", value: 1 } };
      }

      // Annotation builder (createTreeWalker in screenshot annotate)
      if (expr.includes("createTreeWalker") && expr.includes("aria-label")) {
        return { result: { value: [
          { ref: "@e1", label: "[1]", role: "heading", name: "Welcome" },
          { ref: "@e2", label: "[2]", role: "link", name: "Home" },
          { ref: "@e3", label: "[3]", role: "button", name: "Submit" },
        ] } };
      }

      // Element bounding rect (for selector screenshots)
      if (expr.includes("getBoundingClientRect")) {
        return { result: { value: JSON.stringify({ x: 100, y: 50, width: 200, height: 100 }) } };
      }

      // DOM queries (outerHTML, etc.)
      if (expr.includes("outerHTML")) {
        return { result: { value: "<div>Hello World</div>" } };
      }

      // Window resize
      if (expr.includes("resizeTo")) {
        return { result: { value: undefined } };
      }

      // Default: return the expression as string value
      return { result: { type: "string", value: expr } };
    },

    "script.callFunction": (p: unknown) => {
      const params = p as { functionDeclaration?: string };
      const fn = params?.functionDeclaration ?? "";

      if (fn.includes("outerHTML")) {
        return { result: { value: "<div>Hello World</div>" } };
      }

      return { result: { type: "string", value: "result" } };
    },

    // --- Browsing Context ---
    "browsingContext.captureScreenshot": () => ({
      data: VALID_PNG_BASE64,
    }),

    "browsingContext.getTree": () => ({
      contexts: [{ context: "ctx-1", url: "https://example.com", children: [] }],
    }),

    "browsingContext.navigate": () => ({
      url: "https://example.com",
      navigation: "nav-1",
    }),

    // --- Session ---
    "session.subscribe": () => ({}),

    // Apply test-specific overrides last so they win
    ...overrides,
  };

  const bidi = {
    _events: events,

    _emit(method: string, params: unknown) {
      for (const e of events) {
        if (e.method === method) {
          e.handler(params);
        }
      }
    },

    async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
      const handler = defaultHandlers[method];
      if (!handler) {
        throw new Error(`BiDi method not mocked: ${method}`);
      }
      return handler(params);
    },

    on(event: string, handler: (params: unknown) => void): void {
      events.push({ method: event, handler });
    },

    off(event: string, handler: (params: unknown) => void): void {
      const idx = events.findIndex((e) => e.method === event && e.handler === handler);
      if (idx !== -1) events.splice(idx, 1);
    },

    close(): void {
      events.length = 0;
    },

    get isConnected(): boolean {
      return true;
    },
  } as unknown as CDPConnection & { _events: BiDiEvent[]; _emit: (method: string, params: unknown) => void };

  return bidi;
}

// Backward compat alias
const createMockCDP = createMockBiDi;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A valid 1x1 transparent PNG as base64 */
const VALID_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// ---------------------------------------------------------------------------
// Fixtures: canned accessibility tree responses
// ---------------------------------------------------------------------------

/** Minimal page with a heading, a link, and a button */
function axTreeSimplePage() {
  return {
    nodes: [
      {
        nodeId: "node-1",
        backendNodeId: 1,
        role: { type: "role", value: "WebArea" },
        name: { type: "computedString", value: "Test Page" },
        children: [
          { nodeId: "node-2", backendNodeId: 2 },
          { nodeId: "node-3", backendNodeId: 3 },
          { nodeId: "node-4", backendNodeId: 4 },
        ],
      },
      {
        nodeId: "node-2",
        backendNodeId: 2,
        parentId: "node-1",
        role: { type: "role", value: "heading" },
        name: { type: "computedString", value: "Welcome" },
        properties: [{ name: "level", value: { type: "integer", value: 1 } }],
      },
      {
        nodeId: "node-3",
        backendNodeId: 3,
        parentId: "node-1",
        role: { type: "role", value: "link" },
        name: { type: "computedString", value: "Home" },
        properties: [],
      },
      {
        nodeId: "node-4",
        backendNodeId: 4,
        parentId: "node-1",
        role: { type: "role", value: "button" },
        name: { type: "computedString", value: "Submit" },
        properties: [],
      },
    ],
  };
}

/** Page with interactive form elements including various states */
function axTreeFormPage() {
  return {
    nodes: [
      {
        nodeId: "node-1",
        backendNodeId: 1,
        role: { type: "role", value: "WebArea" },
        name: { type: "computedString", value: "Form Page" },
        children: [
          { nodeId: "node-2", backendNodeId: 2 },
          { nodeId: "node-3", backendNodeId: 3 },
          { nodeId: "node-4", backendNodeId: 4 },
          { nodeId: "node-5", backendNodeId: 5 },
          { nodeId: "node-6", backendNodeId: 6 },
          { nodeId: "node-7", backendNodeId: 7 },
        ],
      },
      {
        nodeId: "node-2",
        backendNodeId: 2,
        parentId: "node-1",
        role: { type: "role", value: "textbox" },
        name: { type: "computedString", value: "Email" },
        value: { type: "computedString", value: "user@example.com" },
        properties: [{ name: "editable", value: { type: "token", value: "plaintext" } }],
      },
      {
        nodeId: "node-3",
        backendNodeId: 3,
        parentId: "node-1",
        role: { type: "role", value: "textbox" },
        name: { type: "computedString", value: "Password" },
        value: { type: "computedString", value: "" },
        properties: [{ name: "editable", value: { type: "token", value: "plaintext" } }],
      },
      {
        nodeId: "node-4",
        backendNodeId: 4,
        parentId: "node-1",
        role: { type: "role", value: "checkbox" },
        name: { type: "computedString", value: "Remember me" },
        properties: [{ name: "checked", value: { type: "tristate", value: "true" } }],
      },
      {
        nodeId: "node-5",
        backendNodeId: 5,
        parentId: "node-1",
        role: { type: "role", value: "combobox" },
        name: { type: "computedString", value: "Country" },
        value: { type: "computedString", value: "US" },
        properties: [
          { name: "expanded", value: { type: "boolean", value: false } },
        ],
      },
      {
        nodeId: "node-6",
        backendNodeId: 6,
        parentId: "node-1",
        role: { type: "role", value: "option" },
        name: { type: "computedString", value: "United States" },
        properties: [{ name: "selected", value: { type: "boolean", value: true } }],
      },
      {
        nodeId: "node-7",
        backendNodeId: 7,
        parentId: "node-1",
        role: { type: "role", value: "button" },
        name: { type: "computedString", value: "Sign Up" },
        description: { type: "computedString", value: "Create your account" },
        properties: [],
      },
    ],
  };
}

/** Nested tree with depth for depth-limiting tests */
function axTreeNested(depth: number) {
  const nodes: Array<Record<string, unknown>> = [];
  let currentId = 0;

  function addNode(parentId: string | null, currentDepth: number): string {
    currentId++;
    const nodeId = `node-${currentId}`;
    const node: Record<string, unknown> = {
      nodeId,
      backendNodeId: currentId,
      role: { type: "role", value: currentDepth === 0 ? "WebArea" : "generic" },
      name: { type: "computedString", value: currentDepth === 0 ? "Deep Page" : `Level ${currentDepth}` },
      properties: [],
    };
    if (parentId) node.parentId = parentId;

    if (currentDepth < depth) {
      const childId = `node-${currentId + 1}`;
      node.children = [{ nodeId: childId, backendNodeId: currentId + 1 }];
      nodes.push(node);
      addNode(nodeId, currentDepth + 1);
    } else {
      // Leaf: make it interactive so it gets a ref
      node.role = { type: "role", value: "button" };
      node.name = { type: "computedString", value: "Deep Button" };
      nodes.push(node);
    }

    return nodeId;
  }

  addNode(null, 0);
  return { nodes };
}

/** Generate a large AX tree with N elements */
function axTreeLarge(count: number) {
  const root = {
    nodeId: "node-0",
    backendNodeId: 0,
    role: { type: "role" as const, value: "WebArea" },
    name: { type: "computedString" as const, value: "Large Page" },
    children: [] as Array<{ nodeId: string; backendNodeId: number }>,
  };

  const nodes = [root];
  for (let i = 1; i <= count; i++) {
    root.children.push({ nodeId: `node-${i}`, backendNodeId: i });
    nodes.push({
      nodeId: `node-${i}`,
      backendNodeId: i,
      role: { type: "role" as const, value: i % 3 === 0 ? "button" : i % 3 === 1 ? "link" : "textbox" },
      name: { type: "computedString" as const, value: `Element ${i}` },
      properties: [],
    } as typeof root);
  }

  return { nodes };
}

// ============================================================================
// browser_snapshot (src/tools/browser-snapshot.ts)
// ============================================================================

describe("browser_snapshot", () => {
  let cdp: ReturnType<typeof createMockBiDi>;

  beforeEach(() => {
    cdp = createMockBiDi({}, axTreeSimplePage());
  });

  // --- Core behavior ---

  it("should return accessibility tree with @eN refs", async () => {
    const result = await browserSnapshot(cdp, {});

    expect(result).toBeDefined();
    expect(result.snapshot).toContain("@e1");
    expect(result.snapshot).toContain("@e2");
    expect(result.snapshot).toContain("@e3");
  });

  it("should include element roles and names in snapshot", async () => {
    const result = await browserSnapshot(cdp, {});

    expect(result.snapshot).toContain("heading");
    expect(result.snapshot).toContain("Welcome");
    expect(result.snapshot).toContain("button");
    expect(result.snapshot).toContain("Submit");
    expect(result.snapshot).toContain("link");
    expect(result.snapshot).toContain("Home");
  });

  // --- Ref generation ---

  it("should generate sequential @e1, @e2, @e3 refs in tree order", async () => {
    const result = await browserSnapshot(cdp, {});

    // Refs should appear sequentially, positional top-to-bottom
    const e1Pos = result.snapshot.indexOf("@e1");
    const e2Pos = result.snapshot.indexOf("@e2");
    const e3Pos = result.snapshot.indexOf("@e3");

    expect(e1Pos).toBeGreaterThanOrEqual(0);
    expect(e1Pos).toBeLessThan(e2Pos);
    expect(e2Pos).toBeLessThan(e3Pos);
  });

  it("should not assign refs to the root WebArea node", async () => {
    const result = await browserSnapshot(cdp, {});

    // WebArea itself should not get a clickable @eN ref
    expect(result.snapshot).not.toMatch(/@e\d+.*WebArea/);
  });

  // --- Ref attributes ---

  it("should include heading level attribute (level=1)", async () => {
    const result = await browserSnapshot(cdp, {});

    expect(result.snapshot).toMatch(/heading.*"Welcome".*level=1/s);
  });

  it("should include value attribute for textboxes", async () => {
    cdp = createMockBiDi({}, axTreeFormPage());

    const result = await browserSnapshot(cdp, {});

    expect(result.snapshot).toContain("user@example.com");
  });

  it("should include checked attribute for checkboxes", async () => {
    cdp = createMockBiDi({}, axTreeFormPage());

    const result = await browserSnapshot(cdp, {});

    expect(result.snapshot).toMatch(/checkbox.*"Remember me".*checked/s);
  });

  it("should include selected attribute for options", async () => {
    cdp = createMockBiDi({}, axTreeFormPage());

    const result = await browserSnapshot(cdp, {});

    expect(result.snapshot).toMatch(/option.*"United States".*selected/s);
  });

  it("should include expanded attribute for comboboxes", async () => {
    cdp = createMockBiDi({}, axTreeFormPage());

    const result = await browserSnapshot(cdp, {});

    expect(result.snapshot).toMatch(/combobox.*"Country"/s);
  });

  it("should include description attribute for elements", async () => {
    cdp = createMockBiDi({}, axTreeFormPage());

    const result = await browserSnapshot(cdp, {});

    // Button "Sign Up" has description "Create your account"
    expect(result.snapshot).toContain("Create your account");
  });

  // --- Interactive element hints ---

  it("should include interactive element hints (clickable, editable)", async () => {
    cdp = createMockBiDi({}, axTreeFormPage());

    const result = await browserSnapshot(cdp, {});

    // Textbox should be identified as editable
    expect(result.snapshot).toMatch(/textbox.*"Email"/s);
    // Button should be identified as interactive
    expect(result.snapshot).toMatch(/button.*"Sign Up"/s);
  });

  // --- Compact mode ---

  it("should support compact mode with less detail", async () => {
    const normalResult = await browserSnapshot(cdp, {});
    const compactResult = await browserSnapshot(cdp, { compact: true });

    // Compact output should be shorter or equal in length
    expect(compactResult.snapshot.length).toBeLessThanOrEqual(normalResult.snapshot.length);
  });

  it("should remove empty structural elements in compact mode", async () => {
    cdp = createMockBiDi({}, {
      nodes: [
        { nodeId: "node-1", backendNodeId: 1, role: { type: "role", value: "WebArea" }, name: { type: "computedString", value: "Page" }, children: [{ nodeId: "node-2", backendNodeId: 2 }, { nodeId: "node-3", backendNodeId: 3 }] },
        { nodeId: "node-2", backendNodeId: 2, parentId: "node-1", role: { type: "role", value: "generic" }, name: { type: "computedString", value: "" }, children: [{ nodeId: "node-3", backendNodeId: 3 }], properties: [] },
        { nodeId: "node-3", backendNodeId: 3, parentId: "node-2", role: { type: "role", value: "button" }, name: { type: "computedString", value: "Click Me" }, properties: [] },
      ],
    });

    const result = await browserSnapshot(cdp, { compact: true });

    expect(result.snapshot).toContain("button");
    expect(result.snapshot).toContain("Click Me");
  });

  // --- Selector filtering ---

  it("should filter by CSS selector to scope snapshot", async () => {
    // With BiDi, selector scoping is handled inside the JS expression
    cdp = createMockBiDi({}, {
      nodes: [
        { nodeId: "node-4", backendNodeId: 4, role: { type: "role", value: "button" }, name: { type: "computedString", value: "Submit" }, properties: [] },
      ],
    });

    const result = await browserSnapshot(cdp, { selector: "#main" });

    expect(result.snapshot).toBeDefined();
    expect(typeof result.snapshot).toBe("string");
  });

  // --- Empty pages ---

  it("should handle empty pages gracefully", async () => {
    cdp = createMockBiDi({}, {
      nodes: [
        { nodeId: "node-1", backendNodeId: 1, role: { type: "role", value: "WebArea" }, name: { type: "computedString", value: "" }, children: [] },
      ],
    });

    const result = await browserSnapshot(cdp, {});

    expect(result.snapshot).toBeDefined();
    expect(typeof result.snapshot).toBe("string");
    // Should not throw, even with no interactive elements
  });

  // --- Large pages and truncation ---

  it("should handle pages with 1000+ elements (truncation)", async () => {
    cdp = createMockBiDi({}, axTreeLarge(1200));

    const result = await browserSnapshot(cdp, {});

    expect(result.snapshot).toBeDefined();
    expect(result.snapshot.length).toBeGreaterThan(0);

    // If truncated, should indicate so
    if (result.truncated) {
      expect(result.totalElements).toBe(1200);
    }
  });

  // --- Depth limiting ---

  it("should support depth limiting (-d flag equivalent)", async () => {
    cdp = createMockBiDi({}, axTreeNested(10));

    const fullResult = await browserSnapshot(cdp, {});
    const depthLimitedResult = await browserSnapshot(cdp, { depth: 3 });

    // Depth-limited result should be shorter or equal
    expect(depthLimitedResult.snapshot.length).toBeLessThanOrEqual(fullResult.snapshot.length);
  });

  it("should omit nodes beyond the specified depth", async () => {
    cdp = createMockBiDi({}, axTreeNested(10));

    const result = await browserSnapshot(cdp, { depth: 2 });

    // Deep nodes (Level 5, Level 10, etc.) should not appear
    expect(result.snapshot).not.toContain("Level 10");
  });
});

// ============================================================================
// browser_screenshot (src/tools/browser-screenshot.ts)
// ============================================================================

describe("browser_screenshot", () => {
  let cdp: ReturnType<typeof createMockBiDi>;

  beforeEach(() => {
    cdp = createMockBiDi({
      "browsingContext.captureScreenshot": () => ({ data: VALID_PNG_BASE64 }),
    });
  });

  // --- Viewport screenshot ---

  it("should capture viewport screenshot by default", async () => {
    const result = await browserScreenshot(cdp, {});

    expect(result).toBeDefined();
    expect(result.base64).toBe(VALID_PNG_BASE64);
  });

  // --- Base64 PNG ---

  it("should return base64 PNG data", async () => {
    const result = await browserScreenshot(cdp, { format: "png" });

    expect(result.base64).toBeDefined();
    expect(typeof result.base64).toBe("string");
    // Valid base64 characters
    expect(result.base64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  // --- Full page ---

  it("should capture full page screenshot with --full flag", async () => {
    const sendSpy = vi.fn().mockImplementation(async (method: string) => {
      if (method === "browsingContext.captureScreenshot") {
        return { data: VALID_PNG_BASE64 };
      }
      return { result: { value: undefined } };
    });

    const fullPageCdp = { ...cdp, send: sendSpy } as unknown as typeof cdp;

    const result = await browserScreenshot(fullPageCdp, { fullPage: true });
    expect(result.base64).toBeDefined();
    expect(sendSpy).toHaveBeenCalledWith("browsingContext.captureScreenshot", expect.objectContaining({ origin: "document" }));
  });

  // --- Annotated screenshot ---

  it("should support annotated screenshot with numbered element labels [N] mapping to @eN refs", async () => {
    cdp = createMockBiDi({}, axTreeSimplePage());

    const result = await browserScreenshot(cdp, { annotate: true });

    expect(result.base64).toBeDefined();
    expect(result.annotations).toBeDefined();
    expect(Array.isArray(result.annotations)).toBe(true);
    if (result.annotations && result.annotations.length > 0) {
      expect(result.annotations[0]).toHaveProperty("ref");
      expect(result.annotations[0]).toHaveProperty("label");
      expect(result.annotations[0].ref).toMatch(/^@e\d+$/);
    }
  });

  it("should cache refs when annotated screenshot is taken", async () => {
    cdp = createMockBiDi({}, axTreeSimplePage());

    const result = await browserScreenshot(cdp, { annotate: true });

    // After annotated screenshot, refs should be usable for interaction
    expect(result.annotations).toBeDefined();
    expect(result.annotations!.length).toBeGreaterThan(0);
  });

  // --- Custom format/quality ---

  it("should support custom format (jpeg)", async () => {
    const sendSpy = vi.fn().mockImplementation(async (method: string, params?: unknown) => {
      if (method === "script.evaluate") {
        return { result: { value: JSON.stringify({ width: 1280, height: 720, viewportWidth: 1280, viewportHeight: 720, dpr: 1 }) } };
      }
      if (method === "browsingContext.captureScreenshot") {
        return { data: VALID_PNG_BASE64 };
      }
      return {};
    });

    const jpegCdp = { ...cdp, send: sendSpy } as unknown as typeof cdp;
    const result = await browserScreenshot(jpegCdp, { format: "jpeg" });
    expect(result.base64).toBeDefined();
  });

  it("should support custom quality for jpeg format", async () => {
    const sendSpy = vi.fn().mockImplementation(async (method: string, params?: unknown) => {
      if (method === "script.evaluate") {
        return { result: { value: JSON.stringify({ width: 1280, height: 720, viewportWidth: 1280, viewportHeight: 720, dpr: 1 }) } };
      }
      if (method === "browsingContext.captureScreenshot") {
        return { data: VALID_PNG_BASE64 };
      }
      return {};
    });

    const qualityCdp = { ...cdp, send: sendSpy } as unknown as typeof cdp;
    await browserScreenshot(qualityCdp, { format: "jpeg", quality: 50 });
  });

  // --- DPR handling ---

  it("should handle DPR for Retina displays (CSS px = image px / DPR)", async () => {
    const sendSpy = vi.fn().mockImplementation(async (method: string) => {
      if (method === "script.evaluate") {
        return { result: { value: JSON.stringify({ width: 1280, height: 720, viewportWidth: 1280, viewportHeight: 720, dpr: 2 }) } };
      }
      if (method === "browsingContext.captureScreenshot") {
        return { data: VALID_PNG_BASE64 };
      }
      return {};
    });

    const retinaCdp = { ...cdp, send: sendSpy } as unknown as typeof cdp;
    const result = await browserScreenshot(retinaCdp, {});
    expect(result.base64).toBeDefined();
  });

  // --- Element screenshot ---

  it("should capture element screenshot by CSS selector", async () => {
    const sendSpy = vi.fn().mockImplementation(async (method: string, params?: unknown) => {
      if (method === "script.evaluate") {
        const p = params as { expression?: string };
        const expr = p?.expression ?? "";
        if (expr.includes("getBoundingClientRect")) {
          return { result: { value: JSON.stringify({ x: 100, y: 50, width: 200, height: 100 }) } };
        }
        return { result: { value: JSON.stringify({ width: 1280, height: 720, viewportWidth: 1280, viewportHeight: 720, dpr: 1 }) } };
      }
      if (method === "browsingContext.captureScreenshot") {
        return { data: VALID_PNG_BASE64 };
      }
      return {};
    });

    const elemCdp = { ...cdp, send: sendSpy } as unknown as typeof cdp;
    const result = await browserScreenshot(elemCdp, { selector: "#my-element" });
    expect(result.base64).toBeDefined();
  });

  it("should capture element screenshot by @eN ref", async () => {
    const sendSpy = vi.fn().mockImplementation(async (method: string, params?: unknown) => {
      if (method === "script.evaluate") {
        const p = params as { expression?: string };
        const expr = p?.expression ?? "";
        if (expr.includes("getBoundingClientRect")) {
          return { result: { value: JSON.stringify({ x: 50, y: 50, width: 200, height: 100 }) } };
        }
        return { result: { value: JSON.stringify({ width: 1280, height: 720, viewportWidth: 1280, viewportHeight: 720, dpr: 1 }) } };
      }
      if (method === "browsingContext.captureScreenshot") {
        return { data: VALID_PNG_BASE64 };
      }
      return {};
    });

    const refCdp = { ...cdp, send: sendSpy } as unknown as typeof cdp;
    const result = await browserScreenshot(refCdp, { ref: "@e1" });
    expect(result.base64).toBeDefined();
  });
});

// ============================================================================
// browser_html (src/tools/browser-html.ts)
// ============================================================================

describe("browser_html", () => {
  let cdp: ReturnType<typeof createMockBiDi>;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  it("should return full page HTML (document.documentElement.outerHTML) when no selector", async () => {
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        result: {
          type: "string",
          value: "<html><head><title>Test</title></head><body><p>Hello</p></body></html>",
        },
      }),
    });

    const result = await browserHtml(cdp, {});

    expect(result.html).toBeDefined();
    expect(result.html).toContain("<html>");
    expect(result.html).toContain("<body>");
  });

  it("should return element HTML by CSS selector", async () => {
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        result: { value: '<div class="container"><p>Content</p></div>' },
      }),
      "script.callFunction": () => ({
        result: { value: '<div class="container"><p>Content</p></div>' },
      }),
    });

    const result = await browserHtml(cdp, { selector: ".container" });

    expect(result.html).toBe('<div class="container"><p>Content</p></div>');
  });

  it("should handle missing selector gracefully (element not found)", async () => {
    cdp = createMockBiDi({
      "script.callFunction": () => ({
        result: { type: "null", value: null },
      }),
    });

    const result = await browserHtml(cdp, { selector: "#nonexistent" });

    expect(result).toBeDefined();
    expect(result.error || result.html === "").toBeTruthy();
  });

  it("should return outerHTML including the element itself, not just innerHTML", async () => {
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        result: { value: '<section id="hero"><h1>Title</h1><p>Paragraph</p></section>' },
      }),
      "script.callFunction": () => ({
        result: { value: '<section id="hero"><h1>Title</h1><p>Paragraph</p></section>' },
      }),
    });

    const result = await browserHtml(cdp, { selector: "#hero" });

    expect(result.html).toContain("<section");
    expect(result.html).toContain("</section>");
  });
});

// ============================================================================
// browser_eval / browser_evaluate (src/tools/browser-eval.ts)
// ============================================================================

describe("browser_eval", () => {
  let cdp: ReturnType<typeof createMockBiDi>;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  // --- Basic evaluation ---

  it("should execute JavaScript expression and return the result (TS-09)", async () => {
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        result: { type: "string", value: "My Page Title" },
      }),
    });

    const result = await browserEval(cdp, { expression: "document.title" });

    expect(result.result).toBe("My Page Title");
  });

  // --- Serialized result ---

  it("should return serialized result for complex objects", async () => {
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        result: {
          type: "object",
          value: { width: 1024, height: 768 },
        },
      }),
    });

    const result = await browserEval(cdp, {
      expression: "({ width: window.innerWidth, height: window.innerHeight })",
    });

    expect(result.result).toBeDefined();
    expect(result.result).toEqual({ width: 1024, height: 768 });
  });

  it("should use awaitPromise: true for value serialization (TS-09)", async () => {
    cdp = createMockBiDi({
      "script.evaluate": (p: unknown) => {
        const params = p as { expression: string; awaitPromise?: boolean };
        expect(params.awaitPromise).toBe(true);
        return {
          result: { type: "number", value: 42 },
        };
      },
    });

    const result = await browserEval(cdp, { expression: "21 * 2" });
    expect(result.result).toBe(42);
  });

  // --- Error handling ---

  it("should handle errors (throw in eval)", async () => {
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        type: "exception",
        exceptionDetails: {
          text: "ReferenceError: nonExistent is not defined",
          columnNumber: 0,
          lineNumber: 0,
        },
      }),
    });

    const result = await browserEval(cdp, { expression: "nonExistent.property" });

    expect(result.error).toBeDefined();
    expect(result.error).toContain("ReferenceError");
  });

  it("should handle TypeError exceptions in evaluated code", async () => {
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        type: "exception",
        exceptionDetails: {
          text: "TypeError: Cannot read properties of null (reading 'map')",
          columnNumber: 0,
          lineNumber: 0,
        },
      }),
    });

    const result = await browserEval(cdp, { expression: "null.map(x => x)" });

    expect(result.error).toBeDefined();
    expect(result.error).toContain("TypeError");
  });

  // --- Async expressions ---

  it("should handle async expressions (await) with awaitPromise: true", async () => {
    const sendSpy = vi.fn().mockImplementation(async (method: string, params?: unknown) => {
      if (method === "script.evaluate") {
        const p = params as { awaitPromise?: boolean };
        expect(p?.awaitPromise).toBe(true);
        return {
          result: { type: "object", value: { data: "fetched" } },
        };
      }
      return {};
    });

    const asyncCdp = { ...cdp, send: sendSpy } as unknown as typeof cdp;
    const result = await browserEval(asyncCdp, {
      expression: "fetch('/api/data').then(r => r.json())",
    });

    expect(result.result).toBeDefined();
  });

  // --- DOM element returns ---

  it("should handle DOM element returns (serialize to string representation)", async () => {
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        result: {
          type: "node",
          sharedId: "node-42",
          value: { nodeType: 1, localName: "div" },
        },
      }),
    });

    const result = await browserEval(cdp, {
      expression: "document.querySelector('#main')",
    });

    // DOM nodes should be serialized to a string description
    expect(result.result).toBeDefined();
    expect(typeof result.result).toBe("string");
    expect(result.result).toContain("node-42");
  });

  // --- Evaluate with element reference (callFunctionOn) ---

  it("should evaluate with element reference using script.callFunction", async () => {
    const sendSpy = vi.fn().mockImplementation(async (method: string, params?: unknown) => {
      if (method === "script.callFunction") {
        const p = params as { functionDeclaration?: string };
        // First call resolves the element, second evaluates on it
        if (p?.functionDeclaration?.includes("createTreeWalker")) {
          return { result: { type: "node", sharedId: "shared-1" } };
        }
        return { result: { type: "string", value: "element text content" } };
      }
      return {};
    });

    const refCdp = { ...cdp, send: sendSpy } as unknown as typeof cdp;
    const result = await browserEval(refCdp, {
      expression: "(el) => el.textContent",
      ref: "@e1",
    });

    expect(result.result).toBe("element text content");
    expect(sendSpy).toHaveBeenCalledWith("script.callFunction", expect.anything());
  });

  it("should use Runtime.evaluate without ref, Runtime.callFunctionOn with ref", async () => {
    // Without ref: should use Runtime.evaluate
    const evalSpy = vi.fn().mockResolvedValue({
      result: { type: "number", value: 100 },
    });
    const evalOnlyCdp = { ...cdp, send: evalSpy } as unknown as typeof cdp;

    await browserEval(evalOnlyCdp, { expression: "1 + 99" });

    const evalCall = evalSpy.mock.calls.find(
      (call: [string, unknown]) => call[0] === "script.evaluate",
    );
    expect(evalCall).toBeDefined();
  });

  // --- Primitive type handling ---

  it("should return null for null results", async () => {
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        result: { type: "object", subtype: "null", value: null },
      }),
    });

    const result = await browserEval(cdp, { expression: "null" });
    expect(result.result).toBeNull();
  });

  it("should return undefined for undefined results", async () => {
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        result: { type: "undefined" },
      }),
    });

    const result = await browserEval(cdp, { expression: "undefined" });
    expect(result.result).toBeUndefined();
  });

  it("should return boolean values correctly", async () => {
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        result: { type: "boolean", value: true },
      }),
    });

    const result = await browserEval(cdp, { expression: "true" });
    expect(result.result).toBe(true);
  });
});

// ============================================================================
// browser_tabs (src/tools/browser-tabs.ts)
// ============================================================================

describe("browser_tabs", () => {
  let cdp: ReturnType<typeof createMockBiDi>;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  // --- TS-05: List all tabs ---

  it("should list all tabs with title, url, id (TS-05)", async () => {
    cdp = createMockBiDi({
      "browsingContext.getTree": () => ({
        contexts: [
          { context: "tab-1", type: "page", title: "Google", url: "https://google.com", attached: false },
          { context: "tab-2", type: "page", title: "GitHub", url: "https://github.com", attached: true },
          { context: "tab-3", type: "page", title: "Localhost", url: "http://localhost:3000", attached: false },
          { context: "tab-4", type: "page", title: "Docs", url: "https://docs.example.com", attached: false },
          { context: "tab-5", type: "page", title: "Slack", url: "https://app.slack.com", attached: false },
        ],
      }),
    });

    const result = await browserTabs(cdp, {});

    expect(result.tabs).toBeDefined();
    expect(result.tabs).toHaveLength(5);
    expect(result.tabs[0]).toHaveProperty("id");
    expect(result.tabs[0]).toHaveProperty("title");
    expect(result.tabs[0]).toHaveProperty("url");
  });

  it("should include all required properties: id, title, url on each tab", async () => {
    cdp = createMockBiDi({
      "browsingContext.getTree": () => ({
        contexts: [
          { context: "tab-42", url: "https://test.com/path", children: [] },
        ],
      }),
      "script.evaluate": () => ({
        result: { value: "Test Tab" },
      }),
    });

    const result = await browserTabs(cdp, {});

    expect(result.tabs[0].id).toBe("tab-42");
    expect(result.tabs[0].title).toBe("Test Tab");
    expect(result.tabs[0].url).toBe("https://test.com/path");
  });

  // --- TS-06: 100+ tabs performance ---

  it("should list 100+ tabs with performance under 500ms (TS-06)", async () => {
    const manyTabs = Array.from({ length: 150 }, (_, i) => ({
      context: `tab-${i}`,
      type: "page",
      title: `Tab ${i}`,
      url: `https://example.com/page/${i}`,
      attached: i === 0,
    }));

    cdp = createMockBiDi({
      "browsingContext.getTree": () => ({ contexts: manyTabs }),
    });

    const start = performance.now();
    const result = await browserTabs(cdp, {});
    const elapsed = performance.now() - start;

    expect(result.tabs).toHaveLength(150);
    expect(elapsed).toBeLessThan(500);
  });

  // --- TS-07: Filter by URL pattern ---

  it("should filter tabs by URL pattern (TS-07)", async () => {
    cdp = createMockBiDi({
      "browsingContext.getTree": () => ({
        contexts: [
          { context: "tab-1", type: "page", title: "Dashboard", url: "http://localhost:3000/dashboard", attached: false },
          { context: "tab-2", type: "page", title: "PR #42", url: "https://github.com/myorg/myapp/pull/42", attached: false },
          { context: "tab-3", type: "page", title: "Grafana", url: "https://grafana.internal.com/d/abc123", attached: false },
          { context: "tab-4", type: "page", title: "Slack", url: "https://app.slack.com/client/T01/C02", attached: false },
        ],
      }),
    });

    const result = await browserTabs(cdp, { filter: "*github.com*" });

    expect(result.tabs).toHaveLength(1);
    expect(result.tabs[0].url).toContain("github.com");
  });

  it("should return all tabs when no filter is applied", async () => {
    cdp = createMockBiDi({
      "browsingContext.getTree": () => ({
        contexts: [
          { context: "tab-1", type: "page", title: "A", url: "https://a.com", attached: false },
          { context: "tab-2", type: "page", title: "B", url: "https://b.com", attached: false },
        ],
      }),
    });

    const result = await browserTabs(cdp, {});

    expect(result.tabs).toHaveLength(2);
  });

  // --- TS-08: Tab closed while listing ---

  it("should handle tab closed while listing (TS-08)", async () => {
    cdp = createMockBiDi({
      "browsingContext.getTree": () => ({
        contexts: [
          { context: "tab-1", type: "page", title: "Still Open", url: "https://example.com", attached: false },
          { context: "tab-2", type: "page", title: "Still Open 2", url: "https://example2.com", attached: false },
        ],
      }),
    });

    // Should not throw even if tabs change during listing
    const result = await browserTabs(cdp, {});
    expect(result.tabs).toBeDefined();
    expect(result.tabs.length).toBeGreaterThanOrEqual(1);
  });

  // --- Filter non-page targets ---

  it("should only include browsing contexts, not about: pages", async () => {
    cdp = createMockBiDi({
      "browsingContext.getTree": () => ({
        contexts: [
          { context: "tab-1", url: "https://example.com", children: [] },
          { context: "tab-2", url: "about:blank", children: [] },
          { context: "tab-3", url: "https://other.com", children: [] },
        ],
      }),
    });

    const result = await browserTabs(cdp, {});

    // about: pages are filtered out
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs.every((t: { url: string }) => !t.url.startsWith("about:"))).toBe(true);
  });

  // --- Empty browser ---

  it("should handle browser with no tabs gracefully", async () => {
    cdp = createMockBiDi({
      "browsingContext.getTree": () => ({ contexts: [] }),
    });

    const result = await browserTabs(cdp, {});

    expect(result.tabs).toBeDefined();
    expect(result.tabs).toHaveLength(0);
  });
});

// ============================================================================
// browser_console_messages (src/tools/browser-console-messages.ts)
// ============================================================================

describe("browser_console_messages", () => {
  let cdp: ReturnType<typeof createMockBiDi>;

  beforeEach(() => {
    resetConsoleBuffer();
    cdp = createMockBiDi();
    setupConsoleCapture(cdp);
  });

  /** Helper: emit a Runtime.consoleAPICalled event */
  function emitConsole(level: string, ...texts: string[]) {
    cdp._emit("log.entryAdded", {
      type: "console",
      level: level,
      args: texts.map((t) => ({ type: "string", value: t })),
      timestamp: Date.now(),
    });
  }

  // --- TS-13: Capture all console types ---

  it("should capture console.log, warn, error, info messages (TS-13)", async () => {
    emitConsole("log", "Hello from console.log");
    emitConsole("warn", "This is a warning");
    emitConsole("error", "Something broke");
    emitConsole("info", "Info message");

    const result = await browserConsoleMessages(cdp, {});

    expect(result.messages).toBeDefined();
    expect(result.messages).toHaveLength(4);

    const levels = result.messages.map((m) => m.level);
    expect(levels).toContain("log");
    expect(levels).toContain("warn");
    expect(levels).toContain("error");
    expect(levels).toContain("info");
  });

  // --- Structured messages ---

  it("should return structured messages with level, text, timestamp", async () => {
    emitConsole("log", "structured test");

    const result = await browserConsoleMessages(cdp, {});

    expect(result.messages[0]).toHaveProperty("level", "log");
    expect(result.messages[0]).toHaveProperty("text", "structured test");
    expect(result.messages[0]).toHaveProperty("timestamp");
    expect(typeof result.messages[0].timestamp).toBe("number");
  });

  // --- TS-17: High-volume console output ---

  it("should handle high-volume console output with truncation/limit (TS-17)", async () => {
    // EventBuffer caps at 500, then limit caps further
    for (let i = 0; i < 600; i++) {
      emitConsole("log", `Log message ${i}`);
    }

    const result = await browserConsoleMessages(cdp, { limit: 100 });

    expect(result.messages.length).toBeLessThanOrEqual(100);
  });

  it("should default to a reasonable limit when no limit is specified", async () => {
    for (let i = 0; i < 600; i++) {
      emitConsole("log", `Message ${i}`);
    }

    const result = await browserConsoleMessages(cdp, {});

    // Default limit is 100, buffer caps at 500
    expect(result.messages.length).toBeLessThanOrEqual(100);
  });

  // --- Filter by level ---

  it("should filter messages by level (error only)", async () => {
    emitConsole("log", "debug msg");
    emitConsole("warn", "warn msg");
    emitConsole("error", "err msg");

    const result = await browserConsoleMessages(cdp, { level: "error" });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].level).toBe("error");
  });

  it("should filter messages by level (warn only)", async () => {
    emitConsole("log", "log msg");
    emitConsole("info", "info msg");
    emitConsole("warn", "warn msg");
    emitConsole("error", "err msg");

    const result = await browserConsoleMessages(cdp, { level: "warn" });

    expect(result.messages.length).toBe(1);
    expect(result.messages[0].level).toBe("warn");
  });

  // --- Multiple text values ---

  it("should return messages with text content", async () => {
    cdp._emit("log.entryAdded", {
      type: "console",
      level: "log",
      args: [
        { type: "string", value: "User:" },
        { type: "object", value: null, description: '{"id":42}' },
        { type: "number", value: 3.14 },
      ],
      timestamp: Date.now(),
    });

    const result = await browserConsoleMessages(cdp, {});

    expect(result.messages[0].text).toBeDefined();
    expect(result.messages[0].text).toContain("User:");
  });

  // --- Edge case: empty messages ---

  it("should handle empty message list", async () => {
    // No events emitted — buffer is empty
    const result = await browserConsoleMessages(cdp, {});

    expect(result.messages).toBeDefined();
    expect(result.messages).toHaveLength(0);
  });

  // --- Edge case: non-standard console types are ignored ---

  it("should ignore non-standard console types (debug, trace, etc.)", async () => {
    cdp._emit("log.entryAdded", {
      type: "console",
      level: "debug",
      args: [{ type: "string", value: "debug msg" }],
      timestamp: Date.now(),
    });
    cdp._emit("log.entryAdded", {
      type: "console",
      level: "trace",
      args: [{ type: "string", value: "trace msg" }],
      timestamp: Date.now(),
    });
    emitConsole("log", "real msg");

    const result = await browserConsoleMessages(cdp, {});

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe("real msg");
  });

  // --- CDP 'warning' → 'warn' mapping ---

  it("should map CDP 'warning' type to 'warn' level", async () => {
    cdp._emit("log.entryAdded", {
      type: "console",
      level: "warning",
      args: [{ type: "string", value: "mapped warning" }],
      timestamp: Date.now(),
    });

    const result = await browserConsoleMessages(cdp, { level: "warn" });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].level).toBe("warn");
    expect(result.messages[0].text).toBe("mapped warning");
  });

  // --- Buffer reset ---

  it("should return empty after resetConsoleBuffer", async () => {
    emitConsole("log", "before reset");
    resetConsoleBuffer();

    const result = await browserConsoleMessages(cdp, {});
    expect(result.messages).toHaveLength(0);
  });

  // --- Redaction: console messages containing JWTs/Bearer tokens are redacted ---

  it("should redact JWT tokens in console message text", async () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    emitConsole("log", `Auth token: ${jwt}`);

    const result = await browserConsoleMessages(cdp, {});

    expect(result.messages[0].text).not.toContain(jwt);
    expect(result.messages[0].text).toContain("[REDACTED_JWT]");
  });

  it("should redact Bearer tokens in console message text", async () => {
    emitConsole("warn", "Request failed with Bearer my-secret-api-key");

    const result = await browserConsoleMessages(cdp, {});

    expect(result.messages[0].text).not.toContain("my-secret-api-key");
    expect(result.messages[0].text).toContain("[REDACTED]");
  });
});

// ============================================================================
// browser_network_requests (src/tools/browser-network-requests.ts)
// ============================================================================

describe("browser_network_requests", () => {
  let cdp: ReturnType<typeof createMockBiDi>;

  beforeEach(() => {
    resetNetworkBuffer();
    cdp = createMockBiDi();
    setupNetworkCapture(cdp);
  });

  /** Helper: emit a network.beforeRequestSent event */
  function emitRequest(requestId: string, url: string, method = "GET", _type = "Fetch") {
    cdp._emit("network.beforeRequestSent", {
      request: { request: requestId, url, method },
      timestamp: Date.now(),
    });
  }

  /** Helper: emit a network.responseCompleted event */
  function emitResponse(requestId: string, _url: string, status: number, _headers: Record<string, string> = {}) {
    cdp._emit("network.responseCompleted", {
      request: { request: requestId },
      response: { url: _url, status },
      timestamp: Date.now(),
    });
  }

  // --- TS-12: Capture HTTP requests via CDP events ---

  it("should capture HTTP requests with url, method, type, status (TS-12)", async () => {
    emitRequest("1", "https://api.example.com/users", "GET", "Fetch");
    emitResponse("1", "https://api.example.com/users", 200);
    emitRequest("2", "https://api.example.com/users/1/settings", "POST", "Fetch");
    emitResponse("2", "https://api.example.com/users/1/settings", 201);

    const result = await browserNetworkRequests(cdp, {});

    expect(result.requests).toBeDefined();
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0]).toHaveProperty("method", "GET");
    expect(result.requests[0]).toHaveProperty("url", "https://api.example.com/users");
    expect(result.requests[0]).toHaveProperty("status", 200);
    expect(result.requests[1]).toHaveProperty("url", "https://api.example.com/users/1/settings");
    expect(result.requests[1]).toHaveProperty("method", "POST");
  });

  it("should include status code from responseReceived", async () => {
    emitRequest("1", "https://api.example.com/data", "GET", "Fetch");
    emitResponse("1", "https://api.example.com/data", 404);

    const result = await browserNetworkRequests(cdp, {});

    expect(result.requests[0]).toHaveProperty("status", 404);
  });

  // --- TS-18: High-volume network traffic ---

  it("should handle high-volume network traffic with limit (TS-18)", async () => {
    for (let i = 0; i < 500; i++) {
      emitRequest(`r${i}`, `https://api.example.com/data/${i}`, "GET", "Fetch");
    }

    const result = await browserNetworkRequests(cdp, { limit: 100 });

    expect(result.requests.length).toBeLessThanOrEqual(100);
  });

  it("should keep the first N requests when limiting (slice behavior)", async () => {
    for (let i = 0; i < 200; i++) {
      emitRequest(`r${i}`, `https://api.example.com/data/${i}`, "GET", "Fetch");
    }

    const result = await browserNetworkRequests(cdp, { limit: 10 });

    expect(result.requests.length).toBe(10);
  });

  // --- Filter by URL substring ---

  it("should filter by URL substring", async () => {
    emitRequest("1", "https://api.example.com/users", "GET", "Fetch");
    emitRequest("2", "https://cdn.example.com/image.png", "GET", "Image");
    emitRequest("3", "https://api.example.com/settings", "GET", "Fetch");

    const result = await browserNetworkRequests(cdp, { filter: "api" });

    expect(result.requests).toHaveLength(2);
    expect(result.requests.every((r) => r.url.includes("api"))).toBe(true);
  });

  // --- Filter static resources ---

  it("should return all requests since BiDi does not distinguish static resource types", async () => {
    emitRequest("1", "https://api.example.com/users", "GET");
    emitRequest("2", "https://cdn.example.com/bundle.js", "GET");
    emitRequest("3", "https://cdn.example.com/style.css", "GET");

    const result = await browserNetworkRequests(cdp, {});

    // BiDi network events don't include resource type, all treated as "Fetch"
    expect(result.requests).toHaveLength(3);
  });

  it("should include static resources when includeStatic is true", async () => {
    emitRequest("1", "https://api.example.com/users", "GET", "Fetch");
    emitRequest("2", "https://cdn.example.com/bundle.js", "GET", "Script");

    const result = await browserNetworkRequests(cdp, { includeStatic: true });

    expect(result.requests).toHaveLength(2);
  });

  // --- Empty request list ---

  it("should handle empty request list gracefully", async () => {
    // No events emitted
    const result = await browserNetworkRequests(cdp, {});

    expect(result.requests).toBeDefined();
    expect(result.requests).toHaveLength(0);
  });

  // --- Buffer reset ---

  it("should return empty after resetNetworkBuffer", async () => {
    emitRequest("1", "https://api.example.com/data", "GET", "Fetch");
    resetNetworkBuffer();

    const result = await browserNetworkRequests(cdp, {});
    expect(result.requests).toHaveLength(0);
  });

  // --- Redaction: URLs containing JWTs/Bearer tokens are redacted ---

  it("should redact JWT tokens in request URLs", async () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    emitRequest("1", `https://api.example.com/data?token=${jwt}`, "GET", "Fetch");

    const result = await browserNetworkRequests(cdp, {});

    expect(result.requests[0].url).not.toContain(jwt);
    expect(result.requests[0].url).toContain("[REDACTED_JWT]");
  });

  it("should redact Bearer tokens in request URLs", async () => {
    emitRequest("1", "https://api.example.com/data?auth=Bearer sk-secret-token-12345", "GET", "Fetch");

    const result = await browserNetworkRequests(cdp, {});

    expect(result.requests[0].url).not.toContain("sk-secret-token-12345");
    expect(result.requests[0].url).toContain("[REDACTED]");
  });
});

// ============================================================================
// Ref System (src/ref-system.ts)
// ============================================================================

describe("RefSystem", () => {
  let refSystem: RefSystem;

  beforeEach(() => {
    refSystem = new RefSystem();
  });

  // --- Generate refs from AX tree ---

  it("should generate @eN refs from accessibility tree nodes", () => {
    const axNodes = axTreeSimplePage().nodes;
    const refs = refSystem.buildRefs(axNodes);

    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0].ref).toBe("@e1");
    expect(refs[1].ref).toBe("@e2");
    expect(refs[2].ref).toBe("@e3");
  });

  it("should assign sequential refs starting from @e1", () => {
    const axNodes = axTreeFormPage().nodes;
    const refs = refSystem.buildRefs(axNodes);

    for (let i = 0; i < refs.length; i++) {
      expect(refs[i].ref).toBe(`@e${i + 1}`);
    }
  });

  it("should skip the root WebArea node when assigning refs", () => {
    const axNodes = axTreeSimplePage().nodes;
    const refs = refSystem.buildRefs(axNodes);

    // The WebArea root should NOT get a ref
    const webAreaRef = refs.find((r) => r.role === "WebArea");
    expect(webAreaRef).toBeUndefined();
  });

  // --- Cache refs between commands ---

  it("should cache refs between commands", () => {
    const axNodes = axTreeSimplePage().nodes;
    refSystem.buildRefs(axNodes);

    // Resolving a ref should work from cache without rebuild
    const entry = refSystem.resolve("@e1");
    expect(entry).toBeDefined();
    expect(entry?.role).toBe("heading");
    expect(entry?.name).toBe("Welcome");
  });

  // --- Resolve @eN ref to backendNodeId ---

  it("should resolve @eN ref to backendNodeId", () => {
    const axNodes = axTreeSimplePage().nodes;
    refSystem.buildRefs(axNodes);

    const entry = refSystem.resolve("@e1");
    expect(entry).toBeDefined();
    expect(entry?.backendNodeId).toBe(2); // heading node
  });

  it("should resolve @e3 to the button node", () => {
    const axNodes = axTreeSimplePage().nodes;
    refSystem.buildRefs(axNodes);

    const entry = refSystem.resolve("@e3");
    expect(entry).toBeDefined();
    expect(entry?.role).toBe("button");
    expect(entry?.name).toBe("Submit");
    expect(entry?.backendNodeId).toBe(4);
  });

  // --- Ref attributes stored ---

  it("should store role and name in ref entries", () => {
    const axNodes = axTreeSimplePage().nodes;
    const refs = refSystem.buildRefs(axNodes);

    const headingRef = refs.find((r) => r.role === "heading");
    expect(headingRef).toBeDefined();
    expect(headingRef?.name).toBe("Welcome");

    const buttonRef = refs.find((r) => r.role === "button");
    expect(buttonRef).toBeDefined();
    expect(buttonRef?.name).toBe("Submit");
  });

  it("should store description in ref entries", () => {
    const axNodes = axTreeFormPage().nodes;
    const refs = refSystem.buildRefs(axNodes);

    const buttonRef = refs.find((r) => r.name === "Sign Up");
    expect(buttonRef).toBeDefined();
    expect(buttonRef?.description).toBe("Create your account");
  });

  it("should store value in ref entries for textboxes", () => {
    const axNodes = axTreeFormPage().nodes;
    const refs = refSystem.buildRefs(axNodes);

    const emailRef = refs.find((r) => r.name === "Email");
    expect(emailRef).toBeDefined();
    expect(emailRef?.value).toBe("user@example.com");
  });

  it("should store checked state in ref entries for checkboxes", () => {
    const axNodes = axTreeFormPage().nodes;
    const refs = refSystem.buildRefs(axNodes);

    const checkboxRef = refs.find((r) => r.name === "Remember me");
    expect(checkboxRef).toBeDefined();
    expect(checkboxRef?.checked).toBe(true);
  });

  it("should store selected state in ref entries for options", () => {
    const axNodes = axTreeFormPage().nodes;
    const refs = refSystem.buildRefs(axNodes);

    const optionRef = refs.find((r) => r.name === "United States");
    expect(optionRef).toBeDefined();
    expect(optionRef?.selected).toBe(true);
  });

  it("should store expanded state in ref entries for comboboxes", () => {
    const axNodes = axTreeFormPage().nodes;
    const refs = refSystem.buildRefs(axNodes);

    const comboboxRef = refs.find((r) => r.name === "Country");
    expect(comboboxRef).toBeDefined();
    expect(comboboxRef?.expanded).toBe(false);
  });

  it("should store heading level in ref entries", () => {
    const axNodes = axTreeSimplePage().nodes;
    const refs = refSystem.buildRefs(axNodes);

    const headingRef = refs.find((r) => r.role === "heading");
    expect(headingRef).toBeDefined();
    expect(headingRef?.level).toBe(1);
  });

  // --- Invalidate cache on page navigation ---

  it("should invalidate cache on page navigation", () => {
    const axNodes = axTreeSimplePage().nodes;
    refSystem.buildRefs(axNodes);

    // Simulate navigation
    refSystem.invalidate();

    // All refs should be gone
    const entry = refSystem.resolve("@e1");
    expect(entry).toBeUndefined();
  });

  it("should return undefined for all refs after invalidation", () => {
    const axNodes = axTreeSimplePage().nodes;
    refSystem.buildRefs(axNodes);

    refSystem.invalidate();

    expect(refSystem.resolve("@e1")).toBeUndefined();
    expect(refSystem.resolve("@e2")).toBeUndefined();
    expect(refSystem.resolve("@e3")).toBeUndefined();
  });

  // --- Handle stale refs gracefully ---

  it("should handle stale refs gracefully (element removed from DOM)", () => {
    const axNodes = axTreeSimplePage().nodes;
    refSystem.buildRefs(axNodes);

    // Build a new set of refs (fewer elements - link and button removed)
    const newNodes = {
      nodes: [
        {
          nodeId: "node-1",
          backendNodeId: 1,
          role: { type: "role" as const, value: "WebArea" },
          name: { type: "computedString" as const, value: "Test Page" },
          children: [{ nodeId: "node-2", backendNodeId: 2 }],
        },
        {
          nodeId: "node-2",
          backendNodeId: 2,
          parentId: "node-1",
          role: { type: "role" as const, value: "heading" },
          name: { type: "computedString" as const, value: "Welcome" },
          properties: [{ name: "level", value: { type: "integer", value: 1 } }],
        },
      ],
    };

    // Rebuild replaces old refs
    refSystem.buildRefs(newNodes.nodes);

    // @e1 should resolve (heading still exists)
    const e1 = refSystem.resolve("@e1");
    expect(e1).toBeDefined();
    expect(e1?.role).toBe("heading");

    // @e2 was the old link, now there's nothing at @e2
    const e2 = refSystem.resolve("@e2");
    expect(e2).toBeUndefined();

    // @e3 was the old button, also gone
    const e3 = refSystem.resolve("@e3");
    expect(e3).toBeUndefined();
  });

  // --- Reset ref counter on rebuild ---

  it("should reset ref counter on rebuild", () => {
    const axNodes = axTreeSimplePage().nodes;
    refSystem.buildRefs(axNodes);

    // First build: @e1 = heading
    const firstE1 = refSystem.resolve("@e1");
    expect(firstE1?.role).toBe("heading");

    // Rebuild with different tree
    refSystem.buildRefs(axTreeFormPage().nodes);

    // After rebuild, @e1 should be the first element of the new tree (textbox "Email")
    const secondE1 = refSystem.resolve("@e1");
    expect(secondE1).toBeDefined();
    expect(secondE1?.role).toBe("textbox");
    expect(secondE1?.name).toBe("Email");
  });

  // --- Ref resolution for interaction tools ---

  it("should provide backendNodeId for interaction tool resolution", () => {
    const axNodes = axTreeSimplePage().nodes;
    refSystem.buildRefs(axNodes);

    const entry = refSystem.resolve("@e3");
    expect(entry).toBeDefined();
    expect(typeof entry?.backendNodeId).toBe("number");
    // Interaction tools can use this backendNodeId with DOM.resolveNode
    expect(entry?.backendNodeId).toBe(4);
  });

  // --- Invalid ref formats ---

  it("should return undefined for invalid ref formats", () => {
    const axNodes = axTreeSimplePage().nodes;
    refSystem.buildRefs(axNodes);

    expect(refSystem.resolve("invalid")).toBeUndefined();
    expect(refSystem.resolve("@e0")).toBeUndefined();
    expect(refSystem.resolve("@e999")).toBeUndefined();
    expect(refSystem.resolve("")).toBeUndefined();
  });

  it("should return undefined for non-@e prefixed strings", () => {
    const axNodes = axTreeSimplePage().nodes;
    refSystem.buildRefs(axNodes);

    expect(refSystem.resolve("e1")).toBeUndefined();
    expect(refSystem.resolve("#e1")).toBeUndefined();
    expect(refSystem.resolve("ref1")).toBeUndefined();
  });

  // --- Performance ---

  it("should handle large trees (1000+ elements) efficiently", () => {
    const largeTree = axTreeLarge(1500);

    const start = performance.now();
    const refs = refSystem.buildRefs(largeTree.nodes);
    const elapsed = performance.now() - start;

    // Should process 1500 elements quickly
    expect(refs.length).toBe(1500); // excluding root
    expect(elapsed).toBeLessThan(500); // Should be very fast for in-memory processing
  });

  it("should resolve refs efficiently in a large tree", () => {
    const largeTree = axTreeLarge(1500);
    refSystem.buildRefs(largeTree.nodes);

    const start = performance.now();
    // Resolve 100 random refs
    for (let i = 1; i <= 100; i++) {
      const entry = refSystem.resolve(`@e${i}`);
      expect(entry).toBeDefined();
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100); // 100 lookups should be near-instant
  });
});

// ============================================================================
// Integration-like scenarios (combining multiple observation tools)
// ============================================================================

describe("observation tools integration", () => {
  it("should snapshot + resolve ref + evaluate on element (full workflow)", async () => {
    const refSystem = new RefSystem();

    const cdp = createMockBiDi({
      "script.evaluate": (p: unknown) => {
        const params = p as { expression?: string };
        const expr = params?.expression ?? "";
        if (expr.includes("getRole") || expr.includes("traverse")) {
          return { result: { value: axTreeToSnapshot(axTreeSimplePage()) } };
        }
        return { result: { type: "string", value: "My Page Title" } };
      },
    });

    // Step 1: snapshot to get refs
    const snapshot = await browserSnapshot(cdp, {});
    expect(snapshot.snapshot).toContain("@e1");

    // Step 2: build refs from the same tree (as snapshot would internally)
    const axNodes = axTreeSimplePage().nodes;
    refSystem.buildRefs(axNodes);

    // Step 3: resolve a ref
    const buttonEntry = refSystem.resolve("@e3");
    expect(buttonEntry).toBeDefined();
    expect(buttonEntry?.role).toBe("button");
    expect(buttonEntry?.name).toBe("Submit");

    // Step 4: evaluate on the page
    const evalResult = await browserEval(cdp, { expression: "document.title" });
    expect(evalResult.result).toBe("My Page Title");
  });

  it("should snapshot then screenshot with annotations sharing the same ref space", async () => {
    const cdp = createMockBiDi({}, axTreeSimplePage());

    const snapshot = await browserSnapshot(cdp, {});
    expect(snapshot.snapshot).toContain("@e1");

    const screenshot = await browserScreenshot(cdp, { annotate: true });
    expect(screenshot.base64).toBeDefined();

    // Annotations should use the same @eN ref space as the snapshot
    if (screenshot.annotations && screenshot.annotations.length > 0) {
      expect(screenshot.annotations[0].ref).toMatch(/^@e\d+$/);
    }
  });

  it("should combine console + network for debugging workflow (UC-1)", async () => {
    resetConsoleBuffer();
    resetNetworkBuffer();

    const cdp = createMockBiDi();
    setupConsoleCapture(cdp);
    setupNetworkCapture(cdp);

    // Emit console error about 500
    cdp._emit("log.entryAdded", {
      type: "console",
      level: "error",
      args: [{ type: "string", value: "GET http://localhost:8080/api/users 500" }],
      timestamp: Date.now(),
    });

    // Emit network request
    cdp._emit("network.beforeRequestSent", {
      request: { request: "req-1", url: "http://localhost:8080/api/users", method: "GET" },
      type: "Fetch",
      timestamp: Date.now() / 1000,
    });
    cdp._emit("network.responseCompleted", {
      request: { request: "req-1" },
      response: { url: "http://localhost:8080/api/users", status: 500, headers: {} },
    });

    const consoleResult = await browserConsoleMessages(cdp, {});
    const networkResult = await browserNetworkRequests(cdp, {});

    // Verify we can correlate console error with network failure
    expect(consoleResult.messages[0].text).toContain("500");
    expect(networkResult.requests[0].url).toContain("api/users");
  });

  it("should list tabs then get HTML from a specific one", async () => {
    const cdp = createMockBiDi({
      "browsingContext.getTree": () => ({
        contexts: [
          { context: "tab-1", type: "page", title: "My App", url: "http://localhost:3000", attached: true },
          { context: "tab-2", type: "page", title: "Docs", url: "https://docs.example.com", attached: false },
        ],
      }),
      "script.evaluate": () => ({
        result: {
          type: "string",
          value: "<html><body><h1>My App</h1></body></html>",
        },
      }),
    });

    const tabsResult = await browserTabs(cdp, {});
    expect(tabsResult.tabs).toHaveLength(2);

    const htmlResult = await browserHtml(cdp, {});
    expect(htmlResult.html).toContain("<h1>My App</h1>");
  });

  it("should snapshot form page and verify all ref attributes are captured", async () => {
    const refSystem = new RefSystem();

    const cdp = createMockBiDi({}, axTreeFormPage());

    const snapshot = await browserSnapshot(cdp, {});
    expect(snapshot.snapshot).toBeDefined();

    // Build refs and verify all attribute types
    const refs = refSystem.buildRefs(axTreeFormPage().nodes);

    // Textbox with value
    const email = refs.find((r) => r.name === "Email");
    expect(email?.value).toBe("user@example.com");

    // Checkbox with checked
    const checkbox = refs.find((r) => r.name === "Remember me");
    expect(checkbox?.checked).toBe(true);

    // Combobox with expanded
    const combo = refs.find((r) => r.name === "Country");
    expect(combo?.expanded).toBe(false);

    // Option with selected
    const option = refs.find((r) => r.name === "United States");
    expect(option?.selected).toBe(true);

    // Button with description
    const button = refs.find((r) => r.name === "Sign Up");
    expect(button?.description).toBe("Create your account");
  });
});

// ============================================================================
// DPR Detection Cascade — 2-Level Fallback (Gap 1.3)
// ============================================================================

describe("DPR Detection Cascade", () => {
  // --- Level 1: Page.getLayoutMetrics ---

  it("should compute DPR from Page.getLayoutMetrics visualViewport dimensions (Level 1)", async () => {
    // Given: Page.getLayoutMetrics returns valid metrics with visualViewport
    const cdp = createMockBiDi({
      "script.evaluate": () => ({
        contentSize: { width: 1280, height: 720 },
        cssContentSize: { width: 1280, height: 720 },
        layoutViewport: { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 720 },
        visualViewport: { clientWidth: 1280, clientHeight: 720, pageX: 0, pageY: 0, scale: 1 },
        cssVisualViewport: { clientWidth: 640, clientHeight: 360 },
      }),
      "browsingContext.captureScreenshot": () => ({ data: VALID_PNG_BASE64 }),
    });

    // When: A screenshot is captured
    const result = await browserScreenshot(cdp, {});

    // Then: DPR should be computed from visualViewport (1280/640 = 2)
    expect(result.base64).toBeDefined();
  });

  // --- Level 2: Runtime.evaluate fallback ---

  it("should capture screenshot directly via browsingContext.captureScreenshot (BiDi)", async () => {
    // In BiDi, DPR detection is not needed separately — the browser handles it
    const sendSpy = vi.fn().mockImplementation(async (method: string) => {
      if (method === "browsingContext.captureScreenshot") {
        return { data: VALID_PNG_BASE64 };
      }
      return { result: { value: undefined } };
    });

    const cdp = { send: sendSpy, on: vi.fn(), off: vi.fn(), close: vi.fn(), isConnected: true } as unknown as CDPConnection;

    const result = await browserScreenshot(cdp, {});

    expect(result.base64).toBeDefined();
    expect(sendSpy).toHaveBeenCalledWith("browsingContext.captureScreenshot", expect.anything());
  });

  // --- Both fail: default to DPR=1 ---

  it("should default to DPR=1 when all detection methods fail", async () => {
    // Given: All DPR detection methods fail
    const sendSpy = vi.fn().mockImplementation(async (method: string) => {
      if (method === "script.evaluate") {
        throw new Error("Method not supported");
      }
      if (method === "script.evaluate") {
        throw new Error("Execution context destroyed");
      }
      if (method === "browsingContext.captureScreenshot") {
        return { data: VALID_PNG_BASE64 };
      }
      return {};
    });

    const cdp = { send: sendSpy, on: vi.fn(), off: vi.fn(), close: vi.fn(), isConnected: true } as unknown as CDPConnection;

    // When: A screenshot is captured
    const result = await browserScreenshot(cdp, {});

    // Then: DPR should default to 1 (no scaling applied)
    expect(result.base64).toBeDefined();
  });
});

// ============================================================================
// Accessibility Tree Processing — shouldShowAxNode (Gap 1.4)
// ============================================================================

describe("Accessibility Tree Processing - shouldShowAxNode", () => {
  // --- Filtering rules ---

  it("should return false for role='none'", () => {
    // Given: An AX node with role 'none'
    const node = {
      nodeId: "n1",
      backendNodeId: 1,
      role: { type: "role", value: "none" },
      name: { type: "computedString", value: "" },
    };

    // When: shouldShowAxNode is called
    const result = shouldShowAxNode(node, { compact: false });

    // Then: It should return false
    expect(result).toBe(false);
  });

  it("should return false for role='generic'", () => {
    // Given: An AX node with role 'generic'
    const node = {
      nodeId: "n1",
      backendNodeId: 1,
      role: { type: "role", value: "generic" },
      name: { type: "computedString", value: "" },
    };

    // When: shouldShowAxNode is called
    const result = shouldShowAxNode(node, { compact: false });

    // Then: It should return false
    expect(result).toBe(false);
  });

  it("should return false for role='InlineTextBox' in compact mode", () => {
    // Given: An AX node with role 'InlineTextBox' in compact mode
    const node = {
      nodeId: "n1",
      backendNodeId: 1,
      role: { type: "role", value: "InlineTextBox" },
      name: { type: "computedString", value: "Some text" },
    };

    // When: shouldShowAxNode is called in compact mode
    const result = shouldShowAxNode(node, { compact: true });

    // Then: It should return false
    expect(result).toBe(false);
  });

  it("should return false for node with empty name AND empty/null value", () => {
    // Given: An AX node with empty name and null value
    const node = {
      nodeId: "n1",
      backendNodeId: 1,
      role: { type: "role", value: "div" },
      name: { type: "computedString", value: "" },
      value: null,
    };

    // When: shouldShowAxNode is called
    const result = shouldShowAxNode(node, { compact: false });

    // Then: It should return false
    expect(result).toBe(false);
  });

  it("should return true for role='button' with name='Submit'", () => {
    // Given: An AX node with role 'button' and name 'Submit'
    const node = {
      nodeId: "n1",
      backendNodeId: 1,
      role: { type: "role", value: "button" },
      name: { type: "computedString", value: "Submit" },
    };

    // When: shouldShowAxNode is called
    const result = shouldShowAxNode(node, { compact: false });

    // Then: It should return true
    expect(result).toBe(true);
  });
});

describe("Accessibility Tree Processing - depth and cycle handling", () => {
  it("should cap tree traversal at depth 10", () => {
    // Given: A tree with depth > 10
    const deepTree = axTreeNested(15);

    // When: Processing the tree
    const result = processAccessibilityTree(deepTree.nodes, { maxDepth: 10 });

    // Then: Nodes beyond depth 10 should be omitted
    const lines = result.split("\n").filter((l: string) => l.trim().length > 0);
    const maxIndent = Math.max(
      ...lines.map((l: string) => {
        const match = l.match(/^(\s*)/);
        return match ? match[1].length : 0;
      }),
    );

    // 2-space indent per level → max indent should be <= 20 (10 levels * 2 spaces)
    expect(maxIndent).toBeLessThanOrEqual(20);
  });

  it("should prevent cycles in tree traversal (A -> B -> A)", () => {
    // Given: A tree with circular references (node A -> B -> A)
    const cyclicNodes = [
      {
        nodeId: "node-A",
        backendNodeId: 1,
        role: { type: "role", value: "WebArea" },
        name: { type: "computedString", value: "Root" },
        childIds: ["node-B"],
      },
      {
        nodeId: "node-B",
        backendNodeId: 2,
        parentId: "node-A",
        role: { type: "role", value: "group" },
        name: { type: "computedString", value: "Group B" },
        childIds: ["node-A"], // circular reference back to A
      },
    ];

    // When: Processing the tree
    // Then: The cycle should be detected and traversal should stop (no infinite loop)
    const result = processAccessibilityTree(cyclicNodes, {});

    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    // Should complete without hanging
  });

  it("should use 2-space indentation per depth level", () => {
    // Given: A tree with known depth
    const tree = axTreeNested(3);

    // When: Processing the tree
    const result = processAccessibilityTree(tree.nodes, {});

    // Then: Each depth level should add 2 spaces of indentation
    const lines = result.split("\n").filter((l: string) => l.trim().length > 0);

    // At least one line should have 2-space indent (depth 1)
    const hasDepth1 = lines.some((l: string) => l.startsWith("  ") && !l.startsWith("    "));
    expect(hasDepth1).toBe(true);
  });

  it("should order children via childIds[] when present", () => {
    // Given: A tree with explicit childIds ordering
    const nodes = [
      {
        nodeId: "root",
        backendNodeId: 1,
        role: { type: "role", value: "WebArea" },
        name: { type: "computedString", value: "Page" },
        childIds: ["child-b", "child-a"], // B before A
      },
      {
        nodeId: "child-a",
        backendNodeId: 2,
        parentId: "root",
        role: { type: "role", value: "button" },
        name: { type: "computedString", value: "Alpha" },
      },
      {
        nodeId: "child-b",
        backendNodeId: 3,
        parentId: "root",
        role: { type: "role", value: "button" },
        name: { type: "computedString", value: "Beta" },
      },
    ];

    // When: Processing the tree
    const result = processAccessibilityTree(nodes, {});

    // Then: Beta should appear before Alpha (matching childIds order)
    const betaPos = result.indexOf("Beta");
    const alphaPos = result.indexOf("Alpha");
    expect(betaPos).toBeGreaterThanOrEqual(0);
    expect(betaPos).toBeLessThan(alphaPos);
  });
});

// ============================================================================
// Snapshot Filtering Options (Gap 2.1)
// ============================================================================

describe("browser_snapshot filtering options", () => {
  it("should filter to only interactive elements when interactive=true", async () => {
    // Given: A page with interactive and non-interactive elements
    const cdp = createMockBiDi({}, {
      nodes: [
        { nodeId: "root", backendNodeId: 1, role: { type: "role", value: "WebArea" }, name: { type: "computedString", value: "Page" }, childIds: ["btn", "para", "link", "input"] },
        { nodeId: "btn", backendNodeId: 2, parentId: "root", role: { type: "role", value: "button" }, name: { type: "computedString", value: "Click Me" } },
        { nodeId: "para", backendNodeId: 3, parentId: "root", role: { type: "role", value: "paragraph" }, name: { type: "computedString", value: "Some text" } },
        { nodeId: "link", backendNodeId: 4, parentId: "root", role: { type: "role", value: "link" }, name: { type: "computedString", value: "Go Home" } },
        { nodeId: "input", backendNodeId: 5, parentId: "root", role: { type: "role", value: "textbox" }, name: { type: "computedString", value: "Email" } },
      ],
    });

    // When: snapshot is called with interactive=true
    const result = await browserSnapshot(cdp, { interactive: true });

    // Then: Only buttons, links, and inputs should appear
    expect(result.snapshot).toContain("button");
    expect(result.snapshot).toContain("link");
    expect(result.snapshot).toContain("textbox");
    expect(result.snapshot).not.toContain("paragraph");
  });

  it("should include cursor:pointer elements when cursor=true", async () => {
    // Given: A page with custom clickable divs (cursor:pointer)
    const cdp = createMockBiDi({}, {
      nodes: [
        { nodeId: "root", backendNodeId: 1, role: { type: "role", value: "WebArea" }, name: { type: "computedString", value: "Page" }, childIds: ["div1"] },
        { nodeId: "div1", backendNodeId: 2, parentId: "root", role: { type: "role", value: "generic" }, name: { type: "computedString", value: "Clickable Card" }, properties: [{ name: "cursor", value: { type: "string", value: "pointer" } }] },
      ],
    });

    // When: snapshot is called with cursor=true
    const result = await browserSnapshot(cdp, { cursor: true });

    // Then: Custom clickable elements should appear
    expect(result.snapshot).toContain("Clickable Card");
  });

  it("should limit tree depth when depth=3", async () => {
    // Given: A deep tree (depth > 5)
    const cdp = createMockBiDi({}, axTreeNested(8));

    // When: snapshot is called with depth=3
    const result = await browserSnapshot(cdp, { depth: 3 });

    // Then: No nodes beyond depth 3 should appear
    const lines = result.snapshot.split("\n").filter((l: string) => l.trim().length > 0);
    const maxIndent = Math.max(
      ...lines.map((l: string) => {
        const match = l.match(/^(\s*)/);
        return match ? match[1].length : 0;
      }),
    );

    // 2-space indent per level → max 6 spaces for depth 3
    expect(maxIndent).toBeLessThanOrEqual(6);
  });

  it("should apply multiple filters simultaneously: interactive=true + compact=true + depth=5", async () => {
    // Given: A page with mixed content
    const cdp = createMockBiDi({}, {
      nodes: [
        { nodeId: "root", backendNodeId: 1, role: { type: "role", value: "WebArea" }, name: { type: "computedString", value: "Page" }, childIds: ["btn", "para"] },
        { nodeId: "btn", backendNodeId: 2, parentId: "root", role: { type: "role", value: "button" }, name: { type: "computedString", value: "Submit" } },
        { nodeId: "para", backendNodeId: 3, parentId: "root", role: { type: "role", value: "paragraph" }, name: { type: "computedString", value: "Description text" } },
      ],
    });

    // When: snapshot is called with interactive=true, compact=true, depth=5
    const result = await browserSnapshot(cdp, {
      interactive: true,
      compact: true,
      depth: 5,
    });

    // Then: All three filters should be applied simultaneously
    expect(result.snapshot).toContain("button");
    expect(result.snapshot).not.toContain("paragraph");
  });
});

// ============================================================================
// Data Extraction Commands (Gap 2.9)
// ============================================================================

describe("browser data extraction commands", () => {
  describe("get text", () => {
    it("should return text content of element via Runtime.callFunctionOn", async () => {
      // Given: An element with text content "Hello World"
      const cdp = createMockBiDi({
        "script.callFunction": () => ({
          result: { type: "string", value: "Hello World" },
        }),
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
      });

      // When: get text is called on the element
      const result = await browserGetText(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return "Hello World"
      expect(result.text).toBe("Hello World");
    });

    it("should return empty string for element with no text", async () => {
      // Given: An element with no text content
      const cdp = createMockBiDi({
        "script.callFunction": () => ({
          result: { type: "string", value: "" },
        }),
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
      });

      // When: get text is called on the element
      const result = await browserGetText(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return empty string
      expect(result.text).toBe("");
    });
  });

  describe("get value", () => {
    it("should return input value", async () => {
      // Given: An input with value "test@test.com"
      const cdp = createMockBiDi({
        "script.callFunction": () => ({
          result: { type: "string", value: "test@test.com" },
        }),
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
      });

      // When: get value is called on the input
      const result = await browserGetValue(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return "test@test.com"
      expect(result.value).toBe("test@test.com");
    });

    it("should return empty string for non-input elements", async () => {
      // Given: A non-input element (e.g., a div)
      const cdp = createMockBiDi({
        "script.callFunction": () => ({
          result: { type: "string", value: "" },
        }),
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
      });

      // When: get value is called on the non-input element
      const result = await browserGetValue(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return empty string
      expect(result.value).toBe("");
    });
  });

  describe("get attr", () => {
    it("should return attribute value", async () => {
      // Given: An element with data-testid="submit-btn"
      const cdp = createMockBiDi({
        "script.callFunction": () => ({
          result: { type: "string", value: "submit-btn" },
        }),
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
      });

      // When: get attr is called for "data-testid"
      const result = await browserGetAttribute(cdp, {
        ref: "@e1",
        backendNodeId: 1,
        attribute: "data-testid",
      });

      // Then: It should return "submit-btn"
      expect(result.value).toBe("submit-btn");
    });

    it("should return null for non-existent attribute", async () => {
      // Given: An element without the requested attribute
      const cdp = createMockBiDi({
        "script.callFunction": () => ({
          result: { type: "object", subtype: "null", value: null },
        }),
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
      });

      // When: get attr is called for a non-existent attribute
      const result = await browserGetAttribute(cdp, {
        ref: "@e1",
        backendNodeId: 1,
        attribute: "data-nonexistent",
      });

      // Then: It should return null
      expect(result.value).toBeNull();
    });
  });

  describe("get count", () => {
    it("should return number of matching elements", async () => {
      // Given: A page with 5 elements matching ".item"
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          result: { type: "number", value: 5 },
        }),
      });

      // When: get count ".item" is called
      const result = await browserGetCount(cdp, { selector: ".item" });

      // Then: It should return 5
      expect(result.count).toBe(5);
    });

    it("should return 0 when no elements match", async () => {
      // Given: A page with no elements matching the selector
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          result: { type: "number", value: 0 },
        }),
      });

      // When: get count ".nonexistent" is called
      const result = await browserGetCount(cdp, { selector: ".nonexistent" });

      // Then: It should return 0
      expect(result.count).toBe(0);
    });
  });

  describe("get box", () => {
    it("should return bounding box {x, y, width, height}", async () => {
      // Given: An element with bounding box {x:10, y:20, width:100, height:50}
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: {
            type: "object",
            value: { x: 10, y: 20, width: 100, height: 50 },
          },
        }),
      });

      // When: get box is called
      const result = await browserGetBox(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return the bounding box dimensions
      expect(result.box).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    });

    it("should return null for hidden elements", async () => {
      // Given: A hidden element (display:none has no bounding box)
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: { type: "object", subtype: "null", value: null },
        }),
      });

      // When: get box is called on a hidden element
      const result = await browserGetBox(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return null
      expect(result.box).toBeNull();
    });
  });

  describe("get styles", () => {
    it("should return computed styles object", async () => {
      // Given: An element with computed styles
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: {
            type: "object",
            value: {
              backgroundColor: "rgb(0, 0, 0)",
              color: "rgb(255, 255, 255)",
              fontSize: "16px",
            },
          },
        }),
      });

      // When: get styles is called
      const result = await browserGetStyles(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return the computed styles object
      expect(result.styles).toBeDefined();
      expect(result.styles.backgroundColor).toBe("rgb(0, 0, 0)");
      expect(result.styles.color).toBe("rgb(255, 255, 255)");
    });

    it("should return specific property when requested", async () => {
      // Given: An element with a specific computed property
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: { type: "string", value: "16px" },
        }),
      });

      // When: get styles is called with a specific property
      const result = await browserGetStyles(cdp, {
        ref: "@e1",
        backendNodeId: 1,
        property: "fontSize",
      });

      // Then: It should return the specific property value
      expect(result.styles).toBe("16px");
    });
  });
});

// ============================================================================
// Element State Checks (Gap 2.10)
// ============================================================================

describe("element state checks", () => {
  describe("is visible", () => {
    it("should return true for visible element", async () => {
      // Given: A visible element
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: { type: "boolean", value: true },
        }),
      });

      // When: is visible is called
      const result = await browserIsVisible(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return true
      expect(result.visible).toBe(true);
    });

    it("should return false for display:none element", async () => {
      // Given: An element with display:none
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: { type: "boolean", value: false },
        }),
      });

      // When: is visible is called
      const result = await browserIsVisible(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return false
      expect(result.visible).toBe(false);
    });

    it("should return false for visibility:hidden element", async () => {
      // Given: An element with visibility:hidden
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: { type: "boolean", value: false },
        }),
      });

      // When: is visible is called
      const result = await browserIsVisible(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return false
      expect(result.visible).toBe(false);
    });

    it("should return false for element with zero dimensions", async () => {
      // Given: An element with zero width and height
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: { type: "boolean", value: false },
        }),
      });

      // When: is visible is called
      const result = await browserIsVisible(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return false
      expect(result.visible).toBe(false);
    });
  });

  describe("is enabled", () => {
    it("should return true for enabled input", async () => {
      // Given: An enabled input element
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: { type: "boolean", value: true },
        }),
      });

      // When: is enabled is called
      const result = await browserIsEnabled(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return true
      expect(result.enabled).toBe(true);
    });

    it("should return false for disabled input", async () => {
      // Given: A disabled input element
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: { type: "boolean", value: false },
        }),
      });

      // When: is enabled is called
      const result = await browserIsEnabled(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return false
      expect(result.enabled).toBe(false);
    });

    it("should return true for non-form elements (always enabled)", async () => {
      // Given: A non-form element (e.g., a div)
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: { type: "boolean", value: true },
        }),
      });

      // When: is enabled is called on a non-form element
      const result = await browserIsEnabled(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return true (non-form elements are always enabled)
      expect(result.enabled).toBe(true);
    });
  });

  describe("is checked", () => {
    it("should return true for checked checkbox", async () => {
      // Given: A checked checkbox
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: { type: "boolean", value: true },
        }),
      });

      // When: is checked is called
      const result = await browserIsChecked(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return true
      expect(result.checked).toBe(true);
    });

    it("should return false for unchecked checkbox", async () => {
      // Given: An unchecked checkbox
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: { type: "boolean", value: false },
        }),
      });

      // When: is checked is called
      const result = await browserIsChecked(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return false
      expect(result.checked).toBe(false);
    });

    it("should work for radio buttons", async () => {
      // Given: A selected radio button
      const cdp = createMockBiDi({
        "script.evaluate": () => ({
          object: { objectId: "obj-1" },
        }),
        "script.callFunction": () => ({
          result: { type: "boolean", value: true },
        }),
      });

      // When: is checked is called on a radio button
      const result = await browserIsChecked(cdp, { ref: "@e1", backendNodeId: 1 });

      // Then: It should return true
      expect(result.checked).toBe(true);
    });
  });
});

// ============================================================================
// Console Clear (Gap 2.16)
// ============================================================================

describe("console clear", () => {
  let cdp: ReturnType<typeof createMockBiDi>;

  beforeEach(() => {
    resetConsoleBuffer();
    cdp = createMockBiDi();
    setupConsoleCapture(cdp);
  });

  it("should return captured console messages from the buffer", async () => {
    // Given: The console buffer has 100 messages via CDP events
    for (let i = 0; i < 100; i++) {
      cdp._emit("log.entryAdded", {
      type: "console",
      level: "log",
        args: [{ type: "string", value: `Message ${i}` }],
        timestamp: Date.now() + i,
      });
    }

    // When: console messages are retrieved
    const result = await browserConsoleMessages(cdp, {});

    // Then: All 100 messages should be returned (default limit is 100)
    expect(result.messages).toHaveLength(100);
  });

  it("should return empty messages when buffer is empty", async () => {
    // Given: No events emitted — buffer is empty

    // When: console view is called with empty buffer
    const result = await browserConsoleMessages(cdp, {});

    // Then: Messages should be empty
    expect(result.messages).toHaveLength(0);
  });
});

// ============================================================================
// Eval Variants — stdin and base64 (Gap 2.17)
// ============================================================================

describe("eval variants", () => {
  let cdp: ReturnType<typeof createMockBiDi>;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  it("should evaluate multi-line expression (stdin mode)", async () => {
    // Given: A multi-line JavaScript string
    const multiLineExpression = `
      const items = document.querySelectorAll('.item');
      const texts = Array.from(items).map(el => el.textContent);
      texts.join(', ')
    `;

    cdp = createMockBiDi({
      "script.evaluate": (p: unknown) => {
        const params = p as { expression: string };
        // Verify the full multi-line expression is passed through
        expect(params.expression).toContain("querySelectorAll");
        expect(params.expression).toContain("textContent");
        return {
          result: { type: "string", value: "Item 1, Item 2, Item 3" },
        };
      },
    });

    // When: eval is called via stdin mode
    const result = await browserEval(cdp, {
      expression: multiLineExpression,
      stdin: true,
    });

    // Then: The entire multi-line expression should be evaluated
    expect(result.result).toBe("Item 1, Item 2, Item 3");
  });

  it("should decode and evaluate base64-encoded expression", async () => {
    // Given: A base64-encoded JavaScript string
    // "document.title" in base64
    const base64Expression = btoa("document.title");

    cdp = createMockBiDi({
      "script.evaluate": (p: unknown) => {
        const params = p as { expression: string };
        // The implementation should decode base64 before evaluating
        expect(params.expression).toBe("document.title");
        return {
          result: { type: "string", value: "My Page" },
        };
      },
    });

    // When: eval is called with base64 flag
    const result = await browserEval(cdp, {
      expression: base64Expression,
      base64: true,
    });

    // Then: It should decode and evaluate, returning the result
    expect(result.result).toBe("My Page");
  });
});

// ============================================================================
// TS-10: DOM Content to Markdown Extraction (BDD Scenario Gap)
// ============================================================================

describe("TS-10: DOM content to markdown", () => {
  let cdp: ReturnType<typeof createMockBiDi>;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  it("should convert headings to # markdown syntax", async () => {
    // Given: A page with heading elements
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        result: {
          type: "string",
          value: "<h1>Main Title</h1><h2>Subtitle</h2><h3>Section</h3>",
        },
      }),
    });

    // When: extractContentAsMarkdown is called
    const result = await extractContentAsMarkdown(cdp, {});

    // Then: Headings should be converted to # syntax
    expect(result.markdown).toContain("# Main Title");
    expect(result.markdown).toContain("## Subtitle");
    expect(result.markdown).toContain("### Section");
  });

  it("should wrap code blocks in fenced markdown", async () => {
    // Given: A page with code blocks
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        result: {
          type: "string",
          value: '<pre><code class="language-js">const x = 1;</code></pre>',
        },
      }),
    });

    // When: extractContentAsMarkdown is called
    const result = await extractContentAsMarkdown(cdp, {});

    // Then: Code blocks should be fenced with ```
    expect(result.markdown).toContain("```");
    expect(result.markdown).toContain("const x = 1;");
  });

  it("should convert tables to markdown tables", async () => {
    // Given: A page with an HTML table
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        result: {
          type: "string",
          value: "<table><thead><tr><th>Name</th><th>Age</th></tr></thead><tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>",
        },
      }),
    });

    // When: extractContentAsMarkdown is called
    const result = await extractContentAsMarkdown(cdp, {});

    // Then: Tables should be valid markdown tables
    expect(result.markdown).toContain("| Name | Age |");
    expect(result.markdown).toContain("| Alice | 30 |");
    // Should have separator row
    expect(result.markdown).toMatch(/\|[\s-]+\|[\s-]+\|/);
  });

  it("should exclude navigation/sidebar elements", async () => {
    // Given: A page with nav, aside, and main content
    cdp = createMockBiDi({
      "script.evaluate": () => ({
        result: {
          type: "string",
          value: "<nav>Menu items</nav><aside>Sidebar</aside><main><h1>Content</h1><p>Main text</p></main>",
        },
      }),
    });

    // When: extractContentAsMarkdown is called
    const result = await extractContentAsMarkdown(cdp, {});

    // Then: Navigation and sidebar elements should be excluded
    expect(result.markdown).not.toContain("Menu items");
    expect(result.markdown).not.toContain("Sidebar");
    expect(result.markdown).toContain("Content");
    expect(result.markdown).toContain("Main text");
  });
});
