/**
 * Interaction CLI commands for browsirai.
 *
 * Commands: click, fill, type, key, hover, drag, select, upload, dialog
 *
 * Each command wraps the corresponding tool function from src/tools/,
 * parsing CLI args into the expected params and printing human-readable output.
 */

import type { CLICommand } from "../types.js";
import { parseFlags } from "../run.js";
import { browserClick } from "../../tools/browser-click.js";
import { browserFillForm } from "../../tools/browser-fill-form.js";
import { browserType } from "../../tools/browser-type.js";
import { browserPressKey } from "../../tools/browser-press-key.js";
import { browserHover } from "../../tools/browser-hover.js";
import { browserDrag } from "../../tools/browser-drag.js";
import { browserSelectOption } from "../../tools/browser-select-option.js";
import { browserFileUpload } from "../../tools/browser-file-upload.js";
import { browserHandleDialog } from "../../tools/browser-handle-dialog.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalises a user-supplied reference to the canonical `@eN` format.
 * Accepts: `@e5`, `e5`, `@E5`, `E5`.
 */
function normaliseRef(input: string): string {
  const cleaned = input.startsWith("@") ? input.slice(1) : input;
  const match = /^e(\d+)$/i.exec(cleaned);
  if (!match) {
    throw new Error(`Invalid ref format: ${input}. Expected @eN (e.g. @e5).`);
  }
  return `@e${match[1]}`;
}

/**
 * Determines whether an argument looks like a ref (`@eN` or `eN`)
 * rather than a CSS selector.
 */
function looksLikeRef(arg: string): boolean {
  return /^@?e\d+$/i.test(arg);
}

// ---------------------------------------------------------------------------
// click
// ---------------------------------------------------------------------------

