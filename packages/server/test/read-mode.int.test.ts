import neo4j from "neo4j-driver";
import { afterAll, describe, expect, it } from "vitest";

const targets = [
  { name: "neo4j", uri: "bolt://localhost:7687", auth: neo4j.auth.basic("neo4j", "graphexplorer") },
  { name: "memgraph", uri: "bolt://localhost:7688", auth: neo4j.auth.basic("", "") },
];
const COUNT = "MATCH (n:ReadModeProbe) RETURN count(n) AS c";

describe.each(targets)("$name", ({ uri, auth }) => {
  const driver = neo4j.driver(uri, auth);

  afterAll(async () => {
    const s = driver.session({ defaultAccessMode: neo4j.session.WRITE });
    await s.run("MATCH (n:ReadModeProbe) DELETE n");
    await s.close();
    await driver.close();
  });

  const count = async () => {
    const s = driver.session({ defaultAccessMode: neo4j.session.READ });
    try {
      return (await s.run(COUNT)).records[0]!.get("c").toNumber();
    } finally {
      await s.close();
    }
  };

  // The server only ever sends queries in explicit transactions. This matters: Memgraph ignores
  // READ mode for auto-commit queries (session.run), so those must never be used.
  it("rejects a write in a READ transaction", async () => {
    const s = driver.session({ defaultAccessMode: neo4j.session.READ });
    const tx = s.beginTransaction();
    await expect(tx.run("CREATE (:ReadModeProbe)").then((r) => r.records)).rejects.toThrow();
    await tx.rollback().catch(() => {});
    await s.close();
    expect(await count()).toBe(0);
  });
});
