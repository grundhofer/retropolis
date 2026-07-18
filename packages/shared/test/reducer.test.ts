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
    gifUrl: null,
    order: 1,
    groupId: null,
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
    phasePlan: { checkin: false, vote: true, discuss: true, close: false },
    votesPerPerson: 3,
    maxPerTarget: null,
    topN: 3,
    gifsEnabled: true,
  },
  phase: "write",
  timer: { endsAt: null, pausedRemainingMs: null },
  you: { ...anna, sessionKey: "secret" },
  roster: [anna, ben],
  readyIds: [],
  columns: [column],
  notes: [note("a", anna.id, "mine")],
  picker: null,
  lastSpin: null,
  votes: {
    mine: {},
    votersDone: 0,
    votersTotal: 0,
    tallies: null,
    topTargetIds: [],
  },
  discussFocusId: null,
  actions: [],
  kudos: [],
  icebreakerId: null,
  workingAgreements: "Vegas rule",
  roti: { count: 0, average: 0, yourScore: null },
  retentionAt: null,
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

describe("picker & roster", () => {
  it("picker.spun stores the picker and the wheel animation", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "picker.spun",
      seq: 6,
      picker: {
        remaining: [ben.id],
        presented: [],
        current: anna.id,
        excluded: [],
      },
      pool: [anna.id, ben.id],
      winnerId: anna.id,
      seed: 42,
      startAt: 1000,
      durationMs: 4500,
    });
    expect(state.picker?.current).toBe(anna.id);
    expect(state.lastSpin?.winnerId).toBe(anna.id);
  });

  it("phase.changed keeps the picker but clears the spin animation", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "picker.spun",
      seq: 6,
      picker: { remaining: [], presented: [], current: anna.id, excluded: [] },
      pool: [anna.id],
      winnerId: anna.id,
      seed: 1,
      startAt: 1000,
      durationMs: 4500,
    });
    state = applyServerEvent(state, {
      type: "phase.changed",
      seq: 7,
      phase: "present",
    });
    expect(state.picker?.current).toBe(anna.id);
    expect(state.lastSpin).toBeNull();
  });

  it("roster.updated upserts a participant and tracks `you` role changes", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "roster.updated",
      seq: 6,
      participant: { ...ben, role: "facilitator" },
    });
    expect(state.roster.find((p) => p.id === ben.id)?.role).toBe("facilitator");

    state = applyServerEvent(state, {
      type: "roster.updated",
      seq: 7,
      participant: { ...anna, role: "member" },
    });
    expect(state.you?.role).toBe("member");
  });
});

describe("voting & discussion", () => {
  it("vote.progress tracks only your own votes; votes.revealed brings tallies", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "vote.progress",
      yourVotes: { [column.id]: 2 },
    });
    expect(state.votes.mine[column.id]).toBe(2);
    expect(state.votes.tallies).toBeNull();

    state = applyServerEvent(state, {
      type: "votes.revealed",
      seq: 6,
      tallies: { [column.id]: 5 },
      topTargetIds: [column.id],
    });
    expect(state.votes.tallies?.[column.id]).toBe(5);
    expect(state.votes.topTargetIds).toEqual([column.id]);
  });

  it("rewinding into the vote phase makes voting blind again", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "votes.revealed",
      seq: 6,
      tallies: { [column.id]: 5 },
      topTargetIds: [column.id],
    });
    state = applyServerEvent(state, {
      type: "discuss.focus",
      seq: 7,
      targetId: column.id,
    });
    expect(state.discussFocusId).toBe(column.id);

    state = applyServerEvent(state, {
      type: "phase.changed",
      seq: 8,
      phase: "vote",
    });
    expect(state.votes.tallies).toBeNull();
    expect(state.votes.topTargetIds).toEqual([]);
    expect(state.discussFocusId).toBeNull();
    // own votes survive the rewind
    expect(state.votes.mine).toEqual({});
  });

  it("meter and actions flow through", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "vote.meter",
      seq: 6,
      votersDone: 1,
      votersTotal: 2,
    });
    expect(state.votes.votersDone).toBe(1);

    const action = {
      id: "f".repeat(32),
      text: "Fix the pipeline",
      ownerId: ben.id,
      status: "open" as const,
    };
    state = applyServerEvent(state, { type: "action.created", seq: 7, action });
    state = applyServerEvent(state, {
      type: "action.updated",
      seq: 8,
      action: { ...action, status: "done" },
    });
    expect(state.actions[0]?.status).toBe("done");
    state = applyServerEvent(state, {
      type: "action.deleted",
      seq: 9,
      actionId: action.id,
    });
    expect(state.actions).toHaveLength(0);
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

