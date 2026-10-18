// Column header menu.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
  permissions: ["clipboard-read", "clipboard-write"],
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/colmenu-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.click("text=Local development");
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
const grid = page.locator("[role=grid]");
await grid.locator("tbody tr").first().waitFor();
const header = (name) => grid.locator("thead th").filter({ hasText: new RegExp(`^${name}$`) });

await check("right-clicking a header opens its menu", async () => {
  await header("age").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Sort descending" }).waitFor();
  await shot("01-menu");
});
await check("sort descending from the menu", async () => {
  await page.getByRole("menuitem", { name: "Sort descending" }).click();
  await page.waitForTimeout(600);
  const ages = await grid
    .locator("tbody tr")
    .evaluateAll((rows) =>
      rows.slice(0, 5).map((r) => Number(r.querySelectorAll("td")[3].textContent)),
    );
  if (!(ages[0] >= ages[1] && ages[1] >= ages[2])) throw new Error(ages.join(","));
  if (!(await header("age").getAttribute("aria-sort"))?.includes("descending"))
    throw new Error("no aria-sort");
});
await check("the chevron opens the same menu", async () => {
  await header("email").hover();
  await page.getByRole("button", { name: "Column email options" }).click();
  await page.getByRole("menuitem", { name: "Hide column" }).click();
  await page.waitForTimeout(150);
  if (await header("email").count()) throw new Error("still shown");
});
await check("fit width from the menu", async () => {
  const before = (await header("name").boundingBox()).width;
  await header("name").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Fit width to content" }).click();
  await page.waitForTimeout(150);
  const after = (await header("name").boundingBox()).width;
  if (Math.abs(after - before) < 3) throw new Error(`${before} -> ${after}`);
});
await check("copy the field name", async () => {
  await header("plan").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy field name" }).click();
  if ((await page.evaluate(() => navigator.clipboard.readText())) !== "plan")
    throw new Error("clipboard");
});
await check("filter documents that have the field", async () => {
  await header("plan").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Only documents with this field" }).click();
  await page.waitForTimeout(400);
  const filter = await page.getByRole("textbox", { name: "Filter" }).innerText();
  if (!filter.includes("$exists: true")) throw new Error(filter);
});
await check("right-click on a cell still opens the row menu", async () => {
  await grid.locator("tbody tr").first().locator("td").nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy name value" }).waitFor();
  await page.keyboard.press("Escape");
});
await check("drag a header onto another to reorder", async () => {
  const names = () =>
    grid
      .locator("thead th")
      .evaluateAll((ths) => ths.map((th) => th.textContent.trim()).filter(Boolean));
  const before = await names();
  await header("plan").dragTo(header("name"));
  await page.waitForTimeout(200);
  const after = await names();
  if (after.indexOf("plan") !== before.indexOf("name")) throw new Error(after.join(","));
  // The cells follow their header.
  const firstRow = await grid.locator("tbody tr").first().locator("td").allInnerTexts();
  if (
    !["free", "pro", "team", "enterprise"].includes(firstRow[after.indexOf("plan")]?.trim() ?? "")
  )
    throw new Error(firstRow.join(","));
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
