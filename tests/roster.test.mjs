/**
 * roster.test.mjs — 名单准入与注册安全测试
 * ==================================================================
 * 起源：用户反馈"不在名单中的学生也可以登录注册"。
 * 实测确实存在三条绕过路径 + 一条隐蔽的设置失效路径：
 *
 *   ① 完全不填学号            → 原先 200（校验被 `if (no && ...)` 短路）
 *   ② 学号填空串              → 原先 200（同上）
 *   ③ 班级留空 + 借用他人在册学号 → 原先 200，还产生"同一学号两个账号"
 *   ④ 教师只改"站点名称"点保存 → 布尔被存成 "true"，与 '1' 比较失败，校验静默关闭
 *
 * 本套件把每一条都钉住。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 19800 + Math.floor(Math.random() * 150);
const DB = path.join(os.tmpdir(), `mculab-roster-${Date.now()}.db`);
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
if (!up) { console.log('服务启动失败：\n' + log.slice(0, 1200)); done(2); }

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
const asGuest = (fn) => { const saved = cookie; cookie = ''; return Promise.resolve(fn()).finally(() => { cookie = saved; }); };

try {
  /* ---------------- 准备：教师导入 2 人 ---------------- */
  await req('POST', '/api/auth/login', { username: 'teacher', password: 'teacher123' });
  const imp = await req('POST', '/api/teacher/students/import', {
    text: '学号,姓名,班级\n2026001,张三,自动化2601\n2026002,李四,自动化2601'
  });
  ok('0 教师导入 2 名学生', imp.s === 200 && imp.d.result.created === 2,
    JSON.stringify(imp.d.result).slice(0, 100));

  /* ---------------- A. 名单内学号但用了别的账号名 ---------------- */
  {
    cookie = '';
    const r = await req('POST', '/api/auth/register', {
      username: 'stu_alias', password: 'abc123', studentNo: '2026001', className: '自动化2601'
    });
    ok('A1 名单内学号已开通账号时，不允许再建别名账号', r.s === 409, `HTTP ${r.s} ${JSON.stringify(r.d).slice(0, 80)}`);
    ok('A2 提示里给出了正确做法（用该账号/学号登录）',
      /已开通账号/.test(JSON.stringify(r.d)) && /2026001/.test(JSON.stringify(r.d)));
  }

  /* ---------------- B. 用学号作为账号名 → 认领 ---------------- */
  {
    cookie = '';
    const r = await req('POST', '/api/auth/register', {
      username: '2026001', password: 'abc123', studentNo: '2026001', className: '自动化2601'
    });
    ok('B1 用学号作账号名可认领预建账号', r.s === 200 && r.d.user && r.d.claimed === true,
      `HTTP ${r.s} ${JSON.stringify(r.d).slice(0, 80)}`);
    const me = await req('GET', '/api/me');
    ok('B2 认领后会话有效', me.d.user && me.d.user.username === '2026001');
  }

  /* ---------------- C~G. 名单校验的四条绕过路径 ---------------- */
  {
    cookie = '';
    const r = await req('POST', '/api/auth/register', {
      username: 'x1', password: 'abc123', studentNo: '9999999', className: '自动化2601'
    });
    ok('C1 名单外学号 → 403', r.s === 403, `HTTP ${r.s}`);
  }
  {
    cookie = '';
    const r = await req('POST', '/api/auth/register', { username: 'x2', password: 'abc123' });
    ok('C2 不填学号 → 400（原先可绕过）', r.s === 400, `HTTP ${r.s} ${JSON.stringify(r.d).slice(0, 70)}`);
  }
  {
    cookie = '';
    const r = await req('POST', '/api/auth/register', {
      username: 'x3', password: 'abc123', studentNo: '', className: '自动化2601'
    });
    ok('C3 学号空串 → 400（原先可绕过）', r.s === 400, `HTTP ${r.s}`);
  }
  {
    cookie = '';
    const r = await req('POST', '/api/auth/register', {
      username: 'x4', password: 'abc123', studentNo: '2026002', className: ''
    });
    ok('C4 班级留空 → 400（原先可绕过并产生重复学号）', r.s === 400, `HTTP ${r.s}`);
  }
  {
    cookie = '';
    const r = await req('POST', '/api/auth/register', {
      username: 'x5', password: 'abc123', studentNo: '2026002', className: '乱填班级'
    });
    ok('C5 班级不匹配 → 403', r.s === 403, `HTTP ${r.s}`);
  }

  /* ---------------- D. 冒名与重复学号 ---------------- */
  {
    cookie = '';
    const r = await req('POST', '/api/auth/register', {
      username: '2026002', password: 'abc123', studentNo: '8888888', className: '自动化2601'
    });
    ok('D1 用他人学号作账号名 + 自己的学号 → 被拒绝（403 名单校验先行 / 409 账号冲突）',
      r.s === 403 || r.s === 409, `HTTP ${r.s}`);
  }
  {
    cookie = '';
    // 2026001 已被认领；再注册同一学号（不同账号名）必须被拒
    const r = await req('POST', '/api/auth/register', {
      username: 'dup_one', password: 'abc123', studentNo: '2026001', className: '自动化2601'
    });
    ok('D2 同一学号不能注册第二个账号', r.s === 409, `HTTP ${r.s}`);
  }

  /* ---------------- D3. 账号劫持：认领只能发生一次 ---------------- */
  {
    // 2026001 在 B1 里已被本人认领（已设置密码）
    cookie = '';
    const hijack = await req('POST', '/api/auth/register', {
      username: '2026001', password: 'HACKED1', studentNo: '2026001', className: '自动化2601'
    });
    ok('D3 已激活的学号不能被再次"认领"改密', hijack.s === 409,
      `HTTP ${hijack.s} ${JSON.stringify(hijack.d).slice(0, 80)}`);
    cookie = '';
    const stillOld = await req('POST', '/api/auth/login', { username: '2026001', password: 'abc123' });
    ok('D4 原密码仍然有效（未被劫持覆盖）', stillOld.s === 200, `HTTP ${stillOld.s}`);
    cookie = '';
    const notHacked = await req('POST', '/api/auth/login', { username: '2026001', password: 'HACKED1' });
    ok('D5 攻击者的新密码无效', notHacked.s === 401, `HTTP ${notHacked.s}`);
  }

  /* ---------------- E. 全角输入归一化 ---------------- */
  {
    cookie = '';
    const r = await req('POST', '/api/auth/register', {
      username: '２０２６００２', password: 'abc123', studentNo: '２０２６００２', className: '自动化２６０１'
    });
    ok('E1 全角学号/班级/账号可正常匹配名单', r.s === 200, `HTTP ${r.s} ${JSON.stringify(r.d).slice(0, 70)}`);
  }

  /* ---------------- F. 教师设置项真的生效且可逆 ---------------- */
  {
    // F1：只改站点名（不动复选框）——名单校验必须仍然有效
    await req('POST', '/api/settings/platform', { requireRoster: true, allowSelfRegister: true, siteName: '改名后的站点' });
    const info = await req('GET', '/api/info');
    ok('F1 保存平台设置后 requireRoster 仍为 true（布尔不被存成字符串）',
      info.d.requireRoster === true, String(info.d.requireRoster));
    cookie = '';
    const r = await req('POST', '/api/auth/register', {
      username: 'after_save', password: 'abc123', studentNo: '7777777', className: '自动化2601'
    });
    ok('F2 保存设置之后，名单外注册仍被拒绝', r.s === 403, `HTTP ${r.s}`);
  }
  {
    // F3：关闭名单校验 → 允许自由注册（学号可空）
    await req('POST', '/api/auth/login', { username: 'teacher', password: 'teacher123' });
    await req('POST', '/api/settings/platform', { requireRoster: false });
    cookie = '';
    const r = await req('POST', '/api/auth/register', { username: 'free_user', password: 'abc123' });
    ok('F3 关闭名单校验后可自由注册（学号可留空）', r.s === 200, `HTTP ${r.s} ${JSON.stringify(r.d).slice(0, 70)}`);
  }
  {
    // F4：重新打开 → 立即恢复拦截
    await req('POST', '/api/auth/login', { username: 'teacher', password: 'teacher123' });
    await req('POST', '/api/settings/platform', { requireRoster: true });
    cookie = '';
    const r = await req('POST', '/api/auth/register', {
      username: 'free_user2', password: 'abc123', studentNo: '6666666', className: '自动化2601'
    });
    ok('F4 重新开启后立即恢复拦截（开关可逆）', r.s === 403, `HTTP ${r.s}`);
  }
  {
    // F5：关闭自助注册 → 整个注册入口失效
    await req('POST', '/api/auth/login', { username: 'teacher', password: 'teacher123' });
    await req('POST', '/api/settings/platform', { allowSelfRegister: false });
    cookie = '';
    const r = await req('POST', '/api/auth/register', {
      username: '2026002', password: 'abc123', studentNo: '2026002', className: '自动化2601'
    });
    ok('F5 关闭自助注册后，连名单内学生也不能注册', r.s === 403, `HTTP ${r.s}`);
    await req('POST', '/api/auth/login', { username: 'teacher', password: 'teacher123' });
    await req('POST', '/api/settings/platform', { allowSelfRegister: true });
  }

  /* ---------------- G. 账号总数核对 ---------------- */
  {
    await req('POST', '/api/auth/login', { username: 'teacher', password: 'teacher123' });
    const st = await req('GET', '/api/teacher/students');
    const list = st.d.students || [];
    const nos = list.map(s => s.student_no).filter(Boolean);
    const dupNo = nos.filter((v, i) => nos.indexOf(v) !== i);
    ok('G1 学号唯一（无重复绑定）', dupNo.length === 0, `重复：${[...new Set(dupNo)].join(',')}`);
    ok('G2 未产生越权账号（名字带 x1~x5 的均未建成）',
      !list.some(s => /^x[1-5]$/.test(s.username)), list.map(s => s.username).join(','));
    ok('G3 账号数符合预期（2 名在册 + 1 名自由注册）', list.length === 3,
      `实际 ${list.length}：${list.map(s => s.username + '/' + (s.student_no || '无')).join(', ')}`);
  }
} catch (e) {
  fail++; rows.push(`  [ERR ] ${e.message}`);
}

console.log('\n===== 名单准入与注册安全测试 =====\n');
console.log(rows.join('\n'));
console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
done(fail === 0 ? 0 : 1);
