import { expect, test } from "@playwright/test";

const reviewedScreens = [
  { id: "sign-in", link: "01 Sign in", heading: "A clear way back in" },
  { id: "home", link: "02 Home", heading: "Know your next step" },
  { id: "profile", link: "03 Profile", heading: "Your details, your say" },
  { id: "table", link: "04 Table details", heading: "Make a night of it" },
  { id: "waitlist", link: "05 Waitlist", heading: "Invite with care" },
  { id: "roster", link: "06 Roster review", heading: "Build a table that fits" },
] as const;

test("serves all six reviewed preview screens on the independent test app", async ({ page }) => {
  await page.goto("/preview");

  await expect(page).toHaveTitle("Fifth Wheel · App preview");
  await expect(page.getByText("VISUAL PREVIEW", { exact: true }).first()).toBeVisible();

  for (const screen of reviewedScreens) {
    await expect(page.getByRole("link", { name: screen.link, exact: true })).toHaveAttribute("href", `#${screen.id}`);
    await expect(page.locator(`#${screen.id}`)).toBeAttached();
    await expect(page.getByRole("heading", { name: screen.heading, exact: true })).toBeVisible();
  }
});
