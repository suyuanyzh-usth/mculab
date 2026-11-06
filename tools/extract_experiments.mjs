/** 从 server/seed.js 提取每个实验的起始代码，写为独立 .c 文件（便于核查与编译） */
import fs from 'node:fs';
import path from 'node:path';
import { PROBLEMS } from '../server/seed.js';
const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'data', 'experiments');
fs.mkdirSync(DIR, { recursive: true });
let n = 0;
for (const p of PROBLEMS) {
  if (!p.starter) continue;
  fs.writeFileSync(path.join(DIR, p.id + '.c'), p.starter, 'utf8');
  n++;
}
console.log(`已导出 ${n} 个实验源码到 data/experiments/`);
