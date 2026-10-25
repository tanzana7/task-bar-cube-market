# TBC queryAction実通信と更新接続（2026-10-25）

## 実測結果

操作者が依頼した単発の技術検証として、CookieなしでTBCへ1要求を送った。実通信フラグはこの子プロセスだけに設定し、リポジトリ変数を変更していない。HTTP 200、Content-Type `application/json; charset=utf-8`、応答498ms、Retry-Afterなし。共有予算は送信前に3→4件へ保存。403/429・再試行・別APIへのフォールバックはない。

```text
GET https://steamcommunity.com/market/actions?q=Search&qp=<URL encoded JSON>
Accept: application/json
x-valve-request-type: queryAction
```

```json
[{"appid":5084200,"filters":{},"price":{"eCurrency":1},"accessoryFilters":{},"sort":3,"direction":1,"start":0}]
```

`Cookie`、`sessionid`、`Authorization`は送らず、redirectも追跡しなかった。既存ブラウザーのNetworkログを読むことは、このCookieなし検証の前提ではなかった。

| フィールド | 実測 |
| --- | --- |
| envelope | `data.{start,total_count,grouping,facets,results}` |
| start / grouping | 0 / 1 |
| total_count / results.length | 121 / 30 |
| AppID / eCurrency | 全行5084200 / 全行1（USD） |
| 商品キー | `asset_description.market_hash_name`、30件一意 |
| strHash | 30件一意 |
| 画像 / 出品数 | 全行にicon_url / 整数cSellOrders |
| 表示subtotal | `$0.03`または`$0.04` |
| feeフィールド | 全行unSteamFee=1、unPublisherFee=1 |
| 実観測日時 | 2026-10-25T12:36:56.601Z |

既存パーサーと永続ページコレクターは、この実レスポンス30件を変更せず受理した。以前の画面総数73件/DOM56件は別時刻の観測であり、現在の全市場として使わない。全121種類、start=30以降、ページ順の安定性、時間を空けた更新は今回未実測。無人のNodeプロセスで1要求が成立したことと、継続運用の安定性を区別する。

最小限にした応答・観測ストア・測定レポートはGit対象外の`.market/source-preview/capture/`へ保存した。Cookieや応答ヘッダー全体は保存しない。実商品fixtureをGitHubや本番JSONへ追加していない。

## 価格基準

subtotalの文字列からUSDセント相当の参考値を検証できるが、旧sell_priceとの同一性は未確認。今回のfee値から、その単位や売り手受取額/買い手支払総額の計算式を推測して採用しない。同一時点・同一商品の旧API比較は未実施。保存する`priceMinor`はnullで、参考文字列と出品数・観測日時を既存の観測UIへ送る。確定USD価格履歴・ランキングには混ぜない。

以前の「request eCurrency=8／保存response eCurrency=1」は同一通信と確認できないままだが、今回は同一のCookieなしGETでrequest=1、全response=1を実証した。JPY指定やJPY実価格は今回試していない。JPY表示は既存の有効なFrankfurterレートによる参考換算を使う。

## 取得から公開までの接続

`scripts/market-source.mjs`はTBC/USD固定。新しい商品DBを作らず、queryActionの商品別ストアから、HTTPSフィードと共通の`runMarketInputCycle`へ渡す。この共通処理は既存market-importとmarket-publishを呼ぶ。

```sh
# 実測ストアの再生。Steam通信なし
npm run market:source -- --saved-store path/to/observations.json --isolation-root path/to/isolated

# 許可された単発検証。子プロセスの実通信ゲートも必要
npm run market:source -- --live --max-pages 1 --isolation-root path/to/isolated

# 継続取得と公開の条件を確認した環境のみ
npm run market:source -- --live --max-pages 6 --publish
```

- 共有予算：15秒以上、6要求/実行、24要求/UTC日。送信前に永続化、redirect禁止、Cookie省略、失敗後に自動再試行しない。
- 隔離収集の進捗は`<root>/source/query-action-observations.json`へ保存し、次回に再開する。`--saved-store`は再生専用で収集進捗を上書きしない。
- 市場順序/総数が変化した場合は取得済み観測を保持し、`restart-required`で停止。確認後に`--restart`を明示して新しい巡回を始める。全件保証のフラグは立てない。
- 公開モードは取得前にclean main、origin/mainの一致、有効化と権利確認記録を検査。取得後に共有予算・停止状態・検証済みストアを`[CF-Pages-Skip]`コミットで先に保存し、次に共通market:publishで公開JSONをbuild・Push・Pages照合する。
- 収集失敗時も制御状態を保存する。状態Push失敗やPages照合失敗は成功扱いしない。正常な既存公開JSONは既存のrollback/原子的保存で保護する。
- 同一の保存済み観測の再送は無変更。新しい実観測時刻は値が同じでも別の観測として保存し、鮮度を偽らない。

