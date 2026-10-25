import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_COLLECTION_STATE_PATH,
  DEFAULT_REQUEST_POLICY,
  TBH_APPID,
  createSteamRequestController,
  normalizeResult,
  parsePage,
  requestPolicyFromEnv,
} from './steam-market.mjs';

const FIXTURE_PATH = new URL('../tests/fixtures/tbh-search-page.json', import.meta.url);

export function tbhSearchUrl() {
  const url = new URL('https://steamcommunity.com/market/search/render/');
  for (const [key, value] of Object.entries({ appid: TBH_APPID, norender: 1, count: 100, start: 0, currency: 1, country: 'US' })) {
    url.searchParams.set(key, String(value));
  }
  return url.href;
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
  const live = args.includes('--live');
  if (target !== 'tbh' || args.some(arg => !['--live', '--target=tbh'].includes(arg))) {
    throw new Error('Usage: npm run market:probe -- --target=tbh [--live]');
  }
  const result = await inspectTbhMarket({ live, policy: live ? requestPolicyFromEnv() : DEFAULT_REQUEST_POLICY });
  console.info(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error('TBH market probe stopped:', error.message); process.exitCode = 1; });
}
