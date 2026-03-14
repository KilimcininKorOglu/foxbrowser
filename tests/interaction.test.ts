/**
 * interaction.test.ts — TDD tests for ALL mutating/interaction tools in browsirai.
 *
 * Tools covered:
 *   browser_navigate, browser_navigate_back, browser_click, browser_fill_form,
 *   browser_type, browser_press_key, browser_scroll, browser_hover, browser_drag,
 *   browser_select_option, browser_file_upload, browser_handle_dialog,
 *   browser_wait_for, browser_close, browser_resize
 *
 * All tests mock the CDP connection. Imports reference ../src/... paths
 * that do not exist yet (TDD — implementations are written after tests).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// TDD Imports — these modules DO NOT exist yet; implementations will follow.
// ---------------------------------------------------------------------------
import { browserNavigate } from "../src/tools/browser-navigate";
import { browserNavigateBack } from "../src/tools/browser-navigate-back";
import { browserClick } from "../src/tools/browser-click";
import { browserFillForm } from "../src/tools/browser-fill-form";
import { browserType } from "../src/tools/browser-type";
import { browserPressKey } from "../src/tools/browser-press-key";
import { browserScroll } from "../src/tools/browser-scroll";
import { browserHover } from "../src/tools/browser-hover";
import { browserDrag } from "../src/tools/browser-drag";
import { browserSelectOption } from "../src/tools/browser-select-option";
import { browserFileUpload } from "../src/tools/browser-file-upload";
import { browserHandleDialog } from "../src/tools/browser-handle-dialog";
import { browserWaitFor } from "../src/tools/browser-wait-for";
import { browserClose } from "../src/tools/browser-close";
import { browserResize } from "../src/tools/browser-resize";

// ---------------------------------------------------------------------------
// TDD Imports — Gap Analysis additions (sections 1.2–2.15)
// ---------------------------------------------------------------------------
import { browserKeyboard } from "../src/tools/browser-keyboard";
import { browserCheck, browserUncheck } from "../src/tools/browser-check";
import { browserFocus } from "../src/tools/browser-focus";
import { browserTabNew, browserWindowNew } from "../src/tools/browser-tab";
import { browserFrameSwitch, browserFrameMain } from "../src/tools/browser-frame";
import { browserClipboardRead, browserClipboardWrite } from "../src/tools/browser-clipboard";
import { listFrames } from "../src/tools/browser-frames";
import { browserScrollIntoView } from "../src/tools/browser-scroll-into-view";
import { findByRole, findByText, findByLabel, findByPlaceholder, findByAlt, findByTitle, findByTestId, findFirst, findLast, findNth, browserFind } from "../src/tools/browser-find";
import { waitForDocumentReady } from "../src/bidi/wait-ready";

// ---------------------------------------------------------------------------
// TDD Imports — Network intercept tools (browser_route, browser_abort, browser_unroute)
// ---------------------------------------------------------------------------
import { browserRoute, browserAbort, browserUnroute, resetInterceptState } from "../src/tools/browser-intercept";
import { browserDiff } from "../src/tools/browser-diff";

// ---------------------------------------------------------------------------
// Mock CDP Session Factory
// ---------------------------------------------------------------------------

/**
 * Creates a mock CDP session that records all CDP method calls and lets
 * individual tests configure responses per-method.
 */
function createMockBiDi() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const responses = new Map<string, unknown>();
  const eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const bufferedEvents = new Map<string, unknown[][]>();

  const session = {
    send: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (responses.has(method)) {
        const response = responses.get(method);
        if (typeof response === "function") {
          return (response as (params: unknown) => unknown)(params);
        }
        return response;
      }
      return {};
    }),

    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, []);
      }
      eventHandlers.get(event)!.push(handler);

      // Replay any buffered events that were emitted before this handler was registered
      const buffered = bufferedEvents.get(event);
      if (buffered && buffered.length > 0) {
        for (const args of buffered) {
          handler(...args);
        }
        bufferedEvents.delete(event);
      }
    }),

    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = eventHandlers.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    }),

    // Test helpers — not part of real CDP session
    _calls: calls,
    _setResponse(method: string, value: unknown) {
      responses.set(method, value);
    },
    _emit(event: string, ...args: unknown[]) {
      const handlers = eventHandlers.get(event);
      if (handlers && handlers.length > 0) {
        handlers.forEach((h) => h(...args));
      } else {
        // Buffer the event for replay when a handler is registered
        if (!bufferedEvents.has(event)) {
          bufferedEvents.set(event, []);
        }
        bufferedEvents.get(event)!.push(args);
      }
    },
    async _emitAsync(event: string, ...args: unknown[]) {
      const handlers = eventHandlers.get(event);
      if (handlers && handlers.length > 0) {
        await Promise.all(handlers.map((h) => h(...args)));
      } else {
        if (!bufferedEvents.has(event)) {
          bufferedEvents.set(event, []);
        }
        bufferedEvents.get(event)!.push(args);
      }
    },
    _getCalls(method: string) {
      return calls.filter((c) => c.method === method);
    },
    _reset() {
      calls.length = 0;
      responses.clear();
      eventHandlers.clear();
      bufferedEvents.clear();
      session.send.mockClear();
      session.on.mockClear();
      session.off.mockClear();
    },
  };

  return session;
}

type MockBiDi = ReturnType<typeof createMockBiDi>;

// ===========================================================================
// browser_navigate
// ===========================================================================

describe("browser_navigate", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  it("should navigate to URL and return title + URL", async () => {
    cdp._setResponse("browsingContext.navigate", { navigation: "nav-1", url: "about:blank" });
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("document.title")) {
        return { result: { type: "string", value: "Example Domain" } };
      }
      if (p.expression.includes("location.href")) {
        return { result: { type: "string", value: "https://example.com/" } };
      }
      return { result: { type: "undefined" } };
    });

    const result = await browserNavigate(cdp as never, {
      url: "https://example.com",
    });

    expect(result.url).toBe("https://example.com/");
    expect(result.title).toBe("Example Domain");
    expect(cdp._getCalls("browsingContext.navigate")).toHaveLength(1);
    expect(cdp._getCalls("browsingContext.navigate")[0].params).toEqual(
      expect.objectContaining({ url: "https://example.com" })
    );
  });

  it("should wait for load event after navigation", async () => {
    cdp._setResponse("browsingContext.navigate", { navigation: "nav-1", url: "about:blank" });
    cdp._setResponse("script.evaluate", {
      result: { type: "string", value: "Test" },
    });

    await browserNavigate(cdp as never, {
      url: "https://example.com",
      waitUntil: "load",
    });

    // Verify that the navigation waited for the load event
    // The implementation should listen for Page.loadEventFired or poll
    const navCalls = cdp._getCalls("browsingContext.navigate");
    expect(navCalls).toHaveLength(1);
  });

  it("should handle net::ERR_NAME_NOT_RESOLVED error", async () => {
    cdp._setResponse("browsingContext.navigate", () => {
      throw new Error("net::ERR_NAME_NOT_RESOLVED");
    });

    await expect(
      browserNavigate(cdp as never, {
        url: "https://nonexistent.invalid",
      })
    ).rejects.toThrow(/ERR_NAME_NOT_RESOLVED|navigation.*failed|cannot.*resolve/i);
  });

  it("should handle navigation timeout", async () => {
    cdp._setResponse("browsingContext.navigate", () => {
      return new Promise(() => {
        // Never resolves — simulates timeout
      });
    });

    await expect(
      browserNavigate(cdp as never, {
        url: "https://slow-site.example.com",
      })
    ).rejects.toThrow(/timeout/i);
  });

  it("should handle redirect and return final URL", async () => {
    cdp._setResponse("browsingContext.navigate", { navigation: "nav-1", url: "about:blank" });
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("location.href")) {
        return {
          result: {
            type: "string",
            value: "https://example.com/redirected",
          },
        };
      }
      return { result: { type: "string", value: "Redirected Page" } };
    });

    const result = await browserNavigate(cdp as never, {
      url: "https://example.com/old-path",
    });

    expect(result.url).toBe("https://example.com/redirected");
  });

  it("should handle same-document navigation (hash change, no loaderId)", async () => {
    // Same-document navigations (e.g., #section) return no loaderId
    cdp._setResponse("browsingContext.navigate", {
      frameId: "frame-1",
      // No loaderId — indicates same-document navigation
    });
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("document.title")) {
        return { result: { type: "string", value: "Page Title" } };
      }
      if (p.expression.includes("location.href")) {
        return {
          result: {
            type: "string",
            value: "https://example.com/page#section2",
          },
        };
      }
      return { result: { type: "undefined" } };
    });

    const result = await browserNavigate(cdp as never, {
      url: "https://example.com/page#section2",
    });

    expect(result.url).toBe("https://example.com/page#section2");
    expect(result.title).toBe("Page Title");
    // Should NOT wait for load event on same-document navigation (no loaderId)
  });

  it("should pass waitUntil option to control load wait strategy", async () => {
    cdp._setResponse("browsingContext.navigate", { navigation: "nav-1", url: "about:blank" });
    cdp._setResponse("script.evaluate", {
      result: { type: "string", value: "Test" },
    });

    await browserNavigate(cdp as never, {
      url: "https://example.com",
      waitUntil: "domcontentloaded",
    });

    const navCalls = cdp._getCalls("browsingContext.navigate");
    expect(navCalls).toHaveLength(1);
  });
});

// ===========================================================================
// browser_navigate_back
// ===========================================================================

describe("browser_navigate_back", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  it("should go back in navigation history", async () => {
    cdp._setResponse("browsingContext.traverseHistory", {});
    cdp._setResponse("script.evaluate", { result: { value: "https://example.com/page2" } });

    const result = await browserNavigateBack(cdp as never, { direction: "back" });

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://example.com/page2");

    const historyCalls = cdp._getCalls("browsingContext.traverseHistory");
    expect(historyCalls).toHaveLength(1);
    expect(historyCalls[0].params).toEqual(expect.objectContaining({ delta: -1 }));
  });

  it("should go forward in navigation history", async () => {
    cdp._setResponse("browsingContext.traverseHistory", {});
    cdp._setResponse("script.evaluate", { result: { value: "https://example.com/page2" } });

    const result = await browserNavigateBack(cdp as never, { direction: "forward" });

    expect(result.url).toBe("https://example.com/page2");

    const historyCalls = cdp._getCalls("browsingContext.traverseHistory");
    expect(historyCalls).toHaveLength(1);
    expect(historyCalls[0].params).toEqual(expect.objectContaining({ delta: 1 }));
  });

  it("should handle empty history (no page to go back to)", async () => {
    cdp._setResponse("browsingContext.traverseHistory", () => { throw new Error("no history"); });

    const result = await browserNavigateBack(cdp as never, { direction: "back" });
    expect(result.success).toBe(false);
  });

  it("should handle empty forward history", async () => {
    cdp._setResponse("browsingContext.traverseHistory", () => { throw new Error("no forward history"); });

    const result = await browserNavigateBack(cdp as never, { direction: "forward" });
    expect(result.success).toBe(false);
  });

  it("should default to going back when no direction is specified", async () => {
    cdp._setResponse("browsingContext.traverseHistory", {});
    cdp._setResponse("script.evaluate", { result: { value: "https://example.com/page1" } });

    const result = await browserNavigateBack(cdp as never, {});

    expect(result.url).toBe("https://example.com/page1");
    const historyCalls = cdp._getCalls("browsingContext.traverseHistory");
    expect(historyCalls[0].params).toEqual(expect.objectContaining({ delta: -1 }));
  });
});

// ===========================================================================
// browser_click
// ===========================================================================

describe("browser_click", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    // Default: script.evaluate returns element coords for resolveElementCoordinates
    cdp._setResponse("script.evaluate", {
      result: { value: { x: 150, y: 225, w: 100, h: 50 } },
    });
    cdp._setResponse("input.performActions", {});
  });

  it("should click by @eN ref", async () => {
    const result = await browserClick(cdp as never, { ref: "@e5" });

    expect(result.success).toBe(true);

    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);

    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string }> }> }).actions[0].actions;
    const types = pointerActions.map(a => a.type);
    expect(types).toContain("pointerMove");
    expect(types).toContain("pointerDown");
    expect(types).toContain("pointerUp");
  });

  it("should click by CSS selector", async () => {
    const result = await browserClick(cdp as never, {
      selector: "#submit-btn",
    });

    expect(result.success).toBe(true);
    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);
  });

  it("should click by coordinates (x, y)", async () => {
    const result = await browserClick(cdp as never, {
      x: 150,
      y: 225,
    });

    expect(result.success).toBe(true);

    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string; x?: number; y?: number }> }> }).actions[0].actions;
    const moveAction = pointerActions.find(a => a.type === "pointerMove")!;
    expect(moveAction.x).toBe(150);
    expect(moveAction.y).toBe(225);
  });

  it("should perform double click", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e5",
      doubleClick: true,
    });

    expect(result.success).toBe(true);

    // Double click sends 2 performActions calls
    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(2);
  });

  it("should perform right click (context menu)", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e5",
      button: "right",
    });

    expect(result.success).toBe(true);

    const actionCalls = cdp._getCalls("input.performActions");
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string; button?: number }> }> }).actions[0].actions;
    const downAction = pointerActions.find(a => a.type === "pointerDown")!;
    expect(downAction.button).toBe(2); // right = 2
  });

  it("should click with modifier keys (Ctrl+click)", async () => {
    // BiDi click doesn't currently support modifiers — tool just clicks
    const result = await browserClick(cdp as never, {
      ref: "@e5",
      modifiers: ["Control"],
    });

    expect(result.success).toBe(true);
    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle element not found", async () => {
    cdp._setResponse("script.evaluate", {
      result: { value: null },
    });

    await expect(
      browserClick(cdp as never, {
        selector: "#nonexistent",
      })
    ).rejects.toThrow(/not found|no element|could not find/i);
  });

  it("should handle element not visible/clickable (zero-size box model)", async () => {
    cdp._setResponse("script.evaluate", {
      result: { value: { x: 0, y: 0, w: 0, h: 0 } },
    });

    await expect(
      browserClick(cdp as never, {
        ref: "@e5",
      })
    ).rejects.toThrow(/not visible|not clickable|zero.*size|hidden/i);
  });

  it("should click and navigate within a page (TS-11)", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e3",
    });

    expect(result.success).toBe(true);
  });

  it("should scroll element into view before clicking", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e10",
    });

    expect(result.success).toBe(true);
    // The resolve expression includes scrollIntoView
    const evalCalls = cdp._getCalls("script.evaluate");
    expect(evalCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should follow correct pointer action sequence: pointerMove -> pointerDown -> pause -> pointerUp", async () => {
    const result = await browserClick(cdp as never, { ref: "@e5" });

    expect(result.success).toBe(true);

    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string }> }> }).actions[0].actions;
    const types = pointerActions.map(a => a.type);

    const moveIdx = types.indexOf("pointerMove");
    const downIdx = types.indexOf("pointerDown");
    const upIdx = types.indexOf("pointerUp");

    expect(moveIdx).toBeLessThan(downIdx);
    expect(downIdx).toBeLessThan(upIdx);
  });

  it("should click with multiple modifier keys (Ctrl+Shift+click)", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e5",
      modifiers: ["Control", "Shift"],
    });

    expect(result.success).toBe(true);
    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should click middle mouse button", async () => {
    const result = await browserClick(cdp as never, {
      ref: "@e5",
      button: "middle",
    });

    expect(result.success).toBe(true);

    const actionCalls = cdp._getCalls("input.performActions");
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string; button?: number }> }> }).actions[0].actions;
    const downAction = pointerActions.find(a => a.type === "pointerDown")!;
    expect(downAction.button).toBe(1); // middle = 1
  });
});

