/*
 * db.js — 数据层（Node 22 内置 node:sqlite，无需任何 npm 依赖）
 * ==================================================================
 * 为什么用 node:sqlite 而不是 better-sqlite3：
 *   better-sqlite3 是原生模块，需要 node-gyp + 编译工具链；
 *   在校园机房/内网服务器上安装成功率低。node:sqlite 是 Node 22 内置，
 *   零安装、单文件持久化，最契合"教师随时迭代升级、任意网络可用"的要求。
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  return { salt, hash: h.toString('hex') };
}
export function verifyPassword(password, salt, hash) {
  const h = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  const a = Buffer.from(h.toString('hex'), 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const newToken = () => crypto.randomBytes(24).toString('base64url');

export class DB {
  constructor(file) {
    const dir = path.dirname(file);
    if (dir && dir !== '.' && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.sql = new DatabaseSync(file);
    this.sql.exec('PRAGMA journal_mode = WAL;');
    this.sql.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  migrate() {
    this.sql.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT UNIQUE NOT NULL,
      role       TEXT NOT NULL CHECK(role IN ('teacher','student')),
      pwd_salt   TEXT NOT NULL,
      pwd_hash   TEXT NOT NULL,
      name       TEXT DEFAULT '',
      class_name TEXT DEFAULT '',
      student_no TEXT DEFAULT '',
      must_change_pwd INTEGER DEFAULT 0,
      active     INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      last_login TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_users_class ON users(class_name);
    CREATE INDEX IF NOT EXISTS idx_users_no ON users(student_no);

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS problems (
      id        TEXT PRIMARY KEY,
      title     TEXT NOT NULL,
      chapter   TEXT DEFAULT '',
      difficulty TEXT DEFAULT '基础',
      statement TEXT DEFAULT '',
      starter   TEXT DEFAULT '',
      tests     TEXT DEFAULT '[]',
      preset    TEXT DEFAULT '',
      hex       TEXT DEFAULT '',
      order_no  INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      problem_id TEXT,
      kind       TEXT DEFAULT 'compile',
      ok         INTEGER DEFAULT 0,
      code       TEXT DEFAULT '',
      hex        TEXT DEFAULT '',
      message    TEXT DEFAULT '',
      cycles     INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, created_at);

    CREATE TABLE IF NOT EXISTS questions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      problem_id TEXT DEFAULT '',
      title      TEXT NOT NULL,
      body       TEXT DEFAULT '',
      code       TEXT DEFAULT '',
      context    TEXT DEFAULT '',
      status     TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS answers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      author_id   INTEGER,
      author_role TEXT DEFAULT 'ai',
      author_name TEXT DEFAULT 'AI 助教',
      body        TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS sketches (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      problem_id TEXT DEFAULT '',
      name       TEXT NOT NULL,
      json       TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER,
      type       TEXT NOT NULL,
      payload    TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    /* 实验报告：一学生一实验一份（可反复保存，提交后锁定内容供教师批阅） */
    CREATE TABLE IF NOT EXISTS reports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      problem_id  TEXT DEFAULT '',
      title       TEXT DEFAULT '',
      content     TEXT DEFAULT '',
      status      TEXT DEFAULT 'draft',       -- draft | submitted | reviewed
      evidence    TEXT DEFAULT '',
      score       REAL,
      comment     TEXT DEFAULT '',
      submitted_at TEXT,
      created_at  TEXT DEFAULT (datetime('now','localtime')),
      updated_at  TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_user_problem ON reports(user_id, problem_id);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    /*
     * 教师邀请码：教师注册必须凭码，避免学生在公网链接下把自己注册成教师。
     * 每个教师名下可有多个码，同一时刻只有一个 active；code 一经停用即失效。
     */
    CREATE TABLE IF NOT EXISTS teacher_invites (
      code       TEXT PRIMARY KEY,
      owner_id   INTEGER NOT NULL,
      active     INTEGER NOT NULL DEFAULT 1,
      uses       INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invites_owner ON teacher_invites(owner_id);

    /* ---- 实验任务：教师发布要求 + 起止时间，记录学生打开/提交 ---- */
    CREATE TABLE IF NOT EXISTS assignments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id  TEXT NOT NULL,
      title       TEXT NOT NULL,
      requirement TEXT DEFAULT '',
      start_at    TEXT,
      end_at      TEXT,
      published   INTEGER NOT NULL DEFAULT 0,
      created_by  INTEGER,
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS assignment_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      user_id       INTEGER NOT NULL,
      kind          TEXT NOT NULL,
      at            TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ae ON assignment_events(assignment_id, user_id);

    /* ---- 成绩方案与打分：教师自定义环节与子项权重 ---- */
    CREATE TABLE IF NOT EXISTS grade_scheme (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      name       TEXT DEFAULT '默认成绩方案',
      pass_score INTEGER DEFAULT 60,
      decimals   INTEGER DEFAULT 0,
      stages     TEXT,
      items      TEXT,
      updated_at TEXT
    );

    /* ---- 教师知识库（纯文本；检索用关键词相关度，不依赖向量模型） ---- */
    CREATE TABLE IF NOT EXISTS kb_docs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      filename   TEXT DEFAULT '',
      content    TEXT NOT NULL,
      chars      INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    /* ---- 开放性命题：教师自由出题，学生交原理图+代码+报告，教师打分评语 ---- */
    CREATE TABLE IF NOT EXISTS open_problems (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      statement  TEXT DEFAULT '',
      start_at   TEXT,
      end_at     TEXT,
      published  INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS open_submissions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      problem_id   INTEGER NOT NULL,
      user_id      INTEGER NOT NULL,
      schematic    TEXT DEFAULT '',
      code         TEXT DEFAULT '',
      report       TEXT DEFAULT '',
      submitted_at TEXT,
      score        REAL,
      comment      TEXT DEFAULT '',
      graded_at    TEXT,
      graded_by    INTEGER,
      UNIQUE(problem_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS grade_scores (
      user_id    INTEGER NOT NULL,
      stage_key  TEXT NOT NULL,
      item_key   TEXT NOT NULL,
      score      REAL,
      comment    TEXT DEFAULT '',
      updated_at TEXT,
      PRIMARY KEY (user_id, stage_key, item_key)
    );
    `);
  }

  /* ---------------------------------------------------------- 教师邀请码 */
  createInvite(code, ownerId) {
    this.sql.prepare('INSERT INTO teacher_invites (code, owner_id, active, uses, created_at) VALUES (?,?,1,0,?)')
      .run(code, ownerId, Date.now());
    return code;
  }
  activeInviteOf(ownerId) {
    return this.sql.prepare('SELECT * FROM teacher_invites WHERE owner_id=? AND active=1 ORDER BY created_at DESC LIMIT 1').get(ownerId) || null;
  }
  findInvite(code) {
    return this.sql.prepare('SELECT * FROM teacher_invites WHERE code=?').get(String(code || '').trim().toUpperCase()) || null;
  }
  useInvite(code) {
    this.sql.prepare('UPDATE teacher_invites SET uses = uses + 1 WHERE code=?').run(String(code).trim().toUpperCase());
  }
  deactivateInvites(ownerId) {
    this.sql.prepare('UPDATE teacher_invites SET active=0 WHERE owner_id=?').run(ownerId);
  }
  countTeachers() {
    return this.sql.prepare("SELECT COUNT(*) n FROM users WHERE role='teacher'").get().n;
  }

  /* ---------------------------------------------------------- 用户 */
  getUserByName(username) { return this.sql.prepare('SELECT * FROM users WHERE username = ?').get(username); }
  getUser(id) { return this.sql.prepare('SELECT * FROM users WHERE id = ?').get(id); }
  createUser({ username, password, role, name = '', className = '', studentNo = '', mustChange = 0 }) {
    const { salt, hash } = hashPassword(password);
    const st = this.sql.prepare(`INSERT INTO users (username,role,pwd_salt,pwd_hash,name,class_name,student_no,must_change_pwd)
      VALUES (?,?,?,?,?,?,?,?)`);
    const r = st.run(username, role, salt, hash, name, className, studentNo, mustChange ? 1 : 0);
    return Number(r.lastInsertRowid);
  }
  setPassword(id, password, mustChange = 0) {
    const { salt, hash } = hashPassword(password);
    this.sql.prepare('UPDATE users SET pwd_salt=?, pwd_hash=?, must_change_pwd=? WHERE id=?')
      .run(salt, hash, mustChange ? 1 : 0, id);
  }
  checkPassword(user, password) { return verifyPassword(password, user.pwd_salt, user.pwd_hash); }
  touchLogin(id) { this.sql.prepare("UPDATE users SET last_login=datetime('now','localtime') WHERE id=?").run(id); }
  listStudents(classFilter = null) {
    return classFilter
      ? this.sql.prepare("SELECT id,username,name,class_name,student_no,active,last_login FROM users WHERE role='student' AND class_name=? ORDER BY student_no").all(classFilter)
      : this.sql.prepare("SELECT id,username,name,class_name,student_no,active,last_login FROM users WHERE role='student' ORDER BY class_name,student_no").all();
  }
  classes() {
    return this.sql.prepare("SELECT class_name, COUNT(*) n FROM users WHERE role='student' AND class_name<>'' GROUP BY class_name ORDER BY class_name").all();
  }

  /* ---------------------------------------------------------- 会话 */
  createSession(userId, days = 14) {
    const token = newToken();
    this.sql.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,datetime('now','localtime',?))")
      .run(token, userId, `+${days} days`);
    return token;
  }
  sessionUser(token) {
    if (!token) return null;
    const s = this.sql.prepare("SELECT * FROM sessions WHERE token=? AND expires_at > datetime('now','localtime')").get(token);
    if (!s) return null;
    return this.getUser(s.user_id);
  }
  deleteSession(token) { this.sql.prepare('DELETE FROM sessions WHERE token=?').run(token); }
  purgeSessions() { this.sql.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now','localtime')").run(); }

  /* ---------------------------------------------------------- 练习记录 */
  addAttempt({ userId, problemId, kind, ok, code, hex, message, cycles }) {
    this.sql.prepare(`INSERT INTO attempts (user_id,problem_id,kind,ok,code,hex,message,cycles)
      VALUES (?,?,?,?,?,?,?,?)`).run(userId, problemId || '', kind || 'compile', ok ? 1 : 0,
      code || '', hex || '', message || '', cycles || 0);
  }
  attemptsOf(userId, limit = 50) {
    return this.sql.prepare('SELECT * FROM attempts WHERE user_id=? ORDER BY id DESC LIMIT ?').all(userId, limit);
  }
  /** 教师端：每个学生的练习统计 */
  studentStats() {
    return this.sql.prepare(`
      SELECT u.id, u.username, u.name, u.class_name, u.student_no, u.last_login,
             COUNT(a.id)                                        AS attempts,
             SUM(CASE WHEN a.ok=1 THEN 1 ELSE 0 END)            AS ok_count,
             COUNT(DISTINCT CASE WHEN a.ok=1 THEN a.problem_id END) AS solved,
             MAX(a.created_at)                                  AS last_attempt,
             (SELECT COUNT(*) FROM questions q WHERE q.user_id=u.id) AS questions
      FROM users u LEFT JOIN attempts a ON a.user_id=u.id
      WHERE u.role='student'
      GROUP BY u.id ORDER BY u.class_name, u.student_no`).all();
  }
  problemStats() {
    return this.sql.prepare(`
      SELECT problem_id, COUNT(*) attempts, SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) ok_count,
             COUNT(DISTINCT user_id) students
      FROM attempts WHERE problem_id<>'' GROUP BY problem_id ORDER BY attempts DESC`).all();
  }
  dailyActivity(days = 14) {
    return this.sql.prepare(`
      SELECT date(created_at) d, COUNT(*) n, SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) ok
      FROM attempts WHERE created_at >= date('now','localtime',?)
      GROUP BY d ORDER BY d`).all(`-${days} days`);
  }

  /* ---------------------------------------------------------- 问题 */
  addQuestion({ userId, problemId, title, body, code, context }) {
    const r = this.sql.prepare('INSERT INTO questions (user_id,problem_id,title,body,code,context) VALUES (?,?,?,?,?,?)')
      .run(userId, problemId || '', title, body || '', code || '', context || '');
    return Number(r.lastInsertRowid);
  }
  addAnswer({ questionId, authorId, role, name, body }) {
    const r = this.sql.prepare('INSERT INTO answers (question_id,author_id,author_role,author_name,body) VALUES (?,?,?,?,?)')
      .run(questionId, authorId ?? null, role, name, body);
    return Number(r.lastInsertRowid);
  }
  listQuestions({ userId = null, status = null, limit = 100 } = {}) {
    const where = [], args = [];
    if (userId) { where.push('q.user_id=?'); args.push(userId); }
    if (status) { where.push('q.status=?'); args.push(status); }
    const sql = `SELECT q.*, u.name uname, u.class_name, u.student_no,
      (SELECT COUNT(*) FROM answers a WHERE a.question_id=q.id) answers
      FROM questions q JOIN users u ON u.id=q.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY q.id DESC LIMIT ?`;
    args.push(limit);
    return this.sql.prepare(sql).all(...args);
  }
  question(id) { return this.sql.prepare('SELECT * FROM questions WHERE id=?').get(id); }
  answers(qid) { return this.sql.prepare('SELECT * FROM answers WHERE question_id=? ORDER BY id').all(qid); }
  setQuestionStatus(id, status) { this.sql.prepare('UPDATE questions SET status=? WHERE id=?').run(status, id); }

  /* ---------------------------------------------------------- 原理图 */
  saveSketch({ id, userId, problemId, name, json }) {
    this.sql.prepare(`INSERT INTO sketches (id,user_id,problem_id,name,json,updated_at)
      VALUES (?,?,?,?,?,datetime('now','localtime'))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, json=excluded.json, updated_at=excluded.updated_at`)
      .run(id, userId, problemId || '', name, json);
  }
  listSketches(userId) { return this.sql.prepare('SELECT id,problem_id,name,updated_at FROM sketches WHERE user_id=? ORDER BY updated_at DESC').all(userId); }
  getSketch(id) { return this.sql.prepare('SELECT * FROM sketches WHERE id=?').get(id); }
  deleteSketch(id, userId) { this.sql.prepare('DELETE FROM sketches WHERE id=? AND user_id=?').run(id, userId); }

  /* ---------------------------------------------------------- 实验报告 */
  saveReport({ userId, problemId, title, content, status = 'draft', evidence = '' }) {
    const exist = this.sql.prepare('SELECT * FROM reports WHERE user_id=? AND problem_id=?').get(userId, problemId || '');
    const submittedAt = status === 'submitted' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
    if (exist) {
      this.sql.prepare(`UPDATE reports SET title=?, content=?, status=?, evidence=?,
        submitted_at=COALESCE(?, submitted_at), updated_at=datetime('now','localtime') WHERE id=?`)
        .run(title || exist.title, content, status, evidence || '', submittedAt, exist.id);
      return exist.id;
    }
    const r = this.sql.prepare(`INSERT INTO reports (user_id,problem_id,title,content,status,evidence,submitted_at)
      VALUES (?,?,?,?,?,?,?)`).run(userId, problemId || '', title || '', content, status, evidence || '', submittedAt);
    return Number(r.lastInsertRowid);
  }
  getReport(userId, problemId) {
    return this.sql.prepare('SELECT * FROM reports WHERE user_id=? AND problem_id=?').get(userId, problemId || '') || null;
  }
  report(id) { return this.sql.prepare('SELECT * FROM reports WHERE id=?').get(id) || null; }
  listReports({ problemId = null, status = null } = {}) {
    const where = [], args = [];
    if (problemId) { where.push('r.problem_id=?'); args.push(problemId); }
    if (status) { where.push('r.status=?'); args.push(status); }
    return this.sql.prepare(`SELECT r.id,r.user_id,r.problem_id,r.title,r.status,r.score,r.submitted_at,r.updated_at,
        u.name uname, u.student_no, u.class_name
      FROM reports r JOIN users u ON u.id=r.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY r.updated_at DESC LIMIT 400`).all(...args);
  }
  reviewReport(id, { score, comment, status = 'reviewed' }) {
    this.sql.prepare('UPDATE reports SET score=?, comment=?, status=?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?')
      .run(score ?? null, comment || '', status, id);
  }

  /* ---------------------------------------------------------- 设置 */
  getSetting(key, def = null) {
    const r = this.sql.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return r ? r.value : def;
  }
  setSetting(key, value) {
    this.sql.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  getJSON(key, def = null) {
    const v = this.getSetting(key, null);
    if (v == null) return def;
    try { return JSON.parse(v); } catch { return def; }
  }
  logEvent(userId, type, payload) {
    this.sql.prepare('INSERT INTO events (user_id,type,payload) VALUES (?,?,?)').run(userId ?? null, type, typeof payload === 'string' ? payload : JSON.stringify(payload ?? ''));
  }
  close() { try { this.sql.close(); } catch { } }
}

/* ---------------------------------------------------------------- 班级-学生数据导入
 * 支持 CSV / TSV / 空格分隔；表头识别中英文列名。
 * 列：学号(student_no/no/学号)、姓名(name/姓名)、班级(class/班级)、
 *     初始密码(password/pwd/密码，可选)
 */
export function parseStudentTable(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], header: [] };
  const split = (l) => (l.includes('\t') ? l.split('\t') : (l.split(',').length > 1 ? l.split(',') : l.split(/\s{2,}|\s/))).map(s => s.trim().replace(/^["']|["']$/g, ''));
  const header = split(lines[0]).map(h => h.toLowerCase());
  const find = (...keys) => header.findIndex(h => keys.some(k => h === k || h.includes(k)));
  let iNo = find('student_no', 'studentno', 'no', '学号', '编号', 'id');
  let iName = find('name', '姓名', '名字');
  let iClass = find('class', '班级', '班');
  let iPwd = find('password', 'pwd', '密码');
  let start = 1;
  // 无表头（首行就是数据）时兜底按 学号,姓名,班级,密码 解析
  if (iNo < 0 && iName < 0 && iClass < 0) {
    const looksHeader = /no|name|class|学号|姓名|班级/i.test(lines[0]);
    if (looksHeader) { iNo = 0; iName = 1; iClass = 2; iPwd = 3; start = 1; }
    else { iNo = 0; iName = 1; iClass = 2; iPwd = 3; start = 0; }
  } else {
    if (iNo < 0) iNo = 0;
    if (iName < 0) iName = 1;
    if (iClass < 0) iClass = 2;
  }
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const c = split(lines[i]);
    if (!c.length || !c[iNo]) continue;
    rows.push({
      studentNo: String(c[iNo] || '').trim(),
      name: String(c[iName] ?? '').trim(),
      className: String(c[iClass] ?? '').trim(),
      password: iPwd >= 0 ? String(c[iPwd] ?? '').trim() : ''
    });
  }
  return { rows, header };
}
