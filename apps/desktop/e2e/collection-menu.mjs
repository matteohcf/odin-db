// A collection's sidebar menu: new tab, export and import without opening the collection first.
import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-colmenu2-${name}.png` });
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
const menuFor = async (name) => {
  await tree.getByRole("button", { name: new RegExp(`^${name}$`) }).hover();
  await tree.getByRole("button", { name: `Actions for ${name}` }).click();
};

await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await connect(page);
await page.click("text=shop");

await check("the menu exports a collection", async () => {
  await menuFor("orders");
  await shot("menu");
  await page.getByRole("menuitem", { name: "Export collection…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("heading", { name: "Export orders" }).waitFor();
  await shot("export");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
});

await check("the menu imports into a collection", async () => {
  await menuFor("orders");
  await page.getByRole("menuitem", { name: "Import into collection…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
});

await check("the menu opens a collection in a new tab", async () => {
  await tree.getByRole("button", { name: /^users$/ }).click();
  await page.getByRole("tab", { name: /users/ }).waitFor();
  await menuFor("orders");
  await page.getByRole("menuitem", { name: "Open in new tab" }).click();
  await page.getByRole("tab", { name: /orders/ }).waitFor();
  if ((await page.getByRole("tab", { name: /users/ }).count()) !== 1) throw new Error("replaced");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
