import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APPID = 5084200;
export const TBH_APPID = 3678970;
export const DEFAULT_REQUEST_POLICY = Object.freeze({ minIntervalMs: 15000, maxRequestsPerRun: 6, maxRequestsPerDay: 24 });
export const DEFAULT_COLLECTION_STATE_PATH = new URL('../.market/steam-collection-state.json', import.meta.url);
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
      || (body.pagesize !== undefined && body.total_count > expectedStart
        && body.results.length < Math.min(body.pagesize, body.total_count - expectedStart))
      || (expectedTotal !== null && body.total_count !== expectedTotal)) {
    throw new Error('Steam search response shape changed');
  }
  if (body.total_count > expectedStart && body.results.length === 0) throw new Error('Steam returned an incomplete page');
  return body;
}

function strictPositiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error(`Invalid ${name} setting`);
  return Number(value);
}

export function requestPolicyFromEnv(env = process.env) {
  const minIntervalMs = strictPositiveInteger(env.STEAM_MIN_INTERVAL_MS, DEFAULT_REQUEST_POLICY.minIntervalMs, 'minimum request interval');
  if (minIntervalMs < DEFAULT_REQUEST_POLICY.minIntervalMs) throw new Error('Steam request interval cannot be lower than 15000ms');
  return {
    minIntervalMs,
    maxRequestsPerRun: strictPositiveInteger(env.STEAM_MAX_REQUESTS_PER_RUN, DEFAULT_REQUEST_POLICY.maxRequestsPerRun, 'per-run request limit'),
    maxRequestsPerDay: strictPositiveInteger(env.STEAM_MAX_REQUESTS_PER_DAY, DEFAULT_REQUEST_POLICY.maxRequestsPerDay, 'daily request budget'),
  };
}

function utcDate(value) { return value.toISOString().slice(0, 10); }

function validateCollectionState(value) {
  if (!value || value.schemaVersion !== 1 || typeof value.utcDate !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(value.utcDate)
      || !Number.isSafeInteger(value.requestsToday) || value.requestsToday < 0
      || !(value.lastRequestAt === null || (typeof value.lastRequestAt === 'string' && Number.isFinite(Date.parse(value.lastRequestAt))))
      || !(value.stop === null || (typeof value.stop === 'object' && [403, 429, 'non-json', 'invalid-response'].includes(value.stop.status)
        && typeof value.stop.at === 'string' && Number.isFinite(Date.parse(value.stop.at))))
      || !(value.diagnostic === undefined || (typeof value.diagnostic === 'object' && value.diagnostic !== null
        && typeof value.diagnostic.at === 'string' && Number.isFinite(Date.parse(value.diagnostic.at))
        && typeof value.diagnostic.endpoint === 'string' && typeof value.diagnostic.status === 'string'))
      || !(value.diagnostics === undefined || (Array.isArray(value.diagnostics) && value.diagnostics.length <= 20
        && value.diagnostics.every(entry => entry && typeof entry === 'object'
          && typeof entry.at === 'string' && Number.isFinite(Date.parse(entry.at))
          && typeof entry.endpoint === 'string' && typeof entry.status === 'string')))) {
    throw new Error('Steam request budget state is invalid; refusing live collection');
  }
  return value;
}

async function loadCollectionState(path, now) {
  if (!path) return { schemaVersion: 1, utcDate: utcDate(now), requestsToday: 0, lastRequestAt: null, stop: null };
  try {
    return validateCollectionState(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, utcDate: utcDate(now), requestsToday: 0, lastRequestAt: null, stop: null };
    throw error;
  }
}

