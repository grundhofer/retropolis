import { describe, expect, it } from "vitest";
import { applyServerEvent, initialBoardState } from "../src/domain/reducer.js";
import type {
  Column,
  Note,
  Participant,
  ServerEvent,
} from "../src/protocol.js";

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
  online: true,
};

const column: Column = { id: "c".repeat(32), name: "Went well", order: 0 };

function note(id: string, authorId: string, text: string): Note {
  return {
    id: id.repeat(32),
    columnId: column.id,
    authorId,
    text,
    order: 1,
    reactions: {},
  };
}

const sync: ServerEvent = {
  type: "sync",
  seq: 5,
  serverNow: 1000,
  board: { id: "b1", name: "Sprint 12", createdAt: 1 },
  config: {
    anonymous: false,
    phasePlan: { checkin: false, vote: false, discuss: false, close: false },
  },
  phase: "write",
  timer: { endsAt: null, pausedRemainingMs: null },
  you: { ...anna, sessionKey: "secret" },
  roster: [anna, ben],
  readyIds: [],
  columns: [column],
  notes: [note("a", anna.id, "mine")],
};

function afterSync() {
  return applyServerEvent(initialBoardState, sync);
}

describe("sync", () => {
  it("replaces the whole state and strips the session key", () => {
    const state = afterSync();
    expect(state.board?.name).toBe("Sprint 12");
    expect(state.phase).toBe("write");
    expect(state.columns).toEqual([column]);
    expect(state.notes).toHaveLength(1);
    expect(state.you).toEqual(anna);
    expect(state.you).not.toHaveProperty("sessionKey");
  });
});

describe("notes", () => {
  it("created/updated upsert idempotently (optimistic echo + server event)", () => {
    let state = afterSync();
    const fresh = note("d", anna.id, "draft");
    // optimistic echo (seq 0), then the authoritative event (seq 6)
    state = applyServerEvent(state, {
      type: "note.created",
      seq: 0,
      note: fresh,
    });
    state = applyServerEvent(state, {
      type: "note.created",
      seq: 6,
      note: fresh,
    });
    expect(state.notes.filter((n) => n.id === fresh.id)).toHaveLength(1);
    expect(state.lastSeq).toBe(6);

    state = applyServerEvent(state, {
      type: "note.updated",
      seq: 7,
      note: { ...fresh, text: "edited" },
    });
    expect(state.notes.find((n) => n.id === fresh.id)?.text).toBe("edited");
  });

  it("optimistic seq 0 never regresses lastSeq", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "note.created",
      seq: 0,
      note: note("d", anna.id, "x"),
    });
    expect(state.lastSeq).toBe(5);
  });

  it("deleted removes the note", () => {
    let state = afterSync();
    const target = state.notes[0];
    if (!target) throw new Error("setup");
    state = applyServerEvent(state, {
      type: "note.deleted",
      seq: 6,
      noteId: target.id,
    });
    expect(state.notes).toHaveLength(0);
  });

  it("notes.revealed merges foreign notes", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "notes.revealed",
      seq: 6,
      notes: [note("e", ben.id, "ben's point")],
    });
    expect(state.notes).toHaveLength(2);
  });
});

describe("phase.changed", () => {
  it("clears ready flags, ghosts and the timer", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "ready.changed",
      seq: 6,
      participantId: ben.id,
      ready: true,
    });
    state = applyServerEvent(state, {
      type: "presence.editing",
      participantId: ben.id,
      columnId: column.id,
    });
    state = applyServerEvent(state, {
      type: "timer.changed",
      seq: 7,
      timer: { endsAt: 99999, pausedRemainingMs: null },
      serverNow: 1000,
    });
    state = applyServerEvent(state, {
      type: "phase.changed",
      seq: 8,
      phase: "present",
    });
    expect(state.readyIds).toEqual([]);
    expect(state.editing).toEqual({});
    expect(state.timer.endsAt).toBeNull();
  });

  it("rewinding into an unrevealed phase drops foreign notes", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "phase.changed",
      seq: 6,
      phase: "present",
    });
    state = applyServerEvent(state, {
      type: "notes.revealed",
      seq: 6,
      notes: [note("e", ben.id, "ben's point")],
    });
    expect(state.notes).toHaveLength(2);
    state = applyServerEvent(state, {
      type: "phase.changed",
      seq: 7,
      phase: "write",
    });
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]?.authorId).toBe(anna.id);
  });
});

describe("presence & ready", () => {
  it("editing ghosts follow start/stop and leave", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "presence.editing",
      participantId: ben.id,
      columnId: column.id,
    });
    expect(state.editing[ben.id]).toBe(column.id);
    state = applyServerEvent(state, {
      type: "presence.editing",
      participantId: ben.id,
      columnId: null,
    });
    expect(state.editing[ben.id]).toBeUndefined();

    state = applyServerEvent(state, {
      type: "presence.editing",
      participantId: ben.id,
      columnId: column.id,
    });
    state = applyServerEvent(state, {
      type: "presence.leave",
      seq: 6,
      participantId: ben.id,
    });
    expect(state.editing[ben.id]).toBeUndefined();
  });

  it("ready.changed toggles without duplicates", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "ready.changed",
      seq: 6,
      participantId: ben.id,
      ready: true,
    });
    state = applyServerEvent(state, {
      type: "ready.changed",
      seq: 7,
      participantId: ben.id,
      ready: true,
    });
    expect(state.readyIds).toEqual([ben.id]);
    state = applyServerEvent(state, {
      type: "ready.changed",
      seq: 8,
      participantId: ben.id,
      ready: false,
    });
    expect(state.readyIds).toEqual([]);
  });
});

describe("columns", () => {
  it("created keeps order; deleted cascades notes", () => {
    let state = afterSync();
    const second: Column = { id: "d".repeat(32), name: "To improve", order: 1 };
    state = applyServerEvent(state, {
      type: "column.created",
      seq: 6,
      column: second,
    });
    expect(state.columns.map((c) => c.name)).toEqual([
      "Went well",
      "To improve",
    ]);

    state = applyServerEvent(state, {
      type: "column.deleted",
      seq: 7,
      columnId: column.id,
    });
    expect(state.columns).toHaveLength(1);
    expect(state.notes).toHaveLength(0); // the note lived in the deleted column
  });

  it("renamed updates in place", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "column.renamed",
      seq: 6,
      column: { ...column, name: "What rocked" },
    });
    expect(state.columns[0]?.name).toBe("What rocked");
  });
});
