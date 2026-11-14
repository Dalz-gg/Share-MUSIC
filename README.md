# Share MUSIC

**あなたの好きが、誰かの1曲に。** — YouTube Music のプレイリストやおすすめの曲を共有して、みんなで聴いて、いいね・コメントし合えるウェブアプリです。

- 公開中のサイト：https://playlist-share.pages.dev
- 運営：Dalz

## できること
- **みんなのプレイリスト**：YouTube Music のプレイリストに紹介文・ジャンル・カバーを付けて共有。曲目を見てその場で試聴、コピーも可能
- **おすすめ曲**：好きな1曲を投稿（CD音源で再生・MV切り替え・歌詞）。「私もおすすめ」で何人でも参加
- **コミュニティ**：つぶやき・ミックステープ・写真・曲バトル（投票）・返信・引用・リアクション
- **リスニングパーティー**：同じ曲をみんなで同時に聴きながらチャット
- いいね・コメント・ブックマーク・フォロー・お知らせ・通報・運営ページ（/admin）
- ダークテーマ＋配色6種、ホーム画面に追加して使える（PWA）

## フォルダの中身
| 場所 | 内容 |
|---|---|
| `public/` | 画面（HTML・CSS・JavaScript）。ビルド不要のそのままのファイル |
| `public/app.js` | 画面の中心（ページの切り替え・再生プレーヤー・プレイリスト・マイページなど） |
| `public/community.js` / `posts.js` / `party.js` | おすすめ曲・いいね・コメント・運営ページ／コミュニティ／リスニングパーティー |
| `public/fx.js` / `media.js` | 見た目の部品（レコード・シェア画像・配色）／曲名の日本語化・MV・歌詞 |
| `netlify/functions/` | サーバー側の処理（API）。Cloudflare 上で動きます（名前は以前の Netlify 時代のなごり） |
| `cf/` | Cloudflare Pages 用の組み立て（`build.sh`）と公開（`deploy.sh`） |
| `docs/` | Google の審査申請ガイドなど |

## 公開（デプロイ）のしかた
```bash
npm install          # 初回だけ（組み立てに使う esbuild を入れる）
npm run deploy       # 組み立てて Cloudflare Pages に公開
```
- 公開には Cloudflare の API トークンが必要です（環境変数 `CLOUDFLARE_API_TOKEN`。Claude のクラウド環境では自動で付与されます）。
- `npm run build` だけなら公開せずに `dist-cf/_worker.js` を作ります。

## サーバー側の設定（Cloudflare の管理画面で設定済み・コードには入っていません）
- 環境変数：`GOOGLE_CLIENT_SECRET`（Google ログイン用の秘密の鍵）、`ADMIN_PASSWORD`（運営ページのパスワード）
- データベース：D1 `playlist-share`（バインディング名 `DB`）、画像の保存：KV（バインディング名 `COVERS`）

## 利用者のデータについて
共有・いいね・コメント・つぶやき・パーティーなどの**利用者のデータは Cloudflare の中**に保存されていて、この GitHub には入っていません（入れてはいけない個人情報を含むため）。このリポジトリに保存しているのはプログラムだけです。
