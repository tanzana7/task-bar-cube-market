import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePriceMinor, normalizeResult, saveFilesAtomically } from './steam-market.mjs';
import { MAX_QUERY_OBSERVATIONS_PER_PRODUCT, parseQueryActionPage,
  validateQueryActionObservationStore } from './query-action-market.mjs';

export const TBC_APPID = 5084200;
export const PUBLIC_OBSERVATIONS_PATH = new URL('../public/market-observations.json', import.meta.url);
const MAX_QUERY_IMPORTS = 512;
const SOURCE_LABELS = {
  'search-render': 'Steam Community Market search/render response supplied by operator',
  'query-action': 'Steam Community Market queryAction response supplied by operator',
  'steam-dom': 'Steam Community Market visible DOM observation supplied by operator',
};

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function safeProvenance(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 240
    && !/[\r\n\0]/.test(value);
}

function canonicalTimestamp(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : value;
}

export function detectMarketImportFormat(payload) {
  if (payload?.source === 'Steam Community Market queryAction' && payload?.priceBasis === 'min-sell-subtotal-unverified-fees') return 'query-action-store';
  if (payload?.format === 'steam-market-dom') return 'steam-dom';
  if (payload?.data?.grouping === 1 && Array.isArray(payload.data.results)) return 'query-action';
  if (payload?.success === true && Array.isArray(payload.results) && Number.isSafeInteger(payload.total_count)) return 'search-render';
  throw new Error('Could not identify Steam search/render or queryAction response format');
}

function parseHarMarketRequest(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'steamcommunity.com') return null;
  const query = url.searchParams;
  if (url.pathname === '/market/search/render/') {
    const appid = Number(query.get('appid'));
    // HARs often contain unrelated Market traffic. Ignore it before looking at response bodies.
    if (appid !== TBC_APPID) return null;
    const startText = query.get('start');
    const currencyText = query.get('currency');
    return {
      format: 'search-render', appid,
      start: startText === null ? 0 : Number(startText),
      requestCurrencyId: currencyText === null ? null : Number(currencyText),
    };
  }
  if (url.pathname !== '/market/actions' || query.get('q') !== 'Search') return null;
  const qpText = query.get('qp');
  let params;
  try { params = JSON.parse(qpText ?? ''); } catch { return null; }
  if (!Array.isArray(params)) return null;
  const matching = params.filter(entry => entry?.appid === TBC_APPID);
  if (matching.length === 0) return null;
  if (matching.length !== 1) throw new Error('HAR contains multiple queryAction requests for the TBC AppID in one qp');
  const request = matching[0];
  return {
    format: 'query-action', appid: request.appid,
    start: request.start,
    requestCurrencyId: request.price?.eCurrency ?? null,
  };
}

function responseDocuments(value, inherited = {}) {
  if (Array.isArray(value)) return value.flatMap(entry => responseDocuments(entry, inherited));
  if (!value || typeof value !== 'object') throw new Error('Import JSON must contain an object response');
  if (value.source === 'Steam Community Market queryAction' && value.priceBasis === 'min-sell-subtotal-unverified-fees') {
    return [{ payload: value, observedAt: inherited.observedAt ?? null, provenance: inherited.provenance
      ?? 'Validated persisted queryAction observations', format: 'query-action-store' }];
  }
  if (value.log && Array.isArray(value.log.entries)) {
    return value.log.entries.flatMap(entry => {
      const request = parseHarMarketRequest(entry?.request?.url);
      const body = entry?.response?.content?.text;
      if (!request) return [];
      if (!Number.isSafeInteger(request.start) || request.start < 0
          || !(request.requestCurrencyId === null || [1, 8].includes(request.requestCurrencyId))) {
        throw new Error('Invalid TBC Steam Market request parameters in HAR');
      }
      const status = entry?.response?.status;
      if (!Number.isSafeInteger(status) || status < 200 || status >= 300) {
        throw new Error(`TBC Steam Market HAR response was not successful (HTTP ${Number.isSafeInteger(status) ? status : 'unknown'})`);
      }
      if (typeof body !== 'string') throw new Error('TBC Steam Market HAR response body is missing');
      try {
        const decoded = entry.response.content.encoding === 'base64'
          ? Buffer.from(body, 'base64').toString('utf8') : body;
        return responseDocuments(JSON.parse(decoded), {
          observedAt: canonicalTimestamp(entry.startedDateTime),
          provenance: 'Steam DevTools HAR response',
          format: request.format,
          request,
        });
      } catch (error) {
        throw new Error('Could not parse a Steam Market JSON response in HAR', { cause: error });
      }
    });
  }
  if (Array.isArray(value.responses)) {
    return value.responses.flatMap(entry => responseDocuments(entry, {
      observedAt: value.observedAt ?? value.capturedAt ?? inherited.observedAt,
      provenance: value.provenance ?? inherited.provenance,
    }));
  }
  const response = value.response ?? value.payload ?? value;
  // The exported DOM document uses a descriptive wire-format name; normalize it
  // to the importer discriminator while leaving the original payload untouched.
  const declaredFormat = value.format ?? inherited.format ?? null;
  return [{
    payload: response,
    observedAt: value.observedAt ?? value.capturedAt ?? inherited.observedAt ?? null,
    provenance: value.provenance ?? inherited.provenance ?? null,
    format: declaredFormat === 'steam-market-dom' ? 'steam-dom' : declaredFormat,
    request: value.request ?? inherited.request ?? null,
  }];
}

