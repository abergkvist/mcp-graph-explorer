# Graph Explorer v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En MCP-server som kör Cypher mot Neo4j eller Memgraph och visar resultatet som graf, tabell eller värde i Claude Desktops sidopanel.

**Architecture:** `normalizer` gör om drivrutinens resultat till ett JSON-säkert grafformat. `server` (stdio) kör frågor i läsläge och lägger grafen i `structuredContent` och en sammanfattning i `content`. `view` är en självständig HTML-fil. Inget delat minne mellan processer; bara markeringen går via en fil.

**Tech Stack:** TypeScript, Node 22, pnpm-workspace, Vitest, `neo4j-driver` 6, `@modelcontextprotocol/server` 2, `@modelcontextprotocol/ext-apps` 2, zod 4, React 19, Tailwind 4, shadcn/ui, Sigma 4, graphology, Vite + `vite-plugin-singlefile`.

**Spec:** [docs/design.md](design.md) (bakgrund: [spike-findings.md](spike-findings.md)). Fungerande exempel på MCP Apps-anropen finns i `spike/` tills Task 10.

## Global Constraints

- Repot hålls minimalt: bara nödvändiga paket, filer och enhetstester.
- Kod, verktygsbeskrivningar, UI-texter och README på engelska. Licens Apache-2.0 (`"license": "Apache-2.0"` i varje `package.json`).
- `GRAPH_ACCESS_MODE` är `read` (förval) eller `write`. I `read`: `neo4j.session.READ`, explicit transaktion, alltid rollback. Aldrig fristående `session.run`. I `write` får bara `run_cypher`s `answer_query` skriva (commit). Ingen regex-kontroll av frågor. Servern skriver inte om användarens Cypher.
- Modellen får aldrig hela grafen i text. All kapning syns i `meta.truncated`, i texten till modellen och i vyn.
- Gränser: `maxRows 1000`, `maxNodes 500`, `maxEdges 2000`, `timeoutMs 30000`, `maxStructuredChars 140000`, `maxTableRowsForModel 50`, `maxNeighbors 25`, `maxExpandEdges 50`.
- Inget `sendMessage`, inget `updateModelContext`, inga egna skrivverktyg.
- stdout i servern är reserverad för MCP; loggning går till stderr.
- Beroenden läggs till med `pnpm add` (senaste version), aldrig med versionsnummer ur minnet. Läs de installerade typdefinitionerna för Sigma 4 och MCP-paketen; gissa inte API:er.
- Små commits. Varje commitmeddelande slutar med den attributionsrad sessionen anger.
- Arbetet görs på en egen gren från `docs/spike-findings`.

## Review Focus

1. Heltal i `params` (t.ex. `LIMIT $n`): JavaScript-tal skickas som flyttal om de inte konverteras. Förväntat: frågan fungerar. (Test i Task 4.)
2. Databasen nere eller fel lösenord: verktyget ger ett läsbart fel och servern lever vidare. (Task 6.)
3. En gammal vy efter ombyggnad begär en `ui://`-adress med gammal hash. Förväntat: den får aktuell vy, inte ett fel. (Task 6.)
4. Markerat eller expanderat id som inte längre finns, eller inte är ett giltigt tal i Memgraph. Förväntat: ett tydligt "finns inte", inget Cypher-fel. (Task 4 och 8.)
5. Vyn får ett verktygsfel eller ett oväntat format. Förväntat: ett meddelande, aldrig en tom panel. (Task 7.)

## Filstruktur

```
package.json  pnpm-workspace.yaml  tsconfig.base.json  README.md
docker/compose.yaml  docker/seed.cypher
packages/normalizer/src/{types.ts, graph.ts, values.ts, normalize.ts, index.ts}
packages/normalizer/test/{normalize.test.ts, graph.test.ts}
packages/server/src/{config.ts, dialect.ts, runner.ts, limits.ts, summary.ts,
                     query.ts, schema.ts, selection.ts, server.ts, index.ts}
packages/server/test/{unit.test.ts, read-mode.int.test.ts, server.int.test.ts}
packages/view/{index.html, vite.config.ts, components.json}
packages/view/src/{main.tsx, App.tsx, host.ts, model.ts, renderer.ts,
                   sigma-renderer.ts, styles.css, components/…}
packages/view/test/model.test.ts
.github/workflows/ci.yml
```

Paketnamn: `@mcp-graph-explorer/{normalizer,server,view}`. ESM överallt. Rotskript: `build`, `test` (utan databaser: allt utom `*.int.test.ts`), `test:integration` (bara `*.int.test.ts`), `typecheck`.

---

### Task 1: Arbetsyta, databaser, testdata och läsläget (GRIND)

