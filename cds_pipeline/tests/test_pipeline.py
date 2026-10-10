"""cds_pipeline のテスト。搜狐へは接続せず、模擬レスポンスで一連の流れを確かめる。

実行: python -m pytest cds_pipeline/tests -q
"""
from __future__ import annotations

import base64
import io
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from Crypto.Cipher import AES

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import ai  # noqa: E402
import fetch  # noqa: E402
import sohu  # noqa: E402
import topics  # noqa: E402


# ---------------------------------------------------------------------------
# 補助
# ---------------------------------------------------------------------------
def encrypt(url: str) -> str:
    data = url.encode()
    pad = 16 - len(data) % 16
    data += bytes([pad]) * pad
    return base64.b64encode(AES.new(sohu.IMAGE_KEY, AES.MODE_ECB).encrypt(data)).decode()


def png_bytes(w=320, h=200, color=(30, 120, 200)) -> bytes:
    from PIL import Image
    out = io.BytesIO()
    Image.new("RGB", (w, h), color).save(out, "PNG")
    return out.getvalue()


class FakeResponse:
    def __init__(self, status=200, text="", content=None, headers=None, url="", cookies=None):
        self.status_code = status
        self._text = text
        self.content = content if content is not None else text.encode("utf-8")
        self.headers = headers or {}
        self.url = url
        self.cookies = cookies or {}
        self.encoding = "utf-8"
        self.apparent_encoding = "utf-8"

    @property
    def text(self):
        return self._text if self._text else self.content.decode("utf-8", "replace")

    def json(self):
        return json.loads(self.text)


class FakeSession:
    """URLの前方一致で応答を返す。呼び出し履歴を calls に残す。"""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []
        self.headers = {}

    def _match(self, method, url, **kw):
        self.calls.append((method, url, kw))
        for prefix, handler in self.routes:
            if url.startswith(prefix):
                res = handler(url, kw) if callable(handler) else handler
                if isinstance(res, FakeResponse):
                    res.url = res.url or url
                return res
        return FakeResponse(404, "not found", url=url)

    def get(self, url, **kw):
        return self._match("GET", url, **kw)

    def post(self, url, **kw):
        return self._match("POST", url, **kw)


IMG1 = "https://q4.itc.cn/q_70/images03/20260919/aaa111.jpeg"
IMG2 = "https://q5.itc.cn/q_70/images03/20260919/bbb222.png"
IMG3 = "https://q2.itc.cn/q_70/images03/20260919/ccc333.jpeg"

ARTICLE_A = f"""<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>1-8月中国汽车出口745万辆增51%_搜狐汽车_搜狐网</title>
<meta property="og:title" content="1-8月中国汽车出口745万辆增51%，全年预计近1200万辆">
<meta itemprop="dateUpdate" content="2026-09-18 19:10">
</head><body>
<div class="text-title"><h1>1-8月中国汽车出口745万辆增51%</h1></div>
<article class="article" id="mp-editor">
  <p>2026年1-8月中国汽车实现出口745万辆，同比增速51%。</p>
  <p><img data-src="{encrypt(IMG1)}" alt=""></p>
  <p>一、汽车出口总体特征<br>8月中国汽车实现出口105万辆，同比增37%。</p>
  <p>前文<img src="//q5.itc.cn/q_70/images03/20260919/bbb222.png">后文</p>
  <table><tr><th>国家</th><th>万辆</th></tr><tr><td>俄罗斯</td><td>63.8</td></tr></table>
  <p><img data-src="{encrypt(IMG1)}"></p>
  <p><img src="https://example.com/spacer.gif" width="1" height="1"></p>
  <p data-role="editor-name">责任编辑：</p>
  <a id="backsohucom" href="#">返回搜狐，查看更多</a>
</article></body></html>"""

ARTICLE_B = f"""<html><head><title>车市扫描-2026年36期（9月14日-9月19日）_搜狐汽车_搜狐网</title></head>
<body><div class="text-title"><h1> 车市扫描-2026年36期（9月14日-9月19日） </h1></div>
<span class="time" id="news-time" data-val="1758283800000">2025-09-19 20:10</span>
<article class="article"><section><p>一、9月车市</p><div><img src="{IMG3}"></div><p>零售同比下降。</p></section></article>
</body></html>"""


