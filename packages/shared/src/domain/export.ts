import type { KudoCardType } from "../protocol.js";

// Structured board snapshot for export. Author names are only ever included
// when the exporter opts in — the depersonalized form is the default (the
// keepable artifact should carry the ideas, not who said what).
export interface ExportNote {
  text: string;
  gifUrl: string | null;
  authorName: string | null;
  votes: number | null;
  crownedRank: number | null;
}

export interface ExportColumn {
  name: string;
  notes: ExportNote[];
}

export interface ExportAction {
  text: string;
  ownerName: string | null;
  done: boolean;
}

export interface ExportKudo {
  cardType: KudoCardType;
  toName: string;
  fromName: string | null;
  text: string;
}

export interface BoardExport {
  boardName: string;
  createdAt: number;
  columns: ExportColumn[];
  actions: ExportAction[];
  kudos: ExportKudo[];
}

export const KUDO_CARD_LABELS: Record<KudoCardType, string> = {
  "thank-you": "Thank you",
  "great-job": "Great job",
  "well-done": "Well done",
  congratulations: "Congratulations",
  "totally-awesome": "Totally awesome",
};

function isoDate(epochMs: number): string {
  // Deterministic, timezone-free date string (avoids Date-in-render concerns).
  return new Date(epochMs).toISOString().slice(0, 10);
}

export function toMarkdown(data: BoardExport): string {
  const lines: string[] = [];
  lines.push(
    `# ${data.boardName}`,
    "",
    `_Retrospective · ${isoDate(data.createdAt)}_`,
    "",
  );

  for (const column of data.columns) {
    lines.push(`## ${column.name}`, "");
    if (column.notes.length === 0) {
      lines.push("_(no notes)_", "");
      continue;
    }
    for (const note of column.notes) {
      const parts: string[] = [];
      if (note.crownedRank !== null) parts.push(`👑${note.crownedRank}`);
      parts.push(note.text.replace(/\n/g, " "));
      const meta: string[] = [];
      if (note.votes !== null && note.votes > 0)
        meta.push(`${note.votes} votes`);
      if (note.authorName !== null) meta.push(note.authorName);
      const suffix = meta.length > 0 ? ` _(${meta.join(", ")})_` : "";
      lines.push(`- ${parts.join(" ")}${suffix}`);
      if (note.gifUrl !== null) lines.push(`  ![gif](${note.gifUrl})`);
    }
    lines.push("");
  }

  if (data.actions.length > 0) {
    lines.push("## Action items", "");
    for (const action of data.actions) {
      const owner =
        action.ownerName !== null ? ` — **${action.ownerName}**` : "";
      lines.push(`- [${action.done ? "x" : " "}] ${action.text}${owner}`);
    }
    lines.push("");
  }

  if (data.kudos.length > 0) {
    lines.push("## Appreciation", "");
    for (const kudo of data.kudos) {
      const from = kudo.fromName !== null ? ` — ${kudo.fromName}` : "";
      const text =
        kudo.text.trim() === "" ? "" : `: ${kudo.text.replace(/\n/g, " ")}`;
      lines.push(
        `- **${KUDO_CARD_LABELS[kudo.cardType]}** → ${kudo.toName}${text}${from}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(data: BoardExport): string {
  const rows: string[][] = [
    ["section", "column", "text", "votes", "rank", "author", "gif"],
  ];
  for (const column of data.columns) {
    for (const note of column.notes) {
      rows.push([
        "note",
        column.name,
        note.text,
        note.votes === null ? "" : String(note.votes),
        note.crownedRank === null ? "" : String(note.crownedRank),
        note.authorName ?? "",
        note.gifUrl ?? "",
      ]);
    }
  }
  for (const action of data.actions) {
    rows.push([
      "action",
      action.done ? "done" : "open",
      action.text,
      "",
      "",
      action.ownerName ?? "",
      "",
    ]);
  }
  for (const kudo of data.kudos) {
    rows.push([
      "kudo",
      KUDO_CARD_LABELS[kudo.cardType],
      kudo.text,
      "",
      "",
      kudo.fromName ?? "",
      "",
    ]);
    // recipient goes in the column slot's neighbour — keep it simple: encode in text-adjacent
    rows[rows.length - 1]![1] =
      `${KUDO_CARD_LABELS[kudo.cardType]} → ${kudo.toName}`;
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function toJson(data: BoardExport): string {
  return JSON.stringify(data, null, 2);
}

export const EXPORT_FORMATS = ["md", "csv", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function renderExport(format: ExportFormat, data: BoardExport): string {
  switch (format) {
    case "md":
      return toMarkdown(data);
    case "csv":
      return toCsv(data);
    case "json":
      return toJson(data);
  }
}

export function exportContentType(format: ExportFormat): string {
  switch (format) {
    case "md":
      return "text/markdown; charset=utf-8";
    case "csv":
      return "text/csv; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
  }
}
