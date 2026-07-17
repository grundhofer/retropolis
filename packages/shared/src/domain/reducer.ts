import type {
  Action,
  BoardConfig,
  BoardInfo,
  Column,
  Note,
  Participant,
  ServerEvent,
  Timer,
} from "../protocol.js";
import { IDLE_TIMER } from "../protocol.js";
import { phaseRevealed, type Phase } from "./phases.js";
import type { PickerState, WheelSpin } from "./picker.js";

export interface VotesState {
  /** your OWN votes only — blind voting */
  mine: Record<string, number>;
  votersDone: number;
  votersTotal: number;
  /** null while blind (vote phase and earlier) */
  tallies: Record<string, number> | null;
  topTargetIds: string[];
}

export const EMPTY_VOTES: VotesState = {
  mine: {},
  votersDone: 0,
  votersTotal: 0,
  tallies: null,
  topTargetIds: [],
};

export interface ClientBoardState {
  board: BoardInfo | null;
  config: BoardConfig | null;
  phase: Phase;
  timer: Timer;
  you: Participant | null;
  roster: Participant[];
  /** participants who pressed "I'm done" in the current phase */
  readyIds: string[];
  columns: Column[];
  notes: Note[];
  /** ghost cards: participantId -> columnId they are currently writing in */
  editing: Record<string, string>;
  /** presenter rotation; null until the board first enters "present" */
  picker: PickerState | null;
  /** the wheel animation currently (or most recently) playing */
  lastSpin: WheelSpin | null;
  votes: VotesState;
  discussFocusId: string | null;
  actions: Action[];
  lastSeq: number;
}

export const initialBoardState: ClientBoardState = {
  board: null,
  config: null,
  phase: "lobby",
  timer: IDLE_TIMER,
  you: null,
  roster: [],
  readyIds: [],
  columns: [],
  notes: [],
  editing: {},
  picker: null,
  lastSpin: null,
  votes: EMPTY_VOTES,
  discussFocusId: null,
  actions: [],
  lastSeq: 0,
};

