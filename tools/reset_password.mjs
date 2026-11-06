/**
 * reset_password.mjs — 重置任意账号的密码（运维兜底工具）
 * ------------------------------------------------------------------
 * 场景：教师忘记密码、或学生把初始密码改乱后联系不上教师。
 * 平台没有"邮件找回"（内网部署无邮件服务），因此提供一个本地命令。
 *
 * 用法：
 *   node tools/reset_password.mjs teacher 新密码        # 重置教师密码
 *   node tools/reset_password.mjs 2026001 123456        # 重置学生密码
 *   node tools/reset_password.mjs --list                # 列出所有账号
 *
 * 说明：
 *   · 必须能访问服务器的 data/mculab.db（在服务器本机执行）；
 *   · 重置后默认不强制改密（教师自己设的密码不需要再改一遍），
 *     如需强制，加 --must-change。
 *   · 服务端可以不停机（SQLite 支持多连接写）。
 */
import path from 'node:path';
import process from 'node:process';
import { DB } from '../server/db.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const dbFile = process.env.MCULAB_DB || path.join(ROOT, 'data', 'mculab.db');

const args = process.argv.slice(2).filter(a => a !== '');
const mustChange = args.includes('--must-change');
const rest = args.filter(a => !a.startsWith('--'));

if (args.includes('--list') || rest.length === 0) {
  const db = new DB(dbFile);
  const rows = db.sql.prepare(
    "SELECT username, role, name, class_name, student_no, active FROM users ORDER BY role DESC, class_name, student_no"
  ).all();
  console.log(`\n数据库：${dbFile}`);
  console.log(`共 ${rows.length} 个账号\n`);
  console.log('  账号'.padEnd(20) + '角色'.padEnd(10) + '姓名'.padEnd(12) + '班级');
  console.log('  ' + '-'.repeat(60));
  for (const r of rows) {
    console.log('  ' + String(r.username).padEnd(18) + String(r.role).padEnd(10)
      + String(r.name || '').padEnd(12) + String(r.class_name || ''));
  }
  console.log('\n重置密码：node tools/reset_password.mjs <账号> <新密码>\n');
  db.close();
  process.exit(0);
}

const [username, newPwd] = rest;

if (!username || !newPwd) {
  console.error('用法：node tools/reset_password.mjs <账号> <新密码> [--must-change]');
  process.exit(1);
}
if (String(newPwd).length < 6) {
  console.error('密码至少 6 位。');
  process.exit(1);
}

const db = new DB(dbFile);
const u = db.getUserByName(username);
if (!u) {
  console.error(`未找到账号「${username}」。用 --list 查看全部账号。`);
  db.close();
  process.exit(1);
}
db.setPassword(u.id, String(newPwd), mustChange ? 1 : 0);
console.log(`✓ 已重置 ${u.role === 'teacher' ? '教师' : '学生'}账号「${username}」的密码`
  + (mustChange ? '（下次登录须修改）' : '') + '。');
db.close();
