// Window title and slow-query skeleton.
import { chromium } from "playwright";
import { connect, sidebarReady } from "./lib/connect.mjs";

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
    await page.screenshot({ path: `test-results/polish-fail.png` });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForLoadState("networkidle");
await sidebarReady(page);
await check("the window title starts as the app name", async () => {
  if ((await page.title()) !== "odin-db") throw new Error(await page.title());
});
await page.evaluate(() => {
  const original = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (cmd, args, opts) => {
    if (cmd === "find_documents") await new Promise((r) => setTimeout(r, 1500));
    return original(cmd, args, opts);
  };
});
await connect(page);
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await check("a slow first page shows placeholder rows", async () => {
  await page.getByRole("status", { name: "Running…" }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "test-results/polish-skeleton.png" });
  await page.locator("tbody tr").first().waitFor();
});
await check("the window title names the collection and connection", async () => {
  if ((await page.title()) !== "shop.users — Local development — odin-db")
    throw new Error(await page.title());
  await page.keyboard.press("Meta+,");
  await page.waitForFunction(() => document.title === "Settings — odin-db");
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
