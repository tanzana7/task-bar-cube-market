import './style.css';
import { formatFxRateLabel, parseFreshFxRate, prepareMarketPriceView, type FxRateRecord, type MarketSnapshot } from './market';
import { latestObservedItems, parseMarketObservations, parseUsdReferenceMinor, selectMarketDisplayItems, type ListedItem, type MarketObservations, type ObservationPoint } from './market-observations';
import { filterHistoryPoints, formatHistoryPrice, makeChartPoints, parseHistoryIndex, parseProductHistory, type HistoryCurrency, type HistoryIndex, type HistoryRange, type ProductHistory } from './history';
import { calculateTechnicalIndicators, currencyView, filterMarketItems, isObservationStale, parseFavorites, parsePriceFilterInput, parseRankingSnapshot, priceStatistics, recommendEquipment, summarizeMarket, toggleFavorite, type MarketSort, type RankingSnapshot, type RecommendationPriority } from './market-features';
import { classifyItemName, ITEM_GRADES, ITEM_QUALITIES, ITEM_TYPES, type ItemGrade, type ItemType } from './item-classification';
import { evaluateWatchTarget, mergeFavoriteKeys, parseWatchTargetPrice, parseWatchTargets, serializeWatchTargets, setWatchTarget, watchTargetDistance, WATCH_TARGETS_STORAGE_KEY, type WatchDirection, type WatchTarget } from './watchlist';
import { bargainSignal, bargainSignals, observationChange, periodChange, referenceComparisons, referenceSeries, type PriceComparison } from './market-analysis';

type Snapshot = MarketSnapshot;
const isDemoPreview = document.body.dataset.preview === 'watchlist';
const search = document.querySelector<HTMLInputElement>('#search')!;
const sort = document.querySelector<HTMLSelectElement>('#sort')!;
const currencySelect = document.querySelector<HTMLSelectElement>('#currency')!;
const itemsNode = document.querySelector<HTMLDivElement>('#items')!;
const statusNode = document.querySelector<HTMLDivElement>('#status')!;
const countNode = document.querySelector<HTMLSpanElement>('#result-count')!;
const updatedNode = document.querySelector<HTMLSpanElement>('#updated-at')!;
const noteNode = document.querySelector<HTMLParagraphElement>('#market-note')!;
const historyDialog = document.querySelector<HTMLDialogElement>('#history-dialog')!;
const historyTitle = document.querySelector<HTMLHeadingElement>('#history-title')!;
const historyImage = document.querySelector<HTMLSpanElement>('#history-image')!;
const historySummary = document.querySelector<HTMLParagraphElement>('#history-summary')!;
const historyStatus = document.querySelector<HTMLParagraphElement>('#history-status')!;
const historyChart = document.querySelector<HTMLDivElement>('#history-chart')!;
const historyRange = document.querySelector<HTMLSelectElement>('#history-range')!;
const historyCurrency = document.querySelector<HTMLSelectElement>('#history-currency')!;
const historySteam = document.querySelector<HTMLAnchorElement>('#history-steam')!;
const historyClose = document.querySelector<HTMLButtonElement>('#history-close')!;
const filterForm = document.querySelector<HTMLFormElement>('#filters')!;
const filterDisclosure = document.querySelector<HTMLDetailsElement>('#filter-disclosure')!;
const filterErrorNode = document.querySelector<HTMLParagraphElement>('#filter-error')!;
const minimumPriceInput = document.querySelector<HTMLInputElement>('#minimum-price')!;
const maximumPriceInput = document.querySelector<HTMLInputElement>('#maximum-price')!;
const minimumListingsInput = document.querySelector<HTMLInputElement>('#minimum-listings')!;
const favoritesOnlyInput = document.querySelector<HTMLInputElement>('#favorites-only')!;
const favoriteCountNode = document.querySelector<HTMLSpanElement>('#favorite-count')!;
const gradeOptionsNode = document.querySelector<HTMLFieldSetElement>('#grade-options')!;
const gradeFilterStatusNode = document.querySelector<HTMLElement>('#grade-filter-status')!;
const typeOptionsNode = document.querySelector<HTMLFieldSetElement>('#type-options')!;
const minimumGradeSelect = document.querySelector<HTMLSelectElement>('#minimum-grade')!;
const minimumQualitySelect = document.querySelector<HTMLSelectElement>('#minimum-quality')!;
const maximumQualitySelect = document.querySelector<HTMLSelectElement>('#maximum-quality')!;
const activeFiltersNode = document.querySelector<HTMLDivElement>('#active-filters')!;
const recommendOpenButton = document.querySelector<HTMLButtonElement>('#recommend-open')!;
const recommendDialog = document.querySelector<HTMLDialogElement>('#recommend-dialog')!;
const recommendCloseButton = document.querySelector<HTMLButtonElement>('#recommend-close')!;
const recommendForm = document.querySelector<HTMLFormElement>('#recommend-form')!;
const recommendTypeSelect = document.querySelector<HTMLSelectElement>('#recommend-type')!;
const recommendGradeSelect = document.querySelector<HTMLSelectElement>('#recommend-grade')!;
const recommendQualitySelect = document.querySelector<HTMLSelectElement>('#recommend-quality')!;
const recommendBudgetInput = document.querySelector<HTMLInputElement>('#recommend-budget')!;
const recommendCurrencySelect = document.querySelector<HTMLSelectElement>('#recommend-currency')!;
const recommendPrioritySelect = document.querySelector<HTMLSelectElement>('#recommend-priority')!;
const recommendResultsNode = document.querySelector<HTMLDivElement>('#recommend-results')!;
const recommendStalenessNode = document.querySelector<HTMLParagraphElement>('#recommend-staleness')!;
const recommendMethodNode = document.querySelector<HTMLParagraphElement>('#recommend-method')!;
const compareCountNode = document.querySelector<HTMLSpanElement>('#compare-count')!;
const compareOpenButton = document.querySelector<HTMLButtonElement>('#compare-open')!;
const compareDialog = document.querySelector<HTMLDialogElement>('#compare-dialog')!;
const compareCloseButton = document.querySelector<HTMLButtonElement>('#compare-close')!;
const compareTableNode = document.querySelector<HTMLDivElement>('#compare-table')!;
const overviewItemsNode = document.querySelector<HTMLElement>('#overview-items')!;
const overviewListingsNode = document.querySelector<HTMLElement>('#overview-listings')!;
const overviewUpdatedNode = document.querySelector<HTMLElement>('#overview-updated')!;
const overviewFxNode = document.querySelector<HTMLElement>('#overview-fx')!;
const rankingPeriodSelect = document.querySelector<HTMLSelectElement>('#ranking-period')!;
const rankingStatusNode = document.querySelector<HTMLDivElement>('#ranking-status')!;
const rankingListNode = document.querySelector<HTMLDivElement>('#ranking-list')!;
const historyStatsNode = document.querySelector<HTMLDivElement>('#history-stats')!;
const listingChart = document.querySelector<HTMLDivElement>('#listing-chart')!;
const historyFavoriteButton = document.querySelector<HTMLButtonElement>('#history-favorite')!;
const watchlistOpenButton = document.querySelector<HTMLButtonElement>('#watchlist-open')!;
const watchlistCountNode = document.querySelector<HTMLSpanElement>('#watchlist-count')!;
const watchAlertNode = document.querySelector<HTMLParagraphElement>('#watch-alert')!;
const watchlistDialog = document.querySelector<HTMLDialogElement>('#watchlist-dialog')!;
const watchlistCloseButton = document.querySelector<HTMLButtonElement>('#watchlist-close')!;
const watchlistSearchInput = document.querySelector<HTMLInputElement>('#watchlist-search')!;
const watchlistSortSelect = document.querySelector<HTMLSelectElement>('#watchlist-sort')!;
const watchlistItemsNode = document.querySelector<HTMLDivElement>('#watchlist-items')!;
const watchlistStatusNode = document.querySelector<HTMLParagraphElement>('#watchlist-status')!;
const valueListNode = document.querySelector<HTMLDivElement>('#value-list')!;
const valueStatusNode = document.querySelector<HTMLDivElement>('#value-status')!;
const valueMoreButton = document.querySelector<HTMLButtonElement>('#value-more')!;
const comparisonTypeSelect = document.querySelector<HTMLSelectElement>('#comparison-type')!;
const bargainStatusNode = document.querySelector<HTMLParagraphElement>('#bargain-status')!;
const bargainListNode = document.querySelector<HTMLDivElement>('#bargain-list')!;
const historyComparisonDetails = document.querySelector<HTMLDetailsElement>('#history-comparison-details')!;
const historyComparisonNode = document.querySelector<HTMLParagraphElement>('#history-comparison')!;
const changeListNode = document.querySelector<HTMLDivElement>('#change-list')!;
const changeStatusNode = document.querySelector<HTMLDivElement>('#change-status')!;
const indicatorSma = document.querySelector<HTMLInputElement>('#indicator-sma')!;
const indicatorBands = document.querySelector<HTMLInputElement>('#indicator-bands')!;
const indicatorRsi = document.querySelector<HTMLInputElement>('#indicator-rsi')!;
const indicatorStatus = document.querySelector<HTMLParagraphElement>('#indicator-status')!;
const indicatorControls = document.querySelector<HTMLFieldSetElement>('.indicator-controls')!;
const historyPriceHeading = historyChart.parentElement!.querySelector('h3')!;
let snapshot: Snapshot | null = null;
let usdSnapshot: Snapshot | null = null;
let currentFxRate: FxRateRecord | null = null;
let historyIndex: HistoryIndex | null = null;
let rankingSnapshot: RankingSnapshot | null = null;
let importedSnapshot: MarketObservations | null = null;
let importedObservations = new Map<string, ObservationPoint>();
const WATCHLIST_KEY = isDemoPreview ? 'tbcm-preview-watchlist' : 'tbcm-5084200-watchlist';
const WATCH_TARGETS_KEY = isDemoPreview ? 'tbcm-preview-watch-targets' : WATCH_TARGETS_STORAGE_KEY;
let favorites = mergeFavoriteKeys(parseFavorites(storedValue(WATCHLIST_KEY)), isDemoPreview ? [] : [
  storedValue('tbcm-5084200-favorites'), storedValue('tbcm-favorites'),
]);
let watchTargets = parseWatchTargets(storedValue(WATCH_TARGETS_KEY));
let displayItemsByKey = new Map<string, ListedItem>();
let activeHistoryItem: MarketSnapshot['items'][number] | null = null;
let selectedHistory: ProductHistory | null = null;
let historyFxFallbackNotice: string | null = null;
let historyLoadSequence = 0;
let loadSequence = 0;
const selectedForCompare = new Set<string>();
let currentMarketItems: ListedItem[] = [];
let showAllValues = false;

