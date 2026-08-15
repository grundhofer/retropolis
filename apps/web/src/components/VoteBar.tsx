// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BoardConfig } from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";
import { useBoardStore } from "../store/boardStore.js";

// The vote phase strip: your own budget as dots, the anonymous progress
// meter, and the facilitator's voting settings.
export function VoteBar({
  config,
  isAdmin,
}: {
  config: BoardConfig;
  isAdmin: boolean;
}) {
  const { t } = useTranslation();
  const votes = useBoardStore((store) => store.state.votes);
  const used = Object.values(votes.mine).reduce((sum, count) => sum + count, 0);
  const remaining = Math.max(0, config.votesPerPerson - used);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="flex items-center gap-1.5 text-sm text-zinc-600">
        {t("vote.yourVotes")}
        <span
          data-testid="votes-remaining"
          className="flex gap-0.5"
          aria-label={t("vote.remaining", { count: remaining })}
        >
          {Array.from({ length: config.votesPerPerson }, (_, index) => (
            <span
              key={index}
              aria-hidden="true"
              className={`size-2.5 rounded-full ${index < used ? "bg-accent" : "border border-zinc-300"}`}
            />
          ))}
        </span>
      </span>
      <span
        data-testid="vote-meter"
        className="text-sm text-zinc-500 tabular-nums"
      >
        {t("vote.meter", { done: votes.votersDone, total: votes.votersTotal })}
      </span>
      {isAdmin ? <VoteSettings config={config} /> : null}
    </div>
  );
}

function VoteSettings({ config }: { config: BoardConfig }) {
  const { t } = useTranslation();
  const { send } = useConnection();
  const [open, setOpen] = useState(false);
  const [votesPerPerson, setVotesPerPerson] = useState(config.votesPerPerson);
  const [maxPerTarget, setMaxPerTarget] = useState<number | null>(
    config.maxPerTarget,
  );
  const [topN, setTopN] = useState(config.topN);

  function apply() {
    send({ type: "admin.vote.config", votesPerPerson, maxPerTarget, topN });
    setOpen(false);
  }

  function toggle() {
    // Seed the fields from the CURRENT config each time the popover opens, so
    // a concurrent facilitator's change is not clobbered by a stale apply.
    if (!open) {
      setVotesPerPerson(config.votesPerPerson);
      setMaxPerTarget(config.maxPerTarget);
      setTopN(config.topN);
    }
    setOpen(!open);
  }

  return (
    <span className="relative">
      <button
        type="button"
        onClick={toggle}
        className="rounded-lg border border-zinc-200 px-2 py-0.5 text-sm text-zinc-600 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-accent"
      >
        ⚙ {t("vote.settings")}
      </button>
      {open ? (
        <span className="absolute top-8 left-0 z-40 flex w-56 flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
          <NumberField
            label={t("vote.votesPerPerson")}
            value={votesPerPerson}
            onChange={setVotesPerPerson}
          />
          <label className="flex items-center justify-between gap-2 text-sm text-zinc-700">
            {t("vote.maxPerTarget")}
            <input
              type="number"
              min={1}
              max={10}
              value={maxPerTarget ?? ""}
              placeholder="∞"
              onChange={(event) =>
                setMaxPerTarget(
                  event.target.value === "" ? null : Number(event.target.value),
                )
              }
              className="w-14 rounded border border-zinc-300 px-1.5 py-0.5 text-right"
            />
          </label>
          <NumberField label={t("vote.topN")} value={topN} onChange={setTopN} />
          <button
            type="button"
            onClick={apply}
            className="rounded-lg bg-accent px-2 py-1 text-sm font-medium text-white hover:bg-accent-strong"
          >
            {t("vote.apply")}
          </button>
        </span>
      ) : null}
    </span>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm text-zinc-700">
      {label}
      <input
        type="number"
        min={1}
        max={10}
        value={value}
        onChange={(event) =>
          onChange(Math.min(10, Math.max(1, Number(event.target.value) || 1)))
        }
        className="w-14 rounded border border-zinc-300 px-1.5 py-0.5 text-right"
      />
    </label>
  );
}
