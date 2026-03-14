/**
 * browser_route, browser_abort, browser_unroute tools — BiDi network interception.
 *
 * Uses network.addIntercept / network.removeIntercept / network.continueRequest
 * / network.failRequest / network.provideResponse for request interception.
 */
import type { BiDiConnection } from "../bidi/connection.js";

interface RouteRule {
  urlPattern: string;
  body: string;
  status: number;
  headers: Record<string, string>;
  interceptId?: string;
}

interface AbortRule {
  urlPattern: string;
  interceptId?: string;
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

const activeRoutes: Map<string, RouteRule> = new Map();
const activeAborts: Map<string, AbortRule> = new Map();
let attachedConnection: BiDiConnection | null = null;

function matchGlob(pattern: string, url: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`).test(url);
}

async function syncInterceptPatterns(bidi: BiDiConnection): Promise<void> {
  if (bidi !== attachedConnection) {
    attachedConnection = bidi;
    bidi.on("network.beforeRequestSent", async (params: unknown) => {
      const p = params as {
        request: { request: string; url: string };
        isBlocked?: boolean;
      };

      if (!p.isBlocked) return;

      const url = p.request.url;
      const requestId = p.request.request;

      try {
        for (const [pattern] of activeAborts) {
          if (matchGlob(pattern, url)) {
            await bidi.send("network.failRequest", { request: requestId });
            return;
          }
        }

        for (const [pattern, rule] of activeRoutes) {
          if (matchGlob(pattern, url)) {
            await bidi.send("network.provideResponse", {
              request: requestId,
              statusCode: rule.status,
              body: { type: "string", value: rule.body },
              headers: Object.entries(rule.headers).map(([name, value]) => ({
                name,
                value: { type: "string", value },
              })),
            });
            return;
          }
        }

        await bidi.send("network.continueRequest", { request: requestId });
      } catch {
        // Request may have been cancelled — ignore
      }
    });
  }
}

export async function browserRoute(
  bidi: BiDiConnection,
  params: RouteParams,
): Promise<RouteResult> {
  const body =
    typeof params.body === "object" && params.body !== null
      ? JSON.stringify(params.body)
      : String(params.body);

  const status = params.status ?? 200;
  const headers = params.headers ?? { "Content-Type": "application/json" };

  // Add network intercept via BiDi
  const result = (await bidi.send("network.addIntercept", {
    phases: ["beforeRequestSent"],
    urlPatterns: [{ type: "pattern", pattern: params.url }],
  })) as { intercept: string };

  const rule: RouteRule = {
    urlPattern: params.url,
    body,
    status,
    headers,
    interceptId: result.intercept,
  };

  activeRoutes.set(params.url, rule);
  await syncInterceptPatterns(bidi);

  return { url: params.url, status, activeRoutes: activeRoutes.size };
}

export async function browserAbort(
  bidi: BiDiConnection,
  params: AbortParams,
): Promise<AbortResult> {
  const result = (await bidi.send("network.addIntercept", {
    phases: ["beforeRequestSent"],
    urlPatterns: [{ type: "pattern", pattern: params.url }],
  })) as { intercept: string };

  const rule: AbortRule = {
    urlPattern: params.url,
    interceptId: result.intercept,
  };

  activeAborts.set(params.url, rule);
  await syncInterceptPatterns(bidi);

  return { url: params.url, activeAborts: activeAborts.size };
}

export async function browserUnroute(
  bidi: BiDiConnection,
  params: UnrouteParams,
): Promise<UnrouteResult> {
  let removed = 0;

  if (params.all) {
    for (const [, rule] of activeRoutes) {
      if (rule.interceptId) {
        try { await bidi.send("network.removeIntercept", { intercept: rule.interceptId }); } catch { /* ignore */ }
      }
    }
    for (const [, rule] of activeAborts) {
      if (rule.interceptId) {
        try { await bidi.send("network.removeIntercept", { intercept: rule.interceptId }); } catch { /* ignore */ }
      }
    }
    removed = activeRoutes.size + activeAborts.size;
    activeRoutes.clear();
    activeAborts.clear();
  } else if (params.url) {
    const routeRule = activeRoutes.get(params.url);
    if (routeRule) {
      if (routeRule.interceptId) {
        try { await bidi.send("network.removeIntercept", { intercept: routeRule.interceptId }); } catch { /* ignore */ }
      }
      activeRoutes.delete(params.url);
      removed++;
    }
    const abortRule = activeAborts.get(params.url);
    if (abortRule) {
      if (abortRule.interceptId) {
        try { await bidi.send("network.removeIntercept", { intercept: abortRule.interceptId }); } catch { /* ignore */ }
      }
      activeAborts.delete(params.url);
      removed++;
    }
  }

  return { removed, remaining: activeRoutes.size + activeAborts.size };
}

export function resetInterceptState(): void {
  activeRoutes.clear();
  activeAborts.clear();
  attachedConnection = null;
}
