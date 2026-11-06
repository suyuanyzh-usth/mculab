/*
 * view-qa.js — 答疑视图
 * 学生提问 → 服务端自动生成助教回答（大模型或离线规则库）→ 可继续追问。
 * 提问时自动附带当前代码与原理图诊断结果，让回答更贴合真实上下文。
 */
import { $, el, api, state, toast, esc, md, modal, closeModal, promptBox } from './core.js';
import { cloudConfigured } from './cloud-config.js';
import { cloudChat, TUTOR_SYSTEM, tutorPrompt, probeCloud } from './cloud-llm.js';

let list = [];
let activeId = null;
let history = [];

export function init() {
  $('#btnNewQuestion').addEventListener('click', newQuestion);
  $('#questionList').addEventListener('click', (e) => {
    const it = e.target.closest('[data-id]');
    if (it) openQuestion(Number(it.dataset.id));
  });
  $('#qaDetail').addEventListener('click', async (e) => {
    if (e.target.id === 'qaAskAi') return askAi();
    if (e.target.id === 'qaReplyBtn') return reply();
  });
}

export async function show() {
  await reload();
  showAiStatus();
}

/* 在界面上直说"现在是云端 AI 还是离线助教"，避免教师以为云端已生效 */
let aiStatusOnce = false;
async function showAiStatus() {
  const el2 = $('#qaAiStatus');
  if (!el2) return;
  if (!cloudConfigured()) { el2.textContent = '离线助教模式'; el2.title = '未配置云服务'; return; }
  if (aiStatusOnce) return;
  aiStatusOnce = true;
  el2.textContent = '检测云端 AI…';
  const r = await probeCloud();
  if (r.available) {
    el2.textContent = '云端 AI 已连接' + (r.model ? '（' + r.model + '）' : '');
    el2.title = '提问将由云服务大模型回答，无需教师配置 API 密钥';
    el2.style.color = 'var(--ok)';
  } else {
    el2.textContent = '云端 AI 不可用 · 已用离线助教';
    el2.title = r.error || '';
    el2.style.color = 'var(--warn)';
  }
}

export async function reload() {
  try {
    const r = await api('/api/questions');
    list = r.questions || [];
    renderList();
    if (activeId) {
      const still = list.find(q => q.id === activeId);
      if (still) openQuestion(activeId, true);
    } else if (list.length) {
      openQuestion(list[0].id, true);
    }
  } catch (e) { toast('提问列表加载失败：' + e.message, 'err'); }
}