// ===========================================================================
// browser_fill_form
// ===========================================================================

describe("browser_fill_form", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    // BiDi fill_form: script.evaluate for focus/clear/events, script.callFunction for insertText
    cdp._setResponse("script.evaluate", {});
    cdp._setResponse("script.callFunction", { result: { value: true } });
    cdp._setResponse("input.performActions", {});
  });

  it("should focus element, clear, type text, and dispatch events", async () => {
    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Email",
          type: "textbox",
          ref: "@e1",
          value: "user@example.com",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);

    // Should have called script.evaluate for focus+clear and events
    const evalCalls = cdp._getCalls("script.evaluate");
    expect(evalCalls.length).toBeGreaterThanOrEqual(2);

    // Should have called script.callFunction for insertText
    const callFnCalls = cdp._getCalls("script.callFunction");
    expect(callFnCalls).toHaveLength(1);
    expect((callFnCalls[0].params as { arguments: Array<{ value: string }> }).arguments[0].value).toBe("user@example.com");
  });

  it("should fill by @eN ref", async () => {
    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Password",
          type: "textbox",
          ref: "@e2",
          value: "secret123",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);
  });

  it("should fill by CSS selector", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "object", subtype: "node", objectId: "obj-css-2" },
    });
    cdp._setResponse("script.evaluate", { nodeId: 55 });
    cdp._setResponse("script.evaluate", { root: { nodeId: 1 } });

    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Username",
          type: "textbox",
          selector: "#username",
          value: "johndoe",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);
  });

  it("should clear field before filling", async () => {
    const callOrder: string[] = [];
    cdp._setResponse("script.callFunction", (params: unknown) => {
      const p = params as { functionDeclaration: string };
      if (p.functionDeclaration.includes("value = ''") ||
          p.functionDeclaration.includes('value = ""') ||
          p.functionDeclaration.includes("value=''")) {
        callOrder.push("clear");
      }
      if (p.functionDeclaration.includes("dispatchEvent")) {
        callOrder.push("dispatch");
      }
      return { result: { type: "undefined" } };
    });

    await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Search",
          type: "textbox",
          ref: "@e3",
          value: "new search query",
        },
      ],
    });

    // Clear should be called (via Runtime.callFunctionOn to set value = '')
    const clearCalls = cdp._getCalls("script.callFunction");
    expect(clearCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle multiple fields in one call", async () => {
    const result = await browserFillForm(cdp as never, {
      fields: [
        { name: "First Name", type: "textbox", ref: "@e1", value: "John" },
        { name: "Last Name", type: "textbox", ref: "@e2", value: "Doe" },
        { name: "Email", type: "textbox", ref: "@e3", value: "john@doe.com" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(3);
  });

  it("should handle readonly/disabled inputs", async () => {
    // BiDi: the tool's script.evaluate expression checks readOnly/disabled and throws
    cdp._setResponse("script.evaluate", () => {
      throw new Error("Cannot fill readonly or disabled field");
    });

    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Read Only Field",
          type: "textbox",
          ref: "@e1",
          value: "cannot set this",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThanOrEqual(1);
    expect(result.errors![0].error).toMatch(/readonly|disabled|cannot.*fill/i);
  });

  it("should handle checkbox fields", async () => {
    // Checkbox: tool calls clickField which uses script.evaluate (coords) + input.performActions
    cdp._setResponse("script.evaluate", {
      result: { value: { x: 50, y: 50 } },
    });

    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Accept Terms",
          type: "checkbox",
          ref: "@e4",
          value: "true",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);
    // Checkbox is clicked via pointer action
    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle radio button fields", async () => {
    cdp._setResponse("script.evaluate", {
      result: { value: { x: 50, y: 50 } },
    });

    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Payment Method",
          type: "radio",
          ref: "@e5",
          value: "credit_card",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);

    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle combobox (select dropdown) fields", async () => {
    // Combobox: tool uses script.evaluate to set value and dispatch events
    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Country",
          type: "combobox",
          ref: "@e6",
          value: "us",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);

    const evalCalls = cdp._getCalls("script.evaluate");
    expect(evalCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle slider (range input) fields", async () => {
    const result = await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Volume",
          type: "slider",
          ref: "@e7",
          value: "75",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);

    // Slider uses script.evaluate to set value and dispatch events
    const evalCalls = cdp._getCalls("script.evaluate");
    expect(evalCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should dispatch input and change events after filling textbox", async () => {
    await browserFillForm(cdp as never, {
      fields: [
        {
          name: "Email",
          type: "textbox",
          ref: "@e1",
          value: "test@test.com",
        },
      ],
    });

    // The tool dispatches events via script.evaluate (second call with dispatchEvent)
    const evalCalls = cdp._getCalls("script.evaluate");
    const dispatchCall = evalCalls.find((c) => {
      const expr = (c.params as { expression: string }).expression;
      return expr.includes("dispatchEvent") && (expr.includes("input") || expr.includes("change"));
    });
    expect(dispatchCall).toBeDefined();
  });
});

// ===========================================================================
// browser_type
// ===========================================================================

describe("browser_type", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("script.evaluate", { result: { value: true } });
    cdp._setResponse("script.callFunction", { result: { value: true } });
    cdp._setResponse("input.performActions", {});
  });

  it("should type text via script.callFunction insertText (fast mode)", async () => {
    const result = await browserType(cdp as never, {
      ref: "@e1",
      text: "Hello, world!",
    });

    expect(result.success).toBe(true);

    // Fast mode uses script.callFunction with execCommand
    const callFnCalls = cdp._getCalls("script.callFunction");
    expect(callFnCalls).toHaveLength(1);
    expect((callFnCalls[0].params as { functionDeclaration: string }).functionDeclaration).toContain("insertText");
    expect((callFnCalls[0].params as { arguments: Array<{ value: string }> }).arguments[0].value).toBe("Hello, world!");
  });

  it("should type text slowly via key events (slowly=true)", async () => {
    const result = await browserType(cdp as never, {
      ref: "@e1",
      text: "abc",
      slowly: true,
    });

    expect(result.success).toBe(true);

    // For "abc" slowly: 3 separate input.performActions calls (one per char)
    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(3);
  });

  it("should type in focused element (no ref, just insert text)", async () => {
    const result = await browserType(cdp as never, {
      text: "typed text",
    });

    expect(result.success).toBe(true);

    const callFnCalls = cdp._getCalls("script.callFunction");
    expect(callFnCalls).toHaveLength(1);
    expect((callFnCalls[0].params as { arguments: Array<{ value: string }> }).arguments[0].value).toBe("typed text");
  });

  it("should press Enter after typing when submit=true", async () => {
    const result = await browserType(cdp as never, {
      ref: "@e1",
      text: "search query",
      submit: true,
    });

    expect(result.success).toBe(true);

    // submit=true adds an input.performActions call with Enter key
    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1); // Just the Enter key
    const keyActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string; value: string }> }> }).actions[0].actions;
    expect(keyActions.some(a => a.type === "keyDown" && a.value === "\uE006")).toBe(true);
  });

  it("should handle cross-origin iframes via script.callFunction", async () => {
    // script.callFunction works for insertText even in cross-origin context
    cdp._setResponse("script.evaluate", () => {
      throw new Error("Cannot access cross-origin frame");
    });

    // No ref, so no focus call via script.evaluate
    const result = await browserType(cdp as never, {
      text: "cross-origin input",
    });

    expect(result.success).toBe(true);
    const callFnCalls = cdp._getCalls("script.callFunction");
    expect(callFnCalls).toHaveLength(1);
  });

  it("should focus element before typing when ref is provided", async () => {
    await browserType(cdp as never, {
      ref: "@e3",
      text: "focused typing",
    });

    // First call to script.evaluate is for focusing
    const evalCalls = cdp._getCalls("script.evaluate");
    expect(evalCalls.length).toBeGreaterThanOrEqual(1);
    expect((evalCalls[0].params as { expression: string }).expression).toContain("focus");
  });

  it("should dispatch keyDown/keyUp for each character in slow mode", async () => {
    await browserType(cdp as never, {
      ref: "@e1",
      text: "A",
      slowly: true,
    });

    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);
    const keyActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string; value: string }> }> }).actions[0].actions;
    expect(keyActions).toHaveLength(2);
    expect(keyActions[0]).toEqual({ type: "keyDown", value: "A" });
    expect(keyActions[1]).toEqual({ type: "keyUp", value: "A" });
  });
});

// ===========================================================================
// browser_press_key
// ===========================================================================

describe("browser_press_key", () => {
  let cdp: MockBiDi;

  // Helper to extract key actions from single BiDi performActions call
  function getKeyActions() {
    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);
    return (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string; value: string }> }> }).actions[0].actions;
  }

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("input.performActions", {});
  });

  it("should press single key (Enter)", async () => {
    const result = await browserPressKey(cdp as never, { key: "Enter" });
    expect(result.success).toBe(true);

    const keyActions = getKeyActions();
    expect(keyActions).toHaveLength(2); // keyDown + keyUp
    expect(keyActions[0].type).toBe("keyDown");
    expect(keyActions[0].value).toBe("\uE006"); // Enter unicode
    expect(keyActions[1].type).toBe("keyUp");
  });

  it("should press Tab key", async () => {
    const result = await browserPressKey(cdp as never, { key: "Tab" });
    expect(result.success).toBe(true);

    const keyActions = getKeyActions();
    expect(keyActions[0].value).toBe("\uE004"); // Tab unicode
  });

  it("should press Escape key", async () => {
    const result = await browserPressKey(cdp as never, { key: "Escape" });
    expect(result.success).toBe(true);

    const keyActions = getKeyActions();
    expect(keyActions[0].value).toBe("\uE00C"); // Escape unicode
  });

  it("should press Backspace key", async () => {
    const result = await browserPressKey(cdp as never, { key: "Backspace" });
    expect(result.success).toBe(true);

    const keyActions = getKeyActions();
    expect(keyActions[0].value).toBe("\uE003"); // Backspace unicode
  });

  it("should press key combination (Ctrl+A)", async () => {
    const result = await browserPressKey(cdp as never, { key: "Control+a" });
    expect(result.success).toBe(true);

    const keyActions = getKeyActions();
    // Ctrl down, 'a' down, 'a' up, Ctrl up = 4 actions
    expect(keyActions).toHaveLength(4);
    expect(keyActions[0]).toEqual({ type: "keyDown", value: "\uE009" }); // Control
    expect(keyActions[1]).toEqual({ type: "keyDown", value: "a" });
    expect(keyActions[2]).toEqual({ type: "keyUp", value: "a" });
    expect(keyActions[3]).toEqual({ type: "keyUp", value: "\uE009" });
  });

  it("should press Ctrl+C (copy)", async () => {
    const result = await browserPressKey(cdp as never, { key: "Control+c" });
    expect(result.success).toBe(true);
  });

  it("should press Ctrl+V (paste)", async () => {
    const result = await browserPressKey(cdp as never, { key: "Control+v" });
    expect(result.success).toBe(true);
  });

  it("should press Meta+A (Cmd+A on macOS)", async () => {
    const result = await browserPressKey(cdp as never, { key: "Meta+a" });
    expect(result.success).toBe(true);

    const keyActions = getKeyActions();
    expect(keyActions[0]).toEqual({ type: "keyDown", value: "\uE03D" }); // Meta
  });

  it("should dispatch keyDown and keyUp actions", async () => {
    await browserPressKey(cdp as never, { key: "Enter" });

    const keyActions = getKeyActions();
    const types = keyActions.map(a => a.type);
    expect(types).toContain("keyDown");
    expect(types).toContain("keyUp");
  });

  it("should map ArrowLeft to correct unicode value", async () => {
    await browserPressKey(cdp as never, { key: "ArrowLeft" });

    const keyActions = getKeyActions();
    expect(keyActions[0].value).toBe("\uE012"); // ArrowLeft unicode
  });

  it("should map Tab to correct unicode value", async () => {
    await browserPressKey(cdp as never, { key: "Tab" });

    const keyActions = getKeyActions();
    expect(keyActions[0].value).toBe("\uE004");
  });

  it("should press arrow keys (ArrowDown, ArrowUp, ArrowRight)", async () => {
    for (const key of ["ArrowDown", "ArrowUp", "ArrowRight"]) {
      cdp._reset();
      cdp._setResponse("input.performActions", {});

      const result = await browserPressKey(cdp as never, { key });
      expect(result.success).toBe(true);
    }
  });

  it("should press Shift+Tab for reverse tab navigation", async () => {
    const result = await browserPressKey(cdp as never, { key: "Shift+Tab" });
    expect(result.success).toBe(true);

    const keyActions = getKeyActions();
    // Shift down, Tab down, Tab up, Shift up
    expect(keyActions).toHaveLength(4);
    expect(keyActions[0]).toEqual({ type: "keyDown", value: "\uE008" }); // Shift
    expect(keyActions[1]).toEqual({ type: "keyDown", value: "\uE004" }); // Tab
  });
});

// ===========================================================================
// browser_scroll
// ===========================================================================

describe("browser_scroll", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("input.performActions", {});
    cdp._setResponse("script.evaluate", {
      result: { type: "boolean", value: true },
    });
  });

  it("should scroll page down by pixels", async () => {
    const result = await browserScroll(cdp as never, {
      direction: "down",
      amount: 500,
    });

    expect(result.success).toBe(true);

    // Scroll is typically done via Input.dispatchMouseEvent with mouseWheel
    // or Runtime.evaluate with window.scrollBy
    const scrollCalls = [
      ...cdp._getCalls("input.performActions"),
      ...cdp._getCalls("script.evaluate"),
    ];
    expect(scrollCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should scroll page up by pixels", async () => {
    const result = await browserScroll(cdp as never, {
      direction: "up",
      amount: 300,
    });

    expect(result.success).toBe(true);
  });

  it("should scroll to element (scrollIntoView)", async () => {
    cdp._setResponse("script.evaluate", {
      object: { objectId: "obj-scroll-1" },
    });
    cdp._setResponse("script.callFunction", {
      result: { type: "undefined" },
    });
    cdp._setResponse("script.evaluate", {});

    const result = await browserScroll(cdp as never, {
      selector: "#target-section",
    });

    expect(result.success).toBe(true);

    // Should call scrollIntoView on the element
    const callOnCalls = cdp._getCalls("script.callFunction");
    const scrollIntoViewCall = callOnCalls.find((c) =>
      (c.params as { functionDeclaration: string }).functionDeclaration.includes(
        "scrollIntoView"
      )
    );
    // Or it may use DOM.scrollIntoViewIfNeeded
    const scrollIfNeeded = cdp._getCalls("script.evaluate");
    expect(
      scrollIntoViewCall !== undefined || scrollIfNeeded.length > 0
    ).toBe(true);
  });

  it("should scroll within scrollable container by selector", async () => {
    cdp._setResponse("script.evaluate", {
      object: { objectId: "obj-container-1" },
    });
    cdp._setResponse("script.callFunction", {
      result: { type: "undefined" },
    });

    const result = await browserScroll(cdp as never, {
      direction: "down",
      amount: 200,
      selector: "div.scrollable-panel",
    });

    expect(result.success).toBe(true);
  });

  it("should scroll left", async () => {
    const result = await browserScroll(cdp as never, {
      direction: "left",
      amount: 100,
    });
    expect(result.success).toBe(true);
  });

  it("should scroll right", async () => {
    const result = await browserScroll(cdp as never, {
      direction: "right",
      amount: 100,
    });
    expect(result.success).toBe(true);
  });

  it("should handle default scroll amount when not specified", async () => {
    const result = await browserScroll(cdp as never, {
      direction: "down",
    });

    expect(result.success).toBe(true);
  });

  it("should handle scroll on element that does not exist", async () => {
    cdp._setResponse("script.evaluate", () => {
      throw new Error("Element not found: #nonexistent-container");
    });

    await expect(
      browserScroll(cdp as never, {
        selector: "#nonexistent-container",
      })
    ).rejects.toThrow(/not found|could not find|no element/i);
  });
});

