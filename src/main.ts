import './style.css';
import { deriveJpyReferenceSnapshot, filterAndSort, formatFxRateLabel, parseFreshFxRate, prepareMarketPriceView, type FxRateRecord, type MarketSnapshot, type SortMode } from './market';
import { filterHistoryPoints, formatHistoryPrice, makeChartPoints, parseHistoryIndex, parseProductHistory, type HistoryCurrency, type HistoryIndex, type HistoryRange, type ProductHistory } from './history';

type Snapshot = MarketSnapshot;

const search = document.querySelector<HTMLInputElement>('#search')!;
const sort = document.querySelector<HTMLSelectElement>('#sort')!;
const currencySelect = document.querySelector<HTMLSelectElement>('#currency')!;
const itemsNode = document.querySelector<HTMLDivElement>('#items')!;
const statusNode = document.querySelector<HTMLDivElement>('#status')!;
const countNode = document.querySelector<HTMLSpanElement>('#result-count')!;
const updatedNode = document.querySelector<HTMLSpanElement>('#updated-at')!;
const noteNode = document.querySelector<HTMLParagraphElement>('#market-note')!;
const fxRateNode = document.querySelector<HTMLParagraphElement>('#fx-rate')!;
const historyDialog = document.querySelector<HTMLDialogElement>('#history-dialog')!;
const historyTitle = document.querySelector<HTMLHeadingElement>('#history-title')!;
const historyImage = document.querySelector<HTMLImageElement>('#history-image')!;
const historySummary = document.querySelector<HTMLParagraphElement>('#history-summary')!;
const historyStatus = document.querySelector<HTMLParagraphElement>('#history-status')!;
const historyChart = document.querySelector<HTMLDivElement>('#history-chart')!;
const historyRange = document.querySelector<HTMLSelectElement>('#history-range')!;
const historyCurrency = document.querySelector<HTMLSelectElement>('#history-currency')!;
const historySteam = document.querySelector<HTMLAnchorElement>('#history-steam')!;
const historyClose = document.querySelector<HTMLButtonElement>('#history-close')!;
let snapshot: Snapshot | null = null;
let usdSnapshot: Snapshot | null = null;
let currentFxRate: FxRateRecord | null = null;
let historyIndex: HistoryIndex | null = null;
let selectedHistory: ProductHistory | null = null;
let historyLoadSequence = 0;
let loadSequence = 0;
function storedValue(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function saveValue(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch (error) { console.warn('Preference could not be saved', error); }
}

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
    return parsed.protocol === 'https:' && parsed.hostname === 'community.cloudflare.steamstatic.com' ? parsed.href : null;
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

function formatObservedAt(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' })
    .format(new Date(value));
}

function renderHistoryChart() {
  historyChart.replaceChildren();
  if (!selectedHistory || selectedHistory.points.length === 0) {
    historyStatus.textContent = '価格履歴はまだありません。';
    return;
  }
  const currency = historyCurrency.value as HistoryCurrency;
  const rateDependentPoints = makeChartPoints(selectedHistory.points, currency, currentFxRate);
  if (!rateDependentPoints) {
    historyStatus.textContent = '為替レートが未取得または期限切れのため、JPYグラフを表示できません。USDを選択してください。';
    return;
  }
  const points = filterHistoryPoints(rateDependentPoints, historyRange.value as HistoryRange);
  if (points.length === 0) {
    historyStatus.textContent = 'この期間の価格履歴はありません。';
    return;
  }

  const width = 760;
  const height = 300;
  const margin = { top: 18, right: 24, bottom: 42, left: 76 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const times = points.map(point => Date.parse(point.observedAt));
  const values = points.map(point => point.value);
  const firstTime = times[0];
  const lastTime = times[times.length - 1];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const pad = maxValue === minValue ? Math.max(Math.abs(maxValue) * 0.08, currency === 'USD' ? 0.01 : 1) : (maxValue - minValue) * 0.12;
  const yMin = Math.max(0, minValue - pad);
  const yMax = maxValue + pad || 1;
  const x = (time: number) => margin.left + (lastTime === firstTime ? plotWidth / 2 : (time - firstTime) / (lastTime - firstTime) * plotWidth);
  const y = (value: number) => margin.top + (yMax - value) / (yMax - yMin || 1) * plotHeight;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${historyTitle.textContent} ${currency}価格推移、観測点${points.length}件`);
  svg.classList.add('history-svg');

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = yMin + (yMax - yMin) * tick / 4;
    const yPos = y(value);
    const grid = document.createElementNS(svg.namespaceURI, 'line');
    grid.setAttribute('x1', String(margin.left));
    grid.setAttribute('x2', String(width - margin.right));
    grid.setAttribute('y1', String(yPos));
    grid.setAttribute('y2', String(yPos));
    grid.setAttribute('class', 'chart-grid');
    svg.append(grid);
    const label = document.createElementNS(svg.namespaceURI, 'text');
    label.setAttribute('x', String(margin.left - 10));
    label.setAttribute('y', String(yPos + 4));
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('class', 'chart-label');
    label.textContent = formatHistoryPrice(value, currency);
    svg.append(label);
  }

  const axis = document.createElementNS(svg.namespaceURI, 'line');
  axis.setAttribute('x1', String(margin.left));
  axis.setAttribute('x2', String(width - margin.right));
  axis.setAttribute('y1', String(height - margin.bottom));
  axis.setAttribute('y2', String(height - margin.bottom));
  axis.setAttribute('class', 'chart-axis');
  svg.append(axis);

  const firstLabel = document.createElementNS(svg.namespaceURI, 'text');
  firstLabel.setAttribute('x', String(margin.left));
  firstLabel.setAttribute('y', String(height - 12));
  firstLabel.setAttribute('class', 'chart-label');
  firstLabel.textContent = formatObservedAt(points[0].observedAt);
  svg.append(firstLabel);
  if (points.length > 1) {
    const lastLabel = document.createElementNS(svg.namespaceURI, 'text');
    lastLabel.setAttribute('x', String(width - margin.right));
    lastLabel.setAttribute('y', String(height - 12));
    lastLabel.setAttribute('text-anchor', 'end');
    lastLabel.setAttribute('class', 'chart-label');
    lastLabel.textContent = formatObservedAt(points[points.length - 1].observedAt);
    svg.append(lastLabel);
  }

  if (points.length > 1) {
    const line = document.createElementNS(svg.namespaceURI, 'polyline');
    line.setAttribute('points', points.map((point, index) => `${x(times[index])},${y(point.value)}`).join(' '));
    line.setAttribute('class', 'chart-line');
    svg.append(line);
  }
  points.forEach((point, index) => {
    const marker = document.createElementNS(svg.namespaceURI, 'circle');
    marker.setAttribute('cx', String(x(times[index])));
    marker.setAttribute('cy', String(y(point.value)));
    marker.setAttribute('r', points.length === 1 ? '6' : '4');
    marker.setAttribute('class', 'chart-point');
    marker.setAttribute('tabindex', '0');
    marker.setAttribute('role', 'button');
    const description = `${formatObservedAt(point.observedAt)} · ${point.label} · 出品 ${point.listings.toLocaleString('ja-JP')}件`;
    marker.setAttribute('aria-label', description);
    const title = document.createElementNS(svg.namespaceURI, 'title');
    title.textContent = description;
    marker.append(title);
    marker.addEventListener('pointerup', () => { historyStatus.textContent = description; });
    marker.addEventListener('keydown', event => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
        keyEvent.preventDefault();
        historyStatus.textContent = description;
      }
    });
    svg.append(marker);
  });
  historyChart.append(svg);
  historyStatus.textContent = points.length === 1 ? '観測点 1件' : `観測点 ${points.length.toLocaleString('ja-JP')}件`;
}

async function openHistory(item: MarketSnapshot['items'][number]) {
  const request = ++historyLoadSequence;
  selectedHistory = null;
  historyCurrency.value = currencySelect.value;
  historyTitle.textContent = item.name;
  const usdItem = usdSnapshot?.items.find(candidate => candidate.marketHashName === item.marketHashName);
  const currentPrice = usdItem?.priceText ?? 'USD価格情報なし';
  const listings = item.listings === null ? '出品数 未取得' : `出品 ${item.listings.toLocaleString('ja-JP')}件`;
  historySummary.textContent = `${currentPrice} · ${listings}`;
  const imageUrl = safeImage(item.imageUrl);
  historyImage.hidden = !imageUrl;
  if (imageUrl) historyImage.src = imageUrl;
  else historyImage.removeAttribute('src');
  const steamUrl = safeSteamUrl(item.steamUrl);
  historySteam.hidden = !steamUrl;
  if (steamUrl) historySteam.href = steamUrl;
  historyStatus.textContent = '読み込み中';
  historyChart.replaceChildren();
  if (!historyDialog.open) historyDialog.showModal();

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
  const priceView = prepareMarketPriceView(snapshot.items, snapshot.currency, snapshot.priceSource, snapshot.fxRate?.rateDate);
  const visible = filterAndSort(priceView.items, search.value, sort.value as SortMode);
  countNode.textContent = `${visible.length}件のアイテム`;
  itemsNode.replaceChildren();
  if (snapshot.status === 'unavailable') {
    statusNode.hidden = false;
    statusNode.textContent = `${snapshot.currency}の価格情報は未取得です`;
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
    const link = safeSteamUrl(item.steamUrl);
    if (!link) continue;
    const card = document.createElement('article');
    card.className = 'item';
    const imageBox = document.createElement('span');
    imageBox.className = 'image-box';
    const imageUrl = safeImage(item.imageUrl);
    if (imageUrl) {
      const image = document.createElement('img');
      image.src = imageUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.onerror = () => image.remove();
      imageBox.append(image);
    }
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'item-main item-detail';
    main.setAttribute('aria-label', `${item.name}の価格履歴を表示`);
    main.addEventListener('click', () => { void openHistory(item); });
    const name = document.createElement('strong');
    name.textContent = item.name;
    const listings = document.createElement('small');
    listings.textContent = item.listings === null ? '出品数 未取得' : `出品 ${item.listings.toLocaleString('ja-JP')}件`;
    main.append(name, listings);
    const price = document.createElement('span');
    price.className = 'price';
    price.textContent = priceView.expiredFx ? '参考円価格は更新待ち' : item.priceText ?? '価格情報なし';
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
    steamLink.setAttribute('aria-label', `${item.name}をSteam Marketで開く`);
    steamLink.textContent = 'Steam ↗';
    card.append(imageBox, main, price, steamLink);
    fragment.append(card);
  }
  itemsNode.append(fragment);
}

async function load(currency: 'JPY' | 'USD') {
  const sequence = ++loadSequence;
  statusNode.hidden = false;
  statusNode.textContent = 'マーケットデータを読み込んでいます…';
  itemsNode.hidden = true;
  countNode.textContent = '読み込み中';
  updatedNode.textContent = '更新日時 —';
  try {
    const [response, fxValue, usdValue, historyIndexValue] = await Promise.all([
      fetch(`/market-${currency.toLowerCase()}.json`, { cache: 'no-cache' }),
      readOptionalJson('/fx-rate.json'),
      currency === 'JPY' ? readOptionalJson('/market-usd.json') : Promise.resolve(null),
      readOptionalJson('/history/index.json'),
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value: unknown = await response.json();
    if (!isSnapshot(value) || value.currency !== currency) throw new Error('Invalid snapshot');
    if (sequence !== loadSequence) return;
    currentFxRate = parseFreshFxRate(fxValue);
    historyIndex = parseHistoryIndex(historyIndexValue);
    const usdCandidate = currency === 'JPY' && isSnapshot(usdValue) && usdValue.currency === 'USD' ? usdValue : null;
    usdSnapshot = currency === 'USD' ? value : usdCandidate;
    const latestJpySnapshot = currency === 'JPY' && value.priceSource === 'fx' && currentFxRate && usdCandidate
      ? deriveJpyReferenceSnapshot(value, usdCandidate, currentFxRate) : null;
    snapshot = latestJpySnapshot ?? value;
    const fxLabel = formatFxRateLabel(currentFxRate);
    fxRateNode.hidden = !fxLabel;
    fxRateNode.textContent = fxLabel ?? '';
    const priceView = prepareMarketPriceView(snapshot.items, snapshot.currency, snapshot.priceSource, snapshot.fxRate?.rateDate);
    noteNode.textContent = priceView.expiredFx
      ? '為替レートの期限切れにより、JPY参考価格を表示していません。商品情報はSteamでご確認ください。'
      : snapshot.priceSource === 'fx'
        ? 'JPYはSteamのUSD最安価格を為替換算した参考価格です。購入時はSteamでご確認ください。'
      : '価格は取得時点の最安出品価格です。購入時はSteamでご確認ください。';
    if (snapshot.fetchedAt) {
      const date = new Date(snapshot.fetchedAt);
      if (!Number.isNaN(date.valueOf())) {
        updatedNode.textContent = `取得 ${new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(date)}`;
      }
    }
    if (snapshot.priceSource === 'fx' && snapshot.fxRate) {
      const rateDate = new Date(snapshot.fxRate.fetchedAt);
      if (!Number.isNaN(rateDate.valueOf())) {
        updatedNode.textContent += priceView.expiredFx
          ? ` · 為替レート期限切れ（${snapshot.fxRate.rateDate}・Frankfurter）`
          : ` · 為替 ${snapshot.fxRate.rate}円/USD（${snapshot.fxRate.rateDate}・Frankfurter、取得 ${new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(rateDate)}）`;
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
currencySelect.addEventListener('change', () => {
  const currency = currencySelect.value === 'USD' ? 'USD' : 'JPY';
  saveValue('tbcm-currency', currency);
  void load(currency);
});
historyClose.addEventListener('click', () => historyDialog.close());
historyRange.addEventListener('change', renderHistoryChart);
historyCurrency.addEventListener('change', renderHistoryChart);
historyDialog.addEventListener('close', () => { historyLoadSequence += 1; });
void load(currencySelect.value as 'JPY' | 'USD');
