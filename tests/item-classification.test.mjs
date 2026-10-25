import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyItemName, ITEM_GRADES, ITEM_QUALITIES, ITEM_TYPES, gradeAtLeast } from '../src/item-classification.ts';
import { filterMarketItems, recommendEquipment } from '../src/market-features.ts';

const item = (marketHashName, priceMinor, listings = 1) => ({ marketHashName, name: marketHashName, imageUrl: null, priceMinor,
  priceText: priceMinor === null ? null : `$${(priceMinor / 100).toFixed(2)}`, listings,
  steamUrl: `https://steamcommunity.com/market/listings/5084200/${encodeURIComponent(marketHashName)}` });

test('classifies only explicit grade tokens, strict equipment words, and 5-point quality steps', () => {
  assert.deepEqual(classifyItemName('  rArE   Silver Chestplate 50%  '), { grade: 'Rare', type: 'Chestplate', quality: 50 });
  assert.deepEqual(classifyItemName('Common Sword 95%'), { grade: 'Common', type: 'Sword', quality: 95 });
  assert.deepEqual(classifyItemName('Chest Lv.1'), { grade: null, type: 'Chest', quality: null });
  assert.equal(classifyItemName('Arcane Boots 60%').grade, null);
  assert.equal(classifyItemName('Thing Gloves 7%').quality, null);
  assert.equal(classifyItemName('Thing Boots 100%').quality, null);
  assert.equal(classifyItemName('A Chestplate 5%').type, 'Chestplate');
  assert.equal(classifyItemName('A Chest Lv.2').type, 'Chest');
  assert.equal(classifyItemName('No equipment 25%').type, null);
  assert.deepEqual(ITEM_GRADES, ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Divine']);
  for (const grade of ITEM_GRADES) assert.equal(classifyItemName(`${grade} Test Sword 5%`).grade, grade);
  assert.equal(ITEM_TYPES.length, 10);
  assert.equal(ITEM_QUALITIES.length, 19);
  for (const type of ITEM_TYPES) assert.equal(classifyItemName(`Test ${type} 5%`).type, type);
  for (const quality of ITEM_QUALITIES) assert.equal(classifyItemName(`Test Sword ${quality}%`).quality, quality);
});

test('grade lower bound rejects unknowns and preserves the configured grade order', () => {
  assert.equal(gradeAtLeast('Epic', 'Rare'), true);
  assert.equal(gradeAtLeast('Common', 'Rare'), false);
  assert.equal(gradeAtLeast(null, 'Common'), false);
  assert.equal(gradeAtLeast(null, null), true);
});

test('multi-select categories use OR within category and AND across categories', () => {
  const items = [item('Rare Sword 50%', 900), item('Epic Boots 60%', 800), item('Rare Chestplate 70%', 700), item('Chest Lv.1', 300)];
  const base = { query: '', minimumPrice: null, maximumPrice: null, minimumListings: null, favoritesOnly: false, favorites: new Set() };
  assert.deepEqual(filterMarketItems(items, { ...base, grades: new Set(['Rare', 'Epic']), types: new Set(['Sword', 'Chestplate']), minimumQuality: 50 }, 'name').map(x => x.marketHashName),
    ['Rare Chestplate 70%', 'Rare Sword 50%']);
  assert.deepEqual(filterMarketItems(items, { ...base, minimumGrade: 'Rare', minimumQuality: 65 }, 'name').map(x => x.marketHashName), ['Rare Chestplate 70%']);
});

test('recommendations honor type, threshold, budget and expose explainable ordering', () => {
  const items = [item('Common Sword 80%', 300), item('Rare Sword 60%', 250), item('Epic Sword 90%', 900), item('Rare Boots 95%', 100)];
  const base = { type: 'Sword', minimumGrade: 'Rare', minimumQuality: 50, budgetMinor: 500, currency: 'USD' };
  const byPrice = recommendEquipment(items, { ...base, priority: 'price' });
  assert.deepEqual(byPrice.map(row => row.item.marketHashName), ['Rare Sword 60%']);
  assert.match(byPrice[0].reason, /最安/);
  const quality = recommendEquipment(items, { ...base, budgetMinor: null, priority: 'quality' });
  assert.deepEqual(quality.map(row => row.item.marketHashName), ['Epic Sword 90%', 'Rare Sword 60%']);
  const balanced = recommendEquipment(items, { ...base, budgetMinor: null, priority: 'balanced' });
  assert.equal(balanced[0].score > balanced[1].score, true);
});

test('saved 131-product observations classify known facts without inventing grades', async () => {
  const data = JSON.parse(await readFile(new URL('../public/market-observations.json', import.meta.url), 'utf8'));
  const results = data.products.map(product => classifyItemName(product.marketHashName));
  const count = field => results.filter(value => value[field] !== null).length;
  assert.equal(data.products.length, 131);
  assert.equal(count('type'), 131);
  assert.equal(count('quality'), 126);
  assert.equal(count('grade'), 0);
  assert.ok(data.products.every(product => product.observations.some(observation => observation.referencePriceText || observation.priceMinor !== null)));
});
