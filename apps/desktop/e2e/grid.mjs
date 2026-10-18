// Query bar: autocompletion, history, reset.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-grid-${name}.png` });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
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
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};

const headerOf = (name) =>
  page.locator("[role=grid] thead th", { hasText: new RegExp(`^${name}$`) });
const firstCell = async (column) => {
  const index = await page
    .locator("[role=grid] thead th")
    .evaluateAll((ths, name) => ths.findIndex((th) => th.textContent.trim() === name), column);
  return page.locator("[role=grid] tbody tr").first().locator("th, td").nth(index).innerText();
};

await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.click("text=shop");
await page.getByRole("button", { name: /^users$/ }).click();
await page.waitForSelector("[role=grid] tbody tr");

await check("clicking a header sorts ascending, descending, then off", async () => {
  await headerOf("age").getByRole("button").first().click();
  await page.waitForTimeout(600);
  const sort = page.getByRole("textbox", { name: "Sort" });
  if ((await sort.innerText()).trim() !== "{ age: 1 }") throw new Error(await sort.innerText());
  if ((await headerOf("age").getAttribute("aria-sort")) !== "ascending")
    throw new Error("aria-sort");
  const lowest = Number(await firstCell("age"));
  await headerOf("age").getByRole("button").first().click();
  await page.waitForTimeout(600);
  const highest = Number(await firstCell("age"));
  if (!(highest > lowest)) throw new Error(`${lowest} then ${highest}`);
  await shot("01-sorted");
  await headerOf("age").getByRole("button").first().click();
  await page.waitForTimeout(600);
  if ((await sort.innerText()).includes("age")) throw new Error(await sort.innerText());
});

await check("dragging a header edge resizes the column", async () => {
  const header = headerOf("email");
  const before = (await header.boundingBox()).width;
  const handle = header.locator("div[aria-hidden]");
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const after = (await header.boundingBox()).width;
  if (Math.abs(after - before - 120) > 6) throw new Error(`${before} -> ${after}`);
  await handle.dblclick();
  const reset = (await header.boundingBox()).width;
  if (Math.abs(reset - (before + 120)) < 2) throw new Error(`still at dragged width ${reset}`);
});

await check("right-clicking a cell filters by its value", async () => {
  const value = await firstCell("plan");
  const index = await page
    .locator("[role=grid] thead th")
    .evaluateAll((ths) => ths.findIndex((th) => th.textContent.trim() === "plan"));
  await page
    .locator("[role=grid] tbody tr")
    .first()
    .locator("th, td")
    .nth(index)
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy plan value" }).waitFor();
  await shot("02-cell-menu");
  await page.getByRole("menuitem", { name: "Filter by this plan" }).click();
  await page.waitForTimeout(600);
  const filter = await page.getByRole("textbox", { name: "Filter" }).innerText();
  if (filter.trim() !== `{ plan: "${value}" }`) throw new Error(filter);
  const plans = await page.locator("[role=grid] tbody tr").evaluateAll((rows) => rows.length);
  if (plans === 0) throw new Error("no rows");
  if ((await firstCell("plan")) !== value) throw new Error("not filtered");
});

await check("columns can be hidden and shown again", async () => {
  await page.getByRole("button", { name: "Choose columns" }).click();
  await page.getByRole("menuitemcheckbox", { name: "email" }).click();
  await page.getByRole("menuitemcheckbox", { name: "balance" }).click();
  await page.waitForTimeout(250);
  await shot("03-columns");
  await page.keyboard.press("Escape");
  if (await headerOf("email").count()) throw new Error("email still shown");
  if (await headerOf("balance").count()) throw new Error("balance still shown");
  await page.getByRole("button", { name: "Choose columns" }).click();
  await page.getByRole("menuitem", { name: "Show all columns" }).click();
  await headerOf("email").waitFor();
});

await check("the row menu still works from the row number", async () => {
  await page.locator("[role=grid] tbody tr").first().locator("th").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit document" }).waitFor();
  if (await page.getByRole("menuitem", { name: /Filter by/ }).count())
    throw new Error("cell items shown");
  await page.keyboard.press("Escape");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
