// Choosing files: drop them on the window or browse, in the import and restore dialogs.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-file-picker-${name}.png` });
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
const tree = page.getByRole("complementary");
const drag = (hovering) => page.evaluate((h) => window.odinMock.dragFiles(h), hovering);
const drop = (files) => page.evaluate((f) => window.odinMock.dropFiles(f), files);

await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.click("text=Local development");
await page.click("text=shop");
const dialog = page.getByRole("dialog");

await check("a file dropped on the window is previewed", async () => {
  await tree.getByRole("button", { name: /^orders$/ }).hover();
  await tree.getByRole("button", { name: "Actions for orders" }).click();
  await page.getByRole("menuitem", { name: "Import into collection…" }).click();
  await dialog.getByText("Drop a JSON, NDJSON or CSV file here").waitFor();
  await shot("01-empty");
  await drag(true);
  await dialog.getByText("Release to use it").waitFor();
  await shot("02-hovering");
  await drop([{ name: "people.csv" }]);
  await dialog.getByText("people.csv", { exact: true }).waitFor();
  await dialog.getByText("CSV · 5 columns").waitFor();
  await page.waitForTimeout(150);
  await shot("03-selected");
});

await check("what does not fit is refused with a reason", async () => {
  await drop([{ name: "exports", directory: true }]);
  await dialog.getByText("Drop a file here, not a folder.").waitFor();
  await drop([{ name: "notes.txt" }]);
  await dialog.getByText("not a JSON, NDJSON or CSV file").waitFor();
  await shot("04-refused");
  // The file chosen before stays.
  await dialog.getByText("people.csv", { exact: true }).waitFor();
});

await check("a file can be removed and browsed for instead", async () => {
  await dialog.getByRole("button", { name: "Remove people.csv" }).click();
  await dialog.getByRole("button", { name: "Choose file…" }).click();
  await dialog.getByText("customers.csv", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
});

await check("a folder dropped on the database import lists its collections", async () => {
  await tree.getByRole("button", { name: /^shop/ }).first().hover();
  await tree.getByRole("button", { name: "Actions for shop" }).first().click();
  await page.getByRole("menuitem", { name: "Import into database…" }).click();
  await dialog.getByText("Drop a folder of JSON files here").waitFor();
  await drop([{ name: "shop-export", directory: true }]);
  await dialog.getByText("shop-export", { exact: true }).waitFor();
  await dialog.getByText("2 collections to import").waitFor();
  await shot("05-folder");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
});

await check("an archive dropped on the restore dialog is read", async () => {
  await tree
    .getByRole("button", { name: /^Local development/ })
    .first()
    .hover();
  await tree.getByRole("button", { name: "Actions for Local development" }).first().click();
  await page.getByRole("menuitem", { name: "Restore…" }).click();
  await dialog.getByText("Drop a mongodump archive here").waitFor();
  await drop([{ name: "nightly.archive.gz" }]);
  await dialog.getByText("nightly.archive.gz", { exact: true }).waitFor();
  await shot("06-restore");
  await page.keyboard.press("Escape");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