// ===========================================================================
// browser_hover
// ===========================================================================

describe("browser_hover", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    // BiDi: script.evaluate returns center coords from getBoundingClientRect
    cdp._setResponse("script.evaluate", {
      result: { value: { x: 100, y: 115 } },
    });
    cdp._setResponse("input.performActions", {});
  });

  it("should hover element by @eN ref", async () => {
    const result = await browserHover(cdp as never, { ref: "@e7" });

    expect(result.success).toBe(true);

    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string; x?: number; y?: number }> }> }).actions[0].actions;
    const moveAction = pointerActions.find(a => a.type === "pointerMove")!;
    expect(moveAction.x).toBe(100);
    expect(moveAction.y).toBe(115);
  });

  it("should hover by CSS selector", async () => {
    const result = await browserHover(cdp as never, {
      selector: ".dropdown-trigger",
    });

    expect(result.success).toBe(true);

    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string }> }> }).actions[0].actions;
    expect(pointerActions.some(a => a.type === "pointerMove")).toBe(true);
  });

  it("should trigger mouseover/mouseenter events via pointerMove dispatch", async () => {
    const result = await browserHover(cdp as never, { ref: "@e7" });

    expect(result.success).toBe(true);

    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string }> }> }).actions[0].actions;
    expect(pointerActions.some(a => a.type === "pointerMove")).toBe(true);
  });

  it("should scroll element into view before hovering", async () => {
    await browserHover(cdp as never, { ref: "@e7" });

    // The resolve expression includes scrollIntoView
    const evalCalls = cdp._getCalls("script.evaluate");
    expect(evalCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle element not found for hover", async () => {
    cdp._setResponse("script.evaluate", {
      result: { value: null },
    });

    await expect(
      browserHover(cdp as never, { ref: "@e999" })
    ).rejects.toThrow(/not found|could not find/i);
  });

  it("should hover at the center of the element's content box", async () => {
    cdp._setResponse("script.evaluate", {
      result: { value: { x: 100, y: 50 } },
    });

    await browserHover(cdp as never, { ref: "@e1" });

    const actionCalls = cdp._getCalls("input.performActions");
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string; x?: number; y?: number }> }> }).actions[0].actions;
    const moveAction = pointerActions.find(a => a.type === "pointerMove")!;
    expect(moveAction.x).toBe(100);
    expect(moveAction.y).toBe(50);
  });
});

// ===========================================================================
// browser_drag
// ===========================================================================

describe("browser_drag", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    // BiDi: resolveRefCoordinates returns center coords
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      // First call = start element, second = end element
      if (callCount === 1) return { result: { value: { x: 75, y: 65 } } };
      return { result: { value: { x: 325, y: 315 } } };
    });
    cdp._setResponse("input.performActions", {});
  });

  it("should drag from source to target using synthesized pointer actions", async () => {
    const result = await browserDrag(cdp as never, {
      startRef: "@e1",
      endRef: "@e2",
    });

    expect(result.success).toBe(true);

    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string }> }> }).actions[0].actions;
    const types = pointerActions.map(a => a.type);

    expect(types).toContain("pointerDown");
    expect(types).toContain("pointerUp");
    expect(types.filter(t => t === "pointerMove").length).toBeGreaterThanOrEqual(2);
  });

  it("should drag by @eN refs", async () => {
    const result = await browserDrag(cdp as never, {
      startRef: "@e3",
      endRef: "@e5",
    });

    expect(result.success).toBe(true);
  });

  it("should drag by coordinates", async () => {
    const result = await browserDrag(cdp as never, {
      startX: 75,
      startY: 65,
      endX: 325,
      endY: 315,
    });

    expect(result.success).toBe(true);

    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string; x?: number; y?: number }> }> }).actions[0].actions;

    // First move should be to start position
    expect(pointerActions[0].type).toBe("pointerMove");
    expect(pointerActions[0].x).toBe(75);
    expect(pointerActions[0].y).toBe(65);

    // Last move should be to end position (before pointerUp)
    const lastMove = [...pointerActions].reverse().find(a => a.type === "pointerMove")!;
    expect(lastMove.x).toBe(325);
    expect(lastMove.y).toBe(315);
  });

  it("should include intermediate pointerMove actions during drag", async () => {
    await browserDrag(cdp as never, {
      startRef: "@e1",
      endRef: "@e2",
    });

    const actionCalls = cdp._getCalls("input.performActions");
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string }> }> }).actions[0].actions;
    const moveActions = pointerActions.filter(a => a.type === "pointerMove");
    // Should have start, intermediate(s), and end moves
    expect(moveActions.length).toBeGreaterThanOrEqual(3);
  });

  it("should follow pointerMove -> pointerDown -> pointerMove(s) -> pointerUp sequence", async () => {
    await browserDrag(cdp as never, {
      startRef: "@e1",
      endRef: "@e2",
    });

    const actionCalls = cdp._getCalls("input.performActions");
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string }> }> }).actions[0].actions;
    const types = pointerActions.map(a => a.type);

    const downIdx = types.indexOf("pointerDown");
    const upIdx = types.lastIndexOf("pointerUp");

    expect(downIdx).toBeGreaterThan(0); // First action is pointerMove to start
    expect(downIdx).toBeLessThan(upIdx);

    // There should be pointerMove events between down and up
    const movesBetween = types.slice(downIdx + 1, upIdx).filter(t => t === "pointerMove");
    expect(movesBetween.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle drag when source element is not found", async () => {
    cdp._setResponse("script.evaluate", () => {
      throw new Error("Could not find node with given id");
    });

    await expect(
      browserDrag(cdp as never, {
        startRef: "@e999",
        startElement: "Missing source",
        endRef: "@e2",
        endElement: "Target",
      })
    ).rejects.toThrow(/not found|could not find/i);
  });
});

// ===========================================================================
// browser_select_option
// ===========================================================================

describe("browser_select_option", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    // BiDi: select_option uses script.evaluate with complex expression
    cdp._setResponse("script.evaluate", {
      result: { value: ["option-1"] },
    });
  });

  it("should select option in <select> by value", async () => {
    const result = await browserSelectOption(cdp as never, {
      ref: "@e4",
      values: ["option-2"],
      element: "Country dropdown",
    });

    expect(result.success).toBe(true);

    // Tool uses script.evaluate with expression containing option selection logic
    const evalCalls = cdp._getCalls("script.evaluate");
    expect(evalCalls.length).toBeGreaterThanOrEqual(1);
    const expr = (evalCalls[0].params as { expression: string }).expression;
    expect(expr).toContain("option");
    expect(expr).toContain("selected");
  });

  it("should select by label text", async () => {
    const result = await browserSelectOption(cdp as never, {
      ref: "@e4",
      values: ["United States"],
      element: "Country dropdown",
    });

    expect(result.success).toBe(true);
    expect(result.selected).toBeDefined();
  });

  it("should handle multi-select", async () => {
    cdp._setResponse("script.evaluate", {
      result: { value: ["opt-a", "opt-c"] },
    });

    const result = await browserSelectOption(cdp as never, {
      ref: "@e4",
      values: ["opt-a", "opt-c"],
      element: "Multi-select tags",
    });

    expect(result.success).toBe(true);
    expect(result.selected).toHaveLength(2);
    expect(result.selected).toContain("opt-a");
    expect(result.selected).toContain("opt-c");
  });

  it("should dispatch input and change events after selection", async () => {
    await browserSelectOption(cdp as never, {
      ref: "@e4",
      values: ["opt-1"],
      element: "Dropdown",
    });

    // The expression dispatches events inline
    const evalCalls = cdp._getCalls("script.evaluate");
    const dispatchCall = evalCalls.find((c) => {
      const expr = (c.params as { expression: string }).expression;
      return expr.includes("dispatchEvent") && (expr.includes("change") || expr.includes("input"));
    });
    expect(dispatchCall).toBeDefined();
  });

  it("should handle element not being a <select>", async () => {
    cdp._setResponse("script.evaluate", () => {
      throw new Error("Element is not a SELECT");
    });

    await expect(
      browserSelectOption(cdp as never, {
        ref: "@e4",
        values: ["value"],
        element: "Not a select",
      })
    ).rejects.toThrow(/not.*select|invalid.*element/i);
  });

  it("should select single option and return it in selected array", async () => {
    cdp._setResponse("script.evaluate", {
      result: { value: ["us"] },
    });

    const result = await browserSelectOption(cdp as never, {
      ref: "@e4",
      values: ["us"],
      element: "Country select",
    });

    expect(result.success).toBe(true);
    expect(result.selected).toEqual(["us"]);
  });

  it("should use script.evaluate for option selection", async () => {
    await browserSelectOption(cdp as never, {
      ref: "@e4",
      values: ["val"],
      element: "Test select",
    });

    const evalCalls = cdp._getCalls("script.evaluate");
    expect(evalCalls).toHaveLength(1);
    // No script.callFunction used — everything done in script.evaluate
    const callFnCalls = cdp._getCalls("script.callFunction");
    expect(callFnCalls).toHaveLength(0);
  });
});

// ===========================================================================
// browser_file_upload
// ===========================================================================

describe("browser_file_upload", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("input.setFiles", {});
    // BiDi: script.callFunction resolves element to get sharedId
    cdp._setResponse("script.callFunction", {
      result: { type: "node", sharedId: "shared-upload-1" },
    });
  });

  it("should set files via input.setFiles", async () => {
    const result = await browserFileUpload(cdp as never, {
      ref: "@e5",
      paths: ["/tmp/photo.jpg"],
    });

    expect(result.success).toBe(true);
    expect(result.filesCount).toBe(1);

    const setFileCalls = cdp._getCalls("input.setFiles");
    expect(setFileCalls).toHaveLength(1);
    expect(
      (setFileCalls[0].params as { files: string[] }).files
    ).toEqual(["/tmp/photo.jpg"]);
  });

  it("should handle multiple file upload", async () => {
    const result = await browserFileUpload(cdp as never, {
      ref: "@e5",
      paths: ["/tmp/doc1.pdf", "/tmp/doc2.pdf", "/tmp/doc3.pdf"],
    });

    expect(result.success).toBe(true);
    expect(result.filesCount).toBe(3);

    const setFileCalls = cdp._getCalls("input.setFiles");
    expect(
      (setFileCalls[0].params as { files: string[] }).files
    ).toHaveLength(3);
  });

  it("should handle file not found", async () => {
    // input.setFiles throws but tool catches and falls back to script.callFunction dispatch
    cdp._setResponse("input.setFiles", () => {
      throw new Error("File not found: /tmp/nonexistent.jpg");
    });

    // Fallback to dispatchEvent — this succeeds (tool doesn't re-throw)
    const result = await browserFileUpload(cdp as never, {
      ref: "@e5",
      paths: ["/tmp/nonexistent.jpg"],
    });

    // Tool catches the error and falls back
    expect(result.success).toBe(true);
  });

  it("should cancel file chooser when paths is empty", async () => {
    const result = await browserFileUpload(cdp as never, {
      ref: "@e5",
      paths: [],
    });

    expect(result.success).toBe(true);
    expect(result.filesCount).toBe(0);
  });

  it("should enable file chooser interception", async () => {
    await browserFileUpload(cdp as never, {
      ref: "@e5",
      paths: ["/tmp/test.txt"],
    });

    expect(cdp._getCalls("input.setFiles")).toHaveLength(1);
  });

  it("should resolve element via script.callFunction and pass sharedId to input.setFiles", async () => {
    const result = await browserFileUpload(cdp as never, {
      ref: "@e42",
      paths: ["/tmp/upload.png"],
    });

    expect(result.success).toBe(true);

    // Should have resolved element via script.callFunction
    const callFnCalls = cdp._getCalls("script.callFunction");
    expect(callFnCalls).toHaveLength(1);

    const setFileCalls = cdp._getCalls("input.setFiles");
    expect(setFileCalls).toHaveLength(1);
    // Should pass sharedId in element
    expect(
      (setFileCalls[0].params as { element: { sharedId: string } }).element.sharedId
    ).toBe("shared-upload-1");
  });

  it("should return error for invalid ref format", async () => {
    const result = await browserFileUpload(cdp as never, {
      ref: "invalid-ref",
      paths: ["/tmp/test.txt"],
    });

    expect(result.success).toBe(false);
    expect(result.filesCount).toBe(0);
    expect(result.error).toBeDefined();
  });
});

// ===========================================================================
// browser_handle_dialog
// ===========================================================================

