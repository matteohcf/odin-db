import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-dbtransfer-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const menuFor = async (name) => {
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .hover();
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
};
await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.waitForSelector("text=shop");

const exportShop = async () => {
  await menuFor("shop");
  await page.getByRole("menuitem", { name: "Export database…" }).click();
  const dialog = page.getByRole("dialog", { name: "Export database" });
  await dialog.getByRole("button", { name: "Choose folder and export" }).click();
  await dialog.getByText(/Exported \d+ collections/).waitFor({ timeout: 10000 });
  await dialog.getByRole("button", { name: "Close" }).last().click();
};
const sent = () => page.evaluate(() => window.odinNotifications ?? []);
await check("no notification while odin-db has focus", async () => {
  await exportShop();
  if ((await sent()).length) throw new Error(JSON.stringify(await sent()));
});
await check("a notification when an export ends in the background", async () => {
  await page.evaluate(() => {
    document.hasFocus = () => false;
  });
  await exportShop();
  const [notice] = await sent();
  if (notice?.title !== "Export database" || notice?.body !== "Finished.")
    throw new Error(JSON.stringify(notice));
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
