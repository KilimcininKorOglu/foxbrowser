/**
 * Observation CLI commands for browsirai.
 *
 * Commands: snapshot, screenshot, html, eval, find, source, console, network
 *
 * @module cli/commands/obs
 */

import { writeFileSync } from "node:fs";
import type { CLICommand } from "../types.js";
import { parseFlags } from "../run.js";
import { browserSnapshot } from "../../tools/browser-snapshot.js";
import { browserScreenshot } from "../../tools/browser-screenshot.js";
import { browserHtml } from "../../tools/browser-html.js";
import { browserEval } from "../../tools/browser-eval.js";
import { browserFind } from "../../tools/browser-find.js";
import { browserInspectSource } from "../../tools/browser-inspect-source.js";
import { browserConsoleMessages } from "../../tools/browser-console-messages.js";
import { browserNetworkRequests } from "../../tools/browser-network-requests.js";

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

const snapshotCommand: CLICommand = {
  name: "snapshot",
  description: "Capture the accessibility tree of the page",
  usage: "browsirai snapshot [-i] [-c] [-d N] [-s selector]",
  run: async (cdp, args) => {
    const flags = parseFlags(args);

    const params: Record<string, unknown> = {};
    if (flags.compact === "true" || flags.c === "true") params.compact = true;
    if (flags.interactive === "true" || flags.i === "true") params.interactive = true;
    if (flags.selector) params.selector = flags.selector;
    if (flags.s) params.selector = flags.s;
    if (flags.depth) params.depth = parseInt(flags.depth, 10);
    if (flags.d) params.depth = parseInt(flags.d, 10);

    const result = await browserSnapshot(cdp, params);

    if (result.snapshot) {
      console.log(result.snapshot);
    } else {
      console.log("(empty snapshot)");
    }

    if (result.truncated) {
      console.log(`\n(truncated — ${result.totalElements} total elements)`);
    }
  },
};

// ---------------------------------------------------------------------------
// screenshot
// ---------------------------------------------------------------------------

const screenshotCommand: CLICommand = {
  name: "screenshot",
  description: "Capture a screenshot of the page",
  usage: "browsirai screenshot [-o file.png] [--fullPage] [--selector=...] [--format=png]",
  run: async (cdp, args) => {
    const flags = parseFlags(args);

    const params: Record<string, unknown> = {};
    if (flags.fullPage === "true") params.fullPage = true;
    if (flags.selector) params.selector = flags.selector;
    if (flags.format) params.format = flags.format;

    const result = await browserScreenshot(cdp, params);

    const output = flags.output ?? flags.o;
    if (output) {
      const buffer = Buffer.from(result.base64, "base64");
      writeFileSync(output, buffer);
      console.log(`Screenshot saved to ${output} (${buffer.length} bytes)`);
    } else {
      // Estimate dimensions from base64 data length
      const sizeKB = Math.round((result.base64.length * 3) / 4 / 1024);
      console.log(`Screenshot taken (~${sizeKB}KB)`);
      console.log("Use --output=file.png to save to disk");
    }
  },
};

// ---------------------------------------------------------------------------
// html
// ---------------------------------------------------------------------------

const htmlCommand: CLICommand = {
  name: "html",
  description: "Retrieve page or element HTML",
  usage: "browsirai html [--selector=...]",
  run: async (cdp, args) => {
    const flags = parseFlags(args);

    const params: { selector?: string } = {};
    if (flags.selector) params.selector = flags.selector;

    const result = await browserHtml(cdp, params);

    if (result.error) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    console.log(result.html);
  },
};

// ---------------------------------------------------------------------------
// eval
// ---------------------------------------------------------------------------

const evalCommand: CLICommand = {
  name: "eval",
  description: "Evaluate a JavaScript expression in the browser",
  usage: 'browsirai eval "<expression>"',
  run: async (cdp, args) => {
    const flags = parseFlags(args);

    // First positional arg is the JS expression
    const expression = flags._0;
    if (!expression) {
      console.error("Error: Missing expression argument");
      console.error('Usage: browsirai eval "<expression>"');
      process.exit(1);
    }

    const result = await browserEval(cdp, { expression });

    if (result.error) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    if (result.result === undefined) {
      console.log("undefined");
    } else if (result.result === null) {
      console.log("null");
    } else if (typeof result.result === "object") {
      console.log(JSON.stringify(result.result, null, 2));
    } else {
      console.log(String(result.result));
    }
  },
};

// ---------------------------------------------------------------------------
// find
// ---------------------------------------------------------------------------

