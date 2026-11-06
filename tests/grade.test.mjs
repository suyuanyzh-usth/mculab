/**
 * grade.test.mjs — 实验任务过程记录 + 成绩册计分
 * ==================================================================
 * 计分规则（用户确认）：
 *   · 教师自定义成绩构成：环节（实验）× 环节权重
 *   · 单环节内分「功能实现 / 电路设计 / 实验报告 / 调试过程」子项，各带权重
 *   · 环节得分 = Σ(子项权重 × 子项分) / Σ子项权重
 *   · 总分     = Σ(环节权重 × 环节得分) / Σ环节权重
 *   · 未打分的子项不计入分母；某环节全部未打分则该环节不参与总评
 *   · 及格线 60，默认保留 0 位小数（均可配置）
 *
 * 过程记录：教师在后台设定起止时间，系统记录学生首次打开与提交时间，
 *          用时 = 提交 − 打开（超出窗口部分截断）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 19500 + Math.floor(Math.random() * 80);
const DB = path.join(os.tmpdir(), `mculab-grade-${Date.now()}.db`);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const rows = [];
const ok = (n, c, e = '') => { if (c) { pass++; rows.push(`  [PASS] ${n}`); } else { fail++; rows.push(`  [FAIL] ${n}${e ? '  → ' + e : ''}`); } };

const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js'), '--port', String(PORT), '--host', '127.0.0.1'], {
  env: { ...process.env, MCULAB_DB: DB }, stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
child.stdout.on('data', d => log += d);
child.stderr.on('data', d => log += d);
function done(code) {
  try { child.kill(); } catch { }
  try { fs.rmSync(DB, { force: true }); } catch { }
  process.exit(code);
}
let up = false;
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(BASE + '/api/health')).ok) { up = true; break; } } catch { }
  await new Promise(r => setTimeout(r, 250));
}
if (!up) { console.log('服务启动失败：\n' + log.slice(0, 800)); done(2); }

let cookie = '';
async function req(method, u, body) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  if (body) h['Content-Type'] = 'application/json';
  const r = await fetch(BASE + u, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
    if (c.startsWith('mculab_token=')) cookie = c.split(';')[0];
  }
  let d = null; const t = await r.text();
  try { d = t ? JSON.parse(t) : null; } catch { d = { raw: t }; }
  return { s: r.status, d };
}
const asTeacher = async () => { cookie = ''; await req('POST', '/api/auth/login', { username: 'teacher', password: 'teacher123' }); };
// 教师导入学生时默认密码为 123456（可在导入时自定义）
const asStudent = async () => { cookie = ''; await req('POST', '/api/auth/login', { username: '2026001', password: '123456' }); };

const localISO = (offsetMin = 0) => {
  const d = new Date(Date.now() + offsetMin * 60000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

try {
  /* ---------- 准备：导入一名学生 ---------- */
  await asTeacher();
  await req('POST', '/api/teacher/students/import', { text: '学号,姓名,班级\n2026001,张三,自动化2601' });

  /* ---------- 一、实验任务与过程记录 ---------- */
  const made = await req('POST', '/api/teacher/assignments', {
    problemId: 'led_flow', title: '实验一 流水灯（限时）',
    requirement: '必须使用位移函数，禁止逐个赋值。',
    startAt: localISO(-60), endAt: localISO(120), published: true
  });
  ok('1 教师可创建并发布实验任务', made.s === 200 && made.d.id > 0, JSON.stringify(made.d).slice(0, 60));
  const aid = made.d.id;

  await asStudent();
  const list = await req('GET', '/api/assignments');
  const mine = (list.d.assignments || []).find(a => a.id === aid);
  ok('2 学生能看到已发布任务并读到要求', !!mine && /位移函数/.test(mine.requirement), JSON.stringify(mine || {}).slice(0, 80));
  ok('3 任务此刻处于开放窗口内', mine && mine.open === true, String(mine && mine.open));

  const o = await req('POST', `/api/assignments/${aid}/open`);
  ok('4 首次打开记录开始时间', o.s === 200 && !!o.d.openedAt, JSON.stringify(o.d));
  const again = await req('POST', `/api/assignments/${aid}/open`);
  ok('5 重复打开不覆盖首次时间', again.d.openedAt === o.d.openedAt, `${again.d.openedAt} vs ${o.d.openedAt}`);

  const sub = await req('POST', `/api/assignments/${aid}/submit`);
  ok('6 提交记录结束时间并算出用时', sub.s === 200 && !!sub.d.submittedAt && sub.d.minutes >= 0,
    JSON.stringify(sub.d));

  await asTeacher();
  const prog = await req('GET', `/api/teacher/assignments/${aid}/progress`);
  const row = (prog.d.rows || []).find(x => x.studentNo === '2026001');
  ok('7 教师能看到该生的打开/提交/用时', !!row && !!row.openedAt && !!row.submittedAt && row.minutes != null,
    JSON.stringify(row || {}).slice(0, 100));

  /* ---------- 二、高频错误统计 ---------- */
  await asStudent();
  await req('POST', '/api/compile', { code: 'void main(void){ this is not c }', problemId: 'led_flow' });
  await req('POST', '/api/compile', { code: 'void main(void){ this is not c }', problemId: 'led_flow' });
  await asTeacher();
  const errs = await req('GET', '/api/teacher/errors');
  ok('8 高频错误统计能聚合出失败编译', errs.s === 200 && errs.d.total >= 2 && (errs.d.groups || []).length > 0,
    `total=${errs.d.total}`);

  /* ---------- 三、成绩册计分 ---------- */
  await asTeacher();
  const gb0 = await req('GET', '/api/gradebook');
  ok('9 默认成绩方案含 15 个环节与 4 个子项',
    (gb0.d.scheme.stages || []).length === 15 && (gb0.d.scheme.items || []).length === 4,
    `stages=${(gb0.d.scheme.stages || []).length} items=${(gb0.d.scheme.items || []).length}`);
  ok('10 默认及格线 60、保留 0 位小数',
    gb0.d.scheme.passScore === 60 && gb0.d.scheme.decimals === 0,
    `${gb0.d.scheme.passScore}/${gb0.d.scheme.decimals}`);

  // 自定义方案：两个环节，权重 2:1；子项 功能40 + 电路60
  const setScheme = await req('POST', '/api/gradebook/scheme', {
    name: '期末总评', passScore: 60, decimals: 0,
    stages: [{ key: 's1', title: '实验一', weight: 2 }, { key: 's2', title: '实验二', weight: 1 }],
    items: [{ key: 'func', title: '功能实现', weight: 40 }, { key: 'circuit', title: '电路设计', weight: 60 }]
  });
  ok('11 教师可自定义成绩构成', setScheme.s === 200 && setScheme.d.scheme.stages.length === 2, JSON.stringify(setScheme.d).slice(0, 80));

  const sid = (gb0.d.students[0] || {}).id;
  // s1: func 80, circuit 60 → 0.4*80+0.6*60 = 68
  await req('POST', '/api/gradebook/score', { userId: sid, stageKey: 's1', itemKey: 'func', score: 80 });
  await req('POST', '/api/gradebook/score', { userId: sid, stageKey: 's1', itemKey: 'circuit', score: 60 });
  // s2: func 90 only → 环节分 90（只按已打分项归一）
  await req('POST', '/api/gradebook/score', { userId: sid, stageKey: 's2', itemKey: 'func', score: 90 });

  const gb1 = await req('GET', '/api/gradebook');
  const st = (gb1.d.students || [])[0];
  ok('12 环节得分按子项权重加权（0.4×80+0.6×60=68）', st && st.stageScores.s1 === 68, String(st && st.stageScores.s1));
  ok('13 只打了一个子项时按已打分项归一（=90）', st && st.stageScores.s2 === 90, String(st && st.stageScores.s2));
  // 总分 = (2×68 + 1×90) / 3 = 75.33 → 保留 0 位 = 75
  ok('14 总分按环节权重加权并按位数取整（75）', st && st.total === 75, String(st && st.total));
  ok('15 及格判定基于及格线 60', st && st.pass === true, String(st && st.pass));

  const me = await (async () => { await asStudent(); return req('GET', '/api/gradebook/me'); })();
  ok('16 学生能查到自己的成绩与总分', me.s === 200 && me.d.total === 75, `HTTP ${me.s} total=${me.d && me.d.total}`);

  // 清空一个子项 → 重新归一
  await asTeacher();
  await req('POST', '/api/gradebook/score', { userId: sid, stageKey: 's1', itemKey: 'circuit', score: '' });
  const gb2 = await req('GET', '/api/gradebook');
  ok('17 清空子项后重新计算（s1=80）', gb2.d.students[0].stageScores.s1 === 80, String(gb2.d.students[0].stageScores.s1));

  // 越界分数被拒
  const bad = await req('POST', '/api/gradebook/score', { userId: sid, stageKey: 's1', itemKey: 'func', score: 120 });
  ok('18 越界分数（120）被拒绝', bad.s === 400, `HTTP ${bad.s}`);

  // 未发布任务对学生的可见性
  await asTeacher();
  const draft = await req('POST', '/api/teacher/assignments', {
    problemId: 'led_flow', title: '草稿任务', requirement: '', startAt: '', endAt: '', published: false
  });
  await asStudent();
  const list2 = await req('GET', '/api/assignments');
  ok('19 未发布任务学生看不到', !(list2.d.assignments || []).some(a => a.id === draft.d.id),
    `count=${(list2.d.assignments || []).length}`);
} catch (e) {
  fail++; rows.push(`  [ERR ] ${e.message}`);
}

console.log('\n===== 实验任务 · 过程记录 · 成绩册 =====\n');
console.log(rows.join('\n'));
console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
done(fail === 0 ? 0 : 1);
