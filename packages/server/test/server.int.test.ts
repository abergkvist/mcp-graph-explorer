import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Config } from "../src/config.ts";
import { adapterFor } from "../src/dialect.ts";
import { createRunner, type QueryRunner } from "../src/runner.ts";
import { createSelectionStore } from "../src/selection.ts";
import { createServer } from "../src/server.ts";
import { createViewQueryStore } from "../src/view-query.ts";

const targets: Config[] = [
  { dialect: "neo4j", uri: "bolt://localhost:7687", user: "neo4j", password: "graphexplorer", accessMode: "read" },
  { dialect: "memgraph", uri: "bolt://localhost:7688", user: "", password: "", accessMode: "read" },
];

const runners: QueryRunner[] = [];
const stateEnv = { GRAPH_STATE_DIR: mkdtempSync(join(tmpdir(), "gx-")) };
async function connect(config: Config) {
  const runner = createRunner(config);
  runners.push(runner);
  const server = createServer({ runner, adapter: adapterFor(config.dialect), viewHtml: () => "<html>view</html>", selection: createSelectionStore(config, stateEnv), viewQuery: createViewQueryStore(config, stateEnv) });
  const client = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { text: string }[])[0]!.text;
    return { isError: res.isError === true, text, data: res.structuredContent as any };
  };
  return { client, call };
}
afterAll(() => Promise.all(runners.map((r) => r.close())));

const COUNT = "MATCH (n:ReadModeProbe) RETURN count(n) AS c";
const CREATE = "CREATE (:ReadModeProbe)";

