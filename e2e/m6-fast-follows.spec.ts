import { expect, test, type Page } from "@playwright/test";

// M6 acceptance: the three v1.x fast-follows — staged/hidden columns, board
// duplication, and the slot-machine picker skin.

test("staged columns hide from members and reveal again", async ({
  browser,
}) => {
  const annaCtx = await browser.newContext({ reducedMotion: "reduce" });
  const anna = await annaCtx.newPage();
  await anna.goto("/");
  await anna.getByRole("textbox").fill("Sprint 47");
  await anna
    .getByRole("button", { name: /create board|board erstellen/i })
    .click();
  await expect(anna).toHaveURL(/\/board\/[0-9a-f]{32}$/);
  const boardUrl = anna.url();
  await join(anna, "Anna");

  const benCtx = await browser.newContext({ reducedMotion: "reduce" });
  const ben = await benCtx.newPage();
  await ben.goto(boardUrl);
  await join(ben, "Ben");

  // Into the write phase so the board grid renders.
  await anna.getByTestId("phase-next").click();

  const col = "To improve";
  await expect(ben.getByRole("heading", { name: col })).toBeVisible();

  // Anna hides the column → Ben loses it entirely; Anna keeps it, flagged.
  await anna
    .getByRole("region", { name: col })
    .getByTestId("column-hide-toggle")
    .click();
  await expect(ben.getByRole("heading", { name: col })).toHaveCount(0);
  await expect(anna.getByTestId("column-hidden-badge")).toBeVisible();

  // Reveal → Ben sees it again.
  await anna
    .getByRole("region", { name: col })
    .getByTestId("column-hide-toggle")
    .click();
  await expect(ben.getByRole("heading", { name: col })).toBeVisible();

  await annaCtx.close();
  await benCtx.close();
});

test("duplicating a board opens a fresh copy of it", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const anna = await ctx.newPage();
  await anna.goto("/");
  await anna.getByRole("textbox").fill("Retro to clone");
  await anna
    .getByRole("button", { name: /create board|board erstellen/i })
    .click();
  await expect(anna).toHaveURL(/\/board\/[0-9a-f]{32}$/);
  const originalUrl = anna.url();
  await join(anna, "Anna");

  // Duplicate from the board menu → navigates to a brand-new board. (That the
  // copy carries NO notes/votes/participants is proven at the wire level in
  // apps/worker/test/m6.test.ts; here we cover the facilitator's UI flow.)
  await anna.getByTestId("board-menu").click();
  await anna.getByTestId("duplicate-board").click();
  await expect(anna).not.toHaveURL(originalUrl); // waits for the async nav
  await expect(anna).toHaveURL(/\/board\/[0-9a-f]{32}$/);

  // The copy is a distinct, fresh board named "Copy of …" — its join screen
  // already proves the new identity. (That the copy carries the source columns
  // and NONE of its notes/participants is proven at the wire level in
  // apps/worker/test/m6.test.ts.)
  await expect(
    anna.getByRole("heading", { name: /Copy of Retro to clone/i }),
  ).toBeVisible();
  await join(anna, "Anna");
  await expect(anna.getByTestId("roster-item")).toHaveCount(1); // fresh roster

  await ctx.close();
});

test("slot-machine picker skin spins to a winner", async ({ browser }) => {
  // NOT reduced-motion: we want the reels to actually render.
  const annaCtx = await browser.newContext();
  const anna = await annaCtx.newPage();
  await anna.goto("/");
  await anna.getByRole("textbox").fill("Sprint 48");
  await anna
    .getByRole("button", { name: /create board|board erstellen/i })
    .click();
  await expect(anna).toHaveURL(/\/board\/[0-9a-f]{32}$/);
  const boardUrl = anna.url();
  await join(anna, "Anna");

  const benCtx = await browser.newContext();
  const ben = await benCtx.newPage();
  await ben.goto(boardUrl);
  await join(ben, "Ben");

  // Switch the picker skin to slots, then close the menu.
  await anna.getByTestId("board-menu").click();
  await anna.getByTestId("picker-style-slots").click();
  await expect(anna.getByTestId("picker-style-slots")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await anna.getByTestId("board-menu").click();

  // Into the present phase (write → present) and spin.
  await anna.getByTestId("phase-next").click();
  await anna.getByTestId("phase-next").click();
  await anna.getByTestId("spin-button").click();

  // The slot machine renders, and every screen lands on the same winner.
  await expect(anna.getByTestId("slot-machine")).toBeVisible();
  await expect(anna.getByTestId("wheel-winner")).toBeVisible({
    timeout: 12_000,
  });
  await expect(ben.getByTestId("wheel-winner")).toBeVisible({
    timeout: 12_000,
  });
  const annaWinner = (
    await anna.getByTestId("wheel-winner").innerText()
  ).trim();
  const benWinner = (await ben.getByTestId("wheel-winner").innerText()).trim();
  expect(annaWinner).toBe(benWinner);

  await annaCtx.close();
  await benCtx.close();
});

async function join(page: Page, name: string): Promise<void> {
  await page.getByRole("textbox").fill(name);
  await page.getByRole("button", { name: /^(join|beitreten)$/i }).click();
  await expect(page.getByTestId("roster-item").first()).toBeVisible();
}
