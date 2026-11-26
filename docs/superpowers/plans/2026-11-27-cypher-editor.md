# Cypher Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the Cypher behind a result in the view, let the user edit and run it in the same view, and let Claude find out what was run.

**Architecture:** `show_result` returns its input with the result. A view-only tool runs an edited query read-only and saves it in a state file, which a new model tool reads. The view adds a CodeMirror panel and swaps the shown result.

**Tech Stack:** TypeScript, MCP server SDK and ext-apps, zod, React, CodeMirror 6, vitest.

**Spec:** `docs/superpowers/specs/2026-11-27-cypher-editor-design.md`

## Global Constraints

- The editor never writes: `run_view_query` is read-only also in write mode.
- The editor is hidden by default.
- Results without a stored query have no Cypher button.
- English in code, README and docs. Only necessary tests; no component-testing dependencies.
- Branch `feat/cypher-editor`.
- Integration tests need the databases: `docker compose -f docker/compose.yaml up -d`.

## Review Focus

1. An old or malformed stored result: it still renders, without the button. (Task 3 test)
2. The context editor is emptied: the query runs without `context_query`, not with an empty one. (Task 3 test)
3. The saved query no longer runs (data or database changed): Claude still gets the query, with the error. (Task 2 test)
4. An Expand still in flight when a new result arrives: its nodes are not merged into the new result. (Task 4 manual check)
5. The Table tab is open and the new result has no table: the graph is shown, not an empty panel. (Task 4 manual check)

---

### Task 1: The query travels with the result, and the view can run one

**Files:**
- Modify: `packages/normalizer/src/types.ts`, `packages/normalizer/src/index.ts` (export)
- Modify: `packages/server/src/query.ts`, `packages/server/src/server.ts`
- Test: `packages/server/test/server.int.test.ts`

**Interfaces:**
- Produces, in the normalizer:
  ```ts
  export interface ViewQuery {
    answer_query: string;
    context_query?: string;
    params?: Record<string, unknown>;
    connect?: "auto" | boolean;
  }
  // and on GraphResult:
  query?: ViewQuery;
  ```
- Produces: `CypherInput` in `query.ts` becomes an alias of `ViewQuery`.
- Produces: app-only tool `run_view_query`, input as `show_result`, `structuredContent` is a `GraphResult` with `query`.

- [ ] **Step 1: Write the failing tests** (inside `describe.each`)

```ts
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
```

- [ ] **Step 2: Verify they fail**

Run: `pnpm build && npx vitest run packages/server/test/server.int.test.ts`
Expected: FAIL, `data.query` undefined and `run_view_query` not found.

- [ ] **Step 3: Implement**

In `server.ts`, move the `show_result` input schema to a shared `const cypherInput = z.object({...})` used by both tools. Both return `structuredContent: { ...result, query: input }`. `run_view_query` is registered with the other app-only tools, with `readOnlyHint: true`, and returns `text("ok")` as content. It calls `runCypher`, which never writes.

- [ ] **Step 4: Verify they pass**

Run: same command. Expected: PASS for both dialects.

- [ ] **Step 5: Commit** `feat(server): the view gets the query and can run an edited one`

---

### Task 2: Claude can read what the user ran

**Files:**
- Create: `packages/server/src/state.ts`, `packages/server/src/view-query.ts`
- Modify: `packages/server/src/selection.ts`, `server.ts`, `index.ts`
- Test: `packages/server/test/unit.test.ts`, `server.int.test.ts`

**Interfaces:**
- Consumes: `ViewQuery`, `run_view_query`.
- Produces: `stateFile<T>(config: Pick<Config, "uri" | "database">, name: string, env?: Env): { write(value: T | null): void; read(): unknown }` in `state.ts`. It takes over the directory, key and atomic write from `selection.ts`; the file is `<name>-<key>.json`, so the selection file keeps its name.
- Produces, in `view-query.ts`:
  ```ts
  export interface SavedQuery { query: ViewQuery; ranAt: string }
  export interface ViewQueryStore { write(query: ViewQuery | null): void; read(): SavedQuery | undefined }
  export function createViewQueryStore(config: Pick<Config, "uri" | "database">, env?: Env): ViewQueryStore;
  ```
  `read` returns undefined for a missing or malformed file. File name prefix: `query`.
- Produces: `ServerDeps.viewQuery: ViewQueryStore`; app-only tool `reset_view_query` (empty input); model tool `get_view_query`.

- [ ] **Step 1: Write the failing tests**

`unit.test.ts`:

