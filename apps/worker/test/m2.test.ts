import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@retropolis/shared";
import { boardStub } from "../src/board-stub.js";
import { connect, createBoard, type TestSocket } from "./helpers.js";

// The in-flight guard blocks spins while the wheel animates (4.5s) — tests
// fast-forward by backdating the persisted spin instead of sleeping.
async function finishSpinAnimation(boardId: string): Promise<void> {
  const stub = boardStub(env, boardId);
  await runInDurableObject(stub, (_instance, state) => {
    const row = state.storage.sql
      .exec("SELECT value FROM board_meta WHERE key = 'lastSpin'")
      .toArray()[0];
    if (!row) return;
    const spin = JSON.parse(String(row.value)) as {
      startAt: number;
      durationMs: number;
    };
    spin.startAt = Date.now() - spin.durationMs - 10_000;
    state.storage.sql.exec(
      "UPDATE board_meta SET value = ? WHERE key = 'lastSpin'",
      JSON.stringify(spin),
    );
  });
}

let opCounter = 1000;
function opId(): string {
  return (opCounter++).toString(16).padStart(32, "0");
}
function newId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

type SyncEvent = Extract<ServerEvent, { type: "sync" }>;

async function joined(
  boardId: string,
  name: string,
  adminToken?: string,
): Promise<{ socket: TestSocket; you: SyncEvent["you"]; sync: SyncEvent }> {
  const socket = await connect(boardId);
  socket.send({
    type: "join",
    name,
    ...(adminToken === undefined ? {} : { adminToken }),
  });
  const sync = await socket.waitFor((e) => e.type === "sync");
  if (sync.type !== "sync") throw new Error("unreachable");
  return { socket, you: sync.you, sync };
}

async function toPhase(socket: TestSocket, phase: string) {
  socket.send({ type: "admin.phase.set", phase });
  await socket.waitFor((e) => e.type === "phase.changed" && e.phase === phase);
}

async function presentingBoard() {
  const { boardId, adminToken } = await createBoard();
  const admin = await joined(boardId, "Anna", adminToken);
  const ben = await joined(boardId, "Ben");
  await toPhase(admin.socket, "write");
  await toPhase(admin.socket, "present");
  return { boardId, adminToken, admin, ben };
}

async function createNote(
  socket: TestSocket,
  columnId: string,
  text: string,
): Promise<string> {
  const noteId = newId();
  socket.send({ type: "note.create", opId: opId(), noteId, columnId, text });
  await socket.waitFor(
    (e) => e.type === "note.created" && e.note.id === noteId,
  );
  return noteId;
}

