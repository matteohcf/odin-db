import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: scheme,
  locale: "en-US",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-multiselect-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const rows = () => page.locator("tbody tr");
const selectedCount = () => page.locator('tbody tr[aria-selected="true"]').count();
await page.goto("http://localhost:1420/");
await connect(page);
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await rows().first().waitFor();

await check("Shift-click selects a range, Cmd-click toggles", async () => {
  await rows().nth(1).click();
  await rows()
    .nth(4)
    .click({ modifiers: ["Shift"] });
  if ((await selectedCount()) !== 4) throw new Error(`range ${await selectedCount()}`);
  await rows()
    .nth(6)
    .click({ modifiers: ["Meta"] });
  await rows()
    .nth(2)
    .click({ modifiers: ["Meta"] });
  if ((await selectedCount()) !== 4) throw new Error(`toggle ${await selectedCount()}`);
  await page.getByRole("status").filter({ hasText: "4 selected" }).waitFor();
  await page.waitForTimeout(100);
  await shot("01-selection");
});

await check("copy the selected documents as a shell array", async () => {
  await rows().nth(3).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy 4 documents" }).click();
  await page.getByRole("menuitem", { name: /mongosh syntax/ }).click();
  await page.getByText("Copied to clipboard").last().waitFor();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  if (!text.trim().startsWith("[") || (text.match(/_id: ObjectId/g) ?? []).length !== 4)
    throw new Error(text.slice(0, 200));
});

await check("Shift+Arrow extends and Escape collapses the selection", async () => {
  await rows().nth(0).click();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  if ((await selectedCount()) !== 3) throw new Error(`keys ${await selectedCount()}`);
  await page.keyboard.press("Escape");
  if ((await selectedCount()) !== 1) throw new Error(`escape ${await selectedCount()}`);
});

await check("compare two selected documents field by field", async () => {
  await rows().nth(1).click();
  await rows()
    .nth(2)
    .click({ modifiers: ["Shift"] });
  await rows().nth(2).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Compare the 2 documents" }).click();
  const dialog = page.getByRole("dialog", { name: "Compare documents" });
  await dialog.getByText(/fields differ/).waitFor();
  const changed = await dialog.locator("tr[data-status=changed] td:first-child").allInnerTexts();
  if (!changed.includes("_id") || !changed.includes("name")) throw new Error(changed.join(","));
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/light-compare.png" });
  await dialog.getByRole("switch", { name: "Only differences" }).click();
  const same = await dialog.locator("tr[data-status=same]").count();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  if (same === 0) throw new Error("equal fields hidden");
});

await check("update the selected documents through the bulk dialog", async () => {
  await rows().nth(0).click();
  await rows()
    .nth(1)
    .click({ modifiers: ["Shift"] });
  await rows().nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Update 2 documents…" }).click();
  const dialog = page.getByRole("dialog", { name: "Update documents" });
  await dialog.getByText("2 documents match.").waitFor();
  await dialog.getByRole("textbox", { name: "Update" }).click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type('{ $set: { name: "Bulk picked" ');
  await dialog.getByRole("button", { name: /^Update 2/ }).click();
  await page.getByText(/Updated 2 documents/).waitFor();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("tbody tr")]
        .slice(0, 3)
        .map((row) => row.querySelectorAll("td")[1]?.textContent?.includes("Bulk picked"))
        .join() === "true,true,false",
  );
});

await check("delete the selected documents through the bulk dialog", async () => {
  await rows().nth(0).click();
  await rows()
    .nth(2)
    .click({ modifiers: ["Shift"] });
  await rows().nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete 3 documents…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete documents" });
  await dialog.getByText("3 documents match.").waitFor();
  await dialog.getByRole("button", { name: "Delete 3 documents" }).click();
  await page.getByText("Deleted 3 documents.").waitFor();
  await page.waitForFunction(() =>
    document.querySelector("tbody tr td")?.textContent?.includes("65f0a1c6"),
  );
});

await check("copy one document as plain JSON", async () => {
  await rows().nth(0).click();
  await rows().nth(0).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy as" }).click();
  await page.getByRole("menuitem", { name: /^JSON/ }).click();
  // The JSON conversion loads on first use, so the copy lands a moment later.
  await page.waitForFunction(async () => (await navigator.clipboard.readText()).startsWith("{"));
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const parsed = JSON.parse(text);
  if (typeof parsed._id !== "string" || typeof parsed.age !== "number")
    throw new Error(text.slice(0, 200));
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
