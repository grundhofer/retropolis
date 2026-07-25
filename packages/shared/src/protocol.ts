import { z } from "zod";
import { hexIdSchema } from "./ids.js";
import {
  icebreakerIdSchema,
  workingAgreementsSchema,
} from "./domain/icebreakers.js";
import { layoutModeSchema } from "./domain/layout.js";
import { phasePlanSchema, phaseSchema } from "./domain/phases.js";
import {
  pickerStateSchema,
  pickerStyles,
  wheelSpinSchema,
} from "./domain/picker.js";
import { sessionKeySchema } from "./session-key.js";

export const rotiScoreSchema = z.number().int().min(1).max(5);

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export const participantRoleSchema = z.enum(["facilitator", "member"]);
export type ParticipantRole = z.infer<typeof participantRoleSchema>;

export const participantSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  role: participantRoleSchema,
  online: z.boolean(),
});
export type Participant = z.infer<typeof participantSchema>;

export const boardInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
});
export type BoardInfo = z.infer<typeof boardInfoSchema>;

export const pickerStyleSchema = z.enum(pickerStyles);

export const boardConfigSchema = z.object({
  anonymous: z.boolean(),
  phasePlan: phasePlanSchema,
  /** dot-voting budget per person (blind voting, product spec §6) */
  votesPerPerson: z.number().int().min(1).max(10),
  /** optional cap per card/stack; null = only the personal budget limits */
  maxPerTarget: z.number().int().min(1).max(10).nullable(),
  /** how many top-voted cards get crowned for discussion */
  topN: z.number().int().min(1).max(10),
  /** GIF search on notes/kudos; per-board opt-out for privacy-strict teams */
  gifsEnabled: z.boolean(),
  /** who-presents-next picker skin — pure presentation, same server draw.
   *  Defaulted so boards created before the field parse as the classic wheel. */
  pickerStyle: pickerStyleSchema.default("wheel"),
  /** board layout: classic columns or a freeform canvas of the same zones.
   *  Defaulted so boards created before the field parse as columns. */
  layout: layoutModeSchema.default("columns"),
});
export type BoardConfig = z.infer<typeof boardConfigSchema>;

export const gifUrlSchema = z.string().url().max(500);

export const DEFAULT_VOTE_CONFIG = {
  votesPerPerson: 3,
  maxPerTarget: null,
  topN: 3,
} as const;

export const actionTextSchema = z.string().trim().min(1).max(300);

export const actionStatusSchema = z.enum(["open", "done"]);
export const actionSchema = z.object({
  id: hexIdSchema,
  text: z.string(),
  /** owning participant; null = unassigned */
  ownerId: z.string().nullable(),
  status: actionStatusSchema,
});
export type Action = z.infer<typeof actionSchema>;

export const columnSchema = z.object({
  id: hexIdSchema,
  name: z.string(),
  order: z.number(),
  /** staged column: withheld from members (with its notes) until the
   *  facilitator reveals it. Defaulted so pre-M6 payloads parse as visible. */
  hidden: z.boolean().default(false),
});
export type Column = z.infer<typeof columnSchema>;

export const noteSchema = z.object({
  id: hexIdSchema,
  columnId: hexIdSchema,
  // null = anonymized for this viewer (anonymous boards). Own notes always
  // carry the viewer's id so the client knows they are editable.
  authorId: z.string().nullable(),
  text: z.string(),
  gifUrl: gifUrlSchema.nullable(),
  order: z.number(),
  // canvas position: normalized [0,1] fraction WITHIN the note's own zone
  // (columnId stays authoritative). null = unplaced; ignored in column mode.
  // Defaulted so pre-canvas payloads parse.
  x: z.number().min(0).max(1).nullable().default(null),
  y: z.number().min(0).max(1).nullable().default(null),
  // notes sharing a groupId form a stack (merged duplicates)
  groupId: hexIdSchema.nullable(),
  // emoji -> participant ids
  reactions: z.record(z.string(), z.array(z.string())),
});
export type Note = z.infer<typeof noteSchema>;

// Appreciation wall (product spec §7): Management-3.0-style kudo cards
// addressed to a named teammate, revealed as the closing finale.
export const KUDO_CARD_TYPES = [
  "thank-you",
  "great-job",
  "well-done",
  "congratulations",
  "totally-awesome",
] as const;
export const kudoCardTypeSchema = z.enum(KUDO_CARD_TYPES);
export type KudoCardType = z.infer<typeof kudoCardTypeSchema>;

