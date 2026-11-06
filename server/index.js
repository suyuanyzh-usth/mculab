/*
 * index.js — 平台服务端（零 npm 依赖，仅使用 Node 内置模块）
 * ==================================================================
 * 启动：  node server/index.js [--port 8080] [--host 0.0.0.0]
 * 职责：
 *   · 静态资源托管（public/）
 *   · 账号体系（教师 / 学生，scrypt 加盐哈希）
 *   · 班级-学生批量导入、初始密码管理
 *   · 编译服务（SDCC → .hex，含内置汇编器降级通路）
 *   · 练习记录 / 学情统计
 *   · 提问与答疑（含大模型代理、离线规则助教降级）
 *   · 原理图作品存储
 *
 * 公网/内网部署：默认监听 0.0.0.0，同一局域网内直接可用；
 * 公网访问见 docs/部署指南.md（反向代理 / 内网穿透 / 云托管三种方案）。
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { DB, parseStudentTable } from './db.js';
import { Compiler } from './compile.js';
import { LLM, SYSTEM_TUTOR, SYSTEM_TEACHER, LocalTutor } from './llm.js';
import { PROBLEMS, DEFAULT_SETTINGS } from './seed.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
// 数据目录可用 MCULAB_DATA 覆盖（容器里挂载 volume 时更灵活）
const DATA = process.env.MCULAB_DATA || path.join(ROOT, 'data');

/* ---------------------------------------------------------------- 参数 */
const argv = process.argv.slice(2);
const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
// PORT 是云平台/容器平台的事实标准（Heroku、Railway、Render、WorkBuddy 发布沙箱等都会注入），
// 优先级：--port > PORT > MCULAB_PORT > 8080
const PORT = Number(argOf('--port', process.env.PORT || process.env.MCULAB_PORT || 8080));
const HOST = argOf('--host', process.env.MCULAB_HOST || '0.0.0.0');

/* ---------------------------------------------------------------- TLS
 * 直接对外提供 HTTPS（不依赖 Nginx）。
 *   node server/index.js --tls-cert cert.pem --tls-key key.pem
 * 这么做的意义：Web Serial（真机烧录）只在 HTTPS 或 localhost 下可用；
 * 有了内置 TLS，即使没有反向代理，公网访问也能用真机功能。
 */
const TLS_CERT = argOf('--tls-cert', process.env.MCULAB_TLS_CERT || '');
const TLS_KEY = argOf('--tls-key', process.env.MCULAB_TLS_KEY || '');
const TLS = !!(TLS_CERT && TLS_KEY);

