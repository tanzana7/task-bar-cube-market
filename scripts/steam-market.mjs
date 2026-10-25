import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APPID = 5084200;
export const CURRENCIES = Object.freeze({
  JPY: { code: 8, country: 'JP', file: 'market-jpy.json' },
  USD: { code: 1, country: 'US', file: 'market-usd.json' },
});
const MARKET_ENDPOINT = 'https://steamcommunity.com/market/search/render/';
export const FX_RATE_URL = 'https://api.frankfurter.dev/v2/rate/USD/JPY';

export class CurrencyMismatchError extends Error {}

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
  // USD hundredths were observed in TBH search results. JPY search units remain unverified;
  // the parser only accepts them when Steam's text and integer match this exact relation.
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

export function normalizeResult(result, currency = 'JPY', appid = APPID) {
  if (!result || typeof result !== 'object' || !CURRENCIES[currency]) throw new Error('Invalid item');
  const asset = result.asset_description;
  // A missing market_hash_name cannot be inferred safely from a localized display name.
  const hashName = asset?.market_hash_name ?? result.hash_name;
  const name = result.name;
  if (typeof name !== 'string' || !name.trim() || typeof hashName !== 'string' || !hashName.trim()) {
    throw new Error('Steam item identifier missing');
  }
  if (asset?.appid !== undefined && Number(asset.appid) !== appid) throw new Error('Unexpected Steam appid');
  const priceText = typeof result.sell_price_text === 'string' && result.sell_price_text.trim() ? result.sell_price_text.trim() : null;
  const priceAmount = Number.isSafeInteger(result.sell_price) && result.sell_price >= 0 ? result.sell_price : null;
  const displayedMinor = priceText === null ? null : parsePriceMinor(priceText, currency);
  if (priceText !== null && displayedMinor === null) {
    // Only a fully verified USD response to a JPY request can trigger FX fallback.
    if (currency === 'JPY' && priceAmount !== null && parsePriceMinor(priceText, 'USD') === priceAmount) {
      throw new CurrencyMismatchError('Steam returned USD for a JPY request');
    }
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
    // The UI must never display an unverified string when the numeric amount is absent.
    priceText: verifiedPrice === null ? null : priceText,
    listings,
    steamUrl: `https://steamcommunity.com/market/listings/${appid}/${encodeURIComponent(hashName)}`,
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
  const unique = new Map();
  const addResults = results => {
    for (const raw of results) {
      // Validate each page before requesting another; a mismatched currency must not trigger a full crawl.
      const item = normalizeResult(raw, currency);
      if (unique.has(item.marketHashName)) throw new Error('Steam result pages contain duplicate items');
      unique.set(item.marketHashName, item);
    }
  };
  addResults(first.results);
  if (total > 0) {
    // The first result count is authoritative when Steam ignores count=100.
    const step = first.results.length;
    if (step > total) throw new Error('Steam returned more items than total_count');
    for (let start = step; start < total; start += step) {
      await pause(2000);
      const page = await fetchPage(start, currency, fetchImpl, total);
      if (page.results.length !== Math.min(step, total - start)) throw new Error('Steam page missing items');
      addResults(page.results);
    }
    if (unique.size !== total) throw new Error('Steam result set was incomplete');
  }
  return {
    schemaVersion: 2,
    appid: APPID,
    currency,
    priceSource: 'steam',
    // With zero listings there is no price string with which to verify endpoint currency behavior.
    status: unique.size ? 'ok' : 'unavailable',
    fetchedAt: new Date().toISOString(),
    items: [...unique.values()],
  };
}

export function validateFxRateRecord(record, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const rateDate = record?.rateDate;
  const published = typeof rateDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rateDate)
    ? Date.parse(`${rateDate}T00:00:00Z`) : NaN;
  const fetchedAt = Date.parse(record?.fetchedAt);
  const nowMs = nowDate.valueOf();
  const apiUrl = record?.apiUrl ?? record?.sourceUrl;
  const today = Number.isFinite(nowMs) ? nowDate.toISOString().slice(0, 10) : '';
  if (record?.source !== 'Frankfurter' || apiUrl !== FX_RATE_URL || record.base !== 'USD' || record.quote !== 'JPY'
      || !Number.isFinite(record.rate) || record.rate < 1 || record.rate > 1000
      || !Number.isFinite(published) || new Date(published).toISOString().slice(0, 10) !== rateDate
      || !Number.isFinite(nowMs) || rateDate > today
      || !Number.isFinite(fetchedAt) || fetchedAt - nowMs > 60000
      || nowMs - published > 4 * 86400000) {
    throw new Error('FX rate is invalid or stale');
  }
  return { source: 'Frankfurter', sourceUrl: FX_RATE_URL, base: 'USD', quote: 'JPY', rate: record.rate,
    rateDate, fetchedAt: new Date(fetchedAt).toISOString() };
}

