# TBH Market公開サイト調査

確認日: 2026-10-25

[tbh-market.com](https://tbh-market.com/)の公開ページを確認した。検索、価格比較、アイテム一覧が主な用途である。公開ページのHTMLを今回の環境では取得できず、Network、スマートフォン表示、読み込み・エラー表示、および内部データ取得経路は確認できなかった。下記のUI知見は別プロジェクトである[参考GitHubリポジトリ](https://github.com/filipefont/tbh-market-tool)の公開ソースに基づく。

参考リポジトリの`web/src/components/market/MarketSearch.svelte`は検索入力を状態ストアにつなぎ、`MercadoTable.svelte`は表とカード、ソートを備える。同リポジトリの公開サイトとtbh-market.comが同じ実装である証拠はない。

今回の画面は検索欄を上部に置き、価格・名前・画像・出品数とSteamリンクを一つの行にまとめた。スマートフォンでは価格を商品名の下へ移す。参考サイトのHTML、CSS、画像は複製していない。
