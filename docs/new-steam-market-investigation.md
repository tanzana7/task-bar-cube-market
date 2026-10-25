# 新Steam Market検索方式の調査

## 結論

本番コレクターは従来のUSD `GET /market/search/render/`を維持する。新しい`POST /market/search`は、非公式資料からリクエスト形・レスポンス候補を把握できる一方、TBHを対象とした今回の1回限りの実リクエストはHTTP 404となり、返却件数、価格、ID、画像、出品数、ページングを一切検証できなかった。旧方式より有利という根拠がないため移行しない。

新APIを再試行したり旧API・掲載ページへフォールバックしたりしない。TBHの試験データは本番キャッシュや履歴に書き込んでいない。Task Bar Cubeの市場JSONはAppID `5084200`の0件を維持している。

## 旧APIと新API

| 方式 | リクエスト・返却単位 | TBHで確認できた値 | 全件概算 | 判断 |
| --- | --- | --- | ---: | --- |
| 旧`GET /market/search/render/` | `appid`, `currency`, `country`, `start`, `count`; JSON内`results`は1商品種類/行 | 2026-10-25の既存1ページ試験で`count=100`に対し10行、`pagesize=10`,`total_count=1093`; USD価格・画像・出品数は各10/10 | `ceil(1093/10)=110` | 現在の既知の成功経路。商品ごとのUSD値を検証できた |
| 新`POST /market/search` | 1要素配列のJSON body。ドキュメント上はgrouped `results`または個別`listings` | 今回1回POSTしHTTP 404。本文は保存しておらず、Content-Typeと応答時間は当時のプローブが出力していなかったため不明 | 算出不可。本文の`total_count`も得られず | 実レスポンスを確認できないので、本番移行しない |
| Steam掲載ページSSR | 商品別の`/market/listings/{appid}/{market_hash_name}`を取得しSSR解析 | 今回はTBH掲載ページへアクセスしていない | 1商品種類あたり基本1件。全商品分の発見には別途一覧取得が必要 | 価格一覧だけの用途では商品別の追加通信が多く、今回採用しない |

旧APIの10行/ページは過去の実測値であり、将来も同じとは限らない。Steamの公開レート制限値は確認できず、15秒間隔や6件/実行・24件/日もSteamが保証する値ではなくTBCMの運用上限である。

## Steam公式が告知した新マーケット

