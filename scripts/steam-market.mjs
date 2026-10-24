import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APPID = 5084200;
export const CURRENCIES = Object.freeze({
  JPY: { code: 8, country: 'JP', file: 'market-jpy.json' },
  USD: { code: 1, country: 'US', file: 'market-usd.json' },
});
const MARKET_ENDPOINT = 'https://steamcommunity.com/market/search/render/';

export function searchUrl(start, currency = 'JPY') {
  if (!Number.isSafeInteger(start) || start < 0 || !CURRENCIES[currency]) throw new Error('Invalid search request');
  const url = new URL(MARKET_ENDPOINT);
  url.searchParams.set('appid', String(APPID));
  url.searchParams.set('norender', '1');
  url.searchParams.set('count', '100');
  url.searchParams.set('start', String(start));
  url.searchParams.set('currency', String(CURRENCIES[currency].code));
  url.searchParams.set('country', CURRENCIES[currency].country);
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

export function priceMatchesCurrency(text, currency) {
  if (typeof text !== 'string' || !text.trim()) return false;
  if (currency === 'JPY') return /^(?:JP¥|¥|￥|JPY\s*)\s*[\d,]+(?:\.00)?$/.test(text.trim());
  if (currency === 'USD') return /^(?:US\$|\$|USD\s*)\s*[\d,]+(?:\.\d{2})?$/.test(text.trim());
  return false;
}

export function normalizeResult(result, currency = 'JPY') {
  if (!result || typeof result !== 'object' || !CURRENCIES[currency]) throw new Error('Invalid item');
  const asset = result.asset_description;
  // A missing market_hash_name cannot be inferred safely from a localized display name.
  const hashName = asset?.market_hash_name ?? result.hash_name;
  const name = result.name;
  if (typeof name !== 'string' || !name.trim() || typeof hashName !== 'string' || !hashName.trim()) {
    throw new Error('Steam item identifier missing');
  }
  if (asset?.appid !== undefined && Number(asset.appid) !== APPID) throw new Error('Unexpected Steam appid');
  const priceText = typeof result.sell_price_text === 'string' && result.sell_price_text.trim() ? result.sell_price_text.trim() : null;
  const priceAmount = Number.isSafeInteger(result.sell_price) && result.sell_price >= 0 ? result.sell_price : null;
  if (priceText !== null && !priceMatchesCurrency(priceText, currency)) {
    throw new Error(`Currency could not be verified for ${currency}`);
  }
  // A numeric price without a matching display currency must never become a sortable price.
  const verifiedPrice = priceText === null ? null : priceAmount;
  const listings = Number.isSafeInteger(result.sell_listings) && result.sell_listings >= 0 ? result.sell_listings : null;
  return {
    name,
    marketHashName: hashName,
    imageUrl: safeSteamImage(asset?.icon_url ? `https://community.cloudflare.steamstatic.com/economy/image/${asset.icon_url}` : null),
    priceMinor: verifiedPrice,
    priceText,
    listings,
    steamUrl: `https://steamcommunity.com/market/listings/${APPID}/${encodeURIComponent(hashName)}`,
  };
}

export function parsePage(body, expectedStart, expectedTotal = null) {
  if (!body || body.success !== true || !Number.isSafeInteger(body.total_count) || body.total_count < 0
      || !Array.isArray(body.results) || body.results.length > 100
      || body.results.length > Math.max(0, body.total_count - expectedStart)
      || (body.start !== undefined && body.start !== expectedStart)
      || (body.pagesize !== undefined && (!Number.isSafeInteger(body.pagesize) || body.pagesize < 1))
      || (expectedTotal !== null && body.total_count !== expectedTotal)) {
    throw new Error('Steam search response shape changed');
  }
  if (body.total_count > expectedStart && body.results.length === 0) throw new Error('Steam returned an incomplete page');
  return body;
}

export async function fetchPage(start, currency, fetchImpl = fetch, expectedTotal = null) {
  let response;
  try {
    response = await fetchImpl(searchUrl(start, currency), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error('Steam network request failed', { cause: error });
  }
  if (response.status === 403 || response.status === 429) throw new Error(`Steam access stopped: HTTP ${response.status}`);
  if (!response.ok) throw new Error(`Steam HTTP ${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new Error('Steam returned non-JSON response', { cause: error });
  }
  return parsePage(body, start, expectedTotal);
}

export async function collect(currency, fetchImpl = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!CURRENCIES[currency]) throw new Error('Unsupported currency');
  const first = await fetchPage(0, currency, fetchImpl);
  const total = first.total_count;
  const all = [...first.results];
  if (total > 0) {
    // The first result count is authoritative when Steam ignores count=100.
    const step = first.results.length;
    if (step > total) throw new Error('Steam returned more items than total_count');
    for (let start = step; start < total; start += step) {
      await pause(2000);
      const page = await fetchPage(start, currency, fetchImpl, total);
      if (page.results.length !== Math.min(step, total - start)) throw new Error('Steam page missing items');
      all.push(...page.results);
    }
    if (all.length !== total) throw new Error('Steam result set was incomplete');
  }
  const unique = new Map();
  for (const raw of all) {
    const item = normalizeResult(raw, currency);
    const previous = unique.get(item.marketHashName);
    // Steam can repeat rows across pages; prefer the row with more active listings.
    if (!previous || (item.listings ?? -1) > (previous.listings ?? -1)) unique.set(item.marketHashName, item);
  }
  return {
    schemaVersion: 2,
    appid: APPID,
    currency,
    // With zero listings there is no price string with which to verify endpoint currency behavior.
    status: unique.size ? 'ok' : 'unavailable',
    fetchedAt: new Date().toISOString(),
    items: [...unique.values()],
  };
}

export function validateSnapshot(snapshot, currency) {
  if (!snapshot || snapshot.schemaVersion !== 2 || snapshot.appid !== APPID || snapshot.currency !== currency
      || !['ok', 'unavailable'].includes(snapshot.status) || !Array.isArray(snapshot.items)
      || (snapshot.status === 'ok' && snapshot.items.length === 0)) throw new Error('Invalid market snapshot');
  for (const item of snapshot.items) {
    if (typeof item.marketHashName !== 'string' || typeof item.name !== 'string'
        || (item.priceText !== null && !priceMatchesCurrency(item.priceText, currency))) {
      throw new Error('Invalid market item');
    }
  }
  return snapshot;
}

export async function saveSnapshot(snapshot, currency, cachePath = new URL(`../public/${CURRENCIES[currency].file}`, import.meta.url)) {
  validateSnapshot(snapshot, currency);
  let previous = null;
  try {
    previous = JSON.parse(await readFile(cachePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous?.status === 'ok' && snapshot.status !== 'ok') {
    throw new Error('Refusing to replace a populated cache with unverified data');
  }
  const temporary = new URL(cachePath.href + '.tmp');
  await writeFile(temporary, JSON.stringify(snapshot) + '\n', 'utf8');
  await rename(temporary, cachePath);
}

async function main() {
  const live = process.argv.includes('--live');
  if (!live || process.env.STEAM_MARKET_COLLECTION_ALLOWED !== 'true') {
    throw new Error('Live Steam collection requires --live and STEAM_MARKET_COLLECTION_ALLOWED=true');
  }
  // Collect both before writing either cache, so a network or currency failure cannot publish a partial pair.
  const jpy = await collect('JPY');
  const usd = await collect('USD');
  validateSnapshot(jpy, 'JPY');
  validateSnapshot(usd, 'USD');
  for (const [currency, next] of [['JPY', jpy], ['USD', usd]]) {
    const path = new URL(`../public/${CURRENCIES[currency].file}`, import.meta.url);
    const previous = JSON.parse(await readFile(path, 'utf8'));
    if (previous.status === 'ok' && next.status !== 'ok') {
      throw new Error(`Refusing to replace populated ${currency} cache`);
    }
  }
  await saveSnapshot(jpy, 'JPY');
  await saveSnapshot(usd, 'USD');
  console.info(`Steam snapshots saved: JPY ${jpy.items.length}, USD ${usd.items.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Steam snapshot update failed:', error.message); process.exitCode = 1; });
}
