import { z } from "zod";
import { hexIdSchema } from "./ids.js";
import { phasePlanSchema, phaseSchema } from "./domain/phases.js";
import { pickerStateSchema, wheelSpinSchema } from "./domain/picker.js";
import { sessionKeySchema } from "./session-key.js";

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

export const boardConfigSchema = z.object({
  anonymous: z.boolean(),
  phasePlan: phasePlanSchema,
  /** dot-voting budget per person (blind voting, product spec §6) */
  votesPerPerson: z.number().int().min(1).max(10),
  /** optional cap per card/stack; null = only the personal budget limits */
  maxPerTarget: z.number().int().min(1).max(10).nullable(),
  /** how many top-voted cards get crowned for discussion */
  topN: z.number().int().min(1).max(10),
});
export type BoardConfig = z.infer<typeof boardConfigSchema>;

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
});
export type Column = z.infer<typeof columnSchema>;

export const noteSchema = z.object({
  id: hexIdSchema,
  columnId: hexIdSchema,
  // null = anonymized for this viewer (anonymous boards). Own notes always
  // carry the viewer's id so the client knows they are editable.
  authorId: z.string().nullable(),
  text: z.string(),
  order: z.number(),
  // notes sharing a groupId form a stack (merged duplicates)
  groupId: hexIdSchema.nullable(),
  // emoji -> participant ids
  reactions: z.record(z.string(), z.array(z.string())),
});
export type Note = z.infer<typeof noteSchema>;

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
  }),
  z.object({
    type: z.literal("note.update"),
    opId: hexIdSchema,
    noteId: hexIdSchema,
    text: noteTextSchema,
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
  z.object({
    type: z.literal("column.deleted"),
    seq: z.number(),
    columnId: hexIdSchema,
  }),

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
