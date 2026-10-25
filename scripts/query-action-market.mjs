import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { APPID, CURRENCIES, DEFAULT_COLLECTION_STATE_PATH, DEFAULT_REQUEST_POLICY,
  TBH_APPID, createSteamRequestController, requestPolicyFromEnv, saveFilesAtomically } from './steam-market.mjs';

const MARKET_ACTIONS_URL = 'https://steamcommunity.com/market/actions';
const QUERY_ACTION = 'Search';
const SOURCE = 'Steam Community Market queryAction';
const PRICE_BASIS = 'min-sell-subtotal-unverified-fees';

export class QueryActionCurrencyMismatchError extends Error {
  constructor(requestCurrencyId, responseCurrencyIds, message = 'queryAction request and response currencies do not match') {
    super(message);
    this.name = 'QueryActionCurrencyMismatchError';
    this.requestCurrencyId = requestCurrencyId;
    this.responseCurrencyIds = responseCurrencyIds;
  }
}

function requestScope(appid) { return appid === APPID ? 'production' : 'tbh-query-action-probe'; }

function requireLivePermission({ live, fetchImpl, statePathWasProvided, testOnlyTransport }) {
  // Tests may inject a fake transport and an explicit temporary/null state path. Every default
  // transport path requires both the explicit live switch and the repository's existing approval gate.
  const injectedTestTransport = testOnlyTransport === true && fetchImpl !== fetch && statePathWasProvided;
  if (!injectedTestTransport && (live !== true || process.env.STEAM_MARKET_COLLECTION_ALLOWED !== 'true')) {
    throw new Error('Live queryAction collection requires --live and STEAM_MARKET_COLLECTION_ALLOWED=true');
  }
}

function safeHeader(response, name) {
  const value = response.headers?.get?.(name);
  return typeof value === 'string' ? value.replace(/[\r\n\t]/g, ' ').slice(0, 120) || null : null;
}

function isSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function parseUsdSubtotal(text) {
  if (typeof text !== 'string') return null;
  // This is intentionally separate from legacy sell_price parsing. The response labels this
  // value as a subtotal, and fee inclusion has not been reconciled with the existing history.
  const match = /^\$(0|[1-9]\d{0,2}(?:,\d{3})*|[1-9]\d*)\.(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const minor = Number(match[1].replaceAll(',', '')) * 100 + Number(match[2]);
  return Number.isSafeInteger(minor) ? minor : null;
}

function imageUrlForIcon(iconUrl) {
  if (typeof iconUrl !== 'string' || !/^[A-Za-z0-9_-]+$/.test(iconUrl)) return null;
  return `https://community.cloudflare.steamstatic.com/economy/image/${iconUrl}`;
}

export function buildQueryActionUrl({ appid = TBH_APPID, start = 0, sort = 3, direction = 1, requestCurrencyId = 8 } = {}) {
  if (![TBH_APPID, APPID].includes(appid) || !isSafeInteger(start)
      || ![0, 1, 2, 3, 4].includes(sort) || ![1, 2].includes(direction)
      || ![1, 8].includes(requestCurrencyId)) {
    throw new Error('Invalid queryAction search options');
  }
  const qp = [{
    appid,
    filters: {},
    // The browser capture supplied by the user used 8, while the separately supplied response
    // rows say 1 (USD). Keep request and response currency validation deliberately independent.
    price: { eCurrency: requestCurrencyId },
    accessoryFilters: {},
    sort,
    direction,
    start,
  }];
  const url = new URL(MARKET_ACTIONS_URL);
  url.searchParams.set('q', QUERY_ACTION);
  url.searchParams.set('qp', JSON.stringify(qp));
  return url.href;
}

export function queryActionHeaders() {
  return { Accept: 'application/json', 'x-valve-request-type': 'queryAction' };
}

export function parseQueryActionPage(payload, { expectedStart, expectedAppId = TBH_APPID, requestCurrencyId = null } = {}) {
  const data = payload?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || !isSafeInteger(expectedStart) || ![TBH_APPID, APPID].includes(expectedAppId)
      || !(requestCurrencyId === null || [1, 8].includes(requestCurrencyId))
      || data.grouping !== 1 || !isSafeInteger(data.start) || data.start !== expectedStart
      || !isSafeInteger(data.total_count) || data.total_count < data.start || !Array.isArray(data.results)
      || data.results.length > 100
      || data.results.length > Math.max(0, data.total_count - data.start)
      || (data.total_count > data.start && data.results.length === 0)) {
    throw new Error('queryAction response envelope or page position is invalid');
  }

  const responseCurrencyIds = [...new Set(data.results.map(row => Number.isSafeInteger(row?.eCurrency) ? row.eCurrency : null))];
  if (responseCurrencyIds.length > 1 || (data.results.length > 0 && responseCurrencyIds[0] !== CURRENCIES.USD.code)) {
    throw new QueryActionCurrencyMismatchError(requestCurrencyId, responseCurrencyIds,
      `queryAction response currency mismatch: requested ${requestCurrencyId ?? 'unspecified'}, received ${responseCurrencyIds.join(',') || 'missing'}`);
  }

  const strHashes = new Set();
  const marketHashNames = new Set();
  const items = data.results.map(row => {
    const asset = row?.asset_description;
    if (!row || typeof row !== 'object' || typeof row.strHash !== 'string' || !row.strHash.trim()
        || !asset || typeof asset !== 'object' || asset.appid !== expectedAppId
        || typeof asset.market_hash_name !== 'string' || !asset.market_hash_name.trim()) {
      throw new Error('queryAction item identifier or AppID is invalid');
    }
    if (strHashes.has(row.strHash) || marketHashNames.has(asset.market_hash_name)) {
      throw new Error('queryAction page contains duplicate product identifiers');
    }
    strHashes.add(row.strHash);
    marketHashNames.add(asset.market_hash_name);
    if (!isSafeInteger(row.cSellOrders)) throw new Error('queryAction sell-order count is invalid');
    const subtotalMinor = parseUsdSubtotal(row.strMinSellSubtotal);
    if (subtotalMinor === null) throw new Error('queryAction USD subtotal format is invalid');
    const imageUrl = imageUrlForIcon(asset.icon_url);
    if (typeof asset.icon_url !== 'string' || imageUrl === null) throw new Error('queryAction image identifier is invalid');

    return {
      strHash: row.strHash,
      marketHashName: asset.market_hash_name,
      name: typeof asset.name === 'string' && asset.name.trim() ? asset.name : asset.market_hash_name,
      appid: expectedAppId,
      currency: 'USD',
      responseCurrencyId: row.eCurrency,
      minSellSubtotalText: row.strMinSellSubtotal,
      minSellSubtotalMinor: subtotalMinor,
      priceBasis: 'min-sell-subtotal-unverified-fees',
      listings: row.cSellOrders,
      iconId: asset.icon_url,
      imageUrl,
      steamUrl: `https://steamcommunity.com/market/listings/${expectedAppId}/${encodeURIComponent(asset.market_hash_name)}`,
    };
  });

  return {
    start: data.start,
    totalCount: data.total_count,
    grouping: data.grouping,
    pageSize: items.length,
    requestCurrencyId,
    responseCurrencyId: responseCurrencyIds.length === 1 ? responseCurrencyIds[0] : null,
    requestResponseCurrencyMatch: requestCurrencyId === null || responseCurrencyIds.length === 0
      ? null : responseCurrencyIds.length === 1 && requestCurrencyId === responseCurrencyIds[0],
    items,
  };
}

export function queryActionObservationStorePath(appid) {
  if (![TBH_APPID, APPID].includes(appid)) throw new Error('Unsupported queryAction observation AppID');
  return new URL(`../.market/query-action-observations-${appid}.json`, import.meta.url);
}

function validUtcTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validateObservationStore(store) {
  if (!store || store.schemaVersion !== 1 || ![TBH_APPID, APPID].includes(store.appid)
      || store.source !== SOURCE || store.currency !== 'USD' || store.priceBasis !== PRICE_BASIS
      || !Array.isArray(store.products) || !Array.isArray(store.completedRuns) || !store.progress) {
    throw new Error('Invalid queryAction observation store');
  }
  const products = new Set();
  for (const product of store.products) {
    if (!product || product.appid !== store.appid || product.currency !== 'USD' || product.source !== SOURCE
        || product.priceBasis !== PRICE_BASIS || typeof product.marketHashName !== 'string'
        || !product.marketHashName.trim() || products.has(product.marketHashName)
        || !Array.isArray(product.observations) || product.observations.length === 0) {
      throw new Error('Invalid or duplicate queryAction product observation');
    }
    products.add(product.marketHashName);
    let previous = -Infinity;
    for (const observation of product.observations) {
      const observedMs = Date.parse(observation?.observedAt);
      if (!validUtcTimestamp(observation?.observedAt) || observedMs <= previous
          || ![1, 8].includes(observation.requestCurrencyId) || observation.responseCurrencyId !== 1
          || observation.requestCurrencyId !== observation.responseCurrencyId
          || !Number.isSafeInteger(observation.minSellSubtotalMinor) || observation.minSellSubtotalMinor < 0
          || parseUsdSubtotal(observation.minSellSubtotalText) !== observation.minSellSubtotalMinor
          || !isSafeInteger(observation.listings) || typeof observation.strHash !== 'string' || !observation.strHash.trim()) {
        throw new Error('Invalid or unordered queryAction observation point');
      }
      previous = observedMs;
    }
    if (product.lastObservedAt !== product.observations.at(-1).observedAt) {
      throw new Error('queryAction product lastObservedAt does not match its observations');
    }
    const image = product.imageUrl === null ? null : imageUrlForIcon(product.iconId);
    if ((image === null) !== (product.imageUrl === null)
        || (image !== null && image !== product.imageUrl)
        || product.steamUrl !== `https://steamcommunity.com/market/listings/${store.appid}/${encodeURIComponent(product.marketHashName)}`) {
      throw new Error('Invalid queryAction product image or Steam URL');
    }
  }
  const progress = store.progress;
  if (!['idle', 'partial', 'restart-required', 'count-reached-unverified'].includes(progress.status)
      || !(progress.runId === null || typeof progress.runId === 'string')
      || !(progress.startedAt === null || validUtcTimestamp(progress.startedAt))
      || !(progress.reportedTotalCount === null || isSafeInteger(progress.reportedTotalCount))
      || !isSafeInteger(progress.nextStart) || !isSafeInteger(progress.pagesFetched)
      || !(progress.requestCurrencyId === null || [1, 8].includes(progress.requestCurrencyId))
      || !Array.isArray(progress.seenMarketHashNames)
      || new Set(progress.seenMarketHashNames).size !== progress.seenMarketHashNames.length
      || progress.orderingRisk !== true || progress.catalogComplete !== false) {
    throw new Error('Invalid queryAction collection progress');
  }
  return store;
}

export function createEmptyQueryActionObservationStore(appid) {
  if (![TBH_APPID, APPID].includes(appid)) throw new Error('Unsupported queryAction observation AppID');
  return validateObservationStore({
    schemaVersion: 1,
    appid,
    source: SOURCE,
    currency: 'USD',
    priceBasis: PRICE_BASIS,
    products: [],
    completedRuns: [],
    progress: {
      status: 'idle', runId: null, startedAt: null, requestCurrencyId: null,
      reportedTotalCount: null, nextStart: 0, pagesFetched: 0, seenMarketHashNames: [],
      orderingRisk: true, catalogComplete: false,
    },
  });
}

export async function loadQueryActionObservationStore(path, appid) {
  try {
    const store = validateObservationStore(JSON.parse(await readFile(path, 'utf8')));
    if (store.appid !== appid) throw new Error('queryAction observation store AppID does not match its requested target');
    return store;
  } catch (error) {
    if (error.code === 'ENOENT') return createEmptyQueryActionObservationStore(appid);
    throw new Error('Could not validate queryAction observation store; refusing to overwrite it', { cause: error });
  }
}

async function saveQueryActionObservationStore(path, store) {
  validateObservationStore(store);
  await saveFilesAtomically([{ path, content: `${JSON.stringify(store, null, 2)}\n` }]);
}

function archiveCurrentRun(store, finishedAt) {
  const current = store.progress;
  if (current.status !== 'idle') {
    store.completedRuns.push({
      runId: current.runId,
      startedAt: current.startedAt,
      finishedAt,
      status: current.status,
      requestCurrencyId: current.requestCurrencyId,
      reportedTotalCount: current.reportedTotalCount,
      pagesFetched: current.pagesFetched,
      distinctProductsObserved: current.seenMarketHashNames.length,
      catalogComplete: false,
    });
    store.completedRuns = store.completedRuns.slice(-30);
  }
}

