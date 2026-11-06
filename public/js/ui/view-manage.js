/*
 * view-manage.js — 实验任务（教师）
 * ------------------------------------------------------------------
 * 教师为某个实验发布"任务"：要求文本 + 起止时间 + 是否发布。
 * 系统记录每位学生"首次打开"与"提交"的时间，两者之差即该实验用时
 * （超出教师设定窗口的部分不计，避免学生挂着页面过夜把时长算进去）。
 */
import { $, el, api, toast, esc, modal, confirmBox } from './core.js';

let assignments = [];
let problems = [];
let currentId = null;
let progressRows = [];

export function init() {
  $('#btnNewAssignment').addEventListener('click', () => editAssignment(null));
  $('#btnRefreshAssignments').addEventListener('click', () => load(true));
  $('#assignmentList').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    const pick = e.target.closest('[data-pick]');
    if (edit) return editAssignment(assignments.find(a => a.id === Number(edit.dataset.edit)));
    if (del) return removeAssignment(Number(del.dataset.del));
    if (pick) return loadProgress(Number(pick.dataset.pick));
  });
}

export async function show() {
  await load(false);
}

async function load(notify) {
  try {
    const r = await api('/api/teacher/assignments');
    assignments = r.assignments || [];
    problems = r.problems || [];
    renderList();
    if (notify) toast('任务已刷新', 'ok');
  } catch (e) { toast('加载任务失败：' + e.message, 'err'); }
}

function fmtWindow(a) {
  const s = a.startAt || '不限', e = a.endAt || '不限';
  return `${esc(s)} ~ ${esc(e)}`;
}