function usdReference(minor: number): string { return `$${(minor / 100).toFixed(2)}`; }
function signedAmount(minor: number): string { return `${minor > 0 ? '+' : minor < 0 ? '−' : ''}${usdReference(Math.abs(minor))}`; }
function observationInterval(start: string, end: string): string {
  const minutes = Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
  return minutes < 60 ? `${minutes}分` : minutes < 2_880 ? `${(minutes / 60).toFixed(1)}時間` : `${(minutes / 1_440).toFixed(1)}日`;
}

function comparisonFor(key: string): PriceComparison | undefined {
  return referenceComparisons(importedSnapshot).find(entry => entry.marketHashName === key);
}
function storedValue(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function saveValue(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch (error) { console.warn('Preference could not be saved', error); }
}
if (JSON.stringify([...favorites]) !== storedValue(WATCHLIST_KEY)) saveValue(WATCHLIST_KEY, JSON.stringify([...favorites]));

async function readOptionalJson(path: string): Promise<unknown | null> {
  try {
    const response = await fetch(path, { cache: 'no-cache' });
    return response.ok ? await response.json() : null;
  } catch {
    // FX metadata is optional; its absence must not make valid market data unavailable.
    return null;
  }
}

currencySelect.value = storedValue('tbcm-currency') === 'USD' ? 'USD' : 'JPY';
// On narrow screens, keep the frequent search and sort controls visible while allowing
// the less frequent price/listing filters to be opened without pushing results far down.
if (window.matchMedia('(max-width: 620px)').matches) filterDisclosure.open = false;

function addSelectOptions(select: HTMLSelectElement, values: readonly (string | number)[]) {
  for (const value of values) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = typeof value === 'number' ? `${value}%` : value;
    select.append(option);
  }
}
for (const [values, fieldset, name] of [[ITEM_GRADES, gradeOptionsNode, 'grade'], [ITEM_TYPES, typeOptionsNode, 'type']] as const) {
  for (const value of values) {
    const label = document.createElement('label');
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = value; input.name = name;
    label.append(input, document.createTextNode(value)); fieldset.append(label);
  }
}
addSelectOptions(minimumGradeSelect, ITEM_GRADES);
addSelectOptions(recommendTypeSelect, ITEM_TYPES);
addSelectOptions(comparisonTypeSelect, ITEM_TYPES);
const noMinimumGrade = document.createElement('option'); noMinimumGrade.value = ''; noMinimumGrade.textContent = '指定なし'; recommendGradeSelect.append(noMinimumGrade);
addSelectOptions(recommendGradeSelect, ITEM_GRADES);
for (const select of [minimumQualitySelect, maximumQualitySelect, recommendQualitySelect]) {
  const none = document.createElement('option'); none.value = ''; none.textContent = '指定なし'; select.append(none);
  addSelectOptions(select, ITEM_QUALITIES);
}

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<Snapshot>;
  return data.schemaVersion === 2 && data.appid === 5084200
    && ['ok', 'unavailable'].includes(data.status ?? '')
    && (data.currency === 'JPY' || data.currency === 'USD')
    && Array.isArray(data.items)
    && (data.fetchedAt === null || typeof data.fetchedAt === 'string')
    && (data.priceSource === undefined || data.priceSource === 'steam'
      || (data.priceSource === 'fx' && data.currency === 'JPY' && data.fxRate?.source === 'Frankfurter'
        && typeof data.fxRate.rate === 'number' && Number.isFinite(data.fxRate.rate) && data.fxRate.rate > 0
        && typeof data.fxRate.rateDate === 'string' && !Number.isNaN(Date.parse(data.fxRate.rateDate))
        && typeof data.fxRate.fetchedAt === 'string' && !Number.isNaN(Date.parse(data.fxRate.fetchedAt))));
}

function safeImage(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      && ['community.cloudflare.steamstatic.com', 'community.steamstatic.com'].includes(parsed.hostname)
      && parsed.pathname.startsWith('/economy/image/') ? parsed.href : null;
  } catch {
    return null;
  }
}

function safeSteamUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'steamcommunity.com'
      && parsed.pathname.startsWith('/market/listings/5084200/') ? parsed.href : null;
  } catch {
    return null;
  }
}

type ArtworkType = Lowercase<ItemType> | 'other';

const ITEM_TYPE_PATHS: Record<ArtworkType, string[]> = {
  sword: ['M19 3 9 17', 'M7 16 4 20l4-3', 'm9 17 3 3', 'm14 8 2 2'],
  boots: ['M7 4v8l-3 3v4h15v-3l-6-2-2-4V4z', 'M4 16h15'],
  ring: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z'],
  bracelet: ['M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z', 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z', 'M12 2v3'],
  chestplate: ['M7 4 12 6l5-2 4 4-3 4v9H6v-9L3 8z', 'M12 6v15', 'M6 12h12'],
  gloves: ['M7 12V6a1.5 1.5 0 0 1 3 0v4-6a1.5 1.5 0 0 1 3 0v6-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v7c0 4-2 6-6 6h-2c-3 0-5-2-5-5l-2-3a1.5 1.5 0 0 1 2-2z'],
  helmet: ['M4 14a8 8 0 0 1 16 0v3H4z', 'M3 17h18', 'M12 6v4'],
  necklace: ['M5 4c1 6 3 9 7 12 4-3 6-6 7-12', 'M9 18l3-3 3 3-3 4z'],
  pants: ['M6 4h12l-1 16h-4l-1-8-1 8H7z', 'M7 8h10'],
  chest: ['M4 6h16v13H4z', 'M4 10h16', 'M12 6v13', 'M10 13h4'],
  other: ['M5 5h14v14H5z', 'M8 12h8', 'M12 8v8'],
};

function itemTypeFromName(name: string): ArtworkType {
  return classifyItemName(name).type?.toLowerCase() as ArtworkType | undefined ?? 'other';
}

function appendTypeGlyph(box: HTMLElement, type: ArtworkType) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'type-art-glyph');
  svg.setAttribute('aria-hidden', 'true');
  for (const pathData of ITEM_TYPE_PATHS[type]) {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', pathData);
    svg.append(path);
  }
  box.replaceChildren(svg);
}

function createItemArtwork(name: string, imageUrl: string | null, className: string): HTMLSpanElement {
  const type = itemTypeFromName(name);
  const box = document.createElement('span');
  box.className = className;
  box.dataset.itemType = type;
  const validUrl = safeImage(imageUrl);
  if (!validUrl) {
    appendTypeGlyph(box, type);
    return box;
  }
  const image = document.createElement('img');
  image.src = validUrl;
  image.alt = '';
  image.width = 256;
  image.height = 256;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.onerror = () => { image.onerror = null; appendTypeGlyph(box, type); };
  box.replaceChildren(image);
  return box;
}

function formatObservedAt(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' })
    .format(new Date(value));
}

