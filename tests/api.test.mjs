/**
 * api.test.mjs — 服务端 API 与数据库端到端测试
 * ==================================================================
 * 启动一个使用**临时数据库**的服务实例（不影响 data/mculab.db），
 * 然后按真实使用顺序走一遍：
 *   登录 → 学生名单导入 → 学生注册 → 编译 → 练习记录 → 原理图保存
 *   → 提问（自动助教回答）→ 实验报告生成/保存/提交 → 教师端统计与批阅
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 19000 + Math.floor(Math.random() * 900);
const DBFILE = path.join(os.tmpdir(), `mculab-test-${Date.now()}.db`);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const rows = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; rows.push(`  [PASS] ${name}`); }
  else { fail++; rows.push(`  [FAIL] ${name}${extra ? '  → ' + extra : ''}`); }
};

/* ---------------------------------------------------------- 启动服务 */
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js'), '--port', String(PORT), '--host', '127.0.0.1'], {
  env: { ...process.env, MCULAB_DB: DBFILE },
  stdio: ['ignore', 'pipe', 'pipe']
});
let bootLog = '';
child.stdout.on('data', d => bootLog += d);
child.stderr.on('data', d => bootLog += d);

async function waitUp(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(BASE + '/api/info'); if (r.ok) return true; } catch { }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

function cleanup(code) {
  try { child.kill(); } catch { }
  try { fs.rmSync(DBFILE, { force: true }); } catch { }
  process.exit(code);
}

const up = await waitUp();
if (!up) {
  console.log('服务启动失败，日志：\n' + bootLog.slice(0, 2000));
  cleanup(2);
}

/* ---------------------------------------------------------- HTTP 助手 */
function makeClient() {
  let cookie = '';
  return async function req(method, url, body) {
    const init = { method, headers: {} };
    if (cookie) init.headers.Cookie = cookie;
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const r = await fetch(BASE + url, init);
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of sc) if (c.startsWith('mculab_token=')) cookie = c.split(';')[0];
    let data = null;
    const txt = await r.text();
    try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }
    return { status: r.status, data };
  };
}
const guest = makeClient();
const teacher = makeClient();
const student = makeClient();

