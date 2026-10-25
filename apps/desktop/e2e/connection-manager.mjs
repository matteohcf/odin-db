// Connection manager: saved connections live in a dialog, the sidebar holds open ones (ADR-0058).
import { chromium } from "playwright";

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

await check("the sidebar starts without saved connections", async () => {
  await sidebar.getByText("No open connections").waitFor();
  await sidebar.getByText("Your 4 saved connections").waitFor();
  if (await sidebar.getByText("Production (Atlas)").count()) throw new Error("listed in sidebar");
  await shot("01-empty");
});

await check("the shortcut opens every saved connection, grouped", async () => {
  await page.keyboard.press("ControlOrMeta+o");
  await row("Local development").waitFor();
  await manager.getByRole("button", { name: /^Clients/ }).waitFor();
  for (const name of ["Tenants cluster", "Production \\(Atlas\\)", "Staging \\(bastion\\)"]) {
    await row(name).waitFor();
  }
  await manager.getByText("localhost:27017").waitFor();
  await shot("02-manager");
});

await check("search narrows the list and Enter connects the first match", async () => {
  const search = page.getByRole("searchbox", { name: "Search saved connections" });
  await search.fill("local");
  if ((await manager.locator("li").count()) !== 1) throw new Error("not narrowed");
  await search.press("Enter");
  await manager.waitFor({ state: "detached" });
  await sidebar.getByRole("button", { name: /^shop/ }).waitFor();
  if (await sidebar.getByText("Production (Atlas)").count()) throw new Error("unconnected shown");
  await shot("03-connected");
});

await check("an open connection is marked, and picking it closes the manager", async () => {
  await page.getByRole("button", { name: "Open connection…" }).first().click();
  await row("Local development").getByText("Connected").waitFor();
  await row("Local development").click();
  await manager.waitFor({ state: "detached" });
});

await check("a row's menu edits the profile over the manager", async () => {
  await page.getByRole("button", { name: "Open connection…" }).first().click();
  await manager.getByRole("button", { name: "Actions for Production (Atlas)" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByRole("dialog", { name: /Edit connection/ }).waitFor();
  await shot("04-edit");
  await page.keyboard.press("Escape");
  await manager.waitFor();
  await page.keyboard.press("Escape");
  await manager.waitFor({ state: "detached" });
});

await check("disconnecting takes the connection out of the sidebar", async () => {
  await sidebar.getByRole("button", { name: "Actions for Local development" }).click();
  await page.getByRole("menuitem", { name: "Disconnect" }).click();
  await sidebar.getByText("No open connections").waitFor();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