function makeChart(node: HTMLElement, points: Array<{ observedAt: string; value: number; label: string; listings: number }>, yLabel: (value: number) => string, title: string, overlays: Array<{ values: Array<number | null>; className: string }> = []) {
  node.replaceChildren();
  if (points.length === 0) return;
  const width = 760;
  const height = 300;
  const margin = { top: 18, right: 24, bottom: 42, left: 76 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const times = points.map(point => Date.parse(point.observedAt));
  const overlayValues = overlays.flatMap(overlay => overlay.values.filter((value): value is number => value !== null));
  const values = [...points.map(point => point.value), ...overlayValues];
  const firstTime = times[0];
  const lastTime = times[times.length - 1];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const pad = maxValue === minValue ? Math.max(Math.abs(maxValue) * 0.08, 1) : (maxValue - minValue) * 0.12;
  const yMin = Math.max(0, minValue - pad);
  const yMax = maxValue + pad || 1;
  const x = (time: number) => margin.left + (lastTime === firstTime ? plotWidth / 2 : (time - firstTime) / (lastTime - firstTime) * plotWidth);
  const y = (value: number) => margin.top + (yMax - value) / (yMax - yMin || 1) * plotHeight;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${title}、観測点${points.length}件`);
  svg.classList.add('history-svg');
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = yMin + (yMax - yMin) * tick / 4;
    const yPos = y(value);
    const grid = document.createElementNS(svg.namespaceURI, 'line');
    grid.setAttribute('x1', String(margin.left)); grid.setAttribute('x2', String(width - margin.right));
    grid.setAttribute('y1', String(yPos)); grid.setAttribute('y2', String(yPos)); grid.setAttribute('class', 'chart-grid'); svg.append(grid);
    const label = document.createElementNS(svg.namespaceURI, 'text');
    label.setAttribute('x', String(margin.left - 10)); label.setAttribute('y', String(yPos + 4)); label.setAttribute('text-anchor', 'end');
    label.setAttribute('class', 'chart-label'); label.textContent = yLabel(value); svg.append(label);
  }
  const axis = document.createElementNS(svg.namespaceURI, 'line');
  axis.setAttribute('x1', String(margin.left)); axis.setAttribute('x2', String(width - margin.right));
  axis.setAttribute('y1', String(height - margin.bottom)); axis.setAttribute('y2', String(height - margin.bottom)); axis.setAttribute('class', 'chart-axis'); svg.append(axis);
  const firstDate = document.createElementNS(svg.namespaceURI, 'text');
  firstDate.setAttribute('x', String(margin.left)); firstDate.setAttribute('y', String(height - 12));
  firstDate.setAttribute('class', 'chart-label'); firstDate.textContent = formatObservedAt(points[0].observedAt); svg.append(firstDate);
  if (points.length > 1) {
    const lastDate = document.createElementNS(svg.namespaceURI, 'text');
    lastDate.setAttribute('x', String(width - margin.right)); lastDate.setAttribute('y', String(height - 12));
    lastDate.setAttribute('text-anchor', 'end'); lastDate.setAttribute('class', 'chart-label');
    lastDate.textContent = formatObservedAt(points[points.length - 1].observedAt); svg.append(lastDate);
  }
  if (points.length > 1) {
    const gaps = times.slice(1).map((time, index) => time - times[index]);
    const ordered = [...gaps].sort((a, b) => a - b);
    const typicalGap = ordered[Math.floor(ordered.length / 2)];
    for (let index = 1; index < points.length; index += 1) {
      const segment = document.createElementNS(svg.namespaceURI, 'line');
      segment.setAttribute('x1', String(x(times[index - 1]))); segment.setAttribute('y1', String(y(points[index - 1].value)));
      segment.setAttribute('x2', String(x(times[index]))); segment.setAttribute('y2', String(y(points[index].value)));
      segment.setAttribute('class', gaps[index - 1] > typicalGap * 3 ? 'chart-gap' : 'chart-line-segment'); svg.append(segment);
    }
  }
  overlays.forEach(overlay => {
    const segments = overlay.values.map((value, index) => value === null ? null : `${x(times[index])},${y(value)}`).filter((value): value is string => value !== null);
    if (segments.length < 2) return;
    const line = document.createElementNS(svg.namespaceURI, 'polyline');
    line.setAttribute('points', segments.join(' ')); line.setAttribute('class', overlay.className); svg.append(line);
  });
  points.forEach((point, index) => {
    const marker = document.createElementNS(svg.namespaceURI, 'circle');
    marker.setAttribute('cx', String(x(times[index]))); marker.setAttribute('cy', String(y(point.value)));
    marker.setAttribute('r', points.length === 1 ? '6' : '4'); marker.setAttribute('class', 'chart-point'); marker.setAttribute('tabindex', '0'); marker.setAttribute('role', 'button');
    const description = `${formatObservedAt(point.observedAt)} · ${point.label} · 出品 ${point.listings.toLocaleString('ja-JP')}件`;
    marker.setAttribute('aria-label', description);
    const titleElement = document.createElementNS(svg.namespaceURI, 'title'); titleElement.textContent = description; marker.append(titleElement);
    marker.addEventListener('pointerup', () => { historyStatus.textContent = description; });
    marker.addEventListener('keydown', event => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === 'Enter' || keyEvent.key === ' ') { keyEvent.preventDefault(); historyStatus.textContent = description; }
    });
    svg.append(marker);
  });
  node.append(svg);
}

function renderHistoryChart() {
  historyChart.replaceChildren();
  listingChart.replaceChildren();
  historyStatsNode.replaceChildren();
  indicatorStatus.textContent = '';
  if (!selectedHistory || selectedHistory.points.length === 0) {
    historyStatus.textContent = '価格履歴はまだありません。';
    return;
  }
  const currency = historyCurrency.value as HistoryCurrency;
  const range = historyRange.value as HistoryRange;
  const usdPoints = filterHistoryPoints(selectedHistory.points, range);
  // Listings are independent of FX. Keep them visible when only the JPY price
  // projection is unavailable; the underlying price observations remain USD.
  const listingPoints = usdPoints.map(point => ({ ...point, value: point.listings, label: `${point.listings.toLocaleString('ja-JP')}件` }));
  makeChart(listingChart, listingPoints, value => Math.round(value).toLocaleString('ja-JP'), '出品数の推移');
  const converted = makeChartPoints(selectedHistory.points, currency, currentFxRate);
  if (!converted) {
    historyStatsNode.replaceChildren();
    historyStatus.textContent = '為替レートが未取得または期限切れのため、JPY価格グラフは表示できません。USD価格履歴と出品数の推移はUSDを選択すると確認できます。';
    return;
  }
  const points = filterHistoryPoints(converted, range);
  if (points.length === 0) {
    historyStatus.textContent = 'この期間の価格履歴はありません。';
    return;
  }
  const indicators = calculateTechnicalIndicators(selectedHistory.points);
  const selectedIndicators = filterHistoryPoints(selectedHistory.points.map((point, index) => ({ ...point, ...indicators[index] })), range);
  const major = (cents: number) => currency === 'USD' ? cents / 100 : Math.round(cents * currentFxRate!.rate / 100);
  const overlays: Array<{ values: Array<number | null>; className: string }> = [];
  if (indicatorSma.checked) overlays.push({ values: selectedIndicators.map(point => point.sma20 === null ? null : major(point.sma20)), className: 'chart-indicator chart-sma' });
  if (indicatorBands.checked) {
    overlays.push({ values: selectedIndicators.map(point => point.upperBand === null ? null : major(point.upperBand)), className: 'chart-indicator chart-band' });
    overlays.push({ values: selectedIndicators.map(point => point.lowerBand === null ? null : major(point.lowerBand)), className: 'chart-indicator chart-band' });
  }
  makeChart(historyChart, points, value => formatHistoryPrice(value, currency), `${currency}価格推移`, overlays);
  const stats = priceStatistics(usdPoints, range);
  if (stats) {
    const yenStats = currency === 'JPY';
    const display = (cents: number) => formatHistoryPrice(yenStats ? major(cents) : cents / 100, currency);
    const rows: Array<[string, string]> = [
      ['期間内最安', display(stats.minimum)], ['期間内最高', display(stats.maximum)],
      ['価格変化', `${display(Math.abs(stats.change))} ${stats.change > 0 ? '↑' : stats.change < 0 ? '↓' : '→'}${stats.changePercent === null ? '' : ` (${stats.changePercent > 0 ? '+' : ''}${stats.changePercent.toFixed(1)}%)`}`],
      ['直近の観測', `${display(stats.latest)} · 出品 ${stats.latestListings.toLocaleString('ja-JP')}件`],
    ];
    for (const [label, value] of rows) {
      const card = document.createElement('article'); const term = document.createElement('span'); const data = document.createElement('strong');
      term.textContent = label; data.textContent = value; card.append(term, data); historyStatsNode.append(card);
    }
  }
  const last = indicators[indicators.length - 1];
  const names: string[] = [];
  if (indicatorSma.checked) names.push(last?.sma20 === null ? '移動平均: 点数不足' : `移動平均: ${last?.sma20 === undefined ? '未取得' : formatHistoryPrice(major(last.sma20), currency)}`);
  if (indicatorBands.checked) names.push(last?.upperBand === null ? 'ボリンジャーバンド: 点数不足' : `バンド: ${formatHistoryPrice(major(last!.lowerBand!), currency)}–${formatHistoryPrice(major(last!.upperBand!), currency)}`);
  if (indicatorRsi.checked) names.push(last?.rsi14 === null ? 'RSI: 点数不足' : `RSI: ${last?.rsi14?.toFixed(1) ?? '未取得'}`);
  indicatorStatus.textContent = names.length ? names.join(' · ') : '';
  const intervals = points.slice(1).map((point, index) => Date.parse(point.observedAt) - Date.parse(points[index].observedAt)).sort((a, b) => a - b);
  const typical = intervals.length ? intervals[Math.floor(intervals.length / 2)] : 0;
  const longGaps = intervals.filter(interval => interval > typical * 3).length;
  historyStatus.textContent = `${historyFxFallbackNotice ? `${historyFxFallbackNotice} · ` : ''}観測点 ${points.length.toLocaleString('ja-JP')}件 · 点間の価格は未取得${longGaps ? ` · 長い観測間隔 ${longGaps}か所` : ''}`;
}

async function openHistory(item: ListedItem | MarketSnapshot['items'][number]) {
  const request = ++historyLoadSequence;
  activeHistoryItem = item;
  selectedHistory = null;
  const useUsdHistoryFallback = currencySelect.value === 'JPY' && currentFxRate === null;
  historyCurrency.value = useUsdHistoryFallback ? 'USD' : currencySelect.value;
  historyFxFallbackNotice = useUsdHistoryFallback ? '為替レート未取得のため、価格履歴をUSDで表示しています' : null;
  historyTitle.textContent = item.name;
  const imported = importedObservations.get(item.marketHashName);
  // Reference quotes are sparse and have an unverified fee basis; canonical-price indicators would imply false precision.
  indicatorControls.hidden = Boolean(imported);
  historyPriceHeading.textContent = imported ? '参考表示価格の推移' : '最安出品価格の推移';
  historyRange.disabled = Boolean(imported);
  historyCurrency.disabled = Boolean(imported);
  const visibleItem = imported ? item : snapshot?.items.find(candidate => candidate.marketHashName === item.marketHashName) ?? item;
  const currentPrice = imported
    ? ('importedPriceText' in item ? item.importedPriceText : null) ?? (imported.priceText ? `${imported.priceText} USD（取込観測）` : '価格情報なし')
    : visibleItem.priceText ?? (currencySelect.value === 'JPY' ? '参考円価格は更新待ち' : '価格情報なし');
  const listings = visibleItem.listings === null ? '出品数 未取得' : `出品 ${visibleItem.listings.toLocaleString('ja-JP')}件`;
  const capturedAt = imported?.observedAt ?? usdSnapshot?.fetchedAt;
  const captured = capturedAt ? ` · ${formatObservedAt(capturedAt)}` : '';
  // 詳細画面だけを開いても、未検証の表示価格を確定した最安値と誤認させない。
  const referenceNotice = imported?.referencePriceText ? ' · 参考値・価格基準確認中' : '';
  historySummary.textContent = `${currentPrice}${referenceNotice} · ${listings}${captured}`;
  const comparison = comparisonFor(item.marketHashName);
  historyComparisonDetails.hidden = !comparison;
  historyComparisonDetails.open = false;
  historyComparisonNode.textContent = comparison
    ? `${comparison.type}・Quality ${comparison.qualityBand}帯の${comparison.groupSize}商品。中央値 ${usdReference(Math.round(comparison.medianMinor))}、この商品の参考表示価格は${usdReference(comparison.priceMinor)}（差 ${signedAmount(comparison.deltaMinor)}）。素材・Grade・性能の同等性は未確認です。`
    : '';
  historyFavoriteButton.setAttribute('aria-pressed', String(favorites.has(item.marketHashName)));
  historyFavoriteButton.textContent = favorites.has(item.marketHashName) ? '★ ウォッチ中' : '☆ ウォッチ';
  const historyArtwork = createItemArtwork(item.name, item.imageUrl, 'history-item-art');
  historyImage.dataset.itemType = historyArtwork.dataset.itemType;
  historyImage.replaceChildren(...Array.from(historyArtwork.childNodes));
  const steamUrl = isDemoPreview ? 'https://steamcommunity.com/market/search?appid=5084200' : safeSteamUrl(item.steamUrl);
  historySteam.hidden = !steamUrl;
  if (steamUrl) historySteam.href = steamUrl;
  historyStatus.textContent = '読み込み中';
  historyChart.replaceChildren();
  if (!historyDialog.open) historyDialog.showModal();

  if (imported) {
    const ownSignal = bargainSignal(importedSnapshot, item.marketHashName);
    historyRange.value = 'all';
    historyCurrency.value = 'USD';
    const series = referenceSeries(importedSnapshot, item.marketHashName);
    const change = observationChange(importedSnapshot, item.marketHashName);
    historyStatsNode.replaceChildren();
    const stats: Array<[string, string]> = [['観測回数', `${series.length}回`]];
    if (series.length) stats.push(['観測期間', `${formatObservedAt(series[0].observedAt)} → ${formatObservedAt(series.at(-1)!.observedAt)}`]);
    const prices = series.flatMap(point => point.priceMinor === null ? [] : [point.priceMinor]);
    if (prices.length >= 2) {
      const ordered = [...prices].sort((a, b) => a - b);
      const median = ordered.length % 2 ? ordered[Math.floor(ordered.length / 2)] : (ordered[ordered.length / 2 - 1] + ordered[ordered.length / 2]) / 2;
      stats.push(['参考価格の範囲', `${usdReference(ordered[0])}–${usdReference(ordered.at(-1)!)}`],
        ['平均・中央値', `${usdReference(Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length))} / ${usdReference(Math.round(median))}`]);
    }
    if (change) {
      stats.push(['前回観測', `${change.previous.priceMinor === null ? '価格未取得' : usdReference(change.previous.priceMinor)} · ${formatObservedAt(change.previous.observedAt)}`],
        ['価格変化', change.priceDelta === null ? '比較データ不足' : `${signedAmount(change.priceDelta)}${change.pricePercent === null ? '' : ` (${change.pricePercent > 0 ? '+' : ''}${change.pricePercent.toFixed(1)}%)`}`],
        ['出品数変化', change.listingsDelta === null ? '比較データ不足' : `${change.listingsDelta > 0 ? '+' : ''}${change.listingsDelta}件`]);
    }
    if (ownSignal) stats.push(['過去観測との比較', `過去中央値 ${usdReference(ownSignal.historicalMedianMinor)} より ${ownSignal.discountPercent.toFixed(1)}%低い参考表示価格`]);
    for (const [label, value] of stats) {
      const card = document.createElement('article'); const term = document.createElement('span'); const data = document.createElement('strong');
      term.textContent = label; data.textContent = value; card.append(term, data); historyStatsNode.append(card);
    }
    const selected = series.filter(point => historyRange.value === 'all' || Date.parse(point.observedAt) >= Date.now() -
      ({ '24h': 1, '7d': 7, '30d': 30, '90d': 90 }[historyRange.value] ?? 90) * 86_400_000);
    const pricePoints = selected.filter((point): point is typeof point & { priceMinor: number } => point.priceMinor !== null)
      .map(point => ({ observedAt: point.observedAt, value: point.priceMinor / 100, label: usdReference(point.priceMinor), listings: point.listings ?? 0 }));
    const listingPoints = selected.filter((point): point is typeof point & { listings: number } => point.listings !== null)
      .map(point => ({ observedAt: point.observedAt, value: point.listings, label: `${point.listings}件`, listings: point.listings }));
    makeChart(historyChart, pricePoints, value => `$${value.toFixed(2)}`, 'USD参考価格の推移');
    makeChart(listingChart, listingPoints, value => `${Math.round(value)}件`, '出品数の推移');
    indicatorStatus.textContent = '参考価格の疎な観測系列にはテクニカル指標を適用しません。';
    historyStatus.textContent = `参考価格・価格基準確認中${isObservationStale(imported.observedAt) ? ' · 古い観測' : ''} · ${series.length < 2 ? '比較データ不足' : `観測間隔 ${observationInterval(series[0].observedAt, series.at(-1)!.observedAt)}`} · 観測点の間は未取得`;
    return;
  }

  const product = historyIndex?.products.find(entry => entry.marketHashName === item.marketHashName);
  if (!product) {
    renderHistoryChart();
    return;
  }
  try {
    const response = await fetch(`/history/${product.id}.json`, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (request !== historyLoadSequence) return;
    selectedHistory = parseProductHistory(data, item.marketHashName);
    if (!selectedHistory) throw new Error('Invalid history data');
    renderHistoryChart();
  } catch (error) {
    if (request !== historyLoadSequence) return;
    console.error('Price history load failed', error);
    historyStatus.textContent = '価格履歴を読み込めませんでした。時間をおいて再度お試しください。';
  }
}

function renderReferenceAnalysis() {
  valueListNode.replaceChildren();
  bargainListNode.replaceChildren();
  changeListNode.replaceChildren();
  // Different items can have different materials and stats even within one Type/Quality band.
  // Keep this distribution neutral; only the same item's confirmed time series may produce a bargain signal.
  const candidates = referenceComparisons(importedSnapshot)
    .filter(entry => !comparisonTypeSelect.value || entry.type === comparisonTypeSelect.value)
    .sort((a, b) => a.priceMinor - b.priceMinor || a.marketHashName.localeCompare(b.marketHashName));
  valueStatusNode.textContent = candidates.length
    ? `${candidates.length}商品を参考表示価格の安い順に表示 · 同じType・Quality帯の中央値と比較`
    : '比較できる商品が不足しています。';
  valueMoreButton.hidden = candidates.length <= 6;
  valueMoreButton.textContent = showAllValues ? '閉じる' : 'もっと見る';
  for (const entry of (showAllValues ? candidates : candidates.slice(0, 6))) {
    const item = displayItemsByKey.get(entry.marketHashName);
    if (!item) continue;
    const card = document.createElement('article'); card.className = 'analysis-card';
    card.append(createItemArtwork(item.name, item.imageUrl, 'analysis-art'));
    const content = document.createElement('div');
    const name = document.createElement('button'); name.type = 'button'; name.className = 'analysis-name'; name.textContent = item.name;
    name.addEventListener('click', () => { void openHistory(item); });
    const price = document.createElement('strong'); price.textContent = `${usdReference(entry.priceMinor)} 参考価格`;
    const context = document.createElement('small'); context.textContent = `${entry.type} · Quality ${entry.qualityBand}帯${isObservationStale(entry.observedAt) ? ' · 古い観測' : ''}`;
    const delta = document.createElement('span'); delta.textContent = `同帯中央値との差 ${signedAmount(entry.deltaMinor)} · 出品 ${entry.listings ?? '未取得'}件`;
    const actions = document.createElement('div'); actions.className = 'analysis-actions';
    const watch = document.createElement('button'); watch.type = 'button'; watch.textContent = favorites.has(item.marketHashName) ? '★ ウォッチ中' : '☆ ウォッチ';
    watch.setAttribute('aria-pressed', String(favorites.has(item.marketHashName)));
    watch.addEventListener('click', () => setFavorite(item.marketHashName));
    actions.append(watch, makeFeatureLink(item));
    content.append(name, price, context, delta, actions); card.append(content); valueListNode.append(card);
  }
  const bargains = bargainSignals(importedSnapshot);
  bargainStatusNode.textContent = bargains.length
    ? `${bargains.length}商品 · 同一商品の観測6回以上・24時間以上・直近24時間以内の連続2回で過去中央値より20%以上低い参考表示価格`
    : '同一商品の価格履歴を蓄積しています。十分な観測が集まると、過去相場と比較した安値候補を表示できます。';
  for (const signal of bargains) {
    const item = displayItemsByKey.get(signal.marketHashName);
    if (!item) continue;
    const card = document.createElement('article'); card.className = 'analysis-card';
    card.append(createItemArtwork(item.name, item.imageUrl, 'analysis-art'));
    const content = document.createElement('div');
    const name = document.createElement('button'); name.type = 'button'; name.className = 'analysis-name'; name.textContent = item.name;
    name.addEventListener('click', () => { void openHistory(item); });
    const price = document.createElement('strong'); price.textContent = `${usdReference(signal.latestPriceMinor)} 参考価格`;
    const context = document.createElement('small'); context.textContent = `同一商品の過去中央値 ${usdReference(signal.historicalMedianMinor)}より ${signal.discountPercent.toFixed(1)}%低い · ${formatObservedAt(signal.observedAt)}`;
    const actions = document.createElement('div'); actions.className = 'analysis-actions'; actions.append(makeFeatureLink(item));
    content.append(name, price, context, actions); card.append(content); bargainListNode.append(card);
  }
  const changes = importedSnapshot?.products.flatMap(product => {
    const change = observationChange(importedSnapshot, product.marketHashName);
    return change ? [change] : [];
  }) ?? [];
  const sections = [
    { title: '値上がり', entries: changes.filter(change => (change.priceDelta ?? 0) > 0).sort((a, b) => b.priceDelta! - a.priceDelta!) },
    { title: '値下がり', entries: changes.filter(change => (change.priceDelta ?? 0) < 0).sort((a, b) => a.priceDelta! - b.priceDelta!) },
    { title: '出品数増加', entries: changes.filter(change => (change.listingsDelta ?? 0) > 0).sort((a, b) => b.listingsDelta! - a.listingsDelta!) },
    { title: '出品数減少', entries: changes.filter(change => (change.listingsDelta ?? 0) < 0).sort((a, b) => a.listingsDelta! - b.listingsDelta!) },
  ];
  changeStatusNode.textContent = changes.length ? `${changes.length}商品に比較可能な前回観測あり · 24時間・7日比較はデータ蓄積中` : '比較データ不足 · データ蓄積中';
  for (const section of sections) {
    const column = document.createElement('section'); column.className = 'change-column';
    const heading = document.createElement('h3'); heading.textContent = section.title; column.append(heading);
    if (!section.entries.length) { const empty = document.createElement('p'); empty.textContent = '変化なし'; column.append(empty); }
    for (const change of section.entries.slice(0, 5)) {
      const item = displayItemsByKey.get(change.marketHashName);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'change-row';
      const figure = section.title.startsWith('出品数') ? `${change.listingsDelta! > 0 ? '+' : ''}${change.listingsDelta}件`
        : `${signedAmount(change.priceDelta!)}${change.pricePercent === null ? '' : ` (${change.pricePercent > 0 ? '+' : ''}${change.pricePercent.toFixed(1)}%)`}`;
      button.textContent = `${item?.name ?? change.marketHashName} · ${figure} · ${formatObservedAt(change.previous.observedAt)} → ${formatObservedAt(change.latest.observedAt)} (${observationInterval(change.previous.observedAt, change.latest.observedAt)})${isObservationStale(change.latest.observedAt) ? ' · 古い観測' : ''}`;
      button.addEventListener('click', () => { if (item) void openHistory(item); }); column.append(button);
    }
    changeListNode.append(column);
  }
}

function checkedValues<T extends string>(root: HTMLElement): Set<T> {
  return new Set(Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'), input => input.value as T));
}

function renderActiveFilters() {
  activeFiltersNode.replaceChildren();
  const chips: Array<{ label: string; remove: () => void }> = [];
  if (search.value.trim()) chips.push({ label: `検索 ${search.value.trim()}`, remove: () => { search.value = ''; } });
  for (const input of Array.from(gradeOptionsNode.querySelectorAll<HTMLInputElement>('input:checked'))) {
    chips.push({ label: `Grade ${input.value}`, remove: () => { input.checked = false; } });
  }
  for (const input of Array.from(typeOptionsNode.querySelectorAll<HTMLInputElement>('input:checked'))) {
    chips.push({ label: `Type ${input.value}`, remove: () => { input.checked = false; } });
  }
  if (minimumGradeSelect.value) chips.push({ label: `${minimumGradeSelect.value}以上`, remove: () => { minimumGradeSelect.value = ''; } });
  if (minimumQualitySelect.value) chips.push({ label: `Quality ${minimumQualitySelect.value}%以上`, remove: () => { minimumQualitySelect.value = ''; } });
  if (maximumQualitySelect.value) chips.push({ label: `Quality ${maximumQualitySelect.value}%以下`, remove: () => { maximumQualitySelect.value = ''; } });
  if (minimumPriceInput.value) chips.push({ label: `価格 ${currencySelect.value} ${minimumPriceInput.value}以上`, remove: () => { minimumPriceInput.value = ''; } });
  if (maximumPriceInput.value) chips.push({ label: `価格 ${currencySelect.value} ${maximumPriceInput.value}以下`, remove: () => { maximumPriceInput.value = ''; } });
  if (minimumListingsInput.value) chips.push({ label: `出品 ${minimumListingsInput.value}件以上`, remove: () => { minimumListingsInput.value = ''; } });
  if (favoritesOnlyInput.checked) chips.push({ label: 'ウォッチのみ', remove: () => { favoritesOnlyInput.checked = false; } });
  for (const chip of chips) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'filter-chip'; button.textContent = `${chip.label} ×`;
    button.setAttribute('aria-label', `${chip.label}の条件を解除`);
    button.addEventListener('click', () => { chip.remove(); render(); });
    activeFiltersNode.append(button);
  }
  activeFiltersNode.hidden = chips.length === 0;
}

function refreshCompareControls() {
  compareCountNode.textContent = selectedForCompare.size ? `${selectedForCompare.size}件選択` : '';
  compareOpenButton.disabled = selectedForCompare.size < 2 || selectedForCompare.size > 4;
  compareOpenButton.textContent = `選択商品を比較${selectedForCompare.size ? ` (${selectedForCompare.size})` : ''}`;
}

function render() {
  if (!snapshot) return;
  const priceView = prepareMarketPriceView(snapshot.items, snapshot.currency, snapshot.priceSource, currentFxRate?.rateDate);
  const minimumPrice = parsePriceFilterInput(minimumPriceInput.value, currencySelect.value as 'USD' | 'JPY');
  const maximumPrice = parsePriceFilterInput(maximumPriceInput.value, currencySelect.value as 'USD' | 'JPY');
  const errors = [minimumPrice.error, maximumPrice.error].filter((message): message is string => message !== null);
  if (minimumPrice.value !== null && maximumPrice.value !== null && minimumPrice.value > maximumPrice.value) errors.push('最低価格は最高価格以下にしてください。');
  const minimumListings = minimumListingsInput.value.trim()
    ? (/^(0|[1-9]\d*)$/.test(minimumListingsInput.value.trim()) && Number.isSafeInteger(Number(minimumListingsInput.value))
      ? Number(minimumListingsInput.value) : null)
    : null;
  if (minimumListingsInput.value.trim() && minimumListings === null) errors.push('最低出品数は0以上の整数で入力してください。');
  const minimumQuality = minimumQualitySelect.value ? Number(minimumQualitySelect.value) : null;
  const maximumQuality = maximumQualitySelect.value ? Number(maximumQualitySelect.value) : null;
  if (minimumQuality !== null && maximumQuality !== null && minimumQuality > maximumQuality) errors.push('Quality下限は上限以下にしてください。');
  filterErrorNode.hidden = errors.length === 0;
  filterErrorNode.textContent = [...new Set(errors)].join(' ');
  if (errors.length > 0) {
    countNode.textContent = '条件を確認';
    itemsNode.replaceChildren();
    itemsNode.hidden = true;
    statusNode.hidden = true;
    return;
  }
  const visibleCurrency = currencySelect.value as 'USD' | 'JPY';
  const selection = selectMarketDisplayItems(priceView.items, usdSnapshot?.fetchedAt ?? null,
    latestObservedItems(importedSnapshot), visibleCurrency, currentFxRate?.rate ?? null);
  importedObservations = new Map([...selection.imported].flatMap(([key, item]) => item.observation ? [[key, item.observation] as const] : []));
  const allItems = selection.items;
  currentMarketItems = allItems;
  updateGradeAvailability(allItems);
  displayItemsByKey = new Map(allItems.map(item => [item.marketHashName, item]));
  renderReferenceAnalysis();
  updateWatchlistSummary();
  if (watchlistDialog.open) renderWatchlist();
  const importedText = new Map([...selection.imported].map(([key, item]) => [key, item.importedPriceText ?? '価格情報なし']));
  const visible = filterMarketItems(allItems, {
    query: search.value,
    currency: visibleCurrency,
    minimumPrice: minimumPrice.value,
    maximumPrice: maximumPrice.value,
    minimumListings,
    favoritesOnly: favoritesOnlyInput.checked,
    favorites,
    grades: checkedValues<ItemGrade>(gradeOptionsNode),
    minimumGrade: (minimumGradeSelect.value || null) as ItemGrade | null,
    types: checkedValues<ItemType>(typeOptionsNode),
    minimumQuality,
    maximumQuality,
  }, sort.value as MarketSort);
  renderActiveFilters();
  refreshCompareControls();
  favoriteCountNode.textContent = favorites.size.toLocaleString('ja-JP');
  countNode.textContent = `${visible.length}件のアイテム`;
  itemsNode.replaceChildren();
  if (snapshot.status === 'unavailable' && visible.length === 0) {
    statusNode.hidden = false;
    const latestCapture = importedSnapshot?.imports.at(-1);
    statusNode.textContent = latestCapture?.totalCount === 0
      ? `最終観測では掲載商品なし · ${formatObservedAt(latestCapture.observedAt)}`
      : `${snapshot.currency}の価格情報は未取得です`;
    itemsNode.hidden = true;
    return;
  }
  if (visible.length === 0) {
    statusNode.hidden = false;
    statusNode.textContent = '一致するアイテムがありません。';
    itemsNode.hidden = true;
    return;
  }
  statusNode.hidden = true;
  itemsNode.hidden = false;
  const fragment = document.createDocumentFragment();
  for (const item of visible) {
    const link = isDemoPreview ? 'https://steamcommunity.com/market/search?appid=5084200' : safeSteamUrl(item.steamUrl);
    if (!link) continue;
    const card = document.createElement('article');
    card.className = 'item';
    const imageBox = createItemArtwork(item.name, item.imageUrl, 'image-box');
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'item-main item-detail';
    const observation = importedObservations.get(item.marketHashName);
    main.setAttribute('aria-label', observation ? `${item.name}の観測情報を表示` : `${item.name}の価格履歴を表示`);
    main.addEventListener('click', () => { void openHistory(item); });
    const name = document.createElement('strong');
    name.textContent = item.name;
    const listings = document.createElement('small');
    listings.textContent = item.listings === null ? '出品数 未取得' : `出品 ${item.listings.toLocaleString('ja-JP')}件`;
    const info = document.createElement('span');
    info.className = 'item-info';
    const classification = classifyItemName(item.marketHashName);
    const type = classification.type ?? 'other';
    const gradeLabel = document.createElement('small');
    gradeLabel.className = classification.grade ? `item-grade grade-${classification.grade.toLowerCase()}` : 'item-grade is-unknown';
    gradeLabel.textContent = classification.grade ?? 'Grade 未取得';
    info.append(gradeLabel);
    if (type !== 'other') {
      const typeLabel = document.createElement('small');
      typeLabel.className = 'item-type';
      typeLabel.textContent = type;
      info.append(typeLabel);
    }
    const qualityLabel = document.createElement('small'); qualityLabel.className = 'item-quality';
    qualityLabel.textContent = classification.quality === null ? 'Quality 未取得' : `${classification.quality}%`;
    info.append(qualityLabel);
    const price = document.createElement('span');
    price.className = 'price item-price';
    price.textContent = priceView.expiredFx && !observation ? '参考円価格は更新待ち'
      : importedText.get(item.marketHashName) ?? item.priceText ?? '価格情報なし';
    if (observation) {
      const detail = document.createElement('small');
      detail.className = 'item-price-note';
      detail.textContent = '参考価格';
      card.dataset.marketObservation = 'imported';
      price.append(detail);
    }
    if (item.priceText && snapshot.priceSource === 'fx') {
      // Converted yen must remain visibly distinct from a Steam JPY listing.
      const note = document.createElement('small');
      note.textContent = '参考価格・為替換算';
      price.append(note);
    }
    const observedAt = observation?.observedAt ?? usdSnapshot?.fetchedAt ?? null;
    let staleLabel: HTMLElement | null = null;
    if (observedAt && isObservationStale(observedAt)) {
      staleLabel = document.createElement('small');
      staleLabel.className = 'item-stale';
      staleLabel.textContent = `古い観測 · ${formatObservedAt(observedAt)}`;
      staleLabel.setAttribute('aria-label', `24時間以上前の観測、${formatObservedAt(observedAt)}`);
    }
    const steamLink = document.createElement('a');
    steamLink.className = 'item-steam';
    steamLink.href = link;
    steamLink.target = '_blank';
    steamLink.rel = 'noopener noreferrer';
    steamLink.setAttribute('aria-label', isDemoPreview ? 'Steam Marketを開く' : `${item.name}をSteam Marketで開く`);
    steamLink.textContent = isDemoPreview ? 'Steam検索 ↗' : 'Steam ↗';
    const favoriteButton = document.createElement('button');
    favoriteButton.type = 'button';
    favoriteButton.className = 'favorite-button';
    favoriteButton.setAttribute('aria-pressed', String(favorites.has(item.marketHashName)));
    favoriteButton.setAttribute('aria-label', favorites.has(item.marketHashName) ? `${item.name}をウォッチリストから解除` : `${item.name}をウォッチリストに追加`);
    favoriteButton.textContent = favorites.has(item.marketHashName) ? '★' : '☆';
    favoriteButton.addEventListener('click', () => setFavorite(item.marketHashName));
    const compareButton = document.createElement('button');
    compareButton.type = 'button'; compareButton.className = 'compare-toggle';
    compareButton.setAttribute('aria-pressed', String(selectedForCompare.has(item.marketHashName)));
    compareButton.textContent = selectedForCompare.has(item.marketHashName) ? '✓ 比較' : '+ 比較';
    compareButton.setAttribute('aria-label', selectedForCompare.has(item.marketHashName) ? `${item.name}を比較から外す` : `${item.name}を比較に追加`);
    compareButton.addEventListener('click', () => {
      if (selectedForCompare.has(item.marketHashName)) selectedForCompare.delete(item.marketHashName);
      else if (selectedForCompare.size >= 4) compareCountNode.textContent = '比較は4商品までです';
      else {
        const type = classifyItemName(item.marketHashName).type;
        const firstSelected = [...selectedForCompare].map(key => currentMarketItems.find(candidate => candidate.marketHashName === key)).find(Boolean);
        const selectedType = firstSelected ? classifyItemName(firstSelected.marketHashName).type : null;
        if (firstSelected && type !== selectedType) compareCountNode.textContent = '同じTypeの商品を選んでください';
        else selectedForCompare.add(item.marketHashName);
      }
      render();
    });
    main.append(imageBox, name, info, price, listings);
    if (staleLabel) main.append(staleLabel);
    card.append(main, favoriteButton, compareButton, steamLink);
    fragment.append(card);
  }
  itemsNode.append(fragment);
  refreshCompareControls();
}

function displayedPrice(item: ListedItem): string {
  return item.importedPriceText ?? item.priceText ?? '価格情報なし';
}

function itemObservedAt(item: ListedItem): string | null {
  return importedObservations.get(item.marketHashName)?.observedAt ?? item.observation?.observedAt ?? usdSnapshot?.fetchedAt ?? null;
}

function updateGradeAvailability(items: ListedItem[]): void {
  // Item names currently provide no verified grade source. Disable grade filters instead of
  // letting an unavailable attribute silently produce an empty market result.
  const hasVerifiedGrade = items.some(item => classifyItemName(item.marketHashName).grade !== null);
  gradeOptionsNode.disabled = !hasVerifiedGrade;
  minimumGradeSelect.disabled = !hasVerifiedGrade;
  recommendGradeSelect.disabled = !hasVerifiedGrade;
  gradeFilterStatusNode.hidden = hasVerifiedGrade;
  if (!hasVerifiedGrade) {
    for (const input of Array.from(gradeOptionsNode.querySelectorAll<HTMLInputElement>('input'))) input.checked = false;
    minimumGradeSelect.value = '';
    recommendGradeSelect.value = '';
  }
}

function makeFeatureLink(item: ListedItem): HTMLAnchorElement {
  const link = document.createElement('a'); link.href = safeSteamUrl(item.steamUrl) ?? 'https://steamcommunity.com/market/search?appid=5084200';
  link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Steam ↗';
  return link;
}

function renderRecommendations() {
  const currency = recommendCurrencySelect.value as 'USD' | 'JPY';
  const budget = recommendBudgetInput.value.trim() ? parsePriceFilterInput(recommendBudgetInput.value, currency) : { value: null, error: null };
  recommendBudgetInput.setCustomValidity(budget.error ?? '');
  if (budget.error) { recommendBudgetInput.reportValidity(); return; }
  const options = {
    type: recommendTypeSelect.value as ItemType,
    minimumGrade: (recommendGradeSelect.value || null) as ItemGrade | null,
    minimumQuality: recommendQualitySelect.value ? Number(recommendQualitySelect.value) : null,
    budgetMinor: budget.value,
    currency,
    priority: recommendPrioritySelect.value as RecommendationPriority,
  };
  const results = recommendEquipment(currentMarketItems, options);
  recommendResultsNode.replaceChildren();
  const itemAges = currentMarketItems.map(item => itemObservedAt(item)).filter((value): value is string => value !== null);
  const staleCount = itemAges.filter(isObservationStale).length;
  const latestObservation = itemAges.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  recommendStalenessNode.textContent = latestObservation
    ? `最終観測 ${formatObservedAt(latestObservation)}${staleCount ? ` · ${staleCount}件は24時間超` : ''}`
    : '観測日時未取得';
  const hasAnyGrade = currentMarketItems.some(item => classifyItemName(item.marketHashName).grade !== null);
  recommendMethodNode.textContent = hasAnyGrade
    ? 'バランスは同じType内でGrade 45・Quality 35・価格 20を比較します。不明項目は除外し、利用可能な重みを調整します。'
    : 'Grade情報未取得 · バランスはQuality 35・価格 20を利用可能な項目に合わせて調整します。';
  if (results.length === 0) {
    const empty = document.createElement('p'); empty.className = 'recommend-empty';
    empty.textContent = '条件に合う商品がありません。最低Grade・Quality・予算を緩めてください。';
    recommendResultsNode.append(empty); return;
  }
  for (const [index, result] of results.entries()) {
    const row = document.createElement('article'); row.className = 'feature-result';
    const title = document.createElement('strong'); title.textContent = result.item.name;
    const classification = classifyItemName(result.item.marketHashName);
    const facts = document.createElement('span');
    const observedAt = itemObservedAt(result.item);
    const staleText = observedAt && isObservationStale(observedAt) ? ' · 古い観測' : '';
    facts.textContent = `${classification.grade ?? 'Grade未取得'} · ${classification.quality === null ? 'Quality未取得' : `${classification.quality}%`} · ${displayedPrice(result.item)} · 出品 ${result.item.listings ?? '未取得'}件 · ${observedAt ? `観測 ${formatObservedAt(observedAt)}` : '観測日時未取得'}${staleText}`;
    const reason = document.createElement('small'); reason.textContent = `${index + 1}位 · ${result.reason}${result.score === null ? '' : ` · ${result.score.toFixed(1)}点`}${result.criteria ? ` · 評価 ${result.criteria}` : ''}`;
    const comparison = comparisonFor(result.item.marketHashName);
    if (comparison) reason.textContent += ` · 同Type・Quality帯 ${comparison.qualityBand}の${comparison.groupSize}商品中央値 ${usdReference(Math.round(comparison.medianMinor))}との参考差 ${signedAmount(comparison.deltaMinor)}（性能差未確認）`;
    const favoriteButton = document.createElement('button'); favoriteButton.type = 'button'; favoriteButton.className = 'recommend-watch';
    favoriteButton.textContent = favorites.has(result.item.marketHashName) ? '★ 登録済み' : '☆ ウォッチ';
    favoriteButton.setAttribute('aria-pressed', String(favorites.has(result.item.marketHashName)));
    favoriteButton.addEventListener('click', () => setFavorite(result.item.marketHashName));
    row.append(title, facts, reason, makeFeatureLink(result.item), favoriteButton);
    if (comparison) {
      const showComparison = document.createElement('button'); showComparison.type = 'button'; showComparison.className = 'recommend-value-link'; showComparison.textContent = '価格分布を見る';
      showComparison.addEventListener('click', () => {
        showAllValues = true;
        comparisonTypeSelect.value = comparison.type;
        renderReferenceAnalysis();
        recommendDialog.close();
        document.querySelector('#value-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      row.append(showComparison);
    }
    recommendResultsNode.append(row);
  }
}

function renderComparison() {
  compareTableNode.replaceChildren();
  const selected = [...selectedForCompare].map(key => currentMarketItems.find(item => item.marketHashName === key))
    .filter((item): item is ListedItem => item !== undefined);
  if (selected.length < 2 || selected.length > 4) return;
  const table = document.createElement('table'); table.className = 'comparison-grid';
  const head = table.createTHead().insertRow();
  const blank = document.createElement('th'); blank.scope = 'col'; blank.textContent = '項目'; head.append(blank);
  for (const item of selected) { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = item.name; head.append(cell); }
  const rows: Array<[string, (item: ListedItem) => string]> = [
    ['Grade', item => classifyItemName(item.marketHashName).grade ?? '未取得'],
    ['Type', item => classifyItemName(item.marketHashName).type ?? '未取得'],
    ['Quality', item => { const value = classifyItemName(item.marketHashName).quality; return value === null ? '未取得' : `${value}%`; }],
    ['参考価格', displayedPrice],
    ['出品数', item => item.listings === null ? '未取得' : `${item.listings.toLocaleString('ja-JP')}件`],
    ['最終観測', item => { const observedAt = importedObservations.get(item.marketHashName)?.observedAt ?? usdSnapshot?.fetchedAt; return observedAt ? formatObservedAt(observedAt) : '未取得'; }],
  ];
  const body = table.createTBody();
  for (const [label, valueFor] of rows) {
    const row = body.insertRow(); const heading = document.createElement('th'); heading.scope = 'row'; heading.textContent = label; row.append(heading);
    for (const item of selected) { const cell = row.insertCell(); cell.textContent = valueFor(item); }
  }
  const linkRow = body.insertRow(); const linkHeading = document.createElement('th'); linkHeading.scope = 'row'; linkHeading.textContent = 'Steam'; linkRow.append(linkHeading);
  for (const item of selected) { const cell = linkRow.insertCell(); cell.append(makeFeatureLink(item)); }
  compareTableNode.append(table);
}

function rawWatchPrice(marketHashName: string): { priceMinor: number; observedAt: string; listings: number | null } | null {
  const imported = importedObservations.get(marketHashName);
  if (imported) {
    const priceMinor = imported.priceMinor ?? parseUsdReferenceMinor(imported.referencePriceText);
    return priceMinor === null ? null : { priceMinor, observedAt: imported.observedAt, listings: imported.listings };
  }
  const item = usdSnapshot?.items.find(candidate => candidate.marketHashName === marketHashName);
  return item?.priceMinor === null || item?.priceMinor === undefined || !usdSnapshot?.fetchedAt
    ? null : { priceMinor: item.priceMinor, observedAt: usdSnapshot.fetchedAt, listings: item.listings };
}

function formattedTarget(target: WatchTarget): string {
  const amount = target.priceMinor / 100;
  return target.currency === 'USD'
    ? `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `¥${amount.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`;
}

