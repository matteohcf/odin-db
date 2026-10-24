import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.click("text=shop");
await page.getByRole("button", { name: /^users$/ }).click();
const documentsTab = page.getByRole("tab", { name: /^Documents/ });
try {
  await documentsTab.getByText("1.2K").waitFor();
  await page
    .getByRole("tab", { name: /^Indexes/ })
    .getByText(/^\d+$/)
    .waitFor();
  const size = page.getByText(/^\d[\d.,]* kB$/).first();
  await size.hover();
  await page.getByText("Average document").waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `test-results/${scheme}-stats.png` });
  console.log("ok   tabs show counts and the header the size, with details on hover");
} catch (error) {
  console.log(`FAIL stats: ${String(error).split("\n")[0]}`);
}
await page.getByRole("button", { name: /^active_users/ }).click();
await page.waitForTimeout(800);
console.log(
  (await documentsTab.filter({ visible: true }).getByText(/\d/).count()) === 0
    ? "ok   views show no stats"
    : "FAIL views show stats",
);
console.log(JSON.stringify({ errors }));
await browser.close();
