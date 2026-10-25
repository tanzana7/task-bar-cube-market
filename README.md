# Task Bar Cube Market

Task Bar Cube（Steam AppID 5084200）のCommunity Market出品を検索・比較する非公式サイトです。

## 開発

```sh
npm ci
npm run dev
npm run test
npm run build
```

Viteの出力は`dist/`です。Cloudflare Pagesはビルドコマンド`npm run build`、出力ディレクトリ`dist`です。JPY / USDを切り替えられ、選択はブラウザに保存されます。実データの通貨を検証できるまで各JSONは未取得状態です。

## データ更新

`node scripts/steam-market.mjs --live`は許諾確認後の手動実行用です。環境変数`STEAM_MARKET_COLLECTION_ALLOWED=true`も必要です。`search/render/`からAppID 5084200のJPY / USDを取得し、全ページと通貨を検証してから`public/market-jpy.json`と`public/market-usd.json`を更新します。403、429、欠損、通貨不一致、通信エラーでは失敗して既存キャッシュを保持します。現時点ではSteamの自動収集と再配布の許諾が未確認です。

本番ブラウザはSteamに直接アクセスせず、静的JSONだけを読みます。データが未取得なら架空の商品や価格は表示しません。

## GitHub Actions

`Validate and refresh market snapshots`は`workflow_dispatch`のみです。既定の`fixture`はSteamへ通信せず、テストとビルドを確認します。`live`は許諾確認後にリポジトリ変数`STEAM_MARKET_COLLECTION_ALLOWED=true`を設定した場合のみ動き、更新JSONに変更があればコミット・Pushします。PagesのGit連携がデプロイします。条件と手順は[更新運用](docs/refresh-operations.md)を参照してください。

## 資料

- [参考サイト調査](docs/reference-analysis.md)
- [参考リポジトリの技術調査](docs/tbh-market-tool-analysis.md)
- [Steamデータ調査](docs/steam-data-investigation.md)
- [更新運用](docs/refresh-operations.md)
