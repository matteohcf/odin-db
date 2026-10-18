// Dates in UTC or local time.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  locale: "en-US",
  timezoneId: "Europe/Rome",
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await page.screenshot({ path: `test-results/dates-fail.png` });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.click("text=Local development");
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();
const grid = () =>
  page.getByRole("tabpanel").filter({ visible: true }).first().locator("[role=grid]");
await check("dates show in UTC by default", async () => {
  await grid().getByText("2023-01-01 00:00:00.000 UTC").first().waitFor();
});
await check("local time shows the offset", async () => {
  await page.keyboard.press("Meta+,");
  const panel = page.getByRole("tabpanel").filter({ visible: true });
  await panel.getByRole("button", { name: "Results" }).first().click();
  await panel.getByRole("radio", { name: "Local time" }).click();
  await page.getByRole("tab", { name: /users/ }).first().click();
  await grid().getByText("2023-01-01 01:00:00.000 +01:00").first().waitFor();
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
