/**
 * Console.table to Markdown table formatter.
 *
 * Exports:
 *  - toMarkdownTable(data)      — array of objects/primitives → markdown table string
 *  - detectConsoleTable(msg, data?) — detect if a message represents console.table
 *  - formatConsoleTable(data, opts?) — full formatter with index column + truncation
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeCell(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  const str = String(value);
  return str.replace(/\|/g, "\\|");
}

function collectKeys(data: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const row of data) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys;
}

function buildTable(headers: string[], rows: string[][]): string {
  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const dataLines = rows.map((row) => `| ${row.join(" | ")} |`);
  return [headerLine, separatorLine, ...dataLines].join("\n");
}

// ---------------------------------------------------------------------------
// isPrimitive — true for anything that is NOT a plain object or array
// ---------------------------------------------------------------------------

function isPrimitive(val: unknown): boolean {
  return val === null || val === undefined || typeof val !== "object";
}

// ---------------------------------------------------------------------------
// toMarkdownTable
// ---------------------------------------------------------------------------

export function toMarkdownTable(data: unknown[]): string {
  if (data.length === 0) return "";

  // Primitive array → Index / Value columns
  if (data.every((item) => isPrimitive(item))) {
    const headers = ["Index", "Value"];
    const rows = data.map((item, i) => [String(i), escapeCell(item)]);
    return buildTable(headers, rows);
  }

  // Array of objects
  const objData = data as Record<string, unknown>[];
  const keys = collectKeys(objData);
  const rows = objData.map((row) =>
    keys.map((k) => {
      const val = row[k];
      if (val === undefined) return "";
      return escapeCell(val);
    }),
  );
  return buildTable(keys, rows);
}

// ---------------------------------------------------------------------------
// detectConsoleTable
// ---------------------------------------------------------------------------

export function detectConsoleTable(message: string, data?: unknown): boolean {
  if (message.includes("console.table")) return true;

  // If data is provided and is an array, treat as console.table payload
  if (data !== undefined && Array.isArray(data)) return true;

  // Try to parse message as JSON array
  try {
    const parsed = JSON.parse(message);
    if (Array.isArray(parsed)) return true;
  } catch {
    // not JSON
  }

  return false;
}

// ---------------------------------------------------------------------------
// formatConsoleTable
// ---------------------------------------------------------------------------

export function formatConsoleTable(
  data: unknown[],
  options?: { maxRows?: number },
): string {
  const maxRows = options?.maxRows ?? 100;

  // Normalize data: flatten nested objects, handle array-of-arrays
  const normalized = normalizeData(data);
  const truncated = normalized.length > maxRows;
  const displayData = truncated ? normalized.slice(0, maxRows) : normalized;

  if (displayData.length === 0) return "";

  // Collect headers: (Index) + data keys
  const dataKeys = collectKeys(displayData);
  const headers = ["(Index)", ...dataKeys];

  const rows = displayData.map((row, i) => {
    const cells = dataKeys.map((k) => {
      const val = row[k];
      if (val === undefined) return "";
      if (val !== null && typeof val === "object") return escapeCell(JSON.stringify(val));
      return escapeCell(val);
    });
    return [String(i), ...cells];
  });

  let table = buildTable(headers, rows);

  if (truncated) {
    const remaining = normalized.length - maxRows;
    table += `\n... ${remaining} more rows`;
  }

  return table;
}

// ---------------------------------------------------------------------------
// normalizeData — convert array-of-arrays and flatten nested objects
// ---------------------------------------------------------------------------

function normalizeData(data: unknown[]): Record<string, unknown>[] {
  return data.map((item) => {
    if (Array.isArray(item)) {
      // Array row → numeric keys
      const obj: Record<string, unknown> = {};
      item.forEach((val, idx) => {
        obj[String(idx)] = val;
      });
      return obj;
    }
    if (item !== null && typeof item === "object") {
      return item as Record<string, unknown>;
    }
    // Primitive → wrap as { Value: item }
    return { Value: item };
  });
}