def v2_json(ids_titles):
    return json.dumps({"code": 200, "data": {"pcArticleVOS": [
        {"title": t, "link": f"www.sohu.com/a/{i}_115312?scm=1.2.3", "publicTime": ts}
        for i, t, ts in ids_titles]}})


def make_routes(article_a_status=200, v2_status=200):
    img_png = png_bytes()
    return [
        ("https://v2.sohu.com/author-page-api/author-articles/pc/115312",
         lambda u, kw: FakeResponse(v2_status, v2_json([
             ("1081000001", "1-8月中国汽车出口745万辆增51%", 1758193800000),
             ("1080113775", "车市扫描-2026年36期（9月14日-9月19日）", 1758283800000)]))),
        ("https://www.sohu.com/a/1081000001_115312", lambda u, kw: FakeResponse(article_a_status, ARTICLE_A)),
        ("https://www.sohu.com/a/1080113775_115312", FakeResponse(200, ARTICLE_B)),
        (IMG1, FakeResponse(200, content=b"\xff\xd8\xff\xe0fakejpeg", headers={"Content-Type": "image/jpeg"})),
        (IMG2, FakeResponse(200, content=img_png, headers={"Content-Type": "image/png"})),
        (IMG3, FakeResponse(200, content=img_png, headers={"Content-Type": "application/octet-stream"})),
    ]


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    monkeypatch.setattr(fetch.time, "sleep", lambda s: None)
    monkeypatch.setattr(sohu.time, "sleep", lambda s: None)
    monkeypatch.setattr(ai.time, "sleep", lambda s: None)
    for k in ("GITHUB_OUTPUT", "GITHUB_STEP_SUMMARY"):
        monkeypatch.delenv(k, raising=False)


# ---------------------------------------------------------------------------
# 画像URLの復号
# ---------------------------------------------------------------------------
def test_decrypt_roundtrip():
    assert sohu.decrypt_image_url(encrypt(IMG1)) == IMG1


@pytest.mark.skipif(shutil.which("node") is None, reason="node が無い")
def test_decrypt_matches_cryptojs():
    """RSSHub と同じ CryptoJS で暗号化したものを Python で復号でき、その逆も一致する。"""
    js = HERE / "cryptojs_check.js"
    env = dict(os.environ, NODE_PATH=os.environ.get("NODE_PATH", "/home/claude/libs/node_modules"))
    try:
        enc = subprocess.run(["node", str(js), "encrypt", IMG2], capture_output=True, text=True, env=env, check=True).stdout
    except subprocess.CalledProcessError as e:
        pytest.skip(f"crypto-js が使えない: {e.stderr[:100]}")
    assert sohu.decrypt_image_url(enc) == IMG2
    dec = subprocess.run(["node", str(js), "decrypt", encrypt(IMG3)], capture_output=True, text=True, env=env, check=True).stdout
    assert dec == IMG3


def test_normalize_image_url():
    assert sohu.normalize_image_url("//q1.itc.cn/a.png") == "https://q1.itc.cn/a.png"
    assert sohu.normalize_image_url(IMG1) == IMG1
    assert sohu.normalize_image_url(encrypt(IMG1)) == IMG1
    assert sohu.normalize_image_url("data:image/gif;base64,R0lGOD") is None
    assert sohu.normalize_image_url("not-a-cipher!!") is None
    assert sohu.normalize_image_url("") is None


# ---------------------------------------------------------------------------
# 記事の解析
# ---------------------------------------------------------------------------
def test_parse_article_modern():
    art = sohu.parse_article_html(ARTICLE_A, "https://www.sohu.com/a/1081000001_115312?scm=x")
    assert art.article_id == "1081000001" and art.author_id == "115312"
    assert art.title == "1-8月中国汽车出口745万辆增51%，全年预计近1200万辆"
    assert art.published_at == "2026-09-18T19:10+08:00"
    kinds = [b["type"] for b in art.blocks]
    assert kinds == ["text", "image", "text", "text", "image", "text", "text"], art.blocks
    assert art.image_urls == [IMG1, IMG2]           # 重複画像とスペーサーは除外
    assert "一、汽车出口总体特征\n8月中国汽车实现出口105万辆" in art.text
    assert "俄罗斯 | 63.8" in art.text
    assert "责任编辑" not in art.text and "返回搜狐" not in art.text


