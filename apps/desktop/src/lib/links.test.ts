import { describe, expect, it } from "vitest";
import { linkOf } from "./links";

describe("linkOf", () => {
  it("finds web and mail links in strings only", () => {
    expect(linkOf(" https://example.com/x ")).toBe("https://example.com/x");
    expect(linkOf("mailto:ada@example.com")).toBe("mailto:ada@example.com");
    expect(linkOf("file:///etc/passwd")).toBeNull();
    expect(linkOf("see https://example.com")).toBeNull();
    expect(linkOf({ $oid: "65f0a1c30000000000000001" })).toBeNull();
    expect(linkOf(undefined)).toBeNull();
  });
});
