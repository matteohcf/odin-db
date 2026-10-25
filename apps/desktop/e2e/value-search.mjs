// Value search: text or a pattern across collections, with progress, and a hit opens its document.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-search-${name}.png` });
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
const menuFor = async (name) => {
  await page
    .getByRole("button", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) })
    .first()
    .hover();
  await page
    .getByRole("button", { name: `Actions for ${name}` })
    .first()
    .click();
};
const dialog = page.getByRole("dialog", { name: "Search values" });

await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.waitForSelector("text=shop");

await check("a database search finds values in nested fields and arrays", async () => {
  await menuFor("shop");
  await page.getByRole("menuitem", { name: "Search values…" }).click();
  await dialog.getByText("in the values of shop").waitFor();
  await dialog.getByRole("textbox", { name: "Text to find" }).fill("milano");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await dialog.getByText(/matches? in \d+ collections/).waitFor();
  const users = dialog.getByRole("region", { name: "shop.users" });
  await users.getByText("address.city").first().waitFor();
  // The match is marked inside the value.
  await users.locator("mark", { hasText: "Milano" }).first().waitFor();
  await shot("01-results");
});

await check("a regular expression and field names", async () => {
  await dialog.getByRole("textbox", { name: "Text to find" }).fill("^e?mail$");
  await dialog.getByRole("button", { name: "Regular expression" }).click();
  await dialog.getByRole("button", { name: "Field names too" }).click();
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await dialog.getByText(/matches? in \d+ collections/).waitFor();
  await dialog.getByText("field name").first().waitFor();
  await dialog.getByRole("textbox", { name: "Text to find" }).fill("(");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await dialog
    .getByRole("alert")
    .getByText(/regular expression/)
    .waitFor();
});

await check("a hit opens its document", async () => {
  await dialog.getByRole("button", { name: "Regular expression" }).click();
  await dialog.getByRole("button", { name: "Field names too" }).click();
  await dialog.getByRole("textbox", { name: "Text to find" }).fill("Torino");
  await dialog.getByRole("button", { name: "Search", exact: true }).click();
  await dialog.getByText(/matches? in \d+ collections/).waitFor();
  await dialog.getByRole("region", { name: "shop.users" }).getByRole("button").first().click();
  await dialog.waitFor({ state: "detached" });
  const filter = page.getByRole("textbox", { name: "Filter" });
  await filter.getByText(/_id: ObjectId\(/).waitFor();
  await page.getByText("1 document").first().waitFor();
});

await check("the whole connection can be searched", async () => {
  await menuFor("Local development");
  await page.getByRole("menuitem", { name: "Search values…" }).click();
  await dialog.getByText("every database").waitFor();
  await page.keyboard.press("Escape");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
