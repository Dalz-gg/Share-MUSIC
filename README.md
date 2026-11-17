# Share MUSIC

**人のおすすめで、新しい曲と出会う。** — 大好きな曲を「ここを聴いて」の一瞬といっしょにおすすめして、「刺さった」「わかる」「ありがとう」で共感し合うウェブアプリです。友だち・知り合いどうしで使うことを想定しています。

- 公開中のサイト：https://playlist-share.pages.dev
- 運営：Dalz（お問い合わせ：dalzgamesch@gmail.com）
- 方針と作業計画：[`docs/roadmap.md`](docs/roadmap.md)

## 考え方
「聴く」のは Spotify や YouTube Music がすでに得意なので、Share MUSIC は **出会う・おすすめする・共感する** に集中します。プレイリスト共有やリスニングパーティーなどの「聴く」機能は残していますが、脇役として「聴く」ページにまとめています。

## できること
- **ホーム（今日のおすすめ）**：一番上に「今週のお題」、その下にみんなの新しいおすすめが並ぶ。カードをタップすると「ここを聴いて」の瞬間から約20秒、歌詞といっしょに試聴
- **おすすめする（画面下のまんなか）**：好きな1曲を選び、いちばん聴いてほしい瞬間（刺さった一行）・場面タグ・ひとことを添えて投稿。指定がない曲はサビを自動で推定
- **刺さった／わかる／ありがとう**：おすすめ曲への3つのリアクション。「ありがとう」はおすすめした人に届く
- **布教の木**：曲が誰から誰へ届いたかを記録して、木の形で表示
- **今週のお題**（`/topic`）：毎週のお題に1人1曲で答える
- **コミュニティ**：つぶやき・ミックステープ・写真・曲バトル（投票）・返信・引用・リアクション
- **聴く**（`/#listen`）：みんなのプレイリスト、プレイリストの共有、リスニングパーティー、ミックステープ、ブックマーク
- フォロー・お知らせ・通報・運営ページ（`/admin`）、配色6種、ホーム画面に追加して使える（PWA）

## 画面の構成（メニュー）
| 場所 | 中身 |
|---|---|
| 画面下のタブ | ホーム（今日のおすすめ）／お題／**＋おすすめする**／コミュニティ／マイページ |
| 右上 | さがす・お知らせ・配色・メニュー（聴く・リスニングパーティー・ブックマーク・使い方・このアプリについて・プライバシーポリシー） |
| 使い方 | `/#help`（おすすめする→ここを聴いて→ありがとう→布教の木→お題 の流れを説明） |
| 静的ページ | `/about`（このアプリについて）・`/privacy`（プライバシーポリシー） |

以前の URL（`/bookmarks`・`/party`・`/share`・`/share/pl`・`/share/song`・`/#help` など）はそのまま使えます。

## フォルダの中身
| 場所 | 内容 |
|---|---|
| `public/` | 画面（HTML・CSS・JavaScript）。ビルド不要のそのままのファイル |
| `public/app.js` | 画面の中心（ページの切り替え・タブとメニュー・再生プレーヤー・プレイリスト・マイページ・使い方など）。新機能は先頭の `Hooks` を通してつながる |
| `public/discover.js` | 「ここを聴いて」の選び方・サビからの試聴・サビの自動推定 |
| `public/today.js` | ホーム「今日のおすすめ」・リアクション（刺さった／わかる／ありがとう）・ありがとう便 |
| `public/topics.js` | 今週のお題の画面（`/topic`） |
| `public/spread.js` | 布教の木（曲ページ・プロフィールでの広がりの表示） |
| `public/css/` | 上の4つの機能ごとの見た目（`discover.css`・`today.css`・`topics.css`・`spread.css`） |
| `public/community.js` / `posts.js` / `party.js` | おすすめ曲・いいね・コメント・運営ページ／コミュニティ／リスニングパーティー |
| `public/fx.js` / `media.js` | 見た目の部品（レコード・シェア画像・配色）／曲名の日本語化・MV・歌詞 |
| `public/about.html` / `privacy.html` | このアプリについて／プライバシーポリシー |
| `netlify/functions/` | サーバー側の処理（API）。Cloudflare 上で動きます（名前は以前の Netlify 時代のなごり） |
| `netlify/functions/reactions.mjs` | リアクション3種とありがとう便（`/api/song-react`・`/api/song-reacts`） |
| `netlify/functions/topics.mjs` | 今週のお題（`/api/topic`・`/api/topics`・`/api/topic-admin`） |
| `netlify/functions/spread.mjs` | 布教の記録（`/api/spread`、ほかの処理から呼ぶ `recordSpread`） |
| `netlify/functions/social.mjs` ほか | いいね・コメント・お知らせ・フォロー・通報（`social.mjs`）、おすすめ曲と運営（`community.mjs`）、つぶやき（`posts.mjs`）、パーティー（`party.mjs`）、ログイン（`auth.mjs`）など |
| `cf/` | Cloudflare Pages 用の組み立て（`build.sh`）と公開（`deploy.sh`） |
| `tools/` | 手元で試すための道具（`dev-server.mjs`：画面だけを動かすサーバー、`blobs-mock.mjs`：データ保存のまね） |
| `docs/` | 方針（`roadmap.md`）、Google の審査申請ガイドなど |

## 手元で画面を見る
```bash
node tools/dev-server.mjs 8775 public   # http://127.0.0.1:8775 で画面だけ動く（/api は動かない）
```

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
おすすめ・リアクション・お題の回答・布教の記録・コメント・つぶやき・パーティーなどの**利用者のデータは Cloudflare の中**に保存されていて、この GitHub には入っていません（入れてはいけない個人情報を含むため）。このリポジトリに保存しているのはプログラムだけです。扱いの詳細は `public/privacy.html`（プライバシーポリシー）をご覧ください。
