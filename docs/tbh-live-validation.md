# TBH実レスポンス検証（2026-10-25）

Task Bar Hero（AppID 3678970）を検証専用に使用した。Task Bar Cube（AppID 5084200）の公開キャッシュへTBHデータは保存していない。参照実装は[filipefont/tbh-market-tool](https://github.com/filipefont/tbh-market-tool)の`build.py`を確認した。同ファイルは`search/render`で`count=100`、`start`を増やし、`sell_price / 100`をUSD価格として扱う。

## 最小限の実通信

- `https://steamcommunity.com/market/search/render/?appid=3678970&norender=1&count=10&start=0&currency=8&country=JP` → HTTP 200、`success=true`、`start=0`、`pagesize=10`、`total_count=1094`、`results.length=10`。
- 同じURLで`currency=1&country=US` → HTTP 200、同じ10件。先頭商品の`name`/`hash_name`/`asset_description.market_hash_name`は`Contaminated Reliquary (Beyond)`、`sell_listings=26`、`sell_price=517`、`sell_price_text="$5.17"`。
- JPY指定の先頭商品も`sell_price=517`、`sell_price_text="$5.17 USD"`だった。検索側がJPY指定を無視したか、地域等の別条件によりUSDで返した可能性があり、この経路でJPY価格を取得できるとは確認できない。
- JPY指定で`start=10`を1ページだけ確認。`start=10`、`pagesize=10`、`total_count=1094`、10件を返し、先頭は1ページ目と異なる商品だった。この2ページの観測は開始位置を支持するが、全ページの連続性・安定性を保証しない。

実フィールドは`name`、`hash_name`、`sell_listings`、`sell_price`、`sell_price_text`、`asset_description`など。`asset_description`には`appid`、`market_hash_name`、`icon_url`が含まれた。`icon_url`を`https://community.cloudflare.steamstatic.com/economy/image/`に連結した画像はHTTP 200、`image/png`を返した。商品URL`https://steamcommunity.com/market/listings/3678970/Contaminated%20Reliquary%20(Beyond)`はGETでHTTP 200だった。

USDの実例では`517`と`$5.17`が対応し、この応答に限り`1 USD = 100 sell_price単位`と確認した。JPYの表示価格を取得できていないため、JPYの金額単位は未検証。Steamworksの一般的な通貨仕様から、非公式検索エンドポイントのJPY単位を確定したことにはしない。

## コードへの反映

- USDの`$5.17`と`$5.17 USD`は既存の検証に適合。JPY指定でUSDを返した場合は既存の通貨検証が拒否し、キャッシュを置換しない。
- 数値価格が欠損するのに文字列価格だけある場合、表示価格も`null`にする。スナップショット検証でも文字列と数値の片方だけを拒否する。
- TBH用の`verify-tbh.mjs`は通常fixtureのみ、`--live`時だけ10件を取得し、公開JSONへの書き込みを行わない。`normalizeResult`に検証用AppIDを渡しても、本番収集のAppID固定値は5084200のまま。
- `tests/fixtures/tbh-search-page.json`は先頭商品の必要最小限のフィールドだけを保存した。通貨拒否、USD価格、画像URL、商品URL、出品数をテストする。

## 残る制約

Cube市場での商品出現時に同じレスポンス形状・価格単位になる保証はない。JPYの実価格表記と数値単位は未確認。検索結果の順序や`total_count`は取得中に変動し得るため、全ページ取得では件数と重複を検証し、不整合時には正常キャッシュを保持する。403・429・CAPTCHA時の再試行や回避は行わない。Steamの自動収集・再配布条件が未確認のため、Actionsの定期実行は設定しない。
