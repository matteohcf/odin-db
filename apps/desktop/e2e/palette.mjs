// Query bar: autocompletion, history, reset.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-palette-${name}.png` });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
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

await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.waitForSelector("text=shop");
const palette = page.getByRole("dialog", { name: "Command palette" });
const input = page.getByPlaceholder("Search collections, tabs and actions…");

await check("Cmd+K opens the palette and finds collections by fuzzy name", async () => {
  await page.keyboard.press("ControlOrMeta+k");
  await palette.waitFor();
  await input.fill("ordr");
  await page.getByRole("option", { name: /shop\.orders/ }).waitFor();
  await page.waitForTimeout(250);
  await shot("01-search");
  await page.keyboard.press("Enter");
  await palette.waitFor({ state: "detached" });
  await page.getByRole("tab", { name: /orders/ }).waitFor();
});

await check("the palette switches tabs and lists actions", async () => {
  await page.getByRole("button", { name: "Command palette" }).click();
  await palette.waitFor();
  await page.getByRole("option", { name: /Connect to Production/ }).waitFor();
  await page.getByRole("option", { name: /Open shell on Local development/ }).waitFor();
  await input.fill("dark");
  await page.getByRole("option", { name: "Use dark theme" }).click();
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await page.keyboard.press("ControlOrMeta+k");
  await input.fill("light");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
});

await check("connecting from the palette", async () => {
  await page.keyboard.press("ControlOrMeta+k");
  await input.fill("connect prod");
  await page.getByRole("option", { name: /Connect to Production/ }).click();
  await palette.waitFor({ state: "detached" });
  await page.waitForTimeout(800);
  await page.keyboard.press("ControlOrMeta+k");
  await input.fill("shell prod");
  await page.getByRole("option", { name: /Open shell on Production/ }).waitFor();
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "detached" });
});

await check("nothing matches is explained", async () => {
  await page.keyboard.press("ControlOrMeta+k");
  await input.fill("zzzzqqq");
  await page.getByText("Nothing matches.").waitFor();
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "detached" });
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
