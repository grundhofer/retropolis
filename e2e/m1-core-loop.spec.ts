import { expect, test, type Page } from "@playwright/test";

// The M1 acceptance flow: private write with ghost cards and ready-check,
// reveal on phase change, reactions, rewind hiding notes again, and the timer.
test("write → reveal core loop with two participants", async ({ browser }) => {
  const annaContext = await browser.newContext();
  const anna = await annaContext.newPage();
  await anna.goto("/");
  await anna.getByRole("textbox").fill("Sprint 42 retro");
  await anna
    .getByRole("button", { name: /create board|board erstellen/i })
    .click();
  await expect(anna).toHaveURL(/\/board\/[0-9a-f]{32}$/);
  const boardUrl = anna.url();
  await join(anna, "Anna");

  const benContext = await browser.newContext();
  const ben = await benContext.newPage();
  await ben.goto(boardUrl);
  await join(ben, "Ben");
  await expect(anna.getByTestId("roster-item")).toHaveCount(2);

  // Admin starts the retro → write phase for everyone.
  await anna.getByTestId("phase-next").click();
  const annaComposer = anna
    .getByPlaceholder(/write a note|notiz schreiben/i)
    .first();
  await expect(annaComposer).toBeVisible();
  const benComposer = ben
    .getByPlaceholder(/write a note|notiz schreiben/i)
    .first();
  await expect(benComposer).toBeVisible();

  // Ghost cards: Ben sees THAT Anna writes, not WHAT.
  await annaComposer.click();
  await expect(ben.getByTestId("ghost-card")).toBeVisible();
  await expect(ben.getByText(/Anna (is writing|schreibt)/)).toBeVisible();

  // Anna adds her note; Ben must not see a trace of it.
  await annaComposer.fill("Secret note from Anna");
  await annaComposer.press("Enter");
  await expect(anna.getByText("Secret note from Anna")).toBeVisible();
  await expect(ben.getByTestId("note-card")).toHaveCount(0);
  await expect(ben.getByText("Secret note from Anna")).toHaveCount(0);

  // Ben writes his own — Anna doesn't see it either.
  await benComposer.fill("Ben's point");
  await benComposer.press("Enter");
  await expect(ben.getByText("Ben's point")).toBeVisible();
  await expect(anna.getByText("Ben's point")).toHaveCount(0);

  // Ready-check aggregates across the room.
  await ben.getByTestId("ready-toggle").click();
  await expect(anna.getByTestId("ready-count")).toContainText("1/2");
  await anna.getByTestId("ready-toggle").click();
  await expect(anna.getByTestId("ready-count")).toContainText("2/2");

  // Reveal: everyone sees everything, author chips included.
  await anna.getByTestId("phase-next").click();
  await expect(ben.getByText("Secret note from Anna")).toBeVisible();
  await expect(anna.getByText("Ben's point")).toBeVisible();

  // Reactions after reveal, live for the author.
  const annasNoteOnBensScreen = ben
    .getByTestId("note-card")
    .filter({ hasText: "Secret note from Anna" });
  await annasNoteOnBensScreen.getByTestId("react-👍").click();
  await expect(
    anna
      .getByTestId("note-card")
      .filter({ hasText: "Secret note from Anna" })
      .getByTestId("react-👍"),
  ).toContainText("1");

  // Rewind to write: Anna's note disappears from Ben's board again.
  await anna.getByTestId("phase-back").click();
  await expect(ben.getByText("Secret note from Anna")).toHaveCount(0);
  await expect(ben.getByText("Ben's point")).toBeVisible();

  // Timer: admin starts 5 minutes, both see the countdown; Ben has no controls.
  await anna.getByRole("button", { name: "5m", exact: true }).click();
  await expect(anna.getByTestId("timer-display")).toContainText(
    /0?4:5\d|05:00/,
  );
  await expect(ben.getByTestId("timer-display")).toBeVisible();
  await expect(ben.getByRole("button", { name: /pause/i })).toHaveCount(0);

  await annaContext.close();
  await benContext.close();
});

test("board is created with localized template columns", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox").fill("Template check");
  await page
    .getByLabel(/template|vorlage/i)
    .selectOption("start-stop-continue");
  await page
    .getByRole("button", { name: /create board|board erstellen/i })
    .click();
  await expect(page).toHaveURL(/\/board\/[0-9a-f]{32}$/);
  await join(page, "Solo");
  await page.getByTestId("phase-next").click();
  await expect(page.getByRole("heading", { name: /^start/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^stop/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^continue/i })).toBeVisible();
});

test("a note written while offline is delivered after reconnect", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("textbox").fill("Offline resilience");
  await page
    .getByRole("button", { name: /create board|board erstellen/i })
    .click();
  await expect(page).toHaveURL(/\/board\/[0-9a-f]{32}$/);
  await join(page, "Anna");
  await page.getByTestId("phase-next").click();

  const composer = page
    .getByPlaceholder(/write a note|notiz schreiben/i)
    .first();
  await expect(composer).toBeVisible();

  // Cut the network and force the socket closed (offline emulation alone
  // does not terminate an established WebSocket), then write into the void.
  await context.setOffline(true);
  await page.evaluate(() =>
    (
      window as unknown as { __retropolisWs?: { reconnect: () => void } }
    ).__retropolisWs?.reconnect(),
  );
  await expect(page.getByRole("status")).toBeVisible(); // offline banner
  await composer.fill("Written while offline");
  await composer.press("Enter");
  await expect(page.getByText("Written while offline")).toBeVisible(); // optimistic
  await context.setOffline(false);

  // The queued command flushes after the rejoin; a reload proves the note
  // was actually persisted server-side, not just rendered optimistically.
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 20_000 });
  await page.reload();
  await page.getByRole("button", { name: /^(join|beitreten)$/i }).click();
  await expect(page.getByText("Written while offline")).toBeVisible({
    timeout: 20_000,
  });

  await context.close();
});

async function join(page: Page, name: string): Promise<void> {
  await page.getByRole("textbox").fill(name);
  await page.getByRole("button", { name: /^(join|beitreten)$/i }).click();
  await expect(page.getByTestId("roster-item").first()).toBeVisible();
}
