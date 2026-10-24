# Steam Community Marketデータ調査

確認日: 2026-10-25

手動で`https://steamcommunity.com/market/search/render/?appid=5084200&norender=1&count=10&start=0`を一度確認した。HTTP 200、`success: true`、`pagesize: 10`、`total_count: 0`、`results: []`だった。現時点で対象AppIDの実価格・画像・識別子は検証できない。空の結果と通信失敗は区別する。

採用候補は一覧検索`/market/search/render/`。個別`/market/priceoverview/`は必要項目が一覧で得られない場合だけ検討する。文書化されたSteam Web APIの市場一覧取得経路は確認できなかった。

[Steam Subscriber Agreement](https://store.steampowered.com/agreement/?l=english)は自動化やコンテンツの利用・再配布に制限を置いている。今回の収集方式について明示的な許諾は確認できていない。定期自動取得は有効にせず、手動実行可能な独立スクリプトとして準備した。403、429、CAPTCHAでは回避せず停止する。更新失敗時は前回のJSONを保持する。

追加インフラなしのGitHub Actionsが将来の候補。Cloudflare Workersは別の実行・保存設定が必要になるため、静的JSONをPagesで配信する現段階では採用しない。利用許諾を得た後に更新頻度と運用条件を決める。
