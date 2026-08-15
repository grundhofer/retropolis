// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "@playwright/test";

// The M0 definition of done: two browsers see each other join a board.
test("two participants meet on a board and see each other live", async ({
  browser,
}) => {
  // Anna creates the board (fresh context = fresh localStorage).
  const annaContext = await browser.newContext();
  const anna = await annaContext.newPage();
  await anna.goto("/");
  await anna.getByRole("textbox").fill("Sprint 42 retro");
  await anna
    .getByRole("button", { name: /create board|board erstellen/i })
    .click();

  await expect(anna).toHaveURL(/\/board\/[0-9a-f]{32}$/);
  const boardUrl = anna.url();

  // Anna joins with her name; as creator she holds the admin capability.
  await anna.getByRole("textbox").fill("Anna");
  await anna.getByRole("button", { name: /join|beitreten/i }).click();
  await expect(anna.getByTestId("roster-item")).toHaveCount(1);
  await expect(anna.getByTestId("roster-item").first()).toContainText("Anna");
  await expect(anna.getByText(/facilitator|moderation/i)).toBeVisible();

  // Ben opens the share link in a second, independent browser context.
  const benContext = await browser.newContext();
  const ben = await benContext.newPage();
  await ben.goto(boardUrl);
  await expect(
    ben.getByRole("heading", { name: /sprint 42 retro/i }),
  ).toBeVisible();
  await ben.getByRole("textbox").fill("Ben");
  await ben.getByRole("button", { name: /join|beitreten/i }).click();

  // Both rosters converge — the realtime loop works end to end.
  await expect(ben.getByTestId("roster-item")).toHaveCount(2);
  await expect(anna.getByTestId("roster-item")).toHaveCount(2);
  await expect(anna.getByTestId("roster-item").nth(1)).toContainText("Ben");
  // Ben is a plain member: exactly one facilitator badge on his screen.
  await expect(ben.getByText(/facilitator|moderation/i)).toHaveCount(1);

  // Ben leaves; Anna sees him go offline (kept in roster, dimmed).
  await benContext.close();
  await expect(anna.getByTestId("roster-item").nth(1)).toContainText(
    /offline/i,
  );

  await annaContext.close();
});

test("a refresh keeps identity: no duplicate participant", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("textbox").fill("Refresh test");
  await page
    .getByRole("button", { name: /create board|board erstellen/i })
    .click();
  await expect(page).toHaveURL(/\/board\/[0-9a-f]{32}$/);
  await page.getByRole("textbox").fill("Anna");
  await page.getByRole("button", { name: /join|beitreten/i }).click();
  await expect(page.getByTestId("roster-item")).toHaveCount(1);

  await page.reload();
  // The stored display name pre-fills the join form; rejoin reclaims identity.
  await page.getByRole("button", { name: /join|beitreten/i }).click();
  await expect(page.getByTestId("roster-item")).toHaveCount(1);
  await expect(page.getByTestId("roster-item").first()).toContainText("Anna");

  await context.close();
});

test("an unknown board id shows the not-found page", async ({ page }) => {
  await page.goto(`/board/${"0".repeat(32)}`);
  await expect(
    page.getByText(/board not found|board nicht gefunden/i),
  ).toBeVisible();
});
