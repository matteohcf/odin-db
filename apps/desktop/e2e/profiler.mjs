// Profiler in the server tab: level, slow operations, index hints, details.
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
    await page.screenshot({ path: "test-results/profiler-fail.png" });
  }
};
const aside = () => page.getByRole("complementary");
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.click("text=Local development");
await page.waitForSelector("text=shop");
await aside()
  .getByRole("button", { name: /^Local development/ })
  .first()
  .hover();
await aside().getByRole("button", { name: "Actions for Local development" }).first().click();
await page.getByRole("menuitem", { name: "Server status" }).click();
const section = page.getByRole("region", { name: "Slow queries (profiler)" });
await check("off by default, with a hint", async () => {
  await section.scrollIntoViewIfNeeded();
  await section.getByText(/The profiler is off for this database/).waitFor();
});
await check("turning it on lists slow operations with index hints", async () => {
  await section.getByRole("combobox", { name: "Profiling level" }).click();
  await page.getByRole("option", { name: "Slow operations" }).click();
  await section.getByText("COLLSCAN").waitFor({ timeout: 8000 });
  await section.getByText("no index used").waitFor();
  await section.getByText("120,000 / 3").waitFor();
  await page.screenshot({ path: "test-results/profiler.png", fullPage: true });
});
await check("a row opens the command and its numbers", async () => {
  await section.getByRole("row").filter({ hasText: "COLLSCAN" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Documents read", { exact: true }).waitFor();
  await dialog.getByText(/email: "ada@example.com"/).waitFor();
  await page.screenshot({ path: "test-results/profiler-entry.png" });
  await dialog.getByRole("button", { name: "Open in the collection" }).click();
  await page.getByRole("tab", { name: /users/ }).waitFor();
  await page
    .getByRole("textbox", { name: "Filter" })
    .getByText(/email: "ada@example.com"/)
    .waitFor();
  await page.screenshot({ path: "test-results/profiler-opened.png" });
  await page
    .getByRole("tab", { name: /Server/ })
    .first()
    .click();
});
await check("read-only connections cannot change the level", async () => {
  await aside()
    .getByRole("button", { name: /^Production \(Atlas\)/ })
    .first()
    .click();
  await page.waitForTimeout(800);
  await aside()
    .getByRole("button", { name: /^Production \(Atlas\)/ })
    .first()
    .hover();
  await aside().getByRole("button", { name: "Actions for Production (Atlas)" }).first().click();
  await page.getByRole("menuitem", { name: "Server status" }).click();
  const level = page
    .getByRole("region", { name: "Slow queries (profiler)" })
    .last()
    .getByRole("combobox", { name: "Profiling level" });
  await level.waitFor();
  await page.waitForTimeout(500);
  if (await level.isEnabled()) throw new Error("level enabled on read-only");
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
