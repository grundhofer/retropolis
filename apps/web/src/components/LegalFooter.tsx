// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useTranslation } from "react-i18next";

const REPO = "https://github.com/grundhofer/retropolis";

// AGPL §13 obliges a version reachable over a network to offer its users the
// Corresponding Source *of that version*; §5(d) obliges the interactive UI to
// carry the copyright notice, the licence terms and the warranty disclaimer.
// Both are discharged here, on every screen a participant actually uses.
//
// The commit is injected at build time (VITE_COMMIT_SHA — see deploy.yml and
// the `deploy` script). Without it the links degrade to the default branch,
// which is correct for dev and tests but not for a deployed build.
const commit = import.meta.env.VITE_COMMIT_SHA;
const sourceUrl = commit ? `${REPO}/tree/${commit}` : REPO;
const licenseUrl = `${REPO}/blob/${commit ?? "main"}/LICENSE`;
const shortCommit = commit ? commit.slice(0, 7) : null;

const linkClass =
  "underline underline-offset-2 hover:text-zinc-600 focus-visible:outline-2 focus-visible:outline-accent";

export function LegalFooter() {
  const { t } = useTranslation();
  return (
    <footer
      data-testid="legal-footer"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-6 py-4 text-xs text-zinc-400"
    >
      <span>© 2026 Sebastian Grundhöfer</span>
      <span aria-hidden="true">·</span>
      <a
        href={licenseUrl}
        target="_blank"
        rel="noreferrer"
        className={linkClass}
      >
        {t("legal.license")}
      </a>
      <span aria-hidden="true">·</span>
      <span>{t("legal.redistribute")}</span>
      <span aria-hidden="true">·</span>
      <a
        href={sourceUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={t("legal.sourceVersion")}
        className={linkClass}
      >
        {t("legal.source")}
        {shortCommit ? ` ${shortCommit}` : null}
      </a>
    </footer>
  );
}
