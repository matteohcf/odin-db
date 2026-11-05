// macOS draws its title bar over the content; empty rows hold the traffic lights and move the window (ADR-0062).
import { chromium } from "playwright";
import { connect, sidebarReady } from "./lib/connect.mjs";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  colorScheme: scheme,
  locale: "en-US",
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-titlebar-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const row = () => page.getByTestId("title-bar-row").first();

await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await sidebarReady(page);

await check("without an overlaid title bar there is no title bar row", async () => {
  if (await page.getByTestId("title-bar-row").count()) throw new Error("row shown outside macOS");
});

await page.goto("http://localhost:1420/?titlebar=overlay");
await sidebarReady(page);

await check("the sidebar row holds the traffic lights and moves the window", async () => {
  const sidebarRow = page.getByRole("region", { name: "Sidebar" }).getByTestId("title-bar-row");
  const box = await sidebarRow.boundingBox();
  if (box?.y !== 0 || box?.height !== 36) throw new Error(`row at ${JSON.stringify(box)}`);
  if ((await sidebarRow.getAttribute("data-tauri-drag-region")) !== "deep")
    throw new Error("row is not a drag region");
});

await check("without tabs the main area has a row to move the window by", async () => {
  const main = page.getByRole("main").getByTestId("title-bar-row");
  const box = await main.boundingBox();
  if (box?.y !== 0 || box?.height !== 36) throw new Error(`row at ${JSON.stringify(box)}`);
  await shot("empty");
});

await check("with tabs the tab bar moves the window, level with the sidebar row", async () => {
  await connect(page);
  await page.getByRole("button", { name: /^shop/ }).first().click();
  await page
    .getByRole("button", { name: /^orders/ })
    .first()
    .click();
  const bar = page.locator('[data-tauri-drag-region="deep"]:has([role=tablist])');
  await bar.waitFor();
  if (await page.getByRole("main").getByTestId("title-bar-row").count())
    throw new Error("two rows above the tabs");
  const [a, b] = [await row().boundingBox(), await bar.boundingBox()];
  if (!a || !b || a.y !== b.y || a.height !== b.height)
    throw new Error(`row ${JSON.stringify(a)}, tab bar ${JSON.stringify(b)}`);
  await shot("tabs");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
