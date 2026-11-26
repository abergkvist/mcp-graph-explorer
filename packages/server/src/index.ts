#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.ts";
import { adapterFor } from "./dialect.ts";
import { createRunner } from "./runner.ts";
import { createServer } from "./server.ts";

// stdout belongs to MCP; log to stderr only.
const config = loadConfig(process.env);
const runner = createRunner(config);
const adapter = adapterFor(config.dialect);

const viewHtml = () => {
  try {
    return readFileSync(new URL("../../view/dist/index.html", import.meta.url), "utf8");
  } catch {
    return "<!doctype html><p>The view is not built. Run <code>pnpm build</code>.</p>";
  }
};

if (config.accessMode === "write") {
  console.error("graph-explorer: WARNING: GRAPH_ACCESS_MODE=write. Queries can change and delete data.");
}

serveStdio(() => createServer({ runner, adapter, viewHtml }), {
  onerror: (error) => console.error("graph-explorer:", error.message),
});
process.stdin.on("end", () => void runner.close());
