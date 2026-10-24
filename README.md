# Task Bar Cube Market

Task Bar Cube（Steam AppID 5084200）のCommunity Market出品を検索・比較する非公式サイトです。

## 開発

```sh
npm ci
npm run dev
npm run test
npm run build
```

Viteの出力は`dist/`です。Cloudflare Pagesはビルドコマンド`npm run build`、出力ディレクトリ`dist`に設定します。現在のJSONは未公開状態です。Steamの自動収集と再配布の許諾を確認するまで、定期更新は設定しません。

## データ更新

`node scripts/steam-market.mjs`は手動実行用です。`search/render/`からAppID 5084200だけを取得し、全ページが正常なら`public/market.json`を更新します。403、429、欠損、通信エラーでは失敗して既存キャッシュを保持します。実行前にSteamの利用条件と必要な許諾を確認してください。

本番ブラウザはSteamに直接アクセスせず、静的な`market.json`だけを読みます。データが未取得なら架空の商品や価格は表示しません。

## 資料

- [参考サイト調査](docs/reference-analysis.md)
- [参考リポジトリの技術調査](docs/tbh-market-tool-analysis.md)
- [Steamデータ調査](docs/steam-data-investigation.md)
