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
    await page.screenshot({ path: `test-results/recent-fail.png` });
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
await page.locator("tbody tr").first().waitFor();
await page.keyboard.press("Meta+w");
await page.evaluate(() => {
  const tabs = JSON.parse(localStorage.getItem("odin-tabs"));
  tabs.state.tabs = [];
  tabs.state.activeTabId = null;
  localStorage.setItem("odin-tabs", JSON.stringify(tabs));
});
await page.reload();
await check("a recent collection opens connected", async () => {
  await page
    .getByRole("region", { name: "Recent" })
    .or(page.locator("section").filter({ hasText: "orders" }))
    .first()
    .getByRole("button", { name: /orders/ })
    .click();
  await page.locator("tbody tr").first().waitFor({ timeout: 5000 });
});
await check("a favorite of a closed connection opens connected", async () => {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "Local development" })
    .first()
    .click();
  await page.getByRole("complementary").getByRole("button", { name: /^shop/ }).first().click();
  await page.getByRole("button", { name: "Actions for users" }).click();
  await page.getByRole("menuitem", { name: "Add to favorites" }).click();
  await page.keyboard.press("Meta+w");
  await page.reload();
  await page
    .getByRole("region", { name: "Favorites" })
    .getByRole("button", { name: /^users/ })
    .click();
  await page.locator("tbody tr").first().waitFor({ timeout: 5000 });
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
