/*
 * view-grade.js — 成绩册（教师）
 * ------------------------------------------------------------------
 * 结构（教师可自定义）：
 *   环节（实验）权重 → 环节得分 = Σ(子项权重 × 子项分) / Σ子项权重
 *   总分 = Σ(环节权重 × 环节得分) / Σ环节权重
 * 未打分的子项不计入分母；某环节全部未打分则该环节不参与总评。
 * 及格线、保留小数位均可配置（默认 60 分、0 位小数）。
 */
import { $, $$, el, api, toast, modal, confirmBox } from './core.js';

let scheme = null;
let students = [];
let activeStage = null;

export function init() {
  $('#btnAddStage').addEventListener('click', () => addRow('stage'));
  $('#btnAddItem').addEventListener('click', () => addRow('item'));
  $('#btnSaveScheme').addEventListener('click', saveScheme);
  $('#btnRefreshGrades').addEventListener('click', () => load(true));
  $('#btnExportGrades').addEventListener('click', exportCsv);
  $('#schemeEditor').addEventListener('click', onSchemeClick);
  $('#gradeTable').addEventListener('change', onScoreChange);
  $('#gradeTable').addEventListener('click', onTableClick);
}

export async function show() {
  await load(false);
}

async function load(notify) {
  try {
    const r = await api('/api/gradebook');
    scheme = r.scheme;
    students = r.students || [];
    if (!activeStage || !scheme.stages.some(s => s.key === activeStage)) {
      activeStage = scheme.stages[0] ? scheme.stages[0].key : null;
    }
    $('#passScore').value = scheme.passScore;
    $('#gradeDecimals').value = scheme.decimals;
    renderScheme();
    renderTable();
    if (notify) toast('已刷新', 'ok');
  } catch (e) { toast('加载成绩册失败：' + e.message, 'err'); }
}

/* ---------------- 成绩构成编辑 ---------------- */
function renderScheme() {
  const box = $('#schemeEditor');
  const stages = scheme.stages || [];
  const items = scheme.items || [];
  const wSum = stages.reduce((a, b) => a + (Number(b.weight) || 0), 0);

  const stageRows = stages.map((s, i) => `
    <div class="scheme-row" data-kind="stage" data-idx="${i}">
      <span class="small muted" style="width:18px">${i + 1}</span>
      <input class="input sm" data-field="title" value="${escapeAttr(s.title)}" style="flex:1">
      <input class="input sm" data-field="weight" type="number" min="0" step="0.5" value="${s.weight}" style="width:74px">
      <button class="btn sm" data-act="del">删</button>
    </div>`).join('');

  const itemRows = items.map((s, i) => `
    <div class="scheme-row" data-kind="item" data-idx="${i}">
      <span class="small muted" style="width:18px">${i + 1}</span>
      <input class="input sm" data-field="title" value="${escapeAttr(s.title)}" style="flex:1">
      <input class="input sm" data-field="weight" type="number" min="0" step="1" value="${s.weight}" style="width:74px">
      <button class="btn sm" data-act="del">删</button>
    </div>`).join('');

  box.innerHTML = `
    <div class="small muted" style="margin:6px 0 2px">环节（实验/考核项）— 权重合计 ${round1(wSum)}</div>
    ${stageRows || '<div class="empty">还没有环节</div>'}
    <div class="small muted" style="margin:10px 0 2px">子项（每个环节内部）— 权重合计 ${round1(items.reduce((a, b) => a + (Number(b.weight) || 0), 0))}</div>
    ${itemRows || '<div class="empty">还没有子项</div>'}`;

  $('#schemeSummary').textContent =
    `${stages.length} 个环节 · ${items.length} 个子项 · 及格 ${scheme.passScore} 分 · 保留 ${scheme.decimals} 位小数`;
}