def test_parse_article_older_layout():
    art = sohu.parse_article_html(ARTICLE_B, "https://www.sohu.com/a/1080113775_115312")
    assert art.title == "车市扫描-2026年36期（9月14日-9月19日）"
    assert art.published_at == "2025-09-19T20:10+08:00"   # data-val（ミリ秒）から
    assert [b["type"] for b in art.blocks] == ["text", "image", "text"]


def test_parse_datetime_formats():
    assert sohu.parse_datetime("2026-08-24 19:10") == "2026-08-24T19:10+08:00"
    assert sohu.parse_datetime("2026年8月24日 19:10") == "2026-08-24T19:10+08:00"
    assert sohu.parse_datetime("2026-08-24T11:10:00Z") == "2026-08-24T19:10+08:00"
    assert sohu.parse_datetime("Mon, 24 Aug 2026 11:10:00 GMT") == "2026-08-24T19:10+08:00"
    assert sohu.parse_datetime(1787570400000) == "2026-08-24T19:20+08:00"
    assert sohu.parse_datetime("") is None and sohu.parse_datetime("昨天") is None


# ---------------------------------------------------------------------------
# 一覧の取得
# ---------------------------------------------------------------------------
def test_list_v2():
    s = FakeSession(make_routes())
    items = sohu.list_via_v2(s, "115312")
    assert [i.article_id for i in items] == ["1081000001", "1080113775"]
    assert items[0].url == "https://www.sohu.com/a/1081000001_115312"
    assert items[0].published_at == "2025-09-18T19:10+08:00"


def test_list_v2_empty_raises():
    s = FakeSession([("https://v2.sohu.com/", FakeResponse(200, json.dumps({"data": {"pcArticleVOS": []}})))])
    with pytest.raises(sohu.ListError):
        sohu.list_via_v2(s, "115312")


def test_list_rsshub():
    rss = f"""<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>搜狐号 - 崔东树</title>
    <item><title>2026年8月乘用车市场价格段跟踪</title><link>https://www.sohu.com/a/1075519389_115312</link>
    <pubDate>Tue, 15 Sep 2026 12:00:00 GMT</pubDate><description><![CDATA[<p>正文</p><img src="{IMG1}">]]></description></item>
    </channel></rss>"""
    s = FakeSession([("http://localhost:1200/sohu/mp/115312", FakeResponse(200, rss))])
    items = sohu.list_via_rsshub(s, "http://localhost:1200", "115312")
    assert items[0].article_id == "1075519389" and items[0].published_at == "2026-09-15T20:00+08:00"
    art = sohu.parse_fallback_html(items[0].fallback_html, items[0])
    assert art.image_urls == [IMG1] and art.title == "2026年8月乘用车市场价格段跟踪"


def test_list_odin_port():
    """RSSHub の odin 実装を移植した部分が、想定どおりの値を読み取り・送信できるか。"""
    block = {"FeedSlideloadAuthor_2_0_pc_X": {"param": {
        "pro": "0,1,3,4,5", "feedType": "XTOPIC_SYNTHETICAL",
        "data2": {"reqParam": {"tplCompKey": "FeedSlideloadAuthor_2_0_pc_X_data2", "configSource": "mp",
                               "content": {"productId": "325", "productType": "13", "innerTag": "work",
                                           "spm": "smpc.x"}}}}},
             "BriefIntroductionCard_1": {"param": {"data": {"list": [{"column_9_text": "intro"}]}}},
             "column_2_text": "x"}
    profile = f"""<html><head><script>var CBDRenderConst = {json.dumps({"COMMONCONFIG": {"pvId": "PV1"}})}
</script><script>window.contentData = {json.dumps({"id": "324", "businessType": "13", "account": {"id": 999}})}
</script><script>var blockRenderData = {json.dumps(block)}
</script><script>var globalConst = {json.dumps({"mkeyConst_mkey": "115312", "title": "崔东树"})}
</script></head></html>"""
    posted = {}

    def odin(url, kw):
        posted.update(kw)
        return FakeResponse(200, json.dumps({"data": {"FeedSlideloadAuthor_2_0_pc_X_data2": {"list": [
            {"id": 1082222222, "title": "测试", "brief": "b"}]}}}))

    class Cookies(dict):
        pass

    s = FakeSession([("https://mp.sohu.com/profile", FakeResponse(200, profile, cookies=Cookies(SUV="SUV123"))),
                     ("https://odin.sohu.com/odin/api/blockdata", odin)])
    items = sohu.list_via_odin(s, "Y3VpZG9uZ3NodUBzb2h1LmNvbQ==")
    assert items[0].url == "https://www.sohu.com/a/1082222222_115312"
    body = posted["json"]
    assert body["pvId"] == "PV1" and body["mainContent"]["authorId"] == 999
    assert body["resourceList"][0]["tplCompKey"] == "FeedSlideloadAuthor_2_0_pc_X_data2"
    assert body["resourceList"][0]["context"]["mkey"] == "115312"
    assert body["asId"].startswith("v1") and len(body["asId"]) == 2 + 13 + 40
    assert "SUV=SUV123" in posted["headers"]["Cookie"]