function renderList() {
  const box = $('#assignmentList');
  if (!assignments.length) {
    box.innerHTML = '<div class="empty">还没有实验任务。点右上角「新建任务」发布第一个。</div>';
    return;
  }
  const rows = assignments.map(a => `
    <tr class="${a.id === currentId ? 'sel' : ''}">
      <td>${esc(a.title)}</td>
      <td class="muted small">${esc(a.problemId)}</td>
      <td class="small">${fmtWindow(a)}</td>
      <td>${a.published ? '<span class="pill ok">已发布</span>' : '<span class="pill">草稿</span>'}</td>
      <td class="row" style="gap:4px">
        <button class="btn sm" data-pick="${a.id}">完成情况</button>
        <button class="btn sm" data-edit="${a.id}">编辑</button>
        <button class="btn sm" data-del="${a.id}">删除</button>
      </td>
    </tr>`).join('');
  box.innerHTML = `<table class="data-table">
    <thead><tr><th>任务名称</th><th>实验</th><th>起止时间</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/* ---------------- 新建 / 编辑 ---------------- */
function editAssignment(a) {
  const isNew = !a;
  const wrap = el('div', { class: 'props-form' });

  const labP = el('label', {}, ['对应实验']);
  const selP = el('select', { class: 'input' });
  for (const p of problems) selP.append(el('option', { value: p.id, text: p.title }));
  if (a) selP.value = a.problemId;
  labP.append(selP); wrap.append(labP);

  const labT = el('label', {}, ['任务名称']);
  const inpT = el('input', { class: 'input', value: a ? a.title : '', placeholder: '如 实验一 流水灯（第 3 周）' });
  labT.append(inpT); wrap.append(labT);

  const labR = el('label', {}, ['实验要求（学生与 AI 助教都能看到）']);
  const taR = el('textarea', { class: 'import-box sm', placeholder: '例如：\n1. 用 P1 口实现 8 路流水灯，间隔 200ms；\n2. 必须使用 _crol_ 位移函数；\n3. 提交时附带原理图。' });
  taR.value = a ? a.requirement : '';
  labR.append(taR); wrap.append(labR);

  const labS = el('label', {}, ['开始时间']);
  const inpS = el('input', { class: 'input', type: 'datetime-local' });
  inpS.value = a && a.startAt ? a.startAt.replace(' ', 'T').slice(0, 16) : '';
  labS.append(inpS); wrap.append(labS);

  const labE = el('label', {}, ['结束时间']);
  const inpE = el('input', { class: 'input', type: 'datetime-local' });
  inpE.value = a && a.endAt ? a.endAt.replace(' ', 'T').slice(0, 16) : '';
  labE.append(inpE); wrap.append(labE);

  const labPub = el('label', { class: 'inline' }, []);
  const chkPub = el('input', { type: 'checkbox' });
  chkPub.checked = a ? !!a.published : true;
  labPub.append(chkPub, el('span', { text: ' 立即发布（不勾选则保存为草稿）' }));
  wrap.append(labPub);

  modal(isNew ? '新建实验任务' : '编辑实验任务', wrap, [
    { label: '取消' },
    {
      label: '保存', primary: true, onClick: async () => {
        const body = {
          id: a ? a.id : undefined,
          problemId: selP.value,
          title: inpT.value.trim(),
          requirement: taR.value,
          startAt: inpS.value ? inpS.value.replace('T', ' ') : '',
          endAt: inpE.value ? inpE.value.replace('T', ' ') : '',
          published: chkPub.checked
        };
        if (!body.title) { toast('请填写任务名称', 'warn'); return false; }
        try {
          await api('/api/teacher/assignments', { method: 'POST', body });
          toast(isNew ? '任务已创建' : '任务已更新', 'ok');
          await load(false);
        } catch (e) {
          toast('保存失败：' + e.message, 'err');
          return false;
        }
      }
    }
  ]);
}

async function removeAssignment(id) {
  const a = assignments.find(x => x.id === id);
  const ok = await confirmBox('删除实验任务', `将删除「${a ? a.title : id}」及其全部完成记录，且不可恢复。确定删除吗？`);
  if (!ok) return;
  try {
    await api(`/api/teacher/assignments/${id}/delete`, { method: 'POST' });
    toast('已删除', 'ok');
    if (currentId === id) { currentId = null; $('#progressTable').innerHTML = ''; $('#progressTitle').textContent = '选择左侧任务查看'; }
    await load(false);
  } catch (e) { toast('删除失败：' + e.message, 'err'); }
}

/* ---------------- 完成情况 ---------------- */
async function loadProgress(id) {
  currentId = id;
  renderList();
  try {
    const r = await api(`/api/teacher/assignments/${id}/progress`);
    progressRows = r.rows || [];
    const a = r.assignment;
    $('#progressTitle').textContent = a.title + '（' + a.problemId + '）';
    renderProgress();
  } catch (e) { toast('加载完成情况失败：' + e.message, 'err'); }
}

function renderProgress() {
  const box = $('#progressTable');
  if (!progressRows.length) { box.innerHTML = '<div class="empty">还没有学生账号。请先在「教师后台」导入名单。</div>'; return; }
  const done = progressRows.filter(r => r.submittedAt).length;
  const avg = (() => {
    const m = progressRows.map(r => r.minutes).filter(v => v != null);
    return m.length ? (m.reduce((a, b) => a + b, 0) / m.length).toFixed(1) : '—';
  })();
  const rows = progressRows.map(r => `
    <tr>
      <td>${esc(r.className || '')}</td>
      <td>${esc(r.studentNo || r.username)}</td>
      <td>${esc(r.name || '')}</td>
      <td class="small">${r.openedAt ? esc(r.openedAt) : '<span class="muted">未打开</span>'}</td>
      <td class="small">${r.submittedAt ? esc(r.submittedAt) : '<span class="muted">未提交</span>'}</td>
      <td>${r.minutes != null ? r.minutes + ' 分钟' : '—'}</td>
      <td>${r.submittedAt ? '<span class="pill ok">已提交</span>' : (r.openedAt ? '<span class="pill warn">进行中</span>' : '<span class="pill">未开始</span>')}</td>
    </tr>`).join('');
  box.innerHTML = `<div class="small muted" style="padding:4px 0">
      已提交 ${done} / ${progressRows.length} 人，平均用时 ${avg} 分钟
    </div>
    <table class="data-table">
      <thead><tr><th>班级</th><th>学号</th><th>姓名</th><th>首次打开</th><th>提交时间</th><th>用时</th><th>状态</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
}