```ts
describe("view query store", () => {
  it("round-trips the query apart from the selection and clears it", () => {
    const env = { GRAPH_STATE_DIR: mkdtempSync(join(tmpdir(), "gx-")) };
    const queries = createViewQueryStore({ uri: "bolt://a" }, env);
    const selection = createSelectionStore({ uri: "bolt://a" }, env);
    queries.write({ answer_query: "RETURN 1" });
    expect(queries.read()?.query).toEqual({ answer_query: "RETURN 1" });
    expect(selection.read()).toBeUndefined();
    queries.write(null);
    expect(queries.read()).toBeUndefined();
  });
});
```

`server.int.test.ts` (pass `viewQuery: createViewQueryStore(config, stateEnv)` in `connect`):

```ts
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
```

- [ ] **Step 2: Verify they fail**

Run: `pnpm build && npx vitest run packages/server/test`
Expected: FAIL, `view-query.ts` missing.

- [ ] **Step 3: Implement**

- `run_view_query` saves its input after `runCypher` succeeds. `show_result` removes the saved query first thing, whether or not it then succeeds.
- `get_view_query` has `readOnlyHint: true`. With nothing saved it returns the `none` text above. Otherwise JSON: the query's fields, `ranAt`, `ageSeconds`, and either `summary` (`summarize(await runCypher(...))`) or `error` (the message).
- Its description:
  > Returns the Cypher the user last ran themselves in the graph view's editor, with a summary of its result. Call this whenever the user refers to their own query or to what the panel shows now, since they may have changed it.
- `index.ts` creates the store and passes it in.

- [ ] **Step 4: Verify they pass**

Run: same command. Expected: PASS, including the existing selection tests.

- [ ] **Step 5: Commit** `feat(server): get_view_query tells Claude what the user ran`

---

### Task 3: View model and host calls

**Files:**
- Modify: `packages/view/src/model.ts`, `host.ts`, `demo.ts`
- Test: `packages/view/test/model.test.ts`

