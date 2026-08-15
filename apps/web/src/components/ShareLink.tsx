// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function ShareLink({ boardId }: { boardId: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const url = `${location.origin}/board/${boardId}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (non-secure origin) — select the text so
      // the user can copy manually.
      inputRef.current?.select();
    }
  }

  return (
    <div>
      <label
        htmlFor="share-link"
        className="mb-2 block text-sm font-semibold tracking-wide text-zinc-500 uppercase"
      >
        {t("board.share")}
      </label>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          id="share-link"
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-600"
        />
        <button
          type="button"
          onClick={() => void copy()}
          className="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {copied ? t("board.copied") : t("board.copy")}
        </button>
      </div>
    </div>
  );
}
