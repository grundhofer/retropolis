import type { Note } from "../protocol.js";
import { phaseRevealed, type Phase } from "./phases.js";

// THE privacy rule of the product: before reveal, a note exists on the wire
// only for its author. Everything the server sends — live events AND the
// join/reconnect snapshot — must pass through this filter.
export function noteVisibleTo(
  note: Pick<Note, "authorId">,
  viewerId: string,
  phase: Phase,
): boolean {
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
): Note[] {
  return notes
    .filter((note) => noteVisibleTo(note, viewerId, phase))
    .map((note) => redactNoteForViewer(note, viewerId, anonymous));
}
