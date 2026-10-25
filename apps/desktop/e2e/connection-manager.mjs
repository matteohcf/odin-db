// The sidebar lists every saved connection; the manager (Mod+O) connects from a search (ADR-0059).
import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-cm-${name}.png` });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
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
const sidebar = page.locator("aside");
const manager = page.getByRole("dialog", { name: "Connections" });
const row = (name) => manager.getByRole("button", { name: new RegExp(`^${name}`) });

await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();

const profileRow = (name) =>
  sidebar.getByRole("button", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) }).first();
const isOpen = async (name) => (await profileRow(name).getAttribute("aria-expanded")) === "true";

await check("the sidebar lists every saved connection, none open", async () => {
  for (const name of [
    "Local development",
    "Tenants cluster",
    "Production (Atlas)",
    "Staging (bastion)",
  ]) {
    await profileRow(name).waitFor();
  }
  if (await sidebar.getByRole("button", { name: /^shop/ }).count())
    throw new Error("databases shown");
  await shot("01-sidebar");
});

await check("clicking a connection connects and expands it", async () => {
  await profileRow("Local development").click();
  await sidebar.getByRole("button", { name: /^shop/ }).waitFor();
  if (!(await isOpen("Local development"))) throw new Error("not expanded");
  // The others stay listed, closed.
  if (await isOpen("Production (Atlas)")) throw new Error("another one opened");
});

await check("the shortcut opens every saved connection, grouped", async () => {
  await page.keyboard.press("ControlOrMeta+o");
  await row("Local development").waitFor();
  await manager.getByRole("button", { name: /^Clients/ }).waitFor();
  for (const name of ["Tenants cluster", "Production \\(Atlas\\)", "Staging \\(bastion\\)"]) {
    await row(name).waitFor();
  }
  await row("Local development").getByText("Connected").waitFor();
  await shot("02-manager");
});

await check("search narrows the list and Enter connects the first match", async () => {
  const search = page.getByRole("searchbox", { name: "Search saved connections" });
  await search.fill("prod");
  if ((await manager.locator("li").count()) !== 1) throw new Error("not narrowed");
  await search.press("Enter");
  await manager.waitFor({ state: "detached" });
  await page.waitForFunction(
    (element) => element?.getAttribute("aria-expanded") === "true",
    await profileRow("Production (Atlas)").elementHandle(),
  );
});

await check("a row's menu edits the profile over the manager", async () => {
  await page.keyboard.press("ControlOrMeta+o");
  await manager.getByRole("button", { name: "Actions for Production (Atlas)" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByRole("dialog", { name: /Edit connection/ }).waitFor();
  await shot("04-edit");
  await page.keyboard.press("Escape");
  await manager.waitFor();
  await page.keyboard.press("Escape");
  await manager.waitFor({ state: "detached" });
});

await check("disconnecting keeps the connection listed, closed and without its dot", async () => {
  await profileRow("Local development").hover();
  await sidebar.getByRole("button", { name: "Actions for Local development" }).click();
  await page.getByRole("menuitem", { name: "Disconnect" }).click();
  await sidebar.getByRole("button", { name: /^shop/ }).first().waitFor({ state: "detached" });
  await profileRow("Local development").waitFor();
  if (await isOpen("Local development")) throw new Error("still expanded");
  if (await sidebar.getByText("Couldn't load").count()) throw new Error("error row shown");
  await shot("05-disconnected");
});

await check("a connection the backend lost stops showing as open", async () => {
  await connect(page, "Local development");
  await sidebar.getByRole("button", { name: /^shop/ }).first().click();
  await sidebar
    .getByRole("button", { name: /^users$/ })
    .first()
    .click();
  await page.waitForSelector("[role=grid] tbody tr");
  // As if the server restarted: the backend forgets the connection, the UI does not know.
  await page.evaluate(() => globalThis.odinMockDropConnections());
  // A command on it fails, without anything new reading the connections list.
  await page.getByRole("button", { name: "Count matches" }).click();
  await sidebar.getByRole("button", { name: /^shop/ }).first().waitFor({ state: "detached" });
  if (await isOpen("Local development")) throw new Error("still shown as open");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