function renderList() {
  const box = $('#questionList');
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="empty">还没有提问。点击「新建提问」向 AI 助教或教师提问。</div>'; return; }
  for (const q of list) {
    const node = el('div', { class: 'qa-item' + (q.id === activeId ? ' active' : ''), dataset: { id: q.id } }, [
      el('div', { class: 'qt', text: q.title }),
      el('div', { class: 'qm' }, [
        el('span', { text: q.status === 'answered' ? '已答复' : q.status === 'closed' ? '已关闭' : '待答复' }),
        el('span', { text: (q.answers || 0) + ' 条回复' }),
        q.uname ? el('span', { text: q.uname }) : null,
        el('span', { text: fmt(q.created_at) })
      ])
    ]);
    box.append(node);
  }
}
function fmt(t) {
  if (!t) return '';
  const d = new Date(t.replace ? t.replace(' ', 'T') : t);
  return isNaN(d) ? String(t) : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function contextPayload() {
  const diag = (state.sch?.diagnostics || []).map(i => ({ level: i.level, code: i.code, msg: i.msg }));
  return {
    issues: diag,
    parts: (state.sch?.parts || []).map(p => ({ type: p.type, label: p.label })),
    wires: state.sch?.wires?.length || 0,
    nets: state.sch ? state.sch.netlist.nets.filter(n => n.members.length > 1).length : 0
  };
}

async function newQuestion() {
  const r = await promptBox('新建提问', [
    { name: 'title', label: '问题标题', placeholder: '一句话说明你遇到的问题，例如：数码管只亮一位不动' },
    { name: 'body', label: '详细描述', type: 'textarea', placeholder: '现象、期望、你已经尝试过什么…' }
  ]);
  if (!r || !r.title) return;
  const btn = $('#btnNewQuestion');
  btn.classList.add('busy');
  try {
    const useCloud = cloudConfigured();
    // 云服务可用时，让服务端不要再用离线规则抢先回答，改由云端模型作答
    const res = await api('/api/questions', {
      method: 'POST',
      body: {
        title: r.title, body: r.body,
        problemId: state.problem?.id || '',
        code: state.code || (state.cm ? state.cm.getValue() : ''),
        context: JSON.stringify(contextPayload()),
        autoAnswer: !useCloud
      }
    });

    let answered = false;
    if (useCloud) {
      const payload = {
        question: r.title, body: r.body,
        code: state.code || (state.cm ? state.cm.getValue() : ''),
        context: contextPayload(),
        problemId: state.problem?.id || ''
      };
      try {
        const ans = await cloudChat({ system: TUTOR_SYSTEM, user: tutorPrompt(payload) });
        // 与刚才的流式请求错开一点点，避开网关对相邻 POST 的限流
        await new Promise(r => setTimeout(r, 300));
        await api(`/api/questions/${res.id}/answer`, { method: 'POST', body: { body: ans.text, asAi: true } });
        answered = true;
      } catch (e) {
        warnCloudFallback(e);
        // 云端失败：让服务端补一个回答，别让学生对着空提问
        try {
          const fb = await api('/api/ai/chat', { method: 'POST', body: payload });
          if (fb && fb.content) {
            await api(`/api/questions/${res.id}/answer`, { method: 'POST', body: { body: fb.content } });
            answered = true;
          }
        } catch { /* 连兜底也失败就只留提问本身 */ }
      }
    } else {
      answered = !!res.autoAnswer;
    }

    toast(answered ? '已提问，助教已作答' : '已提问，等待教师答复', 'ok');
    activeId = res.id;
    await reload();
    openQuestion(res.id);
  } catch (e) { toast('提问失败：' + e.message, 'err'); }
  finally { btn.classList.remove('busy'); }
}

async function openQuestion(id, silent = false) {
  activeId = id;
  renderList();
  try {
    const r = await api('/api/questions/' + id);
    const q = r.question, ans = r.answers || [];
    history = ans.map(a => ({ role: a.role === 'user' ? 'user' : 'assistant', content: a.body }));
    $('#qaTitle').textContent = q.title;
    const box = $('#qaDetail');
    box.innerHTML = '';
    box.append(el('div', { class: 'qa-msg user' }, [
      el('div', { class: 'who', text: (q.uname || '我') + ' · ' + fmt(q.created_at) }),
      el('div', { class: 'bubble', html: md(q.body || '（无描述）') })
    ]));
    if (q.code) {
      box.append(el('details', { class: 'qa-msg' }, [
        el('summary', { class: 'small muted', text: '附带的学生代码' }),
        el('pre', { class: 'code-preview', text: q.code.slice(0, 4000) })
      ]));
    }
    for (const a of ans) {
      const cls = a.author_role === 'ai' ? 'ai' : a.author_role === 'teacher' ? 'teacher' : 'user';
      box.append(el('div', { class: 'qa-msg ' + cls }, [
        el('div', { class: 'who', text: (a.author_name || a.author_role) + ' · ' + fmt(a.created_at) }),
        el('div', { class: 'bubble', html: md(a.body || '') })
      ]));
    }
    // 追问区
    const reply = el('div', { class: 'qa-reply' }, []);
    const ta = el('textarea', { class: 'import-box', placeholder: '继续追问…（Enter 发送，Shift+Enter 换行）' });
    ta.style.minHeight = '64px';
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); sendFollowUp(ta.value, ta); }
    });
    const b1 = el('button', { class: 'btn primary sm', id: 'qaReplyBtn', text: '发送' });
    b1.addEventListener('click', () => sendFollowUp(ta.value, ta));
    const b2 = el('button', { class: 'btn sm', id: 'qaAskAi', text: '仅问 AI 助教（不存档）' });
    b2.addEventListener('click', () => askAiStandalone(ta.value, ta));
    reply.append(ta, el('div', { class: 'row', style: 'flex-direction:column;gap:6px' }, [b1, b2]));
    box.append(reply);
    box.scrollTop = box.scrollHeight;
  } catch (e) { if (!silent) toast(e.message, 'err'); }
}

