// Update check at launch and from settings.
import { chromium } from "playwright";
import { sidebarReady } from "./lib/connect.mjs";

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
    await page.screenshot({ path: "test-results/updates-fail.png" });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await sidebarReady(page);
await check("no update, no toast; settings says up to date", async () => {
  await page.waitForTimeout(800);
  if (await page.getByText(/is available/).count()) throw new Error("toast shown");
  await page.keyboard.press("Meta+,");
  await page
    .getByRole("tabpanel")
    .filter({ visible: true })
    .getByRole("button", { name: "About" })
    .click();
  await page.getByText("odin-db is up to date").waitFor();
});
await check("an available update is offered at launch and installs with progress", async () => {
  await page.evaluate(() => localStorage.setItem("odin-mock-update", "1"));
  await page.reload();
  await page.getByText("odin-db 0.2.0 is available").first().waitFor();
  await page.getByRole("button", { name: "Install and restart" }).first().click();
  await page.getByText(/Installing odin-db 0\.2\.0… \d+%/).waitFor();
  await page.screenshot({ path: "test-results/updates-installing.png" });
});
await check("turning the launch check off keeps it quiet", async () => {
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("odin-settings") ?? '{"state":{},"version":1}');
    s.state.checkForUpdates = false;
    localStorage.setItem("odin-settings", JSON.stringify(s));
  });
  await page.reload();
  await sidebarReady(page);
  await page.waitForTimeout(800);
  if (await page.getByText(/is available/).count()) throw new Error("toast shown");
  await page.evaluate(() => localStorage.removeItem("odin-mock-update"));
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
