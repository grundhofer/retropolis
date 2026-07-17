# Retropolis

A guided, playful, genuinely free retrospective tool for teams. Browser-only, realtime, German + English, hosted on the Cloudflare free tier with EU data residency.

The plan lives in [PLAN.md](PLAN.md) and [docs/](docs/). Current state: **M0 walking skeleton** — create a board, share the link, watch each other join live.

## Development

```sh
pnpm install
pnpm dev          # SPA + Worker + BoardRoom DO in real workerd, one command
```

## Tests (four layers)

```sh
pnpm --filter @retropolis/shared test   # 1. pure domain logic (node)
pnpm --filter @retropolis/worker test   # 2. Worker + DO in workerd, incl. WebSocket flows
pnpm --filter @retropolis/web test      # 3. components in real Chromium
pnpm test:e2e                           # 4. Playwright multi-context e2e
pnpm check && pnpm lint                 # types + lint
```

## Layout

```
apps/web        React SPA (Vite; the cloudflare plugin runs the worker in dev)
apps/worker     Hono API + BoardRoom Durable Object (wrangler config lives here)
packages/shared zod protocol + pure domain core (reducer, join, colors) — bulk of tests
e2e             Playwright specs
```

## Deployment

`pnpm --filter @retropolis/web deploy` builds and deploys via wrangler (needs `wrangler login`).
CI deploys are gated: set the repo variable `CLOUDFLARE_DEPLOY=true` plus the
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets. PR previews go to the
`preview` environment (separate worker + DO namespace, alias `pr-<number>`).

Note: board DOs are pinned to the EU jurisdiction in production; local workerd
does not implement jurisdictions (see `apps/worker/src/board-stub.ts`).
