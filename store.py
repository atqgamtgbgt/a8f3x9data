"""取得した記事の保存先（cds-archive ブランチ）の読み書き。

保存構成:
  cds/index.json                         … 記事一覧（新しい順）。ダッシュボードはこれを読む
  cds/run_log.json                       … 直近の実行記録（どの方法で取れたか・失敗内容）
  cds/articles/YYYY/MM/<記事ID>/article.json … 本文（文章と画像の並び）と付帯情報
  cds/articles/YYYY/MM/<記事ID>/content.md   … 人やAIが読みやすいMarkdown版
  cds/articles/YYYY/MM/<記事ID>/img/01.jpg … 記事内の画像（グラフ）
  cds/articles/YYYY/MM/<記事ID>/ai.json      … AIによる日本語要約・グラフ数値（任意）
"""
from __future__ import annotations

import io
import json
import os
from datetime import datetime, timezone
from pathlib import Path

INDEX_VERSION = 1
SOURCE_INFO = {
    "name": "崔东树（搜狐号）",
    "profile_url": "https://mp.sohu.com/profile?xpt=Y3VpZG9uZ3NodUBzb2h1LmNvbQ==",
    "author_id": "115312",
}
MAX_IMAGE_BYTES = 800_000  # これより大きい画像は JPEG に再圧縮して保存する
LATEST_COUNT = 60          # latest.json（ダッシュボードが読む軽量版）に載せる件数
ARCHIVE_README = """# 崔東樹 記事アーカイブ（自動取得）

このブランチは GitHub Actions（.github/workflows/cds-fetch.yml）が自動で更新します。手で編集しないでください。

- `cds/index.json` … 記事一覧（新しい順・全件）
- `cds/latest.json` … 直近60件だけの軽量版。ダッシュボードの「最新記事」はこれを読みます
- `cds/articles/年/月/記事ID/content.md` … 本文と図（人が読む用）
- `cds/articles/年/月/記事ID/article.json` … 本文と図の並び（プログラム用）
- `cds/articles/年/月/記事ID/img/` … 図の画像
- `cds/articles/年/月/記事ID/ai.json` … AIによる日本語要約・グラフの数値表（APIキー登録時のみ）
- `cds/run_log.json` … 直近の実行記録

出典: 崔东树（搜狐号） https://mp.sohu.com/profile?xpt=Y3VpZG9uZ3NodUBzb2h1LmNvbQ==
著作権は原著作者に帰属します。
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def read_json(path: Path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, path)


class Archive:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.index_path = self.root / "cds" / "index.json"
        self.log_path = self.root / "cds" / "run_log.json"
        self.index = read_json(self.index_path, None) or {
            "version": INDEX_VERSION, "source": SOURCE_INFO, "updated_at": None,
            "articles": [], "failed": {},
        }
        self.index.setdefault("failed", {})
        self.index.setdefault("articles", [])

    # ---- 一覧 ------------------------------------------------------------
    def known_ids(self) -> set[str]:
        return {a["id"] for a in self.index["articles"]}

    def entry(self, article_id: str) -> dict | None:
        return next((a for a in self.index["articles"] if a["id"] == article_id), None)

    def upsert(self, entry: dict) -> None:
        arts = [a for a in self.index["articles"] if a["id"] != entry["id"]]
        arts.append(entry)
        arts.sort(key=lambda a: (a.get("published_at") or a.get("fetched_at") or ""), reverse=True)
        self.index["articles"] = arts
        self.index["failed"].pop(entry["id"], None)

    def record_failure(self, article_id: str, url: str, error: str) -> int:
        f = self.index["failed"].get(article_id) or {"url": url, "tries": 0}
        f["tries"] = int(f.get("tries", 0)) + 1
        f["error"] = error[:500]
        f["last_try"] = now_iso()
        self.index["failed"][article_id] = f
        return f["tries"]

    def save_index(self) -> None:
        self.index["version"] = INDEX_VERSION
        self.index["source"] = SOURCE_INFO
        self.index["updated_at"] = now_iso()
        write_json(self.index_path, self.index)
        # ダッシュボード用の軽量版（直近 LATEST_COUNT 件だけ）
        write_json(self.root / "cds" / "latest.json", {
            "version": INDEX_VERSION, "source": SOURCE_INFO, "updated_at": self.index["updated_at"],
            "total": len(self.index["articles"]), "articles": self.index["articles"][:LATEST_COUNT],
        })
        readme = self.root / "README.md"
        if not readme.exists():
            readme.write_text(ARCHIVE_README, encoding="utf-8")

    def append_log(self, record: dict, keep: int = 60) -> None:
        log = read_json(self.log_path, [])
        log.insert(0, record)
        write_json(self.log_path, log[:keep])

    # ---- 記事フォルダ ------------------------------------------------------
    def article_dir(self, article_id: str, published_at: str | None) -> Path:
        stamp = (published_at or now_iso())[:7]  # 'YYYY-MM'
        y, m = stamp.split("-")[:2]
        return self.root / "cds" / "articles" / y / m / article_id

    def rel(self, p: Path) -> str:
        return p.relative_to(self.root).as_posix()


def shrink_image(data: bytes, ext: str) -> tuple[bytes, str]:
    """大きすぎる画像だけ JPEG(品質85) に再圧縮する。Pillow が無ければそのまま。"""
    if len(data) <= MAX_IMAGE_BYTES or ext == "gif":
        return data, ext
    try:
        from PIL import Image
    except ImportError:
        return data, ext
    try:
        im = Image.open(io.BytesIO(data))
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGB", im.size, (255, 255, 255))
            bg.paste(im, mask=im.split()[-1])
            im = bg
        elif im.mode != "RGB":
            im = im.convert("RGB")
        out = io.BytesIO()
        im.save(out, "JPEG", quality=85, optimize=True, progressive=True)
        if out.tell() < len(data):
            return out.getvalue(), "jpg"
    except Exception:
        pass
    return data, ext


def image_size(data: bytes) -> tuple[int, int] | None:
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as im:
            return im.size
    except Exception:
        return None
