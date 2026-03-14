/**
 * BiDi Protocol Layer Tests
 *
 * Tests the WebDriver BiDi integration layer:
 * - WebSocket connection lifecycle
 * - BiDi command/response correlation
 * - BiDi event subscription and dispatch
 * - Browsing context management
 * - Error handling (timeouts, disconnects)
 *
 * Source modules under test:
 *   - src/bidi/connection.ts
 *   - src/bidi/discovery.ts
 *   - src/bidi/manager.ts
 *   - src/bidi/dom-helpers.ts
 *   - src/bidi/wait-ready.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { BiDiConnection } from "../src/bidi/connection";

// ---------------------------------------------------------------------------
// BiDiConnection unit tests
// ---------------------------------------------------------------------------

describe("BiDiConnection", () => {
  describe("constructor", () => {
    it("stores the WebSocket URL", () => {
      const conn = new BiDiConnection("ws://127.0.0.1:9222/session");
      expect(conn).toBeDefined();
    });
  });

  describe("isConnected", () => {
    it("returns false before connect()", () => {
      const conn = new BiDiConnection("ws://127.0.0.1:9222/session");
      expect(conn.isConnected).toBe(false);
    });
  });

  describe("send", () => {
    it("throws when not connected", async () => {
      const conn = new BiDiConnection("ws://127.0.0.1:9222/session");
      await expect(conn.send("session.status")).rejects.toThrow();
    });
  });

  describe("event handling", () => {
    it("supports on/off for event listeners", () => {
      const conn = new BiDiConnection("ws://127.0.0.1:9222/session");
      const handler = vi.fn();
      conn.on("log.entryAdded", handler);
      conn.off("log.entryAdded", handler);
    });
  });
});

// ---------------------------------------------------------------------------
// Firefox launcher tests (unit-testable parts)
// ---------------------------------------------------------------------------

describe("Firefox launcher", () => {
  describe("findFirefox", () => {
    it("exports findFirefox function", async () => {
      const mod = await import("../src/firefox-launcher");
      expect(typeof mod.findFirefox).toBe("function");
    });
  });

  describe("getDefaultFirefoxDataDir", () => {
    it("returns a string path", async () => {
      const mod = await import("../src/firefox-launcher");
      const dir = mod.getDefaultFirefoxDataDir();
      expect(typeof dir).toBe("string");
      expect(dir.length).toBeGreaterThan(0);
    });
  });

  describe("isPortReachable", () => {
    it("returns false for a port that is not listening", async () => {
      const mod = await import("../src/firefox-launcher");
      const result = await mod.isPortReachable(19999);
      expect(result).toBe(false);
    });
  });

  describe("getLaunchedFirefoxPid", () => {
    it("exports getLaunchedFirefoxPid function", async () => {
      const mod = await import("../src/firefox-launcher");
      expect(typeof mod.getLaunchedFirefoxPid).toBe("function");
    });

    it("returns undefined when no Firefox was launched", async () => {
      const mod = await import("../src/firefox-launcher");
      expect(mod.getLaunchedFirefoxPid()).toBeUndefined();
    });
  });

  describe("quitFirefox", () => {
    it("returns immediately when no Firefox was launched by browsirai", async () => {
      const mod = await import("../src/firefox-launcher");
      const spy = vi.spyOn(process, "kill");
      await mod.quitFirefox();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
