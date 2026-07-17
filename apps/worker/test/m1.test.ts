import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@retropolis/shared";
import { boardStub } from "../src/board-stub.js";
import { connect, createBoard, type TestSocket } from "./helpers.js";

let opCounter = 0;
function opId(): string {
  return (opCounter++).toString(16).padStart(32, "0");
}
function newId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

async function joined(
  boardId: string,
  name: string,
  adminToken?: string,
): Promise<{
  socket: TestSocket;
  you: Extract<ServerEvent, { type: "sync" }>["you"];
  sync: Extract<ServerEvent, { type: "sync" }>;
}> {
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

async function boardInPhase(phase: "write" | "present") {
  const { boardId, adminToken } = await createBoard();
  const admin = await joined(boardId, "Anna", adminToken);
  admin.socket.send({ type: "admin.phase.set", phase: "write" });
  await admin.socket.waitFor(
    (e) => e.type === "phase.changed" && e.phase === "write",
  );
  if (phase === "present") {
    admin.socket.send({ type: "admin.phase.set", phase: "present" });
    await admin.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === "present",
    );
  }
  return { boardId, adminToken, admin };
}

describe("board creation with templates", () => {
  it("materializes template columns in the requested locale", async () => {
    const { boardId } = await createBoard("Retro", {
      template: "start-stop-continue",
      locale: "de",
    });
    const { sync } = await joined(boardId, "Anna");
    expect(sync.columns.map((c) => c.name)).toEqual([
      "Anfangen",
      "Aufhören",
      "Weitermachen",
    ]);
    expect(sync.phase).toBe("lobby");
  });
});

describe("write-phase privacy (the product's core property)", () => {
  it("Ben receives NOTHING about Anna's note — no event, no snapshot content", async () => {
    const { boardId, admin } = await boardInPhase("write");
    const ben = await joined(boardId, "Ben");

    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    const noteId = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId,
      text: "Anna's secret",
    });
    await admin.socket.waitFor((e) => e.type === "ack");

    // Anna sees her own note in a fresh snapshot…
    admin.socket.send({ type: "resync" });
    const annaSync = await admin.socket.waitFor(
      (e) => e.type === "sync" && e.notes.length > 0,
    );
    if (annaSync.type !== "sync") throw new Error("unreachable");
    expect(annaSync.notes[0]?.text).toBe("Anna's secret");

    // …Ben's snapshot has no notes at all…
    ben.socket.send({ type: "resync" });
    const benSync = await ben.socket.waitFor(
      (e) => e.type === "sync" && e.seq >= annaSync.seq,
    );
    if (benSync.type !== "sync") throw new Error("unreachable");
    expect(benSync.notes).toHaveLength(0);

    // …and none of Ben's received frames ever contained the text or note id.
    const benTraffic = JSON.stringify(ben.socket.events);
    expect(benTraffic).not.toContain("Anna's secret");
    expect(benTraffic).not.toContain(noteId);
  });

  it("deleting a hidden note is not announced to those who never saw it", async () => {
    const { boardId, admin } = await boardInPhase("write");
    const ben = await joined(boardId, "Ben");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");

    const noteId = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId,
      text: "draft",
    });
    await admin.socket.waitFor((e) => e.type === "ack");
    admin.socket.send({ type: "note.delete", opId: opId(), noteId });
    await admin.socket.waitFor((e) => e.type === "ack" && e.opId !== undefined);

    expect(JSON.stringify(ben.socket.events)).not.toContain(noteId);
  });

  it("reveal delivers foreign notes to everyone, then rewind hides them server-side again", async () => {
    const { boardId, admin } = await boardInPhase("write");
    const ben = await joined(boardId, "Ben");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");

    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: newId(),
      columnId,
      text: "Anna's point",
    });
    await admin.socket.waitFor((e) => e.type === "ack");

    admin.socket.send({ type: "admin.phase.set", phase: "present" });
    const revealed = await ben.socket.waitFor(
      (e) => e.type === "notes.revealed",
    );
    if (revealed.type !== "notes.revealed") throw new Error("unreachable");
    expect(revealed.notes.map((n) => n.text)).toContain("Anna's point");

    // Rewind: Ben's fresh snapshot no longer contains Anna's note.
    admin.socket.send({ type: "admin.phase.set", phase: "write" });
    await ben.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === "write",
    );
    ben.socket.send({ type: "resync" });
    const benSync = await ben.socket.waitFor(
      (e) => e.type === "sync" && e.phase === "write",
    );
    if (benSync.type !== "sync") throw new Error("unreachable");
    expect(benSync.notes).toHaveLength(0);
  });
});

