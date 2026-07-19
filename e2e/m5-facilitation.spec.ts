import { expect, test, type Page } from "@playwright/test";

// M5 acceptance: the check-in warm-up (icebreaker + shuffle + agreements) and
// the anonymous ROTI closing poll. Check-in is off by default and has no
// creation toggle in the UI, so we opt in through the API (which exercises the
// checkin:true flag) and seed the creator's admin token.
test("check-in icebreaker, agreements, and anonymous ROTI", async ({
  browser,
}) => {
  const annaContext = await browser.newContext({ reducedMotion: "reduce" });
  const created = await annaContext.request.post("/api/boards", {
    data: { name: "Sprint 46 retro", checkin: true, locale: "en" },
  });
  expect(created.ok()).toBe(true);
  const { boardId, adminToken } = (await created.json()) as {
    boardId: string;
    adminToken: string;
  };
  await annaContext.addInitScript(
    (data: { boardId: string; adminToken: string }) => {
      localStorage.setItem(
        `retropolis.board.${data.boardId}.adminToken`,
        data.adminToken,
      );
    },
    { boardId, adminToken },
  );
  const anna = await annaContext.newPage();
  const boardUrl = `/board/${boardId}`;
  await anna.goto(boardUrl);
  await join(anna, "Anna");

  const benContext = await browser.newContext({ reducedMotion: "reduce" });
  const ben = await benContext.newPage();
  await ben.goto(boardUrl);
  await join(ben, "Ben");
  await expect(anna.getByTestId("roster-item")).toHaveCount(2);

  // A third participant — the anonymous ROTI needs three responses before it
  // will reveal an average (see below).
  const caraContext = await browser.newContext({ reducedMotion: "reduce" });
  const cara = await caraContext.newPage();
  await cara.goto(boardUrl);
  await join(cara, "Cara");
  await expect(anna.getByTestId("roster-item")).toHaveCount(3);

  // First "next" enters the check-in phase — an icebreaker appears for both.
  await anna.getByTestId("phase-next").click();
  await expect(anna.getByTestId("icebreaker-question")).toBeVisible();
  await expect(ben.getByTestId("icebreaker-question")).toBeVisible();
  const first = (
    await ben.getByTestId("icebreaker-question").innerText()
  ).trim();

  // Admin shuffles → both screens get the same NEW question.
  await anna.getByTestId("icebreaker-shuffle").click();
  await expect(ben.getByTestId("icebreaker-question")).not.toHaveText(first, {
    timeout: 10_000,
  });
  await expect(anna.getByTestId("icebreaker-question")).not.toHaveText(first, {
    timeout: 10_000,
  });
  const second = (
    await ben.getByTestId("icebreaker-question").innerText()
  ).trim();
  await expect(anna.getByTestId("icebreaker-question")).toHaveText(second);

  // Facilitator edits the working agreements; Ben sees the change.
  await anna.getByTestId("agreements-edit").click();
  await anna.getByTestId("agreements-input").fill("Cameras on, phones away.");
  await anna.getByRole("button", { name: /^(save|speichern)$/i }).click();
  await expect(ben.getByText("Cameras on, phones away.")).toBeVisible();

  // Walk to the close phase (write → present → vote → discuss → close).
  for (let i = 0; i < 5; i++) await anna.getByTestId("phase-next").click();
  await expect(anna.getByTestId("roti-poll")).toBeVisible();
  await expect(ben.getByTestId("roti-poll")).toBeVisible();

  // Below three responses the average is withheld — one or two scores would
  // deanonymize. Anna rates 5, Ben rates 3: everyone sees a pending count, no
  // average yet.
  await anna.getByTestId("roti-5").click();
  await ben.getByTestId("roti-3").click();
  await expect(ben.getByTestId("roti-pending")).toBeVisible();
  await expect(ben.getByTestId("roti-result")).toHaveCount(0);

  // Cara's vote is the third → the anonymous average (4) now appears for all.
  await cara.getByTestId("roti-4").click();
  await expect(anna.getByTestId("roti-result")).toContainText("4");
  await expect(ben.getByTestId("roti-result")).toContainText("4");
  // Anna's own selection is highlighted for her; Ben can't tell it was a 5.
  await expect(anna.getByTestId("roti-5")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(ben.getByTestId("roti-5")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await annaContext.close();
  await benContext.close();
  await caraContext.close();
});

async function join(page: Page, name: string): Promise<void> {
  await page.getByRole("textbox").fill(name);
  await page.getByRole("button", { name: /^(join|beitreten)$/i }).click();
  await expect(page.getByTestId("roster-item").first()).toBeVisible();
}
