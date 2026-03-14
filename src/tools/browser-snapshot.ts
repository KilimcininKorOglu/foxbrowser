/**
 * browser_snapshot tool — captures the accessibility tree and returns a
 * formatted text representation with @eN refs for each element.
 *
 * Exports:
 *   - browserSnapshot(cdp, params?) — main entry point
 *   - shouldShowAxNode(node, options?) — filtering predicate
 *   - processAccessibilityTree(nodes, options?) — tree formatter
 *
 * @module browser-snapshot
 */

import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of an accessibility tree node from CDP. */
interface AXNode {
  nodeId: string;
  backendDOMNodeId?: number;
  role?: { type: string; value: string };
  name?: { type: string; value: string };
  description?: { type: string; value: string };
  value?: { type: string; value: string } | null;
  properties?: Array<{
    name: string;
    value: { type: string; value: unknown };
  }>;
  parentId?: string;
  children?: Array<{ nodeId: string; backendDOMNodeId?: number }>;
  childIds?: string[];
}

/** Options controlling which nodes appear in the snapshot. */
export interface SnapshotOptions {
  /** Only show interactive elements (button, link, textbox, etc.). */
  interactive?: boolean;
  /** Include elements with cursor:pointer. */
  cursor?: boolean;
  /** Compact mode — hides InlineTextBox and empty structural wrappers. */
  compact?: boolean;
  /** Maximum tree depth to include. */
  depth?: number;
  /** CSS selector to scope the snapshot. */
  selector?: string;
}

/** Options for processAccessibilityTree. */
export interface ProcessTreeOptions {
  maxDepth?: number;
}

/** Result returned by browserSnapshot. */
export interface SnapshotResult {
  snapshot: string;
  truncated?: boolean;
  totalElements?: number;
}

// ---------------------------------------------------------------------------
// Interactive role set
// ---------------------------------------------------------------------------

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "treeitem",
]);

// ---------------------------------------------------------------------------
// shouldShowAxNode
// ---------------------------------------------------------------------------

/**
 * Determines whether an AX node should be included in the snapshot output.
 *
 * Filtering rules (from tests):
 *   1. role='none' → false
 *   2. role='generic' with empty name → false
 *   3. role='InlineTextBox' in compact mode → false
 *   4. Empty name AND empty/null value → false
 *   5. Otherwise → true
 */
