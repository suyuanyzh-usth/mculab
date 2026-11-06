/*
 * view-problems.js — 实验题目视图
 * 左侧题目列表（可搜索），右侧题目详情（实验目的/接线要求/现象/评分点）。
 */
import { $, el, api, state, toast, md, bus, esc, setView } from './core.js';

let loaded = false;

export function init() {
  $('#problemSearch').addEventListener('input', renderList);
  $('#problemDetail').addEventListener('click', onDetailClick);
}

export async function show() {
  if (!loaded) await reload();
  else renderList();
  await loadAssignments();
  if (state.problem) renderAssignBanner(state.problem.id);
}

export async function reload() {
  try {
    const r = await api('/api/problems');
    state.problems = r.problems || [];
    loaded = true;
    renderList();
    if (!state.problem && state.problems.length) selectProblem(state.problems[0].id);
    else if (state.problem) selectProblem(state.problem.id);
  } catch (e) {
    if (state.offline) {
      // 离线启动：不弹错误，直接在列表位置给出可执行指引
      $('#problemList').innerHTML = '<div class="empty">当前离线，题目列表暂不可用。<br>已加载过的页面、原理图与仿真仍可继续；<br>网络恢复后会自动刷新。</div>';
      return;
    }
    toast('题目加载失败：' + e.message, 'err');
  }
}

function diffClass(d) {
  if (/基础/.test(d)) return 'basic';
  if (/进阶/.test(d)) return 'mid';
  return 'adv';
}

function renderList() {
  const kw = ($('#problemSearch').value || '').trim().toLowerCase();
  const list = $('#problemList');
  list.innerHTML = '';
  const items = state.problems.filter(p =>
    !kw || (p.title + ' ' + (p.chapter || '') + ' ' + (p.statement || '')).toLowerCase().includes(kw));

  if (!items.length) { list.innerHTML = '<div class="empty">没有匹配的题目</div>'; return; }

  for (const p of items) {
    const node = el('div', {
      class: 'problem-item' + (state.problem && state.problem.id === p.id ? ' active' : ''),
      dataset: { id: p.id }
    }, [
      el('div', { class: 'pi-top' }, [
        el('span', { class: 'pi-title', text: p.title }),
        p.solved ? el('span', { class: 'tag done', text: '已通过' }) : null
      ]),
      el('div', { class: 'pi-meta' }, [
        el('span', { class: 'tag ' + diffClass(p.difficulty), text: p.difficulty || '—' }),
        el('span', { text: p.chapter || '' })
      ])
    ]);
    node.addEventListener('click', () => selectProblem(p.id));
    list.append(node);
  }
}

function selectProblem(id) {
  const p = state.problems.find(x => x.id === id);
  if (!p) return;
  state.problem = p;
  renderList();

  const tests = Array.isArray(p.tests) ? p.tests : [];
  const box = $('#problemDetail');
  box.innerHTML = `
    <h3 style="font-size:15px;margin-bottom:2px">${esc(p.title)}</h3>
    <div class="small muted" style="margin-bottom:10px">${esc(p.chapter || '')} · 难度 ${esc(p.difficulty || '')}</div>
    ${md(p.statement || '')}
    <h3 style="margin-top:16px">评分要点</h3>
    <ul>${tests.map(t => `<li>${esc(t.desc || t.kind)}</li>`).join('') || '<li class="muted">—</li>'}</ul>
    <div class="row wrap" style="margin-top:16px;gap:8px">
      <button class="btn primary sm" id="pdLoadStarter">载入起始代码并打开 IDE</button>
      <button class="btn sm" id="pdLoadPreset">载入对应预设电路</button>
      <button class="btn sm" id="pdOpenSim">直接进入仿真</button>
    </div>
    <p class="small muted" style="margin-top:10px">建议流程：读题 → 载入起始代码 → 编写/编译 → 载入预设电路 → 仿真观察 → 用仪器看时序 → 生成实验报告。</p>
  `;
  renderAssignBanner(p.id);
}

