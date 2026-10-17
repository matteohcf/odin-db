import { describe, expect, it } from "vitest";
import { shellTokens } from "./shell-tokens";

const kinds = (text: string) =>
  shellTokens(text)
    .filter((token) => token.kind !== "text")
    .map((token) => `${token.kind}:${token.text}`);

describe("shellTokens", () => {
  it("tells keys, strings, numbers, constructors and keywords apart", () => {
    expect(
      kinds('{ _id: ObjectId("65f0"), "a b": "x:y", n: -1.5, ok: true, r: /a\\/b/i }'),
    ).toEqual([
      "punctuation:{",
      "key:_id",
      "punctuation::",
      "constructor:ObjectId",
      "punctuation:(",
      'string:"65f0"',
      "punctuation:)",
      "punctuation:,",
      'key:"a b"',
      "punctuation::",
      'string:"x:y"',
      "punctuation:,",
      "key:n",
      "punctuation::",
      "number:-1.5",
      "punctuation:,",
      "key:ok",
      "punctuation::",
      "keyword:true",
      "punctuation:,",
      "key:r",
      "punctuation::",
      "string:/a\\/b/i",
      "punctuation:}",
    ]);
  });

  it("keeps every character", () => {
    const text = '{\n  tags: [\n    "a",\n    Double(5)\n  ]\n}';
    expect(
      shellTokens(text)
        .map((token) => token.text)
        .join(""),
    ).toBe(text);
  });
});
