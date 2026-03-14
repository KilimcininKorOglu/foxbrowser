/**
 * browser_html tool — retrieves page or element HTML via CDP.
 *
 * Supports:
 *  - Full page HTML (document.documentElement.outerHTML)
 *  - Element HTML by CSS selector (DOM.querySelector + DOM.getOuterHTML)
 *  - Graceful handling of missing selectors
 *
 * @module browser-html
 */
import type { BiDiConnection } from "../bidi/connection.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HtmlParams {
  /** CSS selector to retrieve outerHTML for a specific element. */
  selector?: string;
}

interface HtmlResult {
  /** The retrieved HTML string. */
  html: string;
  /** Error message when element is not found. */
  error?: string;
}

interface MarkdownParams {
  /** CSS selector to scope markdown extraction. */
  selector?: string;
}

interface MarkdownResult {
  /** Extracted markdown content. */
  markdown: string;
}

// ---------------------------------------------------------------------------
// HTML retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieve the outer HTML of the page or a specific element.
 *
 * Without a selector, returns document.documentElement.outerHTML via
 * Runtime.evaluate.
 *
 * With a selector, uses DOM.getDocument → DOM.querySelector → DOM.getOuterHTML.
 *
 * @param cdp - CDP connection.
 * @param params - Optional selector parameter.
 * @returns The HTML string, or an error if the element is not found.
 */
export async function browserHtml(
  bidi: BiDiConnection,
  params: HtmlParams,
): Promise<HtmlResult> {
  if (!params.selector) {
    const evalResult = (await bidi.send("script.evaluate", {
      expression: "document.documentElement.outerHTML",
      awaitPromise: false,
      resultOwnership: "none",
    })) as {
      result: { type: string; value: string };
    };

    return { html: evalResult.result?.value ?? "" };
  }

  const queryResult = (await bidi.send("script.callFunction", {
    functionDeclaration: `(sel) => {
      const el = document.querySelector(sel);
      return el ? el.outerHTML : null;
    }`,
    arguments: [{ type: "string", value: params.selector }],
    awaitPromise: false,
    resultOwnership: "none",
  })) as { result: { type: string; value: string | null } };

  if (!queryResult.result?.value) {
    return {
      html: "",
      error: `Element not found: ${params.selector}`,
    };
  }

  return { html: queryResult.result.value };
}

// ---------------------------------------------------------------------------
// HTML → Markdown conversion
// ---------------------------------------------------------------------------

/**
 * Minimal HTML-to-Markdown converter.
 *
 * Handles:
 *  - Headings (h1-h6) → # syntax
 *  - Code blocks (<pre><code>) → fenced ``` blocks
 *  - Tables → markdown table syntax with separator row
 *  - Navigation/sidebar exclusion (<nav>, <aside>)
 *  - Paragraphs → plain text with newlines
 */
function htmlToMarkdown(html: string): string {
  let content = html;

  // Strip <nav> and <aside> elements and their contents
  content = content.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, "");
  content = content.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, "");

  const lines: string[] = [];

  // Process code blocks first (before stripping tags)
  content = content.replace(
    /<pre[^>]*>\s*<code(?:\s+class="language-(\w+)")?[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_match, lang, code) => {
      const language = lang ?? "";
      const decoded = decodeHtmlEntities(code.trim());
      return `\n\`\`\`${language}\n${decoded}\n\`\`\`\n`;
    },
  );

  // Process tables
  content = content.replace(
    /<table[^>]*>([\s\S]*?)<\/table>/gi,
    (_match, tableContent: string) => {
      const rows: string[][] = [];

      // Extract thead rows
      const theadMatch = tableContent.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
      if (theadMatch) {
        const headerRows = extractTableRows(theadMatch[1]);
        rows.push(...headerRows);
      }

      // Extract tbody rows
      const tbodyMatch = tableContent.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
      if (tbodyMatch) {
        const bodyRows = extractTableRows(tbodyMatch[1]);
        // Insert separator after header
        if (rows.length > 0 && bodyRows.length > 0) {
          const colCount = rows[0].length;
          const separator = Array(colCount).fill("---");
          rows.push(separator);
        }
        rows.push(...bodyRows);
      }

      // If no thead/tbody, extract all rows directly
      if (!theadMatch && !tbodyMatch) {
        const allRows = extractTableRows(tableContent);
        if (allRows.length > 1) {
          const colCount = allRows[0].length;
          const separator = Array(colCount).fill("---");
          const result = [allRows[0], separator, ...allRows.slice(1)];
          return "\n" + result.map((r) => "| " + r.join(" | ") + " |").join("\n") + "\n";
        }
        return "\n" + allRows.map((r) => "| " + r.join(" | ") + " |").join("\n") + "\n";
      }

      return "\n" + rows.map((r) => "| " + r.join(" | ") + " |").join("\n") + "\n";
    },
  );

  // Process headings
  content = content.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, text) => `\n# ${stripTags(text).trim()}\n`);
  content = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, text) => `\n## ${stripTags(text).trim()}\n`);
  content = content.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, text) => `\n### ${stripTags(text).trim()}\n`);
  content = content.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_m, text) => `\n#### ${stripTags(text).trim()}\n`);
  content = content.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_m, text) => `\n##### ${stripTags(text).trim()}\n`);
  content = content.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_m, text) => `\n###### ${stripTags(text).trim()}\n`);

  // Process paragraphs
  content = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, text) => `\n${stripTags(text).trim()}\n`);

  // Strip remaining HTML tags
  content = stripTags(content);

  // Decode HTML entities
  content = decodeHtmlEntities(content);

  // Normalize whitespace: collapse multiple blank lines
  content = content.replace(/\n{3,}/g, "\n\n");

  return content.trim();
}

/**
 * Extract rows from an HTML table section.
 */
function extractTableRows(html: string): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(stripTags(cellMatch[1]).trim());
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
}

/**
 * Strip all HTML tags from a string.
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/**
 * Decode common HTML entities.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// ---------------------------------------------------------------------------
// extractContentAsMarkdown
// ---------------------------------------------------------------------------

/**
 * Extract the page content as Markdown.
 *
 * Fetches the full page HTML via Runtime.evaluate, then converts to markdown
 * using a lightweight HTML-to-Markdown converter that:
 *  - Converts headings to # syntax
 *  - Wraps code blocks in fenced markdown
 *  - Converts tables to markdown tables
 *  - Excludes nav/aside elements
 *
 * @param cdp - CDP connection.
 * @param params - Optional selector to scope extraction.
 * @returns Markdown string.
 */
export async function extractContentAsMarkdown(
  bidi: BiDiConnection,
  params: MarkdownParams,
): Promise<MarkdownResult> {
  const evalResult = (await bidi.send("script.evaluate", {
    expression: "document.documentElement.outerHTML",
    awaitPromise: false,
    resultOwnership: "none",
  })) as {
    result: { type: string; value: string };
  };

  const html = evalResult.result?.value ?? "";
  const markdown = htmlToMarkdown(html);

  return { markdown };
}
