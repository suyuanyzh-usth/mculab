/*
 * view-teacher.js — 教师后台
 * 班级-学生批量导入、学情监测（练习次数/通过率/提问）、单生密码重置、
 * AI 学情分析、大模型与平台设置、学生提问处理。
 */
import { $, el, api, state, toast, esc, md, modal, closeModal, confirmBox, promptBox } from './core.js';

let students = [], classes = [], stats = null, classFilter = '';
let tq = [];

export function init() {
  $('#btnRefreshStats').addEventListener('click', () => loadStats(true));
  $('#classFilter').addEventListener('change', () => { classFilter = $('#classFilter').value; renderTable(); });
  $('#btnExportCsv').addEventListener('click', exportCsv);
  $('#btnAnalyzeClass').addEventListener('click', analyze);
  const be = $('#btnRefreshErrors'); if (be) be.addEventListener('click', () => loadErrors(true));
  // AI 知识库
  const bk = $('#btnKbPaste'); if (bk) bk.addEventListener('click', pasteKbDoc);
  const kf = $('#kbFile'); if (kf) kf.addEventListener('change', uploadKbFiles);
  const kd = $('#kbDocs'); if (kd) kd.addEventListener('click', (e) => {
    const d = e.target.closest('[data-kbdel]');
    if (d) deleteKbDoc(Number(d.dataset.kbdel));
  });
  const bw = $('#btnSaveWebSearch'); if (bw) bw.addEventListener('click', saveWebSearch);
  $('#btnImport').addEventListener('click', doImport);
  $('#btnSaveLLM').addEventListener('click', saveLLM);
  const preset = $('#llmPreset');
  if (preset) preset.addEventListener('change', () => applyLlmPreset(preset.value));
  $('#btnTestLLM').addEventListener('click', testLLM);
  $('#btnSavePlatform').addEventListener('click', savePlatform);
  const bc = $('#btnCopyInvite'); if (bc) bc.addEventListener('click', copyInvite);
  const br = $('#btnRegenInvite'); if (br) br.addEventListener('click', regenInvite);
  $('#btnRefreshTeacherQA').addEventListener('click', loadTeacherQA);
  $('#teacherQuestionList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-qid]');
    if (b) answerQuestion(Number(b.dataset.qid));
  });
  $('#studentTable').addEventListener('click', onTableClick);
}

export async function show() {
  await Promise.all([loadStudents(), loadStats(), loadSettings(), loadTeacherQA()]);
}

/* ================================================================ 数据 */
async function loadStudents() {
  try {
    const r = await api('/api/teacher/students');
    students = r.students || []; classes = r.classes || [];
    renderClassFilter(); renderTable();
  } catch (e) { toast('学生名单加载失败：' + e.message, 'err'); }
}

async function loadStats(announce = false) {
  try {
    stats = await api('/api/teacher/stats');
    renderCards();
    renderTable();
    if (announce) toast('已刷新', 'ok');
  } catch (e) { toast('统计加载失败：' + e.message, 'err'); }
}

async function loadSettings() {
  try {
    const s = await api('/api/settings');
    const l = s.llm || {};
    $('#llmEnabled').checked = !!l.enabled;
    $('#llmBaseUrl').value = l.baseUrl || '';
    $('#llmModel').value = l.model || '';
    $('#llmSystemExtra').value = l.systemExtra || '';
    $('#llmApiKey').value = '';
    $('#llmApiKey').placeholder = l.hasKey ? '已配置（留空表示不修改）' : '未配置，请填入 API 密钥';
    // 注意：接口返回的是 { llm, platform } 嵌套结构。
    // 早期这里写的是 s.requireRoster（永远 undefined），
    // 导致勾选框始终显示"未勾选"，教师一保存就把名单校验关掉了。
    loadInvite();
    loadErrors(false);
    loadKbDocs();
    loadWebSearchCfg();

    const pf = s.platform || {};
    $('#chkRequireRoster').checked = pf.requireRoster !== false;
    $('#chkAllowRegister').checked = pf.allowSelfRegister !== false;
    $('#siteNameInput').value = pf.siteName || '';
    $('#announceInput').value = pf.announce || '';
  } catch (e) { toast('设置加载失败：' + e.message, 'err'); }
}

