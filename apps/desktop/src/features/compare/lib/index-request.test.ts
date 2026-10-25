import type { IndexInfo } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { indexOptions, indexRequestOf } from "./index-request";

const index: IndexInfo = {
  name: "expires_1",
  keys: { expires: { $numberInt: "1" } },
  unique: true,
  sparse: false,
  hidden: false,
  expireAfterSeconds: 3600,
  partialFilter: null,
  collation: null,
  definition: {},
  size: null,
  usageCount: null,
  usageSince: null,
};

describe("index requests", () => {
  it("rebuilds an index with its name and options", () => {
    expect(indexRequestOf(index)).toEqual({
      keys: index.keys,
      name: "expires_1",
      unique: true,
      sparse: false,
      hidden: false,
      expireAfterSeconds: 3600,
      partialFilter: null,
      collation: null,
    });
  });

  it("labels the options that set an index apart", () => {
    expect(indexOptions(index)).toEqual(["unique", "TTL 3600s"]);
    expect(indexOptions({ ...index, unique: false, expireAfterSeconds: null })).toEqual([]);
    expect(indexOptions({ ...index, unique: false, collation: { locale: "en" } })).toEqual([
      "TTL 3600s",
      "collation",
    ]);
  });
});
