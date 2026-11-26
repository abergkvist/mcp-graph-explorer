import { createHash } from "node:crypto";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { LIMITS } from "./config.ts";
import type { DialectAdapter } from "./dialect.ts";
import { applyLimits } from "./limits.ts";
import { describeSelection, neighborhood } from "./neighbors.ts";
import { runCypher } from "./query.ts";
import type { QueryRunner } from "./runner.ts";
import { readSchema } from "./schema.ts";
import type { SelectionStore } from "./selection.ts";
import { summarize } from "./summary.ts";

export interface ServerDeps {
  runner: QueryRunner;
  adapter: DialectAdapter;
  viewHtml: () => string;
  selection: SelectionStore;
}

const CONTRACT =
  "Visualization contract: return nodes, relationships or paths (RETURN p) instead of property projections; " +
  "put scalar values in their own columns. If answer_query returns no nodes (aggregates, projections), " +
  "also pass context_query returning the relevant subgraph.";

const text = (value: string) => [{ type: "text" as const, text: value }];

/** Database errors go back to the model as tool errors so it can fix the query. */
async function reportingErrors<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    return { isError: true, content: text(error instanceof Error ? error.message : String(error)) };
  }
}

export function createServer({ runner, adapter, viewHtml, selection }: ServerDeps): McpServer {
  const server = new McpServer({ name: "graph-explorer", version: "0.1.0" });
  const writing = runner.accessMode === "write";
  const hash = createHash("sha256").update(viewHtml()).digest("hex").slice(0, 8);
  const viewUri = `ui://graph-explorer/view-${hash}.html`;

  server.registerTool("get_schema", {
    title: "Get graph schema",
    description:
      `Labels, relationship types and properties with example values of the ${adapter.name} graph database, ` +
      "based on a sample. Call this before writing Cypher for an unfamiliar database.",
    annotations: { readOnlyHint: true },
  }, () => reportingErrors(async () => ({ content: text(JSON.stringify(await readSchema(runner, adapter))) })));

  registerAppTool(server, "run_cypher", {
    title: "Run Cypher",
    description:
      (writing
        ? "Run a Cypher query (WRITE MODE: it can change and delete data) and show the result in the graph view. "
        : "Run a read-only Cypher query and show the result in the graph view. ") + CONTRACT,
    inputSchema: z.object({
      answer_query: z.string().describe("Cypher that answers the question"),
      context_query: z.string().optional().describe("Read-only Cypher returning a subgraph to show next to the answer"),
      params: z.record(z.string(), z.unknown()).optional().describe("Query parameters used by both queries"),
      connect: z.union([z.literal("auto"), z.boolean()]).optional()
        .describe("Fetch relationships between the returned nodes. Default 'auto': only if the result has none."),
    }),
    annotations: writing ? { readOnlyHint: false, destructiveHint: true } : { readOnlyHint: true },
    _meta: { ui: { resourceUri: viewUri } },
  }, (input) => reportingErrors(async () => {
    const result = await runCypher(runner, adapter, input);
    return { content: text(summarize(result)), structuredContent: { ...result } };
  }));

  // For the view only: hidden from the model.
  const appOnly = { ui: { visibility: ["app" as const] } };

  registerAppTool(server, "select_node", {
    description: "Remember which node is selected in the graph view",
    inputSchema: z.object({ nodeId: z.string().nullable() }),
    _meta: appOnly,
  }, ({ nodeId }) => reportingErrors(async () => {
    selection.write(nodeId);
    return { content: text("ok") };
  }));

  registerAppTool(server, "expand_node", {
    description: "Neighbors of a node, for the graph view",
    inputSchema: z.object({ nodeId: z.string() }),
    annotations: { readOnlyHint: true },
    _meta: appOnly,
  }, ({ nodeId }) => reportingErrors(async () => {
    const found = await neighborhood(runner, adapter, nodeId, LIMITS.maxExpandEdges);
    if (!found) return { isError: true, content: text("This node no longer exists in the database.") };
    return { content: text("ok"), structuredContent: { ...applyLimits(found) } };
  }));

  server.registerTool("get_selection", {
    title: "Read selected node",
    description:
      "Returns the node the user last clicked in the graph view, with its properties and neighbors. Call this whenever " +
      "the user refers to something in the graph without naming it, e.g. \"this\", \"that station\", \"here\", " +
      "\"the selected node\", \"den här\", \"härifrån\", \"den markerade\".",
    annotations: { readOnlyHint: true },
  }, () => reportingErrors(async () => ({ content: text(await describeSelection(runner, adapter, selection.read())) })));

  const read = (uri: URL) => ({
    contents: [{
      uri: uri.href,
      mimeType: RESOURCE_MIME_TYPE,
      text: viewHtml(),
      _meta: { ui: { preferredDisplayMode: "fullscreen" } }, // Claude extension; other hosts ignore it
    }],
  });
  registerAppResource(server, "Graph view", viewUri, { mimeType: RESOURCE_MIME_TYPE }, read);
  // Old chats may ask for the address of an earlier build; give them the current view.
  server.registerResource(
    "Graph view (any build)",
    new ResourceTemplate("ui://graph-explorer/view-{hash}.html", { list: undefined }),
    { mimeType: RESOURCE_MIME_TYPE },
    read,
  );

  return server;
}
