import { APPID, DEFAULT_REQUEST_POLICY, TBH_APPID, createSteamRequestController } from './steam-market.mjs';

const MARKET_ACTIONS_URL = 'https://steamcommunity.com/market/actions';
const USD_CURRENCY_ID = 1;
const QUERY_ACTION = 'Search';
const REQUEST_SCOPE = 'tbh-query-action-probe';

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

export function parseQueryActionPage(payload, { expectedStart, expectedAppId = TBH_APPID } = {}) {
  const data = payload?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)
      || !isSafeInteger(expectedStart) || ![TBH_APPID, APPID].includes(expectedAppId)
      || data.grouping !== 1 || !isSafeInteger(data.start) || data.start !== expectedStart
      || !isSafeInteger(data.total_count) || data.total_count < data.start || !Array.isArray(data.results)
      || data.results.length > 100
      || data.results.length > Math.max(0, data.total_count - data.start)
      || (data.total_count > data.start && data.results.length === 0)) {
    throw new Error('queryAction response envelope or page position is invalid');
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
    if (row.eCurrency !== USD_CURRENCY_ID) throw new Error('queryAction response currency is not USD');
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
      minSellSubtotalText: row.strMinSellSubtotal,
      minSellSubtotalMinor: subtotalMinor,
      priceBasis: 'min-sell-subtotal-unverified-fees',
      listings: row.cSellOrders,
      imageUrl,
      steamUrl: `https://steamcommunity.com/market/listings/${expectedAppId}/${encodeURIComponent(asset.market_hash_name)}`,
    };
  });

  return {
    start: data.start,
    totalCount: data.total_count,
    grouping: data.grouping,
    pageSize: items.length,
    items,
  };
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
  maxPages = DEFAULT_REQUEST_POLICY.maxRequestsPerRun, requestCurrencyId = 8,
  fetchImpl = fetch, pause, policy = DEFAULT_REQUEST_POLICY, statePath, now } = {}) {
  if (!policy || !Number.isSafeInteger(policy.maxRequestsPerRun) || maxPages > policy.maxRequestsPerRun) {
    throw new Error('queryAction page limit exceeds the request policy');
  }
  const requestController = createSteamRequestController({ fetchImpl, pause, policy, statePath, now });
  return collectQueryActionPages({ appid, start, maxPages, fetchPage: offset => requestQueryActionPage({
    appid, start: offset, requestCurrencyId, requestController, rawPayload: true,
  }) });
}

export async function requestQueryActionPage({ appid = TBH_APPID, start = 0, requestCurrencyId = 8, requestController,
  fetchImpl = fetch, rawPayload = false } = {}) {
  const controller = requestController ?? createSteamRequestController({ fetchImpl });
  const url = buildQueryActionUrl({ appid, start, requestCurrencyId });
  const { response } = await controller.request(url, { method: 'GET', headers: queryActionHeaders() }, {
    scope: REQUEST_SCOPE,
    endpoint: `GET /market/actions?q=Search&appid=${appid}&start=${start}`,
  });
  if (response.status === 403 || response.status === 429) throw new Error(`Steam access stopped after HTTP ${response.status}`);
  if (!response.ok) throw new Error(`queryAction returned HTTP ${response.status}`);
  const contentType = safeHeader(response, 'Content-Type') ?? '';
  if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(contentType)) {
    await controller.stop('non-json', { scope: REQUEST_SCOPE,
      endpoint: `GET /market/actions?q=Search&appid=${appid}&start=${start}`, httpStatus: response.status,
      contentType, diagnosticMessage: 'queryAction response was not JSON; response body omitted.' });
    throw new Error('queryAction returned non-JSON content; stopped');
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    await controller.stop('invalid-response', { scope: REQUEST_SCOPE,
      endpoint: `GET /market/actions?q=Search&appid=${appid}&start=${start}`, httpStatus: response.status,
      contentType, diagnosticMessage: 'queryAction response was invalid JSON; response body omitted.' });
    throw new Error('queryAction returned invalid JSON; stopped', { cause: error });
  }
  let page;
  try {
    page = parseQueryActionPage(payload, { expectedStart: start, expectedAppId: appid });
  } catch (error) {
    await controller.stop('invalid-response', { scope: REQUEST_SCOPE,
      endpoint: `GET /market/actions?q=Search&appid=${appid}&start=${start}`, httpStatus: response.status,
      contentType, diagnosticMessage: 'queryAction response failed grouped USD validation; body omitted.' });
    throw new Error('queryAction grouped response failed validation; stopped', { cause: error });
  }
  return rawPayload ? payload : page;
}
