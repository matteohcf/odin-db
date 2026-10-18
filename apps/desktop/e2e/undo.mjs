import { chromium } from "playwright";

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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-undo-${name}.png` });
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`ok   ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${String(error).split("\n")[0]}`);
    await shot(`fail-${name.replaceAll(" ", "-")}`);
  }
};
const rows = () => page.locator("tbody tr");
const firstId = () => rows().first().locator("td").first().innerText();
await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.getByRole("button", { name: /^shop/ }).first().click();
await page
  .getByRole("button", { name: /^users/ })
  .first()
  .click();
await rows().first().waitFor();

await check("undo a single delete", async () => {
  const id = await firstId();
  await rows().first().click();
  await page.keyboard.press("Delete");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete document" }).click();
  await page.getByText("Document deleted").waitFor();
  await page.waitForFunction(
    (gone) => !document.querySelector("tbody tr td")?.textContent?.includes(gone),
    id,
  );
  await shot("01-toast");
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByText("Restored 1 document.").waitFor();
  await page.getByText(id).first().waitFor();
});

await check("undo deleting several selected documents", async () => {
  await rows().nth(0).click();
  await rows()
    .nth(2)
    .click({ modifiers: ["Shift"] });
  await rows().nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete 3 documents…" }).click();
  await page
    .getByRole("dialog", { name: "Delete documents" })
    .getByRole("button", { name: "Delete 3 documents" })
    .click();
  await page.getByText("Deleted 3 documents.").waitFor();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByText("Restored 3 documents.").waitFor();
});

await check("the start screen lists recent collections", async () => {
  await page.keyboard.press("Meta+w");
  await page
    .getByRole("region", { name: "Recently opened" })
    .getByRole("button", { name: /^users/ })
    .click();
  await page.getByRole("heading", { name: "users", level: 1 }).waitFor();
  await page.keyboard.press("Meta+w");
  await page.waitForTimeout(150);
  await shot("02-welcome");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