describe("picker rotation", () => {
  it("initializes the pool with online participants on entering present", async () => {
    const { admin, ben } = await presentingBoard();
    const changed = await admin.socket.waitFor(
      (e) => e.type === "picker.changed",
    );
    if (changed.type !== "picker.changed") throw new Error("unreachable");
    expect(changed.picker.remaining.sort()).toEqual(
      [admin.you.id, ben.you.id].sort(),
    );
    expect(changed.picker.presented).toEqual([]);
    expect(changed.picker.current).toBeNull();
  });

  it("facilitator can hand-pick the next presenter directly (no wheel)", async () => {
    const { admin, ben } = await presentingBoard();
    await admin.socket.waitFor((e) => e.type === "picker.changed");

    admin.socket.send({
      type: "admin.picker.pick",
      participantId: ben.you.id,
    });
    const picked = await ben.socket.waitFor(
      (e) => e.type === "picker.changed" && e.picker.current === ben.you.id,
    );
    if (picked.type !== "picker.changed") throw new Error("unreachable");
    expect(picked.picker.remaining).not.toContain(ben.you.id);
    expect(picked.picker.presented).toEqual([]);

    // Picking the next person auto-completes the one who was up.
    admin.socket.send({
      type: "admin.picker.pick",
      participantId: admin.you.id,
    });
    const second = await admin.socket.waitFor(
      (e) => e.type === "picker.changed" && e.picker.current === admin.you.id,
    );
    if (second.type !== "picker.changed") throw new Error("unreachable");
    expect(second.picker.presented).toEqual([ben.you.id]);

    // Members cannot hand-pick.
    ben.socket.send({ type: "admin.picker.pick", participantId: ben.you.id });
    const rejected = await ben.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("NOT_ADMIN");
  });

  it("the person on stage can mark their own turn done", async () => {
    const { admin, ben } = await presentingBoard();
    await admin.socket.waitFor((e) => e.type === "picker.changed");
    admin.socket.send({
      type: "admin.picker.pick",
      participantId: ben.you.id,
    });
    await ben.socket.waitFor(
      (e) => e.type === "picker.changed" && e.picker.current === ben.you.id,
    );

    // Someone who isn't presenting can't end the turn.
    admin.socket.send({ type: "picker.done" });
    const wrong = await admin.socket.waitFor((e) => e.type === "reject");
    if (wrong.type !== "reject") throw new Error("unreachable");
    expect(wrong.code).toBe("INVALID");

    // The presenter self-advances; control hands back to the wheel. (Match on
    // presented so the initial pool-init picker.changed doesn't satisfy it.)
    ben.socket.send({ type: "picker.done" });
    const done = await admin.socket.waitFor(
      (e) =>
        e.type === "picker.changed" &&
        e.picker.current === null &&
        e.picker.presented.includes(ben.you.id),
    );
    if (done.type !== "picker.changed") throw new Error("unreachable");
    expect(done.picker.presented).toContain(ben.you.id);
  });

  it("spins draw without replacement until everyone presented, synced to all", async () => {
    const { boardId, admin, ben } = await presentingBoard();
    await admin.socket.waitFor((e) => e.type === "picker.changed");

    admin.socket.send({ type: "admin.picker.spin" });
    const spin1 = await ben.socket.waitFor((e) => e.type === "picker.spun");
    if (spin1.type !== "picker.spun") throw new Error("unreachable");
    expect(spin1.pool).toHaveLength(2);
    expect(spin1.pool).toContain(spin1.winnerId);
    expect(spin1.picker.current).toBe(spin1.winnerId);
    expect(spin1.picker.remaining).toHaveLength(1);
    expect(spin1.durationMs).toBeGreaterThan(0);

    // An immediate second spin is refused while the wheel is animating —
    // a facilitator double-click must not rob the winner of their turn.
    admin.socket.send({ type: "admin.picker.spin" });
    const guarded = await admin.socket.waitFor((e) => e.type === "reject");
    if (guarded.type !== "reject") throw new Error("unreachable");
    expect(guarded.code).toBe("INVALID");

    await finishSpinAnimation(boardId);
    admin.socket.send({ type: "admin.picker.spin" });
    const spin2 = await ben.socket.waitFor(
      (e) => e.type === "picker.spun" && e.seq > spin1.seq,
    );
    if (spin2.type !== "picker.spun") throw new Error("unreachable");
    expect(spin2.winnerId).not.toBe(spin1.winnerId); // no repeats
    expect(spin2.picker.presented).toEqual([spin1.winnerId]);
    expect(spin2.picker.remaining).toHaveLength(0);

    // Completing the final presenter yields the finished state.
    await finishSpinAnimation(boardId);
    admin.socket.send({ type: "admin.picker.spin" });
    const finished = await ben.socket.waitFor(
      (e) =>
        e.type === "picker.changed" &&
        e.picker.current === null &&
        e.picker.remaining.length === 0 &&
        e.picker.presented.length === 2,
    );
    expect(finished.type).toBe("picker.changed");
  });

  it("skip returns the current presenter to the pool", async () => {
    const { admin, ben } = await presentingBoard();
    await admin.socket.waitFor((e) => e.type === "picker.changed");
    admin.socket.send({ type: "admin.picker.spin" });
    const spun = await admin.socket.waitFor((e) => e.type === "picker.spun");
    if (spun.type !== "picker.spun") throw new Error("unreachable");

    admin.socket.send({ type: "admin.picker.skip" });
    const changed = await ben.socket.waitFor(
      (e) => e.type === "picker.changed" && e.picker.current === null,
    );
    if (changed.type !== "picker.changed") throw new Error("unreachable");
    expect(changed.picker.remaining).toContain(spun.winnerId);
    expect(changed.picker.presented).toHaveLength(0);
  });

  it("members cannot spin; exclude/include adjust the pool", async () => {
    const { admin, ben } = await presentingBoard();
    await admin.socket.waitFor((e) => e.type === "picker.changed");

    ben.socket.send({ type: "admin.picker.spin" });
    const rejected = await ben.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("NOT_ADMIN");

    admin.socket.send({
      type: "admin.picker.exclude",
      participantId: ben.you.id,
    });
    const excluded = await admin.socket.waitFor(
      (e) =>
        e.type === "picker.changed" && !e.picker.remaining.includes(ben.you.id),
    );
    expect(excluded.type).toBe("picker.changed");

    admin.socket.send({
      type: "admin.picker.include",
      participantId: ben.you.id,
    });
    await admin.socket.waitFor(
      (e) =>
        e.type === "picker.changed" && e.picker.remaining.includes(ben.you.id),
    );
  });

  it("latecomers during present auto-join the pool; picker survives rewinds", async () => {
    const { boardId, admin } = await presentingBoard();
    await admin.socket.waitFor((e) => e.type === "picker.changed");

    const cara = await joined(boardId, "Cara");
    expect(cara.sync.picker?.remaining).toContain(cara.you.id);
    await admin.socket.waitFor(
      (e) =>
        e.type === "picker.changed" && e.picker.remaining.includes(cara.you.id),
    );

    // Rewind to write and back: pool must persist, not reinitialize.
    admin.socket.send({ type: "admin.picker.spin" });
    const spun = await admin.socket.waitFor((e) => e.type === "picker.spun");
    if (spun.type !== "picker.spun") throw new Error("unreachable");
    admin.socket.send({ type: "admin.phase.set", phase: "write" });
    await admin.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === "write",
    );
    admin.socket.send({ type: "admin.phase.set", phase: "present" });
    await admin.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === "present",
    );
    admin.socket.send({ type: "resync" });
    const sync = await admin.socket.waitFor(
      (e) => e.type === "sync" && e.picker !== null,
    );
    if (sync.type !== "sync") throw new Error("unreachable");
    expect(sync.picker?.current).toBe(spun.winnerId); // not reset
  });
});

