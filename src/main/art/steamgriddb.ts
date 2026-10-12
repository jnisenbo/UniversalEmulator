import type { ArtSearchResult } from '@shared/types';

/**
 * Minimal SteamGridDB v2 client. Uses the user's own API key; requests go
 * only to steamgriddb.com (and its image CDN for downloads).
 */
const API = 'https://www.steamgriddb.com/api/v2';

export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer>; headers: { get(name: string): string | null } }>;

interface Asset {
  url: string;
  mime?: string;
  width?: number;
  height?: number;
}

export type ArtKind = 'grid' | 'hero' | 'logo';

export class SteamGridDbClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: Fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${API}${path}`, { headers: { Authorization: `Bearer ${this.apiKey}` } });
    if (res.status === 401 || res.status === 403) throw new Error('SteamGridDB rejected the API key.');
    if (res.status === 404) return { success: true, data: [] } as T;
    if (!res.ok) throw new Error(`SteamGridDB error ${res.status}`);
    return (await res.json()) as T;
  }

  async search(term: string): Promise<ArtSearchResult[]> {
    const body = await this.get<{ data?: { id: number; name: string; release_date?: number }[] }>(`/search/autocomplete/${encodeURIComponent(term)}`);
    return (body.data ?? []).map((g) => ({ id: g.id, name: g.name, year: g.release_date ? new Date(g.release_date * 1000).getUTCFullYear() : null }));
  }

  /** First static asset of a kind. Tiles prefer square grids, then any grid. */
  async asset(gameId: number, kind: ArtKind): Promise<Asset | null> {
    const queries: string[] =
      kind === 'grid'
        ? [`/grids/game/${gameId}?dimensions=512x512,1024x1024&types=static`, `/grids/game/${gameId}?types=static`]
        : [`/${kind === 'hero' ? 'heroes' : 'logos'}/game/${gameId}?types=static`];
    for (const q of queries) {
      const body = await this.get<{ data?: Asset[] }>(q);
      const first = body.data?.find((a) => typeof a.url === 'string');
      if (first) return first;
    }
    return null;
  }

  async download(url: string): Promise<{ data: Buffer; ext: string }> {
    // Image URLs are on SteamGridDB's CDN; only https is accepted.
    if (!url.startsWith('https://')) throw new Error('Refusing non-https image URL');
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`Image download failed (${res.status})`);
    const type = res.headers.get('content-type') ?? '';
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    return { data: Buffer.from(await res.arrayBuffer()), ext };
  }
}
