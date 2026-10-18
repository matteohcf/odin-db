// Deleting without confirmation, with undo.
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
    await page.screenshot({ path: `test-results/quickdelete-fail.png` });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.click("text=Local development");
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^orders/ })
  .first()
  .click();
const grid = page.locator("[role=grid]");
await grid.locator("tbody tr").first().waitFor();
const firstId = () => grid.locator("tbody tr").first().locator("td").first().innerText();

await check("by default Delete asks first", async () => {
  await grid.locator("tbody tr").first().click();
  await page.keyboard.press("Delete");
  await page.getByRole("button", { name: "Delete document" }).waitFor();
  await page.keyboard.press("Escape");
});
await check("turned off, Delete removes at once and Undo restores", async () => {
  await page.keyboard.press("Meta+,");
  await page
    .getByRole("tabpanel")
    .filter({ visible: true })
    .getByRole("button", { name: "Results" })
    .first()
    .click();
  await page.getByRole("switch", { name: "Ask before deleting a document" }).click();
  await page.getByRole("tab", { name: /orders/ }).click();
  const before = await firstId();
  await grid.locator("tbody tr").first().click();
  await page.keyboard.press("Delete");
  await page.getByText("Document deleted").waitFor();
  if (await page.getByRole("button", { name: "Delete document" }).count())
    throw new Error("asked anyway");
  await page.waitForFunction(
    (id) => document.querySelector("tbody tr td")?.textContent?.trim() !== id,
    before,
  );
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForFunction(
    (id) => document.querySelector("tbody tr td")?.textContent?.trim() === id,
    before,
  );
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
