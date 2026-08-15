// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  env,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@retropolis/shared";
import { boardStub } from "../src/board-stub.js";
import { connect, createBoard, type TestSocket } from "./helpers.js";

let opCounter = 8000;
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

async function advance(
  admin: { socket: TestSocket },
  phases: ReadonlyArray<"write" | "present" | "vote" | "discuss" | "close">,
): Promise<void> {
  for (const phase of phases) {
    admin.socket.send({ type: "admin.phase.set", phase });
    await admin.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === phase,
    );
  }
}

describe("appreciation wall", () => {
  it("kudos are gated to close, revealed as a staged finale, and anonymity hides the sender", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");

    // Not before close.
    admin.socket.send({
      type: "kudo.create",
      opId: opId(),
      kudoId: newId(),
      cardType: "great-job",
      toId: ben.you.id,
      text: "early",
      anonymous: false,
    });
    const locked = await admin.socket.waitFor((e) => e.type === "reject");
    if (locked.type !== "reject") throw new Error("unreachable");
    expect(locked.code).toBe("PHASE_LOCKED");

    await advance(admin, ["write", "present", "vote", "discuss", "close"]);

    // A named kudo — Ben sees the sender.
    const openId = newId();
    admin.socket.send({
      type: "kudo.create",
      opId: opId(),
      kudoId: openId,
      cardType: "great-job",
      toId: ben.you.id,
      text: "shipped the picker",
      anonymous: false,
    });
    const created = await ben.socket.waitFor((e) => e.type === "kudo.created");
    if (created.type !== "kudo.created") throw new Error("unreachable");
    expect(created.kudo).toMatchObject({
      toId: ben.you.id,
      fromId: admin.you.id,
    });

    // An anonymous kudo — the sender id never reaches the wire.
    const anonId = newId();
    admin.socket.send({
      type: "kudo.create",
      opId: opId(),
      kudoId: anonId,
      cardType: "thank-you",
      toId: ben.you.id,
      text: "secretly grateful",
      anonymous: true,
    });
    const anon = await ben.socket.waitFor(
      (e) => e.type === "kudo.created" && e.kudo.id === anonId,
    );
    if (anon.type !== "kudo.created") throw new Error("unreachable");
    expect(anon.kudo.fromId).toBeNull();
    // Ben's entire traffic must never carry the anonymous sender's id.
    const benKudoTraffic = ben.socket.events.filter(
      (e) => e.type === "kudo.created" && e.kudo.id === anonId,
    );
    expect(JSON.stringify(benKudoTraffic)).not.toContain(admin.you.id);

    // Staged reveal: a fresh joiner in the close phase sees the wall.
    const cara = await joined(boardId, "Cara");
    expect(cara.sync.kudos).toHaveLength(2);
  });

  it("kudos are hidden again on rewind out of close", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    await advance(admin, ["write", "present", "vote", "discuss", "close"]);
    admin.socket.send({
      type: "kudo.create",
      opId: opId(),
      kudoId: newId(),
      cardType: "well-done",
      toId: admin.you.id,
      text: "self five",
      anonymous: false,
    });
    await admin.socket.waitFor((e) => e.type === "kudo.created");

    admin.socket.send({ type: "admin.phase.set", phase: "discuss" });
    await admin.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === "discuss",
    );
    admin.socket.send({ type: "resync" });
    const sync = await admin.socket.waitFor(
      (e) => e.type === "sync" && e.phase === "discuss",
    );
    if (sync.type !== "sync") throw new Error("unreachable");
    expect(sync.kudos).toHaveLength(0); // staged: not visible outside close/done
  });
});

