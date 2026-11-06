/*
 * view-report.js — 实验报告视图
 * AI 依据「代码 + 原理图 + 波形统计 + 调试记录」生成报告草稿；学生补充心得后提交。
 */
import { $, el, api, state, toast, esc, fmtDur, md, setView } from './core.js';
import { cloudConfigured } from './cloud-config.js';
import { cloudChat, REPORT_SYSTEM, reportPrompt } from './cloud-llm.js';

let current = null;     // {id, content, status}

export function init() {
  $('#btnGenReport').addEventListener('click', generate);
  $('#btnLoadReport').addEventListener('click', loadSaved);
  $('#btnSaveReport').addEventListener('click', () => save(false));
  $('#btnSubmitReport').addEventListener('click', () => save(true));
  $('#btnExportReport').addEventListener('click', exportMd);

  $('#reportProblem').addEventListener('change', () => { current = null; loadSaved(true); });
}

export async function show() {
  fillProblems();
  renderEvidence();
  if (!current) await loadSaved(true);
}

function fillProblems() {
  const sel = $('#reportProblem');
  const keep = sel.value;
  sel.innerHTML = '';
  for (const p of state.problems) sel.append(el('option', { value: p.id, text: p.title }));
  if (keep) sel.value = keep;
  else if (state.problem) sel.value = state.problem.id;
}

function selectedProblem() {
  const id = $('#reportProblem').value || state.problem?.id;
  return state.problems.find(p => p.id === id) || state.problem || null;
}

function renderEvidence() {
  const e = state.evidence;
  const box = $('#reportEvidence');
  const rows = [
    ['编译结果', e.compileOk ? `成功 · ${e.hexSize} 字节` : '尚无成功编译'],
    ['编译时间', e.compileAt ? new Date(e.compileAt).toLocaleString('zh-CN') : '—'],
    ['仿真周期', e.simCycles ? e.simCycles.toLocaleString() + ' 个机器周期（' + fmtDur(e.simCycles / 921600 * 1e6) + '）' : '—'],
    ['引脚跳变', e.portEvents ? e.portEvents.toLocaleString() + ' 次' : '—'],
    ['接线诊断', e.diag ? `${e.diag.errors ? e.diag.errors + ' 个错误' : '通过'}（共 ${e.diag.count} 条）` : '—'],
    ['串口记录', e.serialLog ? e.serialLog.length + ' 字符' : '—']
  ];
  box.innerHTML = rows.map(([k, v]) => `<div class="ev-item"><b>${esc(k)}</b><div>${esc(v)}</div></div>`).join('')
    + `<p class="small muted" style="margin-top:8px">生成草稿时，以上素材与当前代码、原理图网表会一并发送给分析引擎（离线模式下由本地规则生成）。</p>`;

  $('#reportMeta').innerHTML = current
    ? `<span>状态：<b>${current.status === 'submitted' ? '已提交' : '草稿'}</b></span>
       <span>更新：${new Date(current.updated_at || Date.now()).toLocaleString('zh-CN')}</span>
       <span>字数：${($('#reportEditor').value || '').length}</span>`
    : '<span class="muted">尚未生成或载入报告</span>';
}

async function generate() {
  const p = selectedProblem();
  if (!p) return toast('请先选择实验题目', 'warn');
  const btn = $('#btnGenReport');
  btn.classList.add('busy');
  const code = state.code || (state.cm ? state.cm.getValue() : '');
  const schematic = state.sch ? summarizeSchematic(state.sch) : null;
  let content = null, offline = false;

  // ① 优先走云服务大模型（无需教师配置 API 密钥）
  if (cloudConfigured()) {
    try {
      const r = await cloudChat({
        system: REPORT_SYSTEM,
        user: reportPrompt({ title: p.title, statement: p.statement, code, evidence: state.evidence, schematic })
      });
      content = r.text;
    } catch (e) {
      toast('云端 AI 暂不可用（' + e.message + '），改用服务端生成', 'warn', 5000);
    }
  }

  // ② 回退：服务端（大模型或离线模板）
  if (!content) {
    try {
      const r = await api('/api/reports/generate', {
        method: 'POST',
        body: { problemId: p.id, title: p.title, code, hex: state.hex || '', evidence: state.evidence, schematic }
      });
      content = r.content || '';
      offline = !!r.offline;
    } catch (e) {
      toast('生成失败：' + e.message, 'err');
      btn.classList.remove('busy');
      return;
    }
  }

  try {
    $('#reportEditor').value = content || '';
    current = { id: current?.id || null, status: 'draft', updated_at: Date.now() };
    renderEvidence();
    toast(offline ? '已用离线模板生成草稿' : 'AI 草稿已生成，请补充心得体会', 'ok');
    setView('report');
  } finally { btn.classList.remove('busy'); }
}

function summarizeSchematic(sch) {
  if (!sch) return null;
  const mcu = sch.parts.find(p => p.def.isMcu);
  const nets = sch.netlist.nets.filter(n => n.members.length > 1).length;
  const used = {};
  for (const p of sch.parts) used[p.label] = (used[p.label] || 0) + 1;
  return {
    mcu: mcu?.props?.model || '—',
    parts: used,
    wires: sch.wires.length,
    nets,
    diagnostics: (sch.diagnostics || []).map(i => ({ level: i.level, code: i.code, msg: i.msg }))
  };
}

async function loadSaved(silent = false) {
  const p = selectedProblem();
  if (!p) return;
  try {
    const r = await api('/api/reports?problemId=' + encodeURIComponent(p.id));
    if (r.report) {
      current = r.report;
      $('#reportEditor').value = r.report.content || '';
      renderEvidence();
      if (!silent) toast('已载入已保存的报告', 'ok');
    } else if (!silent) {
      toast('该实验还没有保存过的报告', 'warn');
    }
  } catch (e) { if (!silent) toast(e.message, 'err'); }
}

async function save(submit) {
  const p = selectedProblem();
  if (!p) return toast('请先选择实验题目', 'warn');
  const content = $('#reportEditor').value.trim();
  if (!content) return toast('报告内容为空', 'warn');
  const btn = submit ? $('#btnSubmitReport') : $('#btnSaveReport');
  btn.classList.add('busy');
  try {
    const r = await api('/api/reports', {
      method: 'POST',
      body: {
        id: current?.id || null,
        problemId: p.id,
        title: p.title,
        content,
        status: submit ? 'submitted' : 'draft',
        evidence: state.evidence
      }
    });
    current = { ...(current || {}), id: r.id, status: submit ? 'submitted' : 'draft', updated_at: Date.now() };
    renderEvidence();
    toast(submit ? '报告已提交给教师' : '已保存草稿', 'ok');
  } catch (e) { toast('保存失败：' + e.message, 'err'); }
  finally { btn.classList.remove('busy'); }
}

function exportMd() {
  const p = selectedProblem();
  const content = $('#reportEditor').value;
  if (!content.trim()) return toast('报告为空', 'warn');
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: (p?.id || 'report') + '_实验报告.md' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('已导出 Markdown', 'ok');
}
