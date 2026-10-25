// Wide (300 fields) and deep, array-heavy documents.
import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: scheme,
  locale: "en-US",
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-shapes-${name}.png` });
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
const panel = () => page.getByRole("tabpanel").filter({ visible: true });
await page.goto("http://localhost:1420/");
await connect(page);
await tree.getByRole("button", { name: /^analytics\b/ }).click();

await check(
  "a 300-field collection opens quickly",
  async () => {
    await tree.getByRole("button", { name: /^wide\b/ }).click();
    await panel().locator("[role=grid] tbody tr").first().waitFor();
  },
  2500,
);
await check("the grid renders only the columns in view", async () => {
  const cells = await panel().locator("[role=grid] tbody tr").first().locator("td").count();
  console.log(`cells in first row: ${cells}`);
  if (cells > 40) throw new Error(`${cells} cells per row`);
});
await check(
  "scrolling to the far right is smooth",
  async () => {
    const scroller = panel().locator("[role=grid]").locator("..");
    const started = Date.now();
    for (let i = 1; i <= 10; i++) {
      await scroller.evaluate((el, f) => el.scrollTo(el.scrollWidth * f, 0), i / 10);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    console.log(`10 horizontal jumps: ${Date.now() - started} ms`);
    await panel()
      .getByRole("columnheader", { name: /field_299/ })
      .waitFor();
    await shot("01-wide-right");
  },
  1500,
);
await check("Tab walks into columns that were out of view", async () => {
  const scroller = panel().locator("[role=grid]").locator("..");
  await scroller.evaluate((el) => el.scrollTo(0, 0));
  await page.waitForTimeout(100);
  await panel().locator("[role=grid] tbody tr").first().locator("td").nth(2).dblclick();
  const input = page.getByRole("textbox", { name: "Value" });
  await input.waitFor();
  for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
  await page.waitForTimeout(150);
  if (!(await input.isVisible())) throw new Error("editor not mounted");
  const box = await input.boundingBox();
  if (!box || box.x > 1440 || box.x < 256) throw new Error(`editor at x=${box?.x}`);
  await shot("05-tab-far");
  await page.keyboard.press("Escape");
});
await check("a pinned column stays in view after _id", async () => {
  const scroller = panel().locator("[role=grid]").locator("..");
  await scroller.evaluate((el) => el.scrollTo(0, 0));
  await page.waitForTimeout(100);
  const header = panel()
    .locator("[role=grid] thead th")
    .filter({ hasText: /^field_004$/ });
  await header.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin to the left" }).click();
  await scroller.evaluate((el) => el.scrollTo(el.scrollWidth / 2, 0));
  await page.waitForTimeout(150);
  const id = await panel()
    .locator("[role=grid] thead th")
    .filter({ hasText: /^_id$/ })
    .boundingBox();
  const box = await header.boundingBox();
  if (!box || !id || Math.abs(box.x - (id.x + id.width)) > 2)
    throw new Error(`pinned at ${box?.x}, _id ends at ${id && id.x + id.width}`);
  await shot("06-pinned");
  await header.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Unpin" }).click();
  await page.waitForTimeout(150);
  if (await header.count()) throw new Error("still rendered after unpinning while scrolled away");
  await scroller.evaluate((el) => el.scrollTo(0, 0));
});
await check("the columns menu lists 300 fields", async () => {
  await panel().getByRole("button", { name: "Choose columns" }).click();
  await page.getByRole("menuitemcheckbox", { name: "field_150" }).waitFor();
  await page.keyboard.press("Escape");
});
await check(
  "JSON view of wide documents",
  async () => {
    await panel().getByRole("radio", { name: /JSON/ }).click();
    await panel().getByText("field_299").first().waitFor();
    await shot("02-wide-json");
    await panel().getByRole("radio", { name: /Table/ }).click();
  },
  2500,
);
await check(
  "deep documents open in the editor",
  async () => {
    await tree.getByRole("button", { name: /^nested\b/ }).click();
    await panel().locator("[role=grid] tbody tr").first().waitFor();
    await panel().locator("[role=grid] tbody tr").first().locator("th").dblclick();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("dialog").getByText("leaf 0").waitFor();
    await shot("03-nested-editor");
    await page.keyboard.press("Escape");
  },
  3000,
);
await check("tree view expands nested values", async () => {
  await panel()
    .getByRole("radio", { name: /List|Tree/ })
    .click();
  await panel().getByText("nested 0").first().waitFor();
  await shot("04-nested-tree");
  await panel().getByRole("radio", { name: /Table/ }).click();
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
