import type { Note } from "../protocol.js";
import { phaseRevealed, type Phase } from "./phases.js";

// THE privacy rule of the product: before reveal, a note exists on the wire
// only for its author. Everything the server sends — live events AND the
// join/reconnect snapshot — must pass through this filter.
//
// hiddenColumnIds gates a SECOND, orthogonal privacy dimension: a note in a
// facilitator-hidden column is invisible to the viewer regardless of phase or
// authorship. Pass null when the viewer sees every column (a facilitator, or
// callers with no hidden columns) — a hidden column composes with the reveal
// rule by AND (stricter), never OR.
export function noteVisibleTo(
  note: Pick<Note, "authorId" | "columnId">,
  viewerId: string,
  phase: Phase,
  hiddenColumnIds: ReadonlySet<string> | null = null,
): boolean {
  if (hiddenColumnIds !== null && hiddenColumnIds.has(note.columnId)) {
    return false;
  }
  if (phaseRevealed(phase)) return true;
  return note.authorId === viewerId;
}

// On anonymous boards, authorship is stripped for everyone but the author
// (who needs it to know the note is editable). Applies in every phase.
export function redactNoteForViewer(
  note: Note,
  viewerId: string,
  anonymous: boolean,
): Note {
  if (!anonymous || note.authorId === viewerId) return note;
  return { ...note, authorId: null };
}

export function visibleNotesFor(
  notes: readonly Note[],
  viewerId: string,
  phase: Phase,
  anonymous: boolean,
  hiddenColumnIds: ReadonlySet<string> | null = null,
): Note[] {
  return notes
    .filter((note) => noteVisibleTo(note, viewerId, phase, hiddenColumnIds))
    .map((note) => redactNoteForViewer(note, viewerId, anonymous));
}