/** 是否处于安全上下文：本机 TLS、或反向代理声明了 https */
function isSecureReq(req) {
  if (TLS) return true;
  if (req.socket && req.socket.encrypted) return true;
  const xf = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return xf === 'https';
}
/** 会话 Cookie：在 HTTPS 下自动加 Secure；HttpOnly 始终开启 */
function sessionCookie(req, token, maxAge = 14 * 86400) {
  const secure = isSecureReq(req) ? '; Secure' : '';
  return `mculab_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const db = new DB(process.env.MCULAB_DB || path.join(DATA, 'mculab.db'));
const compiler = new Compiler();
const llm = new LLM(db);

/* ---------------------------------------------------------------- 初始化 */
function bootstrap() {
  // 设置默认值
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (db.getSetting(k) == null) db.setSetting(k, v);
  /*
   * 历史数据迁移：早期版本保存平台设置时用 String(v)，布尔会写成 "true"/"false"，
   * 而校验比较的是 '1'，导致"点一次保存就静默关掉名单校验"。
   * 这里把历史值统一成 '1'/'0'，避免继续靠兼容逻辑兜着。
   */
  for (const key of ['require_roster', 'allow_self_register']) {
    const cur = db.getSetting(key, null);
    if (cur == null) continue;
    const s0 = String(cur).trim().toLowerCase();
    if (s0 === 'true' || s0 === 'on' || s0 === 'yes') db.setSetting(key, '1');
    else if (s0 === 'false' || s0 === 'off' || s0 === 'no') db.setSetting(key, '0');
  }

  // 教师账号
  if (!db.sql.prepare("SELECT COUNT(*) n FROM users WHERE role='teacher'").get().n) {
    const pwd = process.env.MCULAB_TEACHER_PWD || 'teacher123';
    db.createUser({ username: 'teacher', password: pwd, role: 'teacher', name: '授课教师' });
    console.log(`\n  ⚠ 已创建默认教师账号： teacher / ${pwd}\n    请登录后立即在"账号"页修改密码。\n`);
  }
  // 每位教师都必须有一个可用的邀请码（历史库升级后自动补齐）
  for (const t of db.sql.prepare("SELECT id FROM users WHERE role='teacher'").all()) {
    if (!db.activeInviteOf(t.id)) db.createInvite(genInviteCode(), t.id);
  }
  // 题库：以 seed.js 为准做 UPSERT —— 教师升级平台（改题目/起始代码）后
  // 重启服务即可同步到已有数据库，不必删库重来。
  {
    const upsert = db.sql.prepare(`INSERT INTO problems (id,title,chapter,difficulty,statement,starter,tests,preset,hex,order_no)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, chapter=excluded.chapter, difficulty=excluded.difficulty,
        statement=excluded.statement, starter=excluded.starter, tests=excluded.tests,
        preset=excluded.preset, hex=excluded.hex, order_no=excluded.order_no`);
    let added = 0, updated = 0;
    for (const [i, p] of PROBLEMS.entries()) {
      const existed = db.sql.prepare('SELECT 1 FROM problems WHERE id=?').get(p.id);
      upsert.run(p.id, p.title, p.chapter, p.difficulty, p.statement, p.starter,
        JSON.stringify(p.tests || []), p.preset || '', p.hex || '', i);
      existed ? updated++ : added++;
    }
    console.log(`  题库同步：新增 ${added} 个实验，更新 ${updated} 个。`);
  }
}
bootstrap();

/* ---------------------------------------------------------------- 工具 */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.hex': 'text/plain; charset=utf-8', '.c': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.map': 'application/json; charset=utf-8'
};

function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  res.writeHead(code, { 'Content-Length': buf.length, 'Cache-Control': 'no-store', ...headers });
  res.end(buf);
}
const sendJSON = (res, code, obj) => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });

/* ------------------------------------------------------------------
 * 传输优化：gzip + ETag + 分级缓存
 * ------------------------------------------------------------------
 * 目标："任意网络"都能用。首屏原本约 810 KB（CodeMirror 就占 400 KB），
 * 在手机流量 / 校园网拥塞时体验很差。这里做三件事：
 *   1. 文本资源 gzip（实测 810 KB → 约 230 KB），压缩结果按 mtime 缓存，避免重复压缩；
 *   2. 静态资源带 ETag，二次访问走 304（弱网下只传几百字节）；
 *   3. 缓存分级：vendor/（不常变）长缓存；业务代码 no-cache + ETag（教师迭代后立即生效）。
 */
const GZIP_CACHE = new Map();       // key: full + mtime + size  → { gz, br }
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg)/i;

function cachePolicy(rel) {
  // vendor 与预编译 hex 很少变；业务代码必须每次校验（教师随时改）
  if (rel.startsWith('/vendor/')) return 'public, max-age=604800, immutable';
  if (rel.startsWith('/hex/')) return 'public, max-age=3600';
  if (/\.(png|jpg|jpeg|ico|woff2)$/i.test(rel)) return 'public, max-age=604800';
  return 'no-cache';                 // 每次都带 ETag 校验，命中则 304
}

function compress(buf, key) {
  let hit = GZIP_CACHE.get(key);
  if (hit) return hit;
  if (GZIP_CACHE.size > 220) GZIP_CACHE.clear();   // 简单上限，避免无限增长
  hit = {
    gz: buf.length > 1024 ? zlib.gzipSync(buf, { level: 6 }) : null,
    etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20) + '"'
  };
  GZIP_CACHE.set(key, hit);
  return hit;
}

/** 发送静态资源：自动处理 gzip、ETag/304、缓存头 */
function sendAsset(req, res, buf, { type, rel }) {
  const key = rel + '|' + buf.length + '|' + (buf.length ? buf[0] + '' + buf[buf.length - 1] : '');
  const { gz, etag } = compress(buf, key);
  const headers = {
    'Content-Type': type,
    'Cache-Control': cachePolicy(rel),
    'ETag': etag,
    'Vary': 'Accept-Encoding'
  };
  // 条件请求：内容未变直接 304，弱网下这是"零字节"响应
  const inm = req.headers['if-none-match'];
  if (inm && inm.split(',').some(t => t.trim() === etag)) {
    res.writeHead(304, headers);
    return res.end();
  }
  const accept = String(req.headers['accept-encoding'] || '');
  if (gz && COMPRESSIBLE.test(type) && /\bgzip\b/.test(accept)) {
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = gz.length;
    res.writeHead(200, headers);
    return res.end(gz);
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(200, headers);
  res.end(buf);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', d => { n += d.length; if (n > limit) { reject(new Error('请求体过大')); req.destroy(); return; } chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJSON(req) {
  const b = await readBody(req);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { throw new Error('请求体不是合法 JSON'); }
}
function cookies(req) {
  const out = {};
  for (const kv of (req.headers.cookie || '').split(';')) {
    const i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1).trim());
  }
  return out;
}
function currentUser(req) {
  const t = cookies(req).mculab_token || req.headers['x-mculab-token'];
  return db.sessionUser(t);
}
function requireRole(req, res, role) {
  const u = currentUser(req);
  if (!u) { sendJSON(res, 401, { error: '未登录或会话已过期' }); return null; }
  if (!u.active) { sendJSON(res, 403, { error: '账号已被停用，请联系教师' }); return null; }
  if (role && u.role !== role) { sendJSON(res, 403, { error: '无权限' }); return null; }
  return u;
}

/* ---------------------------------------------------------------- 路由表 */
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:[A-Za-z_]\w*/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, opts });
};

/* ============ 认证 ============ */
route('POST', '/api/auth/login', async (req, res) => {
  const { username, password } = await readJSON(req);
  const u = db.getUserByName(normKey(username));
  if (!u || !db.checkPassword(u, String(password || ''))) { db.logEvent(u?.id ?? null, 'login_fail', { username }); return sendJSON(res, 401, { error: '账号或密码错误' }); }
  if (!u.active) return sendJSON(res, 403, { error: '账号已停用，请联系教师' });
  const token = db.createSession(u.id);
  db.touchLogin(u.id); db.logEvent(u.id, 'login', {});
  send(res, 200, JSON.stringify({ user: publicUser(u), token }), {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': sessionCookie(req, token)
  });
});

route('POST', '/api/auth/logout', async (req, res) => {
  const t = cookies(req).mculab_token;
  if (t) db.deleteSession(t);
  send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'mculab_token=; Path=/; Max-Age=0' });
});

route('GET', '/api/me', async (req, res) => {
  const u = currentUser(req);
  if (!u) return sendJSON(res, 200, { user: null });
  sendJSON(res, 200, { user: publicUser(u) });
});

route('POST', '/api/auth/change-password', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const { oldPassword, newPassword } = await readJSON(req);
  if (!db.checkPassword(u, String(oldPassword || ''))) return sendJSON(res, 400, { error: '原密码不正确' });
  const p = String(newPassword || '');
  if (p.length < 6) return sendJSON(res, 400, { error: '新密码至少 6 位' });
  db.setPassword(u.id, p, 0);
  sendJSON(res, 200, { ok: true });
});

/* 学生注册：仅当教师已导入其学号+班级时才允许 */
route('POST', '/api/auth/register', async (req, res) => {
  const b = await readJSON(req);
  const uname = normKey(b.username);
  const no = normKey(b.studentNo);
  const cls = normKey(b.className);
  const name = String(b.name || '').trim();
  const pwd = String(b.password || '');

  if (!uname) return sendJSON(res, 400, { error: '请填写登录账号' });
  if (pwd.length < 6) return sendJSON(res, 400, { error: '密码至少 6 位' });
  if (!settingOn('allow_self_register', true)) {
    return sendJSON(res, 403, { error: '教师已关闭自助注册，请使用教师下发的账号密码登录。' });
  }

  const requireRoster = settingOn('require_roster', true);
  const roster = db.getJSON('roster', []);
  const byNoCls = db.sql.prepare("SELECT * FROM users WHERE role='student' AND student_no=? AND class_name=?");
  const byNo = db.sql.prepare("SELECT * FROM users WHERE role='student' AND student_no=?");

  /*
   * 名单校验。这里曾经有个真实漏洞：
   *   if (no && !inRoster && requireRoster) → 403
   * 学号为空时整段判断被短路，于是"什么学号都不填"就能注册进来。
   * 现在改为：启用名单校验时，学号与班级都必须填写且必须命中名单。
   */
  let preAcct = null;
  if (requireRoster) {
    if (!no) return sendJSON(res, 400, { error: '请填写学号（教师已启用名单校验，学号用于核对身份）' });
    if (!cls) return sendJSON(res, 400, { error: '请填写班级（教师已启用名单校验，班级与学号需同时匹配）' });
    const inRoster = roster.some(r => normKey(r.studentNo) === no && normKey(r.className) === cls);
    preAcct = byNoCls.get(no, cls) || null;
    if (!inRoster && !preAcct) {
      return sendJSON(res, 403, {
        error: '你的学号未在教师导入的名单中。请确认班级与学号是否与教务一致，或联系教师把你加入名单。'
      });
    }
  } else if (no) {
    preAcct = byNo.get(no) || null;
  }

  /* 账号名已被占用 */
  const existing = db.getUserByName(uname);
  if (existing) {
    const sameStudent = existing.role === 'student' && no && normKey(existing.student_no) === no;
    if (!sameStudent) return sendJSON(res, 409, { error: '该账号名已被占用，请换一个，或直接用学号登录' });
    // 同一学号不应挂到两个账号上
    const bound = byNo.get(no);
    if (bound && bound.id !== existing.id) {
      return sendJSON(res, 409, { error: `该学号已绑定账号「${bound.username}」，请联系教师处理。` });
    }
    /*
     * 认领只对"尚未激活"的预建账号开放（必须还处于初始密码状态）。
     * 否则会形成账号劫持：学号本身就是登录名、并不是秘密，
     * 任何人只要知道同学学号，就能来"认领"并把对方密码重置掉。
     * 一旦学生自己设置过密码（must_change_pwd=0），后续只允许登录，
     * 忘记密码需教师重置。
     */
    if (!existing.must_change_pwd) {
      return sendJSON(res, 409, {
        error: '该学号已激活（已设置过密码），请直接登录；忘记密码请联系教师重置。'
      });
    }
    // 学生自己设置的密码不需要再强制修改
    db.setPassword(existing.id, pwd, 0);
    const tk = db.createSession(existing.id);
    db.logEvent(existing.id, 'register_claim', { username: uname, className: cls, studentNo: no });
    return send(res, 200, JSON.stringify({ user: publicUser(db.getUser(existing.id)), token: tk, claimed: true }), {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': sessionCookie(req, tk)
    });
  }

  /*
   * 学号唯一性：一个学号只能对应一个账号。
   * 否则会出现"同一学号两个账号"（历史上班级留空时就能绕过去），
   * 导致教师看学情时数据被拆散。
   */
  if (no) {
    const used = byNo.get(no);
    if (used) {
      return sendJSON(res, 409, {
        error: `该学号已开通账号（账号名：${used.username}）。请直接用该账号登录，初始密码见教师通知；忘记密码请联系教师重置。`
      });
    }
  }

  let id;
  if (preAcct) {
    // 名单里有、但账号名还没被占用：接管预建账号，保留其 id（练习记录不丢）
    db.sql.prepare('UPDATE users SET username=?, name=?, class_name=?, student_no=? WHERE id=?')
      .run(uname, name || preAcct.name || '', cls || preAcct.class_name || '', no || preAcct.student_no || '', preAcct.id);
    db.setPassword(preAcct.id, pwd, 1);
    id = preAcct.id;
  } else {
    id = db.createUser({ username: uname, password: pwd, role: 'student', name, className: cls, studentNo: no });
  }
  const token = db.createSession(id);
  db.logEvent(id, 'register', { username: uname, className: cls, studentNo: no });
  send(res, 200, JSON.stringify({ user: publicUser(db.getUser(id)), token }), {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': sessionCookie(req, token)
  });
});

/* ---------------------------------------------------------------- 教师邀请码
 * 设计目标：教师可以自助注册，但必须凭已有教师签发的邀请码，
 * 避免学生拿到公网链接后把自己注册成教师。
 *   · 第一个教师（初始化账号）自动获得一个初始邀请码；
 *   · 每位教师都有自己的邀请码，可邀请同事；
 *   · 邀请码可重新生成，旧码立即失效。
 */
function genInviteCode() {
  // 放在函数内部：bootstrap() 在模块顶部执行，模块级 const 此时仍处于 TDZ
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉易混淆的 I/O/0/1
  const pick = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  return `MCU-${pick()}-${pick()}`;
}
function ensureInviteFor(teacherId) {
  const cur = db.activeInviteOf(teacherId);
  if (cur) return cur.code;
  let code = genInviteCode();
  for (let i = 0; i < 5 && db.findInvite(code); i++) code = genInviteCode();
  return db.createInvite(code, teacherId);
}

/** 是否已有教师（决定教师注册是否需要邀请码） */
route('GET', '/api/auth/teacher-registration', async (req, res) => {
  const n = db.countTeachers();
  sendJSON(res, 200, {
    hasTeacher: n > 0,
    requireInvite: n > 0,
    teacherCount: n,
    message: n > 0
      ? '教师注册需要邀请码，请向已有教师索取。'
      : '还没有教师账号，第一个注册的教师将自动成为管理员并获得邀请码。'
  });
});

/** 教师注册（需邀请码；首位教师除外） */
route('POST', '/api/auth/register-teacher', async (req, res) => {
  const b = await readJSON(req);
  const uname = normKey(b.username);
  const pwd = String(b.password || '');
  const name = String(b.name || '').trim();
  const code = normKey(b.inviteCode).toUpperCase();

  if (!uname) return sendJSON(res, 400, { error: '请填写登录账号' });
  if (pwd.length < 6) return sendJSON(res, 400, { error: '密码至少 6 位' });
  if (db.getUserByName(uname)) return sendJSON(res, 409, { error: '该账号名已被占用' });

  const first = db.countTeachers() === 0;
  let inv = null;
  if (!first) {
    if (!code) return sendJSON(res, 400, { error: '请填写邀请码（由已有教师提供）' });
    inv = db.findInvite(code);
    if (!inv || !inv.active) return sendJSON(res, 403, { error: '邀请码无效或已停用，请向邀请你的教师重新索取' });
  }

  const id = db.createUser({ username: uname, password: pwd, role: 'teacher', name: name || '教师' });
  if (inv) db.useInvite(inv.code);
  const myCode = ensureInviteFor(id);
  const token = db.createSession(id);
  db.logEvent(id, 'register_teacher', { username: uname, viaInvite: inv ? inv.code : '(first)' });

  send(res, 200, JSON.stringify({
    user: publicUser(db.getUser(id)),
    token,
    inviteCode: myCode,
    isFirstTeacher: first
  }), {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': sessionCookie(req, token)
  });
});

/** 我的邀请码 */
route('GET', '/api/teacher/invite', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const code = ensureInviteFor(u.id);
  const inv = db.activeInviteOf(u.id);
  sendJSON(res, 200, { code, uses: inv ? inv.uses : 0, createdAt: inv ? inv.created_at : null });
});

/** 重新生成邀请码（旧码立即失效） */
route('POST', '/api/teacher/invite/regenerate', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  db.deactivateInvites(u.id);
  let code = genInviteCode();
  for (let i = 0; i < 5 && db.findInvite(code); i++) code = genInviteCode();
  db.createInvite(code, u.id);
  db.logEvent(u.id, 'invite_regenerate', {});
  sendJSON(res, 200, { code, uses: 0 });
});

/** 设置项开关解析：兼容 '1' / 'true' / 'on'（历史数据可能是任意一种） */
function settingOn(key, def = true) {
  const v = db.getSetting(key, null);
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes';
}

/* 账号/学号等标识类输入归一化：去空白、全角转半角、去零宽字符。
   中文输入法打出的全角学号/账号肉眼看不出差别，却必然匹配失败。 */
function normKey(v) {
  return String(v == null ? '' : v)
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, name: u.name, className: u.class_name, studentNo: u.student_no, mustChangePwd: !!u.must_change_pwd };
}

/* ============ 编译 ============ */
route('POST', '/api/compile', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const { code, name, problemId, mcu } = await readJSON(req);
  if (!code || typeof code !== 'string') return sendJSON(res, 400, { error: '缺少源码' });
  if (code.length > 400000) return sendJSON(res, 413, { error: '源码过长（>400KB）' });
  const t0 = Date.now();
  const r = await compiler.compile(code, { name: name || 'main', mcu: mcu || 'mcs51' });
  const ms = Date.now() - t0;
  db.addAttempt({
    userId: u.id, problemId: problemId || '', kind: 'compile', ok: r.ok,
    code: code.slice(0, 20000), hex: r.hex ? r.hex.slice(0, 40000) : '',
    message: r.ok ? `OK via ${r.via} (${ms}ms)` : (r.errors[0]?.msg || '').slice(0, 500)
  });
  sendJSON(res, 200, {
    ok: r.ok, via: r.via, hex: r.hex || null, errors: r.errors || [], warnings: r.warnings || [],
    size: r.size || 0, meta: r.meta || null, ms,
    log: (r.log || []).join('\n').slice(0, 8000)
  });
});

route('GET', '/api/compiler/status', async (req, res) => {
  const p = await compiler.probe();
  // 诊断信息：排查"文件在却执行不了"这类问题（缺动态链接器 / 架构不符 / 丢了可执行位）
  const exe = compiler.sdccExe || '';
  const exists = (() => { try { return fs.existsSync(exe); } catch { return false; } })();
  let mode = '';
  try { mode = (fs.statSync(exe).mode & 0o777).toString(8); } catch { }
  const loaders = ['/lib64/ld-linux-x86-64.so.2', '/lib/ld-linux-x86-64.so.2', '/lib/ld-musl-x86_64.so.1']
    .filter(x => { try { return fs.existsSync(x); } catch { return false; } });
  let toolchainDirs = 'missing';
  try { toolchainDirs = fs.readdirSync(path.join(ROOT, 'toolchain')).join(','); } catch { }
  sendJSON(res, 200, {
    sdccPresent: compiler.supported, sdccUsable: compiler.available,
    version: p.version || '', error: compiler.probeError || p.error || '',
    assembler: true, toolchainDir: compiler.binDir,
    diag: {
      platform: process.platform, arch: process.arch, release: os.release(),
      exe, exeExists: exists, exeMode: mode, loaders, toolchainDirs
    }
  });
});

/* ============ 题库 ============ */
route('GET', '/api/problems', async (req, res) => {
  const list = db.sql.prepare('SELECT * FROM problems ORDER BY order_no').all();
  const u = currentUser(req);
  const solved = u ? db.sql.prepare("SELECT DISTINCT problem_id FROM attempts WHERE user_id=? AND ok=1").all(u.id).map(r => r.problem_id) : [];
  sendJSON(res, 200, { problems: list.map(p => ({ ...p, tests: JSON.parse(p.tests || '[]'), solved: solved.includes(p.id) })) });
});

/* ============ 练习记录 ============ */
route('POST', '/api/attempts', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const b = await readJSON(req);
  db.addAttempt({ userId: u.id, problemId: b.problemId, kind: b.kind || 'simulate', ok: b.ok, code: b.code, hex: b.hex, message: b.message, cycles: b.cycles });
  sendJSON(res, 200, { ok: true });
});
route('GET', '/api/attempts', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  sendJSON(res, 200, { attempts: db.attemptsOf(u.id, 100) });
});

/* ============ 原理图作品 ============ */
route('GET', '/api/sketches', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  sendJSON(res, 200, { sketches: db.listSketches(u.id) });
});
route('POST', '/api/sketches', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const b = await readJSON(req);
  if (!b.id || !b.json) return sendJSON(res, 400, { error: '缺少 id / json' });
  db.saveSketch({ id: b.id, userId: u.id, problemId: b.problemId, name: b.name || '未命名电路', json: b.json });
  sendJSON(res, 200, { ok: true });
});
route('GET', '/api/sketches/:id', async (req, res, params) => {
  const u = requireRole(req, res); if (!u) return;
  const s = db.getSketch(params.id);
  if (!s || (s.user_id !== u.id && u.role !== 'teacher')) return sendJSON(res, 404, { error: '未找到' });
  sendJSON(res, 200, { sketch: s });
});
route('DELETE', '/api/sketches/:id', async (req, res, params) => {
  const u = requireRole(req, res); if (!u) return;
  db.deleteSketch(params.id, u.id);
  sendJSON(res, 200, { ok: true });
});

/* ============ 答疑 ============ */
route('POST', '/api/questions', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const b = await readJSON(req);
  if (!b.title) return sendJSON(res, 400, { error: '请填写问题标题' });
  const id = db.addQuestion({ userId: u.id, problemId: b.problemId, title: b.title, body: b.body, code: b.code, context: b.context });
  db.logEvent(u.id, 'question', { id });
  // 自动生成助教回答
  let auto = null;
  const cfg = llm.config;
  if (b.autoAnswer !== false) {
    if (cfg.enabled) {
      try {
        const msgs = [
          { role: 'system', content: SYSTEM_TUTOR + (cfg.systemExtra ? '\n' + cfg.systemExtra : '') },
          { role: 'user', content: buildTutorPrompt(b) }
        ];
        const r = await llm.chat(msgs, { maxTokens: 1200 });
        auto = r.content;
      } catch (e) {
        auto = `（大模型调用失败：${e.message}）\n\n` + LocalTutor.reply({ question: b.title + '\n' + (b.body || ''), code: b.code || '', schematic: safeParse(b.context), problem: b.problemId });
      }
    } else {
      auto = LocalTutor.reply({ question: b.title + '\n' + (b.body || ''), code: b.code || '', schematic: safeParse(b.context), problem: b.problemId });
    }
    if (auto) db.addAnswer({ questionId: id, authorId: null, role: 'ai', name: cfg.enabled ? 'AI 助教' : '离线助教（规则库）', body: auto });
  }
  sendJSON(res, 200, { id, autoAnswer: auto });
});

route('GET', '/api/questions', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const qs = u.role === 'teacher' ? db.listQuestions({ limit: 200 }) : db.listQuestions({ userId: u.id, limit: 100 });
  sendJSON(res, 200, { questions: qs });
});

route('GET', '/api/questions/:id', async (req, res, params) => {
  const u = requireRole(req, res); if (!u) return;
  const q = db.question(Number(params.id));
  if (!q) return sendJSON(res, 404, { error: '未找到' });
  if (u.role !== 'teacher' && q.user_id !== u.id) return sendJSON(res, 403, { error: '无权限' });
  sendJSON(res, 200, { question: q, answers: db.answers(q.id) });
});

route('POST', '/api/questions/:id/answer', async (req, res, params) => {
  const u = requireRole(req, res); if (!u) return;
  const q = db.question(Number(params.id));
  if (!q) return sendJSON(res, 404, { error: '未找到' });
  if (u.role !== 'teacher' && q.user_id !== u.id) return sendJSON(res, 403, { error: '无权限' });
  const b = await readJSON(req);
  if (!b.body) return sendJSON(res, 400, { error: '内容为空' });
  /*
   * asAi：云端大模型的回答由前端生成后回传入库。
   * 若按当前登录用户入库，学生提问下会出现"学生自己回答自己"的错误署名，
   * 因此服务端以固定身份记录（不采信前端传来的名字，避免伪造成他人）。
   * 仅限提问者本人使用，教师回答仍按教师身份入库。
   */
  // 归属校验按“是否提问者本人”判断，不限定角色（教师自测时也需要正确署名）
  const asAi = b.asAi === true && q.user_id === u.id;
  const id = db.addAnswer({
    questionId: q.id,
    authorId: asAi ? null : u.id,
    role: asAi ? 'ai' : u.role,
    name: asAi ? '云端 AI 助教' : (u.name || u.username),
    body: b.body
  });
  if (u.role === 'teacher' && b.close) db.setQuestionStatus(q.id, 'answered');
  sendJSON(res, 200, { id });
});

route('POST', '/api/questions/:id/status', async (req, res, params) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  db.setQuestionStatus(Number(params.id), b.status || 'open');
  sendJSON(res, 200, { ok: true });
});

function buildTutorPrompt(b) {
  const parts = [`【问题】${b.title}`];
  if (b.body) parts.push(`【描述】${b.body}`);
  if (b.problemId) parts.push(`【当前实验】${b.problemId}`);
  if (b.code) parts.push(`【学生代码】\n\`\`\`c\n${String(b.code).slice(0, 6000)}\n\`\`\``);
  const sc = safeParse(b.context);
  if (sc && sc.issues && sc.issues.length) {
    parts.push(`【平台原理图自动诊断结果】\n` + sc.issues.map(i => `- [${i.level}] ${i.msg}`).join('\n'));
  } else if (sc && sc.parts) {
    parts.push(`【原理图概要】元件：${(sc.parts || []).map(p => p.type).join(', ')}；导线 ${sc.wires?.length || 0} 条`);
  }
  parts.push('请分析可能的原因，并用提问的方式引导学生自己找到问题。');
  return parts.join('\n\n');
}
function safeParse(s) { if (!s) return null; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch { return null; } }