describe("phase machine", () => {
  it("rejects illegal transitions and non-admin attempts", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");

    ben.socket.send({ type: "admin.phase.set", phase: "write" });
    const notAdmin = await ben.socket.waitFor((e) => e.type === "reject");
    if (notAdmin.type !== "reject") throw new Error("unreachable");
    expect(notAdmin.code).toBe("NOT_ADMIN");

    admin.socket.send({ type: "admin.phase.set", phase: "present" }); // skips write
    const illegal = await admin.socket.waitFor((e) => e.type === "reject");
    if (illegal.type !== "reject") throw new Error("unreachable");
    expect(illegal.code).toBe("INVALID");
  });

  it("resets ready flags on every transition", async () => {
    const { admin } = await boardInPhase("write");
    admin.socket.send({ type: "ready.set", ready: true });
    await admin.socket.waitFor((e) => e.type === "ready.changed" && e.ready);

    admin.socket.send({ type: "admin.phase.set", phase: "present" });
    await admin.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === "present",
    );
    admin.socket.send({ type: "resync" });
    const sync = await admin.socket.waitFor(
      (e) => e.type === "sync" && e.phase === "present",
    );
    if (sync.type !== "sync") throw new Error("unreachable");
    expect(sync.readyIds).toEqual([]);
  });
});

describe("notes & reactions gating", () => {
  it("rejects note creation in the lobby and edits by non-authors", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");

    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: newId(),
      columnId,
      text: "early",
    });
    const locked = await admin.socket.waitFor((e) => e.type === "reject");
    if (locked.type !== "reject") throw new Error("unreachable");
    expect(locked.code).toBe("PHASE_LOCKED");
  });

  it("reactions only after reveal, and they toggle", async () => {
    const { admin } = await boardInPhase("write");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    const noteId = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId,
      text: "point",
    });
    await admin.socket.waitFor((e) => e.type === "ack");

    admin.socket.send({
      type: "note.react",
      opId: opId(),
      noteId,
      emoji: "🎉",
      on: true,
    });
    const locked = await admin.socket.waitFor((e) => e.type === "reject");
    if (locked.type !== "reject") throw new Error("unreachable");
    expect(locked.code).toBe("PHASE_LOCKED");

    admin.socket.send({ type: "admin.phase.set", phase: "present" });
    await admin.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === "present",
    );
    admin.socket.send({
      type: "note.react",
      opId: opId(),
      noteId,
      emoji: "🎉",
      on: true,
    });
    const updated = await admin.socket.waitFor(
      (e) => e.type === "note.updated" && e.note.id === noteId,
    );
    if (updated.type !== "note.updated") throw new Error("unreachable");
    expect(updated.note.reactions["🎉"]).toHaveLength(1);
  });

  it("note create is idempotent for the same client-minted id", async () => {
    const { admin } = await boardInPhase("write");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    const noteId = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId,
      text: "once",
    });
    await admin.socket.waitFor((e) => e.type === "ack");
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId,
      text: "once",
    });
    await admin.socket.waitFor(
      (e) => e.type === "ack" && e.opId.startsWith("0"),
    );

    admin.socket.send({ type: "resync" });
    const sync = await admin.socket.waitFor(
      (e) => e.type === "sync" && e.notes.length > 0,
    );
    if (sync.type !== "sync") throw new Error("unreachable");
    expect(sync.notes).toHaveLength(1);
  });
});

