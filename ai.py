"""（任意）保存済みの記事を Claude API で読み取り、日本語要約とグラフの数値表を作る。

環境変数 ANTHROPIC_API_KEY が無ければ何もせず終了する（取得だけの運用も可能）。

使い方:
  python cds_pipeline/ai.py --archive archive
  python cds_pipeline/ai.py --archive archive --ids 1080113775 --force

出力:
  cds/articles/.../ai.json … 要約（summary）とグラフごとの数値表（charts）
  cds/index.json の各記事に ai: {title_ja, summary_ja, highlights_ja, chart_count, ...} を追記

主な設定（環境変数）:
  CDS_AI_MODEL         既定 claude-sonnet-5-5
  CDS_AI_MAX_ARTICLES  1回に処理する最大記事数（既定 6）
  CDS_AI_CHARTS        0 にするとグラフの数値読み取りをしない（要約だけ）
  CDS_AI_MAX_AGE_DAYS  これより古い記事は自動処理しない（既定 45日）
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from store import Archive, now_iso, read_json, write_json  # noqa: E402
from topics import CHART_TOPICS  # noqa: E402

MODEL = os.environ.get("CDS_AI_MODEL") or "claude-sonnet-5-5"
MAX_ARTICLES = int(os.environ.get("CDS_AI_MAX_ARTICLES") or "6")
DO_CHARTS = (os.environ.get("CDS_AI_CHARTS") or "1") != "0"
MAX_AGE_DAYS = int(os.environ.get("CDS_AI_MAX_AGE_DAYS") or "45")
IMAGES_PER_CALL = 8
MAX_FAILURES = 2
# 料金（USD / 100万トークン）。https://platform.claude.com/docs/en/models/overview の掲載値
PRICES = {"claude-sonnet-5-5": (2.0, 10.0), "claude-opus-5-5": (4.0, 20.0), "claude-fable-5-1": (10.0, 50.0)}

SUMMARY_TOOL = {
    "name": "record_summary",
    "description": "崔東樹（乗聯会秘書長）の記事の日本語要約を記録する。",
    "input_schema": {
        "type": "object",
        "properties": {
            "title_ja": {"type": "string", "description": "記事タイトルの自然な日本語訳"},
            "summary_ja": {"type": "string", "description": "記事全体の要点を2〜3文の日本語で"},
            "highlights_ja": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 6,
                              "description": "数値を含む重要ポイント（1項目1文、日本語）"},
            "key_figures": {
                "type": "array", "maxItems": 12,
                "items": {"type": "object", "properties": {
                    "label_ja": {"type": "string"}, "value": {"type": ["number", "string"]},
                    "unit": {"type": "string"}, "period": {"type": "string"},
                    "change": {"type": "string", "description": "前年比・前月比など（例: 前年比+51%）"}},
                    "required": ["label_ja", "value", "unit"]}},
            "period": {"type": "string", "description": "記事が扱う期間（例: 2026年1-8月、2026年8月）"},
        },
        "required": ["title_ja", "summary_ja", "highlights_ja"],
    },
}

CHART_TOOL = {
    "name": "record_charts",
    "description": "記事内の図（グラフ・表）を1枚ずつ数値表に書き起こして記録する。",
    "input_schema": {
        "type": "object",
        "properties": {"charts": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "figure": {"type": "integer", "description": "図番号（入力の「図n」のn）"},
                "kind": {"type": "string", "enum": ["line", "bar", "stacked_bar", "combo", "pie",
                                                     "table", "map", "photo", "other"]},
                "title_cn": {"type": "string", "description": "図のタイトル（原文のまま）"},
                "title_ja": {"type": "string", "description": "図のタイトルの日本語訳"},
                "unit": {"type": "string", "description": "数値の単位（例: 万台, %, 億元）"},
                "categories": {"type": "array", "items": {"type": "string"},
                               "description": "横軸（または表の行見出し）の項目を左から順に"},
                "series": {"type": "array", "items": {"type": "object", "properties": {
                    "name_cn": {"type": "string"}, "name_ja": {"type": "string"},
                    "values": {"type": "array", "items": {"type": ["number", "null"]},
                               "description": "categories と同じ順・同じ数。読めない値は null"},
                    "unit": {"type": "string", "description": "この系列だけ単位が違う場合（右軸など）"}},
                    "required": ["name_cn", "values"]}},
                "readable": {"type": "boolean", "description": "数値を読み取れたか"},
                "confidence": {"type": "string", "enum": ["high", "medium", "low"],
                               "description": "high=データラベルの数字をそのまま読めた / low=軸目盛りから推定"},
                "notes_ja": {"type": "string"},
            },
            "required": ["figure", "kind", "readable"]}}},
        "required": ["charts"],
    },
}

SUMMARY_PROMPT = """あなたは中国自動車市場のアナリストです。上は崔東樹（全国乗用車市場信息聯席会 秘書長）のブログ記事の本文です（[図n] は画像の位置）。
日本の自動車業界の読者向けに、record_summary ツールで日本語の要約を記録してください。
- 数値は本文に書かれているものだけを使い、推測で補わないこと
- 「万辆」は「万台」、「同比」は「前年比」、「环比」は「前月比」と訳す
- 中国の企業名・ブランド名は日本で一般的な表記があればそれを使う（例: 比亚迪→BYD）"""

CHART_PROMPT = """上の画像は崔東樹のブログ記事に含まれる図です。各画像の直前に「図n」と、本文中で図の近くにある文章を付けています。
record_charts ツールで、すべての図を1枚ずつ数値表に書き起こしてください。
- グラフ上にデータラベル（数字）が印字されている場合は、その数字をそのまま使う（confidence=high）
- データラベルが無く軸目盛りから読む場合は、読み取った概算値を入れて confidence=low にする
- categories は横軸の項目を左から順に。年は「2016」のように西暦4桁、月は「2026-08」の形に揃える
- series の values は categories と同じ数・同じ順にする。読めない値は null
- 単位は「万台」「%」「億元」などに統一（万辆→万台）。右軸の系列は series の unit に単位を書く
- 写真・ロゴ・地図など数値の無い画像は kind を photo / map / other にして readable=false
- 表（テーブル画像）は kind=table とし、行見出しを categories、列ごとに series として書き起こす"""


def _client():
    import anthropic
    return anthropic.Anthropic(max_retries=3)


def _is_fatal(ex: Exception) -> bool:
    """続けても無駄なエラー（認証・権限・残高不足・モデル名の誤り）かどうか。"""
    name = type(ex).__name__
    if name in ("AuthenticationError", "PermissionDeniedError", "NotFoundError"):
        return True
    msg = str(ex).lower()
    return name == "BadRequestError" and ("credit balance" in msg or "billing" in msg)


def _call_tool(client, content: list, tool: dict, max_tokens: int):
    with client.messages.stream(model=MODEL, max_tokens=max_tokens, tools=[tool],
                                tool_choice={"type": "tool", "name": tool["name"]},
                                messages=[{"role": "user", "content": content}]) as stream:
        msg = stream.get_final_message()
    usage = {"input_tokens": msg.usage.input_tokens, "output_tokens": msg.usage.output_tokens}
    for block in msg.content:
        if getattr(block, "type", "") == "tool_use" and block.name == tool["name"]:
            return block.input, usage
    raise RuntimeError(f"ツールの結果が返りませんでした（stop_reason={msg.stop_reason}）")


def _image_block(path: Path) -> dict | None:
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return None
    ext = path.suffix.lower().lstrip(".")
    media = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
             "gif": "image/gif", "webp": "image/webp"}.get(ext)
    if not media:
        return None
    try:  # 2000pxを超える画像は縮小（APIの推奨サイズ）
        from PIL import Image
        with Image.open(io.BytesIO(data)) as im:
            if max(im.size) > 2000:
                im.thumbnail((2000, 2000))
                out = io.BytesIO()
                im.convert("RGB").save(out, "JPEG", quality=90)
                data, media = out.getvalue(), "image/jpeg"
    except Exception:
        pass
    return {"type": "image", "source": {"type": "base64", "media_type": media,
                                        "data": base64.b64encode(data).decode("ascii")}}


def _article_text(record: dict, limit: int = 60000) -> tuple[str, dict[int, str]]:
    """本文テキスト（[図n]の位置入り）と、図ごとの近くの文章を返す。"""
    parts, near, fig, last_text = [f"タイトル: {record['title']}", ""], {}, 0, ""
    blocks = record.get("blocks") or []
    for i, b in enumerate(blocks):
        if b["type"] == "text":
            parts.append(b["text"])
            last_text = b["text"]
        else:
            fig += 1
            parts.append(f"[図{fig}]")
            nxt = next((x["text"] for x in blocks[i + 1:i + 3] if x["type"] == "text"), "")
            near[fig] = (last_text[-120:] + " … " + nxt[:120]).strip(" …")
    return "\n\n".join(parts)[:limit], near


def process_article(client, archive: Archive, entry: dict, *, charts: bool) -> dict:
    adir = archive.root / entry["path"]
    record = read_json(adir / "article.json", None)
    if not record:
        raise RuntimeError("article.json がありません")
    text, near = _article_text(record)
    usage_total = {"input_tokens": 0, "output_tokens": 0}

    summary, usage = _call_tool(client, [{"type": "text", "text": text},
                                         {"type": "text", "text": SUMMARY_PROMPT}], SUMMARY_TOOL, 4000)
    for k in usage_total:
        usage_total[k] += usage[k]

    chart_rows: list[dict] = []
    if charts:
        figs = []
        fig = 0
        for b in record.get("blocks") or []:
            if b["type"] == "image":
                fig += 1
                if b.get("file"):
                    figs.append((fig, adir / b["file"]))
        for start in range(0, len(figs), IMAGES_PER_CALL):
            batch = figs[start:start + IMAGES_PER_CALL]
            content = []
            for n, path in batch:
                blk = _image_block(path)
                if not blk:
                    continue
                content.append({"type": "text", "text": f"図{n}（近くの文章: {near.get(n, '')}）"})
                content.append(blk)
            if not content:
                continue
            content.append({"type": "text", "text": CHART_PROMPT})
            result, usage = _call_tool(client, content, CHART_TOOL, 16000)
            for k in usage_total:
                usage_total[k] += usage[k]
            for c in result.get("charts") or []:
                n = c.get("figure")
                match = next((p for f, p in batch if f == n), None)
                if match is not None:
                    c["file"] = match.relative_to(adir).as_posix()
                chart_rows.append(c)
            time.sleep(1)

    price = PRICES.get(MODEL)
    cost = None
    if price:
        cost = round(usage_total["input_tokens"] / 1e6 * price[0] + usage_total["output_tokens"] / 1e6 * price[1], 4)
    ai = {"model": MODEL, "created_at": now_iso(), "summary": summary, "charts": chart_rows,
          "usage": usage_total, "est_cost_usd": cost}
    write_json(adir / "ai.json", ai)
    data_charts = [c for c in chart_rows if c.get("readable") and c.get("series")]
    return {
        "title_ja": summary.get("title_ja"), "summary_ja": summary.get("summary_ja"),
        "highlights_ja": (summary.get("highlights_ja") or [])[:6], "period": summary.get("period"),
        "chart_count": len(data_charts), "model": MODEL, "created_at": ai["created_at"],
        "est_cost_usd": cost,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="保存済み記事の日本語要約とグラフ数値の読み取り")
    ap.add_argument("--archive", default="archive")
    ap.add_argument("--ids", nargs="*", default=None, help="処理する記事ID（指定時は日付・件数の制限なし）")
    ap.add_argument("--force", action="store_true", help="処理済みでもやり直す")
    ap.add_argument("--no-charts", action="store_true", help="要約だけ作る")
    args = ap.parse_args(argv)

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY が設定されていないため、AI処理はスキップしました。")
        return 0

    archive = Archive(args.archive)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)).isoformat()
    todo = []
    for e in archive.index["articles"]:
        if args.ids is not None:
            if e["id"] in args.ids and (args.force or not e.get("ai")):
                todo.append(e)
            continue
        if e.get("ai") or int(e.get("ai_failures", 0)) >= MAX_FAILURES:
            continue
        if (e.get("published_at") or e.get("fetched_at") or "") < cutoff[:16]:
            continue
        todo.append(e)
    if args.ids is None:
        todo = todo[:MAX_ARTICLES]
    if not todo:
        print("AI処理の対象記事はありません。")
        return 0

    client = _client()
    done, total_cost = 0, 0.0
    for e in todo:
        charts = DO_CHARTS and not args.no_charts and e.get("topic") in CHART_TOPICS
        print(f"[AI] {e['id']} {e['title'][:40]}（グラフ読み取り: {'あり' if charts else 'なし'}）", flush=True)
        try:
            e["ai"] = process_article(client, archive, e, charts=charts)
            e.pop("ai_failures", None)
            e.pop("ai_error", None)
            done += 1
            total_cost += e["ai"].get("est_cost_usd") or 0
            print(f"    完了: グラフ{e['ai']['chart_count']}件 / 推定 ${e['ai'].get('est_cost_usd')}", flush=True)
        except Exception as ex:
            if _is_fatal(ex):
                # APIキーの誤り・残高不足などは記事のせいではないので、失敗回数に数えずに中断する
                archive.save_index()
                print(f"    中断: APIの設定に問題があります（{type(ex).__name__}: {str(ex)[:200]}）", flush=True)
                return 2
            e["ai_failures"] = int(e.get("ai_failures", 0)) + 1
            e["ai_error"] = f"{type(ex).__name__}: {ex}"[:300]
            print(f"    失敗: {e['ai_error']}", flush=True)
        archive.save_index()
    print(f"AI処理 完了 {done}/{len(todo)}件、推定費用 合計 ${round(total_cost, 3)}")
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path and done:
        with open(summary_path, "a", encoding="utf-8") as f:
            f.write(f"\nAI要約・グラフ読み取り: {done}件（推定費用 ${round(total_cost, 3)}、モデル {MODEL}）\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