async function readInputDocuments(inputPaths) {
  const documents = [];
  for (const inputPath of inputPaths) {
    const fileInfo = await stat(inputPath);
    const files = fileInfo.isDirectory()
      ? (await readdir(inputPath, { withFileTypes: true }))
        .filter(entry => entry.isFile() && extname(entry.name).toLowerCase() === '.json')
        .map(entry => resolve(inputPath, entry.name)).sort()
      : [inputPath];
    if (fileInfo.isDirectory() && files.length === 0) throw new Error(`No JSON files found in ${inputPath}`);
    for (const file of files) {
      const value = JSON.parse(await readFile(file, 'utf8'));
      const parsed = responseDocuments(value);
      if (parsed.length === 0) throw new Error(`No Steam Market responses found in ${basename(file)}`);
      documents.push(...parsed);
    }
  }
  if (documents.length === 0) throw new Error('No input responses were found');
  return documents;
}

function parseSearchRender(payload, observedAt, request = null) {
  if (!payload || payload.success !== true || !Array.isArray(payload.results)
      || !Number.isSafeInteger(payload.total_count) || payload.total_count < 0) {
    throw new Error('Invalid search/render response envelope');
  }
  const start = payload.start === undefined ? 0 : payload.start;
  if (!Number.isSafeInteger(start) || start < 0 || start > payload.total_count
      || payload.results.length > payload.total_count - start
      || (payload.pagesize !== undefined && (!Number.isSafeInteger(payload.pagesize) || payload.pagesize < payload.results.length))) {
    throw new Error('Invalid search/render page metadata');
  }
  if (request && (request.format !== 'search-render' || request.appid !== TBC_APPID
      || request.start !== start || (request.requestCurrencyId !== null && request.requestCurrencyId !== 1))) {
    throw new Error('search/render request and response AppID, start, or USD currency do not match');
  }
  const seen = new Set();
  const products = payload.results.map(row => {
    if (row?.asset_description?.appid !== TBC_APPID) throw new Error('Import contains a non-TBC AppID');
    const item = normalizeResult(row, 'USD', TBC_APPID);
    if (seen.has(item.marketHashName)) throw new Error('Import contains duplicate market_hash_name values');
    seen.add(item.marketHashName);
    if (item.priceMinor !== null && parsePriceMinor(item.priceText, 'USD') !== item.priceMinor) {
      throw new Error('Imported USD price does not match its displayed text');
    }
    return {
      marketHashName: item.marketHashName,
      name: item.name,
      imageUrl: item.imageUrl,
      steamUrl: item.steamUrl,
      observations: [{
        observedAt,
        sourceKind: 'search-render',
        currency: 'USD',
        requestCurrencyId: request?.requestCurrencyId ?? null,
        responseCurrencyId: null,
        priceBasis: 'steam-search-render-sell-price',
        priceMinor: item.priceMinor,
        priceText: item.priceText,
        referencePriceText: null,
        listings: item.listings,
      }],
    };
  });
  return { start, totalCount: payload.total_count, pageSize: products.length, products,
    complete: start === 0 && products.length === payload.total_count };
}

