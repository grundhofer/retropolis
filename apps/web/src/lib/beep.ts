// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

const SOUND_KEY = "retropolis.sound";

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, enabled ? "1" : "0");
  } catch {
    // storage unavailable — the toggle just won't persist
  }
}

// A soft two-tone chime via raw Web Audio (~no dependency); sounds are
// off by default (product spec §12 — open offices, calls).
export function playTimerChime(): void {
  try {
    const AudioContextCtor = window.AudioContext;
    const ctx = new AudioContextCtor();
    const now = ctx.currentTime;
    for (const [offset, frequency] of [
      [0, 880],
      [0.18, 660],
    ] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.45);
    }
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    // audio unavailable — silently skip
  }
}
