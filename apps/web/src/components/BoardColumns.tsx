import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  generateHexId,
  REACTION_EMOJI,
  type Column,
  type Note,
  type Participant,
  type Phase,
} from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";
import { NoteCard } from "./NoteCard.js";

export interface BoardColumnsProps {
  columns: Column[];
  notes: Note[];
  roster: Participant[];
  you: Participant;
  phase: Phase;
  editing: Record<string, string>;
  isAdmin: boolean;
}

export function BoardColumns(props: BoardColumnsProps) {
  const { columns, isAdmin } = props;
  const { t } = useTranslation();
  const { mutate } = useConnection();
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");

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

  return (
    <div className="flex items-start gap-4 overflow-x-auto pb-4">
      {columns.map((column) => (
        <BoardColumn key={column.id} column={column} {...props} />
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
}: BoardColumnsProps & { column: Column }) {
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

  return (
    <section className="w-72 shrink-0" aria-label={column.name}>
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
        {columnNotes.map((note, index) => (
          <NoteCard
            key={note.id}
            note={note}
            roster={roster}
            you={you}
            phase={phase}
            isAdmin={isAdmin}
            revealIndex={index}
          />
        ))}
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

export { REACTION_EMOJI };
