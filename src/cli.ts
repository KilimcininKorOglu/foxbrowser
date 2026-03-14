import { VERSION } from "./version.js";
import { quitFirefox } from "./firefox-launcher.js";

// Prevent unhandled rejections from crashing the MCP server
// (e.g. CDP reconnection failures when Chrome is closed)
process.on("unhandledRejection", () => {});
process.on("uncaughtException", () => {});

// Clean up browsirai-launched Firefox on process exit
process.on("SIGINT", () => { quitFirefox().finally(() => process.exit(0)); });
process.on("SIGTERM", () => { quitFirefox().finally(() => process.exit(0)); });

/**
 * CLI dispatcher for the `browsirai` command.
 *
 * Uses dynamic imports so that modules can be mocked in tests via `vi.doMock`.
 */
export async function runCli(args: string[]): Promise<void> {
  const command = args[0];

  switch (command) {
    case undefined: {
      // Default: start the MCP server
      const { createServer } = await import("./server");
      const { StdioServerTransport } = await import(
        "@modelcontextprotocol/sdk/server/stdio.js"
      );
      const server = await createServer();
      const transport = new StdioServerTransport();
      await server.connect(transport);

      // Fire-and-forget upgrade check (non-blocking, stderr only)
      import("./upgrade.js")
        .then((m) => m.checkForUpgrade())
        .catch(() => {});
      break;
    }

    case "doctor": {
      const { runDoctor } = await import("./doctor");
      await runDoctor();
      break;
    }

    case "install": {
      const { runInstall } = await import("./install");
      await runInstall();
      break;
    }

    case "--version":
    case "-v": {
      console.log(VERSION);
      break;
    }

    default: {
      // Use URL-based import to prevent bundler from inlining cli/run.ts.
      // This ensures loadCommands() resolves paths relative to its own file.
      const cliUrl = new URL("./cli/run.js", import.meta.url);
      const { runCLI } = await import(cliUrl.href);
      await runCLI(args);
      break;
    }
  }
}

