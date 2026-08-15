// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateSessionKey, SESSION_KEY_PATTERN } from "@retropolis/shared";

// Per-board capability and identity storage. Everything lives in
// localStorage: no accounts, no cookies (decided — see docs/01 §2).
// localStorage can throw (Safari private mode, storage disabled); the
// in-memory fallback keeps at least the current page session consistent.
const NAME_KEY = "retropolis.name";

const memoryFallback = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? memoryFallback.get(key) ?? null;
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  memoryFallback.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable — the memory fallback above still covers this tab
  }
}

export function loadDisplayName(): string | null {
  return read(NAME_KEY);
}

export function saveDisplayName(name: string): void {
  write(NAME_KEY, name);
}

// Minted client-side before the FIRST join and sent with every join, so a
// retried join (lost sync, reconnect, refresh) always reclaims the same
// participant instead of creating an offline ghost.
export function ensureSessionKey(boardId: string): string {
  const key = `retropolis.board.${boardId}.sessionKey`;
  const stored = read(key);
  if (stored !== null && SESSION_KEY_PATTERN.test(stored)) return stored;
  const fresh = generateSessionKey();
  write(key, fresh);
  return fresh;
}

export function saveSessionKey(boardId: string, sessionKey: string): void {
  write(`retropolis.board.${boardId}.sessionKey`, sessionKey);
}

export function loadAdminToken(boardId: string): string | null {
  return read(`retropolis.board.${boardId}.adminToken`);
}

export function saveAdminToken(boardId: string, adminToken: string): void {
  write(`retropolis.board.${boardId}.adminToken`, adminToken);
}
