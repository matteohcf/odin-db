import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-backups-${name}.png` });
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

await check("the sidebar opens backups with schedules and history", async () => {
  await page.getByRole("button", { name: "Backups", exact: true }).click();
  await page.getByRole("heading", { name: "Backups", level: 1 }).waitFor();
  await page.getByText("Every day at 02:00").waitFor();
  await page.getByText("The latest 7 backups").waitFor();
  await page.locator("tbody tr").nth(2).waitFor();
  const rows = await page.locator("tbody tr").count();
  if (rows !== 3) throw new Error(`rows ${rows}`);
  await page.getByText("Failed").first().waitFor();
  await page.waitForTimeout(300);
  await shot("01-page");
});

await check("create a weekly schedule", async () => {
  await page.getByRole("button", { name: "New schedule" }).click();
  const dialog = page.getByRole("dialog", { name: "New backup schedule" });
  await dialog.getByRole("radio", { name: "Database" }).click();
  await dialog.getByLabel("Database", { exact: true }).fill("shop");
  await dialog.getByRole("radio", { name: "Weekly" }).click();
  await dialog.getByLabel("Time").fill("23:30");
  await dialog.getByRole("button", { name: "Choose…" }).click();
  await dialog.getByText("/Users/ada/Backups").waitFor();
  await dialog.getByLabel("Backups to keep").fill("4");
  await page.waitForTimeout(200);
  await shot("02-dialog");
  await dialog.getByRole("button", { name: "Create schedule" }).click();
  await page.getByText("Every Monday at 23:30").waitFor();
  await page.getByText("The latest 4 backups").waitFor();
});

await check("run now adds a running backup that completes", async () => {
  const card = page.locator("article", { hasText: "Every Monday at 23:30" });
  await card.getByRole("button", { name: "Run now" }).click();
  await page.getByText("Running").first().waitFor();
  await page.locator("tbody tr").first().getByText("Completed").waitFor({ timeout: 5000 });
  if ((await page.locator("tbody tr").count()) !== 4) throw new Error("no new row");
});

await check("pause a schedule", async () => {
  const card = page.locator("article", { hasText: "Every Monday at 23:30" });
  await card.getByRole("switch").click();
  await card.getByText("Paused").waitFor();
});

await check("restore a backup from the history", async () => {
  await page.locator("tbody tr").nth(1).getByRole("button", { name: "Backup actions" }).click();
  await page.getByRole("menuitem", { name: "Restore…" }).click();
  const picker = page.getByRole("alertdialog", { name: "Restore into…" });
  await picker.getByRole("button", { name: /Local development/ }).click();
  await page
    .getByRole("dialog")
    .getByText(/archive\.gz/)
    .first()
    .waitFor();
  await page.waitForTimeout(300);
  await shot("03-restore");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
});

await check("filter and delete from the history", async () => {
  await page.getByRole("combobox", { name: "Filter by connection" }).click();
  await page.getByRole("option", { name: "Production (Atlas)" }).click();
  await page.waitForTimeout(200);
  const before = await page.locator("tbody tr").count();
  await page.locator("tbody tr").last().getByRole("button", { name: "Backup actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await page.waitForTimeout(400);
  if ((await page.locator("tbody tr").count()) !== before - 1) throw new Error("not deleted");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
