// AI query assistant: setup from the query bar, model downloads, generate and apply.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await page.screenshot({ path: `test-results/ai-fail-${results.length}.png` });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
const tree = page.getByRole("complementary", { name: /Connections/ });
const openUsers = async () => {
  await tree
    .getByRole("button", { name: /^Local development/ })
    .first()
    .click();
  await tree.getByRole("button", { name: /^shop/ }).first().click();
  await tree
    .getByRole("button", { name: /^users/ })
    .first()
    .click();
  await page.locator("tbody tr").first().waitFor();
};
await openUsers();
const popover = page.locator("[data-slot=popover-content]");

await check("before setup, Ask AI explains and leads to the AI settings page", async () => {
  await page.getByRole("button", { name: "Ask AI" }).click();
  await popover.getByText("Write queries in plain language").waitFor();
  await page.screenshot({ path: "test-results/ai-setup.png" });
  await popover.getByRole("button", { name: "Set up in settings" }).click();
  await page.getByRole("heading", { name: "AI assistant" }).waitFor();
  await page.getByText("Qwen2.5 Coder 1.5B").waitFor();
});

await check("a download shows progress, pauses and resumes, then the model is in use", async () => {
  const row = page.locator("[data-setting-row]").filter({ hasText: "Qwen2.5 Coder 1.5B" });
  await row.getByText("Recommended").waitFor();
  await row.getByRole("button", { name: "Download" }).click();
  await row.getByText(/[1-9][\d.]* MB of 1 GB/).waitFor();
  await page.screenshot({ path: "test-results/ai-downloading.png" });
  await row.getByRole("button", { name: "Pause" }).click();
  await row.getByRole("button", { name: "Resume" }).waitFor();
  await row.getByRole("button", { name: "Resume" }).click();
  await row.getByText("In use").waitFor({ timeout: 10000 });
  await page.getByText("Qwen2.5 Coder 1.5B is ready").waitFor();
  await page.screenshot({ path: "test-results/ai-settings.png" });
});

await check("Mod+I asks; the query is previewed, then used without running", async () => {
  await page.getByRole("tab", { name: /users/ }).click();
  // From inside the filter editor, where CodeMirror has its own Mod-I.
  await page.getByRole("textbox", { name: "Filter" }).click();
  await page.keyboard.press("Meta+i");
  const prompt = popover.getByPlaceholder(/active users from Italy/);
  await popover.getByText("Try:").waitFor();
  await popover.getByRole("button", { name: /contains …/ }).click();
  await page.waitForTimeout(100);
  await page.keyboard.type("ada");
  const typed = await prompt.inputValue();
  if (!/^\S+ contains ada$/.test(typed)) throw new Error(`chip gave ${typed}`);
  await page.screenshot({ path: "test-results/ai-chips.png" });
  await prompt.fill("10 newest active users over 30");
  await prompt.press("Enter");
  await popover.getByText('{ status: "active", age: { $gt: 30 } }').waitFor();
  await popover.getByText("{ createdAt: -1 }").waitFor();
  await page.screenshot({ path: "test-results/ai-preview.png" });
  await popover.getByRole("button", { name: "Use", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Filter" })
    .getByText(/status: "active"/)
    .waitFor();
  await page
    .getByRole("textbox", { name: "Sort" })
    .getByText(/createdAt: -1/)
    .waitFor();
  const limit = await page.getByRole("textbox", { name: "Limit" }).inputValue();
  if (limit !== "10") throw new Error(`limit ${limit}`);
});

await check("a failed generation explains why", async () => {
  await page.getByRole("button", { name: "Ask AI" }).click();
  const prompt = popover.getByPlaceholder(/active users from Italy/);
  // The prompt is kept between openings; clear it, then recall the last request.
  await prompt.fill("");
  await prompt.press("ArrowUp");
  if ((await prompt.inputValue()) !== "10 newest active users over 30")
    throw new Error("no recall");
  await prompt.press("ArrowDown");
  if ((await prompt.inputValue()) !== "") throw new Error("down did not clear");
  await prompt.fill("please fail");
  await prompt.press("Enter");
  await popover
    .getByRole("alert")
    .getByText(/not a usable query/)
    .waitFor();
  await page.keyboard.press("Escape");
});

await check("Ollama: models are listed and an unreachable address is reported", async () => {
  await page.keyboard.press("Meta+,");
  await page.getByRole("button", { name: "AI assistant" }).click();
  await page.getByRole("combobox", { name: "Model runs in" }).click();
  await page.getByRole("option", { name: "Ollama" }).click();
  await page.getByText("Ollama is running with 1 model.").waitFor();
  await page.getByRole("combobox", { name: "Ollama model" }).click();
  await page.getByRole("option", { name: "qwen2.5-coder:3b" }).click();
  await page.getByRole("textbox", { name: "Ollama address" }).fill("http://localhost:9999");
  await page.getByText(/Ollama is not reachable/).waitFor();
  await page.screenshot({ path: "test-results/ai-ollama.png" });
});

await check("turning the assistant off hides the button", async () => {
  await page.getByRole("switch", { name: "Show the assistant" }).click();
  await page.getByRole("tab", { name: /users/ }).click();
  await page.waitForTimeout(300);
  if (await page.getByRole("button", { name: "Ask AI" }).count()) throw new Error("still shown");
});

await check("dark theme renders the settings page", async () => {
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.keyboard.press("Meta+,");
  await page.getByRole("switch", { name: "Show the assistant" }).click();
  await page.screenshot({ path: "test-results/ai-dark.png" });
});
await check("in a narrow window the models table stays inside its section", async () => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.getByRole("combobox", { name: "Model runs in" }).click();
  await page.getByRole("option", { name: "On this computer" }).click();
  const table = page.locator("table").filter({ hasText: "Qwen2.5 Coder 0.5B" });
  await table.scrollIntoViewIfNeeded();
  // The bordered card around the scrolling wrapper.
  const section = table.locator("xpath=../..");
  const [inner, outer] = await Promise.all([table.boundingBox(), section.boundingBox()]);
  if (!inner || !outer) throw new Error("table not shown");
  if (inner.x + inner.width > outer.x + outer.width + 1) {
    throw new Error(`table ${inner.x + inner.width} overflows section ${outer.x + outer.width}`);
  }
  await page.screenshot({ path: "test-results/ai-narrow.png" });
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