function startCollectionRun(store, requestCurrencyId, now) {
  const startedAt = now().toISOString();
  archiveCurrentRun(store, startedAt);
  store.progress = {
    status: 'partial',
    runId: randomUUID(),
    startedAt,
    requestCurrencyId,
    reportedTotalCount: null,
    nextStart: 0,
    pagesFetched: 0,
    seenMarketHashNames: [],
    orderingRisk: true,
    catalogComplete: false,
  };
}

function sameObservation(left, right) {
  return left.strHash === right.strHash
    && left.requestCurrencyId === right.requestCurrencyId
    && left.responseCurrencyId === right.responseCurrencyId
    && left.minSellSubtotalText === right.minSellSubtotalText
    && left.minSellSubtotalMinor === right.minSellSubtotalMinor
    && left.listings === right.listings;
}

function recordPageObservations(store, page, observedAt, requestCurrencyId) {
  const productsByName = new Map(store.products.map(product => [product.marketHashName, product]));
  const seen = new Set(store.progress.seenMarketHashNames);
  let overlap = false;
  for (const item of page.items) {
    if (seen.has(item.marketHashName)) overlap = true;
    seen.add(item.marketHashName);
    const observation = {
      observedAt,
      strHash: item.strHash,
      requestCurrencyId,
      responseCurrencyId: page.responseCurrencyId,
      minSellSubtotalText: item.minSellSubtotalText,
      minSellSubtotalMinor: item.minSellSubtotalMinor,
      listings: item.listings,
    };
    let product = productsByName.get(item.marketHashName);
    if (!product) {
      product = {
        marketHashName: item.marketHashName,
        name: item.name,
        appid: item.appid,
        currency: 'USD',
        source: SOURCE,
        priceBasis: PRICE_BASIS,
        iconId: item.iconId,
        imageUrl: item.imageUrl,
        steamUrl: item.steamUrl,
        lastObservedAt: observedAt,
        observations: [],
      };
      productsByName.set(item.marketHashName, product);
    }
    const latest = product.observations.at(-1);
    if (latest?.observedAt === observedAt) {
      if (!sameObservation(latest, observation)) throw new Error('Conflicting queryAction observations at the same timestamp');
      continue;
    }
    if (latest && Date.parse(observedAt) < Date.parse(latest.observedAt)) {
      throw new Error('queryAction observation clock moved backward; existing observations preserved');
    }
    product.name = item.name;
    product.appid = item.appid;
    product.iconId = item.iconId;
    product.imageUrl = item.imageUrl;
    product.steamUrl = item.steamUrl;
    product.lastObservedAt = observedAt;
    product.observations.push(observation);
  }
  store.products = [...productsByName.values()].sort((a, b) => a.marketHashName.localeCompare(b.marketHashName));
  store.progress.seenMarketHashNames = [...seen].sort();
  return overlap;
}

