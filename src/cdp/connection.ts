/**
 * CDP Connection — WebSocket-based Chrome DevTools Protocol client.
 *
 * Handles JSON-RPC command/response correlation, CDP event dispatch,
 * timeouts, reconnection on crash, and clean shutdown.
 *
 * @module
 */

export { waitForDocumentReady } from "./wait-ready.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default command timeout in milliseconds. */
export const TIMEOUT = 15_000;

/** Navigation timeout in milliseconds. */
export const NAVIGATION_TIMEOUT = 30_000;

/** Idle timeout in milliseconds (20 minutes). */
export const IDLE_TIMEOUT = 1_200_000;

/** Maximum reconnection retries when connecting via daemon. */
export const DAEMON_CONNECT_RETRIES = 20;

/** Delay between daemon connection retries in milliseconds. */
export const DAEMON_CONNECT_DELAY = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for sending a CDP command. */
export interface CDPCommandOptions {
  /** Timeout in ms for this specific command. */
  timeout?: number;
  /** Session ID for target-scoped commands. */
  sessionId?: string;
}

/** Internal pending command tracker. */
interface PendingCommand {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  method: string;
  timer: ReturnType<typeof setTimeout>;
}

/** Shape of a parsed incoming CDP message. */
interface CDPMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

// ---------------------------------------------------------------------------
// Minimal WebSocket interface (Node.js 22 built-in + browser compatible)
// ---------------------------------------------------------------------------

interface MinimalWebSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(event: string, handler: (...args: unknown[]) => void): void;
  removeEventListener(event: string, handler: (...args: unknown[]) => void): void;
}

// ---------------------------------------------------------------------------
// CDPConnection
// ---------------------------------------------------------------------------

type EventHandler = (...args: unknown[]) => void;

/**
 * WebSocket-based CDP client.
 *
 * ```ts
 * const conn = new CDPConnection("ws://127.0.0.1:9222/devtools/browser/abc");
 * await conn.connect();
 * const result = await conn.send("Target.getTargets");
 * conn.close();
 * ```
 */
export class CDPConnection {
  private readonly wsUrl: string;
  private ws: MinimalWebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly eventHandlers = new Map<string, Set<EventHandler>>();
  private closed = false;
  private reconnecting = false;
  private _connected = false;

  // Bound listener references for cleanup
  private boundOnMessage: ((...args: unknown[]) => void) | null = null;
  private boundOnClose: ((...args: unknown[]) => void) | null = null;
  private boundOnError: ((...args: unknown[]) => void) | null = null;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Whether the underlying WebSocket is currently open. */
  get isConnected(): boolean {
    return this._connected;
  }

  /**
   * Open the WebSocket connection.
   * Resolves on the `open` event; rejects on `error`.
   */
  async connect(): Promise<void> {
    // Use native WebSocket (Node 22+) or fall back to `ws` package
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let WS = (globalThis as any).WebSocket;
    if (!WS) {
      try {
        // Dynamic import so it's not required when native WebSocket exists
        const wsModule = await import("ws");
        WS = wsModule.default ?? wsModule.WebSocket ?? wsModule;
      } catch {
        throw new Error(
          "No WebSocket implementation found. Install the `ws` package or use Node 22+."
        );
      }
    }
    const ws: MinimalWebSocket = new WS(this.wsUrl);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
        resolve();
      };

