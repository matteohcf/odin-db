// Query bar: autocompletion, history, reset.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-field-${name}.png` });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
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
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};

await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.click("text=shop");
await page.getByRole("button", { name: /^users$/ }).click();
await page.waitForSelector("[role=grid] tbody tr");
const cellOf = async (column) => {
  // Columns out of view are not rendered: scroll until the header exists.
  const scroller = page.locator("[role=grid]").locator("..");
  for (let i = 0; i <= 10; i++) {
    const found = await page
      .locator("[role=grid] thead th")
      .evaluateAll((ths, name) => ths.some((th) => th.textContent.trim() === name), column);
    if (found) break;
    await scroller.evaluate((el, f) => el.scrollTo(el.scrollWidth * f, el.scrollTop), i / 10);
    await page.waitForTimeout(50);
  }
  const index = await page
    .locator("[role=grid] thead th")
    .evaluateAll((ths, name) => ths.findIndex((th) => th.textContent.trim() === name), column);
  return page.locator("[role=grid] tbody tr").first().locator("th, td").nth(index);
};

await check("edit a field keeping its type", async () => {
  await (await cellOf("loginCount")).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit loginCount value…" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit loginCount" });
  await dialog.waitFor();
  await dialog.getByText("Current type: Number").waitFor();
  const editor = dialog.getByRole("textbox", { name: "Value" });
  const before = await editor.innerText();
  if (!before.includes("Long")) throw new Error(before);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText('Long("42")');
  await page.waitForTimeout(150);
  await shot("01-edit-field");
  await page.keyboard.press("Enter");
  await dialog.waitFor({ state: "detached" });
  await page.waitForTimeout(600);
  const cell = await (await cellOf("loginCount")).innerText();
  if (cell.trim() !== "42") throw new Error(cell);
  await (await cellOf("loginCount")).hover();
  const title = await (await cellOf("loginCount")).locator("span").first().getAttribute("title");
  if (!title?.includes('Long("42")')) throw new Error(`title ${title}`);
});

await check("invalid values are explained in the dialog", async () => {
  await (await cellOf("name")).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit name value…" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit name" });
  await dialog.getByRole("textbox", { name: "Value" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("ObjectId(");
  await page.keyboard.press("Enter");
  await dialog.getByRole("alert").waitFor();
  await page.keyboard.press("Escape");
});

await check("remove a field", async () => {
  await (await cellOf("referrer")).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit referrer value…" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit referrer" });
  await dialog.getByRole("button", { name: "Remove field" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.getByText("referrer removed").waitFor();
});

await check("the document editor suggests fields and their values", async () => {
  await page.getByRole("button", { name: "Insert document" }).click();
  const dialog = page.getByRole("dialog", { name: "Insert document" });
  await dialog.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("{ pl");
  await page.locator(".cm-tooltip-autocomplete li").first().waitFor();
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const labels = await page
    .locator(".cm-tooltip-autocomplete li .cm-completionLabel")
    .allInnerTexts();
  if (!labels.includes('"pro"')) throw new Error(labels.join(","));
  await shot("02-editor-values");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
});

await check("_id cannot be edited on its own", async () => {
  await (await cellOf("_id")).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Copy _id value/ }).waitFor();
  if (await page.getByRole("menuitem", { name: /Edit _id/ }).count()) throw new Error("offered");
  await page.keyboard.press("Escape");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