const click: CLICommand = {
  name: "click",
  description: "Click an element by ref or CSS selector",
  usage: "browsirai click <ref-or-selector> [--newTab]",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const target = flags._0;

    if (!target) {
      console.error("Usage: browsirai click <ref-or-selector> [--newTab]");
      console.error("  Provide an @eN ref or CSS selector as the first argument.");
      process.exit(1);
    }

    const newTab = flags.newTab === "true";

    try {
      if (looksLikeRef(target)) {
        const ref = normaliseRef(target);
        await browserClick(cdp, { ref, newTab });
        console.log(`Clicked ${ref}`);
      } else {
        await browserClick(cdp, { selector: target, newTab });
        console.log(`Clicked ${target}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Click failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// fill
// ---------------------------------------------------------------------------

const fill: CLICommand = {
  name: "fill",
  description: "Fill a form field with a value",
  usage: "browsirai fill <ref-or-selector> <value>",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const target = flags._0;
    const value = flags._1;

    if (!target || value === undefined) {
      console.error("Usage: browsirai fill <ref-or-selector> <value>");
      console.error("  Provide an @eN ref or CSS selector and a value.");
      process.exit(1);
    }

    try {
      const isRef = looksLikeRef(target);
      const ref = isRef ? normaliseRef(target) : undefined;
      const selector = isRef ? undefined : target;
      const label = isRef ? normaliseRef(target) : target;

      await browserFillForm(cdp, {
        fields: [
          {
            name: label,
            type: "textbox",
            ref,
            selector,
            value,
          },
        ],
      });

      const displayValue = value.length > 40 ? value.slice(0, 40) + "..." : value;
      console.log(`Filled ${label} with '${displayValue}'`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Fill failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// type
// ---------------------------------------------------------------------------

const type: CLICommand = {
  name: "type",
  description: "Type text into the focused or specified element",
  usage: "browsirai type <text> [--ref=@e3] [--submit] [--slowly]",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const text = flags._0;

    if (!text) {
      console.error("Usage: browsirai type <text> [--ref=@e3] [--submit] [--slowly]");
      console.error("  Provide the text to type as the first argument.");
      process.exit(1);
    }

    const ref = flags.ref ? normaliseRef(flags.ref) : undefined;
    const selector = flags.selector;
    const submit = flags.submit === "true";
    const slowly = flags.slowly === "true";

    try {
      await browserType(cdp, { text, ref, selector, slowly, submit });

      const displayText = text.length > 40 ? text.slice(0, 40) + "..." : text;
      const target = ref ?? selector ?? "focused element";
      console.log(`Typed '${displayText}' into ${target}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Type failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// key
// ---------------------------------------------------------------------------

const key: CLICommand = {
  name: "press",
  aliases: ["key"],
  description: "Press a key or key combination",
  usage: "browsirai press <key-combo>",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const keyCombo = flags._0;

    if (!keyCombo) {
      console.error("Usage: browsirai key <key-combo>");
      console.error("  Examples: Enter, Tab, Control+c, Shift+Tab, Meta+a");
      process.exit(1);
    }

    try {
      await browserPressKey(cdp, { key: keyCombo });
      console.log(`Pressed ${keyCombo}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Key press failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// hover
// ---------------------------------------------------------------------------

const hover: CLICommand = {
  name: "hover",
  description: "Hover over an element by ref or selector",
  usage: "browsirai hover <ref-or-selector>",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const target = flags._0;

    if (!target) {
      console.error("Usage: browsirai hover <ref-or-selector>");
      console.error("  Provide an @eN ref or CSS selector.");
      process.exit(1);
    }

    try {
      if (looksLikeRef(target)) {
        const ref = normaliseRef(target);
        await browserHover(cdp, { ref });
        console.log(`Hovered ${ref}`);
      } else {
        await browserHover(cdp, { selector: target });
        console.log(`Hovered ${target}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Hover failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// drag
// ---------------------------------------------------------------------------

const drag: CLICommand = {
  name: "drag",
  description: "Drag from one element to another",
  usage: "browsirai drag <startRef> <endRef>",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const startArg = flags._0;
    const endArg = flags._1;

    if (!startArg || !endArg) {
      console.error("Usage: browsirai drag <startRef> <endRef>");
      console.error("  Provide two @eN refs (source and target).");
      process.exit(1);
    }

    try {
      const startRef = normaliseRef(startArg);
      const endRef = normaliseRef(endArg);

      await browserDrag(cdp, { startRef, endRef });
      console.log(`Dragged ${startRef} \u2192 ${endRef}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Drag failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// select
// ---------------------------------------------------------------------------

const select: CLICommand = {
  name: "select",
  description: "Select option(s) in a <select> element",
  usage: "browsirai select <ref> <value1> [value2...]",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const refArg = flags._0;

    if (!refArg) {
      console.error("Usage: browsirai select <ref> <value1> [value2...]");
      console.error("  Provide an @eN ref and one or more values to select.");
      process.exit(1);
    }

    // Collect all positional args after the ref as values
    const values: string[] = [];
    let i = 1;
    while (flags[`_${i}`] !== undefined) {
      values.push(flags[`_${i}`]);
      i++;
    }

    if (values.length === 0) {
      console.error("Usage: browsirai select <ref> <value1> [value2...]");
      console.error("  Provide at least one value to select.");
      process.exit(1);
    }

    try {
      const ref = normaliseRef(refArg);
      const result = await browserSelectOption(cdp, {
        ref,
        values,
        element: ref,
      });

      const displayValues = result.selected.length > 0
        ? result.selected.map((v) => `'${v}'`).join(", ")
        : values.map((v) => `'${v}'`).join(", ");
      console.log(`Selected ${displayValues} in ${ref}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Select failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

const upload: CLICommand = {
  name: "upload",
  description: "Upload file(s) to a file input element",
  usage: "browsirai upload <ref> <file1> [file2...]",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const refArg = flags._0;

    if (!refArg) {
      console.error("Usage: browsirai upload <ref> <file1> [file2...]");
      console.error("  Provide an @eN ref and one or more file paths.");
      process.exit(1);
    }

    // Collect all positional args after the ref as file paths
    const paths: string[] = [];
    let i = 1;
    while (flags[`_${i}`] !== undefined) {
      paths.push(flags[`_${i}`]);
      i++;
    }

    if (paths.length === 0) {
      console.error("Usage: browsirai upload <ref> <file1> [file2...]");
      console.error("  Provide at least one file path to upload.");
      process.exit(1);
    }

    try {
      const ref = normaliseRef(refArg);
      const result = await browserFileUpload(cdp, { ref, paths });

      if (result.success) {
        console.log(`Uploaded ${result.filesCount} file(s) to ${ref}`);
      } else {
        console.error(`Upload failed: ${result.error}`);
        process.exit(1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Upload failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// dialog
// ---------------------------------------------------------------------------

const dialog: CLICommand = {
  name: "dialog",
  description: "Accept or dismiss a JavaScript dialog",
  usage: "browsirai dialog <accept|dismiss> [--text=...]",
  async run(cdp, args) {
    const flags = parseFlags(args);
    const action = flags._0;

    if (!action || (action !== "accept" && action !== "dismiss")) {
      console.error("Usage: browsirai dialog <accept|dismiss> [--text=...]");
      console.error("  First argument must be 'accept' or 'dismiss'.");
      process.exit(1);
    }

    const accept = action === "accept";
    const promptText = flags.text;

    try {
      const result = await browserHandleDialog(cdp, {
        accept,
        promptText,
      });

      if (result.success) {
        console.log(`Dialog ${accept ? "accepted" : "dismissed"}`);
      } else {
        console.error(`Dialog handling failed: ${result.error}`);
        process.exit(1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Dialog failed: ${msg}`);
      process.exit(1);
    }
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const actCommands: CLICommand[] = [
  click,
  fill,
  type,
  key,
  hover,
  drag,
  select,
  upload,
  dialog,
];
