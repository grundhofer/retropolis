// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// Component tests run in real Chromium (Vitest Browser Mode) — motion, drag
// and canvas need no jsdom shims. The cloudflare plugin deliberately does not
// run here; anything socket-shaped is faked behind the BoardSocket interface.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    include: ["src/**/*.test.tsx"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
