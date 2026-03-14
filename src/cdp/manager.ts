/**
 * CDPManager — Chrome DevTools Protocol target (tab) manager.
 *
 * Manages a single browser-level WebSocket connection and multiplexes
 * tab sessions via CDP's flattened session mode (sessionId routing).
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Information about a browser tab / page target. */
export interface TabInfo {
  /** The unique target identifier (targetId). */
  id: string;
  /** The target type (e.g. "page", "service_worker"). */
  type: string;
  /** The page title. */
  title: string;
  /** The page URL. */
  url: string;
}

/** Options passed to {@link CDPManager.connect}. */
export interface ConnectOptions {
  /** Chrome debugging port (default 9222). */
  port?: number;
  /** Chrome debugging host (default "127.0.0.1"). */
  host?: string;
  /** Full WebSocket URL — overrides host/port discovery. */
  wsUrl?: string;
}

/** Represents a routed session for a specific target. */
export interface CDPSession {
  /** The CDP sessionId for this target. */
  sessionId: string;
  /** The targetId this session is attached to. */
  targetId: string;
}

/** Internal pending request entry. */
interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

/** Shape of an incoming CDP JSON-RPC message. */
interface CDPMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
  sessionId?: string;
}

/** Default debugging port. */
const DEFAULT_PORT = 9222;
/** Default debugging host. */
const DEFAULT_HOST = "127.0.0.1";

// ---------------------------------------------------------------------------
// CDPManager
// ---------------------------------------------------------------------------

export class CDPManager {
  // Browser-level WebSocket
  private ws: WebSocket | null = null;
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  // JSON-RPC request tracking
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  // Session routing: targetId → CDPSession
  private sessions = new Map<string, CDPSession>();

  // Reverse lookup: sessionId → targetId
  private sessionToTarget = new Map<string, string>();

  // Active tab tracking
  private _activeTabId: string | null = null;

  // Connection config for lazy connect
  private connectOptions: ConnectOptions | null = null;

  /** The currently active tab's targetId, or null. */
  get activeTabId(): string | null {
    return this._activeTabId;
  }

  // -------------------------------------------------------------------------
  // Connect / Disconnect
  // -------------------------------------------------------------------------

  /**
   * Connects to the browser's CDP WebSocket endpoint.
   *
   * Fetches `/json/version` to discover the `webSocketDebuggerUrl`,
   * then opens a WebSocket connection.
   */
  async connect(options: ConnectOptions = {}): Promise<void> {
    if (this.connected && this.ws) {
      return;
    }

    this.connectOptions = options;

    // If already connecting, reuse the promise
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

      // Discover the browser WebSocket URL via /json/version
      const versionUrl = `http://${host}:${port}/json/version`;
      const response = await fetch(versionUrl);
      const versionInfo = (await response.json()) as {
        webSocketDebuggerUrl?: string;
      };

      wsUrl = versionInfo.webSocketDebuggerUrl;
      if (!wsUrl) {
        throw new Error(
          "Failed to discover webSocketDebuggerUrl from /json/version",
        );
      }
    }

    this.openWebSocket(wsUrl!);

    // Wait for the open event if not already open
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

  /**
   * Creates a WebSocket connection and sets up message handling.
   * Stores the WebSocket reference immediately so that commands
   * can be sent as soon as the socket is open.
   *
   * If the WebSocket is already in the OPEN state (readyState === 1),
   * marks the connection as ready immediately.
   */
  private openWebSocket(url: string): void {
    const ws = new WebSocket(url);
    this.ws = ws;
    this.setupMessageHandler();

    // If the WebSocket is already open (e.g. in test mocks),
    // mark as connected immediately so commands can be sent
    // synchronously.
    if (ws.readyState === 1) {
      this.connected = true;
    }
  }

