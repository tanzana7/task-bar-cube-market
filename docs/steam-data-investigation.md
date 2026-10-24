# Steam Community Marketデータ調査

確認日: 2026-10-25

手動で`https://steamcommunity.com/market/search/render/?appid=5084200&norender=1&count=10&start=0`を確認した。HTTP 200、`success: true`、`pagesize: 10`、`total_count: 0`、`results: []`だった。さらに`currency=8&country=JP`および`currency=1&country=US`を指定しても、どちらもHTTP 200、0件だった。現時点で対象AppIDの実価格・画像・識別子、および検索エンドポイントが通貨指定を反映するかは検証できない。0件の応答をJPY / USDの価格取得成功とは扱わない。

[Steamworksの通貨一覧](https://partner.steamgames.com/doc/store/pricing/currencies?l=english&language=english)ではJPY=8、USD=1を確認できる。ただし、これは検索エンドポイントの通貨指定が機能することの証拠ではない。実際に商品が返ったときは、要求した通貨と`sell_price_text`の表記が一致しなければ取得を停止する。`sell_price`の単位は実データで未検証のため、表示にはSteamの文字列を使い、整数は同一通貨内の順序比較にだけ使う。

採用候補は一覧検索`/market/search/render/`。個別`/market/priceoverview/`は必要項目が一覧で得られない場合だけ検討する。文書化されたSteam Web APIの市場一覧取得経路は確認できなかった。

[Steam Subscriber Agreement](https://store.steampowered.com/agreement/?l=english)は自動化やコンテンツの利用・再配布に制限を置いている。今回の収集方式について明示的な許諾は確認できていない。定期自動取得は有効にせず、手動実行可能な独立スクリプトとして準備した。403、429、CAPTCHAでは回避せず停止する。更新失敗時は前回のJSONを保持する。

GitHub Actionsにfixture専用の手動検証経路を設けた。Steamへの実通信は、別途許諾確認とリポジトリ変数による明示的な有効化を必要とする。定期スケジュールは設けていない。