function updateWatchlistSummary() {
  watchlistCountNode.textContent = favorites.size.toLocaleString('ja-JP');
  const reached: string[] = [];
  for (const [marketHashName, target] of watchTargets) {
    if (!favorites.has(marketHashName)) continue;
    const current = rawWatchPrice(marketHashName);
    const status = evaluateWatchTarget(target, current ? { currency: 'USD', priceMinor: current.priceMinor, observedAt: current.observedAt } : null,
      currentFxRate?.rate ?? null);
    if (status === 'reached') reached.push(marketHashName);
  }
  watchAlertNode.hidden = reached.length === 0;
  watchAlertNode.textContent = reached.length
    ? `目標価格に到達した商品が${reached.length.toLocaleString('ja-JP')}件あります。読み込み済みの観測値で判定しています。`
    : '';
}

function renderWatchlist() {
  updateWatchlistSummary();
  watchlistItemsNode.replaceChildren();
  const query = watchlistSearchInput.value.trim().toLocaleLowerCase();
  const entries = [...favorites].map(marketHashName => {
    const item = displayItemsByKey.get(marketHashName) ?? null;
    return { marketHashName, item, name: item?.name ?? marketHashName };
  }).filter(entry => entry.name.toLocaleLowerCase().includes(query));
  const direction = watchlistSortSelect.value;
  const collator = new Intl.Collator('ja', { sensitivity: 'base' });
  const displayPrice = (entry: typeof entries[number]) => {
    const item = entry.item;
    if (!item) return null;
    if (item.comparisonPriceMinor !== undefined) return item.comparisonCurrency === currencySelect.value ? item.comparisonPriceMinor : null;
    return item.priceMinor;
  };
  const targetStatus = (entry: typeof entries[number]) => {
    const target = watchTargets.get(entry.marketHashName);
    const current = rawWatchPrice(entry.marketHashName);
    return target ? evaluateWatchTarget(target, current ? { currency: 'USD', priceMinor: current.priceMinor, observedAt: current.observedAt } : null,
      currentFxRate?.rate ?? null) : 'missing';
  };
  entries.sort((left, right) => {
    if (direction === 'reached') {
      const score = (entry: typeof entries[number]) => targetStatus(entry) === 'reached' ? 0 : 1;
      return score(left) - score(right) || collator.compare(left.name, right.name);
    }
    if (direction === 'drop') {
      const a = observationChange(importedSnapshot, left.marketHashName)?.pricePercent ?? null;
      const b = observationChange(importedSnapshot, right.marketHashName)?.pricePercent ?? null;
      if (a === null) return b === null ? collator.compare(left.name, right.name) : 1;
      if (b === null) return -1;
      return a - b || collator.compare(left.name, right.name);
    }
    if (direction === 'name') return collator.compare(left.name, right.name);
    if (direction === 'listings-desc') {
      const a = left.item?.listings ?? null; const b = right.item?.listings ?? null;
      if (a === null) return b === null ? collator.compare(left.name, right.name) : 1;
      if (b === null) return -1;
      return b - a || collator.compare(left.name, right.name);
    }
    const a = displayPrice(left); const b = displayPrice(right);
    if (a === null) return b === null ? collator.compare(left.name, right.name) : 1;
    if (b === null) return -1;
    return (direction === 'price-desc' ? b - a : a - b) || collator.compare(left.name, right.name);
  });
  watchlistStatusNode.textContent = favorites.size
    ? `${entries.length.toLocaleString('ja-JP')}件表示 · 観測の有効期間24時間`
    : '商品一覧の☆から登録できます。';
  if (!entries.length) return;
  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const { marketHashName, item, name } = entry;
    const target = watchTargets.get(marketHashName) ?? null;
    const current = rawWatchPrice(marketHashName);
    const status = target ? evaluateWatchTarget(target,
      current ? { currency: 'USD', priceMinor: current.priceMinor, observedAt: current.observedAt } : null,
      currentFxRate?.rate ?? null) : 'missing';
    const row = document.createElement('article');
    row.className = `watch-row${status === 'reached' ? ' watch-target-reached' : ''}`;
    const imageBox = createItemArtwork(name, item?.imageUrl ?? null, 'watch-row-image');
    row.append(imageBox);
    const content = document.createElement('div'); content.className = 'watch-row-content';
    const title = document.createElement('button'); title.type = 'button'; title.className = 'watch-row-title';
    title.textContent = name;
    title.disabled = !item;
    title.addEventListener('click', () => { if (item) void openHistory(item); });
    const currentLabel = document.createElement('p');
    const shownPrice = item?.importedPriceText ?? item?.priceText ?? '価格情報なし';
    const listings = item?.listings ?? current?.listings ?? null;
    const observedAt = current?.observedAt ?? item?.observation?.observedAt ?? usdSnapshot?.fetchedAt ?? null;
    currentLabel.textContent = `${shownPrice} · ${listings === null ? '出品数未取得' : `出品 ${listings.toLocaleString('ja-JP')}件`}${observedAt ? ` · ${formatObservedAt(observedAt)}${isObservationStale(observedAt) ? '（古い観測）' : ''}` : ''}`;
    const distance = target ? watchTargetDistance(target, current ? { currency: 'USD', priceMinor: current.priceMinor, observedAt: current.observedAt } : null,
      currentFxRate?.rate ?? null) : null;
    const state = document.createElement('p'); state.className = `watch-target-state${status === 'reached' ? ' is-reached' : ''}`;
    state.textContent = !target ? '目標価格未設定' : status === 'reached'
      ? `目標到達 · ${formattedTarget(target)}` : status === 'not-reached'
        ? `未到達 · ${target.direction === 'buy-at-or-below' ? '以下' : '以上'} ${formattedTarget(target)}${distance === null ? '' : ` · あと${target.currency === 'USD' ? usdReference(distance) : `¥${Math.round(distance / 100).toLocaleString('ja-JP')}`}`}`
        : status === 'stale' ? '古い観測のため判定なし'
          : status === 'fx-unavailable' ? '為替未取得のため判定なし' : '価格未取得のため判定なし';
    content.append(title, currentLabel, state);
    const change = observationChange(importedSnapshot, marketHashName);
    if (change) {
      const movement = document.createElement('p'); movement.className = `watch-movement${change.priceDelta !== null && change.priceDelta < 0 ? ' is-falling' : ''}`;
      movement.textContent = `前回観測比 ${change.priceDelta === null ? '価格比較なし' : `${change.priceDelta < 0 ? '値下がり ' : change.priceDelta > 0 ? '値上がり ' : '変化なし '}${signedAmount(change.priceDelta)}`}${change.pricePercent === null ? '' : ` (${change.pricePercent > 0 ? '+' : ''}${change.pricePercent.toFixed(1)}%)`} · 出品 ${change.listingsDelta === null ? '比較なし' : `${change.listingsDelta > 0 ? '+' : ''}${change.listingsDelta}件`} · ${formatObservedAt(change.previous.observedAt)} → ${formatObservedAt(change.latest.observedAt)}`;
      content.append(movement);
    }
    const form = document.createElement('form'); form.className = 'watch-target-form';
    const conditionLabel = document.createElement('label'); conditionLabel.textContent = '条件';
    const condition = document.createElement('select'); condition.name = 'direction';
    condition.add(new Option('購入 · 以下', 'buy-at-or-below'));
    condition.add(new Option('売却 · 以上', 'sell-at-or-above'));
    condition.value = target?.direction ?? 'buy-at-or-below'; conditionLabel.append(condition);
    const currencyLabel = document.createElement('label'); currencyLabel.textContent = '通貨';
    const targetCurrency = document.createElement('select'); targetCurrency.name = 'currency';
    targetCurrency.add(new Option('USD', 'USD')); targetCurrency.add(new Option('JPY', 'JPY'));
    targetCurrency.value = target?.currency ?? currencySelect.value; currencyLabel.append(targetCurrency);
    const priceLabel = document.createElement('label'); priceLabel.textContent = '目標価格';
    const priceInput = document.createElement('input'); priceInput.name = 'price'; priceInput.type = 'number'; priceInput.min = '0';
    priceInput.step = targetCurrency.value === 'USD' ? '0.01' : '1'; priceInput.inputMode = 'decimal';
    priceInput.value = target ? target.currency === 'USD' ? (target.priceMinor / 100).toFixed(2) : String(target.priceMinor / 100) : '';
    priceInput.placeholder = targetCurrency.value === 'USD' ? '0.00' : '0'; priceLabel.append(priceInput);
    targetCurrency.addEventListener('change', () => { priceInput.step = targetCurrency.value === 'USD' ? '0.01' : '1'; priceInput.placeholder = targetCurrency.value === 'USD' ? '0.00' : '0'; });
    const saveTarget = document.createElement('button'); saveTarget.type = 'submit'; saveTarget.textContent = '目標を保存';
    form.append(conditionLabel, currencyLabel, priceLabel, saveTarget);
    const formError = document.createElement('small'); formError.className = 'watch-form-error'; formError.setAttribute('role', 'status');
    form.addEventListener('submit', event => {
      event.preventDefault();
      const parsed = parseWatchTargetPrice(priceInput.value, targetCurrency.value as 'USD' | 'JPY');
      if (parsed.error || parsed.priceMinor === null) { formError.textContent = parsed.error ?? '目標価格を入力してください。'; return; }
      try {
        watchTargets = setWatchTarget(watchTargets, marketHashName, { currency: targetCurrency.value as 'USD' | 'JPY',
          direction: condition.value as WatchDirection, priceMinor: parsed.priceMinor });
        saveValue(WATCH_TARGETS_KEY, serializeWatchTargets(watchTargets));
        renderWatchlist();
      } catch (error) { console.warn('Watch target could not be saved', error); formError.textContent = '目標を保存できませんでした。'; }
    });
    form.append(formError);
    const actions = document.createElement('div'); actions.className = 'watch-row-actions';
    const steamLink = document.createElement('a'); steamLink.className = 'item-steam';
    const candidateUrl = isDemoPreview ? 'https://steamcommunity.com/market/search?appid=5084200'
      : item?.steamUrl ?? `https://steamcommunity.com/market/listings/5084200/${encodeURIComponent(marketHashName)}`;
    const safeLink = safeSteamUrl(candidateUrl);
    if (isDemoPreview) { steamLink.href = candidateUrl; steamLink.target = '_blank'; steamLink.rel = 'noopener noreferrer'; steamLink.textContent = 'Steam検索 ↗'; }
    else if (safeLink) { steamLink.href = safeLink; steamLink.target = '_blank'; steamLink.rel = 'noopener noreferrer'; steamLink.textContent = 'Steam ↗'; }
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'watch-remove';
    remove.textContent = '解除'; remove.setAttribute('aria-label', `${name}をウォッチリストから解除`);
    remove.addEventListener('click', () => setFavorite(marketHashName));
    actions.append(steamLink, remove);
    row.append(content, form, actions); fragment.append(row);
  }
  watchlistItemsNode.append(fragment);
}

