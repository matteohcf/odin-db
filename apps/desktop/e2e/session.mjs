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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-session-${name}.png` });
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
await page.waitForSelector("text=shop");

await check("tabs come back after a restart, shells excluded", async () => {
  await page.getByRole("button", { name: /^shop/ }).first().click();
  await page
    .getByRole("button", { name: /^orders/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: /^users/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page.getByRole("tab", { name: /users/ }).click();
  await page.reload();
  await page.getByRole("tab", { name: /orders/ }).waitFor();
  await page.getByRole("tab", { name: /Backups/ }).waitFor();
  const selected = await page.getByRole("tab", { selected: true }).innerText();
  if (!selected.includes("users")) throw new Error(`active ${selected}`);
  await page.getByRole("main").getByRole("button", { name: "Connect" }).waitFor();
  await shot("01-restored");
  await page.getByRole("main").getByRole("button", { name: "Connect" }).click();
  await page.locator("tbody tr").first().waitFor();
});

await check("quitting with running operations asks first", async () => {
  await page.evaluate(() => window.odinMock.requestQuit(2));
  const dialog = page.getByRole("alertdialog", { name: "Quit while 2 operations are running?" });
  await dialog.waitFor();
  await shot("02-quit");
  await dialog.getByRole("button", { name: "Keep working" }).click();
  await dialog.waitFor({ state: "hidden" });
  if (await page.evaluate(() => window.odinMockQuit === true)) throw new Error("quit on keep");
  await page.evaluate(() => window.odinMock.requestQuit(1));
  await page
    .getByRole("alertdialog", { name: "Quit while an operation is running?" })
    .getByRole("button", { name: "Quit anyway" })
    .click();
  await page.waitForFunction(() => window.odinMockQuit === true);
});

await check("about shows the platform", async () => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "About" }).click();
  await page.getByText("v0.1.0").waitFor();
  await page.getByText(/browser mock · Tauri mock/).waitFor();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
