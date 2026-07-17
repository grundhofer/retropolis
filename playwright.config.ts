import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  // vite dev runs the SPA, the Worker and the BoardRoom DO in real workerd —
  // the e2e suite exercises the same runtime that production uses.
  webServer: {
    command: "pnpm --filter @retropolis/web dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
