import { describe, expect, it } from "vitest";
import { parseShellDocument } from "@/lib/shell-syntax";
import { SqlError, translateSql } from "./sql";

const find = (sql: string) => {
  const result = translateSql(sql);
  if (result.kind !== "find") throw new Error(`expected a find, got ${result.kind}`);
  return result;
};
const pipeline = (sql: string) => {
  const result = translateSql(sql);
  if (result.kind !== "aggregate") throw new Error(`expected an aggregation, got ${result.kind}`);
  return result.pipeline;
};

describe("translateSql", () => {
  it("translates a simple select with order, limit and offset", () => {
    expect(
      find(
        "SELECT name, age FROM users WHERE age >= 30 ORDER BY age DESC, name LIMIT 10 OFFSET 20",
      ),
    ).toEqual({
      kind: "find",
      collection: "users",
      filter: "{ age: { $gte: 30 } }",
      projection: "{ name: 1, age: 1, _id: 0 }",
      sort: "{ age: -1, name: 1 }",
      skip: "20",
      limit: "10",
    });
    expect(find("select * from users").filter).toBe("");
    expect(find("SELECT * FROM users LIMIT 5, 10")).toMatchObject({ skip: "5", limit: "10" });
  });

  it("combines conditions like SQL does", () => {
    expect(find("SELECT * FROM t WHERE a = 1 AND b <> 'x'").filter).toBe(
      '{ a: 1, b: { $ne: "x" } }',
    );
    expect(find("SELECT * FROM t WHERE a > 1 AND a < 5").filter).toBe(
      "{ $and: [{ a: { $gt: 1 } }, { a: { $lt: 5 } }] }",
    );
    expect(find("SELECT * FROM t WHERE a = 1 OR (b = 2 AND c = 3)").filter).toBe(
      "{ $or: [{ a: 1 }, { $and: [{ b: 2 }, { c: 3 }] }] }",
    );
    expect(find("SELECT * FROM t WHERE NOT active = true").filter).toBe(
      "{ $nor: [{ active: true }] }",
    );
  });

  it("supports IN, LIKE, BETWEEN, IS NULL, dotted and quoted names", () => {
    expect(find("SELECT * FROM t WHERE plan IN ('pro', 'team')").filter).toBe(
      '{ plan: { $in: ["pro", "team"] } }',
    );
    expect(find("SELECT * FROM t WHERE plan NOT IN (1, 2)").filter).toBe(
      "{ plan: { $nin: [1, 2] } }",
    );
    expect(find("SELECT * FROM t WHERE name LIKE 'Ad%'").filter).toBe(
      '{ name: { $regex: "^Ad" } }',
    );
    expect(find("SELECT * FROM t WHERE name LIKE '%a.c_'").filter).toBe(
      '{ name: { $regex: "a\\\\.c.$" } }',
    );
    expect(find("SELECT * FROM t WHERE name NOT LIKE '%x%'").filter).toBe(
      '{ name: { $not: { $regex: "x" } } }',
    );
    expect(find("SELECT * FROM t WHERE age BETWEEN 18 AND 65").filter).toBe(
      "{ age: { $gte: 18, $lte: 65 } }",
    );
    expect(find("SELECT * FROM t WHERE referrer IS NULL").filter).toBe("{ referrer: null }");
    expect(find("SELECT * FROM t WHERE referrer IS NOT NULL").filter).toBe(
      "{ referrer: { $ne: null } }",
    );
    expect(find("SELECT * FROM t WHERE address.city = 'Milano'").filter).toBe(
      '{ "address.city": "Milano" }',
    );
    expect(find("SELECT * FROM t WHERE \"first name\" = 'O''Neil'").filter).toBe(
      '{ "first name": "O\'Neil" }',
    );
    expect(find("SELECT * FROM t WHERE balance < -1.5").filter).toBe("{ balance: { $lt: -1.5 } }");
  });

  it("turns GROUP BY and aggregates into a pipeline", () => {
    expect(
      pipeline(
        "SELECT plan, COUNT(*) AS users, AVG(age) FROM users WHERE active = true GROUP BY plan ORDER BY users DESC LIMIT 3",
      ),
    ).toBe(
      [
        "[",
        "  { $match: { active: true } },",
        '  { $group: { _id: "$plan", users: { $sum: 1 }, avg_age: { $avg: "$age" } } },',
        '  { $project: { _id: 0, plan: "$_id", users: 1, avg_age: 1 } },',
        "  { $sort: { users: -1 } },",
        "  { $limit: 3 }",
        "]",
      ].join("\n"),
    );
    expect(pipeline("SELECT COUNT(*) FROM users")).toContain(
      "{ $group: { _id: null, count: { $sum: 1 } } }",
    );
  });

  it("explains what it cannot translate", () => {
    expect(() => translateSql("SELECT name FROM")).toThrow(SqlError);
    expect(() => translateSql("SELECT * FROM t WHERE a")).toThrow(/comparison/);
    expect(() => translateSql("SELECT name, COUNT(*) FROM t GROUP BY plan")).toThrow(/GROUP BY/);
    expect(() => translateSql("SELECT * FROM t WHERE a = 'x")).toThrow(/unterminated/);
    expect(() => translateSql("DELETE FROM t")).toThrow(/SELECT/);
  });

  it("writes mongosh syntax the query parser accepts", async () => {
    const queries = [
      "SELECT name FROM t WHERE a = 1 OR NOT b LIKE 'x%' AND c IN (1, 'two', null, true)",
      "SELECT * FROM t WHERE x.y BETWEEN -2 AND 3e2 ORDER BY x.y DESC",
    ];
    for (const sql of queries) {
      const result = find(sql);
      for (const text of [result.filter, result.projection, result.sort]) {
        if (text) await expect(parseShellDocument(text), text).resolves.toBeTruthy();
      }
    }
    const text = pipeline("SELECT plan, region, SUM(total) FROM orders GROUP BY plan, region");
    await expect(parseShellDocument(`{ pipeline: ${text} }`)).resolves.toBeTruthy();
  });
});