/* ============ AI 对话（学生直接问代码/硬件） ============ */
route('POST', '/api/ai/chat', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const b = await readJSON(req);
  const cfg = llm.config;
  if (!cfg.enabled) {
    const txt = LocalTutor.reply({ question: b.question || '', code: b.code || '', schematic: safeParse(b.context), problem: b.problemId || '' });
    return sendJSON(res, 200, { ok: true, offline: true, content: txt });
  }
  try {
    const msgs = [{ role: 'system', content: SYSTEM_TUTOR + (cfg.systemExtra ? '\n' + cfg.systemExtra : '') }];
    for (const m of (b.history || []).slice(-8)) msgs.push({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content).slice(0, 4000) });
    /*
     * 知识库/联网检索结果由前端一并带上（server 端也做一次兜底检索），
     * 让"自建大模型"这条路径同样能用上教师资料，而不是只有云端路径受益。
     */
    let kbExtra = String(b.kbContext || '');
    if (!kbExtra) {
      try {
        const hits = kbSearch(`${b.question || ''} ${b.body || ''}`, 3);
        if (hits.length) kbExtra = '【教师知识库摘录】\n' + hits.map((h, i) => `(${i + 1}) ${h.text}`).join('\n\n');
      } catch { }
    }
    const userMsg = buildTutorPrompt({ title: b.question || '（无标题）', body: b.body, code: b.code, context: b.context, problemId: b.problemId })
      + (kbExtra ? '\n\n' + kbExtra + '\n\n（请优先依据以上资料回答；资料未覆盖时再凭通用经验，并说明这一点。）' : '');
    msgs.push({ role: 'user', content: userMsg });
    const r = await llm.chat(msgs);
    sendJSON(res, 200, { ok: true, offline: false, content: r.content, usage: r.usage, model: r.model });
  } catch (e) {
    const txt = `**大模型调用失败**：${e.message}\n\n---\n\n` + LocalTutor.reply({ question: b.question || '', code: b.code || '', schematic: safeParse(b.context), problem: b.problemId || '' });
    sendJSON(res, 200, { ok: true, offline: true, degraded: true, content: txt });
  }
});

