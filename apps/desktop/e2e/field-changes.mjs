// Field changes from the column menu: rename, convert and remove a field in matching documents.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-field-${name}.png` });
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
const header = (field) =>
  page.locator("[role=grid] thead th").filter({ hasText: new RegExp(`^${field}$`) });
const columnMenu = (field) => header(field).click({ button: "right" });
const dialog = page.getByRole("dialog");

await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.click("text=shop");
await page.getByRole("button", { name: /^users$/ }).click();
await page.waitForSelector("[role=grid] tbody tr");

await check("renaming in every document asks for the collection name", async () => {
  await columnMenu("plan");
  await page.getByRole("menuitem", { name: "Rename field…" }).click();
  await dialog.getByText("every document").waitFor();
  await dialog.getByLabel("New name").fill("tier");
  const submit = dialog.getByRole("button", { name: "Rename", exact: true });
  if (!(await submit.isDisabled())) throw new Error("renamed without confirmation");
  await dialog.getByLabel(/Type users to confirm/).fill("users");
  await shot("01-rename");
  await submit.click();
  await page.getByText(/Renamed plan to tier in [\d,]+ documents/).waitFor();
  // Renamed fields move to the end of each document, past the visible columns.
  await header("plan").waitFor({ state: "detached" });
});

await check("converting keeps what cannot be converted", async () => {
  await page.getByRole("textbox", { name: "Filter" }).click();
  await page.keyboard.insertText("age: { $gt: 70 }");
  await page.keyboard.press("Meta+Enter");
  await page.locator("[role=grid] tbody tr").first().getByText("74").waitFor();
  await columnMenu("age");
  await page.getByRole("menuitem", { name: "Change type…" }).click();
  await dialog.getByText("{ age: { $gt: 70 } }").waitFor();
  await dialog.getByLabel("New type").click();
  await page.getByRole("option", { name: "String" }).click();
  await shot("02-convert");
  await dialog.getByRole("button", { name: "Convert" }).click();
  await page.getByText(/Converted age in [\d,]+ documents?/).waitFor();
});

await check("removing is destructive and refused on _id", async () => {
  await columnMenu("email");
  const remove = page.getByRole("menuitem", { name: "Remove field…" });
  await remove.click();
  await dialog.getByText("This cannot be undone.").waitFor();
  await dialog.getByRole("button", { name: "Remove field" }).click();
  await page.getByText(/Removed email from [\d,]+ documents?/).waitFor();
  await header("email").waitFor({ state: "detached" });
  await page.keyboard.press("Escape");
  await columnMenu("_id");
  if (await page.getByRole("menuitem", { name: "Remove field…" }).count())
    throw new Error("_id offers remove");
  await page.keyboard.press("Escape");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
