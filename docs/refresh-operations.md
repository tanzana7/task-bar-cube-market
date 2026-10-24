# 市場データ更新の運用条件

## 現在

`.github/workflows/market-refresh.yml`は`workflow_dispatch`のみ。既定の`fixture`はSteamへアクセスせず、複数ページ・通貨・欠損・429・キャッシュ保持のテストとビルドを実行する。`live`はリポジトリ変数`STEAM_MARKET_COLLECTION_ALLOWED=true`がなければ失敗する。スケジュールは未設定。

## 実通信を有効にする前の条件

1. Steam Community Marketの自動取得および価格・画像の再配布について必要な許可を確認する。
2. AppID 5084200に実際の出品が現れた時点で、JPY・USD指定の応答がそれぞれ要求通貨の価格を返すことを手動で検証する。検索エンドポイントが指定を無視する場合、個別取得など別方式を再検討する。
3. 403、429、CAPTCHAの発生時には停止する現在の方針を維持する。アクセス制限の回避はしない。
4. 許可と通貨の検証記録を残してからリポジトリ変数を設定し、`live`を手動で一度実行する。生成JSONと本番表示を確認する。

許可が確認できた後の想定更新間隔は2時間程度から評価する。Steamの負荷と制限、Actionsの実行結果、Pagesのデプロイ状況を見て決定し、最後に`schedule`を追加する。実行失敗時は既存の正常JSONを維持し、Pushしない。変更がある正常JSONのみGitHub Actionsがコミットし、Cloudflare PagesのGit連携が自動デプロイする。
