// Query bar: autocompletion, history, reset.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-agg-${name}.png` });
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
const options = page.locator(".cm-tooltip-autocomplete li");
const optionLabels = () => options.locator(".cm-completionLabel").allInnerTexts();

await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.click("text=shop");
await page.getByRole("button", { name: /^users$/ }).click();
await page.getByRole("tab", { name: "Aggregation" }).click();
const stage1 = page.getByRole("region", { name: "Stage 1" });
await stage1.locator(".cm-content").waitFor();

await check("$match suggests collection fields", async () => {
  await stage1.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("{ pl");
  await options.first().waitFor();
  const labels = await optionLabels();
  if (!labels.includes("plan")) throw new Error(labels.join(","));
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.keyboard.type('"pro"');
  await stage1
    .getByText(/20 documents|documents?$/)
    .first()
    .waitFor();
});

await check("$group suggests references to the previous stage's fields", async () => {
  await page.getByRole("button", { name: "Add stage" }).first().click();
  const stage2 = page.getByRole("region", { name: "Stage 2" });
  await stage2.getByRole("combobox", { name: "Stage operator" }).click();
  await page.getByPlaceholder("Search stages…").fill("group");
  await page.keyboard.press("Enter");
  await stage2
    .getByRole("combobox", { name: "Stage operator" })
    .filter({ hasText: "$group" })
    .waitFor();
  await stage2.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type('{ _id: "$add');
  await options.first().waitFor();
  const labels = await optionLabels();
  if (!labels.includes("$address.city")) throw new Error(labels.join(","));
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type(", n: { $s");
  await options.first().waitFor();
  const ops = await optionLabels();
  if (!ops.includes("$sum")) throw new Error(ops.join(","));
  await page.waitForTimeout(150);
  await shot("agg-operators");
});

await check("stage after $group only knows the grouped fields", async () => {
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText('{ _id: "$address.city", users: { $sum: 1 } }');
  await page
    .getByRole("region", { name: "Stage 2" })
    .getByText(/documents?$/)
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Add stage", exact: true }).last().click();
  const stage3 = page.getByRole("region", { name: "Stage 3" });
  await stage3.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("{ ");
  let labels = [];
  for (let attempt = 0; attempt < 10 && !labels.includes("users"); attempt++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.keyboard.press("Control+Space");
    await options.first().waitFor();
    labels = await optionLabels();
  }
  if (!labels.includes("users") || labels.includes("email")) throw new Error(labels.join(","));
  await shot("agg-next-stage");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
