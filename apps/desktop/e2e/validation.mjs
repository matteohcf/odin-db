import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-validation-${name}.png` });
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

await check("generate a schema from the documents and save it", async () => {
  await page.getByRole("tab", { name: "Validation" }).click();
  const editor = page.getByRole("textbox", { name: "Validator" });
  await editor.waitFor();
  await page.getByRole("button", { name: "Start from the documents" }).click();
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Validator"]')?.textContent?.includes("$jsonSchema"),
  );
  const text = await editor.innerText();
  if (!text.includes('bsonType: "objectId"') || !text.includes("required"))
    throw new Error(text.slice(0, 300));
  await page.getByLabel("On a violation").click();
  await page.getByRole("option", { name: "Accept and log a warning" }).click();
  await page.waitForTimeout(150);
  await shot("01-validation");
  await page.getByRole("button", { name: "Save rules" }).click();
  await page.getByText("Validation rules saved.").waitFor();
});

await check("saved rules load back, invalid syntax is reported", async () => {
  await page.keyboard.press("Meta+w");
  await page
    .getByRole("button", { name: /^users/ })
    .first()
    .click();
  await page.getByRole("tab", { name: "Validation" }).click();
  const editor = page.getByRole("textbox", { name: "Validator" });
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="Validator"]')?.textContent?.includes("$jsonSchema"),
  );
  const action = await page.getByLabel("On a violation").innerText();
  if (!action.includes("Accept and log")) throw new Error(action);
  await editor.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("{ broken: ");
  await page.getByRole("button", { name: "Save rules" }).click();
  await page.getByRole("alert").first().waitFor();
});

await check("views have no validation tab", async () => {
  await page
    .getByRole("button", { name: /^active_users/ })
    .first()
    .click();
  await page.getByRole("tab", { name: "Documents" }).last().waitFor();
  const tabs = await page
    .locator("[role=tabpanel]:not([hidden]) [role=tablist] [role=tab]")
    .allInnerTexts();
  if (tabs.some((tab) => tab.includes("Validation"))) throw new Error(tabs.join(","));
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
