import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { Column, Note, Participant } from "@retropolis/shared";
import "../i18n.js";
import { ConnectionProvider } from "../lib/connection.js";
import { BoardCanvas } from "./BoardCanvas.js";

const you: Participant = {
  id: "p1",
  name: "Anna",
  color: "#E8590C",
  role: "facilitator",
  online: true,
};
const column: Column = {
  id: "c".repeat(32),
  name: "Went well",
  order: 0,
  hidden: false,
};
const note: Note = {
  id: "a".repeat(32),
  columnId: column.id,
  authorId: you.id,
  text: "Deploys are slow",
  gifUrl: null,
  order: 1,
  x: 0.5,
  y: 0.5,
  groupId: null,
  reactions: {},
};

// THE free-tier gate: dragging a card must never touch the wire until it lands.
test("canvas drag commits exactly ONE note.move on drop and ZERO during the move", async () => {
  const mutate = vi.fn();
  const send = vi.fn();
  const screen = await render(
    <ConnectionProvider value={{ mutate, send }}>
      <BoardCanvas
        columns={[column]}
        notes={[note]}
        columnCounts={{}}
        roster={[you]}
        you={you}
        phase="write"
        editing={{}}
        isAdmin
        presenterId={null}
        gifsEnabled={false}
      />
    </ConnectionProvider>,
  );

  const card = screen.getByTestId("note-card").element();
  const wrapper = card.parentElement as HTMLElement;
  const zone = screen.getByTestId(`zone-${column.id}`).element() as HTMLElement;
  const rect = zone.getBoundingClientRect();
  // Drop at ~25% of the zone — a real position change (the note sits at 0.5).
  const dropX = rect.left + rect.width * 0.25;
  const dropY = rect.top + rect.height * 0.25;
  const ev = (type: string, x: number, y: number) =>
    new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
  // Real pointer events arrive across ticks; flush React state between them so
  // the move/up handlers see the drag started on pointerdown.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  wrapper.dispatchEvent(ev("pointerdown", rect.left + 40, rect.top + 40));
  await tick();
  wrapper.dispatchEvent(ev("pointermove", rect.left + 60, rect.top + 60));
  await tick();
  wrapper.dispatchEvent(ev("pointermove", dropX, dropY));
  await tick();
  // No network yet — the whole point of commit-on-drop.
  expect(mutate).not.toHaveBeenCalled();

  wrapper.dispatchEvent(ev("pointerup", dropX, dropY));
  await tick();
  expect(mutate).toHaveBeenCalledTimes(1);
  const command = mutate.mock.calls[0]?.[0] as {
    type: string;
    noteId: string;
    columnId: string;
    x: number;
    y: number;
  };
  expect(command.type).toBe("note.move");
  expect(command.noteId).toBe(note.id);
  expect(command.columnId).toBe(column.id);
  expect(command.x).toBeGreaterThanOrEqual(0);
  expect(command.x).toBeLessThanOrEqual(1);
});

test("double-clicking empty canvas space opens a composer", async () => {
  const mutate = vi.fn();
  const send = vi.fn();
  const screen = await render(
    <ConnectionProvider value={{ mutate, send }}>
      <BoardCanvas
        columns={[column]}
        notes={[]}
        columnCounts={{}}
        roster={[you]}
        you={you}
        phase="write"
        editing={{}}
        isAdmin
        presenterId={null}
        gifsEnabled={false}
      />
    </ConnectionProvider>,
  );

  const zone = screen.getByTestId(`zone-${column.id}`).element() as HTMLElement;
  const rect = zone.getBoundingClientRect();
  zone.dispatchEvent(
    new MouseEvent("dblclick", {
      clientX: rect.left + rect.width * 0.5,
      clientY: rect.top + rect.height * 0.5,
      bubbles: true,
    }),
  );
  await expect
    .element(screen.getByTestId("canvas-composer"))
    .toBeInTheDocument();
});
