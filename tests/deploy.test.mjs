/**
 * deploy.test.mjs — 部署关键假设测试
 * ==================================================================
 * 目标：在没有 Docker 的开发机上，也能验证"换台服务器能不能跑"这件事。
 *
 * 覆盖：
 *   A. 云平台约定：只注入 PORT 环境变量（不传 --port）也能正确监听
 *   B. 数据目录可迁移：MCULAB_DATA 指向别处时，数据库确实建在那里
 *   C. 无 SDCC 的服务器：/api/compiler/status 如实报告；编译给出**准确**原因
 *      而不是误导性的"环境禁止子进程"
 *   D. 降级通路仍可用：无 SDCC 时 __ASM__ 汇编编译照常工作
 *   E. 健康检查与静态资源在自定义端口下正常
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const rows = [];
const ok = (n, c, e = '') => { if (c) { pass++; rows.push(`  [PASS] ${n}`); } else { fail++; rows.push(`  [FAIL] ${n}${e ? '  → ' + e : ''}`); } };

const kids = [];
const tmps = [];
function tmpDir(prefix) { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); tmps.push(d); return d; }

async function startServer(env, port) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  kids.push(child);
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return { child, log: () => log }; } catch { }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('服务未在预期端口启动：' + log.slice(0, 600));
}
function stopAll() {
  for (const k of kids) { try { k.kill(); } catch { } }
  for (const d of tmps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { } }
}

try {
  /* ---------------- A + B：PORT / MCULAB_DATA ---------------- */
  {
    const P1 = 19900 + Math.floor(Math.random() * 40);
    const dataDir = tmpDir('mculab-data-');
    // 关键：不传 --port，只给 PORT；不传 --host，默认应为 0.0.0.0
    const { log } = await startServer({ PORT: String(P1), MCULAB_DATA: dataDir }, P1);
    ok('A1 仅靠 PORT 环境变量即可正确监听', true, `port=${P1}`);
    const info = await (await fetch(`http://127.0.0.1:${P1}/api/info`)).json();
    ok('A2 服务正常响应 /api/info', !!info.siteName);
    const bootLog = log();
    ok('A3 启动日志显示监听 0.0.0.0（容器/反代必需）', /0\.0\.0\.0/.test(bootLog), bootLog.split('\n').find(l => l.includes('监听')) || '');
    ok('B1 MCULAB_DATA 生效：数据库建在指定目录',
      fs.existsSync(path.join(dataDir, 'mculab.db')),
      fs.readdirSync(dataDir).join(','));
    const st = await (await fetch(`http://127.0.0.1:${P1}/api/compiler/status`)).json();
    ok('B2 本机工具链在自定义配置下仍可用', st.sdccUsable === true, JSON.stringify(st).slice(0, 100));
  }

  /* ---------------- C + D：没有 SDCC 的服务器 ---------------- */
  {
    const P2 = 19940 + Math.floor(Math.random() * 40);
    const dataDir = tmpDir('mculab-nosdcc-data-');
    const emptyBin = tmpDir('mculab-emptybin-');
    // 指向一个空目录，且本机 PATH 里没有 sdcc → 模拟"云服务器未装编译器"
    const { log } = await startServer({
      PORT: String(P2), MCULAB_DATA: dataDir,
      MCULAB_SDCC_BIN: emptyBin, PATH: (process.env.PATH || '')
    }, P2);

    const st = await (await fetch(`http://127.0.0.1:${P2}/api/compiler/status`)).json();
    ok('C1 无 SDCC 时状态接口如实报告不可用', st.sdccUsable === false, JSON.stringify(st).slice(0, 120));

    // 登录后尝试编译 C
    const login = await fetch(`http://127.0.0.1:${P2}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher', password: 'teacher123' })
    });
    const cookie = (login.headers.getSetCookie ? login.headers.getSetCookie() : [])
      .find(c => c.startsWith('mculab_token='))?.split(';')[0] || '';

    const r = await fetch(`http://127.0.0.1:${P2}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ code: '#include <8051.h>\nvoid main(void){P1=0xFE;}' })
    });
    const j = await r.json();
    const msg = (j.errors && j.errors[0] && j.errors[0].msg) || '';
    ok('C2 无 SDCC 时编译失败但服务不崩', r.status === 200 && j.ok === false, JSON.stringify(j).slice(0, 100));
    ok('C3 错误信息指向"没有 SDCC"这一真实原因', /SDCC/.test(msg) && /apt install sdcc|Docker/.test(msg), msg.slice(0, 120));
    ok('C4 不再误报"环境禁止派生子进程"', !/禁止派生子进程/.test(msg), msg.slice(0, 90));

    // D：汇编降级通路仍然可用
    const a = await fetch(`http://127.0.0.1:${P2}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ code: '__ASM__\nORG 0\nLJMP s\nORG 0x30\ns: MOV P1,#0x55\nSJMP s\n' })
    });
    const aj = await a.json();
    ok('D1 无 SDCC 时 __ASM__ 汇编通路仍可用', aj.ok === true && aj.via === 'assembler',
      `${aj.via} ${aj.errors?.[0]?.msg || ''}`);
    ok('D2 汇编产物是合法 HEX', !!aj.hex && aj.hex.trimEnd().endsWith(':00000001FF'));

    // E：静态资源在新端口下正常
    const page = await fetch(`http://127.0.0.1:${P2}/`);
    ok('E1 首页可访问', page.ok && (await page.text()).includes('js/app.js'));
    const css = await fetch(`http://127.0.0.1:${P2}/css/app.css`);
    ok('E2 静态资源可访问', css.ok);
  }
} catch (e) {
  fail++; rows.push(`  [ERR ] ${e.message}`);
} finally {
  stopAll();
}

console.log('\n===== 部署关键假设测试（PORT / 数据目录 / 无 SDCC 降级）=====\n');
console.log(rows.join('\n'));
console.log(`\n结果: ${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
