// GIF search is proxied through the Worker so the API key stays server-side
// and employee IPs / search terms never reach the provider directly (privacy,
// see docs/05). The provider is isolated behind this one module — GIFs are a
// degradable feature: with no key configured, search returns empty and the UI
// shows a friendly "unavailable" state instead of breaking.
//
// KLIPY is the post-Tenor default (Tenor's API shut down 2026-06-30, GIPHY's
// free production tier is gone). Set the KLIPY_API_KEY secret to enable search.

export interface GifResult {
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
}

export interface GifSearchResponse {
  configured: boolean;
  gifs: GifResult[];
}

const KLIPY_BASE = "https://api.klipy.com/api/v1";

export async function searchGifs(
  env: Env,
  query: string,
  locale: string,
): Promise<GifSearchResponse> {
  const key = env.KLIPY_API_KEY;
  if (!key || query.trim() === "") {
    return { configured: Boolean(key), gifs: [] };
  }

  // Rating is forced to workplace-safe server-side; the client can never widen
  // it. Personalization (customer_id) is deliberately omitted.
  const params = new URLSearchParams({
    q: query,
    rating: "pg",
    locale: locale === "de" ? "de" : "en",
    per_page: "24",
  });
  const url = `${KLIPY_BASE}/${key}/gifs/search?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { configured: true, gifs: [] };
    const body: unknown = await response.json();
    return { configured: true, gifs: parseKlipy(body) };
  } catch {
    // Provider unreachable / timed out — degrade to empty, never throw.
    return { configured: true, gifs: [] };
  }
}

// KLIPY's response shape is Tenor-compatible-ish; parse defensively so a shape
// change degrades to empty rather than crashing the route.
function parseKlipy(body: unknown): GifResult[] {
  const data = extractArray(body);
  const results: GifResult[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const id = String(record.id ?? record.slug ?? "");
    const media = pickMedia(record);
    if (id === "" || media === null) continue;
    results.push({ id, ...media });
  }
  return results;
}

function extractArray(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.data)) return record.data;
    const nested = record.data;
    if (typeof nested === "object" && nested !== null) {
      const inner = (nested as Record<string, unknown>).data;
      if (Array.isArray(inner)) return inner;
    }
    if (Array.isArray(record.results)) return record.results;
  }
  return [];
}

function pickMedia(
  record: Record<string, unknown>,
): Omit<GifResult, "id"> | null {
  const file = record.file ?? record.media ?? record;
  if (typeof file !== "object" || file === null) return null;
  const f = file as Record<string, unknown>;
  const full = readVariant(f.hd ?? f.md ?? f.gif ?? f);
  const preview = readVariant(f.sm ?? f.xs ?? f.preview ?? f.md ?? f) ?? full;
  if (full === null) return null;
  return {
    url: full.url,
    previewUrl: preview?.url ?? full.url,
    width: full.width,
    height: full.height,
  };
}

function readVariant(
  value: unknown,
): { url: string; width: number; height: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const url = v.url ?? v.gif ?? v.src;
  if (typeof url !== "string" || !/^https:\/\//.test(url)) return null;
  return {
    url,
    width: Number(v.width ?? 0) || 0,
    height: Number(v.height ?? 0) || 0,
  };
}
