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
