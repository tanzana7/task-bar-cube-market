import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('privacy page is linked without reintroducing Google Analytics', async () => {
  const home = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const privacy = await readFile(new URL('../public/privacy.html', import.meta.url), 'utf8');
  assert.match(home, /href="\/privacy\.html"/);
  for (const phrase of ['Cloudflare Web Analytics', 'Cookie', 'localStorage', 'Steam Community Market', '第三者の広告']) {
    assert.ok(privacy.includes(phrase), `Missing privacy explanation: ${phrase}`);
  }
  assert.doesNotMatch(home + privacy, /gtag|googletagmanager|G-1H7ZSVY2G8|同意バナー/i);
  assert.match(home, /google-site-verification/);
  assert.match(home, /rel="canonical"/);
});
