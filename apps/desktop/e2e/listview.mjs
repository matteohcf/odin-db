// Query bar: autocompletion, history, reset.
import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-list-${name}.png` });
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
await page.evaluate(() => localStorage.removeItem("odin-results-view"));
await page.reload();
await page.click("text=Local development");
await page.click("text=shop");
await page.getByRole("button", { name: /^users$/ }).click();
await page.waitForSelector("[role=grid] tbody tr");
const list = page.getByRole("listbox", { name: /Documents in users/ });

await check("switch to the list view", async () => {
  await page.getByRole("radio", { name: "List" }).click();
  await list.waitFor();
  await list.getByRole("option").first().waitFor();
  await page.waitForTimeout(300);
  await shot("01-list");
});

await check("nested fields expand on demand", async () => {
  const first = list.getByRole("option").first();
  const address = first.getByRole("button", { name: "address" });
  if ((await address.getAttribute("aria-expanded")) !== "false")
    throw new Error("expanded by default");
  await address.click();
  await first.getByText(/^city:$/).waitFor();
  await shot("02-expanded");
});

await check("keyboard selection and Enter open the editor", async () => {
  await list.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const selected = await list.getByRole("option", { selected: true }).count();
  if (selected !== 1) throw new Error(`selected ${selected}`);
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Edit document" }).waitFor();
  await page.keyboard.press("Escape");
});

await check("scrolling loads more documents", async () => {
  await list.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await page.waitForTimeout(1200);
  await list.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await page.waitForTimeout(1200);
  const status = await page.locator("footer").last().innerText();
  if (!/[2-9]\d\d documents|1,\d{3} documents/.test(status)) throw new Error(status);
});

await check("the choice is remembered", async () => {
  await page.reload();
  // The orders tab comes back on its own; it only needs its connection.
  await page.getByRole("main").getByRole("button", { name: "Connect" }).click();
  await page.getByRole("listbox", { name: /Documents in/ }).waitFor();
  await page.getByRole("radio", { name: "Table" }).click();
  await page.waitForSelector("[role=grid] tbody tr");
});

await check("double-click a value in the list view edits it in place", async () => {
  await page.getByRole("radio", { name: "List" }).click();
  const value = page.locator("[role=listbox] [data-path=plan] span").last();
  const before = await value.innerText();
  await value.dblclick();
  const input = page.getByRole("textbox", { name: "Value" });
  await input.waitFor();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type('"vip"');
  await page.keyboard.press("Enter");
  await page.getByText("plan updated").first().waitFor();
  await page.locator("[role=listbox]").getByText('"vip"').first().waitFor();
  if (await page.getByRole("dialog").count()) throw new Error("opened the editor");
  if (before === '"vip"') throw new Error("unchanged");
});
await check("edit a document in place: change, add, validate, cancel and update", async () => {
  await page.keyboard.press("Escape");
  const card = list.getByRole("option").first();
  await card.hover();
  await card.getByRole("button", { name: "Edit document" }).click();
  const name = card.getByLabel("Value of name");
  await name.fill('"Ada Lovelace"');
  await card.getByRole("button", { name: "Add field" }).last().click();
  await page.keyboard.insertText("nickname");
  await card.getByLabel("Value of nickname").fill("ObjectId(");
  await card.getByRole("button", { name: /^Update/ }).click();
  await card.getByText("1 field to fix").waitFor();
  await shot("05-inplace-problem");
  await card.getByLabel("Value of nickname").fill('"Countess"');
  await card.getByRole("button", { name: /^Update/ }).click();
  await page.getByText("Document saved").waitFor();
  await list.getByRole("option").first().getByText('"Ada Lovelace"').waitFor();
  await list.getByRole("option").first().getByText('"Countess"').waitFor();
  // Escape leaves without saving.
  await list.getByRole("option").first().hover();
  await list.getByRole("option").first().getByRole("button", { name: "Edit document" }).click();
  await list.getByRole("option").first().getByLabel("Value of name").fill('"Nobody"');
  await page.keyboard.press("Escape");
  await list.getByRole("option").first().getByText('"Ada Lovelace"').waitFor();
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
