# Design: Cypher editor in the view

## Intent

Claude writes the Cypher behind every shown result, but the user cannot see it. The view should
show it on request in something that feels like an editor, let the user change it, and update the
panel. This is a generic feature, not tied to particular use cases.

## Goals

- The query behind a result can be shown in the view. It is hidden by default.
- It can be edited and run again, and the same view shows the new result.
- Claude can find out what the user ran.

## Non-goals

- Writing from the editor.
- Autocomplete, schema-aware checks, query history.
- Keeping the user's edit when the view is reloaded.
- An editor on a view whose first query failed.

## Approaches

1. Editor in the view only. Smallest, but Claude would answer follow-ups from its own old query.
2. **The same, and Claude can read what the user ran (chosen).** Costs a tool and a state file.
   Claude is not guaranteed to call the tool when it should.
3. Send the edited query to the chat for Claude to run. Rejected: a new view instead of an updated
   panel, and every run costs a model turn.

## View

- A "Cypher" button in the header, in graph, table, value and empty views.
- It opens an editor above the result: CodeMirror with Cypher highlighting and line numbers, light
  and dark.
- It holds `answer_query`, and `context_query` in a second editor if there was one. `params` are
  shown read-only. `params` and `connect` are reused unchanged.
- Run, or ⌘↵ / Ctrl↵. Run is disabled while a query is running.
- Success replaces the result. Node selection, expansions and search are cleared; layout and hidden
  labels are kept. If the layout is no longer possible, force-directed is used. The editor stays open.
- Failure shows the database error under the editor and keeps the current result.
- Reset restores Claude's query and original result.

## Server

- `show_result` adds its input to `structuredContent` as `query`, so it is stored with the result in
  the chat. Results without it have no Cypher button.
- New tool `run_view_query`, visible to the view only. Same input as `show_result`, and it returns
  the same data. It is always read-only, also in write mode.
- A successful `run_view_query` saves the input and the time to a state file, next to the selection
  file and for the same reason: the view and the model reach different server processes.
- Reset and every `show_result` remove the saved query.
- New tool `get_view_query`, for Claude. It returns the saved query, how old it is, and a summary
  from running it again (the same summary `show_result` gives). If nothing is saved, it says that
  the user has not changed the query. Its description tells Claude to call it when the user refers
  to their own query or to what the panel shows now.

## Consequences

- As with the selection, the last run wins across views and chats.
- After a reload the view shows Claude's query again, while the saved one is still the user's.
- Claude only learns of an edit if it calls `get_view_query`.
- The built view grows by the size of the editor.

## Left to the builder

Component structure, editor theme, button wording.

## Done when

- Tests cover: `show_result` includes the query; `run_view_query` is hidden from the model and
  refuses writes in write mode; the saved query is returned by `get_view_query` and cleared by
  `show_result`.
- README (tool table, "What you can do", "What is sent to Claude", limits) is updated.
- Tried in Claude Desktop: edit, run, then ask Claude about the new result.