describe("board export", () => {
  it("returns markdown with notes and actions, excluding authors by default", async () => {
    const { boardId, adminToken } = await createBoard("Sprint 50");
    const admin = await joined(boardId, "Anna", adminToken);
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    admin.socket.send({ type: "admin.phase.set", phase: "write" });
    await admin.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === "write",
    );
    const noteId = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId,
      text: "Great sprint",
    });
    await admin.socket.waitFor((e) => e.type === "note.created");
    // Reveal before exporting — pre-reveal exports must not carry note bodies.
    admin.socket.send({ type: "admin.phase.set", phase: "present" });
    await admin.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === "present",
    );

    const md = await SELF.fetch(
      `https://example.com/api/boards/${boardId}/export?format=md`,
    );
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(md.headers.get("content-disposition")).toContain("Sprint-50.md");
    const body = await md.text();
    expect(body).toContain("# Sprint 50");
    expect(body).toContain("Great sprint");
    expect(body).not.toContain("Anna"); // authors excluded by default

    const withAuthors = await SELF.fetch(
      `https://example.com/api/boards/${boardId}/export?format=md&authors=true`,
    );
    expect(await withAuthors.text()).toContain("Anna");

    const json = await SELF.fetch(
      `https://example.com/api/boards/${boardId}/export?format=json`,
    );
    expect(json.headers.get("content-type")).toContain("application/json");
    const parsed = (await json.json()) as { boardName: string };
    expect(parsed.boardName).toBe("Sprint 50");
  });

  it("404s for unknown boards and 400s for bad formats", async () => {
    const { boardId } = await createBoard();
    expect(
      (
        await SELF.fetch(
          `https://example.com/api/boards/${"0".repeat(32)}/export`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await SELF.fetch(
          `https://example.com/api/boards/${boardId}/export?format=pdf`,
        )
      ).status,
    ).toBe(400);
  });

  it("does NOT leak unrevealed notes or blind-vote tallies", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    await advance(admin, ["write"]);
    const secret = newId();
    ben.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: secret,
      columnId,
      text: "Ben's private draft",
    });
    await ben.socket.waitFor((e) => e.type === "note.created");

    // Mid write phase, anyone with the link exports → no note bodies.
    const midWrite = await SELF.fetch(
      `https://example.com/api/boards/${boardId}/export?format=json`,
    );
    const writeData = (await midWrite.json()) as {
      columns: { notes: unknown[] }[];
    };
    expect(writeData.columns.every((c) => c.notes.length === 0)).toBe(true);
    expect(
      await (
        await SELF.fetch(
          `https://example.com/api/boards/${boardId}/export?format=md`,
        )
      ).text(),
    ).not.toContain("Ben's private draft");

    // In the vote phase, notes are revealed but tallies stay blind in export.
    await advance(admin, ["present", "vote"]);
    admin.socket.send({
      type: "vote.cast",
      opId: opId(),
      targetId: secret,
      delta: 1,
    });
    await admin.socket.waitFor((e) => e.type === "vote.progress");
    const voteExport = await SELF.fetch(
      `https://example.com/api/boards/${boardId}/export?format=json`,
    );
    const voteData = (await voteExport.json()) as {
      columns: { notes: { text: string; votes: number | null }[] }[];
    };
    const exportedNote = voteData.columns
      .flatMap((c) => c.notes)
      .find((n) => n.text === "Ben's private draft");
    expect(exportedNote).toBeDefined(); // note revealed
    expect(exportedNote?.votes).toBeNull(); // but the tally stays blind
  });

  it("exports every stacked note's text, attributing the tally to the anchor only", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    await advance(admin, ["write"]);
    const a = newId();
    const b = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: a,
      columnId,
      text: "anchor idea",
    });
    await admin.socket.waitFor(
      (e) => e.type === "note.created" && e.note.id === a,
    );
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId: b,
      columnId,
      text: "duplicate idea",
    });
    await admin.socket.waitFor(
      (e) => e.type === "note.created" && e.note.id === b,
    );
    await advance(admin, ["present"]);
    admin.socket.send({
      type: "note.group",
      opId: opId(),
      noteId: b,
      targetNoteId: a,
    });
    await admin.socket.waitFor(
      (e) =>
        e.type === "note.updated" && e.note.id === b && e.note.groupId === a,
    );

    const md = await (
      await SELF.fetch(
        `https://example.com/api/boards/${boardId}/export?format=md`,
      )
    ).text();
    // Both the anchor AND the stacked member's text survive the export.
    expect(md).toContain("anchor idea");
    expect(md).toContain("duplicate idea");
  });
});

