"""崔東樹さん（搜狐号）の記事を取得して保存する。

使い方（リポジトリのルートで）:
  python cds_pipeline/fetch.py --archive archive                    # 新着（一覧の先頭）だけ
  python cds_pipeline/fetch.py --archive archive --count 50         # 直近50件までさかのぼる
  python cds_pipeline/fetch.py --archive archive --urls 1080113775 https://www.sohu.com/a/1079036468_115312
  python cds_pipeline/fetch.py --archive archive --rsshub http://localhost:1200

--count（直近◯件）と --urls（記事の指定。URLでも記事IDでもよい）は併用できる。
どちらの場合も、保存済みで図もすべて保存できている記事（＝成功済み）は取り直さずにスキップする。
失敗した記事・図が欠けている記事は取り直す。--refetch を付けると成功済みも取り直す。
ワークフローからは環境変数 CDS_COUNT / CDS_URLS / CDS_REFETCH / CDS_TIME_BUDGET でも渡せる。

終了コード:
  0 … 正常（新着ゼロ・全件スキップも正常）
  2 … 指定された記事URL・記事IDをひとつも読み取れなかった
  3 … 記事一覧がどの方法でも取れなかった（ワークフローは RSSHub を起動して再試行する）
  1 … その他のエラー
"""
from __future__ import annotations

import argparse
import os
import re
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
MAX_TRIES = 3          # 新着取得では、同じ記事の取得失敗はこの回数で諦める（件数・記事の指定時は制限なし）
MAX_COUNT = 300        # 「直近◯件」の上限（打ち間違いで大量に取らないように）
ARTICLE_INTERVAL = 1.5  # 記事ページ取得の間隔（秒）
IMAGE_INTERVAL = 0.3    # 画像取得の間隔（秒）
TRUTHY = {"1", "true", "yes", "on"}
TARGET_SPLIT_RE = re.compile(r"[\s,，、;；]+")
ARTICLE_ID_RE = re.compile(r"(\d{6,})(?:_(\d+))?")


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


def env_int(name: str, default: int = 0) -> int:
    try:
        return int(float(os.environ.get(name) or default))
    except ValueError:
        return default


def env_float(name: str, default: float = 0.0) -> float:
    try:
        return float(os.environ.get(name) or default)
    except ValueError:
        return default


def env_flag(name: str) -> bool:
    return (os.environ.get(name) or "").strip().lower() in TRUTHY


def parse_targets(texts, author_id: str = AUTHOR_ID) -> tuple[list[sohu.ListItem], list[str]]:
    """記事の指定（URL・記事ID・「記事ID_作者ID」。空白・カンマ・改行区切り）を読み取る。
    戻り値は (記事リスト（重複なし・指定順）, 読み取れなかった文字列)。"""
    items: list[sohu.ListItem] = []
    bad: list[str] = []
    seen: set[str] = set()
    for text in texts or []:
        for tok in TARGET_SPLIT_RE.split(text or ""):
            tok = tok.strip().strip("\"'「」<>()（）")
            if not tok:
                continue
            canon = sohu.canonical_article_url(tok)
            if not canon:
                m = ARTICLE_ID_RE.fullmatch(tok)
                if m:
                    aid, au = m.group(1), m.group(2) or author_id
                    canon = (aid, au, f"https://www.sohu.com/a/{aid}_{au}")
            if not canon:
                bad.append(tok)
                continue
            if canon[0] in seen:
                continue
            seen.add(canon[0])
            items.append(sohu.ListItem(article_id=canon[0], url=canon[2], method="manual"))
    return items, bad


def is_complete(archive: Archive, article_id: str) -> bool:
    """成功済み＝保存済みで、保存先に本文があり、図もすべて保存できている記事。"""
    e = archive.entry(article_id)
    if not e or not e.get("path"):
        return False
    if not (archive.root / e["path"] / "article.json").exists():
        return False
    n_img = int(e.get("image_count") or 0)
    if int(e.get("text_chars") or 0) <= 0 and n_img == 0:
        return False
    return int(e.get("images_saved") or 0) >= n_img


def newest_first(items: list[sohu.ListItem]) -> list[sohu.ListItem]:
    """公開日時の新しい順。日時の分からない記事は元の並び（一覧の順）のまま後ろに置く。"""
    dated = [it for it in items if it.published_at]
    undated = [it for it in items if not it.published_at]
    return sorted(dated, key=lambda t: t.published_at, reverse=True) + undated


