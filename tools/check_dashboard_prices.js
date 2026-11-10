#!/usr/bin/env node
// Check both dashboard ranking renderers use the Japanese yuan formatter.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const js = fs.readFileSync(path.resolve(__dirname, '..', 'js/dashboard-core.js'), 'utf8');
new vm.Script(js, {filename: 'js/dashboard-core.js'});
const source = js.match(/function formatCnyPrice\(priceStr\) \{[\s\S]*?\n\}/)?.[0];
if (!source) throw new Error('Expected CNY formatting helper not found');
const formatter = vm.runInNewContext(source + '\nformatCnyPrice', { Intl });
const cases = [
  ['26.35-36.90万', '263,500〜369,000元'],
  ['6.48-9.48万', '64,800〜94,800元'],
  ['24.98万', '249,800元'],
  ['17.98万元', '179,800元'],
  ['100元', '100元'],
  ['', '']
];
for (const [input, expected] of cases) {
  if (formatter(input) !== expected) {
    throw new Error(JSON.stringify({input,expected,actual:formatter(input)}));
  }
}
const matches = js.match(/esc\(formatCnyPrice\(r\.price \|\| ['"]{2}\)\)/g) || [];
if (matches.length !== 2) {
  throw new Error('Expected two ranking price renderers to use formatter; found ' + matches.length);
}
console.log('Japanese CNY formatting validated for main rankings:', cases.length, 'cases');