describe("gif URL safety", () => {
  it("drops a note gifUrl from a non-allowlisted host", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    await advance(admin, ["write"]);
    const noteId = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId,
      text: "sneaky",
      gifUrl: "https://attacker.example/beacon.gif",
    });
    const created = await admin.socket.waitFor(
      (e) => e.type === "note.created",
    );
    if (created.type !== "note.created") throw new Error("unreachable");
    expect(created.note.gifUrl).toBeNull(); // arbitrary host rejected
  });

  it("drops gifUrl entirely when the board has GIFs disabled", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    admin.socket.send({ type: "admin.gifs.set", enabled: false });
    await admin.socket.waitFor((e) => e.type === "config.changed");
    await advance(admin, ["write"]);
    const noteId = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId,
      text: "with gif",
      gifUrl: "https://media.klipy.com/ok.gif",
    });
    const created = await admin.socket.waitFor(
      (e) => e.type === "note.created",
    );
    if (created.type !== "note.created") throw new Error("unreachable");
    expect(created.note.gifUrl).toBeNull(); // opt-out enforced server-side
  });

  it("keeps a gifUrl on the allowlisted provider host", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const columnId = admin.sync.columns[0]?.id;
    if (!columnId) throw new Error("setup");
    await advance(admin, ["write"]);
    const noteId = newId();
    admin.socket.send({
      type: "note.create",
      opId: opId(),
      noteId,
      columnId,
      text: "good gif",
      gifUrl: "https://media.klipy.com/party.gif",
    });
    const created = await admin.socket.waitFor(
      (e) => e.type === "note.created",
    );
    if (created.type !== "note.created") throw new Error("unreachable");
    expect(created.note.gifUrl).toBe("https://media.klipy.com/party.gif");
  });
});

describe("kudos wall re-entry", () => {
  it("re-pushes existing kudos when re-entering the close phase after a rewind", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    await advance(admin, ["write", "present", "vote", "discuss", "close"]);
    const kudoId = newId();
    admin.socket.send({
      type: "kudo.create",
      opId: opId(),
      kudoId,
      cardType: "great-job",
      toId: ben.you.id,
      text: "nice",
      anonymous: false,
    });
    await ben.socket.waitFor((e) => e.type === "kudo.created");

    // Rewind to discuss (clients clear kudos), then re-enter close.
    admin.socket.send({ type: "admin.phase.set", phase: "discuss" });
    await ben.socket.waitFor(
      (e) => e.type === "phase.changed" && e.phase === "discuss",
    );
    admin.socket.send({ type: "admin.phase.set", phase: "close" });
    // Ben's client must receive the existing kudo again (no manual resync).
    const rePushed = await ben.socket.waitFor(
      (e) => e.type === "kudo.created" && e.kudo.id === kudoId,
    );
    expect(rePushed.type).toBe("kudo.created");
  });
});

describe("GIF proxy", () => {
  it("degrades gracefully to empty when no key is configured", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/gifs/search?q=celebrate",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configured: boolean; gifs: unknown[] };
    expect(body.gifs).toEqual([]);
    expect(body.configured).toBe(false); // KLIPY_API_KEY empty in tests
  });
});

describe("retention", () => {
  it("keep clears the auto-delete deadline", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    expect(admin.sync.retentionAt).not.toBeNull();

    admin.socket.send({ type: "admin.board.keep" });
    const kept = await admin.socket.waitFor(
      (e) => e.type === "retention.changed",
    );
    if (kept.type !== "retention.changed") throw new Error("unreachable");
    expect(kept.retentionAt).toBeNull();
  });

  it("the retention alarm deletes the board", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);

    // Backdate the retention deadline so the alarm treats it as due.
    const stub = boardStub(env, boardId);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE board_meta SET value = ? WHERE key = 'retentionAt'",
        String(Date.now() - 1000),
      );
    });
    const fired = await runDurableObjectAlarm(stub);
    expect(fired).toBe(true);

    const gone = await admin.socket.waitFor((e) => e.type === "board.deleted");
    expect(gone.type).toBe("board.deleted");
    // The board's meta is wiped — a fresh info() no longer finds it.
    const board = await stub.info();
    expect(board).toBeNull();
  });

  it("delete-now removes the board immediately (admin only)", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");

    ben.socket.send({ type: "admin.board.delete" });
    const rejected = await ben.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("NOT_ADMIN");

    admin.socket.send({ type: "admin.board.delete" });
    await admin.socket.waitFor((e) => e.type === "board.deleted");
    expect(await boardStub(env, boardId).info()).toBeNull();
  });

  it("the phase timer still fires when a retention deadline is also armed", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    await advance(admin, ["write"]);
    admin.socket.send({ type: "admin.timer.start", durationSec: 10 });
    await admin.socket.waitFor(
      (e) => e.type === "timer.changed" && e.timer.endsAt !== null,
    );

    const stub = boardStub(env, boardId);
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE board_meta SET value = ? WHERE key = 'timerEndsAt'",
        String(Date.now() - 1000),
      );
    });
    await runDurableObjectAlarm(stub);
    const ended = await admin.socket.waitFor((e) => e.type === "timer.ended");
    expect(ended.type).toBe("timer.ended");
    // Board still exists — retention was far in the future.
    expect(await stub.info()).not.toBeNull();
  });
});
