import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(import.meta.dirname, '..');
const node = process.execPath;
const suites = [
  ['oracle.test.mjs', '内核交叉验证（对照 SDCC/ucsim_51）'],
  ['core.test.mjs', '内核 / 汇编器 / HEX 单元测试'],
  ['circuit.test.mjs', '原理图 / 网表 / 器件仿真'],
  ['experiments.test.mjs', '内置 15 个实验端到端行为验证'],
  ['compile.test.mjs', '编译服务（SDCC 调用链 + Keil 兼容）'],
  ['api.test.mjs', '服务端 API 与数据库'],
  ['client.test.mjs', '前端 API 客户端契约（登录 401 语义/输入归一化）'],
  ['roster.test.mjs', '名单准入与注册安全'],
  ['deploy.test.mjs', '部署关键假设（PORT/数据目录/无 SDCC 降级）'],
  ['invite.test.mjs', '教师注册与邀请码'],
  ['grade.test.mjs', '实验任务过程记录与成绩册'],
  ['kb-open.test.mjs', '知识库检索与开放性命题'],
  ['network.test.mjs', '网络适应性（gzip/304/PWA/反代感知）']
];

console.log('================================================================');
console.log(' 微控制器原理及应用教学仿真实验平台 —— 全量测试');
console.log('================================================================\n');

let totalFail = 0, totalPass = 0, skipped = 0;
for (const [file, title] of suites) {
  const p = path.join(ROOT, 'tests', file);
  if (!fs.existsSync(p)) { console.log(`— 跳过 ${title}（缺少 ${file}）\n`); skipped++; continue; }
  console.log(`▶ ${title}  [${file}]`);
  const r = spawnSync(node, [p], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
  const out = (r.stdout || '') + (r.stderr || '');
  // 只打印关键行，避免刷屏
  const lines = out.split('\n');
  const keep = lines.filter(l => /\[FAIL\]|\[ERR \]|结果:|Error|error:|异常|失败/.test(l));
  console.log(keep.length ? keep.join('\n') : '  （无输出摘要）');
  if (r.status !== 0) { totalFail++; console.log(`  ✗ 该套件未通过（exit=${r.status}）`); }
  else totalPass++;
  console.log('');
}

console.log('================================================================');
console.log(` 套件: ${totalPass} 通过 / ${totalFail} 失败 / ${skipped} 跳过`);
console.log('================================================================');

// 可选的 bash 侧前置步骤提示
if (!fs.existsSync(path.join(ROOT, 'tests', 'fixtures'))) {
  console.log('\n提示：oracle 交叉验证需要先用 bash 生成参照数据：');
  console.log('  bash tools/make_oracle_fixtures.sh');
}
process.exit(totalFail === 0 ? 0 : 1);
