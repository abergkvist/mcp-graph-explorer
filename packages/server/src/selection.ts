import type { Config } from "./config.ts";
import { stateFile, type Env } from "./state.ts";

export interface SelectionStore {
  write(nodeId: string | null): void;
  read(): { nodeId: string; selectedAt: string } | undefined;
}

export function createSelectionStore(config: Pick<Config, "uri" | "database">, env?: Env): SelectionStore {
  const file = stateFile<{ nodeId: string; selectedAt: string }>(config, "selection", env);
  return {
    write(nodeId) {
      file.write(nodeId === null ? null : { nodeId, selectedAt: new Date().toISOString() });
    },
    read() {
      const stored = file.read() as { nodeId?: unknown; selectedAt: string } | null | undefined;
      return typeof stored?.nodeId === "string" ? { nodeId: stored.nodeId, selectedAt: stored.selectedAt } : undefined;
    },
  };
}
