import type { EJsonDocument } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { CODE_LANGUAGES, type CodeSource, queryCode } from "./query-code";

const filter: EJsonDocument = {
  _id: { $oid: "65f0a1c30000000000000001" },
  age: { $gte: { $numberInt: "30" } },
  score: { $numberDouble: "5" },
  total: { $numberLong: "9007199254740993" },
  price: { $numberDecimal: "1.50" },
  at: { $date: { $numberLong: "1700000000000" } },
  name: { $regularExpression: { pattern: "^a", options: "i" } },
  "address.city": "Milano",
  tags: ["a", "b"],
  active: true,
  missing: null,
};

const find: CodeSource = {
  kind: "find",
  database: "shop",
  collection: "orders",
  filter,
  projection: { name: { $numberInt: "1" } },
  sort: { age: { $numberInt: "-1" }, name: { $numberInt: "1" } },
  skip: 10,
  limit: 5,
};

const aggregate: CodeSource = {
  kind: "aggregate",
  database: "shop",
  collection: "orders",
  pipeline: [
    { $match: { status: "paid" } },
    { $group: { _id: "$customer", total: { $sum: "$amount" } } },
  ],
};

describe("queryCode", () => {
  it("writes mongosh with exact constructors", () => {
    const code = queryCode(find, "mongosh");
    expect(code).toContain('db.getSiblingDB("shop").getCollection("orders").find(');
    expect(code).toContain('ObjectId("65f0a1c30000000000000001")');
    expect(code).toContain("Double(5)");
    expect(code).toContain('NumberLong("9007199254740993")');
    expect(code).toContain(".sort({ age: -1, name: 1 })");
    expect(code).toContain(".skip(10)");
    expect(code).toContain(".limit(5)");
  });

  it("writes Node.js with only the bson classes it uses", () => {
    const code = queryCode(find, "javascript");
    expect(code.split("\n")[0]).toBe(
      'import { BSONRegExp, Decimal128, Double, Long, MongoClient, ObjectId } from "mongodb";',
    );
    expect(code).toContain('Long.fromString("9007199254740993")');
    expect(code).toContain('new Date("2023-11-14T22:13:20.000Z")');
    expect(code).toContain('"address.city": "Milano"');
    expect(code).toContain("skip: 10");
    expect(queryCode(aggregate, "javascript").split("\n")[0]).toBe(
      'import { MongoClient } from "mongodb";',
    );
  });

  it("writes Python with ordered sort pairs and BSON types", () => {
    const code = queryCode(find, "python");
    expect(code).toContain(
      "import os\nfrom datetime import datetime\n\nfrom bson import Decimal128, Int64, ObjectId, Regex\nfrom pymongo import MongoClient",
    );
    expect(code).toContain("from datetime import datetime");
    expect(code).toContain('sort=[("age", -1), ("name", 1)]');
    expect(code).toContain('"score": 5.0');
    expect(code).toContain('"active": True');
    expect(code).toContain('"missing": None');
    expect(code).toContain('datetime.fromisoformat("2023-11-14T22:13:20.000+00:00")');
  });

  it("writes Java, C# and Go around canonical Extended JSON", () => {
    expect(queryCode(find, "java")).toContain('"$numberLong": "9007199254740993"');
    expect(queryCode(find, "java")).toContain(".limit(5)");
    expect(queryCode(find, "csharp")).toContain('""$oid"": ""65f0a1c30000000000000001""');
    expect(queryCode(find, "go")).toContain(".SetSkip(10).SetLimit(5)");
    expect(queryCode(aggregate, "go")).toContain("pipeline = append(pipeline, decoded)");
  });

  it("omits empty options", () => {
    const plain: CodeSource = { ...find, projection: {}, sort: null, skip: null, limit: null };
    for (const language of CODE_LANGUAGES) {
      const code = queryCode(plain, language);
      expect(code, language).not.toMatch(/projection|\.sort\(|SetSort|Skip|skip=|limit/i);
    }
  });
});
