// Keyboard navigation in the connection tree.
import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

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
    await page.screenshot({ path: `test-results/treekeys-fail-${name.replaceAll(" ", "-")}.png` });
  }
};
const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
await page.goto("http://localhost:1420/");
await page.evaluate(() => localStorage.clear());
await page.reload();
const tree = page.getByRole("complementary", { name: /Connections/ });
// Only open connections are in the tree (ADR-0058); connecting opens it expanded.
await connect(page);
await tree
  .getByRole("button", { name: /^Local development/ })
  .first()
  .focus();

await check(
  "ArrowLeft collapses a connection, ArrowRight expands it, ArrowDown moves in",
  async () => {
    await page.keyboard.press("ArrowLeft");
    await tree.getByRole("button", { name: /^admin/ }).waitFor({ state: "detached" });
    await page.keyboard.press("ArrowRight");
    await tree.getByRole("button", { name: /^admin/ }).waitFor();
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(100);
    if (!(await focused()).startsWith("admin")) throw new Error(await focused());
  },
);
await check("ArrowRight on a database expands, then steps into it", async () => {
  await page.keyboard.press("ArrowDown"); // analytics
  await page.keyboard.press("ArrowRight");
  await tree.getByRole("button", { name: /^events/ }).waitFor();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(100);
  if (!(await focused()).startsWith("events")) throw new Error(await focused());
});
await check("ArrowLeft goes to the parent, then collapses it", async () => {
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(100);
  if (!(await focused()).startsWith("analytics")) throw new Error(await focused());
  await page.keyboard.press("ArrowLeft");
  await tree.getByRole("button", { name: /^events/ }).waitFor({ state: "detached" });
});
await check("Enter opens a collection", async () => {
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.locator("[role=grid] tbody tr").first().waitFor();
});
await check("End and Home jump across a huge tree", async () => {
  await connect(page, "Tenants cluster");
  await tree.getByRole("button", { name: /^tenant_001/ }).waitFor();
  await tree.getByRole("button", { name: /^Tenants cluster/ }).focus();
  await page.keyboard.press("End");
  await page.waitForTimeout(200);
  // The last row of the tree, past Tenants cluster's 320 databases.
  const last = await page.evaluate(() => {
    const indexes = [...document.querySelectorAll("aside li[data-index]")].map((li) =>
      Number(li.dataset.index),
    );
    const active = document.activeElement?.closest("li[data-index]");
    return active && Number(active.dataset.index) === Math.max(...indexes);
  });
  if (!last) throw new Error(await focused());
  await page.keyboard.press("Home");
  await page.waitForTimeout(200);
  if (!(await focused()).startsWith("Clients")) throw new Error(await focused());
});
await check("ArrowDown from the filter enters the tree", async () => {
  await page.keyboard.press("Meta+Shift+f");
  await page.keyboard.type("invoices_35");
  await tree
    .getByRole("button", { name: /^invoices_35/ })
    .first()
    .waitFor();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(100);
  if (!(await focused()).startsWith("Clients")) throw new Error(await focused());
});
console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
