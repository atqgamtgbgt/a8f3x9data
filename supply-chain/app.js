/* サプライチェーン分析（試作）— 画面の処理。
 * データ：../output/supply_chain/*.json（非公開リポジトリ china-auto-dashboard の tools/supply_chain/build.py が生成）
 * 既存の index.html とは独立。外部ライブラリなし（グラフは軽量なSVG）。
 * 表示する文字列はすべて textContent で入れる（データ由来の文字列をHTMLとして解釈しない）。
 */
(() => {
  'use strict';
  const DATA = '../output/supply_chain/';
  const cache = new Map();
  let INDEX = null;

  // ---------------------------------------------------------------- 小道具
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null) continue;
      if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid) el.appendChild(kid);
    return el;
  }
  async function load(name) {
    if (cache.has(name)) return cache.get(name);
    const p = fetch(DATA + name, { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
      return r.json();
    });
    cache.set(name, p);
    try { return await p; } catch (e) { cache.delete(name); throw e; }
  }
  const isNum = v => typeof v === 'number' && isFinite(v);
  const pct = (v, d = 1) => isNum(v) ? v.toFixed(d) + '%' : '—';
  const pt = (v, d = 1) => isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(d) + 'pt' : '—';
  const signed = (v, d = 1, u = '%') => isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(d) + u : '—';
  const days = v => isNum(v) ? Math.round(v) + '日' : '—';
  const oku = v => isNum(v) ? (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ja-JP') : v.toFixed(1)) + '億元' : '—';
  function vol(v) {
    if (!isNum(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(2) + '億';
    if (a >= 1e4) return (v / 1e4).toFixed(a >= 1e6 ? 0 : 1) + '万';
    return Math.round(v).toLocaleString('ja-JP');
  }
  function periodLabel(key) {
    if (!key) return '';
    const [p, t] = key.split('|');
    const y = p.slice(0, 4), m = +p.slice(5, 7);
    if (t === 'FY') return y + '年';
    if (t && t.startsWith('YTD')) return y + '年1〜' + m + '月';
    if (t === 'Q') return y + '年' + (m - 2) + '〜' + m + '月期';
    return p;
  }
  const fyKeys = keys => keys.filter(k => k.endsWith('|FY')).sort();
  const ytdKeys = keys => keys.filter(k => k.includes('|YTD')).sort();
  const previousYearKey = key => {
    if (!key || !/^20\d{2}-\d{2}-\d{2}\|(FY|YTD_Q1|YTD_H1|YTD_Q3)$/.test(key)) return null;
    return (Number(key.slice(0, 4)) - 1) + key.slice(4);
  };
  const changePt = (a, b) => isNum(a) && isNum(b) ? a - b : null;
  const countRate = (count, total) => isNum(count) && total > 0 ? pct(count / total * 100) + '（' + count + '/' + total + '社）' : '—';


  const REGION = {
    cn_mainland: ['中国系', 'var(--s1)'], foreign: ['外資系', 'var(--s2)'], jv: ['合弁', 'var(--s7)'],
    hk_mo_tw: ['香港・マカオ・台湾系', 'var(--s3)'], unknown: ['判定保留', 'var(--neutral)']
  };
  function regionChip(a) {
    if (!a) return null;
    const key = a.jv === 'yes' ? 'jv' : (a.region || 'unknown');
    const [name, color] = REGION[key] || REGION.unknown;
    const prov = a.region_status === 'provisional';
    const tip = (a.region_basis_ja || (key === 'unknown' ? '根拠が未確認のため判定保留' : ''));
    return h('span', { class: 'chip' + (prov ? ' prov' : ''), title: tip },
      h('span', { class: 'sw', style: { background: color } }), name + (prov ? '（暫定）' : ''));
  }
  function attrChips(a) {
    const out = [regionChip(a)];
    if (a && a.oem_inhouse === 'yes') out.push(h('span', { class: 'chip', title: '完成車メーカー本体またはグループ内の供給' }, '内製（完成車）'));
    return out;
  }

  // ---------------------------------------------------------------- ツールチップ
  const tip = document.getElementById('tooltip');
  function showTip(evt, nodes) {
    tip.replaceChildren(...nodes);
    tip.hidden = false;
    const r = (evt.target && evt.target.getBoundingClientRect) ? evt.target.getBoundingClientRect() : null;
    let x = evt.clientX, y = evt.clientY;
    if ((x == null || (x === 0 && y === 0)) && r) { x = r.left + r.width / 2; y = r.top; }
    const w = tip.offsetWidth, hh = tip.offsetHeight;
    tip.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, x + 12)) + 'px';
    tip.style.top = Math.max(6, (y - hh - 12 < 6 ? y + 16 : y - hh - 12)) + 'px';
  }
  function hideTip() { tip.hidden = true; }
  function bindTip(el, makeNodes) {
    el.addEventListener('pointermove', e => showTip(e, makeNodes()));
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('focus', e => showTip(e, makeNodes()));
    el.addEventListener('blur', hideTip);
    el.setAttribute('tabindex', '0');
  }

  // ---------------------------------------------------------------- 表
  function table(columns, rows, opts = {}) {
    // columns: [{label, get(row)->node|string, num?:bool, sort?(row)->value}]
    // opts.limit：先頭N行だけ表示し、残りは「すべて表示」で開く（並べ替えても状態は保つ）
    let sortIdx = opts.sortIdx ?? -1, asc = opts.asc ?? false;
    let expanded = !(opts.limit && rows.length > opts.limit + 3);
    const wrap = h('div', { class: 'tablewrap' });
    const outer = h('div');
    const more = h('button', { class: 'linkbtn', type: 'button' });
    more.addEventListener('click', () => { expanded = !expanded; render(); });
    function render() {
      let rs = rows.slice();
      if (sortIdx >= 0 && columns[sortIdx].sort) {
        const f = columns[sortIdx].sort;
        rs.sort((a, b) => {
          const va = f(a), vb = f(b);
          if (va == null && vb == null) return 0;
          if (va == null) return 1;
          if (vb == null) return -1;
          return (va < vb ? -1 : va > vb ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      const thead = h('thead', null, h('tr', null, columns.map((c, i) => h('th', { class: c.num ? 'n' : null, scope: 'col' },
        c.sort ? h('button', { class: 'sort', onclick: () => { asc = sortIdx === i ? !asc : false; sortIdx = i; render(); },
          'aria-sort': sortIdx === i ? (asc ? 'ascending' : 'descending') : null },
        c.label + (sortIdx === i ? (asc ? ' ▲' : ' ▼') : '')) : c.label))));
      const shown = expanded ? rs : rs.slice(0, opts.limit);
      const tbody = h('tbody', null, shown.map(r => h('tr', { class: opts.rowClass ? opts.rowClass(r) : null },
        columns.map(c => { const v = c.get(r); return h('td', { class: c.num ? 'n' : null }, v == null ? '—' : v); }))));
      wrap.replaceChildren(h('table', null, thead, tbody));
      if (opts.limit && rows.length > opts.limit + 3) {
        more.textContent = expanded ? '上位' + opts.limit + '行だけ表示' : 'すべて表示（' + rows.length + '行）';
        more.hidden = false;
      } else more.hidden = true;
    }
    render();
    if (!opts.limit) return wrap;
    outer.append(wrap, more);
    return outer;
  }
  function withTableToggle(chartEl, tableFactory) {
    const box = h('div');
    let showing = false;
    const btn = h('button', { class: 'linkbtn toggle-table', type: 'button' }, '表で見る');
    btn.addEventListener('click', () => {
      showing = !showing;
      box.replaceChildren(showing ? tableFactory() : chartEl);
      btn.textContent = showing ? 'グラフで見る' : '表で見る';
    });
    box.appendChild(chartEl);
    return h('div', null, box, btn);
  }

  // ---------------------------------------------------------------- グラフ
  // 横棒（ランキング）。HTMLで組む（ラベルが折り返せるので狭い画面でも崩れない）
  function hbars(rows, opts) {
    // rows: [{label: node|string, chips: [], value, valueText, tipNodes: () => []}]
    const max = Math.max(...rows.map(r => Math.abs(r.value || 0)), 1e-9);
    const list = h('div', { class: 'hbars', role: 'list' });
    rows.forEach(r => {
      const w = Math.max(0.5, Math.abs(r.value || 0) / max * 100);
      const bar = h('div', { style: { height: '12px', width: w + '%', background: r.color || 'var(--s1)',
        borderRadius: '0 4px 4px 0', minWidth: '2px' } });
      const track = h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
        h('div', { style: { flex: '1 1 auto', minWidth: '0' } }, bar),
        h('div', { class: 'n', style: { flex: '0 0 auto', fontSize: '12px', fontVariantNumeric: 'tabular-nums', minWidth: '64px', textAlign: 'right' } }, r.valueText));
      const item = h('div', { role: 'listitem', style: { padding: '4px 0', borderBottom: '1px solid var(--grid)' } },
        h('div', { style: { fontSize: '13px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 6px' } },
          h('span', { class: 'muted', style: { fontVariantNumeric: 'tabular-nums', minWidth: '1.6em' } }, r.rank != null ? String(r.rank) : ''),
          r.label, ...(r.chips || [])),
        track);
      if (r.tipNodes) bindTip(item, r.tipNodes);
      list.appendChild(item);
    });
    return list;
  }

  // 1つの全体を部分に分ける縦長の帯（tall segmented bar）
  function segBar(parts, opts = {}) {
    const total = parts.reduce((a, p) => a + (p.value || 0), 0) || 1;
    const bar = h('div', { style: { display: 'flex', gap: '2px', height: '28px', margin: '6px 0 4px' }, role: 'img',
      'aria-label': opts.aria || parts.map(p => p.name + ' ' + pct(p.value)).join('、') });
    parts.filter(p => p.value > 0).forEach(p => {
      const share = p.value / total * 100;
      const seg = h('div', { style: { flex: '0 0 ' + share + '%', background: p.color, borderRadius: '4px', minWidth: '2px',
        display: 'flex', alignItems: 'center', paddingLeft: '6px', overflow: 'visible', position: 'relative',
        backgroundImage: p.hatch ? 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(127,127,127,.25) 4px 5px)' : null } });
      // 文字は帯に収まる時だけ（はみ出し・切り落としはしない）
      seg.dataset.label = pct(p.value);
      seg.dataset.ink = p.ink || '#ffffff';
      bindTip(seg, () => [h('b', null, pct(p.value)), h('div', null, p.name), p.note ? h('div', { class: 'muted' }, p.note) : null]);
      bar.appendChild(seg);
    });
    requestAnimationFrame(() => bar.querySelectorAll('div').forEach(seg => {
      const label = seg.dataset.label;
      if (!label) return;
      const t = h('span', { style: { fontSize: '12px', fontWeight: '600', color: seg.dataset.ink, whiteSpace: 'nowrap' } }, label);
      seg.appendChild(t);
      if (t.offsetWidth + 10 > seg.clientWidth) t.remove();
    }));
    const legend = h('div', { class: 'legend' }, parts.map(p => h('span', null,
      h('i', { style: { background: p.color, backgroundImage: p.hatch ? 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(127,127,127,.35) 3px 4px)' : null } }), p.name)));
    return h('div', null, bar, legend);
  }

  // 折れ線（同じ単位の系列だけ。軸は1本）
  function lineChart(cfg) {
    // cfg: {x: [label...], series: [{name, color, values:[...], dash?}], unit: '%'|'日', fmt}
    const W = 640, H = 230, L = 44, R = 92, T = 12, B = 30;
    const fmt = cfg.fmt || (v => v.toFixed(1));
    const all = cfg.series.flatMap(s => s.values).filter(isNum);
    if (!all.length) return h('p', { class: 'empty' }, 'データがありません');
    let lo = Math.min(...all, cfg.zero ? 0 : Infinity), hi = Math.max(...all, cfg.zero ? 0 : -Infinity);
    if (lo === hi) { lo -= 1; hi += 1; }
    const span = hi - lo, step = niceStep(span / 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const n = cfg.x.length;
    const X = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1));
    const Y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': cfg.aria || cfg.series.map(x => x.name).join('・') });
    for (let v = lo; v <= hi + 1e-9; v += step) {
      svg.appendChild(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: Math.abs(v) < 1e-9 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }));
      svg.appendChild(s('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)', text: fmt(v) + (cfg.unit || '') }));
    }
    cfg.x.forEach((lab, i) => {
      if (n > 8 && i % 2 && i !== n - 1) return;
      svg.appendChild(s('text', { x: X(i), y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)', text: lab }));
    });
    const endLabels = [];
    cfg.series.forEach(se => {
      let d = '', pen = false;
      se.values.forEach((v, i) => {
        if (!isNum(v)) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1);
        pen = true;
      });
      svg.appendChild(s('path', { d, fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': se.dash || null }));
      se.values.forEach((v, i) => { if (isNum(v)) svg.appendChild(s('circle', { cx: X(i), cy: Y(v), r: 3, fill: se.color, stroke: 'var(--card)', 'stroke-width': 1.5 })); });
      const li = se.values.map((v, i) => isNum(v) ? i : -1).filter(i => i >= 0).pop();
      if (li != null && li >= 0) endLabels.push({ y: Y(se.values[li]), x: X(li), text: fmt(se.values[li]) + (cfg.unit || ''), name: se.name, color: se.color });
    });
    // 末尾ラベル：重なる時はずらさず凡例とツールチップに任せる
    endLabels.sort((a, b) => a.y - b.y);
    let lastY = -1e9;
    endLabels.forEach(e => {
      if (e.y - lastY < 13) return;
      lastY = e.y;
      svg.appendChild(s('text', { x: e.x + 8, y: e.y + 4, 'font-size': 11, fill: 'var(--text-2)', text: e.text }));
    });
    // 十字線とツールチップ
    const cross = s('line', { y1: T, y2: H - B, stroke: 'var(--axis)', 'stroke-width': 1, visibility: 'hidden' });
    svg.appendChild(cross);
    const overlay = s('rect', { x: L - 10, y: T, width: W - L - R + 20, height: H - T - B, fill: 'transparent', tabindex: 0 });
    const onMove = evt => {
      const box = svg.getBoundingClientRect();
      const px = (evt.clientX != null && evt.clientX !== 0 ? (evt.clientX - box.left) / box.width * W : X(n - 1));
      let i = Math.round((px - L) / ((W - L - R) / Math.max(1, n - 1)));
      i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      showTip(evt, [h('div', { class: 'muted' }, cfg.x[i]), ...cfg.series.map(se => h('div', null,
        h('span', { style: { display: 'inline-block', width: '12px', height: '2px', background: se.color, verticalAlign: 'middle', marginRight: '6px' } }),
        h('b', null, isNum(se.values[i]) ? fmt(se.values[i]) + (cfg.unit || '') : '—'), ' ', se.name, se.n && se.n[i] != null ? '（' + se.n[i] + '社）' : ''))]);
    };
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('focus', onMove);
    overlay.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
    overlay.addEventListener('blur', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
    svg.appendChild(overlay);
    const legend = cfg.series.length > 1 ? h('div', { class: 'legend' }, cfg.series.map(se => h('span', null,
      h('i', { class: 'line', style: { background: se.color } }), se.name))) : null;
    return h('figure', null, svg, legend);
  }
  function niceStep(x) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9))));
    const m = x / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  // ダンベル（項目ごとの前→後）
  function dumbbell(rows, cfg) {
    // rows: [{label, a, b, emph}]
    const W = 640, rowH = 28, L = 150, R = 56, T = 22, B = 8;
    const vals = rows.flatMap(r => [r.a, r.b]).filter(isNum);
    if (!vals.length) return h('p', { class: 'empty' }, 'データがありません');
    let lo = Math.min(0, ...vals), hi = Math.max(...vals);
    const step = niceStep((hi - lo) / 4 || 1);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const H = T + rows.length * rowH + B;
    const X = v => L + (v - lo) / (hi - lo) * (W - L - R);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': cfg.aria || '' });
    for (let v = lo; v <= hi + 1e-9; v += step) {
      svg.appendChild(s('line', { x1: X(v), x2: X(v), y1: T - 4, y2: H - B, stroke: Math.abs(v) < 1e-9 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }));
      svg.appendChild(s('text', { x: X(v), y: 12, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)', text: v.toFixed(0) + (cfg.unit || '') }));
    }
    rows.forEach((r, i) => {
      const y = T + i * rowH + rowH / 2;
      const color = r.emph ? 'var(--emph)' : 'var(--deemph)';
      const g = s('g', { tabindex: 0 });
      g.appendChild(s('text', { x: L - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 12, fill: r.emph ? 'var(--text)' : 'var(--text-2)', 'font-weight': r.emph ? 600 : 400, text: r.label }));
      if (isNum(r.a) && isNum(r.b)) g.appendChild(s('line', { x1: X(r.a), x2: X(r.b), y1: y, y2: y, stroke: color, 'stroke-width': 2 }));
      if (isNum(r.a)) g.appendChild(s('circle', { cx: X(r.a), cy: y, r: 4, fill: 'var(--card)', stroke: color, 'stroke-width': 2 }));
      if (isNum(r.b)) {
        g.appendChild(s('circle', { cx: X(r.b), cy: y, r: 5, fill: color, stroke: 'var(--card)', 'stroke-width': 2 }));
        // 値のラベルは塗りの点（新しい年）の外側に置く。下がった行は左側（左端に余白がなければ右端の外）
        const txt = r.b.toFixed(1) + (cfg.unit || '');
        const left = isNum(r.a) && r.b < r.a && X(r.b) - 10 - txt.length * 6.5 > L;
        g.appendChild(s('text', { x: left ? X(r.b) - 10 : Math.max(X(r.a ?? r.b), X(r.b)) + 10, y: y + 4, 'font-size': 11,
          'text-anchor': left ? 'end' : 'start', fill: 'var(--text-2)', text: txt }));
      }
      g.appendChild(s('rect', { x: 0, y: y - rowH / 2, width: W, height: rowH, fill: 'transparent' }));
      bindTip(g, () => [h('div', null, r.label), h('div', null, cfg.aLabel + '：', h('b', null, pct(r.a))), h('div', null, cfg.bLabel + '：', h('b', null, pct(r.b))), r.n ? h('div', { class: 'muted' }, r.n) : null]);
      svg.appendChild(g);
    });
    const legend = h('div', { class: 'legend' },
      h('span', null, h('i', { style: { background: 'var(--card)', border: '2px solid var(--emph)', borderRadius: '50%' } }), cfg.aLabel),
      h('span', null, h('i', { style: { background: 'var(--emph)', borderRadius: '50%' } }), cfg.bLabel));
    return h('figure', null, svg, legend);
  }

  // 散布図（数量の変化 × 単価の変化）
  function scatter(points, cfg) {
    const W = 640, H = 280, L = 48, R = 16, T = 16, B = 36;
    if (!points.length) return h('p', { class: 'empty' }, '前年同期と比べられる組み合わせがまだありません。');
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const pad = (a, b) => { const m = Math.max(Math.abs(a), Math.abs(b), 5) * 1.15; return [-m, m]; };
    const [x0, x1] = pad(Math.min(...xs), Math.max(...xs));
    const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
    const X = v => L + (v - x0) / (x1 - x0) * (W - L - R);
    const Y = v => T + (y1 - v) / (y1 - y0) * (H - T - B);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': cfg.aria || '' });
    svg.appendChild(s('line', { x1: X(0), x2: X(0), y1: T, y2: H - B, stroke: 'var(--axis)', 'stroke-width': 1 }));
    svg.appendChild(s('line', { x1: L, x2: W - R, y1: Y(0), y2: Y(0), stroke: 'var(--axis)', 'stroke-width': 1 }));
    const q = [['数量↑・単価↓', W - R - 4, H - B - 6, 'end'], ['数量↑・単価↑', W - R - 4, T + 12, 'end'], ['数量↓・単価↑', L + 4, T + 12, 'start'], ['数量↓・単価↓', L + 4, H - B - 6, 'start']];
    q.forEach(([t, x, y, a]) => svg.appendChild(s('text', { x, y, 'text-anchor': a, 'font-size': 11, fill: 'var(--muted)', text: t })));
    svg.appendChild(s('text', { x: (L + W - R) / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)', text: cfg.xLabel }));
    svg.appendChild(s('text', { x: 12, y: (T + H - B) / 2, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)', transform: `rotate(-90 12 ${(T + H - B) / 2})`, text: cfg.yLabel }));
    // ラベルは外れ値の数点だけ。重なる位置には付けない（ツールチップと表で読める）
    const extremes = new Set([...points].sort((a, b) => Math.abs(b.x) + Math.abs(b.y) - Math.abs(a.x) - Math.abs(a.y)).slice(0, 5));
    const placed = [];
    points.forEach(p => {
      const g = s('g', null);
      g.appendChild(s('circle', { cx: X(p.x), cy: Y(p.y), r: 12, fill: 'transparent' }));
      g.appendChild(s('circle', { cx: X(p.x), cy: Y(p.y), r: 5, fill: 'var(--s1)', stroke: 'var(--card)', 'stroke-width': 2 }));
      if (extremes.has(p)) {
        const text = p.short || p.label, w = text.length * 11, lx = X(p.x) + 8, ly = Y(p.y) - 6;
        const box = [lx, ly - 11, lx + w, ly + 2];
        if (!placed.some(b => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3]) && box[2] <= W) {
          placed.push(box);
          g.appendChild(s('text', { x: lx, y: ly, 'font-size': 11, fill: 'var(--text-2)', text }));
        }
      }
      bindTip(g, () => [h('div', null, p.label), h('div', null, '数量 ', h('b', null, signed(p.x)), '・単価 ', h('b', null, signed(p.y))), h('div', { class: 'muted' }, p.period)]);
      svg.appendChild(g);
    });
    return h('figure', null, svg);
  }

  // ---------------------------------------------------------------- 画面：仮説
  const STATUS_JA = { partial: '一部の根拠あり', correlation: '相関のみ', insufficient: 'データ不足', evidence: '根拠あり' };
  function renderHypotheses(main) {
    const box = h('div');
    box.appendChild(h('div', { class: 'card' },
      h('h2', null, '6つの仮説と、いまのデータで言えること'),
      h('p', { class: 'lead' }, '数値はデータから自動で計算しています。「事実」はデータで確認できること、「相関」は同時に起きている動き、「仮説」はこのデータだけでは確かめられない解釈です。利益率の違いだけでは製造原価の違いは証明できません。')));
    // 一見「部品企業は高利益」に見える偏りを避け、最初に前年同期の悪化を示す。
    const allYtd = ytdKeys(INDEX.periods || []);
    const cur = allYtd[allYtd.length - 1], prev = previousYearKey(cur);
    const parts = (INDEX.industries || []).filter(i => i.group_ja === '自動車部品');
    const readable = parts.filter(i => isNum((((i.series || {})[cur] || {}).net_margin || {}).median)
      && isNum((((i.series || {})[prev] || {}).net_margin || {}).median));
    const declining = readable.filter(i => ((i.series[cur].net_margin.median) < i.series[prev].net_margin.median));
    if (readable.length) box.appendChild(h('section', { class: 'card' },
      h('h2', null, '先に見る：サプライヤーの利益率は本当に安定しているか'),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'l' }, '純利益率中央値が前年同期より低下した部品業種'),
          h('div', { class: 'v' }, declining.length + ' / ' + readable.length),
          h('div', { class: 'd' }, periodLabel(prev) + ' → ' + periodLabel(cur) + '・申万三級')),
        h('div', { class: 'tile' }, h('div', { class: 'l' }, '収益性の変化の確認方法'),
          h('div', { class: 'v' }, '同一企業比較'),
          h('div', { class: 'd' }, '業種中央値の差と、悪化した企業の割合を分けて確認'))),
      h('p', { class: 'note' }, '部品業種の利益率がプラスでも、その企業の利幅が縮小していないとは限りません。悪化の原因が値下げかどうかは、単価や費用を別途検証する必要があります。'),
      h('p', null, h('a', { href: '#industries' }, '業種別の悪化企業割合と赤字比率を見る →'))));
    for (const hy of INDEX.hypotheses) {
      const card = h('section', { class: 'card hyp', 'aria-labelledby': 'h-' + hy.id },
        h('div', null, h('span', { class: 'status' }, hy.id + '｜' + (hy.status_ja || STATUS_JA[hy.status] || ''))),
        h('h2', { id: 'h-' + hy.id }, hy.title_ja),
        h('ul', null,
          (hy.facts || []).map(t => h('li', { class: 'f' }, t)),
          (hy.correlations || []).map(t => h('li', { class: 'c' }, t)),
          (hy.hypotheses || []).map(t => h('li', { class: 'h' }, t))),
        (hy.facts || []).length === 0 ? h('p', { class: 'empty' }, 'この仮説に使えるデータはまだ取得できていません。') : null,
        h('details', null, h('summary', null, 'このデータで言えないこと・使ったデータ'),
          h('ul', null, (hy.limits || []).map(t => h('li', null, t))),
          h('p', { class: 'note' }, '使ったデータ：' + (hy.data_used || []).join('、'))),
        h('div', { class: 'links' }, (hy.views || []).filter(v => v.sector && v.sector !== '*').map(v => {
          const anchor = { strength: 1, profit: 2, unit_price: 3, structure: 4 }[v.view];
          const toInd = v.sector === 'oem' || v.sector === 'industries';
          return h('a', { href: toInd ? '#industries' : '#sector/' + v.sector, style: { marginRight: '12px' },
            onclick: toInd || !anchor ? null : e => { e.preventDefault(); pendingAnchor = 'v' + anchor; location.hash = '#sector/' + v.sector; } },
          (toInd ? '業種別の利益率' : sectorShort(v.sector) + (anchor ? '：' + VIEW_NAMES[anchor - 1] : '')) + ' を見る →');
        })));
      box.appendChild(card);
    }
    main.replaceChildren(box);
  }
  const sectorName = id => (INDEX.sectors.find(s => s.id === id) || {}).ja || id;

  // ---------------------------------------------------------------- 画面：分野
  async function renderSector(main, id) {
    const meta = INDEX.sectors.find(s => s.id === id);
    if (!meta) { main.replaceChildren(h('p', { class: 'empty' }, '分野が見つかりません。')); return; }
    main.replaceChildren(h('p', { class: 'empty' }, meta.ja + ' を読み込み中…'));
    const [sec, oem] = await Promise.all([load(meta.file), load('oem.json')]);
    const head = h('div', { class: 'card' }, h('h2', null, sec.ja),
      h('p', { class: 'lead' }, '4つの観点で見ます：①市場で誰が強いのか ②部品メーカーはどの程度儲けているのか ③単価と利益率はどう変化しているのか ④取引・生産構造はどうなっているのか。'),
      sec.note_ja ? h('p', { class: 'note' }, sec.note_ja) : null,
      h('nav', { class: 'row', 'aria-label': '観点へ移動' }, ['①誰が強い', '②どの程度儲けている', '③単価と利益率', '④取引・生産構造'].map((t, i) =>
        h('a', { href: '#', onclick: e => { e.preventDefault(); document.getElementById('v' + (i + 1)).scrollIntoView({ behavior: 'smooth' }); }, style: { fontSize: '13px' } }, t))));
    main.replaceChildren(head, strengthCard(sec), profitCard(sec, oem), unitPriceCard(sec), structureCard(sec, oem));
  }

  function strengthCard(sec) {
    const card = h('section', { class: 'card', id: 'v1' }, h('h2', null, '① 市場で誰が強いのか'));
    const st = sec.strength || {};
    if (st.source === 'gasgoo') return gasgooStrength(card, st);
    return volumeStrength(card, st, sec);
  }

  function gasgooStrength(card, st) {
    const markets = st.markets || [];
    if (!markets.length) { card.appendChild(h('p', { class: 'empty' }, '市場シェアのデータがまだありません。')); return card; }
    card.appendChild(h('p', { class: 'lead' }, '蓋世汽車研究院の国内乗用車市場の搭載数量ランキング（掲載上位のみ）。中国系・外資系・内製を問わず、記事に載ったメーカーをすべて表示します。'));
    const selM = h('select', { 'aria-label': '部品' }, markets.map((m, i) => h('option', { value: i }, m.name_ja + '（' + m.name_zh + '）')));
    const selP = h('select', { 'aria-label': '期間' });
    const mode = h('div', { class: 'seg', role: 'group', 'aria-label': '集計' });
    const body = h('div');
    card.append(h('div', { class: 'row' }, selM, selP, mode), body);
    let modeVal = 'ytd';
    function fillPeriods() {
      const m = markets[+selM.value];
      const ps = m.periods.slice().sort((a, b) => (b.year - a.year) || (b.end_month - a.end_month));
      selP.replaceChildren(...ps.map(t => h('option', { value: t.period }, t.label_ja + '（年初累計）')));
    }
    function fillMode(t) {
      mode.replaceChildren();
      const opts = [['ytd', '年初累計']];
      if (t.monthly && t.monthly.rows.length) opts.push(['month', '単月（計算値）']);
      if (!opts.some(o => o[0] === modeVal)) modeVal = 'ytd';
      opts.forEach(([v, lab]) => mode.appendChild(h('button', { type: 'button', 'aria-pressed': String(modeVal === v),
        onclick: () => { modeVal = v; draw(); } }, lab)));
      mode.hidden = opts.length < 2;
    }
    function draw() {
      const m = markets[+selM.value];
      const t = m.periods.find(p => p.period === selP.value) || m.periods[m.periods.length - 1];
      fillMode(t);
      const parts = [];
      if (modeVal === 'month' && t.monthly) {
        const mo = t.monthly;
        parts.push(h('h3', null, mo.month.replace('-', '年') + '月（単月・計算値）'),
          hbars(mo.rows.slice().sort((a, b) => b.volume - a.volume).map((r, i) => ({ rank: i + 1, label: r.name, value: r.volume,
            valueText: vol(r.volume) + (isNum(r.share) ? '・' + pct(r.share) : ''),
            tipNodes: () => [h('b', null, vol(r.volume) + ' ' + m.unit_ja), h('div', null, r.name), h('div', { class: 'muted' }, '年初累計の差分（計算値）')] }))),
          h('p', { class: 'note' }, mo.note_ja));
      } else {
        const rows = t.rows.map(r => ({
          rank: r.rank, value: r.share ?? 0, valueText: pct(r.share),
          label: r.listed_code && r.listed_relation === 'same_entity'
            ? h('button', { class: 'linkbtn', type: 'button', onclick: () => openCompany(r.listed_code) }, r.name)
            : (r.id ? h('button', { class: 'linkbtn', type: 'button', onclick: () => openCompany('f_' + r.id) }, r.name) : h('span', null, r.name)),
          chips: [...attrChips(r), r.chip_model ? h('span', { class: 'chip', title: 'チップの型番' }, r.chip_model) : null,
            r.region_status === 'unregistered' ? h('span', { class: 'chip', title: 'サプライヤー属性表に未登録' }, '未登録') : null],
          tipNodes: () => [h('b', null, pct(r.share)), h('div', null, r.raw + '：' + vol(r.volume) + ' ' + m.unit_ja), h('div', { class: 'muted' }, r.region_basis_ja || '')]
        }));
        parts.push(hbars(rows));
        const b = t.breakdown_listed || {};
        const seg = [
          { name: '中国系', value: b.cn_mainland || 0, color: 'var(--s1)' },
          { name: '外資系', value: b.foreign || 0, color: 'var(--s2)' },
          { name: '合弁', value: b.jv || 0, color: 'var(--s7)' },
          { name: '香港・マカオ・台湾系', value: b.hk_mo_tw || 0, color: 'var(--s3)' },
          { name: '判定保留', value: b.unknown || 0, color: 'var(--neutral)', ink: '#0b0b0b' },
          { name: '記事の「その他」', value: t.other_share || 0, color: 'var(--neutral-2)', ink: '#0b0b0b', note: '内訳は不明' },
          { name: '非掲載（上位圏外）', value: t.unlisted_share || 0, color: 'var(--surface)', ink: '#52514e', hatch: true, note: 'ゼロではなく不明' }];
        parts.push(h('h3', null, '掲載上位の内訳'),
          segBar(seg.filter(p => p.value > 0)),
          h('p', { class: 'note' }, (t.coverage_note_ja || '') + '。' + (t.aggregate_allowed
            ? '掲載合計が95%以上で全社の区分があるため、国籍別の合計を参考に示します（暫定の区分を含む場合あり）。'
            : '掲載上位だけの内訳で、市場全体の中国系・外資系シェアではありません。')),
          t.inhouse_listed ? h('p', { class: 'note' }, '完成車メーカーの内製・グループ内供給（掲載上位の合計）：' + pct(t.inhouse_listed)) : null);
        // 同じ年の年初累計の推移（上位4社）
        const same = m.periods.filter(p => p.year === t.year).sort((a, b) => a.end_month - b.end_month);
        if (same.length >= 2) {
          const latest = same[same.length - 1];
          const keyOf = r => r.id ? 'id:' + r.id + (r.chip_model ? '|' + r.chip_model : '') : 'raw:' + r.raw;
          const top = latest.rows.slice(0, 4).map(keyOf);
          const colors = ['var(--s1)', 'var(--s2)', 'var(--s7)', 'var(--s3)'];
          const ser = top.map((k, i) => ({ key: k, name: (latest.rows.find(r => keyOf(r) === k) || {}).name || k, color: colors[i],
            values: same.map(p => (p.rows.find(r => keyOf(r) === k) || {}).share ?? null) }));
          const chart = lineChart({ x: same.map(p => '1〜' + p.end_month + '月'), series: ser, unit: '%', aria: m.name_ja + ' シェアの推移' });
          parts.push(h('h3', null, t.year + '年の推移（年初累計シェア、' + latest.label_ja + 'の上位4社）'),
            withTableToggle(chart, () => table([{ label: '期間', get: p => p.label_ja + (p.source.lang === 'en' ? '（英語版）' : '') }, ...ser.map(se => ({ label: se.name, num: true, get: p => pct((p.rows.find(r => keyOf(r) === se.key) || {}).share) }))], same)));
        }
      }
      parts.push(h('p', { class: 'source' }, '出典：蓋世汽車研究院（Gasgoo）ランキング記事（' + (t.source.lang === 'en' ? '英語版' : '中国語版') +
        (t.source.published_at ? '、' + t.source.published_at.slice(0, 10) + '公開' : '') + '）', ' ',
        h('a', { href: t.source.url, target: '_blank', rel: 'noopener' }, '記事を開く'),
        '。市場：' + m.scope_ja + '。単位：' + m.unit_ja + (m.note_ja ? '。' + m.note_ja : '')));
      body.replaceChildren(...parts.filter(Boolean));
    }
    selM.addEventListener('change', () => { fillPeriods(); draw(); });
    selP.addEventListener('change', draw);
    fillPeriods(); draw();
    return card;
  }

  const PTYPE_SUFFIX = { FY: '（通期）', Q: '（単独四半期）' };
  const ptypeSuffix = t => PTYPE_SUFFIX[t] || (String(t).startsWith('YTD') ? '（累計）' : '');

  // 会社固有の区分名を使った行の根拠。同じ根拠はまとめて1行に
  function basisNotes(rows) {
    const by = new Map();
    rows.forEach(r => { if (!by.has(r.basis_ja)) by.set(r.basis_ja, []); by.get(r.basis_ja).push(r.name + '「' + r.label.replace(/^销量[:：]/, '').replace(/[（(][^（()）]*[)）]$/, '') + '」'); });
    return [...by].map(([b, names]) => h('p', { class: 'note' }, '※ ' + names.join('、') + '：' + b));
  }

  const VIEW_NAMES = ['①誰が強い', '②儲け', '③単価と利益率', '④取引・生産構造'];
  function sectorShort(id) { const s = ((INDEX || {}).sectors || []).find(x => x.id === id); return s ? (s.short_ja || s.ja) : id; }

  function volumeStrength(card, st, sec) {
    const all = st.groups || [];
    const groups = all.filter(g => g.tables && g.tables.length);
    const missing = all.filter(g => !(g.tables && g.tables.length));
    card.appendChild(h('p', { class: 'lead' }, '市場シェアの公表がないため、同花順に載る各社の販売数量を、製品・単位・期間がそろう会社どうしで比べます（中国A株上場企業のみ）。'));
    const missingNote = missing.length ? h('p', { class: 'note' }, missing.map(g => g.ja + '：' + (g.insufficient_ja || '比較できる数量がない')).join('。') + '。') : null;
    if (!groups.length) { card.append(...[h('p', { class: 'empty' }, '比較できる販売数量がまだありません。'), missingNote].filter(Boolean)); return card; }
    const selG = h('select', { 'aria-label': '製品' }, groups.map((g, i) => h('option', { value: i }, g.ja)));
    const selP = h('select', { 'aria-label': '期間' });
    const body = h('div');
    card.append(h('div', { class: 'row' }, selG, selP), body);
    const fill = () => {
      const g = groups[+selG.value];
      selP.replaceChildren(...g.tables.map((t, i) => h('option', { value: i }, t.label_ja + (t.label_ja.includes('通期') ? '' : ptypeSuffix(t.period_type)) + '・' + t.rows.length + '社')));
      // 最新の表の社数が少ない（最大の6割未満）ときは、社数のそろう新しい表を最初に見せる
      const max = Math.max(...g.tables.map(t => t.rows.length));
      selP.value = String(Math.max(0, g.tables.findIndex(t => t.rows.length >= max * 0.6)));
    };
    function draw() {
      const g = groups[+selG.value], t = g.tables[+selP.value];
      const rows = t.rows.map(r => ({ rank: r.rank, value: r.volume, valueText: vol(r.volume) + (g.unit_ja ? g.unit_ja : ''),
        label: h('button', { class: 'linkbtn', type: 'button', onclick: () => openCompany(r.code) }, r.name + (r.basis_ja ? ' ※' : '')),
        tipNodes: () => [h('b', null, r.raw + '（' + t.unit + '）'), h('div', null, r.name + '：' + r.label),
          r.basis_ja ? h('div', null, '※ ' + r.basis_ja) : null,
          r.archived ? h('div', { class: 'muted' }, '同花順の表から消えた過去値（保存分）') : null] }));
      const basis = t.rows.filter(r => r.basis_ja);
      body.replaceChildren(...[hbars(rows),
        ...basisNotes(basis),
        t.excluded.length ? h('p', { class: 'note' }, '単位が違うため除外：' + t.excluded.map(e => e.name + '（' + e.label + '）').join('、')) : null,
        g.note_ja ? h('p', { class: 'note' }, g.note_ja) : null,
        h('p', { class: 'note' }, '販売数量ランキング（会社開示の数量）。' + (sec.note_ja || '')),
        missingNote,
        h('p', { class: 'source' }, '出典：同花順 F10「経営分析・運営業務数据」（各社のページ。企業名から詳細へ）')].filter(Boolean));
    }
    selG.addEventListener('change', () => { fill(); draw(); });
    selP.addEventListener('change', draw);
    fill(); draw();
    return card;
  }

  function seriesVals(ser, keys, metric) { return keys.map(k => ((ser || {})[k] || {})[metric]); }

  function profitCard(sec, oem) {
    const card = h('section', { class: 'card', id: 'v2' }, h('h2', null, '② 部品メーカーはどの程度儲けているのか'),
      h('p', { class: 'lead' }, '「業種の中央値」「企業全体の利益率」「特定製品（事業）の粗利益率」は別の指標です。中央値には対象社数を付けています。'));
    const ind = sec.industry;
    const keys = Object.keys(ind.series || {});
    const fy = fyKeys(keys), ytd = ytdKeys(keys);
    const med = (k, m) => (((ind.series || {})[k] || {})[m] || {});
    // タイル：最新の年初累計と前年同期
    if (ytd.length >= 1) {
      const k1 = ytd[ytd.length - 1], k0 = previousYearKey(k1);
      const comparable = k0 && !!(ind.series || {})[k0];
      const tile = (label, m) => h('div', { class: 'tile' }, h('div', { class: 'l' }, label),
        h('div', { class: 'v' }, pct(med(k1, m).median)),
        h('div', { class: 'd' }, periodLabel(k1) + '・' + (med(k1, m).n || 0) + '社' + (comparable ? '｜前年同期 ' + pct(med(k0, m).median) + '（' + pt(changePt(med(k1, m).median, med(k0, m).median)) + '）' : '')));
      card.appendChild(h('div', { class: 'tiles' }, tile(ind.ja + '：粗利益率の中央値', 'gross_margin'), tile(ind.ja + '：純利益率の中央値', 'net_margin')));
    }
    const lastYtdKey = ytd[ytd.length - 1];
    const pressure = (((ind.series || {})[lastYtdKey] || {}).pressure);
    if (pressure && pressure.net_paired_n) {
      card.append(h('h3', null, '前年同期比：利益が圧迫されている企業の広がり'),
        h('div', { class: 'tiles' },
          h('div', { class: 'tile' }, h('div', { class: 'l' }, '純利益率が低下した企業'),
            h('div', { class: 'v' }, pct(pressure.net_down_pct)),
            h('div', { class: 'd' }, pressure.net_down_n + '/' + pressure.net_paired_n + '社（両期取得）')),
          h('div', { class: 'tile' }, h('div', { class: 'l' }, '純利益率の企業別変化・中央値'),
            h('div', { class: 'v' }, pt(pressure.net_change_median_pt)),
            h('div', { class: 'd' }, '同一企業' + pressure.net_paired_n + '社の変化を集計')),
          h('div', { class: 'tile' }, h('div', { class: 'l' }, '赤字企業の割合'),
            h('div', { class: 'v' }, pct(pressure.loss_pct)),
            h('div', { class: 'd' }, pressure.loss_n + '/' + pressure.current_net_n + '社（最新期）')),
          h('div', { class: 'tile' }, h('div', { class: 'l' }, '増収かつ純利益率低下'),
            h('div', { class: 'v' }, pct(pressure.sales_up_net_down_pct)),
            h('div', { class: 'd' }, pressure.sales_up_net_down_n + '/' + pressure.sales_up_net_down_base_n + '社（「増収減益」とは異なる）'))),
        h('p', { class: 'note' }, '比較：' + periodLabel(pressure.previous_period) + ' → ' + periodLabel(lastYtdKey) +
          '。純利益率が低下した企業数と、業種の中央値の変化は異なる指標です。単価下落によるものと断定しません。'));
    } else card.append(h('p', { class: 'note' },
      '企業ごとの前年同期比較は次回のデータ更新後に表示します。財務のない会社をゼロとして扱いません。'));
    const oemNet = fy.map(k => (((oem.medians || {})[k] || {}).net_margin || {}).median);
    const chart = lineChart({ x: fy.map(k => k.slice(0, 4)), unit: '%', zero: true, aria: '利益率の中央値の推移', series: [
      { name: ind.ja + ' 粗利益率（中央値）', color: 'var(--s1)', values: fy.map(k => med(k, 'gross_margin').median), n: fy.map(k => med(k, 'gross_margin').n) },
      { name: ind.ja + ' 純利益率（中央値）', color: 'var(--s2)', values: fy.map(k => med(k, 'net_margin').median), n: fy.map(k => med(k, 'net_margin').n) },
      { name: '完成車10社 純利益率（中央値）', color: 'var(--s7)', values: oemNet }] });
    card.append(h('h3', null, '業種の中央値の推移（通期）'), withTableToggle(chart, () => table([
      { label: '年', get: k => k.slice(0, 4) },
      { label: '粗利益率', num: true, get: k => pct(med(k, 'gross_margin').median) + '（' + (med(k, 'gross_margin').n || 0) + '社）' },
      { label: '純利益率', num: true, get: k => pct(med(k, 'net_margin').median) + '（' + (med(k, 'net_margin').n || 0) + '社）' },
      { label: '完成車 純利益率', num: true, get: k => pct((((oem.medians || {})[k] || {}).net_margin || {}).median) }], fy)),
      h('p', { class: 'note' }, '申万三級「' + ind.sw_l3 + '」：表示 ' + (ind.stated_count ?? '—') + '社、一覧で確認 ' + ind.listed_count + '社、財務を取得 ' + ind.with_finance + '社。現在の所属企業を過去にも当てはめた系列です。'));
    // 企業一覧
    const lastFy = fy[fy.length - 1], firstFy = fy[0], lastYtd = ytd[ytd.length - 1], prevYtd = ytd[ytd.length - 2];
    const comps = (sec.companies || []);
    const v = (c, k, m) => (((c.series || {})[k] || {})[m]);
    card.append(h('h3', null, '企業別（会社全体の利益率）'), table([
      { label: '会社', get: c => h('span', null, h('button', { class: 'linkbtn', type: 'button', onclick: () => openCompany(c.code) }, c.name), ' ', ...attrChips(c.attrs), c.in_industry ? null : h('span', { class: 'chip', title: '申万の' + sec.industry.ja + 'に属さない関連企業。中央値には含めない' }, '業種外・関連'), c.related_note ? h('div', { class: 'muted', style: { fontSize: '11px' } }, c.related_note) : null), sort: c => c.name },
      { label: '売上高 ' + (lastFy ? lastFy.slice(0, 4) : ''), num: true, get: c => oku(v(c, lastFy, 'revenue')), sort: c => v(c, lastFy, 'revenue') },
      { label: '粗利益率', num: true, get: c => pct(v(c, lastFy, 'gross_margin')), sort: c => v(c, lastFy, 'gross_margin') },
      { label: '純利益率', num: true, get: c => pct(v(c, lastFy, 'net_margin')), sort: c => v(c, lastFy, 'net_margin') },
      { label: '純利益率 ' + (firstFy ? firstFy.slice(0, 4) : '') + '→' + (lastFy ? lastFy.slice(2, 4) : ''), num: true, get: c => pt(v(c, lastFy, 'net_margin') - v(c, firstFy, 'net_margin')), sort: c => isNum(v(c, lastFy, 'net_margin')) && isNum(v(c, firstFy, 'net_margin')) ? v(c, lastFy, 'net_margin') - v(c, firstFy, 'net_margin') : null },
      { label: (lastYtd ? periodLabel(lastYtd) : '累計') + ' 純利益率', num: true, get: c => pct(v(c, lastYtd, 'net_margin')) + (previousYearKey(lastYtd) && isNum(v(c, previousYearKey(lastYtd), 'net_margin')) ? '（前年 ' + pct(v(c, previousYearKey(lastYtd), 'net_margin')) + '）' : ''), sort: c => v(c, lastYtd, 'net_margin') },
      { label: '純利益率の前年同期差', num: true, get: c => pt(changePt(v(c, lastYtd, 'net_margin'), v(c, previousYearKey(lastYtd), 'net_margin'))),
        sort: c => changePt(v(c, lastYtd, 'net_margin'), v(c, previousYearKey(lastYtd), 'net_margin')) }
    ], comps, { sortIdx: 1, limit: 15, rowClass: c => c.focus ? 'focus-row' : null }),
    h('p', { class: 'note' }, '左端に線がある行は、この分野の市場ランキングや事業区分に関係する会社。数値は会社全体（他の事業を含む）。'),
    h('p', { class: 'source' }, '出典：同花順 F10「財務概況」（销售毛利率・销售净利率・营业总收入）'));
    // 事業別
    const segs = sec.segments || [];
    if (segs.length) {
      const rows = [];
      segs.forEach(sg => sg.items.forEach(it => rows.push({ code: sg.code, name: sg.name, item: it.item, series: it.series })));
      const allKeys = [...new Set(rows.flatMap(r => Object.keys(r.series)))].sort();
      const fyK = fyKeys(allKeys).slice(-2), h1K = allKeys.filter(k => k.includes('YTD_H1')).slice(-1);
      const cols = [...fyK, ...h1K];
      const shown = rows.filter(r => cols.some(k => r.series[k] && isNum(r.series[k].gross)));
      if (shown.length) card.append(h('h3', null, '特定製品・事業の粗利益率（事業別）'), table([
        { label: '会社', get: r => h('button', { class: 'linkbtn', type: 'button', onclick: () => openCompany(r.code) }, r.name), sort: r => r.name },
        { label: '事業区分（原文）', get: r => r.item },
        ...cols.map(k => ({ label: periodLabel(k), num: true, get: r => r.series[k] ? pct(r.series[k].gross) + '（構成比 ' + pct(r.series[k].ratio, 0) + '）' : '—', sort: r => r.series[k] ? r.series[k].gross : null }))
      ], shown, { limit: 15 }),
      h('p', { class: 'note' }, '東方財富の主営構成（製品別）。会社全体の利益率とは別の指標で、会社ごとに区分の付け方が違います。'),
      h('p', { class: 'source' }, '出典：東方財富 F10「経営分析・主営構成」'));
    }
    return card;
  }

  function unitPriceCard(sec) {
    const card = h('section', { class: 'card', id: 'v3' }, h('h2', null, '③ 単価と利益率はどう変化しているのか'),
      h('p', { class: 'lead' }, '平均単価＝製品別売上高÷販売数量。製品の範囲・単位・期間が一致する場合だけ計算します（会社全体の売上は使いません）。'));
    const ups = sec.unit_prices || [];
    if (!ups.length) { card.appendChild(h('p', { class: 'empty' }, '数量と製品別売上が対応する組み合わせが見つかっていません。')); return card; }
    // 前年同期比の散布図
    const pts = [];
    ups.forEach(u => {
      const byKey = {}; u.series.forEach(p => { byKey[p.period_end + '|' + p.period_type] = p; });
      const types = [...new Set(u.series.map(p => p.period_type))];
      types.forEach(tp => {
        const latest = u.series.filter(p => p.period_type === tp).sort((a, b) => a.period_end < b.period_end ? 1 : -1)[0];
        if (!latest) return;
        const prev = byKey[(+latest.period_end.slice(0, 4) - 1) + latest.period_end.slice(4) + '|' + tp];
        if (!prev || !prev.volume || !prev.unit_price) return;
        pts.push({ x: (latest.volume / prev.volume - 1) * 100, y: (latest.unit_price / prev.unit_price - 1) * 100,
          label: u.name + '（' + u.product + '）', short: u.name, period: latest.label_ja + '（前年同期比）' });
      });
    });
    const sc = scatter(pts, { xLabel: '販売数量の変化（前年同期比、%）', yLabel: '平均単価の変化（%）', aria: '数量と単価の変化' });
    card.append(h('h3', null, '数量が増えると単価は下がっているか'), withTableToggle(sc, () => table([
      { label: '会社・製品', get: p => p.label }, { label: '期間', get: p => p.period },
      { label: '数量', num: true, get: p => signed(p.x), sort: p => p.x }, { label: '単価', num: true, get: p => signed(p.y), sort: p => p.y }], pts)),
      h('p', { class: 'note' }, '単価は製品構成（サイズ・品種）や原材料価格の影響を受けます。規模の効果だけを示すものではありません。'));
    // 同じ製品区分・単位・期間がそろう会社どうしの単価（参考）
    const groups = {};
    ups.filter(u => u.market_id).forEach(u => { (groups[u.market_id + '|' + u.unit] = groups[u.market_id + '|' + u.unit] || []).push(u); });
    Object.values(groups).forEach(list => {
      const cnt = {};
      list.forEach(u => u.series.filter(p => p.period_type === 'FY').forEach(p => { cnt[p.period_end] = (cnt[p.period_end] || 0) + 1; }));
      const best = Object.keys(cnt).filter(k => cnt[k] >= 3).sort().pop();
      if (!best) return;
      const rows = list.map(u => ({ u, p: u.series.find(p => p.period_type === 'FY' && p.period_end === best) }))
        .filter(x => x.p && isNum(x.p.unit_price)).sort((a, b) => b.p.unit_price - a.p.unit_price);
      const unit = list[0].unit;
      const fmtP = v => v.toLocaleString('ja-JP', { maximumFractionDigits: v < 100 ? 2 : 0 }) + '元/' + unit;
      card.append(h('h3', null, '同じ製品区分の平均単価（' + rows[0].p.label_ja + '・参考）'),
        hbars(rows.map((x, i) => ({ rank: i + 1, value: x.p.unit_price, valueText: fmtP(x.p.unit_price),
          label: h('button', { class: 'linkbtn', type: 'button', onclick: () => openCompany(x.u.code) }, x.u.name),
          tipNodes: () => [h('b', null, fmtP(x.p.unit_price)), h('div', null, x.u.name + '：' + x.u.product),
            h('div', null, '事業の粗利益率 ' + pct(x.p.segment_gross) + '／会社全体 ' + pct(x.p.company_gross))] }))),
        h('p', { class: 'note' }, '製品構成（サイズ・品種・用途）の違いを含むため、単価の差がそのまま原価や競争力の差を示すわけではありません。'));
    });
    // 組み合わせごとの表（1つずつ選んで見る）
    const sorted = ups.slice().sort((a, b) => {
      const last = u => u.series.slice().sort((x, y) => (x.period_end < y.period_end ? 1 : -1))[0] || {};
      return (last(b).revenue_oku || 0) - (last(a).revenue_oku || 0);
    });
    const sel = h('select', { 'aria-label': '会社・製品' }, sorted.map((u, i) => h('option', { value: i }, u.name + ' — ' + u.product + '（' + u.unit + '）')));
    const box = h('div');
    function drawPair() {
      const u = sorted[+sel.value];
      const ser = u.series.slice().sort((a, b) => (a.period_type < b.period_type ? -1 : a.period_type > b.period_type ? 1 : (a.period_end < b.period_end ? -1 : 1)));
      box.replaceChildren(
        h('div', null, h('button', { class: 'linkbtn', type: 'button', onclick: () => openCompany(u.code) }, u.name + 'の詳細'), ' ', h('span', { class: 'chip' }, u.comparability_ja)),
        table([
          { label: '期間', get: p => p.label_ja },
          { label: '販売数量', num: true, get: p => vol(p.volume) + u.unit },
          { label: '売上高', num: true, get: p => oku(p.revenue_oku) },
          { label: '平均単価', num: true, get: p => isNum(p.unit_price) ? p.unit_price.toLocaleString('ja-JP', { maximumFractionDigits: p.unit_price < 100 ? 2 : 0 }) + '元/' + u.unit : '—' },
          { label: '事業の粗利益率', num: true, get: p => pct(p.segment_gross) },
          { label: '会社全体の粗利益率', num: true, get: p => pct(p.company_gross) }], ser),
        h('p', { class: 'note' }, '数量：「' + u.volume_label + '」／売上：「' + u.revenue_label + '」（' + (u.series.some(p => p.rule === 'ths_volume_em_segment') ? '同花順の数量と東方財富の事業別売上' : '同花順の同じ表') + '）'));
    }
    sel.addEventListener('change', drawPair);
    card.append(h('h3', null, '会社・製品ごとの数量・単価・利益率（' + ups.length + '件）'), h('div', { class: 'row' }, sel), box);
    drawPair();
    return card;
  }

  function structureCard(sec, oem) {
    const card = h('section', { class: 'card', id: 'v4' }, h('h2', null, '④ 取引・生産構造はどうなっているのか'),
      h('p', { class: 'lead' }, '売掛金回転日数（部品メーカーが代金を回収するまでの日数）と、完成車メーカーの買掛金回転日数（支払うまでの日数）。中国では手形での支払いが多いため、手形を含めた日数も計算しています。'));
    const ind = sec.industry;
    const keys = fyKeys(Object.keys(ind.series || {}));
    const med = (k, m) => ((((ind.series || {})[k] || {})[m]) || {});
    const oemM = (k, m) => ((((oem.medians || {})[k] || {})[m]) || {});
    const chart = lineChart({ x: keys.map(k => k.slice(0, 4)), unit: '日', fmt: v => v.toFixed(0), aria: '回転日数の推移', series: [
      { name: ind.ja + '：売掛金回転日数（手形を含む・中央値）', color: 'var(--s1)', values: keys.map(k => med(k, 'ar_notes_days').median), n: keys.map(k => med(k, 'ar_notes_days').n) },
      { name: ind.ja + '：売掛金回転日数（同花順掲載・手形を含まない）', color: 'var(--s3)', values: keys.map(k => med(k, 'ar_days_ths').median) },
      { name: '完成車：買掛金回転日数（手形を含む・中央値）', color: 'var(--s2)', values: keys.map(k => oemM(k, 'ap_notes_days').median) }] });
    card.append(withTableToggle(chart, () => table([
      { label: '年', get: k => k.slice(0, 4) },
      { label: '売掛（手形含む）', num: true, get: k => days(med(k, 'ar_notes_days').median) + '（' + (med(k, 'ar_notes_days').n || 0) + '社）' },
      { label: '売掛（同花順）', num: true, get: k => days(med(k, 'ar_days_ths').median) },
      { label: '完成車 買掛（手形含む）', num: true, get: k => days(oemM(k, 'ap_notes_days').median) + '（' + (oemM(k, 'ap_notes_days').n || 0) + '社）' }], keys)),
      h('p', { class: 'note' }, '計算：期間日数 ×（期首残高＋期末残高）÷2 ÷ 売上高（買掛は売上原価）。売掛＝应收账款＋应收票据＋应收款项融资、買掛＝应付账款＋应付票据。部品メーカーの売掛には完成車以外の取引先も含まれます。'),
      h('p', { class: 'source' }, '出典：同花順 F10 財務報表（資産負債表・利潤表）から計算'));
    const comps = (sec.companies || []).filter(c => c.in_industry);
    const last = keys[keys.length - 1], first = keys[0];
    const v = (c, k, m) => (((c.series || {})[k] || {})[m]);
    card.append(h('h3', null, '企業別の回転日数（通期）'), table([
      { label: '会社', get: c => h('button', { class: 'linkbtn', type: 'button', onclick: () => openCompany(c.code) }, c.name), sort: c => c.name },
      { label: '売掛（手形含む）' + (first ? first.slice(0, 4) : ''), num: true, get: c => days(v(c, first, 'ar_notes_days')), sort: c => v(c, first, 'ar_notes_days') },
      { label: '同 ' + (last ? last.slice(0, 4) : ''), num: true, get: c => days(v(c, last, 'ar_notes_days')), sort: c => v(c, last, 'ar_notes_days') },
      { label: '売掛（同花順）' + (last ? last.slice(0, 4) : ''), num: true, get: c => days(v(c, last, 'ar_days_ths')), sort: c => v(c, last, 'ar_days_ths') },
      { label: '在庫日数', num: true, get: c => days(v(c, last, 'inventory_days')), sort: c => v(c, last, 'inventory_days') }
    ], comps, { sortIdx: 2, limit: 15 }));
    const util = (sec.structure || {}).utilization || [];
    if (util.length) {
      const yrs = [...new Set(util.map(u => u.period_end))].sort().slice(-3);
      const byC = {}; util.forEach(u => { (byC[u.code] = byC[u.code] || { code: u.code, name: u.name, v: {} }).v[u.period_end] = u.value; });
      card.append(h('h3', null, '生産能力の稼働率（会社開示）'), table([
        { label: '会社', get: r => h('button', { class: 'linkbtn', type: 'button', onclick: () => openCompany(r.code) }, r.name) },
        ...yrs.map(y => ({ label: y.slice(0, 4) + '年', num: true, get: r => pct(r.v[y]), sort: r => r.v[y] }))], Object.values(byC)),
        h('p', { class: 'source' }, '出典：同花順 F10「運営業務数据」（产能利用率）'));
    }
    const inh = (sec.structure || {}).inhouse || [];
    if (inh.length) {
      const latestBy = {};
      inh.forEach(r => { const o = latestBy[r.market_id]; if (!o || r.period > o.period) latestBy[r.market_id] = r; });
      card.append(h('h3', null, '完成車メーカーの内製・グループ内供給（掲載上位の合計）'), table([
        { label: '部品', get: r => r.name_ja }, { label: '期間', get: r => r.label_ja },
        { label: '内製の合計', num: true, get: r => pct(r.inhouse_listed), sort: r => r.inhouse_listed },
        { label: '掲載上位の合計', num: true, get: r => pct(r.listed_share_sum) }], Object.values(latestBy), { sortIdx: 2 }),
        h('p', { class: 'note' }, '掲載上位のみ。市場全体の内製比率ではありません。内製の判定はサプライヤー属性表（完成車本体・グループ会社）による。'));
    }
    return card;
  }

  // ---------------------------------------------------------------- 画面：業種別
  // ---------------------------------------------------------------- 収益圧迫：業種中央値と企業ペアの変化を分けて表示
  function industryPressureCard(inds, allPeriods) {
    const ytd = ytdKeys(allPeriods), latest = ytd[ytd.length - 1], previous = previousYearKey(latest);
    const net = (i, k) => ((((i.series || {})[k] || {}).net_margin || {}).median);
    const pressure = i => (((i.series || {})[latest] || {}).pressure || {});
    const parts = inds.filter(i => i.group_ja === '自動車部品');
    const valid = parts.filter(i => isNum(net(i, latest)) && isNum(net(i, previous)));
    const falling = valid.filter(i => net(i, latest) < net(i, previous));
    const card = h('section', { class: 'card' },
      h('h2', null, '収益圧迫の広がり：前年同期との比較'),
      h('p', { class: 'lead' }, '中央値の水準だけでは、部品メーカーの悪化を見落とします。業種の変化と、同一企業の利益率低下・赤字の割合を区別します。'),
      h('div', { class: 'tiles' },
        h('div', { class: 'tile' }, h('div', { class: 'l' }, '純利益率中央値が低下した自動車部品業種'),
          h('div', { class: 'v' }, falling.length + '/' + valid.length),
          h('div', { class: 'd' }, periodLabel(previous) + ' → ' + periodLabel(latest))),
        h('div', { class: 'tile' }, h('div', { class: 'l' }, '比較可能な企業の割合'),
          h('div', { class: 'v' }, '企業ごとに算出'),
          h('div', { class: 'd' }, '前年同期の同じ企業・指標だけを比較'))));
    const rows = inds.map(i => ({ i, p: pressure(i), delta: changePt(net(i, latest), net(i, previous)) }));
    card.append(h('h3', null, '業種別：純利益率・低下企業・赤字企業'),
      table([
        { label: '申万三級業種', get: r => r.i.ja, sort: r => r.i.ja },
        { label: periodLabel(previous), num: true, get: r => pct(net(r.i, previous)), sort: r => net(r.i, previous) },
        { label: periodLabel(latest), num: true, get: r => pct(net(r.i, latest)), sort: r => net(r.i, latest) },
        { label: '中央値の前年同期差', num: true, get: r => pt(r.delta), sort: r => r.delta },
        { label: '利益率低下企業', num: true, get: r => countRate(r.p.net_down_n, r.p.net_paired_n), sort: r => r.p.net_down_pct },
        { label: '企業別変化の中央値', num: true, get: r => pt(r.p.net_change_median_pt), sort: r => r.p.net_change_median_pt },
        { label: '赤字企業', num: true, get: r => countRate(r.p.loss_n, r.p.current_net_n), sort: r => r.p.loss_pct },
        { label: '増収＋利益率低下', num: true, get: r => countRate(r.p.sales_up_net_down_n, r.p.sales_up_net_down_base_n), sort: r => r.p.sales_up_net_down_pct }
      ], rows),
      h('p', { class: 'note' },
        '注意：各業種の中央値の差は企業ごとの変化の中央値とは一致しません。「利益率低下企業」は両期に純利益率がある企業を分母にし、「赤字企業」は最新期の純利益率がある企業を分母にします。増収＋利益率低下は利益額の減少を意味しません。'),
      h('p', { class: 'note' }, '同一企業の前年比列は、収集済みデータを再集計した際に順次表示されます。空欄は0%ではありません。'));
    return card;
  }

  function renderIndustries(main) {
    const inds = INDEX.industries;
    const keys = INDEX.periods || [];
    const fy = fyKeys(keys), ytd = ytdKeys(keys);
    let metric = 'net_margin';
    const card = h('section', { class: 'card' }, h('h2', null, '申万10分類の利益率（中央値）'),
      h('p', { class: 'lead' }, '同花順の申万三級10分類。各社の会社全体の利益率の中央値で、外資系・非上場企業は含みません。完成車（濃い色）と部品・電池・資源を比べます。'));
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '指標' });
    const body = h('div');
    card.append(h('div', { class: 'row' }, seg), body);
    const m = (i, k, mm) => ((((i.series || {})[k] || {})[mm]) || {});
    function draw() {
      seg.replaceChildren(...[['net_margin', '純利益率'], ['gross_margin', '粗利益率']].map(([v, lab]) =>
        h('button', { type: 'button', 'aria-pressed': String(metric === v), onclick: () => { metric = v; draw(); } }, lab)));
      const a = fy[0], b = fy[fy.length - 1];
      const rows = inds.map(i => ({ label: i.ja, a: m(i, a, metric).median, b: m(i, b, metric).median, emph: i.role === 'oem',
        n: (m(i, b, metric).n || 0) + '社（表示 ' + (i.stated_count ?? '—') + '社）' }))
        .sort((x, y) => (y.b ?? -999) - (x.b ?? -999));
      const chart = dumbbell(rows, { aLabel: a ? a.slice(0, 4) + '年' : '', bLabel: b ? b.slice(0, 4) + '年' : '', unit: '%', aria: '業種別の利益率の変化' });
      const cols = [...fy, ...ytd];
      body.replaceChildren(withTableToggle(chart, () => table([{ label: '業種', get: r => r.label }, { label: a.slice(0, 4), num: true, get: r => pct(r.a) }, { label: b.slice(0, 4), num: true, get: r => pct(r.b) }, { label: '社数', get: r => r.n }], rows)),
        h('h3', null, '期間ごとの中央値（社数）'),
        table([{ label: '業種', get: i => h('span', null, i.ja, h('br'), h('span', { class: 'muted', style: { fontSize: '11px' } }, i.sw_l3)), sort: i => i.ja },
          ...cols.map(k => ({ label: periodLabel(k), num: true, get: i => pct(m(i, k, metric).median) + ' (' + (m(i, k, metric).n || 0) + ')', sort: i => m(i, k, metric).median }))], inds),
        h('p', { class: 'note' }, '現在の所属企業を過去の期間にも当てはめた系列（現時点コホート）。年初累計（1〜9月など）は通期と混ぜずに、前年同期と比べてください。'),
        h('p', { class: 'source' }, '出典：同花順 F10「行業対比」（所属企業）、「財務概況」（销售毛利率・销售净利率）'));
    }
    draw();
    main.replaceChildren(industryPressureCard(inds, keys), card);
  }

  // ---------------------------------------------------------------- 画面：出典・方法
  function renderSources(main) {
    const cov = INDEX.coverage || {};
    const card = h('section', { class: 'card' }, h('h2', null, '出典・計算方法・取得状況'),
      h('h3', null, '読み方の注意'), h('ul', null, (INDEX.notes_ja || []).map(t => h('li', null, t))),
      h('h3', null, '出典'), h('ul', null, (INDEX.sources || []).map(sr => h('li', null,
        h('a', { href: sr.url, target: '_blank', rel: 'noopener' }, sr.name_ja), sr.terms_ja ? h('div', { class: 'note' }, '利用条件：' + sr.terms_ja) : null))),
      h('h3', null, '取得状況'),
      table([{ label: '項目', get: r => r[0] }, { label: '件数', num: true, get: r => String(r[1] ?? '—') }], [
        ['財務を取得した会社', cov.companies_finance], ['財務諸表（回転日数の計算）', cov.companies_statements],
        ['運営データ（製品別数量）', cov.companies_operate], ['事業別構成（東方財富）', cov.companies_segments],
        ['Gasgooのランキング記事（ADAS）', cov.gasgoo_articles], ['うち本文に数値がある記事', cov.gasgoo_text_articles],
        ['単価を計算できた組み合わせ', cov.unit_price_pairs]]),
      h('h3', null, '業種ごとの社数'),
      table([{ label: '業種', get: i => i.ja + '（' + i.sw_l3 + '）' }, { label: '表示', num: true, get: i => String(i.stated_count ?? '—') },
        { label: '一覧で確認', num: true, get: i => String(i.listed_count) }, { label: '財務を取得', num: true, get: i => String(i.with_finance) }], INDEX.industries),
      h('h3', null, 'Gasgoo ADAS記事の取得状況'),
      table([{ label: '記事', get: a => h('a', { href: a.url, target: '_blank', rel: 'noopener' }, a.title || a.url) },
        { label: '版', get: a => h('span', { style: { whiteSpace: 'nowrap' } }, a.language === 'en' ? '英語' : '中国語') },
        { label: '数値', get: a => h('span', { style: { whiteSpace: 'nowrap' } }, a.extraction === 'text_lines' ? '本文から ' + a.rows + '行' : a.extraction === 'image_only' ? '画像のみ（未抽出）' : '数値なし') }],
        (INDEX.articles || []).slice().sort((a, b) => (b.published_at || b.url) > (a.published_at || a.url) ? 1 : -1)),
      h('h3', null, '用語'), h('ul', null, [
        '通期＝12月期の1年。年初累計（1〜9月など）は通期と混ぜず、前年同期と比べる。単独四半期＝その3か月だけ。販売数量のランキングは、同じ期末に通期・累計・単独四半期の表があれば、比べられる社数が多い方（同数なら通期＞累計＞単独四半期）を使う。',
        '売掛金回転日数（手形を含む）＝期間日数×（期首＋期末の応収账款・应收票据・应收款项融资）÷2÷営業収入。',
        '買掛金回転日数（手形を含む）＝期間日数×（期首＋期末の应付账款・应付票据）÷2÷営業原価。',
        '平均単価＝製品別の売上高÷販売数量。同じ表・同じ期間の同じ製品名（「产品」「业务」などの語尾を除いて一致）か、同花順の数量と東方財富の同じ名前の事業区分を対応させた場合だけ。',
        '国籍区分＝最終支配者による。根拠が資料で確認できない会社は「判定保留」、本社所在地・上場地による場合は「暫定」。完成車メーカーの内製は国籍とは別の属性。'].map(t => h('li', null, t))));
    main.replaceChildren(card);
  }

  // ---------------------------------------------------------------- 企業詳細
  const panel = document.getElementById('panel');
  document.getElementById('panel-close').addEventListener('click', () => closePanel());
  panel.addEventListener('close', () => { if (location.hash.startsWith('#company/')) history.replaceState(null, '', lastView ? '#' + lastView : '#hyp'); });
  function closePanel() { if (panel.open) panel.close(); }
  function openCompany(code) { location.hash = '#company/' + code; }
  async function showCompany(code) {
    const body = document.getElementById('panel-body');
    document.getElementById('panel-title').textContent = '読み込み中…';
    body.replaceChildren();
    if (!panel.open) panel.showModal();
    let c;
    try { c = await load('company/' + encodeURIComponent(code) + '.json'); }
    catch (e) { body.replaceChildren(h('p', { class: 'empty' }, 'この企業の詳細はまだありません。')); document.getElementById('panel-title').textContent = code; return; }
    document.getElementById('panel-title').textContent = c.name + (code.startsWith('f_') ? '' : '（' + code + '）');
    const parts = [h('div', { class: 'row' }, ...attrChips(c.attrs), ...(c.industries || []).map(i => h('span', { class: 'chip' }, i.ja + '（' + i.sw_l3 + '）')))];
    if (c.attrs && c.attrs.region_basis_ja) parts.push(h('p', { class: 'note' }, '国籍区分の根拠：' + c.attrs.region_basis_ja + (c.controller && c.controller.actual_controller ? '（实际控制人：' + c.controller.actual_controller + '）' : '')));
    if (code.startsWith('f_')) {
      parts.push(h('p', { class: 'note' }, (c.hq_ja ? '本社：' + c.hq_ja + '。' : '') + (c.note_ja || '')));
      const refs = c.reference_financials || [];
      parts.push(h('h3', null, '参考財務情報'),
        h('p', { class: 'lead' }, '世界連結・事業別・地域別の公表値です。中国事業の利益率ではありません。申万業種の中央値や中国A株の利益率ランキングには含めていません。'),
        refs.length ? table([
          { label: '範囲', get: r => ({ world: '世界連結', asia_pacific: 'アジア太平洋', asia: 'アジア', china: '中国' }[r.scope] || r.scope) + (r.business_scope && r.business_scope !== 'group' ? '・' + r.business_scope : '') },
          { label: '指標（原資料の名称）', get: r => h('span', null, r.label_ja || r.metric_raw, h('br'), h('span', { class: 'muted', style: { fontSize: '11px' } }, r.metric_raw)) },
          { label: '値', num: true, get: r => r.unit === 'percent' ? pct(r.value) : (isNum(r.value) ? r.value.toLocaleString('ja-JP') : '—') + ' ' + ({ billion: '十億', million: '百万' }[r.unit] || r.unit || '') + (r.currency || '') },
          { label: '期間', get: r => r.period_start.slice(0, 7) + '〜' + r.period_end.slice(0, 7) },
          { label: '比較', get: r => ({ same_formula: '同花順と同じ式', company_defined: '会社独自の定義', scope_differs: '範囲が違う' }[r.comparability] || '') + (r.verified === 'partially_verified' ? '・検索抜粋で確認' : '') },
          { label: '出典', get: r => h('a', { href: r.source_url, target: '_blank', rel: 'noopener' }, r.source_page || '資料') }], refs)
          : h('p', { class: 'empty' }, '参考財務は未入力です（年1回の手入力。未確認の項目は空欄のまま）。'));
    } else {
      const keys = Object.keys(c.series || {}).sort();
      const cols = [...keys.filter(k => k.endsWith('|FY')), ...keys.filter(k => k.includes('|YTD')).slice(-2)];
      const metrics = [['revenue', '売上高', oku], ['gross_margin', '粗利益率', pct], ['net_margin', '純利益率', pct],
        ['ar_days_ths', '売掛金回転日数（同花順）', days], ['ar_notes_days', '売掛金回転日数（手形を含む・計算）', days],
        ['ap_notes_days', '買掛金回転日数（手形を含む・計算）', days], ['inventory_days', '在庫回転日数', days]];
      parts.push(h('h3', null, '会社全体の財務'), table([{ label: '指標', get: r => r[1] },
        ...cols.map(k => ({ label: periodLabel(k), num: true, get: r => r[2]((c.series[k] || {})[r[0]]) }))], metrics),
        h('p', { class: 'note' }, '年初累計は通期と混ぜずに前年同期と比べてください。回転日数の「計算」は同花順の財務報表から算出。'));
      if ((c.segments || []).length) {
        const sk = [...new Set(c.segments.flatMap(sg => Object.keys(sg.series)))].sort().slice(-4);
        parts.push(h('h3', null, '事業別の粗利益率（東方財富・製品別）'), table([{ label: '事業区分（原文）', get: sg => sg.item },
          ...sk.map(k => ({ label: periodLabel(k), num: true, get: sg => sg.series[k] ? pct(sg.series[k].gross) + '／' + pct(sg.series[k].ratio, 0) : '—' }))], c.segments),
          h('p', { class: 'note' }, '値は「粗利益率／売上構成比」。'));
      }
      if ((c.operations || []).length) {
        const ok = [...new Set(c.operations.flatMap(o => Object.keys(o.values)))].sort().slice(-6);
        parts.push(h('h3', null, '運営データ（会社開示の数量など）'), table([{ label: '項目（原文）', get: o => o.label },
          ...ok.map(k => ({ label: periodLabel(k) || k, num: true, get: o => o.values[k] != null ? vol(o.values[k]) : '—' }))], c.operations));
      }
    }
    if ((c.market_share || []).length) {
      parts.push(h('h3', null, '市場ランキングへの掲載（蓋世汽車研究院）'), table([{ label: '部品', get: r => r.market_ja }, { label: '期間', get: r => r.label_ja },
        { label: '順位', num: true, get: r => String(r.rank) }, { label: 'シェア', num: true, get: r => pct(r.share) },
        { label: '記事', get: r => h('a', { href: r.url, target: '_blank', rel: 'noopener' }, '開く') }],
        c.market_share.slice().sort((a, b) => (a.market_ja + b.period > b.market_ja + a.period ? 1 : -1))));
    }
    const src = c.sources || {};
    const links = [['財務概況', src.finance], ['財務報表', src.statements], ['運営データ', src.operate], ['会社資料', src.company], ['事業別構成', src.segments], ['根拠資料', c.evidence_url]].filter(x => x[1]);
    if (links.length) parts.push(h('p', { class: 'source' }, '出典：', ...links.flatMap(([n, u], i) => [i ? '、' : '', h('a', { href: u, target: '_blank', rel: 'noopener' }, n)])));
    body.replaceChildren(...parts.filter(Boolean));
  }

  // ---------------------------------------------------------------- ルーティング
  const main = document.getElementById('main');
  let lastView = 'hyp';
  let pendingAnchor = null;
  async function route() {
    const hash = decodeURIComponent(location.hash.replace(/^#/, '')) || 'hyp';
    if (hash.startsWith('company/')) {
      if (!main.dataset.view) await showView(lastView);
      showCompany(hash.slice(8));
      return;
    }
    closePanel();
    await showView(hash);
  }
  async function showView(view) {
    lastView = view;
    main.dataset.view = view;
    document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    try {
      if (view.startsWith('sector/')) {
        await renderSector(main, view.slice(7));
        if (pendingAnchor) { const el = document.getElementById(pendingAnchor); pendingAnchor = null; if (el) el.scrollIntoView(); }
      }
      else if (view === 'industries') renderIndustries(main);
      else if (view === 'sources') renderSources(main);
      else renderHypotheses(main);
    } catch (e) {
      main.replaceChildren(h('p', { class: 'empty' }, 'データを読み込めませんでした（' + e.message + '）。時間をおいて再読み込みしてください。'));
      console.error(e);
    }
  }
  document.getElementById('tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if (b) { location.hash = '#' + b.dataset.view; window.scrollTo({ top: 0 }); }
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('scroll', hideTip, { passive: true });

  (async () => {
    try {
      INDEX = await load('index.json');
      document.getElementById('meta').textContent = 'データ更新：' + (INDEX.data_updated || '—') +
        '｜出典：同花順・東方財富・蓋世汽車研究院（各表の下に記載）｜試作版';
      await route();
    } catch (e) {
      main.replaceChildren(h('p', { class: 'empty' }, 'データを読み込めませんでした（' + e.message + '）。'));
      document.getElementById('meta').textContent = '';
      console.error(e);
    }
  })();
})();
