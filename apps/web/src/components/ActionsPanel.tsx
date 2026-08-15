// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  actionTextSchema,
  generateHexId,
  type Action,
  type Participant,
} from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";

export interface ActionsPanelProps {
  actions: Action[];
  roster: Participant[];
  you: Participant;
  readOnly: boolean;
}

// Action items: the retro's lasting output. First-class objects, not notes —
// captured while discussing, each with an owner.
export function ActionsPanel({
  actions,
  roster,
  you,
  readOnly,
}: ActionsPanelProps) {
  const { t } = useTranslation();
  const { mutate } = useConnection();
  const [text, setText] = useState("");
  const [ownerId, setOwnerId] = useState<string>(you.id);

  function add(event: React.FormEvent) {
    event.preventDefault();
    const parsed = actionTextSchema.safeParse(text);
    if (!parsed.success) return;
    const actionId = generateHexId();
    const owner = ownerId === "" ? null : ownerId;
    mutate(
      {
        type: "action.create",
        opId: generateHexId(),
        actionId,
        text: parsed.data,
        ownerId: owner,
      },
      {
        type: "action.created",
        seq: 0,
        action: {
          id: actionId,
          text: parsed.data,
          ownerId: owner,
          status: "open",
        },
      },
    );
    setText("");
  }

  function update(
    action: Action,
    patch: Partial<Pick<Action, "ownerId" | "status">>,
  ) {
    mutate(
      {
        type: "action.update",
        opId: generateHexId(),
        actionId: action.id,
        ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      },
      { type: "action.updated", seq: 0, action: { ...action, ...patch } },
    );
  }

  function remove(action: Action) {
    mutate(
      { type: "action.delete", opId: generateHexId(), actionId: action.id },
      { type: "action.deleted", seq: 0, actionId: action.id },
    );
  }

  return (
    <aside
      data-testid="actions-panel"
      className="w-80 shrink-0 rounded-xl border border-zinc-200 bg-white p-4"
      aria-label={t("action.title")}
    >
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-zinc-600 uppercase">
        ✅ {t("action.title")}
      </h2>

      {!readOnly ? (
        <form onSubmit={add} className="mb-4 flex flex-col gap-2">
          <input
            value={text}
            data-testid="action-input"
            onChange={(event) => setText(event.target.value)}
            maxLength={300}
            placeholder={t("action.placeholder")}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm placeholder:text-zinc-300 focus-visible:outline-2 focus-visible:outline-accent"
          />
          <div className="flex gap-2">
            <select
              value={ownerId}
              data-testid="action-owner"
              onChange={(event) => setOwnerId(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-sm text-zinc-600"
            >
              <option value="">{t("action.unassigned")}</option>
              {roster.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={text.trim() === ""}
              className="rounded-lg bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-40"
            >
              {t("action.add")}
            </button>
          </div>
        </form>
      ) : null}

      <ul className="flex flex-col gap-2">
        {actions.map((action) => {
          const owner =
            action.ownerId === null
              ? null
              : roster.find((p) => p.id === action.ownerId);
          return (
            <li
              key={action.id}
              data-testid="action-item"
              className="flex items-start gap-2 rounded-lg border border-zinc-100 p-2"
            >
              <input
                type="checkbox"
                checked={action.status === "done"}
                disabled={readOnly}
                onChange={() =>
                  update(action, {
                    status: action.status === "done" ? "open" : "done",
                  })
                }
                aria-label={t("action.toggle")}
                className="mt-0.5 accent-accent"
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-sm break-words ${
                    action.status === "done"
                      ? "text-zinc-400 line-through"
                      : "text-zinc-800"
                  }`}
                >
                  {action.text}
                </span>
                {owner ? (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-zinc-400">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ backgroundColor: owner.color }}
                    />
                    {owner.name}
                  </span>
                ) : null}
              </span>
              {!readOnly ? (
                <button
                  type="button"
                  aria-label={t("action.delete")}
                  onClick={() => remove(action)}
                  className="rounded px-1 text-xs text-zinc-300 hover:bg-zinc-100 hover:text-zinc-500"
                >
                  🗑
                </button>
              ) : null}
            </li>
          );
        })}
        {actions.length === 0 ? (
          <li className="text-sm text-zinc-400">{t("action.empty")}</li>
        ) : null}
      </ul>
    </aside>
  );
}
