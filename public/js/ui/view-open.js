/*
 * view-open.js — 开放性命题
 * ------------------------------------------------------------------
 * 教师自由出题（不绑定内置实验）；学生提交「原理图 + 代码 + 报告」三件套；
 * 教师给一个总分并写评语（开放题不拆子项——评分标准随题目而变）。
 *
 * 同一个视图按角色切换：教师看到"出题 + 收作业 + 打分"，学生看到"看题 + 交作业"。
 */
import { $, el, api, state, toast, esc, md, modal, confirmBox, bus, setView } from './core.js';

let problems = [];
let activeId = null;
let detailCache = null;

export function init() {
  $('#btnNewOpen').addEventListener('click', () => editProblem(null));
  $('#btnRefreshOpen').addEventListener('click', () => load(true));
  $('#openList').addEventListener('click', (e) => {
    const item = e.target.closest('[data-oid]');
    if (item) openProblem(Number(item.dataset.oid));
  });
  $('#openDetail').addEventListener('click', onDetailClick);
}

export async function show() {
  await load(false);
}

async function load(notify) {
  try {
    const r = await api('/api/open-problems');
    problems = r.problems || [];
    renderList();
    if (activeId && problems.some(p => p.id === activeId)) await openProblem(activeId);
    if (notify) toast('已刷新', 'ok');
  } catch (e) { toast('加载失败：' + e.message, 'err'); }
}

function renderList() {
  const box = $('#openList');
  if (!problems.length) {
    box.innerHTML = '<div class="empty">还没有开放题。' + (isTeacher() ? '点右上角「新建命题」。' : '等待教师发布。') + '</div>';
    return;
  }
  box.innerHTML = problems.map(p => {
    const sub = p.submission;
    const badge = isTeacher()
      ? (p.published ? '<span class="pill ok">已发布</span>' : '<span class="pill">草稿</span>')
      : (sub ? (sub.score != null ? `<span class="pill graded">${sub.score} 分</span>` : '<span class="pill warn">已提交</span>') : '<span class="pill">未提交</span>');
    return `<div class="problem-item${p.id === activeId ? ' active' : ''}" data-oid="${p.id}">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:6px">
        <b>${esc(p.title)}</b>${badge}
      </div>
      <div class="small muted">${p.startAt ? esc(p.startAt) : '不限'} ~ ${p.endAt ? esc(p.endAt) : '不限'}</div>
    </div>`;
  }).join('');
}

const isTeacher = () => state.user && state.user.role === 'teacher';

async function openProblem(id) {
  activeId = id;
  renderList();
  try {
    const r = await api(`/api/open-problems/${id}/mine`);
    detailCache = r;
    const p = r.problem;
    $('#openTitle').textContent = p.title;
    $('#openMeta').textContent = isTeacher()
      ? (p.published ? '已发布' : '草稿')
      : (p.submission ? (p.submission.score != null ? '已评分：' + p.submission.score + ' 分' : '已提交，待教师评分') : '未提交');
    renderDetail(r);
  } catch (e) {
    $('#openDetail').innerHTML = '<p class="muted">加载失败：' + esc(e.message) + '</p>';
  }
}

