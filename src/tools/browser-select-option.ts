/**
 * browser_select_option tool — Selects options in a <select> element.
 *
 * Resolves the element via @eN ref (backendNodeId), sets the selected
 * options, and dispatches input + change events.
 */
import type { CDPConnection } from "../cdp/connection";

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

interface SelectOptionParams {
  /** @eN ref string, e.g. "@e4" */
  ref: string;
  /** Values to select (by value attribute or label text) */
  values: string[];
  /** Human-readable element description */
  element: string;
}

interface SelectOptionResult {
  success: boolean;
  selected: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the backendNodeId from an @eN ref string.
 * In production this would use the RefSystem; for now we parse the number directly.
 */
function refToBackendNodeId(ref: string): number {
  const match = /^@?e(\d+)$/.exec(ref);
  if (!match) {
    throw new Error(`Invalid ref format: ${ref}`);
  }
  return parseInt(match[1], 10);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Selects one or more options in a <select> element.
 *
 * - Resolves the @eN ref to a backendNodeId
 * - Uses DOM.resolveNode to get an objectId
 * - Calls Runtime.callFunctionOn to set selected options and dispatch events
 */
export async function browserSelectOption(
  cdp: CDPConnection,
  params: SelectOptionParams,
): Promise<SelectOptionResult> {
  const backendNodeId = refToBackendNodeId(params.ref);

  // Resolve the node to get an objectId for Runtime.callFunctionOn
  const resolveResponse = (await cdp.send("DOM.resolveNode", {
    backendNodeId,
  })) as { object: { objectId: string } };

  const objectId = resolveResponse.object.objectId;
  const valuesJson = JSON.stringify(params.values);

  // Select the options and dispatch events
  const result = (await cdp.send("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: `function() {
      var select = this;
      if (select.tagName !== 'SELECT') {
        throw new Error('Element is not a SELECT');
      }
      var values = ${valuesJson};
      var matched = [];

      for (var i = 0; i < select.options.length; i++) {
        var option = select.options[i];
        var isMatch = values.indexOf(option.value) !== -1 ||
                      values.indexOf(option.textContent.trim()) !== -1;
        option.selected = isMatch;
        if (isMatch) {
          matched.push(option.value);
        }
      }

      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));

      return matched;
    }`,
    returnByValue: true,
  })) as { result: { type: string; value: unknown } };

  const selected = (result.result.value as string[]) ?? [];

  return {
    success: true,
    selected,
  };
}
