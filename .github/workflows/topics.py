"""記事タイトルからテーマ（ダッシュボードの崔東樹タブの分類）を推定する。

上から順に判定し、最初に当てはまったものを採用する。
ダッシュボード側の表示名もここで一元管理する（index.json に label_ja として書き出す）。
"""
from __future__ import annotations

import re

# (キー, 表示名, タイトルに対する正規表現)
TOPIC_RULES: list[tuple[str, str, str]] = [
    ("commentary", "論評・その他", r"房地产|召回|道路交通|自动驾驶|智驾|保修|质保|座谈|讲话|演讲|政策解读"),
    ("market_scan", "車市スキャン（週次）", r"车市扫描"),
    ("battery_export", "リチウム電池 輸出", r"(锂电|电池).{0,8}出口|出口.{0,8}(锂电|电池)"),
    ("battery", "電池", r"锂电|动力电池|电池"),
    ("overseas", "自主ブランド 海外販売", r"海外"),
    ("export", "輸出", r"出口"),
    ("import", "輸入", r"进口"),
    ("inventory", "在庫", r"库存"),
    ("discount", "値引き・販促", r"降价|促销"),
    ("price", "価格帯", r"价格段|价格|均价"),
    ("profit", "利益・収益", r"利润|效益|盈利|营收"),
    ("dual_credit", "ダブルクレジット", r"积分"),
    ("commercial", "商用車", r"商用车|重卡|客车|货车|皮卡"),
    ("world_finance", "世界企業財務", r"上市公司|财务|财报"),
    ("world", "世界市場", r"世界|全球|欧洲|美国|日本|印度|东盟|俄罗斯"),
    ("region", "地域別", r"区域|地区|省份|城市"),
    ("nev_products", "NEV新製品・技術", r"新品|技术路线|目录|免税|新车型|产品"),
    ("stats", "産業統計", r"统计局|工业|增加值|生产|产销|消费"),
    ("segment", "セグメント・車種", r"级别|细分|车型|分级|竞争"),
    ("market", "乗用車市場", r"乘用车|车市|市场|零售|批发"),
]
DEFAULT_TOPIC = ("other", "その他")

# グラフの数値読み取り（AI）を行うかどうか。論評記事などは画像があっても読み取らない。
CHART_TOPICS = {k for k, _, _ in TOPIC_RULES} - {"commentary"}

_COMPILED = [(k, label, re.compile(rx)) for k, label, rx in TOPIC_RULES]


def classify(title: str) -> tuple[str, str]:
    t = title or ""
    for key, label, rx in _COMPILED:
        if rx.search(t):
            return key, label
    return DEFAULT_TOPIC


def label_of(key: str) -> str:
    for k, label, _ in TOPIC_RULES:
        if k == key:
            return label
    return DEFAULT_TOPIC[1]
