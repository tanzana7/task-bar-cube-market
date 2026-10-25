# Steam Community Marketデータ調査

確認日: 2026-10-25

初回の手動API確認では`https://steamcommunity.com/market/search/render/?appid=5084200&norender=1&count=10&start=0`がHTTP 200、`total_count: 0`だった。これはその時点のAPI応答であり、現在も市場が空である根拠にはしない。

[Steamworksの通貨一覧](https://partner.steamgames.com/doc/store/pricing/currencies?l=english&language=english)ではJPY=8、USD=1を確認できる。ただし、これは検索エンドポイントの通貨指定が機能することの証拠ではない。実際に商品が返ったときは、要求した通貨と`sell_price_text`の表記が一致しなければ取得を停止する。`sell_price`の単位は実データで未検証のため、表示にはSteamの文字列を使い、整数は同一通貨内の順序比較にだけ使う。

v0.2.1では[Steamworksの対応通貨資料](https://partner.steamgames.com/doc/store/pricing/currencies?l=english&language=english)にある「JPYは銭、USDはセント」を基準に、検索結果の整数値と表示価格が100分の1単位で一致する場合だけ採用する。これは文書化された市場検索レスポンスの仕様ではない。JPYは`¥`・`￥`、USDは`$`・`US$`を認識し、空白、ノーブレークスペース、正しい3桁区切りを許す。異なる通貨記号、端数のある円、不正な桁区切り、整数値との不一致は拒否する。実商品が出た際にこの検証が失敗したら、推測で緩めず実レスポンスを確認する。

ページ送りは初回の実返却件数を幅として使い、後続の件数、任意の`start`・`pagesize`、一定の`total_count`を照合する。重複商品は商品欠落の兆候として収集全体を失敗させる。取得中の件数変動・途中通信失敗・403/429・JSON欠損ではキャッシュを更新しない。現状は0件であり、再試行による負荷は追加しない。

採用候補は一覧検索`/market/search/render/`。個別`/market/priceoverview/`は必要項目が一覧で得られない場合だけ検討する。文書化されたSteam Web APIの市場一覧取得経路は確認できなかった。

[Steam Subscriber Agreement](https://store.steampowered.com/agreement/?l=english)は自動化やコンテンツの利用・再配布に制限を置いている。今回の収集方式について明示的な許諾は確認できていない。定期自動取得は有効にせず、手動実行可能な独立スクリプトとして準備した。403、429、CAPTCHAでは回避せず停止する。更新失敗時は前回のJSONを保持する。

GitHub Actionsにfixture専用の手動検証経路を設けた。Steamへの実通信は、別途許諾確認とリポジトリ変数による明示的な有効化を必要とする。定期スケジュールは設けていない。

## DOM観測データと公開条件

2026-10-25 10:56:31 UTCに保存されたユーザー提供のDOM観測ファイル`.market/tbc-dom-observation-2026-10-25T10-56-31Z.json`には、AppID 5084200の一意な商品56件、表示総数73件、USD表示の下限価格、出品数、商品名、Marketリンク、画像URLがある。これはページ全体の取得ではなく56/73件の部分観測で、各価格は`$…～`の画面参考値であり、APIで検証した確定価格・履歴データではない。

確認したSteamの公開文書は次の範囲を示すが、今回のMarket画面DOMを第三者サイトへ再掲する許可までは示していない。

- [Steam Web API Documentation](https://steamcommunity.com/dev)は、掲載された公式Web APIについて説明し、現行一覧にTask Bar Cube Marketの検索価格エンドポイントは見当たらない。
- [Steam Web API Terms of Use](https://steamcommunity.com/dev/apiterms)のデータ配布ライセンスは、Steam Web APIおよびその文書に沿う利用を対象とする。非公式MarketページのDOMキャプチャを同じライセンス対象とみなす根拠にはならない。
- [Steam Subscriber Agreement](https://store.steampowered.com/subscriber_agreement/?l=japanese)は、コンテンツやサービスの複製・公開・配布に制限を置き、Steamとの自動化されたやり取りにも規定を置く。

従って、現在わかっている事実は、ユーザーが見たページ上の公開表示をローカルで構造化し、部分観測として検証できたことまで。取得時の人間操作、公開サイトへのデータ再配布、Steam画像の再ホスト/表示、定期的な自動取得は別々の論点である。現資料ではこれらの用途を明示的に許す権利根拠を確認できていないため、本番商品JSONへは取り込まない。許可が必要ならValve（MarketデータとSteamサービス）、および必要に応じてゲームコンテンツの権利者から、対象フィールド（商品名、画面価格、出品数、画像）と公開先（TBCM）を含む書面の利用条件、ならびに自動取得の可否・頻度を確認する。権利条件を伴うデータ供給元から明示的なライセンス付きfeedを受ける方法も代替候補となる。

`market:publish`は入力のAppID・通貨・識別子・価格形式・観測時刻を検証し、前回観測へ統合して公開JSONを生成し、GitHubへ反映後にCloudflare Pagesの出力を確認する経路を持つ。これはコマンドを実行した後の検証・統合・公開（B/C）であり、新しいfeedを自動受信する機能ではない。Steamからの自動取得（A）は停止中であり、GitHub Actionsにも定期Steam取得は設定していない。`--rights-confirmed`は運用者の記録であって、Valveその他の権利者の許可ではない。
