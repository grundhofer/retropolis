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

async function presentingBoard() {
  const { boardId, adminToken } = await createBoard();
  const admin = await joined(boardId, "Anna", adminToken);
  const ben = await joined(boardId, "Ben");
  admin.socket.send({ type: "admin.phase.set", phase: "write" });
  await admin.socket.waitFor(
    (e) => e.type === "phase.changed" && e.phase === "write",
  );
  admin.socket.send({ type: "admin.phase.set", phase: "present" });
  await admin.socket.waitFor(
    (e) => e.type === "phase.changed" && e.phase === "present",
  );
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
    admin.socket.send({ type: "admin.phase.set", phase: "write" });
    await admin.socket.waitFor((e) => e.type === "phase.changed");
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

    // Now Ben can act as facilitator (e.g. advance the phase)…
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
