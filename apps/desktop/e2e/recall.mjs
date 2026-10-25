// Up/Down recall recent queries in the filter.
import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

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
    await page.screenshot({ path: `test-results/recall-fail.png` });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await connect(page);
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();
const filter = page.getByRole("textbox", { name: "Filter" });
const run = async (text) => {
  await filter.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText(text);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Run/ }).click();
  await page.waitForTimeout(400);
};
await run('{ plan: "pro" }');
await run("{ age: { $gt: 30 } }");
await check("Up brings back recent queries, newest first", async () => {
  await filter.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText("{ draft");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowUp");
  if (!(await filter.innerText()).includes("$gt: 30")) throw new Error(await filter.innerText());
  await page.keyboard.press("ArrowUp");
  if (!(await filter.innerText()).includes('plan: "pro"'))
    throw new Error(await filter.innerText());
});
await check("Down returns to the query being typed", async () => {
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  if (!(await filter.innerText()).includes("{ draft")) throw new Error(await filter.innerText());
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