describe("review-fleet regressions", () => {
  it("reject codes are no existence oracle: invisible notes answer like missing ones", async () => {
    const { boardId, admin } = await boardInPhase("write");
    const ben = await joined(boardId, "Ben");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");

    const hiddenId = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: hiddenId,
      columnId,
      text: "hidden",
    });
    await admin.socket.waitFor((e) => e.type === "ack");

    // update of a hidden foreign note answers NOT_FOUND (not NOT_AUTHOR)
    ben.socket.send({
      type: "note.update",
      opId: opId(),
      noteId: hiddenId,
      text: "probe",
    });
    const probe1 = await ben.socket.waitFor((e) => e.type === "reject");
    if (probe1.type !== "reject") throw new Error("unreachable");
    expect(probe1.code).toBe("NOT_FOUND");

    // delete of a hidden foreign note acks like a nonexistent one — and does NOT delete
    ben.socket.send({ type: "note.delete", opId: opId(), noteId: hiddenId });
    await ben.socket.waitFor((e) => e.type === "ack");
    admin.socket.send({ type: "resync" });
    const sync = await admin.socket.waitFor(
      (e) => e.type === "sync" && e.notes.length > 0,
    );
    if (sync.type !== "sync") throw new Error("unreachable");
    expect(sync.notes.some((n) => n.id === hiddenId)).toBe(true);

    // create colliding with a hidden foreign id answers INVALID, not CONFLICT
    ben.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: hiddenId,
      columnId,
      text: "x",
    });
    const probe2 = await ben.socket.waitFor(
      (e) => e.type === "reject" && e.code !== "NOT_FOUND",
    );
    if (probe2.type !== "reject") throw new Error("unreachable");
    expect(probe2.code).toBe("INVALID");
  });

  it("note order does not leak the hidden note count of others", async () => {
    const { boardId, admin } = await boardInPhase("write");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    for (const text of ["one", "two", "three"]) {
      admin.socket.send({
        type: "note.create",
        opId: opId(),
        noteId: newId(),
        columnId,
        text,
      });
      await admin.socket.waitFor((e) => e.type === "ack" && e.seq > 0);
    }

    const ben = await joined(boardId, "Ben");
    ben.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: newId(),
      columnId,
      text: "ben's first",
    });
    const created = await ben.socket.waitFor((e) => e.type === "note.created");
    if (created.type !== "note.created") throw new Error("unreachable");
    expect(created.note.order).toBe(1); // per-author, not global
  });

  it("the archived (done) board rejects deletion", async () => {
    const { admin } = await boardInPhase("present");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    const noteId = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId,
      text: "keep me",
    });
    await admin.socket.waitFor((e) => e.type === "ack");

    admin.socket.send({ type: "admin.phase.set", phase: "done" });
    await admin.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === "done",
    );
    admin.socket.send({ type: "note.delete", opId: opId(), noteId });
    const rejected = await admin.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("PHASE_LOCKED");
  });

  it("a closing tab clears its ghost even when a sibling tab stays connected", async () => {
    const { boardId, admin } = await boardInPhase("write");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");

    // Ben with two tabs (same session key = same participant).
    const key = "ef".repeat(16);
    const tab1 = await connect(boardId);
    tab1.send({ type: "join", name: "Ben", sessionKey: key });
    await tab1.waitFor((e) => e.type === "sync");
    const tab2 = await connect(boardId);
    tab2.send({ type: "join", name: "Ben", sessionKey: key });
    await tab2.waitFor((e) => e.type === "sync");

    tab1.send({ type: "presence.editing", columnId });
    const ghost = await admin.socket.waitFor(
      (e) => e.type === "presence.editing" && e.columnId === columnId,
    );
    if (ghost.type !== "presence.editing") throw new Error("unreachable");

    tab1.ws.close(1000, "tab closed mid-edit");
    const cleared = await admin.socket.waitFor(
      (e) => e.type === "presence.editing" && e.columnId === null,
    );
    expect(cleared.type).toBe("presence.editing");
  });
});