**Files:** Create: rotfilerna ovan (utom README), `docker/compose.yaml`, `docker/seed.cypher`, `packages/server/package.json`, `packages/server/test/read-mode.int.test.ts`

**Interfaces — Produces:** Neo4j på `bolt://localhost:7687` (`neo4j` / `graphexplorer`), Memgraph på `bolt://localhost:7688` (utan inloggning). Båda seedade efter `docker compose -f docker/compose.yaml up -d`.

- [ ] **Step 1:** Skapa workspace med rotskripten och `.gitignore`-täckning för `dist/` och `node_modules/`.
- [ ] **Step 2:** `compose.yaml` med `neo4j:2026.10.2-community` och `memgraph/memgraph:3.14.0`, healthchecks och engångstjänster som läser in `seed.cypher`. Seedningen ska tåla att köras igen.
- [ ] **Step 3:** `seed.cypher`, portabel mellan båda: 30–50 `(:Station {name, signature, lat, lon})`, däribland Gävle C, Falun C, Borlänge C och Uppsala C; `(:TrackSection {name, lengthKm})`; `(:Station)-[:CONNECTS]->(:TrackSection)-[:CONNECTS]->(:Station)`. Första raden: kommentar om att värdena är ungefärliga exempeldata.
- [ ] **Step 4:** Skriv `read-mode.int.test.ts`:

```ts
import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";

const targets = [
  { name: "neo4j", uri: "bolt://localhost:7687", auth: neo4j.auth.basic("neo4j", "graphexplorer") },
  { name: "memgraph", uri: "bolt://localhost:7688", auth: neo4j.auth.basic("", "") },
];
const COUNT = "MATCH (n:ReadModeProbe) RETURN count(n) AS c";

describe.each(targets)("$name", ({ uri, auth }) => {
  const driver = neo4j.driver(uri, auth);
  const count = async () => {
    const s = driver.session({ defaultAccessMode: neo4j.session.READ });
    try { return (await s.run(COUNT)).records[0].get("c").toNumber(); } finally { await s.close(); }
  };

  it("rejects a write in a READ session", async () => {
    const s = driver.session({ defaultAccessMode: neo4j.session.READ });
    await expect(s.run("CREATE (:ReadModeProbe)")).rejects.toThrow();
    await s.close();
    expect(await count()).toBe(0);
  });

  it("leaves nothing behind when a transaction is rolled back", async () => {
    const s = driver.session({ defaultAccessMode: neo4j.session.READ });
    const tx = s.beginTransaction();
    await tx.run("CREATE (:ReadModeProbe)").then((r) => r.records, () => {});
    await tx.rollback().catch(() => {});
    await s.close();
    expect(await count()).toBe(0);
  });
});
```

  Lägg till en `afterAll` per mål som i en WRITE-session tar bort `ReadModeProbe`-noder och stänger drivrutinen.
- [ ] **Step 5:** Run: `docker compose -f docker/compose.yaml up -d --wait && pnpm test:integration`
- [ ] **Step 6: GRIND.** Går båda testerna igenom för båda databaserna: fortsätt. Annars: **stanna** och redovisa för användaren vilken databas som släppte igenom vad. Ändra inte testet för att få det grönt.
- [ ] **Step 7:** Verifiera seedningen: `MATCH (s:Station) RETURN count(s)` ger samma tal (30–50) i båda.
- [ ] **Step 8:** Commit `build: workspace, databases, seed data and read-mode test`

---

### Task 2: Normaliserarens typer och värden

**Files:** Create: `packages/normalizer/{package.json, tsconfig.json}`, `src/{types.ts, values.ts, index.ts}`, `test/normalize.test.ts`

**Interfaces — Produces:**

```ts
// types.ts (inga importer från neo4j-driver)
export type Dialect = "neo4j" | "memgraph";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface GraphNode { id: string; labels: string[]; props: Record<string, Json>; placeholder?: true }
export interface GraphEdge { id: string; type: string; source: string; target: string; props: Record<string, Json> }
export interface Table { columns: string[]; rows: Json[][] }
export type Truncation = "rows" | "nodes" | "edges" | "properties";
export interface Meta { danglingEdges: number; truncated: Truncation[]; autoConnectedEdges: number; dialect: Dialect }
export interface GraphResult { nodes: GraphNode[]; edges: GraphEdge[]; table: Table; meta: Meta }

// values.ts
export function toJson(value: unknown): Json
```

`neo4j-driver` är peer dependency.

- [ ] **Step 1:** Failing test:

