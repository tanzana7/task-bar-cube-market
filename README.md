# Task Bar Cube Market

Task Bar Cube（Steam AppID 5084200）のCommunity Market出品を検索・比較する非公式サイトです。

## 開発

```sh
npm ci
npm run dev
npm run test
npm run build
```

Viteの出力は`dist/`です。Cloudflare Pagesはビルドコマンド`npm run build`、出力ディレクトリ`dist`です。JPY / USDを切り替えられ、選択はブラウザに保存されます。Cubeの商品がまだ確認できないため、現在の両JSONは未取得状態です。

## データ更新

`node scripts/steam-market.mjs --live`は許諾確認後の手動実行用です。環境変数`STEAM_MARKET_COLLECTION_ALLOWED=true`も必要です。`search/render/`からAppID 5084200のUSDとJPYを検証します。JPY指定が通貨不一致の場合だけ、確認済みUSD価格と新規取得したFrankfurterのUSD/JPYレートで「参考価格・為替換算」を作ります。これはSteamのJPY実価格ではありません。全ページと両通貨の整合性を検証してから`public/market-jpy.json`と`public/market-usd.json`をまとめて更新します。403、429、欠損、通信エラー、為替取得失敗では既存キャッシュを保持します。現時点ではSteamの自動収集と再配布の許諾が未確認です。

本番ブラウザはSteamに直接アクセスせず、静的JSONだけを読みます。データが未取得なら架空の商品や価格は表示しません。

## GitHub Actions

`Validate and refresh market snapshots`は`workflow_dispatch`のみです。既定の`fixture`はSteamへ通信せず、テストとビルドを確認します。`live`は許諾確認後にリポジトリ変数`STEAM_MARKET_COLLECTION_ALLOWED=true`を設定した場合のみ動き、更新JSONに変更があればコミット・Pushします。PagesのGit連携がデプロイします。条件と手順は[更新運用](docs/refresh-operations.md)を参照してください。

## 資料

- [参考サイト調査](docs/reference-analysis.md)
- [参考リポジトリの技術調査](docs/tbh-market-tool-analysis.md)
- [Steamデータ調査](docs/steam-data-investigation.md)
- [更新運用](docs/refresh-operations.md)
- [TBH実レスポンス検証](docs/tbh-live-validation.md)
- [JPY/USD取得方式の調査](docs/currency-investigation.md)
- [本番稼働手順](docs/launch-runbook.md)

発売後の確認・運用コマンドは`npm run market:check`（fixture、Steam通信なし）、`npm run market:check -- --live`（先頭ページ1回）、`npm run market:validate`（ローカル検証）、`npm run market:refresh`（許可環境変数必須、Pushなし）です。為替レート単独の更新・検証は`npm run fx:refresh`・`npm run fx:validate`を使います。為替Actionsは毎日18:17 UTCにFrankfurterだけを確認し、公表レートが変わった場合だけ`fx-rate.json`をコミットします。

TBH検証は`node scripts/verify-tbh.mjs`で保存済みの最小fixtureを使用します。明示的な`--live`を付けた場合だけ、TBH AppID 3678970の先頭10件を読み取ります。本番JSONには書き込みません。
