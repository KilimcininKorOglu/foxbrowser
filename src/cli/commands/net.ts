/**
 * Network intercept & state persistence CLI commands.
 *
 * Commands: route, abort, unroute, save, load, diff
 */

import pc from "picocolors";
import { writeFileSync } from "node:fs";
import type { CLICommand } from "../types.js";
import { parseFlags } from "../run.js";
import {
  browserRoute,
  browserAbort,
  browserUnroute,
} from "../../tools/browser-intercept.js";
import {
  browserSaveState,
  browserLoadState,
} from "../../tools/browser-session-state.js";
import { browserDiff } from "../../tools/browser-diff.js";

// ---------------------------------------------------------------------------
// route
// ---------------------------------------------------------------------------

const routeCommand: CLICommand = {
  name: "route",
  description: "Intercept matching requests with a custom response",
  usage: "browsirai route <urlPattern> [--status=200] [--body=\"...\"] [--contentType=application/json]",
  run: async (cdp, args) => {
    const flags = parseFlags(args);
    const urlPattern = flags._0;

    if (!urlPattern) {
      console.error(pc.red("Error: URL pattern is required."));
      console.log(pc.dim(`Usage: ${routeCommand.usage}`));
      process.exit(1);
    }

    const status = flags.status ? parseInt(flags.status, 10) : 200;
    const body = flags.body ?? "{}";
    const contentType = flags.contentType ?? "application/json";

    const result = await browserRoute(cdp, {
      url: urlPattern,
      body,
      status,
      headers: { "Content-Type": contentType },
    });

    console.log(
      pc.green(`Routing ${pc.bold(result.url)} → ${result.status} (custom response)`),
    );
    console.log(pc.dim(`Active routes: ${result.activeRoutes}`));
  },
};

// ---------------------------------------------------------------------------
// abort
// ---------------------------------------------------------------------------

const abortCommand: CLICommand = {
  name: "abort",
  description: "Block matching requests",
  usage: "browsirai abort <urlPattern>",
  run: async (cdp, args) => {
    const flags = parseFlags(args);
    const urlPattern = flags._0;

    if (!urlPattern) {
      console.error(pc.red("Error: URL pattern is required."));
      console.log(pc.dim(`Usage: ${abortCommand.usage}`));
      process.exit(1);
    }

    const result = await browserAbort(cdp, { url: urlPattern });

    console.log(
      pc.green(`Blocking requests matching ${pc.bold(result.url)}`),
    );
    console.log(pc.dim(`Active abort rules: ${result.activeAborts}`));
  },
};

// ---------------------------------------------------------------------------
// unroute
// ---------------------------------------------------------------------------

const unrouteCommand: CLICommand = {
  name: "unroute",
  description: "Remove intercept rules",
  usage: "browsirai unroute [urlPattern] [--all]",
  run: async (cdp, args) => {
    const flags = parseFlags(args);
    const urlPattern = flags._0;
    const removeAll = flags.all === "true";

    if (!urlPattern && !removeAll) {
      console.error(pc.red("Error: Provide a URL pattern or --all."));
      console.log(pc.dim(`Usage: ${unrouteCommand.usage}`));
      process.exit(1);
    }

    const result = await browserUnroute(cdp, {
      url: urlPattern,
      all: removeAll,
    });

    if (removeAll) {
      console.log(pc.green(`Removed all routes (${result.removed} rules cleared)`));
    } else {
      console.log(pc.green(`Removed route for ${pc.bold(urlPattern!)} (${result.removed} removed)`));
    }

    console.log(pc.dim(`Remaining rules: ${result.remaining}`));
  },
};

// ---------------------------------------------------------------------------
// save
// ---------------------------------------------------------------------------

const saveCommand: CLICommand = {
  name: "save",
  description: "Save browser session state (cookies, storage)",
  usage: "browsirai save <name>",
  run: async (cdp, args) => {
    const flags = parseFlags(args);
    const name = flags._0;

    if (!name) {
      console.error(pc.red("Error: State name is required."));
      console.log(pc.dim(`Usage: ${saveCommand.usage}`));
      process.exit(1);
    }

    const result = await browserSaveState(cdp, { name });

    console.log(pc.green(`State saved as '${pc.bold(result.name)}'`));
    console.log(pc.dim(`  Path: ${result.path}`));
    console.log(pc.dim(`  Cookies: ${result.cookies}`));
    console.log(pc.dim(`  localStorage: ${result.localStorage}`));
    console.log(pc.dim(`  sessionStorage: ${result.sessionStorage}`));
  },
};

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

const loadCommand: CLICommand = {
  name: "load",
  description: "Load a saved browser session state",
  usage: "browsirai load <name> [--url=https://...]",
  run: async (cdp, args) => {
    const flags = parseFlags(args);
    const name = flags._0;

    if (!name) {
      console.error(pc.red("Error: State name is required."));
      console.log(pc.dim(`Usage: ${loadCommand.usage}`));
      process.exit(1);
    }

    const result = await browserLoadState(cdp, {
      name,
      url: flags.url,
    });

    console.log(pc.green(`State '${pc.bold(result.name)}' loaded`));
    console.log(pc.dim(`  Cookies: ${result.cookies}`));
    console.log(pc.dim(`  localStorage: ${result.localStorage}`));
    console.log(pc.dim(`  sessionStorage: ${result.sessionStorage}`));
  },
};

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

const diffCommand: CLICommand = {
  name: "diff",
  description: "Pixel-by-pixel screenshot comparison",
  usage: "browsirai diff [--selector=...] [--threshold=30] [--output=diff.png]",
  run: async (cdp, args) => {
    const flags = parseFlags(args);
    const selector = flags.selector;
    const threshold = flags.threshold ? parseInt(flags.threshold, 10) : 30;
    const output = flags.output;

    const result = await browserDiff(cdp, {
      before: "current",
      after: "current",
      selector,
      threshold,
    });

    // Save diff image if --output provided
    if (output) {
      const imageBuffer = Buffer.from(result.diffImage, "base64");
      writeFileSync(output, imageBuffer);
      console.log(pc.dim(`Diff image saved to ${output}`));
    }

    const pct = result.diffPercentage.toFixed(2);
    const status = result.identical
      ? pc.green("identical")
      : pc.yellow(`${pct}% changed`);

    console.log(
      `Diff: ${status} (${result.diffPixels.toLocaleString()} pixels, ${result.width}x${result.height})`,
    );
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const netCommands: CLICommand[] = [
  routeCommand,
  abortCommand,
  unrouteCommand,
  saveCommand,
  loadCommand,
  diffCommand,
];