const findCommand: CLICommand = {
  name: "find",
  description: "Find elements by ARIA role, name, or text",
  usage: "browsirai find [--role=button] [--name=...] [--text=...]",
  run: async (cdp, args) => {
    const flags = parseFlags(args);

    const params: Record<string, unknown> = {};
    if (flags.role) params.role = flags.role;
    if (flags.name) params.name = flags.name;
    if (flags.text) params.text = flags.text;
    if (flags.nth) params.nth = parseInt(flags.nth, 10);

    const result = await browserFind(cdp, params);

    if (result.found) {
      console.log(`Found ${result.ref} (role: ${result.role}, name: "${result.name}")`);
      if (result.count > 1) {
        console.log(`  ${result.count} total matches`);
      }
    } else {
      console.log("Not found");
      if (result.count > 0) {
        console.log(`  ${result.count} matches exist but index out of range`);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// source
// ---------------------------------------------------------------------------

const sourceCommand: CLICommand = {
  name: "source",
  description: "Inspect source code location of an element",
  usage: "browsirai source [--ref=@e5] [--selector=h1]",
  run: async (cdp, args) => {
    const flags = parseFlags(args);

    const params: { ref?: string; selector?: string } = {};
    if (flags.ref) params.ref = flags.ref;
    if (flags.selector) params.selector = flags.selector;

    if (!params.ref && !params.selector) {
      console.error("Error: Either --ref or --selector is required");
      console.error("Usage: browsirai source [--ref=@e5] [--selector=h1]");
      process.exit(1);
    }

    const result = await browserInspectSource(cdp, params);

    if (result.source) {
      const loc = result.source;
      const file = loc.filePath ?? "(unknown file)";
      const line = loc.lineNumber != null ? `:${loc.lineNumber}` : "";
      const col = loc.columnNumber != null ? `:${loc.columnNumber}` : "";
      const component = result.componentName ?? loc.componentName ?? "(anonymous)";
      console.log(`Component: ${component}`);
      console.log(`Source: ${file}${line}${col}`);
    } else {
      console.log(`Tag: <${result.tagName}>`);
      if (result.componentName) {
        console.log(`Component: ${result.componentName}`);
      }
      console.log("Source: not found (dev mode may not be enabled)");
    }

    if (result.stack.length > 0) {
      console.log("\nComponent stack:");
      for (const loc of result.stack) {
        const name = loc.componentName ?? "(anonymous)";
        const line = loc.lineNumber != null ? `:${loc.lineNumber}` : "";
        console.log(`  ${name} -> ${loc.filePath}${line}`);
      }
    }
  },
};

// ---------------------------------------------------------------------------
// console
// ---------------------------------------------------------------------------

const consoleCommand: CLICommand = {
  name: "console",
  description: "View captured console messages",
  usage: "browsirai console [--level=error] [--limit=20]",
  run: async (cdp, args) => {
    const flags = parseFlags(args);

    const params: Record<string, unknown> = {};
    if (flags.level) params.level = flags.level;
    if (flags.limit) params.limit = parseInt(flags.limit, 10);

    const result = await browserConsoleMessages(cdp, params);

    if (result.messages.length === 0) {
      console.log("No console messages captured");
      return;
    }

    for (const msg of result.messages) {
      const level = msg.level.toUpperCase().padEnd(5);
      const ts = msg.timestamp
        ? new Date(msg.timestamp).toISOString().slice(11, 23)
        : "";
      const prefix = ts ? `[${ts}] ${level}` : level;
      console.log(`${prefix} ${msg.text}`);
    }

    console.log(`\n(${result.messages.length} messages)`);
  },
};

// ---------------------------------------------------------------------------
// network
// ---------------------------------------------------------------------------

const networkCommand: CLICommand = {
  name: "network",
  description: "View captured network requests",
  usage: "browsirai network [--filter=*api*] [--limit=10] [--includeHeaders]",
  run: async (cdp, args) => {
    const flags = parseFlags(args);

    const params: Record<string, unknown> = {};
    if (flags.filter) params.filter = flags.filter;
    if (flags.limit) params.limit = parseInt(flags.limit, 10);
    if (flags.includeHeaders === "true") params.includeHeaders = true;

    const result = await browserNetworkRequests(cdp, params);

    if (result.requests.length === 0) {
      console.log("No network requests captured");
      return;
    }

    for (const req of result.requests) {
      const status = req.status != null ? String(req.status) : "...";
      const type = req.type ? `[${req.type}]` : "";
      console.log(`${req.method.padEnd(6)} ${status.padEnd(3)} ${type.padEnd(10)} ${req.url}`);
    }

    console.log(`\n(${result.requests.length} requests)`);
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const obsCommands: CLICommand[] = [
  snapshotCommand,
  screenshotCommand,
  htmlCommand,
  evalCommand,
  findCommand,
  sourceCommand,
  consoleCommand,
  networkCommand,
];