def test_list_articles_falls_back_in_order():
    rss = """<rss><channel><item><title>t</title><link>https://www.sohu.com/a/1_115312</link></item></channel></rss>"""
    s = FakeSession([("https://v2.sohu.com/", FakeResponse(403, "forbidden")),
                     ("https://mp.sohu.com/profile", FakeResponse(500, "err")),
                     ("https://rsshub.example/sohu/mp/115312", FakeResponse(200, rss))])
    items, attempts = sohu.list_articles(s, author_id="115312", xpt="x",
                                         rsshub_instances=["https://rsshub.example"], log=lambda m: None)
    assert items[0].method == "rsshub:https://rsshub.example"
    assert attempts[0].startswith("v2: NG") and attempts[1].startswith("odin: NG")


# ---------------------------------------------------------------------------
# 取得〜保存の一連の流れ
# ---------------------------------------------------------------------------
def run_fetch(monkeypatch, tmp_path, routes, *args):
    session = FakeSession(routes)
    monkeypatch.setattr(sohu, "make_session", lambda: session)
    code = fetch.main(["--archive", str(tmp_path), "--rsshub", *args])
    return code, session


def test_fetch_end_to_end(monkeypatch, tmp_path):
    out = tmp_path / "gh_output.txt"
    summary = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary))
    code, session = run_fetch(monkeypatch, tmp_path, make_routes())
    assert code == 0
    index = json.loads((tmp_path / "cds/index.json").read_text(encoding="utf-8"))
    ids = [a["id"] for a in index["articles"]]
    assert ids == ["1081000001", "1080113775"]          # 新しい順
    a = index["articles"][0]
    assert a["topic"] == "export" and a["topic_label"] == "輸出"
    assert a["path"] == "cds/articles/2026/09/1081000001"
    assert a["image_count"] == 2 and a["images_saved"] == 2
    assert a["thumb"] == "cds/articles/2026/09/1081000001/img/01.jpg"
    adir = tmp_path / a["path"]
    assert (adir / "img/01.jpg").read_bytes().startswith(b"\xff\xd8\xff")
    assert (adir / "img/02.png").exists()
    rec = json.loads((adir / "article.json").read_text(encoding="utf-8"))
    img_blocks = [b for b in rec["blocks"] if b["type"] == "image"]
    assert img_blocks[1]["width"] == 320 and img_blocks[1]["height"] == 200
    md = (adir / "content.md").read_text(encoding="utf-8")
    assert md.startswith("# 1-8月中国汽车出口745万辆增51%") and "![図1](img/01.jpg)" in md
    b = index["articles"][1]
    assert b["topic"] == "market_scan"
    assert (tmp_path / b["path"] / "img/01.png").exists()   # Content-Type 不明でも中身から判定
    assert "new_count=2" in out.read_text()
    assert "| 輸出 |" in summary.read_text(encoding="utf-8")
    log = json.loads((tmp_path / "cds/run_log.json").read_text(encoding="utf-8"))
    assert log[0]["ok"] and log[0]["list_method"] == "v2"
    latest = json.loads((tmp_path / "cds/latest.json").read_text(encoding="utf-8"))
    assert latest["total"] == 2 and [a["id"] for a in latest["articles"]] == ids

    # 2回目: 新着なし → 何も取りに行かない
    code, session = run_fetch(monkeypatch, tmp_path, make_routes())
    assert code == 0
    assert not any("www.sohu.com/a/" in c[1] for c in session.calls)


