import type { CatalogEntry, Source } from './catalog';
import { hostAllowed } from './catalog';

export interface Release {
  version: string;
  url: string;
  /** Lowercase hex SHA-256 to verify against, when the source provides one. */
  sha256: string | null;
  source: string;
}

export type JsonFetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface CaskJson {
  version?: string;
  url?: string;
  sha256?: string;
  variations?: Record<string, { url?: string; sha256?: string }>;
}

async function fromCask(token: string, fetchJson: JsonFetch): Promise<Release | null> {
  const res = await fetchJson(`https://formulae.brew.sh/api/cask/${encodeURIComponent(token)}.json`);
  if (!res.ok) return null;
  const cask = (await res.json()) as CaskJson;
  // Some casks list an Apple Silicon variation separately.
  const arm = Object.entries(cask.variations ?? {}).find(([k]) => k.startsWith('arm64_'))?.[1];
  const url = arm?.url ?? cask.url;
  const sha = arm?.sha256 ?? cask.sha256;
  if (!url || !cask.version) return null;
  return { version: cask.version.split(',')[0]!, url, sha256: sha && /^[0-9a-f]{64}$/i.test(sha) ? sha.toLowerCase() : null, source: `Homebrew cask "${token}"` };
}

interface GithubRelease {
  tag_name?: string;
  assets?: { name: string; browser_download_url: string; digest?: string | null }[];
}

async function fromGithub(repo: string, asset: RegExp, fetchJson: JsonFetch): Promise<Release | null> {
  const res = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
  if (!res.ok) return null;
  const rel = (await res.json()) as GithubRelease;
  const a = rel.assets?.find((x) => asset.test(x.name));
  if (!a || !rel.tag_name) return null;
  const digest = a.digest?.startsWith('sha256:') ? a.digest.slice(7).toLowerCase() : null;
  return { version: rel.tag_name.replace(/^v/, ''), url: a.browser_download_url, sha256: digest, source: `GitHub ${repo}` };
}

/** First source that yields a release whose URL is on an allowed host. */
export async function resolveRelease(entry: CatalogEntry, fetchJson: JsonFetch): Promise<Release> {
  const errors: string[] = [];
  for (const s of entry.sources as Source[]) {
    try {
      const r = s.kind === 'cask' ? await fromCask(s.token, fetchJson) : await fromGithub(s.repo, s.asset, fetchJson);
      if (!r) continue;
      if (!hostAllowed(r.url, entry.hosts)) {
        errors.push(`${r.source} points to an unexpected host`);
        continue;
      }
      return r;
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  throw new Error(`Couldn't find a macOS download${errors.length ? ` (${errors.join('; ')})` : ''}. Download it from ${entry.homepage} instead.`);
}
