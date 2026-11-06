# World Hub

世界のニュース・論文・百科事典を1つの画面でまとめて検索できるサイトです。

## 起動方法

```
node server.js
```

ブラウザで http://localhost:3000 を開きます（Node.js 18以上。追加インストール不要）。

## 情報源

| 種類 | 情報源 |
|---|---|
| ニュース | Google ニュース（地域切替可）、NHK・BBC・Guardian・NYT・Al Jazeera・DW・France 24 のRSS、GDELT、Hacker News |
| 論文 | OpenAlex、arXiv、PubMed |
| 百科事典 | Wikipedia（日本語・英語） |

日本語で検索すると、英語の情報源には自動で英訳したキーワードで検索します。

## 信頼度ランク（A/B/C）

- ニュース・百科事典: 配信元サイトの世界アクセス数順位（[Tranco](https://tranco-list.eu/) 上位10万サイト、`data/tranco-top100k.txt`）
  - A = 5,000位以内 / B = 5万位以内 / C = それ以下・圏外
- 論文: 被引用数（OpenAlex）
  - A = 100回以上 / B = 10回以上 / C = 10回未満・未査読プレプリント（arXiv）

基準値は `lib/rank.js` の先頭で変更できます。アクセス数・引用数は人気の目安であり、内容の正しさを保証するものではありません。
ランキングを最新にするには https://tranco-list.eu/top-1m.csv.zip の上位10万行のドメイン列で `data/tranco-top100k.txt` を置き換えてください。

## 注意

- 翻訳は Google翻訳の公開エンドポイント（失敗時は MyMemory）を使っており、短時間に大量に使うと一時的に制限されます。
- OpenAlex・GDELT はAPIキーなしの無料枠で利用しているため、混雑時はエラーになることがあります。
