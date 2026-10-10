"""崔東樹さん（搜狐号）の新着記事を取得して保存する。

使い方（リポジトリのルートで）:
  python cds_pipeline/fetch.py --archive archive
  python cds_pipeline/fetch.py --archive archive --urls https://www.sohu.com/a/1080113775_115312
  python cds_pipeline/fetch.py --archive archive --rsshub http://localhost:1200

終了コード:
  0 … 正常（新着ゼロも正常）
  3 … 記事一覧がどの方法でも取れなかった（ワークフローは RSSHub を起動して再試行する）
  1 … その他のエラー
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sohu  # noqa: E402
from store import Archive, image_size, now_iso, shrink_image, write_json  # noqa: E402
from topics import classify  # noqa: E402

AUTHOR_ID = os.environ.get("CDS_AUTHOR_ID") or "115312"
XPT = os.environ.get("CDS_XPT") or "Y3VpZG9uZ3NodUBzb2h1LmNvbQ=="
MAX_TRIES = 3          # 同じ記事の取得失敗はこの回数で諦める
ARTICLE_INTERVAL = 1.5  # 記事ページ取得の間隔（秒）
IMAGE_INTERVAL = 0.3    # 画像取得の間隔（秒）


def log(msg: str) -> None:
    print(msg, flush=True)


def gh_output(**kv) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as f:
        for k, v in kv.items():
            f.write(f"{k}={v}\n")


def gh_summary(text: str) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as f:
        f.write(text + "\n")


def gh_annotate(level: str, title: str, message: str) -> None:
    """GitHub Actions の実行画面に注釈（警告・エラー）を出す。ログを開かなくても原因が分かるように。"""
    if not os.environ.get("GITHUB_ACTIONS"):
        return
    msg = message.replace("%", "%25").replace("\r", "").replace("\n", "%0A")[:900]
    ttl = title.replace("%", "%25").replace(",", "，").replace("::", "：")
    print(f"::{level} title={ttl}::{msg}", flush=True)


def build_markdown(art: sohu.Article, topic_label: str, blocks: list[dict]) -> str:
    when = (art.published_at or "")[:16].replace("T", " ")
    n_img = sum(1 for b in blocks if b["type"] == "image")
    lines = [f"# {art.title}", "",
             f"- 公開日時: {when}（北京時間）" if when else "- 公開日時: 不明",
             f"- 出典: [搜狐号・崔东树]({art.url})",
             f"- テーマ（自動判定）: {topic_label}",
             f"- 画像: {n_img}枚", "", "---", ""]
    fig = 0
    for b in blocks:
        if b["type"] == "text":
            lines += [b["text"], ""]
        else:
            fig += 1
            if b.get("file"):
                lines += [f"![図{fig}]({b['file']})", ""]
            elif b.get("src_url"):
                lines += [f"![図{fig}（保存失敗）]({b['src_url']})", ""]
            else:
                lines += [f"（図{fig}：画像を取得できませんでした）", ""]
    return "\n".join(lines).rstrip() + "\n"


def save_article(archive: Archive, session, art: sohu.Article, *, with_images: bool = True) -> dict:
    topic, topic_label = classify(art.title)
    adir = archive.article_dir(art.article_id, art.published_at)
    (adir / "img").mkdir(parents=True, exist_ok=True)

    blocks: list[dict] = []
    n = 0
    total_imgs = sum(1 for b in art.blocks if b["type"] == "image")
    width = 3 if total_imgs > 99 else 2
    saved = 0
    for b in art.blocks:
        if b["type"] != "image":
            blocks.append(dict(b))
            continue
        n += 1
        nb = dict(b)
        if not b.get("src_url"):
            nb["file"] = None
            nb["error"] = "本物の画像URLが見つからない（仮画像のみ）"
            blocks.append(nb)
            continue
        if with_images:
            try:
                data, ext = sohu.download_image(session, b["src_url"])
                data, ext = shrink_image(data, ext)
                fname = f"img/{n:0{width}d}.{ext}"
                (adir / fname).write_bytes(data)
                nb["file"] = fname
                nb["bytes"] = len(data)
                size = image_size(data)
                if size:
                    nb["width"], nb["height"] = size
                saved += 1
            except Exception as e:
                nb["file"] = None
                nb["error"] = f"{type(e).__name__}: {e}"[:200]
                log(f"    画像{n}の保存に失敗: {nb['error']}")
            time.sleep(IMAGE_INTERVAL)
        else:
            nb["file"] = None
        blocks.append(nb)

    text = "\n\n".join(b["text"] for b in blocks if b["type"] == "text")
    record = {
        "id": art.article_id, "author_id": art.author_id, "url": art.url,
        "title": art.title, "published_at": art.published_at, "fetched_at": now_iso(),
        "topic": topic, "topic_label": topic_label, "source": "sohu",
        "content_method": art.content_method,
        "image_count": total_imgs, "images_saved": saved, "text_chars": len(text),
        "blocks": blocks,
    }
    write_json(adir / "article.json", record)
    (adir / "content.md").write_text(build_markdown(art, topic_label, blocks), encoding="utf-8")

    first_img = next((b for b in blocks if b["type"] == "image" and b.get("file")), None)
    lead = text.replace("\n", " ")[:160]
    entry = {
        "id": art.article_id, "title": art.title, "published_at": art.published_at,
        "url": art.url, "topic": topic, "topic_label": topic_label,
        "path": archive.rel(adir), "image_count": total_imgs, "images_saved": saved,
        "text_chars": len(text), "lead": lead, "content_method": art.content_method,
        "thumb": archive.rel(adir / first_img["file"]) if first_img else None,
        "fetched_at": record["fetched_at"],
    }
    old = archive.entry(art.article_id)
    if old and old.get("ai"):
        entry["ai"] = old["ai"]
    return entry


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="崔東樹さん（搜狐号）の新着記事を取得")
    ap.add_argument("--archive", default="archive", help="cds-archive ブランチを展開したフォルダ")
    ap.add_argument("--max-new", type=int, default=int(os.environ.get("CDS_MAX_NEW") or "20"),
                    help="1回の実行で保存する最大件数")
    ap.add_argument("--pages", type=int, default=1, help="一覧を何ページ分さかのぼるか（v2 APIのみ）")
    ap.add_argument("--urls", nargs="*", default=None, help="一覧を使わず、指定した記事URLだけ取得")
    ap.add_argument("--rsshub", nargs="*", default=None,
                    help="RSSHub のURL（既定は環境変数 CDS_RSSHUB または https://rsshub.app）")
    ap.add_argument("--no-images", action="store_true", help="画像を保存しない")
    ap.add_argument("--refetch", action="store_true", help="保存済みの記事も取り直す（--urls と併用）")
    args = ap.parse_args(argv)

    started = time.time()
    archive = Archive(args.archive)
    session = sohu.make_session()
    rsshub = args.rsshub if args.rsshub is not None else [
        u.strip() for u in (os.environ.get("CDS_RSSHUB") or "https://rsshub.app").split(",") if u.strip()]

    # ---- 1. 一覧 -------------------------------------------------------------
    attempts: list[str] = []
    list_method = "urls"
    if args.urls:
        items = []
        for u in args.urls:
            for part in u.replace(",", " ").split():
                canon = sohu.canonical_article_url(part)
                if canon:
                    items.append(sohu.ListItem(article_id=canon[0], url=canon[2], method="manual"))
                else:
                    log(f"[一覧] 記事URLとして認識できないので無視: {part}")
    else:
        try:
            items, attempts = sohu.list_articles(session, author_id=AUTHOR_ID, xpt=XPT,
                                                 rsshub_instances=rsshub, pages=args.pages, log=log)
            list_method = items[0].method if items else "?"
            gh_annotate("notice", "記事一覧の取得結果", " / ".join(attempts))
        except sohu.ListError as e:
            log(f"[一覧] すべての方法で失敗: {e}")
            gh_annotate("error", "記事一覧を取得できませんでした", str(e))
            archive.append_log({"run_at": now_iso(), "ok": False, "list_attempts": str(e)})
            gh_output(list_ok="false", new_count=0)
            gh_summary(f"### 崔東樹 記事取得\n\n記事一覧を取得できませんでした。\n\n```\n{e}\n```")
            return 3

    known = archive.known_ids()
    targets = [it for it in items if args.refetch or it.article_id not in known]
    # 前回失敗した記事も（回数上限まで）再挑戦
    listed = {it.article_id for it in targets}
    for aid, f in list(archive.index["failed"].items()):
        if aid not in listed and aid not in known and int(f.get("tries", 0)) < MAX_TRIES and f.get("url"):
            canon = sohu.canonical_article_url(f["url"])
            if canon:
                targets.append(sohu.ListItem(article_id=aid, url=canon[2], method="retry"))
    targets = [t for t in targets if int((archive.index["failed"].get(t.article_id) or {}).get("tries", 0)) < MAX_TRIES
               or args.urls]
    # 古い順に処理（index の並びは保存時に日付で整列される）
    targets.sort(key=lambda t: t.published_at or "")
    if len(targets) > args.max_new:
        log(f"[一覧] 新着 {len(targets)}件のうち新しい {args.max_new}件だけ処理します（残りは次回）")
        targets = targets[-args.max_new:]
    log(f"[一覧] 新着 {len(targets)}件（保存済み {len(known)}件）")

    # ---- 2. 記事ごとに取得・保存 ------------------------------------------------
    new_entries, failed = [], []
    debug_saved = 0
    for i, it in enumerate(targets, 1):
        log(f"[{i}/{len(targets)}] {it.url} {it.title[:40]}")
        try:
            try:
                art = sohu.fetch_article(session, it)
            except Exception as e:
                if it.fallback_html:
                    log(f"    記事ページが取れないためRSS本文を使用 ({e})")
                    art = sohu.parse_fallback_html(it.fallback_html, it)
                else:
                    raise
            entry = save_article(archive, session, art, with_images=not args.no_images)
            archive.upsert(entry)
            archive.remove_debug(art.article_id)
            if art.missing_images:
                # 図の一部で本物の画像URLが見つからなかった → 原因を調べられるよう生HTMLを残す
                gh_annotate("warning", "画像の一部を取得できませんでした",
                            f"{art.url} 図{art.missing_images}枚が仮画像のみ（本文の取得方法 {art.content_method}）")
                if debug_saved < 3:
                    paths = archive.save_debug(art.article_id, art.raw_html)
                    debug_saved += 1
                    log(f"    図{art.missing_images}枚の画像URLが見つからないため、調査用にHTMLを保存: {', '.join(paths)}")
            archive.save_index()  # 途中で止まっても保存済み分は残す
            new_entries.append(entry)
            log(f"    保存: {entry['title'][:40]} / {entry['topic_label']} / 画像{entry['images_saved']}/{entry['image_count']}"
                f" / 本文の取得方法 {entry['content_method']}")
        except Exception as e:
            tries = archive.record_failure(it.article_id, it.url, f"{type(e).__name__}: {e}")
            failed.append((it, e))
            log(f"    失敗（{tries}回目）: {type(e).__name__}: {e}")
            # 本文が見つからなかったページは、原因を調べられるよう生HTMLを残す（初回のみ・1回の実行で3件まで）
            if isinstance(e, sohu.ContentNotFound) and tries == 1 and debug_saved < 3:
                paths = archive.save_debug(it.article_id, e.html, e.mobile_html)
                if paths:
                    debug_saved += 1
                    log(f"    調査用にHTMLを保存: {', '.join(paths)}")
            gh_annotate("warning", f"記事の取得に失敗（{tries}回目）", f"{it.url} {type(e).__name__}: {e}")
            if os.environ.get("CDS_DEBUG"):
                traceback.print_exc()
        time.sleep(ARTICLE_INTERVAL)

    archive.save_index()
    methods = {}
    for e in new_entries:
        key = (e.get("content_method") or "?").split(":")[0]
        methods[key] = methods.get(key, 0) + 1
    if new_entries:
        gh_annotate("notice", "本文の取得方法", " / ".join(f"{k}: {v}件" for k, v in methods.items()))
    archive.append_log({
        "run_at": now_iso(), "ok": True, "list_method": list_method, "list_attempts": attempts,
        "content_methods": [f"{e['id']}: {e.get('content_method')}" for e in new_entries],
        "new": [e["id"] for e in new_entries], "failed": [f"{it.article_id}: {e}"[:200] for it, e in failed],
        "seconds": round(time.time() - started, 1),
    })

    # ---- 3. 実行結果のまとめ ---------------------------------------------------
    gh_output(list_ok="true", new_count=len(new_entries), failed_count=len(failed))
    if new_entries or failed:
        rows = ["### 崔東樹 記事取得", "", f"一覧の取得方法: `{list_method}`", "",
                "| 公開日 | テーマ | タイトル | 画像 |", "|---|---|---|---|"]
        for e in new_entries:
            rows.append(f"| {(e['published_at'] or '')[:10]} | {e['topic_label']} | "
                        f"[{e['title']}]({e['url']}) | {e['images_saved']}/{e['image_count']} |")
        for it, e in failed:
            rows.append(f"| – | 失敗 | {it.url} | {type(e).__name__} |")
        gh_summary("\n".join(rows))
    log(f"完了: 新規 {len(new_entries)}件 / 失敗 {len(failed)}件")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        sys.exit(1)