/* ============ 教师端 ============ */
route('GET', '/api/teacher/students', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  sendJSON(res, 200, { students: db.listStudents(), classes: db.classes() });
});

route('POST', '/api/teacher/students/import', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  const text = b.text || '';
  if (!text.trim()) return sendJSON(res, 400, { error: '导入内容为空' });
  const { rows } = parseStudentTable(text);
  if (!rows.length) return sendJSON(res, 400, { error: '未能解析出任何学生记录。请确认每行至少包含"学号"。支持的列：学号,姓名,班级,初始密码' });
  const defaultPwd = b.defaultPassword || '123456';
  const resetExisting = !!b.resetExisting;
  const result = { created: 0, updated: 0, skipped: 0, errors: [], preview: rows.slice(0, 200) };
  const findStu = db.sql.prepare("SELECT * FROM users WHERE role='student' AND student_no=? AND class_name=?");
  for (const r of rows) {
    try {
      if (!r.studentNo) { result.skipped++; continue; }
      const exist = r.className ? findStu.get(r.studentNo, r.className) : db.sql.prepare("SELECT * FROM users WHERE role='student' AND student_no=?").get(r.studentNo);
      const pwd = r.password || defaultPwd;
      if (exist) {
        if (resetExisting) { db.setPassword(exist.id, pwd, 1); result.updated++; }
        else result.skipped++;
      } else {
        db.createUser({ username: r.studentNo, password: pwd, role: 'student', name: r.name, className: r.className, studentNo: r.studentNo, mustChange: 1 });
        result.created++;
      }
    } catch (e) { result.errors.push(`${r.studentNo}: ${e.message}`); }
  }
  // 名单快照（供自助注册校验）
  const roster = db.getJSON('roster', []);
  for (const r of rows) if (!roster.some(x => x.studentNo === r.studentNo && x.className === r.className)) roster.push({ studentNo: r.studentNo, className: r.className, name: r.name });
  db.setSetting('roster', roster);
  db.logEvent(u.id, 'import_students', { created: result.created, updated: result.updated, skipped: result.skipped });
  sendJSON(res, 200, { ok: true, result });
});

route('POST', '/api/teacher/students/:id/password', async (req, res, params) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  const target = db.getUser(Number(params.id));
  if (!target) return sendJSON(res, 404, { error: '未找到该学生' });
  const pwd = String(b.password || '').trim();
  if (pwd.length < 6) return sendJSON(res, 400, { error: '密码至少 6 位' });
  db.setPassword(target.id, pwd, b.mustChange ? 1 : 0);
  db.logEvent(u.id, 'reset_pwd', { target: target.id });
  sendJSON(res, 200, { ok: true });
});

route('POST', '/api/teacher/students/:id/toggle', async (req, res, params) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const t = db.getUser(Number(params.id));
  if (!t) return sendJSON(res, 404, { error: '未找到' });
  db.sql.prepare('UPDATE users SET active=? WHERE id=?').run(t.active ? 0 : 1, t.id);
  sendJSON(res, 200, { ok: true, active: !t.active });
});

route('POST', '/api/teacher/students/delete', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  const ids = (b.ids || []).map(Number).filter(Boolean);
  for (const id of ids) db.sql.prepare("DELETE FROM users WHERE id=? AND role='student'").run(id);
  sendJSON(res, 200, { ok: true, deleted: ids.length });
});

route('GET', '/api/teacher/stats', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const stats = { students: db.studentStats(), problems: db.problemStats(), daily: db.dailyActivity(14), classes: db.classes() };
  sendJSON(res, 200, stats);
});

route('POST', '/api/teacher/analyze', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const stats = { students: db.studentStats(), problems: db.problemStats(), daily: db.dailyActivity(14), classes: db.classes() };
  const cfg = llm.config;
  if (!cfg.enabled) return sendJSON(res, 200, { ok: true, offline: true, content: LocalTutor.teacherReport(stats) });
  try {
    const r = await llm.chat([
      { role: 'system', content: SYSTEM_TEACHER },
      { role: 'user', content: '以下是《微控制器原理及应用》课程的学生练习数据（JSON）：\n\n```json\n' + JSON.stringify(stats, null, 1).slice(0, 20000) + '\n```\n\n请分析并给出教学建议。' }
    ], { maxTokens: 2000 });
    sendJSON(res, 200, { ok: true, offline: false, content: r.content });
  } catch (e) {
    sendJSON(res, 200, { ok: true, offline: true, degraded: true, content: `**大模型调用失败**：${e.message}\n\n---\n\n` + LocalTutor.teacherReport(stats) });
  }
});

route('GET', '/api/teacher/questions', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  sendJSON(res, 200, { questions: db.listQuestions({ limit: 300 }) });
});

/* ============ 实验报告 ============ */
route('GET', '/api/reports', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const q = url.parse(req.url, true).query;
  const r = db.getReport(u.id, q.problemId || '');
  sendJSON(res, 200, { report: r });
});

route('POST', '/api/reports', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const b = await readJSON(req);
  if (!b.content || !String(b.content).trim()) return sendJSON(res, 400, { error: '报告内容为空' });
  const exist = db.getReport(u.id, b.problemId || '');
  if (exist && exist.status === 'reviewed') return sendJSON(res, 409, { error: '该报告已被教师批阅，不能再修改' });
  const id = db.saveReport({
    userId: u.id, problemId: b.problemId || '', title: b.title || '',
    content: String(b.content).slice(0, 200000),
    status: b.status === 'submitted' ? 'submitted' : 'draft',
    evidence: typeof b.evidence === 'string' ? b.evidence : JSON.stringify(b.evidence || {})
  });
  db.logEvent(u.id, b.status === 'submitted' ? 'report_submit' : 'report_save', { problemId: b.problemId, id });
  sendJSON(res, 200, { ok: true, id });
});

route('POST', '/api/reports/generate', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const b = await readJSON(req);
  const p = PROBLEMS.find(x => x.id === b.problemId) || null;
  const ctx = {
    title: b.title || p?.title || '实验报告',
    statement: p?.statement || '',
    code: String(b.code || '').slice(0, 12000),
    evidence: b.evidence || {},
    schematic: b.schematic || null,
    student: { name: u.name || u.username, className: u.class_name || '', studentNo: u.student_no || '' }
  };
  const cfg = llm.config;
  let content = null, offline = true;
  if (cfg.enabled) {
    try {
      const r = await llm.chat([
        {
          role: 'system', content: `你是电子信息类专业实验课教师，负责帮助学生起草《单片机原理及应用》实验报告。
要求：
1. 使用中文，Markdown 格式，包含以下一级标题：一、实验目的；二、实验原理；三、硬件电路设计；四、软件设计；五、实验结果与分析；六、问题与解决；七、心得体会。
2. 依据给定的真实代码、原理图与波形统计撰写，不要编造未给出的数据。
3. "实验结果与分析"要结合代码逻辑与端口/时序现象做定量说明（如延时时间、刷新率、波特率）。
4. "问题与解决"若学生未提供调试记录，请用教学口吻给出该实验最常见的 2–3 个典型问题及排查思路。
5. "心得体会"保留为【请学生补充】占位，不要代写。
6. 代码放在 \`\`\`c 代码块中，只摘录关键段落。`
        },
        { role: 'user', content: buildReportPrompt(ctx) }
      ], { maxTokens: 2600 });
      content = r.content; offline = false;
    } catch (e) {
      content = `> ⚠ 大模型调用失败（${e.message}），以下为离线模板草稿。\n\n` + offlineReport(ctx);
    }
  } else {
    content = offlineReport(ctx);
  }
  const id = db.getReport(u.id, b.problemId || '')?.id || null;
  sendJSON(res, 200, { ok: true, offline, content, id });
});

route('GET', '/api/teacher/reports', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const q = url.parse(req.url, true).query;
  sendJSON(res, 200, { reports: db.listReports({ problemId: q.problemId || null, status: q.status || null }) });
});

route('GET', '/api/teacher/reports/:id', async (req, res, params) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const r = db.report(Number(params.id));
  if (!r) return sendJSON(res, 404, { error: '未找到' });
  sendJSON(res, 200, { report: r });
});

route('POST', '/api/teacher/reports/:id/review', async (req, res, params) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  db.reviewReport(Number(params.id), { score: b.score, comment: b.comment, status: 'reviewed' });
  sendJSON(res, 200, { ok: true });
});

function buildReportPrompt(c) {
  const ev = c.evidence || {};
  const lines = [
    `【实验名称】${c.title}`,
    `【学生】${c.student.name} ${c.student.className} ${c.student.studentNo}`,
    '',
    '【实验指导书原文】',
    String(c.statement || '（无）').slice(0, 4000)
  ];
  if (c.code) lines.push('', '【学生最终代码】', '```c', c.code, '```');
  if (c.schematic) {
    const s = c.schematic;
    lines.push('', '【硬件电路（由原理图编辑器自动提取）】',
      `主控：${s.mcu || '—'}；元件：${Object.entries(s.parts || {}).map(([k, v]) => `${k}×${v}`).join('、') || '—'}；` +
      `导线 ${s.wires || 0} 条，电气网络 ${s.nets || 0} 个。`);
    if (s.diagnostics?.length) {
      lines.push('自动接线诊断：' + s.diagnostics.map(d => `[${d.level}] ${d.msg}`).join('；'));
    } else {
      lines.push('自动接线诊断：未发现常见错误。');
    }
  }
  lines.push('', '【仿真/调试实测数据】',
    `- 编译：${ev.compileOk ? '成功，' + (ev.hexSize || 0) + ' 字节' : '未成功编译'}`,
    `- 仿真时长：${ev.simCycles ? ev.simCycles + ' 个机器周期（约 ' + (ev.simCycles / 921600).toFixed(3) + ' 秒）' : '未记录'}`,
    `- GPIO 跳变次数：${ev.portEvents || 0}`,
    `- 串口记录：${ev.serialLog ? '有（' + ev.serialLog.length + ' 字符）' : '无'}`);
  lines.push('', '请据此撰写实验报告。');
  return lines.join('\n');
}

