import { describe, expect, it } from "vitest";
import { ICEBREAKER_IDS, type ServerEvent } from "@retropolis/shared";
import { connect, createBoard, type TestSocket } from "./helpers.js";

let opCounter = 12000;
function opId(): string {
  return (opCounter++).toString(16).padStart(32, "0");
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

async function toClose(admin: { socket: TestSocket }) {
  for (const p of ["checkin", "write", "present", "vote", "discuss", "close"]) {
    await toPhase(admin.socket, p);
  }
}

describe("check-in", () => {
  it("picks an icebreaker on entering check-in; the admin can shuffle it for everyone", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");

    admin.socket.send({ type: "admin.phase.set", phase: "checkin" });
    const shuffled = await ben.socket.waitFor(
      (e) => e.type === "checkin.shuffled",
    );
    if (shuffled.type !== "checkin.shuffled") throw new Error("unreachable");
    const first = shuffled.icebreakerId;
    expect(ICEBREAKER_IDS).toContain(first);

    // Ben's fresh sync carries the same icebreaker (persisted).
    ben.socket.send({ type: "resync" });
    const sync = await ben.socket.waitFor(
      (e) => e.type === "sync" && e.icebreakerId !== null,
    );
    if (sync.type !== "sync") throw new Error("unreachable");
    expect(sync.icebreakerId).toBe(first);

    // Admin shuffle picks a DIFFERENT question, synced to Ben.
    admin.socket.send({ type: "admin.checkin.shuffle" });
    const reshuffled = await ben.socket.waitFor(
      (e) => e.type === "checkin.shuffled" && e.icebreakerId !== first,
    );
    if (reshuffled.type !== "checkin.shuffled") throw new Error("unreachable");
    expect(reshuffled.icebreakerId).not.toBe(first);
  });

  it("only the facilitator shuffles, and only during check-in", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    await toPhase(admin.socket, "checkin");

    ben.socket.send({ type: "admin.checkin.shuffle" });
    const notAdmin = await ben.socket.waitFor((e) => e.type === "reject");
    if (notAdmin.type !== "reject") throw new Error("unreachable");
    expect(notAdmin.code).toBe("NOT_ADMIN");

    await toPhase(admin.socket, "write");
    admin.socket.send({ type: "admin.checkin.shuffle" });
    const locked = await admin.socket.waitFor((e) => e.type === "reject");
    if (locked.type !== "reject") throw new Error("unreachable");
    expect(locked.code).toBe("PHASE_LOCKED");
  });

  it("the facilitator edits working agreements; everyone sees it, and it persists", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");

    admin.socket.send({
      type: "admin.agreements.set",
      text: "Vegas rule. Be kind.",
    });
    const changed = await ben.socket.waitFor(
      (e) => e.type === "agreements.changed",
    );
    if (changed.type !== "agreements.changed") throw new Error("unreachable");
    expect(changed.text).toBe("Vegas rule. Be kind.");

    const cara = await joined(boardId, "Cara");
    expect(cara.sync.workingAgreements).toBe("Vegas rule. Be kind.");

    // Members can't edit.
    ben.socket.send({ type: "admin.agreements.set", text: "hacked" });
    const rejected = await ben.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("NOT_ADMIN");
  });
});

describe("ROTI closing poll", () => {
  it("is anonymous: withholds the average until enough people respond, then shares only the aggregate", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    const ben = await joined(boardId, "Ben");
    const cara = await joined(boardId, "Cara");
    await toClose(admin);

    // Anna rates 5 → she alone learns her score; others see the count but NO
    // average (a single respondent's average would BE her exact score).
    admin.socket.send({ type: "roti.set", score: 5 });
    const you = await admin.socket.waitFor((e) => e.type === "roti.you");
    if (you.type !== "roti.you") throw new Error("unreachable");
    expect(you.yourScore).toBe(5);

    const agg1 = await ben.socket.waitFor(
      (e) => e.type === "roti.aggregate" && e.count === 1,
    );
    if (agg1.type !== "roti.aggregate") throw new Error("unreachable");
    expect(agg1.average).toBeNull(); // withheld below the anonymity threshold
    // Ben got no roti.you (that's private to the caster's own sockets).
    expect(ben.socket.events.some((e) => e.type === "roti.you")).toBe(false);

    // Two respondents still isn't enough — a co-voter could subtract their own.
    ben.socket.send({ type: "roti.set", score: 3 });
    const agg2 = await admin.socket.waitFor(
      (e) => e.type === "roti.aggregate" && e.count === 2,
    );
    if (agg2.type !== "roti.aggregate") throw new Error("unreachable");
    expect(agg2.average).toBeNull();

    // The third response clears the threshold: now the average appears.
    cara.socket.send({ type: "roti.set", score: 4 });
    const agg3 = await admin.socket.waitFor(
      (e) => e.type === "roti.aggregate" && e.count === 3 && e.average === 4,
    );
    if (agg3.type !== "roti.aggregate") throw new Error("unreachable");
    expect(agg3.average).toBe(4); // (5 + 3 + 4) / 3

    // Re-voting updates in place (count stays 3), the average recomputes.
    admin.socket.send({ type: "roti.set", score: 1 });
    const agg4 = await admin.socket.waitFor(
      (e) => e.type === "roti.aggregate" && e.count === 3 && e.average === 2.7,
    );
    if (agg4.type !== "roti.aggregate") throw new Error("unreachable");
    expect(agg4.count).toBe(3); // still 3 voters, (1 + 3 + 4) / 3 → 2.7

    // A fresh joiner's sync carries the aggregate but only their own (null) score.
    const dan = await joined(boardId, "Dan");
    expect(dan.sync.roti.count).toBe(3);
    expect(dan.sync.roti.average).toBe(2.7);
    expect(dan.sync.roti.yourScore).toBeNull();
  });

  it("sends the caster's own score to every one of their sockets", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    await toClose(admin);

    // Anna opens a second tab: same identity, reclaimed via her session key.
    const tab2 = await connect(boardId);
    tab2.send({ type: "join", name: "Anna", sessionKey: admin.you.sessionKey });
    await tab2.waitFor((e) => e.type === "sync");

    // She rates on tab 1 → BOTH of her tabs learn her own score (no stale
    // selection on the projector view), and neither leaks to anyone else.
    admin.socket.send({ type: "roti.set", score: 4 });
    const you1 = await admin.socket.waitFor((e) => e.type === "roti.you");
    const you2 = await tab2.waitFor((e) => e.type === "roti.you");
    if (you1.type !== "roti.you" || you2.type !== "roti.you") {
      throw new Error("unreachable");
    }
    expect(you1.yourScore).toBe(4);
    expect(you2.yourScore).toBe(4);
  });

  it("only accepts ROTI votes in the close phase", async () => {
    const { boardId, adminToken } = await createBoard();
    const admin = await joined(boardId, "Anna", adminToken);
    admin.socket.send({ type: "roti.set", score: 4 });
    const rejected = await admin.socket.waitFor((e) => e.type === "reject");
    if (rejected.type !== "reject") throw new Error("unreachable");
    expect(rejected.code).toBe("PHASE_LOCKED");
    void opId;
  });
});
