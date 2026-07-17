import { z } from "zod";
import { hexIdSchema } from "./ids.js";
import { phasePlanSchema, phaseSchema } from "./domain/phases.js";
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
});
export type BoardConfig = z.infer<typeof boardConfigSchema>;

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
