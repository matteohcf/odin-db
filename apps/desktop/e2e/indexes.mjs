import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: scheme,
  locale: "en-US",
  permissions: ["clipboard-read", "clipboard-write"],
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-indexes-${name}.png` });
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
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.getByRole("tab", { name: "Indexes" }).click();

await check("unused indexes are flagged", async () => {
  await page
    .getByText(/^Unused since /)
    .first()
    .waitFor();
  await page.waitForTimeout(150);
  await shot("01-indexes");
});

await check("hide and unhide an index", async () => {
  const row = page.locator("tbody tr").nth(1);
  const name = (await row.locator("td").first().innerText()).trim();
  await row.hover();
  await row.getByRole("button", { name: `Hide ${name}` }).click();
  await page.getByText(`${name} is hidden from the query planner.`).waitFor();
  await row.getByText("Hidden", { exact: true }).waitFor();
  await row.hover();
  await row.getByRole("button", { name: `Unhide ${name}` }).click();
  await page.getByText(`${name} is used by the query planner again.`).waitFor();
});

await check("copy an index as a createIndex command", async () => {
  await page.getByRole("button", { name: "Copy the command that creates email_1" }).click();
  await page.getByText("createIndex for email_1 copied").waitFor();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  if (
    !text.startsWith('db.getCollection("users").createIndex({ email: 1 }') ||
    !text.includes("unique: true")
  )
    throw new Error(text);
});
await check("copy every index at once", async () => {
  await page.getByRole("button", { name: "Copy all as createIndex" }).click();
  await page.getByText(/createIndex commands? copied/).waitFor();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  if (text.includes("_id_") || text.split("\n").length < 2) throw new Error(text);
});
await check("create an index, picking its field from suggestions", async () => {
  await page.getByRole("button", { name: "Create index" }).click();
  const dialog = page.getByRole("dialog", { name: "Create index" });
  const keys = dialog.getByRole("textbox", { name: "Keys" });
  await keys.click();
  await page.keyboard.type("{ ag");
  await page.locator(".cm-tooltip-autocomplete").getByText("age", { exact: true }).waitFor();
  await shot("keys-suggestions");
  // Accepting writes "age: " and the brace is already closed.
  await page.keyboard.press("Enter");
  await page.keyboard.type("-1");
  if ((await keys.innerText()).replace(/\s+/g, " ").trim() !== "{ age: -1 }")
    throw new Error(await keys.innerText());
  await dialog.getByRole("button", { name: "Create index" }).click();
  await page.getByRole("row", { name: /age_-1/ }).waitFor();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
