// Find in results (Mod+F): a browser-like find bar over the loaded documents.
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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-find-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const aside = () => page.getByRole("complementary");
const find = () => page.getByRole("searchbox", { name: "Find in results" });
const status = () => page.getByRole("search").getByRole("status");
const current = () => page.locator("[data-find-current]");
// Text marks drawn through the CSS Custom Highlight API.
const marks = (name) => page.evaluate((name) => CSS.highlights.get(name)?.size ?? 0, name);

await page.goto("http://localhost:1420/");
await connect(page);
await aside().getByRole("button", { name: /^shop/ }).first().click();
await aside()
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();

await check("Mod+F opens the find bar, not the filter", async () => {
  await page.locator("tbody tr").first().click();
  await page.keyboard.press("Meta+f");
  await find().waitFor();
  if (!(await find().evaluate((el) => el === document.activeElement)))
    throw new Error("find not focused");
});

await check("a value far below the screen is scrolled to, selected and marked", async () => {
  await find().fill(".47@example");
  await status().getByText("1 of 1").waitFor();
  await current()
    .getByText(/\.47@example\.com/)
    .waitFor();
  const row = await page.locator('tbody tr[aria-selected="true"]').getAttribute("aria-rowindex");
  if (row !== "49") throw new Error(`selected row ${row}`);
  if ((await marks("find-current")) !== 1) throw new Error("current match not marked");
  await page.waitForTimeout(150);
  await shot("01-value");
});

await check("Enter and Shift+Enter step through matches and wrap", async () => {
  await find().fill("beta");
  // Many matches, not the single one of the previous text.
  await status()
    .getByText(/^1 of \d{2,}$/)
    .waitFor();
  await page.keyboard.press("Enter");
  await status()
    .getByText(/^2 of \d+$/)
    .waitFor();
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.press("Shift+Enter");
  // Back past the first is the last; scrolling there may load more rows, and more matches.
  await status()
    .getByText(/^(\d+) of \1\+?$/)
    .waitFor();
  // "beta" is inside the tags arrays, which cells sum up as "[ 2 elements ]": tinted instead.
  if ((await page.locator("td[data-find-match]").count()) < 2) throw new Error("not tinted");
});

await check("field names match, in headers too", async () => {
  await find().fill("zip");
  // The address column, whose nested field is zip (the cell sums it up; its title has it all).
  await current().locator('[title*="zip:"]').waitFor();
  await find().fill("loginCount");
  await page.waitForFunction(() => (CSS.highlights.get("find")?.size ?? 0) > 0);
});

await check("no match says so", async () => {
  await find().fill("no-such-thing");
  await status().getByText("No matches").waitFor();
  if (await current().count()) throw new Error("a stale current match");
});

await check("the list view marks the field in its document", async () => {
  await page.getByRole("radio", { name: "List" }).click();
  await find().fill("pro");
  await status()
    .getByText(/^1 of \d+$/)
    .waitFor();
  await page.locator('[role="option"] [data-find-current][data-path="plan"]').waitFor();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  await shot("02-list");
  await page.getByRole("radio", { name: "Table" }).click();
});

await check("Escape closes it and gives the grid its focus back", async () => {
  await find().focus();
  await page.keyboard.press("Escape");
  await find().waitFor({ state: "detached" });
  if (!(await page.getByRole("grid").evaluate((el) => el === document.activeElement)))
    throw new Error("grid not focused");
  if ((await marks("find")) !== 0) throw new Error("marks left behind");
});

await check("Mod+L focuses the filter", async () => {
  await page.keyboard.press("Meta+l");
  const focused = await page.evaluate(() => document.activeElement?.closest(".cm-editor") !== null);
  if (!focused) throw new Error("filter not focused");
  await page.keyboard.press("Escape");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
