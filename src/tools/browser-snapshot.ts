/**
 * browser_snapshot tool — captures an accessibility-like tree snapshot via BiDi.
 *
 * Since BiDi has no Accessibility domain, we use JS-based DOM traversal
 * with ARIA attributes, implicit roles, and element properties to build
 * a tree representation with @eN refs for each element.
 *
 * @module browser-snapshot
 */
import type { BiDiConnection } from "../bidi/connection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotOptions {
  interactive?: boolean;
  cursor?: boolean;
  compact?: boolean;
  depth?: number;
  selector?: string;
}

export interface ProcessTreeOptions {
  maxDepth?: number;
}

export interface SnapshotResult {
  snapshot: string;
  truncated?: boolean;
  totalElements?: number;
}

// ---------------------------------------------------------------------------
// Interactive role set
// ---------------------------------------------------------------------------

const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "checkbox", "radio", "combobox",
  "listbox", "menuitem", "menuitemcheckbox", "menuitemradio",
  "option", "searchbox", "slider", "spinbutton", "switch", "tab", "treeitem",
]);

// ---------------------------------------------------------------------------
// shouldShowAxNode (kept for test compatibility)
// ---------------------------------------------------------------------------

interface AXNode {
  nodeId: string;
  backendDOMNodeId?: number;
  role?: { type: string; value: string };
  name?: { type: string; value: string };
  description?: { type: string; value: string };
  value?: { type: string; value: string } | null;
  properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
  parentId?: string;
  children?: Array<{ nodeId: string; backendDOMNodeId?: number }>;
  childIds?: string[];
}

export function shouldShowAxNode(
  node: AXNode,
  options?: { compact?: boolean },
): boolean {
  const role = node.role?.value ?? "";
  if (role === "none") return false;
  if (role === "generic") {
    const name = node.name?.value ?? "";
    if (!name) return false;
  }
  if (options?.compact && role === "InlineTextBox") return false;
  const name = node.name?.value ?? "";
  const value = node.value?.value ?? null;
  if (!name && (value === null || value === undefined || value === "")) return false;
  return true;
}

// ---------------------------------------------------------------------------
// processAccessibilityTree (kept for test compatibility)
// ---------------------------------------------------------------------------

export function processAccessibilityTree(
  nodes: AXNode[],
  options: ProcessTreeOptions,
): string {
  const maxDepth = options.maxDepth ?? 10;
  const nodeMap = new Map<string, AXNode>();
  for (const node of nodes) nodeMap.set(node.nodeId, node);

  let root: AXNode | undefined;
  for (const node of nodes) {
    if (!node.parentId) { root = node; break; }
  }
  if (!root) return "";

  const lines: string[] = [];
  const visited = new Set<string>();

  function traverse(node: AXNode, depth: number): void {
    if (visited.has(node.nodeId)) return;
    visited.add(node.nodeId);
    if (depth > maxDepth) return;

    const indent = "  ".repeat(depth);
    const role = node.role?.value ?? "unknown";
    const name = node.name?.value ?? "";
    let line = `${indent}${role}`;
    if (name) line += ` "${name}"`;
    lines.push(line);

    const childIds = node.childIds ?? node.children?.map(c => c.nodeId) ?? [];
    for (const childId of childIds) {
      const child = nodeMap.get(childId);
      if (child) traverse(child, depth + 1);
    }
  }

  traverse(root, 0);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// browserSnapshot (BiDi implementation)
// ---------------------------------------------------------------------------

export async function browserSnapshot(
  bidi: BiDiConnection,
  params?: Record<string, unknown>,
): Promise<SnapshotResult> {
  const options: SnapshotOptions = {
    interactive: params?.interactive as boolean | undefined,
    cursor: params?.cursor as boolean | undefined,
    compact: params?.compact as boolean | undefined,
    depth: params?.depth as number | undefined,
    selector: params?.selector as string | undefined,
  };

  const maxDepth = options.depth ?? 100;
  const interactiveOnly = options.interactive ?? false;
  const selectorScope = options.selector ? JSON.stringify(options.selector) : "null";

  // JS-based accessibility tree builder
  const response = (await bidi.send("script.evaluate", {
    expression: `(() => {
      const implicit = {
        a:'link',button:'button',input:'textbox',select:'combobox',textarea:'textbox',
        h1:'heading',h2:'heading',h3:'heading',h4:'heading',h5:'heading',h6:'heading',
        img:'img',nav:'navigation',form:'form',table:'table',ul:'list',ol:'list',li:'listitem',
        header:'banner',footer:'contentinfo',main:'main',aside:'complementary',section:'region',
        article:'article',details:'group',summary:'button',dialog:'dialog',
        progress:'progressbar',meter:'meter',output:'status',
      };
      const interactiveRoles = new Set(['button','link','textbox','checkbox','radio','combobox','listbox','menuitem','menuitemcheckbox','menuitemradio','option','searchbox','slider','spinbutton','switch','tab','treeitem']);
      const interactiveOnly = ${interactiveOnly};
      const maxDepth = ${maxDepth};
      const selectorScope = ${selectorScope};

      const root = selectorScope ? document.querySelector(selectorScope) : document.body;
      if (!root) return { snapshot: selectorScope ? 'No element found for selector: ' + selectorScope : '', total: 0 };

      const lines = [];
      let total = 0;
      let counter = 0;

      function getRole(el) {
        return el.getAttribute('role') || implicit[el.tagName.toLowerCase()] || el.tagName.toLowerCase();
      }

      function getName(el) {
        return el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || '';
      }

      function getValue(el) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return el.value || '';
        return '';
      }

      function getAttrs(el) {
        const parts = [];
        const val = getValue(el);
        if (val) parts.push('value="' + val.slice(0, 50) + '"');
        if (el.checked) parts.push('checked');
        if (el.selected) parts.push('selected');
        if (el.disabled) parts.push('disabled');
        const level = el.getAttribute('aria-level');
        if (level) parts.push('level=' + level);
        const expanded = el.getAttribute('aria-expanded');
        if (expanded === 'true') parts.push('expanded');
        else if (expanded === 'false') parts.push('collapsed');
        return parts.join(' ');
      }

      function traverse(el, depth) {
        if (depth > maxDepth) return;
        counter++;
        const role = getRole(el);
        let name = getName(el);

        if (!name && el.childNodes.length > 0) {
          let textContent = '';
          for (const child of el.childNodes) {
            if (child.nodeType === 3) textContent += child.textContent;
          }
          name = textContent.trim().slice(0, 50);
        }

        const shouldShow = name || getValue(el) || role === 'textbox' || role === 'button' || role === 'link';

        if (interactiveOnly && !interactiveRoles.has(role)) {
          // Still traverse children
          for (const child of el.children) traverse(child, depth);
          return;
        }

        if (shouldShow) {
          total++;
          const indent = '  '.repeat(depth);
          const ref = '@e' + counter;
          const attrs = getAttrs(el);
          let line = indent + ref + ' ' + role;
          if (name) line += ' "' + name.replace(/"/g, '\\\\"') + '"';
          if (attrs) line += ' ' + attrs;
          lines.push(line);
        }

        for (const child of el.children) {
          traverse(child, depth + (shouldShow ? 1 : 0));
        }
      }

      traverse(root, 0);
      return { snapshot: lines.join('\\n'), total };
    })()`,
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { value?: { snapshot: string; total: number } } };

  const data = response.result?.value;
  if (!data) return { snapshot: "" };

  const result: SnapshotResult = { snapshot: data.snapshot };
  if (data.total > 1000) {
    result.truncated = true;
    result.totalElements = data.total;
  }

  return result;
}
