#!/usr/bin/env node
import { runMcpServer } from "../../../src/vault/mcp-tools.js";

/**
 * The entry point of the package.
 *
 * The server speaks the MCP protocol over the standard input and output, the
 * logs go to the standard error.
 */
runMcpServer().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