function renderDetail(r) {
  const p = r.problem;
  const box = $('#openDetail');
  const head = `
    <div class="small muted" style="margin-bottom:8px">
      时间窗口：${p.startAt ? esc(p.startAt) : '不限'} ~ ${p.endAt ? esc(p.endAt) : '不限'}
    </div>
    ${p.statement ? md(p.statement) : '<p class="muted">（教师未填写题目说明）</p>'}`;

  if (isTeacher()) {
    box.innerHTML = head + `
      <div class="row wrap" style="margin:12px 0;gap:8px">
        <button class="btn primary sm" id="btnOpenSubs">收作业 / 打分</button>
        <button class="btn sm" id="btnEditOpen">编辑命题</button>
        <button class="btn sm" id="btnDelOpen">删除</button>
      </div>
      <div id="subsBox"></div>`;
    return;
  }

  const sub = r.submission;
  box.innerHTML = head + `
    <div class="open-sub-block">
      <h4>① 原理图</h4>
      <div class="row wrap" style="gap:8px">
        <button class="btn sm" id="btnGrabSch">取用当前原理图</button>
        <span class="small muted" id="schState">${sub && sub.schematic ? '已有提交内容' : '尚未取用'}</span>
      </div>
    </div>
    <div class="open-sub-block">
      <h4>② 程序代码</h4>
      <div class="row wrap" style="gap:8px;margin-bottom:6px">
        <button class="btn sm" id="btnGrabCode">取用当前 IDE 代码</button>
        <span class="small muted" id="codeState">${sub && sub.code ? '已有提交内容' : '尚未取用'}</span>
      </div>
      <textarea id="openCode" class="import-box" placeholder="可直接粘贴，或点上面按钮取用 IDE 中的代码">${esc(sub ? sub.code : '')}</textarea>
    </div>
    <div class="open-sub-block">
      <h4>③ 实验报告</h4>
      <textarea id="openReport" class="import-box" placeholder="设计思路、关键电路、遇到的问题与解决、结论">${esc(sub ? sub.report : '')}</textarea>
    </div>
    ${sub && sub.score != null ? `<div class="open-sub-block" style="background:#f6fbf7;border-color:#cfe9d8">
        <h4>教师评分</h4>
        <div><b style="font-size:16px">${sub.score} 分</b></div>
        <div class="small" style="white-space:pre-wrap;margin-top:4px">${esc(sub.comment || '（无评语）')}</div>
      </div>` : ''}
    <div class="row wrap" style="gap:8px;margin-top:12px">
      <button class="btn primary" id="btnSubmitOpen">${sub ? '更新提交' : '提交作业'}</button>
      <span class="small muted">${sub && sub.submittedAt ? '上次提交：' + esc(sub.submittedAt) : ''}</span>
    </div>`;

  // 暂存取用的原理图
  if (sub && sub.schematic) state.__openSchematic = sub.schematic;
}

function onDetailClick(e) {
  const t = e.target;
  if (t.id === 'btnGrabSch') return grabSchematic();
  if (t.id === 'btnGrabCode') return grabCode();
  if (t.id === 'btnSubmitOpen') return submitOpen();
  if (t.id === 'btnOpenSubs') return teacherListSubs(activeId);
  if (t.id === 'btnEditOpen') return editProblem(problems.find(p => p.id === activeId));
  if (t.id === 'btnDelOpen') return deleteProblem(activeId);
  if (t.dataset && t.dataset.grade) return teacherGrade(Number(t.dataset.grade));
  if (t.dataset && t.dataset.view) return teacherViewSub(Number(t.dataset.view));
}

/* ---------------- 学生：取用工作区内容 ---------------- */
function grabSchematic() {
  const sch = state.sch;
  if (!sch || !sch.parts || !sch.parts.length) return toast('原理图还是空的，请先在「原理图」页搭好电路', 'warn');
  const data = {
    parts: sch.parts.map(p => ({ type: p.type, x: p.x, y: p.y, rot: p.rot, props: p.props })),
    wires: sch.wires.map(w => ({ vertices: w.vertices.map(v => ({ x: v.x, y: v.y, comp: v.comp, pin: v.pin })) }))
  };
  state.__openSchematic = JSON.stringify(data);
  const el2 = $('#schState');
  if (el2) el2.textContent = `已取用：${data.parts.length} 个元件、${data.wires.length} 条导线`;
  toast('已取用当前原理图', 'ok');
}

function grabCode() {
  const code = state.code || (state.cm ? state.cm.getValue() : '');
  if (!code || !code.trim()) return toast('Editor 里还没有代码', 'warn');
  const ta = $('#openCode');
  if (ta) ta.value = code;
  const el2 = $('#codeState');
  if (el2) el2.textContent = '已取用（' + code.split('\n').length + ' 行）';
  toast('已取用 IDE 代码', 'ok');
}

