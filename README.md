# Task Bar Cube Market

Task Bar Cube（Steam AppID 5084200）のCommunity Market出品を検索・比較する非公式サイトです。

## 開発

```sh
npm ci
npm run dev
npm run test
npm run build
```

Viteの出力は`dist/`です。Cloudflare Pagesはビルドコマンド`npm run build`、出力ディレクトリ`dist`です。USD市場JSONを唯一の正規データとして読み、JPYは取得時点で有効なFrankfurter USD/JPYレートから画面上で換算します。選択した通貨はブラウザに保存されます。公開データの取得許可が確認できずTBC商品の入力データもない場合は、商品一覧は未取得のままです。TBHや合成商品をTBCとして表示しません。

## データ更新

`node scripts/steam-market.mjs --live`は許諾確認後の手動実行用です。環境変数`STEAM_MARKET_COLLECTION_ALLOWED=true`も必要です。`search/render/`でAppID 5084200のUSD一覧だけを取得し、全ページを検証した後、USD市場JSON・USD価格履歴・軽量ランキングをまとめて更新します。JPY市場へのリクエストも為替APIへの依存もありません。JPY参考価格は閲覧時に現在有効なFXレートがある場合だけ生成し、未取得・期限切れなら更新待ちを表示します。403、429、欠損、通信エラーでは既存キャッシュを保持します。現時点ではSteamの自動収集と再配布の許諾が未確認です。

本番ブラウザはSteamに直接アクセスせず、静的JSONだけを読みます。データが未取得なら架空の商品や価格は表示しません。

## 正規データの手動取込

Steamからの自動取得・再配布の許可は未確認です。Steamの利用規約ではサービスとのやり取りを自動化するスクリプト等を制限しているため、`STEAM_MARKET_COLLECTION_ALLOWED=true`だけをValveの許可とみなさないでください。許可された運用、または適正に取得・提供されたTBC AppID `5084200` のJSONがある場合のみ、次の取込経路を使用します。CLIはSteamへ通信しません。

```sh
npm run market:import -- --input path/to/steam-response.json --format search-render --observed-at 2026-10-25T09:00:00.000Z --provenance "operator-provided Steam response"
npm run market:import -- --input path/to/steam-response.json --format search-render --observed-at 2026-10-25T09:00:00.000Z --provenance "operator-provided Steam response" --publish
```

省略した場合は検証だけを行い、ファイルを書き換えません。`--publish`は`public/market-observations.json`だけを更新し、既存の確定価格JSON・履歴・ランキングには接続しません。AppID、USD価格文字列と数値、出品数、商品キー、画像URL、商品URL、UTC観測日時、重複、前回JSONを検証します。`query-action`形式は`strMinSellSubtotal`の手数料基準が未確認のため、USD参考値として別表示し、価格ソート・価格履歴には使いません。ページの取得範囲は部分観測として記録します。破損キャッシュは上書きしません。インポート後は差分を確認し、GitHubへPushするとCloudflare PagesのGit連携で公開されます。

`tests/fixtures/tbh-query-action-real-start30-usd.json`はAppIDが3678970のため本番取込では拒否されます。取込テストはfixtureを一時ディレクトリでのみ解析し、本番商品一覧には書き込みません。

## GitHub Actions

`Validate and refresh market snapshots`は`workflow_dispatch`のみです。既定の`fixture`はSteamへ通信せず、テストとビルドを確認します。`live`は許諾確認後にリポジトリ変数`STEAM_MARKET_COLLECTION_ALLOWED=true`を設定した場合のみ動き、更新JSONに変更があればコミット・Pushします。PagesのGit連携がデプロイします。条件と手順は[更新運用](docs/refresh-operations.md)を参照してください。

マーケット一覧には名前検索、通貨別の価格範囲、最低出品数、並べ替え、お気に入りがあります。レアリティ・ティア・チェストレベルは現行のSteam公開一覧データから確定できないため、誤分類を避けてフィルターを表示していません。価格変動ランキングは基準時刻付近に実測点がある商品だけを対象にし、売れた価格や取引量とは扱いません。

## 資料

- [参考サイト調査](docs/reference-analysis.md)
- [参考リポジトリの技術調査](docs/tbh-market-tool-analysis.md)
- [Steamデータ調査](docs/steam-data-investigation.md)
- [更新運用](docs/refresh-operations.md)
- [TBH実レスポンス検証](docs/tbh-live-validation.md)
- [JPY/USD取得方式の調査](docs/currency-investigation.md)
- [本番稼働手順](docs/launch-runbook.md)
- [USD価格履歴](docs/price-history.md)
- [v0.4機能・データ範囲](docs/v04-market-analysis.md)

発売後の確認・運用コマンドは`npm run market:check`（fixture、Steam通信なし）、`npm run market:check -- --live`（先頭ページ1回）、`npm run market:validate`（ローカル検証）、`npm run market:refresh`（許可環境変数必須、Pushなし）です。為替レート単独の更新・検証は`npm run fx:refresh`・`npm run fx:validate`を使います。為替Actionsは毎日18:17 UTCにFrankfurterだけを確認し、公表レートが変わった場合だけ`fx-rate.json`をコミットします。

TBH検証は`node scripts/verify-tbh.mjs`で保存済みの最小fixtureを使用します。明示的な`--live`を付けた場合だけ、TBH AppID 3678970の先頭10件を読み取ります。本番JSONには書き込みません。
