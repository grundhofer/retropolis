# Contributing to Retropolis

Thanks for wanting to help. Two things before code: the CLA, and the scope rule.

## 1. The CLA is mandatory

Every pull request needs a signed [Contributor License Agreement](CLA.md). A bot checks this
automatically and comments on your PR with instructions — you sign once, by leaving this comment:

```
I have read the CLA Document and I hereby sign the CLA
```

Your signature is recorded in the `cla-signatures` branch (`signatures/cla.json`) and covers all your
future PRs.

**Why:** Retropolis is AGPL-3.0-or-later and stays that way. The CLA lets the project be licensed
from a single hand, so infringement can be enforced and companies that cannot adopt copyleft can buy
a commercial exception licence — which is what funds the hosted instance staying free. In exchange,
Section 7 of the CLA irrevocably guarantees your contribution stays available under a free licence
forever. Read the full reasoning in [CLA.md](CLA.md).

If you contribute on work time, check with your employer first — Section 6 asks you to confirm you
have the clearance.

## 2. Scope: talk before you build

Retropolis has an opinionated plan ([PLAN.md](PLAN.md), [docs/](docs/)) and a deliberately narrow
product scope. Open an issue before starting anything larger than a bug fix — a PR that does not fit
the roadmap will be declined no matter how good the code is, and that wastes your time more than mine.

Good first contributions: bug fixes, German/English wording, accessibility fixes, test coverage for
`packages/shared`.

## 3. Working on the code

```sh
pnpm install
pnpm dev                  # SPA + Worker + BoardRoom DO in real workerd
```

Before pushing, everything must be green:

```sh
pnpm check && pnpm lint   # types + lint
pnpm test                 # unit/integration across all three packages
pnpm test:e2e             # Playwright
pnpm format               # prettier
```

House rules:

- **Domain logic goes in `packages/shared`** and is tested there as pure functions. The Durable Object
  in `apps/worker` sequences and persists; it should not grow rules of its own.
- **Match the surrounding style.** Do not reformat, rename or refactor code your change does not touch.
- **New source files need the SPDX header** (see any existing file):
  ```ts
  // SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
  // SPDX-License-Identifier: AGPL-3.0-or-later
  ```
  Keep the year of first publication; do not update it on later edits. If you are not the author of a
  new file's content, use your own name in the `SPDX-FileCopyrightText` line — the CLA handles the
  licensing.
- **Both languages.** User-facing strings go through i18n with German and English.
- **No new third-party network calls** without discussion. EU data residency and the no-tracking
  promise are product requirements, not preferences.

## 4. Third-party code

If your PR includes code you did not write, say so explicitly in the PR description and name its
licence. Only permissive licences (MIT, BSD, ISC, Apache-2.0) can be accepted — a copyleft dependency
in the core would remove the project's ability to grant commercial exception licences.