def test_fetch_retries_failed_article(monkeypatch, tmp_path):
    code, _ = run_fetch(monkeypatch, tmp_path, make_routes(article_a_status=500))
    assert code == 0
    index = json.loads((tmp_path / "cds/index.json").read_text(encoding="utf-8"))
    assert [a["id"] for a in index["articles"]] == ["1080113775"]
    assert index["failed"]["1081000001"]["tries"] == 1
    # 次の実行で取れれば failed から消える
    code, _ = run_fetch(monkeypatch, tmp_path, make_routes())
    index = json.loads((tmp_path / "cds/index.json").read_text(encoding="utf-8"))
    assert [a["id"] for a in index["articles"]] == ["1081000001", "1080113775"]
    assert index["failed"] == {}


def test_fetch_gives_up_after_max_tries(monkeypatch, tmp_path):
    for _ in range(fetch.MAX_TRIES):
        run_fetch(monkeypatch, tmp_path, make_routes(article_a_status=500))
    _, session = run_fetch(monkeypatch, tmp_path, make_routes(article_a_status=500))
    assert not any(c[1].startswith("https://www.sohu.com/a/1081000001") for c in session.calls)


def test_fetch_list_failure_exit_code(monkeypatch, tmp_path):
    out = tmp_path / "o.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    code, _ = run_fetch(monkeypatch, tmp_path, [("https://", FakeResponse(503, "down"))])
    assert code == 3
    assert "list_ok=false" in out.read_text()


def test_fetch_manual_urls(monkeypatch, tmp_path):
    session = FakeSession(make_routes())
    monkeypatch.setattr(sohu, "make_session", lambda: session)
    code = fetch.main(["--archive", str(tmp_path), "--urls",
                       "https://www.sohu.com/a/1080113775_115312?spm=1", "https://example.com/nope"])
    assert code == 0
    index = json.loads((tmp_path / "cds/index.json").read_text(encoding="utf-8"))
    assert [a["id"] for a in index["articles"]] == ["1080113775"]
    assert not any("v2.sohu.com" in c[1] for c in session.calls)


# ---------------------------------------------------------------------------
# テーマ判定
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("title,key", [
    ("1-7月中国汽车出口641万辆增54%，全年预计1200万辆", "export"),
    ("2026年8月乘用车市场价格段跟踪", "price"),
    ("2026年8月新能源车区域市场分析", "region"),
    ("车市扫描-2026年36期（9月14日-9月19日）", "market_scan"),
    ("全国商用车国内保险特征—7月重卡新能源渗透率48%", "commercial"),
    ("2026年房地产市场量价分析", "commentary"),
    ("2026年1-7月世界新能源车分析", "world"),
    ("427万辆车企集中召回：新能源汽车颜值迭代下的安全底线重塑", "commentary"),
    ("2026年1-5月中国汽车出口海外自主品牌数据跟踪", "overseas"),
    ("2026年1-5月锂电池出口分析", "battery_export"),
    ("锂电池消费税的调整——整车企业造电池的强力推动", "battery"),
    ("全国乘用车行业2026年6月末库存343万辆", "inventory"),
    ("2026年7月汽车生产降1%，消费增0.4%", "stats"),
    ("2020-2025年世界汽车上市公司综合运营特征分析", "world_finance"),
    ("2026年1-5月中国占世界汽车份额31%", "world"),
    ("2025年燃油+新能源双积分效果良好", "dual_credit"),
    ("2026年3月乘用车市场降价促销分析", "discount"),
    ("2026年4月中国汽车进口2.7万台", "import"),
    ("2026年4月新能源车新品与技术路线跟踪", "nev_products"),
    ("2026年7月全国乘用车市场运行特征", "market"),
    ("哲学的思考", "other"),
])
def test_classify(title, key):
    assert topics.classify(title)[0] == key


# ---------------------------------------------------------------------------
# AI処理（API は模擬）
# ---------------------------------------------------------------------------
class _Block:
    def __init__(self, name, data):
        self.type, self.name, self.input = "tool_use", name, data


class _Msg:
    def __init__(self, name, data):
        self.content = [_Block(name, data)]
        self.stop_reason = "tool_use"
        self.usage = type("U", (), {"input_tokens": 1000, "output_tokens": 200})()


class _Stream:
    def __init__(self, msg):
        self.msg = msg

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self.msg


