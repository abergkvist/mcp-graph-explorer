# mcp-graph-explorer

Ask questions about a graph database in Claude Desktop and see the answer as an interactive graph
in the side panel, where it does not scroll away.

Claude writes Cypher and this MCP server runs it against [Memgraph](https://memgraph.com/), [ArcadeDB](https://arcadedb.com/), [Neo4j](https://neo4j.com/) or another [BOLT](https://neo4j.com/docs/bolt/current/bolt/) compatible graph database. Claude can
explore and check without showing anything, and then shows the final answer in an
[MCP Apps](https://github.com/modelcontextprotocol/ext-apps) view as a graph, a table or a single
value.

![The graph view showing the example railway network](docs/screenshot.png)

## Quick start

Requirements: Node 22 or later, pnpm, Docker and Claude Desktop.

```bash
docker compose -f docker/compose.yaml up -d
pnpm install
pnpm build
```

This starts Neo4j on `bolt://localhost:7687` (user `neo4j`, password `graphexplorer`) and Memgraph
on `bolt://localhost:7688` (no login), both loaded with the same railway network: 82 operational
points and 84 sections of line in Dalarna and Gävle, Sweden ([data source](#data)). It also starts ArcadeDB on
`bolt://localhost:7692` (user `root`, password `graphexplorer`, database `graph`) with the same data.
**Read mode does not protect ArcadeDB's schema**, see [Security](#security).

```
(:Station | :Junction)-[:CONNECTS]->(:TrackSection)-[:CONNECTS]->(:Station | :Junction)
```

Add the server to `claude_desktop_config.json` (on macOS in
`~/Library/Application Support/Claude/`), with absolute paths:

```json
{
  "mcpServers": {
    "graph-explorer": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/mcp-graph-explorer/packages/server/dist/index.js"],
      "env": {
        "GRAPH_URI": "bolt://localhost:7687",
        "GRAPH_USER": "neo4j",
        "GRAPH_PASSWORD": "graphexplorer",
        "GRAPH_DIALECT": "neo4j",
        "GRAPH_ACCESS_MODE": "read"
      }
    }
  }
}
```

For Memgraph use `"GRAPH_URI": "bolt://localhost:7688"` and `"GRAPH_DIALECT": "memgraph"`, and
leave out user and password. For ArcadeDB use `"GRAPH_URI": "bolt://localhost:7692"`,
`"GRAPH_USER": "root"`, `"GRAPH_DATABASE": "graph"` and keep `"GRAPH_DIALECT": "neo4j"`. Reload the MCP configuration (Developer menu) or restart Claude
Desktop, then ask for example "Show the whole railway network".

| Variable | Default | Meaning |
|---|---|---|
| `GRAPH_URI` | `bolt://localhost:7687` | Bolt address |
| `GRAPH_USER`, `GRAPH_PASSWORD` | empty | Login |
| `GRAPH_DATABASE` | server default | Database name |
| `GRAPH_DIALECT` | `neo4j` | `neo4j` or `memgraph` |
| `GRAPH_ACCESS_MODE` | `read` | `read` or `write`, see below |
| `GRAPH_STATE_DIR` | platform data directory | Where the selected node id and your last-run query, with its parameters, are kept |

## What you can do

- **Graph, table or value**, depending on what the query returns.
- **Cypher** shows the query behind the result. Edit it and press Run (⌘↵ / Ctrl↵) to update the
  view; Reset brings back Claude's query and result. The editor only reads, also in write mode.
  Ask Claude about your result and it looks the query up with `get_view_query`.
- **Click a node** to see its properties, and **Expand** to add its neighbors.
- **Click a relationship** to see its type, ends and properties. No tool looks up a selected
  relationship; Claude learns of it only through the [model context](#what-claude-knows-about-the-view).
- **Refer to the selection in the chat** ("what connects to this one?"). Claude looks it up with
  `get_selection`.
- **Drag** nodes to rearrange them.
- **Choose a layout:** force-directed (default), circular, or geographic when nodes have `lat`/`lon`,
  `latitude`/`longitude` or a WGS 84 point property. Geographic draws no background map, and places
  nodes without coordinates between their neighbors.
- **Search** nodes and **filter** by label.
- Earlier results stay in the chat and can be opened in the panel again.

| Tool | For | Does |
|---|---|---|
| `get_schema` | Claude | Labels, relationship types and properties with example values |
| `query_cypher` | Claude | Runs a query and returns the data; shows nothing |
| `show_result` | Claude | Runs `answer_query`, optionally `context_query`, and shows the result |
| `get_selection` | Claude | The node you last clicked, with its neighbors |
| `get_view_query` | Claude | The query you last ran in the view, with a summary of its result |
| `select_node`, `expand_node`, `run_view_query`, `reset_view_query` | the view | Not visible to Claude |

## What Claude knows about the view

The view tells Claude what you are looking at in two ways.

1. **Model context.** When you select a node or relationship, or run your own query, the view calls
   `updateModelContext` (MCP Apps) with the whole current state. Claude should then have it with your
   next message, without calling a tool.
2. **Tools.** `get_selection` and `get_view_query` let Claude ask. Claude has to think of calling
   them, so say "the selected node" or "my query" if it does not.

**The model context may never reach Claude, and the view cannot tell:** the host accepts the update
either way. This looks like a bug in Claude Desktop, so the server keeps both ways.

In our test on 27 November 2026 (Claude Desktop 6.28899.6, macOS, one run each, same test view):

| MCP server connected as | Update accepted | Claude saw it |
|---|---|---|
| Local stdio server, which is how this project runs | yes | **no** |
| Remote connector over Streamable HTTP | yes | yes |

Others report the same symptom, also with remote servers, and that it comes and goes between
versions and kinds of session:

- [anthropics/claude-ai-mcp#826](https://github.com/anthropics/claude-ai-mcp/issues/826): update
  accepted but never reaches the model
- [anthropics/claude-ai-mcp#1217](https://github.com/anthropics/claude-ai-mcp/issues/1217): content
  never reaches the model in Claude Desktop, while claude.ai in the browser works
- [modelcontextprotocol/ext-apps#852](https://github.com/modelcontextprotocol/ext-apps/issues/852):
  an app cannot tell whether its update reaches the model

This server has no Streamable HTTP transport yet.

## Security

### Read-only by default

The queries are written by a language model. It can misunderstand you, and text stored in your
data can influence what it does. Therefore the server is read-only unless you say otherwise: it
runs every query in a read-mode transaction that is always rolled back, so the database itself
rejects writes. ArcadeDB is an exception, see below.

Memgraph ignores read mode for auto-commit queries. The server never uses them.

### ArcadeDB

Tested with 26.10.2: ArcadeDB does not reject writes in read mode.

- Changes to data are undone by the rollback, but the query reports no error and returns what it
  would have written.
- **Schema changes are kept.** Creating and dropping indexes and constraints takes effect even in
  read mode, and new empty types remain.

Use ArcadeDB only with data you can restore.

### Write mode

Setting `GRAPH_ACCESS_MODE=write` is your decision. Know what it means:

- Claude's `query_cypher` can **create, change and delete data**, and it is committed immediately.
  There is no undo.
- If you have chosen "Always allow" for `query_cypher` in Claude Desktop, **you are not asked** before a
  write.
- `show_result`, the Cypher editor, `get_view_query`, schema reading, expanding and selection stay
  read-only.
- The view does not say that something was written; only Claude is told what changed.
- Use it against data you can restore.

### What read mode does not stop

- `LOAD CSV` only reads, but it reads from the **database server**: files in Memgraph, network
  addresses in Neo4j.
- Procedures installed in your database may have side effects outside the transaction.
- Neo4j administration commands that are not writes: with an administrator login, `SHOW TRANSACTIONS`
  shows other users' query text and parameters, and `TERMINATE TRANSACTIONS` stops their queries.
  Neo4j Community Edition has no restricted users, so do not point the server at a shared instance there.

If your database edition supports users with limited rights, connect with one that can only read.

### What is sent to Claude

Schema example values, the data returned by `query_cypher` (up to 100 nodes, 100 relationships and
20,000 characters per call), `show_result` summaries (including up to 50 table rows), the selected
node with its neighbors, and, when Claude calls `get_view_query`, the query you ran with its
parameters and a summary of its result are sent to Claude. The view also puts the selected node or
relationship with its properties, and your own query with its parameters, in the model context
(long values are cut). The complete graph of a shown result is part of the tool
result, which Claude Desktop keeps with the conversation.

## Limits

At most 1,000 rows, 500 nodes and 2,000 relationships per result, a 30 second query timeout, and a
size limit on what the view receives. Cuts are reported to Claude and shown in the view.

- Built and tested for Claude Desktop with a local (stdio) server. Other MCP Apps hosts are untested.
- The side panel is not available to every organization; the view also works inside the chat.
- The selected node and your last-run query are shared between chats: the last click or run wins.
- Expanded nodes, dragged positions, the chosen layout and your edited query are gone if the view is
  reloaded. Claude can still read the query you ran until it shows a new result.
- Results shown by earlier versions have no Cypher button.

## Development

```bash
pnpm test               # builds and runs the unit tests
pnpm test:integration   # needs the databases from docker compose
pnpm --filter @mcp-graph-explorer/view dev   # the view with example data
```

| Package | Contents |
|---|---|
| `packages/normalizer` | Driver results to a JSON-safe graph and table; no MCP dependencies |
| `packages/server` | MCP server, dialects, limits |
| `packages/view` | The view, built into one HTML file (React, shadcn/ui, Sigma, CodeMirror) |

Design notes are in [docs/](docs/) (the first version's design and plan are in Swedish).

## Data

The example network is a subset of the [Register of Infrastructure (RINF)](https://data.europa.eu/949)
published as open data by the European Union Agency for Railways. It is regenerated with
`node docker/make-seed.mjs <directory with the RINF CSV exports>`. The direction of `CONNECTS`
follows the start and end of each section in RINF and does not restrict traffic. The data is example
content: it may be outdated and must not be used for operations.

## License

[Apache-2.0](LICENSE) for the code. The RINF data in `docker/seed.cypher` is not covered by it;
the publisher's terms apply.
