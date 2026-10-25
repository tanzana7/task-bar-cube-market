# Task Bar Cube Market 本番稼働手順

この手順は発売後、Task Bar Cube（AppID `5084200`）のSteam Community Marketに商品が現れたときに使う。Steamの自動取得・再配布に関する許可判断は未完了なので、権利者の条件を確認してから実通信・公開データ更新を行う。自動スケジュールは追加しない。

## 1. Steam Marketの商品出現を確認

まずfixtureだけの確認を行う。Steamへ接続しない。

```powershell
npm ci
npm run market:check
```

実際の市場を確認する場合は先頭ページ1回だけ読む。結果は標準出力に件数・HTTP状態・通貨検証結果だけを出し、JSONキャッシュへ書かない。

```powershell
npm run market:check -- --live
```

HTTP 403・429、CAPTCHAらしい応答、非JSON応答では停止する。再実行やアクセス制限回避をしない。先頭ページで商品が確認できなければ後続の更新へ進まない。

## 2. 最初の実レスポンスを確認

`market:check -- --live`はUSD指定の1ページのみ確認する。購入者ウォレット通貨やSteamのセッション条件によって要求通貨と応答通貨が異なる可能性がある。レスポンスがUSDで通貨・数値整合性を通過した場合だけ更新処理を検討する。認証Cookieを付けない。JPY通貨不一致ならUSDからの参考換算となり、SteamのJPY実価格ではない。

`priceoverview`は前回HTTP 429だったため、許可確認なしに追加照会しない。

## 3. JPY/USDと為替換算を確認

更新後は次の2ファイルを確認する。

```powershell
Get-Content public/market-usd.json
Get-Content public/market-jpy.json
```

USD側はSteamの取得値を保持する。JPY側は`priceSource`が`steam`なら直接価格、`fx`ならFrankfurter日次レートによる「参考価格・為替換算」。`fxRate.rateDate`はレート公表日、`fxRate.fetchedAt`は取得時刻。為替取得失敗や4日より古いレートでは更新に失敗し、従来の両キャッシュを保持する。

## 4. GitHub Actionsの設定を確認

`.github/workflows/market-refresh.yml`は`workflow_dispatch`のみで、定期スケジュールはない。`fixture`検証はSteamへ接続せず、その成功後にのみ`live` jobが進む。`live`にはリポジトリ変数`STEAM_MARKET_COLLECTION_ALLOWED=true`が必要。

Steamの取得・価格表示・画像再配布の条件を確認し、許可を判断した管理者だけがGitHubのRepository variablesにこの値を設定する。条件を確認できない場合は未設定のままにする。

## 5. 実データを更新

### GitHub Actions

GitHubのActionsで`Validate and refresh market snapshots`を選び、`workflow_dispatch`を実行する。利用条件の確認後に限って`mode=live`を選ぶ。Actionsは両通貨の収集・検証が完了してからJSONを保存し、正常な変更だけをコミット・Pushする。失敗したジョブは成功扱いにならず、変更をPushしない。

### ローカル

Actionsではなくローカルから更新する場合も、明示的な許可判断と既存環境変数のゲートが必要。次のコマンドはJSONを更新するが、Gitへコミット・Pushしない。

```powershell
$env:STEAM_MARKET_COLLECTION_ALLOWED = 'true'
npm run market:refresh
Remove-Item Env:STEAM_MARKET_COLLECTION_ALLOWED
```

コマンドが失敗した場合は、環境変数を解除し、ログの短いエラー理由を記録して停止する。Steam 403・429後に繰り返し実行しない。

## 6. JSONを検証

```powershell
npm run market:validate
```

このコマンドはSteamへ接続しない。現在の両JSON、AppID、通貨・価格、換算レート、商品識別子、重複、複数ページ、失敗時のキャッシュ保持などを検証する。

ローカル更新の場合は差分を確認し、JSON以外に意図しない変更がないことを見てから反映する。

```powershell
git diff -- public/market-jpy.json public/market-usd.json
git status --short
```

## 7. GitHubへ反映

Actionsの`live`経路では検証後にActionsがコミット・Pushする。ローカル経路なら内容を確認し、明示的にコミット・Pushする。

```powershell
git add public/market-jpy.json public/market-usd.json
git commit -m "Update verified Steam market snapshots"
git push origin main
```

Push失敗は成功扱いしない。競合を解決してから再検証する。

## 8. Cloudflare Pagesデプロイ

Cloudflare Pagesの`task-bar-cube-market`で新しいProduction deploymentを確認する。対象コミットが`main`由来で、Statusが`success`になったことを確認する。Git連携がデプロイを行うため、Actions側に別のPages deploy処理は追加しない。

## 9. PC・スマートフォンで確認

本番URL `https://task-bar-cube-market.pages.dev/` を開き、1280pxと390pxで確認する。

- 商品名、画像、出品数、Steamリンク
- JPY/USD切り替えとlocalStorage保存
- USD価格と、JPYが換算の場合の「参考価格・為替換算」表示
- 為替期限切れ時も商品情報とリンクが残り、換算価格が「参考円価格は更新待ち」になること
- 検索・価格順・名前順
- 更新時刻、GA4不在、Cloudflare Web Analytics
- JavaScriptエラー、Google所有権確認タグ、canonical、robots.txt、sitemap.xml

## 10. 403・429時の停止判断

403・429・CAPTCHAでは即時停止する。再試行、ログインCookieの利用、VPN・プロキシによる回避を行わない。GitHubの許可変数や既存キャッシュを変更せず、Steam利用条件・アクセス制限の状況を確認できるまで待つ。古いJSONは元の取得時刻を保持し、取得に成功したように扱わない。

## 11. ロールバック

誤ったデータ更新コミットを特定し、`git revert`で打ち消すコミットを作成してPushする。Cloudflare PagesでrevertコミットのProduction deployment成功を確認する。`reset --hard`や履歴の強制Pushは使わない。

```powershell
git revert <誤った更新コミットID>
git push origin main
```
