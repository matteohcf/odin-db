// Out-of-order answers and rapid actions.
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
    await page.screenshot({
      path: `test-results/races-fail-${name.slice(0, 20).replaceAll(" ", "-")}.png`,
    });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByText("Local development").waitFor();
await page.click("text=Local development");
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();
const filter = page.getByRole("textbox", { name: "Filter" });
const setFilter = async (text) => {
  await filter.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText(text);
  await page.keyboard.press("Escape");
};
await check("a slow first query cannot overwrite a newer one", async () => {
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    let n = 0;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args, opts) => {
      if (cmd === "find_documents" && n++ === 0) await new Promise((r) => setTimeout(r, 1500));
      return original(cmd, args, opts);
    };
  });
  await setFilter('{ plan: "pro" }');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  await setFilter('{ plan: "team" }');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  const plans = await page.locator("tbody tr td:nth-child(6)").allInnerTexts();
  if (plans.length === 0 || plans.some((p) => p.trim() !== "team"))
    throw new Error(plans.slice(0, 5).join(","));
});
await check("spamming Run leaves one consistent result", async () => {
  for (let i = 0; i < 15; i++) await page.keyboard.press("Meta+r");
  await page.waitForTimeout(1500);
  const plans = await page.locator("tbody tr td:nth-child(6)").allInnerTexts();
  if (plans.length === 0 || plans.some((p) => p.trim() !== "team"))
    throw new Error(plans.slice(0, 5).join(","));
});
await check("closing a tab while its query runs is clean", async () => {
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (cmd, args, opts) => {
      if (cmd === "find_documents") await new Promise((r) => setTimeout(r, 800));
      return original(cmd, args, opts);
    };
  });
  await page
    .getByRole("button", { name: /^orders/ })
    .first()
    .click();
  await page.keyboard.press("Meta+w");
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: /^orders/ })
    .first()
    .click();
  await page.locator("tbody tr").first().waitFor();
});
await check("switching collections quickly shows the last one", async () => {
  for (const name of ["orders", "users", "orders", "users"]) {
    await page
      .getByRole("button", { name: new RegExp(`^${name}`) })
      .first()
      .click();
  }
  await page.waitForTimeout(2000);
  const title = await page.title();
  if (!title.startsWith("shop.users")) throw new Error(title);
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
