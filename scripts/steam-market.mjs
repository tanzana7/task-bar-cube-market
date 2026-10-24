import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APPID = 5084200;
const MARKET_ENDPOINT = 'https://steamcommunity.com/market/search/render/';
const CACHE_PATH = new URL('../public/market.json', import.meta.url);

export function searchUrl(start) {
  const url = new URL(MARKET_ENDPOINT);
  url.searchParams.set('appid', String(APPID));
  url.searchParams.set('norender', '1');
  url.searchParams.set('count', '100');
  url.searchParams.set('start', String(start));
  return url.href;
}

function safeSteamImage(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    return url.protocol === 'https:' && url.hostname === 'community.cloudflare.steamstatic.com' ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeResult(result) {
  if (!result || typeof result !== 'object') return null;
  const asset = result.asset_description;
  // Steam's search result name is its listing identifier when hash_name is absent.
  const hashName = asset?.market_hash_name ?? result.hash_name ?? result.name;
  const name = result.name;
  if (typeof name !== 'string' || !name.trim() || typeof hashName !== 'string' || !hashName.trim()) return null;
  if (asset?.appid !== undefined && Number(asset.appid) !== APPID) return null;
  const minor = Number.isSafeInteger(result.sell_price) && result.sell_price >= 0 ? result.sell_price : null;
  const listings = Number.isSafeInteger(result.sell_listings) && result.sell_listings >= 0 ? result.sell_listings : null;
  return {
    name,
    marketHashName: hashName,
    imageUrl: safeSteamImage(asset?.icon_url ? `https://community.cloudflare.steamstatic.com/economy/image/${asset.icon_url}` : null),
    priceMinor: minor,
    priceText: typeof result.sell_price_text === 'string' && result.sell_price_text.trim() ? result.sell_price_text : null,
    listings,
    steamUrl: `https://steamcommunity.com/market/listings/${APPID}/${encodeURIComponent(hashName)}`,
  };
}

export function parsePage(body, expectedStart) {
  if (!body || body.success !== true || body.start !== expectedStart || !Number.isSafeInteger(body.total_count)
      || body.total_count < 0 || !Array.isArray(body.results) || body.results.length > 100) {
    throw new Error('Steam search response shape changed');
  }
  if (body.total_count > 0 && body.results.length === 0) throw new Error('Steam returned an incomplete page');
  return body;
}

export async function fetchPage(start, fetchImpl = fetch) {
  const response = await fetchImpl(searchUrl(start), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (response.status === 403 || response.status === 429) throw new Error(`Steam access stopped: HTTP ${response.status}`);
  if (!response.ok) throw new Error(`Steam HTTP ${response.status}`);
  return parsePage(await response.json(), start);
}

export async function collect(fetchImpl = fetch) {
  const first = await fetchPage(0, fetchImpl);
  const all = [...first.results];
  // Actual pagesize is used because Steam can ignore the requested count.
  const step = first.results.length || first.pagesize || 10;
  if (!Number.isSafeInteger(step) || step < 1 || step > 100) throw new Error('Invalid Steam page size');
  for (let start = step; start < first.total_count; start += step) {
    // Sequential requests with a conservative delay; no retry on access restrictions.
    await new Promise(resolve => setTimeout(resolve, 2000));
    const page = await fetchPage(start, fetchImpl);
    all.push(...page.results);
  }
  if (all.length < first.total_count) throw new Error('Steam result set was incomplete');
  const normalized = all.map(normalizeResult);
  if (normalized.some(item => item === null)) throw new Error('Steam returned an item without an identifier');
  const unique = [...new Map(normalized.map(item => [item.marketHashName, item])).values()];
  return {
    schemaVersion: 1,
    appid: APPID,
    status: unique.length ? 'ok' : 'empty',
    fetchedAt: new Date().toISOString(),
    // search/render does not guarantee the requested currency; retain display text, do not relabel it.
    currency: null,
    items: unique,
  };
}

async function main() {
  // This command is manual only. Production scheduling requires a separate permission review.
  const snapshot = await collect();
  const previous = JSON.parse(await readFile(CACHE_PATH, 'utf8'));
  if (previous.status === 'ok' && snapshot.status === 'empty') {
    throw new Error('Refusing to replace a populated cache with an empty response');
  }
  const temporary = new URL('../public/market.json.tmp', import.meta.url);
  await writeFile(temporary, JSON.stringify(snapshot) + '\n', 'utf8');
  await rename(temporary, CACHE_PATH);
  console.info(`Steam snapshot saved: ${snapshot.items.length} items at ${snapshot.fetchedAt}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Steam snapshot update failed:', error.message); process.exitCode = 1; });
}
