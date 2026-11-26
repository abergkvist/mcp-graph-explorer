import type { ViewQuery } from "@mcp-graph-explorer/normalizer";
import type { Config } from "./config.ts";
import { stateFile, type Env } from "./state.ts";

export interface SavedQuery { query: ViewQuery; ranAt: string }

/** The query the user last ran in the view. */
export interface ViewQueryStore {
  write(query: ViewQuery | null): void;
  read(): SavedQuery | undefined;
}

export function createViewQueryStore(config: Pick<Config, "uri" | "database">, env?: Env): ViewQueryStore {
  const file = stateFile<SavedQuery>(config, "query", env);
  return {
    write(query) {
      file.write(query === null ? null : { query, ranAt: new Date().toISOString() });
    },
    read() {
      const stored = file.read() as Partial<SavedQuery> | null | undefined;
      return typeof stored?.query?.answer_query === "string" ? (stored as SavedQuery) : undefined;
    },
  };
}
