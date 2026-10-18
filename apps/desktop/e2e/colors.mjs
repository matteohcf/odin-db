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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-colors-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const profileMenu = async (name) => {
  await page
    .getByRole("button", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) })
    .first()
    .hover();
  await page
    .getByRole("button", { name: `Actions for ${name}` })
    .first()
    .click();
};
await page.goto("http://localhost:1420/");
await page.waitForSelector("text=Local development");

await check("colors show in the sidebar, tabs and collection header", async () => {
  await page.click("text=Local development");
  await page.getByRole("button", { name: /^shop/ }).first().click();
  await page
    .getByRole("button", { name: /^users/ })
    .first()
    .click();
  await page.locator("tbody tr").first().waitFor();
  const header = page.locator("header.border-t-2");
  await header.waitFor();
  if (!(await header.getAttribute("class")).includes("border-green-500"))
    throw new Error("header color");
  if ((await page.getByRole("tab").locator(".bg-green-500").count()) !== 1)
    throw new Error("tab mark");
  await shot("01-colors");
});

await check("change a connection's color and name from its menu", async () => {
  await profileMenu("Local development");
  await page.getByRole("menuitem", { name: /Edit/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Purple" }).click();
  await dialog.getByLabel("Name").fill("Local dev");
  await page.waitForTimeout(150);
  await shot("02-picker");
  await dialog.getByRole("button", { name: /^Save/ }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("Local dev", { exact: true }).first().waitFor();
  const header = page.locator("header.border-t-2");
  await page.waitForFunction(() =>
    document.querySelector("header.border-t-2")?.className.includes("border-purple-500"),
  );
  if (!(await header.getAttribute("class")).includes("border-purple-500"))
    throw new Error("not purple");
});

await check("no color removes every mark", async () => {
  await profileMenu("Local dev");
  await page.getByRole("menuitem", { name: /Edit/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "No color" }).click();
  await dialog.getByRole("button", { name: /^Save/ }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => !document.querySelector("header.border-t-2"));
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
