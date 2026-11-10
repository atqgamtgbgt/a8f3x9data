
const RAW_BASE = "https://raw.githubusercontent.com/atqgamtgbgt/a8f3x9data/main/";

// データソース設定
const DATA_SOURCES = {
  autohome: {
    csvPath: `${RAW_BASE}output/pipeline/autohome-ranking-csvs/autohome_ranking_with_image_urls_with_maker_with_maker_ja.csv`,
    imgBase: `${RAW_BASE}output/pipeline/autohome-ranking-images/`,
    seriesUrlsPath: `${RAW_BASE}output/pipeline/autohome-series-urls/series_urls.csv`,
    configPath: 'output/autohome/',
    koubeiPath: 'output/koubei/'
  },
  hezi: {
    csvPath: `${RAW_BASE}output/pipeline/hezi/autohome-hezi-ranking-csvs/autohome_ranking_with_image_urls_with_maker_with_maker_ja.csv`,
    imgBase: `${RAW_BASE}output/pipeline/hezi/autohome-hezi-ranking-images/`,
    seriesUrlsPath: `${RAW_BASE}output/pipeline/autohome-series-urls/series_urls.csv`,
    configPath: 'output/autohome/',
    koubeiPath: 'output/koubei/'
  }
};

const CNY_JPY_FALLBACK = 23.9;  // 為替APIが使えない時の値（2026年7月時点の実勢レート。年に数回は見直し推奨）
let cnyToJpy = CNY_JPY_FALLBACK;
let seriesUrlsMaps = {
  autohome: {},
  hezi: {}
};
let currentSource = 'autohome';

async function fetchRate() {
  // 為替APIが遅い・社内ネットワークで遮断されている場合でもランキング表示を待たせないよう、4秒で打ち切る
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/CNY", ctrl ? { signal: ctrl.signal } : undefined);
    const data = await res.json();
    if (data?.rates?.JPY) cnyToJpy = data.rates.JPY;
  } catch {
    cnyToJpy = CNY_JPY_FALLBACK;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 総合・外資は同じCSVを使うので、ダウンロードは1回だけにして結果を共有する
const _seriesUrlsText = {};
async function fetchSeriesUrls(source) {
  try {
    const base = DATA_SOURCES[source].seriesUrlsPath;
    if (!_seriesUrlsText[base]) {
      _seriesUrlsText[base] = fetch(base + `?v=${Date.now()}`, { cache: "no-store" }).then(res => {
        if (!res.ok) throw new Error(res.statusText || ('HTTP ' + res.status));
        return res.text();
      });
    }
    const text = await _seriesUrlsText[base];
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });

    parsed.data.forEach(row => {
      if (row.series_id && row.config_url) {
        seriesUrlsMaps[source][row.series_id] = row.config_url;
      }
    });
    console.log(`Series URLs loaded for ${source}:`, Object.keys(seriesUrlsMaps[source]).length);
  } catch (err) {
    console.error(`Failed to load series URLs for ${source}:`, err);
  }
}

function formatCnyPrice(priceStr) {
  const value = String(priceStr ?? '').trim();
  if (!value) return '';
  const match = /^(\d+(?:\.\d+)?)(?:\s*[-~〜～]\s*(\d+(?:\.\d+)?))?\s*万(?:元)?$/.exec(value);
  if (!match) return /元$/.test(value) ? value : value + '元';
  const amount = part => new Intl.NumberFormat('ja-JP').format(Math.round(Number(part) * 10000));
  return amount(match[1]) + (match[2] ? '〜' + amount(match[2]) : '') + '元';
}

function convertToJPY(priceStr) {
  if (!priceStr) return "";
  // 「6.48-9.48万」のような価格帯と、「24.98万」のような単一価格の両方に対応
  const m = String(priceStr).match(/([\d.]+)\s*(?:[-~〜～]\s*([\d.]+))?\s*万/);
  if (!m) return "";
  const fmt = (v) => (parseFloat(v) * cnyToJpy).toFixed(1);
  return m[2] ? `（約${fmt(m[1])}〜${fmt(m[2])}万円）` : `（約${fmt(m[1])}万円）`;
}

function imgTag(rankStr, model, imageUrl, source, originalName) {
  const imgBase = DATA_SOURCES[source].imgBase;

  if (source === 'hezi') {
    // hezi: CSVのimage_url "public/autohome_images/100_99_xxx.png" からファイル名を取り出す
    if (imageUrl && imageUrl.startsWith("public/autohome_images/")) {
      const fileName = imageUrl.replace("public/autohome_images/", "");
      return `<img class="car-thumb" src="${imgBase}${fileName}?v=${window.IMG_CACHE_VER}" alt="${escHtml(model)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=window.CAR_PLACEHOLDER;" />`;
    }
    return "";
  }

  // autohome: CSVのimage_url（例 "/autohome_images/046_宋Pro新能源.png"）を使い、
  // ファイル名だけ取り出して imgBase に連結する（heziと同じ考え方）。
  if (imageUrl) {
    const fileName = imageUrl.split("/").pop();
    return `<img class="car-thumb" src="${imgBase}${fileName}?v=${window.IMG_CACHE_VER}" alt="${escHtml(model)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=window.CAR_PLACEHOLDER;" />`;
  }
  // フォールバック: image_url が無い場合のみ従来の推測方式
  const fileName = `${rankStr}_${model.replace(/ /g, '_')}.png`;
  return `<img class="car-thumb" src="${imgBase}${fileName}?v=${window.IMG_CACHE_VER}" alt="${escHtml(model)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=window.CAR_PLACEHOLDER;" />`;
}

// ランキング表に「読み込み中」「読み込み失敗」の1行を出す
function setTableStatus(tableId, kind) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;
  const html = kind === 'error'
    ? '<i class="fa-solid fa-triangle-exclamation me-2"></i>ランキングを読み込めませんでした。時間をおいてページを再読み込みしてください。'
    : '<span class="spinner-border spinner-border-sm text-primary me-2" role="status"></span>ランキングを読み込み中…';
  tbody.innerHTML = `<tr class="table-status"><td colspan="8" class="text-center py-4 ${kind === 'error' ? 'text-danger' : 'text-muted'}">${html}</td></tr>`;
}

async function loadData(source) {
  currentSource = source;
  const tableId = source === 'autohome' ? 'autohomeTable' : 'heziTable';
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (tbody && !tbody.rows.length) setTableStatus(tableId, 'loading');
  try {
    const csvPath = DATA_SOURCES[source].csvPath + `?v=${Date.now()}`;
    const res = await fetch(csvPath, { cache: "no-store" });
    if (!res.ok) throw new Error(res.statusText || ('HTTP ' + res.status));
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (!parsed.meta.fields?.includes("rank")) throw new Error("rank 列が見つかりません");

    renderTable(parsed.data, tableId, source);
    console.log(`✅ ${source === 'autohome' ? 'Autohome' : 'Hezi'} CSV 読み込み成功 (${parsed.data.length}件)`);
  } catch (err) {
    console.error(`${source === 'autohome' ? 'Autohome' : 'Hezi'} CSV 読み込みエラー: ` + err.message);
    setTableStatus(tableId, 'error');
  }
}

function renderTable(data, tableId, source) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = "";
  const esc = window.escHtml;
  data.forEach(r => {
    const rankStr = String(r.rank).padStart(3, "0");
    const diff = Number(r.delta_vs_last_month || 0);
    const diffHtml = diff > 0
      ? `<span class="rank-up">▲${diff}</span>`
      : diff < 0
      ? `<span class="rank-down">▼${-diff}</span>`
      : "";
    const link = r.link || "";
    const carId = link.match(/(\d+)/)?.[1] || "";
    const globalName = r.global_name || r.name || "";
    const originalName = r.name || "";

    // CSVの値はそのままHTMLに入れず、必ずエスケープする（車名に < や " が入っても表示が壊れないように）
    const displayName = (globalName && originalName && globalName !== originalName)
      ? `<div class="vehicle-name-wrapper">
           <div class="vehicle-name-main">${esc(globalName)}</div>
           <div class="vehicle-name-cn">${esc(originalName)}</div>
         </div>`
      : esc(globalName);

    const price = esc(formatCnyPrice(r.price || ""));
    const priceJPY = convertToJPY(r.price || "");
    const maker = esc(r.manufacturer_ja || r.manufacturer || "");
    const units = r.units ? parseInt(r.units).toLocaleString('ja-JP') + "台" : "";
    const btnData = `data-car="${esc(carId)}" data-name="${esc(globalName)}" data-src="${esc(source)}"`;
    const specBtn = carId
      ? `<button type="button" class="btn btn-outline-primary btn-sm btn-spec" data-act="spec" ${btnData}>仕様表</button>`
      : "";
    const storyBtn = carId
      ? `<button type="button" class="btn btn-outline-secondary btn-sm btn-story" data-act="story" ${btnData}>口コミ</button>`
      : "";
    const trendBtn = (carId && window.SERIES_HISTORY && window.SERIES_HISTORY[carId])
      ? `<button type="button" class="btn btn-sm btn-trend" data-act="trend" ${btnData} title="販売トレンド" aria-label="販売トレンド">📈</button>`
      : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="rank-badge">${esc(r.rank)}</td>
      <td class="diff-badge">${diffHtml}</td>
      <td>${imgTag(rankStr, originalName, r.image_url, source, originalName)}</td>
      <td><a href="${esc(safeUrl(link))}" target="_blank" rel="noopener">${displayName}</a></td>
      <td>${maker}</td>
      <td style="white-space: nowrap;">${units}</td>
      <td>${price}<br><span class="price-jpy">${priceJPY}</span></td>
      <td>${specBtn}${storyBtn}${trendBtn}</td>`;
    tbody.appendChild(tr);
  });
}

// 仕様表・口コミ・トレンドのボタン（全ランキング表共通）。
// 以前は onclick="showConfigCsv('id','車名',…)" と文字列で埋め込んでいたため、
// 車名に ' が入るとクリックしても反応しなかった。data属性＋イベント委譲に変更。
document.addEventListener('click', function (e) {
  const b = e.target.closest ? e.target.closest('button[data-act]') : null;
  if (!b || !b.closest('.car-table')) return;
  const car = b.getAttribute('data-car') || '';
  const name = b.getAttribute('data-name') || '';
  const src = b.getAttribute('data-src') || 'autohome';
  const act = b.getAttribute('data-act');
  if (act === 'spec') showConfigCsv(car, name, src);
  else if (act === 'story') showStory(car, name, src);
  else if (act === 'trend') showTrend(car, name);
});

function openFullSpec() {
  const html = document.getElementById("csvContent").innerHTML;
  const title = document.getElementById("csvModalLabel").textContent;
  const configUrl = window.currentConfigUrl || '';
  
  const allStyles = document.querySelector('style').textContent;
  
  const sectionRows = document.querySelectorAll('.spec-table tbody tr.sec-row');
  let selectOptions = '';
  sectionRows.forEach(row => {
    const sectionName = row.getAttribute('data-section');
    const sectionId = row.id;
    if (sectionName && sectionId) {
      selectOptions += `<option value="#${escHtml(sectionId)}">${escHtml(sectionName)}</option>`;
    }
  });
  
  const fullHTML = `
    <!DOCTYPE html>
    <html lang="ja">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes">
        <title>${escHtml(title)}</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
        <style>
          ${allStyles}
          
          * {
            -webkit-overflow-scrolling: touch !important;
          }
          
          html, body { 
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            height: 100% !important;
            overflow: hidden !important;
            background: #f8f9fa !important;
            position: fixed !important;
          }
          
          .fullscreen-container {
            display: flex !important;
            flex-direction: column !important;
            height: 100vh !important;
            width: 100vw !important;
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
          }
          
          .fullscreen-modal-header {
            background: #fff !important;
            padding: 1rem !important;
            border-bottom: 1px solid #dee2e6 !important;
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            gap: 0.5rem !important;
            flex-shrink: 0 !important;
            position: relative !important;
            z-index: 2000 !important;
          }
          
          .fullscreen-modal-header h5 {
            margin: 0 !important;
            font-size: 1.25rem !important;
            flex: 1 !important;
          }
          
          .fullscreen-modal-body {
            flex: 1 !important;
            overflow: hidden !important;
            background: #fff !important;
            position: relative !important;
          }
          
          #specScrollArea,
          #specScrollArea .table-responsive {
            height: 100% !important;
            width: 100% !important;
            overflow: auto !important;
            -webkit-overflow-scrolling: touch !important;
            position: relative !important;
          }
          
          .close-fullscreen {
            background: transparent !important;
            border: none !important;
            font-size: 1.5rem !important;
            opacity: 0.5 !important;
            cursor: pointer !important;
            padding: 0 !important;
            width: 1em !important;
            height: 1em !important;
            line-height: 1 !important;
            flex-shrink: 0 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
          }
          
          .close-fullscreen:hover {
            opacity: 1 !important;
          }
          
          .legend-text {
            font-size: 0.85rem !important;
            color: #6c757d !important;
            white-space: nowrap !important;
            margin-left: auto !important;
            margin-right: 1rem !important;
            order: 7 !important;
          }
          
          .section-toggle {
            position: static !important;
            transform: none !important;
            width: auto !important;
            padding: 0 !important;
            pointer-events: auto !important;
            flex: 1 !important;
            order: 1 !important;
          }
          
          .section-toggle select {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            display: block !important;
            pointer-events: auto !important;
            background: #fff !important;
          }
          
          .close-fullscreen {
            order: 10 !important;
          }
          
          .source-link-fullscreen {
            color: #0d6efd !important;
            text-decoration: none !important;
            font-size: 0.9rem !important;
            margin-right: 1rem !important;
            order: 8 !important;
            white-space: nowrap !important;
          }
          
          .source-link-fullscreen:hover {
            text-decoration: underline !important;
          }
          
          @media (max-width: 991px) {
            .source-link-fullscreen {
              background: #0d6efd !important;
              color: white !important;
              padding: 0.25rem 0.5rem !important;
              border-radius: 4px !important;
              font-size: 0.875rem !important;
              order: 0 !important;
            }
            
            .source-link-fullscreen:hover {
              background: #0b5ed7 !important;
              text-decoration: none !important;
            }
          }
          
          .spec-table thead th {
            position: -webkit-sticky !important;
            position: sticky !important;
            top: 0 !important;
            z-index: 30 !important;
            background: #fff !important;
            will-change: transform !important;
          }
          
          .spec-table thead th.sticky-col {
            position: -webkit-sticky !important;
            position: sticky !important;
            left: 0 !important;
            z-index: 31 !important;
            background: #fff !important;
            will-change: transform !important;
          }
          
          .spec-table tbody th.item-col {
            position: -webkit-sticky !important;
            position: sticky !important;
            left: 0 !important;
            z-index: 12 !important;
            background: #fff !important;
            will-change: transform !important;
          }
          
          .spec-table tbody tr.sec-row .section-col {
            position: -webkit-sticky !important;
            position: sticky !important;
            left: 0 !important;
            top: var(--secOffset, 42px) !important;
            background: #f8f9fa !important;
            will-change: transform !important;
          }
          
          .spec-table tbody tr.sec-row .section-fill {
            position: -webkit-sticky !important;
            position: sticky !important;
            top: var(--secOffset, 42px) !important;
            background: #f8f9fa !important;
            will-change: transform !important;
          }
          
          @media (max-width: 991px) {
            .fullscreen-modal-header h5 {
              display: none !important;
            }
            
            .legend-text {
              display: none !important;
            }
            
            .spec-table tbody tr.sec-row .section-fill {
              left: 99px !important;
            }
            
            .spec-table thead th.sticky-col,
            .spec-table tbody th.item-col {
              min-width: 100px !important;
              max-width: 100px !important;
              width: 100px !important;
            }
            
            .spec-table tbody tr.sec-row .section-col {
              min-width: 100px !important;
              max-width: 100px !important;
              width: 100px !important;
            }
          }
          
          @media (min-width: 992px) {
            .section-toggle {
              display: none !important;
            }
            
            .legend-text {
              display: block !important;
            }
            
            .fullscreen-modal-header h5 {
              display: block !important;
            }
            
            .spec-table tbody tr.sec-row .section-fill {
              left: 179px !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="fullscreen-container">
          <div class="fullscreen-modal-header" id="modalHeader">
            <h5 id="modalTitle">${escHtml(title)}</h5>
            ${configUrl ? `<a href="${escHtml(safeUrl(configUrl))}" target="_blank" rel="noopener" class="source-link-fullscreen">引用元ページ</a>` : ''}
            <span class="legend-text">●：標準装備　〇：オプション装備</span>
            <button type="button" class="close-fullscreen" onclick="window.close()" aria-label="閉じる">×</button>
          </div>
          <div class="fullscreen-modal-body">
            ${html}
          </div>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"><\/script>
        <script>
          function forceSticky() {
            const allSticky = document.querySelectorAll('.spec-table thead th, .spec-table tbody th.item-col, .spec-table tbody tr.sec-row .section-col, .spec-table tbody tr.sec-row .section-fill');
            allSticky.forEach(el => {
              el.style.setProperty('position', 'sticky', 'important');
              el.style.setProperty('-webkit-position', 'sticky', 'important');
            });
          }
          
          function initFullscreen() {
            const scrollArea = document.querySelector("#specScrollArea .table-responsive") || document.getElementById("specScrollArea");
            if (!scrollArea) {
              setTimeout(initFullscreen, 100);
              return;
            }
            
            const theadEl = scrollArea.querySelector(".spec-table thead");
            const theadH = theadEl ? Math.ceil(theadEl.getBoundingClientRect().height) : 0;
            
            scrollArea.style.setProperty("--secOffset", theadH + "px");
            
            document.querySelectorAll('.spec-table tbody tr.sec-row').forEach((row, index) => {
              const baseZ = 100;
              const colEl = row.querySelector('.section-col');
              const fillEl = row.querySelector('.section-fill');
              if (colEl) {
                colEl.style.setProperty('position', 'sticky', 'important');
                colEl.style.setProperty('z-index', (baseZ + index * 2 + 1).toString(), 'important');
              }
              if (fillEl) {
                fillEl.style.setProperty('position', 'sticky', 'important');
                fillEl.style.setProperty('z-index', (baseZ + index * 2).toString(), 'important');
              }
            });
            
            forceSticky();
            
            const modalHeader = document.getElementById('modalHeader');
            const closeBtn = modalHeader.querySelector('.close-fullscreen');
            const existingLegend = modalHeader.querySelector('.legend-text');
            
            if (window.innerWidth <= 991) {
              if (existingLegend) {
                existingLegend.remove();
              }
              
              const toggleDiv = document.createElement('div');
              toggleDiv.className = 'section-toggle';
              toggleDiv.innerHTML = '<select id="sectionSelect" class="form-select">' + ${JSON.stringify(selectOptions).replace(/</g, '\\u003c')} + '</select>';
              modalHeader.insertBefore(toggleDiv, closeBtn);
              
              document.querySelectorAll('.spec-table tbody th.item-col:not(.section-col)').forEach(el => {
                el.style.setProperty('min-width', '100px', 'important');
                el.style.setProperty('max-width', '100px', 'important');
                el.style.setProperty('width', '100px', 'important');
              });
              
              document.querySelectorAll('.spec-table tbody tr.sec-row th.section-col').forEach(el => {
                el.style.setProperty('min-width', '100px', 'important');
                el.style.setProperty('max-width', '100px', 'important');
                el.style.setProperty('width', '100px', 'important');
              });
              
              document.querySelectorAll('.spec-table tbody tr.sec-row .section-fill').forEach(el => {
                el.style.setProperty('left', '99px', 'important');
              });
              
              const select = document.getElementById("sectionSelect");
              if (select) {
                select.addEventListener("change", e => {
                  const id = e.target.value;
                  const el = document.querySelector(id);
                  if (el && scrollArea) {
                    const offset = el.offsetTop - theadH;
                    scrollArea.scrollTo({top: offset, behavior: "smooth"});
                  }
                });
              }
            }
            
            document.querySelectorAll(".spec-sidebar a").forEach(a => {
              a.addEventListener("click", ev => {
                ev.preventDefault();
                const id = a.getAttribute("href");
                const el = document.querySelector(id);
                if (el && scrollArea) {
                  const offset = el.offsetTop - theadH;
                  scrollArea.scrollTo({top: offset, behavior: "smooth"});
                }
              });
            });
          }
          
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
              setTimeout(initFullscreen, 200);
              setTimeout(forceSticky, 500);
            });
          } else {
            setTimeout(initFullscreen, 200);
            setTimeout(forceSticky, 500);
          }
        <\/script>
      </body>
    </html>
  `;
  
  try {
    const blob = new Blob([fullHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    
    if (!w || w.closed || typeof w.closed == 'undefined') {
      throw new Error('Popup blocked');
    }
    
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e) {
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(fullHTML);
    const w = window.open(dataUrl, '_blank');
    
    if (!w || w.closed || typeof w.closed == 'undefined') {
      alert('ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。');
    }
  }
}

function showConfigCsv(carId, title, source) {
  const path = `output/autohome/${encodeURIComponent(carId)}/config_${encodeURIComponent(carId)}.ja.csv?v=${Date.now()}`;
  const target = document.getElementById("csvContent");
  const modalEl = document.getElementById("csvModal");
  const modalHeader = modalEl.querySelector('.modal-header');
  const closeBtn = modalHeader.querySelector('.btn-close');
  const esc = window.escHtml;
  // 別の車種を続けて開いた時に、遅れて届いた前の車種の結果で上書きしないための番号
  const token = (showConfigCsv._token = (showConfigCsv._token || 0) + 1);

  const configUrl = (seriesUrlsMaps[source] || {})[carId] || seriesUrlsMaps.autohome[carId] || seriesUrlsMaps.hezi[carId] || '';
  window.currentConfigUrl = configUrl;

  document.getElementById("csvModalLabel").textContent = `車両仕様（${title}）`;
  // 前に開いた車種のヘッダー部品（引用元リンク・凡例・セクション選択・全画面ボタン）を消す
  modalHeader.querySelectorAll('.legend-text, .section-toggle, .btn-open-full, .source-link-btn, .source-link-pc').forEach(el => el.remove());

  // 読み込みの完了を待たずにモーダルを開く（以前は読み込み中や失敗時に、押しても何も起きなかった）
  target.innerHTML = '<div class="d-flex align-items-center justify-content-center gap-2 text-muted py-5">' +
    '<span class="spinner-border spinner-border-sm text-primary" role="status"></span>仕様表を読み込み中…</div>';
  bootstrap.Modal.getOrCreateInstance(modalEl).show();

  const showError = (msg) => {
    if (token !== showConfigCsv._token) return;
    target.innerHTML = `<div class="text-danger text-center py-5"><i class="fa-solid fa-triangle-exclamation me-2"></i>${esc(msg)}</div>`;
  };

  Papa.parse(path, {
    download: true,
    header: false,
    skipEmptyLines: false,
    complete: (res) => {
      if (token !== showConfigCsv._token) return;
      const rows = (res.data || []).map(r => (r || []).map(v => (v ?? "").toString().trim()));
      if (!rows.some(r => r.some(v => v))) { showError("この車種の仕様表データはまだありません。"); return; }

      const headerIdx = rows.findIndex(r => r.some(v => /^項目(_ja)?$/.test((v || "").trim())));
      if (headerIdx === -1) { showError("この車種の仕様表データはまだありません（形式を読み取れませんでした）。"); return; }

      const headerRow = rows[headerIdx];
      const idxSecJa  = headerRow.findIndex(v => (v || "").trim() === "セクション_ja");
      const idxSec    = headerRow.findIndex(v => (v || "").trim() === "セクション");
      const secIdx    = (idxSecJa !== -1 ? idxSecJa : idxSec);
      const idxItemJa = headerRow.findIndex(v => (v || "").trim() === "項目_ja");
      const idxItem   = headerRow.findIndex(v => (v || "").trim() === "項目");
      const itemIdx   = (idxItemJa !== -1 ? idxItemJa : idxItem);
      const modelStart = Math.max(secIdx, itemIdx) + 1;
      const modelHeaders = headerRow.slice(modelStart);
      const dataRows = rows.slice(headerIdx + 1);

      const grouped = [];
      let currentSection = "";
      for (const r of dataRows) {
        const sec = (r[secIdx] || "").trim();
        if (sec && sec.toLowerCase() !== "nan") currentSection = sec;
        if (!currentSection) continue;
        const item = (r[itemIdx] || "").trim();
        if (!item || /^(セクション|セクション_ja|項目|項目_ja)$/i.test(item)) continue;
        const cols = r.slice(modelStart);
        if (!grouped.length || grouped[grouped.length - 1].section !== currentSection)
          grouped.push({ section: currentSection, rows: [] });
        grouped[grouped.length - 1].rows.push([item, ...cols]);
      }
      if (!grouped.length) { showError("この車種の仕様表データはまだありません。"); return; }

      // セクションのIDは番号で振る（名前から作ると、記号を含む名前で目次ジャンプが動かなくなるため）
      const secId = (i) => `sec_${i}`;
      const options = grouped.map((g, i) => `<option value="#${secId(i)}">${esc(g.section)}</option>`).join("");

      const navHtml = `
        <div class="spec-sidebar d-none d-lg-block">
          <ul class="list-unstyled m-0 p-0">
            ${grouped.map((g, i) => `<li><a href="#${secId(i)}" class="text-decoration-none d-block py-1">${esc(g.section)}</a></li>`).join("")}
          </ul>
        </div>`;

      const thead = `<thead><tr><th class="sticky-col" style="min-width:180px;"></th>${modelHeaders.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>`;
      let tbody = "<tbody>";
      grouped.forEach((g, i) => {
        tbody += `
          <tr id="${secId(i)}" class="sec-row" data-section="${esc(g.section)}">
            <th class="item-col section-col">▼ ${esc(g.section)}</th>
            <td colspan="${modelHeaders.length}" class="section-fill"></td>
          </tr>`;
        for (const row of g.rows) {
          const item = row[0] || "";
          const cells = row.slice(1).map(v => `<td style="white-space:pre-line;">${esc((v || "").replace(/^nan$/i, ""))}</td>`).join("");
          tbody += `<tr><th class="item-col">${esc(item)}</th>${cells}</tr>`;
        }
      });
      tbody += "</tbody>";

      target.innerHTML = `
        <div class="spec-table-container d-flex">
          ${navHtml}
          <div class="spec-content p-2 flex-grow-1 overflow-auto" id="specScrollArea">
            <div class="table-responsive">
              <table class="table table-bordered table-sm spec-table mb-0">
                ${thead}${tbody}
              </table>
            </div>
          </div>
        </div>`;

      if (window.innerWidth <= 991) {
        if (configUrl) {
          const sourceBtn = document.createElement('a');
          sourceBtn.className = 'source-link-btn';
          sourceBtn.href = safeUrl(configUrl);
          sourceBtn.target = '_blank';
          sourceBtn.rel = 'noopener';
          sourceBtn.textContent = '引用元';
          modalHeader.insertBefore(sourceBtn, closeBtn);
        }

        const toggleDiv = document.createElement('div');
        toggleDiv.className = 'section-toggle';
        toggleDiv.innerHTML = `<select id="sectionSelect" aria-label="セクションへ移動">${options}</select>`;
        modalHeader.insertBefore(toggleDiv, closeBtn);
      } else {
        // PC版：引用元ページリンクを凡例の左に追加
        if (configUrl) {
          const sourceLink = document.createElement('a');
          sourceLink.href = safeUrl(configUrl);
          sourceLink.target = '_blank';
          sourceLink.rel = 'noopener';
          sourceLink.className = 'source-link-pc';
          sourceLink.textContent = '引用元ページ';
          modalHeader.insertBefore(sourceLink, closeBtn);
        }

        const legendSpan = document.createElement('span');
        legendSpan.className = 'legend-text';
        legendSpan.textContent = '●：標準装備　〇：オプション装備';
        modalHeader.insertBefore(legendSpan, closeBtn);
      }

      const fullBtn = document.createElement("button");
      fullBtn.type = "button";
      fullBtn.className = "btn-open-full";
      fullBtn.setAttribute("title", "全画面表示");
      fullBtn.setAttribute("aria-label", "仕様表を全画面で開く");
      fullBtn.innerHTML = '<i class="fa-solid fa-expand"></i>';
      fullBtn.onclick = () => openFullSpec();
      modalHeader.insertBefore(fullBtn, closeBtn);

      if (window.innerWidth <= 991) {
        document.querySelectorAll('.spec-table tbody th.item-col:not(.section-col)').forEach(el => {
          el.style.minWidth = '100px';
          el.style.maxWidth = '100px';
          el.style.width = '100px';
        });

        document.querySelectorAll('.spec-table tbody tr.sec-row th.section-col').forEach(el => {
          el.style.minWidth = '200px';
          el.style.maxWidth = '200px';
          el.style.width = '200px';
        });

        document.querySelectorAll('.spec-table tbody tr.sec-row .section-fill').forEach(el => {
          el.style.left = '199px';
        });
      }

      document.querySelectorAll('.spec-table tbody tr.sec-row').forEach((row, index) => {
        const baseZ = 100;
        const colEl = row.querySelector('.section-col');
        const fillEl = row.querySelector('.section-fill');
        if (colEl) colEl.style.zIndex = baseZ + index * 2 + 1;
        if (fillEl) fillEl.style.zIndex = baseZ + index * 2;
      });

      // ドラッグでのスクロールと目次ジャンプの設定（表の寸法を測るので、モーダルが表示されてから行う）
      const setup = () => {
        if (token !== showConfigCsv._token) return;
        const scrollArea =
          document.querySelector("#specScrollArea .table-responsive")?.scrollHeight > 0
            ? document.querySelector("#specScrollArea .table-responsive")
            : document.getElementById("specScrollArea");
        if (!scrollArea) return;
        const theadEl = scrollArea.querySelector(".spec-table thead");
        const theadH = theadEl ? Math.ceil(theadEl.getBoundingClientRect().height) : 0;
        scrollArea.style.setProperty("--secOffset", theadH + "px");
        const headerHeight = theadH;

        let isDown = false;
        let startX;
        let startY;
        let scrollLeft;
        let scrollTop;

        scrollArea.addEventListener('mousedown', (e) => {
          if (e.target.tagName === 'A' || e.target.closest('a') || e.target.tagName === 'BUTTON') return;

          isDown = true;
          scrollArea.classList.add('active-drag');
          startX = e.pageX - scrollArea.offsetLeft;
          startY = e.pageY - scrollArea.offsetTop;
          scrollLeft = scrollArea.scrollLeft;
          scrollTop = scrollArea.scrollTop;

          scrollArea.style.scrollBehavior = 'auto';
        });

        scrollArea.addEventListener('mouseleave', () => {
          isDown = false;
          scrollArea.classList.remove('active-drag');
        });

        scrollArea.addEventListener('mouseup', () => {
          isDown = false;
          scrollArea.classList.remove('active-drag');
        });

        scrollArea.addEventListener('mousemove', (e) => {
          if (!isDown) return;
          e.preventDefault();
          const x = e.pageX - scrollArea.offsetLeft;
          const y = e.pageY - scrollArea.offsetTop;
          const walkX = (x - startX);
          const walkY = (y - startY);

          requestAnimationFrame(() => {
            scrollArea.scrollLeft = scrollLeft - walkX;
            scrollArea.scrollTop = scrollTop - walkY;
          });
        });

        scrollArea.style.cursor = 'grab';

        const jumpTo = (hash) => {
          const el = document.getElementById(String(hash || '').replace(/^#/, ''));
          if (!el) return;
          scrollArea.style.scrollBehavior = 'smooth';
          scrollArea.scrollTo({ top: el.offsetTop - headerHeight, behavior: "smooth" });
        };
        document.querySelectorAll("#csvContent .spec-sidebar a").forEach(a => {
          a.addEventListener("click", ev => { ev.preventDefault(); jumpTo(a.getAttribute("href")); });
        });
        const select = document.getElementById("sectionSelect");
        if (select) select.addEventListener("change", e => jumpTo(e.target.value));
      };
      if (modalEl.classList.contains('show')) requestAnimationFrame(setup);
      else modalEl.addEventListener('shown.bs.modal', setup, { once: true });
    },
    error: () => showError("仕様表を読み込めませんでした。この車種のデータがまだ無いか、通信エラーです。")
  });
}

async function showStory(carId, title, source){
  const path = `output/koubei/${encodeURIComponent(carId)}/story.txt?v=${Date.now()}`;
  const target = document.getElementById("storyContent");
  const modalEl = document.getElementById("storyModal");
  const koubeiUrl = `https://k.autohome.com.cn/${encodeURIComponent(carId)}#pvareaid=3454440`;
  const token = (showStory._token = (showStory._token || 0) + 1);

  document.getElementById("storyModalLabel").textContent = `口コミ概要（${title}）`;

  const modalHeader = modalEl.querySelector('.modal-header');
  const closeBtn = modalHeader.querySelector('.btn-close');
  modalHeader.querySelectorAll('.source-link-btn, .source-link-pc').forEach(el => el.remove());
  const sourceLink = document.createElement('a');
  sourceLink.href = koubeiUrl;
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener';
  if (window.innerWidth <= 991) {
    sourceLink.className = 'source-link-btn';  // スマホ版：ボタンスタイル
    sourceLink.textContent = '引用元';
  } else {
    sourceLink.className = 'source-link-pc';   // PC版：テキストリンク
    sourceLink.textContent = '引用元ページ';
  }
  modalHeader.insertBefore(sourceLink, closeBtn);

  // 読み込みの完了を待たずにモーダルを開く
  target.innerHTML = '<div class="d-flex align-items-center justify-content-center gap-2 text-muted py-4">' +
    '<span class="spinner-border spinner-border-sm text-primary" role="status"></span>口コミを読み込み中…</div>';
  bootstrap.Modal.getOrCreateInstance(modalEl).show();

  try{
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error("Not found");
    // 本文を先にエスケープしてから、見出し・太字・箇条書きだけをHTMLに変換する
    let text = window.escHtml(await res.text());
    if (token !== showStory._token) return;
    text=text.replace(/```/g,"");
    text=text.replace(/^### (.*)$/gm,"<h6 class='mt-3 mb-2 fw-bold'>$1</h6>");
    text=text.replace(/\*\*(.*?)\*\*/g,"<b>$1</b>");
    // 箇条書き（- で始まる行）を見やすく整形
    text=text.replace(/^- (.*)$/gm,"<div style='margin-bottom: 0.5em; padding-left: 1em; text-indent: -1em;'>• $1</div>");
    text=text.replace(/\r?\n/g,"<br>");
    text=text.replace(/(<br>\s*){2,}/g,"<br><br>");
    // 連続する<br>と<div>の間の<br>を削除
    text=text.replace(/<br>(<div)/g,"$1");
    text=text.replace(/(<\/div>)<br>/g,"$1");
    target.innerHTML=`<div style="white-space:normal; line-height:1.7;">${text}</div>`;
  }catch{
    if (token !== showStory._token) return;
    target.innerHTML="<div class='text-danger text-center py-4'>この車種の口コミデータはまだありません。</div>";
  }
}

// ===== ブランド概略タブ用 =====

const LOGO_BASE = `${RAW_BASE}output/logo/`;

// ロゴを読み込む
function loadLogos() {
  // 企業カードのロゴ
  document.querySelectorAll('.company-card[data-logo], .private-card[data-logo]').forEach(card => {
    const logoFile = card.dataset.logo;
    if (logoFile) {
      const placeholder = card.querySelector('.logo-placeholder');
      // 既に画像があればスキップ
      if (placeholder && !placeholder.querySelector('img')) {
        const img = document.createElement('img');
        img.src = LOGO_BASE + encodeURIComponent(logoFile);
        img.alt = '';
        img.onerror = () => { img.style.display = 'none'; };
        img.onload = () => { placeholder.classList.add('has-logo'); };
        placeholder.innerHTML = '';
        placeholder.appendChild(img);
      }
    }
  });
  
  // ブランドリスト内のミニロゴ
  document.querySelectorAll('.brand-logo-mini[data-logo]').forEach(el => {
    const logoFile = el.dataset.logo;
    // 既に画像があればスキップ
    if (logoFile && !el.querySelector('img')) {
      const img = document.createElement('img');
      img.src = LOGO_BASE + encodeURIComponent(logoFile);
      img.alt = '';
      img.onerror = () => { img.style.display = 'none'; };
      img.onload = () => { el.classList.add('has-logo'); };
      el.appendChild(img);
    }
  });
  
  // スマホ用：ミニロゴのタップで拡大（重複登録防止）
  document.querySelectorAll('.brand-logo-mini:not([data-tap-ready])').forEach(el => {
    el.setAttribute('data-tap-ready', 'true');
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const isEnlarged = el.classList.contains('enlarged');
      // 他の拡大中のロゴを閉じる
      document.querySelectorAll('.brand-logo-mini.enlarged').forEach(other => {
        other.classList.remove('enlarged');
      });
      // クリックしたロゴをトグル
      if (!isEnlarged) {
        el.classList.add('enlarged');
      }
    });
  });
  
  // 他の場所をタップで閉じる（一度だけ登録）
  if (!window._logoCloseListenerAdded) {
    window._logoCloseListenerAdded = true;
    document.addEventListener('click', () => {
      document.querySelectorAll('.brand-logo-mini.enlarged').forEach(el => {
        el.classList.remove('enlarged');
      });
    });
  }
  
  // Huaweiセクションのロゴ（ブランドロゴ）
  document.querySelectorAll('.huawei-brand-card[data-logo]').forEach(card => {
    const logoFile = card.dataset.logo;
    const logoContainer = card.querySelector('.huawei-brand-logo');
    if (logoFile && logoContainer && !logoContainer.querySelector('img')) {
      const img = document.createElement('img');
      img.src = LOGO_BASE + encodeURIComponent(logoFile);
      img.alt = '';
      img.onerror = () => { img.style.display = 'none'; };
      logoContainer.appendChild(img);
    }
  });

  // OEMロゴ（data-logoの有無に関わらず全カード対象）
  document.querySelectorAll('.huawei-brand-card[data-oem-logo]').forEach(card => {
    const oemLogoFile = card.dataset.oemLogo;
    const oemLogoContainer = card.querySelector('.huawei-oem-logo');
    if (oemLogoFile && oemLogoContainer && !oemLogoContainer.querySelector('img')) {
      const img = document.createElement('img');
      img.src = LOGO_BASE + encodeURIComponent(oemLogoFile);
      img.alt = '';
      img.onerror = () => { img.style.display = 'none'; };
      oemLogoContainer.appendChild(img);
    }
  });
  
  // Huaweiメインロゴ
  const huaweiMain = document.querySelector('.huawei-logo-main[data-logo]');
  if (huaweiMain) {
    const logoFile = huaweiMain.dataset.logo;
    if (logoFile && !huaweiMain.querySelector('img')) {
      const img = document.createElement('img');
      img.src = LOGO_BASE + encodeURIComponent(logoFile);
      img.alt = '';
      img.onerror = () => { img.style.display = 'none'; };
      huaweiMain.appendChild(img);
    }
  }
}

// 線を描画（ラベルなし）
function drawJvLines() {
  const svg = document.getElementById('jvLines');
  if (!svg) return;
  
  const diagram = document.getElementById('jvDiagram');
  const diagramRect = diagram.getBoundingClientRect();
  
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${diagram.offsetWidth} ${diagram.offsetHeight}`);
  
  const chinaCards = document.querySelectorAll('.china-card');
  
  chinaCards.forEach(chinaCard => {
    const chinaId = chinaCard.dataset.id;
    const partners = chinaCard.dataset.partners.split(',');
    
    partners.forEach(partnerId => {
      const foreignCard = document.querySelector(`.foreign-card[data-id="${partnerId}"]`);
      if (!foreignCard) return;
      
      const chinaRect = chinaCard.getBoundingClientRect();
      const foreignRect = foreignCard.getBoundingClientRect();
      
      const x1 = chinaRect.left - diagramRect.left + chinaRect.width / 2;
      const y1 = chinaRect.top - diagramRect.top + chinaRect.height;
      const x2 = foreignRect.left - diagramRect.left + foreignRect.width / 2;
      const y2 = foreignRect.top - diagramRect.top;
      
      const midY = (y1 + y2) / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
      path.setAttribute('class', 'jv-line');
      path.dataset.china = chinaId;
      path.dataset.foreign = partnerId;
      svg.appendChild(path);
    });
  });
}

// ハイライト機能
function setupJvHighlight() {
  const allCards = document.querySelectorAll('.company-card');
  
  allCards.forEach(card => {
    card.addEventListener('mouseenter', () => {
      const cardId = card.dataset.id;
      const partners = card.dataset.partners ? card.dataset.partners.split(',') : [];
      
      card.classList.add('highlighted');
      
      partners.forEach(partnerId => {
        const partnerCard = document.querySelector(`.company-card[data-id="${partnerId}"]`);
        if (partnerCard) {
          partnerCard.classList.add('highlighted');
        }
      });
      
      document.querySelectorAll('.jv-line').forEach(line => {
        if (line.dataset.china === cardId || line.dataset.foreign === cardId) {
          line.classList.add('visible');
        }
      });
    });
    
    card.addEventListener('mouseleave', () => {
      document.querySelectorAll('.company-card').forEach(c => {
        c.classList.remove('highlighted');
      });
      document.querySelectorAll('.jv-line').forEach(l => {
        l.classList.remove('visible');
      });
    });
    
    // タッチデバイス対応
    card.addEventListener('touchstart', (e) => {
      // ブランドトグルへのタッチは無視（別途処理）
      if (e.target.closest('.brands-toggle') || e.target.closest('.brands-list')) {
        return;
      }
      
      e.preventDefault();
      const cardId = card.dataset.id;
      const partners = card.dataset.partners ? card.dataset.partners.split(',') : [];
      
      document.querySelectorAll('.company-card').forEach(c => c.classList.remove('highlighted'));
      document.querySelectorAll('.jv-line').forEach(l => l.classList.remove('visible'));
      
      card.classList.add('highlighted');
      
      partners.forEach(partnerId => {
        const partnerCard = document.querySelector(`.company-card[data-id="${partnerId}"]`);
        if (partnerCard) {
          partnerCard.classList.add('highlighted');
        }
      });
      
      document.querySelectorAll('.jv-line').forEach(line => {
        if (line.dataset.china === cardId || line.dataset.foreign === cardId) {
          line.classList.add('visible');
        }
      });
    });
  });
  
  document.addEventListener('touchstart', (e) => {
    if (!e.target.closest('.company-card')) {
      document.querySelectorAll('.company-card').forEach(c => c.classList.remove('highlighted'));
      document.querySelectorAll('.jv-line').forEach(l => l.classList.remove('visible'));
    }
  });
}

// ブランドリスト展開
function setupBrandToggle() {
  document.querySelectorAll('.brands-toggle').forEach(toggle => {
    // クリックとタッチ両対応
    const handleToggle = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const card = toggle.closest('.company-card, .private-card');
      const brandsList = toggle.nextElementSibling;
      
      // 他を閉じる
      document.querySelectorAll('.brands-list.show').forEach(list => {
        if (list !== brandsList) {
          list.classList.remove('show');
          list.closest('.company-card, .private-card')?.classList.remove('brands-open');
        }
      });
      
      brandsList.classList.toggle('show');
      if (brandsList.classList.contains('show')) {
        card?.classList.add('brands-open');
      } else {
        card?.classList.remove('brands-open');
      }
    };
    
    toggle.addEventListener('click', handleToggle);
    toggle.addEventListener('touchend', handleToggle);
  });
  
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.brands-toggle') && !e.target.closest('.brands-list')) {
      document.querySelectorAll('.brands-list.show').forEach(list => {
        list.classList.remove('show');
        list.closest('.company-card, .private-card')?.classList.remove('brands-open');
      });
    }
  });
  
  document.addEventListener('touchend', (e) => {
    if (!e.target.closest('.brands-toggle') && !e.target.closest('.brands-list') && !e.target.closest('.company-card') && !e.target.closest('.private-card')) {
      document.querySelectorAll('.brands-list.show').forEach(list => {
        list.classList.remove('show');
        list.closest('.company-card, .private-card')?.classList.remove('brands-open');
      });
    }
  });
}

// ブランドタブが表示されたら線を描画・ロゴ読み込み
let brandTabInitialized = false;

document.getElementById('brands-tab')?.addEventListener('shown.bs.tab', function () {
  setTimeout(() => {
    loadLogos();
    drawJvLines();
    
    // 初回のみセットアップ
    if (!brandTabInitialized) {
      setupJvHighlight();
      setupBrandToggle();
      brandTabInitialized = true;
    }
  }, 100);
});

// 初期化
async function init() {
  setTableStatus('autohomeTable', 'loading');
  setTableStatus('heziTable', 'loading');
  // シリーズURL（仕様表の「引用元」リンク用）は表示を待たせずに並行して取得
  const seriesUrls = Promise.all([
    fetchSeriesUrls('autohome'),
    fetchSeriesUrls('hezi')
  ]);
  await fetchRate();  // 円換算に使うため先に取得（最大4秒で打ち切り）

  await Promise.all([
    loadData('autohome'),
    loadData('hezi')
  ]);
  await seriesUrls;
}

document.getElementById('autohome-tab').addEventListener('shown.bs.tab', function (e) {
  currentSource = 'autohome';
});

document.getElementById('hezi-tab').addEventListener('shown.bs.tab', function (e) {
  currentSource = 'hezi';
});

init();

// ===== エネルギー別ランキング =====
(function() {
  // 出所ごとのCSVパス
  const ENERGY_SOURCES = {
    guochan: `${RAW_BASE}output/pipeline/energy/autohome-energy-guochan/autohome_ranking_energy_with_maker_with_maker_ja.csv`,
    hezi:    `${RAW_BASE}output/pipeline/energy/autohome-energy-hezi/autohome_ranking_energy_with_maker_with_maker_ja.csv`,
  };
  // 出所ごとの画像ベースパス
  const ENERGY_IMG_BASES = {
    guochan: `${RAW_BASE}output/pipeline/energy/autohome-energy-guochan/images/`,
    hezi:    `${RAW_BASE}output/pipeline/energy/autohome-energy-hezi/images/`,
  };
  const ENERGY_TABLES = { '456': 'energyTable456', '4': 'energyTable4', '1': 'energyTable1', '5': 'energyTable5', '6': 'energyTable6' };

  // ロード済みキャッシュ（出所別）
  const energyCache = {};
  let currentSource = 'guochan';

  function energyImgTag(imageUrl, model, source) {
    if (!imageUrl) return '';
    // image_url形式: public/autohome_energy/{source}/images/{catId}/{file}
    const m = imageUrl.match(/^public\/autohome_energy\/(?:guochan|hezi)\/images\/(\d+)\/(.+)$/);
    if (!m) return '';
    const base = ENERGY_IMG_BASES[source] || ENERGY_IMG_BASES.guochan;
    const src = `${base}${m[1]}/${m[2]}?v=${window.IMG_CACHE_VER}`;
    return `<img class="car-thumb" src="${src}" alt="${escHtml(model)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=window.CAR_PLACEHOLDER;" />`;
  }

  function renderEnergyTable(rows, tableId, source) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!rows || rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">データなし</td></tr>`;
      return;
    }
    const esc = window.escHtml;
    rows.forEach(r => {
      const globalName = r.global_name || r.name || '';
      const originalName = r.name || '';
      const displayName = (globalName && originalName && globalName !== originalName)
        ? `<div class="vehicle-name-wrapper"><div class="vehicle-name-main">${esc(globalName)}</div><div class="vehicle-name-cn">${esc(originalName)}</div></div>`
        : esc(globalName);
      const link = r.link || '';
      const carId = link.match(/\/(\d+)\//)?.[1] || '';
      const maker = esc(r.manufacturer_ja || r.manufacturer || '');
      const units = r.units ? parseInt(r.units).toLocaleString('ja-JP') + '台' : '';
      const price = esc(formatCnyPrice(r.price || ''));
      const priceJPY = convertToJPY(r.price || '');
      const btnData = `data-car="${esc(carId)}" data-name="${esc(globalName)}" data-src="autohome"`;
      const specBtn = carId ? `<button type="button" class="btn btn-outline-primary btn-sm btn-spec" data-act="spec" ${btnData}>仕様表</button>` : '';
      const storyBtn = carId ? `<button type="button" class="btn btn-outline-secondary btn-sm btn-story" data-act="story" ${btnData}>口コミ</button>` : '';
      // 総合・外資のランキングと同じく、販売トレンドがある車種には 📈 を出す
      const trendBtn = (carId && window.SERIES_HISTORY && window.SERIES_HISTORY[carId])
        ? `<button type="button" class="btn btn-sm btn-trend" data-act="trend" ${btnData} title="販売トレンド" aria-label="販売トレンド">📈</button>`
        : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="rank-badge">${esc(r.rank)}</td>
        <td class="diff-badge"></td>
        <td>${energyImgTag(r.image_url, originalName, source)}</td>
        <td><a href="${esc(safeUrl(link))}" target="_blank" rel="noopener">${displayName}</a></td>
        <td>${maker}</td>
        <td style="white-space:nowrap;">${units}</td>
        <td>${price}<br><span class="price-jpy">${priceJPY}</span></td>
        <td>${specBtn}${storyBtn}${trendBtn}</td>`;
      tbody.appendChild(tr);
    });
  }

  function showLoadingAll() {
    Object.values(ENERGY_TABLES).forEach(tableId => {
      const tbody = document.querySelector(`#${tableId} tbody`);
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4"><i class="fa-solid fa-spinner fa-spin me-2"></i>読み込み中...</td></tr>`;
    });
  }

  function showErrorAll() {
    Object.values(ENERGY_TABLES).forEach(tableId => {
      const tbody = document.querySelector(`#${tableId} tbody`);
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4"><i class="fa-solid fa-triangle-exclamation me-2"></i>データ読み込みに失敗しました</td></tr>`;
    });
  }

  function renderAllTables(source) {
    const byCategory = energyCache[source] || {};
    Object.entries(ENERGY_TABLES).forEach(([cid, tableId]) => {
      renderEnergyTable(byCategory[cid] || [], tableId, source);
    });
  }

  async function loadEnergyData(source) {
    // キャッシュ済みならそのまま描画
    if (energyCache[source]) {
      renderAllTables(source);
      return;
    }
    showLoadingAll();
    try {
      const csvUrl = ENERGY_SOURCES[source];
      const res = await fetch(csvUrl + `?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.statusText);
      const text = await res.text();
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      const byCategory = {};
      parsed.data.forEach(r => {
        const cid = String(r.category_id);
        if (!byCategory[cid]) byCategory[cid] = [];
        byCategory[cid].push(r);
      });
      energyCache[source] = byCategory;
      renderAllTables(source);
      console.log(`✅ エネルギー別ランキング [${source}] CSV 読み込み成功 (${parsed.data.length}件)`);
    } catch (err) {
      console.error(`エネルギー別ランキング [${source}] CSV 読み込みエラー: ` + err.message);
      showErrorAll();
    }
  }

  // トグルボタンのイベント
  document.getElementById('energySourceToggle').addEventListener('click', function(e) {
    const btn = e.target.closest('[data-source]');
    if (!btn) return;
    const source = btn.dataset.source;
    if (source === currentSource) return;
    currentSource = source;
    // ボタンのアクティブ状態を切り替え
    this.querySelectorAll('button').forEach(b => {
      if (b.dataset.source === source) {
        b.classList.remove('btn-outline-primary');
        b.classList.add('btn-primary', 'active');
      } else {
        b.classList.remove('btn-primary', 'active');
        b.classList.add('btn-outline-primary');
      }
    });
    loadEnergyData(source);
  });

  let energyLoaded = false;
  document.getElementById('energy-tab').addEventListener('shown.bs.tab', function() {
    if (!energyLoaded) {
      energyLoaded = true;
      loadEnergyData(currentSource);
    }
  });
})();

// リサイズ時に線を再描画
window.addEventListener('resize', __rafThrottle(() => {
  if (document.getElementById('brands-content')?.classList.contains('show')) {
    drawJvLines();
  }
}));

// トップへ戻るボタン
const backToTopBtn = document.getElementById('backToTop');

window.addEventListener('scroll', () => {
  if (window.pageYOffset > 300) {
    backToTopBtn.classList.add('show');
  } else {
    backToTopBtn.classList.remove('show');
  }
});

backToTopBtn.addEventListener('click', () => {
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
});



// ===== グラフタブ用 ECharts（Excelから動的ロード版） =====

// CD / SD はロード後にセットされるグローバル変数
let CD = null;
let SD = null;
let CAAM_EXCEL_LOADED = false;

// ---- Excel パース ユーティリティ ----
function toF(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(/[−—－]/g, '').replace(/,/g, '');
  if (!s) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function sheetToRows(sheet) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({r, c})];
      row.push(cell ? (cell.v != null ? String(cell.v).trim() : '') : '');
    }
    rows.push(row);
  }
  return rows;
}

// ---- 月次シートのパース ----
function parseMonthSheet(rows, sheetYm) {
  const d = { brand: {}, ent: {}, nev_ent: {}, exp_ent: {} };

  // section1: 汽車総体
  let inTotal = false;
  for (const r of rows) {
    const h = r[0];
    if (/１．汽車総体/.test(h)) { inTotal = true; continue; }
    if (inTotal) {
      if (h === '生産台数' && d.total_prod == null)   d.total_prod   = toF(r[1]);
      if (h === '販売台数' && d.total_sales == null)  d.total_sales  = toF(r[1]);
      if (h === '国内販売' && d.domestic_sales == null) d.domestic_sales = toF(r[1]);
      if (h === '輸出'    && d.export_total == null)  d.export_total = toF(r[1]);
      if (h === 'うちNEV輸出' && d.nev_exp == null)   d.nev_exp      = toF(r[1]);
      // うちICE車輸出(B12)は乗用+商用の合計のため直接使用しない
      if (/２．乗用車/.test(h)) { inTotal = false; }
    }
  }
  // section2: 乗用車
  let inPax = false;
  for (const r of rows) {
    const h = r[0];
    if (/２．乗用車.*産販/.test(h)) { inPax = true; continue; }
    if (inPax) {
      if (h === '生産台数' && d.pax_prod == null)     d.pax_prod     = toF(r[1]);
      if (h === '販売台数' && d.pax_sales == null)    d.pax_sales    = toF(r[1]);
      if (h === '国内販売' && d.pax_domestic == null) d.pax_domestic = toF(r[1]);
      if (h === 'うちICE車 国内' && d.pax_trad_dom == null) d.pax_trad_dom = toF(r[1]);
      if (h === '輸出' && d.pax_export == null)       d.pax_export   = toF(r[1]);
      if (/３．商用車/.test(h)) { inPax = false; }
    }
  }
  // section3: 商用車
  let inCom = false;
  for (const r of rows) {
    const h = r[0];
    if (/３．商用車.*産販/.test(h)) { inCom = true; continue; }
    if (inCom) {
      if (h === '生産台数' && d.com_prod == null)     d.com_prod     = toF(r[1]);
      if (h === '販売台数' && d.com_sales == null)    d.com_sales    = toF(r[1]);
      if (h === '国内販売' && d.com_domestic == null) d.com_domestic = toF(r[1]);
      if (h === '輸出' && d.com_export == null)       d.com_export   = toF(r[1]);
      if (/４．NEV/.test(h)) { inCom = false; }
    }
  }
  // section4: NEV
  let inNev = false;
  for (const r of rows) {
    const h = r[0];
    if (/４．NEV/.test(h)) { inNev = true; continue; }
    if (inNev) {
      if (/^BEV（/.test(h)) { d.bev_prod = toF(r[1]); d.bev_sales = toF(r[3]); }
      if (/^PHEV（/.test(h)) { d.phev_prod = toF(r[1]); d.phev_sales = toF(r[3]); }
      if (h === '合計' && d.nev_prod == null) { d.nev_prod = toF(r[1]); d.nev_total = toF(r[3]); inNev = false; }
    }
  }
  // NEV domestic/export + penetration (CADA)
  for (const r of rows) {
    const h = r[0];
    if (h === 'NEV全体') {
      d.nev_domestic = toF(r[1]);
      const allText = r.join('');
      const pm = allText.match(/普及率([\d.]+)%/);
      if (pm) d.nev_pen = parseFloat(pm[1]);
    }
    if (h === 'うちNEV乗用車') {
      d.nev_pax_dom = toF(r[1]); d.nev_pax_exp = toF(r[4]);
      const allText = r.join('');
      const pm = allText.match(/普及率([\d.]+)%/);
      if (pm) d.pax_pen = parseFloat(pm[1]);
    }
    if (h === 'うちNEV商用車') { d.nev_com_dom = toF(r[1]); d.nev_com_exp = toF(r[4]); }
    if (h === 'BEV輸出')  d.bev_exp  = toF(r[4]) ?? toF(r[1]);
    if (h === 'PHEV輸出') d.phev_exp = toF(r[4]) ?? toF(r[1]);
  }
  if (d.bev_sales != null && d.bev_exp != null)   d.bev_dom  = +(d.bev_sales  - d.bev_exp).toFixed(2);
  if (d.phev_sales != null && d.phev_exp != null) d.phev_dom = +(d.phev_sales - d.phev_exp).toFixed(2);
  // ICE乗用輸出 = 乗用輸出(B20) - BEV輸出 - PHEV輸出
  if (d.pax_export != null && d.bev_exp != null && d.phev_exp != null)
    d.pax_ice_exp = +(d.pax_export - d.bev_exp - d.phev_exp).toFixed(1);

  // ---- brand (CADA) ----
  // ヘッダ行で各列の意味を確認
  // col[3] = 月次シェア
  // col[4] = 2023年5〜11月: 1-N月累計シェア / 2023年12月: 通年シェア / 2024年1月: 備考 / 2024年2月〜: 累計販売台数
  // col[5] = 2024年2月〜: 累計シェア or 通年シェア（12月） / 2023年: なし / 2026年: なし
  const bmap = {'中国ブランド':'cn','独系':'de','日系':'jp','米系':'us','韓系':'kr','その他':'other'};
  d.brand = {};        // グラフ用: 累計/通年シェア（できれば）、なければ月次シェア
  d.brand_monthly = {}; // 月次シェア（col[3]）
  
  // ヘッダ行を解析して累計シェアの列番号を特定
  let brandCumulCol = null;
  for (const r of rows) {
    if (r[0] === 'ブランド系') {
      // col[5]が「累計シェア」「通年シェア」を含む → 使う
      if (r[5] && (r[5].includes('累計シェア') || r[5].includes('通年シェア'))) {
        brandCumulCol = 5;
      }
      // col[4]が「1-N月シェア」「通年シェア」を含む（2023年形式）→ 使う
      else if (r[4] && (r[4].includes('シェア') && !r[4].includes('備考') && !r[4].includes('販売'))) {
        brandCumulCol = 4;
      }
      // それ以外（2024年1月、2026年等）→ col[3]をフォールバックで使う
      break;
    }
  }
  for (const r of rows) {
    if (bmap[r[0]]) {
      const monthly = toF(r[3]);
      const cumul   = brandCumulCol != null ? toF(r[brandCumulCol]) : null;
      // 累計/通年シェアがあればそれを、なければ月次シェア
      d.brand[bmap[r[0]]] = cumul ?? monthly;
      d.brand_monthly[bmap[r[0]]] = monthly;
    }
  }
  // enterprise ranking
  let inEnt = false, inNevEnt = false, inExpEnt = false;
  for (const r of rows) {
    const h = r[0];
    if (/重点企業（集団）総合販売/.test(h)) { inEnt = true; inNevEnt = false; inExpEnt = false; continue; }
    if (/NEV重点企業/.test(h))             { inNevEnt = true; inEnt = false; inExpEnt = false; continue; }
    if (/輸出ランキング（整車）/.test(h))  { inExpEnt = true; inEnt = false; inNevEnt = false; continue; }
    if (/CADA|６\./.test(h))               { inExpEnt = false; }
    const name = r[1]; const val = toF(r[2]);
    if (!name || val == null) continue;
    if (inEnt    && !h.startsWith('上位')) d.ent[name]     = val;
    if (inNevEnt && !h.startsWith('上位')) d.nev_ent[name] = val;
    if (inExpEnt && !h.startsWith('上位')) d.exp_ent[name] = val;
  }
  // commercial detail
  for (const r of rows) {
    const h = r[0];
    if (h === '重型貨車') d.truck_heavy = toF(r[1]);
    if (h === '中型貨車') d.truck_mid   = toF(r[1]);
    if (h === '軽型貨車') d.truck_light = toF(r[1]);
    if (h === '微型貨車') d.truck_micro = toF(r[1]);
    if (h === '大中型バス') d.bus_large = toF(r[1]);
    if (h === '小型バス')   d.bus_light = toF(r[1]);
    if (h === 'うち天然ガス車 販売') d.lng_sales = toF(r[1]);
    if (/^FCEV（/.test(h)) d.fcev_sales = toF(r[3]);
  }

  // ---- CAAM輸出国別（2023年: 万台単位） ----
  // 国名の名寄せ辞書
  const COUNTRY_NORM = {
    '俄罗斯（ロシア）':'ロシア', '墨西哥（メキシコ）':'メキシコ', '巴西（ブラジル）':'ブラジル',
    '泰国（タイ）':'タイ', '菲律宾（フィリピン）':'フィリピン', '土耳其（トルコ）':'トルコ',
    '阿联酋（UAE）':'アラブ首長国連邦（UAE）', 'UAE':'アラブ首長国連邦（UAE）',
    'ベラルーシ（白俄羅斯）':'ベラルーシ', '韩国（韓国）':'韓国',
    '德国（ドイツ）':'ドイツ', '美国（米国）':'米国', '荷兰（オランダ）':'オランダ',
    '斯洛伐克（スロバキア）':'スロバキア', '韩国（韓国）':'韓国',
    'キルギスタン':'キルギス',
  };
  const normCountry = n => COUNTRY_NORM[n] || n;

  // ヘッダ文字列から「YYYY年M月」を抽出してYYYY-MM形式で返す
  const headerYm = (h => {
    const m = h && h.match(/(\d{4})年(\d{1,2})月/);
    return m ? `${m[1]}-${String(parseInt(m[2])).padStart(2,'0')}` : null;
  });
  // ヘッダのymがシートymと一致するか（年月不明のヘッダは採用しない）
  const countryOk = (h => {
    if (!sheetYm) return true;
    const hym = headerYm(h);
    if (!hym) return false;  // 年月不明（「単月」等）はスキップ
    return hym === sheetYm;
  });

  d.caam_exp_countries = [];
  { let inC = false; let isWan = true;
    for (const r of rows) {
      const h = r[0];
      if (h && ((h.includes('輸出量上位') || (h.includes('整車輸出') && h.includes('カ国'))) &&
          !h.includes('累計') && !h.includes('NEV') && !h.includes('乗聯') && !h.includes('CADA') &&
          !h.includes('前年比')))
        { inC = countryOk(h); isWan = h.includes('万台'); continue; }
      // 前年比増加セクション等で終了
      if (inC && h && (h.includes('前年比') || h.includes('NEV') || h.includes('CADA') || h.includes('累計'))) { inC = false; }
      if (inC) {
        if (/^\d+$/.test(h) && r[1]) {
          let v = toF(r[2]);
          if (v != null) {
            if (!isWan) v = +(v / 10000).toFixed(4);  // 輌→万台換算
            d.caam_exp_countries.push({rank:+h, country:normCountry(r[1]), units:v});
          }
        }
        if (d.caam_exp_countries.length >= 10) break;
      }
    }
  }

  // ---- CADA輸出国別（2024年〜: 輌単位→万台換算, 見出し「整車出口　前10カ国」単月） ----
  d.cada_exp_countries = [];
  { let inC = false;
    for (const r of rows) {
      const h = r[0];
      // 「前10カ国」「前5カ国」どちらも対象、単月のみ（累計除外）
      if (h && h.includes('整車出口') && (h.includes('前10カ国') || h.includes('前5カ国')) && !h.includes('累計') && !h.includes('NEV'))
        { inC = true; d.cada_exp_countries = []; continue; }
      if (h && h.includes('累計') && (h.includes('前10カ国') || h.includes('前5カ国')) && inC) { inC = false; }
      // 「前年比増加上位」「NEV出口」セクション開始で終了
      if (inC && h && (h.includes('前年比') || h.includes('NEV出口') || h.includes('輸入'))) { inC = false; }
      if (inC) {
        if (/^\d+$/.test(h) && r[1]) {
          const v = toF(r[2]); if (v != null) d.cada_exp_countries.push({rank:+h, country:normCountry(r[1]), units:+(v/10000).toFixed(4)});
        }
        if (d.cada_exp_countries.length >= 10) break;
      }
    }
  }

  // ---- 輸入国別（単月優先、なければ累計） ----
  d.import_countries = []; d.import_is_cumul = false; d.import_period = null;
  { let inI = false; let hasSingle = false;
    for (const r of rows) {
      const h = r[0];
      if (h && h.includes('【輸入】') && h.includes('輸入量上位')) {
        const isCumul = h.includes('累計') || h.includes('通年');
        if (!isCumul) {
          if (!countryOk(h)) { inI = false; continue; }
          inI = true; hasSingle = true; d.import_countries = [];
          d.import_is_cumul = false;
          const m = h.match(/(\d{4})年(\d+)月/);
          d.import_period = m ? `${m[1].slice(2)}年${+m[2]}月` : null;
          continue;
        } else {
          inI = false; // 累計は使わない
          continue;
        }
      }
      if (inI) {
        if (/^\d+$/.test(h) && r[1]) {
          const v = toF(r[2]); if (v != null) d.import_countries.push({rank:+h, country:r[1], units:+(v/10000).toFixed(4)});
        }
        if (d.import_countries.length >= 10) break;
      }
    }
  }

  // ---- NEV輸出国別（単月優先、なければ累計） ----
  // ヘッダ形式1: 「【NEV輸出】YYYY年M月 輸出量上位10カ国（台）」
  // ヘッダ形式2: 「　YYYY年M月　NEV出口　前10カ国」（乗聯分会形式）
  d.nev_exp_countries = []; d.nev_exp_is_cumul = false; d.nev_exp_period = null;
  { let inN = false; let hasSingle = false;
    for (const r of rows) {
      const h = r[0];
      // ヘッダチェック
      const isHeader = h && (
        (h.includes('【NEV輸出】') && (h.includes('輸出量上位10カ国') || h.includes('輸出量上位5カ国'))) ||
        (h.includes('NEV') && h.includes('出口') && (h.includes('前10カ国') || h.includes('前5カ国') || h.includes('前10カ國')))
      ) && !h.includes('前年比') && !h.includes('増加');

      if (isHeader) {
        const isCumul = h.includes('累計') || h.includes('通年') || /1-\d+月/.test(h) || h.includes('1月〜');
        if (!isCumul) {
          if (!countryOk(h)) { inN = false; continue; }
          inN = true; hasSingle = true; d.nev_exp_countries = [];
          d.nev_exp_is_cumul = false;
          const m = h.match(/(\d{4})年(\d+)月/);
          d.nev_exp_period = m ? `${m[1].slice(2)}年${+m[2]}月` : null;
        } else {
          inN = false; // 累計は使わない
        }
        continue;
      }
      // データ行
      if (inN && h && /^\d+$/.test(h) && r[1]) {
        const v = toF(r[2]); if (v != null) d.nev_exp_countries.push({rank:+h, country:normCountry(r[1]), units:+(v/10000).toFixed(4)});
        if (d.nev_exp_countries.length >= 10 && hasSingle) break;
      }
    }
  }

  // ---- CADAサマリー（最新月のみ詳細あり） ----
  d.cada_summary = {};
  { let inS = false;
    for (const r of rows) {
      const h = r[0];
      if (h && h.includes('CADA乗聯分会') && (h.includes('出口サマリー') || h.includes('乗用車出口')))
        { inS = true; continue; }
      if (inS && (h.includes('世界シェア') || h.includes('７．') || h.includes('６－２'))) break;
      if (inS && h) {
        const raw = r[1] || '';
        const numWan = (()=>{ const m=raw.split('（')[0].match(/([\d.]+)万台/); return m?+m[1]:null; })();
        const numPct = (()=>{ const m=raw.match(/([\d.]+)%/); return m?+m[1]:null; })();
        const map = {
          '乗用車出口合計（整車+CKD）':'cada_exp_total', 'うちNEV出口':'cada_nev_exp',
          'うちBEV':'cada_bev_exp', 'うちPHEV/EREV':'cada_phev_exp',
          '中国系ブランド出口':'cada_zizhu_exp', '合弁・外資ブランド出口':'cada_jv_exp',
          '中国ブランドICE車輸出':'cada_ice_exp', '中国系NEV乗用車輸出':'cada_nev_zizhu',
          '乗用車出口 NEV普及率':'cada_nev_pen_exp',
        };
        if (map[h]) { const v = h.includes('普及率') ? numPct : numWan; if (v!=null) d.cada_summary[map[h]]=v; }
      }
    }
  }

  // ---- 世界指標 ----
  d.world = {};
  for (const r of rows) {
    const h = r[0]; const raw = r[1]||'';
    // pct: 単月・直近値を優先。累計先行パターンも安全に処理
    const pct = (s => {
      const str = String(s);
      if (!str || str === 'null' || str === 'undefined') return null;
      const slashIdx = str.indexOf('/');
      if (slashIdx > 0) {
        const prefix = str.slice(0, slashIdx);
        // 前半が累計（「1-X月」「累計」「通年」）なら後半から取る
        if (/\d+-\d+月|累計|通年/.test(prefix)) {
          const m2 = str.slice(slashIdx).match(/([\d.]+)%/);
          // 後半に%がない場合（例:「/ 3月128万台」）は前半の%を使う
          if (m2) return +m2[1];
          const m1 = prefix.match(/([\d.]+)%/);
          return m1 ? +m1[1] : null;
        }
      }
      // スラッシュなしで累計のみ（例: 「1-9月13.8%」）→ null
      if (/^\d+-\d+月/.test(str) && slashIdx < 0) return null;
      const m = str.match(/([\d.]+)%/);
      return m ? +m[1] : null;
    });
    // wan: 月間単月値のみ抽出。累計・通年は除外
    const wan = (s => {
      const str = String(s);
      if (/^\d+-\d+月累計/.test(str)) return null;  // 「1-8月累計」形式
      if (/^通年/.test(str)) return null;             // 「通年XXXX万台」形式
      const m = str.split('（')[0].match(/^([\d.]+)万台/);
      return m ? +m[1] : null;
    });
    // 世界指標：データが示す期間（年月）をrawから抽出し、シートのymと一致する場合のみ採用。
    // 例: 「32.7%（2026年1月）」→ 期間は2026-01。シートが2026-02なら不一致→null。
    // 「68.4%（2025年通年）」のような通年表記はシートymに依らず採用（単月比較対象外）。
    const extractPeriodYm = (s => {
      const str = String(s);
      // スラッシュ前の前半部分から期間を読む（後半は参考値なので無視）
      const front = str.split('/')[0];
      const m = front.match(/（(\d{4})年(\d{1,2})月）/);
      if (!m) return null; // 「通年」等は期間特定しない
      return `${m[1]}-${String(parseInt(m[2])).padStart(2,'0')}`;
    });
    const worldOk = (raw => {
      if (!sheetYm) return true; // ymが不明なら無条件採用
      const period = extractPeriodYm(raw);
      if (!period) return true;  // 通年など期間特定できない場合は採用
      return period === sheetYm; // 期間がシートymと一致する場合のみ採用
    });
    if (h==='中国の世界自動車販売シェア') d.world.cn_world_share    = worldOk(raw) ? pct(raw) : null;
    if (h==='中国系ブランドNEV 海外市場シェア')  d.world.zizhu_nev_overseas = worldOk(raw) ? pct(raw) : null;
    if (h==='世界NEV普及率')              d.world.world_nev_pen      = worldOk(raw) ? pct(raw) : null;
    if (h==='中国NEV 世界シェア')          d.world.cn_nev_world_share = worldOk(raw) ? pct(raw) : null;
    if (h==='世界NEV月間販売台数')         d.world.world_nev_monthly  = worldOk(raw) ? wan(raw) : null;
  }

  return d;
}

// ---- 業界利益率シートのパース ----
function parseProfitSheet(sheet) {
  const rows = sheetToRows(sheet);
  const result = { annual: {}, monthly: {} };
  let inAnnual = false, inMonthly = false;
  let yrCols = {};
  for (const r of rows) {
    const h = r[0]||'';
    if (h.includes('通年利益率推移')) { inAnnual = true; inMonthly = false; continue; }
    if (h.includes('月次データ'))     { inMonthly = true; inAnnual = false; continue; }
    if (h.includes('凡例') || h.startsWith('直接記載')) { inMonthly = false; continue; }
    if (inAnnual) {
      if (h === '年') { /* next is data */ continue; }
      if (h === '業界全体利益率') {
        const years = ['2020','2021','2022','2023','2024','2025'];
        years.forEach((y,i) => { const v=r[i+1]; const m=String(v).match(/([\d.]+)%/); if(m) result.annual[y]=+m[1]; });
      }
    }
    if (inMonthly) {
      if (r[1]==='2024年') { yrCols={'2024':1,'2025':5}; continue; }
      if (r[1]==='収入(億元)') continue;
      if (h && h!=='月' && Object.keys(yrCols).length > 0) {
        for (const [yr,c] of Object.entries(yrCols)) {
          if (c+2 >= r.length) continue;
          const rm = String(r[c+2]||'').match(/([\d.]+)%/);
          const rate = rm ? +rm[1] : null;
          const rev  = toF(r[c]);
          const pft  = toF(r[c+1]);
          if (rate!=null || rev!=null || pft!=null)
            result.monthly[`${yr}-${h}`] = {rev, profit:pft, rate};
        }
      }
    }
  }
  return result;
}

function parseSingleSheet(sheet) {
  const rows = sheetToRows(sheet);
  // row index 4 (0-based) has column headers with year/month
  const headerRow = rows[4] || [];
  const colToYm = {};
  for (let ci = 1; ci < headerRow.length; ci++) {
    const m = headerRow[ci].match(/(\d{4})年(\d{1,2})月/);
    if (m) colToYm[ci] = `${m[1]}-${String(parseInt(m[2])).padStart(2,'0')}`;
  }

  // find section start rows
  let tradSegStart=-1, nevSegStart=-1, tradPriceStart=-1, nevPriceStart=-1;
  for (let ri = 0; ri < rows.length; ri++) {
    const h = rows[ri][0] || '';
    if (/セグメント別販売（伝統燃料車）/.test(h)) tradSegStart = ri;
    else if (/セグメント別販売（NEV乗用車）/.test(h)) nevSegStart = ri;
    else if (/価格帯別販売（伝統燃料車）/.test(h)) tradPriceStart = ri;
    else if (/価格帯別販売（NEV乗用車）/.test(h)) nevPriceStart = ri;
  }

  const result = {};
  Object.values(colToYm).forEach(ym => {
    result[ym] = { trad_seg:{}, nev_seg:{}, trad_price:{}, nev_price:{} };
  });

  function extractSection(startRow, endRow, key) {
    for (let ri = startRow+1; ri < rows.length; ri++) {
      if (endRow > 0 && ri >= endRow) break;
      const label = (rows[ri][0]||'').trim();
      if (!label || label === 'セグメント' || label === '価格帯（万元）') continue;
      const normLabel = label.replace('（主力）','');
      for (const [ci, ym] of Object.entries(colToYm)) {
        const v = toF(rows[ri][ci]);
        if (v != null && result[ym]) result[ym][key][normLabel] = v;
      }
    }
  }
  extractSection(tradSegStart, nevSegStart, 'trad_seg');
  extractSection(nevSegStart, tradPriceStart, 'nev_seg');
  extractSection(tradPriceStart, nevPriceStart, 'trad_price');
  extractSection(nevPriceStart, -1, 'nev_price');
  return result;
}

// ---- Excel fetch & 全データ組み立て ----
const CAAM_EXCEL_PATH    = `${RAW_BASE}source/${encodeURIComponent('CAAM_2026年産販月報_v41.xlsx')}`;
const CAAM_EXCEL_PATH_EN = `${RAW_BASE}source/caam_monthly.xlsx`;  // 英語名フォールバック

// ---- 月次総論（綜述）パース・描画 ----
const CAAM_COMMENTARY = {};

// ---- 自動取得（stats_pipeline → cds-archive ブランチの caam/data.json） ----
// 中国汽车工业协会の公式サイトの「产销情况简析」の本文から自動で読み取った数値。
// Excel にない月（新しい月）を加え、Excel の月は空欄だけを埋める。読めなければ Excel だけで表示する。
var CAAM_AUTO_META = null;
// 内訳なしの合計（自動取得の月）に付ける斜線模様
var CAAM_UNSPLIT_DECAL = { symbol:'rect', dashArrayX:[1,0], dashArrayY:[3,5], rotation:-Math.PI/4, color:'rgba(255,255,255,0.6)' };
async function caamMergeAuto(allMonthly) {
  if (typeof RAW_BASE === 'undefined') return;
  const url = RAW_BASE.replace(/\/main\/$/, '/cds-archive/') + 'caam/data.json?v=' + Date.now();
  const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
  let auto = null;
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (r.ok) auto = await r.json();
  } catch (err) { console.info('CAAMアーカイブは利用できません:', err); }
  finally { if (timer) clearTimeout(timer); }
  // CAAM公式記者会見スライドから目視照合した単月値（Excel優先の補完）。
  try {
    const r = await fetch(RAW_BASE + 'output/caam/official_2026_05_09.json', { cache:'no-store' });
    if (r.ok) {
      const verified = await r.json();
      if (verified && verified.monthly) {
        if (!auto) auto = verified;
        else {
          auto.monthly = auto.monthly || {};
          for (const [ym, row] of Object.entries(verified.monthly))
            auto.monthly[ym] = Object.assign({}, auto.monthly[ym] || {}, row);
          auto.commentary = Object.assign({}, auto.commentary || {}, verified.commentary || {});
          const oldMeta = auto.meta || {}, newMeta = verified.meta || {};
          auto.meta = Object.assign({}, oldMeta, newMeta, {
            months: Array.from(new Set([...(oldMeta.months || []), ...(newMeta.months || [])])).sort(),
            decks: oldMeta.decks || newMeta.decks || {}
          });
        }
      }
    }
  } catch (err) { console.warn('CAAM公式資料データの読み込み失敗:', err); }
  if (!auto || !auto.monthly) return;
  const added = [];
  for (const [ym, row] of Object.entries(auto.monthly)) {
    if (!allMonthly[ym]) {
      allMonthly[ym] = Object.assign({ brand: {}, brand_monthly: {}, ent: {}, nev_ent: {}, exp_ent: {},
        trad_seg: {}, nev_seg: {}, trad_price: {}, nev_price: {}, caam_exp_countries: [], cada_exp_countries: [],
        nev_exp_countries: [], import_countries: [], cada_summary: {}, world: {}, _auto: true }, row);
      added.push(ym);
    } else {
      const d = allMonthly[ym];
      for (const [k, v] of Object.entries(row)) if (d[k] == null) d[k] = v;
    }
  }
  // 抜けた月があれば空の月を入れて、横軸の月が詰まって見えないようにする
  const ks = Object.keys(allMonthly).sort();
  if (ks.length) {
    let [y, m] = ks[0].split('-').map(Number);
    const [y2, m2] = ks[ks.length - 1].split('-').map(Number);
    let guard = 0;
    while ((y < y2 || (y === y2 && m <= m2)) && guard++ < 600) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      if (!allMonthly[k]) allMonthly[k] = { brand: {}, brand_monthly: {}, ent: {}, nev_ent: {}, exp_ent: {}, _gap: true };
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  // 公式スライドからの日本語訳は、Excel等から読み込んだコメントより優先する。
  for (const [ym, c] of Object.entries(auto.commentary || {})) {
    if (!CAAM_COMMENTARY[ym] || (c.lang === 'ja' && c.source_type === 'official_press_slides')) {
      CAAM_COMMENTARY[ym] = c;
    }
  }
  CAAM_AUTO_META = Object.assign({}, auto.meta || {}, { added: added.sort() });
  caamShowAutoStatus();
}
function caamShowAutoStatus() {
  const el = document.getElementById('caam-auto-status');
  if (!el || !CAAM_AUTO_META) return;
  const ms = CAAM_AUTO_META.months || [];
  const decks = CAAM_AUTO_META.decks || {};
  const deckMonths = Object.keys(decks).sort();
  if (!ms.length && !deckMonths.length) return;
  const fmt = ym => { const [y, m] = ym.split('-'); return `${y}年${parseInt(m, 10)}月`; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let html = '';
  if (CAAM_AUTO_META.source_type === 'official_press_slides') {
    html += '📊 <b>CAAM公式記者会見資料</b>：2026年5〜9月の単月データを補完（万台）。Excelの既存値は優先し、未掲載の企業・セグメント等は空欄です。';
  } else if (ms.length) {
    const add = CAAM_AUTO_META.added || [];
    const span = !add.length ? `${fmt(ms[ms.length - 1])}分まで確認済み`
               : add.length === 1 ? `${fmt(add[0])}分を追加` : `${fmt(add[0])}〜${fmt(add[add.length - 1])}分を追加`;
    html += '🔄 <b>自動取得</b>：' + span +
      '（中国汽车工业协会の「产销情况简析」の本文から自動で読み取り）。自動取得の月は、総体・乗用車・商用車・NEV・国内販売・輸出の数値のみで、' +
      'ブランド系シェア・セグメント・価格帯・企業ランキング・BEV/PHEV内訳は空欄（積み上げグラフでは内訳なしの合計を斜線で表示）です。';
  }
  // 記者会見スライド（画像）の自動保存：最新の月の保存先と原典
  if (deckMonths.length) {
    const ym = deckMonths[deckMonths.length - 1];
    const d = decks[ym] || {};
    const repo = (typeof RAW_BASE !== 'undefined') ? RAW_BASE.match(/githubusercontent\.com\/([^/]+)\/([^/]+)\//) : null;
    const tree = (repo && d.path) ? `https://github.com/${repo[1]}/${repo[2]}/tree/cds-archive/${d.path.split('/').map(encodeURIComponent).join('/')}` : null;
    const links = [];
    if (tree) links.push(`<a href="${esc(tree)}" target="_blank" rel="noopener">保存先</a>`);
    if (d.url) links.push(`<a href="${esc(d.url)}" target="_blank" rel="noopener">原典</a>`);
    html += (html ? '<br>' : '') + `📑 <b>記者会見スライド</b>：${fmt(ym)}分まで自動保存` +
      (d.images ? `（${d.images}枚）` : '') + (links.length ? '・' + links.join('・') : '') +
      '。セグメント・価格帯・企業ランキング等は、スライド（画像）からの反映待ちです。';
  }
  el.innerHTML = html;
  el.style.display = '';
}

function parseCommentary(rows) {
  let titleIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const v = (rows[i] && rows[i][0]) ? String(rows[i][0]) : '';
    if (/^[８8]．産業運行/.test(v)) { titleIdx = i; break; }
  }
  if (titleIdx < 0) return null;
  const titleRaw = String(rows[titleIdx][0] || '');
  let source = '';
  const sm = titleRaw.match(/出所[:：]\s*(.+)$/);
  if (sm) source = sm[1].trim();
  const paragraphs = [];
  for (let i = titleIdx + 1; i < rows.length; i++) {
    const v = (rows[i] && rows[i][0]) ? String(rows[i][0]).trim() : '';
    if (v) paragraphs.push(v);
  }
  return paragraphs.length ? { source, paragraphs } : null;
}

function _ccEscHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderCommentary(ym) {
  const titleEl  = document.getElementById('commentary-title-month');
  const body     = document.getElementById('commentary-body');
  const link     = document.getElementById('commentary-source-link');
  const srcEl    = document.getElementById('commentary-source');
  if (!body) return;
  const [y, m] = ym.split('-');
  if (titleEl) titleEl.textContent = `${y}年${parseInt(m, 10)}月`;
  const data = CAAM_COMMENTARY[ym];
  if (!data) {
    body.innerHTML = '<p style="color:#94a3b8;font-style:italic;margin-bottom:0">この月の総論は未登録です。</p>';
    if (srcEl) srcEl.textContent = '';
    if (link) link.style.display = 'none';
    return;
  }
  // 未翻訳の中国語を日本語コメント欄にそのまま表示しない。
  if (data.lang === 'zh') {
    body.innerHTML = '<p style="color:#64748b;margin-bottom:0">この月の「産業運行 総論」は、日本語訳をまだ登録していません。</p>';
  } else {
    body.innerHTML = (data.paragraphs || []).map((p, i) => {
      const mb = (i === data.paragraphs.length - 1) ? '0' : '10px';
      return `<p style="margin-bottom:${mb}">${_ccEscHtml(p)}</p>`;
    }).join('');
  }
  if (srcEl) srcEl.textContent = data.source ? '出所：' + data.source : '';
  // 原典リンクは2026-04のみ（既知URL）
  if (link) {
    if (data.url) { link.href = data.url; link.style.display = ''; }
    else if (ym === '2026-04') { link.href = 'https://mp.weixin.qq.com/s/zqDrjDV3hp1oltPQu-LlAA'; link.style.display = ''; }
    else link.style.display = 'none';
  }
  if (data.lang === 'zh' && srcEl) srcEl.textContent = (data.source ? '出所：' + data.source : '') +
    '　※日本語訳は未登録です。';
}

function setupCommentaryUI() {
  const sel = document.getElementById('commentary-month-select');
  if (!sel) return;
  const months = Object.keys(CAAM_COMMENTARY).sort().reverse();  // 新しい順
  if (!months.length) return;
  sel.innerHTML = months.map(ym => {
    const [y, m] = ym.split('-');
    return `<option value="${ym}">${y}年${parseInt(m, 10)}月</option>`;
  }).join('');
  sel.onchange = () => renderCommentary(sel.value);
  sel.value = months[0];
  renderCommentary(months[0]);
}

async function loadCaamExcel() {
  const loadingEl = document.getElementById('caam-loading');
  const pillsEl   = document.getElementById('chartsPills');
  const contentEl = document.getElementById('chartsPillsContent');
  if (loadingEl) loadingEl.style.display = 'flex';
  if (pillsEl)   pillsEl.style.display   = 'none';
  if (contentEl) contentEl.style.display = 'none';
  try {
    // 日本語ファイル名→英語名の順でフォールバック
    let res = await fetch(CAAM_EXCEL_PATH + `?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      console.warn('日本語ファイル名でのfetch失敗、英語名フォールバックを試みます:', res.status);
      res = await fetch(CAAM_EXCEL_PATH_EN + `?v=${Date.now()}`, { cache: 'no-store' });
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} — GitHubの source/ にExcelファイル（日本語名 or caam_monthly.xlsx）が配置されているか確認してください`);
    const buf = await res.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });

    // 月次シートをパース（"データ"を含むシート）
    const allMonthly = {};
    for (const sname of wb.SheetNames) {
      if (!sname.includes('データ') || sname.includes('単月計算')) continue;
      const m = sname.match(/(\d{4})年(\d{1,2})月/);
      if (!m) continue;
      const ym = `${m[1]}-${String(parseInt(m[2])).padStart(2,'0')}`;
      const rows = sheetToRows(wb.Sheets[sname]);
      allMonthly[ym] = parseMonthSheet(rows, ym);
      // 月次総論（綜述）を抽出
      const commentary = parseCommentary(rows);
      if (commentary) CAAM_COMMENTARY[ym] = commentary;
    }

    // 単月計算シートをパースしてセグメント・価格帯を上書き
    const singleSheetName = wb.SheetNames.find(n => n.includes('単月計算'));
    if (singleSheetName) {
      const segData = parseSingleSheet(wb.Sheets[singleSheetName]);
      for (const [ym, sd] of Object.entries(segData)) {
        if (allMonthly[ym]) {
          allMonthly[ym].trad_seg   = sd.trad_seg;
          allMonthly[ym].nev_seg    = sd.nev_seg;
          allMonthly[ym].trad_price = sd.trad_price;
          allMonthly[ym].nev_price  = sd.nev_price;
        }
      }
    }

    // 業界利益率シートをパース
    const profitSheetName = wb.SheetNames.find(n => n.includes('業界利益率'));
    window.PROFIT_DATA = profitSheetName ? parseProfitSheet(wb.Sheets[profitSheetName]) : {annual:{}, monthly:{}};

    // 自動取得（caam/data.json）の新しい月を足してから組み立てる
    try { await caamMergeAuto(allMonthly); } catch (e) { console.warn('CAAM の自動取得データを読めませんでした（Excel だけで表示します）', e); }
    // CD / SD オブジェクトを組み立て
    buildCdSd(allMonthly);
    CAAM_EXCEL_LOADED = true;
    // 月次総論UI を初期化
    setupCommentaryUI();
    // INITEDキャッシュをクリア（ロード前に空描画された可能性があるため）
    Object.keys(INITED).forEach(k => delete INITED[k]);
    if (loadingEl) loadingEl.style.display = 'none';
    if (pillsEl)   pillsEl.style.display   = '';
    if (contentEl) contentEl.style.display = '';

    // 現在表示中のサブタブがあれば描画
    const activeBtn = document.querySelector('#chartsPills .nav-link.active');
    if (activeBtn) {
      const id = activeBtn.getAttribute('data-bs-target').replace('#','');
      if (CHART_FNS[id]) CHART_FNS[id]();
    }
    console.log('✅ CAAM Excel loaded:', Object.keys(allMonthly).sort().join(', '));
  } catch(err) {
    console.error('CAAM Excel 読み込みエラー:', err);
    if (pillsEl)   pillsEl.style.display   = '';
    if (contentEl) contentEl.style.display = '';
    if (loadingEl) {
      loadingEl.innerHTML = `<div class="text-danger p-3 text-center">⚠️ データ読み込み失敗: ${err.message}<br><small class="text-muted">GitHubの source/ にExcelファイルが配置されているか確認してください。</small></div>`;
      loadingEl.style.display = 'flex';
    }
  }
}

function buildCdSd(monthly) {
  const sorted = Object.keys(monthly).sort();  // "2023-05" … "2026-02"

  function lbl(ym) {
    const [y,m] = ym.split('-');
    return `${y.slice(2)}年${parseInt(m)}月`;
  }
  function arr(ym_list, field) {
    return ym_list.map(ym => monthly[ym]?.[field] ?? null);
  }
  function arrNested(ym_list, field, key) {
    return ym_list.map(ym => monthly[ym]?.[field]?.[key] ?? null);
  }

  // ---- labels ----
  // labels_all: 全月
  const labels_all = sorted.map(lbl);
  // labels_ent / nev_ent: 企業ランキングが存在する月
  const ent_months     = sorted.filter(ym => Object.keys(monthly[ym]?.ent     || {}).length > 0);
  const nev_ent_months = sorted.filter(ym => Object.keys(monthly[ym]?.nev_ent || {}).length > 0);
  const exp_ent_months = sorted.filter(ym => Object.keys(monthly[ym]?.exp_ent || {}).length > 0);

  // セグメント・価格帯は単月計算シートのある月
  const seg_months = sorted.filter(ym => Object.keys(monthly[ym]?.trad_seg || {}).length > 0);

  // ---- 企業名の統合（全月のユニオン、多い順） ----
  function topCompanies(field, limit) {
    const cnt = {};
    for (const ym of sorted) {
      for (const [co, v] of Object.entries(monthly[ym]?.[field] || {})) {
        if (v != null) cnt[co] = (cnt[co]||0) + 1;
      }
    }
    return Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(e=>e[0]);
  }
  const ent_companies     = topCompanies('ent',     15);
  const nev_companies     = topCompanies('nev_ent', 15);
  const exp_companies     = topCompanies('exp_ent', 10);

  // ---- brand_series（CADA） ----
  const brand_keys = ['cn','de','jp','us','kr','other'];
  const brand_names = {'cn':'中国ブランド','de':'独系','jp':'日系','us':'米系','kr':'韓系','other':'その他'};

  // brand_series_normed: 各月の累計/通年シェアを正規化（合計100%に）
  const brand_series_normed = {};
  for (const k of brand_keys) brand_series_normed[brand_names[k]] = [];
  for (let i = 0; i < sorted.length; i++) {
    const vals = brand_keys.map(k => monthly[sorted[i]]?.brand?.[k] ?? null);
    const total = vals.reduce((s,v) => s + (v??0), 0);
    brand_keys.forEach((k,j) => {
      brand_series_normed[brand_names[k]].push(
        vals[j] != null && total > 0 ? +(vals[j]/total*100).toFixed(1) : null
      );
    });
  }

  // 2022年・2023年 通年シェア ハードコード（出所：CAAM）
  // 2022年: 仏系はその他に合算 / 2023年: CAAM 2023年12月報告
  // ※ labels_all（全チャート共通）は汚染しないよう brand_labels_all を別途作成
  const brand_labels_all = [...labels_all];
  {
    const HC = [
      { label: '22年', cn:49.93, de:19.53, jp:17.80, us:9.37, kr:1.62, other:0.76 },
      { label: '23年', cn:56.0,  de:17.8,  jp:14.4,  us:8.8,  kr:1.6,  other:1.4  },
    ];
    for (const hc of HC.slice().reverse()) {
      const tot = hc.cn + hc.de + hc.jp + hc.us + hc.kr + hc.other;
      brand_labels_all.unshift(hc.label);
      for (const k of brand_keys) {
        const v = { cn:hc.cn, de:hc.de, jp:hc.jp, us:hc.us, kr:hc.kr, other:hc.other }[k];
        brand_series_normed[brand_names[k]].unshift(+(v/tot*100).toFixed(1));
      }
    }
  }

  // ---- CD 組み立て ----
  CD = {
    labels_all,
    labels_ent:     ent_months.map(lbl),
    labels_nev_ent: nev_ent_months.map(lbl),
    labels_exp_ent: exp_ent_months.map(lbl),

    total_prod:     arr(sorted,'total_prod'),
    total_sales:    arr(sorted,'total_sales'),
    domestic_sales: arr(sorted,'domestic_sales'),
    export_total:   arr(sorted,'export_total'),
    nev_exp:        arr(sorted,'nev_exp'),
    trad_export:    arr(sorted,'trad_export'),  // 参照のみ残す（他チャートで使用の可能性）
    pax_ice_exp:    arr(sorted,'pax_ice_exp'),

    pax_prod:       arr(sorted,'pax_prod'),
    pax_sales:      arr(sorted,'pax_sales'),
    pax_domestic:   arr(sorted,'pax_domestic'),
    pax_trad_dom:   arr(sorted,'pax_trad_dom'),
    pax_export:     arr(sorted,'pax_export'),

    com_prod:       arr(sorted,'com_prod'),
    com_sales:      arr(sorted,'com_sales'),
    com_domestic:   arr(sorted,'com_domestic'),
    com_export:     arr(sorted,'com_export'),

    bev_prod:   arr(sorted,'bev_prod'),   phev_prod:  arr(sorted,'phev_prod'),
    nev_prod:   arr(sorted,'nev_prod'),
    bev_sales:  arr(sorted,'bev_sales'),  phev_sales: arr(sorted,'phev_sales'),
    nev_total:  arr(sorted,'nev_total'),
    nev_domestic: arr(sorted,'nev_domestic'),
    nev_pax_dom:  arr(sorted,'nev_pax_dom'), nev_pax_exp: arr(sorted,'nev_pax_exp'),
    nev_com_dom:  arr(sorted,'nev_com_dom'), nev_com_exp: arr(sorted,'nev_com_exp'),
    bev_exp:    arr(sorted,'bev_exp'),    phev_exp:   arr(sorted,'phev_exp'),
    bev_dom:    arr(sorted,'bev_dom'),    phev_dom:   arr(sorted,'phev_dom'),

    // CADA出所
    nev_pen:    arr(sorted,'nev_pen'),
    pax_pen:    arr(sorted,'pax_pen'),
    brand_series_normed,
    brand_labels_all,

    ent_series: Object.fromEntries(ent_companies.map(co => [co, ent_months.map(ym => monthly[ym]?.ent?.[co] ?? null)])),
    ent_companies,
    nev_ent_series: Object.fromEntries(nev_companies.map(co => [co, nev_ent_months.map(ym => monthly[ym]?.nev_ent?.[co] ?? null)])),
    nev_companies,
    exp_ent_series: Object.fromEntries(exp_companies.map(co => [co, exp_ent_months.map(ym => monthly[ym]?.exp_ent?.[co] ?? null)])),
    exp_companies,

    truck_heavy: arr(sorted,'truck_heavy'), truck_mid:   arr(sorted,'truck_mid'),
    truck_light: arr(sorted,'truck_light'), truck_micro: arr(sorted,'truck_micro'),
    bus_large:   arr(sorted,'bus_large'),   bus_light:   arr(sorted,'bus_light'),
    lng_sales:   arr(sorted,'lng_sales'),   fcev_sales:  arr(sorted,'fcev_sales'),
    fcev_prod:   arr(sorted,'fcev_prod'),
  };

  // 派生フィールド
  CD.trad_sales    = CD.total_sales.map((t,i) => CD.nev_total[i]  != null ? +(t - CD.nev_total[i]).toFixed(1)  : null);
  CD.com_sales_calc= CD.total_sales.map((t,i) => CD.pax_sales[i]  != null ? +(t - CD.pax_sales[i]).toFixed(1)  : null);
  CD.total_prod_sales_gap = CD.total_prod.map((p,i) => CD.total_sales[i] != null ? +((p??0) - CD.total_sales[i]).toFixed(1) : null);
  // 自動取得の月（産販簡析だけの月）は内訳がないので、積み上げグラフ用に「内訳なしの合計」を用意する
  CD.nev_unsplit     = CD.nev_total.map((v,i) => (v != null && CD.bev_sales[i] == null && CD.phev_sales[i] == null) ? v : null);
  CD.pax_dom_unsplit = CD.pax_domestic.map((v,i) => (v != null && CD.pax_trad_dom[i] == null && CD.nev_pax_dom[i] == null) ? v : null);
  CD.pax_exp_unsplit = CD.pax_export.map((v,i) => (v != null && CD.pax_ice_exp[i] == null && CD.bev_exp[i] == null && CD.phev_exp[i] == null) ? v : null);

  // ---- 輸出国別（CAAM）2023年5月〜 ----
  const CNORM = {
    '俄罗斯（ロシア）':'ロシア','墨西哥（メキシコ）':'メキシコ','巴西（ブラジル）':'ブラジル',
    '泰国（タイ）':'タイ','菲律宾（フィリピン）':'フィリピン','土耳其（トルコ）':'トルコ',
    '阿联酋（UAE）':'アラブ首長国連邦（UAE）','UAE':'アラブ首長国連邦（UAE）',
    'ベラルーシ（白俄羅斯）':'ベラルーシ','キルギスタン':'キルギス',
  };
  const cn = s => CNORM[s] || s;

  const caaMExpMonths = sorted.filter(ym => (monthly[ym]?.caam_exp_countries||[]).length > 0);
  // 名寄せしてユニーク国名
  const caamExpAllCo  = [...new Set(caaMExpMonths.flatMap(ym => (monthly[ym].caam_exp_countries||[]).map(e=>cn(e.country))))];
  CD.caam_exp_months    = caaMExpMonths.map(lbl);
  CD.caam_exp_countries = caamExpAllCo;
  CD.caam_exp_series    = Object.fromEntries(caamExpAllCo.map(co => [co,
    caaMExpMonths.map(ym => { const e=(monthly[ym].caam_exp_countries||[]).find(x=>cn(x.country)===co); return e?e.units:null; })
  ]));

  // ---- 輸出国別（CADA）2024年〜 ----
  const cadaExpMonths = sorted.filter(ym => (monthly[ym]?.cada_exp_countries||[]).length > 0);
  const cadaExpAllCo  = [...new Set(cadaExpMonths.flatMap(ym => (monthly[ym].cada_exp_countries||[]).map(e=>cn(e.country))))];
  CD.cada_exp_months    = cadaExpMonths.map(lbl);
  CD.cada_exp_countries = cadaExpAllCo;
  CD.cada_exp_series    = Object.fromEntries(cadaExpAllCo.map(co => [co,
    cadaExpMonths.map(ym => { const e=(monthly[ym].cada_exp_countries||[]).find(x=>cn(x.country)===co); return e?e.units:null; })
  ]));

  // ---- 輸入国別 ----
  // ---- NEV輸出国別シリーズ ----
  const nevExpMonths  = sorted.filter(ym => (monthly[ym]?.nev_exp_countries||[]).length > 0);
  const nevExpAllCo   = [...new Set(nevExpMonths.flatMap(ym => (monthly[ym].nev_exp_countries||[]).map(e=>cn(e.country))))];
  // X軸ラベル: 累計月は「25年1-2月累計」のように表示
  CD.nev_exp_months   = nevExpMonths.map(ym => {
    const d = monthly[ym];
    return d.nev_exp_period || lbl(ym);
  });
  CD.nev_exp_months_raw = nevExpMonths; // ツールチップ用
  CD.nev_exp_cumul_flags = nevExpMonths.map(ym => monthly[ym]?.nev_exp_is_cumul || false);
  CD.nev_exp_countries= nevExpAllCo;
  CD.nev_exp_series   = Object.fromEntries(nevExpAllCo.map(co => [co,
    nevExpMonths.map(ym => { const e=(monthly[ym].nev_exp_countries||[]).find(x=>cn(x.country)===co); return e?e.units:null; })
  ]));

  // 輸入: 全月X軸固定（データなし月はnull → 線が空欄を飛び越えてつながる）
  // データのある月から全国名を収集
  const impMonths    = sorted.filter(ym => (monthly[ym]?.import_countries||[]).length > 0);
  const impAllCo     = [...new Set(impMonths.flatMap(ym => (monthly[ym].import_countries||[]).map(e=>cn(e.country))))];
  // X軸は全月（累計フラグ・ラベルはデータ月のみ特別処理、他はlbl()）
  const impAllMonths = sorted.filter(ym => {
    // グラフ開始月: 最初にデータがある月から
    return impMonths.length > 0 && ym >= impMonths[0];
  });
  CD.import_months      = impAllMonths.map(ym => monthly[ym]?.import_period || lbl(ym));
  CD.import_cumul_flags = impAllMonths.map(ym => monthly[ym]?.import_is_cumul || false);
  CD.import_countries   = impAllCo;
  CD.import_series      = Object.fromEntries(impAllCo.map(co => [co,
    impAllMonths.map(ym => { const e=(monthly[ym]?.import_countries||[]).find(x=>cn(x.country)===co); return e?e.units:null; })
  ]));

  // ---- CADAサマリー ----
  const cadaSumMonths = sorted.filter(ym => Object.keys(monthly[ym]?.cada_summary||{}).length > 0);
  CD.cada_sum_months = cadaSumMonths.map(lbl);
  ['cada_exp_total','cada_nev_exp','cada_bev_exp','cada_phev_exp',
   'cada_zizhu_exp','cada_jv_exp','cada_ice_exp','cada_nev_zizhu','cada_nev_pen_exp'].forEach(f => {
    CD[f] = cadaSumMonths.map(ym => monthly[ym]?.cada_summary?.[f] ?? null);
  });

  // ---- 世界指標 ----
  const worldMonths = sorted.filter(ym => Object.keys(monthly[ym]?.world||{}).length > 0 && Object.values(monthly[ym]?.world||{}).some(v => v !== null));
  CD.world_months = worldMonths.map(lbl);
  ['cn_world_share','zizhu_nev_overseas','world_nev_pen','cn_nev_world_share','world_nev_monthly'].forEach(f => {
    CD[f] = worldMonths.map(ym => monthly[ym]?.world?.[f] ?? null);
  });

  // ---- SD 組み立て（単月計算シートから） ----
  const ice_segs  = ['A00','A0','A','B','C','D'];
  const nev_segs  = ['A00','A0','A','B','C','D'];
  const ice_prices= ['8万以下','8-10万','10-15万','15-20万','20-25万','25-30万','30-35万','35-40万','40-50万','50万以上'];
  const nev_prices= ['8万以下','8-10万','10-15万','15-20万','20-25万','25-30万','30-35万','35-40万','40-50万','50万以上'];

  SD = {
    months: seg_months.map(lbl),
    trad_seg:   Object.fromEntries(ice_segs.map(s  => [s,  seg_months.map(ym => monthly[ym]?.trad_seg?.[s]  ?? null)])),
    nev_seg:    Object.fromEntries(nev_segs.map(s  => [s,  seg_months.map(ym => monthly[ym]?.nev_seg?.[s]   ?? null)])),
    trad_price: Object.fromEntries(ice_prices.map(p => [p, seg_months.map(ym => monthly[ym]?.trad_price?.[p]?? null)])),
    nev_price:  Object.fromEntries(nev_prices.map(p => [p, seg_months.map(ym => monthly[ym]?.nev_price?.[p] ?? null)])),
  };

}

// ロード済みチェック付きの安全なグラフ初期化ラッパー
function safeInit(fn) {
  if (!CAAM_EXCEL_LOADED) return;
  fn();
}

// ダミー CD 定義（ロード前にエラーにならないよう）
// 実際の値は loadCaamExcel() 完了後にセットされる
const PAL = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac','#d37295','#a0cbe8'];

/* ============================================================
 * 全積み上げ棒グラフ共通 tooltip (LFP/三元型式に統一)
 *   - 合計を先頭に太字表示
 *   - 各系列は ● カラードット + 系列名: <値> 単位
 *   - <br> 区切り、<hr>・YoY・構成比%は付けない
 * ============================================================ */
function unifiedStackTooltip(opts) {
  opts = opts || {};
  var unit = opts.unit != null ? opts.unit : '万台';
  var digits = opts.digits != null ? opts.digits : 1;
  var note = opts.note || '';
  var showTotal = opts.showTotal !== false;
  var sort = opts.sort || null;   // null（系列順）|'desc'|'asc' —  opt-in
  var hideZero = opts.hideZero === true;  // opt-in: 0の系列を非表示
  var unitBy = opts.unitBySeries || {};  // opt-in: 系列名ごとの単位（例：平均線は km）
  function fmtNum(v){
    if (v == null || isNaN(v)) return '−';
    var n = Number(v);
    return n.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:digits});
  }
  return {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderColor: '#ddd',
    borderWidth: 1,
    textStyle: { fontSize: 12 },
    formatter: function(params){
      if (!params || !params.length) return '';
      var valid = params.filter(function(p){
        if (p.value == null || isNaN(p.value)) return false;
        if (hideZero && Number(p.value) === 0) return false;
        return true;
      });
      if (!valid.length) return '';
      var axisLabel = (params[0].axisValueLabel || params[0].axisValue || '');
      if (typeof axisLabel === 'string') axisLabel = axisLabel.replace(/\n/g, ' ');
      var total = 0;
      valid.forEach(function(p){ total += Number(p.value) || 0; });
      // オプションで値の大小にソート
      if (sort === 'desc') valid.sort(function(a,b){ return Number(b.value) - Number(a.value); });
      else if (sort === 'asc') valid.sort(function(a,b){ return Number(a.value) - Number(b.value); });
      var s = '<b>' + axisLabel + '</b><br/>';
      if (showTotal && valid.length > 1) {
        s += '合計: <b>' + fmtNum(total) + '</b> ' + unit + '<br/>';
      }
      valid.forEach(function(p){
        var color = (p.color && typeof p.color === 'string') ? p.color
                  : (p.color && p.color.colorStops && p.color.colorStops[0] && p.color.colorStops[0].color) ? p.color.colorStops[0].color
                  : '#888';
        s += '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'
           + color + ';margin-right:4px;vertical-align:middle"></span>';
        s += p.seriesName + ': <b>' + fmtNum(p.value) + '</b> ' + (unitBy[p.seriesName] != null ? unitBy[p.seriesName] : unit) + '<br/>';
      });
      if (note) s += '<span style="font-size:10px;color:#888">' + note + '</span>';
      return s;
    }
  };
}

function gt() {
  const dark = document.documentElement.getAttribute('data-bs-theme')==='dark';
  return {
    bg: dark?'#1e1e2e':'#ffffff', text: dark?'#cdd6f4':'#333',
    sub: dark?'#a6adc8':'#888', grid: dark?'#313244':'#eaeaea',
    ax: dark?'#585b70':'#dee2e6'
  };
}

function baseOpt(t, yname) {
  return {
    backgroundColor: t.bg,
    tooltip: { trigger:'axis', axisPointer:{type:'shadow'} },
    legend: { top:8, textStyle:{color:t.text}, type:'scroll' },
    grid: { top:56, bottom:72, left:64, right:24 },
    xAxis: { type:'category', axisLabel:{color:t.sub, rotate:35, fontSize:10}, axisLine:{lineStyle:{color:t.ax}} },
    yAxis: { type:'value', name:yname||'万台',
              axisLabel:{color:t.sub}, splitLine:{lineStyle:{color:t.grid}} },
  };
}

const EC = {};
const INITED = {};

function initEC(id, fn) {
  if (INITED[id]) return;
  const el = document.getElementById(id);
  if (!el) return;
  INITED[id] = true;
  EC[id] = echarts.getInstanceByDom(el) || echarts.init(el, null, {renderer:'svg'});
  fn(EC[id]);
}

// ① 総合概要
function initOverview() {
  if (!CAAM_EXCEL_LOADED) return;
  initEC('ec-overview', chart => {
    const t = gt();
    const opt = baseOpt(t);
    opt.xAxis.data = CD.labels_all;
    opt.tooltip.formatter = params => {
      let s = `<b>${params[0].axisValue}</b><br>`;
      params.forEach(p => s += `${p.marker}${p.seriesName}：<b>${p.value??'−'}</b> 万台<br>`);
      return s;
    };
    opt.series = [
      { name:'総販売', type:'bar',  data:CD.total_sales, itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'#4e79a7'},{offset:1,color:'#2c5282'}])} },
      { name:'国内販売', type:'line',  data:CD.domestic_sales, symbol:'circle', symbolSize:5, lineStyle:{width:2,color:'#59a14f'}, itemStyle:{color:'#59a14f'} },
      { name:'輸出', type:'line',  data:CD.export_total, symbol:'circle', symbolSize:5, lineStyle:{width:2,color:'#f28e2b'}, itemStyle:{color:'#f28e2b'} },
    ];
    chart.setOption(opt);
  });
}

// ② 国内・輸出内訳（正しい分解 + FCEV注記）
function initDomExp() {
  if (!CAAM_EXCEL_LOADED) return;
  initEC('ec-domestic-export', chart => {
    const t = gt();
    const opt = baseOpt(t);
    opt.xAxis.data = CD.labels_all;
    opt.tooltip = unifiedStackTooltip({unit:'万台', note:'※FCEV(燃料電池)は国内NEVに含む（最大0.4万台/月）'});
    opt.series = [
      { name:'国内（乗用ICE）', type:'bar', stack:'s', data:CD.pax_trad_dom, itemStyle:{color:'#adb5bd'} },
      { name:'国内（乗用NEV）', type:'bar', stack:'s', data:CD.nev_pax_dom,  itemStyle:{color:'#4e79a7'} },
      { name:'国内（商用）',   type:'bar', stack:'s', data:CD.com_domestic,  itemStyle:{color:'#9dc6e0'} },
      { name:'輸出（ICE乗用）', type:'bar', stack:'s', data:CD.pax_ice_exp,   itemStyle:{color:'#ffd6a5'} },
      { name:'輸出（BEV）',   type:'bar', stack:'s', data:CD.bev_exp,       itemStyle:{color:'#f28e2b'} },
      { name:'輸出（PHEV）',  type:'bar', stack:'s', data:CD.phev_exp,      itemStyle:{color:'#e15759'} },
    ];
    // 自動取得の月（ICE/NEV・BEV/PHEV の内訳が未反映）は、内訳なしの合計を斜線で積む
    if (CD.pax_dom_unsplit.some(v => v != null)) opt.series.splice(2, 0, { name:'国内（乗用・内訳未反映）', type:'bar', stack:'s', data:CD.pax_dom_unsplit, itemStyle:{color:'#94a3b8', decal:CAAM_UNSPLIT_DECAL} });
    if (CD.pax_exp_unsplit.some(v => v != null)) opt.series.push({ name:'輸出（乗用・内訳未反映）', type:'bar', stack:'s', data:CD.pax_exp_unsplit, itemStyle:{color:'#fdba74', decal:CAAM_UNSPLIT_DECAL} });
    chart.setOption(opt);
  });
}

// ③ NEV内訳
function initNev() {
  if (!CAAM_EXCEL_LOADED) return;
  initEC('ec-nev', chart => {
    const t = gt();
    const opt = baseOpt(t);
    opt.xAxis.data = CD.labels_all;
    opt.tooltip = unifiedStackTooltip({unit:'万台'});
    opt.series = [
      { name:'従来車', type:'bar', stack:'s', data:CD.trad_sales, itemStyle:{color:'#94a3b8'} },
      { name:'BEV', type:'bar', stack:'s', data:CD.bev_sales, itemStyle:{color:'#4e79a7'} },
      { name:'PHEV', type:'bar', stack:'s', data:CD.phev_sales, itemStyle:{color:'#59a14f'} },
    ];
    if (CD.nev_unsplit.some(v => v != null)) opt.series.push({ name:'NEV（BEV/PHEV内訳未反映）', type:'bar', stack:'s', data:CD.nev_unsplit, itemStyle:{color:'#93c5fd', decal:CAAM_UNSPLIT_DECAL} });
    chart.setOption(opt);
  });
}

// ⑤ 乗用車・商用車
function initSeg() {
  if (!CAAM_EXCEL_LOADED) return;
  initEC('ec-segment', chart => {
    const t = gt();
    const opt = baseOpt(t);
    opt.xAxis.data = CD.labels_all;
    opt.series = [
      { name:'乗用車 総販売', type:'bar',  data:CD.pax_sales, itemStyle:{color:'#4e79a7',opacity:0.8} },
      { name:'乗用車 国内', type:'line',  data:CD.pax_domestic, symbol:'circle', symbolSize:5, lineStyle:{width:2,color:'#4e79a7'}, itemStyle:{color:'#4e79a7'} },
      { name:'乗用車 輸出', type:'line',  data:CD.pax_export, symbol:'triangle', symbolSize:5, lineStyle:{width:2,color:'#76b7b2'}, itemStyle:{color:'#76b7b2'} },
      { name:'商用車 総販売', type:'bar',  data:CD.com_sales_calc, itemStyle:{color:'#f28e2b',opacity:0.8} },
      { name:'商用車 国内', type:'line',  data:CD.com_domestic, symbol:'circle', symbolSize:5, lineStyle:{width:2,color:'#f28e2b'}, itemStyle:{color:'#f28e2b'} },
      { name:'商用車 輸出', type:'line',  data:CD.com_export, symbol:'triangle', symbolSize:5, lineStyle:{width:2,color:'#edc948'}, itemStyle:{color:'#edc948'} },
    ];
    chart.setOption(opt);
  });
}

// ⑥ ブランド系シェア（積み上げ面グラフ、年ごと）（出所：CADA乗聯分会）
function initBrand() {
  if (!CAAM_EXCEL_LOADED) return;
  initEC('ec-brand', chart => {
    const t = gt();

    const series_def = [
      { name:'中国ブランド', color:'#c9184a' },
      { name:'独系',         color:'#4e79a7' },
      { name:'日系',         color:'#f28e2b' },
      { name:'米系',         color:'#2d6a4f' },
      { name:'韓系',         color:'#e15759' },
      { name:'その他',       color:'#adb5bd' },
    ];

    // 各年の「最終月」インデックスを取得（12月優先）
    // 2022・2023はハードコード済みのため先頭インデックスを直接使用
    const HC_YEARS = { '2022': 0, '2023': 1 };
    const years = [...new Set(CD.brand_labels_all.map(l => '20' + l.slice(0,2)))].sort();
    const yearLabels = [];
    const yearIndices = [];
    years.forEach(yr => {
      if (HC_YEARS[yr] !== undefined) {
        yearLabels.push(yr + '年末時点');
        yearIndices.push(HC_YEARS[yr]);
        return;
      }
      const shortYr = yr.slice(2);
      const idxList = CD.brand_labels_all.reduce((acc, l, i) => {
        if (l.startsWith(shortYr + '年')) acc.push(i);
        return acc;
      }, []);
      if (!idxList.length) return;
      const dec = idxList.find(i => CD.brand_labels_all[i].includes('12月'));
      const useIdx = dec !== undefined ? dec : idxList[idxList.length - 1];
      const lbl = dec !== undefined ? yr + '年末時点' : CD.brand_labels_all[useIdx] + '時点';
      yearLabels.push(lbl);
      yearIndices.push(useIdx);
    });

    const opt = {
      backgroundColor: t.bg,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: params => {
          let s = `<b>${params[0].axisValue}</b>（年末累計シェア）<br>`;
          [...params].reverse().forEach(p => {
            if (p.value != null) s += `${p.marker}${p.seriesName}：<b>${p.value}%</b><br>`;
          });
          s += `<span style="font-size:10px;color:#888">※通年シェアあり月はそれを使用、なければ月次累計値</span>`;
          return s;
        }
      },
      legend: { data: series_def.map(s => s.name), top: 8, textStyle: { color: t.text }, type: 'scroll' },
      grid: { top: 48, bottom: 48, left: 56, right: 24 },
      xAxis: {
        type: 'category',
        data: yearLabels,
        boundaryGap: true,
        axisLabel: { color: t.sub, fontSize: 11 },
        axisLine: { lineStyle: { color: t.ax } }
      },
      yAxis: {
        type: 'value', name: '%', max: 100, min: 0,
        axisLabel: { color: t.sub, formatter: '{value}%' },
        splitLine: { lineStyle: { color: t.grid } }
      },
      series: series_def.map(s => ({
        name: s.name,
        type: 'bar',
        stack: 'brand',
        data: yearIndices.map(i => CD.brand_series_normed[s.name]?.[i] ?? null),
        itemStyle: { color: s.color },
        label: {
          show: true,
          position: 'inside',
          formatter: p => p.value != null && p.value >= 5 ? p.value + '%' : '',
          fontSize: 11,
          color: '#fff',
          fontWeight: 'bold'
        }
      }))
    };
    opt.tooltip = unifiedStackTooltip({unit:'万台'});
    chart.setOption(opt);
  });
}



function initTradSeg() {
  if (!CAAM_EXCEL_LOADED) return;
    initEC('ec-trad-seg', chart => {
    const t = gt();
    const opt = baseOpt(t);
    opt.xAxis.data = SD.months;
    const segs = Object.keys(SD.trad_seg).filter(s=>s!=='D'); // Dは超小量なので省略可だが表示
    opt.tooltip = unifiedStackTooltip({unit:'万台'});
    opt.series = ['A00','A0','A','B','C','D'].filter(s => SD.trad_seg[s]).map((s,i) => ({
      name: s, type:'bar', stack:'ice_seg', data: SD.trad_seg[s],
      itemStyle:{color:PAL[i%12]}
    }));
    opt.yAxis.min = 0;
    chart.setOption(opt);
  });
}

// ⑪ NEVセグメント
function initNevSeg() {
  if (!CAAM_EXCEL_LOADED) return;
    initEC('ec-nev-seg', chart => {
    const t = gt();
    const opt = baseOpt(t);
    opt.xAxis.data = SD.months;
    opt.tooltip = unifiedStackTooltip({unit:'万台'});
    opt.series = ['A00','A0','A','B','C','D'].filter(s => SD.nev_seg[s]).map((s,i) => ({
      name: s, type:'bar', stack:'nev_seg', data: SD.nev_seg[s],
      itemStyle:{color:PAL[i%12]}
    }));
    chart.setOption(opt);
  });
}

// ⑫ 価格帯　月次推移（折れ線）
function initPrice() {
  if (!CAAM_EXCEL_LOADED) return;
    // ICE価格帯の表示バンド（全10帯）
  const iceBands = ['8万以下','8-10万','10-15万','15-20万','20-25万','25-30万','30-35万','35-40万','40-50万','50万以上'];
  // NEV価格帯（26年2月のみ15-20万に15-25万合算値が入り、20-25万はnull）
  const nevBands = ['8万以下','8-10万','10-15万','15-20万','20-25万','25-30万','30-35万','35-40万','40-50万','50万以上'];

  initEC('ec-trad-price', chart => {
    const t = gt();
    const opt = baseOpt(t);
    opt.xAxis.data = SD.months;
    opt.legend.type = 'scroll';
    opt.tooltip.formatter = params => {
      let s = `<b>${params[0].axisValue}</b><br>`;
      params.filter(p=>p.value!=null).forEach(p => s += `${p.marker}${p.seriesName}：<b>${p.value}</b> 万台<br>`);
      return s;
    };
    opt.series = iceBands.map((b,i) => ({
      name: b, type:'line', data: SD.trad_price[b],
      symbol:'circle', symbolSize:5, connectNulls:false,
      lineStyle:{width:2, color:PAL[i%12]},
      itemStyle:{color:PAL[i%12]}
    }));
    chart.setOption(opt);
  });

  initEC('ec-nev-price', chart => {
    const t = gt();
    const opt = baseOpt(t);
    opt.xAxis.data = SD.months;
    opt.legend.type = 'scroll';
    opt.tooltip.formatter = params => {
      let s = `<b>${params[0].axisValue}</b><br>`;
      params.filter(p=>p.value!=null).forEach(p => s += `${p.marker}${p.seriesName}：<b>${p.value}</b> 万台<br>`);
      s += `<br><span style="font-size:10px;color:#888">※26年2月は15-20万に15-25万の合算値を表示</span>`;
      return s;
    };
    opt.series = nevBands.map((b,i) => {
      const data = SD.nev_price[b] || new Array(SD.months.length).fill(null);
      return {
        name: b, type:'line', data,
        symbol:'circle', symbolSize:5, connectNulls:false,
        lineStyle:{width:2, color:PAL[i%12]},
        itemStyle:{color:PAL[i%12]}
      };
    });
    chart.setOption(opt);
  });
}


// NEV詳細グラフ
function initNevDetail() {
  if (!CAAM_EXCEL_LOADED) return;
    initEC('ec-nev-prod', chart => {
    const t = gt();
    const opt = baseOpt(t);
    opt.xAxis.data = CD.labels_all;
    opt.tooltip = unifiedStackTooltip({unit:'万台'});
    opt.series = [
      { name:'BEV生産', type:'bar', stack:'prod', data:CD.bev_prod, itemStyle:{color:'rgba(78,121,167,0.45)'}, barMaxWidth:28 },
      { name:'PHEV生産', type:'bar', stack:'prod', data:CD.phev_prod, itemStyle:{color:'rgba(89,161,79,0.45)'}, barMaxWidth:28 },
      { name:'BEV販売', type:'line', data:CD.bev_sales, symbol:'circle', symbolSize:6, lineStyle:{width:2.5,color:'#4e79a7'}, itemStyle:{color:'#4e79a7'} },
      { name:'PHEV販売', type:'line', data:CD.phev_sales, symbol:'circle', symbolSize:6, lineStyle:{width:2.5,color:'#59a14f'}, itemStyle:{color:'#59a14f'} },
    ];
    chart.setOption(opt);
  });

  initEC('ec-nev-seg-dom', chart => {
    const t = gt();
    const opt = baseOpt(t);
    opt.xAxis.data = CD.labels_all;
    opt.tooltip = unifiedStackTooltip({unit:'万台'});
    opt.series = [
      { name:'NEV乗用車 国内', type:'bar', stack:'s', data:CD.nev_pax_dom, itemStyle:{color:'#4e79a7'} },
      { name:'NEV商用車 国内', type:'bar', stack:'s', data:CD.nev_com_dom, itemStyle:{color:'#f28e2b'} },
      { name:'NEV全体 国内（合計線）', type:'line', data:CD.nev_domestic, symbol:'diamond', symbolSize:6,
        lineStyle:{width:2,color:'#e15759',type:'dashed'}, itemStyle:{color:'#e15759'},
        } ,
    ];
    chart.setOption(opt);
  });
}


// ===== 新グラフ関数 =====

// 産販推移（生産 vs 販売 + ギャップ）
function initProduction() {
  if (!CAAM_EXCEL_LOADED) return;
    initEC('ec-prod-total', chart => {
    const t = gt();
    const opt = baseOpt(t);
    opt.xAxis.data = CD.labels_all;
    opt.legend.type = 'scroll';
    opt.tooltip.formatter = params => {
      let s = `<b>${params[0].axisValue}</b><br>`;
      params.forEach(p => { if(p.value!=null) s += `${p.marker}${p.seriesName}：<b>${p.value}</b> 万台<br>`; });
      return s;
    };
    opt.series = [
      { name:'全体生産', type:'bar', barMaxWidth:18, data:CD.total_prod, itemStyle:{color:'rgba(78,121,167,0.4)'} },
      { name:'全体販売', type:'line', data:CD.total_sales, symbol:'circle', symbolSize:6, lineStyle:{width:2.5,color:'#4e79a7'}, itemStyle:{color:'#4e79a7'} },
      { name:'乗用車生産', type:'bar', barMaxWidth:18, data:CD.pax_prod, itemStyle:{color:'rgba(89,161,79,0.4)'} },
      { name:'乗用車販売', type:'line', data:CD.pax_sales, symbol:'circle', symbolSize:6, lineStyle:{width:2.5,color:'#59a14f'}, itemStyle:{color:'#59a14f'} },
      { name:'商用車生産', type:'bar', barMaxWidth:18, data:CD.com_prod, itemStyle:{color:'rgba(242,142,43,0.4)'} },
      { name:'商用車販売', type:'line', data:CD.com_sales, symbol:'circle', symbolSize:6, lineStyle:{width:2.5,color:'#f28e2b'}, itemStyle:{color:'#f28e2b'} },
    ];
    chart.setOption(opt);
  });
}

// BEV/PHEV 国内vs輸出詳細
function initBevPhev() {
  if (!CAAM_EXCEL_LOADED) return;
    initEC('ec-bev-phev-dom-exp', chart => {
    const t = gt();
    const opt = baseOpt(t);
    opt.xAxis.data = CD.labels_all;
    opt.tooltip = unifiedStackTooltip({unit:'万台'});
    opt.series = [
      { name:'BEV国内', type:'bar', stack:'bev', data:CD.bev_dom, itemStyle:{color:'#4e79a7'}, barMaxWidth:30 },
      { name:'BEV輸出', type:'bar', stack:'bev', data:CD.bev_exp, itemStyle:{color:'#a0cbe8'}, barMaxWidth:30 },
      { name:'PHEV国内', type:'bar', stack:'phev', data:CD.phev_dom, itemStyle:{color:'#59a14f'}, barMaxWidth:30 },
      { name:'PHEV輸出', type:'bar', stack:'phev', data:CD.phev_exp, itemStyle:{color:'#b6d8a8'}, barMaxWidth:30 },
    ];
    chart.setOption(opt);
  });

  initEC('ec-nev-exp-breakdown', chart => {
    const t = gt();
    const opt = baseOpt(t);
    opt.xAxis.data = CD.labels_all;
    opt.tooltip.formatter = params => {
      let s = `<b>${params[0].axisValue}</b><br>`;
      params.forEach(p => { if(p.value!=null) s += `${p.marker}${p.seriesName}：<b>${p.value}</b> 万台<br>`; });
      return s;
    };
    opt.series = [
      { name:'NEV全体輸出', type:'bar', barMaxWidth:20, data:CD.nev_exp, itemStyle:{color:'rgba(78,121,167,0.3)'} },
      { name:'乗用車NEV輸出', type:'line', data:CD.nev_pax_exp, symbol:'circle', symbolSize:6, lineStyle:{width:2,color:'#4e79a7'}, itemStyle:{color:'#4e79a7'} },
      { name:'商用車NEV輸出', type:'line', data:CD.nev_com_exp, symbol:'triangle', symbolSize:6, lineStyle:{width:2,color:'#f28e2b'}, itemStyle:{color:'#f28e2b'} },
      { name:'BEV輸出', type:'line', data:CD.bev_exp, symbol:'diamond', symbolSize:6, lineStyle:{width:2,color:'#e15759',type:'dashed'}, itemStyle:{color:'#e15759'} },
      { name:'PHEV輸出', type:'line', data:CD.phev_exp, symbol:'rect', symbolSize:6, lineStyle:{width:2,color:'#76b7b2',type:'dashed'}, itemStyle:{color:'#76b7b2'} },
    ];
    chart.setOption(opt);
  });
}

// 商用車詳細
function initCommercial() {
  if (!CAAM_EXCEL_LOADED) return;
    initEC('ec-truck-type', chart => {
    const t = gt();
    const opt = baseOpt(t);
    // 2025年4月以降のデータしかないため、有効月のみ表示
    const truckMonths = CD.labels_all.filter((_,i) =>
      CD.truck_heavy[i] != null || CD.truck_mid[i] != null ||
      CD.truck_light[i] != null || CD.truck_micro[i] != null
    );
    const truckIdx = CD.labels_all.reduce((acc,_,i) => {
      if (CD.truck_heavy[i] != null || CD.truck_mid[i] != null ||
          CD.truck_light[i] != null || CD.truck_micro[i] != null) acc.push(i);
      return acc;
    }, []);
    opt.xAxis.data = truckMonths;
    opt.tooltip = unifiedStackTooltip({unit:'万台'});
    opt.series = [
      { name:'重型貨車', type:'bar', stack:'s', data:truckIdx.map(i=>CD.truck_heavy[i]), itemStyle:{color:PAL[0]} },
      { name:'中型貨車', type:'bar', stack:'s', data:truckIdx.map(i=>CD.truck_mid[i]),   itemStyle:{color:PAL[1]} },
      { name:'軽型貨車', type:'bar', stack:'s', data:truckIdx.map(i=>CD.truck_light[i]), itemStyle:{color:PAL[2]} },
      { name:'微型貨車', type:'bar', stack:'s', data:truckIdx.map(i=>CD.truck_micro[i]), itemStyle:{color:PAL[3]} },
    ];
    chart.setOption(opt);
  });

  initEC('ec-bus-type', chart => {
    const t = gt();
    const opt = baseOpt(t);
    // 客車細分類別は2025年4月以降のみデータあり
    const busStart = CD.labels_all.indexOf('25年4月');
    const busLabels = busStart >= 0 ? CD.labels_all.slice(busStart) : CD.labels_all;
    const busLarge  = busStart >= 0 ? CD.bus_large.slice(busStart)  : CD.bus_large;
    const busLight  = busStart >= 0 ? CD.bus_light.slice(busStart)  : CD.bus_light;
    opt.xAxis.data = busLabels;
    opt.series = [
      { name:'大中型客車', type:'line', data:busLarge, symbol:'circle', symbolSize:6, lineStyle:{width:2,color:PAL[4]}, itemStyle:{color:PAL[4]},
        } ,
      { name:'軽型客車', type:'line', data:busLight, symbol:'circle', symbolSize:6, lineStyle:{width:2,color:PAL[5]}, itemStyle:{color:PAL[5]},
        } ,
    ];
    chart.setOption(opt);
  });

  initEC('ec-lng', chart => {
    const t = gt();
    const opt = baseOpt(t);
    // 天然ガス車販売は2025年2月以降のみデータあり
    const lngStart  = CD.labels_all.indexOf('25年2月');
    const lngLabels = lngStart >= 0 ? CD.labels_all.slice(lngStart) : CD.labels_all;
    const lngData   = lngStart >= 0 ? CD.lng_sales.slice(lngStart)  : CD.lng_sales;
    opt.xAxis.data = lngLabels;
    opt.series = [{
      name:'天然ガス車販売', type:'bar', data:lngData,
      itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'#59a14f'},{offset:1,color:'#2d6a4f'}])}
    }];
    chart.setOption(opt);
  });
}

// ===== 新規グラフ関数群 =====

// 輸出先国（CAAM・海関総署ベース）
function initCountryCaam() {
  if (!CAAM_EXCEL_LOADED) return;
  initEC('ec-country-caam', chart => {
    const t = gt(); const opt = baseOpt(t);
    if (!CD.caam_exp_months?.length) { chart.setOption({title:{text:'データなし（2023年5〜12月のみ）',left:'center',top:'middle'}}); return; }
    opt.xAxis.data = CD.caam_exp_months;
    opt.grid.bottom = 80; opt.grid.right = 165;
    opt.legend = { orient:'vertical', right:0, top:40, width:160, textStyle:{color:t.sub,fontSize:11}, type:'scroll', pageTextStyle:{color:t.sub} };
    opt.xAxis.axisLabel.rotate = 35;
    opt.tooltip.formatter = params => {
      let s = `<b>${params[0].axisValue}</b><br>`;
      params.filter(p=>p.value!=null).sort((a,b)=>b.value-a.value)
        .forEach(p => s += `${p.marker}${p.seriesName}：<b>${p.value}</b> 万台<br>`);
      return s;
    };
    opt.series = CD.caam_exp_countries.map((co,i) => ({
      name:co, type:'line', data:CD.caam_exp_series[co],
      symbol:'circle', symbolSize:5, connectNulls:false,
      lineStyle:{width:2,color:PAL[i%12]}, itemStyle:{color:PAL[i%12]}
    }));
    chart.setOption(opt);
  });
}

// 輸出先国（CADA・乗聯分会ベース）
function initCountryCada() {
  if (!CAAM_EXCEL_LOADED) return;
  initEC('ec-country-cada', chart => {
    const t = gt(); const opt = baseOpt(t);
    if (!CD.cada_exp_months?.length) { chart.setOption({title:{text:'データなし',left:'center',top:'middle'}}); return; }
    opt.xAxis.data = CD.cada_exp_months;
    opt.grid.bottom = 80; opt.grid.right = 165;
    opt.legend = { orient:'vertical', right:0, top:40, width:160, textStyle:{color:t.sub,fontSize:11}, type:'scroll', pageTextStyle:{color:t.sub} };
    opt.xAxis.axisLabel.rotate = 35;
    opt.tooltip.formatter = params => {
      let s = `<b>${params[0].axisValue}</b><br>`;
      params.filter(p=>p.value!=null).sort((a,b)=>b.value-a.value)
        .forEach(p => s += `${p.marker}${p.seriesName}：<b>${p.value}</b> 万台<br>`);
      s += `<br><span style="font-size:10px;color:#888">※2024年前半は上位5カ国のみ掲載</span>`;
      return s;
    };
    opt.series = CD.cada_exp_countries.map((co,i) => ({
      name:co, type:'line', data:CD.cada_exp_series[co],
      symbol:'circle', symbolSize:5, connectNulls:false,
      lineStyle:{width:2,color:PAL[i%12]}, itemStyle:{color:PAL[i%12]}
    }));
    chart.setOption(opt);
  });
}
function initNevExp() {
  if (!CAAM_EXCEL_LOADED) return;
  initEC('ec-country-nev-exp', chart => {
    const t = gt(); const opt = baseOpt(t);
    if (!CD.nev_exp_months?.length) { chart.setOption({title:{text:'データなし',left:'center',top:'middle'}}); return; }
    opt.xAxis.data = CD.nev_exp_months;
    opt.grid.bottom = 80; opt.grid.right = 165;
    opt.legend = { orient:'vertical', right:0, top:40, width:160, textStyle:{color:t.sub,fontSize:11}, type:'scroll', pageTextStyle:{color:t.sub} };
    opt.xAxis.axisLabel.rotate = 35;
    opt.tooltip.formatter = params => {
      const idx = params[0]?.dataIndex;
      const isCumul = CD.nev_exp_cumul_flags?.[idx];
      let s = `<b>${params[0].axisValue}</b>${isCumul ? ' <span style="color:#f59e0b;font-size:10px">※累計</span>' : ''}<br>`;
      params.filter(p=>p.value!=null).sort((a,b)=>b.value-a.value)
        .forEach(p => s += `${p.marker}${p.seriesName}：<b>${p.value}</b> 万台<br>`);
      if (isCumul) s += `<br><span style="font-size:10px;color:#888">※月次単月でなく累計値です</span>`;
      return s;
    };
    opt.series = CD.nev_exp_countries.map((co,i) => ({
      name:co, type:'line', data:CD.nev_exp_series[co],
      symbol:'circle', symbolSize:5, connectNulls:false,
      lineStyle:{width:2,color:PAL[i%12]}, itemStyle:{color:PAL[i%12]}
    }));
    chart.setOption(opt);
  });
}
function initCountry() { initCountryCaam(); initCountryCada(); initNevExp(); }

// CADAサマリー
function initCadaSummary() {
  if (!CAAM_EXCEL_LOADED) return;
  const noData = !CD.cada_sum_months?.length;
  // 出口内訳積み上げ棒
  initEC('ec-cada-summary', chart => {
    if (noData) { chart.setOption({title:{text:'データなし',left:'center',top:'middle'}}); return; }
    const t = gt(); const opt = baseOpt(t);
    opt.xAxis.data = CD.cada_sum_months;
    opt.tooltip = unifiedStackTooltip({unit:'万台'});
    opt.series = [
      { name:'中国ブランドICE輸出', type:'bar', stack:'s', data:CD.cada_ice_exp,   itemStyle:{color:'#adb5bd'} },
      { name:'中国系NEV輸出',         type:'bar', stack:'s', data:CD.cada_nev_zizhu, itemStyle:{color:'#4e79a7'} },
      { name:'JV・外資輸出',        type:'bar', stack:'s', data:CD.cada_jv_exp,    itemStyle:{color:'#f28e2b'} },
      { name:'CADA出口合計',        type:'line', data:CD.cada_exp_total,
        symbol:'circle', symbolSize:7, lineStyle:{width:2.5,color:'#e15759'}, itemStyle:{color:'#e15759'} },
    ];
    chart.setOption(opt);
  });
  // NEV普及率（輸出版）
  initEC('ec-cada-nev-pen', chart => {
    if (noData) { chart.setOption({title:{text:'データなし',left:'center',top:'middle'}}); return; }
    const t = gt(); const opt = baseOpt(t, '%');
    opt.xAxis.data = CD.cada_sum_months;
    opt.yAxis.min = 0; opt.yAxis.max = 70;
    opt.yAxis.axisLabel.formatter = '{value}%';
    opt.tooltip.formatter = params => {
      let s = `<b>${params[0].axisValue}</b><br>`;
      params.forEach(p => { if(p.value!=null) s += `${p.marker}${p.seriesName}：<b>${p.value}%</b><br>`; });
      return s;
    };
    opt.series = [{ name:'輸出NEV普及率', type:'line', data:CD.cada_nev_pen_exp,
      symbol:'circle', symbolSize:7, lineStyle:{width:3,color:'#4e79a7'}, itemStyle:{color:'#4e79a7'},
      areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'rgba(78,121,167,0.3)'},{offset:1,color:'rgba(78,121,167,0.02)'}])}
    }];
    chart.setOption(opt);
  });
  // BEV/PHEV内訳
  initEC('ec-cada-bev-phev', chart => {
    if (noData) { chart.setOption({title:{text:'データなし',left:'center',top:'middle'}}); return; }
    const t = gt(); const opt = baseOpt(t);
    opt.xAxis.data = CD.cada_sum_months;
    opt.tooltip = unifiedStackTooltip({unit:'万台'});
    opt.series = [
      { name:'BEV輸出',       type:'bar', stack:'s', data:CD.cada_bev_exp,  itemStyle:{color:'#4e79a7'} },
      { name:'PHEV/EREV輸出', type:'bar', stack:'s', data:CD.cada_phev_exp, itemStyle:{color:'#59a14f'} },
    ];
    chart.setOption(opt);
  });
}

// 世界NEV指標
function initWorld() {
  if (!CAAM_EXCEL_LOADED) return;
  const noData = !CD.world_months?.length;
  initEC('ec-world-nev', chart => {
    if (noData) { chart.setOption({title:{text:'データなし（2024年以降）',left:'center',top:'middle'}}); return; }
    const t = gt(); const opt = baseOpt(t, '%');
    opt.xAxis.data = CD.world_months;
    opt.yAxis.max = 80; opt.yAxis.min = 0; opt.yAxis.axisLabel.formatter = '{value}%';
    opt.tooltip.formatter = params => {
      let s = `<b>${params[0].axisValue}</b><br>`;
      params.forEach(p => { if(p.value!=null) s += `${p.marker}${p.seriesName}：<b>${p.value}%</b><br>`; });
      return s;
    };
    opt.series = [
      { name:'中国NEV世界シェア', type:'line', data:CD.cn_nev_world_share,
        symbol:'circle', symbolSize:6, lineStyle:{width:2.5,color:'#c9184a'}, itemStyle:{color:'#c9184a'} },
      { name:'世界NEV普及率',     type:'line', data:CD.world_nev_pen,
        symbol:'diamond', symbolSize:6, lineStyle:{width:2,color:'#4e79a7',type:'dashed'}, itemStyle:{color:'#4e79a7'} },
    ];
    chart.setOption(opt);
  });
  initEC('ec-world-share', chart => {
    if (noData) { chart.setOption({title:{text:'データなし',left:'center',top:'middle'}}); return; }
    const t = gt(); const opt = baseOpt(t, '%');
    opt.xAxis.data = CD.world_months;
    opt.yAxis.max = 45; opt.yAxis.min = 0; opt.yAxis.axisLabel.formatter = '{value}%';
    opt.tooltip.formatter = params => {
      let s = `<b>${params[0].axisValue}</b><br>`;
      params.forEach(p => { if(p.value!=null) s += `${p.marker}${p.seriesName}：<b>${p.value}%</b><br>`; });
      return s;
    };
    opt.series = [
      { name:'中国乗用車世界シェア', type:'line', data:CD.cn_world_share,
        symbol:'circle', symbolSize:6, lineStyle:{width:2.5,color:'#e15759'}, itemStyle:{color:'#e15759'} },
      { name:'中国系NEV海外市場シェア', type:'line', data:CD.zizhu_nev_overseas,
        symbol:'diamond', symbolSize:6, lineStyle:{width:2,color:'#59a14f',type:'dashed'}, itemStyle:{color:'#59a14f'} },
    ];
    chart.setOption(opt);
  });
  initEC('ec-world-vol', chart => {
    if (noData) { chart.setOption({title:{text:'データなし',left:'center',top:'middle'}}); return; }
    const t = gt(); const opt = baseOpt(t);
    opt.xAxis.data = CD.world_months;
    opt.tooltip.formatter = params => {
      let s = `<b>${params[0].axisValue}</b><br>`;
      params.forEach(p => { if(p.value!=null) s += `${p.marker}${p.seriesName}：<b>${p.value}</b> 万台<br>`; });
      return s;
    };
    opt.series = [{ name:'世界NEV月間販売', type:'bar', data:CD.world_nev_monthly,
      itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'#4e79a7'},{offset:1,color:'#2c5282'}])} }];
    chart.setOption(opt);
  });
}

// ---- 初期化マップ ----
const CHART_FNS = {
  'cp-overview':       initOverview,
  'cp-domestic-export': initDomExp,
  'cp-nev':            initNev,
  'cp-nev-detail':     initNevDetail,
  'cp-segment':        initSeg,
  'cp-brand':          initBrand,
  'cp-trad-seg':       initTradSeg,
  'cp-nev-seg':        initNevSeg,
  'cp-price':          initPrice,
  'cp-nev-detail':     initNevDetail,
  'cp-production':     initProduction,
  'cp-bev-phev':       initBevPhev,
  'cp-commercial':     initCommercial,
};

// 大タブ「グラフ」表示時に最初のグラフを初期化
document.getElementById('charts-super-tab').addEventListener('shown.bs.tab', () => {
  if (!CAAM_EXCEL_LOADED) {
    loadCaamExcel();
  } else {
    initOverview();
  }
});

// サブタブ切替時に初期化＋リサイズ（hidden→shown時にサイズが0になるバグ対策）
document.querySelectorAll('#chartsPills .nav-link').forEach(btn => {
  btn.addEventListener('shown.bs.tab', e => {
    const id = e.target.getAttribute('data-bs-target').replace('#','');
    if (CHART_FNS[id]) CHART_FNS[id]();
    // 表示後に全インスタンスをリサイズ（非表示タブから切り替えた際の描画崩れ対策）
    setTimeout(() => {
      Object.values(EC).forEach(c => { try { c && c.resize(); } catch(e){} });
      // 比較ピンボタンを追加
    }, 50);
  });
});

// リサイズ
window.addEventListener('resize', __rafThrottle(() => {
  Object.values(EC).forEach(c => __ecResize(c));
}));

// ページロード時にグラフタブが既にアクティブなら即座にロード開始
if (document.getElementById('charts-super-tab')?.classList.contains('active')) {
  loadCaamExcel();
}

// ===== CCCM統計グラフ =====
const CCCM_RAW = {"meta":{"source":"CCCM 月次統計","months":["2024-01","2024-02","2024-03","2024-04","2024-05","2024-06","2024-07","2024-08","2024-09","2024-10","2024-11","2024-12","2025-01","2025-02","2025-03","2025-04","2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04"],"generated":"2026-05-28"},"prod_sales":{"2025-01":{"gas_prod":136.48,"gas_prod_mom":-11.52,"gas_prod_yoy":2.68,"gas_sales":138.3,"gas_sales_mom":-7.38,"gas_sales_yoy":2.77,"ev_prod":20.71,"ev_prod_yoy":-8.78,"ev_sales":21.44,"ev_sales_yoy":-2.0,"total_prod":157.19,"total_prod_yoy":1.0,"total_sales":159.75,"total_sales_yoy":2.1,"bike_sales":142.54,"bike_sales_yoy":3.44,"large_sales":5.9,"large_sales_yoy":52.85,"trike_sales":17.2,"trike_sales_yoy":-7.78},"2025-02":{"gas_prod":107.75,"gas_prod_mom":-21.81,"gas_prod_yoy":39.86,"gas_sales":111.66,"gas_sales_mom":-20.35,"gas_sales_yoy":35.94,"ev_prod":24.95,"ev_prod_yoy":100.82,"ev_sales":24.25,"ev_sales_yoy":96.6,"total_prod":132.7,"total_prod_yoy":48.33,"total_sales":135.91,"total_sales_yoy":43.86,"bike_sales":119.57,"bike_sales_yoy":44.36,"large_sales":5.77,"large_sales_yoy":134.55,"trike_sales":16.34,"trike_sales_yoy":40.28},"2025-03":{"gas_prod":160.64,"gas_prod_mom":49.08,"gas_prod_yoy":15.81,"gas_sales":157.76,"gas_sales_mom":41.28,"gas_sales_yoy":17.89,"ev_prod":35.43,"ev_prod_yoy":3.95,"ev_sales":34.4,"ev_sales_yoy":2.73,"total_prod":196.07,"total_prod_yoy":13.47,"total_sales":192.16,"total_sales_yoy":14.86,"bike_sales":167.19,"bike_sales_yoy":16.97,"large_sales":8.81,"large_sales_yoy":68.45,"trike_sales":24.96,"trike_sales_yoy":2.44},"2025-04":{"gas_prod":174.83,"gas_prod_mom":8.83,"gas_prod_yoy":19.36,"gas_sales":171.51,"gas_sales_mom":8.72,"gas_sales_yoy":19.08,"ev_prod":27.71,"ev_prod_yoy":-7.1,"ev_sales":26.6,"ev_sales_yoy":-15.36,"total_prod":202.54,"total_prod_yoy":14.89,"total_sales":198.12,"total_sales_yoy":12.91,"bike_sales":174.66,"bike_sales_yoy":14.14,"large_sales":9.3,"large_sales_yoy":27.75,"trike_sales":23.46,"trike_sales_yoy":4.52},"2025-05":{"gas_prod":158.61,"gas_prod_mom":-9.27,"gas_prod_yoy":8.54,"gas_sales":160.91,"gas_sales_mom":-6.18,"gas_sales_yoy":11.12,"ev_prod":26.15,"ev_prod_yoy":-14.88,"ev_sales":26.72,"ev_sales_yoy":-19.33,"total_prod":184.76,"total_prod_yoy":4.47,"total_sales":187.63,"total_sales_yoy":5.45,"bike_sales":165.68,"bike_sales_yoy":5.52,"large_sales":10.12,"large_sales_yoy":31.09,"trike_sales":21.95,"trike_sales_yoy":4.91},"2025-06":{"gas_prod":161.47,"gas_prod_mom":1.77,"gas_prod_yoy":8.83,"gas_sales":161.83,"gas_sales_mom":0.53,"gas_sales_yoy":8.61,"ev_prod":25.18,"ev_prod_yoy":-15.37,"ev_sales":24.03,"ev_sales_yoy":-22.53,"total_prod":186.66,"total_prod_yoy":4.79,"total_sales":185.86,"total_sales_yoy":3.24,"bike_sales":165.49,"bike_sales_yoy":2.85,"large_sales":10.12,"large_sales_yoy":14.32,"trike_sales":20.37,"trike_sales_yoy":6.52},"2025-07":{"gas_prod":158.47,"gas_prod_mom":-2.14,"gas_prod_yoy":5.32,"gas_sales":159.83,"gas_sales_mom":-1.45,"gas_sales_yoy":7.51,"ev_prod":28.63,"ev_prod_yoy":-11.92,"ev_sales":27.96,"ev_sales_yoy":-19.04,"total_prod":187.1,"total_prod_yoy":2.25,"total_sales":187.79,"total_sales_yoy":2.51,"bike_sales":166.74,"bike_sales_yoy":3.08,"large_sales":8.83,"large_sales_yoy":21.66,"trike_sales":21.05,"trike_sales_yoy":-1.83},"2025-08":{"gas_prod":159.06,"gas_prod_mom":0.37,"gas_prod_yoy":11.24,"gas_sales":156.35,"gas_sales_mom":-2.18,"gas_sales_yoy":12.04,"ev_prod":29.0,"ev_prod_yoy":-14.6,"ev_sales":28.53,"ev_sales_yoy":-17.44,"total_prod":188.06,"total_prod_yoy":6.28,"total_sales":184.88,"total_sales_yoy":6.19,"bike_sales":162.88,"bike_sales_yoy":7.03,"large_sales":8.45,"large_sales_yoy":23.6,"trike_sales":22.0,"trike_sales_yoy":0.39},"2025-09":{"gas_prod":166.66,"gas_prod_mom":4.78,"gas_prod_yoy":14.1,"gas_sales":168.2,"gas_sales_mom":7.58,"gas_sales_yoy":11.74,"ev_prod":32.57,"ev_prod_yoy":-4.79,"ev_sales":30.62,"ev_sales_yoy":-12.38,"total_prod":199.23,"total_prod_yoy":10.51,"total_sales":198.82,"total_sales_yoy":7.19,"bike_sales":175.01,"bike_sales_yoy":7.69,"large_sales":8.66,"large_sales_yoy":13.05,"trike_sales":23.8,"trike_sales_yoy":3.72},"2025-10":{"gas_prod":144.73,"gas_prod_mom":-13.15,"gas_prod_yoy":8.2,"gas_sales":145.24,"gas_sales_mom":-13.64,"gas_sales_yoy":10.3,"ev_prod":30.69,"ev_prod_yoy":16.22,"ev_sales":30.12,"ev_sales_yoy":16.23,"total_prod":175.43,"total_prod_yoy":9.53,"total_sales":175.36,"total_sales_yoy":11.27,"bike_sales":150.06,"bike_sales_yoy":12.39,"large_sales":6.09,"large_sales_yoy":-0.16,"trike_sales":25.3,"trike_sales_yoy":5.07},"2025-11":{"gas_prod":152.96,"gas_prod_mom":5.68,"gas_prod_yoy":9.61,"gas_sales":148.07,"gas_sales_mom":1.95,"gas_sales_yoy":7.43,"ev_prod":31.69,"ev_prod_yoy":18.49,"ev_sales":30.94,"ev_sales_yoy":14.98,"total_prod":184.65,"total_prod_yoy":11.04,"total_sales":179.01,"total_sales_yoy":8.67,"bike_sales":155.41,"bike_sales_yoy":10.4,"large_sales":6.1,"large_sales_yoy":11.31,"trike_sales":23.6,"trike_sales_yoy":-1.5},"2025-12":{"gas_prod":166.72,"gas_prod_mom":9.65,"gas_prod_yoy":8.07,"gas_sales":164.71,"gas_sales_mom":11.94,"gas_sales_yoy":10.3,"ev_prod":33.91,"ev_prod_yoy":24.24,"ev_sales":30.42,"ev_sales_yoy":14.74,"total_prod":200.63,"total_prod_yoy":10.51,"total_sales":195.13,"total_sales_yoy":10.97,"bike_sales":169.36,"bike_sales_yoy":11.47,"large_sales":6.89,"large_sales_yoy":1.92,"trike_sales":25.78,"trike_sales_yoy":7.76},"2026-01":{"gas_prod":169.85,"gas_prod_mom":1.88,"gas_prod_yoy":23.24,"gas_sales":172.36,"gas_sales_mom":3.97,"gas_sales_yoy":22.95,"ev_prod":30.61,"ev_prod_yoy":43.97,"ev_sales":28.15,"ev_sales_yoy":27.99,"total_prod":200.46,"total_prod_yoy":26.01,"total_sales":200.51,"total_sales_yoy":23.63,"bike_sales":179.73,"bike_sales_yoy":24.44,"large_sales":6.38,"large_sales_yoy":8.32,"trike_sales":20.78,"trike_sales_yoy":17.05},"2026-02":{"gas_prod":108.51,"gas_prod_mom":-36.23,"gas_prod_yoy":0.65,"gas_sales":121.71,"gas_sales_mom":-29.48,"gas_sales_yoy":8.95,"ev_prod":11.09,"ev_prod_yoy":-57.48,"ev_sales":12.03,"ev_sales_yoy":-52.63,"total_prod":119.6,"total_prod_yoy":-10.67,"total_sales":133.74,"total_sales_yoy":-2.45,"bike_sales":119.94,"bike_sales_yoy":0.27,"large_sales":4.59,"large_sales_yoy":10.57,"trike_sales":13.8,"trike_sales_yoy":-21.06},"2024-11":{"gas_prod":139.52,"gas_prod_mom":4.32,"gas_prod_yoy":15.41,"gas_sales":137.79,"gas_sales_mom":4.65,"gas_sales_yoy":14.86,"ev_prod":26.75,"ev_prod_yoy":0.43,"ev_sales":26.91,"ev_sales_yoy":9.46,"total_prod":166.26,"total_prod_yoy":12.71,"total_sales":164.7,"total_sales_yoy":13.95,"bike_sales":140.74,"bike_sales_yoy":14.38,"large_sales":5.48,"large_sales_yoy":41.23,"trike_sales":23.96,"trike_sales_yoy":11.45},"2024-12":{"gas_prod":154.24,"gas_prod_mom":10.56,"gas_prod_yoy":27.21,"gas_sales":149.31,"gas_sales_mom":8.37,"gas_sales_yoy":27.87,"ev_prod":27.29,"ev_prod_yoy":-3.16,"ev_sales":26.51,"ev_sales_yoy":-1.14,"total_prod":181.54,"total_prod_yoy":21.48,"total_sales":175.82,"total_sales_yoy":22.45,"bike_sales":151.91,"bike_sales_yoy":22.47,"large_sales":6.77,"large_sales_yoy":81.99,"trike_sales":23.92,"trike_sales_yoy":22.37},"2024-09":{"gas_prod":146.07,"gas_prod_mom":2.15,"gas_prod_yoy":17.74,"gas_sales":150.53,"gas_sales_mom":7.87,"gas_sales_yoy":19.5,"ev_prod":34.21,"ev_prod_yoy":-32.82,"ev_sales":34.94,"ev_sales_yoy":-28.74,"total_prod":180.28,"total_prod_yoy":3.02,"total_sales":185.47,"total_sales_yoy":5.98,"bike_sales":162.52,"bike_sales_yoy":6.0,"large_sales":7.66,"large_sales_yoy":51.68,"trike_sales":22.95,"trike_sales_yoy":5.86},"2024-10":{"gas_prod":133.61,"gas_prod_mom":-8.53,"gas_prod_yoy":16.77,"gas_sales":131.67,"gas_sales_mom":-12.53,"gas_sales_yoy":12.24,"ev_prod":26.41,"ev_prod_yoy":-27.52,"ev_sales":25.91,"ev_sales_yoy":-25.73,"total_prod":160.02,"total_prod_yoy":6.07,"total_sales":157.58,"total_sales_yoy":3.53,"bike_sales":133.5,"bike_sales_yoy":2.82,"large_sales":6.1,"large_sales_yoy":40.88,"trike_sales":24.08,"trike_sales_yoy":7.67},"2024-07":{"gas_prod":150.47,"gas_prod_mom":1.41,"gas_prod_yoy":14.6,"gas_sales":148.56,"gas_sales_mom":-0.3,"gas_sales_yoy":14.72,"ev_prod":32.5,"ev_prod_yoy":-17.98,"ev_sales":34.54,"ev_sales_yoy":-7.12,"total_prod":182.98,"total_prod_yoy":7.05,"total_sales":183.09,"total_sales_yoy":9.85,"bike_sales":161.65,"bike_sales_yoy":9.61,"large_sales":7.26,"large_sales_yoy":34.94,"trike_sales":21.44,"trike_sales_yoy":11.7},"2024-08":{"gas_prod":142.99,"gas_prod_mom":-4.97,"gas_prod_yoy":7.22,"gas_sales":139.55,"gas_sales_mom":-6.13,"gas_sales_yoy":5.69,"ev_prod":33.96,"ev_prod_yoy":-22.55,"ev_sales":34.56,"ev_sales_yoy":-20.91,"total_prod":176.95,"total_prod_yoy":-0.15,"total_sales":174.1,"total_sales_yoy":-0.92,"bike_sales":152.19,"bike_sales_yoy":-20.51,"large_sales":6.83,"large_sales_yoy":43.19,"trike_sales":21.91,"trike_sales_yoy":11.65},"2024-06":{"gas_prod":148.37,"gas_prod_mom":1.54,"gas_prod_yoy":10.06,"gas_sales":149.0,"gas_sales_mom":2.89,"gas_sales_yoy":11.33,"ev_prod":29.76,"ev_prod_yoy":-12.23,"ev_sales":31.02,"ev_sales_yoy":-2.91,"total_prod":178.13,"total_prod_yoy":5.58,"total_sales":180.02,"total_sales_yoy":8.58,"bike_sales":160.9,"bike_sales_yoy":8.58,"large_sales":9.01,"large_sales_yoy":97.16,"trike_sales":19.12,"trike_sales_yoy":5.62},"2024-05":{"gas_prod":146.13,"gas_prod_mom":-0.23,"gas_prod_yoy":11.58,"gas_sales":144.81,"gas_sales_mom":0.54,"gas_sales_yoy":9.82,"ev_prod":30.72,"ev_prod_yoy":-22.0,"ev_sales":33.13,"ev_sales_yoy":3.98,"total_prod":176.84,"total_prod_yoy":3.82,"total_sales":177.94,"total_sales_yoy":8.68,"bike_sales":157.01,"bike_sales_yoy":8.43,"large_sales":7.72,"large_sales_yoy":57.55,"trike_sales":20.93,"trike_sales_yoy":10.58},"2024-04":{"gas_prod":146.43,"gas_prod_mom":5.57,"gas_prod_yoy":13.84,"gas_sales":143.98,"gas_sales_mom":7.6,"gas_sales_yoy":11.08,"ev_prod":29.83,"ev_prod_yoy":-31.54,"ev_sales":31.43,"ev_sales_yoy":-9.42,"total_prod":176.26,"total_prod_yoy":2.36,"total_sales":175.41,"total_sales_yoy":6.75,"bike_sales":152.97,"bike_sales_yoy":7.19,"large_sales":7.26,"large_sales_yoy":34.44,"trike_sales":22.44,"trike_sales_yoy":3.8},"2024-02":{"gas_prod":74.68,"gas_prod_mom":-42.16,"gas_prod_yoy":-26.96,"gas_sales":79.8,"gas_sales_mom":-38.5,"gas_sales_yoy":-21.26,"ev_prod":12.42,"ev_prod_yoy":-83.89,"ev_sales":12.34,"ev_sales_yoy":-83.04,"total_prod":87.1,"total_prod_yoy":-51.43,"total_sales":92.13,"total_sales_yoy":-47.08,"bike_sales":80.49,"bike_sales_yoy":-47.66,"large_sales":2.46,"large_sales_yoy":-24.07,"trike_sales":11.64,"trike_sales_yoy":-42.65},"2024-01":{"gas_prod":129.03,"gas_prod_mom":23.23,"gas_prod_yoy":66.58,"gas_sales":129.67,"gas_sales_mom":28.94,"gas_sales_yoy":56.45,"ev_prod":22.7,"ev_prod_yoy":7.92,"ev_sales":21.88,"ev_sales_yoy":-2.84,"total_prod":151.73,"total_prod_yoy":54.06,"total_sales":151.56,"total_sales_yoy":43.78,"bike_sales":132.91,"bike_sales_yoy":null,"large_sales":3.86,"large_sales_yoy":55.69,"trike_sales":18.64,"trike_sales_yoy":44.95},"2024-03":{"gas_prod":138.57,"gas_prod_mom":79.86,"gas_prod_yoy":5.34,"gas_sales":133.82,"gas_sales_mom":62.91,"gas_sales_yoy":1.73,"ev_prod":34.08,"ev_prod_yoy":-60.4,"ev_sales":33.48,"ev_sales_yoy":-53.01,"total_prod":172.65,"total_prod_yoy":-20.66,"total_sales":167.3,"total_sales_yoy":-17.5,"bike_sales":142.93,"bike_sales_yoy":-20.3,"large_sales":5.23,"large_sales_yoy":34.79,"trike_sales":24.37,"trike_sales_yoy":3.89},"2026-03":{"gas_prod":173.21,"gas_prod_mom":58.91,"gas_prod_yoy":7.81,"gas_sales":165.61,"gas_sales_mom":35.63,"gas_sales_yoy":4.96,"ev_prod":37.12,"ev_prod_yoy":-1.14,"ev_sales":37.8,"ev_sales_yoy":3.51,"total_prod":210.33,"total_prod_yoy":6.12,"total_sales":203.41,"total_sales_yoy":4.69,"bike_sales":177.1,"bike_sales_yoy":5.91,"large_sales":7.77,"large_sales_yoy":-11.8,"trike_sales":26.31,"trike_sales_yoy":-2.83},"2026-04":{"gas_prod":188.36,"gas_prod_mom":8.74,"gas_prod_yoy":7.73,"gas_sales":188.79,"gas_sales_mom":13.99,"gas_sales_yoy":10.06,"ev_prod":39.53,"ev_prod_yoy":34.1,"ev_sales":38.37,"ev_sales_yoy":35.24,"total_prod":227.89,"total_prod_yoy":11.53,"total_sales":227.16,"total_sales_yoy":13.63,"bike_sales":199.68,"bike_sales_yoy":14.31,"large_sales":10.36,"large_sales_yoy":11.4,"trike_sales":27.48,"trike_sales_yoy":8.93}},"bike_type":{"2025-01":{"cross":87.91,"scooter":39.05,"underbone":15.58},"2025-02":{"cross":69.79,"scooter":36.82,"underbone":12.95},"2025-03":{"cross":97.14,"scooter":52.02,"underbone":18.03},"2025-04":{"cross":107.45,"scooter":48.75,"underbone":18.47},"2025-05":{"cross":99.91,"scooter":46.36,"underbone":19.4},"2025-06":{"cross":98.73,"scooter":46.87,"underbone":19.9},"2025-07":{"cross":94.51,"scooter":52.36,"underbone":20.59},"2025-08":{"cross":95.88,"scooter":48.31,"underbone":18.68},"2025-09":{"cross":104.91,"scooter":49.37,"underbone":20.74},"2025-10":{"cross":89.67,"scooter":43.77,"underbone":16.63},"2025-11":{"cross":92.33,"scooter":45.04,"underbone":17.98},"2025-12":{"cross":null,"scooter":null,"underbone":null},"2026-01":{"cross":105.26,"scooter":50.39,"underbone":22.93},"2026-02":{"cross":78.49,"scooter":28.68,"underbone":12.18},"2024-12":{"cross":93.64,"scooter":41.47,"underbone":16.79},"2024-10":{"cross":80.94,"scooter":37.93,"underbone":14.61},"2024-08":{"cross":84.12,"scooter":53.67,"underbone":14.51},"2024-03":{"cross":84.24,"scooter":53.0,"underbone":12.84},"2024-01":{"cross":72.36,"scooter":45.89,"underbone":14.66},"2024-02":{"cross":45.02,"scooter":25.77,"underbone":9.78},"2024-04":{"cross":84.45,"scooter":53.31,"underbone":15.21},"2024-05":{"cross":84.93,"scooter":57.54,"underbone":14.59},"2024-06":{"cross":90.75,"scooter":56.2,"underbone":13.95},"2024-07":{"cross":92.38,"scooter":54.86,"underbone":14.41},"2024-09":{"cross":93.06,"scooter":55.37,"underbone":14.09},"2024-11":{"cross":87.53,"scooter":38.2,"underbone":14.78},"2026-03":{"cross":100.78,"scooter":55.79,"underbone":20.07}},"trike":{"2025-01":{"freight":13.84,"freight_yoy":9.84,"passenger":3.2,"passenger_yoy":-2.54},"2025-02":{"freight":12.97,"freight_yoy":28.05,"passenger":3.2,"passenger_yoy":111.78},"2025-03":{"freight":20.68,"freight_yoy":-0.8,"passenger":4.15,"passenger_yoy":18.81},"2025-04":{"freight":19.84,"freight_yoy":1.43,"passenger":3.59,"passenger_yoy":26.73},"2025-05":{"freight":18.29,"freight_yoy":-0.67,"passenger":3.25,"passenger_yoy":31.0},"2025-06":{"freight":17.32,"freight_yoy":1.83,"passenger":2.87,"passenger_yoy":37.62},"2025-07":{},"2025-08":{},"2025-09":{},"2025-10":{},"2025-11":{},"2025-12":{},"2026-01":{"freight":15.78,"freight_yoy":9.66,"passenger":4.7,"passenger_yoy":46.7},"2026-02":{"freight":12.76,"freight_yoy":null,"passenger":2.16,"passenger_yoy":null},"2024-12":{"freight":18.36,"freight_yoy":null,"passenger":5.37,"passenger_yoy":null},"2024-10":{"freight":19.25,"freight_yoy":null,"passenger":4.82,"passenger_yoy":null},"2024-08":{"freight":17.82,"freight_yoy":null,"passenger":4.07,"passenger_yoy":null},"2024-03":{"freight":18.59,"freight_yoy":null,"passenger":5.77,"passenger_yoy":null},"2024-01":{"freight":14.23,"freight_yoy":24.73,"passenger":4.4,"passenger_yoy":203.15},"2024-02":{"freight":10.13,"freight_yoy":null,"passenger":1.5,"passenger_yoy":null},"2024-04":{"freight":18.15,"freight_yoy":null,"passenger":4.24,"passenger_yoy":null},"2024-05":{"freight":16.99,"freight_yoy":null,"passenger":3.91,"passenger_yoy":null},"2024-06":{"freight":23.23,"freight_yoy":null,"passenger":-4.13,"passenger_yoy":null,"note":"客運累計が前月比減（15.69 < 19.82）→ 原文ママ、遡及修正の可能性あり"},"2024-07":{"freight":17.04,"freight_yoy":null,"passenger":4.38,"passenger_yoy":null},"2024-09":{"freight":18.79,"freight_yoy":null,"passenger":4.15,"passenger_yoy":null},"2024-11":{"freight":18.46,"freight_yoy":null,"passenger":4.69,"passenger_yoy":null}},"export":{"2025-01":{"total":104.04,"total_mom":-1.25,"total_yoy":13.56,"amount":6.59,"amount_mom":-5.79,"amount_yoy":11.13},"2025-02":{"total":75.98,"total_mom":-27.42,"total_yoy":41.39,"amount":5.14},"2025-03":{"total":109.78,"total_mom":42.44,"total_yoy":30.3,"amount":11.68,"amount_note":"関税前駆け込みで大排量集中、単価1064$/台（他月比+57%）。MoM+125.42%と整合"},"2025-04":{"total":120.09,"total_mom":9.39,"total_yoy":30.15,"amount":3.36,"amount_note":"4月号に累計値誤混入のため逆算（1-5月34.61億-5月7.71億-1-3月23.54億）"},"2025-05":{"total":115.21,"total_mom":-4.07,"total_yoy":22.15,"amount":7.71},"2025-06":{"total":118.07,"total_mom":2.49,"total_yoy":19.18,"amount":8.12},"2025-07":{"total":114.71,"total_mom":-3.14,"total_yoy":13.08,"amount":7.67},"2025-08":{"total":112.42,"total_mom":-1.99,"total_yoy":20.69,"amount":7.59},"2025-09":{"total":122.67,"total_mom":9.14,"total_yoy":20.16,"amount":8.0},"2025-10":{"total":105.1,"total_mom":-14.32,"total_yoy":17.66,"amount":6.82},"2025-11":{"total":106.37,"total_mom":1.21,"total_yoy":11.74,"amount":7.15},"2025-12":{"total":123.81,"total_mom":12.34,"total_yoy":17.52,"amount":8.19},"2026-01":{"total":132.3,"total_mom":6.86,"total_yoy":24.94,"amount":8.76,"amount_mom":6.89,"amount_yoy":31.28},"2026-02":{"total":96.31,"total_mom":-27.33,"total_yoy":24.96,"amount":6.7,"amount_mom":-22.37,"amount_yoy":29.21},"2024-11":{"total":95.19,"total_mom":6.57,"total_yoy":20.47,"amount":6.04,"amount_mom":9.1,"amount_yoy":25.73},"2024-12":{"total":105.35,"total_mom":10.67,"total_yoy":32.61,"amount":7.0,"amount_mom":15.81,"amount_yoy":41.9},"2024-10":{"total":88.67,"total_yoy":null,"amount":5.57},"2024-07":{"total":101.11,"total_mom":2.07,"total_yoy":28.45,"amount":6.05,"amount_mom":-3.92,"amount_yoy":16.72},"2024-08":{"total":93.14,"total_mom":-8.17,"total_yoy":15.16,"amount":5.78,"amount_mom":-4.7,"amount_yoy":15.74},"2024-06":{"total":99.06,"total_mom":5.03,"total_yoy":19.41,"amount":6.3,"amount_mom":1.74,"amount_yoy":14.02},"2024-05":{"total":94.32,"total_mom":2.22,"total_yoy":20.44,"amount":6.2,"amount_mom":6.71,"amount_yoy":14.74},"2024-04":{"total":92.27,"total_mom":9.52,"total_yoy":25.36,"amount":5.8,"amount_mom":8.46,"amount_yoy":17.07},"2024-02":{"total":51.52,"total_mom":-40.91,"total_yoy":5.02,"amount":3.43,"amount_mom":-40.37,"amount_yoy":-2.15},"2024-01":{"total":87.11,"total_mom":16.13,"total_yoy":95.3,"amount":5.76,"amount_mom":21.01,"amount_yoy":80.89},"2024-03":{"total":84.1,"total_mom":56.51,"total_yoy":18.06,"amount":5.34,"amount_mom":51.8,"amount_yoy":11.41},"2024-09":{"total":101.84,"amount":6.25,"note":"9月号に月次記載なし、1-9月(811.5) - 1-8月(709.66)累計差し引き"},"2026-03":{"total":118.33,"total_mom":22.6,"total_yoy":7.79,"amount":7.91,"amount_mom":17.96,"amount_yoy":8.69}},"export_cc":{"2025-01":{"125cc":31.72,"150cc":30.93,"110cc":12.42,"200cc":10.24,"50cc":4.32,"250cc":3.35},"2025-02":{"125cc":25.53,"150cc":19.34,"110cc":8.66,"200cc":8.08,"50cc":2.7,"250cc":2.53},"2025-03":{"125cc":35.06,"150cc":32.58,"110cc":12.58,"200cc":10.31,"50cc":4.72,"250cc":3.14},"2025-04":{},"2025-05":{"125cc":38.87,"150cc":30.33,"110cc":14.75,"200cc":11.27,"50cc":3.23,"250cc":2.87},"2025-06":{"6月は通常通り125/150/110/200/50/250ccの6（7・8月と異なり400ccなし）":null,"125cc":38.05,"150cc":31.39,"110cc":13.21,"200cc":11.46,"50cc":4.23,"250cc":3.24},"2025-07":{"▶ 2-1b. 月次（7月）排気量別輸出　※上位6に400ccが入り250ccは圏外":null,"★7月も上位6に400ccが入り、250ccは圏外（累計では250ccが6位）":null,"125cc":38.73,"150cc":30.52,"110cc":15.84,"200cc":10.07,"50cc":3.47,"400cc":2.84},"2025-08":{"★8月のみ上位6に400ccが入り、50ccは圏外（累計では50ccが6位）":null,"125cc":37.94,"150cc":29.84,"110cc":15.47,"200cc":12.26,"250cc":3.6,"400cc":2.96},"2025-09":{"125cc":39.77,"150cc":36.14,"110cc":15.81,"200cc":13.68,"50cc":1.88,"250cc":2.89},"2025-10":{},"2025-11":{},"2025-12":{},"2026-01":{"125cc":44.54,"150cc":33.9,"110cc":21.79,"200cc":10.68,"250cc":4.52,"50cc":3.35},"2026-02":{"125cc":31.69,"150cc":23.04,"110cc":14.51,"200cc":10.32,"250cc":3.5,"50cc":1.8},"2024-12":{"150cc":30.04,"125cc":31.5,"110cc":13.07,"200cc":11.17,"50cc":2.61,"250cc":3.35},"2024-10":{"150cc":27.53,"125cc":25.25,"110cc":10.97,"200cc":8.86,"50cc":2.2,"250cc":3.0},"2024-08":{"150cc":27.11,"125cc":28.78,"110cc":11.83,"200cc":8.82,"50cc":3.76,"250cc":3.28},"2024-06":{"150cc":32.6,"125cc":28.91,"110cc":10.65,"200cc":8.54,"50cc":5.02,"250cc":3.84},"2024-05":{"150cc":28.03,"125cc":29.7,"110cc":10.95,"200cc":9.37,"50cc":3.91,"250cc":3.25},"2024-03":{"125cc":26.8,"150cc":33.45,"110cc":9.55,"200cc":6.86,"50cc":2.63,"250cc":3.05},"2024-04":{"150cc":27.21,"125cc":30.05,"110cc":11.26,"200cc":8.94,"50cc":3.4,"250cc":3.41},"2024-01":{"125cc":26.99,"150cc":26.85,"110cc":10.13,"200cc":7.42,"50cc":4.67,"250cc":2.67},"2024-02":{"125cc":16.33,"150cc":14.8,"110cc":6.52,"200cc":3.68,"50cc":2.25,"250cc":2.25},"2024-07":{"150cc":33.92,"125cc":28.88,"110cc":10.42,"200cc":10.22,"50cc":4.16,"250cc":3.75},"2024-09":{"150cc":34.47,"125cc":30.17,"110cc":11.58,"200cc":9.51,"50cc":3.09,"250cc":2.9},"2024-11":{"150cc":27.15,"125cc":29.34,"110cc":12.13,"200cc":11.66,"50cc":2.41,"250cc":3.42},"2026-03":{"125cc":39.37,"150cc":30.74,"110cc":17.54,"200cc":9.84,"50cc":2.52,"250cc":4.18},"2026-04":{"125cc":42.46,"150cc":36.42,"110cc":20.59,"200cc":12.68,"250cc":4.8,"50cc":4.32}},"econ_cumul":{"2024-12":{"工業総産値":1324.91,"工業販売産値":1334.87,"工業増加値":246.0,"営業収入":1430.71,"利益総額":92.31,"利税総額":121.68,"営業コスト":1216.4,"税金及付加":16.2,"販売費用":33.94,"管理費用":54.97,"研究開発費用":46.73,"財務費用":-7.2,"四費用合計":128.44,"note":"2024年通年（1-12月）"},"2025-02":{"工業総産値":191.73,"工業販売産値":195.63,"工業増加値":40.71,"営業収入":211.76,"利益総額":10.08,"利税総額":18.49,"営業コスト":181.56,"税金及付加":2.57,"販売費用":5.14,"管理費用":8.16,"研究開発費用":6.71,"財務費用":0.15,"四費用合計":20.16},"2025-04":{"工業総産値":457.43,"工業販売産値":462.44,"工業増加値":95.06,"営業収入":495.57,"利益総額":30.74,"利税総額":45.1,"営業コスト":421.32,"税金及付加":6.54,"販売費用":11.58,"管理費用":17.3,"研究開発費用":14.37,"財務費用":-2.02,"四費用合計":41.24},"2025-05":{"工業総産値":583.53,"工業販売産値":591.24,"工業増加値":121.31,"営業収入":635.54,"利益総額":49.24,"利税総額":66.85,"営業コスト":537.89,"税金及付加":8.25,"販売費用":14.76,"管理費用":21.91,"研究開発費用":17.85,"財務費用":-1.39,"四費用合計":53.12},"2025-06":{"工業総産値":719.86,"工業販売産値":727.63,"工業増加値":148.92,"営業収入":777.43,"利益総額":59.17,"利税総額":79.56,"営業コスト":655.0,"税金及付加":10.05,"販売費用":18.85,"管理費用":27.91,"研究開発費用":22.18,"財務費用":-1.43,"四費用合計":67.51},"2025-07":{"工業総産値":854.73,"工業販売産値":867.49,"工業増加値":180.06,"営業収入":931.37,"利益総額":72.02,"利税総額":95.48,"営業コスト":783.65,"税金及付加":11.68,"販売費用":22.45,"管理費用":33.07,"研究開発費用":26.32,"財務費用":-1.11,"四費用合計":80.72},"2025-08":{"工業総産値":986.59,"工業販売産値":994.34,"工業増加値":195.12,"営業収入":1070.55,"利益総額":81.94,"利税総額":107.67,"営業コスト":899.08,"税金及付加":13.18,"販売費用":25.82,"管理費用":37.89,"研究開発費用":30.78,"財務費用":0.0831,"四費用合計":94.58},"2025-09":{"工業総産値":1121.03,"工業販売産値":1125.69,"工業増加値":220.38,"営業収入":1205.53,"利益総額":89.73,"利税総額":118.41,"営業コスト":1012.06,"税金及付加":14.75,"販売費用":29.37,"管理費用":44.08,"研究開発費用":35.3,"財務費用":-1.08,"四費用合計":107.68},"2025-10":{"工業総産値":1236.85,"工業販売産値":1240.91,"工業増加値":244.83,"営業収入":1330.97,"利益総額":97.18,"利税総額":129.13,"営業コスト":1119.27,"税金及付加":16.28,"販売費用":32.25,"管理費用":48.69,"研究開発費用":39.35,"財務費用":-0.81,"四費用合計":119.49},"2025-11":{"工業総産値":1361.29,"工業販売産値":1366.66,"工業増加値":265.17,"営業収入":1462.09,"利益総額":114.18,"利税総額":148.12,"営業コスト":1230.84,"税金及付加":17.39,"販売費用":35.49,"管理費用":52.29,"研究開発費用":43.42,"財務費用":-0.73,"四費用合計":130.46},"2025-03":{"工業総産値":322.34,"工業販売産値":327.03,"工業増加値":61.75,"営業収入":347.6,"利益総額":19.63,"利税総額":30.2,"営業コスト":295.91,"税金及付加":4.17,"販売費用":8.48,"管理費用":12.95,"研究開発費用":10.56,"財務費用":-0.86,"四費用合計":31.14},"2025-12":{"工業総産値":1489.75,"工業販売産値":1493.21,"工業増加値":288.63,"営業収入":1590.3,"利益総額":122.97,"利税総額":159.46,"営業コスト":1344.01,"税金及付加":18.59,"販売費用":36.43,"管理費用":60.75,"研究開発費用":51.08,"財務費用":-0.21,"四費用合計":148.05},"2024-10":{"工業総産値":1094.25,"工業販売産値":1094.52,"工業増加値":203.81,"営業収入":1185.43,"利益総額":71.96,"利税総額":97.21,"営業コスト":1009.28,"税金及付加":13.79,"販売費用":28.89,"管理費用":44.23,"研究開発費用":36.65,"財務費用":-3.65,"四費用合計":106.13,"note":"2024年1-10月累計"},"2024-11":{"工業総産値":1205.76,"工業販売産値":1207.06,"工業増加値":223.29,"営業収入":1294.08,"利益総額":82.61,"利税総額":109.37,"営業コスト":1100.51,"税金及付加":14.96,"販売費用":31.36,"管理費用":48.52,"研究開発費用":40.43,"財務費用":-5.96,"四費用合計":114.36,"note":"2024年1-11月累計"},"2024-08":{"工業総産値":868.44,"工業販売産値":867.8,"工業増加値":163.99,"営業収入":925.84,"利益総額":59.97,"利税総額":80.59,"営業コスト":784.4,"税金及付加":10.8,"販売費用":23.0,"管理費用":35.35,"研究開発費用":28.22,"財務費用":-3.65,"四費用合計":82.92,"note":"2024年1-8月累計"},"2024-09":{"工業総産値":988.76,"工業販売産値":984.76,"工業増加値":180.64,"営業収入":1050.93,"利益総額":63.59,"利税総額":86.49,"営業コスト":892.21,"税金及付加":12.25,"販売費用":25.94,"管理費用":39.9,"研究開発費用":32.33,"財務費用":-2.06,"四費用合計":96.12,"note":"2024年1-9月累計"},"2024-06":{"工業総産値":633.17,"工業販売産値":629.42,"工業増加値":122.58,"営業収入":674.5,"利益総額":46.36,"利税総額":61.89,"営業コスト":570.91,"税金及付加":7.91,"販売費用":17.68,"管理費用":25.35,"研究開発費用":20.05,"財務費用":-3.36,"四費用合計":59.72,"note":"2024年1-6月累計"},"2024-07":{"工業総産値":802.83,"工業販売産値":797.98,"工業増加値":144.32,"営業収入":800.7,"利益総額":53.25,"利税総額":71.25,"営業コスト":687.78,"税金及付加":9.44,"販売費用":20.81,"管理費用":30.32,"研究開発費用":24.31,"財務費用":-4.0,"四費用合計":71.44,"note":"2024年1-7月累計"},"2024-05":{"工業総産値":502.59,"工業販売産値":506.11,"工業増加値":93.61,"営業収入":540.62,"利益総額":33.5,"利税総額":45.98,"営業コスト":459.64,"税金及付加":6.12,"販売費用":14.86,"管理費用":20.54,"研究開発費用":16.77,"財務費用":-1.5,"四費用合計":50.67,"note":"2024年1-5月累計"},"2024-04":{"工業総産値":382.62,"工業販売産値":385.3,"工業増加値":73.01,"営業収入":409.3,"利益総額":24.9,"利税総額":36.05,"営業コスト":347.65,"税金及付加":5.06,"販売費用":10.9,"管理費用":16.66,"研究開発費用":12.74,"財務費用":-1.93,"四費用合計":38.37,"note":"2024年1-4月累計"},"2024-03":{"工業総産値":272.66,"工業販売産値":274.3,"工業増加値":55.9,"営業収入":287.92,"利益総額":13.86,"利税総額":20.79,"営業コスト":245.01,"税金及付加":3.03,"販売費用":7.83,"管理費用":12.83,"研究開発費用":9.05,"財務費用":-1.27,"四費用合計":28.44,"note":"2024年1-3月累計"},"2024-02":{"工業総産値":161.18,"工業販売産値":164.72,"工業増加値":35.26,"営業収入":175.01,"利益総額":7.46,"利税総額":12.12,"営業コスト":150.86,"税金及付加":1.61,"販売費用":4.61,"管理費用":7.49,"研究開発費用":5.68,"財務費用":-0.1496,"四費用合計":17.62,"note":"2024年1-2月累計"},"2023-12":{"工業総産値":1197.6,"工業販売産値":1204.65,"工業増加値":222.89,"営業収入":1283.72,"利益総額":80.28,"利税総額":107.82,"営業コスト":1086.26,"税金及付加":13.67,"販売費用":31.7,"管理費用":54.91,"研究開発費用":43.7,"財務費用":-2.58,"四費用合計":127.73,"note":"2023年通年（1-12月）"},"2026-02":{"工業総産値":214.69,"工業販売産値":219.99,"工業増加値":43.27,"営業収入":232.55,"利益総額":9.53,"利税総額":15.54,"営業コスト":198.31,"税金及付加":2.04,"販売費用":5.25,"管理費用":9.08,"研究開発費用":6.6,"財務費用":3.75,"四費用合計":24.68,"note":"2026年1-2月累計"},"2026-03":{"工業総産値":359.28,"工業販売産値":358.09,"工業増加値":69.89,"営業収入":379.41,"利益総額":16.02,"利税総額":20.16,"営業コスト":383.1,"税金及付加":4.0,"販売費用":9.33,"管理費用":14.09,"研究開発費用":10.29,"財務費用":3.38,"四費用合計":37.09,"note":"2026年1-3月累計"}},"econ_monthly":{"2025-02":{"label":"2025-02","note":"1〜2月累計","工業総産値":191.73,"工業販売産値":195.63,"工業増加値":40.71,"営業収入":211.76,"利益総額":10.08,"利税総額":18.49,"営業コスト":181.56,"税金及付加":2.57,"販売費用":5.14,"管理費用":8.16,"研究開発費用":6.71,"財務費用":0.15,"四費用合計":20.16,"利益率%":4.76},"2025-03":{"label":"2025-03","note":"1〜3月合計","工業総産値":322.34,"工業販売産値":327.03,"工業増加値":61.75,"営業収入":347.6,"利益総額":19.63,"利税総額":30.2,"営業コスト":295.91,"税金及付加":4.17,"販売費用":8.48,"管理費用":12.95,"研究開発費用":10.56,"財務費用":-0.86,"四費用合計":31.14,"利益率%":5.65},"2025-04":{"label":"2025-04","note":"単月逆算","工業総産値":135.09,"工業販売産値":135.41,"工業増加値":33.31,"営業収入":147.97,"利益総額":11.11,"利税総額":14.9,"営業コスト":125.41,"税金及付加":2.37,"販売費用":3.1,"管理費用":4.35,"研究開発費用":3.81,"財務費用":-1.16,"四費用合計":10.1,"利益率%":7.51},"2025-05":{"label":"2025-05","note":"単月逆算","工業総産値":126.1,"工業販売産値":128.8,"工業増加値":26.25,"営業収入":139.97,"利益総額":18.5,"利税総額":21.75,"営業コスト":116.57,"税金及付加":1.71,"販売費用":3.18,"管理費用":4.61,"研究開発費用":3.48,"財務費用":0.63,"四費用合計":11.88,"利益率%":13.22},"2025-06":{"label":"2025-06","note":"単月逆算","工業総産値":136.33,"工業販売産値":136.39,"工業増加値":27.61,"営業収入":141.89,"利益総額":9.93,"利税総額":12.71,"営業コスト":117.11,"税金及付加":1.8,"販売費用":4.09,"管理費用":6.0,"研究開発費用":4.33,"財務費用":-0.04,"四費用合計":14.39,"利益率%":7.0},"2025-07":{"label":"2025-07","note":"単月逆算","工業総産値":134.87,"工業販売産値":139.86,"工業増加値":31.14,"営業収入":153.94,"利益総額":12.85,"利税総額":15.92,"営業コスト":128.65,"税金及付加":1.63,"販売費用":3.6,"管理費用":5.16,"研究開発費用":4.14,"財務費用":0.32,"四費用合計":13.21,"利益率%":8.35},"2025-08":{"label":"2025-08","note":"単月逆算","工業総産値":131.86,"工業販売産値":126.85,"工業増加値":15.06,"営業収入":139.18,"利益総額":9.92,"利税総額":12.19,"営業コスト":115.43,"税金及付加":1.5,"販売費用":3.37,"管理費用":4.82,"研究開発費用":4.46,"財務費用":1.19,"四費用合計":13.86,"利益率%":7.13},"2025-09":{"label":"2025-09","note":"単月逆算","工業総産値":134.44,"工業販売産値":131.35,"工業増加値":25.26,"営業収入":134.98,"利益総額":7.79,"利税総額":10.74,"営業コスト":112.98,"税金及付加":1.57,"販売費用":3.55,"管理費用":6.19,"研究開発費用":4.52,"財務費用":-1.16,"四費用合計":13.1,"利益率%":5.77},"2025-10":{"label":"2025-10","note":"単月逆算","工業総産値":115.82,"工業販売産値":115.22,"工業増加値":24.45,"営業収入":125.44,"利益総額":7.45,"利税総額":10.72,"営業コスト":107.21,"税金及付加":1.53,"販売費用":2.88,"管理費用":4.61,"研究開発費用":4.05,"財務費用":0.27,"四費用合計":11.81,"利益率%":5.94},"2025-11":{"label":"2025-11","note":"単月逆算","工業総産値":124.44,"工業販売産値":125.75,"工業増加値":20.34,"営業収入":131.12,"利益総額":17.0,"利税総額":18.99,"営業コスト":111.57,"税金及付加":1.11,"販売費用":3.24,"管理費用":3.6,"研究開発費用":4.07,"財務費用":0.08,"四費用合計":10.97,"利益率%":12.97},"2025-12":{"工業総産値":128.46,"工業販売産値":126.55,"工業増加値":23.46,"営業収入":128.21,"利益総額":8.79,"利税総額":11.34,"営業コスト":113.17,"税金及付加":1.2,"販売費用":0.94,"管理費用":8.46,"研究開発費用":7.66,"財務費用":0.52,"四費用合計":17.59,"label":"2025-12","note":"単月逆算（1-12月 - 1-11月）","利益率%":6.86},"2024-03":{"工業総産値":111.48,"工業販売産値":109.58,"工業増加値":20.64,"営業収入":112.91,"利益総額":6.4,"利税総額":8.67,"営業コスト":94.15,"税金及付加":1.42,"販売費用":3.22,"管理費用":5.34,"研究開発費用":3.37,"財務費用":-1.12,"四費用合計":10.82,"label":"2024-03","note":"単月逆算（2024-03 - 2024-02）","利益率%":5.67},"2024-04":{"工業総産値":109.96,"工業販売産値":111.0,"工業増加値":17.11,"営業収入":121.38,"利益総額":11.04,"利税総額":15.26,"営業コスト":102.64,"税金及付加":2.03,"販売費用":3.07,"管理費用":3.83,"研究開発費用":3.69,"財務費用":-0.66,"四費用合計":9.93,"label":"2024-04","note":"単月逆算（2024-04 - 2024-03）","利益率%":9.1},"2024-05":{"工業総産値":119.97,"工業販売産値":120.81,"工業増加値":20.6,"営業収入":131.32,"利益総額":8.6,"利税総額":9.93,"営業コスト":111.99,"税金及付加":1.06,"販売費用":3.96,"管理費用":3.88,"研究開発費用":4.03,"財務費用":0.43,"四費用合計":12.3,"label":"2024-05","note":"単月逆算（2024-05 - 2024-04）","利益率%":6.55},"2024-06":{"工業総産値":130.58,"工業販売産値":123.31,"工業増加値":28.97,"営業収入":133.88,"利益総額":12.86,"利税総額":15.91,"営業コスト":111.27,"税金及付加":1.79,"販売費用":2.82,"管理費用":4.81,"研究開発費用":3.28,"財務費用":-1.86,"四費用合計":9.05,"label":"2024-06","note":"単月逆算（2024-06 - 2024-05）","利益率%":9.61},"2024-07":{"工業総産値":169.66,"工業販売産値":168.56,"工業増加値":21.74,"営業収入":126.2,"利益総額":6.89,"利税総額":9.36,"営業コスト":116.87,"税金及付加":1.53,"販売費用":3.13,"管理費用":4.97,"研究開発費用":4.26,"財務費用":-0.64,"四費用合計":11.72,"label":"2024-07","note":"単月逆算（2024-07 - 2024-06）","利益率%":5.46},"2024-08":{"工業総産値":65.61,"工業販売産値":69.82,"工業増加値":19.67,"営業収入":125.14,"利益総額":6.72,"利税総額":9.34,"営業コスト":96.62,"税金及付加":1.36,"販売費用":2.19,"管理費用":5.03,"研究開発費用":3.91,"財務費用":0.35,"四費用合計":11.48,"label":"2024-08","note":"単月逆算（2024-08 - 2024-07）","利益率%":5.37},"2024-09":{"工業総産値":120.32,"工業販売産値":116.96,"工業増加値":16.65,"営業収入":125.09,"利益総額":3.62,"利税総額":5.9,"営業コスト":107.81,"税金及付加":1.45,"販売費用":2.94,"管理費用":4.55,"研究開発費用":4.11,"財務費用":1.59,"四費用合計":13.2,"label":"2024-09","note":"単月逆算（2024-09 - 2024-08）","利益率%":2.89},"2024-10":{"工業総産値":105.49,"工業販売産値":109.76,"工業増加値":23.17,"営業収入":134.5,"利益総額":8.37,"利税総額":10.72,"営業コスト":117.07,"税金及付加":1.54,"販売費用":2.95,"管理費用":4.33,"研究開発費用":4.32,"財務費用":-1.59,"四費用合計":10.01,"label":"2024-10","note":"単月逆算（2024-10 - 2024-09）","利益率%":6.22},"2024-11":{"工業総産値":111.51,"工業販売産値":112.54,"工業増加値":19.48,"営業収入":108.65,"利益総額":10.65,"利税総額":12.16,"営業コスト":91.23,"税金及付加":1.17,"販売費用":2.47,"管理費用":4.29,"研究開発費用":3.78,"財務費用":-2.31,"四費用合計":8.23,"label":"2024-11","note":"単月逆算（2024-11 - 2024-10）","利益率%":9.8},"2024-12":{"工業総産値":119.15,"工業販売産値":127.81,"工業増加値":22.71,"営業収入":136.63,"利益総額":9.7,"利税総額":12.31,"営業コスト":115.89,"税金及付加":1.24,"販売費用":2.58,"管理費用":6.45,"研究開発費用":6.3,"財務費用":-1.24,"四費用合計":14.08,"label":"2024-12","note":"単月逆算（2024-12 - 2024-11）","利益率%":7.1},"2024-02":{"工業総産値":161.18,"工業販売産値":164.72,"工業増加値":35.26,"営業収入":175.01,"利益総額":7.46,"利税総額":12.12,"営業コスト":150.86,"税金及付加":1.61,"販売費用":4.61,"管理費用":7.49,"研究開発費用":5.68,"財務費用":-0.1496,"四費用合計":17.62,"label":"2024-02","note":"1-2月累計（1月単独値不明）","利益率%":4.26},"2026-02":{"label":"2026-02","note":"1-2月累計（1月単独値不明）","工業総産値":214.69,"工業販売産値":219.99,"工業増加値":43.27,"営業収入":232.55,"利益総額":9.53,"利税総額":15.54,"営業コスト":198.31,"税金及付加":2.04,"販売費用":5.25,"管理費用":9.08,"研究開発費用":6.6,"財務費用":3.75,"四費用合計":24.68,"利益率%":4.1},"2026-03":{"工業総産値":144.59,"工業販売産値":138.1,"工業増加値":26.62,"営業収入":146.86,"利益総額":6.49,"利税総額":4.62,"営業コスト":184.79,"税金及付加":1.96,"販売費用":4.08,"管理費用":5.01,"研究開発費用":3.69,"財務費用":-0.37,"四費用合計":12.41,"label":"2026-03","note":"単月逆算（1-3月 - 1-2月）","利益率%":4.42}},"fuel_makers_cumul":{"2025-01":{"大長江集団":16.21,"隆鑫通用動力":15.67,"廣東大冶摩托車":8.78,"宗申産業集団":8.35,"重慶銀翔実業":6.1,"廣州豪進摩托車":5.87,"江門市珠峰":5.25,"新大洲本田":4.42,"洛陽北方易初":3.85,"力帆科技":3.84},"2025-02":{"大長江集団":32.09,"隆鑫通用動力":26.66,"宗申産業集団":15.39,"廣東大冶摩托車":14.18,"重慶銀翔実業":11.4,"新大洲本田":9.74,"廣州豪進摩托車":9.0,"洛陽北方易初":7.96,"江門市珠峰":7.92,"五羊-本田":7.9},"2025-03":{"大長江集団":52.16,"隆鑫通用動力":43.5,"宗申産業集団":24.94,"廣東大冶摩托車":24.64,"重慶銀翔実業":17.39,"新大洲本田":17.33,"廣州豪進摩托車":15.69,"洛陽北方易初":13.92,"江門市珠峰":13.37,"五羊-本田":12.56},"2025-04":{"大長江集団":74.96,"隆鑫通用動力":60.05,"宗申産業集団":35.74,"廣東大冶摩托車":34.35,"新大洲本田":25.91,"重慶銀翔実業":22.38,"廣州豪進摩托車":21.98,"洛陽北方易初":20.46,"江門市珠峰":20.06,"五羊-本田":17.34},"2025-05":{"大長江集団":99.69,"隆鑫通用動力":74.0,"宗申産業集団":46.32,"廣東大冶摩托車":41.01,"新大洲本田":34.85,"重慶銀翔実業":29.04,"廣州豪進摩托車":27.99,"洛陽北方易初":25.99,"江門市珠峰":24.5,"五羊-本田":22.25},"2025-06":{"大長江集団":121.34,"隆鑫通用動力":88.16,"宗申産業集団":56.48,"廣東大冶摩托車":50.2,"新大洲本田":45.01,"重慶銀翔実業":35.31,"廣州豪進摩托車":33.16,"洛陽北方易初":31.74,"江門市珠峰":28.71,"五羊-本田":27.28},"2025-07":{"大長江集団":145.94,"隆鑫通用動力":98.53,"宗申産業集団":64.81,"廣東大冶摩托車":60.42,"新大洲本田":56.43,"重慶銀翔実業":40.65,"廣州豪進摩托車":39.19,"洛陽北方易初":36.97,"江門市珠峰":33.9,"五羊-本田":32.9},"2025-08":{"大長江集団":172.24,"隆鑫通用動力":110.32,"宗申産業集団":75.68,"廣東大冶摩托車":70.47,"新大洲本田":65.77,"重慶銀翔実業":45.97,"廣州豪進摩托車":45.26,"洛陽北方易初":42.39,"五羊-本田":38.37,"江門市珠峰":37.48},"2025-09":{"大長江集団":198.15,"隆鑫通用動力":122.86,"宗申産業集団":85.47,"廣東大冶摩托車":81.46,"新大洲本田":76.08,"廣州豪進摩托車":53.63,"重慶銀翔実業":51.89,"洛陽北方易初":47.36,"五羊-本田":42.94,"江門市珠峰":41.0},"2025-10":{"大長江集団":221.63,"隆鑫通用動力":133.75,"宗申産業集団":94.58,"廣東大冶摩托車":89.96,"新大洲本田":83.36,"廣州豪進摩托車":61.36,"重慶銀翔実業":57.48,"洛陽北方易初":52.06,"五羊-本田":47.89,"江門市珠峰":44.74},"2025-11":{"大長江集団":244.56,"隆鑫通用動力":143.99,"宗申産業集団":103.87,"廣東大冶摩托車":99.65,"新大洲本田":91.02,"廣州豪進摩托車":67.22,"重慶銀翔実業":64.49,"洛陽北方易初":56.49,"五羊-本田":52.98,"江門市珠峰":48.41},"2025-12":{"大長江集団":268.67,"隆鑫通用動力":157.83,"宗申産業集団":113.92,"廣東大冶摩托車":110.91,"新大洲本田":100.31,"廣州豪進摩托車":73.66,"重慶銀翔実業":72.91,"洛陽北方易初":61.02,"五羊-本田":59.48,"江門市珠峰":52.91},"2026-01":{"大長江集団":29.44,"廣東大冶摩托車":10.77,"重慶銀翔実業":10.58,"隆鑫通用動力":10.41,"宗申産業集団":9.94,"新大洲本田":8.04,"廣州豪進摩托車":5.65,"江門市珠峰":5.64,"洛陽北方易初":5.04,"廣州天馬摩托車":4.36},"2026-02":{"大長江集団":45.37,"隆鑫通用動力":20.81,"重慶銀翔実業":20.79,"廣東大冶摩托車":20.36,"宗申産業集団":18.64,"新大洲本田":15.38,"廣州豪進摩托車":11.05,"洛陽北方易初":8.47,"五羊-本田":8.08,"江門市珠峰":7.3},"2024-04":{"大長江集団":59.44,"隆鑫通用動力":47.54,"宗申産業集団":30.35,"重慶銀翔実業":23.57,"廣東大冶摩托車":22.36,"新大洲本田":20.8,"洛陽北方易初":20.26,"廣州豪進摩托車":19.65,"五羊-本田":17.46,"江門市珠峰":15.5},"2024-02":{"大長江集団":25.47,"隆鑫通用動力":19.94,"宗申産業集団":13.02,"重慶銀翔実業":10.71,"廣東大冶摩托車":9.73,"五羊-本田":8.67,"新大洲本田":8.54,"洛陽北方易初":8.36,"廣州豪進摩托車":7.49,"軽騎鈴木":6.88},"2024-03":{"大長江集団":42.6,"隆鑫通用動力":33.22,"宗申産業集団":21.08,"重慶銀翔実業":17.56,"廣東大冶摩托車":15.21,"新大洲本田":14.9,"洛陽北方易初":14.18,"五羊-本田":13.35,"廣州豪進摩托車":12.73,"廣州大運摩托車":11.01},"2024-01":{"大長江集団":15.94,"隆鑫通用動力":13.0,"宗申産業集団":8.09,"廣東大冶摩托車":7.23,"重慶銀翔実業":5.74,"洛陽北方易初":5.0,"新大洲本田":4.65,"五羊-本田":4.643,"廣州豪進摩托車":3.95},"2024-05":{"_total":357.69,"_share":"55.94%","_note":"個別値記載なし（合計のみ）"},"2024-06":{"_total":438.17,"_share":"55.58%","_note":"個別値記載なし（合計のみ）"},"2024-07":{"_total":523.43,"_share":"55.87%","_note":"個別値記載なし（合計のみ）"},"2024-08":{"_total":599.2,"_share":"55.66%","_note":"個別値記載なし（合計のみ）"},"2024-09":{"_total":684.27,"_share":"55.76%","_note":"個別値記載なし（合計のみ）"},"2024-10":{"_total":759.09,"_share":"55.93%","_note":"個別値記載なし（合計のみ）"},"2024-11":{"_total":838.7,"_share":"56.05%","_note":"個別値記載なし（合計のみ）"},"2024-12":{"_total":922.63,"_share":"56.07%","_note":"個別値記載なし（合計のみ）"},"2026-03":{"大長江集団":71.59,"隆鑫通用動力":34.07,"重慶銀翔実業":32.3,"廣東大冶摩托車":30.85,"宗申産業集団":29.8,"新大洲本田":23.09,"廣州豪進摩托車":18.35,"洛陽北方易初":14.67,"五羊-本田":13.33,"重慶千里科技":11.05},"2026-04":{"大長江集団":99.31,"隆鑫通用動力":46.36,"廣東大冶摩托車":44.32,"重慶銀翔実業":43.77,"宗申産業集団":42.22,"新大洲本田":33.09,"廣州豪進摩托車":25.56,"洛陽北方易初":22.11,"五羊-本田":19.89,"江門市珠峰":16.76}},"fuel_makers_monthly":{"2025-01":{"大長江集団":16.21,"隆鑫通用動力":15.67,"廣東大冶摩托車":8.78,"宗申産業集団":8.35,"重慶銀翔実業":6.1,"廣州豪進摩托車":5.87,"江門市珠峰":5.25,"新大洲本田":4.42,"洛陽北方易初":3.85,"力帆科技":3.84},"2025-02":{"大長江集団":15.88,"隆鑫通用動力":10.99,"宗申産業集団":7.04,"廣東大冶摩托車":5.4,"重慶銀翔実業":5.3,"新大洲本田":5.32,"廣州豪進摩托車":3.13,"洛陽北方易初":4.11,"江門市珠峰":2.67,"五羊-本田":7.9},"2025-03":{"大長江集団":20.07,"隆鑫通用動力":16.84,"宗申産業集団":9.55,"廣東大冶摩托車":10.46,"重慶銀翔実業":5.99,"新大洲本田":7.59,"廣州豪進摩托車":6.69,"洛陽北方易初":5.96,"江門市珠峰":5.45,"五羊-本田":4.66},"2025-04":{"大長江集団":22.8,"隆鑫通用動力":16.55,"宗申産業集団":10.8,"廣東大冶摩托車":9.71,"新大洲本田":8.58,"重慶銀翔実業":4.99,"廣州豪進摩托車":6.29,"洛陽北方易初":6.54,"江門市珠峰":6.69,"五羊-本田":4.78},"2025-05":{"大長江集団":24.73,"隆鑫通用動力":13.95,"宗申産業集団":10.58,"廣東大冶摩托車":6.66,"新大洲本田":8.94,"重慶銀翔実業":6.66,"廣州豪進摩托車":6.01,"洛陽北方易初":5.53,"江門市珠峰":4.44,"五羊-本田":4.91},"2025-06":{"大長江集団":21.65,"隆鑫通用動力":14.16,"宗申産業集団":10.16,"廣東大冶摩托車":9.19,"新大洲本田":10.16,"重慶銀翔実業":6.27,"廣州豪進摩托車":5.17,"洛陽北方易初":5.75,"江門市珠峰":4.21,"五羊-本田":5.03},"2025-07":{"大長江集団":24.6,"隆鑫通用動力":10.37,"宗申産業集団":8.33,"廣東大冶摩托車":10.22,"新大洲本田":11.42,"重慶銀翔実業":5.34,"廣州豪進摩托車":6.03,"洛陽北方易初":5.23,"江門市珠峰":5.19,"五羊-本田":5.62},"2025-08":{"大長江集団":26.3,"隆鑫通用動力":11.79,"宗申産業集団":10.87,"廣東大冶摩托車":10.05,"新大洲本田":9.34,"重慶銀翔実業":5.32,"廣州豪進摩托車":6.07,"洛陽北方易初":5.42,"五羊-本田":5.47,"江門市珠峰":3.58},"2025-09":{"大長江集団":25.91,"隆鑫通用動力":12.54,"宗申産業集団":9.79,"廣東大冶摩托車":10.99,"新大洲本田":10.31,"廣州豪進摩托車":8.37,"重慶銀翔実業":5.92,"洛陽北方易初":4.97,"五羊-本田":4.57,"江門市珠峰":3.52},"2025-10":{"大長江集団":23.48,"隆鑫通用動力":10.89,"宗申産業集団":9.11,"廣東大冶摩托車":8.5,"新大洲本田":7.28,"廣州豪進摩托車":7.73,"重慶銀翔実業":5.59,"洛陽北方易初":4.7,"五羊-本田":4.95,"江門市珠峰":3.74},"2025-11":{"大長江集団":22.93,"隆鑫通用動力":10.24,"宗申産業集団":9.29,"廣東大冶摩托車":9.69,"新大洲本田":7.66,"廣州豪進摩托車":5.86,"重慶銀翔実業":7.01,"洛陽北方易初":4.43,"五羊-本田":5.09,"江門市珠峰":3.67},"2025-12":{"大長江集団":24.11,"隆鑫通用動力":13.84,"宗申産業集団":10.05,"廣東大冶摩托車":11.26,"新大洲本田":9.29,"廣州豪進摩托車":6.44,"重慶銀翔実業":8.42,"洛陽北方易初":4.53,"五羊-本田":6.5,"江門市珠峰":4.5},"2026-01":{"大長江集団":29.44,"廣東大冶摩托車":10.77,"重慶銀翔実業":10.58,"隆鑫通用動力":10.41,"宗申産業集団":9.94,"新大洲本田":8.04,"廣州豪進摩托車":5.65,"江門市珠峰":5.64,"洛陽北方易初":5.04,"廣州天馬摩托車":4.36},"2026-02":{"大長江集団":15.93,"隆鑫通用動力":10.4,"重慶銀翔実業":10.21,"廣東大冶摩托車":9.59,"宗申産業集団":8.7,"新大洲本田":7.34,"廣州豪進摩托車":5.4,"洛陽北方易初":3.43,"五羊-本田":8.08,"江門市珠峰":1.66},"2024-04":{"大長江集団":16.84,"隆鑫通用動力":14.32,"宗申産業集団":9.27,"重慶銀翔実業":6.01,"廣東大冶摩托車":7.15,"新大洲本田":5.9,"洛陽北方易初":6.08,"廣州豪進摩托車":6.92,"五羊-本田":4.11,"江門市珠峰":15.5},"2024-03":{"大長江集団":17.13,"隆鑫通用動力":13.28,"宗申産業集団":8.06,"重慶銀翔実業":6.85,"廣東大冶摩托車":5.48,"新大洲本田":6.36,"洛陽北方易初":5.82,"五羊-本田":4.68,"廣州豪進摩托車":5.24,"廣州大運摩托車":11.01},"2024-01":{"大長江集団":15.94,"隆鑫通用動力":13.0,"宗申産業集団":8.09,"廣東大冶摩托車":7.23,"重慶銀翔実業":5.74,"洛陽北方易初":5.0,"新大洲本田":4.65,"五羊-本田":4.643,"廣州豪進摩托車":3.95},"2024-02":{"大長江集団":9.53,"隆鑫通用動力":6.94,"宗申産業集団":4.93,"重慶銀翔実業":4.97,"廣東大冶摩托車":2.5,"五羊-本田":4.03,"新大洲本田":3.89,"洛陽北方易初":3.36,"廣州豪進摩托車":3.54,"軽騎鈴木":6.88},"2024-05":{"_note":"燃油個別値は各号に未記載"},"2024-06":{"_note":"燃油個別値は各号に未記載"},"2024-07":{"_note":"燃油個別値は各号に未記載"},"2024-08":{"_note":"燃油個別値は各号に未記載"},"2024-09":{"_note":"燃油個別値は各号に未記載"},"2024-10":{"_note":"燃油個別値は各号に未記載"},"2024-11":{"_note":"燃油個別値は各号に未記載"},"2024-12":{"_note":"燃油個別値は各号に未記載"},"2026-03":{"大長江集団":26.22,"隆鑫通用動力":13.26,"重慶銀翔実業":11.51,"廣東大冶摩托車":10.49,"宗申産業集団":11.16,"新大洲本田":7.71,"廣州豪進摩托車":7.3,"洛陽北方易初":6.2,"五羊-本田":5.25,"重慶千里科技":11.05},"2026-04":{"大長江集団":27.72,"隆鑫通用動力":12.29,"廣東大冶摩托車":13.47,"重慶銀翔実業":11.47,"宗申産業集団":12.42,"新大洲本田":10.0,"廣州豪進摩托車":7.21,"洛陽北方易初":7.44,"五羊-本田":6.56,"江門市珠峰":16.76}},"ev_makers_cumul":{"2025-01":{"雅迪科技集団（YADEA）":8.17,"浙江緑源電動車":3.18,"宗申産業集団":2.99,"江蘇新日電動車":1.88,"江蘇淮海新能源":0.96,"春風動力（CFMOTO）":0.93,"巴士新能源":0.68,"五星車輌":0.61,"隆鑫通用動力":0.5,"金翌":0.45},"2025-02":{"雅迪科技集団（YADEA）":18.09,"浙江緑源電動車":6.87,"宗申産業集団":5.78,"江蘇新日電動車":4.1,"巴士新能源":2.31,"江蘇淮海新能源":2.12,"春風動力（CFMOTO）":1.12,"五星車輌":1.04,"隆鑫通用動力":0.88,"金翌":0.8},"2025-03":{"雅迪科技集団（YADEA）":29.03,"浙江緑源電動車":12.63,"宗申産業集団":10.96,"江蘇新日電動車":7.01,"江蘇淮海新能源":4.03,"巴士新能源":3.96,"春風動力（CFMOTO）":3.13,"五星車輌":1.93,"隆鑫通用動力":1.5,"金翌":1.41},"2025-04":{"雅迪科技集団（YADEA）":36.69,"浙江緑源電動車":16.07,"宗申産業集団":15.3,"江蘇新日電動車":8.96,"春風動力（CFMOTO）":5.84,"江蘇淮海新能源":5.54,"巴士新能源":5.27,"五星車輌":2.7,"隆鑫通用動力":2.17,"金翌":1.98},"2025-05":{"雅迪科技集団（YADEA）":44.65,"浙江緑源電動車":19.89,"宗申産業集団":19.08,"江蘇新日電動車":10.44,"春風動力（CFMOTO）":9.33,"江蘇淮海新能源":6.89,"巴士新能源":6.29,"五星車輌":3.47,"隆鑫通用動力":3.04,"台鈴科技（TAILG）":2.52},"2025-06":{"雅迪科技集団（YADEA）":52.88,"宗申産業集団":22.78,"浙江緑源電動車":22.52,"春風動力（CFMOTO）":12.39,"江蘇新日電動車":11.93,"江蘇淮海新能源":8.1,"巴士新能源":6.95,"五星車輌":4.07,"隆鑫通用動力":3.82,"台鈴科技（TAILG）":3.02},"2025-07":{"雅迪科技集団（YADEA）":61.4,"浙江緑源電動車":26.57,"宗申産業集団":26.13,"春風動力（CFMOTO）":16.09,"江蘇新日電動車":14.08,"江蘇淮海新能源":9.28,"巴士新能源":9.07,"五星車輌":4.63,"隆鑫通用動力":4.4,"台鈴科技（TAILG）":3.4},"2025-08":{"雅迪科技集団（YADEA）":70.23,"浙江緑源電動車":30.19,"宗申産業集団":29.57,"春風動力（CFMOTO）":19.35,"江蘇新日電動車":16.68,"巴士新能源":11.58,"江蘇淮海新能源":10.41,"五星車輌":5.32,"隆鑫通用動力":4.87,"台鈴科技（TAILG）":3.98},"2025-09":{"雅迪科技集団（YADEA）":75.73,"浙江緑源電動車":37.6,"宗申産業集団":33.95,"春風動力（CFMOTO）":22.52,"江蘇新日電動車":19.49,"巴士新能源":13.89,"江蘇淮海新能源":11.7,"五星車輌":5.97,"隆鑫通用動力":5.36,"台鈴科技（TAILG）":4.47},"2025-10":{"雅迪科技集団（YADEA）":80.8,"浙江緑源電動車":43.77,"宗申産業集団":38.32,"江蘇淮海新能源":29.03,"春風動力（CFMOTO）":25.32,"江蘇新日電動車":21.73,"巴士新能源":16.09,"五星車輌":6.56,"隆鑫通用動力":5.86,"台鈴科技（TAILG）":5.68},"2025-11":{"雅迪科技集団（YADEA）":86.38,"浙江緑源電動車":51.32,"宗申産業集団":42.35,"江蘇淮海新能源":31.62,"春風動力（CFMOTO）":25.33,"江蘇新日電動車":24.09,"巴士新能源":18.54,"五星車輌":7.07,"隆鑫通用動力":6.28,"台鈴科技（TAILG）":5.69},"2025-12":{"雅迪科技集団（YADEA）":92.11,"浙江緑源電動車":59.15,"宗申産業集団":46.51,"江蘇淮海新能源":34.49,"春風動力（CFMOTO）":30.03,"江蘇新日電動車":26.29,"巴士新能源":20.69,"五星車輌":7.55,"隆鑫通用動力":6.69,"台鈴科技（TAILG）":5.78},"2024-04":{"雅迪科技集団（YADEA）":45.11,"宗申産業集団":14.25,"浙江緑源電動車":10.07,"江蘇新日電動車":7.02,"春風動力（CFMOTO）":5.84,"江蘇淮海新能源":6.04,"巴士新能源":5.27,"五星車輌":2.7,"隆鑫通用動力":2.17,"金翌":1.9},"2024-02":{"雅迪科技集団（YADEA）":14.73,"宗申産業集団":4.73,"浙江緑源電動車":4.04,"江蘇淮海新能源":2.42,"江蘇新日電動車":2.31,"巴士新能源":1.72,"五星車輌":0.73,"台鈴科技（TAILG）":0.7,"隆鑫通用動力":0.64,"金翌":0.4},"2024-03":{"雅迪科技集団（YADEA）":30.66,"宗申産業集団":9.4,"浙江緑源電動車":6.93,"江蘇新日電動車":4.8,"江蘇淮海新能源":4.11,"巴士新能源":3.46,"五星車輌":1.49,"台鈴科技（TAILG）":1.4,"隆鑫通用動力":1.22,"金翌":1.22},"2024-01":{"雅迪科技集団（YADEA）":9.04,"宗申産業集団":2.95,"浙江緑源電動車":2.9,"江蘇新日電動車":1.8,"江蘇淮海新能源":1.44,"巴士新能源":1.25,"五星車輌":0.5,"台鈴科技（TAILG）":0.46,"隆鑫通用動力":0.35,"宝岛車業":0.31},"2024-05":{"雅迪科技集団（YADEA）":59.36,"宗申産業集団":18.5,"浙江緑源電動車":13.56,"江蘇新日電動車":9.47,"江蘇淮海新能源":7.91,"巴士新能源":2.74,"台鈴科技（TAILG）":2.43,"五星車輌":2.23,"隆鑫通用動力":2.18,"金翌":94.32},"2024-06":{"雅迪科技集団（YADEA）":78.81,"宗申産業集団":23.02,"浙江緑源電動車":16.45,"江蘇新日電動車":11.29,"江蘇淮海新能源":9.49,"巴士新能源":3.24,"台鈴科技（TAILG）":3.01,"五星車輌":2.61,"隆鑫通用動力":2.53,"金翌":99.06},"2024-07":{"雅迪科技集団（YADEA）":93.51,"宗申産業集団":27.07,"浙江緑源電動車":21.25,"江蘇新日電動車":14.48,"江蘇淮海新能源":11.38,"巴士新能源":3.75,"台鈴科技（TAILG）":3.69,"五星車輌":3.05,"隆鑫通用動力":2.91,"金翌":101.11},"2024-08":{"雅迪科技集団（YADEA）":108.66,"宗申産業集団":32.33,"浙江緑源電動車":25.11,"江蘇新日電動車":17.31,"江蘇淮海新能源":13.34,"巴士新能源":4.34,"台鈴科技（TAILG）":4.2,"五星車輌":3.43,"隆鑫通用動力":3.21,"金翌":93.14},"2024-09":{"雅迪科技集団（YADEA）":122.69,"宗申産業集団":37.59,"浙江緑源電動車":29.2,"江蘇新日電動車":21.18,"江蘇淮海新能源":14.97,"巴士新能源":5.17,"台鈴科技（TAILG）":4.74,"五星車輌":3.93,"隆鑫通用動力":3.56,"金翌":811.5},"2024-10":{"雅迪科技集団（YADEA）":127.36,"宗申産業集団":43.38,"浙江緑源電動車":33.82,"江蘇新日電動車":22.81,"江蘇淮海新能源":16.96,"巴士新能源":5.9,"台鈴科技（TAILG）":5.35,"五星車輌":4.7,"隆鑫通用動力":4.3,"春風動力（CFMOTO）":900.17},"2024-11":{"雅迪科技集団（YADEA）":134.95,"宗申産業集団":48.37,"浙江緑源電動車":37.94,"江蘇新日電動車":24.86,"江蘇淮海新能源":18.64,"巴士新能源":7.0,"台鈴科技（TAILG）":5.79,"五星車輌":5.32,"隆鑫通用動力":5.25,"春風動力（CFMOTO）":95.19},"2024-12":{"雅迪科技集団（YADEA）":142.95,"宗申産業集団":53.14,"浙江緑源電動車":42.56,"江蘇新日電動車":26.77,"江蘇淮海新能源":20.35,"巴士新能源":17.7,"台鈴科技（TAILG）":7.48,"五星車輌":6.15,"隆鑫通用動力":5.99,"春風動力（CFMOTO）":5.77},"2026-03":{"雅迪科技集団（YADEA）":15.52,"浙江緑源電動車":14.33,"江蘇新日電動車":10.72,"春風動力（CFMOTO）":9.19,"宗申産業集団":8.36,"江蘇淮海新能源":6.95,"巴士新能源":4.06,"五星車輌":2.09,"江蘇衆星":1.55,"金翌":1.32},"2026-04":{"浙江緑源電動車":25.28,"雅迪科技集団（YADEA）":21.1,"江蘇新日電動車":14.28,"春風動力（CFMOTO）":14.26,"宗申産業集団":12.82,"江蘇淮海新能源":10.04,"巴士新能源":5.27,"五星車輌":2.89,"金翌":2.1,"江蘇衆星":2.08}},"ev_makers_monthly":{"2025-01":{"雅迪科技集団（YADEA）":-134.78,"浙江緑源電動車":-39.38,"宗申産業集団":-50.15,"江蘇新日電動車":-24.89,"江蘇淮海新能源":-19.39,"春風動力（CFMOTO）":-4.84,"巴士新能源":-17.02,"五星車輌":-5.54,"隆鑫通用動力":-5.49,"金翌":0.45},"2025-02":{"雅迪科技集団（YADEA）":9.92,"浙江緑源電動車":3.69,"宗申産業集団":2.79,"江蘇新日電動車":2.22,"巴士新能源":1.63,"江蘇淮海新能源":1.16,"春風動力（CFMOTO）":0.19,"五星車輌":0.43,"隆鑫通用動力":0.38,"金翌":0.35},"2025-03":{"雅迪科技集団（YADEA）":10.94,"浙江緑源電動車":5.76,"宗申産業集団":5.18,"江蘇新日電動車":2.91,"江蘇淮海新能源":1.91,"巴士新能源":1.65,"春風動力（CFMOTO）":2.01,"五星車輌":0.89,"隆鑫通用動力":0.62,"金翌":0.61},"2025-04":{"雅迪科技集団（YADEA）":7.66,"浙江緑源電動車":3.44,"宗申産業集団":4.34,"江蘇新日電動車":1.95,"春風動力（CFMOTO）":2.71,"江蘇淮海新能源":1.51,"巴士新能源":1.31,"五星車輌":0.77,"隆鑫通用動力":0.67,"金翌":0.57},"2025-05":{"雅迪科技集団（YADEA）":7.96,"浙江緑源電動車":3.82,"宗申産業集団":3.78,"江蘇新日電動車":1.48,"春風動力（CFMOTO）":3.49,"江蘇淮海新能源":1.35,"巴士新能源":1.02,"五星車輌":0.77,"隆鑫通用動力":0.87,"台鈴科技（TAILG）":2.52},"2025-06":{"雅迪科技集団（YADEA）":8.23,"宗申産業集団":3.7,"浙江緑源電動車":2.63,"春風動力（CFMOTO）":3.06,"江蘇新日電動車":1.49,"江蘇淮海新能源":1.21,"巴士新能源":0.66,"五星車輌":0.6,"隆鑫通用動力":0.78,"台鈴科技（TAILG）":0.5},"2025-07":{"雅迪科技集団（YADEA）":8.52,"浙江緑源電動車":4.05,"宗申産業集団":3.35,"春風動力（CFMOTO）":3.7,"江蘇新日電動車":2.15,"江蘇淮海新能源":1.18,"巴士新能源":2.12,"五星車輌":0.56,"隆鑫通用動力":0.58,"台鈴科技（TAILG）":0.38},"2025-08":{"雅迪科技集団（YADEA）":8.83,"浙江緑源電動車":3.62,"宗申産業集団":3.44,"春風動力（CFMOTO）":3.26,"江蘇新日電動車":2.6,"巴士新能源":2.51,"江蘇淮海新能源":1.13,"五星車輌":0.69,"隆鑫通用動力":0.47,"台鈴科技（TAILG）":0.58},"2025-09":{"雅迪科技集団（YADEA）":5.5,"浙江緑源電動車":7.41,"宗申産業集団":4.38,"春風動力（CFMOTO）":3.17,"江蘇新日電動車":2.81,"巴士新能源":2.31,"江蘇淮海新能源":1.29,"五星車輌":0.65,"隆鑫通用動力":0.49,"台鈴科技（TAILG）":0.49},"2025-10":{"雅迪科技集団（YADEA）":5.07,"浙江緑源電動車":6.17,"宗申産業集団":4.37,"江蘇淮海新能源":17.33,"春風動力（CFMOTO）":2.8,"江蘇新日電動車":2.24,"巴士新能源":2.2,"五星車輌":0.59,"隆鑫通用動力":0.5,"台鈴科技（TAILG）":1.21},"2025-11":{"雅迪科技集団（YADEA）":5.58,"浙江緑源電動車":7.55,"宗申産業集団":4.03,"江蘇淮海新能源":2.59,"春風動力（CFMOTO）":0.01,"江蘇新日電動車":2.36,"巴士新能源":2.45,"五星車輌":0.51,"隆鑫通用動力":0.42,"台鈴科技（TAILG）":0.01},"2025-12":{"雅迪科技集団（YADEA）":5.73,"浙江緑源電動車":7.83,"宗申産業集団":4.16,"江蘇淮海新能源":2.87,"春風動力（CFMOTO）":4.7,"江蘇新日電動車":2.2,"巴士新能源":2.15,"五星車輌":0.48,"隆鑫通用動力":0.41,"台鈴科技（TAILG）":0.09},"2024-04":{"雅迪科技集団（YADEA）":14.45,"宗申産業集団":4.85,"浙江緑源電動車":3.14,"江蘇新日電動車":2.22,"春風動力（CFMOTO）":5.84,"江蘇淮海新能源":1.93,"巴士新能源":1.81,"五星車輌":1.21,"隆鑫通用動力":0.95,"金翌":0.68},"2024-03":{"雅迪科技集団（YADEA）":15.93,"宗申産業集団":4.67,"浙江緑源電動車":2.89,"江蘇新日電動車":2.49,"江蘇淮海新能源":1.69,"巴士新能源":1.74,"五星車輌":0.76,"台鈴科技（TAILG）":0.7,"隆鑫通用動力":0.58,"金翌":0.82},"2024-01":{"雅迪科技集団（YADEA）":9.04,"宗申産業集団":2.95,"浙江緑源電動車":2.9,"江蘇新日電動車":1.8,"江蘇淮海新能源":1.44,"巴士新能源":1.25,"五星車輌":0.5,"台鈴科技（TAILG）":0.46,"隆鑫通用動力":0.35,"宝岛車業":0.31},"2024-02":{"雅迪科技集団（YADEA）":5.69,"宗申産業集団":1.78,"浙江緑源電動車":1.14,"江蘇淮海新能源":0.98,"江蘇新日電動車":0.51,"巴士新能源":0.47,"五星車輌":0.23,"台鈴科技（TAILG）":0.24,"隆鑫通用動力":0.29,"金翌":0.4},"2024-05":{"雅迪科技集団（YADEA）":14.25,"宗申産業集団":4.25,"浙江緑源電動車":3.49,"江蘇新日電動車":2.45,"江蘇淮海新能源":1.87,"巴士新能源":-2.53,"台鈴科技（TAILG）":2.43,"五星車輌":-0.47,"隆鑫通用動力":0.01,"金翌":92.42},"2024-06":{"雅迪科技集団（YADEA）":19.45,"宗申産業集団":4.52,"浙江緑源電動車":2.89,"江蘇新日電動車":1.82,"江蘇淮海新能源":1.58,"巴士新能源":0.5,"台鈴科技（TAILG）":0.58,"五星車輌":0.38,"隆鑫通用動力":0.35,"金翌":4.74},"2024-07":{"雅迪科技集団（YADEA）":14.7,"宗申産業集団":4.05,"浙江緑源電動車":4.8,"江蘇新日電動車":3.19,"江蘇淮海新能源":1.89,"巴士新能源":0.51,"台鈴科技（TAILG）":0.68,"五星車輌":0.44,"隆鑫通用動力":0.38,"金翌":2.05},"2024-08":{"雅迪科技集団（YADEA）":15.15,"宗申産業集団":5.26,"浙江緑源電動車":3.86,"江蘇新日電動車":2.83,"江蘇淮海新能源":1.96,"巴士新能源":0.59,"台鈴科技（TAILG）":0.51,"五星車輌":0.38,"隆鑫通用動力":0.3,"金翌":-7.97},"2024-09":{"雅迪科技集団（YADEA）":14.03,"宗申産業集団":5.26,"浙江緑源電動車":4.09,"江蘇新日電動車":3.87,"江蘇淮海新能源":1.63,"巴士新能源":0.83,"台鈴科技（TAILG）":0.54,"五星車輌":0.5,"隆鑫通用動力":0.35,"金翌":718.36},"2024-10":{"雅迪科技集団（YADEA）":4.67,"宗申産業集団":5.79,"浙江緑源電動車":4.62,"江蘇新日電動車":1.63,"江蘇淮海新能源":1.99,"巴士新能源":0.73,"台鈴科技（TAILG）":0.61,"五星車輌":0.77,"隆鑫通用動力":0.74,"春風動力（CFMOTO）":900.17},"2024-11":{"雅迪科技集団（YADEA）":7.59,"宗申産業集団":4.99,"浙江緑源電動車":4.12,"江蘇新日電動車":2.05,"江蘇淮海新能源":1.68,"巴士新能源":1.1,"台鈴科技（TAILG）":0.44,"五星車輌":0.62,"隆鑫通用動力":0.95,"春風動力（CFMOTO）":-804.98},"2024-12":{"雅迪科技集団（YADEA）":8.0,"宗申産業集団":4.77,"浙江緑源電動車":4.62,"江蘇新日電動車":1.91,"江蘇淮海新能源":1.71,"巴士新能源":10.7,"台鈴科技（TAILG）":1.69,"五星車輌":0.83,"隆鑫通用動力":0.74,"春風動力（CFMOTO）":-89.42},"2026-04":{"浙江緑源電動車":10.95,"雅迪科技集団（YADEA）":5.58,"江蘇新日電動車":3.56,"春風動力（CFMOTO）":5.07,"宗申産業集団":4.46,"江蘇淮海新能源":3.09,"巴士新能源":1.21,"五星車輌":0.8,"金翌":0.78,"江蘇衆星":0.53}},"balance":{"2024-12":{"receivable":255.63,"receivable_yoy":24.8,"inventory":54.71,"inventory_yoy":11.55},"2025-02":{"receivable":232.88,"receivable_yoy":20.0,"inventory":52.82,"inventory_yoy":10.14},"2025-04":{"receivable":253.88,"receivable_yoy":17.77,"inventory":54.61,"inventory_yoy":4.73},"2025-06":{"receivable":251.35,"receivable_yoy":6.99,"inventory":53.52,"inventory_yoy":6.93},"2025-07":{"receivable":249.47,"receivable_yoy":4.8,"inventory":52.65,"inventory_yoy":-1.75},"2025-08":{"receivable":256.48,"receivable_yoy":4.08,"inventory":53.2,"inventory_yoy":-3.94},"2025-09":{"receivable":245.09,"receivable_yoy":-4.2,"inventory":48.32,"inventory_yoy":-10.54},"2025-10":{"receivable":244.52,"receivable_yoy":0.48,"inventory":52.44,"inventory_yoy":-3.72},"2025-11":{"receivable":257.37,"receivable_yoy":2.65,"inventory":53.03,"inventory_yoy":-6.14},"2025-12":{"receivable":244.39,"receivable_yoy":-2.2,"inventory":57.63,"inventory_yoy":4.75},"2025-03":{"receivable":242.33,"receivable_yoy":20.12,"inventory":51.67,"inventory_yoy":8.82},"2025-05":{"receivable":255.11,"receivable_yoy":14.3,"inventory":52.69,"inventory_yoy":4.54},"2024-10":{"receivable":253.94,"receivable_yoy":12.86,"inventory":53.16,"inventory_yoy":13.5},"2024-11":{"receivable":255.71,"receivable_yoy":11.39,"inventory":56.43,"inventory_yoy":21.74},"2024-08":{"receivable":253.88,"receivable_yoy":11.82,"inventory":55.13,"inventory_yoy":5.29},"2024-09":{"receivable":261.17,"receivable_yoy":15.52,"inventory":53.99,"inventory_yoy":6.32},"2024-06":{"receivable":242.43,"receivable_yoy":32.86,"inventory":49.73,"inventory_yoy":0.89},"2024-07":{"receivable":244.86,"receivable_yoy":34.63,"inventory":53.57,"inventory_yoy":2.18},"2024-05":{"receivable":232.89,"receivable_yoy":28.41,"inventory":50.51,"inventory_yoy":4.13},"2024-04":{"receivable":223.2,"receivable_yoy":22.29,"inventory":52.15,"inventory_yoy":9.18},"2024-03":{"receivable":208.54,"receivable_yoy":19.06,"inventory":48.02,"inventory_yoy":-6.24},"2024-02":{"receivable":197.01,"receivable_yoy":21.79,"inventory":47.86,"inventory_yoy":-1.85}},"export_companies":{"2025-01":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","宗申産業集団","重慶銀翔実業","廣州豪進摩托車","江門市珠峰","力帆科技","廣州天馬摩托車","新大洲本田"],"total":64.29,"share":61.79},"2025-02":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","重慶銀翔実業","宗申産業集団","廣州豪進摩托車","江門市珠峰","新大洲本田","力帆科技","重慶润通"],"total":111.42,"share":61.67},"2025-03":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","重慶銀翔実業","宗申産業集団","廣州豪進摩托車","江門市珠峰","新大洲本田","力帆科技","重慶润通"],"total":181.55,"share":62.0},"2025-04":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","宗申産業集団","重慶銀翔実業","廣州豪進摩托車","江門市珠峰","新大洲本田","重慶千里科技","重慶润通"],"total":255.46,"share":61.88,"note":"1-4月累計"},"2025-05":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","宗申産業集団","重慶銀翔実業","廣州豪進摩托車","江門市珠峰","新大洲本田","重慶千里科技","重慶润通"],"total":326.07,"share":61.75,"note":"1-5月累計"},"2025-06":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","宗申産業集団","重慶銀翔実業","廣州豪進摩托車","江門市珠峰","新大洲本田","重慶千里科技","航天巴山"],"total":396.29,"share":61.33,"note":"1-6月累計"},"2025-07":{"companies":["大長江集団","隆鑫通用動力","廣東大冶摩托車","宗申産業集団","重慶銀翔実業","廣州豪進摩托車","江門珠峰","新大洲本田","重慶千里科技","航天巴山"],"total":467.26,"share":61.36,"note":"1-7月累計"},"2025-08":{"companies":["大長江集団","隆鑫通用動力","廣東大冶摩托車","宗申産業集団","重慶銀翔実業","廣州豪進摩托車","新大洲本田","江門珠峰","重慶千里科技","航天巴山"],"total":536.32,"share":61.36,"note":"1-8月累計"},"2025-09":{"companies":["大長江集団","隆鑫通用動力","廣東大冶摩托車","宗申産業集団","廣州豪進摩托車","重慶銀翔実業","新大洲本田","江門市珠峰","重慶千里科技","航天巴山"],"total":611.55,"share":61.36,"note":"1-9月累計"},"2025-10":{"companies":["大長江集団","隆鑫通用動力","廣東大冶摩托車","廣州豪進摩托車","宗申産業集団","重慶銀翔実業","新大洲本田","江門市珠峰","重慶千里科技","航天巴山"],"total":676.34,"share":61.38,"note":"1-10月累計"},"2025-11":{"companies":["大長江集団","隆鑫通用動力","廣東大冶摩托車","廣州豪進摩托車","宗申産業集団","重慶銀翔実業","新大洲本田","江門市珠峰","重慶千里科技","航天巴山"],"total":739.82,"share":61.23,"note":"1-11月累計"},"2025-12":{"companies":["大長江集団","隆鑫通用動力","廣東大冶摩托車","重慶銀翔実業","廣州豪進摩托車","宗申産業集団","新大洲本田","江門市珠峰","重慶千里科技","航天巴山"],"total":821.25,"share":61.44,"note":"1-12月累計"},"2026-01":{"companies":["大長江集団","重慶銀翔実業","隆鑫通用動力","廣東大冶摩托車","宗申産業集団","江門市珠峰","廣州豪進摩托車","新大洲本田","廣州天馬摩托車","航天巴山"],"total":79.91,"share":60.4,"note":"2026年1月単月"},"2026-02":{"companies":["大長江集団","隆鑫通用動力","廣東大冶摩托車","重慶銀翔実業","新大洲本田","宗申産業集団","春風動力（CFMOTO）","钱江摩托","廣州豪進摩托車","厦門厦杏摩托車"],"total":9.91,"share":64.69,"note":"1-2月累計・金額ランキング（億ドル）／従来の台数ランキングから変更"},"2024-11":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","廣州豪進摩托車","重慶銀翔実業","宗申産業集団","江門市珠峰","新大洲本田","力帆科技","重慶润通"],"total":600.67,"share":60.29,"note":"2024年1-11月累計"},"2024-12":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","廣州豪進摩托車","宗申産業集団","重慶銀翔実業","江門市珠峰","新大洲本田","力帆科技","重慶润通"],"total":665.93,"share":60.45,"note":"2024年1-12月累計"},"2024-09":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","廣州豪進摩托車","重慶銀翔実業","宗申産業集団","江門市珠峰","新大洲本田","力帆科技","重慶润通"],"total":486.11,"share":59.9,"note":"2024年1-9月累計"},"2024-10":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","廣州豪進摩托車","重慶銀翔実業","宗申産業集団","江門市珠峰","新大洲本田","力帆科技","重慶润通"],"total":486.11,"share":60.09,"note":"2024年1-10月累計（合計台数は原文ママ）"},"2024-07":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","重慶銀翔実業","廣州豪進摩托車","宗申産業集団","江門市珠峰","新大洲本田","力帆科技","重慶润通"],"total":367.26,"share":59.6,"note":"2024年1-7月累計"},"2024-08":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","重慶銀翔実業","廣州豪進摩托車","宗申産業集団","江門市珠峰","新大洲本田","力帆科技","重慶润通"],"total":422.75,"share":59.6,"note":"2024年1-8月累計"},"2024-06":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","重慶銀翔実業","廣州豪進摩托車","宗申産業集団","江門市珠峰","新大洲本田","大運摩托車","力帆科技"],"total":303.83,"share":58.99,"note":"2024年1-6月累計"},"2024-05":{"companies":["隆鑫通用動力","大長江集団","重慶銀翔実業","廣東大冶摩托車","廣州豪進摩托車","宗申産業集団","江門市珠峰","新大洲本田","力帆科技","大運摩托車"],"total":246.95,"share":59.36,"note":"2024年1-5月累計"},"2024-04":{"companies":["隆鑫通用動力","大長江集団","重慶銀翔実業","廣東大冶摩托車","廣州豪進摩托車","宗申産業集団","江門市珠峰","新大洲本田","力帆科技","大運摩托車"],"total":191.9,"share":59.65,"note":"2024年1-4月累計"},"2024-02":{"companies":["隆鑫通用動力","大長江集団","重慶銀翔実業","廣東大冶摩托車","宗申産業集団","廣州豪進摩托車","新大洲本田","廣州天馬摩托車","廣州三雅摩托車","力帆実業"],"total":81.43,"share":58.71,"note":"2024年1-2月累計"},"2024-03":{"companies":["隆鑫通用動力","大長江集団","重慶銀翔実業","廣東大冶摩托車","廣州豪進摩托車","宗申産業集団","江門市珠峰","新大洲本田","钱江摩托","廣州天馬摩托車"],"total":136.26,"share":59.38,"note":"2024年1Q累計"},"2024-01":{"companies":["隆鑫通用動力","大長江集団","廣東大冶摩托車","重慶銀翔実業","宗申産業集団","廣州豪進摩托車","新大洲本田","廣州天馬摩托車","浙江钱江摩托車","洛陽北方易初"],"total":52.41,"share":60.17,"note":"2024年1月単月"},"2026-03":{"companies":["大長江集団","隆鑫通用動力","廣東大冶摩托車","重慶銀翔実業","宗申産業集団","新大洲本田","春風動力（CFMOTO）","廣州豪進摩托車","钱江摩托","厦門厦杏摩托車"],"total":15.15,"share":65.16,"note":"1-3月累計・金額ランキング（億ドル）"},"2026-04":{"companies":["大長江集団","隆鑫通用動力","廣東大冶摩托車","重慶銀翔実業","宗申産業集団","新大洲本田","春風動力（CFMOTO）","廣州豪進摩托車","钱江摩托","厦門厦杏摩托車"],"total":20.99,"share":64.72,"note":"1-4月累計・金額ランキング（億ドル）"}},"sub_export":{"2025-01":{"atv_units":3.48,"atv_amount":0.82,"atv_yoy":12.21,"atv_amount_yoy":16.13,"parts_amount":0.34,"parts_amount_yoy":13.03,"note":"エンジン単月未記載"},"2025-02":{"engine_units":21.76,"engine_amount":0.43,"engine_yoy":26.17,"engine_amount_yoy":11.82,"atv_units":6.3,"atv_amount":1.76,"atv_yoy":8.75,"atv_amount_yoy":33.86,"parts_amount":0.65,"parts_amount_yoy":20.61,"note":"1-2月累計"},"2025-03":{"engine_units":32.27,"engine_amount":0.62,"engine_yoy":18.34,"engine_amount_yoy":-1.77,"atv_units":9.83,"atv_amount":2.84,"atv_yoy":5.25,"atv_amount_yoy":25.35,"parts_amount":1.06,"parts_amount_yoy":24.45,"note":"1-3月累計"},"2025-04":{"engine_units":12.22,"engine_amount":0.25,"atv_units":3.81,"atv_amount":1.21,"parts_amount":0.48,"note":"1-4月累計から逆算"},"2025-05":{"engine_units":10.51,"engine_amount":0.22,"atv_units":3.69,"atv_amount":1.14,"parts_amount":0.41,"note":"1-5月累計から逆算"},"2025-06":{"engine_units":9.21,"engine_amount":0.2,"atv_units":5.4,"atv_amount":1.42,"parts_amount":0.43,"note":"1-6月累計から逆算"},"2025-07":{"engine_units":11.69,"engine_amount":0.24,"atv_units":4.77,"atv_amount":1.32,"parts_amount":0.39,"note":"1-7月累計から逆算"},"2025-08":{"engine_units":9.93,"engine_amount":0.18,"atv_units":3.75,"atv_amount":0.99,"parts_amount":0.25,"note":"1-8月累計から逆算"},"2025-09":{"engine_units":11.58,"engine_amount":0.23,"atv_units":4.09,"atv_amount":1.19,"parts_amount":0.33,"note":"1-9月累計から逆算"},"2025-10":{"engine_units":9.18,"engine_amount":0.18,"atv_units":4.08,"atv_amount":1.34,"parts_amount":0.11,"note":"1-10月累計から逆算"},"2025-11":{"engine_units":15.1,"engine_amount":0.32,"atv_units":3.93,"atv_amount":1.32,"parts_amount":0.56,"note":"1-11月累計から逆算"},"2025-12":{"engine_units":10.4,"engine_amount":0.2,"atv_units":4.2,"atv_amount":1.17,"parts_amount":0.27,"note":"1-12月累計から逆算"},"2026-02":{"engine_units":16.64,"engine_amount":0.35,"engine_yoy":-23.56,"atv_units":8.0,"atv_amount":2.71,"atv_yoy":27.04,"atv_amount_yoy":54.3,"parts_amount":0.73,"parts_amount_yoy":12.45,"note":"1-2月累計（1月単月内訳未記載のため逆算不可）"},"2024-11":{"engine_units":103.74,"engine_amount":2.18,"engine_yoy":20.15,"engine_amount_yoy":18.44,"atv_units":44.22,"atv_amount":10.76,"atv_yoy":31.02,"atv_amount_yoy":34.91,"parts_amount":3.56,"parts_amount_yoy":18.03,"note":"2024年1-11月累計"},"2024-12":{"engine_units":114.93,"engine_amount":2.41,"engine_yoy":21.89,"engine_amount_yoy":19.41,"atv_units":48.73,"atv_amount":12.08,"atv_yoy":32.33,"atv_amount_yoy":38.66,"parts_amount":4.01,"parts_amount_yoy":16.49,"note":"2024年1-12月累計"},"2024-09":{"engine_units":84.36,"engine_amount":1.81,"engine_yoy":17.31,"engine_amount_yoy":17.14,"atv_units":35.67,"atv_amount":8.51,"atv_yoy":29.12,"atv_amount_yoy":28.8,"parts_amount":2.81,"parts_amount_yoy":10.85,"note":"2024年1-9月累計（製品総額7.79億は桁落ち誤記と推察、実計64.33億）"},"2024-10":{"engine_units":93.31,"engine_amount":1.97,"engine_yoy":17.63,"engine_amount_yoy":16.88,"atv_units":39.76,"atv_amount":9.48,"atv_yoy":31.15,"atv_amount_yoy":29.87,"parts_amount":3.12,"parts_amount_yoy":12.89,"note":"2024年1-10月累計"},"2024-07":{"engine_units":65.66,"engine_amount":1.43,"engine_yoy":11.5,"engine_amount_yoy":10.51,"atv_units":27.12,"atv_amount":6.5,"atv_yoy":34.24,"atv_amount_yoy":30.61,"parts_amount":2.16,"parts_amount_yoy":10.74,"note":"2024年1-7月累計"},"2024-08":{"engine_units":75.17,"engine_amount":1.62,"engine_yoy":16.4,"engine_amount_yoy":15.59,"atv_units":31.53,"atv_amount":7.5,"atv_yoy":30.73,"atv_amount_yoy":29.38,"parts_amount":2.5,"parts_amount_yoy":12.02,"note":"2024年1-8月累計"},"2024-06":{"engine_units":12.61,"engine_amount":0.25,"atv_units":5.65,"atv_amount":1.23,"parts_amount":0.35,"note":"1-6月累計から逆算（6月単月）"},"2024-05":{"engine_units":8.53,"engine_amount":0.16,"atv_units":4.17,"atv_amount":1.08,"parts_amount":0.37,"note":"1-5月累計から逆算（5月単月）"},"2024-04":{"engine_units":10.28,"engine_amount":0.23,"atv_units":3.59,"atv_amount":0.78,"parts_amount":0.3,"note":"1-4月累計から逆算（4月単月）"},"2024-02":{"engine_units":6.91,"engine_amount":0.06,"atv_units":2.69,"atv_amount":0.61,"parts_amount":0.23,"note":"1-2月累計から逆算（2月単月）"},"2024-03":{"engine_units":27.27,"engine_amount":0.63,"engine_yoy":28.84,"engine_amount_yoy":20.89,"atv_units":9.37,"atv_amount":2.49,"atv_yoy":17.09,"atv_amount_yoy":12.32,"parts_amount":0.85,"parts_amount_yoy":16.66,"note":"2024年1Q累計"},"2024-01":{"engine_units":10.34,"engine_amount":0.33,"engine_yoy":32.13,"engine_amount_yoy":83.4,"atv_units":3.1,"atv_amount":0.7,"atv_yoy":30.17,"atv_amount_yoy":20.09,"parts_amount":0.3,"parts_amount_yoy":37.73,"note":"2024年1月単月"},"2026-03":{"engine_units":25.04,"engine_amount":0.54,"engine_yoy":-22.41,"engine_amount_yoy":-12.98,"atv_units":12.92,"atv_amount":4.21,"atv_yoy":31.45,"atv_amount_yoy":48.21,"parts_amount":1.06,"parts_amount_yoy":0.18,"note":"1-3月累計"}},"export_cc_yoy":{"2025-01":{"125cc":12.79,"150cc":-2.12,"110cc":22.58,"200cc":70.0,"50cc":-7.56,"250cc":25.23,"note":"単月YoY"},"2025-02":{"125cc":28.86,"150cc":7.64,"110cc":26.85,"200cc":65.95,"50cc":-1.41,"250cc":19.25,"note":"1-2月累計YoY"},"2025-03":{"125cc":31.64,"150cc":13.94,"110cc":28.86,"200cc":60.33,"50cc":23.04,"250cc":13.09,"note":"1-3月累計YoY"},"2025-04":{"125cc":30.63,"150cc":20.34,"110cc":22.3,"200cc":51.26,"50cc":27.65,"250cc":5.14,"note":"1-4月累計YoY"},"2025-05":{"125cc":30.87,"150cc":8.19,"110cc":32.98,"200cc":20.26,"50cc":-17.39,"250cc":-7.98,"note":"5月単月YoY"},"2025-06":{"125cc":31.65,"150cc":-3.31,"110cc":25.64,"200cc":33.15,"50cc":-15.64,"250cc":-14.56,"note":"6月単月YoY"},"2025-07":{"125cc":34.2,"150cc":-10.37,"110cc":51.94,"200cc":-1.41,"50cc":-20.22,"400cc":-57.68,"note":"7月単月YoY / 400ccが上位6入り、250ccは圏外"},"2025-08":{"125cc":31.7,"150cc":10.58,"110cc":30.86,"200cc":38.93,"250cc":9.39,"400cc":60.46,"note":"8月単月YoY / 250cc・400ccが上位6入り、50ccは圏外"},"2025-09":{"125cc":31.84,"150cc":4.85,"110cc":36.51,"200cc":44.81,"50cc":-38.96,"250cc":-2.26,"note":"9月単月YoY"},"2025-10":{"125cc":32.8,"150cc":8.08,"110cc":29.6,"200cc":33.7,"50cc":-4.17,"250cc":-3.39,"note":"1-10月累計YoY"},"2025-11":{"125cc":31.51,"150cc":8.16,"110cc":27.29,"200cc":29.44,"50cc":-5.56,"250cc":-1.49,"note":"1-11月累計YoY"},"2025-12":{"125cc":31.86,"150cc":8.31,"110cc":29.78,"200cc":27.26,"50cc":-6.23,"250cc":1.04,"note":"1-12月累計YoY"},"2026-01":{"125cc":40.43,"150cc":3.89,"110cc":75.39,"200cc":2.64,"250cc":34.82,"50cc":22.46,"note":"2026年1月単月YoY"},"2026-02":{"125cc":33.18,"150cc":7.36,"110cc":72.18,"200cc":13.63,"50cc":-26.61,"250cc":36.43,"note":"1-2月累計YoY"},"2024-11":{"125cc":24.02,"150cc":33.78,"110cc":15.49,"200cc":42.57,"50cc":-10.64,"250cc":13.99,"note":"2024年1-11月累計YoY"},"2024-12":{"125cc":25.23,"150cc":33.07,"110cc":16.09,"200cc":44.81,"50cc":-9.38,"250cc":13.3,"note":"2024年1-12月累計YoY"},"2024-09":{"150cc":37.11,"125cc":25.72,"110cc":17.36,"200cc":39.24,"50cc":-11.95,"250cc":16.64,"note":"2024年1-9月累計YoY"},"2024-10":{"150cc":35.38,"125cc":24.58,"110cc":16.16,"200cc":40.57,"50cc":-12.34,"250cc":14.8,"note":"2024年1-10月累計YoY"},"2024-07":{"150cc":43.09,"125cc":25.65,"110cc":11.37,"200cc":42.55,"50cc":-13.58,"250cc":19.65,"note":"2024年1-7月累計YoY"},"2024-08":{"150cc":36.9,"125cc":24.97,"110cc":11.97,"200cc":37.96,"50cc":-13.12,"250cc":18.01,"note":"2024年1-8月累計YoY"},"2024-06":{"150cc":43.87,"125cc":25.02,"110cc":14.51,"200cc":40.15,"50cc":-14.05,"250cc":18.72,"note":"2024年1-6月累計YoY"},"2024-05":{"150cc":43.94,"125cc":28.65,"110cc":15.62,"200cc":47.12,"50cc":-9.2,"250cc":14.35,"note":"2024年1-5月累計YoY"},"2024-04":{"150cc":53.5,"125cc":28.05,"110cc":16.66,"200cc":43.23,"50cc":3.76,"250cc":15.96,"note":"2024年1-4月累計YoY"},"2024-02":{"125cc":36.45,"150cc":91.8,"110cc":18.67,"200cc":52.33,"50cc":43.24,"250cc":33.34,"note":"2024年1-2月累計YoY"},"2024-03":{"125cc":26.81,"150cc":68.79,"110cc":13.15,"200cc":40.71,"50cc":10.49,"250cc":17.78,"note":"2024年1Q累計YoY"},"2024-01":{"125cc":76.81,"150cc":145.25,"110cc":85.67,"200cc":105.01,"50cc":84.58,"250cc":45.59,"note":"2024年1月単月YoY"},"2026-03":{"125cc":25.24,"150cc":2.41,"110cc":59.96,"200cc":7.12,"50cc":-34.71,"250cc":35.3,"note":"1-3月累計YoY"},"2026-04":{"125cc":20.78,"150cc":0.8,"110cc":62.48,"200cc":6.96,"250cc":42.03,"50cc":-27.44,"note":"1-4月累計YoY"}}};

// ---- データ展開 ----
// cccmDerive() が CCCM_RAW から各グラフ用の配列を作る。自動取得の数値（cccm/data.json）を足したら作り直す
let MONTHS, JP, JP_FULL, CCCM, fuelNames, evNames;
function cccmDerive() {
MONTHS = CCCM_RAW.meta.months;
// X軸ラベル：年が変わる月・その年最初の月は「'25/1」形式、それ以外は「2月」形式
JP = MONTHS.map((m, i) => {
  const [yr, mo] = m.split('-').map(Number);
  const yy = String(yr).slice(2); // '25'
  // 最初の月、または前月と年が違う場合は年付き
  const prevYr = i > 0 ? Number(MONTHS[i-1].split('-')[0]) : null;
  const showYr = (i === 0) || (prevYr !== null && prevYr !== yr);
  return showYr ? `'${yy}/${mo}` : `${mo}月`;
});
// tooltip用フルラベル
JP_FULL = MONTHS.map(m => {
  const [yr, mo] = m.split('-').map(Number);
  return `${yr}年${mo}月`;
});
const ps = m => CCCM_RAW.prod_sales[m] || {};
const ex = m => CCCM_RAW.export[m] || {};
const bk = m => CCCM_RAW.bike_type[m] || {};
const tr = m => CCCM_RAW.trike[m] || {};
const bl = m => CCCM_RAW.balance[m] || {};

function cccmSeries(fn) { return MONTHS.map(fn); }

CCCM = {
  labels: JP_FULL,
  gas_sales:      cccmSeries(m => ps(m).gas_sales),
  ev_sales:       cccmSeries(m => ps(m).ev_sales),
  total_sales:    cccmSeries(m => ps(m).total_sales),
  bike_sales:     cccmSeries(m => ps(m).bike_sales),
  trike_sales:    cccmSeries(m => ps(m).trike_sales),
  large_sales:    cccmSeries(m => ps(m).large_sales),
  gas_sales_yoy:  cccmSeries(m => ps(m).gas_sales_yoy),
  ev_sales_yoy:   cccmSeries(m => ps(m).ev_sales_yoy),
  bike_sales_yoy: cccmSeries(m => ps(m).bike_sales_yoy),
  trike_sales_yoy:cccmSeries(m => ps(m).trike_sales_yoy),
  large_sales_yoy:cccmSeries(m => ps(m).large_sales_yoy),
  cross_sales:      cccmSeries(m => bk(m).cross),
  scooter_sales:    cccmSeries(m => bk(m).scooter),
  underbone_sales:  cccmSeries(m => bk(m).underbone),
  freight_trike:    cccmSeries(m => tr(m).freight),
  passenger_trike:  cccmSeries(m => tr(m).passenger),
  export_total:   cccmSeries(m => ex(m).total),
  export_yoy:     cccmSeries(m => ex(m).total_yoy),
  export_amount:  cccmSeries(m => ex(m).amount),
  receivable:     cccmSeries(m => bl(m).receivable),
  receivable_yoy: cccmSeries(m => bl(m).receivable_yoy),
  inventory:      cccmSeries(m => bl(m).inventory),
  inventory_yoy:  cccmSeries(m => bl(m).inventory_yoy),
  // 経済効益（単月逆算）
  econ_months: Object.keys(CCCM_RAW.econ_monthly).sort(),
  econ_labels: Object.keys(CCCM_RAW.econ_monthly).sort().map((m,i,arr) => {
    const [yr,mo] = m.split('-').map(Number);
    const yy = String(yr).slice(2);
    const prevYr = i>0 ? Number(arr[i-1].split('-')[0]) : null;
    return (i===0||prevYr!==yr) ? `'${yy}/${mo}` : `${mo}月`;
  }),
  econ_labels_full: Object.keys(CCCM_RAW.econ_monthly).sort().map(m => {
    const [yr,mo] = m.split('-').map(Number);
    return `${yr}年${mo}月`;
  }),
  econ_revenue: Object.keys(CCCM_RAW.econ_monthly).sort().map(k => CCCM_RAW.econ_monthly[k]['営業収入']),
  econ_profit:  Object.keys(CCCM_RAW.econ_monthly).sort().map(k => CCCM_RAW.econ_monthly[k]['利益総額']),
  econ_margin:  Object.keys(CCCM_RAW.econ_monthly).sort().map(k => CCCM_RAW.econ_monthly[k]['利益率%']),
  econ_cost:    Object.keys(CCCM_RAW.econ_monthly).sort().map(k => CCCM_RAW.econ_monthly[k]['営業コスト']),
  econ_rd:      Object.keys(CCCM_RAW.econ_monthly).sort().map(k => CCCM_RAW.econ_monthly[k]['研究開発費用']),
  econ_selling: Object.keys(CCCM_RAW.econ_monthly).sort().map(k => CCCM_RAW.econ_monthly[k]['販売費用']),
  econ_admin:   Object.keys(CCCM_RAW.econ_monthly).sort().map(k => CCCM_RAW.econ_monthly[k]['管理費用']),
  econ_note:    Object.keys(CCCM_RAW.econ_monthly).sort().map(k => CCCM_RAW.econ_monthly[k].note),
  // 排気量別輸出
  cc_months: Object.keys(CCCM_RAW.export_cc).filter(m => {
    const d = CCCM_RAW.export_cc[m];
    return d && Object.values(d).some(v => v !== null && typeof v === 'number');
  }).sort(),
  cc_labels: [],
};
CCCM.cc_labels = CCCM.cc_months.map((m, i) => {
  const [yr, mo] = m.split('-').map(Number);
  const yy = String(yr).slice(2);
  const prevYr = i > 0 ? Number(CCCM.cc_months[i-1].split('-')[0]) : null;
  return ((i===0)||prevYr!==yr) ? `'${yy}/${mo}` : `${mo}月`;
});
CCCM.cc_labels_full = CCCM.cc_months.map(m => {
  const [yr, mo] = m.split('-').map(Number);
  return `${yr}年${mo}月`;
});
CCCM.cc_data = {};
['125cc','150cc','110cc','200cc','50cc','250cc','400cc'].forEach(cc => {
  CCCM.cc_data[cc] = CCCM.cc_months.map(m => (CCCM_RAW.export_cc[m]||{})[cc] ?? null);
});
// 「_note」「_total」などの注記用の項目はメーカー名ではないので除く
fuelNames = [...new Set(Object.values(CCCM_RAW.fuel_makers_cumul).flatMap(d=>Object.keys(d)))].filter(n => !n.startsWith('_'));
evNames   = [...new Set(Object.values(CCCM_RAW.ev_makers_cumul).flatMap(d=>Object.keys(d)))].filter(n => !n.startsWith('_'));
CCCM.fuel_makers = fuelNames;
CCCM.fuel_top10  = fuelNames.map(n => MONTHS.map(m => (CCCM_RAW.fuel_makers_monthly[m]||{})[n] ?? null));
CCCM.ev_makers   = evNames;
CCCM.ev_top10    = evNames.map(n => MONTHS.map(m => (CCCM_RAW.ev_makers_monthly[m]||{})[n] ?? null));
}
cccmDerive();

// ---- ECharts ヘルパー ----
const CCCM_EC = {};
function initCccmEC(id, fn) {
  if (!CCCM_EC[id]) {
    const dom = document.getElementById(id);
    if (!dom) return;
    CCCM_EC[id] = echarts.init(dom, null, {renderer:'svg'});
  }
  fn(CCCM_EC[id]);
}
function cccmBaseOpt() {
  const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
  const fg = isDark ? '#e0e0e0' : '#333';
  const gc = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
  return {
    backgroundColor:'transparent', textStyle:{color:fg,fontFamily:'inherit'},
    tooltip:{trigger:'axis', backgroundColor:isDark?'#1e1e1e':'#fff', borderColor:isDark?'#444':'#ddd', textStyle:{color:fg}},
    legend:{textStyle:{color:fg}, top:8},
    grid:{left:60,right:30,top:50,bottom:50,containLabel:true},
    xAxis:{type:'category',data:CCCM.labels,axisLine:{lineStyle:{color:fg}},
      axisLabel:{color:fg, formatter:(val,i)=>JP[i]||val},
      splitLine:{lineStyle:{color:gc}}},
    yAxis:{type:'value',axisLine:{lineStyle:{color:fg}},axisLabel:{color:fg},splitLine:{lineStyle:{color:gc}}},
  };
}
const CP=['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac'];
const cccmBarColor = v => v >= 0 ? '#59a14f' : '#e15759';

// ① 総合概要
function cccmInitOverview() {
  initCccmEC('cccm-ec-overview', chart => {
    const opt = cccmBaseOpt();
    opt.legend = {data:['合計販売','二輪車','輸出台数'], textStyle:{color:opt.textStyle.color}, top:8};
    opt.series = [
      {name:'合計販売',type:'bar',data:CCCM.total_sales,itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'#4e79a7'},{offset:1,color:'#2d5a87'}])},barMaxWidth:40},
      {name:'二輪車',type:'line',data:CCCM.bike_sales,symbol:'circle',symbolSize:6,lineStyle:{width:2,color:CP[1]},itemStyle:{color:CP[1]}},
      {name:'輸出台数',type:'line',data:CCCM.export_total,symbol:'diamond',symbolSize:7,lineStyle:{width:2,color:CP[2],type:'dashed'},itemStyle:{color:CP[2]}},
    ];
    opt.yAxis.name='万台';
    chart.setOption(opt);
  });
}

// ② 燃油車・EV内訳
function cccmInitFuelEv() {
  initCccmEC('cccm-ec-fuel-ev', chart => {
    const opt = cccmBaseOpt();
    opt.legend = {data:['燃油車','EV'], textStyle:{color:opt.textStyle.color}, top:8};
    opt.tooltip = unifiedStackTooltip({unit:'万台', note:'※電動摩托車のみ（街中のe-bikeは別統計）'});
    opt.series = [
      {name:'ガソリン車',type:'bar',stack:'total',data:CCCM.gas_sales,itemStyle:{color:'#f28e2b'},barMaxWidth:50},
      {name:'EV',type:'bar',stack:'total',data:CCCM.ev_sales,itemStyle:{color:'#4e79a7'},barMaxWidth:50},
    ];
    opt.yAxis.name='万台';
    opt.graphic=[{type:'text',left:'center',bottom:4,style:{text:'※電動摩托車のみ（街中のe-bikeは別統計）',fontSize:11,fill:'#999'}}];
    chart.setOption(opt);
  });
  initCccmEC('cccm-ec-gas-yoy', chart => {
    const opt = cccmBaseOpt();
    opt.grid={left:55,right:20,top:40,bottom:45,containLabel:true};
    opt.series=[{name:'燃油車 前年同月比',type:'bar',data:CCCM.gas_sales_yoy,itemStyle:{color:p=>cccmBarColor(p.value)},barMaxWidth:40}];
    opt.yAxis.name='%'; opt.legend.show=false; chart.setOption(opt);
  });
  initCccmEC('cccm-ec-ev-yoy', chart => {
    const opt = cccmBaseOpt();
    opt.grid={left:55,right:20,top:40,bottom:45,containLabel:true};
    opt.series=[{name:'EV 前年同月比',type:'bar',data:CCCM.ev_sales_yoy,itemStyle:{color:p=>cccmBarColor(p.value)},barMaxWidth:40}];
    opt.yAxis.name='%'; opt.legend.show=false; chart.setOption(opt);
  });
}

// ③ 二輪車型別
function cccmInitBikeType() {
  initCccmEC('cccm-ec-bike-type', chart => {
    const opt = cccmBaseOpt();
    opt.legend={data:['跨骑車（クロス）','踏板車（スクーター）','弯梁車（アンダーボーン）'], textStyle:{color:opt.textStyle.color}, top:8};
    opt.subtitle={text:'※2025年12月のみデータなし（収官号に車種別内訳の記載なし）', textStyle:{color:'#999',fontSize:11}, top:28};
    opt.grid.top=65;
    opt.tooltip = unifiedStackTooltip({unit:'万台'});
    opt.series=[
      {name:'跨骑車（クロス）',type:'bar',stack:'type',data:CCCM.cross_sales,itemStyle:{color:CP[0]},barMaxWidth:50},
      {name:'踏板車（スクーター）',type:'bar',stack:'type',data:CCCM.scooter_sales,itemStyle:{color:CP[1]},barMaxWidth:50},
      {name:'弯梁車（アンダーボーン）',type:'bar',stack:'type',data:CCCM.underbone_sales,itemStyle:{color:CP[2]},barMaxWidth:50},
    ];
    opt.yAxis.name='万台'; chart.setOption(opt);
  });
  initCccmEC('cccm-ec-bike-trike', chart => {
    const opt = cccmBaseOpt();
    opt.legend={data:['二輪車','三輪車（貨運）','三輪車（客運）'], textStyle:{color:opt.textStyle.color}, top:8};
    opt.subtitle={text:'※三輪内訳は4〜6月のみ', textStyle:{color:'#999',fontSize:11}, top:28};
    opt.grid.top=65;
    opt.series=[
      {name:'二輪車',type:'bar',data:CCCM.bike_sales,itemStyle:{color:CP[0]},barMaxWidth:35},
      {name:'三輪車（貨運）',type:'bar',data:CCCM.freight_trike,itemStyle:{color:CP[3]},barMaxWidth:35},
      {name:'三輪車（客運）',type:'bar',data:CCCM.passenger_trike,itemStyle:{color:CP[4]},barMaxWidth:35},
    ];
    opt.yAxis.name='万台'; chart.setOption(opt);
  });
  initCccmEC('cccm-ec-bike-trike-yoy', chart => {
    const opt = cccmBaseOpt();
    opt.legend={data:['二輪 前年同月比','三輪 前年同月比'], textStyle:{color:opt.textStyle.color}, top:8};
    opt.series=[
      {name:'二輪 前年同月比',type:'line',data:CCCM.bike_sales_yoy,symbol:'circle',symbolSize:6,lineStyle:{width:2,color:CP[0]},itemStyle:{color:CP[0]}},
      {name:'三輪 前年同月比',type:'line',data:CCCM.trike_sales_yoy,symbol:'triangle',symbolSize:6,lineStyle:{width:2,color:CP[3]},itemStyle:{color:CP[3]}},
    ];
    opt.yAxis.name='%'; chart.setOption(opt);
  });
}

// ④ 大排量
function cccmInitLarge() {
  initCccmEC('cccm-ec-large-sales', chart => {
    const opt = cccmBaseOpt(); opt.legend.show=false;
    opt.series=[{name:'大排気量 販売',type:'bar',data:CCCM.large_sales,
      itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'#b07aa1'},{offset:1,color:'#6d3d6f'}])},
      barMaxWidth:45,label:{show:false}}];
    opt.yAxis.name='万台'; chart.setOption(opt);
  });
  initCccmEC('cccm-ec-large-yoy', chart => {
    const opt = cccmBaseOpt(); opt.legend.show=false;
    opt.series=[{name:'大排気量 前年同月比',type:'bar',data:CCCM.large_sales_yoy,
      itemStyle:{color:p=>cccmBarColor(p.value)},barMaxWidth:45,
      label:{show:false}}];
    opt.yAxis.name='%'; chart.setOption(opt);
  });
}

// ⑤ 輸出・排気量別
function cccmInitExport() {
  initCccmEC('cccm-ec-export', chart => {
    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    const fg = isDark ? '#e0e0e0' : '#333';
    chart.setOption({
      backgroundColor:'transparent',textStyle:{color:fg,fontFamily:'inherit'},
      tooltip:{trigger:'axis',textStyle:{color:fg},formatter:params=>{
        let s=`<b>${params[0].axisValue}</b><br>`;
        params.forEach(p=>{const u=p.seriesName.includes('金額')?'億ドル':'万台';s+=`${p.marker}${p.seriesName}: <b>${p.value??'—'}</b> ${u}<br>`;});
        const m=MONTHS[params[0].dataIndex];
        const note=(CCCM_RAW.export[m]||{}).amount_note;
        if(note)s+=`<div style="color:#f28e2b;font-size:11px;margin-top:4px">⚠ ${note}</div>`;
        return s;
      }},
      legend:{data:['輸出台数','輸出金額'],textStyle:{color:fg},top:8},
      grid:{left:65,right:65,top:50,bottom:50,containLabel:true},
      xAxis:{type:'category',data:CCCM.labels,axisLabel:{color:fg,formatter:(v,i)=>JP[i]||v}},
      yAxis:[
        {type:'value',name:'万台',axisLabel:{color:fg},splitLine:{lineStyle:{color:isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.07)'}}},
        {type:'value',name:'億ドル',axisLabel:{color:fg},splitLine:{show:false}},
      ],
      series:[
        {name:'輸出台数',type:'bar',yAxisIndex:0,data:CCCM.export_total,itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'#76b7b2'},{offset:1,color:'#3d8a85'}])},barMaxWidth:45},
        {name:'輸出金額',type:'line',yAxisIndex:1,data:CCCM.export_amount,symbol:'circle',symbolSize:7,lineStyle:{width:2.5,color:'#edc948'},itemStyle:{color:'#edc948'}},
      ]
    });
  });
  initCccmEC('cccm-ec-export-yoy', chart => {
    const opt = cccmBaseOpt(); opt.legend.show=false;
    opt.series=[{name:'輸出 前年同月比',type:'bar',data:CCCM.export_yoy,
      itemStyle:{color:p=>cccmBarColor(p.value)},barMaxWidth:45,
      label:{show:false}}];
    opt.yAxis.name='%'; chart.setOption(opt);
  });
  initCccmEC('cccm-ec-cc-export', chart => {
    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    const fg = isDark ? '#e0e0e0' : '#333';
    const ccKeys = ['125cc','150cc','110cc','200cc','50cc','250cc','400cc'];
    chart.setOption({
      backgroundColor:'transparent',textStyle:{color:fg,fontFamily:'inherit'},
      tooltip: unifiedStackTooltip({unit:'万台'}),
      legend:{data:ccKeys,textStyle:{color:fg},top:8},
      subtitle:{text:'※7・8月は400ccが上位入り',textStyle:{color:'#999',fontSize:11},top:28},
      grid:{left:55,right:30,top:65,bottom:50,containLabel:true},
      xAxis:{type:'category',data:CCCM.cc_labels_full,axisLabel:{color:fg,formatter:(v,i)=>CCCM.cc_labels[i]||v}},
      yAxis:{type:'value',name:'万台',axisLabel:{color:fg}},
      series:ccKeys.map((cc,i)=>{return {name:cc,type:'bar',stack:'cc',data:CCCM.cc_data[cc],itemStyle:{color:CP[i%CP.length]},barMaxWidth:60};}),
    });
  });

  // 排気量別輸出 YoY%
  initCccmEC('cccm-ec-cc-yoy', chart => {
    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    const fg = isDark ? '#e0e0e0' : '#333';
    const gc = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
    const ccYoyMonths = Object.keys(CCCM_RAW.export_cc_yoy).sort();
    const ccYoyLabels = ccYoyMonths.map(m => parseInt(m.split('-')[1])+'月');
    const ccYoyKeys = ['125cc','150cc','110cc','200cc','50cc','250cc'];
    chart.setOption({
      backgroundColor:'transparent',textStyle:{color:fg,fontFamily:'inherit'},
      tooltip:{trigger:'axis',textStyle:{color:fg},formatter:params=>{
        let s=`<b>${params[0].axisValue}</b><br>`;
        params.forEach(p=>{if(p.value!=null)s+=`${p.marker}${p.seriesName}: <b>${p.value>0?'+':''}${p.value}%</b><br>`;});
        const note=(CCCM_RAW.export_cc_yoy[ccYoyMonths[params[0].dataIndex]]||{}).note||'';
        if(note)s+=`<i style="color:#999;font-size:11px">${note}</i>`;
        return s;
      }},
      legend:{data:ccYoyKeys,textStyle:{color:fg},top:8},
      grid:{left:60,right:30,top:50,bottom:50,containLabel:true},
      xAxis:{type:'category',data:ccYoyLabels,axisLabel:{color:fg}},
      yAxis:{type:'value',name:'%',axisLabel:{color:fg},splitLine:{lineStyle:{color:gc}}},
      series:ccYoyKeys.map((cc,i)=>({name:cc,type:'line',symbol:'circle',symbolSize:6,
        data:ccYoyMonths.map(m=>(CCCM_RAW.export_cc_yoy[m]||{})[cc]??null),
        lineStyle:{width:2,color:CP[i%CP.length]},itemStyle:{color:CP[i%CP.length]},connectNulls:false})),
    });
  });

  // 輸出企業 TOP10
  initCccmEC('cccm-ec-export-co', chart => {
    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    const fg = isDark ? '#e0e0e0' : '#333';
    const gc = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
    const coMonths = Object.keys(CCCM_RAW.export_companies).sort();
    // 横軸：年の変わり目だけ「'26/2」のように年を付ける
    const coLabels = coMonths.map((m, i) => {
      const [yr, mo] = m.split('-').map(Number);
      const prev = i > 0 ? Number(coMonths[i-1].split('-')[0]) : null;
      return (i === 0 || prev !== yr) ? `'${String(yr).slice(2)}/${mo}` : `${mo}月`;
    });
    // 2026年2月から CCCM の発表は「輸出金額の上位10社（億ドル）」に変わった。台数と金額は別の棒・別の軸にする
    const coUnit = m => { const d = CCCM_RAW.export_companies[m] || {}; return d.unit || (/金額|億ドル/.test(d.note || '') ? '億ドル' : '万台'); };
    const totals = coMonths.map(m => coUnit(m) === '万台' ? CCCM_RAW.export_companies[m].total : null);
    const amounts = coMonths.map(m => coUnit(m) === '億ドル' ? CCCM_RAW.export_companies[m].total : null);
    const shares = coMonths.map(m => CCCM_RAW.export_companies[m].share);
    chart.setOption({
      backgroundColor:'transparent',textStyle:{color:fg,fontFamily:'inherit'},
      tooltip:{trigger:'axis',textStyle:{color:fg},formatter:params=>{
        let s=`<b>${params[0].axisValue}</b><br>`;
        const m=coMonths[params[0].dataIndex];
        const d=CCCM_RAW.export_companies[m];
        params.forEach(p=>{if(p.value==null)return;const u=p.seriesName.includes('シェア')?'%':(p.seriesName.includes('金額')?'億ドル':'万台');s+=`${p.marker}${p.seriesName}: <b>${p.value}</b>${u}<br>`;});
        if(d.note)s+=`<span style="color:#999;font-size:11px">${d.note}</span><br>`;
        s+=`<span style="color:#999;font-size:11px">${d.companies.slice(0,5).join('・')}…</span>`;
        return s;
      }},
      legend:{data:['TOP10合計台数','TOP10合計金額','TOP10シェア'],textStyle:{color:fg},top:8,type:'scroll'},
      grid:{left:65,right:110,top:74,bottom:50,containLabel:true},
      xAxis:{type:'category',data:coLabels,axisLabel:{color:fg}},
      yAxis:[
        {type:'value',name:'万台',axisLabel:{color:fg},splitLine:{lineStyle:{color:gc}}},
        {type:'value',name:'%',axisLabel:{color:fg},splitLine:{show:false},min:55,max:70},
        {type:'value',name:'億ドル',position:'right',offset:48,axisLabel:{color:'#b07aa1'},nameTextStyle:{color:'#b07aa1'},splitLine:{show:false}},
      ],
      series:[
        {name:'TOP10合計台数',type:'bar',yAxisIndex:0,data:totals,itemStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:'#4e79a7'},{offset:1,color:'#2e5985'}])},barMaxWidth:50},
        {name:'TOP10合計金額',type:'bar',yAxisIndex:2,data:amounts,itemStyle:{color:'#b07aa1'},barMaxWidth:50,barGap:'-100%'},
        {name:'TOP10シェア',type:'line',yAxisIndex:1,data:shares,symbol:'circle',symbolSize:7,lineStyle:{width:2.5,color:'#edc948'},itemStyle:{color:'#edc948'}},
      ],
    });
  });

  // 完成車以外輸出内訳（ATV・エンジン・部品）
  initCccmEC('cccm-ec-sub-export', chart => {
    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    const fg = isDark ? '#e0e0e0' : '#333';
    const gc = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
    const seMonths = Object.keys(CCCM_RAW.sub_export).sort();
    const seLabels = seMonths.map(m => {
      const d=CCCM_RAW.sub_export[m]; return parseInt(m.split('-')[1])+'月'+(d.note?'('+d.note+')':'');
    });
    chart.setOption({
      backgroundColor:'transparent',textStyle:{color:fg,fontFamily:'inherit'},
      tooltip: unifiedStackTooltip({unit:'億ドル'}),
      legend:{data:['ATV(沙滩车)','エンジン','零部件(部品)'],textStyle:{color:fg},top:8},
      grid:{left:60,right:30,top:50,bottom:60,containLabel:true},
      xAxis:{type:'category',data:seLabels,axisLabel:{color:fg,rotate:10}},
      yAxis:{type:'value',name:'億ドル',axisLabel:{color:fg},splitLine:{lineStyle:{color:gc}}},
      series:[
        {name:'ATV(沙滩车)',type:'bar',stack:'sub',data:seMonths.map(m=>(CCCM_RAW.sub_export[m]||{}).atv_amount??null),itemStyle:{color:CP[1]},barMaxWidth:50},
        {name:'エンジン',type:'bar',stack:'sub',data:seMonths.map(m=>(CCCM_RAW.sub_export[m]||{}).engine_amount??null),itemStyle:{color:CP[0]},barMaxWidth:50},
        {name:'零部件(部品)',type:'bar',stack:'sub',data:seMonths.map(m=>(CCCM_RAW.sub_export[m]||{}).parts_amount??null),itemStyle:{color:CP[5]},barMaxWidth:50},
      ],
    });
  });
}

// ⑥ メーカー別
function cccmInitMakers() {
  const mkChart = (domId, names, top10) => {
    initCccmEC(domId, chart => {
      const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
      const fg = isDark ? '#e0e0e0' : '#333';
      chart.setOption({
        backgroundColor:'transparent',textStyle:{color:fg,fontFamily:'inherit'},
        tooltip:{trigger:'axis',textStyle:{color:fg}},
        legend:{data:names,textStyle:{color:fg},top:8,type:'scroll'},
        subtitle:{text:'※4月は逆算不可（1〜3月累計が基準のため）',textStyle:{color:'#999',fontSize:11},top:28},
        grid:{left:55,right:30,top:70,bottom:50,containLabel:true},
        xAxis:{type:'category',data:CCCM.labels,axisLabel:{color:fg,formatter:(v,i)=>JP[i]||v}},
        yAxis:{type:'value',name:'万台',axisLabel:{color:fg}},
        series:names.map((n,i)=>{return {name:n,type:'line',data:top10[i],symbol:'circle',symbolSize:5,lineStyle:{width:2,color:CP[i%CP.length]},itemStyle:{color:CP[i%CP.length]},connectNulls:false};})
      });
    });
  };
  mkChart('cccm-ec-fuel-makers', CCCM.fuel_makers, CCCM.fuel_top10);
  mkChart('cccm-ec-ev-makers',   CCCM.ev_makers,   CCCM.ev_top10);
}

// ⑦ 期末残高
function cccmInitBalance() {
  initCccmEC('cccm-ec-balance', chart => {
    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    const fg = isDark ? '#e0e0e0' : '#333';
    chart.setOption({
      backgroundColor:'transparent',textStyle:{color:fg,fontFamily:'inherit'},
      tooltip:{trigger:'axis',textStyle:{color:fg}},
      legend:{data:['売掛金','製品在庫'],textStyle:{color:fg},top:8},
      grid:{left:60,right:30,top:50,bottom:50,containLabel:true},
      xAxis:{type:'category',data:CCCM.labels,axisLabel:{color:fg,formatter:(v,i)=>JP[i]||v}},
      yAxis:{type:'value',name:'億元',axisLabel:{color:fg}},
      series:[
        {name:'売掛金',type:'line',data:CCCM.receivable,symbol:'circle',symbolSize:6,connectNulls:true,lineStyle:{width:2,color:CP[0]},itemStyle:{color:CP[0]}},
        {name:'製品在庫',type:'line',data:CCCM.inventory,symbol:'square',symbolSize:6,connectNulls:true,lineStyle:{width:2,color:CP[1]},itemStyle:{color:CP[1]}},
      ]
    });
  });
  initCccmEC('cccm-ec-balance-yoy', chart => {
    const opt = cccmBaseOpt();
    opt.legend={data:['売掛金 前年同月比','製品在庫 前年同月比'],textStyle:{color:opt.textStyle.color},top:8};
    opt.series=[
      {name:'売掛金 前年同月比',type:'line',data:CCCM.receivable_yoy,symbol:'circle',symbolSize:6,lineStyle:{width:2,color:CP[0]},itemStyle:{color:CP[0]}},
      {name:'製品在庫 前年同月比',type:'line',data:CCCM.inventory_yoy,symbol:'square',symbolSize:6,lineStyle:{width:2,color:CP[1]},itemStyle:{color:CP[1]}},
    ];
    opt.yAxis.name='%'; chart.setOption(opt);
  });
}

// ⑧ 経済効益（単月逆算）
function cccmInitEcon() {
  initCccmEC('cccm-ec-econ', chart => {
    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    const fg = isDark ? '#e0e0e0' : '#333';
    const gc = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
    const revColors = CCCM.econ_labels.map((_,i) => i===0 ? 'rgba(78,121,167,0.4)' : CP[0]);
    const profColors = CCCM.econ_labels.map((_,i) => i===0 ? 'rgba(242,142,43,0.4)' : CP[1]);
    chart.setOption({
      backgroundColor:'transparent',textStyle:{color:fg,fontFamily:'inherit'},
      tooltip:{trigger:'axis',textStyle:{color:fg},
        formatter: params => {
          const idx = params[0].dataIndex;
          const note = CCCM.econ_note[idx];
          let s = `<b>${CCCM.econ_labels_full[idx]}</b>${note==='1〜3月合計'?' <span style="color:#f28e2b">（1〜3月合計）</span>':''}<br>`;
          params.forEach(p => s += `${p.marker}${p.seriesName}: <b>${p.value != null ? p.value.toFixed(2) : '-'}</b> 億元<br>`);
          return s;
        }
      },
      legend:{data:['営業収入','利益総額'],textStyle:{color:fg},top:8},
      subtitle:{text:'※2月は1-2月累計、3月は1Q合計（薄色） / その他は累計差し引き単月逆算',textStyle:{color:'#999',fontSize:11},top:28},
      grid:{left:65,right:65,top:70,bottom:50,containLabel:true},
      xAxis:{type:'category',data:CCCM.econ_labels,axisLabel:{color:fg,rotate:15}},
      yAxis:[
        {type:'value',name:'億元（収入）',axisLabel:{color:fg},splitLine:{lineStyle:{color:gc}}},
        {type:'value',name:'億元（利益）',axisLabel:{color:fg},splitLine:{show:false}},
      ],
      series:[
        {name:'営業収入（単月）',type:'bar',yAxisIndex:0,data:CCCM.econ_revenue,
          itemStyle:{color:(p)=>revColors[p.dataIndex]},barMaxWidth:40},
        {name:'利益総額（単月）',type:'line',yAxisIndex:1,data:CCCM.econ_profit,
          symbol:'circle',symbolSize:7,lineStyle:{width:2.5,color:CP[1]},
          itemStyle:{color:(p)=>profColors[p.dataIndex]}},
      ]
    });
  });
  initCccmEC('cccm-ec-profit-yoy', chart => {
    const opt = cccmBaseOpt();
    opt.xAxis.data = CCCM.econ_labels;
    opt.legend.show = false;
    opt.subtitle = {text:'※利益率（利益÷営業収入）を表示', textStyle:{color:'#999',fontSize:11}, top:28};
    opt.grid.top = 65;
    opt.series=[{
      name:'利益率',type:'bar',data:CCCM.econ_margin,
      itemStyle:{color:(p)=>p.dataIndex===0?'rgba(89,161,79,0.4)':CP[4]},barMaxWidth:40,
      label:{show:false}
    }];
    opt.yAxis.name='%'; chart.setOption(opt);
  });
  initCccmEC('cccm-ec-margin', chart => {
    const opt = cccmBaseOpt();
    opt.xAxis.data = CCCM.econ_labels;
    opt.legend = {data:['営業コスト','販売費用','管理費用','研究開発費用'], textStyle:{color:opt.textStyle.color}, top:8};
    opt.subtitle = {text:'※コスト構造（億元）/ 1〜3月合計は薄色', textStyle:{color:'#999',fontSize:11}, top:28};
    opt.grid.top = 65;
    opt.series=[
      {name:'営業コスト',type:'bar',data:CCCM.econ_cost,itemStyle:{color:p=>p.dataIndex===0?'rgba(225,87,89,0.35)':CP[2]},barMaxWidth:40},
      {name:'販売費用',type:'line',data:CCCM.econ_selling,symbol:'circle',symbolSize:5,lineStyle:{width:1.5,color:CP[1]},itemStyle:{color:CP[1]}},
      {name:'管理費用',type:'line',data:CCCM.econ_admin,symbol:'square',symbolSize:5,lineStyle:{width:1.5,color:CP[3]},itemStyle:{color:CP[3]}},
      {name:'研究開発費用',type:'line',data:CCCM.econ_rd,symbol:'diamond',symbolSize:5,lineStyle:{width:1.5,color:CP[4]},itemStyle:{color:CP[4]}},
    ];
    opt.yAxis.name='億元'; chart.setOption(opt);
  });
}

// ====== CCCM 月次総論（公式レポート要約・日本語） ======
const CCCM_COMMENTARY = {
  '2024-01': { source:'CCCM（2024年1月号）', paragraphs:[
    '1月、オートバイの生産・販売台数は前年同月比で大きく増加した。ガソリン車の国内市場が明確に持ち直し、輸出が大幅増となり、単月輸出量は近年の最高水準に達した。国内外市場の全体的な回復が、2024年の産業の持続的発展に向けた良好なスタートとなった。',
    '生産・販売：1月のオートバイは生産151.73万台・販売151.56万台（前月比+4.79%／+9.04%、前年同月比+54.06%／+43.78%、前年の春節時期による低い基準の反動を含む）。ガソリン車は生産129.03万・販売129.67万台（前年同月比+66.58%／+56.45%）、電動二輪車は生産22.7万・販売21.88万台（生産は前年同月比+7.92%、販売は-2.84%）。大排気量（250cc超）は生産3.92万・販売3.86万台（同+70.43%／+55.69%）。',
    '輸出：1月の輸出は87.11万台（前月比+16.13%、前年同月比+95.3%）、金額5.76億ドル（同+80.89%）と単月輸出量が近年の最高水準。',
    '経済指標（2023年通年・1-12月）：売上高1283.72億元（-1.65%）、利益総額80.28億元（+15.24%）、利益・税金総額107.82億元（+11.18%）。'
  ]},
  '2024-02': { source:'CCCM（2024年1-2月号）', paragraphs:[
    '2月は春節（旧正月）の影響で生産・販売が前月比・前年同月比とも減少した。1-2月でみると、輸出の牽引によりガソリン車の販売は明確な増加を維持したが、電動二輪車は大幅に減少。輸出は良好な発展態勢を継続し、1-2月累計の輸出量は同期として過去最高を記録した。国内市場全体の需要は明らかに減速したものの、一部のレジャー用大排気量車の販売は比較的明確な増加を示した。',
    '生産・販売：2月のオートバイは生産87.10万台・販売92.13万台（前月比-42.63%／-39.24%、前年同月比-51.43%／-47.08%）。電動二輪車は2月に前年同月比-83.89%／-83.04%と急減。1-2月累計は生産238.92万台・販売243.77万台（前年同期比-14.01%／-12.78%）。うちガソリン車は+13.4%／+13.74%、電動二輪車は-64.21%／-64.08%、大排気量は+5.73%／+10.31%。',
    '輸出：2月の輸出は51.52万台（前月比-40.91%、前年同月比+5.02%）、金額3.43億ドル（同-2.15%）。1-2月の製品輸出総額は11.43億ドル（前年同期比+31.8%）、累計輸出量は同期として過去最高。'
  ]},
  '2024-03': { source:'CCCM（2024年1-3月／第1四半期号）', paragraphs:[
    '3月は生産・販売が前月比で増加、前年同月比では減少した。第1四半期では輸出の牽引によりガソリン車が明確に増加、国内市場はある程度持ち直し、内需の減少幅が縮小、輸出は高い伸びを継続し、産業全体は好転傾向を保っている。',
    '生産・販売：3月のオートバイは生産172.65万台・販売167.3万台（前月比+92.98%／+77.08%、前年同月比-20.66%／-17.5%）。ガソリン車は生産138.57万・販売133.82万台（前年同月比+5.34%／+1.73%）、電動二輪車は生産34.08万・販売33.48万台（同-60.4%／-53.01%）。第1四半期累計は生産417.74万台・販売418.23万台（前年同期比-16.34%／-13.97%）、大排気量は+10.87%／+5.87%。1-3月の車種別販売比率はオートバイ型55.46%・スクーター34.29%・カブ型10.25%。',
    '輸出：3月の輸出は84.1万台（前月比+56.51%、前年同月比+18.06%）、金額5.34億ドル（同+11.41%）。第1四半期の製品輸出総額は18.77億ドル（前年同期比+24.03%）。',
    '経済指標（1-2月）：売上高175.01億元（+0.66%）、利益総額7.46億元（+26.88%）、利益・税金総額12.12億元（+22.01%）。なお当月より江門市珠峰が統計対象に追加され、過去データと差異が生じている。'
  ]},
  '2024-04': { source:'CCCM（2024年4月号）', paragraphs:[
    '4月は生産・販売が前月比・前年同月比とも増加し、輸出が大幅増を維持、内需は前月とほぼ横ばいで前年同月比の減少幅が縮小した。1-4月は輸出の牽引でガソリン車が明確に増加、国内市場の回復が加速し、内需の減少幅が縮小、産業は堅調な好転傾向を継続している。',
    '生産・販売：4月のオートバイは生産176.26万台・販売175.41万台（前月比+2.01%／+4.85%、前年同月比+2.36%／+6.75%）。ガソリン車は生産146.43万・販売143.98万台（同+13.84%／+11.08%）、電動二輪車は生産29.83万・販売31.43万台（同-31.54%／-9.42%）。大排気量は生産7.14万・販売7.26万台（同+53.55%／+34.44%）。1-4月累計は生産594.15万台・販売593.65万台（前年同期比-11.52%／-8.73%）、大排気量は+23.01%／+15.26%。',
    '輸出：4月の輸出は92.27万台（前月比+9.52%、前年同月比+25.36%）、金額5.8億ドル（同+17.07%）。1-4月の製品輸出総額は25.88億ドル（前年同期比+21.17%）。',
    '経済指標（1-3月）：売上高287.92億元（-4.04%）、利益総額13.86億元（+8.33%）、利益・税金総額20.79億元（+2.23%）。'
  ]},
  '2024-05': { source:'CCCM（2024年5月号）', paragraphs:[
    '5月は生産・販売が前月比・前年同月比とも小幅に増加、輸出が高い伸びを継続し、内需は前月並みで推移した。1-5月は輸出の牽引でガソリン車が明確に増加、製品構造の最適化が進み、250cc超のレジャー用大排気量車が明確に増加、産業は持続的に好転している。',
    '生産・販売：5月のオートバイは生産176.84万台・販売177.94万台（前月比+0.31%／+1.41%、前年同月比+3.82%／+8.68%）。ガソリン車は生産146.13万・販売144.81万台（同+11.58%／+9.82%）、電動二輪車は生産30.72万・販売33.13万台（生産は前年同月比-22%、販売は+3.98%）。大排気量は生産7.97万・販売7.72万台（同+57.51%／+57.55%）。1-5月累計は生産771.03万台・販売771.63万台（前年同期比-8.41%／-5.22%）、大排気量は+31.61%／+25.07%。',
    '輸出：5月の輸出は94.32万台（前月比+2.22%、前年同月比+20.44%）、金額6.2億ドル（同+14.74%）。1-5月の製品輸出総額は33.69億ドル（前年同期比+20.84%）。',
    '経済指標（1-4月）：売上高409.30億元（-1.63%）、利益総額24.90億元（-28.76%）、利益・税金総額36.05億元（-19.47%）。'
  ]},
  '2024-06': { source:'CCCM（2024年6月号）', paragraphs:[
    '6月は生産・販売が前月比・前年同月比とも小幅増、輸出が高い伸びを継続し、内需の減少幅が引き続き縮小、大排気量車が高い伸びを持続した。1-6月は輸出の牽引でガソリン車が明確に増加、製品構造の最適化が進み、レジャー用大排気量車の伸びが加速、産業の好転傾向が一段と鮮明になっている。',
    '生産・販売：6月のオートバイは生産178.13万台・販売180.02万台（前月比+0.73%／+1.17%、前年同月比+5.58%／+8.58%）。ガソリン車は生産148.37万・販売149万台（同+10.06%／+11.33%）、電動二輪車は生産29.76万・販売31.02万台（同-12.23%／-2.91%）。大排気量は生産8.75万・販売9.01万台（同+86.57%／+97.16%）。1-6月累計は生産949.16万台・販売951.65万台（前年同期比-6.07%／-2.89%）、大排気量は+41.93%／+37.84%。',
    '輸出：6月の輸出は99.06万台（前月比+5.03%、前年同月比+19.41%）、金額6.3億ドル（同+14.02%）。1-6月の製品輸出総額は41.82億ドル（前年同期比+20.76%）。',
    '経済指標（1-5月）：売上高540.62億元（+1.32%）、利益総額33.50億元（-29.13%）、利益・税金総額45.98億元（-22.96%）。'
  ]},
  '2024-07': { source:'CCCM（2024年7月号）', paragraphs:[
    '7月は生産・販売が前年同月比で明確に増加、前月比では生産が増・販売が微減、輸出が高い伸びを継続し、内需はおおむね安定した。1-7月は輸出の高い伸びに牽引されガソリン車が明確に増加、内需の減少幅がさらに縮小、レジャー用大排気量車が高成長を維持、製品構造の最適化が進み、産業は堅調な好転態勢を保っている。',
    '生産・販売：7月のオートバイは生産182.98万台・販売183.09万台（前月比+2.72%／+1.71%、前年同月比+7.05%／+9.85%）。ガソリン車は生産150.47万・販売148.56万台（同+14.6%／+14.72%）、電動二輪車は生産32.5万・販売34.54万台（同-17.98%／-7.12%）。大排気量は生産8.32万・販売7.26万台（同+52.94%／+34.94%）。1-7月累計は生産1132.13万台・販売1134.75万台（前年同期比-4.18%／-1.04%）、大排気量は+43.94%／+37.34%。',
    '輸出：7月の輸出は101.11万台（前月比+2.07%、前年同月比+28.45%）、金額6.05億ドル（同+16.72%）。1-7月の製品輸出総額は49.24億ドル（前年同期比+20.23%）。',
    '経済指標（1-6月）：売上高674.50億元（+3.27%）、利益総額46.36億元（-17.84%）、利益・税金総額61.89億元（-12.43%）。'
  ]},
  '2024-08': { source:'CCCM（2024年8月号）', paragraphs:[
    '8月は生産・販売が前年同月比・前月比とも減少したが、輸出は増加を継続、内需は依然として回復段階にあり、レジャー用大排気量車は比較的高い伸びを維持した。1-8月は輸出の牽引でガソリン車が明確に増加、製品構造の最適化が進み、産業運営は安定を保っている。',
    '生産・販売：8月のオートバイは生産176.95万台・販売174.1万台（前月比-3.29%／-4.97%、前年同月比-0.15%／-0.92%）。ガソリン車は生産142.99万・販売139.55万台（同+7.22%／+5.69%）、電動二輪車は生産33.96万・販売34.56万台（同-22.55%／-20.91%）。大排気量は生産7.13万・販売6.83万台（同+41.19%／+43.19%）。1-8月累計は生産1309.05万台・販売1308.96万台（前年同期比-3.65%／-1.01%）、大排気量は+43.52%／+38.15%。',
    '輸出：8月の輸出は93.14万台（前月比-8.17%、前年同月比+15.16%）、金額5.78億ドル（同+15.74%）。1-8月の製品輸出総額は56.56億ドル（前年同期比+19.95%）。',
    '経済指標（1-7月）：売上高800.70億元（+4.43%）、利益総額53.25億元（-14.91%）、利益・税金総額71.25億元（-10.67%）。'
  ]},
  '2024-09': { source:'CCCM（2024年9月号）', paragraphs:[
    '9月は生産・販売が前年同月比・前月比とも増加し、輸出が増加を継続、内需は前月比で明確に増加、レジャー用大排気量車が高成長を維持した。当月の単月輸出量は今年に入って最高水準となった。1-9月は輸出の牽引でガソリン車が明確に増加、製品構造の最適化が進み、産業は堅調に好転している。',
    '生産・販売：9月のオートバイは生産180.28万台・販売185.47万台（前月比+1.88%／+6.53%、前年同月比+3.02%／+5.98%）。ガソリン車は生産146.07万・販売150.53万台（同+17.74%／+19.5%）、電動二輪車は生産34.21万・販売34.94万台（同-32.82%／-28.74%）。大排気量は生産7.5万・販売7.66万台（同+67.04%／+51.68%）。1-9月累計は生産1489.33万台・販売1494.43万台（前年同期比-2.89%／-0.19%）、大排気量は+46.17%／+39.82%。',
    '輸出：9月の単月輸出量は今年最高水準を記録。1-9月の完成車輸出は811.5万台（前年同期比+27.19%）、金額51.2億ドル（+20.83%）と、年間で過去最高更新が期待される水準。',
    '経済指標（1-8月）：売上高925.84億元（+5.47%）、利益総額59.97億元（-13.14%）、利益・税金総額80.59億元（-9.32%）。'
  ]},
  '2024-10': { source:'CCCM（2024年10月号）', paragraphs:[
    '10月は生産・販売が前月比で明確に減少、前年同月比では増加を維持し、輸出は増加傾向を継続、内需は前月比の減少幅が比較的大きく、大排気量車は高成長を保った。1-10月は輸出の牽引でガソリン車が明確に増加、製品構造の最適化が進み、産業発展は安定して好転している。',
    '生産・販売：10月のオートバイは生産160.02万台・販売157.58万台（前月比-11.24%／-15.04%、前年同月比+6.07%／+3.53%）。ガソリン車は生産133.61万・販売131.67万台（同+16.77%／+12.24%）、電動二輪車は生産26.41万・販売25.91万台（同-27.52%／-25.73%）。大排気量は生産5.91万・販売6.1万台（同+41.05%／+40.88%）。1-10月累計は生産1649.09万台・販売1652万台（生産は前年同期比-2.1%、販売は+0.15%）、大排気量は+45.68%／+39.95%。',
    '輸出：1-10月の製品輸出総額は71.35億ドル（前年同期比+22.15%）、完成車輸出900.17万台（+26.62%、金額56.77億ドル+21.68%）。輸出は高水準での運行を継続。',
    '経済指標（1-9月）：売上高1050.93億元（+5.91%）、利益総額63.59億元（-17.9%）、利益・税金総額86.49億元（-13.51%）。'
  ]},
  '2024-11': { source:'CCCM（2024年11月号）', paragraphs:[
    '11月は生産・販売が前月比・前年同月比とも明確に増加し、輸出が増加傾向を継続、内需も前月比・前年同月比とも増加、レジャー用大排気量車が高成長を維持した。1-11月は輸出の力強い伸びに牽引されガソリン車市場が明確な上昇傾向を保ち、製品構造の最適化とともに産業は安定発展しつつ一段と好転している。',
    '生産・販売：11月のオートバイは生産166.26万台・販売164.7万台（前月比+3.81%／+4.52%、前年同月比+12.71%／+13.95%）。ガソリン車は生産139.52万・販売137.79万台（同+15.41%／+14.86%）、電動二輪車は生産26.75万・販売26.91万台（同+0.43%／+9.46%）。大排気量は生産6.25万・販売5.48万台（同+58.23%／+41.23%）。1-11月累計は生産1815.49万台・販売1816.45万台（生産は前年同期比-0.9%、販売は+1.25%）、大排気量は+46.72%／+40.04%。',
    '輸出：11月の輸出は95.19万台（前月比+6.57%、前年同月比+20.47%）、金額6.04億ドル（同+25.73%）。1-11月の製品輸出総額は79.32億ドル（前年同期比+23.36%）。',
    '経済指標（1-10月）：売上高1185.43億元（+8.25%）、利益総額71.96億元（-15.23%）、利益・税金総額97.21億元（-13.03%）。'
  ]},
  '2024-12': { source:'CCCM（2024年12月号）', paragraphs:[
    '12月は生産・販売の両面が前月比・前年同月比とも増加し、輸出量が再び過去最高を更新した。2024年通年は生産・販売がともに小幅増を実現、輸出は持続的に上昇し過去最高を更新した。レジャー用大排気量車は需要が旺盛で大幅増を維持する一方、電動二輪車は明確に減少。産業構造の最適化が顕著に進み、高品質発展への転換と継続的な高度化・革新により、強い発展の底堅さと潜在力を示した。',
    '生産・販売（通年）：2024年通年のオートバイは生産1997.08万台・販売1992.28万台（前年比+0.79%／+2.82%）。ガソリン車は+13.86%／+12.99%、電動二輪車は-35.32%／-27.96%（統計区分の見直しが影響）。大排気量（250cc超）は+49.67%／+42.97%、三輪車は+6.49%／+6.78%。12月単月は生産181.54万台・販売175.82万台（前年同月比+21.48%／+22.45%）。',
    '輸出（通年）：1-12月の製品輸出総額は88.31億ドル（+25.15%）、完成車輸出1101.63万台（+26.72%、金額69.81億ドル+23.8%）。12月単月輸出は105.35万台（前年同月比+32.61%）、金額7億ドル（+41.9%）。',
    '経済指標（1-11月）：売上高1294.08億元（+7.83%）、利益総額82.61億元（-2.64%）、利益・税金総額109.37億元（-0.88%）。'
  ]},
  '2025-01': { source:'CCCM（2025年1月号）', paragraphs:[
    '1月、オートバイ産業は全体として良好に推移し、生産・販売が前年同月比で小幅に増加、輸出は高水準での運行を維持した。レジャー用大排気量車は需要が旺盛で高い伸びを保ち、電動二輪車の生産・販売はやや減少した。',
    '生産・販売：1月のオートバイは生産157.19万台・販売159.75万台（前月比-10.56%／-9.14%、前年同月比+1.0%／+2.1%）。ガソリン車は生産136.48万・販売138.3万台（同+2.68%／+2.77%）、電動二輪車は生産20.71万・販売21.44万台（同-8.78%／-2.0%）。大排気量（250cc超）は生産6.44万・販売5.9万台（同+63.87%／+52.85%）と急伸。',
    '輸出：1月の輸出は104.04万台（前月比-1.25%、前年同月比+13.56%）、金額6.59億ドル（同+11.13%）。',
    '経済指標（2024年通年・1-12月）：売上高1430.71億元（+9.72%）、利益総額92.31億元（+13.02%）、利益・税金総額121.68億元（+11.09%）。'
  ]},
  '2025-02': { source:'CCCM（2025年1-2月号）', paragraphs:[
    '2025年の最初の2ヶ月でオートバイ産業は好スタートを切り、生産・販売が前年同月比で揃って増加、大排気量車の販売が伸び、輸出も増加基調を継続した。1-2月は産業の構造最適化が進み、転換・高度化で顕著な成果が出ている。',
    '生産・販売：2月のオートバイは生産132.7万台・販売135.91万台（前月比-16.29%／-15.91%、前年同月比+48.33%／+43.86%）。電動二輪車は2月に前年同月比+100.82%／+96.6%と急増（前年の春節時期のずれによる反動増）。1-2月累計は生産291.22万台・販売297.54万台（前年同期比+18.82%／+18.57%）。大排気量は1-2月で+89.22%／+84.94%。',
    '輸出：2月の輸出は75.98万台（前月比-27.42%、前年同月比+41.39%）、金額5.14億ドル（同+45.98%）。1-2月の製品輸出総額は14.6億ドル（前年同期比+24.88%）。'
  ]},
  '2025-03': { source:'CCCM（2025年1-3月／第1四半期号）', paragraphs:[
    '3月は生産・販売が前月比・前年同月比とも着実に増加し、輸出が力強い伸びを継続した。第1四半期全体でも生産・販売の増加が顕著で、国内ではガソリン車の内需が小幅減、250cc超の大排気量車が急速に拡大、電動二輪車の回復が比較的明確となった。輸出は前年の高い伸びを引き継ぎ、輸出構造の最適化が進んでいる。',
    '生産・販売：3月のオートバイは生産196.07万台・販売192.16万台（前月比+47.75%／+41.38%、前年同月比+13.47%／+14.86%）。ガソリン車は生産160.64万・販売157.76万台（同+15.81%／+17.89%）、電動二輪車は生産35.43万・販売34.4万台（同+3.95%／+2.73%）。第1四半期累計は生産487.29万台・販売489.7万台（前年同期比+16.61%／+17.09%）、大排気量は+82.12%／+77.23%。1-3月の車種別販売比率はオートバイ型59.26%・スクーター29.65%・カブ型11.08%。',
    '輸出：3月の輸出は109.78万台（前月比+42.44%、前年同月比+30.3%）、金額11.68億ドル（同+118.42%）。第1四半期の製品輸出総額は28.06億ドル（前年同期比+51.27%）。',
    '経済指標（1-2月）：売上高211.76億元（+20.14%）、利益総額10.08億元（+36.6%）、利益・税金総額18.49億元（+55.79%）。'
  ]},
  '2025-04': { source:'CCCM（2025年4月号）', paragraphs:[
    '4月はオートバイ市場が良好な勢いを継続し、生産・販売が前月比・前年同月比とも増加、輸出の伸びがとりわけ顕著だった。1-4月はレジャー用大排気量車が高成長を持続。国内ではガソリン車の内需が小幅減、電動二輪車は増加を維持。全体として工業は堅調に推移している。',
    '生産・販売：4月のオートバイは生産202.54万台・販売198.12万台（前月比+3.3%／+3.1%、前年同月比+14.89%／+12.91%）。ガソリン車は生産174.83万・販売171.51万台（同+19.36%／+19.08%）、電動二輪車は生産27.71万・販売26.6万台（同-7.1%／-15.36%）。大排気量は生産9.7万・販売9.3万台（同+35.85%／+27.75%）。1-4月累計は生産689.83万台・販売687.81万台（前年同期比+16.1%／+15.85%）。',
    '輸出：4月の輸出は120.09万台（前月比+9.39%、前年同月比+30.15%）。1-4月の製品輸出総額は33.36億ドル（前年同期比+28.88%）、完成車輸出412.83万台（+28.33%）。',
    '経済指標（1-3月）：売上高347.60億元（+21.22%）、利益総額19.63億元（+41.08%）、利益・税金総額30.20億元（+44.92%）。'
  ]},
  '2025-05': { source:'CCCM（2025年5月号）', paragraphs:[
    '5月は生産・販売が前月比で減少、前年同月比では増加し、輸出規模は前月比で小幅に下落したものの前年同月比では高い伸びを維持した。1-5月はレジャー用大排気量車が高成長を継続。国内ではガソリン車の内需が小幅減、電動二輪車はわずかに増加し、業界全体は堅調に推移している。',
    '生産・販売：5月のオートバイは生産184.76万台・販売187.63万台（前月比-8.78%／-5.29%、前年同月比+4.47%／+5.45%）。ガソリン車は生産158.61万・販売160.91万台（同+8.54%／+11.12%）、電動二輪車は生産26.15万・販売26.72万台（同-14.88%／-19.33%）。大排気量は生産10.05万・販売10.12万台（同+26.1%／+31.09%）。1-5月累計は生産874.59万台・販売875.44万台（前年同期比+13.43%／+13.45%）、大排気量は+52.83%／+50.34%。',
    '輸出：5月の輸出は115.21万台（前月比-4.07%、前年同月比+22.15%）、金額7.71億ドル（同+24.43%）。1-5月の製品輸出総額は42.84億ドル（前年同期比+27.16%）。',
    '経済指標（1-4月）：売上高495.57億元（+20.81%）、利益総額30.74億元（+23.47%）、利益・税金総額45.10億元（+25.38%）。'
  ]},
  '2025-06': { source:'CCCM（2025年6月号）', paragraphs:[
    '6月は生産・販売が前月比・前年同月比とも増加し、輸出も増加基調を継続した。上半期（1-6月）全体では輸出の伸びが明確な牽引役となり、国内市場は次第に底固めへ。とりわけ250cc超の大排気量レジャー車が高成長を持続している。',
    '生産・販売：6月のオートバイは生産186.66万台・販売185.86万台（前月比+1.0%／-0.97%、前年同月比+4.79%／+3.24%）。ガソリン車は生産161.47万・販売161.83万台（同+8.83%／+8.61%）、電動二輪車は生産25.18万・販売24.03万台（同-15.37%／-22.53%）。大排気量は生産10.05万・販売10.12万台（同+20.11%／+14.32%）。1-6月累計は生産1061.41万台・販売1061.46万台（前年同期比+11.83%／+11.54%）、大排気量は+44.74%／+41.21%。',
    '輸出：6月の輸出は118.07万台（前月比+2.49%、前年同月比+19.18%）、金額8.12億ドル（同+28.78%）。1-6月の製品輸出総額は52.99億ドル（前年同期比+26.71%）。',
    '経済指標（1-5月）：売上高635.54億元（+18.41%）、利益総額49.24億元（+40.79%）、利益・税金総額66.85億元（+40.85%）。'
  ]},
  '2025-07': { source:'CCCM（2025年7月号）', paragraphs:[
    '7月は生産・販売が前月比でほぼ横ばい、前年同月比では増加し、輸出は前月比で小幅減ながら前年同月比では増加基調を維持した。1-7月でみると、レジャー用大排気量車が成長を持続し、輸出が明確な増加を保つ一方、国内市場は次第に安定し好転に向かっている。',
    '生産・販売：7月のオートバイは生産187.10万台・販売187.79万台（生産は前月比-0.01%／販売は前月比+0.85%、前年同月比+2.25%／+2.51%）。ガソリン車は生産158.47万・販売159.83万台（同+5.32%／+7.51%）、電動二輪車は生産28.63万・販売27.96万台（前月比+13.68%／+16.35%、前年同月比-11.92%／-19.04%）。大排気量は生産9.11万・販売8.83万台（前年同月比+9.43%／+21.66%）。1-7月累計は生産1249.32万台・販売1249.93万台（前年同期比+10.35%／+10.14%）、大排気量は+37.98%／+37.89%。',
    '輸出：7月の輸出は114.71万台（前月比-3.14%、前年同月比+13.08%）、金額7.67億ドル（同+26.38%）。1-7月の製品輸出総額は62.66億ドル（前年同期比+27.2%）。',
    '経済指標（1-6月）：売上高777.43億元（+15.28%）、利益総額59.17億元（+27.65%）、利益・税金総額79.56億元（+26.79%）。'
  ]},
  '2025-08': { source:'CCCM（2025年8月号）', paragraphs:[
    '8月は生産が前月比で小幅増、販売が前月比で小幅減となり、生産・販売とも前年同月比では小幅な増加となった。輸出が底堅い伸びを維持し、当月の市場の安定を支えた。1-8月累計では業界全体が底堅く推移し、レジャー用大排気量車が消費を牽引する重要な成長分野となったほか、輸出が業界全体の安定した発展を後押しした。',
    '生産・販売：8月のオートバイは生産188.06万台・販売184.88万台（生産は前月比+0.51%／販売は前月比-1.55%、前年同月比+6.28%／+6.19%）。ガソリン車は生産159.06万・販売156.35万台（前年同月比+11.24%／+12.04%）、電動二輪車は生産29.0万・販売28.53万台（同-14.6%／-17.44%）と二極化。大排気量（250cc超）は生産8.43万・販売8.45万台（同+18.3%／+23.6%）と高い伸びを持続。',
    '輸出：8月の輸出は112.42万台（前月比-1.99%、前年同月比+20.69%）、金額7.59億ドル（同+31.24%）。1-8月の製品輸出総額は71.62億ドル（前年同期比+26.61%）、完成車輸出874.11万台（+23.17%）。',
    '経済指標（1-7月）：売上高931.37億元（+15.85%）、利益総額72.02億元（+35.14%）、営業コスト783.65億元（+13.47%）。'
  ]},
  '2025-09': { source:'CCCM（2025年9月号）', paragraphs:[
    '9月は生産・販売とも前月比・前年同月比で増加し、輸出が高い伸びを継続した。1-9月ではレジャー用大排気量車が高成長を持続し、輸出の伸びが業界全体を明確に牽引した。',
    '生産・販売：9月のオートバイは生産199.23万台・販売198.82万台（前月比+5.94%／+7.54%、前年同月比+10.51%／+7.19%）。電動二輪車は生産32.57万・販売30.62万台（前月比+12.32%／+7.32%）と前月比は回復も前年同月比は-4.79%／-12.38%。大排気量は生産8.31万・販売8.66万台（前年同月比+10.8%／+13.05%）。',
    '輸出：9月の輸出は122.67万台（前月比+9.14%、前年同月比+20.16%）、金額8億ドル（同+27.45%）。1-9月の製品輸出総額は81.36億ドル（前年同期比+26.42%）。',
    '経済指標（1-8月）：売上高1070.55億元（+15.27%）、利益総額81.94億元（+36.63%）。'
  ]},
  '2025-10': { source:'CCCM（2025年10月号）', paragraphs:[
    '10月は生産・販売が「前月比減・前年同月比増」となり、輸出が高い伸びの勢いを継続した。1-10月でみるとレジャー用大排気量車が高成長を持続し、輸出の力強い伸びが業界の発展に大きな牽引力となった。',
    '生産・販売：10月のオートバイは生産175.43万台・販売175.36万台（前月比-12.64%／-12.5%、前年同月比+9.53%／+11.27%）。電動二輪車は生産30.69万・販売30.12万台（前年同月比+16.22%／+16.23%）と回復が鮮明。1-10月の車種別ではオートバイ型が前年同期比+16.33%／+16.57%、スクーターが-4.06%／-6.07%、カブ型が+28.67%／+31.4%と車種間の二極化が続く。',
    '輸出：10月の輸出は105.1万台（前月比-14.32%、前年同月比+17.66%）、金額6.82億ドル（同+23.07%）。1-10月の製品輸出総額は89.81億ドル（前年同期比+26.1%）。',
    '経済指標（1-9月）：売上高1205.53億元（+14.7%）、利益総額89.73億元（+40.14%）と利益が大幅増。'
  ]},
  '2025-11': { source:'CCCM（2025年11月号）', paragraphs:[
    '11月は生産・販売が前月比・前年同月比とも増加し、輸出は高い増加水準を維持したものの伸び率はやや鈍化した。1-11月でみるとレジャー用大排気量車が高成長を保ち、輸出の持続的な押し上げが業界全体の高品質な発展を力強く牽引している。',
    '生産・販売：11月のオートバイは生産184.65万台・販売179.01万台（前月比+5.26%／+2.08%、前年同月比+11.04%／+8.67%）。電動二輪車は生産31.69万・販売30.94万台（前年同月比+18.49%／+14.98%）と好調。大排気量は生産6.73万・販売6.1万台（同+10.33%／+11.31%）。',
    '輸出：11月の輸出は106.37万台（前月比+1.21%、前年同月比+11.74%）と伸び率が鈍化。金額7.15億ドル（同+18.35%）。1-11月の製品輸出総額は99.17億ドル（前年同期比+25.21%）。',
    '経済指標（1-10月）：売上高1330.97億元（+13.59%）、利益総額97.18億元（+36.02%）。'
  ]},
  '2025-12': { source:'CCCM（2025年12月号）', paragraphs:[
    '12月は生産・販売の両面が前月比・前年同月比とも増加し、輸出の伸びが明確で、年度を通じた単月輸出量の最高値を記録した。2025年通年は生産・販売の着実な増加、品質・効率の向上、構造の最適化が顕著で、輸出は高い活況を維持した。国内市場の回復は緩やかながら、レジャー用大排気量車が高成長を維持し、電動二輪車は回復基調の成長に転じた。',
    '生産・販売（通年）：2025年通年のオートバイは生産2210.93万台・販売2196.77万台（前年比+10.69%／+10.25%）。ガソリン車+11.65%／+12.16%、電動二輪車+6.03%／+1.14%。大排気量（250cc超）は+23.3%／+25.87%。一方、国内販売は860.2万台（-3.45%）と内需は依然弱含み。',
    '輸出（通年）：1-12月の製品輸出総額は109.37億ドル（+23.85%）、完成車輸出1336.57万台（+21.33%、金額88.5億ドル+26.78%）。',
    '経済指標（1-12月）：売上高1590.30億元（+10.73%）、利益総額122.97億元（+34.11%）。12月末の売掛金は244.39億元（-2.2%）、製品在庫57.63億元（+4.75%）。'
  ]},
  '2026-01': { source:'CCCM（2026年1月号）', paragraphs:[
    '1月、オートバイ産業は好調な滑り出しとなり、生産・販売台数が前年同月比・前月比とも明確に増加した。輸出は前年来の好調な伸びを継続し、単月輸出量が近年の最高値を記録した。',
    '生産・販売：1月のオートバイは生産200.46万台・販売200.51万台（前年同月比+26.01%／+23.63%）。ガソリン車は生産169.85万・販売172.36万台（同+23.24%／+22.95%）、電動二輪車は生産30.61万・販売28.15万台（同+43.97%／+27.99%）と電動が急回復。国内販売68.21万台（同+21.16%）。',
    '輸出：1月の輸出は132.3万台（前月比+6.86%、前年同月比+24.94%）、金額8.76億ドル（同+31.28%）と単月輸出量が過去最高水準。',
    '経済指標（1-12月＝2025年確定値）：売上高1590.30億元（+10.73%）、利益総額122.97億元（+34.11%）、利益・税金総額159.46億元（+31.87%）。'
  ]},
  '2026-02': { source:'CCCM（2026年1-2月号）', paragraphs:[
    '春節（旧正月）要因により2月の生産・販売は1月比で減少したが、輸出は前年同月比で明確に増加した。1-2月累計でみると、輸出市場の力強い牽引により生産・販売が着実に増加し、輸出が高い伸びを継続、産業全体が堅調に推移している。',
    '生産・販売：2月のオートバイは生産119.6万台・販売133.74万台（前月比-40.77%／-33.76%、前年同月比-10.67%／-2.45%）。電動二輪車は2月に前年同月比-57.48%／-52.63%と春節の影響が大きい。1-2月累計は生産321.54万台・販売335.65万台（前年同期比+9.75%／+12.15%）。国内販売は2月106.82万台（前年同月比-37.65%）。',
    '輸出：2月の輸出は96.31万台（前月比-27.33%、前年同月比+24.96%）、金額6.7億ドル（同+29.21%）。1-2月の製品輸出総額は19.14億ドル（前年同期比+30.15%）、完成車輸出228.84万台（+25.07%）。'
  ]},
  '2026-03': { source:'CCCM（2026年1-3月／第1四半期号）', paragraphs:[
    '3月は生産・販売台数が前年同月比・前月比とも大きく増加し、輸出が高い伸び率を維持した。第1四半期累計では、輸出市場の力強い牽引により生産・販売が着実に上昇し、産業全体が堅調な発展を保っている。',
    '生産・販売：3月のオートバイは生産210.33万台・販売203.41万台（前月比+75.13%／+51.65%、前年同月比+6.12%／+4.69%）。ガソリン車は生産173.21万・販売165.61万台（同+7.81%／+4.96%）、電動二輪車は生産37.12万・販売37.8万台（前月比+234.55%／+214.23%）と春節明けで急回復。大排気量（250cc超）は3月に前年同月比-11.2%／-11.8%と調整局面。1-3月の二輪車の車種別販売比率はオートバイ型59.69%・スクーター28.29%・カブ型11.56%。',
    '輸出：3月の輸出は118.33万台（前月比+22.6%、前年同月比+7.79%）、金額7.91億ドル（同+8.69%）。1-3月の製品輸出総額は29.06億ドル（前年同期比+22.86%）、完成車輸出347.37万台（+18.66%）。',
    '経済指標（1-2月）：売上高232.55億元（+12.65%）、利益総額9.53億元（+6.36%）、利益・税金総額15.54億元（-6.1%）。'
  ]},
  '2026-04': { source:'CCCM（2026年4月号）', paragraphs:[
    '4月は生産・販売が明確に増加し、輸出が着実に上昇、産業の運営が引き続き好転した。',
    '生産・販売：4月のオートバイは生産227.89万台・販売227.16万台（前月比+8.35%／+11.67%、前年同月比+11.53%／+13.63%）。ガソリン車は生産188.36万・販売188.79万台（同+7.73%／+10.06%）、電動二輪車は生産39.53万・販売38.37万台（同+34.1%／+35.24%）と電動が大幅増。大排気量（250cc超）は4月に前年同月比+7.22%／+11.4%と回復。国内販売89.9万台（同+0.48%）。1-4月累計は生産760.29万台・販売766.65万台（前年同期比+9.31%／+10.55%）、ガソリン車の国内販売167.55万台（-1.15%、減少幅は縮小）。',
    '輸出（1-4月）：排気量別の上位6シリーズは125系列158.06万台（+20.78%）・150系列124.1万台（+0.8%）・110系列74.43万台（+62.48%）など。三輪車の輸出は23.3万台（+13.7%）。',
    '経済指標（1-3月）：売上高379.41億元（+8.37%）、利益総額16.02億元（-19.12%）、利益・税金総額20.16億元（-33.75%）と利益が大幅減。営業コスト383.10億元（+28.52%）でコスト増が収益を圧迫している。'
  ]}
};

function cccmRenderCommentary(ym) {
  const titleEl = document.getElementById('cccm-commentary-title-month');
  const body    = document.getElementById('cccm-commentary-body');
  const link    = document.getElementById('cccm-commentary-source-link');
  const srcEl   = document.getElementById('cccm-commentary-source');
  if (!body) return;
  const [y, m] = ym.split('-');
  if (titleEl) titleEl.textContent = `${y}年${parseInt(m, 10)}月`;
  const data = CCCM_COMMENTARY[ym];
  if (!data) {
    body.innerHTML = '<p style="color:#94a3b8;font-style:italic;margin-bottom:0">この月の総論は未登録です。</p>';
    if (srcEl) srcEl.textContent = '';
    if (link) link.style.display = 'none';
    return;
  }
  body.innerHTML = data.paragraphs.map((p, i) => {
    const mb = (i === data.paragraphs.length - 1) ? '0' : '10px';
    return `<p style="margin-bottom:${mb}">${_ccEscHtml(p)}</p>`;
  }).join('');
  if (srcEl) srcEl.textContent = data.source ? '出所：' + data.source : '';
  if (link) {
    if (data.url) { link.href = data.url; link.style.display = ''; }
    else link.style.display = 'none';  // 手入力の月は公式記事URLが未収録
  }
  if (data.lang === 'zh' && srcEl) srcEl.textContent = (data.source ? '出所：' + data.source : '') +
    '　※公式記事に掲載された原文（中国語）です。日本語の要約は未作成。';
}

function cccmSetupCommentary() {
  const sel = document.getElementById('cccm-commentary-month-select');
  if (!sel || sel.dataset.ready) return;
  const months = Object.keys(CCCM_COMMENTARY).sort().reverse();
  if (!months.length) return;
  sel.innerHTML = months.map(ym => {
    const [y, m] = ym.split('-');
    return `<option value="${ym}">${y}年${parseInt(m, 10)}月</option>`;
  }).join('');
  sel.onchange = () => cccmRenderCommentary(sel.value);
  sel.value = months[0];
  sel.dataset.ready = '1';
  cccmRenderCommentary(months[0]);
}

const CCCM_FNS = {
  'cccm-overview':  cccmInitOverview,
  'cccm-fuel-ev':   cccmInitFuelEv,
  'cccm-bike-type': cccmInitBikeType,
  'cccm-large':     cccmInitLarge,
  'cccm-export':    cccmInitExport,
  'cccm-makers':    cccmInitMakers,
  'cccm-balance':   cccmInitBalance,
  'cccm-econ':      cccmInitEcon,
};

document.getElementById('cccm-super-tab').addEventListener('shown.bs.tab', () => {
  cccmSetupCommentary();
  cccmInitOverview();
});

document.querySelectorAll('#cccmPills .nav-link').forEach(btn => {
  btn.addEventListener('shown.bs.tab', e => {
    const id = e.target.getAttribute('data-bs-target').replace('#','');
    if (CCCM_FNS[id]) CCCM_FNS[id]();
    setTimeout(() => {
      Object.values(CCCM_EC).forEach(c => { try { c && c.resize(); } catch(e){} });
    }, 50);
  });
});

// ====== CCCM 自動取得（stats_pipeline → cds-archive ブランチの cccm/data.json） ======
// 中国摩托车商会の公式サイト（统计数据）の速報本文から自動で読み取った数値を CCCM_RAW に足す。
// 手入力のある月は手入力を優先し、空いている項目だけを埋める。手入力のない月（新しい月）はそのまま加える。
var CCCM_AUTO = { loaded: false, meta: null, promise: null };
var CCCM_AUTO_SECS = ['prod_sales','bike_type','trike','export','export_cc','econ_cumul','econ_monthly',
  'fuel_makers_cumul','fuel_makers_monthly','ev_makers_cumul','ev_makers_monthly','balance',
  'export_companies','sub_export','export_cc_yoy'];
function cccmMonthRange(a, b) {
  const out = [];
  let [y, m] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  while ((y < y2 || (y === y2 && m <= m2)) && out.length < 600) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
function cccmMergeAuto(auto) {
  CCCM_AUTO_SECS.forEach(sec => {
    const src = auto[sec] || {};
    const dst = CCCM_RAW[sec] = CCCM_RAW[sec] || {};
    Object.keys(src).forEach(ym => {
      const s = src[ym];
      if (!s || typeof s !== 'object') return;
      const d = dst[ym];
      if (!d || (typeof d === 'object' && Object.keys(d).length === 0)) { dst[ym] = s; return; }
      if (Array.isArray(d.companies)) return;  // 企業ランキングは手入力を優先
      Object.keys(s).forEach(k => { if (d[k] == null) d[k] = s[k]; });
    });
  });
  // 月の並び：手入力＋自動取得の最初の月から最後の月まで（抜けた月も空欄として並べる）
  const ms = new Set(CCCM_RAW.meta.months);
  ((auto.meta && auto.meta.months) || []).forEach(m => ms.add(m));
  const sorted = [...ms].sort();
  if (sorted.length) CCCM_RAW.meta.months = cccmMonthRange(sorted[0], sorted[sorted.length - 1]);
  // 総論：手入力（日本語）のない月だけ、原文（中国語）を表示する
  Object.entries(auto.commentary || {}).forEach(([ym, c]) => { if (!CCCM_COMMENTARY[ym]) CCCM_COMMENTARY[ym] = c; });
}
function cccmRedraw() {
  Object.keys(CCCM_EC).forEach(id => { try { CCCM_EC[id].dispose(); } catch (e) {} delete CCCM_EC[id]; });
  const tab = document.getElementById('cccm-super-tab');
  if (!tab || !tab.classList.contains('active')) return;  // まだ開いていなければ、開いたときに新しい数値で描く
  const sel = document.getElementById('cccm-commentary-month-select');
  if (sel) delete sel.dataset.ready;
  cccmSetupCommentary();
  const act = document.querySelector('#cccmPills .nav-link.active');
  const id = act ? (act.getAttribute('data-bs-target') || '').replace('#', '') : 'cccm-overview';
  (CCCM_FNS[id] || cccmInitOverview)();
}
function cccmShowAutoStatus() {
  const el = document.getElementById('cccm-auto-status');
  const ms = (CCCM_AUTO.meta && CCCM_AUTO.meta.months) || [];
  if (!el || !ms.length) return;
  const last = ms[ms.length - 1].split('-');
  const pub = (CCCM_AUTO.meta.latest_published_at || '').slice(0, 10);
  el.innerHTML = `🔄 <b>自動取得</b>：${last[0]}年${parseInt(last[1], 10)}月分まで（中国摩托车商会 公式サイトの速報本文から自動で読み取り` +
    (pub ? `・最新の公表 ${pub}` : '') + '）。手入力の月は手入力の値を優先しています。';
  el.style.display = '';
}
function cccmLoadAuto() {
  if (CCCM_AUTO.promise) return CCCM_AUTO.promise;
  if (typeof RAW_BASE === 'undefined') return (CCCM_AUTO.promise = Promise.resolve(false));
  const url = RAW_BASE.replace(/\/main\/$/, '/cds-archive/') + 'cccm/data.json?v=' + Date.now();
  CCCM_AUTO.promise = fetch(url, { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(auto => {
      if (!auto || !auto.meta) return false;
      cccmMergeAuto(auto);
      CCCM_AUTO.loaded = true;
      CCCM_AUTO.meta = auto.meta;
      cccmDerive();
      cccmShowAutoStatus();
      cccmRedraw();
      return true;
    })
    .catch(e => { console.warn('CCCM の自動取得データを読めませんでした（手入力の数値だけで表示します）', e); return false; });
  return CCCM_AUTO.promise;
}
cccmLoadAuto();

// =============================================
// メーカー販売グラフ（cnsuv.com 〜2026/03 ＋ 汽车之家 2026/03〜）
// =============================================
// cnsuv.com は閉鎖（2026年3月分が最終）。汽车之家の厂商月销榜は2026年3月分から。
// 既定の「連結」表示では、汽车之家の最初の月より前を cnsuv、その月以降を汽车之家で表示し、
// cnsuv の名前を CNSUV_TO_AH で汽车之家の表記に揃えて1本の線につなぐ。
// JSON は private リポの tools/scrape_market_data.py（market_data_scraper）が更新し、
// deploy_public で本リポにミラーされる。
var CNSUV_FILES = {
  autohome: 'output/market/autohome_factory_monthly.json',
  cnsuv:    'output/market/cnsuv_factory_monthly.json'
};
var CNSUV_AH_CITE = 'https://www.autohome.com.cn/rank/1#pvareaid=6863887';
var CNSUV_CN_CITE = 'https://www.cnsuv.com/sales/factory/';

// cnsuv → 汽车之家 の名前対応（両方にある2026年3月分で台数を突き合わせて確認）
//   cnsuv は同じ月に同じ厂商名の行が複数ある（実体はブランド別の行）ため、
//   各月の1件目（台数の多い方）を本体として対応させ、2件目以降は「名前（2）」として残す。
var CNSUV_TO_AH = {
  "上汽通用五菱": "五菱汽车",     // 66,405 一致
  "长安汽车":     "长安",         // cnsuv 55,357 / 汽车之家 52,416（差あり・同一系列と判断）
  "东风日产":     "日产",         // 47,506 一致
  "理想":         "理想汽车",     // 41,053 一致
  "一汽-大众奥迪": "一汽奥迪",    // 38,550 一致
  "广汽埃安":     "埃安",         // 32,678 一致
  "奇瑞汽车":     "奇瑞",         // 27,594 一致（cnsuv の1件目）
  "长城汽车":     "哈弗",         // 24,520 一致
  "广汽乘用车":   "广汽传祺",     // 23,632 一致
  "长安启源":     "长安启源（2）" // 22,860 一致（汽车之家では同名2件のうち2件目）
  // 名前が同じもの（比亚迪・广汽丰田・吉利汽车・上汽大众 等）は対応不要
};

var CNSUV_SOURCES = {
  merged: {
    lineSub:  function(){ return 'cnsuv.com（〜' + cnsuvMonthBefore(CNSUV_JOIN) + '）→ 汽车之家 厂商月销榜（' + CNSUV_JOIN + '〜）　点線が切替月'; },
    barSub:   function(){ return 'cnsuv.com → 汽车之家（' + CNSUV_JOIN + '〜）　点線が切替月'; },
    shareSub: function(){ return '汽车之家の期間は「掲載上位社の合計 × ' + CNSUV_SHARE_RATIO.toFixed(3) + '」を市場総数として推計（' + CNSUV_JOIN + ' の cnsuv 総数との比）'; },
    rankSub:  function(){ return '1位が最上位。切替月以降は汽车之家の順位（cnsuv に無かった奥迪・本田などが加わるため数位ずれることがあります）'; }
  },
  autohome: {
    lineSub:  function(){ return '汽车之家 厂商月销榜（各月の掲載上位社）'; },
    barSub:   function(){ return '汽车之家 厂商月销榜'; },
    shareSub: function(){ return '掲載上位社の合計に対するシェア（汽车之家は市場全体の総数を掲載していないため）'; },
    rankSub:  function(){ return '1位が最上位'; }
  },
  cnsuv: {
    lineSub:  function(){ return 'cnsuv.com / 乗聯会データ（各月上位30行・2026年3月で更新終了）'; },
    barSub:   function(){ return 'cnsuv.com / 乗聯会データ'; },
    shareSub: function(){ return '月次シェア変動（乗聯会の総数比）'; },
    rankSub:  function(){ return '1位が最上位'; }
  }
};
var CNSUV_SOURCE = 'merged';
var CNSUV_FILE_CACHE = {};
var CNSUV_RAW = {};
var CNSUV_RAW_LOADED = false;
var CNSUV_JOIN = null;        // 連結表示で汽车之家に切り替わる月
var CNSUV_SHARE_RATIO = 1;    // 連結表示で汽车之家の上位合計を市場総数に換算する比

// 月データの行配列（汽车之家=top / cnsuv=top_30）
function cnsuvRows(md) { return md ? (md.top || md.top_30 || []) : []; }
function cnsuvFind(m, mk) { return cnsuvRows(CNSUV_RAW[m]).find(function(r){ return r.factory === mk; }); }
function cnsuvMonthAdd(m, n) {
  var y = +m.slice(0,4), mo = +m.slice(5,7) - 1 + n;
  y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
  return y + '-' + String(mo + 1).padStart(2, '0');
}
function cnsuvMonthBefore(m) { return m ? cnsuvMonthAdd(m, -1) : ''; }

async function cnsuvFetchFile(key) {
  if (!CNSUV_FILE_CACHE[key]) {
    const res = await fetch(`${RAW_BASE}${CNSUV_FILES[key]}?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(key + ': ' + res.status + ' ' + res.statusText);
    const json = await res.json();
    const months = json.months || json;
    if (!Object.keys(months).length) throw new Error(key + ': データが空です');
    CNSUV_FILE_CACHE[key] = months;
  }
  return CNSUV_FILE_CACHE[key];
}

// cnsuv の1ヶ月分を整える
//   ・ページ送りで二重に入った完全一致行（同名・同台数）を除去
//   ・同名の2件目以降は「名前（2）」にする（これまでは2件目が表示されていなかった）
//   ・mapNames=true なら1件目の名前を汽车之家の表記に置き換える
function cnsuvNormalizeCnsuvMonth(md, mapNames) {
  var seenRow = {}, count = {}, used = {}, rows = [];
  (md.top_30 || md.top || []).forEach(function(r) {
    var rowKey = r.factory + '|' + r.sales;
    if (seenRow[rowKey]) return;
    seenRow[rowKey] = true;
    count[r.factory] = (count[r.factory] || 0) + 1;
    var name = count[r.factory] === 1 && mapNames && CNSUV_TO_AH[r.factory] ? CNSUV_TO_AH[r.factory] : r.factory;
    var n = count[r.factory];
    if (n > 1) name = r.factory + '（' + n + '）';
    while (used[name]) { n++; name = r.factory + '（' + n + '）'; }
    used[name] = true;
    rows.push(Object.assign({}, r, { factory: name, cnsuv_name: r.factory }));
  });
  return { total_sales: md.total_sales, factory_count: md.factory_count, top: rows, scraped_at: md.scraped_at, src: 'cnsuv' };
}

// 連結データ：汽车之家の最初の月より前は cnsuv、以降は汽车之家
function cnsuvBuildMerged(cn, ah) {
  var ahMonths = Object.keys(ah).sort();
  var join = ahMonths[0];
  var out = {};
  Object.keys(cn).forEach(function(m){ if (m < join) out[m] = cnsuvNormalizeCnsuvMonth(cn[m], true); });
  // シェア用の総数：重なる月（2026-03）の「cnsuv 総数 ÷ 汽车之家 上位合計」で換算
  var ratio = 1;
  if (cn[join] && ah[join] && ah[join].total_sales) ratio = cn[join].total_sales / ah[join].total_sales;
  ahMonths.forEach(function(m){
    out[m] = Object.assign({}, ah[m], { share_total: Math.round(ah[m].total_sales * ratio), src: 'autohome' });
  });
  return { months: out, join: join, ratio: ratio };
}

async function loadCnsuvRaw(source) {
  var months, join = null, ratio = 1, notice = '';
  if (source === 'cnsuv') {
    var cn = await cnsuvFetchFile('cnsuv');
    months = {};
    Object.keys(cn).forEach(function(m){ months[m] = cnsuvNormalizeCnsuvMonth(cn[m], false); });
  } else if (source === 'autohome') {
    months = await cnsuvFetchFile('autohome');
  } else {
    var res = await Promise.allSettled([cnsuvFetchFile('cnsuv'), cnsuvFetchFile('autohome')]);
    var cn2 = res[0].status === 'fulfilled' ? res[0].value : null;
    var ah2 = res[1].status === 'fulfilled' ? res[1].value : null;
    if (cn2 && ah2) {
      var mg = cnsuvBuildMerged(cn2, ah2);
      months = mg.months; join = mg.join; ratio = mg.ratio;
    } else if (cn2) {
      months = {};
      Object.keys(cn2).forEach(function(m){ months[m] = cnsuvNormalizeCnsuvMonth(cn2[m], true); });
      notice = '⚠ 汽车之家データを読み込めなかったため cnsuv（〜2026年3月）のみ表示中';
    } else if (ah2) {
      months = ah2;
      notice = '⚠ cnsuvデータを読み込めなかったため汽车之家のみ表示中';
    } else {
      throw res[1].reason || res[0].reason;
    }
  }
  CNSUV_SOURCE = source;
  CNSUV_JOIN = join;
  CNSUV_SHARE_RATIO = ratio;
  Object.keys(CNSUV_RAW).forEach(function(k){ delete CNSUV_RAW[k]; });
  Object.assign(CNSUV_RAW, months);
  CNSUV_RAW_LOADED = true;
  console.log(source + ' 読み込み成功:', Object.keys(CNSUV_RAW).length + 'ヶ月', join ? '（切替月 ' + join + '）' : '');
  // データに含まれる年の範囲でセレクトボックスを作り直す
  const allYears = [...new Set(Object.keys(CNSUV_RAW).map(m => parseInt(m.split('-')[0])))].sort();
  const startSel = document.getElementById('cnsuvStartYear');
  const endSel   = document.getElementById('cnsuvEndYear');
  if (startSel && endSel) {
    [startSel, endSel].forEach(sel => {
      sel.innerHTML = '';
      allYears.forEach(y => {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y + '年';
        sel.appendChild(opt);
      });
    });
    startSel.value = allYears[0];
    endSel.value   = allYears[allYears.length - 1];
  }
  return notice;
}

// 連結表示の切替月に点線を引く（表示範囲に切替月があるときだけ）
function cnsuvSeamMarkLine(months) {
  if (CNSUV_SOURCE !== 'merged' || !CNSUV_JOIN || months.indexOf(CNSUV_JOIN) < 0) return null;
  return {
    silent: true, symbol: 'none',
    lineStyle: { type: 'dashed', color: '#999', width: 1 },
    label: { formatter: 'cnsuv ｜ 汽车之家', position: 'insideEndTop', color: '#888', fontSize: 10 },
    data: [{ xAxis: CNSUV_JOIN }]
  };
}
function cnsuvAddSeam(series, months) {
  var ml = cnsuvSeamMarkLine(months);
  if (ml && series.length) series[0].markLine = ml;
  return series;
}

// 表示テキスト（引用元・サブタイトル）をソースに合わせて切替
function cnsuvApplySourceTexts(notice) {
  var S = CNSUV_SOURCES[CNSUV_SOURCE];
  var sel = document.getElementById('cnsuvSource');
  if (sel) sel.value = CNSUV_SOURCE;
  var keys = Object.keys(CNSUV_RAW).sort();
  var a = function(href, txt){ return '<a href="' + href + '" target="_blank" rel="noopener" style="color:#aaa;word-break:break-all;">' + txt + '</a>'; };
  var ahLast = keys.filter(function(k){ return CNSUV_RAW[k].src !== 'cnsuv'; }).pop();
  var ahHref = (ahLast && CNSUV_RAW[ahLast].source_url) || CNSUV_AH_CITE;
  var cite = document.getElementById('cnsuvCite');
  if (cite) {
    if (CNSUV_SOURCE === 'cnsuv') cite.innerHTML = a(CNSUV_CN_CITE, 'cnsuv.com（2026年3月で更新終了）');
    else if (CNSUV_SOURCE === 'autohome') cite.innerHTML = a(ahHref, '汽车之家 厂商月销榜');
    else cite.innerHTML = a(CNSUV_CN_CITE, 'cnsuv.com') + '（〜' + cnsuvMonthBefore(CNSUV_JOIN) + '）／' + a(ahHref, '汽车之家 厂商月销榜') + '（' + (CNSUV_JOIN || '') + '〜）';
  }
  var set = function(id, txt){ var el = document.getElementById(id); if (el) el.textContent = txt; };
  set('cnsuvNotice', notice || '');
  if (CNSUV_SOURCE === 'merged' && !CNSUV_JOIN) S = CNSUV_SOURCES.cnsuv;   // 片方しか読めなかった場合
  set('cnsuvLineSub', S.lineSub());
  set('cnsuvBarSub', S.barSub());
  set('cnsuvShareSub', S.shareSub());
  set('cnsuvRankSub', S.rankSub());
}

// ソースを読み込み → メーカー一覧・チェックボックス・グラフを作り直す
async function cnsuvActivate(source) {
  var notice = '';
  try {
    notice = await loadCnsuvRaw(source);
  } catch (err) {
    console.error(source + ' 読み込み失敗:', err);
    if (source === 'merged') return;
    try {
      notice = (await loadCnsuvRaw('merged')) || '⚠ 選択したデータを読み込めなかったため連結表示にしています';
    } catch (err2) {
      console.error('連結データ 読み込み失敗:', err2);
      return;
    }
  }
  cnsuvApplySourceTexts(notice);
  rebuildCnsuvAllMakers();
  var cont = document.getElementById('cnsuvMakerCheckboxes');
  if (cont) cont.innerHTML = '';
  cnsuvBuildCheckboxes();
  cnsuvRefresh();
}

var CNSUV_MAKER_JA = {"比亚迪":"BYD","吉利汽车":"吉利","长安汽车":"長安","奇瑞汽车":"奇瑞","长城汽车":"長城","一汽红旗":"紅旗","上汽集团":"SAIC","特斯拉中国":"Tesla","理想":"Li Auto","蔚来":"NIO","小鹏汽车":"XPENG","零跑汽车":"Leapmotor","极氪":"Zeekr","小米汽车":"Xiaomi","深蓝汽车":"Deepal","AITO 问界":"AITO（問界）","广汽埃安":"広汽AION","领克":"LYNK&CO（領克）","合众汽车":"Neta（合衆汽車）","方程豹":"方程豹（BYD傘下）","长安启源":"長安啓源","一汽-大众":"FAW-フォルクスワーゲン","上汽大众":"SAIC-フォルクスワーゲン","一汽-大众奥迪":"FAW-アウディ","一汽-大众捷达":"FAW-捷達（Jetta）","上汽大众斯柯达":"SAIC-シュコダ","上汽通用别克":"Buick（上汽GM）","上汽通用凯迪拉克":"Cadillac（上汽GM）","上汽通用雪佛兰":"Chevrolet（上汽GM）","上汽通用五菱":"GM五菱（SGMW）","广汽丰田":"広汽トヨタ","一汽丰田":"一汽トヨタ","广汽本田":"広汽Honda","东风本田":"東風Honda","东风日产":"東風日産","华晨宝马":"華晨BMW","北京奔驰":"北京メルセデス","北京现代":"北京ヒュンダイ","悦达起亚":"悦達・起亜（Kia）","长安福特":"長安Ford","长安马自达":"長安Mazda","广汽三菱":"広汽Mitsubishi","广汽菲克Jeep":"広汽Jeep","沃尔沃亚太":"Volvo（中国生産）","东风标致":"東風Peugeot","北汽新能源":"BJEV（北汽新能源）","北京汽车":"BAIC（北京汽車）","北汽幻速":"BAIC幻速","广汽乘用车":"広汽乗用（Trumpchi）","奇瑞新能源":"奇瑞EV","长城新能源":"長城EV","一汽奔腾":"FAW-奔騰","东风乘用车":"東風乗用","东风小康":"東風小康","东风风行":"東風Forthing","众泰汽车":"Zotye（衆泰）","江淮汽车":"JAC（江淮）","江汽集团":"JAC集団（江汽）","鑫源汽车":"鑫源","五菱汽车":"GM五菱（SGMW）","长安":"長安","日产":"日産","理想汽车":"Li Auto","奥迪":"アウディ","一汽奥迪":"FAW-アウディ","本田":"Honda","埃安":"広汽AION","奇瑞":"奇瑞","鸿蒙智行":"HIMA（鴻蒙智行）","哈弗":"Haval（哈弗）","广汽传祺":"広汽Trumpchi（伝祺）","吉利银河":"Geely Galaxy（吉利銀河）","捷途":"Jetour（捷途）","MG":"MG（名爵）","北京越野":"BAIC越野","岚图汽车":"Voyah（嵐図）","坦克":"Tank（坦克）","荣威":"Roewe（栄威）","魏牌":"WEY（魏牌）","特斯拉":"Tesla","小鹏":"XPENG","ARCFOX极狐":"ARCFOX（極狐）","长安启源（2）":"長安啓源（2）"};
var CNSUV_COLORS = ["#5470c6","#ee6666","#91cc75","#fac858","#73c0de","#3ba272","#fc8452","#9a60b4","#ea7ccc","#48b6c8","#ff9e7d","#a0c878","#6baed6","#fd8d3c","#9e9ac8"];
// 初期チェック（両ソースの表記を併記。存在しない名前は無視される）
var CNSUV_DEFAULT = ["比亚迪","吉利汽车","上汽大众","一汽-大众","上汽通用五菱","广汽丰田","一汽丰田","华晨宝马","长安汽车","特斯拉中国","奇瑞汽车","理想","零跑汽车","小米汽车","AITO 问界",
                     "五菱汽车","吉利银河","长安","奇瑞","理想汽车","鸿蒙智行"];
var CNSUV_EC = {};
var CNSUV_INITED = false;

// 全メーカー一覧（出現頻度順）- loadCnsuvRaw() 後に rebuildCnsuvAllMakers() で構築
var CNSUV_ALL_MAKERS = [];

function rebuildCnsuvAllMakers() {
  var freq = {};
  Object.values(CNSUV_RAW).forEach(function(m) {
    cnsuvRows(m).forEach(function(r) { freq[r.factory] = (freq[r.factory]||0)+1; });
  });
  CNSUV_ALL_MAKERS = Object.keys(freq).sort(function(a,b){ return freq[b]-freq[a]; });
}

function cnsuvJa(name) {
  if (CNSUV_MAKER_JA[name] && /（\d+）$/.test(name)) return CNSUV_MAKER_JA[name] + ' (' + name + ')';
  // 同名別エントリ（例「吉利汽车（2）」）は元の名前で引いて番号を付け直す
  var dup = /^(.*)（(\d+)）$/.exec(name);
  if (dup) return cnsuvJa(dup[1]) + '（' + dup[2] + '）';
  var ja = CNSUV_MAKER_JA[name];
  if (!ja || ja === name) return name;
  return ja + ' (' + name + ')';
}
function cnsuvColor(maker) { return CNSUV_COLORS[CNSUV_ALL_MAKERS.indexOf(maker) % CNSUV_COLORS.length]; }

function cnsuvGetMonths() {
  var sy = parseInt(document.getElementById('cnsuvStartYear').value);
  var ey = parseInt(document.getElementById('cnsuvEndYear').value);
  var ks = Object.keys(CNSUV_RAW).filter(function(m){ var y=parseInt(m.split('-')[0]); return y>=sy&&y<=ey; }).sort();
  if (!ks.length) return ks;
  var out = [], cur = ks[0];
  while (cur <= ks[ks.length-1]) { out.push(cur); cur = cnsuvMonthAdd(cur, 1); }
  return out;
}
function cnsuvGetMakers() {
  return Array.from(document.querySelectorAll('#cnsuvMakerCheckboxes input:checked')).map(function(cb){ return cb.value; });
}
function cnsuvGetChart(id) {
  var el = document.getElementById(id);
  if (!el) return null;
  if (CNSUV_EC[id]) { try { CNSUV_EC[id].dispose(); } catch(e){} }
  CNSUV_EC[id] = echarts.init(el);
  return CNSUV_EC[id];
}

// ツールチップを値の降順でソートして表示する共通formatter
function cnsuvSortedTooltip(unit) {
  return {
    trigger: 'axis',
    formatter: function(params) {
      var valid = params.filter(function(p){ return p.value != null; });
      valid.sort(function(a, b){ return b.value - a.value; });
      var header = '<b>' + (params[0] ? params[0].axisValueLabel : '') + '</b><br/>';
      return header + valid.map(function(p){
        return p.marker + p.seriesName + ': <b>' + p.value.toFixed(1) + unit + '</b>';
      }).join('<br/>');
    }
  };
}

function cnsuvDrawLine() {
  var c = cnsuvGetChart('ec-cnsuv-line'); if (!c) return;
  var months = cnsuvGetMonths(), makers = cnsuvGetMakers();
  c.setOption({ backgroundColor:'transparent',
    tooltip: cnsuvSortedTooltip('万台'),
    legend:{top:8,type:'scroll',textStyle:{fontSize:11}},
    grid:{left:60,right:20,top:60,bottom:55},
    xAxis:{type:'category',data:months,axisLabel:{rotate:45,fontSize:10}},
    yAxis:{type:'value',name:'万台'},
    series: cnsuvAddSeam(makers.map(function(mk){ return {name:cnsuvJa(mk),type:'line',smooth:true,symbolSize:4,color:cnsuvColor(mk),connectNulls:false,
      data:months.map(function(m){ var e=cnsuvFind(m,mk); return e?Math.round(e.sales/10000*10)/10:null; })}; }), months)
  });
}
function cnsuvDrawBar() {
  var c = cnsuvGetChart('ec-cnsuv-bar'); if (!c) return;
  var months = cnsuvGetMonths(), makers = cnsuvGetMakers();
  c.setOption({ backgroundColor:'transparent',
    tooltip: cnsuvSortedTooltip('万台'),
    legend:{top:8,type:'scroll',textStyle:{fontSize:11}},
    grid:{left:60,right:20,top:60,bottom:55},
    xAxis:{type:'category',data:months,axisLabel:{rotate:45,fontSize:10}},
    yAxis:{type:'value',name:'万台'},
    series: cnsuvAddSeam(makers.map(function(mk){ return {name:cnsuvJa(mk),type:'bar',stack:'total',color:cnsuvColor(mk),
      data:months.map(function(m){ var e=cnsuvFind(m,mk); return e?Math.round(e.sales/10000*10)/10:null; })}; }), months)
  });
}
function cnsuvDrawShare() {
  var c = cnsuvGetChart('ec-cnsuv-share'); if (!c) return;
  var months = cnsuvGetMonths(), makers = cnsuvGetMakers();
  c.setOption({ backgroundColor:'transparent',
    tooltip: cnsuvSortedTooltip('%'),
    legend:{top:8,type:'scroll',textStyle:{fontSize:11}},
    grid:{left:60,right:20,top:60,bottom:55},
    xAxis:{type:'category',data:months,axisLabel:{rotate:45,fontSize:10}},
    yAxis:{type:'value',name:'シェア(%)'},
    series: cnsuvAddSeam(makers.map(function(mk){ return {name:cnsuvJa(mk),type:'line',smooth:true,color:cnsuvColor(mk),connectNulls:false,
      data:months.map(function(m){ var md=CNSUV_RAW[m]; var tot=md&&(md.share_total||md.total_sales); if(!tot)return null; var e=cnsuvFind(m,mk); return e?Math.round(e.sales/tot*1000)/10:null; })}; }), months)
  });
}
function cnsuvDrawRank() {
  var c = cnsuvGetChart('ec-cnsuv-rank'); if (!c) return;
  var months = cnsuvGetMonths(), makers = cnsuvGetMakers();
  var series = makers.map(function(mk){ return {name:cnsuvJa(mk),type:'line',smooth:false,symbolSize:5,color:cnsuvColor(mk),connectNulls:false,
      data:months.map(function(m){ var e=cnsuvFind(m,mk); return e?e.rank:null; })}; });
  // 縦軸の下限：表示中メーカーの最下位に合わせる（最低10位）
  var maxRank = 10;
  series.forEach(function(s){ s.data.forEach(function(v){ if (v != null && v > maxRank) maxRank = v; }); });
  var interval = maxRank > 30 ? 5 : (maxRank > 15 ? 2 : 1);
  maxRank = Math.ceil(maxRank / interval) * interval;
  c.setOption({ backgroundColor:'transparent',
    tooltip:{trigger:'axis',valueFormatter:function(v){return v!=null?v+'位':'圏外';}},
    legend:{top:8,type:'scroll',textStyle:{fontSize:11}},
    grid:{left:60,right:20,top:60,bottom:55},
    xAxis:{type:'category',data:months,axisLabel:{rotate:45,fontSize:10}},
    // 目盛りを 5,10,15… に揃えるため間隔>1のときは0起点（0は非表示）
    yAxis:{type:'value',name:'順位',inverse:true,min:interval>1?0:1,max:maxRank,interval:interval,
      axisLabel:{formatter:function(v){ return v===0?'':v; }}},
    series: cnsuvAddSeam(series, months)
  });
}
function cnsuvDrawYoy() {
  var c = cnsuvGetChart('ec-cnsuv-yoy'); if (!c) return;
  var makers = cnsuvGetMakers();
  // データ内の最新年とその前年を比較（共通する月のみ）
  var years = [...new Set(Object.keys(CNSUV_RAW).map(function(m){ return m.slice(0,4); }))].sort();
  var yB = years[years.length-1], yA = years[years.length-2];
  var sub = document.getElementById('cnsuvYoySub');
  if (!yA) {
    if (sub) sub.textContent = '比較できる前年データがありません';
    c.setOption({ title:{text:'前年データなし',left:'center',top:'middle',textStyle:{color:'#999',fontSize:14}}, series:[] });
    return;
  }
  if (sub) sub.textContent = yA + '年 vs ' + yB + '年（共通する月のみ）';
  var mA = Object.keys(CNSUV_RAW).filter(function(m){return m.startsWith(yA);}).sort();
  var mB = Object.keys(CNSUV_RAW).filter(function(m){return m.startsWith(yB);}).sort();
  var common = mA.map(function(m){return m.slice(5);}).filter(function(mm){return mB.some(function(m2){return m2.slice(5)===mm;});});
  var sA = '(' + yA.slice(2) + ')', sB = '(' + yB.slice(2) + ')';
  var series = [];
  makers.forEach(function(mk) {
    series.push({name:cnsuvJa(mk)+sA,type:'bar',color:cnsuvColor(mk),itemStyle:{opacity:0.5},
      data:common.map(function(mm){ var e=cnsuvFind(yA+'-'+mm,mk); return e?Math.round(e.sales/10000*10)/10:null; })});
    series.push({name:cnsuvJa(mk)+sB,type:'bar',color:cnsuvColor(mk),
      data:common.map(function(mm){ var e=cnsuvFind(yB+'-'+mm,mk); return e?Math.round(e.sales/10000*10)/10:null; })});
  });
  c.setOption({ backgroundColor:'transparent',
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
    legend:{top:8,type:'scroll',textStyle:{fontSize:10}},
    grid:{left:60,right:20,top:80,bottom:40},
    xAxis:{type:'category',data:common.map(function(mm){return mm+'月';})},
    yAxis:{type:'value',name:'万台'},
    series:series
  });
}

function cnsuvRefresh() {
  var active = document.querySelector('#cnsuvChartPills .nav-link.active');
  if (!active) return;
  var t = active.getAttribute('data-bs-target');
  if (t==='#cnsuv-line') cnsuvDrawLine();
  else if (t==='#cnsuv-bar') cnsuvDrawBar();
  else if (t==='#cnsuv-share') cnsuvDrawShare();
  else if (t==='#cnsuv-rank') cnsuvDrawRank();
  else if (t==='#cnsuv-yoy') cnsuvDrawYoy();
}

function cnsuvBuildCheckboxes() {
  var container = document.getElementById('cnsuvMakerCheckboxes');
  if (!container || container.children.length > 0 || !CNSUV_ALL_MAKERS.length) return;

  var JV_MAKERS = [
    "上汽大众","一汽-大众","一汽-大众奥迪","上汽通用别克","上汽通用凯迪拉克","上汽通用雪佛兰",
    "广汽丰田","一汽丰田","广汽本田","东风本田","东风日产",
    "华晨宝马","北京奔驰","北京现代","沃尔沃亚太","特斯拉中国","一汽-大众捷达",
    // 汽车之家の表記
    "日产","本田","奥迪","一汽奥迪","长安马自达","长安福特","上汽大众斯柯达","悦达起亚","东风标致","广汽三菱","特斯拉"
  ];
  var JV_PRESENT  = JV_MAKERS.filter(function(m){ return CNSUV_ALL_MAKERS.indexOf(m) >= 0; });
  var CN_MAKERS   = CNSUV_ALL_MAKERS.filter(function(m){ return JV_MAKERS.indexOf(m) < 0; });

  var groups = [
    { label: '🤝 外資合弁・外資系', makers: JV_PRESENT },
    { label: '🇨🇳 中国系',          makers: CN_MAKERS  }
  ];

  function makeRow(makers) {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin-bottom:4px;';
    makers.forEach(function(maker) {
      var lbl = document.createElement('label');
      lbl.style.cssText = 'cursor:pointer;padding:2px 7px;border-radius:12px;border:1px solid #ddd;font-size:0.78rem;background:#fff;white-space:nowrap;display:inline-flex;align-items:center;gap:3px;';
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = maker; cb.className = 'form-check-input m-0';
      cb.checked = CNSUV_DEFAULT.indexOf(maker) >= 0;
      cb.addEventListener('change', cnsuvRefresh);
      var dot = document.createElement('span');
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:'+cnsuvColor(maker)+';display:inline-block;flex-shrink:0;';
      lbl.appendChild(cb); lbl.appendChild(dot); lbl.appendChild(document.createTextNode(cnsuvJa(maker)));
      row.appendChild(lbl);
    });
    return row;
  }

  groups.forEach(function(g) {
    var row = makeRow(g.makers);
    var header = document.createElement('div');
    header.style.cssText = 'width:100%;display:flex;align-items:center;gap:5px;margin-top:7px;margin-bottom:2px;';
    var title = document.createElement('span');
    title.style.cssText = 'font-size:0.78rem;font-weight:700;color:#444;white-space:nowrap;';
    title.textContent = g.label;
    var btnOn = document.createElement('button');
    btnOn.className = 'btn btn-outline-secondary btn-sm py-0'; btnOn.style.fontSize='0.7rem'; btnOn.textContent='全ON';
    btnOn.addEventListener('click', function(){ row.querySelectorAll('input').forEach(function(cb){cb.checked=true;}); cnsuvRefresh(); });
    var btnOff = document.createElement('button');
    btnOff.className = 'btn btn-outline-secondary btn-sm py-0'; btnOff.style.fontSize='0.7rem'; btnOff.textContent='全OFF';
    btnOff.addEventListener('click', function(){ row.querySelectorAll('input').forEach(function(cb){cb.checked=false;}); cnsuvRefresh(); });
    header.appendChild(title); header.appendChild(btnOn); header.appendChild(btnOff);
    container.appendChild(header);
    container.appendChild(row);
  });
}

function cnsuvSetup() {
  if (CNSUV_INITED) return;
  CNSUV_INITED = true;
  // チェックボックスはデータ読込後に cnsuvActivate() が作る
  document.getElementById('cnsuvSource').addEventListener('change', function(){ cnsuvActivate(this.value); });
  document.querySelectorAll('#cnsuvChartPills .nav-link').forEach(function(btn) {
    btn.addEventListener('shown.bs.tab', function() {
      var t = this.getAttribute('data-bs-target');
      setTimeout(function(){
        if (t==='#cnsuv-line') cnsuvDrawLine();
        else if (t==='#cnsuv-bar') cnsuvDrawBar();
        else if (t==='#cnsuv-share') cnsuvDrawShare();
        else if (t==='#cnsuv-rank') cnsuvDrawRank();
        else if (t==='#cnsuv-yoy') cnsuvDrawYoy();
      }, 50);
    });
  });
  document.getElementById('cnsuvStartYear').addEventListener('change', cnsuvRefresh);
  document.getElementById('cnsuvEndYear').addEventListener('change', cnsuvRefresh);
  document.getElementById('cnsuvAllBtn').addEventListener('click', function(){ document.querySelectorAll('#cnsuvMakerCheckboxes input').forEach(function(cb){cb.checked=true;}); cnsuvRefresh(); });
  document.getElementById('cnsuvNoneBtn').addEventListener('click', function(){ document.querySelectorAll('#cnsuvMakerCheckboxes input').forEach(function(cb){cb.checked=false;}); cnsuvRefresh(); });
}

document.getElementById('cnsuv-charts-tab').addEventListener('click', function() {
  setTimeout(async function() {
    cnsuvSetup();
    if (!CNSUV_RAW_LOADED) await cnsuvActivate(CNSUV_SOURCE);
    else cnsuvRefresh();
  }, 100);
});

window.addEventListener('resize', __rafThrottle(function() {
  Object.values(CNSUV_EC).forEach(function(c){ __ecResize(c); });
}));

/* ========================================
   印刷ボタン：アクティブタブのEChartsをリサイズして
   描画完了を待ってからwindow.print()を呼ぶ
   ======================================== */
function doPrint() {
  // outerタブ（#mainTabsContent直下）のアクティブペインを確実に取得
  var activePane = document.querySelector('#mainTabsContent > .tab-pane.active');
  if (!activePane) { activePane = document.querySelector('.tab-pane.active'); }
  if (!activePane) { window.print(); return; }

  // アクティブペイン内のEChartsをリサイズ
  var targets = activePane.querySelectorAll('.echart-box');
  targets.forEach(function(el) {
    try {
      var inst = echarts.getInstanceByDom(el);
      if (inst) { inst.resize(); }
    } catch(e) {}
  });

  // cds-activeサブペインも対象
  activePane.querySelectorAll('.cds-pane.cds-active .echart-box').forEach(function(el) {
    try {
      var inst = echarts.getInstanceByDom(el);
      if (inst) { inst.resize(); }
    } catch(e) {}
  });

  // canvasの描画が確定するまで少し待ってからprint
  setTimeout(function() { window.print(); }, 200);
}

/* ========================================
   印刷前処理：EChartsを全て強制リサイズして
   キャンバスが正しく描画された状態で印刷する
   ======================================== */
window.addEventListener('beforeprint', function() {
  // outerタブ（#mainTabsContent直下）のアクティブペインを確実に取得
  var activePane = document.querySelector('#mainTabsContent > .tab-pane.active');
  if (!activePane) { activePane = document.querySelector('.tab-pane.active'); }
  if (!activePane) return;

  // activePane内のechart-boxをリサイズ
  activePane.querySelectorAll('.echart-box').forEach(function(el) {
    try {
      var inst = echarts.getInstanceByDom(el);
      if (inst) { inst.resize(); }
    } catch(e) {}
  });

  // cds-pane（崔東樹タブ内サブペイン）が含まれる場合も対応
  activePane.querySelectorAll('.cds-pane.cds-active .echart-box').forEach(function(el) {
    try {
      var inst = echarts.getInstanceByDom(el);
      if (inst) { inst.resize(); }
    } catch(e) {}
  });
});

window.addEventListener('afterprint', function() {
  // CSSのみで制御しているためJS側のリセット不要
});

// 印刷フッターの日付
(function() {
  var el = document.getElementById('print-date');
  if (el) {
    var d = new Date();
    el.textContent = d.getFullYear() + '/' + ('0'+(d.getMonth()+1)).slice(-2) + '/' + ('0'+d.getDate()).slice(-2);
  }
})();

// =============================================
// 崔東樹（輸出分析）タブ — 全シート対応
// =============================================
// ===== ハードコートされたExcelデータ（2026年9月版） =====
const CDS_HARDCODED = {"monthly":{"2021":[14.8,14.2,15.5,16,17.4,19.4,17.4,21.4,17.9,22.7,22.1,19.7],"2022":[26.6,22.4,20.5,17.5,23.4,25.5,28.3,31.3,36.3,35.9,37.5,34.7],"2023":[35.8,32.5,38.8,42.5,43.9,41,43.8,43.6,49.6,52.6,52.4,45.9],"2024":[43.7,39.3,49.4,55.6,57,48.8,55.1,61.1,60.5,58.6,54.9,57.4],"2025":[54.5,41.8,56.8,62.3,69.7,61.9,69.5,76.4,76.3,82.7,81.1,99.4],"2026":[79.5,74.0,78.0,94.0,99.0,106.9,109.1,104.7,118.2,null,null,null]},"amount":{"2022":[45,40,33,28,40,37,48,61,63,71,77,59],"2023":[72,68,74,83,90,78,88,82,92,103,98,89],"2024":[85,73,94,107,105,87,100,109,116,107,91,100],"2025":[81,81,96,112,120,107,118,128,128,143,139,171],"2026":[142,127,138,161,167,182.3,190,183,208,null,null,null]},"parts":{"2022":[74,51,64,60,68,72,79,74,69,66,67,70],"2023":[75,55,80,78,77,76,75,76,76,68,74,75],"2024":[84,64,74,76,78,82,79,81,75,78,78,86],"2025":[74,74,84,81,83,82,82,85,79,69,79,86],"2026":[91,78,74,86,87,97.8,94,91,97.7,null,null,null]},"annual":[{"year":"2007","vol":61,"yoy":78.0},{"year":"2008","vol":68,"yoy":1.0},{"year":"2009","vol":37,"yoy":-46.0},{"year":"2010","vol":57,"yoy":53.0},{"year":"2011","vol":85,"yoy":50.0},{"year":"2012","vol":102,"yoy":20.0},{"year":"2013","vol":95,"yoy":-7.0},{"year":"2014","vol":95,"yoy":0.0},{"year":"2015","vol":76,"yoy":-20.0},{"year":"2016","vol":81,"yoy":8.0},{"year":"2017","vol":106,"yoy":31.0},{"year":"2018","vol":117,"yoy":6.0},{"year":"2019","vol":124,"yoy":6.0},{"year":"2020","vol":108,"yoy":-13.0},{"year":"2021","vol":219,"yoy":102.0},{"year":"2022","vol":340,"yoy":55.0},{"year":"2023","vol":522,"yoy":54.0},{"year":"2024","vol":641,"yoy":23.0},{"year":"2025","vol":832,"yoy":30.0},{"year":"2026.1-9月","vol":863,"yoy":52.0}],"summaryLabels":["2024年12月","2024年全年","2025年2月","2025年1-2月","2025年3月","2025年1-3月","2025年4月","2025年1-4月","2025年5月","2025年1-5月","2025年6月","2025年1-6月","2025年7月","2025年1-7月","2025年8月","2025年1-8月","2025年9月","2025年1-9月","2025年10月","2025年1-10月","2025年11月","2025年1-11月","2025年12月","2025年全年","2026年2月","2026年1-2月","2026年3月","2026年1-3月","2026年4月","2026年1-4月","2026年5月","2026年1-5月","2026年6月","2026年1-6月","2026年7月","2026年1-7月","2026年8月","2026年1-8月","2026年9月","2026年1-9月"],"summaryTotal":[57,641,42,97,57,154,62,216,68.2,283,62,348,70,418,76.4,494,76.3,571,82.1,646,81,733,99,832,74.0,153.5,78.0,231.5,94.0,325.5,99.0,424.5,106.9,531.4,109.1,640.5,104.7,745,118.2,863],"summaryNev":[15,201,14.8,36,22,58,28.6,86,29.6,116,25.6,142,29.1,171,31.5,202,30,232,32.8,265,35,301,42,343,31.4,65.3,32.9,98.2,45.1,143.3,45.8,189.1,52.9,242.0,54.0,296.0,49.8,346,61.2,407],"summaryBEV":[12,170,null,26.5,null,41.5,null,61.7,null,81,null,99,null,122,null,144,20,165,21.3,186,"—",207,"—",232,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"summaryPHEV":["6%","5%","13%","10%","12%","10%","13%","11%","15%","12%","11%","12%","10%","12%","13%","12%","13%","12%","14%","12%","17%","13%","17%","13%",null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null],"nevAnnual":[{"year":"2020年","q1":5,"q2":4,"q3":9,"q4":10,"total":28},{"year":"2021年","q1":11,"q2":15,"q3":21,"q4":25,"total":71},{"year":"2022年","q1":23,"q2":19,"q3":34,"q4":43,"total":119},{"year":"2023年","q1":39,"q2":41,"q3":45,"q4":48,"total":173},{"year":"2024年","q1":46,"q2":55,"q3":52,"q4":49,"total":201},{"year":"2025年","q1":57,"q2":85,"q3":91,"q4":110,"total":343},{"year":"2026年(1-9月)","q1":98,"q2":144,"q3":165,"q4":null,"total":407}],"nevTrend":[{"year":"2017","vol":23,"yoy":31.0},{"year":"2018","vol":22,"yoy":6.0},{"year":"2019","vol":33,"yoy":6.0},{"year":"2020","vol":28,"yoy":-15.0},{"year":"2021","vol":71,"yoy":153.0},{"year":"2022","vol":119,"yoy":68.0},{"year":"2023","vol":173,"yoy":46.0},{"year":"2024","vol":201,"yoy":16.0},{"year":"2025","vol":343,"yoy":70.0},{"year":"2026.1-9月","vol":407,"yoy":75.0}],"powerCars":{"ガソリン":{"2022":161,"2023":266,"2024":325,"2025":326,"2026":282.4},"BEV":{"2022":95,"2023":154,"2024":165,"2025":221,"2026":247.5},"PHEV":{"2022":9,"2023":14,"2024":30,"2025":106,"2026":149.2},"HEV":{"2022":1.7,"2023":7.8,"2024":25.8,"2025":50.6,"2026":63.4},"ディーゼル":{"2022":0.6,"2023":0.7,"2024":1.1,"2025":3,"2026":3.1},"乗用車 計":{"2022":268,"2023":443,"2024":547,"2025":708,"2026":746}},"bodyTypes":{"乗用車 計":{"2022":267.6,"2023":442.7,"2024":547.3,"2025":707.6,"2026":746},"貨物車 計":{"2022":59.9,"2023":69.2,"2024":79.4,"2025":106.5,"2026":101},"バス 計":{"2022":4.8,"2023":7.1,"2024":8.2,"2025":10.6,"2026":9.4}},"nevPower":{"ガソリン":{"2022":177,"2023":284,"2024":348,"2025":355,"2026":308},"BEV":{"2022":98,"2023":159,"2024":168,"2025":232,"2026":253},"PHEV":{"2022":10,"2023":14,"2024":32,"2025":111,"2026":154},"ディーゼル":{"2022":42.4,"2023":51.1,"2024":56.9,"2025":73.5,"2026":75},"HEV":{"2022":1.7,"2023":7.8,"2024":25.8,"2025":50.6,"2026":63},"不明":{"2022":6.9,"2023":7.6,"2024":10.4,"2025":10.9,"2026":10}},"nevBody":{"乗用車 計":{"2022":104,"2023":168,"2024":195,"2025":327,"2026":396.7},"貨物車 計":{"2022":2,"2023":3,"2024":4,"2025":14,"2026":9.0},"バス 計":{"2022":0.8,"2023":1,"2024":1.2,"2025":1.7,"2026":1.4}},"regions":[{"name":"中南米","v":[35,21,51,77,89,112,164],"v2026":70},{"name":"中東","v":[11,15,22,49,68,98,139],"v2026":32},{"name":"EU","v":[5,10,31,67,94,96,137],"v2026":68},{"name":"旧ソ連","v":[8,8,19,25,130,162,123],"v2026":48},{"name":"東南亜","v":[14,12,22,43,53,61,97],"v2026":37},{"name":"アフリカ","v":[13,13,19,22,22,35,78],"v2026":36},{"name":"オセアニア","v":[3,5,11,19,24,19,32],"v2026":14},{"name":"アジアその他","v":[22,14,20,17,17,21,30],"v2026":9},{"name":"日韓","v":[1,1,2,3,6,10,13],"v2026":8},{"name":"北米(米加)","v":[4,5,6,8,15,2,9],"v2026":4}],"countries":[{"name":"ロシア","v2024":115.8,"v2025":58.3,"v2026":75.3},{"name":"ブラジル","v2024":23.6,"v2025":32.2,"v2026":54.0},{"name":"メキシコ","v2024":44.5,"v2025":62.5,"v2026":36.2},{"name":"英国","v2024":19.5,"v2025":33.6,"v2026":42.4},{"name":"ベルギー","v2024":28.0,"v2025":30.0,"v2026":36.8},{"name":"オーストラリア","v2024":17.8,"v2025":29.7,"v2026":37.4},{"name":"イタリア","v2024":11.3,"v2025":16.3,"v2026":24.6},{"name":"ドイツ","v2024":8.3,"v2025":10.6,"v2026":16.5},{"name":"アルジェリア","v2024":3.4,"v2025":17.8,"v2026":21.2},{"name":"タイ","v2024":12.4,"v2025":16.9,"v2026":22.4},{"name":"キルギス","v2024":9.7,"v2025":14.3,"v2026":15.1},{"name":"マレーシア","v2024":12.3,"v2025":17.9,"v2026":17.7},{"name":"南アフリカ","v2024":7.4,"v2025":12.9,"v2026":14.8},{"name":"ペルー","v2024":7.1,"v2025":11.1,"v2026":14.9},{"name":"韓国","v2024":7.0,"v2025":9.6,"v2026":13.9},{"name":"ベトナム","v2024":8,"v2025":11,"v2026":null},{"name":"スペイン","v2024":12.4,"v2025":15.8,"v2026":20.3},{"name":"フィリピン","v2024":16.9,"v2025":25.7,"v2026":23.6},{"name":"サウジ","v2024":27.6,"v2025":30.2,"v2026":17.7},{"name":"チリ","v2024":12.1,"v2025":14.1,"v2026":null},{"name":"カザフスタン","v2024":12.4,"v2025":21.2,"v2026":16.3},{"name":"エジプト","v2024":6.0,"v2025":11.2,"v2026":12.7},{"name":"香港","v2024":2.7,"v2025":4.2,"v2026":null},{"name":"パキスタン","v2024":2.7,"v2025":5.9,"v2026":null},{"name":"フランス","v2024":2.6,"v2025":3.4,"v2026":8.7},{"name":"ベラルーシ","v2024":12.2,"v2025":12.0,"v2026":null},{"name":"ウズベキスタン","v2024":9.0,"v2025":10.5,"v2026":null},{"name":"コロンビア","v2024":3.2,"v2025":6.8,"v2026":null},{"name":"エクアドル","v2024":4.2,"v2025":7.5,"v2026":null},{"name":"トルコ","v2024":13.4,"v2025":13.4,"v2026":null},{"name":"ポーランド","v2024":3.0,"v2025":8.5,"v2026":null},{"name":"インド","v2024":8.5,"v2025":11.1,"v2026":null},{"name":"アメリカ","v2024":11.0,"v2025":7.2,"v2026":null},{"name":"UAE","v2024":33.0,"v2025":57.2,"v2026":23.8},{"name":"インドネシア","v2024":7.7,"v2025":16.3,"v2026":12.4},{"name":"イスラエル","v2024":7.9,"v2025":12.5,"v2026":null},{"name":"アルゼンチン","v2024":1.4,"v2025":8.0,"v2026":8.2},{"name":"ヨルダン","v2024":1.7,"v2025":4.9,"v2026":7.5},{"name":"スロベニア","v2024":4.1,"v2025":4.8,"v2026":8.2}],"nevCtry":[{"name":"ブラジル","v2024":15.2,"v2025":20.1,"v2026":37.9},{"name":"ベルギー","v2024":26.4,"v2025":28.5,"v2026":35.1},{"name":"英国","v2024":11.9,"v2025":23.1,"v2026":31.4},{"name":"ドイツ","v2024":6.0,"v2025":8.6,"v2026":14.2},{"name":"タイ","v2024":11.7,"v2025":15.2,"v2026":21.3},{"name":"オーストラリア","v2024":7.5,"v2025":14.6,"v2026":27.1},{"name":"イタリア","v2024":1.4,"v2025":6.6,"v2026":13.3},{"name":"韓国","v2024":4.3,"v2025":7.8,"v2026":12.5},{"name":"香港","v2024":2.5,"v2025":3.8,"v2026":null},{"name":"スペイン","v2024":6.1,"v2025":9.0,"v2026":13.1},{"name":"フィリピン","v2024":11.4,"v2025":20.1,"v2026":20.5},{"name":"メキシコ","v2024":8.0,"v2025":22.1,"v2026":7.4},{"name":"インドネシア","v2024":5.3,"v2025":12.7,"v2026":9.3},{"name":"マレーシア","v2024":2.3,"v2025":5.3,"v2026":7.3},{"name":"ウズベキスタン","v2024":5.8,"v2025":5.4,"v2026":5.1},{"name":"インド","v2024":7.8,"v2025":10.3,"v2026":7.6},{"name":"ロシア","v2024":2.2,"v2025":5.3,"v2026":7.4},{"name":"スロベニア","v2024":3.0,"v2025":3.2,"v2026":6.5},{"name":"コロンビア","v2024":0.9,"v2025":3.6,"v2026":6.6},{"name":"ノルウェー","v2024":0.5,"v2025":1.6,"v2026":null},{"name":"ヨルダン","v2024":1.1,"v2025":3.5,"v2026":5.0},{"name":"フランス","v2024":1.1,"v2025":1.1,"v2026":null},{"name":"イスラエル","v2024":6.5,"v2025":9.8,"v2026":5.8},{"name":"キルギス","v2024":2.5,"v2025":3.0,"v2026":5.4},{"name":"ベラルーシ","v2024":1.4,"v2025":3.1,"v2026":null},{"name":"サウジ","v2024":0.5,"v2025":1.3,"v2026":null},{"name":"カンボジア","v2024":0.6,"v2025":2.2,"v2026":null},{"name":"パキスタン","v2024":0.2,"v2025":1.2,"v2026":4.0},{"name":"日本","v2024":1.5,"v2025":2.4,"v2026":null},{"name":"アメリカ","v2024":0.8,"v2025":1.5,"v2026":null},{"name":"ウルグアイ","v2024":0.8,"v2025":2.0,"v2026":3.0},{"name":"エジプト","v2024":0.3,"v2025":1.0,"v2026":2.4},{"name":"南アフリカ","v2024":0.2,"v2025":1.3,"v2026":null},{"name":"UAE","v2024":7.7,"v2025":19.2,"v2026":9.0},{"name":"アルゼンチン","v2024":0.1,"v2025":1.8,"v2026":3.2},{"name":"カザフスタン","v2024":1.8,"v2025":4.2,"v2026":null},{"name":"ポーランド","v2024":0.7,"v2025":4.1,"v2026":null},{"name":"ニュージーランド","v2024":0.3,"v2025":1.0,"v2026":2.4},{"name":"エクアドル","v2024":0.3,"v2025":1.0,"v2026":null},{"name":"オランダ","v2024":2.2,"v2025":2.1,"v2026":2.8},{"name":"ジブチ","v2024":0.8,"v2025":1.4,"v2026":1.8}],"provs":[{"name":"安徽","v":[10.02,8.4,24.4,38.5,72.9,95.3,122.7,172.7],"price2026":1.53},{"name":"上海","v":[16.33,17.3,48.7,79.6,94.1,79.2,98.4,110.4],"price2026":2.05},{"name":"江蘇","v":[8.358,5.1,8.9,13.4,25.6,41.3,78.5,60.3],"price2026":1.76},{"name":"浙江","v":[10.3,8.2,18.2,29.2,40.3,49.6,73.4,91.0],"price2026":1.55},{"name":"重慶","v":[9.734,7.9,19.7,28.6,36.6,47.3,60.7,57.6],"price2026":1.24},{"name":"河北","v":[11.65,8.4,17.9,18.8,37.9,58.8,52.6,56.8],"price2026":1.43},{"name":"広東","v":[2.783,2.0,3.7,10.8,23.8,35.4,48.9,42.3],"price2026":1.78},{"name":"山東","v":[15.59,8.8,21.2,27.2,30.7,31.7,38.7,37.9],"price2026":2.62},{"name":"河南","v":[3.338,1.4,2.3,10.7,20.9,22.0,32.3,25.2],"price2026":2.61},{"name":"北京","v":[8.433,5.3,8.9,10.7,15.7,24.4,31.2,27.7],"price2026":1.41},{"name":"陝西","v":[2.4,1.2,2.5,3.1,9.3,23.8,30.4,28.6],"price2026":2.29},{"name":"広西","v":[2.927,3.2,9.7,15.0,20.0,21.8,24.8,25.6],"price2026":1.24},{"name":"湖南","v":[0.435,0.6,1.4,3.9,10.1,17.0,22.4,24.7],"price2026":1.86},{"name":"江西","v":[2.056,2.1,4.1,6.6,14.8,14.7,19.8,23.3],"price2026":1.4},{"name":"湖北","v":[1.666,1.1,6.0,10.4,14.4,15.6,19.9,20.5],"price2026":1.82},{"name":"天津","v":[0.844,0.3,3.5,6.9,7.4,10.6,17.4,11.1],"price2026":0.76},{"name":"福建","v":[2.744,1.8,1.8,2.8,8.9,8.7,14.5,8.4],"price2026":2.36},{"name":"四川","v":[3.797,3.4,4.2,6.5,12.5,12.8,11.8,9.4],"price2026":2.02},{"name":"吉林","v":[1.157,1.1,2.1,3.8,9.9,9.3,8.7,6.2],"price2026":2.32},{"name":"新疆","v":[0.219,0.4,0.6,2.6,5.4,6.5,8.3,7.5],"price2026":2.28},{"name":"遼寧","v":[0.917,0.8,3.0,3.7,4.7,4.3,6.2,4.1],"price2026":2.62},{"name":"黒龍江","v":[0.995,0.7,0.9,1.3,2.1,3.7,4.0,4.3],"price2026":1.97},{"name":"内蒙","v":[0.087,0.2,0.3,0.7,3.6,5.0,4.0,3.1],"price2026":2.46},{"name":"山西","v":[0.059,0.1,0.5,0.4,0.8,0.7,1.1,0.8],"price2026":0.93}],"nevProvs":[{"name":"安徽","v":[0.1,0.1,0.3,1.6,2.8,8.5,37.1,73.7]},{"name":"江蘇","v":[4.1,1.6,3.3,5.9,12.2,19.0,53.0,43.2]},{"name":"浙江","v":[9,4.8,9.6,18.6,21.8,15.8,36.8,59.3]},{"name":"上海","v":[1.2,2.5,20.6,41.0,57.6,40.3,43.9,62.9]},{"name":"広東","v":[0.1,0.2,1.4,7.2,16.9,23.5,32.1,27.9]},{"name":"河南","v":[0.2,0.2,0.3,1.4,0.9,2.0,14.8,15.9]},{"name":"湖南","v":[0,0.1,0.2,1.0,1.7,4.3,9.9,10.3]},{"name":"天津","v":[0.7,0.2,3.3,6.7,6.3,8.0,14.5,8.7]},{"name":"重慶","v":[0.1,0.1,0.3,0.9,2.4,5.1,11.9,17.0]},{"name":"陝西","v":[0,0.0,0.1,0.2,3.2,14.7,23.5,20.4]},{"name":"湖北","v":[0,0.0,3.5,6.4,8.6,6.7,6.8,9.3]},{"name":"福建","v":[0,0.1,0.1,0.6,2.3,3.7,6.5,3.3]},{"name":"山東","v":[0.2,0.3,0.7,1.1,2.3,3.2,6.2,6.2]},{"name":"河北","v":[3.9,2.4,3.7,3.3,7.4,17.9,12.4,12.5]},{"name":"広西","v":[0,0.2,0.1,0.8,4.7,4.5,5.5,8.0]},{"name":"四川","v":[1.1,1.8,1.5,2.5,4.3,5.3,6.0,4.5]},{"name":"北京","v":[4.3,2.2,3.5,4.0,5.8,8.4,10.5,8.4]},{"name":"新疆","v":[0,0.0,0.1,0.3,0.8,1.5,2.8,2.8]},{"name":"吉林","v":[0,0.0,0.1,0.6,1.0,0.9,1.3,0.7]},{"name":"江西","v":[0,0.1,0.2,0.3,5.2,2.7,3.8,8.4]},{"name":"遼寧","v":[0,0.1,2.2,3.0,3.7,2.7,1.5,1.0]},{"name":"西蔵","v":[null,null,0.0,0.0,0.1,0.2,0.3,0.6]}],"rankYears":["2020年","2021年","2022年","2023年","2024年","2025年","2026.1-4月","2026.1-9月","2026.9月"],"rankData":[{"rank":1,"vals":["サウジ","チリ","メキシコ","ロシア","ロシア","メキシコ","ブラジル","ロシア","ロシア"]},{"rank":2,"vals":["バングラデシュ","サウジ","サウジ","メキシコ","メキシコ","ロシア","ロシア","ブラジル","英国"]},{"rank":3,"vals":["エジプト","ロシア","チリ","ベルギー","UAE","UAE","英国","英国","ブラジル"]},{"rank":4,"vals":["チリ","ベルギー","ベルギー","オーストラリア","ベルギー","英国","ベルギー","オーストラリア","オーストラリア"]},{"rank":5,"vals":["インド","オーストラリア","オーストラリア","サウジ","ブラジル","ブラジル","オーストラリア","ベルギー","ベルギー"]},{"rank":6,"vals":["ロシア","メキシコ","英国","英国","サウジ","サウジ","UAE","メキシコ","タイ"]},{"rank":7,"vals":["オーストラリア","エジプト","フィリピン","フィリピン","英国","ベルギー","メキシコ","イタリア","UAE"]},{"rank":8,"vals":["アメリカ","バングラデシュ","ロシア","タイ","オーストラリア","オーストラリア","イタリア","UAE","メキシコ"]},{"rank":9,"vals":["マレーシア","英国","マレーシア","UAE","フィリピン","フィリピン","アルジェリア","フィリピン","イタリア"]},{"rank":10,"vals":["メキシコ","フィリピン","UAE","スペイン","トルコ","カザフスタン","スペイン","タイ","スペイン"]},{"rank":11,"vals":["ベトナム","ペルー","タイ","トルコ","タイ","マレーシア","サウジ","アルジェリア","ドイツ"]},{"rank":12,"vals":["フィリピン","インド","アメリカ","ウズベキスタン","マレーシア","アルジェリア","マレーシア","スペイン","カザフスタン"]},{"rank":13,"vals":["ペルー","アメリカ","ペルー","ブラジル","ベラルーシ","タイ","ドイツ","サウジ","マレーシア"]},{"rank":14,"vals":["英国","タイ","エクアドル","カザフスタン","チリ","イタリア","タイ","マレーシア","エジプト"]},{"rank":15,"vals":["ブラジル","ベトナム","ベトナム","チリ","スペイン","インドネシア","エジプト","ドイツ","アルジェリア"]}],"russia":{"2021":[8021,7145,9207,12486,7540,9935,9087,13371,8584,12675,12425,12545],"2022":[17430,11816,14292,7357,3932,4955,5363,5552,13848,18460,26896,32346],"2023":[34418,44855,62976,76970,68190,83078,93174,80051,95440,96964,104489,68295],"2024":[62309,50058,63949,94001,104355,103615,96025,130889,144387,107304,102613,97926],"2025":[40653,16855,41676,33151,21928,26398,49214,58707,69126,93489,61881,69660],"2026":[48465,63137,80542,77248,93482,84249,94700,96853,112962,null,null,null]},"displace":[{"power":"ガソリン","range":"2.5L＜排量≦3L","vals":{"2022":0.08,"2023":1.86,"2024":0.98,"2025":1.31,"2026":1}},{"power":"ガソリン","range":"2L＜排量≦2.5L","vals":{"2022":0.2,"2023":1.51,"2024":0.45,"2025":0.59,"2026":0}},{"power":"ガソリン","range":"1.5L＜排量≦2L","vals":{"2022":38.4,"2023":76.1,"2024":115.9,"2025":100.8,"2026":80}},{"power":"ガソリン","range":"1L＜排量≦1.5L","vals":{"2022":119.2,"2023":179.6,"2024":202.8,"2025":221,"2026":199}},{"power":"ガソリン","range":"排量≦1L","vals":{"2022":3.27,"2023":6.4,"2024":4.33,"2025":2.36,"2026":1}},{"power":"ディーゼル","range":"（全排量）","vals":{"2022":0.62,"2023":0.67,"2024":1.13,"2025":3.05,"2026":3}},{"power":"HEV","range":"2L＜排量≦2.5L","vals":{"2022":0.04,"2023":0.1,"2024":0.23,"2025":0.8,"2026":null}},{"power":"HEV","range":"1L＜排量≦1.5L","vals":{"2022":1.67,"2023":7.73,"2024":25.55,"2025":49.83,"2026":63}},{"power":"HEV","range":"排量≦1L","vals":{"2022":null,"2023":0,"2024":0,"2025":null,"2026":null}},{"power":"PHEV","range":"2L＜排量≦2.5L","vals":{"2022":0,"2023":0.01,"2024":0.01,"2025":0.02,"2026":null}},{"power":"PHEV","range":"1.5L＜排量≦2L","vals":{"2022":2.26,"2023":3.15,"2024":3,"2025":5.21,"2026":7}},{"power":"PHEV","range":"1L＜排量≦1.5L","vals":{"2022":10.62,"2023":27.2,"2024":27,"2025":100.44,"2026":142}},{"power":"PHEV","range":"排量≦1L","vals":{"2022":null,"2023":0,"2024":0,"2025":null,"2026":null}},{"power":"BEV","range":"（全排量）","vals":{"2022":95,"2023":154,"2024":165,"2025":221,"2026":247}},{"power":"不明","range":"（全排量）","vals":{"2022":0.21,"2023":0.31,"2024":0.67,"2025":0.85,"2026":1}}],"rankings":{"r3":[{"title":"2025年1〜2月累計","data":[{"country":"メキシコ","value":85997},{"country":"UAE","value":71418},{"country":"ロシア","value":57592},{"country":"ベルギー","value":48546},{"country":"サウジ","value":43366},{"country":"英国","value":37066},{"country":"オーストラリア","value":36117},{"country":"トルコ","value":33241},{"country":"フィリピン","value":30524},{"country":"ブラジル","value":27345}]},{"title":"2025年3月","data":[{"country":"メキシコ","value":52646},{"country":"ロシア","value":41741},{"country":"UAE","value":36490},{"country":"サウジ","value":25535},{"country":"オーストラリア","value":24824},{"country":"ブラジル","value":24790},{"country":"ベルギー","value":19810},{"country":"フィリピン","value":16549},{"country":"タイ","value":15153},{"country":"英国","value":14754}]},{"title":"2025年4月","data":[{"country":"メキシコ","value":49139},{"country":"ブラジル","value":41404},{"country":"ロシア","value":32406},{"country":"UAE","value":31146},{"country":"オーストラリア","value":29965},{"country":"英国","value":26421},{"country":"ベルギー","value":25636},{"country":"フィリピン","value":23672},{"country":"サウジ","value":23084},{"country":"マレーシア","value":18237}]},{"title":"2025年5月","data":[{"country":"メキシコ","value":51927},{"country":"UAE","value":50493},{"country":"ブラジル","value":47454},{"country":"オーストラリア","value":33290},{"country":"ベルギー","value":31118},{"country":"英国","value":29393},{"country":"サウジ","value":27579},{"country":"フィリピン","value":26944},{"country":"ロシア","value":21925},{"country":"カザフ","value":17788}]},{"title":"2025年6月","data":[{"country":"メキシコ","value":40391},{"country":"UAE","value":39432},{"country":"英国","value":28664},{"country":"サウジ","value":27713},{"country":"ロシア","value":26425},{"country":"フィリピン","value":24940},{"country":"ベルギー","value":24536},{"country":"ブラジル","value":20376},{"country":"カザフスタン","value":20086},{"country":"オーストラリア","value":19489}]},{"title":"2025年7月","data":[{"country":"ロシア","value":48712},{"country":"UAE","value":44531},{"country":"メキシコ","value":43137},{"country":"ベルギー","value":32425},{"country":"英国","value":31791},{"country":"フィリピン","value":27778},{"country":"オーストラリア","value":24434},{"country":"サウジ","value":22818},{"country":"カザフ","value":21082},{"country":"マレーシア","value":16094}]},{"title":"2025年8月","data":[{"country":"ロシア","value":58707},{"country":"UAE","value":46616},{"country":"メキシコ","value":38994},{"country":"オーストラリア","value":31020},{"country":"英国","value":28821},{"country":"ベルギー","value":28289},{"country":"サウジ","value":28012},{"country":"フィリピン","value":26025},{"country":"アルジェリア","value":22265},{"country":"カザフスタン","value":21064}]},{"title":"2025年9月","data":[{"country":"ロシア","value":69126},{"country":"メキシコ","value":48636},{"country":"UAE","value":47700},{"country":"英国","value":27567},{"country":"サウジ","value":26008},{"country":"オーストラリア","value":24467},{"country":"ブラジル","value":24302},{"country":"ベルギー","value":21825},{"country":"フィリピン","value":20105},{"country":"アルジェリア","value":19668}]},{"title":"2025年10月","data":[{"country":"ロシア","value":93489},{"country":"メキシコ","value":72502},{"country":"UAE","value":44629},{"country":"ブラジル","value":37745},{"country":"英国","value":31729},{"country":"ベルギー","value":30143},{"country":"オーストラリア","value":28890},{"country":"サウジ","value":25343},{"country":"フィリピン","value":21911},{"country":"カザフスタン","value":20601}]},{"title":"2025年11月","data":[{"country":"メキシコ","value":90212},{"country":"ロシア","value":61881},{"country":"UAE","value":53114},{"country":"ブラジル","value":29231},{"country":"オーストラリア","value":26121},{"country":"英国","value":24441},{"country":"アルジェリア","value":21532},{"country":"キルギス","value":21372},{"country":"インドネシア","value":20915},{"country":"カザフスタン","value":20213}]},{"title":"2025年12月","data":[{"country":"UAE","value":106398},{"country":"ロシア","value":69660},{"country":"英国","value":54791},{"country":"メキシコ","value":51734},{"country":"アルジェリア","value":38792},{"country":"ブラジル","value":36954},{"country":"サウジ","value":36427},{"country":"タイ","value":26700},{"country":"ベルギー","value":24339},{"country":"イタリア","value":23857}]},{"title":"2025年2月","data":[{"country":"ロシア","value":63286},{"country":"ブラジル","value":57470},{"country":"英国","value":32861},{"country":"UAE","value":32021},{"country":"イタリア","value":30391},{"country":"メキシコ","value":27137},{"country":"サウジ","value":23412},{"country":"ベルギー","value":22747},{"country":"オーストラリア","value":21184},{"country":"スペイン","value":19911}]},{"title":"2024年12月","data":[{"country":"ロシア","value":97998},{"country":"UAE","value":38663},{"country":"サウジ","value":33337},{"country":"メキシコ","value":22775},{"country":"ベルギー","value":22371},{"country":"オーストラリア","value":15361},{"country":"カザフスタン","value":14975},{"country":"フィリピン","value":14331},{"country":"英国","value":14003},{"country":"ベラルーシ","value":13804}]},{"title":"2024年11月","data":[{"country":"ロシア","value":102673},{"country":"メキシコ","value":35582},{"country":"UAE","value":30289},{"country":"サウジ","value":25494},{"country":"フィリピン","value":16614},{"country":"スペイン","value":14660},{"country":"英国","value":13687},{"country":"カザフスタン","value":13661},{"country":"オーストラリア","value":12877},{"country":"マレーシア","value":12153}]},{"title":"2026年2月","data":[{"country":"ロシア","value":63286},{"country":"ブラジル","value":57470},{"country":"英国","value":32861},{"country":"UAE","value":32021},{"country":"イタリア","value":30391},{"country":"メキシコ","value":27137},{"country":"サウジ","value":23412},{"country":"ベルギー","value":22747},{"country":"オーストラリア","value":21184},{"country":"スペイン","value":19911}]},{"title":"2026年1〜2月累計","data":[{"country":"メキシコ","value":85997},{"country":"UAE","value":71418},{"country":"ロシア","value":57592},{"country":"ベルギー","value":48546},{"country":"サウジ","value":43366},{"country":"英国","value":37066},{"country":"オーストラリア","value":36117},{"country":"トルコ","value":33241},{"country":"フィリピン","value":30524},{"country":"ブラジル","value":27345}]},{"title":"2026年3月","data":[{"country":"ロシア","value":80542},{"country":"ブラジル","value":69881},{"country":"メキシコ","value":40111},{"country":"英国","value":37301},{"country":"ベルギー","value":32943},{"country":"オーストラリア","value":25920},{"country":"イタリア","value":24036},{"country":"ドイツ","value":18214},{"country":"アルジェリア","value":17797},{"country":"キルギス","value":17076}]},{"title":"2026年1〜3月累計","data":[{"country":"ロシア","value":192144},{"country":"ブラジル","value":173368},{"country":"UAE","value":113377},{"country":"英国","value":111442},{"country":"メキシコ","value":88505},{"country":"ベルギー","value":84246},{"country":"イタリア","value":75649},{"country":"オーストラリア","value":74549},{"country":"サウジ","value":62546},{"country":"アルジェリア","value":58580}]},{"title":"2026年4月","data":[{"country":"ブラジル","value":121766},{"country":"ロシア","value":77524},{"country":"ベルギー","value":51480},{"country":"オーストラリア","value":49870},{"country":"英国","value":43837},{"country":"メキシコ","value":29348},{"country":"フィリピン","value":26653},{"country":"アルジェリア","value":22685},{"country":"タイ","value":22505},{"country":"イタリア","value":22000}]},{"title":"2026年1〜4月累計","data":[{"country":"ブラジル","value":295134},{"country":"ロシア","value":269668},{"country":"英国","value":155279},{"country":"ベルギー","value":135726},{"country":"オーストラリア","value":124419},{"country":"UAE","value":119701},{"country":"メキシコ","value":117853},{"country":"イタリア","value":97649},{"country":"アルジェリア","value":81265},{"country":"スペイン","value":74558}]},{"title":"2026年7月","data":[{"country":"ロシア","value":94529},{"country":"英国","value":65244},{"country":"メキシコ","value":55559},{"country":"ベルギー","value":52073},{"country":"オーストラリア","value":51189},{"country":"フィリピン","value":39712},{"country":"タイ","value":28548},{"country":"サウジ","value":25330},{"country":"イタリア","value":25310},{"country":"スペイン","value":25072}]},{"title":"2026年8月","data":[{"country":"ロシア","value":96650},{"country":"メキシコ","value":56549},{"country":"ブラジル","value":53223},{"country":"ベルギー","value":50842},{"country":"英国","value":45259},{"country":"オーストラリア","value":38166},{"country":"UAE","value":30146},{"country":"イタリア","value":29091},{"country":"カザフスタン","value":27538},{"country":"フィリピン","value":26983}]},{"title":"2026年1〜8月累計","data":[{"country":"ロシア","value":638224},{"country":"ブラジル","value":480403},{"country":"英国","value":365672},{"country":"オーストラリア","value":326938},{"country":"ベルギー","value":322562},{"country":"メキシコ","value":320844},{"country":"フィリピン","value":214359},{"country":"イタリア","value":209258},{"country":"UAE","value":196117},{"country":"アルジェリア","value":190045}]},{"title":"2026年9月","data":[{"country":"ロシア","value":112962},{"country":"英国","value":58740},{"country":"ブラジル","value":58725},{"country":"オーストラリア","value":46559},{"country":"ベルギー","value":45369},{"country":"タイ","value":39323},{"country":"UAE","value":39120},{"country":"メキシコ","value":38962},{"country":"イタリア","value":37731},{"country":"スペイン","value":34051}]},{"title":"2026年1〜9月累計","data":[{"country":"ロシア","value":752602},{"country":"ブラジル","value":539675},{"country":"英国","value":424173},{"country":"オーストラリア","value":373674},{"country":"ベルギー","value":367879},{"country":"メキシコ","value":361518},{"country":"イタリア","value":245836},{"country":"UAE","value":237970},{"country":"フィリピン","value":235933},{"country":"タイ","value":224121}]}],"r4":[{"title":"2025年1〜2月累計","data":[{"country":"ベルギー","value":46162},{"country":"トルコ","value":25458},{"country":"メキシコ","value":24786},{"country":"英国","value":21579},{"country":"フィリピン","value":20782},{"country":"タイ","value":17274},{"country":"UAE","value":16796},{"country":"ブラジル","value":16196},{"country":"オーストラリア","value":15411},{"country":"イスラエル","value":11720}]},{"title":"2025年3月","data":[{"country":"メキシコ","value":23976},{"country":"ブラジル","value":19037},{"country":"ベルギー","value":18398},{"country":"タイ","value":14467},{"country":"フィリピン","value":12589},{"country":"英国","value":11161},{"country":"オーストラリア","value":10512},{"country":"インド","value":8978},{"country":"イスラエル","value":8388},{"country":"トルコ","value":6773}]},{"title":"2025年4月","data":[{"country":"ブラジル","value":34802},{"country":"ベルギー","value":24713},{"country":"メキシコ","value":21513},{"country":"英国","value":18529},{"country":"フィリピン","value":18407},{"country":"オーストラリア","value":16464},{"country":"タイ","value":12035},{"country":"トルコ","value":10688},{"country":"インドネシア","value":8754},{"country":"スペイン","value":8241}]},{"title":"2025年5月","data":[{"country":"ブラジル","value":35478},{"country":"ベルギー","value":30405},{"country":"フィリピン","value":21517},{"country":"英国","value":21456},{"country":"メキシコ","value":14587},{"country":"オーストラリア","value":14250},{"country":"トルコ","value":11341},{"country":"韓国","value":10436},{"country":"インド","value":10334},{"country":"スペイン","value":8751}]},{"title":"2025年6月","data":[{"country":"ベルギー","value":23940},{"country":"英国","value":18888},{"country":"フィリピン","value":18554},{"country":"メキシコ","value":12676},{"country":"オーストラリア","value":11739},{"country":"ブラジル","value":10955},{"country":"イスラエル","value":10271},{"country":"スペイン","value":10047},{"country":"インドネシア","value":9727},{"country":"UAE","value":8127}]},{"title":"2025年7月","data":[{"country":"ベルギー","value":30152},{"country":"フィリピン","value":23325},{"country":"英国","value":22265},{"country":"メキシコ","value":18810},{"country":"オーストラリア","value":16351},{"country":"タイ","value":13149},{"country":"インドネシア","value":12734},{"country":"UAE","value":10548},{"country":"インド","value":8628},{"country":"ドイツ","value":8230}]},{"title":"2025年8月","data":[{"country":"ベルギー","value":27247},{"country":"フィリピン","value":21957},{"country":"英国","value":19435},{"country":"韓国","value":15500},{"country":"UAE","value":15424},{"country":"オーストラリア","value":15017},{"country":"ドイツ","value":14289},{"country":"インド","value":12444},{"country":"タイ","value":11308},{"country":"スペイン","value":10545}]},{"title":"2025年9月","data":[{"country":"ベルギー","value":20869},{"country":"UAE","value":20859},{"country":"英国","value":19521},{"country":"フィリピン","value":16012},{"country":"インドネシア","value":15596},{"country":"タイ","value":12513},{"country":"ブラジル","value":11371},{"country":"ドイツ","value":10534},{"country":"オーストラリア","value":9365},{"country":"イスラエル","value":9256}]},{"title":"2025年10月","data":[{"country":"ベルギー","value":27907},{"country":"ブラジル","value":22276},{"country":"英国","value":22017},{"country":"UAE","value":19941},{"country":"メキシコ","value":19006},{"country":"フィリピン","value":17962},{"country":"オーストラリア","value":15007},{"country":"タイ","value":14989},{"country":"インド","value":13609},{"country":"インドネシア","value":11388}]},{"title":"2025年11月","data":[{"country":"メキシコ","value":48172},{"country":"UAE","value":25895},{"country":"英国","value":19191},{"country":"インドネシア","value":18337},{"country":"ブラジル","value":15709},{"country":"フィリピン","value":14486},{"country":"タイ","value":14420},{"country":"オーストラリア","value":10908},{"country":"イスラエル","value":10905},{"country":"ベルギー","value":10809}]},{"title":"2025年12月","data":[{"country":"UAE","value":53326},{"country":"英国","value":36708},{"country":"タイ","value":24905},{"country":"ベルギー","value":22673},{"country":"メキシコ","value":21986},{"country":"ブラジル","value":21523},{"country":"インドネシア","value":19968},{"country":"フィリピン","value":14710},{"country":"イタリア","value":14048},{"country":"ドイツ","value":11531}]},{"title":"2025年2月","data":[{"country":"ブラジル","value":45935},{"country":"英国","value":22794},{"country":"ベルギー","value":20675},{"country":"イタリア","value":17639},{"country":"タイ","value":14398},{"country":"ドイツ","value":12853},{"country":"韓国","value":11804},{"country":"スペイン","value":11082},{"country":"オーストラリア","value":10505},{"country":"インドネシア","value":10497}]},{"title":"2024年12月","data":[{"country":"ベルギー","value":21446},{"country":"タイ","value":11260},{"country":"UAE","value":9584},{"country":"フィリピン","value":8756},{"country":"英国","value":7425},{"country":"オーストラリア","value":6415},{"country":"ウズベキスタン","value":6410},{"country":"オランダ","value":5463},{"country":"スペイン","value":5315},{"country":"インド","value":5166}]},{"title":"2024年11月","data":[{"country":"フィリピン","value":11563},{"country":"ベルギー","value":9357},{"country":"タイ","value":8526},{"country":"インド","value":7807},{"country":"バングラデシュ","value":6311},{"country":"UAE","value":6267},{"country":"英国","value":5096},{"country":"ブラジル","value":4819},{"country":"インドネシア","value":4452},{"country":"ドイツ","value":4426}]},{"title":"2026年2月","data":[{"country":"ブラジル","value":45935},{"country":"英国","value":22794},{"country":"ベルギー","value":20675},{"country":"イタリア","value":17639},{"country":"タイ","value":14398},{"country":"ドイツ","value":12853},{"country":"韓国","value":11804},{"country":"スペイン","value":11082},{"country":"オーストラリア","value":10505},{"country":"インドネシア","value":10497}]},{"title":"2026年1〜2月累計","data":[{"country":"UAE","value":40346},{"country":"ブラジル","value":32676},{"country":"英国","value":29723},{"country":"フィリピン","value":27888},{"country":"オーストラリア","value":16052},{"country":"イタリア","value":12638},{"country":"スペイン","value":11137},{"country":"ドイツ","value":12103}]},{"title":"2026年3月","data":[{"country":"ブラジル","value":51243},{"country":"ベルギー","value":32197},{"country":"英国","value":24047},{"country":"ドイツ","value":17013},{"country":"タイ","value":15940},{"country":"オーストラリア","value":15675},{"country":"イタリア","value":13430},{"country":"韓国","value":12672},{"country":"香港","value":11210},{"country":"スペイン","value":9154}]},{"title":"2026年1〜3月累計","data":[{"country":"ブラジル","value":129706},{"country":"ベルギー","value":80634},{"country":"英国","value":76493},{"country":"UAE","value":49151},{"country":"イタリア","value":43702},{"country":"オーストラリア","value":42193},{"country":"ドイツ","value":40745},{"country":"タイ","value":39659},{"country":"スペイン","value":32331}]},{"title":"2026年4月","data":[{"country":"ブラジル","value":92482},{"country":"ベルギー","value":49227},{"country":"オーストラリア","value":34774},{"country":"英国","value":30910},{"country":"フィリピン","value":23426},{"country":"タイ","value":20901},{"country":"韓国","value":18741},{"country":"ドイツ","value":15040},{"country":"インド","value":11892},{"country":"スペイン","value":11750}]},{"title":"2026年1〜4月累計","data":[{"country":"ブラジル","value":222188},{"country":"ベルギー","value":129861},{"country":"英国","value":107403},{"country":"オーストラリア","value":76967},{"country":"タイ","value":60560},{"country":"ドイツ","value":55785},{"country":"イタリア","value":54636},{"country":"UAE","value":51940},{"country":"韓国","value":49963},{"country":"フィリピン","value":49330}]},{"title":"2026年7月","data":[{"country":"英国","value":51411},{"country":"ベルギー","value":49400},{"country":"オーストラリア","value":40450},{"country":"フィリピン","value":36843},{"country":"タイ","value":27976},{"country":"韓国","value":17788},{"country":"スペイン","value":15895},{"country":"インドネシア","value":15800},{"country":"イタリア","value":14835},{"country":"メキシコ","value":12387}]},{"title":"2026年8月","data":[{"country":"ベルギー","value":48740},{"country":"英国","value":37419},{"country":"ブラジル","value":30570},{"country":"オーストラリア","value":29564},{"country":"フィリピン","value":25265},{"country":"タイ","value":21119},{"country":"ドイツ","value":20341},{"country":"スペイン","value":17791},{"country":"韓国","value":17136},{"country":"イタリア","value":14762}]},{"title":"2026年1〜8月累計","data":[{"country":"ブラジル","value":337104},{"country":"ベルギー","value":307357},{"country":"英国","value":270090},{"country":"オーストラリア","value":237140},{"country":"フィリピン","value":188170},{"country":"タイ","value":175741},{"country":"ドイツ","value":115917},{"country":"韓国","value":110354},{"country":"イタリア","value":109100},{"country":"スペイン","value":106409}]},{"title":"2026年9月","data":[{"country":"ベルギー","value":43675},{"country":"英国","value":43548},{"country":"ブラジル","value":42130},{"country":"タイ","value":37714},{"country":"オーストラリア","value":33437},{"country":"ドイツ","value":26465},{"country":"スペイン","value":24711},{"country":"イタリア","value":24134},{"country":"ロシア","value":17520},{"country":"フィリピン","value":17027}]},{"title":"2026年1〜9月累計","data":[{"country":"ブラジル","value":379234},{"country":"ベルギー","value":351032},{"country":"英国","value":313638},{"country":"オーストラリア","value":270577},{"country":"タイ","value":213455},{"country":"フィリピン","value":205197},{"country":"ドイツ","value":142382},{"country":"イタリア","value":133234},{"country":"スペイン","value":131120},{"country":"韓国","value":125164}]}],"r5":[{"title":"2025年1〜2月累計","data":[{"country":"ロシア","value":52891},{"country":"UAE","value":51626},{"country":"メキシコ","value":47369},{"country":"サウジ","value":35198},{"country":"イタリア","value":18095},{"country":"カザフスタン","value":18051},{"country":"オーストラリア","value":17633},{"country":"英国","value":14875},{"country":"マレーシア","value":14835},{"country":"チリ","value":14074}]},{"title":"2025年3月","data":[{"country":"ロシア","value":38007},{"country":"メキシコ","value":21414},{"country":"UAE","value":19236},{"country":"サウジ","value":19029},{"country":"カザフ","value":10415},{"country":"オーストラリア","value":9962},{"country":"イタリア","value":8343},{"country":"ベラルーシ","value":7896},{"country":"マレーシア","value":7149},{"country":"チリ","value":6835}]},{"title":"2025年4月","data":[{"country":"ロシア","value":28378},{"country":"メキシコ","value":18934},{"country":"UAE","value":16839},{"country":"サウジ","value":16226},{"country":"マレーシア","value":10801},{"country":"オーストラリア","value":10794},{"country":"カザフスタン","value":10500},{"country":"エジプト","value":7373},{"country":"ベラルーシ","value":7041},{"country":"チリ","value":6736}]},{"title":"2025年5月","data":[{"country":"メキシコ","value":28330},{"country":"UAE","value":27742},{"country":"サウジ","value":22680},{"country":"ロシア","value":16841},{"country":"オーストラリア","value":15356},{"country":"カザフ","value":12324},{"country":"マレーシア","value":11827},{"country":"アルジェリア","value":8674},{"country":"チリ","value":7673},{"country":"ブラジル","value":7132}]},{"title":"2025年6月","data":[{"country":"サウジ","value":21847},{"country":"ロシア","value":20696},{"country":"メキシコ","value":20616},{"country":"UAE","value":20059},{"country":"カザフスタン","value":14315},{"country":"アルジェリア","value":13184},{"country":"マレーシア","value":10673},{"country":"ブラジル","value":8269},{"country":"ベラルーシ","value":8233},{"country":"キルギス","value":6926}]},{"title":"2025年7月","data":[{"country":"ロシア","value":41486},{"country":"UAE","value":21036},{"country":"サウジ","value":18779},{"country":"メキシコ","value":17836},{"country":"カザフ","value":15455},{"country":"アルジェリア","value":13898},{"country":"マレーシア","value":10813},{"country":"キルギス","value":8699},{"country":"ベラルーシ","value":8299},{"country":"ブラジル","value":6898}]},{"title":"2025年8月","data":[{"country":"ロシア","value":53183},{"country":"メキシコ","value":24446},{"country":"サウジ","value":23418},{"country":"アルジェリア","value":20771},{"country":"UAE","value":19628},{"country":"カザフスタン","value":14410},{"country":"キルギス","value":11220},{"country":"エジプト","value":10815},{"country":"オーストラリア","value":9664},{"country":"マレーシア","value":8837}]},{"title":"2025年9月","data":[{"country":"ロシア","value":59967},{"country":"メキシコ","value":28989},{"country":"サウジ","value":20650},{"country":"アルジェリア","value":18097},{"country":"UAE","value":16866},{"country":"南アフリカ","value":11609},{"country":"カザフスタン","value":11285},{"country":"キルギス","value":10478},{"country":"オーストラリア","value":10104},{"country":"ブラジル","value":8630}]},{"title":"2025年10月","data":[{"country":"ロシア","value":81100},{"country":"メキシコ","value":43703},{"country":"UAE","value":18929},{"country":"サウジ","value":18218},{"country":"アルジェリア","value":15022},{"country":"キルギス","value":12604},{"country":"カザフスタン","value":12481},{"country":"南アフリカ","value":10606},{"country":"ブラジル","value":10589},{"country":"マレーシア","value":10312}]},{"title":"2025年11月","data":[{"country":"ロシア","value":48749},{"country":"メキシコ","value":28935},{"country":"UAE","value":20755},{"country":"アルジェリア","value":15915},{"country":"キルギス","value":13431},{"country":"サウジ","value":12833},{"country":"カザフ","value":11172},{"country":"米国","value":10938},{"country":"オーストラリア","value":9845},{"country":"エジプト","value":9270}]},{"title":"2025年12月","data":[{"country":"ロシア","value":60128},{"country":"UAE","value":37792},{"country":"アルジェリア","value":27817},{"country":"サウジ","value":27333},{"country":"メキシコ","value":17693},{"country":"キルギス","value":14695},{"country":"カザフ","value":13640},{"country":"エジプト","value":10774},{"country":"ブラジル","value":9845},{"country":"チリ","value":9736}]},{"title":"2025年2月","data":[{"country":"ロシア","value":55326},{"country":"サウジ","value":15840},{"country":"UAE","value":15108},{"country":"メキシコ","value":12724},{"country":"エジプト","value":11131},{"country":"アルジェリア","value":10126},{"country":"マレーシア","value":8582},{"country":"ペルー","value":8564},{"country":"カザフ","value":8547},{"country":"オーストラリア","value":7744}]},{"title":"2024年12月","data":[{"country":"ロシア","value":91230},{"country":"サウジ","value":27699},{"country":"UAE","value":26462},{"country":"メキシコ","value":14178},{"country":"カザフスタン","value":11681},{"country":"ベラルーシ","value":11649},{"country":"アメリカ","value":10750},{"country":"イタリア","value":8474},{"country":"チリ","value":7872},{"country":"スペイン","value":7863}]},{"title":"2024年11月","data":[{"country":"ロシア","value":97322},{"country":"UAE","value":21767},{"country":"メキシコ","value":21348},{"country":"サウジ","value":20775},{"country":"スペイン","value":10426},{"country":"カザフスタン","value":10099},{"country":"南アフリカ","value":9887},{"country":"アメリカ","value":8942},{"country":"マレーシア","value":8716},{"country":"英国","value":8313}]},{"title":"2026年2月","data":[{"country":"ロシア","value":55326},{"country":"サウジ","value":15840},{"country":"UAE","value":15108},{"country":"メキシコ","value":12724},{"country":"エジプト","value":11131},{"country":"アルジェリア","value":10126},{"country":"マレーシア","value":8582},{"country":"ペルー","value":8564},{"country":"カザフスタン","value":8547},{"country":"オーストラリア","value":7744}]},{"title":"2026年1〜2月累計","data":[{"country":"ロシア","value":99359},{"country":"UAE","value":43212},{"country":"サウジ","value":36211},{"country":"アルジェリア","value":26997},{"country":"メキシコ","value":25741},{"country":"エジプト","value":21189},{"country":"ベラルーシ","value":19487},{"country":"カザフスタン","value":18630},{"country":"ブラジル","value":16504},{"country":"トルコ","value":16416}]},{"title":"2026年3月","data":[{"country":"ロシア","value":73827},{"country":"メキシコ","value":20872},{"country":"ブラジル","value":12273},{"country":"キルギス","value":12272},{"country":"カザフスタン","value":10906},{"country":"南アフリカ","value":10869},{"country":"アルジェリア","value":10808},{"country":"ペルー","value":10417},{"country":"エジプト","value":9522},{"country":"チリ","value":8389}]},{"title":"2026年1〜3月累計","data":[{"country":"ロシア","value":173186},{"country":"メキシコ","value":46613},{"country":"UAE","value":45981},{"country":"サウジ","value":42570},{"country":"アルジェリア","value":37805},{"country":"エジプト","value":30711},{"country":"カザフスタン","value":29536},{"country":"ブラジル","value":28777},{"country":"ベラルーシ","value":25462}]},{"title":"2026年4月","data":[{"country":"ロシア","value":69847},{"country":"アルジェリア","value":16662},{"country":"ブラジル","value":15985},{"country":"メキシコ","value":15147},{"country":"ベラルーシ","value":11675},{"country":"キルギス","value":11521},{"country":"カザフスタン","value":11145},{"country":"南アフリカ","value":10924},{"country":"オーストラリア","value":10676},{"country":"マレーシア","value":10384}]},{"title":"2026年1〜4月累計","data":[{"country":"ロシア","value":243033},{"country":"メキシコ","value":61760},{"country":"アルジェリア","value":54467},{"country":"サウジ","value":50003},{"country":"UAE","value":49118},{"country":"ブラジル","value":44762},{"country":"カザフスタン","value":40681},{"country":"エジプト","value":37646},{"country":"ベラルーシ","value":37137},{"country":"キルギス","value":35808}]},{"title":"2026年7月","data":[{"country":"ロシア","value":81250},{"country":"メキシコ","value":32640},{"country":"サウジ","value":18031},{"country":"アルジェリア","value":17027},{"country":"カザフスタン","value":14534},{"country":"UAE","value":13122},{"country":"ベラルーシ","value":13001},{"country":"マレーシア","value":11768},{"country":"南アフリカ","value":10102},{"country":"キルギス","value":9829}]},{"title":"2026年8月","data":[{"country":"ロシア","value":80826},{"country":"メキシコ","value":31549},{"country":"アルジェリア","value":18809},{"country":"カザフスタン","value":17617},{"country":"サウジ","value":15607},{"country":"UAE","value":12952},{"country":"ベラルーシ","value":12908},{"country":"ペルー","value":12167},{"country":"ブラジル","value":11882},{"country":"南アフリカ","value":10483}]},{"title":"2026年1〜8月累計","data":[{"country":"ロシア","value":562854},{"country":"メキシコ","value":177623},{"country":"アルジェリア","value":136777},{"country":"サウジ","value":112555},{"country":"カザフスタン","value":95092},{"country":"ベラルーシ","value":90626},{"country":"UAE","value":86181},{"country":"ブラジル","value":85242},{"country":"ペルー","value":78023},{"country":"南アフリカ","value":77701}]},{"title":"2026年9月","data":[{"country":"ロシア","value":91216},{"country":"メキシコ","value":22228},{"country":"カザフスタン","value":17673},{"country":"UAE","value":16271},{"country":"アルジェリア","value":16062},{"country":"ペルー","value":12912},{"country":"サウジ","value":12647},{"country":"マレーシア","value":12368},{"country":"エジプト","value":12343},{"country":"南アフリカ","value":10726}]},{"title":"2026年1〜9月累計","data":[{"country":"ロシア","value":654071},{"country":"メキシコ","value":199853},{"country":"アルジェリア","value":153142},{"country":"サウジ","value":125202},{"country":"カザフスタン","value":112775},{"country":"UAE","value":102467},{"country":"ベラルーシ","value":99815},{"country":"ブラジル","value":91369},{"country":"ペルー","value":90935},{"country":"マレーシア","value":88477}]}],"r6":[{"title":"2025年1〜2月累計","data":[{"country":"ベルギー","value":30889},{"country":"トルコ","value":19672},{"country":"フィリピン","value":17848},{"country":"英国","value":16764},{"country":"タイ","value":16369},{"country":"UAE","value":13287},{"country":"インドネシア","value":11573},{"country":"メキシコ","value":11173},{"country":"インド","value":11156},{"country":"オーストラリア","value":9228}]},{"title":"2025年3月","data":[{"country":"タイ","value":14048},{"country":"ベルギー","value":13321},{"country":"メキシコ","value":11028},{"country":"フィリピン","value":10622},{"country":"インド","value":8896},{"country":"英国","value":5752},{"country":"オーストラリア","value":5633},{"country":"UAE","value":4783},{"country":"イスラエル","value":4685},{"country":"ブラジル","value":4603}]},{"title":"2025年4月","data":[{"country":"ベルギー","value":19861},{"country":"フィリピン","value":15367},{"country":"ブラジル","value":11897},{"country":"英国","value":11627},{"country":"タイ","value":11197},{"country":"オーストラリア","value":10857},{"country":"トルコ","value":9415},{"country":"メキシコ","value":9144},{"country":"インドネシア","value":8043},{"country":"インド","value":6792}]},{"title":"2025年5月","data":[{"country":"ベルギー","value":23002},{"country":"フィリピン","value":17118},{"country":"英国","value":13052},{"country":"インド","value":10257},{"country":"韓国","value":10190},{"country":"タイ","value":8183},{"country":"ブラジル","value":7790},{"country":"トルコ","value":7617},{"country":"オーストラリア","value":7253},{"country":"メキシコ","value":6867}]},{"title":"2025年6月","data":[{"country":"ベルギー","value":16370},{"country":"フィリピン","value":15579},{"country":"英国","value":11984},{"country":"インドネシア","value":8166},{"country":"インド","value":7831},{"country":"タイ","value":7758},{"country":"ブラジル","value":7721},{"country":"オーストラリア","value":7558},{"country":"メキシコ","value":7508},{"country":"韓国","value":6059}]},{"title":"2025年7月","data":[{"country":"ベルギー","value":22724},{"country":"フィリピン","value":20018},{"country":"英国","value":14466},{"country":"メキシコ","value":12819},{"country":"オーストラリア","value":12557},{"country":"インドネシア","value":12163},{"country":"インド","value":8598},{"country":"韓国","value":7521},{"country":"バングラデシュ","value":6344},{"country":"ドイツ","value":5369}]},{"title":"2025年8月","data":[{"country":"フィリピン","value":20508},{"country":"ベルギー","value":18481},{"country":"韓国","value":15267},{"country":"英国","value":14717},{"country":"インド","value":12340},{"country":"オーストラリア","value":10726},{"country":"タイ","value":10676},{"country":"ドイツ","value":9672},{"country":"バングラデシュ","value":6344},{"country":"スペイン","value":5793}]},{"title":"2025年9月","data":[{"country":"ベルギー","value":17967},{"country":"インドネシア","value":14783},{"country":"英国","value":12821},{"country":"フィリピン","value":11798},{"country":"タイ","value":11417},{"country":"インド","value":8714},{"country":"ドイツ","value":7588},{"country":"韓国","value":6621},{"country":"バングラデシュ","value":6326},{"country":"オーストラリア","value":5956}]},{"title":"2025年10月","data":[{"country":"ベルギー","value":23741},{"country":"フィリピン","value":14831},{"country":"タイ","value":14377},{"country":"インド","value":13555},{"country":"ブラジル","value":11548},{"country":"英国","value":11276},{"country":"インドネシア","value":10207},{"country":"メキシコ","value":9954},{"country":"オーストラリア","value":9944},{"country":"韓国","value":7507}]},{"title":"2025年11月","data":[{"country":"メキシコ","value":19344},{"country":"インドネシア","value":17503},{"country":"タイ","value":13517},{"country":"フィリピン","value":12562},{"country":"マレーシア","value":9626},{"country":"トルコ","value":9292},{"country":"英国","value":9096},{"country":"ベルギー","value":8953},{"country":"ブラジル","value":8504},{"country":"インド","value":8288}]},{"title":"2025年12月","data":[{"country":"タイ","value":24315},{"country":"インドネシア","value":19256},{"country":"ベルギー","value":18127},{"country":"英国","value":17645},{"country":"メキシコ","value":15198},{"country":"イタリア","value":10494},{"country":"フィリピン","value":9081},{"country":"ブラジル","value":8826},{"country":"マレーシア","value":7590},{"country":"ドイツ","value":7571}]},{"title":"2025年2月","data":[{"country":"ブラジル","value":30194},{"country":"タイ","value":13515},{"country":"ベルギー","value":13479},{"country":"韓国","value":11492},{"country":"インドネシア","value":10308},{"country":"英国","value":9193},{"country":"イタリア","value":8929},{"country":"ドイツ","value":8863},{"country":"インド","value":8413},{"country":"オーストラリア","value":6476}]},{"title":"2024年12月","data":[{"country":"ベルギー","value":18496},{"country":"タイ","value":11097},{"country":"UAE","value":7798},{"country":"フィリピン","value":7361},{"country":"英国","value":5393},{"country":"インド","value":5130},{"country":"トルコ","value":4173},{"country":"オーストラリア","value":4131},{"country":"ウズベキスタン","value":3942},{"country":"バングラデシュ","value":3077}]},{"title":"2024年11月","data":[{"country":"フィリピン","value":9656},{"country":"ベルギー","value":8241},{"country":"タイ","value":8121},{"country":"インド","value":7793},{"country":"バングラデシュ","value":6254},{"country":"UAE","value":5486},{"country":"インドネシア","value":4349},{"country":"英国","value":4269},{"country":"ブラジル","value":3331},{"country":"オーストラリア","value":3325}]},{"title":"2026年2月","data":[{"country":"ブラジル","value":30194},{"country":"タイ","value":13515},{"country":"ベルギー","value":13479},{"country":"韓国","value":11492},{"country":"インドネシア","value":10308},{"country":"英国","value":9193},{"country":"イタリア","value":8929},{"country":"ドイツ","value":8863},{"country":"インド","value":8413},{"country":"オーストラリア","value":6476}]},{"title":"2026年1〜2月累計","data":[{"country":"ブラジル","value":51033},{"country":"ベルギー","value":37710},{"country":"英国","value":30537},{"country":"タイ","value":22393},{"country":"韓国","value":17676},{"country":"オーストラリア","value":16788},{"country":"インドネシア","value":16568},{"country":"インド","value":16343},{"country":"イタリア","value":15585},{"country":"ドイツ","value":13448}]},{"title":"2026年3月","data":[{"country":"ブラジル","value":23850},{"country":"ベルギー","value":22490},{"country":"タイ","value":15625},{"country":"英国","value":14068},{"country":"韓国","value":12424},{"country":"香港","value":11070},{"country":"ドイツ","value":10589},{"country":"オーストラリア","value":9462},{"country":"イタリア","value":8926},{"country":"フィリピン","value":7438}]},{"title":"2026年1〜3月累計","data":[{"country":"ブラジル","value":74883},{"country":"ベルギー","value":60200},{"country":"英国","value":44605},{"country":"タイ","value":38018},{"country":"韓国","value":30100},{"country":"オーストラリア","value":26250},{"country":"イタリア","value":24511},{"country":"ドイツ","value":24037},{"country":"インドネシア","value":23887},{"country":"インド","value":22113}]},{"title":"2026年4月","data":[{"country":"ブラジル","value":38144},{"country":"ベルギー","value":35646},{"country":"オーストラリア","value":21678},{"country":"タイ","value":19882},{"country":"フィリピン","value":19577},{"country":"韓国","value":18319},{"country":"英国","value":15154},{"country":"インド","value":11776},{"country":"ドイツ","value":7925},{"country":"インドネシア","value":7205}]},{"title":"2026年1〜4月累計","data":[{"country":"ブラジル","value":113027},{"country":"ベルギー","value":95846},{"country":"英国","value":59759},{"country":"タイ","value":57900},{"country":"韓国","value":48419},{"country":"オーストラリア","value":47928},{"country":"フィリピン","value":39278},{"country":"インド","value":33889},{"country":"ドイツ","value":31962},{"country":"インドネシア","value":31092}]},{"title":"2026年7月","data":[{"country":"ベルギー","value":35789},{"country":"オーストラリア","value":33845},{"country":"フィリピン","value":27323},{"country":"タイ","value":26193},{"country":"英国","value":24561},{"country":"韓国","value":16167},{"country":"インドネシア","value":14705},{"country":"マレーシア","value":10054},{"country":"インド","value":9931},{"country":"コロンビア","value":9659}]},{"title":"2026年8月","data":[{"country":"ベルギー","value":32538},{"country":"オーストラリア","value":22067},{"country":"ブラジル","value":20154},{"country":"タイ","value":17718},{"country":"英国","value":17297},{"country":"フィリピン","value":16505},{"country":"韓国","value":16352},{"country":"ドイツ","value":13474},{"country":"インドネシア","value":10423},{"country":"コロンビア","value":7437}]},{"title":"2026年1〜8月累計","data":[{"country":"ベルギー","value":213001},{"country":"ブラジル","value":171046},{"country":"オーストラリア","value":168940},{"country":"タイ","value":166702},{"country":"フィリピン","value":141156},{"country":"英国","value":135470},{"country":"韓国","value":106989},{"country":"インドネシア","value":72549},{"country":"ドイツ","value":67465},{"country":"インド","value":67223}]},{"title":"2026年9月","data":[{"country":"ベルギー","value":32859},{"country":"タイ","value":31849},{"country":"ブラジル","value":25023},{"country":"英国","value":24110},{"country":"オーストラリア","value":23442},{"country":"ドイツ","value":20342},{"country":"韓国","value":14473},{"country":"インドネシア","value":14218},{"country":"フィリピン","value":13968},{"country":"スペイン","value":13134}]},{"title":"2026年1〜9月累計","data":[{"country":"ベルギー","value":245860},{"country":"タイ","value":198551},{"country":"ブラジル","value":196069},{"country":"オーストラリア","value":192382},{"country":"英国","value":159580},{"country":"フィリピン","value":155124},{"country":"韓国","value":121462},{"country":"ドイツ","value":87807},{"country":"インドネシア","value":86767},{"country":"インド","value":73923}]}],"r7":[{"title":"2025年1〜2月累計","data":[{"country":"ベルギー","value":15197},{"country":"メキシコ","value":12271},{"country":"ブラジル","value":10128},{"country":"イスラエル","value":9629},{"country":"スペイン","value":6488},{"country":"トルコ","value":5773},{"country":"英国","value":4610},{"country":"UAE","value":3303},{"country":"フィリピン","value":2538},{"country":"オーストラリア","value":2389}]},{"title":"2025年3月","data":[{"country":"ブラジル","value":27567},{"country":"英国","value":8063},{"country":"メキシコ","value":7416},{"country":"ベルギー","value":7360},{"country":"イスラエル","value":5387},{"country":"UAE","value":5096},{"country":"スペイン","value":4228},{"country":"トルコ","value":3719},{"country":"フィリピン","value":3077},{"country":"イタリア","value":2760}]},{"title":"2025年4月","data":[{"country":"ブラジル","value":27567},{"country":"英国","value":8063},{"country":"メキシコ","value":7416},{"country":"ベルギー","value":7360},{"country":"イスラエル","value":5387},{"country":"UAE","value":5096},{"country":"スペイン","value":4228},{"country":"トルコ","value":3719},{"country":"フィリピン","value":3077},{"country":"イタリア","value":2760}]},{"title":"2025年5月","data":[{"country":"ブラジル","value":27567},{"country":"英国","value":8063},{"country":"メキシコ","value":7416},{"country":"ベルギー","value":7360},{"country":"イスラエル","value":5387},{"country":"UAE","value":5096},{"country":"スペイン","value":4228},{"country":"トルコ","value":3719},{"country":"フィリピン","value":3077},{"country":"イタリア","value":2760}]},{"title":"2025年6月","data":[{"country":"ベルギー","value":6867},{"country":"英国","value":6565},{"country":"イスラエル","value":6339},{"country":"スペイン","value":5792},{"country":"メキシコ","value":4409},{"country":"UAE","value":4279},{"country":"ブラジル","value":3108},{"country":"オーストラリア","value":2389},{"country":"イタリア","value":2370},{"country":"ロシア","value":2163}]},{"title":"2025年7月","data":[{"country":"英国","value":7222},{"country":"UAE","value":7154},{"country":"ベルギー","value":7096},{"country":"メキシコ","value":5326},{"country":"イスラエル","value":3794},{"country":"スペイン","value":3714},{"country":"イタリア","value":3420},{"country":"オーストラリア","value":2549},{"country":"フィリピン","value":2521},{"country":"ロシア","value":2398}]},{"title":"2025年8月","data":[{"country":"UAE","value":11025},{"country":"ベルギー","value":8440},{"country":"イスラエル","value":7398},{"country":"アゼルバイジャン","value":6318},{"country":"イタリア","value":4684},{"country":"スペイン","value":4679},{"country":"ドイツ","value":4599},{"country":"英国","value":4509},{"country":"メキシコ","value":4230},{"country":"オーストラリア","value":3436}]},{"title":"2025年9月","data":[{"country":"UAE","value":17536},{"country":"ブラジル","value":5779},{"country":"英国","value":5576},{"country":"ロシア","value":5474},{"country":"イスラエル","value":5430},{"country":"スペイン","value":4288},{"country":"ヨルダン","value":3874},{"country":"フィリピン","value":3797},{"country":"ポーランド","value":3453},{"country":"オーストラリア","value":2992}]},{"title":"2025年10月","data":[{"country":"UAE","value":15983},{"country":"ブラジル","value":10489},{"country":"英国","value":10190},{"country":"メキシコ","value":8899},{"country":"ロシア","value":7799},{"country":"イスラエル","value":6734},{"country":"カザフスタン","value":4928},{"country":"トルコ","value":3679},{"country":"ベルギー","value":3655},{"country":"スペイン","value":2851}]},{"title":"2025年11月","data":[{"country":"メキシコ","value":26238},{"country":"アラブ首長国連邦","value":24193},{"country":"英国","value":9789},{"country":"ロシア","value":8879},{"country":"ブラジル","value":6792},{"country":"イスラエル","value":5341},{"country":"カザフスタン","value":5007},{"country":"スペイン","value":4752},{"country":"キルギス","value":4507},{"country":"アルゼンチン","value":4449}]},{"title":"2025年12月","data":[{"country":"アラブ首長国連邦","value":46026},{"country":"英国","value":18151},{"country":"ブラジル","value":12380},{"country":"メキシコ","value":6632},{"country":"スペイン","value":6258},{"country":"オーストラリア","value":5985},{"country":"カザフスタン","value":5728},{"country":"フィリピン","value":5352},{"country":"イスラエル","value":4843},{"country":"アルゼンチン","value":4104}]},{"title":"2025年2月","data":[{"country":"ブラジル","value":15138},{"country":"英国","value":13065},{"country":"イタリア","value":8455},{"country":"スペイン","value":8007},{"country":"イスラエル","value":6628},{"country":"アラブ首長国連邦","value":6367},{"country":"ベルギー","value":6057},{"country":"ロシア","value":4463},{"country":"サウジアラビア","value":3873},{"country":"ドイツ","value":3505}]},{"title":"2024年12月","data":[{"country":"ベルギー","value":2920},{"country":"スペイン","value":2374},{"country":"ウズベキスタン","value":2372},{"country":"オランダ","value":2346},{"country":"英国","value":1849},{"country":"ロシア","value":1794},{"country":"メキシコ","value":1754},{"country":"UAE","value":1629},{"country":"フィリピン","value":1311},{"country":"カザフスタン","value":1233}]},{"title":"2024年11月","data":[{"country":"ロシア","value":2476},{"country":"スペイン","value":1813},{"country":"フィリピン","value":1759},{"country":"ウズベキスタン","value":1658},{"country":"トルコ","value":1604},{"country":"カザフスタン","value":1505},{"country":"キルギス","value":1435},{"country":"ドイツ","value":1385},{"country":"ブラジル","value":1366},{"country":"ベラルーシ","value":1177}]},{"title":"2026年2月","data":[{"country":"ブラジル","value":15138},{"country":"英国","value":13065},{"country":"イタリア","value":8455},{"country":"スペイン","value":8007},{"country":"イスラエル","value":6628},{"country":"UAE","value":6367},{"country":"ベルギー","value":6057},{"country":"ロシア","value":4463},{"country":"サウジ","value":3873},{"country":"ドイツ","value":3505}]},{"title":"2026年1〜2月累計","data":[{"country":"UAE","value":38551},{"country":"ブラジル","value":26842},{"country":"英国","value":20718},{"country":"イタリア","value":13876},{"country":"スペイン","value":12762},{"country":"イスラエル","value":10344},{"country":"ドイツ","value":9495},{"country":"ベルギー","value":8022},{"country":"ロシア","value":7776},{"country":"オーストラリア","value":6616}]},{"title":"2026年3月","data":[{"country":"ブラジル","value":26834},{"country":"英国","value":9532},{"country":"ベルギー","value":9377},{"country":"ドイツ","value":6038},{"country":"オーストラリア","value":4799},{"country":"スペイン","value":4634},{"country":"イタリア","value":4439},{"country":"メキシコ","value":4405},{"country":"ロシア","value":3648},{"country":"イスラエル","value":3245}]},{"title":"2026年1〜3月累計","data":[{"country":"ブラジル","value":53676},{"country":"UAE","value":39147},{"country":"英国","value":30250},{"country":"イタリア","value":18315},{"country":"ベルギー","value":17399},{"country":"スペイン","value":17396},{"country":"ドイツ","value":15533},{"country":"イスラエル","value":13589},{"country":"ロシア","value":11424}]},{"title":"2026年4月","data":[{"country":"ブラジル","value":53865},{"country":"英国","value":15104},{"country":"ベルギー","value":12869},{"country":"オーストラリア","value":9641},{"country":"ドイツ","value":6823},{"country":"イタリア","value":6758},{"country":"スペイン","value":6641},{"country":"イスラエル","value":4943},{"country":"ロシア","value":3996},{"country":"ウズベキスタン","value":3616}]},{"title":"2026年1〜4月累計","data":[{"country":"ブラジル","value":107541},{"country":"英国","value":45354},{"country":"UAE","value":41586},{"country":"ベルギー","value":30268},{"country":"イタリア","value":25073},{"country":"スペイン","value":24037},{"country":"ドイツ","value":22356},{"country":"オーストラリア","value":21056},{"country":"イスラエル","value":18532},{"country":"ロシア","value":15420}]},{"title":"2026年7月","data":[{"country":"英国","value":26705},{"country":"ベルギー","value":12834},{"country":"イタリア","value":10382},{"country":"フィリピン","value":9104},{"country":"ヨルダン","value":8420},{"country":"メキシコ","value":8367},{"country":"ロシア","value":7875},{"country":"スペイン","value":7267},{"country":"イスラエル","value":6068},{"country":"オーストラリア","value":5870}]},{"title":"2026年8月","data":[{"country":"英国","value":20033},{"country":"ベルギー","value":15714},{"country":"イタリア","value":11497},{"country":"ロシア","value":10588},{"country":"スペイン","value":10535},{"country":"ブラジル","value":10127},{"country":"UAE","value":9317},{"country":"フィリピン","value":8380},{"country":"ドイツ","value":6819},{"country":"キルギス","value":6733}]},{"title":"2026年1〜8月累計","data":[{"country":"ブラジル","value":164357},{"country":"英国","value":133077},{"country":"ベルギー","value":91171},{"country":"イタリア","value":67992},{"country":"UAE","value":63055},{"country":"スペイン","value":62281},{"country":"オーストラリア","value":52946},{"country":"ドイツ","value":47876},{"country":"ロシア","value":45514},{"country":"フィリピン","value":45330}]},{"title":"2026年9月","data":[{"country":"英国","value":18482},{"country":"ブラジル","value":16808},{"country":"イタリア","value":16127},{"country":"UAE","value":13546},{"country":"ロシア","value":13173},{"country":"ヨルダン","value":12798},{"country":"スペイン","value":11245},{"country":"ベルギー","value":10791},{"country":"アルゼンチン","value":7690},{"country":"キルギス","value":7036}]},{"title":"2026年1〜9月累計","data":[{"country":"ブラジル","value":181165},{"country":"英国","value":151559},{"country":"ベルギー","value":101962},{"country":"イタリア","value":84119},{"country":"UAE","value":76601},{"country":"スペイン","value":73526},{"country":"オーストラリア","value":59430},{"country":"ロシア","value":58687},{"country":"ドイツ","value":53654},{"country":"フィリピン","value":47898}]}],"r8":[{"title":"2025年1〜2月累計","data":[{"country":"メキシコ","value":13407},{"country":"ベトナム","value":8131},{"country":"チリ","value":6149},{"country":"サウジ","value":5023},{"country":"フィリピン","value":3993},{"country":"南アフリカ","value":3771},{"country":"インドネシア","value":3713},{"country":"エクアドル","value":3165},{"country":"オーストラリア","value":2914},{"country":"ペルー","value":2880}]},{"title":"2025年3月","data":[{"country":"ベトナム","value":6243},{"country":"メキシコ","value":5597},{"country":"サウジ","value":3362},{"country":"チリ","value":2913},{"country":"南アフリカ","value":2634},{"country":"オーストラリア","value":2474},{"country":"ガーナ","value":2446},{"country":"コロンビア","value":2148},{"country":"エクアドル","value":1977},{"country":"フィリピン","value":1945}]},{"title":"2025年4月","data":[{"country":"メキシコ","value":6692},{"country":"ベトナム","value":5957},{"country":"サウジ","value":3975},{"country":"チリ","value":3621},{"country":"フィリピン","value":2485},{"country":"エクアドル","value":2167},{"country":"ナイジェリア","value":2113},{"country":"ガーナ","value":1750},{"country":"オーストラリア","value":1712},{"country":"ペルー","value":1708}]},{"title":"2025年5月","data":[{"country":"メキシコ","value":7852},{"country":"ベトナム","value":6400},{"country":"サウジ","value":3163},{"country":"アルゼンチン","value":3091},{"country":"UAE","value":2900},{"country":"チリ","value":2848},{"country":"フィリピン","value":2611},{"country":"南アフリカ","value":2496},{"country":"ナイジェリア","value":2458},{"country":"オーストラリア","value":2020}]},{"title":"2025年6月","data":[{"country":"ベトナム","value":6136},{"country":"メキシコ","value":4695},{"country":"サウジ","value":3331},{"country":"フィリピン","value":2797},{"country":"エクアドル","value":2415},{"country":"ペルー","value":2199},{"country":"UAE","value":2194},{"country":"コロンビア","value":2038},{"country":"オーストラリア","value":1930},{"country":"チリ","value":1816}]},{"title":"2025年7月","data":[{"country":"ベトナム","value":5455},{"country":"メキシコ","value":4600},{"country":"チリ","value":3797},{"country":"ナイジェリア","value":3193},{"country":"ペルー","value":2704},{"country":"アルゼンチン","value":2540},{"country":"エクアドル","value":2443},{"country":"コロンビア","value":2293},{"country":"フィリピン","value":2187},{"country":"サウジ","value":2118}]},{"title":"2025年8月","data":[{"country":"ベトナム","value":5258},{"country":"メキシコ","value":3724},{"country":"アルゼンチン","value":3372},{"country":"エクアドル","value":3328},{"country":"オーストラリア","value":3230},{"country":"ナイジェリア","value":3136},{"country":"フィリピン","value":2421},{"country":"チリ","value":2341},{"country":"サウジ","value":2194},{"country":"南アフリカ","value":2192}]},{"title":"2025年9月","data":[{"country":"メキシコ","value":9407},{"country":"ベトナム","value":5572},{"country":"チリ","value":3828},{"country":"サウジ","value":3562},{"country":"ナイジェリア","value":2962},{"country":"南アフリカ","value":2958},{"country":"エクアドル","value":2840},{"country":"フィリピン","value":2183},{"country":"ガーナ","value":2093},{"country":"オーストラリア","value":2009}]},{"title":"2025年10月","data":[{"country":"メキシコ","value":7758},{"country":"ベトナム","value":6157},{"country":"ナイジェリア","value":4843},{"country":"サウジ","value":4282},{"country":"南アフリカ","value":3627},{"country":"エクアドル","value":3342},{"country":"チリ","value":2935},{"country":"オーストラリア","value":2672},{"country":"ギニア","value":2166},{"country":"ロシア","value":2122}]},{"title":"2025年11月","data":[{"country":"メキシコ","value":10930},{"country":"ベトナム","value":6414},{"country":"アルジェリア","value":5490},{"country":"エクアドル","value":3133},{"country":"南アフリカ","value":2957},{"country":"オーストラリア","value":2818},{"country":"ペルー","value":2778},{"country":"チリ","value":2738},{"country":"ナイジェリア","value":2686},{"country":"ガーナ","value":2483}]},{"title":"2025年12月","data":[{"country":"アルジェリア","value":8415},{"country":"メキシコ","value":7717},{"country":"ベトナム","value":6310},{"country":"ガーナ","value":3782},{"country":"サウジ","value":3688},{"country":"ロシア","value":3385},{"country":"エクアドル","value":3140},{"country":"UAE","value":3028},{"country":"ペルー","value":2921},{"country":"英国","value":2858}]},{"title":"2025年2月","data":[{"country":"メキシコ","value":7420},{"country":"ベトナム","value":5001},{"country":"アルジェリア","value":3561},{"country":"エクアドル","value":3465},{"country":"タンザニア","value":3217},{"country":"チリ","value":2873},{"country":"ペルー","value":2770},{"country":"アルゼンチン","value":2504},{"country":"ガーナ","value":2453},{"country":"南アフリカ","value":2384}]},{"title":"2024年12月","data":[{"country":"サウジ","value":4250},{"country":"メキシコ","value":4046},{"country":"ロシア","value":3743},{"country":"チリ","value":3652},{"country":"ベトナム","value":3555},{"country":"UAE","value":2011},{"country":"インドネシア","value":1995},{"country":"オーストラリア","value":1796},{"country":"南アフリカ","value":1704},{"country":"フィリピン","value":1699}]},{"title":"2024年11月","data":[{"country":"メキシコ","value":8982},{"country":"ベトナム","value":3566},{"country":"サウジ","value":3523},{"country":"チリ","value":3197},{"country":"インドネシア","value":2397},{"country":"フィリピン","value":1888},{"country":"ロシア","value":1845},{"country":"UAE","value":1798},{"country":"南アフリカ","value":1721},{"country":"ペルー","value":1542}]},{"title":"2026年2月","data":[{"country":"メキシコ","value":7420},{"country":"ベトナム","value":5001},{"country":"アルジェリア","value":3561},{"country":"エクアドル","value":3465},{"country":"タンザニア","value":3217},{"country":"チリ","value":2873},{"country":"ペルー","value":2770},{"country":"アルゼンチン","value":2504},{"country":"ガーナ","value":2453},{"country":"南アフリカ","value":2384}]},{"title":"2026年1〜2月累計","data":[{"country":"メキシコ","value":13367},{"country":"ベトナム","value":11949},{"country":"アルジェリア","value":8964},{"country":"エクアドル","value":6683},{"country":"チリ","value":6560},{"country":"ペルー","value":6105},{"country":"南アフリカ","value":5494},{"country":"ガーナ","value":5294},{"country":"タンザニア","value":5227}]},{"title":"2026年3月","data":[{"country":"ベトナム","value":10795},{"country":"メキシコ","value":9234},{"country":"アルジェリア","value":6361},{"country":"チリ","value":3464},{"country":"ガーナ","value":3438},{"country":"ペルー","value":3428},{"country":"南アフリカ","value":3202},{"country":"エクアドル","value":3056},{"country":"ナイジェリア","value":2972},{"country":"サウジ","value":2871}]},{"title":"2026年1〜3月累計","data":[{"country":"ベトナム","value":22744},{"country":"メキシコ","value":22601},{"country":"アルジェリア","value":15325},{"country":"チリ","value":10024},{"country":"エクアドル","value":9739},{"country":"ペルー","value":9533},{"country":"ガーナ","value":8732},{"country":"南アフリカ","value":8696},{"country":"サウジ","value":8078},{"country":"タンザニア","value":7795}]},{"title":"2026年4月","data":[{"country":"ベトナム","value":8650},{"country":"メキシコ","value":5941},{"country":"ガーナ","value":5751},{"country":"アルジェリア","value":4741},{"country":"ペルー","value":4096},{"country":"南アフリカ","value":3534},{"country":"ナイジェリア","value":3245},{"country":"チリ","value":3097},{"country":"インドネシア","value":2978},{"country":"アルゼンチン","value":2784}]},{"title":"2026年1〜4月累計","data":[{"country":"ベトナム","value":31221},{"country":"メキシコ","value":28489},{"country":"アルジェリア","value":20054},{"country":"ガーナ","value":14396},{"country":"ペルー","value":13421},{"country":"チリ","value":13089},{"country":"エクアドル","value":12294},{"country":"南アフリカ","value":12086},{"country":"ナイジェリア","value":10489},{"country":"タンザニア","value":10009}]},{"title":"2026年7月","data":[{"country":"メキシコ","value":9537},{"country":"アルジェリア","value":5087},{"country":"ベトナム","value":5049},{"country":"チリ","value":4914},{"country":"タンザニア","value":4115},{"country":"ペルー","value":4111},{"country":"エクアドル","value":3799},{"country":"アルゼンチン","value":3624},{"country":"コロンビア","value":3362},{"country":"南アフリカ","value":3225}]},{"title":"2026年8月","data":[{"country":"メキシコ","value":11902},{"country":"南アフリカ","value":4216},{"country":"ベトナム","value":4170},{"country":"アルジェリア","value":4042},{"country":"ペルー","value":3840},{"country":"ナイジェリア","value":3390},{"country":"タンザニア","value":3389},{"country":"エクアドル","value":3300},{"country":"チリ","value":3005},{"country":"ブラジル","value":2774}]},{"title":"2026年1〜8月累計","data":[{"country":"メキシコ","value":64530},{"country":"ベトナム","value":57004},{"country":"アルジェリア","value":42125},{"country":"ペルー","value":28708},{"country":"ガーナ","value":25965},{"country":"チリ","value":25068},{"country":"南アフリカ","value":24701},{"country":"ナイジェリア","value":24622},{"country":"エクアドル","value":24439},{"country":"タンザニア","value":22928}]},{"title":"2026年9月","data":[{"country":"メキシコ","value":7425},{"country":"ベトナム","value":5363},{"country":"チリ","value":4511},{"country":"アルジェリア","value":4506},{"country":"ペルー","value":4399},{"country":"ロシア","value":3790},{"country":"ナイジェリア","value":3736},{"country":"タンザニア","value":3706},{"country":"ブラジル","value":3035},{"country":"エクアドル","value":2758}]},{"title":"2026年1〜9月累計","data":[{"country":"メキシコ","value":72176},{"country":"ベトナム","value":62779},{"country":"アルジェリア","value":46672},{"country":"ペルー","value":33666},{"country":"チリ","value":29672},{"country":"ナイジェリア","value":28761},{"country":"ガーナ","value":28524},{"country":"南アフリカ","value":27509},{"country":"エクアドル","value":27220},{"country":"タンザニア","value":26900}]}],"r9":[{"title":"2025年3月","data":[{"country":"オーストラリア","value":2941},{"country":"メキシコ","value":2149},{"country":"フィリピン","value":458},{"country":"ニュージーランド","value":165},{"country":"南アフリカ","value":103},{"country":"ドイツ","value":100},{"country":"ドイツ","value":100},{"country":"ブラジル","value":86},{"country":"ラオス","value":50},{"country":"ロシア","value":5}]},{"title":"2025年4月","data":[{"country":"オーストラリア","value":3586},{"country":"メキシコ","value":1239},{"country":"フィリピン","value":804},{"country":"南アフリカ","value":204},{"country":"チリ","value":145},{"country":"ブラジル","value":100},{"country":"タイ","value":67},{"country":"ニュージーランド","value":60},{"country":"コスタリカ","value":45},{"country":"コロンビア","value":44}]},{"title":"2025年5月","data":[{"country":"オーストラリア","value":4573},{"country":"フィリピン","value":1278},{"country":"メキシコ","value":275},{"country":"ニュージーランド","value":226},{"country":"南アフリカ","value":160},{"country":"コロンビア","value":147},{"country":"チリ","value":136},{"country":"ブラジル","value":103},{"country":"イタリア","value":100},{"country":"タイ","value":50}]},{"title":"2025年6月","data":[{"country":"オーストラリア","value":1670},{"country":"フィリピン","value":971},{"country":"メキシコ","value":653},{"country":"南アフリカ","value":503},{"country":"ニュージーランド","value":220},{"country":"チリ","value":151},{"country":"エクアドル","value":131},{"country":"ウラグアイ","value":118},{"country":"カンボジア","value":106},{"country":"トルコ","value":100}]},{"title":"2025年9月","data":[{"country":"チリ","value":309},{"country":"パキスタン","value":284},{"country":"ニュージーランド","value":232},{"country":"エクアドル","value":203},{"country":"ロシア","value":200},{"country":"コロンビア","value":118},{"country":"メキシコ","value":116},{"country":"グアテマラ","value":102},{"country":"オーストラリア","value":83},{"country":"サウジ","value":76}]},{"title":"2025年10月","data":[{"country":"オーストラリア","value":2998},{"country":"パキスタン","value":230},{"country":"エクアドル","value":163},{"country":"ドイツ","value":102},{"country":"イタリア","value":101},{"country":"ブラジル","value":100},{"country":"コロンビア","value":77},{"country":"チリ","value":71},{"country":"メキシコ","value":58},{"country":"フィリピン","value":55}]},{"title":"2025年11月","data":[{"country":"メキシコ","value":2399},{"country":"オーストラリア","value":1058},{"country":"ブラジル","value":257},{"country":"チリ","value":228},{"country":"パキスタン","value":204},{"country":"ニュージーランド","value":203},{"country":"トルコ","value":140},{"country":"南アフリカ","value":72},{"country":"サウジアラビア","value":70},{"country":"エクアドル","value":54}]},{"title":"2025年12月","data":[{"country":"オーストラリア","value":1433},{"country":"アルゼンチン","value":380},{"country":"アラブ首長国連邦","value":272},{"country":"南アフリカ","value":217},{"country":"チリ","value":209},{"country":"パキスタン","value":185},{"country":"ブラジル","value":101},{"country":"サウジアラビア","value":80},{"country":"コロンビア","value":38},{"country":"ウルグアイ","value":30}]},{"title":"2026年2月","data":[{"country":"オーストラリア(推定)","value":600},{"country":"チリ(推定)","value":452},{"country":"メキシコ(推定)","value":200},{"country":"アルゼンチン(推定)","value":150},{"country":"南アフリカ(推定)","value":100},{"country":"オーストラリア","value":2434},{"country":"チリ","value":798},{"country":"UAE","value":504},{"country":"アルゼンチン","value":440},{"country":"南アフリカ","value":362}]},{"title":"2026年1〜2月累計","data":[{"country":"オーストラリア","value":2434},{"country":"チリ","value":798},{"country":"UAE","value":504},{"country":"アルゼンチン","value":440},{"country":"南アフリカ","value":362},{"country":"パキスタン","value":325},{"country":"コロンビア","value":214},{"country":"トルコ","value":186},{"country":"サウジ","value":180},{"country":"エクアドル","value":124}]},{"title":"2026年3月","data":[{"country":"オーストラリア","value":1328},{"country":"ブラジル","value":437},{"country":"アルゼンチン","value":396},{"country":"チリ","value":288},{"country":"ロシア","value":150},{"country":"ドイツ","value":116},{"country":"パキスタン","value":98},{"country":"ポーランド","value":88},{"country":"ブルガリア","value":69},{"country":"ウルグアイ","value":65}]},{"title":"2026年1〜3月累計","data":[{"country":"オーストラリア","value":3762},{"country":"チリ","value":1086},{"country":"アルゼンチン","value":836},{"country":"ブラジル","value":540},{"country":"UAE","value":504},{"country":"パキスタン","value":423},{"country":"南アフリカ","value":402},{"country":"コロンビア","value":214},{"country":"トルコ","value":186}]},{"title":"2026年4月","data":[{"country":"オーストラリア","value":2900},{"country":"ブラジル","value":339},{"country":"コロンビア","value":205},{"country":"パキスタン","value":176},{"country":"UAE","value":171},{"country":"チリ","value":138},{"country":"トルコ","value":116},{"country":"ウルグアイ","value":70},{"country":"南アフリカ","value":68}]},{"title":"2026年1〜4月累計","data":[{"country":"オーストラリア","value":6662},{"country":"チリ","value":1224},{"country":"アルゼンチン","value":881},{"country":"ブラジル","value":879},{"country":"UAE","value":675},{"country":"パキスタン","value":599},{"country":"南アフリカ","value":470},{"country":"コロンビア","value":419},{"country":"トルコ","value":302}]},{"title":"2026年7月","data":[{"country":"アルゼンチン","value":1013},{"country":"オーストラリア","value":604},{"country":"パキスタン","value":467},{"country":"南アフリカ","value":424},{"country":"カンボジア","value":328},{"country":"ニュージーランド","value":264},{"country":"サウジ","value":228},{"country":"エクアドル","value":127},{"country":"フィリピン","value":101},{"country":"イタリア","value":100}]},{"title":"2026年8月","data":[{"country":"メキシコ","value":1718},{"country":"オーストラリア","value":1502},{"country":"ニュージーランド","value":840},{"country":"南アフリカ","value":494},{"country":"パキスタン","value":429},{"country":"チリ","value":372},{"country":"UAE","value":291},{"country":"フィリピン","value":204},{"country":"ポーランド","value":174},{"country":"カンボジア","value":162}]},{"title":"2026年1〜8月累計","data":[{"country":"オーストラリア","value":14162},{"country":"アルゼンチン","value":3199},{"country":"メキシコ","value":2679},{"country":"パキスタン","value":2320},{"country":"チリ","value":1955},{"country":"南アフリカ","value":1853},{"country":"ニュージーランド","value":1759},{"country":"UAE","value":1329},{"country":"ブラジル","value":1073},{"country":"コロンビア","value":749}]},{"title":"2026年9月","data":[{"country":"オーストラリア","value":3184},{"country":"英国","value":675},{"country":"アルゼンチン","value":650},{"country":"フィリピン","value":309},{"country":"ニュージーランド","value":305},{"country":"チリ","value":265},{"country":"エクアドル","value":232},{"country":"スペイン","value":220},{"country":"パキスタン","value":180},{"country":"ドイツ","value":140}]},{"title":"2026年1〜9月累計","data":[{"country":"オーストラリア","value":17346},{"country":"アルゼンチン","value":3849},{"country":"メキシコ","value":2754},{"country":"パキスタン","value":2500},{"country":"チリ","value":2220},{"country":"ニュージーランド","value":2064},{"country":"南アフリカ","value":1975},{"country":"UAE","value":1365},{"country":"ブラジル","value":1074},{"country":"コロンビア","value":805}]}],"r10":[{"title":"2025年3月","data":[{"country":"フランス","value":160},{"country":"ベルギー","value":134},{"country":"タイ","value":131},{"country":"UAE","value":112},{"country":"ペルー","value":80},{"country":"英国","value":67},{"country":"日本","value":65},{"country":"フィリピン","value":55},{"country":"シンガポール","value":53},{"country":"イスラエル","value":50}]},{"title":"2025年4月","data":[{"country":"英国","value":412},{"country":"インドネシア","value":155},{"country":"ノルウェー","value":121},{"country":"コスタリカ","value":113},{"country":"オランダ","value":106},{"country":"ペルー","value":86},{"country":"中国香港","value":83},{"country":"エチオピア","value":74},{"country":"メキシコ","value":71},{"country":"タイ","value":67}]},{"title":"2025年5月","data":[{"country":"スロベニア","value":469},{"country":"英国","value":246},{"country":"インドネシア","value":220},{"country":"ニジェール","value":128},{"country":"韓国","value":103},{"country":"タイ","value":86},{"country":"UAE","value":82},{"country":"エチオピア","value":76},{"country":"シンガポール","value":71},{"country":"スペイン","value":70}]},{"title":"2025年6月","data":[{"country":"タイ","value":122},{"country":"シンガポール","value":106},{"country":"インドネシア","value":105},{"country":"英国","value":103},{"country":"フィリピン","value":86},{"country":"スペイン","value":85},{"country":"韓国","value":81},{"country":"イスラエル","value":78},{"country":"ベルギー","value":72},{"country":"カンボジア","value":68}]},{"title":"2025年10月","data":[{"country":"米国","value":880},{"country":"インドネシア","value":683},{"country":"英国","value":517},{"country":"ベルギー","value":439},{"country":"フィリピン","value":424},{"country":"ウズベキスタン","value":383},{"country":"タイ","value":296},{"country":"イスラエル","value":253},{"country":"ペルー","value":193},{"country":"オランダ","value":190}]},{"title":"2025年11月","data":[{"country":"日本","value":395},{"country":"ベルギー","value":386},{"country":"アメリカ","value":371},{"country":"フィリピン","value":358},{"country":"ウズベキスタン","value":347},{"country":"オランダ","value":300},{"country":"タンザニア","value":261},{"country":"オーストラリア","value":253},{"country":"英国","value":234},{"country":"インドネシア","value":215}]},{"title":"2025年12月","data":[{"country":"ベルギー","value":978},{"country":"ウズベキスタン","value":885},{"country":"アメリカ","value":686},{"country":"ロマニア","value":573},{"country":"オーストラリア","value":521},{"country":"ドイツ","value":449},{"country":"ウクライナ","value":435},{"country":"ウクライナ","value":435},{"country":"英国","value":407},{"country":"オランダ","value":399}]},{"title":"2026年2月","data":[{"country":"ウズベキスタン(推定)","value":1131},{"country":"英国(推定)","value":775},{"country":"オランダ(推定)","value":628},{"country":"ベルギー(推定)","value":625},{"country":"チェコ(推定)","value":534},{"country":"アメリカ(推定)","value":485},{"country":"ルーマニア(推定)","value":463},{"country":"ドイツ(推定)","value":454},{"country":"オーストラリア(推定)","value":53},{"country":"インドネシア(推定)","value":100}]},{"title":"2026年1〜2月累計","data":[{"country":"ベルギー","value":2615},{"country":"米国","value":1751},{"country":"ウズベキスタン","value":1189},{"country":"英国","value":1051},{"country":"韓国","value":834},{"country":"イタリア","value":781},{"country":"ドイツ","value":774},{"country":"タイ","value":721},{"country":"オーストラリア","value":649},{"country":"オランダ","value":611}]},{"title":"2026年3月","data":[{"country":"ウズベキスタン","value":2256},{"country":"アメリカ","value":1019},{"country":"キルギス","value":438},{"country":"英国","value":400},{"country":"オランダ","value":365},{"country":"タイ","value":308},{"country":"ベルギー","value":294},{"country":"カナダ","value":288},{"country":"ドイツ","value":268},{"country":"インドネシア","value":241}]},{"title":"2026年1〜3月累計","data":[{"country":"ウズベキスタン","value":3445},{"country":"ベルギー","value":2909},{"country":"アメリカ","value":2770},{"country":"英国","value":1451},{"country":"ドイツ","value":1042},{"country":"タイ","value":1029},{"country":"韓国","value":988},{"country":"オランダ","value":976},{"country":"イタリア","value":845},{"country":"キルギス","value":801}]},{"title":"2026年4月","data":[{"country":"ウズベキスタン","value":3954},{"country":"アメリカ","value":1575},{"country":"タイ","value":773},{"country":"ウクライナ","value":747},{"country":"ベルギー","value":679},{"country":"英国","value":629},{"country":"オーストラリア","value":552},{"country":"フィリピン","value":550},{"country":"ルーマニア","value":505},{"country":"キルギス","value":501}]},{"title":"2026年1〜4月累計","data":[{"country":"ウズベキスタン","value":7399},{"country":"アメリカ","value":4345},{"country":"ベルギー","value":3588},{"country":"英国","value":2080},{"country":"タイ","value":1802},{"country":"ウクライナ","value":1385},{"country":"韓国","value":1366},{"country":"ドイツ","value":1334},{"country":"キルギス","value":1302},{"country":"オーストラリア","value":1259}]},{"title":"2026年6月","data":[{"country":"インド","value":904},{"country":"タイ","value":530},{"country":"ベトナム","value":485},{"country":"ネパール","value":398},{"country":"オーストラリア","value":332},{"country":"ウルグアイ","value":246},{"country":"シンガポール","value":242},{"country":"ペルー","value":211},{"country":"カンボジア","value":204},{"country":"インドネシア","value":196}]},{"title":"2026年7月","data":[{"country":"タイ","value":729},{"country":"ベルギー","value":591},{"country":"ベトナム","value":488},{"country":"インドネシア","value":360},{"country":"インド","value":347},{"country":"フィリピン","value":275},{"country":"シンガポール","value":222},{"country":"カンボジア","value":156},{"country":"ペルー","value":139},{"country":"オーストラリア","value":124}]},{"title":"2026年1〜7月累計","data":[{"country":"タイ","value":3241},{"country":"ベルギー","value":2269},{"country":"インド","value":1680},{"country":"ベトナム","value":1569},{"country":"シンガポール","value":1415},{"country":"インドネシア","value":1413},{"country":"英国","value":1057},{"country":"ペルー","value":998},{"country":"カンボジア","value":997},{"country":"フィリピン","value":986}]},{"title":"2026年8月","data":[{"country":"タイ","value":655},{"country":"インド","value":401},{"country":"ウルグアイ","value":354},{"country":"ベルギー","value":331},{"country":"ベトナム","value":286},{"country":"オーストラリア","value":225},{"country":"ブラジル","value":220},{"country":"シンガポール","value":189},{"country":"ペルー","value":170},{"country":"南アフリカ","value":160}]},{"title":"2026年9月","data":[{"country":"タイ","value":1121},{"country":"インド","value":412},{"country":"インドネシア","value":321},{"country":"オーストラリア","value":316},{"country":"ブラジル","value":298},{"country":"シンガポール","value":289},{"country":"メキシコ","value":233},{"country":"英国","value":224},{"country":"モンゴル","value":210},{"country":"ドイツ","value":201}]},{"title":"2026年1〜9月累計","data":[{"country":"タイ","value":5017},{"country":"ベルギー","value":2609},{"country":"インド","value":2493},{"country":"ベトナム","value":1926},{"country":"シンガポール","value":1893},{"country":"インドネシア","value":1866},{"country":"フィリピン","value":1318},{"country":"英国","value":1298},{"country":"オーストラリア","value":1282},{"country":"ウルグアイ","value":1250}]}],"r11":[{"title":"2025年1〜2月累計","data":[{"country":"サウジ","value":1766},{"country":"エジプト","value":1345},{"country":"ベトナム","value":1295},{"country":"ペルー","value":861},{"country":"マレーシア","value":415},{"country":"チリ","value":341},{"country":"UAE","value":331},{"country":"フィリピン","value":277},{"country":"カザフスタン","value":270},{"country":"エクアドル","value":261}]},{"title":"2025年3月","data":[{"country":"サウジ","value":1110},{"country":"ベトナム","value":737},{"country":"ペルー","value":669},{"country":"エジプト","value":619},{"country":"チリ","value":414},{"country":"エクアドル","value":354},{"country":"マレーシア","value":286},{"country":"UAE","value":245},{"country":"ウズベキスタン","value":217},{"country":"キューバ","value":205}]},{"title":"2025年4月","data":[{"country":"サウジ","value":1582},{"country":"ペルー","value":706},{"country":"ベトナム","value":600},{"country":"ボリビア","value":400},{"country":"エジプト","value":305},{"country":"カザフスタン","value":270},{"country":"カタール","value":235},{"country":"マレーシア","value":198},{"country":"チリ","value":177},{"country":"フィリピン","value":168}]},{"title":"2025年5月","data":[{"country":"ベトナム","value":731},{"country":"ペルー","value":645},{"country":"エジプト","value":419},{"country":"UAE","value":341},{"country":"ロシア","value":278},{"country":"カタール","value":265},{"country":"サウジ","value":223},{"country":"ウズベキスタン","value":214},{"country":"エクアドル","value":209},{"country":"カザフ","value":205}]},{"title":"2025年6月","data":[{"country":"サウジ","value":904},{"country":"エジプト","value":735},{"country":"ベトナム","value":638},{"country":"フィリピン","value":301},{"country":"トルクメニスタン","value":251},{"country":"UAE","value":231},{"country":"カザフスタン","value":219},{"country":"アルジェリア","value":214},{"country":"アマン","value":203},{"country":"ロシア","value":202}]},{"title":"2025年7月","data":[{"country":"ペルー","value":1343},{"country":"サウジ","value":611},{"country":"ベトナム","value":594},{"country":"エジプト","value":480},{"country":"エクアドル","value":415},{"country":"カザフ","value":375},{"country":"UAE","value":302},{"country":"アルジェリア","value":216},{"country":"トルクメニスタン","value":215},{"country":"ウズベキスタン","value":200}]},{"title":"2025年8月","data":[{"country":"エジプト","value":909},{"country":"ペルー","value":842},{"country":"ベトナム","value":445},{"country":"メキシコ","value":423},{"country":"サウジ","value":360},{"country":"UAE","value":335},{"country":"チリ","value":291},{"country":"ブルキナファソ","value":275},{"country":"アルジェリア","value":269},{"country":"トルクメニスタン","value":255}]},{"title":"2025年9月","data":[{"country":"エジプト","value":1042},{"country":"ペルー","value":756},{"country":"モロッコ","value":657},{"country":"ベトナム","value":641},{"country":"エクアドル","value":497},{"country":"メキシコ","value":348},{"country":"UAE","value":329},{"country":"チリ","value":315},{"country":"カザフスタン","value":291},{"country":"パキスタン","value":274}]},{"title":"2025年10月","data":[{"country":"ペルー","value":963},{"country":"エジプト","value":561},{"country":"ベトナム","value":542},{"country":"チリ","value":485},{"country":"サウジ","value":452},{"country":"モロッコ","value":392},{"country":"エクアドル","value":365},{"country":"メキシコ","value":351},{"country":"カザフスタン","value":219},{"country":"パキスタン","value":213}]},{"title":"2025年11月","data":[{"country":"エジプト","value":782},{"country":"ペルー","value":755},{"country":"チリ","value":567},{"country":"カザフ","value":541},{"country":"ベトナム","value":371},{"country":"メキシコ","value":304},{"country":"ボリビア","value":264},{"country":"UAE","value":262},{"country":"マレーシア","value":238},{"country":"オーストラリア","value":235}]},{"title":"2025年12月","data":[{"country":"アルジェリア","value":2221},{"country":"エジプト","value":1541},{"country":"メキシコ","value":766},{"country":"ペルー","value":761},{"country":"ベトナム","value":595},{"country":"カタール","value":582},{"country":"UAE","value":517},{"country":"チリ","value":410},{"country":"サウジ","value":364},{"country":"カザフ","value":297}]},{"title":"2025年2月","data":[{"country":"アルジェリア","value":1689},{"country":"エジプト","value":1281},{"country":"ペルー","value":790},{"country":"サウジ","value":567},{"country":"ボリビア","value":510},{"country":"メキシコ","value":465},{"country":"UAE","value":404},{"country":"ベトナム","value":360},{"country":"マレーシア","value":213},{"country":"チュニジア","value":198}]},{"title":"2024年12月","data":[{"country":"サウジ","value":743},{"country":"ベトナム","value":540},{"country":"ペルー","value":535},{"country":"エジプト","value":504},{"country":"UAE","value":319},{"country":"ニカラグア","value":304},{"country":"カザフスタン","value":268},{"country":"チリ","value":250},{"country":"タンザニア","value":248},{"country":"マレーシア","value":226}]},{"title":"2024年11月","data":[{"country":"サウジ","value":827},{"country":"メキシコ","value":753},{"country":"ベトナム","value":675},{"country":"エジプト","value":632},{"country":"ニカラグア","value":608},{"country":"ペルー","value":426},{"country":"カザフスタン","value":304},{"country":"ボリビア","value":302},{"country":"アルジェリア","value":248},{"country":"マレーシア","value":186}]},{"title":"2026年2月","data":[{"country":"アルジェリア","value":1689},{"country":"エジプト","value":1281},{"country":"ペルー","value":790},{"country":"サウジ","value":567},{"country":"ボリビア","value":510},{"country":"メキシコ","value":465},{"country":"UAE","value":404},{"country":"ベトナム","value":360},{"country":"マレーシア","value":213},{"country":"チュニジア","value":198}]},{"title":"2026年1〜2月累計","data":[{"country":"アルジェリア","value":4740},{"country":"エジプト","value":2294},{"country":"ペルー","value":1785},{"country":"ボリビア","value":932},{"country":"UAE","value":908},{"country":"メキシコ","value":863},{"country":"ベトナム","value":854},{"country":"サウジ","value":736},{"country":"エクアドル","value":469},{"country":"マレーシア","value":410}]},{"title":"2026年3月","data":[{"country":"エジプト","value":1272},{"country":"サウジ","value":1065},{"country":"ペルー","value":872},{"country":"アルジェリア","value":602},{"country":"ベトナム","value":560},{"country":"ガーナ","value":257},{"country":"ロシア","value":235},{"country":"ウズベキスタン","value":231},{"country":"メキシコ","value":230}]},{"title":"2026年1〜3月累計","data":[{"country":"アルジェリア","value":5342},{"country":"エジプト","value":3566},{"country":"ペルー","value":2657},{"country":"サウジ","value":1801},{"country":"ベトナム","value":1414},{"country":"ボリビア","value":1106},{"country":"メキシコ","value":1093},{"country":"UAE","value":977},{"country":"エクアドル","value":617}]},{"title":"2026年4月","data":[{"country":"アルジェリア","value":1206},{"country":"ペルー","value":1003},{"country":"エジプト","value":781},{"country":"メキシコ","value":583},{"country":"サウジ","value":390},{"country":"ベトナム","value":371},{"country":"ナイジェリア","value":276},{"country":"カザフスタン","value":232},{"country":"エクアドル","value":221},{"country":"ボリビア","value":208}]},{"title":"2026年1〜4月累計","data":[{"country":"アルジェリア","value":6548},{"country":"エジプト","value":4347},{"country":"ペルー","value":3660},{"country":"サウジ","value":2191},{"country":"ベトナム","value":1783},{"country":"メキシコ","value":1676},{"country":"ボリビア","value":1314},{"country":"UAE","value":1044},{"country":"エクアドル","value":838},{"country":"カザフスタン","value":766}]},{"title":"2026年7月","data":[{"country":"エジプト","value":1956},{"country":"ペルー","value":900},{"country":"ボリビア","value":736},{"country":"アルジェリア","value":525},{"country":"サウジ","value":391},{"country":"ナイジェリア","value":332},{"country":"メキシコ","value":283},{"country":"ベトナム","value":256},{"country":"エクアドル","value":222},{"country":"カザフスタン","value":194}]},{"title":"2026年8月","data":[{"country":"アルジェリア","value":2541},{"country":"エジプト","value":1108},{"country":"ペルー","value":1029},{"country":"UAE","value":602},{"country":"ボリビア","value":362},{"country":"メキシコ","value":288},{"country":"チリ","value":255},{"country":"ベトナム","value":242},{"country":"ウズベキスタン","value":204},{"country":"ジンバブエ","value":197}]},{"title":"2026年1〜8月累計","data":[{"country":"エジプト","value":10792},{"country":"アルジェリア","value":10349},{"country":"ペルー","value":7480},{"country":"サウジ","value":3711},{"country":"ボリビア","value":3130},{"country":"ベトナム","value":2963},{"country":"メキシコ","value":2644},{"country":"UAE","value":1870},{"country":"エクアドル","value":1601},{"country":"カザフスタン","value":1372}]},{"title":"2026年9月","data":[{"country":"エジプト","value":2094},{"country":"ペルー","value":1189},{"country":"メキシコ","value":426},{"country":"ボリビア","value":356},{"country":"ウズベキスタン","value":312},{"country":"アルゼンチン","value":286},{"country":"エクアドル","value":283},{"country":"チリ","value":270},{"country":"ガーナ","value":241},{"country":"UAE","value":228}]},{"title":"2026年1〜9月累計","data":[{"country":"エジプト","value":12886},{"country":"アルジェリア","value":10406},{"country":"ペルー","value":8669},{"country":"サウジ","value":3916},{"country":"ボリビア","value":3486},{"country":"メキシコ","value":3070},{"country":"ベトナム","value":3003},{"country":"UAE","value":2098},{"country":"エクアドル","value":1884},{"country":"ウズベキスタン","value":1592}]}],"r12":[{"title":"2025年2月","data":[{"country":"ニジェール","value":495},{"country":"イスラエル","value":199},{"country":"オランダ","value":148},{"country":"ノルウェー","value":138},{"country":"韓国","value":88},{"country":"チリ","value":81},{"country":"シンガポール","value":77},{"country":"イタリア","value":72},{"country":"UAE","value":62},{"country":"エクアドル","value":59}]},{"title":"2025年11月","data":[{"country":"ネパール","value":312},{"country":"ポルトガル","value":158},{"country":"イスラエル","value":65},{"country":"英国","value":61},{"country":"韓国","value":54},{"country":"アラブ首長国連邦","value":50},{"country":"チリ","value":36},{"country":"バルバドス","value":35},{"country":"ベルギー","value":23},{"country":"日本","value":22}]},{"title":"2025年12月","data":[{"country":"ネパール","value":197},{"country":"イタリア","value":162},{"country":"韓国","value":105},{"country":"エチオピア","value":104},{"country":"ギリシャ","value":103},{"country":"ノルウェー","value":101},{"country":"ポルトガル","value":94},{"country":"ポルトガル","value":94},{"country":"チリ","value":87},{"country":"イスラエル","value":78}]},{"title":"2026年2月","data":[{"country":"ノルウェー","value":176},{"country":"メキシコ","value":109},{"country":"ブラジル","value":89},{"country":"ネパール","value":88},{"country":"中国台湾","value":65},{"country":"アラブ首長国連邦","value":61},{"country":"ベルギー","value":60},{"country":"英国","value":59},{"country":"スペイン","value":53},{"country":"インドネシア","value":51}]},{"title":"2024年12月","data":[{"country":"韓国","value":357},{"country":"ネパール","value":270},{"country":"ノルウェー","value":162},{"country":"英国","value":116},{"country":"メキシコ","value":65},{"country":"ウズベキスタン","value":64},{"country":"ウルグアイ","value":50},{"country":"ペルー","value":40},{"country":"シンガポール","value":32},{"country":"シンガポール","value":32}]},{"title":"2024年11月","data":[{"country":"韓国","value":235},{"country":"UAE","value":123},{"country":"ギリシャ","value":108},{"country":"英国","value":95},{"country":"カザフスタン","value":85},{"country":"ネパール","value":79},{"country":"メキシコ","value":68},{"country":"インドネシア","value":55},{"country":"インドネシア","value":55},{"country":"オーストラリア","value":48}]},{"title":"2025年3月","data":[{"country":"ニジェール","value":447},{"country":"イスラエル","value":167},{"country":"UAE","value":101},{"country":"韓国","value":90},{"country":"インド","value":50},{"country":"日本","value":46},{"country":"フィンランド","value":39},{"country":"中国台湾","value":36},{"country":"英国","value":35},{"country":"オランダ","value":34}]},{"title":"2025年4月","data":[{"country":"チリ","value":299},{"country":"ニジェール","value":216},{"country":"イタリア","value":160},{"country":"韓国","value":114},{"country":"オランダ","value":81},{"country":"中国台湾","value":80},{"country":"シンガポール","value":74},{"country":"エチオピア","value":56},{"country":"英国","value":55},{"country":"英国","value":55}]},{"title":"2025年5月","data":[{"country":"ニジェール","value":463},{"country":"チリ","value":362},{"country":"英国","value":95},{"country":"オランダ","value":89},{"country":"韓国","value":85},{"country":"インドネシア","value":79},{"country":"インド","value":50},{"country":"スペイン","value":43},{"country":"イスラエル","value":40},{"country":"中国台湾","value":36}]},{"title":"2025年6月","data":[{"country":"ニジェール","value":464},{"country":"チリ","value":417},{"country":"英国","value":113},{"country":"キルギス","value":93},{"country":"サウジ","value":90},{"country":"オランダ","value":60},{"country":"ノルウェー","value":55},{"country":"エチオピア","value":52},{"country":"インドネシア","value":51},{"country":"韓国","value":50}]},{"title":"2025年7月","data":[{"country":"チリ","value":522},{"country":"ニジェール","value":157},{"country":"オランダ","value":102},{"country":"韓国","value":86},{"country":"ウルグアイ","value":50},{"country":"シンガポール","value":47},{"country":"英国","value":46},{"country":"メキシコ","value":34},{"country":"ベルギー","value":24},{"country":"スペイン","value":23}]},{"title":"2025年8月","data":[{"country":"パキスタン","value":291},{"country":"英国","value":133},{"country":"ベルギー","value":101},{"country":"メキシコ","value":97},{"country":"韓国","value":68},{"country":"オランダ","value":53},{"country":"ルーマニア","value":52},{"country":"フィリピン","value":51},{"country":"イタリア","value":49},{"country":"イスラエル","value":46}]},{"title":"2025年9月","data":[{"country":"ウズベキスタン","value":202},{"country":"チリ","value":122},{"country":"パキスタン","value":109},{"country":"イスラエル","value":95},{"country":"英国","value":91},{"country":"ノルウェー","value":78},{"country":"韓国","value":73},{"country":"オランダ","value":58},{"country":"ベルギー","value":53},{"country":"エチオピア","value":46}]},{"title":"2025年10月","data":[{"country":"チリ","value":149},{"country":"オランダ","value":144},{"country":"ジブチ","value":116},{"country":"ニジェール","value":85},{"country":"イタリア","value":84},{"country":"ルーマニア","value":81},{"country":"ベルギー","value":72},{"country":"ポルトガル","value":61},{"country":"フィリピン","value":53},{"country":"スペイン","value":42}]},{"title":"2026年1〜2月累計","data":[{"country":"ノルウェー","value":457},{"country":"ネパール","value":217},{"country":"英国","value":140},{"country":"チリ","value":131},{"country":"サウジアラビア","value":124},{"country":"メキシコ","value":119},{"country":"ポルトガル","value":104},{"country":"エチオピア","value":99},{"country":"カザフスタン","value":95},{"country":"ベルギー","value":421}]},{"title":"2026年3月","data":[{"country":"ネパール","value":234},{"country":"ギリシャ","value":125},{"country":"ノルウェー","value":88},{"country":"台湾","value":81},{"country":"カザフスタン","value":78},{"country":"メキシコ","value":65},{"country":"パキスタン","value":50},{"country":"英国","value":47},{"country":"ポーランド","value":46},{"country":"韓国","value":45}]},{"title":"2026年1〜3月累計","data":[{"country":"ノルウェー","value":545},{"country":"ネパール","value":451},{"country":"英国","value":187},{"country":"メキシコ","value":184},{"country":"台湾","value":175},{"country":"カザフスタン","value":173},{"country":"ベルギー","value":126},{"country":"ギリシャ","value":125}]},{"title":"2026年4月","data":[{"country":"ネパール","value":234},{"country":"イスラエル","value":173},{"country":"オランダ","value":108},{"country":"エチオピア","value":100},{"country":"チリ","value":70},{"country":"マレーシア","value":67},{"country":"パキスタン","value":40},{"country":"カザフスタン","value":35},{"country":"ベルギー","value":33},{"country":"ノルウェー","value":31}]},{"title":"2026年1〜4月累計","data":[{"country":"ネパール","value":685},{"country":"ノルウェー","value":576},{"country":"イスラエル","value":246},{"country":"チリ","value":245},{"country":"カザフスタン","value":208},{"country":"英国","value":206},{"country":"中国台湾","value":205},{"country":"エチオピア","value":199},{"country":"メキシコ","value":192},{"country":"ベルギー","value":159}]},{"title":"2026年7月","data":[{"country":"ネパール","value":321},{"country":"メキシコ","value":222},{"country":"ベルギー","value":186},{"country":"エチオピア","value":163},{"country":"英国","value":121},{"country":"イスラエル","value":91},{"country":"マレーシア","value":73},{"country":"パキスタン","value":68},{"country":"ナイジェリア","value":60},{"country":"インドネシア","value":56}]},{"title":"2026年8月","data":[{"country":"ネパール","value":260},{"country":"パキスタン","value":255},{"country":"エチオピア","value":218},{"country":"ベルギー","value":157},{"country":"イスラエル","value":125},{"country":"英国","value":72},{"country":"ノルウェー","value":63},{"country":"韓国","value":53},{"country":"チリ","value":52}]},{"title":"2026年1〜8月累計","data":[{"country":"ネパール","value":1967},{"country":"エチオピア","value":801},{"country":"ノルウェー","value":711},{"country":"イスラエル","value":643},{"country":"ベルギー","value":583},{"country":"パキスタン","value":536},{"country":"メキシコ","value":526},{"country":"英国","value":459},{"country":"チリ","value":319},{"country":"オランダ","value":289}]},{"title":"2026年9月","data":[{"country":"エチオピア","value":435},{"country":"ネパール","value":358},{"country":"ベトナム","value":344},{"country":"パキスタン","value":293},{"country":"タイ","value":224},{"country":"イスラエル","value":96},{"country":"韓国","value":64},{"country":"チリ","value":58},{"country":"英国","value":57}]},{"title":"2026年1〜9月累計","data":[{"country":"ネパール","value":2325},{"country":"エチオピア","value":1236},{"country":"パキスタン","value":829},{"country":"イスラエル","value":739},{"country":"ノルウェー","value":711},{"country":"ベルギー","value":594},{"country":"メキシコ","value":536},{"country":"英国","value":516},{"country":"オランダ","value":385},{"country":"ベトナム","value":377}]}],"r6b":[{"title":"2025年3月","data":[{"country":"UAE","value":8329},{"country":"スペイン","value":4721},{"country":"英国","value":2224},{"country":"イタリア","value":1907},{"country":"イスラエル","value":1870},{"country":"オーストラリア","value":1691},{"country":"メキシコ","value":1422},{"country":"フランス","value":1185},{"country":"サウジ","value":1080},{"country":"米国","value":973}]},{"title":"2025年4月","data":[{"country":"UAE","value":6348},{"country":"英国","value":3344},{"country":"スペイン","value":1993},{"country":"ブラジル","value":1922},{"country":"メキシコ","value":1806},{"country":"イタリア","value":1431},{"country":"フランス","value":971},{"country":"ヨルダン","value":866},{"country":"米国","value":820},{"country":"オーストラリア","value":803}]},{"title":"2025年5月","data":[{"country":"UAE","value":10501},{"country":"英国","value":4458},{"country":"ブラジル","value":3959},{"country":"スペイン","value":2636},{"country":"フランス","value":2144},{"country":"イタリア","value":2131},{"country":"米国","value":1614},{"country":"オーストラリア","value":1608},{"country":"イスラエル","value":1261},{"country":"オランダ","value":1130}]},{"title":"2025年6月","data":[{"country":"UAE","value":8467},{"country":"英国","value":3743},{"country":"スペイン","value":2301},{"country":"イスラエル","value":2194},{"country":"メキシコ","value":2087},{"country":"オランダ","value":1722},{"country":"フランス","value":1680},{"country":"オーストラリア","value":1238},{"country":"米国","value":1006},{"country":"ドイツ","value":798}]},{"title":"2025年7月","data":[{"country":"UAE","value":10958},{"country":"英国","value":5121},{"country":"スペイン","value":2687},{"country":"イタリア","value":2135},{"country":"ベルギー","value":1849},{"country":"フランス","value":1764},{"country":"メキシコ","value":1662},{"country":"オーストラリア","value":1389},{"country":"スロベニア","value":1364},{"country":"アルゼンチン","value":1336}]},{"title":"2025年8月","data":[{"country":"UAE","value":9461},{"country":"英国","value":6581},{"country":"イタリア","value":4197},{"country":"スペイン","value":3382},{"country":"イスラエル","value":3243},{"country":"オーストラリア","value":2918},{"country":"オランダ","value":2463},{"country":"ポーランド","value":2106},{"country":"フランス","value":1336},{"country":"スロベニア","value":1236}]},{"title":"2025年9月","data":[{"country":"UAE","value":8164},{"country":"スペイン","value":4109},{"country":"ブラジル","value":3694},{"country":"イスラエル","value":3475},{"country":"英国","value":3387},{"country":"イタリア","value":3292},{"country":"メキシコ","value":3183},{"country":"ドイツ","value":3024},{"country":"オーストラリア","value":2824},{"country":"ポーランド","value":2763}]},{"title":"2025年10月","data":[{"country":"英国","value":4482},{"country":"UAE","value":4061},{"country":"ブラジル","value":3841},{"country":"イタリア","value":3454},{"country":"ポーランド","value":3076},{"country":"アルゼンチン","value":2941},{"country":"オーストラリア","value":2928},{"country":"フランス","value":2902},{"country":"イスラエル","value":2577},{"country":"米国","value":2442}]},{"title":"2025年11月","data":[{"country":"イタリア","value":5330},{"country":"スペイン","value":5134},{"country":"アラブ首長国連邦","value":4474},{"country":"ブラジル","value":4175},{"country":"英国","value":2712},{"country":"オーストラリア","value":2295},{"country":"イスラエル","value":2267},{"country":"アルゼンチン","value":2178},{"country":"ポーランド","value":2126},{"country":"オランダ","value":1880}]},{"title":"2025年12月","data":[{"country":"アラブ首長国連邦","value":11083},{"country":"英国","value":7039},{"country":"スペイン","value":6855},{"country":"アルゼンチン","value":3972},{"country":"イタリア","value":3680},{"country":"メキシコ","value":3252},{"country":"ブラジル","value":3212},{"country":"イスラエル","value":2832},{"country":"フランス","value":2424},{"country":"ポーランド","value":2241}]},{"title":"2025年2月","data":[{"country":"イタリア","value":8199},{"country":"アラブ首長国連邦","value":6570},{"country":"スペイン","value":5961},{"country":"英国","value":5884},{"country":"フランス","value":4389},{"country":"アルゼンチン","value":3742},{"country":"ブラジル","value":3644},{"country":"ポーランド","value":2521},{"country":"イラク","value":1602},{"country":"イスラエル","value":1554}]},{"title":"2026年2月","data":[{"country":"イタリア","value":8199},{"country":"UAE","value":6570},{"country":"スペイン","value":5961},{"country":"英国","value":5884},{"country":"フランス","value":4389},{"country":"アルゼンチン","value":3742},{"country":"ブラジル","value":3644},{"country":"ポーランド","value":2521},{"country":"イラク","value":1602},{"country":"イスラエル","value":1554}]},{"title":"2026年1〜2月累計","data":[{"country":"スペイン","value":14422},{"country":"UAE","value":13761},{"country":"英国","value":12148},{"country":"イタリア","value":11110},{"country":"ブラジル","value":5966},{"country":"フランス","value":5635},{"country":"ポーランド","value":5410},{"country":"アルゼンチン","value":4003},{"country":"米国","value":2463},{"country":"オーストラリア","value":1637}]},{"title":"2026年3月","data":[{"country":"英国","value":8362},{"country":"イタリア","value":5648},{"country":"フランス","value":5421},{"country":"ブラジル","value":5073},{"country":"スペイン","value":3743},{"country":"パキスタン","value":2841},{"country":"ポーランド","value":2252},{"country":"オーストラリア","value":2053},{"country":"スロベニア","value":1219},{"country":"アメリカ","value":1202}]},{"title":"2026年1〜3月累計","data":[{"country":"英国","value":20510},{"country":"スペイン","value":18165},{"country":"イタリア","value":16758},{"country":"フランス","value":11056},{"country":"ブラジル","value":11039},{"country":"ポーランド","value":7662},{"country":"アルゼンチン","value":5152},{"country":"パキスタン","value":4161},{"country":"オーストラリア","value":3968},{"country":"アメリカ","value":3665}]},{"title":"2026年4月","data":[{"country":"ブラジル","value":12117},{"country":"英国","value":5334},{"country":"スペイン","value":3771},{"country":"ポーランド","value":3747},{"country":"パキスタン","value":3540},{"country":"イタリア","value":3152},{"country":"オーストラリア","value":2713},{"country":"フランス","value":2625},{"country":"ヨルダン","value":2507},{"country":"スロベニア","value":2246}]},{"title":"2026年1〜4月累計","data":[{"country":"英国","value":25844},{"country":"ブラジル","value":23156},{"country":"スペイン","value":21936},{"country":"イタリア","value":19910},{"country":"UAE","value":13786},{"country":"フランス","value":13681},{"country":"ポーランド","value":11409},{"country":"パキスタン","value":7701},{"country":"オーストラリア","value":6681},{"country":"アルゼンチン","value":5829}]},{"title":"2026年7月","data":[{"country":"英国","value":8472},{"country":"イタリア","value":7173},{"country":"スペイン","value":7129},{"country":"フランス","value":6765},{"country":"ポーランド","value":4758},{"country":"UAE","value":3412},{"country":"オーストラリア","value":2975},{"country":"ヨルダン","value":2596},{"country":"ベルギー","value":2312},{"country":"イスラエル","value":1950}]},{"title":"2026年8月","data":[{"country":"ブラジル","value":7942},{"country":"イタリア","value":7025},{"country":"UAE","value":5532},{"country":"英国","value":4647},{"country":"スペイン","value":4473},{"country":"フランス","value":4098},{"country":"ポーランド","value":3489},{"country":"カザフスタン","value":3359},{"country":"アルゼンチン","value":3133},{"country":"オーストラリア","value":2222}]},{"title":"2026年1〜8月累計","data":[{"country":"英国","value":52677},{"country":"イタリア","value":51970},{"country":"スペイン","value":45638},{"country":"ブラジル","value":44857},{"country":"フランス","value":36053},{"country":"ポーランド","value":29708},{"country":"UAE","value":25372},{"country":"オーストラリア","value":18745},{"country":"アルゼンチン","value":17959},{"country":"ヨルダン","value":12034}]},{"title":"2026年9月","data":[{"country":"フランス","value":8584},{"country":"英国","value":7734},{"country":"イタリア","value":7643},{"country":"ブラジル","value":7414},{"country":"スペイン","value":5955},{"country":"UAE","value":5150},{"country":"ポーランド","value":3803},{"country":"イラク","value":3057},{"country":"カザフスタン","value":2952},{"country":"オーストラリア","value":2801}]},{"title":"2026年1〜9月累計","data":[{"country":"英国","value":60411},{"country":"イタリア","value":59613},{"country":"ブラジル","value":52271},{"country":"スペイン","value":51593},{"country":"フランス","value":44637},{"country":"ポーランド","value":33511},{"country":"UAE","value":30522},{"country":"オーストラリア","value":21546},{"country":"アルゼンチン","value":20299},{"country":"イラク","value":14836}]}],"r9b":[{"title":"2025年1〜2月累計","data":[{"country":"オーストラリア","value":3751},{"country":"メキシコ","value":1286},{"country":"タイ","value":494},{"country":"ニュージーランド","value":407},{"country":"フィリピン","value":387},{"country":"ウラグアイ","value":286},{"country":"コロンビア","value":208},{"country":"イタリア","value":182},{"country":"ニジェール","value":166},{"country":"ニジェール","value":166}]},{"title":"2025年8月","data":[{"country":"オーストラリア","value":848},{"country":"南アフリカ","value":431},{"country":"チリ","value":430},{"country":"インドネシア","value":347},{"country":"トルコ","value":260},{"country":"タイ","value":240},{"country":"ブラジル","value":228},{"country":"ベルギー","value":225},{"country":"ウラグアイ","value":202},{"country":"マレーシア","value":190}]},{"title":"2025年12月","data":[{"country":"ウズベキスタン","value":1131},{"country":"英国","value":775},{"country":"オーストラリア","value":653},{"country":"オランダ","value":628},{"country":"ベルギー","value":625},{"country":"チェコ","value":534},{"country":"アメリカ","value":485},{"country":"ロマニア","value":463},{"country":"ドイツ","value":454},{"country":"チリ","value":452}]},{"title":"2024年12月","data":[{"country":"オーストラリア","value":1666},{"country":"メキシコ","value":922},{"country":"シンガポール","value":187},{"country":"ノルウェー","value":148},{"country":"ブラジル","value":141},{"country":"タイ","value":128},{"country":"アメリカ","value":93},{"country":"オーストリア","value":88},{"country":"UAE","value":80},{"country":"フィリピン","value":79}]},{"title":"2024年11月","data":[{"country":"メキシコ","value":2087},{"country":"タイ","value":397},{"country":"ニュージーランド","value":281},{"country":"イスラエル","value":236},{"country":"チリ","value":234},{"country":"オーストラリア","value":157},{"country":"ノルウェー","value":156},{"country":"フィリピン","value":141},{"country":"英国","value":93},{"country":"ブラジル","value":90}]},{"title":"2026年2月","data":[{"country":"オーストラリア","value":1433},{"country":"アルゼンチン","value":380},{"country":"UAE","value":272},{"country":"南アフリカ","value":217},{"country":"チリ","value":209},{"country":"パキスタン","value":185},{"country":"ブラジル","value":101},{"country":"サウジ","value":80},{"country":"コロンビア","value":38},{"country":"ウルグアイ","value":30}]},{"title":"2026年1〜2月累計","data":[{"country":"オーストラリア","value":3083},{"country":"ベルギー","value":2615},{"country":"米国","value":1751},{"country":"チリ","value":798},{"country":"ウズベキスタン","value":1189},{"country":"UAE","value":776},{"country":"英国","value":1051},{"country":"アルゼンチン","value":440},{"country":"韓国","value":834},{"country":"南アフリカ","value":579}]},{"title":"2026年3月","data":[{"country":"ウズベキスタン","value":2256},{"country":"アメリカ","value":1019},{"country":"キルギス","value":438},{"country":"英国","value":400},{"country":"オランダ","value":365},{"country":"タイ","value":308},{"country":"ベルギー","value":294},{"country":"カナダ","value":288},{"country":"ドイツ","value":268},{"country":"インドネシア","value":241}]},{"title":"2026年1〜3月累計","data":[{"country":"ウズベキスタン","value":3445},{"country":"ベルギー","value":2909},{"country":"アメリカ","value":2770},{"country":"英国","value":1451},{"country":"ドイツ","value":1042},{"country":"タイ","value":1029},{"country":"韓国","value":988},{"country":"オランダ","value":976},{"country":"イタリア","value":845},{"country":"キルギス","value":801}]},{"title":"2026年4月","data":[{"country":"ウズベキスタン","value":3954},{"country":"オーストラリア","value":3452},{"country":"アメリカ","value":1575},{"country":"タイ","value":773},{"country":"ウクライナ","value":747},{"country":"ベルギー","value":679},{"country":"英国","value":629},{"country":"フィリピン","value":550},{"country":"ルーマニア","value":505},{"country":"キルギス","value":501}]},{"title":"2026年1〜4月累計","data":[{"country":"ウズベキスタン","value":7399},{"country":"オーストラリア","value":7921},{"country":"アメリカ","value":4345},{"country":"ベルギー","value":3588},{"country":"英国","value":2080},{"country":"タイ","value":1802},{"country":"ウクライナ","value":1385},{"country":"韓国","value":1366},{"country":"ドイツ","value":1334},{"country":"キルギス","value":1302}]}]},"russiaByBody":{"years":["2020","2022","2024","2025","2026.1-3月","2026.4月","2026.1-4月累計"],"categories":[{"name":"≤9座小型乗用車","type":"pass","vals":[2.2,4.0,46.1,31.2,9.3,4.3,13.7]},{"name":"セダン","type":"pass","vals":[1.5,6.6,43.4,20.4,8.0,2.7,10.7]},{"name":"四駆SUV","type":"pass","vals":[0.0,0.6,13.0,3.1,1.2,0.4,1.5]},{"name":"その他乗用車","type":"pass","vals":[0.0,0.3,0.5,0.9,0.3,0.1,0.3]},{"name":"その他乗用車","type":"pass","vals":[0.1,0.0,0.1,0.0,0.0,0.0,0.0]},{"name":"軽トラック","type":"truck","vals":[0.1,0.6,2.2,1.1,0.3,0.2,0.5]},{"name":"重トラック","type":"truck","vals":[0.2,2.5,3.2,0.0,0.1,0.1,0.2]},{"name":"中型トラック","type":"truck","vals":[0.1,0.4,1.3,0.0,0.0,0.0,0.0]},{"name":"その他貨物車","type":"truck","vals":[0.0,0.6,4.5,0.0,0.0,0.3,0.3]},{"name":"大型バス","type":"bus","vals":[0.1,0.1,0.3,0.4,0.0,0.0,0.1]},{"name":"小型バス","type":"bus","vals":[0.0,0.0,0.1,0.0,0.0,0.0,0.0]}]},"nevMonthly":{"2022":[9.4,8.2,5.4,3.8,8.7,7.0,9.4,12.2,12.0,15.0,15.5,12.3],"2023":[13.4,12.3,13.2,13.1,15.5,12.4,13.7,14.4,17.1,19.3,15.3,13.7],"2024":[15.2,13.2,17.1,20.7,20.7,13.3,16.8,17.2,18.1,19.9,13.6,15.3],"2025":[21.0,14.8,21.7,29.2,30.4,25.5,29.1,31.5,30.0,32.8,34.9,41.8],"2026":[33.9,31.4,32.9,45.1,45.8,52.9,54.0,49.8,61.2,null,null,null]},"truckWeight":{"years":["2020","2022","2024","2025計","2026.1-8月","2026.9月","2026.1-9月累計"],"categories":[{"name":"ガソリン ≤5t","power":"ガソリン","vals":[5.9,13.4,17.5,21.9,17.8,2,20]},{"name":"ガソリン 5-8t","power":"ガソリン","vals":[0.1,0.0,0.0,0.0,0.1,0,0]},{"name":"ガソリン >8t","power":"ガソリン","vals":[0.0,0.0,0.1,0.1,0.1,0,0]},{"name":"ディーゼル ≤5t","power":"ディーゼル","vals":[6.6,19.8,19.6,28.5,26.0,3,29]},{"name":"ディーゼル 5-14t","power":"ディーゼル","vals":[2.3,4.6,5.7,7.9,8.3,1,9]},{"name":"ディーゼル 14-20t","power":"ディーゼル","vals":[0.6,1.0,2.2,2.8,2.6,null,null]},{"name":"ディーゼル >20t","power":"ディーゼル","vals":[3.1,7.8,12.0,13.9,10.5,2,12]},{"name":"ディーゼル その他","power":"ディーゼル","vals":[0.0,0.0,14.7,14.9,13.3,2,15]},{"name":"BEV","power":"BEV","vals":[0.0,2.3,2.4,8.5,3.6,1,4]},{"name":"PHEV ≤5t","power":"PHEV","vals":[0.0,0.0,1.2,5.3,4.0,1,5]},{"name":"PHEV >20t","power":"PHEV","vals":[0.0,0.1,0.0,0.0,0.0,null,null]},{"name":"不明","power":"不明","vals":[3.0,4.2,4.0,2.7,3.5,0,3]}]},"busSeats":{"years":["2020","2022","2024","2025計","2026.1-8月","2026.9月","2026.1-9月累計"],"categories":[{"name":"ガソリン 10≤座<20","power":"ガソリン","vals":[0.9,1.1,2.4,3.0,2.0,0.2,2.2]},{"name":"ガソリン 20≤座<30","power":"ガソリン","vals":[0.2,0.2,0.6,0.8,0.2,0.0,0.2]},{"name":"ガソリン 座≥30","power":"ガソリン","vals":[1.0,0.9,2.4,2.6,2.2,0.2,2.4]},{"name":"ディーゼル 10≤座<20","power":"ディーゼル","vals":[1.5,1.6,1.2,1.9,2.3,0.3,2.6]},{"name":"ディーゼル 20≤座<30","power":"ディーゼル","vals":[0.1,0.1,0.2,0.3,0.1,0.1,0.2]},{"name":"ディーゼル 座≥30","power":"ディーゼル","vals":[0.0,0.1,0.2,0.3,0.2,0.0,0.2]},{"name":"BEV 10≤座<20","power":"BEV","vals":[0.0,0.1,0.5,0.5,null,null,null]},{"name":"BEV 20≤座<30","power":"BEV","vals":[0.0,0.2,0.4,0.4,null,null,null]},{"name":"BEV 座≥30","power":"BEV","vals":[0.2,0.3,0.5,0.8,null,null,null]},{"name":"BEV（座席区分なし）","power":"BEV","vals":[null,null,null,null,1.1,0.3,1.4]},{"name":"不明","power":"不明","vals":[0.0,0.0,0.0,0.0,0.0,0.0,0.0]}]},"powerByRegion":{"powers":["ガソリン","BEV","PHEV","HEV","ディーゼル"],"regions":["EU","中南米","露・中央アジア","中東","東南亜","アフリカ","オセアニア","南アジア","日韓","北米"],"data":{"ガソリン":{"EU":{"y2025":19.9,"y2026":6.7},"中南米":{"y2025":83.1,"y2026":26.9},"露・中央アジア":{"y2025":89.8,"y2026":37.8},"中東":{"y2025":73.5,"y2026":16.7},"東南亜":{"y2025":23.5,"y2026":7.4},"アフリカ":{"y2025":43.0,"y2026":18.0},"オセアニア":{"y2025":10.8,"y2026":3.4},"南アジア":{"y2025":3.4,"y2026":1.7},"日韓":{"y2025":2.4,"y2026":0.3},"北米":{"y2025":5.2,"y2026":1.2}},"BEV":{"EU":{"y2025":66.0,"y2026":30.5},"中南米":{"y2025":29.9,"y2026":17.5},"露・中央アジア":{"y2025":14.0,"y2026":1.9},"中東":{"y2025":19.6,"y2026":3.0},"東南亜":{"y2025":58.4,"y2026":19.7},"アフリカ":{"y2025":4.7,"y2026":1.9},"オセアニア":{"y2025":9.7,"y2026":5.2},"南アジア":{"y2025":17.3,"y2026":4.9},"日韓":{"y2025":10.1,"y2026":6.5},"北米":{"y2025":1.8,"y2026":1.3}},"PHEV":{"EU":{"y2025":29.0,"y2026":17.4},"中南米":{"y2025":26.1,"y2026":13.3},"露・中央アジア":{"y2025":3.1,"y2026":4.2},"中東":{"y2025":26.5,"y2026":8.6},"東南亜":{"y2025":5.8,"y2026":2.7},"アフリカ":{"y2025":0.0,"y2026":1.8},"オセアニア":{"y2025":6.0,"y2026":2.9},"南アジア":{"y2025":1.5,"y2026":1.0},"日韓":{"y2025":0.0,"y2026":0.1},"北米":{"y2025":0.0,"y2026":0.0}},"HEV":{"EU":{"y2025":20.2,"y2026":11.6},"中南米":{"y2025":7.2,"y2026":4.2},"露・中央アジア":{"y2025":1.7,"y2026":0.7},"中東":{"y2025":12.8,"y2026":2.5},"東南亜":{"y2025":1.7,"y2026":1.3},"アフリカ":{"y2025":0.5,"y2026":0.8},"オセアニア":{"y2025":0.5,"y2026":0.8},"南アジア":{"y2025":0.4,"y2026":0.8},"日韓":{"y2025":0.7,"y2026":0.1},"北米":{"y2025":2.2,"y2026":0.4}},"ディーゼル":{"EU":{"y2025":2.1,"y2026":1.0},"中南米":{"y2025":17.3,"y2026":7.7},"露・中央アジア":{"y2025":5.3,"y2026":1.8},"中東":{"y2025":1.3,"y2026":1.6},"東南亜":{"y2025":12.7,"y2026":5.6},"アフリカ":{"y2025":25.2,"y2026":13.2},"オセアニア":{"y2025":1.5,"y2026":1.1},"南アジア":{"y2025":1.2,"y2026":0.4},"日韓":{"y2025":0.0,"y2026":0.0},"北米":{"y2025":0.0,"y2026":0.0}}}}};
  // 商用車（国内）データ
  const CV_HARDCODED = {"monthly":{"2022":[19.3,26.6,30.4,20.7,24.1,26.4,24.7,31.2,21.0,18.5,18.1,24.6],"2023":[14.6,31.0,31.0,24.1,23.8,22.7,22.2,24.3,25.0,23.7,23.3,22.0],"2024":[19.1,14.5,34.2,28.2,25.0,22.2,22.1,21.5,22.6,22.5,24.9,28.2],"2025":[16.4,23.7,31.6,28.3,25.6,25.9,24.9,24.6,29.1,24.7,25.8,29.7],"2026":[19.5,12.5,34.7,32.3,27.4,27.8,23.3,22.9,26.3,null,null,null]},"annualMeta":{"labels":{"pre":"1-8月","cur":"9月","ytd":"1-9月計","rest":"10-12月"}},"annual":[{"year":"2022","pre":203.4,"cur":21.0,"ytd":224.4,"rest":61.2,"total":285,"pre_yoy":null,"cur_yoy":-28,"ytd_yoy":null,"rest_yoy":null,"total_yoy":-37,"cur_mom":-33},{"year":"2023","pre":193.7,"cur":25.0,"ytd":218.7,"rest":69.0,"total":288,"pre_yoy":-5,"cur_yoy":19,"ytd_yoy":-3,"rest_yoy":13,"total_yoy":1,"cur_mom":3},{"year":"2024","pre":186.8,"cur":22.6,"ytd":209.4,"rest":75.6,"total":285,"pre_yoy":-4,"cur_yoy":-10,"ytd_yoy":-4,"rest_yoy":10,"total_yoy":-1,"cur_mom":5},{"year":"2025","pre":201.0,"cur":29.1,"ytd":230.1,"rest":80.2,"total":310,"pre_yoy":8,"cur_yoy":29,"ytd_yoy":10,"rest_yoy":6,"total_yoy":9,"cur_mom":18},{"year":"2026","pre":200.4,"cur":26.3,"ytd":226.8,"rest":null,"total":null,"pre_yoy":0,"cur_yoy":-10,"ytd_yoy":-1,"rest_yoy":null,"total_yoy":null,"cur_mom":15}],"nevMonthly":{"2023":[0.73,1.92,1.98,1.82,2.13,2.43,2.85,3.23,3.44,3.37,3.74,3.8],"2024":[2.45,1.61,4.9,4.59,4.67,4.58,4.7,5.03,5.45,5.51,6.33,8.06],"2025":[3.05,4.53,6.97,7.03,6.75,7.47,7.15,7.34,9.43,7.98,9.21,13.75],"2026":[4.99,2.85,9.89,11.14,10.78,12.2,10.25,10.38,13.07,null,null,null]},"nevAnnualMeta":{"labels":{"pre":"1-8月","cur":"9月","ytd":"1-9月計","rest":"10-12月"},"note":"2021・2022年は通年値のみ（前回4月記事の値）"},"nevAnnual":[{"year":"2021","pre":null,"cur":null,"ytd":null,"rest":null,"total":13,"pre_yoy":null,"cur_yoy":null,"ytd_yoy":null,"rest_yoy":null,"total_yoy":null,"cur_mom":null},{"year":"2022","pre":null,"cur":null,"ytd":null,"rest":null,"total":33,"pre_yoy":null,"cur_yoy":null,"ytd_yoy":null,"rest_yoy":null,"total_yoy":154,"cur_mom":null},{"year":"2023","pre":17.1,"cur":3.44,"ytd":20.5,"rest":10.9,"total":31.4,"pre_yoy":null,"cur_yoy":null,"ytd_yoy":null,"rest_yoy":null,"total_yoy":-5,"cur_mom":7},{"year":"2024","pre":32.5,"cur":5.45,"ytd":38.0,"rest":19.9,"total":57.9,"pre_yoy":90,"cur_yoy":58,"ytd_yoy":85,"rest_yoy":82,"total_yoy":84,"cur_mom":8},{"year":"2025","pre":50.3,"cur":9.43,"ytd":59.7,"rest":30.9,"total":90.7,"pre_yoy":55,"cur_yoy":73,"ytd_yoy":57,"rest_yoy":55,"total_yoy":57,"cur_mom":28},{"year":"2026","pre":72.5,"cur":13.07,"ytd":85.6,"rest":null,"total":null,"pre_yoy":44,"cur_yoy":39,"ytd_yoy":43,"rest_yoy":null,"total_yoy":null,"cur_mom":26}],"penetration":{"years":["2021","2022","2023","2024","2025","2026"],"monthly":{"2021":{"BEV":[2.3,1.6,1.8,2.5,2.7,2.9,4.9,5.4,6.1,7.0,7.7,13.4],"total":[2.4,1.7,1.9,2.5,2.8,3.0,5.0,5.5,6.2,7.1,7.8,13.6]},"2022":{"BEV":[4.9,3.8,7.6,8.8,7.9,9.7,10.1,8.7,13.3,14.6,18.9,32.0],"total":[5.2,3.9,7.8,9.0,8.1,10.1,10.4,8.9,13.6,14.9,19.4,32.7]},"2023":{"BEV":[4.8,6.0,6.1,7.3,8.6,10.3,12.2,12.7,13.3,13.7,15.4,15.9],"total":[5.0,6.2,6.4,7.5,8.9,10.7,12.8,13.3,13.8,14.2,16.1,17.3]},"2024":{"BEV":[12.3,10.7,13.8,15.8,17.9,19.9,20.2,22.2,23.3,23.7,24.5,27.2],"total":[12.9,11.1,14.3,16.3,18.7,20.6,21.2,23.4,24.1,24.6,25.4,28.6]},"2025":{"BEV":[17.8,18.4,21.3,24.0,25.5,27.8,27.6,29.0,31.5,31.2,34.5,43.0],"PHEV":[0.7,0.6,0.6,0.8,0.8,0.9,0.9,0.8,0.7,0.9,0.9,1.2],"H2":[0.1,0.1,0.2,0.0,0.0,0.2,0.1,0.1,0.2,0.2,0.3,2.0],"total":[18.6,19.1,22.1,24.8,26.3,28.9,28.7,29.9,32.4,32.2,35.6,46.2]},"2026":{"BEV":[24.5,21.3,27.3,33.5,38.3,42.5,43.0,44.3,48.5],"PHEV":[0.8,1.5,1.1,0.9,1.0,1.4,1.0,1.0,1.1],"H2":[0.3,0.0,0.0,0.0,0.1,0.0,0.1,0.1,0.1],"total":[25.5,22.9,28.5,34.5,39.3,43.9,44.1,45.3,49.7]}},"totalRate":{"2021":4.3,"2022":11.7,"2023":10.9,"2024":20.3,"2025":29.2,"2026":37.7}},"nevPenetration":{"years":["2022","2023","2024","2025","2026"],"basis":"各年9月","categories":[{"name":"軽トラック","rate":{"2022":7,"2023":12,"2024":21,"2025":27,"2026":36}},{"name":"重トラック","rate":{"2022":5,"2023":6,"2024":19,"2025":29,"2026":50}},{"name":"微トラック","rate":{"2022":5,"2023":7,"2024":5,"2025":6,"2026":36}},{"name":"ピックアップ","rate":{"2022":1,"2023":2,"2024":5,"2025":10,"2026":17}},{"name":"中型トラック","rate":{"2022":4,"2023":4,"2024":7,"2025":12,"2026":20}},{"name":"トラック計","rate":{"2022":5,"2023":8,"2024":15,"2025":23,"2026":39},"isTotal":true},{"name":"軽バス","rate":{"2022":37,"2023":47,"2024":60,"2025":70,"2026":83}},{"name":"中型バス","rate":{"2022":59,"2023":48,"2024":64,"2025":73,"2026":64}},{"name":"大型バス","rate":{"2022":76,"2023":48,"2024":41,"2025":64,"2026":65}},{"name":"バス計","rate":{"2022":42,"2023":47,"2024":60,"2025":70,"2026":82},"isTotal":true},{"name":"商用車全体","rate":{"2022":11,"2023":14,"2024":24,"2025":32,"2026":48},"isTotal":true,"isGrand":true}]},"companiesMeta":{"years":["2020","2021","2022","2023","2024","2025"],"ytdLabel":"1-9月","monthLabel":"9月","total":{"vals":{"2020":479,"2021":455,"2022":285,"2023":288,"2024":285,"2025":310,"2026":227,"m":26.3},"ytdYoy":-1,"yoy":-21,"mom":15}},"companies":[{"name":"北汽福田","vals":{"2020":60,"2021":58,"2022":34,"2023":40,"2024":39,"2025":47,"2026":33,"m":3.7},"ytdYoy":-7,"yoy":-25,"mom":8},{"name":"上汽通用五菱","vals":{"2020":56,"2021":53,"2022":42,"2023":37,"2024":35,"2025":32,"2026":22,"m":2.2},"ytdYoy":-8,"yoy":-18,"mom":-3},{"name":"中国重汽","vals":{"2020":40,"2021":35,"2022":15,"2023":18,"2024":20,"2025":25,"2026":19,"m":2.0},"ytdYoy":6,"yoy":-21,"mom":11},{"name":"江鈴汽車","vals":{"2020":26,"2021":26,"2022":19,"2023":19,"2024":19,"2025":19,"2026":14,"m":1.7},"ytdYoy":2,"yoy":-17,"mom":13},{"name":"東風汽車","vals":{"2020":38,"2021":36,"2022":21,"2023":23,"2024":22,"2025":24,"2026":15,"m":1.7},"ytdYoy":-19,"yoy":-36,"mom":19},{"name":"一汽解放","vals":{"2020":45,"2021":39,"2022":15,"2023":19,"2024":20,"2025":21,"2026":15,"m":1.7},"ytdYoy":-3,"yoy":-38,"mom":22},{"name":"長安汽車","vals":{"2020":29,"2021":28,"2022":23,"2023":23,"2024":20,"2025":19,"2026":13,"m":1.3},"ytdYoy":-12,"yoy":-30,"mom":7},{"name":"吉利汽車","vals":{"2020":0,"2021":1,"2022":3,"2023":7,"2024":8,"2025":9,"2026":8,"m":1.7},"ytdYoy":29,"yoy":12,"mom":80},{"name":"上汽大通","vals":{"2020":10,"2021":13,"2022":10,"2023":9,"2024":8,"2025":10,"2026":9,"m":1.0},"ytdYoy":24,"yoy":-2,"mom":14},{"name":"江淮汽車","vals":{"2020":26,"2021":22,"2022":13,"2023":13,"2024":13,"2025":13,"2026":8,"m":0.9},"ytdYoy":-18,"yoy":-27,"mom":13},{"name":"長城汽車","vals":{"2020":20,"2021":19,"2022":15,"2023":16,"2024":13,"2025":12,"2026":8,"m":0.7},"ytdYoy":-17,"yoy":-25,"mom":-1},{"name":"陝汽集団","vals":{"2020":18,"2021":17,"2022":5,"2023":7,"2024":8,"2025":11,"2026":7,"m":0.7},"ytdYoy":-16,"yoy":-48,"mom":18},{"name":"奇瑞汽車","vals":{"2020":2,"2021":2,"2022":3,"2023":3,"2024":3,"2025":3,"2026":3,"m":0.5},"ytdYoy":20,"yoy":14,"mom":22},{"name":"山東唐駿","vals":{"2020":0,"2021":0,"2022":0,"2023":1,"2024":2,"2025":3,"2026":3,"m":0.6},"ytdYoy":78,"yoy":56,"mom":48},{"name":"東風柳州","vals":{"2020":8,"2021":7,"2022":3,"2023":3,"2024":3,"2025":4,"2026":3,"m":0.3},"ytdYoy":15,"yoy":-25,"mom":0},{"name":"鄭州宇通","vals":{"2020":3,"2021":4,"2022":3,"2023":3,"2024":5,"2025":4,"2026":3,"m":0.3},"ytdYoy":-7,"yoy":-22,"mom":14},{"name":"山西新能源","vals":{"2020":0,"2021":1,"2022":1,"2023":0,"2024":2,"2025":3,"2026":3,"m":0.2},"ytdYoy":31,"yoy":-48,"mom":-18},{"name":"浙江飛碟","vals":{"2020":5,"2021":4,"2022":2,"2023":2,"2024":2,"2025":3,"2026":2,"m":0.2},"ytdYoy":-1,"yoy":-10,"mom":21}],"htruckRegion":{"years":["2023","2024","2025","2026"],"period":"2026年9月","basis":"各年9月","totalVol":5.57,"total":{"vol":{"2023":6.3,"2024":4.7,"2025":8.7,"2026":5.6},"nev":{"2023":5,"2024":17,"2025":28,"2026":41}},"regions":[{"name":"東部華北","share":{"2023":22,"2024":15,"2025":20,"2026":19},"vol":1.04,"nev":{"2023":9,"2024":19,"2025":17,"2026":42}},{"name":"西南","share":{"2023":8,"2024":12,"2025":12,"2026":13},"vol":0.73,"nev":{"2023":9,"2024":19,"2025":38,"2026":53}},{"name":"西北","share":{"2023":13,"2024":15,"2025":12,"2026":12},"vol":0.69,"nev":{"2023":5,"2024":15,"2025":21,"2026":34}},{"name":"中部長江","share":{"2023":11,"2024":13,"2025":12,"2026":12},"vol":0.65,"nev":{"2023":3,"2024":21,"2025":23,"2026":28}},{"name":"東部華東","share":{"2023":9,"2024":11,"2025":8,"2026":12},"vol":0.64,"nev":{"2023":4,"2024":11,"2025":16,"2026":44}},{"name":"東部華南","share":{"2023":6,"2024":9,"2025":11,"2026":10},"vol":0.54,"nev":{"2023":3,"2024":19,"2025":40,"2026":35}},{"name":"中部黄河","share":{"2023":20,"2024":11,"2025":10,"2026":9},"vol":0.51,"nev":{"2023":3,"2024":28,"2025":36,"2026":51}},{"name":"東部直轄市","share":{"2023":3.9,"2024":7.2,"2025":8.9,"2026":7.6},"vol":0.42,"nev":{"2023":8,"2024":15,"2025":55,"2026":58}},{"name":"東北","share":{"2023":6.1,"2024":5.8,"2025":6.0,"2026":6.3},"vol":0.35,"nev":{"2023":2,"2024":3,"2025":5,"2026":13}}]},"htruckCompany":{"years":["2023","2024","2025","2026"],"period":"2026年9月","basis":"各年9月","totalVol":5.57,"total":{"vol":{"2023":6.3,"2024":4.7,"2025":8.7,"2026":5.6},"nev":{"2023":5,"2024":17,"2025":28,"2026":41}},"companies":[{"name":"一汽解放","share":{"2023":25,"2024":21,"2025":21,"2026":21},"vol":1.153,"nev":{"2023":1,"2024":11,"2025":22,"2026":31}},{"name":"中国重汽","share":{"2023":17,"2024":16,"2025":17,"2026":18},"vol":1.007,"nev":{"2023":2,"2024":9,"2025":17,"2026":32}},{"name":"東風汽車","share":{"2023":18,"2024":17,"2025":15,"2026":13},"vol":0.74,"nev":{"2023":2,"2024":7,"2025":10,"2026":15}},{"name":"北汽福田","share":{"2023":13,"2024":12,"2025":14,"2026":13},"vol":0.7,"nev":{"2023":2,"2024":8,"2025":17,"2026":24}},{"name":"陝汽集団","share":{"2023":10,"2024":9,"2025":11,"2026":9},"vol":0.513,"nev":{"2023":4,"2024":14,"2025":30,"2026":44}},{"name":"徐工集団","share":{"2023":2,"2024":3,"2025":4,"2026":9},"vol":0.494,"nev":{"2023":55,"2024":80,"2025":92,"2026":95}},{"name":"東風柳州","share":{"2023":4,"2024":5,"2025":5,"2026":4},"vol":0.236,"nev":{"2023":3,"2024":14,"2025":13,"2026":38}},{"name":"湖南汽車","share":{"2023":0,"2024":2,"2025":3,"2026":3},"vol":0.153,"nev":{"2023":47,"2024":97,"2025":100,"2026":100}},{"name":"三一重工","share":{"2023":2,"2024":2,"2025":1,"2026":2},"vol":0.099,"nev":{"2023":42,"2024":64,"2025":69,"2026":69}},{"name":"江淮汽車","share":{"2023":2,"2024":3,"2025":1,"2026":1},"vol":0.052,"nev":{"2023":1,"2024":14,"2025":33,"2026":45}},{"name":"鄭州宇通","share":{"2023":1,"2024":1,"2025":1,"2026":1},"vol":0.044,"nev":{"2023":91,"2024":95,"2025":89,"2026":94}},{"name":"集瑞重工","share":{"2023":0,"2024":0,"2025":1,"2026":1},"vol":0.041,"nev":{"2023":22,"2024":35,"2025":91,"2026":99}},{"name":"安徽華菱","share":{"2023":0,"2024":0,"2025":0,"2026":1},"vol":0.038,"nev":{"2023":59,"2024":47,"2025":98,"2026":100}},{"name":"華菱星馬","share":{"2023":0,"2024":1,"2025":1,"2026":1},"vol":0.037,"nev":{"2023":92,"2024":90,"2025":99,"2026":100}},{"name":"北汽重卡","share":{"2023":0,"2024":1,"2025":1,"2026":1},"vol":0.034,"nev":{"2023":0,"2024":0,"2025":0,"2026":3}},{"name":"成都大運","share":{"2023":2,"2024":1,"2025":0,"2026":0},"vol":0.026,"nev":{"2023":8,"2024":8,"2025":7,"2026":3}}]},"ltruckRegion":{"years":["2023","2024","2025","2026"],"period":"2026年9月","basis":"各年9月","totalVol":7.0,"total":{"vol":{"2023":8.4,"2024":8.4,"2025":9.7,"2026":7.0},"nev":{"2023":12,"2024":21,"2025":26,"2026":33}},"regions":[{"name":"東部華北","share":{"2023":19,"2024":18,"2025":17,"2026":16},"vol":1.1,"nev":{"2023":3,"2024":9,"2025":17,"2026":22}},{"name":"西南","share":{"2023":15,"2024":15,"2025":15,"2026":16},"vol":1.09,"nev":{"2023":19,"2024":21,"2025":23,"2026":33}},{"name":"中部長江","share":{"2023":14,"2024":13,"2025":13,"2026":14},"vol":0.96,"nev":{"2023":9,"2024":18,"2025":21,"2026":28}},{"name":"東部華南","share":{"2023":11,"2024":13,"2025":13,"2026":14},"vol":0.95,"nev":{"2023":32,"2024":50,"2025":48,"2026":58}},{"name":"西北","share":{"2023":13,"2024":13,"2025":13,"2026":13},"vol":0.91,"nev":{"2023":6,"2024":7,"2025":8,"2026":13}},{"name":"東部華東","share":{"2023":9,"2024":10,"2025":9,"2026":10},"vol":0.73,"nev":{"2023":8,"2024":28,"2025":42,"2026":51}},{"name":"中部黄河","share":{"2023":10,"2024":8,"2025":8,"2026":7},"vol":0.46,"nev":{"2023":8,"2024":22,"2025":31,"2026":26}},{"name":"東北","share":{"2023":6.0,"2024":6.6,"2025":5.7,"2026":6.0},"vol":0.42,"nev":{"2023":2,"2024":11,"2025":7,"2026":7}},{"name":"東部直轄市","share":{"2023":3.9,"2024":3.1,"2025":4.7,"2026":5.6},"vol":0.39,"nev":{"2023":41,"2024":33,"2025":58,"2026":60}}]},"ltruckCompany":{"years":["2023","2024","2025","2026"],"period":"2026年9月","basis":"各年9月","totalVol":7.0,"total":{"vol":{"2023":8.4,"2024":8.4,"2025":9.7,"2026":7.0},"nev":{"2023":12,"2024":21,"2025":26,"2026":33}},"companies":[{"name":"北汽福田","share":{"2023":26,"2024":25,"2025":28,"2026":24},"vol":1.682,"nev":{"2023":5,"2024":9,"2025":18,"2026":22}},{"name":"上汽通用五菱","share":{"2023":14,"2024":12,"2025":11,"2026":10},"vol":0.728,"nev":{"2023":4,"2024":2,"2025":4,"2026":1}},{"name":"中国重汽","share":{"2023":8,"2024":8,"2025":9,"2026":9},"vol":0.639,"nev":{"2023":4,"2024":3,"2025":15,"2026":31}},{"name":"江淮汽車","share":{"2023":9,"2024":9,"2025":9,"2026":9},"vol":0.63,"nev":{"2023":4,"2024":12,"2025":17,"2026":27}},{"name":"東風汽車","share":{"2023":8,"2024":7,"2025":6,"2026":7},"vol":0.516,"nev":{"2023":29,"2024":17,"2025":21,"2026":17}},{"name":"一汽解放","share":{"2023":5,"2024":5,"2025":4,"2026":5},"vol":0.359,"nev":{"2023":7,"2024":19,"2025":14,"2026":35}},{"name":"吉利汽車","share":{"2023":1,"2024":4,"2025":3,"2026":5},"vol":0.341,"nev":{"2023":99,"2024":100,"2025":100,"2026":100}},{"name":"江鈴汽車","share":{"2023":5,"2024":5,"2025":5,"2026":4},"vol":0.274,"nev":{"2023":2,"2024":14,"2025":9,"2026":14}},{"name":"奇瑞汽車","share":{"2023":1,"2024":2,"2025":3,"2026":3},"vol":0.236,"nev":{"2023":78,"2024":96,"2025":100,"2026":100}},{"name":"上汽大通","share":{"2023":2,"2024":2,"2025":2,"2026":3},"vol":0.223,"nev":{"2023":25,"2024":27,"2025":24,"2026":44}},{"name":"浙江飛碟","share":{"2023":1,"2024":1,"2025":2,"2026":3},"vol":0.176,"nev":{"2023":23,"2024":37,"2025":32,"2026":46}},{"name":"比亜迪","share":{"2023":0,"2024":0,"2025":1,"2026":2},"vol":0.134,"nev":{"2023":100,"2024":100,"2025":100,"2026":100}},{"name":"濰柴英致","share":{"2023":0,"2024":1,"2025":1,"2026":1},"vol":0.102,"nev":{"2023":16,"2024":50,"2025":75,"2026":91}},{"name":"慶鈴汽車","share":{"2023":2,"2024":2,"2025":1,"2026":1},"vol":0.096,"nev":{"2023":2,"2024":24,"2025":10,"2026":12}},{"name":"長安跨越","share":{"2023":0,"2024":2,"2025":2,"2026":1},"vol":0.094,"nev":{"2023":0,"2024":23,"2025":24,"2026":26}},{"name":"陝汽集団","share":{"2023":1,"2024":2,"2025":2,"2026":1},"vol":0.093,"nev":{"2023":10,"2024":51,"2025":47,"2026":46}}]},"lbusRegion":{"years":["2023","2024","2025","2026"],"period":"2026年9月","basis":"各年9月","totalVol":2.79,"total":{"vol":{"2023":3.2,"2024":3.9,"2025":5.0,"2026":2.8},"nev":{"2023":47,"2024":60,"2025":70,"2026":70}},"regions":[{"name":"東部華東","share":{"2023":24,"2024":21,"2025":20,"2026":19},"vol":0.53,"nev":{"2023":45,"2024":61,"2025":68,"2026":71}},{"name":"東部華南","share":{"2023":16,"2024":18,"2025":16,"2026":16},"vol":0.44,"nev":{"2023":81,"2024":87,"2025":91,"2026":91}},{"name":"中部長江","share":{"2023":12,"2024":13,"2025":13,"2026":14},"vol":0.4,"nev":{"2023":41,"2024":58,"2025":69,"2026":67}},{"name":"東部華北","share":{"2023":10,"2024":12,"2025":12,"2026":13},"vol":0.37,"nev":{"2023":35,"2024":57,"2025":66,"2026":71}},{"name":"西南","share":{"2023":12,"2024":12,"2025":14,"2026":11},"vol":0.3,"nev":{"2023":40,"2024":53,"2025":66,"2026":57}},{"name":"中部黄河","share":{"2023":8,"2024":8,"2025":9,"2026":8},"vol":0.23,"nev":{"2023":39,"2024":55,"2025":70,"2026":69}},{"name":"東部直轄市","share":{"2023":6,"2024":5,"2025":7,"2026":7},"vol":0.19,"nev":{"2023":45,"2024":52,"2025":74,"2026":70}},{"name":"西北","share":{"2023":6.9,"2024":6.4,"2025":5.4,"2026":6.3},"vol":0.18,"nev":{"2023":38,"2024":40,"2025":50,"2026":54}},{"name":"東北","share":{"2023":3.8,"2024":4.9,"2025":4.9,"2026":5.9},"vol":0.16,"nev":{"2023":21,"2024":39,"2025":45,"2026":49}}]},"lbusCompany":{"years":["2023","2024","2025","2026"],"period":"2026年9月","basis":"各年9月","totalVol":2.785,"total":{"vol":{"2023":3.2,"2024":3.9,"2025":5.0,"2026":2.8},"nev":{"2023":47,"2024":60,"2025":70,"2026":70}},"companies":[{"name":"江鈴汽車","share":{"2023":21,"2024":17,"2025":17,"2026":31},"vol":0.851,"nev":{"2023":4,"2024":8,"2025":23,"2026":53}},{"name":"上汽大通","share":{"2023":15,"2024":11,"2025":12,"2026":17},"vol":0.469,"nev":{"2023":17,"2024":28,"2025":42,"2026":59}},{"name":"吉利汽車","share":{"2023":13,"2024":5,"2025":7,"2026":16},"vol":0.443,"nev":{"2023":100,"2024":100,"2025":100,"2026":100}},{"name":"北汽福田","share":{"2023":12,"2024":7,"2025":7,"2026":10},"vol":0.275,"nev":{"2023":43,"2024":33,"2025":60,"2026":81}},{"name":"長安汽車","share":{"2023":8,"2024":7,"2025":9,"2026":4},"vol":0.12,"nev":{"2023":80,"2024":84,"2025":95,"2026":91}},{"name":"山西新能源","share":{"2023":0,"2024":4,"2025":9,"2026":3},"vol":0.082,"nev":{"2023":100,"2024":100,"2025":100,"2026":100}},{"name":"上汽依維柯","share":{"2023":4,"2024":4,"2025":3,"2026":2},"vol":0.065,"nev":{"2023":0,"2024":4,"2025":10,"2026":3}},{"name":"東風汽車","share":{"2023":6,"2024":3,"2025":3,"2026":2},"vol":0.061,"nev":{"2023":71,"2024":46,"2025":81,"2026":75}},{"name":"奇瑞汽車","share":{"2023":8,"2024":2,"2025":2,"2026":2},"vol":0.054,"nev":{"2023":100,"2024":100,"2025":100,"2026":100}},{"name":"東風小康","share":{"2023":0,"2024":0,"2025":2,"2026":2},"vol":0.05,"nev":{"2023":null,"2024":null,"2025":100,"2026":100}},{"name":"濰柴英致","share":{"2023":0,"2024":0,"2025":1,"2026":2},"vol":0.05,"nev":{"2023":null,"2024":0,"2025":0,"2026":0}},{"name":"鄭州宇通","share":{"2023":1,"2024":1,"2025":1,"2026":1},"vol":0.033,"nev":{"2023":12,"2024":32,"2025":26,"2026":30}},{"name":"河南森源","share":{"2023":0,"2024":0,"2025":2,"2026":1},"vol":0.028,"nev":{"2023":null,"2024":null,"2025":100,"2026":100}}]},"mbusRegion":{"years":["2023","2024","2025","2026"],"period":"2026年9月","basis":"各年9月","totalVol":0.35,"total":{"vol":{"2023":0.5,"2024":0.5,"2025":0.5,"2026":0.4},"nev":{"2023":48,"2024":54,"2025":64,"2026":56}},"regions":[{"name":"東部華南","share":{"2023":10,"2024":11,"2025":16,"2026":22},"vol":0.08,"nev":{"2023":25,"2024":56,"2025":69,"2026":69}},{"name":"西南","share":{"2023":11,"2024":10,"2025":25,"2026":15},"vol":0.05,"nev":{"2023":34,"2024":36,"2025":69,"2026":53}},{"name":"西北","share":{"2023":13,"2024":9,"2025":7,"2026":14},"vol":0.05,"nev":{"2023":51,"2024":39,"2025":38,"2026":39}},{"name":"東部華東","share":{"2023":24,"2024":28,"2025":12,"2026":12},"vol":0.04,"nev":{"2023":70,"2024":81,"2025":69,"2026":67}},{"name":"東部直轄市","share":{"2023":13,"2024":13,"2025":13,"2026":10},"vol":0.04,"nev":{"2023":62,"2024":52,"2025":73,"2026":58}},{"name":"中部長江","share":{"2023":11,"2024":14,"2025":12,"2026":8},"vol":0.03,"nev":{"2023":41,"2024":59,"2025":58,"2026":61}},{"name":"東北","share":{"2023":4,"2024":4,"2025":8,"2026":8},"vol":0.03,"nev":{"2023":42,"2024":33,"2025":71,"2026":31}},{"name":"中部黄河","share":{"2023":4.4,"2024":4.9,"2025":2.6,"2026":6.5},"vol":0.02,"nev":{"2023":28,"2024":26,"2025":34,"2026":63}},{"name":"東部華北","share":{"2023":10.0,"2024":6.2,"2025":4.8,"2026":5.5},"vol":0.02,"nev":{"2023":33,"2024":15,"2025":35,"2026":46}}]},"mbusCompany":{"years":["2023","2024","2025","2026"],"period":"2026年9月","basis":"各年9月","totalVol":0.353,"total":{"vol":{"2023":0.5,"2024":0.5,"2025":0.5,"2026":0.4},"nev":{"2023":48,"2024":54,"2025":64,"2026":56}},"companies":[{"name":"鄭州宇通","share":{"2023":35,"2024":37,"2025":40,"2026":44},"vol":0.155,"nev":{"2023":28,"2024":41,"2025":55,"2026":48}},{"name":"廈門金龍","share":{"2023":10,"2024":8,"2025":7,"2026":12},"vol":0.043,"nev":{"2023":57,"2024":57,"2025":74,"2026":77}},{"name":"蘇州金龍","share":{"2023":9,"2024":5,"2025":7,"2026":8},"vol":0.029,"nev":{"2023":45,"2024":42,"2025":65,"2026":53}},{"name":"中通客車","share":{"2023":5,"2024":5,"2025":10,"2026":6},"vol":0.023,"nev":{"2023":69,"2024":30,"2025":62,"2026":52}},{"name":"吉利汽車","share":{"2023":7,"2024":14,"2025":5,"2026":5},"vol":0.018,"nev":{"2023":100,"2024":100,"2025":100,"2026":100}},{"name":"北汽福田","share":{"2023":5,"2024":4,"2025":5,"2026":4},"vol":0.016,"nev":{"2023":52,"2024":61,"2025":84,"2026":56}},{"name":"安徽安凱","share":{"2023":3,"2024":2,"2025":4,"2026":4},"vol":0.015,"nev":{"2023":64,"2024":55,"2025":57,"2026":44}},{"name":"廈門金旅","share":{"2023":6,"2024":5,"2025":7,"2026":4},"vol":0.013,"nev":{"2023":49,"2024":28,"2025":77,"2026":76}},{"name":"一汽豊田","share":{"2023":5,"2024":4,"2025":2,"2026":3},"vol":0.009,"nev":{"2023":0,"2024":0,"2025":0,"2026":0}},{"name":"一汽解放","share":{"2023":1,"2024":1,"2025":2,"2026":2},"vol":0.007,"nev":{"2023":47,"2024":0,"2025":0,"2026":0}},{"name":"揚州亜星","share":{"2023":1,"2024":1,"2025":1,"2026":1},"vol":0.005,"nev":{"2023":78,"2024":47,"2025":81,"2026":89}},{"name":"湖北新楚風","share":{"2023":0,"2024":0,"2025":0,"2026":1},"vol":0.004,"nev":{"2023":null,"2024":null,"2025":null,"2026":100}},{"name":"江淮汽車","share":{"2023":0,"2024":1,"2025":0,"2026":1},"vol":0.003,"nev":{"2023":0,"2024":0,"2025":0,"2026":0}},{"name":"東風汽車","share":{"2023":1,"2024":2,"2025":3,"2026":1},"vol":0.002,"nev":{"2023":9,"2024":23,"2025":61,"2026":10}},{"name":"比亜迪","share":{"2023":1,"2024":3,"2025":0,"2026":1},"vol":0.002,"nev":{"2023":100,"2024":100,"2025":100,"2026":100}}]}};
  window.CV = CV_HARDCODED;
  window.CV_LOADED = true;
let CDS_LOADED = false;
let CDS = {};          // 全データ格納
const CDS_EC = {};

function cdsEc(id) {
  if (!CDS_EC[id]) {
    const el = document.getElementById(id);
    if (!el) return null;
    CDS_EC[id] = echarts.init(el, null, { renderer: 'canvas' });
  }
  return CDS_EC[id];
}

function n(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[+＋%％]/g,'').replace('▲','-').replace('#####','').trim();
  const r = parseFloat(s);
  return isNaN(r) ? null : r;
}

async function loadCdsExcel() {
  const loadEl = document.getElementById('cds-loading');
  const pillEl = document.getElementById('cdsPills');
  const contEl = document.getElementById('cdsPillsContent');
  try {
    // ハードコートデータを CDS にロード
    CDS = JSON.parse(JSON.stringify(CDS_HARDCODED));
    CDS_LOADED = true;
    if (loadEl) loadEl.style.display = 'none';
    if (pillEl) { pillEl.setAttribute('style', 'display:block'); }
    if (contEl) contEl.style.removeProperty('display');
    var _srcLink = document.getElementById('cds-source-link');
    if (_srcLink) { _srcLink.href = 'https://www.sohu.com/a/1091661532_115312'; _srcLink.textContent = 'https://www.sohu.com/a/1091661532_115312'; }
    cdsShowPane('cds-monthly');
    console.log('✅ CDS hardcoded data loaded (2026年9月版)');
  } catch(err) {
    console.error('CDS hardcoded data error:', err);
    if (loadEl) { loadEl.innerHTML = `<div class="text-danger p-3 text-center">⚠️ データ読み込み失敗: ${err.message}</div>`; loadEl.style.display='flex'; }
  }
}

// ---- 共通グラフ関数 ----
const YRCOLORS = ['#cbd5e1','#94a3b8','#64748b','#3b82f6','#f59e0b','#10b981','#ef4444'];

function drawBar(id, title, subtitle, categories, series, opts={}) {
  const chart = cdsEc(id); if(!chart) return;
  chart.setOption({
    tooltip: opts.stack ? unifiedStackTooltip({unit: opts.yunit||'万台'}) : {trigger:'axis',axisPointer:{type:'shadow'}},
    legend:{data:series.map(s=>s.name),top:8,type:'scroll'},
    grid:{left:opts.left||60,right:opts.right||20,top:opts.stack?50:45,bottom:opts.bottom||20,containLabel:true},
    xAxis:opts.horizontal?{type:'value',name:opts.xname||'万台'}:{type:'category',data:categories,axisLabel:{rotate:opts.rotate||0}},
    yAxis:opts.horizontal?{type:'category',data:categories}:{type:'value',name:opts.yunit||'万台',axisLabel:{formatter:function(v){return v+(opts.yunit||'万台');}}},
    series:series.map(s=>({...s,type:'bar',stack:opts.stack?'total':undefined,label:{show:!!opts.label,position:opts.horizontal?'right':'top',fontSize:10,formatter:p=>p.value&&Math.abs(p.value)>=opts.labelMin?p.value:''}})),
  });
  setTimeout(()=>{ try{chart.resize();}catch(e){} }, 80);
}

function drawLine(id, categories, series, opts={}) {
  const chart = cdsEc(id); if(!chart) return;
  chart.setOption({
    tooltip:{trigger:'axis'},
    legend:{data:series.map(s=>s.name),bottom:0,type:'scroll'},
    grid:{left:60,right:opts.r2?55:20,top:20,bottom:55,containLabel:true},
    xAxis:{type:'category',data:categories,axisLabel:{rotate:opts.rotate||0}},
    yAxis:opts.yAxis||[{type:'value',axisLabel:{formatter:function(v){return v+(opts.yunit||'万');}}}],
    series:series.map(s=>({smooth:true,symbol:'circle',symbolSize:5,...s})),
  });
  setTimeout(()=>{ try{chart.resize();}catch(e){} }, 80);
}

// ---- 各グラフ描画 ----
function cdsDrawMonthly() {
  if (!CDS_LOADED) return;
  const chart=cdsEc('ec-cds-monthly'); if(!chart) return;
  const months=['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const yrs=['2021','2022','2023','2024','2025','2026'];
  chart.setOption({tooltip:{trigger:'axis'},legend:{data:yrs.map(y=>y+'年'),bottom:0},grid:{left:55,right:20,top:20,bottom:50,containLabel:true},
    xAxis:{type:'category',data:months},yAxis:{type:'value',axisLabel:{formatter:function(v){return v+'万';}}},
    series:yrs.map((yr,i)=>({name:yr+'年',type:'line',smooth:true,symbol:'circle',symbolSize:5,lineStyle:{width:yr==='2025'?3:yr==='2024'?2.5:1.5,type:yr==='2026'?'dashed':'solid'},itemStyle:{color:YRCOLORS[i]},data:(CDS.monthly[yr]||[])}))});
  setTimeout(()=>{try{cdsEc('ec-cds-monthly')?.resize();}catch(e){}},80);
}

function cdsDrawAnnual() {
  if (!CDS_LOADED) return;
  const chart=cdsEc('ec-cds-annual'); if(!chart) return;
  const d=CDS.annual;
  chart.setOption({tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},legend:{data:['出口量','前年比'],bottom:0},grid:{left:60,right:55,top:20,bottom:55,containLabel:true},
    xAxis:{type:'category',data:d.map(x=>x.year),axisLabel:{rotate:45}},
    yAxis:[{type:'value',name:'万台'},{type:'value',name:'前年比(%)',position:'right',axisLabel:{formatter:v=>v+'%'}}],
    series:[{name:'出口量',type:'bar',data:d.map(x=>x.vol),itemStyle:{color:p=>p.data>=500?'#10b981':p.data>=300?'#3b82f6':p.data>=150?'#f59e0b':'#94a3b8'},label:{show:false}},
      {name:'前年比',type:'line',yAxisIndex:1,data:d.map(x=>x.yoy),smooth:true,symbol:'circle',symbolSize:5,lineStyle:{color:'#ef4444',width:2},itemStyle:{color:'#ef4444'}}]});
  setTimeout(()=>{try{cdsEc('ec-cds-annual')?.resize();}catch(e){}},80);
}

function cdsDrawAmountLike(domId, dataKey, unitName) {
  if (!CDS_LOADED) return;
  const chart=cdsEc(domId); if(!chart) return;
  const src=CDS[dataKey]||{};
  const months=['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const yrs=['2022','2023','2024','2025','2026'];
  const cols=['#94a3b8','#64748b','#f59e0b','#1f2937','#ef4444'];
  chart.setOption({
    tooltip:{trigger:'axis',valueFormatter:v=>(v==null?'-':v+'億$')},
    legend:{data:yrs.map(y=>y+'年'),bottom:0,type:'scroll'},
    grid:{left:60,right:20,top:20,bottom:50,containLabel:true},
    xAxis:{type:'category',data:months},
    yAxis:{type:'value',name:unitName,axisLabel:{formatter:v=>v+'億'}},
    series:yrs.map((yr,i)=>({
      name:yr+'年',type:'line',smooth:true,symbol:'circle',
      symbolSize:yr==='2026'?7:5,
      lineStyle:{width:yr==='2026'?3.5:yr==='2025'?2.5:1.5},
      itemStyle:{color:cols[i]},
      label:{show:yr==='2026',position:'top',fontSize:10,color:'#ef4444',
             formatter:p=>p.value!=null?p.value:''},
      connectNulls:false,
      data:(src[yr]||[])
    }))
  });
  setTimeout(()=>{try{cdsEc(domId)?.resize();}catch(e){}},80);
}

function cdsDrawAmount() { cdsDrawAmountLike('ec-cds-amount','amount','億ドル'); }
function cdsDrawParts()  { cdsDrawAmountLike('ec-cds-parts','parts','億ドル'); }

function cdsDrawNev() {
  if (!CDS_LOADED) return;
  const chart=cdsEc('ec-cds-nev'); if(!chart) return;
  const lbls=CDS.summaryLabels||[], tot=CDS.summaryTotal||[], nev=CDS.summaryNev||[];
  const labels=[],tv=[],nv=[],iv=[];
  for(let i=0;i<lbls.length;i++){
    const h=lbls[i]; if(!h||h.includes('累計')||h.includes('全年')||h.includes('1-')) continue;
    const t=n(tot[i]),ne=n(nev[i]); if(t===null) continue;
    labels.push(h.replace('年','年\n')); tv.push(t); nv.push(ne); iv.push(t!==null&&ne!==null?Math.round((t-ne)*10)/10:null);
  }
  chart.setOption({tooltip: unifiedStackTooltip({unit:'万'}),legend:{data:['燃油車等','NEV'],bottom:0},grid:{left:60,right:20,top:20,bottom:65,containLabel:true},
    xAxis:{type:'category',data:labels,axisLabel:{fontSize:10}},yAxis:{type:'value',axisLabel:{formatter:function(v){return v+'万';}}},
    series:[{name:'燃油車等',type:'bar',stack:'t',data:iv,itemStyle:{color:'#94a3b8'}},{name:'NEV',type:'bar',stack:'t',data:nv,itemStyle:{color:'#10b981'},label:{show:false}}]});
  setTimeout(()=>{try{cdsEc('ec-cds-nev')?.resize();}catch(e){}},80);
}

function cdsDrawNevAnnual() {
  if (!CDS_LOADED) return;
  const d=CDS.nevAnnual||[];
  drawBar('ec-cds-nev-annual','','',d.map(x=>x.year),
    [{name:'1Q',data:d.map(x=>x.q1),itemStyle:{color:'#93c5fd'}},{name:'2Q',data:d.map(x=>x.q2),itemStyle:{color:'#3b82f6'}},{name:'3Q',data:d.map(x=>x.q3),itemStyle:{color:'#1d4ed8'}},{name:'4Q',data:d.map(x=>x.q4),itemStyle:{color:'#1e3a8a'}}],
    {stack:true,label:false,labelMin:5});
}

function cdsDrawNevTrend() {
  if (!CDS_LOADED) return;
  const d=CDS.nevTrend||[];
  const chart=cdsEc('ec-cds-nev-trend'); if(!chart) return;
  chart.setOption({tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},legend:{data:['出口量','前年比'],bottom:0},grid:{left:60,right:55,top:20,bottom:40,containLabel:true},
    xAxis:{type:'category',data:d.map(x=>x.year)},
    yAxis:[{type:'value',name:'万台'},{type:'value',name:'前年比(%)',position:'right',axisLabel:{formatter:v=>v+'%'}}],
    series:[{name:'出口量',type:'bar',data:d.map(x=>x.vol),itemStyle:{color:'#10b981'},label:{show:false}},
      {name:'前年比',type:'line',yAxisIndex:1,data:d.map(x=>x.yoy),smooth:true,symbol:'circle',symbolSize:6,lineStyle:{color:'#f59e0b',width:2.5},itemStyle:{color:'#f59e0b'}}]});
  setTimeout(()=>{try{cdsEc('ec-cds-nev-trend')?.resize();}catch(e){}},80);
}

function cdsDrawPowertype() {
  if (!CDS_LOADED) return;
  const chart=cdsEc('ec-cds-powertype'); if(!chart) return;
  const yrs=['2022','2023','2024','2025','2026'], yrLabels=['2022年','2023年','2024年','2025年','2026年1-9月累計'], d=CDS.powerCars||{};
  const ptMap=[['ガソリン','ガソリン'],['BEV','BEV'],['PHEV','PHEV'],['HEV','HEV'],['ディーゼル','ディーゼル']], cols=['#94a3b8','#3b82f6','#10b981','#f59e0b','#8b5cf6'];
  chart.setOption({
    tooltip: unifiedStackTooltip({unit:'万台'}),
    legend: {data:ptMap.map(p=>p[1]), bottom:0, type:'scroll'},
    grid: {top:50, right:20, bottom:60, left:60, containLabel:true},
    xAxis: {type:'category', data:yrLabels},
    yAxis: {type:'value', name:'万台'},
    series: ptMap.map(([k,nm],i)=>({
      name:nm, type:'bar', stack:'total',
      itemStyle:{color:cols[i]},
      data:yrs.map(yr=>d[k]?d[k][yr]:null)
    }))
  });
  setTimeout(()=>{try{chart.resize();}catch(e){}},80);
}

function cdsDrawBodytype() {
  if (!CDS_LOADED) return;
  const chart=cdsEc('ec-cds-bodytype'); if(!chart) return;
  const yrs=['2022','2023','2024','2025','2026'], yrLabels=['2022年','2023年','2024年','2025年','2026年1-9月累計'], bts=[['乗用車 計','乗用車'],['貨物車 計','貨物車'],['バス 計','バス']], cols=['#3b82f6','#f59e0b','#10b981'], d=CDS.bodyTypes||{};
  chart.setOption({
    tooltip: unifiedStackTooltip({unit:'万台'}),
    legend: {data:bts.map(b=>b[1]), bottom:0, type:'scroll'},
    grid: {top:50, right:20, bottom:60, left:60, containLabel:true},
    xAxis: {type:'category', data:yrLabels},
    yAxis: {type:'value', name:'万台'},
    series: bts.map(([k,nm],i)=>({
      name:nm, type:'bar', stack:'total',
      itemStyle:{color:cols[i]},
      data:yrs.map(yr=>d[k]?d[k][yr]:null)
    }))
  });
  setTimeout(()=>{try{chart.resize();}catch(e){}},80);
}

function cdsDrawNevPower() {
  if (!CDS_LOADED) return;
  const chart=cdsEc('ec-cds-nev-power'); if(!chart) return;
  const yrs=['2022','2023','2024','2025','2026'], yrLabels=['2022年','2023年','2024年','2025年','2026年1-9月累計'], d=CDS.nevPower||{};
  const nameMap={'ガソリン':'ガソリン','BEV':'BEV','PHEV':'PHEV','ディーゼル':'ディーゼル','HEV':'HEV','不明':'その他'};
  const cols=['#94a3b8','#3b82f6','#10b981','#8b5cf6','#f59e0b','#ef4444'];
  const pts=Object.keys(d);
  chart.setOption({
    tooltip: unifiedStackTooltip({unit:'万台'}),
    legend: {data:pts.map(pt=>nameMap[pt]||pt), bottom:0, type:'scroll'},
    grid: {top:50, right:20, bottom:60, left:60, containLabel:true},
    xAxis: {type:'category', data:yrLabels},
    yAxis: {type:'value', name:'万台'},
    series: pts.map((pt,i)=>({
      name:nameMap[pt]||pt, type:'bar', stack:'total',
      itemStyle:{color:cols[i%cols.length]},
      data:yrs.map(yr=>d[pt]?d[pt][yr]:null)
    }))
  });
  setTimeout(()=>{try{chart.resize();}catch(e){}},80);
}

function cdsDrawNevBody() {
  if (!CDS_LOADED) return;
  const chart=cdsEc('ec-cds-nev-body'); if(!chart) return;
  const yrs=['2022','2023','2024','2025','2026'], yrLabels=['2022年','2023年','2024年','2025年','2026年1-9月累計'], d=CDS.nevBody||{};
  const bts=[['乗用車 計','乗用車'],['貨物車 計','貨物車'],['バス 計','バス']], cols=['#3b82f6','#f59e0b','#10b981'];
  chart.setOption({
    tooltip: unifiedStackTooltip({unit:'万台'}),
    legend: {data:bts.map(b=>b[1]), bottom:0, type:'scroll'},
    grid: {top:50, right:20, bottom:60, left:60, containLabel:true},
    xAxis: {type:'category', data:yrLabels},
    yAxis: {type:'value', name:'万台'},
    series: bts.map(([k,nm],i)=>({
      name:nm, type:'bar', stack:'total',
      itemStyle:{color:cols[i]},
      data:yrs.map(yr=>d[k]?d[k][yr]:null)
    }))
  });
  setTimeout(()=>{try{chart.resize();}catch(e){}},80);
}

function cdsDrawRegion() {
  if (!CDS_LOADED) return;
  const chart=cdsEc('ec-cds-region'); if(!chart) return;
  const yrs=['2019','2020','2021','2022','2023','2024','2025','2026年1-4月累計'], rs=(CDS.regions||[]).filter(r=>r.name!=='総計');
  chart.setOption({
    tooltip: unifiedStackTooltip({unit:'万台'}),
    legend: {data:rs.map(r=>r.name), bottom:0, type:'scroll'},
    grid: {top:50, right:20, bottom:70, left:60, containLabel:true},
    xAxis: {type:'category', data:yrs, axisLabel:{rotate:30, fontSize:10}},
    yAxis: {type:'value', name:'万台'},
    series: rs.map((r,ri)=>({
      name:r.name, type:'bar', stack:'total',
      data:[...r.v, r.v2026??null]
    }))
  });
  setTimeout(()=>{try{chart.resize();}catch(e){}},80);
}

function cdsDrawCountry() {
  if (!CDS_LOADED) return;
  const d=(CDS.countries||[]).filter(c=>c.v2025!=null).sort((a,b)=>(b.v2025||0)-(a.v2025||0)).slice(0,15);
  drawBar('ec-cds-country','','',d.map(c=>c.name).reverse(),
    [{name:'2024年',data:d.map(c=>c.v2024).reverse(),itemStyle:{color:'#94a3b8'}},{name:'2025年',data:d.map(c=>c.v2025).reverse(),itemStyle:{color:'#3b82f6'}},{name:'2026年1-9月累計',data:d.map(c=>c.v2026??null).reverse(),itemStyle:{color:'#1d4ed8'}}],
    {horizontal:true,label:true,labelMin:0.5,left:90,bottom:40});
}

function cdsDrawNevCtry() {
  if (!CDS_LOADED) return;
  const d=(CDS.nevCtry||[]).filter(c=>c.v2025!=null).sort((a,b)=>(b.v2025||0)-(a.v2025||0)).slice(0,15);
  drawBar('ec-cds-nev-ctry','','',d.map(c=>c.name).reverse(),
    [{name:'2024年',data:d.map(c=>c.v2024).reverse(),itemStyle:{color:'#94a3b8'}},{name:'2025年',data:d.map(c=>c.v2025).reverse(),itemStyle:{color:'#10b981'}},{name:'2026年1-9月累計',data:d.map(c=>c.v2026??null).reverse(),itemStyle:{color:'#047857'}}],
    {horizontal:true,label:true,labelMin:0.5,left:160,bottom:40});
}

function cdsDrawProv() {
  if (!CDS_LOADED) return;
  const yrs=['2019','2020','2021','2022','2023','2024','2025','2026年1-9月'];
  const ps=(CDS.provs||[]).sort((a,b)=>(b.v[6]||0)-(a.v[6]||0)).slice(0,15);
  const COLS8=[...YRCOLORS,'#1d4ed8'];
  const totalH = calcHBarHeight(ps.length, yrs.length, {extra:120});
  const el = document.getElementById('ec-cds-prov');
  if(!el) return;
  el.style.height = totalH+'px';
  // dispose→init でラップ済みインスタンスを確実に取得
  if (CDS_EC['ec-cds-prov']) { try { CDS_EC['ec-cds-prov'].dispose(); } catch(e){} }
  CDS_EC['ec-cds-prov'] = echarts.init(el, null, { renderer: 'canvas' });
  const chart = CDS_EC['ec-cds-prov'];
  chart.setOption({
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
    legend:{data:yrs,top:8,type:'scroll'},
    grid:{left:65,right:60,top:50,bottom:30,containLabel:true},
    xAxis:{type:'value',name:'万台',axisLabel:{formatter:function(v){return v+'万';}}},
    yAxis:{type:'category',data:ps.map(p=>p.name).reverse()},
    barMaxWidth: getBarMaxWidth(16),
    series:yrs.map((yr,i)=>({name:yr,type:'bar',
      data:ps.map(p=>p.v[i]??null).reverse(),itemStyle:{color:COLS8[i]},
      label:{show:i===6,position:'right',fontSize:10,formatter:p=>p.value&&p.value>=5?p.value:''}}))
  });
  setTimeout(()=>{try{CDS_EC['ec-cds-prov']?.resize();}catch(e){}},80);
}

function cdsDrawNevProv() {
  if (!CDS_LOADED) return;
  const yrs=['2019年','2020年','2021年','2022年','2023年','2024年','2025年','2026年1-9月累計'];
  const COLS8=[...YRCOLORS,'#047857'];
  const ps=(CDS.nevProvs||[]).sort((a,b)=>(b.v[6]||0)-(a.v[6]||0)).slice(0,12);
  const totalH = calcHBarHeight(ps.length, yrs.length, {extra:120});
  const el = document.getElementById('ec-cds-nev-prov');
  if(!el) return;
  el.style.height = totalH+'px';
  // dispose→init でラップ済みインスタンスを確実に取得
  if (CDS_EC['ec-cds-nev-prov']) { try { CDS_EC['ec-cds-nev-prov'].dispose(); } catch(e){} }
  CDS_EC['ec-cds-nev-prov'] = echarts.init(el, null, { renderer: 'canvas' });
  const chart = CDS_EC['ec-cds-nev-prov'];
  chart.setOption({
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
    legend:{data:yrs,top:8,type:'scroll'},
    grid:{left:65,right:60,top:50,bottom:30,containLabel:true},
    xAxis:{type:'value',name:'万台',axisLabel:{formatter:function(v){return v+'万';}}},
    yAxis:{type:'category',data:ps.map(p=>p.name).reverse()},
    barMaxWidth: getBarMaxWidth(16),
    series:yrs.map((yr,i)=>({name:yr,type:'bar',
      data:ps.map(p=>p.v[i]??null).reverse(),itemStyle:{color:COLS8[i]},
      label:{show:i===7,position:'right',fontSize:10,formatter:p=>p.value&&p.value>=3?p.value:''}}))
  });
  setTimeout(()=>{try{CDS_EC['ec-cds-nev-prov']?.resize();}catch(e){}},80);
}

function cdsDrawRank() {
  if (!CDS_LOADED) return;
  const chart = cdsEc('ec-cds-rank');
  if (!chart) return;

  // ── ハードコードデータ（⑬歴年主力市場ランキング 画像より） ──
  const RANK_HARDCODE = {
    years: ['20年','21年','22年','23年','24年','25年','26.1-2月'],
    data: [
      {rank:1,  vals:['サウジアラビア','チリ',          'メキシコ',      'ロシア',        'ロシア',        'メキシコ',      'ロシア']},
      {rank:2,  vals:['バングラデシュ', 'サウジアラビア','サウジアラビア', 'メキシコ',      'メキシコ',      'ロシア',        'UAE']},
      {rank:3,  vals:['エジプト',      'ロシア',        'チリ',          'ベルギー',      'UAE',           'UAE',           'ブラジル']},
      {rank:4,  vals:['チリ',          'ベルギー',      'ベルギー',      'オーストラリア','ベルギー',      '英国',          '英国']},
      {rank:5,  vals:['インド',        'オーストラリア','オーストラリア','サウジアラビア','ブラジル',      'ブラジル',      'イタリア']},
      {rank:6,  vals:['ロシア',        'メキシコ',      '英国',          '英国',          'サウジアラビア','サウジアラビア','ベルギー']},
      {rank:7,  vals:['オーストラリア','エジプト',      'フィリピン',    'フィリピン',    '英国',          'ベルギー',      'サウジアラビア']},
      {rank:8,  vals:['米国',          'バングラデシュ', 'ロシア',        'タイ',          'オーストラリア','オーストラリア','メキシコ']},
      {rank:9,  vals:['マレーシア',    '英国',          'マレーシア',    'UAE',           'フィリピン',    'フィリピン',    'オーストラリア']},
      {rank:10, vals:['メキシコ',      'フィリピン',    'UAE',           'スペイン',      'トルコ',        'カザフスタン',  'スペイン']},
      {rank:11, vals:['ベトナム',      'ペルー',        'タイ',          'トルコ',        'タイ',          'マレーシア',    'アルジェリア']},
      {rank:12, vals:['フィリピン',    'インド',        '米国',          'ウズベキスタン','マレーシア',    'アルジェリア',  'マレーシア']},
      {rank:13, vals:['ペルー',        '米国',          'ペルー',        'ブラジル',      'ベラルーシ',    'タイ',          'エジプト']},
      {rank:14, vals:['英国',          'タイ',          'エクアドル',    'カザフスタン',  'チリ',          'イタリア',      'ドイツ']},
      {rank:15, vals:['ブラジル',      'ベトナム',      'ベトナム',      'チリ',          'スペイン',      'インドネシア',  'タイ']},
    ]
  };

  const yrs = (CDS.rankYears && CDS.rankYears.length > 0) ? CDS.rankYears : RANK_HARDCODE.years;
  const rd  = (CDS.rankData  && CDS.rankData.length  > 0) ? CDS.rankData  : RANK_HARDCODE.data;

  // 全国名を登場順で収集（重複除去）
  const allCountries = [...new Set(rd.flatMap(r => r.vals).filter(Boolean))];

  // 年×列ごとに「国名→順位」マップ
  const yearRankMaps = yrs.map((_, ji) => {
    const map = {};
    rd.forEach(row => { if (row.vals[ji]) map[row.vals[ji]] = row.rank; });
    return map;
  });

  // 国ごとにシリーズ作成（PALETTEを使用して他グラフと統一）
  const series = allCountries.map((country, ci) => {
    const color = PALETTE[ci % PALETTE.length];
    const data = yrs.map((_, ji) => yearRankMaps[ji][country] ?? null);
    return {
      name: country,
      type: 'line',
      smooth: false,
      symbol: 'circle',
      symbolSize: 9,
      lineStyle: { width: 2, color },
      itemStyle: { color },
      data,
      label: { show: false },
      emphasis: { lineStyle: { width: 4 } },
    };
  });

  chart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
      formatter: params => {
        const yr = params[0]?.axisValueLabel || '';
        const valid = params.filter(p => p.value != null).sort((a, b) => a.value - b.value);
        return `<b>${yr}</b><br/>` +
          valid.map(p => `${p.marker}<b>${p.value}位</b>　${p.seriesName}`).join('<br/>');
      }
    },
    legend: {
      data: allCountries,
      bottom: 0,
      type: 'scroll',
      pageButtonPosition: 'end',
      icon: 'circle',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { fontSize: 11 },
    },
    grid: { left: 55, right: 20, top: 20, bottom: 70, containLabel: true },
    xAxis: {
      type: 'category',
      data: yrs,
      boundaryGap: true,
      axisLabel: { fontSize: 12, fontWeight: 'bold' },
    },
    yAxis: {
      type: 'value',
      name: '順位',
      nameLocation: 'start',
      inverse: true,
      min: 1,
      max: 15,
      interval: 1,
      axisLabel: { formatter: v => v + '位', fontSize: 11 },
      splitLine: { lineStyle: { color: '#e8e8e8', type: 'dashed' } },
    },
    series,
  }, true);

  setTimeout(() => { try { cdsEc('ec-cds-rank')?.resize(); } catch(e) {} }, 80);
}

function cdsDrawRussia() {
  if (!CDS_LOADED) return;
  const chart=cdsEc('ec-cds-russia'); if(!chart) return;
  const months=['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const yrs=Object.keys(CDS.russia||{}).sort(), cols=['#cbd5e1','#94a3b8','#3b82f6','#f59e0b','#ef4444','#10b981'];
  chart.setOption({tooltip:{trigger:'axis',formatter:p=>`<b>${p[0].axisValueLabel}</b><br/>`+p.map(s=>`${s.marker}${s.seriesName}: <b>${s.value!=null?s.value.toLocaleString()+'台':'—'}</b>`).join('<br/>')},
    legend:{data:yrs.map(y=>y+'年'),bottom:0},grid:{left:65,right:20,top:20,bottom:50},
    xAxis:{type:'category',data:months},yAxis:{type:'value',name:'台',axisLabel:{formatter:v=>v>=10000?(v/10000).toFixed(0)+'万':v}},
    series:yrs.map((yr,i)=>({name:yr+'年',type:'line',smooth:true,symbol:'circle',symbolSize:5,lineStyle:{width:(yr==='2025'||yr==='2026')?3:2,color:cols[i]},itemStyle:{color:cols[i]},data:CDS.russia[yr]}))});
  setTimeout(()=>{try{cdsEc('ec-cds-russia')?.resize();}catch(e){}},80);
}

// 動力種別の日本語マップ
const DISP_POWER_MAP = {
  // 旧中国語キーとの互換マップ
  '汽油':'ガソリン', '柴油':'ディーゼル', '混合動力':'HEV', '純電動':'BEV', '插混':'PHEV',
  // 新日本語キーは自己マップ
  'ガソリン':'ガソリン', 'ディーゼル':'ディーゼル', 'HEV':'HEV', 'BEV':'BEV', 'PHEV':'PHEV'
};
// 排量帯の日本語マップ（ソート順も管理）
const DISP_RANGE_ORDER = ['≤1L','1〜1.5L','1.5〜2L','2〜2.5L','2.5〜3L','3L超','全排量'];
const DISP_RANGE_MAP = {
  '排量≦1L':'≤1L',
  '1L＜排量≦1.5L':'1〜1.5L',
  '1.5L＜排量≦2L':'1.5〜2L',
  '2L＜排量≦2.5L':'2〜2.5L',
  '2.5L＜排量≦3L':'2.5〜3L',
  '排量＞3L':'3L超',
  '（全排量）':'全排量',
};

function cdsDrawDisplace() {
  if (!CDS_LOADED) return;
  const chart=cdsEc('ec-cds-displace'); if(!chart) return;

  // データ整形
  const rawData = (CDS.displace||[]).filter(x=>!x.range.includes('汇総'));
  const rangeSet = new Set(rawData.map(x=>DISP_RANGE_MAP[x.range]||x.range).filter(Boolean));
  const ranges = DISP_RANGE_ORDER.filter(r=>rangeSet.has(r));
  const powerOrder = ['ガソリン','HEV','BEV','PHEV','ディーゼル'];
  const powerSet = new Set(rawData.map(x=>x.power).filter(p=>p&&!p.includes('汇')));
  const powers = powerOrder.filter(p=>powerSet.has(p));

  const years = ['2022','2023','2024','2025','2026'];
  const yrLabels = {'2022':'22年','2023':'23年','2024':'24年','2025':'25年','2026':'26年(1-9月)'};

  // 動力ごとに色相を固定、年ごとに明度を変える
  const pwBaseHue = {'ガソリン':215,'HEV':38,'BEV':217,'PHEV':160,'ディーゼル':270};
  // 年ごとのアルファ（古い年ほど薄め）
  const yrAlpha = {'2022':0.35,'2023':0.50,'2024':0.65,'2025':0.85,'2026':1.0};
  function pwYrColor(pw, yr) {
    const h = pwBaseHue[pw]||200;
    const a = yrAlpha[yr]||1;
    // HSL → 年が新しいほど彩度・明度を高く
    const s = 55 + (1-a)*10;
    const l = 45 + (1-a)*15;
    return `hsla(${h},${s}%,${l}%,${a})`;
  }

  // yAxis = 排量帯（横棒にして読みやすく）
  // 各排量帯ごとに 2022〜2026 の積み上げ横棒（動力種別で積み上げ）
  // ECharts のグループ積み上げ: stack をyr別に設定
  const series = [];
  years.forEach(yr=>{
    powers.forEach((pw,pi)=>{
      const pwName = DISP_POWER_MAP[pw]||pw;
      const seriesName = pwName + ' ' + yrLabels[yr];
      const data = ranges.map(rng=>{
        const item = rawData.find(x=>x.power===pw&&(DISP_RANGE_MAP[x.range]||x.range)===rng);
        const v = item ? (item.vals[yr]??null) : null;
        return v != null && v > 0 ? v : null;
      });
      series.push({
        name: seriesName,
        type:'bar',
        stack: 'yr_'+yr,
        barMaxWidth: 16,
        data,
        itemStyle:{color: pwYrColor(pw,yr)},
        label: pi===powers.length-1 ? {
          show:true, position:'right', fontSize:9, color:'#555',
          formatter: p => {
            if(!p.value) return '';
            const rng = ranges[p.dataIndex];
            let sum=0;
            powers.forEach(pw2=>{
              const it=rawData.find(x=>x.power===pw2&&(DISP_RANGE_MAP[x.range]||x.range)===rng);
              const v=it?(it.vals[yr]??0):0;
              if(v>0) sum+=v;
            });
            return sum>=0.5 ? yrLabels[yr]+'\n'+sum.toFixed(0) : '';
          }
        } : {show:false}
      });
    });
  });

  // 凡例: 動力種別×年の全組み合わせ（シリーズ名と完全一致）
  const legendData = [];
  years.forEach(yr=>{
    powers.forEach(pw=>{
      legendData.push({
        name: (DISP_POWER_MAP[pw]||pw) + ' ' + yrLabels[yr],
        itemStyle:{color: pwYrColor(pw,yr)}
      });
    });
  });

  // 年ラベルを Y軸の各グループに補助線として入れるため
  // 実際は xAxis(値軸) yAxis(排量帯) の横棒
  chart.setOption({
    tooltip:{
      trigger:'axis', axisPointer:{type:'shadow'},
      formatter: p => {
        const rng = p[0]?.axisValueLabel || '';
        // 年ごとにグループ化して表示（seriesName = "動力\u00a0年ラベル"）
        const byYr = {};
        p.forEach(s=>{
          if(!s.value) return;
          const parts = s.seriesName.split('\u00a0');
          const pwKey = parts[0] || s.seriesName;
          const yrKey = parts[1] || '';
          if(!byYr[yrKey]) byYr[yrKey]=[];
          byYr[yrKey].push(`${s.marker}${pwKey}: <b>${s.value}万台</b>`);
        });
        let html = `<b>${rng}</b><br/>`;
        Object.keys(byYr).forEach(yrKey=>{
          const total = p.filter(s=>s.value && s.seriesName.split('\u00a0')[1]===yrKey).reduce((a,s)=>a+s.value,0);
          html += `<span style="color:#666;font-size:11px;font-weight:bold">${yrKey} 計${total.toFixed(0)}万台</span><br/>${byYr[yrKey].join('<br/>')}<br/>`;
        });
        return html;
      }
    },
    legend:{
      data: legendData,
      bottom:0, type:'scroll',
      formatter: name => name
    },
    grid:{left:10, right:60, top:20, bottom:50, containLabel:true},
    xAxis:{type:'value', name:'万台', nameTextStyle:{fontSize:11}, axisLabel:{fontSize:10}},
    yAxis:{
      type:'category', data:ranges,
      axisLabel:{fontSize:11},
      inverse: true
    },
    series
  },{notMerge:true});

  // 年ラベルのテキスト補助（右端に年ラベルを表示するgraphicは省略）
  setTimeout(()=>{try{cdsEc('ec-cds-displace')?.resize();}catch(e){}},80);
}

// 後方互換のため _setDisplaceYear はno-opにしておく
function _setDisplaceYear(yr, btn) { cdsDrawDisplace(); }

// =============================================
// 新規追加：シェア・クロス分析・補助テーブル群
// =============================================

// (1) NEV月次推移（線グラフ - 既存cds-nevは積み上げ棒、こちらは純NEV線グラフ）
function cdsDrawNevMonthly() {
  if (!CDS_LOADED) return;
  const chart = cdsEc('ec-cds-nev-monthly'); if(!chart) return;
  const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const yrs = ['2022','2023','2024','2025','2026'];
  const nm = CDS.nevMonthly || {};
  chart.setOption({
    tooltip:{trigger:'axis', valueFormatter:v=>v!=null?v+'万':'-'},
    legend:{data:yrs.map(y=>y+'年'), bottom:0},
    grid:{left:55, right:20, top:20, bottom:50, containLabel:true},
    xAxis:{type:'category', data:months},
    yAxis:{type:'value', axisLabel:{formatter:v=>v+'万'}},
    series: yrs.map((yr,i)=>({
      name: yr+'年', type:'line', smooth:true, symbol:'circle', symbolSize:5,
      lineStyle:{ width: yr==='2026'?3:(yr==='2025'?2.5:1.5), type: yr==='2026'?'dashed':'solid' },
      itemStyle:{color: YRCOLORS[i]},
      data: (nm[yr]||[])
    }))
  });
  setTimeout(()=>{try{cdsEc('ec-cds-nev-monthly')?.resize();}catch(e){}}, 80);
}

// (2) 対ロシア車型別構造（積み上げ横棒）
function cdsDrawRussiaBody() {
  if (!CDS_LOADED) return;
  const chart = cdsEc('ec-cds-russia-body'); if(!chart) return;
  const rb = CDS.russiaByBody || {};
  const years = rb.years || [];
  const cats = rb.categories || [];

  const typeColors = {
    'pass': ['#1e40af','#2563eb','#3b82f6','#60a5fa','#93c5fd'],
    'truck': ['#b45309','#d97706','#f59e0b','#fbbf24','#fcd34d'],
    'bus': ['#065f46','#10b981','#34d399']
  };
  const typeCounters = {pass:0, truck:0, bus:0};
  const series = cats.map(c=>{
    const idx = typeCounters[c.type]++;
    const colors = typeColors[c.type] || ['#94a3b8'];
    return {
      name: c.name,
      type:'bar',
      stack: 't',
      barMaxWidth: 36,
      data: c.vals,
      itemStyle:{color: colors[idx % colors.length]},
      emphasis:{focus:'series'}
    };
  });
  chart.setOption({
    tooltip:{trigger:'axis', axisPointer:{type:'shadow'},
      formatter: p => {
        const x = p[0]?.axisValueLabel || '';
        let sum=0; p.forEach(s=>{ if(s.value) sum+=s.value; });
        const lines = p.filter(s=>s.value>0).sort((a,b)=>b.value-a.value)
          .map(s=>`${s.marker}${s.seriesName}: <b>${s.value.toFixed(1)}万</b>`);
        return `<b>${x}</b><br/>${lines.join('<br/>')}<br/><b>合計: ${sum.toFixed(1)}万台</b>`;
      }
    },
    legend:{type:'scroll', bottom:0, textStyle:{fontSize:11}},
    grid:{left:90, right:60, top:30, bottom:60, containLabel:true},
    xAxis:{type:'category', data:years, axisLabel:{fontSize:11}},
    yAxis:{type:'value', axisLabel:{formatter:v=>v+'万'}},
    series: series
  });
  setTimeout(()=>{try{cdsEc('ec-cds-russia-body')?.resize();}catch(e){}}, 80);
}

// (3) 動力別シェア（積み上げ100%棒）
function cdsDrawPowerShare() {
  if (!CDS_LOADED) return;
  const chart = cdsEc('ec-cds-power-share'); if(!chart) return;
  const pc = CDS.powerCars || {};
  const years = ['2022','2023','2024','2025','2026'];
  const yrLabels = years.map(y=> y==='2026' ? '2026年\n(1-9月累計)' : y+'年');
  const powers = ['ガソリン','BEV','PHEV','HEV','ディーゼル'];
  const colors = {'ガソリン':'#94a3b8','BEV':'#10b981','PHEV':'#3b82f6','HEV':'#f59e0b','ディーゼル':'#7c3aed'};

  // 各年の合計
  const totals = years.map(y => {
    let s = 0;
    powers.forEach(p => {
      const v = (pc[p]||{})[y];
      if (typeof v === 'number') s += v;
    });
    return s;
  });

  const series = powers.map(p => ({
    name: p,
    type: 'bar',
    stack: 'share',
    barMaxWidth: 50,
    itemStyle: {color: colors[p]},
    data: years.map((y,i) => {
      const v = (pc[p]||{})[y];
      if (typeof v !== 'number' || !totals[i]) return null;
      return Math.round((v/totals[i])*1000)/10;  // % (小数1桁)
    }),
    label: {show:true, position:'inside', formatter:p=>p.value>=5?p.value+'%':'', color:'#fff', fontSize:10}
  }));

  chart.setOption({
    tooltip:{trigger:'axis', axisPointer:{type:'shadow'},
      formatter: p => {
        const i = p[0]?.dataIndex; const yr = years[i];
        const lines = p.filter(s=>s.value).map(s=>{
          const v = (pc[s.seriesName]||{})[yr];
          return `${s.marker}${s.seriesName}: <b>${s.value}%</b> (${(v||0).toFixed(1)}万台)`;
        });
        return `<b>${yrLabels[i].replace('\n',' ')}</b><br/>${lines.join('<br/>')}<br/>合計: <b>${totals[i].toFixed(1)}万台</b>`;
      }
    },
    legend:{data: powers, bottom:0},
    grid:{left:50, right:20, top:20, bottom:50, containLabel:true},
    xAxis:{type:'category', data: yrLabels, axisLabel:{fontSize:10}},
    yAxis:{type:'value', max:100, axisLabel:{formatter:v=>v+'%'}},
    series: series
  });
  setTimeout(()=>{try{cdsEc('ec-cds-power-share')?.resize();}catch(e){}}, 80);
}

// (4) ボディタイプ別シェア（積み上げ100%棒）
function cdsDrawBodyShare() {
  if (!CDS_LOADED) return;
  const chart = cdsEc('ec-cds-body-share'); if(!chart) return;
  const bt = CDS.bodyTypes || {};
  const years = ['2022','2023','2024','2025','2026'];
  const yrLabels = years.map(y=> y==='2026' ? '2026年\n(1-9月累計)' : y+'年');
  // 「乗用車 計」「貨物車 計」「バス 計」を使用
  const bodyKeys = Object.keys(bt).filter(k=>k.includes('計'));
  const colors = ['#3b82f6','#f59e0b','#10b981'];

  const totals = years.map(y => {
    let s = 0;
    bodyKeys.forEach(k => {
      const v = (bt[k]||{})[y];
      if (typeof v === 'number') s += v;
    });
    return s;
  });

  const series = bodyKeys.map((k,ki) => ({
    name: k.replace(' 計',''),
    type: 'bar', stack: 'share',
    barMaxWidth: 50,
    itemStyle: {color: colors[ki % colors.length]},
    data: years.map((y,i) => {
      const v = (bt[k]||{})[y];
      if (typeof v !== 'number' || !totals[i]) return null;
      return Math.round((v/totals[i])*1000)/10;
    }),
    label: {show:true, position:'inside', formatter:p=>p.value>=3?p.value+'%':'', color:'#fff', fontSize:10}
  }));

  chart.setOption({
    tooltip:{trigger:'axis', axisPointer:{type:'shadow'},
      formatter: p => {
        const i = p[0]?.dataIndex; const yr = years[i];
        const lines = p.filter(s=>s.value).map(s=>`${s.marker}${s.seriesName}: <b>${s.value}%</b>`);
        return `<b>${yrLabels[i].replace('\n',' ')}</b><br/>${lines.join('<br/>')}<br/>合計: <b>${totals[i].toFixed(0)}万台</b>`;
      }
    },
    legend:{bottom:0},
    grid:{left:50, right:20, top:20, bottom:50, containLabel:true},
    xAxis:{type:'category', data: yrLabels, axisLabel:{fontSize:10}},
    yAxis:{type:'value', max:100, axisLabel:{formatter:v=>v+'%'}},
    series: series
  });
  setTimeout(()=>{try{cdsEc('ec-cds-body-share')?.resize();}catch(e){}}, 80);
}

// (5) 货車重量別（積み上げ縦棒）
function cdsDrawTruckWeight() {
  if (!CDS_LOADED) return;
  const chart = cdsEc('ec-cds-truck-weight'); if(!chart) return;
  const tw = CDS.truckWeight || {};
  const years = tw.years || [];
  const cats = tw.categories || [];
  const powerColors = {
    'ガソリン': ['#94a3b8','#cbd5e1','#e2e8f0'],
    'ディーゼル': ['#7c3aed','#a78bfa','#c4b5fd','#ddd6fe','#ede9fe'],
    'BEV':  ['#10b981'],
    'PHEV': ['#3b82f6','#60a5fa'],
    '不明': ['#cbd5e1']
  };
  const pwCounters = {};
  const series = cats.map(c => {
    pwCounters[c.power] = (pwCounters[c.power]||0);
    const colors = powerColors[c.power] || ['#94a3b8'];
    const color = colors[pwCounters[c.power] % colors.length];
    pwCounters[c.power]++;
    return {
      name: c.name, type:'bar', stack:'t',
      barMaxWidth: 40,
      itemStyle:{color},
      data: c.vals, emphasis:{focus:'series'}
    };
  });
  chart.setOption({
    tooltip:{trigger:'axis', axisPointer:{type:'shadow'},
      formatter: p => {
        const x = p[0]?.axisValueLabel || '';
        let sum=0; p.forEach(s=>{ if(s.value) sum+=s.value; });
        const lines = p.filter(s=>s.value>0).sort((a,b)=>b.value-a.value)
          .map(s=>`${s.marker}${s.seriesName}: <b>${s.value.toFixed(1)}万</b>`);
        return `<b>${x}</b><br/>${lines.join('<br/>')}<br/>貨物車合計: <b>${sum.toFixed(1)}万台</b>`;
      }
    },
    legend:{type:'scroll', bottom:0, textStyle:{fontSize:10}},
    grid:{left:60, right:30, top:30, bottom:70, containLabel:true},
    xAxis:{type:'category', data:years, axisLabel:{fontSize:10}},
    yAxis:{type:'value', axisLabel:{formatter:v=>v+'万'}},
    series: series
  });
  setTimeout(()=>{try{cdsEc('ec-cds-truck-weight')?.resize();}catch(e){}}, 80);
}

// (6) 客車座席別（積み上げ縦棒）
function cdsDrawBusSeats() {
  if (!CDS_LOADED) return;
  const chart = cdsEc('ec-cds-bus-seats'); if(!chart) return;
  const bs = CDS.busSeats || {};
  const years = bs.years || [];
  const cats = bs.categories || [];
  const powerColors = {
    'ガソリン': ['#94a3b8','#cbd5e1','#e2e8f0'],
    'ディーゼル': ['#7c3aed','#a78bfa','#c4b5fd'],
    'BEV':  ['#065f46','#10b981','#34d399','#6ee7b7'],
    '不明': ['#cbd5e1']
  };
  const pwCounters = {};
  const series = cats.map(c => {
    pwCounters[c.power] = (pwCounters[c.power]||0);
    const colors = powerColors[c.power] || ['#94a3b8'];
    const color = colors[pwCounters[c.power] % colors.length];
    pwCounters[c.power]++;
    return {
      name: c.name, type:'bar', stack:'t',
      barMaxWidth: 40,
      itemStyle:{color},
      data: c.vals, emphasis:{focus:'series'}
    };
  });
  chart.setOption({
    tooltip:{trigger:'axis', axisPointer:{type:'shadow'},
      formatter: p => {
        const x = p[0]?.axisValueLabel || '';
        let sum=0; p.forEach(s=>{ if(s.value) sum+=s.value; });
        const lines = p.filter(s=>s.value>0).sort((a,b)=>b.value-a.value)
          .map(s=>`${s.marker}${s.seriesName}: <b>${s.value.toFixed(1)}万</b>`);
        return `<b>${x}</b><br/>${lines.join('<br/>')}<br/>バス合計: <b>${sum.toFixed(1)}万台</b>`;
      }
    },
    legend:{type:'scroll', bottom:0, textStyle:{fontSize:10}},
    grid:{left:60, right:30, top:30, bottom:70, containLabel:true},
    xAxis:{type:'category', data:years, axisLabel:{fontSize:10}},
    yAxis:{type:'value', axisLabel:{formatter:v=>v+'万'}},
    series: series
  });
  setTimeout(()=>{try{cdsEc('ec-cds-bus-seats')?.resize();}catch(e){}}, 80);
}

// (7) 動力×地域クロス分析（グループ縦棒、地域×動力）
function cdsDrawPowerRegion() {
  if (!CDS_LOADED) return;
  const chart = cdsEc('ec-cds-power-region'); if(!chart) return;
  const pr = CDS.powerByRegion || {};
  const powers = pr.powers || [];
  const regions = pr.regions || [];
  const dat = pr.data || {};

  const powerColors = {'ガソリン':'#94a3b8', 'BEV':'#10b981', 'PHEV':'#3b82f6', 'HEV':'#f59e0b', 'ディーゼル':'#7c3aed'};

  // 各動力のシリーズ：x=地域、y=2026.1-4月値
  const series = powers.map(p => ({
    name: p,
    type: 'bar',
    barGap: 0,
    itemStyle: {color: powerColors[p] || '#94a3b8'},
    data: regions.map(r => {
      const cell = (dat[p]||{})[r];
      return cell ? cell.y2026 : 0;
    }),
    label: {show:true, position:'top', fontSize:9, formatter:p=>p.value>=2?p.value.toFixed(1):''}
  }));

  chart.setOption({
    tooltip:{trigger:'axis', axisPointer:{type:'shadow'},
      formatter: p => {
        const reg = p[0]?.axisValueLabel || '';
        let total = 0; p.forEach(s => { if (s.value) total += s.value; });
        const lines = p.filter(s=>s.value).sort((a,b)=>b.value-a.value).map(s=>{
          const cell = (dat[s.seriesName]||{})[reg] || {};
          const y25 = cell.y2025 || 0;
          const yoy = y25 ? ((s.value*3 - y25)/y25*100).toFixed(0) : '-';  // 通年換算で参考YoY
          return `${s.marker}${s.seriesName}: <b>${s.value.toFixed(1)}万</b> <span style="color:#888">(25年通年: ${y25.toFixed(1)})</span>`;
        });
        return `<b>${reg}</b> (2026年1-4月)<br/>${lines.join('<br/>')}<br/>地域合計: <b>${total.toFixed(1)}万台</b>`;
      }
    },
    legend:{data: powers, bottom:0},
    grid:{left:50, right:30, top:30, bottom:50, containLabel:true},
    xAxis:{type:'category', data: regions, axisLabel:{fontSize:11, interval:0}},
    yAxis:{type:'value', name:'万台', axisLabel:{formatter:v=>v+'万'}},
    series: series
  });
  setTimeout(()=>{try{cdsEc('ec-cds-power-region')?.resize();}catch(e){}}, 80);
}

// (8) 省別均価（横棒）
function cdsDrawProvPrice() {
  if (!CDS_LOADED) return;
  const el = document.getElementById('ec-cds-prov-price');
  if (!el) return;
  if (CDS_EC['ec-cds-prov-price']) { try{ CDS_EC['ec-cds-prov-price'].dispose(); }catch(e){} }
  CDS_EC['ec-cds-prov-price'] = echarts.init(el, null, {renderer:'canvas'});
  const chart = CDS_EC['ec-cds-prov-price'];

  const provs = CDS.provs || [];
  // price2026を持つ省のみ抽出、降順
  const filtered = provs.filter(p => typeof p.price2026 === 'number').sort((a,b)=>b.price2026-a.price2026);
  const names = filtered.map(p=>p.name);
  const prices = filtered.map(p=>p.price2026);
  const vols = filtered.map(p=>{
    const v = p.v || [];
    return v[v.length-1] || 0;  // 1-9月累計（最後の要素）
  });

  // 全国の輸出均価（2026年1-9月、図8「整车」）
  const avgPrice = 1.73;

  chart.setOption({
    tooltip:{trigger:'axis', axisPointer:{type:'shadow'},
      formatter: p => {
        const nm = p[0]?.axisValueLabel || '';
        const idx = names.indexOf(nm);
        const price = prices[idx];
        const vol = vols[idx];
        const diff = ((price - avgPrice)/avgPrice*100).toFixed(0);
        return `<b>${nm}</b><br/>輸出単価: <b>${price.toFixed(2)} 万USD/台</b><br/>1-9月累計: ${vol.toFixed(1)}万台<br/>全国平均比: ${diff>=0?'+':''}${diff}%`;
      }
    },
    grid:{left:80, right:80, top:30, bottom:30, containLabel:true},
    xAxis:{type:'value', name:'万USD/台', axisLabel:{formatter:v=>v.toFixed(1)}},
    yAxis:{type:'category', data: names.slice().reverse(), inverse:false, axisLabel:{fontSize:11}},
    series:[{
      type:'bar',
      data: prices.slice().reverse(),
      barMaxWidth: 22,
      itemStyle:{
        color: p => {
          const v = p.value;
          if (v >= 2.3) return '#dc2626';  // 高価格帯（赤）
          if (v >= 1.7) return '#f59e0b';  // 中価格帯（橙）
          if (v >= 1.2) return '#3b82f6';  // 標準価格帯（青）
          return '#94a3b8';  // 低価格帯（灰）
        }
      },
      label:{show:true, position:'right', fontSize:10, formatter:p=>p.value.toFixed(2)},
      markLine:{
        symbol:'none', label:{position:'end', formatter:`全国平均: ${avgPrice.toFixed(2)}`, fontSize:10, color:'#dc2626'},
        lineStyle:{color:'#dc2626', type:'dashed', width:1},
        data:[{xAxis: avgPrice}]
      }
    }]
  });
  setTimeout(()=>{try{CDS_EC['ec-cds-prov-price']?.resize();}catch(e){}}, 80);
}

// =============================================
// 商用車（国内）描画関数群
// =============================================
function cvEc(id) {
  if (!CDS_EC[id]) {
    const el = document.getElementById(id);
    if (!el) return null;
    CDS_EC[id] = echarts.init(el, null, {renderer:'canvas'});
  }
  return CDS_EC[id];
}

// 統一ディスパッチャ
function cvRender(id) {
  if (CDS_FNS[id]) CDS_FNS[id]();
}

// (1) 月次推移
function cvDrawMonthly() {
  if (!window.CV_LOADED) return;
  const chart = cvEc('ec-cv-monthly'); if(!chart) return;
  const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const yrs = Object.keys(CV.monthly||{}).sort();
  const cmap = {'2022':'#94a3b8','2023':'#10b981','2024':'#3b82f6','2025':'#1e293b','2026':'#dc2626'};
  const colors = yrs.map(y=>cmap[y]||'#64748b');
  chart.setOption({
    tooltip:{trigger:'axis', valueFormatter:v=>v!=null?v+'万台':'-'},
    legend:{data:yrs.map(y=>y+'年'), bottom:0},
    grid:{left:55, right:20, top:30, bottom:50, containLabel:true},
    xAxis:{type:'category', data:months},
    yAxis:{type:'value', axisLabel:{formatter:v=>v+'万'}},
    series: yrs.map((yr,i)=>({
      name: yr+'年', type:'line', smooth:true, symbol:'circle', symbolSize:6,
      lineStyle:{ width: yr==='2026'?3:1.8 },
      itemStyle:{color: colors[i]},
      data: (CV.monthly[yr]||[]),
      label:{ show:yr==='2026', formatter:p=>p.value!=null?p.value:'', fontSize:10, color:'#dc2626', fontWeight:'bold' }
    }))
  });
  setTimeout(()=>{try{cvEc('ec-cv-monthly')?.resize();}catch(e){}}, 80);
}

// (2) 年比較表（期間区分は CV.annualMeta.labels で決まる。例：1-7月 / 8月 / 9-12月）
function _cvDrawPeriodAnnual(chartId, data, meta, palette) {
  const chart = cvEc(chartId); if(!chart) return;
  const L = (meta && meta.labels) || {pre:'前期間', cur:'当月', ytd:'年初来', rest:'残り'};
  const years = data.map(d=>d.year+'年');
  const yo = v => v==null ? '' : ' (YoY ' + (v===0?'±':(v>0?'+':'')) + v + '%)';
  const man = v => v==null ? '-' : v + '万';
  const onlyTotal = d => d.pre==null && d.cur==null;
  const hasOnlyTotal = data.some(d => onlyTotal(d) && d.total!=null);
  const legend = [L.pre, L.cur, L.rest].concat(hasOnlyTotal ? ['通年（内訳なし）'] : []).concat(['通年']);
  chart.setOption({
    tooltip:{trigger:'axis', axisPointer:{type:'shadow'},
      formatter:p=>{
        const d = data[p[0].dataIndex]; if(!d) return '';
        if (onlyTotal(d)) {
          return `<b>${d.year}年</b><br/>通年: <b>${man(d.total)}</b>${yo(d.total_yoy)}<br/><span style="color:#94a3b8">月次の内訳データなし</span>`;
        }
        return `<b>${d.year}年</b><br/>` +
          `${L.pre}: ${man(d.pre)}${yo(d.pre_yoy)}<br/>` +
          `${L.cur}: ${man(d.cur)}${yo(d.cur_yoy)}${d.cur_mom!=null?' / MoM '+(d.cur_mom>=0?'+':'')+d.cur_mom+'%':''}<br/>` +
          `${L.ytd}: <b>${man(d.ytd)}</b>${yo(d.ytd_yoy)}<br/>` +
          `${L.rest}: ${man(d.rest)}${yo(d.rest_yoy)}<br/>` +
          `通年: <b>${man(d.total)}</b>${yo(d.total_yoy)}`;
      }
    },
    legend:{data:legend, bottom:0},
    grid:{left:50, right:30, top:30, bottom:50, containLabel:true},
    xAxis:{type:'category', data:years},
    yAxis:{type:'value', name:'万台', axisLabel:{formatter:v=>v+'万'}},
    series:[
      {name:L.pre, type:'bar', stack:'a', barMaxWidth:60, itemStyle:{color:palette.pre}, data:data.map(d=>d.pre)},
      {name:L.cur, type:'bar', stack:'a', barMaxWidth:60, itemStyle:{color:'#dc2626'}, data:data.map(d=>d.cur),
        label:{show:true,position:'inside',formatter:p=>p.value!=null?p.value+'万':'',fontSize:10,color:'#fff'}},
      {name:L.rest, type:'bar', stack:'a', barMaxWidth:60, itemStyle:{color:palette.rest}, data:data.map(d=>d.rest)},
      ...(hasOnlyTotal ? [{name:'通年（内訳なし）', type:'bar', stack:'a', barMaxWidth:60,
        itemStyle:{color:'#e2e8f0', borderColor:'#94a3b8', borderType:'dashed', borderWidth:1},
        data:data.map(d=>onlyTotal(d)?d.total:null)}] : []),
      {name:'通年', type:'line', smooth:true, symbol:'diamond', symbolSize:10,
        itemStyle:{color:'#1e293b'}, lineStyle:{width:2},
        data:data.map(d=>d.total),
        label:{show:true, formatter:p=>p.value!=null?p.value+'万':'', fontSize:11, color:'#1e293b', fontWeight:'bold', position:'top'}},
      {name:'_ytd', type:'scatter', symbolSize:0, silent:true, tooltip:{show:false},
        data:data.map(d=>(d.total==null && d.ytd!=null)?d.ytd:null),
        label:{show:true, position:'top', formatter:p=>p.value!=null?(L.ytd+' '+p.value+'万'):'', fontSize:11, color:'#dc2626', fontWeight:'bold'}}
    ]
  });
  setTimeout(()=>{try{cvEc(chartId)?.resize();}catch(e){}}, 80);
}

function cvDrawAnnual() {
  if (!window.CV_LOADED) return;
  _cvDrawPeriodAnnual('ec-cv-annual', CV.annual || [], CV.annualMeta, {pre:'#60a5fa', rest:'#94a3b8'});
}

// (3) 動力浸透率（月別・年別）
function cvDrawPenetration() {
  if (!window.CV_LOADED) return;
  const chart = cvEc('ec-cv-penetration'); if(!chart) return;
  const pen = CV.penetration || {};
  const yrs = pen.years || [];
  const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const colors = {'2021':'#94a3b8','2022':'#facc15','2023':'#10b981','2024':'#3b82f6','2025':'#1e293b','2026':'#dc2626'};
  chart.setOption({
    title:{text:'各年・各月のNEV浸透率（汇总＝BEV+PHEV+水素）', left:'center', top:5, textStyle:{fontSize:13, color:'#475569'}},
    tooltip:{trigger:'axis', valueFormatter:v=>v!=null?v+'%':'-'},
    legend:{data:yrs.map(y=>y+'年'), bottom:0},
    grid:{left:55, right:30, top:50, bottom:55, containLabel:true},
    xAxis:{type:'category', data:months},
    yAxis:{type:'value', max:50, axisLabel:{formatter:v=>v+'%'}},
    series: yrs.map(yr => ({
      name: yr+'年', type:'line', smooth:true, symbol:'circle', symbolSize:5,
      lineStyle:{ width: yr==='2026'?3:1.8 },
      itemStyle:{color: colors[yr]},
      data: (pen.monthly[yr]?.total || []),
      label:{show: yr==='2026', formatter:p=>p.value!=null?p.value+'%':'', fontSize:10, color:'#dc2626', fontWeight:'bold'}
    }))
  });
  setTimeout(()=>{try{cvEc('ec-cv-penetration')?.resize();}catch(e){}}, 80);
}

// (4) NEV月次
function cvDrawNevMonthly() {
  if (!window.CV_LOADED) return;
  const chart = cvEc('ec-cv-nev-monthly'); if(!chart) return;
  const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const yrs = ['2023','2024','2025','2026'];
  const colors = ['#10b981','#facc15','#1e293b','#dc2626'];
  chart.setOption({
    tooltip:{trigger:'axis', valueFormatter:v=>v!=null?v.toFixed(2)+'万台':'-'},
    legend:{data:yrs.map(y=>y+'年'), bottom:0},
    grid:{left:55, right:20, top:30, bottom:50, containLabel:true},
    xAxis:{type:'category', data:months},
    yAxis:{type:'value', axisLabel:{formatter:v=>v+'万'}},
    series: yrs.map((yr,i)=>({
      name: yr+'年', type:'line', smooth:true, symbol:'circle', symbolSize:6,
      lineStyle:{ width: yr==='2026'?3:1.8 },
      itemStyle:{color: colors[i]},
      data: (CV.nevMonthly[yr]||[]),
      label:{ show:yr==='2026', formatter:p=>p.value!=null?p.value.toFixed(2):'', fontSize:10, color:'#dc2626', fontWeight:'bold' }
    }))
  });
  setTimeout(()=>{try{cvEc('ec-cv-nev-monthly')?.resize();}catch(e){}}, 80);
}

// (5) NEV年比較（描画は _cvDrawPeriodAnnual を共用）
function cvDrawNevAnnual() {
  if (!window.CV_LOADED) return;
  _cvDrawPeriodAnnual('ec-cv-nev-annual', CV.nevAnnual || [], CV.nevAnnualMeta || CV.annualMeta, {pre:'#86efac', rest:'#a3a3a3'});
}

// (6) 車種別NEV浸透率
function cvDrawNevPenetration() {
  if (!window.CV_LOADED) return;
  const chart = cvEc('ec-cv-nev-penetration'); if(!chart) return;
  const npen = CV.nevPenetration || {};
  const yrs = npen.years || [];
  const cats = npen.categories || [];
  const catNames = cats.map(c=>c.name);
  const colors = {'2022':'#94a3b8','2023':'#facc15','2024':'#3b82f6','2025':'#1e293b','2026':'#dc2626'};
  chart.setOption({
    tooltip:{trigger:'axis', axisPointer:{type:'shadow'}, valueFormatter:v=>v+'%'},
    legend:{data:yrs.map(y=>y+'年'), bottom:0},
    grid:{left:60, right:30, top:30, bottom:50, containLabel:true},
    xAxis:{type:'category', data:catNames, axisLabel:{fontSize:11, interval:0, rotate:25}},
    yAxis:{type:'value', max:100, axisLabel:{formatter:v=>v+'%'}},
    series: yrs.map(yr => ({
      name: yr+'年', type:'bar',
      barGap:0,
      itemStyle:{color: colors[yr]},
      data: cats.map(c=>c.rate[yr] || 0),
      label:{show:yr==='2026', position:'top', formatter:p=>p.value>=10?p.value+'%':'', fontSize:9, color:'#dc2626'}
    }))
  });
  setTimeout(()=>{try{cvEc('ec-cv-nev-penetration')?.resize();}catch(e){}}, 80);
}

// 共通: 地域・企業ランキング描画ヘルパー（4年シェア＋NEV浸透率）
function _cvDrawShareTable(chartId, dataObj) {
  const chart = cvEc(chartId); if(!chart) return;
  const items = dataObj.regions || dataObj.companies || [];
  const years = ['2023','2024','2025','2026'];
  // y軸: vol降順
  const sorted = [...items].sort((a,b)=>(b.vol||0)-(a.vol||0));
  const names = sorted.map(c=>c.name);
  const colors = {'2023':'#86efac','2024':'#fde047','2025':'#94a3b8','2026':'#dc2626'};

  chart.setOption({
    tooltip:{trigger:'axis', axisPointer:{type:'shadow'},
      formatter:p=>{
        const nm = p[0]?.axisValueLabel || '';
        const item = items.find(c=>c.name===nm);
        if (!item) return '';
        let html = `<b>${nm}</b><br/>`;
        html += `${dataObj.period||'2026年'} 保険量: <b>${item.vol!=null?item.vol:'-'}万台</b><br/>`;
        html += `<b>シェア推移${dataObj.basis?'（'+dataObj.basis+'）':''}:</b> `;
        years.forEach(y=> html += `${y}: ${item.share[y]!=null?item.share[y]+'%':'-'} `);
        html += '<br/>';
        if (item.nev) {
          html += `<b>NEV浸透率:</b> `;
          years.forEach(y=> html += `${y}: ${item.nev[y]!=null?item.nev[y]+'%':'-'} `);
        }
        return html;
      }
    },
    legend:{data: years.map(y=>y+'年 シェア').concat(['2026年 NEV浸透率']), bottom:0, textStyle:{fontSize:10}},
    grid:{left:90, right:80, top:30, bottom:50, containLabel:true},
    xAxis:[
      {type:'value', name:'シェア(%)', axisLabel:{formatter:v=>v+'%'}},
      {type:'value', name:'NEV浸透率(%)', max:100, position:'top', axisLabel:{formatter:v=>v+'%'}, splitLine:{show:false}}
    ],
    yAxis:{type:'category', data:names.slice().reverse(), inverse:false, axisLabel:{fontSize:11}},
    series: [
      ...years.map(yr => ({
        name: yr+'年 シェア',
        type:'bar', xAxisIndex:0,
        barMaxWidth: 10, barGap:0.1,
        itemStyle:{color: colors[yr]},
        data: names.slice().reverse().map(nm => items.find(c=>c.name===nm)?.share[yr] || 0),
        label:{show:yr==='2026', position:'right', formatter:p=>p.value>=1?p.value+'%':'', fontSize:9, color:'#dc2626'}
      })),
      {
        name: '2026年 NEV浸透率',
        type:'scatter', xAxisIndex:1, symbolSize: 14, symbol:'diamond',
        itemStyle:{color:'#10b981'},
        data: names.slice().reverse().map(nm => items.find(c=>c.name===nm)?.nev?.['2026'] || 0),
        label:{show:true, position:'right', formatter:p=>p.value+'%', fontSize:10, color:'#065f46', fontWeight:'bold'}
      }
    ]
  });
  setTimeout(()=>{try{cvEc(chartId)?.resize();}catch(e){}}, 80);
}

function cvDrawHtruckRegion()  { if(!window.CV_LOADED)return; _cvDrawShareTable('ec-cv-htruck-region', CV.htruckRegion); }
function cvDrawHtruckCompany() { if(!window.CV_LOADED)return; _cvDrawShareTable('ec-cv-htruck-company', CV.htruckCompany); }
function cvDrawLtruckRegion()  { if(!window.CV_LOADED)return; _cvDrawShareTable('ec-cv-ltruck-region', CV.ltruckRegion); }
function cvDrawLtruckCompany() { if(!window.CV_LOADED)return; _cvDrawShareTable('ec-cv-ltruck-company', CV.ltruckCompany); }
function cvDrawLbusRegion()    { if(!window.CV_LOADED)return; _cvDrawShareTable('ec-cv-lbus-region', CV.lbusRegion); }
function cvDrawLbusCompany()   { if(!window.CV_LOADED)return; _cvDrawShareTable('ec-cv-lbus-company', CV.lbusCompany); }
function cvDrawMbusRegion()    { if(!window.CV_LOADED)return; _cvDrawShareTable('ec-cv-mbus-region', CV.mbusRegion); }
function cvDrawMbusCompany()   { if(!window.CV_LOADED)return; _cvDrawShareTable('ec-cv-mbus-company', CV.mbusCompany); }

// 商用車全体 企業ランキング（期間ラベルは CV.companiesMeta で決まる）
function cvDrawCompanies() {
  if (!window.CV_LOADED) return;
  const chart = cvEc('ec-cv-companies'); if(!chart) return;
  const meta = CV.companiesMeta || {};
  const M = meta.monthLabel || '当月';
  const YTD = meta.ytdLabel || '年初来';
  const yrs = meta.years || ['2021','2022','2023','2024','2025'];
  const prevYear = yrs[yrs.length-1];
  const companies = CV.companies || [];
  const names = companies.map(c=>c.name);
  const cur = companies.map(c=>c.vals.m != null ? c.vals.m : (c.vals.apr || 0));
  const yPrev = companies.map(c=>c.vals[prevYear] || 0);
  const y26 = companies.map(c=>c.vals['2026'] || 0);
  const yoyRev = companies.map(c=>c.yoy).reverse();
  const HI = 150, LO = -50;   // YoY軸の表示範囲（外れ値は端に寄せ、ラベルは実値）
  const sg = v => (v>=0?'+':'') + v + '%';
  const nz = v => v!=null ? v : '-';

  chart.setOption({
    tooltip:{trigger:'axis', axisPointer:{type:'shadow'},
      formatter:p=>{
        const i = p[0].dataIndex;
        // 反転されているのでオリジナルインデックスに戻す
        const c = companies[names.length - 1 - i];
        if (!c) return '';
        const v = c.vals;
        let html = `<b>${c.name}</b><br/>`;
        yrs.forEach(y => { html += `${y}年: ${nz(v[y])} 万台<br/>`; });
        html += `2026年${YTD}: <b>${nz(v['2026'])} 万台</b>${c.ytdYoy!=null?' ('+sg(c.ytdYoy)+')':''}<br/>`;
        html += `2026年${M}: <b>${nz(v.m)} 万台</b><br/>`;
        html += `YoY: ${c.yoy!=null?sg(c.yoy):'-'} / MoM: ${c.mom!=null?sg(c.mom):'-'}`;
        return html;
      }
    },
    legend:{data:[prevYear+'年通年', '2026年'+YTD+'累計', M+'単月', 'YoY ('+M+')'], bottom:0},
    grid:{left:90, right:80, top:30, bottom:50, containLabel:true},
    xAxis:[
      {type:'value', name:'万台', axisLabel:{formatter:v=>v+'万'}},
      {type:'value', name:'YoY(%)', position:'top', axisLabel:{formatter:v=>v+'%'}, splitLine:{show:false}, min:LO, max:HI}
    ],
    yAxis:{type:'category', data:names.slice().reverse(), inverse:false, axisLabel:{fontSize:10}},
    series:[
      {name:prevYear+'年通年', type:'bar', xAxisIndex:0, barGap:0.1, barMaxWidth: 7,
        itemStyle:{color:'#94a3b8'}, data: yPrev.slice().reverse()},
      {name:'2026年'+YTD+'累計', type:'bar', xAxisIndex:0, barMaxWidth: 7,
        itemStyle:{color:'#3b82f6'}, data: y26.slice().reverse()},
      {name:M+'単月', type:'bar', xAxisIndex:0, barMaxWidth: 7,
        itemStyle:{color:'#dc2626'},
        data: cur.slice().reverse(),
        label:{show:true, position:'right', formatter:p=>p.value.toFixed(1), fontSize:10, color:'#dc2626'}},
      {name:'YoY ('+M+')', type:'scatter', xAxisIndex:1, symbolSize:12, symbol:'diamond',
        itemStyle:{color: function(p){ return (yoyRev[p.dataIndex] >= 0 ? '#10b981' : '#ef4444'); }},
        data: yoyRev.map(v => v==null ? null : Math.max(LO, Math.min(HI, v))),
        label:{show:true, position:'right', formatter:p=>{ const v = yoyRev[p.dataIndex]; return v==null ? '' : sg(v) + (v>HI ? ' ▶' : (v<LO ? ' ◀' : '')); }, fontSize:10, color:'#0369a1'}}
    ]
  });
  setTimeout(()=>{try{cvEc('ec-cv-companies')?.resize();}catch(e){}}, 80);
}

// =============================================
// 国別ランキング系：Top10棒グラフ ＋ 国別推移折れ線
// matrixシート名マッピング
// =============================================
// 国別ランキング系：Top10棒グラフ ＋ 国別推移折れ線
// （Excelは変更せず、CDS.rankingsデータから動的組み立て）
// =============================================

const RANK_TITLES = {
  r3:'整車出口', r4:'NEV出口', r5:'燃油乗用車', r6:'BEV乗用車',
  r7:'PHEV乗用車', r6b:'HEV乗用車', r8:'燃油トラック', r9:'PHEVトラック（ピックアップ）',
  r10:'BEVトラック', r9b:'NEVトラック', r11:'燃油バス', r12:'NEVバス（統合）',
};

const PALETTE = [
  '#ef4444','#3b82f6','#10b981','#f59e0b','#8b5cf6',
  '#ec4899','#14b8a6','#f97316','#6366f1','#84cc16',
  '#06b6d4','#a855f7','#e11d48','#0ea5e9','#22c55e',
  '#eab308','#d946ef','#0891b2','#7c3aed','#dc2626',
];

// ランキングデータからJS内で国別月次マトリクスを組み立て
const MATRIX_CACHE = {};
function buildMatrixFromRankings(key) {
  if (MATRIX_CACHE[key]) return MATRIX_CACHE[key];
  const blocks = CDS.rankings[key] || [];
  const YM_RE = /^(\d{4})年(\d{1,2})月$/;
  const monthly = blocks.filter(b => YM_RE.test(b.title));
  if (!monthly.length) return null;

  // 月を時系列順にソート
  const months = monthly
    .map(b => { const m = YM_RE.exec(b.title); return { label: b.title, key: `${m[1]}-${m[2].padStart(2,'0')}` }; })
    .sort((a, b) => a.key.localeCompare(b.key));

  // 国別累計台数（ソート用）
  const countryTotal = {};
  monthly.forEach(b => b.data.forEach(({ country, value }) => {
    countryTotal[country] = (countryTotal[country] || 0) + value;
  }));
  const countries = Object.keys(countryTotal).sort((a, b) => countryTotal[b] - countryTotal[a]);

  // 国×月マトリクス
  const matrix = {};
  countries.forEach(c => { matrix[c] = {}; });
  monthly.forEach(b => {
    const m = YM_RE.exec(b.title);
    const ym = `${m[1]}-${m[2].padStart(2,'0')}`;
    b.data.forEach(({ country, value }) => {
      if (matrix[country]) matrix[country][ym] = value;
    });
  });

  const result = { months, countries, matrix };
  MATRIX_CACHE[key] = result;
  return result;
}

// 2ビューUIを動的生成してランキングタブに挿入
function buildRankingView(key, wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap || wrap.dataset.built) return;
  wrap.dataset.built = '1';
  const title = RANK_TITLES[key] || key;

  wrap.innerHTML = `
    <div class="chart-card">
      <div class="d-flex align-items-center gap-2 mb-2 flex-wrap">
        <span class="fw-bold" style="font-size:1rem">${title}</span>
        <div class="btn-group btn-group-sm ms-2" role="group">
          <button class="btn btn-primary rk-view-btn" data-view="top10">📊 月別Top10</button>
          <button class="btn btn-outline-primary rk-view-btn" data-view="trend">📈 国別推移</button>
        </div>
      </div>
      <div class="rk-view" id="rk-top10-${key}">
        <div class="chart-subtitle mb-1">月を選択：</div>
        <div id="rk-mon-sel-${key}" class="d-flex flex-wrap gap-1 mb-2"></div>
        <div id="ec-rk-${key}" class="echart-box" style="height:420px"></div>
      </div>
      <div class="rk-view d-none" id="rk-trend-${key}">
        <div class="chart-subtitle mb-1">国を選択（複数可）：</div>
        <div id="rk-ctry-sel-${key}" class="d-flex flex-wrap gap-1 mb-2"></div>
        <div id="ec-tr-${key}" class="echart-box" style="height:460px"></div>
        <div class="text-muted mt-1" style="font-size:11px">※ Top10圏外の月は途切れて表示されます</div>
      </div>
    </div>`;

  wrap.querySelectorAll('.rk-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.rk-view-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-outline-primary'); });
      btn.classList.add('btn-primary'); btn.classList.remove('btn-outline-primary');
      const view = btn.dataset.view;
      wrap.querySelector(`#rk-top10-${key}`).classList.toggle('d-none', view !== 'top10');
      wrap.querySelector(`#rk-trend-${key}`).classList.toggle('d-none', view !== 'trend');
      if (view === 'top10') drawTop10(key);
      else drawTrend(key);
      setTimeout(() => Object.values(CDS_EC).forEach(c => { try { c && c.resize(); } catch(e){} }), 80);
    });
  });

  drawTop10(key);
}

function drawTop10(key) {
  const blocks = CDS.rankings[key] || [];
  if (!blocks.length) return;
  const monSelEl = document.getElementById(`rk-mon-sel-${key}`);
  const ecId = `ec-rk-${key}`;

  function draw(idx) {
    const blk = blocks[idx] || blocks[0];
    const d = blk.data.slice(0, 10).reverse();
    const chart = cdsEc(ecId);
    if (!chart) return;
    chart.setOption({
      tooltip: { trigger:'axis', axisPointer:{type:'shadow'},
        formatter: p => `<b>${p[0].axisValueLabel}</b><br/>${p[0].marker}<b>${p[0].value != null ? p[0].value.toLocaleString() + '台' : '—'}</b>` },
      grid: { left:120, right:20, top:10, bottom:40 },
      xAxis: { type:'value', name:'台' },
      yAxis: { type:'category', data: d.map(x => x.country) },
      series: [{ type:'bar', data: d.map(x => x.value),
        itemStyle: { color: p => PALETTE[p.dataIndex % PALETTE.length] },
        label: { show:true, position:'right', fontSize:11, formatter: p => p.value ? p.value.toLocaleString() : '' } }],
    }, true);
  }

  if (monSelEl && !monSelEl.dataset.built) {
    monSelEl.dataset.built = '1';
    const lastIdx = blocks.length - 1;  // 最新データを既定表示
    monSelEl.innerHTML = blocks.map((b, i) =>
      `<button class="btn btn-sm ${i===lastIdx?'btn-primary':'btn-outline-secondary'} rk-mon-btn" data-idx="${i}">${b.title}</button>`
    ).join('');
    monSelEl.querySelectorAll('.rk-mon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        monSelEl.querySelectorAll('.rk-mon-btn').forEach(b => { b.classList.remove('btn-primary'); b.classList.add('btn-outline-secondary'); });
        btn.classList.add('btn-primary'); btn.classList.remove('btn-outline-secondary');
        draw(parseInt(btn.dataset.idx));
      });
    });
  }
  draw(blocks.length - 1);
}

function drawTrend(key) {
  const md = buildMatrixFromRankings(key);
  if (!md) return;
  const { months, countries, matrix } = md;
  const ctrySelEl = document.getElementById(`rk-ctry-sel-${key}`);
  const ecId = `ec-tr-${key}`;
  const selected = new Set(countries.slice(0, 5));

  function drawChart() {
    const selArr = [...selected];
    const chart = cdsEc(ecId);
    if (!chart) return;
    chart.setOption({
      tooltip: { trigger:'axis',
        formatter: p => `<b>${p[0].axisValueLabel}</b><br/>` +
          p.map(s => `${s.marker}${s.seriesName}: <b>${s.value != null ? s.value.toLocaleString()+'台' : 'ランク外'}</b>`).join('<br/>')
      },
      legend: { data: selArr, bottom:0, type:'scroll' },
      grid: { left:65, right:20, top:20, bottom:60 },
      xAxis: { type:'category', data: months.map(m => m.label), axisLabel:{rotate:30, fontSize:10} },
      yAxis: { type:'value', name:'台', axisLabel:{formatter: v => v>=10000?(v/10000).toFixed(0)+'万':v} },
      series: selArr.map((c, i) => ({
        name: c, type:'line', smooth:true, connectNulls:false,
        symbol:'circle', symbolSize:7,
        lineStyle:{ width:2.5, color:PALETTE[i%PALETTE.length] },
        itemStyle:{ color:PALETTE[i%PALETTE.length] },
        data: months.map(m => matrix[c][m.key] ?? null),
      })),
    }, true);
  }

  if (ctrySelEl && !ctrySelEl.dataset.built) {
    ctrySelEl.dataset.built = '1';
    ctrySelEl.innerHTML = countries.map((c, i) => {
      const color = PALETTE[i % PALETTE.length];
      const isOn = selected.has(c);
      return `<button class="btn btn-sm rk-ctry-btn ${isOn?'':'btn-outline-secondary'}"
        data-country="${c}" data-color="${color}"
        style="${isOn?`background:${color};color:#fff;border-color:${color}`:''}">${c}</button>`;
    }).join('');
    ctrySelEl.querySelectorAll('.rk-ctry-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = btn.dataset.country, color = btn.dataset.color;
        if (!btn.classList.contains('btn-outline-secondary')) {
          btn.classList.add('btn-outline-secondary');
          btn.style.background = btn.style.color = btn.style.borderColor = '';
          selected.delete(c);
        } else {
          btn.classList.remove('btn-outline-secondary');
          btn.style.background = color; btn.style.color = '#fff'; btn.style.borderColor = color;
          selected.add(c);
        }
        drawChart();
      });
    });
  }
  drawChart();
}

function makeRankingPanel(key) {
  return function() {
    if (!CDS_LOADED) return;
    buildRankingView(key, `rk-wrap-${key}`);
    setTimeout(() => Object.values(CDS_EC).forEach(c => { try { c && c.resize(); } catch(e){} }), 80);
  };
}

const CDS_FNS = {
  'cds-monthly':       cdsDrawMonthly,
  'cds-annual':        cdsDrawAnnual,
  'cds-amount':        cdsDrawAmount,
  'cds-parts':         cdsDrawParts,
  'cds-nev':           cdsDrawNev,
  'cds-nev-monthly':   cdsDrawNevMonthly,
  'cds-nev-annual':    cdsDrawNevAnnual,
  'cds-nev-trend':     cdsDrawNevTrend,
  'cds-russia':        cdsDrawRussia,
  'cds-russia-body':   cdsDrawRussiaBody,
  'cds-powertype':     cdsDrawPowertype,
  'cds-power-share':   cdsDrawPowerShare,
  'cds-bodytype':      cdsDrawBodytype,
  'cds-body-share':    cdsDrawBodyShare,
  'cds-nev-power':     cdsDrawNevPower,
  'cds-nev-body':      cdsDrawNevBody,
  'cds-displace':      cdsDrawDisplace,
  'cds-truck-weight':  cdsDrawTruckWeight,
  'cds-bus-seats':     cdsDrawBusSeats,
  'cds-region':        cdsDrawRegion,
  'cds-power-region':  cdsDrawPowerRegion,
  'cds-country':       cdsDrawCountry,
  'cds-nev-ctry':      cdsDrawNevCtry,
  'cds-prov':          cdsDrawProv,
  'cds-prov-price':    cdsDrawProvPrice,
  'cds-nev-prov':      cdsDrawNevProv,
  'cds-rank':          cdsDrawRank,
  // 商用車（国内）
  'cv-monthly':         cvDrawMonthly,
  'cv-annual':          cvDrawAnnual,
  'cv-penetration':     cvDrawPenetration,
  'cv-nev-monthly':     cvDrawNevMonthly,
  'cv-nev-annual':      cvDrawNevAnnual,
  'cv-nev-penetration': cvDrawNevPenetration,
  'cv-htruck-region':   cvDrawHtruckRegion,
  'cv-htruck-company':  cvDrawHtruckCompany,
  'cv-ltruck-region':   cvDrawLtruckRegion,
  'cv-ltruck-company':  cvDrawLtruckCompany,
  'cv-lbus-region':     cvDrawLbusRegion,
  'cv-lbus-company':    cvDrawLbusCompany,
  'cv-mbus-region':     cvDrawMbusRegion,
  'cv-mbus-company':    cvDrawMbusCompany,
  'cv-companies':       cvDrawCompanies,
  'cds-r3':   makeRankingPanel('r3'),
  'cds-r4':   makeRankingPanel('r4'),
  'cds-r5':   makeRankingPanel('r5'),
  'cds-r6':   makeRankingPanel('r6'),
  'cds-r7':   makeRankingPanel('r7'),
  'cds-r6b':  makeRankingPanel('r6b'),
  'cds-r8':   makeRankingPanel('r8'),
  'cds-r9':   makeRankingPanel('r9'),
  'cds-r10':  makeRankingPanel('r10'),
  'cds-r9b':  makeRankingPanel('r9b'),
  'cds-r11':  makeRankingPanel('r11'),
  'cds-r12':  makeRankingPanel('r12'),
  // ダブルクレジット
  'dc-overview':     function(){ dcDrawOverview(); },
  'dc-compliance':   function(){ dcDrawCompliance(); },
  'dc-nev-credits':  function(){ dcDrawNevCredits(); },
  'dc-fuel-credits': function(){ dcDrawFuelCredits(); },
  'dc-group':        function(){ dcDrawGroup(); },
  'dc-central':      function(){ dcDrawCentral(); },
  'dc-local':        function(){ dcDrawLocal(); },
  'dc-newforces':    function(){ dcDrawNewForces(); },
  'dc-import':       function(){ dcDrawImport(); },
};

// =============================================
// CDS カスタムタブ制御 ＋ 比較機能
// =============================================

// グループ折りたたみ
let CDS_CURRENT_ID = 'cds-monthly';  // 現在表示中のID

function cdsShowPane(id) {
  // 全ペイン非表示（全系統: cds-/ws-/inv-/bat-/imp-/disc-）
  document.querySelectorAll('.cds-pane:not(#cds-super-content)').forEach(p => p.classList.remove('cds-active'));
  // 対象ペインを表示
  const target = document.getElementById(id);
  if (target) target.classList.add('cds-active');
  CDS_CURRENT_ID = id;

  // ボタンのアクティブ状態を更新
  document.querySelectorAll('#cdsPills [data-cds-target]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-cds-target') === `#${id}`);
  });

  // アクティブなボタンを含むグループラベルを強調
  document.querySelectorAll('.cds-gc-label').forEach(lbl => lbl.classList.remove('has-active'));
  const activeBtn = document.querySelector(`#cdsPills [data-cds-target="#${id}"]`);
  if (activeBtn) {
    const gc = activeBtn.closest('.cds-gc');
    if (gc) {
      gc.querySelector('.cds-gc-label')?.classList.add('has-active');
      // 折りたたまれていたら開く
      gc.classList.remove('collapsed');
    }
  }

  // グラフ描画
  if (CDS_FNS[id]) CDS_FNS[id]();

  // resizeは display:none→block のレイアウト確定後に実行する必要がある。
  // 80ms固定だと別タブから戻った際などにペインがまだ非表示のままで
  // EChartsがサイズ0を掴んでグラフが左端に潰れるバグが発生する。
  // rAF×2（2フレーム後）＋念のため150ms遅延の二段階で確実に解消する。
  function _cdsResizeAll() {
    Object.values(CDS_EC).forEach(function(c) { try { c && c.resize(); } catch(e){} });
  }
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      _cdsResizeAll();
      setTimeout(_cdsResizeAll, 150);
    });
  });
}

// 比較ペインにグラフをクローン表示


// タブナビゲーション：カスタム制御
document.getElementById('cds-super-tab').addEventListener('shown.bs.tab', () => {
  // 初回クリック時は常に「全体」タブを表示
  if (!CDS_LOADED) {
    loadCdsExcel();
    cdsSetMidTab('zenntai');
  } else {
    cdsSetMidTab('zenntai');
  }
});

// 全グループのpillボタンにクリックイベント
document.querySelectorAll('#cdsPills [data-cds-target]').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-cds-target').replace('#', '');
    cdsShowPane(id);
  });
});

// 比較解除ボタン

window.addEventListener('resize', __rafThrottle(() => {
  Object.values(CDS_EC).forEach(c => __ecResize(c));
}));

if (document.getElementById('cds-super-tab')?.classList.contains('active')) loadCdsExcel();

// ===== インライン中国地図GeoJSON =====
const CHINA_GEOJSON = {"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"河北"},"geometry":{"type":"MultiPolygon","coordinates":[[[[116.90625,39.6884765625],[116.91796875,39.84765625],[116.787109375,39.8876953125],[116.7783203125,40.033203125],[116.9306640625,40.0556640625],[117.0859375,40.0751953125],[117.2119140625,40.08203125],[117.13671875,39.9208984375],[117.2607421875,39.84375],[117.154296875,39.736328125],[117.1279296875,39.6171875],[116.9775390625,39.63671875],[116.90625,39.6884765625]]],[[[118.765625,39.0439453125],[118.7548828125,39.0595703125],[118.7646484375,39.0341796875]]],[[[113.732421875,36.3642578125],[113.546875,36.48828125],[113.544921875,36.6240234375],[113.4912109375,36.73828125],[113.681640625,36.791015625],[113.7919921875,36.875],[113.7958984375,36.9951171875],[113.767578125,37.1455078125],[113.88671875,37.2392578125],[113.9599609375,37.349609375],[114.037109375,37.4951171875],[114.119140625,37.5908203125],[114.068359375,37.7216796875],[113.9775390625,37.8173828125],[113.9013671875,37.9853515625],[113.810546875,38.11328125],[113.7138671875,38.2138671875],[113.5830078125,38.2294921875],[113.5263671875,38.3837890625],[113.5625,38.55859375],[113.7099609375,38.65625],[113.8037109375,38.763671875],[113.7763671875,38.8857421875],[114.0439453125,39.1376953125],[114.3466796875,39.076171875],[114.4658203125,39.189453125],[114.4306640625,39.306640625],[114.5693359375,39.57421875],[114.4384765625,39.611328125],[114.3955078125,39.8681640625],[114.2255859375,39.8515625],[114.0478515625,39.9169921875],[113.9111328125,40.0126953125],[113.98046875,40.1123046875],[114.0791015625,40.1865234375],[114.234375,40.1962890625],[114.451171875,40.259765625],[114.314453125,40.3701171875],[114.2978515625,40.5380859375],[114.2119140625,40.6240234375],[114.1044921875,40.7685546875],[114.04296875,40.9052734375],[113.8193359375,41.09765625],[113.9150390625,41.1708984375],[113.9921875,41.2705078125],[113.94921875,41.392578125],[114.041015625,41.5341796875],[114.2314453125,41.513671875],[114.2158203125,41.6845703125],[114.353515625,41.9541015625],[114.5107421875,41.9736328125],[114.51171875,42.111328125],[114.6435546875,42.1103515625],[114.8212890625,42.1494140625],[114.890625,42.03125],[114.939453125,41.8466796875],[114.9033203125,41.689453125],[115.060546875,41.6025390625],[115.1953125,41.6025390625],[115.3779296875,41.6025390625],[115.6484375,41.8251953125],[115.7666015625,41.8896484375],[115.9169921875,41.9453125],[116.017578125,41.77734375],[116.2001953125,41.865234375],[116.328125,42.005859375],[116.4541015625,41.9462890625],[116.640625,41.9306640625],[116.7666015625,41.9912109375],[116.884765625,42.111328125],[116.7900390625,42.201171875],[116.9150390625,42.197265625],[116.8857421875,42.353515625],[117.0009765625,42.427734375],[117.3916015625,42.462890625],[117.4736328125,42.6025390625],[117.6875,42.5830078125],[118.01953125,42.3955078125],[117.9697265625,42.2421875],[118.1064453125,42.1728515625],[118.1171875,42.0380859375],[118.240234375,42.09375],[118.314453125,41.98828125],[118.3359375,41.845703125],[118.166015625,41.8134765625],[118.16015625,41.6767578125],[118.3125,41.5673828125],[118.349609375,41.4287109375],[118.3896484375,41.3095703125],[118.5283203125,41.35546875],[118.677734375,41.3505859375],[118.84375,41.375],[118.9501953125,41.318359375],[119.201171875,41.283203125],[119.08203125,41.1318359375],[118.96484375,41.080078125],[118.9736328125,40.9580078125],[118.849609375,40.8017578125],[119.0546875,40.6650390625],[119.1767578125,40.6904296875],[119.220703125,40.5693359375],[119.5712890625,40.541015625],[119.59765625,40.3369140625],[119.671875,40.240234375],[119.7626953125,40.140625],[119.8544921875,40.0341796875],[119.546875,39.8935546875],[119.3603515625,39.7255859375],[119.2666015625,39.4873046875],[119.2041015625,39.37890625],[119.0966796875,39.2421875],[118.9384765625,39.1337890625],[118.796875,39.1357421875],[118.6376953125,39.158203125],[118.52734375,39.1015625],[118.6044921875,38.9716796875],[118.5009765625,38.9052734375],[118.37890625,38.97265625],[118.2255859375,39.03515625],[118.1259765625,39.18359375],[118.02734375,39.2919921875],[117.84765625,39.3291015625],[117.87109375,39.455078125],[117.9306640625,39.5791015625],[117.767578125,39.6005859375],[117.6220703125,39.5927734375],[117.580078125,39.71875],[117.50390625,39.919921875],[117.6328125,39.96875],[117.7822265625,39.966796875],[117.7080078125,40.0947265625],[117.5771484375,40.1787109375],[117.44140625,40.25390625],[117.2958984375,40.2783203125],[117.2646484375,40.4423828125],[117.3125,40.578125],[117.421875,40.6357421875],[117.2080078125,40.6953125],[116.9697265625,40.70703125],[116.876953125,40.8212890625],[116.7138671875,40.9111328125],[116.6923828125,41.041015625],[116.5634765625,40.994140625],[116.474609375,40.896484375],[116.3447265625,40.93359375],[116.4658203125,40.7724609375],[116.3173828125,40.7724609375],[116.1650390625,40.6640625],[115.984375,40.5791015625],[115.75390625,40.5390625],[115.859375,40.36328125],[115.9697265625,40.2646484375],[115.873046875,40.1875],[115.7412109375,40.1328125],[115.599609375,40.1201171875],[115.455078125,40.0302734375],[115.521484375,39.90234375],[115.42578125,39.775390625],[115.478515625,39.65234375],[115.66796875,39.6162109375],[115.7529296875,39.5126953125],[115.8876953125,39.55078125],[116.130859375,39.568359375],[116.2587890625,39.5009765625],[116.4345703125,39.443359375],[116.5087890625,39.5517578125],[116.7060546875,39.5888671875],[116.8232421875,39.533203125],[116.8388671875,39.4111328125],[116.8935546875,39.2275390625],[116.8720703125,39.0546875],[116.7548828125,39.00390625],[116.7236328125,38.8525390625],[116.8681640625,38.74609375],[117.0458984375,38.7060546875],[117.0986328125,38.5869140625],[117.23046875,38.6435546875],[117.3505859375,38.5615234375],[117.4794921875,38.6181640625],[117.6396484375,38.626953125],[117.7197265625,38.46484375],[117.9375,38.388671875],[117.8076171875,38.2275390625],[117.7275390625,38.091796875],[117.556640625,38.0576171875],[117.51171875,37.9423828125],[117.3388671875,37.86328125],[117.08984375,37.849609375],[116.8037109375,37.8505859375],[116.724609375,37.7451171875],[116.611328125,37.6259765625],[116.45703125,37.5146484375],[116.3203125,37.5810546875],[116.224609375,37.48046875],[115.9765625,37.337890625],[115.9052734375,37.2080078125],[115.77734375,36.9921875],[115.701171875,36.8681640625],[115.4794921875,36.759765625],[115.35546875,36.6279296875],[115.2734375,36.498046875],[115.3466796875,36.390625],[115.419921875,36.2890625],[115.484375,36.1494140625],[115.3662109375,36.099609375],[115.2421875,36.19140625],[115.10546875,36.1728515625],[114.9990234375,36.0703125],[114.771484375,36.125],[114.5888671875,36.119140625],[114.3564453125,36.23046875],[114.2119140625,36.2734375],[114.068359375,36.2734375],[113.9775390625,36.3583984375],[113.818359375,36.33203125],[113.732421875,36.3642578125]]]]}},{"type":"Feature","properties":{"name":"山西"},"geometry":{"type":"Polygon","coordinates":[[[114.134765625,40.73828125],[114.2119140625,40.6240234375],[114.2978515625,40.5380859375],[114.314453125,40.3701171875],[114.447265625,40.373046875],[114.255859375,40.236328125],[114.13671875,40.17578125],[114.0439453125,40.0576171875],[113.9111328125,40.0126953125],[114.0478515625,39.9169921875],[114.1748046875,39.8984375],[114.2890625,39.8583984375],[114.4150390625,39.640625],[114.515625,39.5654296875],[114.4716796875,39.4091796875],[114.4384765625,39.2607421875],[114.3466796875,39.076171875],[114.109375,39.052734375],[113.77734375,38.9873046875],[113.8564453125,38.8291015625],[113.763671875,38.7021484375],[113.61328125,38.646484375],[113.5595703125,38.4931640625],[113.5576171875,38.34375],[113.7138671875,38.2138671875],[113.833984375,38.1669921875],[113.8623046875,38.0009765625],[113.95703125,37.912109375],[114.0458984375,37.7724609375],[114.140625,37.6767578125],[114.037109375,37.4951171875],[113.9599609375,37.349609375],[113.88671875,37.2392578125],[113.767578125,37.1455078125],[113.7724609375,37.017578125],[113.7919921875,36.875],[113.681640625,36.791015625],[113.537109375,36.732421875],[113.5400390625,36.5947265625],[113.708984375,36.423828125],[113.7177734375,36.265625],[113.7138671875,36.1337890625],[113.6865234375,35.9873046875],[113.6376953125,35.8701171875],[113.5927734375,35.693359375],[113.5068359375,35.56640625],[113.3486328125,35.46875],[113.1904296875,35.44921875],[113.1376953125,35.3359375],[112.9970703125,35.3623046875],[112.912109375,35.2470703125],[112.7734375,35.2080078125],[112.6357421875,35.265625],[112.40234375,35.2421875],[112.2431640625,35.2353515625],[112.0595703125,35.2802734375],[112.0673828125,35.15234375],[111.9521484375,35.0830078125],[111.81640625,35.068359375],[111.666015625,34.986328125],[111.5712890625,34.84375],[111.439453125,34.8388671875],[111.2900390625,34.806640625],[111.1611328125,34.8154296875],[110.9765625,34.70703125],[110.87109375,34.63671875],[110.70703125,34.6044921875],[110.541015625,34.58203125],[110.4169921875,34.587890625],[110.2890625,34.615234375],[110.259765625,34.75390625],[110.2568359375,34.9326171875],[110.39453125,35.2705078125],[110.4814453125,35.419921875],[110.609375,35.6328125],[110.5517578125,35.8759765625],[110.4501953125,36.1357421875],[110.4990234375,36.578125],[110.392578125,36.681640625],[110.419921875,36.798828125],[110.42578125,36.9580078125],[110.5302734375,37.107421875],[110.658203125,37.279296875],[110.642578125,37.4306640625],[110.7958984375,37.5625],[110.7041015625,37.712890625],[110.5947265625,37.9228515625],[110.5087890625,38.185546875],[110.5849609375,38.3046875],[110.7470703125,38.3662109375],[110.8779296875,38.45703125],[110.9208984375,38.578125],[111.0107421875,38.841796875],[110.982421875,38.978515625],[111.138671875,39.064453125],[111.248046875,39.30078125],[111.1201171875,39.3779296875],[111.3525390625,39.4267578125],[111.4296875,39.6171875],[111.662109375,39.6416015625],[111.7841796875,39.58984375],[111.9326171875,39.6123046875],[111.970703125,39.796875],[112.1767578125,40.052734375],[112.2333984375,40.1708984375],[112.462890625,40.2998046875],[112.7451171875,40.16796875],[112.8935546875,40.3271484375],[113.033203125,40.369140625],[113.251953125,40.4140625],[113.5380859375,40.341796875],[113.6806640625,40.4443359375],[113.794921875,40.5185546875],[113.94921875,40.517578125],[114.08203125,40.56640625],[114.064453125,40.7099609375],[114.134765625,40.73828125]]]}},{"type":"Feature","properties":{"name":"内蒙古"},"geometry":{"type":"MultiPolygon","coordinates":[[[[124.45703125,51.361328125],[124.6357421875,51.3271484375],[124.7724609375,51.390625],[124.943359375,51.4482421875],[125.0732421875,51.5537109375],[125.283203125,51.6376953125],[125.6962890625,51.337890625],[125.7578125,51.2275390625],[125.8681640625,51.1416015625],[125.994140625,51.119140625],[126.076171875,50.9658203125],[125.9970703125,50.8720703125],[125.8369140625,50.7939453125],[125.7880859375,50.6787109375],[125.8232421875,50.548828125],[125.6357421875,50.4453125],[125.513671875,50.41015625],[125.4638671875,50.2958984375],[125.3349609375,50.1650390625],[125.2529296875,50.0458984375],[125.2265625,49.9248046875],[125.0966796875,49.7958984375],[124.9775390625,49.9013671875],[124.82421875,49.8505859375],[124.7421875,49.76171875],[124.5439453125,49.6396484375],[124.3427734375,50.1884765625],[124.3759765625,50.30859375],[124.4169921875,50.4521484375],[124.3193359375,50.533203125],[124.1435546875,50.56640625],[124.2978515625,51.298828125],[124.45703125,51.361328125]]],[[[111.1259765625,39.3671875],[111.1455078125,39.5234375],[111.029296875,39.5703125],[110.869140625,39.494140625],[110.6884765625,39.267578125],[110.5224609375,39.3837890625],[110.3857421875,39.310546875],[110.2578125,39.4072265625],[110.146484375,39.4580078125],[110.21875,39.2802734375],[110.0107421875,39.208984375],[109.884765625,39.263671875],[109.9228515625,39.107421875],[109.6728515625,38.9970703125],[109.6259765625,38.84765625],[109.40234375,38.716796875],[109.330078125,38.59765625],[109.052734375,38.4326171875],[108.962890625,38.2685546875],[109.064453125,38.1005859375],[109.017578125,37.970703125],[108.8720703125,38.02734375],[108.7861328125,37.689453125],[108.6201171875,37.65234375],[108.3330078125,37.6337890625],[108.1474609375,37.6220703125],[108.0244140625,37.6513671875],[107.982421875,37.7880859375],[107.7412109375,37.845703125],[107.4931640625,37.9453125],[107.39453125,38.015625],[107.2431640625,38.111328125],[107.1220703125,38.1357421875],[106.9453125,38.1318359375],[106.7685546875,38.17578125],[106.4912109375,38.306640625],[106.6005859375,38.390625],[106.6630859375,38.6015625],[106.7099609375,38.7197265625],[106.955078125,38.94140625],[106.859375,39.1083984375],[106.796875,39.21484375],[106.7880859375,39.3671875],[106.6650390625,39.35546875],[106.509765625,39.271484375],[106.28515625,39.2705078125],[106.28515625,39.146484375],[106.146484375,39.1533203125],[106.0615234375,38.96875],[105.8974609375,38.7890625],[105.8525390625,38.6396484375],[105.8212890625,38.365234375],[105.8427734375,38.2412109375],[105.7685546875,38.134765625],[105.8408203125,38.0048828125],[105.806640625,37.8662109375],[105.68359375,37.7724609375],[105.3154296875,37.7021484375],[105.111328125,37.6337890625],[104.8671875,37.5673828125],[104.43359375,37.515625],[104.18359375,37.4072265625],[103.8720703125,37.6064453125],[103.6767578125,37.7841796875],[103.40234375,37.8623046875],[103.3623046875,38.0419921875],[103.53515625,38.1572265625],[103.5087890625,38.28125],[103.416015625,38.4052734375],[103.8603515625,38.64453125],[104.044921875,38.8955078125],[104.16796875,38.94140625],[104.2080078125,39.083984375],[104.0478515625,39.2978515625],[104.0908203125,39.419921875],[103.9560546875,39.4580078125],[103.357421875,39.3369140625],[103.0107421875,39.1005859375],[102.60546875,39.171875],[102.4541015625,39.255859375],[102.27734375,39.189453125],[101.833984375,39.095703125],[102.0751953125,38.8916015625],[101.9423828125,38.8095703125],[101.77734375,38.6611328125],[101.6064453125,38.6533203125],[101.3173828125,38.7841796875],[101.23828125,38.908203125],[100.9697265625,38.947265625],[100.830078125,39.0361328125],[100.8427734375,39.2041015625],[100.8427734375,39.40625],[100.5,39.4013671875],[100.3271484375,39.509765625],[100.2509765625,39.685546875],[100.1279296875,39.703125],[99.9052734375,39.7861328125],[99.6728515625,39.888671875],[99.44140625,39.88671875],[99.751953125,40.0078125],[99.8740234375,40.0263671875],[99.990234375,40.1884765625],[100.169921875,40.2783203125],[100.169921875,40.5419921875],[100.2373046875,40.7177734375],[100.1083984375,40.8759765625],[99.673828125,40.93359375],[99.56640625,40.84765625],[99.1748046875,40.8583984375],[99.1025390625,40.6767578125],[98.9853515625,40.783203125],[98.791015625,40.7060546875],[98.6689453125,40.7734375],[98.3447265625,40.5693359375],[98.333984375,40.919921875],[97.97265625,41.0986328125],[97.6171875,41.46484375],[97.84765625,41.6572265625],[97.1728515625,42.7958984375],[98.1962890625,42.6533203125],[99.5078125,42.568359375],[99.9697265625,42.6484375],[100.2734375,42.63671875],[100.86328125,42.671875],[101.5703125,42.525390625],[101.8046875,42.50390625],[102.076171875,42.224609375],[102.44921875,42.14453125],[102.712890625,42.1533203125],[103.4189453125,41.8828125],[103.857421875,41.8017578125],[104.080078125,41.8056640625],[104.5302734375,41.875],[104.5244140625,41.662109375],[104.923828125,41.654296875],[105.2314453125,41.751953125],[105.7421875,41.9501953125],[106.7861328125,42.2919921875],[107.2724609375,42.3642578125],[107.466796875,42.458984375],[107.939453125,42.404296875],[108.23828125,42.4609375],[108.533203125,42.443359375],[108.845703125,42.396484375],[109.0263671875,42.458984375],[109.2919921875,42.4365234375],[109.4873046875,42.458984375],[109.6845703125,42.5595703125],[109.90625,42.63671875],[110.109375,42.6435546875],[110.4375,42.7822265625],[110.6318359375,42.9365234375],[110.7373046875,43.08984375],[111.021484375,43.330078125],[111.3544921875,43.4365234375],[111.5654296875,43.4912109375],[111.794921875,43.6728515625],[111.951171875,43.693359375],[111.884765625,43.923828125],[111.7900390625,44.001953125],[111.6630859375,44.0615234375],[111.5595703125,44.171875],[111.4287109375,44.3203125],[111.478515625,44.4892578125],[111.5703125,44.5771484375],[111.625,44.779296875],[111.7646484375,44.9697265625],[111.904296875,45.052734375],[112.0712890625,45.0966796875],[112.4296875,45.0751953125],[112.541015625,45.001953125],[112.7998046875,44.8544921875],[113.1298828125,44.7978515625],[113.5048828125,44.7783203125],[113.6318359375,44.74609375],[113.7998046875,44.849609375],[113.908203125,44.916015625],[114.0654296875,44.931640625],[114.1787109375,45.037109375],[114.34765625,45.1201171875],[114.4599609375,45.2138671875],[114.5517578125,45.3876953125],[114.74609375,45.4384765625],[114.974609375,45.3779296875],[115.365234375,45.392578125],[115.7001953125,45.4599609375],[115.9375,45.6337890625],[116.1748046875,45.689453125],[116.287109375,45.775390625],[116.2724609375,45.966796875],[116.5859375,46.29296875],[116.7646484375,46.33203125],[117.09765625,46.357421875],[117.3720703125,46.3603515625],[117.4482421875,46.5283203125],[117.611328125,46.6005859375],[117.7197265625,46.517578125],[117.8408203125,46.53515625],[118.0576171875,46.6337890625],[118.2080078125,46.6884765625],[118.31640625,46.740234375],[118.447265625,46.705078125],[118.5859375,46.693359375],[118.7880859375,46.6875],[118.9150390625,46.775390625],[119.10546875,46.642578125],[119.263671875,46.6494140625],[119.375,46.603515625],[119.55859375,46.6337890625],[119.677734375,46.5849609375],[119.8046875,46.6826171875],[119.935546875,46.712890625],[119.9296875,46.904296875],[119.7958984375,47.013671875],[119.716796875,47.1962890625],[119.56640625,47.2490234375],[119.353515625,47.4326171875],[119.15234375,47.541015625],[119.134765625,47.6650390625],[118.7734375,47.771484375],[118.568359375,47.9921875],[118.4443359375,47.9951171875],[118.298828125,48.005859375],[118.1787109375,48.05078125],[118.0498046875,48.013671875],[117.8134765625,48.0166015625],[117.52734375,47.765625],[117.384765625,47.6416015625],[117.095703125,47.82421875],[116.818359375,47.8984375],[116.6708984375,47.890625],[116.453125,47.837890625],[116.2666015625,47.876953125],[116.1201171875,47.8173828125],[115.939453125,47.68359375],[115.5810546875,47.921875],[115.5302734375,48.1552734375],[115.8232421875,48.259765625],[115.802734375,48.5234375],[116.0791015625,48.8232421875],[116.7255859375,49.8564453125],[117.0693359375,49.6962890625],[117.2783203125,49.63671875],[117.4853515625,49.6337890625],[117.81640625,49.521484375],[117.951171875,49.5966796875],[118.080078125,49.615234375],[118.2060546875,49.685546875],[118.3896484375,49.78125],[118.4892578125,49.873046875],[118.9296875,49.990234375],[119.0927734375,49.986328125],[119.19140625,50.0888671875],[119.30859375,50.1611328125],[119.3251953125,50.283203125],[119.232421875,50.3662109375],[119.2353515625,50.5029296875],[119.3349609375,50.6416015625],[119.4990234375,50.748046875],[119.5029296875,50.8916015625],[119.599609375,50.9853515625],[119.7265625,51.05078125],[119.7890625,51.1708984375],[119.8798828125,51.296875],[119.9716796875,51.400390625],[120.052734375,51.5537109375],[120.0888671875,51.6796875],[120.3154296875,51.78515625],[120.474609375,51.8515625],[120.6572265625,51.9267578125],[120.7529296875,52.0791015625],[120.7451171875,52.2080078125],[120.638671875,52.3134765625],[120.6904296875,52.4296875],[120.7294921875,52.5458984375],[120.462890625,52.6455078125],[120.287109375,52.623046875],[120.06640625,52.58984375],[120.0322265625,52.7744140625],[120.1884765625,52.80859375],[120.296875,52.892578125],[120.4111328125,52.9580078125],[120.5595703125,53.08203125],[120.6953125,53.1474609375],[120.8388671875,53.240234375],[121.0478515625,53.2890625],[121.2353515625,53.28125],[121.5,53.337890625],[121.6806640625,53.2412109375],[121.7626953125,53.1396484375],[121.7880859375,53.021484375],[121.6630859375,52.9130859375],[121.4775390625,52.7724609375],[121.3828125,52.6875],[121.1826171875,52.5986328125],[121.32421875,52.57421875],[121.498046875,52.4853515625],[121.6484375,52.443359375],[121.71484375,52.318359375],[121.841796875,52.283203125],[122.1669921875,52.515625],[122.310546875,52.4755859375],[122.412109375,52.3759765625],[122.7880859375,52.2529296875],[122.62890625,52.13671875],[122.671875,51.9853515625],[122.7724609375,51.7802734375],[122.8564453125,51.607421875],[122.85546875,51.478515625],[122.962890625,51.39453125],[123.0703125,51.3212890625],[123.2783203125,51.2548828125],[123.4404296875,51.271484375],[123.662109375,51.3193359375],[123.794921875,51.361328125],[123.9267578125,51.30078125],[124.21875,51.3505859375],[124.1435546875,50.56640625],[123.984375,50.5107421875],[123.9208984375,50.373046875],[123.80078125,50.4560546875],[123.865234375,50.2861328125],[124.0107421875,50.220703125],[124.1923828125,50.216796875],[124.3427734375,50.1884765625],[124.5439453125,49.6396484375],[124.7333984375,49.6865234375],[124.82421875,49.8505859375],[124.97265625,49.8349609375],[125.095703125,49.796875],[125.2236328125,49.7998046875],[125.2216796875,49.6728515625],[125.236328125,49.5390625],[125.255859375,49.396484375],[125.2158203125,49.2802734375],[125.1181640625,49.126953125],[124.9833984375,49.1630859375],[124.8095703125,49.1162109375],[124.7568359375,48.9677734375],[124.697265625,48.8427734375],[124.61328125,48.748046875],[124.568359375,48.576171875],[124.5087890625,48.447265625],[124.580078125,48.3046875],[124.5107421875,48.16796875],[124.4169921875,48.0888671875],[124.421875,48.2470703125],[124.318359375,48.349609375],[124.314453125,48.50390625],[124.08203125,48.4384765625],[123.7470703125,48.1982421875],[123.5791015625,48.0458984375],[123.2978515625,47.9521484375],[123.1728515625,47.787109375],[122.8583984375,47.6787109375],[122.5751953125,47.5361328125],[122.5068359375,47.40234375],[122.6142578125,47.125],[122.748046875,47.0791015625],[122.802734375,46.9375],[122.9072265625,46.8076171875],[123.015625,46.7216796875],[123.171875,46.744140625],[123.2353515625,46.86328125],[123.375,46.837890625],[123.361328125,46.9716796875],[123.52734375,46.9599609375],[123.5048828125,46.828125],[123.6083984375,46.890625],[123.6318359375,46.7294921875],[123.2783203125,46.662109375],[123.0869140625,46.591796875],[123.0107421875,46.4365234375],[123.1787109375,46.2490234375],[123.11328125,46.130859375],[122.7939453125,46.0732421875],[122.8291015625,45.9130859375],[122.79296875,45.7666015625],[122.671875,45.701171875],[122.55859375,45.8212890625],[122.4462890625,45.9169921875],[122.337890625,45.8603515625],[122.201171875,45.857421875],[122.08203125,45.921875],[121.814453125,46.0263671875],[121.8173828125,45.8759765625],[121.64453125,45.75390625],[121.7578125,45.69140625],[121.94921875,45.7119140625],[121.9970703125,45.599609375],[122.1669921875,45.4423828125],[122.1474609375,45.2958984375],[122.23046875,45.20703125],[122.1103515625,45.142578125],[122.0751953125,45.0068359375],[122.07421875,44.8779296875],[122.169921875,44.7705078125],[122.1318359375,44.578125],[122.228515625,44.48046875],[122.2919921875,44.310546875],[122.4833984375,44.2373046875],[122.67578125,44.2861328125],[123.041015625,44.5],[123.142578125,44.4287109375],[123.2998046875,44.1953125],[123.3212890625,44.052734375],[123.4287109375,43.927734375],[123.4970703125,43.7861328125],[123.5380859375,43.634765625],[123.453125,43.546875],[123.3046875,43.55078125],[123.419921875,43.41015625],[123.5458984375,43.416015625],[123.7216796875,43.357421875],[123.677734375,43.224609375],[123.6279296875,43.0810546875],[123.47265625,43.04296875],[123.259765625,42.994140625],[123.1708984375,42.8525390625],[123.05859375,42.76953125],[122.8876953125,42.7705078125],[122.7314453125,42.787109375],[122.5810546875,42.7900390625],[122.4306640625,42.84375],[122.3955078125,42.6845703125],[122.205078125,42.7333984375],[122.064453125,42.7236328125],[121.9033203125,42.6376953125],[121.83203125,42.5341796875],[121.7021484375,42.4404296875],[121.607421875,42.5166015625],[121.416015625,42.486328125],[121.28515625,42.388671875],[121.0693359375,42.2529296875],[120.8876953125,42.2724609375],[120.74609375,42.2236328125],[120.625,42.1552734375],[120.482421875,42.1162109375],[120.4111328125,41.9970703125],[120.2724609375,41.92578125],[120.1259765625,41.7685546875],[119.990234375,41.8994140625],[119.84375,42.1005859375],[119.744140625,42.2119140625],[119.6171875,42.2529296875],[119.5029296875,42.388671875],[119.28515625,42.265625],[119.3154296875,42.1201171875],[119.3251953125,41.9697265625],[119.291015625,41.7841796875],[119.3134765625,41.640625],[119.419921875,41.5693359375],[119.3759765625,41.421875],[119.2998046875,41.3291015625],[118.9501953125,41.318359375],[118.84375,41.375],[118.5283203125,41.35546875],[118.400390625,41.3115234375],[118.349609375,41.4287109375],[118.3125,41.5673828125],[118.21484375,41.642578125],[118.130859375,41.7431640625],[118.2314453125,41.8125],[118.3408203125,41.873046875],[118.23828125,42.0234375],[118.1171875,42.0380859375],[118.1064453125,42.1728515625],[117.9697265625,42.2421875],[118.01953125,42.3955078125],[117.802734375,42.580078125],[117.4736328125,42.6025390625],[117.3876953125,42.517578125],[117.095703125,42.484375],[116.9150390625,42.4033203125],[116.9150390625,42.197265625],[116.7900390625,42.201171875],[116.884765625,42.111328125],[116.8017578125,41.978515625],[116.640625,41.9306640625],[116.4970703125,41.98046875],[116.328125,42.005859375],[116.224609375,41.9326171875],[116.1083984375,41.8515625],[115.9169921875,41.9453125],[115.7666015625,41.8896484375],[115.6484375,41.8251953125],[115.3369140625,41.7099609375],[115.240234375,41.5771484375],[115.099609375,41.6240234375],[114.9462890625,41.6142578125],[114.869140625,41.814453125],[114.93359375,41.9443359375],[114.861328125,42.0556640625],[114.751953125,42.1162109375],[114.560546875,42.1328125],[114.466796875,42.0390625],[114.353515625,41.9541015625],[114.201171875,41.7900390625],[114.259765625,41.6240234375],[114.041015625,41.5341796875],[113.8720703125,41.416015625],[113.95703125,41.287109375],[113.9150390625,41.1708984375],[113.8193359375,41.09765625],[113.9638671875,40.9931640625],[114.07421875,40.857421875],[114.134765625,40.73828125],[114.0419921875,40.609375],[113.94921875,40.517578125],[113.794921875,40.5185546875],[113.5068359375,40.3359375],[113.31640625,40.3203125],[112.990234375,40.3583984375],[112.849609375,40.2080078125],[112.462890625,40.2998046875],[112.310546875,40.2568359375],[112.232421875,40.1337890625],[111.970703125,39.796875],[111.923828125,39.6640625],[111.7841796875,39.58984375],[111.662109375,39.6416015625],[111.498046875,39.662109375],[111.431640625,39.5087890625],[111.1748046875,39.4248046875],[111.1259765625,39.3671875]]]]}},{"type":"Feature","properties":{"name":"辽宁"},"geometry":{"type":"MultiPolygon","coordinates":[[[[120.787109375,40.4736328125],[120.79296875,40.515625],[120.8310546875,40.515625]]],[[[123.0654296875,39.4873046875],[123.05859375,39.509765625],[123.0654296875,39.4873046875]]],[[[121.4775390625,39.1875],[121.4453125,39.205078125],[121.4775390625,39.1875]]],[[[123.1611328125,39.0263671875],[123.142578125,39.0888671875],[123.1748046875,39.0869140625]]],[[[122.384765625,39.19921875],[122.4033203125,39.1640625],[122.369140625,39.17578125]]],[[[123.716796875,39.74609375],[123.7314453125,39.7666015625],[123.7568359375,39.7548828125]]],[[[123.0869140625,39.427734375],[123.0546875,39.4580078125],[123.1015625,39.4453125]]],[[[122.640625,39.2265625],[122.63671875,39.2421875],[122.740234375,39.2490234375]]],[[[122.5126953125,39.2236328125],[122.4921875,39.2353515625],[122.5498046875,39.236328125]]],[[[122.423828125,39.271484375],[122.45703125,39.2587890625],[122.423828125,39.271484375]]],[[[122.34375,39.3466796875],[122.349609375,39.3310546875],[122.3203125,39.328125]]],[[[122.826171875,39.0595703125],[122.8408203125,39.0478515625],[122.81640625,39.0458984375]]],[[[123.0234375,39.546875],[123.037109375,39.533203125],[122.99609375,39.49609375]]],[[[122.873046875,39.0556640625],[122.8505859375,39.0712890625],[122.873046875,39.0556640625]]],[[[122.5673828125,39.2744140625],[122.6904296875,39.2724609375],[122.5673828125,39.2744140625]]],[[[119.8544921875,39.9892578125],[119.7724609375,40.0830078125],[119.74609375,40.2080078125],[119.625,40.2255859375],[119.60546875,40.455078125],[119.27734375,40.53515625],[119.158203125,40.6044921875],[118.98828125,40.6982421875],[118.8466796875,40.8095703125],[118.90234375,40.9619140625],[119.0205078125,40.998046875],[119.08203125,41.1318359375],[119.1650390625,41.21875],[119.2412109375,41.3193359375],[119.375,41.4208984375],[119.3623046875,41.56640625],[119.2998046875,41.7109375],[119.3349609375,41.8701171875],[119.375,42.021484375],[119.2783203125,42.185546875],[119.4326171875,42.3173828125],[119.572265625,42.3603515625],[119.744140625,42.2119140625],[119.84375,42.1005859375],[119.951171875,41.974609375],[120.0234375,41.8173828125],[120.0966796875,41.697265625],[120.1884765625,41.8486328125],[120.318359375,41.9345703125],[120.45703125,42.015625],[120.5849609375,42.16796875],[120.74609375,42.2236328125],[120.888671875,42.2431640625],[121.0693359375,42.2529296875],[121.2197265625,42.3720703125],[121.3857421875,42.4521484375],[121.5693359375,42.4873046875],[121.7021484375,42.4404296875],[121.818359375,42.5048828125],[121.91796875,42.5888671875],[121.9658203125,42.701171875],[122.1962890625,42.6796875],[122.337890625,42.6708984375],[122.4580078125,42.7744140625],[122.5810546875,42.7900390625],[122.7314453125,42.787109375],[122.85546875,42.70703125],[122.9892578125,42.779296875],[123.22265625,42.826171875],[123.259765625,42.994140625],[123.47265625,43.04296875],[123.6123046875,43.0498046875],[123.6484375,43.173828125],[123.7001953125,43.3115234375],[123.75,43.439453125],[123.873046875,43.4521484375],[123.947265625,43.3525390625],[124.1015625,43.294921875],[124.216796875,43.2568359375],[124.29296875,43.1552734375],[124.4267578125,43.0771484375],[124.333984375,42.998046875],[124.4404296875,42.87890625],[124.66015625,42.9736328125],[124.75,43.0703125],[124.896484375,43.130859375],[124.8759765625,42.96875],[124.873046875,42.7919921875],[124.9970703125,42.74609375],[125.0302734375,42.6171875],[125.0673828125,42.5029296875],[125.1962890625,42.4111328125],[125.2998046875,42.2900390625],[125.306640625,42.146484375],[125.490234375,42.13671875],[125.3701171875,42.0029296875],[125.296875,41.8876953125],[125.3466796875,41.7626953125],[125.451171875,41.6748046875],[125.5078125,41.5341796875],[125.548828125,41.4013671875],[125.6474609375,41.265625],[125.73828125,41.1796875],[125.6845703125,41.0224609375],[125.58984375,40.931640625],[125.7080078125,40.8671875],[125.6181640625,40.763671875],[125.486328125,40.7275390625],[125.3759765625,40.6591796875],[125.1904296875,40.615234375],[125.0478515625,40.55078125],[124.93359375,40.45703125],[124.7451171875,40.375],[124.6162109375,40.2880859375],[124.3515625,40.083984375],[124.298828125,39.9697265625],[124.2138671875,39.8642578125],[124.1513671875,39.74609375],[123.9990234375,39.80078125],[123.8212890625,39.83203125],[123.6923828125,39.8076171875],[123.548828125,39.755859375],[123.3935546875,39.724609375],[123.25,39.7509765625],[123.142578125,39.6455078125],[123.0166015625,39.658203125],[122.8564453125,39.607421875],[122.689453125,39.5166015625],[122.533203125,39.4208984375],[122.3671875,39.390625],[122.248046875,39.271484375],[122.1181640625,39.21484375],[122.05078125,39.1083984375],[121.9130859375,39.060546875],[121.833984375,38.951171875],[121.673828125,39.0107421875],[121.6982421875,38.865234375],[121.568359375,38.8759765625],[121.3408203125,38.8193359375],[121.1943359375,38.720703125],[121.111328125,38.8623046875],[121.2216796875,38.94140625],[121.34375,38.98828125],[121.4716796875,39.0263671875],[121.6259765625,39.1201171875],[121.6416015625,39.2431640625],[121.724609375,39.365234375],[121.5087890625,39.29296875],[121.3251953125,39.3720703125],[121.28515625,39.5078125],[121.451171875,39.6259765625],[121.4892578125,39.765625],[121.6201171875,39.8798828125],[121.7763671875,39.9384765625],[121.884765625,40.0537109375],[121.99609375,40.12890625],[121.9365234375,40.23828125],[122.0400390625,40.322265625],[122.1787109375,40.3662109375],[122.2802734375,40.478515625],[122.1455078125,40.595703125],[121.9521484375,40.681640625],[121.853515625,40.8212890625],[121.693359375,40.83203125],[121.5537109375,40.818359375],[121.3359375,40.9013671875],[121.216796875,40.8515625],[121.078125,40.818359375],[120.9814453125,40.7470703125],[120.837890625,40.6787109375],[120.728515625,40.5400390625],[120.619140625,40.4609375],[120.5322265625,40.3212890625],[120.474609375,40.18359375],[120.134765625,40.0751953125],[119.9560546875,40.046875],[119.8544921875,39.9892578125]]]]}},{"type":"Feature","properties":{"name":"吉林"},"geometry":{"type":"Polygon","coordinates":[[[127.14453125,41.53125],[127.0400390625,41.6728515625],[126.9365234375,41.7763671875],[126.8095703125,41.75],[126.6875,41.732421875],[126.6064453125,41.640625],[126.541015625,41.5244140625],[126.498046875,41.4072265625],[126.2890625,41.1904296875],[126.1240234375,41.091796875],[126.0830078125,40.9765625],[125.9765625,40.9130859375],[125.8134765625,40.8671875],[125.65625,40.916015625],[125.740234375,41.0869140625],[125.75,41.24609375],[125.6201171875,41.318359375],[125.54296875,41.46875],[125.4501953125,41.5986328125],[125.3173828125,41.677734375],[125.294921875,41.82421875],[125.29296875,41.9638671875],[125.423828125,42.0791015625],[125.306640625,42.146484375],[125.2998046875,42.2900390625],[125.17578125,42.30859375],[125.0673828125,42.5029296875],[125.09765625,42.623046875],[124.9658203125,42.677734375],[124.974609375,42.8037109375],[124.849609375,42.8828125],[124.8408203125,43.029296875],[124.693359375,43.056640625],[124.4560546875,42.82421875],[124.4423828125,42.9599609375],[124.29296875,43.1552734375],[124.216796875,43.2568359375],[124.1015625,43.294921875],[123.947265625,43.3525390625],[123.873046875,43.4521484375],[123.7470703125,43.4716796875],[123.609375,43.3671875],[123.4873046875,43.4462890625],[123.31640625,43.4921875],[123.4541015625,43.546875],[123.5380859375,43.634765625],[123.4970703125,43.7861328125],[123.37109375,43.970703125],[123.390625,44.1630859375],[123.197265625,44.345703125],[123.125,44.509765625],[122.7607421875,44.3701171875],[122.4833984375,44.2373046875],[122.3203125,44.2333984375],[122.2861328125,44.478515625],[122.1318359375,44.578125],[122.162109375,44.728515625],[122.07421875,44.8779296875],[122.0751953125,45.0068359375],[122.1103515625,45.142578125],[122.23046875,45.20703125],[122.1474609375,45.2958984375],[122.1669921875,45.4423828125],[122.0029296875,45.5087890625],[121.94921875,45.7119140625],[121.8115234375,45.6875],[121.6865234375,45.712890625],[121.76953125,45.84375],[121.8095703125,45.9619140625],[122.0048828125,45.9853515625],[122.091796875,45.8828125],[122.2587890625,45.794921875],[122.3740234375,45.8564453125],[122.49609375,45.8583984375],[122.640625,45.771484375],[122.7421875,45.7060546875],[122.75390625,45.837890625],[122.7939453125,46.0732421875],[123.0458984375,46.1005859375],[123.12890625,46.2109375],[123.3740234375,46.2236328125],[123.5,46.259765625],[123.7802734375,46.2646484375],[123.90625,46.30078125],[123.974609375,46.166015625],[124.041015625,46.025390625],[123.9970703125,45.9072265625],[124.0654296875,45.7978515625],[124.1357421875,45.69140625],[124.2275390625,45.599609375],[124.359375,45.544921875],[124.474609375,45.458984375],[124.6396484375,45.435546875],[124.7685546875,45.4697265625],[124.923828125,45.5419921875],[125.05078125,45.4287109375],[125.3017578125,45.40234375],[125.4345703125,45.458984375],[125.62890625,45.5224609375],[125.716796875,45.4033203125],[125.751953125,45.2880859375],[125.916015625,45.197265625],[126.236328125,45.140625],[126.353515625,45.185546875],[126.5732421875,45.2529296875],[126.6865234375,45.1884765625],[126.9609375,45.1376953125],[127.09375,44.9462890625],[126.984375,44.8251953125],[127.041015625,44.7158203125],[127.0498046875,44.5673828125],[127.1669921875,44.642578125],[127.4013671875,44.634765625],[127.556640625,44.576171875],[127.46484375,44.4814453125],[127.6220703125,44.283203125],[127.681640625,44.1669921875],[127.7841796875,44.072265625],[127.9130859375,44.0654296875],[128.1015625,44.13671875],[128.064453125,44.2607421875],[128.16796875,44.3447265625],[128.373046875,44.5146484375],[128.462890625,44.4345703125],[128.4755859375,44.3115234375],[128.47265625,44.158203125],[128.5751953125,44.0478515625],[128.63671875,43.8916015625],[128.759765625,43.8623046875],[128.7294921875,43.73828125],[128.8349609375,43.587890625],[129.013671875,43.5234375],[129.2255859375,43.587890625],[129.232421875,43.7099609375],[129.357421875,43.798828125],[129.46875,43.875],[129.7431640625,43.876953125],[129.939453125,44.0283203125],[130.0263671875,43.9443359375],[130.080078125,43.8359375],[130.1904296875,43.94140625],[130.34765625,44.0517578125],[130.3837890625,43.9072265625],[130.3798828125,43.7822265625],[130.4140625,43.65234375],[130.6318359375,43.623046875],[130.79296875,43.5283203125],[130.908203125,43.4345703125],[131.142578125,43.4267578125],[131.322265625,43.49609375],[131.2763671875,43.369140625],[131.203125,43.228515625],[131.16796875,43.1015625],[131.1181640625,42.97265625],[131.0439453125,42.86328125],[130.8916015625,42.853515625],[130.66796875,42.8486328125],[130.40234375,42.728515625],[130.529296875,42.7041015625],[130.6337890625,42.5908203125],[130.640625,42.4228515625],[130.5322265625,42.5517578125],[130.388671875,42.603515625],[130.2578125,42.7109375],[130.267578125,42.9033203125],[130.1171875,42.9140625],[129.9619140625,42.98046875],[129.84765625,42.9189453125],[129.765625,42.72265625],[129.7421875,42.5810546875],[129.7109375,42.4296875],[129.587890625,42.44921875],[129.453125,42.44140625],[129.3125,42.421875],[129.205078125,42.3193359375],[129.12109375,42.142578125],[128.96875,42.0966796875],[128.7509765625,42.05078125],[128.607421875,42.0302734375],[128.291015625,42.02734375],[128.0908203125,42.0234375],[128.109375,41.8076171875],[128.26953125,41.6689453125],[128.3017578125,41.5400390625],[128.2080078125,41.412109375],[128.0908203125,41.375],[127.9375,41.458984375],[127.7939453125,41.408203125],[127.658203125,41.4296875],[127.5478515625,41.4775390625],[127.4169921875,41.4609375],[127.255859375,41.484375],[127.14453125,41.53125]]]}},{"type":"Feature","properties":{"name":"黑龙江"},"geometry":{"type":"MultiPolygon","coordinates":[[[[124.1435546875,50.56640625],[124.3193359375,50.533203125],[124.439453125,50.54296875],[124.4404296875,50.3857421875],[124.34765625,50.2900390625],[124.1923828125,50.216796875],[124.0625,50.19921875],[123.8798828125,50.208984375],[123.7783203125,50.3427734375],[123.9208984375,50.373046875],[123.984375,50.5107421875],[124.1435546875,50.56640625]]],[[[131.3046875,43.5029296875],[131.142578125,43.4267578125],[131.02734375,43.5087890625],[130.908203125,43.4345703125],[130.79296875,43.5283203125],[130.6259765625,43.5859375],[130.4140625,43.65234375],[130.3798828125,43.7822265625],[130.3837890625,43.9072265625],[130.34765625,44.0517578125],[130.2626953125,43.9501953125],[130.080078125,43.8359375],[130.0263671875,43.9443359375],[129.939453125,44.0283203125],[129.783203125,43.9638671875],[129.46875,43.875],[129.357421875,43.798828125],[129.2119140625,43.783203125],[129.2255859375,43.587890625],[129.013671875,43.5234375],[128.87890625,43.541015625],[128.7861328125,43.71484375],[128.71875,43.818359375],[128.640625,43.9482421875],[128.47265625,44.158203125],[128.4755859375,44.3115234375],[128.462890625,44.4345703125],[128.373046875,44.5146484375],[128.2236328125,44.443359375],[128.0732421875,44.375],[128.10546875,44.2158203125],[127.9130859375,44.0654296875],[127.7841796875,44.072265625],[127.720703125,44.203125],[127.5908203125,44.228515625],[127.484375,44.40234375],[127.54296875,44.5263671875],[127.4013671875,44.634765625],[127.2783203125,44.6416015625],[127.140625,44.6083984375],[127.041015625,44.7158203125],[126.984375,44.8251953125],[127.07421875,44.908203125],[126.9716796875,45.0712890625],[126.79296875,45.1357421875],[126.5732421875,45.2529296875],[126.42578125,45.2353515625],[126.29296875,45.1923828125],[125.9990234375,45.1630859375],[125.818359375,45.2412109375],[125.6962890625,45.3525390625],[125.7021484375,45.501953125],[125.498046875,45.4697265625],[125.3623046875,45.3935546875],[125.1494140625,45.4130859375],[125.029296875,45.4931640625],[124.884765625,45.49609375],[124.6396484375,45.435546875],[124.474609375,45.458984375],[124.3525390625,45.4931640625],[124.271484375,45.58984375],[124.1474609375,45.6240234375],[124.0029296875,45.771484375],[124.05859375,45.8896484375],[123.970703125,45.9716796875],[123.9951171875,46.1015625],[123.9833984375,46.224609375],[123.8505859375,46.302734375],[123.60546875,46.251953125],[123.4541015625,46.2333984375],[123.2490234375,46.2734375],[123.0107421875,46.4365234375],[123.0029296875,46.5751953125],[123.181640625,46.6142578125],[123.6044921875,46.6904296875],[123.630859375,46.8115234375],[123.5068359375,46.8271484375],[123.52734375,46.9599609375],[123.3017578125,47],[123.4052734375,46.935546875],[123.3408203125,46.8271484375],[123.171875,46.744140625],[123.015625,46.7216796875],[122.9072265625,46.8076171875],[122.8955078125,46.9609375],[122.775390625,46.974609375],[122.8525390625,47.072265625],[122.6142578125,47.125],[122.4189453125,47.3505859375],[122.5751953125,47.5361328125],[122.7646484375,47.6142578125],[123.1728515625,47.787109375],[123.2978515625,47.9521484375],[123.5791015625,48.0458984375],[123.7470703125,48.1982421875],[124.08203125,48.4384765625],[124.259765625,48.537109375],[124.33203125,48.43359375],[124.3564453125,48.3154296875],[124.41015625,48.1923828125],[124.53125,48.1484375],[124.5810546875,48.2607421875],[124.51953125,48.3779296875],[124.5341796875,48.5126953125],[124.603515625,48.6357421875],[124.6552734375,48.779296875],[124.7080078125,48.9189453125],[124.82421875,49.046875],[124.9072265625,49.1845703125],[125.0400390625,49.1767578125],[125.2216796875,49.19140625],[125.2763671875,49.3623046875],[125.228515625,49.4873046875],[125.1748046875,49.630859375],[125.2275390625,49.79296875],[125.1845703125,49.95703125],[125.296875,50.009765625],[125.302734375,50.1396484375],[125.46484375,50.2294921875],[125.546875,50.359375],[125.6357421875,50.4453125],[125.7578125,50.5087890625],[125.7880859375,50.6787109375],[125.8369140625,50.7939453125],[125.951171875,50.859375],[126.076171875,50.96484375],[125.9765625,51.0849609375],[125.8681640625,51.140625],[125.7578125,51.2275390625],[125.6962890625,51.337890625],[125.3701171875,51.6142578125],[125.130859375,51.6357421875],[125.0595703125,51.5390625],[124.927734375,51.4970703125],[124.876953125,51.3837890625],[124.73046875,51.3466796875],[124.5751953125,51.37109375],[124.4375,51.3544921875],[124.345703125,51.2734375],[124.2255859375,51.3505859375],[123.9267578125,51.30078125],[123.794921875,51.361328125],[123.662109375,51.3193359375],[123.4404296875,51.271484375],[123.2783203125,51.2548828125],[123.0703125,51.3212890625],[122.962890625,51.39453125],[122.85546875,51.478515625],[122.8564453125,51.607421875],[122.75,51.744140625],[122.70703125,51.890625],[122.6513671875,52.0595703125],[122.73828125,52.154296875],[122.478515625,52.296875],[122.34375,52.4130859375],[122.2080078125,52.4697265625],[122.0810546875,52.4404296875],[121.9482421875,52.298828125],[121.71484375,52.318359375],[121.6484375,52.443359375],[121.51953125,52.45703125],[121.35546875,52.53515625],[121.1826171875,52.5966796875],[121.310546875,52.6767578125],[121.4775390625,52.7724609375],[121.591796875,52.8251953125],[121.7119140625,52.9951171875],[121.818359375,53.0625],[121.658203125,53.177734375],[121.5,53.337890625],[121.876953125,53.4267578125],[122.09765625,53.423828125],[122.244140625,53.4638671875],[122.435546875,53.4453125],[122.6083984375,53.4658203125],[122.845703125,53.4580078125],[123.0615234375,53.5087890625],[123.28125,53.564453125],[123.458984375,53.5361328125],[123.61328125,53.5517578125],[123.89453125,53.4814453125],[124.01953125,53.3994140625],[124.251953125,53.376953125],[124.4365234375,53.224609375],[124.6884765625,53.2060546875],[124.8330078125,53.1455078125],[124.986328125,53.197265625],[125.142578125,53.205078125],[125.4931640625,53.1015625],[125.6201171875,53.08203125],[125.751953125,52.986328125],[125.6708984375,52.8642578125],[125.8369140625,52.8994140625],[125.966796875,52.7607421875],[126.1171875,52.7685546875],[125.9873046875,52.6708984375],[126.0947265625,52.599609375],[126.20703125,52.5361328125],[126.3544921875,52.3896484375],[126.4375,52.296875],[126.3271484375,52.2470703125],[126.5625,52.1318359375],[126.451171875,52.0283203125],[126.5107421875,51.9228515625],[126.666015625,51.7373046875],[126.7412109375,51.642578125],[126.8427734375,51.533203125],[126.9248046875,51.3876953125],[126.826171875,51.2734375],[126.982421875,51.3271484375],[126.900390625,51.201171875],[126.923828125,51.0625],[127.1142578125,50.9384765625],[127.236328125,50.7822265625],[127.294921875,50.6640625],[127.294921875,50.4716796875],[127.341796875,50.328125],[127.609375,50.23046875],[127.4970703125,50.0419921875],[127.529296875,49.85546875],[127.66796875,49.7763671875],[127.8291015625,49.58984375],[128.001953125,49.5927734375],[128.1865234375,49.5400390625],[128.34375,49.5458984375],[128.5380859375,49.6044921875],[128.7158203125,49.5654296875],[128.888671875,49.4912109375],[129.013671875,49.4580078125],[129.103515625,49.3564453125],[129.2333984375,49.4013671875],[129.3583984375,49.3564453125],[129.5185546875,49.423828125],[129.57421875,49.2880859375],[129.73046875,49.2890625],[129.8544921875,49.1787109375],[129.9296875,49.0458984375],[130.23828125,48.869140625],[130.4453125,48.91015625],[130.6806640625,48.8818359375],[130.5390625,48.6123046875],[130.625,48.494140625],[130.767578125,48.5087890625],[130.8466796875,48.30078125],[130.7666015625,48.189453125],[130.6669921875,48.10546875],[130.8916015625,47.927734375],[130.9619140625,47.828125],[130.9990234375,47.7060546875],[131.2373046875,47.7333984375],[131.4560546875,47.748046875],[131.568359375,47.6826171875],[131.7138671875,47.7119140625],[131.970703125,47.671875],[132.2431640625,47.7109375],[132.55859375,47.71875],[132.6875,47.8857421875],[132.8193359375,47.9375],[133.0029296875,48.041015625],[133.103515625,48.1298828125],[133.302734375,48.103515625],[133.53125,48.1171875],[133.693359375,48.1875],[134.00390625,48.3056640625],[134.1318359375,48.3359375],[134.3505859375,48.37890625],[134.5224609375,48.419921875],[134.697265625,48.4072265625],[134.91015625,48.4482421875],[135.087890625,48.4501953125],[134.6796875,48.2568359375],[134.5517578125,48.033203125],[134.6083984375,47.91015625],[134.7734375,47.763671875],[134.6845703125,47.6328125],[134.5771484375,47.51953125],[134.3154296875,47.43359375],[134.177734375,47.3271484375],[134.23046875,47.1826171875],[134.1435546875,47.09375],[134.064453125,46.98046875],[134.0224609375,46.8271484375],[134.015625,46.64453125],[133.849609375,46.4755859375],[133.9501953125,46.3994140625],[133.91796875,46.265625],[133.783203125,46.18359375],[133.6875,45.9990234375],[133.595703125,45.873046875],[133.46875,45.8359375],[133.4306640625,45.69921875],[133.41015625,45.5693359375],[133.203125,45.5166015625],[133.1484375,45.3779296875],[133.0947265625,45.2568359375],[133.1396484375,45.1279296875],[132.9541015625,45.0185546875],[132.00390625,45.2548828125],[131.91796875,45.33984375],[131.78515625,45.2373046875],[131.6513671875,45.16015625],[131.4853515625,44.99609375],[131.3583984375,44.9912109375],[131.2080078125,44.9140625],[130.9677734375,44.8544921875],[131.1123046875,44.7109375],[131.310546875,44.0478515625],[131.2109375,43.787109375],[131.2392578125,43.669921875],[131.2275390625,43.517578125],[131.3046875,43.5029296875]]]]}},{"type":"Feature","properties":{"name":"江苏"},"geometry":{"type":"Polygon","coordinates":[[[118.88671875,31.51953125],[118.8037109375,31.6201171875],[118.658203125,31.6416015625],[118.6279296875,31.759765625],[118.482421875,31.779296875],[118.3642578125,31.9326171875],[118.3857421875,32.0615234375],[118.5009765625,32.12109375],[118.64453125,32.2109375],[118.7080078125,32.3349609375],[118.69140625,32.47265625],[118.5654296875,32.5625],[118.6904296875,32.5888671875],[118.8232421875,32.6044921875],[118.9375,32.5576171875],[119.0859375,32.453125],[119.177734375,32.5947265625],[119.185546875,32.826171875],[119.0458984375,32.912109375],[118.8544921875,32.958984375],[118.7421875,32.853515625],[118.71484375,32.7197265625],[118.5771484375,32.7197265625],[118.453125,32.744140625],[118.33203125,32.76171875],[118.234375,32.9248046875],[118.2333984375,33.060546875],[118.2119140625,33.19921875],[118.0390625,33.1357421875],[117.9384765625,33.23046875],[117.970703125,33.3486328125],[118.05078125,33.4921875],[118.1123046875,33.6171875],[118.1865234375,33.7451171875],[118.068359375,33.7666015625],[117.9501953125,33.734375],[117.826171875,33.73828125],[117.7587890625,33.8857421875],[117.6708984375,33.9951171875],[117.515625,34.0615234375],[117.353515625,34.08984375],[117.193359375,34.0693359375],[117.0478515625,34.15234375],[116.9697265625,34.2841796875],[116.91015625,34.4091796875],[116.7607421875,34.462890625],[116.5732421875,34.490234375],[116.4296875,34.6533203125],[116.408203125,34.8515625],[116.6318359375,34.94140625],[116.771484375,34.9169921875],[116.9765625,34.87109375],[117.05078125,34.771484375],[117.06640625,34.6484375],[117.17578125,34.470703125],[117.36328125,34.58984375],[117.48828125,34.466796875],[117.6591796875,34.501953125],[117.802734375,34.51953125],[117.7939453125,34.65234375],[117.955078125,34.6796875],[118.095703125,34.654296875],[118.185546875,34.544921875],[118.1708984375,34.3818359375],[118.2919921875,34.42578125],[118.4404296875,34.5087890625],[118.4755859375,34.6240234375],[118.6005859375,34.7158203125],[118.7841796875,34.72265625],[118.767578125,34.8447265625],[118.859375,34.94140625],[119.1171875,35.0556640625],[119.287109375,35.115234375],[119.2119140625,34.982421875],[119.2392578125,34.7998046875],[119.37890625,34.7646484375],[119.5029296875,34.7548828125],[119.3759765625,34.759765625],[119.5263671875,34.7333984375],[119.5830078125,34.599609375],[119.8125,34.486328125],[119.962890625,34.458984375],[120.3125,34.3076171875],[120.3681640625,34.091796875],[120.5712890625,33.703125],[120.716796875,33.419921875],[120.8330078125,33.2822265625],[120.8525390625,33.076171875],[120.9267578125,32.880859375],[120.966796875,32.75390625],[120.9169921875,32.642578125],[121.1533203125,32.529296875],[121.41796875,32.443359375],[121.4736328125,32.138671875],[121.759765625,32.0595703125],[121.8564453125,31.9560546875],[121.970703125,31.7197265625],[121.59375,31.705078125],[121.431640625,31.76953125],[121.31640625,31.8720703125],[121.201171875,31.8359375],[121.373046875,31.5537109375],[121.248046875,31.4775390625],[121.107421875,31.35546875],[121.0693359375,31.1494140625],[120.87890625,31.1337890625],[120.8916015625,31.00390625],[120.74609375,30.962890625],[120.6552734375,30.84765625],[120.50390625,30.7587890625],[120.435546875,30.9208984375],[120.236328125,30.92578125],[120.0009765625,31.0283203125],[119.919921875,31.1708984375],[119.7802734375,31.1796875],[119.58203125,31.109375],[119.4609375,31.1572265625],[119.380859375,31.267578125],[119.2392578125,31.2548828125],[119.10546875,31.2353515625],[118.7958984375,31.2294921875],[118.755859375,31.38671875],[118.88671875,31.51953125]]]}},{"type":"Feature","properties":{"name":"浙江"},"geometry":{"type":"MultiPolygon","coordinates":[[[[122.6484375,30.8134765625],[122.6455078125,30.828125],[122.6630859375,30.8193359375]]],[[[122.8369140625,30.69921875],[122.8046875,30.7197265625],[122.81640625,30.734375]]],[[[122.7822265625,30.6943359375],[122.7568359375,30.712890625],[122.79296875,30.7294921875]]],[[[122.5712890625,30.64453125],[122.546875,30.65234375],[122.560546875,30.6796875]]],[[[122.2880859375,29.724609375],[122.248046875,29.7333984375],[122.21484375,29.78125]]],[[[122.1826171875,29.408203125],[122.1806640625,29.4248046875],[122.2255859375,29.4384765625]]],[[[121.8896484375,28.4716796875],[121.87109375,28.5009765625],[121.8974609375,28.5146484375]]],[[[121.5029296875,28.072265625],[121.529296875,28.1025390625],[121.5029296875,28.072265625]]],[[[121.1865234375,27.9638671875],[121.177734375,27.9912109375],[121.2412109375,27.994140625]]],[[[121.0986328125,27.9384765625],[121.0390625,27.9609375],[121.076171875,27.9873046875]]],[[[122.0703125,29.9931640625],[122.0947265625,29.9833984375],[122.0732421875,29.97265625]]],[[[122.1787109375,29.978515625],[122.1953125,29.9580078125],[122.1416015625,29.970703125]]],[[[122.146484375,29.962890625],[122.169921875,29.94921875],[122.1396484375,29.9443359375]]],[[[122.216796875,29.96484375],[122.279296875,29.93359375],[122.216796875,29.96484375]]],[[[121.107421875,27.4443359375],[121.0478515625,27.4619140625],[121.0703125,27.478515625]]],[[[122.078125,30.5966796875],[122.1025390625,30.5869140625],[122.0556640625,30.587890625]]],[[[122.4716796875,30.73046875],[122.4521484375,30.7607421875],[122.4716796875,30.73046875]]],[[[122.3916015625,30.7412109375],[122.39453125,30.7626953125],[122.3916015625,30.7412109375]]],[[[122.681640625,30.19140625],[122.673828125,30.208984375],[122.681640625,30.19140625]]],[[[122.4775390625,30.23046875],[122.50390625,30.216796875],[122.4775390625,30.23046875]]],[[[122.318359375,30.25],[122.3212890625,30.2705078125],[122.400390625,30.2763671875]]],[[[122.2646484375,30.2705078125],[122.3173828125,30.251953125],[122.2578125,30.2353515625]]],[[[122.1630859375,30.330078125],[122.1767578125,30.3525390625],[122.2490234375,30.3046875]]],[[[122.1513671875,30.1904296875],[122.21875,30.189453125],[122.1650390625,30.1376953125]]],[[[121.9580078125,30.2880859375],[121.9521484375,30.3154296875],[121.9892578125,30.341796875]]],[[[122.283203125,30.076171875],[122.283203125,30.095703125],[122.3046875,30.0908203125]]],[[[121.9404296875,30.115234375],[121.9638671875,30.103515625],[121.9345703125,30.0654296875]]],[[[121.8310546875,30.06640625],[121.82421875,30.083984375],[121.853515625,30.068359375]]],[[[121.876953125,30.0869140625],[121.8662109375,29.9658203125],[121.876953125,30.0869140625]]],[[[122.3310546875,29.9384765625],[122.4169921875,29.8291015625],[122.3310546875,29.9384765625]]],[[[122.283203125,29.861328125],[122.3017578125,29.884765625],[122.3505859375,29.8779296875]]],[[[122.265625,29.845703125],[122.3193359375,29.830078125],[122.296875,29.8134765625]]],[[[122.0390625,29.759765625],[122.0185546875,29.7138671875],[122.01171875,29.7470703125]]],[[[122.2333984375,29.68359375],[122.24609375,29.666015625],[122.2333984375,29.68359375]]],[[[122.0263671875,29.1787109375],[122.0390625,29.208984375],[122.056640625,29.201171875]]],[[[121.791015625,29.0830078125],[121.791015625,29.0986328125],[121.83203125,29.095703125]]],[[[121.837890625,28.771484375],[121.8671875,28.8134765625],[121.876953125,28.80078125]]],[[[121.4111328125,28.080078125],[121.4111328125,28.1025390625],[121.4111328125,28.080078125]]],[[[121.083984375,27.7919921875],[121.095703125,27.7802734375],[121.07421875,27.7783203125]]],[[[122.427734375,30.7392578125],[122.4873046875,30.7119140625],[122.53125,30.724609375]]],[[[122.1826171875,29.6513671875],[122.0517578125,29.712890625],[122.2001953125,29.712890625],[122.1826171875,29.6513671875]]],[[[122.4306640625,30.4091796875],[122.2822265625,30.4189453125],[122.4326171875,30.4462890625],[122.4306640625,30.4091796875]]],[[[119.6240234375,31.130859375],[119.7802734375,31.1796875],[119.919921875,31.1708984375],[120.0009765625,31.0283203125],[120.1328125,30.943359375],[120.3720703125,30.94921875],[120.4560546875,30.8173828125],[120.58984375,30.8544921875],[120.6982421875,30.9716796875],[120.8662109375,30.990234375],[120.990234375,31.0146484375],[121.0224609375,30.8759765625],[121.1376953125,30.830078125],[121.271484375,30.7333984375],[121.05859375,30.564453125],[121.2724609375,30.375],[121.4765625,30.2802734375],[121.626953125,30.078125],[121.7216796875,29.9931640625],[121.919921875,29.9208984375],[122.1435546875,29.896484375],[122.0068359375,29.7666015625],[121.833984375,29.6533203125],[122,29.59375],[121.9921875,29.4462890625],[121.9453125,29.28515625],[121.9892578125,29.15234375],[121.8525390625,29.0869140625],[121.7158203125,29.125],[121.7138671875,28.9765625],[121.759765625,28.8564453125],[121.685546875,28.708984375],[121.541015625,28.65625],[121.634765625,28.5634765625],[121.6650390625,28.4453125],[121.6494140625,28.279296875],[121.4892578125,28.3017578125],[121.373046875,28.1318359375],[121.26171875,28.03515625],[121.1171875,28.1328125],[120.9921875,27.9501953125],[121.162109375,27.9091796875],[121.134765625,27.787109375],[121.0234375,27.833984375],[120.7978515625,27.7802734375],[120.6357421875,27.578125],[120.703125,27.4736328125],[120.5732421875,27.314453125],[120.5224609375,27.142578125],[120.408203125,27.1923828125],[120.3525390625,27.345703125],[120.2509765625,27.4404296875],[120.1337890625,27.3935546875],[119.9951171875,27.3798828125],[119.771484375,27.306640625],[119.685546875,27.4384765625],[119.67578125,27.5751953125],[119.5400390625,27.67578125],[119.466796875,27.52734375],[119.2685546875,27.421875],[119.1484375,27.42578125],[118.9912109375,27.50390625],[118.857421875,27.5185546875],[118.875,27.6806640625],[118.8193359375,27.9169921875],[118.7197265625,28.0498046875],[118.8037109375,28.1650390625],[118.7138671875,28.3134765625],[118.5478515625,28.287109375],[118.431640625,28.3994140625],[118.41015625,28.5693359375],[118.3916015625,28.701171875],[118.30078125,28.826171875],[118.1953125,28.904296875],[118.1279296875,29.0166015625],[118.0380859375,29.09765625],[118.08203125,29.2333984375],[118.2080078125,29.34765625],[118.31640625,29.4228515625],[118.49609375,29.5185546875],[118.57421875,29.638671875],[118.7451171875,29.7392578125],[118.841796875,29.8916015625],[118.9033203125,30.029296875],[118.845703125,30.15625],[118.8798828125,30.3154296875],[119.0576171875,30.3046875],[119.2265625,30.2890625],[119.3271484375,30.3720703125],[119.328125,30.533203125],[119.388671875,30.6865234375],[119.48046875,30.7734375],[119.556640625,30.8994140625],[119.634765625,31.01953125],[119.6240234375,31.130859375]]],[[[122.3916015625,29.970703125],[122.3681640625,29.984375],[122.37890625,30.0244140625]]],[[[122.2578125,30.0654296875],[122.32421875,29.94140625],[122.1748046875,29.98828125],[122.0283203125,29.9921875],[121.935546875,30.166015625],[122.111328125,30.1552734375],[122.2333984375,30.109375],[122.2578125,30.0654296875]]]]}},{"type":"Feature","properties":{"name":"安徽"},"geometry":{"type":"MultiPolygon","coordinates":[[[[118.869140625,31.521484375],[118.8837890625,31.5009765625],[118.857421875,31.5068359375]]],[[[116.6748046875,29.7099609375],[116.70703125,29.69140625],[116.6552734375,29.6884765625]]],[[[116.375,34.640625],[116.4951171875,34.5693359375],[116.7607421875,34.462890625],[116.91015625,34.4091796875],[116.970703125,34.28125],[117.025390625,34.16796875],[117.15234375,34.083984375],[117.353515625,34.08984375],[117.5107421875,34.0625],[117.6162109375,34.0029296875],[117.7041015625,33.888671875],[117.7236328125,33.7412109375],[117.90234375,33.720703125],[118.0224609375,33.7392578125],[118.1865234375,33.7451171875],[118.1123046875,33.6171875],[118.1083984375,33.4755859375],[118.0302734375,33.373046875],[117.9384765625,33.23046875],[118.0390625,33.1357421875],[118.1787109375,33.21875],[118.2236328125,33.0908203125],[118.3115234375,32.9619140625],[118.2509765625,32.8486328125],[118.365234375,32.7705078125],[118.5771484375,32.7197265625],[118.71484375,32.7197265625],[118.7421875,32.853515625],[118.8544921875,32.958984375],[119.021484375,32.9560546875],[119.1044921875,32.8271484375],[119.2314453125,32.607421875],[119.1484375,32.4931640625],[118.98046875,32.50390625],[118.84375,32.5673828125],[118.7197265625,32.615234375],[118.5986328125,32.6015625],[118.59375,32.4794921875],[118.6787109375,32.3935546875],[118.6767578125,32.25390625],[118.5107421875,32.1943359375],[118.3955078125,32.0771484375],[118.3642578125,31.9326171875],[118.47265625,31.8798828125],[118.5458984375,31.7626953125],[118.685546875,31.7255859375],[118.798828125,31.6689453125],[118.88671875,31.51953125],[118.8115234375,31.3720703125],[118.7001953125,31.30078125],[119.10546875,31.2353515625],[119.2392578125,31.2548828125],[119.357421875,31.3037109375],[119.3916015625,31.1748046875],[119.5322265625,31.16015625],[119.6494140625,31.10546875],[119.583984375,30.9736328125],[119.5771484375,30.83203125],[119.4833984375,30.705078125],[119.3125,30.6220703125],[119.3486328125,30.41015625],[119.248046875,30.341796875],[119.0908203125,30.32421875],[118.955078125,30.3603515625],[118.8818359375,30.2490234375],[118.869140625,30.103515625],[118.8955078125,29.9384765625],[118.7548828125,29.845703125],[118.6474609375,29.6435546875],[118.5009765625,29.576171875],[118.3837890625,29.5107421875],[118.2470703125,29.431640625],[118.1435546875,29.5],[118.0146484375,29.578125],[117.8125,29.57421875],[117.6572265625,29.6142578125],[117.53125,29.654296875],[117.4560546875,29.75],[117.3369140625,29.8505859375],[117.212890625,29.927734375],[117.07421875,29.8330078125],[117.11328125,29.712890625],[116.99609375,29.68359375],[116.8388671875,29.5703125],[116.65234375,29.6376953125],[116.7529296875,29.7978515625],[116.8828125,29.8935546875],[116.830078125,30.0068359375],[116.6669921875,30.0771484375],[116.5419921875,29.90234375],[116.26171875,29.7822265625],[116.1357421875,29.8203125],[116.07421875,29.9638671875],[116.06640625,30.205078125],[115.9814453125,30.2958984375],[115.8857421875,30.3828125],[115.921875,30.517578125],[115.8193359375,30.5986328125],[115.7880859375,30.7578125],[115.8662109375,30.8642578125],[116.0107421875,30.9501953125],[115.8740234375,31.1474609375],[115.6923828125,31.2041015625],[115.58203125,31.1455078125],[115.52734375,31.25390625],[115.4423828125,31.3466796875],[115.3720703125,31.49609375],[115.48828125,31.6123046875],[115.6787109375,31.779296875],[115.8154296875,31.7626953125],[115.9345703125,31.9990234375],[115.9423828125,32.166015625],[115.8837890625,32.4560546875],[115.9296875,32.5673828125],[115.78515625,32.466796875],[115.6650390625,32.4091796875],[115.5244140625,32.44140625],[115.4091796875,32.5498046875],[115.2001953125,32.5927734375],[115.1826171875,32.7880859375],[115.02734375,32.908203125],[114.890625,32.974609375],[114.9033203125,33.1298828125],[115.13671875,33.083984375],[115.3017578125,33.142578125],[115.3359375,33.298828125],[115.31640625,33.44921875],[115.4228515625,33.5576171875],[115.640625,33.5859375],[115.6015625,33.720703125],[115.6337890625,33.8681640625],[115.5927734375,34.009765625],[115.7783203125,34.07421875],[115.8779296875,34.00390625],[116.0009765625,33.9658203125],[116.0556640625,33.8056640625],[116.162109375,33.708984375],[116.4091796875,33.8056640625],[116.55859375,33.8818359375],[116.6494140625,33.9716796875],[116.5283203125,34.1162109375],[116.5439453125,34.240234375],[116.365234375,34.26953125],[116.2138671875,34.3828125],[116.2041015625,34.5087890625],[116.28125,34.607421875],[116.375,34.640625]]]]}},{"type":"Feature","properties":{"name":"福建"},"geometry":{"type":"MultiPolygon","coordinates":[[[[120.361328125,26.9169921875],[120.3203125,26.9453125],[120.33984375,26.970703125]]],[[[119.6689453125,26.62890625],[119.65234375,26.6494140625],[119.6669921875,26.6796875]]],[[[120.13671875,26.5517578125],[120.1181640625,26.5693359375],[120.1689453125,26.6025390625]]],[[[120.03515625,26.4892578125],[120.03515625,26.515625],[120.0703125,26.5234375]]],[[[120.0068359375,26.2158203125],[119.970703125,26.1904296875],[119.9716796875,26.21875]]],[[[119.9296875,26.134765625],[119.919921875,26.1728515625],[119.970703125,26.1640625]]],[[[119.6953125,25.3046875],[119.7021484375,25.3427734375],[119.712890625,25.31640625]]],[[[119.900390625,25.5830078125],[119.8759765625,25.6064453125],[119.9013671875,25.607421875]]],[[[119.6435546875,26.1298828125],[119.607421875,26.169921875],[119.666015625,26.15625]]],[[[119.9375,25.9638671875],[119.9287109375,25.9775390625],[119.9521484375,25.9794921875]]],[[[120.49609375,26.3720703125],[120.5166015625,26.3623046875],[120.4892578125,26.3515625]]],[[[119.580078125,25.6279296875],[119.5615234375,25.6396484375],[119.61328125,25.669921875]]],[[[119.705078125,25.353515625],[119.7041015625,25.3740234375],[119.73046875,25.376953125]]],[[[118.4130859375,24.5146484375],[118.326171875,24.3828125],[118.4130859375,24.5146484375]]],[[[118.1513671875,24.3193359375],[118.146484375,24.33984375],[118.1513671875,24.3193359375]]],[[[119.4716796875,25.197265625],[119.4443359375,25.2021484375],[119.439453125,25.2333984375]]],[[[118.205078125,24.5048828125],[118.0712890625,24.4560546875],[118.1923828125,24.537109375],[118.205078125,24.5048828125]]],[[[119.5693359375,25.4140625],[119.44140625,25.4111328125],[119.3623046875,25.5224609375],[119.3173828125,25.4091796875],[119.1630859375,25.44140625],[119.2431640625,25.31640625],[119.3857421875,25.275390625],[119.26953125,25.16015625],[119.138671875,25.2255859375],[119.1279296875,25.0126953125],[119.029296875,25.1396484375],[118.9892578125,25.2548828125],[118.9755859375,25.1171875],[118.984375,24.9912109375],[118.865234375,24.8876953125],[118.7421875,24.822265625],[118.724609375,24.677734375],[118.580078125,24.5078125],[118.4794921875,24.615234375],[118.34765625,24.53125],[118.1513671875,24.583984375],[118.0498046875,24.4189453125],[118.15625,24.2587890625],[118.01953125,24.197265625],[117.9287109375,24.08984375],[117.76953125,23.888671875],[117.6611328125,23.791015625],[117.501953125,23.705078125],[117.4638671875,23.5859375],[117.193359375,23.5625],[117.0556640625,23.6943359375],[117.0185546875,23.84765625],[116.982421875,24],[116.9990234375,24.1806640625],[116.9150390625,24.2880859375],[116.83984375,24.443359375],[116.7568359375,24.55078125],[116.8017578125,24.6787109375],[116.6318359375,24.640625],[116.4892578125,24.7177734375],[116.3759765625,24.8046875],[116.24609375,24.7939453125],[116.0908203125,24.8388671875],[115.9091796875,24.923828125],[115.9296875,25.048828125],[115.8544921875,25.1552734375],[115.9501953125,25.29296875],[116.0234375,25.4365234375],[116.0634765625,25.5615234375],[116.060546875,25.6953125],[116.17578125,25.75],[116.3701171875,25.9638671875],[116.4912109375,26.1220703125],[116.3974609375,26.2705078125],[116.5,26.3623046875],[116.638671875,26.4794921875],[116.5400390625,26.5595703125],[116.5126953125,26.708984375],[116.548828125,26.8408203125],[116.6953125,26.9873046875],[116.904296875,27.0341796875],[117.0537109375,27.1005859375],[117.1669921875,27.267578125],[117.099609375,27.3798828125],[117.1025390625,27.541015625],[117.00390625,27.626953125],[117.1181640625,27.6943359375],[117.263671875,27.728515625],[117.2802734375,27.87109375],[117.5234375,27.9833984375],[117.6044921875,27.8681640625],[117.7412109375,27.80078125],[117.8564453125,27.9462890625],[117.9990234375,27.9912109375],[118.12890625,28.0166015625],[118.353515625,28.087890625],[118.3154296875,28.2236328125],[118.4326171875,28.2939453125],[118.5849609375,28.28515625],[118.7197265625,28.3125],[118.8125,28.2294921875],[118.7451171875,28.08984375],[118.7314453125,27.9697265625],[118.8408203125,27.7802734375],[118.9140625,27.619140625],[118.9052734375,27.462890625],[119.0654296875,27.466796875],[119.2685546875,27.421875],[119.37109375,27.5322265625],[119.501953125,27.650390625],[119.64453125,27.6630859375],[119.66015625,27.5400390625],[119.78515625,27.328125],[119.9453125,27.314453125],[120.0986328125,27.392578125],[120.2490234375,27.4404296875],[120.3525390625,27.345703125],[120.4013671875,27.2119140625],[120.3935546875,27.08203125],[120.2578125,27.03515625],[120.2333984375,26.908203125],[120.0380859375,26.8603515625],[120.107421875,26.7548828125],[120.138671875,26.638671875],[119.95703125,26.595703125],[119.837890625,26.515625],[119.904296875,26.625],[120.0634765625,26.7724609375],[119.92578125,26.7734375],[119.876953125,26.64453125],[119.7119140625,26.6875],[119.5771484375,26.6279296875],[119.7890625,26.583984375],[119.876953125,26.3603515625],[119.771484375,26.2861328125],[119.66796875,26.205078125],[119.6689453125,26.0263671875],[119.693359375,25.900390625],[119.638671875,25.75390625],[119.4912109375,25.673828125],[119.599609375,25.5927734375],[119.626953125,25.4736328125],[119.6845703125,25.5986328125],[119.78515625,25.66796875],[119.890625,25.56640625],[119.7666015625,25.435546875],[119.6494140625,25.4619140625],[119.599609375,25.3349609375],[119.5693359375,25.4140625]]]]}},{"type":"Feature","properties":{"name":"江西"},"geometry":{"type":"Polygon","coordinates":[[[113.9541015625,25.619140625],[114.0283203125,25.8935546875],[114.0087890625,26.0166015625],[114.109375,26.1005859375],[114.2373046875,26.15234375],[114.0888671875,26.1689453125],[113.962890625,26.1513671875],[114.0302734375,26.2666015625],[114.0888671875,26.412109375],[114.109375,26.572265625],[113.9970703125,26.6162109375],[113.861328125,26.6650390625],[113.8349609375,26.8046875],[113.927734375,26.94921875],[113.8212890625,27.0380859375],[113.8720703125,27.28515625],[113.7001953125,27.3330078125],[113.6025390625,27.4208984375],[113.6123046875,27.6337890625],[113.767578125,27.80859375],[113.75390625,27.935546875],[113.8642578125,28.0048828125],[114.02734375,28.0322265625],[113.994140625,28.1640625],[114.1455078125,28.248046875],[114.255859375,28.32421875],[114.171875,28.435546875],[114.0869140625,28.556640625],[114.123046875,28.6904296875],[114.1533203125,28.8349609375],[114.029296875,28.8916015625],[113.9462890625,29.0185546875],[114.0380859375,29.1552734375],[114.2529296875,29.2353515625],[114.3076171875,29.3662109375],[114.4453125,29.349609375],[114.673828125,29.396484375],[114.89453125,29.3974609375],[114.9013671875,29.5302734375],[115.03515625,29.546875],[115.154296875,29.5107421875],[115.1435546875,29.6494140625],[115.2666015625,29.66015625],[115.470703125,29.740234375],[115.68359375,29.8486328125],[115.837890625,29.7490234375],[116.16796875,29.828125],[116.4677734375,29.896484375],[116.5869140625,30.046875],[116.7646484375,30.0498046875],[116.869140625,29.9814453125],[116.8125,29.8125],[116.654296875,29.6953125],[116.7216796875,29.5654296875],[116.99609375,29.68359375],[117.11328125,29.712890625],[117.07421875,29.8330078125],[117.212890625,29.927734375],[117.29296875,29.8232421875],[117.421875,29.849609375],[117.453125,29.6923828125],[117.54296875,29.5888671875],[117.7080078125,29.5498046875],[117.876953125,29.546875],[118.0087890625,29.5791015625],[118.1376953125,29.5068359375],[118.2080078125,29.34765625],[118.072265625,29.2890625],[118.029296875,29.169921875],[118.0673828125,29.048828125],[118.1806640625,28.9814453125],[118.30078125,28.826171875],[118.3916015625,28.701171875],[118.41015625,28.5693359375],[118.482421875,28.470703125],[118.4833984375,28.318359375],[118.3154296875,28.2236328125],[118.353515625,28.087890625],[118.2001953125,28.05078125],[118.095703125,27.966796875],[117.9677734375,27.9638671875],[117.787109375,27.896484375],[117.6044921875,27.8681640625],[117.5234375,27.9833984375],[117.3525390625,27.8583984375],[117.263671875,27.728515625],[117.1181640625,27.6943359375],[117.00390625,27.626953125],[117.1025390625,27.541015625],[117.099609375,27.3798828125],[117.1669921875,27.267578125],[117.046875,27.1494140625],[116.9365234375,27.01953125],[116.783203125,27.009765625],[116.548828125,26.8408203125],[116.5126953125,26.708984375],[116.5400390625,26.5595703125],[116.6376953125,26.466796875],[116.556640625,26.365234375],[116.3974609375,26.2705078125],[116.4716796875,26.17578125],[116.36328125,26.00390625],[116.130859375,25.859375],[116.1083984375,25.703125],[116.0634765625,25.5615234375],[116.0234375,25.4365234375],[116.0029296875,25.3056640625],[115.8564453125,25.2099609375],[115.9296875,25.048828125],[115.900390625,24.875],[115.7568359375,24.748046875],[115.8486328125,24.56640625],[115.6884765625,24.5458984375],[115.57421875,24.6171875],[115.4072265625,24.7939453125],[115.279296875,24.7548828125],[115.12109375,24.6650390625],[114.9404296875,24.650390625],[114.8271484375,24.5888671875],[114.7060546875,24.5263671875],[114.5322265625,24.5595703125],[114.431640625,24.4873046875],[114.3564453125,24.5908203125],[114.1748046875,24.646484375],[114.3359375,24.75],[114.4033203125,24.8779296875],[114.5107421875,25.0029296875],[114.640625,25.07421875],[114.736328125,25.1552734375],[114.7431640625,25.275390625],[114.6005859375,25.38671875],[114.4482421875,25.38671875],[114.306640625,25.3349609375],[114.1396484375,25.3115234375],[114.033203125,25.251953125],[114.0244140625,25.3740234375],[113.958984375,25.484375],[113.9541015625,25.619140625]]]}},{"type":"Feature","properties":{"name":"山东"},"geometry":{"type":"MultiPolygon","coordinates":[[[[120.904296875,38.3818359375],[120.916015625,38.40234375],[120.93359375,38.3876953125]]],[[[120.9189453125,38.345703125],[120.8984375,38.37109375],[120.9150390625,38.3740234375]]],[[[120.841796875,38.3359375],[120.845703125,38.357421875],[120.841796875,38.3359375]]],[[[120.802734375,38.2841796875],[120.8125,38.31640625],[120.849609375,38.3125]]],[[[120.7509765625,38.150390625],[120.7451171875,38.203125],[120.7880859375,38.1611328125]]],[[[120.9443359375,38.0205078125],[120.9326171875,38.0380859375],[120.9443359375,38.0205078125]]],[[[120.68359375,37.9287109375],[120.69140625,37.9541015625],[120.68359375,37.9287109375]]],[[[120.990234375,36.4140625],[120.9482421875,36.419921875],[120.970703125,36.431640625]]],[[[120.1591796875,35.765625],[120.1826171875,35.7890625],[120.193359375,35.755859375]]],[[[120.453125,37.76953125],[120.435546875,37.787109375],[120.4638671875,37.7861328125]]],[[[120.626953125,37.9462890625],[120.6005859375,37.9638671875],[120.609375,37.9833984375]]],[[[120.73046875,37.947265625],[120.765625,37.923828125],[120.7607421875,37.890625]]],[[[115.48828125,35.880859375],[115.3642578125,35.7802734375],[115.36328125,35.97265625],[115.484375,36.1259765625],[115.462890625,36.2763671875],[115.3466796875,36.390625],[115.2734375,36.498046875],[115.35546875,36.6279296875],[115.4794921875,36.759765625],[115.6865234375,36.80859375],[115.765625,36.9091796875],[115.8837890625,37.099609375],[115.970703125,37.2412109375],[116.1669921875,37.3857421875],[116.2861328125,37.404296875],[116.2998046875,37.5693359375],[116.4345703125,37.4736328125],[116.611328125,37.6259765625],[116.6796875,37.728515625],[116.8037109375,37.8505859375],[117.02734375,37.8330078125],[117.2646484375,37.8388671875],[117.435546875,37.8525390625],[117.556640625,38.0576171875],[117.7275390625,38.091796875],[117.8076171875,38.2275390625],[118.033203125,38.203125],[118.134765625,38.3076171875],[118.0751953125,38.1630859375],[118.4208984375,38.107421875],[118.552734375,38.056640625],[118.7265625,38.154296875],[118.8544921875,38.1552734375],[119.0048828125,37.9931640625],[119.1171875,37.912109375],[119.212890625,37.814453125],[119.248046875,37.69921875],[119.0810546875,37.697265625],[118.9404296875,37.52734375],[118.9873046875,37.33984375],[119.0673828125,37.2421875],[119.19921875,37.2568359375],[119.2998046875,37.1435546875],[119.490234375,37.134765625],[119.7451171875,37.1357421875],[119.8271484375,37.2236328125],[119.8388671875,37.34375],[119.9501953125,37.4208984375],[120.14453125,37.482421875],[120.2470703125,37.556640625],[120.21875,37.6904296875],[120.369140625,37.6982421875],[120.5859375,37.7626953125],[120.751953125,37.8388671875],[120.9365234375,37.8232421875],[121.0380859375,37.71875],[121.150390625,37.6201171875],[121.3056640625,37.5830078125],[121.439453125,37.5986328125],[121.4775390625,37.4765625],[121.638671875,37.4951171875],[121.9248046875,37.4736328125],[122.07421875,37.5390625],[122.1787109375,37.4326171875],[122.3154296875,37.4169921875],[122.48828125,37.435546875],[122.6416015625,37.4287109375],[122.5751953125,37.3017578125],[122.5751953125,37.1806640625],[122.4619140625,37.0400390625],[122.5859375,37.0439453125],[122.5458984375,36.919921875],[122.384765625,36.8662109375],[122.181640625,36.841796875],[122.052734375,36.9052734375],[121.7685546875,36.875],[121.6328125,36.80078125],[121.533203125,36.7314453125],[121.39453125,36.73828125],[121.037109375,36.5751953125],[120.90625,36.6240234375],[120.955078125,36.5078125],[120.8720703125,36.3671875],[120.7587890625,36.462890625],[120.7451171875,36.3291015625],[120.712890625,36.126953125],[120.55078125,36.1123046875],[120.4326171875,36.052734375],[120.2880859375,36.04296875],[120.36328125,36.1962890625],[120.2294921875,36.1884765625],[120.109375,36.1279296875],[120.2421875,36.060546875],[120.201171875,35.8916015625],[120.0712890625,35.8818359375],[120.013671875,35.71484375],[119.869140625,35.609375],[119.7490234375,35.619140625],[119.580078125,35.4072265625],[119.494140625,35.3193359375],[119.3935546875,35.14453125],[119.25,35.125],[119.1171875,35.0556640625],[118.8662109375,35.0302734375],[118.802734375,34.845703125],[118.7841796875,34.72265625],[118.607421875,34.6953125],[118.462890625,34.66796875],[118.4404296875,34.5087890625],[118.2919921875,34.42578125],[118.1708984375,34.3818359375],[118.185546875,34.544921875],[118.1005859375,34.65234375],[117.9580078125,34.6796875],[117.7939453125,34.65234375],[117.8017578125,34.51953125],[117.6845703125,34.5478515625],[117.5908203125,34.4619140625],[117.36328125,34.58984375],[117.25390625,34.451171875],[117.1376953125,34.6337890625],[117.05078125,34.771484375],[116.9765625,34.87109375],[116.822265625,34.9296875],[116.6318359375,34.94140625],[116.4443359375,34.896484375],[116.4033203125,34.7568359375],[116.318359375,34.6015625],[116.1474609375,34.5537109375],[116.00390625,34.6240234375],[115.830078125,34.5634765625],[115.7041015625,34.6005859375],[115.5224609375,34.5791015625],[115.4453125,34.6748046875],[115.4296875,34.802734375],[115.314453125,34.8603515625],[115.189453125,34.9150390625],[115.029296875,34.97265625],[114.8779296875,35.025390625],[114.845703125,35.166015625],[115.0146484375,35.318359375],[115.091796875,35.4169921875],[115.23828125,35.423828125],[115.3583984375,35.4990234375],[115.498046875,35.7197265625],[115.6943359375,35.7548828125],[115.8759765625,35.859375],[116.0478515625,35.9697265625],[116.1005859375,36.111328125],[115.919921875,36.0205078125],[115.771484375,35.9736328125],[115.646484375,35.9208984375],[115.513671875,35.890625],[115.48828125,35.880859375]]]]}},{"type":"Feature","properties":{"name":"河南"},"geometry":{"type":"Polygon","coordinates":[[[115.484375,36.1494140625],[115.4482421875,36.0126953125],[115.365234375,35.8984375],[115.50390625,35.8896484375],[115.646484375,35.9208984375],[115.775390625,35.974609375],[115.919921875,36.0205078125],[116.0576171875,36.10546875],[116.0478515625,35.9697265625],[115.912109375,35.9609375],[115.7353515625,35.8330078125],[115.486328125,35.7109375],[115.3837890625,35.5693359375],[115.23828125,35.423828125],[115.091796875,35.4169921875],[115.0146484375,35.318359375],[114.931640625,35.197265625],[114.830078125,35.0712890625],[114.923828125,34.96875],[115.12890625,35.0048828125],[115.2529296875,34.9072265625],[115.427734375,34.8056640625],[115.4619140625,34.6376953125],[115.6845703125,34.5556640625],[115.830078125,34.5634765625],[115.9736328125,34.58984375],[116.1015625,34.6064453125],[116.2041015625,34.5087890625],[116.2138671875,34.3828125],[116.3642578125,34.3173828125],[116.50390625,34.296875],[116.56640625,34.169921875],[116.65234375,33.962890625],[116.55859375,33.8818359375],[116.4375,33.8466796875],[116.263671875,33.73046875],[116.0556640625,33.8056640625],[116.0009765625,33.9658203125],[115.8876953125,34.033203125],[115.654296875,34.060546875],[115.5458984375,33.880859375],[115.6142578125,33.7763671875],[115.640625,33.5859375],[115.4228515625,33.5576171875],[115.34765625,33.451171875],[115.3623046875,33.30078125],[115.2958984375,33.1982421875],[115.1953125,33.12109375],[114.994140625,33.1005859375],[114.892578125,33.0205078125],[115.033203125,32.9306640625],[115.15625,32.865234375],[115.1787109375,32.6845703125],[115.3017578125,32.5888671875],[115.4775390625,32.521484375],[115.5712890625,32.4208984375],[115.69921875,32.4951171875],[115.841796875,32.5009765625],[115.9130859375,32.228515625],[115.9267578125,32.10546875],[115.8935546875,31.8388671875],[115.7685546875,31.7880859375],[115.4970703125,31.6748046875],[115.41796875,31.52734375],[115.3740234375,31.40625],[115.2509765625,31.392578125],[115.236328125,31.5556640625],[115.0966796875,31.5087890625],[114.96875,31.4970703125],[114.830078125,31.458984375],[114.697265625,31.5263671875],[114.5732421875,31.5546875],[114.591796875,31.7021484375],[114.447265625,31.728515625],[114.294921875,31.751953125],[114.1806640625,31.8544921875],[113.9794921875,31.75390625],[113.935546875,31.8798828125],[113.8056640625,31.931640625],[113.728515625,32.083984375],[113.7392578125,32.255859375],[113.7529296875,32.388671875],[113.6240234375,32.361328125],[113.423828125,32.26953125],[113.2119140625,32.4326171875],[113.0283203125,32.42578125],[112.912109375,32.3916015625],[112.763671875,32.3427734375],[112.5458984375,32.404296875],[112.361328125,32.3662109375],[112.2275390625,32.38671875],[112.0810546875,32.4228515625],[111.951171875,32.5166015625],[111.7216796875,32.6044921875],[111.5732421875,32.5947265625],[111.47265625,32.71875],[111.380859375,32.8291015625],[111.2802734375,32.9052734375],[111.23828125,33.041015625],[111.0947265625,33.1806640625],[110.9833984375,33.2705078125],[110.9970703125,33.4365234375],[111.00390625,33.5791015625],[110.8388671875,33.6669921875],[110.7822265625,33.796875],[110.66796875,33.853515625],[110.625,34.0341796875],[110.642578125,34.1611328125],[110.4384765625,34.24609375],[110.4765625,34.4091796875],[110.3681640625,34.4951171875],[110.466796875,34.619140625],[110.611328125,34.607421875],[110.7548828125,34.654296875],[110.8837890625,34.642578125],[111.123046875,34.759765625],[111.2587890625,34.8212890625],[111.3955078125,34.8154296875],[111.5712890625,34.84375],[111.681640625,34.9501953125],[111.80078125,35.0283203125],[111.9521484375,35.0830078125],[112.0673828125,35.15234375],[112.0595703125,35.2802734375],[112.2431640625,35.2353515625],[112.40234375,35.2421875],[112.568359375,35.2119140625],[112.7080078125,35.2177734375],[112.9091796875,35.24609375],[112.9970703125,35.3623046875],[113.1376953125,35.3359375],[113.1904296875,35.44921875],[113.32421875,35.4541015625],[113.5068359375,35.5166015625],[113.548828125,35.658203125],[113.599609375,35.775390625],[113.6552734375,35.91796875],[113.6884765625,36.0615234375],[113.69921875,36.18359375],[113.732421875,36.3642578125],[113.8828125,36.3544921875],[114.0029296875,36.3349609375],[114.140625,36.2802734375],[114.345703125,36.255859375],[114.568359375,36.15234375],[114.7353515625,36.15625],[114.9130859375,36.140625],[115.046875,36.11328125],[115.125,36.2109375],[115.3193359375,36.087890625],[115.455078125,36.171875],[115.484375,36.1494140625]]]}},{"type":"Feature","properties":{"name":"湖北"},"geometry":{"type":"MultiPolygon","coordinates":[[[[111.046875,33.203125],[111.0458984375,33.1708984375],[111.046875,33.203125]]],[[[112.90234375,29.7919921875],[112.923828125,29.7666015625],[112.90234375,29.7919921875]]],[[[110.9853515625,33.255859375],[111.0947265625,33.1806640625],[111.193359375,33.072265625],[111.2744140625,32.97265625],[111.380859375,32.8291015625],[111.4609375,32.7275390625],[111.5732421875,32.5947265625],[111.7216796875,32.6044921875],[111.8818359375,32.5068359375],[112.0078125,32.451171875],[112.1474609375,32.3828125],[112.328125,32.322265625],[112.451171875,32.34375],[112.763671875,32.3427734375],[112.87109375,32.3984375],[112.9951171875,32.4111328125],[113.150390625,32.376953125],[113.33203125,32.3427734375],[113.5302734375,32.3310546875],[113.6650390625,32.4228515625],[113.7724609375,32.3623046875],[113.7841796875,32.1865234375],[113.7919921875,32.0361328125],[113.8330078125,31.9189453125],[113.9794921875,31.75390625],[114.134765625,31.84375],[114.294921875,31.751953125],[114.447265625,31.728515625],[114.5849609375,31.7646484375],[114.5498046875,31.64453125],[114.7001953125,31.546875],[114.830078125,31.458984375],[114.96875,31.4970703125],[115.0966796875,31.5087890625],[115.173828125,31.6025390625],[115.2109375,31.4462890625],[115.3916015625,31.3935546875],[115.45703125,31.283203125],[115.5693359375,31.1533203125],[115.701171875,31.201171875],[115.8740234375,31.1474609375],[115.94140625,31.0439453125],[116.0595703125,31.013671875],[115.8662109375,30.8642578125],[115.7880859375,30.7578125],[115.8134765625,30.6396484375],[115.921875,30.517578125],[115.8857421875,30.3828125],[115.9814453125,30.2958984375],[116.06640625,30.205078125],[116.091796875,30.037109375],[116.1328125,29.890625],[115.93359375,29.7216796875],[115.68359375,29.8486328125],[115.51171875,29.8408203125],[115.3603515625,29.646484375],[115.1767578125,29.6552734375],[115.154296875,29.5107421875],[115.03515625,29.546875],[114.900390625,29.5068359375],[114.78515625,29.38671875],[114.5029296875,29.32421875],[114.353515625,29.32421875],[114.2529296875,29.2353515625],[114.0634765625,29.205078125],[113.9560546875,29.0986328125],[113.83203125,29.0703125],[113.689453125,29.0791015625],[113.693359375,29.2265625],[113.66796875,29.3818359375],[113.689453125,29.509765625],[113.7041015625,29.634765625],[113.5390625,29.6845703125],[113.572265625,29.849609375],[113.3779296875,29.7041015625],[113.15625,29.4580078125],[112.9501953125,29.4736328125],[112.912109375,29.6162109375],[113.005859375,29.6943359375],[112.91015625,29.8037109375],[112.7939453125,29.736328125],[112.68359375,29.58984375],[112.5361328125,29.6005859375],[112.396484375,29.5634765625],[112.283203125,29.4951171875],[112.2353515625,29.6162109375],[112.06640625,29.681640625],[111.9560546875,29.7958984375],[111.8076171875,29.904296875],[111.6826171875,29.884765625],[111.5537109375,29.89453125],[111.3974609375,29.9130859375],[111.2431640625,30.041015625],[110.9306640625,30.0634765625],[110.814453125,30.126953125],[110.712890625,30.033203125],[110.4970703125,30.0546875],[110.4990234375,29.91015625],[110.615234375,29.8310546875],[110.5634765625,29.712890625],[110.447265625,29.6650390625],[110.2978515625,29.6650390625],[110.1142578125,29.7900390625],[109.7919921875,29.763671875],[109.7177734375,29.6142578125],[109.5595703125,29.607421875],[109.46484375,29.513671875],[109.37109375,29.419921875],[109.3525390625,29.2841796875],[109.27734375,29.125],[109.1396484375,29.169921875],[109.107421875,29.2890625],[109.0537109375,29.4033203125],[108.9189453125,29.328125],[108.8671875,29.47265625],[108.9091796875,29.5947265625],[108.7822265625,29.63671875],[108.662109375,29.8544921875],[108.5234375,29.7646484375],[108.404296875,29.8359375],[108.54296875,29.998046875],[108.568359375,30.1572265625],[108.4609375,30.3603515625],[108.416015625,30.48046875],[108.5693359375,30.4697265625],[108.640625,30.5751953125],[108.7900390625,30.513671875],[108.9677734375,30.625],[109.119140625,30.6396484375],[109.14453125,30.521484375],[109.3037109375,30.6318359375],[109.35546875,30.4873046875],[109.458984375,30.6162109375],[109.5908203125,30.6943359375],[109.71875,30.779296875],[109.89453125,30.900390625],[110.0205078125,30.830078125],[110.173828125,30.98046875],[110.12109375,31.08984375],[110.16015625,31.2568359375],[110.1435546875,31.3896484375],[109.98828125,31.4755859375],[109.8388671875,31.5556640625],[109.73828125,31.62890625],[109.5859375,31.7275390625],[109.5859375,31.9013671875],[109.587890625,32.025390625],[109.58984375,32.150390625],[109.49609375,32.30078125],[109.52734375,32.43359375],[109.6376953125,32.5419921875],[109.8173828125,32.578125],[110.0283203125,32.548828125],[110.166015625,32.5947265625],[110.16015625,32.767578125],[109.9912109375,32.88671875],[109.8642578125,32.9140625],[109.7919921875,33.0703125],[109.5771484375,33.1103515625],[109.439453125,33.15234375],[109.6015625,33.2333984375],[109.8525390625,33.248046875],[110.03125,33.1923828125],[110.1650390625,33.2099609375],[110.337890625,33.1611328125],[110.4716796875,33.171875],[110.564453125,33.2548828125],[110.658203125,33.154296875],[110.8203125,33.1533203125],[110.9853515625,33.255859375]]]]}},{"type":"Feature","properties":{"name":"湖南"},"geometry":{"type":"MultiPolygon","coordinates":[[[[112.9296875,29.7744140625],[112.88671875,29.796875],[112.919921875,29.7998046875]]],[[[109.9052734375,26.671875],[109.892578125,26.52734375],[109.9873046875,26.4326171875],[109.984375,26.279296875],[109.9072265625,26.1455078125],[109.869140625,26.03125],[109.8271484375,25.9169921875],[109.685546875,25.880859375],[109.724609375,26.0029296875],[109.5185546875,25.9970703125],[109.4501953125,26.1025390625],[109.4404296875,26.2392578125],[109.2783203125,26.30859375],[109.3818359375,26.455078125],[109.357421875,26.658203125],[109.4619140625,26.7626953125],[109.61328125,26.6865234375],[109.7548828125,26.7548828125],[109.931640625,26.71875],[109.9052734375,26.671875]]],[[[113.955078125,25.615234375],[113.9443359375,25.439453125],[113.8154296875,25.3291015625],[113.5830078125,25.306640625],[113.4462890625,25.3603515625],[113.314453125,25.443359375],[113.1806640625,25.4716796875],[113.0244140625,25.3466796875],[112.89453125,25.33984375],[112.9931640625,25.248046875],[113.0185546875,25.083984375],[113.0126953125,24.9482421875],[112.7841796875,24.8955078125],[112.7158203125,25.0263671875],[112.66015625,25.1328125],[112.5078125,25.1376953125],[112.365234375,25.1923828125],[112.1982421875,25.1875],[112.15625,25.02734375],[112.154296875,24.837890625],[112.0244140625,24.740234375],[111.8759765625,24.7568359375],[111.6904296875,24.779296875],[111.59375,24.693359375],[111.431640625,24.6865234375],[111.4794921875,24.7978515625],[111.470703125,24.9296875],[111.4189453125,25.0419921875],[111.275390625,25.1513671875],[111.1044921875,25.0380859375],[110.9794921875,24.9150390625],[110.9521484375,25.0439453125],[110.9990234375,25.162109375],[111.11328125,25.2177734375],[111.29296875,25.4365234375],[111.34375,25.60546875],[111.4404296875,25.7705078125],[111.3447265625,25.9072265625],[111.1904296875,25.953125],[111.267578125,26.0576171875],[111.26953125,26.21484375],[111.041015625,26.322265625],[110.927734375,26.2548828125],[110.76171875,26.25],[110.61328125,26.333984375],[110.5078125,26.1767578125],[110.3779296875,26.0947265625],[110.326171875,25.9765625],[110.197265625,26.068359375],[110.068359375,26.0439453125],[110.099609375,26.169921875],[109.966796875,26.1962890625],[110.0126953125,26.373046875],[109.9326171875,26.4765625],[109.8271484375,26.6064453125],[109.9423828125,26.6787109375],[109.8037109375,26.7861328125],[109.662109375,26.7744140625],[109.513671875,26.7177734375],[109.5146484375,26.875],[109.54296875,27.009765625],[109.4736328125,27.1357421875],[109.2734375,27.1279296875],[109.1640625,27.06640625],[108.94140625,27.046875],[108.791015625,27.0849609375],[108.927734375,27.1611328125],[108.986328125,27.2705078125],[109.1044921875,27.3369140625],[109.2080078125,27.451171875],[109.462890625,27.56640625],[109.4150390625,27.7255859375],[109.34765625,27.8388671875],[109.302734375,27.95703125],[109.357421875,28.234375],[109.2890625,28.3740234375],[109.2744140625,28.5390625],[109.1806640625,28.62109375],[109.30078125,28.740234375],[109.236328125,28.8818359375],[109.3203125,29.04296875],[109.2587890625,29.22265625],[109.3447265625,29.3701171875],[109.416015625,29.4970703125],[109.4970703125,29.603515625],[109.65234375,29.626953125],[109.7626953125,29.69140625],[110.1142578125,29.7900390625],[110.24609375,29.732421875],[110.3740234375,29.634765625],[110.4658203125,29.7138671875],[110.642578125,29.7724609375],[110.5380859375,29.8974609375],[110.49609375,30.015625],[110.6533203125,30.078125],[110.8203125,30.126953125],[110.9306640625,30.0634765625],[111.2431640625,30.041015625],[111.34375,29.9453125],[111.5224609375,29.9287109375],[111.6826171875,29.884765625],[111.8623046875,29.857421875],[112.0634765625,29.7431640625],[112.1728515625,29.6611328125],[112.3037109375,29.5859375],[112.4404296875,29.6337890625],[112.572265625,29.6240234375],[112.7177734375,29.65234375],[112.880859375,29.787109375],[113.029296875,29.7705078125],[112.912109375,29.607421875],[112.9501953125,29.4736328125],[113.0908203125,29.431640625],[113.3779296875,29.7041015625],[113.572265625,29.849609375],[113.5390625,29.6845703125],[113.6640625,29.6845703125],[113.7412109375,29.591796875],[113.6318359375,29.5234375],[113.755859375,29.4482421875],[113.6611328125,29.333984375],[113.662109375,29.16796875],[113.7451171875,29.05859375],[113.8828125,29.06640625],[113.966796875,28.9443359375],[114.0615234375,28.8466796875],[114.1494140625,28.724609375],[114.0869140625,28.556640625],[114.21875,28.4853515625],[114.2548828125,28.3212890625],[114.1455078125,28.248046875],[113.994140625,28.1640625],[114.02734375,28.0322265625],[113.900390625,27.98828125],[113.75390625,27.935546875],[113.767578125,27.80859375],[113.6123046875,27.6337890625],[113.62890625,27.5146484375],[113.603515625,27.38671875],[113.876953125,27.3828125],[113.7724609375,27.1025390625],[113.927734375,26.94921875],[113.8349609375,26.8046875],[113.861328125,26.6650390625],[113.9970703125,26.6162109375],[114.109375,26.572265625],[114.0888671875,26.412109375],[114.0302734375,26.2666015625],[113.9453125,26.1640625],[114.0888671875,26.1689453125],[114.232421875,26.181640625],[114.109375,26.1005859375],[114.0087890625,26.0166015625],[114.0283203125,25.8935546875],[113.9150390625,25.7294921875],[113.955078125,25.615234375]]]]}},{"type":"Feature","properties":{"name":"广东"},"geometry":{"type":"MultiPolygon","coordinates":[[[[114.6298828125,22.44921875],[114.62109375,22.466796875],[114.65625,22.4658203125]]],[[[113.8203125,22.396484375],[113.787109375,22.41796875],[113.814453125,22.419921875]]],[[[114.052734375,22.0869140625],[114.02734375,22.103515625],[114.046875,22.1103515625]]],[[[114.2314453125,22.0166015625],[114.326171875,22.0634765625],[114.2314453125,22.0166015625]]],[[[113.71484375,22.0078125],[113.703125,22.029296875],[113.728515625,22.021484375]]],[[[114.1904296875,21.9873046875],[114.1845703125,22.01171875],[114.2294921875,21.9970703125]]],[[[113.765625,21.962890625],[113.7470703125,21.99609375],[113.7802734375,21.9912109375]]],[[[113.7236328125,21.9228515625],[113.71875,21.9521484375],[113.751953125,21.9453125]]],[[[110.6455078125,20.9365234375],[110.6123046875,20.8603515625],[110.5556640625,20.8662109375]]],[[[115.943359375,21.09765625],[116.0673828125,21.041015625],[115.943359375,21.09765625]]],[[[115.9267578125,20.982421875],[115.955078125,21],[115.9990234375,20.923828125]]],[[[110.556640625,20.328125],[110.5908203125,20.3828125],[110.556640625,20.328125]]],[[[112.775390625,21.564453125],[112.7138671875,21.673828125],[112.876953125,21.7734375],[112.822265625,21.65625],[112.775390625,21.564453125]]],[[[110.5185546875,21.0791015625],[110.5263671875,20.9169921875],[110.3564453125,20.98828125],[110.19921875,20.943359375],[110.306640625,21.0888671875],[110.4384765625,21.0595703125],[110.5185546875,21.0791015625]]],[[[110.5458984375,21.083984375],[110.431640625,21.181640625],[110.634765625,21.2109375],[110.5810546875,21.0927734375],[110.5458984375,21.083984375]]],[[[112.53125,21.583984375],[112.6640625,21.71484375],[112.5693359375,21.6201171875],[112.53125,21.583984375]]],[[[113.0263671875,21.8486328125],[113.0078125,21.8701171875],[113.044921875,21.8837890625]]],[[[112.435546875,21.6640625],[112.4658203125,21.6884765625],[112.458984375,21.650390625]]],[[[110.40625,20.6787109375],[110.4248046875,20.7119140625],[110.439453125,20.6806640625]]],[[[116.7705078125,20.7724609375],[116.912109375,20.7568359375],[116.86328125,20.58984375],[116.8818359375,20.734375],[116.7705078125,20.7724609375]]],[[[117.1455078125,23.45703125],[116.9443359375,23.42578125],[117.05859375,23.4736328125],[117.1455078125,23.45703125]]],[[[113.1435546875,21.83203125],[113.140625,21.8740234375],[113.2060546875,21.8720703125]]],[[[113.8291015625,22.1181640625],[113.8212890625,22.15625],[113.8291015625,22.1181640625]]],[[[113.5595703125,22.212890625],[113.56640625,22.0732421875],[113.4423828125,22.009765625],[113.3203125,21.91015625],[113.16015625,21.9697265625],[113.087890625,22.126953125],[113.0546875,22.00390625],[112.9453125,21.8427734375],[112.841796875,21.9208984375],[112.6474609375,21.7587890625],[112.439453125,21.8037109375],[112.263671875,21.6943359375],[112.189453125,21.79296875],[111.9560546875,21.7109375],[111.9140625,21.5966796875],[111.74609375,21.61328125],[111.6513671875,21.5126953125],[111.396484375,21.501953125],[111.28125,21.4169921875],[111.0615234375,21.4501953125],[110.908203125,21.3701171875],[110.7685546875,21.365234375],[110.6328125,21.2177734375],[110.4970703125,21.2177734375],[110.4013671875,21.1318359375],[110.2421875,21.0166015625],[110.177734375,20.9072265625],[110.328125,20.8486328125],[110.392578125,20.68359375],[110.55078125,20.47265625],[110.4365234375,20.2978515625],[110.220703125,20.251953125],[110.0830078125,20.2587890625],[109.9384765625,20.212890625],[109.8603515625,20.3857421875],[109.8251953125,20.5029296875],[109.7451171875,20.6220703125],[109.6552734375,20.904296875],[109.66796875,21.1220703125],[109.7646484375,21.2265625],[109.7578125,21.34765625],[109.90625,21.435546875],[109.7861328125,21.45703125],[109.744140625,21.6015625],[109.9033203125,21.6533203125],[109.9453125,21.84765625],[110.0703125,21.8583984375],[110.197265625,21.900390625],[110.3359375,21.888671875],[110.365234375,22.1259765625],[110.50390625,22.1435546875],[110.6298828125,22.1494140625],[110.7236328125,22.2958984375],[110.7138671875,22.439453125],[110.7607421875,22.5830078125],[110.8876953125,22.583984375],[111.0556640625,22.6494140625],[111.21875,22.7490234375],[111.359375,22.8896484375],[111.4345703125,23.0390625],[111.3662109375,23.1455078125],[111.3505859375,23.2734375],[111.400390625,23.4697265625],[111.4873046875,23.626953125],[111.6162109375,23.6396484375],[111.6552734375,23.833984375],[111.8115234375,23.8076171875],[111.8544921875,23.9482421875],[111.880859375,24.1044921875],[111.8779296875,24.2275390625],[112.0625,24.3681640625],[111.986328125,24.466796875],[111.927734375,24.6298828125],[112.0146484375,24.732421875],[112.1669921875,24.8544921875],[112.1220703125,24.9853515625],[112.1884765625,25.1845703125],[112.365234375,25.1923828125],[112.5078125,25.1376953125],[112.66015625,25.1328125],[112.7158203125,25.0263671875],[112.78125,24.8974609375],[113.0126953125,24.9462890625],[113.0185546875,25.083984375],[112.9931640625,25.248046875],[112.869140625,25.2490234375],[112.96875,25.3505859375],[113.0927734375,25.41796875],[113.2294921875,25.51171875],[113.3603515625,25.4384765625],[113.5439453125,25.3681640625],[113.748046875,25.3662109375],[113.87890625,25.3818359375],[114.0009765625,25.4443359375],[114.056640625,25.3115234375],[114.3017578125,25.2900390625],[114.4287109375,25.341796875],[114.541015625,25.41796875],[114.6279296875,25.3310546875],[114.7421875,25.27734375],[114.736328125,25.1552734375],[114.640625,25.07421875],[114.5107421875,25.0029296875],[114.396484375,24.951171875],[114.34375,24.8115234375],[114.2734375,24.701171875],[114.3046875,24.5751953125],[114.40234375,24.4990234375],[114.5322265625,24.5595703125],[114.666015625,24.583984375],[114.8271484375,24.5888671875],[114.9404296875,24.650390625],[115.0546875,24.7099609375],[115.279296875,24.7548828125],[115.4072265625,24.7939453125],[115.52734375,24.7158203125],[115.671875,24.60546875],[115.8447265625,24.5634765625],[115.76171875,24.6689453125],[115.79296875,24.8369140625],[115.9072265625,24.880859375],[116.0908203125,24.8388671875],[116.22265625,24.830078125],[116.3623046875,24.8701171875],[116.4423828125,24.7177734375],[116.5263671875,24.60546875],[116.802734375,24.6767578125],[116.7568359375,24.55078125],[116.8603515625,24.4638671875],[116.9150390625,24.2880859375],[116.9990234375,24.1806640625],[116.953125,24.0556640625],[116.955078125,23.9208984375],[117.0556640625,23.6943359375],[117.19140625,23.6337890625],[117.044921875,23.5400390625],[116.921875,23.533203125],[116.8720703125,23.4130859375],[116.783203125,23.314453125],[116.666015625,23.158203125],[116.5517578125,23.1103515625],[116.5361328125,22.990234375],[116.3828125,22.919921875],[116.10546875,22.8173828125],[115.9599609375,22.796875],[115.8193359375,22.7314453125],[115.64453125,22.8642578125],[115.5419921875,22.7587890625],[115.3828125,22.68359375],[115.232421875,22.7763671875],[115.0576171875,22.7802734375],[114.9384765625,22.6376953125],[114.74609375,22.5830078125],[114.7529296875,22.759765625],[114.59765625,22.728515625],[114.5595703125,22.5771484375],[114.5078125,22.439453125],[114.3896484375,22.603515625],[114.2333984375,22.541015625],[114.0576171875,22.5],[113.888671875,22.443359375],[113.74609375,22.7265625],[113.7412109375,22.53515625],[113.6318359375,22.4765625],[113.60546875,22.3408203125],[113.5595703125,22.212890625]]]]}},{"type":"Feature","properties":{"name":"广西"},"geometry":{"type":"MultiPolygon","coordinates":[[[[109.0888671875,21.015625],[109.0927734375,21.0576171875],[109.1396484375,21.0673828125]]],[[[105.0966796875,24.9287109375],[105.2099609375,24.99609375],[105.4287109375,24.931640625],[105.498046875,24.8095703125],[105.8056640625,24.7021484375],[105.939453125,24.7265625],[106.0234375,24.6328125],[106.1728515625,24.7607421875],[106.1982421875,24.88671875],[106.3056640625,24.974609375],[106.439453125,25.017578125],[106.5908203125,25.087890625],[106.888671875,25.1826171875],[106.998046875,25.2412109375],[106.9638671875,25.4375],[107.0703125,25.5126953125],[107.2294921875,25.60546875],[107.3291015625,25.4970703125],[107.4208984375,25.3935546875],[107.47265625,25.2138671875],[107.5986328125,25.25],[107.75390625,25.2421875],[107.7666015625,25.1181640625],[108.001953125,25.197265625],[108.15234375,25.318359375],[108.158203125,25.44140625],[108.3330078125,25.5380859375],[108.4287109375,25.4375],[108.623046875,25.306640625],[108.587890625,25.421875],[108.69140625,25.51953125],[108.7841796875,25.62890625],[108.8984375,25.541015625],[109.025390625,25.5126953125],[109.03125,25.6328125],[108.900390625,25.6826171875],[109.0009765625,25.7607421875],[109.1181640625,25.8095703125],[109.28125,25.71484375],[109.33984375,25.833984375],[109.431640625,25.9267578125],[109.6357421875,26.0478515625],[109.6826171875,25.93359375],[109.7890625,25.8681640625],[109.783203125,25.9892578125],[109.9072265625,26.1455078125],[110.0400390625,26.1630859375],[110.0986328125,26.01953125],[110.24609375,26.0224609375],[110.3779296875,26.0947265625],[110.4716796875,26.1787109375],[110.5537109375,26.2841796875],[110.7119140625,26.2919921875],[110.9150390625,26.2763671875],[110.974609375,26.3857421875],[111.20703125,26.3076171875],[111.2587890625,26.15234375],[111.21484375,26.0205078125],[111.25,25.8671875],[111.4921875,25.869140625],[111.30859375,25.71875],[111.29296875,25.4365234375],[111.103515625,25.28515625],[110.9990234375,25.162109375],[110.9521484375,25.0439453125],[110.9794921875,24.9150390625],[111.09765625,24.94140625],[111.201171875,25.0751953125],[111.322265625,25.10546875],[111.46875,25.01953125],[111.4501953125,24.857421875],[111.4326171875,24.6845703125],[111.560546875,24.6396484375],[111.642578125,24.73046875],[111.998046875,24.759765625],[111.9541015625,24.6474609375],[111.986328125,24.466796875],[112.0615234375,24.35546875],[111.986328125,24.2578125],[111.880859375,24.1044921875],[111.94140625,23.982421875],[111.8486328125,23.90625],[111.6552734375,23.833984375],[111.666015625,23.7001953125],[111.4873046875,23.626953125],[111.4296875,23.466796875],[111.3623046875,23.3310546875],[111.3994140625,23.16015625],[111.4345703125,23.0390625],[111.359375,22.8896484375],[111.21875,22.7490234375],[111.05859375,22.73046875],[110.9599609375,22.63671875],[110.833984375,22.5849609375],[110.748046875,22.4736328125],[110.7900390625,22.287109375],[110.6552734375,22.240234375],[110.50390625,22.1435546875],[110.3818359375,22.1650390625],[110.353515625,21.9765625],[110.2548828125,21.880859375],[110.1279296875,21.9033203125],[109.9873046875,21.8798828125],[109.9423828125,21.736328125],[109.8017578125,21.6279296875],[109.7861328125,21.45703125],[109.6025390625,21.5595703125],[109.24609375,21.42578125],[109.0390625,21.4443359375],[109.1474609375,21.5185546875],[108.9384765625,21.58984375],[108.7958984375,21.6259765625],[108.6767578125,21.5888671875],[108.5810546875,21.66796875],[108.4794921875,21.5478515625],[108.330078125,21.541015625],[108.208984375,21.501953125],[108.03515625,21.5458984375],[107.861328125,21.65234375],[107.6142578125,21.59765625],[107.4873046875,21.5966796875],[107.306640625,21.73828125],[107.09375,21.8037109375],[107.0283203125,21.94140625],[106.814453125,21.9765625],[106.681640625,21.9951171875],[106.6923828125,22.1357421875],[106.6943359375,22.275390625],[106.5625,22.345703125],[106.5888671875,22.4736328125],[106.615234375,22.6025390625],[106.7294921875,22.642578125],[106.83984375,22.802734375],[106.7177734375,22.8818359375],[106.5263671875,22.947265625],[106.375,22.880859375],[106.2119140625,22.9755859375],[106.0205078125,22.9912109375],[105.884765625,22.916015625],[105.7421875,23.03125],[105.5751953125,23.06640625],[105.5283203125,23.2451171875],[105.650390625,23.3466796875],[105.7587890625,23.4599609375],[105.986328125,23.490234375],[106.1416015625,23.5703125],[106.158203125,23.7099609375],[106.1923828125,23.8251953125],[106.08203125,23.9931640625],[106.01171875,24.1005859375],[105.892578125,24.041015625],[105.765625,24.07421875],[105.62890625,24.126953125],[105.4931640625,24.017578125],[105.3203125,24.1171875],[105.1826171875,24.1337890625],[105.16015625,24.2802734375],[105.1083984375,24.4140625],[104.935546875,24.4091796875],[104.755859375,24.4580078125],[104.7216796875,24.3408203125],[104.6171875,24.421875],[104.5205078125,24.5361328125],[104.451171875,24.638671875],[104.5302734375,24.7314453125],[104.62890625,24.662109375],[104.7646484375,24.6572265625],[104.8759765625,24.740234375],[105.0341796875,24.7880859375],[105.0966796875,24.9287109375]]]]}},{"type":"Feature","properties":{"name":"海南"},"geometry":{"type":"Polygon","coordinates":[[[110.107421875,20.02734375],[110.2900390625,20.056640625],[110.52734375,20.076171875],[110.6982421875,20.1630859375],[110.822265625,20.0263671875],[110.9619140625,20.0244140625],[111.044921875,19.763671875],[111.0693359375,19.619140625],[110.9208984375,19.552734375],[110.82421875,19.4296875],[110.6767578125,19.287109375],[110.6201171875,19.15234375],[110.587890625,18.8056640625],[110.5,18.65234375],[110.26171875,18.619140625],[110.1171875,18.5068359375],[110.0810546875,18.3828125],[109.794921875,18.3447265625],[109.7412109375,18.185546875],[109.5849609375,18.14453125],[109.3564453125,18.2158203125],[109.1484375,18.2626953125],[108.953125,18.30859375],[108.8837890625,18.416015625],[108.6591796875,18.462890625],[108.658203125,18.7275390625],[108.587890625,18.8388671875],[108.5927734375,19.1064453125],[108.6064453125,19.265625],[108.6650390625,19.375],[109.048828125,19.6201171875],[109.1552734375,19.7109375],[109.255859375,19.8681640625],[109.4990234375,19.8740234375],[109.6640625,20.013671875],[109.9423828125,19.99609375],[110.107421875,20.02734375]]]}},{"type":"Feature","properties":{"name":"四川"},"geometry":{"type":"MultiPolygon","coordinates":[[[[106.2646484375,30.2099609375],[106.2705078125,30.185546875],[106.2646484375,30.2099609375]]],[[[108.0244140625,31.0654296875],[107.9375,30.96875],[107.8515625,30.7939453125],[107.71875,30.888671875],[107.5771484375,30.8486328125],[107.4248046875,30.7412109375],[107.5166015625,30.6435546875],[107.3603515625,30.45703125],[107.2216796875,30.2138671875],[107.103515625,30.0908203125],[106.9765625,30.08984375],[106.8388671875,30.05078125],[106.69921875,30.076171875],[106.607421875,30.2314453125],[106.44140625,30.3095703125],[106.3349609375,30.2265625],[106.20703125,30.205078125],[106.125,30.3251953125],[105.9423828125,30.3720703125],[105.8203125,30.4384765625],[105.7421875,30.3193359375],[105.6259765625,30.2763671875],[105.537109375,30.1669921875],[105.642578125,30.1015625],[105.748046875,30.033203125],[105.7392578125,29.8916015625],[105.619140625,29.8466796875],[105.56640625,29.724609375],[105.3896484375,29.6767578125],[105.2900390625,29.552734375],[105.390625,29.45703125],[105.4208984375,29.3125],[105.6064453125,29.275390625],[105.7041015625,29.177734375],[105.7578125,29.0693359375],[105.8095703125,28.95703125],[105.986328125,28.9794921875],[106.146484375,28.90234375],[106.265625,28.84765625],[106.3466796875,28.5859375],[106.193359375,28.578125],[106.083984375,28.6845703125],[105.96875,28.76171875],[105.8896484375,28.6708984375],[105.78515625,28.611328125],[105.685546875,28.53515625],[105.6611328125,28.365234375],[105.7880859375,28.3095703125],[105.890625,28.2373046875],[105.98046875,28.1064453125],[106.123046875,28.16796875],[106.267578125,28.0673828125],[106.3291015625,27.9580078125],[106.3173828125,27.8369140625],[106.064453125,27.77734375],[105.9326171875,27.7275390625],[105.73828125,27.7119140625],[105.60546875,27.7158203125],[105.48046875,27.775390625],[105.3544921875,27.7490234375],[105.2451171875,27.8232421875],[105.2724609375,27.9970703125],[105.0498046875,28.099609375],[104.9052734375,27.96484375],[104.767578125,27.884765625],[104.572265625,27.8408203125],[104.396484375,27.955078125],[104.298828125,28.0458984375],[104.4501953125,28.1142578125],[104.462890625,28.2421875],[104.37109375,28.337890625],[104.2548828125,28.404296875],[104.248046875,28.5263671875],[104.42578125,28.626953125],[104.24609375,28.6640625],[104.1220703125,28.63671875],[103.951171875,28.6015625],[103.7822265625,28.525390625],[103.875,28.306640625],[103.7724609375,28.234375],[103.6328125,28.2607421875],[103.4521484375,28.123046875],[103.515625,27.9658203125],[103.490234375,27.7978515625],[103.2802734375,27.6328125],[103.1435546875,27.4228515625],[102.9853515625,27.3681640625],[102.8828125,27.296875],[102.9140625,27.134765625],[102.8955078125,27],[102.970703125,26.8330078125],[103.005859375,26.6787109375],[103.056640625,26.5458984375],[102.98828125,26.3486328125],[102.833984375,26.3076171875],[102.716796875,26.2138671875],[102.6015625,26.2509765625],[102.5517578125,26.3623046875],[102.3935546875,26.296875],[102.248046875,26.2158203125],[102.1083984375,26.068359375],[101.955078125,26.0849609375],[101.8359375,26.0458984375],[101.6943359375,26.2421875],[101.630859375,26.361328125],[101.5087890625,26.5],[101.3984375,26.603515625],[101.513671875,26.76953125],[101.390625,26.7236328125],[101.3662109375,26.8837890625],[101.2646484375,26.9560546875],[101.1376953125,27.0224609375],[101.1708984375,27.1962890625],[101.04296875,27.2216796875],[101.0205078125,27.3447265625],[100.9375,27.4697265625],[100.85546875,27.6240234375],[100.771484375,27.7509765625],[100.681640625,27.923828125],[100.546875,27.8095703125],[100.4326171875,27.865234375],[100.3759765625,27.7548828125],[100.3095703125,27.861328125],[100.1689453125,27.8974609375],[100.0869140625,28.03125],[100.021484375,28.1474609375],[100.1689453125,28.2216796875],[100.056640625,28.3701171875],[99.994140625,28.47265625],[99.8779296875,28.6103515625],[99.7333984375,28.7197265625],[99.71875,28.8466796875],[99.615234375,28.7412109375],[99.541015625,28.6240234375],[99.4033203125,28.5458984375],[99.4375,28.40234375],[99.41796875,28.275390625],[99.4033203125,28.1513671875],[99.3076171875,28.228515625],[99.17578125,28.40234375],[99.1845703125,28.58984375],[99.1279296875,28.697265625],[99.1328125,28.94921875],[99.10546875,29.1630859375],[99.0673828125,29.30078125],[99.052734375,29.564453125],[99.013671875,29.818359375],[99.0693359375,29.927734375],[99.044921875,30.080078125],[98.9755859375,30.3916015625],[98.9052734375,30.69140625],[98.78125,30.8935546875],[98.736328125,31.05078125],[98.6015625,31.1904296875],[98.6376953125,31.3369140625],[98.7763671875,31.2490234375],[98.8876953125,31.375],[98.619140625,31.591796875],[98.5478515625,31.716796875],[98.4443359375,31.828125],[98.435546875,32.0087890625],[98.3125,32.111328125],[98.2197265625,32.234375],[97.9375,32.4853515625],[97.701171875,32.53515625],[97.6064453125,32.6162109375],[97.423828125,32.705078125],[97.3896484375,32.865234375],[97.5244140625,32.9892578125],[97.48828125,33.107421875],[97.5771484375,33.22265625],[97.625,33.33984375],[97.7587890625,33.4033203125],[97.6298828125,33.4609375],[97.5126953125,33.51953125],[97.416015625,33.6064453125],[97.423828125,33.755859375],[97.392578125,33.8896484375],[97.638671875,33.921875],[97.703125,34.037109375],[97.7744140625,34.1630859375],[97.9453125,34.19921875],[98.099609375,34.123046875],[98.40234375,34.087890625],[98.41015625,33.9423828125],[98.4921875,33.771484375],[98.6572265625,33.65234375],[98.7431640625,33.4765625],[98.7841796875,33.345703125],[98.8046875,33.2197265625],[99.0029296875,33.0830078125],[99.1953125,33.0361328125],[99.2685546875,32.87890625],[99.556640625,32.8408203125],[99.705078125,32.765625],[99.79296875,32.8837890625],[99.8779296875,33.0458984375],[99.95703125,32.9482421875],[100.0703125,32.89453125],[100.138671875,32.7216796875],[100.2158203125,32.607421875],[100.2587890625,32.7431640625],[100.400390625,32.7568359375],[100.544921875,32.5703125],[100.6640625,32.5224609375],[100.6875,32.677734375],[100.8369140625,32.6494140625],[101.068359375,32.681640625],[101.1904296875,32.6875],[101.23828125,32.828125],[101.1240234375,32.912109375],[101.1845703125,33.0419921875],[101.1162109375,33.1962890625],[101.2978515625,33.2626953125],[101.3837890625,33.1533203125],[101.48828125,33.2275390625],[101.6328125,33.1015625],[101.7412109375,33.26953125],[101.6630859375,33.3818359375],[101.7763671875,33.4521484375],[101.8447265625,33.6025390625],[101.9033203125,33.48828125],[101.8779296875,33.3154296875],[101.7685546875,33.263671875],[101.826171875,33.1201171875],[101.9365234375,33.1875],[102.083984375,33.1953125],[102.2099609375,33.2255859375],[102.263671875,33.41796875],[102.3955078125,33.4052734375],[102.4462890625,33.5302734375],[102.33984375,33.6123046875],[102.3232421875,33.7578125],[102.25390625,33.8623046875],[102.1396484375,33.9716796875],[102.30859375,33.9951171875],[102.4384765625,34.087890625],[102.6083984375,34.1015625],[102.7021484375,34.197265625],[102.798828125,34.2734375],[102.912109375,34.3134765625],[102.9775390625,34.19921875],[103.109375,34.177734375],[103.1796875,34.080078125],[103.1240234375,33.9423828125],[103.158203125,33.8095703125],[103.279296875,33.7744140625],[103.4326171875,33.7509765625],[103.537109375,33.671875],[103.6669921875,33.7197265625],[104.052734375,33.685546875],[104.1689453125,33.6123046875],[104.2216796875,33.4052734375],[104.3740234375,33.345703125],[104.3779296875,33.109375],[104.3671875,32.9443359375],[104.294921875,32.8359375],[104.4580078125,32.7490234375],[104.6455078125,32.662109375],[104.830078125,32.6630859375],[105.0302734375,32.6513671875],[105.14453125,32.6015625],[105.2958984375,32.65625],[105.4560546875,32.7373046875],[105.380859375,32.8779296875],[105.5,32.912109375],[105.533203125,32.79296875],[105.7197265625,32.759765625],[105.826171875,32.826171875],[105.96875,32.849609375],[106.09375,32.82421875],[106.255859375,32.6943359375],[106.404296875,32.6181640625],[106.5859375,32.6884765625],[106.7333984375,32.740234375],[106.8662109375,32.7255859375],[107.0634765625,32.7119140625],[107.083984375,32.533203125],[107.1904296875,32.46875],[107.3779296875,32.5390625],[107.45703125,32.41796875],[107.5986328125,32.412109375],[107.70703125,32.333984375],[107.8330078125,32.2265625],[107.978515625,32.146484375],[108.072265625,32.234375],[108.2421875,32.275390625],[108.4765625,32.2685546875],[108.3701171875,32.17578125],[108.4501953125,32.0732421875],[108.330078125,32.01953125],[108.34375,31.861328125],[108.5361328125,31.7578125],[108.4658203125,31.619140625],[108.33984375,31.5390625],[108.19140625,31.4921875],[108.154296875,31.3720703125],[108.01953125,31.2451171875],[108.009765625,31.1103515625],[108.0244140625,31.0654296875]]]]}},{"type":"Feature","properties":{"name":"贵州"},"geometry":{"type":"MultiPolygon","coordinates":[[[[109.529296875,26.7412109375],[109.5634765625,26.7373046875],[109.5771484375,26.771484375]]],[[[109.4775390625,26.830078125],[109.453125,26.8623046875],[109.482421875,26.8974609375]]],[[[109.4677734375,26.83203125],[109.4130859375,26.720703125],[109.2841796875,26.69921875],[109.4091796875,26.537109375],[109.3232421875,26.423828125],[109.33984375,26.2646484375],[109.466796875,26.314453125],[109.4765625,26.1484375],[109.40625,25.96484375],[109.3681640625,25.8408203125],[109.28125,25.71484375],[109.177734375,25.8056640625],[108.998046875,25.78515625],[108.8984375,25.716796875],[109.080078125,25.720703125],[109.0478515625,25.572265625],[108.8271484375,25.55078125],[108.689453125,25.6240234375],[108.6083984375,25.4921875],[108.625,25.3076171875],[108.5009765625,25.4482421875],[108.3330078125,25.5380859375],[108.25,25.427734375],[108.15234375,25.318359375],[108.001953125,25.197265625],[107.8427734375,25.1162109375],[107.7626953125,25.2294921875],[107.6650390625,25.3154296875],[107.517578125,25.2080078125],[107.408203125,25.3525390625],[107.328125,25.4990234375],[107.236328125,25.59375],[107.0654296875,25.5595703125],[106.9970703125,25.443359375],[106.998046875,25.2412109375],[106.888671875,25.1826171875],[106.654296875,25.1689453125],[106.439453125,25.017578125],[106.3056640625,24.974609375],[106.1533203125,24.9619140625],[106.1982421875,24.8134765625],[106.0478515625,24.6845703125],[105.8642578125,24.73046875],[105.599609375,24.8076171875],[105.443359375,24.921875],[105.267578125,24.9296875],[105.0751953125,24.9169921875],[105.0341796875,24.7880859375],[104.8935546875,24.75],[104.7646484375,24.6572265625],[104.5302734375,24.7314453125],[104.7138671875,24.998046875],[104.748046875,25.21484375],[104.640625,25.2958984375],[104.5400390625,25.4052734375],[104.556640625,25.525390625],[104.435546875,25.47265625],[104.33203125,25.6005859375],[104.328125,25.759765625],[104.431640625,25.822265625],[104.470703125,26.009765625],[104.54296875,26.25390625],[104.6591796875,26.3349609375],[104.615234375,26.509765625],[104.46484375,26.595703125],[104.421875,26.712890625],[104.12890625,26.64453125],[104.07421875,26.5234375],[103.8212890625,26.529296875],[103.7724609375,26.7265625],[103.72265625,26.8515625],[103.7060546875,27.0498046875],[103.802734375,27.267578125],[103.93359375,27.4443359375],[104.130859375,27.3271484375],[104.2548828125,27.294921875],[104.3623046875,27.46875],[104.517578125,27.400390625],[104.611328125,27.3076171875],[104.7548828125,27.345703125],[104.8720703125,27.291015625],[105.0712890625,27.419921875],[105.19140625,27.3720703125],[105.2607421875,27.515625],[105.3017578125,27.6962890625],[105.4423828125,27.7763671875],[105.55859375,27.7216796875],[105.7666015625,27.71875],[105.921875,27.7470703125],[106.064453125,27.77734375],[106.1943359375,27.7548828125],[106.333984375,27.8154296875],[106.3291015625,27.9580078125],[106.267578125,28.0673828125],[106.1259765625,28.16796875],[105.98046875,28.1064453125],[105.8603515625,28.16796875],[105.7880859375,28.3359375],[105.640625,28.3115234375],[105.6103515625,28.4443359375],[105.693359375,28.5888671875],[105.9052734375,28.6064453125],[105.96875,28.76171875],[106.083984375,28.6845703125],[106.205078125,28.568359375],[106.3310546875,28.482421875],[106.484375,28.53125],[106.5029296875,28.6611328125],[106.455078125,28.7763671875],[106.5869140625,28.6884765625],[106.6162109375,28.5498046875],[106.693359375,28.45703125],[106.783203125,28.568359375],[106.8896484375,28.6953125],[106.9248046875,28.810546875],[107.0595703125,28.869140625],[107.1943359375,28.8896484375],[107.2490234375,28.7626953125],[107.3857421875,28.849609375],[107.3642578125,29.009765625],[107.427734375,29.1279296875],[107.5625,29.2216796875],[107.701171875,29.1416015625],[107.78515625,29.048828125],[107.8671875,28.958984375],[108.0244140625,29.0390625],[108.197265625,29.072265625],[108.3203125,28.9619140625],[108.353515625,28.81640625],[108.333984375,28.6767578125],[108.474609375,28.6279296875],[108.634765625,28.6376953125],[108.57421875,28.529296875],[108.578125,28.390625],[108.7236328125,28.4921875],[108.7841796875,28.37890625],[108.7626953125,28.19140625],[108.9228515625,28.2177734375],[109.0869140625,28.185546875],[109.1416015625,28.3212890625],[109.2021484375,28.4775390625],[109.2890625,28.3740234375],[109.35546875,28.265625],[109.298828125,28.037109375],[109.34765625,27.8388671875],[109.4150390625,27.7255859375],[109.462890625,27.56640625],[109.3125,27.486328125],[109.15625,27.4169921875],[109.046875,27.3349609375],[108.908203125,27.2080078125],[108.791015625,27.0849609375],[108.8759765625,27],[109.0869140625,27.1181640625],[109.2490234375,27.154296875],[109.400390625,27.16015625],[109.521484375,27.072265625],[109.5556640625,26.947265625],[109.4365234375,26.8935546875],[109.4677734375,26.83203125]]]]}},{"type":"Feature","properties":{"name":"云南"},"geometry":{"type":"Polygon","coordinates":[[[102.18359375,22.4306640625],[102.041015625,22.458984375],[101.908203125,22.4375],[101.7646484375,22.5068359375],[101.6474609375,22.40625],[101.6259765625,22.283203125],[101.603515625,22.1328125],[101.626953125,22.0068359375],[101.701171875,21.8974609375],[101.748046875,21.73046875],[101.8291015625,21.6171875],[101.7412109375,21.4833984375],[101.73046875,21.337890625],[101.8349609375,21.2470703125],[101.7568359375,21.1435546875],[101.6005859375,21.173828125],[101.3876953125,21.2265625],[101.2265625,21.2265625],[101.1435546875,21.4091796875],[101.2255859375,21.501953125],[101.154296875,21.6689453125],[101.08984375,21.7744140625],[100.8857421875,21.6845703125],[100.7314453125,21.51953125],[100.5791015625,21.4521484375],[100.4296875,21.541015625],[100.31640625,21.4892578125],[100.1689453125,21.4833984375],[100.1083984375,21.5908203125],[100.0341796875,21.6923828125],[99.9482421875,21.810546875],[100,21.97265625],[99.8720703125,22.0673828125],[99.705078125,22.0380859375],[99.5166015625,22.099609375],[99.3916015625,22.099609375],[99.2646484375,22.1015625],[99.15625,22.16015625],[99.234375,22.296875],[99.3828125,22.494140625],[99.3154296875,22.7373046875],[99.4638671875,22.845703125],[99.5634765625,22.92578125],[99.5302734375,23.0556640625],[99.3935546875,23.0947265625],[99.255859375,23.078125],[99.107421875,23.0869140625],[98.8857421875,23.1806640625],[98.9375,23.310546875],[98.875,23.4833984375],[98.8857421875,23.6142578125],[98.79296875,23.7783203125],[98.6689453125,23.80078125],[98.701171875,23.947265625],[98.853515625,24.0576171875],[98.716796875,24.1279296875],[98.5947265625,24.0810546875],[98.361328125,24.09765625],[98.2236328125,24.1142578125],[97.90234375,24.0146484375],[97.796875,23.953125],[97.71484375,23.86328125],[97.5283203125,23.927734375],[97.62890625,24.0029296875],[97.7314453125,24.1123046875],[97.765625,24.2626953125],[97.6630859375,24.33984375],[97.5302734375,24.4423828125],[97.5751953125,24.65625],[97.7021484375,24.8427734375],[97.720703125,25.0810546875],[97.837890625,25.2705078125],[98.0126953125,25.3037109375],[98.103515625,25.392578125],[98.1318359375,25.5107421875],[98.2587890625,25.603515625],[98.40234375,25.5947265625],[98.4794921875,25.7841796875],[98.6416015625,25.7998046875],[98.681640625,25.935546875],[98.576171875,26.1181640625],[98.720703125,26.1279296875],[98.673828125,26.240234375],[98.7333984375,26.3505859375],[98.75390625,26.5595703125],[98.771484375,26.6904296875],[98.7314453125,26.8505859375],[98.7333984375,27.0029296875],[98.6923828125,27.19921875],[98.7412109375,27.3291015625],[98.70703125,27.5546875],[98.5595703125,27.64453125],[98.439453125,27.666015625],[98.375,27.5087890625],[98.302734375,27.62890625],[98.24609375,27.736328125],[98.1728515625,27.83984375],[98.138671875,27.9599609375],[98.1611328125,28.099609375],[98.2666015625,28.2412109375],[98.205078125,28.3486328125],[98.3779296875,28.25],[98.400390625,28.10546875],[98.5595703125,28.18359375],[98.712890625,28.2294921875],[98.6748046875,28.4794921875],[98.5947265625,28.669921875],[98.6533203125,28.8115234375],[98.623046875,28.9638671875],[98.7578125,29.0048828125],[98.841796875,28.8037109375],[98.970703125,28.8291015625],[98.9267578125,28.978515625],[98.9638671875,29.142578125],[99.1142578125,29.2216796875],[99.1328125,28.94921875],[99.1044921875,28.814453125],[99.1845703125,28.58984375],[99.1875,28.4404296875],[99.23828125,28.318359375],[99.404296875,28.1533203125],[99.41796875,28.275390625],[99.4375,28.40234375],[99.4033203125,28.5458984375],[99.541015625,28.6240234375],[99.615234375,28.7412109375],[99.71875,28.8466796875],[99.7333984375,28.7197265625],[99.841796875,28.658203125],[99.94921875,28.5791015625],[100.0751953125,28.42578125],[100.1767578125,28.3251953125],[100.0888671875,28.1806640625],[100.0869140625,28.03125],[100.1923828125,27.947265625],[100.3095703125,27.861328125],[100.2998046875,27.736328125],[100.4326171875,27.865234375],[100.546875,27.8095703125],[100.6337890625,27.9150390625],[100.7080078125,27.8017578125],[100.7900390625,27.6845703125],[100.912109375,27.5224609375],[101.0205078125,27.3447265625],[101.04296875,27.2216796875],[101.1708984375,27.1962890625],[101.1376953125,27.0224609375],[101.2646484375,26.9560546875],[101.3662109375,26.8837890625],[101.3896484375,26.7529296875],[101.513671875,26.76953125],[101.462890625,26.607421875],[101.6376953125,26.3955078125],[101.5947265625,26.26171875],[101.80859375,26.16015625],[101.91796875,26.1083984375],[102.1083984375,26.068359375],[102.248046875,26.2158203125],[102.3935546875,26.296875],[102.53125,26.3330078125],[102.6748046875,26.2060546875],[102.833984375,26.3076171875],[102.98828125,26.3486328125],[102.990234375,26.4833984375],[103.0283203125,26.66015625],[102.970703125,26.8330078125],[102.8955078125,27],[102.9140625,27.134765625],[102.8828125,27.296875],[102.9482421875,27.4130859375],[103.1005859375,27.3974609375],[103.22265625,27.56640625],[103.490234375,27.7978515625],[103.564453125,27.9765625],[103.435546875,28.0380859375],[103.6328125,28.2607421875],[103.7724609375,28.234375],[103.875,28.306640625],[103.8291015625,28.462890625],[103.837890625,28.5849609375],[104.060546875,28.6279296875],[104.2314453125,28.63671875],[104.375,28.6494140625],[104.248046875,28.5263671875],[104.2548828125,28.404296875],[104.37109375,28.337890625],[104.462890625,28.2421875],[104.4501953125,28.1142578125],[104.298828125,28.0458984375],[104.396484375,27.955078125],[104.5068359375,27.87890625],[104.744140625,27.90234375],[104.8857421875,27.912109375],[104.9736328125,28.017578125],[105.177734375,28.0673828125],[105.28515625,27.9345703125],[105.31640625,27.8173828125],[105.3056640625,27.6142578125],[105.1875,27.369140625],[105.078125,27.4208984375],[104.8720703125,27.291015625],[104.75390625,27.345703125],[104.611328125,27.3076171875],[104.4970703125,27.4150390625],[104.357421875,27.4677734375],[104.248046875,27.3359375],[104.021484375,27.3759765625],[103.8662109375,27.2822265625],[103.7080078125,27.1611328125],[103.6171875,27.080078125],[103.7783203125,26.9462890625],[103.703125,26.8134765625],[103.7490234375,26.625],[104.052734375,26.5078125],[104.12890625,26.64453125],[104.349609375,26.6201171875],[104.4677734375,26.65234375],[104.5703125,26.525390625],[104.666015625,26.4345703125],[104.5927734375,26.3173828125],[104.52734375,26.1005859375],[104.4150390625,25.912109375],[104.3740234375,25.732421875],[104.33203125,25.6005859375],[104.435546875,25.47265625],[104.556640625,25.525390625],[104.5400390625,25.4052734375],[104.640625,25.2958984375],[104.81640625,25.2626953125],[104.6865234375,25.0771484375],[104.546875,24.82421875],[104.498046875,24.666015625],[104.5205078125,24.5361328125],[104.578125,24.4208984375],[104.7021484375,24.3212890625],[104.7177734375,24.443359375],[104.935546875,24.4091796875],[105.1083984375,24.4140625],[105.16015625,24.2802734375],[105.228515625,24.1640625],[105.4130859375,24.0390625],[105.529296875,24.12890625],[105.650390625,24.033203125],[105.7734375,24.07421875],[105.8994140625,24.0439453125],[106.0078125,24.125],[106.095703125,24.0234375],[106.15625,23.89453125],[106.158203125,23.7099609375],[106.1416015625,23.5703125],[106,23.4482421875],[105.8525390625,23.52734375],[105.7001953125,23.40234375],[105.59375,23.3134765625],[105.54296875,23.1845703125],[105.4462890625,23.29296875],[105.326171875,23.390625],[105.23828125,23.2646484375],[105.1162109375,23.2470703125],[104.998046875,23.1962890625],[104.875,23.1240234375],[104.8623046875,22.9404296875],[104.7333984375,22.8525390625],[104.6015625,22.8134765625],[104.3701171875,22.689453125],[104.26171875,22.8427734375],[104.1181640625,22.8095703125],[104.013671875,22.5234375],[103.87890625,22.564453125],[103.6435546875,22.794921875],[103.57421875,22.642578125],[103.435546875,22.69921875],[103.32421875,22.80859375],[103.283203125,22.6787109375],[103.1611328125,22.591796875],[103.078125,22.447265625],[102.9296875,22.484375],[102.8623046875,22.6064453125],[102.6923828125,22.7001953125],[102.5712890625,22.701171875],[102.458984375,22.76171875],[102.4208984375,22.634765625],[102.302734375,22.5283203125],[102.18359375,22.4306640625]]]}},{"type":"Feature","properties":{"name":"西藏"},"geometry":{"type":"Polygon","coordinates":[[[88.7197265625,36.337890625],[88.9267578125,36.365234375],[89.1005859375,36.283203125],[89.2373046875,36.294921875],[89.3759765625,36.228515625],[89.490234375,36.1513671875],[89.7119140625,36.09375],[89.4765625,36.0224609375],[89.5546875,35.8798828125],[89.802734375,35.8486328125],[89.7490234375,35.6630859375],[89.7001953125,35.5458984375],[89.6865234375,35.4150390625],[89.505859375,35.3720703125],[89.4501953125,35.2275390625],[89.5927734375,35.109375],[89.560546875,34.939453125],[89.7099609375,34.9208984375],[89.8427734375,34.8642578125],[89.80859375,34.7490234375],[89.7265625,34.6611328125],[89.8154296875,34.548828125],[89.7998046875,34.3935546875],[89.8173828125,34.169921875],[89.6943359375,34.126953125],[89.6884765625,33.9599609375],[89.7958984375,33.8662109375],[89.9423828125,33.8017578125],[90.0087890625,33.6884765625],[90.08203125,33.53125],[90.244140625,33.4267578125],[90.36328125,33.2802734375],[90.48828125,33.2666015625],[90.701171875,33.1376953125],[90.8837890625,33.12109375],[91.009765625,33.1220703125],[91.1474609375,33.0732421875],[91.4365234375,33.06640625],[91.583984375,33.0380859375],[91.7861328125,32.9443359375],[91.9580078125,32.8203125],[92.14453125,32.8857421875],[92.19921875,32.7548828125],[92.3505859375,32.7421875],[92.5546875,32.7314453125],[92.6904296875,32.7666015625],[92.8779296875,32.697265625],[93.009765625,32.7421875],[93.06640625,32.6279296875],[93.2431640625,32.662109375],[93.3828125,32.5263671875],[93.5224609375,32.4736328125],[93.6533203125,32.5732421875],[93.8212890625,32.548828125],[93.9599609375,32.4853515625],[94.1376953125,32.4345703125],[94.29296875,32.5029296875],[94.3935546875,32.6044921875],[94.5390625,32.599609375],[94.7734375,32.5556640625],[94.892578125,32.4716796875],[95.0751953125,32.376953125],[95.21875,32.3974609375],[95.09765625,32.3232421875],[95.2412109375,32.3212890625],[95.2705078125,32.1953125],[95.439453125,32.1591796875],[95.455078125,32.0087890625],[95.4580078125,31.8017578125],[95.5654296875,31.740234375],[95.68359375,31.77734375],[95.8251953125,31.6826171875],[95.8994140625,31.8173828125],[96.0419921875,31.734375],[96.1611328125,31.6015625],[96.25390625,31.6943359375],[96.17578125,31.8251953125],[96.2529296875,31.9306640625],[96.384765625,31.9248046875],[96.4697265625,31.7705078125],[96.6162109375,31.7373046875],[96.775390625,31.6748046875],[96.7666015625,31.8193359375],[96.75390625,31.9443359375],[96.86328125,31.9970703125],[97.169921875,32.0244140625],[97.30859375,32.07421875],[97.2900390625,32.28125],[97.4248046875,32.3232421875],[97.341796875,32.4404296875],[97.3466796875,32.5625],[97.4736328125,32.544921875],[97.7578125,32.53125],[98.0244140625,32.453125],[98.1982421875,32.3603515625],[98.2197265625,32.234375],[98.3125,32.111328125],[98.435546875,32.0087890625],[98.4267578125,31.857421875],[98.517578125,31.7177734375],[98.619140625,31.591796875],[98.837890625,31.4375],[98.7763671875,31.2490234375],[98.6376953125,31.3369140625],[98.62109375,31.2041015625],[98.736328125,31.05078125],[98.78125,30.8935546875],[98.9052734375,30.783203125],[98.9755859375,30.3916015625],[98.986328125,30.158203125],[99.03515625,30.0205078125],[99.013671875,29.818359375],[98.9921875,29.6611328125],[99.0673828125,29.30078125],[99.0224609375,29.1884765625],[99.015625,29.04296875],[98.912109375,28.91015625],[98.841796875,28.8037109375],[98.7861328125,28.9990234375],[98.623046875,28.9638671875],[98.6533203125,28.8115234375],[98.5947265625,28.669921875],[98.638671875,28.552734375],[98.75390625,28.337890625],[98.626953125,28.166015625],[98.400390625,28.10546875],[98.3779296875,28.25],[98.283203125,28.39453125],[98.2666015625,28.2412109375],[98.1396484375,28.142578125],[98.013671875,28.203125],[97.9638671875,28.3134765625],[97.796875,28.328125],[97.7373046875,28.466796875],[97.6044921875,28.515625],[97.4833984375,28.3818359375],[97.40234375,28.279296875],[97.3603515625,28.1630859375],[97.37890625,28.03125],[97.38671875,27.8837890625],[97.2607421875,27.8955078125],[97.1025390625,27.7802734375],[96.974609375,27.861328125],[96.810546875,27.890625],[96.681640625,27.951171875],[96.5712890625,28.060546875],[96.4521484375,28.1533203125],[96.2978515625,28.1416015625],[96.013671875,28.1904296875],[95.875,28.2978515625],[95.3974609375,28.142578125],[95.287109375,27.9404296875],[95.0029296875,27.8232421875],[94.88671875,27.7431640625],[94.525390625,27.5966796875],[94.2783203125,27.58203125],[93.8623046875,27.1875],[93.8427734375,27.0458984375],[93.568359375,26.9384765625],[93.111328125,26.880859375],[92.91015625,26.9150390625],[92.6474609375,26.953125],[92.109375,26.85546875],[92.0283203125,27.091796875],[92.0771484375,27.2490234375],[92.060546875,27.40234375],[91.947265625,27.46484375],[91.7333984375,27.4638671875],[91.5849609375,27.541015625],[91.62890625,27.7021484375],[91.544921875,27.826171875],[91.4873046875,27.9384765625],[91.3134765625,28.060546875],[91.216796875,27.9892578125],[91.1142578125,27.8466796875],[90.9658203125,27.9013671875],[90.84765625,27.9697265625],[90.7021484375,28.076171875],[90.5927734375,28.021484375],[90.4638671875,28.0458984375],[90.296875,28.154296875],[90.125,28.19140625],[89.9765625,28.189453125],[89.8623046875,28.2265625],[89.607421875,28.1630859375],[89.5087890625,28.0849609375],[89.3759765625,27.876953125],[89.2392578125,27.796875],[89.1318359375,27.6337890625],[89.0966796875,27.4921875],[89.18359375,27.3740234375],[89.0732421875,27.283203125],[88.912109375,27.2734375],[88.8095703125,27.40625],[88.796875,27.5302734375],[88.8525390625,27.671875],[88.8623046875,27.80859375],[88.84375,28.0068359375],[88.6767578125,28.068359375],[88.5546875,28.0283203125],[88.40625,27.9775390625],[88.2548828125,27.9404296875],[88.12109375,27.916015625],[87.9833984375,27.884765625],[87.833984375,27.9482421875],[87.728515625,27.8037109375],[87.60546875,27.8125],[87.4560546875,27.8212890625],[87.2666015625,27.845703125],[87.1220703125,27.837890625],[87.03515625,27.947265625],[86.865234375,28.0224609375],[86.7109375,28.1015625],[86.5693359375,28.103515625],[86.513671875,27.9970703125],[86.416015625,27.9052734375],[86.2880859375,27.9765625],[86.205078125,28.0771484375],[86.0830078125,28.0869140625],[86.126953125,27.9248046875],[86.001953125,27.908203125],[85.9013671875,28.0537109375],[85.8544921875,28.1728515625],[85.716796875,28.380859375],[85.60546875,28.251953125],[85.505859375,28.330078125],[85.3798828125,28.2744140625],[85.208984375,28.33984375],[85.109375,28.4619140625],[85.1806640625,28.642578125],[85.0576171875,28.6748046875],[84.857421875,28.568359375],[84.69921875,28.6337890625],[84.5576171875,28.7470703125],[84.4345703125,28.82421875],[84.2275390625,28.8974609375],[84.2490234375,29.03125],[84.1767578125,29.134765625],[84.10546875,29.29296875],[83.9873046875,29.3251953125],[83.826171875,29.2978515625],[83.7197265625,29.2412109375],[83.5849609375,29.1787109375],[83.4541015625,29.2978515625],[83.3837890625,29.421875],[83.2763671875,29.5068359375],[83.1728515625,29.5908203125],[83.0166015625,29.66796875],[82.8310546875,29.6884765625],[82.6953125,29.7626953125],[82.5615234375,29.9560546875],[82.3388671875,30.044921875],[82.1787109375,30.068359375],[82.111328125,30.23046875],[81.998046875,30.3212890625],[81.7509765625,30.388671875],[81.630859375,30.447265625],[81.4189453125,30.4208984375],[81.4052734375,30.2900390625],[81.3359375,30.150390625],[81.248046875,30.033203125],[81.09765625,30.0498046875],[81.0166015625,30.259765625],[80.8173828125,30.322265625],[80.73046875,30.4091796875],[80.5458984375,30.4501953125],[80.4306640625,30.5166015625],[80.3095703125,30.5693359375],[80.13671875,30.556640625],[79.966796875,30.6904296875],[79.896484375,30.8046875],[79.7587890625,30.9375],[79.6015625,30.9228515625],[79.5048828125,31.029296875],[79.3173828125,31.0185546875],[79.1826171875,31.015625],[79.0068359375,31.048828125],[78.9951171875,31.1708984375],[78.869140625,31.3134765625],[78.755859375,31.3564453125],[78.7265625,31.482421875],[78.8466796875,31.6103515625],[78.70703125,31.779296875],[78.771484375,31.935546875],[78.5966796875,32.0234375],[78.5107421875,32.1474609375],[78.51171875,32.30859375],[78.4736328125,32.435546875],[78.396484375,32.5361328125],[78.578125,32.615234375],[78.7421875,32.7041015625],[78.7607421875,32.564453125],[78.81640625,32.4306640625],[78.970703125,32.3330078125],[79.103515625,32.3701171875],[79.19140625,32.51171875],[79.3095703125,32.599609375],[79.3017578125,32.7294921875],[79.2275390625,32.890625],[79.1630859375,33.0126953125],[79.158203125,33.1796875],[79.0419921875,33.2685546875],[78.9501953125,33.376953125],[78.7421875,33.5537109375],[78.78125,33.736328125],[78.765625,33.9072265625],[78.6572265625,34.03125],[78.8720703125,34.1640625],[78.9765625,34.3134765625],[79.0537109375,34.427734375],[79.2177734375,34.4150390625],[79.373046875,34.4287109375],[79.5146484375,34.4482421875],[79.646484375,34.447265625],[79.8203125,34.4931640625],[79.8876953125,34.6279296875],[79.9482421875,34.8212890625],[80.037109375,34.9033203125],[80.03125,35.0390625],[80.2099609375,35.123046875],[80.3603515625,35.2021484375],[80.2685546875,35.2958984375],[80.3779296875,35.3896484375],[80.513671875,35.392578125],[80.6572265625,35.39453125],[80.8447265625,35.345703125],[80.9638671875,35.3115234375],[81.099609375,35.408203125],[81.2158203125,35.3203125],[81.3642578125,35.35546875],[81.4951171875,35.29296875],[81.67578125,35.234375],[81.9287109375,35.271484375],[82.0546875,35.35546875],[82.1865234375,35.490234375],[82.3203125,35.5537109375],[82.3935546875,35.65625],[82.62890625,35.6923828125],[82.7978515625,35.689453125],[82.9609375,35.671875],[83,35.4853515625],[83.126953125,35.3994140625],[83.623046875,35.3359375],[83.8759765625,35.3642578125],[84.0068359375,35.4228515625],[84.1396484375,35.3798828125],[84.453125,35.4736328125],[84.7626953125,35.625],[85.03125,35.748046875],[85.2841796875,35.7880859375],[85.3740234375,35.701171875],[85.5087890625,35.6845703125],[85.65234375,35.73046875],[85.94921875,35.779296875],[86.060546875,35.8466796875],[86.146484375,36.0009765625],[86.1904296875,36.1328125],[86.3583984375,36.1689453125],[86.5078125,36.203125],[86.7001953125,36.2451171875],[86.86328125,36.30078125],[86.9970703125,36.3095703125],[87.1494140625,36.2978515625],[87.306640625,36.3642578125],[87.427734375,36.4267578125],[87.5625,36.3427734375],[87.732421875,36.3857421875],[87.919921875,36.39453125],[88.134765625,36.427734375],[88.26171875,36.4716796875],[88.470703125,36.482421875],[88.615234375,36.4345703125],[88.7197265625,36.337890625]]]}},{"type":"Feature","properties":{"name":"陕西"},"geometry":{"type":"Polygon","coordinates":[[[107.650390625,37.865234375],[107.982421875,37.7880859375],[108.0224609375,37.65234375],[108.2470703125,37.666015625],[108.533203125,37.69140625],[108.7783203125,37.68359375],[108.798828125,37.9345703125],[108.9384765625,37.9208984375],[109.0380859375,38.0224609375],[108.96484375,38.1552734375],[109.0087890625,38.359375],[109.27734375,38.623046875],[109.40234375,38.716796875],[109.51171875,38.833984375],[109.6845703125,38.935546875],[109.8515625,39.123046875],[109.9619140625,39.19140625],[110.21875,39.2802734375],[110.130859375,39.3984375],[110.2763671875,39.4248046875],[110.3857421875,39.310546875],[110.5224609375,39.3837890625],[110.6015625,39.2802734375],[110.8916015625,39.509765625],[111.029296875,39.5703125],[111.15625,39.5703125],[111.05859375,39.4482421875],[111.1533203125,39.3701171875],[111.138671875,39.064453125],[110.982421875,38.978515625],[111.0107421875,38.841796875],[110.880859375,38.626953125],[110.87109375,38.4521484375],[110.7470703125,38.3662109375],[110.5849609375,38.3046875],[110.5087890625,38.185546875],[110.51953125,37.9609375],[110.666015625,37.8017578125],[110.796875,37.6630859375],[110.7490234375,37.453125],[110.630859375,37.373046875],[110.5302734375,37.107421875],[110.41796875,37.03515625],[110.4091796875,36.892578125],[110.3837890625,36.7705078125],[110.4990234375,36.578125],[110.4501953125,36.1357421875],[110.517578125,35.97265625],[110.609375,35.6328125],[110.5322265625,35.44921875],[110.4501953125,35.328125],[110.326171875,35.015625],[110.23046875,34.8134765625],[110.2421875,34.6826171875],[110.3798828125,34.6005859375],[110.41015625,34.421875],[110.5029296875,34.345703125],[110.642578125,34.1611328125],[110.58203125,34.04296875],[110.677734375,33.9501953125],[110.7421875,33.798828125],[110.8388671875,33.6669921875],[111.00390625,33.5791015625],[110.9970703125,33.4365234375],[110.9951171875,33.2509765625],[110.8310546875,33.203125],[110.7119140625,33.0966796875],[110.6015625,33.1552734375],[110.4716796875,33.171875],[110.333984375,33.16015625],[110.1650390625,33.2099609375],[110.03125,33.1923828125],[109.8525390625,33.248046875],[109.71875,33.234375],[109.5078125,33.23046875],[109.5771484375,33.1103515625],[109.7919921875,33.0703125],[109.7646484375,32.91015625],[109.9912109375,32.88671875],[110.10546875,32.8330078125],[110.1552734375,32.6904296875],[110.0849609375,32.5810546875],[109.9111328125,32.5927734375],[109.7158203125,32.609375],[109.5791015625,32.5107421875],[109.49609375,32.30078125],[109.6044921875,32.2060546875],[109.587890625,32.025390625],[109.5859375,31.9013671875],[109.6064453125,31.744140625],[109.3896484375,31.7060546875],[109.2529296875,31.765625],[109.16796875,31.8759765625],[109.0390625,31.9609375],[108.8876953125,31.9921875],[108.7529296875,32.07421875],[108.5107421875,32.201171875],[108.3125,32.232421875],[108.185546875,32.2216796875],[108.01953125,32.2119140625],[107.865234375,32.201171875],[107.755859375,32.3388671875],[107.5986328125,32.412109375],[107.45703125,32.41796875],[107.3779296875,32.5390625],[107.2705078125,32.4072265625],[107.083984375,32.533203125],[107.0634765625,32.7119140625],[106.916015625,32.7041015625],[106.7861328125,32.697265625],[106.6640625,32.69140625],[106.4990234375,32.6494140625],[106.3505859375,32.6728515625],[106.1123046875,32.72265625],[106.04296875,32.865234375],[105.826171875,32.826171875],[105.7197265625,32.759765625],[105.5966796875,32.7001953125],[105.525390625,32.8486328125],[105.8271484375,32.951171875],[105.9189453125,33.10546875],[105.91796875,33.23828125],[105.796875,33.2607421875],[105.708984375,33.380859375],[105.8427734375,33.490234375],[105.9404296875,33.5712890625],[106.0869140625,33.6171875],[106.1875,33.546875],[106.3515625,33.587890625],[106.515625,33.513671875],[106.5400390625,33.69140625],[106.4609375,33.7939453125],[106.4111328125,33.908203125],[106.501953125,34.10546875],[106.5517578125,34.2431640625],[106.673828125,34.248046875],[106.7177734375,34.3701171875],[106.6025390625,34.46484375],[106.486328125,34.525390625],[106.3349609375,34.5185546875],[106.4228515625,34.65625],[106.580078125,34.779296875],[106.4833984375,34.98046875],[106.5439453125,35.0859375],[106.70703125,35.08203125],[106.9892578125,35.0703125],[107.0947265625,34.970703125],[107.21484375,34.8779296875],[107.533203125,34.912109375],[107.6748046875,34.9521484375],[107.8056640625,34.95703125],[107.759765625,35.0712890625],[107.703125,35.193359375],[107.7451171875,35.3125],[107.8671875,35.2568359375],[108.1943359375,35.306640625],[108.349609375,35.302734375],[108.4853515625,35.2744140625],[108.6162109375,35.330078125],[108.6064453125,35.5029296875],[108.5400390625,35.6064453125],[108.5341796875,35.7470703125],[108.4990234375,35.876953125],[108.65234375,35.94921875],[108.712890625,36.1396484375],[108.646484375,36.2548828125],[108.6513671875,36.384765625],[108.5107421875,36.474609375],[108.3486328125,36.556640625],[108.216796875,36.572265625],[108.0830078125,36.6162109375],[107.939453125,36.65625],[107.8310546875,36.7861328125],[107.7099609375,36.8056640625],[107.5908203125,36.8369140625],[107.4892578125,36.9052734375],[107.294921875,36.9296875],[107.2705078125,37.1123046875],[107.3095703125,37.2509765625],[107.26171875,37.37109375],[107.345703125,37.51953125],[107.419921875,37.650390625],[107.5,37.7666015625],[107.62109375,37.7763671875],[107.650390625,37.865234375]]]}},{"type":"Feature","properties":{"name":"甘肃"},"geometry":{"type":"MultiPolygon","coordinates":[[[[106.0732421875,35.4482421875],[106.083984375,35.421875],[106.0732421875,35.4482421875]]],[[[106.0439453125,35.4892578125],[105.8984375,35.4521484375],[106.0302734375,35.4697265625],[106.11328125,35.3623046875],[106.23828125,35.41015625],[106.3642578125,35.2392578125],[106.509765625,35.3583984375],[106.490234375,35.48046875],[106.435546875,35.689453125],[106.59765625,35.728515625],[106.7509765625,35.6904296875],[106.8671875,35.7392578125],[106.880859375,35.880859375],[106.9501953125,35.9921875],[106.947265625,36.123046875],[106.833984375,36.2294921875],[106.7021484375,36.240234375],[106.5595703125,36.29296875],[106.48828125,36.40234375],[106.4111328125,36.51953125],[106.4931640625,36.6298828125],[106.59375,36.7509765625],[106.640625,36.8828125],[106.5390625,36.978515625],[106.6669921875,37.017578125],[106.615234375,37.1357421875],[106.7607421875,37.0810546875],[106.892578125,37.0986328125],[107.03125,37.1083984375],[107.181640625,37.14453125],[107.30859375,36.9130859375],[107.478515625,36.9091796875],[107.5908203125,36.8369140625],[107.7099609375,36.8056640625],[107.8310546875,36.7861328125],[107.939453125,36.65625],[108.046875,36.5966796875],[108.21875,36.6337890625],[108.3486328125,36.556640625],[108.40234375,36.447265625],[108.5634765625,36.439453125],[108.646484375,36.2548828125],[108.712890625,36.1396484375],[108.689453125,36.021484375],[108.5810546875,35.9482421875],[108.5283203125,35.82421875],[108.5400390625,35.6064453125],[108.6064453125,35.5029296875],[108.6162109375,35.330078125],[108.44921875,35.2744140625],[108.2412109375,35.2568359375],[107.970703125,35.2421875],[107.7451171875,35.3125],[107.703125,35.193359375],[107.759765625,35.0712890625],[107.8642578125,34.99609375],[107.6748046875,34.9521484375],[107.533203125,34.912109375],[107.2958984375,34.9365234375],[107.1728515625,34.9375],[107.04296875,35.0419921875],[106.71484375,35.1064453125],[106.54296875,35.083984375],[106.580078125,34.779296875],[106.4482421875,34.6953125],[106.3134765625,34.580078125],[106.486328125,34.525390625],[106.6025390625,34.46484375],[106.7177734375,34.3701171875],[106.673828125,34.248046875],[106.52734375,34.2919921875],[106.5849609375,34.150390625],[106.4765625,33.974609375],[106.4921875,33.8505859375],[106.4833984375,33.7080078125],[106.576171875,33.6318359375],[106.5400390625,33.513671875],[106.431640625,33.619140625],[106.2880859375,33.6015625],[106.14453125,33.564453125],[105.95703125,33.61328125],[105.8427734375,33.490234375],[105.708984375,33.380859375],[105.796875,33.2607421875],[105.91796875,33.23828125],[105.9189453125,33.10546875],[105.8623046875,32.939453125],[105.638671875,32.8798828125],[105.42578125,32.931640625],[105.4560546875,32.73828125],[105.2958984375,32.65625],[105.111328125,32.5947265625],[104.8818359375,32.6015625],[104.740234375,32.6357421875],[104.572265625,32.7294921875],[104.3642578125,32.822265625],[104.2880859375,32.9423828125],[104.427734375,33.0146484375],[104.3037109375,33.302734375],[104.4375,33.3232421875],[104.2958984375,33.3330078125],[104.15625,33.5419921875],[104.052734375,33.685546875],[103.76953125,33.6591796875],[103.650390625,33.697265625],[103.521484375,33.681640625],[103.5068359375,33.810546875],[103.3505859375,33.744140625],[103.2158203125,33.794921875],[103.1240234375,33.9423828125],[103.130859375,34.0673828125],[102.9775390625,34.19921875],[102.912109375,34.3134765625],[102.798828125,34.2734375],[102.7021484375,34.197265625],[102.658203125,34.08203125],[102.4716796875,34.0732421875],[102.3916015625,33.9716796875],[102.2158203125,33.958984375],[102.26171875,33.822265625],[102.341796875,33.728515625],[102.478515625,33.5439453125],[102.3955078125,33.4052734375],[102.26171875,33.4169921875],[102.2099609375,33.2255859375],[102.1083984375,33.298828125],[101.9365234375,33.1875],[101.8251953125,33.12109375],[101.7685546875,33.263671875],[101.8779296875,33.3154296875],[101.9462890625,33.4404296875],[101.884765625,33.578125],[101.736328125,33.4970703125],[101.6123046875,33.6162109375],[101.43359375,33.685546875],[101.2373046875,33.6865234375],[101.1552734375,33.8427734375],[100.99609375,33.8916015625],[100.8818359375,34.037109375],[100.7646484375,34.1796875],[100.8232421875,34.3193359375],[100.951171875,34.3837890625],[101.2275390625,34.330078125],[101.3251953125,34.24609375],[101.482421875,34.21875],[101.646484375,34.158203125],[101.7880859375,34.1318359375],[101.95703125,34.1103515625],[102.015625,34.224609375],[102.1484375,34.271484375],[102.259765625,34.35546875],[102.17578125,34.4482421875],[101.978515625,34.546875],[101.91796875,34.8759765625],[102.0693359375,34.8876953125],[102.212890625,35.0361328125],[102.34375,35.162109375],[102.2802734375,35.3046875],[102.3154296875,35.4345703125],[102.4482421875,35.4375],[102.5146484375,35.5703125],[102.744140625,35.4951171875],[102.767578125,35.65234375],[102.6865234375,35.7724609375],[102.7861328125,35.86328125],[102.951171875,35.8359375],[102.97265625,35.99609375],[102.8828125,36.083984375],[102.98828125,36.1943359375],[102.8974609375,36.33203125],[102.767578125,36.4658203125],[102.607421875,36.6826171875],[102.7216796875,36.7705078125],[102.576171875,36.880859375],[102.451171875,36.96875],[102.498046875,37.0908203125],[102.642578125,37.1005859375],[102.458984375,37.248046875],[102.1044921875,37.4833984375],[102.0400390625,37.6220703125],[101.947265625,37.728515625],[101.81640625,37.6552734375],[101.66015625,37.7333984375],[101.5751953125,37.8359375],[101.4423828125,37.8681640625],[101.279296875,37.8369140625],[101.16015625,37.8681640625],[100.98046875,38.0068359375],[100.9306640625,38.169921875],[100.7158203125,38.25390625],[100.546875,38.2470703125],[100.4248046875,38.3076171875],[100.3017578125,38.3896484375],[100.060546875,38.5205078125],[100.119140625,38.3447265625],[100.18359375,38.22265625],[99.671875,38.44140625],[99.5283203125,38.5478515625],[99.3623046875,38.71875],[99.0693359375,38.8974609375],[98.9365234375,38.9951171875],[98.8134765625,39.087890625],[98.5830078125,38.9306640625],[98.4580078125,38.953125],[98.2900390625,39.037109375],[98.236328125,38.919921875],[98.09375,38.787109375],[97.7021484375,38.9638671875],[97.5009765625,39.0791015625],[97.34765625,39.16796875],[97.0478515625,39.2080078125],[96.958984375,39.0751953125],[96.94140625,38.908203125],[96.98828125,38.7919921875],[97.0576171875,38.6728515625],[96.9609375,38.55859375],[96.794921875,38.6083984375],[96.6669921875,38.490234375],[96.6240234375,38.345703125],[96.666015625,38.23046875],[96.37890625,38.27734375],[96.302734375,38.18359375],[96.1044921875,38.1884765625],[95.9384765625,38.23828125],[95.8271484375,38.3544921875],[95.7041015625,38.4013671875],[95.5185546875,38.2958984375],[95.3203125,38.3212890625],[95.1220703125,38.41796875],[94.9716796875,38.4306640625],[94.857421875,38.3935546875],[94.6611328125,38.38671875],[94.5283203125,38.3662109375],[94.37109375,38.763671875],[93.8828125,38.720703125],[93.7568359375,38.806640625],[93.884765625,38.8271484375],[93.732421875,38.9248046875],[93.302734375,38.89453125],[93.1982421875,39.046875],[93.142578125,39.1611328125],[92.9765625,39.14453125],[92.494140625,39.1025390625],[92.3544921875,39.0703125],[92.33984375,39.2373046875],[92.5263671875,39.369140625],[92.640625,39.5146484375],[92.74609375,39.869140625],[92.796875,40.154296875],[92.9072265625,40.3115234375],[92.9287109375,40.5732421875],[93.76171875,40.6650390625],[93.8212890625,40.7939453125],[94.01171875,41.115234375],[94.1845703125,41.26953125],[94.5341796875,41.5068359375],[94.7509765625,41.5390625],[94.8623046875,41.6689453125],[95.13671875,41.7734375],[95.2509765625,41.609375],[95.3603515625,41.6689453125],[95.572265625,41.796875],[95.8525390625,41.8486328125],[96.0400390625,41.92578125],[96.1376953125,42.0205078125],[96.078125,42.150390625],[96.1787109375,42.21875],[96.0419921875,42.3271484375],[95.9794921875,42.4375],[96.103515625,42.6044921875],[96.38671875,42.728515625],[96.9833984375,42.7578125],[97.1728515625,42.7958984375],[97.84765625,41.6572265625],[97.6171875,41.46484375],[97.97265625,41.0986328125],[98.2509765625,40.939453125],[98.3447265625,40.5693359375],[98.62890625,40.6787109375],[98.802734375,40.607421875],[98.9853515625,40.783203125],[99.1025390625,40.6767578125],[99.1748046875,40.8583984375],[99.56640625,40.84765625],[99.673828125,40.93359375],[100.0576171875,40.908203125],[100.2373046875,40.7177734375],[100.169921875,40.5419921875],[100.169921875,40.2783203125],[99.990234375,40.1884765625],[99.927734375,40.064453125],[99.751953125,40.0078125],[99.525390625,39.888671875],[99.6728515625,39.888671875],[99.822265625,39.8603515625],[100.041015625,39.7578125],[100.2509765625,39.685546875],[100.3017578125,39.5732421875],[100.5009765625,39.4814453125],[100.8427734375,39.40625],[100.8427734375,39.2041015625],[100.830078125,39.0751953125],[100.9619140625,39.0068359375],[101.2275390625,39.0224609375],[101.2421875,38.861328125],[101.5615234375,38.7138671875],[101.77734375,38.6611328125],[101.9423828125,38.8095703125],[102.0751953125,38.8916015625],[101.833984375,39.095703125],[102.27734375,39.189453125],[102.4541015625,39.255859375],[102.60546875,39.171875],[103.0107421875,39.1005859375],[103.357421875,39.3369140625],[103.83984375,39.4609375],[104.0908203125,39.419921875],[104.0478515625,39.2978515625],[104.177734375,39.15234375],[104.197265625,38.98828125],[104.044921875,38.8955078125],[103.8603515625,38.64453125],[103.416015625,38.4052734375],[103.5087890625,38.28125],[103.53515625,38.1572265625],[103.369140625,38.08984375],[103.40234375,37.8623046875],[103.6767578125,37.7841796875],[103.8720703125,37.6064453125],[104.18359375,37.4072265625],[104.3662109375,37.4189453125],[104.521484375,37.435546875],[104.6806640625,37.408203125],[104.6533203125,37.291015625],[104.775390625,37.2470703125],[104.9169921875,37.0966796875],[105.166015625,36.9951171875],[105.2412109375,36.8974609375],[105.341796875,36.7685546875],[105.2021484375,36.705078125],[105.2705078125,36.59375],[105.3623046875,36.4990234375],[105.419921875,36.3779296875],[105.4599609375,36.2265625],[105.4921875,36.1015625],[105.341796875,36.0283203125],[105.3271484375,35.9052734375],[105.3798828125,35.7958984375],[105.5078125,35.7197265625],[105.66796875,35.75],[105.7421875,35.626953125],[105.8427734375,35.490234375],[106.0146484375,35.5244140625],[106.0439453125,35.4892578125]]]]}},{"type":"Feature","properties":{"name":"青海"},"geometry":{"type":"MultiPolygon","coordinates":[[[[102.83984375,36.3466796875],[102.8349609375,36.369140625],[102.83984375,36.3466796875]]],[[[93.134765625,39.1416015625],[93.1904296875,38.919921875],[93.732421875,38.9248046875],[93.884765625,38.8681640625],[93.7568359375,38.806640625],[93.8828125,38.720703125],[94.37109375,38.763671875],[94.529296875,38.4228515625],[94.6611328125,38.38671875],[94.857421875,38.3935546875],[94.9716796875,38.4306640625],[95.1220703125,38.41796875],[95.2685546875,38.2978515625],[95.4423828125,38.3115234375],[95.7041015625,38.4013671875],[95.8271484375,38.3544921875],[95.9384765625,38.23828125],[96.05078125,38.177734375],[96.22265625,38.1494140625],[96.3359375,38.2470703125],[96.666015625,38.23046875],[96.6240234375,38.345703125],[96.708984375,38.4599609375],[96.8154296875,38.5654296875],[96.9609375,38.55859375],[97.0576171875,38.6728515625],[96.98828125,38.7919921875],[96.94140625,38.908203125],[96.958984375,39.0751953125],[96.9638671875,39.19921875],[97.34765625,39.16796875],[97.5009765625,39.0791015625],[97.6796875,39.0107421875],[98.0126953125,38.8583984375],[98.25,38.8876953125],[98.2900390625,39.037109375],[98.4580078125,38.953125],[98.5830078125,38.9306640625],[98.744140625,39.0869140625],[98.9365234375,38.9951171875],[99.107421875,38.9521484375],[99.3623046875,38.71875],[99.4482421875,38.60546875],[99.671875,38.44140625],[100.083984375,38.28125],[100.0927734375,38.408203125],[100.2373046875,38.4443359375],[100.3330078125,38.33984375],[100.4375,38.2685546875],[100.59765625,38.2431640625],[100.845703125,38.1494140625],[100.8955078125,38.013671875],[101.076171875,37.943359375],[101.203125,37.84765625],[101.357421875,37.7919921875],[101.5751953125,37.8359375],[101.669921875,37.759765625],[101.7919921875,37.6962890625],[101.947265625,37.728515625],[102.0400390625,37.6220703125],[102.1044921875,37.4833984375],[102.30078125,37.3916015625],[102.4287109375,37.30859375],[102.6044921875,37.1728515625],[102.498046875,37.0908203125],[102.451171875,36.96875],[102.5615234375,36.919921875],[102.7216796875,36.7705078125],[102.607421875,36.6826171875],[102.7646484375,36.576171875],[102.8271484375,36.408203125],[103.0712890625,36.20703125],[102.94140625,36.10546875],[102.9453125,35.9462890625],[102.7841796875,35.86328125],[102.703125,35.7138671875],[102.8095703125,35.560546875],[102.505859375,35.587890625],[102.44140625,35.4658203125],[102.3154296875,35.4345703125],[102.2802734375,35.3046875],[102.404296875,35.1787109375],[102.2822265625,35.05859375],[102.095703125,34.9873046875],[101.986328125,34.900390625],[101.9345703125,34.587890625],[102.15625,34.5078125],[102.259765625,34.3544921875],[102.1484375,34.271484375],[102.015625,34.224609375],[101.95703125,34.1103515625],[101.7646484375,34.123046875],[101.623046875,34.1787109375],[101.3251953125,34.24609375],[101.2275390625,34.330078125],[101.0546875,34.3232421875],[100.8955078125,34.3759765625],[100.8056640625,34.287109375],[100.87109375,34.083984375],[100.99609375,33.8916015625],[101.1552734375,33.8427734375],[101.1630859375,33.7197265625],[101.3916015625,33.6455078125],[101.54296875,33.6953125],[101.6318359375,33.4931640625],[101.77734375,33.5361328125],[101.697265625,33.435546875],[101.6552734375,33.3154296875],[101.654296875,33.1630859375],[101.4912109375,33.2255859375],[101.3828125,33.1533203125],[101.2978515625,33.2626953125],[101.1162109375,33.1962890625],[101.14453125,33.0595703125],[101.1240234375,32.912109375],[101.23828125,32.8251953125],[101.1611328125,32.6640625],[100.9306640625,32.6005859375],[100.77734375,32.6396484375],[100.6640625,32.5224609375],[100.544921875,32.5703125],[100.47265625,32.693359375],[100.3349609375,32.71875],[100.2158203125,32.607421875],[100.0888671875,32.669921875],[100.1240234375,32.837890625],[100.0380859375,32.9306640625],[99.9033203125,33.0478515625],[99.7705078125,32.9462890625],[99.7275390625,32.7255859375],[99.6083984375,32.78125],[99.3857421875,32.900390625],[99.1953125,33.0361328125],[99.0302734375,33.0947265625],[98.8564453125,33.1533203125],[98.8076171875,33.265625],[98.734375,33.41015625],[98.650390625,33.544921875],[98.5830078125,33.732421875],[98.4638671875,33.8486328125],[98.44140625,33.9931640625],[98.2080078125,34.0791015625],[98.029296875,34.123046875],[97.8115234375,34.2080078125],[97.666015625,34.126953125],[97.638671875,33.921875],[97.392578125,33.8896484375],[97.423828125,33.755859375],[97.40625,33.62890625],[97.525390625,33.576171875],[97.6298828125,33.4609375],[97.7587890625,33.4033203125],[97.625,33.33984375],[97.5771484375,33.22265625],[97.48828125,33.107421875],[97.5244140625,32.9892578125],[97.3740234375,32.9560546875],[97.3828125,32.79296875],[97.7314453125,32.52734375],[97.521484375,32.5263671875],[97.3876953125,32.5498046875],[97.3916015625,32.4228515625],[97.37109375,32.2734375],[97.2646484375,32.1826171875],[97.234375,32.0478515625],[96.9560546875,32.0625],[96.8671875,31.96484375],[96.724609375,32.0234375],[96.810546875,31.8974609375],[96.8408203125,31.7275390625],[96.6767578125,31.728515625],[96.4697265625,31.7705078125],[96.384765625,31.9248046875],[96.2529296875,31.9306640625],[96.17578125,31.8251953125],[96.2529296875,31.6953125],[96.1572265625,31.603515625],[96.0419921875,31.734375],[95.8994140625,31.8173828125],[95.8251953125,31.6826171875],[95.68359375,31.77734375],[95.5654296875,31.740234375],[95.4580078125,31.8017578125],[95.4091796875,31.919921875],[95.416015625,32.046875],[95.3896484375,32.1865234375],[95.2412109375,32.3212890625],[95.1328125,32.2646484375],[95.26171875,32.3486328125],[95.0751953125,32.376953125],[94.9189453125,32.412109375],[94.8076171875,32.4873046875],[94.615234375,32.673828125],[94.462890625,32.60546875],[94.3681640625,32.5224609375],[94.197265625,32.5166015625],[94.0673828125,32.470703125],[93.859375,32.46484375],[93.72265625,32.578125],[93.5224609375,32.4736328125],[93.412109375,32.55859375],[93.2431640625,32.662109375],[93.06640625,32.6279296875],[93.009765625,32.7421875],[92.8779296875,32.697265625],[92.6904296875,32.7666015625],[92.5546875,32.7314453125],[92.4111328125,32.748046875],[92.255859375,32.7216796875],[92.2314453125,32.8408203125],[91.9580078125,32.8203125],[91.8583984375,32.9033203125],[91.68359375,32.990234375],[91.4990234375,33.109375],[91.2314453125,33.142578125],[91.0703125,33.1142578125],[90.931640625,33.12109375],[90.705078125,33.13671875],[90.48828125,33.2666015625],[90.36328125,33.2802734375],[90.244140625,33.4267578125],[90.0947265625,33.4677734375],[89.98828125,33.583984375],[89.984375,33.7265625],[89.84765625,33.8662109375],[89.6884765625,33.9599609375],[89.6943359375,34.126953125],[89.8173828125,34.169921875],[89.826171875,34.2939453125],[89.82421875,34.4560546875],[89.7783203125,34.5751953125],[89.7236328125,34.7041015625],[89.826171875,34.796875],[89.7880859375,34.921875],[89.6552734375,34.8837890625],[89.5927734375,35.109375],[89.4501953125,35.2255859375],[89.5166015625,35.3330078125],[89.6572265625,35.42578125],[89.7666015625,35.4833984375],[89.7255859375,35.650390625],[89.78125,35.765625],[89.55078125,35.857421875],[89.42578125,35.919921875],[89.421875,36.046875],[89.60546875,36.0390625],[89.763671875,36.0732421875],[89.9462890625,36.0693359375],[90.0205078125,36.2138671875],[90.14453125,36.240234375],[90.2421875,36.16015625],[90.6630859375,36.134765625],[90.775390625,36.087890625],[90.9267578125,36.03125],[91.1123046875,36.095703125],[91.0986328125,36.2177734375],[91.0263671875,36.3271484375],[91.0361328125,36.5302734375],[90.7412109375,36.5859375],[90.72265625,36.7109375],[90.861328125,36.9189453125],[91.037109375,36.9296875],[91.1337890625,37.0078125],[91.314453125,37.0205078125],[91.2802734375,37.1640625],[91.1943359375,37.275390625],[91.0751953125,37.4755859375],[90.94140625,37.48046875],[90.8779296875,37.5830078125],[90.7763671875,37.6513671875],[90.6591796875,37.7041015625],[90.521484375,37.7294921875],[90.53125,38.3203125],[90.3623046875,38.30078125],[90.138671875,38.3408203125],[90.1123046875,38.478515625],[90.4248046875,38.4931640625],[90.611328125,38.5966796875],[90.8037109375,38.6552734375],[91.1142578125,38.7080078125],[91.2431640625,38.7529296875],[91.447265625,38.8134765625],[91.876953125,38.8818359375],[91.9912109375,38.939453125],[92.173828125,38.9609375],[92.3828125,39.0009765625],[92.494140625,39.1025390625],[92.8671875,39.138671875],[93.0439453125,39.146484375],[93.134765625,39.1416015625]]]]}},{"type":"Feature","properties":{"name":"宁夏"},"geometry":{"type":"MultiPolygon","coordinates":[[[[106.802734375,39.298828125],[106.859375,39.1083984375],[106.9677734375,39.0556640625],[106.7099609375,38.7197265625],[106.6630859375,38.6015625],[106.6484375,38.4716796875],[106.4833984375,38.3173828125],[106.7685546875,38.17578125],[106.9453125,38.1318359375],[107.1220703125,38.1357421875],[107.2431640625,38.111328125],[107.39453125,38.015625],[107.4931640625,37.9453125],[107.66015625,37.8447265625],[107.5,37.7666015625],[107.3876953125,37.69140625],[107.345703125,37.51953125],[107.26171875,37.37109375],[107.3095703125,37.2509765625],[107.3076171875,37.1005859375],[107.181640625,37.14453125],[107.03125,37.1416015625],[106.90625,37.15234375],[106.78125,37.1591796875],[106.60546875,37.1279296875],[106.6669921875,37.017578125],[106.5390625,36.978515625],[106.6103515625,36.87890625],[106.6279296875,36.7529296875],[106.490234375,36.6845703125],[106.4560546875,36.560546875],[106.48828125,36.40234375],[106.5048828125,36.2666015625],[106.6376953125,36.265625],[106.763671875,36.2158203125],[106.9130859375,36.154296875],[106.9287109375,36.015625],[106.8505859375,35.8896484375],[106.912109375,35.76953125],[106.806640625,35.7099609375],[106.68359375,35.7294921875],[106.53125,35.7421875],[106.4833984375,35.576171875],[106.509765625,35.3583984375],[106.41796875,35.2763671875],[106.25390625,35.337890625],[106.1748046875,35.4384765625],[106.021484375,35.494140625],[105.9013671875,35.5478515625],[105.7490234375,35.615234375],[105.66796875,35.75],[105.564453125,35.6884765625],[105.4541015625,35.748046875],[105.37109375,35.8447265625],[105.341796875,36.0283203125],[105.4921875,36.1015625],[105.4599609375,36.2265625],[105.4052734375,36.359375],[105.3623046875,36.4990234375],[105.2490234375,36.546875],[105.2021484375,36.705078125],[105.3203125,36.7431640625],[105.279296875,36.8701171875],[105.166015625,36.9951171875],[104.9658203125,37.0322265625],[104.8564453125,37.2119140625],[104.7177734375,37.208984375],[104.6005859375,37.2451171875],[104.71875,37.3388671875],[104.521484375,37.435546875],[104.3662109375,37.4189453125],[104.8017578125,37.5390625],[105.0244140625,37.580078125],[105.3154296875,37.7021484375],[105.599609375,37.7001953125],[105.7607421875,37.80078125],[105.7998046875,37.9375],[105.7685546875,38.134765625],[105.8427734375,38.2412109375],[105.8212890625,38.365234375],[105.875,38.587890625],[105.908203125,38.7373046875],[106.00390625,38.8740234375],[106.0966796875,39.0849609375],[106.251953125,39.1318359375],[106.2880859375,39.2724609375],[106.509765625,39.271484375],[106.603515625,39.3759765625],[106.7822265625,39.3720703125],[106.802734375,39.298828125]]],[[[106.0546875,35.4521484375],[105.8974609375,35.412109375],[106.0322265625,35.48828125],[106.0546875,35.4521484375]]]]}},{"type":"Feature","properties":{"name":"新疆"},"geometry":{"type":"Polygon","coordinates":[[[86.7421875,48.921875],[86.8369140625,49.0517578125],[87.0888671875,49.1337890625],[87.4375,49.076171875],[87.671875,49.1552734375],[87.8212890625,49.173828125],[87.833984375,49.05078125],[87.7607421875,48.9267578125],[87.8271484375,48.8017578125],[88.09765625,48.7177734375],[87.9619140625,48.599609375],[88.109375,48.546875],[88.349609375,48.4677734375],[88.4443359375,48.3916015625],[88.57421875,48.3701171875],[88.638671875,48.1845703125],[88.8251953125,48.107421875],[89.0791015625,47.9873046875],[89.2314453125,47.98046875],[89.384765625,48.046875],[89.5693359375,48.0380859375],[89.6513671875,47.9140625],[89.7685546875,47.8330078125],[89.9521484375,47.837890625],[90.06640625,47.8837890625],[90.1357421875,47.7236328125],[90.3857421875,47.64453125],[90.46875,47.498046875],[90.52734375,47.3798828125],[90.5625,47.2080078125],[90.767578125,46.9931640625],[90.90234375,46.9609375],[90.943359375,46.826171875],[91.0546875,46.7177734375],[91.0185546875,46.5830078125],[90.984375,46.375],[91.0185546875,46.12890625],[90.8505859375,45.888671875],[90.71484375,45.7294921875],[90.6708984375,45.548828125],[90.7734375,45.4326171875],[90.8056640625,45.294921875],[90.8828125,45.1923828125],[91.1298828125,45.216796875],[91.2421875,45.1376953125],[91.3779296875,45.111328125],[91.5009765625,45.1044921875],[91.619140625,45.0693359375],[92.056640625,45.0869140625],[92.2412109375,45.0166015625],[92.4970703125,45.001953125],[92.7802734375,45.05078125],[92.986328125,45.0029296875],[93.1748046875,45.015625],[93.294921875,44.982421875],[93.4345703125,44.9560546875],[94.2158203125,44.6689453125],[94.330078125,44.5830078125],[94.4716796875,44.509765625],[94.6064453125,44.44921875],[94.7236328125,44.3408203125],[94.9150390625,44.3037109375],[95.4140625,44.298828125],[95.3271484375,44.029296875],[95.52734375,44.0078125],[95.6240234375,43.8564453125],[95.736328125,43.59765625],[95.8583984375,43.41796875],[95.8857421875,43.271484375],[96.3642578125,42.9013671875],[96.38671875,42.728515625],[96.103515625,42.6044921875],[96.017578125,42.482421875],[96.0419921875,42.3271484375],[96.1787109375,42.21875],[96.078125,42.150390625],[96.1376953125,42.0205078125],[96.0400390625,41.92578125],[95.8525390625,41.8486328125],[95.572265625,41.796875],[95.3603515625,41.6689453125],[95.2509765625,41.609375],[95.2001953125,41.7197265625],[94.8623046875,41.6689453125],[94.7509765625,41.5390625],[94.5341796875,41.5068359375],[94.1845703125,41.26953125],[94.01171875,41.115234375],[93.810546875,40.8798828125],[93.76171875,40.6650390625],[92.9287109375,40.5732421875],[92.9072265625,40.3115234375],[92.796875,40.154296875],[92.74609375,39.869140625],[92.640625,39.5146484375],[92.5263671875,39.369140625],[92.33984375,39.2373046875],[92.3544921875,39.0703125],[92.173828125,38.9609375],[91.9912109375,38.939453125],[91.8583984375,38.8779296875],[91.447265625,38.8134765625],[91.2998046875,38.7470703125],[91.1142578125,38.7080078125],[90.8037109375,38.6552734375],[90.625,38.6689453125],[90.4638671875,38.5576171875],[90.1337890625,38.4951171875],[90.138671875,38.3408203125],[90.28125,38.23828125],[90.53125,38.3203125],[90.521484375,37.7294921875],[90.6591796875,37.7041015625],[90.7763671875,37.6513671875],[90.8779296875,37.5830078125],[90.94140625,37.48046875],[91.0751953125,37.4755859375],[91.1357421875,37.32421875],[91.19140625,37.2060546875],[91.3115234375,37.015625],[91.181640625,37.025390625],[91.0498046875,36.966796875],[90.861328125,36.9189453125],[90.72265625,36.798828125],[90.70703125,36.6591796875],[91.0361328125,36.5302734375],[91.0263671875,36.3271484375],[91.0986328125,36.21875],[90.978515625,36.1064453125],[90.84765625,36.017578125],[90.6630859375,36.134765625],[90.2421875,36.16015625],[90.130859375,36.2080078125],[90.005859375,36.2802734375],[89.9375,36.130859375],[89.763671875,36.0732421875],[89.490234375,36.1513671875],[89.3759765625,36.228515625],[89.2373046875,36.294921875],[89.1005859375,36.283203125],[88.96484375,36.3193359375],[88.802734375,36.337890625],[88.6240234375,36.3896484375],[88.4990234375,36.4462890625],[88.36328125,36.48046875],[88.134765625,36.427734375],[87.9833984375,36.4384765625],[87.732421875,36.3857421875],[87.5625,36.3427734375],[87.4609375,36.41015625],[87.29296875,36.359375],[87.1494140625,36.2978515625],[86.9970703125,36.3095703125],[86.86328125,36.30078125],[86.7001953125,36.2451171875],[86.5322265625,36.2275390625],[86.3935546875,36.20703125],[86.19140625,36.1328125],[86.146484375,36.0009765625],[86.060546875,35.8466796875],[85.94921875,35.779296875],[85.693359375,35.751953125],[85.59765625,35.6455078125],[85.3740234375,35.701171875],[85.2841796875,35.7880859375],[85.146484375,35.7431640625],[84.7626953125,35.625],[84.44921875,35.55078125],[84.1748046875,35.3583984375],[84.0634765625,35.4111328125],[83.916015625,35.408203125],[83.685546875,35.36328125],[83.2431640625,35.419921875],[83.068359375,35.462890625],[82.9609375,35.671875],[82.7978515625,35.689453125],[82.62890625,35.6923828125],[82.4580078125,35.71875],[82.3369140625,35.65234375],[82.1953125,35.5185546875],[82.033203125,35.451171875],[82.013671875,35.310546875],[81.7373046875,35.2626953125],[81.513671875,35.2353515625],[81.3642578125,35.35546875],[81.2158203125,35.3203125],[81.099609375,35.408203125],[81.0029296875,35.3349609375],[80.8447265625,35.345703125],[80.689453125,35.33984375],[80.513671875,35.392578125],[80.3779296875,35.3896484375],[80.2685546875,35.2958984375],[80.3603515625,35.2021484375],[80.2236328125,35.177734375],[80.119140625,35.06640625],[80.037109375,34.9033203125],[79.9482421875,34.8212890625],[79.9072265625,34.6845703125],[79.84375,34.5576171875],[79.7099609375,34.4814453125],[79.5458984375,34.4765625],[79.373046875,34.4287109375],[79.2177734375,34.4150390625],[79.0791015625,34.412109375],[78.958984375,34.38671875],[78.7431640625,34.455078125],[78.6181640625,34.537109375],[78.4931640625,34.5791015625],[78.2685546875,34.6357421875],[78.23828125,34.8818359375],[78.123046875,35.037109375],[78.060546875,35.1806640625],[78.013671875,35.3662109375],[78.140625,35.4951171875],[78.0107421875,35.4921875],[77.8173828125,35.51953125],[77.69140625,35.44921875],[77.5400390625,35.482421875],[77.3974609375,35.46875],[77.1962890625,35.51953125],[77.0654296875,35.5966796875],[76.91796875,35.609375],[76.76171875,35.65625],[76.59375,35.7724609375],[76.59765625,35.896484375],[76.4326171875,35.8525390625],[76.298828125,35.841796875],[76.1611328125,35.8251953125],[76.1044921875,36.01953125],[75.9501953125,36.0703125],[76.01171875,36.2294921875],[76.03515625,36.4091796875],[75.9248046875,36.56640625],[75.6484375,36.771484375],[75.5322265625,36.7275390625],[75.423828125,36.7861328125],[75.3955078125,36.91015625],[75.236328125,36.9658203125],[74.935546875,36.9833984375],[74.7568359375,37.0263671875],[74.568359375,37.033203125],[74.4638671875,37.1337890625],[74.587890625,37.232421875],[74.7392578125,37.2861328125],[74.87890625,37.224609375],[75.119140625,37.3173828125],[75.0791015625,37.51171875],[74.94140625,37.5595703125],[74.923828125,37.7177734375],[74.91796875,37.845703125],[74.9267578125,38.017578125],[74.806640625,38.15625],[74.7900390625,38.3251953125],[74.857421875,38.4912109375],[74.7177734375,38.54296875],[74.3779296875,38.6552734375],[74.1484375,38.677734375],[74.0693359375,38.5859375],[73.91796875,38.5390625],[73.7978515625,38.6142578125],[73.771484375,38.771484375],[73.7431640625,38.9345703125],[73.8408203125,39.0087890625],[73.7109375,39.1298828125],[73.5400390625,39.2724609375],[73.5927734375,39.4130859375],[73.8681640625,39.4833984375],[73.94921875,39.5927734375],[73.92578125,39.7197265625],[73.8525390625,39.841796875],[73.9794921875,40.0009765625],[74.0986328125,40.08203125],[74.2119140625,40.1220703125],[74.357421875,40.08984375],[74.5390625,40.2109375],[74.673828125,40.279296875],[74.9091796875,40.33984375],[74.7939453125,40.4482421875],[74.986328125,40.45703125],[75.2431640625,40.44921875],[75.5693359375,40.6572265625],[75.646484375,40.517578125],[75.6708984375,40.3642578125],[75.8310546875,40.328125],[75.974609375,40.3798828125],[76.1767578125,40.3818359375],[76.34375,40.341796875],[76.5400390625,40.46484375],[76.66015625,40.623046875],[76.6474609375,40.7607421875],[76.7626953125,40.9541015625],[76.8779296875,41.025390625],[77.0029296875,41.07421875],[77.169921875,41.009765625],[77.296875,41.005859375],[77.474609375,41.0234375],[77.591796875,40.9931640625],[77.73828125,41.033203125],[77.8369140625,41.1533203125],[78.1298828125,41.228515625],[78.1640625,41.3837890625],[78.3837890625,41.39453125],[78.52734375,41.44140625],[78.6513671875,41.4677734375],[78.8251953125,41.560546875],[78.9599609375,41.6533203125],[79.138671875,41.7236328125],[79.326171875,41.8095703125],[79.45703125,41.8486328125],[79.6416015625,41.8857421875],[79.77734375,41.892578125],[79.853515625,42.015625],[80.1630859375,42.0390625],[80.166015625,42.197265625],[80.29296875,42.259765625],[80.2353515625,42.404296875],[80.2216796875,42.5341796875],[80.1806640625,42.6708984375],[80.2607421875,42.8251953125],[80.4091796875,42.83203125],[80.603515625,42.89453125],[80.44140625,42.970703125],[80.630859375,43.14453125],[80.794921875,43.1376953125],[80.76953125,43.265625],[80.76171875,43.447265625],[80.5224609375,43.8173828125],[80.453125,43.9921875],[80.396484375,44.119140625],[80.412109375,44.2861328125],[80.3505859375,44.482421875],[80.4140625,44.611328125],[80.2216796875,44.7333984375],[80.1708984375,44.8447265625],[80,44.7939453125],[79.888671875,44.91015625],[80.1044921875,45.0537109375],[80.244140625,45.0322265625],[80.3916015625,45.044921875],[80.599609375,45.1064453125],[80.7265625,45.177734375],[80.8984375,45.1279296875],[81.0712890625,45.1787109375],[81.2294921875,45.24609375],[81.3828125,45.2578125],[81.634765625,45.3583984375],[81.7802734375,45.3837890625],[81.9208984375,45.2333984375],[82.0927734375,45.25390625],[82.294921875,45.248046875],[82.4794921875,45.1826171875],[82.6015625,45.3466796875],[82.2822265625,45.5390625],[82.291015625,45.716796875],[82.3466796875,45.9443359375],[82.4619140625,45.98046875],[82.5185546875,46.154296875],[82.7275390625,46.49609375],[82.830078125,46.7734375],[82.9384765625,47.0146484375],[83.0224609375,47.1337890625],[83.1552734375,47.236328125],[83.37109375,47.1787109375],[83.5712890625,47.0615234375],[83.708984375,47.0146484375],[83.9248046875,46.970703125],[84.1162109375,46.9677734375],[84.439453125,47.009765625],[84.748046875,47.0107421875],[84.9560546875,46.861328125],[85.0771484375,46.9365234375],[85.27734375,47.0693359375],[85.5458984375,47.05859375],[85.6826171875,47.2236328125],[85.7041015625,47.3779296875],[85.6103515625,47.5107421875],[85.5595703125,47.93359375],[85.5869140625,48.19140625],[85.712890625,48.36328125],[85.9169921875,48.4384765625],[86.2265625,48.4326171875],[86.376953125,48.501953125],[86.5859375,48.54296875],[86.6923828125,48.642578125],[86.78125,48.732421875],[86.822265625,48.84765625],[86.7421875,48.921875]]]}},{"type":"Feature","properties":{"name":"北京"},"geometry":{"type":"Polygon","coordinates":[[[117.2099609375,40.0830078125],[117.0859375,40.0751953125],[116.9306640625,40.0556640625],[116.7783203125,40.033203125],[116.787109375,39.8876953125],[116.900390625,39.83203125],[116.9072265625,39.677734375],[116.78515625,39.59375],[116.56640625,39.6201171875],[116.4775390625,39.53515625],[116.3369140625,39.45703125],[116.2412109375,39.564453125],[115.99609375,39.5771484375],[115.8193359375,39.53125],[115.66796875,39.6162109375],[115.5458984375,39.619140625],[115.4931640625,39.7392578125],[115.521484375,39.90234375],[115.455078125,40.0302734375],[115.5908203125,40.0966796875],[115.7412109375,40.1328125],[115.873046875,40.1875],[115.9697265625,40.2646484375],[115.859375,40.36328125],[115.7822265625,40.4921875],[115.908203125,40.6181640625],[116.1220703125,40.6298828125],[116.248046875,40.7919921875],[116.4619140625,40.7705078125],[116.3349609375,40.921875],[116.474609375,40.896484375],[116.5634765625,40.994140625],[116.6923828125,41.041015625],[116.7138671875,40.9111328125],[116.876953125,40.8212890625],[116.9697265625,40.70703125],[117.2080078125,40.6953125],[117.41015625,40.6875],[117.3125,40.578125],[117.2646484375,40.4423828125],[117.2958984375,40.2783203125],[117.384765625,40.1884765625],[117.240234375,40.11328125],[117.2099609375,40.0830078125]]]}},{"type":"Feature","properties":{"name":"天津"},"geometry":{"type":"Polygon","coordinates":[[[117.4189453125,40.2490234375],[117.5654296875,40.2294921875],[117.6533203125,40.1259765625],[117.7763671875,40.0595703125],[117.6328125,39.96875],[117.50390625,39.919921875],[117.568359375,39.7998046875],[117.646484375,39.701171875],[117.70703125,39.576171875],[117.9306640625,39.5791015625],[117.87109375,39.455078125],[117.84765625,39.3291015625],[118.02734375,39.2919921875],[117.96484375,39.1728515625],[117.8466796875,39.0888671875],[117.853515625,38.9638671875],[117.779296875,38.869140625],[117.646484375,38.8291015625],[117.7421875,38.7548828125],[117.6572265625,38.6611328125],[117.52734375,38.6015625],[117.369140625,38.5654296875],[117.240234375,38.5791015625],[117.0986328125,38.5869140625],[117.0458984375,38.7060546875],[116.8779296875,38.681640625],[116.7451171875,38.7529296875],[116.708984375,38.9326171875],[116.7568359375,39.05078125],[116.9267578125,39.1201171875],[116.86328125,39.2978515625],[116.8759765625,39.4345703125],[116.7880859375,39.548828125],[116.8505859375,39.66796875],[116.974609375,39.6376953125],[117.1279296875,39.6171875],[117.154296875,39.736328125],[117.2607421875,39.8447265625],[117.1591796875,39.91015625],[117.1826171875,40.0595703125],[117.35546875,40.1396484375],[117.4189453125,40.2490234375]]]}},{"type":"Feature","properties":{"name":"上海"},"geometry":{"type":"MultiPolygon","coordinates":[[[[121.779296875,31.310546875],[121.509765625,31.490234375],[121.76953125,31.3916015625],[121.779296875,31.310546875]]],[[[121.6279296875,31.4453125],[121.576171875,31.478515625],[121.6279296875,31.4453125]]],[[[121.8828125,31.2412109375],[121.923828125,31.234375],[121.9228515625,31.197265625]]],[[[121.802734375,31.357421875],[121.908203125,31.2978515625],[121.802734375,31.357421875]]],[[[121.9755859375,31.6171875],[121.9921875,31.4775390625],[121.845703125,31.4326171875],[121.609375,31.5078125],[121.4345703125,31.5908203125],[121.119140625,31.759765625],[121.310546875,31.873046875],[121.431640625,31.76953125],[121.59375,31.705078125],[121.9755859375,31.6171875]]],[[[121.521484375,31.3955078125],[121.72265625,31.3037109375],[121.962890625,31.0478515625],[121.9990234375,30.900390625],[121.9443359375,30.77734375],[121.6484375,30.81640625],[121.517578125,30.7763671875],[121.3623046875,30.6796875],[121.21875,30.78515625],[121.0673828125,30.849609375],[120.9912109375,31.0146484375],[120.857421875,31.10546875],[121.0693359375,31.1494140625],[121.0888671875,31.29296875],[121.16015625,31.40625],[121.259765625,31.478515625],[121.521484375,31.3955078125]]]]}},{"type":"Feature","properties":{"name":"重庆"},"geometry":{"type":"MultiPolygon","coordinates":[[[[107.05859375,30.0439453125],[107.240234375,30.2373046875],[107.3603515625,30.45703125],[107.5166015625,30.6435546875],[107.4248046875,30.7412109375],[107.5771484375,30.8486328125],[107.71875,30.888671875],[107.8505859375,30.79296875],[107.955078125,30.873046875],[108.00390625,31.0263671875],[108.0908203125,31.2021484375],[108.1806640625,31.326171875],[108.2255859375,31.453125],[108.33984375,31.5087890625],[108.43359375,31.62890625],[108.505859375,31.7333984375],[108.34375,31.861328125],[108.259765625,31.9677734375],[108.3642578125,32.0380859375],[108.3701171875,32.173828125],[108.509765625,32.2021484375],[108.6728515625,32.1044921875],[108.837890625,32.0390625],[109.0400390625,31.9609375],[109.19140625,31.8564453125],[109.2822265625,31.7177734375],[109.5556640625,31.7314453125],[109.7333984375,31.7001953125],[109.728515625,31.548828125],[109.8955078125,31.51953125],[110.0546875,31.4111328125],[110.16015625,31.2568359375],[110.185546875,31.1259765625],[110.13671875,30.9873046875],[110.08203125,30.7998046875],[109.89453125,30.900390625],[109.73046875,30.8154296875],[109.65234375,30.7236328125],[109.5341796875,30.6396484375],[109.3544921875,30.4873046875],[109.3037109375,30.6318359375],[109.14453125,30.521484375],[109.119140625,30.6396484375],[108.9677734375,30.625],[108.8125,30.4921875],[108.69140625,30.5869140625],[108.5693359375,30.4697265625],[108.4150390625,30.4765625],[108.4609375,30.3603515625],[108.5830078125,30.25390625],[108.513671875,30.0576171875],[108.5185546875,29.8681640625],[108.38671875,29.861328125],[108.4375,29.7412109375],[108.5791015625,29.8466796875],[108.6875,29.6904296875],[108.8203125,29.6328125],[108.8671875,29.47265625],[108.9189453125,29.3271484375],[109.0537109375,29.4033203125],[109.107421875,29.2890625],[109.1396484375,29.169921875],[109.236328125,29.087890625],[109.234375,28.8642578125],[109.298828125,28.748046875],[109.1806640625,28.62109375],[109.30078125,28.626953125],[109.2744140625,28.4951171875],[109.1533203125,28.4169921875],[109.08203125,28.2490234375],[108.98828125,28.1611328125],[108.8466796875,28.201171875],[108.7255859375,28.275390625],[108.783203125,28.427734375],[108.6416015625,28.4580078125],[108.61328125,28.3251953125],[108.57421875,28.529296875],[108.634765625,28.63671875],[108.474609375,28.6279296875],[108.333984375,28.6767578125],[108.3896484375,28.79296875],[108.3505859375,28.93359375],[108.302734375,29.083984375],[108.134765625,29.052734375],[107.931640625,29.0361328125],[107.810546875,28.984375],[107.8115234375,29.1396484375],[107.62890625,29.166015625],[107.4736328125,29.171875],[107.3701171875,29.09375],[107.44140625,28.9443359375],[107.3349609375,28.8447265625],[107.2197265625,28.7734375],[107.09765625,28.890625],[106.9833984375,28.8515625],[106.84375,28.7802734375],[106.8671875,28.625],[106.728515625,28.54296875],[106.59375,28.5107421875],[106.6181640625,28.64453125],[106.5615234375,28.7587890625],[106.494140625,28.6064453125],[106.375,28.5263671875],[106.3046875,28.650390625],[106.2451171875,28.8134765625],[106.173828125,28.9208984375],[106.048828125,28.9072265625],[105.91015625,28.9208984375],[105.7421875,29.0400390625],[105.7041015625,29.177734375],[105.6357421875,29.2802734375],[105.509765625,29.2861328125],[105.443359375,29.3994140625],[105.3271484375,29.4462890625],[105.3212890625,29.6103515625],[105.4775390625,29.67578125],[105.576171875,29.7451171875],[105.708984375,29.8408203125],[105.748046875,30.033203125],[105.642578125,30.1015625],[105.537109375,30.1650390625],[105.6611328125,30.208984375],[105.71484375,30.3232421875],[105.818359375,30.4375],[105.9423828125,30.3720703125],[106.060546875,30.3388671875],[106.1708984375,30.2509765625],[106.296875,30.205078125],[106.4287109375,30.25390625],[106.5576171875,30.31640625],[106.6494140625,30.1650390625],[106.732421875,30.02734375],[106.9130859375,30.025390625],[107.05859375,30.0439453125]]],[[[109.1064453125,30.5859375],[109.0859375,30.6044921875],[109.1064453125,30.611328125]]]]}}]};

// ========== 中タブ切替 ==========
function cdsSetMidTab(tab) {
  window.CDS_CURRENT_MID_TAB = tab;
  // ── 全系統のサブペインを一括非表示（タブ間の残像バグ対策） ──
  document.querySelectorAll('.cds-pane').forEach(function(p) {
    p.classList.remove('cds-active');
  });

  // ── 解説パネルの中タブ別初期化（デフォルトサブペインで描画） ──
  if (typeof window.cdsRenderInfoPanel === 'function') {
    var midTabDefaultPane = {
      'worldshare': window.WS_CURRENT_ID || 'ws-regional',
      'china': 'cds-china-map',
      'zenntai': 'zt-summary',
      'jishuhaiex': window.JH_CURRENT_ID || 'jh-monthly-trend',
      'import': window.IMP_CURRENT_ID || 'imp-trend',
      'profit': 'cds-profit-monthly',
      'inventory': window.INV_CURRENT_ID || 'inv-total',
      'battery': window.BAT_CURRENT_ID || 'bat-production',
      'discount': window.DISC_CURRENT_ID || 'disc-monthly-dist',
      'price': window.PRICE_CURRENT_ID || 'price-avg-power',
      'stats': window.STATS_CURRENT_ID || 'stats-production',
      'dc': window.DC_CURRENT_ID || 'dc-overview',
      'nev': window.NEV_CURRENT_ID || 'nev-batch29',
      'wfin': window.WFIN_CURRENT_ID || 'wfin-revenue',
      'export': window.CDS_CURRENT_EXPORT_ID || 'cds-monthly',
      'commercial': window.CV_CURRENT_ID || 'cv-monthly',
      'topic': window.TOPIC_CURRENT_ID || 'topic-h1-profit'
    };
    try { window.cdsRenderInfoPanel(midTabDefaultPane[tab] || ''); } catch(e) {}
  }

  // ── 引用元リンク切替 ──
  var CDS_SOURCE_URLS = {
    'zenntai':    'https://www.sohu.com/a/1087234171_115312',
    'export':     'https://www.sohu.com/a/1091661532_115312',
    'jishuhaiex': 'https://www.sohu.com/a/1085170493_115312',
    'import':     'https://www.sohu.com/a/1092507419_115312',
    'china':      'https://www.sohu.com/a/1096741618_115312',
    'worldshare': 'https://www.sohu.com/a/1096060597_115312',
    'wfin':       'https://www.sohu.com/a/1018231789_115312',
    'profit':     'https://www.sohu.com/a/1093320265_115312',
    'inventory':  'https://www.sohu.com/a/1091093995_115312',
    'battery':    'https://www.sohu.com/a/1079036468_115312',
    'discount':   'https://www.sohu.com/a/1072954545_115312',
    'price':      'https://www.sohu.com/a/1089384727_115312',
    'stats':      'https://www.sohu.com/a/1089669092_115312',
    'dc':         'https://mp.weixin.qq.com/s/E91BkEc_iomunzKwdxs7jg',
    'nev':        'https://www.sohu.com/a/1094497452_115312',
    'commercial': 'https://www.sohu.com/a/1089077970_115312',
    'topic':      'https://www.sohu.com/a/1072054032_115312'
  };
  window.CDS_SOURCE_URLS = CDS_SOURCE_URLS;
  // 既定ペインの記事URLがあればそれを優先（ペインごとに出典記事が違うことがある）
  var srcUrl = ((typeof midTabDefaultPane !== 'undefined' && typeof window.cdsSourceForPane === 'function')
                ? window.cdsSourceForPane(midTabDefaultPane[tab]) : null) || CDS_SOURCE_URLS[tab] || '';
  var srcLink = document.getElementById('cds-source-link');
  if (srcLink) { srcLink.href = srcUrl; srcLink.textContent = srcUrl; }

  // ボタン
  document.querySelectorAll('.cds-mid-tab').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('cds-mid-btn-' + tab);
  if (btn) btn.classList.add('active');

  // サブナビ
  document.getElementById('cds-sub-zenntai').style.display     = (tab === 'zenntai')     ? '' : 'none';
  document.getElementById('cds-sub-export').style.display      = (tab === 'export')      ? '' : 'none';
  document.getElementById('cds-sub-import').style.display      = (tab === 'import')      ? '' : 'none';
  document.getElementById('cds-sub-china').style.display       = (tab === 'china')       ? '' : 'none';
  document.getElementById('cds-sub-worldshare').style.display  = (tab === 'worldshare')  ? '' : 'none';
  var wfinSubEl = document.getElementById('cds-sub-wfin');
  if (wfinSubEl) wfinSubEl.style.display = (tab === 'wfin') ? '' : 'none';
  document.getElementById('cds-sub-profit').style.display      = (tab === 'profit')      ? '' : 'none';
  document.getElementById('cds-sub-inventory').style.display   = (tab === 'inventory')   ? '' : 'none';
  document.getElementById('cds-sub-battery').style.display     = (tab === 'battery')     ? '' : 'none';
  document.getElementById('cds-sub-discount').style.display    = (tab === 'discount')    ? '' : 'none';
  document.getElementById('cds-sub-jishuhaiex').style.display  = (tab === 'jishuhaiex')  ? '' : 'none';
  document.getElementById('cds-sub-price').style.display       = (tab === 'price')       ? '' : 'none';
  document.getElementById('cds-sub-stats').style.display       = (tab === 'stats')       ? '' : 'none';
  var dcSubEl = document.getElementById('cds-sub-dc');
  if (dcSubEl) dcSubEl.style.display = (tab === 'dc') ? '' : 'none';
  var nevSubEl = document.getElementById('cds-sub-nev');
  if (nevSubEl) nevSubEl.style.display = (tab === 'nev') ? '' : 'none';
  var cvSubEl = document.getElementById('cds-sub-commercial');
  if (cvSubEl) cvSubEl.style.display = (tab === 'commercial') ? '' : 'none';
  var topicSubEl = document.getElementById('cds-sub-topic');
  if (topicSubEl) topicSubEl.style.display = (tab === 'topic') ? '' : 'none';

  if (tab === 'zenntai') {
    var pillElZt = document.getElementById('cdsPills');
    var contElZt = document.getElementById('cdsPillsContent');
    // display:none!important を強制上書き
    if (pillElZt) pillElZt.style.cssText = 'display:block !important';
    if (contElZt) contElZt.style.cssText = 'display:block';
    ztShowPane('zt-summary');
    document.querySelectorAll('#cds-sub-zenntai .nav-link').forEach(function(b){
      b.classList.toggle('active', b.textContent.indexOf('月次4指標') >= 0);
    });
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ ztInitCharts(); setTimeout(ztInitCharts, 150); }); });
    // Excel未読込の場合もバックグラウンドで読み込む
    if (typeof CDS_LOADED !== 'undefined' && !CDS_LOADED && typeof loadCdsExcel === 'function') {
      loadCdsExcel();
    }
  } else if (tab === 'jishuhaiex') {
    var jhTarget = window.JH_CURRENT_ID || 'jh-monthly-trend';
    jhShowPane(jhTarget);
    document.querySelectorAll('#cds-sub-jishuhaiex [data-cds-jh-target]').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-cds-jh-target') === '#' + jhTarget);
    });
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ jhRender(jhTarget); setTimeout(function(){ jhRender(jhTarget); }, 150); }); });
  } else if (tab === 'import') {
    var targetId = window.IMP_CURRENT_ID || 'imp-trend';
    // 1) cdsPills / cdsPillsContent を確実に表示（!important を setAttribute で上書き）
    var pillEl2 = document.getElementById('cdsPills');
    var contEl2 = document.getElementById('cdsPillsContent');
    if (pillEl2) pillEl2.setAttribute('style', 'display:block');
    if (contEl2) contEl2.setAttribute('style', 'display:block');
    // 2) 全ペインを非表示 → 対象ペインだけ表示
    document.querySelectorAll('.cds-pane[id^="imp-"]').forEach(function(p){ p.classList.remove('cds-active'); });
    var targetPane = document.getElementById(targetId);
    if (targetPane) targetPane.classList.add('cds-active');
    // 3) サブナビのactive状態
    document.querySelectorAll('#cds-sub-import [data-cds-import-target]').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-cds-import-target') === ('#' + targetId));
    });
    // 4) グラフ描画：requestAnimationFrame → setTimeout の2段階でDOMが確実に描画された後に実行
    requestAnimationFrame(function(){
      setTimeout(function(){
        var ecId = 'ec-' + targetId;
        var fn = window.IMP_RENDER && window.IMP_RENDER[targetId];
        if (fn) fn();
        setTimeout(function(){
          var ec = window.IMP_EC && window.IMP_EC[ecId];
          if (ec) { try { ec.resize(); } catch(e){} }
        }, 100);
      }, 50);
    });
  } else if (tab === 'china') {
    // 中国地域別タブ初回表示時：地図パネルをデフォルト表示
    cdsShowPane('cds-china-map');
    // 地図を（遅延して）初期化
    setTimeout(cpcaInitMap, 80);
    // 中タブBのボタンにactiveセット
    document.querySelectorAll('#cds-sub-china [data-cds-target]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-cds-target') === '#cds-china-map');
    });
  } else if (tab === 'worldshare') {
    var wsTarget = window.WS_CURRENT_ID || 'ws-regional';
    wsShowPane(wsTarget);
    document.querySelectorAll('#cds-sub-worldshare [data-cds-ws-target]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-cds-ws-target') === '#' + wsTarget);
    });
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ wsRender(wsTarget); setTimeout(function(){ wsRender(wsTarget); }, 150); }); });
  } else if (tab === 'wfin') {
    var wfinTarget = window.WFIN_CURRENT_ID || 'wfin-revenue';
    if (typeof wfinShowPane === 'function') wfinShowPane(wfinTarget);
    document.querySelectorAll('#cds-sub-wfin [data-cds-wfin-target]').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-cds-wfin-target') === '#' + wfinTarget);
    });
    requestAnimationFrame(function(){ requestAnimationFrame(function(){
      if (typeof wfinRender === 'function') { wfinRender(wfinTarget); setTimeout(function(){ wfinRender(wfinTarget); }, 150); }
    }); });
  } else if (tab === 'profit') {
    cdsShowPane('cds-profit-monthly');
    document.querySelectorAll('#cds-sub-profit [data-cds-target]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-cds-target') === '#cds-profit-monthly');
    });
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ initProfitCharts(); setTimeout(initProfitCharts, 150); }); });
  } else if (tab === 'inventory') {
    var invTarget = window.INV_CURRENT_ID || 'inv-total';
    invShowPane(invTarget);
    document.querySelectorAll('#cds-sub-inventory [data-cds-inv-target]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-cds-inv-target') === '#' + invTarget);
    });
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ invRender(invTarget); setTimeout(function(){ invRender(invTarget); }, 150); }); });
  } else if (tab === 'battery') {
    var batTarget = window.BAT_CURRENT_ID || 'bat-production';
    batShowPane(batTarget);
    document.querySelectorAll('#cds-sub-battery [data-cds-battery-target]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-cds-battery-target') === '#' + batTarget);
    });
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ batRender(batTarget); setTimeout(function(){ batRender(batTarget); }, 150); }); });
  } else if (tab === 'discount') {
    var discTarget = window.DISC_CURRENT_ID || 'disc-monthly-dist';
    discShowPane(discTarget);
    document.querySelectorAll('#cds-sub-discount [data-cds-discount-target]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-cds-discount-target') === '#' + discTarget);
    });
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ discRender(discTarget); setTimeout(function(){ discRender(discTarget); }, 150); }); });
  } else if (tab === 'price') {
    var priceTarget = window.PRICE_CURRENT_ID || 'price-avg-power';
    priceShowPane(priceTarget);
    document.querySelectorAll('#cds-sub-price [data-cds-price-target]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-cds-price-target') === '#' + priceTarget);
    });
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ priceRender(priceTarget); setTimeout(function(){ priceRender(priceTarget); }, 150); }); });
  } else if (tab === 'stats') {
    var statsTarget = window.STATS_CURRENT_ID || 'stats-production';
    statsShowPane(statsTarget);
    document.querySelectorAll('#cds-sub-stats [data-cds-stats-target]').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-cds-stats-target') === '#' + statsTarget);
    });
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ statsRender(statsTarget); setTimeout(function(){ statsRender(statsTarget); }, 150); }); });
  } else if (tab === 'dc') {
    var dcTarget = window.DC_CURRENT_ID || 'dc-overview';
    cdsShowPane(dcTarget);
    document.querySelectorAll('#cds-sub-topic [data-cds-target^="#dc-"]').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-cds-target') === '#' + dcTarget);
    });
    // 再描画を遅延して確実に発火（タブ切替時のサイズ0問題対策）
    requestAnimationFrame(function(){ requestAnimationFrame(function(){
      var fn = CDS_FNS[dcTarget]; if (fn) fn();
      setTimeout(function(){ var fn2 = CDS_FNS[dcTarget]; if (fn2) fn2(); }, 150);
    }); });
  } else if (tab === 'nev') {
    var nevTarget = window.NEV_CURRENT_ID || 'nev-tax-reduction';
    nevShowPane(nevTarget);
    document.querySelectorAll('#cds-sub-nev [data-cds-nev-target]').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-cds-nev-target') === '#' + nevTarget);
    });
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ nevRender(nevTarget); setTimeout(function(){ nevRender(nevTarget); }, 150); }); });
  } else if (tab === 'commercial') {
    var cvTarget = window.CV_CURRENT_ID || 'cv-monthly';
    // cdsPills / cdsPillsContent を表示
    var pillElCv = document.getElementById('cdsPills');
    var contElCv = document.getElementById('cdsPillsContent');
    if (pillElCv) pillElCv.setAttribute('style', 'display:block');
    if (contElCv) contElCv.setAttribute('style', 'display:block');
    // 商用車ペインのみ切替
    document.querySelectorAll('.cds-pane[id^="cv-"]').forEach(function(p){ p.classList.remove('cds-active'); });
    var cvPane = document.getElementById(cvTarget);
    if (cvPane) cvPane.classList.add('cds-active');
    // サブナビactive
    document.querySelectorAll('#cds-sub-commercial [data-cds-target]').forEach(function(b){
      b.classList.toggle('active', b.getAttribute('data-cds-target') === '#' + cvTarget);
    });
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ cvRender(cvTarget); setTimeout(function(){ cvRender(cvTarget); }, 150); }); });
  } else if (tab === 'topic') {
    var tpTarget = window.TOPIC_CURRENT_ID || 'topic-h1-profit';
    if (tpTarget.indexOf('dc-') === 0) {
      cdsShowPane(tpTarget);
    } else {
      if (typeof window.topicShowPane === 'function') window.topicShowPane(tpTarget);
      requestAnimationFrame(function(){ requestAnimationFrame(function(){
        if (typeof window.topicRender === 'function') { window.topicRender(tpTarget); setTimeout(function(){ window.topicRender(tpTarget); }, 150); }
      }); });
    }
  } else {
    // 輸出分析タブ：最後に表示していたexportペインへ戻る
    cdsShowPane(CDS_CURRENT_EXPORT_ID || 'cds-monthly');
  }
}

var CDS_CURRENT_EXPORT_ID = 'cds-monthly';

// 既存のcdsShowPaneをラップして輸出側の最後IDを記録
(function(){
  var _orig = window.cdsShowPane;
  window.cdsShowPane = function(id) {
    _orig(id);
    // 輸出分析のペインIDなら記録
    var exportIds = ['cds-monthly','cds-annual','cds-nev','cds-nev-annual','cds-nev-trend',
      'cds-russia','cds-powertype','cds-bodytype','cds-nev-power','cds-nev-body','cds-displace',
      'cds-region','cds-country','cds-nev-ctry','cds-prov','cds-nev-prov','cds-rank',
      'cds-r3','cds-r4','cds-r5','cds-r6','cds-r7','cds-r6b',
      'cds-r8','cds-r9','cds-r10','cds-r9b','cds-r11','cds-r12'];
    if (exportIds.includes(id)) CDS_CURRENT_EXPORT_ID = id;
    // ダブルクレジットのペインIDなら記録
    if (typeof id === 'string' && id.indexOf('dc-') === 0) {
      window.DC_CURRENT_ID = id;
      // サブナビのactive状態も同期
      document.querySelectorAll('#cds-sub-topic [data-cds-target^="#dc-"]').forEach(function(b){
        b.classList.toggle('active', b.getAttribute('data-cds-target') === '#' + id);
      });
    }
  };
})();

// ========== 世界シェア タブ ==========
(function(){

var WS_EC = {};
window.WS_CURRENT_ID = 'ws-regional';

// --- データ定義 ---
var WS = {
  years: ['2017','2018','2019','2020','2021','2022','2023','2024','2025','2026年1-9月'],
  regional: {
    北米洲:   [2126,2128,2087,1749,1821,1701,1923,1993,2035,1519],
    欧州:     [1882,1838,1761,1541,1539,1357,1567,1682,1672,1300],
    南半球:   [584,616,587,454,520,522,528,556,626,537],
    アジアその他:[1929,1954,1971,1532,1577,1753,1878,1803,1922,1570],
    中国:     [2887,2799,2575,2527,2625,2685,3005,3143,3435,2327]
  },
  regionalShare: {
    北米洲:   [22.6,22.8,23.2,22.4,22.5,21.2,21.6,21.7,21.0,20.9],
    欧州:     [20.0,19.7,19.6,19.7,19.0,16.9,17.6,18.3,17.3,17.9],
    南半球:   [6.2,6.6,6.5,5.8,6.4,6.5,5.9,6.1,6.5,7.4],
    アジアその他:[20.5,20.9,21.9,19.6,19.5,21.9,21.1,19.6,19.8,21.6],
    中国:     [30.7,30.0,28.7,32.4,32.5,33.5,33.8,34.2,35.4,32.1]
  },
  chinaShareAnnual: {
    years: ['2017','2018','2019','2020','2021','2022','2023','2024','2025','2026年1-9月'],
    share: [30.7,30.0,28.7,32.4,32.5,33.5,33.8,34.2,35.4,32.1]
  },
  // 世界販売前年比（画像4「世界増速」行）
  worldGrowth: {
    years: ['2017','2018','2019','2020','2021','2022','2023','2024','2025','2026年1-9月'],
    rate:  [3,-1,-4,-13,4,-1,11,3,6,3]
  },
  monthly: {
    months: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
    data: {
      '2023年': [591,640,812,678,733,789,726,736,801,777,793,823],
      '2024年': [695,626,833,722,749,785,723,718,781,827,847,870],
      '2025年': [708,687,885,771,792,809,783,768,858,871,865,892],
      '2026年': [722,670,906,796,817,871,820,777,874,null,null,null]
    }
  },
  // 国別 2026年1-9月（図4の24か国）
  country: {
    names:  ["中国","米国","インド","日本","ドイツ","ブラジル","英国","フランス","カナダ","イタリア","メキシコ","韓国","スペイン","ロシア","オーストラリア","トルコ","インドネシア","マレーシア","タイ","南アフリカ","ベトナム","アルゼンチン","ベルギー","フィリピン"],
    vol2026:  [2327,1230,489,355,243.5,222,200.4,152.3,147.1,140.2,133.9,123.2,108.6,105.6,95.8,83.3,67.9,60.3,57.3,49.2,43.7,38,36.9,33.3],
    share2025:[35.4,17.3,5.8,4.7,3.3,2.8,2.4,2.1,2,1.8,1.6,1.7,1.4,1.5,1.3,1.4,0.8,0.8,0.7,0.6,0.6,0.6,0.5,0.5],
    share2026:[32.1,17,6.7,4.9,3.4,3.1,2.8,2.1,2,1.9,1.8,1.7,1.5,1.5,1.3,1.1,0.9,0.8,0.8,0.7,0.6,0.5,0.5,0.5],
    growth2026:[-4,-2,22,2,4,16,10,2,0,7,20,-2,8,5,2,-10,21,4,16,13,27,-16,-3,-7]
  },
  // メーカーシェア推移 (2016-2026年1-9月)
  makerYears: ['2016','2017','2018','2019','2020','2021','2022','2023','2024','2025','2026年1-9月'],
  makers: {
    '日本 トヨタ':    [10.4,10.4,10.7,11.2,11.5,12.2,12.3,11.7,11,11,10.6],
    'ドイツ VW':      [10.8,10.9,11.1,11.6,11.2,10.1,9.8,9.7,9.3,8.9,7.8],
    '現代起亜':       [8.2,7.3,7.5,7.7,7.9,8.2,8,7.6,7.5,7.4,7.4],
    'Stellantis':    [8.4,7.7,8.8,8.7,7.9,7.8,7.1,6.7,6,5.5,5.7],
    'ルノー日産':     [9,9.3,9.2,9,8.2,7.6,6.5,5.9,5.7,5.4,5.1],
    'ジーリー Geely':       [1.5,2,2.3,2.4,2.7,2.7,2.9,3.1,3.8,4.6,4.7],
    '米国 GM':        [8.5,8.3,7.1,6.8,6.9,5.7,5.5,5.2,4.6,4.6,4.4],
    '日本 スズキ':    [3,3.2,3.5,3.2,3,3.3,3.6,3.3,3.4,3.3,3.6],
    '米国 フォード':  [6.9,6.6,6,5.7,5.4,4.9,4.7,4.5,4.5,4.4,4],
    'チェリー Chery':       [0.8,0.8,0.9,0.9,1,1.3,1.7,2.6,3.5,3.7,4.5],
    'BYD':           [0.6,0.5,0.6,0.5,0.6,0.9,2.4,3.5,4.9,5.4,5.4],
    'SAIC':       [2.8,2.9,3.2,3,3.5,3.8,3.9,3.7,3.1,3.5,3.8],
    '日本 ホンダ':    [5.4,5.6,5.6,5.8,5.7,5.4,4.7,4.5,4.2,3.6,3.4],
    'ドイツ BMW':     [2.3,2.3,2.4,2.6,2.7,2.8,2.7,2.7,2.5,2.5,2.3],
    'ドイツ メルセデス':[2.8,2.9,3,3.2,3.2,2.9,3,2.9,2.8,2.5,2.2],
    'タタ Tata':       [1.1,1.1,1.3,1.1,1,1.2,1.6,1.4,1.4,1.3,1.6],
    'テスラ':         [0.1,0.1,0.2,0.3,0.6,1.3,1.9,2.4,2.2,1.9,2.2],
    'グレートウォール GWM':       [1.2,1.2,1.1,1.2,1.5,1.7,1.5,1.7,1.8,1.8,1.8],
    'チャンアン Changan':       [1.6,1.5,1.3,1.3,1.7,1.9,2.2,2.3,2.4,2.5,1.9],
    '日本 マツダ':    [1.6,1.6,1.7,1.6,1.6,1.5,1.3,1.4,1.3,1.3,1.3],
    'マヒンドラ':     [0.6,0.6,0.7,0.7,0.5,0.6,0.8,0.9,1,1,1.1],
    '北汽 BAIC':       [1.5,1.4,1.2,1.1,1.1,1,0.8,0.9,1,1.2,1.2],
    'ドンフェン Dongfeng':       [1.3,1.3,1.1,1.1,1.3,1.3,1.1,0.8,0.9,1,0.9],
    'FAW（一汽）':       [0.5,0.6,0.6,0.7,1,1,0.7,0.8,0.9,1,0.7],
    '広汽 GAC':       [0.4,0.5,0.6,0.4,0.5,0.6,0.8,1,0.9,0.7,0.8],
    'JAC':       [0.8,0.6,0.5,0.5,0.6,0.6,0.6,0.6,0.6,0.6,0.5],
    'リープモーター Leapmotor':       [0,0,0,0,0,0.1,0.1,0.2,0.3,0.7,1.1],
    'CNHTC（中国重汽）':       [0.2,0.3,0.4,0.3,0.6,0.5,0.3,0.4,0.4,0.5,0.5]
  },
  // メーカー地域別シェア詳細
  makerRegion: {
    names: ['日本 トヨタ','ドイツ VW','現代起亜','Stellantis','ルノー日産','ジーリー Geely','米国 GM','日本 スズキ','米国 フォード','チェリー Chery','BYD','SAIC','日本 ホンダ','ドイツ BMW','ドイツ メルセデス','タタ Tata','テスラ','グレートウォール GWM','チャンアン Changan','日本 マツダ','マヒンドラ','北汽 BAIC','ドンフェン Dongfeng','FAW（一汽）','広汽 GAC','JAC','リープモーター Leapmotor','CNHTC（中国重汽）','日本 五十鈴','セレス Seres','伊朗霍徳罗','シャオミ Xiaomi'],
    share2026: {
      中国:        [4.1,5.3,1.3,0.1,1.2,11.2,1.8,0,0.9,9.5,13.5,9.2,1,1.5,1.2,0,3.2,4,5.2,0.3,0,3.5,2.7,2.1,2.3,1.1,2.9,1.6,null,null,null,null],
      北米洲:       [14.5,4.5,11.6,7.4,6.7,0.9,15.7,0.2,11.7,0,0,0.3,8.5,2.3,2.6,0.5,2.7,0.1,0.1,2.9,0,0,0,0,0,0.1,0,0,null,null,null,null],
      欧州:        [6.2,22.1,6,14.6,10.6,3.4,0,1,4.3,3.5,2.1,2.2,0.5,5.8,5.5,0.8,1.9,1.1,0.4,1.2,0,0.1,0.3,0.1,0.1,0.4,0.7,0,null,null,null,null],
      アジアその他:[20,1.9,13.1,2.2,4.2,0.8,0.5,15,1,1.9,1.3,1.1,4.7,1.1,1,6,0.9,0.5,0.4,1.1,5,0.1,0,0,0.2,0.1,0,0,null,null,null,null],
      南半球:       [10.9,10.9,9.2,13.9,7,2,6.3,2.1,3.8,5.3,5.5,1.8,2,1,1.6,0.3,1.2,3,0.9,1.7,0.3,0.8,0.4,0.1,0.3,0.5,0.2,0.1,null,null,null,null]
    },
    share2025: {
      中国:      [4.5,7.5,1.4,0.1,1.8,10.3,1.8,0.0,1.0,8.1,13.4,8.0,2.0,1.8,1.5,0.1,2.5,3.9,6.4,0.3,0.0,3.1,2.7,2.7,1.8,1.1,1.7,1.3,0.0,1.5,0.0,0.0],
      北米洲:    [14.5,4.7,11.2,7.2,6.6,0.9,16.5,0.2,12.6,0.0,0.0,0.2,8.0,2.4,2.6,0.6,3.0,0.1,0.1,3.0,0.0,0.0,0.0,0.0,0.0,0.1,0.0,0.0,0.1,0.0,0.0,0.0],
      欧州:      [6.4,23.0,6.4,14.4,11.4,3.5,0.0,1.0,5.0,2.3,1.1,2.0,0.4,5.9,5.6,0.7,1.4,1.2,0.4,1.0,0.0,0.1,0.2,0.1,0.1,0.6,0.2,0.1,0.1,0.0,0.0,0.0],
      アジアその他:[21.6,2.5,14.4,2.3,4.7,0.6,0.4,14.9,1.5,1.2,1.1,1.0,5.3,1.3,1.4,5.2,0.6,0.3,0.3,1.3,4.8,0.0,0.0,0.0,0.1,0.1,0.0,0.0,1.5,0.0,1.7,0.0],
      南半球:    [12.7,12.1,9.3,15.8,7.1,0.7,6.5,2.2,4.3,3.6,3.0,1.6,2.1,1.1,2.0,0.2,0.5,2.4,0.5,2.1,0.3,0.6,0.2,0.1,0.0,0.4,0.0,0.1,1.3,0.2,0.0,0.0]
    },
    vs2019: {
      中国:        [-1.5,-10.1,-2.4,-0.6,-4,5.1,-4.9,-0.1,0,6.8,11.6,-0.3,-5.3,-0.6,-1.2,-0.2,3.2,0,0.9,-0.5,0,-0.3,-1.1,-0.3,0.8,-0.6,2.9,0.4,null,null,null,null],
      北米洲:       [1.4,0,3.6,-4.8,-2,0.4,-0.3,0,-2,0,0,0.3,-0.5,0.3,-0.2,-0.1,1.8,0.1,0.1,1,0,0,0,0,0,0.1,0,0,null,null,null,null],
      欧州:        [1.3,-0.1,-1.4,-6.7,-4.8,1.6,-0.1,-0.3,-2.6,3.5,2.1,2.1,-0.2,0.4,-1,-0.5,1.4,1.1,0.4,-0.2,-0.1,0.1,0.3,0.1,0.1,0.2,0.7,0,null,null,null,null],
      アジアその他:[-4.3,0.4,0.9,0.8,-3,0.5,-1.8,0.9,-0.6,1.9,1.3,0.7,-3.6,0,-0.5,2.7,0.9,0.5,0.3,-1.1,1.8,0.1,0,0,0.2,0.1,0,0,null,null,null,null],
      南半球:       [-1.5,-1.9,-0.1,1.4,-5.2,1.6,-5.8,0.6,-3.7,4.8,5.4,1.3,-1.4,-0.1,-1,-0.1,1.2,2.6,0.7,-1.1,0,0.7,0.2,0.1,0.3,0.3,0.2,0.1,null,null,null,null]
    }
  }
};

// カラーパレット
var WS_COLORS = {
  中国: '#e74c3c', 北米洲: '#3498db', 欧州: '#2ecc71',
  アジアその他: '#f39c12', 南半球: '#9b59b6',
  '2023年': '#95a5a6', '2024年': '#3498db', '2025年': '#2ecc71', '2026年': '#e74c3c'
};

// ===== 世界NEV データ＆描画 =====
var WSN_EC = {};
function wsnEc(id) {
  if (!WSN_EC[id]) {
    var el = document.getElementById(id);
    if (!el) return null;
    WSN_EC[id] = echarts.init(el, null, {renderer:'canvas'});
  }
  return WSN_EC[id];
}

var WSN_COLORS = {
  '中国':'#e74c3c','欧州':'#3498db','北米':'#2ecc71','北米洲':'#2ecc71',
  'アジアその他':'#f39c12','南半球':'#9b59b6','北米':'#2ecc71','北米洲':'#2ecc71',
  '2022年':'#27ae60','2023年':'#2c3e50','2024年':'#f39c12','2025年':'#000000','2026年':'#e74c3c',
  'BEV':'#3498db','PHEV':'#e74c3c','HEV':'#27ae60','NEV':'#9b59b6',
  '氢':'#1abc9c'
};

var WSN = {
  // 図1: 世界汽车年別データ（万台）
  yearly: {
    years: ['2008','2009','2010','2011','2012','2013','2014','2015','2016','2017','2018','2019','2020','2021','2022','2023','2024','2025','26年1-9月'],
    bev:   [0,0,0,3,5,10,15,24,47,74,129,158,197,477,771,1028,1139,1526,1290],
    phev:  [0,0,0,1,5,7,9,12,29,42,60,54,87,179,267,400,648,762,548],
    h2:    [0,0,0,0,0,0,0,0,0.2,0.3,0.2,0.7,0.8,2,2,2,1,1,0.6],
    nev:   [0,0,0,4,11,17,25,37,77,117,189,212,285,658,1039,1429,1788,2289,1838],
    hev:   [36,61,82,81,147,153,157,142,177,200,212,229,230,319,372,500,577,660,581],
    ice:   [6478,6306,7036,7401,7812,8109,8383,8577,8898,9092,8933,8540,7288,7159,6607,6975,6766,6740,4833],
    total: [6514,6367,7119,7486,7969,8278,8565,8756,9152,9408,9335,8981,7803,8135,8018,8901,9177,9689,7252]
  },
  // 画像2: 自動車総販売に占める各動力比率（%）
  shareOfTotal: {
    years: ['2008','2009','2010','2011','2012','2013','2014','2015','2016','2017','2018','2019','2020','2021','2022','2023','2024','2025','26年1-9月'],
    bev:   [0,0,0,0,0.1,0.1,0.2,0.3,0.5,0.8,1.4,1.8,2.5,5.9,9.6,11.5,12.4,15.7,17.8],
    phev:  [null,0,0,0,0.1,0.1,0.1,0.1,0.3,0.4,0.6,0.6,1.1,2.2,3.3,4.5,7.1,7.9,7.6],
    hev:   [0.6,1,1.2,1.1,1.8,1.8,1.8,1.6,1.9,2.1,2.3,2.5,3,3.9,4.6,5.6,6.3,6.8,8],
    ice:   [99.4,99,98.8,98.9,98,98,97.9,98,97.2,96.6,95.7,95.1,93.4,88,82.4,78.3,74.2,69.6,66.7]
  },
  // 図2: 新能源内份额（%、2026年1-9月記事の小数1桁の値）
  shareInner: {
    years: ['2008','2009','2010','2011','2012','2013','2014','2015','2016','2017','2018','2019','2020','2021','2022','2023','2024','2025','26年1-9月'],
    bev:   [79.4,95.3,78.1,78.1,47.9,58.6,62.3,66.2,61.4,63.6,68.1,74.2,69.3,72.5,74.2,71.9,63.7,66.7,70.2],
    phev:  [null,3.7,21.3,21.9,52.1,41.4,37.7,33.7,38.3,36.1,31.8,25.5,30.4,27.2,25.7,28,36.2,33.3,29.8],
    h2:    [20.6,1,0.6,0,0,0,0,0.1,0.3,0.3,0.1,0.3,0.3,0.3,0.1,0.1,0,0,0]
  },
  // 画像3: 世界NEV月次（万台）
  monthlyWorld: {
    months: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
    data: {
      '2022年':[64,57,82,54,71,90,85,92,106,102,116,86],
      '2023年':[68,84,111,97,111,127,115,126,133,133,144,164],
      '2024年':[107,84,136,123,136,153,137,147,175,185,196,208],
      '2025年':[135,131,182,170,183,191,181,191,228,225,236,235],
      '2026年':[143,127,202,195,213,243,225,225,265,null,null,null]
    }
  },
  // 画像4: 中国除く世界NEV月次（万台）
  monthlyExCh: {
    months: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
    data: {
      '2022年':[22.2,25.2,36.3,26.3,28.6,32.7,27.6,27.9,38.0,34.1,41.5,54.1],
      '2023年':[28.5,33.9,49.2,35.9,42.4,50.4,40.8,44.9,47.7,42.7,46.2,50.6],
      '2024年':[36.8,37.8,52.1,41.6,44.6,51.8,41.7,40.8,51.1,48.1,51.7,56.4],
      '2025年':[44.7,45.8,65.6,53.7,58.4,64.8,60.5,58.5,75.5,60.6,63.0,74.5],
      '2026年':[55.3,54.6,85.8,71.1,74.6,91.3,79.1,71.9,95.5,null,null,null]
    }
  },
  // 画像8: EU NEV月次（万台）
  monthlyEU: {
    months: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
    data: {
      '2022年':[14.4,15.5,24.3,15.0,17.4,21.3,15.3,15.4,24.3,20.8,27.5,39.6],
      '2023年':[14.9,17.5,30.9,18.9,24.2,29.8,21.9,25.4,27.0,23.7,26.4,28.5],
      '2024年':[19.1,19.7,29.1,21.3,22.2,29.6,20.7,17.4,29.2,24.9,26.8,29.7],
      '2025年':[23.7,23.6,36.6,28.3,30.2,36.0,29.7,24.1,39.5,34.4,36.8,43.2],
      '2026年':[29.1,29.1,50.8,37.7,39.5,51.6,41.5,33.9,54.4,null,null,null]
    }
  },
  // 図7: 中欧米NEV月次比較（万台、2023年1月〜2026年9月。2023年分は前回までの記事の値）
  compareMonthly: {
    labels: ["23年1月","23年2月","23年3月","23年4月","23年5月","23年6月","23年7月","23年8月","23年9月","23年10月","23年11月","23年12月","24年1月","24年2月","24年3月","24年4月","24年5月","24年6月","24年7月","24年8月","24年9月","24年10月","24年11月","24年12月","25年1月","25年2月","25年3月","25年4月","25年5月","25年6月","25年7月","25年8月","25年9月","25年10月","25年11月","25年12月","26年1月","26年2月","26年3月","26年4月","26年5月","26年6月","26年7月","26年8月","26年9月"],
    europe:  [15,17,31,19,24,30,22,25,27,24,26,28,19,19,28,21,22,29,20,17,29,24,26,29,24,24,37,28,30,36,30,24,39,34,37,40,29,29,51,38,40,52,41,34,54],
    namerica:[10,11,12,12,13,14,14,14,14,13,13,15,11,11,13,13,14,13,12,15,13,14,14,16,12,12,16,14,15,13,17,20,20,11,10,12,8,9,11,10,11,11,11,11,12],
    china:   [39,50,62,60,68,76,74,80,83,89,96,111,70,46,83,81,91,98,95,105,123,137,144,151,90,85,116,115,124,125,120,132,151,163,172,159,88,72,116,124,138,152,146,153,170]
  },
  // 画像10: NEV地域別シェア（%、5地域）
  regionShareNev: {
    years: ['2021年','2022年','2023年','2024年','2025年','2026年1-9月'],
    '中国':       [52.2,62.5,63.7,69,68.3,63.1],
    '欧州':       [34.4,23.9,20.5,16.6,17.1,20.2],
    '北米洲':     [10.9,10.1,11.3,9.8,7.6,5.3],
    'アジアその他':[2.4,3.1,3.7,3.6,5.7,8.2],
    '南半球':     [0.1,0.4,0.8,1,1.3,3.2]
  },
  // 画像12: BEV地域別シェア（%）
  regionShareBev: {
    years: ['2021年','2022年','2023年','2024年','2025年','2026年1-9月'],
    '中国':       [59.7,64.8,61.6,63.4,64.3,59.5],
    '欧州':       [26,20.1,20,17.7,17.3,20.2],
    '北米洲':     [11.7,11.3,13,12.6,9.2,6.6],
    'アジアその他':[2.5,3.3,4.4,5,8,10.6],
    '南半球':     [0.2,0.5,1.1,1.2,1.3,3.2]
  },
  // 画像15: HEV地域別シェア（%）
  regionShareHev: {
    years: ['2021年','2022年','2023年','2024年','2025年','2026年1-9月'],
    '中国':       [16.7,20.5,15.5,14.4,15.4,16.4],
    '欧州':       [20.9,24.8,23.6,24.3,24,23.8],
    '北米洲':     [26.9,21.2,24,27,29.6,31.2],
    'アジアその他':[35.3,33.4,36.7,34,30.7,27.5],
    '南半球':     [0.1,0.2,0.2,0.3,0.3,1.1]
  },
  // 画像9: NEV国別浸透率（%）
  // 注: 2020列の出典値は他年と整合せず（全球31.9%等）。原文ママ掲載・描画時null化。
  penetration: {
    years: ["2018年","2019年","2020年","2021年","2022年","2023年","2024年","25年3Q","25年通年","26年1-9月"],
    '全世界':       [0.6,0.8,31.9,7.8,13.1,15.9,19.5,24.9,23.6,25.3],
    '中国':        [1.1,1.7,71.8,12.6,24.4,29.9,39.2,46.8,45.5,49.8],
    'ドイツ':       [0.1,0.3,0.5,22.7,28,22.3,18.2,26.8,26.8,34.2],
    'フランス':      [0,0.3,0.4,14.4,17.3,22,21.5,23.2,23.2,32.5],
    'ノルウェー':     [4.5,9.9,4.9,69.8,73.5,70.1,71.9,80.1,80.9,83],
    '欧州その他':     [0.2,0.7,0.5,7.2,10.8,13.8,13.7,18.8,18.8,22.1],
    'スウェーデン':    [0.3,1.5,1.5,39.1,49.1,51.2,50.9,56.3,55.8,59],
    'イタリア':      [0,0.1,0.2,9.8,9.8,8,7,12.1,11.9,16.4],
    '英国':        [0.1,0.5,1.3,16.3,20.3,21.2,24.7,32,31.3,36.7],
    '欧州合計':      [0.1,0.6,0.6,14.2,18.5,18.5,17.6,23.7,23.4,28.5],
    '米国':        [1,1,1.4,4.2,6.9,9.1,9.7,12.7,9.7,7],
    '北米その他':     [0.3,0.4,0.6,1.6,2.9,3.9,4.5,3.1,3,4.4],
    '北米合計':      [0.9,0.9,1.3,3.8,6.3,8.3,8.8,11,8.5,6.5],
    '韓国':        [0,0,80.2,6.2,9.9,8.9,9.5,19.3,14,25.6],
    '日本':        [0,0,79.5,1,2.2,2.9,2.3,2.4,2.3,3.8],
    'アジアその他':    [0,0,14.5,0.2,0.6,1.9,3.3,7.9,7.5,9.8],
    'アジアその他合計':  [0,0,41.9,1,1.9,2.8,3.6,7.7,6.9,9.7],
    '南半球合計':     [0,0,0,0.2,0.8,2.2,3.2,4.7,4.7,10.9]
  },
  // 画像5: 自主新能源海外份額（%、月次）
  overseasMonthly: {
    months: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
    data: {
      '2023年':[7.0,5.8,6.2,6.0,6.9,6.9,6.3,6.9,7.2,7.8,8.1,9.2],
      '2024年':[12.2,9.6,8.4,9.4,8.3,9.9,10.2,9.7,8.7,9.5,9.3,11.0],
      '2025年':[13.2,11.6,12.6,14.4,15.0,15.9,15.3,14.7,15.6,18.5,19.5,20.8],
      '2026年':[26.6,20.2,20.6,24.2,24.9,25.8,27.2,28.6,27.8,null,null,null]
    },
    annual: {'2023年':7.1,'2024年':9.6,'2025年':15.8}
  },
  // 画像6: 自主海外份額 by region/country
  overseasRegion: {
    years: ["2021年","2022年","2023年","2024年","25年通年","26年1Q","26年2Q","26年3Q","26年1-9月"],
    rows: [
      {label:'欧州・ドイツ', vals:[0.2,1.9,4.4,3.7,5.8,6.9,10.2,12.1,10]},
      {label:'欧州・フランス', vals:[1.7,3.9,7,4.2,6.7,5.1,10.9,11.6,9.5]},
      {label:'欧州・ノルウェー', vals:[3.4,8,6,9.6,11.8,13.1,14,17.6,15.1]},
      {label:'欧州・欧州その他', vals:[2.4,4.9,6.8,12.6,15.8,18.1,20.8,25.7,21.6]},
      {label:'欧州・スウェーデン', vals:[3.7,7.8,7.9,4.6,3.8,3.3,6.4,6.8,5.7]},
      {label:'欧州・イタリア', vals:[1.3,4.6,6.5,7.3,23.1,38.7,43.2,38.8,40.5]},
      {label:'欧州・英国', vals:[5.7,5.4,8.3,6.7,15.8,25.2,26,34.4,29]},
      {label:'★欧州合計', vals:[2.2,4.2,6.5,7.7,12.2,16.4,18.7,22,19.2], emph:true},
      {label:'北米・北米その他', vals:[1.2,2.1,2.6,4,6.1,17.2,19,18.6,18.3]},
      {label:'★北米合計', vals:[0.1,0.1,0.2,0.3,0.4,2,2.4,2.6,2.3], emph:true},
      {label:'アジア・韓国', vals:[0,0,0,0,2.6,4.3,6.5,8.1,6.4]},
      {label:'アジア・日本', vals:[0,0,1.1,2.4,3.7,3.2,2.5,3.2,3]},
      {label:'アジア・アジアその他', vals:[36.2,55.4,52.9,43.6,44,48,45.3,45.4,46.1]},
      {label:'★アジアその他合計', vals:[3.9,12.5,23.9,26.8,33.4,34.8,32.8,34.6,34], emph:true},
      {label:'★南半球合計', vals:[4.9,10.2,40.1,71.3,76.8,78.3,78.2,80.4,79.1], emph:true},
      {label:'★総計', vals:[1.8,3.9,7.1,9.6,15.8,22.2,25,27.8,25.2], emph:true}
    ]
  },
  // 画像11: 世界NEV TOP25 (%)
  makersNev: {
    years: ['2021年','2022年','2023年','2024年','2025年','26年1-9月'],
    data: [
      ["比亜迪 BYD",9.4,17.8,22.2,25.3,22.8,20.9],
      ["吉利 Geely",4.6,5.7,5.8,8.3,10.2,10.1],
      ["米国 テスラ",16.2,14.7,14.9,11.3,8.1,8.7],
      ["上汽 SAIC",10.5,9.3,7.1,6,6.6,7],
      ["奇瑞 Chery",1.6,2.3,0.9,3,4.1,5.8],
      ["零跑 Leapmotor",0.7,1.1,1,1.6,2.8,4.2],
      ["ドイツ VW",11.1,7.6,6.8,5.4,5.8,5.4],
      ["長安 Changan",1.5,2.4,3.1,3.8,4.1,3.1],
      ["現代起亜",5.1,4.4,3.5,2.7,2.5,3],
      ["広汽 GAC",1.9,2.8,3.8,2.4,1.6,2.1],
      ["日本 トヨタ",1.7,0.9,1.3,1.4,1.5,2.1],
      ["ドイツ BMW",4.9,3.9,3.7,2.8,2.7,2.4],
      ["小鵬 XPeng",1.6,1.2,1,1.1,2,1.8],
      ["長城 GWM",2.2,1.3,2,1.9,1.9,1.6],
      ["ルノー日産",4.4,3.4,2.5,1.6,1.7,2],
      ["Stellantis",5.2,4.4,3.7,2.5,2.1,1.9],
      ["蔚来 NIO",1.5,1.3,1.1,1.3,1.4,1.6],
      ["理想 Li Auto",1.4,1.3,2.7,2.9,1.8,1.6],
      ["ドイツ メルセデス",3.8,2.8,3,2.3,1.9,1.6],
      ["小米 Xiaomi",null,null,null,0.8,1.8,1.6],
      ["東風 Dongfeng",1.1,1.8,0.9,1.6,1.8,1.6],
      ["米国 GM",0.9,0.9,1.4,1.1,1.2,1.1],
      ["賽力斯 Seres",0.1,0.8,0.9,2.4,2.1,1.4],
      ["ベトナム VinFast",null,null,0,0.5,0.8,1.1],
      ["北汽 BAIC",0.5,0.6,0.7,0.7,1.1,1]
    ]
  },
  // 画像13: BEV TOP25 (%)
  makersBev: {
    years: ['2021年','2022年','2023年','2024年','2025年','26年1-9月'],
    data: [
      ["比亜迪 BYD",7.1,11.9,16.7,17.4,18,16],
      ["米国 テスラ",22.7,19.9,20.8,17.7,12.2,12.4],
      ["吉利 Geely",2.4,4.8,4.9,8.6,10.1,9.2],
      ["上汽 SAIC",13.1,11.7,9.3,8,8.4,8],
      ["零跑 Leapmotor",1,1.4,1.1,1.9,3.4,5.1],
      ["ドイツ VW",9.4,7.3,7.2,6.3,6.1,4.9],
      ["奇瑞 Chery",2.3,2.9,1.2,2.4,2,3.3],
      ["長安 Changan",2.1,2.7,2.2,2.8,3.8,3.6],
      ["現代起亜",4.9,4.4,3.9,3.5,3.2,3.9],
      ["広汽 GAC",2.7,3.7,5,3.3,2,2.4],
      ["小鵬 XPeng",2.2,1.6,1.4,1.8,3,2.3],
      ["ドイツ BMW",2.4,2.9,3.6,3.2,2.8,2.5],
      ["ルノー日産",5.5,4.4,3.3,2.4,2.4,2.6],
      ["蔚来 NIO",2,1.8,1.6,2,2.1,2.3],
      ["日本 トヨタ",0.3,0.3,0.9,1.2,1.3,2.2],
      ["Stellantis",4,3.2,2.7,2.1,2.1,2.4],
      ["小米 Xiaomi",null,null,null,1.2,2.7,2.1],
      ["ベトナム VinFast",null,null,0,0.8,1.3,1.6],
      ["ドイツ メルセデス",2,1.8,3,2.3,1.6,1.5],
      ["北汽 BAIC",0.6,0.7,0.9,1,1.2,1.2],
      ["理想 Li Auto",null,null,null,0.1,0.5,1.4],
      ["東風 Dongfeng",1.5,2.2,0.8,1.6,1.5,1.2],
      ["米国 GM",1,1.1,1.9,1.5,1.3,0.9],
      ["タタ Tata",0.2,0.1,0,0,0.5,0.8],
      ["米国 フォード",1.2,1.3,1.1,1.3,1.3,1]
    ]
  },
  // 図16: PHEV TOP22 (%)（2026年1-9月記事の表は22社）
  makersPhev: {
    years: ['2021年','2022年','2023年','2024年','2025年','26年1-9月'],
    data: [
      ["比亜迪 BYD",15.3,34.7,36,39.1,32.4,32.3],
      ["奇瑞 Chery",0,0.5,0.2,4.1,8.4,11.8],
      ["吉利 Geely",10,8.2,7.8,7.6,10.4,12.3],
      ["ドイツ VW",15.4,8.5,5.6,3.9,5.1,6.4],
      ["上汽 SAIC",4,2.7,1.6,2.3,2.9,4.7],
      ["長城 GWM",0.1,1,3.9,4,4.7,4.3],
      ["理想 Li Auto",5,4.9,9.4,7.9,4.6,2.1],
      ["日本 トヨタ",5.3,2.6,2.3,1.8,1.9,2],
      ["賽力斯 Seres",0.5,2.6,2.6,6.2,5.5,2.9],
      ["零跑 Leapmotor",null,null,0.9,1.1,1.5,2],
      ["米国 GM",0.8,0.5,0.1,0.5,1,1.6],
      ["東風 Dongfeng",0.3,0.5,1,1.6,2.3,2.4],
      ["広汽 GAC",0,0,0.8,0.9,0.7,1.3],
      ["長安 Changan",0,1.6,5.5,5.5,4.7,2],
      ["ドイツ BMW",11.1,6.8,3.8,2.2,2.4,2.1],
      ["ドイツ メルセデス",8.4,5.7,3.1,2.4,2.5,1.8],
      ["小鵬 XPeng",null,null,null,null,null,0.6],
      ["米国 フォード",3.1,2.6,1.5,0.9,1.2,1.1],
      ["一汽 FAW",0,null,null,0.3,1.1,0.8],
      ["ルノー日産",1.8,0.5,0.7,0.2,0.3,0.7],
      ["北汽 BAIC",0.1,0,0,0.1,1,0.7],
      ["現代起亜",5.7,4.4,2.7,1.4,1.1,0.8]
    ]
  },
  // 画像16: HEV TOP20 (%)
  makersHev: {
    years: ['2021年','2022年','2023年','2024年','2025年','26年1-9月'],
    data: [
      ["日本 トヨタ",62.1,56.5,55.5,55.8,51.7,48.1],
      ["現代起亜",9.9,13,13.2,13.3,13.8,14.1],
      ["日本 ホンダ",14.4,12.5,12.7,11.6,11.5,10.5],
      ["ルノー日産",8.4,9.7,11.7,12.1,12,9.7],
      ["上汽 SAIC",null,0.8,0.2,0.7,2.6,5.7],
      ["米国 フォード",3,3.5,3.2,3.7,4.5,3.3],
      ["吉利 Geely",0.1,0.7,0.1,0.2,0,0.7],
      ["日本 スバル",0,0,0,0,0.6,1.5],
      ["ドイツ VW",0,0,0,0,0,1.6],
      ["奇瑞 Chery",null,null,null,null,0,0.9],
      ["長安 Changan",null,null,null,null,null,0.5],
      ["日本 マツダ",null,0.4,0.4,0.4,0.8,0.8],
      ["Stellantis",0,0,0,0.1,0.2,0.4],
      ["広汽 GAC",null,0.9,1.1,0.5,0.5,0.5],
      ["北汽 BAIC",null,null,null,0.5,0.5,0.3],
      ["日本 三菱",null,null,0,0.2,0.2,0.3],
      ["東風 Dongfeng",null,null,0.4,0.3,0.5,0.3],
      ["長城 GWM",0.1,0.5,0.1,0.1,0.2,0.1],
      ["EBRO",null,null,null,null,0,0.1],
      ["韓国 SsangYong",null,null,null,null,0.1,0.1]
    ]
  }
};


// ===== 描画関数群 =====

// ① 年別推移
window.wsnSetYearlyView = function(view, btn) {
  document.querySelectorAll('#ws-nev-yearly-tabs .btn').forEach(function(b){ b.className='btn btn-sm btn-outline-secondary'; });
  btn.className='btn btn-sm btn-primary active';
  window.WSN_YEARLY_VIEW = view;
  wsnDrawYearly(view);
};
function wsnDrawYearly(view) {
  var chart = wsnEc('ec-ws-nev-yearly'); if (!chart) return;
  var d = WSN.yearly, sd = WSN.shareOfTotal, si = WSN.shareInner;
  var opt;
  if (view === 'volume') {
    opt = {
      tooltip: { trigger:'axis', axisPointer:{type:'shadow'},
        formatter: function(p){ var s='<b>'+p[0].axisValue+'</b><br>'; p.forEach(function(x){ if(x.value!=null) s+=x.marker+x.seriesName+': '+x.value+'万台<br>'; }); return s; } },
      legend: { top: 0, type:'scroll' },
      grid: { top: 50, left: 70, right: 80, bottom: 50 },
      xAxis: { type:'category', data:d.years, axisLabel:{rotate:30,fontSize:10} },
      yAxis: [
        { type:'value', name:'NEV/HEV/FCEV（万台）', position:'left' },
        { type:'value', name:'自動車総販売・ICE車（万台）', position:'right' }
      ],
      series: [
        { name:'BEV（純電動）', type:'bar', stack:'nev', data:d.bev, itemStyle:{color:WSN_COLORS['BEV']} },
        { name:'PHEV（プラグインHV）', type:'bar', stack:'nev', data:d.phev, itemStyle:{color:WSN_COLORS['PHEV']} },
        { name:'FCEV（水素）', type:'bar', stack:'nev', data:d.h2, itemStyle:{color:WSN_COLORS['氢']} },
        { name:'HEV（ハイブリッド）', type:'bar', data:d.hev, itemStyle:{color:WSN_COLORS['HEV']} },
        { name:'ICE車（内燃機関）', type:'line', yAxisIndex:1, data:d.ice, smooth:false, lineStyle:{width:2,color:'#7f8c8d'}, itemStyle:{color:'#7f8c8d'} },
        { name:'自動車総販売', type:'line', yAxisIndex:1, data:d.total, smooth:false, lineStyle:{width:2.5,color:'#2c3e50'}, itemStyle:{color:'#2c3e50'} }
      ]
    };
  } else if (view === 'share') {
    opt = {
      tooltip: { trigger:'axis', axisPointer:{type:'shadow'},
        formatter: function(p){ var s='<b>'+p[0].axisValue+'</b><br>'; p.forEach(function(x){ if(x.value!=null) s+=x.marker+x.seriesName+': '+x.value+'%<br>'; }); return s; } },
      legend: { top: 0 },
      grid: { top: 50, left: 60, right: 30, bottom: 50 },
      xAxis: { type:'category', data:sd.years, axisLabel:{rotate:30,fontSize:10} },
      yAxis: { type:'value', max:100, axisLabel:{formatter:'{value}%'} },
      series: [
        { name:'BEV（純電動）', type:'bar', stack:'all', data:sd.bev, itemStyle:{color:WSN_COLORS['BEV']} },
        { name:'PHEV（プラグインHV）', type:'bar', stack:'all', data:sd.phev, itemStyle:{color:WSN_COLORS['PHEV']} },
        { name:'HEV（ハイブリッド）', type:'bar', stack:'all', data:sd.hev, itemStyle:{color:WSN_COLORS['HEV']} },
        { name:'ガソリン車', type:'bar', stack:'all', data:sd.ice, itemStyle:{color:'#bdc3c7'} }
      ]
    };
  } else {
    opt = {
      tooltip: { trigger:'axis', axisPointer:{type:'shadow'},
        formatter: function(p){ var s='<b>'+p[0].axisValue+'</b><br>'; p.forEach(function(x){ if(x.value!=null) s+=x.marker+x.seriesName+': '+x.value+'%<br>'; }); return s; } },
      legend: { top: 0 },
      grid: { top: 50, left: 60, right: 30, bottom: 50 },
      xAxis: { type:'category', data:si.years, axisLabel:{rotate:30,fontSize:10} },
      yAxis: { type:'value', max:100, axisLabel:{formatter:'{value}%'} },
      series: [
        { name:'BEV（純電動）', type:'bar', stack:'inner', data:si.bev, itemStyle:{color:WSN_COLORS['BEV']} },
        { name:'PHEV（プラグインHV）', type:'bar', stack:'inner', data:si.phev, itemStyle:{color:WSN_COLORS['PHEV']} },
        { name:'FCEV（水素）', type:'bar', stack:'inner', data:si.h2, itemStyle:{color:WSN_COLORS['氢']} }
      ]
    };
  }
  chart.setOption(opt, true);
}

// ② 月次
window.wsnSetMonthlyView = function(view, btn) {
  document.querySelectorAll('#ws-nev-monthly-tabs .btn').forEach(function(b){ b.className='btn btn-sm btn-outline-secondary'; });
  btn.className='btn btn-sm btn-primary active';
  window.WSN_MONTHLY_VIEW = view;
  wsnDrawMonthly(view);
};
function wsnDrawMonthly(view) {
  var chart = wsnEc('ec-ws-nev-monthly'); if (!chart) return;
  var titleMap = { world:'🌐 世界全体NEV月次', exch:'🌏 中国除く世界NEV月次', eu:'🇪🇺 EU NEV月次', compare:'📊 中欧米NEV月次比較' };
  if (view === 'compare') {
    var d = WSN.compareMonthly;
    chart.setOption({
      title: { text: titleMap[view], left:'center', top:0, textStyle:{fontSize:13,color:'#444'} },
      tooltip: { trigger:'axis', formatter: function(params){ var s='<b>'+params[0].axisValue+'</b><br>'; params.forEach(function(p){ if(p.value!=null) s+=p.marker+p.seriesName+': '+p.value+'万台<br>'; }); return s; } },
      legend: { top: 25, data:['欧州','北米','中国'] },
      grid: { top: 60, left: 55, right: 30, bottom: 60 },
      xAxis: { type:'category', data:d.labels, axisLabel:{rotate:60,fontSize:9} },
      yAxis: { type:'value', name:'万台' },
      series: [
        { name:'欧州', type:'line', data:d.europe, smooth:false, symbol:'circle', symbolSize:4, lineStyle:{width:2,color:WSN_COLORS['欧州']}, itemStyle:{color:WSN_COLORS['欧州']} },
        { name:'北米', type:'line', data:d.namerica, smooth:false, symbol:'circle', symbolSize:4, lineStyle:{width:2,color:'#2c3e50'}, itemStyle:{color:'#2c3e50'} },
        { name:'中国', type:'line', data:d.china, smooth:false, symbol:'circle', symbolSize:4, lineStyle:{width:2.5,color:WSN_COLORS['中国']}, itemStyle:{color:WSN_COLORS['中国']} }
      ]
    }, true);
    return;
  }
  var src = view==='world' ? WSN.monthlyWorld : view==='exch' ? WSN.monthlyExCh : WSN.monthlyEU;
  var years = ['2022年','2023年','2024年','2025年','2026年'];
  var series = years.map(function(y){
    return {
      name:y, type:'line', smooth:false, data:src.data[y], connectNulls:false,
      symbol:'circle', symbolSize:6,
      lineStyle:{ width:y==='2026年'?2.8:2, color:WSN_COLORS[y] },
      itemStyle:{ color:WSN_COLORS[y] },
      label: y==='2026年' ? { show:true, position:'top', formatter:function(p){return p.value!=null?p.value:'';}, fontSize:11, fontWeight:'bold', color:'#e74c3c' } : { show:false }
    };
  });
  chart.setOption({
    title: { text: titleMap[view], left:'center', top:0, textStyle:{fontSize:13,color:'#444'} },
    tooltip: { trigger:'axis', formatter: function(params){ var s='<b>'+params[0].axisValue+'</b><br>'; params.forEach(function(p){ if(p.value!=null) s+=p.marker+p.seriesName+': '+p.value+'万台<br>'; }); return s; } },
    legend: { top: 25, data: years },
    grid: { top: 60, left: 55, right: 20, bottom: 40 },
    xAxis: { type:'category', data:src.months },
    yAxis: { type:'value', name:'万台' },
    series: series
  }, true);
}

// ③ 地域別シェア
window.wsnSetRegionView = function(view, btn) {
  document.querySelectorAll('#ws-nev-region-tabs .btn').forEach(function(b){ b.className='btn btn-sm btn-outline-secondary'; });
  btn.className='btn btn-sm btn-primary active';
  window.WSN_REGION_VIEW = view;
  wsnDrawRegion(view);
};
function wsnDrawRegion(view) {
  var chart = wsnEc('ec-ws-nev-region'); if (!chart) return;
  var d = view==='bev' ? WSN.regionShareBev : view==='hev' ? WSN.regionShareHev : WSN.regionShareNev;
  var regions = ['中国','欧州','北米洲','アジアその他','南半球'];
  var series = regions.map(function(r){
    return {
      name: r, type:'bar', stack:'total',
      data: d[r],
      itemStyle: { color: WSN_COLORS[r] },
      label: { show:true, position:'inside', formatter:function(p){return p.value>=3?p.value+'%':'';}, fontSize:10, color:'#fff' }
    };
  });
  var titleMap = { nev:'⚡ NEV合計 地域別シェア', bev:'🔌 BEV 地域別シェア', hev:'🔀 HEV 地域別シェア' };
  chart.setOption({
    title: { text: titleMap[view], left:'center', top:0, textStyle:{fontSize:13,color:'#444'} },
    tooltip: { trigger:'axis', axisPointer:{type:'shadow'}, formatter: function(params){ var s='<b>'+params[0].axisValue+'</b><br>'; params.forEach(function(p){ if(p.value!=null) s+=p.marker+p.seriesName+': '+p.value+'%<br>'; }); return s; } },
    legend: { top: 25 },
    grid: { top: 65, left: 55, right: 30, bottom: 40 },
    xAxis: { type:'category', data:d.years },
    yAxis: { type:'value', max:100, axisLabel:{formatter:'{value}%'} },
    series: series
  }, true);
}

// ④ 国別浸透率
function wsnDrawPenetration() {
  var chart = wsnEc('ec-ws-nev-penetration'); if (!chart) return;
  var d = WSN.penetration;
  function clean(arr){ var c=arr.slice(); c[2]=null; return c; }  // 2020列の異常値はnull化
  var keys = ['全世界','中国','欧州合計','北米合計','アジアその他合計','南半球合計','ドイツ','フランス','ノルウェー','スウェーデン','イタリア','英国','米国','韓国','日本'];
  var colorMap = {
    '全世界':'#e74c3c','中国':'#c0392b','欧州合計':'#3498db','北米合計':'#2ecc71',
    'アジアその他合計':'#f39c12','南半球合計':'#9b59b6',
    'ドイツ':'#5dade2','フランス':'#85c1e9','ノルウェー':'#3498db','スウェーデン':'#48c9b0','イタリア':'#aed6f1','英国':'#1abc9c',
    '米国':'#27ae60','韓国':'#e67e22','日本':'#d35400'
  };
  var widthMap = { '全世界':3.5,'中国':3,'欧州合計':2.5,'北米合計':2.5,'アジアその他合計':2.5,'南半球合計':2.5 };
  var series = keys.map(function(k){
    return {
      name: k, type:'line', smooth:false, data: clean(d[k]),
      connectNulls: true,
      symbol: 'circle', symbolSize: widthMap[k] ? 6 : 4,
      lineStyle: { width: widthMap[k] || 1.4, color: colorMap[k] },
      itemStyle: { color: colorMap[k] }
    };
  });
  chart.setOption({
    tooltip: { trigger:'axis', formatter: function(params){ var s='<b>'+params[0].axisValue+'</b><br>'; params.forEach(function(p){ if(p.value!=null) s+=p.marker+p.seriesName+': '+p.value+'%<br>'; }); return s; } },
    legend: { top: 0, type:'scroll', textStyle:{fontSize:11} },
    grid: { top: 50, left: 55, right: 30, bottom: 50 },
    xAxis: { type:'category', data:d.years, axisLabel:{rotate:20,fontSize:10} },
    yAxis: { type:'value', name:'%', axisLabel:{formatter:'{value}%'} },
    series: series,
    graphic: [{ type:'text', right:10, bottom:10, style:{ text:'※2020列は出典の異常値のため除外', fontSize:10, fill:'#999' } }]
  }, true);
}

// ⑤ 自主海外シェア
window.wsnSetOverseasView = function(view, btn) {
  document.querySelectorAll('#ws-nev-overseas-tabs .btn').forEach(function(b){ b.className='btn btn-sm btn-outline-secondary'; });
  btn.className='btn btn-sm btn-primary active';
  window.WSN_OVERSEAS_VIEW = view;
  wsnDrawOverseas(view);
};
function wsnDrawOverseas(view) {
  var chart = wsnEc('ec-ws-nev-overseas'); if (!chart) return;
  if (view === 'monthly') {
    var d = WSN.overseasMonthly;
    var years = ['2023年','2024年','2025年','2026年'];
    var series = years.map(function(y){
      return {
        name: y, type:'line', smooth:false, data:d.data[y], connectNulls:false,
        symbol:'circle', symbolSize:6,
        lineStyle:{ width:y==='2026年'?2.8:2, color:WSN_COLORS[y] },
        itemStyle:{ color:WSN_COLORS[y] },
        label: y==='2026年' ? { show:true, position:'top', formatter:function(p){return p.value!=null?p.value+'%':'';}, fontSize:11, fontWeight:'bold', color:'#e74c3c' } : { show:false }
      };
    });
    chart.setOption({
      title: { text:'🚀 中国系NEV海外市場シェア 月次推移', left:'center', top:0, textStyle:{fontSize:13,color:'#444'} },
      tooltip: { trigger:'axis', formatter: function(params){ var s='<b>'+params[0].axisValue+'</b><br>'; params.forEach(function(p){ if(p.value!=null) s+=p.marker+p.seriesName+': '+p.value+'%<br>'; }); return s; } },
      legend: { top: 25, data: years },
      grid: { top: 60, left: 55, right: 30, bottom: 40 },
      xAxis: { type:'category', data:d.months },
      yAxis: { type:'value', name:'%', axisLabel:{formatter:'{value}%'} },
      series: series
    }, true);
  } else {
    var d = WSN.overseasRegion;
    var rows = d.rows;
    var yearsX = d.years;
    var yLabels = rows.map(function(r){ return r.label; });
    var heatData = [];
    rows.forEach(function(r, ri){
      r.vals.forEach(function(v, ci){ heatData.push([ci, ri, v]); });
    });
    chart.setOption({
      title: { text:'🌏 中国系NEV海外シェア 地域・国別詳細（%）', left:'center', top:0, textStyle:{fontSize:13,color:'#444'} },
      tooltip: { position:'top', formatter: function(p){ return '<b>'+yLabels[p.value[1]]+'</b><br>'+yearsX[p.value[0]]+': <b>'+p.value[2]+'%</b>'; } },
      grid: { top: 30, left: 130, right: 100, bottom: 50 },
      xAxis: { type:'category', data:yearsX, axisLabel:{rotate:25,fontSize:10}, splitArea:{show:true} },
      yAxis: { type:'category', data:yLabels, inverse:true, axisLabel:{fontSize:11}, splitArea:{show:true} },
      visualMap: { min:0, max:100, calculable:true, orient:'vertical', right:5, top:'center',
        inRange:{ color:['#ecf0f1','#f9e79f','#f5b041','#e67e22','#c0392b','#7d3c98'] }, textStyle:{fontSize:10} },
      series: [{
        type:'heatmap', data:heatData,
        label:{ show:true, formatter:function(p){ return p.value[2]+'%'; }, fontSize:9.5, color:'#222' },
        emphasis:{ itemStyle:{ shadowBlur:10, shadowColor:'rgba(0,0,0,0.5)' } }
      }]
    }, true);
  }
}

// ⑥ メーカーランキング
window.wsnSetMakersView = function(view, btn) {
  document.querySelectorAll('#ws-nev-makers-tabs .btn').forEach(function(b){ b.className='btn btn-sm btn-outline-secondary'; });
  btn.className='btn btn-sm btn-primary active';
  window.WSN_MAKERS_VIEW = view;
  wsnDrawMakers(view);
};
function wsnDrawMakers(view) {
  var src = view==='bev'?WSN.makersBev : view==='phev'?WSN.makersPhev : view==='hev'?WSN.makersHev : WSN.makersNev;
  // 26年1Q値で降順ソート
  var rows = src.data.slice().sort(function(a,b){
    var av = a[a.length-1] == null ? -1 : a[a.length-1];
    var bv = b[b.length-1] == null ? -1 : b[b.length-1];
    return bv - av;
  });
  var names = rows.map(function(r){ return r[0]; });
  var yearsAll = src.years; // 6個（2021〜2026年1Q）
  var titleMap = { nev:'⚡ 世界NEVメーカーシェア', bev:'🔌 世界BEVメーカーシェア', phev:'🔋 世界PHEVメーカーシェア', hev:'🔀 世界HEVメーカーシェア' };

  // 動的高さ計算: 1メーカー当たり(barWidth*年数 + ギャップ)
  var rowCount = names.length;
  var barWidth = 9;
  var rowH = barWidth * yearsAll.length + 14;  // 6年×9px + 14px = 68px/メーカー
  var chartH = Math.max(420, rowCount * rowH + 110);
  var el = document.getElementById('ec-ws-nev-makers');
  if (el) el.style.height = chartH + 'px';
  // 高さ変更を反映するため再初期化
  if (WSN_EC['ec-ws-nev-makers']) { WSN_EC['ec-ws-nev-makers'].dispose(); WSN_EC['ec-ws-nev-makers'] = null; }
  var chart = wsnEc('ec-ws-nev-makers');
  if (!chart) return;

  // 年別カラー（最新年を強調赤）
  var yearColors = ['#dfe6e9','#b2bec3','#74b9ff','#a29bfe','#fd79a8','#e74c3c'];

  // バー描画用に逆順データを準備（yAxis category と整合）
  var namesRev = names.slice().reverse();
  var series = yearsAll.map(function(yr, idx){
    var dataAsc = rows.map(function(r){ return r[idx+1]; });
    var dataRev = dataAsc.slice().reverse();
    return {
      name: yr, type:'bar', barWidth: barWidth,
      data: dataRev,
      itemStyle: { color: yearColors[idx] || '#3498db' },
      label: {
        show: idx === yearsAll.length-1,
        position:'right',
        formatter: function(p){ return p.value!=null ? p.value+'%' : ''; },
        fontSize:10, color:'#c0392b', fontWeight:'bold'
      }
    };
  });

  chart.setOption({
    title: { text: titleMap[view] + '（' + rowCount + '社）', left:'center', top:0, textStyle:{fontSize:14,color:'#444',fontWeight:'bold'} },
    tooltip: {
      trigger:'axis',
      axisPointer:{ type:'shadow' },
      formatter: function(params){
        if (!params || params.length === 0) return '';
        var s = '<b>' + params[0].name + '</b><br>';
        // 年が古い→新しい順で表示
        params.slice().sort(function(a,b){ return a.seriesIndex - b.seriesIndex; }).forEach(function(p){
          var v = (p.value === null || p.value === undefined) ? '-' : p.value + '%';
          s += p.marker + p.seriesName + ': <b>' + v + '</b><br>';
        });
        return s;
      }
    },
    legend: { top: 28, data: yearsAll, itemWidth:14, itemHeight:10, textStyle:{fontSize:11} },
    grid: { top: 70, left: 130, right: 80, bottom: 30 },
    xAxis: { type:'value', axisLabel:{formatter:'{value}%'}, splitLine:{lineStyle:{type:'dashed',color:'#ecf0f1'}} },
    yAxis: { type:'category', data: namesRev, axisLabel:{fontSize:11,color:'#2c3e50'} },
    series: series
  }, true);
}

// ペイン切替時のresize対応（高さが0で初期化された場合のリカバリ）
window.wsnResizeAll = function(paneId){
  var ec = WSN_EC['ec-'+paneId];
  if (ec) try { ec.resize(); } catch(e) {}
};
// 初期化（ペイン表示時にwsRender経由で呼ばれる）


var WS_MAKER_COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#34495e','#e91e63','#00bcd4','#ff5722','#607d8b','#795548','#4caf50','#ff9800','#2196f3','#673ab7','#009688','#f44336','#03a9f4'];

function wsEc(id) {
  if (!WS_EC[id]) {
    var el = document.getElementById(id);
    if (!el) return null;
    WS_EC[id] = echarts.init(el, null, {renderer:'canvas'});
  }
  return WS_EC[id];
}
// ペイン表示
window.wsShowPane = function(id) {
  document.querySelectorAll('.cds-pane[id^="ws-"]').forEach(function(p){ p.classList.remove('cds-active'); });
  var el = document.getElementById(id);
  if (el) el.classList.add('cds-active');
  window.WS_CURRENT_ID = id;
  // 解説パネル更新
  if (typeof window.cdsRenderInfoPanel === 'function') {
    try { window.cdsRenderInfoPanel(id); } catch(e) {}
  }
};

// サブナビクリック
document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-cds-ws-target]');
  if (!btn) return;
  var targetId = btn.getAttribute('data-cds-ws-target').replace('#','');
  document.querySelectorAll('#cds-sub-worldshare [data-cds-ws-target]').forEach(function(b){
    b.classList.toggle('active', b === btn);
  });
  wsShowPane(targetId);
  setTimeout(function(){ wsRender(targetId); }, 60);
});

// --- レンダー ---
window.wsRender = function(id) {
  if (id === 'ws-regional') wsDrawRegional(window.WS_REGIONAL_VIEW || 'volume');
  else if (id === 'ws-monthly') wsDrawMonthly();
  else if (id === 'ws-country') wsDrawCountry(window.WS_COUNTRY_VIEW || 'volume');
  else if (id === 'ws-maker') { wsBuildToggleButtons(WS_MAKER_GROUPS[window.WS_MAKER_FILTER||'top10']); wsDrawMaker(window.WS_MAKER_FILTER || 'top10'); }
  else if (id === 'ws-maker-region') wsDrawMakerRegion(window.WS_MAKERREGION_VIEW || 'share2026');
  // 世界NEV ペイン
  else if (id === 'ws-nev-yearly')      wsnDrawYearly(window.WSN_YEARLY_VIEW || 'volume');
  else if (id === 'ws-nev-monthly')     wsnDrawMonthly(window.WSN_MONTHLY_VIEW || 'world');
  else if (id === 'ws-nev-region')      wsnDrawRegion(window.WSN_REGION_VIEW || 'nev');
  else if (id === 'ws-nev-penetration') wsnDrawPenetration();
  else if (id === 'ws-nev-overseas')    wsnDrawOverseas(window.WSN_OVERSEAS_VIEW || 'monthly');
  else if (id === 'ws-nev-makers')      wsnDrawMakers(window.WSN_MAKERS_VIEW || 'nev');
  // ソースリンクを世界NEV用に切替
  wsnUpdateSourceLink(id);
};

// ソースバーURL切替（世界NEVペインのみ別URL）
window.wsnUpdateSourceLink = function(id) {
  var WSN_SOURCE = 'https://www.sohu.com/a/1097497874_115312';
  var DEFAULT_SOURCE = 'https://www.sohu.com/a/1096060597_115312';
  var srcLink = document.getElementById('cds-source-link');
  if (!srcLink) return;
  var url = (id && id.indexOf('ws-nev-') === 0) ? WSN_SOURCE : DEFAULT_SOURCE;
  srcLink.href = url;
  srcLink.textContent = url;
};

// 切替ボタン
window.wsSetRegionalView = function(view, btn) {
  document.querySelectorAll('#ws-regional-tabs .btn').forEach(function(b){ b.className='btn btn-sm btn-outline-secondary'; });
  btn.className='btn btn-sm btn-primary active';
  window.WS_REGIONAL_VIEW = view;
  wsDrawRegional(view);
};
window.wsSetCountryView = function(view, btn) {
  document.querySelectorAll('#ws-country-tabs .btn').forEach(function(b){ b.className='btn btn-sm btn-outline-secondary'; });
  btn.className='btn btn-sm btn-primary active';
  window.WS_COUNTRY_VIEW = view;
  wsDrawCountry(view);
};
window.wsSetMakerRegionView = function(view, btn) {
  document.querySelectorAll('#ws-makerregion-tabs .btn').forEach(function(b){ b.className='btn btn-sm btn-outline-secondary'; });
  btn.className='btn btn-sm btn-primary active';
  window.WS_MAKERREGION_VIEW = view;
  wsDrawMakerRegion(view);
};

// ① 地域別販売推移
function wsDrawRegional(view) {
  var chart = wsEc('ec-ws-regional'); if (!chart) return;
  var regions = ['北米洲','欧州','南半球','アジアその他','中国'];
  // 表示用の日本語ラベル（データキーは維持、凡例のみ日本語表記）
  var DISPLAY = { '北米洲':'北米', '欧州':'欧州', '南半球':'南半球', 'アジアその他':'アジアその他', '中国':'中国' };
  var series = regions.map(function(r) {
    return {
      name: DISPLAY[r], type: 'bar', stack: 'total',
      data: view === 'volume' ? WS.regional[r] : WS.regionalShare[r],
      itemStyle: { color: WS_COLORS[r] },
      label: { show: false }
    };
  });
  var legendData = regions.map(function(r){ return DISPLAY[r]; });

  // 世界販売前年比ライン（画像2の「世界増速」行）を右軸で重ね表示（volume表示時のみ）
  if (view === 'volume' && WS.worldGrowth) {
    series.push({
      name: '世界販売前年比', type: 'line', yAxisIndex: 1,
      data: WS.worldGrowth.rate,
      symbol: 'circle', symbolSize: 8,
      lineStyle: { width: 2.5, color: '#e91e63' },
      itemStyle: { color: '#e91e63' },
      label: { show: true, formatter: '{c}%', position: 'top', fontSize: 11, color: '#c2185b', fontWeight: 'bold' },
      z: 10
    });
    legendData.push('世界販売前年比');
  }

  // 中国世界シェアライン（share表示時のみ、右軸で重ね表示）
  if (view === 'share' && WS.chinaShareAnnual) {
    series.push({
      name: '中国世界シェア', type: 'line', yAxisIndex: 1,
      data: WS.chinaShareAnnual.share,
      symbol: 'circle', symbolSize: 8,
      lineStyle: { width: 2.5, color: '#c0392b' },
      itemStyle: { color: '#c0392b' },
      label: { show: true, formatter: '{c}%', position: 'top', fontSize: 11, color: '#922b21', fontWeight: 'bold' },
      z: 10
    });
    legendData.push('中国世界シェア');
  }

  var yAxis = [
    { type: 'value', name: view==='volume'?'万台':'%', axisLabel: { formatter: view==='volume'?'{value}':'{value}%' } }
  ];
  if (view === 'volume') {
    yAxis.push({
      type: 'value', name: '前年比（%）', position: 'right',
      min: -20, max: 20,
      axisLabel: { formatter: '{value}%' },
      splitLine: { show: false }
    });
  } else if (view === 'share') {
    yAxis.push({
      type: 'value', name: '中国シェア（%）', position: 'right',
      min: 24, max: 42,
      axisLabel: { formatter: '{value}%' },
      splitLine: { show: false }
    });
  }

  // バー系列は合計算出、ライン系列は別表示する独自ツールチップ
  var unit = view==='volume'?'万台':'%';
  var tooltipConf = {
    trigger: 'axis', axisPointer: { type: 'shadow' },
    backgroundColor: 'rgba(255,255,255,0.97)', borderColor: '#ddd', borderWidth: 1,
    textStyle: { fontSize: 12 },
    formatter: function(params){
      if (!params || !params.length) return '';
      var bars = params.filter(function(p){ return p.seriesType !== 'line' && p.value != null; });
      var lines = params.filter(function(p){ return p.seriesType === 'line' && p.value != null; });
      var axisLabel = params[0].axisValueLabel || params[0].axisValue || '';
      var total = 0;
      bars.forEach(function(p){ total += Number(p.value) || 0; });
      var s = '<b>' + axisLabel + '</b><br/>';
      if (bars.length > 1) {
        s += '合計: <b>' + (Math.round(total*10)/10).toLocaleString() + '</b> ' + unit + '<br/>';
      }
      bars.forEach(function(p){
        s += '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + p.color + ';margin-right:4px;vertical-align:middle"></span>';
        s += p.seriesName + ': <b>' + p.value + '</b> ' + unit + '<br/>';
      });
      lines.forEach(function(p){
        s += '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + p.color + ';margin-right:4px;vertical-align:middle"></span>';
        s += p.seriesName + ': <b>' + p.value + '%</b><br/>';
      });
      return s;
    }
  };

  chart.setOption({
    tooltip: tooltipConf,
    legend: { top: 0, data: legendData },
    grid: { top: 50, left: 60, right: 60, bottom: 60 },
    xAxis: { type: 'category', data: WS.years, axisLabel: { rotate: 30 } },
    yAxis: yAxis,
    series: series
  }, true);
}

// ② 世界月次販売
function wsDrawMonthly() {
  var chart = wsEc('ec-ws-monthly'); if (!chart) return;
  var years = ['2023年','2024年','2025年','2026年'];
  var series = years.map(function(y) {
    return {
      name: y, type: 'line', smooth: false,
      data: WS.monthly.data[y],
      connectNulls: false,
      symbol: 'circle', symbolSize: 6,
      lineStyle: { width: 2, color: WS_COLORS[y] },
      itemStyle: { color: WS_COLORS[y] },
      label: { show: y === '2026年', position: 'top', formatter: function(p){ return p.value != null ? p.value : ''; }, fontSize: 11, fontWeight: 'bold', color: '#e74c3c' }
    };
  });
  chart.setOption({
    tooltip: { trigger: 'axis', formatter: function(params) {
      var s = '<b>' + params[0].axisValue + '</b><br>';
      params.forEach(function(p){ if (p.value != null) s += p.marker + p.seriesName + ': ' + p.value + '万台<br>'; });
      return s;
    }},
    legend: { top: 0, data: years },
    grid: { top: 50, left: 55, right: 20, bottom: 40 },
    xAxis: { type: 'category', data: WS.monthly.months },
    yAxis: { type: 'value', name: '万台', min: 500 },
    series: series
  }, true);
}

// ④ 国別販売台数
function wsDrawCountry(view) {
  var chart = wsEc('ec-ws-country'); if (!chart) return;
  var names = WS.country.names;
  var vals, unit, colorFn;
  if (view === 'volume') {
    vals = WS.country.vol2026; unit = '万台';
    colorFn = function(v){ return '#3498db'; };
  } else if (view === 'share') {
    vals = WS.country.share2026; unit = '%';
    colorFn = function(v){ return '#9b59b6'; };
  } else {
    vals = WS.country.growth2026; unit = '%';
    colorFn = function(v){ return v >= 0 ? '#2ecc71' : '#e74c3c'; };
  }
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: function(p){ return '<b>' + p[0].name + '</b>: ' + p[0].value + unit; }
    },
    grid: { top: 10, left: 100, right: 60, bottom: 20 },
    xAxis: { type: 'value', name: unit, axisLabel: { formatter: '{value}'+unit } },
    yAxis: { type: 'category', data: names.slice().reverse(), axisLabel: { fontSize: 12 } },
    series: [{
      type: 'bar',
      data: vals.slice().reverse().map(function(v, i) {
        return { value: v, itemStyle: { color: colorFn(v) } };
      }),
      label: { show: true, position: 'right', formatter: function(p){ return p.value + unit; }, fontSize: 11 }
    }]
  }, true);
}

// ⑤ メーカー世界シェア
var WS_MAKER_GROUPS = {
  top10:    ['日本 トヨタ','ドイツ VW','現代起亜','Stellantis','ルノー日産','ジーリー Geely','米国 GM','日本 スズキ','米国 フォード','チェリー Chery'],
  chinese:  ['ジーリー Geely','チェリー Chery','BYD','SAIC','グレートウォール GWM','チャンアン Changan','北汽 BAIC','ドンフェン Dongfeng','FAW（一汽）','広汽 GAC','JAC','CNHTC（中国重汽）'],
  japanese: ['日本 トヨタ','日本 スズキ','日本 ホンダ','日本 マツダ'],
  european: ['ドイツ VW','Stellantis','ルノー日産','ドイツ BMW','ドイツ メルセデス'],
  american: ['米国 GM','米国 フォード','テスラ'],
  all:      Object.keys(WS.makers)
};

// 個別トグル状態
var WS_MAKER_VISIBLE = {};
Object.keys(WS.makers).forEach(function(n){ WS_MAKER_VISIBLE[n] = true; });

function wsBuildToggleButtons(activeNames) {
  var container = document.getElementById('ws-maker-toggles');
  if (!container) return;
  // activeNames に合わせて visible を更新
  Object.keys(WS_MAKER_VISIBLE).forEach(function(n){ WS_MAKER_VISIBLE[n] = activeNames.indexOf(n) >= 0; });
  container.innerHTML = '';
  Object.keys(WS.makers).forEach(function(name, i) {
    var active = WS_MAKER_VISIBLE[name];
    var color = WS_MAKER_COLORS[i % WS_MAKER_COLORS.length];
    var btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.style.cssText = 'font-size:11px;padding:2px 8px;border:2px solid ' + color + ';' +
      (active ? 'background:' + color + ';color:#fff;' : 'background:#fff;color:#555;');
    btn.textContent = WS_MR_NAMES_JA[name] || name;
    btn.onclick = function() {
      WS_MAKER_VISIBLE[name] = !WS_MAKER_VISIBLE[name];
      // プリセットボタンをリセット
      document.querySelectorAll('#ws-maker-filter .btn').forEach(function(b){ b.className='btn btn-sm btn-outline-secondary'; });
      wsBuildToggleButtons(Object.keys(WS_MAKER_VISIBLE).filter(function(n){ return WS_MAKER_VISIBLE[n]; }));
      wsDrawMaker(null);
    };
    container.appendChild(btn);
  });
}

function wsDrawMaker(filter) {
  var chart = wsEc('ec-ws-maker'); if (!chart) return;
  var targets;
  if (filter !== null && filter !== undefined) {
    targets = WS_MAKER_GROUPS[filter] || WS_MAKER_GROUPS.top10;
    wsBuildToggleButtons(targets);
  } else {
    targets = Object.keys(WS.makers).filter(function(n){ return WS_MAKER_VISIBLE[n]; });
  }
  var SHORT = {
    '日本 トヨタ':'トヨタ','ドイツ VW':'VW','現代起亜':'現代起亜','Stellantis':'Stellantis',
    'ルノー日産':'ルノー日産','ジーリー Geely':'吉利','米国 GM':'GM','日本 スズキ':'スズキ',
    '米国 フォード':'フォード','チェリー Chery':'奇瑞','BYD':'BYD','SAIC':'上汽',
    '日本 ホンダ':'ホンダ','ドイツ BMW':'BMW','ドイツ メルセデス':'メルセデス',
    'タタ Tata':'タタ','テスラ':'テスラ','グレートウォール GWM':'長城','チャンアン Changan':'長安',
    '日本 マツダ':'マツダ','マヒンドラ':'マヒンドラ','北汽 BAIC':'北汽','ドンフェン Dongfeng':'東風',
    'FAW（一汽）':'一汽','広汽 GAC':'広汽','JAC':'江淮','CNHTC（中国重汽）':'CNHTC（中国重汽）'
  };
  var series = targets.map(function(name) {
    var colorIdx = Object.keys(WS.makers).indexOf(name);
    var color = WS_MAKER_COLORS[colorIdx % WS_MAKER_COLORS.length];
    var dispName = SHORT[name] || name;
    return {
      name: dispName, type: 'line', smooth: false,
      data: WS.makers[name],
      symbol: 'circle', symbolSize: 5,
      lineStyle: { width: 2, color: color },
      itemStyle: { color: color }
    };
  });
  chart.setOption({
    tooltip: { trigger: 'axis', formatter: function(params) {
      var s = '<b>' + params[0].axisValue + '</b><br>';
      params.sort(function(a,b){ return b.value - a.value; }).forEach(function(p){
        s += p.marker + p.seriesName + ': ' + p.value + '%<br>';
      });
      return s;
    }},
    legend: {
      type: 'scroll', orient: 'horizontal',
      bottom: 0, left: 'center',
      itemWidth: 14, itemHeight: 10, textStyle: { fontSize: 11 },
      pageIconSize: 10,
      data: series.map(function(s){ return s.name; })
    },
    grid: { top: 20, left: 50, right: 20, bottom: 80 },
    xAxis: { type: 'category', data: WS.makerYears, axisLabel: { rotate: 30 } },
    yAxis: { type: 'value', name: 'シェア（%）', axisLabel: { formatter: '{value}%' } },
    series: series
  }, true);
}

window.wsSetMakerFilter = function(filter, btn) {
  document.querySelectorAll('#ws-maker-filter .btn').forEach(function(b){ b.className='btn btn-sm btn-outline-secondary'; });
  btn.className='btn btn-sm btn-primary active';
  window.WS_MAKER_FILTER = filter;
  wsDrawMaker(filter);
};

// 初回トグルボタン構築
setTimeout(function(){
  wsBuildToggleButtons(WS_MAKER_GROUPS.top10);
}, 100);

// ⑥ メーカー地域別シェア — 名称を日本語に修正
var WS_MR_NAMES_JA = {
  '日本 トヨタ':    'トヨタ',
  'ドイツ VW':      'VW（独）',
  '現代起亜':       '現代起亜（韓）',
  'Stellantis':    'Stellantis（伊/仏/米）',
  'ルノー日産':     'ルノー日産（仏/日）',
  'ジーリー Geely':       'ジーリー Geely（中）',
  '米国 GM':        'GM（米）',
  '日本 スズキ':    'スズキ（日）',
  '米国 フォード':  'フォード（米）',
  'チェリー Chery':       'チェリー Chery（中）',
  'BYD':           'BYD（中）',
  'SAIC':       'SAIC（中）',
  '日本 ホンダ':    'ホンダ（日）',
  'ドイツ BMW':     'BMW（独）',
  'ドイツ メルセデス':'メルセデス（独）',
  'タタ Tata':       'タタ Tata（印）',
  'テスラ':         'テスラ（米）',
  'グレートウォール GWM':       'グレートウォール GWM（中）',
  'チャンアン Changan':       'チャンアン Changan（中）',
  '日本 マツダ':    'マツダ（日）',
  'マヒンドラ':     'マヒンドラ（印）',
  '北汽 BAIC':       '北汽 BAIC（中）',
  'ドンフェン Dongfeng':       'ドンフェン Dongfeng（中）',
  'FAW（一汽）':       'FAW（一汽）（中）',
  '広汽 GAC':       '広汽 GAC（中）',
  'JAC':       'JAC（中）',
  'リープモーター Leapmotor':       'リープモーター Leapmotor（中）',
  'CNHTC（中国重汽）':       'CNHTC（中国重汽・中）',
  '日本 五十鈴':    'いすゞ（日）',
  'セレス Seres':         'セレス Seres／AITO（中）',
  '伊朗霍徳罗':     'IKCo（イラン）',
  'シャオミ Xiaomi':       'シャオミ Xiaomi（中）'
};

var WS_MR_GROUP = 'all';
var WS_MR_REGION = 'all';

// 国系グループ定義（makerRegion.namesのインデックスに対応）
var WS_MR_MAKER_GROUPS = {
  all:      null, // null = 全社
  chinese:  ['ジーリー Geely','チェリー Chery','BYD','SAIC','グレートウォール GWM','チャンアン Changan','北汽 BAIC','ドンフェン Dongfeng','FAW（一汽）','広汽 GAC','JAC','リープモーター Leapmotor','CNHTC（中国重汽）','セレス Seres','シャオミ Xiaomi'],
  japanese: ['日本 トヨタ','日本 スズキ','日本 ホンダ','日本 マツダ','日本 五十鈴'],
  european: ['ドイツ VW','Stellantis','ルノー日産','ドイツ BMW','ドイツ メルセデス'],
  american: ['米国 GM','米国 フォード','テスラ'],
  others:   ['現代起亜','タタ Tata','マヒンドラ','伊朗霍徳罗']
};

window.wsSetMrGroup = function(group, btn) {
  WS_MR_GROUP = group;
  document.querySelectorAll('#ws-mr-group-filter .btn').forEach(function(b){ b.className='btn btn-sm btn-outline-secondary'; });
  btn.className = 'btn btn-sm btn-primary active';
  wsDrawMakerRegion(window.WS_MAKERREGION_VIEW || 'share2026');
};

window.wsSetMrRegion = function(region, btn) {
  WS_MR_REGION = region;
  document.querySelectorAll('#ws-mr-region-select .btn').forEach(function(b){ b.className='btn btn-sm btn-outline-secondary'; });
  btn.className = 'btn btn-sm btn-primary active';
  wsDrawMakerRegion(window.WS_MAKERREGION_VIEW || 'share2026');
};

window.wsSetMakerRegionView = function(view, btn) {
  document.querySelectorAll('#ws-makerregion-tabs .btn').forEach(function(b){ b.className='btn btn-sm btn-outline-secondary'; });
  btn.className='btn btn-sm btn-primary active';
  window.WS_MAKERREGION_VIEW = view;
  wsDrawMakerRegion(view);
};

function wsDrawMakerRegion(view) {
  var chart = wsEc('ec-ws-maker-region'); if (!chart) return;
  var regions = ['中国','北米洲','欧州','アジアその他','南半球'];
  var allNames = WS.makerRegion.names;
  var dataSet = view === 'share2026' ? WS.makerRegion.share2026 : view === 'share2025' ? WS.makerRegion.share2025 : WS.makerRegion.vs2019;

  // 国系フィルターで表示メーカーを絞り込む
  var allowedGroup = WS_MR_MAKER_GROUPS[WS_MR_GROUP];
  var filteredIdx = allNames.map(function(n, i){ return i; }).filter(function(i){
    return !allowedGroup || allowedGroup.indexOf(allNames[i]) >= 0;
  });
  var names = filteredIdx.map(function(i){ return WS_MR_NAMES_JA[allNames[i]] || allNames[i]; });

  // 地域フィルター
  var regionList = (WS_MR_REGION === 'all') ? regions : [WS_MR_REGION];

  // 表示行数に応じてバー太さを決める（スマホではさらに拡大）
  var barCount = names.length;
  var barWidth = barCount <= 5 ? 28 : barCount <= 10 ? 22 : barCount <= 15 ? 16 : 12;
  var _w = window.innerWidth || 1024;
  if (_w < 480) barWidth = Math.round(barWidth * 1.8);
  else if (_w < 768) barWidth = Math.round(barWidth * 1.4);
  var chartH = Math.max(320, barCount * (barWidth * regionList.length + 10) + 80);
  var el = document.getElementById('ec-ws-maker-region');
  if (el) el.style.height = chartH + 'px';
  if (WS_EC['ec-ws-maker-region']) { WS_EC['ec-ws-maker-region'].dispose(); WS_EC['ec-ws-maker-region'] = null; }
  chart = wsEc('ec-ws-maker-region');
  if (!chart) return;

  var series = regionList.map(function(r) {
    return {
      name: r, type: 'bar',
      barWidth: barWidth,
      data: filteredIdx.slice().reverse().map(function(i){
        var v = dataSet[r][i];
        return v === null || v === undefined ? 0 : v;
      }),
      itemStyle: { color: WS_COLORS[r] },
      label: {
        show: barCount <= 12,
        position: 'right',
        formatter: function(p){
          if (!p.value) return '';
          var prefix = (view==='vs2019' && p.value > 0) ? '+' : '';
          return prefix + p.value + '%';
        },
        fontSize: 10
      }
    };
  });

  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: function(params) {
        var s = '<b>' + params[0].axisValue + '</b><br>';
        params.forEach(function(p){
          if (!p.value) return;
          var prefix = (view === 'vs2019' && p.value > 0) ? '+' : '';
          s += p.marker + p.seriesName + ': ' + prefix + p.value + (view==='share2026'?'%':'%pt') + '<br>';
        });
        return s;
      }
    },
    legend: regionList.length > 1 ? { top: 8, data: regions } : { show: false },
    grid: { top: regionList.length > 1 ? 40 : 10, left: 10, right: barCount<=12 ? 60 : 20, bottom: 20, containLabel: true },
    xAxis: { type: 'value', name: (view==='share2026'||view==='share2025')?'シェア（%）':'増減（%pt）',
      axisLabel: { formatter: function(v){ return view==='vs2019' ? (v>0?'+':'')+v+'%' : v+'%'; } }
    },
    yAxis: { type: 'category', data: names.slice().reverse(),
      axisLabel: { fontSize: 11 }
    },
    series: series
  }, true);
}

// リサイズ対応
window.addEventListener('resize', __rafThrottle(function(){
  Object.values(WS_EC).forEach(function(c){ __ecResize(c); });
}));

})();
// ========== 世界シェア タブ END ==========

// ========== ダブルクレジット タブ ==========
(function(){

// === データ定義 ===
// (1) 総合推移 (img_00): 2012〜2025年
var DC = {
  years_full: ['2012','2013','2014','2015','2016','2017','2018','2019','2020','2021','2022','2023','2024','2025'],
  // 数量（万台）
  qty_domestic: [737,1715,1901,2016,2359,2367,2220,2001,1897,1976,2097,2175,2256,2405],
  qty_import:   [45,107,129,96,91,102,94,92,87,89,79,72,63,47],
  qty_total:    [783,1822,2030,2111,2449,2469,2314,2093,1984,2065,2176,2246,2319,2452],
  // 燃費積分（万分）
  fuel_domestic: [473,977,968,1044,1011,1052,717,150,-659,1112,2964,3648,4802,4516],
  fuel_import:   [32,63,92,82,21,17,-19,-21,-78,-81,-74,-59,-91,-93],
  fuel_total:    [505,1040,1060,1126,1032,1069,698,129,-737,1031,2890,3589,4711,4424],
  // 燃油車産量（万台、2016年以降）
  fuel_prod_domestic: [null,null,null,null,2327,2312,2118,1900,1779,1670,1497,1336,1079,1028],
  fuel_prod_import:   [null,null,null,null,89,99,92,86,85,86,75,50,50,36],
  fuel_prod_total:    [null,null,null,null,2416,2411,2210,1985,1863,1756,1572,1393,1130,1065],
  // 新能源産量（万台、2016年以降）
  nev_prod_domestic: [null,null,null,null,32,56,101,101,118,305,600,839,1177,1377],
  nev_prod_import:   [null,null,null,null,1,3,4,6,2,4,4,14,12,10],
  nev_prod_total:    [null,null,null,null,33,58,104,108,120,309,604,853,1189,1387],
  // NEV積分（万分、2016年以降）
  nev_domestic: [null,null,null,null,93,169,394,604,332,604,1480,2062,1610,2002],
  nev_import:   [null,null,null,null,6,11,10,25,-1,-5,-2,4,-10,-13],
  nev_total:    [null,null,null,null,99,179,404,327,330,599,1478,2067,1600,1990],

  // (2) 目標達成率 (img_01): 2016〜2025年
  compliance_years: ['2016','2017','2018','2019','2020','2021','2022','2023','2024','2025'],
  comp_jishu_tatsu: [65,70,82,84,80,75,73,64,60,56],
  comp_jishu_hi:    [null,null,null,9,9,6,5,4,3,2],
  comp_jishu_rate:  [100,100,100,90,90,93,94,94,95,97],
  comp_goshi_tatsu: [37,38,36,11,10,10,15,17,16,18],
  comp_goshi_hi:    [null,null,null,20,20,19,13,13,15,13],
  comp_goshi_rate:  [100,100,100,35,33,34,54,57,52,58],
  comp_gaishi_tatsu:[22,22,23,15,15,15,15,17,15,14],
  comp_gaishi_hi:   [null,null,null,5,4,4,4,3,5,5],
  comp_gaishi_rate: [100,100,100,75,79,79,79,85,75,74],

  // (3) NEV積分 カテゴリ別 (img_02): 2018〜2025年（万点）
  credit_years: ['2018','2019','2020','2021','2022','2023','2024','2025'],
  nev_jishu:    [364,370,285,506,1197,1630,1379,1825],
  nev_gaishi:   [0,1,86,140,209,287,203,208],
  nev_us:       [19,28,34,1,39,103,78,72],
  nev_eu:       [1,-2,-1,-1,2,-1,-5,-4],
  nev_kr:       [3,-7,-5,-4,-4,-1,-4,-7],
  nev_jp:       [7,-28,-38,-43,-23,-10,-31,-14],
  nev_de:       [9,-29,-30,-1,58,59,-19,-90],
  nev_sousei:   [404,332,330,599,1478,2067,1600,1990],

  // (4) 燃費積分 カテゴリ別 (img_03): 2018〜2025年（万点）
  fuel_jishu:   [797,436,-169,933,2445,3277,4442,4592],
  fuel_gaishi:  [0,1,80,214,291,380,389,339],
  fuel_us:      [-96,-88,-109,135,249,157,279,225],
  fuel_eu:      [-24,-19,-20,-18,-12,-27,-38,-32],
  fuel_kr:      [-24,-48,-47,-25,-27,-19,-21,-33],
  fuel_jp:      [-14,-46,-161,-68,-46,-65,-105,-177],
  fuel_de:      [60,-103,-308,-139,-11,-114,-236,-489],
  fuel_sousei:  [698,133,-734,1031,2890,3589,4711,4424],

  // (5) 集団別 (img_04): 2021〜2025年
  group_years: ['2021','2022','2023','2024','2025'],
  groups: ['比亜迪（BYD）','上汽','一汽','吉利','新興EV','長安','東風','広汽','奇瑞','外資','北汽','長城','華晨','起亞','北汽制造','江淮','福汽'],
  // 各集団 [数量, NEV積分, 燃費積分] の 2021〜2025
  group_data: {
    '比亜迪（BYD）':   { qty:[71,181,270,382,326], nev:[166,512,765,580,548], fuel:[355,1030,1458,1855,1482] },
    '上汽':     { qty:[411,384,324,266,314], nev:[33,90,182,110,103], fuel:[202,360,300,343,223] },
    '一汽':     { qty:[311,299,317,294,301], nev:[0,24,40,2,-23],     fuel:[-25,16,-10,-46,-154] },
    '吉利':     { qty:[136,141,163,204,288], nev:[11,91,119,164,241], fuel:[-31,199,302,485,588] },
    '新興EV':   { qty:[35,59,78,131,207],    nev:[102,177,195,228,523], fuel:[218,367,508,813,1195] },
    '長安':     { qty:[166,166,181,175,184], nev:[10,43,57,63,118],   fuel:[8,125,155,216,264] },
    '東風':     { qty:[234,218,175,178,182], nev:[3,65,44,62,112],    fuel:[-12,138,77,294,374] },
    '広汽':     { qty:[212,245,245,177,161], nev:[29,95,191,70,61],   fuel:[67,197,304,160,84] },
    '奇瑞':     { qty:[62,73,87,141,137],    nev:[15,26,5,44,43],     fuel:[-31,13,-68,93,38] },
    '外資':     { qty:[114,119,124,123,106], nev:[136,208,292,194,195], fuel:[142,225,334,312,257] },
    '北汽':     { qty:[101,96,95,94,93],     nev:[3,21,26,34,35],     fuel:[-29,16,-1,61,48] },
    '長城':     { qty:[93,75,76,65,70],      nev:[27,24,34,22,27],    fuel:[39,62,80,92,78] },
    '華晨':     { qty:[69,65,59,61,54],      nev:[5,17,29,10,-7],     fuel:[-6,14,6,42,-67] },
    '起亞':     { qty:[13,12,7,7,8],         nev:[0,0,3,0,-2],        fuel:[-3,-6,-6,-6,-13] },
    '北汽制造': { qty:[0,0,0,0,4],           nev:[0,0,0,0,2],         fuel:[1,5,1,1,-2] },
    '江淮':     { qty:[19,22,21,6,3],        nev:[40,63,65,10,3],     fuel:[98,132,122,29,9] },
    '福汽':     { qty:[4,3,3,2,2],           nev:[0,0,-1,0,0],        fuel:[-4,-5,-4,null,null] }
  },

  // (6) 中央国有集団詳細 (img_05): 2021〜2025年
  central_companies: {
    '一汽': ['一汽大衆','一汽豊田','中国一汽','一汽奥迪','一汽吉林'],
    '長安': ['長安汽車','長安鈴木','長安福特','長安馬自達','江鈴汽車','江西五十鈴','長安PSA'],
    '東風': ['東風日産','賽力斯（SERES）','東風汽車','東風本田','東風柳州','東風小康','神龍汽車','鄭州日産']
  },
  central_data: {
    // 一汽
    '一汽大衆':   { qty:[179,175,186,158,154], nev:[-1,16,3,-26,-51],   fuel:[-45,-10,-67,-136,-211] },
    '一汽豊田':   { qty:[83,83,80,77,81],      nev:[-8,-7,6,3,-8],      fuel:[13,9,23,20,-21] },
    '中国一汽':   { qty:[41,36,44,53,63],      nev:[10,16,32,27,37],    fuel:[16,26,49,85,88] },
    '一汽奥迪':   { qty:[7,5,7,5,3],           nev:[-1,-1,-1,-1,0],     fuel:[-9,-9,-14,-14,-10] },
    '一汽吉林':   { qty:[0,0,0,0,1],           nev:[0,0,0,0,0],         fuel:[0,0,0,-2,0] },
    // 長安
    '長安汽車':   { qty:[116,123,136,129,140], nev:[16,44,57,66,114],   fuel:[48,161,185,244,297] },
    '長安鈴木':   { qty:[1,6,13,16,20],        nev:[0,0,5,4,4],         fuel:[-2,1,22,23,-7] },
    '長安福特':   { qty:[30,23,23,15,20],      nev:[-4,0,-3,-5,-5],     fuel:[-23,-20,-33,-32,-29] },
    '長安馬自達': { qty:[14,9,8,8,7],          nev:[-2,0,-1,-1,2],      fuel:[-5,-6,-8,-8,3] },
    '江鈴汽車':   { qty:[5,5,4,4,5],           nev:[0,0,-1,-1,2],       fuel:[-11,-10,-10,-13,1] },
    '江西五十鈴': { qty:[0,0,0,0,0],           nev:[0,0,0,0,0],         fuel:[0,0,0,0,0] },
    '長安PSA':    { qty:[0,0,0,0,0],           nev:[0,0,0,0,0],         fuel:[0,0,0,0,0] },
    // 東風
    '東風日産':   { qty:[109,92,74,62,62],     nev:[-10,4,-1,-10,6],    fuel:[-44,-12,-29,-57,-42] },
    '賽力斯（SERES）':     { qty:[1,8,10,38,43],        nev:[1,15,19,42,55],     fuel:[6,58,69,251,263] },
    '東風汽車':   { qty:[14,24,18,25,34],      nev:[14,35,23,31,52],    fuel:[40,88,70,127,187] },
    '東風本田':   { qty:[76,68,59,39,32],      nev:[-5,-1,-3,-7,-10],   fuel:[-5,-19,-35,-42,-54] },
    '東風柳州':   { qty:[12,10,6,4,4],         nev:[3,8,3,3,6],         fuel:[-1,14,0,6,12] },
    '東風小康':   { qty:[0,0,3,4,4],           nev:[0,2,3,4,4],         fuel:[0,0,8,15,16] },
    '神龍汽車':   { qty:[9,9,4,4,3],           nev:[0,3,-1,0,-1],       fuel:[0,6,3,6,-6] },
    '鄭州日産':   { qty:[2,1,1,1,0],           nev:[0,0,0,0,0],         fuel:[0,0,0,0,0] }
  },

  // (7) 地方国有詳細 (img_06): 2021〜2025年
  local_companies: {
    '上汽': ['上汽通用五菱','上汽大衆','上汽通用','上汽乗用車','上汽大通','上汽依維柯'],
    '広汽': ['広汽豊田','広汽本田','広汽埃安','広汽伝祺'],
    '奇瑞': ['奇瑞汽車','奇瑞新能源','凱翼汽車','奇瑞路虎'],
    '北汽': ['北京奔馳','北汽乗用車','北京現代','北汽新能源','北汽越野車','北汽福田','北汽雲南'],
    '江淮': ['江淮汽車']
  },
  local_data: {
    // 上汽
    '上汽通用五菱': { qty:[108,106,75,91,113], nev:[14,37,77,74,80],   fuel:[255,314,188,298,302] },
    '上汽大衆':     { qty:[125,133,120,114,106], nev:[2,19,27,2,-22],  fuel:[-12,28,23,-31,-134] },
    '上汽通用':     { qty:[122,104,91,35,49],  nev:[-10,2,26,8,-3],    fuel:[-95,-43,-4,12,-47] },
    '上汽乗用車':   { qty:[51,37,34,23,43],    nev:[26,30,51,24,45],   fuel:[55,60,93,59,90] },
    '上汽大通':     { qty:[4,3,3,3,3],         nev:[1,2,2,1,4],        fuel:[0,2,0,4,11] },
    '上汽依維柯':   { qty:[0,0,0,0,0],         nev:[0,0,0,0,0],        fuel:[0,0,0,0,1] },
    // 広汽
    '広汽豊田':     { qty:[82,101,95,74,76],   nev:[-7,-9,-11,-10,8],  fuel:[7,18,-2,0,20] },
    '広汽本田':     { qty:[79,77,63,39,34],    nev:[-7,-7,-7,-7,-10],  fuel:[-13,-25,-46,-40,-56] },
    '広汽埃安':     { qty:[0,0,0,19,26],       nev:[0,0,0,51,66],      fuel:[0,0,0,105,133] },
    '広汽伝祺':     { qty:[43,64,87,46,25],    nev:[45,111,209,36,-2], fuel:[87,209,353,95,-13] },
    // 奇瑞
    '奇瑞汽車':     { qty:[45,46,70,123,118],  nev:[-6,-6,-8,25,21],   fuel:[-70,-75,-106,33,-24] },
    '奇瑞新能源':   { qty:[9,19,10,13,14],     nev:[21,31,12,19,20],   fuel:[47,94,47,64,65] },
    '凱翼汽車':     { qty:[2,3,2,2,3],         nev:[1,1,1,1,2],        fuel:[2,2,2,2,4] },
    '奇瑞路虎':     { qty:[5,5,5,4,2],         nev:[-1,0,-1,-1,0],     fuel:[-7,-6,-10,-10,-3] },
    // 北汽
    '北京奔馳':     { qty:[58,60,57,57,44],    nev:[-3,7,1,-5,-13],    fuel:[-21,7,-20,-12,-47] },
    '北汽乗用車':   { qty:[6,6,10,15,16],      nev:[8,14,26,23,25],    fuel:[16,25,44,53,42] },
    '北京現代':     { qty:[33,25,24,12,13],    nev:[-4,-4,-4,-3,-4],   fuel:[-22,-21,-22,-16,-20] },
    '北汽新能源':   { qty:[0,0,0,1,10],        nev:[0,1,0,3,21],       fuel:[0,0,0,6,54] },
    '北汽越野車':   { qty:[2,3,3,9,8],         nev:[0,0,0,16,5],       fuel:[-5,-5,-8,27,11] },
    '北汽福田':     { qty:[1,0,1,0,1],         nev:[0,1,1,0,2],        fuel:[0,1,0,1,5] },
    '北汽雲南':     { qty:[1,1,1,0,0],         nev:[2,3,4,1,1],        fuel:[3,4,5,2,2] },
    // 江淮
    '江淮汽車':     { qty:[19,22,21,6,3],      nev:[40,63,65,10,3],    fuel:[98,132,122,29,9] }
  },

  // (8) 新興EV (img_07): 2020〜2024年（2024年まで）
  nf_years: ['2020','2021','2022','2023','2024'],
  nf_companies: ['理想','零跑','蔚来','小鵬','小米'],
  nf_data: {
    '理想':  { qty:[4,9,15,38,51],     nev:[14,24,61,54,null],  fuel:[23,64,107,271,330], rate:[null,9,8,7,8] },
    '零跑':  { qty:[null,3,11,14,28],   nev:[8,39,40,52,null],   fuel:[null,14,67,86,158], rate:[null,null,null,2,3] },
    '蔚来':  { qty:[null,null,null,null,20], nev:[null,null,null,34,134], fuel:[null,null,null,null,null], rate:[null,null,null,null,null] },
    '小鵬':  { qty:[2,8,13,14,17],     nev:[36,54,60,52,105],   fuel:[11,56,84,89,null], rate:[null,null,null,null,null] },
    '小米':  { qty:[null,null,null,null,9],  nev:[null,null,null,null,29],  fuel:[null,null,null,null,57],  rate:[null,null,null,null,null] }
  },

  // (9) 輸入車 (img_08): 2020〜2025年（台）
  import_years: ['2020','2021','2022','2023','2024','2025'],
  import_brands: [
    { name:'日本トヨタ',     data:[256740,239495,210259,188430,196723,196570] },
    { name:'独ベンツ',   data:[144849,170006,159256,139374,128283,87221] },
    { name:'独BMW',          data:[168704,187490,149516,116760,103619,53666] },
    { name:'英ジャガー',     data:[40968,41374,43299,51937,51558,39199] },
    { name:'独ポルシェ',     data:[86968,94025,96847,77968,53618,35694] },
    { name:'瑞ボルボ',       data:[19493,24667,20515,22861,21920,13395] },
    { name:'独VW',           data:[20155,20094,22944,16896,4660,5222] },
    { name:'韓ヒョンデ',     data:[397,2016,2693,2315,1877,1337] },
    { name:'日スバル',       data:[24902,12410,12635,8180,1644,1155] },
    { name:'伊フェラーリ',   data:[338,694,1305,1353,882,533] },
    { name:'米GM',           data:[null,null,null,null,69,421] },
    { name:'米フォード',     data:[13330,6852,3405,285,2074,334] },
    { name:'伊マセラティ',   data:[4002,8396,7565,944,481,82] },
    { name:'英アストンマーティン',data:[360,985,1034,336,41,null] },
    { name:'英マクラーレン', data:[183,274,177,148,32,18] }
  ]
};

// === 描画ユーティリティ ===
function dcEc(id) {
  var el = document.getElementById(id);
  if (!el) return null;
  if (CDS_EC[id]) { try { CDS_EC[id].dispose(); } catch(e){} }
  CDS_EC[id] = echarts.init(el, null, { renderer: 'canvas' });
  return CDS_EC[id];
}

// 色パレット
var DC_COLORS = {
  domestic: '#2b6cb0', import: '#e53e3e', total: '#38a169',
  jishu: '#c53030', gaishi: '#718096',
  us: '#2b6cb0', eu: '#3182ce', kr: '#805ad5', jp: '#dd6b20', de: '#38a169',
  nev: '#38a169', fuel: '#dd6b20', qty: '#718096'
};

// === (1) 総合推移 ===
function dcDrawOverview() {
  var ch = dcEc('ec-dc-overview');
  if (!ch) return;
  ch.setOption({
    tooltip: { trigger:'axis', axisPointer:{ type:'shadow' } },
    legend: { top: 30, type:'scroll' },
    grid: { left: 60, right: 60, top: 100, bottom: 60 },
    xAxis: { type: 'category', data: DC.years_full },
    yAxis: [
      { type: 'value', name: '万台', nameGap: 18, nameLocation: 'end', position: 'left', axisLabel: { fontSize: 10 } },
      { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end', position: 'right', axisLabel: { fontSize: 10 } }
    ],
    series: [
      { name: '総生産台数（万台）', type: 'bar', data: DC.qty_total, yAxisIndex: 0,
        itemStyle: { color: DC_COLORS.qty, opacity: 0.6 } },
      { name: '新能源生産（万台）', type: 'bar', data: DC.nev_prod_total, yAxisIndex: 0,
        itemStyle: { color: DC_COLORS.nev, opacity: 0.6 } },
      { name: '燃費積分（万点）', type: 'line', data: DC.fuel_total, yAxisIndex: 1,
        smooth: true, lineStyle: { width: 3 }, itemStyle: { color: DC_COLORS.fuel } },
      { name: 'NEV積分（万点）', type: 'line', data: DC.nev_total, yAxisIndex: 1,
        smooth: true, lineStyle: { width: 3 }, itemStyle: { color: '#d53f8c' } }
    ]
  }, true);

  // NEV サブチャート
  var ch2 = dcEc('ec-dc-overview-nev');
  if (ch2) {
    var years = DC.years_full.slice(4); // 2016〜
    var nevProd = DC.nev_prod_total.slice(4);
    var nevCr = DC.nev_total.slice(4);
    ch2.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 60, right: 60, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: years },
      yAxis: [
        { type: 'value', name: '万台', nameGap: 18, nameLocation: 'end', position: 'left' },
        { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end', position: 'right' }
      ],
      series: [
        { name: 'NEV生産（万台）', type: 'bar', data: nevProd, yAxisIndex: 0,
          itemStyle: { color: DC_COLORS.nev } },
        { name: 'NEV積分（万点）', type: 'line', data: nevCr, yAxisIndex: 1,
          smooth: true, lineStyle: { width: 3 }, itemStyle: { color: '#d53f8c' } }
      ]
    }, true);
  }

  // 燃油サブチャート
  var ch3 = dcEc('ec-dc-overview-fuel');
  if (ch3) {
    var years = DC.years_full.slice(4);
    var fProd = DC.fuel_prod_total.slice(4);
    var fCr = DC.fuel_total.slice(4);
    ch3.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 60, right: 60, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: years },
      yAxis: [
        { type: 'value', name: '万台', nameGap: 18, nameLocation: 'end', position: 'left' },
        { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end', position: 'right' }
      ],
      series: [
        { name: '燃油車生産（万台）', type: 'bar', data: fProd, yAxisIndex: 0,
          itemStyle: { color: DC_COLORS.qty } },
        { name: '燃費積分（万点）', type: 'line', data: fCr, yAxisIndex: 1,
          smooth: true, lineStyle: { width: 3 }, itemStyle: { color: DC_COLORS.fuel } }
      ]
    }, true);
  }
}

// === (2) 目標達成率 ===
function dcDrawCompliance() {
  var ch = dcEc('ec-dc-compliance');
  if (!ch) return;
  ch.setOption({
    tooltip: { trigger:'axis', valueFormatter: function(v){ return v==null?'-':v+'%'; } },
    legend: { top: 30, type:'scroll' },
    grid: { left: 60, right: 40, top: 100, bottom: 40 },
    xAxis: { type: 'category', data: DC.compliance_years },
    yAxis: { type: 'value', name: '%', nameGap: 18, nameLocation: 'end', max: 100, axisLabel: { formatter: '{value}%' } },
    series: [
      { name: '自主', type: 'line', data: DC.comp_jishu_rate, smooth: true,
        lineStyle: { width: 3 }, itemStyle: { color: DC_COLORS.jishu },
        label: { show: true, position: 'top', formatter: '{c}%', fontSize: 10 } },
      { name: '合資', type: 'line', data: DC.comp_goshi_rate, smooth: true,
        lineStyle: { width: 3 }, itemStyle: { color: DC_COLORS.us },
        label: { show: true, position: 'top', formatter: '{c}%', fontSize: 10 } },
      { name: '外資（輸入）', type: 'line', data: DC.comp_gaishi_rate, smooth: true,
        lineStyle: { width: 3 }, itemStyle: { color: DC_COLORS.jp },
        label: { show: true, position: 'bottom', formatter: '{c}%', fontSize: 10 } }
    ]
  }, true);

  var ch2 = dcEc('ec-dc-compliance-jishu');
  if (ch2) {
    ch2.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 50, right: 30, top: 100, bottom: 30 },
      xAxis: { type: 'category', data: DC.compliance_years },
      yAxis: { type: 'value', name: '社数', nameGap: 18, nameLocation: 'end' },
      series: [
        { name: '達成', type: 'bar', stack: 'a', data: DC.comp_jishu_tatsu,
          itemStyle: { color: '#38a169' } },
        { name: '非達成', type: 'bar', stack: 'a', data: DC.comp_jishu_hi,
          itemStyle: { color: '#e53e3e' } }
      ]
    }, true);
  }

  var ch3 = dcEc('ec-dc-compliance-goshi');
  if (ch3) {
    ch3.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 50, right: 30, top: 100, bottom: 30 },
      xAxis: { type: 'category', data: DC.compliance_years },
      yAxis: { type: 'value', name: '社数', nameGap: 18, nameLocation: 'end' },
      series: [
        { name: '達成', type: 'bar', stack: 'a', data: DC.comp_goshi_tatsu,
          itemStyle: { color: '#38a169' } },
        { name: '非達成', type: 'bar', stack: 'a', data: DC.comp_goshi_hi,
          itemStyle: { color: '#e53e3e' } }
      ]
    }, true);
  }
}

// === (3) NEV積分カテゴリ別 ===
function dcDrawNevCredits() {
  var ch = dcEc('ec-dc-nev-credits');
  if (!ch) return;
  ch.setOption({
    tooltip: { trigger:'axis' },
    legend: { top: 30, type:'scroll' },
    grid: { left: 60, right: 60, top: 100, bottom: 40 },
    xAxis: { type: 'category', data: DC.credit_years },
    yAxis: [
      { type: 'value', name: '万点（自主）', nameGap: 18, nameLocation: 'end', position: 'left' },
      { type: 'value', name: '万点（外資）', nameGap: 18, nameLocation: 'end', position: 'right' }
    ],
    series: [
      { name: '自主', type: 'bar', data: DC.nev_jishu, yAxisIndex: 0,
        itemStyle: { color: DC_COLORS.jishu, opacity: 0.7 } },
      { name: '米系', type: 'line', data: DC.nev_us, yAxisIndex: 1, smooth:true,
        lineStyle: { width: 2.5 }, itemStyle: { color: DC_COLORS.us } },
      { name: '欧系', type: 'line', data: DC.nev_eu, yAxisIndex: 1, smooth:true,
        lineStyle: { width: 2.5 }, itemStyle: { color: DC_COLORS.eu } },
      { name: '韓系', type: 'line', data: DC.nev_kr, yAxisIndex: 1, smooth:true,
        lineStyle: { width: 2.5 }, itemStyle: { color: DC_COLORS.kr } },
      { name: '日系', type: 'line', data: DC.nev_jp, yAxisIndex: 1, smooth:true,
        lineStyle: { width: 2.5 }, itemStyle: { color: DC_COLORS.jp } },
      { name: '独系', type: 'line', data: DC.nev_de, yAxisIndex: 1, smooth:true,
        lineStyle: { width: 2.5 }, itemStyle: { color: DC_COLORS.de } },
      { name: '総計', type: 'line', data: DC.nev_sousei, yAxisIndex: 0,
        smooth:true, lineStyle: { width: 3, type:'dashed' }, itemStyle: { color: '#000' } }
    ]
  }, true);

  // 外資のみ拡大
  var ch2 = dcEc('ec-dc-nev-credits-foreign');
  if (ch2) {
    ch2.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 60, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.credit_years },
      yAxis: { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end' },
      series: [
        { name: '米', type: 'line', data: DC.nev_us, smooth:true, lineStyle:{width:2.5}, itemStyle:{color:DC_COLORS.us} },
        { name: '欧', type: 'line', data: DC.nev_eu, smooth:true, lineStyle:{width:2.5}, itemStyle:{color:DC_COLORS.eu} },
        { name: '韓', type: 'line', data: DC.nev_kr, smooth:true, lineStyle:{width:2.5}, itemStyle:{color:DC_COLORS.kr} },
        { name: '日', type: 'line', data: DC.nev_jp, smooth:true, lineStyle:{width:2.5}, itemStyle:{color:DC_COLORS.jp} },
        { name: '独', type: 'line', data: DC.nev_de, smooth:true, lineStyle:{width:2.5}, itemStyle:{color:DC_COLORS.de} }
      ]
    }, true);
  }

  // 2025年シェア
  var ch3 = dcEc('ec-dc-nev-credits-pie');
  if (ch3) {
    var pieData = [
      { name: '自主', value: 1825, itemStyle:{color:DC_COLORS.jishu} },
      { name: '米系', value: 72, itemStyle:{color:DC_COLORS.us} },
      { name: '欧系', value: 0, itemStyle:{color:DC_COLORS.eu} },
      { name: '韓系', value: 0, itemStyle:{color:DC_COLORS.kr} },
      { name: '日系', value: 0, itemStyle:{color:DC_COLORS.jp} },
      { name: '独系', value: 0, itemStyle:{color:DC_COLORS.de} }
    ].filter(function(d){ return d.value > 0; });
    ch3.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c}万点 ({d}%)' },
      legend: { top: 30, type:'scroll' },
      series: [{
        name: '2025年NEV積分', type: 'pie', radius: ['40%','70%'],
        data: pieData,
        label: { formatter: '{b}\n{d}%' }
      }]
    }, true);
  }
}

// === (4) 燃費積分カテゴリ別 ===
function dcDrawFuelCredits() {
  var ch = dcEc('ec-dc-fuel-credits');
  if (!ch) return;
  ch.setOption({
    tooltip: { trigger:'axis' },
    legend: { top: 30, type:'scroll' },
    grid: { left: 60, right: 60, top: 100, bottom: 40 },
    xAxis: { type: 'category', data: DC.credit_years },
    yAxis: [
      { type: 'value', name: '万点（自主）', nameGap: 18, nameLocation: 'end', position: 'left' },
      { type: 'value', name: '万点（外資）', nameGap: 18, nameLocation: 'end', position: 'right' }
    ],
    series: [
      { name: '自主', type: 'bar', data: DC.fuel_jishu, yAxisIndex: 0,
        itemStyle: { color: DC_COLORS.jishu, opacity: 0.7 } },
      { name: '米系', type: 'line', data: DC.fuel_us, yAxisIndex: 1, smooth:true,
        lineStyle: { width: 2.5 }, itemStyle: { color: DC_COLORS.us } },
      { name: '欧系', type: 'line', data: DC.fuel_eu, yAxisIndex: 1, smooth:true,
        lineStyle: { width: 2.5 }, itemStyle: { color: DC_COLORS.eu } },
      { name: '韓系', type: 'line', data: DC.fuel_kr, yAxisIndex: 1, smooth:true,
        lineStyle: { width: 2.5 }, itemStyle: { color: DC_COLORS.kr } },
      { name: '日系', type: 'line', data: DC.fuel_jp, yAxisIndex: 1, smooth:true,
        lineStyle: { width: 2.5 }, itemStyle: { color: DC_COLORS.jp } },
      { name: '独系', type: 'line', data: DC.fuel_de, yAxisIndex: 1, smooth:true,
        lineStyle: { width: 2.5 }, itemStyle: { color: DC_COLORS.de } },
      { name: '総計', type: 'line', data: DC.fuel_sousei, yAxisIndex: 0,
        smooth:true, lineStyle: { width: 3, type:'dashed' }, itemStyle: { color: '#000' } }
    ]
  }, true);

  var ch2 = dcEc('ec-dc-fuel-credits-foreign');
  if (ch2) {
    ch2.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 60, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.credit_years },
      yAxis: { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end' },
      series: [
        { name: '米', type: 'line', data: DC.fuel_us, smooth:true, lineStyle:{width:2.5}, itemStyle:{color:DC_COLORS.us} },
        { name: '欧', type: 'line', data: DC.fuel_eu, smooth:true, lineStyle:{width:2.5}, itemStyle:{color:DC_COLORS.eu} },
        { name: '韓', type: 'line', data: DC.fuel_kr, smooth:true, lineStyle:{width:2.5}, itemStyle:{color:DC_COLORS.kr} },
        { name: '日', type: 'line', data: DC.fuel_jp, smooth:true, lineStyle:{width:2.5}, itemStyle:{color:DC_COLORS.jp} },
        { name: '独', type: 'line', data: DC.fuel_de, smooth:true, lineStyle:{width:2.5}, itemStyle:{color:DC_COLORS.de} }
      ]
    }, true);
  }

  var ch3 = dcEc('ec-dc-fuel-credits-contrast');
  if (ch3) {
    // 外資合計
    var foreignTotal = DC.credit_years.map(function(_,i){
      return (DC.fuel_us[i]||0)+(DC.fuel_eu[i]||0)+(DC.fuel_kr[i]||0)+(DC.fuel_jp[i]||0)+(DC.fuel_de[i]||0);
    });
    ch3.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 60, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.credit_years },
      yAxis: { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end' },
      series: [
        { name: '自主', type: 'bar', data: DC.fuel_jishu,
          itemStyle: { color: DC_COLORS.jishu } },
        { name: '外資合計（米+欧+韓+日+独）', type: 'bar', data: foreignTotal,
          itemStyle: { color: DC_COLORS.gaishi } }
      ]
    }, true);
  }
}

// === (5) 集団別 ===
function dcDrawGroup() {
  // 2025年 散布図
  var ch = dcEc('ec-dc-group-scatter');
  if (ch) {
    var scatter = DC.groups.map(function(g){
      var d = DC.group_data[g];
      var qty = d.qty[4]||0, nev = d.nev[4]||0, fuel = d.fuel[4]||0;
      return { name: g, value: [nev, fuel, qty] };
    });
    ch.setOption({
      tooltip: {
        trigger: 'item',
        formatter: function(p){
          return p.name+'<br/>NEV積分: '+p.value[0]+'万点<br/>燃費積分: '+p.value[1]+'万点<br/>数量: '+p.value[2]+'万台';
        }
      },
      grid: { left: 60, right: 40, top: 90, bottom: 50 },
      xAxis: { type: 'value', name: 'NEV積分（万点）', nameGap: 18, nameLocation: 'end', axisLine:{onZero:true} },
      yAxis: { type: 'value', name: '燃費積分（万点）', nameGap: 18, nameLocation: 'end', axisLine:{onZero:true} },
      series: [{
        type: 'scatter', data: scatter,
        symbolSize: function(d){ return Math.max(10, Math.min(60, Math.sqrt(Math.abs(d[2]||1))*3)); },
        label: { show: true, formatter: '{b}', position: 'top', fontSize: 11, fontWeight:'bold' },
        itemStyle: {
          color: function(p){
            var nev = p.value[0], fuel = p.value[1];
            if (nev >= 0 && fuel >= 0) return '#38a169';
            if (nev < 0 && fuel < 0) return '#e53e3e';
            return '#dd6b20';
          },
          opacity: 0.7
        },
        markLine: {
          silent: true, symbol:'none',
          lineStyle: { color: '#aaa', type:'dashed' },
          data: [{ xAxis: 0 }, { yAxis: 0 }]
        }
      }]
    }, true);
  }

  // NEV積分推移
  var ch2 = dcEc('ec-dc-group-nev');
  if (ch2) {
    var series = DC.groups.map(function(g,i){
      return { name: g, type: 'line', data: DC.group_data[g].nev, smooth: true,
        lineStyle: { width: 2 } };
    });
    ch2.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 60, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.group_years },
      yAxis: { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end' },
      series: series
    }, true);
  }

  // 燃費積分推移
  var ch3 = dcEc('ec-dc-group-fuel');
  if (ch3) {
    var series = DC.groups.map(function(g){
      return { name: g, type: 'line', data: DC.group_data[g].fuel, smooth: true,
        lineStyle: { width: 2 } };
    });
    ch3.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 60, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.group_years },
      yAxis: { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end' },
      series: series
    }, true);
  }

  // 数量推移
  var ch4 = dcEc('ec-dc-group-prod');
  if (ch4) {
    var series = DC.groups.map(function(g){
      return { name: g, type: 'line', data: DC.group_data[g].qty, smooth: true,
        lineStyle: { width: 2 } };
    });
    ch4.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 60, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.group_years },
      yAxis: { type: 'value', name: '万台', nameGap: 18, nameLocation: 'end' },
      series: series
    }, true);
  }
}

// === (6) 中央国有詳細 ===
function dcDrawCentral() {
  // 2025年 全傘下企業の積分状況（グループ化棒）
  var ch = dcEc('ec-dc-central-2025');
  if (ch) {
    var allCompanies = [];
    var nevData = [], fuelData = [];
    Object.keys(DC.central_companies).forEach(function(grp){
      DC.central_companies[grp].forEach(function(c){
        allCompanies.push(grp+':'+c);
        var d = DC.central_data[c];
        nevData.push(d ? (d.nev[4]||0) : 0);
        fuelData.push(d ? (d.fuel[4]||0) : 0);
      });
    });
    ch.setOption({
      tooltip: { trigger:'axis', axisPointer:{type:'shadow'} },
      legend: { top: 30, type:'scroll' },
      grid: { left: 120, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end' },
      yAxis: { type: 'category', data: allCompanies, inverse: true, axisLabel: { fontSize: 10 } },
      series: [
        { name: 'NEV積分', type: 'bar', data: nevData,
          itemStyle: { color: DC_COLORS.nev } },
        { name: '燃費積分', type: 'bar', data: fuelData,
          itemStyle: { color: DC_COLORS.fuel } }
      ]
    }, true);
  }

  // 一汽
  var ch2 = dcEc('ec-dc-central-yiqi');
  if (ch2) {
    var series = DC.central_companies['一汽'].map(function(c){
      return { name: c, type: 'line', data: DC.central_data[c].fuel, smooth: true,
        lineStyle: { width: 2 } };
    });
    ch2.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 60, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.group_years },
      yAxis: { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end' },
      series: series
    }, true);
  }

  // 長安
  var ch3 = dcEc('ec-dc-central-changan');
  if (ch3) {
    var series = DC.central_companies['長安'].map(function(c){
      return { name: c, type: 'line', data: DC.central_data[c].fuel, smooth: true,
        lineStyle: { width: 2 } };
    });
    ch3.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type: 'scroll' },
      grid: { left: 60, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.group_years },
      yAxis: { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end' },
      series: series
    }, true);
  }

  // 東風
  var ch4 = dcEc('ec-dc-central-dongfeng');
  if (ch4) {
    var series = DC.central_companies['東風'].map(function(c){
      return { name: c, type: 'line', data: DC.central_data[c].fuel, smooth: true,
        lineStyle: { width: 2 } };
    });
    ch4.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type: 'scroll' },
      grid: { left: 60, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.group_years },
      yAxis: { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end' },
      series: series
    }, true);
  }
}

// === (7) 地方国有詳細 ===
function dcDrawLocal() {
  var ch = dcEc('ec-dc-local-2025');
  if (ch) {
    var allCompanies = [];
    var nevData = [], fuelData = [];
    Object.keys(DC.local_companies).forEach(function(grp){
      DC.local_companies[grp].forEach(function(c){
        allCompanies.push(grp+':'+c);
        var d = DC.local_data[c];
        nevData.push(d ? (d.nev[4]||0) : 0);
        fuelData.push(d ? (d.fuel[4]||0) : 0);
      });
    });
    ch.setOption({
      tooltip: { trigger:'axis', axisPointer:{type:'shadow'} },
      legend: { top: 30, type:'scroll' },
      grid: { left: 130, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end' },
      yAxis: { type: 'category', data: allCompanies, inverse: true, axisLabel: { fontSize: 10 } },
      series: [
        { name: 'NEV積分', type: 'bar', data: nevData,
          itemStyle: { color: DC_COLORS.nev } },
        { name: '燃費積分', type: 'bar', data: fuelData,
          itemStyle: { color: DC_COLORS.fuel } }
      ]
    }, true);
  }

  ['saic','gac','chery','baic'].forEach(function(key, idx){
    var grp = ['上汽','広汽','奇瑞','北汽'][idx];
    var ch = dcEc('ec-dc-local-'+key);
    if (!ch) return;
    var series = DC.local_companies[grp].map(function(c){
      return { name: c, type: 'line', data: DC.local_data[c].fuel, smooth: true,
        lineStyle: { width: 2 } };
    });
    ch.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 60, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.group_years },
      yAxis: { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end' },
      series: series
    }, true);
  });
}

// === (8) 新興EV ===
function dcDrawNewForces() {
  var ch = dcEc('ec-dc-newforces-sales');
  if (ch) {
    var series = DC.nf_companies.map(function(c){
      return { name: c, type: 'line', data: DC.nf_data[c].qty, smooth: true,
        lineStyle: { width: 2.5 },
        label: { show: true, position: 'top', fontSize: 10 } };
    });
    ch.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 60, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.nf_years },
      yAxis: { type: 'value', name: '万台', nameGap: 18, nameLocation: 'end' },
      series: series
    }, true);
  }

  var ch2 = dcEc('ec-dc-newforces-nev');
  if (ch2) {
    var series = DC.nf_companies.map(function(c){
      return { name: c, type: 'line', data: DC.nf_data[c].nev, smooth: true,
        lineStyle: { width: 2 } };
    });
    ch2.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 60, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.nf_years },
      yAxis: { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end' },
      series: series
    }, true);
  }

  var ch3 = dcEc('ec-dc-newforces-fuel');
  if (ch3) {
    var series = DC.nf_companies.map(function(c){
      return { name: c, type: 'line', data: DC.nf_data[c].fuel, smooth: true,
        lineStyle: { width: 2 } };
    });
    ch3.setOption({
      tooltip: { trigger:'axis' },
      legend: { top: 30, type:'scroll' },
      grid: { left: 60, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.nf_years },
      yAxis: { type: 'value', name: '万点', nameGap: 18, nameLocation: 'end' },
      series: series
    }, true);
  }
}

// === (9) 輸入車 ===
function dcDrawImport() {
  var ch = dcEc('ec-dc-import-trend');
  if (ch) {
    var series = DC.import_brands.map(function(b){
      return { name: b.name, type: 'line', data: b.data, smooth: true,
        lineStyle: { width: 2 } };
    });
    ch.setOption({
      tooltip: { trigger:'axis', valueFormatter: function(v){ return v==null?'-':v.toLocaleString()+'台'; } },
      legend: { top: 30, type:'scroll' },
      grid: { left: 80, right: 30, top: 100, bottom: 40 },
      xAxis: { type: 'category', data: DC.import_years },
      yAxis: { type: 'value', name: '台', nameGap: 18, nameLocation: 'end', axisLabel: { formatter: function(v){ return (v/10000).toFixed(0)+'万'; } } },
      series: series
    }, true);
  }

  // 2020 vs 2025 変化率
  var ch2 = dcEc('ec-dc-import-change');
  if (ch2) {
    var changes = DC.import_brands.map(function(b){
      var d2020 = b.data[0], d2025 = b.data[5];
      if (!d2020 || d2020 === 0 || d2025 == null) return { name: b.name, value: null };
      var pct = ((d2025 - d2020) / d2020) * 100;
      return { name: b.name, value: pct };
    }).filter(function(d){ return d.value != null; })
      .sort(function(a,b){ return b.value - a.value; });
    ch2.setOption({
      tooltip: { trigger:'axis', valueFormatter: function(v){ return v==null?'-':v.toFixed(1)+'%'; } },
      grid: { left: 120, right: 40, top: 110, bottom: 40 },
      xAxis: { type: 'value', name: '%', nameGap: 18, nameLocation: 'end', axisLabel: { formatter: '{value}%' } },
      yAxis: { type: 'category', data: changes.map(function(c){ return c.name; }), inverse: true,
        axisLabel: { fontSize: 10 } },
      series: [{
        type: 'bar',
        data: changes.map(function(c){ return c.value; }),
        itemStyle: {
          color: function(p){ return p.value >= 0 ? '#38a169' : '#e53e3e'; }
        },
        label: { show: true, position: 'right', formatter: function(p){ return p.value.toFixed(0)+'%'; }, fontSize: 10 }
      }]
    }, true);
  }

  // 2025年ランキング
  var ch3 = dcEc('ec-dc-import-rank');
  if (ch3) {
    var ranked = DC.import_brands.map(function(b){
      return { name: b.name, value: b.data[5]||0 };
    }).filter(function(d){ return d.value > 0; })
      .sort(function(a,b){ return b.value - a.value; });
    ch3.setOption({
      tooltip: { trigger:'axis', valueFormatter: function(v){ return v.toLocaleString()+'台'; } },
      grid: { left: 120, right: 60, top: 110, bottom: 40 },
      xAxis: { type: 'value', name: '台', nameGap: 18, nameLocation: 'end', axisLabel: { formatter: function(v){ return (v/10000).toFixed(1)+'万'; } } },
      yAxis: { type: 'category', data: ranked.map(function(c){ return c.name; }), inverse: true,
        axisLabel: { fontSize: 10 } },
      series: [{
        type: 'bar',
        data: ranked.map(function(c){ return c.value; }),
        itemStyle: { color: '#2b6cb0' },
        label: { show: true, position: 'right', formatter: function(p){ return p.value.toLocaleString(); }, fontSize: 10 }
      }]
    }, true);
  }
}

// グローバル公開
window.dcDrawOverview     = dcDrawOverview;
window.dcDrawCompliance   = dcDrawCompliance;
window.dcDrawNevCredits   = dcDrawNevCredits;
window.dcDrawFuelCredits  = dcDrawFuelCredits;
window.dcDrawGroup        = dcDrawGroup;
window.dcDrawCentral      = dcDrawCentral;
window.dcDrawLocal        = dcDrawLocal;
window.dcDrawNewForces    = dcDrawNewForces;
window.dcDrawImport       = dcDrawImport;

})();
// ========== ダブルクレジット タブ END ==========

// ========== CPCA 中国地域別マップ ==========
(function() {

const CPCA = {
  regionVolume: {
    regions: ['東北','東部-华北','東部-华東','東部-华南','西北','西南','中部-黄河','中部-長江'],
    years:   ['2017','2019','2023','2024','2025','26年1-9月'],
    data: {
      '東北':     [143,109,122,134,138,81],
      '東部-华北': [423,361,370,420,406,233],
      '東部-华東': [419,385,424,440,422,260],
      '東部-华南': [325,317,314,332,336,188],
      '西北':     [192,168,187,201,201,119],
      '西南':     [355,322,294,315,317,184],
      '中部-黄河': [225,191,183,193,205,105],
      '中部-長江': [325,286,275,302,302,169],
    }
  },
  regionShare: {
    regions: ['東北','東部-华北','東部-华東','東部-华南','西北','西南','中部-黄河','中部-長江'],
    years:   ['2017','2019','2023','2024','2025','26年1-9月','26年9月'],
    data: {
      '東北':     [5.9,5.1,5.6,5.7,5.9,6,6],
      '東部-华北': [17.6,16.9,17.1,18.0,17.4,17.4,17.3],
      '東部-华東': [17.4,18.0,19.6,18.8,18.1,19.4,20.6],
      '東部-华南': [13.5,14.8,14.5,14.2,14.4,14.1,14],
      '西北':     [8.0,7.9,8.6,8.6,8.7,8.9,8.8],
      '西南':     [14.7,15.0,13.6,13.5,13.6,13.7,13.3],
      '中部-黄河': [9.3,8.9,8.4,8.3,8.8,7.8,7.7],
      '中部-長江': [13.5,13.4,12.7,12.9,13.0,12.6,12.2],
    }
  },
  regionGrowth: {
    regions: ['東北','東部-华北','東部-华東','東部-华南','西北','西南','中部-黄河','中部-長江'],
    months:  ['25年7月','25年8月','25年9月','25年10月','25年11月','25年12月','25年汇总','26年9月','26年1-9月'],
    data: {
      '東北':     [-2,9,2,-23,-31,-23,3,-32,-24],
      '東部-华北': [5,-5,1,-22,-23,-22,-3,-29,-21],
      '東部-华東': [-6,-5,7,-14,-13,-14,-4,-21,-14],
      '東部-华南': [-5,3,4,-2,-7,-2,1,-26,-19],
      '西北':     [2,2,-3,-22,-16,-22,0,-12,-19],
      '西南':     [5,9,6,-16,-11,-16,0,-28,-20],
      '中部-黄河': [7,3,21,-23,-24,-23,6,-41,-30],
      '中部-長江': [10,0,-4,-18,-11,-18,0,-24,-23],
    }
  },
  // 省別データ（日本語名キー）
  // y24=2024年汇総, y25=2025年汇総, yoy=25/24前年比（以上は3月記事の値）,
  // m6/m7/m8=2026年6月/7月/8月, t26=2026年1-8月累計,
  // mom26_8=8月環比, yoy26_8=8月同比, cum26=1-8月累計前年同期比, rank8=8月販売の位置(%)（以上は8月記事）
  prov: {
    '広東': {y24:253.4,y25:245.5,yoy:-3, m6:19.9,m7:15.6,m8:16.5,t26:128.4, mom26_8:6,yoy26_8:-20,cum26:-16,rank8:31},
    '山東': {y24:186.6,y25:180.6,yoy:-3, m6:12.9,m7:11.6,m8:12.3,t26:91, mom26_8:7,yoy26_8:-25,cum26:-22,rank8:32},
    '浙江': {y24:184.6,y25:180.0,yoy:-2, m6:14.7,m7:12.1,m8:13.1,t26:96.9, mom26_8:8,yoy26_8:-20,cum26:-13,rank8:40},
    '江蘇': {y24:193.7,y25:169.4,yoy:-13, m6:13.4,m7:12,m8:12.9,t26:94.5, mom26_8:7,yoy26_8:-13,cum26:-15,rank8:42},
    '河南': {y24:138.9,y25:144.3,yoy:4, m6:8.9,m7:8.3,m8:9.2,t26:67.5, mom26_8:10,yoy26_8:-25,cum26:-26,rank8:18},
    '河北': {y24:126.5,y25:119.8,yoy:-5, m6:8.3,m7:7.8,m8:8.3,t26:60.2, mom26_8:6,yoy26_8:-23,cum26:-21,rank8:35},
    '四川': {y24:116.8,y25:114.1,yoy:-2, m6:8.4,m7:6.9,m8:7.8,t26:60.4, mom26_8:13,yoy26_8:-21,cum26:-18,rank8:22},
    '安徽': {y24:89.7,y25:88.0,yoy:-2, m6:6.2,m7:5.4,m8:5.9,t26:43.9, mom26_8:8,yoy26_8:-15,cum26:-22,rank8:18},
    '湖北': {y24:81,y25:82.4,yoy:2, m6:5.5,m7:5.1,m8:5,t26:40.2, mom26_8:-1,yoy26_8:-37,cum26:-24,rank8:15},
    '湖南': {y24:75.9,y25:73.3,yoy:-3, m6:5,m7:4.7,m8:4.6,t26:37.6, mom26_8:-2,yoy26_8:-6,cum26:-22,rank8:9},
    '陝西': {y24:67.6,y25:64.6,yoy:-4, m6:4.3,m7:4.2,m8:4.4,t26:32.1, mom26_8:3,yoy26_8:-16,cum26:-23,rank8:29},
    '遼寧': {y24:63.6,y25:62.9,yoy:-1, m6:4.9,m7:4.3,m8:4.9,t26:33.1, mom26_8:15,yoy26_8:-21,cum26:-22,rank8:48},
    '北京': {y24:65,y25:60.3,yoy:-7, m6:6.6,m7:4.8,m8:4.4,t26:33.9, mom26_8:-9,yoy26_8:-17,cum26:-13,rank8:45},
    '福建': {y24:59.3,y25:59.7,yoy:1, m6:4,m7:3.6,m8:3.6,t26:28.8, mom26_8:0,yoy26_8:-33,cum26:-22,rank8:27},
    '山西': {y24:54.2,y25:58.3,yoy:8, m6:3.4,m7:3.1,m8:3.4,t26:24.8, mom26_8:9,yoy26_8:-37,cum26:-32,rank8:21},
    '上海': {y24:61.6,y25:57.4,yoy:-7, m6:5.8,m7:4.5,m8:4.3,t26:34.6, mom26_8:-4,yoy26_8:-20,cum26:-4,rank8:37},
    '江西': {y24:55.2,y25:53.4,yoy:-3, m6:4,m7:3.1,m8:3.1,t26:27.1, mom26_8:-1,yoy26_8:-37,cum26:-23,rank8:4},
    '雲南': {y24:55.3,y25:51.9,yoy:-6, m6:3.5,m7:3.4,m8:3.4,t26:27.3, mom26_8:0,yoy26_8:-28,cum26:-20,rank8:21},
    '広西': {y24:51.4,y25:49.7,yoy:-3, m6:3.5,m7:3.3,m8:3.5,t26:25.1, mom26_8:6,yoy26_8:-22,cum26:-17,rank8:38},
    '貴州': {y24:47.7,y25:49.1,yoy:3, m6:2.8,m7:2.7,m8:2.9,t26:23.4, mom26_8:7,yoy26_8:-21,cum26:-22,rank8:16},
    '重慶': {y24:44.3,y25:46.7,yoy:5, m6:3.8,m7:3.2,m8:3.1,t26:25.5, mom26_8:-2,yoy26_8:-21,cum26:-15,rank8:18},
    '新疆': {y24:42,y25:42.0,yoy:0, m6:3.3,m7:2.9,m8:3,t26:23.1, mom26_8:4,yoy26_8:-18,cum26:-14,rank8:47},
    '内蒙古': {y24:39.7,y25:41.5,yoy:5, m6:3.5,m7:2.9,m8:3.2,t26:23.1, mom26_8:10,yoy26_8:-10,cum26:-19,rank8:54},
    '黒龍江': {y24:35.1,y25:39.4,yoy:12, m6:2.8,m7:2.5,m8:2.7,t26:19.6, mom26_8:8,yoy26_8:-41,cum26:-27,rank8:37},
    '天津': {y24:42,y25:36.3,yoy:-14, m6:2.8,m7:2.4,m8:2.4,t26:19.5, mom26_8:0,yoy26_8:-22,cum26:-20,rank8:25},
    '吉林': {y24:35.3,y25:32.5,yoy:-8, m6:2.7,m7:2.7,m8:2.4,t26:18.1, mom26_8:-11,yoy26_8:-13,cum26:-18,rank8:45},
    '甘粛': {y24:26.8,y25:26.3,yoy:-2, m6:1.7,m7:1.6,m8:1.7,t26:13.7, mom26_8:8,yoy26_8:-21,cum26:-19,rank8:12},
    '海南': {y24:18.8,y25:18.0,yoy:-4, m6:1.1,m7:1,m8:0.9,t26:8.1, mom26_8:-13,yoy26_8:-31,cum26:-28,rank8:12},
    '寧夏': {y24:12.4,y25:13.8,yoy:11, m6:0.9,m7:0.8,m8:0.9,t26:6.7, mom26_8:10,yoy26_8:-26,cum26:-26,rank8:35},
    '青海': {y24:8.1,y25:7.3,yoy:-10, m6:0.5,m7:0.5,m8:0.5,t26:4.1, mom26_8:-6,yoy26_8:-25,cum26:-15,rank8:34},
    '西蔵': {y24:4.2,y25:3.3,yoy:-21, m6:0.3,m7:0.2,m8:0.2,t26:2.1, mom26_8:-2,yoy26_8:-25,cum26:-14,rank8:10},
  },
    nev: {
    // 出典：CPCA「2026年9月乗用車区域市場流向分析」4章（9月単月。表の見出しは「8月」だが本文・数値は9月）
    // ice=常規%, hev=混合動力%, phev=插混%, bev=純電動%, nev=新能源浸透率%（=插混+純電動）
    // d*=較去年同期変化(pp)
    '海南':  {ice:16.6,hev:4.3, phev:11.1,bev:68,nev:79.1, dice:-10.4, dhev:0.7, dphev:-4, dbev:13.8, dnev:9.7},
    '上海':  {ice:22.3,hev:3.6, phev:10.3,bev:63.9,nev:74.2, dice:-12.6, dhev:0.8, dphev:-1.2, dbev:13, dnev:11.8},
    '寧夏':  {ice:22,hev:4.1, phev:38.9,bev:35,nev:73.9, dice:-16.4, dhev:1.5, dphev:1.8, dbev:13.1, dnev:14.9},
    '広西':  {ice:23.9,hev:4.1, phev:15.2,bev:56.8,nev:72, dice:-6.4, dhev:1.6, dphev:-1.6, dbev:6.4, dnev:4.8},
    '北京':  {ice:23.3,hev:6, phev:18.9,bev:51.8,nev:70.7, dice:-11.1, dhev:0.8, dphev:-2.2, dbev:12.6, dnev:10.3},
    '河南':  {ice:25.8,hev:4.2, phev:17,bev:53,nev:70, dice:-8.1, dhev:1.7, dphev:-0.5, dbev:6.9, dnev:6.4},
    '陝西':  {ice:26.5,hev:3.7, phev:27.2,bev:42.5,nev:69.7, dice:-13.1, dhev:1.3, dphev:-2.9, dbev:14.7, dnev:11.8},
    '重慶':  {ice:24.3,hev:6, phev:22.4,bev:47.2,nev:69.6, dice:-10.2, dhev:4.1, dphev:-0.8, dbev:6.9, dnev:6.1},
    '安徽':  {ice:27.7,hev:3, phev:15.9,bev:53.3,nev:69.2, dice:-12.1, dhev:0.9, dphev:-0.4, dbev:11.6, dnev:11.2},
    '天津':  {ice:23.3,hev:7.8, phev:28.8,bev:40.2,nev:69, dice:-7.9, dhev:3.2, dphev:-4.2, dbev:8.8, dnev:4.7},
    '湖北':  {ice:26.9,hev:5.5, phev:17.4,bev:50.3,nev:67.7, dice:-8.7, dhev:2.8, dphev:-2.1, dbev:8, dnev:5.9},
    '山東':  {ice:27.6,hev:5.6, phev:16,bev:50.8,nev:66.8, dice:-8.7, dhev:1.8, dphev:0.6, dbev:6.3, dnev:6.9},
    '山西':  {ice:28,hev:5.3, phev:19.8,bev:46.9,nev:66.7, dice:-13.4, dhev:2.2, dphev:0.8, dbev:10.4, dnev:11.2},
    '浙江':  {ice:27.7,hev:5.8, phev:16.7,bev:49.8,nev:66.5, dice:-6.4, dhev:2.3, dphev:-0.9, dbev:5, dnev:4.1},
    '江蘇':  {ice:29.9,hev:4.4, phev:13.3,bev:52.4,nev:65.7, dice:-9.4, dhev:0.8, dphev:-0.8, dbev:9.4, dnev:8.7},
    '福建':  {ice:30.5,hev:3.9, phev:16.4,bev:49.1,nev:65.5, dice:-6.2, dhev:0.4, dphev:-5.3, dbev:11.2, dnev:5.9},
    '新疆':  {ice:26.3,hev:8.2, phev:41.1,bev:24.4,nev:65.5, dice:-16.6, dhev:2.2, dphev:5.6, dbev:8.8, dnev:14.4},
    '四川':  {ice:31.3,hev:4.3, phev:18.6,bev:45.8,nev:64.4, dice:-12.3, dhev:1.9, dphev:-1.3, dbev:11.7, dnev:10.4},
    '貴州':  {ice:32.9,hev:3.1, phev:17.4,bev:46.6,nev:64, dice:-8.4, dhev:1.4, dphev:-2.2, dbev:9.2, dnev:7},
    '広東':  {ice:27,hev:9, phev:22.7,bev:41.3,nev:64, dice:-9.2, dhev:2.4, dphev:-0.6, dbev:7.4, dnev:6.8},
    '河北':  {ice:33.1,hev:5.2, phev:21.9,bev:39.9,nev:61.8, dice:-10.2, dhev:1.6, dphev:-0.1, dbev:8.7, dnev:8.5},
    '江西':  {ice:33.4,hev:5, phev:12.8,bev:48.8,nev:61.6, dice:-8.5, dhev:2.1, dphev:-4.5, dbev:11, dnev:6.5},
    '青海':  {ice:33.6,hev:4.9, phev:24,bev:37.5,nev:61.5, dice:-18.1, dhev:1.6, dphev:3, dbev:13.6, dnev:16.5},
    '甘粛':  {ice:34.4,hev:5.4, phev:29.1,bev:31.1,nev:60.2, dice:-16.8, dhev:2.8, dphev:2.5, dbev:11.5, dnev:14},
    '遼寧':  {ice:30.4,hev:10.1, phev:26.9,bev:32.6,nev:59.5, dice:-14.2, dhev:2.9, dphev:0.5, dbev:10.7, dnev:11.2},
    '湖南':  {ice:35.4,hev:6, phev:15.2,bev:43.4,nev:58.6, dice:-11.3, dhev:2.1, dphev:-1.6, dbev:10.8, dnev:9.2},
    '吉林':  {ice:37,hev:7.4, phev:27.5,bev:28.2,nev:55.7, dice:-10.9, dhev:3.4, dphev:-2.2, dbev:9.8, dnev:7.5},
    '黒龍江':  {ice:36.9,hev:9.1, phev:33.8,bev:20.2,nev:54, dice:-11.3, dhev:3.5, dphev:1.8, dbev:6, dnev:7.8},
    '内蒙古':  {ice:39.4,hev:6.9, phev:27.9,bev:25.8,nev:53.7, dice:-3, dhev:1.9, dphev:-4.7, dbev:5.8, dnev:1.1},
    '雲南':  {ice:40.6,hev:6.3, phev:12.2,bev:40.9,nev:53.1, dice:-9.5, dhev:3.8, dphev:0.5, dbev:5.2, dnev:5.8},
    '西蔵':  {ice:57.9,hev:4.7, phev:25.3,bev:12.1,nev:37.4, dice:-8.4, dhev:1.5, dphev:-0.9, dbev:7.7, dnev:6.9},
  },
    body: {
    // 出典：CPCA「2026年9月乗用車区域市場流向分析」3章
    // CAR/MPV/SUV = 2026年9月構成比(%) / dCAR/dMPV/dSUV = 前年増減(pp)
    '河南':  {CAR:52.4,MPV:4.1, SUV:43.5, dCAR:-0.7, dMPV:-0.4,dSUV:1.1},
    '広西':  {CAR:50.8,MPV:3.2, SUV:46, dCAR:-3, dMPV:0.3,dSUV:2.7},
    '安徽':  {CAR:48,MPV:3.2, SUV:48.8, dCAR:2.6, dMPV:-0.7,dSUV:-1.9},
    '江西':  {CAR:46.7,MPV:2.8, SUV:50.4, dCAR:-1.6, dMPV:-1,dSUV:2.7},
    '貴州':  {CAR:46.4,MPV:2.9, SUV:50.7, dCAR:2.9, dMPV:-0.1,dSUV:-2.8},
    '山東':  {CAR:43.8,MPV:5.2, SUV:51, dCAR:-3.2, dMPV:-0.5,dSUV:3.7},
    '河北':  {CAR:43.4,MPV:4.9, SUV:51.7, dCAR:-5.6, dMPV:-0.7,dSUV:6.3},
    '江蘇':  {CAR:42.3,MPV:4, SUV:53.7, dCAR:-1.8, dMPV:-0.8,dSUV:2.6},
    '雲南':  {CAR:41.6,MPV:4.5, SUV:53.9, dCAR:-1.7, dMPV:-0.7,dSUV:2.3},
    '湖南':  {CAR:41.7,MPV:2.8, SUV:55.4, dCAR:-4.4, dMPV:-0.6,dSUV:5},
    '天津':  {CAR:37.9,MPV:5.7, SUV:56.4, dCAR:-3.4, dMPV:-1.8,dSUV:5.2},
    '山西':  {CAR:37.1,MPV:5.6, SUV:57.3, dCAR:-4.9, dMPV:0.6,dSUV:4.2},
    '広東':  {CAR:37.3,MPV:4.7, SUV:58, dCAR:-6.2, dMPV:0.4,dSUV:5.8},
    '吉林':  {CAR:36.2,MPV:5.6, SUV:58.3, dCAR:-12.2, dMPV:0.6,dSUV:11.6},
    '浙江':  {CAR:38,MPV:3.7, SUV:58.3, dCAR:-3.2, dMPV:-0.8,dSUV:4},
    '四川':  {CAR:38.7,MPV:2.8, SUV:58.5, dCAR:-1, dMPV:-0.2,dSUV:1.2},
    '福建':  {CAR:38,MPV:3.2, SUV:58.8, dCAR:-5, dMPV:0.1,dSUV:4.9},
    '重慶':  {CAR:38.8,MPV:2.1, SUV:59.2, dCAR:1, dMPV:-0.5,dSUV:-0.4},
    '湖北':  {CAR:36.7,MPV:3.9, SUV:59.4, dCAR:-5.7, dMPV:0.2,dSUV:5.5},
    '上海':  {CAR:34,MPV:6, SUV:60.1, dCAR:-5.1, dMPV:0,dSUV:5.1},
    '北京':  {CAR:32,MPV:7.2, SUV:60.8, dCAR:-6.5, dMPV:-1.1,dSUV:7.6},
    '陝西':  {CAR:34.6,MPV:4.4, SUV:61.1, dCAR:-2, dMPV:-0.5,dSUV:2.5},
    '遼寧':  {CAR:32.2,MPV:6.4, SUV:61.4, dCAR:-5.4, dMPV:0,dSUV:5.3},
    '黒龍江':  {CAR:30.9,MPV:6.2, SUV:62.9, dCAR:-11, dMPV:0.7,dSUV:10.3},
    '海南':  {CAR:32.4,MPV:3.9, SUV:63.7, dCAR:1.4, dMPV:-0.3,dSUV:-1.1},
    '甘粛':  {CAR:31.1,MPV:2.7, SUV:66.2, dCAR:-1.3, dMPV:-0.3,dSUV:1.6},
    '新疆':  {CAR:28.3,MPV:3.1, SUV:68.6, dCAR:-0.7, dMPV:-0.1,dSUV:0.8},
    '青海':  {CAR:28.5,MPV:2.6, SUV:68.9, dCAR:0.7, dMPV:-0.6,dSUV:-0.1},
    '寧夏':  {CAR:27.7,MPV:3, SUV:69.3, dCAR:-3.4, dMPV:-0.1,dSUV:3.5},
    '内蒙古':  {CAR:25.6,MPV:4.1, SUV:70.4, dCAR:-4.6, dMPV:-1.9,dSUV:6.5},
    '西蔵':  {CAR:19.9,MPV:2.2, SUV:77.9, dCAR:1.6, dMPV:-0.3,dSUV:-1.3},
  },
    brand: {
    // 出典：CPCA「2026年9月乗用車区域市場流向分析」6章
    // lux=豪華%, jv=合資%, dom=中国系%（2026年9月）/ dlux/djv/ddom = 較25年変化(pp)
    '上海':  {lux:23.6,jv:13.2,dom:63.1, dlux:-2.4,djv:-4.8, ddom:7.2},
    '北京':  {lux:18.2,jv:15.1,dom:66.7, dlux:-1,djv:-5.9, ddom:7},
    '青海':  {lux:10.8,jv:17.6,dom:71.6, dlux:-0.8,djv:-6.1, ddom:6.9},
    '湖南':  {lux:11.5,jv:20.7,dom:67.8, dlux:-1.5,djv:-5.3, ddom:6.8},
    '浙江':  {lux:15.4,jv:13.9,dom:70.7, dlux:-2.7,djv:-3.4, ddom:6.1},
    '海南':  {lux:9.1,jv:14.4,dom:76.5, dlux:0.3,djv:-6.4, ddom:6.1},
    '安徽':  {lux:10.6,jv:13.8,dom:75.6, dlux:-1.9,djv:-4, ddom:5.9},
    '遼寧':  {lux:10.5,jv:24.6,dom:64.8, dlux:0.1,djv:-5.9, ddom:5.8},
    '陝西':  {lux:9.6,jv:13.3,dom:77.1, dlux:-1.1,djv:-4.5, ddom:5.7},
    '福建':  {lux:13,jv:16.7,dom:70.3, dlux:-0.8,djv:-4.5, ddom:5.3},
    '寧夏':  {lux:6.9,jv:11.9,dom:81.2, dlux:-0.9,djv:-4.4, ddom:5.2},
    '江西':  {lux:10.4,jv:18.4,dom:71.1, dlux:-2.1,djv:-3, ddom:5},
    '江蘇':  {lux:19.4,jv:16.7,dom:63.9, dlux:-1.3,djv:-3.4, ddom:4.7},
    '広東':  {lux:11.7,jv:21,dom:67.3, dlux:-1.1,djv:-3.4, ddom:4.5},
    '甘粛':  {lux:6.5,jv:17.6,dom:76, dlux:-0.7,djv:-3.7, ddom:4.5},
    '四川':  {lux:13.2,jv:16.3,dom:70.5, dlux:-1.4,djv:-2.9, ddom:4.3},
    '黒龍江':  {lux:6.8,jv:25.8,dom:67.4, dlux:0.3,djv:-4.4, ddom:4.1},
    '広西':  {lux:5.4,jv:15.7,dom:78.9, dlux:-0.5,djv:-2.6, ddom:3.2},
    '山西':  {lux:5.8,jv:20.1,dom:74.1, dlux:1,djv:-4.2, ddom:3.1},
    '河北':  {lux:9.6,jv:21.1,dom:69.3, dlux:0.2,djv:-3.3, ddom:3.1},
    '湖北':  {lux:10.8,jv:18.4,dom:70.9, dlux:-0.1,djv:-2, ddom:2},
    '貴州':  {lux:6.8,jv:17.8,dom:75.3, dlux:-0.2,djv:-1.6, ddom:1.8},
    '山東':  {lux:10.7,jv:21.7,dom:67.6, dlux:0.3,djv:-1.9, ddom:1.7},
    '河南':  {lux:7.5,jv:17.8,dom:74.7, dlux:0.2,djv:-1.8, ddom:1.6},
    '天津':  {lux:12.5,jv:19.3,dom:68.2, dlux:0.6,djv:-2.2, ddom:1.6},
    '新疆':  {lux:5.8,jv:20.8,dom:73.4, dlux:1.1,djv:-2.6, ddom:1.5},
    '雲南':  {lux:10.2,jv:22.9,dom:66.9, dlux:-0.4,djv:-0.8, ddom:1.2},
    '重慶':  {lux:9.4,jv:13.8,dom:76.7, dlux:-1.6,djv:0.6, ddom:1},
    '内蒙古':  {lux:5.4,jv:24.7,dom:69.9, dlux:-2.9,djv:2.5, ddom:0.4},
    '吉林':  {lux:10.7,jv:27.2,dom:62.1, dlux:-1.3,djv:1.7, ddom:-0.4},
    '西蔵':  {lux:16.7,jv:24.1,dom:59.2, dlux:2.7,djv:-2.1, ddom:-0.6},
  },
    // 日本語 → ECharts簡体字マッピング
  grade: {
    // 出典：CPCA「2026年9月乗用車区域市場流向分析」5章（浙江・重慶は表に無い）
    // a00/A0/A/B/C = 2026年9月構成比(%) / da*/dB/dC = 較上年同期変化(pp) / econ = 経済型車（a00+A0）份額%
    '北京':  {a00:1,A0:9, A:29,B:42,C:19, da00:-0.4, dA0:4.5,dA:-6.9,  dB:-2.7,  dC:5.4, econ:10},
    '広東':  {a00:1,A0:10, A:38,B:38,C:14, da00:-0.9, dA0:2.3,dA:-3.7,  dB:-2.8,  dC:5.1, econ:11},
    '青海':  {a00:1,A0:10, A:48,B:33,C:8, da00:-0.1, dA0:0.4,dA:-3.9,  dB:3.4,  dC:0.1, econ:11},
    '上海':  {a00:0,A0:12, A:24,B:45,C:18, da00:-0.2, dA0:4.7,dA:-6.9,  dB:-1.8,  dC:4.1, econ:12},
    '西蔵':  {a00:3,A0:9, A:47,B:32,C:10, da00:1.8, dA0:2.1,dA:-6.8,  dB:2.2,  dC:0.7, econ:12},
    '吉林':  {a00:5,A0:7, A:45,B:32,C:12, da00:-1.3, dA0:1.7,dA:-7.8,  dB:4.6,  dC:2.8, econ:12},
    '黒龍江':  {a00:4,A0:8, A:49,B:28,C:12, da00:-1.3, dA0:2.7,dA:-7.7,  dB:2.4,  dC:3.9, econ:12},
    '寧夏':  {a00:2,A0:11, A:43,B:36,C:8, da00:-1.4, dA0:2.9,dA:-6.3,  dB:2.6,  dC:2.1, econ:13},
    '内蒙古':  {a00:3,A0:11, A:51,B:27,C:8, da00:-1.3, dA0:3.3,dA:0.1,  dB:-2.4,  dC:0.3, econ:14},
    '陝西':  {a00:3,A0:12, A:36,B:39,C:10, da00:-1.7, dA0:3.5,dA:-7.8,  dB:3.9,  dC:2.2, econ:15},
    '遼寧':  {a00:3,A0:12, A:44,B:29,C:12, da00:-2.1, dA0:5.8,dA:-8.6,  dB:-0.1,  dC:5, econ:15},
    '四川':  {a00:2,A0:14, A:39,B:34,C:11, da00:-1, dA0:4.9,dA:-2.9,  dB:-3.2,  dC:2.3, econ:16},
    '新疆':  {a00:2,A0:14, A:46,B:33,C:6, da00:-0.3, dA0:4.2,dA:-13.2,  dB:7.7,  dC:1.6, econ:16},
    '海南':  {a00:1,A0:16, A:39,B:34,C:10, da00:-1.3, dA0:2.3,dA:-2.1,  dB:-3.4,  dC:4.6, econ:17},
    '甘粛':  {a00:4,A0:13, A:49,B:28,C:6, da00:-1.9, dA0:4.3,dA:-4.7,  dB:0.9,  dC:1.4, econ:17},
    '江蘇':  {a00:2,A0:16, A:30,B:39,C:13, da00:-2.1, dA0:4,dA:-4,  dB:-1.6,  dC:3.7, econ:18},
    '福建':  {a00:2,A0:16, A:39,B:33,C:11, da00:-1.4, dA0:5,dA:-8.7,  dB:1,  dC:4.1, econ:18},
    '湖北':  {a00:3,A0:15, A:39,B:31,C:11, da00:-6, dA0:4.9,dA:-1.4,  dB:-1.1,  dC:3.6, econ:18},
    '湖南':  {a00:2,A0:17, A:41,B:31,C:9, da00:-2.2, dA0:7.9,dA:-4.1,  dB:-3.9,  dC:2.2, econ:19},
    '天津':  {a00:3,A0:17, A:39,B:30,C:11, da00:-2.1, dA0:7.1,dA:-3.2,  dB:-4.7,  dC:3, econ:20},
    '貴州':  {a00:3,A0:17, A:42,B:31,C:8, da00:-2.4, dA0:5,dA:-2.9,  dB:-2.3,  dC:2.6, econ:20},
    '江西':  {a00:3,A0:19, A:40,B:30,C:9, da00:-2.4, dA0:5.5,dA:-1.5,  dB:-3.5,  dC:1.9, econ:22},
    '雲南':  {a00:4,A0:18, A:42,B:29,C:8, da00:-4.8, dA0:3.4,dA:-3.3,  dB:2.3,  dC:2.4, econ:22},
    '安徽':  {a00:3,A0:23, A:35,B:31,C:9, da00:-3.2, dA0:6.8,dA:-2.7,  dB:-2.5,  dC:1.6, econ:26},
    '河北':  {a00:7,A0:19, A:38,B:27,C:9, da00:-5.8, dA0:6.8,dA:-3.4,  dB:0,  dC:2.4, econ:26},
    '山東':  {a00:7,A0:22, A:32,B:29,C:10, da00:-7.8, dA0:5.9,dA:-3.3,  dB:1.9,  dC:3.3, econ:29},
    '山西':  {a00:7,A0:22, A:37,B:25,C:9, da00:-5.9, dA0:7.1,dA:-9.2,  dB:3.9,  dC:4.1, econ:29},
    '広西':  {a00:5,A0:30, A:32,B:25,C:7, da00:-10.9, dA0:12.7,dA:-4.5,  dB:0,  dC:2.7, econ:35},
    '河南':  {a00:11,A0:25, A:30,B:26,C:8, da00:-7.7, dA0:6.5,dA:-2.2,  dB:1,  dC:2.3, econ:36},
  },
    ja2zh: {
    '広東':'广东','浙江':'浙江','江蘇':'江苏','山東':'山东','河南':'河南',
    '四川':'四川','河北':'河北','湖北':'湖北','安徽':'安徽','湖南':'湖南',
    '上海':'上海','北京':'北京','陝西':'陕西','雲南':'云南','福建':'福建',
    '貴州':'贵州','遼寧':'辽宁','江西':'江西','広西':'广西','重慶':'重庆',
    '新疆':'新疆','天津':'天津','山西':'山西','内蒙古':'内蒙古','黒龍江':'黑龙江',
    '吉林':'吉林','甘粛':'甘肃','海南':'海南','寧夏':'宁夏','青海':'青海','西蔵':'西藏',
  },
  regionOf: {
    '黒龍江':'東北','吉林':'東北','遼寧':'東北',
    '北京':'東部-华北','天津':'東部-华北','河北':'東部-华北','山西':'東部-华北','内蒙古':'東部-华北',
    '上海':'東部-华東','江蘇':'東部-华東','浙江':'東部-华東','安徽':'東部-华東',
    '福建':'東部-华東','江西':'東部-华東','山東':'東部-华東',
    '広東':'東部-华南','広西':'東部-华南','海南':'東部-华南',
    '陝西':'西北','甘粛':'西北','青海':'西北','寧夏':'西北','新疆':'西北',
    '四川':'西南','重慶':'西南','雲南':'西南','貴州':'西南','西蔵':'西南',
    '河南':'中部-黄河','湖北':'中部-長江','湖南':'中部-長江',
  },
  regionColor: {
    '東北':'#5470C6','東部-华北':'#91CC75','東部-华東':'#FAC858','東部-华南':'#EE6666',
    '西北':'#73C0DE','西南':'#3BA272','中部-黄河':'#FC8452','中部-長江':'#9A60B4',
  },
};
// 逆引き
CPCA.zh2ja = Object.fromEntries(Object.entries(CPCA.ja2zh).map(([ja,zh])=>[zh,ja]));

// ---- 指標値取得 ----
var curMetric = 'sales26';

function metricVal(ja) {
  const p = CPCA.prov[ja];
  const n = CPCA.nev[ja];
  const b = CPCA.body[ja];
  const br= CPCA.brand[ja];
  const g = CPCA.grade ? CPCA.grade[ja] : null;
  switch(curMetric) {
    case 'sales26': return p ? p.t26 : null;
    case 'sales25': return p ? p.y25 : null;
    case 'sales24': return p ? p.y24 : null;
    case 'yoy':     return p ? p.yoy : null;
    case 'yoy26':   return p ? p.yoy26_8 : null;
    case 'cum26':   return p ? p.cum26 : null;
    // 4章 新能源
    case 'nev':     return n && n.nev  != null ? n.nev  : null;
    case 'dnev':    return n && n.dnev != null ? n.dnev : null;
    case 'bev':     return n && n.bev  != null ? n.bev  : null;
    case 'phev':    return n && n.phev != null ? n.phev : null;
    case 'hev':     return n && n.hev  != null ? n.hev  : null;
    case 'ice':     return n && n.ice  != null ? n.ice  : null;
    // 3章 車身
    case 'suv':     return b ? b.SUV  : null;
    case 'dsuv':    return b ? b.dSUV : null;
    case 'car':     return b ? b.CAR  : null;
    // 6章 品牌
    case 'dom':     return br ? br.dom  : null;
    case 'ddom':    return br ? br.ddom : null;
    case 'lux':     return br ? br.lux  : null;
    case 'dlux':    return br ? br.dlux : null;
    // 5章 車型級別
    case 'cgrade':  return g ? g.C    : null;
    case 'bgrade':  return g ? g.B    : null;
    case 'econ':    return g ? g.econ : null;
    case 'decon':   return g ? (g.da00 + g.dA0) : null;
  }
  return null;
}

// ---- 地図 ----
var mapChart = null;
var mapReady = false;
var mapInited = false;

window.cpcaInitMap = function() {
  const root = document.getElementById('cpca-map-root');
  if (!root) return;
  if (mapInited && mapChart) { mapChart.resize(); return; }
  mapInited = true;

  // レイアウト構築
  root.innerHTML = `
    <div style="display:flex;height:100%;background:#0d1b2a;font-family:inherit">
      <!-- 左コントロール -->
      <div style="flex:0 0 190px;padding:14px 12px;background:#131f35;overflow-y:auto;color:#d0e4f8;display:flex;flex-direction:column;gap:10px">
        <div style="font-size:11px;font-weight:700;color:#7eb3ff;letter-spacing:.5px">📊 表示指標</div>
        <div id="cpca-btns" style="display:flex;flex-direction:column;gap:4px">
          ${[
            ['sales26','📦 26年1-8月 販売量（万台）'],['sales25','📦 2025年通年 販売量（万台）'],['sales24','📦 2024年通年 販売量（万台）'],
            ['yoy','📈 25年 前年比（対24年）'],['yoy26','📈 26年8月 前年比（単月）'],['cum26','📈 26年1-8月累計 前年比'],
            ['nev','⚡ NEV新車比率（9月）'],['dnev','⚡ NEV新車比率 前年差（pp）'],
            ['dom','🏷️ 中国系ブランド比率'],['econ','📉 経済型車（a00+A0）份額（9月）'],
          ].map(([m,lbl],i)=>`<button onclick="cpcaMetric('${m}',this)" style="font-size:11px;padding:5px 8px;border-radius:5px;cursor:pointer;text-align:left;border:${i===0?'none':'1px solid #2a3f60'};background:${i===0?'#2563eb':'transparent'};color:${i===0?'#fff':'#8ab0d0'}">${lbl}</button>`).join('')}
        </div>
        <div id="cpca-vmap-legend" style="margin-top:4px"></div>
      </div>
      <!-- 中央：地図 -->
      <div style="flex:1;position:relative;overflow:hidden">
        <div id="cpca-map-ec" style="width:100%;height:100%"></div>
      </div>
      <!-- 右：詳細チャート -->
      <div id="cpca-detail-panel" style="flex:0 0 320px;background:#131f35;overflow-y:auto;padding:12px;color:#d0e4f8">
        <div style="color:#3a5070;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px">
          <div style="font-size:36px">🗺️</div>
          <div style="text-align:center;line-height:1.8;font-size:12px">地図の省をクリックすると<br>詳細チャートが表示されます</div>
        </div>
      </div>
    </div>
  `;

  const ecEl = document.getElementById('cpca-map-ec');
  mapChart = echarts.init(ecEl, 'dark');
  mapChart.showLoading({text:'地図データ読み込み中…',color:'#2563eb',textColor:'#8ab0d0',maskColor:'rgba(13,27,42,0.8)'});

  // GeoJSONをインライン埋め込み（外部CDN不要）
  (function() {
    try {
      const geo = CHINA_GEOJSON;
      echarts.registerMap('china_full', geo);
      mapReady = true;
      mapChart.hideLoading();
      renderMapChart();
    } catch(e) {
      ecEl.innerHTML = '<div style="color:#ef5350;padding:30px;text-align:center">地図の初期化に失敗しました: ' + e.message + '</div>';
    }
  })();

  mapChart.on('click', p=>{
    if(p.componentType!=='series') return;
    const ja = CPCA.zh2ja[p.name] || p.name;
    showProvDetail(ja);
  });
  mapChart.on('georoam', updateCustomLabels);
  mapChart.on('rendered', updateCustomLabels);
};

function updateCustomLabels() {
  if (!mapChart || !mapReady) return;
  var ecEl = document.getElementById('cpca-map-ec');
  if (!ecEl) return;
  var customLabels = [
    ['甘肃', '甘粛', 104.39, 35.13],
    ['河北', '河北', 115.14, 38.51],
    ['内蒙古', '内蒙古', 110.26, 41.21],
    ['黑龙江', '黒龍江', 128.76, 46.58],
  ];
  customLabels.forEach(function(item) {
    var zhName = item[0], jaName = item[1], lon = item[2], lat = item[3];
    var divId = 'map-label-' + zhName;
    var div = document.getElementById(divId);
    if (!div) {
      div = document.createElement('div');
      div.id = divId;
      div.style.cssText = 'position:absolute;pointer-events:none;font-size:14px;font-weight:bold;font-family:"Noto Sans SC","Noto Sans JP",sans-serif;color:#fff;text-shadow:-1px -1px 3px rgba(0,0,0,0.9),1px -1px 3px rgba(0,0,0,0.9),-1px 1px 3px rgba(0,0,0,0.9),1px 1px 3px rgba(0,0,0,0.9),0 0 8px rgba(0,0,0,0.95);transform:translate(-50%,-50%);z-index:10;letter-spacing:0;white-space:nowrap;';
      ecEl.parentElement.appendChild(div);
    }
    var pt = mapChart.convertToPixel({seriesIndex:0}, [lon, lat]);
    if (!pt) { div.style.display='none'; return; }
    var ecRect = ecEl.getBoundingClientRect();
    var parentRect = ecEl.parentElement.getBoundingClientRect();
    div.style.left = (ecRect.left - parentRect.left + pt[0]) + 'px';
    div.style.top  = (ecRect.top  - parentRect.top  + pt[1]) + 'px';
    div.style.display = 'block';
    div.textContent = jaName;
  });
}

// 省別ラベルオフセット（[x, y] ピクセル調整）
var LABEL_OFFSETS = {
  '甘肃': [0, -12],
  '河北': [-8, 10],
  '宁夏': [0, 0],
  '北京': [0, 0],
  '天津': [6, 6],
};

function mapDataArr() {
  return Object.keys(CPCA.prov).map(ja=>{
    var zh = CPCA.ja2zh[ja] || ja;
    var off = LABEL_OFFSETS[zh];
    var item = {
      name: zh,
      value: metricVal(ja),
    };
    if (off) {
      item.label = { offset: off };
    }
    return item;
  });
}

function getVisualMap() {
  const vals = Object.keys(CPCA.prov).map(metricVal).filter(v=>v!=null);
  const mn = Math.min(...vals), mx = Math.max(...vals);
  const unit = (curMetric==='sales26'||curMetric==='sales25'||curMetric==='sales24') ? '万台'
              : (curMetric==='dnev'||curMetric==='dsuv'||curMetric==='ddom'||curMetric==='dlux'||curMetric==='decon') ? 'pp'
              : '%';
  return {
    type:'continuous', min:mn, max:mx,
    inRange:{color: (curMetric==='yoy'||curMetric==='yoy26'||curMetric==='cum26'||curMetric==='dnev'||curMetric==='dsuv'||curMetric==='ddom'||curMetric==='dlux'||curMetric==='dgrade')
      ? ['#c0392b','#e8735a','#f5e4cb','#a9dfbf','#1e8449']
      : ['#1a3a5c','#1565c0','#42a5f5','#80deea','#a5d6a7','#ffcc02','#ff6f00','#b71c1c']},
    formatter: v=>v.toFixed(1)+unit,
    textStyle:{color:'#8ab0d0',fontSize:9},
    orient:'vertical', right:8, top:'center',
    calculable:true,
  };
}

function renderMapChart() {
  if(!mapChart||!mapReady) return;
  const titles = {
    sales26:'26年1-8月 販売量（万台）', sales25:'2025年通年 販売量（万台）', sales24:'2024年通年 販売量（万台）',
    yoy:'2025年 前年比（対2024年・%）', yoy26:'26年8月 前年比 単月（%）',
    cum26:'26年1-8月累計 前年比（%）',
    nev:'NEV新車比率 9月単月（%）', dnev:'NEV新車比率 前年差（pp）',
    bev:'純電動(BEV)比率 9月（%）', phev:'插混(PHEV)比率 9月（%）',
    hev:'HEV比率 9月（%）',  ice:'燃油車(ICE)比率 9月（%）',
    suv:'SUV比率 9月単月（%）', dsuv:'SUV比率 前年増減（pp）',
    car:'セダン(CAR)比率 9月（%）',
    dom:'中国系ブランド比率 2026年9月（%）', ddom:'中国系ブランド 前年差（pp）',
    lux:'高級車比率 2026年9月（%）', dlux:'豪華ブランド 前年差（pp）',
    cgrade:'Cクラス比率 9月（%）', bgrade:'Bクラス比率 9月（%）',
    econ:'経済型車（a00+A0）份額 9月（%）',
  };
  mapChart.setOption({
    backgroundColor:'#0d1b2a',
    title:{text:'中国省別乗用車市場',subtext:titles[curMetric],left:'center',top:6,
      textStyle:{color:'#c8dcf0',fontSize:13,fontWeight:700},
      subtextStyle:{color:'#6a8aaa',fontSize:10}},
    tooltip:{
      trigger:'item',
      backgroundColor:'rgba(10,20,40,0.93)',borderColor:'#2a4a7a',
      textStyle:{color:'#d0e4f8',fontSize:11},
      formatter:p=>{
        const ja=CPCA.zh2ja[p.name]||p.name;
        const v=p.value;
        const unit=(curMetric==='sales26'||curMetric==='sales25'||curMetric==='sales24')?'万台'
                   :(curMetric==='dnev'||curMetric==='dsuv'||curMetric==='ddom'||curMetric==='dlux'||curMetric==='decon')?'pp':'%';
        const vs=(v==null||isNaN(v))?'N/A':v.toFixed(1)+unit;
        return `<strong>${ja}</strong><br>${titles[curMetric]}: <strong style="color:#7eb3ff">${vs}</strong>`;
      }
    },
    visualMap: getVisualMap(),
    series:[{
      type:'map', map:'china_full', roam:true, scaleLimit:{min:0.8,max:6},
      data: mapDataArr(),
      selectedMode:false,
      emphasis:{itemStyle:{areaColor:'#f5a623',borderColor:'#fff',borderWidth:2},
        label:{show:true,color:'#fff',fontWeight:'bold',fontSize:14,
          textShadowColor:'rgba(0,0,0,0.95)',textShadowBlur:5}},
      itemStyle:{borderColor:'rgba(255,255,255,0.35)',borderWidth:0.7},
      label:{
        show:true,
        color:'#fff',
        fontSize:14,
        fontWeight:'bold',
        textShadowColor:'rgba(0,0,0,0.95)',
        textShadowBlur:5,
        textBorderColor:'rgba(0,0,0,0.6)',
        textBorderWidth:2,
        formatter:p=>{
          if (p.name === '甘肃' || p.name === '河北' || p.name === '内蒙古' || p.name === '黑龙江') return '';
          const ja = CPCA.zh2ja[p.name] || p.name;
          return ja;
        },
      },
      labelLayout:{
        hideOverlap:true,
        moveOverlap:'shiftY',
        fontSize:13,
      },
    }]
  });
}

window.cpcaMetric = function(m, btn) {
  curMetric = m;
  document.querySelectorAll('#cpca-btns button').forEach(b=>{
    const on = b===btn;
    b.style.background=on?'#2563eb':'transparent';
    b.style.color=on?'#fff':'#8ab0d0';
    b.style.border=on?'none':'1px solid #2a3f60';
  });
  renderMapChart();
};

function showProvDetail(ja) {
  const p  = CPCA.prov[ja];
  const n  = CPCA.nev[ja];
  const b  = CPCA.body[ja];
  const br = CPCA.brand[ja];
  const g  = CPCA.grade ? CPCA.grade[ja] : null;
  const reg= CPCA.regionOf[ja]||'';
  const sign = v => (v == null) ? 'N/A' : (v > 0 ? '+' : '') + v.toFixed(1);

  const panel = document.getElementById('cpca-detail-panel');
  if(!panel) return;

  // 右パネルHTML構築
  const nevH    = (n && n.ice != null) ? 200 : 0;
  const gradeH  = g ? 120 : 0;

  panel.innerHTML =
    '<div style="font-weight:700;font-size:17px;color:#7eb3ff;border-bottom:2px solid #2563eb;padding-bottom:8px;margin-bottom:10px">'
    + ja + ' <span style="font-size:12px;color:#3a5a80;font-weight:400">' + reg + '</span></div>'
    + (p
      ? '<div style="background:#1a2f50;border-radius:7px;padding:10px;margin-bottom:8px;font-size:11px">'
        + '<div style="color:#5a8abc;font-weight:700;margin-bottom:5px">📦 販売量（万台）</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">'
        + '<div>2024年: <strong style="color:#fff">' + p.y24 + '</strong>万台</div>'
        + '<div>2025年: <strong style="color:#7eb3ff">' + p.y25 + '</strong>万台</div>'
        + '<div>25年前年比: <strong style="color:' + (p.yoy < 0 ? '#ef5350' : '#66bb6a') + '">' + (p.yoy > 0 ? '+' : '') + p.yoy + '%</strong></div>'
        + '<div>26年1-8月: <strong style="color:#ffcc02">' + p.t26 + '</strong>万台'
        + (p.cum26 != null ? ' <span style="font-size:10px;color:' + (p.cum26 < 0 ? '#ef5350' : '#66bb6a') + '">(' + (p.cum26 > 0 ? '+' : '') + p.cum26 + '%)</span>' : '')
        + '</div>'
        + (p.yoy26_8 != null ? '<div>26年8月単月: <span style="font-size:10px;color:' + (p.yoy26_8 < 0 ? '#ef5350' : '#66bb6a') + '">' + (p.yoy26_8 > 0 ? '+' : '') + p.yoy26_8 + '%</span></div>' : '')
        + '</div></div>'
      : '')
    + (nevH > 0
      ? '<div style="color:#5a8abc;font-size:11px;font-weight:700;margin:6px 0 2px">⚡ 動力構成・新車販売比率 2026年9月</div>'
        + '<div id="cpca-pnev" style="height:' + nevH + 'px"></div>'
      : '<div style="font-size:10px;color:#3a5070;padding:4px 0">動力構成データなし（PDF未記載）</div>')
    + '<div style="color:#5a8abc;font-size:11px;font-weight:700;margin:8px 0 2px">🚙 車身構造 2026年9月</div>'
    + '<div id="cp-body" style="height:80px"></div>'
    + '<div style="color:#5a8abc;font-size:11px;font-weight:700;margin:8px 0 2px">🏷️ ブランド構成 2026年9月</div>'
    + '<div id="cpca-pbrand" style="height:80px"></div>'
    + (gradeH > 0
      ? '<div style="color:#5a8abc;font-size:11px;font-weight:700;margin:8px 0 2px">🏆 車型級別 2026年9月</div>'
        + '<div id="cp-grade" style="height:' + gradeH + 'px"></div>'
      : '<div style="font-size:10px;color:#3a5070;padding:4px 0">車型級別データなし（記事の表に未掲載）</div>');

  // echarts 描画（DOM確定後）
  function makeChart(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    try { echarts.getInstanceByDom(el).dispose(); } catch(e) {}
    return echarts.init(el, 'dark');
  }

  setTimeout(function() {
    // ① 動力構成（円グラフ）凡例下部・ラベルは%数字のみ
    if (n && n.ice != null) {
      var c = makeChart('cpca-pnev');
      if (c) c.setOption({
        backgroundColor: 'transparent',
        title: { text: 'NEV新車比率: ' + n.nev.toFixed(1) + '%  前年差: ' + sign(n.dnev) + 'pp',
                 textStyle: { fontSize: 11, color: '#7eb3ff' }, top: 2, left: 4 },
        legend: { bottom: 2, left: 'center', orient: 'horizontal',
                  textStyle: { fontSize: 10, color: '#8ab0d0' },
                  itemWidth: 10, itemHeight: 10, itemGap: 8,
                  data: ['BEV','PHEV','HEV','ICE'] },
        tooltip: { formatter: function(p) { return p.name + ': ' + p.value.toFixed(1) + '%'; } },
        series: [{ type: 'pie', radius: ['32%', '60%'], center: ['50%', '52%'],
          data: [
            { name: 'BEV',  value: n.bev,  itemStyle: { color: '#1565c0' } },
            { name: 'PHEV', value: n.phev, itemStyle: { color: '#42a5f5' } },
            { name: 'HEV',  value: n.hev,  itemStyle: { color: '#80cbc4' } },
            { name: 'ICE',  value: n.ice,  itemStyle: { color: '#546e7a' } },
          ],
          label: { show: true, position: 'inside',
                   formatter: function(p) { return p.percent >= 8 ? p.percent.toFixed(0) + '%' : ''; },
                   fontSize: 11, color: '#fff', fontWeight: 'bold' },
          labelLine: { show: false },
        }]
      });
    }

    // ② 車身構造（横棒）凡例右・ラベルは%数字のみ
    if (b) {
      var c = makeChart('cp-body');
      if (c) c.setOption({
        backgroundColor: 'transparent',
        legend: { right: 4, top: 'middle', orient: 'vertical',
                  textStyle: { fontSize: 10, color: '#8ab0d0' },
                  itemWidth: 10, itemHeight: 10, itemGap: 6,
                  data: ['SUV','セダン','MPV'] },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
          formatter: function(ps) { return ps.map(function(p) { return p.seriesName + ': ' + p.value.toFixed(1) + '%'; }).join('<br>'); }
        },
        grid: { left: 8, right: 72, top: 8, bottom: 8, containLabel: false },
        xAxis: { type: 'value', max: 100, show: false },
        yAxis: { type: 'category', data: [''], show: false },
        series: [
          { name: 'SUV',   type: 'bar', stack: 's', data: [b.SUV], barMaxWidth: 44,
            itemStyle: { color: '#ef6c00' },
            label: { show: true, position: 'inside', color: '#fff', fontSize: 11, fontWeight: 'bold',
              formatter: function(p) { return p.value.toFixed(0) + '%'; } } },
          { name: 'セダン', type: 'bar', stack: 's', data: [b.CAR], barMaxWidth: 44,
            itemStyle: { color: '#5e35b1' },
            label: { show: b.CAR >= 10, position: 'inside', color: '#fff', fontSize: 11,
              formatter: function(p) { return p.value.toFixed(0) + '%'; } } },
          { name: 'MPV',   type: 'bar', stack: 's', data: [b.MPV], barMaxWidth: 44,
            itemStyle: { color: '#00897b' },
            label: { show: b.MPV >= 8, position: 'inside', color: '#fff', fontSize: 11,
              formatter: function(p) { return p.value.toFixed(0) + '%'; } } },
        ]
      });
    }

    // ③ ブランド構成（横棒）凡例右・ラベルは%数字のみ
    if (br) {
      var c = makeChart('cpca-pbrand');
      if (c) c.setOption({
        backgroundColor: 'transparent',
        legend: { right: 4, top: 'middle', orient: 'vertical',
                  textStyle: { fontSize: 10, color: '#8ab0d0' },
                  itemWidth: 10, itemHeight: 10, itemGap: 6,
                  data: ['中国系','合資','高級車'] },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
          formatter: function(ps) { return ps.map(function(p) { return p.seriesName + ': ' + p.value.toFixed(1) + '%'; }).join('<br>'); }
        },
        grid: { left: 8, right: 72, top: 8, bottom: 8, containLabel: false },
        xAxis: { type: 'value', max: 100, show: false },
        yAxis: { type: 'category', data: [''], show: false },
        series: [
          { name: '中国系', type: 'bar', stack: 's', data: [br.dom], barMaxWidth: 44,
            itemStyle: { color: '#c62828' },
            label: { show: true, position: 'inside', color: '#fff', fontSize: 11, fontWeight: 'bold',
              formatter: function(p) { return p.value.toFixed(0) + '%'; } } },
          { name: '合資', type: 'bar', stack: 's', data: [br.jv], barMaxWidth: 44,
            itemStyle: { color: '#1565c0' },
            label: { show: br.jv >= 10, position: 'inside', color: '#fff', fontSize: 11,
              formatter: function(p) { return p.value.toFixed(0) + '%'; } } },
          { name: '高級車', type: 'bar', stack: 's', data: [br.lux], barMaxWidth: 44,
            itemStyle: { color: '#f9a825' },
            label: { show: br.lux >= 8, position: 'inside', color: '#fff', fontSize: 11,
              formatter: function(p) { return p.value.toFixed(0) + '%'; } } },
        ]
      });
    }

    // ④ 車型級別（横棒）凡例右・ラベルは%数字のみ
    if (g) {
      var c = makeChart('cp-grade');
      if (c) c.setOption({
        backgroundColor: 'transparent',
        title: { show: false },
        legend: { right: 4, top: 'middle', orient: 'vertical',
                  textStyle: { fontSize: 10, color: '#8ab0d0' },
                  itemWidth: 10, itemHeight: 10, itemGap: 4,
                  data: ['a00','A0','A','B','C'] },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
          formatter: function(ps) { return ps.map(function(p) { return p.seriesName + ': ' + p.value + '%'; }).join('<br>'); }
        },
        grid: { left: 8, right: 72, top: 8,  bottom: 8, containLabel: false },
        xAxis: { type: 'value', max: 100, show: false },
        yAxis: { type: 'category', data: [''], show: false },
        series: [
          { name: 'a00', type: 'bar', stack: 's', data: [g.a00], barMaxWidth: 36,
            itemStyle: { color: '#b71c1c' },
            label: { show: g.a00 >= 3, position: 'inside', color: '#fff', fontSize: 10,
              formatter: function(p) { return p.value + '%'; } } },
          { name: 'A0',  type: 'bar', stack: 's', data: [g.A0],  barMaxWidth: 36,
            itemStyle: { color: '#ef5350' },
            label: { show: g.A0 >= 5, position: 'inside', color: '#fff', fontSize: 10,
              formatter: function(p) { return p.value + '%'; } } },
          { name: 'A',   type: 'bar', stack: 's', data: [g.A],   barMaxWidth: 36,
            itemStyle: { color: '#42a5f5' },
            label: { show: true, position: 'inside', color: '#fff', fontSize: 10,
              formatter: function(p) { return p.value + '%'; } } },
          { name: 'B',   type: 'bar', stack: 's', data: [g.B],   barMaxWidth: 36,
            itemStyle: { color: '#1565c0' },
            label: { show: true, position: 'inside', color: '#fff', fontSize: 10,
              formatter: function(p) { return p.value + '%'; } } },
          { name: 'C',   type: 'bar', stack: 's', data: [g.C],   barMaxWidth: 36,
            itemStyle: { color: '#f9a825' },
            label: { show: g.C >= 5, position: 'inside', color: '#fff', fontSize: 10,
              formatter: function(p) { return p.value + '%'; } } },
        ]
      });
    }
  }, 80);
}

// ---- 大区域トレンドチャート ----
var cpcaRegView='volume', cpcaRegChart=null;
window.cpcaSetRegionView = function(v,btn){
  cpcaRegView=v;
  document.querySelectorAll('#cpca-region-tabs .btn').forEach(b=>{
    b.className=b===btn?'btn btn-sm btn-primary active':'btn btn-sm btn-outline-secondary';
  });
  renderRegionChart();
};

function renderRegionChart(){
  const el=document.getElementById('ec-cpca-region');
  if(!el) return;
  if(!cpcaRegChart) cpcaRegChart=echarts.init(el,'dark');
  const d = cpcaRegView==='growth'?CPCA.regionGrowth:cpcaRegView==='share'?CPCA.regionShare:CPCA.regionVolume;
  const xData = cpcaRegView==='growth'?d.months:d.years;
  const isG=cpcaRegView==='growth', isS=cpcaRegView==='share';
  cpcaRegChart.setOption({
    backgroundColor:'transparent',
    tooltip:{trigger:'axis',axisPointer:{type:isG?'cross':'shadow'}},
    legend:{type:'scroll',bottom:0,textStyle:{fontSize:10,color:'#8ab0d0'}},
    grid:{left:60,right:50,top:20,bottom:60},
    xAxis:{type:'category',data:xData,axisLabel:{fontSize:10,rotate:isG?20:0,color:'#7eb3ff'}},
    yAxis:{type:'value',max:isS?100:undefined,
      axisLabel:{fontSize:10,color:'#6a8aaa',formatter:isS||isG?v=>v+'%':undefined},
      splitLine:{lineStyle:{color:'#1e3555'}}},
    series: d.regions.map(r=>({
      name:r, type:isG?'line':'bar', stack:isG?undefined:'total',
      data:d.data[r], smooth:isG,
      itemStyle:{color:CPCA.regionColor[r]},
      lineStyle:isG?{width:2.5}:undefined,
    })),
  });
}

// ---- 省別販売量チャート ----
var cpcaProvChart=null;
function renderProvSalesChart(){
  const el=document.getElementById('ec-cpca-prov');
  if(!el) return;
  const sorted=Object.entries(CPCA.prov).sort((a,b)=>b[1].y25-a[1].y25);
  const totalH = calcHBarHeight(sorted.length, 3, {extra:100});
  el.style.height = totalH + 'px';
  if(cpcaProvChart){ try{cpcaProvChart.dispose();}catch(e){} }
  cpcaProvChart=echarts.init(el,'dark');
  cpcaProvChart.setOption({
    backgroundColor:'transparent',
    tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},
    legend:{data:['2024年','2025年','26年1-8月'],top:8,type:'scroll',textStyle:{fontSize:10,color:'#8ab0d0'}},
    grid:{left:65,right:55,top:45,bottom:20},
    yAxis:{type:'category',data:sorted.map(([k])=>k),axisLabel:{fontSize:9,color:'#7eb3ff'}},
    xAxis:{type:'value',name:'万台',nameTextStyle:{color:'#6a8aaa',fontSize:9},
      axisLabel:{fontSize:9,color:'#6a8aaa'},splitLine:{lineStyle:{color:'#1e3555'}}},
    barMaxWidth: getBarMaxWidth(16),
    series:[
      {name:'2024年',  type:'bar',data:sorted.map(([,v])=>v.y24), itemStyle:{color:'#3b6ea8'},barMaxWidth:getBarMaxWidth(16)},
      {name:'2025年',  type:'bar',data:sorted.map(([,v])=>v.y25), itemStyle:{color:'#2563eb'},barMaxWidth:getBarMaxWidth(16)},
      {name:'26年1-8月',type:'bar',data:sorted.map(([,v])=>v.t26), itemStyle:{color:'#f59e0b'},barMaxWidth:getBarMaxWidth(16)},
    ]
  });
}

// ---- ペイン切替フック ----
(function(){
  var _orig2=window.cdsShowPane;
  window.cdsShowPane=function(id){
    _orig2(id);
    if(id==='cds-region-trend') setTimeout(renderRegionChart,60);
    if(id==='cds-prov-sales')   setTimeout(renderProvSalesChart,60);
    if(id==='cds-china-map')    setTimeout(cpcaInitMap,60);
    // 世界シェアペイン
    var wsPanes = ['ws-regional','ws-china-share','ws-monthly','ws-country','ws-maker','ws-maker-region',
                   'ws-nev-yearly','ws-nev-monthly','ws-nev-region','ws-nev-penetration','ws-nev-overseas','ws-nev-makers'];
    if(wsPanes.indexOf(id) >= 0) setTimeout(function(){ wsRender(id); }, 60);

    // 解説パネルの更新（INFO_REGISTRYルーティング）
    if (typeof window.cdsRenderInfoPanel === 'function') {
      try { window.cdsRenderInfoPanel(id); } catch(e) {}
    }
  };
})();

})(); // end CPCA module