function setFavorite(marketHashName: string) {
  const wasFavorite = favorites.has(marketHashName);
  favorites = toggleFavorite(favorites, marketHashName);
  saveValue(WATCHLIST_KEY, JSON.stringify([...favorites]));
  if (wasFavorite) {
    watchTargets = setWatchTarget(watchTargets, marketHashName, null);
    saveValue(WATCH_TARGETS_KEY, serializeWatchTargets(watchTargets));
  }
  render();
  if (recommendDialog.open) renderRecommendations();
  if (activeHistoryItem?.marketHashName === marketHashName) {
    historyFavoriteButton.setAttribute('aria-pressed', String(favorites.has(marketHashName)));
    historyFavoriteButton.textContent = favorites.has(marketHashName) ? '★ ウォッチ中' : '☆ ウォッチ';
  }
}

function renderOverview() {
  if (!usdSnapshot) return;
  const selection = selectMarketDisplayItems(usdSnapshot.items, usdSnapshot.fetchedAt,
    latestObservedItems(importedSnapshot), 'USD', currentFxRate?.rate ?? null);
  const combined = selection.items;
  const imported = [...selection.imported.values()];
  const overview = summarizeMarket(combined);
  overviewItemsNode.textContent = combined.length ? overview.itemTypes.toLocaleString('ja-JP') : '未取得';
  const observedAtValues = new Set([
    ...(usdSnapshot.fetchedAt ? [usdSnapshot.fetchedAt] : []),
    ...imported.map(item => item.observation?.observedAt).filter((value): value is string => typeof value === 'string'),
  ]);
  overviewListingsNode.textContent = combined.length === 0 || overview.totalListings === null ? '未取得'
    : observedAtValues.size > 1 ? '商品別に表示' : overview.totalListings.toLocaleString('ja-JP');
  const lastObserved = [usdSnapshot.fetchedAt, ...imported.map(item => item.observation?.observedAt ?? null)]
    .filter((value): value is string => typeof value === 'string').sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  overviewUpdatedNode.textContent = lastObserved
    ? `${formatObservedAt(lastObserved)}${isObservationStale(lastObserved) ? ' · 古い観測' : ''}`
    : '未取得';
  overviewFxNode.textContent = formatFxRateLabel(currentFxRate)?.replace(/^参考為替：/, '') ?? '未取得';
}

