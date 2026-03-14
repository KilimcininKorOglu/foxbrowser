/**
 * browser_find — Semantic element locators via CDP Accessibility and Runtime APIs.
 *
 * Provides Playwright-style locator functions: findByRole, findByText, findByLabel,
 * findByPlaceholder, findByAlt, findByTitle, findByTestId, findFirst, findLast, findNth.
 *
 * Also provides a unified `browserFind` function for the MCP tool that finds elements
 * by ARIA role, accessible name, or text content and returns @eN refs.
 *
 * Role and text-based locators use the Accessibility tree (Accessibility.getFullAXTree).
 * Attribute-based locators use Runtime.evaluate with CSS selectors.
 * Positional locators (first/last/nth) use querySelectorAll.
 */
import type { CDPConnection } from "../cdp/connection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FindResult {
  /** Whether an element was found. */
  found: boolean;
  /** The backend node ID of the found element. */
  backendNodeId?: number;
  /** The index of the found element (for positional locators). */
  index?: number;
}

export interface FindByRoleParams {
  /** ARIA role to search for (e.g., "button", "link"). */
  role: string;
  /** Accessible name to match. */
  name?: string;
}

export interface FindByTextParams {
  /** Text content to search for. */
  text: string;
  /** If true, require exact text match (not substring). */
  exact?: boolean;
}

export interface FindByLabelParams {
  /** Label text to search for. */
  label: string;
}

export interface FindByPlaceholderParams {
  /** Placeholder text to search for. */
  placeholder: string;
}

export interface FindByAltParams {
  /** Alt text to search for. */
  alt: string;
}

export interface FindByTitleParams {
  /** Title attribute to search for. */
  title: string;
}

export interface FindByTestIdParams {
  /** data-testid value to search for. */
  testId: string;
}

export interface FindPositionalParams {
  /** CSS selector to match elements. */
  selector: string;
}

export interface FindNthParams extends FindPositionalParams {
  /** Zero-based index of the element to select. */
  n: number;
}

// ---------------------------------------------------------------------------
// Accessibility tree types
// ---------------------------------------------------------------------------

interface AXNode {
  nodeId: string;
  role: { type: string; value: string };
  name?: { type: string; value: string };
  backendDOMNodeId?: number;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Finds an element by ARIA role and optional accessible name.
 *
 * Uses Accessibility.getFullAXTree and filters by role/name.
 */
export async function findByRole(
  cdp: CDPConnection,
  params: FindByRoleParams,
): Promise<FindResult> {
  const response = (await cdp.send("Accessibility.getFullAXTree")) as {
    nodes: AXNode[];
  };

  const match = response.nodes.find((node) => {
    if (node.role.value !== params.role) return false;
    if (params.name && node.name?.value !== params.name) return false;
    return true;
  });

  if (!match) {
    return { found: false };
  }

  return {
    found: true,
    backendNodeId: match.backendDOMNodeId,
  };
}

/**
 * Finds an element by its text content.
 *
 * Uses Accessibility.getFullAXTree and filters by accessible name.
 */
export async function findByText(
  cdp: CDPConnection,
  params: FindByTextParams,
): Promise<FindResult> {
  const response = (await cdp.send("Accessibility.getFullAXTree")) as {
    nodes: AXNode[];
  };

  const match = response.nodes.find((node) => {
    if (!node.name?.value) return false;
    if (params.exact) {
      return node.name.value === params.text;
    }
    return node.name.value.includes(params.text);
  });

  if (!match) {
    return { found: false };
  }

  return {
    found: true,
    backendNodeId: match.backendDOMNodeId,
  };
}

/**
 * Finds an element by its associated label text.
 *
 * Uses Runtime.evaluate to find an element via label association.
 */
export async function findByLabel(
  cdp: CDPConnection,
  params: FindByLabelParams,
): Promise<FindResult> {
  const escaped = JSON.stringify(params.label);

  const response = (await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const labels = document.querySelectorAll('label');
      for (const label of labels) {
        if (label.textContent?.trim() === ${escaped}) {
          if (label.htmlFor) {
            return document.getElementById(label.htmlFor);
          }
          return label.querySelector('input, select, textarea');
        }
      }
      return null;
    })()`,
    returnByValue: false,
  })) as { result: { type: string; objectId?: string } };

  if (!response.result.objectId) {
    return { found: false };
  }

  return { found: true };
}

/**
 * Finds an element by its placeholder attribute.
 *
 * Uses Runtime.evaluate with an attribute selector.
 */
export async function findByPlaceholder(
  cdp: CDPConnection,
  params: FindByPlaceholderParams,
): Promise<FindResult> {
  const escaped = JSON.stringify(params.placeholder);

  const response = (await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[placeholder=${escaped}]')`,
    returnByValue: false,
  })) as { result: { type: string; objectId?: string } };

  if (!response.result.objectId) {
    return { found: false };
  }

  return { found: true };
}

/**
 * Finds an element by its alt text attribute.
 *
 * Uses Runtime.evaluate with an attribute selector.
 */
export async function findByAlt(
  cdp: CDPConnection,
  params: FindByAltParams,
): Promise<FindResult> {
  const escaped = JSON.stringify(params.alt);

  const response = (await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[alt=${escaped}]')`,
    returnByValue: false,
  })) as { result: { type: string; objectId?: string } };

  if (!response.result.objectId) {
    return { found: false };
  }

  return { found: true };
}

