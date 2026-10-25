# TBC実測観測の公開記録

## 公開内容と取得記録

2026-10-25にローカルへ保存された`.market/source-name-preview/source/query-action-observations.json`を検証した。AppIDは5084200、通貨はUSD、商品キーは131件すべて一意、保存された商品別観測は191点だった。取得開始位置は0、30、60、90、120で、各取得は部分観測として記録されている。総件数は取得途中に130/131と変化しており、完全な同時点スナップショットとは扱わない。最後の商品観測時刻は`2026-10-25T13:55:11.103Z`。

`strMinSellSubtotal`由来の数値は購入者の支払額・旧`search/render`の`sell_price`との同一性が確認できないため、参照表示のまま保存する。正規価格`priceMinor`、既存価格履歴、ランキングへは移さない。観測の権利確認欄は`rightsConfirmed: false`のままにする。

今回の公開指示に基づき、商品名、market hash name、Steam Market商品リンク、観測価格文字列、出品数、商品別観測日時を公開用観測ファイルに含める。Steamの商品画像URLは公開JSONから除外し、サイト内作成の`/market-item-placeholder.svg`を表示する。HAR、Cookie、セッション値は入力ファイルに含まれておらず、公開ファイルにも出力しない。

## 権利状態

この公開はサイト運営者の明示的な指示に基づく。ValveまたはTask Bar Cube開発元からデータ再配布・画像利用の許可を得たことを意味しない。Steamの現行[Subscriber Agreement](https://store.steampowered.com/agreement/?l=english)は、Section 2にSteamで提供されるコンテンツ/サービスとマーケットプレイスの仮想アイテムを含め、Section 2.Fに複製・公開・配布に関する制限を記載している。Steam Community Marketの`queryAction`は、公式の[Steam Web API一覧](https://steamcommunity.com/dev)に掲載されたAPIではない。従ってSteam Web API Termsをこのエンドポイントへの個別許可とみなさず、Steam側の再配布許諾が確認済みとも扱わない。

未解決の判断は、**過去にユーザーが取得した市場の事実項目（商品名・価格・出品数・観測時刻・Steamリンク）を、非公式ファンサイトで再掲できるか**である。これを確定するには、サイト運営者がValveへ書面で、対象AppID 5084200、対象項目、公開URL、取得経路、更新頻度、再配布期間を明示して確認するか、Task Bar Cubeの権利者からデータ供給・再掲の許諾を得る必要がある。画像の再掲は今回行わず、別途許可が確認できた場合にだけ画像を戻す。

この記録は法律上の適法性を認定するものではない。自動取得・定期アクセスは有効化せず、今後の更新には別途利用条件を確認したデータ供給元が必要である。

## 公開時の保護

- `--publish-factual-observations`はqueryAction観測に限定した、画像なしの明示的な公開経路。`--rights-confirmed`を付けることはできない。
- 公開キャプチャは`rightsConfirmed: false`を保持し、価格基準は`min-sell-subtotal-unverified-fees`の参考値で維持する。
- 商品ごとの観測時刻を表示し、24時間を超える観測は古いと表示する。今回のデータは部分観測として扱い、欠けた商品を価格0や出品0に変換しない。
- 通常の`--publish --rights-confirmed`経路は従来どおり変更しない。
