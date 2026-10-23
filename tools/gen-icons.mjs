/* tools/gen-icons.mjs —— 零依赖图标生成器（node tools/gen-icons.mjs）
   纯 zlib 手写 PNG 编码器 + 扫描线多边形光栅化：绘制游戏同款"等距蛇头立方块"，
   输出 icons/icon-192.png、icons/icon-512.png、icons/maskable-512.png、icons/apple-touch-icon.png。
   图标是提交进仓库的静态产物；改配色/造型后重跑本脚本即可。 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- CRC32（手写表驱动，不依赖 zlib.crc32 以兼容老 node） ---------- */
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }

/* ---------- 最小 PNG 编码器（8bit RGBA，filter 0） ---------- */
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function pngEncode(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                       // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 光栅化：even-odd 点在多边形内 ---------- */
function inPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/* 蛇头立方块配色 = 游戏内 P1 蛇头三面色（core.js K.SK[0].head） */
const C_TOP = '#E1F5EE', C_LEFT = '#5DCAA5', C_RIGHT = '#1D9E75';
const BG = '#060a14';          // 默认主题（霓虹夜）背景色
const SS = 3;                  // 超采样倍率（抗锯齿）

/* 归一化几何（0..1），造型与 render.js 的 cube() 一致：顶菱形 + 左右两面 + 双眼 */
function geometry(scale) {
  const a = .34 * scale, b = a / 2, h = .22 * scale;
  const cx = .5, cy0 = .5 - h / 2 - (1 - scale) * .04;   // 整体垂直居中
  const top = [[cx, cy0 - b], [cx + a, cy0], [cx, cy0 + b], [cx - a, cy0]];
  const left = [[cx - a, cy0], [cx, cy0 + b], [cx, cy0 + b + h], [cx - a, cy0 + h]];
  const right = [[cx + a, cy0], [cx, cy0 + b], [cx, cy0 + b + h], [cx + a, cy0 + h]];
  // 朝向 downRight（屏幕右下）：v = 前进方向单位向量，w = 侧向
  const vn = Math.hypot(a, b);
  const v = [a / vn, b / vn], w = [-a / vn, b / vn];
  const eye = s => [cx + v[0] * .30 * a + w[0] * s * .34 * a, cy0 + v[1] * .30 * b + w[1] * s * .34 * b];
  return { top, left, right, eyes: [eye(-1), eye(1)], er: .085 * a * 2, pr: .040 * a * 2, pupilOff: .3, v };
}

function render(size, { maskable = false, solidBg = false } = {}) {
  const W = size * SS, buf = Buffer.alloc(W * W * 4);
  const g = geometry(maskable ? .72 : 1);   // maskable 安全区：内容缩到 72%
  const bgRGB = hex2rgb(BG);
  const cT = hex2rgb(C_TOP), cL = hex2rgb(C_LEFT), cR = hex2rgb(C_RIGHT);
  const put = (i, c, alpha) => {
    const o = i * 4, ia = 1 - alpha;
    buf[o] = buf[o] * ia + c[0] * alpha; buf[o + 1] = buf[o + 1] * ia + c[1] * alpha;
    buf[o + 2] = buf[o + 2] * ia + c[2] * alpha; buf[o + 3] = Math.max(buf[o + 3], alpha * 255);
  };
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = i * 4;
    if (maskable || solidBg) { buf[o] = bgRGB[0]; buf[o + 1] = bgRGB[1]; buf[o + 2] = bgRGB[2]; buf[o + 3] = 255; }
    const u = (x + .5) / W, vY = (y + .5) / W;
    if (inPoly(u, vY, g.top)) put(i, cT, 1);
    else if (inPoly(u, vY, g.left)) put(i, cL, 1);
    else if (inPoly(u, vY, g.right)) put(i, cR, 1);
    else continue;
    for (const [ex, ey] of g.eyes) {       // 眼白 + 瞳孔（看向行进方向）
      const d = Math.hypot(u - ex, (vY - ey) * 2);   // y 轴 ×2：等距视角下圆压扁成椭圆
      if (d < g.er) {
        put(i, [255, 255, 255], 1);
        const px = ex + g.v[0] * g.er * g.pupilOff * 2, py = ey + g.v[1] * g.er * g.pupilOff * 2;
        if (Math.hypot(u - px, (vY - py) * 2) < g.pr) put(i, [10, 26, 42], 1);
      }
    }
  }
  // 盒式降采样 SS → size
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, gg = 0, bl = 0, al = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const o = ((y * SS + sy) * W + (x * SS + sx)) * 4;
      r += buf[o]; gg += buf[o + 1]; bl += buf[o + 2]; al += buf[o + 3];
    }
    const n = SS * SS, o = (y * size + x) * 4;
    out[o] = r / n; out[o + 1] = gg / n; out[o + 2] = bl / n; out[o + 3] = al / n;
  }
  return pngEncode(size, size, out);
}

mkdirSync(join(ROOT, 'icons'), { recursive: true });
const jobs = [
  ['icons/icon-192.png', render(192)],
  ['icons/icon-512.png', render(512)],
  ['icons/maskable-512.png', render(512, { maskable: true })],
  ['icons/apple-touch-icon.png', render(180, { solidBg: true })]   // iOS 不支持透明，铺底色
];
for (const [rel, data] of jobs) {
  writeFileSync(join(ROOT, rel), data);
  console.log('[icons] ' + rel + ' · ' + (data.length / 1024).toFixed(1) + ' KB');
}
