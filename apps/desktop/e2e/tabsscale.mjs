// Forty open collection tabs.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: scheme,
  locale: "en-US",
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-tabsscale-${name}.png` });
const check = async (name, fn, budget) => {
  const started = Date.now();
  try {
    await fn();
    const ms = Date.now() - started;
    if (budget && ms > budget) throw new Error(`took ${ms} ms, budget ${budget}`);
    results.push(`ok   ${name} (${ms} ms)`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const tree = page.getByRole("complementary");
const bar = () => page.getByRole("tablist", { name: "Open collections" });
const activeTab = () => bar().getByRole("tab", { selected: true });
const inView = (locator) =>
  locator.evaluate((el) => {
    const bar = el.closest("[role=tablist]").getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return box.left >= bar.left - 1 && box.right <= bar.right + 1;
  });
await page.goto("http://localhost:1420/");
await page.click("text=Tenants cluster");
await tree.getByRole("button", { name: /^archive\b/ }).click();
await tree
  .getByRole("button", { name: /^audit_log\b/ })
  .first()
  .waitFor();
const names = await tree
  .getByRole("button", { name: /^audit_log_\d+/ })
  .evaluateAll((els) => els.slice(0, 40).map((el) => el.textContent.match(/audit_log_\d+/)[0]));

await check("open 40 tabs", async () => {
  for (const [i, name] of names.entries()) {
    await tree.getByRole("button", { name: new RegExp(`^${name}\\b`) }).click();
    await bar().getByRole("tab").nth(i).waitFor();
  }
  const count = await bar().getByRole("tab").count();
  if (count !== names.length) throw new Error(`${count} tabs`);
});
await check("the newest tab is in view", async () => {
  if (!(await inView(activeTab()))) throw new Error("active tab hidden");
});
await check("Cmd+1 scrolls back to the first tab", async () => {
  await page.keyboard.press("Meta+1");
  await page.waitForTimeout(150);
  if (!(await inView(activeTab()))) throw new Error("first tab hidden");
  await shot("01-first");
});
await check(
  "switching tabs stays instant",
  async () => {
    for (let i = 0; i < 10; i++) await page.keyboard.press("Control+Tab");
    await page.waitForTimeout(50);
  },
  800,
);
await check("the mouse wheel scrolls the tab bar", async () => {
  const before = await bar().evaluate((el) => el.scrollLeft);
  await bar().hover();
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(100);
  const after = await bar().evaluate((el) => el.scrollLeft);
  if (after <= before) throw new Error(`${before} -> ${after}`);
});
await check("heap stays bounded", async () => {
  const mb = await page.evaluate(() => performance.memory.usedJSHeapSize / 1e6);
  console.log(`heap ${mb.toFixed(0)} MB`);
  if (mb > 300) throw new Error(`${mb} MB`);
});
await check("the overflow menu lists every tab and switches", async () => {
  await page.getByRole("button", { name: `All ${names.length} open tabs` }).click();
  const items = page.getByRole("menuitem");
  if ((await items.count()) !== names.length) throw new Error(`${await items.count()} items`);
  await items.nth(20).click();
  if (!(await inView(activeTab()))) throw new Error("not scrolled into view");
});
await check("close all tabs", async () => {
  await activeTab().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close all" }).click();
  await page.getByText("Open a collection").waitFor();
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
