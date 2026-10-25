// Two independent tabs on one collection.
import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

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
    await page.screenshot({ path: `test-results/duplicate-fail-${name.replaceAll(" ", "-")}.png` });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await connect(page);
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
const panel = () => page.getByRole("tabpanel").filter({ visible: true }).first();
await panel().locator("tbody tr").first().waitFor();
const bar = page.getByRole("tablist", { name: "Open collections" });

await check("duplicate opens a second tab on the collection", async () => {
  await panel().getByRole("textbox", { name: "Filter" }).fill('{ plan: "pro" }');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await bar.getByRole("tab").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate tab" }).click();
  await bar.getByRole("tab").nth(1).waitFor({ timeout: 3000 });
  await panel().locator("tbody tr").first().waitFor();
});
await check("each tab keeps its own query", async () => {
  const filterText = () => panel().getByRole("textbox", { name: "Filter" }).innerText();
  const duplicate = await filterText();
  await bar.getByRole("tab").first().click();
  const original = await filterText();
  if (!original.includes('plan: "pro"') || duplicate.includes("pro"))
    throw new Error(`${original} | ${duplicate}`);
});
await check("the sidebar still opens the original tab", async () => {
  await bar.getByRole("tab").nth(1).click();
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^users/ })
    .first()
    .click();
  const selected = await bar.getByRole("tab").first().getAttribute("aria-selected");
  if (selected !== "true") throw new Error("focused the duplicate");
});
await check("Cmd-click and middle click in the sidebar open more tabs", async () => {
  const before = await bar.getByRole("tab").count();
  const row = page
    .getByRole("complementary")
    .getByRole("button", { name: /^users/ })
    .first();
  await row.click({ modifiers: ["Meta"] });
  await bar.getByRole("tab").nth(before).waitFor();
  await row.click({ button: "middle" });
  await bar
    .getByRole("tab")
    .nth(before + 1)
    .waitFor();
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
