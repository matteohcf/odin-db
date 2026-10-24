// Connection groups (folders) in the sidebar.
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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-groups-${name}.png` });
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
await page.evaluate(() => localStorage.clear());
await page.reload();
const tree = page.getByRole("complementary", { name: /Connections/ });
const row = (name) => tree.getByRole("button", { name: new RegExp(`^${name}`) }).first();

await check("grouped connections sit in an open folder, listed first", async () => {
  await row("Clients").waitFor();
  const names = await tree
    .locator("li button[aria-expanded]:not([aria-haspopup])")
    .evaluateAll((els) => els.map((el) => el.textContent.trim()));
  if (!names[0]?.startsWith("Clients") || !names[1]?.startsWith("Tenants cluster"))
    throw new Error(names.join(" | "));
  await shot("01-folder");
});
await check("a folder says how many of its connections are open", async () => {
  await row("Tenants cluster").click();
  await row("Clients").getByText("1 connection · 1 open connection").waitFor({ state: "attached" });
  // One visible number: the folder's size.
  const shown = await row("Clients").locator("[aria-hidden]").allInnerTexts();
  if (shown.filter((text) => /\d/.test(text)).length !== 1) throw new Error(shown.join("|"));
  await page.screenshot({
    path: "test-results/group-count.png",
    clip: { x: 0, y: 80, width: 300, height: 80 },
  });
});
await check("disconnect all from the explorer menu", async () => {
  await page.getByRole("button", { name: "Connections menu" }).click();
  await page.getByRole("menuitem", { name: "Disconnect all" }).click();
  await row("Clients")
    .getByText(/open connection/)
    .waitFor({ state: "detached" });
});
await check("a folder collapses and expands", async () => {
  await row("Clients").click();
  await row("Tenants cluster").waitFor({ state: "detached" });
  await row("Clients").click();
  await row("Tenants cluster").waitFor();
});
await check("collapse all folds folders", async () => {
  await page.getByRole("button", { name: "Collapse all" }).click();
  await row("Tenants cluster").waitFor({ state: "detached" });
  await row("Clients").click();
});
await check("setting a group moves a connection into the folder", async () => {
  await tree.getByRole("button", { name: "Actions for Local development" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Group" }).fill("Clients");
  await dialog.getByRole("button", { name: /^Save/ }).click();
  await dialog.waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  const names = await tree
    .locator("li button[aria-expanded]:not([aria-haspopup])")
    .evaluateAll((els) => els.map((el) => el.textContent.trim()));
  if (
    !names[0]?.startsWith("Clients") ||
    !names.slice(1, 3).some((n) => n.startsWith("Local development"))
  )
    throw new Error(names.join(" | "));
  await shot("02-moved");
});
await check("filtering by a group name shows its connections", async () => {
  await page.getByRole("searchbox", { name: "Filter databases and collections" }).fill("clients");
  await row("Local development").waitFor();
  if (await row("Production").count()) throw new Error("unfiltered");
  await page.getByRole("searchbox", { name: "Filter databases and collections" }).fill("");
});
await check("rename a group from its menu", async () => {
  await tree.getByRole("button", { name: "Actions for group Clients" }).click();
  await page.getByRole("menuitem", { name: "Rename group…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Group name" }).fill("Customers");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await row("Customers").waitFor();
  if (await row("Clients").count()) throw new Error("old group still there");
});
await check("new connection in a group starts with it filled in", async () => {
  await tree.getByRole("button", { name: "Actions for group Customers" }).click();
  await page.getByRole("menuitem", { name: "New connection in this group…" }).click();
  const value = await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Group" })
    .inputValue();
  if (value !== "Customers") throw new Error(value);
  await page.keyboard.press("Escape");
});
await check("ungroup moves connections back to the top level", async () => {
  await tree.getByRole("button", { name: "Actions for group Customers" }).click();
  await page.getByRole("menuitem", { name: "Ungroup" }).click();
  await row("Customers").waitFor({ state: "detached" });
  await row("Tenants cluster").waitFor();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