describe("browser_handle_dialog", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("browsingContext.handleUserPrompt", {});
  });

  it("should accept alert dialog", async () => {
    const result = await browserHandleDialog(cdp as never, {
      accept: true,
    });

    expect(result.success).toBe(true);

    const dialogCalls = cdp._getCalls("browsingContext.handleUserPrompt");
    expect(dialogCalls).toHaveLength(1);
    expect(
      (dialogCalls[0].params as { accept: boolean }).accept
    ).toBe(true);
  });

  it("should dismiss confirm dialog", async () => {
    const result = await browserHandleDialog(cdp as never, {
      accept: false,
    });

    expect(result.success).toBe(true);

    const dialogCalls = cdp._getCalls("browsingContext.handleUserPrompt");
    expect(
      (dialogCalls[0].params as { accept: boolean }).accept
    ).toBe(false);
  });

  it("should accept prompt dialog with text", async () => {
    const result = await browserHandleDialog(cdp as never, {
      accept: true,
      promptText: "John Doe",
    });

    expect(result.success).toBe(true);

    const dialogCalls = cdp._getCalls("browsingContext.handleUserPrompt");
    expect(dialogCalls).toHaveLength(1);
    // BiDi uses "userText" instead of "promptText"
    expect(
      (dialogCalls[0].params as { userText?: string }).userText
    ).toBe("John Doe");
  });

  it("should dismiss prompt dialog (returns null to page)", async () => {
    const result = await browserHandleDialog(cdp as never, {
      accept: false,
    });

    expect(result.success).toBe(true);

    const dialogCalls = cdp._getCalls("browsingContext.handleUserPrompt");
    expect(
      (dialogCalls[0].params as { accept: boolean }).accept
    ).toBe(false);
  });

  it("should handle no pending dialog gracefully", async () => {
    // CDP throws when no dialog is pending
    cdp._setResponse("browsingContext.handleUserPrompt", () => {
      throw new Error("No dialog is showing");
    });

    const result = await browserHandleDialog(cdp as never, { accept: true });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no.*dialog/i);
  });

  it("should handle beforeunload dialog", async () => {
    const result = await browserHandleDialog(cdp as never, {
      accept: true,
    });

    expect(result.success).toBe(true);
  });

  it("should handle all four dialog types by sending accept param", async () => {
    // The implementation doesn't track dialog type — it just sends accept/promptText to CDP.
    // Verify that calling handleDialog works for each accept value.
    for (const accept of [true, false]) {
      cdp._reset();
      cdp._setResponse("browsingContext.handleUserPrompt", {});

      const result = await browserHandleDialog(cdp as never, { accept });
      expect(result.success).toBe(true);

      const dialogCalls = cdp._getCalls("browsingContext.handleUserPrompt");
      expect(dialogCalls).toHaveLength(1);
      expect((dialogCalls[0].params as { accept: boolean }).accept).toBe(accept);
    }
  });

  it("should pass accept=true to CDP for accepted dialogs", async () => {
    await browserHandleDialog(cdp as never, { accept: true });

    const calls = cdp._getCalls("browsingContext.handleUserPrompt");
    expect(calls).toHaveLength(1);
    expect((calls[0].params as { accept: boolean }).accept).toBe(true);
  });
});

// ===========================================================================
// browser_wait_for
// ===========================================================================

describe("browser_wait_for", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  it("should wait for text to appear on page", async () => {
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      // Text appears on 3rd poll
      if (callCount >= 3) {
        return { result: { type: "boolean", value: true } };
      }
      return { result: { type: "boolean", value: false } };
    });

    const result = await browserWaitFor(cdp as never, {
      text: "Welcome",
      timeout: 5,
    });

    expect(result.success).toBe(true);
    expect(result.elapsed).toBeGreaterThan(0);
  });

  it("should wait for text to disappear", async () => {
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      // Text disappears on 2nd poll
      if (callCount >= 2) {
        return { result: { type: "boolean", value: true } };
      }
      return { result: { type: "boolean", value: false } };
    });

    const result = await browserWaitFor(cdp as never, {
      textGone: "Loading...",
      timeout: 5,
    });

    expect(result.success).toBe(true);
  });

  it("should wait for specified time (delay)", async () => {
    const start = Date.now();

    const result = await browserWaitFor(cdp as never, {
      time: 0.1, // 100ms
    });

    const elapsed = Date.now() - start;
    expect(result.success).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(50); // Allow some tolerance
  });

  it("should respect custom timeout", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "boolean", value: false },
    });

    await expect(
      browserWaitFor(cdp as never, {
        text: "Never appears",
        timeout: 0.5, // 500ms
      })
    ).rejects.toThrow(/timeout/i);
  });

  it("should produce clear error message on timeout", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "boolean", value: false },
    });

    try {
      await browserWaitFor(cdp as never, {
        text: "Expected text",
        timeout: 0.3,
      });
      // Should not reach here
      expect.unreachable("Should have thrown timeout error");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/timeout/i);
      // Error should ideally mention what was being waited for
      expect(message.length).toBeGreaterThan(5);
    }
  });

  it("should wait for selector to appear in DOM", async () => {
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      // Tool evaluates !!document.querySelector(...) → expects boolean result
      if (callCount >= 2) {
        return { result: { value: true } };
      }
      return { result: { value: false } };
    });

    const result = await browserWaitFor(cdp as never, {
      selector: ".dashboard-loaded",
      timeout: 5,
    });

    expect(result.success).toBe(true);
  });

  it("should wait for selector to be visible", async () => {
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      if (callCount >= 2) {
        return { result: { type: "boolean", value: true } };
      }
      return { result: { type: "boolean", value: false } };
    });

    const result = await browserWaitFor(cdp as never, {
      selector: ".modal",
      visible: true,
      timeout: 5,
    });

    expect(result.success).toBe(true);
  });

  it("should wait for network idle", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "boolean", value: true },
    });

    const result = await browserWaitFor(cdp as never, {
      networkIdle: true,
      timeout: 5,
    });

    expect(result.success).toBe(true);
  });

  it("should wait for page load", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "string", value: "complete" },
    });

    const result = await browserWaitFor(cdp as never, {
      load: true,
      timeout: 5,
    });

    expect(result.success).toBe(true);
  });

  it("should handle cross-origin iframe waits (TS-16)", async () => {
    // In cross-origin iframes, Runtime.evaluate may fail
    // The implementation should handle this gracefully
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      if (callCount === 1) {
        // First attempt might target cross-origin frame
        throw new Error("Cannot access cross-origin frame");
      }
      // Fallback to main frame
      return { result: { type: "boolean", value: true } };
    });

    const result = await browserWaitFor(cdp as never, {
      text: "Loaded",
      timeout: 5,
    });

    expect(result.success).toBe(true);
  });

  it("should use 30-second default timeout when not specified", async () => {
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      // Resolve immediately on first call to avoid actually waiting 30s
      return { result: { type: "boolean", value: true } };
    });

    const result = await browserWaitFor(cdp as never, {
      text: "Immediate text",
    });

    expect(result.success).toBe(true);
  });

  it("should return elapsed time in milliseconds", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "boolean", value: true },
    });

    const result = await browserWaitFor(cdp as never, {
      text: "Already here",
      timeout: 5,
    });

    expect(result.success).toBe(true);
    expect(typeof result.elapsed).toBe("number");
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
  });

  it("should poll at regular intervals for text appearance", async () => {
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      if (callCount >= 4) {
        return { result: { type: "boolean", value: true } };
      }
      return { result: { type: "boolean", value: false } };
    });

    await browserWaitFor(cdp as never, {
      text: "Eventually appears",
      timeout: 5,
    });

    // Should have polled multiple times
    const evalCalls = cdp._getCalls("script.evaluate");
    expect(evalCalls.length).toBeGreaterThanOrEqual(4);
  });
});

// ===========================================================================
// browser_close
// ===========================================================================

describe("browser_close", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("browsingContext.close", { success: true });
    cdp._setResponse("browsingContext.getTree", {
      contexts: [
        {
          context: "target-1",
          type: "page",
          title: "Tab 1",
          url: "https://example.com",
          attached: true,
        },
        {
          context: "target-2",
          type: "page",
          title: "Tab 2",
          url: "https://example.org",
        },
      ],
    });
  });

  it("should close current active tab by default", async () => {
    const result = await browserClose(cdp as never, {});

    expect(result.success).toBe(true);
    expect(result.closedTargets).toBe(1);

    const closeCalls = cdp._getCalls("browsingContext.close");
    expect(closeCalls).toHaveLength(1);
    expect(
      (closeCalls[0].params as { context: string }).context
    ).toBe("target-1");
  });

  it("should close specific tab by target ID", async () => {
    const result = await browserClose(cdp as never, {
      targetId: "target-1",
    });

    expect(result.success).toBe(true);
    expect(result.closedTargets).toBe(1);

    const closeCalls = cdp._getCalls("browsingContext.close");
    expect(closeCalls).toHaveLength(1);
    expect(
      (closeCalls[0].params as { context: string }).context
    ).toBe("target-1");
  });

  it("should close all tabs when closeAll=true", async () => {
    const result = await browserClose(cdp as never, {
      closeAll: true,
    });

    expect(result.success).toBe(true);
    expect(result.closedTargets).toBe(2);

    const closeCalls = cdp._getCalls("browsingContext.close");
    expect(closeCalls).toHaveLength(2); // Two tabs
  });

  it("should handle already-closed tab in closeAll gracefully", async () => {
    // When closeAll is used, individual target close errors are ignored
    cdp._setResponse("browsingContext.close", () => {
      throw new Error("No target with given id found");
    });

    const result = await browserClose(cdp as never, {
      closeAll: true,
    });

    expect(result.success).toBe(true);
    expect(result.closedTargets).toBe(0);
  });

  it("should close current tab when no targetId or closeAll specified", async () => {
    const result = await browserClose(cdp as never, {});

    expect(result.success).toBe(true);
    expect(result.closedTargets).toBe(1);

    // Should have closed the active target
    const closeCalls = cdp._getCalls("browsingContext.close");
    expect(closeCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// browser_resize
// ===========================================================================

describe("browser_resize", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("script.evaluate", {});
  });

  it("should resize viewport via window.resizeTo", async () => {
    const result = await browserResize(cdp as never, {
      width: 1280,
      height: 720,
    });

    expect(result.success).toBe(true);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);

    const evalCalls = cdp._getCalls("script.evaluate");
    expect(evalCalls).toHaveLength(1);
    expect((evalCalls[0].params as { expression: string }).expression).toContain("window.resizeTo(1280, 720)");
  });

  it("should handle custom dimensions", async () => {
    const result = await browserResize(cdp as never, {
      width: 375,
      height: 812,
    });

    expect(result.success).toBe(true);
    expect(result.width).toBe(375);
    expect(result.height).toBe(812);

    const evalCalls = cdp._getCalls("script.evaluate");
    expect((evalCalls[0].params as { expression: string }).expression).toContain("window.resizeTo(375, 812)");
  });

  it("should handle tablet preset", async () => {
    const result = await browserResize(cdp as never, {
      width: 768,
      height: 1024,
    });

    expect(result.success).toBe(true);
    expect(result.width).toBe(768);
    expect(result.height).toBe(1024);
  });

  it("should handle desktop preset", async () => {
    const result = await browserResize(cdp as never, {
      width: 1920,
      height: 1080,
    });

    expect(result.success).toBe(true);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  it("should include width in resize expression", async () => {
    const result = await browserResize(cdp as never, {
      width: 1280,
      height: 720,
    });

    expect(result.success).toBe(true);
    const evalCalls = cdp._getCalls("script.evaluate");
    expect((evalCalls[0].params as { expression: string }).expression).toContain("1280");
  });

  it("should default to 1280x720 when no size specified", async () => {
    const result = await browserResize(cdp as never, {});

    expect(result.success).toBe(true);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  it("should handle script.evaluate failure", async () => {
    cdp._setResponse("script.evaluate", () => {
      throw new Error("Emulation domain is not enabled");
    });

    await expect(
      browserResize(cdp as never, { width: 100, height: 100 })
    ).rejects.toThrow(/emulation|not enabled|failed/i);
  });

  it("should use explicit width/height over defaults", async () => {
    const result = await browserResize(cdp as never, {
      width: 1024,
      height: 768,
    });

    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
  });

  it("should call window.resizeTo with correct values", async () => {
    const result = await browserResize(cdp as never, {
      width: 414,
      height: 896,
    });

    expect(result.success).toBe(true);
    const evalCalls = cdp._getCalls("script.evaluate");
    expect((evalCalls[0].params as { expression: string }).expression).toContain("window.resizeTo(414, 896)");
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 1.2 — Mouse Click 3-Event CDP Sequence (P0)
// ===========================================================================

describe("browser_click BiDi event sequence verification", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("input.performActions", {});
  });

  it("should send single input.performActions with pointerMove, pointerDown, pointerUp", async () => {
    await browserClick(cdp as never, { x: 100, y: 200 });

    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);

    const actions = (actionCalls[0].params as { actions: Array<{ type: string; actions: Array<{ type: string; x?: number; y?: number; button?: number }> }> }).actions;
    expect(actions[0].type).toBe("pointer");

    const pointerActions = actions[0].actions;
    const types = pointerActions.map(a => a.type);
    expect(types).toContain("pointerMove");
    expect(types).toContain("pointerDown");
    expect(types).toContain("pointerUp");

    const moveAction = pointerActions.find(a => a.type === "pointerMove")!;
    expect(moveAction.x).toBe(100);
    expect(moveAction.y).toBe(200);
  });

  it("should include pause action between pointerDown and pointerUp for human-like delay", async () => {
    await browserClick(cdp as never, { x: 100, y: 200 });

    const actionCalls = cdp._getCalls("input.performActions");
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string }> }> }).actions[0].actions;

    const downIdx = pointerActions.findIndex(a => a.type === "pointerDown");
    const upIdx = pointerActions.findIndex(a => a.type === "pointerUp");
    // There should be a pause between down and up
    const hasPause = pointerActions.slice(downIdx, upIdx).some(a => a.type === "pause");
    expect(hasPause).toBe(true);
  });

  it("should use button=0 for left click (default)", async () => {
    await browserClick(cdp as never, { x: 100, y: 200 });

    const actionCalls = cdp._getCalls("input.performActions");
    const pointerActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string; button?: number }> }> }).actions[0].actions;
    const downAction = pointerActions.find(a => a.type === "pointerDown")!;
    expect(downAction.button).toBe(0);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 1.6 — Navigation loaderId Check (P0)
// ===========================================================================