function parseQueryAction(payload, observedAt, request = null) {
  const start = request?.start ?? payload?.data?.start;
  const requestCurrencyId = request?.requestCurrencyId ?? null;
  const page = parseQueryActionPage(payload, { expectedStart: start, expectedAppId: TBC_APPID, requestCurrencyId });
  if (request && (request.format !== 'query-action' || request.appid !== TBC_APPID)) {
    throw new Error('queryAction request and response AppID do not match');
  }
  if (requestCurrencyId !== null && page.requestResponseCurrencyMatch !== true) {
    throw new Error(`queryAction request currency ${requestCurrencyId} does not match response currency ${page.responseCurrencyId ?? 'missing'}`);
  }
  return {
    start: page.start, totalCount: page.totalCount, pageSize: page.pageSize, complete: page.start === 0 && page.pageSize === page.totalCount,
    products: page.items.map(item => ({
      marketHashName: item.marketHashName,
      name: item.name,
      imageUrl: item.imageUrl,
      steamUrl: item.steamUrl,
      observations: [{
        observedAt,
        sourceKind: 'query-action',
        currency: 'USD',
        requestCurrencyId,
        responseCurrencyId: page.responseCurrencyId,
        priceBasis: item.priceBasis,
        priceMinor: null,
        priceText: null,
        referencePriceText: item.minSellSubtotalText,
        listings: item.listings,
      }],
    })),
  };
}

function parseSteamDom(payload, observedAt) {
  if (!payload || payload.format !== 'steam-market-dom' || payload.appid !== TBC_APPID
      || payload.currency !== 'USD' || (payload.observedAt !== undefined && payload.observedAt !== observedAt)
      || !Number.isSafeInteger(payload.start) || payload.start < 0
      || !Number.isSafeInteger(payload.totalCount) || payload.totalCount < 0
      || !Array.isArray(payload.products) || payload.products.length === 0
      || payload.products.length > payload.totalCount - payload.start
      || payload.complete !== false) {
    throw new Error('Invalid or complete Steam rendered-DOM observation; DOM captures must be explicit partial observations');
  }
  const seen = new Set();
  const products = payload.products.map(row => {
    if (!row || row.currency !== 'USD' || typeof row.marketHashName !== 'string' || !row.marketHashName.trim()
        || typeof row.name !== 'string' || !row.name.trim()
        || row.listings !== null && (!Number.isSafeInteger(row.listings) || row.listings < 0)
        || (row.priceText !== null && (typeof row.priceText !== 'string' || !/^\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}～?$/.test(row.priceText)))) {
      throw new Error('Invalid rendered-DOM item name, USD reference price, or listing count');
    }
    const steamUrl = `https://steamcommunity.com/market/listings/${TBC_APPID}/${encodeURIComponent(row.marketHashName)}`;
    let parsedUrl;
    try { parsedUrl = new URL(row.steamUrl); } catch { throw new Error('Rendered-DOM item has an invalid Steam link'); }
    if (parsedUrl.href !== steamUrl) throw new Error('Rendered-DOM item link does not match its market_hash_name and AppID');
    if (row.name !== row.marketHashName) throw new Error('Rendered-DOM name must match the listing title in its Steam link');
    if (seen.has(row.marketHashName)) throw new Error('Rendered-DOM capture contains duplicate market_hash_name values');
    seen.add(row.marketHashName);
    if (row.imageUrl !== null && (typeof row.imageUrl !== 'string'
        || !/^https:\/\/(?:community|community\.cloudflare)\.steamstatic\.com\/economy\/image\/[A-Za-z0-9_/?=&%-]+$/.test(row.imageUrl))) {
      throw new Error('Rendered-DOM item has an invalid Steam image URL');
    }
    return {
      marketHashName: row.marketHashName,
      name: row.name,
      imageUrl: row.imageUrl,
      steamUrl,
      observations: [{
        observedAt,
        sourceKind: 'steam-dom',
        currency: 'USD',
        requestCurrencyId: null,
        responseCurrencyId: null,
        priceBasis: 'steam-market-rendered-ui-unverified-price',
        priceMinor: null,
        priceText: null,
        referencePriceText: row.priceText,
        listings: row.listings,
      }],
    };
  });
  return { start: payload.start, totalCount: payload.totalCount, pageSize: products.length, products, complete: false };
}

