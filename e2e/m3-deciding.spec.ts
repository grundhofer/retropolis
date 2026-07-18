import { expect, test, type Page } from "@playwright/test";

// M3 acceptance: blind voting (nobody sees others' votes), the anonymous
// meter, top-N crowns after the reveal, the synced discussion focus, action
// items, and re-blinding on rewind.
test("blind voting, crowns, discussion queue and action items", async ({
  browser,
}) => {
  const annaContext = await browser.newContext({ reducedMotion: "reduce" });
  const anna = await annaContext.newPage();
  await anna.goto("/");
  await anna.getByRole("textbox").fill("Sprint 44 retro");
  await anna
    .getByRole("button", { name: /create board|board erstellen/i })
    .click();
  await expect(anna).toHaveURL(/\/board\/[0-9a-f]{32}$/);
  const boardUrl = anna.url();
  await join(anna, "Anna");

  const benContext = await browser.newContext({ reducedMotion: "reduce" });
  const ben = await benContext.newPage();
  await ben.goto(boardUrl);
  await join(ben, "Ben");

  // Write two notes, reveal them (skip check-in first).
  await anna.getByTestId("phase-next").click();
  await anna.getByTestId("phase-next").click();
  const annaComposer = anna
    .getByPlaceholder(/write a note|notiz schreiben/i)
    .first();
  await annaComposer.fill("Slow deploys");
  await annaComposer.press("Enter");
  const benComposer = ben
    .getByPlaceholder(/write a note|notiz schreiben/i)
    .first();
  await benComposer.fill("Great teamwork");
  await benComposer.press("Enter");
  await anna.getByTestId("phase-next").click(); // present

  // Into the vote phase: vote controls appear, budget dots show.
  await anna.getByTestId("phase-next").click();
  await expect(anna.getByTestId("votes-remaining")).toBeVisible();
  await expect(anna.getByTestId("vote-control").first()).toBeVisible();

  // Anna spends her 3 votes on "Slow deploys".
  const annaPlus = anna
    .getByTestId("vote-target")
    .filter({ hasText: "Slow deploys" })
    .getByTestId("vote-plus");
  await annaPlus.click();
  await annaPlus.click();
  await annaPlus.click();
  await expect(annaPlus).toBeDisabled(); // budget spent

  // Blindness: Ben sees no counts from Anna — his own counts are all 0 and
  // no tallies/crowns exist anywhere.
  await expect(ben.getByTestId("vote-meter")).toContainText("1/2");
  await expect(ben.getByTestId("crown")).toHaveCount(0);
  await expect(ben.getByTestId("tally")).toHaveCount(0);
  const bensCounts = await ben.getByTestId("vote-count").allInnerTexts();
  expect(bensCounts.every((count) => count.trim() === "0")).toBe(true);

  // Ben votes 2 on teamwork, 1 on deploys → meter completes.
  const benTeamworkPlus = ben
    .getByTestId("vote-target")
    .filter({ hasText: "Great teamwork" })
    .getByTestId("vote-plus");
  await benTeamworkPlus.click();
  await benTeamworkPlus.click();
  const benDeploysPlus = ben
    .getByTestId("vote-target")
    .filter({ hasText: "Slow deploys" })
    .getByTestId("vote-plus");
  await benDeploysPlus.click();
  await expect(anna.getByTestId("vote-meter")).toContainText("2/2");

  // Reveal: crowns + tallies on both screens, "Slow deploys" ranks first (4 votes).
  await anna.getByTestId("phase-next").click(); // discuss
  await expect(anna.getByTestId("crown").first()).toBeVisible();
  await expect(ben.getByTestId("crown").first()).toBeVisible();
  await expect(ben.getByTestId("discuss-chip-1")).toContainText("Slow deploys");
  await expect(ben.getByTestId("discuss-chip-1")).toContainText("4●");

  // Synced focus: Anna clicks the first queue chip, Ben's board dims the rest.
  await anna.getByTestId("discuss-chip-1").click();
  await expect(ben.getByTestId("discuss-chip-1")).toHaveClass(/bg-accent/);

  // Action item with an owner, live on both screens; Ben checks it off.
  await anna.getByTestId("action-input").fill("Automate the deploy pipeline");
  await anna.getByTestId("action-owner").selectOption({ label: "Ben" });
  await anna.getByRole("button", { name: /^(add|hinzufügen)$/i }).click();
  const bensAction = ben
    .getByTestId("action-item")
    .filter({ hasText: "Automate the deploy" });
  await expect(bensAction).toBeVisible();
  await expect(bensAction).toContainText("Ben");
  await bensAction.getByRole("checkbox").check();
  await expect(
    anna
      .getByTestId("action-item")
      .filter({ hasText: "Automate the deploy" })
      .locator("span.line-through"),
  ).toBeVisible();

  // Rewind to vote: blind again on every screen.
  await anna.getByTestId("phase-back").click();
  await expect(ben.getByTestId("crown")).toHaveCount(0);
  await expect(ben.getByTestId("tally")).toHaveCount(0);

  await annaContext.close();
  await benContext.close();
});

async function join(page: Page, name: string): Promise<void> {
  await page.getByRole("textbox").fill(name);
  await page.getByRole("button", { name: /^(join|beitreten)$/i }).click();
  await expect(page.getByTestId("roster-item").first()).toBeVisible();
}
