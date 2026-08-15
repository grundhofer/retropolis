// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@retropolis/shared";
import { boardStub } from "../src/board-stub.js";
import { connect, createBoard, type TestSocket } from "./helpers.js";

let opCounter = 30000;
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

const DUP_URL = (id: string) =>
  `https://example.com/api/boards/${id}/duplicate`;
const JSON_HEADERS = { "content-type": "application/json" };

describe("board duplication", () => {
  it("copies structure (columns, config, agreements) but never content", async () => {
    const { boardId, adminToken } = await createBoard("Team Sprint");
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    const col0 = admin.sync.columns[0]?.id ?? "";

    // Reshape the source: rename a column, change vote config + picker skin,
    // set working agreements.
    admin.socket.send({
      type: "admin.column.rename",
      opId: opId(),
      columnId: col0,
      name: "Renamed Col",
    });
    await admin.socket.waitFor((e) => e.type === "column.renamed");
    admin.socket.send({
      type: "admin.vote.config",
      votesPerPerson: 7,
      maxPerTarget: 2,
      topN: 4,
    });
    await admin.socket.waitFor(
      (e) => e.type === "config.changed" && e.config.votesPerPerson === 7,
    );
    admin.socket.send({ type: "admin.picker.style", style: "slots" });
    await admin.socket.waitFor(
      (e) => e.type === "config.changed" && e.config.pickerStyle === "slots",
    );
    admin.socket.send({ type: "admin.agreements.set", text: "Vegas rule." });
    await admin.socket.waitFor((e) => e.type === "agreements.changed");

    // Add a note — content that must NOT cross into the copy.
    await toPhase(admin.socket, "write");
    ben.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: newId(),
      columnId: col0,
      text: "secret note",
    });
    await ben.socket.waitFor((e) => e.type === "note.created");

    // Duplicate over HTTP with the source admin token.
    const res = await SELF.fetch(DUP_URL(boardId), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Copy of Team Sprint", adminToken }),
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as {
      boardId: string;
      adminToken: string;
    };
    expect(created.boardId).toMatch(/^[0-9a-f]{32}$/);
    expect(created.boardId).not.toBe(boardId);
    expect(created.adminToken).not.toBe(adminToken);

    // The copy: structure carried over, identity + lifecycle fresh.
    const dup = await joined(created.boardId, "Cara", created.adminToken);
    expect(dup.sync.board.name).toBe("Copy of Team Sprint");
    expect(dup.sync.columns[0]?.name).toBe("Renamed Col");
    expect(dup.sync.columns.map((c) => c.id)).not.toContain(col0); // fresh ids
    expect(dup.sync.config.votesPerPerson).toBe(7);
    expect(dup.sync.config.maxPerTarget).toBe(2);
    expect(dup.sync.config.topN).toBe(4);
    expect(dup.sync.config.pickerStyle).toBe("slots");
    expect(dup.sync.workingAgreements).toBe("Vegas rule.");
    expect(dup.sync.phase).toBe("lobby"); // never a source phase
    expect(dup.sync.retentionAt).not.toBeNull();

    // Content did NOT cross: no notes, and the roster is only the new joiner.
    expect(dup.sync.notes).toEqual([]);
    expect(dup.sync.roster).toHaveLength(1);

    // Inspect the copy's SQLite directly: content tables are empty.
    const rowCounts = await runInDurableObject(
      boardStub(env, created.boardId),
      (_instance, state) => {
        const count = (table: string) =>
          Number(
            state.storage.sql
              .exec(`SELECT COUNT(*) AS n FROM ${table}`)
              .toArray()[0]?.n ?? -1,
          );
        return {
          notes: count("notes"),
          votes: count("votes"),
          kudos: count("kudos"),
          roti: count("roti"),
          actions: count("actions"),
        };
      },
    );
    expect(rowCounts).toEqual({
      notes: 0,
      votes: 0,
      kudos: 0,
      roti: 0,
      actions: 0,
    });
  });

  it("requires the source admin token", async () => {
    const { boardId } = await createBoard("Secret");
    const res = await SELF.fetch(DUP_URL(boardId), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Copy", adminToken: "0".repeat(32) }),
    });
    // Wrong token is indistinguishable from a missing board — 404, no oracle.
    expect(res.status).toBe(404);
  });

  it("404s for a malformed or never-created source board", async () => {
    const malformed = await SELF.fetch(DUP_URL("not-a-board"), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Copy", adminToken: "0".repeat(32) }),
    });
    expect(malformed.status).toBe(404);

    const ghost = await SELF.fetch(DUP_URL("0".repeat(32)), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Copy", adminToken: "0".repeat(32) }),
    });
    expect(ghost.status).toBe(404);
  });

  it("falls back to the source name when the request omits one", async () => {
    const { boardId, adminToken } = await createBoard("Original");
    const res = await SELF.fetch(DUP_URL(boardId), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ adminToken }),
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as { boardId: string };
    const info = await boardStub(env, created.boardId).info();
    expect(info?.name).toBe("Original");
  });

  it("preserves staged (hidden) columns as hidden in the copy", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const colId = newId();
    admin.socket.send({
      type: "admin.column.create",
      opId: opId(),
      columnId: colId,
      name: "Staged",
    });
    await admin.socket.waitFor((e) => e.type === "column.created");
    admin.socket.send({
      type: "admin.column.setHidden",
      opId: opId(),
      columnId: colId,
      hidden: true,
    });
    await admin.socket.waitFor((e) => e.type === "column.updated");

    const res = await SELF.fetch(DUP_URL(boardId), {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Copy", adminToken }),
    });
    const copy = (await res.json()) as { boardId: string; adminToken: string };

    // A member of the copy never sees the staged column…
    const member = await joined(copy.boardId, "Ben");
    expect(member.sync.columns.some((c) => c.name === "Staged")).toBe(false);
    // …but the facilitator does, still flagged hidden (not silently revealed).
    const facilitator = await joined(copy.boardId, "Cara", copy.adminToken);
    const staged = facilitator.sync.columns.find((c) => c.name === "Staged");
    expect(staged?.hidden).toBe(true);
  });
});