export function validateMarketObservations(value) {
  if (!value || value.schemaVersion !== 1 || value.appid !== TBC_APPID || value.currency !== 'USD'
      || !validTimestamp(value.generatedAt) || !Array.isArray(value.products) || !Array.isArray(value.imports)) {
    throw new Error('Invalid public market observations envelope');
  }
  const keys = new Set();
  for (const product of value.products) {
    if (!product || typeof product.marketHashName !== 'string' || !product.marketHashName.trim()
        || keys.has(product.marketHashName) || typeof product.name !== 'string' || !product.name.trim()
        || (product.imageUrl !== null && (!/^https:\/\/(?:community\.steamstatic\.com|community\.cloudflare\.steamstatic\.com)\/economy\/image\/[A-Za-z0-9_/?=&%-]+$/.test(product.imageUrl)))
        || product.steamUrl !== `https://steamcommunity.com/market/listings/${TBC_APPID}/${encodeURIComponent(product.marketHashName)}`
        || !Array.isArray(product.observations) || product.observations.length === 0) {
      throw new Error('Invalid or duplicate public product observation');
    }
    keys.add(product.marketHashName);
    let previous = -Infinity;
    for (const point of product.observations) {
      if (!point || typeof point !== 'object') throw new Error('Invalid public observation point');
      const time = Date.parse(point?.observedAt);
      const queryAction = point?.sourceKind === 'query-action';
      const steamDom = point?.sourceKind === 'steam-dom';
      if (!validTimestamp(point?.observedAt) || time <= previous || !['query-action', 'search-render', 'steam-dom'].includes(point.sourceKind)
          || point.currency !== 'USD' || !safeProvenance(point.provenance)
          || (queryAction && (!(point.requestCurrencyId === null || point.requestCurrencyId === 1) || point.responseCurrencyId !== 1
            || point.priceBasis !== 'min-sell-subtotal-unverified-fees' || point.priceMinor !== null
            || point.priceText !== null || parsePriceMinor(point.referencePriceText, 'USD') === null))
          || (steamDom && (point.requestCurrencyId !== null || point.responseCurrencyId !== null
            || point.priceBasis !== 'steam-market-rendered-ui-unverified-price' || point.priceMinor !== null
            || point.priceText !== null || (point.referencePriceText !== null && (typeof point.referencePriceText !== 'string'
            || !/^\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}～?$/.test(point.referencePriceText)))))
          || (!queryAction && (!(point.requestCurrencyId === null || point.requestCurrencyId === 1) || point.responseCurrencyId !== null
            || (!steamDom && point.priceBasis !== 'steam-search-render-sell-price')
            || (point.priceMinor === null) !== (point.priceText === null)
            || (point.priceMinor !== null && parsePriceMinor(point.priceText, 'USD') !== point.priceMinor)
            || (!steamDom && point.referencePriceText !== null)))
          || (point.listings !== null && (!Number.isSafeInteger(point.listings) || point.listings < 0))) {
        throw new Error('Invalid public observation point');
      }
      previous = time;
    }
  }
  for (const capture of value.imports) {
    if (!capture || !['query-action', 'search-render', 'steam-dom'].includes(capture.sourceKind) || !safeProvenance(capture.provenance)
        || !validTimestamp(capture.observedAt) || !Number.isSafeInteger(capture.start) || capture.start < 0
        || (capture.rightsConfirmed !== undefined && typeof capture.rightsConfirmed !== 'boolean')
        || !Number.isSafeInteger(capture.totalCount) || capture.totalCount < capture.start
        || !Number.isSafeInteger(capture.pageSize) || capture.pageSize < 0
        || capture.pageSize > capture.totalCount - capture.start
        || (capture.complete && !(capture.start === 0 && capture.pageSize === capture.totalCount))) {
      throw new Error('Invalid market import metadata');
    }
  }
  return value;
}

