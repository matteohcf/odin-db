import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:1420/");
await page.waitForTimeout(600);
const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
try {
  await page.keyboard.press("ControlOrMeta+/");
  await dialog.waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/shortcuts.png" });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Search collections, tabs and actions…").fill("keyboard");
  await page.keyboard.press("Enter");
  await dialog.waitFor();
  console.log("ok   shortcuts overview from Mod+/ and the palette");
} catch (error) {
  console.log(`FAIL shortcuts: ${String(error).split("\n")[0]}`);
}
console.log(JSON.stringify({ errors }));
await browser.close();
