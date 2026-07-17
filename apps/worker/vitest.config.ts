import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Storage isolation is per test file (pool-workers 0.18 / Vitest 4), so the
// WebSocket flow tests in ws.test.ts share storage within their file and need
// no special project. Tests must not assume clean storage across files.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
