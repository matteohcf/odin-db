// A new user's first session, start to finish.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
let step = 0;
const shot = (name) =>
  page.screenshot({ path: `test-results/newuser-${String(++step).padStart(2, "0")}-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail`);
  }
};
await page.goto("http://localhost:1420/");
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("odin-mock-empty", "1");
});
await page.reload();
const tree = page.getByRole("complementary", { name: /Connections/ });

await check("first launch explains what to do", async () => {
  await page.getByText("No connections yet").waitFor();
  await shot("first-run");
});
await check("create a connection from a pasted URI", async () => {
  await tree.getByRole("button", { name: "New connection" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name" }).fill("My laptop");
  await dialog
    .getByRole("textbox", { name: "Connection string" })
    .fill("mongodb://admin:secret@localhost:27017");
  await dialog.getByRole("radio", { name: "Green" }).click();
  await shot("new-connection");
  await dialog.getByRole("button", { name: /^Save/ }).click();
  await dialog.waitFor({ state: "detached" });
  await tree.getByRole("button", { name: /^My laptop/ }).waitFor();
});
await check("connect and browse", async () => {
  // "Save and connect" opens the new connection in the tree.
  await tree.getByRole("button", { name: /^shop/ }).first().click();
  await tree
    .getByRole("button", { name: /^users/ })
    .first()
    .click();
  await page.locator("tbody tr").first().waitFor();
  await shot("browse");
});
await check("query with autocomplete", async () => {
  const filter = page.getByRole("textbox", { name: "Filter" });
  await filter.click();
  await page.keyboard.type("{ pl");
  await page.getByRole("option", { name: /plan/ }).first().waitFor();
  await page.keyboard.press("Tab");
  await page.keyboard.type(': "team"');
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const status = await page.locator("footer").last().innerText();
  if (!/documents/.test(status)) throw new Error(status);
  await shot("query");
});
await check("insert, find and edit a document", async () => {
  await page.getByRole("button", { name: "Insert document" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText('{ name: "New user", plan: "team", age: 31 }');
  await page.keyboard.press("Meta+Enter");
  await page.getByText("Document inserted").waitFor();
  await page.getByRole("textbox", { name: "Filter" }).click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.insertText('{ name: "New user" }');
  await page.keyboard.press("Enter");
  await page.locator("tbody tr").first().waitFor();
  await page.locator("tbody tr").first().locator("td").nth(3).dblclick();
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("32");
  await page.keyboard.press("Enter");
  await page.getByText("age updated").waitFor();
  await shot("edited");
});
await check("insert from the collection's schema", async () => {
  await page.getByRole("button", { name: "Insert document" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Fill from schema" }).click();
  await dialog.getByText("loginCount").waitFor();
  const text = await dialog.locator(".cm-content").innerText();
  if (text.includes("_id") || !text.includes('Long("0")')) throw new Error(text.slice(0, 200));
  await dialog.getByText(/Valid document/).waitFor();
  await page.screenshot({ path: "test-results/newuser-schema-template.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
});
await check("delete it with confirmation", async () => {
  await page.locator("[role=grid]").focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Delete");
  await page.getByRole("button", { name: "Delete document" }).click();
  await page.getByText("No documents match this filter.").waitFor();
});
await check("export the collection", async () => {
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page
    .getByRole("menuitem", { name: /Export/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("No document matches the query: the file would be empty.").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Clear the filter" }).click();
  await page.locator("tbody tr").first().waitFor();
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page
    .getByRole("menuitem", { name: /Export/ })
    .first()
    .click();
  await dialog.getByText("1,240 documents will be exported.").waitFor();
  await shot("export");
  await dialog.getByRole("button", { name: "Choose file and export" }).click();
  await dialog.getByText(/Exported/).waitFor({ timeout: 10000 });
});
await check("the welcome page starts a new connection", async () => {
  await page.keyboard.press("Escape");
  // The welcome page shows once no tab is open.
  while (await page.getByRole("tab", { name: /shop/ }).count()) await page.keyboard.press("Meta+w");
  await page.getByRole("main").getByRole("button", { name: "New connection" }).click();
  await page.getByRole("dialog", { name: "New connection" }).waitFor();
  await page.keyboard.press("Escape");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
