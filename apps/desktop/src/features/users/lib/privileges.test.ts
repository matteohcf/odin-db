import { describe, expect, it } from "vitest";
import { cleanPrivileges, resourceText } from "./privileges";

describe("resourceText", () => {
  it("writes namespaces with * for every database or collection", () => {
    expect(resourceText({ kind: "namespace", db: "shop", collection: "orders" })).toBe(
      "shop.orders",
    );
    expect(resourceText({ kind: "namespace", db: "shop", collection: "" })).toBe("shop.*");
    expect(resourceText({ kind: "namespace", db: "", collection: "" })).toBe("*.*");
    expect(resourceText({ kind: "cluster" })).toBe("cluster");
  });
});

describe("cleanPrivileges", () => {
  it("trims names and actions and drops rows without actions", () => {
    expect(
      cleanPrivileges([
        {
          resource: { kind: "namespace", db: " shop ", collection: " orders" },
          actions: [" find", "", "insert"],
        },
        { resource: { kind: "cluster" }, actions: [" "] },
      ]),
    ).toEqual([
      {
        resource: { kind: "namespace", db: "shop", collection: "orders" },
        actions: ["find", "insert"],
      },
    ]);
  });
});
