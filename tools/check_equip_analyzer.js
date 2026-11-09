#!/usr/bin/env node
// Regression checks for the standalone equipment-analyzer page.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'equip_analyzer.html'), 'utf8');
const js = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!js) throw new Error('Missing inline equipment-analyzer script');
new vm.Script(js, { filename: 'equip_analyzer.html' });

const functionSource = js.match(/function formatChinaPrice\(raw\)\{[\s\S]*?\n\}/)?.[0];
if (!functionSource) throw new Error('Missing yuan price formatter');
const format = vm.runInNewContext(functionSource + '\nformatChinaPrice', { Intl });

const cases = [
  ['26.35-36.90万', '263,500元〜369,000元'],
  ['7.99万', '79,900元'],
  ['0.98万', '9,800元'],
  ['', ''],
];
for (const [raw, expected] of cases) {
  if (format(raw) !== expected) {
    throw new Error('Price ' + JSON.stringify(raw) + ': expected ' + expected + ', got ' + format(raw));
  }
}

const data = JSON.parse(fs.readFileSync(path.join(root, 'output/pipeline/equip/equip_data.json'), 'utf8'));
let checked = 0;
for (const dataset of Object.values(data.datasets || {})) {
  for (const car of dataset.cars || []) {
    const p = car.price;
    if (!p) continue;
    if (!/^\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?万$/.test(p)) {
      throw new Error('Unexpected price format: ' + JSON.stringify(p));
    }
    if (format(p) === p + '元') throw new Error('Unconverted Chinese price: ' + p);
    checked++;
  }
}
// Verify every current dataset label is localized without altering source data.
const helperStart = js.indexOf('const DS_GROUP_NAMES=');
const helperEnd = js.indexOf('function computeRows(){');
if (helperStart < 0 || helperEnd <= helperStart) throw new Error('Missing display-label helpers');
const helpers = vm.runInNewContext(
  js.slice(helperStart, helperEnd) +
  '\n({ datasetLabel, originalName, originalModalLabel, distributionLabel, setDS: x => {DS=x}, setOriginal: x => {state.showOriginal=x} })',
  { Intl }
);
helpers.setDS(data.datasets);
for (const key of Object.keys(data.datasets)) {
  const label = helpers.datasetLabel(key);
  if (!label || /燃油|新能源|纯电|插混|混増/.test(label)) {
    throw new Error('Non-localized dataset label: ' + key + ' => ' + label);
  }
}
const sample = { item: 'テスト', zh: '主动刹车' };
if (helpers.originalName(sample) || helpers.originalModalLabel(sample)) {
  throw new Error('Chinese source labels should be hidden by default');
}
helpers.setOriginal(true);
if (!helpers.originalName(sample).includes(sample.zh) ||
    !helpers.originalModalLabel(sample).includes(sample.zh)) {
  throw new Error('Source labels must remain accessible with the toggle');
}
if (helpers.distributionLabel('ステレオ(双目)') !== 'ステレオ（2眼）') {
  throw new Error('Camera categories should be localized');
}
if (html.includes('燃油車</button>') || html.includes('新能源</button>') ||
    !html.includes('id="originalToggle"')) {
  throw new Error('Untranslated control labels or missing original-name toggle');
}

console.log('Equipment analyzer: JavaScript syntax OK; price tests passed; ' + checked + ' prices checked.');