export function parseMarketImport({ payload, format = null, request = null, observedAt, provenance = null, rightsConfirmed = false, now = new Date() }) {
  format ??= detectMarketImportFormat(payload);
  if (format !== detectMarketImportFormat(payload)) throw new Error('The requested format does not match the response');
  if (!validTimestamp(observedAt)) throw new Error('observed-at must be a valid UTC ISO timestamp');
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf()) || Date.parse(observedAt) > now.valueOf() + 5 * 60_000) {
    throw new Error('observed-at cannot be in the future');
  }
  if (provenance === null) provenance = `${SOURCE_LABELS[format]}; supplied as operator input`;
  if (!safeProvenance(provenance)) throw new Error('provenance must be 1-240 characters without line breaks');
  if (typeof rightsConfirmed !== 'boolean') throw new Error('rightsConfirmed must be a boolean operator attestation');
  const capture = format === 'search-render' ? parseSearchRender(payload, observedAt, request)
    : format === 'steam-dom' ? parseSteamDom(payload, observedAt) : parseQueryAction(payload, observedAt, request);
  const products = capture.products.map(product => ({
    ...product,
    observations: product.observations.map(point => ({ ...point, provenance })),
  }));
  const snapshot = {
    schemaVersion: 1,
    appid: TBC_APPID,
    currency: 'USD',
    generatedAt: now.toISOString(),
    products,
    imports: [{ sourceKind: format, sourceLabel: SOURCE_LABELS[format], provenance, observedAt, rightsConfirmed,
      start: capture.start, totalCount: capture.totalCount, pageSize: capture.pageSize, complete: capture.complete }],
  };
  return validateMarketObservations(snapshot);
}

export function parseMarketImportBatch({ documents, observedAt = null, provenance = null, rightsConfirmed = false, now = new Date() }) {
  if (!Array.isArray(documents) || documents.length === 0) throw new Error('At least one Steam Market response is required');
  if (documents.length === 1 && (documents[0].format ?? detectMarketImportFormat(documents[0].payload)) === 'query-action-store') {
    return parseQueryActionStoreImport({ store: documents[0].payload,
      provenance: provenance ?? documents[0].provenance, rightsConfirmed, now });
  }
  let combined = null;
  for (const document of documents) {
    const pageObservedAt = document.observedAt ?? observedAt;
    if (!pageObservedAt) throw new Error('A reliable observation time is missing; provide --observed-at or use a HAR/wrapped JSON timestamp');
    const incoming = parseMarketImport({
      payload: document.payload,
      format: document.format ?? null,
      request: document.request ?? null,
      observedAt: pageObservedAt,
      provenance: document.provenance ?? provenance,
      rightsConfirmed: document.rightsConfirmed === true || rightsConfirmed === true,
      now,
    });
    combined = mergeMarketObservations(combined, incoming).snapshot;
  }
  return validateMarketObservations(combined);
}