class FakeClient:
    def __init__(self):
        self.requests = []
        outer = self

        class Messages:
            def stream(self, **kw):
                outer.requests.append(kw)
                name = kw["tool_choice"]["name"]
                if name == "record_summary":
                    return _Stream(_Msg(name, {"title_ja": "1-8月の中国自動車輸出は745万台（+51%）",
                                               "summary_ja": "要約", "highlights_ja": ["a", "b", "c"],
                                               "period": "2026年1-8月"}))
                figs = [int(c["text"].split("（")[0][1:]) for c in kw["messages"][0]["content"]
                        if c["type"] == "text" and c["text"].startswith("図")]
                return _Stream(_Msg(name, {"charts": [
                    {"figure": n, "kind": "bar", "readable": True, "title_cn": f"图{n}", "unit": "万台",
                     "categories": ["2025", "2026"], "series": [{"name_cn": "出口", "values": [1, 2]}]}
                    for n in figs]}))

        self.messages = Messages()


def test_ai_pipeline(monkeypatch, tmp_path):
    run_fetch(monkeypatch, tmp_path, make_routes())
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    client = FakeClient()
    monkeypatch.setattr(ai, "_client", lambda: client)
    monkeypatch.setattr(ai, "MAX_AGE_DAYS", 100000)
    assert ai.main(["--archive", str(tmp_path)]) == 0
    index = json.loads((tmp_path / "cds/index.json").read_text(encoding="utf-8"))
    a = index["articles"][0]
    assert a["ai"]["title_ja"].startswith("1-8月") and a["ai"]["chart_count"] == 2
    assert a["ai"]["est_cost_usd"] == round((1000 * 2 + 1000 * 2) / 1e6 + (200 * 10 * 2) / 1e6, 4)
    aij = json.loads((tmp_path / a["path"] / "ai.json").read_text(encoding="utf-8"))
    assert [c["file"] for c in aij["charts"]] == ["img/01.jpg", "img/02.png"]
    # 画像は図番号の直後に置かれている
    chart_req = [r for r in client.requests if r["tool_choice"]["name"] == "record_charts"][0]
    kinds = [c["type"] for c in chart_req["messages"][0]["content"]]
    assert kinds == ["text", "image", "text", "image", "text"]
    # 2回目は処理済みなので API を呼ばない
    n = len(client.requests)
    ai.main(["--archive", str(tmp_path)])
    assert len(client.requests) == n


def test_ai_fatal_error_does_not_burn_retries(monkeypatch, tmp_path):
    run_fetch(monkeypatch, tmp_path, make_routes())
    monkeypatch.setenv("ANTHROPIC_API_KEY", "wrong")
    monkeypatch.setattr(ai, "MAX_AGE_DAYS", 100000)

    class AuthenticationError(Exception):
        pass

    class BadClient:
        class messages:  # noqa: N801
            @staticmethod
            def stream(**kw):
                raise AuthenticationError("invalid x-api-key")

    monkeypatch.setattr(ai, "_client", lambda: BadClient())
    assert ai.main(["--archive", str(tmp_path)]) == 2
    index = json.loads((tmp_path / "cds/index.json").read_text(encoding="utf-8"))
    assert all("ai_failures" not in a and "ai" not in a for a in index["articles"])
    assert (tmp_path / "README.md").exists()


