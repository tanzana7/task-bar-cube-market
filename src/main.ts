import './style.css';
import { filterAndSort, type MarketItem, type SortMode } from './market';

type Snapshot = {
  schemaVersion: number;
  appid: number;
  status: 'ok' | 'empty' | 'unavailable';
  fetchedAt: string | null;
  currency: string | null;
  items: MarketItem[];
};

const search = document.querySelector<HTMLInputElement>('#search')!;
const sort = document.querySelector<HTMLSelectElement>('#sort')!;
const itemsNode = document.querySelector<HTMLDivElement>('#items')!;
const statusNode = document.querySelector<HTMLDivElement>('#status')!;
const countNode = document.querySelector<HTMLSpanElement>('#result-count')!;
const updatedNode = document.querySelector<HTMLSpanElement>('#updated-at')!;
let snapshot: Snapshot | null = null;

function isSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<Snapshot>;
  return data.schemaVersion === 1 && data.appid === 5084200
    && ['ok', 'empty', 'unavailable'].includes(data.status ?? '')
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
    statusNode.textContent = 'マーケットデータ準備中';
    itemsNode.hidden = true;
    return;
  }
  if (visible.length === 0) {
    statusNode.textContent = snapshot.status === 'empty' ? '現在、出品データはありません。' : '一致するアイテムがありません。';
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

async function load() {
  try {
    const response = await fetch('/market.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value: unknown = await response.json();
    if (!isSnapshot(value)) throw new Error('Invalid snapshot');
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
    console.error('Market snapshot load failed', error);
    countNode.textContent = 'データを表示できません';
    statusNode.textContent = 'データを読み込めませんでした。時間をおいて再読み込みしてください。';
  }
}

search.addEventListener('input', render);
sort.addEventListener('change', render);
void load();