async function submitOpen() {
  const code = ($('#openCode') || {}).value || '';
  const report = ($('#openReport') || {}).value || '';
  const schematic = state.__openSchematic || '';
  if (!code.trim() && !report.trim() && !schematic.trim()) return toast('请至少提交一项内容', 'warn');
  try {
    await api(`/api/open-problems/${activeId}/submit`, { method: 'POST', body: { code, report, schematic } });
    toast('已提交', 'ok');
    await load(false);
  } catch (e) { toast('提交失败：' + e.message, 'err'); }
}

/* ---------------- 教师：出题 ---------------- */
function editProblem(p) {
  const isNew = !p;
  const wrap = el('div', { class: 'props-form' });

  const labT = el('label', {}, ['命题名称']);
  const inpT = el('input', { class: 'input', value: p ? p.title : '', placeholder: '如 期末开放设计：智能交通灯' });
  labT.append(inpT); wrap.append(labT);

  const labS = el('label', {}, ['题目说明（支持 Markdown）']);
  const taS = el('textarea', { class: 'import-box', placeholder: '功能要求、约束条件、评分关注点…' });
  taS.value = p ? p.statement : '';
  labS.append(taS); wrap.append(labS);

  const labA = el('label', {}, ['开始时间']);
  const inpA = el('input', { class: 'input', type: 'datetime-local' });
  inpA.value = p && p.startAt ? p.startAt.replace(' ', 'T').slice(0, 16) : '';
  labA.append(inpA); wrap.append(labA);

  const labB = el('label', {}, ['结束时间']);
  const inpB = el('input', { class: 'input', type: 'datetime-local' });
  inpB.value = p && p.endAt ? p.endAt.replace(' ', 'T').slice(0, 16) : '';
  labB.append(inpB); wrap.append(labB);

  const labP = el('label', { class: 'inline' }, []);
  const chk = el('input', { type: 'checkbox' });
  chk.checked = p ? !!p.published : true;
  labP.append(chk, el('span', { text: ' 发布给学生' }));
  wrap.append(labP);

  modal(isNew ? '新建开放题' : '编辑开放题', wrap, [
    { label: '取消' },
    {
      label: '保存', primary: true, onClick: async () => {
        if (!inpT.value.trim()) { toast('请填写命题名称', 'warn'); return false; }
        try {
          await api('/api/teacher/open-problems', {
            method: 'POST',
            body: {
              id: p ? p.id : undefined,
              title: inpT.value.trim(),
              statement: taS.value,
              startAt: inpA.value ? inpA.value.replace('T', ' ') : '',
              endAt: inpB.value ? inpB.value.replace('T', ' ') : '',
              published: chk.checked
            }
          });
          toast(isNew ? '已创建' : '已更新', 'ok');
          await load(false);
        } catch (e) { toast('保存失败：' + e.message, 'err'); return false; }
      }
    }
  ]);
}

async function deleteProblem(id) {
  const ok = await confirmBox('删除开放题', '将同时删除所有学生的提交，且不可恢复。确定删除吗？');
  if (!ok) return;
  try {
    await api(`/api/teacher/open-problems/${id}/delete`, { method: 'POST' });
    activeId = null;
    $('#openDetail').innerHTML = '<p class="muted">已删除。</p>';
    $('#openTitle').textContent = '命题详情';
    toast('已删除', 'ok');
    await load(false);
  } catch (e) { toast('删除失败：' + e.message, 'err'); }
}

