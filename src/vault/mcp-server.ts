import { runMcpServer } from "./mcp-tools.js";

/**
 * The entry point of the MCP server.
 *
 * The server is a separate process: Hermes Agent starts it and talks to it
 * over the standard input and output.
 */
runMcpServer().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
