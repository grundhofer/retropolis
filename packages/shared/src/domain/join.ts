// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Participant } from "../protocol.js";
import { assignColor } from "./colors.js";

export interface JoinInput {
  /** Sanitized display name (already validated by the protocol schema). */
  requestedName: string;
  /** Whether the supplied admin token matched the board's (compared by the caller). */
  isAdmin: boolean;
  /** Participant previously registered under the supplied session key, if any. */
  existing: Participant | null;
  /** Colors already assigned on this board. */
  takenColors: readonly string[];
  /** Pre-generated id used only when this join creates a new participant. */
  newId: string;
}

export interface JoinPlan {
  participant: Participant;
  isNew: boolean;
}

// Pure join decision: reclaim identity via session key (keeping id and color
// stable across reconnects), allow renaming on rejoin, and only ever upgrade
// the role — a facilitator who rejoins without the admin token stays
// facilitator, so a dropped admin connection cannot demote anyone.
export function planJoin(input: JoinInput): JoinPlan {
  const { requestedName, isAdmin, existing, takenColors, newId } = input;

  if (existing) {
    return {
      participant: {
        ...existing,
        name: requestedName,
        role: isAdmin ? "facilitator" : existing.role,
        online: true,
      },
      isNew: false,
    };
  }

  return {
    participant: {
      id: newId,
      name: requestedName,
      color: assignColor(takenColors),
      role: isAdmin ? "facilitator" : "member",
      online: true,
    },
    isNew: true,
  };
}