// A page is committed to a private validation store before the next request. The public USD snapshot
// and legacy price history are deliberately not involved while subtotal/fee semantics remain unresolved.
export async function collectAndPersistQueryActionBatch({ fetchPage, appid = TBH_APPID, requestCurrencyId,
  maxPages = DEFAULT_REQUEST_POLICY.maxRequestsPerRun, storePath = queryActionObservationStorePath(appid),
  now = () => new Date(), restart = false } = {}) {
  if (typeof fetchPage !== 'function' || ![TBH_APPID, APPID].includes(appid)
      || ![1, 8].includes(requestCurrencyId) || !Number.isSafeInteger(maxPages) || maxPages < 1
      || maxPages > DEFAULT_REQUEST_POLICY.maxRequestsPerRun) {
    throw new Error('Invalid queryAction persisted collection options');
  }
  const store = await loadQueryActionObservationStore(storePath, appid);
  if (store.progress.status === 'restart-required' && !restart) {
    throw new Error('queryAction paging detected a moving catalog; review the saved observations and pass restart explicitly');
  }
  if (store.progress.status === 'partial' && !restart) {
    if (store.progress.requestCurrencyId !== requestCurrencyId) {
      throw new Error('Cannot resume a queryAction run with a different request currency; restart it explicitly');
    }
  } else {
    startCollectionRun(store, requestCurrencyId, now);
    await saveQueryActionObservationStore(storePath, store);
  }

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const progress = store.progress;
    if (progress.reportedTotalCount !== null && progress.nextStart >= progress.reportedTotalCount) {
      progress.status = 'count-reached-unverified';
      progress.catalogComplete = false;
      await saveQueryActionObservationStore(storePath, store);
      break;
    }
    const payload = await fetchPage(progress.nextStart);
    const page = parseQueryActionPage(payload, { expectedStart: progress.nextStart,
      expectedAppId: appid, requestCurrencyId });
    if (page.pageSize > 0 && (page.responseCurrencyId !== CURRENCIES.USD.code || page.requestResponseCurrencyMatch !== true)) {
      throw new QueryActionCurrencyMismatchError(requestCurrencyId,
        page.responseCurrencyId === null ? [] : [page.responseCurrencyId]);
    }
    if (page.pageSize === 0 && (page.totalCount !== 0 || page.start !== 0)) {
      throw new Error('Empty queryAction pages cannot verify a non-empty market');
    }

    const observedAt = now().toISOString();
    const totalChanged = progress.reportedTotalCount !== null && page.totalCount !== progress.reportedTotalCount;
    if (progress.reportedTotalCount === null) progress.reportedTotalCount = page.totalCount;
    const overlap = recordPageObservations(store, page, observedAt, requestCurrencyId);
    progress.pagesFetched += 1;
    progress.nextStart = page.start + page.pageSize;
    if (totalChanged || overlap) {
      progress.status = 'restart-required';
      progress.restartReason = totalChanged ? 'total-count-changed' : 'overlapping-page-order';
    } else if (progress.nextStart >= progress.reportedTotalCount) {
      progress.status = 'count-reached-unverified';
      progress.catalogComplete = false;
    }
    await saveQueryActionObservationStore(storePath, store);
    if (progress.status !== 'partial') break;
  }
  return validateObservationStore(store);
}

// This helper can resume from a saved offset, but it never persists or publishes partial results.
// Offset paging over a changing popularity/price order is not proof of a coherent full snapshot.
export async function collectQueryActionPages({ fetchPage, appid = TBH_APPID, start = 0,
  maxPages = DEFAULT_REQUEST_POLICY.maxRequestsPerRun } = {}) {
  if (typeof fetchPage !== 'function' || ![TBH_APPID, APPID].includes(appid)
      || !isSafeInteger(start) || !Number.isSafeInteger(maxPages) || maxPages < 1
      || maxPages > DEFAULT_REQUEST_POLICY.maxRequestsPerRun) {
    throw new Error('Invalid queryAction collection options');
  }
  let offset = start;
  let totalCount = null;
  const items = [];
  const strHashes = new Set();
  const marketHashNames = new Set();
  const pages = [];

  while (pages.length < maxPages && (totalCount === null || offset < totalCount)) {
    const page = parseQueryActionPage(await fetchPage(offset), { expectedStart: offset, expectedAppId: appid });
    if (totalCount !== null && page.totalCount !== totalCount) throw new Error('queryAction total_count changed during collection');
    totalCount ??= page.totalCount;
    if (page.pageSize === 0) break;
    for (const item of page.items) {
      if (strHashes.has(item.strHash) || marketHashNames.has(item.marketHashName)) {
        throw new Error('queryAction collection encountered a duplicate across pages');
      }
      strHashes.add(item.strHash);
      marketHashNames.add(item.marketHashName);
      items.push(item);
    }
    pages.push({ start: page.start, returned: page.pageSize });
    offset += page.pageSize;
  }

  return {
    appid,
    currency: 'USD',
    totalCount: totalCount ?? 0,
    items,
    pages,
    nextStart: offset,
    reportedCountMatched: totalCount !== null && items.length === totalCount,
    snapshotConsistency: 'not-atomic',
  };
}

