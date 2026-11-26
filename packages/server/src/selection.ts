// The model's tool calls and the view's tool calls reach different server processes,
// so the selected node is passed through a small file.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.ts";

export interface SelectionStore {
  write(nodeId: string | null): void;
  read(): { nodeId: string; selectedAt: string } | undefined;
}

type Env = Record<string, string | undefined>;

function dataDir(env: Env): string {
  if (env.GRAPH_STATE_DIR) return env.GRAPH_STATE_DIR;
  const base =
    process.platform === "darwin" ? join(homedir(), "Library", "Application Support")
    : process.platform === "win32" ? env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
    : env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "mcp-graph-explorer");
}

export function createSelectionStore(config: Pick<Config, "uri" | "database">, env: Env = process.env): SelectionStore {
  const dir = dataDir(env);
  const key = createHash("sha256").update(`${config.uri}|${config.database ?? ""}`).digest("hex").slice(0, 16);
  const file = join(dir, `selection-${key}.json`);
  return {
    write(nodeId) {
      if (nodeId === null) return rmSync(file, { force: true });
      mkdirSync(dir, { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify({ nodeId, selectedAt: new Date().toISOString() }));
      renameSync(temporary, file);
    },
    read() {
      try {
        const stored = JSON.parse(readFileSync(file, "utf8"));
        return typeof stored.nodeId === "string" ? stored : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
