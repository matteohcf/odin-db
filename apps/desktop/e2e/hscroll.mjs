import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 600 } });
await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.click("text=shop");
await page.getByRole("button", { name: /^users$/ }).click();
await page.waitForSelector("[role=grid] tbody tr");
await page
  .locator("[role=grid]")
  .locator("..")
  .evaluate((el) => el.scrollTo(400, 0));
await page.waitForTimeout(300);
// The element at the top-left corner of the header must be the "#" cell.
const box = await page.locator("[role=grid] thead th").first().boundingBox();
const top = await page.evaluate(
  ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("aria-label"),
  { x: box.x + 10, y: box.y + 10 },
);
console.log(top === "#" ? "ok   sticky header corner" : `FAIL sticky header corner: ${top}`);
await page.screenshot({ path: "test-results/hscroll.png" });
await browser.close();
