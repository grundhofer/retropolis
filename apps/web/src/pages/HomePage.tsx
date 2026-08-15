// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  layoutModes,
  TEMPLATE_KEYS,
  type LayoutMode,
  type TemplateKey,
} from "@retropolis/shared";
import { LanguageToggle } from "../components/LanguageToggle.js";
import { LegalFooter } from "../components/LegalFooter.js";
import { createBoard } from "../lib/api.js";
import { saveAdminToken } from "../lib/session.js";

export function HomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<TemplateKey>("went-well");
  const [layout, setLayout] = useState<LayoutMode>("columns");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || name.trim() === "") return;
    setBusy(true);
    setFailed(false);
    try {
      const locale = i18n.language.startsWith("de") ? "de" : "en";
      const { boardId, adminToken } = await createBoard(
        name.trim(),
        template,
        locale,
        layout,
      );
      saveAdminToken(boardId, adminToken);
      void navigate(`/board/${boardId}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50">
      <header className="flex items-center justify-between px-6 py-4">
        <span className="font-semibold text-zinc-800">{t("app.name")}</span>
        <LanguageToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-semibold text-zinc-900">
            {t("home.title")}
          </h1>
          <p className="mt-1 mb-6 text-zinc-500">{t("app.tagline")}</p>
          <form
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-4"
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-zinc-700">
                {t("home.boardName")}
              </span>
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("home.boardNamePlaceholder")}
                maxLength={40}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-zinc-700">
                {t("home.template")}
              </span>
              <select
                value={template}
                onChange={(event) =>
                  setTemplate(event.target.value as typeof template)
                }
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent"
              >
                {TEMPLATE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {t(`template.${key}.name`)}
                  </option>
                ))}
              </select>
              <span className="text-sm text-zinc-400">
                {t(`template.${template}.hint`)}
              </span>
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-zinc-700">
                {t("home.layout")}
              </span>
              <div className="flex gap-2" role="group">
                {layoutModes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`home-layout-${mode}`}
                    aria-pressed={layout === mode}
                    onClick={() => setLayout(mode)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                      layout === mode
                        ? "border-accent bg-accent/10 text-accent-strong"
                        : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"
                    }`}
                  >
                    {t(`home.layoutMode.${mode}`)}
                  </button>
                ))}
              </div>
              <span className="text-sm text-zinc-400">
                {t(`home.layoutHint.${layout}`)}
              </span>
            </div>
            <button
              type="submit"
              disabled={busy || name.trim() === ""}
              className="rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
            >
              {busy ? t("home.creating") : t("home.create")}
            </button>
            {failed ? (
              <p role="alert" className="text-sm text-red-700">
                {t("home.createFailed")}
              </p>
            ) : null}
          </form>
        </div>
      </main>
      <LegalFooter />
    </div>
  );
}
