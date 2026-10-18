// Compare collections: from the sidebar, progress, summary, document diff.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
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
    await page.screenshot({ path: "test-results/compare-fail.png" });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
const tree = page.getByRole("complementary", { name: /Connections/ });
await tree
  .getByRole("button", { name: /^Local development/ })
  .first()
  .click();
await tree.getByRole("button", { name: /^shop/ }).first().click();
const dialog = page.getByRole("dialog");
await check("Compare with… opens from the collection menu", async () => {
  await tree
    .getByRole("button", { name: /^users/ })
    .first()
    .hover();
  await tree.getByRole("button", { name: "Actions for users" }).click();
  await page.getByRole("menuitem", { name: "Compare with…" }).click();
  await dialog.getByRole("heading", { name: "Compare collections" }).waitFor();
});
await check("the same collection cannot be picked", async () => {
  await dialog.getByRole("combobox", { name: "Collection" }).click();
  await page.getByRole("option", { name: "users" }).click();
  await dialog.getByText("Choose another collection").waitFor();
  if (await dialog.getByRole("button", { name: "Compare", exact: true }).isEnabled())
    throw new Error("enabled");
});
await check("comparing shows progress, then counts and ids", async () => {
  await dialog.getByRole("combobox", { name: "Collection" }).click();
  await page.getByRole("option", { name: "orders" }).click();
  await dialog.getByRole("button", { name: "Compare", exact: true }).click();
  await dialog.getByText(/of 2,450 documents read/).waitFor();
  await dialog.getByText("2,385").waitFor({ timeout: 10000 });
  await dialog.getByRole("tab", { name: "Only in users" }).waitFor();
  await page.screenshot({ path: "test-results/compare.png" });
});
await check("a differing document opens side by side", async () => {
  await dialog
    .getByRole("button", { name: /65f0a1c0+1/ })
    .first()
    .click();
  await page.getByRole("heading", { name: "Compare documents" }).waitFor();
  await page.getByText("pro").first().waitFor();
  await page.screenshot({ path: "test-results/compare-pair.png" });
  await page.keyboard.press("Escape");
});
await check("a bad filter is reported before running", async () => {
  await dialog.getByLabel("Only documents matching (optional)").fill("{ status: ");
  await dialog.getByRole("button", { name: "Compare again" }).click();
  await dialog.getByRole("alert").waitFor();
});
await check(
  "sync: deleting needs the name typed back, then the comparison runs again",
  async () => {
    await dialog.getByLabel("Only documents matching (optional)").fill("");
    await dialog.getByRole("button", { name: "Compare again" }).click();
    await dialog.getByText("2,385").waitFor({ timeout: 10000 });
    await dialog.getByRole("button", { name: "Sync…" }).click();
    await dialog.getByText("Insert 20 missing documents").waitFor();
    await dialog.getByText("Replace 40 different documents").waitFor();
    await dialog.getByRole("checkbox", { name: /Delete 5 documents/ }).click();
    const apply = dialog.getByRole("button", { name: "Apply to orders" });
    if (await apply.isEnabled()) throw new Error("enabled before confirming");
    await dialog.getByLabel("Collection name, to confirm").fill("orders");
    await page.screenshot({ path: "test-results/compare-sync.png" });
    await apply.click();
    await page
      .getByText("Synced: 20 inserted, 40 replaced, 5 deleted.")
      .waitFor({ timeout: 10000 });
    await dialog.getByText("The collections hold the same documents.").waitFor({ timeout: 10000 });
  },
);
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