/* ---------------------------------------------------------- 测试 */
try {
  /* --- 基础 --- */
  {
    const r = await guest('GET', '/api/info');
    ok('1 站点信息可读', r.status === 200 && !!r.data.siteName, JSON.stringify(r.data).slice(0, 100));
  }
  {
    const r = await guest('GET', '/api/problems');
    ok('2 未登录也可浏览题库（15 个实验）', r.status === 200 && r.data.problems.length === 15,
      `len=${r.data.problems?.length}`);
  }
  {
    const r = await guest('POST', '/api/auth/login', { username: 'teacher', password: 'wrong' });
    ok('3 错误密码被拒绝（401）', r.status === 401);
  }
  {
    const r = await teacher('POST', '/api/auth/login', { username: 'teacher', password: 'teacher123' });
    ok('4 教师登录成功', r.status === 200 && r.data.user.role === 'teacher');
  }
  {
    const r = await teacher('GET', '/api/me');
    ok('5 会话保持（Cookie）', r.data.user && r.data.user.username === 'teacher');
  }

  /* --- 学生名单导入 --- */
  const csv = [
    '学号,姓名,班级,初始密码',
    '2026001,张三,自动化2601,abc123',
    '2026002,李四,自动化2601,abc123',
    '2026003,王五,自动化2602,abc123'
  ].join('\n');
  {
    const r = await teacher('POST', '/api/teacher/students/import', { text: csv, defaultPassword: '123456' });
    ok('6 批量导入学生（CSV）', r.status === 200 && r.data.result.created === 3,
      JSON.stringify(r.data.result || {}).slice(0, 160));
  }
  {
    const r = await teacher('GET', '/api/teacher/students');
    ok('7 学生名单与班级可查', r.data.students.length === 3 && r.data.classes.length === 2,
      `students=${r.data.students.length} classes=${r.data.classes.length}`);
  }
  {
    const r = await student('POST', '/api/auth/register', {
      username: '2026099', password: 'abc123', name: '非名单学生', className: '自动化2601', studentNo: '2026099'
    });
    ok('8 名单外学号被拒绝注册（403）', r.status === 403, JSON.stringify(r.data));
  }
  {
    const r = await student('POST', '/api/auth/register', {
      username: '2026001', password: 'abc123', name: '张三', className: '自动化2601', studentNo: '2026001'
    });
    ok('9 名单内学号可自助注册并登录', r.status === 200 && r.data.user.role === 'student',
      JSON.stringify(r.data).slice(0, 140));
  }
  {
    const r = await student('POST', '/api/auth/change-password', { oldPassword: 'abc123', newPassword: 'xyz789' });
    ok('10 学生可修改密码', r.status === 200);
  }
  {
    const r = await student('POST', '/api/auth/login', { username: '2026001', password: 'xyz789' });
    ok('11 新密码可登录', r.status === 200);
  }

  /* --- 编译 / 练习记录 --- */
  let hex = '';
  {
    const r = await student('POST', '/api/compile', {
      code: '#include <8051.h>\nvoid main(void){ P1 = 0xFE; while(1); }',
      name: 'api-test', problemId: 'led_flow'
    });
    hex = r.data.hex || '';
    ok('12 学生提交代码可编译', r.status === 200 && r.data.ok === true && r.data.via === 'sdcc',
      JSON.stringify(r.data.errors || []).slice(0, 140));
    ok('13 返回合法 HEX', hex.startsWith(':') && hex.trimEnd().endsWith(':00000001FF'));
  }
  {
    const r = await student('POST', '/api/attempts', { problemId: 'led_flow', kind: 'simulate', ok: true, cycles: 921600 });
    ok('14 练习记录写入', r.status === 200);
  }

  /* --- 原理图 --- */
  {
    const r = await student('POST', '/api/sketches', {
      id: 'sk_test_1', name: '我的流水灯电路', problemId: 'led_flow',
      json: JSON.stringify({ version: 2, parts: [{ id: 'u1', type: 'mcu', x: 10, y: 5 }], wires: [] })
    });
    ok('15 原理图作品可保存', r.status === 200);
    const g = await student('GET', '/api/sketches');
    ok('16 作品列表可读', g.data.sketches.length === 1);
    const d = await student('GET', '/api/sketches/sk_test_1');
    ok('17 作品可回读', !!d.data.sketch && JSON.parse(d.data.sketch.json).parts.length === 1);
  }

  /* --- 提问与答疑 --- */
  let qid = 0;
  {
    const r = await student('POST', '/api/questions', {
      title: '流水灯只亮一个不流动',
      body: 'P1 输出后一直是 0xFE，怀疑延时没生效。',
      problemId: 'led_flow',
      code: 'void main(void){P1=0xFE;while(1);}',
      context: JSON.stringify({ issues: [{ level: 'warn', msg: '未检测到延时' }] })
    });
    qid = r.data.id;
    ok('18 学生可提问并得到自动答复', r.status === 200 && !!r.data.autoAnswer && String(r.data.autoAnswer).length > 20,
      `len=${String(r.data.autoAnswer || '').length}`);
  }
  {
    const r = await student('GET', `/api/questions/${qid}`);
    ok('19 提问详情含助教回答', r.status === 200 && r.data.answers.length >= 1);
  }
  {
    const r = await teacher('POST', `/api/questions/${qid}/answer`, { body: '请先检查 delay_ms 里的循环变量是否加了 volatile。', close: true });
    ok('20 教师可答复并关闭提问', r.status === 200);
    const t = await teacher('GET', '/api/teacher/questions');
    ok('21 教师端能看到全部提问', t.data.questions.length >= 1);
  }
  {
    const r = await student('POST', '/api/ai/chat', { question: '定时器初值怎么算？', code: 'TMOD=0x01;' });
    ok('22 AI 问答接口可用（无密钥时降级为离线规则）', r.status === 200 && !!r.data.content);
  }

  /* --- 实验报告 --- */
  let rid = 0;
  {
    const g = await student('POST', '/api/reports/generate', {
      problemId: 'led_flow', title: '实验一 LED 流水灯',
      code: 'void main(void){P1=0xFE;while(1);}',
      evidence: { compileOk: true, hexSize: 174, simCycles: 921600, portEvents: 320 },
      schematic: { mcu: 'STC89C52RC', parts: { '发光二极管': 8 }, wires: 22, nets: 12, diagnostics: [] }
    });
    ok('23 报告草稿可生成', g.status === 200 && g.data.content.length > 300, `len=${g.data.content?.length}`);
    const s = await student('POST', '/api/reports', {
      problemId: 'led_flow', title: '实验一 LED 流水灯',
      content: g.data.content + '\n\n## 八、附注\n学生补充内容。', status: 'draft'
    });
    ok('24 报告可保存为草稿', s.status === 200 && !!s.data.id);
    rid = s.data.id;
    const sub = await student('POST', '/api/reports', {
      problemId: 'led_flow', title: '实验一 LED 流水灯',
      content: g.data.content, status: 'submitted'
    });
    ok('25 报告可提交', sub.status === 200);
    const get = await student('GET', '/api/reports?problemId=led_flow');
    ok('26 报告可回读且状态为已提交', get.data.report && get.data.report.status === 'submitted');
  }
  {
    const r = await teacher('GET', '/api/teacher/reports');
    ok('27 教师端可列出学生报告', r.status === 200 && r.data.reports.length === 1);
    const rv = await teacher('POST', `/api/teacher/reports/${rid}/review`, { score: 92, comment: '分析到位，补充波形更好。' });
    ok('28 教师可批阅打分', rv.status === 200);
    const after = await student('POST', '/api/reports', { problemId: 'led_flow', content: '再改一次', status: 'draft' });
    ok('29 已批阅的报告不可再修改（409）', after.status === 409, `status=${after.status}`);
  }

  /* --- 教师统计 / 设置 --- */
  {
    const r = await teacher('GET', '/api/teacher/stats');
    const s = r.data.students || [];
    ok('30 学情统计返回练习次数', r.status === 200 && s.some(x => x.attempts > 0),
      `attempts=${s.map(x => x.attempts).join(',')}`);
  }
  {
    const r = await teacher('POST', '/api/settings/llm', {
      enabled: false, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: ''
    });
    ok('31 大模型设置可保存', r.status === 200);
    const g = await teacher('GET', '/api/settings');
    ok('32 密钥不回传明文', !('apiKey' in (g.data.llm || {})) || !g.data.llm.apiKey);
  }
  {
    const r = await teacher('POST', '/api/settings/platform', {
      requireRoster: true, siteName: '测试站点', announce: '本周实验：流水灯'
    });
    const i = await guest('GET', '/api/info');
    ok('33 平台设置生效（站点名/公告）', i.data.siteName === '测试站点' && i.data.announce.includes('流水灯'));
  }
  {
    const r = await student('GET', '/api/teacher/students');
    ok('34 学生无法访问教师接口（403）', r.status === 403);
  }
  {
    const r = await guest('POST', '/api/compile', { code: 'int main(){}' });
    ok('35 未登录不能调用编译（401）', r.status === 401);
  }

  /* --- 静态资源 --- */
  {
    const r = await fetch(BASE + '/');
    const t = await r.text();
    ok('36 首页可访问且挂载了 app.js', r.ok && t.includes('js/app.js') && t.includes('id="appView"'));
  }
  {
    const r = await fetch(BASE + '/css/app.css');
    ok('37 样式表可访问', r.ok && (await r.text()).includes('--primary'));
  }
  {
    const r = await fetch(BASE + '/js/ui/view-sim.js');
    ok('38 前端模块可访问', r.ok);
  }
} catch (e) {
  fail++;
  rows.push(`  [ERR ] ${e.message}`);
}

console.log('\n===== 服务端 API 与数据库端到端测试 =====\n');
console.log(`  实例：${BASE}  数据库：临时文件`);
console.log(rows.join('\n'));
console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
cleanup(fail === 0 ? 0 : 1);
