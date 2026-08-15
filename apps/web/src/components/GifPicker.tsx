// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchGifs, type GifResult } from "../lib/gifs.js";

// Search runs through our Worker proxy (key server-side, employee IPs hidden).
// When no KLIPY key is configured the proxy returns empty + configured:false,
// and we show a friendly "unavailable" note instead of breaking.
export function GifPicker({
  onPick,
  onClose,
}: {
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [state, setState] = useState<
    "idle" | "loading" | "empty" | "unavailable"
  >("idle");
  const locale = i18n.language.startsWith("de") ? "de" : "en";
  const reqId = useRef(0);

  useEffect(() => {
    const term = query.trim();
    const id = ++reqId.current;
    // All state updates happen inside the (async) timeout callback, never
    // synchronously in the effect body.
    const timeout = setTimeout(
      () => {
        if (id !== reqId.current) return;
        if (term === "") {
          setResults([]);
          setState("idle");
          return;
        }
        setState("loading");
        void searchGifs(term, locale).then((res) => {
          if (id !== reqId.current) return; // superseded by a newer search
          if (!res.configured) setState("unavailable");
          else if (res.gifs.length === 0) setState("empty");
          else setState("idle");
          setResults(res.gifs);
        });
      },
      term === "" ? 0 : 350,
    );
    return () => clearTimeout(timeout);
  }, [query, locale]);

  return (
    <div className="w-72 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        <input
          autoFocus
          value={query}
          data-testid="gif-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("gif.search")}
          className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-accent"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label={t("note.cancel")}
          className="rounded px-1 text-sm text-zinc-400 hover:bg-zinc-100"
        >
          ✕
        </button>
      </div>
      {state === "unavailable" ? (
        <p className="px-1 py-4 text-center text-xs text-zinc-400">
          {t("gif.unavailable")}
        </p>
      ) : state === "loading" ? (
        <p className="px-1 py-4 text-center text-xs text-zinc-400">
          {t("gif.loading")}
        </p>
      ) : state === "empty" ? (
        <p className="px-1 py-4 text-center text-xs text-zinc-400">
          {t("gif.none")}
        </p>
      ) : results.length === 0 ? (
        <p className="px-1 py-4 text-center text-xs text-zinc-400">
          {t("gif.hint")}
        </p>
      ) : (
        <div className="grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto">
          {results.map((gif) => (
            <button
              key={gif.id}
              type="button"
              data-testid="gif-result"
              onClick={() => onPick(gif.url)}
              className="overflow-hidden rounded-lg border border-zinc-100 hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
            >
              <img
                src={gif.previewUrl}
                alt=""
                loading="lazy"
                className="h-24 w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
      <p className="mt-1 px-1 text-right text-[10px] text-zinc-300">
        {t("gif.poweredBy")}
      </p>
    </div>
  );
}
