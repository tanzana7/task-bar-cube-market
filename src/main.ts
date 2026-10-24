import './style.css';
import { filterAndSort, type MarketItem, type SortMode } from './market';
import { createAnalytics } from './analytics';

type Snapshot = {
  schemaVersion: number;
  appid: number;
  status: 'ok' | 'unavailable';
  fetchedAt: string | null;
  currency: 'JPY' | 'USD';
  items: MarketItem[];
};

const search = document.querySelector<HTMLInputElement>('#search')!;
const sort = document.querySelector<HTMLSelectElement>('#sort')!;
const currencySelect = document.querySelector<HTMLSelectElement>('#currency')!;
const itemsNode = document.querySelector<HTMLDivElement>('#items')!;
const statusNode = document.querySelector<HTMLDivElement>('#status')!;
const countNode = document.querySelector<HTMLSpanElement>('#result-count')!;
const updatedNode = document.querySelector<HTMLSpanElement>('#updated-at')!;
let snapshot: Snapshot | null = null;
let loadSequence = 0;
const analytics = createAnalytics(import.meta.env.VITE_GA4_MEASUREMENT_ID, location.origin + location.pathname, window, url => {
  const script = document.createElement('script');
  script.async = true;
  script.src = url;
  document.head.append(script);
});
const consentNode = document.querySelector<HTMLDivElement>('#analytics-consent')!;
const settingsButton = document.querySelector<HTMLButtonElement>('#analytics-settings')!;
settingsButton.hidden = !analytics.enabled;
function storedValue(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function saveValue(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch (error) { console.warn('Preference could not be saved', error); }
}
if (analytics.enabled) {
  const consent = storedValue('tbcm-analytics-consent');
  if (consent === 'granted') analytics.grant();
  else if (consent !== 'denied') consentNode.hidden = false;
}
document.querySelector<HTMLButtonElement>('#analytics-accept')!.addEventListener('click', () => {
  saveValue('tbcm-analytics-consent', 'granted');
  analytics.grant();
  consentNode.hidden = true;
});
document.querySelector<HTMLButtonElement>('#analytics-decline')!.addEventListener('click', () => {
  saveValue('tbcm-analytics-consent', 'denied');
  consentNode.hidden = true;
  // Reload removes an already initialized tag when a visitor revokes consent.
  if (analytics.isLoaded()) location.reload();
});
settingsButton.addEventListener('click', () => { consentNode.hidden = false; });
currencySelect.value = storedValue('tbcm-currency') === 'USD' ? 'USD' : 'JPY';

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<Snapshot>;
  return data.schemaVersion === 2 && data.appid === 5084200
    && ['ok', 'unavailable'].includes(data.status ?? '')
    && (data.currency === 'JPY' || data.currency === 'USD')
    && Array.isArray(data.items)
    && (data.fetchedAt === null || typeof data.fetchedAt === 'string');
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
  const visible = filterAndSort(snapshot.items, search.value, sort.value as SortMode);
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
    card.addEventListener('click', () => analytics.event('steam_market_click', { destination: 'steam_market' }));
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
    price.textContent = item.priceText ?? '価格情報なし';
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
    if (snapshot.fetchedAt) {
      const date = new Date(snapshot.fetchedAt);
      if (!Number.isNaN(date.valueOf())) {
        updatedNode.textContent = `取得 ${new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(date)}`;
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
  analytics.event('currency_change', { currency });
  void load(currency);
});
void load(currencySelect.value as 'JPY' | 'USD');
