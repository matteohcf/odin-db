import { beforeEach, describe, expect, it } from "vitest";
import { useColumnLayouts } from "./column-layout-store";

const layout = (pinned: string[]) => ({ order: [], pinned, widths: {}, hidden: {} });

describe("column layouts", () => {
  beforeEach(() => useColumnLayouts.setState({ layouts: {} }));

  it("keeps one layout per key, the latest last", () => {
    const { save } = useColumnLayouts.getState();
    save("a", layout(["x"]));
    save("b", layout([]));
    save("a", layout(["y"]));
    const { layouts } = useColumnLayouts.getState();
    expect(Object.keys(layouts)).toEqual(["b", "a"]);
    expect(layouts.a?.pinned).toEqual(["y"]);
  });
});
