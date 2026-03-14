/**
 * CLI runner for browsirai.
 *
 * Parses `browsirai <command> [args...]`, connects to Chrome via CDP,
 * looks up the command in a registry, and executes it.
 */

import pc from "picocolors";
import { connectFirefox } from "../firefox-launcher.js";
import { BiDiConnection } from "../bidi/connection.js";
import type { CLICommand } from "./types.js";

// ---------------------------------------------------------------------------
// Flag parsing utility
// ---------------------------------------------------------------------------

/**
 * Parses CLI flags from an args array.
 *
 * Supports:
 *   --key=value  → { key: "value" }
 *   --key value  → { key: "value" }
 *   --flag       → { flag: "true" }
 *   -i           → { i: "true" }  (short boolean)
 *   -d 5         → { d: "5" }     (short with value)
 *   -ic          → { i: "true", c: "true" }  (combined short booleans)
 *   positional   → { _0: "positional", _1: ... }
 *
 * @returns Record of parsed flags and positional args keyed as _0, _1, etc.
 */
export function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  let positionalIndex = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        // --key=value
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        flags[key] = value;
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          // --key value
          flags[key] = next;
          i++;
        } else {
          // --flag (boolean)
          flags[key] = "true";
        }
      }
    } else if (arg.startsWith("-") && arg.length > 1 && !/^-\d/.test(arg)) {
      // Short flags: -i, -c, -d 5, -ic
      const chars = arg.slice(1);
      if (chars.length === 1) {
        // Single short flag: -i or -d 5
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          flags[chars] = next;
          i++;
        } else {
          flags[chars] = "true";
        }
      } else {
        // Combined short flags: -ic → i=true, c=true
        for (const ch of chars) {
          flags[ch] = "true";
        }
      }
    } else {
      flags[`_${positionalIndex}`] = arg;
      positionalIndex++;
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Result printer
// ---------------------------------------------------------------------------

/**
 * Pretty-prints a command result to stdout.
 * Objects/arrays are JSON-formatted; primitives are printed as-is.
 */
export function printResult(data: unknown): void {
  if (data === undefined || data === null) return;

  if (typeof data === "string") {
    console.log(data);
  } else if (typeof data === "object") {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(String(data));
  }
}

// ---------------------------------------------------------------------------
// Command registry
// ---------------------------------------------------------------------------

interface CommandCategory {
  name: string;
  commands: CLICommand[];
}

async function loadCommands(): Promise<CommandCategory[]> {
  const categories: CommandCategory[] = [];

  const imports: Array<{
    name: string;
    path: string;
    key: string;
  }> = [
    { name: "Navigation", path: "./commands/nav.js", key: "navCommands" },
    { name: "Observation", path: "./commands/obs.js", key: "obsCommands" },
    { name: "Actions", path: "./commands/act.js", key: "actCommands" },
    { name: "Network", path: "./commands/net.js", key: "netCommands" },
  ];

  const base = new URL(".", import.meta.url);
  for (const entry of imports) {
    try {
      const url = new URL(entry.path, base).href;
      const mod = (await import(url)) as Record<string, CLICommand[]>;
      const commands = mod[entry.key];
      if (commands && Array.isArray(commands) && commands.length > 0) {
        categories.push({ name: entry.name, commands });
      }
    } catch {
      // Command file not yet created — skip silently
    }
  }

  return categories;
}

function buildRegistry(
  categories: CommandCategory[],
): Map<string, CLICommand> {
  const registry = new Map<string, CLICommand>();
  for (const cat of categories) {
    for (const cmd of cat.commands) {
      registry.set(cmd.name, cmd);
      if (cmd.aliases) {
        for (const alias of cmd.aliases) {
          registry.set(alias, cmd);
        }
      }
    }
  }
  return registry;
}

// ---------------------------------------------------------------------------
// Help output
// ---------------------------------------------------------------------------

function printHelp(categories: CommandCategory[]): void {
  console.log();
  console.log(pc.bold("browsirai") + " — Browser automation from the terminal");
  console.log();
  console.log(pc.dim("Usage:") + "  browsirai <command> [args...] [--flags]");
  console.log();

  if (categories.length === 0) {
    console.log(
      pc.yellow("  No commands available yet. Command modules have not been installed."),
    );
    console.log();
    return;
  }

  for (const cat of categories) {
    console.log(pc.cyan(pc.bold(`  ${cat.name}`)));
    for (const cmd of cat.commands) {
      const aliasStr = cmd.aliases?.length
        ? pc.dim(` (${cmd.aliases.join(", ")})`)
        : "";
      const name = pc.green(cmd.name.padEnd(20));
      console.log(`    ${name} ${pc.dim(cmd.description)}${aliasStr}`);
    }
    console.log();
  }

  console.log(pc.dim("  Examples:"));
  console.log(pc.dim('    browsirai open example.com'));
  console.log(pc.dim('    browsirai snapshot -i'));
  console.log(pc.dim('    browsirai click @e5'));
  console.log(pc.dim('    browsirai fill @e2 "hello world"'));
  console.log(pc.dim('    browsirai press Enter'));
  console.log(pc.dim('    browsirai eval "document.title"'));
  console.log();
}

// ---------------------------------------------------------------------------
// BiDi connection helper
// ---------------------------------------------------------------------------

async function connectBiDi(): Promise<BiDiConnection> {
  const result = await connectFirefox({ autoLaunch: true });

  if (!result.success) {
    const msg = result.error ?? "Could not connect to Firefox via BiDi.";
    throw new Error(msg);
  }

  const wsUrl = result.wsEndpoint ?? `ws://127.0.0.1:${result.port}/session`;
  const conn = new BiDiConnection(wsUrl);
  await conn.connect();

  return conn;
}


// ---------------------------------------------------------------------------
// Main CLI runner
// ---------------------------------------------------------------------------

export async function runCLI(args: string[]): Promise<void> {
  const commandName = args[0];
  const remainingArgs = args.slice(1);

  // Load available commands
  const categories = await loadCommands();
  const registry = buildRegistry(categories);

  // No command or --help → show help
  if (!commandName || commandName === "--help" || commandName === "-h") {
    printHelp(categories);
    return;
  }

  // Look up the command
  const command = registry.get(commandName);
  if (!command) {
    console.error(
      pc.red(`Unknown command: ${pc.bold(commandName)}`),
    );
    console.log();
    console.log(
      pc.dim("Run ") + pc.bold("browsirai --help") + pc.dim(" to see available commands."),
    );

    // Suggest similar commands
    const similar = findSimilar(commandName, registry);
    if (similar.length > 0) {
      console.log();
      console.log(pc.dim("Did you mean?"));
      for (const s of similar) {
        console.log(`  ${pc.green(s)}`);
      }
    }

    console.log();
    process.exit(1);
  }

  // Connect to Firefox and run the command
  let bidi: BiDiConnection | null = null;
  try {
    bidi = await connectBiDi();
    await command.run(bidi, remainingArgs);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    console.error(pc.red(`Error: ${message}`));
    process.exit(1);
  } finally {
    if (bidi?.isConnected) {
      bidi.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Fuzzy matching helper
// ---------------------------------------------------------------------------

function findSimilar(
  input: string,
  registry: Map<string, CLICommand>,
): string[] {
  const names = Array.from(registry.keys());
  return names
    .filter((name) => {
      // Simple substring or prefix match
      return (
        name.includes(input) ||
        input.includes(name) ||
        levenshtein(input, name) <= 3
      );
    })
    .slice(0, 3);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0) as number[],
  );

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }

  return dp[m]![n]!;
}