## Actionsの運用条件

`market-feed.yml`の既存6時間scheduleを再利用。`TBCM_MARKET_SOURCE=query-action`、`TBCM_FEED_ENABLED=true`、`TBCM_FEED_RIGHTS_REFERENCE`、`STEAM_MARKET_COLLECTION_ALLOWED=true`がそろった場合だけ直接取得を使う。これらは許諾の記録/運用ゲートであり、Valveの許可を付与しない。現在は未設定のままで、本番定期取得は未稼働。

HTTPSフィードは従来の分岐を維持し、Steam URLをfeedへ偽装する必要はない。共有concurrency groupでFX/市場更新と重複実行を防ぐ。前回ジョブが失敗/中断した場合、次回はSteamへ送信する前に停止する。失敗時のrecovery artifactを確認し、予算とstop状態を復元した上で、手動実行の`resume_after_review`を使う。HTTP403/429の共有stop解除は、従来の独立した明示操作が必要。

## 更新周期と無料運用

今回の121種類を全ページ30種類と仮定した場合、1巡は5要求。実測は先頭1ページだけで、5ページの網羅性は未確認。

| 周期 | 想定要求/日 | 自主上限24件/日 | 31日間の市場build＋日次FX | 判断 |
| --- | ---: | --- | ---: | --- |
| 1時間 | 120 | 超過 | 744＋31＝775 | 現予算・Pages Freeに不適合 |
| 3時間 | 40 | 超過 | 248＋31＝279 | build枠内でも全件観測は予算超過 |
| 6時間 | 20 | 範囲内、余力4 | 124＋31＝155 | 継続実測後の候補 |

1ページだけの部分観測なら毎時24要求に収まるが、全市場の毎時更新とは表現できず、公開まで毎回行えばbuild枠を超える。観測・保存・公開は別頻度として評価する。Pages Freeの500build/月は[公式制限](https://developers.cloudflare.com/pages/platform/limits/)で確認した。

既存の公開GitHubリポジトリ＋標準Actions runner＋Pagesで実装でき、有料価格APIは不要。Workersへ移す場合は、現行ファイル/Git処理の代わりに永続ストアと公開経路が必要になる。今回の規模ではインフラを増やさずActionsを選ぶ。

### 実商品30件による隔離公開試験

保存したTBC実観測ストアを入力し、別GitリポジトリとローカルPages模擬サーバーで`market:source --saved-store ... --publish`を実行した。新たなSteam要求は0件。商品30件を既存の公開JSONへ統合し、ビルド、Git Push、配信されたJSONの内容照合まで成功した。再投入ではコミットが増えなかった。1商品の価格・出品数・観測時刻だけを変更した模擬再観測も、他29件を保持して更新できた。Push拒否時は公開JSONをロールバックし、模擬429時は共有停止状態をリモートへ保存して公開JSONを保護した。

同じ実商品30件を隔離ブラウザーでも表示し、検索、参考USD価格、出品数、個別観測時刻、商品リンクを確認した。画面での表示確認は本番掲載を意味しない。試験用の変更後データも本番へ入れていない。

## 方式の比較と次の実験

| 方式 | 現在の証拠 | 自動取得の評価 |
| --- | --- | --- |
| GET queryAction | TBC・Cookieなし200・30種類・USDを今回1要求で確認 | 取得コードは成立。別ページと継続更新は追加の少量実測が必要 |
| search/render | 過去TBHで10種類/要求。今回TBCでは未送信 | 同時に試して負荷を増やす必要はない。現時点のTBC失敗率は不明 |
| 表示済みDOM | 過去TBC56/73件、表示価格/出品数/画像 | ユーザーが開いた範囲の提供に有用。全件/無人更新の保証なし |
| HTTPS feed | 実観測を使った受信/統合/公開の隔離試験済み | 許可された供給元が設定されれば無人運用可能 |
| 他サービス/開発元 | 市場ページの公開は確認、TBC再配布feedは未確保 | 掲載されているだけで転載権限を推定しない |

[TBH Market](https://tbh-market.com/)はクライアントで描画される市場UI、[TBH Wiki Market](https://taskbarhero.wiki/market)は価格等を含む初期HTMLを返す。内部のSteam取得処理・保証された周期は公開画面だけでは確認できない。両サービスの価格をTBCMへ取り込んでいない。[非公式仕様書](https://steampriceapi.com/guide/responses/)のPOST応答形式と、今回確認したGET queryActionのdata envelopeも区別する。

次に必要な実測は、停止状態と予算を確認してstart=30の1ページ、さらに時間を空けた同一商品の再観測。403/429なら直ちに停止する。今回成功後の追加要求は行っていない。