**Interfaces:**
- Consumes: `ViewQuery`, `run_view_query`, `reset_view_query`.
- Produces: `editedQuery(original: ViewQuery, answer: string, context: string): ViewQuery | undefined` in `model.ts`. Undefined if `answer` is blank; a blank `context` removes `context_query`; `params` and `connect` are kept.
- Produces: `parseResult` drops a `query` that lacks a string `answer_query` or has a non-string `context_query`, keeping the rest of the result.
- Produces on `Host`: `runQuery(query: ViewQuery): Promise<GraphResult>` (throws with the database's message) and `resetQuery(): void`.

- [ ] **Step 1: Write the failing tests**

```ts
  it("keeps a usable query and drops a broken one without losing the result", () => {
    const query = { answer_query: "RETURN 1" };
    expect(parseResult(result({ query }))?.query).toEqual(query);
    for (const broken of [{}, { answer_query: 1 }, { answer_query: "A", context_query: 2 }, "A", null]) {
      const parsed = parseResult(result({ query: broken as never }));
      expect(parsed).toBeDefined();
      expect(parsed!.query).toBeUndefined();
    }
  });
  it("builds the query to run from the editors", () => {
    const original = { answer_query: "A", context_query: "C", params: { n: 1 }, connect: false };
    expect(editedQuery(original, "B", "D")).toEqual({ ...original, answer_query: "B", context_query: "D" });
    expect(editedQuery(original, "B", "  \n")).toEqual({ answer_query: "B", params: { n: 1 }, connect: false });
    expect(editedQuery(original, " ", "C")).toBeUndefined();
  });
```

- [ ] **Step 2: Verify they fail**

Run: `pnpm build && npx vitest run packages/view/test/model.test.ts`
Expected: FAIL, `editedQuery` is not a function.

- [ ] **Step 3: Implement**

`runQuery` follows `expandNode` in `host.ts`. `resetQuery` follows `selectNode`. In `demo.ts`, give the base result `query: { answer_query: "MATCH p = (:Station)-[:CONNECTS*2]-(:Station)\nRETURN p", params: {} }`.

- [ ] **Step 4: Verify they pass**

Run: same command, then `pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `feat(view): read the query and run an edited one`

---

### Task 4: The editor

**Files:**
- Create: `packages/view/src/components/code-editor.tsx`, `query-panel.tsx`
- Modify: `packages/view/src/App.tsx`, `packages/view/package.json`

**Interfaces:**
- Consumes: `editedQuery`, `Host.runQuery`, `Host.resetQuery`.
- Produces: `CodeEditor({ value, onChange, onRun, label }: { value: string; onChange(value: string): void; onRun(): void; label: string })`
- Produces: `QueryPanel({ original, hidden, onRun, onReset }: { original: ViewQuery; hidden: boolean; onRun(query: ViewQuery): Promise<void>; onReset(): void })`

- [ ] **Step 1: Add dependencies**

Run: `pnpm --filter @mcp-graph-explorer/view add @codemirror/state@^6.7.6 @codemirror/view@^6.44.2 @codemirror/language@^6.13.1 @codemirror/legacy-modes@^6.5.5 @codemirror/commands@^6.11.2 @lezer/highlight@^1.2.5`

- [ ] **Step 2: `CodeEditor`**

- Language: `StreamLanguage.define(cypher)` from `@codemirror/legacy-modes/mode/cypher`.
- Line numbers, history, default keymap, line wrapping.
- `Mod-Enter` calls `onRun`; wrap it in `Prec.highest`, because the default keymap already binds it.
- Colours come from the CSS variables in `styles.css` (add syntax variables for `:root` and `.dark`), so the theme follows without a prop.
- Create the `EditorView` once; keep `onChange`/`onRun` current through refs (as `GraphCanvas` does); replace the document when `value` differs from it.

- [ ] **Step 3: `QueryPanel`**

- Holds the two drafts, `busy` and `error`. Stays mounted while hidden, so drafts survive closing it.
- Context editor only if `original.context_query` is set, labelled "Context query". `params` shown read-only as JSON when not empty.
- Run (⌘↵ / Ctrl↵) is disabled while busy or when `editedQuery` is undefined; the shortcut obeys the same rule. Reset is disabled while busy.
- A failed run shows the message under the editor. Reset restores the drafts, clears the error and calls `onReset`.
- Panel height at most 45% of the view, scrolling inside.

- [ ] **Step 4: Wire it into `App.tsx`**

- A component above `Result` holds the shown result. Run: `setShown(await host.runQuery(query))`. Reset: `setShown({ ...initial })` and `host.resetQuery()`.
- `Result` gets the panel and a "Cypher" button (`aria-expanded`) in the header, only when `initial.query` exists. The panel sits between the header and the notices, in all four views.
- `Result` stays mounted when its result changes. When the prop changes it: takes the new result; clears selection (also `host.selectNode(null)` if one was set), expansion and search; keeps layout, hidden labels and the open panel; sets the tab to "graph" if the new result has no table columns; falls back to "force" if the layout is geographic and the new nodes have no coordinates (`hasCoordinates`).
- An expand that was started on an earlier result is discarded when it returns.
- Rename the search state `query`/`setQuery` to `search`/`setSearch`.

- [ ] **Step 5: Build and typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, and `packages/view/dist/index.html` built.

- [ ] **Step 6: Check in the browser**

Run: `pnpm --filter @mcp-graph-explorer/view dev`, then open `?demo=graph`, `?demo=table`, `?demo=value`, `?demo=empty`, each also with `&theme=dark`.
Expected: the button toggles the editor; highlighting and line numbers are readable in both themes; Run shows "Not connected to a host" under the editor and the result stays.

Review Focus 4 and 5 need a successful run: temporarily make `runQuery` in demo mode resolve after 2 seconds with `demo("value")` or `demo("graph")` without table columns. Check that the graph shows when the Table tab was open, and that nothing from the old result remains. Temporarily delay `expandNode` the same way to check that a late expand is ignored. Remove the temporary code (`git diff` shows none of it).

- [ ] **Step 7: Commit** `feat(view): Cypher editor in the panel`

---

### Task 5: README and the real host

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

- "What you can do": show and edit the Cypher behind a result; Run is read-only, also in write mode.
- Tool table: add `get_view_query` (Claude); add `run_view_query` and `reset_view_query` to the view-only row.
- "What is sent to Claude": the query you ran and its summary, when Claude calls `get_view_query`.
- "Limits": the edit is gone if the view is reloaded; the last run wins across chats. The last-run query and its parameters are kept in `GRAPH_STATE_DIR` (update that variable's description).
- `show_result` also remains read-only in the write mode list; add `run_view_query` there.

- [ ] **Step 2: Run everything**

Run: `pnpm typecheck && pnpm test && pnpm test:integration`
Expected: all PASS.

- [ ] **Step 3: Commit** `docs: README for the Cypher editor`

- [ ] **Step 4: Try in Claude Desktop** (done by the user)

Reload the MCP configuration. Ask for a result, open Cypher, edit, Run, then ask Claude about the new result. Expected: the same panel updates and Claude calls `get_view_query`.
