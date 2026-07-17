// 128-bit random hex ids. Board ids and admin tokens are capability secrets:
// whoever has the string has the access, so they must be unguessable.
export function generateSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const SECRET_PATTERN = /^[0-9a-f]{32}$/;

export function isSecretShaped(value: string): boolean {
  return SECRET_PATTERN.test(value);
}

// Uniform draw via rejection sampling — a plain modulo would bias small pools.
export function randomIndex(count: number): number {
  if (count <= 0) throw new Error("randomIndex: empty pool");
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / count) * count;
  do {
    crypto.getRandomValues(buf);
  } while ((buf[0] as number) >= limit);
  return (buf[0] as number) % count;
}

// Constant-time comparison for capability tokens. Uses the Workers runtime's
// timingSafeEqual; lengths are compared first since it requires equal sizes.
export function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  return crypto.subtle.timingSafeEqual(bufA, bufB);
}
