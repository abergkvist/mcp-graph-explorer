# Separate Querying from Showing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude can explore the database without creating views; only the final answer is shown.

**Architecture:** `run_cypher` is replaced by `query_cypher` (plain MCP tool, returns data) and `show_result` (MCP Apps tool with the view, always read-only). Writes move to `query_cypher`.

**Tech Stack:** TypeScript, `@modelcontextprotocol/server`, `ext-apps`, zod, vitest, Neo4j and Memgraph.

**Spec:** [docs/superpowers/specs/2026-11-26-query-show-split-design.md](../specs/2026-11-26-query-show-split-design.md)

## Global Constraints

- English in code, README and docs.
- Only necessary tests; no new test files.
- No changes in `packages/view` or `packages/normalizer`. No domain tools.
- `query_cypher` limits: 100 nodes, 100 relationships, 20,000 characters.
- Integration tests need `docker compose -f docker/compose.yaml up -d`.

## Review Focus

- A large exploring query (the whole network): valid JSON within the limits, with the cut noted. Task 1.
- A write that returns no rows: Claude still sees what was committed. Task 1.
- Processing fails after a committed write: the error says not to run the query again. Task 1.
- A failing query in `query_cypher`: a tool error with the database message. Task 1.
- In write mode, `show_result` given a writing query: refused, nothing written. Task 2.

---

### Task 1: `query_cypher`

**Files:**
- Modify: `packages/server/src/query.ts`, `packages/server/src/server.ts`, `packages/server/src/config.ts`
- Test: `packages/server/test/unit.test.ts`, `packages/server/test/server.int.test.ts`

**Interfaces:**
- Consumes: `toGraph(run, adapter)` in `query.ts`, `applyLimits(result, limits)`, `reportingErrors`, `text`.
- Produces: `queryData(runner: QueryRunner, adapter: DialectAdapter, input: { query: string; params?: Record<string, unknown> }): Promise<string>`; `LIMITS.query = { maxNodes: 100, maxEdges: 100, maxStructuredChars: 20_000 }`; MCP tool `query_cypher`.

The returned string is `JSON.stringify({ nodes, relationships, table, truncated, changes })`, where `relationships` is `result.edges`, `truncated` is `result.meta.truncated` and `changes` is left out for reads.

- [ ] **Step 1: Write the failing unit tests** in `unit.test.ts` (add `queryData` to the import from `../src/query.ts`)

```ts
describe("queryData", () => {
  const adapter = adapterFor("neo4j");

  it("returns the data within the limits and notes the cut", async () => {
    const many = Array.from({ length: 300 }, (_, i) => [node(i + 1)]);
    const out = await queryData(fakeRunner(many).runner, adapter, { query: "Q" });
    const data = JSON.parse(out);
    expect(out.length).toBeLessThanOrEqual(20_000);
    expect(data.nodes.length).toBeGreaterThan(0);
    expect(data.nodes.length).toBeLessThanOrEqual(100);
    expect(data.truncated).toContain("nodes");
    expect(data).not.toHaveProperty("changes");
  });
  it("reports a committed write without rows", async () => {
    const fake = fakeRunner([], "write");
    const data = JSON.parse(await queryData(fake.runner, adapter, { query: "Q" }));
    expect(fake.calls.map((c) => c.write)).toEqual([true]);
    expect(data.changes).toEqual({ nodesCreated: 1 });
  });
  it("says that a write was committed even if processing the result fails", async () => {
    const broken = fakeRunner(null as unknown as unknown[][], "write");
    await expect(queryData(broken.runner, adapter, { query: "Q" })).rejects.toThrow(/committed.*Do not run the query again/);
  });
});
```

- [ ] **Step 2: Write the failing integration test** in `server.int.test.ts`, inside `describe.each`

```ts
  it("queries without a view", async () => {
    const res = await read.call("query_cypher", { query: "MATCH (s:Station {name: $name}) RETURN s", params: { name: "Falun central" } });
    expect(JSON.parse(res.text).nodes[0].props.name).toBe("Falun central");
    expect(res.data).toBeUndefined();
    expect((await read.call("query_cypher", { query: "NOT CYPHER" })).isError).toBe(true);
    const tool = (await read.client.listTools()).tools.find((t) => t.name === "query_cypher")!;
    expect(tool._meta?.ui).toBeUndefined();
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });
```

- [ ] **Step 3: Run the tests and see them fail**

Run: `pnpm build && pnpm vitest run packages/server --no-file-parallelism`
Expected: FAIL, `queryData` is not a function and tool `query_cypher` not found.

- [ ] **Step 4: Implement `queryData` and `LIMITS.query`**

Run with `write` set to `runner.accessMode === "write"` and `LIMITS.maxRows`; set `meta.changes`. No auto-connect. If anything after a committed run throws, rethrow as `The write was committed. Do not run the query again. Processing the result failed: <reason>`.