async function saveCollectionState(path, state) {
  if (!path) return;
  const target = path instanceof URL ? path : pathToFileURL(resolve(path));
  if (target.protocol !== 'file:') throw new Error('Steam request state must be a local file');
  await mkdir(dirname(fileURLToPath(target)), { recursive: true });
  const temporary = new URL(`${target.href}.tmp`);
  await writeFile(temporary, `${JSON.stringify(validateCollectionState(state), null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

function recordCollectionDiagnostic(state, diagnostic) {
  state.diagnostic = diagnostic;
  state.diagnostics = [...(state.diagnostics ?? []), diagnostic].slice(-20);
}

function safeResponseHeader(response, name) {
  const value = response.headers?.get?.(name);
  return typeof value === 'string' ? value.replace(/[\r\n\t]/g, ' ').slice(0, 120) || null : null;
}

function safeHttpDiagnostic(status) {
  if (status === 400) return 'Steam rejected the request; response body omitted.';
  if (status === 404) return 'The requested route was unavailable; response body omitted.';
  return `HTTP ${status} response; response body omitted.`;
}

export function createSteamRequestController({ fetchImpl = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  policy = DEFAULT_REQUEST_POLICY, statePath = null, now = () => new Date() } = {}) {
  let requestsMade = 0;
  let lastStartMs = null;
  let queue = Promise.resolve();

  async function request(url, init = {}, { scope = 'production', endpoint = url } = {}) {
    let unlock;
    const previous = queue;
    queue = new Promise(resolve => { unlock = resolve; });
    await previous;
    try {
      if (requestsMade >= policy.maxRequestsPerRun) throw new Error('Steam per-run request limit reached');
      let current = now();
      let state = await loadCollectionState(statePath, current);
      if (state.stop) throw new Error(`Steam collection remains stopped after HTTP ${state.stop.status}; clear the stop state manually after review`);
      const day = utcDate(current);
      const requestsToday = state.utcDate === day ? state.requestsToday : 0;
      if (requestsToday >= policy.maxRequestsPerDay) throw new Error('Steam daily request budget reached');
      const priorStart = lastStartMs ?? (state.lastRequestAt ? Date.parse(state.lastRequestAt) : null);
      if (priorStart !== null) {
        const delay = policy.minIntervalMs - (current.valueOf() - priorStart);
        if (delay > 0) await pause(delay);
      }
      current = now();
      state = { ...state, utcDate: day, requestsToday: requestsToday + 1, lastRequestAt: current.toISOString() };
      requestsMade += 1;
      lastStartMs = current.valueOf();
      await saveCollectionState(statePath, state); // Count attempts before transmission, including failures.
      const startedAt = current.valueOf();
      let response;
      try {
        response = await fetchImpl(url, {
          ...init,
          headers: { Accept: 'application/json', ...init.headers },
          signal: AbortSignal.timeout(15000),
        });
      } catch (error) {
        throw new Error('Steam network request failed', { cause: error });
      }
      const durationMs = Math.max(0, now().valueOf() - startedAt);
      const contentType = safeResponseHeader(response, 'Content-Type');
      if (response.status === 403 || response.status === 429) {
        recordCollectionDiagnostic(state, {
          scope,
          endpoint,
          status: 'http-error',
          httpStatus: response.status,
          at: now().toISOString(),
          retryAfter: safeResponseHeader(response, 'Retry-After'),
          contentType,
          diagnosticMessage: safeHttpDiagnostic(response.status),
        });
        state.stop = { status: response.status, at: now().toISOString(), retryAfter: safeResponseHeader(response, 'Retry-After') };
        await saveCollectionState(statePath, state);
      } else if (response.ok === false) {
        // An experimental route can fail without disabling the established collector.
        // Access-limit responses above remain global regardless of scope.
        recordCollectionDiagnostic(state, {
          scope,
          endpoint,
          status: 'http-error',
          httpStatus: response.status,
          at: now().toISOString(),
          retryAfter: safeResponseHeader(response, 'Retry-After'),
          contentType,
          diagnosticMessage: safeHttpDiagnostic(response.status),
        });
        if (scope === 'production') {
          state.stop = { status: 'invalid-response', at: now().toISOString(), retryAfter: safeResponseHeader(response, 'Retry-After') };
        }
        await saveCollectionState(statePath, state);
      }
      return { response, durationMs };
    } finally {
      unlock();
    }
  }

  async function stop(reason = 'non-json', { scope = 'production', endpoint = 'unknown', httpStatus = null, retryAfter = null,
    contentType = null, diagnosticMessage = null } = {}) {
    if (![403, 429, 'non-json', 'invalid-response'].includes(reason)) throw new Error('Invalid stop reason');
    const current = now();
    const state = await loadCollectionState(statePath, current);
    if (reason === 403 || reason === 429 || scope === 'production') {
      state.stop = { status: reason, at: current.toISOString(), retryAfter };
    } else {
      recordCollectionDiagnostic(state, { scope, endpoint, status: reason, httpStatus, at: current.toISOString(), retryAfter,
        contentType, diagnosticMessage });
    }
    await saveCollectionState(statePath, state);
  }

  return { request, stop, get requestsMade() { return requestsMade; }, maxRequestsPerRun: policy.maxRequestsPerRun };
}

export async function clearSteamCollectionStop(statePath = DEFAULT_COLLECTION_STATE_PATH, now = new Date()) {
  const state = await loadCollectionState(statePath, now);
  state.stop = null;
  await saveCollectionState(statePath, state);
  return state;
}

export async function fetchPage(start, currency, fetchImpl = fetch, expectedTotal = null, requestController = null) {
  let response;
  let durationMs = null;
  try {
    if (requestController) ({ response, durationMs } = await requestController.request(searchUrl(start, currency)));
    else response = await fetchImpl(searchUrl(start, currency), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
  } catch (error) {
    if (error.message?.includes('Steam')) throw error;
    throw new Error('Steam network request failed', { cause: error });
  }
  if (response.status === 403 || response.status === 429) throw new Error(`Steam access stopped: HTTP ${response.status}`);
  if (!response.ok) throw new Error(`Steam HTTP ${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch (error) {
    if (requestController) await requestController.stop('non-json');
    throw new Error('Steam returned non-JSON response', { cause: error });
  }
  return { ...parsePage(body, start, expectedTotal), requestDurationMs: durationMs };
}

export async function collect(currency, fetchImpl = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), options = {}) {
  if (!CURRENCIES[currency]) throw new Error('Unsupported currency');
  const policy = options.policy ?? DEFAULT_REQUEST_POLICY;
  const controller = options.requestController ?? createSteamRequestController({ fetchImpl, pause, policy, statePath: options.statePath ?? null, now: options.now });
  const first = await fetchPage(0, currency, fetchImpl, null, controller);
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
    // Advance by observed rows; Steam may ignore count=100 and report another page size.
    const step = first.results.length;
    if (step > total) throw new Error('Steam returned more items than total_count');
    const estimatedRequests = Math.ceil(total / step);
    if (estimatedRequests > controller.maxRequestsPerRun) {
      throw new Error(`Steam market requires about ${estimatedRequests} requests at the returned page size; per-run limit is ${controller.maxRequestsPerRun}`);
    }
    for (let start = step; start < total; start += step) {
      const page = await fetchPage(start, currency, fetchImpl, total, controller);
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

export async function validateUsdCache(cachePath = new URL('../public/market-usd.json', import.meta.url)) {
  const snapshot = JSON.parse(await readFile(cachePath, 'utf8'));
  return validateSnapshot(snapshot, 'USD');
}

export async function saveUsdSnapshot(snapshot, cachePath = new URL('../public/market-usd.json', import.meta.url), additionalFiles = []) {
  validateSnapshot(snapshot, 'USD');
  let previous = null;
  try { previous = JSON.parse(await readFile(cachePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not read USD cache', { cause: error }); }
  if (previous?.status === 'ok' && snapshot.status !== 'ok') {
    throw new Error('Refusing to replace a populated USD cache with an unverified snapshot');
  }
  await saveFilesAtomically([
    { path: cachePath, content: `${JSON.stringify(snapshot)}\n` },
    ...additionalFiles,
  ]);
}

export async function refreshUsdSnapshot(fetchImpl = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), {
  cachePath = new URL('../public/market-usd.json', import.meta.url),
  historyOptions = {},
  requestPolicy = DEFAULT_REQUEST_POLICY,
  statePath = null,
} = {}) {
  const requestController = createSteamRequestController({ fetchImpl, pause, policy: requestPolicy, statePath });
  const snapshot = await collect('USD', fetchImpl, pause, { requestController, policy: requestPolicy });
  const { prepareHistoryUpdate } = await import('./price-history.mjs');
  const history = await prepareHistoryUpdate(snapshot, historyOptions);
  await saveUsdSnapshot(snapshot, cachePath, history.files);
  return { snapshot, history, requestCount: requestController.requestsMade };
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
}, additionalFiles = []) {
  validateSnapshotPair(pair);
  const originals = {};
  const files = [];
  for (const currency of ['JPY', 'USD']) {
    validateSnapshot(pair[currency], currency);
    originals[currency] = await readFile(paths[currency], 'utf8');
    const previous = JSON.parse(originals[currency]);
    if (previous.status === 'ok' && pair[currency].status !== 'ok') {
      throw new Error(`Refusing to replace populated ${currency} cache`);
    }
    files.push({ path: paths[currency], content: `${JSON.stringify(pair[currency])}\n` });
  }
  await saveFilesAtomically([...files, ...additionalFiles]);
}

export async function saveFilesAtomically(files) {
  const paths = new Set();
  const originals = new Map();
  const staged = [];
  const urlFor = value => value instanceof URL ? value : pathToFileURL(resolve(value));
  for (const file of files) {
    const path = urlFor(file.path);
    if (path.protocol !== 'file:' || paths.has(path.href) || typeof file.content !== 'string') {
      throw new Error('Invalid or duplicate atomic file update');
    }
    paths.add(path.href);
    await mkdir(dirname(fileURLToPath(path)), { recursive: true });
    try { originals.set(path.href, await readFile(path, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      originals.set(path.href, null);
    }
    staged.push({ path, temporary: new URL(`${path.href}.tmp`), rollback: new URL(`${path.href}.rollback.tmp`), content: file.content });
  }

  const committed = [];
  try {
    for (const file of staged) await writeFile(file.temporary, file.content, 'utf8');
    for (const file of staged) {
      await rename(file.temporary, file.path);
      committed.push(file);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const file of committed.reverse()) {
      try {
        const original = originals.get(file.path.href);
        if (original === null) await unlink(file.path);
        else {
          await writeFile(file.rollback, original, 'utf8');
          await rename(file.rollback, file.path);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'File update and rollback failed');
    throw error;
  } finally {
    for (const file of staged) {
      for (const temporary of [file.temporary, file.rollback]) {
        try { await unlink(temporary); }
        catch (error) { if (error.code !== 'ENOENT') console.warn('Temporary update cleanup failed', error); }
      }
    }
  }
}

async function main() {
  if (process.argv.includes('--clear-stop')) {
    const state = await clearSteamCollectionStop();
    console.info(JSON.stringify({ status: 'cleared', utcDate: state.utcDate, requestsToday: state.requestsToday }));
    return;
  }
  if (process.argv.includes('--validate-cache')) {
    await validateUsdCache();
    const { validateHistoryCache } = await import('./price-history.mjs');
    const history = await validateHistoryCache();
    console.info(`USD market cache, ${history.products.length} price histories, and rankings are valid`);
    return;
  }
  const live = process.argv.includes('--live');
  if (!live || process.env.STEAM_MARKET_COLLECTION_ALLOWED !== 'true') {
    throw new Error('Live Steam collection requires --live and STEAM_MARKET_COLLECTION_ALLOWED=true');
  }
  // USD is the only market source of truth. FX outages or unsupported JPY listings must not block it.
  const policy = requestPolicyFromEnv();
  const { snapshot: usd, history, requestCount } = await refreshUsdSnapshot(fetch,
    ms => new Promise(resolve => setTimeout(resolve, ms)), { requestPolicy: policy, statePath: DEFAULT_COLLECTION_STATE_PATH });
  await validateUsdCache();
  const { validateHistoryCache } = await import('./price-history.mjs');
  const validatedHistory = await validateHistoryCache();
  console.info(`USD Steam snapshot saved: ${usd.items.length} items; history products ${validatedHistory.products.length}; Steam requests ${requestCount}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Steam snapshot update failed:', error.message); process.exitCode = 1; });
}
