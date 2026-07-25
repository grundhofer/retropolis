import { describe, expect, it } from "vitest";
import {
  noteVisibleTo,
  redactNoteForViewer,
  visibleNotesFor,
} from "../src/domain/notes.js";
import type { Note } from "../src/protocol.js";

const annaNote: Note = {
  id: "a".repeat(32),
  columnId: "c".repeat(32),
  authorId: "anna",
  text: "Anna's secret draft",
  order: 1,
  gifUrl: null,
  x: null,
  y: null,
  groupId: null,
  reactions: {},
};
const benNote: Note = {
  ...annaNote,
  id: "b".repeat(32),
  authorId: "ben",
  text: "Ben's note",
};

describe("noteVisibleTo", () => {
  it("write phase: only the author sees their note", () => {
    expect(noteVisibleTo(annaNote, "anna", "write")).toBe(true);
    expect(noteVisibleTo(annaNote, "ben", "write")).toBe(false);
    expect(noteVisibleTo(annaNote, "ben", "lobby")).toBe(false);
  });

  it("from present on, everyone sees everything", () => {
    expect(noteVisibleTo(annaNote, "ben", "present")).toBe(true);
    expect(noteVisibleTo(annaNote, "ben", "discuss")).toBe(true);
  });
});

describe("redactNoteForViewer", () => {
  it("anonymous boards strip authorship for others but never for the author", () => {
    expect(redactNoteForViewer(annaNote, "ben", true).authorId).toBeNull();
    expect(redactNoteForViewer(annaNote, "anna", true).authorId).toBe("anna");
    expect(redactNoteForViewer(annaNote, "ben", false).authorId).toBe("anna");
  });
});

describe("visibleNotesFor", () => {
  const all = [annaNote, benNote];

  it("write phase snapshot contains only own notes", () => {
    expect(visibleNotesFor(all, "ben", "write", false)).toEqual([benNote]);
  });

  it("present phase snapshot contains everything", () => {
    expect(visibleNotesFor(all, "ben", "present", false)).toHaveLength(2);
  });

  it("anonymous present phase redacts foreign authors only", () => {
    const notes = visibleNotesFor(all, "ben", "present", true);
    expect(notes.find((n) => n.id === annaNote.id)?.authorId).toBeNull();
    expect(notes.find((n) => n.id === benNote.id)?.authorId).toBe("ben");
  });
});
