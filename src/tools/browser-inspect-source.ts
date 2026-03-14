/**
 * browser_inspect_source tool — maps DOM elements to their source code locations via BiDi.
 *
 * Uses script.callFunction to walk framework internals:
 *   - React: Walk Fiber tree, parse jsxDEV() calls for fileName/lineNumber
 *   - Vue: Read __vueParentComponent.type.__file
 *   - Svelte: Read __svelte_meta.loc
 */
import type { BiDiConnection } from "../bidi/connection.js";

export interface InspectSourceParams {
  ref?: string;
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

const REF_PATTERN = /^@?e(\d+)$/;

export async function browserInspectSource(
  bidi: BiDiConnection,
  params: InspectSourceParams,
): Promise<InspectSourceResult> {
  let resolveExpr: string;

  if (params.ref) {
    const match = REF_PATTERN.exec(params.ref);
    if (!match) throw new Error(`Invalid ref format: ${params.ref}`);
    const nodeId = match[1];
    resolveExpr = `(function() {
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      var count = 0; var node = walker.currentNode;
      while (node) { count++; if (count === ${nodeId}) return node; node = walker.nextNode(); if (!node) break; }
      return null;
    })()`;
  } else if (params.selector) {
    resolveExpr = `document.querySelector(${JSON.stringify(params.selector)})`;
  } else {
    throw new Error("Either ref or selector must be provided");
  }

  const inspectFn = `(function() {
    var el = ${resolveExpr};
    if (!el) return JSON.stringify({ tagName: 'unknown', componentName: null, source: null, stack: [], framework: null });

    var tagName = (el.tagName || '').toLowerCase();
    var fiberKey = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber'); });
    var vueComp = el.__vueParentComponent;
    var svelteMeta = el.__svelte_meta;

    if (!fiberKey && !vueComp && !svelteMeta) {
      return JSON.stringify({ tagName: tagName, componentName: null, source: null, stack: [], framework: null });
    }

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

          var fileMatch = fnStr.match(/fileName:\\s*"([^"]+)"/);
          if (fileMatch) {
            fileName = fileMatch[1];
            var lineMatch = fnStr.match(/lineNumber:\\s*(\\d+)/);
            if (lineMatch) lineNumber = parseInt(lineMatch[1]);
            var colMatch = fnStr.match(/columnNumber:\\s*(\\d+)/);
            if (colMatch) columnNumber = parseInt(colMatch[1]);
          }

          var entry = { filePath: fileName, lineNumber: lineNumber, columnNumber: columnNumber, componentName: fn.name };
          stack.push(entry);
          if (fileName && !firstSource) firstSource = entry;
          if (!firstName && fn.name.length > 1) firstName = fn.name;
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

    if (vueComp) {
      var comp = vueComp;
      var vueName = comp.type && (comp.type.__name || comp.type.name) || null;
      var vueFile = comp.type && comp.type.__file || null;
      return JSON.stringify({
        tagName: tagName,
        componentName: vueName,
        source: vueFile ? { filePath: vueFile, lineNumber: null, columnNumber: null, componentName: vueName } : null,
        stack: [],
        framework: 'vue'
      });
    }

    return JSON.stringify({ tagName: tagName, componentName: null, source: null, stack: [], framework: null });
  })()`;

  const result = (await bidi.send("script.evaluate", {
    expression: inspectFn,
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { value: string } };

  return JSON.parse(result.result.value) as InspectSourceResult;
}
