// Live changes: a collection's change stream, filters, pause, clear.
import { chromium } from "playwright";
import { connect } from "./lib/connect.mjs";

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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-live-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const tree = page.getByRole("complementary");
const panel = () => page.getByRole("tabpanel").filter({ visible: true }).first();
const rows = () => panel().locator("li");

await page.goto("http://localhost:1420/");
await connect(page, "Local development");
await tree.getByRole("button", { name: /^shop/ }).first().click();
await tree
  .getByRole("button", { name: /^orders/ })
  .first()
  .click();

await check("the Live view streams changes, newest first", async () => {
  await page.getByRole("tab", { name: /^Live/ }).click();
  await panel().getByRole("status").getByText("Live").waitFor();
  await panel().getByText("Insert", { exact: true }).first().waitFor({ timeout: 5000 });
  await panel().getByText("Delete", { exact: true }).first().waitFor({ timeout: 8000 });
  const times = (await rows().allInnerTexts()).map((text) => text.split(/\s/)[0]);
  const sorted = [...times].sort().reverse();
  if (times.join() !== sorted.join()) throw new Error(`not newest first: ${times.join(" ")}`);
  await panel()
    .getByText(/status: "paid", paidAt: .*−draft/)
    .waitFor();
  await shot("01-feed");
});

await check("pause holds the list, and a change opens to its document", async () => {
  await panel().getByRole("button", { name: "Pause" }).click();
  await panel().getByRole("status").getByText("Paused").waitFor();
  const before = await rows().count();
  await page.waitForTimeout(1600);
  if ((await rows().count()) !== before) throw new Error("grew while paused");
  await rows().filter({ hasText: "Update" }).first().getByRole("button").click();
  await panel()
    .locator("pre")
    .getByText(/paidAt/)
    .waitFor();
  await shot("02-opened");
});

await check("filters hide kinds of changes", async () => {
  await panel().getByRole("button", { name: "Insert", exact: true }).click();
  if (await rows().filter({ hasText: "Insert" }).count()) throw new Error("inserts still shown");
  await panel().getByRole("button", { name: "Insert", exact: true }).click();
  await rows().filter({ hasText: "Insert" }).first().waitFor();
});

await check("clear empties the list and resume goes live again", async () => {
  await panel().getByRole("button", { name: "Clear" }).click();
  await panel().getByText("Waiting for changes…").waitFor();
  await panel().getByRole("button", { name: "Resume" }).click();
  await panel().getByRole("status").getByText("Live").waitFor();
  await rows().first().waitFor({ timeout: 5000 });
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
