/*
 * ui/core.js — 前端共享内核
 * 提供：DOM 助手、API 客户端、Markdown 渲染、Toast/Modal、全局状态与事件总线。
 * 不依赖任何第三方库；不 import 任何视图模块（避免循环依赖）。
 */
import { CPU8051 } from '../core/cpu8051.js';
import { CircuitSim } from '../core/circuit.js';
import { LogicAnalyzer, SerialAssistant } from '../scope/instruments.js';

/* ================================================================ DOM */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const fmtNum = (v) => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('zh-CN');
export const hex2 = (v) => '0x' + (v & 0xFF).toString(16).toUpperCase().padStart(2, '0');
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fmtDur(us) {
  if (us == null) return '—';
  if (us < 1000) return `${us.toFixed(2)} µs`;
  if (us < 1e6) return `${(us / 1000).toFixed(2)} ms`;
  return `${(us / 1e6).toFixed(3)} s`;
}
export function debounce(fn, ms = 250) {
  let t = 0;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function bytesToHex(arr) { return Array.from(arr || []).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '); }
/**
 * 归一化账号/密码输入。
 * 中文输入法下很容易打出全角字符（ｔｅａｃｈｅｒ１２３），肉眼几乎看不出差别，
 * 但服务端比对必然失败。这类"看起来没打错却登不上"的问题很难自查，
 * 因此在提交前统一转成半角，并去掉首尾空白与零宽字符。
 */
export function normalizeCredential(v) {
  return String(v ?? '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)) // 全角 → 半角
    .replace(/\u3000/g, ' ')        // 全角空格
    .replace(/[\u200B-\u200D\uFEFF]/g, '')  // 零宽字符
    .trim();
}

export function parseHexInput(s) {
  const clean = String(s || '').replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.substr(i, 2), 16));
  return out;
}

/* ================================================================ Markdown（教学够用） */
export function md(src) {
  if (!src) return '';
  let s = String(src);
  const blocks = [];
  // 先把围栏代码块摘出来
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return `\u0000B${blocks.length - 1}\u0000`;
  });
  s = esc(s);
  // 行内代码
  s = s.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
  // 标题
  s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  // 粗体 / 斜体
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // 引用
  s = s.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
  // 分隔线
  s = s.replace(/^---+$/gm, '<hr>');
  // 表格（简单竖线表）
  s = s.replace(/((?:^\|.*\|\s*$\n?)+)/gm, (tbl) => {
    const rows = tbl.trim().split('\n').map(r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
    if (rows.length < 2 || !/^:?-{2,}/.test(rows[1].join('').replace(/\|/g, '') || '-')) {
      if (!/^\s*:?-+:?\s*$/.test(rows[1]?.join('') || '')) return tbl;
    }
    const head = rows[0], body = rows.slice(2);
    return `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
      body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
  });
  // 列表
  s = s.replace(/(?:^[ \t]*[-*+]\s+.+\n?)+/gm, (blk) => {
    const items = blk.trim().split('\n').map(l => l.replace(/^[ \t]*[-*+]\s+/, ''));
    return '<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
  });
  s = s.replace(/(?:^[ \t]*\d+[.)]\s+.+\n?)+/gm, (blk) => {
    const items = blk.trim().split('\n').map(l => l.replace(/^[ \t]*\d+[.)]\s+/, ''));
    return '<ol>' + items.map(i => `<li>${i}</li>`).join('') + '</ol>';
  });
  // 链接
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // 段落
  s = s.split(/\n{2,}/).map(p => {
    const t = p.trim();
    if (!t) return '';
    if (/^<(h[1-3]|ul|ol|pre|blockquote|table|hr)/.test(t)) return t;
    if (/^\u0000B\d+\u0000$/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  // 还原代码块
  s = s.replace(/\u0000B(\d+)\u0000/g, (_, i) => `<p>${blocks[+i]}</p>`).replace(/<p><pre>/g, '<pre>').replace(/<\/pre><\/p>/g, '</pre>');
  return s;
}

/* ================================================================ 状态 */
export const state = {
  user: null,
  info: null,
  problems: [],
  problem: null,
  code: '',
  hex: '',
  hexMeta: null,
  sch: null,
  sim: null,
  cpu: null,
  la: null,
  serial: null,
  running: false,
  speed: 1,
  lastCompile: null,
  view: 'problems',
  offline: false,
  dirty: false,
  evidence: {       // 报告素材
    compileOk: false, compileAt: null, hexSize: 0,
    simCycles: 0, simAt: null, portEvents: 0,
    diag: null, waves: null, serialLog: ''
  }
};

/* ================================================================ 事件总线 */
const handlers = new Map();
export const bus = {
  on(ev, fn) {
    if (!handlers.has(ev)) handlers.set(ev, new Set());
    handlers.get(ev).add(fn);
    return () => handlers.get(ev).delete(fn);
  },
  emit(ev, ...args) { for (const fn of handlers.get(ev) || []) { try { fn(...args); } catch (e) { console.error(e); } } }
};

/* ================================================================ API */
let onUnauthorized = () => { };
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  /*
   * 云平台网关会对"相邻的连续 POST"做间歇性限流，返回 403 的 HTML 拦截页
   * （不是应用的 JSON 错误）。这类 403 说明请求根本没到达后端，重试是安全的；
   * 5xx/超时则可能已经执行，不能盲目重试（避免重复入库）。
   */
  let r;
  const retryable = (code) => code === 403 || code === 503;
  try {
    r = await fetch(path, init);
    if (retryable(r.status)) {
      // 只重试一次；403/503 表示请求未到达后端，重试不会造成重复写入
      await new Promise(res => setTimeout(res, 450));
      r = await fetch(path, init);
    }
  } catch (e) {
    const err = new Error(navigator.onLine === false
      ? '当前离线：该操作需要联网（已加载的页面、原理图与仿真仍可继续使用）'
      : '网络请求失败：' + e.message);
    // 标记为"网络原因"而非鉴权失败，供离线会话恢复逻辑区分
    err.offline = true;
    throw err;
  }
  let data = null;
  const txt = await r.text();
  try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }

  /*
   * 401 要分两种情况处理 —— 这里曾经有个真实缺陷：
   *   · 登录/注册接口返回 401 表示"账号或密码不对"，是用户输入问题；
   *   · 其他接口返回 401 才表示"会话失效"，需要踢回登录页。
   * 早期把所有 401 都当会话过期，导致学生密码输错时看到的是
   * "登录已过期，请重新登录"，既误导又让人以为"点了没反应"。
   */
  if (r.status === 401) {
    const isAuthAttempt = /^\/api\/auth\/(login|register)$/.test(path);
    if (isAuthAttempt) {
      const err = new Error((data && data.error) || '账号或密码不正确');
      err.authFailed = true;
      throw err;
    }
    onUnauthorized();
    throw new Error((data && data.error) || '登录已过期，请重新登录');
  }
  if (!r.ok) throw new Error((data && (data.error || data.message)) || `请求失败 (${r.status})`);
  return data;
}

/* ================================================================ Toast */
let toastTimer = 0;
export function toast(msg, kind = '', ms = 2600) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ================================================================ Modal */
export function modal(title, bodyHtml, actions = []) {
  const m = $('#modal');
  $('#modalTitle').textContent = title;
  const body = $('#modalBody');
  body.innerHTML = '';
  if (typeof bodyHtml === 'string') body.innerHTML = bodyHtml;
  else if (bodyHtml) body.append(bodyHtml);
  if (actions.length) {
    const bar = el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' });
    for (const a of actions) {
      bar.append(el('button', { class: 'btn ' + (a.primary ? 'primary' : ''), onclick: async () => { if (!a.onClick || await a.onClick() !== false) closeModal(); } }, a.label));
    }
    body.append(bar);
  }
  m.classList.remove('hidden');
  return body;
}
export function closeModal() { $('#modal').classList.add('hidden'); }

export function confirmBox(title, text, okLabel = '确定') {
  return new Promise((resolve) => {
    modal(title, `<p>${esc(text)}</p>`, [
      { label: '取消', onClick: () => { resolve(false); } },
      { label: okLabel, primary: true, onClick: () => { resolve(true); } }
    ]);
  });
}
export function promptBox(title, fields) {
  return new Promise((resolve) => {
    const wrap = el('div');
    const inputs = {};
    for (const f of fields) {
      const lab = el('label', {}, [f.label]);
      const inp = el('input', { class: 'input', placeholder: f.placeholder || '', value: f.value || '', type: f.type || 'text' });
      if (f.type === 'textarea') {
        const ta = el('textarea', { placeholder: f.placeholder || '' }); ta.value = f.value || '';
        inputs[f.name] = ta; lab.append(ta);
      } else { inputs[f.name] = inp; lab.append(inp); }
      wrap.append(lab);
    }
    modal(title, wrap, [
      { label: '取消', onClick: () => resolve(null) },
      { label: '确定', primary: true, onClick: () => resolve(Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.value]))) }
    ]);
    setTimeout(() => Object.values(inputs)[0]?.focus(), 50);
  });
}

/* ================================================================ 仿真环境初始化 */
export function ensureSim() {
  if (!state.cpu) {
    state.cpu = new CPU8051({ fosc: 11059200 });
    state.sim = new CircuitSim();
    state.sim.cpu = state.cpu;
    state.la = new LogicAnalyzer({ capacity: 240000 });
    state.serial = new SerialAssistant();
  }
  return { cpu: state.cpu, sim: state.sim };
}

/** 把原理图接入仿真：器件 + 导线 → Netlist */
export function bindCircuit(sch) {
  const { sim, cpu } = ensureSim();
  sim.setCircuit(sch.parts, sch.wires);
  sim.cpu = cpu;
  sim.rebuild();
  return sim;
}

export function loadHexIntoSim(hexText) {
  const { cpu, sim } = ensureSim();
  cpu.softReset();                 // 先清 CPU 状态（保留旧 Flash 不会被用到）
  const r = cpu.loadHex(hexText);  // 再装入新程序
  cpu.pc = 0x0000;
  sim.reset();
  sim.refresh();
  return r;
}

/* ================================================================ 视图切换 */
export function setView(name) {
  state.view = name;
  $$('.view').forEach(v => v.classList.add('hidden'));
  const v = $('#view-' + name);
  if (v) v.classList.remove('hidden');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  bus.emit('view', name);
  // 触发一次尺寸重算（CodeMirror / SVG 在隐藏时无法测量）
  if (name === 'ide' && state.cm) setTimeout(() => state.cm.refresh(), 30);
  if (name === 'sim' || name === 'circuit' || name === 'scope') bus.emit('relayout');
}
