// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

export const BOARD_LOCALES = ["en", "de"] as const;
export const boardLocaleSchema = z.enum(BOARD_LOCALES);
export type BoardLocale = z.infer<typeof boardLocaleSchema>;

export const TEMPLATE_KEYS = [
  "went-well",
  "start-stop-continue",
  "mad-sad-glad",
  "four-ls",
  "sailboat",
  "starfish",
] as const;

export const templateKeySchema = z.enum(TEMPLATE_KEYS);
export type TemplateKey = z.infer<typeof templateKeySchema>;

// Column names are DATA, not UI strings: they are materialized in the
// creator's language at board creation and stay editable afterwards.
const TEMPLATE_COLUMNS: Record<
  TemplateKey,
  Record<BoardLocale, readonly string[]>
> = {
  "went-well": {
    en: ["Went well", "To improve", "Action items"],
    de: ["Lief gut", "Zu verbessern", "Maßnahmen"],
  },
  "start-stop-continue": {
    en: ["Start", "Stop", "Continue"],
    de: ["Anfangen", "Aufhören", "Weitermachen"],
  },
  "mad-sad-glad": {
    en: ["Mad", "Sad", "Glad"],
    de: ["Wütend", "Traurig", "Froh"],
  },
  "four-ls": {
    en: ["Liked", "Learned", "Lacked", "Longed for"],
    de: ["Gefallen", "Gelernt", "Gefehlt", "Gewünscht"],
  },
  sailboat: {
    en: [
      "Wind (pushes us)",
      "Anchors (hold us back)",
      "Rocks (risks ahead)",
      "Island (our goal)",
    ],
    de: [
      "Wind (treibt uns an)",
      "Anker (bremsen uns)",
      "Felsen (Risiken)",
      "Insel (unser Ziel)",
    ],
  },
  starfish: {
    en: ["Keep doing", "Less of", "More of", "Stop doing", "Start doing"],
    de: ["Beibehalten", "Weniger davon", "Mehr davon", "Aufhören", "Anfangen"],
  },
};

export function templateColumnNames(
  key: TemplateKey,
  locale: BoardLocale,
): readonly string[] {
  return TEMPLATE_COLUMNS[key][locale];
}