export const kudoTextSchema = z.string().trim().max(300);

export const kudoSchema = z.object({
  id: hexIdSchema,
  cardType: kudoCardTypeSchema,
  toId: z.string(),
  // null = anonymous sender, or redacted for viewers on an anonymous board
  fromId: z.string().nullable(),
  text: z.string(),
  gifUrl: gifUrlSchema.nullable(),
});
export type Kudo = z.infer<typeof kudoSchema>;

export const timerSchema = z.object({
  endsAt: z.number().nullable(),
  pausedRemainingMs: z.number().nullable(),
});
export type Timer = z.infer<typeof timerSchema>;

export const IDLE_TIMER: Timer = { endsAt: null, pausedRemainingMs: null };

// ---------------------------------------------------------------------------
// Validation shared by both ends
// ---------------------------------------------------------------------------

export const displayNameSchema = z.string().trim().min(1).max(40);
export const boardNameSchema = z.string().trim().min(1).max(60);
export const columnNameSchema = z.string().trim().min(1).max(60);

export const NOTE_TEXT_MAX = 500;
export const noteTextSchema = z.string().trim().min(1).max(NOTE_TEXT_MAX);

// The fixed reaction row (product spec §5); the full picker arrives in M4.
export const REACTION_EMOJI = ["👍", "❤️", "😂", "🎉", "👀"] as const;
export const reactionEmojiSchema = z.enum(REACTION_EMOJI);
export type ReactionEmoji = z.infer<typeof reactionEmojiSchema>;

// ---------------------------------------------------------------------------
// Client → Server. Mutating commands carry a client-minted opId (acked or
// rejected); presence-style messages are fire-and-forget and never persisted.
// ---------------------------------------------------------------------------

