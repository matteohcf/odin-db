import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-dbtransfer-${name}.png` });
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
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .hover();
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
};
await page.goto("http://localhost:1420/");
await connect(page);
await page.waitForSelector("text=shop");

await check("export a database lists its collections and exports the selection", async () => {
  await menuFor("shop");
  await page.getByRole("menuitem", { name: "Export database…" }).click();
  const dialog = page.getByRole("dialog", { name: "Export database" });
  await dialog.getByRole("checkbox", { name: "orders" }).waitFor();
  const boxes = await dialog.getByRole("checkbox").count();
  if (boxes < 2) throw new Error(`boxes ${boxes}`);
  await dialog.getByRole("checkbox", { name: "orders" }).click();
  await page.waitForTimeout(200);
  await shot("01-export");
  await dialog.getByRole("button", { name: "Select all" }).click();
  await dialog.getByRole("button", { name: "Select none" }).click();
  if (!(await dialog.getByRole("button", { name: "Choose folder and export" }).isDisabled()))
    throw new Error("enabled with nothing selected");
  await dialog.getByRole("button", { name: "Select all" }).click();
  await dialog.getByRole("button", { name: "Choose folder and export" }).click();
  await dialog.getByText(/Exported \d+ collections/).waitFor({ timeout: 10000 });
  await shot("02-export-done");
  await dialog.getByRole("button", { name: "Close" }).last().click();
});

await check("import into a database needs typed confirmation to empty first", async () => {
  await menuFor("shop");
  await page.getByRole("menuitem", { name: "Import into database…" }).click();
  const dialog = page.getByRole("dialog", { name: "Import into database" });
  await dialog.getByRole("button", { name: "Choose folder…" }).click();
  await dialog.getByText("2 collections from /Users/ada/Exports/shop").waitFor();
  await dialog.getByRole("radio", { name: "Merge by _id" }).click();
  await dialog.getByRole("checkbox", { name: "Empty each collection first" }).click();
  const submit = dialog.getByRole("button", { name: "Import", exact: true });
  if (!(await submit.isDisabled())) throw new Error("enabled without confirmation");
  await dialog.getByLabel("Type shop to confirm").fill("shop");
  await page.waitForTimeout(200);
  await shot("03-import");
  await submit.click();
  await dialog
    .getByText(/Imported 2 collections: 50 documents inserted/)
    .waitFor({ timeout: 10000 });
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await page.getByRole("button", { name: /^shop/ }).first().click();
  await page
    .getByRole("button", { name: /^coupons/ })
    .first()
    .waitFor();
});

await check("collection import offers modes", async () => {
  await page
    .getByRole("button", { name: /^orders/ })
    .first()
    .click();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Import documents…" }).click();
  const dialog = page.getByRole("dialog", { name: "Import documents" });
  await dialog.getByRole("button", { name: "Choose file…" }).click();
  await dialog.getByRole("radio", { name: "Replace by _id" }).click();
  await dialog.getByRole("checkbox", { name: "Empty the collection first" }).click();
  await dialog.getByLabel("Type orders to confirm").fill("order");
  if (!(await dialog.getByRole("button", { name: "Import", exact: true }).isDisabled()))
    throw new Error("enabled with a wrong name");
  await dialog.getByLabel("Type orders to confirm").fill("orders");
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await dialog.getByText(/Imported 119 documents/).waitFor({ timeout: 10000 });
  await dialog.getByRole("button", { name: "Close" }).last().click();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
