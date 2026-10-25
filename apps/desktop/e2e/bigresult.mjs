// 25,000 documents: paging while scrolling fast, the row cap, sorting.
import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/bigresult-${name}.png` });
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
const tree = page.getByRole("complementary");
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await connect(page);
await tree.getByRole("button", { name: /^analytics\b/ }).click();
await tree.getByRole("button", { name: /^events\b/ }).click();
const grid = page.locator("[role=grid]");
await grid.locator("tbody tr").first().waitFor();
const scroller = grid.locator("..");
const status = () => page.locator("footer").last().innerText();

await check("holding End loads page after page", async () => {
  for (let i = 0; i < 40; i++) {
    await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);
  const text = await status();
  const loaded = Number(text.replace(/[^\d]/g, "").slice(0, 6));
  console.log(`status: ${text}`);
  if (loaded < 2000) throw new Error(text);
});
await check("rows stay virtualized", async () => {
  const rows = await grid.locator("tbody tr").count();
  if (rows > 80) throw new Error(`${rows} rows in the DOM`);
});
await check(
  "keyboard End then Home jump instantly",
  async () => {
    await grid.focus();
    await page.keyboard.press("End");
    await page.waitForTimeout(100);
    await page.keyboard.press("Home");
    await page.waitForTimeout(100);
    const first = await grid.locator("tbody tr[aria-selected=true] th").innerText();
    if (first.trim() !== "1") throw new Error(first);
  },
  1500,
);
await check("heap after thousands of rows", async () => {
  const mb = await page.evaluate(() => performance.memory.usedJSHeapSize / 1e6);
  console.log(`heap ${mb.toFixed(0)} MB`);
  if (mb > 250) throw new Error(`${mb} MB`);
});
await check("sorting by a column restarts from the top", async () => {
  await grid
    .getByRole("button", { name: /durationMs/ })
    .first()
    .click();
  await page.waitForTimeout(800);
  const top = await scroller.evaluate((el) => el.scrollTop);
  if (top !== 0) throw new Error(`scrollTop ${top}`);
  await shot("01-sorted");
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
