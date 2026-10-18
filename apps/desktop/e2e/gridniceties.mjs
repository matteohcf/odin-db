import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1100, height: 800 },
  colorScheme: scheme,
  locale: "en-US",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-gridniceties-${name}.png` });
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
await page.click("text=Local development");
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();
const headerOf = (name) =>
  page.locator("[role=grid] thead th", { hasText: new RegExp(`^${name}$`) });

await check("_id stays visible while scrolling sideways", async () => {
  const idCell = page.locator("tbody tr").first().locator("td").first();
  const before = (await idCell.boundingBox()).x;
  await page.locator("[role=grid]").evaluate((grid) => grid.parentElement.scrollBy(600, 0));
  await page.waitForTimeout(200);
  const after = (await idCell.boundingBox()).x;
  if (Math.abs(after - before) > 1) throw new Error(`moved ${before} -> ${after}`);
  await shot("01-scrolled");
  await page.locator("[role=grid]").evaluate((grid) => grid.parentElement.scrollTo(0, 0));
});

await check("double-clicking a column edge fits its content", async () => {
  const header = headerOf("email");
  const before = (await header.boundingBox()).width;
  await header.locator("div[aria-hidden]").last().dblclick();
  await page.waitForTimeout(150);
  const after = (await header.boundingBox()).width;
  if (Math.abs(after - before) < 5) throw new Error(`${before} -> ${after}`);
});

await check("Cmd+C copies the selected document", async () => {
  await page.locator("tbody tr").nth(1).click();
  await page.keyboard.press("Meta+c");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  if (!text.includes('ObjectId("65f0a1c40000000000000002")')) throw new Error(text.slice(0, 120));
});

await check("Cmd+D duplicates the selected document", async () => {
  await page.locator("tbody tr").nth(1).click();
  await page.keyboard.press("Meta+d");
  const dialog = page.getByRole("dialog", { name: "Insert document" });
  await dialog.getByText("Linus B.").waitFor();
  if ((await dialog.locator(".cm-content").innerText()).includes("_id"))
    throw new Error("kept _id");
  await page.keyboard.press("Escape");
});
await check("copy _id and a cell as a filter", async () => {
  await page.locator("tbody tr").first().locator("td").nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy _id" }).click();
  await page.getByText("_id copied").waitFor();
  const id = await page.evaluate(() => navigator.clipboard.readText());
  if (id !== 'ObjectId("65f0a1c30000000000000001")') throw new Error(id);
  await page.locator("tbody tr").first().locator("td").nth(4).click({ button: "right" });
  await page.getByRole("menuitem", { name: /as a filter/ }).click();
  const filter = await page.evaluate(() => navigator.clipboard.readText());
  if (!/^\{ \w+: .+ \}$/.test(filter)) throw new Error(filter);
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
