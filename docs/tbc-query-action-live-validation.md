# TBC queryAction実通信と更新接続（2026-10-25）

## 続報：名前順で131種類の全offsetを取得（同日13:48–13:55 UTC）

単発検証の後、共有予算・停止状態を確認して隔離環境だけで追加10要求を実施した。本日の共有予算は合計14/24件、403/429・自動再試行・別エンドポイントへの切替なし。最初の価格順巡回はstart=30でtotal_countが121→131へ変わり、先頭ページとの重複も9種類あった。新しい価格順巡回でも先頭2ページ間に重複が生じた。同額商品が多い状況でoffset境界が不安定だったが、重複の原因は断定できない。

Steam検索画面に「名前（A～Z）」が存在することを確認し、Cookieなしの`sort=1&direction=1`相当の`qp`で先頭30件が名前順になることを実測した。名前順の最初の巡回ではtotal_countが131→130へ変化したが、30件ずつのページ間重複はなかった。そこで、名前順で総数だけが動いた場合は、完全性を主張せず観測を続けるよう変更した。重複時は巡回を終了し、**次回の実行**で保存済み商品を保持したまま独立巡回を1回だけ開始する。同一実行内の無限再試行はない。

次の独立巡回では以下の実レスポンスを取得した。各ページでAppID=5084200、response通貨ID=1、商品ID・画像・出品数・subtotalの検証に成功した。

| start | 実際の種類数 | total_count | 観測日時 UTC |
| ---: | ---: | ---: | --- |
| 0 | 30 | 131 | 13:54:11 |
| 30 | 30 | 131 | 13:54:26 |
| 60 | 30 | 131 | 13:54:41 |
| 90 | 30 | 131 | 13:54:56 |
| 120 | 11 | 131 | 13:55:11 |

この巡回は**5ページ・131種類・ページ間重複0・欠落したoffset0**で、報告総数131まで到達した。識別子は131種類一意、名前順も単調だった。各ページは約15秒間隔で取得しており、Steamの原子的な同時刻スナップショットではない。結果の状態は`count-reached-unverified`、`catalogComplete=false`、公開表現は商品別の部分観測を維持する。

約2–3分離れた実観測で60種類を再比較したところ、`Mystic Boots 45%`のsubtotal表示は$0.04→$0.23、出品数は9→8となった。60種類中、subtotal変化1種類、出品数変化7種類だった。変化のない商品も実際に再取得した日時で新しい観測点を持つ。模擬値はこの実測結果に含めていない。

131種類の実ストアを共通の取込へ再投入すると変更なしとなり、不要なPushを生じない。隔離公開JSONとブラウザーで131種類、検索、USD/JPY参考表示、商品別出品数と観測日時、Steamリンクを確認した。実データはGit対象外の`.market/source-name-preview/`にのみ保存し、本番JSONには含めない。

queryAction観測は商品あたり直近32点、公開側の取込記録は直近512件を保持する。古い商品の最新観測は残す。保持点の削減で過去ページが不完全になる場合はretention cutoffより前のページ件数を完全なページとして扱わない。参照価格の過去点を無制限にJSONへ蓄積しないための上限であり、旧APIの確定USD履歴とは分離したままである。

現在の30種類/ページが続くと仮定した通信量は、131・150種類で約5要求/巡、300種類で約10要求/巡、500種類で約17要求/巡。24要求/日・6要求/実行なら、前二者の6時間ごと全巡（20要求/日）だけが予算内。300種類以上では複数実行に分けるか、観測周期を下げる必要がある。いずれもSteamが保証するページサイズ・安全な頻度ではない。

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

既存パーサーと永続ページコレクターは、この最初の実レスポンス30件を変更せず受理した。以前の画面総数73件/DOM56件は別時刻の観測であり、現在の全市場として使わない。後続ページと再観測の実測結果は冒頭の続報に記録した。無人のNodeプロセスで取得できたことと、本番の継続運用許可・長期安定性を区別する。

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
- 名前順で総数のみ変化した場合は、取得済み観測を保持し、商品別の部分観測として次offsetへ進む。ページ間の識別子重複は`restart-required`で停止し、`market:source`の次回実行で独立巡回を1回だけ始める。全件保証のフラグは立てない。
- 公開モードは取得前にclean main、origin/mainの一致、有効化と権利確認記録を検査。取得後に共有予算・停止状態・検証済みストアを`[CF-Pages-Skip]`コミットで先に保存し、次に共通market:publishで公開JSONをbuild・Push・Pages照合する。
- 収集失敗時も制御状態を保存する。状態Push失敗やPages照合失敗は成功扱いしない。正常な既存公開JSONは既存のrollback/原子的保存で保護する。
- 同一の保存済み観測の再送は無変更。新しい実観測時刻は値が同じでも別の観測として保存し、鮮度を偽らない。

## Actionsの運用条件

`market-feed.yml`の既存6時間scheduleを再利用。`TBCM_MARKET_SOURCE=query-action`、`TBCM_FEED_ENABLED=true`、`TBCM_FEED_RIGHTS_REFERENCE`、`STEAM_MARKET_COLLECTION_ALLOWED=true`がそろった場合だけ直接取得を使う。これらは許諾の記録/運用ゲートであり、Valveの許可を付与しない。現在は未設定のままで、本番定期取得は未稼働。

HTTPSフィードは従来の分岐を維持し、Steam URLをfeedへ偽装する必要はない。共有concurrency groupでFX/市場更新と重複実行を防ぐ。前回ジョブが失敗/中断した場合、次回はSteamへ送信する前に停止する。失敗時のrecovery artifactを確認し、予算とstop状態を復元した上で、手動実行の`resume_after_review`を使う。HTTP403/429の共有stop解除は、従来の独立した明示操作が必要。

## 更新周期と無料運用

初回時点の121種類を全ページ30種類と仮定した場合、1巡は5要求と推計していた。その後、上記の別巡回で131種類を5ページで実測した。

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
| GET queryAction | TBC・Cookieなし200・名前順5ページ131種類・USDを実測 | 取得コードと実ページングは成立。長期継続と本番許可は未確認 |
| search/render | 過去TBHで10種類/要求。今回TBCでは未送信 | 同時に試して負荷を増やす必要はない。現時点のTBC失敗率は不明 |
| 表示済みDOM | 過去TBC56/73件、表示価格/出品数/画像 | ユーザーが開いた範囲の提供に有用。全件/無人更新の保証なし |
| HTTPS feed | 実観測を使った受信/統合/公開の隔離試験済み | 許可された供給元が設定されれば無人運用可能 |
| 他サービス/開発元 | 市場ページの公開は確認、TBC再配布feedは未確保 | 掲載されているだけで転載権限を推定しない |

[TBH Market](https://tbh-market.com/)はクライアントで描画される市場UI、[TBH Wiki Market](https://taskbarhero.wiki/market)は価格等を含む初期HTMLを返す。内部のSteam取得処理・保証された周期は公開画面だけでは確認できない。両サービスの価格をTBCMへ取り込んでいない。[非公式仕様書](https://steampriceapi.com/guide/responses/)のPOST応答形式と、今回確認したGET queryActionのdata envelopeも区別する。

次に必要なのは、許諾を確認できる環境でGitHub Actionsからの少量取得と、別日にも名前順が安定するかの測定。403/429なら直ちに停止する。今回の追加要求は冒頭の続報に記録した。