def describe_mode(count: int, explicit: list, refetch: bool) -> str:
    parts = []
    if count:
        parts.append(f"直近{count}件")
    if explicit:
        parts.append(f"指定{len(explicit)}件")
    desc = "＋".join(parts) if parts else "新着（一覧の先頭）"
    if refetch:
        desc += "（成功済みも取り直す）"
    elif parts:
        desc += "（成功済みはスキップ）"
    return desc


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
    ap = argparse.ArgumentParser(description="崔東樹さん（搜狐号）の記事を取得")
    ap.add_argument("--archive", default="archive", help="cds-archive ブランチを展開したフォルダ")
    ap.add_argument("--count", type=int, default=env_int("CDS_COUNT", 0),
                    help=f"直近何件までさかのぼって取るか（0=新着だけ。上限{MAX_COUNT}）。成功済みはスキップ")
    ap.add_argument("--urls", nargs="*", default=None,
                    help="取りたい記事のURLまたは記事ID（複数可）。成功済みはスキップ")
    ap.add_argument("--refetch", action="store_true", default=env_flag("CDS_REFETCH"),
                    help="成功済みの記事も取り直す")
    ap.add_argument("--max-new", type=int, default=env_int("CDS_MAX_NEW", 20),
                    help="新着取得（--count・--urls なし）で1回に保存する最大件数")
    ap.add_argument("--pages", type=int, default=1, help="新着取得で一覧を何ページ分見るか（v2 APIのみ）")
    ap.add_argument("--time-budget", type=float, default=env_float("CDS_TIME_BUDGET", 0),
                    help="この秒数を過ぎたら次の記事に手を付けずに終える（0=制限なし）。残りは再実行で続きから")
    ap.add_argument("--rsshub", nargs="*", default=None,
                    help="RSSHub のURL（既定は環境変数 CDS_RSSHUB または https://rsshub.app）")
    ap.add_argument("--no-images", action="store_true", help="画像を保存しない")
    args = ap.parse_args(argv)

    started = time.time()
    archive = Archive(args.archive)
    session = sohu.make_session()
    rsshub = args.rsshub if args.rsshub is not None else [
        u.strip() for u in (os.environ.get("CDS_RSSHUB") or "https://rsshub.app").split(",") if u.strip()]

    # ---- 0. 何を取るか ----------------------------------------------------------
    explicit, bad = parse_targets(list(args.urls or []) + [os.environ.get("CDS_URLS") or ""])
    if bad:
        log(f"[指定] 記事のURL・記事IDとして読み取れないので無視: {' '.join(bad)}")
        gh_annotate("warning", "読み取れない指定を無視しました", " ".join(bad))
    count = max(0, args.count)
    if count > MAX_COUNT:
        log(f"[指定] 直近{count}件は多すぎるので {MAX_COUNT}件にします")
        gh_annotate("warning", "件数を上限に合わせました", f"指定 {count}件 → {MAX_COUNT}件")
        count = MAX_COUNT
    if bad and not explicit and not count:
        msg = f"記事のURL・記事IDを読み取れませんでした: {' '.join(bad)[:300]}"
        log(f"[指定] {msg}")
        gh_annotate("error", "取得する記事を指定できませんでした", msg)
        gh_summary(f"### 崔東樹 記事取得\n\n{msg}\n\n例: `https://www.sohu.com/a/1080113775_115312` または `1080113775`")
        gh_output(list_ok="true", new_count=0, failed_count=0, skipped_count=0, deferred_count=0)
        return 2
    manual = bool(explicit) or count > 0
    mode = describe_mode(count, explicit, args.refetch)
    log(f"[指定] {mode}")

    # ---- 1. 一覧（記事の指定だけなら一覧は見ない） ----------------------------------
    attempts: list[str] = []
    items: list[sohu.ListItem] = []
    list_method = "urls"
    list_error: Exception | None = None
    if count or not explicit:
        try:
            items, attempts = sohu.list_articles(session, author_id=AUTHOR_ID, xpt=XPT, rsshub_instances=rsshub,
                                                 pages=args.pages, want=count or None, log=log)
            list_method = items[0].method if items else "?"
            gh_annotate("notice", "記事一覧の取得結果", " / ".join(attempts))
        except sohu.ListError as e:
            list_error = e
            log(f"[一覧] すべての方法で失敗: {e}")
            gh_annotate("error", "記事一覧を取得できませんでした", str(e))
            if not explicit:
                archive.append_log({"run_at": now_iso(), "ok": False, "mode": mode, "list_attempts": str(e)})
                gh_output(list_ok="false", new_count=0)
                gh_summary(f"### 崔東樹 記事取得\n\n記事一覧を取得できませんでした。\n\n```\n{e}\n```")
                return 3
            log("[一覧] 指定された記事だけ先に取得します")

    # ---- 2. 取得対象を決める ------------------------------------------------------
    skipped: list[sohu.ListItem] = []
    if manual:
        window = newest_first(items)[:count] if count else []
        if count and items and len(window) < count:
            msg = f"一覧で取れたのは直近{len(window)}件まででした（指定は{count}件。一覧の取得方法: {list_method}）"
            log(f"[一覧] {msg}")
            gh_annotate("warning", "指定した件数までさかのぼれませんでした", msg)
        targets: list[sohu.ListItem] = []
        seen: set[str] = set()
        for it in explicit + window:
            if it.article_id in seen:
                continue
            seen.add(it.article_id)
            if not args.refetch and is_complete(archive, it.article_id):
                skipped.append(it)
            else:
                targets.append(it)
        log(f"[対象] 取得 {len(targets)}件 / 成功済みでスキップ {len(skipped)}件")
    else:
        known = archive.known_ids()
        targets = [it for it in items if args.refetch or it.article_id not in known]
        # 前回失敗した記事も（回数上限まで）再挑戦
        listed = {it.article_id for it in targets}
        for aid, f in list(archive.index["failed"].items()):
            if aid not in listed and aid not in known and int(f.get("tries", 0)) < MAX_TRIES and f.get("url"):
                canon = sohu.canonical_article_url(f["url"])
                if canon:
                    targets.append(sohu.ListItem(article_id=aid, url=canon[2], method="retry"))
        targets = [t for t in targets
                   if int((archive.index["failed"].get(t.article_id) or {}).get("tries", 0)) < MAX_TRIES]
        targets = newest_first(targets)
        if len(targets) > args.max_new:
            log(f"[一覧] 新着 {len(targets)}件のうち新しい {args.max_new}件だけ処理します（残りは次回）")
            targets = targets[:args.max_new]
        log(f"[一覧] 新着 {len(targets)}件（保存済み {len(known)}件）")

    # ---- 3. 記事ごとに取得・保存 ------------------------------------------------
    new_entries, failed, deferred = [], [], []
    debug_saved = 0
    for i, it in enumerate(targets, 1):
        if args.time_budget and time.time() - started > args.time_budget:
            deferred = targets[i - 1:]
            msg = (f"制限時間（{args.time_budget / 60:.0f}分）を過ぎたため、残り{len(deferred)}件は次回に回しました。"
                   "同じ設定でもう一度実行すると、成功済みを飛ばして続きから取ります")
            log(f"[時間] {msg}")
            gh_annotate("warning", "時間切れで一部を次回に回しました", msg)
            break
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
        "run_at": now_iso(), "ok": list_error is None, "mode": mode,
        "list_method": list_method, "list_attempts": attempts if list_error is None else str(list_error),
        "content_methods": [f"{e['id']}: {e.get('content_method')}" for e in new_entries],
        "new": [e["id"] for e in new_entries], "failed": [f"{it.article_id}: {e}"[:200] for it, e in failed],
        "skipped": [it.article_id for it in skipped], "deferred": [it.article_id for it in deferred],
        "seconds": round(time.time() - started, 1),
    })

    # ---- 4. 実行結果のまとめ ---------------------------------------------------
    gh_output(list_ok="false" if list_error else "true", new_count=len(new_entries), failed_count=len(failed),
              skipped_count=len(skipped), deferred_count=len(deferred))
    if manual or new_entries or failed:
        rows = ["### 崔東樹 記事取得", "", f"実行内容: {mode}"]
        if list_error:
            rows.append("記事一覧: 取得できませんでした（指定された記事だけ先に取得。このあと RSSHub で一覧を取り直します）")
        elif count or not explicit:
            rows.append(f"一覧の取得方法: `{list_method}`")
        rows += ["", f"取得 {len(new_entries)}件 ・ 失敗 {len(failed)}件 ・ 成功済みでスキップ {len(skipped)}件"
                 + (f" ・ 時間切れで次回 {len(deferred)}件" if deferred else ""), ""]
        if new_entries or failed:
            rows += ["| 公開日 | テーマ | タイトル | 画像 |", "|---|---|---|---|"]
            for e in new_entries:
                rows.append(f"| {(e['published_at'] or '')[:10]} | {e['topic_label']} | "
                            f"[{e['title']}]({e['url']}) | {e['images_saved']}/{e['image_count']} |")
            for it, e in failed:
                rows.append(f"| – | 失敗 | {it.url} | {type(e).__name__} |")
        if skipped:
            rows += ["", "<details><summary>成功済みでスキップした記事</summary>", ""]
            for it in skipped:
                e = archive.entry(it.article_id) or {}
                rows.append(f"- {(e.get('published_at') or '')[:10]} [{e.get('title') or it.article_id}]({it.url})")
            rows += ["", "</details>"]
        gh_summary("\n".join(rows))
    log(f"完了: 新規 {len(new_entries)}件 / 失敗 {len(failed)}件 / スキップ {len(skipped)}件"
        + (f" / 次回に持ち越し {len(deferred)}件" if deferred else ""))
    return 3 if list_error else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        sys.exit(1)
