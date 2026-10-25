// Restored tabs reconnect at launch, unless turned off.
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
    await page.screenshot({ path: `test-results/reconnect-fail-${name.replaceAll(" ", "-")}.png` });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await connect(page);
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();

await check("a restored tab comes back connected", async () => {
  await page.reload();
  await page.locator("tbody tr").first().waitFor({ timeout: 5000 });
  if (await page.getByText("is disconnected").count()) throw new Error("still disconnected");
});
await check("profiles without tabs stay disconnected", async () => {
  const dots = await page.getByRole("complementary").locator(".bg-success").count();
  if (dots !== 1) throw new Error(`${dots} connected profiles`);
});
await check("turning it off leaves restored tabs disconnected", async () => {
  await page.keyboard.press("Meta+,");
  const reconnect = page.getByRole("switch", { name: "Reconnect on launch" });
  await reconnect.click();
  if ((await reconnect.getAttribute("aria-checked")) !== "false") throw new Error("still on");
  await page.reload();
  await page.getByRole("tab", { name: /users/ }).first().click();
  await page.getByText("is disconnected").waitFor();
  await page.waitForTimeout(800);
  if (await page.locator("tbody tr").count()) throw new Error("reconnected anyway");
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
