import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-niceties-${name}.png` });
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
await connect(page);
await aside().getByRole("button", { name: /^shop/ }).first().click();
await aside()
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();

await check("ids and dates tell when, on hover", async () => {
  const title = await page
    .locator("tbody tr")
    .first()
    .locator("td")
    .first()
    .locator("span")
    .getAttribute("title");
  if (!title?.includes("Created")) throw new Error(title ?? "no title");
});

await check("Cmd+L jumps to the filter of the visible tab", async () => {
  await page.locator("tbody tr").nth(3).click();
  await page.keyboard.press("Meta+l");
  await page.keyboard.type('plan: "pro"');
  const filter = await page.getByRole("textbox", { name: "Filter" }).innerText();
  if (!filter.includes('plan: "pro"')) throw new Error(filter);
  await page.keyboard.press("Escape");
});

await check("paste documents from the clipboard with Cmd+V", async () => {
  await page.evaluate(() =>
    navigator.clipboard.writeText('{"name":"Pasted one","age":1}\n{"name":"Pasted two","age":2}'),
  );
  await page.locator("tbody tr").first().click();
  await page.keyboard.press("Meta+v");
  const dialog = page.getByRole("dialog", { name: "Insert 2 pasted documents?" });
  await dialog.getByText("Pasted one").waitFor();
  await page.waitForTimeout(150);
  await shot("01-paste");
  await dialog.getByRole("button", { name: "Insert 2 documents" }).click();
  await page.getByText("Inserted 2 documents.").waitFor();
});

await check("an empty result offers to clear the filter", async () => {
  await page.getByRole("textbox", { name: "Filter" }).click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type('name: "nobody here"');
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Clear the filter" }).click();
  await page.locator("tbody tr").first().waitFor();
});

await check("an empty collection offers insert, paste and import", async () => {
  await aside().getByRole("button", { name: /^shop/ }).first().hover();
  await aside().getByRole("button", { name: "Actions for shop" }).first().click();
  await page.getByRole("menuitem", { name: /Create collection/ }).click();
  await page.getByRole("dialog").getByRole("textbox").first().fill("fresh");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Create/ })
    .click();
  await aside()
    .getByRole("button", { name: /^fresh/ })
    .click();
  await page.getByRole("button", { name: "Paste documents" }).waitFor();
  await page.getByRole("main").getByRole("button", { name: "Import documents…" }).waitFor();
  await page.waitForTimeout(150);
  await shot("02-empty");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
