// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";
import type { Participant } from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";

export interface ReadyBarProps {
  readyIds: string[];
  roster: Participant[];
  youId: string | null;
}

export function ReadyBar({ readyIds, roster, youId }: ReadyBarProps) {
  const { t } = useTranslation();
  const { send } = useConnection();
  const online = roster.filter((p) => p.online);
  const youReady = youId !== null && readyIds.includes(youId);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        data-testid="ready-toggle"
        aria-pressed={youReady}
        onClick={() => send({ type: "ready.set", ready: !youReady })}
        className={`rounded-lg px-3 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          youReady
            ? "bg-accent/10 text-accent-strong"
            : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
        }`}
      >
        {youReady ? `✓ ${t("ready.done")}` : t("ready.imDone")}
      </button>
      <span
        data-testid="ready-count"
        className="text-sm text-zinc-500 tabular-nums"
      >
        {t("ready.count", { ready: readyIds.length, total: online.length })}
      </span>
    </div>
  );
}
