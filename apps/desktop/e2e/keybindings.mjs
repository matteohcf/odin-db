// Customizable shortcuts: record, use at once, resolve a conflict, reset one or all, persist.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-keybindings-${name}.png` });
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
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
// The mock runs in a macOS user agent here: Mod is Cmd.
const recorder = (action) =>
  page.getByRole("button", { name: `Change the shortcut for ${action}` });
const palette = page
  .getByRole("dialog")
  .filter({ has: page.getByPlaceholder(/Search collections/) });
const openKeyboardSettings = async () => {
  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("button", { name: "Keyboard" }).click();
  await recorder("Command palette").waitFor();
};

await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();

await check("a recorded shortcut works at once and the old one stops", async () => {
  await openKeyboardSettings();
  await recorder("Command palette").click();
  await page.getByText("Press the new shortcut…").waitFor();
  await shot("01-recording");
  await page.keyboard.press("Meta+Shift+P");
  if (!(await recorder("Command palette").innerText()).includes("P"))
    throw new Error("not recorded");
  await page.getByRole("button", { name: "Reset to ⌘ K" }).waitFor();
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(200);
  if (await palette.isVisible()) throw new Error("the old shortcut still opens it");
  await page.keyboard.press("Meta+Shift+P");
  await palette.waitFor();
  await page.keyboard.press("Escape");
});

await check("keys without Ctrl are refused while recording", async () => {
  await recorder("Close the tab").click();
  await page.keyboard.press("x");
  await page.getByText("Add ⌘ / ⌃ (or a function key)").waitFor();
  await page.keyboard.press("Escape");
  await page.getByText("Press the new shortcut…").waitFor({ state: "detached" });
});

await check("keys already in use move only when asked", async () => {
  await recorder("Open settings").click();
  await page.keyboard.press("Meta+Shift+P");
  const alert = page.getByRole("alert").filter({ hasText: "is already used by" });
  await alert.getByText("“Command palette”").waitFor();
  await shot("02-conflict");
  await alert.getByRole("button", { name: "Use it here" }).click();
  if ((await recorder("Command palette").innerText()).trim() !== "None")
    throw new Error("palette kept the keys");
  if (!(await recorder("Open settings").innerText()).includes("P"))
    throw new Error("settings did not get the keys");
});

await check("changes persist and reset one by one or all at once", async () => {
  await page.reload();
  await page.keyboard.press("Meta+Shift+P");
  await page.getByRole("button", { name: "Keyboard" }).waitFor();
  await page.getByRole("button", { name: "Keyboard" }).click();
  await page.getByText("2 changed").waitFor();
  await shot("03-changed");
  await page.getByRole("button", { name: "Reset to ⌘ K" }).click();
  if (!(await recorder("Command palette").innerText()).includes("K")) throw new Error("not reset");
  await page.getByRole("button", { name: "Reset all shortcuts" }).click();
  if (!(await recorder("Open settings").innerText()).includes(","))
    throw new Error("settings not reset");
  if (!(await page.getByRole("button", { name: "Reset all shortcuts" }).isDisabled()))
    throw new Error("nothing left to reset");
});

await check("the run shortcut can change too", async () => {
  await recorder("Run or save, in editors").click();
  await page.keyboard.press("Meta+Shift+Enter");
  await page.click("text=Local development");
  await page.click("text=shop");
  await page.getByRole("button", { name: /^orders$/ }).click();
  await page.locator("tbody tr").first().waitFor();
  const filter = page.getByRole("textbox", { name: "Filter" });
  await filter.click();
  await page.keyboard.type('{ status: "paid" }');
  await page.keyboard.press("Meta+Shift+Enter");
  await page.getByText("88 documents").waitFor();
  await page.getByRole("button", { name: /^Run/ }).getByText("⌘ ⇧ ↵").waitFor();
});

await check("the overview dialog shows the user's keys and opens settings", async () => {
  await page.keyboard.press("Meta+/");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await dialog.waitFor();
  await dialog.getByText("Run or save, in editors").waitFor();
  await shot("04-overview");
  await dialog.getByRole("button", { name: "Customize…" }).click();
  await recorder("Command palette").waitFor();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
