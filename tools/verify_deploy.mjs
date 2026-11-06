/**
 * verify_deploy.mjs — 云端部署核查
 * ==================================================================
 * 用途：发布后一条命令确认"线上到底是不是最新版本、能不能用"。
 * 不依赖任何第三方库，只用 Node 内置 fetch。
 *
 * 用法：
 *   node tools/verify_deploy.mjs <分享链接> <教师密码>
 * 例：
 *   node tools/verify_deploy.mjs "https://xxx.app.workbuddy.host/?sharecode=ABC" Mcu5532Lab417
 *
 * 检查项：
 *   1. 站点可达（HTTP 200 且返回平台首页）
 *   2. 分享码会话有效（无分享码应被网关拒绝）
 *   3. 教师登录
 *   4. 新版本必须存在的能力（缺任何一项即判定为"旧版本"）
 *   5. 编译器可用性（云端应内置 Linux 版 SDCC）
 */
const [, , linkArg, pwdArg] = process.argv;
if (!linkArg) {
  console.log('用法: node tools/verify_deploy.mjs "<分享链接>" [教师密码]');
  process.exit(2);
}

const url = new URL(linkArg);
const share = url.searchParams.get('sharecode') || '';
const base = url.origin;
const password = pwdArg || process.env.MCULAB_TEACHER_PWD || '';

/*
 * Cookie 罐：网关的分享码 cookie 前缀不固定（不是 mculab_ 开头），
 * 必须把响应里的**所有** Set-Cookie 都收下来，否则后续请求会全部 403。
 */
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
function absorb(r) {
  const list = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  for (const c of list) {
    const nv = c.split(';')[0];
    const i = nv.indexOf('=');
    if (i > 0) jar.set(nv.slice(0, i).trim(), nv.slice(i + 1).trim());
  }
}
const rows = [];
const add = (name, ok, detail = '') => rows.push({ name, ok, detail });

async function req(path, opts = {}) {
  const h = { ...(opts.headers || {}) };
  const ck = cookieHeader();
  if (ck) h.Cookie = ck;
  const r = await fetch(base + path, { ...opts, headers: h, redirect: 'follow' });
  absorb(r);
  return r;
}
async function json(path, opts) {
  const r = await req(path, opts);
  let d = null;
  try { d = await r.json(); } catch { }
  return { s: r.status, d };
}

/* 1. 拿分享码会话 */
let ok = false, body = '';
try {
  const r = await fetch(`${base}/${share ? '?sharecode=' + encodeURIComponent(share) : ''}`, {
    headers: { 'Accept': 'text/html' }, redirect: 'follow'
  });
  absorb(r);
  body = await r.text();
  ok = r.status === 200 && /<title>[^<]*教学仿真实验平台/.test(body);
  add('站点可达并返回平台首页', ok, `HTTP ${r.status}`);
} catch (e) {
  add('站点可达并返回平台首页', false, e.message);
}

/* 2. 无分享码应被拒绝 */
if (share) {
  try {
    const r = await fetch(base + '/');
    const t = await r.text();
    const refused = r.status >= 400 || /链接不完整|链接已失效/.test(t);
    add('无分享码时被网关拒绝（预期行为）', refused, `HTTP ${r.status}`);
  } catch (e) { add('分享码校验', false, e.message); }
}

/* 3. 登录 */
if (password) {
  const r = await json('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'teacher', password })
  });
  add('教师账号可登录', r.s === 200 && !!r.d?.user, r.s === 200 ? `角色 ${r.d.user.role}` : (r.d?.error || `HTTP ${r.s}`));
} else {
  add('教师账号可登录', null, '未提供密码，跳过');
}

/* 4. 版本能力探测：新功能接口必须存在 */
const features = [
  ['实验任务', '/api/teacher/assignments'],
  ['成绩册', '/api/gradebook'],
  ['开放性命题', '/api/open-problems'],
  ['AI 知识库', '/api/kb/docs'],
  ['联网搜索配置', '/api/websearch/config'],
  ['高频错误统计', '/api/teacher/errors']
];
let newCount = 0, blocked = 0;
for (const [label, path] of features) {
  const r = await json(path);
  // 404 = 路由不存在（旧版本）；403/401 = 被网关或权限挡住，无法判断
  if (r.s === 404) add(`能力：${label}`, false, '接口不存在（旧版本）');
  else if (r.s === 403 || r.s === 401) { blocked++; add(`能力：${label}`, null, `HTTP ${r.s}（会话无效，无法判断）`); }
  else { newCount++; add(`能力：${label}`, true, `HTTP ${r.s}`); }
}
add('判定为新版本', blocked ? null : (newCount === features.length),
  blocked ? `${blocked} 项因会话无效无法判断` : `${newCount}/${features.length} 项能力就绪`);

/* 5. 编译器 */
const st = await json('/api/compiler/status');
if (st.s === 403 || st.s === 401) add('云端 C 编译器可用', null, `HTTP ${st.s}（会话无效）`);
else add('云端 C 编译器可用', st.d?.sdccUsable === true,
  st.d ? (st.d.sdccUsable ? String(st.d.version || '').slice(0, 40) : (st.d.error || '不可用')) : `HTTP ${st.s}`);

/* 输出 */
const pad = (s, n) => String(s).padEnd(n, ' ');
console.log('\n===== 云端部署核查 =====');
console.log('地址 :', base);
console.log('分享码:', share || '(无)');
console.log('');
for (const r of rows) {
  const mark = r.ok === null ? '–' : (r.ok ? '✓' : '✗');
  console.log(`  ${mark} ${pad(r.name, 34)} ${r.detail}`);
}
const failed = rows.filter(r => r.ok === false);
console.log('');
console.log(failed.length ? `结果：${failed.length} 项未通过` : '结果：全部通过');
process.exit(failed.length ? 1 : 0);
