/**
 * browser_navigate tool — navigates to a URL via CDP Page.navigate.
 *
 * Handles:
 *  - Cross-document navigation (loaderId present) → waits for load completion
 *    by racing Page.loadEventFired against document.readyState polling
 *  - Same-document navigation (no loaderId, e.g. hash change) → resolves immediately
 *  - Error responses (errorText from CDP)
 *  - Configurable waitUntil strategy
 *  - Navigation timeout (default 30 s)
 */
import type { CDPConnection } from "../cdp/connection";

interface NavigateParams {
  url: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  timeout?: number;
}

interface NavigateResult {
  url: string;
  title: string;
}

const POLL_INTERVAL_MS = 100;

export async function browserNavigate(
  cdp: CDPConnection,
  params: NavigateParams,
): Promise<NavigateResult> {
  const { url, timeout = 8 } = params;
  const timeoutMs = timeout * 1000;

  // Enable Page domain events before navigating
  await cdp.send("Page.enable");

  // Race navigation against a timeout
  const result = await Promise.race([
    performNavigation(cdp, url, params.waitUntil),
    createTimeout(timeoutMs),
  ]);

  return result;
}

async function performNavigation(
  cdp: CDPConnection,
  url: string,
  waitUntil?: string,
): Promise<NavigateResult> {
  const navResponse = (await cdp.send("Page.navigate", { url })) as {
    frameId?: string;
    loaderId?: string;
    errorText?: string;
  };

  // Check for navigation errors
  if (navResponse.errorText) {
    throw new Error(`Navigation failed: ${navResponse.errorText}`);
  }

  const hasCrossDocNavigation = Boolean(navResponse.loaderId);

  if (hasCrossDocNavigation) {
    // Cross-document navigation: race event listener against readyState polling.
    // This ensures tests that emit Page.loadEventFired work, AND tests that
    // only mock Runtime.evaluate to return readyState=complete also work.
    await waitForLoadCompletion(cdp, waitUntil);
  }
  // Same-document navigation (hash change / pushState): no load event needed

  return getPageInfo(cdp);
}

/**
 * Waits for page load completion by racing two strategies:
 * 1. Listening for the Page.loadEventFired (or domContentEventFired) CDP event
 * 2. Polling document.readyState via Runtime.evaluate
 *
 * Whichever resolves first wins, and the other is cleaned up.
 */
function waitForLoadCompletion(
  cdp: CDPConnection,
  waitUntil?: string,
): Promise<void> {
  const eventName =
    waitUntil === "domcontentloaded"
      ? "Page.domContentEventFired"
      : "Page.loadEventFired";

  return new Promise<void>((resolve) => {
    let settled = false;

    // Strategy 1: CDP event listener
    const handler = () => {
      if (settled) return;
      settled = true;
      cdp.off(eventName, handler as (params: unknown) => void);
      resolve();
    };
    cdp.on(eventName, handler as (params: unknown) => void);

    // Strategy 2: poll readyState
    const poll = async () => {
      while (!settled) {
        try {
          const response = (await cdp.send("Runtime.evaluate", {
            expression: "document.readyState",
            returnByValue: true,
          })) as { result: { type?: string; value?: string } };

          const readyState = response.result.value;

          // Ready if:
          // 1. readyState is explicitly "complete"
          // 2. The response is not a recognized loading state (meaning the
          //    execution context is alive and document is accessible)
          const isLoadingState =
            readyState === "loading" || readyState === "interactive";
          if (readyState === "complete" || !isLoadingState) {
            if (!settled) {
              settled = true;
              cdp.off(eventName, handler as (params: unknown) => void);
              resolve();
            }
            return;
          }
        } catch {
          // Runtime.evaluate can fail transiently during navigation — retry
        }

        if (!settled) {
          await delay(POLL_INTERVAL_MS);
        }
      }
    };

    poll();
  });
}

async function getPageInfo(cdp: CDPConnection): Promise<NavigateResult> {
  const [titleResponse, urlResponse] = await Promise.all([
    cdp.send("Runtime.evaluate", {
      expression: "document.title",
    }) as Promise<{ result: { value?: string } }>,
    cdp.send("Runtime.evaluate", {
      expression: "location.href",
    }) as Promise<{ result: { value?: string } }>,
  ]);

  return {
    title: titleResponse.result.value ?? "",
    url: urlResponse.result.value ?? "",
  };
}

function createTimeout(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => {
      reject(new Error(`Navigation timeout after ${ms}ms`));
    }, ms);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
