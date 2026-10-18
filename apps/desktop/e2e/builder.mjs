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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-builder-${name}.png` });
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
const preview = () => page.getByTestId("builder-preview").innerText();

await check("build a typed filter from rows and run it", async () => {
  await page.getByRole("button", { name: "Build a filter visually" }).click();
  await page.getByLabel("Field 1").fill("plan");
  await page.getByLabel("Value 1").fill("team");
  await page.getByRole("button", { name: "Add condition" }).click();
  await page.getByLabel("Field 2").fill("age");
  await page.getByLabel("Operator 2").click();
  await page.getByRole("option", { name: "greater or equal" }).click();
  await page.getByLabel("Value 2").fill("40");
  if ((await preview()) !== '{ plan: "team", age: { $gte: 40 } }') throw new Error(await preview());
  await page.waitForTimeout(150);
  await shot("01-builder");
  await page.getByRole("button", { name: "Apply and run" }).click();
  const filter = await page.getByRole("textbox", { name: "Filter" }).innerText();
  if (!filter.includes('plan: "team", age: { $gte: 40 }')) throw new Error(filter);
  await page.waitForFunction(() =>
    ((rows) =>
      rows.length > 0 &&
      rows.every(
        (r) =>
          r.children[5].textContent.trim() === "team" && Number(r.children[4].textContent) >= 40,
      ))([...document.querySelectorAll("tbody tr")]),
  );
});

await check("any-condition and presence operators", async () => {
  await page.getByRole("button", { name: "Build a filter visually" }).click();
  await page.getByRole("radio", { name: "Any condition" }).click();
  await page.getByLabel("Operator 2").click();
  await page.getByRole("option", { name: "is missing" }).click();
  await page.getByLabel("Field 2").fill("referrer");
  const text = await preview();
  if (text !== '{ $or: [{ plan: "team" }, { referrer: { $exists: false } }] }')
    throw new Error(text);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const filter = await page.getByRole("textbox", { name: "Filter" }).innerText();
  if (!filter.includes("$or")) throw new Error(filter);
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
