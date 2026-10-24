import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
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
  }
};
await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.click("text=shop");
await page.getByRole("button", { name: /^users$/ }).click();
await page.getByRole("tab", { name: "Schema" }).click();
await check("schema lists fields with presence, types and values", async () => {
  const row = page.locator("tbody tr", { hasText: "plan" }).first();
  await row.waitFor();
  const text = await row.innerText();
  if (!text.includes("100%") || !text.includes("string") || !text.includes('"free"'))
    throw new Error(text);
  await page.locator("tbody tr", { hasText: "city" }).first().waitFor();
  await page.screenshot({ path: `test-results/${scheme}-schema.png` });
});
await check("analyze again resamples", async () => {
  await page.getByRole("button", { name: "Analyze again" }).click();
  await page.locator("tbody tr", { hasText: "plan" }).first().waitFor();
});
await check("a field stored with several types shows how they split", async () => {
  const row = page.getByRole("row", { name: /^score/ });
  await row.getByText("mixed").waitFor();
  await row.getByText("88%").waitFor();
  await row.getByText("13%").waitFor();
});

await check("more values open, and a value shows its documents", async () => {
  const city = page.locator("tbody tr", { hasText: "city" }).first();
  await city.getByRole("button", { name: "+1 more" }).click();
  await city.getByRole("button", { name: "+1 more" }).waitFor({ state: "detached" });
  if ((await city.getByRole("button").count()) !== 7) throw new Error("values not expanded");
  const plan = page.locator("tbody tr", { hasText: "plan" }).first();
  await plan.getByRole("button", { name: '"pro"' }).click();
  await page.getByRole("tab", { name: /Documents/, selected: true }).waitFor();
  const filter = page.getByRole("textbox", { name: "Filter" });
  await filter.getByText('plan: "pro"').waitFor();
  await page.getByText("Linus B.").first().waitFor();
  await page.getByText("Ada A.").waitFor({ state: "detached" });
  await page.screenshot({ path: `test-results/${scheme}-schema-filter.png` });
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
