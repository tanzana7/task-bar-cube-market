# JPY / USD取得方式の調査（2026-10-25）

## 結論と確度

USDはTBHの実レスポンスで`search/render`から取得できた。JPYの**Steam実価格**は未取得であり、直接取得が不可能と証明したわけではない。未ログインの`search/render`に`currency=8&country=JP`を付けてもUSD表示となった。Steamの[Community Market FAQ](https://help.steampowered.com/en/faqs/view/61F0-72B7-9A18-C70B)は、購入者にはウォレット通貨で価格が表示され、正しい通貨を見るにはサインインが必要と説明する。この条件との整合性はあるが、`currency`・`country`・Cookieの個別の優先順位は公開仕様から確定できない。認証やCookieを使う追加検証は行わない。

## 最小限の実通信

対象は検証専用TBH AppID `3678970`の`Contaminated Reliquary (Beyond)`。前回の1ページ検証は次のとおり。

| 取得先 | パラメータ | 観測結果 |
| --- | --- | --- |
| `https://steamcommunity.com/market/search/render/` | `appid=3678970&norender=1&count=10&start=0&currency=1&country=US` | HTTP 200、`sell_price=517`、`sell_price_text="$5.17"` |
| 同上 | `appid=3678970&norender=1&count=10&start=0&currency=8&country=JP` | HTTP 200、`sell_price=517`、`sell_price_text="$5.17 USD"`。JPYではない |
| `https://steamcommunity.com/market/priceoverview/` | `appid=3678970&currency=8&country=JP&market_hash_name=Contaminated%20Reliquary%20%28Beyond%29` | 今回HTTP 429。ここでSteamへのアクセスを停止した |

`priceoverview`のUSD応答もJPY応答も取得していない。そのため、個別照会ならJPYが返るという主張はできない。USDの`517`と`$5.17`は100分の1単位で一致。JPYの`sell_price`単位、表記、手数料込み・抜きの差、大きい価格の例、欠損の実挙動は未確認。既存テストのJPY表記はfixtureであり実レスポンスではない。前回確認したTBHの低価格例は`$0.04 USD`、上記の`$5.17`より高い価格帯は今回検証していない。

参考実装[filipefont/tbh-market-tool](https://github.com/filipefont/tbh-market-tool)は一覧を主にUSDで取得し、個別`priceoverview`を補助的に使う。[TBH Market](https://tbh-market.com/)の公開フロントエンドでは`/api/rate`から`usdjpy`を取得し、JPY選択時の価格フィルターをそのレートでUSDへ戻す処理を確認した。商品ごとの表示にもレートを渡す構成だが、全表示価格の算出規則までは断定しない。TBH Marketから市場価格は取得しない。

## 換算に採用した経路

[Frankfurter公式](https://frankfurter.dev/)の`https://api.frankfurter.dev/v2/rate/USD/JPY`を使用する。公開APIは無料・APIキー不要で、日次レートのキャッシュが許可されている。配合レートはFrankfurter自身の計算で商用利用可と明記され、濫用防止のレート制限がある。2026-10-25の最小確認ではHTTP 200、`{"date":"2026-10-25","base":"USD","quote":"JPY","rate":157.12}`だった。これはSteamのウォレット換算率ではなく、参考の為替レートである。

直接JPYの検索結果が通貨・数値の検証を通れば`priceSource="steam"`を優先する。検索がUSD等の通貨不一致であった場合のみ、完全に検証済みのUSDスナップショットと新規取得した有効な為替レートから`priceSource="fx"`のJPY参考価格を作る。USDセント額にレートを掛け、最も近い整数円に丸める。JPYの`priceMinor`は既存UIのソート単位に合わせて円額の100倍とし、`fxRate`に情報源URL、公表日、取得時刻を記録する。画面にも「参考価格・為替換算」と表示する。レートが不正・未来・公表日から4日超・取得失敗なら更新全体を中止し、両キャッシュを維持する。保存済みの換算価格も、公表日から4日超なら画面に表示しない。

## リクエスト数と運用

取得対象数を`N`、検索で実際に返るページサイズを`P`とすると、直接両通貨を取れる場合のSteam通信は概ね`2×ceil(N/P)`回。JPYが初ページで通貨不一致ならSteam通信はUSD全ページの`ceil(N/P)`回とJPY先頭1回、Frankfurterに1回。TBHでは`count=10`指定で`P=10`だったが、Cubeでの`P`は未確認。`priceoverview`で全商品を個別照会すると少なくとも商品数分のSteam通信が追加されるため、429発生後の現段階で本番方式には採用しない。

公開対象はAppID `5084200`のまま。Cubeに実商品が現れた後も、USDと直接JPYの検証、通貨不一致時だけの換算、両JSON同時保存、失敗時の既存キャッシュ維持を適用する。Actionsは手動実行のみで、自動収集・再配布の条件確認が済むまで定期実行を追加しない。JPY実価格を確認できた際には、その実表記・数値単位・手数料の関係を検証してfixtureを更新する。
