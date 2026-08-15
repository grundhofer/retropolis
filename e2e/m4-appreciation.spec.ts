// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test, type Page } from "@playwright/test";

// M4 acceptance: the appreciation wall (kudos with anonymity), export, and
// admin delete-now. Reduced motion for deterministic transitions.
test("kudos wall, export and delete-now", async ({ browser }) => {
  const annaContext = await browser.newContext({ reducedMotion: "reduce" });
  const anna = await annaContext.newPage();
  await anna.goto("/");
  await anna.getByRole("textbox").fill("Sprint 45 retro");
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

  // Walk to the close phase (write → present → vote → discuss → close).
  for (let i = 0; i < 5; i++) await anna.getByTestId("phase-next").click();
  await expect(
    anna.getByRole("heading", { name: /appreciation|wertschätzung/i }),
  ).toBeVisible();
  await expect(
    ben.getByRole("heading", { name: /appreciation|wertschätzung/i }),
  ).toBeVisible();

  // Anna sends a named kudo to Ben.
  await anna.getByTestId("kudo-type-great-job").click();
  await anna.getByTestId("kudo-recipient").selectOption({ label: "Ben" });
  await anna.getByTestId("kudo-text").fill("shipped the wheel");
  await anna.getByTestId("kudo-send").click();

  // Both see the card; Ben sees Anna is the sender.
  const bensView = ben
    .getByTestId("kudo-card")
    .filter({ hasText: "shipped the wheel" });
  await expect(bensView).toBeVisible();
  await expect(bensView).toContainText("Anna");

  // Ben sends an ANONYMOUS kudo to Anna.
  await ben.getByTestId("kudo-recipient").selectOption({ label: "Anna" });
  await ben.getByTestId("kudo-text").fill("quietly grateful");
  await ben.getByLabel(/send anonymously|anonym senden/i).check();
  await ben.getByTestId("kudo-send").click();

  // Anna sees the kudo but NOT that it came from Ben.
  const annasView = anna
    .getByTestId("kudo-card")
    .filter({ hasText: "quietly grateful" });
  await expect(annasView).toBeVisible();
  await expect(annasView).toContainText(/anonymous|anonym/i);
  await expect(annasView).not.toContainText("Ben");

  // Export: the Markdown download carries the kudos, authors excluded by default.
  const exportUrl =
    new URL(boardUrl).pathname.replace("/board/", "/api/boards/") +
    "/export?format=md";
  const md = await anna.request.get(exportUrl);
  expect(md.ok()).toBe(true);
  const body = await md.text();
  expect(body).toContain("# Sprint 45 retro");
  expect(body).toContain("shipped the wheel");
  // Kudo SENDERS are excluded by default (recipients are always named — that's
  // inherent to appreciation). Anna's kudo must not attribute her as sender.
  expect(body).not.toContain("— Anna");

  // Finish and archive: the wall persists read-only on the done screen.
  await anna.getByTestId("phase-next").click();
  await expect(
    anna.getByText(/retro finished|retro abgeschlossen/i),
  ).toBeVisible();
  await expect(anna.getByTestId("kudo-card").first()).toBeVisible();

  // Admin delete-now removes the board for everyone.
  await anna.getByTestId("board-menu").click();
  await anna.getByTestId("delete-board").click();
  await anna.getByTestId("delete-board-confirm").click();
  await expect(ben.getByText(/board deleted|board gelöscht/i)).toBeVisible({
    timeout: 15_000,
  });

  await annaContext.close();
  await benContext.close();
});

test("GIF search degrades gracefully with no key configured", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("textbox").fill("Gif board");
  await page
    .getByRole("button", { name: /create board|board erstellen/i })
    .click();
  await expect(page).toHaveURL(/\/board\/[0-9a-f]{32}$/);
  await join(page, "Solo");
  await page.getByTestId("phase-next").click(); // write

  const columnId = await page
    .getByTestId(/^composer-/)
    .first()
    .getAttribute("data-testid");
  const suffix = columnId!.replace("composer-", "");
  await page.getByTestId(`composer-gif-${suffix}`).click();
  await page.getByTestId("gif-search").fill("celebrate");
  await expect(page.getByText(/isn't set up|nicht eingerichtet/i)).toBeVisible({
    timeout: 10_000,
  });

  await context.close();
});

async function join(page: Page, name: string): Promise<void> {
  await page.getByRole("textbox").fill(name);
  await page.getByRole("button", { name: /^(join|beitreten)$/i }).click();
  await expect(page.getByTestId("roster-item").first()).toBeVisible();
}
