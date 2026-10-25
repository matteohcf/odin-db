import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await page.screenshot({ path: `test-results/rerun-fail.png` });
  }
};
await page.goto("http://localhost:1420/");
await connect(page);
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^orders/ })
  .first()
  .click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();

await check("Cmd+R reruns the visible tab's query only", async () => {
  const filter = page.getByRole("textbox", { name: "Filter" }).last();
  await filter.click();
  await page.keyboard.type('plan: "team"');
  await page.keyboard.press("Escape");
  await page.locator("tbody tr").last().click();
  await page.keyboard.press("Meta+r");
  await page.waitForFunction(() =>
    ((cells) => cells.length > 0 && cells.every((c) => c.textContent.trim() === "team"))([
      ...document.querySelectorAll("[role=tabpanel]:not([hidden]) tbody tr td:nth-child(6)"),
    ]),
  );
  if (!(await page.getByRole("tab", { name: /users/ }).first().isVisible()))
    throw new Error("page reloaded");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
