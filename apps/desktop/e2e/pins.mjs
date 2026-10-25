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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-pins-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const bar = () => page.getByRole("tablist", { name: "Open collections" });
const tabNames = async () =>
  (await bar().getByRole("tab").allInnerTexts()).map((text) => text.trim().split(/\s+/)[0]);
await page.goto("http://localhost:1420/");
await connect(page);
await page.getByRole("button", { name: /^shop/ }).first().click();
for (const name of ["orders", "users"])
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .click();
await page
  .getByRole("button", { name: /^analytics/ })
  .first()
  .click();
await page
  .getByRole("button", { name: /^events/ })
  .first()
  .click()
  .catch(() => {});
await page.getByRole("button", { name: "Backups", exact: true }).click();

await check("pinning moves a tab left and swaps close for a pin", async () => {
  await page.getByRole("tab", { name: /users/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin tab" }).click();
  await page.getByRole("menu").waitFor({ state: "hidden" });
  const names = await tabNames();
  if (names[0] !== "users") throw new Error(names.join(","));
  await page.locator('[aria-label="Unpin users"]').waitFor();
  await page.waitForTimeout(150);
  await shot("01-pinned");
});

await check("close all keeps the pinned tab, Cmd+W spares it", async () => {
  await page.getByRole("tab", { name: /users/ }).click();
  await page.keyboard.press("Meta+w");
  if (!(await tabNames()).includes("users")) throw new Error("closed by keyboard");
  await page.getByRole("tab", { name: /orders/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Close all tabs" }).click();
  await page.getByRole("menu").waitFor({ state: "hidden" });
  const names = await tabNames();
  if (names.length !== 1 || names[0] !== "users") throw new Error(names.join(","));
});

await check("reopen closed tabs with Cmd+Shift+T", async () => {
  await page.keyboard.press("Meta+Shift+t");
  await page.keyboard.press("Meta+Shift+t");
  const names = await tabNames();
  if (names.length !== 3) throw new Error(names.join(","));
});

await check("Cmd+1 and Cmd+9 jump to tabs", async () => {
  await page.keyboard.press("Meta+9");
  const last = await bar().getByRole("tab").last().getAttribute("aria-selected");
  if (last !== "true") throw new Error("Cmd+9");
  await page.keyboard.press("Meta+1");
  if ((await bar().getByRole("tab").first().getAttribute("aria-selected")) !== "true")
    throw new Error("Cmd+1");
});

await check("drag reorders unpinned tabs", async () => {
  const before = await tabNames();
  const lastName = before.at(-1);
  await bar().locator("[data-tab-id]").last().dragTo(bar().locator("[data-tab-id]").nth(1));
  const after = await tabNames();
  if (after[1] !== lastName || after[0] !== "users") throw new Error(after.join(","));
});

await check("move a tab from its menu", async () => {
  const before = await tabNames();
  await bar().getByRole("tab").last().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move left" }).click();
  await page.getByRole("menu").waitFor({ state: "hidden" });
  const after = await tabNames();
  if (after.at(-2) !== before.at(-1)) throw new Error(after.join(","));
});

await check("unpin from the tab", async () => {
  await page.locator('[aria-label="Unpin users"]').click();
  await page.locator('[aria-label="Close users"]').waitFor({ state: "attached" });
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