def test_ai_without_key_is_noop(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert ai.main(["--archive", str(tmp_path)]) == 0
    assert "スキップ" in capsys.readouterr().out


def test_list_failure_is_annotated_for_github(monkeypatch, tmp_path, capsys):
    """GitHub Actions 上では、一覧の取得失敗が実行画面の注釈（::error）として出る。"""
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    code, _ = run_fetch(monkeypatch, tmp_path, [("https://", FakeResponse(503, "down"))])
    assert code == 3
    out = capsys.readouterr().out
    assert "::error title=記事一覧を取得できませんでした::v2: NG" in out
    # 失敗時も実行記録が残る（ワークフローはこれを保存用ブランチに保存する）
    log = json.loads((tmp_path / "cds/run_log.json").read_text(encoding="utf-8"))
    assert log[0]["ok"] is False and "v2: NG" in log[0]["list_attempts"]


# ---------------------------------------------------------------------------
# ページの作りが違う記事への対応（2026-10-10 の本番実行で16/20件が「本文なし」になった件）
# ---------------------------------------------------------------------------
LONG_P = "2026年9月1-20日，全国乘用车市场零售87.8万辆，同比去年同期下降22%，较上月同期增长21%。" * 3

NEW_TEMPLATE_PC = f"""<html><head><meta property="og:title" content="车市扫描-2026年36期（9月14日-9月19日）">
<meta itemprop="datePublished" content="2026-09-20 20:10"></head><body>
<div class="page"><div class="main-col"><div class="content-box">
  <p>{LONG_P}</p><p><img data-src="{encrypt(IMG1)}"></p><p>{LONG_P}</p><p><img src="{IMG2}"></p>
</div></div>
<aside class="recommend-list"><article class="card"><p>热门推荐</p><img src="https://example.com/c.jpg"></article></aside>
</div></body></html>"""

EMPTY_PC = """<html><head><meta property="og:title" content="2026年1-8月中国占世界汽车份额32%"></head>
<body><div id="app"></div><script>window.__X__={}</script></body></html>"""

MOBILE_PAGE = f"""<html><head><title>2026年1-8月中国占世界汽车份额32%</title></head><body>
<div class="time">2026-09-30 18:00</div>
<div id="articleContent"><p>{LONG_P}</p><p><img data-src="{encrypt(IMG3)}"></p></div></body></html>"""


def test_densest_fallback_for_unknown_template():
    art = sohu.parse_article_html(NEW_TEMPLATE_PC, "https://www.sohu.com/a/1080113775_115312")
    assert "densest" in art.content_method
    assert art.image_urls == [IMG1, IMG2]           # 関連記事カードの画像は拾わない
    assert "热门推荐" not in art.text and art.published_at == "2026-09-20T20:10+08:00"


def test_tiny_generic_article_is_not_mistaken_for_body():
    html = NEW_TEMPLATE_PC.replace('<div class="content-box">', '<article class="related"><p>相关</p></article><div class="content-box">')
    art = sohu.parse_article_html(html, "https://www.sohu.com/a/1080113775_115312")
    assert "相关" not in art.text and len(art.image_urls) == 2


def test_short_article_with_reliable_selector_is_accepted():
    html = '<html><body><article class="article" id="mp-editor"><p>9月新能源乘用车批发120万辆。</p></article></body></html>'
    art = sohu.parse_article_html(html, "https://www.sohu.com/a/1085751082_115312")
    assert art.text == "9月新能源乘用车批发120万辆。" and art.content_method == "lxml:#mp-editor"


def _routes_with(pc_html, mobile_html=None, mobile_status=200):
    img = png_bytes()
    routes = [
        ("https://v2.sohu.com/author-page-api/author-articles/pc/115312",
         FakeResponse(200, v2_json([("1083353151", "2026年1-8月中国占世界汽车份额32%", 1759226400000)]))),
        ("https://www.sohu.com/a/1083353151_115312", FakeResponse(200, pc_html)),
        ("https://m.sohu.com/a/1083353151_115312", FakeResponse(mobile_status, mobile_html or "not found")),
    ]
    for u in (IMG1, IMG2, IMG3):
        routes.append((u, FakeResponse(200, content=img, headers={"Content-Type": "image/png"})))
    return routes


def test_mobile_page_fallback(monkeypatch, tmp_path):
    code, session = run_fetch(monkeypatch, tmp_path, _routes_with(EMPTY_PC, MOBILE_PAGE))
    assert code == 0
    index = json.loads((tmp_path / "cds/index.json").read_text(encoding="utf-8"))
    a = index["articles"][0]
    assert a["content_method"] == "mobile:lxml:#articleContent"
    assert a["title"] == "2026年1-8月中国占世界汽车份額32%".replace("額", "额")   # PC版のog:titleを使う
    assert a["images_saved"] == 1
    mobile_calls = [c for c in session.calls if c[1].startswith("https://m.sohu.com/")]
    assert mobile_calls and "iPhone" in mobile_calls[0][2]["headers"]["User-Agent"]


def test_debug_html_saved_then_removed_on_success(monkeypatch, tmp_path):
    code, _ = run_fetch(monkeypatch, tmp_path, _routes_with(EMPTY_PC, "<html><body>empty</body></html>"))
    assert code == 0
    index = json.loads((tmp_path / "cds/index.json").read_text(encoding="utf-8"))
    err = index["failed"]["1083353151"]["error"]
    assert "ContentNotFound" in err and "mp-editor=False" in err and "モバイル版" in err
    assert (tmp_path / "cds/debug/1083353151.pc.html").exists()
    assert (tmp_path / "cds/debug/1083353151.mobile.html").exists()
    # 次の実行で取れたら、調査用HTMLは消える
    code, _ = run_fetch(monkeypatch, tmp_path, _routes_with(EMPTY_PC, MOBILE_PAGE))
    assert not list((tmp_path / "cds/debug").glob("1083353151.*"))
    index = json.loads((tmp_path / "cds/index.json").read_text(encoding="utf-8"))
    assert index["failed"] == {} and index["articles"][0]["id"] == "1083353151"


# ---------------------------------------------------------------------------
# 新しい作り（Vue）のページ。2026-10-10 にユーザーが保存した実物の構造を小さく再現したもの
# ---------------------------------------------------------------------------
PLACEHOLDER = "https://m1.auto.itc.cn/appImage/sohu-default.png"
VUE_PAGE = f"""<!DOCTYPE html><html><head><title>车市扫描-2026年38期（9月28日-9月30日）_搜狐汽车_搜狐网</title></head>
<body><div id="app" data-v-app=""><section class="content-box area"><section class="content-main">
<h3 class="content-main--title">车市扫描-2026年38期（9月28日-9月30日）</h3>
<span class="content-main-desc--time">2026-10-10 17:34</span>
<div class="content-main-detail">
  <p>主要信息源自乘联分会每日新闻等</p>
  <p>9月1-30日全国乘用车厂家批发252.8万辆，同比去年同期下降10%，较上月同期增长7%。</p>
  <p class="ql-align-center"><img src="{IMG1}"></p>
  <p>9月第1周乘用车市场日均零售3.5万辆。</p>
  <p class="ql-align-center"><img src="{PLACEHOLDER}" data-src="{IMG2}"></p>
  <p class="ql-align-center"><img src="{PLACEHOLDER}" lazy-url="{IMG3}"></p>
</div>
<section id="recommendApp" class="info-recommend"><ul class="info-recommend-list"><li><p>推荐阅读：某车型上市</p></li></ul></section>
</section><section id="asideContent" class="content-right"><section class="model-recommend"><p>热门车型</p></section></section>
</section></div></body></html>"""


def test_vue_template_page():
    art = sohu.parse_article_html(VUE_PAGE, "https://www.sohu.com/a/1086043839_115312")
    assert art.content_method == "lxml:.content-main-detail"
    assert art.title == "车市扫描-2026年38期（9月28日-9月30日）"
    assert art.published_at == "2026-10-10T17:34+08:00"
    assert art.image_urls == [IMG1, IMG2, IMG3]       # 仮画像は飛ばし、data-src / 未知の属性の本物URLを拾う
    assert art.missing_images == 0
    assert "推荐阅读" not in art.text and "热门车型" not in art.text


def test_placeholder_only_image_is_reported(monkeypatch, tmp_path):
    page = VUE_PAGE.replace(f'lazy-url="{IMG3}"', "")   # 3枚目は仮画像だけ（本物のURLがどこにも無い）
    art = sohu.parse_article_html(page, "https://www.sohu.com/a/1086043839_115312")
    assert art.image_urls == [IMG1, IMG2] and art.missing_images == 1
    img = png_bytes()
    routes = [
        ("https://v2.sohu.com/author-page-api/author-articles/pc/115312",
         FakeResponse(200, v2_json([("1086043839", "车市扫描-2026年38期", 1791700000000)]))),
        ("https://www.sohu.com/a/1086043839_115312", FakeResponse(200, page)),
        (IMG1, FakeResponse(200, content=img, headers={"Content-Type": "image/png"})),
        (IMG2, FakeResponse(200, content=img, headers={"Content-Type": "image/png"})),
    ]
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    code, session = run_fetch(monkeypatch, tmp_path, routes)
    assert code == 0
    assert not any(c[1] == PLACEHOLDER for c in session.calls)   # 仮画像はダウンロードしない
    index = json.loads((tmp_path / "cds/index.json").read_text(encoding="utf-8"))
    a = index["articles"][0]
    assert a["image_count"] == 3 and a["images_saved"] == 2
    assert (tmp_path / "cds/debug/1086043839.pc.html").exists()
    md = (tmp_path / a["path"] / "content.md").read_text(encoding="utf-8")
    assert "（図3：画像を取得できませんでした）" in md