export async function collectLiveQueryActionPages({ appid = TBH_APPID, start = 0,
  maxPages = DEFAULT_REQUEST_POLICY.maxRequestsPerRun, requestCurrencyId,
  fetchImpl = fetch, pause, policy = DEFAULT_REQUEST_POLICY, statePath: requestedStatePath, storePath, now,
  live = false, restart = false, testOnlyTransport = false } = {}) {
  if (!policy || !Number.isSafeInteger(policy.maxRequestsPerRun) || maxPages > policy.maxRequestsPerRun) {
    throw new Error('queryAction page limit exceeds the request policy');
  }
  requireLivePermission({ live, fetchImpl, statePathWasProvided: requestedStatePath !== undefined, testOnlyTransport });
  const statePath = requestedStatePath === undefined ? DEFAULT_COLLECTION_STATE_PATH : requestedStatePath;
  if (![1, 8].includes(requestCurrencyId)) throw new Error('Pass --request-currency-id explicitly (1 for USD or 8 for JPY)');
  const requestController = createSteamRequestController({ fetchImpl, pause, policy, statePath, now });
  if (start !== 0) throw new Error('Persistent queryAction progress selects its own resume offset; use --restart to start at zero');
  return collectAndPersistQueryActionBatch({ appid, maxPages, requestCurrencyId,
    storePath: storePath ?? queryActionObservationStorePath(appid), now, restart,
    fetchPage: offset => requestQueryActionPage({
      appid, start: offset, requestCurrencyId, requestController, fetchImpl, rawPayload: true, live: true, statePath, testOnlyTransport,
    }) });
}

export async function requestQueryActionPage({ appid = TBH_APPID, start = 0, requestCurrencyId, requestController,
  fetchImpl = fetch, rawPayload = false, live = false, statePath: requestedStatePath, testOnlyTransport = false } = {}) {
  requireLivePermission({ live, fetchImpl, statePathWasProvided: requestedStatePath !== undefined, testOnlyTransport });
  const statePath = requestedStatePath === undefined ? DEFAULT_COLLECTION_STATE_PATH : requestedStatePath;
  if (![1, 8].includes(requestCurrencyId)) throw new Error('Pass --request-currency-id explicitly (1 for USD or 8 for JPY)');
  const controller = requestController ?? createSteamRequestController({ fetchImpl, statePath });
  const scope = requestScope(appid);
  const endpoint = `GET /market/actions?q=Search&appid=${appid}&start=${start}`;
  const url = buildQueryActionUrl({ appid, start, requestCurrencyId });
  const { response } = await controller.request(url, { method: 'GET', headers: queryActionHeaders() }, {
    scope,
    endpoint,
  });
  if (response.status === 403 || response.status === 429) throw new Error(`Steam access stopped after HTTP ${response.status}`);
  if (!response.ok) throw new Error(`queryAction returned HTTP ${response.status}`);
  const contentType = safeHeader(response, 'Content-Type') ?? '';
  if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(contentType)) {
    await controller.stop('non-json', { scope,
      endpoint, httpStatus: response.status,
      contentType, diagnosticMessage: 'queryAction response was not JSON; response body omitted.' });
    throw new Error('queryAction returned non-JSON content; stopped');
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    await controller.stop('invalid-response', { scope,
      endpoint, httpStatus: response.status,
      contentType, diagnosticMessage: 'queryAction response was invalid JSON; response body omitted.' });
    throw new Error('queryAction returned invalid JSON; stopped', { cause: error });
  }
  let page;
  try {
    page = parseQueryActionPage(payload, { expectedStart: start, expectedAppId: appid, requestCurrencyId });
  } catch (error) {
    await controller.stop('invalid-response', { scope, endpoint, httpStatus: response.status, contentType,
      requestCurrencyId,
      responseCurrencyIds: error instanceof QueryActionCurrencyMismatchError ? error.responseCurrencyIds : null,
      diagnosticMessage: error instanceof QueryActionCurrencyMismatchError
        ? error.message : 'queryAction response failed grouped USD validation; body omitted.' });
    if (error instanceof QueryActionCurrencyMismatchError) throw error;
    throw new Error('queryAction grouped response failed validation; stopped', { cause: error });
  }
  if (page.requestResponseCurrencyMatch === false) {
    const mismatch = new QueryActionCurrencyMismatchError(requestCurrencyId, [page.responseCurrencyId]);
    await controller.stop('invalid-response', { scope, endpoint, httpStatus: response.status, contentType,
      requestCurrencyId, responseCurrencyIds: [page.responseCurrencyId], diagnosticMessage: mismatch.message });
    throw mismatch;
  }
  return rawPayload ? payload : page;
}
