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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-searchsort-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const headerOf = (name) =>
  page.locator("[role=grid] thead th", { hasText: new RegExp(`^${name}\\d?$`) });
const sortText = () => page.getByRole("textbox", { name: "Sort" }).innerText();
await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();

await check("click sorts one column, Shift-click adds another", async () => {
  await headerOf("plan").getByRole("button").first().click();
  await page.waitForFunction(() => document.querySelector("[aria-sort=ascending]"));
  await headerOf("age")
    .getByRole("button")
    .first()
    .click({ modifiers: ["Shift"] });
  if (!(await page.getByRole("textbox", { name: "Sort" }).count()))
    await page.getByRole("button", { name: /Sort and projection/ }).click();
  await page.waitForTimeout(300);
  const text = await sortText();
  if (!text.includes("plan: 1, age: 1")) throw new Error(text);
  const ages = await headerOf("age").innerText();
  if (!ages.includes("2")) throw new Error(`no position: ${ages}`);
  await shot("01-multisort");
  await headerOf("age")
    .getByRole("button")
    .first()
    .click({ modifiers: ["Shift"] });
  await page.waitForFunction(() => document.querySelector("[aria-sort=descending]"));
  await headerOf("plan").getByRole("button").first().click();
  await page.waitForTimeout(300);
  const single = await sortText();
  if (!single.includes("plan: -1") || single.includes("age")) throw new Error(single);
});

await check("distinct values count a field and filter by a pick", async () => {
  await page
    .locator("tbody tr")
    .first()
    .locator("td", { hasText: /^(free|pro|team|enterprise)$/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: /Distinct values of plan/ }).click();
  const dialog = page.getByRole("dialog", { name: "Distinct values of plan" });
  await dialog.getByRole("button", { name: /^pro/ }).waitFor();
  const items = await dialog.getByRole("listitem").count();
  if (items !== 4) throw new Error(`items ${items}`);
  await page.waitForTimeout(150);
  await shot("02-distinct");
  await dialog.getByRole("searchbox").fill("ent");
  if ((await dialog.getByRole("listitem").count()) !== 1) throw new Error("search");
  await dialog.getByRole("button", { name: /enterprise/ }).click();
  await dialog.waitFor({ state: "hidden" });
  const filter = await page.getByRole("textbox", { name: "Filter" }).innerText();
  if (!filter.includes('plan: "enterprise"')) throw new Error(filter);
  await page.waitForFunction(() =>
    ((cells) => cells.length > 0 && cells.every((c) => c.textContent.trim() === "enterprise"))([
      ...document.querySelectorAll("tbody tr td:nth-child(6)"),
    ]),
  );
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
