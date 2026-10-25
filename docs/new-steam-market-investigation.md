# 新Steam Market検索方式の調査

## v0.5.1: request/response通貨・価格基準・部分観測の扱い

### 通貨と実測fixture

管理対象のfixture `tests/fixtures/tbh-query-action-real-start30-usd.json` は、AppID 3678970、`data.start=30`、`total_count=1092`、`grouping=1`、30種類の`results`を含み、全行のレスポンス通貨IDは1 (USD) である。別途記録されたChromeリクエストは`price.eCurrency=8`だったが、同じHTTP応答との対応は証明されていない。従って、これは「JPYを要求したらUSDが返った」という実測ペアではない。

queryActionアダプターは、送信する通貨IDと返された各行の`eCurrency`を別々に記録し、ページ内の通貨混在・USD以外・要求応答の不一致を拒否する。失敗診断にはAppID由来のscope、要求通貨、受信通貨を保存する。AppID 5084200はproduction scopeとなり、不正レスポンスで共有停止状態になる。TBH試験の400/404等はprobe scopeの診断にとどまるが、403/429はcontrollerによりどのscopeでも共通停止する。Cookie・sessionidを送らず、記録もしない。

このfixtureで確認できるレスポンスは`$0.03`の表示文字列と`eCurrency=1`の組み合わせだけである。別のrequest通貨で成功した証拠、JPY金額、価格単位の一般化は未確認。テストfixtureを通貨指定変更の実通信成功根拠としては扱わない。

### 手数料と価格基準

