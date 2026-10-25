# 市場データ更新の運用条件

## 現在

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

GitHub Actionsの市場更新に30分scheduleはありません。今回のTBH市場で`count=100`に対して実応答ページサイズ10を観測し、全件に約110 requestsと見積もられました。現状の6件/実行制限と完全スナップショット要件では収集を完了できず、途中データは公開しません。複数実行に分割する場合は商品別`observedAt`を持ち、異なる時刻を同時点の完全市場として扱わない別設計が必要です。
