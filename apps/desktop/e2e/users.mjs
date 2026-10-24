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
const shot = (name) => page.screenshot({ path: `test-results/${scheme}-users-${name}.png` });
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
const profileMenu = async (name) => {
  await aside()
    .getByRole("button", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) })
    .first()
    .hover();
  await aside()
    .getByRole("button", { name: `Actions for ${name}` })
    .first()
    .click();
};
await page.goto("http://localhost:1420/");
await page.click("text=Local development");
await page.waitForSelector("text=shop");

await check("users are listed with their roles", async () => {
  await profileMenu("Local development");
  await page.getByRole("menuitem", { name: "Users and roles" }).click();
  await page.getByRole("heading", { name: "Users and roles", level: 1 }).waitFor();
  await page
    .getByRole("row", { name: /shop-api/ })
    .getByText("readWrite")
    .waitFor();
});

await check("create a user with a generated password and roles", async () => {
  await page.getByRole("button", { name: "New user" }).click();
  const dialog = page.getByRole("dialog", { name: "New user" });
  await dialog.getByLabel("User name").fill("reporter");
  await dialog.getByLabel("Authentication database").fill("shop");
  const password = await dialog.getByLabel("Password", { exact: true }).inputValue();
  if (password.length !== 24) throw new Error(`password ${password}`);
  await dialog.getByLabel("Role 1", { exact: true }).fill("read");
  // Closes the role suggestions, as Tab does for a user.
  await page.keyboard.press("Tab");
  await dialog.getByRole("button", { name: "Add a role" }).click();
  await dialog.getByLabel("Role 2", { exact: true }).fill("read");
  // Closes the role suggestions, as Tab does for a user.
  await page.keyboard.press("Tab");
  await dialog.getByLabel("Database of role 2").fill("analytics");
  await page.waitForTimeout(150);
  await shot("01-create");
  await dialog.getByRole("button", { name: "Create user" }).click();
  await page.getByText("User reporter created.").waitFor();
  const row = page.getByRole("row", { name: /reporter/ });
  await row.getByText("@analytics").waitFor();
  await page.waitForTimeout(150);
  await shot("02-list");
});

await check("edit roles, change the password and delete the user", async () => {
  const row = page.getByRole("row", { name: /reporter/ });
  await row.hover();
  await row.getByRole("button", { name: "Edit the roles of reporter" }).click();
  const dialog = page.getByRole("dialog", { name: "Roles of reporter" });
  await dialog.getByRole("button", { name: "Remove role 2" }).click();
  await dialog.getByRole("button", { name: "Save roles" }).click();
  await page.getByText("Roles of reporter saved.").waitFor();
  await row.getByText("@analytics").waitFor({ state: "detached" });
  await row.hover();
  await row.getByRole("button", { name: "Change the password of reporter" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Change password" }).click();
  await page.getByText(/Password of reporter changed/).waitFor();
  await row.hover();
  await row.getByRole("button", { name: "Delete reporter" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete user" }).click();
  await page.getByText("User reporter deleted.").waitFor();
  await page.getByRole("row", { name: /reporter/ }).waitFor({ state: "detached" });
});

await check("read-only connections cannot change users", async () => {
  await aside()
    .getByRole("button", { name: /^Production \(Atlas\)/ })
    .click();
  await page.waitForTimeout(800);
  await profileMenu("Production (Atlas)");
  await page.getByRole("menuitem", { name: "Users and roles" }).click();
  await page
    .getByRole("row", { name: /shop-api/ })
    .last()
    .waitFor();
  if (
    await page
      .locator("[role=tabpanel]:not([hidden])")
      .getByRole("button", { name: "New user" })
      .count()
  )
    throw new Error("new user offered");
});

console.log(results.join("\n"));
console.log(JSON.stringify({ errors }));
await browser.close();