/** 离线模板：即使没有大模型也能交付一份结构完整、含真实数据的草稿 */
function offlineReport(c) {
  const ev = c.evidence || {};
  const s = c.schematic || {};
  const code = String(c.code || '');
  const delays = [...code.matchAll(/delay_ms\s*\(\s*(\d+)\s*\)/g)].map(m => Number(m[1]));
  const simSec = ev.simCycles ? (ev.simCycles / 921600) : 0;
  const diagTxt = (s.diagnostics && s.diagnostics.length)
    ? s.diagnostics.map(d => `- [${d.level}] ${d.msg}`).join('\n')
    : '- 平台自动诊断未发现常见接线错误（电源/地/EA/晶振/限流电阻等检查项通过）。';

  return `# ${c.title}

| 项目 | 内容 |
|---|---|
| 姓名 | ${c.student.name} |
| 班级 | ${c.student.className || '—'} |
| 学号 | ${c.student.studentNo || '—'} |
| 日期 | ${new Date().toLocaleDateString('zh-CN')} |

## 一、实验目的

${(c.statement || '').split('\n').filter(l => /目的/.test(l)).join('\n') || '掌握 8051 单片机的 I/O 口控制、定时器与中断的使用方法，能够独立完成硬件连接、程序编写与联合调试。'}

## 二、实验原理

本实验基于 STC89C52RC（8051 内核，12T 模式，11.0592 MHz 晶振）。
1 个机器周期 = 12 个振荡周期，因此机器周期频率为 11.0592 MHz / 12 = **921.6 kHz**，即每个机器周期约 **1.085 µs**。
${delays.length ? `程序中使用了 \`delay_ms(${delays[0]})\`，按 12T 模式估算，单次延时约 ${delays[0]} ms（软件延时受编译器优化与循环体指令数影响，实际值需用示波器/逻辑分析仪校准）。` : ''}

## 三、硬件电路设计

- 主控芯片：${s.mcu || 'STC89C52RC'}
- 使用元件：${Object.entries(s.parts || {}).map(([k, v]) => `${k} × ${v}`).join('、') || '—'}
- 导线 ${s.wires || 0} 条，形成 ${s.nets || 0} 个电气网络。

**平台自动接线诊断结果：**

${diagTxt}

## 四、软件设计

\`\`\`c
${code.slice(0, 2600)}${code.length > 2600 ? '\n/* …（完整代码见附件）… */' : ''}
\`\`\`

## 五、实验结果与分析

| 观测项 | 实测/统计值 |
|---|---|
| 编译结果 | ${ev.compileOk ? '成功，' + (ev.hexSize || 0) + ' 字节' : '未成功编译'} |
| 仿真运行时长 | ${simSec ? simSec.toFixed(3) + ' s（' + ev.simCycles + ' 个机器周期）' : '未记录'} |
| GPIO 电平跳变 | ${ev.portEvents || 0} 次 |
| 串口输出 | ${ev.serialLog ? '有数据（' + ev.serialLog.length + ' 字符）' : '无'} |

${ev.portEvents > 100 ? `仿真中记录到 ${ev.portEvents} 次引脚跳变，说明程序确实在持续改变端口状态，符合周期输出的预期。` : '建议在「仿真运行」中运行更长时间，再用「仪器」采集波形以获得更充分的时序证据。'}

## 六、问题与解决

> 本节请结合你实际调试中遇到的真实问题填写。以下是该实验的常见问题，供参考排查：

1. **现象**：LED 全亮或全灭，不流动。
   **排查**：确认接法为灌电流（P1 输出 0 才点亮）；若为拉电流接法，初值应取 0x01 而非 0xFE。
2. **现象**：流水太快看不清。
   **排查**：增大延时；注意 \`unsigned int\` 循环在 12T 下约每毫秒数百次空转，需按实测校准。
3. **现象**：仿真能跑但下载到实物不运行。
   **排查**：EA（31 脚）必须接 VCC；晶振与复位电路是否正确；ISP 下载需"先点下载再冷启动"。

## 七、心得体会

【请学生补充：你在本实验中最主要的收获、遇到的最大困难及解决过程、对硬件与软件协同的理解。】

---
*本报告由平台根据代码、原理图与仿真数据自动生成草稿（离线模板），学生需补充第六、七节后提交。*
`;
}

/* ============ 设置（大模型 / 平台） ============ */
/* ================================================================ 实验任务
 * 教师发布实验要求 + 起止时间；系统记录学生"第一次打开"与"提交"时间，
 * 用两者之差作为该实验用时（超过窗口的部分不计）。
 */
const nowLocal = () => {
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const toDate = (s) => {
  if (!s) return null;
  const t = String(s).replace(' ', 'T');
  const d = new Date(t.length <= 16 ? t + ':00' : t);
  return isNaN(d) ? null : d;
};
/** 用时（分钟，保留 1 位）；超出教师设定窗口的部分截断 */
function minutesBetween(a, b, winStart, winEnd) {
  const s = toDate(a), e = toDate(b);
  if (!s || !e) return null;
  let from = s, to = e;
  const ws = toDate(winStart), we = toDate(winEnd);
  if (ws && from < ws) from = ws;
  if (we && to > we) to = we;
  const m = (to - from) / 60000;
  return m < 0 ? 0 : Math.round(m * 10) / 10;
}

function rowToAssignment(r) {
  return {
    id: r.id, problemId: r.problem_id, title: r.title, requirement: r.requirement || '',
    startAt: r.start_at || '', endAt: r.end_at || '', published: !!r.published,
    createdAt: r.created_at
  };
}

/* ---------------- 学生：可看到的任务 ---------------- */
route('GET', '/api/assignments', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const rows = u.role === 'teacher'
    ? db.sql.prepare('SELECT * FROM assignments ORDER BY id DESC').all()
    : db.sql.prepare('SELECT * FROM assignments WHERE published=1 ORDER BY id DESC').all();
  const my = db.sql.prepare('SELECT assignment_id, kind, at FROM assignment_events WHERE user_id=? ORDER BY id ASC').all(u.id);
  const byA = new Map();
  for (const e of my) {
    if (!byA.has(e.assignment_id)) byA.set(e.assignment_id, {});
    // 打开时间取第一次，提交时间取第一次
    if (!byA.get(e.assignment_id)[e.kind]) byA.get(e.assignment_id)[e.kind] = e.at;
  }
  sendJSON(res, 200, {
    assignments: rows.map(r => {
      const a = rowToAssignment(r);
      const mine = byA.get(r.id) || {};
      const openedAt = mine.open || null, submittedAt = mine.submit || null;
      return {
        ...a, openedAt, submittedAt,
        minutes: openedAt && submittedAt ? minutesBetween(openedAt, submittedAt, a.startAt, a.endAt) : null,
        open: !!(a.startAt && toDate(nowLocal()) >= toDate(a.startAt) && (!a.endAt || toDate(nowLocal()) <= toDate(a.endAt)))
      };
    })
  });
});

/* 学生首次打开某实验 → 记录开始时间 */
route('POST', '/api/assignments/:id/open', async (req, res, params) => {
  const u = requireRole(req, res); if (!u) return;
  const a = db.sql.prepare('SELECT * FROM assignments WHERE id=?').get(Number(params.id));
  if (!a) return sendJSON(res, 404, { error: '任务不存在' });
  if (!a.published && u.role !== 'teacher') return sendJSON(res, 403, { error: '任务尚未发布' });
  const exists = db.sql.prepare("SELECT id FROM assignment_events WHERE assignment_id=? AND user_id=? AND kind='open'").get(a.id, u.id);
  if (!exists) {
    db.sql.prepare("INSERT INTO assignment_events (assignment_id,user_id,kind,at) VALUES (?,?,?,?)").run(a.id, u.id, 'open', nowLocal());
  }
  const at = db.sql.prepare("SELECT at FROM assignment_events WHERE assignment_id=? AND user_id=? AND kind='open' ORDER BY id LIMIT 1").get(a.id, u.id);
  sendJSON(res, 200, { openedAt: at ? at.at : null });
});

/* 学生提交 → 记录结束时间 */
route('POST', '/api/assignments/:id/submit', async (req, res, params) => {
  const u = requireRole(req, res); if (!u) return;
  if (u.role === 'teacher') return sendJSON(res, 400, { error: '教师不参与提交' });
  const a = db.sql.prepare('SELECT * FROM assignments WHERE id=?').get(Number(params.id));
  if (!a) return sendJSON(res, 404, { error: '任务不存在' });
  if (!a.published) return sendJSON(res, 403, { error: '任务尚未发布' });
  const open = db.sql.prepare("SELECT at FROM assignment_events WHERE assignment_id=? AND user_id=? AND kind='open' ORDER BY id LIMIT 1").get(a.id, u.id);
  if (!open) {
    db.sql.prepare("INSERT INTO assignment_events (assignment_id,user_id,kind,at) VALUES (?,?,?,?)").run(a.id, u.id, 'open', nowLocal());
  }
  const done = db.sql.prepare("SELECT at FROM assignment_events WHERE assignment_id=? AND user_id=? AND kind='submit' ORDER BY id LIMIT 1").get(a.id, u.id);
  if (!done) {
    db.sql.prepare("INSERT INTO assignment_events (assignment_id,user_id,kind,at) VALUES (?,?,?,?)").run(a.id, u.id, 'submit', nowLocal());
  }
  const o = db.sql.prepare("SELECT at FROM assignment_events WHERE assignment_id=? AND user_id=? AND kind='open' ORDER BY id LIMIT 1").get(a.id, u.id);
  const sm = db.sql.prepare("SELECT at FROM assignment_events WHERE assignment_id=? AND user_id=? AND kind='submit' ORDER BY id LIMIT 1").get(a.id, u.id);
  sendJSON(res, 200, {
    openedAt: o ? o.at : null,
    submittedAt: sm ? sm.at : null,
    minutes: minutesBetween(o && o.at, sm && sm.at, a.start_at, a.end_at)
  });
});

/* ---------------- 教师：任务管理 ---------------- */
route('GET', '/api/teacher/assignments', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const rows = db.sql.prepare('SELECT * FROM assignments ORDER BY id DESC').all();
  sendJSON(res, 200, {
    assignments: rows.map(rowToAssignment),
    problems: PROBLEMS.map(p => ({ id: p.id, title: p.title }))
  });
});

route('POST', '/api/teacher/assignments', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  const problemId = String(b.problemId || '').trim();
  const title = String(b.title || '').trim();
  if (!problemId || !title) return sendJSON(res, 400, { error: '请选择实验并填写任务名称' });
  const requirement = String(b.requirement || '');
  const startAt = String(b.startAt || '').trim();
  const endAt = String(b.endAt || '').trim();
  if (startAt && endAt && toDate(startAt) > toDate(endAt)) {
    return sendJSON(res, 400, { error: '开始时间不能晚于结束时间' });
  }
  const published = b.published ? 1 : 0;
  if (b.id) {
    db.sql.prepare(`UPDATE assignments SET problem_id=?, title=?, requirement=?, start_at=?, end_at=?, published=? WHERE id=?`)
      .run(problemId, title, requirement, startAt, endAt, published, Number(b.id));
    return sendJSON(res, 200, { ok: true, id: Number(b.id) });
  }
  const r = db.sql.prepare(`INSERT INTO assignments (problem_id,title,requirement,start_at,end_at,published,created_by)
    VALUES (?,?,?,?,?,?,?)`).run(problemId, title, requirement, startAt, endAt, published, u.id);
  sendJSON(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});

