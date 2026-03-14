/**
 * MCP Server setup for browsirai.
 *
 * Creates and configures an McpServer with all browser tools registered,
 * connected to the user's Chrome via CDP.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "./version.js";
import { registerTools } from "./tools/index.js";

/**
 * Create and return a fully configured MCP server instance with all
 * browser tools registered. The caller is responsible for connecting
 * a transport (e.g. StdioServerTransport).
 */
export async function createServer(): Promise<McpServer> {
  const server = new McpServer({
    name: "browsirai",
    version: VERSION,
  });

  registerTools(server);

  return server;
}