function renderRankings() {
  rankingListNode.replaceChildren();
  const period = rankingPeriodSelect.value as '24h' | '7d';
  const section = rankingSnapshot?.periods[period];
  if (!section || (!section.up.length && !section.down.length)) {
    const hours = period === '24h' ? 24 : 168;
    const comparable = importedSnapshot?.products.flatMap(product => {
      const change = periodChange(importedSnapshot, product.marketHashName, hours);
      return change?.priceDelta === null || change?.priceDelta === undefined ? [] : [change];
    }) ?? [];
    if (!comparable.length) { rankingStatusNode.textContent = `${period === '24h' ? '24時間' : '7日間'}の比較データは蓄積中です。`; return; }
    rankingStatusNode.textContent = `参考価格の${period === '24h' ? '24時間' : '7日間'}比較 · 価格基準確認中`;
    for (const [title, entries] of [['値上がり', comparable.filter(change => change.priceDelta! > 0).sort((a, b) => b.priceDelta! - a.priceDelta!)],
      ['値下がり', comparable.filter(change => change.priceDelta! < 0).sort((a, b) => a.priceDelta! - b.priceDelta!)]] as const) {
      const column = document.createElement('section'); column.className = 'ranking-column';
      const heading = document.createElement('h3'); heading.textContent = title; column.append(heading);
      if (!entries.length) { const empty = document.createElement('p'); empty.textContent = '該当なし'; column.append(empty); }
      for (const change of entries.slice(0, 5)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'ranking-row';
        button.textContent = `${change.marketHashName} · ${signedAmount(change.priceDelta!)} · ${formatObservedAt(change.previous.observedAt)} → ${formatObservedAt(change.latest.observedAt)}`;
        button.addEventListener('click', () => { const item = displayItemsByKey.get(change.marketHashName); if (item) void openHistory(item); }); column.append(button);
      }
      rankingListNode.append(column);
    }
    return;
  }
  rankingStatusNode.textContent = `基準時刻±${section.toleranceHours}時間以内に観測点がある商品だけを比較`;
  for (const [kind, entries] of [['値上がり', section.up], ['値下がり', section.down]] as const) {
    const column = document.createElement('section');
    column.className = 'ranking-column';
    const heading = document.createElement('h3'); heading.textContent = kind; column.append(heading);
    if (entries.length === 0) {
      const empty = document.createElement('p'); empty.textContent = '該当なし'; column.append(empty);
    }
    for (const entry of entries) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ranking-row';
      const itemName = document.createElement('strong'); itemName.textContent = entry.marketHashName;
      const multiplier = currentFxRate?.rate ?? null;
      const change = currencySelect.value === 'USD'
        ? formatHistoryPrice(Math.abs(entry.changeCents) / 100, 'USD')
        : multiplier === null ? '参考円価格は更新待ち' : formatHistoryPrice(Math.round(Math.abs(entry.changeCents) * multiplier / 100), 'JPY');
      const value = document.createElement('span'); value.textContent = `${entry.changeCents > 0 ? '+' : '−'}${change} · ${entry.changePercent > 0 ? '+' : ''}${entry.changePercent.toFixed(1)}%`;
      button.append(itemName, value);
      button.addEventListener('click', () => {
        const item = usdSnapshot?.items.find(candidate => candidate.marketHashName === entry.marketHashName);
        if (item) void openHistory(item);
      });
      column.append(button);
    }
    rankingListNode.append(column);
  }
}

