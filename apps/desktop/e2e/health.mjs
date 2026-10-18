// Query bar: autocompletion, history, reset.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-health-${name}.png` });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
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

await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.waitForSelector("text=shop");

await check("a server that stops answering is flagged and announced", async () => {
  await page.evaluate(() => window.odinMock.setReachable("Local development", false));
  await page.getByText(/Local development stopped answering/).waitFor();
  await page.getByText("Server unreachable, retrying…").waitFor();
  await page.waitForTimeout(300);
  await shot("01-unreachable");
});

await check("recovery clears the warning", async () => {
  await page.evaluate(() => window.odinMock.setReachable("Local development", true));
  await page.getByText("Local development is reachable again").waitFor();
  await page.getByText("Server unreachable, retrying…").waitFor({ state: "detached" });
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