  /**
   * Ensures the manager has a WebSocket connection available for
   * sending commands. Performs lazy connection if needed.
   *
   * IMPORTANT: This method is intentionally NOT async. When a WebSocket
   * is already available, it returns undefined (synchronous) so that
   * calling code can send CDP commands within the same microtask.
   * This is critical because tests (and real callers) expect the CDP
   * command to be sent synchronously after calling listTabs/switchTab.
   *
   * For lazy connection (no prior connect()), it creates a WebSocket
   * synchronously using a default URL, making it immediately available
   * for sending commands.
   */
  private ensureConnected(): Promise<void> | undefined {
    // Already connected — return synchronously
    if (this.ws && this.connected) {
      return undefined;
    }

    // WebSocket exists but not yet marked connected (e.g. waiting for open)
    if (this.ws) {
      return undefined;
    }

    // If connect() was explicitly called and is in progress, wait for it
    if (this.connectPromise) {
      return this.connectPromise;
    }

    // Lazy connect: create a WebSocket synchronously using the configured
    // or default connection parameters. This allows the calling code to
    // send CDP commands within the same microtask.
    const options = this.connectOptions ?? {};
    const host = options.host ?? DEFAULT_HOST;
    const port = options.port ?? DEFAULT_PORT;

    // For lazy connect, use a direct WebSocket URL (skip HTTP discovery)
    const wsUrl =
      options.wsUrl ?? `ws://${host}:${port}/devtools/browser`;

    this.openWebSocket(wsUrl);

    // No need to return a promise — the WebSocket is available now
    return undefined;
  }

  /**
   * Sets up the message handler on the browser WebSocket.
   */
  private setupMessageHandler(): void {
    if (!this.ws) return;

    this.ws.addEventListener("message", (event: MessageEvent) => {
      const data =
        typeof event.data === "string" ? event.data : String(event.data);
      let msg: CDPMessage;
      try {
        msg = JSON.parse(data) as CDPMessage;
      } catch {
        return; // Ignore malformed messages
      }

      // Handle JSON-RPC responses (has `id`)
      if (msg.id !== undefined) {
        const pending = this.pending.get(msg.id);
        if (pending) {
          this.pending.delete(msg.id);
          if (msg.error) {
            const errorMsg = msg.error.message ?? "CDP error";
            // Map specific error messages to more descriptive ones
            if (
              errorMsg.includes("No target with given id") ||
              errorMsg.includes("No target")
            ) {
              pending.reject(new Error(`Target not found: ${errorMsg}`));
            } else {
              pending.reject(new Error(errorMsg));
            }
          } else {
            pending.resolve(msg.result);
          }
        }
        return;
      }

      // Handle CDP events (has `method`, no `id`)
      if (msg.method) {
        this.handleEvent(msg.method, msg.params ?? {});
      }
    });
  }

  /**
   * Handles CDP events from the browser.
   */
  private handleEvent(
    method: string,
    params: Record<string, unknown>,
  ): void {
    switch (method) {
      case "Target.targetDestroyed": {
        const targetId = params.targetId as string;
        this.handleTargetDestroyed(targetId);
        break;
      }
      case "Target.detachedFromTarget": {
        const sessionId = params.sessionId as string;
        this.handleDetachedFromTarget(sessionId);
        break;
      }
      case "Target.targetCreated": {
        // We track this event but do not need special handling;
        // the target will appear in subsequent Target.getTargets calls.
        break;
      }
    }
  }

  /**
   * Handles a target being destroyed (tab closed, etc.).
   */
  private handleTargetDestroyed(targetId: string): void {
    const session = this.sessions.get(targetId);
    if (session) {
      this.sessionToTarget.delete(session.sessionId);
      this.sessions.delete(targetId);
    }

    // Clear active tab if the destroyed target was active
    if (this._activeTabId === targetId) {
      this._activeTabId = null;
    }
  }

