import { beforeEach, describe, expect, it } from "vitest";
import { usePromptHistory } from "./prompt-history-store";

describe("usePromptHistory", () => {
  beforeEach(() => usePromptHistory.setState({ prompts: [] }));

  it("keeps the most recent first, without duplicates or blanks", () => {
    const { record } = usePromptHistory.getState();
    record("active users");
    record("  ");
    record("orders over 100");
    record(" active users ");
    expect(usePromptHistory.getState().prompts).toEqual(["active users", "orders over 100"]);
  });

  it("forgets the oldest past its limit", () => {
    for (let i = 0; i < 40; i++) usePromptHistory.getState().record(`request ${i}`);
    const { prompts } = usePromptHistory.getState();
    expect(prompts).toHaveLength(30);
    expect(prompts[0]).toBe("request 39");
  });
});
