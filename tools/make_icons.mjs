/**
 * make_icons.mjs — 生成 PWA 图标（纯 Node，无第三方依赖）
 * ------------------------------------------------------------------
 * 产出 public/icons/icon-192.png、icon-512.png
 * 图形：深蓝圆角方块 + 白色"芯片引脚"符号，与界面左上角 MCU 标识一致。
 * 这样学生可以把平台"添加到主屏幕"，弱网时点开即用（配合 Service Worker 离线缓存）。
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- 最小 PNG 编码器 ---------------- */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // 每行前加 filter 字节 0
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------------- 绘制 ---------------- */
function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  // 圆角半径
  const R = Math.round(size * 0.22);
  const insideRound = (x, y) => {
    const cx = Math.min(Math.max(x, R), size - 1 - R);
    const cy = Math.min(Math.max(y, R), size - 1 - R);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= R * R;
  };
  // 背景：对角渐变（左上较亮 → 右下较深），带 1px 抗锯齿
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!insideRound(x, y)) { set(x, y, 0, 0, 0, 0); continue; }
      const t = (x + y) / (2 * size);
      const r = Math.round(27 + (10 - 27) * t);
      const g = Math.round(99 + (52 - 99) * t);
      const b = Math.round(214 + (121 - 214) * t);
      set(x, y, r, g, b, 255);
    }
  }
  // 芯片本体（白色圆角矩形）
  const m = Math.round(size * 0.28);          // 边距
  const cw = size - m * 2, chh = cw;
  const rad = Math.round(size * 0.06);
  const inChip = (x, y) => {
    const x0 = m, y0 = m, x1 = m + cw, y1 = m + chh;
    if (x < x0 || y < y0 || x >= x1 || y >= y1) return false;
    const cx = Math.min(Math.max(x, x0 + rad), x1 - 1 - rad);
    const cy = Math.min(Math.max(y, y0 + rad), y1 - 1 - rad);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= rad * rad;
  };
  const pinW = Math.max(2, Math.round(size * 0.030));
  const pinLen = Math.round(size * 0.085);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inChip(x, y)) set(x, y, 255, 255, 255, 255);
    }
  }
  // 引脚：四边各 4 根
  const n = 4;
  const span = cw * 0.62, off = (cw - span) / 2;
  for (let i = 0; i < n; i++) {
    const p = Math.round(off + (span * i) / (n - 1));
    for (let t = 0; t < pinLen; t++) {
      // 左/右
      for (let w = 0; w < pinW; w++) {
        set(m - t, m + p + w, 255, 255, 255, t < pinLen - 1 ? 255 : 200);
        set(m + cw + t, m + p + w, 255, 255, 255, t < pinLen - 1 ? 255 : 200);
      }
      // 上/下
      for (let w = 0; w < pinW; w++) {
        set(m + p + w, m - t, 255, 255, 255, t < pinLen - 1 ? 255 : 200);
        set(m + p + w, m + chh + t, 255, 255, 255, t < pinLen - 1 ? 255 : 200);
      }
    }
  }
  // 中央一个深色圆点，像芯片的定位标记
  const cc = m + cw / 2, rr = size * 0.045;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cc, dy = y - cc;
      if (dx * dx + dy * dy <= rr * rr) set(x, y, 24, 90, 189, 255);
    }
  }
  return px;
}

for (const size of [192, 512]) {
  const png = encodePNG(size, size, draw(size));
  const f = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(f, png);
  console.log(`  ✓ ${path.relative(process.cwd(), f)}  ${png.length} 字节`);
}
console.log('图标生成完成');