route('POST', '/api/teacher/assignments/:id/delete', async (req, res, params) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const id = Number(params.id);
  db.sql.prepare('DELETE FROM assignment_events WHERE assignment_id=?').run(id);
  db.sql.prepare('DELETE FROM assignments WHERE id=?').run(id);
  sendJSON(res, 200, { ok: true });
});

/* 某任务的学生完成情况（打开/提交/用时） */
route('GET', '/api/teacher/assignments/:id/progress', async (req, res, params) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const a = db.sql.prepare('SELECT * FROM assignments WHERE id=?').get(Number(params.id));
  if (!a) return sendJSON(res, 404, { error: '任务不存在' });
  const evs = db.sql.prepare('SELECT * FROM assignment_events WHERE assignment_id=? ORDER BY id').all(a.id);
  const byUser = new Map();
  for (const e of evs) {
    if (!byUser.has(e.user_id)) byUser.set(e.user_id, {});
    const m = byUser.get(e.user_id);
    if (!m[e.kind]) m[e.kind] = e.at;
  }
  const students = db.sql.prepare("SELECT id,username,name,class_name,student_no FROM users WHERE role='student' ORDER BY class_name, student_no").all();
  sendJSON(res, 200, {
    assignment: rowToAssignment(a),
    rows: students.map(s => {
      const m = byUser.get(s.id) || {};
      return {
        id: s.id, username: s.username, name: s.name, className: s.class_name, studentNo: s.student_no,
        openedAt: m.open || null, submittedAt: m.submit || null,
        minutes: m.open && m.submit ? minutesBetween(m.open, m.submit, a.start_at, a.end_at) : null
      };
    })
  });
});

/* 高频编译错误统计 */
route('GET', '/api/teacher/errors', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const rows = db.sql.prepare(`SELECT problem_id, message, COUNT(*) n, COUNT(DISTINCT user_id) users
    FROM attempts WHERE ok=0 AND kind='compile' AND message<>''
    GROUP BY problem_id, message ORDER BY n DESC LIMIT 200`).all();
  const byProblem = new Map();
  for (const r of rows) {
    const pid = r.problem_id || '(未指定)';
    if (!byProblem.has(pid)) byProblem.set(pid, []);
    byProblem.get(pid).push({ message: r.message, count: r.n, users: r.users });
  }
  sendJSON(res, 200, {
    total: rows.reduce((a, b) => a + b.n, 0),
    groups: [...byProblem.entries()].map(([problemId, items]) => ({ problemId, items: items.slice(0, 10) }))
      .sort((a, b) => b.items[0].count - a.items[0].count)
  });
});

/* ================================================================ 知识库检索
 * 说明（务必如实告知使用者）：
 *   本实现是**关键词相关度检索**（中文按二元组切词 + IDF 加权），不是向量语义检索。
 *   不依赖任何 embedding 服务，因此离线也能用，但同义改写（如"上拉"vs"提拉"）召回较弱。
 *   若以后接入向量模型，只需替换 kbSearch 的打分部分，接口不变。
 */
const KB_STOP = new Set(['的', '了', '和', '是', '在', '我', '有', '就', '不', '人', '都', '一', '上', '也', '很', '到', '说', '要', '去', '会', '着', '没有', '看', '好', '自己', '这', '那', 'the', 'a', 'an', 'of', 'to', 'and', 'is', 'are', 'for', 'in', 'on', 'it']);

/** 中英混排切词：英文按单词，中文按二元组 */
function tokenize(text) {
  const out = [];
  const s = String(text || '').toLowerCase();
  const en = s.match(/[a-z][a-z0-9_]{1,}/g) || [];
  for (const w of en) if (!KB_STOP.has(w) && w.length > 2) out.push(w);
  const zh = s.replace(/[^\u4e00-\u9fa5]+/g, ' ');
  for (const seg of zh.split(/\s+/)) {
    for (let i = 0; i + 1 < seg.length; i++) {
      const bg = seg.slice(i, i + 2);
      if (!KB_STOP.has(bg)) out.push(bg);
    }
  }
  return out;
}

function splitChunks(text, size = 480, overlap = 80) {
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (!clean) return [];
  const paras = clean.split(/\n{2,}/).filter(Boolean);
  const chunks = [];
  let buf = '';
  for (const p of paras) {
    if (buf && (buf.length + p.length) > size) {
      chunks.push(buf);
      buf = buf.slice(Math.max(0, buf.length - overlap)) + '\n' + p;
    } else {
      buf = buf ? buf + '\n\n' + p : p;
    }
  }
  if (buf.trim()) chunks.push(buf);
  return chunks.filter(c => c.trim().length >= 20).slice(0, 400);
}

/** 检索：返回最相关的若干片段 */
function kbSearch(query, limit = 3) {
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];
  const qSet = new Set(qTokens);
  const docs = db.sql.prepare('SELECT id, title, content FROM kb_docs').all();

  const all = [];
  for (const d of docs) {
    for (const c of splitChunks(d.content)) {
      const t = tokenize(c);
      const tf = new Map();
      for (const tk of t) tf.set(tk, (tf.get(tk) || 0) + 1);
      all.push({ docId: d.id, title: d.title, text: c, tf, len: t.length || 1 });
    }
  }
  if (!all.length) return [];

  // IDF：在片段集合上统计，提升"晶振""串口"这类低频词的权重
  const df = new Map();
  for (const ch of all) for (const tk of new Set(ch.tf.keys())) df.set(tk, (df.get(tk) || 0) + 1);
  const N = all.length;
  const idf = (tk) => Math.log(1 + N / (1 + (df.get(tk) || 0)));

  for (const ch of all) {
    let score = 0;
    for (const tk of qSet) {
      const f = ch.tf.get(tk) || 0;
      if (f) score += (1 + Math.log(f)) * idf(tk);
    }
    // 长度归一，避免长片段天然占优
    ch.score = score / Math.sqrt(ch.len);
  }
  return all.filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ---- 知识库管理（教师） ---- */
route('GET', '/api/kb/docs', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const rows = db.sql.prepare('SELECT id,title,filename,chars,created_at,created_by FROM kb_docs ORDER BY id DESC').all();
  sendJSON(res, 200, { docs: rows, totalChars: rows.reduce((a, b) => a + (b.chars || 0), 0) });
});

route('POST', '/api/kb/docs', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  const title = String(b.title || '').trim() || String(b.filename || '').trim() || '未命名资料';
  const content = String(b.content || '');
  if (content.trim().length < 20) return sendJSON(res, 400, { error: '内容太短（至少 20 字）' });
  if (content.length > 2 * 1024 * 1024) return sendJSON(res, 400, { error: '单个文件超过 2MB，请拆分后上传' });
  const r = db.sql.prepare('INSERT INTO kb_docs (title,filename,content,chars,created_by) VALUES (?,?,?,?,?)')
    .run(title.slice(0, 120), String(b.filename || '').slice(0, 200), content, content.length, u.id);
  sendJSON(res, 200, { ok: true, id: Number(r.lastInsertRowid), chars: content.length });
});

route('POST', '/api/kb/docs/:id/delete', async (req, res, params) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  db.sql.prepare('DELETE FROM kb_docs WHERE id=?').run(Number(params.id));
  sendJSON(res, 200, { ok: true });
});

/* ---- 检索（教师与学生都可用：AI 回答前先查资料） ---- */
route('GET', '/api/kb/search', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const q = String(new URL(req.url, 'http://x').searchParams.get('q') || '');
  if (!q.trim()) return sendJSON(res, 200, { hits: [] });
  const hits = kbSearch(q, 3).map(h => ({ title: h.title, text: h.text, score: Number(h.score.toFixed(3)) }));
  sendJSON(res, 200, { hits });
});

/* ================================================================ 联网搜索
 * 采用可插拔设计：教师在后台上填服务商与密钥。未配置时接口明确返回"未启用"，
 * 不假装能搜。当前内置 Tavily（https://tavily.com）这一种，接口简单、按次计费。
 */
function getWebSearchCfg() {
  const get = (k) => (db.getSetting ? db.getSetting(k) : null);
  return {
    enabled: String(get('websearch_enabled') || '0') === '1',
    provider: get('websearch_provider') || 'tavily',
    apiKey: get('websearch_key') || '',
    maxResults: Number(get('websearch_max') || 5)
  };
}

route('GET', '/api/websearch/config', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const c = getWebSearchCfg();
  sendJSON(res, 200, { enabled: c.enabled, provider: c.provider, hasKey: !!c.apiKey, maxResults: c.maxResults });
});

route('POST', '/api/websearch/config', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  db.setSetting('websearch_enabled', b.enabled ? '1' : '0');
  db.setSetting('websearch_provider', String(b.provider || 'tavily').slice(0, 32));
  if (typeof b.apiKey === 'string' && b.apiKey.trim()) db.setSetting('websearch_key', b.apiKey.trim());
  if (b.maxResults) db.setSetting('websearch_max', String(Math.max(1, Math.min(10, Number(b.maxResults) || 5))));
  sendJSON(res, 200, { ok: true });
});

async function tavilySearch(q, maxResults) {
  const c = getWebSearchCfg();
  if (!c.apiKey) throw new Error('未配置搜索服务密钥');
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: c.apiKey, query: q, max_results: maxResults, search_depth: 'basic' })
  });
  if (!r.ok) throw new Error('搜索服务返回 ' + r.status);
  const j = await r.json();
  return (j.results || []).map(x => ({ title: x.title, url: x.url, snippet: String(x.content || '').slice(0, 600) }));
}

route('GET', '/api/websearch/search', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const c = getWebSearchCfg();
  if (!c.enabled) return sendJSON(res, 200, { enabled: false, hits: [], reason: '教师尚未启用联网搜索' });
  if (!c.apiKey) return sendJSON(res, 200, { enabled: false, hits: [], reason: '联网搜索已启用但缺少服务密钥' });
  const q = String(new URL(req.url, 'http://x').searchParams.get('q') || '').trim();
  if (!q) return sendJSON(res, 200, { enabled: true, hits: [] });
  try {
    const hits = await tavilySearch(q, c.maxResults);
    sendJSON(res, 200, { enabled: true, hits });
  } catch (e) {
    sendJSON(res, 200, { enabled: true, hits: [], reason: e.message });
  }
});

