import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-inline-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
await page.goto("http://localhost:1420/");
await connect(page);
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();
const cell = (row, column) => page.locator("tbody tr").nth(row).locator("td").nth(column);
const input = () => page.getByRole("textbox", { name: "Value" });

await check("double-click edits a number in place and keeps its type", async () => {
  await cell(0, 3).dblclick();
  await input().waitFor();
  if ((await input().inputValue()) !== "18") throw new Error(await input().inputValue());
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("77");
  await page.waitForTimeout(100);
  await shot("01-editing");
  await page.keyboard.press("Enter");
  await page.getByText("age updated").first().waitFor();
  await page.waitForFunction(
    () => document.querySelector("tbody tr td:nth-child(5)")?.textContent?.trim() === "77",
  );
  if (await page.getByRole("dialog").count()) throw new Error("opened the document editor");
});

await check("escape cancels without writing", async () => {
  await cell(0, 1).dblclick();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type('"Nope"');
  await page.keyboard.press("Escape");
  await input().waitFor({ state: "detached" });
  const name = await cell(0, 1).innerText();
  if (name.includes("Nope")) throw new Error("written");
});

await check("invalid syntax keeps the editor open", async () => {
  await cell(0, 1).dblclick();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("not valid ((");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  await input().waitFor();
  await page.keyboard.press("Escape");
});

await check("the row number still opens the whole document", async () => {
  await page.locator("tbody tr").first().locator("th").dblclick();
  await page.getByRole("dialog", { name: "Edit document" }).waitFor();
  await page.keyboard.press("Escape");
});

await check("Tab moves to the next field and Escape returns to the grid", async () => {
  await cell(1, 1).dblclick();
  await input().waitFor();
  const first = await input().inputValue();
  await page.keyboard.press("Tab");
  await page.waitForTimeout(100);
  const second = await input().inputValue();
  if (second === first) throw new Error(`still on ${first}`);
  await page.keyboard.press("Shift+Tab");
  await page.waitForTimeout(100);
  if ((await input().inputValue()) !== first) throw new Error(await input().inputValue());
  if ((await page.getByText(/updated/).count()) > 1)
    throw new Error("tabbing wrote unchanged values");
  await page.keyboard.press("Escape");
  await input().waitFor({ state: "detached" });
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("role"));
  if (focused !== "grid") throw new Error(`focus on ${focused}`);
});

await check("Tab saves a change before moving on", async () => {
  await cell(2, 3).dblclick();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("55");
  await page.keyboard.press("Tab");
  await page.waitForFunction(
    () =>
      document.querySelectorAll("tbody tr")[2]?.querySelectorAll("td")[3]?.textContent?.trim() ===
      "55",
  );
  await input().waitFor();
  await page.keyboard.press("Escape");
});

await check("F2 edits the selected row without the mouse", async () => {
  await page.locator("[role=grid]").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("F2");
  await input().waitFor();
  await shot("02-f2");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowDown");
  const selected = await page.locator("tbody tr[aria-selected=true] th").innerText();
  if (selected.trim() !== "2") throw new Error(`selected ${selected}`);
});

await check("typing null sets null instead of removing the field, and Undo restores", async () => {
  await cell(4, 1).dblclick();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("null");
  await page.keyboard.press("Enter");
  await page.getByText("name updated").first().waitFor();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("tbody tr")[4]?.querySelectorAll("td")[1]?.textContent?.trim() ===
      "null",
  );
  await page.getByRole("button", { name: "Undo" }).first().click();
  await page.getByText("name restored").waitFor();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("tbody tr")[4]?.querySelectorAll("td")[1]?.textContent?.trim() ===
      "Margaret E.",
  );
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
