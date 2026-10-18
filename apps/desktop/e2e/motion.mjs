import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ reducedMotion: "reduce" });
await page.goto("http://localhost:1420/");
await page.getByText("Local development").waitFor();
const d = await page
  .locator("button")
  .first()
  .evaluate((el) => getComputedStyle(el).transitionDuration);
console.log(
  d.startsWith("1e-05s") || d.startsWith("0.00001s")
    ? "ok   reduced motion shortens transitions"
    : `FAIL ${d}`,
);
await browser.close();
