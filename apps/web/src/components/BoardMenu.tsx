import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EXPORT_FORMATS } from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";

// Export (anyone) + admin board settings: GIF toggle, keep, delete-now. Lives
// in the board header.
export function BoardMenu({
  boardId,
  isAdmin,
  gifsEnabled,
  retentionAt,
}: {
  boardId: string;
  isAdmin: boolean;
  gifsEnabled: boolean;
  retentionAt: number | null;
}) {
  const { t } = useTranslation();
  const { send } = useConnection();
  const [open, setOpen] = useState(false);
  const [includeAuthors, setIncludeAuthors] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function exportHref(format: string): string {
    const params = new URLSearchParams({ format });
    if (includeAuthors) params.set("authors", "true");
    return `/api/boards/${boardId}/export?${params.toString()}`;
  }

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
          setConfirmingDelete(false);
        }
      }}
    >
      <button
        type="button"
        data-testid="board-menu"
        onClick={() => setOpen(!open)}
        className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent"
      >
        ⋯
      </button>
      {open ? (
        <div className="absolute top-9 right-0 z-40 flex w-64 flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-lg">
          <div>
            <p className="mb-1.5 font-semibold tracking-wide text-zinc-500 uppercase">
              {t("menu.export")}
            </p>
            <label className="mb-2 flex items-center gap-1.5 text-zinc-600">
              <input
                type="checkbox"
                checked={includeAuthors}
                onChange={(event) => setIncludeAuthors(event.target.checked)}
                className="accent-accent"
              />
              {t("menu.includeAuthors")}
            </label>
            <div className="flex gap-2">
              {EXPORT_FORMATS.map((format) => (
                <a
                  key={format}
                  href={exportHref(format)}
                  download
                  data-testid={`export-${format}`}
                  className="rounded-lg border border-zinc-200 px-3 py-1 font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  {format.toUpperCase()}
                </a>
              ))}
            </div>
          </div>

          {isAdmin ? (
            <div className="border-t border-zinc-100 pt-3">
              <p className="mb-1.5 font-semibold tracking-wide text-zinc-500 uppercase">
                {t("menu.settings")}
              </p>
              <label className="mb-2 flex items-center gap-1.5 text-zinc-600">
                <input
                  type="checkbox"
                  checked={gifsEnabled}
                  data-testid="gifs-toggle"
                  onChange={(event) =>
                    send({
                      type: "admin.gifs.set",
                      enabled: event.target.checked,
                    })
                  }
                  className="accent-accent"
                />
                {t("menu.gifsEnabled")}
              </label>
              <p className="mb-2 text-xs text-zinc-400">
                {retentionAt === null
                  ? t("menu.retentionKept")
                  : t("menu.retentionNotice", {
                      date: formatDate(retentionAt),
                    })}
              </p>
              <div className="flex gap-2">
                {retentionAt !== null ? (
                  <button
                    type="button"
                    onClick={() => send({ type: "admin.board.keep" })}
                    className="rounded-lg border border-zinc-200 px-3 py-1 text-zinc-700 hover:bg-zinc-50"
                  >
                    {t("menu.keep")}
                  </button>
                ) : null}
                {confirmingDelete ? (
                  <button
                    type="button"
                    data-testid="delete-board-confirm"
                    onClick={() => send({ type: "admin.board.delete" })}
                    className="rounded-lg bg-red-700 px-3 py-1 font-medium text-white"
                  >
                    {t("menu.reallyDelete")}
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="delete-board"
                    onClick={() => setConfirmingDelete(true)}
                    className="rounded-lg border border-red-200 px-3 py-1 text-red-700 hover:bg-red-50"
                  >
                    {t("menu.deleteNow")}
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}