/**
 * Finds an element by its title attribute.
 *
 * Uses Runtime.evaluate with an attribute selector.
 */
export async function findByTitle(
  cdp: CDPConnection,
  params: FindByTitleParams,
): Promise<FindResult> {
  const escaped = JSON.stringify(params.title);

  const response = (await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[title=${escaped}]')`,
    returnByValue: false,
  })) as { result: { type: string; objectId?: string } };

  if (!response.result.objectId) {
    return { found: false };
  }

  return { found: true };
}

/**
 * Finds an element by its data-testid attribute.
 *
 * Uses Runtime.evaluate with a data attribute selector.
 */
export async function findByTestId(
  cdp: CDPConnection,
  params: FindByTestIdParams,
): Promise<FindResult> {
  const escaped = JSON.stringify(params.testId);

  const response = (await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('[data-testid=${escaped}]')`,
    returnByValue: false,
  })) as { result: { type: string; objectId?: string } };

  if (!response.result.objectId) {
    return { found: false };
  }

  return { found: true };
}

/**
 * Finds the first element matching a CSS selector.
 *
 * @returns FindResult with index=0
 */
export async function findFirst(
  cdp: CDPConnection,
  params: FindPositionalParams,
): Promise<FindResult> {
  const escaped = JSON.stringify(params.selector);

  const response = (await cdp.send("Runtime.evaluate", {
    expression: `document.querySelectorAll(${escaped})[0]`,
    returnByValue: false,
  })) as { result: { type: string; objectId?: string } };

  if (!response.result.objectId) {
    return { found: false };
  }

  return { found: true, index: 0 };
}

/**
 * Finds the last element matching a CSS selector.
 *
 * @returns FindResult with the last element's index
 */
export async function findLast(
  cdp: CDPConnection,
  params: FindPositionalParams,
): Promise<FindResult> {
  const escaped = JSON.stringify(params.selector);

  const response = (await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const els = document.querySelectorAll(${escaped});
      return els.length > 0 ? els[els.length - 1] : null;
    })()`,
    returnByValue: false,
  })) as { result: { type: string; objectId?: string } };

  if (!response.result.objectId) {
    return { found: false };
  }

  return { found: true };
}

/**
 * Finds the nth element matching a CSS selector.
 *
 * @param params.n - Zero-based index
 * @returns FindResult with the nth element
 */
export async function findNth(
  cdp: CDPConnection,
  params: FindNthParams,
): Promise<FindResult> {
  const escaped = JSON.stringify(params.selector);

  const response = (await cdp.send("Runtime.evaluate", {
    expression: `document.querySelectorAll(${escaped})[${params.n}]`,
    returnByValue: false,
  })) as { result: { type: string; objectId?: string } };

  if (!response.result.objectId) {
    return { found: false };
  }

  return { found: true, index: params.n };
}

// ---------------------------------------------------------------------------
// Unified browserFind — MCP tool entry point
// ---------------------------------------------------------------------------

export interface BrowserFindParams {
  /** ARIA role to search for (e.g., "button", "link", "heading", "textbox"). */
  role?: string;
  /** Accessible name to match (substring, case-sensitive). */
  name?: string;
  /** Text content to search for (substring match on accessible name). */
  text?: string;
  /** Zero-based index to pick the nth match (default 0 = first). */
  nth?: number;
}

export interface BrowserFindResult {
  /** Whether a matching element was found. */
  found: boolean;
  /** @eN ref for use with other browsirai tools, or null if not found. */
  ref: string | null;
  /** ARIA role of the matched element, or null if not found. */
  role: string | null;
  /** Accessible name of the matched element, or null if not found. */
  name: string | null;
  /** Total number of matching elements. */
  count: number;
}

/**
 * Finds elements by ARIA role, accessible name, or text content.
 *
 * Uses Accessibility.getFullAXTree to walk the AX tree, filters by
 * role (case-insensitive) and/or name (substring) and/or text content,
 * and returns the nth match (default first) with an @eN ref.
 */
export async function browserFind(
  cdp: CDPConnection,
  params: BrowserFindParams,
): Promise<BrowserFindResult> {
  const nth = params.nth ?? 0;

  // Get the full accessibility tree
  const response = (await cdp.send("Accessibility.getFullAXTree", undefined, {
    timeout: 10000,
  })) as {
    nodes: AXNode[];
  };

  // Filter nodes by role, name, and/or text
  const matches = response.nodes.filter((node) => {
    // Filter by role (case-insensitive)
    if (params.role) {
      const nodeRole = node.role?.value ?? "";
      if (nodeRole.toLowerCase() !== params.role.toLowerCase()) {
        return false;
      }
    }

    // Filter by name (substring match)
    if (params.name) {
      const nodeName = node.name?.value ?? "";
      if (!nodeName.includes(params.name)) {
        return false;
      }
    }

    // Filter by text content (substring match on accessible name)
    if (params.text) {
      const nodeName = node.name?.value ?? "";
      if (!nodeName.includes(params.text)) {
        return false;
      }
    }

    return true;
  });

  const count = matches.length;

  // Pick the nth match
  if (nth >= count || count === 0) {
    return {
      found: false,
      ref: null,
      role: null,
      name: null,
      count,
    };
  }

  const match = matches[nth];
  const ref = match.backendDOMNodeId ? `@e${match.backendDOMNodeId}` : null;

  return {
    found: true,
    ref,
    role: match.role?.value ?? null,
    name: match.name?.value ?? null,
    count,
  };
}
