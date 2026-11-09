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
console.log('Equipment analyzer: JavaScript syntax OK; price tests passed; ' + checked + ' prices checked.');
