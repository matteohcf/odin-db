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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-copy-${name}.png` });
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
  await page
    .getByRole("button", { name: `Actions for ${name}` })
    .first()
    .click();
};
await page.goto("http://localhost:1420/");
await connect(page);
await page.waitForSelector("text=shop");
// A read-only connection must show up as a disabled target.
await connect(page, "Production (Atlas)");
await page.waitForTimeout(800);

await check("copy a collection within the same connection under a new name", async () => {
  await page.getByRole("button", { name: /^shop/ }).first().click();
  await menuFor("orders");
  await page.getByRole("menuitem", { name: "Copy to…" }).click();
  const dialog = page.getByRole("dialog", { name: "Copy collection" });
  await dialog.getByLabel("Collection", { exact: true }).waitFor();
  // Dialogs read at the app's own 13px, not shadcn's larger default, and titles like page headers.
  const sizes = await dialog.evaluate((root) =>
    [...root.querySelectorAll("label, button, h2")].map((el) => [
      el.tagName,
      getComputedStyle(el).fontSize,
    ]),
  );
  const wrong = sizes.filter(([tag, size]) => size !== (tag === "H2" ? "16px" : "13px"));
  if (wrong.length) throw new Error(`font sizes ${JSON.stringify(wrong)}`);
  if ((await dialog.getByLabel("Collection", { exact: true }).inputValue()) !== "orders_copy")
    throw new Error("default name");
  await dialog.getByText("shop.orders").first().waitFor();
  await page.waitForTimeout(200);
  await shot("01-collection");
  await dialog.getByLabel("Collection", { exact: true }).fill("orders");
  await dialog
    .getByRole("alert")
    .getByText(/cannot be copied onto itself/)
    .waitFor();
  if (!(await dialog.getByRole("button", { name: "Copy", exact: true }).isDisabled()))
    throw new Error("enabled onto itself");
  await dialog.getByLabel("Collection", { exact: true }).fill("orders_2026");
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await dialog
    .getByText(/Copied 1 collection: [\d,]+ documents inserted/)
    .waitFor({ timeout: 10000 });
  await shot("02-collection-done");
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await page
    .getByRole("button", { name: /^orders_2026/ })
    .first()
    .waitFor();
});

await check("read-only connections are listed but not selectable", async () => {
  await menuFor("users");
  await page.getByRole("menuitem", { name: "Copy to…" }).click();
  const dialog = page.getByRole("dialog", { name: "Copy collection" });
  await dialog.getByLabel("Target connection").click();
  const option = page.getByRole("option", { name: /Production \(Atlas\) \(read-only\)/ });
  await option.waitFor();
  if ((await option.getAttribute("aria-disabled")) !== "true")
    throw new Error("read-only selectable");
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

await check("copy a database with typed confirmation to replace", async () => {
  await menuFor("shop");
  await page.getByRole("menuitem", { name: "Copy database to…" }).click();
  const dialog = page.getByRole("dialog", { name: "Copy database" });
  if ((await dialog.getByLabel("Database", { exact: true }).inputValue()) !== "shop_copy")
    throw new Error("default db name");
  await dialog.getByRole("checkbox", { name: "Replace the target collections" }).click();
  await dialog.getByLabel("Type shop_copy to confirm").fill("shop_copy");
  await page.waitForTimeout(200);
  await shot("03-database");
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await dialog.getByText(/Copied \d+ collections/).waitFor({ timeout: 10000 });
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await page
    .getByRole("button", { name: /^shop_copy/ })
    .first()
    .waitFor();
});

await check(
  "Cmd+C on a collection and Cmd+V on another database opens the copy there",
  async () => {
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: /^orders/ })
      .first()
      .focus();
    await page.keyboard.press("Meta+c");
    await page.getByText(/Copied orders\. Select a database/).waitFor();
    await page
      .getByRole("button", { name: /^analytics/ })
      .first()
      .focus();
    await page.keyboard.press("Meta+v");
    const dialog = page.getByRole("dialog", { name: "Copy collection" });
    const database = dialog.getByLabel("Database", { exact: true });
    await database.waitFor();
    if ((await database.inputValue()) !== "analytics") throw new Error(await database.inputValue());
    if ((await dialog.getByLabel("Collection", { exact: true }).inputValue()) !== "orders")
      throw new Error("collection name");
    await page.waitForTimeout(300);
    await shot("05-paste");
    await page.keyboard.press("Escape");
  },
);

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
