// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Full commit SHA of the deployed build, injected by the deploy paths so the
  // AGPL §13 source link can point at the exact running version. Absent in dev
  // and in tests — LegalFooter degrades to the default branch.
  readonly VITE_COMMIT_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