async function toWrite(socket: TestSocket) {
  await toPhase(socket, "write");
}

describe("staged / hidden columns", () => {
  it("withholds a hidden column AND its notes from members — live wire and snapshot — while the facilitator keeps both", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    const col0 = admin.sync.columns[0]?.id ?? "";

    await toWrite(admin.socket);
    const noteId = newId();
    ben.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId: col0,
      text: "ben's note",
    });
    await ben.socket.waitFor((e) => e.type === "note.created");
    await toPhase(admin.socket, "present"); // revealed: notes visible to all

    // Hide the column: members get column.deleted (drop column + notes),
    // facilitators get column.updated carrying hidden=true.
    admin.socket.send({
      type: "admin.column.setHidden",
      opId: opId(),
      columnId: col0,
      hidden: true,
    });
    const dropped = await ben.socket.waitFor(
      (e) => e.type === "column.deleted" && e.columnId === col0,
    );
    expect(dropped.type).toBe("column.deleted");
    const updated = await admin.socket.waitFor(
      (e) => e.type === "column.updated" && e.column.id === col0,
    );
    if (updated.type !== "column.updated") throw new Error("unreachable");
    expect(updated.column.hidden).toBe(true);
    // Members never receive column.updated (it would leak the hidden flag).
    expect(ben.socket.events.some((e) => e.type === "column.updated")).toBe(
      false,
    );

    // A fresh member's SNAPSHOT excludes the hidden column and every note in it.
    const cara = await joined(boardId, "Cara");
    expect(cara.sync.columns.map((c) => c.id)).not.toContain(col0);
    expect(cara.sync.notes.some((n) => n.columnId === col0)).toBe(false);

    // The facilitator still sees the hidden column (flagged) and its notes.
    admin.socket.send({ type: "resync" });
    const adminSync = await admin.socket.waitFor(
      (e) =>
        e.type === "sync" && e.columns.some((c) => c.id === col0 && c.hidden),
    );
    if (adminSync.type !== "sync") throw new Error("unreachable");
    expect(adminSync.notes.some((n) => n.columnId === col0)).toBe(true);
  });

  it("reveals a hidden column with its now-visible notes to members", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");

    // Facilitator stages a column and writes a note in it while hidden.
    const colId = newId();
    admin.socket.send({
      type: "admin.column.create",
      opId: opId(),
      columnId: colId,
      name: "Secret",
    });
    await admin.socket.waitFor((e) => e.type === "column.created");
    admin.socket.send({
      type: "admin.column.setHidden",
      opId: opId(),
      columnId: colId,
      hidden: true,
    });
    await admin.socket.waitFor((e) => e.type === "column.updated");
    await toWrite(admin.socket);
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: newId(),
      columnId: colId,
      text: "staged idea",
    });
    await admin.socket.waitFor((e) => e.type === "note.created");
    await toPhase(admin.socket, "present"); // revealed

    // Reveal: Ben gets the column, then its now-visible notes.
    admin.socket.send({
      type: "admin.column.setHidden",
      opId: opId(),
      columnId: colId,
      hidden: false,
    });
    const created = await ben.socket.waitFor(
      (e) => e.type === "column.created" && e.column.id === colId,
    );
    if (created.type !== "column.created") throw new Error("unreachable");
    expect(created.column.hidden).toBe(false);
    const revealed = await ben.socket.waitFor(
      (e) =>
        e.type === "notes.revealed" &&
        e.notes.some((n) => n.columnId === colId),
    );
    expect(revealed.type).toBe("notes.revealed");
  });

  it("treats a hidden column like a missing one for members (no existence oracle)", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    const colId = newId();
    admin.socket.send({
      type: "admin.column.create",
      opId: opId(),
      columnId: colId,
      name: "Secret",
    });
    await admin.socket.waitFor((e) => e.type === "column.created");
    admin.socket.send({
      type: "admin.column.setHidden",
      opId: opId(),
      columnId: colId,
      hidden: true,
    });
    await admin.socket.waitFor((e) => e.type === "column.updated");
    await toWrite(admin.socket);

    // Ben tries to write into the column he cannot see → NOT_FOUND (same answer
    // as a column that never existed).
    ben.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: newId(),
      columnId: colId,
      text: "sneaky",
    });
    const rejected = await ben.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("NOT_FOUND");
  });

  it("only the facilitator hides or reveals a column", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    const col0 = admin.sync.columns[0]?.id ?? "";

    ben.socket.send({
      type: "admin.column.setHidden",
      opId: opId(),
      columnId: col0,
      hidden: true,
    });
    const rejected = await ben.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("NOT_ADMIN");
  });

  it("a hidden column's rename reaches facilitators only, never members", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    const colId = newId();
    admin.socket.send({
      type: "admin.column.create",
      opId: opId(),
      columnId: colId,
      name: "Secret",
    });
    await admin.socket.waitFor((e) => e.type === "column.created");
    admin.socket.send({
      type: "admin.column.setHidden",
      opId: opId(),
      columnId: colId,
      hidden: true,
    });
    await admin.socket.waitFor((e) => e.type === "column.updated");
    // Ben has already dropped the hidden column (column.deleted).
    await ben.socket.waitFor((e) => e.type === "column.deleted");

    admin.socket.send({
      type: "admin.column.rename",
      opId: opId(),
      columnId: colId,
      name: "New Secret",
    });
    const renamed = await admin.socket.waitFor(
      (e) => e.type === "column.renamed" && e.column.id === colId,
    );
    if (renamed.type !== "column.renamed") throw new Error("unreachable");
    expect(renamed.column.name).toBe("New Secret");

    // Synchronize on a broadcast Ben WILL receive, then assert the hidden
    // column's NEW NAME never reached him in any column-bearing event. (Ben did
    // see the initial "Secret" column.created before it was hidden — that's the
    // visible-then-hidden lifecycle, not a leak of the hidden rename.)
    admin.socket.send({ type: "admin.gifs.set", enabled: false });
    await ben.socket.waitFor((e) => e.type === "config.changed");
    expect(
      ben.socket.events.some(
        (e) =>
          (e.type === "column.renamed" ||
            e.type === "column.created" ||
            e.type === "column.updated") &&
          e.column.name === "New Secret",
      ),
    ).toBe(false);
  });

  it("keeps hidden-column notes out of the revealed tallies broadcast to everyone", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    const col0 = admin.sync.columns[0]?.id ?? "";

    await toWrite(admin.socket);
    const secretNote = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: secretNote,
      columnId: col0,
      text: "to hide",
    });
    await admin.socket.waitFor((e) => e.type === "note.created");
    const openNote = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: openNote,
      columnId: admin.sync.columns[1]?.id ?? "",
      text: "stays",
    });
    await admin.socket.waitFor(
      (e) => e.type === "note.created" && e.note.id === openNote,
    );

    // Vote on both notes, then hide the first note's column and open voting.
    await toPhase(admin.socket, "present");
    await toPhase(admin.socket, "vote");
    admin.socket.send({
      type: "vote.cast",
      opId: opId(),
      targetId: secretNote,
      delta: 1,
    });
    await admin.socket.waitFor((e) => e.type === "vote.progress");
    admin.socket.send({
      type: "vote.cast",
      opId: opId(),
      targetId: openNote,
      delta: 1,
    });
    await admin.socket.waitFor(
      (e) => e.type === "vote.progress" && e.yourVotes[openNote] === 1,
    );
    admin.socket.send({
      type: "admin.column.setHidden",
      opId: opId(),
      columnId: col0,
      hidden: true,
    });
    await admin.socket.waitFor((e) => e.type === "column.updated");

    // Reveal tallies (discuss): the broadcast must not carry the hidden note.
    admin.socket.send({ type: "admin.phase.set", phase: "discuss" });
    const tallies = await ben.socket.waitFor(
      (e) => e.type === "votes.revealed",
    );
    if (tallies.type !== "votes.revealed") throw new Error("unreachable");
    expect(tallies.tallies[secretNote]).toBeUndefined();
    expect(tallies.tallies[openNote]).toBe(1);
    expect(tallies.topTargetIds).not.toContain(secretNote);
  });

  // --- review-fleet regressions (M6) ---

  async function stagedColumnWithNote(admin: { socket: TestSocket }) {
    const colId = newId();
    admin.socket.send({
      type: "admin.column.create",
      opId: opId(),
      columnId: colId,
      name: "Secret",
    });
    await admin.socket.waitFor((e) => e.type === "column.created");
    admin.socket.send({
      type: "admin.column.setHidden",
      opId: opId(),
      columnId: colId,
      hidden: true,
    });
    await admin.socket.waitFor((e) => e.type === "column.updated");
    await toWrite(admin.socket);
    const noteId = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId: colId,
      text: "secret",
    });
    await admin.socket.waitFor((e) => e.type === "note.created");
    return { colId, noteId };
  }

  it("note.react on a hidden-column note answers NOT_FOUND for members", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    const { noteId } = await stagedColumnWithNote(admin);
    await toPhase(admin.socket, "present"); // reactions need a revealed phase

    ben.socket.send({
      type: "note.react",
      opId: opId(),
      noteId,
      emoji: "👍",
      on: true,
    });
    const rejected = await ben.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("NOT_FOUND"); // identical to a nonexistent note
  });

  it("note.ungroup on a hidden-column note answers NOT_FOUND for members", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    const col0 = admin.sync.columns[0]?.id ?? "";
    await toWrite(admin.socket);
    const n1 = newId();
    const n2 = newId();
    for (const id of [n1, n2]) {
      admin.socket.send({
        type: "note.create",
        opId: opId(),
        noteId: id,
        columnId: col0,
        text: id,
      });
      await admin.socket.waitFor(
        (e) => e.type === "note.created" && e.note.id === id,
      );
    }
    await toPhase(admin.socket, "present");
    admin.socket.send({
      type: "note.group",
      opId: opId(),
      noteId: n1,
      targetNoteId: n2,
    });
    await admin.socket.waitFor((e) => e.type === "note.updated");
    admin.socket.send({
      type: "admin.column.setHidden",
      opId: opId(),
      columnId: col0,
      hidden: true,
    });
    await ben.socket.waitFor((e) => e.type === "column.deleted");

    // Ben still holds n1's id but cannot see the staged column → NOT_FOUND, and
    // the facilitator's stack is not corrupted.
    ben.socket.send({ type: "note.ungroup", opId: opId(), noteId: n1 });
    const rejected = await ben.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("NOT_FOUND");
  });

  it("deleting a hidden-column note does not fan its id out to members", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    const { noteId } = await stagedColumnWithNote(admin);
    await toPhase(admin.socket, "present");

    admin.socket.send({ type: "note.delete", opId: opId(), noteId });
    await admin.socket.waitFor((e) => e.type === "ack");
    // Synchronize on a broadcast Ben WILL receive, then assert no leak.
    admin.socket.send({ type: "admin.gifs.set", enabled: false });
    await ben.socket.waitFor((e) => e.type === "config.changed");
    expect(
      ben.socket.events.some(
        (e) => e.type === "note.deleted" && e.noteId === noteId,
      ),
    ).toBe(false);
  });

  it("moving a note into a staged column drops it from members' live view", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    const col0 = admin.sync.columns[0]?.id ?? "";
    await toWrite(admin.socket);
    const noteId = newId();
    ben.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId: col0,
      text: "ben's note",
    });
    await ben.socket.waitFor((e) => e.type === "note.created");
    // A separate staged column to move the note into.
    const staged = newId();
    admin.socket.send({
      type: "admin.column.create",
      opId: opId(),
      columnId: staged,
      name: "Staged",
    });
    await admin.socket.waitFor((e) => e.type === "column.created");
    admin.socket.send({
      type: "admin.column.setHidden",
      opId: opId(),
      columnId: staged,
      hidden: true,
    });
    await admin.socket.waitFor((e) => e.type === "column.updated");
    await toPhase(admin.socket, "present"); // Ben can now see the note

    // Facilitator moves Ben's (visible) note into the staged column → Ben must
    // receive a note.deleted so no stale card lingers; the facilitator keeps it.
    admin.socket.send({
      type: "note.move",
      opId: opId(),
      noteId,
      columnId: staged,
    });
    const dropped = await ben.socket.waitFor(
      (e) => e.type === "note.deleted" && e.noteId === noteId,
    );
    expect(dropped.type).toBe("note.deleted");
    const kept = await admin.socket.waitFor(
      (e) => e.type === "note.updated" && e.note.id === noteId,
    );
    if (kept.type !== "note.updated") throw new Error("unreachable");
    expect(kept.note.columnId).toBe(staged);
  });

  it("a hidden-column note cannot become the discussion focus", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const col0 = admin.sync.columns[0]?.id ?? "";
    await toWrite(admin.socket);
    const noteId = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId: col0,
      text: "focus me",
    });
    await admin.socket.waitFor((e) => e.type === "note.created");
    for (const p of ["present", "vote"]) await toPhase(admin.socket, p);
    admin.socket.send({
      type: "admin.column.setHidden",
      opId: opId(),
      columnId: col0,
      hidden: true,
    });
    await admin.socket.waitFor((e) => e.type === "column.updated");
    await toPhase(admin.socket, "discuss");

    admin.socket.send({ type: "admin.discuss.focus", targetId: noteId });
    const rejected = await admin.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("NOT_FOUND");
  });
});
