// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Participant } from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";

export interface AvatarRowProps {
  participants: Participant[];
  youId: string | null;
  isAdmin: boolean;
}

// Compact presence for the board header: colored initials, dimmed offline.
// Facilitators can click an avatar to hand off / share the facilitator role.
export function AvatarRow({ participants, youId, isAdmin }: AvatarRowProps) {
  const { t } = useTranslation();
  const { send } = useConnection();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="flex -space-x-1.5">
      {participants.map((participant) => (
        <span
          key={participant.id}
          className="relative"
          onBlur={(event) => {
            // close only when focus leaves the avatar AND its menu
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setOpenId((id) => (id === participant.id ? null : id));
            }
          }}
        >
          <button
            type="button"
            data-testid={`avatar-${participant.name}`}
            title={
              participant.name +
              (participant.role === "facilitator"
                ? ` · ${t("board.facilitator")}`
                : "")
            }
            disabled={!isAdmin}
            onClick={() =>
              setOpenId(openId === participant.id ? null : participant.id)
            }
            className={`flex size-7 items-center justify-center rounded-full border-2 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-accent ${
              participant.role === "facilitator"
                ? "border-zinc-700"
                : "border-white"
            } ${participant.online ? "" : "opacity-35"} ${isAdmin ? "cursor-pointer" : ""}`}
            style={{ backgroundColor: participant.color }}
          >
            {initials(participant.name)}
          </button>
          {openId === participant.id && isAdmin ? (
            <span className="absolute top-9 right-0 z-40 w-max rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
              <button
                type="button"
                data-testid={`role-toggle-${participant.name}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  send({
                    type: "admin.role.set",
                    participantId: participant.id,
                    role:
                      participant.role === "facilitator"
                        ? "member"
                        : "facilitator",
                  });
                  setOpenId(null);
                }}
                className="block w-full rounded px-2 py-1 text-left text-sm text-zinc-700 hover:bg-zinc-50"
              >
                {participant.role === "facilitator"
                  ? t("roster.removeFacilitator")
                  : t("roster.makeFacilitator")}
              </button>
              {participant.id === youId ? (
                <span className="block px-2 pb-0.5 text-xs text-zinc-400">
                  {t("roster.you")}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}