describe("write-phase card counts", () => {
  it("broadcasts anonymized per-column totals during write (no author, no text)", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    await toPhase(admin.socket, "write");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");

    // Ben cannot see Anna's note before the reveal — but learns the count.
    await createNote(admin.socket, columnId, "secret");
    const counts = await ben.socket.waitFor(
      (e) =>
        e.type === "board.columnCounts" && (e.counts[columnId] ?? 0) === 1,
    );
    if (counts.type !== "board.columnCounts") throw new Error("unreachable");
    expect(counts.counts[columnId]).toBe(1);
    // The note body never crossed to Ben.
    expect(ben.socket.events.some((e) => e.type === "note.created")).toBe(
      false,
    );

    // A second author's note bumps the total to 2 for everyone.
    await createNote(ben.socket, columnId, "mine");
    const bumped = await admin.socket.waitFor(
      (e) =>
        e.type === "board.columnCounts" && (e.counts[columnId] ?? 0) === 2,
    );
    expect(bumped.type).toBe("board.columnCounts");
  });
});

describe("canvas layout & positions", () => {
  it("facilitator switches layout live; members get config.changed; members cannot", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    expect(admin.sync.config.layout).toBe("columns");

    admin.socket.send({ type: "admin.layout.set", layout: "canvas" });
    const changed = await ben.socket.waitFor(
      (e) => e.type === "config.changed" && e.config.layout === "canvas",
    );
    expect(changed.type).toBe("config.changed");

    ben.socket.send({ type: "admin.layout.set", layout: "columns" });
    const rejected = await ben.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("NOT_ADMIN");
  });

  it("a board created with layout:canvas reports it in sync", async () => {
    const { boardId, adminToken } = await createBoard("Canvas", {
      layout: "canvas",
    });
    const admin = await joined(boardId, "Anna", adminToken);
    expect(admin.sync.config.layout).toBe("canvas");
  });

  it("a note created with a canvas position round-trips", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    await toPhase(admin.socket, "write");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    const noteId = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId,
      text: "placed",
      x: 0.9,
      y: 0.1,
    });
    const created = await admin.socket.waitFor(
      (e) => e.type === "note.created" && e.note.id === noteId,
    );
    if (created.type !== "note.created") throw new Error("unreachable");
    expect(created.note.x).toBe(0.9);
    expect(created.note.y).toBe(0.1);
  });

  it("a same-zone canvas reposition (x present) is persisted, not swallowed as a no-op", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    await toPhase(admin.socket, "write");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    const noteId = await createNote(admin.socket, columnId, "hi");
    admin.socket.send({
      type: "note.move",
      opId: opId(),
      noteId,
      columnId,
      x: 0.25,
      y: 0.75,
    });
    const moved = await admin.socket.waitFor(
      (e) => e.type === "note.updated" && e.note.id === noteId && e.note.x === 0.25,
    );
    if (moved.type !== "note.updated") throw new Error("unreachable");
    expect(moved.note.y).toBe(0.75);
    expect(moved.note.columnId).toBe(columnId);
  });

  it("a cross-zone canvas drop persists the new position and clears the group", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    await toPhase(admin.socket, "write");
    const col0 = admin.sync.columns[0]?.id;
    const col1 = admin.sync.columns[1]?.id;
    if (!col0 || !col1) throw new Error("setup");
    const noteId = await createNote(admin.socket, col0, "move me");
    admin.socket.send({
      type: "note.move",
      opId: opId(),
      noteId,
      columnId: col1,
      x: 0.6,
      y: 0.2,
    });
    const moved = await admin.socket.waitFor(
      (e) =>
        e.type === "note.updated" &&
        e.note.id === noteId &&
        e.note.columnId === col1,
    );
    if (moved.type !== "note.updated") throw new Error("unreachable");
    expect(moved.note.x).toBe(0.6);
    expect(moved.note.groupId).toBeNull();
  });

  it("note.moveMany repositions many cards in ONE frame", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    await toPhase(admin.socket, "write");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    const a = await createNote(admin.socket, columnId, "a");
    const b = await createNote(admin.socket, columnId, "b");
    admin.socket.send({
      type: "note.moveMany",
      opId: opId(),
      moves: [
        { noteId: a, columnId, x: 0.2, y: 0.3 },
        { noteId: b, columnId, x: 0.7, y: 0.8 },
      ],
    });
    const movedA = await admin.socket.waitFor(
      (e) => e.type === "note.updated" && e.note.id === a && e.note.x === 0.2,
    );
    const movedB = await admin.socket.waitFor(
      (e) => e.type === "note.updated" && e.note.id === b && e.note.x === 0.7,
    );
    if (movedA.type !== "note.updated" || movedB.type !== "note.updated") {
      throw new Error("unreachable");
    }
    expect(movedA.note.y).toBe(0.3);
    expect(movedB.note.y).toBe(0.8);
  });

  it("same-zone canvas reposition KEEPS a stack; column-mode drag (no x) still ungroups", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    await toPhase(admin.socket, "write");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    const a = await createNote(admin.socket, columnId, "aa");
    const b = await createNote(ben.socket, columnId, "bb");
    await toPhase(admin.socket, "present");

    // Stack b onto a.
    admin.socket.send({
      type: "note.group",
      opId: opId(),
      noteId: b,
      targetNoteId: a,
    });
    await admin.socket.waitFor(
      (e) => e.type === "note.updated" && e.note.id === b && e.note.groupId !== null,
    );

    // Canvas reposition of the stacked note (x present) → keeps the stack.
    admin.socket.send({
      type: "note.move",
      opId: opId(),
      noteId: b,
      columnId,
      x: 0.3,
      y: 0.4,
    });
    const repositioned = await admin.socket.waitFor(
      (e) => e.type === "note.updated" && e.note.id === b && e.note.x === 0.3,
    );
    if (repositioned.type !== "note.updated") throw new Error("unreachable");
    expect(repositioned.note.groupId).not.toBeNull();

    // Column-mode drag onto its own column (NO x) → the shipped ungroup gesture.
    admin.socket.send({
      type: "note.move",
      opId: opId(),
      noteId: b,
      columnId,
    });
    const ungrouped = await admin.socket.waitFor(
      (e) => e.type === "note.updated" && e.note.id === b && e.note.groupId === null,
    );
    expect(ungrouped.type).toBe("note.updated");
  });
});

