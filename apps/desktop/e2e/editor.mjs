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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-editor-${name}.png` });
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
await page.locator("tbody tr").first().waitFor();
const editor = () => page.getByRole("dialog").getByRole("textbox", { name: "Document" });

await check("live validation flags broken syntax", async () => {
  await page.locator("tbody tr").first().locator("th").dblclick();
  await editor().waitFor();
  await page.getByRole("dialog").getByText("Valid document").waitFor();
  await editor().click();
  await page.keyboard.press("Meta+End");
  await page.keyboard.type(",,");
  await page
    .getByRole("dialog")
    .getByRole("status")
    .filter({ hasNotText: "Valid document" })
    .waitFor();
  await page.waitForTimeout(150);
  await shot("01-invalid");
});

await check("closing with unsaved edits asks first", async () => {
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("alertdialog", { name: "Discard your changes?" });
  await confirm.waitFor();
  await confirm.getByRole("button", { name: "Keep editing" }).click();
  await editor().waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
});

await check("format tidies a document typed on one line", async () => {
  await page.getByRole("button", { name: "Insert document" }).click();
  await editor().click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type('{ name: "Zed", tags: ["a", "b"], age: 3 ');
  await page.getByRole("dialog").getByRole("button", { name: "Format" }).click();
  await page.waitForFunction(() => document.querySelectorAll("[role=dialog] .cm-line").length >= 6);
  await page.getByRole("dialog").getByText("Valid document").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Insert" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
});

await check("an untouched document closes without asking", async () => {
  await page.locator("tbody tr").first().locator("th").dblclick();
  await editor().waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 3000 });
  if (await page.getByRole("alertdialog").count()) throw new Error("asked");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
