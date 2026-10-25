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
const sidebar = page.getByRole("complementary", { name: /Connections/ });
// Saved connections and their folders live in the connection manager (ADR-0058).
const tree = page.getByRole("dialog", { name: "Connections" });
const openManager = async () => {
  if (await tree.count()) return;
  await page.keyboard.press("ControlOrMeta+o");
  await tree.waitFor();
};
const row = (name) => tree.getByRole("button", { name: new RegExp(`^${name}`) }).first();
const names = () =>
  tree
    .locator("li button:not([aria-haspopup])")
    .evaluateAll((els) => els.map((el) => el.textContent.trim()));

await check("grouped connections sit in an open folder, listed first", async () => {
  await openManager();
  await row("Clients").waitFor();
  const listed = await names();
  if (!listed[0]?.startsWith("Clients") || !listed[1]?.startsWith("Tenants cluster"))
    throw new Error(listed.join(" | "));
  await shot("01-folder");
});
await check("a folder says how many of its connections are open", async () => {
  await row("Tenants cluster").click();
  await tree.waitFor({ state: "detached" });
  const folder = sidebar.getByRole("button", { name: /^Clients/ }).first();
  await folder.getByText("1 connection · 1 open connection").waitFor({ state: "attached" });
  // One visible number: the folder's size.
  const shown = await folder.locator("[aria-hidden]").allInnerTexts();
  if (shown.filter((text) => /\d/.test(text)).length !== 1) throw new Error(shown.join("|"));
  await page.screenshot({
    path: "test-results/group-count.png",
    clip: { x: 0, y: 80, width: 300, height: 80 },
  });
});
await check("disconnect all from the explorer menu", async () => {
  await page.getByRole("button", { name: "Connections menu" }).click();
  await page.getByRole("menuitem", { name: "Disconnect all" }).click();
  // Every connection stays listed, closed.
  await sidebar.getByRole("button", { name: /^shop/ }).first().waitFor({ state: "detached" });
  await sidebar
    .getByRole("button", { name: /^Local development/ })
    .first()
    .waitFor();
});
await check("a folder collapses and expands", async () => {
  await openManager();
  await row("Clients").click();
  await row("Tenants cluster").waitFor({ state: "detached" });
  await row("Clients").click();
  await row("Tenants cluster").waitFor();
});
await check("collapse all folds folders", async () => {
  await page.keyboard.press("Escape");
  await tree.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Collapse all" }).click();
  await openManager();
  await row("Clients").waitFor();
  await row("Tenants cluster").waitFor({ state: "detached" });
  await row("Clients").click();
});
await check("setting a group moves a connection into the folder", async () => {
  await tree.getByRole("button", { name: "Actions for Local development" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: /Edit connection/ });
  await dialog.getByRole("combobox", { name: "Group" }).fill("Clients");
  await dialog.getByRole("button", { name: /^Save/ }).click();
  await dialog.waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  const listed = await names();
  if (
    !listed[0]?.startsWith("Clients") ||
    !listed.slice(1, 3).some((n) => n.startsWith("Local development"))
  )
    throw new Error(listed.join(" | "));
  await shot("02-moved");
});
await check("filtering by a group name shows its connections", async () => {
  const search = page.getByRole("searchbox", { name: "Search saved connections" });
  await search.fill("clients");
  await row("Local development").waitFor();
  if (await row("Production").count()) throw new Error("unfiltered");
  await search.fill("");
});
await check("rename a group from its menu", async () => {
  await tree.getByRole("button", { name: "Actions for group Clients" }).click();
  await page.getByRole("menuitem", { name: "Rename group…" }).click();
  const dialog = page.getByRole("dialog", { name: /Rename/ });
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
    .getByRole("dialog", { name: /New connection/ })
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
