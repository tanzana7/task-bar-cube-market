import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_COLLECTION_STATE_PATH,
  DEFAULT_REQUEST_POLICY,
  TBH_APPID,
  createSteamRequestController,
  normalizeResult,
  parsePage,
  parsePriceMinor,
  requestPolicyFromEnv,
} from './steam-market.mjs';

const FIXTURE_PATH = new URL('../tests/fixtures/tbh-search-page.json', import.meta.url);
const NEW_SEARCH_FIXTURE_PATH = new URL('../tests/fixtures/tbh-structured-search-contract.json', import.meta.url);
const STRUCTURED_SEARCH_ENDPOINT = 'https://steamcommunity.com/market/search?appid=3678970';

export function tbhSearchUrl() {
  const url = new URL('https://steamcommunity.com/market/search/render/');
  for (const [key, value] of Object.entries({ appid: TBH_APPID, norender: 1, count: 100, start: 0, currency: 1, country: 'US' })) {
    url.searchParams.set(key, String(value));
  }
  return url.href;
}

export function tbhStructuredSearchUrl() { return STRUCTURED_SEARCH_ENDPOINT; }

export function tbhStructuredSearchBody() {
  return [{ appid: TBH_APPID, filters: {}, accessoryFilters: {}, price: { eCurrency: 1 }, start: 0 }];
}

export function inspectStructuredSearch(payload, { expectedAppId = TBH_APPID } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Structured Steam search returned null or a non-object response');
  if (!Number.isSafeInteger(payload.start) || payload.start < 0
      || !Number.isSafeInteger(payload.total_count) || payload.total_count < 0
      || !Array.isArray(payload.facets)) throw new Error('Structured Steam search page metadata is incomplete');

  const grouped = Array.isArray(payload.results) && !Array.isArray(payload.listings);
  const directListings = Array.isArray(payload.listings) && !Array.isArray(payload.results);
  if (!grouped && !directListings) throw new Error('Structured Steam search must contain exactly one of results or listings');
  if (grouped && payload.grouping !== 1) throw new Error('Structured Steam results are not identified as grouped catalog products');
  const rows = grouped ? payload.results : payload.listings;
  if (rows.length > 100 || rows.length > Math.max(0, payload.total_count - payload.start)) {
    throw new Error('Structured Steam search row count is inconsistent');
  }

  const ids = new Set();
  let duplicateIds = 0;
  let validPrices = 0;
  let validIdentifiers = 0;
  let validSellOrderCounts = 0;
  let imagesPresent = 0;
  let marketHashNamesAvailable = 0;
  let appIdsVerified = 0;
  const identifierSamples = [];
  const marketHashNameSamples = [];
  const priceSamples = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = grouped ? row.strHash : row.market_bucket_id ?? row.listingid;
    if (typeof id === 'string' && id.trim()) {
      validIdentifiers += 1;
      if (ids.has(id)) duplicateIds += 1;
      ids.add(id);
      if (identifierSamples.length < 3) identifierSamples.push(id);
    }
    const description = row.asset_description ?? row.description;
    if (description?.appid !== undefined) {
      if (Number(description.appid) !== expectedAppId) throw new Error('Structured Steam response contains a different AppID');
      appIdsVerified += 1;
    }
    const hashName = description?.market_hash_name;
    if (typeof hashName === 'string' && hashName.trim()) {
      marketHashNamesAvailable += 1;
      if (marketHashNameSamples.length < 3) marketHashNameSamples.push(hashName);
    }
    const currencyVerified = row.eCurrency === 1;
    const priceText = typeof row.strMinSellSubtotal === 'string'
      ? row.strMinSellSubtotal
      : typeof row.strMinSellPrice === 'string' ? row.strMinSellPrice : null;
    const priceMinor = currencyVerified ? parsePriceMinor(priceText, 'USD') : null;
    if (priceMinor !== null) {
      validPrices += 1;
      if (priceSamples.length < 3) priceSamples.push({ text: priceText, minor: priceMinor });
    }
    const sellOrders = row.cSellOrders;
    if (Number.isSafeInteger(sellOrders) && sellOrders >= 0) validSellOrderCounts += 1;
    const icon = description?.icon_url ?? row.strImageURL ?? row.icon_url;
    if (typeof icon === 'string' && icon.length > 0) imagesPresent += 1;
  }

  const pageSize = rows.length;
  return {
    mode: grouped ? 'grouped-products' : 'individual-listings',
    grouping: Number.isSafeInteger(payload.grouping) ? payload.grouping : null,
    start: payload.start,
    totalCount: payload.total_count,
    returnedRows: pageSize,
    returnedProductKinds: grouped ? pageSize : null,
    pageStepCandidate: pageSize || null,
    estimatedProductRequests: !grouped ? null
      : pageSize === 0 ? (payload.total_count === 0 ? 0 : null) : Math.ceil(payload.total_count / pageSize),
    estimatedRowRequests: pageSize === 0 ? (payload.total_count === 0 ? 0 : null) : Math.ceil(payload.total_count / pageSize),
    appIdsVerified,
    validIdentifiers,
    marketHashNamesAvailable,
    identifiersUnique: duplicateIds === 0,
    duplicateIds,
    sampleIds: identifierSamples,
    sampleMarketHashNames: marketHashNameSamples,
    usdPricesVerified: validPrices,
    usdPriceValidationRate: pageSize === 0 ? null : validPrices / pageSize,
    samplePrices: priceSamples,
    sellOrderCountsAvailable: validSellOrderCounts,
    imagesAvailable: imagesPresent,
  };
}

