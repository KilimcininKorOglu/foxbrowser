/**
 * browser_network_requests tool — captures network requests via CDP events.
 *
 * Uses Network.requestWillBeSent and Network.responseReceived CDP events to
 * capture requests server-side into a bounded EventBuffer. Captures method,
 * status code, headers — data not available via the Performance API.
 *
 * Supports:
 *  - URL filtering via substring match
 *  - Static resource filtering (Image, Stylesheet, Font, Script)
 *  - Result limiting
 *  - Secret redaction (JWT/Bearer tokens in URLs)
 *
 * @module browser-network-requests
 */
import { EventBuffer } from "../event-buffer.js";
import { redactInlineSecrets } from "../redactor.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NetworkRequestsParams {
  /** Substring filter to match against request URLs. */
  filter?: string;
  /** Maximum number of requests to return. */
  limit?: number;
  /** Whether to include response headers. */
  includeHeaders?: boolean;
  /** Whether to include static resources (images, stylesheets, fonts, scripts). */
  includeStatic?: boolean;
}

export interface NetworkRequest {
  /** The request URL. */
  url: string;
  /** HTTP method (GET, POST, etc.). */
  method: string;
  /** HTTP status code. */
  status?: number;
  /** Resource type (e.g. "Fetch", "XHR", "Script", "Image"). */
  type?: string;
}

export interface NetworkRequestsResult {
  /** List of captured network requests. */
  requests: NetworkRequest[];
}

// ---------------------------------------------------------------------------
// Static resource types (CDP uses PascalCase)
// ---------------------------------------------------------------------------

const STATIC_TYPES = new Set([
  "Image",
  "Stylesheet",
  "Font",
  "Script",
  "Media",
]);

// ---------------------------------------------------------------------------
// Internal buffer entry (mutable — response enriches it)
// ---------------------------------------------------------------------------

interface BufferEntry {
  requestId: string;
  url: string;
  method: string;
  type: string;
  status?: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const networkBuffer = new EventBuffer<BufferEntry>(500);

/** Map requestId → buffer index for response correlation */
const pendingRequests = new Map<string, BufferEntry>();

// ---------------------------------------------------------------------------
// Setup & Reset
// ---------------------------------------------------------------------------

interface CDPEventSource {
  on(event: string, handler: (params: unknown) => void): void;
}

/**
 * Register CDP event listeners for Network.requestWillBeSent and
 * Network.responseReceived. Call once after Network.enable.
 */
export function setupNetworkCapture(cdp: CDPEventSource): void {
  cdp.on("Network.requestWillBeSent", (params: unknown) => {
    const p = params as {
      requestId: string;
      request: { url: string; method: string };
      type?: string;
      timestamp?: number;
    };

    const entry: BufferEntry = {
      requestId: p.requestId,
      url: p.request.url,
      method: p.request.method,
      type: p.type ?? "Other",
      timestamp: p.timestamp ? Math.floor(p.timestamp * 1000) : Date.now(),
    };

    pendingRequests.set(p.requestId, entry);
    networkBuffer.push(entry);
  });

  cdp.on("Network.responseReceived", (params: unknown) => {
    const p = params as {
      requestId: string;
      response: { url: string; status: number; headers?: Record<string, string> };
    };

    const entry = pendingRequests.get(p.requestId);
    if (entry) {
      entry.status = p.response.status;
      pendingRequests.delete(p.requestId);
    }
  });
}

/** Clear the network buffer (call on reconnection). */
export function resetNetworkBuffer(): void {
  networkBuffer.clear();
  pendingRequests.clear();
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Read network requests from the EventBuffer.
 *
 * @param _cdp - CDP connection (unused — buffer is populated by setupNetworkCapture).
 * @param params - Filter and limit parameters.
 * @returns List of network requests.
 */
export async function browserNetworkRequests(
  _cdp: unknown,
  params: NetworkRequestsParams,
): Promise<NetworkRequestsResult> {
  let entries = networkBuffer.last();

  // Filter static resources unless includeStatic is true
  if (!params.includeStatic) {
    entries = entries.filter((e) => !STATIC_TYPES.has(e.type));
  }

  // Filter by URL substring
  if (params.filter) {
    const filterLower = params.filter.toLowerCase();
    entries = entries.filter((e) => e.url.toLowerCase().includes(filterLower));
  }

  // Apply limit
  const limit = params.limit ?? 100;
  entries = entries.slice(0, limit);

  // Map to NetworkRequest format — redact secrets from URLs
  const requests: NetworkRequest[] = entries.map((e) => ({
    url: redactInlineSecrets(e.url),
    method: e.method,
    status: e.status,
    type: e.type,
  }));

  return { requests };
}
