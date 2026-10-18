// Selecting values as text: dragging in the grid, double-clicking in the list view.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  colorScheme: scheme,
  locale: "en-US",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-selection-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const selectedText = () => page.evaluate(() => window.getSelection()?.toString() ?? "");

await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.removeItem("odin-results-view"));
await page.reload();
await page.click("text=Local development");
await page.getByRole("button", { name: /^shop/ }).first().click();
await page.getByRole("button", { name: /^users$/ }).click();
await page.locator("tbody tr").first().waitFor();

await check("dragging over a grid cell selects its text", async () => {
  const cell = page.locator("tbody tr").first().locator("td").first();
  const box = await cell.boundingBox();
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const text = await selectedText();
  if (text.trim().length < 6) throw new Error(`selected "${text}"`);
  await shot("01-grid");
});

await check("Cmd+C leaves selected text to the system, not the row", async () => {
  await page.evaluate(() => navigator.clipboard.writeText("untouched"));
  await page.keyboard.press("Meta+c");
  await page.waitForTimeout(150);
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  if (clipboard.startsWith("{")) throw new Error("copied the row");
});

await check("Cmd+C without text selected still copies the row", async () => {
  await page.locator("tbody tr").nth(1).locator("th").click();
  await page.keyboard.press("Meta+c");
  await page.waitForTimeout(150);
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  if (!clipboard.startsWith("{")) throw new Error(`clipboard "${clipboard}"`);
});

await check("double-clicking _id in the list view selects it", async () => {
  await page.getByRole("radio", { name: "List" }).click();
  const first = page
    .getByRole("listbox", { name: /Documents in users/ })
    .getByRole("option")
    .first();
  await first.waitFor();
  await first.locator("span.selectable").first().dblclick();
  await page.waitForTimeout(200);
  if (await page.getByRole("dialog").isVisible()) throw new Error("opened the editor");
  if ((await selectedText()).trim().length < 6) throw new Error("nothing selected");
  await shot("02-list");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