async function sendFollowUp(text, ta) {
  if (!text || !text.trim()) return;
  const qid = activeId;
  try {
    await api(`/api/questions/${qid}/answer`, { method: 'POST', body: { body: text.trim() } });
    ta.value = '';
    // 让 AI 助教接着回答（云服务优先，失败回退）
    const r = await askTutor({
      question: $('#qaTitle').textContent,
      body: text,
      history: history.slice(-8),
      code: state.code || (state.cm ? state.cm.getValue() : ''),
      context: contextPayload(),
      problemId: state.problem?.id || ''
    });
    history.push({ role: 'user', content: text });
    history.push({ role: 'assistant', content: r.content });
    if (r.content) await api(`/api/questions/${qid}/answer`, { method: 'POST', body: { body: r.content } });
    await openQuestion(qid, true);
  } catch (e) { toast(e.message, 'err'); }
}

/* ------------------------------------------------------------------
 * 统一提问入口：优先云服务大模型，失败自动回退到服务端（教师配置的模型 / 离线规则库）。
 * 回退是"有感知的"——会把原因提示一次，避免用户以为云服务正常但答案质量莫名下降。
 * ------------------------------------------------------------------ */
let cloudWarned = false;
function warnCloudFallback(e) {
  // 域名不一致属于"自建部署的正常情况"，不该拿告警去打扰使用者
  if (e && e.code === 'WRONG_ORIGIN') return;
  if (cloudWarned) return;
  cloudWarned = true;
  toast('云端 AI 暂不可用（' + (e && e.message ? e.message : '未知原因') + '），已改用服务端模型', 'warn', 5000);
}

/* 检索教师知识库 + 联网搜索，作为 AI 的参考资料（两条路径共用） */
async function gatherAiContext(payload) {
  const parts = [];
  const q = ((payload.question || '') + ' ' + (payload.body || '')).slice(0, 300);
  try {
    const kb = await api('/api/kb/search?q=' + encodeURIComponent(q));
    if (kb.hits && kb.hits.length) {
      parts.push('【教师知识库摘录】\n' + kb.hits.map((h, i) => `(${i + 1}) ${h.text}`).join('\n\n'));
    }
  } catch { }
  try {
    const ws = await api('/api/websearch/search?q=' + encodeURIComponent(payload.question || q));
    if (ws.enabled && ws.hits && ws.hits.length) {
      parts.push('【联网搜索结果】\n' + ws.hits.map((h, i) => `(${i + 1}) ${h.title} — ${h.snippet}`).join('\n\n'));
    }
  } catch { }
  return parts.join('\n\n');
}

async function askTutor(payload) {
  const extra = await gatherAiContext(payload);
  const withExtra = (txt) => extra ? txt + '\n\n' + extra + '\n\n（请优先依据以上资料回答；资料未覆盖时再凭通用经验，并说明这一点。）' : txt;

  if (cloudConfigured()) {
    try {
      const r = await cloudChat({
        system: TUTOR_SYSTEM,
        user: withExtra(tutorPrompt(payload)),
        history: payload.history || []
      });
      return { content: r.text, offline: false, source: 'cloud', model: r.model };
    } catch (e) {
      warnCloudFallback(e);
    }
  }
  const r = await api('/api/ai/chat', { method: 'POST', body: { ...payload, kbContext: extra } });
  return { content: r.content, offline: !!r.offline, source: 'server' };
}

function sourceLabel(r) {
  if (r.source === 'cloud') return '云端 AI 助教';
  return r.offline ? '离线助教（规则库）' : 'AI 助教';
}

async function askAi() { toast('请在下方输入框写下追问内容', ''); }

async function askAiStandalone(text, ta) {
  if (!text || !text.trim()) return toast('请先输入追问内容', 'warn');
  try {
    const r = await askTutor({
      question: $('#qaTitle').textContent, body: text,
      history: history.slice(-8),
      code: state.code || (state.cm ? state.cm.getValue() : ''),
      context: contextPayload(),
      problemId: state.problem?.id || ''
    });
    const box = $('#qaDetail');
    box.append(el('div', { class: 'qa-msg user' }, [
      el('div', { class: 'who', text: '我（临时追问）' }),
      el('div', { class: 'bubble', html: md(text) })
    ]));
    box.append(el('div', { class: 'qa-msg ai' }, [
      el('div', { class: 'who', text: sourceLabel(r) }),
      el('div', { class: 'bubble', html: md(r.content || '') })
    ]));
    ta.value = '';
    box.scrollTop = box.scrollHeight;
    if (r.offline) toast('当前为离线规则回答（教师尚未启用大模型）', 'warn');
  } catch (e) { toast(e.message, 'err'); }
}

function reply() { }