/* ================================================================ 开放性命题
 * 教师自由出题（不绑定内置 15 个实验），学生提交"原理图 + 代码 + 报告"三件套，
 * 教师给一个总分并写评语（开放性命题不拆子项，因为评分标准随题目而变）。
 */
function rowToOpenProblem(r, sub) {
  return {
    id: r.id, title: r.title, statement: r.statement || '',
    startAt: r.start_at || '', endAt: r.end_at || '', published: !!r.published,
    createdAt: r.created_at,
    submission: sub ? {
      id: sub.id, submittedAt: sub.submitted_at,
      score: sub.score, comment: sub.comment || '', gradedAt: sub.graded_at,
      hasSchematic: !!sub.schematic, hasCode: !!sub.code, hasReport: !!sub.report
    } : null
  };
}

/* 学生/教师：可见的开放题（学生只看已发布） */
route('GET', '/api/open-problems', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const rows = u.role === 'teacher'
    ? db.sql.prepare('SELECT * FROM open_problems ORDER BY id DESC').all()
    : db.sql.prepare('SELECT * FROM open_problems WHERE published=1 ORDER BY id DESC').all();
  const subs = u.role === 'student'
    ? db.sql.prepare('SELECT * FROM open_submissions WHERE user_id=?').all(u.id)
    : [];
  const byP = new Map(subs.map(x => [x.problem_id, x]));
  sendJSON(res, 200, { problems: rows.map(r => rowToOpenProblem(r, byP.get(r.id))) });
});

/* 教师：新建/编辑/删除 */
route('POST', '/api/teacher/open-problems', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  const title = String(b.title || '').trim();
  if (!title) return sendJSON(res, 400, { error: '请填写命题名称' });
  const statement = String(b.statement || '');
  const startAt = String(b.startAt || '').trim();
  const endAt = String(b.endAt || '').trim();
  if (startAt && endAt && toDate(startAt) > toDate(endAt)) return sendJSON(res, 400, { error: '开始时间不能晚于结束时间' });
  const published = b.published ? 1 : 0;
  if (b.id) {
    db.sql.prepare('UPDATE open_problems SET title=?, statement=?, start_at=?, end_at=?, published=? WHERE id=?')
      .run(title, statement, startAt, endAt, published, Number(b.id));
    return sendJSON(res, 200, { ok: true, id: Number(b.id) });
  }
  const r = db.sql.prepare('INSERT INTO open_problems (title,statement,start_at,end_at,published,created_by) VALUES (?,?,?,?,?,?)')
    .run(title, statement, startAt, endAt, published, u.id);
  sendJSON(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});

route('POST', '/api/teacher/open-problems/:id/delete', async (req, res, params) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const id = Number(params.id);
  db.sql.prepare('DELETE FROM open_submissions WHERE problem_id=?').run(id);
  db.sql.prepare('DELETE FROM open_problems WHERE id=?').run(id);
  sendJSON(res, 200, { ok: true });
});

/* 学生：查看自己的提交（含完整内容，用于回填表单） */
route('GET', '/api/open-problems/:id/mine', async (req, res, params) => {
  const u = requireRole(req, res); if (!u) return;
  const p = db.sql.prepare('SELECT * FROM open_problems WHERE id=?').get(Number(params.id));
  if (!p) return sendJSON(res, 404, { error: '命题不存在' });
  if (!p.published && u.role !== 'teacher') return sendJSON(res, 403, { error: '命题尚未发布' });
  const sub = u.role === 'student'
    ? db.sql.prepare('SELECT * FROM open_submissions WHERE problem_id=? AND user_id=?').get(p.id, u.id)
    : null;
  sendJSON(res, 200, {
    problem: rowToOpenProblem(p, sub),
    submission: sub ? { schematic: sub.schematic, code: sub.code, report: sub.report, submittedAt: sub.submitted_at, score: sub.score, comment: sub.comment } : null
  });
});

/* 学生：提交/更新三件套（可重复提交，覆盖前一次，但有提交时间记录） */
route('POST', '/api/open-problems/:id/submit', async (req, res, params) => {
  const u = requireRole(req, res); if (!u) return;
  if (u.role !== 'student') return sendJSON(res, 400, { error: '教师不参与提交' });
  const p = db.sql.prepare('SELECT * FROM open_problems WHERE id=?').get(Number(params.id));
  if (!p) return sendJSON(res, 404, { error: '命题不存在' });
  if (!p.published) return sendJSON(res, 403, { error: '命题尚未发布' });
  const b = await readJSON(req);
  const schematic = typeof b.schematic === 'string' ? b.schematic : JSON.stringify(b.schematic || '');
  const code = String(b.code || '');
  const report = String(b.report || '');
  if (!code.trim() && !report.trim() && !schematic.trim()) {
    return sendJSON(res, 400, { error: '代码、报告、原理图至少要提交一项' });
  }
  const at = nowLocal();
  const exist = db.sql.prepare('SELECT id FROM open_submissions WHERE problem_id=? AND user_id=?').get(p.id, u.id);
  if (exist) {
    db.sql.prepare(`UPDATE open_submissions SET schematic=?, code=?, report=?, submitted_at=? WHERE id=?`)
      .run(schematic, code, report, at, exist.id);
  } else {
    db.sql.prepare(`INSERT INTO open_submissions (problem_id,user_id,schematic,code,report,submitted_at)
      VALUES (?,?,?,?,?,?)`).run(p.id, u.id, schematic, code, report, at);
  }
  sendJSON(res, 200, { ok: true, submittedAt: at });
});

/* 教师：某命题的全部提交 */
route('GET', '/api/teacher/open-problems/:id/submissions', async (req, res, params) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const p = db.sql.prepare('SELECT * FROM open_problems WHERE id=?').get(Number(params.id));
  if (!p) return sendJSON(res, 404, { error: '命题不存在' });
  const rows = db.sql.prepare(`SELECT s.*, u.username, u.name, u.class_name, u.student_no
    FROM open_submissions s JOIN users u ON u.id = s.user_id
    WHERE s.problem_id=? ORDER BY s.submitted_at DESC`).all(p.id);
  const total = db.sql.prepare("SELECT COUNT(*) n FROM users WHERE role='student'").get().n;
  sendJSON(res, 200, {
    problem: rowToOpenProblem(p, null),
    totalStudents: total,
    rows: rows.map(r => ({
      id: r.id, userId: r.user_id, username: r.username, name: r.name,
      className: r.class_name, studentNo: r.student_no,
      submittedAt: r.submitted_at, score: r.score, comment: r.comment || '',
      hasSchematic: !!r.schematic, hasCode: !!r.code, hasReport: !!r.report
    }))
  });
});

/* 教师：查看某份提交的完整内容 */
route('GET', '/api/teacher/open-submissions/:id', async (req, res, params) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const r = db.sql.prepare(`SELECT s.*, u.username, u.name, p.title
    FROM open_submissions s JOIN users u ON u.id=s.user_id JOIN open_problems p ON p.id=s.problem_id
    WHERE s.id=?`).get(Number(params.id));
  if (!r) return sendJSON(res, 404, { error: '提交不存在' });
  sendJSON(res, 200, {
    id: r.id, title: r.title, name: r.name, username: r.username,
    schematic: r.schematic, code: r.code, report: r.report,
    submittedAt: r.submitted_at, score: r.score, comment: r.comment
  });
});

/* 教师：打分 + 评语 */
route('POST', '/api/teacher/open-submissions/:id/grade', async (req, res, params) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  const id = Number(params.id);
  const row = db.sql.prepare('SELECT id FROM open_submissions WHERE id=?').get(id);
  if (!row) return sendJSON(res, 404, { error: '提交不存在' });
  const raw = b.score;
  const score = (raw === '' || raw === null || raw === undefined) ? null : Number(raw);
  if (score !== null && (!isFinite(score) || score < 0 || score > 100)) {
    return sendJSON(res, 400, { error: '分数应在 0–100 之间' });
  }
  db.sql.prepare('UPDATE open_submissions SET score=?, comment=?, graded_at=?, graded_by=? WHERE id=?')
    .run(score, String(b.comment || ''), nowLocal(), u.id, id);
  sendJSON(res, 200, { ok: true });
});

/* ================================================================ 成绩册
 * 结构：总成绩 = Σ(环节权重 × 环节得分) / Σ环节权重
 *       环节得分 = Σ(子项权重 × 子项分数) / Σ子项权重
 * 未打分的子项不计入分母；某环节全部未打分则该环节不参与总评。
 */
const DEFAULT_ITEMS = [
  { key: 'func', title: '功能实现', weight: 40 },
  { key: 'circuit', title: '电路设计', weight: 20 },
  { key: 'report', title: '实验报告', weight: 20 },
  { key: 'debug', title: '调试过程', weight: 20 }
];

function loadScheme() {
  let row = db.sql.prepare('SELECT * FROM grade_scheme WHERE id=1').get();
  if (!row) {
    const stages = PROBLEMS.map(p => ({ key: p.id, title: p.title, weight: 1 }));
    db.sql.prepare(`INSERT INTO grade_scheme (id,name,pass_score,decimals,stages,items,updated_at)
      VALUES (1,?,?,?,?,?,?)`).run('默认成绩方案', 60, 0, JSON.stringify(stages), JSON.stringify(DEFAULT_ITEMS), nowLocal());
    row = db.sql.prepare('SELECT * FROM grade_scheme WHERE id=1').get();
  }
  let stages = [], items = [];
  try { stages = JSON.parse(row.stages || '[]'); } catch { }
  try { items = JSON.parse(row.items || '[]'); } catch { }
  if (!items.length) items = DEFAULT_ITEMS;
  return { name: row.name, passScore: row.pass_score, decimals: row.decimals, stages, items };
}

function roundTo(v, decimals) {
  if (v == null) return null;
  const k = Math.pow(10, Math.max(0, Math.min(4, decimals | 0)));
  return Math.round(v * k) / k;
}

/** 由"扁平的打分表"计算某学生的环节分与总分 */
function computeStudent(scheme, scores) {
  const stageScores = {};
  let wSum = 0, acc = 0;
  for (const st of scheme.stages) {
    let iSum = 0, iAcc = 0, has = false;
    for (const it of scheme.items) {
      const v = scores[`${st.key}|${it.key}`];
      if (v == null) continue;
      has = true; iSum += it.weight; iAcc += it.weight * v;
    }
    if (!has) { stageScores[st.key] = null; continue; }
    const sc = iAcc / iSum;
    stageScores[st.key] = roundTo(sc, 1);
    const w = Number(st.weight) || 0;
    if (w > 0) { wSum += w; acc += w * sc; }
  }
  const total = wSum > 0 ? roundTo(acc / wSum, scheme.decimals) : null;
  return { stageScores, total };
}

