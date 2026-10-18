import { chromium } from "playwright";

const scheme = process.env.SCHEME ?? "light";
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: scheme,
  locale: "en-US",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-quickwins-${name}.png` });
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
const menuFor = async (name) => {
  await aside()
    .getByRole("button", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) })
    .last()
    .hover();
  await aside()
    .getByRole("button", { name: `Actions for ${name}` })
    .last()
    .click();
};
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
await page.goto("http://localhost:1420/");
await page.waitForSelector("text=Local development");

await check("duplicate a connection", async () => {
  await menuFor("Production (Atlas)");
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await aside()
    .getByRole("button", { name: /^Production \(Atlas\) \(copy\)/ })
    .waitFor();
  await page.getByText("Created Production (Atlas) (copy).").waitFor();
});

await check("copy a connection string without the password", async () => {
  await menuFor("Production (Atlas)");
  await page.getByRole("menuitem", { name: "Copy connection string" }).click();
  const text = await clipboard();
  if (!text.startsWith("mongodb") || /:[^@/]*@/.test(text.replace(/^mongodb(\+srv)?:\/\//, "")))
    throw new Error(text);
});

await check("copy database and collection names", async () => {
  await aside()
    .getByRole("button", { name: /^Local development/ })
    .click();
  await aside().getByRole("button", { name: /^shop/ }).first().waitFor();
  await menuFor("shop");
  await page.getByRole("menuitem", { name: "Copy name" }).click();
  if ((await clipboard()) !== "shop") throw new Error(await clipboard());
  await aside().getByRole("button", { name: /^shop/ }).first().click();
  await aside()
    .getByRole("button", { name: /^orders/ })
    .first()
    .waitFor();
  await menuFor("orders");
  await page.getByRole("menuitem", { name: "Copy name" }).click();
  if ((await clipboard()) !== "orders") throw new Error(await clipboard());
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
