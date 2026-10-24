// Catalog: create, rename and drop databases and collections, with collection types and views.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-cat-${name}.png` });
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
  const pattern = name.replace(/[()]/g, "\\$&");
  await page
    .getByRole("button", { name: new RegExp(`^${pattern}`) })
    .first()
    .hover();
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
};

await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.waitForSelector("text=shop");

await check("create a database with its first collection", async () => {
  await menuFor("Local development");
  await page.getByRole("menuitem", { name: "Create database…" }).click();
  await page.getByLabel("Database name").fill("inventory");
  await page.getByLabel("Collection name").fill("items");
  await shot("01-create-db");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("tab", { name: /items/ }).waitFor();
  await page.getByRole("button", { name: /^inventory/ }).waitFor();
});

await check("an existing name is explained", async () => {
  await menuFor("inventory");
  await page.getByRole("menuitem", { name: "Create collection…" }).click();
  await page.getByLabel("Collection name").fill("items");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "already exists" }).waitFor();
  await page.getByLabel("Collection name").fill("suppliers");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("tab", { name: /suppliers/ }).waitFor();
});

await check("a capped collection asks for its size", async () => {
  await menuFor("inventory");
  await page.getByRole("menuitem", { name: "Create collection…" }).click();
  await page.getByLabel("Collection name").fill("log");
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByLabel("Type").click();
  await page.getByRole("option", { name: "Capped" }).click();
  await page.getByText("A fixed size: the oldest documents").waitFor();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByText("Required").waitFor();
  await page.getByLabel("Size (MB)").fill("16");
  await page.getByLabel("Collation").fill("locale: 'en', strength: 2");
  await shot("02-capped");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("tab", { name: /log/ }).waitFor();
});

await check("a time series collection needs its time field", async () => {
  await menuFor("inventory");
  await page.getByRole("menuitem", { name: "Create collection…" }).click();
  await page.getByLabel("Collection name").fill("readings");
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByLabel("Type").click();
  await page.getByRole("option", { name: "Time series" }).click();
  await page.getByLabel("Meta field").fill("sensor");
  await page.getByLabel("Granularity").click();
  await page.getByRole("option", { name: "Minutes" }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByText("Required").waitFor();
  await page.getByLabel("Time field").fill("at");
  await page.getByText("Required").waitFor({ state: "detached" });
  await shot("03-time-series");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("tab", { name: /readings/ }).waitFor();
});

await check("an aggregation pipeline is saved as a view", async () => {
  await page.click("text=shop");
  await page.getByRole("button", { name: /^orders$/ }).click();
  await page.getByRole("tab", { name: "Aggregation" }).click();
  const editor = page.getByRole("region", { name: "Stage 1" }).locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText('{ status: "paid" }');
  await page.getByRole("button", { name: "Create view" }).click();
  const dialog = page.getByRole("dialog", { name: "Create view" });
  await dialog.getByText("through this pipeline's stage").waitFor();
  await dialog.getByLabel("View name").fill("paid_orders");
  await shot("04-view");
  await dialog.getByRole("button", { name: "Create view" }).click();
  await page.getByRole("tab", { name: /paid_orders/ }).waitFor();
  await page.getByText("88 documents").waitFor();
  await page
    .getByRole("button", { name: /^paid_orders/ })
    .first()
    .waitFor();
});

await check("rename a collection and keep its tab", async () => {
  await page
    .getByRole("button", { name: /^inventory/ })
    .first()
    .click();
  await page.getByRole("button", { name: /^items$/ }).waitFor();
  await menuFor("items");
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByLabel("New name").fill("products");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("button", { name: /^products$/ }).waitFor();
  await page.getByRole("tab", { name: /products/ }).waitFor();
  if (await page.getByRole("tab", { name: /^items/ }).count()) throw new Error("stale tab");
  await page.waitForTimeout(800);
  if (await page.getByRole("button", { name: /^items$/ }).count())
    throw new Error("old name still listed");
});

await check("dropping needs the typed name and closes the tab", async () => {
  await menuFor("products");
  await page.getByRole("menuitem", { name: "Drop collection…" }).click();
  const drop = page.getByRole("button", { name: "Drop", exact: true });
  if (await drop.isEnabled()) throw new Error("enabled before typing");
  await page.getByLabel("Type products to confirm").fill("product");
  if (await drop.isEnabled()) throw new Error("enabled with a wrong name");
  await page.getByLabel("Type products to confirm").fill("products");
  await shot("02-drop");
  await drop.click();
  await page.getByRole("button", { name: /^products$/ }).waitFor({ state: "detached" });
  if (await page.getByRole("tab", { name: /products/ }).count()) throw new Error("tab left open");
});

await check("drop a database", async () => {
  await menuFor("inventory");
  await page.getByRole("menuitem", { name: "Drop database…" }).click();
  await page.getByLabel("Type inventory to confirm").fill("inventory");
  await page.getByRole("button", { name: "Drop", exact: true }).click();
  await page.getByRole("button", { name: /^inventory/ }).waitFor({ state: "detached" });
  if (await page.getByRole("tab", { name: /suppliers/ }).count()) throw new Error("tab left open");
});

await check("read-only profiles offer no catalog changes", async () => {
  await page.click("text=Production (Atlas)");
  await page.waitForTimeout(800);
  await menuFor("Production (Atlas)");
  if (await page.getByRole("menuitem", { name: "Create database…" }).count())
    throw new Error("create shown");
  await page.keyboard.press("Escape");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
