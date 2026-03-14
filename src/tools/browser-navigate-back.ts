/**
 * browser_navigate_back — navigates back or forward in browser history.
 * Uses Page.getNavigationHistory + Page.navigateToHistoryEntry (session-compatible).
 */
import type { CDPConnection } from "../cdp/connection";

export interface NavigateBackParams {
  direction?: "back" | "forward";
}

export interface NavigateBackResult {
  success: boolean;
  url?: string;
}

export async function browserNavigateBack(
  cdp: CDPConnection,
  params: NavigateBackParams,
): Promise<NavigateBackResult> {
  const direction = params.direction ?? "back";

  const history = (await cdp.send("Page.getNavigationHistory")) as {
    currentIndex: number;
    entries: Array<{ id: number; url: string; title: string }>;
  };

  const targetIndex = direction === "back"
    ? history.currentIndex - 1
    : history.currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= history.entries.length) {
    return { success: false, url: history.entries[history.currentIndex]?.url };
  }

  const entry = history.entries[targetIndex]!;
  await cdp.send("Page.navigateToHistoryEntry", { entryId: entry.id } as unknown as Record<string, unknown>);

  return { success: true, url: entry.url };
}