describe("picker style (skin)", () => {
  it("defaults to the wheel and lets the facilitator switch to slots for everyone", async () => {
    const { boardId, admin, ben } = await presentingBoard();
    expect(admin.sync.config.pickerStyle).toBe("wheel"); // new boards

    admin.socket.send({ type: "admin.picker.style", style: "slots" });
    const changed = await ben.socket.waitFor(
      (e) => e.type === "config.changed",
    );
    if (changed.type !== "config.changed") throw new Error("unreachable");
    expect(changed.config.pickerStyle).toBe("slots");

    // A fresh joiner's sync carries the chosen skin (persisted).
    const cara = await joined(boardId, "Cara");
    expect(cara.sync.config.pickerStyle).toBe("slots");
  });

  it("only the facilitator changes the skin", async () => {
    const { ben } = await presentingBoard();
    ben.socket.send({ type: "admin.picker.style", style: "slots" });
    const rejected = await ben.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("NOT_ADMIN");
  });
});

describe("grouping & moving", () => {
  it("dragging a note onto another stacks them; ungrouping the pair dissolves the group", async () => {
    const { admin, ben } = await presentingBoard();
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    const a = await createNote(admin.socket, columnId, "dup A");
    const b = await createNote(ben.socket, columnId, "dup B");

    ben.socket.send({
      type: "note.group",
      opId: opId(),
      noteId: a,
      targetNoteId: b,
    });
    // deterministic group id = target's own id
    const grouped = await ben.socket.waitFor(
      (e) =>
        e.type === "note.updated" && e.note.id === a && e.note.groupId === b,
    );
    expect(grouped.type).toBe("note.updated");
    await admin.socket.waitFor(
      (e) =>
        e.type === "note.updated" && e.note.id === b && e.note.groupId === b,
    );

    // Ungrouping one member dissolves the two-note group entirely.
    ben.socket.send({ type: "note.ungroup", opId: opId(), noteId: a });
    await admin.socket.waitFor(
      (e) =>
        e.type === "note.updated" && e.note.id === a && e.note.groupId === null,
    );
    await admin.socket.waitFor(
      (e) =>
        e.type === "note.updated" && e.note.id === b && e.note.groupId === null,
    );
  });

  it("grouping is locked before the reveal", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    await toPhase(admin.socket, "write");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    const a = await createNote(admin.socket, columnId, "one");
    const b = await createNote(admin.socket, columnId, "two");

    admin.socket.send({
      type: "note.group",
      opId: opId(),
      noteId: a,
      targetNoteId: b,
    });
    const rejected = await admin.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("PHASE_LOCKED");
  });

  it("moving a note to another column works for anyone after reveal, author-only before", async () => {
    const { admin, ben } = await presentingBoard();
    const [col1, col2] = admin.sync.columns;
    if (!col1 || !col2) throw new Error("setup");
    const noteId = await createNote(admin.socket, col1.id, "movable");

    // After reveal: Ben may move Anna's note (collective curation).
    ben.socket.send({
      type: "note.move",
      opId: opId(),
      noteId,
      columnId: col2.id,
    });
    const moved = await admin.socket.waitFor(
      (e) =>
        e.type === "note.updated" &&
        e.note.id === noteId &&
        e.note.columnId === col2.id,
    );
    expect(moved.type).toBe("note.updated");

    // Rewind to write: now only the author may move it.
    admin.socket.send({ type: "admin.phase.set", phase: "write" });
    await ben.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === "write",
    );
    ben.socket.send({
      type: "note.move",
      opId: opId(),
      noteId,
      columnId: col1.id,
    });
    const rejected = await ben.socket.waitFor(
      (e) => e.type === "reject" && e.code === "NOT_FOUND",
    );
    // Ben cannot even learn the note exists during write (visibility rule).
    expect(rejected.type).toBe("reject");
  });
});