[Steam Community Market FAQ](https://help.steampowered.com/en/faqs/view/61F0-72B7-9A18-C70B)は購入者がSteam取引手数料を払い、現時点で最低額がUSD 0.01であること、ゲーム固有のpublisher feeも存在し得ることを説明する。ただし公式FAQはqueryActionの`strMinSellSubtotal`やfixtureの`unSteamFee=1`、`unPublisherFee=1`の意味、手数料の整数単位、旧`search/render`の`sell_price`との対応を定義していない。

[SteamPriceAPIの非公式レスポンス資料](https://steampriceapi.com/guide/responses/)は`unPrice + unFee`を購入者支払額として扱う実装例と、`strSubtotal`を金額の根拠にしない注意を載せている。これはSteam公式保証ではなく、今回のfixtureに同じ整数フィールドがあることも示さない。よって`strMinSellSubtotal="$0.03"`からseller net、Steam fee、publisher fee、buyer totalを逆算しない。

| 金額の概念 | 確認できた範囲 |
| --- | --- |
| 売り手の受取額 | fixtureと公開FAQから値を確定できない |
| Steam手数料 | 購入者が負担すること、公式FAQの最低額説明まで確認。fixtureの整数値との対応は未確認 |
| パブリッシャー手数料 | ゲーム固有であり得るが、fixtureの`unPublisherFee=1`の単位・計算上の意味は未確認 |
| 購入者の支払総額 | fixtureからは確定できない |
| grouped検索の最安値表示 | `strMinSellSubtotal`が`$0.03`と返ることのみ確認。総額と同一かは未確認 |

新APIの観測は`.market/query-action-observations-<appid>.json`に隔離し、各点へ価格基準`min-sell-subtotal-unverified-fees`を記録する。legacy `sell_price` USD snapshot、`scripts/price-history.mjs`、公開JSONへ接続しない。比較可能性が直接検証されるまで、この分離を解除しない。

### 商品単位の分割観測と復旧

`scripts/query-action-market.mjs`のqueryAction batch collectorは、1ページの検証成功ごとに非公開ソース領域へ原子的に書く。商品キーは`asset_description.market_hash_name`。各観測は`observedAt`、request/response通貨ID、AppID、取得元、表示subtotal、出品数を保持し、未観測商品に価格0・出品0を作らない。価格履歴関数は呼ばない。

`.market/query-action-observations-<appid>.json`には`progress` (run ID、開始日時、次offset、報告total、ページ数、当runの重複検出集合、状態)も保存され、`partial`は次回そのoffsetから再開する。取得済みの有効な商品観測は後続通信失敗でも残る。ページ重複または`total_count`変動で`restart-required`とし、観測を保持したうえで明示的な再開を要求する。報告件数まで到達しても並び順変動のため`count-reached-unverified`であり、`catalogComplete=false`を維持する。順序変動によるページ跨ぎの欠落をoffsetだけから完全検出できるとは限らない。

実通信APIは、明示的`--live`、リポジトリ運用ゲート`STEAM_MARKET_COLLECTION_ALLOWED=true`、明示的な通貨ID、共有の`.market/steam-collection-state.json`を必須とする。テストでは偽transport、明示state path、およびtest-only指定が揃ったときだけゲートを通す。予算は既定15秒間隔、最大6通信/実行、UTC日次24件。通信試行は送信前に保存し、403/429は全収集経路の共有stop状態として保存、再試行しない。失敗後に日次予算を手動で戻す実装はない。

Fixtureだけで使う: `npm run market:query-action -- --target=tbh`。実通信コマンドは `npm run market:query-action -- --live --target=tbh --request-currency-id=1 --max-pages=1` だが、今回は実行していない。Actionsはworkflow_dispatchのquery-action modeだけで起動し、定期scheduleはない。保存するのは共有予算と`.market/`内の観測JSONだけで、`public/`や履歴は変更しない。Actionsの`[CF-Pages-Skip]` commitを使い公開Pagesビルドを抑制する。

本番AppID 5084200の採用は、同AppIDでのCookieなし取得、request/response USD整合、価格基準の既存履歴との一致、実ページ挙動・ページ完全性、継続予算・復旧・キャッシュ保護を別途確認するまで保留。現時点は旧APIの本番スナップショットを維持する。

## v0.5追記：DevTools queryAction応答のfixture検証

### 取得契約の根拠と制約

ユーザー提供のChrome DevTools調査では、`GET https://steamcommunity.com/market/actions?q=Search&qp=...`、`x-valve-request-type: queryAction`でHTTP 200、`application/json; charset=utf-8`になったとのこと。従前のrouteAction/POST案より強い一次の実測根拠として、独立アダプターに実装した。今回の作業ではSteamへ接続していない。リポジトリに添付されたのはレスポンスJSONのみで、対応するNetwork request record、日時、request idは含まれないため、リクエストとレスポンスの同一通信対応はローカルでは再確認できない。

リクエストは`q=Search`とJSON配列の`qp`をURLエンコードし、AppID・currency id・sort・direction・startを含める。HTTPメソッドはGET、ヘッダーは`Accept: application/json`と`x-valve-request-type: queryAction`。Cookie、sessionid、routeAction識別子、POST bodyは使用しない。URL builderはDevToolsで観測されたrequest値`eCurrency=8`を既定にして、同じ形の試験依頼を再現する。一方、レスポンスパーサーは商品rowの`eCurrency=1`をUSDとして独立に検証する。これは両記録を同一通信と断定する実装ではなく、通貨フィールドを相互に補完・上書きしないための分離である。通常の本番収集コードへの切替は行わず、試験アダプターとして分離した。

### 実測fixtureの検査

元ファイル`C:/Users/user/Downloads/tbh_query_action_real_start30_usd.json`を改変せず`tests/fixtures/tbh-query-action-real-start30-usd.json`に複製した。これはユーザーが実レスポンスと示したDevTools JSONで、合成fixtureではない。内容の要点は次の通り。

| 項目 | 添付レスポンスで確認できた内容 |
| --- | --- |
| wrapper/fields | rootに`data`; `data`内に`start`, `total_count`, `grouping`, `facets`, `results` |
| ページ位置/件数 | `start=30`, `total_count=1092`, `grouping=1`, `results.length=30` |
| 商品識別子 | `strHash` 30種類、`asset_description.market_hash_name` 30種類、それぞれ重複なし |
| 商品所有者 | 全`asset_description.appid=3678970` |
| 通貨と価格 | 全rowの`eCurrency=1`、全`strMinSellSubtotal="$0.03"`; USD表示からsubtotal値3 centsを抽出 |
| 出品数/画像 | `cSellOrders`は全件非負整数、全件`asset_description.icon_url`あり |

商品名の履歴キーは既存形式との互換性を維持して`market_hash_name`にする。`strHash`もAPI上のgroup識別子として別に検証・保持する。画像はSteamの既存economy image hostから作り、商品URLはAppIDとmarket hash nameから生成する。`icon_url`は許可文字のみ受け付ける。

### `eCurrency`不一致と価格基準

ユーザーのDevTools request記録には`price.eCurrency=8`、レスポンスfixtureの各rowには`eCurrency=1`とある。応答fixture自体にはrequest情報が含まれないため、少なくとも現状確認できるのは「この二つの記録で通貨値が異なる」ことまでである。サーバーが通貨指定を無視した、別通信の応答が対応づけられた、または別条件があった、のいずれかを確定できない。アダプターはこのrequest IDとresponse currencyを別々に保持し、rowがUSDコード1でない場合は拒否する。通貨不一致を自動補正しない。

価格値は`strMinSellSubtotal`という名前の表示文字列から厳格なUSD形式だけを解析し、専用フィールド`minSellSubtotalMinor`に保存する。添付データには`priceMinor`と同等だと証明できる整数の価格フィールドがなく、`unSteamFee=1`、`unPublisherFee=1`の意味もこのfixtureだけでは解釈できない。`strMinSellSubtotal`と旧`search/render`の`sell_price`が売り手手取り/購入者支払額のどちらを基準にし、Steam fee・publisher feeを含むか確認できていない。よってこの値はUSD cents表示を数値化した**subtotal**としてのみ保持し、既存の`priceMinor`やUSD価格履歴・ランキング・価格ソートへ混ぜない。本番価格の移行には費用基準の照合が必要。

### ページ送りと部分収集

この応答で観測したのは`start=30`で30商品種類が返った1ページだけ。`start=0`/`60`、別ページでの件数、総数変動、currency値の対応は実測していない。アダプターはページサイズを固定値で決めず、応答の`results.length`に基づいて次offsetを計算し、`data.start`が要求offsetと一致しない場合や`total_count`がページ間で変化した場合、重複ID、空の途中ページ、AppID/通貨不一致を拒否する。最大ページ数は既定の1実行6回以下に制限できる。部分結果はメモリー上で返すだけで、キャッシュや履歴には書き込まない。

仮に1092種類が常に30件ずつ返れば算術上`ceil(1092/30)=37`リクエストで、旧APIの過去実測10商品種類/ページ（約110リクエスト）の約3分の1。ただしこれは単一の`start=30`実測からの推定で、全ページが30件という確認ではない。sort=priceのページ境界は価格変動で移動し、人気度・出品数sortも売買で変化する。offset pagingで全件を漏れなく取れる保証はなく、reported countと一致しても原子的な同時点スナップショットとは呼ばない。開始offset、商品単位`observedAt`、既取得キー、進捗を永続化する分割収集は今回実装していない。

### 実装と本番判断

新規[`scripts/query-action-market.mjs`](../scripts/query-action-market.mjs)はURL/headers生成、grouped応答専用パーサー、厳格なUSD subtotal parser、画像/Steam URL生成、重複検出、上限6ページのメモリー限定ページ送り、shared request controller経由のGET adapterを持つ。fixtureテストで正常30件、異常通貨/AppID/価格/start/total/画像/重複/欠損、ページ送り、応答失敗を検証する。旧APIの価格パーサーは再利用しない。

以下の未確認事項が残るため、新方式を本番切替せず、既存USD旧API、JPY換算、履歴、ランキング、ウォッチリスト、UIと429制御を維持する。

- queryAction GETがCookieなしで成功するか（今回のfixture単独では確認できない）
- `eCurrency:8` requestと`eCurrency:1` responseの対応関係
- `strMinSellSubtotal`の手数料基準と旧`priceMinor`との互換性
- `start=0/60`、ページサイズ変動、total_count変動時の実挙動
- 30件の並び順の完全な安定性、将来も同じレスポンスschemaか
- 利用条件/自動取得・公開再配布の許可条件

**判断：** 実測fixtureで構造を扱える試験用queryAction adapterは完成したが、実価格履歴と価格基準が同じだと確認できないため、`public/market-usd.json`・履歴・ランキングへは接続しない。本番切替は不可。Steamの定期収集も有効化しない。

## v0.4.4追記：ブラウザー通信の捕捉状況と取得設計評価（2026-10-25）

### 実ブラウザー通信の調査結果

既存の未ログインTBHマーケット画面は表示できたが、この実行環境のChrome接続ではNetworkイベント/APIや過去のHARを取得できず、ChromeにCDPリモートデバッグポートもなかった。ページの再読み込みはせず、画面HTMLとページが参照している公開JS資産5件を読み取り、routeAction関連文字列が含まれないことを確認した。これはブラウザーが送ったHTTP通信の証拠ではない。メソッド、完全URL、ヘッダー、本文、応答Content-Type、追加読み込み条件は**捕捉できていない**。Steam Marketへの追加実通信はしていない。

従って、現時点で比較できる「ブラウザー通信契約」は存在しない。以前のTBCM候補リクエストは`POST /market/search?appid=3678970&sort=1&dir=1`、`x-valve-request-type: routeAction`、`x-valve-action-type: ZFJAHYDA:SearchMarketListings`、1要素配列のJSON本文で、HTTP 400、Content-Typeなし、409ms、Retry-Afterなしだった。本文は未保存である。HTTP 400はサーバーがリクエストを受け付けなかったという観測だけで、次の原因を特定しない：action識別子、URL/JSONスキーマ、必須ヘッダー、ベータ提供条件、未ログイン制約、その他のサーバー側条件。以前の簡略候補が404、今回候補が400だった差も原因同定の根拠には不足する。

将来のプローブはステータス、最大120文字に制限し改行を除いたContent-Type/Retry-After、応答時間、固定の短い診断文だけを記録する。HTTP本文、Cookie、トークン、レスポンス由来の自由文は記録しない。400/404の本文を取得せず「リクエスト拒否」「route利用不可」とだけ分類する。403/429は全経路停止、TBHの400/404は試験診断に限定する。実ブラウザー通信を捕捉するまでrouteActionヘッダー・本文を修正せず、新APIへの追加リクエストも行わない。

### 非公式Steam HTTP資料の評価

次の資料を参照した。いずれもSteam/Valve公式API仕様ではなく、独立した価格データ提供APIでもない。Steam Community MarketのHTTP挙動を第三者が文書化した非公式資料であり、正確性や継続性の保証はない。[Discovery](https://steampriceapi.com/api/discovery/)・[Errors and limits](https://steampriceapi.com/guide/errors-and-limits/)・[Response variants](https://steampriceapi.com/guide/responses/)。本節では実測と資料記載を区別する。

| 論点 | 非公式資料に記載された内容 | TBCMでの扱い |
| --- | --- | --- |
| `POST /market/search` grouped | `grouping: 1`の`results[]`はカタログ商品種類。UIは`start`を10ずつ進める。 | 1ページ10商品種類という**資料値**。今回のrouteActionは400なのでTBH実測ではない。 |
| Direct listings | `listings[]`は個別売り出し行で、UIは`start`を30ずつ進める。 | 30は出品行であり、商品種類30個ではない。複数出品が同一商品に属する可能性がある。 |
| 旧`search/render` | `count`を大きくしても10件に上限、`start`でページ送り。 | TBHで以前観測した`pagesize=10`とも一致。ただし商品数・ページ順は動的。 |
| `GET /market/appfacets/{appid}` | アプリ別の分類タグ、表示ラベル、各タグの一致件数を返すと記載。 | 分類候補・件数を把握する設計候補。TBCM/TBHで未取得・未検証であり、完全カタログそのものではない。 |
| sort | `0/4` popularity、`1` name、`2` quantity、`3` price。popularityはdirectionを無視。 | 活発な商品を先に観測する優先順位付け候補。ページ間で順番が変わるため網羅性・スナップショット整合性には使えない。 |
| 旧GETの頻度 | 約20回/分、priceoverviewは約1,000回/日という「community working consensus」。Steam公開上限ではない。 | TBCMの自主制限は最低15秒間隔（連続時に最大4回/分相当）、通常1実行6回、日次24回。自主制限は非公式参考値より抑制的で、Steamの安全保証値ではない。 |

価格・数量ソートは観測対象の優先順位付けに使える一方、sort結果を走査している間に価格、人気度、出品数が変わるとページ境界が移動し、重複・欠落が起きる。Facet間も同一商品が複数分類に一致しうる。Facetのない商品、未分類商品、空の分類、分類更新、応答件数の変化もあり得る。したがって、分類を分割して全件取得できたと見なすのは禁止する。分割案を将来試す場合も商品キーで重複を除き、独立した安定したcatalog ID集合と期待件数を検証できない限り「全件完了」と表示しない。

### 要求回数と観測設計

比較の基準として、既存の旧API TBH試験では`total_count=1093`、`pagesize=10`、`count=100`指定に対し実際は10商品種類が返った。固定カタログだと仮定した単純計算は`ceil(1093 / 10) = 110`一覧リクエストであり、これは過去の1ページ実測に基づく**算術見積もり**で、routeActionの実測ではない。15秒間隔を連続消費した理論所要時間は約27.5分だが、TBCMの日次24回上限では少なくとも約4.6日分に分かれる。市場の並び替わりを加味すると、各回の集合が一致する保証はなく、110回でも一貫した全件スナップショットにはならない。新APIのgrouped 10件/ページがTBHでも成立するかは未確認。direct listings 30行/ページを商品種類数として110/30に減算するのは誤りである。

通信を次の段階に分離する設計を推奨する。

1. **発見**：低頻度で旧一覧APIを順送りし、確認済み商品キーの集合を更新。各観測に開始・終了時刻とページ位置を保持し、全ページ完了・重複検査・件数整合を満たさない走査は完全カタログに昇格させない。新routeActionはブラウザー契約捕捉と1回限りの実証が終わるまで使わない。
2. **優先価格観測**：発見済み商品のうち活発なものを、検索一覧の人気度/出品数/価格sort等から候補化する。sort別に取得した時刻を記録し、観測ごとの`observedAt`を保持。全商品の同時刻スナップショットとは扱わない。個別detail/orderbook/履歴は今の閲覧機能に必須な場合だけ別予算にする。
3. **保存**：商品情報の変化と実観測時刻を真実として保存する。価格未変化でも観測時刻を隠さない。巨大な毎時更新を始める前に、商品ごとのJSON、ファイル数、履歴肥大化を再評価する。
4. **公開**：Git履歴保存とPagesデプロイを別頻度にする。Git連携Pagesは公開ビルドを毎観測コミットに結び付けるとビルド回数が増える。必要なら非公開の観測更新をPages skip対象にし、表示用snapshotを日次/数時間ごとにまとめて公開する。ただし、skip動作を実workflowで確認してから採用し、skipされた変更もmainへpush済みの状態にする。

初期の自主日次上限24回を維持する場合、1回をcatalog巡回用に確保しても残り23回は最大23ページ/日に過ぎない（1ページ10種類なら単純計算最大230種類相当。ソート/ページ移動・重複・空値があるので実収集数は下がり得る）。広い全件更新より、少数の既知活発商品を定期観測し、catalog発見はより長周期にする方が現実的。ただし、新商品発見遅延とのtradeoffがある。停止状態や将来の予算はrunをまたいで永続化する。

Free運用案：最初はSteamを手動試験のみ、Frankfurterの日次更新は既存の独立workflowのまま維持。利用条件と小規模連続運転の安定性を確認した後、Steam観測はまず1日1回程度から開始し、段階的に6時間/数時間へ調整する。15秒間隔は1 run内の最短間隔であり、実行予定を15秒ごとにしてよいという意味ではない。日次24回は厳格なアプリ側予算である。保存は観測ごと、Pages公開は差分と利用価値に応じてバッチ化する。GitHub Actions/Cloudflare Pages無料枠はアカウント・現在のプラン条件を別途確認し、Steamの非公式20/分値を予算根拠に使わない。

### 適用したコード改善

TBH用routeActionプローブの失敗診断に、Content-Type、Retry-After、応答時間と、レスポンス本文を読まずに分類した短い診断文を記録する。Content-Type等のヘッダーはCR/LF/タブを除去し120文字に切る。HTTPエラー本文・HTMLチャレンジ本文・トークン類は保存しない。400/404の診断は`scope: tbh-route-probe`で、既存の本番旧APIをグローバル停止しない。403/429の全経路停止、1リクエスト試験上限、15秒間隔、日次予算を維持する。

本変更時点ではブラウザー通信を捕捉できず、既知の400は以前の実測でContent-Typeなしだった。新しい診断形式は次回の明示的な手動試験に適用するための実装で、過去の400にContent-Typeや原因を後付けしていない。

## v0.4.3追記（2026-10-25）

### routeAction公開実装の確認

[githuber53/steam-market-bucket-group-id](https://github.com/githuber53/steam-market-bucket-group-id)の指定ファイルを確認した。これはValveの公式仕様ではなく、公開された第三者実装である。

- [`steam_market_params/client.py`](https://github.com/githuber53/steam-market-bucket-group-id/blob/main/steam_market_params/client.py)は`x-valve-request-type: routeAction`と`x-valve-action-type: ZFJAHYDA:SearchMarketListings`を設定し、JSON POSTを行う。
- [`steam_market_params/names.py`](https://github.com/githuber53/steam-market-bucket-group-id/blob/main/steam_market_params/names.py)の本文は1要素配列で、`appid`、`filters`、`price.eCurrency`、`accessoryFilters`、`sort`、`direction`、`start`を含む。
- [`steam_market_params/urls.py`](https://github.com/githuber53/steam-market-bucket-group-id/blob/main/steam_market_params/urls.py)は`/market/search?appid=…&sort=…&dir=…`を生成する。

同実装にはUser-Agent/client-hintsの固定値、Cookie読込、retryable statusの再試行もある。今回の検証ではそれらを使わず、Cookie・認証情報・UA偽装・再試行を避けた。送信ヘッダーはAccept、Content-Type、Origin、Refererと上記2つのValveヘッダーに限定した。

Steamの既存公開画面には「マーケットベータを終了」操作があり、現在のベータUIであることを確認できた。ただしChromeの過去Networkログはこの環境から取得できず、画面のロード時に何件のHTTP通信が発生したかや、Steam自身が送ったrouteAction本文は直接捕捉していない。[SteamのTBHマーケット画面](https://steamcommunity.com/market/search?appid=3678970)

### 前回リクエストとrouteAction再試験

| 試験 | リクエスト | HTTP | 診断 |
| --- | --- | --- | --- |
| 前回 | `POST /market/search?appid=3678970`。Valveヘッダー、`sort`、`direction`なし | 404 | Content-Type・応答時間・Retry-Afterは初版ログで未取得 |
| 今回 | `POST /market/search?appid=3678970&sort=1&dir=1`。routeActionヘッダーと完全候補本文 | 400 | Content-Typeなし、409ms、Retry-Afterなし。1回のみ |

今回の本文は次のとおり。Cookieなし・USD・先頭位置で送った。

```json
[{"appid":3678970,"filters":{},"price":{"eCurrency":1},"accessoryFilters":{},"sort":1,"direction":1,"start":0}]
```

400の本文は保存・表示しておらず、商品レスポンスもなかった。前回からHTTPステータスが変わったためリクエスト形式差が影響した可能性はあるが、404の原因や400の理由は特定できない。レスポンスが成功していないため、商品種類数、total_count、価格、画像、出品数、通貨、ID、ページングはいずれも今回確認できていない。再試行や別URLへのフォールバックはしていない。

### 停止状態の分離

前回の状態は404由来の`invalid-response`で、403/429ではなかった。既存カウントを消さず、404を`scope: tbh-route-probe`の診断履歴に移し、全経路に適用されていた停止フラグを解除した。今回の400も同じ試験用診断に記録した。2026-10-25 UTCの状態は3リクエスト、最終通信時刻`2026-10-25T05:30:38.120Z`、グローバルstopなしである（1件は過去の旧GET試験、2件は新routeAction試験）。403/429は試験経路を含む全経路でこれまでどおりグローバル停止する。

routeActionのURL・ヘッダー・本文はTBH専用プローブとfixtureテストに隔離した。本番のTask Bar Cube AppID `5084200`は既存`search/render` USDコレクターのままで、商品JSON・履歴・ランキングを変更していない。市場の定期実行も有効化していない。

今回のfixture/コードテストは63件成功、typecheckとbuildも成功した。routeActionがHTTP 200になっていないため、本番移行条件は満たしていない。

## 結論

本番コレクターは従来のUSD `GET /market/search/render/`を維持する。新しい`POST /market/search`は、前回の簡略リクエストが404、routeActionヘッダー・sort指定を足した今回の1回限りの試験が400だった。いずれも商品データを返しておらず、返却件数、価格、ID、画像、出品数、ページングは未検証である。旧方式より有利という根拠がないため移行しない。

新APIを再試行したり旧API・掲載ページへフォールバックしたりしない。TBHの試験データは本番キャッシュや履歴に書き込んでいない。Task Bar Cubeの市場JSONはAppID `5084200`の0件を維持している。

## 旧APIと新API

| 方式 | リクエスト・返却単位 | TBHで確認できた値 | 全件概算 | 判断 |
| --- | --- | --- | ---: | --- |
| 旧`GET /market/search/render/` | `appid`, `currency`, `country`, `start`, `count`; JSON内`results`は1商品種類/行 | 2026-10-25の既存1ページ試験で`count=100`に対し10行、`pagesize=10`,`total_count=1093`; USD価格・画像・出品数は各10/10 | `ceil(1093/10)=110` | 現在の既知の成功経路。商品ごとのUSD値を検証できた |
| 新`POST /market/search` | 1要素配列のJSON body。routeActionヘッダー、URL/bodyのsort指定あり | 簡略リクエストは404、routeAction候補はHTTP 400（409ms）。商品レスポンスなし | 算出不可。本文の`total_count`も得られず | 実レスポンスを確認できないので、本番移行しない |
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
2. 停止状態`.market/steam-collection-state.json`を確認する。routeActionの404/400はTBH試験の診断履歴に分離され、本番収集のグローバルstopとは独立する。403/429は経路を問わずグローバルstopとして記録されるため、解除には運用者のレビューと明示操作が必要。
3. GitHub Actionsのfixtureモードを実行し、取得対象をAppID `5084200`の旧USDコレクターに固定する。live実行はSteamの利用条件と再配布条件の確認、運用許可変数`STEAM_MARKET_COLLECTION_ALLOWED=true`、予算確認後に手動で行う。定期scheduleは有効にしない。
4. 初回スナップショットの価格・通貨・商品名・`market_hash_name`・画像URL・出品数を確認してから履歴/ランキングの更新とPages反映を確認する。JPY表示はfreshなFrankfurterレートを使う。

現在の1実行6件上限では、ページ数が必要数を超える市場は完全スナップショットとして保存されない。発売時に件数が増えた場合、上限を無根拠に上げず、ページサイズと市場変動を再評価して商品別`observedAt`を持つ分割観測を別途設計する。観測頻度、Gitへの履歴保存頻度、Pages公開頻度は別々に決める。30分全件更新は保証せず、PagesのGit連携ビルド負荷も含めて再評価する。

## 未解決事項

- 新POST検索は初回404、routeAction候補での再試験400となった。どちらの理由も未特定。route、機能公開範囲、リクエストスキーマのどれかを決めつけない。
- 実際のSteamフロントエンド通信を直接捕捉していない。Steam公式告知は検索・グループ化UIを説明するが、API bodyは公開していない。
- 新APIのTBH価格、単位、商品ID、画像、sell-order件数、認証要否、ページサイズ、429挙動を確認できていない。
- 旧方式の実測は過去の1ページであり、発売後市場の応答形式や取得可能ページ数を保証しない。
- Steamの利用条件・自動取得および市場情報再配布の条件を確認できていないため、Steam定期実行は引き続き無効。
