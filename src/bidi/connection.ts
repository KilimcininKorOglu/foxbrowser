/**
 * BiDi Connection — WebSocket-based WebDriver BiDi protocol client.
 *
 * Handles JSON-RPC command/response correlation, BiDi event dispatch,
 * timeouts, reconnection on crash, and clean shutdown.
 *
 * The public API (send/on/off/close) mirrors CDPConnection so that
 * tool implementations can work with the same interface.
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

/** Maximum reconnection retries. */
export const RECONNECT_RETRIES = 20;

/** Delay between reconnection retries in milliseconds. */
export const RECONNECT_DELAY = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for sending a BiDi command. */
export interface BiDiCommandOptions {
  /** Timeout in ms for this specific command. */
  timeout?: number;
}

/** Internal pending command tracker. */
interface PendingCommand {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  method: string;
  timer: ReturnType<typeof setTimeout>;
}

/** Shape of a parsed incoming BiDi message. */
interface BiDiMessage {
  /** Present on command responses. */
  id?: number;
  /** Present on events. */
  method?: string;
  /** Result payload (success response). */
  result?: unknown;
  /** Params payload (event). */
  params?: Record<string, unknown>;
  /** Error payload (error response). */
  error?: { error: string; message: string; stacktrace?: string };
  /** Type discriminator: "success" | "error" | "event". */
  type?: string;
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
// BiDiConnection
// ---------------------------------------------------------------------------

type EventHandler = (...args: unknown[]) => void;

/**
 * WebSocket-based WebDriver BiDi client.
 *
 * ```ts
 * const conn = new BiDiConnection("ws://127.0.0.1:9222/session");
 * await conn.connect();
 * const result = await conn.send("browsingContext.getTree", {});
 * conn.close();
 * ```
 */
export class BiDiConnection {
  private readonly wsUrl: string;
  private ws: MinimalWebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly eventHandlers = new Map<string, Set<EventHandler>>();
  private closed = false;
  private reconnecting = false;
  private _connected = false;
  private defaultContextId: string | null = null;

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

  /** Set the default browsing context for script commands. */
  setDefaultContext(contextId: string): void {
    this.defaultContextId = contextId;
  }

  /** Get the current default browsing context. */
  getDefaultContext(): string | null {
    return this.defaultContextId;
  }

  /**
   * Open the WebSocket connection.
   * Resolves on the `open` event; rejects on `error`.
   */
  async connect(): Promise<void> {
    this.closed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let WS = (globalThis as any).WebSocket;
    if (!WS) {
      try {
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
   * Send a BiDi command and await its result.
   *
   * @param method  BiDi method (e.g. `"browsingContext.navigate"`)
   * @param params  Method parameters
   * @param options Optional timeout override
   */
  send(
    method: string,
    params?: Record<string, unknown>,
    options?: BiDiCommandOptions,
  ): Promise<unknown> {
    if (this.closed || !this._connected || !this.ws) {
      return Promise.reject(
        new Error(`Connection closed — cannot send ${method}`),
      );
    }

    const id = this.nextId++;
    const timeout = options?.timeout ?? TIMEOUT;

    const effectiveParams = { ...(params ?? {}) };
    if (
      (method === "script.evaluate" || method === "script.callFunction") &&
      !effectiveParams.target &&
      this.defaultContextId
    ) {
      effectiveParams.target = { context: this.defaultContextId };
    }

    const message: Record<string, unknown> = { id, method, params: effectiveParams };

    this.ws.send(JSON.stringify(message));

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`BiDi command timeout: ${method} (${timeout}ms)`));
      }, timeout);

      this.pending.set(id, { resolve, reject, method, timer });
    });
  }

  /**
   * Register an event handler for a BiDi event or lifecycle event.
   *
   * BiDi events: `browsingContext.load`, `network.responseCompleted`, etc.
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

  private attachListeners(ws: MinimalWebSocket): void {
    this.boundOnMessage = (event: unknown) => {
      const data = (event as { data?: string })?.data;
      if (typeof data !== "string") return;

      let msg: BiDiMessage;
      try {
        msg = JSON.parse(data) as BiDiMessage;
      } catch {
        return;
      }

      // --- Command response (has `id`) ---
      if (msg.id !== undefined) {
        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.type === "error" || msg.error) {
            const errMsg = msg.error?.message ?? "Unknown BiDi error";
            const errCode = msg.error?.error ?? "unknown error";
            entry.reject(new Error(`${errCode}: ${errMsg}`));
          } else {
            entry.resolve(msg.result);
          }
        }
        return;
      }

      // --- BiDi event (has `method`, no `id`) ---
      if (msg.method) {
        this.emit(msg.method, msg.params ?? {}, { method: msg.method });
      }
    };

    this.boundOnClose = (event: unknown) => {
      const code = (event as { code?: number })?.code ?? 1006;
      this._connected = false;

      this.rejectAllPending(new Error("WebSocket disconnected — connection closed"));

      if (code !== 1000) {
        this.emit("browserCrashed");
      }

      this.emit("disconnected");

      if (!this.closed && code !== 1000) {
        this.attemptReconnection().catch(() => {});
      }
    };

    this.boundOnError = () => {};

    ws.addEventListener("message", this.boundOnMessage);
    ws.addEventListener("close", this.boundOnClose);
    ws.addEventListener("error", this.boundOnError);
  }

  private detachListeners(ws: MinimalWebSocket): void {
    if (this.boundOnMessage) ws.removeEventListener("message", this.boundOnMessage);
    if (this.boundOnClose) ws.removeEventListener("close", this.boundOnClose);
    if (this.boundOnError) ws.removeEventListener("error", this.boundOnError);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

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

  private async attemptReconnection(): Promise<void> {
    if (this.reconnecting || this.closed) return;
    this.reconnecting = true;

    for (let attempt = 0; attempt < RECONNECT_RETRIES; attempt++) {
      if (this.closed) {
        this.reconnecting = false;
        return;
      }

      await this.delay(RECONNECT_DELAY);

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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
