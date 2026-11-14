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
      if (v === 'sector/tires' && !state.text.includes('利益率の変化')) errors.push(`[${label}] タイヤの利益率変化が表示されない`);
      if (v.startsWith('sector/') && !state.text.includes('利益率悪化の要因分解（損益計算書）')) {
        errors.push(`[${label}] ${v}: 費用要因の分析が見つからない`);
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
