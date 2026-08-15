// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useSyncExternalStore } from "react";

// The wall clock as an external store: a countdown must read Date.now(), and
// useSyncExternalStore is the sanctioned way to consume a mutable external
// source. Snapshots are quantized to the tick so they stay stable within one
// interval (getSnapshot must not return a fresh value on every call).
const TICK_MS = 500;

function subscribe(onChange: () => void): () => void {
  const interval = setInterval(onChange, TICK_MS);
  return () => clearInterval(interval);
}

function getSnapshot(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