/* ---------------- 教师：收作业与打分 ---------------- */
async function teacherListSubs(problemId) {
  const box = $('#subsBox');
  if (!box) return;
  box.innerHTML = '<div class="small muted">加载中…</div>';
  try {
    const r = await api(`/api/teacher/open-problems/${problemId}/submissions`);
    if (!r.rows.length) {
      box.innerHTML = `<div class="empty">还没有学生提交（班级共 ${r.totalStudents} 人）。</div>`;
      return;
    }
    const rows = r.rows.map(s => `
      <tr>
        <td>${esc(s.className || '')}</td>
        <td>${esc(s.studentNo || s.username)}</td>
        <td>${esc(s.name || '')}</td>
        <td class="small">${esc(s.submittedAt || '')}</td>
        <td class="small">${[s.hasSchematic ? '图' : '', s.hasCode ? '码' : '', s.hasReport ? '报' : ''].filter(Boolean).join(' ') || '—'}</td>
        <td><b>${s.score == null ? '—' : s.score}</b></td>
        <td class="row" style="gap:4px">
          <button class="btn sm" data-view="${s.id}">查看</button>
          <button class="btn sm" data-grade="${s.id}">打分</button>
        </td>
      </tr>`).join('');
    box.innerHTML = `
      <div class="small muted">已交 ${r.rows.length} / ${r.totalStudents} 人</div>
      <table class="data-table">
        <thead><tr><th>班级</th><th>学号</th><th>姓名</th><th>提交时间</th><th>材料</th><th>分数</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
  } catch (e) {
    box.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>';
  }
}

async function teacherViewSub(subId) {
  try {
    const r = await api(`/api/teacher/open-submissions/${subId}`);
    let schInfo = '未提交原理图';
    let schCount = 0;
    if (r.schematic) {
      try {
        const d = JSON.parse(r.schematic);
        schCount = (d.parts || []).length;
        schInfo = `${schCount} 个元件、${(d.wires || []).length} 条导线`;
      } catch { schInfo = '原理图数据无法解析'; }
    }
    const wrap = el('div', { class: 'md' });
    wrap.innerHTML = `
      <p class="small muted">${esc(r.title)} · ${esc(r.name || r.username)} · 提交于 ${esc(r.submittedAt || '')}</p>
      <h4>原理图</h4>
      <p class="small">${esc(schInfo)}</p>
      ${schCount ? '<button class="btn sm" id="openSchInEditor">在原理图编辑器中打开</button>' : ''}
      <h4>代码</h4>
      <pre class="small" style="white-space:pre-wrap;max-height:260px;overflow:auto">${esc(r.code || '（未提交）')}</pre>
      <h4>报告</h4>
      <div class="small" style="white-space:pre-wrap;max-height:220px;overflow:auto">${esc(r.report || '（未提交）')}</div>`;
    modal('查看提交', wrap, [{ label: '关闭', primary: true }]);
    const btn = $('#openSchInEditor');
    if (btn) btn.onclick = () => {
      try {
        const d = JSON.parse(r.schematic);
        bus.emit('circuit-load-data', { data: d });
        closeAll();
        setView('circuit');
      } catch { toast('原理图数据无法解析', 'err'); }
    };
  } catch (e) { toast('加载失败：' + e.message, 'err'); }
}

function closeAll() {
  const m = $('#modal');
  if (m) m.classList.add('hidden');
}

async function teacherGrade(subId) {
  let cur = { score: '', comment: '' };
  try {
    const r = await api(`/api/teacher/open-submissions/${subId}`);
    cur = { score: r.score == null ? '' : r.score, comment: r.comment || '' };
  } catch { }

  const wrap = el('div', { class: 'props-form' });
  const labS = el('label', {}, ['总分（0–100）']);
  const inpS = el('input', { class: 'input', type: 'number', min: '0', max: '100', value: cur.score });
  labS.append(inpS); wrap.append(labS);

  const labC = el('label', {}, ['评语']);
  const taC = el('textarea', { class: 'import-box', placeholder: '做得好的地方、需要改进的地方…' });
  taC.value = cur.comment;
  labC.append(taC); wrap.append(labC);

  modal('打分与评语', wrap, [
    { label: '取消' },
    {
      label: '保存', primary: true, onClick: async () => {
        try {
          await api(`/api/teacher/open-submissions/${subId}/grade`, {
            method: 'POST',
            body: { score: inpS.value === '' ? '' : Number(inpS.value), comment: taC.value }
          });
          toast('已保存评分', 'ok');
          if (activeId) teacherListSubs(activeId);
        } catch (e) { toast('保存失败：' + e.message, 'err'); return false; }
      }
    }
  ]);
}