describe("appreciation & retention (M4)", () => {
  const kudo = {
    id: "d".repeat(32),
    cardType: "great-job" as const,
    toId: ben.id,
    fromId: anna.id,
    text: "shipped it",
    gifUrl: null,
  };

  it("kudo.created upserts and kudo.deleted removes", () => {
    let state = afterSync();
    state = applyServerEvent(state, { type: "kudo.created", seq: 6, kudo });
    expect(state.kudos).toHaveLength(1);
    state = applyServerEvent(state, {
      type: "kudo.created",
      seq: 7,
      kudo: { ...kudo, text: "shipped it well" },
    });
    expect(state.kudos).toHaveLength(1);
    expect(state.kudos[0]?.text).toBe("shipped it well");
    state = applyServerEvent(state, {
      type: "kudo.deleted",
      seq: 8,
      kudoId: kudo.id,
    });
    expect(state.kudos).toHaveLength(0);
  });

  it("leaving the close phase hides the kudos wall again", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "phase.changed",
      seq: 6,
      phase: "close",
    });
    state = applyServerEvent(state, { type: "kudo.created", seq: 7, kudo });
    expect(state.kudos).toHaveLength(1);
    // rewind to discuss — kudos vanish
    state = applyServerEvent(state, {
      type: "phase.changed",
      seq: 8,
      phase: "discuss",
    });
    expect(state.kudos).toHaveLength(0);
    // done keeps them
    state = applyServerEvent(state, {
      type: "phase.changed",
      seq: 9,
      phase: "close",
    });
    state = applyServerEvent(state, { type: "kudo.created", seq: 10, kudo });
    state = applyServerEvent(state, {
      type: "phase.changed",
      seq: 11,
      phase: "done",
    });
    expect(state.kudos).toHaveLength(1);
  });

  it("retention.changed updates the deadline; board.deleted sets the flag", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "retention.changed",
      seq: 6,
      retentionAt: null,
    });
    expect(state.retentionAt).toBeNull();
    state = applyServerEvent(state, { type: "board.deleted" });
    expect(state.deleted).toBe(true);
  });

  it("note gifUrl flows through note events", () => {
    let state = afterSync();
    const gifNote = {
      ...note("e", anna.id, "with gif"),
      gifUrl: "https://cdn.example/x.gif",
    };
    state = applyServerEvent(state, {
      type: "note.created",
      seq: 6,
      note: gifNote,
    });
    expect(state.notes.find((n) => n.id === gifNote.id)?.gifUrl).toBe(
      "https://cdn.example/x.gif",
    );
  });
});

describe("check-in & ROTI (M5)", () => {
  it("checkin.shuffled and agreements.changed update state", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "checkin.shuffled",
      seq: 6,
      icebreakerId: "weather",
    });
    expect(state.icebreakerId).toBe("weather");
    state = applyServerEvent(state, {
      type: "agreements.changed",
      seq: 7,
      text: "Be kind",
    });
    expect(state.workingAgreements).toBe("Be kind");
  });

  it("roti.aggregate updates the anonymous average; roti.you tracks own score", () => {
    let state = afterSync();
    state = applyServerEvent(state, {
      type: "roti.aggregate",
      seq: 6,
      count: 3,
      average: 4.5,
    });
    expect(state.roti.count).toBe(3);
    expect(state.roti.average).toBe(4.5);
    expect(state.roti.yourScore).toBeNull();
    state = applyServerEvent(state, { type: "roti.you", yourScore: 5 });
    expect(state.roti.yourScore).toBe(5);
    state = applyServerEvent(state, {
      type: "roti.aggregate",
      seq: 7,
      count: 4,
      average: 4.75,
    });
    expect(state.roti.yourScore).toBe(5); // aggregate must not clobber own score
  });
});
