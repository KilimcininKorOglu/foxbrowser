/**
 * browser_inspect_source tool — maps DOM elements to their source code locations.
 *
 * CDP-native resolution:
 *   - React: Walk Fiber tree, parse jsxDEV() calls in Function.toString()
 *     to extract fileName/lineNumber embedded by Babel jsx-source plugin.
 *   - Vue: Read __vueParentComponent.type.__file
 *   - Svelte: Read __svelte_meta.loc
 *
 * Works with React, Vue, Svelte frameworks.
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InspectSourceParams {
  /** @eN ref from accessibility snapshot */
  ref?: string;
  /** CSS selector to find the element */
  selector?: string;
}

export interface SourceLocation {
  filePath: string;
  lineNumber: number | null;
  columnNumber: number | null;
  componentName: string | null;
}

export interface InspectSourceResult {
  tagName: string;
  componentName: string | null;
  source: SourceLocation | null;
  stack: SourceLocation[];
}

// ---------------------------------------------------------------------------
// Ref pattern
// ---------------------------------------------------------------------------

const REF_PATTERN = /^@?e(\d+)$/;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Inspects a DOM element and returns its source code location.
 *
 * Strategy:
 *   1. Resolve element via ref or selector
 *   2. Walk React Fiber tree → parse Function.toString() for fileName/lineNumber
 *   3. Check Vue (__vueParentComponent) and Svelte (__svelte_meta)
 */
export async function browserInspectSource(
  cdp: CDPConnection,
  params: InspectSourceParams,
): Promise<InspectSourceResult> {
  // 1. Resolve element
  let objectId: string;

  if (params.ref) {
    const match = REF_PATTERN.exec(params.ref);
    if (!match) throw new Error(`Invalid ref format: ${params.ref}`);
    const backendNodeId = parseInt(match[1], 10);
    const resolved = (await cdp.send("DOM.resolveNode", { backendNodeId })) as {
      object: { objectId: string };
    };
    objectId = resolved.object.objectId;
  } else if (params.selector) {
    const evalResult = (await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(params.selector)})`,
      returnByValue: false,
    })) as { result: { objectId?: string; subtype?: string } };

    if (!evalResult.result.objectId || evalResult.result.subtype === "null") {
      throw new Error(`Element not found: ${params.selector}`);
    }
    objectId = evalResult.result.objectId;
  } else {
    throw new Error("Either ref or selector must be provided");
  }

  // 2. CDP-native: Walk Fiber tree + parse Function.toString()
  const cdpResult = (await cdp.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: `function() {
      var el = this;
      var tagName = (el.tagName || '').toLowerCase();

      // Find React Fiber
      var fiberKey = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber'); });

      // Also check Vue, Svelte
      var vueComp = el.__vueParentComponent;
      var svelteMeta = el.__svelte_meta;

      if (!fiberKey && !vueComp && !svelteMeta) {
        return JSON.stringify({ tagName: tagName, componentName: null, source: null, stack: [], framework: null });
      }

      // --- React path ---
      if (fiberKey) {
        var fiber = el[fiberKey];
        var stack = [];
        var current = fiber;
        var firstSource = null;
        var firstName = null;

        while (current && stack.length < 15) {
          if (typeof current.type === 'function' && current.type.name) {
            var fn = current.type;
            var fnStr = fn.toString();
            var fileName = null;
            var lineNumber = null;
            var columnNumber = null;

            // Parse jsxDEV calls for embedded fileName/lineNumber
            var fileMatch = fnStr.match(/fileName:\\s*"([^"]+)"/);
            if (fileMatch) {
              fileName = fileMatch[1];
              var lineMatch = fnStr.match(/lineNumber:\\s*(\\d+)/);
              if (lineMatch) lineNumber = parseInt(lineMatch[1]);
              var colMatch = fnStr.match(/columnNumber:\\s*(\\d+)/);
              if (colMatch) columnNumber = parseInt(colMatch[1]);
            }

            var entry = {
              filePath: fileName,
              lineNumber: lineNumber,
              columnNumber: columnNumber,
              componentName: fn.name
            };

            stack.push(entry);

            if (fileName && !firstSource) {
              firstSource = entry;
            }
            if (!firstName && fn.name.length > 1) {
              firstName = fn.name;
            }
          }
          current = current.return;
        }

        return JSON.stringify({
          tagName: tagName,
          componentName: firstName || null,
          source: firstSource || (stack.length > 0 ? { filePath: null, lineNumber: null, columnNumber: null, componentName: stack[0].componentName } : null),
          stack: stack.filter(function(s) { return s.filePath; }),
          framework: 'react'
        });
      }

      // --- Svelte path ---
      if (svelteMeta) {
        var loc = svelteMeta.loc || {};
        return JSON.stringify({
          tagName: tagName,
          componentName: loc.char ? null : (svelteMeta.component || null),
          source: loc.file ? { filePath: loc.file, lineNumber: loc.line || null, columnNumber: (loc.column || 0) + 1, componentName: null } : null,
          stack: [],
          framework: 'svelte'
        });
      }

      // --- Vue path ---
      if (vueComp) {
        var comp = vueComp;
        var vueName = comp.type?.__name || comp.type?.name || null;
        var vueFile = comp.type?.__file || null;
        return JSON.stringify({
          tagName: tagName,
          componentName: vueName,
          source: vueFile ? { filePath: vueFile, lineNumber: null, columnNumber: null, componentName: vueName } : null,
          stack: [],
          framework: 'vue'
        });
      }

      return JSON.stringify({ tagName: tagName, componentName: null, source: null, stack: [], framework: null });
    }`,
    returnByValue: true,
  })) as { result: { value: string } };

  return JSON.parse(cdpResult.result.value) as InspectSourceResult;
}