- [ ] **Step 5: Register `query_cypher`** with `server.registerTool` (no `_meta`)

Title `Query graph`. Input: `query` (string, "Cypher to run"), `params` (optional record, "Query parameters"). Annotations as `run_cypher` has today. Returns only `content`. Description, read mode:

> Run a read-only Cypher query and get the data back. Nothing is shown to the user. Use it for all exploring and checking. When you have the answer, show it with show_result.

In write mode the first sentence is: `Run a Cypher query (WRITE MODE: it can change and delete data) and get the data back.`

- [ ] **Step 6: Run the tests and see them pass**

Run: `pnpm build && pnpm vitest run packages/server --no-file-parallelism`
Expected: PASS

- [ ] **Step 7: Commit** — `feat(server): query_cypher reads data without showing a view`

---

### Task 2: `show_result` replaces `run_cypher`

**Files:**
- Modify: `packages/server/src/server.ts`, `packages/server/src/query.ts`, `packages/server/src/summary.ts`, `README.md`
- Test: `packages/server/test/unit.test.ts`, `packages/server/test/server.int.test.ts`

**Interfaces:**
- Consumes: `query_cypher` from Task 1.
- Produces: MCP tool `show_result` with input `answer_query`, `context_query`, `params`, `connect` (unchanged). `runCypher` keeps its signature and never writes.

- [ ] **Step 1: Update the tests**

`unit.test.ts`:
- Remove "does not call a committed write without rows 'No results'", "says that a write was committed even if the follow-up query fails" and "lets only the answer query write, and says so".
- Add:

```ts
  it("never writes, also when the server is in write mode", async () => {
    const fake = fakeRunner([[1, 2]], "write");
    await runCypher(fake.runner, adapter, { answer_query: "A", context_query: "C" });
    expect(fake.calls.map((c) => c.write)).toEqual([false, false]);
  });
```

`server.int.test.ts`:
- Replace every `run_cypher` call with `show_result`, except the writes and their cleanup, which use `query_cypher` with `query`.
- In "refuses writes by default", also assert that `read.call("query_cypher", { query: CREATE })` is an error, and that the `show_result` tool has `_meta.ui.resourceUri` and `readOnlyHint: true`.
- Replace "writes only through answer_query in write mode" with:

```ts
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
```

If a database reports another counter name than `nodesCreated`, assert only that `changes` is not empty.

- [ ] **Step 2: Run the tests and see them fail**

Run: `pnpm build && pnpm vitest run packages/server --no-file-parallelism`
Expected: FAIL, tool `show_result` not found and the write flags are `[true, false]`.

- [ ] **Step 3: Make `runCypher` read-only** in `query.ts`

Remove the write argument, the `changes` handling and the committed-write wrapper (it now lives in `queryData`). Merge `complete` into `runCypher`. In `summary.ts`, remove the `meta.changes` line and condition.

- [ ] **Step 4: Rename the tool and set the texts** in `server.ts`

Name `show_result`, title `Show result`, annotations `{ readOnlyHint: true }` in both modes. Description, followed by a space and `CONTRACT`:

> Show the final answer to the user in the graph view. Call it exactly once for each question that is answered from the database, also when the answer is a single value or a table. Every call opens a new view, so do not use it to explore or to test a query: do that with query_cypher first.

Pass server instructions as the second `McpServer` argument (`{ instructions }`):

> To answer from the database, explore and check with query_cypher, which shows nothing, then call show_result exactly once with the final query.

- [ ] **Step 5: Update `README.md`**

- Intro: Claude explores without showing anything and then shows the final answer.
- Tool table: replace the `run_cypher` row with
  `query_cypher | Claude | Runs a query and returns the data; shows nothing` and
  `show_result | Claude | Runs answer_query, optionally context_query, and shows the result`.
- Write mode: `query_cypher` can create, change and delete data; "Always allow" refers to that tool; `show_result`, schema reading, expanding and selection stay read-only; the view does not note writes.
- Read-only section and "What is sent to Claude": name the new tools; `query_cypher` sends up to 100 nodes, 100 relationships and 20,000 characters of data.

- [ ] **Step 6: Run all tests**

Run: `pnpm typecheck && pnpm test && pnpm test:integration`
Expected: PASS

Run: `grep -rn "run_cypher" README.md packages/*/src packages/server/test`
Expected: only the `not.toContain("run_cypher")` assertion.

- [ ] **Step 7: Commit** — `feat(server)!: show_result replaces run_cypher and only shows the final answer`

---

## After the tasks (by hand, in Claude Desktop)

`pnpm build`, reload the MCP configuration and ask for the route between Ludvika and Falun in a new chat. Expected: one panel. Then open an older chat with a `run_cypher` result and check that its view still opens.