export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    name: displayNameSchema,
    sessionKey: sessionKeySchema.optional(),
    adminToken: z.string().optional(),
  }),
  z.object({ type: z.literal("leave") }),
  z.object({ type: z.literal("resync") }),

  z.object({
    type: z.literal("presence.editing"),
    columnId: hexIdSchema.nullable(),
  }),
  z.object({ type: z.literal("ready.set"), ready: z.boolean() }),

  z.object({
    type: z.literal("note.create"),
    opId: hexIdSchema,
    noteId: hexIdSchema,
    columnId: hexIdSchema,
    text: noteTextSchema,
    gifUrl: gifUrlSchema.nullable().optional(),
    // canvas placement (omitted in column mode)
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("note.update"),
    opId: hexIdSchema,
    noteId: hexIdSchema,
    text: noteTextSchema,
    gifUrl: gifUrlSchema.nullable().optional(),
  }),
  z.object({
    type: z.literal("note.delete"),
    opId: hexIdSchema,
    noteId: hexIdSchema,
  }),
  z.object({
    type: z.literal("note.react"),
    opId: hexIdSchema,
    noteId: hexIdSchema,
    emoji: reactionEmojiSchema,
    on: z.boolean(),
  }),
  // Stacking duplicates: the group id is deterministic (the target's existing
  // group or the target note's own id) so optimistic echoes match the server.
  z.object({
    type: z.literal("note.group"),
    opId: hexIdSchema,
    noteId: hexIdSchema,
    targetNoteId: hexIdSchema,
  }),
  z.object({
    type: z.literal("note.ungroup"),
    opId: hexIdSchema,
    noteId: hexIdSchema,
  }),
  z.object({
    type: z.literal("note.move"),
    opId: hexIdSchema,
    noteId: hexIdSchema,
    columnId: hexIdSchema,
    // present = a canvas reposition (persist x,y); absent = a column-mode move
    // (position is cleared). Same-zone drops with x set keep the stack.
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
  }),

  z.object({ type: z.literal("admin.phase.set"), phase: phaseSchema }),
  z.object({
    type: z.literal("admin.timer.start"),
    durationSec: z.number().int().min(10).max(3600),
  }),
  z.object({ type: z.literal("admin.timer.pause") }),
  z.object({ type: z.literal("admin.timer.resume") }),
  z.object({
    type: z.literal("admin.timer.extend"),
    addSec: z.number().int().min(10).max(600),
  }),
  z.object({ type: z.literal("admin.timer.stop") }),

  z.object({
    type: z.literal("admin.column.create"),
    opId: hexIdSchema,
    columnId: hexIdSchema,
    name: columnNameSchema,
  }),
  z.object({
    type: z.literal("admin.column.rename"),
    opId: hexIdSchema,
    columnId: hexIdSchema,
    name: columnNameSchema,
  }),
  z.object({
    type: z.literal("admin.column.delete"),
    opId: hexIdSchema,
    columnId: hexIdSchema,
  }),
  z.object({
    type: z.literal("admin.column.setHidden"),
    opId: hexIdSchema,
    columnId: hexIdSchema,
    hidden: z.boolean(),
  }),

  // Voting targets are "votables": ungrouped notes or stacks (group ids).
  z.object({
    type: z.literal("vote.cast"),
    opId: hexIdSchema,
    targetId: hexIdSchema,
    delta: z.union([z.literal(1), z.literal(-1)]),
  }),
  z.object({
    type: z.literal("admin.vote.config"),
    votesPerPerson: z.number().int().min(1).max(10),
    maxPerTarget: z.number().int().min(1).max(10).nullable(),
    topN: z.number().int().min(1).max(10),
  }),
  z.object({
    type: z.literal("admin.discuss.focus"),
    targetId: hexIdSchema.nullable(),
  }),

  z.object({
    type: z.literal("action.create"),
    opId: hexIdSchema,
    actionId: hexIdSchema,
    text: actionTextSchema,
    ownerId: z.string().nullable(),
  }),
  z.object({
    type: z.literal("action.update"),
    opId: hexIdSchema,
    actionId: hexIdSchema,
    text: actionTextSchema.optional(),
    ownerId: z.string().nullable().optional(),
    status: actionStatusSchema.optional(),
  }),
  z.object({
    type: z.literal("action.delete"),
    opId: hexIdSchema,
    actionId: hexIdSchema,
  }),

  z.object({ type: z.literal("admin.picker.spin") }),
  z.object({ type: z.literal("admin.picker.skip") }),
  // Facilitator hand-picks the next presenter directly (no wheel) — same
  // rotation bookkeeping as a spin, just a targeted draw.
  z.object({
    type: z.literal("admin.picker.pick"),
    participantId: z.string(),
  }),
  // The person currently presenting marks themselves done (member OR
  // facilitator) — completes their turn and hands control back to the wheel.
  z.object({ type: z.literal("picker.done") }),
  z.object({
    type: z.literal("admin.picker.style"),
    style: pickerStyleSchema,
  }),
  // Switch the board between classic columns and the freeform canvas — pure
  // presentation over the same zones/notes (mirrors admin.picker.style).
  z.object({
    type: z.literal("admin.layout.set"),
    layout: layoutModeSchema,
  }),
  z.object({
    type: z.literal("admin.picker.exclude"),
    participantId: z.string(),
  }),
  z.object({
    type: z.literal("admin.picker.include"),
    participantId: z.string(),
  }),
  z.object({
    type: z.literal("admin.role.set"),
    participantId: z.string(),
    role: participantRoleSchema,
  }),

  // Appreciation wall — created and shown only in the close phase.
  z.object({
    type: z.literal("kudo.create"),
    opId: hexIdSchema,
    kudoId: hexIdSchema,
    cardType: kudoCardTypeSchema,
    toId: z.string(),
    text: kudoTextSchema,
    gifUrl: gifUrlSchema.nullable().optional(),
    anonymous: z.boolean(),
  }),
  z.object({
    type: z.literal("kudo.delete"),
    opId: hexIdSchema,
    kudoId: hexIdSchema,
  }),

  z.object({ type: z.literal("admin.gifs.set"), enabled: z.boolean() }),
  // Retention: keep the board (clear the 90-day auto-delete) or delete it now.
  z.object({ type: z.literal("admin.board.keep") }),
  z.object({ type: z.literal("admin.board.delete") }),

  // Check-in warm-up.
  z.object({ type: z.literal("admin.checkin.shuffle") }),
  z.object({
    type: z.literal("admin.agreements.set"),
    text: workingAgreementsSchema,
  }),
  // ROTI closing poll — anonymous 1-5 "was this worth your time?".
  z.object({ type: z.literal("roti.set"), score: rotiScoreSchema }),
]);
export type ClientCommand = z.infer<typeof clientCommandSchema>;

