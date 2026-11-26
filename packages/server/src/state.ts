// The model's tool calls and the view's tool calls reach different server processes,
// so what the view tells the model is passed through small files.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.ts";

export type Env = Record<string, string | undefined>;

function dataDir(env: Env): string {
  if (env.GRAPH_STATE_DIR) return env.GRAPH_STATE_DIR;
  const base =
    process.platform === "darwin" ? join(homedir(), "Library", "Application Support")
    : process.platform === "win32" ? env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
    : env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "mcp-graph-explorer");
}

/** One JSON file per database connection. Writing null removes it; a missing or unreadable file reads as undefined. */
export function stateFile<T>(config: Pick<Config, "uri" | "database">, name: string, env: Env = process.env) {
  const dir = dataDir(env);
  const key = createHash("sha256").update(`${config.uri}|${config.database ?? ""}`).digest("hex").slice(0, 16);
  const file = join(dir, `${name}-${key}.json`);
  return {
    write(value: T | null): void {
      if (value === null) return rmSync(file, { force: true });
      mkdirSync(dir, { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(value));
      renameSync(temporary, file);
    },
    read(): unknown {
      try {
        return JSON.parse(readFileSync(file, "utf8"));
      } catch {
        return undefined;
      }
    },
  };
}