function parseQueryActionStoreImport({ store, provenance, rightsConfirmed, now }) {
  validateQueryActionObservationStore(store);
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())
      || store.products.some(product => product.observations.some(point => Date.parse(point.observedAt) > now.valueOf() + 5 * 60_000))) {
    throw new Error('observed-at cannot be in the future');
  }
  if (store.appid !== TBC_APPID) throw new Error('Import contains a non-TBC AppID');
  if (!safeProvenance(provenance)) throw new Error('provenance must be 1-240 characters without line breaks');
  if (typeof rightsConfirmed !== 'boolean') throw new Error('rightsConfirmed must be a boolean operator attestation');
  if (!store.products.length) throw new Error('queryAction store contains no observed TBC products');

  const pageGroups = new Map();
  const products = store.products.map(product => ({
    marketHashName: product.marketHashName,
    name: product.name,
    imageUrl: product.imageUrl,
    steamUrl: product.steamUrl,
    observations: product.observations.map(point => {
      const key = `${point.observedAt}\0${point.pageStart}\0${point.totalCount}\0${point.pageSize}`;
      if (store.retentionCutoff === undefined || store.retentionCutoff === null
          || Date.parse(point.observedAt) >= Date.parse(store.retentionCutoff)) {
        pageGroups.set(key, (pageGroups.get(key) ?? 0) + 1);
      }
      return {
        observedAt: point.observedAt,
        sourceKind: 'query-action',
        currency: 'USD',
        requestCurrencyId: point.requestCurrencyId,
        responseCurrencyId: point.responseCurrencyId,
        priceBasis: 'min-sell-subtotal-unverified-fees',
        priceMinor: null,
        priceText: null,
        referencePriceText: point.minSellSubtotalText,
        listings: point.listings,
        provenance,
      };
    }),
  }));
  const imports = [...pageGroups.entries()].map(([key, pageSize]) => {
    const [timestamp, startText, totalText, expectedPageSizeText] = key.split('\0');
    const start = Number(startText);
    const totalCount = Number(totalText);
    if (pageSize !== Number(expectedPageSizeText)) throw new Error('Persisted queryAction page is missing observations');
    // The private collector does not prove a stable full-market snapshot. Keep every imported page partial.
    return { sourceKind: 'query-action', provenance, observedAt: timestamp, rightsConfirmed,
      start, totalCount, pageSize, complete: false };
  }).sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.start - b.start);
  return validateMarketObservations({ schemaVersion: 1, appid: TBC_APPID, currency: 'USD',
    generatedAt: now.toISOString(), products, imports });
}

export function mergeMarketObservations(previous, incoming) {
  const base = previous ? validateMarketObservations(previous) : {
    schemaVersion: 1, appid: TBC_APPID, currency: 'USD', generatedAt: incoming.generatedAt, products: [], imports: [],
  };
  validateMarketObservations(incoming);
  const productMap = new Map(base.products.map(product => [product.marketHashName, structuredClone(product)]));
  let addedPoints = 0;
  for (const next of incoming.products) {
    const current = productMap.get(next.marketHashName);
    if (!current) {
      productMap.set(next.marketHashName, structuredClone(next));
      addedPoints += next.observations.length;
      continue;
    }
    if (current.steamUrl !== next.steamUrl) throw new Error('Imported product identity conflicts with cached data');
    const previousLatest = Date.parse(current.observations.at(-1).observedAt);
    const incomingLatest = Math.max(...next.observations.map(point => Date.parse(point.observedAt)));
    const knownTimes = new Map(current.observations.map(point => [point.observedAt, point]));
    for (const point of next.observations) {
      const existing = knownTimes.get(point.observedAt);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(point)) throw new Error('Conflicting observation timestamp already exists for this product');
        continue;
      }
      current.observations.push(structuredClone(point));
      knownTimes.set(point.observedAt, point);
      addedPoints += 1;
    }
    current.observations.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    if (incomingLatest > previousLatest) {
      current.name = next.name;
      if (next.imageUrl) current.imageUrl = next.imageUrl;
    }
  }
  let trimmedPoints = 0;
  for (const product of productMap.values()) {
    const queryPoints = product.observations.filter(point => point.sourceKind === 'query-action');
    if (queryPoints.length <= MAX_QUERY_OBSERVATIONS_PER_PRODUCT) continue;
    const keep = new Set(queryPoints.slice(-MAX_QUERY_OBSERVATIONS_PER_PRODUCT));
    product.observations = product.observations.filter(point => point.sourceKind !== 'query-action' || keep.has(point));
    trimmedPoints += queryPoints.length - MAX_QUERY_OBSERVATIONS_PER_PRODUCT;
  }
  const merged = {
    ...base,
    generatedAt: addedPoints > 0 ? incoming.generatedAt : base.generatedAt,
    products: [...productMap.values()].sort((a, b) => a.marketHashName.localeCompare(b.marketHashName)),
    imports: structuredClone(base.imports),
  };
  let addedCaptures = 0;
  for (const capture of incoming.imports) {
    const sameCapture = merged.imports.find(existing => existing.sourceKind === capture.sourceKind
      && existing.observedAt === capture.observedAt && existing.provenance === capture.provenance
      && existing.start === capture.start && existing.totalCount === capture.totalCount
      && existing.pageSize === capture.pageSize && existing.complete === capture.complete);
    if (!sameCapture) {
      merged.imports.push(capture);
      addedCaptures += 1;
    } else if (capture.rightsConfirmed === true && sameCapture.rightsConfirmed !== true) {
      sameCapture.rightsConfirmed = true;
      addedCaptures += 1;
    }
  }
  merged.imports.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || a.start - b.start);
  // Recent capture metadata is enough to diagnose paging; product timestamps preserve older
  // observations. Cap this log separately so six-hour cycles cannot grow the public JSON forever.
  merged.imports = merged.imports.slice(-MAX_QUERY_IMPORTS);
  const capturesChanged = JSON.stringify(merged.imports) !== JSON.stringify(base.imports);
  if (addedPoints === 0 && addedCaptures > 0 && capturesChanged) merged.generatedAt = incoming.generatedAt;
  validateMarketObservations(merged);
  return { snapshot: merged, addedPoints, changed: addedPoints > 0 || capturesChanged || trimmedPoints > 0 };
}

