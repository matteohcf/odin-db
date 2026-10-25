import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-jsonview-${name}.png` });
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
await connect(page);
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();

await check("the JSON view shows documents as exact mongosh text", async () => {
  await page.getByRole("radio", { name: "JSON" }).click();
  const list = page.getByRole("listbox");
  await list.getByRole("option").first().waitFor();
  const text = await list.getByRole("option").first().innerText();
  if (!text.includes('_id: ObjectId("65f0a1c30000000000000001")'))
    throw new Error(text.slice(0, 200));
  await page.waitForTimeout(200);
  await shot("01-json");
});

await check("keyboard selection and opening work in the JSON view", async () => {
  const list = page.getByRole("listbox");
  await list.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  if ((await list.getByRole("option", { selected: true }).count()) !== 1)
    throw new Error("no selection");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
});

await check("scrolling loads more documents", async () => {
  const list = page.getByRole("listbox");
  for (let i = 0; i < 12; i++) {
    await list.evaluate((el) => el.scrollBy(0, 4000));
    await page.waitForTimeout(120);
  }
  await page.getByText(/^[2-9]\d\d documents$/).waitFor({ timeout: 8000 });
});

await check("the view choice is remembered", async () => {
  await page.reload();
  await page.getByRole("main").getByRole("button", { name: "Connect" }).click();
  await page.getByRole("listbox").getByRole("option").first().waitFor();
  if ((await page.getByRole("radio", { name: "JSON" }).getAttribute("aria-checked")) !== "true")
    throw new Error("not remembered");
  await page.getByRole("radio", { name: "Table" }).click();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
