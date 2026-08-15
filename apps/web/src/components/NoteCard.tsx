// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  generateHexId,
  phaseRevealed,
  REACTION_EMOJI,
  type Note,
  type Participant,
  type Phase,
} from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";

const NOTE_DRAG_MIME = "application/x-retropolis-note";

export interface NoteCardProps {
  note: Note;
  roster: Participant[];
  you: Participant;
  phase: Phase;
  isAdmin: boolean;
  revealIndex: number;
  /** current presenter — their notes are spotlighted, others dimmed */
  presenterId: string | null;
  onDropNote: (sourceNoteId: string, target: Note) => void;
  onUngroup: (note: Note) => void;
  /** read-only rendering (the presenter reader): drag/edit/delete/curate off,
   *  reactions kept. Default true. */
  interactive?: boolean;
  /** HTML5 drag affordance; the canvas turns this off and drags a wrapper via
   *  pointer events instead, while keeping edit/delete. Default true. */
  draggable?: boolean;
}

export function NoteCard({
  note,
  roster,
  you,
  phase,
  isAdmin,
  revealIndex,
  presenterId,
  onDropNote,
  onUngroup,
  interactive = true,
  draggable = true,
}: NoteCardProps) {
  const { t } = useTranslation();
  const { mutate } = useConnection();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const [dropHover, setDropHover] = useState(false);

  const mine = note.authorId === you.id;
  const author =
    note.authorId === null ? null : roster.find((p) => p.id === note.authorId);
  const revealed = phaseRevealed(phase) && phase !== "done";
  const canEdit = interactive && mine && (phase === "write" || phase === "present");
  const canDelete = interactive && (mine || isAdmin) && phase !== "done";
  // Reorganizing (drag to group/move, unstack) happens in write (own notes)
  // and present (everyone) — frozen once voting starts, stacks are votables.
  const canCurate = interactive && phase === "present";
  // The canvas positions cards via a pointer-drag wrapper, so it turns off the
  // card's own HTML5 drag while keeping edit/delete.
  const canDrag =
    interactive && draggable && (canCurate || (phase === "write" && mine));
  const spotlighted = presenterId !== null && note.authorId === presenterId;
  const dimmed = presenterId !== null && note.authorId !== presenterId;

  function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || text === note.text) {
      setEditing(false);
      return;
    }
    mutate(
      { type: "note.update", opId: generateHexId(), noteId: note.id, text },
      { type: "note.updated", seq: 0, note: { ...note, text } },
    );
    setEditing(false);
  }

  function remove() {
    mutate(
      { type: "note.delete", opId: generateHexId(), noteId: note.id },
      { type: "note.deleted", seq: 0, noteId: note.id },
    );
  }

  function toggleReaction(emoji: string) {
    const current = note.reactions[emoji] ?? [];
    const on = !current.includes(you.id);
    const reactions = {
      ...note.reactions,
      [emoji]: on
        ? [...current, you.id]
        : current.filter((id) => id !== you.id),
    };
    if (reactions[emoji]?.length === 0) delete reactions[emoji];
    mutate(
      {
        type: "note.react",
        opId: generateHexId(),
        noteId: note.id,
        emoji: emoji as (typeof REACTION_EMOJI)[number],
        on,
      },
      { type: "note.updated", seq: 0, note: { ...note, reactions } },
    );
  }

  return (
    <article
      data-testid="note-card"
      draggable={canDrag && !editing}
      onDragStart={(event) => {
        event.dataTransfer.setData(NOTE_DRAG_MIME, note.id);
        event.dataTransfer.setData("text/plain", note.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event) => {
        if (canCurate && event.dataTransfer.types.includes(NOTE_DRAG_MIME)) {
          event.preventDefault();
          event.stopPropagation();
          setDropHover(true);
        }
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(event) => {
        if (!canCurate) return;
        event.preventDefault();
        event.stopPropagation();
        setDropHover(false);
        const sourceId = event.dataTransfer.getData(NOTE_DRAG_MIME);
        if (sourceId && sourceId !== note.id) onDropNote(sourceId, note);
      }}
      className={`reveal-in rounded-xl border bg-white p-3 shadow-sm transition-opacity ${
        dropHover ? "border-accent ring-2 ring-accent/40" : "border-zinc-200"
      } ${spotlighted ? "ring-2 ring-accent shadow-md" : ""} ${dimmed ? "opacity-45" : ""} ${
        canDrag && !editing ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      style={{ animationDelay: `${Math.min(revealIndex, 12) * 45}ms` }}
    >
      {editing ? (
        <form onSubmit={saveEdit}>
          <textarea
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={500}
            rows={3}
            className="w-full resize-none rounded-lg border border-zinc-200 px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-accent"
          />
          <div className="mt-1 flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-accent px-2.5 py-0.5 text-sm font-medium text-white hover:bg-accent-strong"
            >
              {t("note.save")}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg px-2 py-0.5 text-sm text-zinc-500 hover:bg-zinc-100"
            >
              {t("note.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-sm whitespace-pre-wrap text-zinc-800">
            {note.text}
          </p>
          {note.gifUrl !== null ? (
            <img
              src={note.gifUrl}
              alt=""
              loading="lazy"
              className="mt-2 max-h-40 w-full rounded-lg object-contain"
            />
          ) : null}
          <div className="mt-2 flex items-center gap-1.5">
            {author ? (
              <span className="flex items-center gap-1 text-xs text-zinc-400">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: author.color }}
                />
                {author.name}
              </span>
            ) : null}
            <span className="ml-auto flex gap-0.5">
              {note.groupId !== null && canCurate ? (
                <button
                  type="button"
                  aria-label={t("group.ungroup")}
                  title={t("group.ungroup")}
                  onClick={() => onUngroup(note)}
                  className="rounded px-1 text-xs text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  ⇱
                </button>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  aria-label={t("note.edit")}
                  onClick={() => {
                    setDraft(note.text);
                    setEditing(true);
                  }}
                  className="rounded px-1 text-xs text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  ✎
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  aria-label={t("note.delete")}
                  onClick={remove}
                  className="rounded px-1 text-xs text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  🗑
                </button>
              ) : null}
            </span>
          </div>
          {revealed ? (
            <div className="mt-2 flex gap-1">
              {REACTION_EMOJI.map((emoji) => {
                const reactors = note.reactions[emoji] ?? [];
                const reacted = reactors.includes(you.id);
                if (reactors.length === 0 && !reacted) {
                  return (
                    <button
                      key={emoji}
                      type="button"
                      data-testid={`react-${emoji}`}
                      onClick={() => toggleReaction(emoji)}
                      className="rounded-full px-1.5 py-0.5 text-xs opacity-40 grayscale hover:opacity-100 hover:grayscale-0 focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {emoji}
                    </button>
                  );
                }
                return (
                  <button
                    key={emoji}
                    type="button"
                    data-testid={`react-${emoji}`}
                    aria-pressed={reacted}
                    onClick={() => toggleReaction(emoji)}
                    className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums focus-visible:outline-2 focus-visible:outline-accent ${
                      reacted
                        ? "bg-accent/10 text-accent-strong"
                        : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {emoji} {reactors.length}
                  </button>
                );
              })}
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}

export { NOTE_DRAG_MIME };
