import { chromium } from "playwright";

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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-querycode-${name}.png` });
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
await page.waitForSelector("text=shop");
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();

await check("query code shows the typed filter in every language", async () => {
  const filter = page.getByRole("textbox", { name: "Filter" });
  await filter.click();
  await page.keyboard.type('plan: "pro", age: { $gte: 30 }');
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Query code…" }).click();
  const dialog = page.getByRole("dialog", { name: "Query code" });
  const code = dialog.getByRole("region");
  await page.waitForTimeout(150);
  await dialog.getByRole("radio", { name: "Python" }).click();
  await code.getByText("sort=").count();
  const python = await code.innerText();
  if (!python.includes('"plan": "pro"') || !python.includes('"$gte": 30')) throw new Error(python);
  await shot("01-python");
  for (const [name, needle] of [
    ["mongosh", 'db.getSiblingDB("shop")'],
    ["Node.js", 'import { MongoClient } from "mongodb"'],
    ["Java", "Document.parse"],
    ["C#", "BsonDocument.Parse"],
    ["Go", "bson.UnmarshalExtJSON"],
  ]) {
    await dialog.getByRole("radio", { name, exact: true }).click();
    const text = await code.innerText();
    if (!text.includes(needle)) throw new Error(`${name}: ${text.slice(0, 120)}`);
  }
  await dialog.getByRole("button", { name: "Copy" }).click();
  await dialog.getByRole("button", { name: "Copied" }).waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (!clip.includes("bson.UnmarshalExtJSON")) throw new Error("clipboard");
  await page.keyboard.press("Escape");
});

await check("the chosen language is remembered", async () => {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Query code…" }).click();
  const dialog = page.getByRole("dialog", { name: "Query code" });
  if (
    (await dialog.getByRole("radio", { name: "Go", exact: true }).getAttribute("aria-checked")) !==
    "true"
  )
    throw new Error("not remembered");
  await page.keyboard.press("Escape");
});

await check("an invalid filter shows its error instead", async () => {
  const filter = page.getByRole("textbox", { name: "Filter" });
  await filter.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("plan: ");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Query code…" }).click();
  await page.waitForTimeout(400);
  if (await page.getByRole("dialog", { name: "Query code" }).count())
    throw new Error("opened with an invalid filter");
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
});

await check("aggregation offers the pipeline as code", async () => {
  await page.getByRole("tab", { name: "Aggregation" }).click();
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Query code" });
  const text = await dialog.getByRole("region").innerText();
  if (!text.includes("pipeline")) throw new Error(text.slice(0, 200));
  await page.waitForTimeout(150);
  await shot("02-aggregate");
  await page.keyboard.press("Escape");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
