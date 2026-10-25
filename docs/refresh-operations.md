# 市場データ更新の運用条件

## 現在

Steamの利用規約が取得を許諾するという確認は得られていません。Steam Subscriber Agreementの「Automation」節はSteamサービスとのやり取りを自動化するスクリプト等を制限し、コンテンツの複製・公開・配布にも制限を記載しています。Steam Web APIの公開ドキュメントにCommunity Marketの一覧取得APIは掲載されていません。従って、アプリ内の`STEAM_MARKET_COLLECTION_ALLOWED=true`はValveからの許可を示すものではなく、今回は新たなSteam通信をしません。許可済みのデータ源が確保されるまで市場Actionsは手動fixture検証に限定します。規約は[Steam Subscriber Agreement](https://store.steampowered.com/agreement/?l=english)、API一覧は[Steam Web API Documentation](https://steamcommunity.com/dev)を参照してください。

`.github/workflows/market-refresh.yml`は`workflow_dispatch`のみ。既定の`fixture`はSteamへアクセスせず、`npm run market:validate`とビルドを実行する。`live`はfixture job成功後に実行され、リポジトリ変数`STEAM_MARKET_COLLECTION_ALLOWED=true`がなければ失敗する。スケジュールは未設定。

`.github/workflows/fx-rate-refresh.yml`はSteam収集と独立し、`workflow_dispatch`と毎日18:17 UTCのscheduleでFrankfurter USD/JPY APIだけを取得する。同じ公表日・レートならJSONを書き換えず、週末の同じbusiness-day値でCloudflare Pagesを再ビルドしない。Frankfurter未更新は、最大4日以内の有効なbusiness-day観測なら成功として既存ファイルを保持する。両workflowは同じ`market-data-refresh` concurrency groupで直列化し、Push前に`main`へrebaseする。競合解消不能時はPushを失敗扱いにする。

為替jobは依存関係インストールやビルドをせず、Nodeの組み込み機能で取得・検証する。Actions実行を1日1回に抑え、値または公表日が変わった場合のみコミットするため、PagesのGit連携ビルドもレート更新時に限られる。週末の重複レートではコミットもPagesビルドも発生しない。

為替だけのローカル更新は`npm run fx:refresh`、キャッシュのSteam通信なし検証は`npm run fx:validate`。

ローカルの運用コマンドと本番反映手順は[本番稼働手順](launch-runbook.md)を参照。

## USD市場データの更新

許可確認後に`live` jobを手動実行すると、`search/render/`からUSDのみ取得します。JPYのSteamリクエスト、Frankfurterの成功、既存`market-jpy.json`のいずれにも依存しません。USD市場JSON、USD履歴、ランキングJSONを検証し、同一のPushに含めます。失敗・不完全なページ・403・429ではすべての既存データを保持し、制限回避や再試行はしません。

為替レートが不在・期限切れの場合、USD市場表示と履歴は通常どおり使えます。JPYを選んだ場合だけ価格を「更新待ち」とし、古い換算価格を現在値として使いません。

## 実通信を有効にする前の条件

1. Steam Community Marketの自動取得および価格・画像の再配布について必要な許可を確認する。
2. AppID 5084200に実際の出品が現れた時点で、USD指定の応答を少量で手動検証する。今回の更新経路ではSteamにJPYを要求しない。USD価格の通貨表記と数値単位はfixture・公開レスポンスの根拠から検証する。
3. 403、429、CAPTCHAの発生時には停止する現在の方針を維持する。アクセス制限の回避はしない。
4. 許可と通貨の検証記録を残してからリポジトリ変数を設定し、`live`を手動で一度実行する。生成JSONと本番表示を確認する。

許可が確認できた後の想定市場更新間隔は2時間程度から評価しますが、今回のActionsは手動実行のみです。為替レートは独立した1日1回更新です。Steamの負荷と制限、Actionsの実行結果、Pagesのデプロイ状況を確認してから定期市場スケジュールを別途判断します。実行失敗時は既存の正常JSONを維持し、Pushしません。変更がある正常JSONのみGitHub Actionsがコミットし、Cloudflare PagesのGit連携が自動デプロイします。

取得時刻はUSD JSONと履歴点の`fetchedAt` / `observedAt`として成功時刻を保持します。価格・出品数が不変でも正確な取得時刻を省略しません。Actionsは市場JSON・履歴・ランキングを一緒に検証した後にコミットし、Git Push失敗はジョブ失敗として扱います。

## 429保護とリクエスト予算

初期値は1リクエスト開始ごとの間隔15秒、1実行6件、UTC日次24件。最小間隔は設定変更でも15秒より短くできません。設定は`STEAM_MIN_INTERVAL_MS`、`STEAM_MAX_REQUESTS_PER_RUN`、`STEAM_MAX_REQUESTS_PER_DAY`で調整します。これらは運用上の保守的な予算で、Steamが保証する安全値ではありません。

`.market/steam-collection-state.json`はリクエスト試行数と最終開始日時、403/429/非JSON/HTTPエラー/不正レスポンスによる停止状態を持ちます。HTTP 429では再試行・待機・別URLへの切替を行いません。Actionsは失敗後も状態だけを`[CF-Pages-Skip]`付きコミットで保存し、次の実行も停止させます。状態を確認し、待機後に人が判断して`npm run market:unblock`を実行してください。解除してもその日の残りリクエスト数は戻しません。

商品一覧は`count=100`を要求しますが、応答の`pagesize`と実返却行から全件必要数を推計します。上限超過、`total_count`変動、`start`不一致、ページ不足、重複、通貨/AppID不一致では収集を破棄し、正常な市場JSONと履歴を保持します。部分ページを既知商品一覧や価格履歴として公開しません。

TBH限定のローカル試験は`npm run market:probe -- --target=tbh`。実通信は明示的な`--live`を付けた時だけ行い、1回1リクエストで停止します。AppID `3678970`の試験値や本文はAppID `5084200`の本番キャッシュに書き込まれません。実測結果、掲載ページSSRとの比較、通信予算および保存量は[tbh-collection-probe.md](tbh-collection-probe.md)に記録します。

### queryActionの隔離試験・分割観測

`npm run market:query-action -- --target=tbh`は保存fixtureのみを解析しSteam通信もJSON書き込みもしません。実通信は`--live`に加え、`STEAM_MARKET_COLLECTION_ALLOWED=true`、明示した`--request-currency-id=1|8`、最大6ページの指定が必要です。最初の運用では1ページを指定してください。queryActionと旧`search/render`は共有`.market/steam-collection-state.json`の15秒間隔・最大6件/実行・日次24件予算を使います。日次予算はUTC日付が変われば通常の新しい日次枠になります。403/429はAppIDを問わず保存された全体停止となり、自動再試行しません。

AppID別の途中観測は`.market/query-action-observations-<appid>.json`に商品単位で保存されます。1ページの成功後すぐ保存し、次回は`partial`のoffsetから続行します。HTTP失敗は保存済み観測を残します。実験用`market:query-action`の価格順では、total_count変化または商品重複は`restart-required`となり、確認後にローカルの明示`--restart`で新しいrunを開始します。件数到達も完全スナップショットを意味せず、状態は`count-reached-unverified`、`catalogComplete=false`のままです。収集ストアは`public/`配下ではなく、既存USD履歴にも接続されません。

公開候補の`npm run market:source`は、TBC実測でページ境界が安定した名前順（sort=1、direction=1）を使用します。名前順で総数だけ変わった場合は部分観測として続行し、重複した場合はその実行を停止、次回実行で保存済み商品を保ったまま新しい巡回を一度だけ開始します。手動実験用`market:query-action`の既定の価格順と区別してください。商品ごとのqueryAction観測は直近32点、公開側の取込記録は直近512件に制限します。継続自動取得・公開は利用条件の確認と運用ゲートの設定が済むまで無効です。

Pages上のfixture表示テストは[queryAction表示テスト](https://task-bar-cube-market.pages.dev/query-action-demo.html)。保存済みTBHレスポンスfixtureのみを使用し、画面・JSONともTask Bar Hero AppID 3678970と「テスト表示・価格基準検証中」を明示します。取得日時・request通貨対応・価格の手数料基準は未確認です。検索と表示額/出品数の並び替え、画像、Steamリンクだけを独立に試せます。このページはrobots metaと`X-Robots-Tag`でnoindexとなり、トップページ・sitemap・TBC商品/履歴/ランキングには含めません。`npm run build`がfixtureとJSONを再検証・生成します。

GitHub Actionsにはmanual-onlyの`query-action` modeがあります。運用フラグが設定されていてもユーザーがworkflow_dispatchで選ぶまで実行されません。成功・失敗とも予算と観測ストアだけを`[CF-Pages-Skip]`コミットで保存します。別の`market-feed.yml`は6時間ごとに起動しますが、Steamの権利参照と運用ゲートがない現在は取得ジョブを実行しません。`publish-query-action` modeはSteamへアクセスせず、既存の`.market/query-action-observations-5084200.json`を検証して、商品別観測日時を保った参考観測としてPages公開まで行います。公開権限の手動確認が必要で、その入力もValveの許可を意味しません。`strMinSellSubtotal`は引き続き数値価格・既存履歴から隔離します。新APIの価格基準、過去のTBH通貨不一致の由来、価格順ページ移動時の完全性は未確認のため、既存の検証済み価格履歴へ接続しません。TBCの名前順実レスポンスは[実測記録](tbc-query-action-live-validation.md)を参照してください。

GitHub Actionsの市場更新に30分scheduleはありません。今回のTBH市場で`count=100`に対して実応答ページサイズ10を観測し、全件に約110 requestsと見積もられました。現状の6件/実行制限と完全スナップショット要件では収集を完了できず、途中データは公開しません。複数実行に分割する場合は商品別`observedAt`を持ち、異なる時刻を同時点の完全市場として扱わない別設計が必要です。

## TBC公開JSONの正規取込

CLIはSteamへ通信しません。生のSteam JSON、DevTools HAR、複数ページJSON、または検証済みTBC queryAction観測ストアを入力できます。ディレクトリ指定では直下の`.json`を名前順に処理します。形式・AppID 5084200・商品キー重複・価格と表示文字列・出品数・画像URL・Steam URL・観測日時を検証します。HARではTBCの`search/render`と`q=Search`の`actions`だけを選び、AppID・ページ位置・通貨をrequest/response間で照合します。別AppID、別action、無関係なAPI応答は無視し、対象通信の不正JSONは拒否します。HARの観測時刻は`startedDateTime`を使用します。Cookieや認証ヘッダーは公開出力へコピーしません。生JSONに日時がない場合、操作者が信頼できる実観測時刻を指定する必要があり、現在時刻やファイル時刻は補いません。

`format: "steam-market-dom"`のJSONも入力できます。DOMから得た表示価格は`priceMinor: null`の参考値にとどめ、売り手受取額・手数料・購入者支払額のいずれかだと断定しません。取得できた商品数とページ開始位置、表示上の総件数を保存し、全件フラグは常にfalseです。CLIの既定はdry-runです。

```sh
# まずdry-run（ファイル変更なし）
npm run market:import -- --input <file-or-directory> [--observed-at <UTC ISO timestamp>] [--provenance <source>]

# 検証からコミット・Push・Pages反映確認まで
npm run market:publish -- --input <file-or-directory> [--observed-at <UTC ISO timestamp>] --provenance <source> --publish --rights-confirmed
```

`market:publish`は実行前にTBCの入力を一時JSONへ検証・統合し、既存キャッシュも検証します。公開モードはcleanな`main`が`origin/main`と一致する場合だけ、market/fx検証とビルドに成功してから公開JSONを更新します。JSON差分がなければコミット・Push・Pagesビルドを省略します。差分がある場合は対象ファイルだけをコミット・Pushし、公開JSONに新しい観測が届くまでCloudflare Pagesを確認します。失敗時はビルド前に既存JSONを保護します。Push成功後のデプロイ失敗はジョブ失敗として報告され、コミットを成功扱いにしません。

`.market/query-action-observations-5084200.json`を直接`--input`に渡すと、検証済みのTBC商品観測を商品別時刻付きの部分観測として公開JSONへ変換します。queryActionのsubtotalは参考表示のまま、数値価格・確定履歴へ昇格しません。GitHub Actionsから公開する場合は`publish-query-action` modeを明示選択し、`publish_query_action_rights_confirmed=true`を入力します。この同意は運用者の記録でありValveの権利許諾ではありません。

`--rights-confirmed`は操作者の確認記録で、Valveの許可を意味しません。許諾未確認の方法で取得・再配布したデータは公開しないでください。対象AppIDは固定で5084200、TBH fixtureは拒否されます。新規商品・新しい観測点だけを統合し、同一観測の再投入は冪等です。商品ごとの最新観測日時が正規市場スナップショットより新しい時だけ、一覧表示を取込観測へ切り替えます。価格基準未確認のqueryAction subtotalは数値価格や価格履歴に昇格しません。部分取得はページ単位で記録し、取得範囲外の商品を削除したり0価格・0出品にしたりしません。

適正に取得・提供されたTBCのSteam Market JSON（`search/render`またはqueryAction）を1ファイル、HAR、またはページJSON一式として使用できます。生JSONに観測日時がなければ実際の取得時刻を添えてください。まずdry-runで件数・AppID・観測日時・出典を確認し、利用・公開権限を確認した後に`market:publish`を実行します。TBC実観測は隔離環境で131件取得済みですが、継続取得・再配布の条件が未確認のため本番商品一覧は0件のままです。TBH fixtureや合成データを本番に投入しません。