```ts
import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { toJson } from "../src/values.ts";

const { Date: NDate, Point, Duration } = neo4j.types;

describe("toJson", () => {
  it("converts integers, keeping unsafe ones as strings", () => {
    expect(toJson(neo4j.int(42))).toBe(42);
    expect(toJson(neo4j.int("9007199254740993"))).toBe("9007199254740993");
    expect(toJson(10n)).toBe(10);
  });
  it("converts temporal and spatial types", () => {
    expect(toJson(new NDate(2026, 11, 26))).toBe("2026-11-26");
    expect(toJson(new Duration(1, 2, 3, 0))).toBe(new Duration(1, 2, 3, 0).toString());
    expect(toJson(new Point(neo4j.int(4326), 15.6, 60.6))).toEqual({ srid: 4326, x: 15.6, y: 60.6 });
  });
  it("handles nesting and non-JSON values", () => {
    expect(toJson({ a: [neo4j.int(1), null, undefined] })).toEqual({ a: [1, null, null] });
    expect(toJson(NaN)).toBe("NaN");
    expect(toJson(new Int8Array([1, 2]))).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2:** Run `pnpm test` → FAIL (modulen saknas).
- [ ] **Step 3:** Implementera `toJson` med drivrutinens typvakter (`neo4j.isInt`, `isDate`, `isDateTime`, `isLocalDateTime`, `isTime`, `isLocalTime`, `isDuration`, `isPoint`). Punkter får `z` bara om den finns.
- [ ] **Step 4:** `pnpm test` → PASS. **Step 5:** Commit `feat(normalizer): JSON-safe value conversion`

---

### Task 3: Normaliserarens graf

**Files:** Create: `src/{normalize.ts, graph.ts}`, `test/graph.test.ts`; Modify: `src/index.ts`, `package.json` (exports `.` och `./graph`)

**Interfaces — Produces:**

```ts
// normalize.ts
export interface ResultInput { keys: string[]; rows: unknown[][] }
export function normalize(input: ResultInput, dialect: Dialect): GraphResult
// graph.ts — importerar bara types.ts, så att vyn kan använda den utan drivrutinen
export function mergeGraphs(base: GraphResult, extra: GraphResult): GraphResult
```

Regler:
- Id är drivrutinens `elementId` (för Memgraph fyller drivrutinen i det numeriska id:t som sträng).
- `meta.danglingEdges` = antal kanter med minst en platshållarändpunkt.
- En kolumn tas med i tabellen om någon cell har ett värde som inte är grafobjekt (eller en lista/map som innehåller sådant), eller om alla celler är `null`/tomma listor. En kolumn med bara grafobjekt och `null` utelämnas. Utan kolumner är `rows` tom.
- Grafobjekt i en medtagen cell blir `{ "$node": id }`, `{ "$edge": id }` eller `{ "$path": [id, …] }`.
- `mergeGraphs`: union på id, riktig nod ersätter platshållare, tabellen kommer från `base`, `danglingEdges` räknas om, `truncated` slås ihop, `autoConnectedEdges` summeras. `normalize` sätter `truncated: []` och `autoConnectedEdges: 0`.

- [ ] **Step 1:** Failing test:

```ts
import neo4j from "neo4j-driver";
import { describe, expect, it } from "vitest";
import { mergeGraphs } from "../src/graph.ts";
import { normalize } from "../src/normalize.ts";

const { Node, Relationship, Path, PathSegment } = neo4j.types;
const int = neo4j.int;
const node = (id: number, props = {}) => new Node(int(id), ["Station"], props, `n${id}`);
const rel = (id: number, a: number, b: number) =>
  new Relationship(int(id), int(a), int(b), "CONNECTS", {}, `r${id}`, `n${a}`, `n${b}`);
