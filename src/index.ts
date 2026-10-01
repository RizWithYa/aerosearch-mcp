#!/usr/bin/env node
import { AeroSearchServer } from "./server.js";

const server = new AeroSearchServer();

server.start().catch((err) => {
  console.error("Fatal error starting AeroSearch MCP server:", err);
  process.exit(1);
});
