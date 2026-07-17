import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { Participant } from "@retropolis/shared";
import "../i18n.js";
import { Roster } from "./Roster.js";

const anna: Participant = {
  id: "p1",
  name: "Anna",
  color: "#E8590C",
  role: "facilitator",
  online: true,
};
const ben: Participant = {
  id: "p2",
  name: "Ben",
  color: "#1971C2",
  role: "member",
  online: false,
};

test("renders all participants with facilitator badge and offline state", async () => {
  const screen = await render(
    <Roster participants={[anna, ben]} youId={ben.id} />,
  );

  await expect.element(screen.getByText("Anna")).toBeInTheDocument();
  await expect.element(screen.getByText(/Ben/)).toBeInTheDocument();
  await expect
    .element(screen.getByText(/Facilitator|Moderation/))
    .toBeInTheDocument();

  const items = screen.getByTestId("roster-item").elements();
  expect(items).toHaveLength(2);
  const benItem = items[1] as HTMLElement;
  expect(benItem.className).toContain("opacity-45");
});

test("marks the current user with a (you) suffix", async () => {
  const screen = await render(<Roster participants={[anna]} youId={anna.id} />);
  await expect.element(screen.getByText(/\((you|du)\)/)).toBeInTheDocument();
});
