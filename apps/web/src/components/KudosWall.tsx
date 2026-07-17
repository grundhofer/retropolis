import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  generateHexId,
  KUDO_CARD_TYPES,
  type Kudo,
  type KudoCardType,
  type Participant,
} from "@retropolis/shared";
import { useConnection } from "../lib/connection.js";
import { EmojiPicker } from "./EmojiPicker.js";
import { GifPicker } from "./GifPicker.js";

const CARD_ACCENT: Record<KudoCardType, string> = {
  "thank-you": "bg-rose-50 border-rose-200",
  "great-job": "bg-amber-50 border-amber-200",
  "well-done": "bg-emerald-50 border-emerald-200",
  congratulations: "bg-violet-50 border-violet-200",
  "totally-awesome": "bg-sky-50 border-sky-200",
};

export interface KudosWallProps {
  kudos: Kudo[];
  roster: Participant[];
  you: Participant;
  isAdmin: boolean;
  gifsEnabled: boolean;
  readOnly: boolean;
}

// The appreciation wall — the retro's closing finale: end on positives.
export function KudosWall({
  kudos,
  roster,
  you,
  isAdmin,
  gifsEnabled,
  readOnly,
}: KudosWallProps) {
  const { t } = useTranslation();
  const byId = new Map(roster.map((p) => [p.id, p]));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-zinc-900">
          💛 {t("kudos.title")}
        </h2>
        <p className="mt-1 text-zinc-500">{t("kudos.subtitle")}</p>
      </div>

      {!readOnly ? (
        <KudoComposer roster={roster} you={you} gifsEnabled={gifsEnabled} />
      ) : null}

      {kudos.length === 0 ? (
        <p className="text-center text-sm text-zinc-400">{t("kudos.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kudos.map((kudo) => {
            const to = byId.get(kudo.toId);
            const from = kudo.fromId === null ? null : byId.get(kudo.fromId);
            const canRemove = !readOnly && (kudo.fromId === you.id || isAdmin);
            return (
              <article
                key={kudo.id}
                data-testid="kudo-card"
                className={`reveal-in flex flex-col gap-2 rounded-2xl border p-4 shadow-sm ${CARD_ACCENT[kudo.cardType]}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    {t(`kudos.card.${kudo.cardType}`)}
                  </span>
                  {canRemove ? <RemoveButton kudoId={kudo.id} /> : null}
                </div>
                <p className="font-medium text-zinc-800">
                  → {to?.name ?? t("kudos.someone")}
                </p>
                {kudo.text.trim() !== "" ? (
                  <p className="text-sm whitespace-pre-wrap text-zinc-700">
                    {kudo.text}
                  </p>
                ) : null}
                {kudo.gifUrl !== null ? (
                  <img
                    src={kudo.gifUrl}
                    alt=""
                    loading="lazy"
                    className="max-h-40 w-full rounded-lg object-contain"
                  />
                ) : null}
                <span className="mt-auto text-xs text-zinc-400">
                  {from
                    ? t("kudos.from", { name: from.name })
                    : t("kudos.anonymous")}
                </span>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RemoveButton({ kudoId }: { kudoId: string }) {
  const { t } = useTranslation();
  const { mutate } = useConnection();
  return (
    <button
      type="button"
      aria-label={t("kudos.remove")}
      onClick={() =>
        mutate(
          { type: "kudo.delete", opId: generateHexId(), kudoId },
          { type: "kudo.deleted", seq: 0, kudoId },
        )
      }
      className="rounded px-1 text-xs text-zinc-400 hover:bg-white/60 hover:text-zinc-600"
    >
      🗑
    </button>
  );
}

function KudoComposer({
  roster,
  you,
  gifsEnabled,
}: {
  roster: Participant[];
  you: Participant;
  gifsEnabled: boolean;
}) {
  const { t } = useTranslation();
  const { mutate } = useConnection();
  const others = roster.filter((p) => p.id !== you.id);
  const [cardType, setCardType] = useState<KudoCardType>("thank-you");
  const [toId, setToId] = useState<string>(others[0]?.id ?? you.id);
  const [text, setText] = useState("");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [popover, setPopover] = useState<"none" | "gif" | "emoji">("none");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (toId === "") return;
    const kudoId = generateHexId();
    mutate(
      {
        type: "kudo.create",
        opId: generateHexId(),
        kudoId,
        cardType,
        toId,
        text: text.trim(),
        gifUrl,
        anonymous,
      },
      {
        type: "kudo.created",
        seq: 0,
        kudo: {
          id: kudoId,
          cardType,
          toId,
          fromId: anonymous ? null : you.id,
          text: text.trim(),
          gifUrl,
        },
      },
    );
    setText("");
    setGifUrl(null);
    setAnonymous(false);
    setPopover("none");
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4"
    >
      <div className="flex flex-wrap gap-1.5">
        {KUDO_CARD_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            data-testid={`kudo-type-${type}`}
            aria-pressed={cardType === type}
            onClick={() => setCardType(type)}
            className={`rounded-full px-3 py-1 text-sm ${
              cardType === type
                ? "bg-accent text-white"
                : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {t(`kudos.card.${type}`)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-zinc-600">{t("kudos.to")}</label>
        <select
          value={toId}
          data-testid="kudo-recipient"
          onChange={(event) => setToId(event.target.value)}
          className="rounded-lg border border-zinc-200 px-2 py-1 text-sm"
        >
          {roster.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.id === you.id ? ` (${t("board.you")})` : ""}
            </option>
          ))}
        </select>
      </div>

      <textarea
        value={text}
        data-testid="kudo-text"
        onChange={(event) => setText(event.target.value)}
        maxLength={300}
        rows={2}
        placeholder={t("kudos.placeholder")}
        className="resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm placeholder:text-zinc-300 focus-visible:outline-2 focus-visible:outline-accent"
      />

      {gifUrl !== null ? (
        <div className="relative w-fit">
          <img src={gifUrl} alt="" className="max-h-28 rounded-lg" />
          <button
            type="button"
            onClick={() => setGifUrl(null)}
            aria-label={t("gif.remove")}
            className="absolute -top-1.5 -right-1.5 rounded-full bg-zinc-800 px-1.5 text-xs text-white"
          >
            ✕
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {gifsEnabled ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPopover(popover === "gif" ? "none" : "gif")}
              className="rounded-lg border border-zinc-200 px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-50"
            >
              🎞 {t("gif.add")}
            </button>
            {popover === "gif" ? (
              <div className="absolute bottom-9 left-0 z-40">
                <GifPicker
                  onPick={(url) => {
                    setGifUrl(url);
                    setPopover("none");
                  }}
                  onClose={() => setPopover("none")}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="relative">
          <button
            type="button"
            onClick={() => setPopover(popover === "emoji" ? "none" : "emoji")}
            className="rounded-lg border border-zinc-200 px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-50"
          >
            😊
          </button>
          {popover === "emoji" ? (
            <div className="absolute bottom-9 left-0 z-40">
              <EmojiPicker
                onPick={(emoji) => {
                  setText((current) => current + emoji);
                  setPopover("none");
                }}
              />
            </div>
          ) : null}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-zinc-600">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(event) => setAnonymous(event.target.checked)}
            className="accent-accent"
          />
          {t("kudos.anonymousSend")}
        </label>
        <button
          type="submit"
          data-testid="kudo-send"
          className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-strong"
        >
          {t("kudos.send")}
        </button>
      </div>
    </form>
  );
}
