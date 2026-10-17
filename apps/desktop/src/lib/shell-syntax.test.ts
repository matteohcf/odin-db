import { terminateWorker } from "@mongodb-js/shell-bson-parser";
import type { EJsonDocument } from "@odin-db/bindings";
import { afterAll, describe, expect, it } from "vitest";
import { parseShellDocument, ShellSyntaxError, toShellSyntax } from "./shell-syntax";

afterAll(() => terminateWorker());

// Canonical EJSON as produced by the Rust backend, covering every editable type.
const canonical: EJsonDocument = {
  _id: { $oid: "650000000000000000000001" },
  int32: { $numberInt: "5" },
  int32Negative: { $numberInt: "-7" },
  int64: { $numberLong: "5" },
  int64Max: { $numberLong: "9223372036854775807" },
  doubleWhole: { $numberDouble: "5.0" },
  doubleFraction: { $numberDouble: "1.5" },
  doubleNegativeZero: { $numberDouble: "-0.0" },
  doubleNaN: { $numberDouble: "NaN" },
  doubleInfinity: { $numberDouble: "Infinity" },
  decimal: { $numberDecimal: "0.10" },
  date: { $date: { $numberLong: "1700000000000" } },
  binary: { $binary: { base64: "AAEC/w==", subType: "00" } },
  uuid: { $binary: { base64: "BwcHBwcHBwcHBwcHBwcHBw==", subType: "04" } },
  timestamp: { $timestamp: { t: 1700000000, i: 3 } },
  regex: { $regularExpression: { pattern: "^a.b", options: "i" } },
  min: { $minKey: 1 },
  max: { $maxKey: 1 },
  string: 'it\'s "quoted"\nnewline',
  bool: true,
  nil: null,
  "dashed-key": { nested: [{ $numberInt: "1" }, { $numberLong: "2" }, "three", { deep: false }] },
  empty: {},
  emptyList: [],
};

describe("shell syntax", () => {
  it("round-trips every BSON type without changing it", async () => {
    const text = toShellSyntax(canonical);
    expect(await parseShellDocument(text)).toEqual(canonical);
  });

  it("writes whole doubles with an explicit constructor", () => {
    expect(toShellSyntax({ a: { $numberDouble: "5.0" } }, 0)).toBe("{ a: Double(5.0) }");
    expect(toShellSyntax({ a: { $numberInt: "5" } }, 0)).toBe("{ a: 5 }");
  });

  it("escapes slashes in regex patterns, which JavaScript cannot represent unescaped", async () => {
    // Equivalent for MongoDB's regex engine, but the stored pattern string gains a backslash.
    const parsed = await parseShellDocument(
      toShellSyntax({ r: { $regularExpression: { pattern: "a/b", options: "" } } }),
    );
    expect(parsed).toEqual({ r: { $regularExpression: { pattern: "a\\/b", options: "" } } });
  });

  it("treats empty input as an empty document", async () => {
    expect(await parseShellDocument("   ")).toEqual({});
  });

  it("reports syntax errors without echoing the input", async () => {
    const error = await parseShellDocument("{ a: }").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShellSyntaxError);
    expect((error as Error).message).not.toContain("{ a: }");
  });

  it("rejects non-documents and invalid syntax", async () => {
    await expect(parseShellDocument("[1, 2]")).rejects.toBeInstanceOf(ShellSyntaxError);
    await expect(parseShellDocument("{ a: ")).rejects.toBeInstanceOf(ShellSyntaxError);
    await expect(parseShellDocument("{ a: process.exit() }")).rejects.toBeInstanceOf(
      ShellSyntaxError,
    );
  });
});
