import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { createTestDb } from "@/test/db";
import { ensureTags, normalizeTagName, pickTagColor } from "./tags";

describe("tags", () => {
  let db: Db;
  beforeEach(async () => {
    db = await createTestDb();
  });

  it("creates missing tags and reuses existing ones case-insensitively", async () => {
    const first = await ensureTags(db, ["SMM", "Сайт"]);
    const second = await ensureTags(db, ["smm", "  Реклама  "]);
    expect(first).toHaveLength(2);
    expect(second.map((t) => t.name).sort()).toEqual(["SMM", "Реклама"]);
    expect(second.find((t) => t.name === "SMM")?.id).toBe(first.find((t) => t.name === "SMM")?.id);
  });

  it("normalizes names and picks a stable color", () => {
    expect(normalizeTagName("  горячий   лид ")).toBe("горячий лид");
    expect(pickTagColor("SMM")).toBe(pickTagColor("smm"));
  });
});