export async function readFxRateCache(cachePath = new URL('../public/fx-rate.json', import.meta.url), now = new Date()) {
  let record;
  try {
    record = JSON.parse(await readFile(cachePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Could not read FX cache', { cause: error });
  }
  if (record?.schemaVersion !== 1) return null;
  try {
    return validateFxRateRecord(record, now);
  } catch {
    return null;
  }
}

export async function fetchFxRate(fetchImpl = fetch, now = () => new Date()) {
  let response;
  try {
    response = await fetchImpl(FX_RATE_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  } catch (error) {
    throw new Error('FX network request failed', { cause: error });
  }
  if (!response.ok) throw new Error(`FX HTTP ${response.status}`);
  const body = await response.json();
  const fetchedAt = now().toISOString();
  // Frankfurter publishes business-day observations. A Friday quote is still current over a normal weekend.
  return validateFxRateRecord({ source: 'Frankfurter', sourceUrl: FX_RATE_URL, base: body.base, quote: body.quote,
    rate: body.rate, rateDate: body.date, fetchedAt }, new Date(fetchedAt));
}

export function convertUsdToJpy(usd, fxRate) {
  validateSnapshot(usd, 'USD');
  const items = usd.items.map(item => {
    if (item.priceMinor === null) return { ...item, priceMinor: null, priceText: null };
    const yen = Math.round(item.priceMinor * fxRate.rate / 100);
    if (!Number.isSafeInteger(yen) || !Number.isSafeInteger(yen * 100)) throw new Error('Converted price is out of range');
    return { ...item, priceMinor: yen * 100, priceText: `¥${yen.toLocaleString('en-US')}` };
  });
  return { ...usd, currency: 'JPY', priceSource: 'fx', fxRate, items };
}

export async function collectPair(fetchImpl = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), rateFetchImpl = fetch, now = () => new Date(), options = {}) {
  // Complete both sides before any cache write. Only an explicit currency mismatch permits FX fallback.
  const usd = await collect('USD', fetchImpl, pause);
  let jpy;
  try {
    jpy = await collect('JPY', fetchImpl, pause);
  } catch (error) {
    if (!(error instanceof CurrencyMismatchError)) throw error;
    console.warn('Steam JPY currency mismatch; using labeled FX reference prices');
    const cachedRate = options.fxRateCachePath ? await readFxRateCache(options.fxRateCachePath, now()) : null;
    jpy = convertUsdToJpy(usd, cachedRate ?? await fetchFxRate(rateFetchImpl, now));
  }
  return validateSnapshotPair({ JPY: jpy, USD: usd });
}

export function validateSnapshot(snapshot, currency) {
  if (!snapshot || snapshot.schemaVersion !== 2 || snapshot.appid !== APPID || snapshot.currency !== currency
      || !['ok', 'unavailable'].includes(snapshot.status) || !Array.isArray(snapshot.items)
      || (snapshot.status === 'ok' && snapshot.items.length === 0)) throw new Error('Invalid market snapshot');
  if (snapshot.priceSource !== undefined && !['steam', 'fx'].includes(snapshot.priceSource)) throw new Error('Invalid price source');
  if (snapshot.priceSource === 'fx' && (currency !== 'JPY' || !snapshot.fxRate
      || snapshot.fxRate.source !== 'Frankfurter' || snapshot.fxRate.sourceUrl !== FX_RATE_URL
      || snapshot.fxRate.base !== 'USD' || snapshot.fxRate.quote !== 'JPY'
      || !Number.isFinite(snapshot.fxRate.rate) || snapshot.fxRate.rate <= 0 || snapshot.fxRate.rate > 10000
      || typeof snapshot.fxRate.rateDate !== 'string' || Number.isNaN(Date.parse(snapshot.fxRate.rateDate))
      || Number.isNaN(Date.parse(snapshot.fxRate.fetchedAt)))) throw new Error('Invalid FX metadata');
  for (const item of snapshot.items) {
    if (typeof item.marketHashName !== 'string' || typeof item.name !== 'string'
        || (item.priceText === null) !== (item.priceMinor === null)
        || (item.priceText !== null && !priceMatchesCurrency(item.priceText, currency))
        || (item.priceMinor !== null && item.priceMinor !== parsePriceMinor(item.priceText, currency))) {
      throw new Error('Invalid market item');
    }
  }
  return snapshot;
}

export function validateSnapshotPair(pair) {
  validateSnapshot(pair?.JPY, 'JPY');
  validateSnapshot(pair?.USD, 'USD');
  if (pair.JPY.priceSource === 'fx') {
    const expected = convertUsdToJpy(pair.USD, pair.JPY.fxRate);
    if (pair.JPY.fetchedAt !== pair.USD.fetchedAt || pair.JPY.items.length !== expected.items.length
        || pair.JPY.items.some((item, index) => item.marketHashName !== expected.items[index].marketHashName
          || item.name !== expected.items[index].name || item.imageUrl !== expected.items[index].imageUrl
          || item.listings !== expected.items[index].listings || item.steamUrl !== expected.items[index].steamUrl
          || item.priceMinor !== expected.items[index].priceMinor || item.priceText !== expected.items[index].priceText)) {
      throw new Error('Converted JPY prices do not match USD snapshot and FX rate');
    }
  }
  return pair;
}

export async function validateCachedPair(paths = {
  JPY: new URL('../public/market-jpy.json', import.meta.url),
  USD: new URL('../public/market-usd.json', import.meta.url),
}) {
  const pair = {};
  for (const currency of ['JPY', 'USD']) pair[currency] = JSON.parse(await readFile(paths[currency], 'utf8'));
  validateSnapshotPair(pair);
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
  validateSnapshotPair(pair);
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
  const pair = await collectPair(fetch, ms => new Promise(resolve => setTimeout(resolve, ms)), fetch,
    () => new Date(), { fxRateCachePath: new URL('../public/fx-rate.json', import.meta.url) });
  await saveSnapshotPair(pair);
  await validateCachedPair();
  console.info(`Steam snapshots saved: JPY ${pair.JPY.items.length}, USD ${pair.USD.items.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Steam snapshot update failed:', error.message); process.exitCode = 1; });
}