export function shouldShowAxNode(
  node: AXNode,
  options?: { compact?: boolean },
): boolean {
  const role = node.role?.value ?? "";

  // Rule 1: role='none'
  if (role === "none") {
    return false;
  }

  // Rule 2: role='generic' with empty name
  if (role === "generic") {
    const name = node.name?.value ?? "";
    if (!name) {
      return false;
    }
  }

  // Rule 3: InlineTextBox in compact mode
  if (options?.compact && role === "InlineTextBox") {
    return false;
  }

  // Rule 4: Empty name AND empty/null value
  const name = node.name?.value ?? "";
  const value = node.value?.value ?? null;
  if (!name && (value === null || value === undefined || value === "")) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// processAccessibilityTree
// ---------------------------------------------------------------------------

/**
 * Processes a flat array of AX nodes into a formatted, indented text tree.
 *
 * - Uses 2-space indentation per depth level.
 * - Caps traversal at maxDepth (default 10).
 * - Prevents cycles via a visited set.
 * - Orders children via childIds[] when present, falling back to children[].
 */
export function processAccessibilityTree(
  nodes: AXNode[],
  options: ProcessTreeOptions,
): string {
  const maxDepth = options.maxDepth ?? 10;

  // Build lookup map: nodeId -> AXNode
  const nodeMap = new Map<string, AXNode>();
  for (const node of nodes) {
    nodeMap.set(node.nodeId, node);
  }

  // Find root node (first node without parentId, or first node)
  let root: AXNode | undefined;
  for (const node of nodes) {
    if (!node.parentId) {
      root = node;
      break;
    }
  }

  if (!root) {
    return "";
  }

  const lines: string[] = [];
  const visited = new Set<string>();

  function traverse(node: AXNode, depth: number): void {
    // Cycle prevention
    if (visited.has(node.nodeId)) {
      return;
    }
    visited.add(node.nodeId);

    // Depth cap
    if (depth > maxDepth) {
      return;
    }

    // Format node line
    const indent = "  ".repeat(depth);
    const role = node.role?.value ?? "unknown";
    const name = node.name?.value ?? "";
    const attrs = formatNodeAttributes(node);

    let line = `${indent}${role}`;
    if (name) {
      line += ` "${name}"`;
    }
    if (attrs) {
      line += ` ${attrs}`;
    }
    lines.push(line);

    // Resolve children: prefer childIds, fall back to children
    const childNodeIds = getChildNodeIds(node);

    for (const childId of childNodeIds) {
      const childNode = nodeMap.get(childId);
      if (childNode) {
        traverse(childNode, depth + 1);
      }
    }
  }

  traverse(root, 0);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helper: get child node IDs
// ---------------------------------------------------------------------------

function getChildNodeIds(node: AXNode): string[] {
  if (node.childIds && node.childIds.length > 0) {
    return node.childIds;
  }
  if (node.children && node.children.length > 0) {
    return node.children.map((c) => c.nodeId);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Helper: format node attributes
// ---------------------------------------------------------------------------

function formatNodeAttributes(node: AXNode): string {
  const parts: string[] = [];

  // Value
  if (node.value?.value !== undefined && node.value.value !== "") {
    parts.push(`value="${node.value.value}"`);
  }

  // Description
  if (node.description?.value) {
    parts.push(`description="${node.description.value}"`);
  }

  // Properties
  if (node.properties) {
    for (const prop of node.properties) {
      switch (prop.name) {
        case "level":
          parts.push(`level=${prop.value.value}`);
          break;
        case "checked": {
          const val = prop.value.value;
          if (val === true || val === "true" || val === "mixed") {
            parts.push("checked");
          }
          break;
        }
        case "selected":
          if (prop.value.value === true) {
            parts.push("selected");
          }
          break;
        case "expanded":
          if (prop.value.value === true || prop.value.value === "true") {
            parts.push("expanded");
          } else {
            parts.push("collapsed");
          }
          break;
        default:
          // Skip other properties
          break;
      }
    }
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// browserSnapshot
// ---------------------------------------------------------------------------

/**
 * Takes an accessibility tree snapshot from the page, assigns @eN refs,
 * and returns formatted text output.
 *
 * @param cdp - CDP connection
 * @param params - Snapshot options
 * @returns SnapshotResult with snapshot text
 */
export async function browserSnapshot(
  cdp: CDPConnection,
  params?: Record<string, unknown>,
): Promise<SnapshotResult> {
  const options: SnapshotOptions = {
    interactive: params?.interactive as boolean | undefined,
    cursor: params?.cursor as boolean | undefined,
    compact: params?.compact as boolean | undefined,
    depth: params?.depth as number | undefined,
    selector: params?.selector as string | undefined,
  };

  // Enable accessibility
  await cdp.send("Accessibility.enable");

  // Get the accessibility tree
  let axNodes: AXNode[];

  if (options.selector) {
    // Scoped snapshot via CSS selector
    const docResult = (await cdp.send("DOM.getDocument")) as {
      root: { nodeId: number };
    };
    const queryResult = (await cdp.send("DOM.querySelector", {
      nodeId: docResult.root.nodeId,
      selector: options.selector,
    })) as { nodeId: number };

    if (queryResult.nodeId === 0) {
      return { snapshot: `No element found for selector: ${options.selector}` };
    }

    const partialResult = (await cdp.send("Accessibility.getPartialAXTree", {
      nodeId: queryResult.nodeId,
      fetchRelatives: true,
    })) as { nodes: AXNode[] };
    axNodes = partialResult.nodes;
  } else {
    // Full page snapshot
    const fullResult = (await cdp.send("Accessibility.getFullAXTree")) as {
      nodes: AXNode[];
    };
    axNodes = fullResult.nodes;
  }

  // Count non-root elements (exclude WebArea root)
  const totalElements = axNodes.filter(
    (n) => n.role?.value !== "WebArea",
  ).length;

  // Build a node map for tree traversal
  const nodeMap = new Map<string, AXNode>();
  for (const node of axNodes) {
    nodeMap.set(node.nodeId, node);
  }

  // Find root node
  let root: AXNode | undefined;
  for (const node of axNodes) {
    if (!node.parentId) {
      root = node;
      break;
    }
  }

  if (!root) {
    // If no root found, use first node
    root = axNodes[0];
  }

  if (!root) {
    return { snapshot: "" };
  }

  // Traverse the tree, filter, assign refs, and format
  const lines: string[] = [];
  let refCounter = 0;
  const visited = new Set<string>();
  const maxDepth = options.depth ?? 100;

  function traverse(node: AXNode, depth: number): void {
    // Cycle prevention
    if (visited.has(node.nodeId)) {
      return;
    }
    visited.add(node.nodeId);

    // Depth limit
    if (depth > maxDepth) {
      return;
    }

    const role = node.role?.value ?? "";
    const isRoot = role === "WebArea";

    // Apply filters
    const showNode = isRoot || shouldShow(node, options);

    if (showNode && !isRoot) {
      refCounter++;
      // Use backendDOMNodeId as ref so tools can resolve it directly
      const ref = node.backendDOMNodeId ? `@e${node.backendDOMNodeId}` : `@e${refCounter}`;
      const indent = "  ".repeat(depth);
      const name = node.name?.value ?? "";
      const attrs = formatNodeAttributes(node);

      let line = `${indent}${ref} ${role}`;
      if (name) {
        line += ` "${name}"`;
      }
      if (attrs) {
        line += ` ${attrs}`;
      }
      lines.push(line);
    }

    // Process children
    const childNodeIds = getChildNodeIds(node);
    const nextDepth = isRoot ? depth : depth + 1;

    for (const childId of childNodeIds) {
      const childNode = nodeMap.get(childId);
      if (childNode) {
        traverse(childNode, nextDepth);
      }
    }
  }

  traverse(root, 0);

  const snapshot = lines.join("\n");
  const result: SnapshotResult = { snapshot };

  // Add truncation info for large pages
  if (totalElements > 1000) {
    result.truncated = true;
    result.totalElements = totalElements;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal show filter (combines shouldShowAxNode with interactive/cursor)
// ---------------------------------------------------------------------------

function shouldShow(node: AXNode, options: SnapshotOptions): boolean {
  // Base filtering via shouldShowAxNode
  if (!shouldShowAxNode(node, { compact: options.compact })) {
    // In compact mode, skip filtered nodes entirely.
    // In normal mode, also skip.
    return false;
  }

  const role = node.role?.value ?? "";

  // Interactive filter: only show interactive roles
  if (options.interactive) {
    if (INTERACTIVE_ROLES.has(role)) {
      return true;
    }
    // If cursor mode is also on, check for cursor:pointer property
    if (options.cursor) {
      return hasCursorPointer(node);
    }
    return false;
  }

  // Cursor filter: include elements with cursor:pointer even if role is generic
  if (options.cursor) {
    if (hasCursorPointer(node)) {
      return true;
    }
  }

  return true;
}

function hasCursorPointer(node: AXNode): boolean {
  if (!node.properties) return false;
  return node.properties.some(
    (p) => p.name === "cursor" && p.value.value === "pointer",
  );
}