export async function inspectTbhStructuredMarket({ live = false, fetchImpl = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  statePath = DEFAULT_COLLECTION_STATE_PATH, now = () => new Date(), policy = DEFAULT_REQUEST_POLICY } = {}) {
  let payload;
  let httpStatus = null;
  let contentType = null;
  let retryAfter = null;
  let responseMs = null;
  let requestsMade = 0;

  if (live) {
    const controller = createSteamRequestController({ fetchImpl, pause, now, statePath,
      policy: { ...policy, maxRequestsPerRun: 1 } });
    const result = await controller.request(tbhStructuredSearchUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://steamcommunity.com' },
      body: JSON.stringify(tbhStructuredSearchBody()),
    });
    requestsMade = controller.requestsMade;
    responseMs = result.durationMs;
    httpStatus = result.response.status;
    contentType = result.response.headers?.get?.('Content-Type') ?? null;
    retryAfter = result.response.headers?.get?.('Retry-After') ?? null;
    if (httpStatus === 403 || httpStatus === 429) {
      throw new Error(`Steam collection stopped: ${JSON.stringify({ httpStatus, contentType, responseMs, retryAfter, requestsMade })}`);
    }
    if (!result.response.ok) {
      throw new Error(`Steam structured search failed: ${JSON.stringify({ httpStatus, contentType, responseMs, retryAfter, requestsMade })}`);
    }
    if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(contentType ?? '')) {
      await controller.stop('non-json');
      throw new Error(`Steam structured search returned non-JSON Content-Type (${contentType ?? 'missing'}); stopped`);
    }
    try {
      payload = await result.response.json();
      if (payload === null) {
        await controller.stop('invalid-response');
        throw new Error('Steam structured search returned literal null; stopped');
      }
      inspectStructuredSearch(payload);
    } catch (error) {
      if (error.message?.includes('literal null')) throw error;
      await controller.stop('invalid-response');
      throw new Error(`Steam structured search response was incomplete; stopped: ${error.message}`, { cause: error });
    }
  } else {
    payload = JSON.parse(await readFile(NEW_SEARCH_FIXTURE_PATH, 'utf8'));
  }

  return {
    source: live ? 'Steam Community Market' : 'fixture',
    appid: TBH_APPID,
    httpStatus,
    contentType,
    responseMs,
    retryAfter,
    requestsMade,
    ...inspectStructuredSearch(payload),
  };
}

export async function inspectTbhMarket({ live = false, fetchImpl = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  statePath = DEFAULT_COLLECTION_STATE_PATH, now = () => new Date(), policy = DEFAULT_REQUEST_POLICY } = {}) {
  let body;
  let httpStatus = null;
  let retryAfter = null;
  let responseMs = null;
  let requestCount = 0;

  if (live) {
    const controller = createSteamRequestController({ fetchImpl, pause, now, statePath,
      policy: { ...policy, maxRequestsPerRun: 1 } });
    const result = await controller.request(tbhSearchUrl());
    requestCount = controller.requestsMade;
    responseMs = result.durationMs;
    httpStatus = result.response.status;
    retryAfter = result.response.headers?.get?.('Retry-After') ?? null;
    if (httpStatus === 403 || httpStatus === 429) {
      throw new Error(`Steam collection stopped on HTTP ${httpStatus}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`);
    }
    if (!result.response.ok) throw new Error(`Steam HTTP ${httpStatus}`);
    try {
      body = await result.response.json();
    } catch (error) {
      await controller.stop('non-json');
      throw new Error('Steam returned non-JSON or CAPTCHA content; stopped', { cause: error });
    }
  } else {
    body = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
  }

  const page = parsePage(body, 0);
  let validPrices = 0;
  let images = 0;
  let listingCounts = 0;
  for (const raw of page.results) {
    try {
      const item = normalizeResult(raw, 'USD', TBH_APPID);
      if (item.priceMinor !== null) validPrices += 1;
      if (item.imageUrl !== null) images += 1;
      if (item.listings !== null) listingCounts += 1;
    } catch {
      // Invalid rows count as failures; the probe deliberately omits their identifiers and bodies.
    }
  }
  const returned = page.results.length;
  return {
    source: live ? 'Steam Community Market' : 'fixture',
    appid: TBH_APPID,
    httpStatus,
    retryAfter,
    responseMs,
    totalCount: page.total_count,
    requestedPageSize: 100,
    responsePageSize: page.pagesize ?? null,
    returned,
    usdPriceVerified: validPrices,
    usdPriceValidationRate: returned === 0 ? null : validPrices / returned,
    imagesAvailable: images,
    listingsAvailable: listingCounts,
    estimatedFullCollectionRequests: returned === 0 ? (page.total_count === 0 ? 0 : null) : Math.ceil(page.total_count / returned),
    requestsMade: requestCount,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const target = args.find(arg => arg.startsWith('--target='))?.slice('--target='.length);
  const api = args.find(arg => arg.startsWith('--api='))?.slice('--api='.length) ?? 'legacy';
  const live = args.includes('--live');
  if (target !== 'tbh' || !['legacy', 'new'].includes(api)
      || args.some(arg => !['--live', '--target=tbh', '--api=legacy', '--api=new'].includes(arg))) {
    throw new Error('Usage: npm run market:probe -- --target=tbh [--api=legacy|new] [--live]');
  }
  const options = { live, policy: live ? requestPolicyFromEnv() : DEFAULT_REQUEST_POLICY };
  const result = api === 'new' ? await inspectTbhStructuredMarket(options) : await inspectTbhMarket(options);
  console.info(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error('TBH market probe stopped:', error.message); process.exitCode = 1; });
}