// ---------------------------------------------------------------------------
// Server → Client. Every broadcast carries a monotonic per-board seq for gap
// detection. `sync` is the full per-recipient-FILTERED snapshot sent on every
// (re)join and on request — the snapshot goes through the same visibility
// filter as live events (the classic leak path).
// ---------------------------------------------------------------------------

export const rejectCodeSchema = z.enum([
  "PHASE_LOCKED",
  "NOT_ADMIN",
  "NOT_AUTHOR",
  "NOT_FOUND",
  "CONFLICT",
  "INVALID",
  "VOTE_BUDGET",
]);
export type RejectCode = z.infer<typeof rejectCodeSchema>;

export const serverEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sync"),
    seq: z.number(),
    serverNow: z.number(),
    board: boardInfoSchema,
    config: boardConfigSchema,
    phase: phaseSchema,
    timer: timerSchema,
    you: participantSchema.extend({ sessionKey: z.string() }),
    roster: z.array(participantSchema),
    readyIds: z.array(z.string()),
    columns: z.array(columnSchema),
    notes: z.array(noteSchema),
    /** write-phase privacy relaxation: the TOTAL note count per column (no
     *  author, no text). Clients subtract their own notes to show an
     *  anonymized "N cards from the team" placeholder. Defaulted so older
     *  snapshots parse. */
    columnCounts: z.record(z.string(), z.number()).default({}),
    picker: pickerStateSchema.nullable(),
    /** the spin currently animating, if any — survives reconnect syncs */
    lastSpin: wheelSpinSchema.nullable(),
    votes: z.object({
      /** the recipient's OWN votes: targetId -> count (blind voting: nobody
       *  else's votes ever appear here) */
      mine: z.record(z.string(), z.number()),
      /** anonymous progress: how many online participants used their budget */
      votersDone: z.number(),
      votersTotal: z.number(),
      /** revealed tallies — null during (and before) the vote phase */
      tallies: z.record(z.string(), z.number()).nullable(),
      topTargetIds: z.array(z.string()),
    }),
    discussFocusId: hexIdSchema.nullable(),
    actions: z.array(actionSchema),
    // Kudos are only populated in the close/done phases (staged reveal).
    kudos: z.array(kudoSchema),
    /** epoch-ms when the board auto-deletes; null once the admin kept it */
    retentionAt: z.number().nullable(),
    /** current check-in icebreaker (null until check-in has run) */
    icebreakerId: icebreakerIdSchema.nullable(),
    workingAgreements: z.string(),
    /** ROTI closing poll: anonymous aggregate + the recipient's own score.
     *  average is null until enough people respond to keep it anonymous. */
    roti: z.object({
      count: z.number(),
      average: z.number().nullable(),
      yourScore: z.number().nullable(),
    }),
  }),

  z.object({ type: z.literal("ack"), opId: hexIdSchema, seq: z.number() }),
  z.object({
    type: z.literal("reject"),
    opId: hexIdSchema.optional(),
    code: rejectCodeSchema,
    reason: z.string(),
  }),

  z.object({
    type: z.literal("presence.join"),
    seq: z.number(),
    participant: participantSchema,
  }),
  z.object({
    type: z.literal("presence.leave"),
    seq: z.number(),
    participantId: z.string(),
  }),
  z.object({
    type: z.literal("presence.editing"),
    participantId: z.string(),
    columnId: hexIdSchema.nullable(),
  }),
  z.object({
    type: z.literal("ready.changed"),
    seq: z.number(),
    participantId: z.string(),
    ready: z.boolean(),
  }),

  z.object({
    type: z.literal("note.created"),
    seq: z.number(),
    note: noteSchema,
  }),
  z.object({
    type: z.literal("note.updated"),
    seq: z.number(),
    note: noteSchema,
  }),
  z.object({
    type: z.literal("note.deleted"),
    seq: z.number(),
    noteId: hexIdSchema,
  }),
  z.object({
    type: z.literal("notes.revealed"),
    seq: z.number(),
    notes: z.array(noteSchema),
  }),
  // Anonymized per-column note totals, broadcast during the write phase so
  // members see that cards exist (count only — never author or text).
  z.object({
    type: z.literal("board.columnCounts"),
    seq: z.number(),
    counts: z.record(z.string(), z.number()),
  }),

  z.object({
    type: z.literal("phase.changed"),
    seq: z.number(),
    phase: phaseSchema,
  }),
  z.object({
    type: z.literal("timer.changed"),
    seq: z.number(),
    timer: timerSchema,
    serverNow: z.number(),
  }),
  z.object({ type: z.literal("timer.ended"), seq: z.number() }),

  // A spin: every client replays the identical wheel animation over `pool`
  // (segment layout order) from `seed`, landing on `winnerId` at
  // `startAt + durationMs` (server clock).
  z.object({
    type: z.literal("picker.spun"),
    seq: z.number(),
    picker: pickerStateSchema,
    pool: z.array(z.string()),
    winnerId: z.string(),
    seed: z.number(),
    startAt: z.number(),
    durationMs: z.number(),
  }),
  z.object({
    type: z.literal("picker.changed"),
    seq: z.number(),
    picker: pickerStateSchema,
  }),
  z.object({
    type: z.literal("config.changed"),
    seq: z.number(),
    config: boardConfigSchema,
  }),
  /** unicast to the caster after an accepted vote — authoritative own votes */
  z.object({
    type: z.literal("vote.progress"),
    yourVotes: z.record(z.string(), z.number()),
  }),
  z.object({
    type: z.literal("vote.meter"),
    seq: z.number(),
    votersDone: z.number(),
    votersTotal: z.number(),
  }),
  z.object({
    type: z.literal("votes.revealed"),
    seq: z.number(),
    tallies: z.record(z.string(), z.number()),
    topTargetIds: z.array(z.string()),
  }),
  z.object({
    type: z.literal("discuss.focus"),
    seq: z.number(),
    targetId: hexIdSchema.nullable(),
  }),
  z.object({
    type: z.literal("action.created"),
    seq: z.number(),
    action: actionSchema,
  }),
  z.object({
    type: z.literal("action.updated"),
    seq: z.number(),
    action: actionSchema,
  }),
  z.object({
    type: z.literal("action.deleted"),
    seq: z.number(),
    actionId: hexIdSchema,
  }),
  z.object({
    type: z.literal("roster.updated"),
    seq: z.number(),
    participant: participantSchema,
  }),

  z.object({
    type: z.literal("column.created"),
    seq: z.number(),
    column: columnSchema,
  }),
  z.object({
    type: z.literal("column.renamed"),
    seq: z.number(),
    column: columnSchema,
  }),
  // Facilitator-only view of a hide/reveal (carries the new hidden flag);
  // members instead receive column.deleted (hide) or column.created (reveal).
  z.object({
    type: z.literal("column.updated"),
    seq: z.number(),
    column: columnSchema,
  }),
  z.object({
    type: z.literal("column.deleted"),
    seq: z.number(),
    columnId: hexIdSchema,
  }),

  z.object({
    type: z.literal("kudo.created"),
    seq: z.number(),
    kudo: kudoSchema,
  }),
  z.object({
    type: z.literal("kudo.deleted"),
    seq: z.number(),
    kudoId: hexIdSchema,
  }),
  z.object({
    type: z.literal("retention.changed"),
    seq: z.number(),
    retentionAt: z.number().nullable(),
  }),
  z.object({
    type: z.literal("checkin.shuffled"),
    seq: z.number(),
    icebreakerId: icebreakerIdSchema,
  }),
  z.object({
    type: z.literal("agreements.changed"),
    seq: z.number(),
    text: z.string(),
  }),
  // Anonymous ROTI aggregate broadcast to everyone; individual scores never
  // leave the server (the caster learns only their own via roti.you). average
  // is null until the response count clears the anonymity threshold.
  z.object({
    type: z.literal("roti.aggregate"),
    seq: z.number(),
    count: z.number(),
    average: z.number().nullable(),
  }),
  z.object({ type: z.literal("roti.you"), yourScore: rotiScoreSchema }),
  // The board was deleted (retention expiry or admin delete-now) — the client
  // shows a closing screen; the DO is about to be garbage-collected.
  z.object({ type: z.literal("board.deleted") }),

  z.object({
    type: z.literal("error"),
    code: z.enum(["BAD_MESSAGE", "NOT_JOINED", "BOARD_NOT_FOUND"]),
    message: z.string(),
  }),
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;

export function parseClientCommand(raw: unknown): ClientCommand | null {
  if (typeof raw !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = clientCommandSchema.safeParse(json);
  return result.success ? result.data : null;
}

export function parseServerEvent(raw: unknown): ServerEvent | null {
  if (typeof raw !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = serverEventSchema.safeParse(json);
  return result.success ? result.data : null;
}
