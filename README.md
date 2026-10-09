# 崔東樹さんの記事の自動取得

## 何をするか

- 1日2回（12:17と23:17・日本時間）、GitHub Actions が崔東樹さんの搜狐号を確認します。新しい記事があれば本文と図（画像）を `cds-archive` ブランチに保存します。
- ダッシュボードの「崔東樹ブログ」タブの **最新記事（自動取得）** に、新しい順に表示されます。
- **費用はかかりません。** GitHub Actions は公開リポジトリなら無料で、有料のAI（API）は初期状態では一切使いません。

これまでの「HTMLを保存 → 画像ごとチャットに読み込ませる」作業は不要になります。日本語訳やグラフの数値をダッシュボードに反映したいときは、Claude に次のように頼むだけで済みます（GitHub に保存された本文と図を Claude が直接読みます。追加の費用はかかりません）。

> 崔東樹さんの最新記事（a8f3x9data の cds-archive ブランチ）を読んで、ダッシュボードの輸出タブを更新して

## 導入手順（初回のみ）

1. 次の2つを、いつも使っている `a8f3x9data` のフォルダにコピーします。そのあと普段どおり push してください。
   - `cds_pipeline/`（このフォルダ）
   - `.github/workflows/cds-fetch.yml`
2. GitHub でリポジトリを開き、**Actions** タブ →「崔東樹 記事取得」→ **Run workflow** を押して、初回を手動で実行します。
3. 数分後に `cds-archive` ブランチができ、直近20件の記事が入ります。以降は自動で増えていきます。

GitHub Actions は公開リポジトリなら無料です。

## （任意・有料）AIによる要約・グラフ読み取りの自動化

初期状態ではオフで、何もしなければ費用は発生しません。日本語要約と図の数値表まで毎回自動で作りたくなった場合だけ、次の設定をします。数値表はダッシュボード上でグラフとして再描画され、元の図と並べて確認できます。

1. https://platform.claude.com で APIキーを作ります（従量課金で、クレジットを先に購入する方式です）。
2. リポジトリの **Settings → Secrets and variables → Actions** を開きます。
   - **Secrets** タブ → New repository secret：名前 `ANTHROPIC_API_KEY`、値はAPIキー
   - **Variables** タブ → New repository variable：名前 `CDS_AI_ENABLED`、値 `true`
3. 次回の実行から、直近45日分の記事が1回6件ずつ処理されます。やめたいときは `CDS_AI_ENABLED` を削除します。

**費用の目安**（Claude Sonnet 5.5 の場合。入力 $2・出力 $10／100万トークン）

- 図40枚の記事で1件あたり約0.3ドルです。図の少ない記事ならもっと安く済みます。
- 月の合計は数ドル程度です。実際の金額は、各実行の結果画面（Summary）と `ai.json` の `est_cost_usd` に表示されます。

**調整したい場合**（Settings → Secrets and variables → Actions → Variables タブ）

| 名前 | 内容 | 既定値 |
|---|---|---|
| `CDS_AI_MODEL` | 使うモデル。精度を上げたいなら `claude-opus-5-5`（料金は約2倍） | `claude-sonnet-5-5` |
| `CDS_AI_MAX_ARTICLES` | 1回の実行で処理する最大記事数 | `6` |
| `CDS_AI_CHARTS` | `0` にすると要約だけ作る（図の読み取りをしない＝安い） | `1` |

AIが読み取った数値には誤りが混じることがあります。ダッシュボードでは「AI読み取り」と表示し、元の図と並べて確認できるようにしています。

## 特定の記事だけ取りたいとき

Actions →「崔東樹 記事取得」→ Run workflow を押し、`urls` 欄に搜狐の記事URLを空白区切りで入れて実行します。古い記事を後から取りたいときに使います。

## 保存先（cds-archive ブランチ）

```
cds/index.json                          記事一覧（新しい順・全件）
cds/latest.json                         直近60件の軽量版。ダッシュボードはこれを読む
cds/run_log.json                        直近の実行記録
cds/articles/年/月/記事ID/content.md    本文と図（人が読む用）
cds/articles/年/月/記事ID/article.json  本文と図の並び（プログラム用）
cds/articles/年/月/記事ID/img/          図の画像
cds/articles/年/月/記事ID/ai.json       AIの要約と図の数値表（有料AIを有効にした場合のみ）
```

`main` ブランチ（公開中のダッシュボード）には一切書き込みません。手元のPCからの push と衝突することはありません。

## 取得の仕組み

搜狐の記事一覧は、次の3つの方法を上から順に試します。

1. 搜狐の作者記事API
2. プロフィールページと同じ仕組みのAPI（RSSHub の実装を移植）
3. RSSHub（公開サーバー。だめならワークフロー内で RSSHub を起動して再試行）

記事本文は記事ページを直接読み、暗号化された画像URLは復号して画像を保存します。搜狐への負荷を抑えるため、記事は1.5秒間隔で取得し、1回の実行で最大20件までにしています。

## うまく動かないとき

- 失敗すると GitHub からメールが届きます。Actions の実行結果の画面に、原因（どの取得方法がどう失敗したか）が注釈として表示されます。同じ内容は `cds-archive` ブランチの `cds/run_log.json` にも残ります。
- 搜狐の仕組みが変わった場合は、その内容を Claude に伝えれば直せます。
- 公開リポジトリでは、60日間リポジトリに動きがないと定期実行が自動で止まります。その場合は Actions 画面の「Enable workflow」で再開してください。

## 手元のPCにアーカイブを落とさない設定（任意）

`git pull` すると `cds-archive` ブランチ（画像が年に数百MB程度増えます）も手元に落ちてきます。不要なら、手元のフォルダで一度だけ次を実行してください。

```
git config remote.origin.fetch "+refs/heads/main:refs/remotes/origin/main"
```

## テスト

```
pip install -r cds_pipeline/requirements.txt pytest
python -m pytest cds_pipeline/tests -q
```
