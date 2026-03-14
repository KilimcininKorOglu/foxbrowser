/**
 * Navigation & lifecycle CLI commands for browsirai.
 *
 * Commands: navigate, back, scroll, wait, tabs, close, resize
 *
 * Each command wraps the corresponding tool function from src/tools/,
 * parsing CLI args into the expected params and printing human-readable output.
 */

import type { CLICommand } from "../types.js";
import { parseFlags, printResult } from "../run.js";
import { browserNavigate } from "../../tools/browser-navigate.js";
import { browserNavigateBack } from "../../tools/browser-navigate-back.js";
import { browserScroll } from "../../tools/browser-scroll.js";
import { browserWaitFor } from "../../tools/browser-wait-for.js";
import { browserClose } from "../../tools/browser-close.js";
import { browserTabs } from "../../tools/browser-tabs.js";
import { browserResize } from "../../tools/browser-resize.js";

// ---------------------------------------------------------------------------
// navigate
// ---------------------------------------------------------------------------

const navigate: CLICommand = {
  name: "navigate",
  aliases: ["open", "goto"],
  description: "Navigate the browser to a URL",
  usage: "browsirai open <url> [--waitUntil=load]",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const url = flags._0 ?? flags.url;

    if (!url) {
      console.error("Usage: browsirai open <url> [--waitUntil=load]");
      console.error("  Provide a URL as the first argument or via --url=...");
      process.exit(1);
    }

    // Auto-prefix protocol if missing (like agent-browser)
    const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

    try {
      const result = await browserNavigate(cdp, {
        url: fullUrl,
        waitUntil: flags.waitUntil as "load" | "domcontentloaded" | "networkidle" | undefined,
        timeout: flags.timeout ? Number(flags.timeout) : undefined,
      });
      console.log(`Navigated to ${result.url}`);
      if (result.title) {
        console.log(`  Title: ${result.title}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Navigate failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// back
// ---------------------------------------------------------------------------

const back: CLICommand = {
  name: "back",
  description: "Navigate back or forward in browser history",
  usage: "browsirai back [--direction=back]",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const direction = (flags._0 ?? flags.direction ?? "back") as "back" | "forward";

    try {
      const result = await browserNavigateBack(cdp, { direction });
      if (result.success) {
        console.log(`Navigated ${direction}`);
        if (result.url) {
          console.log(`  URL: ${result.url}`);
        }
      } else {
        console.log(`Cannot navigate ${direction} — no history entry`);
        if (result.url) {
          console.log(`  Current URL: ${result.url}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Navigate ${direction} failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// scroll
// ---------------------------------------------------------------------------

const scroll: CLICommand = {
  name: "scroll",
  description: "Scroll the page in a direction",
  usage: "browsirai scroll <direction> [--pixels=300] [--selector=...]",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const direction = (flags._0 ?? flags.direction ?? "down") as
      | "up"
      | "down"
      | "left"
      | "right";
    const amount = flags.pixels ? Number(flags.pixels) : (flags.amount ? Number(flags.amount) : 300);
    const selector = flags.selector;

    try {
      await browserScroll(cdp, {
        direction,
        amount,
        selector,
      });
      console.log(`Scrolled ${direction} ${amount}px`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Scroll failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// wait
// ---------------------------------------------------------------------------

const wait: CLICommand = {
  name: "wait",
  description: "Wait for a condition on the page",
  usage: "browsirai wait [--text=...] [--selector=...] [--url=...] [--fn=...] [--time=N] [--timeout=30]",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const timeout = flags.timeout ? Number(flags.timeout) : undefined;

    // Build params from flags
    const params: Record<string, unknown> = {};
    if (flags.text !== undefined) params.text = flags.text;
    if (flags.selector !== undefined) params.selector = flags.selector;
    if (flags.url !== undefined) params.url = flags.url;
    if (flags.fn !== undefined) params.fn = flags.fn;
    if (flags.time !== undefined) params.time = Number(flags.time);
    if (flags.visible !== undefined) params.visible = flags.visible === "true";
    if (flags.state !== undefined) params.state = flags.state;
    if (flags.networkIdle !== undefined) params.networkIdle = flags.networkIdle === "true";
    if (flags.load !== undefined) params.load = flags.load === "true";
    if (timeout !== undefined) params.timeout = timeout;

    // Use first positional arg as a shorthand condition if no flags given
    const hasCondition = Object.keys(params).some((k) => k !== "timeout");
    if (!hasCondition && flags._0) {
      // Treat positional arg as text to wait for
      params.text = flags._0;
    }

    if (!hasCondition && !flags._0) {
      console.error("Usage: browsirai wait [--text=...] [--selector=...] [--url=...] [--fn=...] [--time=N]");
      console.error("  Provide at least one condition to wait for.");
      process.exit(1);
    }

    try {
      const result = await browserWaitFor(cdp, params as any);
      console.log(`Condition met (${result.elapsed}ms)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Wait failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------

const tabs: CLICommand = {
  name: "tab",
  aliases: ["tabs"],
  description: "List open browser tabs",
  usage: "browsirai tab [--filter=*github*]",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const filter = flags._0 ?? flags.filter;

    try {
      const result = await browserTabs(cdp, { filter });
      if (result.tabs.length === 0) {
        console.log("No tabs found");
        return;
      }
      const lines = result.tabs.map(
        (t) => `[${t.id}] ${t.title}\n  ${t.url}`,
      );
      printResult(lines.join("\n\n"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Tabs failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------

const close: CLICommand = {
  name: "close",
  description: "Close browser tab(s)",
  usage: "browsirai close [--force] [--targetId=...] [--closeAll]",
  async run(cdp, args) {
    const flags = parseFlags(args);

    try {
      const result = await browserClose(cdp, {
        force: flags.force === "true",
        targetId: flags.targetId,
        closeAll: flags.closeAll === "true",
      });
      if (result.success) {
        console.log(`Closed ${result.closedTargets} tab(s)`);
      } else {
        console.log("Close failed — no targets matched");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Close failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// resize
// ---------------------------------------------------------------------------

const resize: CLICommand = {
  name: "resize",
  description: "Resize the browser viewport",
  usage: "browsirai resize <width> <height> [--preset=mobile]",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const preset = flags.preset;

    // If preset is given, use it; otherwise parse width/height from positional args
    const width = flags._0 ? Number(flags._0) : (flags.width ? Number(flags.width) : undefined);
    const height = flags._1 ? Number(flags._1) : (flags.height ? Number(flags.height) : undefined);
    const deviceScaleFactor = flags.deviceScaleFactor
      ? Number(flags.deviceScaleFactor)
      : undefined;

    if (!preset && width === undefined) {
      console.error("Usage: browsirai resize <width> <height> [--preset=mobile]");
      console.error("  Provide dimensions or a preset (mobile, tablet, desktop, fullhd, reset).");
      process.exit(1);
    }

    try {
      const result = await browserResize(cdp, {
        width,
        height,
        preset,
        deviceScaleFactor,
      });
      if (preset?.toLowerCase() === "reset") {
        console.log("Viewport reset to browser defaults");
      } else {
        console.log(`Viewport resized to ${result.width}x${result.height}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Resize failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const navCommands: CLICommand[] = [
  navigate,
  back,
  scroll,
  wait,
  tabs,
  close,
  resize,
];