export async function importMarketFile({ inputPath, inputPaths = null, outputPath = PUBLIC_OBSERVATIONS_PATH,
  format = null, observedAt = null, provenance = null, publish = false, rightsConfirmed = false, now = new Date() }) {
  const paths = inputPaths ?? (inputPath ? [inputPath] : []);
  if (paths.length === 0) throw new Error('--input is required');
  const documents = await readInputDocuments(paths);
  if (format !== null) {
    for (const document of documents) if (!document.format) document.format = format;
  }
  const incoming = parseMarketImportBatch({ documents, observedAt, provenance, rightsConfirmed, now });
  let previous = null;
  try { previous = JSON.parse(await readFile(outputPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not read previous public observations; refusing to overwrite', { cause: error }); }
  const result = mergeMarketObservations(previous, incoming);
  if (!publish) return { ...result, preview: result.snapshot };
  if (rightsConfirmed !== true) {
    throw new Error('Publishing requires --rights-confirmed; this records your attestation but does not grant Valve permission');
  }
  if (result.changed) await saveFilesAtomically([{ path: outputPath, content: `${JSON.stringify(result.snapshot, null, 2)}\n` }]);
  return result;
}

function parseArgs(argv) {
  const options = { inputs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--publish') { options.publish = true; continue; }
    if (argv[i] === '--dry-run') { options.dryRun = true; continue; }
    if (argv[i] === '--rights-confirmed') { options.rightsConfirmed = true; continue; }
    const match = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!match) throw new Error(`Unknown argument: ${argv[i]}`);
    const key = match[1];
    const value = match[2] ?? argv[++i];
    if (value === undefined || value === '') throw new Error(`Missing value for --${key}`);
    if (!['input', 'format', 'observed-at', 'provenance'].includes(key)) throw new Error(`Unknown option --${key}`);
    if (key === 'input') options.inputs.push(resolve(value));
    else options[key] = value;
  }
  if (options.publish && options.dryRun) throw new Error('Choose either --dry-run or --publish');
  if (options.publish && !options.rightsConfirmed) throw new Error('Publishing requires --rights-confirmed');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await importMarketFile({
    inputPaths: options.inputs,
    outputPath: PUBLIC_OBSERVATIONS_PATH,
    format: options.format ?? null,
    observedAt: options['observed-at'],
    provenance: options.provenance,
    publish: options.publish === true,
    rightsConfirmed: options.rightsConfirmed === true,
  });
  const snapshot = result.snapshot ?? result.preview;
  console.info(JSON.stringify({ mode: options.publish ? 'published' : 'dry-run', appid: TBC_APPID,
    products: snapshot.products.length, addedPoints: result.addedPoints, changed: result.changed,
    completeCapture: snapshot.imports.at(-1)?.complete ?? snapshot.imports[0]?.complete ?? false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Market import failed:', error.message); process.exitCode = 1; });
}
