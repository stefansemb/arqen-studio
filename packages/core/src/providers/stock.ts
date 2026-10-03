export interface StockImage {
  id: string;
  url: string;
  credit: string;
}

/** Pexels photo search. Free API, images licensed for commercial use without attribution. */
export async function searchPexels(query: string, apiKey: string, perPage = 10): Promise<StockImage[]> {
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("size", "large");
  url.searchParams.set("per_page", String(perPage));
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) throw new Error(`Pexels ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    photos: { id: number; photographer: string; src: { large2x: string } }[];
  };
  return data.photos.map((p) => ({
    id: `pexels-${p.id}`,
    url: p.src.large2x,
    credit: `Photo: ${p.photographer} / Pexels`,
  }));
}
