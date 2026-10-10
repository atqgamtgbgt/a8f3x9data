"""搜狐号（崔东树）から記事を取得するための関数群。

記事一覧は3段構えで取得する（上から順に試し、取れた時点で止める）:
  1. v2 author-articles API … 数値ID（崔東樹さんは 115312）で叩ける軽いAPI
  2. odin blockdata API     … プロフィールページ自体が使っている仕組み（RSSHub の実装を移植）
  3. RSSHub                 … 公開インスタンス、またはワークフロー内で起動した RSSHub

記事本文は記事ページ（https://www.sohu.com/a/<記事ID>_<作者ID>）を直接取得して解析する。
画像URLは data-src に AES で暗号化されて入っていることがあるので復号する
（鍵とアルゴリズムは RSSHub lib/routes/sohu/mp.tsx と同じ）。

注意: プロフィールページ（mp.sohu.com/profile）のHTMLに埋め込まれた記事一覧は
キャッシュで数週間古いことがあるため、一覧には使わない。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import random
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Iterable
from urllib.parse import urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup, NavigableString, Tag
from Crypto.Cipher import AES

CN_TZ = timezone(timedelta(hours=8))
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
MOBILE_USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)
IMAGE_KEY = b"www.sohu.com6666"          # 画像URL復号用（RSSHub と同じ）
ASID_SECRET = b"439642a904ef43d092d45509cdc4391c"  # odin API の asId 生成用
DEFAULT_SUV = "1612268936507kas0gk"

ARTICLE_URL_RE = re.compile(r"sohu\.com/a/(\d+)_(\d+)")


class ListError(Exception):
    """記事一覧の取得に失敗したことを表す。"""


@dataclass
class ListItem:
    """記事一覧の1件。"""

    article_id: str
    url: str
    title: str = ""
    published_at: str | None = None   # ISO8601（+08:00）。不明なら None
    method: str = ""                  # どの方法で取れたか
    fallback_html: str | None = None  # RSSHub が本文HTMLを返した場合の予備


@dataclass
class Article:
    """解析済みの記事。"""

    article_id: str
    author_id: str
    url: str
    title: str
    published_at: str | None
    blocks: list[dict] = field(default_factory=list)  # {"type": "text"|"image", ...}
    content_method: str = ""  # 本文をどの方法で見つけたか（調査用）
    raw_html: str | None = field(default=None, repr=False)  # 取得したHTML（調査用。article.json には保存しない）

    @property
    def image_urls(self) -> list[str]:
        return [b["src_url"] for b in self.blocks if b["type"] == "image" and b.get("src_url")]

    @property
    def missing_images(self) -> int:
        """本物の画像URLが見つからなかった図の数"""
        return sum(1 for b in self.blocks if b["type"] == "image" and not b.get("src_url"))

    @property
    def text(self) -> str:
        return "\n\n".join(b["text"] for b in self.blocks if b["type"] == "text")


# ---------------------------------------------------------------------------
# 共通ユーティリティ
# ---------------------------------------------------------------------------
def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT,
        "Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
    })
    return s


def canonical_article_url(url: str) -> tuple[str, str, str] | None:
    """記事URLから (記事ID, 作者ID, 正規化URL) を返す。記事URLでなければ None。"""
    if not url:
        return None
    if url.startswith("//"):
        url = "https:" + url
    elif not url.startswith("http"):
        url = "https://" + url.lstrip("/")
    m = ARTICLE_URL_RE.search(url)
    if not m:
        return None
    aid, author = m.group(1), m.group(2)
    return aid, author, f"https://www.sohu.com/a/{aid}_{author}"


def decrypt_image_url(cipher_text: str) -> str:
    """data-src に入っている暗号化済み画像URLを復号する（AES-128-ECB / PKCS7 / Base64）。"""
    raw = base64.b64decode(cipher_text.strip())
    plain = AES.new(IMAGE_KEY, AES.MODE_ECB).decrypt(raw)
    pad = plain[-1]
    if 1 <= pad <= 16 and plain.endswith(bytes([pad]) * pad):
        plain = plain[:-pad]
    return plain.decode("utf-8")


def normalize_image_url(value: str | None) -> str | None:
    """img の src / data-src の値から実際の画像URLを得る。使えない値なら None。"""
    if not value:
        return None
    v = value.strip()
    if not v or v.startswith("data:") or v in ("#", "about:blank"):
        return None
    if v.startswith("//"):
        return "https:" + v
    if v.startswith("http://") or v.startswith("https://"):
        return v
    # URLの形をしていなければ暗号化されているとみなして復号を試す
    try:
        dec = decrypt_image_url(v)
    except Exception:
        return None
    dec = dec.strip()
    if dec.startswith("//"):
        return "https:" + dec
    if dec.startswith("http://") or dec.startswith("https://"):
        return dec
    return None


def parse_datetime(value) -> str | None:
    """日時らしき値（ミリ秒タイムスタンプ、'2026-08-24 19:10'、RFC822など）を ISO8601(+08:00) に。"""
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (int, float)) or (isinstance(value, str) and re.fullmatch(r"\d{10,13}", value.strip())):
            n = int(value)
            if n > 10**12:
                n //= 1000
            return datetime.fromtimestamp(n, CN_TZ).isoformat(timespec="minutes")
        s = str(value).strip()
        m = re.match(r"(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?", s)
        if m:
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            hh = int(m.group(4) or 0)
            mm = int(m.group(5) or 0)
            tz = CN_TZ
            tzm = re.search(r"([+-])(\d{2}):?(\d{2})$|Z$", s)
            if tzm and tzm.group(0) == "Z":
                tz = timezone.utc
            elif tzm:
                sign = 1 if tzm.group(1) == "+" else -1
                tz = timezone(sign * timedelta(hours=int(tzm.group(2)), minutes=int(tzm.group(3))))
            dt = datetime(y, mo, d, hh, mm, tzinfo=tz).astimezone(CN_TZ)
            return dt.isoformat(timespec="minutes")
        dt = parsedate_to_datetime(s)  # RFC822（RSS の pubDate）
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=CN_TZ)
        return dt.astimezone(CN_TZ).isoformat(timespec="minutes")
    except Exception:
        return None


def _get(session: requests.Session, url: str, *, retries: int = 2, **kw) -> requests.Response:
    """GET（一時的な失敗は少し待って再試行）。"""
    last = None
    for i in range(retries + 1):
        try:
            r = session.get(url, timeout=kw.pop("timeout", 30), **kw)
            if r.status_code in (429, 500, 502, 503, 504) and i < retries:
                time.sleep(3 * (i + 1))
                continue
            return r
        except requests.RequestException as e:  # 通信エラー
            last = e
            if i < retries:
                time.sleep(3 * (i + 1))
    raise last  # type: ignore[misc]


# ---------------------------------------------------------------------------
# 一覧 1: v2 author-articles API
# ---------------------------------------------------------------------------
def list_via_v2(session: requests.Session, author_id: str, pages: int = 1) -> list[ListItem]:
    items: list[ListItem] = []
    for page in range(1, pages + 1):
        url = f"https://v2.sohu.com/author-page-api/author-articles/pc/{author_id}"
        params = {"pNo": page} if page > 1 else None
        r = _get(session, url, params=params, headers={"Referer": "https://mp.sohu.com/"})
        if r.status_code != 200:
            raise ListError(f"v2 API HTTP {r.status_code}")
        try:
            data = r.json()
        except ValueError as e:
            raise ListError(f"v2 API がJSONを返さない: {r.text[:120]!r}") from e
        vos = ((data or {}).get("data") or {}).get("pcArticleVOS") or []
        if not vos and page == 1:
            raise ListError(f"v2 API の記事リストが空: {str(data)[:200]}")
        for vo in vos:
            canon = canonical_article_url(vo.get("link") or vo.get("url") or "")
            if not canon and vo.get("id"):
                canon = (str(vo["id"]), author_id, f"https://www.sohu.com/a/{vo['id']}_{author_id}")
            if not canon:
                continue
            items.append(ListItem(
                article_id=canon[0], url=canon[2], title=(vo.get("title") or "").strip(),
                published_at=parse_datetime(vo.get("publicTime") or vo.get("publishTime")),
                method="v2",
            ))
        if not vos:
            break
    return _dedupe(items)


# ---------------------------------------------------------------------------
# 一覧 2: odin blockdata API（RSSHub lib/routes/sohu/mp.tsx の handler を移植）
# ---------------------------------------------------------------------------
def _rand(n: int, alphabet: str = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678") -> str:
    return "".join(random.choice(alphabet) for _ in range(n))


def _auth_token() -> str:
    t = str(int(time.time() * 1000))
    return "v1" + t + hmac.new(ASID_SECRET, ("t" + t).encode(), hashlib.sha1).hexdigest()


def _script_json(scripts: list[str], marker: str, pattern: str, pick_longest: bool = False):
    found = []
    for s in scripts:
        if marker in s:
            m = re.search(pattern, s)
            if m:
                found.append(m.group(1).strip().rstrip(";"))
    if not found:
        return None
    raw = max(found, key=len) if pick_longest else found[0]
    try:
        return json.loads(raw)
    except ValueError:
        return None


def list_via_odin(session: requests.Session, xpt: str) -> list[ListItem]:
    r = _get(session, "https://mp.sohu.com/profile", params={"xpt": xpt})
    if r.status_code != 200:
        raise ListError(f"profile HTTP {r.status_code}")
    suv = r.cookies.get("SUV") or ""
    soup = BeautifulSoup(r.text, "lxml")
    scripts = [s.get_text() or "" for s in soup.find_all("script")]

    cbd = _script_json(scripts, "CBDRenderConst", r"CBDRenderConst\s=\s(.*)") or {}
    content = _script_json(scripts, "contentData", r"contentData = (.*)", pick_longest=True) or {}
    block = _script_json(scripts, "column_2_text", r"(\{.*\})") or {}
    gconst = _script_json(scripts, "globalConst", r"globalConst\s=\s(.*)") or {}
    render_key = next((k for k in block if k.startswith("FeedSlideloadAuthor")), None)
    if not render_key:
        raise ListError("profile ページから FeedSlideloadAuthor が見つからない")
    render = block[render_key]["param"]
    req_param = render["data2"]["reqParam"]
    mkey = gconst.get("mkeyConst_mkey")
    if not mkey:
        raise ListError("profile ページから mkey が見つからない")
    now = int(time.time() * 1000)
    tpl_key = req_param.get("tplCompKey") or "FeedSlideloadAuthor_2_0_pc_1655965929143_data2"
    body = {
        "pvId": (cbd.get("COMMONCONFIG") or {}).get("pvId") or f"{now}_{_rand(7)}",
        "pageId": f"{now}_{DEFAULT_SUV[:-5]}_{_rand(3)}",
        "mainContent": {
            "productType": content.get("businessType") or "13",
            "productId": content.get("id") or "324",
            "secureScore": content.get("secureScore") or "5",
            "categoryId": content.get("categoryId") or "47",
            "adTags": content.get("adTags") or "11111111",
            "authorId": (content.get("account") or {}).get("id") or 121135924,
        },
        "resourceList": [{
            "tplCompKey": tpl_key,
            "isServerRender": req_param.get("isServerRender") or False,
            "isSingleAd": req_param.get("isSingleAd") or False,
            "configSource": req_param.get("configSource") or "mp",
            "content": {
                "productId": (req_param.get("content") or {}).get("productId") or "325",
                "productType": (req_param.get("content") or {}).get("productType") or "13",
                "size": 20,
                "pro": render.get("pro") or "0,1,3,4,5",
                "feedType": render.get("feedType") or "XTOPIC_SYNTHETICAL",
                "view": "operateFeedMode",
                "innerTag": (req_param.get("content") or {}).get("innerTag") or "work",
                "spm": (req_param.get("content") or {}).get("spm") or "smpc.channel_248.block3_308_hHsK47_2_fd",
                "page": 1,
                "requestId": f"{now}{_rand(7)}_{content.get('id')}",
            },
            "adInfo": {},
            "context": {"mkey": mkey},
        }],
        "asId": _auth_token(),
    }
    cookie = f"SUV={suv}; itssohu=true; reqtype=pc; t={now}"
    rr = session.post("https://odin.sohu.com/odin/api/blockdata", json=body,
                      headers={"Cookie": cookie, "Referer": r.url}, timeout=30)
    if rr.status_code != 200:
        raise ListError(f"odin API HTTP {rr.status_code}")
    data = rr.json()
    lst = (((data or {}).get("data") or {}).get(tpl_key) or {}).get("list") or []
    if not lst:
        raise ListError(f"odin API の記事リストが空: {str(data)[:200]}")
    items = []
    for it in lst:
        if not it.get("id"):
            continue
        aid = str(it["id"])
        items.append(ListItem(article_id=aid, url=f"https://www.sohu.com/a/{aid}_{mkey}",
                              title=(it.get("title") or "").strip(), method="odin"))
    return _dedupe(items)


# ---------------------------------------------------------------------------
# 一覧 3: RSSHub
# ---------------------------------------------------------------------------
def list_via_rsshub(session: requests.Session, instance: str, author_id: str) -> list[ListItem]:
    url = instance.rstrip("/") + f"/sohu/mp/{author_id}"
    r = _get(session, url, timeout=90, retries=1)
    if r.status_code != 200:
        raise ListError(f"RSSHub {instance} HTTP {r.status_code}")
    try:
        root = ET.fromstring(r.content)
    except ET.ParseError as e:
        raise ListError(f"RSSHub {instance} がRSSを返さない: {r.text[:120]!r}") from e
    items = []
    for it in root.iter("item"):
        link = (it.findtext("link") or "").strip()
        canon = canonical_article_url(link)
        if not canon:
            continue
        items.append(ListItem(
            article_id=canon[0], url=canon[2], title=(it.findtext("title") or "").strip(),
            published_at=parse_datetime(it.findtext("pubDate")), method=f"rsshub:{instance}",
            fallback_html=it.findtext("description") or None,
        ))
    if not items:
        raise ListError(f"RSSHub {instance} の記事リストが空")
    return _dedupe(items)


def _dedupe(items: Iterable[ListItem]) -> list[ListItem]:
    seen, out = set(), []
    for it in items:
        if it.article_id in seen:
            continue
        seen.add(it.article_id)
        out.append(it)
    return out


def list_articles(session: requests.Session, *, author_id: str, xpt: str,
                  rsshub_instances: list[str], pages: int = 1, log=print) -> tuple[list[ListItem], list[str]]:
    """一覧を取得する。戻り値は (記事リスト, 試した方法ごとのログ)。全滅なら ListError。"""
    attempts: list[str] = []
    methods = [("v2", lambda: list_via_v2(session, author_id, pages)),
               ("odin", lambda: list_via_odin(session, xpt))]
    methods += [(f"rsshub:{u}", (lambda u=u: list_via_rsshub(session, u, author_id))) for u in rsshub_instances]
    for name, fn in methods:
        try:
            items = fn()
            attempts.append(f"{name}: OK {len(items)}件")
            log(f"[一覧] {name}: {len(items)}件取得")
            return items, attempts
        except Exception as e:  # 次の方法へ
            attempts.append(f"{name}: NG {type(e).__name__}: {e}")
            log(f"[一覧] {name}: 失敗 ({type(e).__name__}: {e})")
    raise ListError(" / ".join(attempts))


# ---------------------------------------------------------------------------
# 記事本文の解析
# ---------------------------------------------------------------------------
_BLOCK_TAGS = ("p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "table", "figcaption")
_REMOVE_SELECTORS = ("#backsohucom", 'p[data-role="editor-name"]', ".original-title", ".lookall-box",
                     "script", "style", "noscript", "iframe", ".article-tags", ".statement")


def _clean_text(s: str) -> str:
    s = s.replace(" ", " ").replace("​", "").replace("﻿", "")
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\s*\n\s*", "\n", s)
    return s.strip()


# 遅延読み込み用の仮画像（本物の画像は別の属性に入っている）
_PLACEHOLDER_RE = re.compile(r"sohu-default|/appImage/|blank\.(gif|png)|loading\.(gif|png)|placeholder|lazy\.(gif|png)", re.I)
_LAZY_ATTRS = ("data-src", "data-original", "original", "data-url", "data-lazy-src", "lazy-src",
               "data-actualsrc", "data-echo", "data-lazyload", "data-img", "data-image")
_SKIP_ATTRS = {"src", "srcset", "class", "style", "alt", "title", "width", "height", "id", "loading", "decoding"}


def _img_src(img: Tag, base_url: str) -> str | None:
    """img から本物の画像URLを得る。仮画像しか無ければ None。"""
    tried = [img.get(a) for a in _LAZY_ATTRS]
    # 名前の分からない属性でも、画像URL（または暗号化された値）なら拾う
    tried += [v for k, v in img.attrs.items() if k not in _SKIP_ATTRS and k not in _LAZY_ATTRS and isinstance(v, str)]
    srcset = img.get("srcset")
    if srcset:
        tried.append(srcset.split(",")[0].strip().split(" ")[0])
    tried.append(img.get("src"))
    for value in tried:
        url = normalize_image_url(value)
        if url and not _PLACEHOLDER_RE.search(url) and _looks_like_image_url(url):
            return urljoin(base_url, url)
    return None


def _looks_like_image_url(url: str) -> bool:
    path = urlsplit(url).path.lower()
    return ("itc.cn" in url or "sohucs.com" in url or "sohu.com" in url
            or path.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp")))


def _table_text(tbl: Tag) -> str:
    rows = []
    for tr in tbl.find_all("tr"):
        cells = [_clean_text(td.get_text(" ")) for td in tr.find_all(["th", "td"])]
        if any(cells):
            rows.append(" | ".join(cells))
    return "\n".join(rows)


def extract_blocks(root: Tag, base_url: str) -> list[dict]:
    """本文要素から、文章と画像を出現順に並べたブロック列を作る。"""
    for sel in _REMOVE_SELECTORS:
        for el in root.select(sel):
            el.decompose()
    blocks: list[dict] = []
    seen_imgs: set[str] = set()

    def add_text(t: str):
        t = _clean_text(t)
        if not t:
            return
        if t in ("返回搜狐，查看更多", "返回搜狐,查看更多"):
            return
        if blocks and blocks[-1]["type"] == "text" and blocks[-1]["text"] == t:
            return
        blocks.append({"type": "text", "text": t})

    def add_img(img: Tag):
        src = _img_src(img, base_url)
        if not src:
            raw = (img.get("src") or "").strip()
            if raw and _PLACEHOLDER_RE.search(raw):
                # 仮画像しか無い図（本物の画像URLが見つからない）。図の位置だけ残して後で報告する
                blocks.append({"type": "image", "src_url": None, "placeholder": raw[:200], "alt": ""})
            return
        if src in seen_imgs:
            return
        # 1x1 のスペーサーやアイコンは除外
        try:
            w = int(img.get("width") or 0)
            h = int(img.get("height") or 0)
            if (w and w < 40) or (h and h < 40):
                return
        except ValueError:
            pass
        seen_imgs.add(src)
        blocks.append({"type": "image", "src_url": src, "alt": _clean_text(img.get("alt") or "")})

    def walk(node: Tag):
        for child in node.children:
            if isinstance(child, NavigableString):
                if child.strip() and node is root:
                    add_text(str(child))
                continue
            if not isinstance(child, Tag):
                continue
            name = child.name.lower()
            if name == "img":
                add_img(child)
            elif name == "table":
                add_text(_table_text(child))
            elif name in _BLOCK_TAGS:
                # 段落内の画像は段落の前後関係を保って出す
                imgs = child.find_all("img")
                if imgs:
                    buf = []
                    for sub in child.descendants:
                        if isinstance(sub, NavigableString):
                            if not any(p.name == "img" for p in sub.parents if isinstance(p, Tag)):
                                buf.append(str(sub))
                        elif isinstance(sub, Tag) and sub.name == "img":
                            add_text("".join(buf))
                            buf = []
                            add_img(sub)
                        elif isinstance(sub, Tag) and sub.name == "br":
                            buf.append("\n")
                    add_text("".join(buf))
                else:
                    for br in child.find_all("br"):
                        br.replace_with("\n")
                    add_text(child.get_text())
            else:
                walk(child)  # div / section / span などは中身を見る

    walk(root)
    return blocks


# 本文が入っている要素の目印（上から順に試す）。#articleContent はモバイル版ページの本文
# .content-main-detail は 2026年秋から一部の記事で使われている新しい作り（Vue）のページの本文
CONTENT_SELECTORS = ("#mp-editor", "article.article", ".content-main-detail", "#articleContent",
                     ".article-content", ".article-text", "article", ".article")
# 本文ではない部分（コメント欄・関連記事・ナビなど）に付きがちな class / id
_NOISE_RE = re.compile(r"comment|footer|nav|recommend|related|sidebar|share|copyright|rank|hot-|advert|banner|login|header",
                       re.I)


class ContentNotFound(ValueError):
    """記事ページから本文を見つけられなかった。原因調査用に取得したHTMLを持つ。"""

    def __init__(self, msg: str, html: str | None = None, mobile_html: str | None = None):
        super().__init__(msg)
        self.html = html
        self.mobile_html = mobile_html


# 確実に本文を指す目印。これで見つかった場合は短い記事（速報など）でも本文として扱う
RELIABLE_SELECTORS = {"#mp-editor", "article.article", ".content-main-detail", "#articleContent"}


def _blocks_ok(blocks: list[dict], strict: bool = True) -> bool:
    """本文として十分な中身があるか。曖昧な目印では、関連記事カードなどの小さな要素を拾わないよう厳しめに判定。"""
    text = sum(len(b["text"]) for b in blocks if b["type"] == "text")
    imgs = sum(1 for b in blocks if b["type"] == "image" and b.get("src_url"))
    if strict:
        return text >= 120 or imgs >= 2
    return text >= 10 or imgs >= 1


def _ident(el: Tag) -> str:
    return " ".join(el.get("class") or []) + " " + (el.get("id") or "")


def _densest(soup: BeautifulSoup) -> Tag | None:
    """段落の文字数と画像の数が最も集中している要素を本文とみなす（ページの作りが変わった時の保険）。"""
    scores: dict[int, int] = {}
    nodes: dict[int, Tag] = {}
    noise_cache: dict[int, bool] = {}

    def in_noise(el: Tag) -> bool:
        """コメント欄・おすすめ欄・ナビなどの中にある要素か（判定結果は祖先ごとに覚えておく）。"""
        chain = []
        result = False
        for anc in el.parents:
            if not isinstance(anc, Tag) or anc.name in ("body", "html", "[document]"):
                break
            if id(anc) in noise_cache:
                result = noise_cache[id(anc)]
                break
            chain.append(anc)
        # 外側（body寄り）から内側へ順に判定して記録する
        for anc in reversed(chain):
            result = result or anc.name in ("aside", "nav", "footer", "header") or bool(_NOISE_RE.search(_ident(anc)))
            noise_cache[id(anc)] = result
        return result

    def add(el: Tag, pts: int):
        if in_noise(el):
            return
        for anc in el.parents:
            if not isinstance(anc, Tag) or anc.name in ("html", "[document]"):
                break
            k = id(anc)
            scores[k] = scores.get(k, 0) + pts
            nodes[k] = anc

    for p in soup.find_all("p"):
        n = len(p.get_text(strip=True))
        if n:
            add(p, n)
    for img in soup.find_all("img"):
        add(img, 150)
    cands = [(sc, nodes[k]) for k, sc in scores.items()
             if nodes[k].name in ("article", "section", "div", "main", "td", "body") and not _NOISE_RE.search(_ident(nodes[k]))]
    if not cands:
        return None
    best_score, best = max(cands, key=lambda x: x[0])
    if best_score < 200:
        return None
    # 1つの子要素が大半を占める間は、その子へ降りていく（いちばん内側の本文の箱を見つける）
    while True:
        kids = [c for c in best.children if isinstance(c, Tag) and id(c) in scores]
        if not kids:
            break
        c = max(kids, key=lambda k: scores[id(k)])
        if scores[id(c)] >= 0.85 * best_score and c.name in ("article", "section", "div", "main", "td"):
            best, best_score = c, scores[id(c)]
        else:
            break
    return best


def _extract_content(html: str, base_url: str) -> tuple[list[dict] | None, str | None]:
    """HTMLから本文ブロックを取り出す。戻り値は (ブロック, 使った方法)。見つからなければ (None, None)。"""
    html = html.replace("\x00", "")
    soups = {}
    for parser in ("lxml", "html.parser"):
        soup = BeautifulSoup(html, parser)
        soups[parser] = soup
        for sel in CONTENT_SELECTORS:
            for el in soup.select(sel)[:3]:
                blocks = extract_blocks(el, base_url)
                if _blocks_ok(blocks, strict=sel not in RELIABLE_SELECTORS):
                    return blocks, f"{parser}:{sel}"
    for parser in ("lxml", "html.parser"):
        el = _densest(BeautifulSoup(html, parser))
        if el is not None:
            blocks = extract_blocks(el, base_url)
            if _blocks_ok(blocks):
                return blocks, f"{parser}:densest({el.name}.{'.'.join(el.get('class') or [])}#{el.get('id') or ''})"
    return None, None


def _diagnose(html: str, final_url: str = "") -> str:
    """本文が見つからなかった時の手がかり（ログ・実行記録に残す）。"""
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.S | re.I)
    title = _clean_text(m.group(1))[:40] if m else "-"
    return (f"len={len(html)} title={title} mp-editor={'mp-editor' in html} "
            f"articleContent={'articleContent' in html} article_tags={html.lower().count('<article')} "
            f"p_tags={html.lower().count('<p')} url={final_url}")


def _decode(r: requests.Response) -> str:
    r.encoding = r.apparent_encoding if not r.encoding or r.encoding.lower() == "iso-8859-1" else r.encoding
    return r.text


def parse_article_html(html: str, url: str) -> Article:
    canon = canonical_article_url(url)
    if not canon:
        raise ValueError(f"記事URLではありません: {url}")
    aid, author, curl = canon
    soup = BeautifulSoup(html.replace("\x00", ""), "lxml")

    def meta(*selectors):
        for sel in selectors:
            el = soup.select_one(sel)
            if el and (el.get("content") or "").strip():
                return el["content"].strip()
        return None

    title = meta('meta[property="og:title"]', 'meta[name="og:title"]')
    if not title:
        h1 = soup.select_one(".text-title h1, h1, h3.content-main--title")
        title = _clean_text(h1.get_text()) if h1 else ""
    if not title and soup.title:
        title = re.sub(r"_(搜狐\S*|搜狐网)$", "", _clean_text(soup.title.get_text()))
    title = re.sub(r"_搜狐\S*$", "", title).strip()

    published = None
    for cand in (meta('meta[itemprop="datePublished"]'), meta('meta[property="og:release_date"]'),
                 meta('meta[name="publishdate"]'), meta('meta[itemprop="dateUpdate"]')):
        published = parse_datetime(cand)
        if published:
            break
    if not published:
        t = soup.select_one("#news-time")
        if t is not None:
            published = parse_datetime(t.get("data-val")) or parse_datetime(t.get_text())
    if not published:
        t = soup.select_one(".article-info .time, span.time, .content-main-desc--time, .time, #videoPublicTime")
        if t is not None:
            published = parse_datetime(t.get_text())

    blocks, method = _extract_content(html, curl)
    if not blocks:
        raise ContentNotFound("本文が見つかりません（" + _diagnose(html) + "）", html=html)
    art = Article(article_id=aid, author_id=author, url=curl, title=title,
                  published_at=published, blocks=blocks)
    art.content_method = method
    art.raw_html = html
    return art


def parse_fallback_html(fragment: str, item: ListItem) -> Article:
    """RSSHub が返した本文HTML（description）から記事を組み立てる（記事ページが取れない時の予備）。"""
    canon = canonical_article_url(item.url)
    assert canon
    soup = BeautifulSoup(f"<div id='rss-body'>{fragment}</div>", "lxml")
    blocks = extract_blocks(soup.select_one("#rss-body"), canon[2])
    if not blocks:
        raise ValueError("RSS本文が空です")
    art = Article(article_id=canon[0], author_id=canon[1], url=canon[2], title=item.title,
                  published_at=item.published_at, blocks=blocks)
    art.content_method = "rsshub"
    return art


def fetch_article(session: requests.Session, item: ListItem) -> Article:
    """記事ページ（PC版）から本文を取る。取れなければモバイル版ページで取り直す。"""
    r = _get(session, item.url, headers={"Referer": "https://mp.sohu.com/"})
    if r.status_code != 200:
        raise RuntimeError(f"記事ページ HTTP {r.status_code}")
    html = _decode(r)
    try:
        art = parse_article_html(html, item.url)
        art.content_method = "pc:" + art.content_method
    except ContentNotFound as e_pc:
        canon = canonical_article_url(item.url)
        murl = f"https://m.sohu.com/a/{canon[0]}_{canon[1]}"
        r2 = _get(session, murl, headers={"User-Agent": MOBILE_USER_AGENT, "Referer": "https://m.sohu.com/"})
        if r2.status_code != 200:
            raise ContentNotFound(f"PC版: {e_pc} / モバイル版: HTTP {r2.status_code}", html=html) from None
        mhtml = _decode(r2)
        try:
            art = parse_article_html(mhtml, item.url)
        except ContentNotFound as e_m:
            raise ContentNotFound(f"PC版: {e_pc} / モバイル版: {e_m}", html=html, mobile_html=mhtml) from None
        art.content_method = "mobile:" + art.content_method
        # タイトル・日時はPC版のメタ情報の方が確実なので、取れていればそちらを使う
        pc_soup = BeautifulSoup(html.replace("\x00", ""), "lxml")
        og = pc_soup.select_one('meta[property="og:title"]')
        if og and (og.get("content") or "").strip():
            art.title = re.sub(r"_搜狐\S*$", "", og["content"].strip())
    if r.url and "sohu.com" in r.url and canonical_article_url(r.url) is None:
        art.content_method += f" (redirect: {r.url[:80]})"
    if not art.title:
        art.title = item.title
    if not art.published_at:
        art.published_at = item.published_at
    return art


def download_image(session: requests.Session, url: str) -> tuple[bytes, str]:
    """画像をダウンロードして (バイト列, 拡張子) を返す。"""
    r = _get(session, url, headers={"Referer": "https://www.sohu.com/"}, timeout=60)
    if r.status_code != 200 or not r.content:
        raise RuntimeError(f"画像 HTTP {r.status_code}")
    ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    ext = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif",
           "image/webp": "webp"}.get(ctype)
    if not ext:
        head = r.content[:12]
        if head.startswith(b"\x89PNG"):
            ext = "png"
        elif head[:3] == b"\xff\xd8\xff":
            ext = "jpg"
        elif head[:4] == b"RIFF" and head[8:12] == b"WEBP":
            ext = "webp"
        elif head[:3] == b"GIF":
            ext = "gif"
        else:
            path = urlsplit(url).path.lower()
            ext = next((e for e in ("png", "jpeg", "jpg", "webp", "gif") if path.endswith("." + e)), None)
            ext = {"jpeg": "jpg"}.get(ext, ext)
            if not ext:
                raise RuntimeError(f"画像ではないデータ（{ctype or '不明'}）")
    return r.content, ext


def strip_query(url: str) -> str:
    p = urlsplit(url)
    return urlunsplit((p.scheme, p.netloc, p.path, "", ""))
