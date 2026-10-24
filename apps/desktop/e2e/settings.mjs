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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-settings-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const mod = "Meta";
await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.waitForSelector("text=shop");

await check("the footer button opens a single settings tab", async () => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).waitFor();
  await page.getByRole("heading", { name: "General", level: 2 }).waitFor();
  await page.keyboard.press(`${mod}+Comma`);
  if ((await page.getByRole("tab").filter({ hasText: "Settings" }).count()) > 1)
    throw new Error("two tabs");
  await shot("01-general");
});

await check("switching to Italian translates the interface and persists", async () => {
  await page.getByLabel("Language").click();
  await page.getByRole("option", { name: "Italiano" }).click();
  await page.getByRole("heading", { name: "Generale", level: 2 }).waitFor();
  await page.getByRole("button", { name: "Aspetto", exact: true }).waitFor();
  await page.reload();
  await page.getByText("Connessioni").first().waitFor();
  await page.getByRole("button", { name: "Impostazioni" }).first().click();
  await page.getByRole("heading", { name: "Generale", level: 2 }).waitFor();
  await shot("02-italian");
  await page.getByLabel("Lingua").click();
  await page.getByRole("option", { name: /^Sistema/ }).click();
  await page.getByRole("heading", { name: "General", level: 2 }).waitFor();
});

await check("zoom from the page and with shortcuts", async () => {
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByLabel("Zoom").click();
  await page.getByRole("option", { name: "125%" }).click();
  const zoom = () => page.evaluate(() => document.documentElement.style.zoom);
  if ((await zoom()) !== "125%") throw new Error(`zoom ${await zoom()}`);
  await shot("03-appearance-zoomed");
  await page.keyboard.press(`${mod}+Minus`);
  if ((await zoom()) !== "110%") throw new Error(`after minus ${await zoom()}`);
  await page.keyboard.press(`${mod}+Digit0`);
  if ((await zoom()) !== "100%") throw new Error(`after reset ${await zoom()}`);
  await page.keyboard.press(`${mod}+Equal`);
  if ((await zoom()) !== "110%") throw new Error(`after plus ${await zoom()}`);
  await page.keyboard.press(`${mod}+Digit0`);
});

await check("theme toggles from settings", async () => {
  await page.getByRole("radio", { name: "Dark" }).click();
  if (!(await page.evaluate(() => document.documentElement.classList.contains("dark"))))
    throw new Error("not dark");
  await page
    .getByRole("radio", { name: scheme === "dark" ? "Dark" : "System", exact: true })
    .click();
});

await check("editor and results pages change their settings", async () => {
  await page.getByRole("button", { name: "Editors and shell" }).click();
  await page.getByLabel("Font size").first().click();
  await page.getByRole("option", { name: "15 px" }).click();
  const font = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--editor-font-size"),
  );
  if (font !== "15px") throw new Error(`font ${font}`);
  await shot("04-editor");
  await page.getByRole("button", { name: "Results" }).click();
  await page.getByLabel("Documents per page").click();
  await page.getByRole("option", { name: "250 documents" }).click();
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem("odin-settings")).state.resultsBatchSize,
  );
  if (stored !== 250) throw new Error(`stored ${stored}`);
  await shot("05-results");
});

await check("data, keyboard and about pages render", async () => {
  await page.getByRole("button", { name: "Data and tools" }).click();
  await page.getByText("100.19.1").waitFor();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByText("Recent queries cleared.").waitFor();
  await shot("06-data");
  await page.getByRole("button", { name: "Keyboard" }).click();
  await page.getByText("Open settings").waitFor();
  await page.getByRole("button", { name: "About" }).click();
  await page.getByText("v0.1.0").waitFor();
  await shot("07-about");
});

await check("reset restores the defaults", async () => {
  await page.getByRole("button", { name: "Reset settings" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reset settings" }).click();
  await page.getByText("Settings reset.").waitFor();
  const font = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue("--editor-font-size"),
  );
  if (font !== "12.5px") throw new Error(`font ${font}`);
});

await check("search finds settings across pages", async () => {
  const panel = page.getByRole("tabpanel").filter({ visible: true });
  await panel.getByRole("searchbox", { name: "Search settings" }).fill("dark");
  await panel.getByText("Dark mode surfaces").waitFor();
  if (await panel.getByText("Language", { exact: true }).count()) throw new Error("unfiltered");
  await panel.getByRole("searchbox", { name: "Search settings" }).fill("delet");
  await panel.getByText("Ask before deleting a document").waitFor();
  if (await panel.getByText("Command palette").count()) throw new Error("shortcuts unfiltered");
  await panel.getByRole("searchbox", { name: "Search settings" }).fill("reopen");
  await panel.getByText("Reopen the closed tab").waitFor();
  await panel.getByRole("searchbox", { name: "Search settings" }).fill("qwertyuiop");
  await panel.getByText("No setting matches “qwertyuiop”.").waitFor();
  await panel.getByRole("searchbox", { name: "Search settings" }).press("Escape");
  await panel.getByText("No setting matches").waitFor({ state: "detached" });
});
await check("sizes in the sidebar are off by default and can be shown", async () => {
  const tree = page.getByRole("complementary", { name: /Connections/ });
  await tree
    .getByRole("button", { name: /^Local development/ })
    .first()
    .click();
  const shop = tree.getByRole("button", { name: /^shop/ }).first();
  await shop.waitFor();
  await page.mouse.move(900, 500);
  if ((await shop.innerText()).includes("kB")) throw new Error("size shown by default");
  await page.keyboard.press("Meta+,");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("switch", { name: "Sizes in the sidebar" }).click();
  await page.mouse.move(900, 500);
  if (!(await shop.innerText()).includes("kB")) throw new Error("size not shown");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
