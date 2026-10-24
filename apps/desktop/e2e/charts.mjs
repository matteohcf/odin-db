// Quick charts of loaded results: over time, by category, histogram, scatter, back to the table.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-charts-${name}.png` });
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
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const pick = async (label, option) => {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
const chart = page.locator("[data-slot=chart]");

await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.removeItem("odin-results-view"));
await page.reload();
await page.click("text=Local development");
await page.click("text=shop");
await page.getByRole("button", { name: /^orders$/ }).click();
await page.locator("tbody tr").first().waitFor();

await check("the chart view starts with documents over time", async () => {
  await page.getByRole("radio", { name: "Chart" }).click();
  // Attached, not visible: a flat line has no height.
  await chart.locator(".recharts-line").waitFor({ state: "attached" });
  await page.getByRole("combobox", { name: "By" }).filter({ hasText: "placedAt" }).waitFor();
  await page.getByText(/^From \d+ loaded documents/).waitFor();
  await page.getByText("Count of documents by placedAt").waitFor();
  const box = await chart.boundingBox();
  if (!box) throw new Error("no chart");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.locator(".recharts-tooltip-wrapper").getByText("Count of documents").waitFor();
  await shot("01-time");
});

await check("a category counts, then sums a number", async () => {
  await pick("By", "status");
  await chart.locator(".recharts-bar-rectangle").first().waitFor();
  if ((await chart.locator(".recharts-bar-rectangle").count()) < 2) throw new Error("bars");
  await pick("Value", "total");
  await pick("Aggregate", "Average");
  await page.getByText("Average of total by status").waitFor();
  await shot("02-category");
});

await check("a number alone is a histogram, against another a scatter", async () => {
  await pick("Value", "Count of documents");
  await pick("By", "total");
  await chart.locator(".recharts-bar-rectangle").first().waitFor();
  if (await page.getByRole("combobox", { name: "Aggregate" }).isVisible())
    throw new Error("aggregate on a histogram");
  await shot("03-histogram");
  await pick("Value", "number");
  await chart.locator(".recharts-scatter-symbol").first().waitFor();
  await shot("04-scatter");
});

await check("the table comes back", async () => {
  await page.getByRole("radio", { name: "Table" }).click();
  await page.locator("tbody tr").first().waitFor();
  await chart.waitFor({ state: "detached" });
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