describe("facilitator handoff", () => {
  it("promotes and demotes with a last-facilitator guard", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");

    // Members cannot assign roles.
    ben.socket.send({
      type: "admin.role.set",
      participantId: ben.you.id,
      role: "facilitator",
    });
    const notAdmin = await ben.socket.waitFor((e) => e.type === "reject");
    if (notAdmin.type !== "reject") throw new Error("unreachable");
    expect(notAdmin.code).toBe("NOT_ADMIN");

    // The last facilitator cannot demote themselves.
    admin.socket.send({
      type: "admin.role.set",
      participantId: admin.you.id,
      role: "member",
    });
    const guard = await admin.socket.waitFor(
      (e) => e.type === "reject" && e.code === "INVALID",
    );
    expect(guard.type).toBe("reject");

    // Promote Ben; both sides see the roster update.
    admin.socket.send({
      type: "admin.role.set",
      participantId: ben.you.id,
      role: "facilitator",
    });
    const promoted = await ben.socket.waitFor(
      (e) =>
        e.type === "roster.updated" &&
        e.participant.id === ben.you.id &&
        e.participant.role === "facilitator",
    );
    expect(promoted.type).toBe("roster.updated");

    // Now Ben can act as facilitator (e.g. advance the phase from lobby)…
    ben.socket.send({ type: "admin.phase.set", phase: "write" });
    await ben.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === "write",
    );

    // …and Anna can step down since Ben remains.
    admin.socket.send({
      type: "admin.role.set",
      participantId: admin.you.id,
      role: "member",
    });
    await ben.socket.waitFor(
      (e) =>
        e.type === "roster.updated" &&
        e.participant.id === admin.you.id &&
        e.participant.role === "member",
    );
  });
});
