/**
 * check_dom_contract.mjs — 前后端 DOM 契约静态检查
 * 扫描 public/js/ui/*.js 与 app.js 中所有 $('#id') / document.getElementById('id')，
 * 与 public/index.html 中的 id 集合比对，找出选择器写错/漏写的元素。
 * 这类错误在 Node 里不会报，只有浏览器里才会 undefined，所以单列一个检查。
 */
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

// 由 JS 在模态框里动态创建的元素（不在 index.html 中），以及形如 '#view-' 的模板拼接
const DYNAMIC = new Set(['pwdOld', 'pwdNew', 'pwdNew2', 'tAns', 'tAnsSend', 'tAnsClose', 'netBarClose', 'stageSelect', 'btnAssignStart', 'btnAssignSubmit', 'schState', 'openCode', 'codeState', 'openReport', 'subsBox', 'openSchInEditor']);
const isDynamicPattern = (id) => id === 'view-' || id.endsWith('-');

const files = ['public/js/app.js', ...fs.readdirSync(path.join(ROOT, 'public/js/ui')).map(f => 'public/js/ui/' + f)];
let bad = 0, checked = 0;
const report = [];
for (const rel of files) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const refs = new Set();
  for (const m of src.matchAll(/\$\(\s*'#([A-Za-z0-9_-]+)'/g)) refs.add(m[1]);
  for (const m of src.matchAll(/getElementById\(\s*'([A-Za-z0-9_-]+)'/g)) refs.add(m[1]);
  const missing = [...refs].filter(id => !ids.has(id) && !DYNAMIC.has(id) && !isDynamicPattern(id));
  checked += refs.size;
  if (missing.length) { bad += missing.length; report.push(`  ✗ ${rel}: 找不到 #${missing.join(', #')}`); }
}
// 反向检查：HTML 里定义了但从未被引用的 id（仅提示）
const used = new Set();
for (const rel of files) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const m of src.matchAll(/['"]#([A-Za-z0-9_-]+)['"]/g)) used.add(m[1]);
  for (const m of src.matchAll(/getElementById\(\s*'([A-Za-z0-9_-]+)'/g)) used.add(m[1]);
}
const unused = [...ids].filter(id => !used.has(id));
console.log('\n===== DOM 契约检查 =====');
console.log(`index.html 定义 ${ids.size} 个 id；JS 引用 ${checked} 处`);
console.log(bad ? report.join('\n') : '  ✓ 所有 JS 选择器都能在 index.html 中找到');
console.log(`\n未被 JS 直接引用的 id（${unused.length} 个，通常是 CSS 或纯展示用）: ${unused.slice(0, 25).join(', ')}`);
console.log(`\n结果: ${bad === 0 ? '通过' : bad + ' 处缺失'}`);
process.exit(bad ? 1 : 0);
