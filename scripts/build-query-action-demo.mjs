import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseQueryActionPage } from './query-action-market.mjs';
import { TBH_APPID } from './steam-market.mjs';

const fixturePath = new URL('../tests/fixtures/tbh-query-action-real-start30-usd.json', import.meta.url);
const outputPath = new URL('../public/query-action-demo.json', import.meta.url);

async function buildDemoDataset() {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const page = parseQueryActionPage(fixture, { expectedStart: fixture?.data?.start, expectedAppId: TBH_APPID });
  const dataset = {
    schemaVersion: 1,
    demo: true,
    appid: TBH_APPID,
    gameName: 'Task Bar Hero',
    source: 'Stored Steam Community Market queryAction response fixture',
    fixtureResponseCurrencyId: page.responseCurrencyId,
    requestCurrencyId: null,
    requestResponseAssociation: 'unverified; request record and response fixture are not proven to be the same exchange',
    priceBasis: 'strMinSellSubtotal; fee inclusion and equivalence to legacy sell_price are unverified',
    capturedAt: null,
    start: page.start,
    totalCount: page.totalCount,
    returnedProductTypes: page.pageSize,
    completeCatalog: false,
    products: page.items.map(item => ({
      marketHashName: item.marketHashName,
      name: item.name,
      imageUrl: item.imageUrl,
      displayedSubtotal: item.minSellSubtotalText,
      listings: item.listings,
      steamUrl: item.steamUrl,
    })),
  };
  if (dataset.products.length !== page.pageSize || dataset.products.some(product => !product.marketHashName
      || !product.imageUrl || !product.steamUrl || !product.displayedSubtotal || !Number.isSafeInteger(product.listings))) {
    throw new Error('queryAction demo dataset failed validation');
  }
  await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  return { path: fileURLToPath(outputPath), productCount: dataset.products.length, appid: dataset.appid };
}

buildDemoDataset().then(result => console.info(JSON.stringify(result)))
  .catch(error => { console.error(`queryAction demo build failed: ${error.message}`); process.exitCode = 1; });
