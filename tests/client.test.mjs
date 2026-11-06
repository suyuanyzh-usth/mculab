/**
 * client.test.mjs — 前端 API 客户端契约测试
 * ==================================================================
 * 这个套件专门锁住一类"浏览器里才出现、Node 里不会报"的缺陷。
 *
 * 起源：用户反馈"点击登录后无法登录并跳转"。
 * 根因是 api() 把所有 401 都当作"会话过期"，于是密码输错时提示的是
 * "登录已过期，请重新登录"，提示一闪而过，用户以为按钮没反应。
 *
 * 覆盖：
 *   A. 凭据归一化（全角→半角、零宽字符、首尾空白）
 *   B. 登录接口 401 → authFailed，且不得触发全局"踢回登录"处理
 *   C. 其它接口 401 → 仍按会话过期处理（不能把这条安全逻辑改坏）
 *   D. 服务端错误消息优先于兜底文案
 *   E. 离线错误带 offline 标记（供离线续用逻辑识别）
 */
import { api, normalizeCredential, setUnauthorizedHandler } from '../public/js/ui/core.js';

let pass = 0, fail = 0;
const rows = [];
const ok = (n, c, e = '') => { if (c) { pass++; rows.push(`  [PASS] ${n}`); } else { fail++; rows.push(`  [FAIL] ${n}${e ? '  → ' + e : ''}`); } };

const realFetch = globalThis.fetch;
function stub(status, body) {
  globalThis.fetch = async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' }
  });
}

try {
  /* ---------------- A. 归一化 ---------------- */
  {
    ok('A1 全角字母转半角', normalizeCredential('ｔｅａｃｈｅｒ') === 'teacher',
      normalizeCredential('ｔｅａｃｈｅｒ'));
    ok('A2 全角数字转半角', normalizeCredential('１２３４５６') === '123456');
    ok('A3 全角空格与首尾空白被去掉', normalizeCredential('　 teacher 　') === 'teacher',
      JSON.stringify(normalizeCredential('　 teacher 　')));
    ok('A4 零宽字符被移除', normalizeCredential('tea\u200Bcher\uFEFF') === 'teacher');
    ok('A5 正常输入不被改动', normalizeCredential('teacher123') === 'teacher123');
    ok('A6 null/undefined 安全', normalizeCredential(null) === '' && normalizeCredential(undefined) === '');
  }

  /* ---------------- B/C. 401 语义 ---------------- */
  {
    let kicked = 0;
    setUnauthorizedHandler(() => { kicked++; });

    stub(401, { error: '账号或密码错误' });
    let err = null;
    try { await api('/api/auth/login', { method: 'POST', body: { username: 'x', password: 'y' } }); }
    catch (e) { err = e; }
    ok('B1 登录 401 抛出异常', !!err);
    ok('B2 错误标记为 authFailed（不是会话失效）', err && err.authFailed === true);
    ok('B3 提示文案取服务端的"账号或密码错误"',
      err && err.message === '账号或密码错误', err && err.message);
    ok('B4 登录失败不得触发全局踢回登录页', kicked === 0, `kicked=${kicked}`);

    kicked = 0;
    stub(401, { error: '登录已过期' });
    let err2 = null;
    try { await api('/api/problems'); } catch (e) { err2 = e; }
    ok('C1 普通接口 401 仍然踢回登录页', kicked === 1, `kicked=${kicked}`);
    ok('C2 普通接口 401 不带 authFailed', err2 && !err2.authFailed);
  }

  /* ---------------- B5. 注册接口同属"凭据尝试" ---------------- */
  {
    let kicked = 0;
    setUnauthorizedHandler(() => { kicked++; });
    stub(401, { error: '账号或密码不正确' });
    let e3 = null;
    try { await api('/api/auth/register', { method: 'POST', body: {} }); } catch (e) { e3 = e; }
    ok('B5 注册 401 也按凭据错误处理，不踢人', e3 && e3.authFailed === true && kicked === 0);
  }

  /* ---------------- D. 其它状态码 ---------------- */
  {
    stub(403, { error: '你的学号未在教师导入的名单中' });
    let e4 = null;
    try { await api('/api/auth/register', { method: 'POST', body: {} }); } catch (e) { e4 = e; }
    ok('D1 403 透传服务端文案', e4 && /名单/.test(e4.message), e4 && e4.message);
    ok('D2 403 不算凭据失败', e4 && !e4.authFailed);

    stub(500, {});
    let e5 = null;
    try { await api('/api/problems'); } catch (e) { e5 = e; }
    ok('D3 5xx 有兜底文案', e5 && /请求失败/.test(e5.message), e5 && e5.message);
  }

  /* ---------------- E. 网络失败 ---------------- */
  {
    const prevOnLine = Object.getOwnPropertyDescriptor(globalThis.navigator || {}, 'onLine');
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    let e6 = null;
    try { await api('/api/me'); } catch (e) { e6 = e; }
    ok('E1 网络失败标记 offline（供离线续用）', e6 && e6.offline === true);
    ok('E2 网络失败提示可读', e6 && /网络|离线/.test(e6.message), e6 && e6.message);
  }
} catch (e) {
  fail++; rows.push(`  [ERR ] ${e.message}`);
} finally {
  globalThis.fetch = realFetch;
}

console.log('\n===== 前端 API 客户端契约测试 =====\n');
console.log(rows.join('\n'));
console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
