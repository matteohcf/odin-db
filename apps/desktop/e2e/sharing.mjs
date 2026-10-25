import { chromium } from "playwright";
import { sidebarReady } from "./lib/connect.mjs";

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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-sharing-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const aside = () => page.getByRole("complementary");
// Imported connections are saved, not open: they show in the connection manager (ADR-0058).
const manager = page.getByRole("dialog", { name: "Connections" });
await page.goto("http://localhost:1420/");
await sidebarReady(page);

await check("import connections from a file", async () => {
  await aside().getByRole("button", { name: "Connections menu" }).click();
  await page.waitForTimeout(150);
  await shot("01-menu");
  await page.getByRole("menuitem", { name: "Import connections…" }).click();
  await page.getByText("Imported 2 connections (0 already there).").waitFor();
  await page.getByRole("button", { name: "Open connection…" }).first().click();
  await manager.getByRole("button", { name: /^Staging(?! \()/ }).waitFor();
  await manager.getByRole("button", { name: /^Reporting replica/ }).waitFor();
});

await check("export all or one connection", async () => {
  await manager.getByRole("button", { name: "Connections menu" }).click();
  await page.getByRole("menuitem", { name: "Export all connections…" }).click();
  await page
    .getByText(/Saved to \/Users\/ada\/odin-db-connections\.json/)
    .first()
    .waitFor();
  await manager.getByRole("button", { name: "Actions for Staging", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export…" }).click();
  await page
    .getByText(/Passwords are not included/)
    .first()
    .waitFor();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