Valveの2026-05-12告知は、新しいカード表示、動的検索フィルター、商品グループ化、自動追加読み込み、商品ページの更新を説明している。画面機能の説明であり、`POST /market/search`のHTTP契約、bodyスキーマ、認証要否、レート制限値は公開していない。[Steam公式告知](https://store.steampowered.com/news/posts/?enddate=1779137072&feed=steam_client+Steam+News)

以下のリクエスト・レスポンス形式は[steampriceapi.comの非公式資料](https://steampriceapi.com/guide/requests/)による。Steam公式仕様とは扱わない。

```json
[
  {
    "appid": 3678970,
    "filters": {},
    "accessoryFilters": {},
    "price": { "eCurrency": 1 },
    "start": 0
  }
]
```

調査資料では、通貨は`price.eCurrency`、AppIDはbodyの`appid`、ページ位置は0起点の`start`としている。グループ検索は`grouping: 1`と`results[]`を返し、各行には`strHash`、`cSellOrders`、`cBuyOrders`、`eCurrency`、`strMinSellSubtotal`、`asset_description`等があると記載されている。別形式として`listings[]`を返す個別出品検索と、HTTP 200でもliteral `null`、HTML、SSR loader payloadを返す可能性が説明されている。[非公式レスポンス資料](https://steampriceapi.com/guide/responses/) [検索フィルター資料](https://steampriceapi.com/guide/search-filters/)

このガイドの説明ではgrouped結果は通常10商品種類単位、listing行は30件単位でページ送りする。これはTBHで実測できていないため、採用設計や通信量見積もりの実測値には含めない。グループ商品種類と個々の出品行を混同してはならない。`strHash`はopaqueな`G…` group IDの場合があり、既存履歴のキーとして使える`asset_description.market_hash_name`との対応も実データで確認できていない。[識別子の説明](https://steampriceapi.com/guide/identifiers/)

非公式資料は公開読み取りは一般に未ログインで応答すると説明するが、今回の404応答を含めTBH新APIで認証状態や成功レスポンスを確認していない。Cookieは送信しておらず、認証、制限回避、別URLへの自動フォールバックは実装しない。

## TBHの1回限り実測

2026-10-25、AppID `3678970`、USD (`eCurrency: 1`)、`start: 0`で、bodyを1要素配列にしたPOSTを1回送った。ブラウザーでSteamを開くNetwork調査は行っていない。試験通信は合計1件である。HTTP応答は404だった。

プローブの初版はHTTPエラー時にステータスだけを出力し、Content-Type、応答時間、Retry-Afterを表示しなかった。そのためこの値は**不明**であり、推定で補わない。応答本文は保存していない。再試行もしていない。現在のプローブは次回の手動診断でこれらのヘッダーと時間をエラー診断に含めるが、今回の1回を再現するため追加アクセスは行わない。

| 項目 | 結果 |
| --- | --- |
| HTTP | 404 |
| Content-Type / Retry-After / 応答時間 | 初版ログに記録なし、確認不能 |
| 返却商品種類数・総数・ページング | データなし |
| 商品ID・USD価格・価格単位 | データなし |
| 出品数・画像 | データなし |
| 価格検証率 | 算出不可 |
| 新API全件リクエスト数 | 算出不可 |

従って「新APIが10件を返した」「より多く返した」「grouped結果の形式に一致した」とは報告できない。新APIで10、30、100行の試験は、公式な実レスポンスfixtureではなく、非公式ガイドの契約例に基づく**合成fixture**でパーサー検証した。合成fixtureは`tests/fixtures/tbh-structured-search-contract.json`で、実測レスポンスと誤認できない名前・内容にしてある。

## 取得方式の比較

| 基準 | 旧`search/render` | 新`POST /market/search` | 掲載ページSSR |
| --- | --- | --- | --- |
| 1リクエストあたりの商品種類 | TBHで10件の既存実測 | 404のため不明。非公式資料はgrouped 10件を示唆 | 1商品別ページが基本 |
| 全件リクエスト数 | TBH既存実測から約110 | 不明。仮に10種類なら約110だが実測ではない | 1,093種類なら基本約1,093。発見一覧は別途必要 |
| USD価格 | 旧APIで10/10検証済み | この試験では返却なし | Issue内報告・実装に記載。今回のTBHで未確認 |
| 商品名/画像/出品数 | 既存試験で各10/10 | 未検証。ガイドのフィールド存在だけではTBHの網羅を保証しない | 公開コードはorderbook/販売履歴を中心に扱う。商品全一覧向けではない |
| 認証 | 過去の試験はCookieなしで成功 | Cookieなしで404。認証要否は結論できない | Issueでpublic-page SSRを説明。今回はアクセスなし |
| ページ順の変化 | `start`, `total_count`, 行数、重複等を検査。並び順が動くリスクは残る | 実レスポンス不明。`start`と行数以外の整合性も未確認 | 商品別なので個々の商品取得時は一覧順に依存しないが、発見は別方式 |
| 429リスク | 1回200の実績だけ。負荷・制限値の保証なし | 不明。404はレート上限を示す証拠ではない | 1商品ごとのアクセスが必要で全カタログ収集は多通信 |
| 実装/維持コスト | 既存実装・検証・キャッシュ保護あり | grouped/direct/HTML/nullの複数形式とID移行が必要 | SSR形式変更追従とfallback管理が必要 |

[nidea1/task-bar-trade-center Issue #9](https://github.com/nidea1/task-bar-trade-center/issues/9)は、同プロジェクトで`priceoverview`や`search/render`から掲載ページSSRのorderbook/販売履歴取得へ変更したと報告している。現行の[fetch.go](https://github.com/nidea1/task-bar-trade-center/blob/main/internal/market/fetch.go)は掲載ページを先に読み、SSRを解析できない場合だけ商品名完全一致のMarket検索HTMLを取得する。[analysis_parse.go](https://github.com/nidea1/task-bar-trade-center/blob/main/internal/market/analysis_parse.go)にはorderbookや販売履歴を読む処理がある。これは当該プロジェクトの429報告と実装説明であり、Steamの正式な仕様でも、一覧収集の通信削減が実証されたものでもない。今回の一覧用途には転用しない。

## 実装への適用

- 本番AppID `5084200`、USD単独取得、JPYのFrankfurter閲覧時換算、USD履歴、ランキング、JSON保護を維持する。
- `POST /market/search`はTBH専用の明示的なプローブに限り、プロダクションコレクターには組み込まない。
- プローブは共有のリクエスト予算・15秒間隔・停止状態を使い、1実行を1リクエストに固定する。Cookieを付けない。HTTP 403/429・非JSON・null・不正なmetadataで停止する。POST失敗後にlegacy GETや掲載ページを呼ばない。
- grouped `results`と個別`listings`は別形式として検証する。JPY以外の通貨、AppID違い、重複ID、不明価格は価格検証に通さない。
- 試験コードは応答本文や個人情報を保存しない。本番JSON・商品履歴・ランキングは変更しない。

## 発売後の初回運用手順

1. Task Bar CubeのSteam Marketに実商品が現れたことをブラウザーで確認する。空なら本番JSONは0件のまま維持する。
2. 停止状態`.market/steam-collection-state.json`を確認する。現在は新APIのHTTP 404を受けたため`invalid-response`で停止中。方式をレビューし、必要な場合に限り運用者が`npm run market:unblock`で明示解除する。
3. GitHub Actionsのfixtureモードを実行し、取得対象をAppID `5084200`の旧USDコレクターに固定する。live実行はSteamの利用条件と再配布条件の確認、運用許可変数`STEAM_MARKET_COLLECTION_ALLOWED=true`、予算確認後に手動で行う。定期scheduleは有効にしない。
4. 初回スナップショットの価格・通貨・商品名・`market_hash_name`・画像URL・出品数を確認してから履歴/ランキングの更新とPages反映を確認する。JPY表示はfreshなFrankfurterレートを使う。

現在の1実行6件上限では、ページ数が必要数を超える市場は完全スナップショットとして保存されない。発売時に件数が増えた場合、上限を無根拠に上げず、ページサイズと市場変動を再評価して商品別`observedAt`を持つ分割観測を別途設計する。観測頻度、Gitへの履歴保存頻度、Pages公開頻度は別々に決める。30分全件更新は保証せず、PagesのGit連携ビルド負荷も含めて再評価する。

## 未解決事項

- 新POST検索がTBHで404となった原因は未特定。route、機能公開範囲、リクエストスキーマのどれかを決めつけない。
- 実際のSteamフロントエンド通信を直接捕捉していない。Steam公式告知は検索・グループ化UIを説明するが、API bodyは公開していない。
- 新APIのTBH価格、単位、商品ID、画像、sell-order件数、認証要否、ページサイズ、429挙動を確認できていない。
- 旧方式の実測は過去の1ページであり、発売後市場の応答形式や取得可能ページ数を保証しない。
- Steamの利用条件・自動取得および市場情報再配布の条件を確認できていないため、Steam定期実行は引き続き無効。
