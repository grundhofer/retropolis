import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  generateHexId,
  phaseRevealed,
  type Column,
  type Note,
  type Participant,
  type Phase,
  type ServerEvent,
} from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";
import { NOTE_DRAG_MIME, NoteCard } from "./NoteCard.js";

export interface DecidingState {
  voteActive: boolean;
  /** your own votes (blind voting — nobody else's ever reach the client) */
  mine: Record<string, number>;
  remaining: number;
  maxPerTarget: number | null;
  /** tallies/crowns are shown from the discussion phase on */
  talliesShown: boolean;
  tallies: Record<string, number> | null;
  topTargetIds: string[];
  focusId: string | null;
}

export interface BoardColumnsProps {
  columns: Column[];
  notes: Note[];
  roster: Participant[];
  you: Participant;
  phase: Phase;
  editing: Record<string, string>;
  isAdmin: boolean;
  presenterId: string | null;
  deciding: DecidingState;
}

type ColumnItem =
  | { kind: "note"; note: Note }
  | { kind: "stack"; groupId: string; notes: Note[] };

export function BoardColumns(props: BoardColumnsProps) {
  const { columns, notes, phase, isAdmin, deciding } = props;
  const { t } = useTranslation();
  const { mutate } = useConnection();

  function castVote(targetId: string, delta: 1 | -1) {
    const current = deciding.mine[targetId] ?? 0;
    const next = current + delta;
    if (next < 0) return;
    const yourVotes = { ...deciding.mine };
    if (next === 0) delete yourVotes[targetId];
    else yourVotes[targetId] = next;
    mutate(
      { type: "vote.cast", opId: generateHexId(), targetId, delta },
      { type: "vote.progress", yourVotes },
    );
  }
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");

  // Curation callbacks live here — building optimistic echoes needs the full
  // note list, which the cards themselves don't have.
  function groupNotes(sourceNoteId: string, target: Note) {
    const source = notes.find((n) => n.id === sourceNoteId);
    if (!source || source.id === target.id) return;
    const groupId = target.groupId ?? target.id; // deterministic, matches the server
    if (source.groupId === groupId) return;
    const events: ServerEvent[] = [];
    if (target.groupId === null) {
      events.push({
        type: "note.updated",
        seq: 0,
        note: { ...target, groupId },
      });
    }
    events.push({
      type: "note.updated",
      seq: 0,
      note: { ...source, groupId, columnId: target.columnId },
    });
    mutate(
      {
        type: "note.group",
        opId: generateHexId(),
        noteId: source.id,
        targetNoteId: target.id,
      },
      events,
    );
  }

  function ungroupNote(note: Note) {
    mutate(
      { type: "note.ungroup", opId: generateHexId(), noteId: note.id },
      { type: "note.updated", seq: 0, note: { ...note, groupId: null } },
    );
  }

  function moveNote(sourceNoteId: string, columnId: string) {
    const source = notes.find((n) => n.id === sourceNoteId);
    if (!source) return;
    if (source.columnId === columnId && source.groupId === null) return;
    mutate(
      { type: "note.move", opId: generateHexId(), noteId: source.id, columnId },
      {
        type: "note.updated",
        seq: 0,
        note: { ...source, columnId, groupId: null },
      },
    );
  }

  function addColumn(event: React.FormEvent) {
    event.preventDefault();
    const name = newColumnName.trim();
    if (name === "") return;
    const columnId = generateHexId();
    const order = (columns[columns.length - 1]?.order ?? -1) + 1;
    mutate(
      { type: "admin.column.create", opId: generateHexId(), columnId, name },
      { type: "column.created", seq: 0, column: { id: columnId, name, order } },
    );
    setNewColumnName("");
    setAddingColumn(false);
  }

  // Reorganizing is frozen once voting starts (stacks are votables).
  const allowColumnDrop = phase === "write" || phase === "present";

  return (
    <div className="flex items-start gap-4 overflow-x-auto pb-4">
      {columns.map((column) => (
        <BoardColumn
          key={column.id}
          column={column}
          {...props}
          onDropNote={groupNotes}
          onUngroup={ungroupNote}
          onMoveToColumn={allowColumnDrop ? moveNote : null}
          onVote={castVote}
        />
      ))}
      {isAdmin ? (
        <div className="w-64 shrink-0">
          {addingColumn ? (
            <form onSubmit={addColumn} className="flex flex-col gap-2">
              <input
                autoFocus
                value={newColumnName}
                onChange={(event) => setNewColumnName(event.target.value)}
                maxLength={60}
                placeholder={t("column.namePlaceholder")}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-accent"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong"
                >
                  {t("column.add")}
                </button>
                <button
                  type="button"
                  onClick={() => setAddingColumn(false)}
                  className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
                >
                  {t("note.cancel")}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingColumn(true)}
              className="w-full rounded-xl border-2 border-dashed border-zinc-200 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-300 hover:text-zinc-500 focus-visible:outline-2 focus-visible:outline-accent"
            >
              + {t("column.addColumn")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BoardColumn({
  column,
  notes,
  roster,
  you,
  phase,
  editing,
  isAdmin,
  presenterId,
  deciding,
  onDropNote,
  onUngroup,
  onMoveToColumn,
  onVote,
}: BoardColumnsProps & {
  column: Column;
  onDropNote: (sourceNoteId: string, target: Note) => void;
  onUngroup: (note: Note) => void;
  onMoveToColumn: ((sourceNoteId: string, columnId: string) => void) | null;
  onVote: (targetId: string, delta: 1 | -1) => void;
}) {
  const { t } = useTranslation();
  const { mutate } = useConnection();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(column.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // order is per-author (pre-reveal privacy: a global counter would leak the
  // hidden note count), so ties across authors are broken by id for stability.
  const columnNotes = notes
    .filter((note) => note.columnId === column.id)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  // Stacks: notes sharing a groupId render together, at the position of the
  // stack's first note.
  // Stacks only render in revealed phases: after a rewind your own grouped
  // notes would otherwise show as unbreakable ×1 stacks (partners hidden).
  const stacksVisible = phaseRevealed(phase);
  const items: ColumnItem[] = [];
  const seenGroups = new Set<string>();
  for (const note of columnNotes) {
    if (note.groupId === null || !stacksVisible) {
      items.push({ kind: "note", note });
    } else if (!seenGroups.has(note.groupId)) {
      seenGroups.add(note.groupId);
      items.push({
        kind: "stack",
        groupId: note.groupId,
        notes: columnNotes.filter((n) => n.groupId === note.groupId),
      });
    }
  }

  // Ghost cards: colleagues writing in this column right now — activity
  // without content (write phase only; from present on the notes are visible).
  const ghosts =
    phase === "write"
      ? Object.entries(editing)
          .filter(
            ([participantId, columnId]) =>
              columnId === column.id && participantId !== you.id,
          )
          .map(([participantId]) => roster.find((p) => p.id === participantId))
          .filter((p): p is Participant => p !== undefined)
      : [];

  function submitRename(event: React.FormEvent) {
    event.preventDefault();
    const name = renameValue.trim();
    if (name === "" || name === column.name) {
      setRenaming(false);
      return;
    }
    mutate(
      {
        type: "admin.column.rename",
        opId: generateHexId(),
        columnId: column.id,
        name,
      },
      { type: "column.renamed", seq: 0, column: { ...column, name } },
    );
    setRenaming(false);
  }

  function deleteColumn() {
    mutate(
      {
        type: "admin.column.delete",
        opId: generateHexId(),
        columnId: column.id,
      },
      { type: "column.deleted", seq: 0, columnId: column.id },
    );
  }

  const cardProps = {
    roster,
    you,
    phase,
    isAdmin,
    presenterId,
    onDropNote,
    onUngroup,
  };

  return (
    <section
      className="w-72 shrink-0"
      aria-label={column.name}
      onDragOver={(event) => {
        if (
          onMoveToColumn !== null &&
          event.dataTransfer.types.includes(NOTE_DRAG_MIME)
        ) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (onMoveToColumn === null) return;
        const sourceId = event.dataTransfer.getData(NOTE_DRAG_MIME);
        if (sourceId === "") return;
        event.preventDefault();
        onMoveToColumn(sourceId, column.id);
      }}
    >
      <header className="mb-2 flex items-center gap-1.5">
        {renaming ? (
          <form onSubmit={submitRename} className="flex-1">
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onBlur={submitRename}
              maxLength={60}
              className="w-full rounded border border-zinc-300 px-2 py-0.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-accent"
            />
          </form>
        ) : (
          <h2 className="flex-1 truncate text-sm font-semibold tracking-wide text-zinc-600 uppercase">
            {column.name}
            <span className="ml-1.5 font-normal text-zinc-400 tabular-nums">
              {columnNotes.length}
            </span>
          </h2>
        )}
        {isAdmin && !renaming ? (
          <>
            <button
              type="button"
              aria-label={t("column.rename")}
              onClick={() => {
                setRenameValue(column.name);
                setRenaming(true);
              }}
              className="rounded px-1 text-sm text-zinc-400 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent"
            >
              ✎
            </button>
            {confirmingDelete ? (
              <button
                type="button"
                onClick={deleteColumn}
                onBlur={() => setConfirmingDelete(false)}
                className="rounded bg-red-700 px-2 py-0.5 text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-red-700"
              >
                {t("column.reallyDelete")}
              </button>
            ) : (
              <button
                type="button"
                aria-label={t("column.delete")}
                onClick={() => setConfirmingDelete(true)}
                className="rounded px-1 text-sm text-zinc-400 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent"
              >
                🗑
              </button>
            )}
          </>
        ) : null}
      </header>

      <div className="flex flex-col gap-2">
        {items.map((item, index) => {
          const targetId = item.kind === "note" ? item.note.id : item.groupId;
          return (
            <TargetFrame
              key={targetId}
              targetId={targetId}
              deciding={deciding}
              onVote={onVote}
            >
              {item.kind === "note" ? (
                <NoteCard note={item.note} revealIndex={index} {...cardProps} />
              ) : (
                <div
                  data-testid="note-stack"
                  className="flex flex-col gap-1.5 rounded-2xl border border-accent/30 bg-accent/5 p-1.5"
                >
                  <span className="px-1.5 text-xs font-semibold text-accent-strong tabular-nums">
                    ×{item.notes.length}
                  </span>
                  {item.notes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      revealIndex={index}
                      {...cardProps}
                    />
                  ))}
                </div>
              )}
            </TargetFrame>
          );
        })}
        {ghosts.map((ghost) => (
          <div
            key={ghost.id}
            data-testid="ghost-card"
            className="rounded-xl border border-dashed border-zinc-200 bg-white/60 p-3"
          >
            <div className="flex items-center gap-2">
              <span
                className="size-2.5 animate-pulse rounded-full"
                style={{ backgroundColor: ghost.color }}
              />
              <span className="text-xs text-zinc-400">
                {t("note.ghostWriting", { name: ghost.name })}
              </span>
            </div>
            <div className="mt-2 space-y-1.5">
              <div className="h-2 w-4/5 animate-pulse rounded bg-zinc-100" />
              <div className="h-2 w-3/5 animate-pulse rounded bg-zinc-100" />
            </div>
          </div>
        ))}
        {phaseAllowsComposer(phase) ? (
          <NoteComposer columnId={column.id} you={you} notes={columnNotes} />
        ) : null}
      </div>
    </section>
  );
}

// Chrome around each votable (ungrouped note or stack): the blind vote
// control during voting, crown/tally/focus once discussion opened.
function TargetFrame({
  targetId,
  deciding,
  onVote,
  children,
}: {
  targetId: string;
  deciding: DecidingState;
  onVote: (targetId: string, delta: 1 | -1) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const rank = deciding.topTargetIds.indexOf(targetId);
  const focused = deciding.focusId === targetId;
  const dim = deciding.focusId !== null && !focused;
  const myCount = deciding.mine[targetId] ?? 0;
  const tally = deciding.talliesShown
    ? deciding.tallies?.[targetId]
    : undefined;
  const plusDisabled =
    deciding.remaining <= 0 ||
    (deciding.maxPerTarget !== null && myCount >= deciding.maxPerTarget);

  return (
    <div
      data-testid="vote-target"
      className={`rounded-2xl transition-opacity ${
        focused ? "ring-2 ring-accent ring-offset-2" : ""
      } ${dim ? "opacity-40" : ""}`}
    >
      {deciding.talliesShown && (rank >= 0 || tally !== undefined) ? (
        <div className="mb-1 flex items-center gap-1.5 px-1">
          {rank >= 0 ? (
            <span
              data-testid="crown"
              className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
            >
              👑 {rank + 1}
            </span>
          ) : null}
          {tally !== undefined ? (
            <span
              data-testid="tally"
              className="text-xs text-zinc-500 tabular-nums"
            >
              {tally} ●
            </span>
          ) : null}
        </div>
      ) : null}
      {children}
      {deciding.voteActive ? (
        <div
          data-testid="vote-control"
          className="mt-1 flex items-center justify-end gap-1.5"
        >
          <button
            type="button"
            data-testid="vote-minus"
            aria-label={t("vote.minus")}
            disabled={myCount === 0}
            onClick={() => onVote(targetId, -1)}
            className="size-6 rounded-full border border-zinc-200 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-30"
          >
            −
          </button>
          <span
            data-testid="vote-count"
            className={`min-w-5 text-center text-sm font-semibold tabular-nums ${
              myCount > 0 ? "text-accent-strong" : "text-zinc-300"
            }`}
          >
            {myCount}
          </span>
          <button
            type="button"
            data-testid="vote-plus"
            aria-label={t("vote.plus")}
            disabled={plusDisabled}
            onClick={() => onVote(targetId, 1)}
            className="size-6 rounded-full bg-accent text-sm text-white hover:bg-accent-strong disabled:opacity-30"
          >
            +
          </button>
        </div>
      ) : null}
    </div>
  );
}

function phaseAllowsComposer(phase: Phase): boolean {
  return phase === "write" || phase === "present";
}

function NoteComposer({
  columnId,
  you,
  notes,
}: {
  columnId: string;
  you: Participant;
  notes: Note[];
}) {
  const { t } = useTranslation();
  const { send, mutate } = useConnection();
  const [text, setText] = useState("");

  function submit() {
    const trimmed = text.trim();
    if (trimmed === "") return;
    const noteId = generateHexId();
    // Matches the server's per-author ordering rule.
    const own = notes.filter((note) => note.authorId === you.id);
    const order = Math.max(0, ...own.map((note) => note.order)) + 1;
    mutate(
      {
        type: "note.create",
        opId: generateHexId(),
        noteId,
        columnId,
        text: trimmed,
      },
      {
        type: "note.created",
        seq: 0,
        note: {
          id: noteId,
          columnId,
          authorId: you.id,
          text: trimmed,
          order,
          groupId: null,
          reactions: {},
        },
      },
    );
    setText("");
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        value={text}
        data-testid={`composer-${columnId}`}
        onChange={(event) => setText(event.target.value)}
        onFocus={() => send({ type: "presence.editing", columnId })}
        onBlur={() => send({ type: "presence.editing", columnId: null })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        maxLength={500}
        rows={2}
        placeholder={t("note.placeholder")}
        className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-zinc-300 focus-visible:outline-2 focus-visible:outline-accent"
      />
      {text.trim() !== "" ? (
        <button
          type="submit"
          className="mt-1 rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t("note.add")}
        </button>
      ) : null}
    </form>
  );
}
