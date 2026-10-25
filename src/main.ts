import './style.css';
import { filterAndSort, prepareMarketPriceView, type MarketItem, type SortMode } from './market';

type Snapshot = {
  schemaVersion: number;
  appid: number;
  status: 'ok' | 'unavailable';
  fetchedAt: string | null;
  currency: 'JPY' | 'USD';
  priceSource?: 'steam' | 'fx';
  fxRate?: { source: 'Frankfurter'; rate: number; rateDate: string; fetchedAt: string };
  items: MarketItem[];
};

const search = document.querySelector<HTMLInputElement>('#search')!;
const sort = document.querySelector<HTMLSelectElement>('#sort')!;
const currencySelect = document.querySelector<HTMLSelectElement>('#currency')!;
const itemsNode = document.querySelector<HTMLDivElement>('#items')!;
const statusNode = document.querySelector<HTMLDivElement>('#status')!;
const countNode = document.querySelector<HTMLSpanElement>('#result-count')!;
const updatedNode = document.querySelector<HTMLSpanElement>('#updated-at')!;
const noteNode = document.querySelector<HTMLParagraphElement>('#market-note')!;
let snapshot: Snapshot | null = null;
let loadSequence = 0;
function storedValue(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function saveValue(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch (error) { console.warn('Preference could not be saved', error); }
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
    const card = document.createElement('a');
    card.className = 'item';
    card.href = link;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
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
    const main = document.createElement('span');
    main.className = 'item-main';
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
    const arrow = document.createElement('span');
    arrow.className = 'item-arrow';
    arrow.textContent = '↗';
    arrow.setAttribute('aria-hidden', 'true');
    card.append(imageBox, main, price, arrow);
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
    const response = await fetch(`/market-${currency.toLowerCase()}.json`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value: unknown = await response.json();
    if (!isSnapshot(value) || value.currency !== currency) throw new Error('Invalid snapshot');
    if (sequence !== loadSequence) return;
    snapshot = value;
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
void load(currencySelect.value as 'JPY' | 'USD');
