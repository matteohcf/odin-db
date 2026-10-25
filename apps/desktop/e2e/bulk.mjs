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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-bulk-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const setFilter = async (text) => {
  await page.getByRole("textbox", { name: "Filter" }).click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  if (text) await page.keyboard.type(text);
  await page.keyboard.press("Escape");
};
await page.goto("http://localhost:1420/");
await connect(page);
await page.waitForSelector("text=shop");
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();

await check("update every matching document with $set", async () => {
  await setFilter('plan: "team"');
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Update matching documents…" }).click();
  const dialog = page.getByRole("dialog", { name: "Update documents" });
  await dialog.getByText(/\d+ documents match\./).waitFor();
  const editor = dialog.getByRole("textbox", { name: "Update" });
  await editor.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type('{ $set: { tier: "gold" ');
  await page.waitForTimeout(200);
  await shot("01-update");
  await dialog.getByRole("button", { name: /^Update \d/ }).click();
  await page.getByText(/Updated [\d,]+ documents/).waitFor();
  await setFilter('tier: "gold"');
  await page.getByRole("button", { name: /^Run/ }).click();
  await page.locator("tbody tr").first().waitFor();
  await page.waitForFunction(() =>
    ((cells) => cells.length > 0 && cells.every((cell) => cell.textContent.trim() === "team"))([
      ...document.querySelectorAll("tbody tr td:nth-child(6)"),
    ]),
  );
  const plans = await page.locator("tbody tr td:nth-child(6)").allInnerTexts();
  if (plans.length === 0 || plans.some((plan) => plan.trim() !== "team"))
    throw new Error(plans.join(","));
});

await check("an update without operators is refused", async () => {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Update matching documents…" }).click();
  const dialog = page.getByRole("dialog", { name: "Update documents" });
  await dialog.getByText(/documents? match/).waitFor();
  await dialog.getByRole("textbox", { name: "Update" }).click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type('{ tier: "x" ');
  await dialog.getByRole("button", { name: /^Update \d/ }).click();
  await dialog
    .getByRole("alert")
    .getByText(/needs operators/)
    .waitFor();
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

await check("deleting everything needs the collection name", async () => {
  await setFilter("");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete matching documents…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete documents" });
  await dialog.getByText("{} — every document").waitFor();
  const submit = dialog.getByRole("button", { name: /^Delete [\d,]+ documents/ });
  await submit.waitFor();
  if (!(await submit.isDisabled())) throw new Error("enabled without confirmation");
  await page.waitForTimeout(150);
  await shot("02-delete-all");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

await check("delete the matching documents", async () => {
  await setFilter('tier: "gold"');
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete matching documents…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete documents" });
  await dialog.getByRole("button", { name: /^Delete [\d,]+ documents?$/ }).click();
  await page.getByText(/Deleted [\d,]+ documents?\./).waitFor();
  await page.getByRole("button", { name: /^Run/ }).click();
  await page
    .getByText(/No documents|0 documents/)
    .first()
    .waitFor();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
