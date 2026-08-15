// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

// Lazy-loaded so the wheel/celebration chunk never taxes the first paint.
export async function burstConfetti(): Promise<void> {
  try {
    const { default: confetti } = await import("canvas-confetti");
    void confetti({
      particleCount: 130,
      spread: 75,
      origin: { y: 0.6 },
      disableForReducedMotion: true,
    });
  } catch {
    // celebration is optional
  }
}
