// 100 saved connections in 10 groups.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const check = async (name, fn, budget) => {
  const started = Date.now();
  try {
    await fn();
    const ms = Date.now() - started;
    if (budget && ms > budget) throw new Error(`${ms} ms`);
    results.push(`ok   ${name} (${ms} ms)`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await page.screenshot({ path: "test-results/many-fail.png" });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("odin-mock-many", "1");
});
await page.reload();
// Saved connections live in the connection manager (ADR-0058).
const tree = page.getByRole("dialog", { name: "Connections" });
const search = page.getByRole("searchbox", { name: "Search saved connections" });
await check(
  "104 connections render, grouped",
  async () => {
    await page.getByRole("button", { name: "Open connection…" }).first().click();
    await tree
      .getByRole("button", { name: /^Region 1\b/ })
      .first()
      .waitFor();
    const nodes = await tree.locator("*").count();
    if (nodes > 3000) throw new Error(`${nodes} nodes`);
  },
  3000,
);
await check(
  "search finds one customer instantly",
  async () => {
    await search.fill("customer 042");
    await tree.getByRole("button", { name: /^Customer 042/ }).waitFor();
    const shown = await tree.getByRole("button", { name: /^Customer \d+/ }).count();
    if (shown !== 1) throw new Error(`${shown} customers`);
    await page.screenshot({ path: "test-results/many-filter.png" });
  },
  1500,
);
await check("collapse all leaves only the folders", async () => {
  await search.fill("");
  await page.keyboard.press("Escape");
  await tree.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Collapse all" }).click();
  await page.getByRole("button", { name: "Open connection…" }).first().click();
  await tree
    .getByRole("button", { name: /^Region 1\b/ })
    .first()
    .waitFor();
  const customers = await tree.getByRole("button", { name: /^Customer \d+/ }).count();
  if (customers !== 0) throw new Error(`${customers} customers`);
  await page.screenshot({ path: "test-results/many-collapsed.png" });
  await page.keyboard.press("Escape");
});
await check("the palette offers connecting to any of them", async () => {
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("connect customer 099");
  await page
    .getByRole("option", { name: /Customer 099/ })
    .first()
    .waitFor();
  await page.keyboard.press("Escape");
});
await page.evaluate(() => localStorage.removeItem("odin-mock-many"));
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
