import { z } from "zod";

// Client-minted 128-bit hex ids (notes, ops, columns): letting the client
// choose the id makes creates idempotent — a retried command reuses the same
// id and the server can recognize the replay instead of duplicating.
export const HEX_ID_PATTERN = /^[0-9a-f]{32}$/;

export const hexIdSchema = z.string().regex(HEX_ID_PATTERN);

// The WebCrypto global exists in every runtime this package targets
// (browsers, workerd, Node ≥19), but no single TS lib covers all three —
// declare the one method we use.
declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};

export function generateHexId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