// The one reducer both sides share: the client applies it to render server
// events AND to echo its own optimistic commands (same event shape, seq 0),
// so reconciliation is symmetric by construction. It must stay pure.
export function applyServerEvent(
  state: ClientBoardState,
  event: ServerEvent,
): ClientBoardState {
  switch (event.type) {
    case "sync": {
      const { sessionKey: _sessionKey, ...you } = event.you;
      return {
        board: event.board,
        config: event.config,
        phase: event.phase,
        timer: event.timer,
        you,
        roster: event.roster,
        readyIds: event.readyIds,
        columns: event.columns,
        notes: event.notes,
        editing: {},
        picker: event.picker,
        lastSpin: event.lastSpin,
        votes: event.votes,
        discussFocusId: event.discussFocusId,
        actions: event.actions,
        lastSeq: event.seq,
      };
    }

    case "ack":
    case "reject":
    case "error":
      return state;

    case "presence.join":
    case "roster.updated": {
      const roster = upsertById(state.roster, event.participant);
      const you =
        state.you && state.you.id === event.participant.id
          ? event.participant
          : state.you;
      return { ...state, roster, you, lastSeq: seq(state, event.seq) };
    }

    case "picker.changed":
      return { ...state, picker: event.picker, lastSeq: seq(state, event.seq) };

    case "config.changed":
      return { ...state, config: event.config, lastSeq: seq(state, event.seq) };

    case "vote.progress":
      return { ...state, votes: { ...state.votes, mine: event.yourVotes } };

    case "vote.meter":
      return {
        ...state,
        votes: {
          ...state.votes,
          votersDone: event.votersDone,
          votersTotal: event.votersTotal,
        },
        lastSeq: seq(state, event.seq),
      };

    case "votes.revealed":
      return {
        ...state,
        votes: {
          ...state.votes,
          tallies: event.tallies,
          topTargetIds: event.topTargetIds,
        },
        lastSeq: seq(state, event.seq),
      };

    case "discuss.focus":
      return {
        ...state,
        discussFocusId: event.targetId,
        lastSeq: seq(state, event.seq),
      };

    case "action.created":
    case "action.updated":
      return {
        ...state,
        actions: upsertById(state.actions, event.action),
        lastSeq: seq(state, event.seq),
      };

    case "action.deleted":
      return {
        ...state,
        actions: state.actions.filter((a) => a.id !== event.actionId),
        lastSeq: seq(state, event.seq),
      };

    case "picker.spun":
      return {
        ...state,
        picker: event.picker,
        lastSpin: {
          pool: event.pool,
          winnerId: event.winnerId,
          seed: event.seed,
          startAt: event.startAt,
          durationMs: event.durationMs,
        },
        lastSeq: seq(state, event.seq),
      };

    case "presence.leave": {
      const roster = state.roster.map((p) =>
        p.id === event.participantId ? { ...p, online: false } : p,
      );
      const editing = { ...state.editing };
      delete editing[event.participantId];
      return { ...state, roster, editing, lastSeq: seq(state, event.seq) };
    }

    case "presence.editing": {
      const editing = { ...state.editing };
      if (event.columnId === null) delete editing[event.participantId];
      else editing[event.participantId] = event.columnId;
      return { ...state, editing };
    }

    case "ready.changed": {
      const without = state.readyIds.filter((id) => id !== event.participantId);
      const readyIds = event.ready
        ? [...without, event.participantId]
        : without;
      return { ...state, readyIds, lastSeq: seq(state, event.seq) };
    }

    case "note.created":
    case "note.updated": {
      return {
        ...state,
        notes: upsertById(state.notes, event.note),
        lastSeq: seq(state, event.seq),
      };
    }

    case "note.deleted": {
      return {
        ...state,
        notes: state.notes.filter((n) => n.id !== event.noteId),
        lastSeq: seq(state, event.seq),
      };
    }

    case "notes.revealed": {
      let notes = state.notes;
      for (const note of event.notes) notes = upsertById(notes, note);
      return { ...state, notes, lastSeq: seq(state, event.seq) };
    }

    case "phase.changed": {
      // Ready flags and timers are per-phase; ghosts are per-phase too. On a
      // rewind into an unrevealed phase, foreign notes vanish again — the
      // server stops sending them, and the client must drop what it has.
      const notes = phaseRevealed(event.phase)
        ? state.notes
        : state.notes.filter(
            (n) => n.authorId !== null && n.authorId === state.you?.id,
          );
      // Rewinding into the vote phase makes voting blind again: tallies and
      // crowns vanish until the next reveal. The discussion focus is per-phase.
      const votes =
        event.phase === "vote" || !phaseRevealed(event.phase)
          ? { ...state.votes, tallies: null, topTargetIds: [] }
          : state.votes;
      return {
        ...state,
        phase: event.phase,
        notes,
        readyIds: [],
        editing: {},
        timer: IDLE_TIMER,
        lastSpin: null, // the picker itself persists across phase changes
        votes,
        discussFocusId: null,
        lastSeq: seq(state, event.seq),
      };
    }

    case "timer.changed":
      return { ...state, timer: event.timer, lastSeq: seq(state, event.seq) };

    case "timer.ended":
      return { ...state, timer: IDLE_TIMER, lastSeq: seq(state, event.seq) };

    case "column.created":
    case "column.renamed": {
      const columns = upsertById(state.columns, event.column).sort(
        (a, b) => a.order - b.order,
      );
      return { ...state, columns, lastSeq: seq(state, event.seq) };
    }

    case "column.deleted": {
      return {
        ...state,
        columns: state.columns.filter((c) => c.id !== event.columnId),
        notes: state.notes.filter((n) => n.columnId !== event.columnId),
        lastSeq: seq(state, event.seq),
      };
    }
  }
}

function seq(state: ClientBoardState, eventSeq: number): number {
  // Optimistic local echoes carry seq 0 and must not regress the counter.
  return Math.max(state.lastSeq, eventSeq);
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index === -1) return [...list, item];
  return list.map((entry, i) => (i === index ? item : entry));
}