describe("timer", () => {
  it("start broadcasts a deadline and the DO alarm fires timer.ended", async () => {
    const { boardId, admin } = await boardInPhase("write");
    admin.socket.send({ type: "admin.timer.start", durationSec: 60 });
    const changed = await admin.socket.waitFor(
      (e) => e.type === "timer.changed",
    );
    if (changed.type !== "timer.changed") throw new Error("unreachable");
    expect(changed.timer.endsAt).toBeGreaterThan(changed.serverNow);

    // Fast-forward: fire the scheduled alarm as if the deadline passed.
    const stub = boardStub(env, boardId);
    // make the stored deadline be in the past so the alarm treats it as due
    admin.socket.send({ type: "admin.timer.stop" });
    await admin.socket.waitFor(
      (e) => e.type === "timer.changed" && e.timer.endsAt === null,
    );
    admin.socket.send({ type: "admin.timer.start", durationSec: 10 });
    await admin.socket.waitFor(
      (e) => e.type === "timer.changed" && e.timer.endsAt !== null,
    );
    const fired = await runDurableObjectAlarm(stub);
    expect(fired).toBe(true);
  });

  it("pause and resume keep the remaining time", async () => {
    const { admin } = await boardInPhase("write");
    admin.socket.send({ type: "admin.timer.start", durationSec: 300 });
    await admin.socket.waitFor(
      (e) => e.type === "timer.changed" && e.timer.endsAt !== null,
    );

    admin.socket.send({ type: "admin.timer.pause" });
    const paused = await admin.socket.waitFor(
      (e) => e.type === "timer.changed" && e.timer.pausedRemainingMs !== null,
    );
    if (paused.type !== "timer.changed") throw new Error("unreachable");
    const remaining = paused.timer.pausedRemainingMs;
    expect(remaining).toBeGreaterThan(290_000);
    expect(remaining).toBeLessThanOrEqual(300_000);

    admin.socket.send({ type: "admin.timer.resume" });
    const resumed = await admin.socket.waitFor(
      (e) => e.type === "timer.changed" && e.timer.endsAt !== null,
    );
    if (resumed.type !== "timer.changed") throw new Error("unreachable");
    expect(resumed.timer.endsAt).toBeGreaterThan(resumed.serverNow);

    admin.socket.send({ type: "admin.timer.stop" });
    await admin.socket.waitFor(
      (e) =>
        e.type === "timer.changed" &&
        e.timer.endsAt === null &&
        e.timer.pausedRemainingMs === null,
    );
  });

  it("non-admins cannot touch the timer", async () => {
    const { boardId } = await boardInPhase("write");
    const ben = await joined(boardId, "Ben");
    ben.socket.send({ type: "admin.timer.start", durationSec: 60 });
    const rejected = await ben.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("NOT_ADMIN");
  });
});

describe("columns", () => {
  it("admin can rename and delete (cascading notes); members cannot", async () => {
    const { boardId, admin } = await boardInPhase("write");
    const ben = await joined(boardId, "Ben");
    const column = admin.sync.columns[0];
    if (!column) throw new Error("setup");

    ben.socket.send({
      type: "admin.column.rename",
      opId: opId(),
      columnId: column.id,
      name: "Nope",
    });
    const rejected = await ben.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("NOT_ADMIN");

    admin.socket.send({
      type: "admin.column.rename",
      opId: opId(),
      columnId: column.id,
      name: "What rocked",
    });
    const renamed = await ben.socket.waitFor(
      (e) => e.type === "column.renamed",
    );
    if (renamed.type !== "column.renamed") throw new Error("unreachable");
    expect(renamed.column.name).toBe("What rocked");

    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: newId(),
      columnId: column.id,
      text: "in doomed column",
    });
    await admin.socket.waitFor((e) => e.type === "ack");
    admin.socket.send({
      type: "admin.column.delete",
      opId: opId(),
      columnId: column.id,
    });
    await ben.socket.waitFor((e) => e.type === "column.deleted");

    admin.socket.send({ type: "resync" });
    const sync = await admin.socket.waitFor(
      (e) => e.type === "sync" && !e.columns.some((c) => c.id === column.id),
    );
    if (sync.type !== "sync") throw new Error("unreachable");
    expect(sync.notes.filter((n) => n.columnId === column.id)).toHaveLength(0);
  });
});