const run = (keys: string[], ...rows: unknown[][]) => normalize({ keys, rows }, "neo4j");
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("normalize", () => {
  it("turns nodes and relationships into a graph with no table", () => {
    const r = run(["a", "r", "b"], [node(1, { km: int(5) }), rel(9, 1, 2), node(2)]);
    expect(r.nodes[0]).toEqual({ id: "n1", labels: ["Station"], props: { km: 5 } });
    expect(r.edges[0]).toEqual({ id: "r9", type: "CONNECTS", source: "n1", target: "n2", props: {} });
    expect(r.table).toEqual({ columns: [], rows: [] });
    expect(r.meta.danglingEdges).toBe(0);
  });

  it("deduplicates on id", () => {
    const r = run(["a", "r"], [node(1), rel(9, 1, 2)], [node(1), rel(9, 1, 2)]);
    expect(ids(r.edges)).toEqual(["r9"]);
    expect(ids(r.nodes)).toEqual(["n1", "n2"]);
  });

  it("adds placeholders for missing endpoints", () => {
    const r = run(["r"], [rel(9, 1, 2)]);
    expect(r.nodes).toContainEqual({ id: "n2", labels: [], props: {}, placeholder: true });
    expect(r.meta.danglingEdges).toBe(1);
  });

  it("replaces a placeholder when the node appears later", () => {
    const r = run(["x"], [rel(9, 1, 2)], [node(1)], [node(2)]);
    expect(r.nodes.some((n) => n.placeholder)).toBe(false);
    expect(r.meta.danglingEdges).toBe(0);
  });

  it("walks paths, lists and maps", () => {
    const path = new Path(node(1), node(2), [new PathSegment(node(1), rel(9, 1, 2), node(2))]);
    const r = run(["p", "c", "m"], [path, [node(3)], { deep: [node(4)] }]);
    expect(ids(r.nodes)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(ids(r.edges)).toEqual(["r9"]);
    expect(r.table.columns).toEqual([]);
  });

  it("keeps scalar columns and references graph objects in mixed cells", () => {
    const r = run(["s", "name", "m"], [node(1), "Falun C", { station: node(1), n: int(2) }]);
    expect(r.table).toEqual({ columns: ["name", "m"], rows: [["Falun C", { station: { $node: "n1" }, n: 2 }]] });
  });

  it("keeps null columns and the columns of empty results", () => {
    expect(run(["x"], [null]).table).toEqual({ columns: ["x"], rows: [[null]] });
    expect(run(["a", "b"]).table).toEqual({ columns: ["a", "b"], rows: [] });
  });
});

describe("mergeGraphs", () => {
  it("unions graphs, resolves placeholders and keeps the base table", () => {
    const base = run(["r", "c"], [rel(9, 1, 2), 7]);
    const merged = mergeGraphs(base, run(["a", "b"], [node(1), node(2)]));
    expect(ids(merged.nodes)).toEqual(["n1", "n2"]);
    expect(merged.meta.danglingEdges).toBe(0);
    expect(merged.table).toEqual(base.table);
  });
});
```

- [ ] **Step 2:** `pnpm test` → FAIL. **Step 3:** Implementera. **Step 4:** `pnpm test && pnpm typecheck` → PASS.
- [ ] **Step 5:** Commit `feat(normalizer): graph extraction, table and merge`

---

### Task 4: Konfiguration, dialekter och frågekörning

**Files:** Create: `packages/server/src/{config.ts, dialect.ts, runner.ts}`, `test/unit.test.ts`

**Interfaces — Consumes:** `Dialect`, `ResultInput`. **Produces:**

```ts
// config.ts
export interface Config { uri: string; user: string; password: string; database?: string; dialect: Dialect; accessMode: "read" | "write" }
export function loadConfig(env: Record<string, string | undefined>): Config
export const LIMITS: { maxRows: 1000; maxNodes: 500; maxEdges: 2000; timeoutMs: 30000;
  maxStructuredChars: 140000; maxTableRowsForModel: 50; maxNeighbors: 25; maxExpandEdges: 50 }
// dialect.ts
export interface DialectAdapter {
  name: Dialect;
  idExpr(variable: string): string;              // "elementId(a)" | "id(a)"
  toIdParam(id: string): unknown | undefined;    // undefined = kan inte vara ett id
  schemaQueries: { nodes: string; relationships: string };  // fylls i Task 6
}
export function adapterFor(dialect: Dialect): DialectAdapter
// runner.ts
export function toDriverParams(params: Record<string, unknown>): Record<string, unknown>
export interface RunResult extends ResultInput { truncated: boolean; changes?: Record<string, number> }
export interface QueryRunner {
  readonly accessMode: "read" | "write";
  run(cypher: string, params?: Record<string, unknown>, maxRows?: number, write?: boolean): Promise<RunResult>;
  close(): Promise<void>;
}
export function createRunner(config: Config): QueryRunner
```

Miljövariabler: `GRAPH_URI` (förval `bolt://localhost:7687`), `GRAPH_USER`, `GRAPH_PASSWORD` (förval tomma), `GRAPH_DATABASE`, `GRAPH_DIALECT` (förval `neo4j`; annat värde än `neo4j`/`memgraph` ger fel), `GRAPH_ACCESS_MODE` (förval `read`; annat värde än `read`/`write` ger fel).

Runner: `write` gäller bara om anropet begär det **och** `accessMode` är `write`; då WRITE-session, hela resultatet konsumeras och transaktionen committas (rollback vid fel), `changes` fylls av räknarna som är större än 0. Annars READ-session, **explicit transaktion med `timeout: LIMITS.timeoutMs` som alltid rullas tillbaka**. I båda fallen: `toDriverParams` på parametrarna, läs högst `maxRows` poster och sätt `truncated` om det fanns fler. En egen klocka stänger sessionen om databasen inte håller tidsgränsen. Drivrutinen skapas utan att ansluta.

- [ ] **Step 1:** Failing tests:

```ts
it("sends safe integers as driver integers, floats unchanged", () => {
  const p = toDriverParams({ n: 5, x: 1.5, list: [2], m: { k: 3 }, s: "5" });
  expect(neo4j.isInt(p.n)).toBe(true);
  expect(p.x).toBe(1.5);
  expect(neo4j.isInt((p.list as unknown[])[0])).toBe(true);
  expect(neo4j.isInt((p.m as { k: unknown }).k)).toBe(true);
  expect(p.s).toBe("5");
});
it("maps ids per dialect", () => {
  expect(adapterFor("neo4j").idExpr("a")).toBe("elementId(a)");
  expect(adapterFor("neo4j").toIdParam("4:abc:1")).toBe("4:abc:1");
  expect(adapterFor("memgraph").idExpr("a")).toBe("id(a)");
  expect(adapterFor("memgraph").toIdParam("12")).toEqual(neo4j.int(12));
  expect(adapterFor("memgraph").toIdParam("4:abc:1")).toBeUndefined();
});
it("rejects an unknown dialect", () => {
  expect(() => loadConfig({ GRAPH_DIALECT: "arango" })).toThrow(/GRAPH_DIALECT/);
});
```

- [ ] **Step 2:** `pnpm test` → FAIL. **Step 3:** Implementera. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(server): config, dialects and read-only query runner`

---

### Task 5: Gränser, sammanfattning och `run_cypher`-logiken

**Files:** Create: `src/{limits.ts, summary.ts, query.ts}`; Modify: `test/unit.test.ts`

**Interfaces — Consumes:** `GraphResult`, `normalize`, `mergeGraphs`, `QueryRunner`, `DialectAdapter`, `LIMITS`. **Produces:**

```ts
export function applyLimits(result: GraphResult, limits?: Pick<typeof LIMITS, "maxNodes" | "maxEdges" | "maxStructuredChars">): GraphResult
export function summarize(result: GraphResult): string
export interface CypherInput { answer_query: string; context_query?: string; params?: Record<string, unknown>; connect?: "auto" | boolean }
export function runCypher(runner: QueryRunner, adapter: DialectAdapter, input: CypherInput): Promise<GraphResult>
```

- `applyLimits`: kapa noder, ta bort kanter vars ändpunkt försvann, kapa kanter. Är `JSON.stringify` fortfarande för lång: korta strängar över 500 tecken (`"properties"`), halvera sedan tabellraderna (`"rows"`) och noderna (`"nodes"`) tills det ryms. Varje åtgärd syns i `meta.truncated`, utan dubbletter.
- `runCypher`: kör båda frågorna med samma `params` (bara `answer_query` med `write: true`); i skrivläge börjar sammanfattningen med `Write mode: transaction committed.` följt av räknarna; `mergeGraphs(answer, context)`; auto-connect enligt specen med `MATCH (a)-[r]->(b) WHERE <id a> IN $ids AND <id b> IN $ids RETURN r LIMIT $max` (platshållare räknas inte med i `ids`); `autoConnectedEdges` = antalet **nya** kanter; sist `applyLimits`.
- `summarize`, i denna ordning och utelämnat när tomt: `Graph: N nodes, M relationships`; antal per label och per typ; `Most connected:` högst 5 noder som `label name (id)` där namn är `props.name`, annars `props.title`, annars bara id; `Table:` kolumner och högst 50 rader som JSON-rader, med `(K more rows not shown)`; `Truncated: …`; `No results.` om allt är tomt.

- [ ] **Step 1:** Failing tests (`graph(nodes, edges, rows)` är en lokal hjälpare som bygger ett `GraphResult`):

```ts
it("drops edges whose endpoints were cut", () => {
  const r = applyLimits(graph(3, [["n0", "n1"], ["n1", "n2"]]), { maxNodes: 2, maxEdges: 10, maxStructuredChars: 1e6 });
  expect(r.nodes).toHaveLength(2);
  expect(r.edges).toHaveLength(1);
  expect(r.meta.truncated).toContain("nodes");
});
it("fits structured content under the size limit", () => {
  const big = graph(200, [], Array.from({ length: 1000 }, () => ["x".repeat(5000)]));
  const r = applyLimits(big);
  expect(JSON.stringify(r).length).toBeLessThanOrEqual(140_000);
  expect(r.meta.truncated).toEqual(expect.arrayContaining(["properties"]));
});
it("summarizes without sending the whole graph", () => {
  const text = summarize(graph(400, [], Array.from({ length: 80 }, (_, i) => [i])));
  expect(text).toContain("400 nodes");
  expect(text).toContain("(30 more rows not shown)");
  expect(text.length).toBeLessThan(5000);
});
it("auto-connects only when the result has no relationships of its own", async () => { /* falsk runner:
  två noder utan kant → tre anrop räknas som: answer, connect; autoConnectedEdges === 1.
  Resultat som redan har en kant → bara ett anrop. connect: true → alltid två. connect: false → ett. */ });
```

Skriv det sista testet fullt ut med en falsk `QueryRunner` som returnerar `neo4j.types`-objekt och räknar anropen, med assertionerna i kommentaren.

- [ ] **Step 2:** FAIL. **Step 3:** Implementera. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(server): limits, model summary and auto-connect`

---

### Task 6: MCP-servern

**Files:** Create: `src/{schema.ts, server.ts, index.ts}`, `test/server.int.test.ts`; Modify: `src/dialect.ts`

**Interfaces — Consumes:** Task 4–5. **Produces:**

```ts
export interface SchemaEntry { name: string; properties: { name: string; examples: Json[] }[] }
export interface Schema { dialect: Dialect; labels: SchemaEntry[]; relationshipTypes: SchemaEntry[] }
export function readSchema(runner: QueryRunner, adapter: DialectAdapter): Promise<Schema>
export function createServer(deps: { runner: QueryRunner; adapter: DialectAdapter; viewHtml: () => string }): McpServer
```

- `index.ts`: `serveStdio` (se `spike/server.ts`); `viewHtml` läser `../../view/dist/index.html`, eller en kort "view not built"-sida.
- I skrivläge: `run_cypher` har `annotations: { readOnlyHint: false, destructiveHint: true }`, beskrivningens första mening byts mot `Run a Cypher query (WRITE MODE: it can change and delete data) and show the result in the graph view.`, och `index.ts` skriver en varning till stderr. I läsläge `readOnlyHint: true`.
- `get_schema`: urval av högst 10 000 noder och relationer, högst 3 exempelvärden per property, strängar kortade till 80 tecken.
- `run_cypher`: `registerAppTool` med `_meta.ui.resourceUri`; `content` = `summarize(result)`, `structuredContent` = resultatet. Databasfel returneras som `{ isError: true }` med databasens meddelande.
- Verktygsbeskrivningen för `run_cypher`, ordagrant:
  > Run a read-only Cypher query and show the result in the graph view. Visualization contract: return nodes, relationships or paths (RETURN p) instead of property projections; put scalar values in their own columns. If answer_query returns no nodes (aggregates, projections), also pass context_query returning the relevant subgraph.
- Resurs: `ui://graph-explorer/view-<8 tecken sha256 av HTML>.html`, `mimeType: RESOURCE_MIME_TYPE`, `_meta.ui.preferredDisplayMode: "fullscreen"` på innehållet. Registrera också en resursmall för `ui://graph-explorer/view-{hash}.html` som svarar med aktuell vy.

- [ ] **Step 1:** Failing `server.int.test.ts`: för båda databaserna, starta `createServer` mot en MCP-klient i samma process (in-memory-transport ur `@modelcontextprotocol` — läs typerna) och verifiera:
  - `get_schema` innehåller labels `Station` och `TrackSection`;
  - `run_cypher` med `MATCH (s:Station {name: $name}) RETURN s` och `params: {name: "Falun C"}` ger 1 nod;
  - `MATCH (s:Station) RETURN s.name LIMIT $n` med `{n: 3}` ger 3 rader och ingen nod;
  - `CREATE (:ReadModeProbe)` ger `isError` och inget skapas; med `accessMode: "write"` skapas noden, sammanfattningen säger `committed`, och samma `CREATE` som `context_query` ger `isError` (städa efteråt);
  - en runner mot `bolt://localhost:1` ger `isError` med text, och ett andra anrop besvaras också;
  - `resources/read` på `ui://graph-explorer/view-00000000.html` lyckas.
- [ ] **Step 2:** `pnpm test:integration` → FAIL. **Step 3:** Implementera. **Step 4:** `pnpm build && pnpm test && pnpm test:integration` → PASS.
- [ ] **Step 5:** Commit `feat(server): MCP tools and view resource`

---

### Task 7: Vyn — graf, tabell, värde

**Files:** Create: `packages/view/` enligt filstrukturen (utom detaljpanelen), `test/model.test.ts`

**Interfaces — Consumes:** `GraphResult`, `mergeGraphs` (`@mcp-graph-explorer/normalizer/graph`). **Produces:**

```ts
// model.ts
export function parseResult(structured: unknown): GraphResult | undefined
export function pickView(r: GraphResult): "graph" | "table" | "value" | "empty"
// renderer.ts
export interface GraphRenderer {
  setGraph(graph: Pick<GraphResult, "nodes" | "edges">): void;   // behåller positioner för kända id
  setSelected(id: string | null): void;
  setHighlight(ids: Set<string> | null): void;
  setHiddenLabels(labels: Set<string>): void;
  setTheme(theme: "light" | "dark"): void;
  destroy(): void;
}
export interface RendererEvents { onNodeClick(id: string): void; onBackgroundClick(): void; onNodeHover(id: string | null): void }
export type CreateRenderer = (el: HTMLElement, events: RendererEvents) => GraphRenderer
```

- shadcn med neutral bas; bara `button`, `tabs`, `input`, `badge`, `tooltip`. Eget neutralt, minimalistiskt utseende; hostens style-variabler används inte. Ljust/mörkt, storlek och safe areas följer hosten.
- Sigma 4 + graphology + ForceAtlas2 i `sigma-renderer.ts`, den enda filen som importerar Sigma. Färg per label (stabil mellan resultat); form per label om Sigma 4 stöder det, annars bara färg.
- `host.ts`: `App` med `availableDisplayModes: ["inline", "fullscreen"]`, handlers registrerade före `connect()` (mönster i `spike/view.ts`). Knappen **Open in panel** visas när `fullscreen` erbjuds och inte redan gäller. Inline har fast höjd 480 px.
- Texter: tomt `No results`; kapat `Result truncated: …`; ogiltigt resultat `This result can't be displayed`; verktygsfel visar felets text.

- [ ] **Step 1:** Failing test (`result(partial)` fyller ut ett `GraphResult`):

```ts
it("picks the view from the content", () => {
  const n = { id: "1", labels: [], props: {} };
  expect(pickView(result({ nodes: [n] }))).toBe("graph");
  expect(pickView(result({ table: { columns: ["a", "b"], rows: [[1, 2]] } }))).toBe("table");
  expect(pickView(result({ table: { columns: ["c"], rows: [[7]] } }))).toBe("value");
  expect(pickView(result({ table: { columns: ["c"], rows: [] } }))).toBe("empty");
});
it("rejects unexpected payloads", () => {
  for (const bad of [undefined, null, "x", {}, { nodes: 1 }]) expect(parseResult(bad)).toBeUndefined();
});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implementera `model.ts`. **Step 4:** PASS. Commit `feat(view): result model`
- [ ] **Step 5:** Bygg UI, renderare och hostkoppling. `pnpm build` ger **en** fil `packages/view/dist/index.html` utan externa referenser.
- [ ] **Step 6:** Titta på vyn i en webbläsare med exempeldata (utvecklingsläge) i ljust och mörkt tema vid 320 och 620 px bredd. Visa användaren skärmdumpar och justera efter synpunkter.
- [ ] **Step 7: GRIND i Claude Desktop** (användaren testar; lägg till servern som `graph-explorer` i konfigurationen efter en säkerhetskopia): graf för hela järnvägsnätet är läsbar i panelen; tabell och värde visas; tio vyer i samma chatt visas fortfarande när man går tillbaka. Misslyckas WebGL-delen: skapa och släpp renderaren efter synlighet; räcker inte det, stanna för beslut.
- [ ] **Step 8:** Commit `feat(view): graph, table and value views`

---

### Task 8: Detaljer, markering och expandering

**Files:** Create: `packages/server/src/selection.ts`, `packages/view/src/components/node-details.tsx`; Modify: `server.ts`, `App.tsx`, `test/unit.test.ts`

**Interfaces — Produces:**

```ts
export interface SelectionStore { write(nodeId: string | null): void; read(): { nodeId: string; selectedAt: string } | undefined }
export function createSelectionStore(config: Pick<Config, "uri" | "database">, env?: Record<string, string | undefined>): SelectionStore
```

- Fil: `selection-<16 tecken sha256 av "uri|database">.json` i `GRAPH_STATE_DIR`, annars plattformens datakatalog under `mcp-graph-explorer/`. Atomisk skrivning (tmp + rename). `createServer` får `selection: SelectionStore` i sina deps.
- Verktyg bara för vyn (`_meta.ui.visibility: ["app"]`): `select_node({ nodeId: string | null })`, `expand_node({ nodeId: string })` → `GraphResult` i `structuredContent`.
- `get_selection` (modellen, `readOnlyHint`), beskrivning ordagrant:
  > Returns the node the user last clicked in the graph view, with its properties and neighbors. Call this whenever the user refers to something in the graph without naming it, e.g. "this", "that station", "here", "the selected node", "den här", "härifrån", "den markerade".
- Svar: JSON-text `{ node, neighbors: [{ relationship, direction, node }], selectedAt, ageSeconds, neighborsTruncated }`; högst 25 grannar. Ingen markering: `No node has been selected in the graph view.` Saknad nod: `The selected node no longer exists in the database.`
- Uppslag: `MATCH (n) WHERE <id n> = $id OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m LIMIT $max`. `toIdParam` som ger `undefined` behandlas som saknad nod utan databasanrop.
- Vyn: klick → markera, visa detaljer (labels, properties), anropa `select_node`; bakgrundsklick → `null`. **Expand** → `mergeGraphs` i vyn; expanderat försvinner vid omladdning.

- [ ] **Step 1:** Failing tests:

```ts
it("round-trips the selection per connection and clears it", () => {
  const env = { GRAPH_STATE_DIR: mkdtempSync(join(tmpdir(), "gx-")) };
  const a = createSelectionStore({ uri: "bolt://a" }, env);
  const b = createSelectionStore({ uri: "bolt://b" }, env);
  a.write("n1");
  expect(a.read()?.nodeId).toBe("n1");
  expect(b.read()).toBeUndefined();
  a.write(null);
  expect(a.read()).toBeUndefined();
});
```

  Och i `server.int.test.ts`: `select_node` i en serverinstans följt av `get_selection` i en annan ger noden med grannar; `select_node` med `nodeId: "999999999"` följt av `get_selection` ger "no longer exists" (båda databaserna).
- [ ] **Step 2:** FAIL. **Step 3:** Implementera. **Step 4:** PASS.
- [ ] **Step 5:** Användaren testar i Claude Desktop: klick, "berätta om den här", Expand.
- [ ] **Step 6:** Commit `feat: node details, selection and expand`

---

### Task 9: Sökning, filter och tooltip

**Files:** Modify: `model.ts`, `App.tsx`, `sigma-renderer.ts`, `test/model.test.ts`; Create: `components/toolbar.tsx`

**Interfaces — Produces:** `export function searchNodes(nodes: GraphNode[], query: string): Set<string> | null` — skiftlägesokänsligt mot labels och property-värden; `null` för tom sökning.

- [ ] **Step 1:** Failing test:

```ts
it("searches labels and property values", () => {
  const nodes = [{ id: "1", labels: ["Station"], props: { name: "Falun C" } }, { id: "2", labels: ["TrackSection"], props: { lengthKm: 12 } }];
  expect(searchNodes(nodes, "falun")).toEqual(new Set(["1"]));
  expect(searchNodes(nodes, "track")).toEqual(new Set(["2"]));
  expect(searchNodes(nodes, "  ")).toBeNull();
});
```

- [ ] **Step 2:** FAIL. **Step 3:** Implementera sökfält (markerar träffar), etikettfilter som klickbara badges och tooltip med de första 8 properties. **Step 4:** PASS och visuell kontroll i webbläsaren.
- [ ] **Step 5:** Commit `feat(view): search, label filter and tooltip`

---

### Task 10: README, CI och städning

**Files:** Create: `README.md`, `.github/workflows/ci.yml`, `docs/screenshot.png`; Delete: `spike/`

- [ ] **Step 1:** README: syfte, skärmdump eller gif, `docker compose -f docker/compose.yaml up -d`, `pnpm install && pnpm build`, Claude Desktop-konfiguration för båda databaserna (absolut sökväg till `node` och `packages/server/dist/index.js`, miljövariablerna), verktygen, säkerhet (varför `read` är förval, vad `GRAPH_ACCESS_MODE=write` innebär, `LOAD CSV`, rollback, att procedurer kan ha sidoeffekter och att en databasanvändare med bara läsrätt rekommenderas, att schemaexempel och resultatsammanfattningar skickas till Claude), begränsningar (testat i Claude Desktop; sidopanelen finns inte för alla; gemensam markering), licens.
- [ ] **Step 2:** CI: Node 22, `pnpm install --frozen-lockfile`, `build`, `typecheck`, `test`.
- [ ] **Step 3:** Ta bort `spike/` och `graph-spike` ur `claude_desktop_config.json` (bara den posten).
- [ ] **Step 4:** Verifiera från ren klon: stegen i README fungerar och `pnpm build && pnpm test` går igenom.
- [ ] **Step 5:** Commit `docs: README, CI and spike removal`
