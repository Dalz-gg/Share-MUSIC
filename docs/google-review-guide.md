# Google の審査（アプリの確認）申請ガイド

審査に通ると、ログイン時の「このアプリは Google で確認されていません」という警告画面が出なくなります。
Share MUSIC が使っている権限は `https://www.googleapis.com/auth/youtube`（YouTube アカウントの管理）です。これは Google の分類で「機密性の高いスコープ」なので、**Google の審査担当者による確認**が必要です（有料のセキュリティ診断は不要です）。

- 審査期間の目安：**2〜6週間**（Google から英語のメールで追加の質問が来ることがあります）
- 審査中もアプリはこれまで通り使えます
- 注意：未確認のアプリは、ログインできる人が**累計100人まで**に制限されています

---

## 0. 先に決めること：お問い合わせ用のメールアドレス

プライバシーポリシーに**連絡先の記載が必須**です。ここに書いたアドレスは誰でも見られるので、普段使いの Gmail ではなく、**専用の Gmail（例：sharemusic.dalz@gmail.com など）を新しく作る**のがおすすめです。
作ったアドレスを教えてもらえれば、プライバシーポリシーに追加します。同じアドレスを下の「ユーザーサポートメール」にも使えます。

---

## 1. サイトの所有者であることを確認する（Google Search Console）

1. https://search.google.com/search-console を開き、Google アカウントでログイン
2. 「プロパティを追加」→ 右側の **「URL プレフィックス」** に `https://playlist-share.pages.dev/` を入力 →「続行」
3. 確認方法の一覧から **「HTML タグ」** を選ぶ
4. `<meta name="google-site-verification" content="……">` という1行が表示されるので、**この1行をそのまま私に送ってください**（秘密の情報ではありません）
5. 私がサイトに追加して公開したら、Search Console の **「確認」** ボタンを押す

> ※ playlist-share.pages.dev は独立したドメインとして確認できるはずです。もし確認できない場合は、独自ドメイン（年1,500円前後）を取る方法に切り替えます。

---

## 2. Google Auth Platform の設定を整える

https://console.cloud.google.com/ → 対象のプロジェクト → **Google Auth Platform**

### ブランディング
| 項目 | 入力する内容 |
|---|---|
| アプリ名 | `Share MUSIC` |
| ユーザーサポートメール | 0. で決めたアドレス（または今のアドレス） |
| アプリのロゴ | **空欄のまま**がおすすめ（ロゴを入れると別のブランド審査が追加され、時間がかかります） |
| アプリのホームページ | `https://playlist-share.pages.dev/` |
| プライバシーポリシーへのリンク | `https://playlist-share.pages.dev/privacy` |
| 利用規約へのリンク | 空欄でOK |
| 承認済みドメイン | `playlist-share.pages.dev` **だけ**にする（`netlify.app` が残っていたら削除。残っていると、そのドメインの所有確認も求められて審査が止まります） |
| デベロッパーの連絡先メール | 今のアドレスでOK（公開されません） |

### クライアント（OAuth クライアント ID）
- 「承認済みの JavaScript 生成元」：`https://playlist-share.pages.dev` を残し、**netlify.app のものは削除**
- 「承認済みのリダイレクト URI」：netlify.app のものがあれば削除

### データアクセス（スコープ）
- 登録されているスコープが **`.../auth/youtube` の1つだけ**であることを確認（他にあれば削除）

---

## 3. デモ動画を撮る（YouTube に「限定公開」でアップロード）

審査担当者は、**ログインの流れと、権限を実際に何に使っているか**を動画で確認します。パソコンの画面録画（Mac：⌘+Shift+5、Windows：Win+G）で、**アドレスバーが映る状態**で撮ってください。音声なし・2〜4分で十分です。

1. ブラウザで `https://playlist-share.pages.dev/` を開く（アドレスバーを映す）
2. ログインボタンを押す → Google のログイン画面へ
3. **同意画面でアプリ名「Share MUSIC」と権限の内容が見える状態で一度止める**。その画面のアドレスバーをクリックして、URL の中の `client_id=…` が見えるようにする（ここが一番大事です）
4. 許可してログイン完了
5. 画面下の「＋」→「プレイリストを共有する」→ 自分のプレイリスト一覧が読み込まれる様子
6. 1つ選んで、タイトルと紹介文を変えて共有 → 新しいタブで YouTube Music を開き、**タイトルと説明文が変わったこと**を見せる
7. 他の人のプレイリストを開き、「自分のアカウントにコピーを作る」でコピー → YouTube Music に**新しいプレイリストができたこと**を見せる
8. 最後に「Google アカウントの設定」から権限を取り消せることを見せる（任意）

録画したら YouTube に **「限定公開」** でアップロードし、その URL を控えておきます。

---

## 4. 審査を申請する

Google Auth Platform → **確認センター（Verification Center）** → 「確認の準備ができました／Prepare for verification」 から申請します。途中で聞かれる項目には、下の英文をそのまま貼り付けてください。

### スコープの使い方の説明（Scope justification）
```
Share MUSIC is a web app for sharing YouTube Music playlists and favourite songs with other users. It requests the https://www.googleapis.com/auth/youtube scope only after the user chooses to share, post or copy something, and uses it only for these user-initiated actions:
1) List the signed-in user's own playlists and read their items, so the user can pick a playlist to share (playlists.list mine=true, playlistItems.list).
2) Update the title, description and privacy status of the playlist the user chose to share, so the shared page and YouTube Music stay in sync (playlists.update).
3) When the user taps "Copy to my account" on someone else's shared playlist, create a new playlist in the user's account and add the same tracks (playlists.insert, playlistItems.insert).
4) Read the user's channel ID, name and icon to identify them as the owner of what they share, post, bookmark, follow or comment (channels.list mine=true).
Read-only scopes are not sufficient because features 2 and 3 modify the user's playlists. The app never deletes videos, posts YouTube comments, rates videos or changes subscriptions, and it does not use the data for advertising or AI training.
```

### アプリの説明（App description／求められた場合）
```
Share MUSIC (https://playlist-share.pages.dev/) is a free community web app run by an individual developer. Users can browse playlists and recommended songs shared by others and preview them in the page without signing in. Signed-in users can share their own YouTube Music playlists with a title, description, genres and a cover image, post recommended songs, bookmark and follow, and copy a shared playlist into their own YouTube account. About page: https://playlist-share.pages.dev/about  Privacy policy: https://playlist-share.pages.dev/privacy
```

### デモ動画のリンク
3. でアップロードした YouTube の URL を貼り付けます。

---

## 5. 申請後

- Google から英語のメールが届いたら、**その内容を私に貼り付けてください**。返信文や必要な修正を用意します。
- 審査に通ると、警告画面がなくなり、100人の上限もなくなります。そのあと「使い方」ページのログイン警告の説明を外します。
