// Query bar: autocompletion, history, reset.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-q-${name}.png` });
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
const options = page.locator(".cm-tooltip-autocomplete li");
const optionLabels = () => options.locator(".cm-completionLabel").allInnerTexts();
const filterText = () => filter.innerText();

await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.click("text=shop");
await page.getByRole("button", { name: /^users$/ }).click();
await page.waitForSelector("[role=grid] tbody tr");

await check("the whole field box takes clicks, label included", async () => {
  const box = await filter
    .locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]")
    .boundingBox();
  if (!box) throw new Error("no filter frame");
  for (const x of [box.x + 8, box.x + box.width - 60]) {
    await page.evaluate(
      () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
    );
    await page.mouse.click(x, box.y + box.height / 2);
    if (!(await filter.evaluate((el) => el === document.activeElement))) {
      throw new Error(`click at x=${Math.round(x - box.x)} did not focus the filter`);
    }
  }
});

await check("typing { suggests sampled fields and logical operators", async () => {
  await filter.click();
  await page.keyboard.type("{");
  await options.first().waitFor();
  const labels = await optionLabels();
  if (!labels.includes("_id") || !labels.includes("$or")) throw new Error(labels.join(","));
  await shot("01-fields");
});

await check("typing narrows and Enter inserts the key with a colon", async () => {
  const labels = await optionLabels();
  const field = labels.find((label) => /^[a-z]/.test(label) && !label.includes("."));
  await page.keyboard.type(field.slice(0, 3));
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  const text = await filterText();
  if (!text.startsWith(`{ ${field}:`) || !text.trimEnd().endsWith("}")) throw new Error(text);
  globalThis.field = field;
});

await check("operators inside a field condition with descriptions", async () => {
  await page.keyboard.type("{ $");
  await options.first().waitFor();
  const labels = await optionLabels();
  if (!labels.includes("$gt") || labels.includes("_id")) throw new Error(labels.join(","));
  await page.keyboard.type("ex");
  await page.waitForTimeout(150);
  await shot("02-operators");
  await page.keyboard.press("Enter");
  const text = await filterText();
  if (!/\$exists: true/.test(text)) throw new Error(text);
});

await check("Enter without suggestions runs the query and records history", async () => {
  await page.keyboard.press("Escape");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  const alert = await page.getByRole("alert").count();
  if (alert) throw new Error(await page.getByRole("alert").innerText());
});

await check("value position prefers the field type's constructor", async () => {
  await filter.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("{ _id: Obj");
  await options.first().waitFor();
  await page.waitForTimeout(150);
  const first = (await optionLabels())[0];
  if (first !== "ObjectId") throw new Error(first);
  await page.keyboard.press("Enter");
  const text = await filterText();
  if (!text.includes('ObjectId("")')) throw new Error(text);
  // Quoted dotted paths: typing a quote completes the path inside it.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type('{ "address.ci');
  await options.first().waitFor();
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  const quoted = await filterText();
  if (!quoted.startsWith('{ "address.city": ')) throw new Error(quoted);
  await shot("03-constructor");
});

await check("picking an enum-like field offers its values", async () => {
  await filter.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("{ pla");
  await options.first().waitFor();
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const labels = await optionLabels();
  if (labels.slice(0, 2).join() !== '"free","pro"' && !labels.includes('"pro"'))
    throw new Error(labels.join(","));
  await shot("07-values");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
  const text = await filterText();
  if (!/plan: "\w+"/.test(text)) throw new Error(text);
});

await check("sort suggests fields then directions", async () => {
  await page.getByRole("button", { name: "Options", exact: true }).click();
  const sort = page.getByRole("textbox", { name: "Sort" });
  await sort.click();
  await page.keyboard.type("{");
  await options.first().waitFor();
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+Space");
  await options.first().waitFor();
  const labels = await optionLabels();
  if (labels.join() !== "1,-1") throw new Error(labels.join(","));
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const text = await sort.innerText();
  if (!/: -1/.test(text)) throw new Error(text);
  await shot("04-sort");
});

await check("reset clears the form and shows everything", async () => {
  await page.getByRole("button", { name: "Reset" }).click();
  await page.waitForTimeout(500);
  if ((await filter.locator(".cm-placeholder").count()) !== 1) throw new Error(await filterText());
  if (await page.getByRole("button", { name: "Reset" }).count())
    throw new Error("reset still shown");
});

await check("recent queries are listed and re-run", async () => {
  await page.getByRole("button", { name: "Saved and recent queries" }).click();
  const items = page.locator("[cmdk-item]");
  await items.first().waitFor();
  await page.waitForTimeout(300);
  await shot("05-history");
  const count = await items.count();
  if (count < 1) throw new Error("no entries");
  await items.first().click();
  await page.waitForTimeout(500);
  const text = await filterText();
  if (!text.includes("$exists")) throw new Error(text);
});

await check("a starred query is kept under Saved, even after clearing", async () => {
  await page.getByRole("button", { name: "Saved and recent queries" }).click();
  const item = page.locator("[cmdk-item]").first();
  await item.hover();
  await item.getByRole("button", { name: "Save query" }).click();
  await page.getByText("Saved", { exact: true }).waitFor();
  await page.waitForTimeout(250);
  await shot("06-saved");
  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByText("Recent", { exact: true }).waitFor({ state: "detached" });
  const saved = await page.locator("[cmdk-item]").count();
  if (saved !== 1) throw new Error(`saved items: ${saved}`);
  await page.locator("[cmdk-item]").first().click();
  await page.waitForTimeout(500);
  if (!(await filterText()).includes("$exists")) throw new Error(await filterText());
});

await check("pasted multi-line text stays on one line", async () => {
  await filter.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "{\n  a: 1,\n  b: 2\n}");
    document.activeElement.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
    );
  });
  const text = await filterText();
  if (text.includes("\n") || !text.includes("a: 1, b: 2")) throw new Error(JSON.stringify(text));
});

await check("collation, hint and time limit go with the query", async () => {
  const replace = async (name, text) => {
    await page.getByRole("textbox", { name }).click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Backspace");
    if (text) await page.keyboard.type(text);
    await page.keyboard.press("Escape");
  };
  const collation = page.getByRole("textbox", { name: "Collation" });
  if (!(await collation.isVisible()))
    await page.getByRole("button", { name: "Options", exact: true }).click();
  await replace("Filter", 'plan: "PRO"');
  await page.keyboard.press("Meta+Enter");
  await page.getByText("No documents match this filter.").waitFor();
  await replace("Collation", "locale: 'en', strength: 2");
  await page.keyboard.press("Meta+Enter");
  await page.locator("[role=grid] tbody tr").first().waitFor();
  await page.getByRole("textbox", { name: "Hint" }).waitFor();
  await page.getByRole("textbox", { name: "Max time (ms)" }).fill("1");
  await page.getByRole("button", { name: /^Run/ }).click();
  await page
    .getByText(/operation exceeded time limit/)
    .first()
    .waitFor();
  await page.getByText(/Give it longer in Options → Max time/).waitFor();
  await shot("05-options");
  await page.getByRole("textbox", { name: "Max time (ms)" }).fill("abc");
  await page.getByRole("button", { name: /^Run/ }).click();
  await page.getByRole("alert").getByText("Max time (ms):").waitFor();
  await page.getByRole("textbox", { name: "Max time (ms)" }).fill("");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
