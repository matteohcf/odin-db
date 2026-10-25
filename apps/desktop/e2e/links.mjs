// Links stored in documents.
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
    await page.screenshot({ path: `test-results/links-fail.png` });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await connect(page);
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^orders/ })
  .first()
  .click();
const grid = page.locator("[role=grid]");
await grid.locator("tbody tr").first().waitFor();
const cell = () => grid.locator("tbody tr").first().getByText("https://track.example.com/10000");

await check("the cell menu opens a link", async () => {
  await cell().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open link" }).click();
  await page.waitForFunction(
    () => window.odinOpenedLink === "https://track.example.com/10000",
    null,
    { timeout: 3000 },
  );
});
await check("Cmd-click opens it too, without selecting text", async () => {
  await page.evaluate(() => {
    window.odinOpenedLink = null;
  });
  await cell().click({ modifiers: ["Meta"] });
  await page.waitForFunction(
    () => window.odinOpenedLink === "https://track.example.com/10000",
    null,
    { timeout: 3000 },
  );
});
await check("non-link cells offer no Open link", async () => {
  await grid.locator("tbody tr").first().locator("td").nth(2).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Copy/ }).first().waitFor();
  if (await page.getByRole("menuitem", { name: "Open link" }).count()) throw new Error("offered");
  await page.keyboard.press("Escape");
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
