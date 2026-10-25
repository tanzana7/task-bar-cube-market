const status = document.querySelector('#status');
const productsNode = document.querySelector('#products');
const meta = document.querySelector('#meta');
const search = document.querySelector('#search');
const sort = document.querySelector('#sort');
let dataset;

function isDemoDataset(value) {
  return value && value.schemaVersion === 1 && value.demo === true && value.appid === 3678970
    && value.gameName === 'Task Bar Hero' && value.fixtureResponseCurrencyId === 1
    && value.requestCurrencyId === null && value.requestResponseAssociation.startsWith('unverified')
    && value.priceBasis.startsWith('strMinSellSubtotal;') && value.capturedAt === null
    && value.completeCatalog === false && Array.isArray(value.products)
    && value.products.every(product => typeof product.marketHashName === 'string'
      && typeof product.name === 'string' && typeof product.displayedSubtotal === 'string'
      && typeof product.listings === 'number' && Number.isSafeInteger(product.listings)
      && typeof product.imageUrl === 'string' && /^https:\/\/community\.cloudflare\.steamstatic\.com\//.test(product.imageUrl)
      && product.steamUrl === `https://steamcommunity.com/market/listings/3678970/${encodeURIComponent(product.marketHashName)}`);
}

function cents(priceText) {
  const match = /^\$(\d+)\.(\d{2})$/.exec(priceText);
  return match ? Number(match[1]) * 100 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
}

function visibleProducts() {
  const needle = search.value.trim().toLocaleLowerCase();
  const products = dataset.products.filter(product => product.name.toLocaleLowerCase().includes(needle));
  if (sort.value === 'price') products.sort((left, right) => cents(left.displayedSubtotal) - cents(right.displayedSubtotal) || left.name.localeCompare(right.name));
  else if (sort.value === 'listings') products.sort((left, right) => right.listings - left.listings || left.name.localeCompare(right.name));
  else products.sort((left, right) => left.name.localeCompare(right.name));
  return products;
}

function render() {
  const products = visibleProducts();
  productsNode.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const product of products) {
    const card = document.createElement('article');
    card.className = 'card';
    const image = document.createElement('img');
    image.src = product.imageUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => { image.hidden = true; }, { once: true });
    const content = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = product.name;
    const price = document.createElement('div');
    price.className = 'price';
    price.textContent = `${product.displayedSubtotal} USD`;
    const details = document.createElement('div');
    details.className = 'detail';
    details.textContent = `${product.listings.toLocaleString()} 出品 · subtotal表示`;
    const link = document.createElement('a');
    link.href = product.steamUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Steam商品ページ ↗';
    content.append(title, price, details, link);
    card.append(image, content);
    fragment.append(card);
  }
  productsNode.append(fragment);
  productsNode.hidden = products.length === 0;
  status.hidden = products.length > 0;
  status.textContent = products.length ? '' : '該当する商品はありません';
}

async function start() {
  try {
    const response = await fetch('/query-action-demo.json', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('データを読み込めません');
    const candidate = await response.json();
    if (!isDemoDataset(candidate) || candidate.products.length !== candidate.returnedProductTypes
        || new Set(candidate.products.map(product => product.marketHashName)).size !== candidate.products.length) {
      throw new Error('fixtureデータを検証できません');
    }
    dataset = candidate;
    meta.replaceChildren();
    for (const text of [`${dataset.gameName} · AppID ${dataset.appid}`, `${dataset.start + 1}–${dataset.start + dataset.returnedProductTypes}件 / Steam報告 ${dataset.totalCount}種類`,
      `レスポンス通貨 USD · リクエストとの対応 未確認`, 'fixture取得日時 記録なし']) {
      const item = document.createElement('span');
      item.textContent = text;
      meta.append(item);
    }
    render();
  } catch {
    status.textContent = 'デモデータを表示できません';
  }
}

search.addEventListener('input', render);
sort.addEventListener('change', render);
start();
