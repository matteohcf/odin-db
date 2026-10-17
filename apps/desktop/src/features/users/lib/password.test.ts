import { describe, expect, it } from "vitest";
import { generatePassword } from "./password";

describe("generatePassword", () => {
  it("uses the unambiguous alphabet at the requested length", () => {
    const password = generatePassword(40);
    expect(password).toHaveLength(40);
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
    expect(generatePassword()).not.toBe(generatePassword());
  });

  it("skips bytes that would bias the distribution", () => {
    // 255 is above the rejection limit; 0 maps to the first character.
    let call = 0;
    const random = (bytes: Uint8Array<ArrayBuffer>) => bytes.fill(call++ === 0 ? 255 : 0);
    expect(generatePassword(4, random)).toBe("AAAA");
  });
});
