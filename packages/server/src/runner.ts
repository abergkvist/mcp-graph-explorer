import neo4j from "neo4j-driver";
import type { Session } from "neo4j-driver";
import type { ResultInput } from "@mcp-graph-explorer/normalizer";
import { LIMITS, type Config } from "./config.ts";

export interface RunResult extends ResultInput {
  truncated: boolean;
  /** Counters for what a committed write changed. */
  changes?: Record<string, number>;
}

export interface QueryRunner {
  readonly accessMode: "read" | "write";
  run(cypher: string, params?: Record<string, unknown>, maxRows?: number, write?: boolean): Promise<RunResult>;
  close(): Promise<void>;
}

// JSON numbers would be sent as floats, which breaks e.g. LIMIT $n.
const toDriverValue = (value: unknown): unknown => {
  if (typeof value === "number") return Number.isSafeInteger(value) ? neo4j.int(value) : value;
  if (Array.isArray(value)) return value.map(toDriverValue);
  // Only plain objects are walked, so driver values such as Integer pass through.
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) return toDriverParams(value as Record<string, unknown>);
  return value;
};

export function toDriverParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, toDriverValue(value)]));
}

/**
 * Always uses explicit transactions: Memgraph ignores READ mode for auto-commit queries.
 * Reads are always rolled back. A write is committed only when the call asks for it and the
 * server was configured with accessMode "write".
 */
async function execute(session: Session, cypher: string, params: Record<string, unknown>, maxRows: number, write: boolean) {
  const tx = await session.beginTransaction({ timeout: LIMITS.timeoutMs });
  let committed = false;
  try {
    const result = tx.run(cypher, toDriverParams(params));
    const rows: unknown[][] = [];
    let keys: string[] = [];
    let truncated = false;
    for await (const record of result) {
      if (rows.length === maxRows) {
        truncated = true;
        if (!write) break;
        continue; // a write must be consumed completely before commit
      }
      keys = record.keys as string[];
      rows.push(record.keys.map((key) => record.get(key)));
    }
    if (!rows.length) keys = (await result.keys()) as string[];
    const out: RunResult = { keys, rows, truncated };
    if (write) {
      const summary = await result.summary();
      out.changes = Object.fromEntries(Object.entries(summary.counters.updates()).filter(([, n]) => n > 0));
      await tx.commit();
      committed = true;
    }
    return out;
  } finally {
    if (!committed) await tx.rollback().catch(() => {});
  }
}

export function createRunner(config: Config): QueryRunner {
  const driver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password), {
    connectionTimeout: 10000,
    connectionAcquisitionTimeout: 15000,
    maxTransactionRetryTime: 0,
  });
  return {
    accessMode: config.accessMode,
    async run(cypher, params = {}, maxRows = LIMITS.maxRows, write = false) {
      const writing = write && config.accessMode === "write";
      const session = driver.session({
        database: config.database,
        defaultAccessMode: writing ? neo4j.session.WRITE : neo4j.session.READ,
      });
      let timer: NodeJS.Timeout | undefined;
      // Backstop for databases that do not enforce the transaction timeout.
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Query timed out after ${LIMITS.timeoutMs} ms`)), LIMITS.timeoutMs + 1000);
      });
      try {
        return await Promise.race([execute(session, cypher, params, maxRows, writing), deadline]);
      } finally {
        clearTimeout(timer);
        void session.close().catch(() => {});
      }
    },
    close: () => driver.close(),
  };
}
