/**
 * make_cloud_bundle.mjs — 生成"云端发布包"
 * ==================================================================
 * 为什么不直接发布项目根目录：
 *   · toolchain/sdcc 是 280MB 的 Windows 版，云端用不上，上传会极慢甚至失败；
 *   · data/ 里有学生数据库与编译临时文件，不该上传；
 *   · tests/ docs/ certs/ .playwright-cli/ 与运行无关。
 *
 * 产出：cloud/（约 2MB），供发布工具上传。
 * 用法：node tools/make_cloud_bundle.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'cloud');

const INCLUDE = [
  'package.json',
  'README.md',
  'server',
  'public',
  'platform',
  'tools'
];

function copyRec(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) copyRec(path.join(src, name), path.join(dst, name));
  } else {
    fs.copyFileSync(src, dst);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let files = 0, bytes = 0;
for (const rel of INCLUDE) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) { console.warn('  跳过（不存在）:', rel); continue; }
  const dst = path.join(OUT, rel);
  copyRec(src, dst);
  const walk = (p) => {
    const s = fs.statSync(p);
    if (s.isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(p, n));
    else { files++; bytes += s.size; }
  };
  walk(dst);
}

// 云端必须自带 Linux 版 SDCC：沙箱里没有 apt、也装不了包，不带上就没法编译
const LINUX_SDCC = path.join(ROOT, 'toolchain', 'sdcc-linux');
if (fs.existsSync(LINUX_SDCC)) {
  const dst = path.join(OUT, 'toolchain', 'sdcc-linux');
  copyRec(LINUX_SDCC, dst);
  const walk2 = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const n of fs.readdirSync(p)) walk2(path.join(p, n));
    else { files++; bytes += st.size; }
  };
  walk2(dst);
  console.log('  ✓ 已包含 Linux 版 SDCC（toolchain/sdcc-linux）');
} else {
  console.warn('  ! 未找到 toolchain/sdcc-linux，云端将无法编译 C');
}

// 云端需要可写的数据目录占位
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

console.log(`  ✓ cloud/ 已生成：${files} 个文件，${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log('  下一步：用发布工具发布 cloud/ 目录');
