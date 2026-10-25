import './style.css';
import { formatFxRateLabel, parseFreshFxRate, prepareMarketPriceView, type FxRateRecord, type MarketSnapshot } from './market';
import { latestObservedItems, parseMarketObservations, parseUsdReferenceMinor, selectMarketDisplayItems, type ListedItem, type MarketObservations, type ObservationPoint } from './market-observations';
import { filterHistoryPoints, formatHistoryPrice, makeChartPoints, parseHistoryIndex, parseProductHistory, type HistoryCurrency, type HistoryIndex, type HistoryRange, type ProductHistory } from './history';
import { calculateTechnicalIndicators, currencyView, filterMarketItems, parseFavorites, parsePriceFilterInput, parseRankingSnapshot, priceStatistics, summarizeMarket, toggleFavorite, type MarketSort, type RankingSnapshot } from './market-features';
import { evaluateWatchTarget, mergeFavoriteKeys, parseWatchTargetPrice, parseWatchTargets, serializeWatchTargets, setWatchTarget, WATCH_TARGETS_STORAGE_KEY, type WatchDirection, type WatchTarget } from './watchlist';

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
const indicatorSma = document.querySelector<HTMLInputElement>('#indicator-sma')!;
const indicatorBands = document.querySelector<HTMLInputElement>('#indicator-bands')!;
const indicatorRsi = document.querySelector<HTMLInputElement>('#indicator-rsi')!;
const indicatorStatus = document.querySelector<HTMLParagraphElement>('#indicator-status')!;
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

type ItemType = 'sword' | 'boots' | 'ring' | 'bracelet' | 'chestplate' | 'gloves' | 'helmet' | 'necklace' | 'pants' | 'chest' | 'other';

const ITEM_TYPE_PATHS: Record<ItemType, string[]> = {
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

function itemTypeFromName(name: string): ItemType {
  const normalized = name.toLocaleLowerCase('en-US');
  const suffix = /(?:^|\s)(sword|boots|ring|bracelet|chestplate|gloves|helmet|necklace|pants)\s*(?:\d+%?)?$/.exec(normalized)?.[1];
  if (suffix) return suffix as ItemType;
  if (/^chest\s+lv\.\d+$/i.test(name)) return 'chest';
  return 'other';
}

function appendTypeGlyph(box: HTMLElement, type: ItemType) {
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
    historyStatus.textContent = 'この取込観測は価格履歴に接続していません。';
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
  displayItemsByKey = new Map(allItems.map(item => [item.marketHashName, item]));
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
  }, sort.value as MarketSort);
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
    const type = itemTypeFromName(item.name);
    if (type !== 'other') {
      const typeLabel = document.createElement('small');
      typeLabel.className = 'item-type';
      typeLabel.textContent = type === 'chestplate' ? 'Chestplate' : type[0].toUpperCase() + type.slice(1);
      info.append(typeLabel);
    }
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
    main.append(imageBox, name, info, price, listings);
    card.append(main, favoriteButton, steamLink);
    fragment.append(card);
  }
  itemsNode.append(fragment);
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
  entries.sort((left, right) => {
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
    currentLabel.textContent = `${shownPrice} · ${listings === null ? '出品数未取得' : `出品 ${listings.toLocaleString('ja-JP')}件`}${observedAt ? ` · ${formatObservedAt(observedAt)}` : ''}`;
    const state = document.createElement('p'); state.className = `watch-target-state${status === 'reached' ? ' is-reached' : ''}`;
    state.textContent = !target ? '目標価格未設定' : status === 'reached'
      ? `目標到達 · ${formattedTarget(target)}` : status === 'not-reached'
        ? `未到達 · ${target.direction === 'buy-at-or-below' ? '以下' : '以上'} ${formattedTarget(target)}`
        : status === 'stale' ? '古い観測のため判定なし'
          : status === 'fx-unavailable' ? '為替未取得のため判定なし' : '価格未取得のため判定なし';
    content.append(title, currentLabel, state);
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
  overviewUpdatedNode.textContent = lastObserved ? formatObservedAt(lastObserved) : '未取得';
  overviewFxNode.textContent = formatFxRateLabel(currentFxRate)?.replace(/^参考為替：/, '') ?? '未取得';
}

function renderRankings() {
  rankingListNode.replaceChildren();
  const period = rankingPeriodSelect.value as '24h' | '7d';
  const section = rankingSnapshot?.periods[period];
  if (!section || (!section.up.length && !section.down.length)) {
    rankingStatusNode.textContent = 'この期間の価格変動データはまだありません。';
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
historyFavoriteButton.addEventListener('click', () => {
  if (activeHistoryItem) setFavorite(activeHistoryItem.marketHashName);
});
for (const input of [indicatorSma, indicatorBands, indicatorRsi]) input.addEventListener('change', renderHistoryChart);
historyDialog.addEventListener('close', () => { historyLoadSequence += 1; activeHistoryItem = null; });
void load(currencySelect.value as 'JPY' | 'USD');
