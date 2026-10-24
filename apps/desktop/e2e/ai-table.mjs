// The AI models table: benchmarks, guide, memory warning, search.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
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
    await page.screenshot({ path: "test-results/ai-table-fail.png" });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByText("Local development").first().waitFor();
await page.keyboard.press("Meta+,");
await page.getByRole("button", { name: "AI assistant" }).click();
const table = page.getByRole("table");
await check("models are a table with accuracy, speed and size", async () => {
  for (const name of ["Model", "Accuracy", "Per query", "Download"])
    await table.getByRole("columnheader", { name }).waitFor();
  const row = table.getByRole("row").filter({ hasText: "Qwen2.5 Coder 1.5B" });
  // The compact layout repeats the numbers under the name, hidden at this width.
  await row.getByText("85%").filter({ visible: true }).waitFor();
  await row.getByText("2.9 s").filter({ visible: true }).waitFor();
  await row.getByText(/best balance of accuracy and speed/).waitFor();
  await page.getByText(/105 test requests/).waitFor();
  await page.screenshot({ path: "test-results/ai-table.png", fullPage: true });
});
await check("a model needing more memory than this computer has is flagged", async () => {
  await table
    .getByRole("row")
    .filter({ hasText: "Qwen3.5 4B" })
    .getByText("needs 16 GB of memory")
    .waitFor();
  if (await table.getByRole("row").filter({ hasText: "Coder 1.5B" }).getByText(/needs/).count())
    throw new Error("1.5B flagged");
});
await check("settings search filters the models", async () => {
  await page.getByRole("searchbox", { name: "Search settings" }).fill("qwen3.5");
  await table.getByText("Qwen3.5 4B").waitFor();
  if (await table.getByText("Qwen2.5 Coder 1.5B").count()) throw new Error("not filtered");
  await page.getByRole("searchbox", { name: "Search settings" }).fill("");
});
await check("dark theme", async () => {
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.screenshot({ path: "test-results/ai-table-dark.png", fullPage: true });
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
