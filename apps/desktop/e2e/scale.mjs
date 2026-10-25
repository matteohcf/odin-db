// Large cluster: 320 databases, one with 2,500 collections.
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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-scale-${name}.png` });
const check = async (name, fn, budget) => {
  const started = Date.now();
  try {
    await fn();
    const ms = Date.now() - started;
    if (budget && ms > budget) throw new Error(`took ${ms} ms, budget ${budget}`);
    results.push(`ok   ${name} (${ms} ms)`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const tree = page.getByRole("complementary");
const scroller = () => tree.locator("ul").first().locator("..");
const nodes = () => tree.locator("*").count();
const row = (name) => tree.getByRole("button", { name: new RegExp(`^${name}\\b`) }).first();

await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.evaluate(() => {
  // Sizes and counts in the tree are off by default, like Compass.
  const saved = JSON.parse(localStorage.getItem("odin-settings") ?? '{"state":{},"version":1}');
  saved.state.sidebarSizes = true;
  localStorage.setItem("odin-settings", JSON.stringify(saved));
});
await page.reload();
await sidebarReady(page);
await page.waitForTimeout(500);
// The connection manager opens outside the budget: it times the connect, not the dialog.
await page.keyboard.press("ControlOrMeta+o");
const manager = page.getByRole("dialog", { name: "Connections" });
await manager.getByRole("button", { name: /^Tenants cluster/ }).waitFor();
await check(
  "connect lists 320 databases",
  async () => {
    await manager.getByRole("button", { name: /^Tenants cluster/ }).click();
    // In the DOM: the sidebar stays hidden from roles until the dialog's exit animation ends.
    await page
      .locator("aside")
      .getByText("tenant_001", { exact: true })
      .waitFor({ state: "attached" });
  },
  1200,
);
await check("the connection shows how many databases it has", async () => {
  // Hover swaps the count for the row's actions.
  await page.mouse.move(900, 500);
  const text = await tree
    .getByRole("button", { name: /^Tenants cluster/ })
    .first()
    .innerText();
  if (!text.includes("320")) throw new Error(text);
});
await check("only visible rows are rendered", async () => {
  const count = await nodes();
  if (count > 2500) throw new Error(`${count} DOM nodes`);
});
await check("scrolling reaches the last database", async () => {
  await scroller().evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await row("tenant_319").waitFor({ timeout: 2000 });
  await shot("01-bottom");
  await scroller().evaluate((el) => el.scrollTo(0, 0));
});
await check(
  "expanding 2,500 collections stays fast",
  async () => {
    await row("archive").click();
    await row("audit_log").waitFor();
    const count = await nodes();
    if (count > 2500) throw new Error(`${count} DOM nodes`);
  },
  1000,
);
await check("the last collection is reachable by scrolling", async () => {
  await scroller().evaluate((el) => el.scrollTo(0, el.scrollHeight * 0.6));
  await page.waitForTimeout(100);
  await shot("02-middle");
  const sticky = tree.locator("li[data-sticky]");
  if (!(await sticky.innerText()).startsWith("archive")) throw new Error("no sticky database row");
  const box = await sticky.boundingBox();
  if (!box || box.y > 120) throw new Error(`sticky row at y=${box?.y}`);
  const visible = await tree
    .getByRole("button", {
      name: /^(users|orders|events|invoices|sessions|audit_log|settings)_\d+/,
    })
    .count();
  if (visible < 10) throw new Error(`${visible} collection rows in view`);
  await scroller().evaluate((el) => el.scrollTo(0, 0));
});
await check(
  "filter finds collections across every database",
  async () => {
    await page.evaluate(() => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.odinCalls = {};
      window.__TAURI_INTERNALS__.invoke = (cmd, args, opts) => {
        window.odinCalls[cmd] = (window.odinCalls[cmd] ?? 0) + 1;
        return original(cmd, args, opts);
      };
    });
    await page
      .getByRole("searchbox", { name: "Filter databases and collections" })
      .fill("invoices_35");
    await row("invoices_35").waitFor({ timeout: 5000 });
    const calls = await page.evaluate(() => window.odinCalls);
    if ((calls.list_collections ?? 0) > 2 || calls.list_catalog !== 1)
      throw new Error(JSON.stringify(calls));
    await shot("03-filter");
  },
  5000,
);
await check("opening a filtered collection shows its documents", async () => {
  await row("invoices_35").click();
  await page.locator("[role=grid] tbody tr").first().waitFor();
});
await check("clearing the filter restores the tree", async () => {
  await page.getByRole("button", { name: "Clear the filter" }).click();
  await row("archive").waitFor();
  await row("audit_log").waitFor();
});
await check("collapse all shrinks the tree back", async () => {
  await page.getByRole("button", { name: "Collapse all" }).click();
  await page.waitForTimeout(150);
  if (await tree.getByRole("button", { name: /^audit_log\b/ }).count())
    throw new Error("still expanded");
});

await check("Cmd+K finds a collection in the last tenant", async () => {
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("tenant_319.users");
  await page
    .getByRole("option", { name: /tenant_319\.users/ })
    .first()
    .waitFor({ timeout: 5000 });
  await shot("04-palette");
  await page.keyboard.press("Enter");
  await page.getByRole("tab", { name: /users/ }).first().waitFor();
});
await check("Cmd+K names every kind of tab", async () => {
  await page.keyboard.press("Meta+,");
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("settings");
  await page.getByRole("option", { name: "Settings", exact: true }).waitFor();
  await page.getByRole("option", { name: "Open settings" }).waitFor();
  if (await page.getByRole("option", { name: "Backups", exact: true }).count())
    throw new Error("mislabelled tab");
  await page.keyboard.press("Escape");
});

await check("revealing a collection opened from the palette scrolls the tree to it", async () => {
  await page.getByRole("button", { name: "Collapse all" }).click();
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("tenant_250.invoices");
  await page
    .getByRole("option", { name: /tenant_250\.invoices/ })
    .first()
    .waitFor({ timeout: 5000 });
  await page.keyboard.press("Enter");
  const panel = page.getByRole("tabpanel").filter({ visible: true });
  await panel.getByRole("button", { name: "invoices", exact: true }).click();
  const current = tree.locator("[aria-current=page]");
  await current.waitFor({ timeout: 5000 });
  const box = await current.boundingBox();
  if (!box || box.y < 60 || box.y > 860) throw new Error(`row at y=${box?.y}`);
  await shot("05-revealed");
});
await check("Shift+Cmd+E reveals the active collection", async () => {
  await page.getByRole("button", { name: "Collapse all" }).click();
  await page.locator("[role=grid]").first().focus();
  await page.keyboard.press("Meta+Shift+e");
  await tree.locator("[aria-current=page]").waitFor({ timeout: 5000 });
});

await check("the locate button in the sidebar header reveals the active collection", async () => {
  await page.getByRole("button", { name: "Collapse all" }).click();
  await page.getByRole("button", { name: "Show the open collection in the tree" }).click();
  await tree.locator("[aria-current=page]").waitFor({ timeout: 5000 });
  await shot("06-locate");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