async function load(currency: 'JPY' | 'USD') {
  const sequence = ++loadSequence;
  statusNode.hidden = false;
  statusNode.textContent = 'マーケットデータを読み込んでいます…';
  itemsNode.hidden = true;
  countNode.textContent = '読み込み中';
  updatedNode.textContent = '更新日時 —';
  try {
    const [response, fxValue, historyIndexValue, rankingValue, observationsValue] = await Promise.all([
      fetch(isDemoPreview ? '/watchlist-preview-market.json' : '/market-usd.json', { cache: 'no-cache' }),
      readOptionalJson('/fx-rate.json'),
      isDemoPreview ? Promise.resolve(null) : readOptionalJson('/history/index.json'),
      isDemoPreview ? Promise.resolve(null) : readOptionalJson('/market-rankings.json'),
      isDemoPreview ? Promise.resolve(null) : readOptionalJson('/market-observations.json'),
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value: unknown = await response.json();
    if (!isSnapshot(value) || value.currency !== 'USD') throw new Error('Invalid USD snapshot');
    if (sequence !== loadSequence) return;
    currentFxRate = parseFreshFxRate(fxValue);
    historyIndex = parseHistoryIndex(historyIndexValue);
    rankingSnapshot = parseRankingSnapshot(rankingValue);
    importedSnapshot = parseMarketObservations(observationsValue);
    // Preview timestamps are generated only on this isolated route so goal
    // interactions stay testable; they never enter market JSON or price history.
    usdSnapshot = isDemoPreview ? { ...value, fetchedAt: new Date().toISOString() } : value;
    snapshot = currencyView(value, currency, currentFxRate?.rate ?? null);
    renderOverview();
    renderRankings();
    const priceView = prepareMarketPriceView(snapshot.items, snapshot.currency, snapshot.priceSource, currentFxRate?.rateDate);
    const latestCapture = importedSnapshot?.imports.at(-1);
    const baseNote = priceView.expiredFx
      ? '為替レートの期限切れにより、JPY参考価格を表示していません。商品情報はSteamでご確認ください。'
      : snapshot.priceSource === 'fx'
        ? 'JPYはSteamのUSD最安価格を為替換算した参考価格です。購入時はSteamでご確認ください。'
      : '価格は取得時点の最安出品価格です。購入時はSteamでご確認ください。';
    noteNode.textContent = isDemoPreview
      ? 'デモ用の架空データです。実際のSteam商品・相場・観測値ではありません。'
      : latestCapture?.sourceKind === 'query-action'
      ? '取込データは商品ごとの部分観測です。queryActionのUSD表示額は参考値で、価格基準確認中です。購入前にSteamでご確認ください。'
      : latestCapture?.sourceKind === 'steam-dom'
        ? `${importedSnapshot && importedSnapshot.products.length !== latestCapture.pageSize ? `保持${importedSnapshot.products.length}件・直近` : ''}${latestCapture.pageSize}/${latestCapture.totalCount}件を部分観測。価格順・価格帯は選択通貨の表示参考価格で比較します。JPYは有効な為替レートがある場合のみ換算します。価格基準は未確認です。`
      : latestCapture
        ? '取込データはSteam応答の部分観測です。表示価格と出品数には商品ごとの観測日時を付けています。購入前にSteamでご確認ください。'
        : baseNote;
    if (snapshot.fetchedAt) {
      const date = new Date(snapshot.fetchedAt);
      if (!Number.isNaN(date.valueOf())) {
        updatedNode.textContent = `取得 ${new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(date)}`;
      }
    }
    if (snapshot.priceSource === 'fx' && currentFxRate) {
      const rateDate = new Date(currentFxRate.fetchedAt);
      if (!Number.isNaN(rateDate.valueOf())) {
        updatedNode.textContent += priceView.expiredFx
          ? ` · 為替レート期限切れ（${currentFxRate.rateDate}・Frankfurter）`
          : ` · 為替 ${currentFxRate.rate}円/USD（${currentFxRate.rateDate}・Frankfurter、取得 ${new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(rateDate)}）`;
      }
    }
    // Static snapshots can outlive a failed refresh; show the true capture time.
    if (snapshot.status === 'ok' && snapshot.fetchedAt && Date.now() - Date.parse(snapshot.fetchedAt) > 24 * 60 * 60 * 1000) {
      updatedNode.textContent += ' · 古いデータ';
    }
    render();
  } catch (error) {
    if (sequence !== loadSequence) return;
    console.error('Market snapshot load failed', error);
    countNode.textContent = 'データを表示できません';
    statusNode.textContent = 'データを読み込めませんでした。時間をおいて再読み込みしてください。';
  }
}

search.addEventListener('input', render);
sort.addEventListener('change', render);
filterForm.addEventListener('input', render);
filterForm.addEventListener('change', render);
filterForm.addEventListener('reset', () => {
  window.setTimeout(() => { search.value = ''; sort.value = 'price-asc'; render(); }, 0);
});
currencySelect.addEventListener('change', () => {
  const currency = currencySelect.value === 'USD' ? 'USD' : 'JPY';
  saveValue('tbcm-currency', currency);
  recommendCurrencySelect.value = currency;
  recommendBudgetInput.step = currency === 'USD' ? '0.01' : '1';
  void load(currency);
});
historyClose.addEventListener('click', () => historyDialog.close());
watchlistOpenButton.addEventListener('click', () => { renderWatchlist(); watchlistDialog.showModal(); });
watchlistCloseButton.addEventListener('click', () => watchlistDialog.close());
watchlistSearchInput.addEventListener('input', renderWatchlist);
watchlistSortSelect.addEventListener('change', renderWatchlist);
historyRange.addEventListener('change', renderHistoryChart);
historyCurrency.addEventListener('change', renderHistoryChart);
rankingPeriodSelect.addEventListener('change', renderRankings);
valueMoreButton.addEventListener('click', () => { showAllValues = !showAllValues; renderReferenceAnalysis(); });
comparisonTypeSelect.addEventListener('change', () => { showAllValues = false; renderReferenceAnalysis(); });
historyFavoriteButton.addEventListener('click', () => {
  if (activeHistoryItem) setFavorite(activeHistoryItem.marketHashName);
});
for (const input of [indicatorSma, indicatorBands, indicatorRsi]) input.addEventListener('change', renderHistoryChart);
recommendOpenButton.addEventListener('click', () => {
  recommendCurrencySelect.value = currencySelect.value;
  recommendBudgetInput.step = recommendCurrencySelect.value === 'USD' ? '0.01' : '1';
  renderRecommendations(); recommendDialog.showModal();
});
recommendCloseButton.addEventListener('click', () => recommendDialog.close());
recommendForm.addEventListener('submit', event => { event.preventDefault(); renderRecommendations(); });
recommendCurrencySelect.addEventListener('change', () => {
  currencySelect.value = recommendCurrencySelect.value;
  const currency = recommendCurrencySelect.value as 'USD' | 'JPY';
  saveValue('tbcm-currency', currency);
  recommendBudgetInput.step = currency === 'USD' ? '0.01' : '1';
  void load(currency).then(renderRecommendations);
});
compareOpenButton.addEventListener('click', () => { renderComparison(); compareDialog.showModal(); });
compareCloseButton.addEventListener('click', () => compareDialog.close());
historyDialog.addEventListener('close', () => { historyLoadSequence += 1; activeHistoryItem = null; });
void load(currencySelect.value as 'JPY' | 'USD');
