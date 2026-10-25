import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
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

export function parsePriceMinor(text, currency) {
  if (typeof text !== 'string') return null;
  // Steamworks documents these currencies in hundredths. The undocumented market
  // endpoint must still prove the same relationship before a price is cached.
  const normalized = text.trim().replace(/[\u00a0\u202f\u3000]/g, ' ');
  const pattern = currency === 'JPY'
    ? /^(?:JP¥|[¥￥]) *(0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?: +JPY)?$/
    : currency === 'USD'
      ? /^(?:US\$|\$) *(0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)\.(\d{2})(?: +USD)?$/
      : null;
  const match = pattern?.exec(normalized);
  if (!match) return null;
  const units = Number(match[1].replaceAll(',', ''));
  const minor = units * 100 + (currency === 'USD' ? Number(match[2]) : 0);
  return Number.isSafeInteger(minor) ? minor : null;
}

export function priceMatchesCurrency(text, currency) {
  return parsePriceMinor(text, currency) !== null;
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
  const displayedMinor = priceText === null ? null : parsePriceMinor(priceText, currency);
  if (priceText !== null && displayedMinor === null) {
    throw new Error(`Currency could not be verified for ${currency}`);
  }
  if (displayedMinor !== null && priceAmount !== null && displayedMinor !== priceAmount) {
    throw new Error('Steam numeric and displayed prices disagree');
  }
  // A numeric price without a matching display currency must never become a sortable price.
  const verifiedPrice = displayedMinor === null ? null : priceAmount;
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
      || (body.pagesize !== undefined && body.results.length > body.pagesize)
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
    // A repeated listing can hide an item skipped by a changing result order.
    // Discard the whole collection instead of publishing an incomplete snapshot.
    if (unique.has(item.marketHashName)) throw new Error('Steam result pages contain duplicate items');
    unique.set(item.marketHashName, item);
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

export async function collectPair(fetchImpl = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  // Complete and validate both currencies before any cache write.
  const jpy = await collect('JPY', fetchImpl, pause);
  const usd = await collect('USD', fetchImpl, pause);
  validateSnapshot(jpy, 'JPY');
  validateSnapshot(usd, 'USD');
  return { JPY: jpy, USD: usd };
}

export function validateSnapshot(snapshot, currency) {
  if (!snapshot || snapshot.schemaVersion !== 2 || snapshot.appid !== APPID || snapshot.currency !== currency
      || !['ok', 'unavailable'].includes(snapshot.status) || !Array.isArray(snapshot.items)
      || (snapshot.status === 'ok' && snapshot.items.length === 0)) throw new Error('Invalid market snapshot');
  for (const item of snapshot.items) {
    if (typeof item.marketHashName !== 'string' || typeof item.name !== 'string'
        || (item.priceText !== null && !priceMatchesCurrency(item.priceText, currency))
        || (item.priceMinor !== null && item.priceMinor !== parsePriceMinor(item.priceText, currency))) {
      throw new Error('Invalid market item');
    }
  }
  return snapshot;
}

export async function validateCachedPair(paths = {
  JPY: new URL('../public/market-jpy.json', import.meta.url),
  USD: new URL('../public/market-usd.json', import.meta.url),
}) {
  for (const currency of ['JPY', 'USD']) {
    const snapshot = JSON.parse(await readFile(paths[currency], 'utf8'));
    validateSnapshot(snapshot, currency);
  }
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

export async function saveSnapshotPair(pair, paths = {
  JPY: new URL('../public/market-jpy.json', import.meta.url),
  USD: new URL('../public/market-usd.json', import.meta.url),
}) {
  const originals = {};
  const temporary = {};
  for (const currency of ['JPY', 'USD']) {
    validateSnapshot(pair[currency], currency);
    originals[currency] = await readFile(paths[currency], 'utf8');
    const previous = JSON.parse(originals[currency]);
    if (previous.status === 'ok' && pair[currency].status !== 'ok') {
      throw new Error(`Refusing to replace populated ${currency} cache`);
    }
    temporary[currency] = new URL(paths[currency].href + '.tmp');
  }
  try {
    for (const currency of ['JPY', 'USD']) {
      await writeFile(temporary[currency], JSON.stringify(pair[currency]) + '\n', 'utf8');
    }
    await rename(temporary.JPY, paths.JPY);
    try {
      await rename(temporary.USD, paths.USD);
    } catch (error) {
      // A failed second rename must not leave a mixed-capture pair on disk.
      try {
        await writeFile(temporary.JPY, originals.JPY, 'utf8');
        await rename(temporary.JPY, paths.JPY);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'USD write and JPY rollback both failed');
      }
      throw error;
    }
  } finally {
    for (const currency of ['JPY', 'USD']) {
      try { await unlink(temporary[currency]); }
      catch (error) { if (error.code !== 'ENOENT') console.warn('Temporary cache cleanup failed', error); }
    }
  }
}

async function main() {
  if (process.argv.includes('--validate-cache')) {
    await validateCachedPair();
    console.info('Both market caches are valid');
    return;
  }
  const live = process.argv.includes('--live');
  if (!live || process.env.STEAM_MARKET_COLLECTION_ALLOWED !== 'true') {
    throw new Error('Live Steam collection requires --live and STEAM_MARKET_COLLECTION_ALLOWED=true');
  }
  // Collect both before writing either cache, so a network or currency failure cannot publish a partial pair.
  const pair = await collectPair();
  await saveSnapshotPair(pair);
  await validateCachedPair();
  console.info(`Steam snapshots saved: JPY ${pair.JPY.items.length}, USD ${pair.USD.items.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Steam snapshot update failed:', error.message); process.exitCode = 1; });
}