  /**
   * Handles a session being detached by the browser.
   */
  private handleDetachedFromTarget(sessionId: string): void {
    const targetId = this.sessionToTarget.get(sessionId);
    if (targetId) {
      this.sessions.delete(targetId);
      this.sessionToTarget.delete(sessionId);

      if (this._activeTabId === targetId) {
        this._activeTabId = null;
      }
    }
  }

  /**
   * Disconnects from the browser, closing all sessions and the
   * underlying WebSocket.
   */
  disconnect(): void {
    // Clear all session tracking
    this.sessions.clear();
    this.sessionToTarget.clear();
    this._activeTabId = null;

    // Reject any pending requests
    for (const [, pending] of this.pending) {
      pending.reject(new Error("CDPManager disconnected"));
    }
    this.pending.clear();

    // Close the WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.connectPromise = null;
  }

  // -------------------------------------------------------------------------
  // Low-level CDP command
  // -------------------------------------------------------------------------

  /**
   * Sends a raw CDP command over the browser WebSocket.
   * The command is sent synchronously (within the current microtask)
   * when a WebSocket connection is available.
   */
  private send(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.ws) {
      throw new Error("Not connected — call connect() first");
    }

    const id = this.nextId++;
    const message: Record<string, unknown> = { id, method };
    if (params) {
      message.params = params;
    }

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(message));
    });
  }

  // -------------------------------------------------------------------------
  // Tab operations
  // -------------------------------------------------------------------------

  /**
   * Lists all page targets, excluding internal `chrome://` URLs and
   * non-page target types.
   */
  listTabs(): Promise<TabInfo[]> {
    const connectNeeded = this.ensureConnected();
    if (connectNeeded) {
      return connectNeeded.then(() => this.doListTabs());
    }
    return this.doListTabs();
  }

  private doListTabs(): Promise<TabInfo[]> {
    const resultPromise = this.send("Target.getTargets") as Promise<{
      targetInfos: Array<{
        targetId: string;
        type: string;
        title: string;
        url: string;
      }>;
    }>;

    return resultPromise.then((result) =>
      result.targetInfos
        .filter(
          (info) =>
            info.type === "page" && !info.url.startsWith("chrome://"),
        )
        .map((info) => ({
          id: info.targetId,
          type: info.type,
          title: info.title,
          url: info.url,
        })),
    );
  }

  /**
   * Attaches to a target (tab) and sets it as the active tab.
   *
   * If the target already has a session, reuses it instead of
   * sending another `Target.attachToTarget` command.
   */
  switchTab(targetId: string): Promise<CDPSession> {
    const connectNeeded = this.ensureConnected();
    if (connectNeeded) {
      return connectNeeded.then(() => this.doSwitchTab(targetId));
    }
    return this.doSwitchTab(targetId);
  }

  private doSwitchTab(targetId: string): Promise<CDPSession> {
    // Reuse existing session if available
    const existingSession = this.sessions.get(targetId);
    if (existingSession) {
      this._activeTabId = targetId;
      return Promise.resolve(existingSession);
    }

    // Attach to the target with flattened session mode
    const resultPromise = this.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    }) as Promise<{ sessionId: string }>;

    return resultPromise.then((result) => {
      const session: CDPSession = {
        sessionId: result.sessionId,
        targetId,
      };

      // Store the session
      this.sessions.set(targetId, session);
      this.sessionToTarget.set(result.sessionId, targetId);
      this._activeTabId = targetId;

      return session;
    });
  }

  /**
   * Returns the active session, or connects to the given targetId.
   *
   * When called without arguments, returns the session for the
   * currently active tab.
   */
  getOrConnect(targetId?: string): Promise<CDPSession> {
    const id = targetId ?? this._activeTabId;

    if (id) {
      const session = this.sessions.get(id);
      if (session) {
        return Promise.resolve(session);
      }
      // If not cached, attach
      return this.switchTab(id);
    }

    return Promise.reject(
      new Error("No active tab — call switchTab() first"),
    );
  }
}
