// Query bar: autocompletion, history, reset.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-explain-${name}.png` });
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
const filter = page.getByRole("textbox", { name: "Filter" });

await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.click("text=shop");
await page.getByRole("button", { name: /^users$/ }).click();
await page.waitForSelector("[role=grid] tbody tr");

await check("explain flags a collection scan", async () => {
  await filter.click();
  await page.keyboard.insertText('{ name: "Ada A." }');
  await page.getByRole("button", { name: "Explain query" }).click();
  await page.getByRole("dialog", { name: "Query plan" }).waitFor();
  await page.getByText("Read every document of the collection").waitFor();
  await page.getByText(/An index on the filtered/).waitFor();
  await page.getByRole("button", { name: "Raw explain output" }).click();
  await page.locator("[role=dialog] .cm-content").waitFor();
  await page.waitForTimeout(300);
  await shot("01-collscan");
  await page.keyboard.press("Escape");
});

await check("a collection scan offers the ESR index and opens it prefilled", async () => {
  await filter.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText('{ name: "Ada A.", age: { $gt: 20 } }');
  await page.getByRole("button", { name: "Explain query" }).click();
  const create = page.getByRole("button", { name: /Create index/ });
  await create.waitFor();
  const label = await create.innerText();
  if (!label.includes("{ name: 1, age: 1 }")) throw new Error(label);
  await create.click();
  const dialog = page.getByRole("dialog", { name: /Create index/ });
  await dialog.waitFor();
  await page.waitForTimeout(300);
  await shot("03-create-index");
  const keys = await dialog.getByRole("textbox", { name: "Keys" }).innerText();
  if (!keys.includes("name: 1")) throw new Error(keys);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Documents" }).click();
});

await check("explain shows the index used", async () => {
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await filter.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText('{ plan: "pro" }');
  await page.getByRole("button", { name: "Explain query" }).click();
  await page.getByText("Used the index plan_1_createdAt_-1").waitFor();
  await page.waitForTimeout(300);
  await shot("02-index");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
});

await check("an invalid filter is reported instead of explained", async () => {
  await filter.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("{ plan: ");
  await page.getByRole("button", { name: "Explain query" }).click();
  await page.getByRole("alert").filter({ hasText: "Filter:" }).waitFor();
  if (await page.getByRole("dialog").count()) throw new Error("dialog opened");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
