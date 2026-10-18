// Functional checks for odin-db flows against the mock backend.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
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
    await page.screenshot({ path: `test-results/fail-${name.replaceAll(" ", "-")}.png` });
  }
};
const status = () => page.locator("footer").last().innerText();

await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.click("text=shop");
await page.getByRole("button", { name: /^users$/ }).click();
await page.waitForSelector("[role=grid] tbody tr");

await check("infinite scroll loads the next page", async () => {
  const grid = page.locator("[role=grid]").locator("..");
  for (let i = 0; i < 4; i++) {
    await grid.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(400);
  }
  const text = await status();
  if (!/[2-9]\d\d documents|1,\d{3} documents/.test(text)) throw new Error(`status: ${text}`);
});

await check("keyboard navigation selects rows", async () => {
  await page.locator("[role=grid]").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  const selected = await page.locator("[role=grid] tbody tr[aria-selected=true] th").innerText();
  if (selected.trim() !== "2") throw new Error(`selected row ${selected}`);
});

await check("edit and save a document", async () => {
  await page.keyboard.press("Enter");
  await page.waitForSelector("role=dialog");
  const editor = page.locator("[role=dialog] .cm-content");
  await editor.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText('{ name: "Edited by test", age: 99 }');
  await page
    .getByRole("dialog")
    .getByText(/changes:/)
    .waitFor();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForSelector("text=Document saved");
  await page.waitForTimeout(500);
  const grid = await page.locator("[role=grid]").innerText();
  if (!grid.includes("Edited by test")) throw new Error("edited value not in grid");
});

await check("invalid syntax is reported inline", async () => {
  await page.getByRole("button", { name: "Insert document" }).first().click();
  await page.waitForSelector("role=dialog");
  await page.locator("[role=dialog] .cm-content").click();
  await page.keyboard.insertText("name: oops");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.waitForSelector("role=dialog >> role=alert");
  await page.keyboard.press("Escape");
  // Unsaved edits are confirmed before the editor closes.
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
});

await check("insert a document", async () => {
  await page.getByRole("button", { name: "Insert document" }).first().click();
  await page.waitForSelector("role=dialog");
  await page.locator("[role=dialog] .cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText('{ name: "Inserted by test" }');
  await page.keyboard.press("Meta+Enter");
  await page.waitForSelector("text=Document inserted");
});

await check("filter finds the inserted document", async () => {
  await page.getByRole("textbox", { name: "Filter" }).fill('{ name: "Inserted by test" }');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  const text = await status();
  if (!text.startsWith("1 document")) throw new Error(`status: ${text}`);
});

await check("delete with confirmation", async () => {
  await page.locator("[role=grid]").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Delete");
  await page.getByRole("button", { name: "Delete document" }).click();
  await page.waitForSelector("text=Document deleted");
  await page.waitForTimeout(500);
  await page.waitForSelector("text=No documents match this filter.");
});

await check("count matches", async () => {
  await page.getByRole("textbox", { name: "Filter" }).fill('{ plan: "pro" }');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Count matches" }).click();
  await page.waitForSelector("text=/matches in total/");
});

await check("bad filter shows an error and keeps results", async () => {
  await page.getByRole("textbox", { name: "Filter" }).fill("{ plan: ");
  await page.keyboard.press("Enter");
  await page.waitForSelector("text=Filter:");
});

await check("close tab with keyboard", async () => {
  await page.locator("[role=grid]").focus();
  await page.keyboard.press("Meta+w");
  await page.waitForSelector("text=Open a collection");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
