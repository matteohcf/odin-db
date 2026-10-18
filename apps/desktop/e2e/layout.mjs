// The grid remembers each collection's column layout.
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
    await page.screenshot({ path: "test-results/layout-fail.png" });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByText("Local development").waitFor();
await page.click("text=Local development");
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
const grid = page.getByRole("tabpanel").filter({ visible: true }).first().locator("[role=grid]");
await grid.locator("tbody tr").first().waitFor();
const header = (name) => grid.locator("thead th").filter({ hasText: new RegExp(`^${name}$`) });
const names = () =>
  grid
    .locator("thead th")
    .evaluateAll((ths) => ths.map((th) => th.textContent.trim()).filter(Boolean));
await header("plan").dragTo(header("name"));
await header("age").click({ button: "right" });
await page.getByRole("menuitem", { name: "Pin to the left" }).click();
await header("email").click({ button: "right" });
await page.getByRole("menuitem", { name: "Hide column" }).click();
await page.waitForTimeout(300);
const arranged = await names();
await check("the arrangement survives closing the tab and a restart", async () => {
  await page.keyboard.press("Meta+w");
  await page.reload();
  const tree = page.getByRole("complementary", { name: /Connections/ });
  await tree
    .getByRole("button", { name: /^Local development/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^shop/ }).first().click();
  await page
    .getByRole("button", { name: /^users/ })
    .first()
    .click();
  await grid.locator("tbody tr").first().waitFor();
  const restored = await names();
  if (restored.join() !== arranged.join())
    throw new Error(`${restored.join()} vs ${arranged.join()}`);
  if (restored.includes("email")) throw new Error("hidden column is back");
});
await check("other collections keep their own layout", async () => {
  await page
    .getByRole("button", { name: /^orders/ })
    .first()
    .click();
  await grid.locator("tbody tr").first().waitFor();
  const cols = await names();
  if (cols[0] !== "_id" || cols[1] !== "number") throw new Error(cols.join());
});
await check("reset columns restores the natural layout", async () => {
  await page.getByRole("tab", { name: /users/ }).first().click();
  await grid.getByRole("button", { name: "Choose columns" }).click();
  await page.getByRole("menuitem", { name: "Reset columns" }).click();
  await page.waitForTimeout(200);
  const cols = await names();
  if (cols.slice(0, 4).join() !== "_id,name,email,age") throw new Error(cols.join());
});
await check("fit all columns shrinks short columns", async () => {
  const before = (await header("age").boundingBox()).width;
  await grid.getByRole("button", { name: "Choose columns" }).click();
  await page.getByRole("menuitem", { name: "Fit all columns to content" }).click();
  await page.waitForTimeout(200);
  const after = (await header("age").boundingBox()).width;
  if (!(after < before)) throw new Error(`${before} -> ${after}`);
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
