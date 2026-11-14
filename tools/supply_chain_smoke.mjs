#!/usr/bin/env node
// サプライチェーン分析ページ（supply-chain/）のブラウザ確認。
//   npm install puppeteer-core@23
//   python3 -m http.server 8770 --bind 127.0.0.1 &   （リポジトリ直下で）
//   node tools/supply_chain_smoke.mjs
// 確認すること：各タブがエラーなく描画される／企業詳細が開く／JSの例外がない／スマホ幅で横にはみ出さない。
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.SITE_URL || 'http://127.0.0.1:8770/supply-chain/';
const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find(p => existsSync(p));
const OUT = process.env.SHOT_DIR || 'smoke_screenshots';
mkdirSync(OUT, { recursive: true });

const views = ['hyp', 'sector/adas', 'sector/tires', 'sector/battery_materials', 'industries', 'sources'];
const errors = [];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 }]]) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    page.on('pageerror', e => errors.push(`[${label}] pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`); });
    page.on('requestfailed', r => errors.push(`[${label}] requestfailed: ${r.url()}`));
    page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(`[${label}] HTTP ${r.status()}: ${r.url()}`); });
    for (const v of views) {
      await page.goto(BASE + '#' + v, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => {
        const m = document.getElementById('main');
        return m && !/読み込み中/.test(m.textContent) && m.textContent.length > 50;
      }, { timeout: 20000 });
      const state = await page.evaluate(() => ({
        failed: /読み込めませんでした/.test(document.getElementById('main').textContent),
        cards: document.querySelectorAll('#main .card').length,
        scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth,
        title: document.title,
        text: document.getElementById('main').textContent
      }));
      if (state.failed) errors.push(`[${label}] ${v}: データ読み込み失敗の表示`);
      if (!state.cards) errors.push(`[${label}] ${v}: カードが描画されていない`);
      if (v === 'industries' && !state.text.includes('収益圧迫の広がり')) errors.push(`[${label}] 業種別の収益圧迫が表示されない`);
      if (v === 'industries' && !state.text.includes('詳しい指標を表示')) errors.push(`[${label}] 業種別の詳細トグルが表示されない`);
      if (v === 'hyp' && !state.text.includes('増収減益となった企業の割合')) errors.push(`[${label}] 全体比較の増収減益グラフがない`);
      if (v === 'hyp') {
        const charts = await page.evaluate(() => ({
          count: document.querySelectorAll('#main .visual-panel').length,
          rates: document.querySelectorAll('#main .visual-bar-track').length,
          marginPairs: document.querySelectorAll('#main .visual-pair').length,
          first: document.getElementById('main')?.firstElementChild?.className || '',
          legend: document.querySelector('#main .visual-legend')?.textContent || '',
          bars: [...document.querySelectorAll('#main .visual-bar-fill')].map(b => ({
            width: parseFloat(b.style.width), aria: b.parentElement.getAttribute('aria-label')
          }))
        }));
        if (charts.count < 3 || charts.rates < 5 || charts.marginPairs < 5) errors.push(`[${label}] トップの図が不足 ${JSON.stringify(charts)}`);
        if (!charts.first.includes('visual-first')) errors.push(`[${label}] グラフが先頭ではない`);
        if (!charts.legend.includes('2025年') || !charts.legend.includes('2026年')) errors.push(`[${label}] 前年同期凡例が不完全`);
        if (charts.bars.some(b => !Number.isFinite(b.width) || b.width < 0 || b.width > 100 || !b.aria)) {
          errors.push(`[${label}] 悪化率の棒が0〜100%でない、またはラベル不足`);
        }
      }
      if (v === 'hyp' && state.text.includes('6つの仮説と、いまのデータで言えること')) errors.push(`[${label}] 不要な仮説文章が残っている`);
      if (v.startsWith('sector/')) {
        const report = await page.evaluate(() => ({
          figures: document.querySelectorAll('#main > .report-figure').length,
          bars: document.querySelectorAll('#main > .report-figure .story-bar-track').length,
          price: document.querySelectorAll('#main > .report-figure .report-price-axis').length,
          first: document.getElementById('main')?.firstElementChild?.className || '',
          second: document.getElementById('main')?.children[1]?.className || '',
          details: document.querySelectorAll('#main > .report-details').length,
          openDetails: [...document.querySelectorAll('#main > .report-details')].filter(x => x.open).length,
          originalProse: document.querySelector('#main > .report-masthead p')?.textContent || '',
          sourceVisible: [...document.querySelectorAll('#main > .report-figure > .report-source-details')].some(x => x.open)
        }));
        const minFigures = v === 'sector/adas' ? 3 : 4;
        if (report.figures < minFigures || report.bars < 9) errors.push(`[${label}] ${v}: グラフ不足 ${JSON.stringify(report)}`);
        if (!report.first.includes('report-masthead') || !report.second.includes('report-figure')) errors.push(`[${label}] ${v}: グラフが見出し直下にない`);
        if (report.details !== 5 || report.openDetails !== 0 || report.sourceVisible) errors.push(`[${label}] ${v}: 詳細や出典が初期表示されている`);
        if (report.originalProse.length > 0) errors.push(`[${label}] ${v}: 説明文がグラフより先に表示されている`);
        if (v !== 'sector/adas' && report.price < 3) errors.push(`[${label}] ${v}: 単価の変化グラフ不足`);
      }
      if (state.scrollWidth > state.viewport + 8) errors.push(`[${label}] ${v}: 横にはみ出し ${state.scrollWidth} > ${state.viewport}`);
      await page.screenshot({ path: `${OUT}/${label}_${v.replace('/', '_')}.png`, fullPage: true });
      console.log(`${label} ${v}: cards=${state.cards} width=${state.scrollWidth}/${state.viewport}`);
    }
    // 企業詳細（最初の企業リンク）
    await page.goto(BASE + '#sector/tires', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#main .linkbtn', { timeout: 20000 });
    await page.click('#main .linkbtn');
    await page.waitForFunction(() => document.getElementById('panel').open &&
      !/読み込み中/.test(document.getElementById('panel-title').textContent), { timeout: 20000 });
    const panel = await page.evaluate(() => ({ title: document.getElementById('panel-title').textContent,
      tables: document.querySelectorAll('#panel-body table').length }));
    if (!panel.tables) errors.push(`[${label}] 企業詳細に表がない（${panel.title}）`);
    await page.screenshot({ path: `${OUT}/${label}_company.png` });
    console.log(`${label} company: ${panel.title} tables=${panel.tables}`);
    await page.close();
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error('SMOKE FAILED\n' + errors.join('\n'));
  process.exit(1);
}
console.log('supply-chain smoke checks passed');
