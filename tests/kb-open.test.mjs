/**
 * kb-open.test.mjs — 知识库检索 + 开放性命题
 * ==================================================================
 * 知识库：教师上传纯文本 → AI 回答前检索（关键词相关度 + IDF，非向量检索）
 * 开放题：教师自由出题 → 学生提交 原理图/代码/报告 → 教师打分评语
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 19300 + Math.floor(Math.random() * 90);
const DB = path.join(os.tmpdir(), `mculab-kb-${Date.now()}.db`);
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
const asStudent = async () => { cookie = ''; await req('POST', '/api/auth/login', { username: '2026009', password: '123456' }); };

try {
  await asTeacher();
  await req('POST', '/api/teacher/students/import', { text: '学号,姓名,班级\n2026009,王五,自动化2602' });

  /* ---------------- 一、知识库 ---------------- */
  const doc1 = `第 3 讲 定时器与中断

定时器 T0 工作在方式 1（16 位定时器）时，需要同时给 TH0 与 TL0 赋初值，
初值 = 65536 − 定时机器周期数。12MHz 晶振下 1 个机器周期为 1 微秒。
中断服务函数必须使用 interrupt 关键字，例如 void T0_isr(void) interrupt 1。
在中断里不要做长耗时操作，也不要调用 printf，否则会阻塞主循环并导致串口输出乱码。`;
  const r1 = await req('POST', '/api/kb/docs', { title: '第3讲 定时器与中断', filename: 'lecture3.txt', content: doc1 });
  ok('1 教师可上传知识库文档', r1.s === 200 && r1.d.chars > 50, JSON.stringify(r1.d).slice(0, 60));

  const d2 = `晶振电路设计规范

单片机晶振两端需要各接一只 20~33pF 的瓷片电容到地，否则可能不起振。
晶振应尽量靠近单片机放置，走线要短，下方不要走其他信号线。`;
  await req('POST', '/api/kb/docs', { title: '晶振电路设计规范', content: d2 });

  const list = await req('GET', '/api/kb/docs');
  ok('2 文档列表返回两份资料', list.d.docs.length === 2, `count=${list.d.docs.length}`);

  const hit = await req('GET', '/api/kb/search?q=' + encodeURIComponent('定时器中断里为什么不能 printf'));
  ok('3 检索能命中相关片段', hit.d.hits.length > 0, JSON.stringify(hit.d).slice(0, 80));
  // 注意：定时器文档里本身就有"晶振"二字（"12MHz 晶振下…"），
  // 所以用只出现在晶振文档里的"瓷片电容"来区分两份资料
  ok('4 命中的是定时器那份资料而不是晶振那份',
    hit.d.hits.length > 0 && /printf/.test(hit.d.hits[0].text) && !/瓷片电容/.test(hit.d.hits[0].text),
    (hit.d.hits[0] || {}).text?.slice(0, 60));

  const hit2 = await req('GET', '/api/kb/search?q=' + encodeURIComponent('晶振电容'));
  ok('5 换关键词能命中另一份资料', hit2.d.hits.length > 0 && /晶振|电容/.test(hit2.d.hits[0].text),
    (hit2.d.hits[0] || {}).text?.slice(0, 40));

  const hit3 = await req('GET', '/api/kb/search?q=' + encodeURIComponent('zzzzz qqqqq 无关内容'));
  ok('6 无关查询不返回结果', hit3.d.hits.length === 0, `count=${hit3.d.hits.length}`);

  /* 学生不能上传 */
  await asStudent();
  const stuUpload = await req('POST', '/api/kb/docs', { title: 'x', content: 'x'.repeat(50) });
  ok('7 学生不能上传知识库（403）', stuUpload.s === 403, `HTTP ${stuUpload.s}`);

  /* ---------------- 二、开放性命题 ---------------- */
  await asTeacher();
  const op = await req('POST', '/api/teacher/open-problems', {
    title: '期末开放设计：智能交通灯',
    statement: '设计一个带倒计时的十字路口交通灯，要求含紧急按钮。',
    published: true
  });
  ok('8 教师可创建开放题', op.s === 200 && op.d.id > 0, JSON.stringify(op.d));

  await asStudent();
  const visible = await req('GET', '/api/open-problems');
  ok('9 学生能看到已发布开放题', (visible.d.problems || []).some(p => p.id === op.d.id),
    `count=${(visible.d.problems || []).length}`);

  const sub = await req('POST', `/api/open-problems/${op.d.id}/submit`, {
    code: '#include <stc89.h>\nvoid main(void){ P1=0; }',
    report: '本设计采用状态机实现三相位…',
    schematic: JSON.stringify({ parts: [{ type: 'mcu', x: 4, y: 4 }], wires: [] })
  });
  ok('10 学生可提交三件套', sub.s === 200 && !!sub.d.submittedAt, JSON.stringify(sub.d));

  const empty = await req('POST', `/api/open-problems/${op.d.id}/submit`, { code: '', report: '', schematic: '' });
  ok('11 空提交被拒绝（400）', empty.s === 400, `HTTP ${empty.s}`);

  await asTeacher();
  const subs = await req('GET', `/api/teacher/open-problems/${op.d.id}/submissions`);
  ok('12 教师能看到提交列表与材料标记',
    subs.d.rows.length === 1 && subs.d.rows[0].hasCode && subs.d.rows[0].hasReport && subs.d.rows[0].hasSchematic,
    JSON.stringify(subs.d.rows[0] || {}).slice(0, 120));

  const subId = subs.d.rows[0].id;
  const detail = await req('GET', `/api/teacher/open-submissions/${subId}`);
  ok('13 教师能读到提交全文', /stc89/.test(detail.d.code) && /状态机/.test(detail.d.report), '');

  const grade = await req('POST', `/api/teacher/open-submissions/${subId}/grade`, { score: 88, comment: '结构清晰，倒计时可以再优化。' });
  ok('14 教师可打分并写评语', grade.s === 200, `HTTP ${grade.s}`);

  const badGrade = await req('POST', `/api/teacher/open-submissions/${subId}/grade`, { score: 130 });
  ok('15 越界分数被拒绝', badGrade.s === 400, `HTTP ${badGrade.s}`);

  await asStudent();
  const mine = await req('GET', `/api/open-problems/${op.d.id}/mine`);
  ok('16 学生能看到自己的分数与评语',
    mine.d.problem.submission && mine.d.problem.submission.score === 88 && /结构清晰/.test(mine.d.problem.submission.comment),
    JSON.stringify(mine.d.problem.submission || {}).slice(0, 100));

  /* 未发布不可见 */
  await asTeacher();
  const draft = await req('POST', '/api/teacher/open-problems', { title: '草稿题', statement: '', published: false });
  await asStudent();
  const v2 = await req('GET', '/api/open-problems');
  ok('17 未发布开放题学生看不到', !(v2.d.problems || []).some(p => p.id === draft.d.id),
    `count=${(v2.d.problems || []).length}`);

  /* 未配置密钥时联网搜索明确返回未启用 */
  const ws = await req('GET', '/api/websearch/search?q=' + encodeURIComponent('8051'));
  ok('18 未启用联网搜索时明确返回 enabled=false 与原因',
    ws.s === 200 && ws.d.enabled === false && !!ws.d.reason,
    JSON.stringify(ws.d).slice(0, 80));
} catch (e) {
  fail++; rows.push(`  [ERR ] ${e.message}`);
}

console.log('\n===== 知识库检索 · 开放性命题 =====\n');
console.log(rows.join('\n'));
console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
done(fail === 0 ? 0 : 1);
