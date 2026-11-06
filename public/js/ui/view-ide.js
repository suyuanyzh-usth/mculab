/*
 * view-ide.js — 代码 IDE 视图
 * CodeMirror 编辑器 + SDCC 在线编译 + .hex 预览/下载/装载。
 * 编译结果中的 "文件:行号: error" 可直接点击跳转到对应行。
 */
import { $, el, api, state, toast, bus, esc, setView, hex2 } from './core.js';

let cm = null;
let lastErrors = [];

export function init() {
  cm = CodeMirror.fromTextArea($('#codeEditor'), {
    mode: 'text/x-csrc',
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    lineWrapping: false,
    matchBrackets: true,
    viewportMargin: 40,
    extraKeys: {
      'Ctrl-B': () => doCompile(),
      'Cmd-B': () => doCompile(),
      'Ctrl-S': () => { persist(); toast('已保存到本地草稿', 'ok'); }
    }
  });
  state.cm = cm;
  cm.setValue(templateDefault());

  cm.on('change', () => { state.dirty = true; schedulePersist(); });

  $('#btnCompile').addEventListener('click', doCompile);
  $('#btnDownloadHex').addEventListener('click', downloadHex);
  $('#btnNewFromStarter').addEventListener('click', () => {
    if (!state.problem) return toast('请先在「实验题目」中选择一个题目', 'warn');
    if (state.dirty && !confirm('当前代码未保存，确定用起始代码覆盖？')) return;
    applyCode(state.problem.starter || '', state.problem.id + '.c');
  });
  $('#btnLoadHexFile').addEventListener('click', () => $('#hexFileInput').click());
  $('#hexFileInput').addEventListener('change', onHexFile);

  $('#compileResult').addEventListener('click', (e) => {
    const row = e.target.closest('[data-line]');
    if (!row) return;
    const ln = Number(row.dataset.line);
    cm.focus();
    cm.setCursor({ line: ln - 1, ch: 0 });
    scrollToLine(ln);
  });

  bus.on('ide-load-code', ({ code, problemId, filename }) => {
    state.pendingProblem = problemId;
    applyCode(code, filename || 'main.c');
  });
  bus.on('compile-request', doCompile);

  // 恢复上次草稿
  try {
    const saved = localStorage.getItem('mculab.lastCode');
    if (saved) cm.setValue(saved);
  } catch { }
}

export function show() {
  setTimeout(() => cm && cm.refresh(), 20);
}

function templateDefault() {
  return `/* 微控制器原理及应用 · 在线实验
 * 提示：先在「实验题目」里选一个实验，点击「载入起始代码」，
 *       或直接在此编写。按 Ctrl+B 编译。
 */
#include <stc89.h>
#include <stdio.h>

void delay_ms(unsigned int ms){
    unsigned int i, j;
    for(i = 0; i < ms; i++)
        for(j = 0; j < 110; j++);
}

int putchar(int c){          /* printf 重定向到串口 */
    while(!(SCON & 0x02));
    SBUF = (unsigned char)c;
    SCON &= ~0x02;
    return c;
}

void main(void){
    P1 = 0xFF;
    while(1){
        P1 ^= 0xFF;
        delay_ms(300);
    }
}
`;
}

function applyCode(code, filename) {
  state.code = code;
  state.dirty = false;
  cm.setValue(code);
  cm.clearHistory();
  $('#ideFileName').textContent = filename || 'main.c';
  persist();
  toast('已载入代码', 'ok');
}

let persistTimer = 0;
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 800);
}
function persist() {
  try {
    localStorage.setItem('mculab.lastCode', cm.getValue());
    if (state.pendingProblem || state.problem) {
      localStorage.setItem('mculab.code.' + (state.pendingProblem || state.problem.id), cm.getValue());
    }
  } catch { }
}

/* ================================================================ 编译 */
function logLine(text, cls = '') {
  const box = $('#compileConsole');
  if (box.dataset.cleared !== '1') { box.innerHTML = ''; box.dataset.cleared = '1'; }
  const d = el('div', { class: cls });
  d.textContent = text;
  box.append(d);
  box.scrollTop = box.scrollHeight;
}
function clearLog() { const b = $('#compileConsole'); b.innerHTML = ''; b.dataset.cleared = '1'; }

