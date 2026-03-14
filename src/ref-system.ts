/**
 * Ref System — maps accessibility tree nodes to stable @eN references.
 *
 * Each snapshot/rebuild produces a fresh set of sequential refs (@e1, @e2, ...)
 * that can be resolved back to backendNodeIds for interaction tools.
 *
 * @module ref-system
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single ref entry produced by buildRefs. */
export interface RefEntry {
  /** The @eN ref string, e.g. "@e1" */
  ref: string;
  /** CDP backendNodeId for DOM.resolveNode */
  backendNodeId: number;
  /** Accessibility role (e.g. "button", "heading", "textbox") */
  role: string;
  /** Accessible name */
  name: string;
  /** Accessible description, if present */
  description?: string;
  /** Current value (for textboxes, comboboxes, etc.) */
  value?: string;
  /** Checked state (for checkboxes, radio buttons) */
  checked?: boolean;
  /** Selected state (for options) */
  selected?: boolean;
  /** Expanded state (for comboboxes, tree items) */
  expanded?: boolean;
  /** Heading level (for headings) */
  level?: number;
}

/**
 * Shape of an accessibility tree node as returned by CDP
 * Accessibility.getFullAXTree / getPartialAXTree.
 */
interface AXNode {
  nodeId: string;
  backendNodeId: number;
  role?: { type: string; value: string };
  name?: { type: string; value: string };
  description?: { type: string; value: string };
  value?: { type: string; value: string };
  properties?: Array<{
    name: string;
    value: { type: string; value: unknown };
  }>;
  parentId?: string;
  children?: Array<{ nodeId: string; backendNodeId: number }>;
}

// ---------------------------------------------------------------------------
// Ref pattern
// ---------------------------------------------------------------------------

const REF_PATTERN = /^@e(\d+)$/;

// ---------------------------------------------------------------------------
// RefSystem
// ---------------------------------------------------------------------------

/**
 * Manages the mapping between @eN refs and accessibility tree nodes.
 *
 * Lifecycle:
 *   1. `buildRefs(nodes)` — processes an AX tree, assigns sequential refs,
 *      caches the result, and returns the ref entries.
 *   2. `resolve(ref)` — looks up a cached ref entry by its @eN string.
 *   3. `invalidate()` — clears the cache (e.g. on navigation).
 */
export class RefSystem {
  private cache: Map<string, RefEntry> = new Map();

  /**
   * Build ref entries from an accessibility tree node list.
   *
   * - Skips the root WebArea node.
   * - Assigns sequential @e1, @e2, ... refs to remaining nodes.
   * - Replaces any previously cached refs (counter resets).
   *
   * @param nodes - Flat array of AX nodes from CDP.
   * @returns Array of RefEntry objects.
   */
  buildRefs(nodes: AXNode[]): RefEntry[] {
    this.cache.clear();

    const entries: RefEntry[] = [];
    let counter = 0;

    for (const node of nodes) {
      const role = node.role?.value;

      // Skip the root WebArea node
      if (role === "WebArea") {
        continue;
      }

      counter++;
      const ref = `@e${counter}`;

      const entry: RefEntry = {
        ref,
        backendNodeId: node.backendNodeId,
        role: role ?? "unknown",
        name: node.name?.value ?? "",
      };

      // Description
      if (node.description?.value) {
        entry.description = node.description.value;
      }

      // Value
      if (node.value?.value !== undefined) {
        entry.value = node.value.value;
      }

      // Properties
      if (node.properties) {
        for (const prop of node.properties) {
          switch (prop.name) {
            case "checked": {
              const val = prop.value.value;
              entry.checked =
                val === true || val === "true" || val === "mixed";
              break;
            }
            case "selected":
              entry.selected = prop.value.value === true;
              break;
            case "expanded":
              entry.expanded = prop.value.value === true || prop.value.value === "true";
              break;
            case "level":
              entry.level = prop.value.value as number;
              break;
          }
        }
      }

      entries.push(entry);
      this.cache.set(ref, entry);
    }

    return entries;
  }

  /**
   * Resolve an @eN ref string to its cached RefEntry.
   *
   * @param ref - The ref string, e.g. "@e1".
   * @returns The RefEntry if found, otherwise undefined.
   */
  resolve(ref: string): RefEntry | undefined {
    // Validate format
    const match = REF_PATTERN.exec(ref);
    if (!match) {
      return undefined;
    }

    const index = parseInt(match[1], 10);
    if (index < 1) {
      return undefined;
    }

    return this.cache.get(ref);
  }

  /**
   * Invalidate (clear) all cached refs.
   * Called on page navigation or when the DOM has changed significantly.
   */
  invalidate(): void {
    this.cache.clear();
  }
}
