# Task Bar Cube Market

Task Bar Cube（Steam AppID 5084200）のCommunity Market出品を検索・比較する非公式サイトです。

## 開発

```sh
npm ci
npm run dev
npm run test
npm run build
```

Viteの出力は`dist/`です。Cloudflare Pagesはビルドコマンド`npm run build`、出力ディレクトリ`dist`です。USD市場JSONを唯一の正規データとして読み、JPYは取得時点で有効なFrankfurter USD/JPYレートから画面上で換算します。選択した通貨はブラウザに保存されます。Cubeの商品がまだ確認できないため、本番JSONに商品や履歴はありません。旧`market-jpy.json`は移行期間中の互換用に残しますが、更新・表示には使いません。

## データ更新

`node scripts/steam-market.mjs --live`は許諾確認後の手動実行用です。環境変数`STEAM_MARKET_COLLECTION_ALLOWED=true`も必要です。`search/render/`でAppID 5084200のUSD一覧だけを取得し、全ページを検証した後、USD市場JSON・USD価格履歴・軽量ランキングをまとめて更新します。JPY市場へのリクエストも為替APIへの依存もありません。JPY参考価格は閲覧時に現在有効なFXレートがある場合だけ生成し、未取得・期限切れなら更新待ちを表示します。403、429、欠損、通信エラーでは既存キャッシュを保持します。現時点ではSteamの自動収集と再配布の許諾が未確認です。

本番ブラウザはSteamに直接アクセスせず、静的JSONだけを読みます。データが未取得なら架空の商品や価格は表示しません。

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