async function loadTeacherQA() {
  try {
    const r = await api('/api/teacher/questions');
    tq = r.questions || [];
    const box = $('#teacherQuestionList');
    if (!tq.length) { box.innerHTML = '<div class="empty">暂无学生提问</div>'; return; }
    box.innerHTML = tq.slice(0, 60).map(q => `
      <div class="qa-item" data-qid="${q.id}">
        <div class="qt">${esc(q.title)}</div>
        <div class="qm">
          <span class="tag ${q.status === 'answered' ? 'basic' : 'mid'}">${q.status === 'answered' ? '已答复' : '待答复'}</span>
          <span>${esc(q.uname || '')} ${esc(q.student_no || '')}</span>
          <span>${q.answers || 0} 条</span>
        </div>
      </div>`).join('');
  } catch (e) { /* 忽略 */ }
}

/* ================================================================ 渲染 */
function renderClassFilter() {
  const sel = $('#classFilter');
  sel.innerHTML = '<option value="">全部班级</option>';
  for (const c of classes) sel.append(el('option', { value: c.class_name, text: `${c.class_name}（${c.n}）` }));
  sel.value = classFilter;
}

function renderCards() {
  const box = $('#statsCards');
  if (!stats) { box.innerHTML = ''; return; }
  const st = stats.students || [];
  const totalAttempts = st.reduce((a, b) => a + (b.attempts || 0), 0);
  const active = st.filter(s => s.attempts > 0).length;
  const solvedAll = st.filter(s => (s.solved || 0) >= 10).length;
  const qs = st.reduce((a, b) => a + (b.questions || 0), 0);
  const cards = [
    ['学生总数', st.length],
    ['已练习', active],
    ['练习总次数', totalAttempts],
    ['完成 ≥10 个实验', solvedAll],
    ['学生提问', qs]
  ];
  box.innerHTML = cards.map(([l, v]) => `<div class="stat-card"><div class="sv">${v}</div><div class="sl">${l}</div></div>`).join('')
    + `<div class="stat-card"><div class="sv">${stats.problems?.[0]?.problem_id ? esc(shortTitle(stats.problems[0].problem_id)) : '—'}</div><div class="sl">最常练习的实验</div></div>`;
}

function shortTitle(pid) {
  const p = state.problems.find(x => x.id === pid);
  return p ? p.title.replace(/^实验[一二三四五六七八九十]+ /, '') : pid;
}

function renderTable() {
  const tb = $('#studentTable');
  const rows = students.filter(s => !classFilter || s.class_name === classFilter);
  const stMap = new Map((stats?.students || []).map(s => [s.id, s]));
  tb.innerHTML = `
    <thead><tr>
      <th>学号</th><th>姓名</th><th>班级</th>
      <th style="text-align:right">练习</th><th style="text-align:right">通过</th>
      <th style="width:110px">完成实验</th><th style="text-align:right">提问</th>
      <th>最近活动</th><th>状态</th><th>操作</th>
    </tr></thead>
    <tbody>${rows.map(s => {
      const x = stMap.get(s.id) || {};
      const solved = x.solved || 0;
      const pct = Math.min(100, Math.round(solved / 15 * 100));
      return `<tr>
        <td>${esc(s.student_no || s.username)}</td>
        <td>${esc(s.name || '')}</td>
        <td>${esc(s.class_name || '')}</td>
        <td class="num">${x.attempts || 0}</td>
        <td class="num">${x.ok_count || 0}</td>
        <td><div class="bar" title="${solved}/15"><i style="width:${pct}%"></i></div><span class="small muted">${solved}/15</span></td>
        <td class="num">${x.questions || 0}</td>
        <td class="small">${x.last_attempt ? fmtShort(x.last_attempt) : (s.last_login ? fmtShort(s.last_login) : '—')}</td>
        <td>${s.active ? '<span class="tag basic">正常</span>' : '<span class="tag">停用</span>'}</td>
        <td>
          <button class="btn sm" data-act="pwd" data-id="${s.id}">改密</button>
          <button class="btn sm" data-act="toggle" data-id="${s.id}">${s.active ? '停用' : '启用'}</button>
        </td>
      </tr>`;
    }).join('')}</tbody>`;
  if (!rows.length) tb.innerHTML = '<tbody><tr><td colspan="10" class="empty">还没有学生。请在右侧「批量导入学生」中粘贴名单。</td></tr></tbody>';
}