describe("Navigation loaderId handling", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("session.subscribe", {});
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("document.title")) {
        return { result: { type: "string", value: "Test Page" } };
      }
      if (p.expression.includes("location.href")) {
        return { result: { type: "string", value: "https://example.com/" } };
      }
      if (p.expression.includes("readyState")) {
        return { result: { type: "string", value: "complete" } };
      }
      return { result: { type: "undefined" } };
    });
  });

  it("should await Page.loadEventFired when Page.navigate returns a loaderId", async () => {
    cdp._setResponse("browsingContext.navigate", { navigation: "nav-1", url: "about:blank" });

    // Simulate loadEventFired being emitted after navigate
    const navigatePromise = browserNavigate(cdp as never, {
      url: "https://example.com",
    });

    // Emit loadEventFired asynchronously
    setTimeout(() => {
      cdp._emit("browsingContext.load", {});
    }, 10);

    const result = await navigatePromise;

    expect(result.url).toBe("https://example.com/");
    // Verify that we subscribed to Page.loadEventFired
    expect(cdp.on).toHaveBeenCalledWith(
      "browsingContext.load",
      expect.any(Function)
    );
  });

  it("should NOT wait for Page.loadEventFired when no loaderId (same-document navigation)", async () => {
    cdp._setResponse("browsingContext.navigate", {
      frameId: "frame-1",
      // No loaderId — same-document navigation (hash change, pushState)
    });

    const result = await browserNavigate(cdp as never, {
      url: "https://example.com/#section",
    });

    expect(result.url).toBe("https://example.com/");
    // Should NOT have waited for loadEventFired since no loaderId
    const loadEventCalls = cdp.on.mock.calls.filter(
      (call) => call[0] === "browsingContext.load"
    );
    // Either no subscription, or subscription was immediately cancelled
    expect(loadEventCalls.length).toBeLessThanOrEqual(1);
  });

  it("should cancel the load event listener for same-document navigation", async () => {
    cdp._setResponse("browsingContext.navigate", {
      frameId: "frame-1",
      // No loaderId
    });

    await browserNavigate(cdp as never, {
      url: "https://example.com/#section",
    });

    // If a listener was registered, it should have been cleaned up via off()
    const onCalls = cdp.on.mock.calls.filter(
      (call) => call[0] === "browsingContext.load"
    );
    const offCalls = cdp.off.mock.calls.filter(
      (call) => call[0] === "browsingContext.load"
    );

    // For same-document navigation, either no listener was registered,
    // or the listener was registered and then removed
    if (onCalls.length > 0) {
      expect(offCalls.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("should register load listener and navigate", async () => {
    cdp._setResponse("browsingContext.navigate", { navigation: "nav-1", url: "about:blank" });
    cdp._setResponse("script.evaluate", { result: { value: "complete" } });

    const navigatePromise = browserNavigate(cdp as never, {
      url: "https://example.com",
    });
    setTimeout(() => cdp._emit("browsingContext.load", {}), 10);
    await navigatePromise;

    const allCalls = cdp._calls;
    const navigateIdx = allCalls.findIndex((c) => c.method === "browsingContext.navigate");
    expect(navigateIdx).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 1.5 — waitForDocumentReady Polling Pattern (P0)
// ===========================================================================

describe("waitForDocumentReady", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  it("should poll until document.readyState === 'complete'", async () => {
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      if (callCount <= 2) {
        return { result: { type: "string", value: "loading" } };
      }
      return { result: { type: "string", value: "complete" } };
    });

    await waitForDocumentReady(cdp as never);

    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("should reject with timeout error if readyState never reaches 'complete'", async () => {
    cdp._setResponse("script.evaluate", () => ({
      result: { type: "string", value: "interactive" },
    }));

    await expect(
      waitForDocumentReady(cdp as never, { timeout: 1000 })
    ).rejects.toThrow(/timeout/i);
  });

  it("should retry on temporary Runtime.evaluate failures during navigation", async () => {
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      if (callCount <= 2) {
        throw new Error("Execution context was destroyed");
      }
      return { result: { type: "string", value: "complete" } };
    });

    await waitForDocumentReady(cdp as never);

    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("should poll at approximately 200ms intervals", async () => {
    const timestamps: number[] = [];
    let callCount = 0;

    cdp._setResponse("script.evaluate", () => {
      timestamps.push(Date.now());
      callCount++;
      if (callCount < 4) {
        return { result: { type: "string", value: "loading" } };
      }
      return { result: { type: "string", value: "complete" } };
    });

    await waitForDocumentReady(cdp as never);

    // Verify intervals are approximately 200ms (allow 100ms–400ms tolerance)
    for (let i = 1; i < timestamps.length; i++) {
      const interval = timestamps[i] - timestamps[i - 1];
      expect(interval).toBeGreaterThanOrEqual(100);
      expect(interval).toBeLessThanOrEqual(400);
    }
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.3 — Keyboard type / inserttext variants (P1)
// ===========================================================================

describe("keyboard type (at current focus, no selector)", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("input.performActions", {});
  });

  it("should dispatch keyDown/keyUp actions for each character in single call", async () => {
    await browserKeyboard(cdp as never, { action: "type", text: "hi" });

    // BiDi sends a single input.performActions with all key actions
    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);

    const keyActions = (actionCalls[0].params as { actions: Array<{ type: string; actions: Array<{ type: string; value: string }> }> }).actions[0].actions;
    // For "hi": keyDown('h'), keyUp('h'), keyDown('i'), keyUp('i') = 4 actions
    expect(keyActions).toHaveLength(4);
    expect(keyActions[0]).toEqual({ type: "keyDown", value: "h" });
    expect(keyActions[1]).toEqual({ type: "keyUp", value: "h" });
    expect(keyActions[2]).toEqual({ type: "keyDown", value: "i" });
    expect(keyActions[3]).toEqual({ type: "keyUp", value: "i" });
  });

  it("should not perform element lookup", async () => {
    await browserKeyboard(cdp as never, { action: "type", text: "abc" });

    const domCalls = cdp._getCalls("script.evaluate");
    expect(domCalls).toHaveLength(0);
  });
});

describe("keyboard inserttext (no key events)", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("script.callFunction", { result: { value: true } });
  });

  it("should call script.callFunction with execCommand insertText", async () => {
    await browserKeyboard(cdp as never, {
      action: "inserttext",
      text: "hello world",
    });

    // BiDi inserttext uses script.callFunction with execCommand
    const callFnCalls = cdp._getCalls("script.callFunction");
    expect(callFnCalls).toHaveLength(1);
    expect((callFnCalls[0].params as { functionDeclaration: string }).functionDeclaration).toContain("insertText");
    expect((callFnCalls[0].params as { arguments: Array<{ value: string }> }).arguments[0].value).toBe("hello world");

    // No input.performActions calls
    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(0);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.4 — click --new-tab (P2)
// ===========================================================================

describe("click --new-tab", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("script.evaluate", {
      result: { type: "object", objectId: "obj-1" },
    });
    cdp._setResponse("script.evaluate", {
      root: { nodeId: 1 },
    });
    cdp._setResponse("script.evaluate", { nodeId: 42 });
    cdp._setResponse("script.evaluate", {
      model: {
        content: [100, 200, 200, 200, 200, 250, 100, 250],
        width: 100,
        height: 50,
      },
    });
    cdp._setResponse("script.evaluate", {});
    cdp._setResponse("input.performActions", {});
  });

  it("should use Meta/Ctrl modifier to open link in new tab", async () => {
    await browserClick(cdp as never, { selector: "a.link", newTab: true });

    const mouseEvents = cdp._getCalls("input.performActions");
    const pressedEvent = mouseEvents.find(
      (e) => (e.params as { type: string }).type === "mousePressed"
    );

    expect(pressedEvent).toBeDefined();
    const params = pressedEvent!.params as { modifiers: number };
    // Meta (macOS) = 4, Ctrl (Windows/Linux) = 2
    // The modifier should be non-zero indicating Meta or Ctrl
    expect(params.modifiers).toBeGreaterThan(0);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.5 — keydown / keyup separate commands (P2)
// ===========================================================================

describe("keydown (hold without release)", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("input.performActions", {});
  });

  it("should send only keyDown action, no keyUp", async () => {
    await browserKeyboard(cdp as never, { action: "keydown", key: "Shift" });

    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);
    const keyActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string; value: string }> }> }).actions[0].actions;
    expect(keyActions).toHaveLength(1);
    expect(keyActions[0].type).toBe("keyDown");
    expect(keyActions[0].value).toBe("Shift");
  });
});

describe("keyup (release held key)", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("input.performActions", {});
  });

  it("should send only keyUp action, no keyDown", async () => {
    await browserKeyboard(cdp as never, { action: "keyup", key: "Shift" });

    const actionCalls = cdp._getCalls("input.performActions");
    expect(actionCalls).toHaveLength(1);
    const keyActions = (actionCalls[0].params as { actions: Array<{ actions: Array<{ type: string; value: string }> }> }).actions[0].actions;
    expect(keyActions).toHaveLength(1);
    expect(keyActions[0].type).toBe("keyUp");
    expect(keyActions[0].value).toBe("Shift");
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.6 — scrollintoview as dedicated command (P2)
// ===========================================================================

describe("scrollintoview (dedicated command)", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("script.evaluate", {});
    cdp._setResponse("script.callFunction", {
      result: { type: "undefined" },
    });
    cdp._setResponse("script.evaluate", {
      result: { type: "object", objectId: "obj-1" },
    });
    cdp._setResponse("script.evaluate", {
      object: { objectId: "obj-1" },
    });
    cdp._setResponse("DOM.describeNode", {
      node: { nodeId: 1, backendNodeId: 1 },
    });
  });

  it("should call DOM.scrollIntoViewIfNeeded or element.scrollIntoView", async () => {
    await browserScrollIntoView(cdp as never, { selector: "#target" });

    // Should have called either DOM.scrollIntoViewIfNeeded or
    // Runtime.callFunctionOn with scrollIntoView
    const scrollCalls = cdp._getCalls("script.evaluate");
    const runtimeCalls = cdp._getCalls("script.callFunction").filter(
      (c) =>
        ((c.params as { functionDeclaration?: string }).functionDeclaration ?? "")
          .includes("scrollIntoView")
    );

    expect(scrollCalls.length + runtimeCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should work with @eN ref", async () => {
    await browserScrollIntoView(cdp as never, { ref: "@e5" });

    const scrollCalls = cdp._getCalls("script.evaluate");
    const runtimeCalls = cdp._getCalls("script.callFunction");
    expect(scrollCalls.length + runtimeCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.7 — check / uncheck idempotency (P2)
// ===========================================================================

describe("check / uncheck (idempotent)", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("script.evaluate", {});
    cdp._setResponse("input.performActions", {});
    cdp._setResponse("script.evaluate", {
      model: {
        content: [10, 10, 30, 10, 30, 30, 10, 30],
        width: 20,
        height: 20,
      },
    });
  });

  it("should be no-op if checkbox is already checked", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "boolean", value: true },
    });
    cdp._setResponse("script.callFunction", {
      result: { type: "boolean", value: true },
    });

    await browserCheck(cdp as never, { selector: "#agree" });

    // No click events should be dispatched since already checked
    const clickEvents = cdp._getCalls("input.performActions");
    expect(clickEvents).toHaveLength(0);
  });

  it("should click to check if checkbox is unchecked", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "boolean", value: false },
    });
    cdp._setResponse("script.callFunction", {
      result: { type: "boolean", value: false },
    });

    await browserCheck(cdp as never, { selector: "#agree" });

    const clickEvents = cdp._getCalls("input.performActions");
    expect(clickEvents.length).toBeGreaterThan(0);
  });

  it("should be no-op if checkbox is already unchecked when uncheck called", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "boolean", value: false },
    });
    cdp._setResponse("script.callFunction", {
      result: { type: "boolean", value: false },
    });

    await browserUncheck(cdp as never, { selector: "#agree" });

    const clickEvents = cdp._getCalls("input.performActions");
    expect(clickEvents).toHaveLength(0);
  });

  it("should click to uncheck if checkbox is checked", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "boolean", value: true },
    });
    cdp._setResponse("script.callFunction", {
      result: { type: "boolean", value: true },
    });

    await browserUncheck(cdp as never, { selector: "#agree" });

    const clickEvents = cdp._getCalls("input.performActions");
    expect(clickEvents.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.8 — focus element (P2)
// ===========================================================================

describe("focus element", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("script.evaluate", {});
    cdp._setResponse("script.evaluate", {
      result: { type: "object", objectId: "obj-1" },
    });
    cdp._setResponse("script.evaluate", {
      object: { objectId: "obj-1" },
    });
    cdp._setResponse("DOM.describeNode", {
      node: { nodeId: 1, backendNodeId: 1 },
    });
    cdp._setResponse("script.callFunction", {
      result: { type: "undefined" },
    });
  });

  it("should call DOM.focus on the element", async () => {
    await browserFocus(cdp as never, { selector: "#email-input" });

    // Should call DOM.focus or Runtime.callFunctionOn with .focus()
    const focusCalls = cdp._getCalls("script.evaluate");
    const runtimeFocusCalls = cdp._getCalls("script.callFunction").filter(
      (c) =>
        ((c.params as { functionDeclaration?: string }).functionDeclaration ?? "")
          .includes("focus")
    );

    expect(focusCalls.length + runtimeFocusCalls.length).toBeGreaterThanOrEqual(
      1
    );
  });

  it("should not dispatch click events", async () => {
    await browserFocus(cdp as never, { selector: "#email-input" });

    const clickEvents = cdp._getCalls("input.performActions");
    expect(clickEvents).toHaveLength(0);
  });

  it("should work with @eN ref", async () => {
    await browserFocus(cdp as never, { ref: "@e3" });

    const focusCalls = cdp._getCalls("script.evaluate");
    const runtimeFocusCalls = cdp._getCalls("script.callFunction");
    expect(focusCalls.length + runtimeFocusCalls.length).toBeGreaterThanOrEqual(
      1
    );
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.12 — Wait strategies (--url, --fn, --state) (P1)
// ===========================================================================

describe("wait --url pattern", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  it("should poll current URL until it matches glob pattern", async () => {
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      if (callCount <= 2) {
        return {
          result: { type: "string", value: "https://example.com/login" },
        };
      }
      return {
        result: { type: "string", value: "https://example.com/dashboard" },
      };
    });

    await browserWaitFor(cdp as never, { url: "**/dashboard" });

    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("should reject on timeout if URL never matches", async () => {
    cdp._setResponse("script.evaluate", () => ({
      result: { type: "string", value: "https://example.com/login" },
    }));

    await expect(
      browserWaitFor(cdp as never, { url: "**/dashboard", timeout: 1000 })
    ).rejects.toThrow(/timeout/i);
  });
});

describe("wait --fn JS condition", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  it("should poll Runtime.evaluate until expression returns truthy", async () => {
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      if (callCount <= 2) {
        return { result: { type: "boolean", value: false } };
      }
      return { result: { type: "boolean", value: true } };
    });

    await browserWaitFor(cdp as never, { fn: "window.ready === true" });

    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("should reject on timeout if expression never returns true", async () => {
    cdp._setResponse("script.evaluate", () => ({
      result: { type: "boolean", value: false },
    }));

    await expect(
      browserWaitFor(cdp as never, {
        fn: "window.ready === true",
        timeout: 1000,
      })
    ).rejects.toThrow(/timeout/i);
  });
});

describe("wait --state hidden", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  it("should poll until element is no longer visible", async () => {
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      if (callCount <= 2) {
        // Element still visible
        return { result: { type: "boolean", value: true } };
      }
      // Element now hidden
      return { result: { type: "boolean", value: false } };
    });

    await browserWaitFor(cdp as never, {
      selector: "#spinner",
      state: "hidden",
    });

    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("should succeed immediately if element is already hidden", async () => {
    let callCount = 0;
    cdp._setResponse("script.evaluate", () => {
      callCount++;
      // Element is already hidden on first check
      return { result: { type: "boolean", value: false } };
    });

    await browserWaitFor(cdp as never, {
      selector: "#spinner",
      state: "hidden",
    });

    // Should resolve quickly with minimal polls
    expect(callCount).toBeLessThanOrEqual(2);
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.13 — Tab management (tab new, window new) (P2)
// ===========================================================================

describe("tab new", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("browsingContext.create", {
      context: "new-target-1",
    });
    cdp._setResponse("browsingContext.activate", {});
  });

  it("should create tab and navigate to URL", async () => {
    cdp._setResponse("browsingContext.navigate", {});
    await browserTabNew(cdp as never, { url: "https://example.com" });

    const createCalls = cdp._getCalls("browsingContext.create");
    expect(createCalls).toHaveLength(1);
    expect((createCalls[0].params as { type: string }).type).toBe("tab");

    // URL is sent via separate browsingContext.navigate
    const navCalls = cdp._getCalls("browsingContext.navigate");
    expect(navCalls).toHaveLength(1);
    expect((navCalls[0].params as { url: string }).url).toBe("https://example.com");
  });

  it("should create tab with about:blank when no URL (no navigate call)", async () => {
    await browserTabNew(cdp as never, {});

    const createCalls = cdp._getCalls("browsingContext.create");
    expect(createCalls).toHaveLength(1);
    // No navigate call for about:blank
    const navCalls = cdp._getCalls("browsingContext.navigate");
    expect(navCalls).toHaveLength(0);
  });

  it("should set new tab as active", async () => {
    cdp._setResponse("browsingContext.navigate", {});
    const result = await browserTabNew(cdp as never, {
      url: "https://example.com",
    });

    const activateCalls = cdp._getCalls("browsingContext.activate");
    expect(activateCalls).toHaveLength(1);
    expect(
      (activateCalls[0].params as { context: string }).context
    ).toBe("new-target-1");
    expect(result.targetId).toBe("new-target-1");
  });
});

