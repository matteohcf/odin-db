import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
  }
};
await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.click("text=shop");
for (const name of ["users", "orders"])
  await page.getByRole("button", { name: new RegExp(`^${name}$`) }).click();
await page.click("text=analytics");
await page.getByRole("button", { name: /^events$/ }).click();
// Radix hides the page from assistive tech while a menu is open or closing.
const tabs = async () => {
  await page.waitForTimeout(300);
  return page
    .getByRole("tab")
    .filter({ hasText: /users|orders|events/ })
    .count();
};
await check("Ctrl+Tab cycles tabs and Mod+W closes one", async () => {
  await page.getByRole("tab", { name: /users/ }).click();
  await page.keyboard.press("Control+Tab");
  if ((await page.getByRole("tab", { selected: true }).first().innerText()).indexOf("orders") < 0)
    throw new Error("not orders");
  await page.keyboard.press("Control+Shift+Tab");
  if ((await page.getByRole("tab", { selected: true }).first().innerText()).indexOf("users") < 0)
    throw new Error("not users");
});

await check("tab menu closes tabs to the right and others", async () => {
  await page.getByRole("tab", { name: /orders/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close tabs to the right" }).click();
  if ((await tabs()) !== 2) throw new Error(`tabs ${await tabs()}`);
  await page.getByRole("tab", { name: /users/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close other tabs" }).click();
  if ((await tabs()) !== 1) throw new Error(`tabs ${await tabs()}`);
  await page.getByRole("tab", { name: /users/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close all tabs" }).click();
  await page.getByText("Open a collection").waitFor();
});
await page.evaluate(() => localStorage.setItem("odin-mock-empty", "1"));
await page.reload();
await check("first run offers localhost and connects to it", async () => {
  await page.getByText("No connections yet").waitFor();
  await page.screenshot({ path: "test-results/first-run.png" });
  await page.getByRole("button", { name: "Connect to localhost:27017" }).click();
  await page
    .getByRole("button", { name: /^Local/ })
    .first()
    .waitFor();
  await page.getByRole("button", { name: /^shop/ }).waitFor();
});
await page.evaluate(() => localStorage.removeItem("odin-mock-empty"));
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
