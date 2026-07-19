import { expect, test, type Page } from "@playwright/test";

// M2 acceptance: the wheel picks the same person on every screen, rotates
// without repeats until everyone presented, grouping syncs, handoff works.
test("wheel rotation, presenter focus, grouping and handoff", async ({
  browser,
}) => {
  const annaContext = await browser.newContext({ reducedMotion: "reduce" });
  const anna = await annaContext.newPage();
  await anna.goto("/");
  await anna.getByRole("textbox").fill("Sprint 43 retro");
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
  await expect(anna.getByTestId("roster-item")).toHaveCount(2);

  // Write phase: each writes a duplicate-ish point.
  await anna.getByTestId("phase-next").click();
  const annaComposer = anna
    .getByPlaceholder(/write a note|notiz schreiben/i)
    .first();
  await annaComposer.fill("Deploys are slow");
  await annaComposer.press("Enter");
  const benComposer = ben
    .getByPlaceholder(/write a note|notiz schreiben/i)
    .first();
  await benComposer.fill("Deploys take forever");
  await benComposer.press("Enter");

  // Present phase: the wheel appears.
  await anna.getByTestId("phase-next").click();
  await expect(anna.getByTestId("spin-button")).toBeVisible();
  await expect(ben.getByTestId("spin-button")).toHaveCount(0); // members don't spin

  // Spin 1: reduced motion skips the animation; the SAME winner shows on
  // both screens (server-drawn, seed-synced).
  await anna.getByTestId("spin-button").click();
  await expect(anna.getByTestId("wheel-winner")).toBeVisible();
  await expect(ben.getByTestId("wheel-winner")).toBeVisible();
  const winnerTextAnna = (
    await anna.getByTestId("wheel-winner").innerText()
  ).trim();
  const winnerTextBen = (
    await ben.getByTestId("wheel-winner").innerText()
  ).trim();
  expect(winnerTextAnna).toBe(winnerTextBen);
  const firstPresenter = winnerTextAnna.includes("Anna") ? "Anna" : "Ben";

  // Presenter banner is synced.
  await expect(anna.getByTestId("presenter-banner")).toContainText(
    firstPresenter,
  );
  await expect(ben.getByTestId("presenter-banner")).toContainText(
    firstPresenter,
  );

  // Presenter isolation: once someone holds the mic, every screen shows only
  // that person's cards; everyone else's are hidden until the round moves on.
  await anna.getByTestId("wheel-winner").waitFor({ state: "hidden" });
  const presenterNote =
    firstPresenter === "Anna" ? "Deploys are slow" : "Deploys take forever";
  const otherNote =
    firstPresenter === "Anna" ? "Deploys take forever" : "Deploys are slow";
  await expect(ben.getByText(presenterNote)).toBeVisible();
  await expect(ben.getByText(otherNote)).toHaveCount(0);

  // Spin 2: the other person — no repeats.
  const secondPresenter = firstPresenter === "Anna" ? "Ben" : "Anna";
  await anna.getByTestId("wheel-winner").waitFor({ state: "hidden" });
  await anna.getByTestId("spin-button").click();
  await expect(anna.getByTestId("presenter-banner")).toContainText(
    secondPresenter,
    {
      timeout: 15_000,
    },
  );

  // Completing the final presenter finishes the rotation on all screens.
  await anna.getByTestId("wheel-winner").waitFor({ state: "hidden" });
  await anna.getByTestId("spin-button").click();
  await expect(anna.getByTestId("picker-finished")).toBeVisible();
  await expect(ben.getByTestId("picker-finished")).toBeVisible();

  // Grouping: drag Ben's duplicate onto Anna's note — stack appears for both.
  const source = ben
    .getByTestId("note-card")
    .filter({ hasText: "Deploys take forever" });
  const target = ben
    .getByTestId("note-card")
    .filter({ hasText: "Deploys are slow" });
  await source.dragTo(target);
  await expect(ben.getByTestId("note-stack")).toBeVisible();
  await expect(anna.getByTestId("note-stack")).toBeVisible();
  await expect(anna.getByTestId("note-stack")).toContainText("×2");

  // Unstack dissolves the two-note group everywhere.
  await ben
    .getByTestId("note-stack")
    .getByRole("button", { name: /unstack|aus stapel/i })
    .first()
    .click();
  await expect(anna.getByTestId("note-stack")).toHaveCount(0);

  // Handoff: Anna promotes Ben via the avatar menu; Ben gains admin controls.
  await expect(ben.getByTestId("phase-next")).toHaveCount(0);
  await anna.getByTestId("avatar-Ben").click();
  await anna.getByTestId("role-toggle-Ben").click();
  await expect(ben.getByTestId("phase-next")).toBeVisible();

  await annaContext.close();
  await benContext.close();
});

async function join(page: Page, name: string): Promise<void> {
  await page.getByRole("textbox").fill(name);
  await page.getByRole("button", { name: /^(join|beitreten)$/i }).click();
  await expect(page.getByTestId("roster-item").first()).toBeVisible();
}