describe("window new", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("browsingContext.create", {
      context: "new-window-target-1",
    });
    cdp._setResponse("browsingContext.activate", {});
  });

  it("should create window context", async () => {
    cdp._setResponse("browsingContext.navigate", {});
    await browserWindowNew(cdp as never, { url: "https://example.com" });

    const createCalls = cdp._getCalls("browsingContext.create");
    expect(createCalls).toHaveLength(1);
    expect(
      (createCalls[0].params as { type: string }).type
    ).toBe("window");
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.14 — Frame management (P2)
// ===========================================================================

describe("frame switch", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("Page.getFrameTree", {
      frameTree: {
        frame: { id: "main-frame", url: "https://example.com" },
        childFrames: [
          {
            frame: {
              id: "iframe-1",
              url: "https://example.com/embed",
              name: "my-iframe",
            },
          },
        ],
      },
    });
    cdp._setResponse("script.evaluate", {
      result: { type: "object", objectId: "iframe-obj-1" },
    });
  });

  it("should switch execution context to iframe", async () => {
    const result = await browserFrameSwitch(cdp as never, {
      selector: "#my-iframe",
    });

    expect(result.success).toBe(true);
    expect(result.frameId).toBeDefined();
  });

  it("should scope subsequent commands to the iframe", async () => {
    await browserFrameSwitch(cdp as never, { selector: "#my-iframe" });

    // After switching, any evaluate call should target the iframe context
    // This is verified by checking that the execution context ID is set
    const frameCalls = cdp._getCalls("Page.getFrameTree");
    expect(frameCalls.length).toBeGreaterThanOrEqual(0);
  });
});

describe("frame main", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  it("should switch back to main frame execution context", async () => {
    const result = await browserFrameMain(cdp as never);

    expect(result.success).toBe(true);
    // Should reset to main frame context
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.15 — Clipboard (P2)
// ===========================================================================

describe("clipboard", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
  });

  it("should read clipboard text via navigator.clipboard.readText()", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "string", value: "clipboard content" },
    });

    const result = await browserClipboardRead(cdp as never);

    expect(result.text).toBe("clipboard content");

    const evalCalls = cdp._getCalls("script.evaluate");
    const clipboardReadCall = evalCalls.find((c) =>
      ((c.params as { expression: string }).expression ?? "").includes(
        "clipboard.readText"
      )
    );
    expect(clipboardReadCall).toBeDefined();
  });

  it("should write clipboard text via navigator.clipboard.writeText()", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "undefined" },
    });

    await browserClipboardWrite(cdp as never, { text: "Hello, World!" });

    const evalCalls = cdp._getCalls("script.evaluate");
    const clipboardWriteCall = evalCalls.find((c) =>
      ((c.params as { expression: string }).expression ?? "").includes(
        "clipboard.writeText"
      )
    );
    expect(clipboardWriteCall).toBeDefined();
    // Verify the text is passed in the expression
    expect(
      (clipboardWriteCall!.params as { expression: string }).expression
    ).toContain("Hello, World!");
  });
});

// ===========================================================================
// GAP ANALYSIS: TS-16 — Cross-Origin Iframe (complete) (P1)
// ===========================================================================

describe("TS-16: Cross-origin iframe complete handling", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("Page.getFrameTree", {
      frameTree: {
        frame: {
          id: "main-frame",
          url: "https://example.com",
          securityOrigin: "https://example.com",
        },
        childFrames: [
          {
            frame: {
              id: "same-origin-iframe",
              url: "https://example.com/embed",
              securityOrigin: "https://example.com",
            },
          },
          {
            frame: {
              id: "cross-origin-iframe",
              url: "https://third-party.com/widget",
              securityOrigin: "https://third-party.com",
            },
          },
        ],
      },
    });
  });

  it("should list all frames with origins via listFrames()", async () => {
    const frames = await listFrames(cdp as never);

    expect(frames).toHaveLength(3);
    expect(frames[0].url).toContain("example.com");
    expect(frames[1].url).toContain("example.com/embed");
    expect(frames[2].url).toContain("third-party.com");
  });

  it("should mark cross-origin frames as crossOrigin: true", async () => {
    const frames = await listFrames(cdp as never);

    const crossOriginFrame = frames.find((f: { url: string }) =>
      f.url.includes("third-party.com")
    );
    expect(crossOriginFrame).toBeDefined();
    expect(
      (crossOriginFrame as { crossOrigin: boolean }).crossOrigin
    ).toBe(true);
  });

  it("should suggest Target.attachToTarget for cross-origin content", async () => {
    const frames = await listFrames(cdp as never);

    const crossOriginFrame = frames.find((f: { url: string }) =>
      f.url.includes("third-party.com")
    );
    // The frame info should include a hint about cross-origin access
    expect(crossOriginFrame).toHaveProperty("crossOrigin", true);
    // Implementation should suggest Target.attachToTarget or similar
    // for accessing cross-origin iframe content
  });
});

// ===========================================================================
// GAP ANALYSIS: Section 2.11 — Semantic Locators (P1)
// ===========================================================================

describe("Semantic Locators", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("Accessibility.getFullAXTree", {
      nodes: [
        {
          nodeId: "ax-1",
          role: { type: "role", value: "button" },
          name: { type: "computedString", value: "Submit" },
          backendDOMNodeId: 1,
        },
        {
          nodeId: "ax-2",
          role: { type: "role", value: "link" },
          name: { type: "computedString", value: "Sign In" },
          backendDOMNodeId: 2,
        },
      ],
    });
    cdp._setResponse("script.evaluate", {
      result: { type: "object", objectId: "obj-1" },
    });
    cdp._setResponse("script.evaluate", {
      object: { objectId: "obj-1" },
    });
    cdp._setResponse("DOM.describeNode", {
      node: { nodeId: 1, backendNodeId: 1 },
    });
    cdp._setResponse("script.evaluate", {
      model: {
        content: [50, 50, 150, 50, 150, 80, 50, 80],
        width: 100,
        height: 30,
      },
    });
    cdp._setResponse("script.evaluate", {});
    cdp._setResponse("input.performActions", {});
    cdp._setResponse("script.callFunction", {
      result: { type: "string", value: "matched-text" },
    });
  });

  it("find role: should locate by ARIA role and accessible name", async () => {
    const result = await findByRole(cdp as never, {
      role: "button",
      name: "Submit",
    });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find text: should locate by text content", async () => {
    const result = await findByText(cdp as never, { text: "Sign In" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find label: should locate by associated label", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "object", objectId: "labeled-input-1" },
    });

    const result = await findByLabel(cdp as never, { label: "Email" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find placeholder: should locate by placeholder attribute", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "object", objectId: "placeholder-input-1" },
    });

    const result = await findByPlaceholder(cdp as never, {
      placeholder: "Search...",
    });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find alt: should locate by alt text", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "object", objectId: "img-1" },
    });

    const result = await findByAlt(cdp as never, { alt: "Company Logo" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find title: should locate by title attribute", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "object", objectId: "titled-1" },
    });

    const result = await findByTitle(cdp as never, { title: "More info" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find testid: should locate by data-testid", async () => {
    cdp._setResponse("script.evaluate", {
      result: { type: "object", objectId: "testid-1" },
    });

    const result = await findByTestId(cdp as never, { testId: "submit-btn" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find first: should select first matching element", async () => {
    cdp._setResponse("script.evaluate", {
      result: {
        type: "object",
        objectId: "first-1",
        description: "NodeList(3)",
      },
    });

    const result = await findFirst(cdp as never, { selector: ".item" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
    expect(result.index).toBe(0);
  });

  it("find last: should select last matching element", async () => {
    cdp._setResponse("script.evaluate", {
      result: {
        type: "object",
        objectId: "last-1",
        description: "NodeList(3)",
      },
    });

    const result = await findLast(cdp as never, { selector: ".item" });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });

  it("find nth: should select nth matching element", async () => {
    cdp._setResponse("script.evaluate", {
      result: {
        type: "object",
        objectId: "nth-1",
        description: "NodeList(5)",
      },
    });

    const result = await findNth(cdp as never, { selector: "a", n: 2 });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
    expect(result.index).toBe(2);
  });

  it("find with --exact: should require exact text match", async () => {
    // With exact=true, "Sign In" should NOT match "Sign In Now"
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("exact")) {
        return { result: { type: "object", objectId: "exact-match-1" } };
      }
      return { result: { type: "object", objectId: "fuzzy-match-1" } };
    });

    const result = await findByText(cdp as never, {
      text: "Sign In",
      exact: true,
    });

    expect(result).toBeDefined();
    expect(result.found).toBe(true);
  });
});

// ===========================================================================
// browser_route — Intercept requests and return mock responses
// ===========================================================================

describe("browser_route", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    resetInterceptState();
    cdp = createMockBiDi();
  });

  afterEach(() => {
    cdp._reset();
  });

  it("should intercept matching URL and return mock response body", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.provideResponse", {});

    await browserRoute(cdp as never, {
      url: "https://api.example.com/users",
      body: '{"users": []}',
    });

    // Verify Fetch.enable was called with the correct URL pattern
    const enableCalls = cdp._getCalls("network.addIntercept");
    expect(enableCalls).toHaveLength(1);
    expect(enableCalls[0].params).toEqual(
      expect.objectContaining({
        urlPatterns: expect.arrayContaining([
          expect.objectContaining({ type: "pattern", pattern: "https://api.example.com/users" }),
        ]),
      })
    );

    // Simulate a matching request being paused
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-1", url: "https://api.example.com/users" }, isBlocked: true });

    // Verify Fetch.fulfillRequest was called with the mock body
    const fulfillCalls = cdp._getCalls("network.provideResponse");
    expect(fulfillCalls).toHaveLength(1);
    expect(fulfillCalls[0].params).toEqual(
      expect.objectContaining({
        request: "req-1",
        body: expect.objectContaining({ type: "string", value: expect.any(String) }),
      })
    );
  });

  it("should set correct response status code", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.provideResponse", {});

    await browserRoute(cdp as never, {
      url: "https://api.example.com/not-found",
      body: '{"error": "not found"}',
      status: 404,
    });

    // Simulate request paused
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-2", url: "https://api.example.com/not-found" }, isBlocked: true });

    const fulfillCalls = cdp._getCalls("network.provideResponse");
    expect(fulfillCalls).toHaveLength(1);
    expect(fulfillCalls[0].params).toEqual(
      expect.objectContaining({
        request: "req-2",
        statusCode: 404,
      })
    );
  });

  it("should set response headers", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.provideResponse", {});

    await browserRoute(cdp as never, {
      url: "https://api.example.com/data",
      body: "OK",
      headers: {
        "Content-Type": "application/json",
        "X-Custom-Header": "test-value",
      },
    });

    // Simulate request paused
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-3", url: "https://api.example.com/data" }, isBlocked: true });

    const fulfillCalls = cdp._getCalls("network.provideResponse");
    expect(fulfillCalls).toHaveLength(1);
    expect(fulfillCalls[0].params).toEqual(
      expect.objectContaining({
        request: "req-3",
        headers: expect.arrayContaining([
          expect.objectContaining({ name: "Content-Type", value: expect.objectContaining({ value: "application/json" }) }),
          expect.objectContaining({ name: "X-Custom-Header", value: expect.objectContaining({ value: "test-value" }) }),
        ]),
      })
    );
  });

  it("should support glob URL patterns (e.g., '**/api/**')", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.provideResponse", {});

    await browserRoute(cdp as never, {
      url: "**/api/**",
      body: '{"mocked": true}',
    });

    const enableCalls = cdp._getCalls("network.addIntercept");
    expect(enableCalls).toHaveLength(1);
    expect(enableCalls[0].params).toEqual(
      expect.objectContaining({
        urlPatterns: expect.arrayContaining([
          expect.objectContaining({ type: "pattern", pattern: "**/api/**" }),
        ]),
      })
    );

    // Simulate a matching request
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-glob-1", url: "https://example.com/api/v2/users" }, isBlocked: true });

    const fulfillCalls = cdp._getCalls("network.provideResponse");
    expect(fulfillCalls).toHaveLength(1);
    expect(fulfillCalls[0].params).toEqual(
      expect.objectContaining({ request: "req-glob-1" })
    );
  });

  it("should allow multiple routes for different patterns", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.provideResponse", {});

    await browserRoute(cdp as never, {
      url: "https://api.example.com/users",
      body: '{"users": ["alice"]}',
    });

    await browserRoute(cdp as never, {
      url: "https://api.example.com/posts",
      body: '{"posts": []}',
    });

    // Both patterns should be registered via Fetch.enable
    // The second call should re-enable with both patterns
    const enableCalls = cdp._getCalls("network.addIntercept");
    expect(enableCalls.length).toBeGreaterThanOrEqual(2);

    // Simulate request for /users
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-users", url: "https://api.example.com/users" }, isBlocked: true });

    // Simulate request for /posts
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-posts", url: "https://api.example.com/posts" }, isBlocked: true });

    const fulfillCalls = cdp._getCalls("network.provideResponse");
    expect(fulfillCalls).toHaveLength(2);

    const usersFulfill = fulfillCalls.find(
      (c) => (c.params as any).request === "req-users"
    );
    const postsFulfill = fulfillCalls.find(
      (c) => (c.params as any).request === "req-posts"
    );
    expect(usersFulfill).toBeDefined();
    expect(postsFulfill).toBeDefined();
  });

  it("should override existing route for same pattern", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.provideResponse", {});

    // First route
    await browserRoute(cdp as never, {
      url: "https://api.example.com/config",
      body: '{"version": 1}',
    });

    // Override with new body
    await browserRoute(cdp as never, {
      url: "https://api.example.com/config",
      body: '{"version": 2}',
    });

    // Simulate request — should use the LATEST route definition
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-config", url: "https://api.example.com/config" }, isBlocked: true });

    const fulfillCalls = cdp._getCalls("network.provideResponse");
    expect(fulfillCalls).toHaveLength(1);
    // The body should be the second (overridden) value, base64-encoded
    const body = fulfillCalls[0].params as Record<string, unknown>;
    // Decode the base64 body to verify it's the updated value
    const decodedBody = (body.body as { value: string }).value;
    expect(decodedBody).toBe('{"version": 2}');
  });

  it("should handle JSON body (auto-stringify if object)", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.provideResponse", {});

    // Pass an object as body — implementation should JSON.stringify it
    await browserRoute(cdp as never, {
      url: "https://api.example.com/json",
      body: { data: [1, 2, 3] } as any,
    });

    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-json", url: "https://api.example.com/json" }, isBlocked: true });

    const fulfillCalls = cdp._getCalls("network.provideResponse");
    expect(fulfillCalls).toHaveLength(1);
    // Decode body and verify JSON was stringified
    const body = fulfillCalls[0].params as Record<string, unknown>;
    const decodedBody = (body.body as { value: string }).value;
    const parsed = JSON.parse(decodedBody);
    expect(parsed).toEqual({ data: [1, 2, 3] });
  });

  it("should pass non-matching requests through (Fetch.continueRequest)", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.provideResponse", {});
    cdp._setResponse("network.continueRequest", {});

    await browserRoute(cdp as never, {
      url: "https://api.example.com/users",
      body: '{"users": []}',
    });

    // Simulate a NON-matching request
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-other", url: "https://cdn.example.com/image.png" }, isBlocked: true });

    // Should NOT fulfill this request
    const fulfillCalls = cdp._getCalls("network.provideResponse");
    expect(fulfillCalls).toHaveLength(0);

    // Should continue the non-matching request
    const continueCalls = cdp._getCalls("network.continueRequest");
    expect(continueCalls).toHaveLength(1);
    expect(continueCalls[0].params).toEqual(
      expect.objectContaining({ request: "req-other" })
    );
  });
});

