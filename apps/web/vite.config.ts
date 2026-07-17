import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One `vite dev` runs the SPA, the Worker, and the BoardRoom DO in real
// workerd. The worker package owns the wrangler config.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare({ configPath: "../worker/wrangler.jsonc" }),
  ],
});
