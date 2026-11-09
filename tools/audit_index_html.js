#!/usr/bin/env node
/**
 * Read-only diagnostic for the large standalone site page.
 * Prints potentially untranslated static text and validates classic inline JS.
 * It does not rewrite site content or treat names/quotes in source data as errors.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const bytes = Buffer.byteLength(source, 'utf8');
const lines = source.split('\n');
console.log('Main HTML: ' + bytes.toLocaleString('en-US') + ' bytes, ' + lines.length + ' lines');

const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
let inlineCount = 0, externalCount = 0, skippedCount = 0, scriptErrors = 0;
for (const match of source.matchAll(scriptRe)) {
  const attrs = match[1];
  const code = match[2].trim();
  if (/\bsrc\s*=/.test(attrs)) { externalCount++; continue; }
  const type = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) || [,''])[1].toLowerCase();
  if (type && !['text/javascript', 'application/javascript', 'module'].includes(type)) {
    skippedCount++;
    continue;
  }
  if (type === 'module') { skippedCount++; continue; } // vm.Script cannot parse ES modules.
  if (!code) continue;
  inlineCount++;
  try {
    new vm.Script(code, { filename: 'index.html inline script #' + inlineCount });
  } catch (error) {
    scriptErrors++;
    const atLine = source.slice(0, match.index).split('\n').length;
    console.log('JS ERROR (script ' + inlineCount + ', near HTML line ' + atLine + '): ' + error.message);
  }
}
console.log('Inline classic scripts checked: ' + inlineCount +
            '; external scripts: ' + externalCount + '; skipped/module/data scripts: ' + skippedCount +
            '; syntax errors: ' + scriptErrors);

// Identify the largest inline blocks to guide safe, incremental refactoring.
function blockSizes(regex) {
  return Array.from(source.matchAll(regex), (match, index) => ({
    ordinal: index + 1,
    bytes: Buffer.byteLength(match[2], 'utf8'),
    line: source.slice(0, match.index).split('\n').length,
    start: match[2].slice(0, 160).replace(/\s+/g, ' ').trim(),
    currentScript: /document\.currentScript/.test(match[2])
  })).sort((a, b) => b.bytes - a.bytes).slice(0, 8);
}
console.log('Largest inline scripts: ' + JSON.stringify(blockSizes(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)));
console.log('Largest inline styles: ' + JSON.stringify(blockSizes(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi)));

// Count static HTML lines with characters typically exclusive to Simplified Chinese.
// This is an indicator only. Inline dynamic text and brand names need separate review.
const nonScript = source
  .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
const possibleChinese = /[这车电销价产级为办经证计网维营厂广货订选购时们无优规动务师样开关护栏湾览问张气频页线驾费兴厅]/;
const hits = nonScript.split('\n').map((line, i) => ({ i: i + 1, line: line.trim() }))
  .filter(x => possibleChinese.test(x.line));
console.log('Potential Simplified Chinese in static HTML lines: ' + hits.length);
hits.slice(0, 25).forEach(x => console.log('  candidate: ' + x.line.slice(0, 180)));
if (hits.length > 25) console.log('  ... and ' + (hits.length - 25) + ' more candidate lines');

// Visible text nodes are stronger evidence of untranslated UI than file-name attributes.
const visibleText = nonScript.replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<[^>]+>/g, '\n').split('\n')
  .map(value => value.trim()).filter(value => value && possibleChinese.test(value));
const uniqueVisible = [...new Set(visibleText)];
console.log('Potential Simplified Chinese visible text snippets: ' + uniqueVisible.length);
uniqueVisible.slice(0, 100).forEach(value => console.log('  text: ' + value.slice(0, 160)));
if (uniqueVisible.length > 100) console.log('  ... and ' + (uniqueVisible.length - 100) + ' more text snippets');
console.log('Diagnostic complete (no files were changed).');
if (scriptErrors) process.exitCode = 1;