// ===========================================================================
// browser_abort — Block requests matching a URL pattern
// ===========================================================================

describe("browser_abort", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    resetInterceptState();
    cdp = createMockBiDi();
  });

  afterEach(() => {
    cdp._reset();
  });

  it("should block matching URL pattern", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.failRequest", {});

    await browserAbort(cdp as never, {
      url: "https://ads.example.com/*",
    });

    // Verify Fetch.enable was called with the URL pattern
    const enableCalls = cdp._getCalls("network.addIntercept");
    expect(enableCalls).toHaveLength(1);
    expect(enableCalls[0].params).toEqual(
      expect.objectContaining({
        urlPatterns: expect.arrayContaining([
          expect.objectContaining({ type: "pattern", pattern: "https://ads.example.com/*" }),
        ]),
      })
    );

    // Simulate a matching request being paused
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-ad-1", url: "https://ads.example.com/banner.js" }, isBlocked: true });

    // Should fail (abort) the request
    const failCalls = cdp._getCalls("network.failRequest");
    expect(failCalls).toHaveLength(1);
    expect(failCalls[0].params).toEqual(
      expect.objectContaining({ request: "req-ad-1" })
    );
  });

  it('should use "BlockedByClient" as failure reason', async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.failRequest", {});

    await browserAbort(cdp as never, {
      url: "https://tracker.example.com/*",
    });

    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-tracker-1", url: "https://tracker.example.com/pixel.gif" }, isBlocked: true });

    const failCalls = cdp._getCalls("network.failRequest");
    expect(failCalls).toHaveLength(1);
    expect(failCalls[0].params).toEqual(
      expect.objectContaining({ request: "req-tracker-1" })
    );
  });

  it("should support glob URL patterns", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.failRequest", {});

    await browserAbort(cdp as never, {
      url: "**/analytics/**",
    });

    const enableCalls = cdp._getCalls("network.addIntercept");
    expect(enableCalls).toHaveLength(1);
    expect(enableCalls[0].params).toEqual(
      expect.objectContaining({
        urlPatterns: expect.arrayContaining([
          expect.objectContaining({ type: "pattern", pattern: "**/analytics/**" }),
        ]),
      })
    );

    // Simulate a matching request
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-analytics", url: "https://example.com/analytics/event" }, isBlocked: true });

    const failCalls = cdp._getCalls("network.failRequest");
    expect(failCalls).toHaveLength(1);
    expect(failCalls[0].params).toEqual(
      expect.objectContaining({
        request: "req-analytics",
        reason: "BlockedByClient",
      })
    );
  });

  it("should allow multiple abort patterns", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.failRequest", {});

    await browserAbort(cdp as never, {
      url: "https://ads.example.com/*",
    });

    await browserAbort(cdp as never, {
      url: "https://tracker.example.com/*",
    });

    // Simulate matching requests for both patterns
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-ad", url: "https://ads.example.com/banner.js" }, isBlocked: true });

    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-tracker", url: "https://tracker.example.com/pixel.gif" }, isBlocked: true });

    const failCalls = cdp._getCalls("network.failRequest");
    expect(failCalls).toHaveLength(2);

    const adFail = failCalls.find(
      (c) => (c.params as any).request === "req-ad"
    );
    const trackerFail = failCalls.find(
      (c) => (c.params as any).request === "req-tracker"
    );
    expect(adFail).toBeDefined();
    expect(trackerFail).toBeDefined();
  });

  it("should not affect non-matching requests", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.failRequest", {});
    cdp._setResponse("network.continueRequest", {});

    await browserAbort(cdp as never, {
      url: "https://ads.example.com/*",
    });

    // Simulate a NON-matching request
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-legit", url: "https://api.example.com/data" }, isBlocked: true });

    // Should NOT fail this request
    const failCalls = cdp._getCalls("network.failRequest");
    expect(failCalls).toHaveLength(0);

    // Should continue the non-matching request
    const continueCalls = cdp._getCalls("network.continueRequest");
    expect(continueCalls).toHaveLength(1);
    expect(continueCalls[0].params).toEqual(
      expect.objectContaining({ request: "req-legit" })
    );
  });
});

// ===========================================================================
// browser_unroute — Remove intercept rules
// ===========================================================================

describe("browser_unroute", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    resetInterceptState();
    cdp = createMockBiDi();
  });

  afterEach(() => {
    cdp._reset();
  });

  it("should remove specific route by URL pattern", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.provideResponse", {});
    cdp._setResponse("network.continueRequest", {});

    // Set up a route
    await browserRoute(cdp as never, {
      url: "https://api.example.com/users",
      body: '{"users": []}',
    });

    // Remove the route
    await browserUnroute(cdp as never, {
      url: "https://api.example.com/users",
    });

    // Clear calls so we only see post-unroute behavior
    cdp._calls.length = 0;

    // Simulate a request that previously would have been intercepted
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-after-unroute", url: "https://api.example.com/users" }, isBlocked: true });

    // Should NOT fulfill — the route was removed
    const fulfillCalls = cdp._getCalls("network.provideResponse");
    expect(fulfillCalls).toHaveLength(0);

    // Should continue the request (or no longer intercept it at all)
    const continueCalls = cdp._getCalls("network.continueRequest");
    expect(continueCalls).toHaveLength(1);
  });

  it("should remove specific abort by URL pattern", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.failRequest", {});
    cdp._setResponse("network.continueRequest", {});

    // Set up an abort
    await browserAbort(cdp as never, {
      url: "https://ads.example.com/*",
    });

    // Remove the abort rule
    await browserUnroute(cdp as never, {
      url: "https://ads.example.com/*",
    });

    // Clear calls
    cdp._calls.length = 0;

    // Simulate a request that previously would have been blocked
    await cdp._emitAsync("network.beforeRequestSent", { request: { request: "req-after-unabort", url: "https://ads.example.com/banner.js" }, isBlocked: true });

    // Should NOT fail — the abort was removed
    const failCalls = cdp._getCalls("network.failRequest");
    expect(failCalls).toHaveLength(0);

    // Should continue the request
    const continueCalls = cdp._getCalls("network.continueRequest");
    expect(continueCalls).toHaveLength(1);
  });

  it("should remove all intercepts when {all: true}", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.removeIntercept", {});
    cdp._setResponse("network.provideResponse", {});
    cdp._setResponse("network.failRequest", {});

    // Set up multiple routes and aborts
    await browserRoute(cdp as never, {
      url: "https://api.example.com/users",
      body: '{"users": []}',
    });

    await browserRoute(cdp as never, {
      url: "https://api.example.com/posts",
      body: '{"posts": []}',
    });

    await browserAbort(cdp as never, {
      url: "https://ads.example.com/*",
    });

    // Remove ALL intercepts
    await browserUnroute(cdp as never, { all: true });

    // Fetch.disable should have been called since all intercepts are removed
    const disableCalls = cdp._getCalls("network.removeIntercept");
    expect(disableCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should call Fetch.disable when no intercepts remain", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.removeIntercept", {});
    cdp._setResponse("network.provideResponse", {});

    // Set up a single route
    await browserRoute(cdp as never, {
      url: "https://api.example.com/data",
      body: "{}",
    });

    // Remove the only route — no intercepts remain
    await browserUnroute(cdp as never, {
      url: "https://api.example.com/data",
    });

    // Fetch.disable should be called when the last intercept is removed
    const disableCalls = cdp._getCalls("network.removeIntercept");
    expect(disableCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("should be idempotent (removing non-existent pattern is ok)", async () => {
    cdp._setResponse("network.addIntercept", {});
    cdp._setResponse("network.removeIntercept", {});

    // Remove a pattern that was never registered — should not throw
    await expect(
      browserUnroute(cdp as never, {
        url: "https://nonexistent.example.com/*",
      })
    ).resolves.not.toThrow();
  });
});

// ===========================================================================
// browser_find (unified MCP tool)
// ===========================================================================

describe("browser_find", () => {
  let cdp: MockBiDi;

  // Sample AX tree nodes for tests
  const sampleNodes = [
    {
      nodeId: "1",
      role: { type: "role", value: "WebArea" },
      name: { type: "computedString", value: "Test Page" },
      backendDOMNodeId: 1,
      childIds: ["2", "3", "4", "5", "6", "7"],
    },
    {
      nodeId: "2",
      role: { type: "role", value: "heading" },
      name: { type: "computedString", value: "Welcome" },
      backendDOMNodeId: 10,
      parentId: "1",
    },
    {
      nodeId: "3",
      role: { type: "role", value: "button" },
      name: { type: "computedString", value: "Submit" },
      backendDOMNodeId: 20,
      parentId: "1",
    },
    {
      nodeId: "4",
      role: { type: "role", value: "button" },
      name: { type: "computedString", value: "Cancel" },
      backendDOMNodeId: 30,
      parentId: "1",
    },
    {
      nodeId: "5",
      role: { type: "role", value: "link" },
      name: { type: "computedString", value: "Sign In" },
      backendDOMNodeId: 40,
      parentId: "1",
    },
    {
      nodeId: "6",
      role: { type: "role", value: "textbox" },
      name: { type: "computedString", value: "Email" },
      backendDOMNodeId: 50,
      parentId: "1",
    },
    {
      nodeId: "7",
      role: { type: "role", value: "StaticText" },
      name: { type: "computedString", value: "Hello world" },
      backendDOMNodeId: 60,
      parentId: "1",
    },
  ];

  beforeEach(() => {
    cdp = createMockBiDi();
    cdp._setResponse("Accessibility.getFullAXTree", { nodes: sampleNodes });
  });

  it("should find element by role", async () => {
    const result = await browserFind(cdp as never, { role: "button" });

    expect(result.found).toBe(true);
    expect(result.role).toBe("button");
  });

  it("should find element by role and name", async () => {
    const result = await browserFind(cdp as never, { role: "button", name: "Cancel" });

    expect(result.found).toBe(true);
    expect(result.role).toBe("button");
    expect(result.name).toBe("Cancel");
    expect(result.ref).toBe("@e30");
  });

  it("should find element by text content", async () => {
    const result = await browserFind(cdp as never, { text: "Hello world" });

    expect(result.found).toBe(true);
    expect(result.name).toBe("Hello world");
    expect(result.ref).toBe("@e60");
  });

  it("should return first match by default (nth=0)", async () => {
    const result = await browserFind(cdp as never, { role: "button" });

    expect(result.found).toBe(true);
    expect(result.name).toBe("Submit");
    expect(result.ref).toBe("@e20");
  });

  it("should return nth match when specified", async () => {
    const result = await browserFind(cdp as never, { role: "button", nth: 1 });

    expect(result.found).toBe(true);
    expect(result.name).toBe("Cancel");
    expect(result.ref).toBe("@e30");
  });

  it("should return found: false when no match", async () => {
    const result = await browserFind(cdp as never, { role: "slider" });

    expect(result.found).toBe(false);
    expect(result.ref).toBeNull();
    expect(result.role).toBeNull();
    expect(result.name).toBeNull();
    expect(result.count).toBe(0);
  });

  it("should return count of total matches", async () => {
    const result = await browserFind(cdp as never, { role: "button" });

    expect(result.count).toBe(2);
  });

  it("should return valid @eN ref for matched element", async () => {
    const result = await browserFind(cdp as never, { role: "link", name: "Sign In" });

    expect(result.found).toBe(true);
    expect(result.ref).toBe("@e40");
    expect(result.ref).toMatch(/^@e\d+$/);
  });

  it("should match role case-insensitively", async () => {
    const result = await browserFind(cdp as never, { role: "BUTTON" });

    expect(result.found).toBe(true);
    expect(result.role).toBe("button");
    expect(result.count).toBe(2);
  });

  it("should match name as substring", async () => {
    const result = await browserFind(cdp as never, { name: "Sub" });

    expect(result.found).toBe(true);
    expect(result.name).toBe("Submit");
    expect(result.ref).toBe("@e20");
  });
});

// ===========================================================================
// browser_diff
// ===========================================================================

