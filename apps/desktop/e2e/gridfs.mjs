// GridFS buckets: download and upload files.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
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
    await page.screenshot({ path: "test-results/gridfs-fail.png" });
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
const tree = page.getByRole("complementary", { name: /Connections/ });
await tree
  .getByRole("button", { name: /^Local development/ })
  .first()
  .click();
await tree
  .getByRole("button", { name: /^media/ })
  .first()
  .click();
await tree
  .getByRole("button", { name: /^fs\.files/ })
  .first()
  .click();
await page.locator("tbody tr").first().waitFor();
await check("download a file from the row menu", async () => {
  await page.locator("tbody tr").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Download file…" }).click();
  await page.getByText("Saved to /Users/ada/Downloads/invoice-2024-001.pdf").waitFor();
});
await check("a download shows progress and can be cancelled", async () => {
  await page.locator("tbody tr").nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Download file…" }).click();
  await page.getByText(/Saving logo\.png… \d+%/).waitFor();
  await page.screenshot({ path: "test-results/gridfs-progress.png" });
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "logo.png" })
    .getByRole("button", { name: "Cancel" })
    .click();
  await page.getByText("Transfer cancelled").waitFor();
});
await check("upload a file into the bucket", async () => {
  await page.getByRole("button", { name: "Upload file" }).click();
  await page.getByText("File uploaded").waitFor();
  await page.getByText("uploaded-report.pdf").waitFor();
  await page.screenshot({ path: "test-results/gridfs.png" });
});
await check("ordinary collections offer neither", async () => {
  await tree
    .getByRole("button", { name: /^fs\.chunks/ })
    .first()
    .click();
  await page.waitForTimeout(500);
  if (await page.getByRole("button", { name: "Upload file" }).filter({ visible: true }).count())
    throw new Error("upload offered");
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
