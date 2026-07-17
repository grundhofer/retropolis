import { z } from "zod";

const gifResultSchema = z.object({
  id: z.string(),
  url: z.string(),
  previewUrl: z.string(),
  width: z.number(),
  height: z.number(),
});
export type GifResult = z.infer<typeof gifResultSchema>;

const gifSearchResponseSchema = z.object({
  configured: z.boolean(),
  gifs: z.array(gifResultSchema),
});
export type GifSearchResponse = z.infer<typeof gifSearchResponseSchema>;

export async function searchGifs(
  query: string,
  locale: string,
): Promise<GifSearchResponse> {
  const params = new URLSearchParams({ q: query, locale });
  const response = await fetch(`/api/gifs/search?${params.toString()}`);
  if (!response.ok) return { configured: false, gifs: [] };
  return gifSearchResponseSchema.parse(await response.json());
}
