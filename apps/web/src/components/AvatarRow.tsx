import type { Participant } from "@retropolis/shared";

// Compact presence for the board header: colored initials, dimmed offline.
export function AvatarRow({ participants }: { participants: Participant[] }) {
  return (
    <div className="flex -space-x-1.5" aria-hidden="false">
      {participants.map((participant) => (
        <span
          key={participant.id}
          title={participant.name}
          className={`flex size-7 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white ${
            participant.online ? "" : "opacity-35"
          }`}
          style={{ backgroundColor: participant.color }}
        >
          {initials(participant.name)}
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