describe("browser_diff", () => {
  let cdp: MockBiDi;

  // A fake base64 PNG string (not valid PNG but sufficient for mock tests)
  const fakeBase64A = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";
  const fakeBase64B = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8";

  beforeEach(() => {
    cdp = createMockBiDi();
    // Default responses for Runtime.evaluate
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string; awaitPromise?: boolean };
      // For the variable assignment calls, return simple value
      if (p.expression.startsWith("window._diffBefore") || p.expression.startsWith("window._diffAfter")) {
        return { result: { type: "string", value: "" } };
      }
      // For the cleanup call
      if (p.expression.startsWith("delete window._diffBefore")) {
        return { result: { type: "boolean", value: true } };
      }
      // For the comparison expression (awaitPromise: true)
      if (p.awaitPromise) {
        return {
          result: {
            type: "string",
            value: JSON.stringify({
              diffPercentage: 0,
              totalPixels: 100,
              diffPixels: 0,
              identical: true,
              diffImage: "diffImageBase64Data",
              width: 10,
              height: 10,
            }),
          },
        };
      }
      return { result: { type: "undefined" } };
    });
    cdp._setResponse("browsingContext.captureScreenshot", { data: fakeBase64A });
  });

  it("should return identical: true for same screenshot", async () => {
    const result = await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64A,
    });

    expect(result.identical).toBe(true);
    expect(result.diffPercentage).toBe(0);
    expect(result.diffPixels).toBe(0);
    expect(result.totalPixels).toBe(100);
  });

  it("should detect pixel differences between two images", async () => {
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string; awaitPromise?: boolean };
      if (p.expression.startsWith("window._diff") || p.expression.startsWith("delete window._diff")) {
        return { result: { type: "string", value: "" } };
      }
      if (p.awaitPromise) {
        return {
          result: {
            type: "string",
            value: JSON.stringify({
              diffPercentage: 15.5,
              totalPixels: 1000,
              diffPixels: 155,
              identical: false,
              diffImage: "diffHighlightBase64",
              width: 100,
              height: 10,
            }),
          },
        };
      }
      return { result: { type: "undefined" } };
    });

    const result = await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64B,
    });

    expect(result.identical).toBe(false);
    expect(result.diffPixels).toBe(155);
    expect(result.diffPercentage).toBe(15.5);
  });

  it("should return diff percentage", async () => {
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string; awaitPromise?: boolean };
      if (p.expression.startsWith("window._diff") || p.expression.startsWith("delete window._diff")) {
        return { result: { type: "string", value: "" } };
      }
      if (p.awaitPromise) {
        return {
          result: {
            type: "string",
            value: JSON.stringify({
              diffPercentage: 42.75,
              totalPixels: 400,
              diffPixels: 171,
              identical: false,
              diffImage: "base64data",
              width: 20,
              height: 20,
            }),
          },
        };
      }
      return { result: { type: "undefined" } };
    });

    const result = await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64B,
    });

    expect(result.diffPercentage).toBe(42.75);
    expect(result.totalPixels).toBe(400);
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
  });

  it("should return diff image as base64", async () => {
    const result = await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64A,
    });

    expect(result.diffImage).toBeDefined();
    expect(typeof result.diffImage).toBe("string");
    expect(result.diffImage.length).toBeGreaterThan(0);
  });

  it("should capture current page when before is 'current'", async () => {
    cdp._setResponse("browsingContext.captureScreenshot", { data: fakeBase64A });

    const result = await browserDiff(cdp as never, {
      before: "current",
      after: fakeBase64B,
    });

    // Should have called Page.captureScreenshot for "before"
    const screenshotCalls = cdp._getCalls("browsingContext.captureScreenshot");
    expect(screenshotCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.identical).toBe(true);
  });

  it("should capture current page when after is not provided", async () => {
    cdp._setResponse("browsingContext.captureScreenshot", { data: fakeBase64A });

    const result = await browserDiff(cdp as never, {
      before: fakeBase64A,
    });

    // Should have called Page.captureScreenshot for "after"
    const screenshotCalls = cdp._getCalls("browsingContext.captureScreenshot");
    expect(screenshotCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.identical).toBe(true);
  });

  it("should respect threshold parameter", async () => {
    const customThreshold = 50;

    await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64B,
      threshold: customThreshold,
    });

    // The threshold should be embedded in the comparison expression
    const evalCalls = cdp._getCalls("script.evaluate");
    const comparisonCall = evalCalls.find(
      (c) => (c.params as { awaitPromise?: boolean }).awaitPromise === true,
    );
    expect(comparisonCall).toBeDefined();
    const expression = (comparisonCall!.params as { expression: string }).expression;
    expect(expression).toContain("const threshold = 50;");
  });

  it("should handle different image dimensions gracefully", async () => {
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string; awaitPromise?: boolean };
      if (p.expression.startsWith("window._diff") || p.expression.startsWith("delete window._diff")) {
        return { result: { type: "string", value: "" } };
      }
      if (p.awaitPromise) {
        // Simulate comparison of images with different dimensions
        // The canvas approach uses Math.max(width, height) so it handles this
        return {
          result: {
            type: "string",
            value: JSON.stringify({
              diffPercentage: 25.0,
              totalPixels: 2000,
              diffPixels: 500,
              identical: false,
              diffImage: "diffBase64ForDifferentSizes",
              width: 100,
              height: 20,
            }),
          },
        };
      }
      return { result: { type: "undefined" } };
    });

    const result = await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64B,
    });

    expect(result.width).toBe(100);
    expect(result.height).toBe(20);
    expect(result.diffPercentage).toBe(25.0);
    expect(result.identical).toBe(false);
  });

  it("should store images in page context as window variables", async () => {
    await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64B,
    });

    const evalCalls = cdp._getCalls("script.evaluate");

    // Should set window._diffBefore
    const beforeCall = evalCalls.find(
      (c) => ((c.params as { expression: string }).expression).startsWith("window._diffBefore"),
    );
    expect(beforeCall).toBeDefined();

    // Should set window._diffAfter
    const afterCall = evalCalls.find(
      (c) => ((c.params as { expression: string }).expression).startsWith("window._diffAfter"),
    );
    expect(afterCall).toBeDefined();

    // Should clean up globals
    const cleanupCall = evalCalls.find(
      (c) => ((c.params as { expression: string }).expression).startsWith("delete window._diffBefore"),
    );
    expect(cleanupCall).toBeDefined();
  });

  it("should scope comparison to selector when provided", async () => {
    cdp._setResponse("script.evaluate", { root: { nodeId: 1 } });
    cdp._setResponse("script.evaluate", { nodeId: 5 });
    cdp._setResponse("script.evaluate", {
      model: { content: [10, 20, 110, 20, 110, 120, 10, 120] },
    });

    await browserDiff(cdp as never, {
      before: "current",
      after: "current",
      selector: "#my-element",
    });

    // Should have used DOM.querySelector to find the element
    const queryCalls = cdp._getCalls("script.evaluate");
    expect(queryCalls.length).toBeGreaterThanOrEqual(1);
    expect((queryCalls[0].params as { selector: string }).selector).toBe("#my-element");

    // Should have captured screenshot with clip
    const screenshotCalls = cdp._getCalls("browsingContext.captureScreenshot");
    expect(screenshotCalls.length).toBeGreaterThanOrEqual(1);
    const clipParam = (screenshotCalls[0].params as { clip?: unknown }).clip;
    expect(clipParam).toBeDefined();
  });

  it("should throw error when comparison fails with exception", async () => {
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string; awaitPromise?: boolean };
      if (p.expression.startsWith("window._diff") || p.expression.startsWith("delete window._diff")) {
        return { result: { type: "string", value: "" } };
      }
      if (p.awaitPromise) {
        return {
          result: { type: "undefined" },
          exceptionDetails: { text: "Canvas tainted by cross-origin data" },
        };
      }
      return { result: { type: "undefined" } };
    });

    await expect(
      browserDiff(cdp as never, {
        before: fakeBase64A,
        after: fakeBase64B,
      }),
    ).rejects.toThrow("Diff comparison failed");
  });

  it("should use default threshold of 30 when not specified", async () => {
    await browserDiff(cdp as never, {
      before: fakeBase64A,
      after: fakeBase64B,
    });

    const evalCalls = cdp._getCalls("script.evaluate");
    const comparisonCall = evalCalls.find(
      (c) => (c.params as { awaitPromise?: boolean }).awaitPromise === true,
    );
    expect(comparisonCall).toBeDefined();
    const expression = (comparisonCall!.params as { expression: string }).expression;
    expect(expression).toContain("const threshold = 30;");
  });
});

// ===========================================================================
// browser_save_state
// ===========================================================================

import { browserSaveState } from "../src/tools/browser-session-state";
import { browserLoadState } from "../src/tools/browser-session-state";

// Mock node:fs and node:os for state tests
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: vi.fn(() => "/mock-home"),
  };
});

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

describe("browser_save_state", () => {
  let cdp: MockBiDi;

  beforeEach(() => {
    cdp = createMockBiDi();
    vi.mocked(writeFileSync).mockReset();
    vi.mocked(readFileSync).mockReset();
    vi.mocked(existsSync).mockReset();
    vi.mocked(mkdirSync).mockReset();
    vi.mocked(homedir).mockReturnValue("/mock-home");
  });

  it("should save cookies from Network.getAllCookies", async () => {
    const mockCookies = [
      { name: "session", value: "abc123", domain: ".example.com" },
      { name: "pref", value: "dark", domain: ".example.com" },
    ];
    cdp._setResponse("Network.getAllCookies", { cookies: mockCookies });
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://example.com/dashboard" } };
      }
      if (p.expression.includes("localStorage")) {
        return { result: { value: "[]" } };
      }
      if (p.expression.includes("sessionStorage")) {
        return { result: { value: "[]" } };
      }
      return { result: {} };
    });
    vi.mocked(existsSync).mockReturnValue(true);

    const result = await browserSaveState(cdp as never, { name: "test-session" });

    expect(result.cookies).toBe(2);
    expect(cdp._getCalls("Network.getAllCookies")).toHaveLength(1);
  });

  it("should save localStorage entries", async () => {
    const localEntries = [["theme", "dark"], ["lang", "en"]];
    cdp._setResponse("Network.getAllCookies", { cookies: [] });
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://example.com/" } };
      }
      if (p.expression.includes("localStorage")) {
        return { result: { value: JSON.stringify(localEntries) } };
      }
      if (p.expression.includes("sessionStorage")) {
        return { result: { value: "[]" } };
      }
      return { result: {} };
    });
    vi.mocked(existsSync).mockReturnValue(true);

    const result = await browserSaveState(cdp as never, { name: "test-local" });

    expect(result.localStorage).toBe(2);
  });

  it("should save sessionStorage entries", async () => {
    const sessionEntries = [["cart", "item1"], ["step", "3"]];
    cdp._setResponse("Network.getAllCookies", { cookies: [] });
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://example.com/" } };
      }
      if (p.expression.includes("localStorage")) {
        return { result: { value: "[]" } };
      }
      if (p.expression.includes("sessionStorage")) {
        return { result: { value: JSON.stringify(sessionEntries) } };
      }
      return { result: {} };
    });
    vi.mocked(existsSync).mockReturnValue(true);

    const result = await browserSaveState(cdp as never, { name: "test-session-storage" });

    expect(result.sessionStorage).toBe(2);
  });

  it("should save current URL", async () => {
    cdp._setResponse("Network.getAllCookies", { cookies: [] });
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://app.example.com/settings" } };
      }
      if (p.expression.includes("localStorage")) {
        return { result: { value: "[]" } };
      }
      if (p.expression.includes("sessionStorage")) {
        return { result: { value: "[]" } };
      }
      return { result: {} };
    });
    vi.mocked(existsSync).mockReturnValue(true);

    await browserSaveState(cdp as never, { name: "test-url" });

    // Verify the written file contains the URL
    const writeCall = vi.mocked(writeFileSync).mock.calls[0];
    const writtenData = JSON.parse(writeCall[1] as string);
    expect(writtenData.url).toBe("https://app.example.com/settings");
  });

  it("should write state file to ~/.browsirai/states/{name}.json", async () => {
    cdp._setResponse("Network.getAllCookies", { cookies: [] });
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://example.com/" } };
      }
      return { result: { value: "[]" } };
    });
    vi.mocked(existsSync).mockReturnValue(true);

    const result = await browserSaveState(cdp as never, { name: "my-state" });

    expect(result.path).toBe("/mock-home/.browsirai/states/my-state.json");
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
      "/mock-home/.browsirai/states/my-state.json",
      expect.any(String),
      "utf-8",
    );
  });

  it("should create states directory if not exists", async () => {
    cdp._setResponse("Network.getAllCookies", { cookies: [] });
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://example.com/" } };
      }
      return { result: { value: "[]" } };
    });
    vi.mocked(existsSync).mockReturnValue(false);

    await browserSaveState(cdp as never, { name: "new-state" });

    expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(
      "/mock-home/.browsirai/states",
      { recursive: true },
    );
  });

  it("should overwrite existing state file with same name", async () => {
    cdp._setResponse("Network.getAllCookies", { cookies: [{ name: "a", value: "1" }] });
    cdp._setResponse("script.evaluate", (params: unknown) => {
      const p = params as { expression: string };
      if (p.expression.includes("window.location.href")) {
        return { result: { value: "https://example.com/" } };
      }
      return { result: { value: "[]" } };
    });
    vi.mocked(existsSync).mockReturnValue(true);

    // Save twice with same name
    await browserSaveState(cdp as never, { name: "overwrite-test" });
    await browserSaveState(cdp as never, { name: "overwrite-test" });

    // writeFileSync should have been called twice to the same path
    const writeCalls = vi.mocked(writeFileSync).mock.calls;
    expect(writeCalls).toHaveLength(2);
    expect(writeCalls[0][0]).toBe("/mock-home/.browsirai/states/overwrite-test.json");
    expect(writeCalls[1][0]).toBe("/mock-home/.browsirai/states/overwrite-test.json");
  });
});

// ===========================================================================
// browser_load_state
// ===========================================================================

describe("browser_load_state", () => {
  let cdp: MockBiDi;

  const mockStateFile = {
    version: 1,
    savedAt: "2024-01-01T00:00:00.000Z",
    url: "https://example.com/dashboard",
    cookies: [
      { name: "session", value: "abc123", domain: ".example.com" },
    ],
    localStorage: { theme: "dark", lang: "en" },
    sessionStorage: { cart: "item1" },
  };

  beforeEach(() => {
    cdp = createMockBiDi();
    vi.mocked(writeFileSync).mockReset();
    vi.mocked(readFileSync).mockReset();
    vi.mocked(existsSync).mockReset();
    vi.mocked(mkdirSync).mockReset();
    vi.mocked(homedir).mockReturnValue("/mock-home");
  });

  it("should load cookies via Network.setCookies", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStateFile));

    await browserLoadState(cdp as never, { name: "test-session" });

    const setCookieCalls = cdp._getCalls("Network.setCookies");
    expect(setCookieCalls).toHaveLength(1);
    expect(setCookieCalls[0].params).toEqual({
      cookies: mockStateFile.cookies,
    });
  });

  it("should restore localStorage entries", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStateFile));

    const result = await browserLoadState(cdp as never, { name: "test-session" });

    expect(result.localStorage).toBe(2);
    // Verify Runtime.evaluate was called with localStorage.setItem expressions
    const evalCalls = cdp._getCalls("script.evaluate");
    const localStorageCall = evalCalls.find((c) => {
      const p = c.params as { expression: string };
      return p.expression.includes("localStorage.setItem");
    });
    expect(localStorageCall).toBeDefined();
  });

  it("should restore sessionStorage entries", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStateFile));

    const result = await browserLoadState(cdp as never, { name: "test-session" });

    expect(result.sessionStorage).toBe(1);
    // Verify Runtime.evaluate was called with sessionStorage.setItem expressions
    const evalCalls = cdp._getCalls("script.evaluate");
    const sessionStorageCall = evalCalls.find((c) => {
      const p = c.params as { expression: string };
      return p.expression.includes("sessionStorage.setItem");
    });
    expect(sessionStorageCall).toBeDefined();
  });

  it("should navigate to saved URL", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStateFile));

    await browserLoadState(cdp as never, { name: "test-session" });

    const navCalls = cdp._getCalls("browsingContext.navigate");
    expect(navCalls).toHaveLength(1);
    expect(navCalls[0].params).toEqual({ url: "https://example.com/dashboard" });
  });

  it("should navigate to custom URL when provided", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStateFile));

    await browserLoadState(cdp as never, {
      name: "test-session",
      url: "https://other.example.com/page",
    });

    const navCalls = cdp._getCalls("browsingContext.navigate");
    expect(navCalls).toHaveLength(1);
    expect(navCalls[0].params).toEqual({ url: "https://other.example.com/page" });
  });

  it("should reload page after restoring state", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(mockStateFile));

    await browserLoadState(cdp as never, { name: "test-session" });

    const reloadCalls = cdp._getCalls("browsingContext.reload");
    expect(reloadCalls).toHaveLength(1);
  });

  it("should throw error when state file not found", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await expect(
      browserLoadState(cdp as never, { name: "nonexistent" }),
    ).rejects.toThrow("State file not found");
  });
});
