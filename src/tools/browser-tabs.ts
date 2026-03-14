/**
 * browser_tabs tool — Lists open browser tabs via CDP Target.getTargets.
 *
 * Filters to page-type targets only, with optional URL pattern matching.
 */
import type { CDPConnection } from "../cdp/connection";

export interface TabInfo {
  id: string;
  title: string;
  url: string;
}

export interface BrowserTabsParams {
  /** Glob-style URL filter pattern (e.g. "*github.com*") */
  filter?: string;
}

export interface BrowserTabsResult {
  tabs: TabInfo[];
}

/**
 * Converts a simple glob pattern (with `*` wildcards) to a RegExp.
 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${regexStr}$`, "i");
}

/**
 * Lists all open browser tabs (page-type targets).
 *
 * @param cdp - CDP connection
 * @param params - Optional filter parameters
 * @returns List of tabs with id, title, and url
 */
export async function browserTabs(
  cdp: CDPConnection,
  params: BrowserTabsParams = {},
): Promise<BrowserTabsResult> {
  const response = (await cdp.send("Target.getTargets")) as {
    targetInfos: Array<{
      targetId: string;
      type: string;
      title: string;
      url: string;
      attached: boolean;
    }>;
  };

  // Filter to page-type targets only (exclude service workers, extensions, etc.)
  let tabs = response.targetInfos.filter(
    (target) => target.type === "page",
  );

  // Apply URL pattern filter if specified
  if (params.filter) {
    const regex = globToRegExp(params.filter);
    tabs = tabs.filter((target) => regex.test(target.url));
  }

  return {
    tabs: tabs.map((target) => ({
      id: target.targetId,
      title: target.title,
      url: target.url,
    })),
  };
}
