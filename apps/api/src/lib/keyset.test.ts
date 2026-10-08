import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sensorData } from "../db/schema.js";
import { keysetCursorCondition } from "./keyset.js";

const dialect = new PgDialect();

describe("keysetCursorCondition", () => {
  it("builds an OR(gt recordedAt, AND(eq recordedAt, gt id)) tie-break condition", () => {
    const condition = keysetCursorCondition(sensorData.recordedAt, sensorData.id, {
      recordedAt: new Date("2024-01-01T00:00:00.000Z"),
      id: 7,
    });

    const query = dialect.sqlToQuery(condition);

    // Structure: both the plain ">" branch and the tie-break "=" AND ">"
    // branch must be present, joined by "or" — this is what prevents rows
    // tied at the cursor boundary from being silently skipped.
    expect(query.sql).toMatch(/or/i);
    expect(query.sql).toMatch(/"timestamp"/); // column present in both branches
    // recordedAt appears twice (gt branch + eq branch, serialized to ISO strings by
    // the dialect), id once (tie-break gt) — three bound params total.
    const isoParams = query.params.filter((p) => p === "2024-01-01T00:00:00.000Z");
    expect(isoParams).toHaveLength(2);
    expect(query.params).toContain(7);
    expect(query.params).toHaveLength(3);
  });
});
