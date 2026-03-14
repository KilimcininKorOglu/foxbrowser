/**
 * browser_route, browser_abort, browser_unroute tools — CDP Fetch domain request interception.
 *
 * Manages shared intercept state:
 *  - Route rules: respond with custom body/status/headers for matching URLs
 *  - Abort rules: block matching requests with BlockedByClient
 *  - Unroute: remove specific or all intercept rules
 *
 * Uses glob pattern matching (** for any path, * for single segment).
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RouteRule {
  urlPattern: string;
  body: string;
  status: number;
  headers: Record<string, string>;
}

interface AbortRule {
  urlPattern: string;
}

export interface RouteParams {
  url: string;
  body: string | Record<string, unknown>;
  status?: number;
  headers?: Record<string, string>;
}

export interface RouteResult {
  url: string;
  status: number;
  activeRoutes: number;
}

export interface AbortParams {
  url: string;
}

export interface AbortResult {
  url: string;
  activeAborts: number;
}

export interface UnrouteParams {
  url?: string;
  all?: boolean;
}

export interface UnrouteResult {
  removed: number;
  remaining: number;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const activeRoutes: Map<string, RouteRule> = new Map();
const activeAborts: Map<string, AbortRule> = new Map();
let fetchEnabled = false;
let handlerAttached = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Glob matching: convert ** to .* and * to [^/]* for regex matching.
 */
function matchGlob(pattern: string, url: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*");
  return new RegExp(`^${regex}$`).test(url);
}

/**
 * Sync Fetch domain patterns with CDP.
 * Enables/disables Fetch domain and attaches the requestPaused handler once.
 */
async function syncFetchPatterns(cdp: CDPConnection): Promise<void> {
  const patterns = [
    ...Array.from(activeRoutes.keys()),
    ...Array.from(activeAborts.keys()),
  ].map((p) => ({ urlPattern: p }));

  if (patterns.length === 0) {
    if (fetchEnabled) {
      await cdp.send("Fetch.disable");
      fetchEnabled = false;
    }
    return;
  }

  await cdp.send("Fetch.enable", { patterns });
  fetchEnabled = true;

  // Attach handler once
  if (!handlerAttached) {
    cdp.on("Fetch.requestPaused", async (params: any) => {
      const url = params.request.url;
      const requestId = params.requestId;

      try {
        // Check abort rules first
        for (const [pattern] of activeAborts) {
          if (matchGlob(pattern, url)) {
            await cdp.send("Fetch.failRequest", {
              requestId,
              reason: "BlockedByClient",
            });
            return;
          }
        }

        // Check route rules
        for (const [pattern, rule] of activeRoutes) {
          if (matchGlob(pattern, url)) {
            const responseHeaders = Object.entries(rule.headers).map(
              ([name, value]) => ({ name, value }),
            );
            await cdp.send("Fetch.fulfillRequest", {
              requestId,
              responseCode: rule.status,
              body: btoa(rule.body),
              responseHeaders,
            });
            return;
          }
        }

        // No match: continue request
        await cdp.send("Fetch.continueRequest", { requestId });
      } catch {
        // Request may have been cancelled or navigation occurred — ignore
      }
    });
    handlerAttached = true;
  }
}

// ---------------------------------------------------------------------------
// Tool exports
// ---------------------------------------------------------------------------

/**
 * Intercept matching requests and respond with a custom body/status/headers.
 */
export async function browserRoute(
  cdp: CDPConnection,
  params: RouteParams,
): Promise<RouteResult> {
  const body =
    typeof params.body === "object" && params.body !== null
      ? JSON.stringify(params.body)
      : String(params.body);

  const status = params.status ?? 200;
  const headers = params.headers ?? { "Content-Type": "application/json" };

  const rule: RouteRule = {
    urlPattern: params.url,
    body,
    status,
    headers,
  };

  activeRoutes.set(params.url, rule);
  await syncFetchPatterns(cdp);

  return {
    url: params.url,
    status,
    activeRoutes: activeRoutes.size,
  };
}

/**
 * Block matching requests with BlockedByClient error.
 */
export async function browserAbort(
  cdp: CDPConnection,
  params: AbortParams,
): Promise<AbortResult> {
  const rule: AbortRule = {
    urlPattern: params.url,
  };

  activeAborts.set(params.url, rule);
  await syncFetchPatterns(cdp);

  return {
    url: params.url,
    activeAborts: activeAborts.size,
  };
}

/**
 * Remove intercept rules — specific pattern or all.
 */
export async function browserUnroute(
  cdp: CDPConnection,
  params: UnrouteParams,
): Promise<UnrouteResult> {
  let removed = 0;

  if (params.all) {
    removed = activeRoutes.size + activeAborts.size;
    activeRoutes.clear();
    activeAborts.clear();
  } else if (params.url) {
    if (activeRoutes.delete(params.url)) removed++;
    if (activeAborts.delete(params.url)) removed++;
  }

  await syncFetchPatterns(cdp);

  return {
    removed,
    remaining: activeRoutes.size + activeAborts.size,
  };
}

/**
 * Reset all intercept state — for testing purposes.
 */
export function resetInterceptState(): void {
  activeRoutes.clear();
  activeAborts.clear();
  fetchEnabled = false;
  handlerAttached = false;
}
