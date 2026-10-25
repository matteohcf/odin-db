import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: scheme,
  locale: "en-US",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-sql-${name}.png` });
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
const openSql = async () => {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Query with SQL…" }).click();
  return page.getByRole("dialog", { name: "Query with SQL" });
};

await check("a SELECT becomes the query bar's query", async () => {
  const dialog = await openSql();
  await dialog
    .getByRole("region", { name: "MongoDB query" })
    .getByText('{ age: { $gte: 30 }, plan: { $in: ["pro", "team"] } }')
    .waitFor();
  await page.waitForTimeout(150);
  await shot("01-find");
  await dialog.getByRole("button", { name: "Use in the query bar" }).click();
  const filter = await page.getByRole("textbox", { name: "Filter" }).innerText();
  if (!filter.includes("$gte: 30")) throw new Error(filter);
  await page.waitForFunction(() =>
    ((rows) =>
      rows.length > 0 &&
      rows.every(
        (r) =>
          Number(r.children[4].textContent) >= 30 &&
          ["pro", "team"].includes(r.children[5].textContent.trim()),
      ))([...document.querySelectorAll("tbody tr")]),
  );
});

await check("errors are explained while typing", async () => {
  const dialog = await openSql();
  await dialog.getByLabel("SQL query").fill("SELECT name FROM users WHERE age");
  await dialog
    .getByRole("alert")
    .getByText(/expected a comparison/)
    .waitFor();
  if (!(await dialog.getByRole("button", { name: "Use in the query bar" }).isDisabled()))
    throw new Error("enabled");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

await check("GROUP BY offers the pipeline to copy", async () => {
  const dialog = await openSql();
  await dialog
    .getByLabel("SQL query")
    .fill("SELECT plan, COUNT(*) AS users FROM orders GROUP BY plan ORDER BY users DESC");
  await dialog.getByText("The query names orders; it runs on users").waitFor();
  await dialog
    .getByText('{ $group: { _id: "$plan", users: { $sum: 1 } } }', { exact: false })
    .waitFor();
  await page.waitForTimeout(150);
  await shot("02-group");
  await dialog.getByRole("button", { name: "Copy pipeline" }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (!clip.includes("$group")) throw new Error(clip);
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
