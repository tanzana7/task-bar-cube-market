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

## 正規データの取込と公開

Steamからの自動取得・再配布の許可は未確認です。Steamの利用規約ではサービスとのやり取りを自動化するスクリプト等を制限しているため、`STEAM_MARKET_COLLECTION_ALLOWED=true`だけをValveの許可とみなさないでください。許可された運用、または適正に取得・提供されたTBC AppID `5084200` のJSONがある場合のみ、次の取込経路を使用します。CLIはSteamへ通信しません。

```sh
# 形式を自動判定して検証だけ行う
npm run market:import -- --input path/to/steam-response.json --observed-at 2026-10-25T09:00:00.000Z --provenance "operator-provided Steam response"

# ディレクトリ内のJSONページをまとめて検証
npm run market:import -- --input path/to/steam-pages --observed-at 2026-10-25T09:00:00.000Z --provenance "operator-provided Steam responses"

# 検証からコミット・Push・Pages反映確認まで
npm run market:publish -- --input path/to/steam-response.json --observed-at 2026-10-25T09:00:00.000Z --provenance "operator-provided Steam response" --publish --rights-confirmed
```

HAR形式ならTBC AppIDのSteam Market `search/render`と`q=Search`の`actions`通信だけを自動抽出し、HARのリクエスト開始時刻を観測時刻として使います。別AppID、別action、無関係なAPI応答は無視します。対象通信ではURL/`qp`のAppID・ページ位置・通貨をレスポンスと照合し、通貨不一致や破損した対象応答は拒否します。Cookieや認証ヘッダーは取り込まず、出力にも保存しません。生のJSONに信頼できる取得時刻がない場合は`--observed-at`を指定してください。ファイル時刻や処理時刻を商品観測時刻に流用しません。`--rights-confirmed`は操作者の確認記録であり、Valveの許可を付与するものではありません。

Steam Market画面の表示DOMを構造化した`steam-market-dom` JSONも同じ観測ストアへ取り込めます。表示価格は通貨表記を検証した画面参考値として保持し、数値価格・価格履歴へ変換しません。総件数より少ないDOM取得は必ず部分観測として記録します。

`market:publish`は既定でdry-runです。公開モードではmainがorigin/mainと一致し、作業ツリーがcleanであることを確認してから、検証済みの`public/market-observations.json`だけをビルド・コミット・Pushし、Cloudflare Pagesへ届いたJSONを確認します。同一入力の再実行は変更なしとしてPushしません。入力AppIDは5084200固定で、TBH fixtureは拒否されます。`queryAction`の`strMinSellSubtotal`は価格基準確認中の参考値として隔離し、検証済み価格履歴・ランキングには接続しません。既存商品は観測日時が新しいデータを表示し、未観測商品を0価格・0出品にしません。

既存の`.market/query-action-observations-5084200.json`に保存されたTBC観測も、権限確認後に同じ公開経路へ渡せます。これはSteamへアクセスせず、商品別の観測時刻を保ったまま、価格を非数値の参考値として公開JSONへ変換します。手動Actionsで行う場合は`market-refresh.yml`の`publish-query-action`を選び、再配布権限を独立して確認してください。チェックボックスと`STEAM_MARKET_COLLECTION_ALLOWED`はValveの許可ではありません。

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

## 継続更新の試作

HTTPフィード受信から既存の検証・観測統合・GitHub Push・Pages照合まで接続しました。許可済み供給元の設定がない現在は本番フィード処理を停止しています。Steamの定期アクセスは有効化していません。

実データ56件を使う隔離総合試験は `npm run market:feed:e2e`。初回実観測と、1商品だけ変更した模擬再観測を区別して検証し、本番へ商品を公開しません。取得方式の比較、Actions設定、利用条件、運用手順は[市場更新アーキテクチャ](docs/market-update-architecture.md)を参照してください。