function escapeAttr(v) { return String(v == null ? '' : v).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function round1(v) { return String(Number((Number(v) || 0).toFixed(1))); }

function addRow(kind) {
  const list = kind === 'stage' ? scheme.stages : scheme.items;
  list.push({
    key: 'k' + Date.now().toString(36) + Math.floor(Math.random() * 100),
    title: kind === 'stage' ? '新环节' : '新子项',
    weight: kind === 'stage' ? 10 : 20
  });
  renderScheme();
}

function onSchemeClick(e) {
  const btn = e.target.closest('[data-act=del]');
  if (!btn) return;
  const row = btn.closest('.scheme-row');
  const kind = row.dataset.kind;
  const idx = Number(row.dataset.idx);
  const list = kind === 'stage' ? scheme.stages : scheme.items;
  if (list.length <= 1) return toast('至少保留一项', 'warn');
  list.splice(idx, 1);
  renderScheme();
}

async function saveScheme() {
  // 从 DOM 读回标题与权重（用户可能刚改过但没触发重新渲染）
  $$('#schemeEditor .scheme-row').forEach(row => {
    const kind = row.dataset.kind, idx = Number(row.dataset.idx);
    const list = kind === 'stage' ? scheme.stages : scheme.items;
    const title = row.querySelector('[data-field=title]').value.trim();
    const w = Number(row.querySelector('[data-field=weight]').value);
    if (list[idx]) { list[idx].title = title || list[idx].title; list[idx].weight = Math.max(0, w || 0); }
  });
  try {
    const r = await api('/api/gradebook/scheme', {
      method: 'POST',
      body: {
        name: '期末总评',
        passScore: Number($('#passScore').value) || 60,
        decimals: Number($('#gradeDecimals').value) || 0,
        stages: scheme.stages,
        items: scheme.items
      }
    });
    scheme = r.scheme;
    await load(false);
    toast('成绩方案已保存', 'ok');
  } catch (e) { toast('保存失败：' + e.message, 'err'); }
}

/* ---------------- 打分表 ---------------- */
function renderTable() {
  const box = $('#gradeTable');
  if (!students.length) { box.innerHTML = '<div class="empty">还没有学生。请先在「教师后台」导入名单。</div>'; return; }
  if (!activeStage) { box.innerHTML = '<div class="empty">请先添加成绩环节</div>'; return; }

  const stages = scheme.stages || [];
  const items = scheme.items || [];
  const stage = stages.find(s => s.key === activeStage) || stages[0];

  const stageOpts = stages.map(s =>
    `<option value="${escapeAttr(s.key)}"${s.key === activeStage ? ' selected' : ''}>${escapeAttr(s.title)}（权重 ${s.weight}）</option>`).join('');

  const head = items.map(it => `<th>${escapeAttr(it.title)}<br><span class="muted" style="font-weight:400">${it.weight}</span></th>`).join('');
  const body = students.map(st => {
    const cells = items.map(it => {
      const v = st.scores[`${stage.key}|${it.key}`];
      return `<td><input class="input sm score-in" data-user="${st.id}" data-stage="${escapeAttr(stage.key)}" data-item="${escapeAttr(it.key)}"
        type="number" min="0" max="100" step="1" value="${v == null ? '' : v}" style="width:62px"></td>`;
    }).join('');
    const ss = st.stageScores ? st.stageScores[stage.key] : null;
    return `<tr>
      <td>${escapeAttr(st.className || '')}</td>
      <td>${escapeAttr(st.studentNo || st.username)}</td>
      <td>${escapeAttr(st.name || '')}</td>
      ${cells}
      <td><b>${ss == null ? '—' : ss}</b></td>
      <td>${st.total == null ? '—' : st.total}</td>
      <td>${st.pass === null || st.pass === undefined ? '—' : (st.pass ? '<span class="pill ok">及格</span>' : '<span class="pill err">不及格</span>')}</td>
      <td><button class="btn sm" data-detail="${st.id}">详情</button></td>
    </tr>`;
  }).join('');

  box.innerHTML = `
    <div class="row" style="gap:10px;align-items:center;margin:4px 0 8px">
      <label class="small">当前环节</label>
      <select class="input sm" id="stageSelect" style="max-width:280px">${stageOpts}</select>
      <span class="small muted">输入 0–100，留空表示未评分</span>
    </div>
    <table class="data-table">
      <thead><tr><th>班级</th><th>学号</th><th>姓名</th>${head}<th>环节得分</th><th>总评</th><th>判定</th><th></th></tr></thead>
      <tbody>${body}</tbody></table>`;

  const sel = $('#stageSelect');
  if (sel) sel.addEventListener('change', () => { activeStage = sel.value; renderTable(); });
}

async function onScoreChange(e) {
  const inp = e.target.closest('.score-in');
  if (!inp) return;
  const body = {
    userId: Number(inp.dataset.user),
    stageKey: inp.dataset.stage,
    itemKey: inp.dataset.item,
    score: inp.value === '' ? '' : Number(inp.value)
  };
  try {
    await api('/api/gradebook/score', { method: 'POST', body });
    // 只重算当前行的汇总，避免整表重绘打断连续录入
    const r = await api('/api/gradebook');
    scheme = r.scheme;
    students = r.students || [];
    const keepScroll = box_scroll();
    renderTable();
    restore_scroll(keepScroll);
  } catch (err) { toast('保存分数失败：' + err.message, 'err'); }
}

function box_scroll() { const b = $('#gradeTable'); return b ? b.scrollTop : 0; }
function restore_scroll(v) { const b = $('#gradeTable'); if (b) b.scrollTop = v; }

function onTableClick(e) {
  const btn = e.target.closest('[data-detail]');
  if (!btn) return;
  const st = students.find(s => s.id === Number(btn.dataset.detail));
  if (st) showDetail(st);
}

function showDetail(st) {
  const stages = scheme.stages || [];
  const items = scheme.items || [];
  const lines = stages.map(s => {
    const ss = st.stageScores[s.key];
    const cells = items.map(it => {
      const v = st.scores[`${s.key}|${it.key}`];
      return `${it.title} ${v == null ? '—' : v}`;
    }).join('　');
    return `${s.title}（权重 ${s.weight}）：${ss == null ? '未评分' : ss}　｜　${cells}`;
  }).join('\n');
  const wrap = el('div', {}, [
    el('p', { text: `学生：${st.name || ''}　${st.studentNo || st.username}` }),
    el('pre', { class: 'small', style: 'white-space:pre-wrap;line-height:1.7;margin:0' , text: lines }),
    el('p', { class: 'small', text: `总评：${st.total == null ? '未评' : st.total}　${st.pass ? '及格' : (st.pass === false ? '不及格' : '')}` })
  ]);
  modal('成绩详情', wrap, [{ label: '关闭', primary: true }]);
}

/* ---------------- 导出 ---------------- */
function exportCsv() {
  if (!students.length) return toast('没有可导出的数据', 'warn');
  const stages = scheme.stages || [];
  const items = scheme.items || [];
  const head = ['班级', '学号', '姓名'];
  for (const s of stages) for (const it of items) head.push(`${s.title}-${it.title}`);
  head.push('总评', '是否及格');

  const lines = [head.join(',')];
  for (const st of students) {
    const row = [st.className || '', st.studentNo || st.username, st.name || ''];
    for (const s of stages) for (const it of items) {
      const v = st.scores[`${s.key}|${it.key}`];
      row.push(v == null ? '' : v);
    }
    row.push(st.total == null ? '' : st.total);
    row.push(st.pass == null ? '' : (st.pass ? '及格' : '不及格'));
    lines.push(row.join(','));
  }
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `成绩册_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.csv`;
  document.body.append(a); a.click(); a.remove();
  toast('已导出 CSV', 'ok');
}