/* ================================================================ 实验任务横幅
 * 教师发布的实验要求会出现在题目详情上方；「开始实验」记录首次打开时间，
 * 「提交本次实验」记录结束时间，两者之差即教师端看到的用时。
 */
let myAssignments = [];

async function loadAssignments() {
  try {
    const r = await api('/api/assignments');
    myAssignments = r.assignments || [];
  } catch { myAssignments = []; }
}

function renderAssignBanner(problemId) {
  const box = $('#assignBanner');
  if (!box) return;
  const a = myAssignments.find(x => x.problemId === problemId && (x.published || x.published === undefined));
  if (!a) { box.classList.add('hidden'); box.innerHTML = ''; return; }

  const now = Date.now();
  const inWindow = a.open;
  const status = a.submittedAt ? '已提交' : (a.openedAt ? '进行中' : '未开始');
  box.className = 'assign-banner' + (inWindow ? '' : ' closed');
  box.innerHTML = `
    <h4>📌 实验任务：${esc(a.title)}</h4>
    ${a.requirement ? `<div class="req">${esc(a.requirement)}</div>` : '<div class="req muted">教师未填写额外要求，按题目说明完成。</div>'}
    <div class="meta">
      时间窗口：${a.startAt ? esc(a.startAt) : '不限'} ~ ${a.endAt ? esc(a.endAt) : '不限'}
      ${inWindow ? '' : '　<span style="color:#c0392b">（当前不在开放时间内）</span>'}
    </div>
    <div class="meta">
      状态：${status}${a.openedAt ? '　开始 ' + esc(a.openedAt) : ''}${a.submittedAt ? '　提交 ' + esc(a.submittedAt) : ''}${a.minutes != null ? '　用时 ' + a.minutes + ' 分钟' : ''}
    </div>
    <div class="row wrap">
      <button class="btn primary sm" id="btnAssignStart" ${inWindow ? '' : 'disabled'}>${a.openedAt ? '继续实验（进入 IDE）' : '开始实验'}</button>
      <button class="btn sm" id="btnAssignSubmit" ${a.submittedAt || !a.openedAt ? 'disabled' : ''}>${a.submittedAt ? '已提交' : '提交本次实验'}</button>
    </div>`;

  const bs = $('#btnAssignStart');
  if (bs) bs.onclick = async () => {
    try {
      await api(`/api/assignments/${a.id}/open`, { method: 'POST' });
      await loadAssignments();
      renderAssignBanner(problemId);
      setView('ide');
      toast('已开始计时，进入 IDE', 'ok');
    } catch (e) { toast('开始失败：' + e.message, 'err'); }
  };

  const bb = $('#btnAssignSubmit');
  if (bb) bb.onclick = async () => {
    try {
      const r = await api(`/api/assignments/${a.id}/submit`, { method: 'POST' });
      await loadAssignments();
      renderAssignBanner(problemId);
      toast('已提交，本次用时 ' + (r.minutes != null ? r.minutes + ' 分钟' : '—'), 'ok', 5000);
    } catch (e) { toast('提交失败：' + e.message, 'err'); }
  };
}

async function onDetailClick(e) {
  const t = e.target;
  if (!t.id) return;
  const p = state.problem;
  if (!p) return;

  if (t.id === 'pdLoadStarter') {
    state.code = p.starter || '';
    state.pendingProblem = p.id;
    try { localStorage.setItem('mculab.code.' + p.id, p.starter || ''); } catch { }
    setView('ide');
    bus.emit('ide-load-code', { code: p.starter || '', problemId: p.id, filename: p.id + '.c' });
    return;
  }
  if (t.id === 'pdLoadPreset') {
    setView('circuit');
    bus.emit('circuit-load-preset', { preset: p.preset, problemId: p.id });
    return;
  }
  if (t.id === 'pdOpenSim') {
    setView('sim');
    bus.emit('sim-focus', { problemId: p.id });
  }
}
