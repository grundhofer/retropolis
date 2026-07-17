import { useTranslation } from "react-i18next";
import { setLanguage } from "../i18n.js";

export function LanguageToggle() {
  const { i18n } = useTranslation();
  const current = i18n.language.startsWith("de") ? "de" : "en";
  const next = current === "de" ? "en" : "de";
  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent"
      aria-label={
        next === "de" ? "Auf Deutsch umschalten" : "Switch to English"
      }
    >
      {next.toUpperCase()}
    </button>
  );
}
