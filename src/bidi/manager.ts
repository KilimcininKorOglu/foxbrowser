/**
 * BiDiManager — WebDriver BiDi browsing context (tab) manager.
 *
 * Manages a single browser-level WebSocket connection and
 * routes commands to specific browsing contexts.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Information about a browser tab / browsing context. */
export interface TabInfo {
  /** The unique browsing context ID. */
  id: string;
  /** The context type (e.g. "tab", "window"). */
  type: string;
  /** The page title. */
  title: string;
  /** The page URL. */
  url: string;
  /** Child contexts (iframes). */
  children: TabInfo[];
}

/** Options passed to {@link BiDiManager.connect}. */
export interface ConnectOptions {
  /** Remote debugging port (default 9222). */
  port?: number;
  /** Remote debugging host (default "127.0.0.1"). */
  host?: string;
  /** Full WebSocket URL — overrides host/port discovery. */
  wsUrl?: string;
}

/** Internal pending request entry. */
interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

/** Shape of an incoming BiDi message. */
interface BiDiMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { error: string; message: string };
  type?: string;
}

const DEFAULT_PORT = 9222;
const DEFAULT_HOST = "127.0.0.1";

// ---------------------------------------------------------------------------
// BiDiManager
// ---------------------------------------------------------------------------

export class BiDiManager {
  private ws: WebSocket | null = null;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  private _activeContextId: string | null = null;
  private connectOptions: ConnectOptions | null = null;
  private boundMessageHandler: ((event: MessageEvent) => void) | null = null;

  /** The currently active browsing context ID, or null. */
  get activeContextId(): string | null {
    return this._activeContextId;
  }

  // -------------------------------------------------------------------------
  // Connect / Disconnect
  // -------------------------------------------------------------------------

  /**
   * Connects to Firefox's BiDi WebSocket endpoint.
   */
  async connect(options: ConnectOptions = {}): Promise<void> {
    if (this.connected && this.ws) {
      return;
    }

    this.connectOptions = options;

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.doConnect(options);
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async doConnect(options: ConnectOptions): Promise<void> {
    let wsUrl = options.wsUrl;

    if (!wsUrl) {
      const host = options.host ?? DEFAULT_HOST;
      const port = options.port ?? DEFAULT_PORT;

      const versionUrl = `http://${host}:${port}/json/version`;
      const response = await fetch(versionUrl);
      const versionInfo = (await response.json()) as {
        webSocketDebuggerUrl?: string;
      };

      wsUrl = versionInfo.webSocketDebuggerUrl;
      if (!wsUrl) {
        wsUrl = `ws://${host}:${port}/session`;
      }
    }

    this.openWebSocket(wsUrl!);

    if (!this.connected) {
      await new Promise<void>((resolve, reject) => {
        this.ws!.addEventListener("open", () => {
          this.connected = true;
          resolve();
        });
        this.ws!.addEventListener("error", (event: Event) => {
          this.ws = null;
          const errEvent = event as Event & { message?: string };
          reject(
            new Error(errEvent?.message ?? "WebSocket connection failed"),
          );
        });
      });
    }
  }

  private openWebSocket(url: string): void {
    if (this.ws) {
      if (this.boundMessageHandler) {
        this.ws.removeEventListener("message", this.boundMessageHandler);
      }
      try { this.ws.close(); } catch { /* ignore */ }
    }

    const ws = new WebSocket(url);
    this.ws = ws;
    this.setupMessageHandler();

    if (ws.readyState === 1) {
      this.connected = true;
    }
  }

  private ensureConnected(): Promise<void> | undefined {
    if (this.ws && this.connected) {
      return undefined;
    }

    if (this.ws) {
      return undefined;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    const options = this.connectOptions ?? {};
    const host = options.host ?? DEFAULT_HOST;
    const port = options.port ?? DEFAULT_PORT;

    const wsUrl = options.wsUrl ?? `ws://${host}:${port}/session`;

    this.openWebSocket(wsUrl);
    return undefined;
  }

  private setupMessageHandler(): void {
    if (!this.ws) return;

    this.boundMessageHandler = (event: MessageEvent) => {
      const data =
        typeof event.data === "string" ? event.data : String(event.data);
      let msg: BiDiMessage;
      try {
        msg = JSON.parse(data) as BiDiMessage;
      } catch {
        return;
      }

      if (msg.id !== undefined) {
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          if (msg.type === "error" || msg.error) {
            const errMsg = msg.error?.message ?? "BiDi error";
            pending.reject(new Error(errMsg));
          } else {
            pending.resolve(msg.result);
          }
        }
        return;
      }

      if (msg.method) {
        this.handleEvent(msg.method, msg.params ?? {});
      }
    };
    this.ws.addEventListener("message", this.boundMessageHandler);
  }

  private handleEvent(
    method: string,
    params: Record<string, unknown>,
  ): void {
    switch (method) {
      case "browsingContext.contextDestroyed": {
        const contextId = (params.context as string) ?? "";
        this.handleContextDestroyed(contextId);
        break;
      }
      case "browsingContext.contextCreated": {
        // Tracked but no special handling needed
        break;
      }
    }
  }

  private handleContextDestroyed(contextId: string): void {
    if (this._activeContextId === contextId) {
      this._activeContextId = null;
    }
  }

  /**
   * Disconnects from the browser.
   */
  disconnect(): void {
    this._activeContextId = null;

    for (const [, pending] of this.pending) {
      pending.reject(new Error("BiDiManager disconnected"));
    }
    this.pending.clear();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.connectPromise = null;
  }

  // -------------------------------------------------------------------------
  // Low-level BiDi command
  // -------------------------------------------------------------------------

  private send(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.ws) {
      throw new Error("Not connected — call connect() first");
    }

    const id = this.nextId++;
    const message: Record<string, unknown> = { id, method, params: params ?? {} };

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(message));
    });
  }

  // -------------------------------------------------------------------------
  // Tab (Browsing Context) operations
  // -------------------------------------------------------------------------

  /**
   * Lists all top-level browsing contexts (tabs), excluding
   * internal about: pages.
   */
  listTabs(): Promise<TabInfo[]> {
    const connectNeeded = this.ensureConnected();
    if (connectNeeded) {
      return connectNeeded.then(() => this.doListTabs());
    }
    return this.doListTabs();
  }

  private doListTabs(): Promise<TabInfo[]> {
    const resultPromise = this.send("browsingContext.getTree", {}) as Promise<{
      contexts: Array<{
        context: string;
        url: string;
        children: Array<unknown>;
        parent?: string;
      }>;
    }>;

    return resultPromise.then((result) =>
      result.contexts
        .filter(
          (ctx) => !ctx.url.startsWith("about:"),
        )
        .map((ctx) => ({
          id: ctx.context,
          type: "tab",
          title: "",
          url: ctx.url,
          children: [],
        })),
    );
  }

  /**
   * Sets a browsing context as the active context.
   */
  switchTab(contextId: string): Promise<void> {
    const connectNeeded = this.ensureConnected();
    if (connectNeeded) {
      return connectNeeded.then(() => this.doSwitchTab(contextId));
    }
    return this.doSwitchTab(contextId);
  }

  private async doSwitchTab(contextId: string): Promise<void> {
    await this.send("browsingContext.activate", { context: contextId });
    this._activeContextId = contextId;
  }

  /**
   * Returns the active context ID.
   */
  getActiveContext(): string | null {
    return this._activeContextId;
  }
}
