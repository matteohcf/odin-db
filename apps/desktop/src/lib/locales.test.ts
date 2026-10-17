import { describe, expect, it } from "vitest";

const files = import.meta.glob<Record<string, unknown>>("../**/locales/*.json", {
  eager: true,
  import: "default",
});

function keys(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    child && typeof child === "object"
      ? keys(child as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

const english = Object.keys(files).filter((path) => path.endsWith("/en.json"));

describe("translations", () => {
  it("finds the English sources", () => {
    expect(english.length).toBeGreaterThan(10);
  });

  it.each(english)("%s has an Italian file with the same keys", (path) => {
    const source = files[path] ?? {};
    const italian = files[path.replace(/en\.json$/, "it.json")];
    expect(italian, "missing it.json").toBeDefined();
    expect(keys(italian ?? {}).sort()).toEqual(keys(source).sort());
  });
});
