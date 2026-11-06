/**
 * network.test.mjs — 网络适应性测试
 * ==================================================================
 * "任意网络都能用"不是一句话，而是可验证的行为。本套件锁定：
 *   A. 健康检查（反向代理/云平台探活）
 *   B. gzip 压缩（弱网/流量）——文本资源必须显著变小
 *   C. ETag / 304（二次访问近零传输）
 *   D. 缓存分级（vendor 长缓存；业务代码 no-cache，保证教师迭代即生效）
 *   E. PWA 资产（manifest MIME 正确、sw.js 可访问、图标存在）
 *   F. 反向代理感知（X-Forwarded-Proto: https → Cookie 加 Secure）
 *   G. 安全响应头
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 19500 + Math.floor(Math.random() * 400);
const DBFILE = path.join(os.tmpdir(), `mculab-net-${Date.now()}.db`);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const rows = [];
const ok = (n, c, e = '') => { if (c) { pass++; rows.push(`  [PASS] ${n}`); } else { fail++; rows.push(`  [FAIL] ${n}${e ? '  → ' + e : ''}`); } };

const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js'), '--port', String(PORT), '--host', '127.0.0.1'], {
  env: { ...process.env, MCULAB_DB: DBFILE },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
child.stdout.on('data', d => log += d);
child.stderr.on('data', d => log += d);

function done(code) {
  try { child.kill(); } catch { }
  try { fs.rmSync(DBFILE, { force: true }); } catch { }
  process.exit(code);
}

let up = false;
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(BASE + '/api/health'); if (r.ok) { up = true; break; } } catch { }
  await new Promise(r => setTimeout(r, 250));
}
if (!up) { console.log('服务启动失败：\n' + log.slice(0, 1500)); done(2); }

const GZ = { headers: { 'Accept-Encoding': 'gzip' } };

try {
  /* ---------------- A. 健康检查 ---------------- */
  {
    const r = await fetch(BASE + '/api/health');
    const j = await r.json();
    ok('A1 /api/health 无需登录即可探活', r.ok && j.ok === true);
  }

  /* ---------------- B. gzip ---------------- */
  {
    // 必须用 identity 取原始体积：Node 的 fetch 默认就带 gzip 并自动解压，
    // 若两次都用默认，content-length 都是压缩后的长度，比较将毫无意义。
    const raw = await fetch(BASE + '/vendor/codemirror/codemirror.js', { headers: { 'Accept-Encoding': 'identity' } });
    const gz = await fetch(BASE + '/vendor/codemirror/codemirror.js', GZ);
    const rawLen = Number(raw.headers.get('content-length'));
    const gzLen = Number(gz.headers.get('content-length'));
    ok('B1 支持 gzip（Content-Encoding: gzip）', gz.headers.get('content-encoding') === 'gzip',
      String(gz.headers.get('content-encoding')));
    ok('B2 压缩后体积 < 原体积 40%', gzLen > 0 && gzLen / rawLen < 0.4,
      `${rawLen} → ${gzLen} (${Math.round(gzLen / rawLen * 100)}%)`);
    ok('B3 带 Vary: Accept-Encoding（代理缓存安全）',
      /accept-encoding/i.test(gz.headers.get('vary') || ''));
    const css = await fetch(BASE + '/css/app.css', GZ);
    ok('B4 CSS 同样压缩', css.headers.get('content-encoding') === 'gzip');
  }

  /* ---------------- C. ETag / 304 ---------------- */
  {
    const r1 = await fetch(BASE + '/js/core/cpu8051.js');
    const etag = r1.headers.get('etag');
    ok('C1 静态资源返回 ETag', !!etag, String(etag));
    const r2 = await fetch(BASE + '/js/core/cpu8051.js', { headers: { 'If-None-Match': etag } });
    ok('C2 条件请求返回 304', r2.status === 304, String(r2.status));
    ok('C3 304 无响应体（零传输）', (await r2.text()).length === 0);
  }

  /* ---------------- D. 缓存分级 ---------------- */
  {
    const v = await fetch(BASE + '/vendor/codemirror/codemirror.js');
    const a = await fetch(BASE + '/js/app.js');
    const h = await fetch(BASE + '/index.html');
    ok('D1 vendor 资源长缓存 immutable',
      /max-age=\d+/.test(v.headers.get('cache-control') || '') && /immutable/.test(v.headers.get('cache-control') || ''),
      v.headers.get('cache-control'));
    ok('D2 业务代码 no-cache（教师改完立即生效）',
      /no-cache/.test(a.headers.get('cache-control') || ''), a.headers.get('cache-control'));
    ok('D3 首页 no-cache', /no-cache/.test(h.headers.get('cache-control') || ''));
  }

  /* ---------------- E. PWA ---------------- */
  {
    const m = await fetch(BASE + '/manifest.webmanifest');
    ok('E1 manifest 可访问且 MIME 正确',
      m.ok && /manifest\+json/.test(m.headers.get('content-type') || ''),
      m.headers.get('content-type'));
    const mj = await m.json();
    ok('E2 manifest 含图标与 standalone 显示', (mj.icons || []).length >= 2 && mj.display === 'standalone');
    const sw = await fetch(BASE + '/sw.js');
    ok('E3 Service Worker 可访问', sw.ok && /javascript/.test(sw.headers.get('content-type') || ''));
    const ic = await fetch(BASE + '/icons/icon-192.png');
    ok('E4 图标为 PNG 且大小合理', ic.ok && ic.headers.get('content-type') === 'image/png'
      && Number(ic.headers.get('content-length')) > 500);
  }

  /* ---------------- F. 反代感知 ---------------- */
  {
    const r = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify({ username: 'teacher', password: 'teacher123' })
    });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie().join(';') : (r.headers.get('set-cookie') || '');
    ok('F1 代理声明 https 时 Cookie 加 Secure', /Secure/i.test(sc), sc.slice(0, 90));
    ok('F2 Cookie 始终 HttpOnly', /HttpOnly/i.test(sc));
    const info = await (await fetch(BASE + '/api/info')).json();
    ok('F3 /api/info 报告 secure 状态', typeof info.secure === 'boolean' && info.tls === false);
  }

  /* ---------------- G. 安全响应头 ---------------- */
  {
    const r = await fetch(BASE + '/');
    ok('G1 X-Content-Type-Options: nosniff', r.headers.get('x-content-type-options') === 'nosniff');
    ok('G2 Referrer-Policy 已设置', !!r.headers.get('referrer-policy'));
  }

  /* ---------------- H. 大文件/并发基本健康 ---------------- */
  {
    const [a, b, c] = await Promise.all([
      fetch(BASE + '/js/core/cpu8051.js', GZ), fetch(BASE + '/js/core/circuit.js', GZ), fetch(BASE + '/css/app.css', GZ)
    ]);
    ok('H1 并发请求均成功', a.ok && b.ok && c.ok);
  }
} catch (e) {
  fail++; rows.push(`  [ERR ] ${e.message}`);
}

console.log('\n===== 网络适应性测试（gzip / 304 / PWA / 反代感知）=====\n');
console.log(rows.join('\n'));
console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
done(fail === 0 ? 0 : 1);
