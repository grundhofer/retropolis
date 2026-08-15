// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  CURSORS_ACTIVATABLE,
  EXPORT_FORMATS,
  layoutModes,
  pickerStyles,
  type LayoutMode,
  type PickerStyle,
} from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";
import { duplicateBoard } from "../lib/api.js";
import { loadAdminToken, saveAdminToken } from "../lib/session.js";

// Export (anyone) + admin board settings: GIF toggle, picker skin, duplicate,
// keep, delete-now. Lives in the board header.
export function BoardMenu({
  boardId,
  boardName,
  isAdmin,
  gifsEnabled,
  cursorsEnabled,
  pickerStyle,
  layout,
  retentionAt,
}: {
  boardId: string;
  boardName: string;
  isAdmin: boolean;
  gifsEnabled: boolean;
  cursorsEnabled: boolean;
  pickerStyle: PickerStyle;
  layout: LayoutMode;
  retentionAt: number | null;
}) {
  const { t } = useTranslation();
  const { send } = useConnection();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [includeAuthors, setIncludeAuthors] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  async function duplicate() {
    if (duplicating) return;
    const token = loadAdminToken(boardId);
    if (token === null) return;
    setDuplicating(true);
    try {
      const created = await duplicateBoard(
        boardId,
        t("menu.duplicateName", { name: boardName }),
        token,
      );
      saveAdminToken(created.boardId, created.adminToken);
      void navigate(`/board/${created.boardId}`);
    } catch {
      setDuplicating(false); // stay put; the menu remains usable to retry
    }
  }

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
              {/* Live cursors are built but activation is disabled for now
                  (they would bill the free tier); flip CURSORS_ACTIVATABLE to
                  bring this toggle back. */}
              {CURSORS_ACTIVATABLE ? (
                <label className="mb-2 flex items-center gap-1.5 text-zinc-600">
                  <input
                    type="checkbox"
                    checked={cursorsEnabled}
                    data-testid="cursors-toggle"
                    onChange={(event) =>
                      send({
                        type: "admin.cursors.set",
                        enabled: event.target.checked,
                      })
                    }
                    className="accent-accent"
                  />
                  {t("menu.cursorsEnabled")}
                </label>
              ) : null}
              <div className="mb-2">
                <p className="mb-1 text-zinc-600">{t("menu.layout")}</p>
                <div className="flex gap-1.5" role="group">
                  {layoutModes.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      data-testid={`layout-${mode}`}
                      aria-pressed={layout === mode}
                      onClick={() =>
                        send({ type: "admin.layout.set", layout: mode })
                      }
                      className={`flex-1 rounded-lg border px-2 py-1 font-medium ${
                        layout === mode
                          ? "border-accent bg-accent/10 text-accent-strong"
                          : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      {t(`menu.layoutMode.${mode}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-2">
                <p className="mb-1 text-zinc-600">{t("menu.pickerStyle")}</p>
                <div className="flex gap-1.5" role="group">
                  {pickerStyles.map((style) => (
                    <button
                      key={style}
                      type="button"
                      data-testid={`picker-style-${style}`}
                      aria-pressed={pickerStyle === style}
                      onClick={() =>
                        send({ type: "admin.picker.style", style })
                      }
                      className={`flex-1 rounded-lg border px-2 py-1 font-medium ${
                        pickerStyle === style
                          ? "border-accent bg-accent/10 text-accent-strong"
                          : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                      }`}
                    >
                      {t(`menu.picker.${style}`)}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                data-testid="duplicate-board"
                onClick={() => void duplicate()}
                disabled={duplicating}
                className="mb-2 w-full rounded-lg border border-zinc-200 px-3 py-1 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                {t("menu.duplicate")}
              </button>
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
