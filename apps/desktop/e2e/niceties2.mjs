import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: scheme,
  locale: "en-US",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-niceties2-${name}.png` });
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
await page.goto("http://localhost:1420/");
await page.evaluate(() => {
  // Sizes and counts in the tree are off by default, like Compass.
  const saved = JSON.parse(localStorage.getItem("odin-settings") ?? '{"state":{},"version":1}');
  saved.state.sidebarSizes = true;
  localStorage.setItem("odin-settings", JSON.stringify(saved));
});
await page.reload();
await page.click("text=Local development");
await aside().getByRole("button", { name: /^shop/ }).first().click();

await check("collections show their document counts", async () => {
  await aside()
    .getByRole("button", { name: /^users/ })
    .getByText("1.2K")
    .waitFor();
  const title = await aside().getByText("1.2K").getAttribute("title");
  if (title !== "About 1,240 documents") throw new Error(title);
  await page.waitForTimeout(150);
  await shot("01-counts");
});

await check("exclude and range filters from a cell", async () => {
  await aside()
    .getByRole("button", { name: /^users/ })
    .click();
  await page.locator("tbody tr").first().waitFor();
  await page
    .locator("tbody tr")
    .first()
    .locator("td", { hasText: /^(free|pro|team|enterprise)$/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Exclude this plan/ }).click();
  let filter = await page.getByRole("textbox", { name: "Filter" }).innerText();
  if (!filter.includes("$ne")) throw new Error(filter);
  await page.locator("tbody tr").first().locator("td").nth(3).click({ button: "right" });
  await page.getByRole("menuitem", { name: /age greater than this/ }).click();
  filter = await page.getByRole("textbox", { name: "Filter" }).innerText();
  if (!filter.includes("$gt")) throw new Error(filter);
});

await check("copy a tab's namespace", async () => {
  await page
    .getByRole("tablist", { name: "Open collections" })
    .getByRole("tab", { name: /users/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy namespace" }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  if (text !== "shop.users") throw new Error(text);
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
