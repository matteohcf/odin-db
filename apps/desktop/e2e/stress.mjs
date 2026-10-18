// Stress: heavy shapes through every view.
import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/stress-${name}.png` });
const check = async (name, fn, budget) => {
  const started = Date.now();
  try {
    await fn();
    const ms = Date.now() - started;
    if (budget && ms > budget) throw new Error(`took ${ms} ms, budget ${budget}`);
    results.push(`ok   ${name} (${ms} ms)`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const tree = page.getByRole("complementary", { name: /Connections/ });
const panel = () => page.getByRole("tabpanel").filter({ visible: true }).first();
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.click("text=Local development");
await tree
  .getByRole("button", { name: /^analytics/ })
  .first()
  .click();
await tree.getByRole("button", { name: /^wide/ }).first().click();
await panel().locator("[role=grid] tbody tr").first().waitFor();

await check(
  "filter suggestions over 300 fields appear fast",
  async () => {
    const filter = panel().getByRole("textbox", { name: "Filter" });
    await filter.click();
    const started = Date.now();
    await page.keyboard.type("{ field_29");
    await page.locator(".cm-tooltip-autocomplete li").first().waitFor();
    const ms = Date.now() - started;
    const shown = await page.locator(".cm-tooltip-autocomplete li").count();
    console.log(`suggestions after typing: ${ms} ms, ${shown} options`);
    if (shown < 5) throw new Error(`${shown} options`);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Backspace");
  },
  3000,
);
await check(
  "schema of 300-field documents",
  async () => {
    await panel().getByRole("tab", { name: "Schema" }).click();
    await panel().getByText("field_299").first().waitFor({ timeout: 10000 });
    await shot("schema-wide");
  },
  4000,
);
await check(
  "aggregation preview of wide documents",
  async () => {
    await panel().getByRole("tab", { name: "Aggregation" }).click();
    await panel()
      .getByText(/documents/)
      .first()
      .waitFor({ timeout: 10000 });
  },
  4000,
);
await check(
  "list view of wide documents scrolls",
  async () => {
    await panel().getByRole("tab", { name: "Documents" }).click();
    await page.getByRole("radio", { name: "List" }).click();
    await page.mouse.move(800, 500);
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(300);
    await shot("list-wide");
  },
  5000,
);
await check(
  "JSON view of wide documents scrolls",
  async () => {
    await page.getByRole("radio", { name: "JSON" }).click();
    await page.mouse.move(800, 500);
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(300);
    await page.getByRole("radio", { name: "Table" }).click();
  },
  5000,
);
await check(
  "events: $group starts from a real field and groups 25,000 documents",
  async () => {
    await tree
      .getByRole("button", { name: /^events/ })
      .first()
      .click();
    await panel().locator("[role=grid] tbody tr").first().waitFor();
    await panel().getByRole("tab", { name: "Aggregation" }).click();
    await panel().getByRole("combobox").first().click();
    await page.getByRole("option", { name: "$group" }).first().click();
    await page.waitForTimeout(300);
    const body = await panel().locator(".cm-content").first().innerText();
    if (body.includes("$field")) throw new Error(body);
    await panel().getByText("page_view").first().waitFor({ timeout: 10000 });
    await shot("agg-group");
  },
  6000,
);
await check("indexes view", async () => {
  await panel().getByRole("tab", { name: "Indexes" }).click();
  await panel().getByText("_id_").first().waitFor();
});
await check("heap after stress", async () => {
  const mb = await page.evaluate(() => performance.memory.usedJSHeapSize / 1e6);
  console.log(`heap ${mb.toFixed(0)} MB`);
  if (mb > 350) throw new Error(`${mb} MB`);
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
