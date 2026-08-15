// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from "zod";

// Check-in question bank. Only the STABLE ids live here; the localized text is
// rendered client-side (t(`icebreaker.${id}`)), so participants viewing in
// different languages each read the question in their own language. The
// server picks an id — never text — on entering the check-in phase.
export const ICEBREAKER_IDS = [
  "one-word",
  "weather",
  "sprint-emoji",
  "energy-level",
  "highlight",
  "learned",
  "superpower",
  "movie-title",
  "song",
  "animal",
  "gif-week",
  "grateful",
  "surprise",
  "coffee-count",
  "weekend",
  "hidden-talent",
  "if-color",
  "proud-of",
  "recharge",
  "one-wish",
  "team-word",
  "looking-forward",
  "waffle-or-pancake",
  "desert-island",
] as const;

export type IcebreakerId = (typeof ICEBREAKER_IDS)[number];
export const icebreakerIdSchema = z.enum(ICEBREAKER_IDS);

// Deterministic pick from a supplied random index (server passes a CSPRNG
// value; keeps the domain pure/testable). Avoids repeating the current one.
export function pickIcebreaker(
  index: number,
  avoid?: string | null,
): IcebreakerId {
  const options =
    avoid == null
      ? [...ICEBREAKER_IDS]
      : ICEBREAKER_IDS.filter((id) => id !== avoid);
  const pool = options.length > 0 ? options : [...ICEBREAKER_IDS];
  return pool[index % pool.length] as IcebreakerId;
}

export const WORKING_AGREEMENTS_MAX = 1000;
export const workingAgreementsSchema = z.string().max(WORKING_AGREEMENTS_MAX);

// Norm Kerth's Prime Directive is a fixed text; rendered/localized client-side.
export const DEFAULT_WORKING_AGREEMENTS_KEY = "checkin.agreementsDefault";