describe.each(targets)("$dialect", (config) => {
  let read: Awaited<ReturnType<typeof connect>>;
  let write: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    read = await connect(config);
    write = await connect({ ...config, accessMode: "write" });
  });
  afterAll(() => write.call("query_cypher", { query: "MATCH (n:ReadModeProbe) DELETE n" }));

  it("describes the schema", async () => {
    const { text } = await read.call("get_schema");
    const labels = JSON.parse(text).labels.map((l: { name: string }) => l.name);
    expect(labels).toEqual(expect.arrayContaining(["Junction", "Station", "TrackSection"]));
  });

  it("returns a graph for nodes and a table for values", async () => {
    const nodes = await read.call("show_result", { answer_query: "MATCH (s:Station {name: $name}) RETURN s", params: { name: "Falun central" } });
    expect(nodes.data.nodes).toHaveLength(1);
    expect(nodes.text).toContain("Falun central");
    const rows = await read.call("show_result", { answer_query: "MATCH (s:Station) RETURN s.name LIMIT $n", params: { n: 3 } });
    expect(rows.data.table.rows).toHaveLength(3);
    expect(rows.data.nodes).toHaveLength(0);
  });

  it("queries without a view", async () => {
    const res = await read.call("query_cypher", { query: "MATCH (s:Station {name: $name}) RETURN s", params: { name: "Falun central" } });
    expect(JSON.parse(res.text).nodes[0].props.name).toBe("Falun central");
    expect(res.data).toBeUndefined();
    expect((await read.call("query_cypher", { query: "NOT CYPHER" })).isError).toBe(true);
    const tool = (await read.client.listTools()).tools.find((t) => t.name === "query_cypher")!;
    expect(tool._meta?.ui).toBeUndefined();
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("auto-connects result nodes", async () => {
    const { data } = await read.call("show_result", {
      answer_query: "MATCH (s:Station {name: 'Falun central'})-[:CONNECTS]-(t:TrackSection) RETURN s, t",
    });
    expect(data.meta.autoConnectedEdges).toBeGreaterThan(0);
    expect(data.meta.danglingEdges).toBe(0);
  });

  it("refuses writes by default", async () => {
    const res = await read.call("show_result", { answer_query: CREATE });
    expect(res.isError).toBe(true);
    expect((await read.call("show_result", { answer_query: COUNT })).data.table.rows).toEqual([[0]]);
    const tool = (await read.client.listTools()).tools.find((t) => t.name === "show_result")!;
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect((tool._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri).toMatch(/^ui:/);
    expect((await read.call("query_cypher", { query: CREATE })).isError).toBe(true);
  });

  it("writes only through query_cypher in write mode", async () => {
    const res = await write.call("query_cypher", { query: CREATE });
    expect(JSON.parse(res.text).changes).toEqual(expect.objectContaining({ nodesCreated: 1 }));
    expect((await write.call("show_result", { answer_query: CREATE })).isError).toBe(true);
    expect((await read.call("query_cypher", { query: COUNT })).text).toContain('"rows":[[1]]');
    const { tools } = await write.client.listTools();
    const query = tools.find((t) => t.name === "query_cypher")!;
    expect(query.annotations?.destructiveHint).toBe(true);
    expect(query.description).toContain("WRITE MODE");
    expect(tools.find((t) => t.name === "show_result")!.annotations?.readOnlyHint).toBe(true);
    expect(tools.map((t) => t.name)).not.toContain("run_cypher");
  });

  it("sends the query with the result", async () => {
    const input = { answer_query: "MATCH (s:Station {name: $name}) RETURN s", params: { name: "Falun central" } };
    const { data, text } = await read.call("show_result", input);
    expect(data.query).toEqual(input);
    expect(text).not.toContain("$name");
  });

  it("lets only the view run an edited query, never writing", async () => {
    const run = await write.call("run_view_query", { answer_query: "MATCH (s:Station) RETURN s LIMIT 2" });
    expect(run.data.nodes).toHaveLength(2);
    expect(run.data.query).toEqual({ answer_query: "MATCH (s:Station) RETURN s LIMIT 2" });
    const count = async () => (await read.call("query_cypher", { query: COUNT })).text;
    const before = await count();
    expect((await write.call("run_view_query", { answer_query: CREATE })).isError).toBe(true);
    expect(await count()).toBe(before);
    const tool = (await read.client.listTools()).tools.find((t) => t.name === "run_view_query")!;
    expect((tool._meta?.ui as { visibility?: string[] }).visibility).toEqual(["app"]);
  });

  it("tells Claude what the user ran, until reset or a new result", async () => {
    const view = await connect(config);
    const none = "The user has not changed the query in the graph view.";
    const mine = { answer_query: "MATCH (s:Station {name: 'Falun central'}) RETURN s" };

    await view.call("reset_view_query");
    expect((await read.call("get_view_query")).text).toBe(none);

    await view.call("run_view_query", mine);
    await view.call("run_view_query", { answer_query: "NOT CYPHER" }); // a failed run saves nothing
    const saved = JSON.parse((await read.call("get_view_query")).text);
    expect(saved).toMatchObject(mine);
    expect(saved.summary).toContain("Falun central");
    expect(saved.ageSeconds).toBeGreaterThanOrEqual(0);

    await view.call("reset_view_query");
    expect((await read.call("get_view_query")).text).toBe(none);
    await view.call("run_view_query", mine);
    await read.call("show_result", { answer_query: "RETURN 1" });
    expect((await read.call("get_view_query")).text).toBe(none);
  });

  it("returns the saved query also when it no longer runs", async () => {
    createViewQueryStore(config, stateEnv).write({ answer_query: "NOT CYPHER" });
    const saved = JSON.parse((await read.call("get_view_query")).text);
    expect(saved.answer_query).toBe("NOT CYPHER");
    expect(saved.error).toBeTruthy();
    expect(saved).not.toHaveProperty("summary");
  });

  it("reports an unreachable database and keeps serving", async () => {
    const down = await connect({ ...config, uri: "bolt://localhost:1" });
    for (let i = 0; i < 2; i++) {
      const res = await down.call("show_result", { answer_query: "RETURN 1" });
      expect(res.isError).toBe(true);
      expect(res.text.length).toBeGreaterThan(10);
    }
  }, 60_000);

  it("shares the selection between two server instances and expands nodes", async () => {
    const view = await connect(config);
    const falun = await view.call("show_result", { answer_query: "MATCH (s:Station {name: 'Falun central'}) RETURN s", connect: false });
    const nodeId = falun.data.nodes[0].id;

    expect((await read.call("get_selection")).text).toBe("No node has been selected in the graph view.");
    await view.call("select_node", { nodeId });
    const selected = JSON.parse((await read.call("get_selection")).text);
    expect(selected.node.props.name).toBe("Falun central");
    expect(selected.neighbors.length).toBeGreaterThan(0);
    expect(selected.neighbors[0]).toMatchObject({ relationship: "CONNECTS", node: { labels: ["TrackSection"] } });
    expect(selected.neighborsTruncated).toBe(false);

    const expanded = await view.call("expand_node", { nodeId });
    expect(expanded.data.nodes.length).toBe(selected.neighbors.length + 1);

    for (const gone of ["999999999", "not-an-id"]) {
      await view.call("select_node", { nodeId: gone });
      expect((await read.call("get_selection")).text).toBe("The selected node no longer exists in the database.");
    }
    await view.call("select_node", { nodeId: null });
    expect((await read.call("get_selection")).text).toBe("No node has been selected in the graph view.");
  });

  it("serves the current view also for an outdated resource address", async () => {
    const res = await read.client.readResource({ uri: "ui://graph-explorer/view-00000000.html" });
    expect((res.contents[0] as { text: string }).text).toContain("view");
  });
});
