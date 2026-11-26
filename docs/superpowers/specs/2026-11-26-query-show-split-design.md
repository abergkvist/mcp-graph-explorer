# Design: separate querying from showing

## Intent

Claude explores and verifies with several queries before it answers. Today each of them is a
`run_cypher` call, and each call creates a view. Only the final answer should be shown, in the
side panel.

## Goals

- Queries made while exploring show nothing.
- Every answer from the database (graph, table or single value) is shown once.

## Non-goals

- Railway-specific tools such as `find_route`. The server stays generic.
- Updating an existing view. Each showing call creates a new view.
- Changes to the view.

## Approaches

1. **Two tools, one with a view (chosen).** The host ties a view to a tool, so a tool without one
   cannot draw. The final query runs twice.
2. One tool with a `show` flag. Rejected: the view belongs to the tool, not to the call.
3. Two tools plus domain tools. Fewer exploring calls, but only useful for the example data.

## Tools

`run_cypher` is replaced by two tools.

| Tool | View | Input | Returns to Claude | Writes in write mode |
|---|---|---|---|---|
| `query_cypher` | no | `query`, `params` | the data | yes |
| `show_result` | yes | `answer_query`, `context_query`, `params`, `connect` | a summary, as today | never |

`query_cypher` returns JSON with nodes, relationships, table and truncation notes, and the
committed changes after a write. The summary used today names only five nodes, which is too little
to explore with. Limits: 100 nodes, 100 relationships and 20,000 characters.

`show_result` behaves as `run_cypher` does today, except that both queries always run read-only.

## Descriptions

The descriptions carry the workflow. The server's `instructions` repeat it in one sentence; whether
Claude Desktop reads them is untested.

`query_cypher`:

> Run a read-only Cypher query and get the data back. Nothing is shown to the user. Use it for all
> exploring and checking. When you have the answer, show it with show_result.

In write mode the first sentence is: "Run a Cypher query (WRITE MODE: it can change and delete
data) and get the data back."

`show_result`:

> Show the final answer to the user in the graph view. Call it exactly once for each question that
> is answered from the database, also when the answer is a single value or a table. Every call opens
> a new view, so do not use it to explore or to test a query: do that with query_cypher first.

The visualization contract (return nodes or paths, `context_query` for scalar answers) is appended
to `show_result` only.

## Consequences

- Claude can skip `show_result` or call it twice. The server cannot prevent it.
- A failing `show_result` still creates a view with the error.
- A write is no longer noted in the view, only in what Claude gets.
- The chat will probably still show the final call. Only exploring calls disappear.
- Views of earlier `run_cypher` results should still open. Untested.

## Done when

- Tests cover: `query_cypher` has no view and returns data; `show_result` has the view and refuses
  writes in write mode.
- README tool table and write mode section are updated.
- Tried in Claude Desktop: a route question gives one panel.
