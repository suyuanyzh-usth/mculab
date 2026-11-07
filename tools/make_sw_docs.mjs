/**
 * make_sw_docs.mjs — 生成软件著作权登记用的"源程序"与"用户手册"
 * ------------------------------------------------------------------
 * 软著对源程序材料的要求（形式审查，卡得很死）：
 *   · 前 30 页 + 后 30 页，共 60 页；不足 60 页则全部提交
 *   · 每页 50 行，连续排版，不能有空白页
 *   · 页眉需含：软件名称 + 版本号 + 页码
 *
 * 实现方式：直接生成 A4 固定尺寸的 HTML 页（每页一个 div），
 * 再用 Edge 无头模式打印成 PDF。这样分页、页眉、页码都可精确控制，
 * 不依赖任何 npm 包，也不受系统中文字体缺失影响。
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildManualHtml } from './manual.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'build', 'sw');
const SOFT_NAME = '微控制器教学仿真实验平台';
const VERSION = 'V1.0';
const LINES_PER_PAGE = 50;
const MAX_COLS = 108;          // 单行最大字符数（超出折行，保证每页 50 行不变）
const PAGES = 60;              // 前 30 + 后 30

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------------- 1. 收集源程序 ---------------- */
function collectFiles() {
  const groups = [
    ['server', (f) => f.endsWith('.js')],
    ['public/js', (f) => f.endsWith('.js') && !f.includes('vendor')],
    ['platform', (f) => f.endsWith('.js') || f.endsWith('.h')],
    ['tools', (f) => f.endsWith('.mjs') || f.endsWith('.js')]
  ];
  const files = [];
  let buffer = [];
  for (const [dir, ok] of groups) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'vendor') walk(p); }
        else if (ok(e.name)) buffer.push(p);
      }
    };
    walk(abs);
    // 组内按路径排序，组间保持 groups 定义的顺序：
    // 源程序材料通常要求以"主程序"开头，服务端入口在前更符合审查习惯。
    files.push(...buffer.sort((a, b) => {
      // 入口文件排最前，让源程序材料从"主程序"开始（审查惯例）
      const rank = (f) => (/server[\\/]index\.js$/.test(f) ? 0 : /server[\\/]/.test(f) ? 1 : 2);
      const d = rank(a) - rank(b);
      return d !== 0 ? d : a.localeCompare(b);
    }));
    buffer = [];
  }
  return files;
}

function buildLines() {
  const files = collectFiles();
  const lines = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    lines.push(`/* ==================== ${rel} ==================== */`);
    const raw = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n');
    for (const ln of raw) {
      if (!ln.trim()) continue;                       // 去掉空行，提高信息密度
      // 超长行折行，折行后仍按"行"计数，保证每页严格 50 行
      for (let i = 0; i < ln.length; i += MAX_COLS) {
        lines.push(i === 0 ? ln.slice(0, MAX_COLS) : '    ' + ln.slice(i, i + MAX_COLS - 4));
      }
    }
  }
  return lines;
}

/* ---------------- 2. 生成源程序 HTML ---------------- */
function htmlSource(lines) {
  const total = lines.length;
  const half = PAGES / 2 * LINES_PER_PAGE;       // 1500
  let body = '';
  const pages = [];
  if (total <= PAGES * LINES_PER_PAGE) {
    // 不足 60 页：全部提交
    for (let i = 0; i < total; i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE));
  } else {
    for (let p = 0; p < PAGES / 2; p++) pages.push(lines.slice(p * LINES_PER_PAGE, (p + 1) * LINES_PER_PAGE));
    const tailStart = total - half;
    for (let p = 0; p < PAGES / 2; p++) pages.push(lines.slice(tailStart + p * LINES_PER_PAGE, tailStart + (p + 1) * LINES_PER_PAGE));
  }
  pages.forEach((pg, idx) => {
    body += `<div class="page">
  <div class="hd"><span>${SOFT_NAME} ${VERSION}</span><span>源程序</span><span>第 ${idx + 1} 页 / 共 ${pages.length} 页</span></div>
  <div class="code">${pg.map(l => `<div class="ln">${esc(l) || '&nbsp;'}</div>`).join('')}</div>
  <div class="ft">第 ${idx + 1} 页</div>
</div>`;
  });
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${SOFT_NAME} ${VERSION} 源程序</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Consolas, "DengXian", "Microsoft YaHei", monospace; }
  .page {
    width: 210mm; height: 297mm; padding: 12mm 12mm 10mm;
    page-break-after: always; position: relative; background: #fff;
  }
  .page:last-child { page-break-after: auto; }
  .hd {
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 8pt; color: #333; border-bottom: 0.6pt solid #666; padding-bottom: 2mm; margin-bottom: 3mm;
    font-family: "DengXian", "Microsoft YaHei", sans-serif;
  }
  .code { font-size: 7.6pt; line-height: 1.45; }
  .ln { white-space: pre; height: 4.66mm; overflow: hidden; }
  .ft { position: absolute; left: 0; right: 0; bottom: 6mm; text-align: center; font-size: 8pt; color: #666;
        font-family: "DengXian", "Microsoft YaHei", sans-serif; }
</style><body>${body}</body></html>`;
}

/* ---------------- 4. 输出 ---------------- */
fs.mkdirSync(OUT, { recursive: true });
const lines = buildLines();
const srcHtml = path.join(OUT, 'source.html');
const manHtml = path.join(OUT, 'manual.html');
fs.writeFileSync(srcHtml, htmlSource(lines), 'utf8');
fs.writeFileSync(manHtml, buildManualHtml({ name: SOFT_NAME, version: VERSION }), 'utf8');
console.log(`源程序行数：${lines.length}`);
console.log(`已生成：${path.relative(ROOT, srcHtml)}`);
console.log(`已生成：${path.relative(ROOT, manHtml)}`);
