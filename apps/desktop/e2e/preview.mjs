// Document preview beside the table.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: scheme,
  locale: "en-US",
  permissions: ["clipboard-read", "clipboard-write"],
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-preview-${name}.png` });
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
const tree = page.getByRole("complementary", { name: /Connections/ });
await tree.getByRole("button", { name: /^analytics/ }).click();
await tree.getByRole("button", { name: /^nested/ }).click();
const grid = page.locator("[role=grid]");
await grid.locator("tbody tr").first().waitFor();
const pane = page.getByRole("complementary", { name: "Document preview" });

await check("Space opens the preview of the selected document", async () => {
  await grid.locator("tbody tr").nth(2).click();
  await page.keyboard.press(" ");
  await pane.getByText("nested 2").waitFor();
  await shot("01-open");
});
await check("arrows update the preview", async () => {
  await page.keyboard.press("ArrowDown");
  await pane.getByText("nested 3").waitFor();
});
await check("expand all shows nested values", async () => {
  await pane.getByRole("button", { name: "Expand all" }).click();
  await pane.getByText("leaf 3").waitFor();
  await shot("02-expanded");
});
await check("right-click a nested field copies its dotted path", async () => {
  await pane.getByText("SKU-3-1", { exact: false }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: /Copy path items\.1\.sku/ }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  if (copied !== "items.1.sku") throw new Error(copied);
});
await check("filter by a value from the preview", async () => {
  await pane.getByText('"nested 3"').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Filter by this value" }).click();
  await page.waitForTimeout(500);
  const filter = await page.getByRole("textbox", { name: "Filter" }).innerText();
  if (!filter.includes('name: "nested 3"')) throw new Error(filter);
  await grid.locator("tbody tr").first().click();
  await pane.getByText("nested 3").first().waitFor();
});
await check("the status bar toggle closes it and remembers", async () => {
  await page.getByRole("button", { name: "Document preview" }).click();
  await pane.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Document preview" }).click();
  await pane.waitFor();
});
await check("Space toggles it off again from the grid", async () => {
  await grid.focus();
  await page.keyboard.press(" ");
  await pane.waitFor({ state: "detached" });
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