      const onError = (ev: unknown) => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
        const msg =
          (ev as { message?: string })?.message ?? "WebSocket error";
        reject(new Error(msg));
      };

      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
    });

    this._connected = true;
    this.attachListeners(ws);
  }

  /**
   * Send a CDP command and await its result.
   *
   * @param method  CDP method (e.g. `"Runtime.evaluate"`)
   * @param params  Optional method parameters
   * @param options Optional timeout / sessionId overrides
   */
  send(
    method: string,
    params?: Record<string, unknown>,
    options?: CDPCommandOptions,
  ): Promise<unknown> {
    if (this.closed || !this._connected || !this.ws) {
      return Promise.reject(
        new Error(`Connection closed — cannot send ${method}`),
      );
    }

    const id = this.nextId++;
    const timeout = options?.timeout ?? TIMEOUT;

    // Build the JSON-RPC message
    const message: Record<string, unknown> = { id, method };
    if (params !== undefined) {
      message.params = params;
    }
    if (options?.sessionId !== undefined) {
      message.sessionId = options.sessionId;
    }

    this.ws.send(JSON.stringify(message));

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timeout: ${method} (${timeout}ms)`));
      }, timeout);

      this.pending.set(id, { resolve, reject, method, timer });
    });
  }

  /**
   * Register an event handler for a CDP event or lifecycle event.
   *
   * CDP events are dispatched as `handler(params, { method })`.
   * Lifecycle events: `disconnected`, `browserCrashed`, `reconnected`,
   * `reconnectionFailed`.
   */
  on(event: string, handler: EventHandler): void {
    let handlers = this.eventHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(event, handlers);
    }
    handlers.add(handler);
  }

  /** Remove a previously registered event handler. */
  off(event: string, handler: EventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Close the connection. Suppresses reconnection.
   * Safe to call multiple times.
   */
  close(): void {
    this.closed = true;
    this._connected = false;

    this.rejectAllPending(new Error("Connection closed"));

    if (this.ws) {
      this.detachListeners(this.ws);
      try {
        this.ws.close();
      } catch {
        // Already closed or errored — ignore.
      }
      this.ws = null;
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /** Attach message / close / error listeners to the WebSocket. */
  private attachListeners(ws: MinimalWebSocket): void {
    this.boundOnMessage = (event: unknown) => {
      const data = (event as { data?: string })?.data;
      if (typeof data !== "string") return;

      let msg: CDPMessage;
      try {
        msg = JSON.parse(data) as CDPMessage;
      } catch {
        return;
      }

      // --- Command response (has `id`) ---
      if (msg.id !== undefined) {
        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.error) {
            entry.reject(new Error(msg.error.message));
          } else {
            entry.resolve(msg.result);
          }
        }
        return;
      }

      // --- CDP event (has `method`, no `id`) ---
      if (msg.method) {
        this.emit(msg.method, msg.params ?? {}, { method: msg.method });
      }
    };

    this.boundOnClose = (event: unknown) => {
      const code = (event as { code?: number })?.code ?? 1006;
      this._connected = false;

      // Reject all in-flight commands
      this.rejectAllPending(new Error("WebSocket disconnected — connection closed"));

      // Abnormal close → browser crash
      if (code !== 1000) {
        this.emit("browserCrashed");
      }

      // Always emit disconnected
      this.emit("disconnected");

      // Reconnect on abnormal close unless user called close()
      if (!this.closed && code !== 1000) {
        this.attemptReconnection().catch(() => {
          // Swallow — reconnectionFailed event already emitted
        });
      }
    };

    this.boundOnError = () => {
      // Errors during an established connection surface via the close event.
    };

    ws.addEventListener("message", this.boundOnMessage);
    ws.addEventListener("close", this.boundOnClose);
    ws.addEventListener("error", this.boundOnError);
  }

  /** Detach WebSocket listeners. */
  private detachListeners(ws: MinimalWebSocket): void {
    if (this.boundOnMessage) ws.removeEventListener("message", this.boundOnMessage);
    if (this.boundOnClose) ws.removeEventListener("close", this.boundOnClose);
    if (this.boundOnError) ws.removeEventListener("error", this.boundOnError);
  }

  /** Reject every pending command. */
  private rejectAllPending(error: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  /** Dispatch an event to all registered handlers. */
  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(...args);
      } catch {
        // Swallow handler errors.
      }
    }
  }

  /** Attempt reconnection with retries after abnormal close. */
  private async attemptReconnection(): Promise<void> {
    if (this.reconnecting || this.closed) return;
    this.reconnecting = true;

    for (let attempt = 0; attempt < DAEMON_CONNECT_RETRIES; attempt++) {
      if (this.closed) {
        this.reconnecting = false;
        return;
      }

      await this.delay(DAEMON_CONNECT_DELAY);

      if (this.closed) {
        this.reconnecting = false;
        return;
      }

      try {
        await this.connect();
        this.reconnecting = false;
        this.emit("reconnected");
        return;
      } catch {
        // Will retry on next iteration.
      }
    }

    this.reconnecting = false;
    this.emit("reconnectionFailed");
  }

  /** Promise-based delay. */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
