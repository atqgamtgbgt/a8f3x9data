#!/usr/bin/env node
// Browser smoke for chart-led supply-chain tabs, based on 崔東樹 ECharts UI.
// Test using: python3 -m http.server 8770 & node tools/supply_chain_smoke.mjs
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.SITE_URL || 'http://127.0.0.1:8770/supply-chain/';
const CHROME = process.env.CHROME_PATH ||
  ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
const OUT = process.env.SHOT_DIR || 'smoke_screenshots';
mkdirSync(OUT,{recursive:true});

const views=[
  ['hyp',6],['sector/adas',6],['sector/tires',7],
  ['sector/battery_materials',7],['industries',4],['sources',0]
];
const failures=[],warnings=[];
const browser=await puppeteer.launch({
  executablePath:CHROME,headless:'new',
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
});
try {
  for(const [kind,viewport] of [
    ['desktop',{width:1280,height:900}],
    ['mobile',{width:390,height:844,isMobile:true,deviceScaleFactor:2}]
  ]) {
    const page=await browser.newPage();
    await page.setViewport(viewport);
    page.on('pageerror',e=>failures.push(kind+' pageerror: '+e.message));
    page.on('console',m=>{if(m.type()==='error')failures.push(kind+' console: '+m.text());});
    page.on('requestfailed',r=>{
      if (/echarts.*min\.js/.test(r.url())) warnings.push(kind+': ECharts CDN unavailable — SVG fallback should render');
      else failures.push(kind+' requestfailed: '+r.url());
    });
    for(const [view,minCharts] of views) {
      await page.goto(BASE+'#'+view,{waitUntil:'networkidle2',timeout:45000});
      await page.waitForFunction(()=>{
        const m=document.getElementById('main');
        return m&&!/グラフデータを読み込み中|読み込み中…|読み込み中…/.test(m.textContent)
          &&m.textContent.length>40;
      },{timeout:25000});
      await new Promise(resolve=>setTimeout(resolve,250));
      const check=await page.evaluate(()=>{
        const main=document.getElementById('main');
        const figures=[...main.querySelectorAll('.cui-chart-card')];
        const all=figures.map(el=>({
          title:el.querySelector('h3')?.textContent,
          hasContent:!!el.querySelector('canvas, svg, .cui-fallback-bars, .cui-fallback-table'),
          sources:el.querySelectorAll('.cui-source').length
        }));
        const errors=/読み込めませんでした|読み込みに失敗しました/.test(main.textContent);
        return {
          failed:errors,
          charts:figures.length,
          emptyCharts:all.filter(x=>!x.hasContent).map(x=>x.title),
          noSources:all.filter(x=>x.sources===0).map(x=>x.title),
          width:document.documentElement.scrollWidth,viewport:window.innerWidth,
          details:main.querySelectorAll('.cui-detail-section .report-details').length,
          detailsOpen:main.querySelectorAll('.cui-detail-section .report-details[open]').length,
          title:document.title,
          first:main.firstElementChild?.className||'',
          hasControls:main.querySelectorAll('select').length,
          chartLibrary:typeof window.echarts!=='undefined'
        };
      });
      if(check.failed)failures.push(kind+' '+view+': failed-data banner');
      if(check.charts!==minCharts)failures.push(kind+' '+view+': chart count '+check.charts+'/'+minCharts);
      if(check.emptyCharts.length)failures.push(kind+' '+view+': empty graphics '+check.emptyCharts.join(','));
      if(check.noSources.length)failures.push(kind+' '+view+': missing sources '+check.noSources.join(','));
      if(check.width>check.viewport+8)failures.push(kind+' '+view+': horizontal overflow '+check.width+'/'+check.viewport);
      if(view==='hyp' && !check.first.includes('cui-page-head'))failures.push(kind+': expected chart header first');
      if(view.startsWith('sector/')) {
        if(check.details!==5||check.detailsOpen!==0)
          failures.push(kind+' '+view+': company details broken '+check.details+'/'+check.detailsOpen);
        if(check.hasControls<2)failures.push(kind+' '+view+': missing market/period selectors');
      }
      if(!check.chartLibrary&&view==='hyp')
        warnings.push(kind+': CDN not loaded; fallback charts are visible');
      await page.screenshot({path:OUT+'/'+kind+'_'+view.replace('/','_')+'.png',fullPage:true});
      console.log(kind+' '+view+': '+JSON.stringify(check));
    }
    // Interaction: change product, show source, open an underlying company detail.
    await page.goto(BASE+'#sector/tires',{waitUntil:'networkidle2',timeout:45000});
    await page.waitForSelector('#cui-market select[aria-label="製品・部品"]',{timeout:20000});
    await page.waitForFunction(()=>document.querySelectorAll('#main .cui-chart-card').length>=7);
    const change=await page.$eval('#cui-market select[aria-label="製品・部品"]',
      el=>{const before=el.value;const choices=el.options.length;if(choices>1){
        el.value=el.options[1].value;el.dispatchEvent(new Event('change',{bubbles:true}));}
        return {before,now:el.value,choices};
      });
    if(change.choices>1&&change.before===change.now)
      failures.push(kind+': product selector not switching');
    await page.click('#report-data-market summary');
    await page.waitForFunction(()=>document.getElementById('report-data-market')?.dataset.loaded==='true',{timeout:18000});
    const detailOpen=await page.$('#report-data-market .linkbtn');
    if(!detailOpen)failures.push(kind+': missing company link in market details');
    else {
      await detailOpen.click();
      await page.waitForFunction(()=>document.getElementById('panel')?.open&&
        !/読み込み中/.test(document.getElementById('panel-title').textContent),{timeout:18000});
      const count=await page.$$eval('#panel-body table',xs=>xs.length);
      if(!count)failures.push(kind+': company detail has no tables');
      await page.screenshot({path:OUT+'/'+kind+'_company.png'});
    }
    await page.close();
  }
} finally {await browser.close();}
if(warnings.length)console.warn('WARNINGS\n'+[...new Set(warnings)].join('\n'));
if(failures.length){console.error('SMOKE FAILED\n'+failures.join('\n'));process.exit(1);}
console.log('Supply-chain Cui-style graph smoke passed');
