// Opening and closing many tabs must give memory back.
import { chromium } from "playwright";

const browser = await chromium.launch({
  args: ["--js-flags=--expose-gc", "--enable-precise-memory-info"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const heap = async () => {
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.gc();
  });
  await page.waitForTimeout(300);
  return page.evaluate(() => performance.memory.usedJSHeapSize / 1e6);
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
const tree = page.getByRole("complementary", { name: /Connections/ });
await page.click("text=Tenants cluster");
await tree.getByRole("button", { name: /^archive\b/ }).click();
await tree
  .getByRole("button", { name: /^audit_log\b/ })
  .first()
  .waitFor();
const names = await tree
  .getByRole("button", { name: /^audit_log_\d+/ })
  .evaluateAll((els) => els.slice(0, 20).map((el) => el.textContent.match(/audit_log_\d+/)[0]));
const bar = page.getByRole("tablist", { name: "Open collections" });
const cycle = async () => {
  for (const [i, name] of names.entries()) {
    await tree.getByRole("button", { name: new RegExp(`^${name}\\b`) }).click();
    await bar.getByRole("tab").nth(i).waitFor();
  }
  await page.waitForTimeout(500);
  await bar.getByRole("tab").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close all" }).click();
  await page.getByText("Open a collection").waitFor();
};
const base = await heap();
const samples = [];
for (let round = 0; round < 4; round++) {
  await cycle();
  samples.push(await heap());
}
console.log(
  `base ${base.toFixed(1)} MB, after rounds: ${samples.map((s) => s.toFixed(1)).join(", ")}`,
);
const growth = samples.at(-1) - samples[0];
console.log(
  growth > 15
    ? `FAIL leak: +${growth.toFixed(1)} MB over 3 rounds`
    : `ok   no leak (+${growth.toFixed(1)} MB)`,
);
console.log(JSON.stringify({ errors }));
await browser.close();
