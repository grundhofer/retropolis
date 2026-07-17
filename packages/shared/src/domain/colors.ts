// Fixed palette assigned server-side on join: guarantees distinct colors for
// up to 12 participants (typical retro size), then cycles.
export const PARTICIPANT_COLORS = [
  "#E8590C",
  "#1971C2",
  "#2F9E44",
  "#9C36B5",
  "#E64980",
  "#0C8599",
  "#E8B50C",
  "#5F3DC4",
  "#D9480F",
  "#087F5B",
  "#C2255C",
  "#3B5BDB",
] as const;

export function assignColor(takenColors: readonly string[]): string {
  const free = PARTICIPANT_COLORS.find((c) => !takenColors.includes(c));
  if (free !== undefined) return free;
  return PARTICIPANT_COLORS[
    takenColors.length % PARTICIPANT_COLORS.length
  ] as string;
}
