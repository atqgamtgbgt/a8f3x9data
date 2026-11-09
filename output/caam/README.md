# CAAM月次補完データ（2026年5〜9月）

`official_2026_05_09.json` は、CAAM（中国汽车工业协会）の「2026年5月〜9月汽车工业产销情况」公式記者会見スライドに記載された**単月値**を目視照合してまとめたものです。単位は万台。

## 読み込みの優先順位

1. `source/CAAM_2026年産販月報_v41.xlsx` の月次データと既存の「単月計算」シート。
2. 従来の `cds-archive/caam/data.json` が取得できた場合の自動取得データ。
3. 本ファイルの公式スライド値（既存値が未登録の項目だけ補完）。

JavaScriptの既存月次計算・差分計算・グラフ描画は変更していません。Excelに登録済みの値を本ファイルで上書きしません。

## データの範囲

- 自動車：生産、販売、国内販売、輸出
- 乗用車、商用車：生産、販売
- NEV：生産、販売、国内販売、輸出（乗用・商用別の国内／輸出を含む）
- BEV／PHEV：生産、販売
- 月次産業運行の原文総論と原典リンク

企業別・車格別・価格帯別・国別輸出内訳など、スライドから確定できていない項目は登録していません。総販売台数と国内販売＋輸出、NEV販売とNEV国内＋NEV輸出などの差は、発表資料の四捨五入で±0.1万台ほど生じる場合があります。誤差をなくすための逆算や、累計差分による単月値への置換は行っていません。

## 公式資料

- 2026年5月: https://mp.weixin.qq.com/s/tyLxaTLabQ_FTNyiir0lIg
- 2026年6月: https://mp.weixin.qq.com/s/ji-oZh_VqJiUUBHGLXSTXg
- 2026年7月: https://mp.weixin.qq.com/s/X717QTcViRIT6duzIKCY0Q
- 2026年8月: https://mp.weixin.qq.com/s/IdxMfEol1F-1O8iiVwJMuw
- 2026年9月: https://mp.weixin.qq.com/s/rpJlWjDbCU8cTMJLWaB-bA
