/**
 * TDD tests for foxbrowser utility modules.
 *
 * Covers:
 * - Secret Redaction (src/redactor.ts)
 * - Event Ring Buffer (src/event-buffer.ts)
 * - LLM Output Formatter (src/formatters/llm.ts)
 * - console.table → Markdown (src/formatters/table.ts)
 *
 * RED phase: Source modules do not exist yet — implementations will follow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// TDD imports — these modules will be created during implementation
// ---------------------------------------------------------------------------
import {
  redactHeaders,
  redactBody,
  redactInlineSecrets,
  redactNetworkEvent,
} from "../src/redactor";

import { EventBuffer } from "../src/event-buffer";

import {
  stripAnsi,
  formatForLLM,
  formatBatchForLLM,
} from "../src/formatters/llm";

import {
  toMarkdownTable,
  detectConsoleTable,
  formatConsoleTable,
} from "../src/formatters/table";

// ===========================================================================
// Feature 1: Secret Redaction (src/redactor.ts)
// ===========================================================================

describe("Secret Redaction (src/redactor.ts)", () => {
  // -------------------------------------------------------------------------
  // redactHeaders
  // -------------------------------------------------------------------------
  describe("redactHeaders", () => {
    it("should redact Authorization header value", () => {
      const headers = { Authorization: "Bearer my-secret-token" };
      const result = redactHeaders(headers);
      expect(result.Authorization).toBe("[REDACTED]");
    });

    it("should redact Cookie header value", () => {
      const headers = { Cookie: "session=abc123; user=admin" };
      const result = redactHeaders(headers);
      expect(result.Cookie).toBe("[REDACTED]");
    });

    it("should redact Set-Cookie header value", () => {
      const headers = { "Set-Cookie": "session=xyz; HttpOnly; Secure" };
      const result = redactHeaders(headers);
      expect(result["Set-Cookie"]).toBe("[REDACTED]");
    });

    it("should redact x-api-key header value", () => {
      const headers = { "x-api-key": "sk-abc123def456" };
      const result = redactHeaders(headers);
      expect(result["x-api-key"]).toBe("[REDACTED]");
    });

    it("should redact x-auth-token header value", () => {
      const headers = { "x-auth-token": "some-auth-token" };
      const result = redactHeaders(headers);
      expect(result["x-auth-token"]).toBe("[REDACTED]");
    });

    it("should redact x-csrf-token header value", () => {
      const headers = { "x-csrf-token": "csrf-value-here" };
      const result = redactHeaders(headers);
      expect(result["x-csrf-token"]).toBe("[REDACTED]");
    });

    it("should redact x-xsrf-token header value", () => {
      const headers = { "x-xsrf-token": "xsrf-value-here" };
      const result = redactHeaders(headers);
      expect(result["x-xsrf-token"]).toBe("[REDACTED]");
    });

    it("should redact proxy-authorization header value", () => {
      const headers = { "proxy-authorization": "Basic abc123" };
      const result = redactHeaders(headers);
      expect(result["proxy-authorization"]).toBe("[REDACTED]");
    });

    it("should redact x-access-token header value", () => {
      const headers = { "x-access-token": "access-tok-123" };
      const result = redactHeaders(headers);
      expect(result["x-access-token"]).toBe("[REDACTED]");
    });

    it("should redact x-refresh-token header value", () => {
      const headers = { "x-refresh-token": "refresh-tok-456" };
      const result = redactHeaders(headers);
      expect(result["x-refresh-token"]).toBe("[REDACTED]");
    });

    it("should redact x-secret header value", () => {
      const headers = { "x-secret": "super-secret-value" };
      const result = redactHeaders(headers);
      expect(result["x-secret"]).toBe("[REDACTED]");
    });

    it("should redact x-token header value", () => {
      const headers = { "x-token": "my-token-value" };
      const result = redactHeaders(headers);
      expect(result["x-token"]).toBe("[REDACTED]");
    });

    it("should be case-insensitive for header names", () => {
      const headers = {
        AUTHORIZATION: "Bearer secret",
        "X-API-KEY": "key-123",
        "x-Auth-Token": "tok-456",
      };
      const result = redactHeaders(headers);
      expect(result.AUTHORIZATION).toBe("[REDACTED]");
      expect(result["X-API-KEY"]).toBe("[REDACTED]");
      expect(result["x-Auth-Token"]).toBe("[REDACTED]");
    });

    it("should preserve non-sensitive header values (Content-Type, Accept, etc.)", () => {
      const headers = {
        "Content-Type": "application/json",
        Accept: "text/html",
        "Cache-Control": "no-cache",
        "User-Agent": "Mozilla/5.0",
      };
      const result = redactHeaders(headers);
      expect(result["Content-Type"]).toBe("application/json");
      expect(result.Accept).toBe("text/html");
      expect(result["Cache-Control"]).toBe("no-cache");
      expect(result["User-Agent"]).toBe("Mozilla/5.0");
    });

    it("should return empty object for empty headers", () => {
      const result = redactHeaders({});
      expect(result).toEqual({});
    });

    it("should handle undefined/null header values gracefully", () => {
      const headers = {
        Authorization: undefined as unknown as string,
        "Content-Type": "text/plain",
        Cookie: null as unknown as string,
      };
      const result = redactHeaders(headers);
      // Sensitive headers with undefined/null should still be redacted
      expect(result.Authorization).toBe("[REDACTED]");
      expect(result.Cookie).toBe("[REDACTED]");
      expect(result["Content-Type"]).toBe("text/plain");
    });

    it('should replace with "[REDACTED]" string', () => {
      const headers = { Authorization: "Bearer xyz" };
      const result = redactHeaders(headers);
      expect(result.Authorization).toBe("[REDACTED]");
      expect(typeof result.Authorization).toBe("string");
    });

    it("should not redact when enabled=false", () => {
      const headers = { Authorization: "Bearer keep-me" };
      const result = redactHeaders(headers, { enabled: false });
      expect(result.Authorization).toBe("Bearer keep-me");
    });
  });

  // -------------------------------------------------------------------------
  // redactBody
  // -------------------------------------------------------------------------
  describe("redactBody", () => {
    it('should redact "password" field in JSON body', () => {
      const body = JSON.stringify({ username: "admin", password: "s3cret" });
      const result = redactBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.password).toBe("[REDACTED]");
      expect(parsed.username).toBe("admin");
    });

    it('should redact "secret" field in JSON body', () => {
      const body = JSON.stringify({ secret: "my-secret", data: "ok" });
      const result = redactBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.secret).toBe("[REDACTED]");
      expect(parsed.data).toBe("ok");
    });

    it('should redact "token" field in JSON body', () => {
      const body = JSON.stringify({ token: "abc123", type: "auth" });
      const result = redactBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.token).toBe("[REDACTED]");
    });

    it('should redact "api_key" field in JSON body', () => {
      const body = JSON.stringify({ api_key: "key-abc", endpoint: "/v1" });
      const result = redactBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.api_key).toBe("[REDACTED]");
    });

    it('should redact "apiKey" field in JSON body (camelCase)', () => {
      const body = JSON.stringify({ apiKey: "key-def" });
      const result = redactBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.apiKey).toBe("[REDACTED]");
    });

    it('should redact "api-key" field in JSON body (kebab-case)', () => {
      const body = JSON.stringify({ "api-key": "key-ghi" });
      const result = redactBody(body);
      const parsed = JSON.parse(result);
      expect(parsed["api-key"]).toBe("[REDACTED]");
    });

    it('should redact "access_token" field in JSON body', () => {
      const body = JSON.stringify({ access_token: "at-123" });
      const result = redactBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.access_token).toBe("[REDACTED]");
    });

    it('should redact "refresh_token" field in JSON body', () => {
      const body = JSON.stringify({ refresh_token: "rt-456" });
      const result = redactBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.refresh_token).toBe("[REDACTED]");
    });

    it('should redact "client_secret" field in JSON body', () => {
      const body = JSON.stringify({ client_secret: "cs-789" });
      const result = redactBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.client_secret).toBe("[REDACTED]");
    });

    it('should redact "private_key" field in JSON body', () => {
      const body = JSON.stringify({ private_key: "-----BEGIN RSA-----" });
      const result = redactBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.private_key).toBe("[REDACTED]");
    });

    it("should preserve non-sensitive fields", () => {
      const body = JSON.stringify({
        username: "admin",
        email: "a@b.com",
        role: "user",
      });
      const result = redactBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.username).toBe("admin");
      expect(parsed.email).toBe("a@b.com");
      expect(parsed.role).toBe("user");
    });

    it("should handle nested JSON objects", () => {
      const body = JSON.stringify({
        user: { name: "test", credentials: { password: "hidden", token: "tok" } },
        meta: { version: 1 },
      });
      const result = redactBody(body);
      const parsed = JSON.parse(result);
      expect(parsed.user.credentials.password).toBe("[REDACTED]");
      expect(parsed.user.credentials.token).toBe("[REDACTED]");
      expect(parsed.user.name).toBe("test");
      expect(parsed.meta.version).toBe(1);
    });

    it("should return non-JSON body as-is", () => {
      const body = "this is plain text, not JSON";
      const result = redactBody(body);
      expect(result).toBe(body);
    });

    it("should not redact when enabled=false", () => {
      const body = JSON.stringify({ password: "keep-me" });
      const result = redactBody(body, { enabled: false });
      const parsed = JSON.parse(result);
      expect(parsed.password).toBe("keep-me");
    });
  });

  // -------------------------------------------------------------------------
  // redactInlineSecrets
  // -------------------------------------------------------------------------
  describe("redactInlineSecrets", () => {
    it("should redact JWT tokens (eyJ... pattern)", () => {
      const input = "Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const result = redactInlineSecrets(input);
      expect(result).toContain("[REDACTED_JWT]");
      expect(result).not.toContain("eyJhbGci");
    });

    it("should redact Bearer tokens", () => {
      const input = "Authorization: Bearer my-secret-bearer-token-value";
      const result = redactInlineSecrets(input);
      expect(result).toContain("Bearer [REDACTED]");
      expect(result).not.toContain("my-secret-bearer-token-value");
    });

    it("should redact multiple JWTs in same string", () => {
      const jwt1 = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123";
      const jwt2 = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIyIn0.def456";
      const input = `First: ${jwt1} and Second: ${jwt2}`;
      const result = redactInlineSecrets(input);
      expect(result).not.toContain("eyJhbGci");
      const jwtCount = (result.match(/\[REDACTED_JWT\]/g) || []).length;
      expect(jwtCount).toBe(2);
    });

    it('should replace JWT with "[REDACTED_JWT]"', () => {
      const input = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature";
      const result = redactInlineSecrets(input);
      expect(result).toBe("[REDACTED_JWT]");
    });

    it('should replace Bearer with "Bearer [REDACTED]"', () => {
      const input = "Bearer abc123def456";
      const result = redactInlineSecrets(input);
      expect(result).toBe("Bearer [REDACTED]");
    });

    it("should be case-insensitive for Bearer", () => {
      const input = "bearer my-token-value";
      const result = redactInlineSecrets(input);
      expect(result.toLowerCase()).toContain("bearer [redacted]");
      expect(result).not.toContain("my-token-value");
    });

    it("should preserve non-sensitive strings", () => {
      const input = "Hello world, nothing secret here";
      const result = redactInlineSecrets(input);
      expect(result).toBe(input);
    });

    it("should handle empty string", () => {
      const result = redactInlineSecrets("");
      expect(result).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // redactNetworkEvent
  // -------------------------------------------------------------------------
  describe("redactNetworkEvent", () => {
    it("should redact headers AND body in a network event object", () => {
      const event = {
        url: "https://api.example.com/login",
        method: "POST",
        headers: {
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: "admin", password: "s3cret" }),
      };
      const result = redactNetworkEvent(event);
      expect(result.headers.Authorization).toBe("[REDACTED]");
      expect(result.headers["Content-Type"]).toBe("application/json");
      const parsedBody = JSON.parse(result.body);
      expect(parsedBody.password).toBe("[REDACTED]");
      expect(parsedBody.username).toBe("admin");
      expect(result.url).toBe("https://api.example.com/login");
    });

    it("should integrate with browserNetworkRequests output format", () => {
      const event = {
        url: "https://api.example.com/data",
        method: "GET",
        status: 200,
        headers: { "x-api-key": "sk-12345" },
        responseHeaders: { "Set-Cookie": "session=abc" },
        body: "",
      };
      const result = redactNetworkEvent(event);
      expect(result.headers["x-api-key"]).toBe("[REDACTED]");
      expect(result.responseHeaders["Set-Cookie"]).toBe("[REDACTED]");
      expect(result.url).toBe("https://api.example.com/data");
      expect(result.status).toBe(200);
    });

    it("should handle events with no headers", () => {
      const event = {
        url: "https://example.com",
        method: "GET",
        body: JSON.stringify({ token: "abc" }),
      };
      const result = redactNetworkEvent(event);
      const parsedBody = JSON.parse(result.body);
      expect(parsedBody.token).toBe("[REDACTED]");
    });

    it("should handle events with no body", () => {
      const event = {
        url: "https://example.com",
        method: "GET",
        headers: { Authorization: "Bearer xyz" },
      };
      const result = redactNetworkEvent(event);
      expect(result.headers.Authorization).toBe("[REDACTED]");
      expect(result.body).toBeUndefined();
    });
  });
});

// ===========================================================================
// Feature 2: Event Ring Buffer (src/event-buffer.ts)
// ===========================================================================

describe("Event Ring Buffer (src/event-buffer.ts)", () => {
  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------
  describe("EventBuffer constructor", () => {
    it("should create buffer with default capacity (500)", () => {
      const buffer = new EventBuffer();
      expect(buffer.stats.capacity).toBe(500);
    });

    it("should create buffer with custom capacity", () => {
      const buffer = new EventBuffer(100);
      expect(buffer.stats.capacity).toBe(100);
    });

    it("should start empty (size = 0)", () => {
      const buffer = new EventBuffer();
      expect(buffer.stats.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // push
  // -------------------------------------------------------------------------
  describe("push", () => {
    let buffer: InstanceType<typeof EventBuffer>;

    beforeEach(() => {
      buffer = new EventBuffer(5);
    });

    it("should add events to buffer", () => {
      buffer.push({ type: "console", message: "hello" });
      expect(buffer.stats.size).toBe(1);
    });

    it("should track size correctly", () => {
      buffer.push({ type: "console", message: "1" });
      buffer.push({ type: "console", message: "2" });
      buffer.push({ type: "console", message: "3" });
      expect(buffer.stats.size).toBe(3);
    });

    it("should evict oldest when capacity reached", () => {
      for (let i = 0; i < 7; i++) {
        buffer.push({ type: "console", message: `msg-${i}` });
      }
      expect(buffer.stats.size).toBe(5);
      const events = buffer.last();
      expect(events[0].message).toBe("msg-2");
      expect(events[4].message).toBe("msg-6");
    });

    it("should handle single-capacity buffer", () => {
      const tiny = new EventBuffer(1);
      tiny.push({ type: "console", message: "first" });
      tiny.push({ type: "console", message: "second" });
      expect(tiny.stats.size).toBe(1);
      const events = tiny.last();
      expect(events[0].message).toBe("second");
    });

    it("should accept any event type (console, network, custom)", () => {
      buffer.push({ type: "console", level: "log", message: "test" });
      buffer.push({ type: "network", url: "https://example.com", method: "GET" });
      buffer.push({ type: "custom", data: { foo: "bar" } });
      expect(buffer.stats.size).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // last(n)
  // -------------------------------------------------------------------------
  describe("last(n)", () => {
    let buffer: InstanceType<typeof EventBuffer>;

    beforeEach(() => {
      buffer = new EventBuffer(10);
      for (let i = 0; i < 5; i++) {
        buffer.push({ type: "console", message: `msg-${i}` });
      }
    });

    it("should return last N events", () => {
      const events = buffer.last(3);
      expect(events).toHaveLength(3);
      expect(events[0].message).toBe("msg-2");
      expect(events[1].message).toBe("msg-3");
      expect(events[2].message).toBe("msg-4");
    });

    it("should return all events if n > size", () => {
      const events = buffer.last(100);
      expect(events).toHaveLength(5);
    });

    it("should return empty array if buffer is empty", () => {
      const empty = new EventBuffer(10);
      const events = empty.last(5);
      expect(events).toEqual([]);
    });

    it("should return events in chronological order", () => {
      const events = buffer.last(5);
      for (let i = 0; i < events.length; i++) {
        expect(events[i].message).toBe(`msg-${i}`);
      }
    });

    it("should default to returning all events when n is omitted", () => {
      const events = buffer.last();
      expect(events).toHaveLength(5);
    });

    it("should work correctly after wrap-around (circular behavior)", () => {
      const small = new EventBuffer(3);
      small.push({ type: "console", message: "a" });
      small.push({ type: "console", message: "b" });
      small.push({ type: "console", message: "c" });
      small.push({ type: "console", message: "d" });
      small.push({ type: "console", message: "e" });

      const events = small.last();
      expect(events).toHaveLength(3);
      expect(events[0].message).toBe("c");
      expect(events[1].message).toBe("d");
      expect(events[2].message).toBe("e");
    });
  });

  // -------------------------------------------------------------------------
  // clear()
  // -------------------------------------------------------------------------
  describe("clear()", () => {
    it("should remove all events", () => {
      const buffer = new EventBuffer(10);
      buffer.push({ type: "console", message: "a" });
      buffer.push({ type: "console", message: "b" });
      buffer.clear();
      expect(buffer.last()).toEqual([]);
    });

    it("should reset size to 0", () => {
      const buffer = new EventBuffer(10);
      buffer.push({ type: "console", message: "a" });
      buffer.clear();
      expect(buffer.stats.size).toBe(0);
    });

    it("should allow new events after clear", () => {
      const buffer = new EventBuffer(10);
      buffer.push({ type: "console", message: "before" });
      buffer.clear();
      buffer.push({ type: "console", message: "after" });
      expect(buffer.stats.size).toBe(1);
      expect(buffer.last()[0].message).toBe("after");
    });

    it("should not affect capacity", () => {
      const buffer = new EventBuffer(42);
      buffer.push({ type: "console", message: "a" });
      buffer.clear();
      expect(buffer.stats.capacity).toBe(42);
    });
  });

  // -------------------------------------------------------------------------
  // drain(n)
  // -------------------------------------------------------------------------
  describe("drain(n)", () => {
    it("should return last N events AND clear them", () => {
      const buffer = new EventBuffer(10);
      buffer.push({ type: "console", message: "a" });
      buffer.push({ type: "console", message: "b" });
      buffer.push({ type: "console", message: "c" });

      const drained = buffer.drain(2);
      expect(drained).toHaveLength(2);
      expect(drained[0].message).toBe("b");
      expect(drained[1].message).toBe("c");
      expect(buffer.stats.size).toBe(0);
    });

    it("should drain all if n is omitted", () => {
      const buffer = new EventBuffer(10);
      buffer.push({ type: "console", message: "a" });
      buffer.push({ type: "console", message: "b" });

      const drained = buffer.drain();
      expect(drained).toHaveLength(2);
      expect(buffer.stats.size).toBe(0);
    });

    it("should return empty array on empty buffer", () => {
      const buffer = new EventBuffer(10);
      const drained = buffer.drain();
      expect(drained).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // stats
  // -------------------------------------------------------------------------
  describe("stats", () => {
    it("should return size, capacity, and totalPushed", () => {
      const buffer = new EventBuffer(10);
      buffer.push({ type: "console", message: "a" });
      const { size, capacity, totalPushed } = buffer.stats;
      expect(size).toBe(1);
      expect(capacity).toBe(10);
      expect(totalPushed).toBe(1);
    });

    it("should track totalPushed even after evictions", () => {
      const buffer = new EventBuffer(3);
      for (let i = 0; i < 10; i++) {
        buffer.push({ type: "console", message: `msg-${i}` });
      }
      expect(buffer.stats.totalPushed).toBe(10);
      expect(buffer.stats.size).toBe(3);
    });

    it("should track evicted count (totalPushed - size when > capacity)", () => {
      const buffer = new EventBuffer(3);
      for (let i = 0; i < 10; i++) {
        buffer.push({ type: "console", message: `msg-${i}` });
      }
      const evicted = buffer.stats.totalPushed - buffer.stats.size;
      expect(evicted).toBe(7);
    });
  });

  // -------------------------------------------------------------------------
  // filter
  // -------------------------------------------------------------------------
  describe("filter", () => {
    let buffer: InstanceType<typeof EventBuffer>;

    beforeEach(() => {
      buffer = new EventBuffer(20);
      buffer.push({ type: "console", level: "log", message: "log1" });
      buffer.push({ type: "network", url: "https://a.com", method: "GET" });
      buffer.push({ type: "console", level: "error", message: "err1" });
      buffer.push({ type: "network", url: "https://b.com", method: "POST" });
      buffer.push({ type: "console", level: "log", message: "log2" });
    });

    it('should filter events by type (e.g., "console" vs "network")', () => {
      const consoleEvents = buffer.filter((e: Record<string, unknown>) => e.type === "console");
      expect(consoleEvents).toHaveLength(3);
      consoleEvents.forEach((e: Record<string, unknown>) => expect(e.type).toBe("console"));

      const networkEvents = buffer.filter((e: Record<string, unknown>) => e.type === "network");
      expect(networkEvents).toHaveLength(2);
      networkEvents.forEach((e: Record<string, unknown>) => expect(e.type).toBe("network"));
    });

    it("should filter events by predicate function", () => {
      const errors = buffer.filter(
        (e: Record<string, unknown>) => e.type === "console" && e.level === "error"
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe("err1");
    });

    it("should not modify original buffer", () => {
      buffer.filter((e: Record<string, unknown>) => e.type === "console");
      expect(buffer.stats.size).toBe(5);
    });
  });
});

// ===========================================================================
// Feature 3: LLM Output Formatter (src/formatters/llm.ts)
// ===========================================================================

describe("LLM Output Formatter (src/formatters/llm.ts)", () => {
  // -------------------------------------------------------------------------
  // stripAnsi
  // -------------------------------------------------------------------------
  describe("stripAnsi", () => {
    it("should remove ANSI color codes", () => {
      const input = "\u001B[31mRed text\u001B[0m";
      expect(stripAnsi(input)).toBe("Red text");
    });

    it("should remove ANSI bold/underline codes", () => {
      const input = "\u001B[1mBold\u001B[0m and \u001B[4mUnderline\u001B[0m";
      expect(stripAnsi(input)).toBe("Bold and Underline");
    });

    it("should remove ANSI reset codes", () => {
      const input = "text\u001B[0m";
      expect(stripAnsi(input)).toBe("text");
    });

    it("should preserve plain text", () => {
      const input = "Hello, world!";
      expect(stripAnsi(input)).toBe("Hello, world!");
    });

    it("should handle empty string", () => {
      expect(stripAnsi("")).toBe("");
    });

    it("should handle string with no ANSI codes", () => {
      const input = "No special formatting here.";
      expect(stripAnsi(input)).toBe(input);
    });
  });

  // -------------------------------------------------------------------------
  // formatForLLM
  // -------------------------------------------------------------------------
  describe("formatForLLM", () => {
    it("should format console log as markdown", () => {
      const event = {
        type: "console" as const,
        level: "log",
        message: "Application started",
        timestamp: "2026-03-13T10:00:00.000Z",
      };
      const result = formatForLLM(event);
      expect(result).toContain("Application started");
      expect(result).not.toMatch(/\u001B/);
    });

    it("should format console error with error prefix", () => {
      const event = {
        type: "console" as const,
        level: "error",
        message: "Something went wrong",
        timestamp: "2026-03-13T10:00:00.000Z",
      };
      const result = formatForLLM(event);
      expect(result).toMatch(/error/i);
      expect(result).toContain("Something went wrong");
    });

    it("should format console warn with warning prefix", () => {
      const event = {
        type: "console" as const,
        level: "warn",
        message: "Deprecated API usage",
        timestamp: "2026-03-13T10:00:00.000Z",
      };
      const result = formatForLLM(event);
      expect(result).toMatch(/warn/i);
      expect(result).toContain("Deprecated API usage");
    });

    it("should format network request as markdown", () => {
      const event = {
        type: "network" as const,
        direction: "request",
        method: "POST",
        url: "https://api.example.com/data",
        timestamp: "2026-03-13T10:00:00.000Z",
      };
      const result = formatForLLM(event);
      expect(result).toContain("POST");
      expect(result).toContain("https://api.example.com/data");
    });

    it("should format network response with status code", () => {
      const event = {
        type: "network" as const,
        direction: "response",
        method: "GET",
        url: "https://api.example.com/data",
        status: 200,
        timestamp: "2026-03-13T10:00:00.000Z",
      };
      const result = formatForLLM(event);
      expect(result).toContain("200");
    });

    it("should include timestamp in ISO format", () => {
      const event = {
        type: "console" as const,
        level: "log",
        message: "test",
        timestamp: "2026-03-13T10:00:00.000Z",
      };
      const result = formatForLLM(event);
      expect(result).toContain("2026-03-13T10:00:00.000Z");
    });

    it("should escape markdown special characters in content", () => {
      const event = {
        type: "console" as const,
        level: "log",
        message: "Value is *important* and `code` with | pipe",
        timestamp: "2026-03-13T10:00:00.000Z",
      };
      const result = formatForLLM(event);
      // The output should be valid markdown — special chars should be escaped
      expect(result).not.toContain("*important*");
    });

    it("should handle multi-line content with code blocks", () => {
      const event = {
        type: "console" as const,
        level: "log",
        message: "Line 1\nLine 2\nLine 3",
        timestamp: "2026-03-13T10:00:00.000Z",
      };
      const result = formatForLLM(event);
      expect(result).toContain("```");
      expect(result).toContain("Line 1");
      expect(result).toContain("Line 3");
    });

    it("should produce valid markdown output (no raw ANSI)", () => {
      const event = {
        type: "console" as const,
        level: "log",
        message: "\u001B[32mGreen text\u001B[0m",
        timestamp: "2026-03-13T10:00:00.000Z",
      };
      const result = formatForLLM(event);
      expect(result).not.toMatch(/\u001B/);
      expect(result).toContain("Green text");
    });
  });

  // -------------------------------------------------------------------------
  // formatBatchForLLM
  // -------------------------------------------------------------------------
  describe("formatBatchForLLM", () => {
    it("should format multiple events as markdown sections", () => {
      const events = [
        { type: "console" as const, level: "log", message: "First", timestamp: "2026-03-13T10:00:00.000Z" },
        { type: "console" as const, level: "error", message: "Second", timestamp: "2026-03-13T10:00:01.000Z" },
      ];
      const result = formatBatchForLLM(events);
      expect(result).toContain("First");
      expect(result).toContain("Second");
    });

    it("should separate events with horizontal rules", () => {
      const events = [
        { type: "console" as const, level: "log", message: "A", timestamp: "2026-03-13T10:00:00.000Z" },
        { type: "console" as const, level: "log", message: "B", timestamp: "2026-03-13T10:00:01.000Z" },
      ];
      const result = formatBatchForLLM(events);
      expect(result).toContain("---");
    });

    it("should include event count header", () => {
      const events = [
        { type: "console" as const, level: "log", message: "A", timestamp: "2026-03-13T10:00:00.000Z" },
        { type: "console" as const, level: "log", message: "B", timestamp: "2026-03-13T10:00:01.000Z" },
        { type: "console" as const, level: "log", message: "C", timestamp: "2026-03-13T10:00:02.000Z" },
      ];
      const result = formatBatchForLLM(events);
      expect(result).toContain("3");
    });

    it("should handle empty event list", () => {
      const result = formatBatchForLLM([]);
      expect(result).toBe("");
    });

    it("should handle mixed event types (console + network)", () => {
      const events = [
        { type: "console" as const, level: "log", message: "Log msg", timestamp: "2026-03-13T10:00:00.000Z" },
        { type: "network" as const, direction: "request", method: "GET", url: "https://example.com", timestamp: "2026-03-13T10:00:01.000Z" },
      ];
      const result = formatBatchForLLM(events);
      expect(result).toContain("Log msg");
      expect(result).toContain("GET");
      expect(result).toContain("https://example.com");
    });
  });
});

// ===========================================================================
// Feature 4: console.table → Markdown (src/formatters/table.ts)
// ===========================================================================

describe("console.table to Markdown (src/formatters/table.ts)", () => {
  // -------------------------------------------------------------------------
  // toMarkdownTable
  // -------------------------------------------------------------------------
  describe("toMarkdownTable", () => {
    it("should convert array of objects to markdown table", () => {
      const data = [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ];
      const result = toMarkdownTable(data);
      expect(result).toContain("| name | age |");
      expect(result).toContain("| --- | --- |");
      expect(result).toContain("| Alice | 30 |");
      expect(result).toContain("| Bob | 25 |");
    });

    it("should handle empty array → empty string", () => {
      const result = toMarkdownTable([]);
      expect(result).toBe("");
    });

    it("should use object keys as column headers", () => {
      const data = [{ firstName: "John", lastName: "Doe", email: "j@d.com" }];
      const result = toMarkdownTable(data);
      expect(result).toContain("firstName");
      expect(result).toContain("lastName");
      expect(result).toContain("email");
    });

    it("should handle mixed value types (string, number, boolean, null)", () => {
      const data = [{ str: "hello", num: 42, bool: true, nil: null }];
      const result = toMarkdownTable(data);
      expect(result).toContain("hello");
      expect(result).toContain("42");
      expect(result).toContain("true");
      expect(result).toContain("null");
    });

    it("should escape pipe characters in cell values", () => {
      const data = [{ cmd: "a | b", desc: "pipe test" }];
      const result = toMarkdownTable(data);
      expect(result).toContain("a \\| b");
    });

    it("should handle objects with different keys (union of all keys)", () => {
      const data = [
        { a: 1, b: 2 },
        { b: 3, c: 4 },
      ];
      const result = toMarkdownTable(data);
      expect(result).toContain("a");
      expect(result).toContain("b");
      expect(result).toContain("c");
    });

    it("should align separator row with dashes", () => {
      const data = [{ x: 1 }];
      const result = toMarkdownTable(data);
      const lines = result.split("\n");
      const separatorLine = lines[1];
      expect(separatorLine).toMatch(/^\|[\s-]+\|$/);
    });

    it("should handle single-row data", () => {
      const data = [{ item: "only-one" }];
      const result = toMarkdownTable(data);
      const lines = result.trim().split("\n");
      expect(lines).toHaveLength(3); // header + separator + data row
    });

    it("should handle single-column data", () => {
      const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const result = toMarkdownTable(data);
      expect(result).toContain("| id |");
      expect(result).toContain("| 1 |");
      expect(result).toContain("| 2 |");
      expect(result).toContain("| 3 |");
    });

    it("should convert primitive array to single-column table (Index, Value)", () => {
      const data = ["apple", "banana", "cherry"];
      const result = toMarkdownTable(data);
      expect(result).toContain("Index");
      expect(result).toContain("Value");
      expect(result).toContain("apple");
      expect(result).toContain("banana");
      expect(result).toContain("cherry");
    });
  });

  // -------------------------------------------------------------------------
  // detectConsoleTable
  // -------------------------------------------------------------------------
  describe("detectConsoleTable", () => {
    it("should detect console.table call in log message", () => {
      const result = detectConsoleTable("console.table([{a:1}])");
      expect(result).toBe(true);
    });

    it("should return false for regular console.log", () => {
      const result = detectConsoleTable("console.log('hello')");
      expect(result).toBe(false);
    });

    it("should extract tabular data from console.table argument", () => {
      const data = [{ name: "test", value: 42 }];
      const message = JSON.stringify(data);
      const result = detectConsoleTable(message, data);
      expect(result).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // formatConsoleTable
  // -------------------------------------------------------------------------
  describe("formatConsoleTable", () => {
    it("should format console.table output as markdown table", () => {
      const data = [
        { name: "Alice", score: 95 },
        { name: "Bob", score: 88 },
      ];
      const result = formatConsoleTable(data);
      expect(result).toContain("| name | score |");
      expect(result).toContain("| Alice | 95 |");
    });

    it("should handle nested objects (flatten first level)", () => {
      const data = [
        { user: { name: "Alice" }, role: "admin" },
      ];
      const result = formatConsoleTable(data);
      expect(result).toContain("user");
      expect(result).toContain("role");
      // Nested object should be stringified or flattened
      expect(result).toBeDefined();
    });

    it("should handle array of arrays", () => {
      const data = [
        [1, 2, 3],
        [4, 5, 6],
      ];
      const result = formatConsoleTable(data);
      expect(result).toContain("1");
      expect(result).toContain("6");
    });

    it('should add "(Index)" column header for indexed data', () => {
      const data = [
        { name: "Alice" },
        { name: "Bob" },
      ];
      const result = formatConsoleTable(data);
      expect(result).toContain("(Index)");
    });

    it("should truncate tables with more than 100 rows", () => {
      const data = Array.from({ length: 150 }, (_, i) => ({ id: i, value: `v${i}` }));
      const result = formatConsoleTable(data);
      // Should contain indication of truncation
      const lines = result.split("\n").filter((l) => l.includes("|"));
      // header + separator + 100 data rows = 102 lines with pipes
      expect(lines.length).toBeLessThanOrEqual(102);
    });

    it('should indicate truncation with "... N more rows" footer', () => {
      const data = Array.from({ length: 150 }, (_, i) => ({ id: i }));
      const result = formatConsoleTable(data);
      expect(result).toContain("50 more rows");
    });
  });
});
