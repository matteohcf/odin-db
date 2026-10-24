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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-monitor-${name}.png` });
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
const profileMenu = async (name) => {
  await aside()
    .getByRole("button", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) })
    .first()
    .hover();
  await aside()
    .getByRole("button", { name: `Actions for ${name}` })
    .first()
    .click();
};
await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.waitForSelector("text=shop");

await check("server status shows live rates", async () => {
  await profileMenu("Local development");
  await page.getByRole("menuitem", { name: "Server status" }).click();
  await page.getByRole("heading", { name: "Server status", level: 1 }).waitFor();
  await page
    .getByText(/^\d[\d,.]*\/s$/)
    .first()
    .waitFor({ timeout: 8000 });
  await page.getByText("localhost:27017", { exact: false }).first().waitFor();
  await page.waitForTimeout(4500);
  await shot("01-status");
});

await check("running operations are listed and can be killed", async () => {
  const table = page.getByRole("region", { name: "Running operations" });
  await table.getByText("analytics.events").waitFor();
  await table.getByText("waiting for a lock").waitFor();
  await table
    .getByRole("row", { name: /analytics\.events/ })
    .getByRole("button", { name: "Kill" })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Kill" }).click();
  await page.getByText("Operation killed.").waitFor();
  await table.getByText("analytics.events").waitFor({ state: "detached", timeout: 5000 });
});

await check("the index advisor lists slow scans and creates the index", async () => {
  const advisor = page.getByRole("region", { name: "Index advisor" });
  await advisor.getByText("shop.orders").waitFor();
  await advisor.getByText("{ status: 1, placedAt: -1 }").waitFor();
  await advisor.getByText("Collection scan").first().waitFor();
  await advisor
    .getByText(/Seen 42 times · 18.6 s in total · reads 120,000 documents to return 25/)
    .waitFor();
  await advisor.getByText("plan_1_createdAt_-1 exists but is not used").waitFor();
  await advisor.scrollIntoViewIfNeeded();
  await shot("advisor");
  await advisor.getByRole("button", { name: "Create index" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create index" });
  const keys = await dialog.getByRole("textbox", { name: "Keys" }).innerText();
  if (keys !== "{ status: 1, placedAt: -1 }") throw new Error(keys);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "detached" });
});

await check("pause stops polling", async () => {
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Resume" }).waitFor();
  await page.getByRole("button", { name: "Resume" }).click();
});

await check("read-only connections cannot kill", async () => {
  await aside()
    .getByRole("button", { name: /^Production \(Atlas\)/ })
    .click();
  await page.waitForTimeout(800);
  await profileMenu("Production (Atlas)");
  await page.getByRole("menuitem", { name: "Server status" }).click();
  const table = page.getByRole("region", { name: "Running operations" }).last();
  await table.getByRole("button", { name: "Kill" }).first().waitFor();
  if (!(await table.getByRole("button", { name: "Kill" }).first().isDisabled()))
    throw new Error("kill enabled");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
