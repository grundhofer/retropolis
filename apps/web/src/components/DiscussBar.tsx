import { useTranslation } from "react-i18next";
import type { Note } from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";

export interface DiscussBarProps {
  topTargetIds: string[];
  tallies: Record<string, number> | null;
  focusId: string | null;
  notes: Note[];
  isAdmin: boolean;
}

// The discussion queue: crowned cards in rank order; the facilitator walks
// them and everyone's board focuses along.
export function DiscussBar({
  topTargetIds,
  tallies,
  focusId,
  notes,
  isAdmin,
}: DiscussBarProps) {
  const { t } = useTranslation();
  const { send } = useConnection();

  if (topTargetIds.length === 0) return null;

  function excerptFor(targetId: string): string {
    const stackMembers = notes.filter((n) => n.groupId === targetId);
    const source =
      stackMembers.length > 0
        ? stackMembers
        : notes.filter((n) => n.id === targetId);
    const text = source[0]?.text ?? "";
    const short = text.length > 24 ? `${text.slice(0, 23)}…` : text;
    return stackMembers.length > 0 ? `${short} ×${stackMembers.length}` : short;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm font-medium text-zinc-600">
        {t("discuss.queue")}:
      </span>
      {topTargetIds.map((targetId, index) => {
        const focused = focusId === targetId;
        return (
          <button
            key={targetId}
            type="button"
            data-testid={`discuss-chip-${index + 1}`}
            disabled={!isAdmin}
            onClick={() =>
              send({
                type: "admin.discuss.focus",
                targetId: focused ? null : targetId,
              })
            }
            className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-accent ${
              focused
                ? "bg-accent text-white"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            } ${isAdmin ? "" : "cursor-default"}`}
          >
            <span className="font-semibold">👑 {index + 1}</span>
            {excerptFor(targetId)}
            <span className="tabular-nums opacity-70">
              {tallies?.[targetId] ?? 0}●
            </span>
          </button>
        );
      })}
    </div>
  );
}
