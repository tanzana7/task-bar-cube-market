# tbh-market-tool 技術調査

確認日: 2026-10-25。対象は[filipefont/tbh-market-tool](https://github.com/filipefont/tbh-market-tool)のソース。tbh-market.comとは別プロジェクトとして扱う。

## 確認したファイル

- `README.md`
- `build.py`（取得、正規化、キャッシュ、表示生成）
- `.github/workflows/publish.yml`
- `web/src/lib/format.ts`
- `web/src/components/market/MarketSearch.svelte`
- `web/src/components/market/MercadoTable.svelte`
- `LICENSE`（MIT）

## 実際の取得方式

`build.py`は`https://steamcommunity.com/market/search/render/?appid=3678970&norender=1&count=100&start={start}`を使用する。初回レスポンスの`total_count`と実際の`results.length`からページ数を決める。READMEの約653件・約69リクエストは当時の観測値であり、固定仕様ではない。`results`の`name`、`sell_price`（整数のセント値）、`sell_listings`を利用し、`data/steam_market.json`へ保存する。重複時は出品数の大きい行を優先する。

個別照会は`https://steamcommunity.com/market/priceoverview/?appid=3678970&currency={currency}&market_hash_name={name}`。`lowest_price`、`median_price`、`volume`を文字列から変換する。USD=1、BRL=7を指定する。これは今回の基本取得には使わない。参考プロジェクトの画像はSteam検索結果ではなくWikiのアイコン名からURLを作る。個別Steamリンクは`/market/listings/{appid}/{encodeURIComponent(name)}`で生成する。

`publish.yml`は現在は毎時実行で、READMEの2時間更新という説明と一致しない。Actions cacheとartifactを使い、取得、個別価格の補強、公開を分ける。ソースには429時の待機と再試行があるが、今回の実装は403/429を検出したら停止する。

## 今回の適用と簡素化

- AppIDを5084200に固定し、検索結果だけから名前、画像、価格表示文字列、価格の整数値、出品数、識別子を正規化する。
- Steamの`asset_description.icon_url`があればSteamの画像ホストのURLを使う。現対象の実データは0件のため、この項目は未検証。
- 通貨を推定してラベル付けせず、Steamの価格表示文字列を保持する。異なる通貨の混在時は数値ソートの見直しが必要。
- 全ページ成功時だけJSONを置換し、既存の有効な一覧を0件で上書きしない。
- Wiki、NPC売却価格、レアリティ、ゲーム内通貨換算、価格履歴、裁定分析、個別照会を除外する。
- GitHub Actionsの定期取得は未設定。Steamの自動取得・再配布許諾は未確認。

## 変更リスク

`search/render`は文書化された安定APIではない。結果のページサイズ、`asset_description`、価格表示文字列、通貨、レート制限は変わり得る。レスポンス形状を検証し、欠損や403/429を成功扱いしない。
