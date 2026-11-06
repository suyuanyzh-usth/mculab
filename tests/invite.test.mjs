/**
 * invite.test.mjs — 教师注册与邀请码
 * ==================================================================
 * 规则（防学生冒用教师身份）：
 *   · 教师可自助注册，但必须凭已有教师签发的邀请码；
 *   · 首位教师（初始化账号）自动获得初始邀请码；
 *   · 每位教师都有自己的邀请码，可邀请同事；
 *   · 邀请码可重新生成，旧码立即失效。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 19600 + Math.floor(Math.random() * 60);
const DB = path.join(os.tmpdir(), `mculab-invite-${Date.now()}.db`);
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

try {
  /* 1. 首位教师自动获得邀请码 */
  await req('POST', '/api/auth/login', { username: 'teacher', password: 'teacher123' });
  const inv = await req('GET', '/api/teacher/invite');
  ok('1 首位教师自动拥有邀请码', inv.s === 200 && /^MCU-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(inv.d.code || ''),
    JSON.stringify(inv.d).slice(0, 80));
  const CODE = inv.d.code;

  /* 2. 无邀请码 / 错误邀请码不能注册教师 */
  cookie = '';
  let r = await req('POST', '/api/auth/register-teacher', { username: 'tx1', password: 'abcdef' });
  ok('2 无邀请码 → 400', r.s === 400, `HTTP ${r.s}`);

  r = await req('POST', '/api/auth/register-teacher', { username: 'tx1', password: 'abcdef', inviteCode: 'MCU-ZZZZ-ZZZZ' });
  ok('3 错误邀请码 → 403', r.s === 403, `HTTP ${r.s}`);

  /* 4. 正确邀请码可注册，且注册者获得自己的码 */
  r = await req('POST', '/api/auth/register-teacher', { username: 'tx1', password: 'abcdef', name: '王老师', inviteCode: CODE.toLowerCase() });
  ok('4 正确邀请码（小写也能识别）→ 200', r.s === 200, `HTTP ${r.s} ${JSON.stringify(r.d).slice(0, 60)}`);
  ok('5 新教师获得独立邀请码', !!r.d.inviteCode && r.d.inviteCode !== CODE, r.d && r.d.inviteCode);
  const NEW_CODE = r.d.inviteCode;

  /* 6. 新教师可登录，角色为 teacher */
  cookie = '';
  r = await req('POST', '/api/auth/login', { username: 'tx1', password: 'abcdef' });
  ok('6 新教师可登录且角色为教师', r.s === 200 && r.d.user && r.d.user.role === 'teacher', `HTTP ${r.s}`);
  const inv2 = await req('GET', '/api/teacher/invite');
  ok('7 新教师能读到自己的邀请码', inv2.d.code === NEW_CODE, inv2.d.code);

  /* 8. 重新生成后旧码失效、新码可用（由码的主人操作） */
  cookie = '';
  await req('POST', '/api/auth/login', { username: 'teacher', password: 'teacher123' });
  const rg = await req('POST', '/api/teacher/invite/regenerate');
  ok('8 重新生成返回新码', rg.s === 200 && rg.d.code !== CODE, rg.d && rg.d.code);

  cookie = '';
  const oldTry = await req('POST', '/api/auth/register-teacher', { username: 'tx2', password: 'abcdef', inviteCode: CODE });
  ok('9 旧码立即失效（403）', oldTry.s === 403, `HTTP ${oldTry.s}`);

  cookie = '';
  const newTry = await req('POST', '/api/auth/register-teacher', { username: 'tx2', password: 'abcdef', inviteCode: rg.d.code });
  ok('10 新码可注册', newTry.s === 200, `HTTP ${newTry.s}`);

  /* 11. 学生注册不受影响（回归） */
  cookie = '';
  const stu = await req('POST', '/api/auth/register', { username: 'stu_x', password: 'abcdef' });
  ok('11 学生注册仍走原有名单规则（非 200 即被名单拦截）', stu.s === 403 || stu.s === 400,
    `HTTP ${stu.s} ${JSON.stringify(stu.d).slice(0, 60)}`);

  /* 12. 未登录不能读邀请码 */
  cookie = '';
  const anon = await req('GET', '/api/teacher/invite');
  ok('12 未登录读不到邀请码（401/403）', anon.s === 401 || anon.s === 403, `HTTP ${anon.s}`);
} catch (e) {
  fail++; rows.push(`  [ERR ] ${e.message}`);
}

console.log('\n===== 教师注册与邀请码 =====\n');
console.log(rows.join('\n'));
console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
done(fail === 0 ? 0 : 1);