function fmtShort(t) {
  if (!t) return '—';
  const d = new Date(String(t).replace(' ', 'T'));
  return isNaN(d) ? String(t) : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/* ================================================================ 操作 */
async function onTableClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const stu = students.find(s => s.id === id);
  if (!stu) return;
  if (btn.dataset.act === 'pwd') {
    const r = await promptBox('重置学生密码', [
      { name: 'pwd', label: `${stu.name || stu.username} 的新密码`, value: '123456' }
    ]);
    if (!r || !r.pwd) return;
    try {
      await api(`/api/teacher/students/${id}/password`, { method: 'POST', body: { password: r.pwd, mustChange: true } });
      toast('密码已重置（该生下次登录需修改）', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  }
  if (btn.dataset.act === 'toggle') {
    try {
      await api(`/api/teacher/students/${id}/toggle`, { method: 'POST', body: { active: !stu.active } });
      await loadStudents();
      toast(stu.active ? '已停用' : '已启用', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  }
}

async function doImport() {
  const text = $('#importText').value;
  if (!text.trim()) return toast('请先粘贴名单', 'warn');
  const btn = $('#btnImport');
  btn.classList.add('busy');
  try {
    const r = await api('/api/teacher/students/import', {
      method: 'POST',
      body: {
        text,
        defaultPassword: $('#importDefaultPwd').value || '123456',
        resetExisting: $('#chkResetExisting').checked
      }
    });
    const x = r.result;
    $('#importResult').innerHTML = `
      <div class="diag-item ok"><b>导入完成</b>
        新建 ${x.created} 人 · 更新 ${x.updated} 人 · 跳过 ${x.skipped} 人
        ${x.errors?.length ? `<div class="err small">${x.errors.length} 条错误：${esc(x.errors.slice(0, 3).join('; '))}</div>` : ''}
      </div>`;
    toast(`导入完成：新增 ${x.created} 人`, 'ok');
    await loadStudents(); await loadStats();
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.classList.remove('busy'); }
}

async function analyze() {
  const btn = $('#btnAnalyzeClass');
  btn.classList.add('busy');
  $('#analysisOut').innerHTML = '<span class="muted">分析中…（离线模式为即时生成）</span>';
  try {
    const r = await api('/api/teacher/analyze', { method: 'POST', body: {} });
    $('#analysisOut').innerHTML = md(r.content || '');
    if (r.offline) toast('当前为离线规则分析（启用大模型可获得更深入的建议）', 'warn');
  } catch (e) { $('#analysisOut').innerHTML = `<div class="diag-item err">${esc(e.message)}</div>`; }
  finally { btn.classList.remove('busy'); }
}

function exportCsv() {
  const stMap = new Map((stats?.students || []).map(s => [s.id, s]));
  const rows = [['学号', '姓名', '班级', '练习次数', '通过次数', '完成实验数', '提问数', '最近活动', '状态']];
  for (const s of students.filter(s => !classFilter || s.class_name === classFilter)) {
    const x = stMap.get(s.id) || {};
    rows.push([s.student_no || s.username, s.name || '', s.class_name || '', x.attempts || 0, x.ok_count || 0, x.solved || 0, x.questions || 0, x.last_attempt || s.last_login || '', s.active ? '正常' : '停用']);
  }
  const csv = '\uFEFF' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `学情_${classFilter || '全部'}_${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('已导出 CSV（Excel 可直接打开）', 'ok');
}

async function answerQuestion(qid) {
  try {
    const r = await api('/api/questions/' + qid);
    const q = r.question, ans = r.answers || [];
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="small muted">${esc(q.uname || '')} · ${esc(q.created_at || '')} · 状态 ${esc(q.status || '')}</div>
      <h3 style="margin:8px 0">${esc(q.title)}</h3>
      <div class="md">${md(q.body || '')}</div>
      ${q.code ? `<pre class="code-preview">${esc(q.code.slice(0, 3000))}</pre>` : ''}
      <h3 style="margin:12px 0 6px">已有回复</h3>
      ${ans.map(a => `<div class="ev-item"><b>${esc(a.author_name || a.author_role || '')}</b><div class="md small">${md(a.body || '')}</div></div>`).join('') || '<div class="muted small">暂无</div>'}
      <label style="margin-top:12px">我的答复<textarea id="tAns" class="import-box"></textarea></label>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px">
        <button class="btn" id="tAnsClose">保存并标记已答复</button>
        <button class="btn primary" id="tAnsSend">发送答复</button>
      </div>`;
    modal('学生提问', wrap);
    const send = async (close) => {
      const body = $('#tAns').value.trim();
      if (!body) return toast('答复内容为空', 'warn');
      try {
        await api(`/api/questions/${qid}/answer`, { method: 'POST', body: { body, close } });
        toast('已发送', 'ok');
        closeModal(); loadTeacherQA();
      } catch (e) { toast(e.message, 'err'); }
    };
    $('#tAnsSend').addEventListener('click', () => send(false));
    $('#tAnsClose').addEventListener('click', () => send(true));
  } catch (e) { toast(e.message, 'err'); }
}

/* ================================================================ 设置 */
async function saveLLM() {
  const btn = $('#btnSaveLLM');
  btn.classList.add('busy');
  try {
    await api('/api/settings/llm', {
      method: 'POST',
      body: {
        enabled: $('#llmEnabled').checked,
        baseUrl: $('#llmBaseUrl').value.trim(),
        model: $('#llmModel').value.trim(),
        apiKey: $('#llmApiKey').value.trim(),
        systemExtra: $('#llmSystemExtra').value.trim()
      }
    });
    toast('大模型设置已保存（密钥仅存服务端）', 'ok');
    await loadSettings();
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.classList.remove('busy'); }
}

async function testLLM() {
  const box = $('#llmTestOut');
  box.innerHTML = '<span class="muted">测试中…</span>';
  try {
    const r = await api('/api/settings/llm/test', { method: 'POST', body: {} });
    box.innerHTML = `<div class="diag-item ${r.ok ? 'ok' : 'err'}"><b>${r.ok ? '连接成功' : '连接失败'}</b>${esc(r.message || r.reply || '')}</div>`;
  } catch (e) { box.innerHTML = `<div class="diag-item err">${esc(e.message)}</div>`; }
}

async function savePlatform() {
  try {
    await api('/api/settings/platform', {
      method: 'POST',
      body: {
        requireRoster: $('#chkRequireRoster').checked,
        allowSelfRegister: $('#chkAllowRegister').checked,
        siteName: $('#siteNameInput').value.trim(),
        announce: $('#announceInput').value.trim()
      }
    });
    toast('平台设置已保存', 'ok');
    const info = await api('/api/info');
    document.title = info.siteName;
    $('#siteName').textContent = info.siteName;
    $('#siteAnnounce').textContent = info.announce || '';
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------------------------------------------------------------- 教师邀请码 */
async function loadInvite() {
  try {
    const r = await api('/api/teacher/invite');
    const elCode = $('#inviteCodeText');
    if (elCode) elCode.textContent = r.code;
    const elUses = $('#inviteUses');
    if (elUses) elUses.textContent = r.uses ? `已被使用 ${r.uses} 次` : '尚未被使用';
  } catch (e) {
    const elCode = $('#inviteCodeText');
    if (elCode) elCode.textContent = '加载失败';
  }
}

async function copyInvite() {
  const code = ($('#inviteCodeText')?.textContent || '').trim();
  if (!code || code === '—') return toast('邀请码尚未加载', 'warn');
  try {
    await navigator.clipboard.writeText(code);
    toast('邀请码已复制：' + code, 'ok');
  } catch {
    // 非安全上下文（http）下 clipboard 不可用，退回选中提示
    toast('请手动复制：' + code, 'warn', 5000);
  }
}

async function regenInvite() {
  const ok = await confirmBox('重新生成邀请码', '旧邀请码将立即失效，已注册的教师不受影响。确定重新生成吗？');
  if (!ok) return;
  try {
    const r = await api('/api/teacher/invite/regenerate', { method: 'POST' });
    const elCode = $('#inviteCodeText');
    if (elCode) elCode.textContent = r.code;
    const elUses = $('#inviteUses');
    if (elUses) elUses.textContent = '尚未被使用';
    toast('已生成新邀请码：' + r.code, 'ok', 6000);
  } catch (e) { toast('生成失败：' + e.message, 'err'); }
}

/* 厂商预设：把官方接口地址与常用模型名填好，教师只需粘贴密钥 */
const LLM_PRESETS = {
  // 注意：deepseek-chat / deepseek-reasoner 已于 2026-07-24 停用，现行模型名为 v4 系列
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', hint: '在 platform.deepseek.com 创建 API Key' },
  glm: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', hint: '在 open.bigmodel.cn 创建 API Key（glm-4-flash 有免费额度）' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hint: '需海外网络环境' },
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b', hint: '本机运行 Ollama，密钥留空即可' }
};
function applyLlmPreset(name) {
  const p = LLM_PRESETS[name];
  if (!p) return;
  const bu = $('#llmBaseUrl'), md = $('#llmModel'), out = $('#llmTestOut');
  if (bu) bu.value = p.baseUrl;
  if (md) md.value = p.model;
  if (out) out.textContent = '已填入 ' + p.baseUrl + ' 与 ' + p.model + '。' + p.hint + '，粘贴密钥后点「保存设置」再「测试连接」。';
}

/* ---------------------------------------------------------------- 高频错误统计 */
let errorsLoaded = false;
async function loadErrors(notify) {
  const box = $('#errorStats');
  if (!box) return;
  try {
    const r = await api('/api/teacher/errors');
    errorsLoaded = true;
    if (!r.groups || !r.groups.length) {
      box.innerHTML = '<div class="empty">还没有编译失败记录。学生编译出错后，这里会自动聚合。</div>';
      return;
    }
    const groups = r.groups.map(g => {
      const rows = g.items.map(it => `
        <tr>
          <td class="small" style="max-width:420px;word-break:break-all">${esc(it.message)}</td>
          <td><b>${it.count}</b></td>
          <td>${it.users}</td>
        </tr>`).join('');
      return `
        <div class="err-group">
          <div class="err-group-title">${esc(g.problemId)}<span class="muted small">（共 ${g.items.reduce((a, b) => a + b.count, 0)} 次）</span></div>
          <table class="data-table"><thead><tr><th>错误信息</th><th>次数</th><th>涉及人数</th></tr></thead><tbody>${rows}</tbody></table>
        </div>`;
    }).join('');
    box.innerHTML = `<div class="small muted" style="padding:4px 0">累计失败编译 ${r.total} 次，涉及 ${r.groups.length} 个实验</div>${groups}`;
    if (notify) toast('已刷新错误统计', 'ok');
  } catch (e) {
    box.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>';
  }
}

/* ---------------------------------------------------------------- AI 知识库 */
async function loadKbDocs() {
  const box = $('#kbDocs');
  if (!box) return;
  try {
    const r = await api('/api/kb/docs');
    if (!r.docs.length) {
      box.innerHTML = '<div class="empty">还没有资料。上传讲义或粘贴要点后，AI 回答时会优先参考它们。</div>';
      return;
    }
    const rows = r.docs.map(d => `
      <tr>
        <td>${esc(d.title)}</td>
        <td class="small muted">${esc(d.filename || '—')}</td>
        <td>${d.chars} 字</td>
        <td class="small">${esc(d.created_at || '')}</td>
        <td><button class="btn sm" data-kbdel="${d.id}">删除</button></td>
      </tr>`).join('');
    box.innerHTML = `<div class="small muted" style="padding:4px 0">共 ${r.docs.length} 份资料，合计 ${r.totalChars} 字</div>
      <table class="data-table"><thead><tr><th>标题</th><th>文件名</th><th>字数</th><th>上传时间</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  } catch (e) {
    box.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>';
  }
}

function uploadKbFiles(ev) {
  const files = [...(ev.target.files || [])];
  if (!files.length) return;
  let done = 0, failed = 0;
  const next = (i) => {
    if (i >= files.length) {
      ev.target.value = '';
      toast(`已上传 ${done} 份${failed ? '，失败 ' + failed + ' 份' : ''}`, done ? 'ok' : 'err');
      loadKbDocs();
      return;
    }
    const f = files[i];
    const reader = new FileReader();
    reader.onload = async () => {
      let text = String(reader.result || '');
      if (/\.html?$/i.test(f.name)) {
        text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s{3,}/g, '\n\n');
      }
      try {
        await api('/api/kb/docs', { method: 'POST', body: { title: f.name.replace(/\.[^.]+$/, ''), filename: f.name, content: text } });
        done++;
      } catch { failed++; }
      next(i + 1);
    };
    reader.onerror = () => { failed++; next(i + 1); };
    reader.readAsText(f, 'utf-8');
  };
  next(0);
}

async function pasteKbDoc() {
  const r = await promptBox('粘贴资料', [
    { name: 'title', label: '资料标题', placeholder: '如 第 3 讲 定时器与中断' },
    { name: 'content', label: '内容（可直接从 Word / PDF 复制）', type: 'textarea', placeholder: '把讲义要点粘贴到这里…' }
  ]);
  if (!r || !r.content) return;
  try {
    await api('/api/kb/docs', { method: 'POST', body: { title: r.title || '粘贴的资料', content: r.content } });
    toast('已加入知识库', 'ok');
    loadKbDocs();
  } catch (e) { toast('保存失败：' + e.message, 'err'); }
}

async function deleteKbDoc(id) {
  const ok = await confirmBox('删除资料', '删除后 AI 将不再参考这份资料。确定删除吗？');
  if (!ok) return;
  try {
    await api(`/api/kb/docs/${id}/delete`, { method: 'POST' });
    toast('已删除', 'ok');
    loadKbDocs();
  } catch (e) { toast('删除失败：' + e.message, 'err'); }
}

/* ---------------------------------------------------------------- 联网搜索配置 */
async function loadWebSearchCfg() {
  try {
    const c = await api('/api/websearch/config');
    const en = $('#wsEnabled'); if (en) en.checked = !!c.enabled;
    const pv = $('#wsProvider'); if (pv) pv.value = c.provider || 'tavily';
    const mx = $('#wsMax'); if (mx) mx.value = c.maxResults || 5;
    const st = $('#wsState');
    if (st) st.textContent = c.hasKey ? '已配置密钥' : '尚未配置密钥（未配置时 AI 不会联网搜索）';
  } catch { }
}

async function saveWebSearch() {
  try {
    await api('/api/websearch/config', {
      method: 'POST',
      body: {
        enabled: $('#wsEnabled').checked,
        provider: $('#wsProvider').value,
        apiKey: $('#wsKey').value,
        maxResults: Number($('#wsMax').value) || 5
      }
    });
    $('#wsKey').value = '';
    toast('联网搜索设置已保存', 'ok');
    loadWebSearchCfg();
  } catch (e) { toast('保存失败：' + e.message, 'err'); }
}
