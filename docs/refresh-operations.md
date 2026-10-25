# 市場データ更新の運用条件

## 現在

`.github/workflows/market-refresh.yml`は`workflow_dispatch`のみ。既定の`fixture`はSteamへアクセスせず、`npm run market:validate`とビルドを実行する。`live`はfixture job成功後に実行され、リポジトリ変数`STEAM_MARKET_COLLECTION_ALLOWED=true`がなければ失敗する。スケジュールは未設定。

`.github/workflows/fx-rate-refresh.yml`はSteam収集と独立し、`workflow_dispatch`と毎日18:17 UTCのscheduleでFrankfurter USD/JPY APIだけを取得する。同じ公表日・レートならJSONを書き換えず、週末の同じbusiness-day値でCloudflare Pagesを再ビルドしない。Frankfurter未更新は、最大4日以内の有効なbusiness-day観測なら成功として既存ファイルを保持する。両workflowは同じ`market-data-refresh` concurrency groupで直列化し、Push前に`main`へrebaseする。競合解消不能時はPushを失敗扱いにする。

為替jobは依存関係インストールやビルドをせず、Nodeの組み込み機能で取得・検証する。Actions実行を1日1回に抑え、値または公表日が変わった場合のみコミットするため、PagesのGit連携ビルドもレート更新時に限られる。週末の重複レートではコミットもPagesビルドも発生しない。

為替だけのローカル更新は`npm run fx:refresh`、キャッシュのSteam通信なし検証は`npm run fx:validate`。

ローカルの運用コマンドと本番反映手順は[本番稼働手順](launch-runbook.md)を参照。

## 実通信を有効にする前の条件

1. Steam Community Marketの自動取得および価格・画像の再配布について必要な許可を確認する。
2. AppID 5084200に実際の出品が現れた時点で、JPY・USD指定の応答を手動で検証する。JPYが検証済みUSDを返す場合は、Frankfurterの新しいレートを使う参考換算へ移る。未知のJPY表記や数値単位は推測で受け付けない。
3. 403、429、CAPTCHAの発生時には停止する現在の方針を維持する。アクセス制限の回避はしない。
4. 許可と通貨の検証記録を残してからリポジトリ変数を設定し、`live`を手動で一度実行する。生成JSONと本番表示を確認する。

許可が確認できた後の想定更新間隔は2時間程度から評価する。為替レートは換算が必要な取得実行につき1回だけ問い合わせ、公表日が4日を超えたレートは使わない。Steamの負荷と制限、Actionsの実行結果、Pagesのデプロイ状況を見て決定し、最後に`schedule`を追加する。実行失敗時は既存の正常JSONを維持し、Pushしない。変更がある正常JSONのみGitHub Actionsがコミットし、Cloudflare PagesのGit連携が自動デプロイする。

取得時刻はJSONの`fetchedAt`として毎回の成功時刻を保持する。価格・出品数が不変でも時刻だけを省くと古い取得を新しいものと誤認するため、成功したライブ取得は時刻の変更だけでもコミット対象とする。不要なデプロイは更新間隔を抑えて管理する。ワークフローは同時実行を直列化し、ライブ実行は両通貨の収集・JSON検証が終わってからコミットする。片方が失敗した場合やPushが失敗した場合、ジョブを失敗として扱う。