route('GET', '/api/gradebook', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const scheme = loadScheme();
  const students = db.sql.prepare("SELECT id,username,name,class_name,student_no FROM users WHERE role='student' ORDER BY class_name, student_no").all();
  const rows = db.sql.prepare('SELECT * FROM grade_scores').all();
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { scores: {}, comments: {} });
    const m = byUser.get(r.user_id);
    m.scores[`${r.stage_key}|${r.item_key}`] = r.score;
    if (r.comment) m.comments[`${r.stage_key}|${r.item_key}`] = r.comment;
  }
  sendJSON(res, 200, {
    scheme,
    students: students.map(s => {
      const m = byUser.get(s.id) || { scores: {}, comments: {} };
      const c = computeStudent(scheme, m.scores);
      return {
        id: s.id, username: s.username, name: s.name, className: s.class_name, studentNo: s.student_no,
        scores: m.scores, comments: m.comments,
        stageScores: c.stageScores, total: c.total,
        pass: c.total != null ? c.total >= scheme.passScore : null
      };
    })
  });
});

route('POST', '/api/gradebook/scheme', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  const stages = Array.isArray(b.stages) ? b.stages : [];
  const items = Array.isArray(b.items) && b.items.length ? b.items : DEFAULT_ITEMS;
  if (!stages.length) return sendJSON(res, 400, { error: '成绩方案至少要有一个环节' });
  const clean = (arr) => arr.map(x => ({
    key: String(x.key || '').slice(0, 64),
    title: String(x.title || x.key || '').slice(0, 80),
    weight: Math.max(0, Number(x.weight) || 0)
  })).filter(x => x.key && x.weight >= 0);
  db.sql.prepare('UPDATE grade_scheme SET name=?, pass_score=?, decimals=?, stages=?, items=?, updated_at=? WHERE id=1')
    .run(String(b.name || '成绩方案').slice(0, 60),
      Math.max(0, Math.min(100, Number(b.passScore) || 60)),
      Math.max(0, Math.min(4, Number(b.decimals) || 0)),
      JSON.stringify(clean(stages)), JSON.stringify(clean(items)), nowLocal());
  sendJSON(res, 200, { ok: true, scheme: loadScheme() });
});

route('POST', '/api/gradebook/score', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  const userId = Number(b.userId), stageKey = String(b.stageKey || ''), itemKey = String(b.itemKey || '');
  if (!userId || !stageKey || !itemKey) return sendJSON(res, 400, { error: '参数不完整' });
  const raw = b.score;
  if (raw === '' || raw === null || raw === undefined) {
    db.sql.prepare('DELETE FROM grade_scores WHERE user_id=? AND stage_key=? AND item_key=?').run(userId, stageKey, itemKey);
    return sendJSON(res, 200, { ok: true, cleared: true });
  }
  const score = Number(raw);
  if (!isFinite(score) || score < 0 || score > 100) return sendJSON(res, 400, { error: '分数应在 0–100 之间' });
  db.sql.prepare(`INSERT INTO grade_scores (user_id,stage_key,item_key,score,comment,updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id,stage_key,item_key) DO UPDATE SET score=excluded.score, comment=excluded.comment, updated_at=excluded.updated_at`)
    .run(userId, stageKey, itemKey, score, String(b.comment || ''), nowLocal());
  sendJSON(res, 200, { ok: true });
});

/* 学生查看自己的成绩 */
route('GET', '/api/gradebook/me', async (req, res) => {
  const u = requireRole(req, res); if (!u) return;
  const scheme = loadScheme();
  const rows = db.sql.prepare('SELECT * FROM grade_scores WHERE user_id=?').all(u.id);
  const scores = {}, comments = {};
  for (const r of rows) {
    scores[`${r.stage_key}|${r.item_key}`] = r.score;
    if (r.comment) comments[`${r.stage_key}|${r.item_key}`] = r.comment;
  }
  const c = computeStudent(scheme, scores);
  sendJSON(res, 200, {
    scheme: { name: scheme.name, passScore: scheme.passScore, decimals: scheme.decimals, stages: scheme.stages, items: scheme.items },
    scores, comments, stageScores: c.stageScores, total: c.total,
    pass: c.total != null ? c.total >= scheme.passScore : null
  });
});

route('GET', '/api/settings', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  sendJSON(res, 200, {
    llm: llm.publicConfig(),
    platform: {
      // 返回布尔值，避免前端把 '0' 字符串当成 true（这个坑真实发生过）
      requireRoster: settingOn('require_roster', true),
      allowSelfRegister: settingOn('allow_self_register', true),
      siteName: db.getSetting('site_name', '微控制器原理及应用 · 教学仿真实验平台'),
      announce: db.getSetting('announce', '')
    }
  });
});

route('POST', '/api/settings/llm', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  const saved = llm.save(b);
  db.logEvent(u.id, 'llm_config', { enabled: saved.enabled, model: saved.model });
  sendJSON(res, 200, { ok: true, llm: saved });
});

route('POST', '/api/settings/llm/test', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  try {
    const r = await llm.chat([{ role: 'user', content: '请回复"连接成功"四个字。' }], { maxTokens: 20, timeoutMs: 20000 });
    sendJSON(res, 200, { ok: true, content: r.content, model: r.model });
  } catch (e) { sendJSON(res, 200, { ok: false, error: e.message }); }
});

route('POST', '/api/settings/platform', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  for (const [k, v] of Object.entries(b || {})) {
    const key = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
    // 曾经这里一律 String(v)，布尔 true 会存成 "true"，而校验比较的是 '1'，
    // 于是教师点一次"保存设置"就静默关掉了名单校验。这里统一成 '1'/'0'。
    const val = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
    db.setSetting(key, val);
  }
  sendJSON(res, 200, { ok: true });
});

route('POST', '/api/teacher/announce', async (req, res) => {
  const u = requireRole(req, res, 'teacher'); if (!u) return;
  const b = await readJSON(req);
  db.setSetting('announce', b.text || '');
  sendJSON(res, 200, { ok: true });
});

/* ============ 平台信息 ============ */
/* 健康检查（供反向代理/云平台探活，无需登录） */
route('GET', '/api/health', async (req, res) => {
  sendJSON(res, 200, { ok: true, uptime: Math.round(process.uptime()), ts: Date.now() });
});

route('GET', '/api/info', async (req, res) => {
  const u = currentUser(req);
  sendJSON(res, 200, {
    secure: isSecureReq(req),
    tls: TLS,
    siteName: db.getSetting('site_name', '微控制器原理及应用 · 教学仿真实验平台'),
    announce: db.getSetting('announce', ''),
    requireRoster: settingOn('require_roster', true),
    allowSelfRegister: settingOn('allow_self_register', true),
    aiEnabled: llm.config.enabled,
    toolchain: { sdccPresent: compiler.supported },
    host: { platform: process.platform, node: process.version, uptime: Math.round(process.uptime()) },
    user: u ? publicUser(u) : null
  });
});

/* ---------------------------------------------------------------- 静态资源 */
async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const full = path.normalize(path.join(PUBLIC, rel));
  if (!full.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    // SPA 回退
    const idx = path.join(PUBLIC, 'index.html');
    if (fs.existsSync(idx)) return sendAsset(req, res, fs.readFileSync(idx), { type: MIME['.html'], rel: '/index.html' });
    return send(res, 404, 'Not Found');
  }
  const ext = path.extname(full).toLowerCase();
  const buf = fs.readFileSync(full);
  return sendAsset(req, res, buf, {
    type: MIME[ext] || 'application/octet-stream',
    rel: rel.replace(/\\/g, '/')
  });
}

/* ---------------------------------------------------------------- 服务器 */
/** 请求处理主体（HTTP / HTTPS 共用） */
async function handler(req, res) {
  const u0 = url.parse(req.url, true);
  const pathname = u0.pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (req.method === 'OPTIONS') {
    return send(res, 204, '', {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Mculab-Token',
      'Access-Control-Allow-Credentials': 'true'
    });
  }

  if (pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.re);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => params[k] = m[i + 1]);
      try {
        await r.handler(req, res, params);
      } catch (e) {
        console.error('[API ERROR]', pathname, e);
        if (!res.headersSent) sendJSON(res, 500, { error: '服务器内部错误：' + e.message });
      }
      return;
    }
    return sendJSON(res, 404, { error: 'API 不存在：' + pathname });
  }

  try { await serveStatic(req, res, pathname); }
  catch (e) { send(res, 500, 'Internal Error: ' + e.message); }
}

/* 有证书就走 HTTPS，否则 HTTP。两者共用同一个 handler。 */
const server = TLS
  ? https.createServer({
    cert: fs.readFileSync(TLS_CERT),
    key: fs.readFileSync(TLS_KEY)
  }, handler)
  : http.createServer(handler);

/* ---------------------------------------------------------------- 启动 */
function localIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

compiler.probe().then(p => {
  const scheme = TLS ? 'https' : 'http';
  console.log('================================================================');
  console.log(' 微控制器原理及应用 · 教学仿真实验平台');
  console.log('================================================================');
  console.log(` 本机访问     : ${scheme}://localhost:${PORT}`);
  for (const ip of localIPs()) console.log(` 局域网访问   : ${scheme}://${ip}:${PORT}   ← 学生用这个`);
  console.log(` 监听地址     : ${HOST}:${PORT}`);
  console.log(` 数据文件     : ${path.join(DATA, 'mculab.db')}`);
  console.log(` SDCC 工具链  : ${compiler.supported ? (p.ok ? '可用 ' + (p.version || '') : '存在但不可用：' + (compiler.probeError || '').slice(0, 80)) : '未找到（将降级为内置汇编器通路）'}`);
  console.log(` 大模型       : ${llm.config.enabled ? '已启用 ' + llm.config.model : '未启用（使用离线规则助教）'}`);
  console.log(` TLS          : ${TLS ? '已启用（Web Serial 可用）' : '未启用（若从公网 HTTP 访问，真机烧录会被浏览器禁用）'}`);
  console.log('----------------------------------------------------------------');
  console.log(' 公网访问：见 docs/01-部署指南.md（反向代理 / 内网穿透 / 云托管）');
  console.log(' 弱网优化：已启用 gzip + ETag/304 + Service Worker 离线缓存');
  console.log('================================================================\n');
  server.listen(PORT, HOST);
});

process.on('SIGINT', () => { console.log('\n正在关闭…'); db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });
