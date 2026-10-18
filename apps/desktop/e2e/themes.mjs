// Accent colors, black dark mode, row density.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: "dark",
  locale: "en-US",
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/themes-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const token = (name) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.click("text=Local development");
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();
await page.keyboard.press("Meta+,");
const settings = page.getByRole("tabpanel").filter({ visible: true });
const section = (name) =>
  page
    .getByRole("tabpanel")
    .filter({ visible: true })
    .getByRole("button", { name })
    .first()
    .click();
await section("Appearance");

await check("picking an accent recolors the app", async () => {
  const before = await token("--primary");
  await settings.getByRole("radio", { name: "Teal" }).click();
  const after = await token("--primary");
  if (after === before || after !== "#4fd1c5") throw new Error(`${before} -> ${after}`);
  await shot("01-teal");
});
await check("swatches preview their own color in dark mode", async () => {
  const rose = await settings
    .getByRole("radio", { name: "Rose" })
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  if (!rose.includes("255, 122, 147")) throw new Error(rose);
});
await check("black dark mode", async () => {
  await settings.getByRole("radio", { name: "Black" }).click();
  if ((await token("--background")) !== "#000000") throw new Error(await token("--background"));
  await shot("02-black");
});
await check("the accent survives a reload", async () => {
  await page.reload();
  await page
    .locator("html[data-accent=teal][data-dark-style=black]")
    .waitFor({ state: "attached" });
});
await check("compact rows fit more documents", async () => {
  await page.getByRole("tab", { name: /users/ }).first().click();
  const panel = page.getByRole("tabpanel").filter({ visible: true });
  await panel.locator("tbody tr").first().waitFor();
  const normal = (await panel.locator("tbody tr").first().boundingBox()).height;
  await page.keyboard.press("Meta+,");
  await section("Results");
  await page
    .getByRole("tabpanel")
    .filter({ visible: true })
    .getByRole("radio", { name: "Compact" })
    .click();
  await page.getByRole("tab", { name: /users/ }).first().click();
  await page.waitForTimeout(150);
  const compact = (await panel.locator("tbody tr").first().boundingBox()).height;
  const second =
    (await panel.locator("tbody tr").nth(1).boundingBox()).y -
    (await panel.locator("tbody tr").first().boundingBox()).y;
  if (!(compact < normal) || Math.abs(second - compact) > 1)
    throw new Error(`${normal} -> ${compact}, step ${second}`);
  await shot("03-compact");
});
await check("light theme with an accent", async () => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.keyboard.press("Meta+,");
  const panel = page.getByRole("tabpanel").filter({ visible: true });
  await section("Appearance");
  await panel.getByRole("radio", { name: "Light" }).click();
  await panel.getByRole("radio", { name: "Violet" }).click();
  if ((await token("--primary")) !== "#7c3aed") throw new Error(await token("--primary"));
  await shot("04-light-violet");
  await panel.getByRole("radio", { name: "Indigo" }).click();
  await panel.getByRole("radio", { name: "Graphite" }).click();
  await panel.getByRole("radio", { name: "System" }).click();
  await section("Results");
  await panel.getByRole("radio", { name: "Normal" }).click();
});
await check("a custom monospace font reaches the grid and editors", async () => {
  await page.keyboard.press("Meta+,");
  const panel = page.getByRole("tabpanel").filter({ visible: true });
  await section("Editors and shell");
  await panel.getByRole("combobox", { name: "Monospace font" }).fill("Courier New");
  await page.getByRole("tab", { name: /users/ }).first().click();
  const family = await page
    .locator("[role=grid] tbody .font-mono")
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  if (!family.startsWith('"Courier New"')) throw new Error(family);
  await page.keyboard.press("Meta+,");
  await page
    .getByRole("tabpanel")
    .filter({ visible: true })
    .getByRole("combobox", { name: "Monospace font" })
    .fill("");
  await page.getByRole("tab", { name: /users/ }).first().click();
  const reset = await page
    .locator("[role=grid] tbody .font-mono")
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  if (!reset.startsWith('"IBM Plex Mono"')) throw new Error(reset);
});
await check("compact sidebar rows", async () => {
  const tree = page.getByRole("complementary", { name: /Connections/ });
  const step = async () => {
    const rows = tree.locator("li[data-index]");
    const a = await rows.nth(0).boundingBox();
    const b = await rows.nth(1).boundingBox();
    return b.y - a.y;
  };
  const normal = await step();
  await page.keyboard.press("Meta+,");
  await section("Appearance");
  await page
    .getByRole("tabpanel")
    .filter({ visible: true })
    .getByRole("radio", { name: "Compact" })
    .first()
    .click();
  await page.waitForTimeout(200);
  const compact = await step();
  if (normal !== 29 || compact !== 25) throw new Error(`${normal} -> ${compact}`);
  const button = await tree.locator("li[data-index] button").first().boundingBox();
  if (Math.round(button.height) !== 24) throw new Error(`row ${button.height}`);
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