async function doCompile() {
  const code = cm.getValue();
  if (!code.trim()) return toast('代码为空', 'warn');
  state.code = code;
  const btn = $('#btnCompile');
  btn.classList.add('busy');
  clearLog();
  logLine('▶ 正在编译…', 'dim');
  const t0 = performance.now();
  try {
    const r = await api('/api/compile', {
      method: 'POST',
      body: { code, name: (state.problem?.id || 'main'), problemId: state.problem?.id || '' }
    });
    const ms = Math.round(performance.now() - t0);
    state.lastCompile = r;

    if (r.log && r.log.trim()) {
      for (const ln of r.log.split('\n')) {
        const cls = /error/i.test(ln) ? 'err' : (/warning/i.test(ln) ? 'warn' : 'dim');
        logLine(ln, cls);
      }
    }

    if (r.ok) {
      logLine(`✓ 编译成功  ${r.size} 字节  ·  通路 ${r.via}  ·  ${ms} ms`, 'ok');
      state.hex = r.hex || '';
      state.hexMeta = { size: r.size, via: r.via, ms };
      state.evidence.compileOk = true;
      state.evidence.compileAt = Date.now();
      state.evidence.hexSize = r.size || 0;

      $('#hexPreview').textContent = (r.hex || '').split('\n').slice(0, 40).join('\n') +
        ((r.hex || '').split('\n').length > 40 ? '\n… (共 ' + (r.hex || '').split('\n').length + ' 行)' : '');
      $('#compileResult').innerHTML = `
        <div class="state-grid" style="padding:0">
          <div class="k">状态</div><div class="v" style="color:var(--ok)">成功</div>
          <div class="k">代码大小</div><div class="v">${r.size} B / 8192 B</div>
          <div class="k">编译通路</div><div class="v">${esc(r.via)}</div>
          <div class="k">耗时</div><div class="v">${ms} ms</div>
          <div class="k">警告</div><div class="v">${(r.warnings || []).length} 条</div>
        </div>
        <p class="small muted" style="margin:8px 0 0">已自动载入仿真器。切换到「仿真运行」即可观察现象。</p>`;

      // 自动装载到仿真内核
      bus.emit('hex-ready', { hex: r.hex, problemId: state.problem?.id });
      // 记录练习
      api('/api/attempts', { method: 'POST', body: { problemId: state.problem?.id || '', kind: 'compile', ok: true, hex: (r.hex || '').slice(0, 40000), code: code.slice(0, 20000) } }).catch(() => { });
      toast('编译成功，已载入仿真', 'ok');
    } else {
      const errs = r.errors || [];
      logLine(`✗ 编译失败，${errs.length} 个错误`, 'err');
      renderErrors(errs);
      $('#hexPreview').textContent = '';
      state.evidence.compileOk = false;
      api('/api/attempts', { method: 'POST', body: { problemId: state.problem?.id || '', kind: 'compile', ok: false, message: (errs[0]?.msg || 'compile failed').slice(0, 400), code: code.slice(0, 20000) } }).catch(() => { });
    }
  } catch (e) {
    logLine('✗ ' + e.message, 'err');
    $('#compileResult').innerHTML = `<div class="diag-item err">${esc(e.message)}</div>
      <p class="small muted" style="margin-top:8px">若提示 SDCC 不可用，请用 <code>bash tools/check_env.sh</code> 自检工具链；平台会自动降级到内置汇编通路（需以 <code>__asm</code> 块编写）。</p>`;
  } finally {
    btn.classList.remove('busy');
  }
}

function renderErrors(errs) {
  lastErrors = errs;
  const box = $('#compileResult');
  if (!errs.length) { box.innerHTML = '<div class="diag-item warn">编译失败但未返回具体错误，请查看下方控制台输出。</div>'; return; }
  box.innerHTML = errs.map(e => `
    <div class="diag-item err" data-line="${e.line || 1}" style="cursor:pointer">
      <b>第 ${e.line || '?'} 行 · ${esc(e.kind || 'error')}</b>
      ${esc(e.msg || '')}
    </div>`).join('') + '<p class="small muted" style="margin-top:6px">点击错误可跳转到对应行。</p>';
}

function scrollToLine(ln) {
  const info = cm.getLineHandle(Math.max(0, ln - 1));
  if (info) cm.scrollIntoView({ line: ln - 1, ch: 0 }, 120);
}

/* ================================================================ HEX 文件 */
async function onHexFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  const text = await f.text();
  if (!text.trim().startsWith(':')) return toast('不是有效的 Intel HEX 文件（应以 ":" 开头）', 'err');
  state.hex = text;
  state.hexMeta = { size: text.length, via: 'upload', file: f.name };
  state.evidence.compileOk = true;
  state.evidence.compileAt = Date.now();
  $('#hexPreview').textContent = text.split('\n').slice(0, 40).join('\n');
  $('#ideFileName').textContent = f.name;
  clearLog();
  logLine(`✓ 已载入 HEX 文件：${f.name}（${text.split('\n').length} 行）`, 'ok');
  bus.emit('hex-ready', { hex: text, problemId: state.problem?.id, external: true });
  toast('HEX 已载入仿真器', 'ok');
  e.target.value = '';
}

function downloadHex() {
  if (!state.hex) return toast('还没有可下载的 HEX，请先编译', 'warn');
  const name = (state.problem?.id || 'main') + '.hex';
  const blob = new Blob([state.hex], { type: 'text/plain' });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('已下载 ' + name, 'ok');
}
