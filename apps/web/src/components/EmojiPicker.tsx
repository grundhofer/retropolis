// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

// A compact, dependency-free emoji picker (native Unicode — zero bytes, zero
// third-party requests, GDPR-safe). A curated set covers the common retro
// reactions; the full emoji-picker-element (thousands + search) is a deferred
// nicety, not needed since notes accept typed native emoji directly.
const EMOJI_SET = [
  "👍",
  "👎",
  "❤️",
  "🎉",
  "😂",
  "😮",
  "😢",
  "😡",
  "👀",
  "🙌",
  "🔥",
  "🚀",
  "✅",
  "❌",
  "💡",
  "⚠️",
  "🤔",
  "🙏",
  "💪",
  "👏",
  "😅",
  "🥳",
  "😴",
  "🤯",
  "💯",
  "⭐",
  "🌟",
  "🐛",
  "🧹",
  "📈",
  "📉",
  "🎯",
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div
      data-testid="emoji-picker"
      className="grid w-56 grid-cols-8 gap-0.5 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg"
    >
      {EMOJI_SET.map((emoji) => (
        <button
          key={emoji}
          type="button"
          data-testid={`emoji-${emoji}`}
          onClick={() => onPick(emoji)}
          className="rounded p-1 text-lg hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
